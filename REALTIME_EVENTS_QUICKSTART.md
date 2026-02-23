# Real-Time Events Quick Start

## Overview
This guide will help you quickly get started with the Real-Time Events system in Social Media Messenger.

## What's New?

The platform now supports real-time WebSocket updates for:
- ✓ Message sending/receiving
- ✓ Email notifications  
- ✓ Conversation updates
- ✓ User presence
- ✓ Typing indicators

All events include proper timezone support for accurate timestamp formatting.

## Quick Start (5 minutes)

### 1. Backend Setup (Already Done)

The backend is automatically configured:
- WebSocket endpoint: `ws://localhost:8000/events/ws/connect`
- REST info endpoint: `GET /events/`
- Events service automatically created and running

### 2. Frontend Setup (Already Done)

EventsProvider and EventNotifications are already integrated:
- EventsProvider wraps the entire app
- EventNotifications component shows real-time notifications
- Timezone is fetched from branding settings

### 3. Using in Your Components

#### Display Last Event (Simple)

```tsx
import { useEvents } from '@/lib/events-context'

export function EventDisplay() {
  const { connected, lastEvent, timezone } = useEvents()

  return (
    <div>
      <p>Status: {connected ? '🟢 Online' : '🔴 Offline'}</p>
      <p>Timezone: {timezone}</p>
      {lastEvent && (
        <pre>{JSON.stringify(lastEvent, null, 2)}</pre>
      )}
    </div>
  )
}
```

#### Subscribe to Specific Events

```tsx
import { useEvents } from '@/lib/events-context'
import { useEffect, useState } from 'react'

export function MessageCounter() {
  const { subscribe } = useEvents()
  const [count, setCount] = useState(0)

  useEffect(() => {
    // Subscribe to message_sent events
    const unsubscribe = subscribe('message_sent', (event) => {
      setCount((prev) => prev + 1)
      console.log('Message sent!', event.data)
    })

    // Cleanup on unmount
    return unsubscribe
  }, [subscribe])

  return <div>Messages sent today: {count}</div>
}
```

#### Format Dates with Timezone

```tsx
import { useEvents } from '@/lib/events-context'
import { formatDateWithTimezone } from '@/lib/date-utils'

export function MessageWithTime({ timestamp }) {
  const { timezone } = useEvents()

  return (
    <div>
      <p>Message time: {formatDateWithTimezone(timestamp, timezone)}</p>
    </div>
  )
}
```

## Available Event Types

```
message_sent         - Message successfully sent
message_received     - New message received
message_updated      - Message changed (e.g., marked as read)
message_deleted      - Message deleted
conversation_created - New conversation started
conversation_updated - Conversation details changed
user_online          - User comes online
user_offline         - User goes offline
typing_indicator     - User is typing
contact_updated      - Contact info changed
account_connected    - Platform account connected
account_disconnected - Platform account disconnected
email_received       - New email arrived
email_sent           - Email sent successfully
system_notification  - System-level notification
```

## Event Structure

Each event has this structure:

```typescript
{
  type: "message_sent",
  timestamp: "2024-01-15T10:30:45.123456Z",
  timezone: "America/New_York",
  data: {
    message_id: 1,
    conversation_id: 1,
    sender_name: "John",
    receiver_name: "Jane",
    message_text: "Hello!",
    platform: "whatsapp"
  }
}
```

## Date Formatting Examples

```tsx
import {
  formatDateWithTimezone,      // Full date + time
  formatTimeWithTimezone,       // Time only
  formatDateOnlyWithTimezone,   // Date only
  getRelativeTime,              // "5m ago"
  isSameDay                     // Check if same day
} from '@/lib/date-utils'

// Format for display
const displayTime = formatDateWithTimezone(
  "2024-01-15T10:30:45Z",
  "America/New_York"
)
// "Jan 15, 2024, 10:30:45 AM"

const timeOnly = formatTimeWithTimezone(timestamp, timezone)
// "10:30:45 AM"

const relative = getRelativeTime(timestamp)
// "5m ago"
```

## Testing

### Test 1: Check Connection

```tsx
// Add this component temporarily to test
function EventsStatus() {
  const { connected, error, timezone } = useEvents()
  
  return (
    <div className="p-4 bg-gray-100">
      <h3>Events Status</h3>
      <p>Connected: {connected ? '✓' : '✗'}</p>
      <p>Error: {error || 'None'}</p>
      <p>Timezone: {timezone}</p>
    </div>
  )
}
```

