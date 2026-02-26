'use client'

import { useEffect, useState } from 'react'
import { useEvents, EventMessage } from '@/lib/events-context'
import { useBranding } from '@/lib/branding-context'
import { formatTimeWithTimezone } from '@/lib/date-utils'

interface Notification {
  id: string
  event: EventMessage
  visible: boolean
}

export function EventNotifications() {
  const { subscribe, timezone } = useEvents()
  const { branding } = useBranding()
  const [notifications, setNotifications] = useState<Notification[]>([])

  useEffect(() => {
    // Subscribe to message_sent events
    const unsubscribeSent = subscribe('message_sent', (event) => {
      addNotification(event)
    })

    // Subscribe to message_received events
    const unsubscribeReceived = subscribe('message_received', (event) => {
      addNotification(event)
    })

    // Subscribe to email events
    const unsubscribeEmailSent = subscribe('email_sent', (event) => {
      addNotification(event)
    })

    const unsubscribeEmailReceived = subscribe('email_received', (event) => {
      addNotification(event)
    })

    // Subscribe to conversation assignment (agent gets notified when forwarded a chat)
    const unsubscribeAssigned = subscribe('conversation_assigned', (event) => {
      addNotification(event)
    })

    return () => {
      unsubscribeSent()
      unsubscribeReceived()
      unsubscribeEmailSent()
      unsubscribeEmailReceived()
      unsubscribeAssigned()
    }
  }, [subscribe])

  const addNotification = (event: EventMessage) => {
    const id = `${Date.now()}-${Math.random()}`
    const notification: Notification = {
      id,
      event,
      visible: true,
    }

    setNotifications((prev) => [notification, ...prev])

    // Auto-remove after 5 seconds
    setTimeout(() => {
      setNotifications((prev) =>
        prev.filter((n) => n.id !== id)
      )
    }, 5000)
  }

  const removeNotification = (id: string) => {
    setNotifications((prev) =>
      prev.filter((n) => n.id !== id)
    )
  }

  const getNotificationContent = (event: EventMessage) => {
    const d = event.data || event as any
    switch (event.type) {
      case 'message_sent':
        return {
          title: 'Message Sent',
          description: `Message sent to ${d.receiver_name || ''}`,
          icon: '✓',
          bgColor: 'bg-green-50',
          borderColor: 'border-green-200',
          textColor: 'text-green-800',
          titleColor: 'text-green-900',
        }
      case 'message_received':
        return {
          title: d.platform === 'webchat' ? '💬 New Web Chat Message' : 'New Message',
          description: `${d.visitor_name || d.sender_name || 'Unknown'}: ${(d.message_text || d.text || '').substring(0, 60)}`,
          icon: '💬',
          bgColor: 'bg-blue-50',
          borderColor: 'border-blue-200',
          textColor: 'text-blue-800',
          titleColor: 'text-blue-900',
        }
      case 'email_sent':
        return {
          title: 'Email Sent',
          description: `Email sent to ${d.recipient || ''}`,
          icon: '📧',
          bgColor: 'bg-purple-50',
          borderColor: 'border-purple-200',
          textColor: 'text-purple-800',
          titleColor: 'text-purple-900',
        }
      case 'email_received':
        return {
          title: 'New Email',
          description: d.sender ? `From: ${d.sender}` : (d.message || `${d.synced_count ?? 1} new email${(d.synced_count ?? 1) !== 1 ? 's' : ''} received`),
          icon: '📬',
          bgColor: 'bg-indigo-50',
          borderColor: 'border-indigo-200',
          textColor: 'text-indigo-800',
          titleColor: 'text-indigo-900',
        }
      case 'conversation_assigned':
        return {
          title: '🔄 Conversation Assigned to You',
          description: d.note
            ? `From ${d.assigned_by_name}: "${d.note}"`
            : `${d.assigned_by_name} forwarded ${d.contact_name || 'a chat'} to you`,
          icon: '🔄',
          bgColor: 'bg-orange-50',
          borderColor: 'border-orange-400',
          textColor: 'text-orange-800',
          titleColor: 'text-orange-900',
        }
      default:
        return {
          title: event.type,
          description: JSON.stringify(d),
          icon: 'ℹ',
          bgColor: 'bg-gray-50',
          borderColor: 'border-gray-200',
          textColor: 'text-gray-800',
          titleColor: 'text-gray-900',
        }
    }
  }

  return (
    <div className="fixed bottom-4 right-4 z-50 space-y-2 max-w-sm">
      {notifications.map((notification) => {
        const content = getNotificationContent(notification.event)
        const time =
          timezone && notification.event.timestamp
            ? formatTimeWithTimezone(
                notification.event.timestamp,
                timezone
              )
            : ''

        return (
          <div
            key={notification.id}
            className={`${content.bgColor} border ${content.borderColor} rounded-lg shadow-lg overflow-hidden transition-all duration-300 ${
              notification.visible ? 'opacity-100 translate-x-0' : 'opacity-0 translate-x-96'
            }`}
          >
            <div className="p-4">
              <div className="flex items-start justify-between">
                <div className="flex items-start gap-3">
                  <div className="text-xl">{content.icon}</div>
                  <div>
                    <h3 className={`font-semibold ${content.titleColor}`}>
                      {content.title}
                    </h3>
                    <p className={`text-sm ${content.textColor}`}>
                      {content.description}
                    </p>
                    <p className={`text-xs ${content.textColor} opacity-75 mt-1`}>
                      {time}
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => removeNotification(notification.id)}
                  className={`ml-4 text-lg leading-none ${content.textColor} hover:opacity-70`}
                >
                  ✕
                </button>
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}
