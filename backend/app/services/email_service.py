"""
Email service for sending password reset emails and managing user email accounts
"""

import smtplib
import logging
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from app.config import settings
import os
import re
from datetime import datetime, timezone as _tz

def _to_utc(dt):
    """Convert a timezone-aware datetime to naive UTC. Leave naive datetimes unchanged (assumed UTC)."""
    if dt is None:
        return None
    if getattr(dt, 'tzinfo', None) is not None:
        return dt.astimezone(_tz.utc).replace(tzinfo=None)
    return dt

# Directory where attachment files are stored on disk
ATTACHMENT_STORAGE_DIR = os.path.join(
    os.path.dirname(os.path.abspath(__file__)), '..', '..', 'attachment_storage'
)

logger = logging.getLogger(__name__)


def _get_email_branding(db) -> dict:
    """Fetch branding fields needed for the email template. Safe to call with db=None."""
    defaults = {
        "company_name": "Social Media Messenger",
        "primary_color": "#2563eb",
        "logo_url": None,
        "admin_email": None,
        "contact_phone": None,
        "support_url": None,
        "privacy_url": None,
        "terms_url": None,
    }
    if not db:
        return defaults
    try:
        from app.models.branding import BrandingSettings
        from app.config import settings as _cfg
        b = db.query(BrandingSettings).first()
        if not b:
            return defaults
        logo_url = b.logo_url
        if logo_url and not logo_url.startswith("http"):
            logo_url = f"{_cfg.BACKEND_URL.rstrip('/')}/{logo_url.lstrip('/')}"
        return {
            "company_name": b.company_name or defaults["company_name"],
            "primary_color": b.primary_color or defaults["primary_color"],
            "logo_url": logo_url,
            "admin_email": b.admin_email,
            "contact_phone": getattr(b, "contact_phone", None),
            "support_url": b.support_url,
            "privacy_url": b.privacy_url,
            "terms_url": b.terms_url,
        }
    except Exception:
        return defaults


def _render_email_template(content_html: str, branding: dict) -> str:
    """
    Wrap any email body content with a branded header (logo + company name)
    and a footer (contact email, phone, links, copyright).
    """
    from datetime import datetime as _dt
    year = _dt.utcnow().year
    company   = branding["company_name"]
    color     = branding["primary_color"]
    logo_url  = branding["logo_url"]
    email_val = branding["admin_email"]
    phone_val = branding["contact_phone"]

    # Logo block
    logo_html = (
        f'<img src="{logo_url}" alt="{company}" '
        f'style="max-height:52px;max-width:200px;object-fit:contain;display:block;margin:0 auto 10px;">'
        if logo_url else ""
    )

    # Footer contact lines
    contact_lines = ""
    if email_val:
        contact_lines += (
            f'<p style="margin:4px 0;font-size:13px;color:#4b5563;">'
            f'<a href="mailto:{email_val}" style="color:#2563eb;text-decoration:none;">{email_val}</a></p>'
        )
    if phone_val:
        contact_lines += (
            f'<p style="margin:4px 0;font-size:13px;color:#4b5563;">'
            f'<a href="tel:{phone_val}" style="color:#2563eb;text-decoration:none;">{phone_val}</a></p>'
        )

    # Footer links
    links = []
    if branding.get("support_url"):
        links.append(f'<a href="{branding["support_url"]}" style="color:#6b7280;text-decoration:none;font-size:11px;">Support</a>')
    if branding.get("privacy_url"):
        links.append(f'<a href="{branding["privacy_url"]}" style="color:#6b7280;text-decoration:none;font-size:11px;">Privacy</a>')
    if branding.get("terms_url"):
        links.append(f'<a href="{branding["terms_url"]}" style="color:#6b7280;text-decoration:none;font-size:11px;">Terms</a>')
    links_html = (
        '<p style="margin:10px 0 0;">' + '&nbsp;&nbsp;·&nbsp;&nbsp;'.join(links) + '</p>'
        if links else ""
    )

    return f"""<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:Arial,'Helvetica Neue',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;">
    <tr>
      <td align="center" style="padding:36px 16px;">
        <table width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:14px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,0.08);">

          <!-- HEADER -->
          <tr>
            <td style="background:{color};padding:28px 32px;text-align:center;">
              {logo_html}
              <div style="color:#ffffff;font-size:22px;font-weight:700;letter-spacing:-0.3px;line-height:1.2;">{company}</div>
            </td>
          </tr>

          <!-- BODY -->
          <tr>
            <td style="padding:36px 36px 28px;color:#1f2937;font-size:15px;line-height:1.7;">
              {content_html}
            </td>
          </tr>

          <!-- FOOTER -->
          <tr>
            <td style="background:#f8fafc;border-top:1px solid #e2e8f0;padding:24px 32px;text-align:center;">
              <p style="margin:0 0 6px;font-size:14px;font-weight:700;color:#1f2937;">{company}</p>
              {contact_lines}
              <p style="margin:10px 0 0;font-size:11px;color:#9ca3af;">&copy; {year} {company}. All rights reserved.</p>
              {links_html}
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>"""


