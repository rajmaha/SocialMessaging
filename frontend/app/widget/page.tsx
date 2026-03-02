'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { FiSend, FiMessageCircle, FiPaperclip } from 'react-icons/fi'
import { API_URL } from '@/lib/config';

// Singleton AudioContext — created on first user gesture; reused for all sounds
let _audioCtx: AudioContext | null = null

function getAudioContext(): AudioContext | null {
  try {
    if (!_audioCtx) {
      _audioCtx = new ((window as any).AudioContext || (window as any).webkitAudioContext)()
    }
    return _audioCtx
  } catch {
    return null
  }
}

async function playNotificationSound() {
  try {
    const ctx = getAudioContext()
    if (!ctx) return
    // Browsers suspend AudioContext until a user gesture; resume first
    if (ctx.state === 'suspended') await ctx.resume()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.type = 'sine'
    osc.frequency.setValueAtTime(880, ctx.currentTime)
    osc.frequency.setValueAtTime(660, ctx.currentTime + 0.08)
    gain.gain.setValueAtTime(0.28, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3)
    osc.start(ctx.currentTime)
    osc.stop(ctx.currentTime + 0.3)
  } catch {}
}

const WS_URL = API_URL.replace(/^http/, 'ws')
const SESSION_KEY = 'webchat_session_id'
const NAME_KEY   = 'webchat_visitor_name'
const EMAIL_KEY  = 'webchat_visitor_email'

interface ChatMessage {
  id?: number
  text: string
  sender: string
  is_agent: boolean
  timestamp?: string
  pending?: boolean
  media_url?: string | null
  message_type?: string
  suggestions?: Array<{ id: number; question: string }>
}

interface Branding {
  company_name: string
  primary_color: string
  logo_url?: string | null
  welcome_message: string
  timezone?: string
}

type Phase = 'email' | 'otp' | 'chat'

