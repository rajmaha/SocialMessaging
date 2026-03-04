'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { pmsApi } from '@/lib/api';

const STATUS_COLORS: Record<string, string> = {
  planning: 'bg-gray-100 text-gray-700',
  active: 'bg-green-100 text-green-700',
  on_hold: 'bg-yellow-100 text-yellow-700',
  completed: 'bg-blue-100 text-blue-700',
};

export default function PMSPage() {
  const router = useRouter();
  const [projects, setProjects] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ name: '', description: '', color: '#6366f1', status: 'planning' });

  useEffect(() => {
    pmsApi.listProjects().then(r => { setProjects(r.data); setLoading(false); });
  }, []);

  const handleCreate = async () => {
    await pmsApi.createProject(form);
    const r = await pmsApi.listProjects();
    setProjects(r.data);
    setShowCreate(false);
    setForm({ name: '', description: '', color: '#6366f1', status: 'planning' });
  };

  return (
    <div className="flex-1 overflow-auto p-6">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Projects</h1>
        <button onClick={() => setShowCreate(true)}
          className="bg-indigo-600 text-white px-4 py-2 rounded-lg hover:bg-indigo-700 font-medium text-sm">
          + New Project
        </button>
      </div>

      {loading ? (
        <div className="text-gray-400 text-center py-20">Loading...</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {projects.map(p => (
            <div key={p.id} onClick={() => router.push(`/admin/pms/${p.id}`)}
              className="bg-white rounded-xl border border-gray-200 p-5 cursor-pointer hover:shadow-md transition-shadow">
              <div className="flex items-center gap-3 mb-2">
                <div className="w-3 h-3 rounded-full flex-none" style={{ background: p.color }} />
                <h2 className="font-semibold text-gray-900 flex-1 truncate">{p.name}</h2>
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLORS[p.status] || 'bg-gray-100 text-gray-600'}`}>
                  {p.status?.replace('_', ' ')}
                </span>
              </div>
              {p.description && <p className="text-sm text-gray-500 mb-3 line-clamp-2">{p.description}</p>}
              <div className="flex items-center gap-2 text-xs text-gray-400">
                <span>{p.members?.length || 0} members</span>
                {p.start_date && <><span>·</span><span>{p.start_date} → {p.end_date || '?'}</span></>}
              </div>
            </div>
          ))}
          {projects.length === 0 && (
            <div className="col-span-3 text-center text-gray-400 py-20">No projects yet. Create your first one.</div>
          )}
        </div>
      )}

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
  );
}
