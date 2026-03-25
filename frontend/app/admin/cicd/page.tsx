'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import MainHeader from '@/components/MainHeader'
import AdminNav from '@/components/AdminNav'
import { authAPI, getAuthToken } from '@/lib/auth'
import { API_URL } from '@/lib/config'

interface CPServer {
  id: number
  name: string
  host: string
  ssh_port: number
  ssh_user: string
  ssh_key: string | null
  ssh_password: string | null
  is_active: boolean
}

interface CICDRepo {
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
  created_at: string | null
}

interface CPSite {
  domain: string
  path: string
  user: string
}

interface DeployToast {
  id: number
  repoName: string
  deploymentId: number
  status: 'running' | 'success' | 'failed'
  step: string
  steps: string[]
  startedAt: number
}

const emptyRepoForm = {
  name: '',
  repo_url: '',
  branch: 'main',
  local_path: '',
  server_id: '',
  auth_type: 'https',
  ssh_private_key: '',
  access_token: '',
  db_type: 'postgres',
  db_host: '',
  db_port: '',
  schedule_enabled: false,
  schedule_cron: '',
}

function authHeaders() {
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${getAuthToken()}` }
}

function statusBadge(repo: CICDRepo) {
  if (!repo.last_deployed_at) return <span className="px-2 py-0.5 rounded text-xs bg-gray-100 text-gray-500">Never deployed</span>
  return <span className="px-2 py-0.5 rounded text-xs bg-green-100 text-green-700">Deployed</span>
}

function formatDuration(ms: number) {
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s`
  return `${Math.floor(s / 60)}m ${s % 60}s`
}

function ElapsedTimer({ startedAt }: { startedAt: number }) {
  const [, setTick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 1000)
    return () => clearInterval(id)
  }, [])
  return <span>Elapsed: {formatDuration(Date.now() - startedAt)}</span>
}

