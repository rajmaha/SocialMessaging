from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from app.database import Base, engine, SessionLocal
from app.config import settings
from app.models.cloudpanel_site import CloudPanelSite  # noqa: F401 — ensures table creation
from app.routes import messages, conversations, auth, accounts, admin, branding, email, events, webchat, bot, webhooks, teams, reports, call_center, telephony, calls, extensions, agent_workspace, reminders, notifications, tickets, dynamic_fields, organizations, cloudpanel, cloudpanel_templates, individuals, billing, crm
from app.routes import todos as todo_routes, calendar as calendar_routes, calendar_settings as calendar_settings_routes
from app.routes.kb import router as kb_router
from app.routes.campaigns import router as campaigns_router
from app.routes.email_templates import router as email_templates_router
from app.routes.db_migrations import router as db_migrations_router
from app.routes.backups import router as backups_router
from app.models.email_template import CampaignEmailTemplate  # noqa: F401 — ensures table creation
from app.models.db_migration import DbMigration, DbMigrationLog, DbMigrationSchedule  # noqa: F401
from app.models.backup_destination import BackupDestination  # noqa: F401
from app.models.backup_job import BackupJob  # noqa: F401
from app.models.backup_run import BackupRun  # noqa: F401
from app.services.email_service import email_service
from app.services.freepbx_cdr_service import freepbx_cdr_service
from datetime import datetime
import logging
import os
from apscheduler.schedulers.background import BackgroundScheduler

logger = logging.getLogger(__name__)

# ── Email Template Presets ────────────────────────────────────────────────────
_TPL_NEWSLETTER = """<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:20px 0;"><tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.08);">
<tr><td style="background:#4f46e5;padding:32px 40px;text-align:center;">
  <h1 style="color:#fff;margin:0;font-size:24px;font-weight:700;">{{company}}</h1>
  <p style="color:#c7d2fe;margin:8px 0 0;font-size:14px;">Monthly Newsletter</p>
</td></tr>
<tr><td style="padding:32px 40px 16px;">
  <p style="font-size:18px;color:#1f2937;margin:0 0 16px;">Hi {{first_name}},</p>
  <p style="font-size:15px;color:#4b5563;line-height:1.7;margin:0;">Here's what's new this month.</p>
</td></tr>
<tr><td style="padding:0 40px 24px;">
  <div style="border-left:4px solid #4f46e5;padding-left:16px;">
    <h2 style="font-size:17px;color:#1f2937;margin:0 0 8px;">📌 Featured Update</h2>
    <p style="font-size:14px;color:#6b7280;line-height:1.7;margin:0;">Your article content goes here. Share your latest news or product updates.</p>
  </div>
</td></tr>
<tr><td style="padding:0 40px 24px;"><hr style="border:none;border-top:1px solid #e5e7eb;"></td></tr>
<tr><td style="padding:0 40px 32px;">
  <div style="border-left:4px solid #10b981;padding-left:16px;">
    <h2 style="font-size:17px;color:#1f2937;margin:0 0 8px;">💡 Tip of the Month</h2>
    <p style="font-size:14px;color:#6b7280;line-height:1.7;margin:0;">Share a valuable tip here. Keep it concise and actionable.</p>
  </div>
</td></tr>
<tr><td style="padding:0 40px 32px;text-align:center;">
  <a href="#" style="display:inline-block;background:#4f46e5;color:#fff;text-decoration:none;padding:14px 32px;border-radius:6px;font-size:15px;font-weight:600;">Read More →</a>
</td></tr>
<tr><td style="background:#f9fafb;padding:24px 40px;border-top:1px solid #e5e7eb;">
  <p style="font-size:12px;color:#9ca3af;text-align:center;margin:0;">You received this from {{company}}. <a href="{{unsubscribe_link}}" style="color:#6b7280;">Unsubscribe</a></p>
</td></tr>
</table></td></tr></table></body></html>"""

