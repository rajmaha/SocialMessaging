# backend/app/services/migration_service.py
import os
import re
import shlex
import logging
import paramiko
from dataclasses import dataclass
from datetime import datetime
from sqlalchemy.orm import Session
from app.database import SessionLocal
from app.models.db_migration import DbMigration, DbMigrationLog, DbMigrationSchedule
from app.models.cloudpanel_server import CloudPanelServer
from app.models.cloudpanel_site import CloudPanelSite

logger = logging.getLogger(__name__)

MIGRATION_DIR = os.path.join(os.path.dirname(__file__), "..", "..", "migration_storage")


def _get_ssh_client(server: CloudPanelServer) -> paramiko.SSHClient:
    """Open and return an SSH connection to the given server."""
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    connect_kwargs = {
        "hostname": server.host,
        "port": server.ssh_port or 22,
        "username": server.ssh_user or "root",
        "timeout": 30,
    }
    if server.ssh_key:
        import io
        pkey = paramiko.RSAKey.from_private_key(io.StringIO(server.ssh_key))
        connect_kwargs["pkey"] = pkey
    else:
        connect_kwargs["password"] = server.ssh_password
    client.connect(**connect_kwargs)
    return client


BACKUP_DIR = "/var/backups/db_migrations"

# CloudPanel-generated database names; anything outside this set is refused rather
# than interpolated into a shell command.
_SAFE_DB_NAME = re.compile(r"^[A-Za-z0-9_$-]+$")


def _run(client: paramiko.SSHClient, cmd: str) -> tuple[int, str, str]:
    """Execute a command over SSH, returning (exit_code, stdout, stderr)."""
    _stdin, stdout, stderr = client.exec_command(cmd)
    out = stdout.read().decode("utf-8", errors="replace")
    exit_code = stdout.channel.recv_exit_status()
    err = stderr.read().decode("utf-8", errors="replace").strip()
    return exit_code, out, err


@dataclass
class MySQLAuth:
    """
    How to reach MySQL on a remote CloudPanel box.

    `mysql -u root` with no password only works when the SSH user is root *and*
    root has a defaults file (or socket auth); on hosts where it doesn't, the old
    hard-coded command failed with "Access denied for user 'root'@'localhost'
    (using password: NO)". resolve_mysql_auth() probes for a combination that
    actually connects and every MySQL command is built through this object.
    """
    user: str | None = None        # -u value; None means "use the defaults file"
    password: str | None = None    # passed via MYSQL_PWD, never on the command line
    host: str | None = None        # set to force TCP; CloudPanel's master account
    port: str | None = None        # is granted on 127.0.0.1, not the unix socket
    sudo: bool = False             # SSH user is not root but has passwordless sudo

    def binary(self, binary: str, args: str = "") -> str:
        """Build a single mysql/mysqldump invocation (without any sudo wrapper)."""
        parts = []
        if self.password:
            parts.append(f"MYSQL_PWD={shlex.quote(self.password)}")
        parts.append(binary)
        if self.host:
            parts.append(f"-h {shlex.quote(self.host)} --protocol=TCP")
        if self.port:
            parts.append(f"-P {shlex.quote(self.port)}")
        if self.user:
            parts.append(f"-u {shlex.quote(self.user)}")
        if args:
            parts.append(args)
        return " ".join(parts)

    def shell(self, cmd: str) -> str:
        """
        Wrap a whole shell snippet so redirects and mkdir run with the same
        privileges as the mysql command inside it.
        """
        if self.sudo:
            return "sudo -n sh -c " + shlex.quote(cmd)
        return cmd

    def describe(self) -> str:
        who = self.user or "defaults-file user"
        where = f" at {self.host}:{self.port or 3306}" if self.host else " over the socket"
        return (f"{'sudo ' if self.sudo else ''}{who}"
                f"{' with password' if self.password else ''}{where}")


def _cred_re(label: str) -> re.Pattern:
    # Matches both "User Name: root" and the "| User Name | root |" table row.
    return re.compile(rf"{label}\s*[:|]\s*\|?\s*([^\s|]+)", re.I)


