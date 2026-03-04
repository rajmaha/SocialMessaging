'use client';
import { useEffect, useState } from 'react';
import { apiServersApi, api } from '@/lib/api';
import { authAPI } from '@/lib/auth';
import MainHeader from '@/components/MainHeader';
import AdminNav from '@/components/AdminNav';

const AUTH_TYPES = [
  { value: 'none', label: 'None' },
  { value: 'api_key_plus_token', label: 'API Key + Token' },
  { value: 'basic', label: 'Basic Auth' },
  { value: 'bearer', label: 'Bearer Token' },
  { value: 'api_key_only', label: 'API Key Only' },
];

const AUTH_BADGE_COLORS: Record<string, string> = {
  none: 'bg-gray-100 text-gray-600',
  api_key_plus_token: 'bg-purple-100 text-purple-700',
  basic: 'bg-blue-100 text-blue-700',
  bearer: 'bg-green-100 text-green-700',
  api_key_only: 'bg-amber-100 text-amber-700',
};

const EMPTY_FORM = {
  name: '',
  base_url: '',
  auth_type: 'none',
  api_key_header: '',
  api_key_value: '',
  token_header: '',
  login_endpoint: '',
  login_username_field: '',
  login_password_field: '',
  token_response_path: '',
  request_content_type: 'json',
};

