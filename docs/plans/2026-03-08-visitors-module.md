# Visitors Module Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a Visitors Management Module with self-service kiosk, agent admin panel, webcam/IP camera photo capture, and SSE check-in notifications.

**Architecture:** Three-table design (`visitor_locations`, `visitor_profiles`, `visits`) following existing SQLAlchemy/FastAPI patterns. Public kiosk at `/kiosk/[locationId]` requires no auth. Admin panel at `/admin/visitors` is authenticated. SSE notifications via the existing `events_service.broadcast_to_user`.

**Tech Stack:** FastAPI, SQLAlchemy ORM, PostgreSQL (inline migrations in main.py), Next.js 14 App Router, TypeScript, TailwindCSS, browser MediaDevices API (webcam), `requests` (IP camera snapshot), existing `events_service`.

---

## Task 1: Backend Models

**Files:**
- Create: `backend/app/models/visitors.py`

**Step 1: Create the models file**

```python
# backend/app/models/visitors.py
from datetime import datetime
from sqlalchemy import Column, Integer, String, Text, DateTime, ForeignKey
from app.database import Base


class VisitorLocation(Base):
    __tablename__ = "visitor_locations"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    ip_camera_url = Column(String, nullable=True)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)


class VisitorProfile(Base):
    __tablename__ = "visitor_profiles"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    address = Column(Text, nullable=True)
    contact_no = Column(String, nullable=True)
    email = Column(String, nullable=True)
    organization = Column(String, nullable=True)
    photo_path = Column(String, nullable=True)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)


class Visit(Base):
    __tablename__ = "visits"

    id = Column(Integer, primary_key=True, index=True)
    visitor_profile_id = Column(Integer, ForeignKey("visitor_profiles.id", ondelete="CASCADE"), nullable=False, index=True)
    location_id = Column(Integer, ForeignKey("visitor_locations.id", ondelete="SET NULL"), nullable=True)
    num_visitors = Column(Integer, nullable=False, default=1)
    purpose = Column(String, nullable=False)
    host_agent_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    check_in_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    check_out_at = Column(DateTime, nullable=True)
    visitor_photo_path = Column(String, nullable=True)
    cctv_photo_path = Column(String, nullable=True)
    created_by = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
```

**Step 2: Register models in main.py**

In `backend/main.py`, add to the imports block (near line 30, with other model imports):
```python
from app.models.visitors import VisitorLocation, VisitorProfile, Visit  # noqa: F401
```

**Step 3: Create photo storage directories**

```bash
mkdir -p backend/app/attachment_storage/visitors/profiles
mkdir -p backend/app/attachment_storage/visitors/cctv
touch backend/app/attachment_storage/visitors/profiles/.gitkeep
touch backend/app/attachment_storage/visitors/cctv/.gitkeep
```

**Step 4: Mount the static directories in main.py**

Find where other StaticFiles are mounted in `backend/main.py` (look for `app.mount`), and add:
```python
os.makedirs("app/attachment_storage/visitors/profiles", exist_ok=True)
os.makedirs("app/attachment_storage/visitors/cctv", exist_ok=True)
app.mount("/visitor-photos", StaticFiles(directory="app/attachment_storage/visitors/profiles"), name="visitor-photos")
app.mount("/visitor-cctv", StaticFiles(directory="app/attachment_storage/visitors/cctv"), name="visitor-cctv")
```

**Step 5: Commit**

```bash
git add backend/app/models/visitors.py backend/main.py backend/app/attachment_storage/visitors/
git commit -m "feat: add visitor models (VisitorLocation, VisitorProfile, Visit)"
```

---

## Task 2: Backend Schemas

**Files:**
- Create: `backend/app/schemas/visitors.py`

**Step 1: Create schemas file**

```python
# backend/app/schemas/visitors.py
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime


# ── Location ──────────────────────────────────────────────────────────────────

class VisitorLocationCreate(BaseModel):
    name: str
    ip_camera_url: Optional[str] = None


class VisitorLocationUpdate(BaseModel):
    name: Optional[str] = None
    ip_camera_url: Optional[str] = None


class VisitorLocationOut(BaseModel):
    id: int
    name: str
    ip_camera_url: Optional[str] = None
    created_at: Optional[datetime] = None

    class Config:
        from_attributes = True


# ── Profile ───────────────────────────────────────────────────────────────────

class VisitorProfileOut(BaseModel):
    id: int
    name: str
    address: Optional[str] = None
    contact_no: Optional[str] = None
    email: Optional[str] = None
    organization: Optional[str] = None
    photo_url: Optional[str] = None
    created_at: Optional[datetime] = None

    class Config:
        from_attributes = True


# ── Visit ─────────────────────────────────────────────────────────────────────

class VisitCreate(BaseModel):
    # Visitor identity — creates or updates profile
    visitor_name: str
    visitor_address: Optional[str] = None
    visitor_contact_no: Optional[str] = None
    visitor_email: Optional[str] = None
    visitor_organization: Optional[str] = None
    visitor_photo_path: Optional[str] = None  # set after upload
    # Visit details
    location_id: Optional[int] = None
    num_visitors: int = 1
    purpose: str
    host_agent_id: Optional[int] = None


class VisitOut(BaseModel):
    id: int
    visitor_profile_id: int
    visitor_name: str
    visitor_organization: Optional[str] = None
    visitor_photo_url: Optional[str] = None
    location_id: Optional[int] = None
    location_name: Optional[str] = None
    num_visitors: int
    purpose: str
    host_agent_id: Optional[int] = None
    host_agent_name: Optional[str] = None
    check_in_at: Optional[datetime] = None
    check_out_at: Optional[datetime] = None
    cctv_photo_url: Optional[str] = None
    created_by: Optional[int] = None
    status: str  # "checked_in" | "checked_out"

    class Config:
        from_attributes = True
```

