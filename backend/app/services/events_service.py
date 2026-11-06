"""
Real-time events service for WebSocket connections
"""

import asyncio
import json
import logging
from typing import Set, Dict, Callable, Optional, Tuple
from datetime import datetime
from fastapi import WebSocket
from sqlalchemy.orm import Session
from app.models.branding import BrandingSettings

logger = logging.getLogger(__name__)


# Events worth waking a phone for, and how to word the notification. Anything
# not listed here (typing indicators, status changes, read receipts) is noise
# on a lock screen and is skipped.
#
# The wording deliberately mirrors components/EventNotifications.tsx so the
# banner and the in-app toast read the same.
def _message_body(d: dict) -> str:
    who = d.get("visitor_name") or d.get("sender_name") or "Unknown"
    text = (d.get("message_text") or d.get("text") or "").strip()
    return f"{who}: {text[:120]}" if text else f"New message from {who}"


PUSHABLE_EVENTS: Dict[str, Tuple[str, Callable[[dict], str]]] = {
    "message_received": ("New message", _message_body),
    "email_received": (
        "New email",
        lambda d: f"From {d['sender']}" if d.get("sender") else "You have new mail",
    ),
    "conversation_assigned": (
        "Conversation assigned to you",
        lambda d: (
            f"{d.get('assigned_by_name') or 'A teammate'} forwarded "
            f"{d.get('contact_name') or 'a chat'} to you"
        ),
    ),
    "pms_task_assigned": (
        "Task assigned",
        lambda d: (
            f"{d.get('assigned_by') or 'Someone'} assigned "
            f"\"{d.get('task_title') or 'a task'}\" to you"
        ),
    ),
    "support_ticket_raised": (
        "New support request",
        lambda d: d.get("support_subject") or d.get("subject") or "A customer raised a request",
    ),
}

# Keys the mobile app reads to decide which screen to open on tap
# (routeForNotification in components/NativeShell.tsx).
_ROUTING_KEYS = ("conversation_id", "ticket_number", "email_id", "route")

class EventsService:
    """Service for managing real-time events and WebSocket connections"""
    
    def __init__(self):
        # Store active connections grouped by user_id
        self.active_connections: Dict[int, Set[WebSocket]] = {}
        self.user_ids: Dict[WebSocket, int] = {}
    
    async def connect(self, websocket: WebSocket, user_id: int):
        """Register an already-accepted WebSocket connection"""
        if user_id not in self.active_connections:
            self.active_connections[user_id] = set()
        
        self.active_connections[user_id].add(websocket)
        self.user_ids[websocket] = user_id
        
        logger.info(f"User {user_id} connected. Total connections: {len(self.active_connections[user_id])}")
    
    def disconnect(self, websocket: WebSocket):
        """Remove a WebSocket connection"""
        if websocket in self.user_ids:
            user_id = self.user_ids[websocket]
            
            if user_id in self.active_connections:
                self.active_connections[user_id].discard(websocket)
                
                # Cleanup if no connections for this user
                if not self.active_connections[user_id]:
                    del self.active_connections[user_id]
                
                logger.info(f"User {user_id} disconnected. Total connections: {len(self.active_connections.get(user_id, set()))}")
            
            del self.user_ids[websocket]
    
    async def broadcast_to_user(self, user_id: int, event: dict):
        """
        Broadcast an event to all connections of a specific user.

        With no open connection the agent's app is closed or swapped out, so
        the event is sent as a push notification instead. This is the one
        place that knows an agent is unreachable in real time, which is why
        the fallback lives here rather than at each call site.
        """
        if user_id not in self.active_connections:
            await self._push_fallback(user_id, event)
            return
        
        disconnected_sockets = set()
        
        for connection in self.active_connections[user_id]:
            try:
                await connection.send_json(event)
            except Exception as e:
                logger.error(f"Error sending event to user {user_id}: {str(e)}")
                disconnected_sockets.add(connection)
        
        # Clean up disconnected sockets
        for socket in disconnected_sockets:
            self.disconnect(socket)
    
    async def broadcast_to_all(self, event: dict):
        """Broadcast an event to all connected users"""
        disconnected_sockets = set()
        
        for user_id, connections in list(self.active_connections.items()):
            for connection in list(connections):
                try:
                    await connection.send_json(event)
                except Exception as e:
                    logger.error(f"Error sending event to user {user_id}: {str(e)}")
                    disconnected_sockets.add(connection)
        
        # Clean up disconnected sockets
        for socket in disconnected_sockets:
            self.disconnect(socket)
    
    async def _push_fallback(self, user_id: int, event: dict) -> None:
        """
        Sends `event` to the agent's phones via FCM.

        Never raises and never blocks the event loop: push_service uses
        `requests` (sync), so the send runs in a worker thread. A failure here
        must not affect the action that produced the event.
        """
        try:
            wording = PUSHABLE_EVENTS.get(event.get("type", ""))
            if not wording:
                return

            from app.services import push_service

            if not push_service.is_configured():
                return

            title, build_body = wording
            data = event.get("data") or {}
            body = build_body(data)

            payload = {k: data[k] for k in _ROUTING_KEYS if data.get(k) is not None}
            payload["event_type"] = event.get("type", "")

            await asyncio.to_thread(self._send_push_sync, user_id, title, body, payload)
        except Exception as err:
            logger.warning("Push fallback failed for user %s: %s", user_id, err)

    @staticmethod
    def _send_push_sync(user_id: int, title: str, body: str, data: dict) -> None:
        """Worker-thread half of _push_fallback: owns its own DB session."""
        from app.database import SessionLocal
        from app.services import push_service

        db = SessionLocal()
        try:
            push_service.notify_user(db, user_id, title, body, data)
        finally:
            db.close()

    def get_connected_user_count(self) -> int:
        """Return number of distinct users with active connections"""
        return len(self.active_connections)

    @staticmethod
    def create_event(event_type: str, data: dict, db: Session = None, timezone: str = "UTC") -> dict:
        """Create a standardized event object with timezone support"""
        return {
            "type": event_type,
            "timestamp": datetime.utcnow().isoformat(),
            "timezone": timezone,
            "data": data
        }
    
    @staticmethod
    def get_timezone(db: Session) -> str:
        """Get configured timezone from branding settings"""
        try:
            branding = db.query(BrandingSettings).first()
            if branding and branding.timezone:
                return branding.timezone
        except Exception as e:
            logger.error(f"Error fetching timezone: {str(e)}")
        
        return "UTC"

