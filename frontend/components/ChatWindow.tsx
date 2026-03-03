'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import axios from 'axios'
import { FiSend, FiPaperclip, FiX, FiFile, FiSearch } from 'react-icons/fi'
import { getAuthToken, authAPI } from '@/lib/auth'
import { useEvents } from '@/lib/events-context'
import { useBranding } from '@/lib/branding-context'
import { API_URL } from '@/lib/config';

interface Message {
  id: number
  conversation_id: number
  sender_name: string
  message_text: string
  message_type: string
  media_url?: string | null
  platform: string
  is_sent: number
  read_status: number
  delivery_status?: string
  timestamp: string
  subject?: string | null
  email_id?: number | null
}

interface Conversation {
  id: number
  platform: string
  contact_name: string
  contact_id: string
  last_message: string | null
  last_message_time: string | null
  unread_count: number
  contact_avatar: string | null
  status?: string
  assigned_to?: number | null
  assigned_to_name?: string | null
}

interface ChatWindowProps {
  conversation: Conversation | null
  onRefresh: () => void
}

export default function ChatWindow({ conversation, onRefresh }: ChatWindowProps) {
  const { subscribe } = useEvents()
  const { branding } = useBranding()
  const tz = branding?.timezone || 'UTC'
  // Backend stores naive UTC datetimes — ensure 'Z' suffix so JS treats as UTC
  const parseUtcDate = (ts: string) => new Date(
    ts && !ts.endsWith('Z') && !ts.includes('+') && !ts.includes('-', 10) ? ts + 'Z' : ts
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
  const currentUser = authAPI.getUser()
  const [messages, setMessages] = useState<Message[]>([])
  const [messageText, setMessageText] = useState('')
  const [loading, setLoading] = useState(false)
  const [sending, setSending] = useState(false)
  const [visitorOnline, setVisitorOnline] = useState<boolean | null>(null)
  const [visitorTyping, setVisitorTyping] = useState(false)
  const [hasMore, setHasMore] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [earliestMsgId, setEarliestMsgId] = useState<number | null>(null)
  const [convStatus, setConvStatus] = useState('open')
  const [convCategory, setConvCategory] = useState('')
  const [assignedTo, setAssignedTo] = useState<number | null>(null)
  const [assignedTeamId, setAssignedTeamId] = useState<number | null>(null)
  const [agents, setAgents] = useState<{ id: number; full_name: string }[]>([])
  const [teams, setTeams] = useState<{ id: number; name: string; members: { id: number; full_name: string }[] }[]>([])
  const [showSearch, setShowSearch] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<Message[] | null>(null)
  const [searching, setSearching] = useState(false)
  const [assignModal, setAssignModal] = useState<{ show: boolean; targetId: number | null; targetTeamId: number | null; targetName: string; note: string }>({ show: false, targetId: null, targetTeamId: null, targetName: '', note: '' })
  const [showLeadModal, setShowLeadModal] = useState(false)
  const [leadForm, setLeadForm] = useState({ first_name: '', last_name: '', email: '', phone: '', company: '' })
  const [leadLoading, setLeadLoading] = useState(false)
  const [leadCreated, setLeadCreated] = useState(false)
  const [crmLead, setCrmLead] = useState<any>(null)
  const [crmCardOpen, setCrmCardOpen] = useState(false)
  const [pendingFile, setPendingFile] = useState<File | null>(null)
  const [allowedTypes, setAllowedTypes] = useState<string[]>([])
  const [maxFileMb, setMaxFileMb] = useState(10)
  const [linkPreviews, setLinkPreviews] = useState<Record<string, any>>({})
  const fileInputRef = useRef<HTMLInputElement>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const messagesContainerRef = useRef<HTMLDivElement>(null)
  const conversationRef = useRef<Conversation | null>(null)
  const linkPreviewCache = useRef<Record<string, any>>({})
  const initialLoadRef = useRef(true)
  const preserveScrollRef = useRef(false)
  const prevScrollHeightRef = useRef(0)
  const agentTypingTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const visitorTypingTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Keep ref in sync so event callbacks always see the current conversation
  useEffect(() => { conversationRef.current = conversation }, [conversation])

  useEffect(() => {
    if (conversation) {
      initialLoadRef.current = true
      setHasMore(false)
      setEarliestMsgId(null)
      setSearchResults(null)
      setSearchQuery('')
      setShowSearch(false)
      setConvStatus(conversation.status || 'open')
      setConvCategory((conversation as any).category || '')
      setAssignedTo(conversation.assigned_to ?? null)
      setAssignedTeamId((conversation as any).assigned_team_id ?? null)
      fetchMessages(conversation.id)
      // record usage analytics event
      axios.post(`${API_URL}/billing/usage-events`,
        { event_type: "open_conversation", data: { conversation_id: conversation.id } },
        { headers: { Authorization: getAuthToken() || "" } }
      ).catch(() => {})
      // For webchat, immediately check whether visitor is currently connected
      if (conversation.platform === 'webchat') {
        setVisitorOnline(false)
        axios.get(`${API_URL}/webchat/online-conversation-ids`)
          .then((r) => {
            const ids: number[] = r.data.ids || []
            setVisitorOnline(ids.includes(conversation.id))
          })
          .catch(() => setVisitorOnline(false))
      } else {
        setVisitorOnline(null)
      }
      setVisitorTyping(false)
      // Clear unread badge immediately when agent opens the conversation
      if (conversation.unread_count > 0) {
        axios.put(`${API_URL}/conversations/${conversation.id}`).catch(() => {})
        onRefresh()
      }
    }
  }, [conversation])

  // Real-time: track visitor presence (online/offline) for the open conversation
  useEffect(() => {
    const unsubOn = subscribe('webchat_visitor_online', (ev) => {
      const conv = conversationRef.current
      if (conv && ev.data.conversation_id === conv.id) setVisitorOnline(true)
    })
    const unsubOff = subscribe('webchat_visitor_offline', (ev) => {
      const conv = conversationRef.current
      if (conv && ev.data.conversation_id === conv.id) setVisitorOnline(false)
    })
    return () => { unsubOn(); unsubOff() }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subscribe])

  // Real-time: show typing bubble when the visitor is typing
  useEffect(() => {
    const unsub = subscribe('webchat_typing', (ev) => {
      const conv = conversationRef.current
      if (!conv || ev.data.conversation_id !== conv.id) return
      setVisitorTyping(ev.data.is_typing)
      // auto-clear after 4 s in case we miss the stop event
      if (visitorTypingTimer.current) clearTimeout(visitorTypingTimer.current)
      if (ev.data.is_typing) {
        visitorTypingTimer.current = setTimeout(() => setVisitorTyping(false), 4000)
      }
    })
    return unsub
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subscribe])

  // Real-time: append incoming visitor messages without waiting for a manual refresh
  useEffect(() => {
    const unsub = subscribe('message_received', (ev) => {
      const conv = conversationRef.current
      if (!conv || ev.data.conversation_id !== conv.id) return
      // Visitor just sent a message — they are clearly online
      if (conv.platform === 'webchat') setVisitorOnline(true)
      // Re-fetch to get the full Message shape from the REST API
      fetchMessages(conv.id)
      onRefresh()
    })
    return unsub
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subscribe])

  // Real-time: handle this conversation being assigned to the current agent
  useEffect(() => {
    const unsub = subscribe('conversation_assigned', (ev) => {
      onRefresh()
      const conv = conversationRef.current
      if (conv && ev.data.conversation_id === conv.id) {
        if (ev.data.assigned_to_id != null) setAssignedTo(ev.data.assigned_to_id)
        fetchMessages(conv.id)
      }
    })
    return unsub
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subscribe])

  const URL_REGEX = /https?:\/\/[^\s<>"']+[^\s<>"'.,;:!?)/]/g
  const extractUrl = (text: string): string | null => text.match(URL_REGEX)?.[0] ?? null

  // Fetch link previews for text messages containing URLs
  useEffect(() => {
    messages.forEach((msg) => {
      if (msg.media_url) return // skip attachment messages
      const url = extractUrl(msg.message_text)
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
  }, [messages])

  // Load allowed file types once on mount
  useEffect(() => {
    axios.get(`${API_URL}/messages/allowed-file-types`).then((r) => {
      setAllowedTypes(r.data.allowed_file_types || [])
      setMaxFileMb(r.data.max_file_size_mb || 10)
    }).catch(() => {})
  }, [])

  useEffect(() => {
    if (preserveScrollRef.current) {
      preserveScrollRef.current = false
      const el = messagesContainerRef.current
      if (el) el.scrollTop = el.scrollHeight - prevScrollHeightRef.current
    } else {
      const smooth = !initialLoadRef.current
      initialLoadRef.current = false
      scrollToBottom(smooth)
    }
  }, [messages])

  const scrollToBottom = (smooth = true) => {
    requestAnimationFrame(() => {
      const el = messagesContainerRef.current
      if (!el) return
      if (smooth) {
        el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
      } else {
        el.scrollTop = el.scrollHeight
      }
    })
  }

  const fetchMessages = useCallback(async (conversationId: number, beforeId?: number) => {
    if (beforeId) setLoadingMore(true)
    else setLoading(true)
    try {
      const params: { limit: number; before_id?: number } = { limit: 50 }
      if (beforeId) params.before_id = beforeId
      const response = await axios.get(
        `${API_URL}/messages/conversation/${conversationId}`,
        { params }
      )
      const { messages: msgs, has_more } = response.data
      setHasMore(has_more)
      if (msgs.length > 0) setEarliestMsgId(msgs[0].id)
      if (beforeId) {
        prevScrollHeightRef.current = messagesContainerRef.current?.scrollHeight ?? 0
        preserveScrollRef.current = true
        setMessages((prev) => [...msgs, ...prev])
      } else {
        setMessages(msgs)
      }
    } catch (error) {
      console.error('Error fetching messages:', error)
    } finally {
      setLoading(false)
      setLoadingMore(false)
    }
  }, [])

  useEffect(() => {
    const token = getAuthToken()
    if (!token) return
    const headers = { Authorization: `Bearer ${token}` }
    axios.get(`${API_URL}/conversations/agents`, { headers }).then((r) => setAgents(r.data)).catch(() => {})
    axios.get(`${API_URL}/teams/`, { headers }).then((r) => setTeams(r.data)).catch(() => {})
  }, [])

  // Fetch linked CRM lead whenever conversation changes
  useEffect(() => {
    if (!conversation?.id) { setCrmLead(null); return }
    const token = getAuthToken()
    fetch(`${API_URL}/crm/leads/by-conversation/${conversation.id}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(res => res.ok ? res.json() : null)
      .then(data => setCrmLead(data))
      .catch(() => setCrmLead(null))
  }, [conversation?.id])

  const handleStatusChange = async (newStatus: string) => {
    if (!conversation) return
    const token = getAuthToken()
    try {
      await axios.patch(
        `${API_URL}/conversations/${conversation.id}/status`,
        { status: newStatus },
        { headers: token ? { Authorization: `Bearer ${token}` } : {} }
      )
      setConvStatus(newStatus)
      onRefresh()
    } catch {}
  }

  const handleAssign = async (userId: number | null, note?: string, teamId?: number | null) => {
    if (!conversation) return
    const token = getAuthToken()
    try {
      await axios.patch(
        `${API_URL}/conversations/${conversation.id}/assign`,
        { user_id: userId, team_id: teamId ?? null, note: note || '' },
        { headers: token ? { Authorization: `Bearer ${token}` } : {} }
      )
      setAssignedTo(userId)
      setAssignedTeamId(teamId ?? null)
      fetchMessages(conversation.id)
      onRefresh()
    } catch {}
  }

  const handleSearch = async () => {
    if (!searchQuery.trim() || !conversation) return
    setSearching(true)
    try {
      const token = getAuthToken()
      const r = await axios.get(`${API_URL}/messages/search`, {
        params: { q: searchQuery, conversation_id: conversation.id, limit: 30 },
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      })
      setSearchResults(r.data)
    } catch {}
    setSearching(false)
  }

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (allowedTypes.length > 0 && !allowedTypes.includes(file.type)) {
      alert(`File type not allowed. Allowed types: ${allowedTypes.join(', ')}`)
      return
    }
    if (file.size > maxFileMb * 1024 * 1024) {
      alert(`File too large. Maximum size is ${maxFileMb} MB.`)
      return
    }
    setPendingFile(file)
    // reset input so same file can be re-selected
    e.target.value = ''
  }

  const handleSendMessage = async () => {
    if (!messageText.trim() && !pendingFile) return
    if (!conversation) return

    // analytics event - message sent
    axios.post(`${API_URL}/billing/usage-events`,
      { event_type: "send_message", data: { conversation_id: conversation.id } },
      { headers: { Authorization: getAuthToken() || "" } }
    ).catch(() => {})

    setSending(true)
    try {
      const token = getAuthToken()
      const headers = token ? { Authorization: `Bearer ${token}` } : {}

      // Auto-claim: if no one owns this conversation yet, silently assign to self before sending
      if (assignedTo === null && assignedTeamId === null && currentUser) {
        await axios.patch(
          `${API_URL}/conversations/${conversation.id}/assign`,
          { user_id: currentUser.user_id, note: '' },
          { headers }
        )
        setAssignedTo(currentUser.user_id)
      }

      let mediaUrl: string | undefined
      let attachmentName: string | undefined

      // Upload file first if one is pending
      if (pendingFile) {
        const fd = new FormData()
        fd.append('file', pendingFile)
        const uploadResp = await axios.post(`${API_URL}/messages/upload-attachment`, fd, { headers })
        mediaUrl = uploadResp.data.url
        attachmentName = uploadResp.data.filename
        setPendingFile(null)
      }

      await axios.post(`${API_URL}/messages/send`, null, {
        params: {
          conversation_id: conversation.id,
          message_text: messageText,
          ...(mediaUrl ? { media_url: mediaUrl, attachment_name: attachmentName } : {}),
        },
        headers,
      })

      // webchat delivery is tracked via webchat_visitor_online/offline events

      setMessageText('')
      // Refresh messages and conversations
      if (conversation) {
        fetchMessages(conversation.id)
      }
      onRefresh()
    } catch (error) {
      console.error('Error sending message:', error)
      alert('Failed to send message')
    } finally {
      setSending(false)
    }
  }

  if (!conversation) {
    return (
      <div className="flex-1 flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <h2 className="text-2xl font-semibold text-gray-800 mb-2">
            Open a conversation
          </h2>
          <p className="text-gray-600">Select a chat to start messaging</p>
        </div>
      </div>
    )
  }

  const getPlatformColor = (platform: string) => {
    const colors: { [key: string]: string } = {
      whatsapp: 'bg-green-100 text-green-800',
      facebook: 'bg-blue-100 text-blue-800',
      viber: 'bg-purple-100 text-purple-800',
      linkedin: 'bg-blue-100 text-blue-800',
      webchat: 'bg-teal-100 text-teal-800',
      email: 'bg-orange-100 text-orange-800',
    }
    return colors[platform.toLowerCase()] || 'bg-gray-100 text-gray-800'
  }

  const statusColors: Record<string, string> = {
    open: 'bg-blue-100 text-blue-700 border-blue-200',
    pending: 'bg-amber-100 text-amber-700 border-amber-200',
    resolved: 'bg-green-100 text-green-700 border-green-200',
  }

  const CATEGORIES = ['General', 'Billing', 'Technical Support', 'Sales', 'Complaint', 'Other']

  const handleConvertToLead = async () => {
    if (!leadForm.first_name.trim()) return
    setLeadLoading(true)
    try {
      const token = getAuthToken()
      await fetch(`${API_URL}/crm/leads/from-conversation/${conversation.id}`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...leadForm, source: 'conversation' }),
      })
      setLeadCreated(true)
      setShowLeadModal(false)
    } catch (e) {
      console.error(e)
    } finally {
      setLeadLoading(false)
    }
  }

  const handleCategoryChange = async (cat: string) => {
    if (!conversation) return
    setConvCategory(cat)
    try {
      const token = getAuthToken()
      await axios.patch(
        `${API_URL}/conversations/${conversation.id}/category`,
        { category: cat },
        { headers: { Authorization: `Bearer ${token}` } }
      )
    } catch (e) { console.error('Failed to update category', e) }
  }

  const DeliveryTick = ({ status }: { status?: string }) => {
    if (!status || status === 'sent') return <span className="text-gray-400 text-[10px] ml-1">✓</span>
    if (status === 'failed') return <span className="text-red-400 text-[10px] ml-1">⚠</span>
    if (status === 'read') return <span className="text-blue-300 text-[10px] ml-1">✓✓</span>
    return <span className="text-gray-300 text-[10px] ml-1">✓✓</span>
  }

  return (
    <div className="flex-1 flex flex-col">
      {/* Chat Header */}
      <div className="border-b px-6 py-3 flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-lg font-semibold text-gray-800">
            {conversation.contact_name}
          </h2>
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            <span
              className={`inline-block px-3 py-1 text-xs font-semibold rounded-full ${getPlatformColor(
                conversation.platform
              )}`}
            >
              {conversation.platform.charAt(0).toUpperCase() +
                conversation.platform.slice(1)}
            </span>
            {conversation.platform === 'webchat' && visitorOnline !== null && (
              <span className={`inline-flex items-center gap-1 text-xs font-medium ${visitorOnline ? 'text-green-600' : 'text-gray-400'}`}>
                <span className={`w-2 h-2 rounded-full ${visitorOnline ? 'bg-green-500' : 'bg-gray-300'}`} />
                {visitorOnline ? 'Visitor online' : 'Visitor offline — message saved'}
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* Status selector */}
          <select
            value={convStatus}
            onChange={(e) => handleStatusChange(e.target.value)}
            className={`text-xs font-semibold px-2 py-1 rounded-full border cursor-pointer focus:outline-none ${statusColors[convStatus] || statusColors.open}`}
          >
            <option value="open">Open</option>
            <option value="pending">Pending</option>
            <option value="resolved">Resolved</option>
          </select>
          {/* Category / issue type */}
          <select
            value={convCategory}
            onChange={(e) => handleCategoryChange(e.target.value)}
            className="text-xs px-2 py-1 rounded-full border border-gray-200 text-gray-500 bg-white cursor-pointer focus:outline-none hover:border-gray-400"
            title="Issue category"
          >
            <option value="">Category…</option>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
          {/* Assign to agent or team */}
          {assignedTo === null && assignedTeamId === null ? (
            <button
              onClick={() => currentUser && handleAssign(currentUser.user_id)}
              className="text-xs px-3 py-1 rounded-full border border-indigo-300 text-indigo-600 bg-indigo-50 hover:bg-indigo-100 font-semibold transition"
            >
              + Claim
            </button>
          ) : (
            <div className="flex items-center gap-1">
              <select
                value={assignedTeamId ? `team:${assignedTeamId}` : (assignedTo ?? '')}
                onChange={(e) => {
                  const val = e.target.value
                  if (!val) { handleAssign(null, '', null); return }
                  if (val.startsWith('team:')) {
                    const tid = Number(val.replace('team:', ''))
                    const team = teams.find(t => t.id === tid)
                    setAssignModal({ show: true, targetId: null, targetTeamId: tid, targetName: `team "${team?.name || tid}"`, note: '' })
                    return
                  }
                  const uid = Number(val)
                  if (currentUser && uid === currentUser.user_id) { handleAssign(uid, '', null); return }
                  const agent = agents.find(a => a.id === uid)
                  setAssignModal({ show: true, targetId: uid, targetTeamId: null, targetName: agent?.full_name || `Agent ${uid}`, note: '' })
                }}
                className="text-xs px-2 py-1 rounded border border-gray-200 text-gray-600 focus:outline-none cursor-pointer max-w-[160px] truncate"
              >
                <option value="">Unassigned</option>
                {teams.length > 0 && (
                  <optgroup label="── Teams">
                    {teams.map((t) => (
                      <option key={`team:${t.id}`} value={`team:${t.id}`}>{t.name}</option>
                    ))}
                  </optgroup>
                )}
                <optgroup label="── Agents">
                  {agents.map((a) => (
                    <option key={a.id} value={a.id}>
                      {currentUser && a.id === currentUser.user_id ? 'You' : a.full_name}
                    </option>
                  ))}
                </optgroup>
              </select>
            </div>
          )}
          {/* Convert to Lead */}
          {!leadCreated ? (
            <button
              onClick={() => {
                const nameParts = (conversation.contact_name || '').trim().split(' ')
                setLeadForm({
                  first_name: nameParts[0] || '',
                  last_name: nameParts.slice(1).join(' '),
                  email: '',
                  phone: '',
                  company: '',
                })
                setShowLeadModal(true)
              }}
              className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-purple-700 bg-purple-50 hover:bg-purple-100 rounded-lg transition"
              title="Convert this conversation to a CRM lead"
            >
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" /></svg>
              Convert to Lead
            </button>
          ) : (
            <span className="text-xs text-green-600 font-medium">✓ Lead created</span>
          )}
          {/* Search toggle */}
          <button
            onClick={() => setShowSearch((s) => !s)}
            className={`p-1.5 rounded-lg transition ${showSearch ? 'bg-blue-100 text-blue-600' : 'text-gray-400 hover:text-gray-600 hover:bg-gray-100'}`}
            title="Search messages"
          >
            <FiSearch size={16} />
          </button>
        </div>
      </div>

      {/* CRM Contact Card — shown when this conversation is linked to a lead */}
      {crmLead && (
        <div className="border-b bg-purple-50 px-6 py-2 flex items-center justify-between gap-3">
          <button
            onClick={() => setCrmCardOpen(o => !o)}
            className="flex items-center gap-2 text-sm font-medium text-purple-800 hover:text-purple-900"
          >
            <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
            </svg>
            <span>{crmLead.first_name} {crmLead.last_name || ''}</span>
            {crmLead.company && <span className="text-purple-500 font-normal">· {crmLead.company}</span>}
            <span className={`ml-1 px-2 py-0.5 rounded-full text-xs font-semibold ${
              crmLead.status === 'new' ? 'bg-blue-100 text-blue-700' :
              crmLead.status === 'contacted' ? 'bg-yellow-100 text-yellow-700' :
              crmLead.status === 'qualified' ? 'bg-green-100 text-green-700' :
              crmLead.status === 'converted' ? 'bg-purple-100 text-purple-700' :
              'bg-red-100 text-red-700'
            }`}>{crmLead.status}</span>
            <span className="text-xs text-purple-400">Score: {crmLead.score}</span>
            <svg className={`w-3 h-3 ml-1 transition-transform ${crmCardOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          <a
            href={`/admin/crm/leads/${crmLead.id}`}
            target="_blank"
            rel="noreferrer"
            className="text-xs text-purple-600 hover:text-purple-800 font-medium whitespace-nowrap"
          >
            View Lead →
          </a>
        </div>
      )}

      {/* CRM expanded card */}
      {crmLead && crmCardOpen && (
        <div className="border-b bg-white px-6 py-3 grid grid-cols-3 gap-4 text-sm">
          <div>
            <p className="text-xs text-gray-400 font-medium uppercase tracking-wide mb-1">Contact</p>
            {crmLead.email && <p className="text-gray-700">📧 {crmLead.email}</p>}
            {crmLead.phone && <p className="text-gray-700">📞 {crmLead.phone}</p>}
          </div>
          <div>
            <p className="text-xs text-gray-400 font-medium uppercase tracking-wide mb-1">Active Deals</p>
            {crmLead.deals && crmLead.deals.length > 0 ? (
              crmLead.deals.slice(0, 2).map((d: any) => (
                <p key={d.id} className="text-gray-700 truncate">
                  {d.name} <span className="text-xs text-gray-400">({d.stage})</span>
                </p>
              ))
            ) : (
              <p className="text-gray-400 text-xs">No deals</p>
            )}
          </div>
          <div>
            <p className="text-xs text-gray-400 font-medium uppercase tracking-wide mb-1">Open Tasks</p>
            {crmLead.tasks && crmLead.tasks.filter((t: any) => t.status !== 'completed' && t.status !== 'cancelled').length > 0 ? (
              crmLead.tasks.filter((t: any) => t.status !== 'completed' && t.status !== 'cancelled').slice(0, 2).map((t: any) => (
                <p key={t.id} className="text-gray-700 truncate text-xs">{t.title}</p>
              ))
            ) : (
              <p className="text-gray-400 text-xs">No open tasks</p>
            )}
          </div>
        </div>
      )}

      {/* Search bar */}
      {showSearch && (
        <div className="border-b px-6 py-2 flex items-center gap-2 bg-gray-50">
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleSearch() }}
            placeholder="Search messages…"
            className="flex-1 text-sm px-3 py-1.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-400"
            autoFocus
          />
          <button
            onClick={handleSearch}
            disabled={searching}
            className="text-sm px-3 py-1.5 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50 transition"
          >
            {searching ? 'Searching…' : 'Search'}
          </button>
          {searchResults !== null && (
            <button
              onClick={() => { setSearchResults(null); setSearchQuery('') }}
              className="text-gray-400 hover:text-gray-600"
            >
              <FiX size={16} />
            </button>
          )}
          {searchResults !== null && (
            <span className="text-xs text-gray-500 whitespace-nowrap">{searchResults.length} result{searchResults.length !== 1 ? 's' : ''}</span>
          )}
        </div>
      )}

      {/* Messages Area */}
      <div ref={messagesContainerRef} className="flex-1 overflow-y-auto p-6 space-y-4">
        {loading ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-gray-500">Loading messages...</div>
          </div>
        ) : messages.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-gray-500 text-center">
              <p>No messages yet</p>
              <p className="text-sm mt-2">Start a new conversation</p>
            </div>
          </div>
        ) : (
          <>
            {/* Load more / search result count */}
            {searchResults !== null ? (
              <p className="text-center text-xs text-gray-400 mb-2">
                {searchResults.length} result{searchResults.length !== 1 ? 's' : ''} for &ldquo;{searchQuery}&rdquo;
              </p>
            ) : hasMore && (
              <div className="flex justify-center pb-2">
                <button
                  onClick={() => conversation && fetchMessages(conversation.id, earliestMsgId ?? undefined)}
                  disabled={loadingMore}
                  className="text-sm text-blue-600 hover:text-blue-800 disabled:opacity-50 font-medium"
                >
                  {loadingMore ? 'Loading…' : '↑ Load earlier messages'}
                </button>
              </div>
            )}
            {(searchResults ?? messages).map((message) => {
              if (message.message_type === 'handover') {
                return (
                  <div key={message.id} className="flex justify-center my-2">
                    <div className="bg-amber-50 border border-amber-200 text-amber-800 text-[11px] px-4 py-1.5 rounded-full max-w-sm text-center font-medium">
                      {message.message_text}
                    </div>
                  </div>
                )
              }
              return (
            <div
              key={message.id}
              className={`flex ${message.is_sent ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={`message-bubble max-w-xs lg:max-w-md ${
                  message.is_sent
                    ? 'message-sent bg-blue-500 text-white'
                    : 'message-received bg-gray-200 text-gray-800'
                }`}
              >
                {/* Image attachment */}
                {message.message_type === 'image' && message.media_url && (() => {
                  const imgUrl = `${API_URL}${message.media_url}`
                  const imgFilename = message.media_url.split('/').pop() || 'image'
                  return (
                    <div>
                      <a href={imgUrl} target="_blank" rel="noreferrer">
                        <img
                          src={imgUrl}
                          alt={message.message_text}
                          className="rounded-lg max-w-full mb-1 max-h-48 object-cover"
                        />
                      </a>
                      <div className={`flex items-center justify-between gap-2 pt-0.5 ${message.is_sent ? 'text-blue-100' : 'text-gray-500'}`}>
                        <span className="text-xs">
                          {fmtMsgTime(message.timestamp)}
                        </span>
                        <button
                          onClick={async () => {
                            try {
                              const res = await fetch(imgUrl)
                              const blob = await res.blob()
                              const a = document.createElement('a')
                              a.href = URL.createObjectURL(blob)
                              a.download = imgFilename
                              a.click()
                            } catch { window.open(imgUrl, '_blank') }
                          }}
                          className="text-xs underline font-medium flex items-center gap-0.5 cursor-pointer"
                        >
                          ⬇ Download
                        </button>
                        {!!message.is_sent && <DeliveryTick status={message.delivery_status} />}
                      </div>
                    </div>
                  )
                })()}
                {/* File attachment */}
                {message.message_type === 'file' && message.media_url && (() => {
                  const ext = message.media_url.split('.').pop()?.toLowerCase() ?? ''
                  const browserFriendly = ['pdf','jpg','jpeg','png','gif','webp','svg','mp4','webm','ogg','mp3','wav','txt','csv'].includes(ext)
                  const fileUrl = `${API_URL}${message.media_url}`
                  const filename = message.message_text || message.media_url.split('/').pop() || 'file'
                  return (
                    <>
                      <div className="flex items-center gap-2">
                        <FiFile size={16} className="flex-shrink-0" />
                        <span className="break-all flex-1 text-sm">{filename}</span>
                      </div>
                      <div className={`flex items-center gap-3 mt-1.5 text-xs font-medium ${message.is_sent ? 'text-blue-100' : 'text-blue-600'}`}>
                        {browserFriendly && (
                          <a href={fileUrl} target="_blank" rel="noreferrer" className="underline opacity-80 hover:opacity-100">
                            Open
                          </a>
                        )}
                        <button
                          onClick={async () => {
                            try {
                              const res = await fetch(fileUrl)
                              const blob = await res.blob()
                              const a = document.createElement('a')
                              a.href = URL.createObjectURL(blob)
                              a.download = filename
                              a.click()
                            } catch { window.open(fileUrl, '_blank') }
                          }}
                          className="underline flex items-center gap-0.5 cursor-pointer"
                        >
                          ⬇ Download
                        </button>
                      </div>
                      <p className={`text-xs mt-1 ${message.is_sent ? 'text-blue-100' : 'text-gray-500'}`}>
                        {fmtMsgTime(message.timestamp)}
                        {!!message.is_sent && <DeliveryTick status={message.delivery_status} />}
                      </p>
                    </>
                  )
                })()}
                {/* Email message rendering */}
                {message.message_type === 'email' && (
                  <>
                    {message.subject && (
                      <p className={`text-xs font-semibold mb-1 ${message.is_sent ? 'text-blue-100' : 'text-gray-500'}`}>
                        📧 {message.subject}
                      </p>
                    )}
                    <p className="break-words whitespace-pre-wrap">{message.message_text}</p>
                    <p className={`text-xs mt-1 ${message.is_sent ? 'text-blue-100' : 'text-gray-500'}`}>
                      {fmtMsgTime(message.timestamp)}
                    </p>
                  </>
                )}
                {/* Text (always show for text messages; captions for attachments) */}
                {(message.message_type === 'text' || (message.message_type !== 'email' && message.message_type !== 'image' && message.message_type !== 'file' && !message.media_url)) && (() => {
                  const url = extractUrl(message.message_text)
                  const preview = url ? linkPreviews[url] : null
                  return (
                    <>
                      <p className="break-words">{message.message_text}</p>
                      <p className={`text-xs mt-1 ${message.is_sent ? 'text-blue-100' : 'text-gray-500'}`}>
                        {fmtMsgTime(message.timestamp)}
                        {!!message.is_sent && <DeliveryTick status={message.delivery_status} />}
                      </p>
                      {preview && (
                        <a href={preview.url} target="_blank" rel="noreferrer"
                          className={`mt-2 block rounded-xl overflow-hidden border text-left no-underline ${
                            message.is_sent ? 'border-white/20 bg-white/10' : 'border-gray-200 bg-gray-50'
                          }`}>
                          {preview.image && (
                            <img src={preview.image} alt=""
                              onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
                              className="w-full object-cover" style={{ maxHeight: '120px' }} />
                          )}
                          <div className="px-2 py-1.5">
                            {preview.domain && (
                              <p className={`text-[9px] font-medium uppercase tracking-wide ${
                                message.is_sent ? 'text-blue-200' : 'text-blue-500'
                              }`}>{preview.domain}</p>
                            )}
                            {preview.title && (
                              <p className={`text-xs font-semibold leading-tight line-clamp-2 ${
                                message.is_sent ? 'text-white' : 'text-gray-800'
                              }`}>{preview.title}</p>
                            )}
                            {preview.description && (
                              <p className={`text-[10px] leading-tight line-clamp-2 mt-0.5 ${
                                message.is_sent ? 'text-blue-100' : 'text-gray-500'
                              }`}>{preview.description}</p>
                            )}
                          </div>
                        </a>
                      )}
                    </>
                  )
                })()}
              </div>
            </div>
              )
            })}
          </>
        )}
        {/* Visitor typing indicator */}
        {visitorTyping && conversation.platform === 'webchat' && (
          <div className="flex justify-start">
            <div className="message-bubble message-received bg-gray-200 text-gray-500 py-2.5 px-4">
              <div className="flex gap-1 items-center h-4">
                <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
              </div>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Message Input */}
      <div className="border-t px-6 py-4">
        {/* Pending file preview */}
        {pendingFile && (
          <div className="mb-2 flex items-center gap-2 px-3 py-2 bg-blue-50 border border-blue-200 rounded-lg text-sm text-blue-800">
            <FiFile size={16} />
            <span className="flex-1 truncate">{pendingFile.name}</span>
            <button onClick={() => setPendingFile(null)} className="text-blue-500 hover:text-blue-700">
              <FiX size={16} />
            </button>
          </div>
        )}
        <div className="flex gap-3">
          {/* Hidden file input */}
          <input
            ref={fileInputRef}
            type="file"
            accept={allowedTypes.join(',')}
            onChange={handleFileSelect}
            className="hidden"
          />
          {/* Paperclip button */}
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={sending}
            title={`Attach file (max ${maxFileMb} MB)`}
            className="text-gray-500 hover:text-blue-600 disabled:opacity-40 px-2 transition"
          >
            <FiPaperclip size={20} />
          </button>
          <textarea
            value={messageText}
            onChange={(e) => {
              setMessageText(e.target.value)
              e.target.style.height = 'auto'
              e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px'
              // Send agent typing indicator to visitor
              if (conversation?.platform === 'webchat') {
                const token = getAuthToken()
                const headers = token ? { Authorization: `Bearer ${token}` } : {}
                axios.post(`${API_URL}/webchat/typing/${conversation.id}`, null, { params: { is_typing: true }, headers }).catch(() => {})
                if (agentTypingTimer.current) clearTimeout(agentTypingTimer.current)
                agentTypingTimer.current = setTimeout(() => {
                  axios.post(`${API_URL}/webchat/typing/${conversation.id}`, null, { params: { is_typing: false }, headers }).catch(() => {})
                }, 2000)
              }
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                handleSendMessage()
              }
            }}
            placeholder={pendingFile ? 'Add a caption (optional)…' : 'Type a message...'}
            className="flex-1 p-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none overflow-hidden"
            style={{ minHeight: '46px', maxHeight: '120px' }}
            rows={1}
            spellCheck={true}
            autoCorrect="on"
            autoCapitalize="sentences"
            disabled={sending}
          />
          <button
            onClick={handleSendMessage}
            disabled={sending || (!messageText.trim() && !pendingFile)}
            className="bg-blue-500 hover:bg-blue-600 disabled:bg-gray-400 text-white px-4 py-3 rounded-lg flex items-center gap-2 transition"
          >
            <FiSend size={18} />
          </button>
        </div>
      </div>

      {/* Convert to Lead modal */}
      {showLeadModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[100]" onClick={() => setShowLeadModal(false)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6" onClick={e => e.stopPropagation()}>
            <h2 className="text-lg font-bold mb-1">Convert to CRM Lead</h2>
            <p className="text-sm text-gray-500 mb-4">Create a lead record from this conversation.</p>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">First name *</label>
                  <input
                    type="text"
                    value={leadForm.first_name}
                    onChange={e => setLeadForm({ ...leadForm, first_name: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
                    placeholder="First"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Last name</label>
                  <input
                    type="text"
                    value={leadForm.last_name}
                    onChange={e => setLeadForm({ ...leadForm, last_name: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
                    placeholder="Last"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Email</label>
                <input
                  type="email"
                  value={leadForm.email}
                  onChange={e => setLeadForm({ ...leadForm, email: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
                  placeholder="email@example.com"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Phone</label>
                  <input
                    type="text"
                    value={leadForm.phone}
                    onChange={e => setLeadForm({ ...leadForm, phone: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
                    placeholder="+1 555 0000"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Company</label>
                  <input
                    type="text"
                    value={leadForm.company}
                    onChange={e => setLeadForm({ ...leadForm, company: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
                    placeholder="Acme Inc."
                  />
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-5">
              <button onClick={() => setShowLeadModal(false)} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">Cancel</button>
              <button
                onClick={handleConvertToLead}
                disabled={!leadForm.first_name.trim() || leadLoading}
                className="px-4 py-2 text-sm bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50"
              >
                {leadLoading ? "Creating…" : "Create Lead"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Forward-to-agent modal — captures handover reason before confirming assignment */}
      {assignModal.show && (
        <div
          className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center"
          onClick={() => setAssignModal({ ...assignModal, show: false })}
        >
          <div
            className="bg-white rounded-xl shadow-xl p-6 w-96 max-w-full mx-4"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="font-bold text-lg text-gray-800 mb-1">Forward conversation</h3>
            <p className="text-sm text-gray-500 mb-4">
              Assigning to <strong>{assignModal.targetName}</strong>
            </p>
            <textarea
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 resize-none"
              rows={3}
              placeholder="Reason for forwarding — agent will see this as a note in the chat (optional)"
              value={assignModal.note}
              onChange={(e) => setAssignModal({ ...assignModal, note: e.target.value })}
              autoFocus
            />
            <div className="flex gap-2 mt-4 justify-end">
              <button
                onClick={() => setAssignModal({ ...assignModal, show: false })}
                className="px-4 py-2 text-sm text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200 transition"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  handleAssign(assignModal.targetId, assignModal.note, assignModal.targetTeamId)
                  setAssignModal({ ...assignModal, show: false })
                }}
                className="px-4 py-2 text-sm text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 font-semibold transition"
              >
                Forward
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
