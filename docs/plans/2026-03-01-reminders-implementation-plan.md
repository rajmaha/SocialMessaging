# Reminders (Todos) Module — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a personal reminders/todos module with priority levels, scheduling, internal sharing with comments, calendar sync (Google + Microsoft), and social media sharing.

**Architecture:** New SQLAlchemy models (Reminder, ReminderShare, ReminderComment, UserCalendarConnection) with a FastAPI route module, background APScheduler jobs for overdue detection and token refresh, WebSocket notifications for real-time badge updates, and a Next.js frontend page with modals.

**Tech Stack:** FastAPI, SQLAlchemy 2.0, PostgreSQL, APScheduler, Google Calendar API, Microsoft Graph API, Next.js 14, TailwindCSS, react-icons, Web Share API.

---

## Task 1: Backend Models

**Files:**
- Create: `backend/app/models/todo.py`
- Create: `backend/app/models/calendar_connection.py`

**Step 1: Create the Reminder, ReminderShare, ReminderComment models**

Create `backend/app/models/todo.py`:

```python
from sqlalchemy import Column, Integer, String, Text, DateTime, Boolean, ForeignKey
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
import enum
from app.database import Base


class ReminderPriority(str, enum.Enum):
    PLANNING = "planning"
    LOW = "low"
    AS_USUAL = "as_usual"
    URGENT = "urgent"


class ReminderStatus(str, enum.Enum):
    SCHEDULED = "scheduled"
    PENDING = "pending"
    COMPLETED = "completed"


class Reminder(Base):
    __tablename__ = "todos"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    title = Column(String, nullable=False)
    description = Column(Text, nullable=True)
    priority = Column(String, nullable=False, default="as_usual")
    status = Column(String, nullable=False, default="scheduled")
    due_date = Column(DateTime(timezone=True), nullable=True)
    original_due_date = Column(DateTime(timezone=True), nullable=True)
    google_event_id = Column(String, nullable=True)
    microsoft_event_id = Column(String, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    owner = relationship("User", foreign_keys=[user_id], backref="todos")
    shares = relationship("ReminderShare", back_populates="reminder", cascade="all, delete-orphan")
    comments = relationship("ReminderComment", back_populates="reminder", cascade="all, delete-orphan")


class ReminderShare(Base):
    __tablename__ = "reminder_shares"

    id = Column(Integer, primary_key=True, index=True)
    reminder_id = Column(Integer, ForeignKey("todos.id", ondelete="CASCADE"), nullable=False)
    shared_by = Column(Integer, ForeignKey("users.id"), nullable=False)
    shared_with = Column(Integer, ForeignKey("users.id"), nullable=False)
    is_seen = Column(Boolean, default=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    reminder = relationship("Reminder", back_populates="shares")
    sharer = relationship("User", foreign_keys=[shared_by])
    recipient = relationship("User", foreign_keys=[shared_with])


class ReminderComment(Base):
    __tablename__ = "reminder_comments"

    id = Column(Integer, primary_key=True, index=True)
    reminder_id = Column(Integer, ForeignKey("todos.id", ondelete="CASCADE"), nullable=False)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    content = Column(Text, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    reminder = relationship("Reminder", back_populates="comments")
    author = relationship("User", foreign_keys=[user_id])
```

**Step 2: Create the UserCalendarConnection model**

Create `backend/app/models/calendar_connection.py`:

```python
from sqlalchemy import Column, Integer, String, Text, DateTime, ForeignKey
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship
from app.database import Base


class UserCalendarConnection(Base):
    __tablename__ = "user_calendar_connections"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    provider = Column(String, nullable=False)  # "google" or "microsoft"
    access_token = Column(Text, nullable=True)
    refresh_token = Column(Text, nullable=True)
    token_expires_at = Column(DateTime(timezone=True), nullable=True)
    calendar_id = Column(String, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    user = relationship("User", foreign_keys=[user_id])
```

**Step 3: Commit**

```bash
git add backend/app/models/todo.py backend/app/models/calendar_connection.py
git commit -m "feat: add Reminder, ReminderShare, ReminderComment, UserCalendarConnection models"
```

---

## Task 2: Backend Schemas

**Files:**
- Create: `backend/app/schemas/todo.py`
- Create: `backend/app/schemas/calendar.py`

**Step 1: Create reminder schemas**

Create `backend/app/schemas/todo.py`:

