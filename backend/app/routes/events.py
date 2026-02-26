"""
WebSocket routes for real-time events
"""

from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Depends, Query, status
from sqlalchemy.orm import Session
from app.database import get_db
from app.services.events_service import events_service, EventTypes
from app.dependencies import verify_token
import logging
import json

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/events", tags=["events"])

@router.websocket("/ws/connect")
async def websocket_endpoint(
    websocket: WebSocket,
    token: str = Query(...),
    db: Session = Depends(get_db)
):
    """WebSocket endpoint for real-time events"""

    # Always accept the connection first so we can send close codes properly
    await websocket.accept()

    try:
        # Verify token
        user = await verify_token(token)
        if not user:
            await websocket.close(code=status.WS_1008_POLICY_VIOLATION, reason="Invalid token")
            return
        
        # Connect the websocket
        await events_service.connect(websocket, user.id)
        
        # Send welcome message
        timezone = events_service.get_timezone(db)
        await websocket.send_json({
            "type": "connection_established",
            "user_id": user.id,
            "timezone": timezone,
            "message": "Connected to real-time events"
        })
        
        # Listen for incoming messages from client
        while True:
            try:
                data = await websocket.receive_text()
                message = json.loads(data)
                
                # Handle ping/pong for keep-alive
                if message.get("type") == "ping":
                    await websocket.send_json({"type": "pong"})
                
            except WebSocketDisconnect:
                raise
            except json.JSONDecodeError:
                await websocket.send_json({
                    "type": "error",
                    "message": "Invalid JSON format"
                })
            except Exception as e:
                logger.error(f"Error processing WebSocket message: {str(e)}")
                break
    
    except WebSocketDisconnect:
        logger.info("WebSocket disconnected (client navigated away)")
    except Exception as e:
        logger.error(f"WebSocket error: {str(e)}")
        try:
            await websocket.close(code=status.WS_1011_SERVER_ERROR)
        except:
            pass
    finally:
        events_service.disconnect(websocket)


@router.get("/")
async def get_events_info(user=Depends(verify_token)):
    """Get information about the events system"""
    return {
        "status": "success",
        "data": {
            "websocket_url": "/events/ws/connect",
            "event_types": [
                EventTypes.MESSAGE_SENT,
                EventTypes.MESSAGE_RECEIVED,
                EventTypes.MESSAGE_UPDATED,
                EventTypes.MESSAGE_DELETED,
                EventTypes.CONVERSATION_CREATED,
                EventTypes.CONVERSATION_UPDATED,
                EventTypes.USER_ONLINE,
                EventTypes.USER_OFFLINE,
                EventTypes.TYPING_INDICATOR,
                EventTypes.CONTACT_UPDATED,
                EventTypes.ACCOUNT_CONNECTED,
                EventTypes.ACCOUNT_DISCONNECTED,
                EventTypes.EMAIL_RECEIVED,
                EventTypes.EMAIL_SENT,
                EventTypes.SYSTEM_NOTIFICATION,
            ],
            "message": "Connect to /events/ws/connect with your auth token to receive real-time updates"
        }
    }