export default function CICDPage() {
  const router = useRouter()
  const [user] = useState(() => authAPI.getUser())
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  // Servers (from cloudpanel_servers)
  const [servers, setServers] = useState<CPServer[]>([])
  const [loadingServers, setLoadingServers] = useState(false)

  // Repos
  const [repos, setRepos] = useState<CICDRepo[]>([])
  const [loading, setLoading] = useState(true)
  const [showRepoModal, setShowRepoModal] = useState(false)
  const [editRepoId, setEditRepoId] = useState<number | null>(null)
  const [repoForm, setRepoForm] = useState({ ...emptyRepoForm })
  const [savingRepo, setSavingRepo] = useState(false)
  const [deploying, setDeploying] = useState<Record<number, boolean>>({})

  // CloudPanel site picker (inside repo modal)
  const [cpSites, setCpSites] = useState<CPSite[]>([])
  const [loadingSites, setLoadingSites] = useState(false)
  const [showSitePicker, setShowSitePicker] = useState(false)

  // Deploy toasts
  const [deployToasts, setDeployToasts] = useState<DeployToast[]>([])
  const pollTimers = useRef<Record<number, ReturnType<typeof setInterval>>>({})

  // Cleanup poll timers on unmount
  useEffect(() => {
    return () => {
      Object.values(pollTimers.current).forEach(clearInterval)
    }
  }, [])

  const fetchServers = useCallback(async () => {
    setLoadingServers(true)
    try {
      const res = await fetch(`${API_URL}/cloudpanel/servers`, {
        headers: { Authorization: `Bearer ${getAuthToken()}` },
      })
      if (res.ok) {
        setServers(await res.json())
      } else {
        console.error('Failed to load CloudPanel servers:', res.status)
      }
    } catch (e) {
      console.error('fetchServers error:', e)
    } finally {
      setLoadingServers(false)
    }
  }, [])

  const fetchRepos = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`${API_URL}/cicd/repos`, { headers: { Authorization: `Bearer ${getAuthToken()}` } })
      if (res.ok) setRepos(await res.json())
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!user || user.role !== 'admin') { router.push('/dashboard'); return }
    fetchServers()
    fetchRepos()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const flash = (type: 'success' | 'error', text: string) => {
    setMsg({ type, text })
    setTimeout(() => setMsg(null), 5000)
  }

  // ── CloudPanel site picker ─────────────────────────────────────────────────

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
    } finally {
      setLoadingSites(false)
    }
  }

  function selectCPSite(site: CPSite) {
    setRepoForm(f => ({
      ...f,
      local_path: site.path,
      name: f.name || site.domain,
    }))
    setShowSitePicker(false)
  }

  // ── Repo modal ─────────────────────────────────────────────────────────────

  function openAddRepo() {
    setRepoForm({ ...emptyRepoForm })
    setEditRepoId(null)
    setCpSites([])
    setShowSitePicker(false)
    fetchServers()
    setShowRepoModal(true)
  }

  function openEditRepo(repo: CICDRepo) {
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
    setEditRepoId(repo.id)
    setCpSites([])
    setShowSitePicker(false)
    fetchServers()
    setShowRepoModal(true)
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

      const url = editRepoId ? `${API_URL}/cicd/repos/${editRepoId}` : `${API_URL}/cicd/repos`
      const method = editRepoId ? 'PUT' : 'POST'
      const res = await fetch(url, { method, headers: authHeaders(), body: JSON.stringify(body) })
      if (res.ok) {
        flash('success', editRepoId ? 'Repository updated.' : 'Repository added.')
        setShowRepoModal(false)
        fetchRepos()
      } else {
        const d = await res.json().catch(() => null)
        flash('error', d?.detail || 'Save failed.')
      }
    } finally {
      setSavingRepo(false)
    }
  }

  async function deleteRepo(id: number) {
    if (!confirm('Delete this repository config?')) return
    const res = await fetch(`${API_URL}/cicd/repos/${id}`, { method: 'DELETE', headers: authHeaders() })
    if (res.ok) { flash('success', 'Deleted.'); fetchRepos() }
    else flash('error', 'Delete failed.')
  }

  function removeDeployToast(deploymentId: number) {
    setDeployToasts(t => t.filter(x => x.deploymentId !== deploymentId))
    if (pollTimers.current[deploymentId]) {
      clearInterval(pollTimers.current[deploymentId])
      delete pollTimers.current[deploymentId]
    }
  }

  function deriveDeployStep(data: { status: string; git_output?: string | null; error?: string | null; script_logs?: unknown[]; migration_logs?: unknown[] }): { step: string; steps: string[] } {
    const steps: string[] = []
    steps.push('Starting deployment…')
    if (data.git_output) steps.push('Git pull completed')
    if (data.script_logs && (data.script_logs as unknown[]).length > 0) steps.push(`Ran ${(data.script_logs as unknown[]).length} script(s)`)
    if (data.migration_logs && (data.migration_logs as unknown[]).length > 0) steps.push(`Ran ${(data.migration_logs as unknown[]).length} migration(s)`)
    if (data.status === 'success') steps.push('Deployment succeeded!')
    if (data.status === 'failed') steps.push(`Failed: ${data.error?.slice(0, 100) || 'Unknown error'}`)

    const step = steps[steps.length - 1]
    return { step, steps }
  }

  async function pollDeployment(repoId: number, deploymentId: number) {
    try {
      const res = await fetch(`${API_URL}/cicd/repos/${repoId}/deployments/${deploymentId}`, {
        headers: { Authorization: `Bearer ${getAuthToken()}` },
      })
      if (!res.ok) return
      const data = await res.json()
      const { step, steps } = deriveDeployStep(data)

      setDeployToasts(prev => prev.map(t =>
        t.deploymentId === deploymentId
          ? { ...t, status: data.status, step, steps }
          : t
      ))

      if (data.status === 'success' || data.status === 'failed') {
        // Stop polling
        if (pollTimers.current[deploymentId]) {
          clearInterval(pollTimers.current[deploymentId])
          delete pollTimers.current[deploymentId]
        }
        setDeploying(d => ({ ...d, [repoId]: false }))
        fetchRepos()
        // Auto-remove toast after 8s
        setTimeout(() => removeDeployToast(deploymentId), 8000)
      }
    } catch {
      // Silently retry on next interval
    }
  }

  async function deployNow(id: number) {
    const repo = repos.find(r => r.id === id)
    setDeploying(d => ({ ...d, [id]: true }))
    try {
      const res = await fetch(`${API_URL}/cicd/repos/${id}/deploy`, { method: 'POST', headers: authHeaders() })
      if (res.ok) {
        const data = await res.json()
        const depId = data.deployment_id

        // Add progressive toast
        setDeployToasts(prev => [...prev, {
          id: Date.now(),
          repoName: repo?.name || `Repo #${id}`,
          deploymentId: depId,
          status: 'running',
          step: 'Starting deployment…',
          steps: ['Starting deployment…'],
          startedAt: Date.now(),
        }])

        // Poll every 2s for status updates
        pollTimers.current[depId] = setInterval(() => pollDeployment(id, depId), 2000)
      } else {
        flash('error', 'Failed to trigger deploy.')
        setDeploying(d => ({ ...d, [id]: false }))
      }
    } catch {
      flash('error', 'Failed to trigger deploy.')
      setDeploying(d => ({ ...d, [id]: false }))
    }
  }

  const rField = (key: keyof typeof repoForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setRepoForm(f => ({ ...f, [key]: e.target.value }))

  return (
    <div className="min-h-screen bg-gray-50">
      <MainHeader user={user!} />
      <AdminNav />
      <main className="ml-0 md:ml-60 pt-14 p-6 pb-16 md:pb-0">
        <div className="max-w-6xl mx-auto">
          {/* Header */}
          <div className="flex items-center justify-between mb-6">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">CI/CD Pipelines</h1>
              <p className="text-sm text-gray-500 mt-1">
                Git deployments via your{' '}
                <a href="/admin/cloudpanel/servers" className="text-blue-600 hover:underline">CloudPanel servers</a>
                {' '}— scripts and database migrations run automatically.
              </p>
            </div>
            <button onClick={openAddRepo} className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm font-semibold shadow">
              + Add Repository
            </button>
          </div>

          {/* Flash */}
          {msg && (
            <div className={`mb-4 px-4 py-3 rounded-xl text-sm font-medium flex items-center gap-2 ${msg.type === 'success' ? 'bg-green-50 border border-green-200 text-green-800' : 'bg-red-50 border border-red-200 text-red-800'}`}>
              {msg.type === 'success' ? '✅' : '❌'} {msg.text}
            </div>
          )}

          {/* Repos table */}
          <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
            {loading ? (
              <div className="text-center py-12 text-gray-400">Loading…</div>
            ) : repos.length === 0 ? (
              <div className="text-center py-12">
                <div className="text-4xl mb-3">🚀</div>
                <p className="text-gray-500 text-sm">No repositories yet. Add one to get started.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-gray-50 text-gray-500 uppercase text-xs">
                  <tr>
                    <th className="px-4 py-3 text-left">Repository</th>
                    <th className="px-4 py-3 text-left">Branch</th>
                    <th className="px-4 py-3 text-left">Server</th>
                    <th className="px-4 py-3 text-left">Auth</th>
                    <th className="px-4 py-3 text-left">Schedule</th>
                    <th className="px-4 py-3 text-left">Last Deployed</th>
                    <th className="px-4 py-3 text-left">Status</th>
                    <th className="px-4 py-3 text-left whitespace-nowrap">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {repos.map(repo => (
                    <tr key={repo.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3">
                        <div className="font-semibold text-gray-800">{repo.name}</div>
                        <div className="text-xs text-gray-400 font-mono truncate max-w-[200px]">{repo.repo_url}</div>
                      </td>
                      <td className="px-4 py-3">
                        <span className="font-mono text-xs bg-gray-100 px-2 py-0.5 rounded">{repo.branch}</span>
                      </td>
                      <td className="px-4 py-3 text-xs">
                        {repo.server_name
                          ? <span className="bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded font-medium">🖥 {repo.server_name}</span>
                          : <span className="text-gray-300">Local</span>}
                      </td>
                      <td className="px-4 py-3 text-gray-500 text-xs whitespace-nowrap">
                        {repo.auth_type === 'ssh' ? '🔑 SSH' : '🔒 HTTPS'}
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-500">
                        {repo.schedule_enabled && repo.schedule_cron
                          ? <span className="font-mono bg-blue-50 text-blue-700 px-2 py-0.5 rounded">{repo.schedule_cron}</span>
                          : <span className="text-gray-300">—</span>}
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-500 whitespace-nowrap">
                        {repo.last_deployed_at ? new Date(repo.last_deployed_at).toLocaleString() : '—'}
                      </td>
                      <td className="px-4 py-3">{statusBadge(repo)}</td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <div className="flex items-center gap-2">
                          <button onClick={() => deployNow(repo.id)} disabled={deploying[repo.id]}
                            className="px-3 py-1 bg-green-600 text-white rounded-lg text-xs font-semibold hover:bg-green-700 disabled:opacity-50 whitespace-nowrap">
                            {deploying[repo.id] ? '⏳ Deploying…' : '▶ Deploy'}
                          </button>
                          <button onClick={() => router.push(`/admin/cicd/${repo.id}`)}
                            className="px-3 py-1 bg-gray-100 text-gray-600 rounded-lg text-xs hover:bg-gray-200">Logs</button>
                          <button onClick={() => openEditRepo(repo)}
                            className="px-3 py-1 bg-blue-50 text-blue-600 rounded-lg text-xs hover:bg-blue-100">Edit</button>
                          <button onClick={() => deleteRepo(repo.id)}
                            className="px-3 py-1 bg-red-50 text-red-600 rounded-lg text-xs hover:bg-red-100">Delete</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            )}
          </div>
        </div>
      </main>

      {/* ── Deploy Progress Toasts ──────────────────────────────────────────── */}
      {deployToasts.length > 0 && (
        <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-3 max-w-sm">
          {deployToasts.map(toast => (
            <div key={toast.deploymentId}
              className={`rounded-2xl shadow-2xl border p-4 transition-all animate-in slide-in-from-right duration-300 ${
                toast.status === 'success' ? 'bg-green-50 border-green-200' :
                toast.status === 'failed' ? 'bg-red-50 border-red-200' :
                'bg-white border-gray-200'
              }`}
            >
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-bold text-gray-800">{toast.repoName}</span>
                  <span className="text-xs text-gray-400">#{toast.deploymentId}</span>
                </div>
                <button onClick={() => removeDeployToast(toast.deploymentId)}
                  className="text-gray-300 hover:text-gray-500 text-lg leading-none">&times;</button>
              </div>

              {/* Step progress */}
              <div className="space-y-1.5">
                {toast.steps.map((s, i) => {
                  const isLast = i === toast.steps.length - 1
                  const isFailed = toast.status === 'failed' && isLast
                  const isSuccess = toast.status === 'success' && isLast
                  return (
                    <div key={i} className="flex items-start gap-2 text-xs">
                      {isFailed ? (
                        <span className="text-red-500 mt-0.5 shrink-0">&#10007;</span>
                      ) : isSuccess ? (
                        <span className="text-green-600 mt-0.5 shrink-0">&#10003;</span>
                      ) : isLast && toast.status === 'running' ? (
                        <span className="mt-0.5 shrink-0">
                          <span className="inline-block w-3 h-3 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                        </span>
                      ) : (
                        <span className="text-green-600 mt-0.5 shrink-0">&#10003;</span>
                      )}
                      <span className={`${isFailed ? 'text-red-700 font-medium' : isSuccess ? 'text-green-700 font-medium' : isLast && toast.status === 'running' ? 'text-gray-700 font-medium' : 'text-gray-400'}`}>
                        {s}
                      </span>
                    </div>
                  )
                })}
              </div>

              {/* Elapsed time */}
              <div className="mt-2 text-[10px] text-gray-400">
                {toast.status === 'running'
                  ? <ElapsedTimer startedAt={toast.startedAt} />
                  : `Completed in ${formatDuration(Date.now() - toast.startedAt)}`}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Add / Edit Repo Modal ──────────────────────────────────────────── */}
      {showRepoModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
              <h2 className="text-lg font-bold text-gray-900">{editRepoId ? 'Edit Repository' : 'Add Repository'}</h2>
              <button onClick={() => setShowRepoModal(false)} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
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
                  <a href="/admin/cloudpanel/servers" target="_blank"
                    className="text-xs text-blue-500 hover:underline">Manage servers ↗</a>
                </div>
                {loadingServers ? (
                  <div className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-400 bg-gray-50">
                    Loading servers…
                  </div>
                ) : (
                  <select
                    value={repoForm.server_id}
                    onChange={e => {
                      rField('server_id')(e)
                      loadCPSites(e.target.value)
                    }}
                    className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="">— Local (same machine as this app) —</option>
                    {servers.map(s => (
                      <option key={s.id} value={String(s.id)}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                )}
                {!loadingServers && servers.length === 0 && (
                  <p className="text-xs text-amber-600 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
                    No CloudPanel servers found.{' '}
                    <a href="/admin/cloudpanel/servers" className="font-semibold underline">Add one here</a> first.
                  </p>
                )}

                {/* CloudPanel site picker — shown for any server */}
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
                            <button
                              key={site.domain}
                              type="button"
                              onClick={() => selectCPSite(site)}
                              className="w-full text-left px-3 py-2 hover:bg-blue-50 text-sm transition"
                            >
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
                    <label className="block text-xs text-gray-500 mb-1">Personal Access Token {editRepoId && '(leave blank to keep)'}</label>
                    <input type="password" value={repoForm.access_token} onChange={rField('access_token')} placeholder="ghp_xxxxxxxxxxxx"
                      className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500" />
                  </div>
                ) : (
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">SSH Private Key (PEM) {editRepoId && '(leave blank to keep)'}</label>
                    <textarea value={repoForm.ssh_private_key} onChange={rField('ssh_private_key')} rows={5}
                      placeholder="-----BEGIN RSA PRIVATE KEY-----&#10;..."
                      className="w-full border border-gray-200 rounded-xl px-3 py-2 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-blue-500" />
                  </div>
                )}
              </div>

              {/* DB type (for migrations) */}
              <div className="border border-gray-100 rounded-xl p-4">
                <label className="block text-xs font-semibold text-gray-600 mb-1">Database Migrations <span className="font-normal text-gray-400">(optional)</span></label>
                <p className="text-xs text-gray-400 mb-3">
                  For <code className="bg-gray-100 px-1 rounded">database/db.csv</code> migrations. Runs on the same server — no credentials needed.
                </p>
                <div>
                  <label className="block text-xs text-gray-500 mb-2">Database Type</label>
                  <div className="flex gap-3">
                    {[
                      { value: 'postgres', label: '🐘 PostgreSQL' },
                      { value: 'mysql', label: '🐬 MySQL' },
                    ].map(opt => (
                      <button key={opt.value} type="button"
                        onClick={() => setRepoForm(f => ({ ...f, db_type: opt.value }))}
                        className={`px-4 py-1.5 rounded-lg text-xs font-semibold border transition ${repoForm.db_type === opt.value ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}`}>
                        {opt.label}
                      </button>
                    ))}
                  </div>
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
                <button type="button" onClick={() => setShowRepoModal(false)}
                  className="px-4 py-2 border border-gray-200 rounded-xl text-sm text-gray-600 hover:bg-gray-50">Cancel</button>
                <button type="submit" disabled={savingRepo}
                  className="px-5 py-2 bg-blue-600 text-white rounded-xl text-sm font-semibold hover:bg-blue-700 disabled:opacity-50">
                  {savingRepo ? 'Saving…' : editRepoId ? 'Update' : 'Add Repository'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
