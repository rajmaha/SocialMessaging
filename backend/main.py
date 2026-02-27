from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from app.database import Base, engine, SessionLocal
from app.config import settings
from app.routes import messages, conversations, auth, accounts, admin, branding, email, events, webchat, bot, webhooks, teams, reports, call_center, telephony, calls, extensions, agent_workspace, reminders, notifications, tickets, dynamic_fields, organizations, cloudpanel, cloudpanel_templates
from app.services.email_service import email_service
from app.services.freepbx_cdr_service import freepbx_cdr_service
from datetime import datetime
import logging
import os
from apscheduler.schedulers.background import BackgroundScheduler

logger = logging.getLogger(__name__)

# Reference to the running asyncio event loop (set at startup) so that the
# background scheduler thread can schedule async coroutines onto it.
_event_loop = None

# Create tables
Base.metadata.create_all(bind=engine)

# Apply any pending column additions that create_all won't handle
def _run_inline_migrations():
    """Safely add columns that may not exist yet (idempotent)."""
    from sqlalchemy import text
    with engine.connect() as conn:
        conn.execute(text(
            "ALTER TABLE branding_settings "
            "ADD COLUMN IF NOT EXISTS allowed_file_types JSON"
        ))
        conn.execute(text(
            "ALTER TABLE branding_settings "
            "ADD COLUMN IF NOT EXISTS max_file_size_mb INTEGER DEFAULT 10"
        ))
        # Bot tables — created by SQLAlchemy, but keep for safety
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS bot_settings (
                id SERIAL PRIMARY KEY,
                enabled BOOLEAN DEFAULT FALSE,
                bot_name VARCHAR DEFAULT 'Support Bot',
                welcome_message TEXT DEFAULT '👋 Hi! I''m the support bot. How can I help you today?',
                handoff_message TEXT DEFAULT 'Let me connect you with a human agent. Someone will be with you shortly.',
                handoff_after INTEGER DEFAULT 3,
                created_at TIMESTAMP DEFAULT NOW(),
                updated_at TIMESTAMP DEFAULT NOW()
            )
        """))
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS bot_qa (
                id SERIAL PRIMARY KEY,
                question TEXT,
                keywords TEXT NOT NULL,
                answer TEXT NOT NULL,
                "order" INTEGER DEFAULT 0,
                enabled BOOLEAN DEFAULT TRUE,
                created_at TIMESTAMP DEFAULT NOW()
            )
        """))
        conn.execute(text("ALTER TABLE bot_qa ADD COLUMN IF NOT EXISTS question TEXT"))
        # Call Center configuration table
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS call_center_settings (
                id SERIAL PRIMARY KEY,
                application_type VARCHAR DEFAULT 'cloud_hosting',
                support_phone VARCHAR,
                support_email VARCHAR,
                working_hours VARCHAR,
                created_at TIMESTAMP DEFAULT NOW(),
                updated_at TIMESTAMP DEFAULT NOW()
            )
        """))
        # Telephony configuration table
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS telephony_settings (
                id SERIAL PRIMARY KEY,
                pbx_type VARCHAR DEFAULT 'asterisk',
                host VARCHAR,
                port INTEGER DEFAULT 5038,
                ami_username VARCHAR,
                ami_secret VARCHAR,
                webrtc_wss_url VARCHAR,
                is_active BOOLEAN DEFAULT FALSE,
                created_at TIMESTAMP DEFAULT NOW(),
                updated_at TIMESTAMP DEFAULT NOW()
            )
        """))
        # FreePBX REST API credentials
        conn.execute(text(
            "ALTER TABLE telephony_settings ADD COLUMN IF NOT EXISTS freepbx_api_key VARCHAR"
        ))
        conn.execute(text(
            "ALTER TABLE telephony_settings ADD COLUMN IF NOT EXISTS freepbx_api_secret VARCHAR"
        ))
        # Call Recordings tracking table
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS call_recordings (
                id SERIAL PRIMARY KEY,
                conversation_id INTEGER REFERENCES conversations(id) ON DELETE SET NULL,
                agent_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
                phone_number VARCHAR NOT NULL,
                direction VARCHAR DEFAULT 'inbound',
                duration_seconds INTEGER DEFAULT 0,
                recording_url VARCHAR,
                pbx_call_id VARCHAR,
                created_at TIMESTAMP DEFAULT NOW()
            )
        """))
        # New CDR-sync columns on call_recordings
        conn.execute(text("ALTER TABLE call_recordings ADD COLUMN IF NOT EXISTS agent_name VARCHAR"))
        conn.execute(text("ALTER TABLE call_recordings ADD COLUMN IF NOT EXISTS disposition VARCHAR DEFAULT 'ANSWERED'"))
        conn.execute(text("ALTER TABLE call_recordings ADD COLUMN IF NOT EXISTS recording_file VARCHAR"))
        # Agent Extensions tracking table
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS agent_extensions (
                id SERIAL PRIMARY KEY,
                user_id INTEGER REFERENCES users(id) ON DELETE CASCADE UNIQUE NOT NULL,
                extension VARCHAR UNIQUE NOT NULL,
                sip_password VARCHAR NOT NULL,
                created_at TIMESTAMP DEFAULT NOW(),
                updated_at TIMESTAMP DEFAULT NOW()
            )
        """))
        # FreePBX extension sync tracking columns
        conn.execute(text(
            "ALTER TABLE agent_extensions ADD COLUMN IF NOT EXISTS is_enabled BOOLEAN NOT NULL DEFAULT TRUE"
        ))
        conn.execute(text(
            "ALTER TABLE agent_extensions ADD COLUMN IF NOT EXISTS freepbx_synced BOOLEAN NOT NULL DEFAULT FALSE"
        ))
        # Agent Workspace Status table
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS agent_status (
                id SERIAL PRIMARY KEY,
                user_id INTEGER REFERENCES users(id) ON DELETE CASCADE UNIQUE NOT NULL,
                status VARCHAR DEFAULT 'offline' NOT NULL,
                updated_at TIMESTAMP DEFAULT NOW()
            )
        """))
        conn.execute(text("ALTER TABLE conversations ADD COLUMN IF NOT EXISTS status VARCHAR DEFAULT 'open'"))
        conn.execute(text("ALTER TABLE conversations ADD COLUMN IF NOT EXISTS assigned_to INTEGER REFERENCES users(id) ON DELETE SET NULL"))
        conn.execute(text("ALTER TABLE users ADD COLUMN IF NOT EXISTS display_name VARCHAR"))
        conn.execute(text("ALTER TABLE conversations ADD COLUMN IF NOT EXISTS assigned_team_id INTEGER REFERENCES teams(id) ON DELETE SET NULL"))
        conn.execute(text("ALTER TABLE conversations ADD COLUMN IF NOT EXISTS category VARCHAR"))
        conn.execute(text("ALTER TABLE conversations ADD COLUMN IF NOT EXISTS first_response_at TIMESTAMP"))
        conn.execute(text("ALTER TABLE conversations ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMP"))
        conn.execute(text("ALTER TABLE conversations ADD COLUMN IF NOT EXISTS rating INTEGER"))
        conn.execute(text("ALTER TABLE conversations ADD COLUMN IF NOT EXISTS rating_comment TEXT"))
        conn.execute(text("ALTER TABLE conversations ADD COLUMN IF NOT EXISTS rated_at TIMESTAMP"))
        # Reminder Call Module
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS reminder_schedules (
                id SERIAL PRIMARY KEY,
                name VARCHAR NOT NULL,
                schedule_datetime TIMESTAMP WITH TIME ZONE NOT NULL,
                audio_file VARCHAR,
                remarks TEXT,
                phone_numbers JSON DEFAULT '[]',
                is_enabled BOOLEAN DEFAULT TRUE,
                status VARCHAR DEFAULT 'pending',
                created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
                updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
            )
        """))
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS reminder_call_logs (
                id SERIAL PRIMARY KEY,
                schedule_id INTEGER NOT NULL REFERENCES reminder_schedules(id) ON DELETE CASCADE,
                phone_number VARCHAR NOT NULL,
                attempt INTEGER DEFAULT 1,
                call_status VARCHAR DEFAULT 'pending',
                pbx_call_id VARCHAR,
                called_at TIMESTAMP WITH TIME ZONE,
                next_retry_at TIMESTAMP WITH TIME ZONE
            )
        """))
        # Notification Module
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS notification_entries (
                id SERIAL PRIMARY KEY,
                account_number VARCHAR,
                name VARCHAR NOT NULL,
                phone_no VARCHAR NOT NULL,
                message TEXT NOT NULL,
                schedule_datetime TIMESTAMP WITH TIME ZONE,
                schedule_status VARCHAR DEFAULT 'enabled',
                call_status VARCHAR DEFAULT 'pending',
                retry_count INTEGER DEFAULT 0,
                next_retry_at TIMESTAMP WITH TIME ZONE,
                pbx_call_id VARCHAR,
                created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
                updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
            )
        """))

        # Backfill thread_id for emails that were synced before threading was introduced
        conn.execute(text("""
            DO $$
            DECLARE
                acct RECORD;
                norm_subj TEXT;
                t_id INTEGER;
                em RECORD;
            BEGIN
                FOR em IN
                    SELECT e.id, e.account_id, e.subject, e.from_address, e.to_address, e.received_at
                    FROM emails e
                    WHERE e.thread_id IS NULL AND e.is_draft = FALSE
                    ORDER BY e.account_id, e.received_at
                LOOP
                    norm_subj := TRIM(REGEXP_REPLACE(COALESCE(em.subject, '(No Subject)'),
                        '^\\s*(Re|Fwd|Fw|RE|FW|FWD)\\s*:\\s*', '', 'gi'));
                    IF norm_subj = '' THEN norm_subj := '(No Subject)'; END IF;

                    SELECT id INTO t_id FROM email_threads
                    WHERE account_id = em.account_id AND subject = norm_subj AND is_archived = FALSE
                    LIMIT 1;

                    IF t_id IS NULL THEN
                        INSERT INTO email_threads
                            (account_id, subject, thread_key, from_address, to_addresses,
                             first_email_at, last_email_at, reply_count, has_unread, is_archived, is_starred,
                             created_at, updated_at)
                        VALUES
                            (em.account_id, norm_subj, norm_subj, em.from_address,
                             COALESCE(em.to_address, ''),
                             em.received_at, em.received_at, 0, FALSE, FALSE, FALSE,
                             NOW(), NOW())
                        RETURNING id INTO t_id;
                    ELSE
                        UPDATE email_threads
                        SET last_email_at = GREATEST(last_email_at, em.received_at),
                            reply_count = reply_count + 1, updated_at = NOW()
                        WHERE id = t_id;
                    END IF;

                    UPDATE emails SET thread_id = t_id WHERE id = em.id;
                END LOOP;
            END $$;
        """))
        conn.commit()

        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS teams (
                id SERIAL PRIMARY KEY,
                name VARCHAR UNIQUE NOT NULL,
                description VARCHAR,
                created_at TIMESTAMP DEFAULT NOW()
            )
        """))
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS team_members (
                team_id INTEGER REFERENCES teams(id) ON DELETE CASCADE,
                user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
                PRIMARY KEY (team_id, user_id)
            )
        """))
        conn.execute(text("ALTER TABLE messages ADD COLUMN IF NOT EXISTS delivery_status VARCHAR DEFAULT 'sent'"))
        conn.execute(text("ALTER TABLE messages ADD COLUMN IF NOT EXISTS email_id INTEGER"))
        conn.execute(text("ALTER TABLE messages ADD COLUMN IF NOT EXISTS subject VARCHAR"))
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS ai_settings (
                id SERIAL PRIMARY KEY,
                enabled BOOLEAN DEFAULT FALSE,
                provider VARCHAR DEFAULT 'none',
                api_key TEXT,
                model_name VARCHAR,
                ollama_url VARCHAR DEFAULT 'http://localhost:11434',
                system_prompt TEXT
            )
        """))
        # Scheduled email columns
        conn.execute(text("ALTER TABLE emails ADD COLUMN IF NOT EXISTS scheduled_at TIMESTAMP"))
        conn.execute(text("ALTER TABLE emails ADD COLUMN IF NOT EXISTS is_scheduled BOOLEAN DEFAULT FALSE"))
        # Snooze column
        conn.execute(text("ALTER TABLE emails ADD COLUMN IF NOT EXISTS snoozed_until TIMESTAMP"))
        # Email rules table
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS email_rules (
                id SERIAL PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users(id),
                name VARCHAR NOT NULL,
                is_active BOOLEAN DEFAULT TRUE,
                conditions JSON DEFAULT '[]',
                actions JSON DEFAULT '[]',
                match_all BOOLEAN DEFAULT TRUE,
                created_at TIMESTAMP DEFAULT NOW(),
                updated_at TIMESTAMP DEFAULT NOW()
            )
        """))
        # CORS allowed origins — admin-configurable list for chat widget embedding
        conn.execute(text(
            "ALTER TABLE branding_settings "
            "ADD COLUMN IF NOT EXISTS cors_allowed_origins JSON DEFAULT '[]'"
        ))
        # Chat integration toggle per email account
        conn.execute(text(
            "ALTER TABLE user_email_accounts "
            "ADD COLUMN IF NOT EXISTS chat_integration_enabled BOOLEAN NOT NULL DEFAULT true"
        ))
        # Tickets enhancements
        conn.execute(text("ALTER TABLE tickets ADD COLUMN IF NOT EXISTS ticket_number VARCHAR UNIQUE"))
        conn.execute(text("ALTER TABLE tickets ADD COLUMN IF NOT EXISTS customer_name VARCHAR"))
        conn.execute(text("ALTER TABLE tickets ADD COLUMN IF NOT EXISTS customer_gender VARCHAR"))
        conn.execute(text("ALTER TABLE tickets ADD COLUMN IF NOT EXISTS category VARCHAR"))
        conn.execute(text("ALTER TABLE tickets ADD COLUMN IF NOT EXISTS forward_target VARCHAR"))
        conn.execute(text("ALTER TABLE tickets ADD COLUMN IF NOT EXISTS forward_reason VARCHAR"))
        
        # Dynamic Fields configuration table
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS dynamic_fields (
                id SERIAL PRIMARY KEY,
                application_type VARCHAR NOT NULL,
                field_name VARCHAR NOT NULL,
                field_label VARCHAR NOT NULL,
                field_type VARCHAR DEFAULT 'text',
                options JSON,
                display_order INTEGER DEFAULT 0,
                is_required BOOLEAN DEFAULT FALSE,
                created_at TIMESTAMP DEFAULT NOW(),
                updated_at TIMESTAMP DEFAULT NOW()
            )
        """))
        conn.commit()

try:
    _run_inline_migrations()
except Exception as _mig_err:
    import logging as _log
    _log.getLogger(__name__).warning("Inline migration skipped: %s", _mig_err)

# Initialize FastAPI app
app = FastAPI(
    title="Social Media Messaging System",
    description="Unified messaging platform for WhatsApp, Facebook, Viber, and LinkedIn",
    version="1.0.0"
)

# Dynamic CORS middleware — reads allowed origins from DB at request time
# so admins can add remote site origins without redeploying.
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request as StarletteRequest
from starlette.responses import Response as StarletteResponse

_STATIC_ORIGINS = [
    "http://localhost:3000",
    "http://localhost:3001",
    "http://localhost:3002",
    "http://127.0.0.1:3000",
    "http://127.0.0.1:3001",
    "http://127.0.0.1:3002",
    settings.FRONTEND_URL,
]


def _get_all_allowed_origins() -> list:
    """Merge static defaults with admin-configured DB origins."""
    try:
        db = SessionLocal()
        from sqlalchemy import text as _text
        row = db.execute(_text(
            "SELECT cors_allowed_origins FROM branding_settings LIMIT 1"
        )).fetchone()
        db.close()
        if row and row[0]:
            db_origins = row[0] if isinstance(row[0], list) else []
            return list(set(_STATIC_ORIGINS + db_origins))
    except Exception:
        pass
    return list(_STATIC_ORIGINS)


class DynamicCORSMiddleware(BaseHTTPMiddleware):
    """CORS middleware that reads allowed origins from the database."""

    async def dispatch(self, request: StarletteRequest, call_next):
        origin = request.headers.get("origin", "")
        allowed = _get_all_allowed_origins()
        origin_allowed = origin in allowed

        # Handle pre-flight OPTIONS request
        if request.method == "OPTIONS":
            resp = StarletteResponse(status_code=204)
            if origin_allowed:
                resp.headers["Access-Control-Allow-Origin"] = origin
                resp.headers["Access-Control-Allow-Credentials"] = "true"
                resp.headers["Access-Control-Allow-Methods"] = "GET, POST, PUT, DELETE, OPTIONS, PATCH"
                resp.headers["Access-Control-Allow-Headers"] = "*"
                resp.headers["Access-Control-Max-Age"] = "3600"
            return resp

        try:
            response = await call_next(request)
        except Exception as exc:
            # Ensure CORS headers are present even for unhandled exceptions
            # so the browser shows the real error instead of a misleading CORS error
            from starlette.responses import JSONResponse
            response = JSONResponse(
                status_code=500,
                content={"detail": str(exc)},
            )
        if origin_allowed:
            response.headers["Access-Control-Allow-Origin"] = origin
            response.headers["Access-Control-Allow-Credentials"] = "true"
            response.headers["Access-Control-Allow-Methods"] = "GET, POST, PUT, DELETE, OPTIONS, PATCH"
            response.headers["Access-Control-Allow-Headers"] = "*"
        return response


app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Allows all origins for general API access (or configure as needed)
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.add_middleware(DynamicCORSMiddleware)

# Include routes
app.include_router(auth.router)
app.include_router(accounts.router)
app.include_router(messages.router)
app.include_router(conversations.router)
app.include_router(admin.router)
app.include_router(branding.router)
app.include_router(teams.router)
app.include_router(reports.router)
app.include_router(email.router)
app.include_router(events.router)
app.include_router(webchat.router)
app.include_router(bot.router)
app.include_router(webhooks.router)
app.include_router(call_center.router)
app.include_router(telephony.router)
app.include_router(calls.router)
app.include_router(extensions.router)
app.include_router(agent_workspace.router)
app.include_router(reminders.router)
app.include_router(notifications.router)
app.include_router(tickets.router)
app.include_router(dynamic_fields.router)
app.include_router(organizations.router)
app.include_router(cloudpanel.router)
app.include_router(cloudpanel_templates.router)

# Serve uploaded avatars
AVATAR_DIR = os.path.join(os.path.dirname(__file__), "avatar_storage")
os.makedirs(AVATAR_DIR, exist_ok=True)
app.mount("/avatars", StaticFiles(directory=AVATAR_DIR), name="avatars")

# Serve reminder audio files
AUDIO_DIR = os.path.join(os.path.dirname(__file__), "audio_storage")
os.makedirs(AUDIO_DIR, exist_ok=True)
app.mount("/audio", StaticFiles(directory=AUDIO_DIR), name="audio")

# Serve message attachments (images, files, documents)
MSG_ATTACH_DIR = os.path.join(os.path.dirname(__file__), "attachment_storage", "messages")
os.makedirs(MSG_ATTACH_DIR, exist_ok=True)
app.mount("/attachments/messages", StaticFiles(directory=MSG_ATTACH_DIR), name="msg_attachments")

# Serve organization logos
LOGO_DIR = os.path.join(os.path.dirname(__file__), "logo_storage")
os.makedirs(LOGO_DIR, exist_ok=True)
app.mount("/logos", StaticFiles(directory=LOGO_DIR), name="logos")

# Auto-sync scheduler
scheduler = None

def auto_sync_emails():
    """Scheduled task to sync all emails and broadcast new-email events."""
    try:
        from app.models import UserEmailAccount
        db = SessionLocal()
        accounts = db.query(UserEmailAccount).filter(UserEmailAccount.is_active == True).all()
        for account in accounts:
            try:
                synced = email_service.sync_emails_from_imap(account, db)
                if synced > 0 and _event_loop and not _event_loop.is_closed():
                    from app.services.events_service import events_service, EventTypes
                    import asyncio
                    asyncio.run_coroutine_threadsafe(
                        events_service.broadcast_to_user(account.user_id, {
                            "type": EventTypes.EMAIL_RECEIVED,
                            "synced_count": synced,
                            "message": f"{synced} new email{'s' if synced > 1 else ''} received",
                        }),
                        _event_loop,
                    )
            except Exception as e:
                logger.error(f"Auto-sync error for {account.email_address}: {str(e)}")
        db.close()
    except Exception as e:
        logger.error(f"Error in scheduled email sync: {str(e)}")


def send_scheduled_emails():
    """Fire off any scheduled emails whose send time has arrived."""
    try:
        from app.models.email import Email as EmailModel
        from app.models import UserEmailAccount
        db = SessionLocal()
        now = datetime.utcnow()
        due = (
            db.query(EmailModel)
            .filter(
                EmailModel.is_scheduled == True,
                EmailModel.is_sent == False,
                EmailModel.scheduled_at != None,
                EmailModel.scheduled_at <= now,
            )
            .all()
        )
        for email in due:
            try:
                # ── Atomic claim ───────────────────────────────────────────────
                # UPDATE … WHERE is_scheduled=True returns the number of rows
                # actually modified. If another process (scheduler or debug
                # endpoint) already claimed this email, the count will be 0 and
                # we skip it — preventing duplicate sends.
                claimed = (
                    db.query(EmailModel)
                    .filter(
                        EmailModel.id == email.id,
                        EmailModel.is_scheduled == True,
                        EmailModel.is_sent == False,
                    )
                    .update({"is_scheduled": False}, synchronize_session="fetch")
                )
                db.commit()
                if claimed == 0:
                    logger.info(f"Scheduled email {email.id} already claimed by another process, skipping")
                    continue
                # ── Send ────────────────────────────────────────────────────────
                account = db.query(UserEmailAccount).filter(
                    UserEmailAccount.id == email.account_id,
                    UserEmailAccount.is_active == True,
                ).first()
                if not account:
                    logger.warning(f"No active account for scheduled email {email.id}, skipping")
                    continue
                email_service.send_email_from_account(
                    account,
                    email.to_address,
                    email.subject or "(no subject)",
                    email.body_html or email.body_text or "",
                    email.cc,
                    email.bcc,
                )
                email.is_sent = True
                email.received_at = now  # record actual send time so Sent folder shows correct timestamp
                db.commit()
                logger.info(f"✅ Scheduled email {email.id} sent to {email.to_address}")
            except Exception as e:
                db.rollback()
                # Restore scheduled flag so it retries next minute
                try:
                    db.query(EmailModel).filter(
                        EmailModel.id == email.id,
                        EmailModel.is_sent == False,
                    ).update({"is_scheduled": True}, synchronize_session="fetch")
                    db.commit()
                except Exception:
                    pass
                logger.error(f"Failed to send scheduled email {email.id}: {str(e)}")
        db.close()
    except Exception as e:
        logger.error(f"Error in send_scheduled_emails: {str(e)}")


def unsnooze_emails():
    """Wake up any snoozed emails whose snooze time has expired."""
    try:
        from app.models.email import Email as EmailModel
        db = SessionLocal()
        now = datetime.utcnow()
        expired = db.query(EmailModel).filter(
            EmailModel.snoozed_until != None,
            EmailModel.snoozed_until <= now,
        ).all()
        for email in expired:
            email.snoozed_until = None
        if expired:
            db.commit()
            logger.info(f"Unsnoozed {len(expired)} email(s)")
        db.close()
    except Exception as e:
        logger.error(f"Error in unsnooze_emails: {str(e)}")


def retry_outbox_emails():
    """Automatically retry sending any emails stuck in the outbox."""
    try:
        from app.models.email import Email as EmailModel
        from app.models import UserEmailAccount
        db = SessionLocal()
        # Only retry emails the user explicitly composed (from_address must match the
        # account's email address). WITHOUT this guard, received inbox emails (which
        # are also stored with is_sent=False) would be picked up and re-sent via SMTP
        # as if they were outgoing emails — causing forwarding of received email.
        accounts = db.query(UserEmailAccount).filter(
            UserEmailAccount.is_active == True
        ).all()
        for account in accounts:
            pending = db.query(EmailModel).filter(
                EmailModel.account_id == account.id,
                EmailModel.from_address == account.email_address,  # MUST be from the account
                EmailModel.is_sent == False,
                EmailModel.is_scheduled == False,
                EmailModel.is_draft == False,
                EmailModel.is_archived == False,
                EmailModel.scheduled_at == None,  # exclude scheduled emails (they have scheduled_at set
                                                  # even after is_scheduled is cleared during the atomic
                                                  # claim — without this, the retry fires on mid-flight
                                                  # scheduled emails and causes double-sends)
                EmailModel.to_address != None,
                EmailModel.to_address != "",
            ).all()
            for email in pending:
                try:
                    email_service.send_email_from_account(
                        account,
                        email.to_address,
                        email.subject or "(no subject)",
                        email.body_html or email.body_text or "",
                        email.cc,
                        email.bcc,
                    )
                    email.is_sent = True
                    email.received_at = datetime.utcnow()
                    db.commit()
                    logger.info(f"✅ Outbox retry: email {email.id} sent to {email.to_address}")
                except Exception as e:
                    logger.warning(f"Outbox retry failed for email {email.id}: {str(e)}")
        db.close()
    except Exception as e:
        logger.error(f"Error in retry_outbox_emails: {str(e)}")


def apply_email_rules(email_obj, db):
    """Apply user inbox rules to a newly synced email."""
    try:
        from app.models.email import EmailRule
        from app.models import UserEmailAccount
        account = db.query(UserEmailAccount).filter(
            UserEmailAccount.id == email_obj.account_id
        ).first()
        if not account:
            return
        rules = db.query(EmailRule).filter(
            EmailRule.user_id == account.user_id,
            EmailRule.is_active == True
        ).all()
        for rule in rules:
            conditions = rule.conditions or []
            results = []
            for cond in conditions:
                field = cond.get("field", "")
                op = cond.get("op", "contains")
                val = (cond.get("value", "") or "").lower()
                if field == "from":
                    target = (email_obj.from_address or "").lower()
                elif field == "subject":
                    target = (email_obj.subject or "").lower()
                elif field == "to":
                    target = (email_obj.to_address or "").lower()
                elif field == "body":
                    target = (email_obj.body_text or email_obj.body_html or "").lower()
                else:
                    target = ""
                if op == "contains":
                    results.append(val in target)
                elif op == "equals":
                    results.append(target == val)
                elif op == "starts_with":
                    results.append(target.startswith(val))
                else:
                    results.append(False)
            matched = all(results) if rule.match_all else any(results)
            if not matched:
                continue
            # Apply actions
            for action in (rule.actions or []):
                atype = action.get("type", "")
                aval = action.get("value", "")
                if atype == "label":
                    labels = list(email_obj.labels or [])
                    if aval and aval not in labels:
                        labels.append(aval)
                        email_obj.labels = labels
                elif atype == "star":
                    email_obj.is_starred = True
                elif atype == "mark_read":
                    email_obj.is_read = True
                elif atype == "move" and aval == "trash":
                    email_obj.is_archived = True
        db.commit()
    except Exception as e:
        logger.error(f"Error applying email rules: {str(e)}")


@app.on_event("startup")
async def startup_event():
    """Initialize background scheduler on startup"""
    global scheduler, _event_loop
    import asyncio
    _event_loop = asyncio.get_event_loop()
    try:
        scheduler = BackgroundScheduler()
        # Run auto-sync every 5 minutes
        scheduler.add_job(auto_sync_emails, 'interval', minutes=5, id='email_auto_sync')
        # Check for due scheduled emails every minute
        scheduler.add_job(send_scheduled_emails, 'interval', minutes=1, id='send_scheduled_emails')
        # Un-snooze emails every minute
        scheduler.add_job(unsnooze_emails, 'interval', minutes=1, id='unsnooze_emails')
        # Auto-retry failed outbox emails every 5 minutes
        scheduler.add_job(retry_outbox_emails, 'interval', minutes=5, id='retry_outbox_emails')
        # Sync FreePBX CDR call records every 5 minutes
        def sync_freepbx_cdr():
            try:
                db = SessionLocal()
                count = freepbx_cdr_service.sync_cdrs_to_db(db)
                if count > 0:
                    logger.info("CDR Sync: %d new records imported", count)
                db.close()
            except Exception as e:
                logger.error("CDR sync error: %s", e)
        scheduler.add_job(sync_freepbx_cdr, 'interval', minutes=5, id='freepbx_cdr_sync')
        # Process due reminder calls every minute
        def run_reminder_calls():
            try:
                from app.services.reminder_service import process_due_reminders
                db = SessionLocal()
                count = process_due_reminders(db)
                if count > 0:
                    logger.info("Reminder calls: %d action(s) taken", count)
                db.close()
            except Exception as e:
                logger.error("Reminder call scheduler error: %s", e)
        scheduler.add_job(run_reminder_calls, 'interval', minutes=1, id='reminder_calls')
        # Process due notification calls every minute
        def run_notification_calls():
            try:
                from app.services.notification_service import process_due_notifications
                db = SessionLocal()
                count = process_due_notifications(db)
                if count > 0:
                    logger.info("Notification calls: %d action(s) taken", count)
                db.close()
            except Exception as e:
                logger.error("Notification call scheduler error: %s", e)
        scheduler.add_job(run_notification_calls, 'interval', minutes=1, id='notification_calls')
        scheduler.start()
        logger.info("✅ Email auto-sync scheduler started (every 5 minutes)")
        logger.info("✅ Scheduled-email sender started (every minute)")
        logger.info("✅ Outbox auto-retry started (every 5 minutes)")
    except Exception as e:
        logger.error(f"Error starting scheduler: {str(e)}")

@app.on_event("shutdown")
def shutdown_event():
    """Shutdown scheduler on app shutdown"""
    global scheduler
    if scheduler:
        scheduler.shutdown()
        logger.info("✅ Email auto-sync scheduler stopped")

@app.get("/health")
def health_check():
    """Health check endpoint"""
    return {"status": "ok", "message": "Social Media Messaging System is running"}


@app.get("/debug/trigger-scheduled")
def debug_trigger_scheduled():
    """Manually trigger send_scheduled_emails and return a detailed report."""
    from app.models.email import Email as EmailModel
    from app.models import UserEmailAccount
    import traceback

    db = SessionLocal()
    now = datetime.utcnow()
    report = {"now_utc": now.isoformat(), "due": [], "errors": []}

    try:
        due = (
            db.query(EmailModel)
            .filter(
                EmailModel.is_scheduled == True,
                EmailModel.is_sent == False,
                EmailModel.scheduled_at != None,
                EmailModel.scheduled_at <= now,
            )
            .all()
        )
        report["due_count"] = len(due)

        # Also show upcoming (not yet due) for context
        upcoming = (
            db.query(EmailModel)
            .filter(
                EmailModel.is_scheduled == True,
                EmailModel.is_sent == False,
                EmailModel.scheduled_at != None,
            )
            .all()
        )
        report["all_scheduled"] = [
            {"id": e.id, "to": e.to_address, "scheduled_at_utc": e.scheduled_at.isoformat() if e.scheduled_at else None, "is_due": e.scheduled_at <= now if e.scheduled_at else False}
            for e in upcoming
        ]

        for email in due:
            entry = {"id": email.id, "to": email.to_address, "scheduled_at_utc": email.scheduled_at.isoformat()}
            try:
                account = db.query(UserEmailAccount).filter(
                    UserEmailAccount.id == email.account_id,
                    UserEmailAccount.is_active == True,
                ).first()
                if not account:
                    entry["error"] = f"No active account found for account_id={email.account_id}"
                    report["errors"].append(entry)
                    continue
                entry["smtp_host"] = account.smtp_host
                entry["smtp_port"] = account.smtp_port
                email_service.send_email_from_account(
                    account, email.to_address,
                    email.subject or "(no subject)",
                    email.body_html or email.body_text or "",
                    email.cc, email.bcc,
                )
                email.is_scheduled = False
                email.is_sent = True
                db.commit()
                entry["status"] = "sent"
                report["due"].append(entry)
            except Exception as e:
                db.rollback()
                entry["error"] = str(e)
                entry["trace"] = traceback.format_exc()
                report["errors"].append(entry)
    except Exception as e:
        report["fatal_error"] = str(e)
        report["trace"] = traceback.format_exc()
    finally:
        db.close()

    return report

@app.get("/")
def root():
    """Root endpoint"""
    return {
        "application": "Social Media Messaging System",
        "version": "1.0.0",
        "docs": "/docs"
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
