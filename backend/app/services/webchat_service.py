"""WebSocket manager for live visitor (webchat widget) connections"""
import logging
from typing import Dict
from fastapi import WebSocket

logger = logging.getLogger(__name__)


class WebchatService:
    def __init__(self):
        # session_id (str) -> WebSocket
        self.connections: Dict[str, WebSocket] = {}

    async def connect(self, session_id: str, websocket: WebSocket):
        self.connections[session_id] = websocket
        logger.info(f"[webchat] visitor connected: {session_id}")

    def disconnect(self, session_id: str):
        self.connections.pop(session_id, None)
        logger.info(f"[webchat] visitor disconnected: {session_id}")

    async def send_to_visitor(self, session_id: str, data: dict) -> bool:
        """Push a message to a visitor's open WebSocket. Returns True if delivered."""
        ws = self.connections.get(session_id)
        if ws:
            try:
                await ws.send_json(data)
                return True
            except Exception as e:
                logger.error(f"[webchat] send error for {session_id}: {e}")
                self.disconnect(session_id)
        return False

    def is_online(self, session_id: str) -> bool:
        return session_id in self.connections


webchat_service = WebchatService()
