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
from app.models.organization import Organization, OrganizationContact
from app.models.email import Contact
from app.schemas.call_records import CallRecordingCreate, CallRecordingResponse
from app.models.ticket import Ticket, TicketStatus, TicketPriority
from app.services.tts_service import text_to_speech
import os

router = APIRouter(
    prefix="/calls",
    tags=["calls"],
    responses={404: {"description": "Not found"}},
)

require_calls = require_module("module_calls")


def _enrich(rec: CallRecording, db: Optional[Session] = None) -> dict:
    """Convert a CallRecording ORM object to a dict with has_audio and agent info."""
    agent_name = rec.agent_name
    if not agent_name and rec.agent:
        agent_name = rec.agent.display_name or rec.agent.full_name or rec.agent.email.split("@")[0]

    ticket_number = None
    ticket_id = None
    customer_name = None
    parent_ticket_number = None
    if db:
        from app.models.ticket import Ticket
        from datetime import timedelta
        # Prefer the ticket_number stored directly on the record (set at creation).
        # This correctly shows TCK-... for initial calls and FLW-... for follow-ups.
        stored_number = getattr(rec, 'ticket_number', None)
        if stored_number:
            linked = db.query(Ticket).filter(Ticket.ticket_number == stored_number).first()
            if linked:
                ticket_number = linked.ticket_number
                ticket_id = linked.id
                customer_name = linked.customer_name
                if linked.parent_ticket_id and linked.parent_ticket:
                    parent_ticket_number = linked.parent_ticket.ticket_number
        else:
            # Fallback for records that pre-date the ticket_number column:
            # find the closest origin ticket by timestamp and persist the link.
            origin_q = db.query(Ticket).filter(
                Ticket.phone_number == rec.phone_number,
                Ticket.parent_ticket_id == None  # noqa: E711
            )
            if rec.created_at:
                window = timedelta(hours=24)
                origin_ticket = origin_q.filter(
                    Ticket.created_at >= rec.created_at - window,
                    Ticket.created_at <= rec.created_at + window
                ).order_by(Ticket.created_at.desc()).first()
                if not origin_ticket:
                    origin_ticket = origin_q.order_by(Ticket.created_at.desc()).first()
            else:
                origin_ticket = origin_q.order_by(Ticket.created_at.desc()).first()
            if origin_ticket:
                ticket_number = origin_ticket.ticket_number
                ticket_id = origin_ticket.id
                customer_name = origin_ticket.customer_name
                # Persist so fallback doesn't re-run
                rec.ticket_number = origin_ticket.ticket_number
                try:
                    db.commit()
                except Exception:
                    db.rollback()

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
        "ticket_number": ticket_number,
        "ticket_id": ticket_id,
        "customer_name": customer_name,
        "parent_ticket_number": parent_ticket_number,
    }


