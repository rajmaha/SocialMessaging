'use client'

import { useState, useEffect } from 'react'
import { dailyOpsApi } from '@/lib/api'
import { API_URL } from '@/lib/config'
import { getAuthToken } from '@/lib/auth'

type ReportView = 'compliance' | 'activity'

interface ComplianceUser {
  user_id: number
  user_name: string
  posted_count: number
  missed_count: number
  rate: number
  daily: { date: string; posted: boolean }[]
}

interface ComplianceData {
  start_date: string
  end_date: string
  total_days: number
  total_users: number
  overall_rate: number
  users: ComplianceUser[]
}

interface ActivityRow {
  user_id: number
  user_name: string
  date: string
  standup_posted: boolean
  goals_count: number
  goals_completed: number
  worklog_hours: number
}

interface ActivityData {
  start_date: string
  end_date: string
  rows: ActivityRow[]
}

interface ReportsTabProps {
  selectedDate: string
}

export default function ReportsTab({ selectedDate }: ReportsTabProps) {
  const [view, setView] = useState<ReportView>('compliance')
  const [startDate, setStartDate] = useState(() => {
    const d = new Date()
    d.setDate(d.getDate() - 13)
    return d.toISOString().split('T')[0]
  })
  const [endDate, setEndDate] = useState(() => new Date().toISOString().split('T')[0])
  const [agents, setAgents] = useState<any[]>([])
  const [agentFilter, setAgentFilter] = useState('')
  const [compliance, setCompliance] = useState<ComplianceData | null>(null)
  const [activity, setActivity] = useState<ActivityData | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    const token = getAuthToken()
    fetch(`${API_URL}/admin/users`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json())
      .then(data => setAgents(Array.isArray(data) ? data : []))
      .catch(() => {})
  }, [])

  const loadReport = async () => {
    setLoading(true)
    try {
      if (view === 'compliance') {
        const res = await dailyOpsApi.getStandupCompliance({ start_date: startDate, end_date: endDate })
        setCompliance(res.data)
      } else {
        const params: any = { start_date: startDate, end_date: endDate }
        if (agentFilter) params.user_id = agentFilter
        const res = await dailyOpsApi.getTeamActivity(params)
        setActivity(res.data)
      }
    } catch (err) {
      console.error('Failed to load report:', err)
    }
    setLoading(false)
  }

  useEffect(() => { loadReport() }, [view, startDate, endDate, agentFilter])

  const handleExport = async (format: string) => {
    try {
      const params: any = { report: view === 'compliance' ? 'standup-compliance' : 'team-activity', format, start_date: startDate, end_date: endDate }
      if (agentFilter) params.user_id = agentFilter
      const res = await dailyOpsApi.exportReport(params)
      const url = window.URL.createObjectURL(new Blob([res.data]))
      const a = document.createElement('a')
      a.href = url
      a.download = `daily-ops-${view}-${startDate}-${endDate}.${format}`
      a.click()
      window.URL.revokeObjectURL(url)
    } catch (err) {
      console.error('Export failed:', err)
    }
  }

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-4">
        <div className="flex flex-wrap gap-4 items-end">
          <div>
            <label className="text-xs text-gray-500 block mb-1">Report</label>
            <select value={view} onChange={e => setView(e.target.value as ReportView)}
              className="border border-gray-300 dark:border-gray-600 rounded px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100">
              <option value="compliance">Standup Compliance</option>
              <option value="activity">Team Activity</option>
            </select>
          </div>
          <div>
            <label className="text-xs text-gray-500 block mb-1">Start</label>
            <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)}
              className="border border-gray-300 dark:border-gray-600 rounded px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 h-[38px]" />
          </div>
          <div>
            <label className="text-xs text-gray-500 block mb-1">End</label>
            <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)}
              className="border border-gray-300 dark:border-gray-600 rounded px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 h-[38px]" />
          </div>
          {view === 'activity' && (
            <div>
              <label className="text-xs text-gray-500 block mb-1">Agent</label>
              <select value={agentFilter} onChange={e => setAgentFilter(e.target.value)}
                className="border border-gray-300 dark:border-gray-600 rounded px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100">
                <option value="">All Agents</option>
                {agents.map((a: any) => (
                  <option key={a.id} value={a.id}>{a.full_name || a.email}</option>
                ))}
              </select>
            </div>
          )}
          <div className="flex gap-2 ml-auto">
            <button onClick={() => handleExport('csv')}
              className="px-3 py-2 bg-green-600 text-white rounded text-sm font-medium hover:bg-green-700">CSV</button>
            <button onClick={() => handleExport('pdf')}
              className="px-3 py-2 bg-red-600 text-white rounded text-sm font-medium hover:bg-red-700">PDF</button>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-12 text-gray-400">Loading report...</div>
      ) : view === 'compliance' && compliance ? (
        <ComplianceReport data={compliance} />
      ) : view === 'activity' && activity ? (
        <ActivityReport data={activity} />
      ) : null}

      {/* Worklog Reports Link */}
      <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-medium text-gray-900 dark:text-gray-100">Worklog Reports</h3>
            <p className="text-xs text-gray-500 mt-0.5">View detailed worklog hours, categories, and approvals</p>
          </div>
          <a href="/admin/worklog/reports"
            className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700">
            Open Worklog Reports
          </a>
        </div>
      </div>
    </div>
  )
}

