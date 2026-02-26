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
            
            app_url = os.getenv("APP_URL", "http://localhost:3000")
            reset_link = f"{app_url}/reset-password?token={reset_token}"
            subject = "Reset Your Password - Social Media Messenger"
            html_body = f"""
            <html>
                <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
                    <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
                        <h2 style="color: #2563eb;">Password Reset Request</h2>
                        <p>Hi {full_name},</p>
                        <p>We received a request to reset your password. Click the button below to create a new password:</p>
                        <p style="margin: 30px 0;">
                            <a href="{reset_link}" style="background-color: #2563eb; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; display: inline-block;">
                                Reset Password
                            </a>
                        </p>
                        <p>Or copy and paste this link in your browser:</p>
                        <p style="word-break: break-all; background-color: #f3f4f6; padding: 10px; border-radius: 5px;">
                            {reset_link}
                        </p>
                        <p style="color: #ef4444;"><strong>This link will expire in 1 hour.</strong></p>
                        <p style="margin-top: 30px; color: #666;">
                            If you didn't request a password reset, please ignore this email or contact support if you have concerns.
                        </p>
                        <hr style="border: none; border-top: 1px solid #ddd; margin: 30px 0;">
                        <p style="font-size: 12px; color: #999;">
                            © 2026 Social Media Messenger. All rights reserved.
                        </p>
                    </div>
                </body>
            </html>
            """
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
            with smtplib.SMTP(smtp_config["smtp_server"], smtp_config["smtp_port"]) as server:
                if smtp_config.get("smtp_use_tls", True):
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

            action = "verify your email address" if context == "register" else "complete your login"
            subject = f"Your verification code - Social Media Messenger"
            html_body = f"""
            <html>
                <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
                    <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
                        <h2 style="color: #2563eb;">Verification Code</h2>
                        <p>Hi {full_name},</p>
                        <p>Use the code below to {action}. The code expires in <strong>10 minutes</strong>.</p>
                        <div style="margin: 30px 0; text-align: center;">
                            <span style="font-size: 40px; font-weight: bold; letter-spacing: 12px; color: #1d4ed8; background: #eff6ff; padding: 16px 32px; border-radius: 8px; display: inline-block;">
                                {otp_code}
                            </span>
                        </div>
                        <p style="color: #ef4444;">Do not share this code with anyone.</p>
                        <p style="color: #666;">If you did not request this code, please ignore this email.</p>
                        <hr style="border: none; border-top: 1px solid #ddd; margin: 30px 0;">
                        <p style="font-size: 12px; color: #999;">© 2026 Social Media Messenger. All rights reserved.</p>
                    </div>
                </body>
            </html>
            """

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

            with smtplib.SMTP(smtp_config["smtp_server"], smtp_config["smtp_port"]) as server:
                if smtp_config.get("smtp_use_tls", True):
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

            subject = f"Email Account Request from {requester_name}"
            html_body = f"""
            <html>
                <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
                    <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
                        <h2 style="color: #2563eb;">Email Account Setup Request</h2>
                        <p>A user has requested an email account to be configured for them on Social Media Messenger.</p>
                        <table style="width:100%; border-collapse:collapse; margin: 20px 0;">
                            <tr style="background:#f3f4f6;">
                                <td style="padding:10px; font-weight:bold; width:140px;">Name</td>
                                <td style="padding:10px;">{requester_name}</td>
                            </tr>
                            <tr>
                                <td style="padding:10px; font-weight:bold;">Login Email</td>
                                <td style="padding:10px;">{requester_email}</td>
                            </tr>
                            <tr style="background:#f3f4f6;">
                                <td style="padding:10px; font-weight:bold;">Message</td>
                                <td style="padding:10px;">{message or '(no message provided)'}</td>
                            </tr>
                        </table>
                        <p>Please log in to the admin panel and configure an email account for this user.</p>
                        <hr style="border: none; border-top: 1px solid #ddd; margin: 30px 0;">
                        <p style="font-size: 12px; color: #999;">© 2026 Social Media Messenger. All rights reserved.</p>
                    </div>
                </body>
            </html>
            """

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

            with smtplib.SMTP(smtp_config["smtp_server"], smtp_config["smtp_port"]) as server:
                if smtp_config.get("smtp_use_tls", True):
                    server.starttls()
                server.login(smtp_config["smtp_username"], smtp_config["smtp_password"])
                server.sendmail(smtp_config["smtp_from_email"], admin_email, msg.as_string())
            print(f"✅ Account request email sent to admin {admin_email}")
            return True
        except Exception as e:
            print(f"❌ Error sending account request email: {str(e)}")
            return False

    def send_welcome_email(self, to_email: str, full_name: str):
        """Send welcome email to new user"""
        try:
            subject = "Welcome to Social Media Messenger"
            
            html_body = f"""
            <html>
                <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
                    <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
                        <h2 style="color: #2563eb;">Welcome to Social Media Messenger!</h2>
                        
                        <p>Hi {full_name},</p>
                        
                        <p>Thank you for creating an account. You can now log in and start using our unified messaging platform.</p>
                        
                        <p style="margin: 30px 0;">
                            <a href="{self.app_url}/login" style="background-color: #2563eb; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; display: inline-block;">
                                Go to Login
                            </a>
                        </p>
                        
                        <p>You can now connect your WhatsApp, Facebook, Viber, and LinkedIn accounts to manage all your messages in one place.</p>
                        
                        <hr style="border: none; border-top: 1px solid #ddd; margin: 30px 0;">
                        
                        <p style="font-size: 12px; color: #999;">
                            © 2026 Social Media Messenger. All rights reserved.
                        </p>
                    </div>
                </body>
            </html>
            """
            
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