@router.get("/recordings")
def get_call_recordings(
    skip: int = 0,
    limit: int = 50,
    # Filters
    agent_id: Optional[int] = Query(None, description="Filter by agent ID"),
    my_only: Optional[bool] = Query(None, description="Force filter to current user's calls only"),
    phone: Optional[str] = Query(None, description="Search by customer phone number"),
    direction: Optional[str] = Query(None, description="inbound or outbound"),
    date_from: Optional[date] = Query(None, description="Start date (YYYY-MM-DD)"),
    date_to: Optional[date] = Query(None, description="End date (YYYY-MM-DD)"),
    has_recording: Optional[bool] = Query(None, description="Filter to calls with audio"),
    organization_id: Optional[int] = Query(None, description="Filter by organization ID"),
    ticket_status: Optional[TicketStatus] = Query(None, description="Filter by Ticket Status"),
    ticket_priority: Optional[TicketPriority] = Query(None, description="Filter by Ticket Priority"),
    ticket_category: Optional[str] = Query(None, description="Filter by Ticket Category"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Retrieve call recordings with full search/filter support.
    Agents see only their own calls. Admins see all (unless my_only=true).
    """
    query = db.query(CallRecording)

    # Role-based scoping — my_only forces current-user filter regardless of role
    if my_only:
        query = query.filter(CallRecording.agent_id == current_user.id)
    elif not current_user.role == "admin":
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

    # Organization filter
    if organization_id:
        query = query.filter(CallRecording.organization_id == organization_id)

    # Ticket fields filter
    if ticket_status or ticket_priority or ticket_category:
        query = query.join(Ticket, CallRecording.phone_number == Ticket.phone_number)
        if ticket_status:
            query = query.filter(Ticket.status == ticket_status)
        if ticket_priority:
            query = query.filter(Ticket.priority == ticket_priority)
        if ticket_category:
            query = query.filter(Ticket.category == ticket_category)
        query = query.distinct()

    total = query.count()
    recs = query.order_by(CallRecording.created_at.desc()).offset(skip).limit(limit).all()

    return {
        "total": total,
        "skip": skip,
        "limit": limit,
        "results": [_enrich(r, db) for r in recs],
    }


@router.get("/recordings/stats")
def get_recording_stats(
    agent_id: Optional[int] = Query(None),
    organization_id: Optional[int] = Query(None),
    date_from: Optional[date] = Query(None),
    date_to: Optional[date] = Query(None),
    ticket_status: Optional[TicketStatus] = Query(None),
    ticket_priority: Optional[TicketPriority] = Query(None),
    ticket_category: Optional[str] = Query(None),
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
    if organization_id:
        query = query.filter(CallRecording.organization_id == organization_id)

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
        organization_id=recording.organization_id,
    )
    db.add(new_recording)
    db.commit()
    db.refresh(new_recording)
    return _enrich(new_recording, db)


from pydantic import BaseModel


class MissedCallRequest(BaseModel):
    phone_number: str


@router.post("/log-missed")
def log_missed_call(
    req: MissedCallRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Log a missed/rejected inbound call from the softphone."""
    try:
        missed = CallRecording(
            agent_id=current_user.id,
            agent_name=getattr(current_user, 'display_name', None)
                       or getattr(current_user, 'full_name', None)
                       or current_user.email,
            phone_number=req.phone_number,
            direction="inbound",
            disposition="NO ANSWER",
            duration_seconds=0,
        )
        db.add(missed)
        db.commit()
        db.refresh(missed)
        return _enrich(missed, db)
    except Exception as e:
        db.rollback()
        print(f"[log-missed] Error logging missed call: {e}")
        # Return a minimal response so the frontend doesn't see a 500
        return {
            "id": None,
            "phone_number": req.phone_number,
            "direction": "inbound",
            "disposition": "NO ANSWER",
            "duration_seconds": 0,
            "agent_name": "Unknown",
            "created_at": None,
            "has_audio": False,
            "ticket_number": None,
            "ticket_id": None,
            "customer_name": None,
        }


class OriginateRequest(BaseModel):
    phone_number: str

@router.post("/originate")
def originate_call(
    request: OriginateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Trigger an outbound call using AMI. 
    It rings the agent's extension first, then bridges to the requested phone number.
    """
    # Look up agent's PBX extension
    from app.models.agent_extension import AgentExtension
    ext = db.query(AgentExtension).filter(AgentExtension.agent_id == current_user.id).first()
    if not ext or not ext.extension:
        raise HTTPException(status_code=400, detail="Agent has no PBX extension configured.")

    from app.services.ami_service import get_ami_client, get_outbound_channel
    
    client = get_ami_client(db)
    if not client:
        raise HTTPException(status_code=503, detail="Click-to-Call is not configured (AMI settings missing).")

    # Channel to ring first (the agent)
    # Usually SIP/<extension> or PJSIP/<extension>
    agent_channel = f"PJSIP/{ext.extension}"
    
    # We use local context routing to then dial the target number
    app_context = "from-internal"
    
    action_id = client.originate(
        channel=agent_channel,
        context=app_context,
        exten=request.phone_number,
        priority=1,
        callerid=f"Outbound <{ext.extension}>",
        timeout=30000
    )
    
    client.logoff()
    
    if action_id:
        return {"status": "success", "action_id": action_id}
    else:
        raise HTTPException(status_code=500, detail="Failed to originate call via PBX.")


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


@router.get("/incoming-webhook")
def incoming_webhook(
    phone: str = Query(..., description="Incoming caller's phone number"),
    db: Session = Depends(get_db)
):
    """
    Webhook for FreePBX to look up caller's name and organization by phone number.
    Returns caller info and a URL to a generated TTS greeting.
    No authentication required as it's called by the local PBX.
    """
    # Remove any non-numeric characters for more robust matching, but usually '+1234'
    clean_phone = "".join(filter(str.isdigit, phone))
    # We will search with the clean phone or the original phone
    search_term = [phone]
    if clean_phone and clean_phone != phone:
        search_term.append(clean_phone)
        
    caller_name = None
    organization_name = None

    for term in search_term:
        if caller_name:
            break
            
        # 1. Search Organization Contacts
        # Cast JSON column to String for simple LIKE search
        from sqlalchemy import cast, String
        org_contact = db.query(OrganizationContact).filter(
            cast(OrganizationContact.phone_no, String).ilike(f"%{term}%")
        ).first()

        if org_contact:
            caller_name = org_contact.full_name
            if org_contact.organization:
                organization_name = org_contact.organization.organization_name
            break

        # 2. Search Organizations directly
        org = db.query(Organization).filter(
            cast(Organization.contact_numbers, String).ilike(f"%{term}%")
        ).first()
        if org:
            organization_name = org.organization_name
            caller_name = "Valued Customer" # Default generic caller for organization
            break

        # 3. Search Users Contacts
        contact = db.query(Contact).filter(Contact.phone.ilike(f"%{term}%")).first()
        if contact:
            caller_name = contact.name
            break

    # Determine Greeting
    if caller_name and organization_name:
        greeting_text = f"Welcome to {organization_name}, {caller_name}."
    elif caller_name:
        greeting_text = f"Welcome, {caller_name}."
    elif organization_name:
        greeting_text = f"Welcome to {organization_name}."
    else:
        greeting_text = "Welcome."

    # Generate TTS Audio
    # You can change language here if needed, keeping English as default
    tts_path = text_to_speech(greeting_text, lang="en")
    
    # Check if TTS was successful
    if tts_path and os.path.exists(tts_path):
        from urllib.parse import quote
        filename = os.path.basename(tts_path)
        # Using a relative path for the stream endpoint
        tts_url = f"/calls/tts-stream/{quote(filename)}"
    else:
        tts_url = None

    return {
        "status": "success",
        "phone": phone,
        "caller_name": caller_name,
        "organization_name": organization_name,
        "greeting_text": greeting_text,
        "tts_url": tts_url
    }

@router.get("/tts-stream/{filename}")
def stream_tts_audio(filename: str):
    """
    Stream a generated TTS audio file to the caller (e.g., FreePBX).
    """
    from app.services.tts_service import TTS_CACHE_DIR
    import os

    # Ensure filename doesn't contain directory traversal sequences
    safe_filename = os.path.basename(filename)
    audio_path = os.path.join(TTS_CACHE_DIR, safe_filename)

    if not os.path.exists(audio_path):
        raise HTTPException(status_code=404, detail="TTS audio file not found")

    from fastapi.responses import FileResponse
    return FileResponse(audio_path, media_type="audio/mpeg" if audio_path.endswith(".mp3") else "audio/wav")


# ── Call Transfer (AMI Redirect) ───────────────────────────────────────────

class TransferRequest(BaseModel):
    target_extension: str

@router.post("/transfer")
def transfer_call(
    request: TransferRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Blind-transfer the agent's current call to another extension via AMI Redirect.
    The agent's channel is redirected to the target extension in from-internal context.
    """
    from app.models.agent_extension import AgentExtension
    ext = db.query(AgentExtension).filter(AgentExtension.agent_id == current_user.id).first()
    if not ext or not ext.extension:
        raise HTTPException(status_code=400, detail="Agent has no PBX extension configured.")

    from app.services.ami_service import get_ami_client
    client = get_ami_client(db)
    if not client:
        raise HTTPException(status_code=503, detail="AMI not configured.")

    # AMI Redirect — moves the agent's active channel to the target extension
    action_id = f"xfer-{int(__import__('time').time() * 1000)}"
    cmd = (
        f"Action: Redirect\r\n"
        f"ActionID: {action_id}\r\n"
        f"Channel: PJSIP/{ext.extension}\r\n"
        f"Context: from-internal\r\n"
        f"Exten: {request.target_extension}\r\n"
        f"Priority: 1\r\n"
        f"\r\n"
    )
    client._send(cmd)
    response = client._read_response()
    client.logoff()

    if "Success" in response:
        return {"status": "success", "message": f"Call transferred to {request.target_extension}"}
    else:
        raise HTTPException(status_code=500, detail=f"Transfer failed: {response.strip()}")


# ── Conference Call (AMI-based — bridge parties into ConfBridge) ────────────

class ConferenceRequest(BaseModel):
    current_extension: str
    target_extension: str

@router.post("/conference")
def conference_call(
    request: ConferenceRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Start a 3-way conference by moving both the agent's channel AND the connected
    caller channel into an Asterisk ConfBridge room, then dialling the target
    extension into the same room.

    Uses AMI Redirect with Channel + ExtraChannel so both legs of the existing
    bridge are moved atomically into the ConfBridge. This prevents audio leaking
    between parties outside the conference.
    """
    from app.services.ami_service import get_ami_client
    import time

    client = get_ami_client(db)
    if not client:
        raise HTTPException(status_code=503, detail="AMI not configured.")

    # Use agent's extension + timestamp as a unique conference room number
    conf_room = f"{request.current_extension}{int(time.time()) % 10000}"

    # 1. Find the agent's active channel and its bridged peer via AMI
    #    so we can redirect BOTH legs into ConfBridge
    agent_channel = None
    peer_channel = None
    try:
        # Get active channels for the agent's extension
        action_id_status = f"conf-status-{int(time.time() * 1000)}"
        cmd_status = (
            f"Action: Command\r\n"
            f"ActionID: {action_id_status}\r\n"
            f"Command: core show channel concise\r\n"
            f"\r\n"
        )
        client._send(cmd_status)
        status_resp = client._read_response()

        # Parse channels — find PJSIP/{extension} channels
        for line in status_resp.split('\n'):
            line = line.strip()
            if f"PJSIP/{request.current_extension}-" in line:
                parts = line.split('!')
                if parts:
                    agent_channel = parts[0]
                    break

        # If we found the agent channel, find its bridge peer
        if agent_channel:
            action_id_bridge = f"conf-bridge-{int(time.time() * 1000)}"
            cmd_bridge = (
                f"Action: Command\r\n"
                f"ActionID: {action_id_bridge}\r\n"
                f"Command: core show channel {agent_channel}\r\n"
                f"\r\n"
            )
            client._send(cmd_bridge)
            bridge_resp = client._read_response()
            # Look for "Bridged to:" or the bridged channel in output
            for line in bridge_resp.split('\n'):
                if 'BridgedChannel' in line or 'Bridged' in line:
                    # Extract channel name after the colon
                    parts = line.split(':', 1)
                    if len(parts) > 1:
                        ch = parts[1].strip()
                        if ch and ch != '<none>' and ch != '(None)':
                            peer_channel = ch
                            break
    except Exception as e:
        print(f"[Conference] Channel lookup warning: {e}")

    # 2. Redirect both the agent channel and the bridged peer into ConfBridge
    #    Using ExtraChannel ensures both legs move atomically into the conference.
    action_id1 = f"conf-redir-{int(time.time() * 1000)}"
    if agent_channel and peer_channel:
        # Move both legs into ConfBridge simultaneously
        cmd1 = (
            f"Action: Redirect\r\n"
            f"ActionID: {action_id1}\r\n"
            f"Channel: {agent_channel}\r\n"
            f"ExtraChannel: {peer_channel}\r\n"
            f"Context: from-internal\r\n"
            f"Exten: {conf_room}\r\n"
            f"Priority: 1\r\n"
            f"ExtraContext: from-internal\r\n"
            f"ExtraExten: {conf_room}\r\n"
            f"ExtraPriority: 1\r\n"
            f"\r\n"
        )
    else:
        # Fallback: redirect just the agent channel
        cmd1 = (
            f"Action: Redirect\r\n"
            f"ActionID: {action_id1}\r\n"
            f"Channel: PJSIP/{request.current_extension}\r\n"
            f"Context: from-internal\r\n"
            f"Exten: {conf_room}\r\n"
            f"Priority: 1\r\n"
            f"\r\n"
        )
    client._send(cmd1)
    client._read_response()

    # Small delay to let the redirect complete before originating the third party
    import time as _time
    _time.sleep(0.5)

    # 3. Originate a call to the target extension and put them in the same ConfBridge
    action_id2 = f"conf-invite-{int(time.time() * 1000)}"
    client.originate(
        channel=f"PJSIP/{request.target_extension}",
        application="ConfBridge",
        app_data=conf_room,
        callerid=f"Conference <{request.current_extension}>",
        timeout=30000,
        action_id=action_id2,
    )
    client.logoff()

    return {
        "status": "success",
        "conference_room": conf_room,
        "message": f"Conference started — calling {request.target_extension} into room {conf_room}",
    }

