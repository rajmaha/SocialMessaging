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
  preserved_fields: [] as { key: string; path: string }[],
  response_success_path: '',
  response_message_path: 'message',
  response_data_path: 'data',
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
  const [teams, setTeams] = useState<any[]>([]);
  const [credForm, setCredForm] = useState({ user_id: '', username: '', password: '' });
  const [testingCredId, setTestingCredId] = useState<number | null>(null);
  const [testResult, setTestResult] = useState<{ credId: number; type: 'success' | 'error'; text: string } | null>(null);
  const [serverCredCounts, setServerCredCounts] = useState<Record<number, number>>({});

  // Spec & Endpoints state
  const [endpoints, setEndpoints] = useState<any[]>([]);
  const [uploadingSpec, setUploadingSpec] = useState(false);
  const [specMessage, setSpecMessage] = useState('');
  const [expandedEndpointServer, setExpandedEndpointServer] = useState<number | null>(null);

  // Access control state
  const [accessUserIds, setAccessUserIds] = useState<number[]>([]);
  const [accessTeamIds, setAccessTeamIds] = useState<number[]>([]);
  const [savingAccess, setSavingAccess] = useState(false);
  const [accessMessage, setAccessMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [showAccessModal, setShowAccessModal] = useState(false);
  const [accessServer, setAccessServer] = useState<any>(null);
  const [accessUsers, setAccessUsers] = useState<any[]>([]);
  const [accessTeams, setAccessTeams] = useState<any[]>([]);
  const [accessLoading, setAccessLoading] = useState(false);

  const load = async () => {
    const res = await apiServersApi.list();
    setServers(res.data);
    // Fetch credential counts for each server
    const counts: Record<number, number> = {};
    await Promise.all(res.data.map(async (s: any) => {
      try {
        const credsRes = await apiServersApi.listCredentials(s.id);
        counts[s.id] = credsRes.data.length;
      } catch { counts[s.id] = 0; }
    }));
    setServerCredCounts(counts);
  };
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
      preserved_fields: server.preserved_fields || [],
      response_success_path: server.response_success_path || '',
      response_message_path: server.response_message_path || 'message',
      response_data_path: server.response_data_path || 'data',
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

  // Credentials & Access
  const toggleExpand = async (id: number) => {
    if (expandedId === id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(id);
    setCredForm({ user_id: '', username: '', password: '' });
    setTestResult(null);
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
    load(); // refresh counts
  };

  const handleTestCredential = async (credId: number) => {
    setTestingCredId(credId);
    setTestResult(null);
    try {
      await apiServersApi.testCredential(credId);
      setTestResult({ credId, type: 'success', text: 'Login successful' });
      if (expandedId) {
        const res = await apiServersApi.listCredentials(expandedId);
        setCredentials(res.data);
      }
    } catch (e: any) {
      const detail = e?.response?.data?.detail || 'Login failed';
      setTestResult({ credId, type: 'error', text: detail });
      if (expandedId) {
        const res = await apiServersApi.listCredentials(expandedId);
        setCredentials(res.data);
      }
    } finally {
      setTestingCredId(null);
    }
  };

  // Spec upload & endpoints
  const handleSpecUpload = async (serverId: number, file: File) => {
    setUploadingSpec(true);
    setSpecMessage('');
    try {
      const res = await apiServersApi.uploadSpec(serverId, file);
      setSpecMessage(res.data.message);
      loadEndpoints(serverId);
    } catch (err: any) {
      setSpecMessage(err.response?.data?.detail || 'Upload failed');
    } finally {
      setUploadingSpec(false);
    }
  };

  const loadEndpoints = async (serverId: number) => {
    try {
      const res = await apiServersApi.listEndpoints(serverId);
      setEndpoints(res.data);
    } catch {
      setEndpoints([]);
    }
  };

  const handleDeleteEndpoint = async (serverId: number, endpointId: number) => {
    if (!confirm('Delete this endpoint?')) return;
    await apiServersApi.deleteEndpoint(serverId, endpointId);
    loadEndpoints(serverId);
  };

  const toggleEndpointList = (serverId: number) => {
    if (expandedEndpointServer === serverId) {
      setExpandedEndpointServer(null);
      setEndpoints([]);
    } else {
      setExpandedEndpointServer(serverId);
      loadEndpoints(serverId);
    }
  };

  // Access control
  const toggleAccessUser = (uid: number) => {
    setAccessUserIds(prev =>
      prev.includes(uid) ? prev.filter(id => id !== uid) : [...prev, uid]
    );
  };

  const toggleAccessTeam = (tid: number) => {
    setAccessTeamIds(prev =>
      prev.includes(tid) ? prev.filter(id => id !== tid) : [...prev, tid]
    );
  };

  const handleSaveAccess = async () => {
    if (!expandedId) return;
    setSavingAccess(true);
    setAccessMessage(null);
    try {
      await apiServersApi.updateAccess(expandedId, {
        user_ids: accessUserIds,
        team_ids: accessTeamIds,
      });
      setAccessMessage({ type: 'success', text: 'Access updated' });
    } catch (e: any) {
      setAccessMessage({ type: 'error', text: e?.response?.data?.detail || 'Failed to update access' });
    } finally {
      setSavingAccess(false);
    }
  };

  const openAccessModal = async (server: any) => {
    setAccessServer(server);
    setShowAccessModal(true);
    setAccessMessage(null);
    setAccessLoading(true);
    try {
      const [usersRes, teamsRes, accessRes] = await Promise.all([
        api.get('/admin/users'),
        api.get('/admin/teams').catch(() => ({ data: [] })),
        apiServersApi.getAccess(server.id),
      ]);
      setAccessUsers(usersRes.data);
      setAccessTeams(Array.isArray(teamsRes.data) ? teamsRes.data : []);
      setAccessUserIds(accessRes.data.user_ids || []);
      setAccessTeamIds(accessRes.data.team_ids || []);
    } catch (e) {
      console.error('Failed to load access data', e);
    } finally {
      setAccessLoading(false);
    }
  };

  const handleSaveAccessModal = async () => {
    if (!accessServer) return;
    setSavingAccess(true);
    setAccessMessage(null);
    try {
      await apiServersApi.updateAccess(accessServer.id, {
        user_ids: accessUserIds,
        team_ids: accessTeamIds,
      });
      setAccessMessage({ type: 'success', text: 'Access updated' });
    } catch (e: any) {
      setAccessMessage({ type: 'error', text: e?.response?.data?.detail || 'Failed to update access' });
    } finally {
      setSavingAccess(false);
    }
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
                  <div className="flex items-center gap-2 mt-1">
                    <p className="text-sm text-gray-500 truncate">{server.base_url}</p>
                    {(serverCredCounts[server.id] ?? 0) > 0 && (
                      <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-blue-100 text-blue-700 flex-shrink-0">
                        {serverCredCounts[server.id]} user{serverCredCounts[server.id] !== 1 ? 's' : ''}
                      </span>
                    )}
                  </div>
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

              {/* Expanded Section: Credentials */}
              {expandedId === server.id && (
                <div className="bg-white border border-t-0 border-gray-200 rounded-b-xl px-4 pb-4 -mt-1">
                  {/* Credentials Section */}
                  <div className="border-t border-gray-100 pt-3">
                    <div className="flex items-center justify-between mb-2">
                      <h3 className="text-sm font-semibold text-gray-700">User Credentials</h3>
                      <button
                        onClick={() => openAccessModal(server)}
                        className="text-xs text-indigo-600 hover:text-indigo-800 px-2.5 py-1 border border-indigo-200 rounded-lg hover:bg-indigo-50 transition-colors flex items-center gap-1"
                      >
                        🔒 Manage Access
                        {(accessUserIds.length > 0 || accessTeamIds.length > 0) && (
                          <span className="bg-indigo-100 text-indigo-700 text-xs px-1.5 py-0 rounded-full ml-1">
                            {accessUserIds.length + accessTeamIds.length}
                          </span>
                        )}
                      </button>
                    </div>
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
                            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${cred.is_active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                              {cred.is_active ? 'Active' : 'Inactive'}
                            </span>
                            {(server.auth_type === 'api_key_plus_token' || server.auth_type === 'bearer') && (
                              <button
                                onClick={() => handleTestCredential(cred.id)}
                                disabled={testingCredId === cred.id}
                                className="text-xs text-indigo-600 hover:text-indigo-800 px-2 py-1 border border-indigo-200 rounded-md hover:bg-indigo-50 transition-colors disabled:opacity-50 ml-auto"
                              >
                                {testingCredId === cred.id ? 'Testing...' : 'Test'}
                              </button>
                            )}
                            {!(server.auth_type === 'api_key_plus_token' || server.auth_type === 'bearer') && (
                              <span className="ml-auto" />
                            )}
                            {testResult?.credId === cred.id && (
                              <span className={`text-xs ${testResult.type === 'success' ? 'text-green-600' : 'text-red-600'}`}>
                                {testResult.text}
                              </span>
                            )}
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
                            <option key={u.id} value={u.id}>{u.full_name || u.name || u.email}</option>
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

              {/* Spec Upload & Endpoints Section */}
              <div className="mt-3 border-t pt-3">
                <div className="flex items-center gap-3 mb-2">
                  <label className="cursor-pointer bg-purple-50 hover:bg-purple-100 text-purple-700 px-3 py-1.5 rounded-lg text-sm font-medium transition">
                    {uploadingSpec ? 'Uploading...' : 'Upload API Spec'}
                    <input
                      type="file"
                      accept=".json"
                      className="hidden"
                      disabled={uploadingSpec}
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) handleSpecUpload(server.id, file);
                        e.target.value = '';
                      }}
                    />
                  </label>
                  {server.spec_file_name && (
                    <span className="text-xs text-gray-500">
                      Spec: {server.spec_file_name}
                    </span>
                  )}
                  <button
                    onClick={() => toggleEndpointList(server.id)}
                    className="text-sm text-blue-600 hover:text-blue-800"
                  >
                    {expandedEndpointServer === server.id ? 'Hide' : 'Show'} Endpoints
                  </button>
                </div>

                {specMessage && (
                  <p className="text-sm text-green-700 bg-green-50 px-3 py-1.5 rounded mb-2">{specMessage}</p>
                )}

                {expandedEndpointServer === server.id && (
                  <div className="space-y-1.5 mt-2">
                    {endpoints.length === 0 ? (
                      <p className="text-sm text-gray-400">No endpoints parsed yet. Upload a Swagger or Postman JSON file.</p>
                    ) : (
                      endpoints.map((ep: any) => {
                        const methodColors: Record<string, string> = {
                          GET: 'bg-green-100 text-green-700',
                          POST: 'bg-blue-100 text-blue-700',
                          PUT: 'bg-yellow-100 text-yellow-800',
                          PATCH: 'bg-orange-100 text-orange-700',
                          DELETE: 'bg-red-100 text-red-700',
                        };
                        return (
                          <div key={ep.id} className="flex items-center justify-between bg-gray-50 rounded-lg px-3 py-2">
                            <div className="flex items-center gap-2">
                              <span className={`px-2 py-0.5 rounded text-xs font-bold ${methodColors[ep.method] || 'bg-gray-100 text-gray-600'}`}>
                                {ep.method}
                              </span>
                              <span className="text-sm font-mono">{ep.path}</span>
                              {ep.summary && <span className="text-xs text-gray-500 truncate max-w-[200px]">— {ep.summary}</span>}
                              <span className="text-xs bg-gray-200 text-gray-600 rounded-full px-2 py-0.5">
                                {ep.field_count || ep.fields?.length || 0} fields
                              </span>
                            </div>
                            <button
                              onClick={() => handleDeleteEndpoint(server.id, ep.id)}
                              className="text-red-400 hover:text-red-600 text-sm"
                            >
                              ✕
                            </button>
                          </div>
                        );
                      })
                    )}
                  </div>
                )}
              </div>
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

            {/* Preserved Fields from Login Response */}
            {(form.auth_type === 'api_key_plus_token' || form.auth_type === 'bearer') && (
              <div className="border border-gray-200 rounded-lg p-3 mb-3 bg-gray-50">
                <label className="text-xs font-semibold text-gray-600 uppercase tracking-wide block mb-2">
                  Preserved Fields from Login Response
                </label>
                <p className="text-xs text-gray-400 mb-2">
                  Extract values from the login response to use in form submissions (e.g., remote user ID).
                </p>
                {(form.preserved_fields || []).map((pf: any, idx: number) => (
                  <div key={idx} className="flex gap-2 mb-2 items-center">
                    <input
                      className="flex-1 border rounded-lg px-2 py-1.5 text-sm"
                      placeholder="Key (e.g. remote_user_id)"
                      value={pf.key}
                      onChange={e => {
                        const updated = [...form.preserved_fields];
                        updated[idx] = { ...updated[idx], key: e.target.value };
                        setForm({ ...form, preserved_fields: updated });
                      }}
                    />
                    <input
                      className="flex-1 border rounded-lg px-2 py-1.5 text-sm"
                      placeholder="JSON path (e.g. data.id)"
                      value={pf.path}
                      onChange={e => {
                        const updated = [...form.preserved_fields];
                        updated[idx] = { ...updated[idx], path: e.target.value };
                        setForm({ ...form, preserved_fields: updated });
                      }}
                    />
                    <button
                      onClick={() => {
                        const updated = form.preserved_fields.filter((_: any, i: number) => i !== idx);
                        setForm({ ...form, preserved_fields: updated });
                      }}
                      className="text-red-400 hover:text-red-600 text-sm px-1"
                    >
                      &times;
                    </button>
                  </div>
                ))}
                <button
                  onClick={() => setForm({ ...form, preserved_fields: [...(form.preserved_fields || []), { key: '', path: '' }] })}
                  className="text-xs text-indigo-600 hover:text-indigo-800 mt-1"
                >
                  + Add Field
                </button>
              </div>
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

            {/* Response Format Configuration */}
            <div className="border border-gray-200 rounded-lg p-3 mb-4 bg-gray-50">
              <label className="text-xs font-semibold text-gray-600 uppercase tracking-wide block mb-1">
                Response Format
              </label>
              <p className="text-xs text-gray-400 mb-3">
                Configure how to detect success/failure from the API response body. Different servers use different patterns
                (e.g. <code className="bg-gray-200 px-1 rounded">{"\"status\": true"}</code> or <code className="bg-gray-200 px-1 rounded">{"\"success\": true"}</code>).
              </p>

              <div className="space-y-3">
                <div>
                  <label className="block text-xs text-gray-600 mb-1">Success Indicator Path</label>
                  <input
                    className="w-full border rounded-lg px-3 py-2 text-sm bg-white"
                    placeholder='e.g. "status" or "success" (leave empty to auto-detect)'
                    value={form.response_success_path}
                    onChange={e => setForm({ ...form, response_success_path: e.target.value })}
                  />
                  <p className="text-xs text-gray-400 mt-1">JSON path to the boolean field indicating success. If empty, auto-checks both <code className="bg-gray-200 px-0.5 rounded">status</code> and <code className="bg-gray-200 px-0.5 rounded">success</code>.</p>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-gray-600 mb-1">Message Path</label>
                    <input
                      className="w-full border rounded-lg px-3 py-2 text-sm bg-white"
                      placeholder="e.g. message"
                      value={form.response_message_path}
                      onChange={e => setForm({ ...form, response_message_path: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-600 mb-1">Data Path</label>
                    <input
                      className="w-full border rounded-lg px-3 py-2 text-sm bg-white"
                      placeholder="e.g. data"
                      value={form.response_data_path}
                      onChange={e => setForm({ ...form, response_data_path: e.target.value })}
                    />
                  </div>
                </div>
              </div>
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

      {/* Access Control Modal */}
      {showAccessModal && accessServer && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 w-full max-w-lg shadow-2xl max-h-[80vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="font-semibold text-lg">Access Control</h2>
                <p className="text-xs text-gray-500 mt-0.5">{accessServer.name}</p>
              </div>
              <button
                onClick={() => { setShowAccessModal(false); setAccessServer(null); }}
                className="text-gray-400 hover:text-gray-600 text-xl leading-none"
              >
                &times;
              </button>
            </div>

            <p className="text-xs text-gray-400 mb-4">Select which users and teams can see this server and manage their own credentials.</p>

            {accessLoading ? (
              <div className="flex items-center justify-center py-10">
                <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-indigo-500" />
              </div>
            ) : (
              <>
                {/* Users */}
                <div className="mb-4">
                  <label className="text-xs font-medium text-gray-500 uppercase tracking-wide block mb-2">Users</label>
                  <div className="max-h-48 overflow-y-auto border border-gray-200 rounded-lg divide-y divide-gray-100">
                    {accessUsers.length === 0 ? (
                      <p className="text-xs text-gray-400 italic p-3">No users found</p>
                    ) : accessUsers.map((u: any) => (
                      <label
                        key={u.id}
                        className="flex items-center gap-2.5 px-3 py-2 cursor-pointer hover:bg-gray-50 transition-colors"
                      >
                        <input
                          type="checkbox"
                          checked={accessUserIds.includes(u.id)}
                          onChange={() => toggleAccessUser(u.id)}
                          className="rounded text-indigo-600 w-4 h-4 flex-shrink-0"
                        />
                        <span className="text-sm text-gray-700">{u.full_name || u.name || u.email}</span>
                        {u.email && u.full_name && (
                          <span className="text-xs text-gray-400 ml-auto">{u.email}</span>
                        )}
                      </label>
                    ))}
                  </div>
                </div>

                {/* Teams */}
                {accessTeams.length > 0 && (
                  <div className="mb-4">
                    <label className="text-xs font-medium text-gray-500 uppercase tracking-wide block mb-2">Teams</label>
                    <div className="max-h-36 overflow-y-auto border border-gray-200 rounded-lg divide-y divide-gray-100">
                      {accessTeams.map((t: any) => (
                        <label
                          key={t.id}
                          className="flex items-center gap-2.5 px-3 py-2 cursor-pointer hover:bg-gray-50 transition-colors"
                        >
                          <input
                            type="checkbox"
                            checked={accessTeamIds.includes(t.id)}
                            onChange={() => toggleAccessTeam(t.id)}
                            className="rounded text-purple-600 w-4 h-4 flex-shrink-0"
                          />
                          <span className="text-sm text-gray-700">{t.name}</span>
                          {t.members && (
                            <span className="text-xs text-gray-400 ml-auto">{t.members.length} members</span>
                          )}
                        </label>
                      ))}
                    </div>
                  </div>
                )}

                {accessUserIds.length === 0 && accessTeamIds.length === 0 && (
                  <p className="text-xs text-amber-600 mb-3">No access assigned — this server is hidden from all users.</p>
                )}

                {accessMessage && (
                  <p className={`text-xs mb-3 ${accessMessage.type === 'success' ? 'text-green-600' : 'text-red-600'}`}>
                    {accessMessage.text}
                  </p>
                )}

                <div className="flex gap-3">
                  <button
                    onClick={() => { setShowAccessModal(false); setAccessServer(null); }}
                    className="flex-1 border rounded-lg px-4 py-2 text-sm"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleSaveAccessModal}
                    disabled={savingAccess}
                    className="flex-1 bg-indigo-600 text-white rounded-lg px-4 py-2 text-sm disabled:opacity-50 hover:bg-indigo-700"
                  >
                    {savingAccess ? 'Saving...' : 'Save Access'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
