"""
Reminder Call Service
=====================
Background job that:
1. Finds due ReminderSchedules (enabled, datetime <= now, status=pending/running)
2. For each phone number, creates/updates a ReminderCallLog
3. Originates a call via AMI → plays the schedule's audio file
4. On no-answer / declined / busy → reschedules up to 5 attempts (1-hour apart)
"""
import logging
import os
from datetime import datetime, timedelta, timezone
from typing import List

logger = logging.getLogger(__name__)

MAX_ATTEMPTS = 5
RETRY_INTERVAL_HOURS = 1

# Statuses that require a retry
RETRY_STATUSES = {"no_answer", "declined", "busy", "failed"}
# Statuses considered terminal (call was received / permanently failed)
TERMINAL_STATUSES = {"answered"}

AUDIO_STORAGE_DIR = os.path.join(
    os.path.dirname(__file__), "..", "..", "audio_storage"
)


def process_due_reminders(db) -> int:
    """
    Main scheduler job: check for due reminders and originate calls.
    Returns the number of call actions taken.
    """
    from app.models.reminder_schedule import ReminderSchedule, ReminderCallLog
    from app.services.ami_service import get_ami_client, get_outbound_channel

    now = datetime.now(timezone.utc)
    count = 0

    try:
        # --- 1. Find newly-due schedules (never started) ---
        due_new = (
            db.query(ReminderSchedule)
            .filter(
                ReminderSchedule.is_enabled == True,
                ReminderSchedule.status == "pending",
                ReminderSchedule.schedule_datetime <= now,
            )
            .all()
        )
        for sched in due_new:
            _create_initial_logs(sched, db)
            sched.status = "running"
        if due_new:
            db.commit()

        # --- 2. Find call logs that need to be called now ---
        pending_logs = (
            db.query(ReminderCallLog)
            .filter(
                ReminderCallLog.call_status.in_(["pending", "no_answer", "declined", "busy", "failed"]),
            )
            .all()
        )

        # Filter: only those with next_retry_at <= now (or None = immediate)
        to_call = [
            log for log in pending_logs
            if log.next_retry_at is None or log.next_retry_at <= now
        ]
        to_call = [log for log in to_call if log.attempt <= MAX_ATTEMPTS]

        if not to_call:
            return count

        # Open a single AMI connection for all calls
        ami = get_ami_client(db)
        ami_available = ami is not None

        for log in to_call:
            try:
                sched = db.query(ReminderSchedule).filter(
                    ReminderSchedule.id == log.schedule_id
                ).first()
                if not sched or not sched.is_enabled:
                    continue

                audio_path = _resolve_audio(sched.audio_file)
                channel = get_outbound_channel(log.phone_number, db)

                log.called_at = now
                log.call_status = "pending"  # Optimistic – will be updated by AMI event

                if ami_available and ami:
                    action_id = ami.originate(
                        channel=channel,
                        application="Playback",
                        app_data=audio_path,
                        callerid=f"Reminder <0000>",
                        timeout=30000,
                    )
                    log.pbx_call_id = action_id
                    logger.info(
                        "Reminder call originated: schedule=%s phone=%s attempt=%s actionID=%s",
                        sched.id, log.phone_number, log.attempt, action_id,
                    )
                else:
                    # Simulate answered in demo mode (no AMI configured)
                    log.call_status = "no_answer"
                    logger.warning(
                        "AMI not available – marking reminder call as no_answer (schedule=%s phone=%s)",
                        sched.id, log.phone_number,
                    )
                    _schedule_retry_or_fail(log, now)

                count += 1
            except Exception as e:
                logger.error("Error originating reminder call for log %s: %s", log.id, e)

        if ami_available and ami:
            ami.logoff()

        db.commit()

        # --- 3. Check schedules where all logs are terminal → mark completed ---
        _finalize_completed_schedules(db)

    except Exception as e:
        logger.error("process_due_reminders error: %s", e)
        try:
            db.rollback()
        except Exception:
            pass

    return count