_CRED_USER_RE = _cred_re(r"user\s*name")
_CRED_PASS_RE = _cred_re(r"password")
_CRED_HOST_RE = _cred_re(r"host(?:\s*name)?")
_CRED_PORT_RE = _cred_re(r"port")


def _parse_master_credentials(out: str) -> dict:
    """
    Pull the connection details out of `clpctl db:show:master-credentials`, which
    prints either "User Name: root" lines or an ASCII table. Host matters: the
    master account is granted on 127.0.0.1, so the socket connection that
    `mysql -u root` makes by default is refused.
    """
    def grab(pattern: re.Pattern) -> str | None:
        match = pattern.search(out)
        return match.group(1) if match else None

    port = grab(_CRED_PORT_RE)
    return {
        "user": grab(_CRED_USER_RE),
        "password": grab(_CRED_PASS_RE),
        "host": grab(_CRED_HOST_RE),
        "port": port if (port or "").isdigit() else None,
    }


def resolve_mysql_auth(client: paramiko.SSHClient) -> tuple[MySQLAuth | None, str]:
    """
    Find a MySQL login that works on this server, cheapest first:
    the SSH user's own defaults file, then -u root, then the same two via sudo,
    and finally CloudPanel's master credentials from clpctl.

    Returns (auth, error); auth is None when nothing connected.
    """
    probe = "-N -B -e 'SELECT 1'"
    tried = []

    def works(auth: MySQLAuth) -> bool:
        cmd = auth.shell(auth.binary("mysql", probe)) + " >/dev/null 2>&1"
        code, _out, _err = _run(client, cmd)
        return code == 0

    for auth in (MySQLAuth(), MySQLAuth(user="root"),
                 MySQLAuth(sudo=True), MySQLAuth(user="root", sudo=True)):
        tried.append(auth.describe())
        if works(auth):
            return auth, ""

    # CloudPanel keeps a master account; ask clpctl for it rather than guessing.
    for sudo in (False, True):
        code, out, _err = _run(client, MySQLAuth(sudo=sudo).shell("clpctl db:show:master-credentials"))
        if code != 0 or not out.strip():
            continue
        creds = _parse_master_credentials(out)
        tried.append(f"clpctl master credentials{' via sudo' if sudo else ''}")
        if not creds["user"] or not creds["password"]:
            continue
        # Try the reported host first, then the socket, in case a future clpctl
        # stops printing a host at all.
        endpoints = [(creds["host"], creds["port"])]
        if creds["host"]:
            endpoints.append((None, None))
        for host, port in endpoints:
            auth = MySQLAuth(user=creds["user"], password=creds["password"],
                             host=host, port=port, sudo=sudo)
            if works(auth):
                return auth, ""

    return None, (
        "Could not authenticate to MySQL on this server. Tried: "
        + ", ".join(tried)
        + ". Fix by giving the SSH user passwordless sudo, or creating /root/.my.cnf "
          "with the MySQL root credentials on the server."
    )


def site_matches(domain: str, suffix: str, exact: bool = False) -> bool:
    """
    Decide whether a site's domain is targeted by a migration's domain_suffix.

    Matching is dot-bounded rather than a raw string suffix, so "saraloms.com"
    matches "app.saraloms.com" but never "notsaraloms.com". With exact=True —
    used for drop_before_run migrations — only the named domain matches, so a
    wipe can never fan out to subdomains.
    """
    domain = (domain or "").strip().lower().rstrip(".")
    suffix = (suffix or "").strip().lower().strip(".")
    if not domain or not suffix:
        return False
    if domain == suffix:
        return True
    return not exact and domain.endswith("." + suffix)


def _quote_ident(name: str) -> str:
    """Quote a MySQL identifier, escaping any embedded backticks."""
    return "`" + name.replace("`", "``") + "`"


