'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter, useParams } from 'next/navigation'
import MainHeader from '@/components/MainHeader'
import AdminNav from '@/components/AdminNav'
import { authAPI, getAuthToken } from '@/lib/auth'
import { API_URL } from '@/lib/config'

// ── Interfaces ────────────────────────────────────────────────────────────────

interface Repo {
  id: number
  name: string
  repo_url: string
  branch: string
  local_path: string
  server_id: number | null
  server_name: string | null
  auth_type: string
  has_ssh_key: boolean
  has_access_token: boolean
  db_type: string | null
  db_host: string | null
  db_port: number | null
  schedule_enabled: boolean
  schedule_cron: string | null
  last_deployed_at: string | null
}

interface CPServer {
  id: number
  name: string
  host: string
  ssh_port: number
  ssh_user: string
  ssh_key: string | null
  ssh_password: string | null
}

interface CPSite {
  domain: string
  path: string
  user: string
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

// ── Helpers ───────────────────────────────────────────────────────────────────

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

const emptyRepoForm = {
  name: '', repo_url: '', branch: 'main', local_path: '',
  server_id: '', auth_type: 'https', ssh_private_key: '', access_token: '',
  db_type: 'postgres', db_host: '', db_port: '', schedule_enabled: false, schedule_cron: '',
}

// ── Page ──────────────────────────────────────────────────────────────────────

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

  // Edit modal state
  const [showEditModal, setShowEditModal] = useState(false)
  const [repoForm, setRepoForm] = useState({ ...emptyRepoForm })
  const [savingRepo, setSavingRepo] = useState(false)
  const [servers, setServers] = useState<CPServer[]>([])
  const [loadingServers, setLoadingServers] = useState(false)
  const [cpSites, setCpSites] = useState<CPSite[]>([])
  const [loadingSites, setLoadingSites] = useState(false)
  const [showSitePicker, setShowSitePicker] = useState(false)

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

  // ── Deployment detail ──────────────────────────────────────────────────────

  async function loadDepDetail(depId: number) {
    if (depDetail[depId]) { setExpandedDep(expandedDep === depId ? null : depId); return }
    const res = await fetch(`${API_URL}/cicd/repos/${id}/deployments/${depId}`, {
      headers: { Authorization: `Bearer ${getAuthToken()}` },
    })
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

  // ── Edit modal ─────────────────────────────────────────────────────────────

  async function fetchServers() {
    setLoadingServers(true)
    try {
      const res = await fetch(`${API_URL}/cloudpanel/servers`, { headers: { Authorization: `Bearer ${getAuthToken()}` } })
      if (res.ok) setServers(await res.json())
    } finally { setLoadingServers(false) }
  }

  function openEdit() {
    if (!repo) return
    setRepoForm({
      name: repo.name,
      repo_url: repo.repo_url,
      branch: repo.branch,
      local_path: repo.local_path,
      server_id: repo.server_id ? String(repo.server_id) : '',
      auth_type: repo.auth_type,
      ssh_private_key: '',
      access_token: '',
      db_type: repo.db_type || 'postgres',
      db_host: repo.db_host || '',
      db_port: repo.db_port ? String(repo.db_port) : '',
      schedule_enabled: repo.schedule_enabled,
      schedule_cron: repo.schedule_cron || '',
    })
    setCpSites([])
    setShowSitePicker(false)
    fetchServers()
    setShowEditModal(true)
  }

  async function loadCPSites(serverId: string) {
    if (!serverId) { setCpSites([]); setShowSitePicker(false); return }
    setLoadingSites(true)
    setShowSitePicker(true)
    try {
      const res = await fetch(`${API_URL}/cicd/servers/${serverId}/cloudpanel-sites`, {
        headers: { Authorization: `Bearer ${getAuthToken()}` },
      })
      if (res.ok) {
        setCpSites(await res.json())
      } else {
        const d = await res.json().catch(() => null)
        flash('error', d?.detail || 'Failed to load CloudPanel sites.')
        setShowSitePicker(false)
      }
    } finally { setLoadingSites(false) }
  }

  function selectCPSite(site: CPSite) {
    setRepoForm(f => ({ ...f, local_path: site.path, name: f.name || site.domain }))
    setShowSitePicker(false)
  }

  async function deleteRepo() {
    if (!confirm(`Delete "${repo?.name}"? This will remove all deployment history, script logs, and migration logs for this repository.`)) return
    const res = await fetch(`${API_URL}/cicd/repos/${id}`, { method: 'DELETE', headers: authHeaders() })
    if (res.ok) {
      router.push('/admin/cicd')
    } else {
      flash('error', 'Failed to delete repository.')
    }
  }

  async function saveRepo(e: React.FormEvent) {
    e.preventDefault()
    setSavingRepo(true)
    try {
      const body: Record<string, unknown> = {
        name: repoForm.name,
        repo_url: repoForm.repo_url,
        branch: repoForm.branch,
        local_path: repoForm.local_path,
        server_id: repoForm.server_id ? parseInt(repoForm.server_id) : null,
        auth_type: repoForm.auth_type,
        db_type: repoForm.db_type || 'postgres',
        db_host: repoForm.db_host || null,
        db_port: repoForm.db_port ? parseInt(repoForm.db_port) : null,
        schedule_enabled: repoForm.schedule_enabled,
        schedule_cron: repoForm.schedule_cron || null,
      }
      if (repoForm.ssh_private_key) body.ssh_private_key = repoForm.ssh_private_key
      if (repoForm.access_token) body.access_token = repoForm.access_token

      const res = await fetch(`${API_URL}/cicd/repos/${id}`, {
        method: 'PUT',
        headers: authHeaders(),
        body: JSON.stringify(body),
      })
      if (res.ok) {
        flash('success', 'Repository updated successfully.')
        setShowEditModal(false)
        fetchAll()
      } else {
        const d = await res.json().catch(() => null)
        flash('error', d?.detail || 'Save failed.')
      }
    } finally { setSavingRepo(false) }
  }

  const rField = (key: keyof typeof repoForm) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
      setRepoForm(f => ({ ...f, [key]: e.target.value }))

  // ── Derived ────────────────────────────────────────────────────────────────

  const dbNames = [...new Set(migrationLogs.map(m => m.database_name))].sort()
  const filteredMigs = dbFilter ? migrationLogs.filter(m => m.database_name === dbFilter) : migrationLogs

  if (loading) return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="text-gray-400">Loading…</div>
    </div>
  )

