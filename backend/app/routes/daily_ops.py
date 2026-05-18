from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from sqlalchemy import func as sa_func
from typing import List, Optional
from datetime import date, datetime, timedelta
import logging
import csv
import io

from app.database import get_db
from app.dependencies import get_current_user, require_permission
from app.models.user import User
from app.models.daily_ops import StandupEntry, DailyPlannerItem, CommandCenterConfig
from app.schemas.daily_ops import (
    StandupCreate, StandupUpdate, StandupResponse,
    PlannerItemCreate, PlannerItemUpdate, PlannerItemResponse,
    PlannerResponse, AssignedItem,
    MetricResponse, CommandCenterConfigUpdate, MetricConfigItem,
)
from app.services.daily_ops_service import (
    get_all_assigned_items, compute_metric, seed_default_metrics,
)
from app.services.events_service import events_service, EventTypes

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/daily-ops",
    tags=["daily-ops"],
    responses={404: {"description": "Not found"}},
)


# ── Helper ───────────────────────────────────────────────────────────────────

def _standup_to_response(entry: StandupEntry) -> dict:
    """Build standup response with user info."""
    user = entry.owner
    user_name = "Unknown"
    user_avatar = None
    if user:
        user_name = user.display_name or user.full_name or user.email
        user_avatar = user.avatar if hasattr(user, "avatar") else None
    return {
        "id": entry.id,
        "user_id": entry.user_id,
        "user_name": user_name,
        "user_avatar": user_avatar,
        "date": entry.date,
        "yesterday": entry.yesterday,
        "today": entry.today,
        "blockers": entry.blockers,
        "created_at": entry.created_at,
        "updated_at": entry.updated_at,
    }


# ── Standup Endpoints ────────────────────────────────────────────────────────

@router.get("/standups", response_model=List[StandupResponse])
async def get_standups(
    query_date: Optional[date] = Query(None, alias="date", description="Filter by date (YYYY-MM-DD). Defaults to today."),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("daily_ops", "view_standups")),
):
    """Get all team standups for a given date."""
    target_date = query_date or datetime.utcnow().date()
    entries = db.query(StandupEntry).filter(
        StandupEntry.date == target_date
    ).order_by(StandupEntry.created_at.asc()).all()
    return [_standup_to_response(e) for e in entries]


@router.post("/standups", response_model=StandupResponse, status_code=201)
async def create_standup(
    payload: StandupCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("daily_ops", "view_standups")),
):
    """Create a standup entry for today. Returns 409 if one already exists."""
    today = datetime.utcnow().date()
    existing = db.query(StandupEntry).filter(
        StandupEntry.user_id == current_user.id,
        StandupEntry.date == today,
    ).first()
    if existing:
        raise HTTPException(status_code=409, detail="Standup already exists for today. Use PATCH to update.")

    entry = StandupEntry(
        user_id=current_user.id,
        date=today,
        yesterday=payload.yesterday,
        today=payload.today,
        blockers=payload.blockers,
    )
    db.add(entry)
    db.commit()
    db.refresh(entry)

    # Broadcast SSE event
    event = events_service.create_event(EventTypes.STANDUP_POSTED, {
        "user_id": current_user.id,
        "user_name": current_user.display_name or current_user.full_name or current_user.email,
        "date": str(today),
    })
    await events_service.broadcast_to_all(event)

    return _standup_to_response(entry)


@router.patch("/standups/{standup_id}", response_model=StandupResponse)
async def update_standup(
    standup_id: int,
    payload: StandupUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("daily_ops", "view_standups")),
):
    """Update own standup entry."""
    entry = db.query(StandupEntry).filter(StandupEntry.id == standup_id).first()
    if not entry:
        raise HTTPException(status_code=404, detail="Standup not found")
    if entry.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="You can only edit your own standup")

    if payload.yesterday is not None:
        entry.yesterday = payload.yesterday
    if payload.today is not None:
        entry.today = payload.today
    if payload.blockers is not None:
        entry.blockers = payload.blockers

    db.commit()
    db.refresh(entry)

    # Broadcast SSE event
    event = events_service.create_event(EventTypes.STANDUP_POSTED, {
        "user_id": current_user.id,
        "user_name": current_user.display_name or current_user.full_name or current_user.email,
        "date": str(entry.date),
    })
    await events_service.broadcast_to_all(event)

    return _standup_to_response(entry)