**Step 2: Commit**

```bash
git add backend/app/schemas/visitors.py
git commit -m "feat: add visitor pydantic schemas"
```

---

## Task 3: Backend Routes

**Files:**
- Create: `backend/app/routes/visitors.py`

**Step 1: Create routes file**

```python
# backend/app/routes/visitors.py
import asyncio
import io
import logging
import os
import uuid
from datetime import datetime
from typing import List, Optional

import requests as http_requests
from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File
from fastapi.responses import Response
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import get_admin_user, get_current_user
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

PROFILE_PHOTO_DIR = "app/attachment_storage/visitors/profiles"
CCTV_PHOTO_DIR = "app/attachment_storage/visitors/cctv"


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
    event = EventTypes.create_event(
        "visitor_checkin",
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
        loop = asyncio.get_event_loop()
        loop.create_task(events_service.broadcast_to_user(host_agent_id, event))
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
    """Proxy a single frame from the IP camera — no auth needed (used by kiosk)."""
    loc = db.query(VisitorLocation).filter(VisitorLocation.id == loc_id).first()
    if not loc or not loc.ip_camera_url:
        raise HTTPException(status_code=404, detail="No camera configured for this location")
    try:
        resp = http_requests.get(loc.ip_camera_url, timeout=5, stream=True)
        resp.raise_for_status()
        content_type = resp.headers.get("content-type", "image/jpeg")
        return Response(content=resp.content, media_type=content_type)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Camera unreachable: {exc}")


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
    os.makedirs(PROFILE_PHOTO_DIR, exist_ok=True)
    ext = os.path.splitext(file.filename or "photo.jpg")[1] or ".jpg"
    fname = f"{uuid.uuid4().hex}{ext}"
    fpath = os.path.join(PROFILE_PHOTO_DIR, fname)
    content = await file.read()
    with open(fpath, "wb") as f:
        f.write(content)
    return {"path": fpath, "url": f"/visitor-photos/{fname}"}


# ── Visits ────────────────────────────────────────────────────────────────────

@router.get("/", response_model=List[VisitOut])
def list_visits(
    status: Optional[str] = Query(None),          # "checked_in" | "checked_out"
    location_id: Optional[int] = Query(None),
    date_from: Optional[str] = Query(None),
    date_to: Optional[str] = Query(None),
    search: Optional[str] = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
    _: User = Depends(get_admin_user),
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
    # Allow unauthenticated (kiosk) — current_user may be None
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
        # Update any changed fields
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

    # Grab CCTV snapshot
    cctv_path: Optional[str] = None
    if payload.location_id:
        loc = db.query(VisitorLocation).filter(VisitorLocation.id == payload.location_id).first()
        if loc and loc.ip_camera_url:
            try:
                resp = http_requests.get(loc.ip_camera_url, timeout=5)
                if resp.ok:
                    os.makedirs(CCTV_PHOTO_DIR, exist_ok=True)
                    fname = f"{uuid.uuid4().hex}.jpg"
                    cctv_path = os.path.join(CCTV_PHOTO_DIR, fname)
                    with open(cctv_path, "wb") as f:
                        f.write(resp.content)
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
        location_name = loc.name if payload.location_id and loc else None
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
    from app.models.user import User as UserModel
    users = db.query(UserModel).filter(UserModel.is_active == True).order_by(UserModel.email).all()
    return [
        {"id": u.id, "name": u.display_name or u.email, "email": u.email}
        for u in users
    ]
```

**Step 2: Register router in main.py**

Add import near line 23 (with other route imports):
```python
from app.routes.visitors import router as visitors_router
```

Add router registration near line 1853 (after ci_cd_router):
```python
app.include_router(visitors_router)
```

**Step 3: Add `VISITOR_CHECKIN` to EventTypes in events_service.py**

In `backend/app/services/events_service.py`, add to the `EventTypes` class:
```python
    VISITOR_CHECKIN = "visitor_checkin"
```

**Step 4: Commit**

```bash
git add backend/app/routes/visitors.py backend/app/services/events_service.py backend/main.py
git commit -m "feat: add visitors API routes and event type"
```

---

## Task 4: Frontend — Admin Visits List Page

**Files:**
- Create: `frontend/app/admin/visitors/page.tsx`

**Step 1: Create the visits list page**