  return (
    <div className="min-h-screen bg-gray-50">
      <MainHeader user={user!} />
      <AdminNav />
      <main className="ml-0 md:ml-60 pt-14 p-6 pb-16 md:pb-0">
        <div className="max-w-6xl mx-auto">

          {/* ── Header ──────────────────────────────────────────────────── */}
          <div className="flex items-center gap-3 mb-6">
            <button onClick={() => router.push('/admin/cicd')} className="text-gray-400 hover:text-gray-600 text-sm">
              ← Pipelines
            </button>
            <span className="text-gray-300">/</span>
            <div className="flex-1">
              <h1 className="text-2xl font-bold text-gray-900">{repo?.name}</h1>
              <p className="text-xs text-gray-400 font-mono">{repo?.repo_url} · {repo?.branch}</p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={openEdit}
                className="px-4 py-2 bg-white border border-gray-200 text-gray-700 rounded-xl text-sm font-semibold hover:bg-gray-50 shadow-sm"
              >
                ✏️ Edit
              </button>
              <button
                onClick={deleteRepo}
                className="px-4 py-2 bg-white border border-red-200 text-red-600 rounded-xl text-sm font-semibold hover:bg-red-50 shadow-sm"
              >
                🗑 Delete
              </button>
              <button
                onClick={deployNow}
                disabled={deploying}
                className="px-4 py-2 bg-green-600 text-white rounded-xl text-sm font-semibold hover:bg-green-700 disabled:opacity-50 shadow"
              >
                {deploying ? '⏳ Deploying…' : '▶ Deploy Now'}
              </button>
            </div>
          </div>

          {/* ── Flash ───────────────────────────────────────────────────── */}
          {msg && (
            <div className={`mb-4 px-4 py-3 rounded-xl text-sm font-medium flex items-center gap-2 ${msg.type === 'success' ? 'bg-green-50 border border-green-200 text-green-800' : 'bg-red-50 border border-red-200 text-red-800'}`}>
              {msg.type === 'success' ? '✅' : '❌'} {msg.text}
            </div>
          )}

          {/* ── Repo info strip ─────────────────────────────────────────── */}
          {repo && (
            <div className="bg-white rounded-2xl border border-gray-200 p-4 mb-6 flex flex-wrap gap-6 text-sm">
              <div>
                <span className="text-gray-400 text-xs">Server</span>
                <div className="text-xs mt-0.5 font-medium">
                  {repo.server_name
                    ? <span className="text-indigo-700">🖥 {repo.server_name}</span>
                    : <span className="text-gray-400">Local</span>}
                </div>
              </div>
              <div>
                <span className="text-gray-400 text-xs">Auth</span>
                <div className="text-xs mt-0.5">{repo.auth_type === 'ssh' ? '🔑 SSH' : '🔒 HTTPS'}</div>
              </div>
              <div>
                <span className="text-gray-400 text-xs">Path</span>
                <div className="font-mono text-xs mt-0.5 text-gray-600">{repo.local_path}</div>
              </div>
              <div>
                <span className="text-gray-400 text-xs">Schedule</span>
                <div className="font-mono text-xs mt-0.5">
                  {repo.schedule_enabled && repo.schedule_cron ? repo.schedule_cron : 'Manual only'}
                </div>
              </div>
              <div>
                <span className="text-gray-400 text-xs">Last Deployed</span>
                <div className="text-xs mt-0.5">
                  {repo.last_deployed_at ? new Date(repo.last_deployed_at).toLocaleString() : 'Never'}
                </div>
              </div>
              <div>
                <span className="text-gray-400 text-xs">Deployments</span>
                <div className="font-semibold mt-0.5">{deployments.length}</div>
              </div>
              <div>
                <span className="text-gray-400 text-xs">Scripts Run</span>
                <div className="font-semibold mt-0.5">{scriptLogs.length}</div>
              </div>
              <div>
                <span className="text-gray-400 text-xs">Migrations Applied</span>
                <div className="font-semibold mt-0.5">{migrationLogs.filter(m => m.status === 'success').length}</div>
              </div>
            </div>
          )}

          {/* ── Tabs ────────────────────────────────────────────────────── */}
          <div className="flex border-b border-gray-200 mb-6">
            {([['deployments', '🚀 Deployments'], ['scripts', '📜 Scripts'], ['migrations', '🗄️ Migrations']] as const).map(([tab, label]) => (
              <button key={tab} onClick={() => setActiveTab(tab)}
                className={`px-5 py-3 text-sm font-medium border-b-2 -mb-px transition ${activeTab === tab ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
                {label}
              </button>
            ))}
          </div>

          {/* ── Deployments tab ─────────────────────────────────────────── */}
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
                            <button onClick={() => loadDepDetail(dep.id)} className="text-xs text-blue-600 hover:underline">
                              {expandedDep === dep.id ? 'Hide' : 'Details'}
                            </button>
                          </td>
                        </tr>
                        {expandedDep === dep.id && depDetail[dep.id] && (
                          <tr key={`${dep.id}-detail`}>
                            <td colSpan={6} className="bg-gray-50 px-6 py-4">
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

          {/* ── Scripts tab ─────────────────────────────────────────────── */}
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

          {/* ── Migrations tab ──────────────────────────────────────────── */}
          {activeTab === 'migrations' && (
            <div>
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

      {/* ── Edit Repository Modal ────────────────────────────────────────────── */}
      {showEditModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between sticky top-0 bg-white z-10">
              <h2 className="text-lg font-bold text-gray-900">Edit Repository</h2>
              <button onClick={() => setShowEditModal(false)} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
            </div>

            <form onSubmit={saveRepo} className="px-6 py-5 space-y-5">

              {/* Basic */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">Name</label>
                  <input value={repoForm.name} onChange={rField('name')} required placeholder="My App"
                    className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">Branch</label>
                  <input value={repoForm.branch} onChange={rField('branch')} required placeholder="main"
                    className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Git URL</label>
                <input value={repoForm.repo_url} onChange={rField('repo_url')} required
                  placeholder="https://github.com/org/repo.git or git@github.com:org/repo.git"
                  className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>

              {/* Server + CloudPanel site picker */}
              <div className="border border-gray-100 rounded-xl p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <label className="block text-xs font-semibold text-gray-600">Deployment Server</label>
                  <a href="/admin/cloudpanel/servers" target="_blank" className="text-xs text-blue-500 hover:underline">Manage servers ↗</a>
                </div>
                {loadingServers ? (
                  <div className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-400 bg-gray-50">Loading servers…</div>
                ) : (
                  <select
                    value={repoForm.server_id}
                    onChange={e => { rField('server_id')(e); loadCPSites(e.target.value) }}
                    className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="">— Local (same machine as this app) —</option>
                    {servers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                )}

                {/* CloudPanel site picker */}
                {repoForm.server_id && (
                  <div>
                    {loadingSites ? (
                      <div className="text-xs text-gray-400 py-2">Loading CloudPanel sites…</div>
                    ) : showSitePicker && cpSites.length > 0 ? (
                      <div>
                        <label className="block text-xs font-semibold text-gray-600 mb-2">
                          Pick a CloudPanel site <span className="font-normal text-gray-400">(auto-fills path below)</span>
                        </label>
                        <div className="max-h-40 overflow-y-auto border border-gray-100 rounded-xl divide-y divide-gray-50">
                          {cpSites.map(site => (
                            <button key={site.domain} type="button" onClick={() => selectCPSite(site)}
                              className="w-full text-left px-3 py-2 hover:bg-blue-50 text-sm transition">
                              <span className="font-medium text-gray-800">{site.domain}</span>
                              <span className="ml-2 text-xs text-gray-400 font-mono">{site.path}</span>
                              <span className="ml-2 text-xs text-gray-400">({site.user})</span>
                            </button>
                          ))}
                        </div>
                      </div>
                    ) : showSitePicker && cpSites.length === 0 && !loadingSites ? (
                      <div className="text-xs text-gray-400">No sites found in CloudPanel.</div>
                    ) : null}
                  </div>
                )}

                {/* Local path */}
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">
                    Local Path <span className="font-normal text-gray-400">(absolute path on the target server)</span>
                  </label>
                  <input value={repoForm.local_path} onChange={rField('local_path')} required placeholder="/var/www/myapp"
                    className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
              </div>

              {/* Git auth */}
              <div className="border border-gray-100 rounded-xl p-4">
                <label className="block text-xs font-semibold text-gray-600 mb-3">Git Authentication</label>
                <div className="flex gap-3 mb-3">
                  {['https', 'ssh'].map(t => (
                    <button key={t} type="button"
                      onClick={() => setRepoForm(f => ({ ...f, auth_type: t }))}
                      className={`px-4 py-1.5 rounded-lg text-xs font-semibold border transition ${repoForm.auth_type === t ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}`}>
                      {t === 'https' ? '🔒 HTTPS Token' : '🔑 SSH Key'}
                    </button>
                  ))}
                </div>
                {repoForm.auth_type === 'https' ? (
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Personal Access Token <span className="text-gray-400">(leave blank to keep existing)</span></label>
                    <input type="password" value={repoForm.access_token} onChange={rField('access_token')} placeholder="ghp_xxxxxxxxxxxx"
                      className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500" />
                    {repo?.has_access_token && !repoForm.access_token && (
                      <p className="text-xs text-green-600 mt-1">✅ Existing token saved — fill in only to replace it</p>
                    )}
                  </div>
                ) : (
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">SSH Private Key (PEM) <span className="text-gray-400">(leave blank to keep existing)</span></label>
                    <textarea value={repoForm.ssh_private_key} onChange={rField('ssh_private_key')} rows={5}
                      placeholder="-----BEGIN RSA PRIVATE KEY-----&#10;..."
                      className="w-full border border-gray-200 rounded-xl px-3 py-2 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-blue-500" />
                    {repo?.has_ssh_key && !repoForm.ssh_private_key && (
                      <p className="text-xs text-green-600 mt-1">✅ Existing SSH key saved — paste only to replace it</p>
                    )}
                  </div>
                )}
              </div>

              {/* DB type */}
              <div className="border border-gray-100 rounded-xl p-4">
                <label className="block text-xs font-semibold text-gray-600 mb-1">
                  Database Migrations <span className="font-normal text-gray-400">(optional)</span>
                </label>
                <p className="text-xs text-gray-400 mb-3">
                  For <code className="bg-gray-100 px-1 rounded">database/db.csv</code> migrations. Runs on the same server — no credentials needed.
                </p>
                <div className="flex gap-3">
                  {[{ value: 'postgres', label: '🐘 PostgreSQL' }, { value: 'mysql', label: '🐬 MySQL' }].map(opt => (
                    <button key={opt.value} type="button"
                      onClick={() => setRepoForm(f => ({ ...f, db_type: opt.value }))}
                      className={`px-4 py-1.5 rounded-lg text-xs font-semibold border transition ${repoForm.db_type === opt.value ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}`}>
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Schedule */}
              <div className="border border-gray-100 rounded-xl p-4">
                <div className="flex items-center justify-between mb-3">
                  <label className="text-xs font-semibold text-gray-600">Scheduled Deployment</label>
                  <button type="button"
                    onClick={() => setRepoForm(f => ({ ...f, schedule_enabled: !f.schedule_enabled }))}
                    className={`relative inline-flex h-5 w-10 rounded-full transition ${repoForm.schedule_enabled ? 'bg-blue-600' : 'bg-gray-300'}`}>
                    <span className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition ${repoForm.schedule_enabled ? 'translate-x-5' : ''}`} />
                  </button>
                </div>
                {repoForm.schedule_enabled && (
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Cron expression</label>
                    <input value={repoForm.schedule_cron} onChange={rField('schedule_cron')} placeholder="0 2 * * *"
                      className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500" />
                    <p className="text-xs text-gray-400 mt-1">minute hour day month weekday — e.g. <code>0 2 * * *</code></p>
                  </div>
                )}
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => setShowEditModal(false)}
                  className="px-4 py-2 border border-gray-200 rounded-xl text-sm text-gray-600 hover:bg-gray-50">
                  Cancel
                </button>
                <button type="submit" disabled={savingRepo}
                  className="px-5 py-2 bg-blue-600 text-white rounded-xl text-sm font-semibold hover:bg-blue-700 disabled:opacity-50">
                  {savingRepo ? 'Saving…' : 'Save Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
