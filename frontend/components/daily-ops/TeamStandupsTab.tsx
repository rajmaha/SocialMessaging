'use client'

import { useState, useEffect } from 'react'
import { dailyOpsApi, api } from '@/lib/api'
import { authAPI } from '@/lib/auth'
import { useEvents } from '@/lib/events-context'
import StandupForm from './StandupForm'

interface Standup {
  id: number
  user_id: number
  user_name: string
  user_avatar?: string | null
  date: string
  yesterday: string
  today: string
  blockers?: string | null
  created_at: string
}

interface TeamUser {
  id: number
  full_name?: string
  display_name?: string
  email: string
}

interface TeamStandupsTabProps {
  selectedDate: string
}

export default function TeamStandupsTab({ selectedDate }: TeamStandupsTabProps) {
  const [standups, setStandups] = useState<Standup[]>([])
  const [allUsers, setAllUsers] = useState<TeamUser[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editStandup, setEditStandup] = useState<Standup | null>(null)

  const currentUser = authAPI.getUser()
  const { subscribe } = useEvents()

  const fetchStandups = async () => {
    try {
      const res = await dailyOpsApi.getStandups(selectedDate)
      setStandups(res.data || [])
    } catch (err) {
      console.error('Failed to load standups:', err)
    } finally {
      setLoading(false)
    }
  }

  // Fetch all users to show "not yet posted" indicator
  useEffect(() => {
    const fetchUsers = async () => {
      try {
        const res = await api.get('/admin/users')
        setAllUsers(res.data || [])
      } catch {
        // Non-admin users may not have access — silently ignore
      }
    }
    fetchUsers()
  }, [])

  useEffect(() => {
    setLoading(true)
    fetchStandups()
  }, [selectedDate])

  // SSE: listen for real-time standup updates from teammates
  useEffect(() => {
    const unsub1 = subscribe('standup_posted', () => {
      fetchStandups()
    })
    const unsub2 = subscribe('standup_deleted', () => {
      fetchStandups()
    })
    return () => { unsub1(); unsub2() }
  }, [subscribe, selectedDate])

  const myStandup = standups.find(s => s.user_id === currentUser?.user_id)
  const isToday = selectedDate === new Date().toISOString().split('T')[0]

  // Compute who hasn't posted yet
  const postedUserIds = new Set(standups.map(s => s.user_id))
  const notPosted = allUsers.filter(u => !postedUserIds.has(u.id))

  const handleDelete = async (id: number) => {
    if (!confirm('Delete your standup?')) return
    try {
      await dailyOpsApi.deleteStandup(id)
      fetchStandups()
    } catch (err) {
      console.error('Failed to delete standup:', err)
    }
  }

  const handleSaved = () => {
    setShowForm(false)
    setEditStandup(null)
    fetchStandups()
  }

  if (loading) {
    return <div className="flex justify-center py-12 text-gray-400">Loading standups...</div>
  }

  return (
    <div className="space-y-4">
      {/* Post / Edit Button */}
      {isToday && (
        <div className="flex justify-end">
          {myStandup ? (
            <button
              onClick={() => { setEditStandup(myStandup); setShowForm(true) }}
              className="px-4 py-2 text-sm bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600"
            >
              ✏️ Edit My Standup
            </button>
          ) : (
            <button
              onClick={() => { setEditStandup(null); setShowForm(true) }}
              className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700"
            >
              📝 Post My Standup
            </button>
          )}
        </div>
      )}

      {/* Standup Cards */}
      {standups.length === 0 ? (
        <div className="text-center py-12 text-gray-400">
          No standups posted for this date.
        </div>
      ) : (
        <div className="space-y-3">
          {standups.map(s => (
            <div
              key={s.id}
              className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4"
            >
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-blue-100 dark:bg-blue-900 flex items-center justify-center text-sm font-semibold text-blue-600 dark:text-blue-300">
                    {s.user_name.charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <span className="font-medium text-gray-900 dark:text-gray-100">{s.user_name}</span>
                    <span className="ml-2 text-xs text-gray-400">
                      {new Date(s.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                </div>
                {s.user_id === currentUser?.user_id && isToday && (
                  <button
                    onClick={() => handleDelete(s.id)}
                    className="text-gray-400 hover:text-red-500 text-sm"
                    title="Delete"
                  >
                    🗑️
                  </button>
                )}
              </div>

              <div className="space-y-2 text-sm">
                <div>
                  <span className="font-medium text-gray-600 dark:text-gray-400">Yesterday:</span>
                  <p className="text-gray-800 dark:text-gray-200 mt-0.5 whitespace-pre-wrap">{s.yesterday}</p>
                </div>
                <div>
                  <span className="font-medium text-gray-600 dark:text-gray-400">Today:</span>
                  <p className="text-gray-800 dark:text-gray-200 mt-0.5 whitespace-pre-wrap">{s.today}</p>
                </div>
                {s.blockers && (
                  <div>
                    <span className="font-medium text-red-500">Blockers:</span>
                    <p className="text-gray-800 dark:text-gray-200 mt-0.5 whitespace-pre-wrap">{s.blockers}</p>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Not Yet Posted Indicator */}
      {notPosted.length > 0 && (
        <div className="rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950 p-3">
          <p className="text-sm text-amber-700 dark:text-amber-300">
            Not yet posted: {notPosted.map(u => u.display_name || u.full_name || u.email).join(', ')}
          </p>
        </div>
      )}

      {/* Standup Form Modal */}
      {showForm && (
        <StandupForm
          existingStandup={editStandup}
          onClose={() => { setShowForm(false); setEditStandup(null) }}
          onSaved={handleSaved}
        />
      )}
    </div>
  )
}
