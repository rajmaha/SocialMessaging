from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from typing import List, Optional
from datetime import datetime
import logging

from app.database import get_db
from app.dependencies import get_current_user
from app.models.user import User
from app.models.todo import Reminder, ReminderShare, ReminderComment
from app.schemas.todo import (
    ReminderCreate, ReminderUpdate, ReminderResponse,
    ReminderReschedule, ReminderStatusUpdate,
    ReminderShareRequest, ReminderShareResponse,
    ReminderCommentCreate, ReminderCommentResponse,
    UnseenCountResponse,
)

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/api/todos",
    tags=["todos"],
    responses={404: {"description": "Not found"}},
)


def _reminder_to_response(reminder: Reminder, db: Session) -> dict:
    """Build response dict with computed fields."""
    owner_name = None
    if reminder.owner:
        owner_name = reminder.owner.display_name or reminder.owner.full_name
    share_count = db.query(ReminderShare).filter(ReminderShare.reminder_id == reminder.id).count()
    comment_count = db.query(ReminderComment).filter(ReminderComment.reminder_id == reminder.id).count()
    return {
        **{c.key: getattr(reminder, c.key) for c in reminder.__table__.columns},
        "owner_name": owner_name,
        "share_count": share_count,
        "comment_count": comment_count,
    }


# ─── Static paths FIRST (before /{reminder_id}) ────────────────────────

