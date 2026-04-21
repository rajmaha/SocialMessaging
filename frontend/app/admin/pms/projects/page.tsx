'use client';
import { useEffect, useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { pmsApi } from '@/lib/api';
import MainHeader from '@/components/MainHeader';
import AdminNav from '@/components/AdminNav';
import { authAPI } from '@/lib/auth';
import { hasPermission } from '@/lib/permissions';

const STATUS_COLORS: Record<string, string> = {
  planning: 'bg-gray-100 text-gray-700',
  active: 'bg-green-100 text-green-700',
  on_hold: 'bg-yellow-100 text-yellow-700',
  completed: 'bg-blue-100 text-blue-700',
};

const STATUSES = ['planning', 'active', 'on_hold', 'completed'];

function EffBadge({ value }: { value: number | null }) {
  if (value === null || value === undefined) return null;
  const c = value >= 80 ? 'bg-green-100 text-green-700' : value >= 50 ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700';
  return <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${c}`}>{value}%</span>;
}

export default function ProjectsPage() {
  const router = useRouter();
  const user = authAPI.getUser();
  const [projects, setProjects] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [sortBy, setSortBy] = useState<'name' | 'status' | 'progress' | 'members'>('name');
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ name: '', description: '', color: '#6366f1', status: 'planning' });
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');

  const load = () => {
    setLoading(true);
    // Use dashboard to get enriched project data (task counts, efficiency, overdue)
    pmsApi.getDashboard(7)
      .then(r => { setProjects(r.data?.projects || []); setLoading(false); })
      .catch(() => {
        // Fallback to basic list
        pmsApi.listProjects()
          .then(r => { setProjects(r.data || []); setLoading(false); })
          .catch(() => setLoading(false));
      });
  };

  useEffect(() => { load(); }, []);

  const handleCreate = async () => {
    if (!form.name.trim()) return;
    setCreating(true);
    setCreateError('');
    try {
      const res = await pmsApi.createProject(form);
      setShowCreate(false);
      setForm({ name: '', description: '', color: '#6366f1', status: 'planning' });
      router.push(`/admin/pms/${res.data.id}`);
    } catch (err: any) {
      setCreateError(err?.response?.data?.detail || 'Failed to create project.');
    } finally {
      setCreating(false);
    }
  };

  const filtered = useMemo(() => {
    let list = [...projects];
    if (search) list = list.filter(p => p.name?.toLowerCase().includes(search.toLowerCase()));
    if (statusFilter) list = list.filter(p => p.status === statusFilter);
    list.sort((a, b) => {
      switch (sortBy) {
        case 'name': return (a.name || '').localeCompare(b.name || '');
        case 'status': return (a.status || '').localeCompare(b.status || '');
        case 'progress': {
          const pctA = a.total_tasks > 0 ? a.completed_tasks / a.total_tasks : 0;
          const pctB = b.total_tasks > 0 ? b.completed_tasks / b.total_tasks : 0;
          return pctB - pctA;
        }
        case 'members': return (b.members?.length || 0) - (a.members?.length || 0);
        default: return 0;
      }
    });
    return list;
  }, [projects, search, statusFilter, sortBy]);

  if (!user) return null;

  return (
    <div className="ml-0 md:ml-60 pt-14 min-h-screen bg-gray-50 pb-16 md:pb-0">
      <MainHeader user={user} />
      <AdminNav />
      <div className="p-6">
        {/* Header */}
        <div className="flex items-center gap-4 mb-6">
          <h1 className="text-2xl font-bold text-gray-900">Projects</h1>
          <span className="text-sm text-gray-400">{projects.length} total</span>
          {hasPermission('pms', 'add') && (
            <button onClick={() => setShowCreate(true)}
              className="ml-auto bg-indigo-600 text-white px-4 py-2 rounded-lg hover:bg-indigo-700 font-medium text-sm">
              + New Project
            </button>
          )}
        </div>

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-3 mb-6">
          <input
            className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm w-56 bg-white"
            placeholder="Search projects..."
            value={search} onChange={e => setSearch(e.target.value)}
          />
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm bg-white">
            <option value="">All Statuses</option>
            {STATUSES.map(s => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
          </select>
          <select value={sortBy} onChange={e => setSortBy(e.target.value as any)}
            className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm bg-white">
            <option value="name">Sort: Name</option>
            <option value="status">Sort: Status</option>
            <option value="progress">Sort: Progress</option>
            <option value="members">Sort: Members</option>
          </select>
        </div>

        {/* Grid */}
        {loading ? (
          <div className="text-gray-400 text-center py-20">Loading projects...</div>
        ) : filtered.length === 0 ? (
          <div className="text-gray-400 text-center py-20">
            {search || statusFilter ? 'No projects match your filters.' : 'No projects yet. Create your first one.'}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {filtered.map((p: any) => {
              const total = p.total_tasks || 0;
              const done = p.completed_tasks || 0;
              const pct = total > 0 ? Math.round((done / total) * 100) : 0;
              return (
                <div key={p.id} onClick={() => router.push(`/admin/pms/${p.id}`)}
                  className="bg-white rounded-xl border border-gray-200 p-5 cursor-pointer hover:shadow-md transition-shadow">
                  <div className="flex items-center gap-3 mb-2">
                    <div className="w-3 h-3 rounded-full flex-none" style={{ background: p.color || '#6366f1' }} />
                    <h3 className="font-semibold text-gray-900 flex-1 truncate">{p.name}</h3>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium capitalize ${STATUS_COLORS[p.status] || 'bg-gray-100 text-gray-600'}`}>
                      {p.status?.replace('_', ' ')}
                    </span>
                  </div>
                  {p.description && <p className="text-sm text-gray-500 mb-3 line-clamp-2">{p.description}</p>}

                  <div className="mb-3">
                    <div className="flex items-center justify-between text-xs text-gray-500 mb-1">
                      <span>{done}/{total} tasks</span>
                      <span>{pct}%</span>
                    </div>
                    <div className="w-full bg-gray-100 rounded-full h-1.5">
                      <div className="h-1.5 rounded-full bg-indigo-500 transition-all" style={{ width: `${pct}%` }} />
                    </div>
                  </div>

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
                    {p.start_date && (
                      <><span>&middot;</span><span>{p.start_date} → {p.end_date || '?'}</span></>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Create Project Modal */}
      {showCreate && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 w-[440px] shadow-xl">
            <h3 className="font-semibold text-gray-900 mb-4">New Project</h3>
            <div className="space-y-3">
              <input className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                placeholder="Project name *" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} autoFocus />
              <textarea className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-indigo-500"
                placeholder="Description" rows={3} value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} />
              <select className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white"
                value={form.status} onChange={e => setForm({ ...form, status: e.target.value })}>
                {STATUSES.map(s => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
              </select>
              <div className="flex items-center gap-3">
                <label className="text-sm text-gray-600">Color</label>
                <input type="color" className="h-8 w-16 rounded border border-gray-300 cursor-pointer"
                  value={form.color} onChange={e => setForm({ ...form, color: e.target.value })} />
                <span className="text-xs text-gray-400">{form.color}</span>
              </div>
            </div>
            {createError && <p className="mt-3 text-sm text-red-600">{createError}</p>}
            <div className="flex gap-3 mt-5">
              <button onClick={() => { setShowCreate(false); setCreateError(''); }}
                className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-600 hover:bg-gray-50">Cancel</button>
              <button onClick={handleCreate} disabled={!form.name.trim() || creating}
                className="flex-1 bg-indigo-600 text-white rounded-lg px-3 py-2 text-sm font-medium hover:bg-indigo-700 disabled:opacity-50">
                {creating ? 'Creating…' : 'Create Project'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
