'use client';
import { useEffect, useState } from 'react';
import { userApiCredsApi } from '@/lib/api';
import { authAPI } from '@/lib/auth';
import MainHeader from '@/components/MainHeader';
import AdminNav from '@/components/AdminNav';

const AUTH_BADGE_COLORS: Record<string, string> = {
  none: 'bg-gray-100 text-gray-600',
  api_key_plus_token: 'bg-purple-100 text-purple-700',
  basic: 'bg-blue-100 text-blue-700',
  bearer: 'bg-green-100 text-green-700',
  api_key_only: 'bg-amber-100 text-amber-700',
};

const AUTH_LABELS: Record<string, string> = {
  none: 'No Auth',
  api_key_plus_token: 'API Key + Token',
  basic: 'Basic Auth',
  bearer: 'Bearer Token',
  api_key_only: 'API Key Only',
};

export default function MyApiCredentialsPage() {
  const user = authAPI.getUser();
  const [servers, setServers] = useState<any[]>([]);
  const [credentials, setCredentials] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<number | null>(null);
  const [testing, setTesting] = useState<number | null>(null);
  const [message, setMessage] = useState<{ serverId: number; type: 'success' | 'error'; text: string } | null>(null);

  // Local form state per server: { [serverId]: { username, password } }
  const [forms, setForms] = useState<Record<number, { username: string; password: string }>>({});

  const load = async () => {
    try {
      const [serversRes, credsRes] = await Promise.all([
        userApiCredsApi.listServers(),
        userApiCredsApi.list(),
      ]);
      setServers(serversRes.data);
      setCredentials(credsRes.data);

      // Initialize forms from existing credentials
      const formState: Record<number, { username: string; password: string }> = {};
      for (const cred of credsRes.data) {
        formState[cred.api_server_id] = { username: cred.username, password: '' };
      }
      setForms(formState);
    } catch (e) {
      console.error('Failed to load API credentials', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const getCredForServer = (serverId: number) =>
    credentials.find((c: any) => c.api_server_id === serverId);

  const getForm = (serverId: number) =>
    forms[serverId] || { username: '', password: '' };

  const updateForm = (serverId: number, field: string, value: string) => {
    setForms(prev => ({
      ...prev,
      [serverId]: { ...getForm(serverId), [field]: value },
    }));
  };

  const handleSave = async (serverId: number) => {
    const form = getForm(serverId);
    if (!form.username) return;
    setSaving(serverId);
    setMessage(null);
    try {
      const existing = getCredForServer(serverId);
      if (existing) {
        const updateData: any = { username: form.username };
        if (form.password) updateData.password = form.password;
        await userApiCredsApi.update(existing.id, updateData);
      } else {
        if (!form.password) {
          setMessage({ serverId, type: 'error', text: 'Password is required for new credentials' });
          setSaving(null);
          return;
        }
        await userApiCredsApi.create({
          api_server_id: serverId,
          username: form.username,
          password: form.password,
        });
      }
      await load();
      setMessage({ serverId, type: 'success', text: 'Credentials saved' });
    } catch (e: any) {
      const detail = e?.response?.data?.detail || 'Failed to save';
      setMessage({ serverId, type: 'error', text: detail });
    } finally {
      setSaving(null);
    }
  };

  const handleTestLogin = async (serverId: number) => {
    const cred = getCredForServer(serverId);
    if (!cred) {
      setMessage({ serverId, type: 'error', text: 'Save credentials first before testing' });
      return;
    }
    setTesting(serverId);
    setMessage(null);
    try {
      await userApiCredsApi.login(cred.id);
      await load();
      setMessage({ serverId, type: 'success', text: 'Login successful — connection is active' });
    } catch (e: any) {
      const detail = e?.response?.data?.detail || 'Login failed';
      setMessage({ serverId, type: 'error', text: detail });
    } finally {
      setTesting(null);
    }
  };

  if (!user) return null;

  return (
    <div className="ml-0 md:ml-60 pt-14 min-h-screen bg-gray-50 pb-16 md:pb-0">
      <MainHeader user={user} />
      <AdminNav />
      <div className="p-6 max-w-3xl">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900">My API Credentials</h1>
          <p className="text-sm text-gray-500 mt-1">
            Enter your login credentials for each API server configured by your admin.
            These are used when you interact with remote systems (e.g. form submissions).
          </p>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-500" />
          </div>
        ) : servers.length === 0 ? (
          <div className="bg-white border border-gray-200 rounded-xl p-10 text-center">
            <p className="text-gray-400 text-sm">No API servers have been configured yet.</p>
            <p className="text-gray-400 text-xs mt-1">Ask your admin to set up API server connections.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {servers.map((server: any) => {
              const cred = getCredForServer(server.id);
              const form = getForm(server.id);
              const msg = message?.serverId === server.id ? message : null;
              const isSaving = saving === server.id;
              const isTesting = testing === server.id;

              return (
                <div key={server.id} className="bg-white border border-gray-200 rounded-xl p-5">
                  {/* Server header */}
                  <div className="flex items-center gap-3 mb-4">
                    <div className="w-9 h-9 rounded-lg bg-indigo-50 flex items-center justify-center text-indigo-600 font-bold text-sm flex-shrink-0">
                      {server.name.charAt(0).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-gray-900">{server.name}</span>
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${AUTH_BADGE_COLORS[server.auth_type] || AUTH_BADGE_COLORS.none}`}>
                          {AUTH_LABELS[server.auth_type] || server.auth_type}
                        </span>
                        {cred && (
                          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${cred.is_active ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'}`}>
                            {cred.is_active ? 'Connected' : 'Disconnected'}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-gray-400 truncate mt-0.5">{server.base_url}</p>
                    </div>
                  </div>

                  {/* Credential form */}
                  <div className="flex gap-3 items-end flex-wrap">
                    <div className="flex-1 min-w-[180px]">
                      <label className="text-xs text-gray-500 block mb-1">Username</label>
                      <input
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none"
                        placeholder="Your API username"
                        value={form.username}
                        onChange={e => updateForm(server.id, 'username', e.target.value)}
                      />
                    </div>
                    <div className="flex-1 min-w-[180px]">
                      <label className="text-xs text-gray-500 block mb-1">
                        Password {cred && <span className="text-gray-400">(leave blank to keep current)</span>}
                      </label>
                      <input
                        type="password"
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none"
                        placeholder={cred ? '••••••••' : 'Your API password'}
                        value={form.password}
                        onChange={e => updateForm(server.id, 'password', e.target.value)}
                      />
                    </div>
                  </div>

                  {/* Actions & message */}
                  <div className="flex items-center gap-3 mt-3 flex-wrap">
                    <button
                      onClick={() => handleSave(server.id)}
                      disabled={isSaving || !form.username}
                      className="bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 transition-colors"
                    >
                      {isSaving ? 'Saving...' : cred ? 'Update' : 'Save'}
                    </button>
                    {cred && (server.auth_type === 'api_key_plus_token' || server.auth_type === 'bearer') && (
                      <button
                        onClick={() => handleTestLogin(server.id)}
                        disabled={isTesting}
                        className="border border-gray-300 text-gray-700 px-4 py-2 rounded-lg text-sm font-medium hover:bg-gray-50 disabled:opacity-50 transition-colors"
                      >
                        {isTesting ? 'Testing...' : 'Test Login'}
                      </button>
                    )}
                    {msg && (
                      <span className={`text-sm ${msg.type === 'success' ? 'text-green-600' : 'text-red-600'}`}>
                        {msg.text}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
