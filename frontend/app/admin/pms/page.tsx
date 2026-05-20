'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { pmsApi, teamsApi } from '@/lib/api';
import { API_URL } from '@/lib/config';
import { getAuthToken } from '@/lib/auth';
import MainHeader from '@/components/MainHeader';
import AdminNav from '@/components/AdminNav';
import { authAPI } from '@/lib/auth';

const KbEditor = dynamic(() => import('@/components/KbEditor'), { ssr: false });

const PRIORITY_DOT: Record<string, string> = { low: 'bg-gray-400', medium: 'bg-yellow-500', high: 'bg-orange-500', urgent: 'bg-red-500' };
const STAGE_BADGE: Record<string, string> = { development: 'bg-indigo-100 text-indigo-700', qa: 'bg-amber-100 text-amber-700', pm_review: 'bg-purple-100 text-purple-700', client_review: 'bg-cyan-100 text-cyan-700', approved: 'bg-green-100 text-green-700', completed: 'bg-gray-100 text-gray-600' };
const STATUS_COLORS: Record<string, string> = { planning: 'bg-gray-100 text-gray-700', active: 'bg-green-100 text-green-700', on_hold: 'bg-yellow-100 text-yellow-700', completed: 'bg-blue-100 text-blue-700' };

function EffBadge({ value }: { value: number | null }) {
  if (value === null) return null;
  const c = value >= 80 ? 'bg-green-100 text-green-700' : value >= 50 ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700';
  return <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${c}`}>{value}%</span>;
}

export default function PMSDashboard() {
  const router = useRouter();
  const user = authAPI.getUser();
  const [data, setData] = useState<any>(null);
  const [staleDays, setStaleDays] = useState(7);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const emptyForm = { name: '', description: '', color: '#6366f1', status: 'planning', start_date: '', end_date: '', team_id: '', owner_id: '' };
  const [form, setForm] = useState(emptyForm);
  const [createFiles, setCreateFiles] = useState<File[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const [creating, setCreating] = useState(false);
  const [teams, setTeams] = useState<any[]>([]);
  const [allUsers, setAllUsers] = useState<any[]>([]);
  const [selectedMemberIds, setSelectedMemberIds] = useState<number[]>([]);
  const [digestOpen, setDigestOpen] = useState(true);
  const [cpSort, setCpSort] = useState<{ field: string; dir: 'asc' | 'desc' }>({ field: 'name', dir: 'asc' });

  useEffect(() => {
    setLoading(true);
    pmsApi.getDashboard(staleDays).then(r => { setData(r.data); setLoading(false); }).catch(() => setLoading(false));
  }, [staleDays]);

  useEffect(() => {
    teamsApi.list().then(r => setTeams(Array.isArray(r.data) ? r.data : [])).catch(() => {});
    const token = getAuthToken();
    fetch(`${API_URL}/admin/users`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json())
      .then(data => setAllUsers(Array.isArray(data) ? data : []))
      .catch(() => {});
  }, []);

  const handleCreate = async () => {
    setCreating(true);
    try {
      const payload: any = { ...form };
      if (payload.team_id) payload.team_id = Number(payload.team_id);
      else delete payload.team_id;
      if (payload.owner_id) payload.owner_id = Number(payload.owner_id);
      else delete payload.owner_id;
      if (!payload.start_date) delete payload.start_date;
      if (!payload.end_date) delete payload.end_date;
      if (selectedMemberIds.length > 0) payload.member_ids = selectedMemberIds;
      const res = await pmsApi.createProject(payload);
      if (createFiles.length > 0 && res.data?.id) {
        await Promise.all(createFiles.map(f => pmsApi.uploadProjectDocument(res.data.id, f)));
      }
      setShowCreate(false);
      setForm(emptyForm);
      setCreateFiles([]);
      setSelectedMemberIds([]);
      pmsApi.getDashboard(staleDays).then(r => setData(r.data));
    } finally {
      setCreating(false);
    }
  };

  if (!user) return null;

  const metrics = data?.metrics || {};
  const myTasks = data?.my_tasks || [];
  const projects = data?.projects || [];

  return (
    <div className="ml-60 pt-14 min-h-screen bg-gray-50">
      <MainHeader user={user} />
      <AdminNav />
      <div className="p-6">
        {/* Header */}
        <div className="flex justify-between items-center mb-6">
          <h1 className="text-2xl font-bold text-gray-900">PMS Dashboard</h1>
          <button onClick={() => setShowCreate(true)}
            className="bg-indigo-600 text-white px-4 py-2 rounded-lg hover:bg-indigo-700 font-medium text-sm">
            + New Project
          </button>
        </div>

        {loading ? (
          <div className="text-gray-400 text-center py-20">Loading dashboard...</div>
        ) : (
          <>
            {/* ── Metrics Cards ───────────────────────────────────── */}
            <div className="grid grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
              {/* Total Tasks */}
              <div className="bg-white rounded-xl border border-gray-200 p-5">
                <p className="text-xs font-medium text-indigo-600 uppercase tracking-wide mb-1">Total Tasks</p>
                <p className="text-3xl font-bold text-gray-900">{metrics.total_tasks ?? 0}</p>
                <p className="text-sm text-gray-500 mt-1">{metrics.completion_pct ?? 0}% completed</p>
              </div>

              {/* Overdue */}
              <Link href="/admin/pms/my-tasks?filter=overdue" className="bg-white rounded-xl border border-gray-200 p-5 hover:shadow-md transition-shadow">
                <p className="text-xs font-medium text-red-600 uppercase tracking-wide mb-1">Overdue</p>
                <p className="text-3xl font-bold text-gray-900">{metrics.overdue_count ?? 0}</p>
                <p className="text-sm text-gray-500 mt-1">tasks past due</p>
              </Link>

              {/* Urgent / Client */}
              <Link href="/admin/pms/my-tasks?filter=urgent" className="bg-white rounded-xl border border-gray-200 p-5 hover:shadow-md transition-shadow">
                <p className="text-xs font-medium text-orange-600 uppercase tracking-wide mb-1">Urgent / Client</p>
                <p className="text-3xl font-bold text-gray-900">{metrics.urgent_client_count ?? 0}</p>
                <p className="text-sm text-gray-500 mt-1">awaiting action</p>
              </Link>

              {/* Stale Tasks */}
              <div className="bg-white rounded-xl border border-gray-200 p-5">
                <div className="flex items-center justify-between mb-1">
                  <p className="text-xs font-medium text-amber-600 uppercase tracking-wide">Stale Tasks</p>
                  <select
                    value={staleDays}
                    onChange={e => setStaleDays(Number(e.target.value))}
                    className="text-xs border rounded px-1.5 py-0.5 text-gray-600"
                  >
                    <option value={3}>3 days</option>
                    <option value={7}>7 days</option>
                    <option value={14}>14 days</option>
                    <option value={30}>30 days</option>
                  </select>
                </div>
                <p className="text-3xl font-bold text-gray-900">{metrics.stale_count ?? 0}</p>
                <p className="text-sm text-gray-500 mt-1">no activity in {staleDays}d</p>
              </div>

              {/* Hours */}
              <div className="bg-white rounded-xl border border-gray-200 p-5">
                <p className="text-xs font-medium text-blue-600 uppercase tracking-wide mb-1">Hours</p>
                <p className="text-3xl font-bold text-gray-900">
                  {metrics.total_actual_hours ?? 0}<span className="text-lg text-gray-400">/{metrics.total_estimated_hours ?? 0}</span>
                </p>
                <p className="text-sm text-gray-500 mt-1">{metrics.hours_utilization_pct ?? 0}% utilized</p>
              </div>

              {/* Active Projects */}
              <div className="bg-white rounded-xl border border-gray-200 p-5">
                <p className="text-xs font-medium text-green-600 uppercase tracking-wide mb-1">Active Projects</p>
                <p className="text-3xl font-bold text-gray-900">{metrics.active_projects ?? 0}</p>
                <p className="text-sm text-gray-500 mt-1">of {metrics.total_projects ?? 0} total</p>
              </div>
            </div>

            {/* ── Admin-Only Extra Metric Cards ────────────────────── */}
            {data?.is_admin && (
              <div className="grid grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
                {/* Health Score */}
                <div className="bg-white rounded-xl border border-gray-200 p-5">
                  <p className="text-xs font-medium text-gray-600 uppercase tracking-wide mb-1">Health Score</p>
                  <p className={`text-3xl font-bold ${
                    (data?.health_score ?? 0) >= 80 ? 'text-green-600' : (data?.health_score ?? 0) >= 50 ? 'text-amber-600' : 'text-red-600'
                  }`}>{data?.health_score ?? 0}%</p>
                  <p className="text-sm text-gray-500 mt-1">
                    {(data?.health_score ?? 0) >= 80 ? 'healthy' : (data?.health_score ?? 0) >= 50 ? 'needs attention' : 'at risk'}
                  </p>
                </div>

                {/* Escalations */}
                <Link href="/admin/pms/escalations" className="bg-white rounded-xl border border-gray-200 p-5 hover:shadow-md transition-shadow">
                  <p className="text-xs font-medium text-red-600 uppercase tracking-wide mb-1">Escalations</p>
                  <p className="text-3xl font-bold text-gray-900">{data?.escalation_count ?? 0}</p>
                  <p className="text-sm text-gray-500 mt-1">open escalations</p>
                </Link>

                {/* Pending Approvals */}
                <Link href="/admin/pms/approval-queue" className="bg-white rounded-xl border border-gray-200 p-5 hover:shadow-md transition-shadow">
                  <p className="text-xs font-medium text-purple-600 uppercase tracking-wide mb-1">Pending Approvals</p>
                  <p className="text-3xl font-bold text-gray-900">
                    {(data?.approval_counts?.pm_review || 0) + (data?.approval_counts?.client_review || 0)}
                  </p>
                  <p className="text-sm text-gray-500 mt-1">awaiting review</p>
                </Link>
              </div>
            )}

            {/* ── Weekly Digest (PM or Admin) ──────────────────────── */}
            {(data?.is_pm || data?.is_admin) && data?.weekly_digest && (
              <div className="bg-white rounded-xl border border-gray-200 mb-8">
                <button
                  onClick={() => setDigestOpen(!digestOpen)}
                  className="w-full flex items-center justify-between p-5"
                >
                  <h2 className="text-lg font-semibold text-gray-900">This Week Summary</h2>
                  <svg className={`w-5 h-5 text-gray-400 transition-transform ${digestOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
                {digestOpen && (
                  <div className="px-5 pb-5 grid grid-cols-2 lg:grid-cols-4 gap-4">
                    <div className="bg-green-50 rounded-lg p-4 text-center">
                      <p className="text-2xl font-bold text-green-700">{data.weekly_digest.completed ?? 0}</p>
                      <p className="text-xs text-green-600 font-medium mt-1">Completed</p>
                    </div>
                    <div className="bg-red-50 rounded-lg p-4 text-center">
                      <p className="text-2xl font-bold text-red-700">{data.weekly_digest.new_overdue ?? 0}</p>
                      <p className="text-xs text-red-600 font-medium mt-1">New Overdue</p>
                    </div>
                    <div className="bg-blue-50 rounded-lg p-4 text-center">
                      <p className="text-2xl font-bold text-blue-700">{data.weekly_digest.created ?? 0}</p>
                      <p className="text-xs text-blue-600 font-medium mt-1">Created</p>
                    </div>
                    <div className="bg-purple-50 rounded-lg p-4 text-center">
                      <p className="text-2xl font-bold text-purple-700">{data.weekly_digest.transitions ?? 0}</p>
                      <p className="text-xs text-purple-600 font-medium mt-1">Transitions</p>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* ── My Tasks Widget ─────────────────────────────────── */}
            <div className="bg-white rounded-xl border border-gray-200 p-5 mb-8">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <h2 className="text-lg font-semibold text-gray-900">My Tasks</h2>
                  {data?.avg_efficiency != null && <EffBadge value={data.avg_efficiency} />}
                </div>
                <Link href="/admin/pms/my-tasks" className="text-sm text-indigo-600 hover:text-indigo-800 font-medium">
                  View All &rarr;
                </Link>
              </div>
              {myTasks.length === 0 ? (
                <p className="text-gray-400 text-sm py-4 text-center">No tasks assigned to you.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs text-gray-500 uppercase border-b">
                        <th className="pb-2 pr-4">Task</th>
                        <th className="pb-2 pr-4">Project</th>
                        <th className="pb-2 pr-4">Priority</th>
                        <th className="pb-2 pr-4">Due</th>
                        <th className="pb-2">Stage</th>
                      </tr>
                    </thead>
                    <tbody>
                      {myTasks.slice(0, 5).map((t: any) => {
                        const isOverdue = t.due_date && new Date(t.due_date) < new Date();
                        return (
                          <tr key={t.id} className="border-b last:border-0 hover:bg-gray-50">
                            <td className="py-2.5 pr-4">
                              <Link href={`/admin/pms/${t.project_id}`} className="text-indigo-600 hover:underline font-medium truncate block max-w-[240px]">
                                {t.title}
                              </Link>
                            </td>
                            <td className="py-2.5 pr-4">
                              <div className="flex items-center gap-1.5">
                                {t.project_color && <span className="w-2 h-2 rounded-full flex-none" style={{ background: t.project_color }} />}
                                <span className="text-gray-600 truncate max-w-[140px]">{t.project_name || '-'}</span>
                              </div>
                            </td>
                            <td className="py-2.5 pr-4">
                              <span className={`inline-block w-2.5 h-2.5 rounded-full ${PRIORITY_DOT[t.priority] || 'bg-gray-300'}`} title={t.priority} />
                            </td>
                            <td className={`py-2.5 pr-4 whitespace-nowrap ${isOverdue ? 'text-red-600 font-medium' : 'text-gray-600'}`}>
                              {t.due_date || '-'}
                            </td>
                            <td className="py-2.5">
                              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STAGE_BADGE[t.stage] || 'bg-gray-100 text-gray-600'}`}>
                                {t.stage?.replace('_', ' ') || '-'}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* ── Cross-Project Deadlines Timeline (PM only) ──────── */}
            {data?.is_pm && (data?.upcoming_deadlines || []).length > 0 && (
              <div className="mb-8">
                <h2 className="text-lg font-semibold text-gray-900 mb-4">My Deadlines</h2>
                <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100">
                  {(data.upcoming_deadlines as any[]).map((d: any, i: number) => (
                    <div key={i} className="flex items-center gap-4 px-5 py-3">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                        d.type === 'milestone' ? 'bg-amber-100 text-amber-700' : 'bg-indigo-100 text-indigo-700'
                      }`}>{d.type}</span>
                      <div className="flex items-center gap-1.5 min-w-0 flex-1">
                        {d.project_color && <span className="w-2 h-2 rounded-full flex-none" style={{ background: d.project_color }} />}
                        <span className="text-xs text-gray-500 truncate max-w-[120px]">{d.project_name}</span>
                        <span className="text-gray-300 mx-1">|</span>
                        <span className="text-sm text-gray-900 font-medium truncate">{d.title}</span>
                      </div>
                      <span className="text-sm text-gray-500 whitespace-nowrap">{d.date}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ── Projects Grid ───────────────────────────────────── */}
            <div className="mb-2">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">Projects</h2>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {projects.map((p: any) => {
                const total = p.total_tasks || 0;
                const done = p.completed_tasks || 0;
                const pct = total > 0 ? Math.round((done / total) * 100) : 0;
                return (
                  <div key={p.id} onClick={() => router.push(`/admin/pms/${p.id}`)}
                    className="bg-white rounded-xl border border-gray-200 p-5 cursor-pointer hover:shadow-md transition-shadow">
                    <div className="flex items-center gap-3 mb-2">
                      <div className="w-3 h-3 rounded-full flex-none" style={{ background: p.color }} />
                      <h3 className="font-semibold text-gray-900 flex-1 truncate">{p.name}</h3>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLORS[p.status] || 'bg-gray-100 text-gray-600'}`}>
                        {p.status?.replace('_', ' ')}
                      </span>
                    </div>
                    {p.description && <p className="text-sm text-gray-500 mb-3 line-clamp-2">{p.description}</p>}

                    {/* Progress bar */}
                    <div className="mb-3">
                      <div className="flex items-center justify-between text-xs text-gray-500 mb-1">
                        <span>{done}/{total} tasks</span>
                        <span>{pct}%</span>
                      </div>
                      <div className="w-full bg-gray-100 rounded-full h-1.5">
                        <div className="h-1.5 rounded-full bg-indigo-500 transition-all" style={{ width: `${pct}%` }} />
                      </div>
                    </div>

                    {/* Badges row */}
                    <div className="flex items-center gap-2 flex-wrap mb-2">
                      {(p.overdue_count ?? 0) > 0 && (
                        <span className="text-xs px-1.5 py-0.5 rounded-full font-medium bg-red-100 text-red-700">
                          {p.overdue_count} overdue
                        </span>
                      )}
                      {p.efficiency != null && <EffBadge value={p.efficiency} />}
                    </div>

                    <div className="flex items-center gap-2 text-xs text-gray-400">
                      <span>{p.members?.length || p.member_count || 0} members</span>
                      {p.start_date && <><span>&middot;</span><span>{p.start_date} &rarr; {p.end_date || '?'}</span></>}
                    </div>
                  </div>
                );
              })}
              {projects.length === 0 && (
                <div className="col-span-3 text-center text-gray-400 py-20">No projects yet. Create your first one.</div>
              )}
            </div>
            {/* ── Cross-Project Summary Table (Admin only) ────────── */}
            {data?.is_admin && (data?.cross_project_summary || []).length > 0 && (() => {
              const sorted = [...(data.cross_project_summary as any[])].sort((a, b) => {
                const av = a[cpSort.field], bv = b[cpSort.field];
                if (av == null && bv == null) return 0;
                if (av == null) return 1;
                if (bv == null) return -1;
                const cmp = typeof av === 'string' ? av.localeCompare(bv) : av - bv;
                return cpSort.dir === 'asc' ? cmp : -cmp;
              });
              const toggleSort = (field: string) =>
                setCpSort(prev => ({ field, dir: prev.field === field && prev.dir === 'asc' ? 'desc' : 'asc' }));
              const sortIcon = (field: string) =>
                cpSort.field === field ? (cpSort.dir === 'asc' ? ' ▲' : ' ▼') : '';
              return (
                <div className="mt-8">
                  <h2 className="text-lg font-semibold text-gray-900 mb-4">Cross-Project Summary</h2>
                  <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-left text-xs text-gray-500 uppercase border-b">
                          <th className="px-5 py-3 cursor-pointer select-none" onClick={() => toggleSort('name')}>Project{sortIcon('name')}</th>
                          <th className="px-5 py-3 cursor-pointer select-none" onClick={() => toggleSort('pm_name')}>PM{sortIcon('pm_name')}</th>
                          <th className="px-5 py-3 cursor-pointer select-none" onClick={() => toggleSort('total_tasks')}>Tasks{sortIcon('total_tasks')}</th>
                          <th className="px-5 py-3 cursor-pointer select-none" onClick={() => toggleSort('completion_pct')}>Completion %{sortIcon('completion_pct')}</th>
                          <th className="px-5 py-3 cursor-pointer select-none" onClick={() => toggleSort('overdue_count')}>Overdue{sortIcon('overdue_count')}</th>
                          <th className="px-5 py-3 cursor-pointer select-none" onClick={() => toggleSort('efficiency')}>Efficiency{sortIcon('efficiency')}</th>
                          <th className="px-5 py-3 cursor-pointer select-none" onClick={() => toggleSort('health_score')}>Health{sortIcon('health_score')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {sorted.map((p: any) => (
                          <tr key={p.id} className="border-b last:border-0 hover:bg-gray-50">
                            <td className="px-5 py-3 font-medium text-gray-900">{p.name}</td>
                            <td className="px-5 py-3 text-gray-600">{p.pm_name || '-'}</td>
                            <td className="px-5 py-3 text-gray-600">{p.completed_tasks}/{p.total_tasks}</td>
                            <td className="px-5 py-3">
                              <div className="flex items-center gap-2">
                                <div className="w-16 bg-gray-100 rounded-full h-1.5">
                                  <div className="h-1.5 rounded-full bg-indigo-500" style={{ width: `${p.completion_pct ?? 0}%` }} />
                                </div>
                                <span className="text-gray-600">{p.completion_pct ?? 0}%</span>
                              </div>
                            </td>
                            <td className="px-5 py-3">
                              {(p.overdue_count ?? 0) > 0
                                ? <span className="text-xs px-1.5 py-0.5 rounded-full font-medium bg-red-100 text-red-700">{p.overdue_count}</span>
                                : <span className="text-gray-400">0</span>}
                            </td>
                            <td className="px-5 py-3"><EffBadge value={p.efficiency} /></td>
                            <td className="px-5 py-3"><EffBadge value={p.health_score} /></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            })()}
          </>
        )}

        {/* ── Create Project Modal ─────────────────────────────── */}
        {showCreate && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className="bg-white rounded-xl p-6 w-full max-w-2xl shadow-2xl max-h-[90vh] overflow-y-auto">
              <h2 className="text-lg font-semibold mb-4">New Project</h2>
              <div className="space-y-4">
                <div>
                  <label className="text-xs text-gray-500 block mb-1">Project Name *</label>
                  <input className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" placeholder="Project name"
                    value={form.name} onChange={e => setForm({...form, name: e.target.value})} autoFocus />
                </div>

                <div>
                  <label className="text-xs text-gray-500 block mb-1">Description</label>
                  <div className="border rounded-lg overflow-hidden">
                    <KbEditor content={form.description} onChange={(html: string) => setForm({...form, description: html})} />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-gray-500 block mb-1">Start Date</label>
                    <input type="date" className="w-full border rounded-lg px-3 py-2 text-sm"
                      value={form.start_date} onChange={e => setForm({...form, start_date: e.target.value})} />
                  </div>
                  <div>
                    <label className="text-xs text-gray-500 block mb-1">End Date</label>
                    <input type="date" className="w-full border rounded-lg px-3 py-2 text-sm"
                      value={form.end_date} onChange={e => setForm({...form, end_date: e.target.value})} />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-gray-500 block mb-1">Owner / PM</label>
                    <select className="w-full border rounded-lg px-3 py-2 text-sm bg-white"
                      value={form.owner_id} onChange={e => setForm({...form, owner_id: e.target.value})}>
                      <option value="">Current user (me)</option>
                      {allUsers.map((u: any) => (
                        <option key={u.id} value={u.id}>{u.full_name || u.email}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="text-xs text-gray-500 block mb-1">Team</label>
                    <select className="w-full border rounded-lg px-3 py-2 text-sm bg-white"
                      value={form.team_id} onChange={e => { setForm({...form, team_id: e.target.value}); setSelectedMemberIds([]); }}>
                      <option value="">No team</option>
                      {teams.map((t: any) => (
                        <option key={t.id} value={t.id}>{t.name}</option>
                      ))}
                    </select>
                  </div>
                </div>

                {form.team_id && (() => {
                  const team = teams.find((t: any) => String(t.id) === String(form.team_id));
                  const members = team?.members || [];
                  if (members.length === 0) return null;
                  return (
                    <div>
                      <div className="flex items-center justify-between mb-1.5">
                        <label className="text-xs text-gray-500">
                          Team Members
                          {selectedMemberIds.length > 0 && <span className="ml-1 text-indigo-600 font-medium">({selectedMemberIds.length} selected)</span>}
                        </label>
                        <div className="flex gap-2">
                          <button type="button" onClick={() => setSelectedMemberIds(members.map((m: any) => m.id))}
                            className="text-xs text-indigo-600 hover:text-indigo-800">Select all</button>
                          <button type="button" onClick={() => setSelectedMemberIds([])}
                            className="text-xs text-gray-400 hover:text-gray-600">Clear</button>
                        </div>
                      </div>
                      <div className="border rounded-lg p-2 max-h-40 overflow-y-auto space-y-1">
                        {members.map((m: any) => (
                          <label key={m.id} className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-gray-50 cursor-pointer">
                            <input type="checkbox" className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                              checked={selectedMemberIds.includes(m.id)}
                              onChange={e => {
                                if (e.target.checked) setSelectedMemberIds(prev => [...prev, m.id]);
                                else setSelectedMemberIds(prev => prev.filter(id => id !== m.id));
                              }} />
                            <span className="text-sm text-gray-700 flex-1">{m.full_name}</span>
                            <span className="text-xs text-gray-400 capitalize">{m.role}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  );
                })()}

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-gray-500 block mb-1">Status</label>
                    <select className="w-full border rounded-lg px-3 py-2 text-sm bg-white"
                      value={form.status} onChange={e => setForm({...form, status: e.target.value})}>
                      <option value="planning">Planning</option>
                      <option value="active">Active</option>
                      <option value="on_hold">On Hold</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-xs text-gray-500 block mb-1">Color</label>
                    <div className="flex items-center gap-2 mt-0.5">
                      <input type="color" className="w-10 h-8 rounded cursor-pointer border"
                        value={form.color} onChange={e => setForm({...form, color: e.target.value})} />
                      <span className="text-xs text-gray-400">{form.color}</span>
                    </div>
                  </div>
                </div>

                <div>
                  <label className="text-xs text-gray-500 block mb-1">Project Documents</label>
                  <div
                    onClick={() => fileRef.current?.click()}
                    className="border border-dashed border-gray-300 rounded-lg px-3 py-3 text-center cursor-pointer hover:border-indigo-400 hover:bg-indigo-50/30 transition-colors">
                    <p className="text-xs text-gray-400">Click to attach files (specs, designs, contracts, etc.)</p>
                  </div>
                  <input ref={fileRef} type="file" multiple className="hidden"
                    onChange={e => setCreateFiles(prev => [...prev, ...Array.from(e.target.files || [])])} />
                  {createFiles.length > 0 && (
                    <ul className="mt-2 space-y-1">
                      {createFiles.map((f, i) => (
                        <li key={i} className="flex items-center gap-2 text-xs text-gray-600 bg-gray-50 rounded px-2 py-1">
                          <span className="flex-1 truncate">{f.name}</span>
                          <span className="text-gray-400">{(f.size / 1024).toFixed(0)} KB</span>
                          <button onClick={() => setCreateFiles(prev => prev.filter((_, j) => j !== i))}
                            className="text-red-400 hover:text-red-600">✕</button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
              <div className="flex gap-3 mt-5">
                <button onClick={() => { setShowCreate(false); setForm(emptyForm); setCreateFiles([]); setSelectedMemberIds([]); }}
                  className="flex-1 border rounded-lg px-4 py-2 text-sm">Cancel</button>
                <button onClick={handleCreate} disabled={!form.name || creating}
                  className="flex-1 bg-indigo-600 text-white rounded-lg px-4 py-2 text-sm disabled:opacity-50">
                  {creating ? 'Creating...' : 'Create Project'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
