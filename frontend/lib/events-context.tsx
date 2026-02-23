'use client'

import React, { createContext, useContext, useEffect, useState, useRef, useCallback } from 'react'
import { useAuth } from './auth'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'
const WS_URL = process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:8000'

export interface EventMessage {
  type: string
  timestamp: string
  timezone: string
  data: any
}

interface EventsContextType {
  connected: boolean
  error: string | null
  lastEvent: EventMessage | null
  subscribe: (eventType: string, callback: (event: EventMessage) => void) => () => void
  timezone: string | null
}

const EventsContext = createContext<EventsContextType | undefined>(undefined)

export function EventsProvider({ children }: { children: React.ReactNode }) {
  const { token } = useAuth()
  const [connected, setConnected] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastEvent, setLastEvent] = useState<EventMessage | null>(null)
  const [timezone, setTimezone] = useState<string | null>(null)
  const websocketRef = useRef<WebSocket | null>(null)
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const eventSubscribersRef = useRef<Map<string, Set<(event: EventMessage) => void>>>(new Map())

  const connect = useCallback(() => {
    if (!token) return
    if (websocketRef.current?.readyState === WebSocket.OPEN) return

    try {
      const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
      const wsUrlParts = WS_URL.replace(/^wss?:\/\//, '').replace(/^https?:\/\//, '')
      const url = `${wsProtocol}//${wsUrlParts}/events/ws/connect?token=${encodeURIComponent(token)}`

      websocketRef.current = new WebSocket(url)

      websocketRef.current.onopen = () => {
        console.log('WebSocket connected')
        setConnected(true)
        setError(null)
        
        // Clear any pending reconnect timeout
        if (reconnectTimeoutRef.current) {
          clearTimeout(reconnectTimeoutRef.current)
        }
      }

      websocketRef.current.onmessage = (event) => {
        try {
          const message: EventMessage = JSON.parse(event.data)
          
          // Store timezone from connection message
          if (message.type === 'connection_established') {
            setTimezone(message.timezone)
          }
          
          setLastEvent(message)

          // Call subscribers for this event type
          const subscribers = eventSubscribersRef.current.get(message.type)
          if (subscribers) {
            subscribers.forEach(callback => {
              try {
                callback(message)
              } catch (err) {
                console.error(`Error in event subscriber for ${message.type}:`, err)
              }
            })
          }
        } catch (err) {
          console.error('Error parsing WebSocket message:', err)
        }
      }

      websocketRef.current.onerror = () => {
        setError('WebSocket connection error')
        setConnected(false)
      }

      websocketRef.current.onclose = () => {
        console.log('WebSocket disconnected')
        setConnected(false)
        
        // Attempt to reconnect after 3 seconds
        reconnectTimeoutRef.current = setTimeout(connect, 3000)
      }
    } catch (err) {
      setError(`Connection error: ${err}`)
      setConnected(false)
    }
  }, [token])

  const disconnect = useCallback(() => {
    if (websocketRef.current) {
      websocketRef.current.close()
      websocketRef.current = null
    }
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current)
    }
    setConnected(false)
  }, [])

  const subscribe = useCallback(
    (eventType: string, callback: (event: EventMessage) => void) => {
      if (!eventSubscribersRef.current.has(eventType)) {
        eventSubscribersRef.current.set(eventType, new Set())
      }
      eventSubscribersRef.current.get(eventType)!.add(callback)

      // Return unsubscribe function
      return () => {
        const subscribers = eventSubscribersRef.current.get(eventType)
        if (subscribers) {
          subscribers.delete(callback)
        }
      }
    },
    []
  )

  useEffect(() => {
    if (token) {
      connect()
    } else {
      disconnect()
    }

    return () => {
      disconnect()
    }
  }, [token, connect, disconnect])

  return (
    <EventsContext.Provider value={{ connected, error, lastEvent, subscribe, timezone }}>
      {children}
    </EventsContext.Provider>
  )
}

export function useEvents() {
  const context = useContext(EventsContext)
  if (context === undefined) {
    throw new Error('useEvents must be used within EventsProvider')
  }
  return context
}