def backup_database(client: paramiko.SSHClient, db_name: str,
                    auth: MySQLAuth | None = None) -> tuple[bool, str, str]:
    """
    mysqldump the database to a timestamped gzip file on the remote server.

    Returns (ok, backup_path, error).  Callers must treat a False result as fatal —
    the whole point of the backup is that the drop cannot proceed without it.
    """
    if not _SAFE_DB_NAME.match(db_name):
        return False, "", f"Unsafe database name: {db_name!r}"

    auth = auth or MySQLAuth(user="root")
    stamp = datetime.utcnow().strftime("%Y%m%d-%H%M%S")
    path = f"{BACKUP_DIR}/{db_name}-{stamp}.sql"
    # Chained with && so a mysqldump failure short-circuits before gzip and the
    # exit code propagates (no pipeline, so no need for pipefail).
    dump = auth.binary(
        "mysqldump",
        f"--single-transaction --routines --triggers --events {db_name}",
    )
    cmd = auth.shell(
        f"mkdir -p {BACKUP_DIR} && {dump} > {path} && gzip -f {path}"
    )
    exit_code, _out, err = _run(client, cmd)
    if exit_code != 0:
        return False, "", err or f"mysqldump exited {exit_code}"
    return True, f"{path}.gz", ""


def drop_database_contents(client: paramiko.SSHClient, db_name: str,
                           auth: MySQLAuth | None = None) -> tuple[bool, str]:
    """
    Drop every object in the database — triggers, views, tables, routines — while
    leaving the database itself (and therefore the site's MySQL grants) intact.

    The object list is read first and the DROP script is generated here rather than
    in shell, so no identifier is ever interpolated into a remote command line.
    Returns (ok, error).
    """
    if not _SAFE_DB_NAME.match(db_name):
        return False, f"Unsafe database name: {db_name!r}"

    auth = auth or MySQLAuth(user="root")

    def query(sql: str) -> tuple[bool, list[list[str]], str]:
        # -N drops the header row, -B gives tab-separated output.
        code, out, err = _run(client, auth.shell(auth.binary("mysql", f'-N -B -e "{sql}"')))
        if code != 0:
            return False, [], err or f"mysql exited {code}"
        rows = [line.split("\t") for line in out.splitlines() if line.strip()]
        return True, rows, ""

    statements = ["SET FOREIGN_KEY_CHECKS=0;"]

    # Triggers before their tables, views before tables, then tables, then routines.
    ok, rows, err = query(
        "SELECT TRIGGER_NAME FROM information_schema.TRIGGERS "
        f"WHERE TRIGGER_SCHEMA='{db_name}'"
    )
    if not ok:
        return False, f"Listing triggers failed: {err}"
    statements += [f"DROP TRIGGER IF EXISTS {_quote_ident(r[0])};" for r in rows]

    ok, rows, err = query(
        "SELECT TABLE_NAME, TABLE_TYPE FROM information_schema.TABLES "
        f"WHERE TABLE_SCHEMA='{db_name}'"
    )
    if not ok:
        return False, f"Listing tables failed: {err}"
    statements += [
        f"DROP VIEW IF EXISTS {_quote_ident(r[0])};"
        for r in rows if len(r) > 1 and r[1] == "VIEW"
    ]
    statements += [
        f"DROP TABLE IF EXISTS {_quote_ident(r[0])};"
        for r in rows if len(r) > 1 and r[1] == "BASE TABLE"
    ]

    ok, rows, err = query(
        "SELECT ROUTINE_NAME, ROUTINE_TYPE FROM information_schema.ROUTINES "
        f"WHERE ROUTINE_SCHEMA='{db_name}'"
    )
    if not ok:
        return False, f"Listing routines failed: {err}"
    for r in rows:
        if len(r) > 1 and r[1] in ("PROCEDURE", "FUNCTION"):
            statements.append(f"DROP {r[1]} IF EXISTS {_quote_ident(r[0])};")

    statements.append("SET FOREIGN_KEY_CHECKS=1;")

    if len(statements) == 2:   # only the FK toggles — database is already empty
        return True, ""

    # Ship the script over stdin so nothing needs shell-escaping.
    script = "\n".join(statements) + "\n"
    stdin, stdout, stderr = client.exec_command(auth.shell(auth.binary("mysql", db_name)))
    stdin.write(script)
    stdin.channel.shutdown_write()
    exit_code = stdout.channel.recv_exit_status()
    err = stderr.read().decode("utf-8", errors="replace").strip()
    if exit_code != 0:
        return False, err or f"mysql exited {exit_code}"
    return True, ""


