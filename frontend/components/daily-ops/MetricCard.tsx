'use client'

interface MetricCardProps {
  metricKey: string
  label: string
  value: number | string
  thresholdValue?: number | null
  isExceeded: boolean
}

const METRIC_ICONS: Record<string, string> = {
  open_conversations: '💬',
  unassigned_conversations: '💬',
  pending_tickets: '🎫',
  overdue_crm_tasks: '⚠️',
  deals_in_pipeline: '📊',
  unread_emails: '📧',
  active_agents: '👥',
  avg_response_time_today: '⏱️',
}

const METRIC_SUFFIX: Record<string, string> = {
  avg_response_time_today: 'min',
}

export default function MetricCard({ metricKey, label, value, thresholdValue, isExceeded }: MetricCardProps) {
  const icon = METRIC_ICONS[metricKey] || '📈'
  const suffix = METRIC_SUFFIX[metricKey] || ''

  return (
    <div
      className={`rounded-lg border p-4 text-center transition-colors ${
        isExceeded
          ? 'border-red-300 bg-red-50 dark:border-red-700 dark:bg-red-950'
          : 'border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800'
      }`}
    >
      <div className="text-2xl mb-1">{icon}</div>
      <div className={`text-3xl font-bold ${isExceeded ? 'text-red-600 dark:text-red-400' : 'text-gray-900 dark:text-gray-100'}`}>
        {value}{suffix && <span className="text-sm font-normal ml-1">{suffix}</span>}
      </div>
      <div className="text-sm text-gray-500 dark:text-gray-400 mt-1">{label}</div>
      {thresholdValue !== null && thresholdValue !== undefined && (
        <div className="text-xs text-gray-400 mt-1">Threshold: {thresholdValue}</div>
      )}
    </div>
  )
}
