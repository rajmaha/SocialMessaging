'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { pmsApi } from '@/lib/api';
import MainHeader from '@/components/MainHeader';
import AdminNav from '@/components/AdminNav';
import { authAPI } from '@/lib/auth';

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
  const [form, setForm] = useState({ name: '', description: '', color: '#6366f1', status: 'planning' });

  useEffect(() => {
    setLoading(true);
    pmsApi.getDashboard(staleDays).then(r => { setData(r.data); setLoading(false); }).catch(() => setLoading(false));
  }, [staleDays]);

  const handleCreate = async () => {
    await pmsApi.createProject(form);
    setShowCreate(false);
    setForm({ name: '', description: '', color: '#6366f1', status: 'planning' });
    pmsApi.getDashboard(staleDays).then(r => setData(r.data));
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
          </>
        )}

        {/* ── Create Project Modal ─────────────────────────────── */}
        {showCreate && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className="bg-white rounded-xl p-6 w-full max-w-md shadow-2xl">
              <h2 className="text-lg font-semibold mb-4">New Project</h2>
              <div className="space-y-3">
                <input className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="Project name"
                  value={form.name} onChange={e => setForm({...form, name: e.target.value})} />
                <textarea className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="Description" rows={3}
                  value={form.description} onChange={e => setForm({...form, description: e.target.value})} />
                <div className="flex gap-3">
                  <div>
                    <label className="text-xs text-gray-500 block mb-1">Color</label>
                    <input type="color" className="w-10 h-8 rounded cursor-pointer border"
                      value={form.color} onChange={e => setForm({...form, color: e.target.value})} />
                  </div>
                  <div className="flex-1">
                    <label className="text-xs text-gray-500 block mb-1">Status</label>
                    <select className="w-full border rounded-lg px-3 py-2 text-sm"
                      value={form.status} onChange={e => setForm({...form, status: e.target.value})}>
                      <option value="planning">Planning</option>
                      <option value="active">Active</option>
                      <option value="on_hold">On Hold</option>
                    </select>
                  </div>
                </div>
              </div>
              <div className="flex gap-3 mt-5">
                <button onClick={() => setShowCreate(false)} className="flex-1 border rounded-lg px-4 py-2 text-sm">Cancel</button>
                <button onClick={handleCreate} disabled={!form.name}
                  className="flex-1 bg-indigo-600 text-white rounded-lg px-4 py-2 text-sm disabled:opacity-50">Create</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