def run_server_migrations(server_id: int, db: Session, allow_drop: bool = True) -> dict:
    """
    Run all pending migrations on all matching sites on the given server.

    `allow_drop` gates migrations flagged drop_before_run. Scheduled runs pass
    False so nothing destructive ever happens unattended.
    Returns a summary dict.
    """
    server = db.query(CloudPanelServer).filter(CloudPanelServer.id == server_id).first()
    if not server:
        return {"error": f"Server {server_id} not found"}

    sites = db.query(CloudPanelSite).filter(CloudPanelSite.server_id == server_id).all()
    migrations = db.query(DbMigration).order_by(DbMigration.filename).all()

    if not sites:
        return {"server_id": server_id, "total_sites": 0, "skipped": 0, "success": 0,
                "failed": 0, "details": [],
                "notes": ["No sites are registered for this server — sync it from "
                          "Manage Sites first."]}

    # Build set of (migration_id, site_id) that already succeeded
    existing_success = set(
        (row.migration_id, row.site_id)
        for row in db.query(DbMigrationLog).filter(
            DbMigrationLog.server_id == server_id,
            DbMigrationLog.status == "success",
        ).all()
    )

    # `notes` explains outcomes that belong to the run as a whole rather than to a
    # site: without them a run that never reached a single site reports nothing but
    # zeros, which is indistinguishable from a run that had nothing to do.
    summary = {"server_id": server_id, "total_sites": len(sites),
               "skipped": 0, "success": 0, "failed": 0, "details": [], "notes": []}

    if not migrations:
        summary["notes"].append("No migrations have been uploaded yet.")
        return summary

    # Open SSH once for the whole server run
    try:
        client = _get_ssh_client(server)
    except Exception as e:
        logger.error(f"SSH connect failed for server {server_id}: {e}")
        return {"error": str(e)}

    # Work out how to talk to MySQL once per run; every site reuses it.
    auth, auth_err = resolve_mysql_auth(client)
    if not auth:
        client.close()
        logger.error(f"MySQL auth failed for server {server_id}: {auth_err}")
        return {"error": auth_err}
    logger.info(f"Server {server_id}: using MySQL auth = {auth.describe()}")

    try:
        sftp = client.open_sftp()

        for migration in migrations:
            local_path = migration.file_path
            if not os.path.exists(local_path):
                # The DB row outlives the file — a redeploy that doesn't carry
                # migration_storage across leaves rows pointing at nothing.
                note = (f"{migration.filename}: SQL file is missing on the backend "
                        f"({local_path}) — re-upload the migration.")
                logger.warning(note)
                summary["notes"].append(note)
                continue

            remote_tmp = f"/tmp/dbmig_{migration.id}_{migration.filename}"

            for site in sites:
                # Domain suffix filter. Dot-bounded, so "saraloms.com" never matches
                # "notsaraloms.com"; drop-first migrations must name one exact domain.
                if migration.domain_suffix:
                    if not site_matches(site.domain_name, migration.domain_suffix,
                                        exact=migration.drop_before_run):
                        summary["skipped"] += 1
                        continue

                # Already ran successfully
                if (migration.id, site.id) in existing_success:
                    summary["skipped"] += 1
                    continue

                # No db_name stored (or one that has no business in a shell) — skip
                if not site.db_name or not _SAFE_DB_NAME.match(site.db_name):
                    summary["skipped"] += 1
                    continue

                # Upload SQL to remote /tmp/
                try:
                    sftp.put(local_path, remote_tmp)
                except Exception as e:
                    _write_log(db, migration.id, site.id, server_id, "failed", f"SFTP upload failed: {e}")
                    summary["failed"] += 1
                    summary["details"].append({"site": site.domain_name, "migration": migration.filename,
                                               "status": "failed", "error": str(e)})
                    continue

                backup_path = None
                # Destructive path: back up, then wipe the database before importing.
                # Runs after the SFTP upload so a transfer failure can never leave a
                # dropped database behind.
                if migration.drop_before_run:
                    reason = None
                    if not allow_drop:
                        reason = ("Migration is flagged drop_before_run and cannot run "
                                  "from a scheduled job — trigger it manually.")
                    elif not migration.domain_suffix:
                        # Enforced at upload too; repeated here so a row edited
                        # directly in the DB still cannot fan out to every site.
                        reason = ("Migration is flagged drop_before_run but has no "
                                  "domain_suffix — refusing to wipe every site.")
                    if reason:
                        logger.warning(f"Skipping {migration.filename} on {site.domain_name}: {reason}")
                        summary["skipped"] += 1
                        summary["details"].append({"site": site.domain_name, "migration": migration.filename,
                                                   "status": "skipped", "error": reason})
                        client.exec_command(f"rm -f {remote_tmp}")
                        continue

                    ok, backup_path, err = backup_database(client, site.db_name, auth)
                    if not ok:
                        msg = f"Pre-drop backup failed, database left untouched: {err}"
                        _write_log(db, migration.id, site.id, server_id, "failed", msg)
                        summary["failed"] += 1
                        summary["details"].append({"site": site.domain_name, "migration": migration.filename,
                                                   "status": "failed", "error": msg})
                        client.exec_command(f"rm -f {remote_tmp}")
                        continue
                    logger.info(f"Backed up {site.db_name} to {backup_path} before drop")

                    ok, err = drop_database_contents(client, site.db_name, auth)
                    if not ok:
                        msg = f"Drop failed (backup at {backup_path}): {err}"
                        _write_log(db, migration.id, site.id, server_id, "failed", msg)
                        summary["failed"] += 1
                        summary["details"].append({"site": site.domain_name, "migration": migration.filename,
                                                   "status": "failed", "error": msg})
                        client.exec_command(f"rm -f {remote_tmp}")
                        continue

                # Run mysql
                cmd = auth.shell(f"{auth.binary('mysql', site.db_name)} < {remote_tmp}")
                try:
                    stdin, stdout, stderr = client.exec_command(cmd)
                    exit_code = stdout.channel.recv_exit_status()
                    err_output = stderr.read().decode("utf-8", errors="replace").strip()

                    if exit_code == 0:
                        _write_log(db, migration.id, site.id, server_id, "success", None)
                        summary["success"] += 1
                        detail = {"site": site.domain_name, "migration": migration.filename,
                                  "status": "success"}
                        if backup_path:
                            detail["backup"] = backup_path
                        summary["details"].append(detail)
                    else:
                        _write_log(db, migration.id, site.id, server_id, "failed", err_output)
                        summary["failed"] += 1
                        summary["details"].append({"site": site.domain_name, "migration": migration.filename,
                                                   "status": "failed", "error": err_output})
                except Exception as e:
                    _write_log(db, migration.id, site.id, server_id, "failed", str(e))
                    summary["failed"] += 1
                    summary["details"].append({"site": site.domain_name, "migration": migration.filename,
                                               "status": "failed", "error": str(e)})
                finally:
                    # Always clean up temp file
                    try:
                        client.exec_command(f"rm -f {remote_tmp}")
                    except Exception:
                        pass

        sftp.close()
    finally:
        client.close()

    # Update last_run_at and status
    schedule = db.query(DbMigrationSchedule).filter(
        DbMigrationSchedule.server_id == server_id
    ).first()
    if schedule:
        schedule.last_run_at = datetime.utcnow()
        if schedule.schedule_type == "one_time":
            schedule.status = "completed"
        db.commit()

    return summary


