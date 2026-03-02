'use client'

import { useEffect, useState, useCallback, useRef, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'

function playNotificationSound() {
  try {
    const ctx = new ((window as any).AudioContext || (window as any).webkitAudioContext)()
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
  } catch { }
}
import axios from 'axios'
import { authAPI, type User } from '@/lib/auth'
import MainHeader from '@/components/MainHeader'
import ConversationList from '@/components/ConversationList'
import ChatWindow from '@/components/ChatWindow'
import PlatformFilter from '@/components/PlatformFilter'
import { useBranding } from '@/lib/branding-context'
import { useEvents, type EventMessage } from '@/lib/events-context'
import { API_URL } from '@/lib/config';

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

export default function DashboardPageWrapper() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center h-screen bg-gray-50"><div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500"></div></div>}>
      <DashboardPage />
    </Suspense>
  )
}

function DashboardPage() {
  const router = useRouter()
  const { subscribe } = useEvents()
  const [user, setUser] = useState<User | null>(null)
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [selectedConversation, setSelectedConversation] = useState<Conversation | null>(null)
  const [selectedPlatform, setSelectedPlatform] = useState('all')
  const [loading, setLoading] = useState(false)
  const searchParams = useSearchParams()
  const [activeTab, setActiveTab] = useState<'messaging' | 'email'>(
    (searchParams.get('tab') as 'messaging' | 'email') || 'email'
  )
  const [toasts, setToasts] = useState<{ id: number; text: string }[]>([])
  const [activeConvIds, setActiveConvIds] = useState<Set<number>>(new Set())
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [mineOnly, setMineOnly] = useState(false)
  const [unassignedOnly, setUnassignedOnly] = useState(false)
  const userRef = useRef<User | null>(null)
  const platformRef = useRef<string>('all')
  const statusFilterRef = useRef<string>('all')
  const mineOnlyRef = useRef(false)
  const unassignedOnlyRef = useRef(false)
  const toastIdRef = useRef(0)
  const selectedConvRef = useRef<Conversation | null>(null)
  const activeTabRef = useRef<'messaging' | 'email'>('email')

  useEffect(() => {
    const currentUser = authAPI.getUser()
    if (!currentUser) {
      router.push('/login')
      return
    }
    setUser(currentUser)
    userRef.current = currentUser
    fetchConversations(currentUser.user_id)
    // Fetch currently online webchat visitors
    axios.get(`${API_URL}/webchat/online-conversation-ids`)
      .then((r) => setActiveConvIds(new Set<number>(r.data.ids)))
      .catch(() => { })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router])

  const fetchConversations = useCallback(async (userId: number, platform?: string, status?: string, mine?: boolean, unassigned?: boolean) => {
    const plat = platform ?? platformRef.current
    const stat = status ?? statusFilterRef.current
    const myOnly = mine ?? mineOnlyRef.current
    const unassOnly = unassigned ?? unassignedOnlyRef.current
    setLoading(true)
    try {
      const params: any = { user_id: userId }
      if (plat !== 'all') params.platform = plat
      if (stat !== 'all') params.status = stat
      if (unassOnly) params.assigned_to = 'none'
      else if (myOnly) params.assigned_to = userId
      const response = await axios.get(`${API_URL}/conversations/`, { params })
      setConversations(response.data)
    } catch (error) {
      console.error('Error fetching conversations:', error)
    } finally {
      setLoading(false)
    }
  }, [])

  // Keep refs in sync with state for use inside event callbacks
  useEffect(() => { selectedConvRef.current = selectedConversation }, [selectedConversation])
  useEffect(() => { activeTabRef.current = activeTab }, [activeTab])

  // Track which webchat visitors are currently online
  useEffect(() => {
    const unsubOn = subscribe('webchat_visitor_online', (ev) => {
      setActiveConvIds((prev) => { const s = new Set(prev); s.add(ev.data.conversation_id); return s })
    })
    const unsubOff = subscribe('webchat_visitor_offline', (ev) => {
      setActiveConvIds((prev) => { const s = new Set(prev); s.delete(ev.data.conversation_id); return s })
    })
    // Re-sync on every backend reconnect (backend restart wipes connections without sending offline events)
    const unsubReconnect = subscribe('connection_established', () => {
      if (userRef.current) fetchConversations(userRef.current.user_id)
      axios.get(`${API_URL}/webchat/online-conversation-ids`)
        .then((r) => setActiveConvIds(new Set<number>(r.data.ids)))
        .catch(() => { })
    })
    // Periodic safety-net poll every 30s to catch any missed events
    const pollInterval = setInterval(() => {
      axios.get(`${API_URL}/webchat/online-conversation-ids`)
        .then((r) => setActiveConvIds(new Set<number>(r.data.ids)))
        .catch(() => { })
    }, 30000)
    return () => { unsubOn(); unsubOff(); unsubReconnect(); clearInterval(pollInterval) }
  }, [subscribe, fetchConversations])

  // Auto-refresh + sound/toast on new incoming messages
  useEffect(() => {
    const refresh = () => { if (userRef.current) fetchConversations(userRef.current.user_id) }
    const notify = (ev: EventMessage) => {
      refresh()
      const incomingConvId = ev.data?.conversation_id
      const isViewing =
        activeTabRef.current === 'messaging' &&
        selectedConvRef.current?.id === incomingConvId
      if (!isViewing) {
        playNotificationSound()
        const name = ev.data?.visitor_name || ev.data?.sender_name || 'Someone'
        const id = ++toastIdRef.current
        setToasts((prev) => [...prev, { id, text: `New message from ${name}` }])
        setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 5000)
      }
    }
    const unsubReceived = subscribe('message_received', notify)
    const unsubWebchat = subscribe('webchat_visitor_online', refresh)
    return () => { unsubReceived(); unsubWebchat() }
  }, [subscribe, fetchConversations])

  const handlePlatformChange = (platform: string) => {
    setSelectedPlatform(platform)
    platformRef.current = platform
    if (user) fetchConversations(user.user_id, platform)
  }

  const handleStatusFilter = (status: string) => {
    setStatusFilter(status)
    statusFilterRef.current = status
    if (user) fetchConversations(user.user_id, undefined, status)
  }

  const handleMineToggle = () => {
    const next = !mineOnly
    setMineOnly(next)
    mineOnlyRef.current = next
    if (next) { setUnassignedOnly(false); unassignedOnlyRef.current = false }
    if (user) fetchConversations(user.user_id, undefined, undefined, next, false)
  }

  const handleUnassignedToggle = () => {
    const next = !unassignedOnly
    setUnassignedOnly(next)
    unassignedOnlyRef.current = next
    if (next) { setMineOnly(false); mineOnlyRef.current = false }
    if (user) fetchConversations(user.user_id, undefined, undefined, false, next)
  }

  if (!user) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-50">
        <div className="text-center">
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 mx-auto mb-3" style={{ borderBottomColor: 'var(--primary-color)' }}></div>
          <p className="text-gray-500 text-sm">Loading...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="h-screen flex flex-col bg-gray-50">
      {/* Toast notifications (bottom-left) */}
      {toasts.length > 0 && (
        <div className="fixed bottom-6 left-6 z-50 flex flex-col gap-2 pointer-events-none">
          {toasts.map((t) => (
            <div
              key={t.id}
              className="pointer-events-auto flex items-center gap-3 bg-gray-900 text-white px-4 py-3 rounded-xl shadow-lg text-sm max-w-xs"
            >
              <span className="w-2 h-2 rounded-full bg-green-400 flex-shrink-0 animate-pulse" />
              <span className="flex-1">{t.text}</span>
              <button
                onClick={() => setToasts((prev) => prev.filter((t2) => t2.id !== t.id))}
                className="text-gray-400 hover:text-white ml-1"
              >✕</button>
            </div>
          ))}
        </div>
      )}
      <MainHeader user={user} activeTab={activeTab} setActiveTab={setActiveTab} />

      {/* Tab content */}
      <div className="flex-1 overflow-hidden pt-14">
        {activeTab === 'email' ? (
          // Email: full-screen iframe so the email page renders with all its functionality
          <iframe
            src="/email"
            className="w-full h-full border-0"
            title="Email"
          />
        ) : (
          // Messaging
          <main className="flex h-full bg-white">
            {/* Sidebar */}
            <div className="w-80 flex flex-col border-r border-gray-200">
              <PlatformFilter
                selectedPlatform={selectedPlatform}
                onPlatformChange={handlePlatformChange}
              />
              {/* Filters */}
              <div className="border-b bg-white">
                {/* Assignment filter row */}
                <div className="px-3 pt-2 pb-1 flex gap-1">
                  <button
                    onClick={() => { if (mineOnly || unassignedOnly) { setMineOnly(false); mineOnlyRef.current = false; setUnassignedOnly(false); unassignedOnlyRef.current = false; if (user) fetchConversations(user.user_id, undefined, undefined, false, false) } }}
                    className={`flex-1 text-xs py-1.5 rounded font-semibold transition ${!mineOnly && !unassignedOnly ? 'bg-gray-700 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                      }`}
                  >
                    All agents
                  </button>
                  <button
                    onClick={handleMineToggle}
                    className={`flex-1 text-xs py-1.5 rounded font-semibold transition ${mineOnly ? 'text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
                    style={mineOnly ? { backgroundColor: 'var(--button-primary)' } : {}}
                  >
                    Mine
                  </button>
                  <button
                    onClick={handleUnassignedToggle}
                    className={`flex-1 text-xs py-1.5 rounded font-semibold transition flex items-center justify-center gap-1 ${unassignedOnly ? 'bg-orange-500 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                      }`}
                  >
                    Unassigned
                    {(() => {
                      const n = conversations.filter(c => !c.assigned_to && c.unread_count > 0).length
                      return n > 0 ? (
                        <span className={`text-[10px] font-bold px-1 rounded-full ${unassignedOnly ? 'bg-white text-orange-600' : 'bg-orange-500 text-white'}`}>{n}</span>
                      ) : null
                    })()}
                  </button>
                </div>
                {/* Status filter */}
                <div className="px-3 pb-2 flex gap-1">
                  {(['all', 'open', 'pending', 'resolved'] as const).map((s) => (
                    <button
                      key={s}
                      onClick={() => handleStatusFilter(s)}
                      className={`flex-1 text-xs py-1 rounded font-medium capitalize transition ${statusFilter === s ? 'text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
                      style={statusFilter === s ? { backgroundColor: s === 'open' ? 'var(--primary-color)' : s === 'pending' ? 'var(--accent-color)' : s === 'resolved' ? 'var(--secondary-color)' : 'var(--sidebar-bg)' } : {}}
                    >
                      {s === 'all' ? 'All' : s.charAt(0).toUpperCase() + s.slice(1)}
                    </button>
                  ))}
                </div>
              </div>
              <ConversationList
                conversations={conversations}
                selectedConversation={selectedConversation}
                onSelectConversation={setSelectedConversation}
                loading={loading}
                activeConvIds={activeConvIds}
              />
            </div>
            {/* Chat */}
            <ChatWindow
              conversation={selectedConversation}
              onRefresh={() => user && fetchConversations(user.user_id)}
            />
          </main>
        )}
      </div>
    </div>
  )
}
