# Real-Time Events System Documentation

## Overview

The Social Media Messenger now includes a comprehensive real-time events system powered by WebSockets. This allows for real-time notifications and updates across all messaging platforms and email.

## Features

### 1. WebSocket Connection
- Automatic WebSocket connection management
- Auto-reconnection with exponential backoff
- Token-based authentication
- Timezone-aware event timestamps

### 2. Event Types

The system supports the following event types:

- **MESSAGE_SENT**: Emitted when a message is successfully sent
- **MESSAGE_RECEIVED**: Emitted when a new message is received
- **MESSAGE_UPDATED**: Emitted when a message is updated (e.g., marked as read)
- **MESSAGE_DELETED**: Emitted when a message is deleted
- **CONVERSATION_CREATED**: Emitted when a new conversation is created
- **CONVERSATION_UPDATED**: Emitted when a conversation is updated
- **USER_ONLINE**: Emitted when a user comes online
- **USER_OFFLINE**: Emitted when a user goes offline
- **TYPING_INDICATOR**: Emitted when a user is typing
- **CONTACT_UPDATED**: Emitted when a contact is updated
- **ACCOUNT_CONNECTED**: Emitted when a platform account is connected
- **ACCOUNT_DISCONNECTED**: Emitted when a platform account is disconnected
- **EMAIL_RECEIVED**: Emitted when a new email is received
- **EMAIL_SENT**: Emitted when an email is sent
- **SYSTEM_NOTIFICATION**: System-level notifications

### 3. Timezone Support

All events include timezone information from the branding settings. This ensures consistent timestamp formatting across the platform.

#### Available Timezones

- UTC (default)
- America/New_York
- America/Chicago
- America/Denver
- America/Los_Angeles
- America/Toronto
- America/Mexico_City
- America/Buenos_Aires
- Europe/London
- Europe/Paris
- Europe/Berlin
- Europe/Madrid
- Europe/Amsterdam
- Europe/Moscow
- Asia/Kolkata
- Asia/Bangkok
- Asia/Hong_Kong
- Asia/Singapore
- Asia/Tokyo
- Asia/Seoul
- Australia/Sydney
- Australia/Melbourne
- Pacific/Auckland

## Backend Implementation

### Events Service

The `EventsService` class manages WebSocket connections and event broadcasting:

```python
from app.services.events_service import events_service, EventTypes

# Create an event
event = events_service.create_event(
    EventTypes.MESSAGE_SENT,
    data={
        "message_id": 1,
        "conversation_id": 1,
        "message_text": "Hello!",
        ...
    },
    db=db,
    timezone="America/New_York"
)

# Broadcast to specific user
await events_service.broadcast_to_user(user_id, event)

# Broadcast to all users
await events_service.broadcast_to_all(event)
```

### WebSocket Endpoint

The WebSocket endpoint is available at:

```
ws://localhost:8000/events/ws/connect?token={user_id}
```

Authentication is token-based, with the token being the user's ID or a JSON token with `user_id` field.

### Event Structure

Each event follows this structure:

```json
{
  "type": "message_sent",
  "timestamp": "2024-01-15T10:30:45.123456",
  "timezone": "America/New_York",
  "data": {
    "message_id": 1,
    "conversation_id": 1,
    "sender_id": "user123",
    "sender_name": "John Doe",
    "receiver_id": "contact123",
    "receiver_name": "Jane Smith",
    "message_text": "Hello!",
    "platform": "whatsapp",
    "timestamp": "2024-01-15T10:30:45.123456"
  }
}
```

## Frontend Implementation

### Events Context

The `EventsProvider` component manages WebSocket connections and provides event subscription functionality:

```tsx
import { EventsProvider, useEvents } from '@/lib/events-context'

// Wrap your app with EventsProvider
<EventsProvider>
  <App />
</EventsProvider>

// Use in components
function MyComponent() {
  const { connected, error, timezone, subscribe } = useEvents()

  useEffect(() => {
    const unsubscribe = subscribe('message_sent', (event) => {
      console.log('Message sent:', event)
    })

    return unsubscribe
  }, [subscribe])

  return <div>{connected ? 'Connected' : 'Disconnected'}</div>
}
```

