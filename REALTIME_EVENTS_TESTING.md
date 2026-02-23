# Real-Time Events Testing Guide

## Overview

This guide provides step-by-step instructions for testing the real-time events system.

## Prerequisites

- Backend running: `python -m uvicorn main:app --reload`
- Frontend running: `npm run dev`
- Browser with console access (F12 or right-click > Inspect)

## Test 1: WebSocket Connection

### Manual Test with Browser

1. Open browser console (F12)
2. Run this code:

```javascript
// Create a WebSocket connection
const ws = new WebSocket('ws://localhost:8000/events/ws/connect?token=1')

ws.onopen = () => {
  console.log('✓ Connected to WebSocket')
}

ws.onmessage = (event) => {
  console.log('Received:', JSON.parse(event.data))
}

ws.onerror = (error) => {
  console.error('✗ WebSocket error:', error)
}

ws.onclose = () => {
  console.log('WebSocket closed')
}

// Send ping to keep alive
setInterval(() => {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({type: 'ping'}))
  }
}, 30000)
```

### Expected Output

```
✓ Connected to WebSocket
Received: {
  "type": "connection_established",
  "user_id": 1,
  "timezone": "UTC",
  "message": "Connected to real-time events"
}
```

## Test 2: Event Notifications Component

### Check Component is Rendered

1. Open browser DevTools (F12)
2. Go to Elements tab
3. Search for `EventNotifications`
4. Verify it's in the DOM under layout-client

### Trigger a Notification

In browser console:

```javascript
// Simulate a message_sent event
const mockEvent = {
  type: 'message_sent',
  timestamp: new Date().toISOString(),
  timezone: 'UTC',
  data: {
    message_id: 1,
    conversation_id: 1,
    sender_name: 'You',
    receiver_name: 'John Doe',
    message_text: 'Test message',
    platform: 'whatsapp'
  }
}

// Look for the notification in bottom-right corner
console.log('Mock event:', mockEvent)
```

## Test 3: useEvents Hook

### Create Test Component

Create `components/EventsTest.tsx`:

```tsx
'use client'

import { useEvents } from '@/lib/events-context'
import { useEffect, useState } from 'react'

export function EventsTest() {
  const { connected, error, timezone, lastEvent, subscribe } = useEvents()
  const [eventCount, setEventCount] = useState(0)

  useEffect(() => {
    // Subscribe to all common event types
    const unsubscribers = [
      subscribe('message_sent', (e) => {
        console.log('📤 Message sent:', e.data)
        setEventCount((p) => p + 1)
      }),
      subscribe('message_received', (e) => {
        console.log('📥 Message received:', e.data)
        setEventCount((p) => p + 1)
      }),
      subscribe('email_sent', (e) => {
        console.log('📧 Email sent:', e.data)
        setEventCount((p) => p + 1)
      }),
      subscribe('email_received', (e) => {
        console.log('📬 Email received:', e.data)
        setEventCount((p) => p + 1)
      }),
    ]

    return () => unsubscribers.forEach((u) => u())
  }, [subscribe])

  return (
    <div className="fixed top-4 left-4 bg-white p-4 rounded shadow-lg z-40">
      <h3 className="font-bold mb-2">Events Test Panel</h3>
      <div className="text-sm space-y-1">
        <p>Status: {connected ? '🟢' : '🔴'}</p>
        <p>Timezone: {timezone}</p>
        <p>Events: {eventCount}</p>
        <p>Error: {error || 'None'}</p>
        {lastEvent && (
          <pre className="bg-gray-100 p-2 text-xs mt-2">
            {JSON.stringify(lastEvent, null, 2).slice(0, 200)}...
          </pre>
        )}
      </div>
    </div>
  )
}
```

Add to dashboard: `app/dashboard/page.tsx`:

```tsx
import { EventsTest } from '@/components/EventsTest'

export default function Dashboard() {
  return (
    <>
      <EventsTest />
      {/* Other dashboard content */}
    </>
  )
}
```

## Test 4: Date/Time Utilities

### Test Timezone Formatting

In browser console:

```javascript
// Import and test date utilities
import { formatDateWithTimezone, formatTimeWithTimezone } from '@/lib/date-utils'

const testDate = '2024-01-15T15:30:45.123456Z'

console.log('UTC:', formatDateWithTimezone(testDate, 'UTC'))
// Jan 15, 2024, 3:30:45 PM

console.log('New York:', formatDateWithTimezone(testDate, 'America/New_York'))
// Jan 15, 2024, 10:30:45 AM

console.log('London:', formatDateWithTimezone(testDate, 'Europe/London'))
// Jan 15, 2024, 3:30:45 PM

console.log('Kolkata:', formatDateWithTimezone(testDate, 'Asia/Kolkata'))
// Jan 15, 2024, 9:00:45 PM
```

## Test 5: Message Sending Events

### Test via API

1. Send a message through the UI
2. Check browser console for events
3. Verify notification appears

### Or use curl:

```bash
curl -X POST http://localhost:8000/messages/send \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer 1" \
  -d '{
    "conversation_id": 1,
    "message_text": "Test message"
  }'
```

### Expected Console Output

```
Received: {
  "type": "message_sent",
  "timestamp": "2024-01-15T...",
  "timezone": "UTC",
  "data": {
    "message_id": ...,
    "conversation_id": 1,
    "message_text": "Test message",
    ...
  }
}
```

## Test 6: Multiple Subscriptions

### Test Component

```tsx
export function MultiSubscriptionTest() {
  const { subscribe } = useEvents()
  const [stats, setStats] = useState({
    sent: 0,
    received: 0,
    email: 0
  })

  useEffect(() => {
    const unsub1 = subscribe('message_sent', () => {
      setStats(s => ({...s, sent: s.sent + 1}))
    })

    const unsub2 = subscribe('message_received', () => {
      setStats(s => ({...s, received: s.received + 1}))
    })

    const unsub3 = subscribe('email_received', () => {
      setStats(s => ({...s, email: s.email + 1}))
    })

    return () => {
      unsub1(); unsub2(); unsub3()
    }
  }, [subscribe])

  return (
    <div className="p-4 border rounded">
      <h3>Event Statistics</h3>
      <p>Messages Sent: {stats.sent}</p>
      <p>Messages Received: {stats.received}</p>
      <p>Emails Received: {stats.email}</p>
    </div>
  )
}
```

## Test 7: Connection Stability

### Test Auto-Reconnection

1. Open Events Test Panel
2. In Network tab, throttle connection (Slow 3G)
3. Stop backend server
4. Watch connection indicator in test panel
5. Restart backend
6. Verify auto-reconnection (should happen in ~3 seconds)

### Network Throttling Instructions

1. Press F12 to open DevTools
2. Go to Network tab
3. Click the dropdown (usually says "No throttling")
4. Select "Slow 3G"
5. Stop server: `Ctrl+C` in backend terminal
6. Watch for reconnection attempts

## Test 8: Timezone Configuration

### Change Timezone

1. Log in as admin
2. Go to Settings > Branding
3. Change Timezone to "America/New_York"
4. Save
5. Refresh browser

### Verify Timezone

In console:

```javascript
fetch('http://localhost:8000/branding/')
  .then(r => r.json())
  .then(d => console.log('Timezone:', d.data.timezone))
```

### Expected Output

```
Timezone: America/New_York
```

## Test 9: Error Handling

### Test Invalid Token

```javascript
const ws = new WebSocket('ws://localhost:8000/events/ws/connect?token=invalid')

ws.onerror = () => {
  console.log('✓ Correctly rejected invalid token')
}
```

### Test Connection Loss

```javascript
let messageCount = 0

ws.onmessage = () => {
  messageCount++
  if (messageCount === 1) {
    // Simulate network loss
    ws.close()
  }
}
```

## Test 10: Performance

### Monitor Connection Memory

In DevTools Performance tab:

1. Open DevTools (F12)
2. Go to Performance tab
3. Start recording
4. Send 10 messages quickly
5. Stop recording
6. Check memory usage

### Expected

- Memory increase < 5MB
- No memory leaks
- Events processed < 100ms

## Integration Tests

### Test 1: Full Message Flow