```tsx
// frontend/app/admin/visitors/page.tsx
'use client'
import { useEffect, useState } from 'react'
import AdminNav from '@/components/AdminNav'
import api from '@/lib/api'
import Link from 'next/link'

interface Visit {
  id: number
  visitor_name: string
  visitor_organization?: string
  visitor_photo_url?: string
  location_name?: string
  num_visitors: number
  purpose: string
  host_agent_name?: string
  check_in_at: string
  check_out_at?: string
  status: 'checked_in' | 'checked_out'
}

export default function VisitorsPage() {
  const [visits, setVisits] = useState<Visit[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')

  const load = async () => {
    setLoading(true)
    try {
      const params: Record<string, string> = {}
      if (search) params.search = search
      if (statusFilter) params.status = statusFilter
      if (dateFrom) params.date_from = dateFrom
      if (dateTo) params.date_to = dateTo
      const res = await api.get('/visitors/', { params })
      setVisits(res.data)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [search, statusFilter, dateFrom, dateTo])

  const handleCheckout = async (visitId: number) => {
    await api.patch(`/visitors/${visitId}/checkout`)
    load()
  }

  const fmt = (dt?: string) => dt ? new Date(dt).toLocaleString() : '—'

  return (
    <>
      <AdminNav />
      <main className="ml-60 pt-14 p-6">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold">Visitors</h1>
          <Link href="/admin/visitors/new"
            className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 text-sm font-medium">
            + Check In Visitor
          </Link>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap gap-3 mb-5">
          <input
            className="border rounded-lg px-3 py-2 text-sm w-56"
            placeholder="Search name or organisation…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          <select
            className="border rounded-lg px-3 py-2 text-sm"
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value)}>
            <option value="">All statuses</option>
            <option value="checked_in">Checked In</option>
            <option value="checked_out">Checked Out</option>
          </select>
          <input type="date" className="border rounded-lg px-3 py-2 text-sm"
            value={dateFrom} onChange={e => setDateFrom(e.target.value)} />
          <span className="self-center text-sm text-gray-400">to</span>
          <input type="date" className="border rounded-lg px-3 py-2 text-sm"
            value={dateTo} onChange={e => setDateTo(e.target.value)} />
        </div>

        {/* Table */}
        <div className="bg-white rounded-xl border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-500 text-left">
              <tr>
                <th className="px-4 py-3 font-medium">Visitor</th>
                <th className="px-4 py-3 font-medium">Organisation</th>
                <th className="px-4 py-3 font-medium">Purpose</th>
                <th className="px-4 py-3 font-medium">Host</th>
                <th className="px-4 py-3 font-medium">Location</th>
                <th className="px-4 py-3 font-medium">Checked In</th>
                <th className="px-4 py-3 font-medium">Checked Out</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr><td colSpan={9} className="px-4 py-8 text-center text-gray-400">Loading…</td></tr>
              ) : visits.length === 0 ? (
                <tr><td colSpan={9} className="px-4 py-8 text-center text-gray-400">No visits found</td></tr>
              ) : visits.map(v => (
                <tr key={v.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <Link href={`/admin/visitors/${v.id}`}
                      className="font-medium text-blue-600 hover:underline">
                      {v.visitor_name}
                    </Link>
                    {v.num_visitors > 1 && (
                      <span className="ml-1 text-xs text-gray-400">(+{v.num_visitors - 1})</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-gray-600">{v.visitor_organization || '—'}</td>
                  <td className="px-4 py-3 text-gray-600">{v.purpose}</td>
                  <td className="px-4 py-3 text-gray-600">{v.host_agent_name || '—'}</td>
                  <td className="px-4 py-3 text-gray-600">{v.location_name || '—'}</td>
                  <td className="px-4 py-3 text-gray-500 text-xs">{fmt(v.check_in_at)}</td>
                  <td className="px-4 py-3 text-gray-500 text-xs">{fmt(v.check_out_at)}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                      v.status === 'checked_in'
                        ? 'bg-green-100 text-green-700'
                        : 'bg-gray-100 text-gray-500'
                    }`}>
                      {v.status === 'checked_in' ? 'Checked In' : 'Checked Out'}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    {v.status === 'checked_in' && (
                      <button
                        onClick={() => handleCheckout(v.id)}
                        className="text-xs text-orange-600 hover:underline font-medium">
                        Check Out
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </main>
    </>
  )
}
```

**Step 2: Commit**

```bash
git add frontend/app/admin/visitors/page.tsx
git commit -m "feat: add admin visitors list page"
```

---

## Task 5: Frontend — Visit Detail Page

**Files:**
- Create: `frontend/app/admin/visitors/[id]/page.tsx`

**Step 1: Create detail page**

```tsx
// frontend/app/admin/visitors/[id]/page.tsx
'use client'
import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import AdminNav from '@/components/AdminNav'
import api from '@/lib/api'

interface Visit {
  id: number
  visitor_name: string
  visitor_organization?: string
  visitor_photo_url?: string
  cctv_photo_url?: string
  location_name?: string
  num_visitors: number
  purpose: string
  host_agent_name?: string
  check_in_at: string
  check_out_at?: string
  status: string
}

