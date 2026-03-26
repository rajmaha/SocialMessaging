'use client'

import { useState } from 'react'
import { dailyOpsApi } from '@/lib/api'

interface PlannerItemRowProps {
  id: number
  title: string
  isCompleted: boolean
  onUpdate: () => void
  onDelete: () => void
}

export default function PlannerItemRow({ id, title, isCompleted, onUpdate, onDelete }: PlannerItemRowProps) {
  const [loading, setLoading] = useState(false)

  const toggleComplete = async () => {
    setLoading(true)
    try {
      await dailyOpsApi.updatePlannerItem(id, { is_completed: !isCompleted })
      onUpdate()
    } catch (err) {
      console.error('Failed to toggle item:', err)
    } finally {
      setLoading(false)
    }
  }

  const handleDelete = async () => {
    setLoading(true)
    try {
      await dailyOpsApi.deletePlannerItem(id)
      onDelete()
    } catch (err) {
      console.error('Failed to delete item:', err)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className={`flex items-center gap-3 p-3 rounded-lg border ${
      isCompleted ? 'bg-gray-50 dark:bg-gray-800/50' : 'bg-white dark:bg-gray-800'
    } border-gray-200 dark:border-gray-700`}>
      <button
        onClick={toggleComplete}
        disabled={loading}
        className={`w-5 h-5 rounded border-2 flex items-center justify-center flex-shrink-0 transition-colors ${
          isCompleted
            ? 'bg-green-500 border-green-500 text-white'
            : 'border-gray-300 dark:border-gray-600 hover:border-green-400'
        }`}
      >
        {isCompleted && (
          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
          </svg>
        )}
      </button>
      <span className={`flex-1 ${isCompleted ? 'line-through text-gray-400' : 'text-gray-900 dark:text-gray-100'}`}>
        {title}
      </span>
      <button
        onClick={handleDelete}
        disabled={loading}
        className="text-gray-400 hover:text-red-500 transition-colors"
        title="Remove"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  )
}