_TPL_PROMOTIONAL = """<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:20px 0;"><tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.08);">
<tr><td style="background:linear-gradient(135deg,#667eea 0%,#764ba2 100%);padding:48px 40px;text-align:center;">
  <div style="display:inline-block;background:rgba(255,255,255,.2);border:2px solid rgba(255,255,255,.5);border-radius:24px;padding:6px 20px;margin-bottom:20px;">
    <span style="color:#fff;font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:1px;">Limited Time Offer</span>
  </div>
  <h1 style="color:#fff;margin:0 0 16px;font-size:36px;font-weight:800;line-height:1.2;">Exclusive Deal<br>Just For You</h1>
  <p style="color:rgba(255,255,255,.85);margin:0;font-size:16px;">Hi {{first_name}}, we have something special for you.</p>
</td></tr>
<tr><td style="padding:40px;text-align:center;">
  <div style="background:#fef3c7;border:2px dashed #f59e0b;border-radius:12px;padding:24px;margin-bottom:32px;">
    <p style="font-size:13px;color:#92400e;margin:0 0 8px;text-transform:uppercase;letter-spacing:1px;font-weight:600;">Your Special Discount</p>
    <p style="font-size:48px;color:#d97706;font-weight:800;margin:0 0 8px;">20% OFF</p>
    <p style="font-size:13px;color:#92400e;margin:0;">Use code: <strong>SPECIAL20</strong></p>
  </div>
  <p style="font-size:15px;color:#4b5563;line-height:1.7;margin:0 0 32px;">Don't miss out on this exclusive offer available for a limited time.</p>
  <a href="#" style="display:inline-block;background:linear-gradient(135deg,#667eea,#764ba2);color:#fff;text-decoration:none;padding:16px 48px;border-radius:50px;font-size:16px;font-weight:700;">Claim Your Offer →</a>
</td></tr>
<tr><td style="background:#f9fafb;padding:24px 40px;border-top:1px solid #e5e7eb;">
  <p style="font-size:12px;color:#9ca3af;text-align:center;margin:0;">© {{company}} · <a href="{{unsubscribe_link}}" style="color:#6b7280;">Unsubscribe</a></p>
</td></tr>
</table></td></tr></table></body></html>"""

_TPL_WELCOME = """<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f0fdf4;font-family:Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f0fdf4;padding:20px 0;"><tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.08);">
<tr><td style="background:#059669;padding:32px 40px;text-align:center;">
  <div style="font-size:40px;margin-bottom:12px;">👋</div>
  <h1 style="color:#fff;margin:0;font-size:26px;font-weight:700;">Welcome to {{company}}!</h1>
</td></tr>
<tr><td style="padding:32px 40px 16px;">
  <p style="font-size:16px;color:#1f2937;margin:0 0 16px;">Hi {{first_name}},</p>
  <p style="font-size:15px;color:#4b5563;line-height:1.7;margin:0;">We're thrilled to have you. Here are a few steps to get started:</p>
</td></tr>
<tr><td style="padding:0 40px 32px;">
  <table width="100%" cellpadding="0" cellspacing="0">
    <tr><td style="padding:12px;background:#f0fdf4;border-radius:8px;font-size:14px;color:#1f2937;"><strong>Step 1:</strong> Complete your profile setup</td></tr>
    <tr><td style="height:8px;"></td></tr>
    <tr><td style="padding:12px;background:#eff6ff;border-radius:8px;font-size:14px;color:#1f2937;"><strong>Step 2:</strong> Explore our features and resources</td></tr>
    <tr><td style="height:8px;"></td></tr>
    <tr><td style="padding:12px;background:#faf5ff;border-radius:8px;font-size:14px;color:#1f2937;"><strong>Step 3:</strong> Reach out if you have any questions</td></tr>
  </table>
</td></tr>
<tr><td style="padding:0 40px 32px;text-align:center;">
  <a href="#" style="display:inline-block;background:#059669;color:#fff;text-decoration:none;padding:14px 40px;border-radius:6px;font-size:15px;font-weight:600;">Get Started →</a>
</td></tr>
<tr><td style="padding:24px 40px 32px;border-top:1px solid #e5e7eb;">
  <p style="font-size:14px;color:#4b5563;margin:0;">Warmly,<br><strong>The {{company}} Team</strong></p>
</td></tr>
<tr><td style="background:#f9fafb;padding:24px 40px;border-top:1px solid #e5e7eb;">
  <p style="font-size:12px;color:#9ca3af;text-align:center;margin:0;">© {{company}} · <a href="{{unsubscribe_link}}" style="color:#6b7280;">Unsubscribe</a></p>
</td></tr>
</table></td></tr></table></body></html>"""