# Singleton instance
events_service = EventsService()


# Event types
class EventTypes:
    """Standard event types"""
    MESSAGE_SENT = "message_sent"
    MESSAGE_RECEIVED = "message_received"
    MESSAGE_UPDATED = "message_updated"
    MESSAGE_DELETED = "message_deleted"
    CONVERSATION_CREATED = "conversation_created"
    CONVERSATION_UPDATED = "conversation_updated"
    USER_ONLINE = "user_online"
    USER_OFFLINE = "user_offline"
    TYPING_INDICATOR = "typing_indicator"
    CONTACT_UPDATED = "contact_updated"
    ACCOUNT_CONNECTED = "account_connected"
    ACCOUNT_DISCONNECTED = "account_disconnected"
    EMAIL_RECEIVED = "email_received"
    EMAIL_SENT = "email_sent"
    SYSTEM_NOTIFICATION = "system_notification"
    REMINDER_SHARED = "reminder_shared"
    REMINDER_COMMENT = "reminder_comment"
    REMINDER_DUE = "reminder_due"
    # CRM events
    CRM_LEAD_ASSIGNED = "crm_lead_assigned"
    CRM_LEAD_CREATED = "crm_lead_created"
    CRM_LEAD_UPDATED = "crm_lead_updated"
    CRM_LEAD_DELETED = "crm_lead_deleted"
    CRM_DEAL_CREATED = "crm_deal_created"
    CRM_DEAL_UPDATED = "crm_deal_updated"
    CRM_DEAL_DELETED = "crm_deal_deleted"
    CRM_DEAL_STAGE_CHANGED = "crm_deal_stage_changed"
    CRM_TASK_UPDATED = "crm_task_updated"
    CRM_TASK_OVERDUE = "crm_task_overdue"
    CRM_TASK_DUE_SOON = "crm_task_due_soon"
    # Visitors events
    VISITOR_CHECKIN = "visitor_checkin"
    # PMS events
    PMS_TASK_ASSIGNED = "pms_task_assigned"
    PMS_TASK_TRANSITIONED = "pms_task_transitioned"
    PMS_COMMENT_ADDED = "pms_comment_added"
    PMS_TASK_OVERDUE = "pms_task_overdue"
    PMS_ESCALATION = "pms_escalation"
    PMS_TASK_UPDATED = "pms_task_updated"
    # Daily Ops events
    STANDUP_POSTED = "standup_posted"
    STANDUP_DELETED = "standup_deleted"
