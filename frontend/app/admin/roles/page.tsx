'use client';
import { useEffect, useState } from 'react';
import { rolesApi } from '@/lib/api';
import { authAPI } from '@/lib/auth';
import MainHeader from '@/components/MainHeader';
import AdminNav from '@/components/AdminNav';

const ALL_PAGES = [
  { key: 'pms', label: 'Projects (PMS)' },
  { key: 'tickets', label: 'Tickets' },
  { key: 'crm', label: 'CRM' },
  { key: 'messaging', label: 'Messaging / Inbox' },
  { key: 'callcenter', label: 'Call Center' },
  { key: 'campaigns', label: 'Email Campaigns' },
  { key: 'reports', label: 'Reports' },
  { key: 'kb', label: 'Knowledge Base' },
  { key: 'teams', label: 'Teams' },
];

export default function RolesPage() {
  const user = authAPI.getUser();
  const [roles, setRoles] = useState<any[]>([]);
  const [editing, setEditing] = useState<any>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ name: '', slug: '', pages: [] as string[] });

  const load = () => rolesApi.list().then(r => setRoles(r.data));
  useEffect(() => { load(); }, []);

  const handleCreate = async () => {
    await rolesApi.create(form);
    setShowCreate(false);
    setForm({ name: '', slug: '', pages: [] });
    load();
  };

  const handleUpdate = async () => {
    await rolesApi.update(editing.id, { name: editing.name, pages: editing.pages });
    setEditing(null);
    load();
  };

  const handleDelete = async (id: number) => {
    if (!confirm('Delete this role? Users with this role will be set to Viewer.')) return;
    await rolesApi.delete(id);
    load();
  };

  const togglePage = (pages: string[], key: string) =>
    pages.includes(key) ? pages.filter(p => p !== key) : [...pages, key];

  if (!user) return null;

  return (
    <div className="ml-60 pt-14 min-h-screen bg-gray-50">
      <MainHeader user={user} />
      <AdminNav />
      <div className="p-6 max-w-4xl">
        <div className="flex justify-between items-center mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Roles</h1>
            <p className="text-sm text-gray-500 mt-1">System roles are fixed. Custom roles can be fully configured.</p>
          </div>
          <button
            onClick={() => setShowCreate(true)}
            className="bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-indigo-700"
          >
            + New Role
          </button>
        </div>

        <div className="space-y-3">
          {roles.map(role => (
            <div key={role.id} className="bg-white border border-gray-200 rounded-xl p-4 flex items-start gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                  <span className="font-semibold text-gray-900">{role.name}</span>
                  {role.is_system && (
                    <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full flex items-center gap-1">
                      🔒 System
                    </span>
                  )}
                  <span className="text-xs text-gray-400 font-mono bg-gray-50 px-1.5 py-0.5 rounded">{role.slug}</span>
                </div>
                <div className="flex flex-wrap gap-1">
                  {(role.pages || []).length === 0 ? (
                    <span className="text-xs text-gray-400 italic">No page access</span>
                  ) : (
                    (role.pages as string[]).map(p => (
                      <span key={p} className="text-xs bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded-full font-medium">
                        {ALL_PAGES.find(x => x.key === p)?.label || p}
                      </span>
                    ))
                  )}
                </div>
              </div>
              {!role.is_system && (
                <div className="flex gap-2 flex-none">
                  <button
                    onClick={() => setEditing({ ...role })}
                    className="text-sm text-indigo-600 hover:text-indigo-800 px-3 py-1.5 border border-indigo-200 rounded-lg hover:bg-indigo-50 transition-colors"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => handleDelete(role.id)}
                    className="text-sm text-red-500 hover:text-red-700 px-3 py-1.5 border border-red-200 rounded-lg hover:bg-red-50 transition-colors"
                  >
                    Delete
                  </button>
                </div>
              )}
            </div>
          ))}
          {roles.length === 0 && (
            <p className="text-gray-400 text-sm py-10 text-center">Loading roles...</p>
          )}
        </div>
      </div>

      {/* Create Modal */}
      {showCreate && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 w-full max-w-md shadow-2xl">
            <h2 className="font-semibold text-lg mb-4">New Role</h2>
            <input
              className="w-full border rounded-lg px-3 py-2 text-sm mb-2"
              placeholder="Name (e.g. Freelancer)"
              value={form.name}
              onChange={e => setForm({ ...form, name: e.target.value })}
            />
            <input
              className="w-full border rounded-lg px-3 py-2 text-sm mb-3"
              placeholder="Slug (e.g. freelancer)"
              value={form.slug}
              onChange={e => setForm({ ...form, slug: e.target.value.toLowerCase().replace(/\s+/g, '_') })}
            />
            <p className="text-xs font-semibold text-gray-600 mb-2 uppercase tracking-wide">Page Access</p>
            <div className="space-y-2 mb-4">
              {ALL_PAGES.map(p => (
                <label key={p.key} className="flex items-center gap-2 text-sm cursor-pointer hover:text-indigo-600">
                  <input
                    type="checkbox"
                    checked={form.pages.includes(p.key)}
                    onChange={() => setForm({ ...form, pages: togglePage(form.pages, p.key) })}
                    className="rounded"
                  />
                  {p.label}
                </label>
              ))}
            </div>
            <div className="flex gap-3">
              <button onClick={() => setShowCreate(false)} className="flex-1 border rounded-lg px-4 py-2 text-sm">
                Cancel
              </button>
              <button
                onClick={handleCreate}
                disabled={!form.name || !form.slug}
                className="flex-1 bg-indigo-600 text-white rounded-lg px-4 py-2 text-sm disabled:opacity-50 hover:bg-indigo-700"
              >
                Create
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Modal */}
      {editing && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 w-full max-w-md shadow-2xl">
            <h2 className="font-semibold text-lg mb-4">Edit Role</h2>
            <input
              className="w-full border rounded-lg px-3 py-2 text-sm mb-3"
              placeholder="Name"
              value={editing.name}
              onChange={e => setEditing({ ...editing, name: e.target.value })}
            />
            <p className="text-xs font-semibold text-gray-600 mb-2 uppercase tracking-wide">Page Access</p>
            <div className="space-y-2 mb-4">
              {ALL_PAGES.map(p => (
                <label key={p.key} className="flex items-center gap-2 text-sm cursor-pointer hover:text-indigo-600">
                  <input
                    type="checkbox"
                    checked={(editing.pages || []).includes(p.key)}
                    onChange={() => setEditing({ ...editing, pages: togglePage(editing.pages || [], p.key) })}
                    className="rounded"
                  />
                  {p.label}
                </label>
              ))}
            </div>
            <div className="flex gap-3">
              <button onClick={() => setEditing(null)} className="flex-1 border rounded-lg px-4 py-2 text-sm">
                Cancel
              </button>
              <button
                onClick={handleUpdate}
                className="flex-1 bg-indigo-600 text-white rounded-lg px-4 py-2 text-sm hover:bg-indigo-700"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
