import logging
from sqlalchemy.orm import Session
from app.services.email_service import email_service
from app.models.user import User
from app.models.worklog import WorklogEntry

logger = logging.getLogger(__name__)

FRONTEND_URL = None


def _get_frontend_url():
    global FRONTEND_URL
    if not FRONTEND_URL:
        from app.config import settings
        FRONTEND_URL = getattr(settings, 'FRONTEND_URL', 'http://localhost:3000')
    return FRONTEND_URL


def _format_hours(h: float) -> str:
    hrs = int(h)
    mins = round((h - hrs) * 60)
    if hrs > 0 and mins > 0:
        return f"{hrs}h {mins}m"
    if hrs > 0:
        return f"{hrs}h"
    return f"{mins}m"


def _get_admin_emails(db: Session) -> list:
    admins = db.query(User).filter(User.role == "admin", User.is_active == True).all()
    return [a.email for a in admins if a.email]


def _build_html(title: str, body: str, action_url: str = None, action_label: str = None) -> str:
    action_btn = ""
    if action_url and action_label:
        action_btn = f'<p style="margin:20px 0;"><a href="{action_url}" style="display:inline-block;background:#4f46e5;color:#fff;text-decoration:none;padding:12px 24px;border-radius:6px;font-weight:600;">{action_label}</a></p>'
    return f"""
    <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;padding:20px;">
        <h2 style="color:#1f2937;margin-bottom:16px;">{title}</h2>
        <div style="color:#4b5563;line-height:1.6;">{body}</div>
        {action_btn}
        <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0;">
        <p style="color:#9ca3af;font-size:12px;">This is an automated notification from your worklog system.</p>
    </div>
    """


def notify_entry_submitted(entry: WorklogEntry, db: Session):
    admin_emails = _get_admin_emails(db)
    if not admin_emails:
        return
    agent_name = entry.user.full_name if entry.user else "An agent"
    url = f"{_get_frontend_url()}/admin/worklog/approval"
    html = _build_html(
        "New Worklog Entry Submitted",
        f"<p><strong>{agent_name}</strong> submitted a worklog entry:</p>"
        f"<ul><li>Date: {entry.log_date}</li><li>Hours: {_format_hours(entry.hours)}</li><li>Summary: {entry.summary or 'N/A'}</li></ul>",
        action_url=url,
        action_label="Review Entry"
    )
    for email in admin_emails:
        try:
            email_service.send_system_email(email, f"Worklog: {agent_name} submitted {_format_hours(entry.hours)} for {entry.log_date}", html, db=db)
        except Exception as e:
            logger.error("Failed to send worklog notification to %s: %s", email, e)


def notify_entry_approved(entry: WorklogEntry, db: Session):
    if not entry.user or not entry.user.email:
        return
    reviewer_name = entry.reviewer.full_name if entry.reviewer else "Admin"
    url = f"{_get_frontend_url()}/admin/worklog?date={entry.log_date}"
    html = _build_html(
        "Worklog Entry Approved",
        f"<p>Your worklog entry for <strong>{entry.log_date}</strong> ({_format_hours(entry.hours)}) has been approved by <strong>{reviewer_name}</strong>.</p>",
        action_url=url,
        action_label="View Worklog"
    )
    try:
        email_service.send_system_email(entry.user.email, f"Worklog approved: {entry.log_date} ({_format_hours(entry.hours)})", html, db=db)
    except Exception as e:
        logger.error("Failed to send approval notification: %s", e)


def notify_entry_rejected(entry: WorklogEntry, db: Session):
    if not entry.user or not entry.user.email:
        return
    reviewer_name = entry.reviewer.full_name if entry.reviewer else "Admin"
    url = f"{_get_frontend_url()}/admin/worklog?date={entry.log_date}"
    html = _build_html(
        "Worklog Entry Rejected",
        f"<p>Your worklog entry for <strong>{entry.log_date}</strong> ({_format_hours(entry.hours)}) was rejected by <strong>{reviewer_name}</strong>.</p>"
        f"<p><strong>Reason:</strong> {entry.rejection_note or 'No reason provided'}</p>",
        action_url=url,
        action_label="Revise & Resubmit"
    )
    try:
        email_service.send_system_email(entry.user.email, f"Worklog rejected: {entry.log_date} - {entry.rejection_note or 'See details'}", html, db=db)
    except Exception as e:
        logger.error("Failed to send rejection notification: %s", e)


def notify_entry_resubmitted(entry: WorklogEntry, db: Session):
    admin_emails = _get_admin_emails(db)
    if not admin_emails:
        return
    agent_name = entry.user.full_name if entry.user else "An agent"
    url = f"{_get_frontend_url()}/admin/worklog/approval"
    html = _build_html(
        "Worklog Entry Resubmitted",
        f"<p><strong>{agent_name}</strong> has resubmitted a worklog entry:</p>"
        f"<ul><li>Date: {entry.log_date}</li><li>Hours: {_format_hours(entry.hours)}</li><li>Summary: {entry.summary or 'N/A'}</li></ul>",
        action_url=url,
        action_label="Review Entry"
    )
    for email in admin_emails:
        try:
            email_service.send_system_email(email, f"Worklog resubmitted: {agent_name} - {entry.log_date}", html, db=db)
        except Exception as e:
            logger.error("Failed to send resubmit notification to %s: %s", email, e)


def send_daily_digest(db: Session):
    pending_count = db.query(WorklogEntry).filter(WorklogEntry.status == "pending").count()
    if pending_count == 0:
        return
    admin_emails = _get_admin_emails(db)
    if not admin_emails:
        return
    url = f"{_get_frontend_url()}/admin/worklog/approval"
    html = _build_html(
        "Worklog Daily Digest",
        f"<p>You have <strong>{pending_count}</strong> pending worklog entries awaiting your approval.</p>",
        action_url=url,
        action_label="Review Entries"
    )
    for email in admin_emails:
        try:
            email_service.send_system_email(email, f"Worklog: {pending_count} entries awaiting approval", html, db=db)
        except Exception as e:
            logger.error("Failed to send daily digest to %s: %s", email, e)