@router.delete("/standups/{standup_id}", status_code=204)
async def delete_standup(
    standup_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("daily_ops", "view_standups")),
):
    """Delete own standup entry."""
    entry = db.query(StandupEntry).filter(StandupEntry.id == standup_id).first()
    if not entry:
        raise HTTPException(status_code=404, detail="Standup not found")
    if entry.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="You can only delete your own standup")

    entry_date = str(entry.date)
    db.delete(entry)
    db.commit()

    # Broadcast SSE event
    event = events_service.create_event(EventTypes.STANDUP_DELETED, {
        "standup_id": standup_id,
        "date": entry_date,
    })
    await events_service.broadcast_to_all(event)


# ── Planner Endpoints ────────────────────────────────────────────────────────

@router.get("/planner", response_model=PlannerResponse)
def get_planner(
    query_date: Optional[date] = Query(None, alias="date", description="Filter by date (YYYY-MM-DD). Defaults to today."),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("daily_ops", "view_planner")),
):
    """Get personal planner: manual items + auto-pulled assigned items."""
    target_date = query_date or datetime.utcnow().date()

    manual_items = db.query(DailyPlannerItem).filter(
        DailyPlannerItem.user_id == current_user.id,
        DailyPlannerItem.date == target_date,
    ).order_by(DailyPlannerItem.sort_order.asc()).all()

    assigned_items = get_all_assigned_items(db, current_user.id)

    return {
        "manual_items": manual_items,
        "assigned_items": assigned_items,
    }


@router.post("/planner", response_model=PlannerItemResponse, status_code=201)
def create_planner_item(
    payload: PlannerItemCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("daily_ops", "view_planner")),
):
    """Add a manual goal/note to the planner."""
    max_order = db.query(DailyPlannerItem).filter(
        DailyPlannerItem.user_id == current_user.id,
        DailyPlannerItem.date == payload.date,
    ).count()

    item = DailyPlannerItem(
        user_id=current_user.id,
        date=payload.date,
        title=payload.title,
        sort_order=max_order,
    )
    db.add(item)
    db.commit()
    db.refresh(item)
    return item


@router.patch("/planner/{item_id}", response_model=PlannerItemResponse)
def update_planner_item(
    item_id: int,
    payload: PlannerItemUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("daily_ops", "view_planner")),
):
    """Update a manual planner item (title, completion, sort order)."""
    item = db.query(DailyPlannerItem).filter(DailyPlannerItem.id == item_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Planner item not found")
    if item.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="You can only edit your own planner items")

    if payload.title is not None:
        item.title = payload.title
    if payload.is_completed is not None:
        item.is_completed = payload.is_completed
    if payload.sort_order is not None:
        item.sort_order = payload.sort_order

    db.commit()
    db.refresh(item)
    return item


@router.delete("/planner/{item_id}", status_code=204)
def delete_planner_item(
    item_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("daily_ops", "view_planner")),
):
    """Remove a manual planner item."""
    item = db.query(DailyPlannerItem).filter(DailyPlannerItem.id == item_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Planner item not found")
    if item.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="You can only delete your own planner items")

    db.delete(item)
    db.commit()


# ── Command Center Endpoints ─────────────────────────────────────────────────

@router.get("/command-center", response_model=List[MetricResponse])
def get_command_center(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("daily_ops", "view_command_center")),
):
    """Get live KPI metrics for the command center dashboard."""
    seed_default_metrics(db)

    configs = db.query(CommandCenterConfig).filter(
        CommandCenterConfig.is_visible == True
    ).order_by(CommandCenterConfig.sort_order.asc()).all()

    results = []
    for cfg in configs:
        value = compute_metric(db, cfg.metric_key)
        is_exceeded = cfg.threshold_value is not None and value > cfg.threshold_value
        results.append({
            "metric_key": cfg.metric_key,
            "label": cfg.label,
            "value": value,
            "threshold_value": cfg.threshold_value,
            "is_exceeded": is_exceeded,
        })
    return results


@router.get("/command-center/config", response_model=List[MetricConfigItem])
def get_command_center_config(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("daily_ops", "manage_command_center")),
):
    """Get command center configuration (admin only)."""
    seed_default_metrics(db)
    configs = db.query(CommandCenterConfig).order_by(
        CommandCenterConfig.sort_order.asc()
    ).all()
    return [
        {
            "metric_key": c.metric_key,
            "label": c.label,
            "is_visible": c.is_visible,
            "sort_order": c.sort_order,
            "threshold_value": c.threshold_value,
        }
        for c in configs
    ]


