# Real-Time Events Implementation Guide

## Summary

This implementation adds real-time event support to the Social Media Messenger using WebSockets. It includes:

1. **Backend WebSocket Server** - FastAPI WebSocket endpoint for real-time communication
2. **Event Service** - Manages WebSocket connections and broadcasts events
3. **Frontend Events Context** - React context for managing WebSocket subscriptions
4. **Timezone Support** - All events include timezone information for proper date formatting
5. **Real-time Notifications** - Visual notifications component for displaying events
6. **Date/Time Utilities** - Helper functions for timezone-aware date formatting

## Files Modified/Created

### Backend Files

1. **`app/services/events_service.py`** (NEW)
   - EventsService class manages WebSocket connections
   - Handles event creation and broadcasting
   - Supports timezone-aware event timestamps

2. **`app/routes/events.py`** (NEW)
   - WebSocket endpoint at `/events/ws/connect`
   - REST endpoint at `/events/` for information
   - Token-based authentication for WebSocket connections

3. **`app/routes/messages.py`** (MODIFIED)
   - Updated send_message endpoint to emit message_sent events
   - Updated mark_message_as_read to emit message_updated events
   - Added event broadcasting to users

4. **`app/dependencies.py`** (MODIFIED)
   - Added verify_token function for WebSocket authentication
   - Added useAuth hook for React

5. **`main.py`** (MODIFIED)
   - Added events router import
   - Registered events router with FastAPI

6. **`app/routes/branding.py`** (MODIFIED)
   - Updated to include timezone in responses
   - Updated both public and admin endpoints

7. **`app/services/branding_service.py`** (MODIFIED)
   - Added timezone to allowed_fields
   - Updated get_branding_public to include timezone

8. **`app/models/branding.py`** (ALREADY HAD)
   - Already includes timezone field with default "UTC"

### Frontend Files

1. **`lib/events-context.tsx`** (NEW)
   - EventsProvider component for WebSocket management
   - useEvents hook for using events in components
   - Auto-reconnection logic

2. **`lib/date-utils.ts`** (NEW)
   - Timezone-aware date formatting utilities
   - Functions for formatting dates, times, and relative times

3. **`lib/auth.ts`** (MODIFIED)
   - Added useAuth hook that returns token, user, and isAuthenticated

4. **`lib/branding-context.tsx`** (MODIFIED)
   - Added timezone field to BrandingSettings interface
   - Updated default branding to include timezone

5. **`components/EventNotifications.tsx`** (NEW)
   - Component that displays real-time notifications
   - Subscribes to message and email events
   - Shows formatted timestamps using timezone

6. **`app/layout-client.tsx`** (MODIFIED)
   - Added EventsProvider wrapper
   - Added EventNotifications component

### Documentation

1. **`REALTIME_EVENTS_DOCUMENTATION.md`** (NEW)
   - Comprehensive documentation of the real-time events system
   - API reference
   - Usage examples
   - Troubleshooting guide

2. **`IMPLEMENTATION_GUIDE.md`** (THIS FILE)
   - Overview of implementation
   - Files created/modified
   - Setup and deployment instructions

## Setup Instructions

### Backend Setup

1. **No database migrations needed** - Branding table already has timezone field

2. **Verify imports** - The events_service.py and events.py files are properly imported in main.py

3. **Test WebSocket endpoint**:
   ```bash
   # Check if the endpoint is registered
   curl http://localhost:8000/events/
   ```

### Frontend Setup

1. **No additional dependencies needed** - Uses built-in WebSocket API

2. **EventsProvider is automatically included** in layout-client.tsx

3. **EventNotifications component** is automatically rendered

## Testing the Implementation

### 1. Test Backend WebSocket

```bash
# Using wscat (install: npm install -g wscat)
wscat -c 'ws://localhost:8000/events/ws/connect?token=1'

# You should see:
# Connected (press CTRL+C to quit)
# < {"type":"connection_established","user_id":1,"timezone":"UTC","message":"Connected to real-time events"}

# Send ping
# > {"type":"ping"}
# < {"type":"pong"}
```

### 2. Test Event Emission

Create a test script to verify events are being emitted:

```python
# backend/test_events.py
import asyncio
from app.services.events_service import events_service, EventTypes
from app.database import SessionLocal

async def test_event():
    db = SessionLocal()
    
    # Create an event
    event = events_service.create_event(
        EventTypes.MESSAGE_SENT,
        data={
            "message_id": 1,
            "conversation_id": 1,
            "sender_name": "Test User",
            "receiver_name": "Contact",
            "message_text": "Hello"
        },
        db=db
    )
    
    # Broadcast to user
    await events_service.broadcast_to_user(1, event)
    
    db.close()
    print("Event sent!")

if __name__ == "__main__":
    asyncio.run(test_event())
```

### 3. Test Frontend Events Component

```tsx
// Test component to verify events are working
import { useEvents } from '@/lib/events-context'
import { useEffect, useState } from 'react'

export function EventsTest() {
  const { connected, error, timezone, lastEvent } = useEvents()
  const [eventCount, setEventCount] = useState(0)

  useEffect(() => {
    if (lastEvent) {
      setEventCount((prev) => prev + 1)
      console.log('Event received:', lastEvent)
    }
  }, [lastEvent])

  return (
    <div className="p-4 border">
      <h2>Events Test Panel</h2>
      <p>Connected: {connected ? '✓' : '✗'}</p>
      <p>Error: {error || 'None'}</p>
      <p>Timezone: {timezone}</p>
      <p>Events Received: {eventCount}</p>
      <pre>{JSON.stringify(lastEvent, null, 2)}</pre>
    </div>
  )
}
```

