# backend/app/services/backup_engine.py
import os
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

logger = logging.getLogger(__name__)


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

            with tempfile.TemporaryDirectory() as tmpdir:
                files = self._create_backup_files(job, db, tmpdir)
                timestamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
                prefix = f"job{job.id}"

                total_size = 0
                last_remote_path = None
                for local_path in files:
                    filename = f"{prefix}_{timestamp}_{os.path.basename(local_path)}"
                    remote_path = plugin.upload(local_path, filename)
                    last_remote_path = remote_path
                    total_size += os.path.getsize(local_path)

            self._apply_retention(job, plugin, prefix)

            run.status = "success"
            run.finished_at = datetime.now(timezone.utc)
            run.file_size_bytes = total_size
            run.backup_file_path = last_remote_path
            db.commit()

        except Exception as e:
            logger.error(f"Backup job {job.id} failed: {e}")
            run.status = "failed"
            run.finished_at = datetime.now(timezone.utc)
            run.error_message = str(e)
            db.commit()
            self._notify_failure(job, str(e))

        return run

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
                remote_db = f"/tmp/backup_db_{server.id}.sql"
                self._exec(ssh, f"mysqldump -u root --all-databases > {remote_db}")
                local_db = os.path.join(tmpdir, f"db_{server.id}.sql")
                ssh.open_sftp().get(remote_db, local_db)
                self._exec(ssh, f"rm -f {remote_db}")
                files.append(local_db)

            if scope in ("files", "both"):
                remote_tar = f"/tmp/backup_files_{server.id}.tar.gz"
                self._exec(ssh, f"tar -czf {remote_tar} /home/*/htdocs/ 2>/dev/null || true")
                local_tar = os.path.join(tmpdir, f"files_{server.id}.tar.gz")
                ssh.open_sftp().get(remote_tar, local_tar)
                self._exec(ssh, f"rm -f {remote_tar}")
                files.append(local_tar)
        finally:
            ssh.close()

        return files

    def _exec(self, ssh, command: str) -> str:
        stdin, stdout, stderr = ssh.exec_command(command)
        exit_code = stdout.channel.recv_exit_status()
        out = stdout.read().decode()
        err = stderr.read().decode()
        if exit_code != 0:
            raise Exception(f"Command failed ({exit_code}): {err}")
        return out

    def _apply_retention(self, job: BackupJob, plugin, prefix: str) -> None:
        if not job.retention_max_count and not job.retention_max_days:
            return

        backups = plugin.list_backups(prefix)

        if job.retention_max_count and len(backups) > job.retention_max_count:
            to_delete = backups[: len(backups) - job.retention_max_count]
            for path in to_delete:
                try:
                    plugin.delete(path)
                except Exception as e:
                    logger.warning(f"Retention delete failed for {path}: {e}")

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