@router.put("/command-center/config", response_model=List[MetricConfigItem])
def update_command_center_config(
    payload: CommandCenterConfigUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("daily_ops", "manage_command_center")),
):
    """Update command center configuration (admin only)."""
    for item in payload.metrics:
        config = db.query(CommandCenterConfig).filter(
            CommandCenterConfig.metric_key == item.metric_key
        ).first()
        if config:
            config.label = item.label
            config.is_visible = item.is_visible
            config.sort_order = item.sort_order
            config.threshold_value = item.threshold_value
            config.created_by = current_user.id

    db.commit()

    configs = db.query(CommandCenterConfig).order_by(
        CommandCenterConfig.sort_order.asc()
    ).all()
    return [
        {
            "metric_key": c.metric_key,
            "label": c.label,
            "is_visible": c.is_visible,
            "sort_order": c.sort_order,
            "threshold_value": c.threshold_value,
        }
        for c in configs
    ]


# ── Reports Endpoints (admin) ──────────────────────────────────────────────

def _get_date_range(start_date: Optional[date], end_date: Optional[date], days: int = 7):
    ed = end_date or datetime.utcnow().date()
    sd = start_date or (ed - timedelta(days=days - 1))
    return sd, ed


def _get_active_users(db: Session):
    return db.query(User).filter(User.is_active == True).order_by(User.full_name.asc()).all()


@router.get("/reports/standup-compliance")
def get_standup_compliance(
    start_date: Optional[date] = Query(None),
    end_date: Optional[date] = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("daily_ops", "view_standups")),
):
    """Standup compliance report: who posted, who missed, rates by date range."""
    sd, ed = _get_date_range(start_date, end_date, days=14)
    users = _get_active_users(db)
    total_days = (ed - sd).days + 1
    dates = [sd + timedelta(days=i) for i in range(total_days)]

    standups = db.query(StandupEntry).filter(
        StandupEntry.date >= sd, StandupEntry.date <= ed
    ).all()

    posted_map: dict[int, set] = {}
    for s in standups:
        posted_map.setdefault(s.user_id, set()).add(s.date)

    user_rows = []
    for u in users:
        posted_dates = posted_map.get(u.id, set())
        posted_count = len(posted_dates)
        rate = round((posted_count / total_days) * 100, 1) if total_days > 0 else 0
        daily = []
        for d in dates:
            daily.append({"date": d.isoformat(), "posted": d in posted_dates})
        user_rows.append({
            "user_id": u.id,
            "user_name": u.display_name or u.full_name or u.email,
            "posted_count": posted_count,
            "missed_count": total_days - posted_count,
            "rate": rate,
            "daily": daily,
        })

    user_rows.sort(key=lambda r: r["rate"], reverse=True)
    overall_possible = total_days * len(users) if users else 1
    overall_posted = sum(r["posted_count"] for r in user_rows)

    return {
        "start_date": sd.isoformat(),
        "end_date": ed.isoformat(),
        "total_days": total_days,
        "total_users": len(users),
        "overall_rate": round((overall_posted / overall_possible) * 100, 1) if overall_possible else 0,
        "users": user_rows,
    }