```python
from pydantic import BaseModel, ConfigDict
from typing import Optional, List
from datetime import datetime


class ReminderBase(BaseModel):
    title: str
    description: Optional[str] = None
    priority: str = "as_usual"  # planning, low, as_usual, urgent
    due_date: Optional[datetime] = None


class ReminderCreate(ReminderBase):
    pass


class ReminderUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    priority: Optional[str] = None
    status: Optional[str] = None
    due_date: Optional[datetime] = None


class ReminderReschedule(BaseModel):
    due_date: datetime


class ReminderStatusUpdate(BaseModel):
    status: str  # scheduled, pending, completed


class ReminderResponse(ReminderBase):
    id: int
    user_id: int
    status: str
    original_due_date: Optional[datetime] = None
    google_event_id: Optional[str] = None
    microsoft_event_id: Optional[str] = None
    created_at: datetime
    updated_at: Optional[datetime] = None
    owner_name: Optional[str] = None
    share_count: int = 0
    comment_count: int = 0

    model_config = ConfigDict(from_attributes=True)


class ReminderShareRequest(BaseModel):
    user_ids: List[int]  # list of user IDs to share with; empty = all users
    share_all: bool = False


class ReminderShareResponse(BaseModel):
    id: int
    reminder_id: int
    shared_by: int
    shared_with: int
    is_seen: bool
    created_at: datetime
    sharer_name: Optional[str] = None
    reminder_title: Optional[str] = None
    reminder_description: Optional[str] = None
    reminder_priority: Optional[str] = None
    reminder_due_date: Optional[datetime] = None
    reminder_status: Optional[str] = None

    model_config = ConfigDict(from_attributes=True)


class ReminderCommentCreate(BaseModel):
    content: str


class ReminderCommentResponse(BaseModel):
    id: int
    reminder_id: int
    user_id: int
    content: str
    created_at: datetime
    author_name: Optional[str] = None

    model_config = ConfigDict(from_attributes=True)


class UnseenCountResponse(BaseModel):
    count: int
```

**Step 2: Create calendar schemas**

Create `backend/app/schemas/calendar.py`:

```python
from pydantic import BaseModel, ConfigDict
from typing import Optional
from datetime import datetime


class CalendarConnectionResponse(BaseModel):
    id: int
    provider: str
    calendar_id: Optional[str] = None
    connected: bool = True
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class CalendarStatusResponse(BaseModel):
    google: Optional[CalendarConnectionResponse] = None
    microsoft: Optional[CalendarConnectionResponse] = None
```

**Step 3: Commit**

```bash
git add backend/app/schemas/todo.py backend/app/schemas/calendar.py
git commit -m "feat: add Pydantic schemas for reminders and calendar connections"
```

---

## Task 3: Backend Reminder Routes (CRUD + Share + Comments)

**Files:**
- Create: `backend/app/routes/todos.py`

**Step 1: Create the full routes file**

Create `backend/app/routes/todos.py`:

```python
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from typing import List, Optional
from datetime import datetime

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
        target_ids = [u.id for u in target_users]
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
            import logging
            logging.getLogger(__name__).warning("Failed to send share email to %s: %s", user.email, e)

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


# ─── Internal Users List ────────────────────────────────────────────────

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


# ─── Calendar sync helpers ──────────────────────────────────────────────

def _sync_calendar_create(reminder: Reminder, user_id: int, db: Session):
    """Create calendar events for connected providers (fire-and-forget)."""
    try:
        from app.services.calendar_service import calendar_service
        calendar_service.create_event(reminder, user_id, db)
    except Exception as e:
        import logging
        logging.getLogger(__name__).warning("Calendar sync create failed: %s", e)


def _sync_calendar_update(reminder: Reminder, user_id: int, db: Session):
    try:
        from app.services.calendar_service import calendar_service
        calendar_service.update_event(reminder, user_id, db)
    except Exception as e:
        import logging
        logging.getLogger(__name__).warning("Calendar sync update failed: %s", e)


def _sync_calendar_delete(reminder: Reminder, user_id: int, db: Session):
    try:
        from app.services.calendar_service import calendar_service
        calendar_service.delete_event(reminder, user_id, db)
    except Exception as e:
        import logging
        logging.getLogger(__name__).warning("Calendar sync delete failed: %s", e)
```

**Important route ordering note:** The `/shared-with-me` and `/shared-with-me/unseen-count` routes MUST be registered before `/{reminder_id}` to avoid FastAPI treating "shared-with-me" as a reminder_id. Place them above the `/{reminder_id}` route in the file.

