'use client'
import { useState, useEffect } from 'react'
import api from '@/lib/api'

export default function ReportsPage() {
  const [tab, setTab] = useState<'agents' | 'aging' | 'revenue' | 'export'>('agents')
  const [agentData, setAgentData] = useState<any[]>([])
  const [agingData, setAgingData] = useState<any[]>([])
  const [revenueData, setRevenueData] = useState<any[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    setLoading(true)
    Promise.all([
      api.get('/crm/reports/agent-performance?days=30').then(r => setAgentData(r.data)).catch(() => {}),
      api.get('/crm/reports/lead-aging').then(r => setAgingData(r.data)).catch(() => {}),
      api.get('/crm/reports/revenue?months=6').then(r => setRevenueData(r.data)).catch(() => {}),
    ]).finally(() => setLoading(false))
  }, [])

  const downloadCSV = (type: string) => {
    const baseUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'
    const url = `${baseUrl}/crm/reports/export?type=${type}`
    const token = typeof window !== 'undefined'
      ? (localStorage.getItem('auth_token') || localStorage.getItem('token') || '')
      : ''
    fetch(url, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.blob())
      .then(blob => {
        const a = document.createElement('a')
        a.href = URL.createObjectURL(blob)
        a.download = `crm_${type}_${new Date().toISOString().slice(0, 10)}.csv`
        a.click()
      })
      .catch(() => {})
  }

  const agingColor = (days: number) =>
    days > 30 ? 'text-red-600' : days > 7 ? 'text-yellow-600' : 'text-green-600'

  const maxRevenue = Math.max(...revenueData.flatMap(r => [r.actual, r.forecasted]), 1)

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">CRM Reports</h1>
        <p className="text-sm text-gray-500 mt-1">Operational and revenue insights</p>
      </div>

      <div className="flex gap-1 mb-6 border-b">
        {(['agents', 'aging', 'revenue', 'export'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium ${tab === t ? 'border-b-2 border-indigo-600 text-indigo-600' : 'text-gray-500 hover:text-gray-700'}`}>
            {t === 'agents' ? 'Agent Performance' : t === 'aging' ? 'Lead Aging' : t === 'revenue' ? 'Revenue' : 'Export'}
          </button>
        ))}
      </div>

      {loading && <div className="text-gray-400 text-sm py-8">Loading...</div>}

      {!loading && tab === 'agents' && (
        <div className="bg-white rounded-xl border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wide">
              <tr>
                <th className="px-4 py-3 text-left">Agent</th>
                <th className="px-4 py-3 text-center">Leads</th>
                <th className="px-4 py-3 text-center">Deals Closed</th>
                <th className="px-4 py-3 text-center">Win Rate</th>
                <th className="px-4 py-3 text-right">Revenue</th>
                <th className="px-4 py-3 text-right">Avg Deal</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {agentData.map(a => (
                <tr key={a.agent_id} className="hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <p className="font-medium">{a.agent_name}</p>
                    <p className="text-xs text-gray-400">{a.agent_email}</p>
                  </td>
                  <td className="px-4 py-3 text-center">{a.leads_assigned}</td>
                  <td className="px-4 py-3 text-center">{a.deals_closed}</td>
                  <td className="px-4 py-3 text-center">
                    <span className={`font-semibold ${a.win_rate >= 50 ? 'text-green-600' : a.win_rate >= 25 ? 'text-yellow-600' : 'text-red-500'}`}>
                      {a.win_rate}%
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right font-semibold">${a.total_revenue.toLocaleString()}</td>
                  <td className="px-4 py-3 text-right text-gray-600">${a.avg_deal_value.toLocaleString()}</td>
                </tr>
              ))}
              {agentData.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-400">No data yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {!loading && tab === 'aging' && (
        <div className="bg-white rounded-xl border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wide">
              <tr>
                <th className="px-4 py-3 text-left">Status</th>
                <th className="px-4 py-3 text-center">Count</th>
                <th className="px-4 py-3 text-center">Avg Age</th>
                <th className="px-4 py-3 text-center">Oldest</th>
                <th className="px-4 py-3 text-left">Distribution</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {agingData.map(row => (
                <tr key={row.status} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium capitalize">{row.status}</td>
                  <td className="px-4 py-3 text-center">{row.count}</td>
                  <td className={`px-4 py-3 text-center font-semibold ${agingColor(row.avg_age_days)}`}>{row.avg_age_days}d</td>
                  <td className={`px-4 py-3 text-center ${agingColor(row.oldest_days)}`}>{row.oldest_days}d</td>
                  <td className="px-4 py-3">
                    <div className="w-full bg-gray-100 rounded-full h-2">
                      <div className={`h-2 rounded-full ${row.avg_age_days > 30 ? 'bg-red-400' : row.avg_age_days > 7 ? 'bg-yellow-400' : 'bg-green-400'}`}
                        style={{ width: `${Math.min(row.avg_age_days / 60 * 100, 100)}%` }} />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!loading && tab === 'revenue' && (
        <div className="bg-white rounded-xl border p-6">
          <div className="flex items-center gap-6 mb-4 text-xs">
            <span className="flex items-center gap-2"><span className="w-3 h-3 bg-green-500 rounded inline-block" /> Actual (Won)</span>
            <span className="flex items-center gap-2"><span className="w-3 h-3 bg-indigo-300 rounded inline-block" /> Forecasted</span>
          </div>
          <div className="flex items-end gap-4 h-48">
            {revenueData.map(r => (
              <div key={r.month} className="flex-1 flex flex-col items-center gap-1">
                <div className="w-full flex items-end gap-1 h-36">
                  <div className="flex-1 bg-green-500 rounded-t" style={{ height: `${Math.max(r.actual / maxRevenue * 100, r.actual > 0 ? 4 : 0)}%` }} />
                  <div className="flex-1 bg-indigo-300 rounded-t" style={{ height: `${Math.max(r.forecasted / maxRevenue * 100, r.forecasted > 0 ? 4 : 0)}%` }} />
                </div>
                <span className="text-xs text-gray-400">{r.month_label}</span>
              </div>
            ))}
          </div>
          <div className="mt-2 grid gap-2 text-xs text-center text-gray-500" style={{ gridTemplateColumns: `repeat(${revenueData.length}, 1fr)` }}>
            {revenueData.map(r => (
              <div key={r.month}>
                <p className="text-green-600">${(r.actual / 1000).toFixed(1)}k</p>
                <p className="text-indigo-400">${(r.forecasted / 1000).toFixed(1)}k</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === 'export' && (
        <div className="max-w-md">
          <div className="bg-white rounded-xl border p-6 space-y-4">
            <h2 className="font-semibold text-gray-700">Download CSV Reports</h2>
            <p className="text-sm text-gray-500">Export data for offline analysis or import into other tools.</p>
            <div className="space-y-3">
              {[
                { type: 'leads', label: 'Leads', desc: 'All leads with status, source, and score' },
                { type: 'deals', label: 'Deals', desc: 'All deals with stage, amount, and close dates' },
                { type: 'tasks', label: 'Tasks', desc: 'All CRM tasks with status and due dates' },
              ].map(item => (
                <div key={item.type} className="flex items-center justify-between border rounded-lg px-4 py-3">
                  <div>
                    <p className="font-medium text-sm">{item.label}</p>
                    <p className="text-xs text-gray-400">{item.desc}</p>
                  </div>
                  <button onClick={() => downloadCSV(item.type)}
                    className="bg-indigo-600 text-white px-3 py-1.5 rounded text-xs font-medium hover:bg-indigo-700">
                    Download
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
