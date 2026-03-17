'use client';
import { useEffect, useState } from 'react';
import { pmsApi } from '@/lib/api';
import MainHeader from '@/components/MainHeader';
import AdminNav from '@/components/AdminNav';
import { authAPI } from '@/lib/auth';

export default function LabelsPage() {
  const user = authAPI.getUser();
  const isAdmin = user?.role === 'admin';
  const [labels, setLabels] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ name: '', color: '#6366f1' });
  const [editId, setEditId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState({ name: '', color: '' });

  const load = () => pmsApi.listLabels().then(r => { setLabels(r.data); setLoading(false); });
  useEffect(() => { load(); }, []);

  const handleCreate = async () => {
    if (!form.name.trim()) return;
    await pmsApi.createLabel(form);
    setForm({ name: '', color: '#6366f1' });
    setShowAdd(false);
    load();
  };

  const handleUpdate = async (id: number) => {
    await pmsApi.updateLabel(id, editForm);
    setEditId(null);
    load();
  };

  const handleDelete = async (id: number) => {
    if (!window.confirm('Delete this label? It will be removed from all tasks.')) return;
    await pmsApi.deleteLabel(id);
    load();
  };

  if (!user) return null;

  return (
    <div className="ml-0 md:ml-60 pt-14 min-h-screen bg-gray-50 pb-16 md:pb-0">
      <MainHeader user={user} />
      <AdminNav />
      <div className="p-6">
        <div className="flex justify-between items-center mb-6">
          <h1 className="text-2xl font-bold text-gray-900">Labels</h1>
          {isAdmin && (
            <button onClick={() => setShowAdd(!showAdd)}
              className="bg-indigo-600 text-white px-4 py-2 rounded-lg hover:bg-indigo-700 font-medium text-sm">
              + Add Label
            </button>
          )}
        </div>

        {/* Add label inline form */}
        {showAdd && (
          <div className="bg-white rounded-xl border border-gray-200 p-4 mb-4 flex items-center gap-3">
            <input type="color" value={form.color} onChange={e => setForm({...form, color: e.target.value})}
              className="w-10 h-10 rounded cursor-pointer border" />
            <input className="flex-1 border rounded-lg px-3 py-2 text-sm" placeholder="Label name"
              value={form.name} onChange={e => setForm({...form, name: e.target.value})}
              onKeyDown={e => e.key === 'Enter' && handleCreate()} />
            <button onClick={handleCreate} disabled={!form.name.trim()}
              className="bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm disabled:opacity-50">Save</button>
            <button onClick={() => setShowAdd(false)} className="text-gray-500 text-sm">Cancel</button>
          </div>
        )}

        {/* Labels list */}
        {loading ? (
          <div className="text-gray-400 text-center py-20">Loading...</div>
        ) : labels.length === 0 ? (
          <div className="text-gray-400 text-center py-20">No labels yet. Create your first one.</div>
        ) : (
          <div className="bg-white rounded-xl border border-gray-200 divide-y">
            {labels.map(label => (
              <div key={label.id} className="flex items-center gap-3 px-4 py-3">
                {editId === label.id ? (
                  <>
                    <input type="color" value={editForm.color} onChange={e => setEditForm({...editForm, color: e.target.value})}
                      className="w-8 h-8 rounded cursor-pointer border" />
                    <input className="flex-1 border rounded-lg px-3 py-1.5 text-sm" value={editForm.name}
                      onChange={e => setEditForm({...editForm, name: e.target.value})}
                      onKeyDown={e => e.key === 'Enter' && handleUpdate(label.id)} />
                    <button onClick={() => handleUpdate(label.id)} className="text-indigo-600 text-sm font-medium">Save</button>
                    <button onClick={() => setEditId(null)} className="text-gray-500 text-sm">Cancel</button>
                  </>
                ) : (
                  <>
                    <div className="w-4 h-4 rounded-full flex-none" style={{ background: label.color }} />
                    <span className="flex-1 text-sm text-gray-900 font-medium">{label.name}</span>
                    {isAdmin && (
                      <div className="flex gap-2">
                        <button onClick={() => { setEditId(label.id); setEditForm({ name: label.name, color: label.color }); }}
                          className="text-gray-400 hover:text-indigo-600 text-sm">Edit</button>
                        <button onClick={() => handleDelete(label.id)}
                          className="text-gray-400 hover:text-red-600 text-sm">Delete</button>
                      </div>
                    )}
                  </>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
