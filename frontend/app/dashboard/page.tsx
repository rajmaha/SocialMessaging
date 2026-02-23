'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import axios from 'axios'
import { authAPI, type User } from '@/lib/auth'
import ConversationList from '@/components/ConversationList'
import ChatWindow from '@/components/ChatWindow'
import PlatformFilter from '@/components/PlatformFilter'
import ProfileDropdown from '@/components/ProfileDropdown'
import { useBranding } from '@/lib/branding-context'
import { useEvents } from '@/lib/events-context'
import { FiMessageSquare, FiMail } from 'react-icons/fi'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

interface Conversation {
  id: number
  platform: string
  contact_name: string
  contact_id: string
  last_message: string | null
  last_message_time: string | null
  unread_count: number
  contact_avatar: string | null
}

export default function DashboardPage() {
  const router = useRouter()
  const brandingCtx = useBranding()
  const branding = brandingCtx?.branding
  const { subscribe } = useEvents()
  const [user, setUser] = useState<User | null>(null)
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [selectedConversation, setSelectedConversation] = useState<Conversation | null>(null)
  const [selectedPlatform, setSelectedPlatform] = useState('all')
  const [loading, setLoading] = useState(false)
  const [activeTab, setActiveTab] = useState<'messaging' | 'email'>('email')
  const [localLogo, setLocalLogo] = useState<string | null>(null)
  const userRef = useRef<User | null>(null)
  const platformRef = useRef<string>('all')

  useEffect(() => {
    const currentUser = authAPI.getUser()
    if (!currentUser) {
      router.push('/login')
      return
    }
    setUser(currentUser)
    userRef.current = currentUser
    fetchConversations(currentUser.user_id)
    const saved = localStorage.getItem('companyLogo')
    if (saved) setLocalLogo(saved)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router])

  const logoSrc = branding?.logo_url || localLogo

  const fetchConversations = useCallback(async (userId: number, platform?: string) => {
    const plat = platform ?? platformRef.current
    setLoading(true)
    try {
      const params: any = { user_id: userId }
      if (plat !== 'all') params.platform = plat
      const response = await axios.get(`${API_URL}/conversations/`, { params })
      setConversations(response.data)
    } catch (error) {
      console.error('Error fetching conversations:', error)
    } finally {
      setLoading(false)
    }
  }, [])

  // Auto-refresh conversation list on new incoming messages
  useEffect(() => {
    const refresh = () => { if (userRef.current) fetchConversations(userRef.current.user_id) }
    const unsubReceived = subscribe('message_received', refresh)
    const unsubWebchat = subscribe('webchat_visitor_online', refresh)
    return () => { unsubReceived(); unsubWebchat() }
  }, [subscribe, fetchConversations])

  const handlePlatformChange = (platform: string) => {
    setSelectedPlatform(platform)
    platformRef.current = platform
    if (user) fetchConversations(user.user_id, platform)
  }

  if (!user) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-50">
        <div className="text-center">
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-500 mx-auto mb-3"></div>
          <p className="text-gray-500 text-sm">Loading...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="h-screen flex flex-col bg-gray-50">
      {/* Top bar */}
      <header className="bg-white border-b border-gray-200 flex items-center justify-between px-6 h-14 flex-shrink-0">
        {/* Left: brand + tabs */}
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2">
            {logoSrc ? (
              <img src={logoSrc} alt="Company logo" className="h-7 w-auto object-contain" />
            ) : (
              <span className="text-xl">📬</span>
            )}
            <span className="text-lg font-bold text-gray-800 tracking-tight">
              {branding?.company_name || 'WorkSpace'}
            </span>
          </div>

          {/* Tabs */}
          <nav className="flex items-center gap-1">
            <button
              onClick={() => setActiveTab('email')}
              className={`flex items-center gap-2 px-4 py-1.5 rounded-lg text-sm font-semibold transition ${
                activeTab === 'email'
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'text-gray-600 hover:bg-gray-100'
              }`}
            >
              <FiMail size={15} />
              Email
            </button>
            <button
              onClick={() => setActiveTab('messaging')}
              className={`flex items-center gap-2 px-4 py-1.5 rounded-lg text-sm font-semibold transition ${
                activeTab === 'messaging'
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'text-gray-600 hover:bg-gray-100'
              }`}
            >
              <FiMessageSquare size={15} />
              Messaging
            </button>
          </nav>
        </div>

        {/* Right: profile dropdown */}
        <div className="flex items-center">
          <ProfileDropdown user={user} />
        </div>
      </header>

      {/* Tab content */}
      <div className="flex-1 overflow-hidden">
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
              <ConversationList
                conversations={conversations}
                selectedConversation={selectedConversation}
                onSelectConversation={setSelectedConversation}
                loading={loading}
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
