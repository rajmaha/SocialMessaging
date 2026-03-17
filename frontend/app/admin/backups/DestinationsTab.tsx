'use client';

import { useEffect, useState } from 'react';
import {
  getBackupDestinations, createBackupDestination,
  updateBackupDestination, deleteBackupDestination, testBackupDestination
} from '@/lib/api';

const DEST_TYPES = ['local', 'sftp', 'scp', 's3', 'google_drive', 'onedrive'];

const defaultConfig: Record<string, any> = {
  local: { path: '/var/backups/socialmedia' },
  sftp: { host: '', port: 22, username: '', password: '', ssh_key: '', remote_path: '/backups' },
  scp: { host: '', port: 22, username: '', password: '', ssh_key: '', remote_path: '/backups' },
  s3: { bucket: '', region: 'us-east-1', access_key: '', secret_key: '', endpoint_url: '', prefix: 'backups' },
  google_drive: { folder_id: '' },
  onedrive: { folder_path: '/backups' },
};

export default function BackupDestinationsTab() {
  const [destinations, setDestinations] = useState<any[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);
  const [form, setForm] = useState({ name: '', type: 'local', config: defaultConfig.local });
  const [testResult, setTestResult] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    const data = await getBackupDestinations();
    setDestinations(data);
  };

  useEffect(() => { load(); }, []);

  const openCreate = () => {
    setEditing(null);
    setForm({ name: '', type: 'local', config: defaultConfig.local });
    setTestResult(null);
    setShowModal(true);
  };

  const openEdit = (d: any) => {
    setEditing(d);
    setForm({ name: d.name, type: d.type, config: d.config });
    setTestResult(null);
    setShowModal(true);
  };

  const handleTypeChange = (type: string) => {
    setForm(f => ({ ...f, type, config: defaultConfig[type] || {} }));
  };

  const handleConfigChange = (key: string, val: any) => {
    setForm(f => ({ ...f, config: { ...f.config, [key]: val } }));
  };

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      await testBackupDestination({ type: form.type, config: form.config });
      setTestResult('success');
    } catch (e: any) {
      setTestResult(e.response?.data?.detail || 'Connection failed');
    } finally {
      setTesting(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      if (editing) {
        await updateBackupDestination(editing.id, form);
      } else {
        await createBackupDestination(form);
      }
      setShowModal(false);
      load();
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm('Delete this destination?')) return;
    await deleteBackupDestination(id);
    load();
  };

  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-lg font-semibold text-gray-700">Destinations</h2>
        <button onClick={openCreate} className="bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-indigo-700">
          + New Destination
        </button>
      </div>

      <div className="bg-white rounded-xl shadow overflow-hidden">
        <div className="overflow-x-auto"><table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-500 uppercase text-xs">
            <tr>
              <th className="px-4 py-3 text-left">Name</th>
              <th className="px-4 py-3 text-left">Type</th>
              <th className="px-4 py-3 text-left">Status</th>
              <th className="px-4 py-3 text-left">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {destinations.map(d => (
              <tr key={d.id} className="hover:bg-gray-50">
                <td className="px-4 py-3 font-medium text-gray-900">{d.name}</td>
                <td className="px-4 py-3 text-gray-500 uppercase text-xs">{d.type.replace('_', ' ')}</td>
                <td className="px-4 py-3">
                  <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${d.is_active ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-500'}`}>
                    {d.is_active ? 'Active' : 'Inactive'}
                  </span>
                </td>
                <td className="px-4 py-3 flex gap-2">
                  <button onClick={() => openEdit(d)} className="text-indigo-600 hover:underline text-xs">Edit</button>
                  <button onClick={() => handleDelete(d.id)} className="text-red-500 hover:underline text-xs">Delete</button>
                </td>
              </tr>
            ))}
            {destinations.length === 0 && (
              <tr><td colSpan={4} className="px-4 py-8 text-center text-gray-400">No destinations yet</td></tr>
            )}
          </tbody>
        </table></div>
      </div>

      {showModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <h3 className="text-lg font-semibold mb-4">{editing ? 'Edit Destination' : 'New Destination'}</h3>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
                <input className="w-full border rounded-lg px-3 py-2 text-sm" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Type</label>
                <select className="w-full border rounded-lg px-3 py-2 text-sm" value={form.type} onChange={e => handleTypeChange(e.target.value)}>
                  {DEST_TYPES.map(t => <option key={t} value={t}>{t.replace(/_/g, ' ').toUpperCase()}</option>)}
                </select>
              </div>

              {Object.entries(form.config).map(([key, val]) => (
                <div key={key}>
                  <label className="block text-sm font-medium text-gray-700 mb-1 capitalize">{key.replace(/_/g, ' ')}</label>
                  {key === 'ssh_key' ? (
                    <textarea className="w-full border rounded-lg px-3 py-2 text-xs font-mono" rows={4} value={val as string} onChange={e => handleConfigChange(key, e.target.value)} placeholder="Paste private key here (optional)" />
                  ) : (
                    <input
                      className="w-full border rounded-lg px-3 py-2 text-sm"
                      type={key.includes('password') || key.includes('secret') || (key.includes('key') && key !== 'ssh_key') ? 'password' : 'text'}
                      value={val as string}
                      onChange={e => handleConfigChange(key, e.target.value)}
                    />
                  )}
                </div>
              ))}

              {testResult && (
                <div className={`rounded-lg px-3 py-2 text-sm ${testResult === 'success' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-600'}`}>
                  {testResult === 'success' ? '✓ Connection successful' : testResult}
                </div>
              )}
            </div>

            <div className="flex justify-between mt-6">
              <button onClick={handleTest} disabled={testing} className="border border-gray-300 text-gray-700 px-4 py-2 rounded-lg text-sm hover:bg-gray-50 disabled:opacity-50">
                {testing ? 'Testing...' : 'Test Connection'}
              </button>
              <div className="flex gap-2">
                <button onClick={() => setShowModal(false)} className="border border-gray-300 text-gray-700 px-4 py-2 rounded-lg text-sm hover:bg-gray-50">Cancel</button>
                <button onClick={handleSave} disabled={saving} className="bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50">
                  {saving ? 'Saving...' : 'Save'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