@router.get("/shared-with-me", response_model=List[ReminderShareResponse])
def get_shared_with_me(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """List reminders shared with current user."""
    shares = db.query(ReminderShare).filter(
        ReminderShare.shared_with == current_user.id,
    ).order_by(ReminderShare.created_at.desc()).all()

    result = []
    for share in shares:
        sharer_name = None
        if share.sharer:
            sharer_name = share.sharer.display_name or share.sharer.full_name
        reminder = share.reminder
        result.append({
            "id": share.id,
            "reminder_id": share.reminder_id,
            "shared_by": share.shared_by,
            "shared_with": share.shared_with,
            "is_seen": share.is_seen,
            "created_at": share.created_at,
            "sharer_name": sharer_name,
            "reminder_title": reminder.title if reminder else None,
            "reminder_description": reminder.description if reminder else None,
            "reminder_priority": reminder.priority if reminder else None,
            "reminder_due_date": reminder.due_date if reminder else None,
            "reminder_status": reminder.status if reminder else None,
        })
    return result


@router.get("/shared-with-me/unseen-count", response_model=UnseenCountResponse)
def get_unseen_count(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get count of unseen shared reminders (for badge)."""
    count = db.query(ReminderShare).filter(
        ReminderShare.shared_with == current_user.id,
        ReminderShare.is_seen == False,
    ).count()
    return {"count": count}


@router.put("/shared-with-me/{share_id}/seen")
def mark_share_seen(
    share_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Mark a shared reminder as seen."""
    share = db.query(ReminderShare).filter(
        ReminderShare.id == share_id,
        ReminderShare.shared_with == current_user.id,
    ).first()
    if not share:
        raise HTTPException(404, "Share not found")
    share.is_seen = True
    db.commit()
    return {"status": "seen"}


@router.get("/users/internal")
def list_internal_users(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """List all active internal users for share popup."""
    users = db.query(User).filter(
        User.is_active == True,
        User.id != current_user.id,
    ).order_by(User.full_name).all()
    return [
        {
            "id": u.id,
            "full_name": u.full_name,
            "display_name": u.display_name,
            "email": u.email,
            "role": u.role,
            "avatar_url": u.avatar_url,
        }
        for u in users
    ]


# ─── CRUD ───────────────────────────────────────────────────────────────

@router.get("", response_model=List[ReminderResponse])
def list_reminders(
    status: Optional[str] = None,
    priority: Optional[str] = None,
    skip: int = 0,
    limit: int = 100,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """List current user's own reminders with optional filters."""
    q = db.query(Reminder).filter(Reminder.user_id == current_user.id)
    if status:
        q = q.filter(Reminder.status == status)
    if priority:
        q = q.filter(Reminder.priority == priority)
    reminders = q.order_by(Reminder.created_at.desc()).offset(skip).limit(limit).all()
    return [_reminder_to_response(r, db) for r in reminders]


@router.post("", response_model=ReminderResponse, status_code=201)
def create_reminder(
    payload: ReminderCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Create a new reminder. Due date not required when priority=planning."""
    if payload.priority != "planning" and not payload.due_date:
        raise HTTPException(400, "Due date is required unless priority is 'planning'")

    reminder = Reminder(
        user_id=current_user.id,
        title=payload.title,
        description=payload.description,
        priority=payload.priority,
        status="scheduled",
        due_date=payload.due_date,
        original_due_date=payload.due_date,
    )
    db.add(reminder)
    db.commit()
    db.refresh(reminder)

    # Sync to connected calendars
    if payload.due_date:
        _sync_calendar_create(reminder, current_user.id, db)

    return _reminder_to_response(reminder, db)


@router.get("/{reminder_id}", response_model=ReminderResponse)
def get_reminder(
    reminder_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get a single reminder (own or shared with current user)."""
    reminder = db.query(Reminder).filter(Reminder.id == reminder_id).first()
    if not reminder:
        raise HTTPException(404, "Reminder not found")
    # Check access: owner or shared
    if reminder.user_id != current_user.id:
        share = db.query(ReminderShare).filter(
            ReminderShare.reminder_id == reminder_id,
            ReminderShare.shared_with == current_user.id,
        ).first()
        if not share:
            raise HTTPException(403, "Not authorized to view this reminder")
    return _reminder_to_response(reminder, db)


@router.put("/{reminder_id}", response_model=ReminderResponse)
def update_reminder(
    reminder_id: int,
    payload: ReminderUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Update a reminder (owner only)."""
    reminder = db.query(Reminder).filter(
        Reminder.id == reminder_id,
        Reminder.user_id == current_user.id,
    ).first()
    if not reminder:
        raise HTTPException(404, "Reminder not found or not authorized")
    data = payload.model_dump(exclude_unset=True)
    for k, v in data.items():
        setattr(reminder, k, v)
    db.commit()
    db.refresh(reminder)

    # Update calendar event if due_date changed
    if "due_date" in data:
        _sync_calendar_update(reminder, current_user.id, db)

    return _reminder_to_response(reminder, db)


@router.delete("/{reminder_id}", status_code=204)
def delete_reminder(
    reminder_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Delete a reminder (owner only)."""
    reminder = db.query(Reminder).filter(
        Reminder.id == reminder_id,
        Reminder.user_id == current_user.id,
    ).first()
    if not reminder:
        raise HTTPException(404, "Reminder not found or not authorized")
    _sync_calendar_delete(reminder, current_user.id, db)
    db.delete(reminder)
    db.commit()


@router.put("/{reminder_id}/reschedule", response_model=ReminderResponse)
def reschedule_reminder(
    reminder_id: int,
    payload: ReminderReschedule,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Reschedule a reminder to a new date/time."""
    reminder = db.query(Reminder).filter(
        Reminder.id == reminder_id,
        Reminder.user_id == current_user.id,
    ).first()
    if not reminder:
        raise HTTPException(404, "Reminder not found or not authorized")
    reminder.due_date = payload.due_date
    reminder.status = "scheduled"
    db.commit()
    db.refresh(reminder)
    _sync_calendar_update(reminder, current_user.id, db)
    return _reminder_to_response(reminder, db)


@router.put("/{reminder_id}/status", response_model=ReminderResponse)
def update_reminder_status(
    reminder_id: int,
    payload: ReminderStatusUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Change reminder status."""
    reminder = db.query(Reminder).filter(
        Reminder.id == reminder_id,
        Reminder.user_id == current_user.id,
    ).first()
    if not reminder:
        raise HTTPException(404, "Reminder not found or not authorized")
    reminder.status = payload.status
    db.commit()
    db.refresh(reminder)

    # Remove calendar event on completion
    if payload.status == "completed":
        _sync_calendar_delete(reminder, current_user.id, db)

    return _reminder_to_response(reminder, db)


# ─── Sharing ────────────────────────────────────────────────────────────

@router.post("/{reminder_id}/share", status_code=201)
async def share_reminder(
    reminder_id: int,
    payload: ReminderShareRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Share a reminder with selected internal users or all users."""
    reminder = db.query(Reminder).filter(
        Reminder.id == reminder_id,
        Reminder.user_id == current_user.id,
    ).first()
    if not reminder:
        raise HTTPException(404, "Reminder not found or not authorized")

    # Determine target user IDs
    if payload.share_all:
        target_users = db.query(User).filter(
            User.is_active == True,
            User.id != current_user.id,
        ).all()
    else:
        target_ids = [uid for uid in payload.user_ids if uid != current_user.id]
        target_users = db.query(User).filter(User.id.in_(target_ids)).all()

    sharer_name = current_user.display_name or current_user.full_name or current_user.username
    created_shares = []

    for user in target_users:
        # Skip if already shared
        existing = db.query(ReminderShare).filter(
            ReminderShare.reminder_id == reminder_id,
            ReminderShare.shared_with == user.id,
        ).first()
        if existing:
            continue

        share = ReminderShare(
            reminder_id=reminder_id,
            shared_by=current_user.id,
            shared_with=user.id,
        )
        db.add(share)
        created_shares.append(share)

        # Send email notification with .ics
        try:
            from app.services.email_service import email_service
            email_service.send_reminder_share_notification(
                to_email=user.email,
                sharer_name=sharer_name,
                reminder=reminder,
                db=db,
            )
        except Exception as e:
            logger.warning("Failed to send share email to %s: %s", user.email, e)

        # Send WebSocket notification
        try:
            from app.services.events_service import events_service
            await events_service.broadcast_to_user(user.id, {
                "type": "reminder_shared",
                "reminder_id": reminder.id,
                "title": reminder.title,
                "sharer_name": sharer_name,
            })
        except Exception:
            pass

    db.commit()
    return {"shared_with": len(created_shares), "message": f"Shared with {len(created_shares)} user(s)"}


# ─── Comments ───────────────────────────────────────────────────────────

@router.get("/{reminder_id}/comments", response_model=List[ReminderCommentResponse])
def list_comments(
    reminder_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """List comments on a reminder (owner or shared recipient)."""
    reminder = db.query(Reminder).filter(Reminder.id == reminder_id).first()
    if not reminder:
        raise HTTPException(404, "Reminder not found")
    # Access check
    if reminder.user_id != current_user.id:
        share = db.query(ReminderShare).filter(
            ReminderShare.reminder_id == reminder_id,
            ReminderShare.shared_with == current_user.id,
        ).first()
        if not share:
            raise HTTPException(403, "Not authorized")

    comments = db.query(ReminderComment).filter(
        ReminderComment.reminder_id == reminder_id,
    ).order_by(ReminderComment.created_at.asc()).all()

    result = []
    for c in comments:
        author_name = None
        if c.author:
            author_name = c.author.display_name or c.author.full_name
        result.append({
            "id": c.id,
            "reminder_id": c.reminder_id,
            "user_id": c.user_id,
            "content": c.content,
            "created_at": c.created_at,
            "author_name": author_name,
        })
    return result


@router.post("/{reminder_id}/comments", response_model=ReminderCommentResponse, status_code=201)
async def add_comment(
    reminder_id: int,
    payload: ReminderCommentCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Add a comment to a reminder (owner or shared recipient)."""
    reminder = db.query(Reminder).filter(Reminder.id == reminder_id).first()
    if not reminder:
        raise HTTPException(404, "Reminder not found")
    # Access check
    if reminder.user_id != current_user.id:
        share = db.query(ReminderShare).filter(
            ReminderShare.reminder_id == reminder_id,
            ReminderShare.shared_with == current_user.id,
        ).first()
        if not share:
            raise HTTPException(403, "Not authorized")

    comment = ReminderComment(
        reminder_id=reminder_id,
        user_id=current_user.id,
        content=payload.content,
    )
    db.add(comment)
    db.commit()
    db.refresh(comment)

    # Notify the reminder owner if commenter is not the owner
    commenter_name = current_user.display_name or current_user.full_name or current_user.username
    if reminder.user_id != current_user.id:
        try:
            from app.services.events_service import events_service
            await events_service.broadcast_to_user(reminder.user_id, {
                "type": "reminder_comment",
                "reminder_id": reminder.id,
                "title": reminder.title,
                "commenter_name": commenter_name,
            })
        except Exception:
            pass

    return {
        "id": comment.id,
        "reminder_id": comment.reminder_id,
        "user_id": comment.user_id,
        "content": comment.content,
        "created_at": comment.created_at,
        "author_name": commenter_name,
    }


# ─── Calendar sync helpers ──────────────────────────────────────────────

def _sync_calendar_create(reminder: Reminder, user_id: int, db: Session):
    """Create calendar events for connected providers (fire-and-forget)."""
    try:
        from app.services.calendar_service import calendar_service
        calendar_service.create_event(reminder, user_id, db)
    except Exception as e:
        logger.warning("Calendar sync create failed: %s", e)


def _sync_calendar_update(reminder: Reminder, user_id: int, db: Session):
    try:
        from app.services.calendar_service import calendar_service
        calendar_service.update_event(reminder, user_id, db)
    except Exception as e:
        logger.warning("Calendar sync update failed: %s", e)


def _sync_calendar_delete(reminder: Reminder, user_id: int, db: Session):
    try:
        from app.services.calendar_service import calendar_service
        calendar_service.delete_event(reminder, user_id, db)
    except Exception as e:
        logger.warning("Calendar sync delete failed: %s", e)