```
1. User 1 logs in
   ✓ WebSocket connects
   ✓ Receives connection_established event
   ✓ Timezone displayed correctly

2. User 1 sends message
   ✓ message_sent event received
   ✓ Notification appears
   ✓ Timestamp formatted with timezone

3. User 2 receives message
   ✓ message_received event received
   ✓ Notification appears
   ✓ Message displayed in conversation

4. User 2 marks as read
   ✓ message_updated event received
   ✓ Read status changes
```

### Test 2: Email Flow

```
1. Email arrives
   ✓ email_received event sent
   ✓ Notification appears
   ✓ Email count updated

2. User sends email
   ✓ email_sent event sent
   ✓ Notification appears
   ✓ Email in sent folder
```

## Quick Test Checklist

```
Basic Connectivity
☐ WebSocket connects on page load
☐ Connection status shows "Connected"
☐ Timezone displays correctly
☐ No errors in console

Event Reception
☐ Message sent event received
☐ Message received event received
☐ Email events received
☐ Correct event timestamps

UI Updates
☐ Notifications appear on events
☐ Notifications auto-dismiss after 5s
☐ Manual dismiss works
☐ Dates show in correct timezone

Error Handling
☐ Handles invalid tokens
☐ Reconnects on disconnect
☐ Shows error messages
☐ Graceful degradation

Performance
☐ No memory leaks
☐ Events process < 100ms
☐ UI remains responsive
☐ Multiple connections stable
```

## Debugging Tips

### Enable Verbose Logging

```javascript
// In browser console
window.__EVENTS_DEBUG__ = true

// Then in code:
if (window.__EVENTS_DEBUG__) {
  console.log('[Events]', message)
}
```

### Monitor Event Flow

```javascript
// Intercept all events
const originalSend = WebSocket.prototype.send
WebSocket.prototype.send = function(data) {
  console.log('→ Sending:', data)
  return originalSend.call(this, data)
}

const originalOnMessage = WebSocket.prototype.onmessage
Object.defineProperty(WebSocket.prototype, 'onmessage', {
  set: function(handler) {
    console.log('← Receiving:', handler)
  }
})
```

### Check Service Worker

```javascript
// If using service workers
navigator.serviceWorker.getRegistrations()
  .then(registrations => {
    console.log('Service workers:', registrations)
  })
```

## Troubleshooting

### WebSocket won't connect

Check:
```javascript
// Is token valid?
localStorage.getItem('user')

// Is backend running?
fetch('http://localhost:8000/health')

// Can you reach WebSocket endpoint?
fetch('http://localhost:8000/events/')
```

### Events not received

Check:
```javascript
// Is WebSocket open?
ws.readyState === WebSocket.OPEN

// Are subscriptions registered?
console.log('Subscriptions:', eventSubscribersRef.current)

// Is correct event type?
// (event types are case-sensitive)
```

### Wrong timezone

Check:
```javascript
// Is timezone set in admin?
fetch('http://localhost:8000/branding/').then(r => r.json())

// Is browser locale compatible?
Intl.DateTimeFormat.supportedLocalesOf(['en-US'])
```

## Automated Testing

### Jest Test Example

```typescript
describe('EventsContext', () => {
  it('should connect to WebSocket', () => {
    const { result } = renderHook(() => useEvents())
    expect(result.current.connected).toBe(true)
  })

  it('should subscribe to events', () => {
    const { result } = renderHook(() => useEvents())
    const mockCallback = jest.fn()
    
    result.current.subscribe('message_sent', mockCallback)
    // Trigger event...
    expect(mockCallback).toHaveBeenCalled()
  })

  it('should format dates with timezone', () => {
    const formatted = formatDateWithTimezone(
      '2024-01-15T10:30:45Z',
      'America/New_York'
    )
    expect(formatted).toContain('2024')
  })
})
```

## Success Indicators

✅ WebSocket connects without errors  
✅ Events received in real-time  
✅ Notifications display correctly  
✅ Timezone formatting works  
✅ No memory leaks  
✅ Auto-reconnection works  
✅ Error handling is robust  
✅ Performance is acceptable  

---

**Testing Status**: Ready for comprehensive testing