## Deployment Checklist

### Pre-Deployment

- [ ] Run backend tests: `python -m pytest`
- [ ] Run frontend tests: `npm test`
- [ ] Verify WebSocket endpoint: `curl http://localhost:8000/events/`
- [ ] Test WebSocket connection with wscat
- [ ] Verify timezone is configured in branding settings
- [ ] Check all imports in Python files
- [ ] Check TypeScript compilation: `npm run build`

### Deployment

- [ ] Build frontend: `npm run build`
- [ ] Build Docker image (if using Docker)
- [ ] Update environment variables (if needed)
- [ ] Deploy backend
- [ ] Deploy frontend
- [ ] Verify WebSocket connection works
- [ ] Test event notifications in UI

### Post-Deployment

- [ ] Monitor logs for any connection errors
- [ ] Test sending/receiving messages
- [ ] Verify notifications appear
- [ ] Check timezone formatting is correct
- [ ] Monitor performance and connection stability

## Environment Variables

No new environment variables are required. The system uses existing configuration:

- `NEXT_PUBLIC_API_URL` - Backend API URL (for REST endpoints)
- `NEXT_PUBLIC_WS_URL` - Backend WebSocket URL (defaults to same as API URL)

## Performance Considerations

1. **WebSocket Connections**: Each user maintains one WebSocket connection
2. **Memory**: Connections are efficiently managed and cleared on disconnect
3. **Bandwidth**: Events are only sent to subscribed users
4. **CPU**: Minimal overhead per event broadcast

## Security Considerations

1. **Authentication**: All WebSocket connections require valid user token
2. **Authorization**: Events are only sent to the authenticated user
3. **CORS**: WebSocket follows same CORS rules as REST API
4. **Transport**: Use WSS (secure WebSocket) in production

## Monitoring and Debugging

### Backend Logs

Events are logged using Python's logging module at:
- User connected: "User {user_id} connected"
- User disconnected: "User {user_id} disconnected"
- Event errors: "Error sending event to user {user_id}: ..."

### Frontend Console

Check browser console for:
- "WebSocket connected"
- "WebSocket disconnected"
- "Error parsing WebSocket message"
- Event data from subscribers

## Troubleshooting

### WebSocket Not Connecting

1. Check if token is properly formatted
2. Verify backend is running and events route is registered
3. Check browser console for connection errors
4. Verify CORS configuration allows WebSocket

### Events Not Being Received

1. Verify WebSocket is connected
2. Check if subscription uses correct event type (case-sensitive)
3. Verify authentication token is valid
4. Check backend logs for broadcast errors

### Timezone Issues

1. Verify timezone is set in admin branding settings
2. Check if timezone string is valid IANA timezone
3. Test with available timezones from the utility function
4. Check browser supports the timezone format

## Future Enhancements

1. **Event Persistence** - Store events in database for replay
2. **Event Filtering** - Allow clients to filter which events they receive
3. **Presence Information** - Track which users are currently online
4. **Message Typing** - Implement typing indicators
5. **Read Receipts** - Enhanced read receipt support
6. **Event Analytics** - Dashboard showing event metrics
7. **Custom Events** - Allow extensions to create custom event types

## Support Resources

1. **Documentation** - See REALTIME_EVENTS_DOCUMENTATION.md
2. **Example Components** - EventNotifications.tsx shows practical usage
3. **Date Utilities** - date-utils.ts provides timezone formatting examples
4. **API Endpoints** - Access event info at `/events/`

## Integration Checklist

Tasks to integrate this feature with existing components:

- [ ] Update conversation list to show real-time updates
- [ ] Add typing indicators to chat window
- [ ] Add presence information to contact list
- [ ] Update email list to show new emails in real-time
- [ ] Add read receipts to messages
- [ ] Update conversation list unread count in real-time
- [ ] Add sound notifications for events (optional)
- [ ] Add toast notifications for important events

## API Endpoints

### REST Endpoints

**Get Events Info**
```
GET /events/
Authorization: Bearer {token}

Response:
{
  "status": "success",
  "data": {
    "websocket_url": "/events/ws/connect",
    "event_types": [...],
    "message": "Connect to /events/ws/connect with your auth token..."
  }
}
```

### WebSocket Endpoint

**Connect to Events**
```
WS /events/ws/connect?token={user_id}

Connection Message:
{
  "type": "connection_established",
  "user_id": 1,
  "timezone": "UTC",
  "message": "Connected to real-time events"
}

Keep-Alive (Client):
{"type": "ping"}

Keep-Alive (Server):
{"type": "pong"}

Event Message:
{
  "type": "message_sent",
  "timestamp": "2024-01-15T10:30:45.123456",
  "timezone": "UTC",
  "data": {...}
}
```

## Version History

### v1.0.0
- Initial real-time events implementation
- WebSocket support
- Timezone-aware timestamps
- Event notifications
- Date formatting utilities
- Documentation

## Next Steps

1. Test the implementation in development
2. Gather feedback on real-time functionality
3. Monitor performance and connection stability
4. Plan future enhancements
5. Document additional event types as needed
6. Consider caching strategies for high-traffic scenarios

---

For detailed API documentation, see REALTIME_EVENTS_DOCUMENTATION.md