@router.get("/reports/team-activity")
def get_team_activity(
    start_date: Optional[date] = Query(None),
    end_date: Optional[date] = Query(None),
    user_id: Optional[int] = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("daily_ops", "view_standups")),
):
    """Team activity summary: standups + planner + worklog per user per day."""
    sd, ed = _get_date_range(start_date, end_date, days=7)
    users = _get_active_users(db)
    if user_id:
        users = [u for u in users if u.id == user_id]

    user_ids = [u.id for u in users]

    standups = db.query(StandupEntry).filter(
        StandupEntry.date >= sd, StandupEntry.date <= ed,
        StandupEntry.user_id.in_(user_ids),
    ).all()

    planner_items = db.query(DailyPlannerItem).filter(
        DailyPlannerItem.date >= sd, DailyPlannerItem.date <= ed,
        DailyPlannerItem.user_id.in_(user_ids),
    ).all()

    from app.models.worklog import WorklogEntry
    worklog_entries = db.query(WorklogEntry).filter(
        WorklogEntry.log_date >= sd, WorklogEntry.log_date <= ed,
        WorklogEntry.user_id.in_(user_ids),
    ).all()

    standup_map: dict[tuple, dict] = {}
    for s in standups:
        standup_map[(s.user_id, s.date)] = {
            "yesterday": s.yesterday, "today": s.today, "blockers": s.blockers
        }

    planner_map: dict[tuple, list] = {}
    for p in planner_items:
        planner_map.setdefault((p.user_id, p.date), []).append({
            "title": p.title, "is_completed": p.is_completed
        })

    worklog_map: dict[tuple, list] = {}
    for w in worklog_entries:
        worklog_map.setdefault((w.user_id, w.log_date), []).append({
            "hours": w.hours, "summary": w.summary, "status": w.status,
            "category": w.category.name if w.category else None,
        })

    rows = []
    total_days = (ed - sd).days + 1
    dates = [sd + timedelta(days=i) for i in range(total_days)]

    for u in users:
        for d in dates:
            key = (u.id, d)
            standup = standup_map.get(key)
            planner = planner_map.get(key, [])
            worklogs = worklog_map.get(key, [])
            total_hours = sum(w["hours"] for w in worklogs)
            if standup or planner or worklogs:
                rows.append({
                    "user_id": u.id,
                    "user_name": u.display_name or u.full_name or u.email,
                    "date": d.isoformat(),
                    "standup_posted": standup is not None,
                    "standup": standup,
                    "goals_count": len(planner),
                    "goals_completed": sum(1 for p in planner if p["is_completed"]),
                    "worklog_hours": total_hours,
                    "worklog_entries": worklogs,
                })

    return {
        "start_date": sd.isoformat(),
        "end_date": ed.isoformat(),
        "rows": rows,
    }


@router.get("/reports/export")
def export_daily_ops_report(
    report: str = Query(..., description="standup-compliance or team-activity"),
    format: str = Query("csv", description="csv or pdf"),
    start_date: Optional[date] = Query(None),
    end_date: Optional[date] = Query(None),
    user_id: Optional[int] = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("daily_ops", "view_standups")),
):
    """Export daily ops reports as CSV or PDF."""
    sd, ed = _get_date_range(start_date, end_date, days=14)

    if report == "standup-compliance":
        return _export_standup_compliance(db, sd, ed, format)
    elif report == "team-activity":
        return _export_team_activity(db, sd, ed, user_id, format)
    else:
        raise HTTPException(400, "Invalid report type")


def _export_standup_compliance(db, sd, ed, fmt):
    users = _get_active_users(db)
    total_days = (ed - sd).days + 1

    standups = db.query(StandupEntry).filter(
        StandupEntry.date >= sd, StandupEntry.date <= ed
    ).all()
    posted_map: dict[int, set] = {}
    for s in standups:
        posted_map.setdefault(s.user_id, set()).add(s.date)

    rows = []
    for u in users:
        posted = len(posted_map.get(u.id, set()))
        rows.append({
            "name": u.display_name or u.full_name or u.email,
            "posted": posted,
            "missed": total_days - posted,
            "rate": round((posted / total_days) * 100, 1) if total_days else 0,
        })
    rows.sort(key=lambda r: r["rate"], reverse=True)

    if fmt == "pdf":
        return _standup_compliance_pdf(rows, sd, ed, total_days)

    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["Agent", "Posted", "Missed", "Rate %"])
    for r in rows:
        w.writerow([r["name"], r["posted"], r["missed"], r["rate"]])
    buf.seek(0)
    return StreamingResponse(
        io.BytesIO(buf.getvalue().encode()),
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename=standup-compliance-{sd}-{ed}.csv"},
    )


def _standup_compliance_pdf(rows, sd, ed, total_days):
    from fpdf import FPDF

    pdf = FPDF(orientation="L")
    pdf.set_auto_page_break(auto=True, margin=15)
    pdf.add_page()
    pdf.set_font("Helvetica", "B", 14)
    pdf.cell(0, 10, f"Standup Compliance Report  ({sd} to {ed})", ln=True)
    pdf.set_font("Helvetica", "", 9)
    pdf.cell(0, 6, f"Period: {total_days} days  |  Agents: {len(rows)}", ln=True)
    pdf.ln(4)

    pdf.set_font("Helvetica", "B", 9)
    pdf.set_fill_color(240, 240, 240)
    for h, w in [("Agent", 80), ("Posted", 30), ("Missed", 30), ("Rate %", 30)]:
        pdf.cell(w, 7, h, border=1, fill=True)
    pdf.ln()

    pdf.set_font("Helvetica", "", 9)
    for r in rows:
        pdf.cell(80, 7, r["name"][:40], border=1)
        pdf.cell(30, 7, str(r["posted"]), border=1, align="C")
        pdf.cell(30, 7, str(r["missed"]), border=1, align="C")
        pdf.cell(30, 7, f'{r["rate"]}%', border=1, align="C")
        pdf.ln()

    buf = io.BytesIO(pdf.output())
    return StreamingResponse(
        buf, media_type="application/pdf",
        headers={"Content-Disposition": f"attachment; filename=standup-compliance-{sd}-{ed}.pdf"},
    )


