from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse, Response
from sqlalchemy.orm import Session, joinedload
from sqlalchemy import or_, and_, func
from typing import List, Optional
from datetime import date, datetime, timedelta
import io
from app.database import get_db
from app.dependencies import get_current_user, require_module
from app.models.user import User
from app.models.call_records import CallRecording
from app.schemas.call_records import CallRecordingCreate, CallRecordingResponse

router = APIRouter(
    prefix="/calls",
    tags=["calls"],
    responses={404: {"description": "Not found"}},
)

require_calls = require_module("module_calls")


def _enrich(rec: CallRecording) -> dict:
    """Convert a CallRecording ORM object to a dict with has_audio and agent info."""
    agent_name = rec.agent_name
    if not agent_name and rec.agent:
        agent_name = rec.agent.display_name or rec.agent.full_name or rec.agent.email.split("@")[0]

    return {
        "id": rec.id,
        "conversation_id": rec.conversation_id,
        "agent_id": rec.agent_id,
        "agent_name": agent_name or "Unknown",
        "phone_number": rec.phone_number,
        "direction": rec.direction,
        "disposition": getattr(rec, "disposition", "ANSWERED"),
        "duration_seconds": rec.duration_seconds,
        "recording_file": getattr(rec, "recording_file", None),
        "recording_url": rec.recording_url,
        "pbx_call_id": rec.pbx_call_id,
        "has_audio": bool(getattr(rec, "recording_file", None) or rec.recording_url),
        "created_at": rec.created_at.isoformat() if rec.created_at else None,
    }