export default function VisitDetailPage() {
  const { id } = useParams()
  const router = useRouter()
  const [visit, setVisit] = useState<Visit | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api.get(`/visitors/${id}`)
      .then(r => setVisit(r.data))
      .finally(() => setLoading(false))
  }, [id])

  const handleCheckout = async () => {
    await api.patch(`/visitors/${id}/checkout`)
    router.refresh()
    api.get(`/visitors/${id}`).then(r => setVisit(r.data))
  }

  const fmt = (dt?: string) => dt ? new Date(dt).toLocaleString() : '—'
  const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

  if (loading) return (
    <><AdminNav /><main className="ml-60 pt-14 p-6 text-gray-400">Loading…</main></>
  )
  if (!visit) return (
    <><AdminNav /><main className="ml-60 pt-14 p-6 text-red-500">Visit not found</main></>
  )

  return (
    <>
      <AdminNav />
      <main className="ml-60 pt-14 p-6 max-w-4xl">
        <div className="flex items-center justify-between mb-6">
          <div>
            <button onClick={() => router.back()} className="text-sm text-gray-400 hover:text-gray-600 mb-1">
              ← Back
            </button>
            <h1 className="text-2xl font-bold">{visit.visitor_name}</h1>
            {visit.visitor_organization && (
              <p className="text-gray-500 text-sm mt-0.5">{visit.visitor_organization}</p>
            )}
          </div>
          {visit.status === 'checked_in' && (
            <button
              onClick={handleCheckout}
              className="bg-orange-500 text-white px-4 py-2 rounded-lg hover:bg-orange-600 text-sm font-medium">
              Check Out Now
            </button>
          )}
        </div>

        <div className="grid grid-cols-2 gap-6">
          {/* Details */}
          <div className="bg-white rounded-xl border p-5 space-y-4">
            <h2 className="font-semibold text-gray-700 text-sm uppercase tracking-wide">Visit Details</h2>
            {[
              ['Purpose', visit.purpose],
              ['Host', visit.host_agent_name || '—'],
              ['Location', visit.location_name || '—'],
              ['Group Size', String(visit.num_visitors)],
              ['Status', visit.status === 'checked_in' ? 'Checked In' : 'Checked Out'],
              ['Checked In', fmt(visit.check_in_at)],
              ['Checked Out', fmt(visit.check_out_at)],
            ].map(([label, value]) => (
              <div key={label} className="flex justify-between text-sm">
                <span className="text-gray-400">{label}</span>
                <span className="text-gray-800 font-medium">{value}</span>
              </div>
            ))}
          </div>

          {/* Photos */}
          <div className="space-y-4">
            {visit.visitor_photo_url && (
              <div className="bg-white rounded-xl border p-4">
                <p className="text-xs text-gray-400 uppercase tracking-wide mb-3">Visitor Photo</p>
                <img
                  src={`${API_URL}${visit.visitor_photo_url}`}
                  alt="Visitor"
                  className="w-full max-h-48 object-cover rounded-lg"
                />
              </div>
            )}
            {visit.cctv_photo_url && (
              <div className="bg-white rounded-xl border p-4">
                <p className="text-xs text-gray-400 uppercase tracking-wide mb-3">CCTV Snapshot</p>
                <img
                  src={`${API_URL}${visit.cctv_photo_url}`}
                  alt="CCTV"
                  className="w-full max-h-48 object-cover rounded-lg"
                />
              </div>
            )}
          </div>
        </div>
      </main>
    </>
  )
}
```

**Step 2: Commit**

```bash
git add frontend/app/admin/visitors/[id]/page.tsx
git commit -m "feat: add admin visit detail page"
```

---

## Task 6: Frontend — Admin New Visit (Agent Check-In Form)

**Files:**
- Create: `frontend/app/admin/visitors/new/page.tsx`

**Step 1: Create the agent check-in form**

```tsx
// frontend/app/admin/visitors/new/page.tsx
'use client'
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import AdminNav from '@/components/AdminNav'
import api from '@/lib/api'

interface Agent { id: number; name: string; email: string }
interface Location { id: number; name: string }