export default function ApiServersPage() {
  const user = authAPI.getUser();
  const [servers, setServers] = useState<any[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [form, setForm] = useState({ ...EMPTY_FORM });

  // Credentials state
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [credentials, setCredentials] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [credForm, setCredForm] = useState({ user_id: '', username: '', password: '' });

  const load = () => apiServersApi.list().then(r => setServers(r.data));
  useEffect(() => { load(); }, []);

  const openCreate = () => {
    setEditing(null);
    setForm({ ...EMPTY_FORM });
    setShowModal(true);
  };

  const openEdit = (server: any) => {
    setEditing(server);
    setForm({
      name: server.name || '',
      base_url: server.base_url || '',
      auth_type: server.auth_type || 'none',
      api_key_header: server.api_key_header || '',
      api_key_value: server.api_key_value || '',
      token_header: server.token_header || '',
      login_endpoint: server.login_endpoint || '',
      login_username_field: server.login_username_field || '',
      login_password_field: server.login_password_field || '',
      token_response_path: server.token_response_path || '',
      request_content_type: server.request_content_type || 'json',
    });
    setShowModal(true);
  };

  const handleSave = async () => {
    if (editing) {
      await apiServersApi.update(editing.id, form);
    } else {
      await apiServersApi.create(form);
    }
    setShowModal(false);
    setEditing(null);
    setForm({ ...EMPTY_FORM });
    load();
  };

  const handleDelete = async (id: number) => {
    if (!confirm('Delete this API server? All associated credentials will also be removed.')) return;
    await apiServersApi.delete(id);
    if (expandedId === id) setExpandedId(null);
    load();
  };

  // Credentials
  const toggleExpand = async (id: number) => {
    if (expandedId === id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(id);
    setCredForm({ user_id: '', username: '', password: '' });
    const [credsRes, usersRes] = await Promise.all([
      apiServersApi.listCredentials(id),
      api.get('/admin/users'),
    ]);
    setCredentials(credsRes.data);
    setUsers(usersRes.data);
  };

  const handleAddCredential = async () => {
    if (!expandedId) return;
    await apiServersApi.createCredential(expandedId, {
      user_id: Number(credForm.user_id),
      username: credForm.username,
      password: credForm.password,
    });
    setCredForm({ user_id: '', username: '', password: '' });
    const res = await apiServersApi.listCredentials(expandedId);
    setCredentials(res.data);
  };

  const showApiKeyFields = form.auth_type === 'api_key_plus_token' || form.auth_type === 'api_key_only';
  const showTokenFields = form.auth_type === 'api_key_plus_token';

  if (!user) return null;

  return (
    <div className="ml-60 pt-14 min-h-screen bg-gray-50">
      <MainHeader user={user} />
      <AdminNav />
      <div className="p-6 max-w-4xl">
        <div className="flex justify-between items-center mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">API Servers</h1>
            <p className="text-sm text-gray-500 mt-1">Manage external API server connections</p>
          </div>
          <button
            onClick={openCreate}
            className="bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-indigo-700"
          >
            + New Server
          </button>
        </div>

        <div className="space-y-3">
          {servers.map(server => (
            <div key={server.id}>
              <div className="bg-white border border-gray-200 rounded-xl p-4 flex items-start gap-4">
                <div
                  className="flex-1 min-w-0 cursor-pointer"
                  onClick={() => toggleExpand(server.id)}
                >
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <span className="font-semibold text-gray-900">{server.name}</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${AUTH_BADGE_COLORS[server.auth_type] || AUTH_BADGE_COLORS.none}`}>
                      {AUTH_TYPES.find(t => t.value === server.auth_type)?.label || server.auth_type}
                    </span>
                  </div>
                  <p className="text-sm text-gray-500 truncate">{server.base_url}</p>
                </div>
                <div className="flex gap-2 flex-none">
                  <button
                    onClick={() => openEdit(server)}
                    className="text-sm text-indigo-600 hover:text-indigo-800 px-3 py-1.5 border border-indigo-200 rounded-lg hover:bg-indigo-50 transition-colors"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => handleDelete(server.id)}
                    className="text-sm text-red-500 hover:text-red-700 px-3 py-1.5 border border-red-200 rounded-lg hover:bg-red-50 transition-colors"
                  >
                    Delete
                  </button>
                </div>
              </div>

              {/* Credentials Section */}
              {expandedId === server.id && (
                <div className="bg-white border border-t-0 border-gray-200 rounded-b-xl px-4 pb-4 -mt-1">
                  <div className="border-t border-gray-100 pt-3">
                    <h3 className="text-sm font-semibold text-gray-700 mb-2">User Credentials</h3>
                    {credentials.length === 0 ? (
                      <p className="text-xs text-gray-400 italic mb-3">No credentials yet</p>
                    ) : (
                      <div className="space-y-1.5 mb-3">
                        {credentials.map((cred: any) => (
                          <div key={cred.id} className="flex items-center gap-2 text-sm bg-gray-50 rounded-lg px-3 py-2">
                            <span className="text-gray-700 font-medium">{cred.username}</span>
                            {cred.user_name && (
                              <span className="text-xs text-gray-400">({cred.user_name})</span>
                            )}
                            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ml-auto ${cred.is_active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                              {cred.is_active ? 'Active' : 'Inactive'}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}

                    <div className="flex gap-2 items-end flex-wrap">
                      <div className="flex-1 min-w-[140px]">
                        <label className="text-xs text-gray-500 block mb-1">User</label>
                        <select
                          className="w-full border rounded-lg px-3 py-2 text-sm bg-white"
                          value={credForm.user_id}
                          onChange={e => setCredForm({ ...credForm, user_id: e.target.value })}
                        >
                          <option value="">Select user...</option>
                          {users.map((u: any) => (
                            <option key={u.id} value={u.id}>{u.name || u.email}</option>
                          ))}
                        </select>
                      </div>
                      <div className="flex-1 min-w-[120px]">
                        <label className="text-xs text-gray-500 block mb-1">Username</label>
                        <input
                          className="w-full border rounded-lg px-3 py-2 text-sm"
                          placeholder="API username"
                          value={credForm.username}
                          onChange={e => setCredForm({ ...credForm, username: e.target.value })}
                        />
                      </div>
                      <div className="flex-1 min-w-[120px]">
                        <label className="text-xs text-gray-500 block mb-1">Password</label>
                        <input
                          type="password"
                          className="w-full border rounded-lg px-3 py-2 text-sm"
                          placeholder="API password"
                          value={credForm.password}
                          onChange={e => setCredForm({ ...credForm, password: e.target.value })}
                        />
                      </div>
                      <button
                        onClick={handleAddCredential}
                        disabled={!credForm.user_id || !credForm.username || !credForm.password}
                        className="bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 whitespace-nowrap"
                      >
                        + Add Credential
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          ))}
          {servers.length === 0 && (
            <p className="text-gray-400 text-sm py-10 text-center">No API servers configured yet.</p>
          )}
        </div>
      </div>

      {/* Create/Edit Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 w-full max-w-lg shadow-2xl max-h-[90vh] overflow-y-auto">
            <h2 className="font-semibold text-lg mb-4">{editing ? 'Edit Server' : 'New Server'}</h2>

            <label className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Name *</label>
            <input
              className="w-full border rounded-lg px-3 py-2 text-sm mb-3 mt-1"
              placeholder="e.g. CRM API"
              value={form.name}
              onChange={e => setForm({ ...form, name: e.target.value })}
            />

            <label className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Base URL *</label>
            <input
              className="w-full border rounded-lg px-3 py-2 text-sm mb-3 mt-1"
              placeholder="https://api.example.com"
              value={form.base_url}
              onChange={e => setForm({ ...form, base_url: e.target.value })}
            />

            <label className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Auth Type</label>
            <select
              className="w-full border rounded-lg px-3 py-2 text-sm mb-3 mt-1 bg-white"
              value={form.auth_type}
              onChange={e => setForm({ ...form, auth_type: e.target.value })}
            >
              {AUTH_TYPES.map(t => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>

            {showApiKeyFields && (
              <>
                <label className="text-xs font-semibold text-gray-600 uppercase tracking-wide">API Key Header</label>
                <input
                  className="w-full border rounded-lg px-3 py-2 text-sm mb-3 mt-1"
                  placeholder="e.g. X-API-Key"
                  value={form.api_key_header}
                  onChange={e => setForm({ ...form, api_key_header: e.target.value })}
                />

                <label className="text-xs font-semibold text-gray-600 uppercase tracking-wide">API Key Value</label>
                <input
                  className="w-full border rounded-lg px-3 py-2 text-sm mb-3 mt-1"
                  placeholder="Your API key"
                  value={form.api_key_value}
                  onChange={e => setForm({ ...form, api_key_value: e.target.value })}
                />
              </>
            )}

            {showTokenFields && (
              <>
                <label className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Token Header</label>
                <input
                  className="w-full border rounded-lg px-3 py-2 text-sm mb-3 mt-1"
                  placeholder="e.g. Authorization"
                  value={form.token_header}
                  onChange={e => setForm({ ...form, token_header: e.target.value })}
                />

                <label className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Login Endpoint</label>
                <input
                  className="w-full border rounded-lg px-3 py-2 text-sm mb-3 mt-1"
                  placeholder="e.g. /auth/login"
                  value={form.login_endpoint}
                  onChange={e => setForm({ ...form, login_endpoint: e.target.value })}
                />

                <label className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Login Username Field</label>
                <input
                  className="w-full border rounded-lg px-3 py-2 text-sm mb-3 mt-1"
                  placeholder="e.g. username"
                  value={form.login_username_field}
                  onChange={e => setForm({ ...form, login_username_field: e.target.value })}
                />

                <label className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Login Password Field</label>
                <input
                  className="w-full border rounded-lg px-3 py-2 text-sm mb-3 mt-1"
                  placeholder="e.g. password"
                  value={form.login_password_field}
                  onChange={e => setForm({ ...form, login_password_field: e.target.value })}
                />

                <label className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Token Response Path</label>
                <input
                  className="w-full border rounded-lg px-3 py-2 text-sm mb-3 mt-1"
                  placeholder="e.g. data.token"
                  value={form.token_response_path}
                  onChange={e => setForm({ ...form, token_response_path: e.target.value })}
                />
              </>
            )}

            <label className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Request Content Type</label>
            <div className="flex gap-4 mt-1 mb-4">
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="radio"
                  name="content_type"
                  checked={form.request_content_type === 'json'}
                  onChange={() => setForm({ ...form, request_content_type: 'json' })}
                />
                JSON
              </label>
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="radio"
                  name="content_type"
                  checked={form.request_content_type === 'form'}
                  onChange={() => setForm({ ...form, request_content_type: 'form' })}
                />
                Form Data
              </label>
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => { setShowModal(false); setEditing(null); }}
                className="flex-1 border rounded-lg px-4 py-2 text-sm"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={!form.name || !form.base_url}
                className="flex-1 bg-indigo-600 text-white rounded-lg px-4 py-2 text-sm disabled:opacity-50 hover:bg-indigo-700"
              >
                {editing ? 'Save' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
