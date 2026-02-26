from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List, Optional
from pydantic import BaseModel
from datetime import datetime
from app.database import get_db
from app.models.conversation import Conversation
from app.models.message import Message as MessageModel
from app.models.user import User
from app.models.team import Team
from app.schemas.conversation import ConversationResponse
from app.dependencies import get_current_user
from app.services.events_service import events_service

router = APIRouter(prefix="/conversations", tags=["conversations"])


def _enrich(convs, db: Session):
    """Attach assigned_to_name and assigned_team_name by doing batched lookups."""
    user_ids = {c.assigned_to for c in convs if c.assigned_to}
    team_ids = {getattr(c, 'assigned_team_id', None) for c in convs if getattr(c, 'assigned_team_id', None)}
    users = {u.id: (u.full_name or u.username) for u in
             db.query(User).filter(User.id.in_(user_ids)).all()} if user_ids else {}
    teams = {t.id: t.name for t in
             db.query(Team).filter(Team.id.in_(team_ids)).all()} if team_ids else {}
    result = []
    for c in convs:
        d = {col.name: getattr(c, col.name) for col in c.__table__.columns}
        d['assigned_to_name'] = users.get(c.assigned_to) if c.assigned_to else None
        d['assigned_team_id'] = getattr(c, 'assigned_team_id', None)
        d['assigned_team_name'] = teams.get(d['assigned_team_id']) if d['assigned_team_id'] else None
        result.append(d)
    return result


class StatusUpdate(BaseModel):
    status: str  # open, pending, resolved


class CategoryUpdate(BaseModel):
    category: str  # General, Billing, Technical Support, Sales, Complaint, Other


class AssignUpdate(BaseModel):
    user_id: Optional[int] = None
    team_id: Optional[int] = None
    note: Optional[str] = None  # reason for forwarding


@router.get("/", response_model=List[ConversationResponse])
def get_conversations(
    user_id: int,
    platform: str = None,
    status: str = None,
    assigned_to: Optional[str] = None,
    db: Session = Depends(get_db)
):
    """Get all conversations for a user, optionally filtered by platform, status, and/or assigned agent.
    Pass assigned_to=none to get only unassigned conversations."""
    from sqlalchemy import or_

    query = db.query(Conversation).filter(
        or_(
            Conversation.user_id == user_id,
            Conversation.platform == "webchat",  # visible to every agent
            Conversation.platform == "email",     # email conversations shared like webchat
        )
    )

    if platform:
        query = query.filter(Conversation.platform == platform.lower())
    if status:
        query = query.filter(Conversation.status == status.lower())
    if assigned_to == 'none':
        query = query.filter(Conversation.assigned_to == None)
    elif assigned_to is not None:
        try:
            query = query.filter(Conversation.assigned_to == int(assigned_to))
        except ValueError:
            pass

    conversations = query.order_by(Conversation.updated_at.desc()).all()
    return _enrich(conversations, db)


