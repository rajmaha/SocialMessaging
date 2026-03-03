'use client';

import { useEffect, useState } from 'react';
import {
  getBackupJobs, getBackupDestinations, createBackupJob,
  updateBackupJob, deleteBackupJob, runBackupJobNow,
  api
} from '@/lib/api';

export default function BackupJobsTab() {
  const [jobs, setJobs] = useState<any[]>([]);
  const [destinations, setDestinations] = useState<any[]>([]);
  const [servers, setServers] = useState<any[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);
  const [runningId, setRunningId] = useState<number | null>(null);
  const emptyForm = {
    name: '', source_type: 'local_app', server_id: '', backup_scope: 'both',
    destination_id: '', schedule_type: 'manual', schedule_interval_hours: '',
    schedule_cron: '', retention_max_count: '', retention_max_days: '',
    notify_on_failure_emails: '', is_active: true
  };
  const [form, setForm] = useState(emptyForm);

  const load = async () => {
    const [j, d] = await Promise.all([getBackupJobs(), getBackupDestinations()]);
    setJobs(j);
    setDestinations(d);
  };

  useEffect(() => {
    load();
    api.get('/cloudpanel/servers').then(r => setServers(r.data)).catch(() => {});
  }, []);

  const openCreate = () => {
    setEditing(null);
    setForm(emptyForm);
    setShowModal(true);
  };

  const openEdit = (job: any) => {
    setEditing(job);
    setForm({
      name: job.name, source_type: job.source_type,
      server_id: job.server_id?.toString() || '',
      backup_scope: job.backup_scope,
      destination_id: job.destination_id?.toString() || '',
      schedule_type: job.schedule_type,
      schedule_interval_hours: job.schedule_interval_hours?.toString() || '',
      schedule_cron: job.schedule_cron || '',
      retention_max_count: job.retention_max_count?.toString() || '',
      retention_max_days: job.retention_max_days?.toString() || '',
      notify_on_failure_emails: (job.notify_on_failure_emails || []).join(', '),
      is_active: job.is_active
    });
    setShowModal(true);
  };

  const handleSave = async () => {
    const payload = {
      ...form,
      server_id: form.server_id ? Number(form.server_id) : null,
      destination_id: Number(form.destination_id),
      schedule_interval_hours: form.schedule_interval_hours ? Number(form.schedule_interval_hours) : null,
      retention_max_count: form.retention_max_count ? Number(form.retention_max_count) : null,
      retention_max_days: form.retention_max_days ? Number(form.retention_max_days) : null,
      notify_on_failure_emails: form.notify_on_failure_emails
        .split(',').map((e: string) => e.trim()).filter(Boolean),
    };
    if (editing) {
      await updateBackupJob(editing.id, payload);
    } else {
      await createBackupJob(payload);
    }
    setShowModal(false);
    load();
  };

  const handleDelete = async (id: number) => {
    if (!confirm('Delete this job?')) return;
    await deleteBackupJob(id);
    load();
  };

  const handleRunNow = async (id: number) => {
    setRunningId(id);
    try {
      await runBackupJobNow(id);
      alert('Backup triggered successfully');
    } catch (e: any) {
      alert(e.response?.data?.detail || 'Backup failed to start');
    } finally {
      setRunningId(null);
      load();
    }
  };

  const formatSchedule = (job: any) => {
    if (job.schedule_type === 'manual') return 'Manual';
    if (job.schedule_type === 'interval') return `Every ${job.schedule_interval_hours}h`;
    return job.schedule_cron || 'Cron';
  };

  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-lg font-semibold text-gray-700">Backup Jobs</h2>
        <button onClick={openCreate} className="bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-indigo-700">
          + New Job
        </button>
      </div>

      <div className="bg-white rounded-xl shadow overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-500 uppercase text-xs">
            <tr>
              <th className="px-4 py-3 text-left">Name</th>
              <th className="px-4 py-3 text-left">Source</th>
              <th className="px-4 py-3 text-left">Scope</th>
              <th className="px-4 py-3 text-left">Schedule</th>
              <th className="px-4 py-3 text-left">Status</th>
              <th className="px-4 py-3 text-left">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {jobs.map(job => (
              <tr key={job.id} className="hover:bg-gray-50">
                <td className="px-4 py-3 font-medium text-gray-900">{job.name}</td>
                <td className="px-4 py-3 text-gray-500 text-xs">
                  {job.source_type === 'local_app' ? 'App (local DB)' : `Server #${job.server_id}`}
                </td>
                <td className="px-4 py-3 text-gray-500 text-xs capitalize">{job.backup_scope}</td>
                <td className="px-4 py-3 text-gray-500 text-xs">{formatSchedule(job)}</td>
                <td className="px-4 py-3">
                  <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${job.is_active ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-500'}`}>
                    {job.is_active ? 'Active' : 'Inactive'}
                  </span>
                </td>
                <td className="px-4 py-3 flex gap-2 items-center">
                  <button
                    onClick={() => handleRunNow(job.id)}
                    disabled={runningId === job.id}
                    className="text-xs bg-green-50 text-green-700 px-2 py-1 rounded hover:bg-green-100 disabled:opacity-50"
                  >
                    {runningId === job.id ? '...' : '▶ Run'}
                  </button>
                  <button onClick={() => openEdit(job)} className="text-indigo-600 hover:underline text-xs">Edit</button>
                  <button onClick={() => handleDelete(job.id)} className="text-red-500 hover:underline text-xs">Delete</button>
                </td>
              </tr>
            ))}
            {jobs.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-400">No backup jobs yet</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {showModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <h3 className="text-lg font-semibold mb-4">{editing ? 'Edit Job' : 'New Backup Job'}</h3>
            <div className="space-y-4">
              <F label="Name">
                <input className="w-full border rounded-lg px-3 py-2 text-sm" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
              </F>
              <F label="Source">
                <select className="w-full border rounded-lg px-3 py-2 text-sm" value={form.source_type} onChange={e => setForm(f => ({ ...f, source_type: e.target.value }))}>
                  <option value="local_app">Local App (this server&apos;s DB)</option>
                  <option value="cloudpanel_server">CloudPanel Server</option>
                </select>
              </F>
              {form.source_type === 'cloudpanel_server' && (
                <>
                  <F label="Server">
                    <select className="w-full border rounded-lg px-3 py-2 text-sm" value={form.server_id} onChange={e => setForm(f => ({ ...f, server_id: e.target.value }))}>
                      <option value="">Select server...</option>
                      {servers.map((s: any) => <option key={s.id} value={s.id}>{s.name} ({s.host})</option>)}
                    </select>
                  </F>
                  <F label="Backup Scope">
                    <select className="w-full border rounded-lg px-3 py-2 text-sm" value={form.backup_scope} onChange={e => setForm(f => ({ ...f, backup_scope: e.target.value }))}>
                      <option value="both">Database + Files</option>
                      <option value="db">Database only</option>
                      <option value="files">Files only</option>
                    </select>
                  </F>
                </>
              )}
              <F label="Destination">
                <select className="w-full border rounded-lg px-3 py-2 text-sm" value={form.destination_id} onChange={e => setForm(f => ({ ...f, destination_id: e.target.value }))}>
                  <option value="">Select destination...</option>
                  {destinations.map((d: any) => <option key={d.id} value={d.id}>{d.name} ({d.type})</option>)}
                </select>
              </F>
              <F label="Schedule">
                <select className="w-full border rounded-lg px-3 py-2 text-sm" value={form.schedule_type} onChange={e => setForm(f => ({ ...f, schedule_type: e.target.value }))}>
                  <option value="manual">Manual only</option>
                  <option value="interval">Every N hours</option>
                  <option value="cron">Cron expression</option>
                </select>
              </F>
              {form.schedule_type === 'interval' && (
                <F label="Interval (hours)">
                  <input type="number" className="w-full border rounded-lg px-3 py-2 text-sm" value={form.schedule_interval_hours} onChange={e => setForm(f => ({ ...f, schedule_interval_hours: e.target.value }))} />
                </F>
              )}
              {form.schedule_type === 'cron' && (
                <F label='Cron expression (e.g. "0 2 * * *")'>
                  <input className="w-full border rounded-lg px-3 py-2 text-sm font-mono" value={form.schedule_cron} onChange={e => setForm(f => ({ ...f, schedule_cron: e.target.value }))} placeholder="0 2 * * *" />
                </F>
              )}
              <div className="grid grid-cols-2 gap-3">
                <F label="Keep last N backups">
                  <input type="number" className="w-full border rounded-lg px-3 py-2 text-sm" value={form.retention_max_count} onChange={e => setForm(f => ({ ...f, retention_max_count: e.target.value }))} placeholder="e.g. 10" />
                </F>
                <F label="Keep for N days">
                  <input type="number" className="w-full border rounded-lg px-3 py-2 text-sm" value={form.retention_max_days} onChange={e => setForm(f => ({ ...f, retention_max_days: e.target.value }))} placeholder="e.g. 30" />
                </F>
              </div>
              <F label="Notify on failure (comma-separated emails)">
                <input className="w-full border rounded-lg px-3 py-2 text-sm" value={form.notify_on_failure_emails} onChange={e => setForm(f => ({ ...f, notify_on_failure_emails: e.target.value }))} placeholder="admin@example.com" />
              </F>
              <div className="flex items-center gap-2">
                <input type="checkbox" id="is_active" checked={form.is_active} onChange={e => setForm(f => ({ ...f, is_active: e.target.checked }))} />
                <label htmlFor="is_active" className="text-sm text-gray-700">Active</label>
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-6">
              <button onClick={() => setShowModal(false)} className="border border-gray-300 text-gray-700 px-4 py-2 rounded-lg text-sm hover:bg-gray-50">Cancel</button>
              <button onClick={handleSave} className="bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-indigo-700">Save</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function F({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
      {children}
    </div>
  );
}
