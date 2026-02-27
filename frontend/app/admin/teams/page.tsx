'use client'

import MainHeader from '@/components/MainHeader';
import { authAPI } from '@/lib/auth';

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { getAuthToken } from '@/lib/auth'
import AdminNav from '@/components/AdminNav'

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

interface Agent {
  id: number
  full_name: string
  role: string
}

interface Team {
  id: number
  name: string
  description: string | null
  created_at: string
  members: Agent[]
}

export default function AdminTeams() {
  const user = authAPI.getUser();
  const router = useRouter()
  const [teams, setTeams] = useState<Team[]>([])
  const [agents, setAgents] = useState<Agent[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  // create / edit modal
  const [modal, setModal] = useState<{ open: boolean; team: Team | null }>({ open: false, team: null })
  const [formName, setFormName] = useState('')
  const [formDesc, setFormDesc] = useState('')
  const [formMembers, setFormMembers] = useState<number[]>([])

  const headers = (): Record<string, string> => {
    const t = getAuthToken()
    return t ? { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' } : { 'Content-Type': 'application/json' }
  }

  const load = async () => {
    setLoading(true)
    try {
      const [tr, ar] = await Promise.all([
        fetch(`${API}/teams/`, { headers: headers() }),
        fetch(`${API}/conversations/agents`, { headers: headers() }),
      ])
      if (tr.status === 401 || tr.status === 403) { router.push('/login'); return }
      setTeams(await tr.json())
      setAgents(await ar.json())
    } catch { setError('Failed to load data') }
    finally { setLoading(false) }
  }

  useEffect(() => { load() }, [])

  const openCreate = () => {
    setFormName(''); setFormDesc(''); setFormMembers([])
    setModal({ open: true, team: null })
  }

  const openEdit = (team: Team) => {
    setFormName(team.name)
    setFormDesc(team.description || '')
    setFormMembers(team.members.map(m => m.id))
    setModal({ open: true, team })
  }

  const toggleMember = (id: number) =>
    setFormMembers(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])

  const save = async () => {
    if (!formName.trim()) return
    setSaving(true)
    const body = { name: formName.trim(), description: formDesc.trim() || null, member_ids: formMembers }
    try {
      const res = modal.team
        ? await fetch(`${API}/teams/${modal.team.id}`, { method: 'PUT', headers: headers(), body: JSON.stringify(body) })
        : await fetch(`${API}/teams/`, { method: 'POST', headers: headers(), body: JSON.stringify(body) })
      if (!res.ok) { const d = await res.json(); setError(d.detail || 'Save failed'); return }
      setModal({ open: false, team: null })
      load()
    } catch { setError('Save failed') }
    finally { setSaving(false) }
  }

  const remove = async (id: number) => {
    if (!confirm('Delete this team?')) return
    await fetch(`${API}/teams/${id}`, { method: 'DELETE', headers: headers() })
    load()
  }

  return (
    <div className="ml-60 pt-14 min-h-screen bg-gray-50">
      <MainHeader user={user!} />
      <AdminNav />

      <div className="w-full py-8 px-4">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Teams</h1>
            <p className="text-sm text-gray-500 mt-0.5">Group agents into teams so conversations can be forwarded to a whole team at once.</p>
          </div>
          <button onClick={openCreate} className="px-4 py-2 text-white text-sm font-semibold rounded-lg transition" style={{ backgroundColor: 'var(--button-primary)' }}>
            + New Team
          </button>
        </div>

        {error && <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">{error}</div>}

        {loading ? (
          <div className="text-center text-gray-400 py-16">Loading…</div>
        ) : teams.length === 0 ? (
          <div className="text-center text-gray-400 py-16 border-2 border-dashed border-gray-200 rounded-xl">
            <p className="text-lg font-medium">No teams yet</p>
            <p className="text-sm mt-1">Create your first team to start routing conversations.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {teams.map(team => (
              <div key={team.id} className="bg-white border rounded-xl px-5 py-4 flex items-start gap-4">
                <div className="w-10 h-10 rounded-full flex items-center justify-center text-white text-lg font-bold flex-shrink-0" style={{ backgroundColor: 'var(--primary-color)' }}>
                  {team.name[0].toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-gray-800">{team.name}</p>
                  {team.description && <p className="text-sm text-gray-500 mt-0.5">{team.description}</p>}
                  <div className="flex flex-wrap gap-1 mt-2">
                    {team.members.length === 0 ? (
                      <span className="text-xs text-gray-400 italic">No members</span>
                    ) : team.members.map(m => (
                      <span key={m.id} className="text-xs bg-gray-100 text-gray-700 px-2 py-0.5 rounded-full font-medium">
                        {m.full_name}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="flex gap-2 flex-shrink-0">
                  <button onClick={() => openEdit(team)} className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 transition">Edit</button>
                  <button onClick={() => remove(team.id)} className="text-xs px-3 py-1.5 rounded-lg border border-red-200 text-red-600 hover:bg-red-50 transition">Delete</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Create / Edit modal */}
      {modal.open && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center" onClick={() => setModal({ open: false, team: null })}>
          <div className="bg-white rounded-xl shadow-xl p-6 w-[480px] max-w-full mx-4 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <h2 className="text-lg font-bold text-gray-800 mb-4">{modal.team ? 'Edit Team' : 'New Team'}</h2>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Team name *</label>
                <input
                  value={formName}
                  onChange={e => setFormName(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                  placeholder="e.g. Billing, Technical Support, Sales"
                  autoFocus
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
                <input
                  value={formDesc}
                  onChange={e => setFormDesc(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                  placeholder="What does this team handle?"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Members ({formMembers.length} selected)</label>
                <div className="border border-gray-200 rounded-lg divide-y max-h-48 overflow-y-auto">
                  {agents.map(a => (
                    <label key={a.id} className="flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-gray-50">
                      <input
                        type="checkbox"
                        checked={formMembers.includes(a.id)}
                        onChange={() => toggleMember(a.id)}
                        className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-400"
                      />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-800">{a.full_name}</p>
                        <p className="text-xs text-gray-400 capitalize">{a.role}</p>
                      </div>
                    </label>
                  ))}
                  {agents.length === 0 && <p className="text-sm text-gray-400 px-3 py-3 text-center">No agents available</p>}
                </div>
              </div>
            </div>

            <div className="flex gap-2 mt-6 justify-end">
              <button onClick={() => setModal({ open: false, team: null })} className="px-4 py-2 text-sm text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200 transition">
                Cancel
              </button>
              <button onClick={save} disabled={saving || !formName.trim()} className="px-4 py-2 text-sm text-white rounded-lg disabled:opacity-50 font-semibold transition" style={{ backgroundColor: 'var(--button-primary)' }}>
                {saving ? 'Saving…' : modal.team ? 'Save changes' : 'Create team'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