**Step 2: Commit**

```bash
git add backend/app/routes/todos.py
git commit -m "feat: add reminder CRUD, sharing, and comments routes"
```

---

## Task 4: Calendar Service

**Files:**
- Create: `backend/app/services/calendar_service.py`

**Step 1: Create calendar service with Google + Microsoft support**

Create `backend/app/services/calendar_service.py`:

```python
"""
Calendar sync service for Google Calendar and Microsoft Graph.
Handles OAuth token management and CRUD on calendar events.
"""

import logging
import os
from datetime import datetime, timedelta
from typing import Optional

import requests
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

GOOGLE_CLIENT_ID = os.getenv("GOOGLE_CLIENT_ID", "")
GOOGLE_CLIENT_SECRET = os.getenv("GOOGLE_CLIENT_SECRET", "")
MICROSOFT_CLIENT_ID = os.getenv("MICROSOFT_CLIENT_ID", "")
MICROSOFT_CLIENT_SECRET = os.getenv("MICROSOFT_CLIENT_SECRET", "")
MICROSOFT_TENANT_ID = os.getenv("MICROSOFT_TENANT_ID", "common")
FRONTEND_URL = os.getenv("FRONTEND_URL", "http://localhost:3000")
BACKEND_URL = os.getenv("BACKEND_URL", "http://localhost:8000")


class CalendarService:

    # ── Google Calendar ──────────────────────────────────────────────────

    def get_google_auth_url(self, user_id: int) -> str:
        redirect_uri = f"{BACKEND_URL}/api/calendar/callback/google"
        scope = "https://www.googleapis.com/auth/calendar.events"
        return (
            f"https://accounts.google.com/o/oauth2/v2/auth"
            f"?client_id={GOOGLE_CLIENT_ID}"
            f"&redirect_uri={redirect_uri}"
            f"&response_type=code"
            f"&scope={scope}"
            f"&access_type=offline"
            f"&prompt=consent"
            f"&state={user_id}"
        )

    def exchange_google_code(self, code: str) -> dict:
        redirect_uri = f"{BACKEND_URL}/api/calendar/callback/google"
        resp = requests.post("https://oauth2.googleapis.com/token", data={
            "code": code,
            "client_id": GOOGLE_CLIENT_ID,
            "client_secret": GOOGLE_CLIENT_SECRET,
            "redirect_uri": redirect_uri,
            "grant_type": "authorization_code",
        })
        resp.raise_for_status()
        return resp.json()

    def refresh_google_token(self, refresh_token: str) -> dict:
        resp = requests.post("https://oauth2.googleapis.com/token", data={
            "refresh_token": refresh_token,
            "client_id": GOOGLE_CLIENT_ID,
            "client_secret": GOOGLE_CLIENT_SECRET,
            "grant_type": "refresh_token",
        })
        resp.raise_for_status()
        return resp.json()

    def _google_create_event(self, access_token: str, summary: str, description: str, start: datetime, calendar_id: str = "primary") -> str:
        end = start + timedelta(hours=1)
        body = {
            "summary": summary,
            "description": description or "",
            "start": {"dateTime": start.isoformat(), "timeZone": "UTC"},
            "end": {"dateTime": end.isoformat(), "timeZone": "UTC"},
        }
        resp = requests.post(
            f"https://www.googleapis.com/calendar/v3/calendars/{calendar_id}/events",
            headers={"Authorization": f"Bearer {access_token}"},
            json=body,
        )
        resp.raise_for_status()
        return resp.json()["id"]

    def _google_update_event(self, access_token: str, event_id: str, summary: str, description: str, start: datetime, calendar_id: str = "primary"):
        end = start + timedelta(hours=1)
        body = {
            "summary": summary,
            "description": description or "",
            "start": {"dateTime": start.isoformat(), "timeZone": "UTC"},
            "end": {"dateTime": end.isoformat(), "timeZone": "UTC"},
        }
        resp = requests.patch(
            f"https://www.googleapis.com/calendar/v3/calendars/{calendar_id}/events/{event_id}",
            headers={"Authorization": f"Bearer {access_token}"},
            json=body,
        )
        resp.raise_for_status()

    def _google_delete_event(self, access_token: str, event_id: str, calendar_id: str = "primary"):
        resp = requests.delete(
            f"https://www.googleapis.com/calendar/v3/calendars/{calendar_id}/events/{event_id}",
            headers={"Authorization": f"Bearer {access_token}"},
        )
        if resp.status_code not in (200, 204, 404, 410):
            resp.raise_for_status()

    # ── Microsoft Graph ──────────────────────────────────────────────────

    def get_microsoft_auth_url(self, user_id: int) -> str:
        redirect_uri = f"{BACKEND_URL}/api/calendar/callback/microsoft"
        scope = "Calendars.ReadWrite offline_access"
        return (
            f"https://login.microsoftonline.com/{MICROSOFT_TENANT_ID}/oauth2/v2.0/authorize"
            f"?client_id={MICROSOFT_CLIENT_ID}"
            f"&redirect_uri={redirect_uri}"
            f"&response_type=code"
            f"&scope={scope}"
            f"&state={user_id}"
        )

    def exchange_microsoft_code(self, code: str) -> dict:
        redirect_uri = f"{BACKEND_URL}/api/calendar/callback/microsoft"
        resp = requests.post(
            f"https://login.microsoftonline.com/{MICROSOFT_TENANT_ID}/oauth2/v2.0/token",
            data={
                "code": code,
                "client_id": MICROSOFT_CLIENT_ID,
                "client_secret": MICROSOFT_CLIENT_SECRET,
                "redirect_uri": redirect_uri,
                "grant_type": "authorization_code",
                "scope": "Calendars.ReadWrite offline_access",
            },
        )
        resp.raise_for_status()
        return resp.json()

    def refresh_microsoft_token(self, refresh_token: str) -> dict:
        resp = requests.post(
            f"https://login.microsoftonline.com/{MICROSOFT_TENANT_ID}/oauth2/v2.0/token",
            data={
                "refresh_token": refresh_token,
                "client_id": MICROSOFT_CLIENT_ID,
                "client_secret": MICROSOFT_CLIENT_SECRET,
                "grant_type": "refresh_token",
                "scope": "Calendars.ReadWrite offline_access",
            },
        )
        resp.raise_for_status()
        return resp.json()

    def _ms_create_event(self, access_token: str, summary: str, description: str, start: datetime) -> str:
        end = start + timedelta(hours=1)
        body = {
            "subject": summary,
            "body": {"contentType": "text", "content": description or ""},
            "start": {"dateTime": start.strftime("%Y-%m-%dT%H:%M:%S"), "timeZone": "UTC"},
            "end": {"dateTime": end.strftime("%Y-%m-%dT%H:%M:%S"), "timeZone": "UTC"},
        }
        resp = requests.post(
            "https://graph.microsoft.com/v1.0/me/events",
            headers={"Authorization": f"Bearer {access_token}", "Content-Type": "application/json"},
            json=body,
        )
        resp.raise_for_status()
        return resp.json()["id"]

    def _ms_update_event(self, access_token: str, event_id: str, summary: str, description: str, start: datetime):
        end = start + timedelta(hours=1)
        body = {
            "subject": summary,
            "body": {"contentType": "text", "content": description or ""},
            "start": {"dateTime": start.strftime("%Y-%m-%dT%H:%M:%S"), "timeZone": "UTC"},
            "end": {"dateTime": end.strftime("%Y-%m-%dT%H:%M:%S"), "timeZone": "UTC"},
        }
        resp = requests.patch(
            f"https://graph.microsoft.com/v1.0/me/events/{event_id}",
            headers={"Authorization": f"Bearer {access_token}", "Content-Type": "application/json"},
            json=body,
        )
        resp.raise_for_status()

    def _ms_delete_event(self, access_token: str, event_id: str):
        resp = requests.delete(
            f"https://graph.microsoft.com/v1.0/me/events/{event_id}",
            headers={"Authorization": f"Bearer {access_token}"},
        )
        if resp.status_code not in (200, 204, 404):
            resp.raise_for_status()

    # ── Unified helpers (called from routes) ─────────────────────────────

    def _get_connections(self, user_id: int, db: Session):
        from app.models.calendar_connection import UserCalendarConnection
        return db.query(UserCalendarConnection).filter(
            UserCalendarConnection.user_id == user_id,
        ).all()

    def _ensure_fresh_token(self, conn, db: Session) -> str:
        """Refresh token if expired and return a valid access_token."""
        now = datetime.utcnow()
        if conn.token_expires_at and conn.token_expires_at > now:
            return conn.access_token

        if conn.provider == "google":
            data = self.refresh_google_token(conn.refresh_token)
        else:
            data = self.refresh_microsoft_token(conn.refresh_token)

        conn.access_token = data["access_token"]
        conn.token_expires_at = now + timedelta(seconds=data.get("expires_in", 3600))
        if data.get("refresh_token"):
            conn.refresh_token = data["refresh_token"]
        db.commit()
        return conn.access_token

    def create_event(self, reminder, user_id: int, db: Session):
        if not reminder.due_date:
            return
        for conn in self._get_connections(user_id, db):
            try:
                token = self._ensure_fresh_token(conn, db)
                if conn.provider == "google":
                    event_id = self._google_create_event(
                        token, reminder.title, reminder.description, reminder.due_date,
                        conn.calendar_id or "primary",
                    )
                    reminder.google_event_id = event_id
                elif conn.provider == "microsoft":
                    event_id = self._ms_create_event(
                        token, reminder.title, reminder.description, reminder.due_date,
                    )
                    reminder.microsoft_event_id = event_id
                db.commit()
            except Exception as e:
                logger.warning("Calendar create failed (%s): %s", conn.provider, e)

    def update_event(self, reminder, user_id: int, db: Session):
        if not reminder.due_date:
            return
        for conn in self._get_connections(user_id, db):
            try:
                token = self._ensure_fresh_token(conn, db)
                if conn.provider == "google" and reminder.google_event_id:
                    self._google_update_event(
                        token, reminder.google_event_id, reminder.title,
                        reminder.description, reminder.due_date,
                        conn.calendar_id or "primary",
                    )
                elif conn.provider == "microsoft" and reminder.microsoft_event_id:
                    self._ms_update_event(
                        token, reminder.microsoft_event_id, reminder.title,
                        reminder.description, reminder.due_date,
                    )
            except Exception as e:
                logger.warning("Calendar update failed (%s): %s", conn.provider, e)

    def delete_event(self, reminder, user_id: int, db: Session):
        for conn in self._get_connections(user_id, db):
            try:
                token = self._ensure_fresh_token(conn, db)
                if conn.provider == "google" and reminder.google_event_id:
                    self._google_delete_event(token, reminder.google_event_id, conn.calendar_id or "primary")
                    reminder.google_event_id = None
                elif conn.provider == "microsoft" and reminder.microsoft_event_id:
                    self._ms_delete_event(token, reminder.microsoft_event_id)
                    reminder.microsoft_event_id = None
                db.commit()
            except Exception as e:
                logger.warning("Calendar delete failed (%s): %s", conn.provider, e)

    def refresh_all_expiring_tokens(self, db: Session) -> int:
        """Background job: refresh tokens expiring within 10 minutes."""
        from app.models.calendar_connection import UserCalendarConnection
        soon = datetime.utcnow() + timedelta(minutes=10)
        expiring = db.query(UserCalendarConnection).filter(
            UserCalendarConnection.token_expires_at <= soon,
            UserCalendarConnection.refresh_token != None,
        ).all()
        refreshed = 0
        for conn in expiring:
            try:
                self._ensure_fresh_token(conn, db)
                refreshed += 1
            except Exception as e:
                logger.warning("Token refresh failed for user %d (%s): %s", conn.user_id, conn.provider, e)
        return refreshed


calendar_service = CalendarService()
```

