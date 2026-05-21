'use client';
import { useEffect, useRef, useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import { pmsApi } from '@/lib/api';
import { API_URL } from '@/lib/config';
import { getAuthToken } from '@/lib/auth';
import MainHeader from '@/components/MainHeader';
import AdminNav from '@/components/AdminNav';
import { authAPI } from '@/lib/auth';
import { hasPermission } from '@/lib/permissions';

const KbEditor = dynamic(() => import('@/components/KbEditor'), { ssr: false });

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

const emptyForm = { name: '', description: '', color: '#6366f1', status: 'planning', start_date: '', end_date: '', owner_id: '' };

export default function ProjectsPage() {
  const router = useRouter();
  const user = authAPI.getUser();
  const [projects, setProjects] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [sortBy, setSortBy] = useState<'name' | 'status' | 'progress' | 'members'>('name');
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [createFiles, setCreateFiles] = useState<File[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');
  const [allUsers, setAllUsers] = useState<any[]>([]);
  const [selectedMembers, setSelectedMembers] = useState<{user_id: number, role: string}[]>([]);

  const load = () => {
    setLoading(true);
    pmsApi.getDashboard(7)
      .then(r => { setProjects(r.data?.projects || []); setLoading(false); })
      .catch(() => {
        pmsApi.listProjects()
          .then(r => { setProjects(r.data || []); setLoading(false); })
          .catch(() => setLoading(false));
      });
  };

  useEffect(() => { load(); }, []);

  useEffect(() => {
    const token = getAuthToken();
    fetch(`${API_URL}/admin/users`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json())
      .then(d => setAllUsers(Array.isArray(d) ? d : []))
      .catch(() => {});
  }, []);

  const handleCreate = async () => {
    if (!form.name.trim()) return;
    setCreating(true);
    setCreateError('');
    try {
      const payload: any = { ...form };
      if (payload.owner_id) payload.owner_id = Number(payload.owner_id);
      else delete payload.owner_id;
      if (!payload.start_date) delete payload.start_date;
      if (!payload.end_date) delete payload.end_date;
      if (selectedMembers.length > 0) payload.members_with_roles = selectedMembers;
      const res = await pmsApi.createProject(payload);
      if (createFiles.length > 0 && res.data?.id) {
        await Promise.all(createFiles.map(f => pmsApi.uploadProjectDocument(res.data.id, f)));
      }
      setShowCreate(false);
      setForm(emptyForm);
      setCreateFiles([]);
      setSelectedMembers([]);
      setCreateError('');
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
                      <><span>&middot;</span><span>{p.start_date} &rarr; {p.end_date || '?'}</span></>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Enhanced Create Project Modal */}
      {showCreate && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 w-full max-w-2xl shadow-2xl max-h-[90vh] overflow-y-auto">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">New Project</h3>
            <div className="space-y-4">
              <div>
                <label className="text-xs text-gray-500 block mb-1">Project Name *</label>
                <input className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  placeholder="Project name" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} autoFocus />
              </div>

              <div>
                <label className="text-xs text-gray-500 block mb-1">Description</label>
                <div className="border rounded-lg overflow-hidden">
                  <KbEditor content={form.description} onChange={(html: string) => setForm({ ...form, description: html })} />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-gray-500 block mb-1">Start Date</label>
                  <input type="date" className="w-full border rounded-lg px-3 py-2 text-sm"
                    value={form.start_date} onChange={e => setForm({ ...form, start_date: e.target.value })} />
                </div>
                <div>
                  <label className="text-xs text-gray-500 block mb-1">End Date</label>
                  <input type="date" className="w-full border rounded-lg px-3 py-2 text-sm"
                    value={form.end_date} onChange={e => setForm({ ...form, end_date: e.target.value })} />
                </div>
              </div>

              <div>
                <label className="text-xs text-gray-500 block mb-1">Owner / PM</label>
                <select className="w-full border rounded-lg px-3 py-2 text-sm bg-white"
                  value={form.owner_id} onChange={e => setForm({ ...form, owner_id: e.target.value })}>
                  <option value="">Current user (me)</option>
                  {allUsers.map((u: any) => (
                    <option key={u.id} value={u.id}>{u.full_name || u.email}</option>
                  ))}
                </select>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs text-gray-500">
                    Project Members
                    {selectedMembers.length > 0 && <span className="ml-1 text-indigo-600 font-medium">({selectedMembers.length} selected)</span>}
                  </label>
                  <div className="flex gap-2">
                    <button type="button" onClick={() => setSelectedMembers(allUsers.map((u: any) => ({ user_id: u.id, role: 'developer' })))}
                      className="text-xs text-indigo-600 hover:text-indigo-800">Select all</button>
                    <button type="button" onClick={() => setSelectedMembers([])}
                      className="text-xs text-gray-400 hover:text-gray-600">Clear</button>
                  </div>
                </div>
                <div className="border rounded-lg p-2 max-h-48 overflow-y-auto space-y-1">
                  {allUsers.map((u: any) => {
                    const sel = selectedMembers.find(s => s.user_id === u.id);
                    return (
                      <div key={u.id} className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-gray-50">
                        <input type="checkbox" className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                          checked={!!sel}
                          onChange={e => {
                            if (e.target.checked) setSelectedMembers(prev => [...prev, { user_id: u.id, role: 'developer' }]);
                            else setSelectedMembers(prev => prev.filter(s => s.user_id !== u.id));
                          }} />
                        <span className="text-sm text-gray-700 flex-1">{u.full_name || u.email}</span>
                        {sel && (
                          <select className="text-xs border rounded px-1.5 py-0.5 bg-white text-gray-600"
                            value={sel.role}
                            onChange={e => setSelectedMembers(prev => prev.map(s => s.user_id === u.id ? { ...s, role: e.target.value } : s))}>
                            <option value="pm">PM</option>
                            <option value="developer">Developer</option>
                            <option value="designer">Designer</option>
                            <option value="qa">QA</option>
                            <option value="viewer">Viewer</option>
                          </select>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-gray-500 block mb-1">Status</label>
                  <select className="w-full border rounded-lg px-3 py-2 text-sm bg-white"
                    value={form.status} onChange={e => setForm({ ...form, status: e.target.value })}>
                    <option value="planning">Planning</option>
                    <option value="active">Active</option>
                    <option value="on_hold">On Hold</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs text-gray-500 block mb-1">Color</label>
                  <div className="flex items-center gap-2 mt-0.5">
                    <input type="color" className="w-10 h-8 rounded cursor-pointer border"
                      value={form.color} onChange={e => setForm({ ...form, color: e.target.value })} />
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
                          className="text-red-400 hover:text-red-600">&times;</button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
            {createError && <p className="mt-3 text-sm text-red-600">{createError}</p>}
            <div className="flex gap-3 mt-5">
              <button onClick={() => { setShowCreate(false); setForm(emptyForm); setCreateFiles([]); setSelectedMembers([]); setCreateError(''); }}
                className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-600 hover:bg-gray-50">Cancel</button>
              <button onClick={handleCreate} disabled={!form.name.trim() || creating}
                className="flex-1 bg-indigo-600 text-white rounded-lg px-3 py-2 text-sm font-medium hover:bg-indigo-700 disabled:opacity-50">
                {creating ? 'Creating...' : 'Create Project'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
