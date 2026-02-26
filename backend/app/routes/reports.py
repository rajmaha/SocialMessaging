from fastapi import APIRouter, Depends, Query, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import func
from typing import Optional
from datetime import date, datetime

from app.database import get_db
from app.models.conversation import Conversation
from app.models.message import Message as MessageModel
from app.models.user import User
from app.models.team import Team
from app.models.email import Email, UserEmailAccount
from app.dependencies import get_current_user

router = APIRouter(prefix="/reports", tags=["reports"])

ISSUE_CATEGORIES = ["General", "Billing", "Technical Support", "Sales", "Complaint", "Other"]


def _require_admin(current_user: User = Depends(get_current_user)):
    if current_user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    return current_user


def _base_query(db, date_from, date_to, agent_id, team_id, visitor, status, category):
    q = db.query(Conversation)
    if date_from:
        q = q.filter(Conversation.created_at >= datetime.combine(date_from, datetime.min.time()))
    if date_to:
        q = q.filter(Conversation.created_at <= datetime.combine(date_to, datetime.max.time()))
    if agent_id:
        q = q.filter(Conversation.assigned_to == agent_id)
    if team_id:
        q = q.filter(Conversation.assigned_team_id == team_id)
    if visitor:
        q = q.filter(Conversation.contact_name.ilike(f"%{visitor}%"))
    if status:
        q = q.filter(Conversation.status == status)
    if category:
        q = q.filter(Conversation.category == category)
    return q


@router.get("/categories")
def list_categories():
    """Return the list of available issue categories."""
    return ISSUE_CATEGORIES


@router.get("/summary")
def get_summary(
    date_from: Optional[date] = Query(None),
    date_to: Optional[date] = Query(None),
    agent_id: Optional[int] = Query(None),
    team_id: Optional[int] = Query(None),
    visitor: Optional[str] = Query(None),
    category: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(_require_admin),
):
    """Aggregate stats filtered by date, agent, team, visitor, category."""
    convs = _base_query(db, date_from, date_to, agent_id, team_id, visitor, None, category).all()
    conv_ids = [c.id for c in convs]

    forwarded_ids: set = set()
    if conv_ids:
        rows = db.query(MessageModel.conversation_id).filter(
            MessageModel.conversation_id.in_(conv_ids),
            MessageModel.message_type == "handover",
        ).distinct().all()
        forwarded_ids = {r[0] for r in rows}

    by_category: dict = {}
    for c in convs:
        cat = c.category or "General"
        by_category[cat] = by_category.get(cat, 0) + 1

    response_times = [
        (c.first_response_at - c.created_at).total_seconds() / 60
        for c in convs if c.first_response_at and c.created_at
    ]
    resolution_times = [
        (c.resolved_at - c.created_at).total_seconds() / 60
        for c in convs if c.resolved_at and c.created_at
    ]
    ratings = [c.rating for c in convs if c.rating is not None]

    # Calculate highlights
    agents = db.query(User).filter(User.is_active == True).all()
    highlights = {
        "top_solver": {"name": "None", "count": 0},
        "top_claimer": {"name": "None", "count": 0},
        "most_complaints": {"name": "None", "count": 0},
    }

    if convs:
        # Solver stats
        solver_counts = {}
        claimer_counts = {}
        complaint_counts = {}

        for c in convs:
            if c.assigned_to:
                # Claimer (assigned_to)
                claimer_counts[c.assigned_to] = claimer_counts.get(c.assigned_to, 0) + 1
                
                # Solver (assigned_to + resolved)
                if c.status == "resolved":
                    solver_counts[c.assigned_to] = solver_counts.get(c.assigned_to, 0) + 1
                
                # Complaints (assigned_to + (rating < 3 or category == Complaint))
                if (c.rating is not None and c.rating < 3) or c.category == "Complaint":
                    complaint_counts[c.assigned_to] = complaint_counts.get(c.assigned_to, 0) + 1

        # Map to names
        agent_map = {a.id: (a.display_name or a.full_name or a.username) for a in agents}
        
        if solver_counts:
            best_id = max(solver_counts, key=lambda i: solver_counts[i])
            highlights["top_solver"] = {"name": agent_map.get(best_id, "Unknown"), "count": solver_counts[best_id]}
        
        if claimer_counts:
            best_id = max(claimer_counts, key=lambda i: claimer_counts[i])
            highlights["top_claimer"] = {"name": agent_map.get(best_id, "Unknown"), "count": claimer_counts[best_id]}
            
        if complaint_counts:
            worst_id = max(complaint_counts, key=lambda i: complaint_counts[i])
            highlights["most_complaints"] = {"name": agent_map.get(worst_id, "Unknown"), "count": complaint_counts[worst_id]}

    return {
        "total": len(convs),
        "open": sum(1 for c in convs if c.status == "open"),
        "pending": sum(1 for c in convs if c.status == "pending"),
        "resolved": sum(1 for c in convs if c.status == "resolved"),
        "forwarded": len(forwarded_ids),
        "avg_first_response_min": round(sum(response_times) / len(response_times), 1) if response_times else None,
        "avg_resolution_min": round(sum(resolution_times) / len(resolution_times), 1) if resolution_times else None,
        "avg_rating": round(sum(ratings) / len(ratings), 2) if ratings else None,
        "rated_count": len(ratings),
        "by_category": by_category,
        "highlights": highlights,
    }