**Step 2: Commit**

```bash
git add backend/app/services/calendar_service.py
git commit -m "feat: add calendar sync service for Google and Microsoft"
```

---

## Task 5: Calendar Routes

**Files:**
- Create: `backend/app/routes/calendar.py`

**Step 1: Create OAuth flow routes**

Create `backend/app/routes/calendar.py`:

```python
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import RedirectResponse
from sqlalchemy.orm import Session
from datetime import datetime, timedelta
import os

from app.database import get_db
from app.dependencies import get_current_user
from app.models.user import User
from app.models.calendar_connection import UserCalendarConnection
from app.services.calendar_service import calendar_service
from app.schemas.calendar import CalendarStatusResponse, CalendarConnectionResponse

FRONTEND_URL = os.getenv("FRONTEND_URL", "http://localhost:3000")

router = APIRouter(
    prefix="/api/calendar",
    tags=["calendar"],
)


@router.get("/connect/{provider}")
def connect_calendar(
    provider: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Initiate OAuth flow for Google or Microsoft calendar."""
    if provider == "google":
        url = calendar_service.get_google_auth_url(current_user.id)
    elif provider == "microsoft":
        url = calendar_service.get_microsoft_auth_url(current_user.id)
    else:
        raise HTTPException(400, "Provider must be 'google' or 'microsoft'")
    return {"auth_url": url}


@router.get("/callback/google")
def google_callback(
    code: str = Query(...),
    state: str = Query(...),
    db: Session = Depends(get_db),
):
    """Handle Google OAuth callback."""
    try:
        user_id = int(state)
    except ValueError:
        raise HTTPException(400, "Invalid state parameter")

    token_data = calendar_service.exchange_google_code(code)

    # Upsert connection
    conn = db.query(UserCalendarConnection).filter(
        UserCalendarConnection.user_id == user_id,
        UserCalendarConnection.provider == "google",
    ).first()
    if not conn:
        conn = UserCalendarConnection(user_id=user_id, provider="google")
        db.add(conn)

    conn.access_token = token_data["access_token"]
    conn.refresh_token = token_data.get("refresh_token", conn.refresh_token)
    conn.token_expires_at = datetime.utcnow() + timedelta(seconds=token_data.get("expires_in", 3600))
    conn.calendar_id = "primary"
    db.commit()

    return RedirectResponse(f"{FRONTEND_URL}/settings?tab=calendar&connected=google")


@router.get("/callback/microsoft")
def microsoft_callback(
    code: str = Query(...),
    state: str = Query(...),
    db: Session = Depends(get_db),
):
    """Handle Microsoft OAuth callback."""
    try:
        user_id = int(state)
    except ValueError:
        raise HTTPException(400, "Invalid state parameter")

    token_data = calendar_service.exchange_microsoft_code(code)

    conn = db.query(UserCalendarConnection).filter(
        UserCalendarConnection.user_id == user_id,
        UserCalendarConnection.provider == "microsoft",
    ).first()
    if not conn:
        conn = UserCalendarConnection(user_id=user_id, provider="microsoft")
        db.add(conn)

    conn.access_token = token_data["access_token"]
    conn.refresh_token = token_data.get("refresh_token", conn.refresh_token)
    conn.token_expires_at = datetime.utcnow() + timedelta(seconds=token_data.get("expires_in", 3600))
    db.commit()

    return RedirectResponse(f"{FRONTEND_URL}/settings?tab=calendar&connected=microsoft")


@router.get("/status", response_model=CalendarStatusResponse)
def calendar_status(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Check which calendars are connected."""
    conns = db.query(UserCalendarConnection).filter(
        UserCalendarConnection.user_id == current_user.id,
    ).all()
    result = {"google": None, "microsoft": None}
    for c in conns:
        result[c.provider] = {
            "id": c.id,
            "provider": c.provider,
            "calendar_id": c.calendar_id,
            "connected": True,
            "created_at": c.created_at,
        }
    return result


@router.delete("/disconnect/{provider}", status_code=204)
def disconnect_calendar(
    provider: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Disconnect a calendar provider."""
    conn = db.query(UserCalendarConnection).filter(
        UserCalendarConnection.user_id == current_user.id,
        UserCalendarConnection.provider == provider,
    ).first()
    if conn:
        db.delete(conn)
        db.commit()
```