def _write_log(db: Session, migration_id: int, site_id: int,
               server_id: int, status: str, error: str | None):
    """Insert or update a migration log entry."""
    existing = db.query(DbMigrationLog).filter(
        DbMigrationLog.migration_id == migration_id,
        DbMigrationLog.site_id == site_id,
    ).first()
    if existing:
        existing.status = status
        existing.error_message = error
        existing.executed_at = datetime.utcnow()
    else:
        log = DbMigrationLog(
            migration_id=migration_id,
            site_id=site_id,
            server_id=server_id,
            status=status,
            error_message=error,
        )
        db.add(log)
    db.commit()


def send_migration_notification(server_id: int, db: Session) -> list:
    """
    Send a notification email to notify_emails for a server's schedule.
    Returns list of addresses emailed. Updates status to 'notified' for one_time schedules.
    """
    import smtplib
    from email.mime.text import MIMEText
    from email.mime.multipart import MIMEMultipart
    from app.services.branding_service import branding_service

    schedule = db.query(DbMigrationSchedule).filter(
        DbMigrationSchedule.server_id == server_id
    ).first()
    server = db.query(CloudPanelServer).filter(CloudPanelServer.id == server_id).first()

    if not schedule or not schedule.notify_emails or not server:
        return []

    recipients = [e.strip() for e in schedule.notify_emails.split(",") if e.strip()]
    if not recipients:
        return []

    # Build human-readable run time string
    if schedule.schedule_type == "one_time" and schedule.run_at:
        run_time_str = schedule.run_at.strftime("%Y-%m-%d at %H:%M UTC")
    elif schedule.time_of_day:
        days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
        day_name = days[schedule.day_of_week] if schedule.day_of_week is not None else "weekly"
        run_time_str = f"every {day_name} at {schedule.time_of_day} UTC"
    else:
        run_time_str = "as scheduled"

    # Collect affected domain suffixes from migrations targeting this server
    migrations = db.query(DbMigration).all()
    suffixes = sorted({m.domain_suffix for m in migrations if m.domain_suffix})
    scope_str = ", ".join(suffixes) if suffixes else "all sites"

    subject = f"Scheduled Database Maintenance — {server.name} — {run_time_str}"
    html_body = f"""
    <html>
    <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
        <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
            <h2 style="color: #2563eb;">Scheduled Database Maintenance Notice</h2>
            <p>This is an advance notice that a scheduled database maintenance will be performed on:</p>
            <table style="width:100%; border-collapse:collapse; margin: 16px 0;">
                <tr style="background:#f3f4f6;">
                    <td style="padding:10px; font-weight:bold; width:140px;">Server</td>
                    <td style="padding:10px;">{server.name}</td>
                </tr>
                <tr>
                    <td style="padding:10px; font-weight:bold;">Scheduled</td>
                    <td style="padding:10px;">{run_time_str}</td>
                </tr>
                <tr style="background:#f3f4f6;">
                    <td style="padding:10px; font-weight:bold;">Scope</td>
                    <td style="padding:10px;">{scope_str}</td>
                </tr>
            </table>
            <p>During this window your database may be briefly unavailable while migrations are applied.</p>
            <p>Thank you for your patience.</p>
            <hr style="border:none; border-top:1px solid #ddd; margin:30px 0;">
            <p style="font-size:12px; color:#999;">This is an automated message.</p>
        </div>
    </body>
    </html>
    """

    try:
        smtp_config = branding_service.get_smtp_config(db)
        if not smtp_config.get("smtp_password"):
            logger.info(f"Dev mode: migration notification would go to {recipients}")
            _mark_notified(db, schedule)
            return recipients

        msg = MIMEMultipart("alternative")
        msg["Subject"] = subject
        msg["From"] = smtp_config.get("smtp_from_email", "noreply@example.com")
        msg["To"] = ", ".join(recipients)
        msg.attach(MIMEText(html_body, "html"))

        with smtplib.SMTP(smtp_config["smtp_server"], smtp_config["smtp_port"]) as s:
            if smtp_config.get("smtp_use_tls", True):
                s.starttls()
            s.login(smtp_config["smtp_username"], smtp_config["smtp_password"])
            s.sendmail(smtp_config["smtp_from_email"], recipients, msg.as_string())

        logger.info(f"Migration notification sent to {recipients} for server {server_id}")
        _mark_notified(db, schedule)
        return recipients
    except Exception as e:
        logger.error(f"Failed to send migration notification for server {server_id}: {e}")
        return []