@router.get("/agents")
def get_agent_stats(
    date_from: Optional[date] = Query(None),
    date_to: Optional[date] = Query(None),
    team_id: Optional[int] = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(_require_admin),
):
    """Per-agent breakdown: claimed, open, pending, resolved, forwarded, response times."""
    agents = db.query(User).filter(User.is_active == True).all()
    result = []

    for agent in agents:
        q = db.query(Conversation).filter(Conversation.assigned_to == agent.id)
        if date_from:
            q = q.filter(Conversation.created_at >= datetime.combine(date_from, datetime.min.time()))
        if date_to:
            q = q.filter(Conversation.created_at <= datetime.combine(date_to, datetime.max.time()))
        if team_id:
            q = q.filter(Conversation.assigned_team_id == team_id)
        convs = q.all()

        conv_ids = [c.id for c in convs]
        forwarded_ids: set = set()
        if conv_ids:
            rows = db.query(MessageModel.conversation_id).filter(
                MessageModel.conversation_id.in_(conv_ids),
                MessageModel.message_type == "handover",
            ).distinct().all()
            forwarded_ids = {r[0] for r in rows}

        response_times = [
            (c.first_response_at - c.created_at).total_seconds() / 60
            for c in convs if c.first_response_at and c.created_at
        ]
        resolution_times = [
            (c.resolved_at - c.created_at).total_seconds() / 60
            for c in convs if c.resolved_at and c.created_at
        ]
        ratings = [c.rating for c in convs if c.rating is not None]

        result.append({
            "agent_id": agent.id,
            "name": agent.display_name or agent.full_name or agent.username,
            "real_name": agent.full_name or agent.username,
            "role": agent.role,
            "claimed": len(convs),
            "responded": sum(1 for c in convs if c.first_response_at is not None),
            "open": sum(1 for c in convs if c.status == "open"),
            "pending": sum(1 for c in convs if c.status == "pending"),
            "resolved": sum(1 for c in convs if c.status == "resolved"),
            "forwarded": len(forwarded_ids),
            "avg_first_response_min": round(sum(response_times) / len(response_times), 1) if response_times else None,
            "avg_resolution_min": round(sum(resolution_times) / len(resolution_times), 1) if resolution_times else None,
            "avg_rating": round(sum(ratings) / len(ratings), 2) if ratings else None,
            "rated_count": len(ratings),
        })

    result.sort(key=lambda x: x["claimed"], reverse=True)
    return result


@router.get("/conversations")
def get_conversations_report(
    date_from: Optional[date] = Query(None),
    date_to: Optional[date] = Query(None),
    agent_id: Optional[int] = Query(None),
    team_id: Optional[int] = Query(None),
    visitor: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    category: Optional[str] = Query(None),
    page: int = Query(1, ge=1),
    limit: int = Query(25, ge=1, le=100),
    db: Session = Depends(get_db),
    current_user: User = Depends(_require_admin),
):
    """Paginated, filterable conversation detail list."""
    q = _base_query(db, date_from, date_to, agent_id, team_id, visitor, status, category)
    total = q.count()
    convs = q.order_by(Conversation.created_at.desc()).offset((page - 1) * limit).limit(limit).all()

    user_ids = {c.assigned_to for c in convs if c.assigned_to}
    team_ids = {c.assigned_team_id for c in convs if c.assigned_team_id}
    users = {u.id: (u.display_name or u.full_name or u.username)
             for u in db.query(User).filter(User.id.in_(user_ids)).all()} if user_ids else {}
    teams = {t.id: t.name
             for t in db.query(Team).filter(Team.id.in_(team_ids)).all()} if team_ids else {}

    conv_ids = [c.id for c in convs]
    handover_counts: dict = {}
    if conv_ids:
        rows = db.query(MessageModel.conversation_id, func.count(MessageModel.id)).filter(
            MessageModel.conversation_id.in_(conv_ids),
            MessageModel.message_type == "handover",
        ).group_by(MessageModel.conversation_id).all()
        for cid, cnt in rows:
            handover_counts[cid] = cnt

    items = [{
        "id": c.id,
        "contact_name": c.contact_name,
        "contact_id": c.contact_id,
        "platform": c.platform,
        "status": c.status,
        "category": c.category or "General",
        "assigned_to_name": users.get(c.assigned_to) if c.assigned_to else None,
        "assigned_team_name": teams.get(c.assigned_team_id) if c.assigned_team_id else None,
        "forwarded_count": handover_counts.get(c.id, 0),
        "rating": c.rating,
        "rating_comment": c.rating_comment,
        "created_at": c.created_at,
        "resolved_at": c.resolved_at,
        "first_response_at": c.first_response_at,
    } for c in convs]

    return {"total": total, "page": page, "limit": limit, "items": items}


