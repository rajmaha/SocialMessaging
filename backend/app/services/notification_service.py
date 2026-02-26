"""
Notification Call Service
=========================
Background job that:
1. Finds due NotificationEntries (schedule_status=enabled, schedule_datetime<=now,
   call_status=pending or retry due)
2. Converts the message text to speech (edge_tts / gTTS / pyttsx3)
3. Originates an AMI call → plays TTS audio
4. On no-answer / declined / busy → reschedules up to 5 cycles (1-hour apart)
"""
import logging
from datetime import datetime, timedelta, timezone

logger = logging.getLogger(__name__)

MAX_RETRIES = 5
RETRY_INTERVAL_HOURS = 1

# Statuses that allow a retry
RETRY_STATUSES = {"no_answer", "declined", "busy", "failed"}


def process_due_notifications(db) -> int:
    """
    Main scheduler job. Returns the number of call actions taken.
    """
    from app.models.notification_entry import NotificationEntry
    from app.services.ami_service import get_ami_client, get_outbound_channel
    from app.services.tts_service import text_to_speech, asterisk_sound_path

    now = datetime.now(timezone.utc)
    count = 0

    try:
        # Fetch all enabled entries whose scheduled time has arrived
        candidates = (
            db.query(NotificationEntry)
            .filter(
                NotificationEntry.schedule_status == "enabled",
                NotificationEntry.schedule_datetime != None,
                NotificationEntry.schedule_datetime <= now,
                NotificationEntry.call_status.in_(
                    ["pending", "no_answer", "declined", "busy", "failed"]
                ),
            )
            .all()
        )

        to_call = []
        for entry in candidates:
            if entry.call_status == "pending":
                to_call.append(entry)
            elif (
                entry.retry_count < MAX_RETRIES
                and entry.next_retry_at
                and entry.next_retry_at <= now
            ):
                to_call.append(entry)

        if not to_call:
            return 0

        ami = get_ami_client(db)
        ami_available = ami is not None

        for entry in to_call:
            try:
                # Generate TTS audio
                audio_abs = text_to_speech(entry.message)
                if not audio_abs:
                    logger.warning("TTS failed for notification %s – skipping", entry.id)
                    continue

                sound_path = asterisk_sound_path(audio_abs)
                channel = get_outbound_channel(entry.phone_no, db)

                entry.call_status = "pending"  # Optimistic reset

                if ami_available and ami:
                    action_id = ami.originate(
                        channel=channel,
                        application="Playback",
                        app_data=sound_path,
                        callerid=f"Notification <0000>",
                        timeout=30000,
                        action_id=f"notif-{entry.id}-r{entry.retry_count}",
                    )
                    entry.pbx_call_id = action_id
                    logger.info(
                        "Notification call originated: id=%s phone=%s retry=%s",
                        entry.id, entry.phone_no, entry.retry_count,
                    )
                else:
                    # No AMI – mark no_answer for retry
                    entry.call_status = "no_answer"
                    _schedule_retry_or_fail(entry, now)
                    logger.warning(
                        "AMI not available – notification %s marked no_answer", entry.id
                    )

                count += 1
            except Exception as e:
                logger.error("Error processing notification %s: %s", entry.id, e)

        if ami_available and ami:
            ami.logoff()

        db.commit()

    except Exception as e:
        logger.error("process_due_notifications error: %s", e)
        try:
            db.rollback()
        except Exception:
            pass

    return count


def update_notification_call_status(db, pbx_call_id: str, status: str):
    """
    Update a notification's call_status based on AMI event result.
    status: 'answered' | 'no_answer' | 'declined' | 'busy' | 'failed'
    """
    from app.models.notification_entry import NotificationEntry
    now = datetime.now(timezone.utc)

    entry = db.query(NotificationEntry).filter(
        NotificationEntry.pbx_call_id == pbx_call_id
    ).first()
    if not entry:
        return

    entry.call_status = status

    if status in RETRY_STATUSES:
        _schedule_retry_or_fail(entry, now)
    else:
        # answered
        entry.next_retry_at = None

    db.commit()


# ─── Helpers ─────────────────────────────────────────────────────────────────

def _schedule_retry_or_fail(entry, now: datetime):
    if entry.retry_count < MAX_RETRIES:
        entry.retry_count += 1
        entry.next_retry_at = now + timedelta(hours=RETRY_INTERVAL_HOURS)
    else:
        entry.call_status = "failed"
        entry.next_retry_at = None
