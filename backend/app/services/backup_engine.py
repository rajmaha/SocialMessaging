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
                remote_tar = f"/tmp/backup_files_{server.id}.tar.gz"
                self._exec(ssh, f"tar -czf {remote_tar} /home/*/htdocs/ 2>/dev/null || true")
                local_tar = os.path.join(tmpdir, f"files_{server.id}.tar.gz")
                sftp = ssh.open_sftp()
                sftp.get(remote_tar, local_tar)
                sftp.close()
                self._exec(ssh, f"rm -f {remote_tar}")
                files.append(local_tar)
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
                    local = os.path.join(tmpdir, self._dump_name(name, used))
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
    def _dump_name(name: str, used: set) -> str:
        """db_<name>.sql.gz, made safe as a file name and unique within the zip."""
        base = "db_" + (re.sub(r"[^A-Za-z0-9_.$-]", "_", name) or "unnamed")
        candidate, n = base, 2
        while candidate.lower() in used:
            candidate, n = f"{base}_{n}", n + 1
        used.add(candidate.lower())
        return f"{candidate}.sql.gz"

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