export default function NewVisitPage() {
  const router = useRouter()
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)

  const [agents, setAgents] = useState<Agent[]>([])
  const [locations, setLocations] = useState<Location[]>([])
  const [stream, setStream] = useState<MediaStream | null>(null)
  const [photoUrl, setPhotoUrl] = useState<string | null>(null)
  const [photoPath, setPhotoPath] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [form, setForm] = useState({
    visitor_name: '', visitor_organization: '', visitor_contact_no: '',
    visitor_email: '', visitor_address: '', purpose: '',
    host_agent_id: '', location_id: '', num_visitors: '1',
  })

  useEffect(() => {
    api.get('/visitors/agents/list').then(r => setAgents(r.data))
    api.get('/visitors/locations').then(r => setLocations(r.data))
  }, [])

  const startCamera = async () => {
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: true })
      setStream(s)
      if (videoRef.current) videoRef.current.srcObject = s
    } catch { setError('Camera permission denied') }
  }

  const capturePhoto = async () => {
    if (!videoRef.current || !canvasRef.current) return
    const ctx = canvasRef.current.getContext('2d')!
    canvasRef.current.width = videoRef.current.videoWidth
    canvasRef.current.height = videoRef.current.videoHeight
    ctx.drawImage(videoRef.current, 0, 0)
    canvasRef.current.toBlob(async blob => {
      if (!blob) return
      const fd = new FormData()
      fd.append('file', blob, 'visitor.jpg')
      const res = await api.post('/visitors/upload-photo', fd, {
        headers: { 'Content-Type': 'multipart/form-data' }
      })
      setPhotoPath(res.data.path)
      setPhotoUrl(res.data.url)
      stream?.getTracks().forEach(t => t.stop())
      setStream(null)
    }, 'image/jpeg')
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setError(null)
    try {
      await api.post('/visitors/', {
        ...form,
        num_visitors: parseInt(form.num_visitors),
        host_agent_id: form.host_agent_id ? parseInt(form.host_agent_id) : null,
        location_id: form.location_id ? parseInt(form.location_id) : null,
        visitor_photo_path: photoPath,
      })
      router.push('/admin/visitors')
    } catch (e: any) {
      setError(e?.response?.data?.detail || 'Failed to check in visitor')
    } finally {
      setSaving(false)
    }
  }

  const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

  return (
    <>
      <AdminNav />
      <main className="ml-60 pt-14 p-6 max-w-3xl">
        <div className="mb-6">
          <button onClick={() => router.back()} className="text-sm text-gray-400 hover:text-gray-600 mb-1">
            ← Back
          </button>
          <h1 className="text-2xl font-bold">Check In Visitor</h1>
        </div>

        {error && <div className="mb-4 p-3 bg-red-50 text-red-600 rounded-lg text-sm">{error}</div>}

        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="bg-white rounded-xl border p-5 grid grid-cols-2 gap-4">
            <h2 className="col-span-2 font-semibold text-sm text-gray-700 uppercase tracking-wide">Visitor Details</h2>
            {[
              ['visitor_name', 'Full Name *', 'text', true],
              ['visitor_organization', 'Organisation', 'text', false],
              ['visitor_contact_no', 'Phone', 'tel', false],
              ['visitor_email', 'Email', 'email', false],
            ].map(([key, label, type, required]) => (
              <div key={key as string}>
                <label className="block text-xs text-gray-500 mb-1">{label as string}</label>
                <input
                  type={type as string}
                  required={required as boolean}
                  className="w-full border rounded-lg px-3 py-2 text-sm"
                  value={(form as any)[key as string]}
                  onChange={e => setForm(f => ({ ...f, [key as string]: e.target.value }))}
                />
              </div>
            ))}
            <div className="col-span-2">
              <label className="block text-xs text-gray-500 mb-1">Address</label>
              <textarea
                className="w-full border rounded-lg px-3 py-2 text-sm"
                rows={2}
                value={form.visitor_address}
                onChange={e => setForm(f => ({ ...f, visitor_address: e.target.value }))}
              />
            </div>
          </div>

          <div className="bg-white rounded-xl border p-5 grid grid-cols-2 gap-4">
            <h2 className="col-span-2 font-semibold text-sm text-gray-700 uppercase tracking-wide">Visit Details</h2>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Purpose *</label>
              <input required className="w-full border rounded-lg px-3 py-2 text-sm"
                value={form.purpose}
                onChange={e => setForm(f => ({ ...f, purpose: e.target.value }))} />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">No. of Visitors</label>
              <input type="number" min={1} className="w-full border rounded-lg px-3 py-2 text-sm"
                value={form.num_visitors}
                onChange={e => setForm(f => ({ ...f, num_visitors: e.target.value }))} />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Host Agent</label>
              <select className="w-full border rounded-lg px-3 py-2 text-sm"
                value={form.host_agent_id}
                onChange={e => setForm(f => ({ ...f, host_agent_id: e.target.value }))}>
                <option value="">— Select host —</option>
                {agents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Location</label>
              <select className="w-full border rounded-lg px-3 py-2 text-sm"
                value={form.location_id}
                onChange={e => setForm(f => ({ ...f, location_id: e.target.value }))}>
                <option value="">— Select location —</option>
                {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
            </div>
          </div>

          {/* Webcam */}
          <div className="bg-white rounded-xl border p-5">
            <h2 className="font-semibold text-sm text-gray-700 uppercase tracking-wide mb-3">Visitor Photo</h2>
            {photoUrl ? (
              <div className="flex items-center gap-4">
                <img src={`${API_URL}${photoUrl}`} alt="Captured"
                  className="w-24 h-24 object-cover rounded-lg border" />
                <button type="button" onClick={() => { setPhotoUrl(null); setPhotoPath(null) }}
                  className="text-sm text-red-500 hover:underline">Retake</button>
              </div>
            ) : stream ? (
              <div className="space-y-2">
                <video ref={videoRef} autoPlay className="w-full max-w-xs rounded-lg border" />
                <canvas ref={canvasRef} className="hidden" />
                <button type="button" onClick={capturePhoto}
                  className="bg-green-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-green-700">
                  Capture Photo
                </button>
              </div>
            ) : (
              <button type="button" onClick={startCamera}
                className="border-2 border-dashed border-gray-300 rounded-lg px-6 py-4 text-sm text-gray-400 hover:border-blue-400 hover:text-blue-500">
                📷 Open Camera
              </button>
            )}
          </div>

          <button type="submit" disabled={saving}
            className="w-full bg-blue-600 text-white py-3 rounded-xl font-medium hover:bg-blue-700 disabled:opacity-50">
            {saving ? 'Checking in…' : 'Check In Visitor'}
          </button>
        </form>
      </main>
    </>
  )
}
```

**Step 2: Commit**

```bash
git add frontend/app/admin/visitors/new/page.tsx
git commit -m "feat: add agent-assisted visitor check-in form"
```

---

## Task 7: Frontend — Visitor Locations Admin Page

**Files:**
- Create: `frontend/app/admin/visitors/locations/page.tsx`

**Step 1: Create locations management page**

```tsx
// frontend/app/admin/visitors/locations/page.tsx
'use client'
import { useEffect, useState } from 'react'
import AdminNav from '@/components/AdminNav'
import api from '@/lib/api'

interface Location { id: number; name: string; ip_camera_url?: string }

export default function VisitorLocationsPage() {
  const [locations, setLocations] = useState<Location[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editItem, setEditItem] = useState<Location | null>(null)
  const [name, setName] = useState('')
  const [cameraUrl, setCameraUrl] = useState('')
  const [saving, setSaving] = useState(false)
  const [snapshotUrl, setSnapshotUrl] = useState<string | null>(null)
  const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

  const load = () => {
    api.get('/visitors/locations')
      .then(r => setLocations(r.data))
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [])

  const openCreate = () => {
    setEditItem(null)
    setName('')
    setCameraUrl('')
    setSnapshotUrl(null)
    setShowForm(true)
  }

  const openEdit = (loc: Location) => {
    setEditItem(loc)
    setName(loc.name)
    setCameraUrl(loc.ip_camera_url || '')
    setSnapshotUrl(null)
    setShowForm(true)
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      if (editItem) {
        await api.put(`/visitors/locations/${editItem.id}`, { name, ip_camera_url: cameraUrl || null })
      } else {
        await api.post('/visitors/locations', { name, ip_camera_url: cameraUrl || null })
      }
      setShowForm(false)
      load()
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id: number) => {
    if (!confirm('Delete this location?')) return
    await api.delete(`/visitors/locations/${id}`)
    load()
  }

  const testSnapshot = (id: number) => {
    setSnapshotUrl(`${API_URL}/visitors/locations/${id}/snapshot?t=${Date.now()}`)
  }

  return (
    <>
      <AdminNav />
      <main className="ml-60 pt-14 p-6 max-w-3xl">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold">Visitor Locations</h1>
          <button onClick={openCreate}
            className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 text-sm font-medium">
            + Add Location
          </button>
        </div>

        {loading ? (
          <p className="text-gray-400">Loading…</p>
        ) : locations.length === 0 ? (
          <div className="bg-white rounded-xl border p-8 text-center text-gray-400">
            No locations yet. Add one to get started.
          </div>
        ) : (
          <div className="space-y-3">
            {locations.map(loc => (
              <div key={loc.id} className="bg-white rounded-xl border p-4 flex items-center justify-between">
                <div>
                  <p className="font-medium text-gray-800">{loc.name}</p>
                  <p className="text-xs text-gray-400 mt-0.5">
                    {loc.ip_camera_url ? `📷 ${loc.ip_camera_url}` : 'No IP camera configured'}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {loc.ip_camera_url && (
                    <button onClick={() => testSnapshot(loc.id)}
                      className="text-xs text-blue-600 hover:underline">Test Snapshot</button>
                  )}
                  <button onClick={() => openEdit(loc)}
                    className="text-xs text-gray-500 hover:text-gray-700">Edit</button>
                  <button onClick={() => handleDelete(loc.id)}
                    className="text-xs text-red-500 hover:text-red-700">Delete</button>
                </div>
              </div>
            ))}
          </div>
        )}

        {snapshotUrl && (
          <div className="mt-4 bg-white rounded-xl border p-4">
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm font-medium text-gray-700">Camera Snapshot</p>
              <button onClick={() => setSnapshotUrl(null)} className="text-gray-400 hover:text-gray-600 text-xs">✕ Close</button>
            </div>
            <img src={snapshotUrl} alt="CCTV snapshot" className="w-full rounded-lg" />
          </div>
        )}

        {/* Create/Edit Modal */}
        {showForm && (
          <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
            <div className="bg-white rounded-xl p-6 w-full max-w-md shadow-xl">
              <h2 className="text-lg font-semibold mb-4">
                {editItem ? 'Edit Location' : 'New Location'}
              </h2>
              <div className="space-y-3">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Location Name *</label>
                  <input className="w-full border rounded-lg px-3 py-2 text-sm"
                    value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Head Office Lobby" />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">IP Camera Snapshot URL</label>
                  <input className="w-full border rounded-lg px-3 py-2 text-sm"
                    value={cameraUrl} onChange={e => setCameraUrl(e.target.value)}
                    placeholder="http://192.168.1.100/snapshot.jpg" />
                  <p className="text-xs text-gray-400 mt-1">Optional. Must be a URL that returns a JPEG image.</p>
                </div>
              </div>
              <div className="flex justify-end gap-2 mt-5">
                <button onClick={() => setShowForm(false)}
                  className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">Cancel</button>
                <button onClick={handleSave} disabled={!name || saving}
                  className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50">
                  {saving ? 'Saving…' : 'Save'}
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    </>
  )
}
```

**Step 2: Commit**

```bash
git add frontend/app/admin/visitors/locations/page.tsx
git commit -m "feat: add visitor locations admin page"
```

---

## Task 8: Frontend — Public Kiosk

**Files:**
- Create: `frontend/app/kiosk/[locationId]/page.tsx`

**Step 1: Create the kiosk page**

This is a full-screen, no-auth self-service check-in flow with 4 steps:
1. Phone/email lookup (returning visitor pre-fill)
2. Fill in details
3. Webcam capture
4. Confirmation

```tsx
// frontend/app/kiosk/[locationId]/page.tsx
'use client'
import { useEffect, useRef, useState } from 'react'
import { useParams } from 'next/navigation'
import api from '@/lib/api'

type Step = 'lookup' | 'form' | 'camera' | 'confirm' | 'checkout'

interface Agent { id: number; name: string }
interface Profile { id: number; name: string; organization?: string; contact_no?: string; email?: string; address?: string }

export default function KioskPage() {
  const { locationId } = useParams()
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)

  const [step, setStep] = useState<Step>('lookup')
  const [agents, setAgents] = useState<Agent[]>([])
  const [stream, setStream] = useState<MediaStream | null>(null)
  const [photoPath, setPhotoPath] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [confirmedName, setConfirmedName] = useState('')

  const [lookup, setLookup] = useState('')
  const [checkoutPhone, setCheckoutPhone] = useState('')
  const [checkoutVisits, setCheckoutVisits] = useState<any[]>([])

  const [form, setForm] = useState({
    visitor_name: '', visitor_organization: '', visitor_contact_no: '',
    visitor_email: '', visitor_address: '', purpose: '',
    host_agent_id: '', num_visitors: '1',
  })

  useEffect(() => {
    api.get('/visitors/agents/list').then(r => setAgents(r.data))
  }, [])

  // Step 1: Lookup returning visitor
  const handleLookup = async () => {
    if (!lookup.trim()) { setStep('form'); return }
    try {
      const res = await api.get('/visitors/profiles/search', { params: { q: lookup } })
      if (res.data.length > 0) {
        const p: Profile = res.data[0]
        setForm(f => ({
          ...f,
          visitor_name: p.name,
          visitor_organization: p.organization || '',
          visitor_contact_no: p.contact_no || '',
          visitor_email: p.email || '',
          visitor_address: p.address || '',
        }))
      }
    } catch {}
    setStep('form')
  }

  // Step 3: Camera
  const startCamera = async () => {
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: true })
      setStream(s)
      if (videoRef.current) videoRef.current.srcObject = s
    } catch { setStep('confirm'); handleCheckin(null) }  // skip photo if camera denied
  }

  const capturePhoto = async () => {
    if (!videoRef.current || !canvasRef.current) return
    const ctx = canvasRef.current.getContext('2d')!
    canvasRef.current.width = videoRef.current.videoWidth
    canvasRef.current.height = videoRef.current.videoHeight
    ctx.drawImage(videoRef.current, 0, 0)
    stream?.getTracks().forEach(t => t.stop())
    setStream(null)
    canvasRef.current.toBlob(async blob => {
      if (!blob) { handleCheckin(null); return }
      const fd = new FormData()
      fd.append('file', blob, 'visitor.jpg')
      const res = await api.post('/visitors/upload-photo', fd, {
        headers: { 'Content-Type': 'multipart/form-data' }
      })
      handleCheckin(res.data.path)
    }, 'image/jpeg')
  }

  const handleCheckin = async (photo: string | null) => {
    setSubmitting(true)
    try {
      await api.post('/visitors/', {
        ...form,
        num_visitors: parseInt(form.num_visitors),
        host_agent_id: form.host_agent_id ? parseInt(form.host_agent_id) : null,
        location_id: locationId ? parseInt(locationId as string) : null,
        visitor_photo_path: photo,
      })
      setConfirmedName(form.visitor_name)
      setStep('confirm')
    } catch {
      setStep('confirm')
    } finally {
      setSubmitting(false)
    }
  }

  // Checkout flow
  const handleCheckoutLookup = async () => {
    const res = await api.get('/visitors/kiosk/active-visits', { params: { contact_no: checkoutPhone } })
    setCheckoutVisits(res.data)
  }

  const handleCheckoutVisit = async (visitId: number) => {
    await api.patch(`/visitors/${visitId}/checkout`)
    setCheckoutVisits([])
    setCheckoutPhone('')
    setStep('lookup')
  }

  // Reset after 30s on confirm screen
  useEffect(() => {
    if (step === 'confirm') {
      const t = setTimeout(() => { setStep('lookup'); setForm({ visitor_name: '', visitor_organization: '', visitor_contact_no: '', visitor_email: '', visitor_address: '', purpose: '', host_agent_id: '', num_visitors: '1' }); setPhotoPath(null) }, 30000)
      return () => clearTimeout(t)
    }
  }, [step])

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-lg">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-gray-800">Visitor Check-In</h1>
          <p className="text-gray-500 mt-1">Welcome! Please sign in below.</p>
        </div>

        {step === 'lookup' && (
          <div className="bg-white rounded-2xl shadow-lg p-8 space-y-4">
            <p className="text-gray-600 text-sm">Have you visited before? Enter your phone or email to pre-fill your details.</p>
            <input className="w-full border rounded-xl px-4 py-3 text-base"
              placeholder="Phone or email…"
              value={lookup}
              onChange={e => setLookup(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleLookup()} />
            <button onClick={handleLookup}
              className="w-full bg-blue-600 text-white py-3 rounded-xl text-base font-medium hover:bg-blue-700">
              Continue →
            </button>
            <button onClick={() => setStep('checkout')}
              className="w-full text-sm text-gray-400 hover:text-gray-600 py-2">
              Checking out instead?
            </button>
          </div>
        )}

        {step === 'form' && (
          <div className="bg-white rounded-2xl shadow-lg p-8 space-y-4">
            <h2 className="font-semibold text-gray-700">Your Details</h2>
            {[
              ['visitor_name', 'Full Name *', 'text'],
              ['visitor_organization', 'Organisation', 'text'],
              ['visitor_contact_no', 'Phone', 'tel'],
              ['visitor_email', 'Email', 'email'],
            ].map(([key, label, type]) => (
              <div key={key}>
                <label className="text-xs text-gray-400 block mb-1">{label}</label>
                <input type={type} className="w-full border rounded-xl px-4 py-2.5 text-sm"
                  value={(form as any)[key]}
                  onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))} />
              </div>
            ))}
            <div>
              <label className="text-xs text-gray-400 block mb-1">Purpose of Visit *</label>
              <input className="w-full border rounded-xl px-4 py-2.5 text-sm"
                value={form.purpose}
                onChange={e => setForm(f => ({ ...f, purpose: e.target.value }))} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-gray-400 block mb-1">No. of Visitors</label>
                <input type="number" min={1} className="w-full border rounded-xl px-4 py-2.5 text-sm"
                  value={form.num_visitors}
                  onChange={e => setForm(f => ({ ...f, num_visitors: e.target.value }))} />
              </div>
              <div>
                <label className="text-xs text-gray-400 block mb-1">Visiting</label>
                <select className="w-full border rounded-xl px-4 py-2.5 text-sm"
                  value={form.host_agent_id}
                  onChange={e => setForm(f => ({ ...f, host_agent_id: e.target.value }))}>
                  <option value="">— Select —</option>
                  {agents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </div>
            </div>
            <div className="flex gap-2 pt-2">
              <button onClick={() => setStep('lookup')}
                className="flex-1 border py-3 rounded-xl text-sm text-gray-500 hover:bg-gray-50">← Back</button>
              <button
                disabled={!form.visitor_name || !form.purpose}
                onClick={() => { setStep('camera'); startCamera() }}
                className="flex-1 bg-blue-600 text-white py-3 rounded-xl text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
                Next: Photo →
              </button>
            </div>
          </div>
        )}

        {step === 'camera' && (
          <div className="bg-white rounded-2xl shadow-lg p-8 space-y-4 text-center">
            <h2 className="font-semibold text-gray-700">Take Your Photo</h2>
            <video ref={videoRef} autoPlay className="w-full rounded-xl border" />
            <canvas ref={canvasRef} className="hidden" />
            <button onClick={capturePhoto}
              className="w-full bg-green-600 text-white py-3 rounded-xl text-base font-medium hover:bg-green-700">
              📷 Capture & Check In
            </button>
            <button onClick={() => handleCheckin(null)}
              className="w-full text-sm text-gray-400 hover:text-gray-600 py-2">
              Skip photo
            </button>
          </div>
        )}

        {step === 'confirm' && (
          <div className="bg-white rounded-2xl shadow-lg p-10 text-center space-y-4">
            <div className="text-6xl">✅</div>
            <h2 className="text-2xl font-bold text-gray-800">Welcome, {confirmedName}!</h2>
            <p className="text-gray-500">Your host has been notified. Please take a seat.</p>
            <button onClick={() => setStep('lookup')}
              className="mt-4 text-sm text-blue-500 hover:underline">
              Check in another visitor
            </button>
          </div>
        )}

        {step === 'checkout' && (
          <div className="bg-white rounded-2xl shadow-lg p-8 space-y-4">
            <h2 className="font-semibold text-gray-700">Check Out</h2>
            <input className="w-full border rounded-xl px-4 py-3 text-base"
              placeholder="Your phone number…"
              value={checkoutPhone}
              onChange={e => setCheckoutPhone(e.target.value)} />
            <button onClick={handleCheckoutLookup}
              className="w-full bg-orange-500 text-white py-3 rounded-xl text-base font-medium hover:bg-orange-600">
              Find My Visit
            </button>
            {checkoutVisits.length > 0 && checkoutVisits.map((v: any) => (
              <div key={v.id} className="flex items-center justify-between border rounded-xl p-3">
                <div>
                  <p className="font-medium text-sm">{v.purpose}</p>
                  <p className="text-xs text-gray-400">{new Date(v.check_in_at).toLocaleString()}</p>
                </div>
                <button onClick={() => handleCheckoutVisit(v.id)}
                  className="bg-orange-500 text-white px-4 py-2 rounded-lg text-sm font-medium">
                  Check Out
                </button>
              </div>
            ))}
            <button onClick={() => setStep('lookup')}
              className="w-full text-sm text-gray-400 hover:text-gray-600 py-2">← Back</button>
          </div>
        )}
      </div>
    </div>
  )
}
```

**Step 2: Commit**

```bash
git add frontend/app/kiosk/
git commit -m "feat: add public kiosk self-service check-in page"
```

---

## Task 9: Frontend — AdminNav Update + SSE Notification

**Files:**
- Modify: `frontend/components/AdminNav.tsx`
- Modify: `frontend/contexts/events-context.tsx` (or wherever SSE toast notifications are shown)

**Step 1: Add Visitors group to AdminNav**

In `frontend/components/AdminNav.tsx`, find the `sidebarGroups` array and add a new group before the closing `]`. A good place is before the `Applications` group:

```tsx
    {
        label: 'Visitors',
        items: [
            { href: '/admin/visitors', label: 'Visits', icon: '🏢', adminOnly: true },
            { href: '/admin/visitors/locations', label: 'Locations', icon: '📍', adminOnly: true },
        ],
    },