### Date Formatting Utilities

Format timestamps with timezone awareness:

```typescript
import {
  formatDateWithTimezone,
  formatTimeWithTimezone,
  formatDateOnlyWithTimezone,
  getRelativeTime,
} from '@/lib/date-utils'

// Format full date and time
const formatted = formatDateWithTimezone(
  '2024-01-15T10:30:45.123456',
  'America/New_York'
)
// Output: "Jan 15, 2024, 10:30:45 AM"

// Format time only
const time = formatTimeWithTimezone(
  '2024-01-15T10:30:45.123456',
  'America/New_York'
)
// Output: "10:30:45 AM"

// Format date only
const date = formatDateOnlyWithTimezone(
  '2024-01-15T10:30:45.123456',
  'America/New_York'
)
// Output: "Jan 15, 2024"

// Get relative time
const relative = getRelativeTime('2024-01-15T10:30:45.123456')
// Output: "5m ago"
```

### Event Notifications Component

The `EventNotifications` component displays real-time notifications:

```tsx
import { EventNotifications } from '@/components/EventNotifications'

// Add to your layout
<EventNotifications />
```

This component:
- Automatically subscribes to all event types
- Shows notifications in the bottom-right corner
- Displays formatted timestamps in the configured timezone
- Auto-dismisses after 5 seconds
- Provides manual dismiss option

## Configuration

### Setting Timezone

Timezone can be configured in the Admin Panel under Settings > Branding Settings.

The timezone affects:
- Event timestamp formatting
- Date displays throughout the platform
- Scheduled notifications (future feature)

### Fetching Branding Settings (Including Timezone)

```typescript
// Public endpoint (no authentication)
GET /branding/

// Admin endpoint
GET /branding/admin

// Both return timezone in the response
{
  "status": "success",
  "data": {
    "company_name": "...",
    "timezone": "America/New_York",
    ...
  }
}
```

## Usage Examples

### Example 1: Display Message Count Updates

```tsx
function MessageCounter() {
  const { subscribe } = useEvents()
  const [count, setCount] = useState(0)

  useEffect(() => {
    const unsubscribe = subscribe('message_sent', (event) => {
      setCount((prev) => prev + 1)
    })

    return unsubscribe
  }, [subscribe])

  return <div>Messages sent: {count}</div>
}
```

### Example 2: Update UI on Email Received

```tsx
function EmailNotifier() {
  const { subscribe } = useEvents()
  const [lastEmail, setLastEmail] = useState(null)

  useEffect(() => {
    const unsubscribe = subscribe('email_received', (event) => {
      setLastEmail({
        from: event.data.sender,
        subject: event.data.subject,
        time: event.timestamp,
      })
    })

    return unsubscribe
  }, [subscribe])

  return (
    <div>
      {lastEmail && (
        <p>
          New email from {lastEmail.from}: {lastEmail.subject}
        </p>
      )}
    </div>
  )
}
```

### Example 3: Typing Indicator

```tsx
function TypingIndicator() {
  const { subscribe } = useEvents()
  const [typingUsers, setTypingUsers] = useState(new Set())

  useEffect(() => {
    const unsubscribe = subscribe('typing_indicator', (event) => {
      if (event.data.is_typing) {
        setTypingUsers((prev) => new Set([...prev, event.data.user_id]))
      } else {
        setTypingUsers((prev) => {
          const updated = new Set(prev)
          updated.delete(event.data.user_id)
          return updated
        })
      }
    })

    return unsubscribe
  }, [subscribe])

  return (
    <div>
      {typingUsers.size > 0 && <p>Users typing: {[...typingUsers].join(', ')}</p>}
    </div>
  )
}
```

## Error Handling

The system includes automatic error handling:

- **Connection Failures**: Automatic reconnection with 3-second retry
- **Invalid Tokens**: WebSocket closes with code 1008
- **Server Errors**: WebSocket closes with code 1011
- **Malformed Messages**: Error message sent but connection remains open

