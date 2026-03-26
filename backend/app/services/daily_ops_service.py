"""
Daily Ops service — multi-table aggregation for planner assigned items
and command center KPI metric computations.
"""

import logging
from datetime import date, datetime
from typing import List, Dict, Any
from sqlalchemy.orm import Session
from sqlalchemy import func as sql_func

from app.models.conversation import Conversation
from app.models.ticket import Ticket, TicketStatus
from app.models.crm import Deal, DealStage, CRMTask, TaskStatus
from app.models.pms import PMSTask
from app.models.email import Email
from app.models.message import Message
from app.models.daily_ops import CommandCenterConfig
from app.services.events_service import events_service

logger = logging.getLogger(__name__)


def get_assigned_conversations(db: Session, user_id: int) -> List[Dict[str, Any]]:
    """Get open/pending conversations assigned to user."""
    convos = db.query(Conversation).filter(
        Conversation.assigned_to == user_id,
        Conversation.status.in_(["open", "pending"])
    ).all()
    return [
        {
            "id": c.id,
            "type": "conversation",
            "title": f"{c.platform} — {c.contact_name or 'Unknown'}",
            "priority": None,
            "due_date": None,
            "link": f"/dashboard?conversation={c.id}",
        }
        for c in convos
    ]


def get_assigned_tickets(db: Session, user_id: int) -> List[Dict[str, Any]]:
    """Get pending tickets assigned to user."""
    tickets = db.query(Ticket).filter(
        Ticket.assigned_to == user_id,
        Ticket.status.in_([TicketStatus.PENDING])
    ).all()
    return [
        {
            "id": t.id,
            "type": "ticket",
            "title": f"#{t.ticket_number} — {t.subject}",
            "priority": t.priority.value if t.priority else None,
            "due_date": None,
            "link": f"/workspace/tickets/{t.ticket_number}",
        }
        for t in tickets
    ]


def get_assigned_crm_tasks(db: Session, user_id: int, today: date) -> List[Dict[str, Any]]:
    """Get CRM tasks assigned to user that are due today or overdue."""
    tasks = db.query(CRMTask).filter(
        CRMTask.assigned_to == user_id,
        CRMTask.due_date <= datetime.combine(today, datetime.max.time()),
        CRMTask.status.notin_([TaskStatus.COMPLETED, TaskStatus.CANCELLED])
    ).all()
    return [
        {
            "id": t.id,
            "type": "crm_task",
            "title": t.title,
            "priority": t.priority if hasattr(t, 'priority') else None,
            "due_date": t.due_date.date() if t.due_date else None,
            "link": "/admin/crm/tasks",
        }
        for t in tasks
    ]


def get_assigned_pms_tasks(db: Session, user_id: int, today: date) -> List[Dict[str, Any]]:
    """Get PMS tasks assigned to user that are due today or overdue."""
    tasks = db.query(PMSTask).filter(
        PMSTask.assignee_id == user_id,
        PMSTask.due_date <= today,
        PMSTask.status.notin_(["done", "cancelled"])
    ).all()
    return [
        {
            "id": t.id,
            "type": "pms_task",
            "title": t.title,
            "priority": t.priority if hasattr(t, 'priority') else None,
            "due_date": t.due_date if t.due_date else None,
            "link": f"/admin/pms/{t.id}",
        }
        for t in tasks
    ]


def get_unread_emails(db: Session, user_id: int) -> List[Dict[str, Any]]:
    """Get unread emails for user's email accounts."""
    emails = db.query(Email).filter(
        Email.user_id == user_id,
        Email.is_read == False,
        Email.folder == "inbox"
    ).limit(20).all()
    return [
        {
            "id": e.id,
            "type": "email",
            "title": e.subject or "(No subject)",
            "priority": None,
            "due_date": None,
            "link": f"/email?id={e.id}",
        }
        for e in emails
    ]


def get_all_assigned_items(db: Session, user_id: int) -> Dict[str, List[Dict[str, Any]]]:
    """Aggregate all assigned items for the planner view."""
    today = date.today()
    return {
        "conversations": get_assigned_conversations(db, user_id),
        "tickets": get_assigned_tickets(db, user_id),
        "crm_tasks": get_assigned_crm_tasks(db, user_id, today),
        "pms_tasks": get_assigned_pms_tasks(db, user_id, today),
        "emails": get_unread_emails(db, user_id),
    }