def _mark_notified(db: Session, schedule):
    """Set status=notified for one_time schedules."""
    if schedule.schedule_type == "one_time":
        schedule.status = "notified"
        db.commit()


def send_migration_notification_job(server_id: int):
    """APScheduler-compatible wrapper for the notification email."""
    db = SessionLocal()
    try:
        send_migration_notification(server_id, db)
    except Exception as e:
        logger.error(f"Notification job error server={server_id}: {e}")
    finally:
        db.close()


def run_server_migrations_job(server_id: int):
    """APScheduler-compatible wrapper (opens its own DB session)."""
    db = SessionLocal()
    try:
        # allow_drop=False: drop_before_run migrations are never applied unattended.
        result = run_server_migrations(server_id, db, allow_drop=False)
        logger.info(f"Scheduled migration run server={server_id}: {result}")
    except Exception as e:
        logger.error(f"Scheduled migration error server={server_id}: {e}")
    finally:
        db.close()


def register_migration_jobs(scheduler):
    """Load all enabled schedules from DB and register APScheduler jobs."""
    db = SessionLocal()
    try:
        schedules = db.query(DbMigrationSchedule).filter(
            DbMigrationSchedule.enabled == True
        ).all()
        for s in schedules:
            _upsert_job(scheduler, s.server_id, s)
        logger.info(f"Loaded {len(schedules)} migration schedule job(s)")
    except Exception as e:
        logger.warning(f"Could not load migration schedules: {e}")
    finally:
        db.close()


