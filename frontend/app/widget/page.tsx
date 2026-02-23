'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { FiSend, FiMessageCircle } from 'react-icons/fi'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'
const WS_URL = API_URL.replace(/^http/, 'ws')
const SESSION_KEY = 'webchat_session_id'
const NAME_KEY = 'webchat_visitor_name'

interface ChatMessage {
  id?: number
  text: string
  sender: string
  is_agent: boolean
  timestamp?: string
  pending?: boolean
}

interface Branding {
  company_name: string
  primary_color: string
  logo_url?: string | null
  welcome_message: string
}

type Phase = 'name' | 'chat'

export default function WidgetPage() {
  const [phase, setPhase] = useState<Phase>('name')
  const [visitorName, setVisitorName] = useState('')
  const [nameInput, setNameInput] = useState('')
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [conversationId, setConversationId] = useState<number | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [inputText, setInputText] = useState('')
  const [branding, setBranding] = useState<Branding>({
    company_name: 'Support Chat',
    primary_color: '#2563eb',
    welcome_message: 'Hi! How can we help you today?',
  })
  const [agentOnline, setAgentOnline] = useState(false)
  const [isTyping, setIsTyping] = useState(false) // agent typing
  const [connecting, setConnecting] = useState(false)
  const [wsConnected, setWsConnected] = useState(false)
  const wsRef = useRef<WebSocket | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const sessionIdRef = useRef<string | null>(null)

  // Load branding immediately (no auth required)
  useEffect(() => {
    fetch(`${API_URL}/webchat/branding`)
      .then((r) => r.json())
      .then((d) => setBranding(d))
      .catch(() => {})
  }, [])

  // Check for existing session in localStorage
  useEffect(() => {
    const savedId = localStorage.getItem(SESSION_KEY)
    const savedName = localStorage.getItem(NAME_KEY)
    if (savedId && savedName) {
      resumeSession(savedId, savedName)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const scrollToBottom = useCallback(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [])

  useEffect(() => {
    scrollToBottom()
  }, [messages, isTyping, scrollToBottom])

  const resumeSession = async (sid: string, name: string) => {
    setConnecting(true)
    try {
      const resp = await fetch(`${API_URL}/webchat/session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: sid, visitor_name: name }),
      })
      const data = await resp.json()
      applySession(data, name)
    } catch {
      localStorage.removeItem(SESSION_KEY)
      localStorage.removeItem(NAME_KEY)
    } finally {
      setConnecting(false)
    }
  }

  const startSession = async () => {
    const name = nameInput.trim()
    if (!name) return
    setConnecting(true)
    try {
      const resp = await fetch(`${API_URL}/webchat/session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ visitor_name: name }),
      })
      const data = await resp.json()
      localStorage.setItem(SESSION_KEY, data.session_id)
      localStorage.setItem(NAME_KEY, name)
      applySession(data, name)
    } catch {
      alert('Could not connect. Please try again.')
    } finally {
      setConnecting(false)
    }
  }

  const applySession = (data: any, name: string) => {
    setSessionId(data.session_id)
    sessionIdRef.current = data.session_id
    setConversationId(data.conversation_id)
    setVisitorName(name)
    setBranding((b) => ({ ...b, ...data.branding }))
    setAgentOnline(data.agent_online ?? false)
    setMessages(
      (data.messages || []).map((m: any) => ({
        id: m.id,
        text: m.text,
        sender: m.sender,
        is_agent: m.is_agent,
        timestamp: m.timestamp,
      }))
    )
    setPhase('chat')
    connectWs(data.session_id)
  }

  const connectWs = (sid: string) => {
    if (reconnectTimer.current) clearTimeout(reconnectTimer.current)
    if (wsRef.current) {
      wsRef.current.onclose = null // prevent reconnect from old close
      wsRef.current.close()
    }

    const ws = new WebSocket(`${WS_URL}/webchat/ws/${sid}`)
    wsRef.current = ws

    let ping: ReturnType<typeof setInterval> | null = null

    ws.onopen = () => {
      setWsConnected(true)
      setAgentOnline(true)
      ping = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'ping' }))
      }, 25000)
    }

    ws.onmessage = (ev) => {
      const data = JSON.parse(ev.data)

      if (data.type === 'pong') return

      if (data.type === 'message' && data.is_agent) {
        setIsTyping(false)
        setMessages((prev) => [...prev, {
          id: data.id,
          text: data.text,
          sender: data.sender,
          is_agent: true,
          timestamp: data.timestamp,
        }])
        return
      }

      if (data.type === 'message' && !data.is_agent) {
        // Echo of our own message — replace the pending bubble
        setMessages((prev) => {
          const idx = [...prev].reverse().findIndex((m) => m.pending && m.text === data.text)
          if (idx === -1) return prev
          const realIdx = prev.length - 1 - idx
          const updated = [...prev]
          updated[realIdx] = { ...updated[realIdx], id: data.id, pending: false, timestamp: data.timestamp }
          return updated
        })
        return
      }

      if (data.type === 'agent_typing') {
        setIsTyping(data.is_typing)
        return
      }
    }

    ws.onclose = () => {
      if (ping) clearInterval(ping)
      setWsConnected(false)
      // Auto-reconnect after 3 seconds if we still have a session
      const currentSid = sessionIdRef.current
      if (currentSid) {
        reconnectTimer.current = setTimeout(() => connectWs(currentSid), 3000)
      }
    }

    ws.onerror = () => ws.close()
  }

  const sendMessage = () => {
    const text = inputText.trim()
    if (!text || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      if (text && wsRef.current?.readyState !== WebSocket.OPEN) {
        // Trigger a reconnect immediately if we have a session
        const currentSid = sessionIdRef.current
        if (currentSid) connectWs(currentSid)
      }
      return
    }

    // Optimistic bubble
    setMessages((prev) => [...prev, {
      text,
      sender: visitorName,
      is_agent: false,
      timestamp: new Date().toISOString(),
      pending: true,
    }])
    setInputText('')

    wsRef.current.send(JSON.stringify({ type: 'message', text }))
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
    // Typing indicator
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'typing', is_typing: true }))
      if (typingTimer.current) clearTimeout(typingTimer.current)
      typingTimer.current = setTimeout(() => {
        wsRef.current?.send(JSON.stringify({ type: 'typing', is_typing: false }))
      }, 1500)
    }
  }

  const headerBg = branding.primary_color

  // ── Name prompt ──────────────────────────────────────────────────────────
  if (phase === 'name') {
    return (
      <div className="flex flex-col h-screen bg-white">
        {/* Header */}
        <div className="flex items-center gap-3 px-4 py-3 text-white flex-shrink-0" style={{ background: headerBg }}>
          {branding.logo_url && (
            <img src={`${API_URL}${branding.logo_url}`} alt="logo" className="h-7 w-auto object-contain" />
          )}
          <span className="font-bold text-base truncate">{branding.company_name}</span>
        </div>

        {/* Welcome */}
        <div className="flex-1 flex flex-col items-center justify-center p-6 text-center">
          <div className="w-16 h-16 rounded-full flex items-center justify-center mb-4" style={{ background: `${headerBg}20` }}>
            <FiMessageCircle size={32} style={{ color: headerBg }} />
          </div>
          <h2 className="text-xl font-bold text-gray-900 mb-2">Start a conversation</h2>
          <p className="text-gray-500 text-sm mb-8">{branding.welcome_message}</p>

          <div className="w-full max-w-xs space-y-3">
            <input
              autoFocus
              type="text"
              placeholder="Your name"
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && startSession()}
              className="w-full px-4 py-2.5 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
            />
            <button
              onClick={startSession}
              disabled={!nameInput.trim() || connecting}
              className="w-full py-2.5 rounded-xl text-white font-semibold text-sm disabled:opacity-50 transition"
              style={{ background: headerBg }}
            >
              {connecting ? 'Connecting…' : 'Start Chat'}
            </button>
          </div>
        </div>
      </div>
    )
  }

  // ── Chat view ─────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-screen bg-gray-50">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 text-white flex-shrink-0 shadow-sm" style={{ background: headerBg }}>
        {branding.logo_url && (
          <img src={`${API_URL}${branding.logo_url}`} alt="logo" className="h-6 w-auto object-contain" />
        )}
        <div className="flex-1 min-w-0">
          <p className="font-bold text-sm leading-tight truncate">{branding.company_name}</p>
          <p className="text-xs opacity-80">{agentOnline ? '🟢 Online' : '🔴 Away'}</p>
        </div>
      </div>

      {/* Reconnecting banner */}
      {!wsConnected && phase === 'chat' && (
        <div className="bg-yellow-50 border-b border-yellow-200 px-3 py-1.5 text-xs text-yellow-700 text-center flex-shrink-0">
          Reconnecting… your messages are saved.
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-3 py-4 space-y-2">
        {/* Welcome bubble from agent */}
        {messages.length === 0 && (
          <div className="flex items-end gap-2 mb-2">
            <div className="w-7 h-7 rounded-full flex-shrink-0 flex items-center justify-center text-white text-xs font-bold" style={{ background: headerBg }}>
              {branding.company_name[0]}
            </div>
            <div className="max-w-[78%] bg-white border border-gray-200 rounded-2xl rounded-bl-sm px-3 py-2 shadow-sm">
              <p className="text-sm text-gray-800">{branding.welcome_message}</p>
            </div>
          </div>
        )}

        {messages.map((msg, i) => (
          <div key={i} className={`flex items-end gap-2 ${msg.is_agent ? '' : 'flex-row-reverse'}`}>
            {msg.is_agent && (
              <div className="w-7 h-7 rounded-full flex-shrink-0 flex items-center justify-center text-white text-xs font-bold" style={{ background: headerBg }}>
                {branding.company_name[0]}
              </div>
            )}
            <div
              className={`max-w-[78%] px-3 py-2 rounded-2xl shadow-sm text-sm ${
                msg.is_agent
                  ? 'bg-white border border-gray-200 rounded-bl-sm text-gray-800'
                  : 'text-white rounded-br-sm'
              } ${msg.pending ? 'opacity-60' : ''}`}
              style={msg.is_agent ? {} : { background: headerBg }}
            >
              {msg.text}
              <p className={`text-[10px] mt-1 ${msg.is_agent ? 'text-gray-400' : 'text-white/70'}`}>
                {msg.timestamp ? new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}
                {msg.pending && ' · sending…'}
              </p>
            </div>
          </div>
        ))}

        {/* Typing indicator */}
        {isTyping && (
          <div className="flex items-end gap-2">
            <div className="w-7 h-7 rounded-full flex-shrink-0 flex items-center justify-center text-white text-xs font-bold" style={{ background: headerBg }}>
              {branding.company_name[0]}
            </div>
            <div className="bg-white border border-gray-200 rounded-2xl rounded-bl-sm px-3 py-2 shadow-sm">
              <span className="flex gap-1 items-center h-4">
                <span className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: '0ms' }} />
                <span className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: '150ms' }} />
                <span className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: '300ms' }} />
              </span>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="bg-white border-t border-gray-200 px-3 py-2.5 flex items-center gap-2 flex-shrink-0">
        <input
          type="text"
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Type a message…"
          className="flex-1 px-3 py-2 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-400 bg-gray-50"
        />
        <button
          onClick={sendMessage}
          disabled={!inputText.trim() || !wsConnected}
          className="w-9 h-9 rounded-xl flex items-center justify-center text-white disabled:opacity-40 transition flex-shrink-0"
          style={{ background: headerBg }}
        >
          <FiSend size={16} />
        </button>
      </div>
    </div>
  )
}
