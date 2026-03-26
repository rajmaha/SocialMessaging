'use client'

import { useState, useEffect } from 'react'
import { dailyOpsApi } from '@/lib/api'

interface MetricConfig {
  metric_key: string
  label: string
  is_visible: boolean
  sort_order: number
  threshold_value?: number | null
}

interface CommandCenterConfigProps {
  onClose: () => void
  onSaved: () => void
}

export default function CommandCenterConfig({ onClose, onSaved }: CommandCenterConfigProps) {
  const [configs, setConfigs] = useState<MetricConfig[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    const load = async () => {
      try {
        const res = await dailyOpsApi.getCommandCenterConfig()
        setConfigs(res.data || [])
      } catch (err) {
        console.error('Failed to load config:', err)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  const toggleVisible = (key: string) => {
    setConfigs(prev => prev.map(c =>
      c.metric_key === key ? { ...c, is_visible: !c.is_visible } : c
    ))
  }

  const updateThreshold = (key: string, value: string) => {
    const numVal = value === '' ? null : parseInt(value)
    setConfigs(prev => prev.map(c =>
      c.metric_key === key ? { ...c, threshold_value: numVal } : c
    ))
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      await dailyOpsApi.updateCommandCenterConfig({ metrics: configs })
      onSaved()
    } catch (err) {
      console.error('Failed to save config:', err)
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return null
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl w-full max-w-lg p-6 mx-4 max-h-[80vh] overflow-y-auto">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">
          ⚙️ Configure Command Center
        </h2>

        <div className="space-y-3">
          {configs.map(c => (
            <div
              key={c.metric_key}
              className="flex items-center gap-3 p-3 rounded-lg border border-gray-200 dark:border-gray-700"
            >
              <label className="flex items-center gap-2 flex-1 cursor-pointer">
                <input
                  type="checkbox"
                  checked={c.is_visible}
                  onChange={() => toggleVisible(c.metric_key)}
                  className="w-4 h-4 rounded"
                />
                <span className="text-sm text-gray-800 dark:text-gray-200">{c.label}</span>
              </label>
              <input
                type="number"
                value={c.threshold_value ?? ''}
                onChange={e => updateThreshold(c.metric_key, e.target.value)}
                placeholder="Threshold"
                className="w-24 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-2 py-1 text-sm text-gray-900 dark:text-gray-100"
              />
            </div>
          ))}
        </div>

        <div className="flex justify-end gap-3 mt-6">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-800"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}