@router.get("/handovers")
def get_handovers_report(
    date_from: Optional[date] = Query(None),
    date_to: Optional[date] = Query(None),
    agent_id: Optional[int] = Query(None),
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
    current_user: User = Depends(_require_admin),
):
    """List of all handover/forwarding events with details and pagination."""
    q = db.query(MessageModel, Conversation).join(
        Conversation, MessageModel.conversation_id == Conversation.id
    ).filter(MessageModel.message_type == "handover")

    if date_from:
        q = q.filter(MessageModel.timestamp >= datetime.combine(date_from, datetime.min.time()))
    if date_to:
        q = q.filter(MessageModel.timestamp <= datetime.combine(date_to, datetime.max.time()))
    if agent_id:
        q = q.filter(MessageModel.sender_id == str(agent_id))

    total = q.count()
    rows = q.order_by(MessageModel.timestamp.desc()).offset((page - 1) * limit).limit(limit).all()

    items = []
    for msg, conv in rows:
        text = msg.message_text or ""
        initiator = msg.sender_name
        target = "Unknown"
        reason = "No note"

        if "claimed" in text:
            target = initiator
            reason = "Self-claim"
        elif "Forwarded to" in text:
            # Format: 🔄 Forwarded to {target_name} by {assigner_name} — {note}
            # Or: 👥 Forwarded to team "{team_name}" by {assigner_name} — {note}
            # Remove emojis for cleaner target parsing
            clean_text = text.encode("ascii", "ignore").decode("ascii").strip()
            parts = clean_text.split(" by ")
            if len(parts) > 1:
                mid_part = parts[0].replace("Forwarded to ", "").strip()
                target = mid_part.replace("team ", "").replace('"', "").strip()
                
                post_parts = parts[1].split(" — ")
                if len(post_parts) > 1:
                    reason = post_parts[1].strip()

        items.append({
            "id": msg.id,
            "conversation_id": conv.id,
            "visitor_name": conv.contact_name,
            "platform": conv.platform,
            "timestamp": msg.timestamp,
            "initiator": initiator,
            "target": target,
            "reason": reason,
            "raw_text": text
        })

    return {"total": total, "items": items}

@router.get("/emails/summary")
def get_email_agent_summary(
    date_from: Optional[date] = Query(None),
    date_to: Optional[date] = Query(None),
    agent_id: Optional[int] = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(_require_admin)
):
    """Aggregate email stats by agent."""
    q = db.query(Email, UserEmailAccount, User).join(
        UserEmailAccount, Email.account_id == UserEmailAccount.id
    ).join(
        User, UserEmailAccount.user_id == User.id
    )

    if date_from:
        q = q.filter(Email.received_at >= datetime.combine(date_from, datetime.min.time()))
    if date_to:
        q = q.filter(Email.received_at <= datetime.combine(date_to, datetime.max.time()))
    if agent_id:
        q = q.filter(User.id == agent_id)

    # Note: we need to handle "got_replied" logic. 
    # That is emails received (is_sent=False) that are replies (in_reply_to != None).
    rows = q.all()

    agent_stats = {}
    
    for email, account, user in rows:
        uid = user.id
        if uid not in agent_stats:
            agent_stats[uid] = {
                "agent_id": uid,
                "name": user.full_name or user.display_name or "Unknown Agent",
                "received_count": 0,
                "sent_new_count": 0,
                "replied_count": 0,
                "got_replied_count": 0
            }
        
        if email.is_sent:
            if email.in_reply_to:
                agent_stats[uid]["replied_count"] = int(agent_stats[uid]["replied_count"]) + 1 # type: ignore
            else:
                agent_stats[uid]["sent_new_count"] = int(agent_stats[uid]["sent_new_count"]) + 1 # type: ignore
        else:
            if email.in_reply_to:
                agent_stats[uid]["got_replied_count"] = int(agent_stats[uid]["got_replied_count"]) + 1 # type: ignore
            else:
                agent_stats[uid]["received_count"] = int(agent_stats[uid]["received_count"]) + 1 # type: ignore
                
    return list(agent_stats.values())