@router.get("/agents")
def list_agents(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Return list of active users for the assignment dropdown."""
    agents = db.query(User).filter(User.is_active == True).order_by(User.full_name).all()
    return [{
        "id": a.id,
        "full_name": a.display_name or a.full_name or a.username,
        "real_name": a.full_name or a.username,
        "role": a.role
    } for a in agents]


@router.get("/search", response_model=List[ConversationResponse])
def search_conversations(
    user_id: int,
    query: str,
    db: Session = Depends(get_db)
):
    """Search conversations by contact name or contact identifier."""
    from sqlalchemy import or_
    conversations = db.query(Conversation).filter(
        or_(
            Conversation.user_id == user_id,
            Conversation.platform == "webchat",
        ),
        or_(
            Conversation.contact_name.ilike(f"%{query}%"),
            Conversation.contact_id.ilike(f"%{query}%"),
        )
    ).order_by(Conversation.updated_at.desc()).all()
    return _enrich(conversations, db)


@router.put("/{conversation_id}")
def mark_conversation_as_read(
    conversation_id: int,
    db: Session = Depends(get_db)
):
    """Mark all messages in a conversation as read."""
    conversation = db.query(Conversation).filter(
        Conversation.id == conversation_id
    ).first()

    if not conversation:
        raise HTTPException(status_code=404, detail="Conversation not found")

    conversation.unread_count = 0
    db.commit()
    return {"success": True, "message": "Conversation marked as read"}


@router.patch("/{conversation_id}/status")
def update_conversation_status(
    conversation_id: int,
    body: StatusUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Set conversation status: open, pending, or resolved."""
    valid = {"open", "pending", "resolved"}
    if body.status not in valid:
        raise HTTPException(status_code=400, detail=f"status must be one of {sorted(valid)}")
    conv = db.query(Conversation).filter(Conversation.id == conversation_id).first()
    if not conv:
        raise HTTPException(status_code=404, detail="Conversation not found")
    conv.status = body.status
    if body.status == "resolved" and not conv.resolved_at:
        conv.resolved_at = datetime.utcnow()
    elif body.status != "resolved":
        conv.resolved_at = None
    db.commit()
    return {"success": True, "status": conv.status}


@router.patch("/{conversation_id}/category")
def update_conversation_category(
    conversation_id: int,
    body: CategoryUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Tag a conversation with an issue category."""
    conv = db.query(Conversation).filter(Conversation.id == conversation_id).first()
    if not conv:
        raise HTTPException(status_code=404, detail="Conversation not found")
    conv.category = body.category
    db.commit()
    return {"success": True, "category": conv.category}


@router.patch("/{conversation_id}/assign")
async def assign_conversation(
    conversation_id: int,
    body: AssignUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Assign/forward conversation to an agent. Stores a handover note in chat history
    and sends a real-time notification to the target agent."""
    conv = db.query(Conversation).filter(Conversation.id == conversation_id).first()
    if not conv:
        raise HTTPException(status_code=404, detail="Conversation not found")
    target_agent = None
    if body.user_id is not None:
        target_agent = db.query(User).filter(User.id == body.user_id, User.is_active == True).first()
        if not target_agent:
            raise HTTPException(status_code=404, detail="Agent not found")
    conv.assigned_to = body.user_id
    if body.team_id is not None:
        team_check = db.query(Team).filter(Team.id == body.team_id).first()
        if not team_check:
            raise HTTPException(status_code=404, detail="Team not found")
        conv.assigned_team_id = body.team_id
    elif body.user_id is not None:
        # Individual assignment clears team
        conv.assigned_team_id = None
    db.commit()

    # Insert a system/handover message so the reason is visible in conversation history
    assigner_name = current_user.display_name or current_user.full_name or current_user.username
    if body.user_id is not None and target_agent:
        target_name = target_agent.display_name or target_agent.full_name or target_agent.username
        note_text = (body.note or "").strip()
        if body.user_id == current_user.id:
            msg_text = f"\U0001f64b {assigner_name} claimed this conversation"
        else:
            msg_text = f"\U0001f504 Forwarded to {target_name} by {assigner_name}"
            if note_text:
                msg_text += f" \u2014 {note_text}"
        handover_msg = MessageModel(
            conversation_id=conversation_id,
            sender_id=str(current_user.id),
            sender_name=assigner_name,
            message_text=msg_text,
            message_type="handover",
            platform=conv.platform,
            is_sent=1,
            read_status=1,
            delivery_status="delivered",
        )
        db.add(handover_msg)
        db.commit()
        db.refresh(handover_msg)

        # Push the handover strip to the visitor's active WebSocket (webchat only)
        if conv.platform == "webchat":
            from app.services.webchat_service import webchat_service
            await webchat_service.send_to_visitor(conversation_id, {
                "type": "message",
                "id": handover_msg.id,
                "text": msg_text,
                "message_type": "handover",
                "sender": assigner_name,
                "is_agent": True,
                "timestamp": handover_msg.timestamp.isoformat() if handover_msg.timestamp else None,
            })

        # Notify the target agent in real time (only if forwarding to someone else)
        if body.user_id != current_user.id:
            await events_service.broadcast_to_user(body.user_id, {
                "type": "conversation_assigned",
                "data": {
                    "conversation_id": conversation_id,
                    "assigned_to_id": body.user_id,
                    "contact_name": conv.contact_name,
                    "platform": conv.platform,
                    "assigned_by_id": current_user.id,
                    "assigned_by_name": assigner_name,
                    "note": note_text,
                    "timestamp": datetime.utcnow().isoformat(),
                }
            })

    # Team assignment: insert handover note + notify all team members
    if body.team_id is not None and body.user_id is None:
        team = db.query(Team).filter(Team.id == body.team_id).first()
        if team:
            note_text = (body.note or "").strip()
            msg_text = f"\U0001f465 Forwarded to team \"{team.name}\" by {assigner_name}"
            if note_text:
                msg_text += f" \u2014 {note_text}"
            handover_msg = MessageModel(
                conversation_id=conversation_id,
                sender_id=str(current_user.id),
                sender_name=assigner_name,
                message_text=msg_text,
                message_type="handover",
                platform=conv.platform,
                is_sent=1,
                read_status=1,
                delivery_status="delivered",
            )
            db.add(handover_msg)
            db.commit()
            db.refresh(handover_msg)
            if conv.platform == "webchat":
                from app.services.webchat_service import webchat_service
                await webchat_service.send_to_visitor(conversation_id, {
                    "type": "message",
                    "id": handover_msg.id,
                    "text": msg_text,
                    "message_type": "handover",
                    "sender": assigner_name,
                    "is_agent": True,
                    "timestamp": handover_msg.timestamp.isoformat() if handover_msg.timestamp else None,
                })
            notification = {
                "type": "conversation_assigned",
                "data": {
                    "conversation_id": conversation_id,
                    "team_id": team.id,
                    "team_name": team.name,
                    "contact_name": conv.contact_name,
                    "platform": conv.platform,
                    "assigned_by_id": current_user.id,
                    "assigned_by_name": assigner_name,
                    "note": note_text,
                    "timestamp": datetime.utcnow().isoformat(),
                }
            }
            for member in team.members:
                if member.id != current_user.id:
                    await events_service.broadcast_to_user(member.id, notification)

    return {"success": True, "assigned_to": conv.assigned_to, "assigned_team_id": getattr(conv, "assigned_team_id", None)}


@router.delete("/{conversation_id}")
def delete_conversation(
    conversation_id: int,
    db: Session = Depends(get_db)
):
    """Delete a conversation."""
    conversation = db.query(Conversation).filter(
        Conversation.id == conversation_id
    ).first()

    if not conversation:
        raise HTTPException(status_code=404, detail="Conversation not found")

    db.delete(conversation)
    db.commit()
    return {"success": True, "message": "Conversation deleted"}