# ── Command Center Metrics ──────────────────────────────────────────────────

def compute_metric(db: Session, metric_key: str) -> int | float:
    """Compute a single KPI metric value."""
    today = date.today()

    if metric_key == "open_conversations":
        return db.query(Conversation).filter(Conversation.status == "open").count()

    elif metric_key == "unassigned_conversations":
        return db.query(Conversation).filter(
            Conversation.assigned_to.is_(None),
            Conversation.status == "open"
        ).count()

    elif metric_key == "pending_tickets":
        return db.query(Ticket).filter(
            Ticket.status.in_([TicketStatus.PENDING])
        ).count()

    elif metric_key == "overdue_crm_tasks":
        return db.query(CRMTask).filter(
            CRMTask.due_date < datetime.combine(today, datetime.min.time()),
            CRMTask.status.notin_([TaskStatus.COMPLETED, TaskStatus.CANCELLED])
        ).count()

    elif metric_key == "deals_in_pipeline":
        return db.query(Deal).filter(
            Deal.stage.notin_([DealStage.WON, DealStage.LOST])
        ).count()

    elif metric_key == "unread_emails":
        return db.query(Email).filter(
            Email.is_read == False,
            Email.folder == "inbox"
        ).count()

    elif metric_key == "active_agents":
        return events_service.get_connected_user_count()

    elif metric_key == "avg_response_time_today":
        return _compute_avg_response_time(db, today)

    return 0


def _compute_avg_response_time(db: Session, today: date) -> float:
    """
    Average minutes between first customer message and first agent reply,
    for conversations that received their first agent reply today.
    """
    try:
        from sqlalchemy import text
        result = db.execute(text("""
            WITH first_customer AS (
                SELECT conversation_id, MIN(created_at) AS first_msg
                FROM messages
                WHERE direction = 'inbound'
                GROUP BY conversation_id
            ),
            first_agent AS (
                SELECT conversation_id, MIN(created_at) AS first_reply
                FROM messages
                WHERE direction = 'outbound'
                GROUP BY conversation_id
            )
            SELECT AVG(EXTRACT(EPOCH FROM (fa.first_reply - fc.first_msg)) / 60) AS avg_minutes
            FROM first_customer fc
            JOIN first_agent fa ON fc.conversation_id = fa.conversation_id
            WHERE fa.first_reply::date = :today
        """), {"today": today})
        row = result.fetchone()
        return round(row[0], 1) if row and row[0] else 0.0
    except Exception as e:
        logger.error(f"Error computing avg response time: {e}")
        return 0.0


# Default metrics to seed into CommandCenterConfig on first use
DEFAULT_METRICS = [
    {"metric_key": "open_conversations", "label": "Open Conversations", "sort_order": 1, "is_visible": True},
    {"metric_key": "unassigned_conversations", "label": "Unassigned Convos", "sort_order": 2, "is_visible": True},
    {"metric_key": "pending_tickets", "label": "Pending Tickets", "sort_order": 3, "is_visible": True},
    {"metric_key": "overdue_crm_tasks", "label": "Overdue CRM Tasks", "sort_order": 4, "is_visible": True},
    {"metric_key": "deals_in_pipeline", "label": "Deals in Pipeline", "sort_order": 5, "is_visible": True},
    {"metric_key": "unread_emails", "label": "Unread Emails", "sort_order": 6, "is_visible": True},
    {"metric_key": "active_agents", "label": "Active Agents", "sort_order": 7, "is_visible": True},
    {"metric_key": "avg_response_time_today", "label": "Avg Response Time", "sort_order": 8, "is_visible": True},
]


def seed_default_metrics(db: Session):
    """Seed default command center metrics if none exist."""
    existing = db.query(CommandCenterConfig).count()
    if existing > 0:
        return
    for m in DEFAULT_METRICS:
        db.add(CommandCenterConfig(**m))
    db.commit()