**Step 2: Commit**

```bash
git add backend/app/routes/calendar.py
git commit -m "feat: add calendar OAuth flow routes"
```

---

## Task 6: Email Notification with .ics Attachment

**Files:**
- Modify: `backend/app/services/email_service.py`

**Step 1: Add `send_reminder_share_notification` method to `EmailService` class**

Add this method to the `EmailService` class in `backend/app/services/email_service.py`, after the existing `send_otp_email` method:

```python
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

        subject = f"{sharer_name} shared a reminder: {reminder.title}"
        due_str = reminder.due_date.strftime("%Y-%m-%d %H:%M") if reminder.due_date else "No due date"
        priority_label = (reminder.priority or "as_usual").replace("_", " ").title()
        app_url = os.getenv("APP_URL", "http://localhost:3000")

        html_body = f"""
        <html>
            <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
                <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
                    <h2 style="color: #2563eb;">Reminder Shared With You</h2>
                    <p><strong>{sharer_name}</strong> shared a reminder with you:</p>
                    <div style="background-color: #f3f4f6; padding: 16px; border-radius: 8px; margin: 16px 0;">
                        <h3 style="margin: 0 0 8px 0;">{reminder.title}</h3>
                        {f'<p style="margin: 4px 0; color: #555;">{reminder.description}</p>' if reminder.description else ''}
                        <p style="margin: 4px 0;"><strong>Priority:</strong> {priority_label}</p>
                        <p style="margin: 4px 0;"><strong>Due:</strong> {due_str}</p>
                    </div>
                    <p>
                        <a href="{app_url}/reminders" style="background-color: #2563eb; color: white; padding: 10px 24px; text-decoration: none; border-radius: 5px; display: inline-block;">
                            View in App
                        </a>
                    </p>
                </div>
            </body>
        </html>
        """

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

        with smtplib.SMTP(smtp_config["smtp_server"], int(smtp_config["smtp_port"])) as server:
            if smtp_config.get("smtp_use_tls", True):
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
```