@router.get("/emails")
def get_emails_report(
    date_from: Optional[date] = Query(None),
    date_to: Optional[date] = Query(None),
    agent_id: Optional[int] = Query(None),
    search: Optional[str] = Query(None),
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
    current_user: User = Depends(_require_admin),
):
    """List of detailed emails grouped by thread with pagination."""
    q = db.query(Email, UserEmailAccount, User).join(
        UserEmailAccount, Email.account_id == UserEmailAccount.id
    ).join(
        User, UserEmailAccount.user_id == User.id
    )

    if date_from:
        q = q.filter(Email.received_at >= datetime.combine(date_from, datetime.min.time()))
    if date_to:
        q = q.filter(Email.received_at <= datetime.combine(date_to, datetime.max.time()))
    if agent_id:
        q = q.filter(User.id == agent_id)
    if search:
        from sqlalchemy import or_
        term = f"%{search}%"
        q = q.filter(
            or_(
                Email.subject.ilike(term),
                Email.from_address.ilike(term),
                Email.to_address.ilike(term),
                Email.body_text.ilike(term)
            )
        )

    # First, get all matching rows
    # Then group them in Python by thread_id (or ID if no thread) to get distinct thread views.
    # We order by received_at desc so the first one we encounter for a thread is the latest context.
    rows = q.order_by(Email.received_at.desc()).all()

    # Dictionary to hold the grouped threads
    from collections import OrderedDict
    threads_map = OrderedDict()
    
    # Track raw total before grouping might not be exactly what we want,
    # The actual "total items" is the number of distinct threads matching criteria.
    for email, account, user in rows:
        key = email.thread_id if email.thread_id else f"no_thread_{email.id}"
        if key not in threads_map:
            etype = "Received"
            if email.is_sent:
                etype = "Replied" if email.in_reply_to else "Sent New"
            else:
                etype = "Got Replied" if email.in_reply_to else "Received"

            # Snippet logic for body
            snippet = ""
            if email.body_text:
                snippet = email.body_text[:100].replace('\n', ' ').strip()
                if len(email.body_text) > 100:
                    snippet += "..."

            threads_map[key] = {
                "id": email.id, # The ID of the most recent email in thread for reference
                "subject": email.subject or "(No Subject)",
                "body_snippet": snippet,
                "from_address": email.from_address,
                "to_address": email.to_address,
                "received_at": email.received_at,
                "is_sent": email.is_sent,
                "type": etype,
                "agent_name": user.full_name or user.display_name or "Unknown",
                "thread_id": email.thread_id,
                "message_count": int(0) # We will increment this
            }
        
        # Increment the count of messages matching the filter in this thread
        threads_map[key]["message_count"] = int(threads_map[key]["message_count"]) + 1

    # Now we have our distinct threads. Apply pagination.
    all_items = list(threads_map.values())
    total_threads = len(all_items)
    
    start_idx = (page - 1) * limit
    end_idx = start_idx + limit
    paginated_items = all_items[start_idx:end_idx]

    return {"total": total_threads, "items": paginated_items}


@router.get("/emails/thread/{thread_id}")
def get_report_email_thread(
    thread_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(_require_admin)
):
    """Admin endpoint to get all emails in a thread regardless of account ownership."""
    emails = (
        db.query(Email)
        .filter(Email.thread_id == thread_id, Email.is_draft == False)
        .order_by(Email.received_at.asc())
        .all()
    )
    
    if not emails:
        raise HTTPException(status_code=404, detail="Thread not found")
        
    return {"emails": emails}

@router.get("/emails/{email_id}")
def get_report_email_single(
    email_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(_require_admin)
):
    """Admin endpoint to get a single email regardless of account ownership."""
    email = db.query(Email).filter(Email.id == email_id).first()
    
    if not email:
        raise HTTPException(status_code=404, detail="Email not found")
        
    return email