```

**Step 2: Handle `visitor_checkin` SSE event**

Find the file that handles SSE events and shows toast notifications. Search for where `crm_lead_assigned` or `reminder_due` is handled. In that switch/if block, add:

```tsx
case 'visitor_checkin': {
  const d = event.data
  showNotification?.(`🏢 Visitor: ${d.visitor_name}${d.organization ? ` (${d.organization})` : ''} — ${d.purpose}`)
  break
}
```

(The exact implementation depends on the toast/notification system in use — look at how other events show notifications and follow the same pattern.)

**Step 3: Commit**

```bash
git add frontend/components/AdminNav.tsx
git commit -m "feat: add Visitors nav group and visitor_checkin SSE event"
```

---

## Task 10: Wire up `requests` dependency (if not already installed)

**Step 1: Check if `requests` is in requirements**

```bash
grep "requests" backend/requirements.txt
```

**Step 2: Add if missing**

If not present, add to `backend/requirements.txt`:
```
requests>=2.31.0
```

Then install:
```bash
cd backend && source venv/bin/activate && pip install requests
```

**Step 3: Commit if changed**

```bash
git add backend/requirements.txt
git commit -m "chore: add requests dependency for IP camera snapshot"
```

---

## Task 11: Smoke Test

**Step 1: Restart the backend to pick up new models and routes**

```bash
# In one terminal
cd backend && source venv/bin/activate && uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

**Step 2: Verify tables were created**

Check Swagger at `http://localhost:8000/docs` — look for `/visitors/*` routes.

**Step 3: Create a location**

```
POST /visitors/locations
{ "name": "Main Lobby", "ip_camera_url": null }
```

**Step 4: Check in a visitor via Swagger**

```
POST /visitors/
{
  "visitor_name": "John Smith",
  "visitor_contact_no": "0501234567",
  "visitor_organization": "Acme Corp",
  "purpose": "Meeting",
  "num_visitors": 1,
  "host_agent_id": null,
  "location_id": 1
}
```

Expected: 200 with visit object.

**Step 5: Visit the admin page**

Navigate to `http://localhost:3000/admin/visitors` — visit should appear.

**Step 6: Visit the kiosk**

Navigate to `http://localhost:3000/kiosk/1` — self-service flow should work end-to-end.

**Step 7: Final commit**

```bash
git add .
git commit -m "feat: complete visitors module with kiosk, admin panel, photo capture, and SSE notifications"
```