@router.get("/recordings")
def get_call_recordings(
    skip: int = 0,
    limit: int = 50,
    # Filters
    agent_id: Optional[int] = Query(None, description="Filter by agent ID"),
    phone: Optional[str] = Query(None, description="Search by customer phone number"),
    direction: Optional[str] = Query(None, description="inbound or outbound"),
    date_from: Optional[date] = Query(None, description="Start date (YYYY-MM-DD)"),
    date_to: Optional[date] = Query(None, description="End date (YYYY-MM-DD)"),
    has_recording: Optional[bool] = Query(None, description="Filter to calls with audio"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Retrieve call recordings with full search/filter support.
    Agents see only their own calls. Admins see all.
    """
    query = db.query(CallRecording)

    # Role-based scoping
    if not current_user.role == "admin":
        query = query.filter(CallRecording.agent_id == current_user.id)
    elif agent_id is not None:
        query = query.filter(CallRecording.agent_id == agent_id)

    # Phone number search (partial match)
    if phone:
        query = query.filter(CallRecording.phone_number.ilike(f"%{phone.strip()}%"))

    # Direction filter
    if direction in ("inbound", "outbound"):
        query = query.filter(CallRecording.direction == direction)

    # Date range
    if date_from:
        query = query.filter(CallRecording.created_at >= datetime.combine(date_from, datetime.min.time()))
    if date_to:
        query = query.filter(CallRecording.created_at <= datetime.combine(date_to, datetime.max.time()))

    # Recording filter
    if has_recording is True:
        query = query.filter(
            or_(
                CallRecording.recording_file.isnot(None),
                CallRecording.recording_url.isnot(None)
            )
        )
    elif has_recording is False:
        query = query.filter(
            and_(
                CallRecording.recording_file.is_(None),
                CallRecording.recording_url.is_(None)
            )
        )

    total = query.count()
    recordings = query.order_by(CallRecording.created_at.desc()).offset(skip).limit(limit).all()

    return {
        "total": total,
        "skip": skip,
        "limit": limit,
        "results": [_enrich(r) for r in recordings],
    }


@router.get("/recordings/stats")
def get_recording_stats(
    agent_id: Optional[int] = Query(None),
    date_from: Optional[date] = Query(None),
    date_to: Optional[date] = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Summary statistics for the recordings list."""
    query = db.query(CallRecording)

    if current_user.role != "admin":
        query = query.filter(CallRecording.agent_id == current_user.id)
    elif agent_id:
        query = query.filter(CallRecording.agent_id == agent_id)

    if date_from:
        query = query.filter(CallRecording.created_at >= datetime.combine(date_from, datetime.min.time()))
    if date_to:
        query = query.filter(CallRecording.created_at <= datetime.combine(date_to, datetime.max.time()))

    all_recs = query.all()
    total = len(all_recs)
    inbound = sum(1 for r in all_recs if r.direction == "inbound")
    outbound = sum(1 for r in all_recs if r.direction == "outbound")
    with_audio = sum(1 for r in all_recs if getattr(r, "recording_file", None) or r.recording_url)
    avg_duration = int(sum(r.duration_seconds for r in all_recs) / total) if total else 0

    return {
        "total": total,
        "inbound": inbound,
        "outbound": outbound,
        "with_audio": with_audio,
        "avg_duration_seconds": avg_duration,
    }


@router.get("/recordings/{recording_id}/stream")
def stream_recording_audio(
    recording_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Stream a call recording audio file from FreePBX through this backend.
    Agents can only stream their own recordings. Admins can stream any.
    """
    rec = db.query(CallRecording).filter(CallRecording.id == recording_id).first()
    if not rec:
        raise HTTPException(status_code=404, detail="Recording not found")

    # Access control
    if not current_user.role == "admin" and rec.agent_id != current_user.id:
        raise HTTPException(status_code=403, detail="Access denied")

    # If we have a direct public URL, redirect to it
    if rec.recording_url and not getattr(rec, "recording_file", None):
        from fastapi.responses import RedirectResponse
        return RedirectResponse(rec.recording_url)

    recording_file = getattr(rec, "recording_file", None)
    if not recording_file:
        raise HTTPException(status_code=404, detail="No audio file associated with this recording")

    # Fetch from FreePBX and stream
    from app.services.freepbx_cdr_service import freepbx_cdr_service
    audio_bytes, content_type = freepbx_cdr_service.stream_recording(db, recording_file)

    if not audio_bytes:
        raise HTTPException(status_code=502, detail="Could not retrieve audio from FreePBX. Check connection settings.")

    return Response(
        content=audio_bytes,
        media_type=content_type or "audio/wav",
        headers={
            "Content-Disposition": f'inline; filename="{recording_file}"',
            "Accept-Ranges": "bytes",
        }
    )


@router.post("/recordings", response_model=dict)
def create_call_recording_log(
    recording: CallRecordingCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Manually log a call recording (called by softphone on call completion)."""
    new_recording = CallRecording(
        conversation_id=recording.conversation_id,
        agent_id=recording.agent_id or current_user.id,
        agent_name=recording.agent_name,
        phone_number=recording.phone_number,
        direction=recording.direction,
        disposition=recording.disposition,
        duration_seconds=recording.duration_seconds,
        recording_file=recording.recording_file,
        recording_url=recording.recording_url,
        pbx_call_id=recording.pbx_call_id,
    )
    db.add(new_recording)
    db.commit()
    db.refresh(new_recording)
    return _enrich(new_recording)


@router.post("/recordings/sync-from-freepbx")
def manual_sync_from_freepbx(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_calls)
):
    """Manually trigger a CDR sync from FreePBX (admin only)."""
    from app.services.freepbx_cdr_service import freepbx_cdr_service
    count = freepbx_cdr_service.sync_cdrs_to_db(db)
    return {
        "message": f"Sync complete. {count} new call record(s) imported.",
        "imported": count,
    }


@router.get("/agents-list")
def get_agents_for_filter(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Returns a list of agents for the filter dropdown (agents who have any recordings)."""
    if not current_user.role == "admin":
        return [{"id": current_user.id, "name": current_user.display_name or current_user.full_name or current_user.email}]

    rows = (
        db.query(User.id, User.display_name, User.full_name, User.email)
        .filter(User.role == "user", User.is_active == True)
        .all()
    )
    return [
        {"id": r.id, "name": r.display_name or r.full_name or r.email.split("@")[0]}
        for r in rows
    ]
