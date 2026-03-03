# backend/app/services/migration_service.py
import os
import logging
import paramiko
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


def run_server_migrations(server_id: int, db: Session) -> dict:
    """
    Run all pending migrations on all matching sites on the given server.
    Returns a summary dict.
    """
    server = db.query(CloudPanelServer).filter(CloudPanelServer.id == server_id).first()
    if not server:
        return {"error": f"Server {server_id} not found"}

    sites = db.query(CloudPanelSite).filter(CloudPanelSite.server_id == server_id).all()
    migrations = db.query(DbMigration).order_by(DbMigration.filename).all()

    if not sites:
        return {"server_id": server_id, "total_sites": 0, "skipped": 0, "success": 0, "failed": 0, "details": []}

    # Build set of (migration_id, site_id) that already succeeded
    existing_success = set(
        (row.migration_id, row.site_id)
        for row in db.query(DbMigrationLog).filter(
            DbMigrationLog.server_id == server_id,
            DbMigrationLog.status == "success",
        ).all()
    )

    summary = {"server_id": server_id, "total_sites": len(sites),
               "skipped": 0, "success": 0, "failed": 0, "details": []}

    if not migrations:
        return summary

    # Open SSH once for the whole server run
    try:
        client = _get_ssh_client(server)
    except Exception as e:
        logger.error(f"SSH connect failed for server {server_id}: {e}")
        return {"error": str(e)}

    try:
        sftp = client.open_sftp()

        for migration in migrations:
            local_path = migration.file_path
            if not os.path.exists(local_path):
                logger.warning(f"Migration file missing: {local_path}")
                continue

            remote_tmp = f"/tmp/dbmig_{migration.id}_{migration.filename}"

            for site in sites:
                # Domain suffix filter
                if migration.domain_suffix:
                    if not site.domain_name.endswith(migration.domain_suffix):
                        summary["skipped"] += 1
                        continue

                # Already ran successfully
                if (migration.id, site.id) in existing_success:
                    summary["skipped"] += 1
                    continue

                # No db_name stored — skip
                if not site.db_name:
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

                # Run mysql
                cmd = f"mysql -u root {site.db_name} < {remote_tmp}"
                try:
                    stdin, stdout, stderr = client.exec_command(cmd)
                    exit_code = stdout.channel.recv_exit_status()
                    err_output = stderr.read().decode("utf-8", errors="replace").strip()

                    if exit_code == 0:
                        _write_log(db, migration.id, site.id, server_id, "success", None)
                        summary["success"] += 1
                        summary["details"].append({"site": site.domain_name, "migration": migration.filename,
                                                   "status": "success"})
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
        result = run_server_migrations(server_id, db)
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