function ComplianceReport({ data }: { data: ComplianceData }) {
  return (
    <div className="space-y-4">
      {/* Summary */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-white dark:bg-gray-800 border rounded-lg p-4 text-center">
          <div className="text-2xl font-bold text-gray-900 dark:text-gray-100">{data.overall_rate}%</div>
          <div className="text-xs text-gray-500">Overall Rate</div>
        </div>
        <div className="bg-white dark:bg-gray-800 border rounded-lg p-4 text-center">
          <div className="text-2xl font-bold text-gray-900 dark:text-gray-100">{data.total_users}</div>
          <div className="text-xs text-gray-500">Team Members</div>
        </div>
        <div className="bg-white dark:bg-gray-800 border rounded-lg p-4 text-center">
          <div className="text-2xl font-bold text-gray-900 dark:text-gray-100">{data.total_days}</div>
          <div className="text-xs text-gray-500">Days in Range</div>
        </div>
      </div>

      {/* Per-user table */}
      <div className="bg-white dark:bg-gray-800 border rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 dark:bg-gray-700 border-b">
            <tr>
              <th className="text-left px-4 py-3 font-medium text-gray-600 dark:text-gray-300">Agent</th>
              <th className="text-center px-4 py-3 font-medium text-gray-600 dark:text-gray-300">Posted</th>
              <th className="text-center px-4 py-3 font-medium text-gray-600 dark:text-gray-300">Missed</th>
              <th className="text-center px-4 py-3 font-medium text-gray-600 dark:text-gray-300">Rate</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600 dark:text-gray-300">Daily</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {data.users.map(u => (
              <tr key={u.user_id}>
                <td className="px-4 py-3 font-medium text-gray-900 dark:text-gray-100">{u.user_name}</td>
                <td className="px-4 py-3 text-center text-green-600">{u.posted_count}</td>
                <td className="px-4 py-3 text-center text-red-500">{u.missed_count}</td>
                <td className="px-4 py-3 text-center">
                  <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${
                    u.rate >= 80 ? 'bg-green-100 text-green-700' :
                    u.rate >= 50 ? 'bg-yellow-100 text-yellow-700' :
                    'bg-red-100 text-red-700'
                  }`}>{u.rate}%</span>
                </td>
                <td className="px-4 py-3">
                  <div className="flex gap-0.5">
                    {u.daily.map(d => (
                      <div key={d.date} title={d.date}
                        className={`w-3 h-3 rounded-sm ${d.posted ? 'bg-green-500' : 'bg-gray-200 dark:bg-gray-600'}`} />
                    ))}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function ActivityReport({ data }: { data: ActivityData }) {
  return (
    <div className="bg-white dark:bg-gray-800 border rounded-lg overflow-hidden">
      {data.rows.length === 0 ? (
        <div className="p-8 text-center text-gray-500">No activity for the selected period.</div>
      ) : (
        <table className="w-full text-sm">
          <thead className="bg-gray-50 dark:bg-gray-700 border-b">
            <tr>
              <th className="text-left px-4 py-3 font-medium text-gray-600 dark:text-gray-300">Agent</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600 dark:text-gray-300">Date</th>
              <th className="text-center px-4 py-3 font-medium text-gray-600 dark:text-gray-300">Standup</th>
              <th className="text-center px-4 py-3 font-medium text-gray-600 dark:text-gray-300">Goals</th>
              <th className="text-right px-4 py-3 font-medium text-gray-600 dark:text-gray-300">Worklog</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {data.rows.map((row, i) => (
              <tr key={i}>
                <td className="px-4 py-3 font-medium text-gray-900 dark:text-gray-100">{row.user_name}</td>
                <td className="px-4 py-3 text-gray-600 dark:text-gray-400">{row.date}</td>
                <td className="px-4 py-3 text-center">
                  {row.standup_posted
                    ? <span className="text-green-600">Yes</span>
                    : <span className="text-gray-400">No</span>}
                </td>
                <td className="px-4 py-3 text-center text-gray-700 dark:text-gray-300">
                  {row.goals_count > 0 ? `${row.goals_completed}/${row.goals_count}` : '—'}
                </td>
                <td className="px-4 py-3 text-right font-bold text-gray-900 dark:text-gray-100">
                  {row.worklog_hours > 0 ? `${row.worklog_hours.toFixed(1)}h` : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