def update_call_status(db, pbx_call_id: str, status: str):
    """
    Called by AMI event callbacks (or webhook) to update call status.
    status: 'answered' | 'no_answer' | 'declined' | 'busy' | 'failed'
    """
    from app.models.reminder_schedule import ReminderCallLog
    now = datetime.now(timezone.utc)

    log = db.query(ReminderCallLog).filter(
        ReminderCallLog.pbx_call_id == pbx_call_id
    ).first()
    if not log:
        return

    log.call_status = status

    if status in RETRY_STATUSES:
        _schedule_retry_or_fail(log, now)
    else:
        # answered – clear retry
        log.next_retry_at = None

    db.commit()
    _finalize_completed_schedules(db)


# ─── Helpers ────────────────────────────────────────────────────────────────────

def _create_initial_logs(sched, db):
    """Create a ReminderCallLog for each phone number in the schedule."""
    from app.models.reminder_schedule import ReminderCallLog
    existing_phones = {
        row.phone_number
        for row in db.query(ReminderCallLog.phone_number)
        .filter(ReminderCallLog.schedule_id == sched.id)
        .all()
    }
    for phone in (sched.phone_numbers or []):
        phone = phone.strip()
        if phone and phone not in existing_phones:
            log = ReminderCallLog(
                schedule_id=sched.id,
                phone_number=phone,
                attempt=1,
                call_status="pending",
            )
            db.add(log)


def _schedule_retry_or_fail(log, now: datetime):
    """Increment attempt; if under max, schedule retry; else mark terminal."""
    if log.attempt < MAX_ATTEMPTS:
        log.attempt += 1
        log.next_retry_at = now + timedelta(hours=RETRY_INTERVAL_HOURS)
        log.call_status = log.call_status  # keep current (no_answer etc.)
    else:
        log.call_status = "failed"
        log.next_retry_at = None


def _finalize_completed_schedules(db):
    """Mark a schedule as 'completed' when all of its call logs are terminal."""
    from app.models.reminder_schedule import ReminderSchedule, ReminderCallLog
    running_scheds = (
        db.query(ReminderSchedule)
        .filter(ReminderSchedule.status == "running")
        .all()
    )
    for sched in running_scheds:
        logs = (
            db.query(ReminderCallLog)
            .filter(ReminderCallLog.schedule_id == sched.id)
            .all()
        )
        if not logs:
            continue
        non_terminal = [
            l for l in logs
            if l.call_status not in ("answered", "failed")
        ]
        pending = [
            l for l in non_terminal
            if l.attempt <= MAX_ATTEMPTS
        ]
        if not pending:
            sched.status = "completed"
    db.commit()


def _resolve_audio(audio_file: str | None) -> str:
    """
    Return an Asterisk-compatible sound path.
    If audio_file is an absolute path → strip extension (Asterisk convention).
    If relative → prepend audio_storage directory.
    """
    if not audio_file:
        return "beep"  # built-in Asterisk tone if no file configured
    if os.path.isabs(audio_file):
        base, _ = os.path.splitext(audio_file)
        return base
    full = os.path.join(AUDIO_STORAGE_DIR, audio_file)
    base, _ = os.path.splitext(full)
    return base


def get_audio_files() -> list:
    """List all uploaded audio files in audio_storage/ (not TTS cache)."""
    os.makedirs(AUDIO_STORAGE_DIR, exist_ok=True)
    files = []
    for fname in os.listdir(AUDIO_STORAGE_DIR):
        if fname.lower().endswith((".wav", ".mp3", ".gsm", ".ogg", ".ulaw", ".alaw")):
            full = os.path.join(AUDIO_STORAGE_DIR, fname)
            files.append({
                "filename": fname,
                "size_bytes": os.path.getsize(full),
                "path": f"/audio/{fname}",
            })
    return sorted(files, key=lambda f: f["filename"])
