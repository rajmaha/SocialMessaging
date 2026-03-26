'use client'

import { useState, useEffect } from 'react'
import { dailyOpsApi } from '@/lib/api'
import PlannerItemRow from './PlannerItemRow'

interface AssignedItem {
  id: number
  type: string
  title: string
  priority?: string | null
  due_date?: string | null
  link: string
}

interface PlannerItem {
  id: number
  title: string
  is_completed: boolean
  sort_order: number
  date: string
}

interface MyDayTabProps {
  selectedDate: string
}

const SECTION_LABELS: Record<string, { label: string; icon: string }> = {
  conversations: { label: 'Assigned Conversations', icon: '💬' },
  tickets: { label: 'Open Tickets', icon: '🎫' },
  crm_tasks: { label: 'CRM Tasks Due', icon: '📊' },
  pms_tasks: { label: 'PMS Tasks Due', icon: '📁' },
  emails: { label: 'Unread Emails', icon: '📧' },
}

export default function MyDayTab({ selectedDate }: MyDayTabProps) {
  const [manualItems, setManualItems] = useState<PlannerItem[]>([])
  const [assignedItems, setAssignedItems] = useState<Record<string, AssignedItem[]>>({})
  const [loading, setLoading] = useState(true)
  const [newGoal, setNewGoal] = useState('')
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})

  const fetchPlanner = async () => {
    try {
      const res = await dailyOpsApi.getPlanner(selectedDate)
      setManualItems(res.data.manual_items || [])
      setAssignedItems(res.data.assigned_items || {})
    } catch (err) {
      console.error('Failed to load planner:', err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    setLoading(true)
    fetchPlanner()
  }, [selectedDate])

  const addGoal = async () => {
    if (!newGoal.trim()) return
    try {
      await dailyOpsApi.createPlannerItem({ title: newGoal.trim(), date: selectedDate })
      setNewGoal('')
      fetchPlanner()
    } catch (err) {
      console.error('Failed to add goal:', err)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      addGoal()
    }
  }

  const toggleSection = (key: string) => {
    setCollapsed(prev => ({ ...prev, [key]: !prev[key] }))
  }

  if (loading) {
    return <div className="flex justify-center py-12 text-gray-400">Loading planner...</div>
  }

  return (
    <div className="space-y-6">
      {/* Manual Goals Section */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">📋 My Goals &amp; Notes</h3>
        </div>

        <div className="flex gap-2 mb-3">
          <input
            type="text"
            value={newGoal}
            onChange={e => setNewGoal(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Add a goal or note..."
            className="flex-1 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button
            onClick={addGoal}
            className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            Add
          </button>
        </div>

        <div className="space-y-2">
          {manualItems.map(item => (
            <PlannerItemRow
              key={item.id}
              id={item.id}
              title={item.title}
              isCompleted={item.is_completed}
              onUpdate={fetchPlanner}
              onDelete={fetchPlanner}
            />
          ))}
          {manualItems.length === 0 && (
            <p className="text-sm text-gray-400 py-2">No goals added for today yet.</p>
          )}
        </div>
      </div>

      {/* Assigned Items Sections */}
      {Object.entries(SECTION_LABELS).map(([key, { label, icon }]) => {
        const items = assignedItems[key] || []
        const isCollapsed = collapsed[key]

        return (
          <div key={key}>
            <button
              onClick={() => toggleSection(key)}
              className="flex items-center gap-2 w-full text-left mb-2"
            >
              <span className="text-sm">{isCollapsed ? '▶' : '▼'}</span>
              <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">
                {icon} {label}
                <span className="ml-2 text-xs font-normal px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400">
                  {items.length}
                </span>
              </h3>
            </button>

            {!isCollapsed && (
              <div className="space-y-1 ml-6">
                {items.map(item => (
                  <a
                    key={`${item.type}-${item.id}`}
                    href={item.link}
                    className="block p-2 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700/50 text-sm text-gray-700 dark:text-gray-300 transition-colors"
                  >
                    <span>{item.title}</span>
                    {item.priority && (
                      <span className={`ml-2 text-xs px-1.5 py-0.5 rounded ${
                        item.priority === 'high' || item.priority === 'urgent'
                          ? 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300'
                          : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400'
                      }`}>
                        {item.priority}
                      </span>
                    )}
                  </a>
                ))}
                {items.length === 0 && (
                  <p className="text-sm text-gray-400 py-1">None</p>
                )}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
