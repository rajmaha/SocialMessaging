# backend/app/routes/visitors.py
import asyncio
import logging
import os
import subprocess
import uuid
from datetime import datetime
from typing import List, Literal, Optional

import requests as http_requests
from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File
from fastapi.responses import Response
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import get_admin_user
from app.models.user import User
from app.models.visitors import Visit, VisitorLocation, VisitorProfile
from app.schemas.visitors import (
    VisitCreate, VisitOut,
    VisitorLocationCreate, VisitorLocationOut, VisitorLocationUpdate,
    VisitorProfileOut,
)
from app.services.events_service import EventTypes, events_service

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/visitors", tags=["visitors"])

PROFILE_PHOTO_DIR = os.path.join(os.path.dirname(__file__), "..", "attachment_storage", "visitors", "profiles")
CCTV_PHOTO_DIR = os.path.join(os.path.dirname(__file__), "..", "attachment_storage", "visitors", "cctv")
HLS_OUTPUT_DIR = "/tmp/hls"

# In-memory map of location_id → running ffmpeg subprocess
_stream_processes: dict = {}


def _is_rtsp(url: str) -> bool:
    return url.lower().startswith("rtsp://") or url.lower().startswith("rtsps://")


def _capture_rtsp_snapshot(rtsp_url: str, output_path: str) -> bool:
    """Use ffmpeg to grab a single frame from an RTSP stream and save as JPEG."""
    try:
        result = subprocess.run(
            [
                "ffmpeg", "-y",
                "-rtsp_transport", "tcp",
                "-i", rtsp_url,
                "-frames:v", "1",
                "-q:v", "2",
                output_path,
            ],
            timeout=15,
            capture_output=True,
        )
        return result.returncode == 0 and os.path.exists(output_path)
    except Exception as exc:
        logger.warning("ffmpeg RTSP snapshot failed: %s", exc)
        return False


# ── Helpers ───────────────────────────────────────────────────────────────────

def _visit_out(visit: Visit, db: Session) -> VisitOut:
    profile = db.query(VisitorProfile).filter(VisitorProfile.id == visit.visitor_profile_id).first()
    location = db.query(VisitorLocation).filter(VisitorLocation.id == visit.location_id).first() if visit.location_id else None
    host = db.query(User).filter(User.id == visit.host_agent_id).first() if visit.host_agent_id else None

    def _photo_url(path: Optional[str], prefix: str) -> Optional[str]:
        if not path:
            return None
        fname = os.path.basename(path)
        return f"/{prefix}/{fname}"

    return VisitOut(
        id=visit.id,
        visitor_profile_id=visit.visitor_profile_id,
        visitor_name=profile.name if profile else "Unknown",
        visitor_organization=profile.organization if profile else None,
        visitor_photo_url=_photo_url(profile.photo_path if profile else None, "visitor-photos"),
        location_id=visit.location_id,
        location_name=location.name if location else None,
        num_visitors=visit.num_visitors,
        purpose=visit.purpose,
        host_agent_id=visit.host_agent_id,
        host_agent_name=getattr(host, "display_name", None) or getattr(host, "email", None) if host else None,
        check_in_at=visit.check_in_at,
        check_out_at=visit.check_out_at,
        cctv_photo_url=_photo_url(visit.cctv_photo_path, "visitor-cctv"),
        created_by=visit.created_by,
        status="checked_out" if visit.check_out_at else "checked_in",
    )


def _notify_host(host_agent_id: int, visit: Visit, profile: VisitorProfile,
                 location_name: Optional[str]):
    """Fire-and-forget SSE notification to host agent."""
    event = events_service.create_event(
        EventTypes.VISITOR_CHECKIN,
        {
            "visit_id": visit.id,
            "visitor_name": profile.name,
            "organization": profile.organization,
            "purpose": visit.purpose,
            "num_visitors": visit.num_visitors,
            "location": location_name,
        },
    )
    try:
        asyncio.ensure_future(events_service.broadcast_to_user(host_agent_id, event))
    except RuntimeError:
        pass


# ── Locations ─────────────────────────────────────────────────────────────────