export default function WidgetPage() {
  const [phase, setPhase] = useState<Phase>('email')
  const [visitorName, setVisitorName] = useState('')
  // email phase
  const [nameInput, setNameInput] = useState('')
  const [emailInput, setEmailInput] = useState('')
  // otp phase
  const [otpInput, setOtpInput] = useState('')
  const [otpError, setOtpError] = useState('')
  const [otpSending, setOtpSending] = useState(false)
  const [otpResendCooldown, setOtpResendCooldown] = useState(0)

  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [linkPreviews, setLinkPreviews] = useState<Record<string, any>>({})
  const linkPreviewCache = useRef<Record<string, any>>({})
  const [inputText, setInputText] = useState('')
  const [pendingFile, setPendingFile] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [branding, setBranding] = useState<Branding>({
    company_name: 'Support Chat',
    primary_color: '#2563eb',
    welcome_message: 'Hi! How can we help you today?',
    timezone: 'UTC',
  })
  const [agentOnline, setAgentOnline] = useState(false)
  const [assignedAgent, setAssignedAgent] = useState<string | null>(null)
  const [rating, setRating] = useState<number>(0)          // 0 = not rated
  const [ratingHover, setRatingHover] = useState<number>(0)
  const [ratingComment, setRatingComment] = useState('')
  const [ratingSubmitted, setRatingSubmitted] = useState(false)
  const [ratingSubmitting, setRatingSubmitting] = useState(false)
  const [isTyping, setIsTyping] = useState(false)
  const [connecting, setConnecting] = useState(false)
  const [wsConnected, setWsConnected] = useState(false)
  const wsRef = useRef<WebSocket | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const messagesContainerRef = useRef<HTMLDivElement>(null)
  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const sessionIdRef = useRef<string | null>(null)
  const initialLoadRef = useRef(true)
  const botSenderRef = useRef<string>('Support Bot')

  // Load branding immediately (no auth required)
  const URL_REGEX = /https?:\/\/[^\s<>"']+[^\s<>"'.,;:!?)/]/g

  // Extract first URL from a message text
  const extractUrl = (text: string): string | null => text.match(URL_REGEX)?.[0] ?? null

  // Fetch link previews for any new text messages containing URLs
  useEffect(() => {
    messages.forEach((msg) => {
      if (msg.message_type && msg.message_type !== 'text') return
      if (msg.pending) return
      const url = extractUrl(msg.text)
      if (!url || linkPreviewCache.current[url] !== undefined) return
      linkPreviewCache.current[url] = null // mark as fetching
      fetch(`${API_URL}/webchat/link-preview?url=${encodeURIComponent(url)}`)
        .then((r) => r.ok ? r.json() : null)
        .then((data) => {
          linkPreviewCache.current[url] = data
          if (data) setLinkPreviews((prev) => ({ ...prev, [url]: data }))
        })
        .catch(() => { linkPreviewCache.current[url] = null })
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages])

  useEffect(() => {
    fetch(`${API_URL}/webchat/branding`)
      .then((r) => r.json())
      .then((d) => setBranding(d))
      .catch(() => {})
  }, [])

  // Check for existing verified session in localStorage
  useEffect(() => {
    const savedId   = localStorage.getItem(SESSION_KEY)
    const savedName = localStorage.getItem(NAME_KEY)
    if (savedId && savedName) {
      resumeSession(savedId, savedName)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Resend cooldown countdown
  useEffect(() => {
    if (otpResendCooldown <= 0) return
    const t = setTimeout(() => setOtpResendCooldown((c) => c - 1), 1000)
    return () => clearTimeout(t)
  }, [otpResendCooldown])

  const scrollToBottom = useCallback((smooth = true) => {
    requestAnimationFrame(() => {
      const el = messagesContainerRef.current
      if (!el) return
      if (smooth) {
        el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
      } else {
        el.scrollTop = el.scrollHeight
      }
    })
  }, [])

  useEffect(() => {
    const smooth = !initialLoadRef.current
    initialLoadRef.current = false
    scrollToBottom(smooth)
  }, [messages, isTyping, scrollToBottom])

  const resumeSession = async (sid: string, name: string) => {
    setConnecting(true)
    try {
      const resp = await fetch(`${API_URL}/webchat/session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: sid, visitor_name: name }),
      })
      if (!resp.ok) throw new Error('session not found')
      const data = await resp.json()
      applySession(data, name)
    } catch {
      // Session no longer valid — go back to email phase
      localStorage.removeItem(SESSION_KEY)
      localStorage.removeItem(NAME_KEY)
      localStorage.removeItem(EMAIL_KEY)
    } finally {
      setConnecting(false)
    }
  }

  // ── Phase 1: request OTP ─────────────────────────────────────────────────
  const requestOtp = async () => {
    const name  = nameInput.trim()
    const email = emailInput.trim().toLowerCase()
    if (!name || !email) return
    setOtpSending(true)
    setOtpError('')
    try {
      const resp = await fetch(`${API_URL}/webchat/request-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, name }),
      })
      const data = await resp.json()
      if (!resp.ok) {
        setOtpError(data.detail || 'Failed to send code. Try again.')
        return
      }
      setOtpResendCooldown(60)
      setPhase('otp')
    } catch {
      setOtpError('Network error. Check your connection.')
    } finally {
      setOtpSending(false)
    }
  }

  // ── Phase 2: verify OTP ───────────────────────────────────────────────────
  const verifyOtp = async () => {
    const email = emailInput.trim().toLowerCase()
    const otp   = otpInput.trim()
    if (!otp) return
    setConnecting(true)
    setOtpError('')
    // Warm up AudioContext now (we're inside a user gesture — button click)
    getAudioContext()
    try {
      const resp = await fetch(`${API_URL}/webchat/verify-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, otp }),
      })
      const data = await resp.json()
      if (!resp.ok) {
        setOtpError(data.detail || 'Invalid code. Try again.')
        return
      }
      // Save to localStorage so next visit skips OTP
      localStorage.setItem(SESSION_KEY, data.session_id)
      localStorage.setItem(NAME_KEY, data.visitor_name)
      localStorage.setItem(EMAIL_KEY, email)
      applySession(data, data.visitor_name)
    } catch {
      setOtpError('Network error. Check your connection.')
    } finally {
      setConnecting(false)
    }
  }

  const applySession = (data: any, name: string) => {
    sessionIdRef.current = data.session_id
    setVisitorName(name)
    setBranding((b) => ({ ...b, ...data.branding }))
    setAgentOnline(data.agent_online ?? false)
    setAssignedAgent(data.assigned_agent_name ?? null)
    if (data.rating) {
      setRating(data.rating)
      setRatingSubmitted(true)
    }
    initialLoadRef.current = true
    setMessages(
      (data.messages || []).map((m: any) => ({
        id: m.id,
        text: m.text,
        sender: m.sender,
        is_agent: m.is_agent,
        timestamp: m.timestamp,
        media_url: m.media_url ?? null,
        message_type: m.message_type || 'text',
      }))
    )
    setPhase('chat')
    connectWs(data.session_id)
  }

  const downloadFile = async (url: string, filename: string) => {
    try {
      const res = await fetch(url)
      const blob = await res.blob()
      const blobUrl = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = blobUrl
      a.download = filename
      a.click()
      URL.revokeObjectURL(blobUrl)
    } catch {
      window.open(url, '_blank')
    }
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
        // Capture bot/agent name for suggestion bubbles
        if (data.sender) botSenderRef.current = data.sender
        setMessages((prev) => [...prev, {
          id: data.id,
          text: data.text,
          sender: data.sender,
          is_agent: true,
          timestamp: data.timestamp,
          media_url: data.media_url ?? null,
          message_type: data.message_type || 'text',
        }])
        // Sound alert + badge notification for parent (launcher)
        playNotificationSound()
        window.parent.postMessage({ type: 'sc_new_message' }, '*')
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

      if (data.type === 'bot_suggestions') {
        setIsTyping(false)
        setMessages((prev) => [...prev, {
          text: '',
          sender: botSenderRef.current,
          is_agent: true,
          suggestions: data.suggestions,
        }])
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

  const selectSuggestion = (s: { id: number; question: string }) => {
    // Echo the chosen question as a visitor bubble
    setMessages((prev) => [...prev, {
      text: s.question,
      sender: 'You',
      is_agent: false,
      timestamp: new Date().toISOString(),
    }])
    // Tell backend which Q&A was selected
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'bot_selection', qa_id: s.id }))
    }
  }

  const sendMessage = () => {
    const text = inputText.trim()
    if ((!text && !pendingFile) || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      if ((text || pendingFile) && wsRef.current?.readyState !== WebSocket.OPEN) {
        const currentSid = sessionIdRef.current
        if (currentSid) connectWs(currentSid)
      }
      return
    }
    getAudioContext()

    if (pendingFile) {
      sendFile(pendingFile)
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

  const sendFile = async (file: File) => {
    const sid = sessionIdRef.current
    if (!sid || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return
    const isImage = file.type.startsWith('image/')
    const msgType = isImage ? 'image' : 'file'

    // Optimistic bubble
    const objectUrl = URL.createObjectURL(file)
    setMessages((prev) => [...prev, {
      text: file.name,
      sender: visitorName,
      is_agent: false,
      timestamp: new Date().toISOString(),
      pending: true,
      media_url: isImage ? objectUrl : null,
      message_type: msgType,
    }])
    setPendingFile(null)
    setUploading(true)

    try {
      const formData = new FormData()
      formData.append('file', file)
      const res = await fetch(`${API_URL}/webchat/upload-attachment?session_id=${encodeURIComponent(sid)}`, {
        method: 'POST',
        body: formData,
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        setMessages((prev) => prev.map((m) =>
          m.pending && m.text === file.name ? { ...m, pending: false, text: `[Upload failed: ${err.detail || res.status}]` } : m
        ))
        return
      }
      const data = await res.json()
      // Replace object URL with real URL, send via WS
      setMessages((prev) => prev.map((m) =>
        m.pending && m.text === file.name
          ? { ...m, pending: false, media_url: data.url }
          : m
      ))
      if (isImage) URL.revokeObjectURL(objectUrl)
      wsRef.current?.send(JSON.stringify({
        type: 'file',
        media_url: data.url,
        attachment_name: file.name,
        message_type: msgType,
      }))
    } finally {
      setUploading(false)
    }
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

  // ── Email input phase ─────────────────────────────────────────────────────
  if (phase === 'email') {
    const valid = nameInput.trim().length > 0 && /[^@\s]+@[^@\s]+\.[^@\s]+/.test(emailInput.trim())
    return (
      <div className="flex flex-col h-screen bg-white">
        <div className="flex items-center gap-3 px-4 py-3 text-white flex-shrink-0" style={{ background: headerBg }}>
          {branding.logo_url && (
            <img src={`${API_URL}${branding.logo_url}`} alt="logo" className="h-7 w-auto object-contain" />
          )}
          <span className="font-bold text-base truncate">{branding.company_name}</span>
        </div>

        <div className="flex-1 flex flex-col items-center justify-center p-6 text-center">
          <div className="w-16 h-16 rounded-full flex items-center justify-center mb-4" style={{ background: `${headerBg}20` }}>
            <FiMessageCircle size={32} style={{ color: headerBg }} />
          </div>
          <h2 className="text-xl font-bold text-gray-900 mb-2">Start a conversation</h2>
          <p className="text-gray-500 text-sm mb-8">{branding.welcome_message}</p>

          {connecting ? (
            <p className="text-gray-500 text-sm">Resuming your session…</p>
          ) : (
            <div className="w-full max-w-xs space-y-3">
              <input
                autoFocus
                type="text"
                placeholder="Your name"
                value={nameInput}
                onChange={(e) => setNameInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && valid && requestOtp()}
                className="w-full px-4 py-2.5 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
              />
              <input
                type="email"
                placeholder="Your email"
                value={emailInput}
                onChange={(e) => setEmailInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && valid && requestOtp()}
                className="w-full px-4 py-2.5 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
              />
              {otpError && <p className="text-red-500 text-xs">{otpError}</p>}
              <button
                onClick={requestOtp}
                disabled={!valid || otpSending}
                className="w-full py-2.5 rounded-xl text-white font-semibold text-sm disabled:opacity-50 transition"
                style={{ background: headerBg }}
              >
                {otpSending ? 'Sending code…' : 'Continue'}
              </button>
            </div>
          )}
        </div>
      </div>
    )
  }

  // ── OTP verification phase ────────────────────────────────────────────────
  if (phase === 'otp') {
    return (
      <div className="flex flex-col h-screen bg-white">
        <div className="flex items-center gap-3 px-4 py-3 text-white flex-shrink-0" style={{ background: headerBg }}>
          {branding.logo_url && (
            <img src={`${API_URL}${branding.logo_url}`} alt="logo" className="h-7 w-auto object-contain" />
          )}
          <span className="font-bold text-base truncate">{branding.company_name}</span>
        </div>

        <div className="flex-1 flex flex-col items-center justify-center p-6 text-center">
          <div className="w-16 h-16 rounded-full flex items-center justify-center mb-4" style={{ background: `${headerBg}20` }}>
            <span style={{ color: headerBg, fontSize: 28 }}>✉</span>
          </div>
          <h2 className="text-xl font-bold text-gray-900 mb-2">Check your email</h2>
          <p className="text-gray-500 text-sm mb-1">We sent a 6-digit code to</p>
          <p className="text-gray-800 font-semibold text-sm mb-8">{emailInput}</p>

          <div className="w-full max-w-xs space-y-3">
            <input
              autoFocus
              type="text"
              inputMode="numeric"
              maxLength={6}
              placeholder="000000"
              value={otpInput}
              onChange={(e) => { setOtpInput(e.target.value.replace(/\D/g, '')); setOtpError('') }}
              onKeyDown={(e) => e.key === 'Enter' && otpInput.length === 6 && verifyOtp()}
              className="w-full px-4 py-3 border border-gray-300 rounded-xl text-sm text-center tracking-widest text-2xl font-bold focus:outline-none focus:ring-2 focus:ring-blue-400"
            />
            {otpError && <p className="text-red-500 text-xs">{otpError}</p>}
            <button
              onClick={verifyOtp}
              disabled={otpInput.length !== 6 || connecting}
              className="w-full py-2.5 rounded-xl text-white font-semibold text-sm disabled:opacity-50 transition"
              style={{ background: headerBg }}
            >
              {connecting ? 'Verifying…' : 'Verify & Start Chat'}
            </button>
            <div className="flex items-center justify-between pt-1">
              <button
                onClick={() => { setPhase('email'); setOtpInput(''); setOtpError('') }}
                className="text-xs text-gray-500 hover:text-gray-700 underline"
              >
                ← Change email
              </button>
              {otpResendCooldown > 0 ? (
                <span className="text-xs text-gray-400">Resend in {otpResendCooldown}s</span>
              ) : (
                <button
                  onClick={() => { setOtpInput(''); setOtpError(''); requestOtp() }}
                  disabled={otpSending}
                  className="text-xs underline disabled:opacity-50"
                  style={{ color: headerBg }}
                >
                  Resend code
                </button>
              )}
            </div>
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
          {assignedAgent ? (
            <p className="text-xs opacity-90 truncate">
              <span className="opacity-70">Chatting with</span> <span className="font-semibold">{assignedAgent}</span>
              <span className={`ml-1.5 inline-block w-1.5 h-1.5 rounded-full align-middle ${agentOnline ? 'bg-green-300' : 'bg-white/40'}`} />
            </p>
          ) : (
            <p className="text-xs opacity-80">{agentOnline ? '🟢 Online' : '🔴 Away'}</p>
          )}
        </div>
      </div>

      {/* Reconnecting banner */}
      {!wsConnected && phase === 'chat' && (
        <div className="bg-yellow-50 border-b border-yellow-200 px-3 py-1.5 text-xs text-yellow-700 text-center flex-shrink-0">
          Reconnecting… your messages are saved.
        </div>
      )}

      {/* Messages */}
      <div ref={messagesContainerRef} className="flex-1 overflow-y-auto px-3 py-4 space-y-2">
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

        {messages.map((msg, i) => {
          const prevMsg = i > 0 ? messages[i - 1] : null
          const showSenderLabel = msg.is_agent && (!prevMsg || !prevMsg.is_agent || prevMsg.sender !== msg.sender)
          const senderInitial = (msg.sender || 'A')[0].toUpperCase()

          // Handover / transfer notice — shown as a neutral centered strip, not a chat bubble
          if (msg.message_type === 'handover') {
            // Parse new assigned agent from handover text ("Forwarded to Alex by ...")
            const fwdMatch = msg.text.match(/Forwarded to ([^\u2014"\n(]+?) by /)
            if (fwdMatch) setAssignedAgent(fwdMatch[1].trim())
            return (
              <div key={i} className="flex justify-center my-2 px-2">
                <div className="bg-gray-100 border border-gray-200 text-gray-500 text-[10px] px-3 py-1.5 rounded-full text-center max-w-[90%]">
                  {msg.text}
                </div>
              </div>
            )
          }

          return (
            <div key={i} className={`flex items-end gap-2 ${msg.is_agent ? '' : 'flex-row-reverse'}`}>
              {msg.is_agent && (
                <div
                  title={msg.sender}
                  className="w-7 h-7 rounded-full flex-shrink-0 flex items-center justify-center text-white text-xs font-bold"
                  style={{ background: headerBg }}
                >
                  {senderInitial}
                </div>
              )}
              <div className="flex flex-col max-w-[78%]">
                {showSenderLabel && (
                  <span className="text-[10px] text-gray-400 mb-0.5 ml-1">{msg.sender}</span>
                )}
                <div
                  className={`rounded-2xl shadow-sm text-sm overflow-hidden ${
                    msg.suggestions
                      ? 'bg-transparent shadow-none'
                      : msg.message_type === 'image' && msg.media_url
                      ? (msg.is_agent ? 'bg-white border border-gray-200 rounded-bl-sm' : 'rounded-br-sm')
                      : (msg.is_agent ? 'bg-white border border-gray-200 rounded-bl-sm text-gray-800 px-3 py-2' : 'text-white rounded-br-sm px-3 py-2')
                  } ${msg.pending ? 'opacity-60' : ''}`}
                  style={msg.is_agent ? {} : { background: msg.suggestions ? undefined : headerBg }}
                >
                  {(() => {
                    const tz = branding.timezone || 'UTC'
                    const parseUtcDate = (ts: string) => new Date(
                      !ts.endsWith('Z') && !ts.includes('+') && !ts.includes('-', 10) ? ts + 'Z' : ts
                    )
                    const fmtMsgTime = (ts: string) => {
                      const d = parseUtcDate(ts)
                      const now = new Date()
                      const sameDay  = new Intl.DateTimeFormat('en-US', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: tz }).format(d) ===
                                       new Intl.DateTimeFormat('en-US', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: tz }).format(now)
                      const sameYear = new Intl.DateTimeFormat('en-US', { year: 'numeric', timeZone: tz }).format(d) ===
                                       new Intl.DateTimeFormat('en-US', { year: 'numeric', timeZone: tz }).format(now)
                      if (sameDay)  return new Intl.DateTimeFormat('en-US', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: tz }).format(d)
                      if (sameYear) return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true, timeZone: tz }).format(d)
                      return new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true, timeZone: tz }).format(d)
                    }
                    const ts = msg.timestamp ? fmtMsgTime(msg.timestamp) : ''
                    if (msg.suggestions && msg.suggestions.length > 0) {
                      return (
                        <div className="space-y-1.5">
                          <p className="text-[11px] text-gray-500 px-0.5 mb-1">Did you mean…</p>
                          {msg.suggestions.map((s) => (
                            <button
                              key={s.id}
                              onClick={() => selectSuggestion(s)}
                              className="block w-full text-left text-sm px-3 py-2 rounded-xl border border-blue-200 bg-blue-50 hover:bg-blue-100 active:bg-blue-200 text-blue-800 transition-colors cursor-pointer"
                            >
                              {s.question}
                            </button>
                          ))}
                        </div>
                      )
                    }
                    if (msg.message_type === 'image' && msg.media_url) {
                      return (
                        <div>
                          <a href={`${API_URL}${msg.media_url}`} target="_blank" rel="noreferrer">
                            <img
                              src={`${API_URL}${msg.media_url}`}
                              alt="image"
                              className="max-w-[220px] block object-cover"
                              style={{ maxHeight: '180px' }}
                            />
                          </a>
                          <div className={`flex items-center justify-between gap-2 px-2 py-1.5 ${msg.is_agent ? 'text-gray-500' : 'text-white/80'}`}>
                            <span className="text-[10px]">{ts}</span>
                            <button
                              onClick={() => downloadFile(`${API_URL}${msg.media_url}`, msg.media_url!.split('/').pop() || 'image')}
                              className="text-[10px] underline font-medium flex items-center gap-0.5 cursor-pointer"
                            >
                              ⬇ Download
                            </button>
                          </div>
                        </div>
                      )
                    }
                    if (msg.message_type === 'file' && msg.media_url) {
                      const ext = msg.media_url.split('.').pop()?.toLowerCase() ?? ''
                      const browserFriendly = ['pdf','jpg','jpeg','png','gif','webp','svg','mp4','webm','ogg','mp3','wav','txt','csv'].includes(ext)
                      const fileUrl = `${API_URL}${msg.media_url}`
                      const filename = msg.text || msg.media_url.split('/').pop() || 'file'
                      return (
                        <>
                          <div className="flex items-center gap-2">
                            <span className="text-xl leading-none flex-shrink-0">📎</span>
                            <span className="break-all flex-1 text-[13px]">{filename}</span>
                          </div>
                          <div className="flex items-center gap-3 mt-1.5 text-[11px] font-medium">
                            {browserFriendly && (
                              <a href={fileUrl} target="_blank" rel="noreferrer"
                                className={`underline ${msg.is_agent ? 'text-blue-500' : 'text-white/90'}`}>
                                Open
                              </a>
                            )}
                            <button onClick={() => downloadFile(fileUrl, filename)}
                              className={`underline cursor-pointer ${msg.is_agent ? 'text-gray-500' : 'text-white/80'}`}>
                              ⬇ Download
                            </button>
                          </div>
                          <p className={`text-[10px] mt-1 ${msg.is_agent ? 'text-gray-400' : 'text-white/70'}`}>{ts}</p>
                        </>
                      )
                    }
                    // Plain text + link preview
                    const url = extractUrl(msg.text)
                    const preview = url ? linkPreviews[url] : null
                    return (
                      <>
                        <span>{msg.text}</span>
                        <p className={`text-[10px] mt-1 ${msg.is_agent ? 'text-gray-400' : 'text-white/70'}`}>
                          {ts}{msg.pending && ' · sending…'}
                        </p>
                        {preview && (
                          <a href={preview.url} target="_blank" rel="noreferrer"
                            className={`mt-2 block rounded-xl overflow-hidden border text-left no-underline ${msg.is_agent ? 'border-gray-200 bg-gray-50' : 'border-white/20 bg-white/10'}`}>
                            {preview.image && (
                              <img src={preview.image} alt=""
                                onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
                                className="w-full object-cover" style={{ maxHeight: '120px' }} />
                            )}
                            <div className="px-2 py-1.5">
                              {preview.domain && (
                                <p className={`text-[9px] font-medium uppercase tracking-wide ${msg.is_agent ? 'text-blue-500' : 'text-white/60'}`}>
                                  {preview.domain}
                                </p>
                              )}
                              {preview.title && (
                                <p className={`text-[11px] font-semibold leading-tight line-clamp-2 ${msg.is_agent ? 'text-gray-800' : 'text-white'}`}>
                                  {preview.title}
                                </p>
                              )}
                              {preview.description && (
                                <p className={`text-[10px] leading-tight line-clamp-2 mt-0.5 ${msg.is_agent ? 'text-gray-500' : 'text-white/70'}`}>
                                  {preview.description}
                                </p>
                              )}
                            </div>
                          </a>
                        )}
                      </>
                    )
                  })()}
                </div>
              </div>
            </div>
          )
        })}

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

      {/* ── Rating bar ──────────────────────────────────────────── */}
      {phase === 'chat' && sessionIdRef.current && (
        <div className="bg-white border-t border-gray-100 px-4 py-3 flex-shrink-0">
          {ratingSubmitted ? (
            <p className="text-center text-xs text-gray-400">
              {'★'.repeat(rating)}{'☆'.repeat(5 - rating)}{' '}
              <span className="text-gray-500">Thanks for rating!</span>
            </p>
          ) : (
            <div>
              <p className="text-center text-xs text-gray-400 mb-1.5">Rate this conversation</p>
              <div className="flex justify-center gap-1 mb-2">
                {[1,2,3,4,5].map(s => (
                  <button
                    key={s}
                    onMouseEnter={() => setRatingHover(s)}
                    onMouseLeave={() => setRatingHover(0)}
                    onClick={() => setRating(s)}
                    className="text-2xl leading-none transition-transform hover:scale-110 focus:outline-none"
                    style={{ color: s <= (ratingHover || rating) ? '#f59e0b' : '#d1d5db' }}
                    aria-label={`${s} star`}
                  >
                    ★
                  </button>
                ))}
              </div>
              {rating > 0 && (
                <>
                  <textarea
                    value={ratingComment}
                    onChange={e => setRatingComment(e.target.value)}
                    placeholder="Leave a comment (optional)…"
                    rows={2}
                    className="w-full text-xs border border-gray-200 rounded-lg px-2 py-1.5 resize-none focus:outline-none focus:ring-1 focus:ring-amber-300 mb-1.5"
                  />
                  <button
                    disabled={ratingSubmitting}
                    onClick={async () => {
                      if (!sessionIdRef.current) return
                      setRatingSubmitting(true)
                      try {
                        await fetch(`${API_URL}/webchat/rate`, {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({
                            session_id: sessionIdRef.current,
                            rating,
                            comment: ratingComment || null,
                          }),
                        })
                        setRatingSubmitted(true)
                      } finally {
                        setRatingSubmitting(false)
                      }
                    }}
                    className="w-full py-1.5 rounded-lg text-xs font-medium text-white transition disabled:opacity-50"
                    style={{ background: branding.primary_color || '#2563eb' }}
                  >
                    {ratingSubmitting ? 'Saving…' : 'Submit Rating'}
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      )}

      {/* Input */}
      <div className="bg-white border-t border-gray-200 flex-shrink-0">
        {/* File preview strip */}
        {pendingFile && (
          <div className="flex items-center gap-2 px-3 pt-2 pb-1">
            {pendingFile.type.startsWith('image/') ? (
              <img src={URL.createObjectURL(pendingFile)} alt="" className="h-12 w-12 object-cover rounded-lg border border-gray-200" />
            ) : (
              <div className="flex items-center gap-1.5 bg-gray-100 rounded-lg px-2 py-1.5 text-xs text-gray-700">
                <span>📎</span><span className="max-w-[140px] truncate">{pendingFile.name}</span>
              </div>
            )}
            <button onClick={() => setPendingFile(null)} className="ml-auto text-gray-400 hover:text-gray-600 text-lg leading-none">&times;</button>
          </div>
        )}
        <div className="px-3 py-2.5 flex items-center gap-2">
          {/* Hidden file input */}
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) setPendingFile(f)
              e.target.value = ''
            }}
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            className="w-8 h-8 flex items-center justify-center text-gray-400 hover:text-gray-600 flex-shrink-0"
            title="Attach file"
            disabled={uploading}
          >
            <FiPaperclip size={17} />
          </button>
          <textarea
            value={inputText}
            onChange={(e) => {
              setInputText(e.target.value)
              e.target.style.height = 'auto'
              e.target.style.height = Math.min(e.target.scrollHeight, 96) + 'px'
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                sendMessage()
              }
              handleKeyDown(e)
            }}
            placeholder={pendingFile ? pendingFile.name : 'Type a message…'}
            disabled={!!pendingFile}
            rows={1}
            spellCheck={true}
            autoCorrect="on"
            autoCapitalize="sentences"
            className="flex-1 px-3 py-2 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-400 bg-gray-50 disabled:opacity-50 resize-none overflow-hidden"
            style={{ minHeight: '36px', maxHeight: '96px' }}
          />
          <button
            onClick={sendMessage}
            disabled={(!inputText.trim() && !pendingFile) || !wsConnected || uploading}
            className="w-9 h-9 rounded-xl flex items-center justify-center text-white disabled:opacity-40 transition flex-shrink-0"
            style={{ background: headerBg }}
          >
            {uploading ? <span className="text-xs">…</span> : <FiSend size={16} />}
          </button>
        </div>
      </div>
    </div>
  )
}
