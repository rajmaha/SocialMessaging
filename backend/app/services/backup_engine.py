# backend/app/services/backup_engine.py
import os
import re
import shlex
import logging
import tempfile
import subprocess
from datetime import datetime, timezone
from sqlalchemy.orm import Session

from app.models.backup_job import BackupJob
from app.models.backup_run import BackupRun
from app.models.backup_destination import BackupDestination
from app.models.cloudpanel_server import CloudPanelServer
from app.services.destinations.base import get_destination
from app.services.migration_service import resolve_mysql_auth

logger = logging.getLogger(__name__)

# MySQL's own databases, never part of a server backup (see _backup_mysql).
SYSTEM_DATABASES = {"mysql", "sys", "information_schema", "performance_schema"}
# Accounts MySQL and MariaDB keep for themselves; left out of grants.sql.
INTERNAL_ACCOUNTS = {"mysql.sys", "mysql.session", "mysql.infoschema", "mariadb.sys"}


def _sql_string(value: str) -> str:
    """A MySQL string literal."""
    return "'" + value.replace("\\", "\\\\").replace("'", "\\'") + "'"


class BackupEngine:

    def run(self, job_id: int, db: Session) -> BackupRun:
        job = db.query(BackupJob).filter(BackupJob.id == job_id).first()
        if not job:
            raise ValueError(f"BackupJob {job_id} not found")

        run = BackupRun(job_id=job.id, status="running", started_at=datetime.now(timezone.utc))
        db.add(run)
        db.commit()
        db.refresh(run)

        try:
            destination_obj = db.query(BackupDestination).filter(BackupDestination.id == job.destination_id).first()
            plugin = get_destination(destination_obj.type, destination_obj.config)

            # The trailing underscore matters: "job1" alone also matches job10, job11...
            prefix = f"job{job.id}_"
            with tempfile.TemporaryDirectory() as tmpdir:
                files = self._create_backup_files(job, db, tmpdir)
                timestamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
                # One zip per run, so History holds the whole backup (database
                # and files together) and Download hands back one file.
                archive = self._zip(files, os.path.join(tmpdir, f"{prefix}{timestamp}.zip"))
                remote_path = plugin.upload(archive, os.path.basename(archive))
                total_size = os.path.getsize(archive)

            # Record the run before retention, so the new backup is never the
            # one retention mistakes for an old file.
            run.status = "success"
            run.finished_at = datetime.now(timezone.utc)
            run.file_size_bytes = total_size
            run.backup_file_path = remote_path
            db.commit()

            self._apply_retention(job, plugin, prefix, db)

        except Exception as e:
            logger.error(f"Backup job {job.id} failed: {e}")
            run.status = "failed"
            run.finished_at = datetime.now(timezone.utc)
            run.error_message = str(e)
            db.commit()
            self._notify_failure(job, str(e))

        return run

    def _zip(self, files: list[str], archive_path: str) -> str:
        """Pack the run's files into one zip. Already-compressed members
        (the .tar.gz of site files) are stored, not squeezed a second time."""
        import zipfile
        with zipfile.ZipFile(archive_path, "w", allowZip64=True) as zf:
            for path in files:
                packed = path.endswith((".gz", ".zip", ".tgz", ".bz2", ".xz"))
                zf.write(
                    path, arcname=os.path.basename(path),
                    compress_type=zipfile.ZIP_STORED if packed else zipfile.ZIP_DEFLATED,
                    compresslevel=None if packed else 6,
                )
                os.remove(path)  # free the disk as we go; the zip holds it now
        return archive_path

    def _create_backup_files(self, job: BackupJob, db: Session, tmpdir: str) -> list[str]:
        if job.source_type == "local_app":
            return self._backup_local_app(tmpdir)
        else:
            server = db.query(CloudPanelServer).filter(CloudPanelServer.id == job.server_id).first()
            if not server:
                raise ValueError(f"Server {job.server_id} not found")
            return self._backup_cloudpanel_server(server, job.backup_scope, tmpdir)

    def _backup_local_app(self, tmpdir: str) -> list[str]:
        from app.config import settings
        db_url = settings.DATABASE_URL
        out_path = os.path.join(tmpdir, "app_db.sql")
        result = subprocess.run(
            ["pg_dump", db_url, "-f", out_path],
            capture_output=True, text=True
        )
        if result.returncode != 0:
            raise Exception(f"pg_dump failed: {result.stderr}")
        return [out_path]

    def _backup_cloudpanel_server(self, server: CloudPanelServer, scope: str, tmpdir: str) -> list[str]:
        import paramiko
        from io import StringIO

        ssh = paramiko.SSHClient()
        ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())

        kwargs = {"hostname": server.host, "port": server.ssh_port, "username": server.ssh_user}
        if server.ssh_key:
            pkey = paramiko.RSAKey.from_private_key(StringIO(server.ssh_key))
            kwargs["pkey"] = pkey
        else:
            kwargs["password"] = server.ssh_password
        ssh.connect(**kwargs)

        files = []
        try:
            if scope in ("db", "both"):
                files += self._backup_mysql(ssh, server.id, tmpdir)

            if scope in ("files", "both"):
                files += self._backup_site_files(ssh, server.id, tmpdir)
        finally:
            ssh.close()

        return files

    def _backup_mysql(self, ssh, server_id: int, tmpdir: str) -> list[str]:
        """
        One gzipped dump per site database, plus grants.sql listing the logins.

        MySQL's own databases are left out: information_schema and
        performance_schema are views of the running server, sys is rebuilt by
        MySQL itself, and restoring `mysql` would overwrite every login on the
        target (root and CloudPanel's own included) and can stop a server of
        another version from starting. A site needs its database and a user
        CloudPanel makes when the database is added; grants.sql is there to read
        while rebuilding, not to run as a whole.
        """
        # `mysqldump -u root` with no password only works when the SSH user is
        # root and root has a defaults file; elsewhere it dies with "Access
        # denied for user 'root'@'localhost' (using password: NO)". Probe for a
        # login that actually connects, same as DB migrations do.
        auth, auth_err = resolve_mysql_auth(ssh)
        if auth is None:
            raise Exception(auth_err)

        out = self._exec(ssh, auth.shell(auth.binary("mysql", "-N -B -e 'SHOW DATABASES'")))
        names = [n.strip() for n in out.splitlines() if n.strip()]
        databases = []
        for name in names:
            if name.lower() in SYSTEM_DATABASES:
                continue
            if name.startswith("-"):  # would be read as an option
                logger.warning(f"Backup of server {server_id}: skipped database {name!r}")
                continue
            databases.append(name)
        if not databases:
            raise Exception("No databases found on this server besides MySQL's own.")

        files = []
        used = set()
        sftp = ssh.open_sftp()
        try:
            for i, name in enumerate(databases):
                remote = f"/tmp/backup_{server_id}_{i}.sql"
                dump = auth.binary(
                    "mysqldump",
                    "--single-transaction --routines --triggers --events --no-tablespaces "
                    f"--default-character-set=utf8mb4 {shlex.quote(name)}",
                )
                try:
                    # Chained with && so a failed dump never reaches gzip. Inside
                    # auth.shell() so that, under sudo, the file is written with
                    # mysqldump's own privileges -- and removed with them: /tmp is
                    # sticky, so a non-root SSH user cannot unlink it.
                    self._exec(ssh, auth.shell(f"{dump} > {remote} && gzip -f {remote}"))
                    local = os.path.join(tmpdir, self._unique_name("db_", name, ".sql.gz", used))
                    sftp.get(f"{remote}.gz", local)
                except Exception as e:
                    raise Exception(f"Dumping database {name} failed: {e}")
                finally:
                    try:
                        self._exec(ssh, auth.shell(f"rm -f {remote} {remote}.gz"))
                    except Exception:
                        pass
                files.append(local)
        finally:
            sftp.close()

        files.append(self._write_grants(ssh, auth, server_id, tmpdir))
        return files

    @staticmethod
    def _unique_name(prefix: str, name: str, ext: str, used: set) -> str:
        """<prefix><name><ext>, made safe as a file name and unique within the zip."""
        base = prefix + (re.sub(r"[^A-Za-z0-9_.$-]", "_", name) or "unnamed")
        candidate, n = base, 2
        while candidate.lower() in used:
            candidate, n = f"{base}_{n}", n + 1
        used.add(candidate.lower())
        return f"{candidate}{ext}"

    def _backup_site_files(self, ssh, server_id: int, tmpdir: str) -> list[str]:
        """
        One files_<site>.tar.gz per /home/<user>/htdocs/<site>, the shared app
        folder once (shared.tar.gz), and the nginx site configs for reference.

        Anything mounted inside a site is left out. OMS sites bind-mount the
        shared app code and assets from /home/shared into every site, so without
        this each site carried its own copy of ~600 MB of the same code. That
        code is archived once instead, from /home/shared. tar's
        --one-file-system would not do it: a bind mount from the same disk has
        the same device number, so tar walks straight into it.

        tar streams over SSH into the local file -- nothing is staged on the
        server's disk -- and runs under sudo when the SSH user is not root and
        may, so one user's site is not skipped for another's permissions.
        """
        wrap = self._file_wrapper(ssh)
        # A home the SSH user cannot open hides its sites from the listing, so it
        # is reported rather than quietly leaving a site out of the backup.
        out = self._exec(ssh, wrap(
            'for h in /home/*/; do [ -r "$h" ] && [ -x "$h" ] || printf "LOCKED %s\\n" "${h%/}"; done; '
            'for d in /home/*/htdocs/*/; do [ -d "$d" ] && printf "SITE %s\\n" "${d%/}"; done; exit 0'
        ))
        locked = [line[7:] for line in out.splitlines() if line.startswith("LOCKED /home/")]
        if locked:
            raise Exception(
                "Cannot read " + ", ".join(locked) + " as the SSH user, so sites there would be "
                "left out. Connect as root or give the SSH user passwordless sudo."
            )
        sites = [line[5:] for line in out.splitlines() if line.startswith("SITE /home/")]
        if not sites:
            raise Exception("No sites found under /home/*/htdocs on this server.")
        mounts = self._mount_points(ssh)

        files, used = [], set()
        for site in sites:
            label = os.path.basename(site)
            local = os.path.join(tmpdir, self._unique_name("files_", label, ".tar.gz", used))
            self._tar(ssh, wrap, ["/", site], mounts, local, f"site {label}")
            files.append(local)

        code, _out, _err = self._run(ssh, wrap("test -d /home/shared"))
        if code == 0:
            local = os.path.join(tmpdir, "shared.tar.gz")
            self._tar(ssh, wrap, ["/", "/home/shared"], mounts, local, "/home/shared")
            files.append(local)

        # Reference only, like grants.sql: CloudPanel writes a plain config when
        # a site is added, so custom rules have to be put back by hand. -h keeps
        # what sites-enabled links to rather than the links themselves.
        local = os.path.join(tmpdir, "nginx_sites.tar.gz")
        try:
            self._tar(ssh, wrap, ["/etc/nginx", "sites-enabled"], [], local, "nginx site configs", deref=True)
            files.append(local)
        except Exception as e:
            logger.warning(f"Backup of server {server_id}: nginx site configs not saved: {e}")
            if os.path.exists(local):
                os.remove(local)
        return files

    def _file_wrapper(self, ssh):
        """How to run a command that reads every site: as is for root, under
        passwordless sudo when there is one, otherwise as the SSH user -- in
        which case a site it cannot read fails the backup instead of being skipped."""
        code, out, _err = self._run(ssh, "id -u")
        if code == 0 and out.strip() == "0":
            return lambda cmd: cmd
        code, _out, _err = self._run(ssh, "sudo -n true")
        if code == 0:
            return lambda cmd: "sudo -n sh -c " + shlex.quote(cmd)
        return lambda cmd: cmd

    def _mount_points(self, ssh) -> list[str]:
        """Every mount point on the server, from /proc/self/mounts."""
        code, out, _err = self._run(ssh, "cat /proc/self/mounts")
        if code != 0:
            return []
        points = []
        for line in out.splitlines():
            fields = line.split()
            if len(fields) > 1:
                # Spaces and the like are written as octal escapes (\040).
                points.append(re.sub(r"\\([0-7]{3})", lambda m: chr(int(m.group(1), 8)), fields[1]))
        return points

    def _tar(self, ssh, wrap, where: list, mounts: list, local_path: str, label: str,
             deref: bool = False) -> None:
        """Stream `tar -C <where[0]> -czf - <where[1]>` into local_path,
        leaving out anything mounted inside it. GNU tar's exit 1 only means a
        file changed while it was read (a live site); 2 and up is a failure."""
        base, member = where
        root = member if member.startswith("/") else os.path.join(base, member)
        rel = os.path.relpath(member, base) if member.startswith("/") else member
        excludes = [
            "--exclude=" + shlex.quote(os.path.relpath(m, base))
            for m in mounts if m.startswith(root.rstrip("/") + "/")
        ]
        # Options before the member: GNU tar ignores an --exclude given after it.
        # --no-wildcards: a folder named with * or [ is still only itself.
        parts = ["tar", "-C", shlex.quote(base), "-czf", "-"] + (["-h"] if deref else []) + (["--no-wildcards"] if excludes else []) + excludes + ["--", shlex.quote(rel)]
        code, err = self._exec_to_file(ssh, wrap(" ".join(parts)), local_path)
        err = err.strip()
        if code not in (0, 1) or not os.path.exists(local_path) or os.path.getsize(local_path) == 0:
            raise Exception(f"Archiving {label} failed: {err[-500:] or f'tar exited {code}'}")
        if code == 1:
            logger.info(f"Archiving {label}: files changed while being read: {err[-300:]}")

    def _exec_to_file(self, ssh, command: str, local_path: str) -> tuple:
        """Run `command`, writing its stdout to local_path as it arrives.
        stderr is read alongside, so a chatty command cannot stall the stream."""
        import threading
        _stdin, stdout, stderr = ssh.exec_command(command)
        errors = []
        reader = threading.Thread(target=lambda: errors.append(stderr.read()), daemon=True)
        reader.start()
        with open(local_path, "wb") as f:
            while True:
                chunk = stdout.read(1024 * 1024)
                if not chunk:
                    break
                f.write(chunk)
        code = stdout.channel.recv_exit_status()
        reader.join(timeout=30)
        return code, b"".join(errors).decode("utf-8", errors="replace")

    def _run(self, ssh, command: str) -> tuple:
        """(exit code, stdout, stderr) without raising."""
        _stdin, stdout, stderr = ssh.exec_command(command)
        out = stdout.read().decode("utf-8", errors="replace")
        code = stdout.channel.recv_exit_status()
        return code, out, stderr.read().decode("utf-8", errors="replace")

    def _write_grants(self, ssh, auth, server_id: int, tmpdir: str) -> str:
        """
        grants.sql: CREATE USER and GRANT for every login but MySQL's internal
        ones. Best effort -- a server that will not answer gets a note in the
        file rather than a failed backup, since the databases are what matter.
        """
        path = os.path.join(tmpdir, "grants.sql")
        lines = [
            "-- MySQL logins on this server when it was backed up.",
            "-- For reference while rebuilding: run only the lines for the site you",
            "-- are restoring, after CloudPanel has created its database. Running the",
            "-- whole file would also change root and CloudPanel's own logins.",
            "",
        ]
        try:
            out = self._exec(ssh, auth.shell(auth.binary("mysql", "-N -B -e 'SELECT user, host FROM mysql.user'")))
            statements = ["SET SESSION print_identified_with_as_hex = ON;"]  # MySQL 8: hashes are binary
            for row in out.splitlines():
                user, _, host = row.partition("\t")
                if not user or user in INTERNAL_ACCOUNTS:
                    continue
                account = f"{_sql_string(user)}@{_sql_string(host)}"
                statements.append(f"SHOW CREATE USER {account};")
                statements.append(f"SHOW GRANTS FOR {account};")
            # --force: one account the server cannot describe does not stop the rest.
            out = self._exec_stdin(ssh, auth.shell(auth.binary("mysql", "-N -B --force")),
                                   "\n".join(statements) + "\n")
            lines += [f"{line};" for line in out.splitlines() if line.strip()]
        except Exception as e:
            logger.warning(f"Backup of server {server_id}: could not read the logins: {e}")
            lines.append(f"-- Could not read the logins: {e}")
        with open(path, "w", encoding="utf-8") as f:
            f.write("\n".join(lines) + "\n")
        return path

    def _exec_stdin(self, ssh, command: str, data: str) -> str:
        """Like _exec, with `data` sent on the command's stdin."""
        stdin, stdout, stderr = ssh.exec_command(command)
        stdin.write(data)
        stdin.channel.shutdown_write()
        out = stdout.read().decode("utf-8", errors="replace")
        exit_code = stdout.channel.recv_exit_status()
        err = stderr.read().decode("utf-8", errors="replace")
        # --force carries on past a failed statement and still exits non-zero;
        # what did answer is kept.
        if exit_code != 0 and not out.strip():
            raise Exception(f"Command failed ({exit_code}): {err}")
        return out

    def _exec(self, ssh, command: str) -> str:
        stdin, stdout, stderr = ssh.exec_command(command)
        exit_code = stdout.channel.recv_exit_status()
        out = stdout.read().decode()
        err = stderr.read().decode()
        if exit_code != 0:
            raise Exception(f"Command failed ({exit_code}): {err}")
        return out

    def _apply_retention(self, job: BackupJob, plugin, prefix: str, db: Session) -> None:
        if not job.retention_max_count and not job.retention_max_days:
            return

        try:
            backups = plugin.list_backups(prefix)  # oldest first
        except Exception as e:
            logger.warning(f"Retention listing failed for job {job.id}: {e}")
            return

        if job.retention_max_count and len(backups) > job.retention_max_count:
            to_delete = backups[: len(backups) - job.retention_max_count]
            for path in to_delete:
                try:
                    plugin.delete(path)
                except Exception as e:
                    logger.warning(f"Retention delete failed for {path}: {e}")
                    continue
                # The run stays in History, marked as having no file left.
                db.query(BackupRun).filter(
                    BackupRun.job_id == job.id,
                    BackupRun.backup_file_path == path,
                    BackupRun.file_deleted_at.is_(None),
                ).update({BackupRun.file_deleted_at: datetime.now(timezone.utc)}, synchronize_session=False)
            db.commit()

    def _notify_failure(self, job: BackupJob, error: str) -> None:
        """Send failure notification emails using the application SMTP config."""
        emails = job.notify_on_failure_emails or []
        if not emails:
            return

        subject = f"[Backup Failed] {job.name}"
        body = f"Backup job '{job.name}' failed.\n\nError:\n{error}"

        try:
            import smtplib
            from email.mime.text import MIMEText
            from email.mime.multipart import MIMEMultipart

            # Attempt to use the branding SMTP config (same pattern used across the codebase).
            # Fall back to environment variables if branding service is unavailable.
            try:
                from app.services.branding_service import branding_service
                smtp_config = branding_service.get_smtp_config(None)
            except Exception:
                smtp_config = {
                    "smtp_server": os.getenv("SMTP_SERVER", "smtp.gmail.com"),
                    "smtp_port": int(os.getenv("SMTP_PORT", "587")),
                    "smtp_username": os.getenv("SENDER_EMAIL", ""),
                    "smtp_password": os.getenv("SENDER_PASSWORD", ""),
                    "smtp_from_email": os.getenv("SENDER_EMAIL", ""),
                    "smtp_from_name": "Social Media Messenger",
                    "smtp_use_tls": True,
                }

            if not smtp_config.get("smtp_password"):
                # Dev mode: log instead of sending
                logger.warning(
                    "No SMTP password configured — backup failure notification (dev mode): "
                    "to=%s subject=%s", emails, subject
                )
                return

            for email_addr in emails:
                try:
                    msg = MIMEMultipart("alternative")
                    msg["Subject"] = subject
                    msg["From"] = smtp_config.get("smtp_from_email", "")
                    msg["To"] = email_addr
                    msg.attach(MIMEText(body, "plain"))

                    with smtplib.SMTP(smtp_config["smtp_server"], smtp_config["smtp_port"]) as server:
                        if smtp_config.get("smtp_use_tls", True):
                            server.starttls()
                        server.login(smtp_config["smtp_username"], smtp_config["smtp_password"])
                        server.sendmail(smtp_config["smtp_from_email"], email_addr, msg.as_string())

                    logger.info("Backup failure notification sent to %s", email_addr)
                except Exception as e:
                    logger.warning("Failed to send failure notification to %s: %s", email_addr, e)

        except Exception as e:
            logger.warning("Could not send backup failure notifications: %s", e)


backup_engine = BackupEngine()
