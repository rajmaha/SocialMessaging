'use client'

import { useState, useEffect } from 'react'
import { dailyOpsApi } from '@/lib/api'
import { hasPermission } from '@/lib/permissions'
import MetricCard from './MetricCard'
import CommandCenterConfig from './CommandCenterConfig'

interface Metric {
  metric_key: string
  label: string
  value: number
  threshold_value?: number | null
  is_exceeded: boolean
}

export default function CommandCenterTab() {
  const [metrics, setMetrics] = useState<Metric[]>([])
  const [loading, setLoading] = useState(true)
  const [showConfig, setShowConfig] = useState(false)

  const canManage = hasPermission('daily_ops', 'manage_command_center')

  const fetchMetrics = async () => {
    try {
      const res = await dailyOpsApi.getCommandCenter()
      setMetrics(res.data || [])
    } catch (err) {
      console.error('Failed to load metrics:', err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchMetrics()
    // Auto-refresh every 30 seconds
    const interval = setInterval(fetchMetrics, 30000)
    return () => clearInterval(interval)
  }, [])

  if (loading) {
    return <div className="flex justify-center py-12 text-gray-400">Loading command center...</div>
  }

  return (
    <div>
      {canManage && (
        <div className="flex justify-end mb-4">
          <button
            onClick={() => setShowConfig(true)}
            className="px-3 py-1.5 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 border border-gray-300 dark:border-gray-600 rounded-lg"
          >
            ⚙️ Configure
          </button>
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {metrics.map(m => (
          <MetricCard
            key={m.metric_key}
            metricKey={m.metric_key}
            label={m.label}
            value={m.value}
            thresholdValue={m.threshold_value}
            isExceeded={m.is_exceeded}
          />
        ))}
      </div>

      {metrics.length === 0 && (
        <div className="text-center py-12 text-gray-400">
          No metrics configured.
          {canManage && ' Click Configure to set up your dashboard.'}
        </div>
      )}

      {showConfig && (
        <CommandCenterConfig
          onClose={() => setShowConfig(false)}
          onSaved={() => { setShowConfig(false); fetchMetrics() }}
        />
      )}
    </div>
  )
}
