"""
Real-time events service for WebSocket connections
"""

import json
import logging
from typing import Set, Dict, Callable
from datetime import datetime
from fastapi import WebSocket
from sqlalchemy.orm import Session
from app.models.branding import BrandingSettings

logger = logging.getLogger(__name__)

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
        """Broadcast an event to all connections of a specific user"""
        if user_id not in self.active_connections:
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