@router.get("/locations", response_model=List[VisitorLocationOut])
def list_locations(db: Session = Depends(get_db), _: User = Depends(get_admin_user)):
    return db.query(VisitorLocation).order_by(VisitorLocation.name).all()


@router.post("/locations", response_model=VisitorLocationOut)
def create_location(payload: VisitorLocationCreate, db: Session = Depends(get_db),
                    _: User = Depends(get_admin_user)):
    loc = VisitorLocation(**payload.model_dump())
    db.add(loc)
    db.commit()
    db.refresh(loc)
    return loc


@router.put("/locations/{loc_id}", response_model=VisitorLocationOut)
def update_location(loc_id: int, payload: VisitorLocationUpdate, db: Session = Depends(get_db),
                    _: User = Depends(get_admin_user)):
    loc = db.query(VisitorLocation).filter(VisitorLocation.id == loc_id).first()
    if not loc:
        raise HTTPException(status_code=404, detail="Location not found")
    for k, v in payload.model_dump(exclude_none=True).items():
        setattr(loc, k, v)
    db.commit()
    db.refresh(loc)
    return loc


@router.delete("/locations/{loc_id}")
def delete_location(loc_id: int, db: Session = Depends(get_db), _: User = Depends(get_admin_user)):
    loc = db.query(VisitorLocation).filter(VisitorLocation.id == loc_id).first()
    if not loc:
        raise HTTPException(status_code=404, detail="Location not found")
    db.delete(loc)
    db.commit()
    return {"ok": True}


@router.get("/locations/{loc_id}/snapshot")
def get_cctv_snapshot(loc_id: int, db: Session = Depends(get_db)):
    """Proxy a single frame from the IP camera — no auth needed (used by kiosk).
    Supports both HTTP (MJPEG/snapshot) and RTSP cameras via ffmpeg."""
    loc = db.query(VisitorLocation).filter(VisitorLocation.id == loc_id).first()
    if not loc or not loc.ip_camera_url:
        raise HTTPException(status_code=404, detail="No camera configured for this location")

    if _is_rtsp(loc.ip_camera_url):
        # Use ffmpeg to grab a single frame from RTSP
        tmp_path = f"/tmp/snapshot_{loc_id}_{uuid.uuid4().hex}.jpg"
        ok = _capture_rtsp_snapshot(loc.ip_camera_url, tmp_path)
        if not ok:
            raise HTTPException(status_code=502, detail="RTSP camera unreachable or ffmpeg not installed")
        try:
            with open(tmp_path, "rb") as f:
                data = f.read()
        finally:
            try:
                os.remove(tmp_path)
            except OSError:
                pass
        return Response(content=data, media_type="image/jpeg")
    else:
        try:
            resp = http_requests.get(loc.ip_camera_url, timeout=5, stream=True)
            resp.raise_for_status()
            content_type = resp.headers.get("content-type", "image/jpeg")
            return Response(content=resp.content, media_type=content_type)
        except Exception as exc:
            raise HTTPException(status_code=502, detail=f"Camera unreachable: {exc}")


def _build_ffmpeg_cmd(rtsp_url: str, out_dir: str, codec: Literal["copy", "transcode"] = "copy") -> list:
    """Build the ffmpeg command for low-latency HLS output.
    codec: 'copy' for passthrough, 'transcode' for libx264 re-encoding fallback.
    """
    base = [
        "ffmpeg", "-y",
        # Low-latency input flags
        "-fflags", "nobuffer",
        "-flags", "low_delay",
        "-analyzeduration", "0",
        "-probesize", "500000",
        "-rtsp_transport", "tcp",
        "-i", rtsp_url,
    ]

    if codec == "copy":
        video_flags = ["-c:v", "copy"]
    else:
        video_flags = [
            "-c:v", "libx264",
            "-preset", "ultrafast",
            "-tune", "zerolatency",
            "-g", "30",
            "-sc_threshold", "0",
        ]

    hls_flags = [
        "-an",                  # no audio (avoids sync issues in copy mode)
        "-f", "hls",
        "-hls_time", "1",       # 1s segments (was 2)
        "-hls_list_size", "3",  # 3s total buffer (was 5 = 10s)
        "-hls_flags", "delete_segments+omit_endlist+split_by_time",
        os.path.join(out_dir, "index.m3u8"),
    ]

    return base + video_flags + hls_flags