_TPL_FOLLOWUP = """<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;padding:20px 0;"><tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.08);">
<tr><td style="background:#3b82f6;height:4px;"></td></tr>
<tr><td style="padding:40px;">
  <p style="font-size:15px;color:#1f2937;margin:0 0 20px;">Hi {{first_name}},</p>
  <p style="font-size:15px;color:#4b5563;line-height:1.8;margin:0 0 20px;">I wanted to follow up and check in with you. I'd love to see how things are going.</p>
  <p style="font-size:15px;color:#4b5563;line-height:1.8;margin:0 0 32px;">If there's anything I can help you with, I'm just one click away.</p>
  <a href="#" style="display:inline-block;background:#3b82f6;color:#fff;text-decoration:none;padding:14px 36px;border-radius:6px;font-size:15px;font-weight:600;">Let's Chat →</a>
  <p style="font-size:14px;color:#6b7280;margin:32px 0 0;border-top:1px solid #e5e7eb;padding-top:24px;">Best regards,<br><strong style="color:#1f2937;">The {{company}} Team</strong></p>
</td></tr>
<tr><td style="background:#f9fafb;padding:16px 40px;border-top:1px solid #e5e7eb;">
  <p style="font-size:12px;color:#9ca3af;text-align:center;margin:0;"><a href="{{unsubscribe_link}}" style="color:#6b7280;">Unsubscribe</a></p>
</td></tr>
</table></td></tr></table></body></html>"""

