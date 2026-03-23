from fastapi import APIRouter, Depends, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from sqlalchemy import func, desc
from datetime import datetime, timedelta
import csv
import io

from app.database import get_db
from app.models.crm import Lead, Deal, Task, Activity
from app.models.user import User
from app.dependencies import get_current_user

router = APIRouter(prefix="/crm/reports", tags=["crm-reports"])


@router.get("/agent-performance")
def agent_performance(
    days: int = Query(30),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    agents = db.query(User).filter(User.is_active == True).all()
    result = []
    for agent in agents:
        leads_assigned = db.query(func.count(Lead.id)).filter(Lead.assigned_to == agent.id).scalar() or 0
        deals_closed = db.query(func.count(Deal.id)).filter(Deal.assigned_to == agent.id, Deal.stage == "won").scalar() or 0
        total_deals = db.query(func.count(Deal.id)).filter(Deal.assigned_to == agent.id, Deal.stage.in_(["won", "lost"])).scalar() or 0
        won_revenue = db.query(func.sum(Deal.amount)).filter(Deal.assigned_to == agent.id, Deal.stage == "won").scalar() or 0
        avg_deal = float(won_revenue) / deals_closed if deals_closed else 0
        result.append({
            "agent_id": agent.id,
            "agent_name": f"{agent.first_name or ''} {agent.last_name or ''}".strip() or agent.email,
            "agent_email": agent.email,
            "leads_assigned": leads_assigned,
            "deals_closed": deals_closed,
            "win_rate": round(deals_closed / total_deals * 100, 1) if total_deals else 0,
            "total_revenue": round(float(won_revenue), 2),
            "avg_deal_value": round(avg_deal, 2),
        })
    return sorted(result, key=lambda x: x["total_revenue"], reverse=True)


@router.get("/lead-aging")
def lead_aging(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    statuses = ["new", "contacted", "qualified", "lost", "converted"]
    result = []
    for status in statuses:
        leads = db.query(Lead).filter(Lead.status == status).all()
        if not leads:
            result.append({"status": status, "count": 0, "avg_age_days": 0, "oldest_days": 0})
            continue
        ages = [(datetime.utcnow() - l.created_at).days for l in leads]
        result.append({
            "status": status,
            "count": len(leads),
            "avg_age_days": round(sum(ages) / len(ages), 1),
            "oldest_days": max(ages),
        })
    return result


@router.get("/revenue")
def revenue_report(
    months: int = Query(6),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    import calendar as cal
    result = []
    now = datetime.utcnow()
    for i in range(months - 1, -1, -1):
        offset_month = now.month - i
        offset_year = now.year
        while offset_month <= 0:
            offset_month += 12
            offset_year -= 1
        month_start = datetime(offset_year, offset_month, 1)
        last_day = cal.monthrange(offset_year, offset_month)[1]
        month_end = datetime(offset_year, offset_month, last_day, 23, 59, 59)

        actual = db.query(func.sum(Deal.amount)).filter(
            Deal.stage == "won",
            Deal.closed_at >= month_start,
            Deal.closed_at <= month_end,
        ).scalar() or 0

        forecasted = db.query(func.sum(Deal.amount * Deal.probability / 100)).filter(
            Deal.stage.notin_(["won", "lost"]),
            Deal.expected_close_date >= month_start,
            Deal.expected_close_date <= month_end,
        ).scalar() or 0

        result.append({
            "month": month_start.strftime("%Y-%m"),
            "month_label": month_start.strftime("%b %Y"),
            "actual": round(float(actual), 2),
            "forecasted": round(float(forecasted), 2),
        })
    return result


@router.get("/export")
def export_csv(
    type: str = Query("leads"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    output = io.StringIO()
    writer = csv.writer(output)

    if type == "leads":
        writer.writerow(["ID", "First Name", "Last Name", "Email", "Phone", "Company", "Status", "Source", "Score", "Created At"])
        for l in db.query(Lead).order_by(desc(Lead.created_at)).all():
            writer.writerow([l.id, l.first_name, l.last_name, l.email, l.phone, l.company, l.status, l.source, l.score, l.created_at])
    elif type == "deals":
        writer.writerow(["ID", "Name", "Lead ID", "Stage", "Amount", "Probability", "Expected Close", "Closed At", "Created At"])
        for d in db.query(Deal).order_by(desc(Deal.created_at)).all():
            writer.writerow([d.id, d.name, d.lead_id, d.stage, d.amount, d.probability, d.expected_close_date, d.closed_at, d.created_at])
    elif type == "tasks":
        writer.writerow(["ID", "Title", "Lead ID", "Status", "Due Date", "Completed At", "Created At"])
        for t in db.query(Task).order_by(desc(Task.created_at)).all():
            writer.writerow([t.id, t.title, t.lead_id, t.status, t.due_date, t.completed_at, t.created_at])

    output.seek(0)
    filename = f"crm_{type}_{datetime.utcnow().strftime('%Y%m%d')}.csv"
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )


# ========== PHASE 5: KPI ENDPOINTS ==========

@router.get("/conversion-rate")
def conversion_rate(
    days: int = Query(30),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    since = datetime.utcnow() - timedelta(days=days)
    total = db.query(func.count(Lead.id)).filter(Lead.created_at >= since).scalar() or 0
    converted = db.query(func.count(Lead.id)).filter(
        Lead.created_at >= since, Lead.status == "converted"
    ).scalar() or 0
    return {
        "leads_total": total,
        "leads_converted": converted,
        "rate_pct": round(converted / total * 100, 1) if total else 0,
    }


@router.get("/pipeline-velocity")
def pipeline_velocity(
    days: int = Query(30),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    from app.models.crm import Deal as D
    since = datetime.utcnow() - timedelta(days=days)
    closed_deals = db.query(D).filter(D.closed_at >= since, D.closed_at.isnot(None)).all()
    if not closed_deals:
        return {"avg_days": 0, "count": 0}
    durations = [(d.closed_at - d.created_at).days for d in closed_deals]
    return {
        "avg_days": round(sum(durations) / len(durations), 1),
        "count": len(closed_deals),
    }


@router.get("/revenue-trend")
def revenue_trend(
    days: int = Query(90),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    from app.models.crm import Deal as D
    since = datetime.utcnow() - timedelta(days=days)
    won_deals = db.query(D).filter(D.stage == "won", D.closed_at >= since).order_by(D.closed_at).all()
    weeks = {}
    for d in won_deals:
        week_start = d.closed_at - timedelta(days=d.closed_at.weekday())
        key = week_start.strftime("%Y-%m-%d")
        if key not in weeks:
            weeks[key] = {"week_start": key, "revenue": 0, "deal_count": 0}
        weeks[key]["revenue"] += d.amount or 0
        weeks[key]["deal_count"] += 1
    return sorted(weeks.values(), key=lambda x: x["week_start"])


@router.get("/tasks-summary")
def tasks_summary(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    now = datetime.utcnow()
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    today_end = today_start + timedelta(days=1)
    return {
        "due_today": db.query(Task).filter(
            Task.due_date >= today_start, Task.due_date < today_end,
            Task.status.in_(["open", "in_progress"]),
        ).count(),
        "overdue": db.query(Task).filter(
            Task.due_date < now, Task.due_date.isnot(None),
            Task.status.in_(["open", "in_progress"]),
        ).count(),
        "completed_today": db.query(Task).filter(
            Task.completed_at >= today_start, Task.status == "completed",
        ).count(),
        "open_total": db.query(Task).filter(
            Task.status.in_(["open", "in_progress"]),
        ).count(),
    }