def _export_team_activity(db, sd, ed, user_id, fmt):
    users = _get_active_users(db)
    if user_id:
        users = [u for u in users if u.id == user_id]
    user_ids = [u.id for u in users]
    user_map = {u.id: u.display_name or u.full_name or u.email for u in users}

    standups = db.query(StandupEntry).filter(
        StandupEntry.date >= sd, StandupEntry.date <= ed,
        StandupEntry.user_id.in_(user_ids),
    ).all()
    standup_dates = {(s.user_id, s.date) for s in standups}

    planner_items = db.query(DailyPlannerItem).filter(
        DailyPlannerItem.date >= sd, DailyPlannerItem.date <= ed,
        DailyPlannerItem.user_id.in_(user_ids),
    ).all()
    planner_map: dict[tuple, tuple] = {}
    for p in planner_items:
        k = (p.user_id, p.date)
        total, done = planner_map.get(k, (0, 0))
        planner_map[k] = (total + 1, done + (1 if p.is_completed else 0))

    from app.models.worklog import WorklogEntry
    worklog_entries = db.query(WorklogEntry).filter(
        WorklogEntry.log_date >= sd, WorklogEntry.log_date <= ed,
        WorklogEntry.user_id.in_(user_ids),
    ).all()
    worklog_map: dict[tuple, float] = {}
    for w in worklog_entries:
        k = (w.user_id, w.log_date)
        worklog_map[k] = worklog_map.get(k, 0) + w.hours

    total_days = (ed - sd).days + 1
    dates = [sd + timedelta(days=i) for i in range(total_days)]

    rows = []
    for u in users:
        for d in dates:
            k = (u.id, d)
            goals_total, goals_done = planner_map.get(k, (0, 0))
            wl_hours = worklog_map.get(k, 0)
            posted = k in standup_dates
            if posted or goals_total or wl_hours:
                rows.append({
                    "name": user_map[u.id],
                    "date": d.isoformat(),
                    "standup": "Yes" if posted else "No",
                    "goals": f"{goals_done}/{goals_total}" if goals_total else "0",
                    "worklog_hours": round(wl_hours, 1),
                })

    if fmt == "pdf":
        return _team_activity_pdf(rows, sd, ed)

    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["Agent", "Date", "Standup", "Goals (done/total)", "Worklog Hours"])
    for r in rows:
        w.writerow([r["name"], r["date"], r["standup"], r["goals"], r["worklog_hours"]])
    buf.seek(0)
    return StreamingResponse(
        io.BytesIO(buf.getvalue().encode()),
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename=team-activity-{sd}-{ed}.csv"},
    )


def _team_activity_pdf(rows, sd, ed):
    from fpdf import FPDF

    pdf = FPDF(orientation="L")
    pdf.set_auto_page_break(auto=True, margin=15)
    pdf.add_page()
    pdf.set_font("Helvetica", "B", 14)
    pdf.cell(0, 10, f"Team Activity Report  ({sd} to {ed})", ln=True)
    pdf.ln(4)

    pdf.set_font("Helvetica", "B", 9)
    pdf.set_fill_color(240, 240, 240)
    for h, w in [("Agent", 70), ("Date", 30), ("Standup", 25), ("Goals", 30), ("Worklog Hrs", 30)]:
        pdf.cell(w, 7, h, border=1, fill=True)
    pdf.ln()

    pdf.set_font("Helvetica", "", 9)
    for r in rows:
        pdf.cell(70, 7, r["name"][:35], border=1)
        pdf.cell(30, 7, r["date"], border=1)
        pdf.cell(25, 7, r["standup"], border=1, align="C")
        pdf.cell(30, 7, str(r["goals"]), border=1, align="C")
        pdf.cell(30, 7, str(r["worklog_hours"]), border=1, align="C")
        pdf.ln()

    buf = io.BytesIO(pdf.output())
    return StreamingResponse(
        buf, media_type="application/pdf",
        headers={"Content-Disposition": f"attachment; filename=team-activity-{sd}-{ed}.pdf"},
    )