**Step 2: Commit**

```bash
git add backend/app/services/email_service.py
git commit -m "feat: add reminder share notification email with .ics attachment"
```

---

## Task 7: Event Types + Background Jobs + main.py Wiring

**Files:**
- Modify: `backend/app/services/events_service.py`
- Modify: `backend/main.py`

**Step 1: Add event types to `EventTypes` class**

In `backend/app/services/events_service.py`, add these to the `EventTypes` class:

```python
    REMINDER_SHARED = "reminder_shared"
    REMINDER_COMMENT = "reminder_comment"
    REMINDER_DUE = "reminder_due"
```

**Step 2: Add inline migrations to `_run_inline_migrations()` in `backend/main.py`**

Add before the final `conn.commit()` in `_run_inline_migrations()`:

```python
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
```

**Step 3: Add router imports and include in `backend/main.py`**

In the imports line (line 6), add `todos` (note: rename from existing `reminders` to avoid conflict — the existing `reminders` module is the Reminder Call feature). Since `reminders` is already imported, name our new routes file `todos`:

```python
from app.routes import ..., todos as todo_routes, calendar as calendar_routes
```

In the router registrations section:

```python
app.include_router(todo_routes.router)
app.include_router(calendar_routes.router)
```

**Step 4: Add background jobs to `startup_event()` in `backend/main.py`**