@router.post("/locations/{loc_id}/stream/start")
async def start_camera_stream(loc_id: int, db: Session = Depends(get_db)):
    """Start a live HLS stream from the location's RTSP camera via ffmpeg.

    Tries codec copy first (zero CPU if camera outputs H.264). If ffmpeg
    exits within 2 seconds (incompatible codec), restarts with libx264.
    """
    loc = db.query(VisitorLocation).filter(VisitorLocation.id == loc_id).first()
    if not loc or not loc.ip_camera_url:
        raise HTTPException(status_code=404, detail="No camera configured for this location")

    # If already running, return its URL
    existing = _stream_processes.get(loc_id)
    if existing and existing.poll() is None:
        return {"ok": True, "stream_url": f"/hls/{loc_id}/index.m3u8", "already_running": True}

    out_dir = os.path.join(HLS_OUTPUT_DIR, str(loc_id))
    os.makedirs(out_dir, exist_ok=True)

    try:
        # Attempt 1: copy (passthrough — fastest, zero CPU)
        cmd = _build_ffmpeg_cmd(loc.ip_camera_url, out_dir, codec="copy")
        proc = subprocess.Popen(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
        await asyncio.sleep(2)

        if proc.poll() is not None:
            # Copy failed (camera likely uses non-H.264 codec) — fall back to transcode
            logger.info("Stream copy mode failed for loc %s, retrying with libx264", loc_id)
            cmd = _build_ffmpeg_cmd(loc.ip_camera_url, out_dir, codec="transcode")
            proc = subprocess.Popen(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

        _stream_processes[loc_id] = proc
        return {"ok": True, "stream_url": f"/hls/{loc_id}/index.m3u8", "already_running": False}

    except FileNotFoundError:
        raise HTTPException(status_code=500, detail="ffmpeg not installed on server")
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to start stream: {exc}")


@router.post("/locations/{loc_id}/stream/stop")
def stop_camera_stream(loc_id: int):
    """Stop the live HLS stream for a location."""
    proc = _stream_processes.pop(loc_id, None)
    if proc:
        proc.terminate()
        try:
            proc.wait(timeout=3)
        except subprocess.TimeoutExpired:
            proc.kill()
    return {"ok": True}


@router.get("/locations/{loc_id}/stream/status")
def camera_stream_status(loc_id: int):
    """Check whether the live HLS stream for a location is currently running."""
    proc = _stream_processes.get(loc_id)
    running = proc is not None and proc.poll() is None
    return {
        "running": running,
        "stream_url": f"/hls/{loc_id}/index.m3u8" if running else None,
    }


@router.get("/locations/{loc_id}/stream/ready")
def camera_stream_ready(loc_id: int):
    """Return ready=true once the HLS manifest has at least one .ts segment.

    The frontend polls this every 500ms instead of using a hardcoded sleep.
    Returns 200 always (never 404) so the frontend can poll without error handling.
    """
    manifest_path = os.path.join(HLS_OUTPUT_DIR, str(loc_id), "index.m3u8")
    if not os.path.exists(manifest_path):
        return {"ready": False}
    try:
        with open(manifest_path) as f:
            content = f.read()
        # Ready when at least one transport stream segment is listed
        ready = ".ts" in content
    except OSError:
        return {"ready": False}
    return {"ready": ready}


# ── Profile search (kiosk lookup) ─────────────────────────────────────────────

@router.get("/profiles/search", response_model=List[VisitorProfileOut])
def search_profiles(q: str = Query(..., min_length=2), db: Session = Depends(get_db)):
    """Public endpoint — search by phone or email for returning visitor lookup."""
    results = (
        db.query(VisitorProfile)
        .filter(
            (VisitorProfile.contact_no.ilike(f"%{q}%")) |
            (VisitorProfile.email.ilike(f"%{q}%"))
        )
        .limit(5)
        .all()
    )
    def _url(p: VisitorProfile) -> Optional[str]:
        if not p.photo_path:
            return None
        return f"/visitor-photos/{os.path.basename(p.photo_path)}"

    return [
        VisitorProfileOut(
            id=p.id, name=p.name, address=p.address,
            contact_no=p.contact_no, email=p.email,
            organization=p.organization,
            photo_url=_url(p),
            created_at=p.created_at,
        )
        for p in results
    ]


# ── Photo upload ──────────────────────────────────────────────────────────────

@router.post("/upload-photo")
async def upload_visitor_photo(file: UploadFile = File(...)):
    """Public endpoint — upload webcam capture, returns filename."""
    ALLOWED_TYPES = {"image/jpeg", "image/png", "image/webp"}
    MAX_SIZE_MB = 5
    if file.content_type not in ALLOWED_TYPES:
        raise HTTPException(status_code=400, detail="Only JPEG, PNG, and WebP images are allowed")
    content = await file.read()
    if len(content) > MAX_SIZE_MB * 1024 * 1024:
        raise HTTPException(status_code=400, detail=f"File too large (max {MAX_SIZE_MB}MB)")
    os.makedirs(PROFILE_PHOTO_DIR, exist_ok=True)
    ext = os.path.splitext(file.filename or "photo.jpg")[1] or ".jpg"
    fname = f"{uuid.uuid4().hex}{ext}"
    fpath = os.path.join(PROFILE_PHOTO_DIR, fname)
    with open(fpath, "wb") as f:
        f.write(content)
    return {"path": fpath, "url": f"/visitor-photos/{fname}"}


# ── Kiosk: find active visits by phone (for checkout) ─────────────────────────

@router.get("/kiosk/active-visits")
def kiosk_active_visits(contact_no: str = Query(...), db: Session = Depends(get_db)):
    """Public endpoint — find open visits for a visitor (by phone) for kiosk checkout."""
    profile = db.query(VisitorProfile).filter(
        VisitorProfile.contact_no == contact_no
    ).first()
    if not profile:
        return []
    visits = (
        db.query(Visit)
        .filter(Visit.visitor_profile_id == profile.id, Visit.check_out_at.is_(None))
        .order_by(Visit.check_in_at.desc())
        .limit(5)
        .all()
    )
    return [_visit_out(v, db) for v in visits]


# ── Agent list (for host dropdown in kiosk) ───────────────────────────────────

@router.get("/agents/list")
def list_agents(db: Session = Depends(get_db)):
    """Public endpoint — returns minimal user list for host dropdown in kiosk."""
    users = db.query(User).filter(User.is_active == True).order_by(User.email).all()
    return [
        {"id": u.id, "name": u.display_name or u.email, "email": u.email}
        for u in users
    ]


# ── Visits ────────────────────────────────────────────────────────────────────

@router.get("/", response_model=List[VisitOut])
def list_visits(
    status: Optional[str] = Query(None),
    location_id: Optional[int] = Query(None),
    date_from: Optional[str] = Query(None),
    date_to: Optional[str] = Query(None),
    search: Optional[str] = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=200),
    db: Session = Depends(get_db),
    _: User = Depends(get_admin_user),
    response: Response = None,
):
    q = db.query(Visit)
    if location_id:
        q = q.filter(Visit.location_id == location_id)
    if status == "checked_in":
        q = q.filter(Visit.check_out_at.is_(None))
    elif status == "checked_out":
        q = q.filter(Visit.check_out_at.isnot(None))
    if date_from:
        q = q.filter(Visit.check_in_at >= datetime.fromisoformat(date_from))
    if date_to:
        q = q.filter(Visit.check_in_at <= datetime.fromisoformat(date_to))
    if search:
        profile_ids = [
            p.id for p in db.query(VisitorProfile)
            .filter(
                VisitorProfile.name.ilike(f"%{search}%") |
                VisitorProfile.organization.ilike(f"%{search}%")
            ).all()
        ]
        q = q.filter(Visit.visitor_profile_id.in_(profile_ids))
    total = q.count()
    visits = q.order_by(Visit.check_in_at.desc()).offset((page - 1) * page_size).limit(page_size).all()
    if response is not None:
        response.headers["X-Total-Count"] = str(total)
        response.headers["X-Page"] = str(page)
        response.headers["X-Page-Size"] = str(page_size)
        response.headers["Access-Control-Expose-Headers"] = "X-Total-Count, X-Page, X-Page-Size"
    return [_visit_out(v, db) for v in visits]


@router.get("/{visit_id}", response_model=VisitOut)
def get_visit(visit_id: int, db: Session = Depends(get_db), _: User = Depends(get_admin_user)):
    visit = db.query(Visit).filter(Visit.id == visit_id).first()
    if not visit:
        raise HTTPException(status_code=404, detail="Visit not found")
    return _visit_out(visit, db)


@router.post("/", response_model=VisitOut)
def create_visit(
    payload: VisitCreate,
    db: Session = Depends(get_db),
):
    """
    Create a new visit (check-in). Works for both agents and kiosk (no auth required).
    Creates or reuses a VisitorProfile matched by contact_no or email.
    Grabs CCTV snapshot if location has a camera.
    Fires SSE notification to host agent.
    """
    # Find or create visitor profile
    profile = None
    if payload.visitor_contact_no:
        profile = db.query(VisitorProfile).filter(
            VisitorProfile.contact_no == payload.visitor_contact_no
        ).first()
    if not profile and payload.visitor_email:
        profile = db.query(VisitorProfile).filter(
            VisitorProfile.email == payload.visitor_email
        ).first()

    if profile:
        profile.name = payload.visitor_name
        if payload.visitor_address:
            profile.address = payload.visitor_address
        if payload.visitor_organization:
            profile.organization = payload.visitor_organization
        if payload.visitor_photo_path:
            profile.photo_path = payload.visitor_photo_path
    else:
        profile = VisitorProfile(
            name=payload.visitor_name,
            address=payload.visitor_address,
            contact_no=payload.visitor_contact_no,
            email=payload.visitor_email,
            organization=payload.visitor_organization,
            photo_path=payload.visitor_photo_path,
        )
        db.add(profile)
        db.flush()

    # Grab CCTV snapshot (supports both HTTP and RTSP cameras)
    cctv_path: Optional[str] = None
    loc = None
    if payload.location_id:
        loc = db.query(VisitorLocation).filter(VisitorLocation.id == payload.location_id).first()
        if loc and loc.ip_camera_url:
            os.makedirs(CCTV_PHOTO_DIR, exist_ok=True)
            fname = f"{uuid.uuid4().hex}.jpg"
            dest = os.path.join(CCTV_PHOTO_DIR, fname)
            try:
                if _is_rtsp(loc.ip_camera_url):
                    if _capture_rtsp_snapshot(loc.ip_camera_url, dest):
                        cctv_path = dest
                    else:
                        logger.warning("RTSP snapshot failed for location %s", payload.location_id)
                else:
                    resp = http_requests.get(loc.ip_camera_url, timeout=5)
                    if resp.ok:
                        with open(dest, "wb") as f:
                            f.write(resp.content)
                        cctv_path = dest
            except Exception as e:
                logger.warning("CCTV snapshot failed: %s", e)

    visit = Visit(
        visitor_profile_id=profile.id,
        location_id=payload.location_id,
        num_visitors=payload.num_visitors,
        purpose=payload.purpose,
        host_agent_id=payload.host_agent_id,
        visitor_photo_path=payload.visitor_photo_path,
        cctv_photo_path=cctv_path,
        check_in_at=datetime.utcnow(),
    )
    db.add(visit)
    db.commit()
    db.refresh(visit)

    # SSE notification to host
    if payload.host_agent_id:
        location_name = loc.name if loc else None
        _notify_host(payload.host_agent_id, visit, profile, location_name)

    return _visit_out(visit, db)


@router.patch("/{visit_id}/checkout", response_model=VisitOut)
def checkout_visit(visit_id: int, db: Session = Depends(get_db)):
    """Public endpoint — kiosk and agents can both call this."""
    visit = db.query(Visit).filter(Visit.id == visit_id).first()
    if not visit:
        raise HTTPException(status_code=404, detail="Visit not found")
    if visit.check_out_at:
        raise HTTPException(status_code=400, detail="Already checked out")
    visit.check_out_at = datetime.utcnow()
    db.commit()
    db.refresh(visit)
    return _visit_out(visit, db)