class EmailService:
    """Service for sending emails"""
    
    def __init__(self):
        self.smtp_server = os.getenv("SMTP_SERVER", "smtp.gmail.com")
        self.smtp_port = int(os.getenv("SMTP_PORT", "587"))
        self.sender_email = os.getenv("SENDER_EMAIL", "noreply@socialmedia.com")
        self.sender_password = os.getenv("SENDER_PASSWORD", "")
        self.app_url = os.getenv("APP_URL", "http://localhost:3000")
    
    def send_password_reset_email(self, to_email: str, full_name: str, reset_token: str, db=None):
        """Send password reset email using branding SMTP config"""
        try:
            from app.services.branding_service import branding_service
            smtp_config = branding_service.get_smtp_config(db) if db else {
                "smtp_server": self.smtp_server,
                "smtp_port": self.smtp_port,
                "smtp_username": self.sender_email,
                "smtp_password": self.sender_password,
                "smtp_from_email": self.sender_email,
                "smtp_from_name": "Social Media Messenger",
                "smtp_use_tls": True,
            }
            
            # Debug: Log SMTP config
            print(f"📧 SMTP Config:")
            print(f"   Server: {smtp_config.get('smtp_server')}")
            print(f"   Port: {smtp_config.get('smtp_port')}")
            print(f"   Username: {smtp_config.get('smtp_username')}")
            print(f"   Password: {'***' if smtp_config.get('smtp_password') else 'EMPTY/NOT SET'}")
            print(f"   From Email: {smtp_config.get('smtp_from_email')}")
            
            branding = _get_email_branding(db)
            app_url = os.getenv("APP_URL", "http://localhost:3000")
            reset_link = f"{app_url}/reset-password?token={reset_token}"
            subject = f"Reset Your Password — {branding['company_name']}"
            content = f"""
                <h2 style="margin:0 0 16px;font-size:20px;color:#111827;">Password Reset Request</h2>
                <p>Hi {full_name},</p>
                <p>We received a request to reset your password. Click the button below to create a new password:</p>
                <p style="margin:28px 0;">
                    <a href="{reset_link}" style="background:{branding['primary_color']};color:#fff;padding:13px 32px;text-decoration:none;border-radius:8px;display:inline-block;font-weight:600;font-size:15px;">
                        Reset Password
                    </a>
                </p>
                <p style="color:#6b7280;font-size:13px;">Or copy and paste this link in your browser:</p>
                <p style="word-break:break-all;background:#f3f4f6;padding:12px 14px;border-radius:8px;font-size:13px;color:#374151;">
                    {reset_link}
                </p>
                <p style="color:#ef4444;font-weight:600;">This link will expire in 1 hour.</p>
                <p style="color:#6b7280;font-size:13px;margin-top:24px;">
                    If you didn't request a password reset, please ignore this email.
                </p>
            """
            html_body = _render_email_template(content, branding)
            # If no SMTP credentials, just log it for development
            if not smtp_config.get("smtp_password"):
                print(f"\n⚠️ No SMTP password configured - Email would be sent (dev mode):")
                print(f"📧 To: {to_email}")
                print(f"Reset link: {reset_link}\n")
                return True
            # Send actual email
            message = MIMEMultipart("alternative")
            message["Subject"] = subject
            message["From"] = smtp_config.get("smtp_from_email", self.sender_email)
            message["To"] = to_email
            message.attach(MIMEText(html_body, "html"))
            
            print(f"📤 Sending email via SMTP to {to_email}...")
            _smtp_cls = smtplib.SMTP_SSL if smtp_config.get("smtp_use_ssl", False) else smtplib.SMTP
            with _smtp_cls(smtp_config["smtp_server"], smtp_config["smtp_port"]) as server:
                if not smtp_config.get("smtp_use_ssl", False) and smtp_config.get("smtp_use_tls", True):
                    server.starttls()
                server.login(smtp_config["smtp_username"], smtp_config["smtp_password"])
                server.sendmail(smtp_config["smtp_from_email"], to_email, message.as_string())
            print(f"✅ Email sent successfully to {to_email}")
            return True
        except Exception as e:
            print(f"❌ Error sending password reset email to {to_email}: {str(e)}")
            import traceback
            traceback.print_exc()
            # In development, log but don't fail
            return True
    
    def send_otp_email(self, to_email: str, full_name: str, otp_code: str, context: str = "login", db=None):
        """Send OTP verification email"""
        try:
            from app.services.branding_service import branding_service
            smtp_config = branding_service.get_smtp_config(db) if db else {
                "smtp_server": self.smtp_server,
                "smtp_port": self.smtp_port,
                "smtp_username": self.sender_email,
                "smtp_password": self.sender_password,
                "smtp_from_email": self.sender_email,
                "smtp_from_name": "Social Media Messenger",
                "smtp_use_tls": True,
            }

            branding = _get_email_branding(db)
            action = "verify your email address" if context == "register" else "complete your login"
            subject = f"Your verification code — {branding['company_name']}"
            content = f"""
                <h2 style="margin:0 0 16px;font-size:20px;color:#111827;">Verification Code</h2>
                <p>Hi {full_name},</p>
                <p>Use the code below to {action}. The code expires in <strong>10 minutes</strong>.</p>
                <div style="margin:28px 0;text-align:center;">
                    <span style="font-size:42px;font-weight:800;letter-spacing:14px;color:{branding['primary_color']};background:#eff6ff;padding:18px 36px;border-radius:12px;display:inline-block;">
                        {otp_code}
                    </span>
                </div>
                <p style="color:#ef4444;font-weight:600;">Do not share this code with anyone.</p>
                <p style="color:#6b7280;font-size:13px;">If you did not request this code, please ignore this email.</p>
            """
            html_body = _render_email_template(content, branding)

            if not smtp_config.get("smtp_password"):
                print(f"\n⚠️  No SMTP password configured - OTP (dev mode):")
                print(f"📧 To: {to_email}")
                print(f"🔑 OTP Code: {otp_code}\n")
                return True

            message = MIMEMultipart("alternative")
            message["Subject"] = subject
            message["From"] = smtp_config.get("smtp_from_email", self.sender_email)
            message["To"] = to_email
            message.attach(MIMEText(html_body, "html"))

            _smtp_cls = smtplib.SMTP_SSL if smtp_config.get("smtp_use_ssl", False) else smtplib.SMTP
            with _smtp_cls(smtp_config["smtp_server"], smtp_config["smtp_port"]) as server:
                if not smtp_config.get("smtp_use_ssl", False) and smtp_config.get("smtp_use_tls", True):
                    server.starttls()
                server.login(smtp_config["smtp_username"], smtp_config["smtp_password"])
                server.sendmail(smtp_config["smtp_from_email"], to_email, message.as_string())
            print(f"✅ OTP email sent to {to_email}")
            return True
        except Exception as e:
            print(f"❌ Error sending OTP email to {to_email}: {str(e)}")
            import traceback
            traceback.print_exc()
            return True

    def send_reminder_share_notification(self, to_email: str, sharer_name: str, reminder, db=None):
        """Send notification email with .ics attachment when a reminder is shared."""
        try:
            from app.services.branding_service import branding_service
            smtp_config = branding_service.get_smtp_config(db) if db else {
                "smtp_server": self.smtp_server,
                "smtp_port": self.smtp_port,
                "smtp_username": self.sender_email,
                "smtp_password": self.sender_password,
                "smtp_from_email": self.sender_email,
                "smtp_from_name": "Social Media Messenger",
                "smtp_use_tls": True,
            }

            if not smtp_config.get("smtp_password"):
                print(f"Dev mode: would send reminder share email to {to_email}")
                return True

            branding = _get_email_branding(db)
            subject = f"{sharer_name} shared a reminder: {reminder.title}"
            due_str = reminder.due_date.strftime("%Y-%m-%d %H:%M") if reminder.due_date else "No due date"
            priority_label = (reminder.priority or "as_usual").replace("_", " ").title()
            app_url = os.getenv("APP_URL", "http://localhost:3000")

            content = f"""
                <h2 style="margin:0 0 16px;font-size:20px;color:#111827;">Reminder Shared With You</h2>
                <p><strong>{sharer_name}</strong> shared a reminder with you:</p>
                <div style="background:#f3f4f6;padding:18px 20px;border-radius:10px;margin:20px 0;border-left:4px solid {branding['primary_color']};">
                    <h3 style="margin:0 0 8px;color:#111827;">{reminder.title}</h3>
                    {f'<p style="margin:4px 0;color:#555;">{reminder.description}</p>' if reminder.description else ''}
                    <p style="margin:6px 0;font-size:13px;"><strong>Priority:</strong> {priority_label}</p>
                    <p style="margin:6px 0;font-size:13px;"><strong>Due:</strong> {due_str}</p>
                </div>
                <p style="margin-top:24px;">
                    <a href="{app_url}/reminders" style="background:{branding['primary_color']};color:#fff;padding:12px 28px;text-decoration:none;border-radius:8px;display:inline-block;font-weight:600;">
                        View in App
                    </a>
                </p>
            """
            html_body = _render_email_template(content, branding)

            message = MIMEMultipart("mixed")
            message["Subject"] = subject
            message["From"] = smtp_config.get("smtp_from_email", self.sender_email)
            message["To"] = to_email

            # HTML body
            html_part = MIMEMultipart("alternative")
            html_part.attach(MIMEText(html_body, "html"))
            message.attach(html_part)

            # .ics attachment
            if reminder.due_date:
                from email.mime.base import MIMEBase
                from email import encoders
                ics_content = self._generate_ics(reminder, sharer_name)
                ics_part = MIMEBase("text", "calendar", method="PUBLISH")
                ics_part.set_payload(ics_content.encode("utf-8"))
                encoders.encode_base64(ics_part)
                ics_part.add_header("Content-Disposition", "attachment", filename="reminder.ics")
                message.attach(ics_part)

            _smtp_cls = smtplib.SMTP_SSL if smtp_config.get("smtp_use_ssl", False) else smtplib.SMTP
            with _smtp_cls(smtp_config["smtp_server"], int(smtp_config["smtp_port"])) as server:
                if not smtp_config.get("smtp_use_ssl", False) and smtp_config.get("smtp_use_tls", True):
                    server.starttls()
                server.login(smtp_config["smtp_username"], smtp_config["smtp_password"])
                server.sendmail(smtp_config["smtp_from_email"], to_email, message.as_string())

            logger.info("Reminder share email sent to %s", to_email)
            return True
        except Exception as e:
            logger.error("Failed to send reminder share email to %s: %s", to_email, e)
            return False

    def _generate_ics(self, reminder, organizer_name: str) -> str:
        """Generate a VCALENDAR/VEVENT string for a reminder."""
        from datetime import timedelta
        start = reminder.due_date
        end = start + timedelta(hours=1)
        uid = f"reminder-{reminder.id}@socialmedia"
        now = datetime.utcnow().strftime("%Y%m%dT%H%M%SZ")
        dtstart = start.strftime("%Y%m%dT%H%M%SZ")
        dtend = end.strftime("%Y%m%dT%H%M%SZ")
        summary = reminder.title.replace(",", "\\,")
        description = (reminder.description or "").replace("\n", "\\n").replace(",", "\\,")

        return (
            "BEGIN:VCALENDAR\r\n"
            "VERSION:2.0\r\n"
            "PRODID:-//SocialMedia//Reminders//EN\r\n"
            "METHOD:PUBLISH\r\n"
            "BEGIN:VEVENT\r\n"
            f"UID:{uid}\r\n"
            f"DTSTAMP:{now}\r\n"
            f"DTSTART:{dtstart}\r\n"
            f"DTEND:{dtend}\r\n"
            f"SUMMARY:{summary}\r\n"
            f"DESCRIPTION:{description}\r\n"
            f"ORGANIZER:CN={organizer_name}\r\n"
            "BEGIN:VALARM\r\n"
            "TRIGGER:-PT15M\r\n"
            "ACTION:DISPLAY\r\n"
            "DESCRIPTION:Reminder\r\n"
            "END:VALARM\r\n"
            "END:VEVENT\r\n"
            "END:VCALENDAR\r\n"
        )

    def send_email_account_request(self, admin_email: str, requester_name: str, requester_email: str, message: str, db=None):
        """Send an email account setup request notification to the admin"""
        try:
            from app.services.branding_service import branding_service
            smtp_config = branding_service.get_smtp_config(db) if db else {
                "smtp_server": self.smtp_server,
                "smtp_port": self.smtp_port,
                "smtp_username": self.sender_email,
                "smtp_password": self.sender_password,
                "smtp_from_email": self.sender_email,
                "smtp_from_name": "Social Media Messenger",
                "smtp_use_tls": True,
            }

            branding = _get_email_branding(db)
            subject = f"Email Account Request from {requester_name}"
            content = f"""
                <h2 style="margin:0 0 16px;font-size:20px;color:#111827;">Email Account Setup Request</h2>
                <p>A user has requested an email account to be configured:</p>
                <table style="width:100%;border-collapse:collapse;margin:20px 0;font-size:14px;">
                    <tr style="background:#f3f4f6;">
                        <td style="padding:11px 14px;font-weight:700;width:140px;border:1px solid #e5e7eb;">Name</td>
                        <td style="padding:11px 14px;border:1px solid #e5e7eb;">{requester_name}</td>
                    </tr>
                    <tr>
                        <td style="padding:11px 14px;font-weight:700;border:1px solid #e5e7eb;">Email</td>
                        <td style="padding:11px 14px;border:1px solid #e5e7eb;">{requester_email}</td>
                    </tr>
                    <tr style="background:#f3f4f6;">
                        <td style="padding:11px 14px;font-weight:700;border:1px solid #e5e7eb;">Message</td>
                        <td style="padding:11px 14px;border:1px solid #e5e7eb;">{message or '(no message provided)'}</td>
                    </tr>
                </table>
                <p>Please log in to the admin panel and configure an email account for this user.</p>
            """
            html_body = _render_email_template(content, branding)

            if not smtp_config.get("smtp_password"):
                print(f"\n⚠️  No SMTP password - Email account request (dev mode):")
                print(f"📧 To: {admin_email}")
                print(f"👤 From user: {requester_name} <{requester_email}>")
                print(f"💬 Message: {message}\n")
                return True

            msg = MIMEMultipart("alternative")
            msg["Subject"] = subject
            msg["From"] = smtp_config.get("smtp_from_email", self.sender_email)
            msg["To"] = admin_email
            msg.attach(MIMEText(html_body, "html"))

            _smtp_cls = smtplib.SMTP_SSL if smtp_config.get("smtp_use_ssl", False) else smtplib.SMTP
            with _smtp_cls(smtp_config["smtp_server"], smtp_config["smtp_port"]) as server:
                if not smtp_config.get("smtp_use_ssl", False) and smtp_config.get("smtp_use_tls", True):
                    server.starttls()
                server.login(smtp_config["smtp_username"], smtp_config["smtp_password"])
                server.sendmail(smtp_config["smtp_from_email"], admin_email, msg.as_string())
            print(f"✅ Account request email sent to admin {admin_email}")
            return True
        except Exception as e:
            print(f"❌ Error sending account request email: {str(e)}")
            return False

    def send_system_email(self, to_email: str, subject: str, html_body: str, db=None):
        """Send a generic system email using branding SMTP config."""
        try:
            from app.services.branding_service import branding_service
            smtp_config = branding_service.get_smtp_config(db) if db else {
                "smtp_server": self.smtp_server,
                "smtp_port": self.smtp_port,
                "smtp_username": self.sender_email,
                "smtp_password": self.sender_password,
                "smtp_from_email": self.sender_email,
                "smtp_from_name": "Social Media Messenger",
                "smtp_use_tls": True,
            }

            if not smtp_config.get("smtp_password"):
                logger.info("No SMTP password configured - system email (dev mode): to=%s subject=%s", to_email, subject)
                return True

            message = MIMEMultipart("alternative")
            message["Subject"] = subject
            message["From"] = smtp_config.get("smtp_from_email", self.sender_email)
            message["To"] = to_email
            message.attach(MIMEText(html_body, "html"))

            _smtp_cls = smtplib.SMTP_SSL if smtp_config.get("smtp_use_ssl", False) else smtplib.SMTP
            with _smtp_cls(smtp_config["smtp_server"], int(smtp_config["smtp_port"])) as server:
                if not smtp_config.get("smtp_use_ssl", False) and smtp_config.get("smtp_use_tls", True):
                    server.starttls()
                server.login(smtp_config["smtp_username"], smtp_config["smtp_password"])
                server.sendmail(smtp_config["smtp_from_email"], to_email, message.as_string())

            logger.info("System email sent to %s: %s", to_email, subject)
            return True
        except Exception as e:
            logger.error("Error sending system email to %s: %s", to_email, e)
            return False

    def send_welcome_email(self, to_email: str, full_name: str, db=None):
        """Send welcome email to new user"""
        try:
            branding = _get_email_branding(db)
            subject = f"Welcome to {branding['company_name']}!"
            content = f"""
                <h2 style="margin:0 0 16px;font-size:20px;color:#111827;">Welcome, {full_name}! 🎉</h2>
                <p>Thank you for creating an account. You can now log in and start using our unified messaging platform.</p>
                <p style="margin:28px 0;">
                    <a href="{self.app_url}/login" style="background:{branding['primary_color']};color:#fff;padding:13px 32px;text-decoration:none;border-radius:8px;display:inline-block;font-weight:600;font-size:15px;">
                        Go to Login
                    </a>
                </p>
                <p style="color:#6b7280;font-size:13px;">
                    Connect your WhatsApp, Facebook, Viber, and LinkedIn accounts to manage all your messages in one place.
                </p>
            """
            html_body = _render_email_template(content, branding)
            
            # If no SMTP credentials, just log it for development
            if not self.sender_password:
                print(f"\n📧 Welcome email would be sent to {to_email}\n")
                return True
            
            # Send actual email
            message = MIMEMultipart("alternative")
            message["Subject"] = subject
            message["From"] = self.sender_email
            message["To"] = to_email
            
            message.attach(MIMEText(html_body, "html"))
            
            with smtplib.SMTP(self.smtp_server, self.smtp_port) as server:
                server.starttls()
                server.login(self.sender_email, self.sender_password)
                server.sendmail(self.sender_email, to_email, message.as_string())
            
            return True
        
        except Exception as e:
            print(f"Error sending email: {e}")
            return True
    
    def sync_emails_from_imap(self, account, db=None):
        """Sync emails from user's email account via IMAP"""
        try:
            from imap_tools import MailBox
            from app.models.email import Email, EmailAttachment
            import hashlib
            
            logger.info(f"🔄 Starting email sync for {account.email_address}")
            
            with MailBox(account.imap_host, account.imap_port).login(
                account.imap_username, account.imap_password
            ) as mailbox:
                # Get folder and fetch recent emails
                mailbox.folder.set('INBOX')
                messages = mailbox.fetch(limit=100, reverse=True)
                
                synced_count = 0
                for msg in messages:
                    if db:
                        # Create a unique identifier for the email (using subject + from + date)
                        email_hash = hashlib.md5(
                            f"{msg.subject or ''}{msg.from_}{msg.date}".encode()
                        ).hexdigest()
                        
                        # Check if email already exists
                        existing = db.query(Email).filter(
                            Email.message_id == email_hash,
                            Email.account_id == account.id
                        ).first()
                        
                        if not existing:
                            # Create new email record
                            email = Email(
                                account_id=account.id,
                                message_id=email_hash,
                                subject=msg.subject or "(No Subject)",
                                from_address=str(msg.from_) if msg.from_ else "Unknown",
                                to_address=", ".join([str(addr) for addr in msg.to]) if msg.to else "",
                                cc=", ".join([str(addr) for addr in msg.cc]) if msg.cc else None,
                                bcc=", ".join([str(addr) for addr in msg.bcc]) if msg.bcc else None,
                                body_text=msg.text or "",
                                body_html=msg.html or "",
                                received_at=_to_utc(msg.date),
                                is_read=False,  # Always treat newly synced emails as unread
                                in_reply_to=getattr(msg, 'in_reply_to', None),
                                references=getattr(msg, 'references', None),
                            )
                            
                            db.add(email)
                            db.flush()

                            # --- Thread assignment by normalized subject ---
                            try:
                                from app.models.email import EmailThread as _EThread
                                norm_subj = re.sub(
                                    r'^\s*(Re|Fwd|Fw|RE|FW|FWD)\s*:\s*', '',
                                    msg.subject or '', flags=re.IGNORECASE
                                ).strip() or '(No Subject)'
                                existing_thread = db.query(_EThread).filter(
                                    _EThread.account_id == account.id,
                                    _EThread.subject == norm_subj,
                                    _EThread.is_archived == False,
                                ).first()
                                if existing_thread:
                                    email.thread_id = existing_thread.id
                                    existing_thread.last_email_at = email.received_at
                                    existing_thread.reply_count = (_EThread.reply_count or 0) + 1
                                    existing_thread.has_unread = True
                                else:
                                    new_thread = _EThread(
                                        account_id=account.id,
                                        subject=norm_subj,
                                        thread_key=norm_subj,
                                        from_address=email.from_address,
                                        to_addresses=email.to_address or '',
                                        first_email_at=email.received_at,
                                        last_email_at=email.received_at,
                                        reply_count=0,
                                    )
                                    db.add(new_thread)
                                    db.flush()
                                    email.thread_id = new_thread.id
                            except Exception as _te:
                                logger.warning(f'Thread assignment failed: {_te}')
                            # --- end thread assignment ---

                            # Store attachments
                            for attachment in msg.attachments:
                                # Save payload to disk
                                saved_path = None
                                if attachment.payload:
                                    attach_dir = os.path.join(
                                        ATTACHMENT_STORAGE_DIR,
                                        str(account.id),
                                        str(email.id)
                                    )
                                    os.makedirs(attach_dir, exist_ok=True)
                                    # Sanitize filename to prevent path traversal
                                    safe_name = re.sub(r'[^\w\-. ]', '_', attachment.filename or 'attachment')
                                    saved_path = os.path.join(attach_dir, safe_name)
                                    with open(saved_path, 'wb') as f:
                                        f.write(attachment.payload)
                                email_attachment = EmailAttachment(
                                    email_id=email.id,
                                    filename=attachment.filename,
                                    content_type=attachment.content_type,
                                    size=len(attachment.payload) if attachment.payload else 0,
                                    file_path=saved_path,
                                )
                                db.add(email_attachment)

                            # --- Bridge incoming email to unified conversation inbox ---
                            # Only bridge if this account has chat integration enabled
                            # AND only update existing open/pending conversations (never auto-create new ones)
                            # This preserves privacy: new senders who haven't raised a ticket won't appear in chat
                            try:
                                if getattr(account, 'chat_integration_enabled', True):
                                    from email.utils import parseaddr as _parse_addr
                                    from app.models.conversation import Conversation
                                    from app.models.message import Message as ConvMsg
                                    import time as _time

                                    raw_from = str(msg.from_) if msg.from_ else ""
                                    contact_display, contact_email = _parse_addr(raw_from)
                                    if not contact_email:
                                        contact_email = raw_from.strip()
                                    contact_email = contact_email.lower()
                                    contact_name = contact_display or contact_email

                                    # Only bridge emails received from others (not our own sent copies)
                                    if contact_email and contact_email != account.email_address.lower():
                                        # Find an EXISTING open/pending email conversation for this sender
                                        # We do NOT create a new conversation here — the sender must have
                                        # already raised a ticket (opened a conversation) for emails to appear in chat.
                                        conv = db.query(Conversation).filter(
                                            Conversation.platform == 'email',
                                            Conversation.contact_id == contact_email,
                                            Conversation.status.in_(['open', 'pending'])
                                        ).first()

                                        if conv:
                                            # Existing conversation found — update it with the new email message
                                            conv.unread_count = (conv.unread_count or 0) + 1
                                            conv.last_message = email.subject or '(No Subject)'
                                            conv.last_message_time = email.received_at

                                            conv_msg = ConvMsg(
                                                conversation_id=conv.id,
                                                sender_id=contact_email,
                                                sender_name=contact_name,
                                                receiver_id=account.email_address,
                                                receiver_name=account.display_name or account.email_address,
                                                message_text=email.body_text or '',
                                                message_type='email',
                                                platform='email',
                                                is_sent=0,
                                                subject=email.subject,
                                                email_id=email.id,
                                            )
                                            db.add(conv_msg)
                                        # else: no existing ticket — silently skip, email is in email inbox only
                            except Exception as _bridge_err:
                                logger.error(f"⚠️ Failed to bridge email to conversation: {_bridge_err}")
                            # ----------------------------------------------------------

                            # --- Auto-reply logic ------------------------------------------
                            try:
                                from app.models.email import EmailAutoReply as _AutoReply
                                auto_reply = db.query(_AutoReply).filter(
                                    _AutoReply.user_id == account.user_id,
                                    _AutoReply.is_enabled == True,
                                ).first()

                                if auto_reply:
                                    # Check skip list (comma-separated emails / @domains)
                                    skip_raw = (auto_reply.skip_if_from or "").lower()
                                    skip_list = [s.strip() for s in skip_raw.split(",") if s.strip()]
                                    sender_lower = email.from_address.lower()
                                    skip_hit = any(
                                        sender_lower == s or sender_lower.endswith(s)
                                        for s in skip_list
                                    )

                                    # Check we haven't already replied to this message
                                    replied_ids = auto_reply.replied_message_ids or []
                                    already_replied = email.message_id in replied_ids

                                    # Don't auto-reply to ourselves
                                    is_self = account.email_address.lower() in sender_lower

                                    if not skip_hit and not already_replied and not is_self:
                                        subject = f"{auto_reply.subject_prefix or 'Re: '}{email.subject}"
                                        reply_body = auto_reply.reply_body or ""

                                        if auto_reply.mode == "ai" and auto_reply.ai_system_prompt:
                                            try:
                                                import os as _os
                                                groq_key = _os.getenv("GROQ_API_KEY", "")
                                                if groq_key:
                                                    import httpx as _httpx
                                                    ai_resp = _httpx.post(
                                                        "https://api.groq.com/openai/v1/chat/completions",
                                                        headers={"Authorization": f"Bearer {groq_key}", "Content-Type": "application/json"},
                                                        json={
                                                            "model": "llama3-8b-8192",
                                                            "messages": [
                                                                {"role": "system", "content": auto_reply.ai_system_prompt},
                                                                {"role": "user", "content": f"Email subject: {email.subject}\n\nEmail body:\n{email.body_text or email.body_html or ''}"},
                                                            ],
                                                            "max_tokens": 512,
                                                        },
                                                        timeout=15,
                                                    )
                                                    ai_data = ai_resp.json()
                                                    ai_text = ai_data["choices"][0]["message"]["content"]
                                                    reply_body = f"<p>{ai_text.replace(chr(10), '<br>')}</p>"
                                                else:
                                                    logger.warning("AI auto-reply: GROQ_API_KEY not set, falling back to fixed reply body")
                                            except Exception as _ai_err:
                                                logger.warning(f"AI auto-reply generation failed: {_ai_err}, falling back to fixed body")

                                        if reply_body:
                                            self.send_email_from_account(
                                                account,
                                                email.from_address,
                                                subject,
                                                reply_body,
                                                in_reply_to=email.message_id,
                                            )
                                            # Mark as replied
                                            auto_reply.replied_message_ids = replied_ids + [email.message_id]
                                            db.add(auto_reply)
                                            logger.info(f"🤖 Auto-replied to {email.from_address} re: {email.subject}")
                            except Exception as _ar_err:
                                logger.warning(f"Auto-reply failed for message {email.message_id}: {_ar_err}")
                            # --- end auto-reply -------------------------------------------

                            synced_count += 1

                
                if db:
                    db.commit()
                    account.last_sync = datetime.utcnow()
                    db.commit()
                
                logger.info(f"✅ Synced {synced_count} new emails for {account.email_address}")
                return synced_count
                
        except Exception as e:
            logger.error(f"❌ Error syncing emails for {account.email_address}: {str(e)}")
            raise
    
    def send_email_from_account(self, account, to_address: str, subject: str, body: str, cc: str = None, bcc: str = None, in_reply_to: str = None):
        """Send email from user's email account via SMTP"""
        try:
            logger.info(f"📧 Sending email from {account.email_address} to {to_address}")
            
            # Create message
            msg = MIMEMultipart('alternative')
            msg['Subject'] = subject
            msg['From'] = f"{account.display_name} <{account.email_address}>" if account.display_name else account.email_address
            msg['To'] = to_address
            if cc:
                msg['Cc'] = cc
            if bcc:
                msg['Bcc'] = bcc
            if in_reply_to:
                msg['In-Reply-To'] = in_reply_to
                msg['References'] = in_reply_to
            
            # Attach body - always send as HTML since we use a rich text editor
            msg.attach(MIMEText(body, 'html'))
            
            # Connect to SMTP with appropriate security based on smtp_security setting
            smtp_security = getattr(account, 'smtp_security', 'STARTTLS').upper()
            
            if smtp_security == 'SSL':
                # Use SMTP_SSL for implicit SSL
                server_class = smtplib.SMTP_SSL
                logger.info(f"Using SSL security for {account.email_address}")
            else:
                # Use SMTP for STARTTLS, TLS, or NONE
                server_class = smtplib.SMTP
            
            with server_class(account.smtp_host, account.smtp_port) as server:
                if smtp_security in ['STARTTLS', 'TLS']:
                    server.starttls()
                    logger.info(f"Using {smtp_security} security for {account.email_address}")
                elif smtp_security == 'NONE':
                    logger.info(f"Using no encryption for {account.email_address}")
                # SSL handled by SMTP_SSL class
                
                server.login(account.smtp_username, account.smtp_password)
                
                recipients = []
                for addr in to_address.split(','):
                    recipients.append(addr.strip())
                if cc:
                    for addr in cc.split(','):
                        recipients.append(addr.strip())
                if bcc:
                    for addr in bcc.split(','):
                        recipients.append(addr.strip())
                
                server.sendmail(account.email_address, recipients, msg.as_string())
            
            logger.info(f"✅ Email sent successfully from {account.email_address}")
            return True
            
        except Exception as e:
            logger.error(f"❌ Error sending email from {account.email_address}: {str(e)}")
            raise
    
    def sync_all_accounts(self, db=None):
        """Sync all active email accounts (for auto-sync)"""
        try:
            if not db:
                logger.warning("⚠️ No database connection provided for auto-sync")
                return 0
            
            from app.models.email import UserEmailAccount
            
            # Get all active accounts
            accounts = db.query(UserEmailAccount).filter(
                UserEmailAccount.is_active == True
            ).all()
            
            total_synced = 0
            for account in accounts:
                try:
                    synced = self.sync_emails_from_imap(account, db)
                    total_synced += synced
                    logger.info(f"✅ Auto-sync: {synced} emails synced for {account.email_address}")
                except Exception as e:
                    logger.error(f"❌ Auto-sync error for {account.email_address}: {str(e)}")
            
            logger.info(f"✅ Auto-sync completed: {total_synced} total emails synced")
            return total_synced
        
        except Exception as e:
            logger.error(f"❌ Error in auto-sync: {str(e)}")
            return 0

# Singleton instance
email_service = EmailService()
