'use client'

import { useState, useEffect, Suspense } from 'react'
import { useRouter } from 'next/navigation'
import { authAPI } from '@/lib/auth'
import MainHeader from '@/components/MainHeader'
import AdminNav from '@/components/AdminNav'
import MyDayTab from '@/components/daily-ops/MyDayTab'
import TeamStandupsTab from '@/components/daily-ops/TeamStandupsTab'
import CommandCenterTab from '@/components/daily-ops/CommandCenterTab'

type Tab = 'my-day' | 'standups' | 'command-center'

export default function DailyOpsPageWrapper() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center h-screen bg-gray-50"><div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500"></div></div>}>
      <DailyOpsPage />
    </Suspense>
  )
}

function DailyOpsPage() {
  const router = useRouter()
  const [user, setUser] = useState<any>(null)
  const [isMounted, setIsMounted] = useState(false)
  const [activeTab, setActiveTab] = useState<Tab>('my-day')
  const [selectedDate, setSelectedDate] = useState(() => new Date().toISOString().split('T')[0])

  useEffect(() => {
    setIsMounted(true)
    const userData = authAPI.getUser()
    if (!userData) { router.push('/login'); return }
    setUser(userData)
  }, [])

  if (!isMounted || !user) return null

  const tabs: { key: Tab; label: string }[] = [
    { key: 'my-day', label: 'My Day' },
    { key: 'standups', label: 'Team Standups' },
    { key: 'command-center', label: 'Command Center' },
  ]

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <MainHeader user={user} />
      <AdminNav />
      <div className="ml-0 md:ml-60 pt-14 pb-16 md:pb-0">
        <div className="max-w-6xl mx-auto px-4 py-6">
          {/* Header */}
          <div className="flex items-center justify-between mb-6">
            <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Daily Ops</h1>
            {activeTab !== 'command-center' && (
              <input
                type="date"
                value={selectedDate}
                onChange={e => setSelectedDate(e.target.value)}
                className="rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            )}
          </div>

          {/* Tab Navigation */}
          <div className="flex border-b border-gray-200 dark:border-gray-700 mb-6">
            {tabs.map(tab => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === tab.key
                    ? 'border-blue-600 text-blue-600 dark:text-blue-400'
                    : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Tab Content */}
          {activeTab === 'my-day' && <MyDayTab selectedDate={selectedDate} />}
          {activeTab === 'standups' && <TeamStandupsTab selectedDate={selectedDate} />}
          {activeTab === 'command-center' && <CommandCenterTab />}
        </div>
      </div>
    </div>
  )
}
