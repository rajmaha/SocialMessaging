'use client'

/**
 * Unread counts, shared by the mobile tab badges and the desktop dock badge.
 *
 * One source so the two can never disagree: a fetch for the truth, live
 * WebSocket nudges in between, and a re-sync whenever the app comes back to
 * the foreground (counts drift while it is suspended).
 */

import { useCallback, useEffect, useState } from 'react'
import axios from 'axios'
import { API_URL } from './config'
import { getAuthToken, authAPI } from './auth'
import { useEvents } from './events-context'

export interface UnreadCounts {
  messages: number
  emails: number
  total: number
  clearMessages: () => void
  clearEmails: () => void
  refresh: () => void
}

export function useUnreadCounts(): UnreadCounts {
  const { subscribe } = useEvents()
  const [messages, setMessages] = useState(0)
  const [emails, setEmails] = useState(0)

  const refresh = useCallback(async () => {
    const token = getAuthToken()
    const user = authAPI.getUser()
    if (!token || !user) return

    // Conversations: sum the per-thread unread counts the list already returns,
    // rather than adding an endpoint for a number the payload contains.
    try {
      const res = await axios.get(`${API_URL}/conversations/`, {
        params: { user_id: user.user_id },
        headers: { Authorization: `Bearer ${token}` },
      })
      const rows: Array<{ unread_count?: number }> = res.data || []
      setMessages(rows.reduce((sum, c) => sum + (c.unread_count || 0), 0))
    } catch {
      /* offline, or this agent cannot list conversations — keep the last value */
    }

    try {
      const res = await axios.get(`${API_URL}/email/inbox/unread-count`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      setEmails(res.data?.count || 0)
    } catch {
      /* no mailbox configured for this agent */
    }
  }, [])

  useEffect(() => {
    refresh()

    const unsubs = [
      subscribe('message_received', () => setMessages((n) => n + 1)),
      subscribe('email_received', () => setEmails((n) => n + 1)),
      subscribe('conversation_assigned', () => refresh()),
    ]

    const onResume = () => refresh()
    window.addEventListener('nativeresume', onResume)
    window.addEventListener('focus', onResume)

    return () => {
      unsubs.forEach((u) => u())
      window.removeEventListener('nativeresume', onResume)
      window.removeEventListener('focus', onResume)
    }
  }, [subscribe, refresh])

  return {
    messages,
    emails,
    total: messages + emails,
    clearMessages: () => setMessages(0),
    clearEmails: () => setEmails(0),
    refresh,
  }
}
