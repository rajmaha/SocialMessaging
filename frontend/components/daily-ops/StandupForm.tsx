'use client'

import { useState } from 'react'
import { dailyOpsApi } from '@/lib/api'

interface StandupFormProps {
  existingStandup?: {
    id: number
    yesterday: string
    today: string
    blockers?: string | null
  } | null
  onClose: () => void
  onSaved: () => void
}

export default function StandupForm({ existingStandup, onClose, onSaved }: StandupFormProps) {
  const [yesterday, setYesterday] = useState(existingStandup?.yesterday || '')
  const [today, setToday] = useState(existingStandup?.today || '')
  const [blockers, setBlockers] = useState(existingStandup?.blockers || '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const isEdit = !!existingStandup

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!yesterday.trim() || !today.trim()) {
      setError('Yesterday and Today fields are required.')
      return
    }

    setSaving(true)
    setError('')
    try {
      if (isEdit) {
        await dailyOpsApi.updateStandup(existingStandup!.id, {
          yesterday: yesterday.trim(),
          today: today.trim(),
          blockers: blockers.trim() || undefined,
        })
      } else {
        await dailyOpsApi.createStandup({
          yesterday: yesterday.trim(),
          today: today.trim(),
          blockers: blockers.trim() || undefined,
        })
      }
      onSaved()
    } catch (err: any) {
      if (err?.response?.status === 409) {
        setError('You already posted a standup today. Edit your existing one instead.')
      } else {
        setError('Failed to save standup. Please try again.')
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl w-full max-w-lg p-6 mx-4">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">
          {isEdit ? 'Edit Standup' : 'Post Standup'}
        </h2>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Yesterday
            </label>
            <textarea
              value={yesterday}
              onChange={e => setYesterday(e.target.value)}
              rows={3}
              className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="What did you accomplish yesterday?"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Today
            </label>
            <textarea
              value={today}
              onChange={e => setToday(e.target.value)}
              rows={3}
              className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="What are you planning to do today?"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Blockers <span className="text-gray-400">(optional)</span>
            </label>
            <textarea
              value={blockers}
              onChange={e => setBlockers(e.target.value)}
              rows={2}
              className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Anything blocking your progress?"
            />
          </div>

          {error && <p className="text-sm text-red-500">{error}</p>}

          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
            >
              {saving ? 'Saving...' : isEdit ? 'Update' : 'Post Standup'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