### Test 2: Monitor Events

```tsx
// Monitor all events
function EventMonitor() {
  const { subscribe } = useEvents()
  const [events, setEvents] = useState([])

  useEffect(() => {
    // Subscribe to all common events
    const types = [
      'message_sent',
      'message_received',
      'email_received',
      'email_sent'
    ]

    const unsubscribers = types.map((type) =>
      subscribe(type, (event) => {
        setEvents((prev) => [{...event, id: Date.now()}, ...prev].slice(0, 10))
      })
    )

    return () => unsubscribers.forEach((u) => u())
  }, [subscribe])

  return (
    <div className="p-4">
      <h3>Last 10 Events</h3>
      {events.map((e) => (
        <div key={e.id} className="text-sm border-b p-2">
          <strong>{e.type}</strong> @ {e.timestamp}
        </div>
      ))}
    </div>
  )
}
```

## Common Tasks

### 1. Update a List When New Messages Arrive

```tsx
export function ConversationList() {
  const { subscribe } = useEvents()
  const [conversations, setConversations] = useState([])

  useEffect(() => {
    // Load initial conversations
    fetchConversations()

    // Subscribe to new messages
    const unsubscribe = subscribe('message_received', (event) => {
      // Update conversation order/count
      updateConversationWithNewMessage(event.data.conversation_id)
    })

    return unsubscribe
  }, [subscribe])

  return <div>{/* Render conversations */}</div>
}
```

### 2. Show Typing Indicator

```tsx
export function ChatWindow({ conversationId }) {
  const { subscribe } = useEvents()
  const [isTyping, setIsTyping] = useState(false)

  useEffect(() => {
    const unsubscribe = subscribe('typing_indicator', (event) => {
      if (event.data.conversation_id === conversationId) {
        setIsTyping(event.data.is_typing)
      }
    })

    return unsubscribe
  }, [conversationId, subscribe])

  return (
    <div>
      {isTyping && <p>Someone is typing...</p>}
    </div>
  )
}
```

### 3. Update Badge for New Emails

```tsx
export function EmailBadge() {
  const { subscribe } = useEvents()
  const [newEmailCount, setNewEmailCount] = useState(0)

  useEffect(() => {
    const unsubscribe = subscribe('email_received', (event) => {
      setNewEmailCount((prev) => prev + 1)
    })

    return unsubscribe
  }, [subscribe])

  return (
    <span className="badge">{newEmailCount}</span>
  )
}
```

## Timezone Configuration

The timezone is configured in Admin Settings > Branding:

1. Go to Admin Panel
2. Click Settings > Branding
3. Select Timezone from dropdown
4. Save changes

Supported timezones include:
- UTC (default)
- America/New_York
- Europe/London
- Asia/Kolkata
- And 20+ more...

## Debugging

### Check Connection Status

Open browser console and run:
```javascript
// Check if WebSocket is connected
localStorage.getItem('user')
```

### View Events in Console

```tsx
// Temporary debug component
useEffect(() => {
  const unsubscribe = subscribe('*', (event) => {
    console.log('[Event]', event.type, event.data)
  })
  return unsubscribe
}, [subscribe])
```

### Common Issues

| Issue | Solution |
|-------|----------|
| Events not showing | Check if WebSocket is connected |
| Wrong timezone | Verify timezone in Admin > Branding |
| No notifications | Ensure EventNotifications component is rendered |
| Timestamps wrong | Check timezone format and browser support |

## Performance Tips

1. **Unsubscribe from events** when component unmounts
2. **Use specific event types** instead of subscribing to all
3. **Debounce** frequent events like typing indicators
4. **Cache** timezone from context to avoid re-renders

## Next Steps

1. Add more event subscriptions to your components
2. Implement real-time list updates
3. Add presence information
4. Test across different timezones
5. Monitor performance in production

## Need Help?

- Check REALTIME_EVENTS_DOCUMENTATION.md for detailed API
- See IMPLEMENTATION_GUIDE.md for architecture details
- Review EventNotifications.tsx for example implementation
- Check browser console for error messages

---

Happy developing! 🚀