Add these inside `startup_event()` before `scheduler.start()`:

```python
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
```

**Step 5: Add new env vars to `backend/app/config.py`**

Add to the `Settings` class:

```python
    # Calendar Integration
    GOOGLE_CLIENT_ID: Optional[str] = None
    GOOGLE_CLIENT_SECRET: Optional[str] = None
    MICROSOFT_CLIENT_ID: Optional[str] = None
    MICROSOFT_CLIENT_SECRET: Optional[str] = None
    MICROSOFT_TENANT_ID: Optional[str] = "common"
    BACKEND_URL: str = "http://localhost:8000"
```

**Step 6: Commit**

```bash
git add backend/app/services/events_service.py backend/main.py backend/app/config.py
git commit -m "feat: wire up todo routes, migrations, background jobs, and event types"
```

---

## Task 8: Frontend — Reminders Page

**Files:**
- Create: `frontend/app/reminders/page.tsx`

**Step 1: Create the full reminders page**

Create `frontend/app/reminders/page.tsx` — This is a large file containing:

- Two tabs: "My Reminders" and "Shared With Me"
- Reminder card list with priority/status badges and filters
- Create/Edit modal with conditional date picker (hidden when priority=planning)
- Reschedule modal
- Detail view with comments thread
- Uses `getAuthToken()`, `fetch` against `API_URL`, `MainHeader`
- Social share button on each card
- Subscribe to WebSocket events (`reminder_shared`, `reminder_comment`, `reminder_due`) for real-time updates

The page should follow the existing patterns from `/admin` pages — `'use client'`, `MainHeader`, `getAuthToken()`, `API_URL`, standard Tailwind styling.

Key UI elements:
- Priority badges: planning=gray, low=blue, as_usual=yellow, urgent=red
- Status badges: scheduled=blue, pending=yellow, completed=green
- Filter dropdowns for status and priority
- FAB or header button to create new reminder
- Each card: title, priority badge, status badge, due date, share icon, social share icon
- Share icon opens `ReminderShareModal`
- Social share icon opens native share or fallback buttons

**Step 2: Commit**

```bash
git add frontend/app/reminders/page.tsx
git commit -m "feat: add reminders page with CRUD, filters, comments, and sharing"
```

---

## Task 9: Frontend — Share Modal Component

**Files:**
- Create: `frontend/components/ReminderShareModal.tsx`

**Step 1: Create share modal**

Create `frontend/components/ReminderShareModal.tsx`:

- Props: `isOpen`, `onClose`, `reminderId`, `onShared` callback
- Fetches `/api/todos/users/internal` on open
- Search input to filter users by name
- Checkbox list of users with avatar + name
- "Select All" checkbox at top
- Confirm button calls `POST /api/todos/{reminderId}/share`
- Shows success toast on completion

**Step 2: Commit**

```bash
git add frontend/components/ReminderShareModal.tsx
git commit -m "feat: add reminder share modal with user selection"
```

---

## Task 10: Frontend — Social Share Buttons

**Files:**
- Create: `frontend/components/SocialShareButtons.tsx`

**Step 1: Create social share component**

Create `frontend/components/SocialShareButtons.tsx`:

- Props: `title`, `description`, `dueDate`
- Primary button: tries `navigator.share()` (Web Share API)
- Fallback buttons (shown if Web Share API unavailable):
  - WhatsApp: `https://wa.me/?text=...`
  - Facebook: `https://www.facebook.com/sharer/sharer.php?quote=...`
  - LinkedIn: `https://www.linkedin.com/sharing/share-offsite/?url=...`
  - Copy to clipboard button
- Formatted share text: "Reminder: {title}\n{description}\nDue: {dueDate}"

**Step 2: Commit**

```bash
git add frontend/components/SocialShareButtons.tsx
git commit -m "feat: add social share buttons component"
```

---

## Task 11: Frontend — MainHeader Bell Icon with Badge

**Files:**
- Modify: `frontend/components/MainHeader.tsx`

**Step 1: Add reminder bell icon to header**

In `frontend/components/MainHeader.tsx`:

1. Import `FiCheckSquare` from `react-icons/fi`
2. Import `useEvents` from `@/lib/events-context`
3. Import `getAuthToken` from `@/lib/auth`
4. Import `API_URL` from `@/lib/config`
5. Add state for `unseenCount`
6. Fetch unseen count from `/api/todos/shared-with-me/unseen-count` on mount
7. Subscribe to `reminder_shared` event to increment badge count
8. Add bell icon + badge before the `ProfileDropdown` in the right section:

```tsx
<Link href="/reminders" className="relative p-2 text-gray-600 hover:text-gray-900">
    <FiCheckSquare size={20} />
    {unseenCount > 0 && (
        <span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs rounded-full h-5 w-5 flex items-center justify-center">
            {unseenCount > 99 ? '99+' : unseenCount}
        </span>
    )}
</Link>
```

**Step 2: Commit**

```bash
git add frontend/components/MainHeader.tsx
git commit -m "feat: add reminder badge icon to main header"
```

---

## Task 12: Frontend — Calendar Settings Section

**Files:**
- Modify: `frontend/app/settings/page.tsx`

**Step 1: Add calendar tab to settings page**

In `frontend/app/settings/page.tsx`:

1. Add `'calendar'` to the `activeTab` type
2. Add a "Calendar" tab button in the tab navigation
3. Add a calendar section showing:
   - Google Calendar: Connect/Disconnect button + connection status
   - Microsoft Calendar: Connect/Disconnect button + connection status
4. Connect calls `GET /api/calendar/connect/{provider}` then redirects to `auth_url`
5. Disconnect calls `DELETE /api/calendar/disconnect/{provider}`
6. On mount, fetch status from `GET /api/calendar/status`

**Step 2: Commit**

```bash
git add frontend/app/settings/page.tsx
git commit -m "feat: add calendar integration settings"
```

---

## Task 13: Final Verification

**Step 1: Start the backend and verify no import errors**

```bash
cd backend && source venv/bin/activate && python -c "from main import app; print('Backend OK')"
```

**Step 2: Start the frontend and verify no build errors**

```bash
cd frontend && npm run build
```

**Step 3: Test via Swagger UI**

Open `http://localhost:8000/docs` and test:
- `POST /api/todos` — create a reminder
- `GET /api/todos` — list reminders
- `PUT /api/todos/{id}/reschedule` — reschedule
- `PUT /api/todos/{id}/status` — change status
- `POST /api/todos/{id}/share` — share with users
- `GET /api/todos/shared-with-me` — list shared
- `GET /api/todos/shared-with-me/unseen-count` — badge count
- `POST /api/todos/{id}/comments` — add comment
- `GET /api/calendar/status` — check calendar status

**Step 4: Final commit**

```bash
git add -A
git commit -m "feat: complete Reminders/Todos module implementation"
```