_PRESET_TEMPLATES = [
    ("Newsletter", "newsletter", _TPL_NEWSLETTER),
    ("Promotional / Offer", "promotional", _TPL_PROMOTIONAL),
    ("Welcome Email", "welcome", _TPL_WELCOME),
    ("Follow-up", "followup", _TPL_FOLLOWUP),
]

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
        conn.execute(text("ALTER TABLE call_recordings ADD COLUMN IF NOT EXISTS ticket_number VARCHAR"))
        conn.execute(text("ALTER TABLE call_recordings ADD COLUMN IF NOT EXISTS organization_id INTEGER REFERENCES organizations(id) ON DELETE SET NULL"))
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
        # Product / billing tables & columns
        conn.execute(text("ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS stripe_customer_id VARCHAR"))
        conn.execute(text("ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS stripe_subscription_id VARCHAR"))
        conn.execute(text("ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS status VARCHAR DEFAULT 'active'"))
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS pricing_plans (
                id SERIAL PRIMARY KEY,
                name VARCHAR NOT NULL,
                stripe_price_id VARCHAR,
                amount_cents INTEGER NOT NULL,
                currency VARCHAR DEFAULT 'npr',
                interval VARCHAR DEFAULT 'month',
                description TEXT,
                created_at TIMESTAMP DEFAULT NOW(),
                updated_at TIMESTAMP DEFAULT NOW()
            )
        """))
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS usage_events (
                id SERIAL PRIMARY KEY,
                user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
                event_type VARCHAR NOT NULL,
                metadata JSON,
                created_at TIMESTAMP DEFAULT NOW()
            )
        """))
        # seed a couple of default pricing tiers (basic/pro) if none exist
        result = conn.execute(text("SELECT COUNT(*) FROM pricing_plans"))
        count = result.scalar() or 0
        if count == 0:
            # try to use any price IDs from the stripe_settings module
            from app import stripe_settings
            basic_price = stripe_settings.PRICE_IDS.get("basic")
            pro_price = stripe_settings.PRICE_IDS.get("pro")
            conn.execute(text("""
                INSERT INTO pricing_plans (name, stripe_price_id, amount_cents, currency, interval, description)
                VALUES
                  ('Basic', :basic_price, 5000, 'npr', 'month', 'Entry level plan'),
                  ('Pro', :pro_price, 15000, 'npr', 'month', 'Professional tier')
            """), {"basic_price": basic_price, "pro_price": pro_price})
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
        
        # Ticket new columns for customer type, contact person, email
        conn.execute(text("ALTER TABLE tickets ADD COLUMN IF NOT EXISTS customer_type VARCHAR"))
        conn.execute(text("ALTER TABLE tickets ADD COLUMN IF NOT EXISTS contact_person VARCHAR"))
        conn.execute(text("ALTER TABLE tickets ADD COLUMN IF NOT EXISTS customer_email VARCHAR"))
        # Subscription company logo
        conn.execute(text("ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS company_logo_url VARCHAR"))
        # Individuals table (created by SQLAlchemy create_all, but belt-and-suspenders)
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS individuals (
                id SERIAL PRIMARY KEY,
                full_name VARCHAR NOT NULL,
                gender VARCHAR NOT NULL,
                dob DATE,
                phone_numbers JSON DEFAULT '[]',
                address TEXT,
                email VARCHAR,
                social_media JSON DEFAULT '[]',
                is_active INTEGER DEFAULT 1,
                created_at TIMESTAMP DEFAULT NOW(),
                updated_at TIMESTAMP DEFAULT NOW()
            )
        """))
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
        # Todos / Reminders module
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS todos (
                id SERIAL PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                title VARCHAR NOT NULL,
                description TEXT,
                priority VARCHAR NOT NULL DEFAULT 'as_usual',
                status VARCHAR NOT NULL DEFAULT 'scheduled',
                due_date TIMESTAMP WITH TIME ZONE,
                original_due_date TIMESTAMP WITH TIME ZONE,
                google_event_id VARCHAR,
                microsoft_event_id VARCHAR,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
                updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
            )
        """))
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS reminder_shares (
                id SERIAL PRIMARY KEY,
                reminder_id INTEGER NOT NULL REFERENCES todos(id) ON DELETE CASCADE,
                shared_by INTEGER NOT NULL REFERENCES users(id),
                shared_with INTEGER NOT NULL REFERENCES users(id),
                is_seen BOOLEAN DEFAULT FALSE,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
            )
        """))
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS reminder_comments (
                id SERIAL PRIMARY KEY,
                reminder_id INTEGER NOT NULL REFERENCES todos(id) ON DELETE CASCADE,
                user_id INTEGER NOT NULL REFERENCES users(id),
                content TEXT NOT NULL,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
            )
        """))
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS user_calendar_connections (
                id SERIAL PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                provider VARCHAR NOT NULL,
                access_token TEXT,
                refresh_token TEXT,
                token_expires_at TIMESTAMP WITH TIME ZONE,
                calendar_id VARCHAR,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
                updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
            )
        """))
        # Calendar integration settings (admin-configurable OAuth credentials)
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS calendar_integration_settings (
                id SERIAL PRIMARY KEY,
                google_enabled BOOLEAN DEFAULT FALSE,
                google_client_id VARCHAR,
                google_client_secret VARCHAR,
                microsoft_enabled BOOLEAN DEFAULT FALSE,
                microsoft_client_id VARCHAR,
                microsoft_client_secret VARCHAR,
                microsoft_tenant_id VARCHAR DEFAULT 'common',
                created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
                updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
            )
        """))
        # CRM Module Tables
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS leads (
                id SERIAL PRIMARY KEY,
                first_name VARCHAR NOT NULL,
                last_name VARCHAR,
                email VARCHAR UNIQUE,
                phone VARCHAR,
                company VARCHAR,
                position VARCHAR,
                status VARCHAR DEFAULT 'new',
                source VARCHAR DEFAULT 'other',
                assigned_to INTEGER REFERENCES users(id) ON DELETE SET NULL,
                score INTEGER DEFAULT 0,
                estimated_value FLOAT,
                conversation_id INTEGER REFERENCES conversations(id) ON DELETE SET NULL,
                organization_id INTEGER REFERENCES organizations(id) ON DELETE SET NULL,
                created_at TIMESTAMP DEFAULT NOW(),
                updated_at TIMESTAMP DEFAULT NOW()
            )
        """))
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS deals (
                id SERIAL PRIMARY KEY,
                lead_id INTEGER NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
                name VARCHAR NOT NULL,
                description TEXT,
                stage VARCHAR DEFAULT 'prospect',
                amount FLOAT,
                probability INTEGER DEFAULT 50,
                expected_close_date TIMESTAMP,
                closed_at TIMESTAMP,
                assigned_to INTEGER REFERENCES users(id) ON DELETE SET NULL,
                created_at TIMESTAMP DEFAULT NOW(),
                updated_at TIMESTAMP DEFAULT NOW()
            )
        """))
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS crm_tasks (
                id SERIAL PRIMARY KEY,
                lead_id INTEGER NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
                deal_id INTEGER REFERENCES deals(id) ON DELETE CASCADE,
                title VARCHAR NOT NULL,
                description TEXT,
                status VARCHAR DEFAULT 'open',
                assigned_to INTEGER REFERENCES users(id) ON DELETE SET NULL,
                due_date TIMESTAMP,
                created_at TIMESTAMP DEFAULT NOW(),
                updated_at TIMESTAMP DEFAULT NOW(),
                completed_at TIMESTAMP
            )
        """))
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS crm_activities (
                id SERIAL PRIMARY KEY,
                lead_id INTEGER NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
                type VARCHAR NOT NULL,
                title VARCHAR NOT NULL,
                description TEXT,
                message_id INTEGER REFERENCES messages(id) ON DELETE SET NULL,
                created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
                created_at TIMESTAMP DEFAULT NOW(),
                activity_date TIMESTAMP DEFAULT NOW()
            )
        """))
        # Extend LeadSource enum with new source types (idempotent)
        for _src in [
            "search_engine", "facebook_post", "facebook_boost", "linkedin",
            "x_post", "email_marketing", "word_of_mouth", "local_agent",
            "staff_reference", "phone_call", "existing_client", "client_reference",
        ]:
            try:
                conn.execute(text(f"ALTER TYPE leadsource ADD VALUE IF NOT EXISTS '{_src}'"))
            except Exception:
                pass
        conn.commit()

    with engine.connect() as conn:
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS kb_articles (
                id SERIAL PRIMARY KEY,
                title VARCHAR(500) NOT NULL,
                slug VARCHAR(500) UNIQUE NOT NULL,
                content_html TEXT NOT NULL,
                category VARCHAR(255),
                published BOOLEAN DEFAULT FALSE NOT NULL,
                views INTEGER DEFAULT 0 NOT NULL,
                created_at TIMESTAMPTZ DEFAULT NOW(),
                updated_at TIMESTAMPTZ
            )
        """))
        conn.commit()

    with engine.connect() as conn:
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS campaigns (
                id SERIAL PRIMARY KEY,
                name VARCHAR(255) NOT NULL,
                subject VARCHAR(500) NOT NULL,
                body_html TEXT NOT NULL,
                status VARCHAR(50) DEFAULT 'draft' NOT NULL,
                target_filter JSONB DEFAULT '{}',
                scheduled_at TIMESTAMPTZ,
                sent_at TIMESTAMPTZ,
                sent_count INTEGER DEFAULT 0,
                opened_count INTEGER DEFAULT 0,
                created_by INTEGER REFERENCES users(id),
                created_at TIMESTAMPTZ DEFAULT NOW(),
                updated_at TIMESTAMPTZ
            )
        """))
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS campaign_recipients (
                id SERIAL PRIMARY KEY,
                campaign_id INTEGER REFERENCES campaigns(id) ON DELETE CASCADE,
                lead_id INTEGER REFERENCES leads(id) ON DELETE CASCADE,
                email VARCHAR(255) NOT NULL,
                name VARCHAR(255),
                sent_at TIMESTAMPTZ,
                opened_at TIMESTAMPTZ,
                open_count INTEGER DEFAULT 0
            )
        """))
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS campaign_email_templates (
                id SERIAL PRIMARY KEY,
                name VARCHAR(200) NOT NULL,
                category VARCHAR(50) NOT NULL,
                is_preset BOOLEAN NOT NULL DEFAULT FALSE,
                body_html TEXT NOT NULL,
                created_at TIMESTAMPTZ DEFAULT NOW()
            )
        """))
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS db_migrations (
                id SERIAL PRIMARY KEY,
                filename VARCHAR NOT NULL,
                file_path VARCHAR NOT NULL,
                description VARCHAR,
                domain_suffix VARCHAR,
                uploaded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
            )
        """))
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS db_migration_logs (
                id SERIAL PRIMARY KEY,
                migration_id INTEGER NOT NULL REFERENCES db_migrations(id) ON DELETE CASCADE,
                site_id INTEGER NOT NULL REFERENCES cloudpanel_sites(id) ON DELETE CASCADE,
                server_id INTEGER NOT NULL REFERENCES cloudpanel_servers(id) ON DELETE CASCADE,
                status VARCHAR NOT NULL DEFAULT 'pending',
                error_message TEXT,
                executed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
            )
        """))
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS db_migration_schedules (
                id SERIAL PRIMARY KEY,
                server_id INTEGER NOT NULL UNIQUE REFERENCES cloudpanel_servers(id) ON DELETE CASCADE,
                interval_minutes INTEGER NOT NULL DEFAULT 1440,
                enabled BOOLEAN NOT NULL DEFAULT FALSE,
                last_run_at TIMESTAMP WITH TIME ZONE
            )
        """))
        # v2: replace interval_minutes with structured schedule fields
        conn.execute(text("""
            ALTER TABLE db_migration_schedules
                ADD COLUMN IF NOT EXISTS schedule_type        VARCHAR   NOT NULL DEFAULT 'recurring',
                ADD COLUMN IF NOT EXISTS run_at               TIMESTAMPTZ,
                ADD COLUMN IF NOT EXISTS day_of_week          INTEGER,
                ADD COLUMN IF NOT EXISTS time_of_day          VARCHAR,
                ADD COLUMN IF NOT EXISTS notify_emails        TEXT,
                ADD COLUMN IF NOT EXISTS notify_hours_before  INTEGER   NOT NULL DEFAULT 24,
                ADD COLUMN IF NOT EXISTS status               VARCHAR   NOT NULL DEFAULT 'scheduled'
        """))
        conn.commit()

        # Tracking enrichment columns for campaign_recipients
        for _col_sql in [
            "ALTER TABLE campaign_recipients ADD COLUMN IF NOT EXISTS country VARCHAR(100)",
            "ALTER TABLE campaign_recipients ADD COLUMN IF NOT EXISTS city VARCHAR(100)",
            "ALTER TABLE campaign_recipients ADD COLUMN IF NOT EXISTS device_type VARCHAR(50)",
            "ALTER TABLE campaign_recipients ADD COLUMN IF NOT EXISTS email_client VARCHAR(100)",
        ]:
            conn.execute(text(_col_sql))
        conn.commit()

        # Backup system — guard for future column additions
        conn.execute(text("""
            ALTER TABLE backup_jobs
            ADD COLUMN IF NOT EXISTS notify_on_failure_emails JSON DEFAULT '[]'::json
        """))
        conn.commit()

        # Seed preset templates once
        preset_count = conn.execute(
            text("SELECT COUNT(*) FROM campaign_email_templates WHERE is_preset = TRUE")
        ).scalar()
        if preset_count == 0:
            for tpl_name, tpl_category, tpl_html in _PRESET_TEMPLATES:
                conn.execute(text("""
                    INSERT INTO campaign_email_templates (name, category, is_preset, body_html)
                    VALUES (:name, :category, TRUE, :body_html)
                """), {"name": tpl_name, "category": tpl_category, "body_html": tpl_html})
            conn.commit()

try:
    _run_inline_migrations()
except Exception as _mig_err:
    import logging as _log
    _log.getLogger(__name__).warning("Inline migration skipped: %s", _mig_err)

def _backfill_call_records_for_tickets():
    """
    One-time backfill: ensure every origin ticket (no parent_ticket_id)
    has at least one call record pointing to it via ticket_number.
    Also fix call records that have ticket_number=None by matching
    them to the closest origin ticket by timestamp.
    """
    from app.models.ticket import Ticket
    from app.models.call_records import CallRecording
    from datetime import timedelta
    db = SessionLocal()
    try:
        # 1. Fix call records with ticket_number=None
        orphan_calls = db.query(CallRecording).filter(
            CallRecording.ticket_number == None  # noqa: E711
        ).all()
        for call in orphan_calls:
            closest = db.query(Ticket).filter(
                Ticket.phone_number == call.phone_number,
                Ticket.parent_ticket_id == None,  # noqa: E711
                Ticket.created_at >= call.created_at - timedelta(minutes=30),
                Ticket.created_at <= call.created_at + timedelta(minutes=30),
            ).order_by(Ticket.created_at).first()
            if closest:
                # Only link if no other call record already points to this ticket
                already_linked = db.query(CallRecording).filter(
                    CallRecording.ticket_number == closest.ticket_number
                ).first()
                if not already_linked:
                    call.ticket_number = closest.ticket_number
                    logger.info("Backfill: linked call %d -> ticket %s", call.id, closest.ticket_number)
                else:
                    # Orphan call is a duplicate; remove it
                    db.delete(call)
                    logger.info("Backfill: removed orphan call %d (ticket %s already covered)", call.id, closest.ticket_number)

        db.flush()

        # 2. Create missing call records for origin tickets that have none
        origin_tickets = db.query(Ticket).filter(
            Ticket.parent_ticket_id == None  # noqa: E711
        ).all()
        for ticket in origin_tickets:
            existing = db.query(CallRecording).filter(
                CallRecording.ticket_number == ticket.ticket_number
            ).first()
            if not existing:
                new_call = CallRecording(
                    agent_id=ticket.assigned_to,
                    agent_name=None,
                    phone_number=ticket.phone_number,
                    organization_id=ticket.organization_id,
                    direction="inbound",
                    disposition="ANSWERED",
                    duration_seconds=0,
                    ticket_number=ticket.ticket_number,
                )
                db.add(new_call)
                db.flush()
                new_call.created_at = ticket.created_at
                logger.info("Backfill: created call record for ticket %s", ticket.ticket_number)

        db.commit()
    except Exception as e:
        db.rollback()
        logger.warning("Backfill call records skipped: %s", e)
    finally:
        db.close()

try:
    _backfill_call_records_for_tickets()
except Exception as _bf_err:
    logger.warning("Backfill skipped: %s", _bf_err)

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
app.include_router(billing.router)
app.include_router(crm.router)
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
app.include_router(individuals.router)
app.include_router(todo_routes.router)
app.include_router(calendar_routes.router)
app.include_router(calendar_settings_routes.router)
app.include_router(kb_router)
app.include_router(campaigns_router)
app.include_router(email_templates_router)
app.include_router(db_migrations_router)
app.include_router(backups_router)

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

# Serve subscription company logos
SUB_LOGO_DIR = os.path.join(os.path.dirname(__file__), "subscription_logo_storage")
os.makedirs(SUB_LOGO_DIR, exist_ok=True)
app.mount("/subscription-logos", StaticFiles(directory=SUB_LOGO_DIR), name="subscription_logos")

# Serve nothing from migration_storage — files are private SQL, not served publicly
MIGRATION_DIR = os.path.join(os.path.dirname(__file__), "migration_storage")
os.makedirs(MIGRATION_DIR, exist_ok=True)

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
        # Check for overdue reminders every minute
        def check_overdue_reminders():
            try:
                from app.models.todo import Reminder
                from app.services.events_service import events_service
                import asyncio
                db = SessionLocal()
                now = datetime.utcnow()
                overdue = db.query(Reminder).filter(
                    Reminder.status == "scheduled",
                    Reminder.due_date != None,
                    Reminder.due_date <= now,
                ).all()
                for r in overdue:
                    r.status = "pending"
                    if _event_loop and not _event_loop.is_closed():
                        asyncio.run_coroutine_threadsafe(
                            events_service.broadcast_to_user(r.user_id, {
                                "type": "reminder_due",
                                "reminder_id": r.id,
                                "title": r.title,
                            }),
                            _event_loop,
                        )
                if overdue:
                    db.commit()
                    logger.info("Marked %d reminder(s) as pending (overdue)", len(overdue))
                db.close()
            except Exception as e:
                logger.error("Overdue reminders check error: %s", e)
        scheduler.add_job(check_overdue_reminders, 'interval', minutes=1, id='check_overdue_reminders')

        def check_overdue_crm_tasks():
            """Broadcast CRM_TASK_OVERDUE for any open/in_progress tasks past their due date."""
            from app.models.crm import Task as CrmTask
            from app.services.events_service import events_service, EventTypes
            from datetime import datetime
            import asyncio

            db = SessionLocal()
            try:
                now = datetime.utcnow()
                overdue = db.query(CrmTask).filter(
                    CrmTask.due_date < now,
                    CrmTask.status.in_(["open", "in_progress"]),
                ).all()

                for task in overdue:
                    event = EventTypes.create_event(
                        EventTypes.CRM_TASK_OVERDUE,
                        {
                            "task_id": task.id,
                            "task_title": task.title,
                            "lead_id": task.lead_id,
                            "due_date": task.due_date.isoformat() if task.due_date else None,
                        },
                    )
                    if task.assigned_to:
                        try:
                            loop = asyncio.get_event_loop()
                            if loop.is_running():
                                asyncio.run_coroutine_threadsafe(
                                    events_service.broadcast_to_user(task.assigned_to, event),
                                    loop,
                                )
                        except Exception as e:
                            logger.warning(f"CRM task overdue broadcast error: {e}")
            except Exception as e:
                logger.error(f"check_overdue_crm_tasks error: {e}")
            finally:
                db.close()

        scheduler.add_job(check_overdue_crm_tasks, 'interval', minutes=5, id='check_overdue_crm_tasks')

        # Refresh expiring calendar tokens every 30 minutes
        def refresh_calendar_tokens():
            try:
                from app.services.calendar_service import calendar_service
                db = SessionLocal()
                count = calendar_service.refresh_all_expiring_tokens(db)
                if count > 0:
                    logger.info("Refreshed %d calendar token(s)", count)
                db.close()
            except Exception as e:
                logger.error("Calendar token refresh error: %s", e)
        scheduler.add_job(refresh_calendar_tokens, 'interval', minutes=30, id='refresh_calendar_tokens')

        def send_scheduled_campaigns():
            """Fire campaigns whose scheduled_at has passed and status is 'scheduled'."""
            from app.models.campaign import Campaign
            from app.routes.campaigns import _do_send
            db = SessionLocal()
            try:
                now = datetime.utcnow()
                due = db.query(Campaign).filter(
                    Campaign.status == "scheduled",
                    Campaign.scheduled_at <= now,
                ).all()
                for campaign in due:
                    try:
                        _do_send(campaign.id, db)
                    except Exception as e:
                        logger.error(f"Campaign send error (id={campaign.id}): {e}")
            except Exception as e:
                logger.error(f"send_scheduled_campaigns error: {e}")
            finally:
                db.close()

        scheduler.add_job(send_scheduled_campaigns, 'interval', minutes=1, id='send_scheduled_campaigns_job')

        def run_due_backup_jobs():
            """Poll BackupJob table every minute and run jobs whose next_run_at is due."""
            from app.database import SessionLocal
            from app.models.backup_job import BackupJob
            from app.services.backup_engine import backup_engine
            from datetime import datetime, timezone, timedelta
            from croniter import croniter

            db = SessionLocal()
            try:
                now = datetime.now(timezone.utc)
                due_jobs = db.query(BackupJob).filter(
                    BackupJob.is_active == True,
                    BackupJob.next_run_at != None,
                    BackupJob.next_run_at <= now
                ).all()
                for job in due_jobs:
                    try:
                        backup_engine.run(job.id, db)
                        # Update next_run_at
                        if job.schedule_type == "interval" and job.schedule_interval_hours:
                            job.next_run_at = now + timedelta(hours=job.schedule_interval_hours)
                        elif job.schedule_type == "cron" and job.schedule_cron:
                            job.next_run_at = croniter(job.schedule_cron, now).get_next(datetime)
                        else:
                            job.next_run_at = None
                        db.commit()
                    except Exception as e:
                        logger.error(f"Scheduled backup job {job.id} error: {e}")
            finally:
                db.close()

        scheduler.add_job(run_due_backup_jobs, 'interval', minutes=1, id='run_due_backup_jobs')
        scheduler.start()

        # Wire scheduler reference for routes
        import app.scheduler_ref as _sched_ref
        _sched_ref.scheduler = scheduler

        # Load DB migration schedules and register jobs
        from app.services.migration_service import run_server_migrations_job, register_migration_jobs
        register_migration_jobs(scheduler)
        logger.info("✅ DB migration scheduler jobs loaded")

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