def _upsert_job(scheduler, server_id: int, schedule):
    """
    Register or replace APScheduler jobs for migration run + notification.
    `schedule` is a DbMigrationSchedule ORM object.
    """
    run_job_id = f"db_migration_server_{server_id}"
    notify_job_id = f"db_migration_notify_{server_id}"

    # Remove old jobs
    for jid in (run_job_id, notify_job_id):
        if scheduler.get_job(jid):
            scheduler.remove_job(jid)

    if not schedule.enabled:
        return

    if schedule.schedule_type == "one_time":
        if not schedule.run_at:
            logger.warning(f"one_time schedule for server {server_id} has no run_at — skipping")
            return
        # Migration run job
        scheduler.add_job(
            run_server_migrations_job,
            "date",
            run_date=schedule.run_at,
            id=run_job_id,
            args=[server_id],
        )
        # Notification job (fires notify_hours_before hours before)
        from datetime import timedelta
        notify_at = schedule.run_at - timedelta(hours=schedule.notify_hours_before or 24)
        from datetime import datetime as _dt, timezone as _tz
        if notify_at > _dt.now(_tz.utc):
            scheduler.add_job(
                send_migration_notification_job,
                "date",
                run_date=notify_at,
                id=notify_job_id,
                args=[server_id],
            )

    elif schedule.schedule_type == "recurring":
        if not schedule.time_of_day:
            logger.warning(f"recurring schedule for server {server_id} has no time_of_day — skipping")
            return
        hh, mm = map(int, schedule.time_of_day.split(":"))
        dow = schedule.day_of_week  # 0=Mon…6=Sun; None = every day

        # Migration run cron job
        scheduler.add_job(
            run_server_migrations_job,
            "cron",
            day_of_week=str(dow) if dow is not None else "*",
            hour=hh,
            minute=mm,
            id=run_job_id,
            args=[server_id],
        )

        # Notification cron job: notify_hours_before hours earlier
        notify_hours = schedule.notify_hours_before or 24
        from datetime import timedelta, datetime as _dt
        base = _dt(2000, 1, 1, hh, mm)
        notify_dt = base - timedelta(hours=notify_hours)
        notify_hh = notify_dt.hour
        notify_mm = notify_dt.minute
        # If subtraction crossed midnight, the notification falls on the previous day
        day_rolled_back = notify_dt.day < base.day
        if day_rolled_back and dow is not None:
            notify_dow = (dow - 1) % 7
        else:
            notify_dow = dow

        scheduler.add_job(
            send_migration_notification_job,
            "cron",
            day_of_week=str(notify_dow) if notify_dow is not None else "*",
            hour=notify_hh,
            minute=notify_mm,
            id=notify_job_id,
            args=[server_id],
        )


def remove_job(scheduler, server_id: int):
    """Remove migration run and notification jobs for a server."""
    for job_id in (
        f"db_migration_server_{server_id}",
        f"db_migration_notify_{server_id}",
    ):
        if scheduler.get_job(job_id):
            scheduler.remove_job(job_id)
