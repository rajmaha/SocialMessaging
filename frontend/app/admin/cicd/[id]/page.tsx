'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter, useParams } from 'next/navigation'
import MainHeader from '@/components/MainHeader'
import AdminNav from '@/components/AdminNav'
import { authAPI, getAuthToken } from '@/lib/auth'
import { API_URL } from '@/lib/config'

interface Repo {
  id: number; name: string; repo_url: string; branch: string
  schedule_enabled: boolean; schedule_cron: string | null; last_deployed_at: string | null
}

interface Deployment {
  id: number; status: string; triggered_by: string
  git_output: string | null; error: string | null
  started_at: string | null; finished_at: string | null
}

interface DeploymentDetail extends Deployment {
  script_logs: ScriptLog[]
  migration_logs: MigrationLog[]
}

interface ScriptLog {
  id: number; deployment_id: number; script_filename: string; exit_code: number | null
  stdout: string | null; stderr: string | null; executed_at: string | null
}

interface MigrationLog {
  id: number; deployment_id: number; database_name: string; sql_filename: string
  status: string; error: string | null; executed_at: string | null
}

function authHeaders() {
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${getAuthToken()}` }
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    running: 'bg-yellow-100 text-yellow-700',
    success: 'bg-green-100 text-green-700',
    failed: 'bg-red-100 text-red-700',
  }
  return <span className={`px-2 py-0.5 rounded text-xs font-semibold ${map[status] || 'bg-gray-100 text-gray-600'}`}>{status}</span>
}

function ExitCodeBadge({ code }: { code: number | null }) {
  if (code === null) return <span className="text-gray-300">—</span>
  return code === 0
    ? <span className="text-green-600 font-semibold text-xs">✅ {code}</span>
    : <span className="text-red-600 font-semibold text-xs">❌ {code}</span>
}

function fmtDuration(start: string | null, end: string | null) {
  if (!start || !end) return ''
  const ms = new Date(end).getTime() - new Date(start).getTime()
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

export default function CICDDetailPage() {
  const router = useRouter()
  const { id } = useParams<{ id: string }>()
  const [user] = useState(() => authAPI.getUser())

  const [repo, setRepo] = useState<Repo | null>(null)
  const [deployments, setDeployments] = useState<Deployment[]>([])
  const [scriptLogs, setScriptLogs] = useState<ScriptLog[]>([])
  const [migrationLogs, setMigrationLogs] = useState<MigrationLog[]>([])
  const [activeTab, setActiveTab] = useState<'deployments' | 'scripts' | 'migrations'>('deployments')
  const [expandedDep, setExpandedDep] = useState<number | null>(null)
  const [depDetail, setDepDetail] = useState<Record<number, DeploymentDetail>>({})
  const [expandedScript, setExpandedScript] = useState<number | null>(null)
  const [expandedMig, setExpandedMig] = useState<number | null>(null)
  const [dbFilter, setDbFilter] = useState('')
  const [deploying, setDeploying] = useState(false)
  const [loading, setLoading] = useState(true)
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  const flash = (type: 'success' | 'error', text: string) => {
    setMsg({ type, text }); setTimeout(() => setMsg(null), 5000)
  }

  const fetchAll = useCallback(async () => {
    if (!id) return
    setLoading(true)
    const h = { Authorization: `Bearer ${getAuthToken()}` }
    try {
      const [repoRes, depRes, scriptRes, migRes] = await Promise.all([
        fetch(`${API_URL}/cicd/repos/${id}`, { headers: h }),
        fetch(`${API_URL}/cicd/repos/${id}/deployments?page=1&page_size=50`, { headers: h }),
        fetch(`${API_URL}/cicd/repos/${id}/script-logs`, { headers: h }),
        fetch(`${API_URL}/cicd/repos/${id}/migration-logs`, { headers: h }),
      ])
      if (repoRes.ok) setRepo(await repoRes.json())
      if (depRes.ok) setDeployments(await depRes.json())
      if (scriptRes.ok) setScriptLogs(await scriptRes.json())
      if (migRes.ok) setMigrationLogs(await migRes.json())
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    if (!user || user.role !== 'admin') { router.push('/dashboard'); return }
    fetchAll()
  }, [fetchAll]) // eslint-disable-line react-hooks/exhaustive-deps

  async function loadDepDetail(depId: number) {
    if (depDetail[depId]) { setExpandedDep(expandedDep === depId ? null : depId); return }
    const res = await fetch(`${API_URL}/cicd/repos/${id}/deployments/${depId}`, { headers: { Authorization: `Bearer ${getAuthToken()}` } })
    if (res.ok) {
      const d: DeploymentDetail = await res.json()
      setDepDetail(prev => ({ ...prev, [depId]: d }))
    }
    setExpandedDep(expandedDep === depId ? null : depId)
  }

  async function deployNow() {
    setDeploying(true)
    try {
      const res = await fetch(`${API_URL}/cicd/repos/${id}/deploy`, { method: 'POST', headers: authHeaders() })
      if (res.ok) {
        const d = await res.json()
        flash('success', `Deployment #${d.deployment_id} started. Refreshing in 5s…`)
        setTimeout(fetchAll, 5000)
      } else flash('error', 'Failed to trigger deployment.')
    } finally { setDeploying(false) }
  }

  // Unique database names for filter
  const dbNames = [...new Set(migrationLogs.map(m => m.database_name))].sort()
  const filteredMigs = dbFilter ? migrationLogs.filter(m => m.database_name === dbFilter) : migrationLogs

  if (loading) return <div className="min-h-screen bg-gray-50 flex items-center justify-center"><div className="text-gray-400">Loading…</div></div>

  return (
    <div className="min-h-screen bg-gray-50">
      <MainHeader user={user!} />
      <AdminNav />
      <main className="ml-60 pt-14 p-6">
          <div className="max-w-6xl mx-auto">
            {/* Header */}
            <div className="flex items-center gap-3 mb-6">
              <button onClick={() => router.push('/admin/cicd')} className="text-gray-400 hover:text-gray-600 text-sm">← Pipelines</button>
              <span className="text-gray-300">/</span>
              <div className="flex-1">
                <h1 className="text-2xl font-bold text-gray-900">{repo?.name}</h1>
                <p className="text-xs text-gray-400 font-mono">{repo?.repo_url} · {repo?.branch}</p>
              </div>
              <button
                onClick={deployNow}
                disabled={deploying}
                className="px-4 py-2 bg-green-600 text-white rounded-xl text-sm font-semibold hover:bg-green-700 disabled:opacity-50 shadow"
              >
                {deploying ? '⏳ Deploying…' : '▶ Deploy Now'}
              </button>
            </div>

            {/* Flash */}
            {msg && (
              <div className={`mb-4 px-4 py-3 rounded-xl text-sm font-medium flex items-center gap-2 ${msg.type === 'success' ? 'bg-green-50 border border-green-200 text-green-800' : 'bg-red-50 border border-red-200 text-red-800'}`}>
                {msg.type === 'success' ? '✅' : '❌'} {msg.text}
              </div>
            )}

            {/* Repo info strip */}
            {repo && (
              <div className="bg-white rounded-2xl border border-gray-200 p-4 mb-6 flex flex-wrap gap-6 text-sm">
                <div><span className="text-gray-400 text-xs">Schedule</span><div className="font-mono text-xs mt-0.5">{repo.schedule_enabled && repo.schedule_cron ? repo.schedule_cron : 'Manual only'}</div></div>
                <div><span className="text-gray-400 text-xs">Last Deployed</span><div className="text-xs mt-0.5">{repo.last_deployed_at ? new Date(repo.last_deployed_at).toLocaleString() : 'Never'}</div></div>
                <div><span className="text-gray-400 text-xs">Deployments</span><div className="font-semibold mt-0.5">{deployments.length}</div></div>
                <div><span className="text-gray-400 text-xs">Scripts Run</span><div className="font-semibold mt-0.5">{scriptLogs.length}</div></div>
                <div><span className="text-gray-400 text-xs">Migrations Applied</span><div className="font-semibold mt-0.5">{migrationLogs.filter(m => m.status === 'success').length}</div></div>
              </div>
            )}

            {/* Tabs */}
            <div className="flex border-b border-gray-200 mb-6">
              {([['deployments', '🚀 Deployments'], ['scripts', '📜 Scripts'], ['migrations', '🗄️ Migrations']] as const).map(([tab, label]) => (
                <button key={tab} onClick={() => setActiveTab(tab)}
                  className={`px-5 py-3 text-sm font-medium border-b-2 -mb-px transition ${activeTab === tab ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
                  {label}
                </button>
              ))}
            </div>

            {/* ── Deployments tab ────────────────────────────────────────── */}
            {activeTab === 'deployments' && (
              <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
                {deployments.length === 0 ? (
                  <div className="text-center py-12 text-gray-400 text-sm">No deployments yet. Click &quot;Deploy Now&quot; to start.</div>
                ) : (
                  <table className="min-w-full text-sm">
                    <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
                      <tr>
                        <th className="px-5 py-3 text-left">#</th>
                        <th className="px-5 py-3 text-left">Status</th>
                        <th className="px-5 py-3 text-left">Triggered By</th>
                        <th className="px-5 py-3 text-left">Started</th>
                        <th className="px-5 py-3 text-left">Duration</th>
                        <th className="px-5 py-3 text-left"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {deployments.map(dep => (
                        <>
                          <tr key={dep.id} className="hover:bg-gray-50">
                            <td className="px-5 py-3 font-mono text-gray-500 text-xs">#{dep.id}</td>
                            <td className="px-5 py-3"><StatusBadge status={dep.status} /></td>
                            <td className="px-5 py-3 text-gray-500 capitalize text-xs">{dep.triggered_by}</td>
                            <td className="px-5 py-3 text-gray-500 text-xs">{dep.started_at ? new Date(dep.started_at).toLocaleString() : '—'}</td>
                            <td className="px-5 py-3 text-gray-400 text-xs">{fmtDuration(dep.started_at, dep.finished_at)}</td>
                            <td className="px-5 py-3">
                              <button onClick={() => loadDepDetail(dep.id)}
                                className="text-xs text-blue-600 hover:underline">
                                {expandedDep === dep.id ? 'Hide' : 'Details'}
                              </button>
                            </td>
                          </tr>
                          {expandedDep === dep.id && depDetail[dep.id] && (
                            <tr key={`${dep.id}-detail`}>
                              <td colSpan={6} className="bg-gray-50 px-6 py-4">
                                {/* Git output */}
                                {depDetail[dep.id].git_output && (
                                  <div className="mb-4">
                                    <p className="text-xs font-semibold text-gray-500 mb-1">Git Output</p>
                                    <pre className="text-xs bg-gray-900 text-green-300 p-3 rounded-xl overflow-x-auto whitespace-pre-wrap max-h-40">{depDetail[dep.id].git_output}</pre>
                                  </div>
                                )}
                                {depDetail[dep.id].error && (
                                  <div className="mb-4">
                                    <p className="text-xs font-semibold text-red-500 mb-1">Error</p>
                                    <pre className="text-xs bg-red-50 text-red-800 p-3 rounded-xl overflow-x-auto whitespace-pre-wrap">{depDetail[dep.id].error}</pre>
                                  </div>
                                )}
                                {/* Script logs for this deployment */}
                                {depDetail[dep.id].script_logs.length > 0 && (
                                  <div className="mb-4">
                                    <p className="text-xs font-semibold text-gray-500 mb-2">Scripts ({depDetail[dep.id].script_logs.length})</p>
                                    <div className="space-y-1">
                                      {depDetail[dep.id].script_logs.map(s => (
                                        <div key={s.id} className="flex items-center gap-3 text-xs">
                                          <ExitCodeBadge code={s.exit_code} />
                                          <span className="font-mono text-gray-700">{s.script_filename}</span>
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                )}
                                {/* Migration logs for this deployment */}
                                {depDetail[dep.id].migration_logs.length > 0 && (
                                  <div>
                                    <p className="text-xs font-semibold text-gray-500 mb-2">Migrations ({depDetail[dep.id].migration_logs.length})</p>
                                    <div className="space-y-1">
                                      {depDetail[dep.id].migration_logs.map(m => (
                                        <div key={m.id} className="flex items-center gap-3 text-xs">
                                          <StatusBadge status={m.status} />
                                          <span className="text-gray-500 font-mono">{m.database_name}</span>
                                          <span className="font-mono text-gray-700">{m.sql_filename}</span>
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                )}
                              </td>
                            </tr>
                          )}
                        </>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            )}

            {/* ── Scripts tab ────────────────────────────────────────────── */}
            {activeTab === 'scripts' && (
              <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
                {scriptLogs.length === 0 ? (
                  <div className="text-center py-12 text-gray-400 text-sm">No scripts have been executed yet.</div>
                ) : (
                  <table className="min-w-full text-sm">
                    <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
                      <tr>
                        <th className="px-5 py-3 text-left">Script</th>
                        <th className="px-5 py-3 text-left">Exit Code</th>
                        <th className="px-5 py-3 text-left">Deployment</th>
                        <th className="px-5 py-3 text-left">Executed At</th>
                        <th className="px-5 py-3 text-left"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {scriptLogs.map(s => (
                        <>
                          <tr key={s.id} className="hover:bg-gray-50">
                            <td className="px-5 py-3 font-mono text-gray-800 text-xs">{s.script_filename}</td>
                            <td className="px-5 py-3"><ExitCodeBadge code={s.exit_code} /></td>
                            <td className="px-5 py-3 text-gray-400 text-xs">#{s.deployment_id}</td>
                            <td className="px-5 py-3 text-gray-400 text-xs">{s.executed_at ? new Date(s.executed_at).toLocaleString() : '—'}</td>
                            <td className="px-5 py-3">
                              {(s.stdout || s.stderr) && (
                                <button onClick={() => setExpandedScript(expandedScript === s.id ? null : s.id)}
                                  className="text-xs text-blue-600 hover:underline">
                                  {expandedScript === s.id ? 'Hide' : 'Output'}
                                </button>
                              )}
                            </td>
                          </tr>
                          {expandedScript === s.id && (
                            <tr key={`${s.id}-out`}>
                              <td colSpan={5} className="bg-gray-900 px-5 py-4">
                                {s.stdout && <pre className="text-xs text-green-300 whitespace-pre-wrap mb-2">{s.stdout}</pre>}
                                {s.stderr && <pre className="text-xs text-red-300 whitespace-pre-wrap">{s.stderr}</pre>}
                              </td>
                            </tr>
                          )}
                        </>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            )}

            {/* ── Migrations tab ─────────────────────────────────────────── */}
            {activeTab === 'migrations' && (
              <div>
                {/* DB filter */}
                {dbNames.length > 1 && (
                  <div className="mb-4 flex items-center gap-3">
                    <label className="text-xs text-gray-500 font-semibold">Filter by database:</label>
                    <select value={dbFilter} onChange={e => setDbFilter(e.target.value)}
                      className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm">
                      <option value="">All databases</option>
                      {dbNames.map(n => <option key={n} value={n}>{n}</option>)}
                    </select>
                  </div>
                )}
                <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
                  {filteredMigs.length === 0 ? (
                    <div className="text-center py-12 text-gray-400 text-sm">No migrations applied yet.</div>
                  ) : (
                    <table className="min-w-full text-sm">
                      <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
                        <tr>
                          <th className="px-5 py-3 text-left">Database</th>
                          <th className="px-5 py-3 text-left">SQL File</th>
                          <th className="px-5 py-3 text-left">Status</th>
                          <th className="px-5 py-3 text-left">Deployment</th>
                          <th className="px-5 py-3 text-left">Applied At</th>
                          <th className="px-5 py-3 text-left"></th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {filteredMigs.map(m => (
                          <>
                            <tr key={m.id} className="hover:bg-gray-50">
                              <td className="px-5 py-3 font-mono text-xs text-blue-700 bg-blue-50">{m.database_name}</td>
                              <td className="px-5 py-3 font-mono text-xs text-gray-800">{m.sql_filename}</td>
                              <td className="px-5 py-3"><StatusBadge status={m.status} /></td>
                              <td className="px-5 py-3 text-gray-400 text-xs">#{m.deployment_id}</td>
                              <td className="px-5 py-3 text-gray-400 text-xs">{m.executed_at ? new Date(m.executed_at).toLocaleString() : '—'}</td>
                              <td className="px-5 py-3">
                                {m.error && (
                                  <button onClick={() => setExpandedMig(expandedMig === m.id ? null : m.id)}
                                    className="text-xs text-red-600 hover:underline">
                                    {expandedMig === m.id ? 'Hide' : 'Error'}
                                  </button>
                                )}
                              </td>
                            </tr>
                            {expandedMig === m.id && m.error && (
                              <tr key={`${m.id}-err`}>
                                <td colSpan={6} className="bg-red-50 px-5 py-3">
                                  <pre className="text-xs text-red-800 whitespace-pre-wrap">{m.error}</pre>
                                </td>
                              </tr>
                            )}
                          </>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>
            )}
          </div>
      </main>
    </div>
  )
}
