'use client'

import { useEffect, useState, useCallback, useRef, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { FiArrowLeft } from 'react-icons/fi'

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
import { FiSearch } from 'react-icons/fi'
import { authAPI, getAuthToken, type User } from '@/lib/auth'
import MainHeader from '@/components/MainHeader'
import ConversationList from '@/components/ConversationList'
import ChatWindow from '@/components/ChatWindow'
import PlatformFilter from '@/components/PlatformFilter'
// import { useBranding } from '@/lib/branding-context'
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
  platform_account_id?: number | null
  widget_domain_id?: number | null
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
    (searchParams.get('tab') as 'messaging' | 'email') || 'messaging'
  )
  const [toasts, setToasts] = useState<{ id: number; text: string }[]>([])
  const [activeConvIds, setActiveConvIds] = useState<Set<number>>(new Set())
  const [mobileShowChat, setMobileShowChat] = useState(false)
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [mineOnly, setMineOnly] = useState(false)
  const [unassignedOnly, setUnassignedOnly] = useState(false)
  const [accountMap, setAccountMap] = useState<Record<number, string>>({})
  const [accountFilter, setAccountFilter] = useState<string>('')
  const [widgetDomains, setWidgetDomains] = useState<any[]>([])
  const [domainFilter, setDomainFilter] = useState<string>('')
  const [badgeCounts, setBadgeCounts] = useState<{ unassigned: number; pending: number }>({ unassigned: 0, pending: 0 })
  const [searchQuery, setSearchQuery] = useState('')
  const searchRef = useRef('')
  const userRef = useRef<User | null>(null)
  const platformRef = useRef<string>('all')
  const statusFilterRef = useRef<string>('all')
  const mineOnlyRef = useRef(false)
  const unassignedOnlyRef = useRef(false)
  const accountFilterRef = useRef<string>('')
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
    // Fetch platform accounts for badge display and filtering
    const token = getAuthToken()
    if (token) {
      axios.get(`${API_URL}/admin/platform-accounts/`, {
        headers: { Authorization: `Bearer ${token}` }
      })
        .then((r) => {
          const map: Record<number, string> = {}
          r.data.forEach((a: { id: number; account_name: string }) => { map[a.id] = a.account_name })
          setAccountMap(map)
        })
        .catch(() => { /* non-admin agents may not have access */ })
      // Fetch widget domains for domain badges/filter
      axios.get(`${API_URL}/admin/widget-domains/`, {
        headers: { Authorization: `Bearer ${token}` }
      })
        .then((r) => setWidgetDomains(r.data || []))
        .catch(() => {})
    }
    // Fetch currently online webchat visitors
    axios.get(`${API_URL}/webchat/online-conversation-ids`)
      .then((r) => setActiveConvIds(new Set<number>(r.data.ids)))
      .catch(() => { })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router])

  const fetchBadgeCounts = useCallback(async (userId: number) => {
    try {
      const plat = platformRef.current
      const params: any = { user_id: userId }
      if (plat !== 'all') params.platform = plat
      const response = await axios.get(`${API_URL}/conversations/`, { params })
      const all: Conversation[] = response.data
      setBadgeCounts({
        unassigned: all.filter(c => !c.assigned_to).length,
        pending: all.filter(c => c.status === 'pending').length,
      })
    } catch { /* ignore */ }
  }, [])

  const fetchConversations = useCallback(async (userId: number, platform?: string, status?: string, mine?: boolean, unassigned?: boolean, accountId?: string) => {
    const plat = platform ?? platformRef.current
    const stat = status ?? statusFilterRef.current
    const myOnly = mine ?? mineOnlyRef.current
    const unassOnly = unassigned ?? unassignedOnlyRef.current
    const acctId = accountId ?? accountFilterRef.current
    setLoading(true)
    try {
      const params: any = { user_id: userId }
      if (plat !== 'all') params.platform = plat
      if (stat !== 'all') params.status = stat
      if (unassOnly) params.assigned_to = 'none'
      else if (myOnly) params.assigned_to = userId
      if (acctId) params.platform_account_id = acctId
      if (searchRef.current.trim()) params.search = searchRef.current.trim()
      const response = await axios.get(`${API_URL}/conversations/`, { params })
      setConversations(response.data)
      // Refresh badge counts alongside
      fetchBadgeCounts(userId)
    } catch (error) {
      console.error('Error fetching conversations:', error)
    } finally {
      setLoading(false)
    }
  }, [fetchBadgeCounts])

  // Sync activeTab when URL search params change (e.g. MobileBottomNav taps)
  useEffect(() => {
    const tabParam = searchParams.get('tab') as 'messaging' | 'email' | null
    const newTab = tabParam || 'messaging'
    if (newTab !== activeTab) {
      setActiveTab(newTab)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams])

  // Debounced search: re-fetch conversations 400ms after user stops typing
  useEffect(() => {
    searchRef.current = searchQuery
    const timer = setTimeout(() => {
      if (user) fetchConversations(user.user_id)
    }, 400)
    return () => clearTimeout(timer)
  }, [searchQuery]) // eslint-disable-line react-hooks/exhaustive-deps

  // Keep refs in sync with state for use inside event callbacks
  useEffect(() => { selectedConvRef.current = selectedConversation }, [selectedConversation])
  useEffect(() => { activeTabRef.current = activeTab }, [activeTab])

  // Hide bottom nav when chat is open on mobile
  useEffect(() => {
    if (mobileShowChat) {
      document.body.classList.add('mobile-chat-open')
    } else {
      document.body.classList.remove('mobile-chat-open')
    }
    return () => document.body.classList.remove('mobile-chat-open')
  }, [mobileShowChat])

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

  const handleAccountFilter = (value: string) => {
    setAccountFilter(value)
    accountFilterRef.current = value
    if (user) fetchConversations(user.user_id, undefined, undefined, undefined, undefined, value)
  }

  const domainMap = Object.fromEntries(widgetDomains.map((d: any) => [d.id, d.display_name]))

  const handleDomainFilter = (value: string) => {
    setDomainFilter(value)
    // Refetch conversations to apply domain filter on the server side
    if (user) fetchConversations(user.user_id)
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
        <div className="fixed bottom-20 md:bottom-6 left-6 z-50 flex flex-col gap-2 pointer-events-none">
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
      <div className="flex-1 overflow-hidden pt-14 pb-16 md:pb-0">
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
            <div className={`${mobileShowChat ? 'hidden' : 'flex'} md:flex w-full md:w-80 flex-col border-r border-gray-200`}>
              {/* Search bar */}
              <div className="px-3 pt-3 pb-1">
                <div className="relative">
                  <FiSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={14} />
                  <input
                    type="text"
                    placeholder="Search conversations..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full pl-9 pr-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-gray-50"
                  />
                </div>
              </div>
              <PlatformFilter
                selectedPlatform={selectedPlatform}
                onPlatformChange={handlePlatformChange}
              />
              {/* Filters */}
              <div className="border-b bg-white">
                {/* Assignment filter row */}
                <div className="flex overflow-x-auto gap-2 pb-2 -mx-3 px-3 md:mx-0 md:px-0 md:flex-wrap pt-2">
                  <button
                    onClick={() => { if (mineOnly || unassignedOnly) { setMineOnly(false); mineOnlyRef.current = false; setUnassignedOnly(false); unassignedOnlyRef.current = false; if (user) fetchConversations(user.user_id, undefined, undefined, false, false) } }}
                    className={`flex-shrink-0 md:flex-1 text-xs py-1.5 px-3 md:px-0 rounded font-semibold transition whitespace-nowrap ${!mineOnly && !unassignedOnly ? 'bg-gray-700 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                      }`}
                  >
                    All agents
                  </button>
                  <button
                    onClick={handleMineToggle}
                    className={`flex-shrink-0 md:flex-1 text-xs py-1.5 px-3 md:px-0 rounded font-semibold transition whitespace-nowrap ${mineOnly ? 'text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
                    style={mineOnly ? { backgroundColor: 'var(--button-primary)' } : {}}
                  >
                    Mine
                  </button>
                  <button
                    onClick={handleUnassignedToggle}
                    className={`flex-shrink-0 md:flex-1 text-xs py-1.5 px-3 md:px-0 rounded font-semibold transition whitespace-nowrap flex items-center justify-center gap-1 ${unassignedOnly ? 'bg-orange-500 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                      }`}
                  >
                    Unassigned
                    {badgeCounts.unassigned > 0 && (
                      <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${unassignedOnly ? 'bg-white text-orange-600' : 'bg-orange-500 text-white'}`}>{badgeCounts.unassigned}</span>
                    )}
                  </button>
                </div>
                {/* Status filter */}
                <div className="flex overflow-x-auto gap-2 pb-2 -mx-3 px-3 md:mx-0 md:px-0 md:flex-wrap">
                  {(['all', 'open', 'pending', 'resolved'] as const).map((s) => (
                    <button
                      key={s}
                      onClick={() => handleStatusFilter(s)}
                      className={`flex-1 text-xs py-1 rounded font-medium capitalize transition flex items-center justify-center gap-1 ${statusFilter === s ? 'text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
                      style={statusFilter === s ? { backgroundColor: s === 'open' ? 'var(--primary-color)' : s === 'pending' ? 'var(--accent-color)' : s === 'resolved' ? 'var(--secondary-color)' : 'var(--sidebar-bg)' } : {}}
                    >
                      {s === 'all' ? 'All' : s.charAt(0).toUpperCase() + s.slice(1)}
                      {s === 'pending' && badgeCounts.pending > 0 && (
                        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${statusFilter === 'pending' ? 'bg-white text-orange-600' : 'bg-orange-500 text-white'}`}>{badgeCounts.pending}</span>
                      )}
                    </button>
                  ))}
                </div>
                {/* Account filter */}
                {Object.keys(accountMap).length > 0 && (
                  <div className="px-3 pb-2">
                    <select
                      value={accountFilter}
                      onChange={(e) => handleAccountFilter(e.target.value)}
                      className="w-full px-2 py-1.5 border rounded text-xs text-gray-700 bg-white"
                    >
                      <option value="">All Accounts</option>
                      {Object.entries(accountMap).map(([id, name]) => (
                        <option key={id} value={id}>{name}</option>
                      ))}
                    </select>
                  </div>
                )}
                {widgetDomains.length > 0 && (
                  <div className="px-3 pb-2">
                    <select
                      value={domainFilter}
                      onChange={(e) => handleDomainFilter(e.target.value)}
                      className="w-full px-2 py-1.5 border rounded text-xs text-gray-700 bg-white"
                    >
                      <option value="">All Domains</option>
                      {widgetDomains.map((d: any) => (
                        <option key={d.id} value={d.id}>{d.display_name || d.domain}</option>
                      ))}
                    </select>
                  </div>
                )}
              </div>
              <ConversationList
                conversations={conversations}
                selectedConversation={selectedConversation}
                onSelectConversation={(conv) => { setSelectedConversation(conv); setMobileShowChat(true) }}
                loading={loading}
                activeConvIds={activeConvIds}
                accountMap={accountMap}
                domainMap={domainMap}
                domainFilter={domainFilter}
              />
            </div>
            {/* Chat */}
            <div className={`${mobileShowChat ? 'flex' : 'hidden'} md:flex flex-1 flex-col`}>
              {mobileShowChat && (
                <div className="flex md:hidden items-center gap-2 px-3 py-2 border-b bg-white">
                  <button
                    onClick={() => { setMobileShowChat(false) }}
                    className="p-2 -ml-2 rounded-lg hover:bg-gray-100"
                  >
                    <FiArrowLeft size={20} />
                  </button>
                  <span className="font-semibold truncate">
                    {selectedConversation?.contact_name || 'Chat'}
                  </span>
                </div>
              )}
              <ChatWindow
                conversation={selectedConversation}
                onRefresh={() => user && fetchConversations(user.user_id)}
              />
            </div>
          </main>
        )}
      </div>
    </div>
  )
}