Access errors through the `useEvents` hook:

```tsx
const { connected, error } = useEvents()

if (error) {
  console.error('Events error:', error)
}
```

## Performance Considerations

1. **Connection Management**: WebSocket connections are automatically cleaned up when users disconnect
2. **Memory Usage**: Event subscribers are managed efficiently and garbage collected when unsubscribed
3. **Bandwidth**: Events are only sent to relevant users
4. **Scalability**: The system can handle thousands of concurrent users

## Security

- **Token Validation**: All WebSocket connections require valid authentication tokens
- **User Isolation**: Events are only broadcast to authenticated users
- **Transport Security**: Use WSS (WebSocket Secure) in production
- **Token Rotation**: Implement token refresh for long-running connections

## Troubleshooting

### WebSocket Not Connecting

1. Check if authentication token is valid
2. Verify WebSocket URL is correct
3. Check browser console for errors
4. Ensure CORS is properly configured

### Events Not Received

1. Check if subscription callback is registered
2. Verify event type matches (case-sensitive)
3. Check if user is authenticated
4. Look for connection errors in console

### Timezone Issues

1. Verify timezone is set in branding settings
2. Check if timezone string is valid IANA timezone
3. Ensure browser supports the timezone format
4. Test with UTC as fallback

## Migration Guide

### Updating Existing Code

If you have existing code that doesn't use the new events system:

1. **Add EventsProvider to layout**
   ```tsx
   import { EventsProvider } from '@/lib/events-context'
   
   <EventsProvider>
     <App />
   </EventsProvider>
   ```

2. **Replace polling with event subscriptions**
   ```tsx
   // Old way (polling)
   useEffect(() => {
     const interval = setInterval(fetchMessages, 5000)
     return () => clearInterval(interval)
   }, [])
   
   // New way (events)
   useEffect(() => {
     const unsubscribe = subscribe('message_received', (event) => {
       addMessage(event.data)
     })
     return unsubscribe
   }, [subscribe])
   ```

3. **Use timezone-aware date formatting**
   ```tsx
   import { formatDateWithTimezone } from '@/lib/date-utils'
   import { useEvents } from '@/lib/events-context'
   
   function MessageTimestamp({ timestamp }) {
     const { timezone } = useEvents()
     return <span>{formatDateWithTimezone(timestamp, timezone)}</span>
   }
   ```

## Future Enhancements

Planned features for the events system:

- Message search and filtering
- Event persistence and replay
- Advanced typing indicators
- Presence information
- ReadReceipts for more platforms
- Server-side event history
- Event analytics dashboard
- Custom event types for extensions

## API Reference

### EventsContext

```typescript
interface EventsContextType {
  connected: boolean                          // WebSocket connection status
  error: string | null                        // Connection error message
  lastEvent: EventMessage | null              // Last received event
  timezone: string | null                     // Configured timezone
  subscribe: (
    eventType: string,
    callback: (event: EventMessage) => void
  ) => () => void                             // Subscribe to events, returns unsubscribe function
}
```

### EventMessage

```typescript
interface EventMessage {
  type: string      // Event type (e.g., 'message_sent')
  timestamp: string // ISO timestamp
  timezone: string  // IANA timezone
  data: any        // Event-specific data
}
```

### Date Utilities

```typescript
// Format with timezone
formatDateWithTimezone(dateString, timezone?, options?): string

// Format time only
formatTimeWithTimezone(dateString, timezone?): string

// Format date only
formatDateOnlyWithTimezone(dateString, timezone?): string

// Get relative time
getRelativeTime(dateString): string

// Check if same day
isSameDay(date1, date2, timezone?): boolean

// Get available timezones
getAvailableTimezones(): string[]

// Convert to timezone
convertToTimezone(dateString, timezone?): string
```

## Support

For issues or questions about the real-time events system:
1. Check this documentation
2. Review the troubleshooting section
3. Check browser console for errors
4. Review server logs for backend errors
5. Contact support with logs and event type information
