'use client';

import React, { useEffect, useState } from 'react';
import { getBackupRuns, getBackupJobs, restoreBackupRun } from '@/lib/api';

function formatBytes(bytes: number | null) {
  if (!bytes) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatDuration(start: string, end: string | null) {
  if (!end) return '—';
  const ms = new Date(end).getTime() - new Date(start).getTime();
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

export default function BackupHistoryTab() {
  const [runs, setRuns] = useState<any[]>([]);
  const [jobs, setJobs] = useState<any[]>([]);
  const [filterJobId, setFilterJobId] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [expanded, setExpanded] = useState<number | null>(null);
  const [confirmRunId, setConfirmRunId] = useState<number | null>(null);
  const [restoring, setRestoring] = useState<number | null>(null);
  const [restoreMsg, setRestoreMsg] = useState<{ id: number; ok: boolean; text: string } | null>(null);

  const load = async () => {
    const [r, j] = await Promise.all([
      getBackupRuns(filterJobId ? Number(filterJobId) : undefined, filterStatus || undefined),
      getBackupJobs()
    ]);
    setRuns(r);
    setJobs(j);
  };

  useEffect(() => { load(); }, [filterJobId, filterStatus]);

  const jobName = (jobId: number) => jobs.find(j => j.id === jobId)?.name || `Job #${jobId}`;

  const handleRestore = async (runId: number) => {
    setConfirmRunId(null);
    setRestoring(runId);
    setRestoreMsg(null);
    try {
      await restoreBackupRun(runId);
      setRestoreMsg({ id: runId, ok: true, text: 'Restore completed successfully.' });
    } catch (err: any) {
      const detail = err?.response?.data?.detail || err?.message || 'Restore failed';
      setRestoreMsg({ id: runId, ok: false, text: detail });
    } finally {
      setRestoring(null);
    }
  };

  return (
    <div>
      {/* Confirmation modal */}
      {confirmRunId !== null && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl p-6 max-w-md w-full mx-4">
            <h3 className="text-lg font-semibold text-gray-900 mb-2">Confirm Restore</h3>
            <p className="text-sm text-gray-600 mb-1">
              This will overwrite the current database (or server files) with the contents of this backup.
            </p>
            <p className="text-sm font-medium text-red-600 mb-5">This action cannot be undone.</p>
            <div className="flex gap-3 justify-end">
              <button
                className="px-4 py-2 text-sm rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50"
                onClick={() => setConfirmRunId(null)}
              >
                Cancel
              </button>
              <button
                className="px-4 py-2 text-sm rounded-lg bg-red-600 text-white hover:bg-red-700 font-medium"
                onClick={() => handleRestore(confirmRunId)}
              >
                Yes, Restore
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="flex justify-between items-center mb-4">
        <h2 className="text-lg font-semibold text-gray-700">Backup History</h2>
        <div className="flex gap-2">
          <select className="border rounded-lg px-3 py-2 text-sm" value={filterJobId} onChange={e => setFilterJobId(e.target.value)}>
            <option value="">All Jobs</option>
            {jobs.map(j => <option key={j.id} value={j.id}>{j.name}</option>)}
          </select>
          <select className="border rounded-lg px-3 py-2 text-sm" value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
            <option value="">All Statuses</option>
            <option value="success">Success</option>
            <option value="failed">Failed</option>
            <option value="running">Running</option>
          </select>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-500 uppercase text-xs">
            <tr>
              <th className="px-4 py-3 text-left">Job</th>
              <th className="px-4 py-3 text-left">Started</th>
              <th className="px-4 py-3 text-left">Duration</th>
              <th className="px-4 py-3 text-left">Size</th>
              <th className="px-4 py-3 text-left">Status</th>
              <th className="px-4 py-3 text-left">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {runs.map(run => (
              <React.Fragment key={run.id}>
                <tr
                  className="hover:bg-gray-50 cursor-pointer"
                  onClick={() => setExpanded(expanded === run.id ? null : run.id)}
                >
                  <td className="px-4 py-3 font-medium text-gray-900">{jobName(run.job_id)}</td>
                  <td className="px-4 py-3 text-gray-500 text-xs">{new Date(run.started_at).toLocaleString()}</td>
                  <td className="px-4 py-3 text-gray-500 text-xs">{formatDuration(run.started_at, run.finished_at)}</td>
                  <td className="px-4 py-3 text-gray-500 text-xs">{formatBytes(run.file_size_bytes)}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                      run.status === 'success' ? 'bg-green-100 text-green-800'
                      : run.status === 'failed' ? 'bg-red-100 text-red-700'
                      : 'bg-yellow-100 text-yellow-700'
                    }`}>
                      {run.status === 'success' ? '✓ Success' : run.status === 'failed' ? '✗ Failed' : '⟳ Running'}
                    </span>
                  </td>
                  <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                    {run.status === 'success' && (
                      <button
                        className="text-xs px-2 py-1 rounded border border-red-300 text-red-600 hover:bg-red-50 disabled:opacity-50"
                        disabled={restoring === run.id}
                        onClick={() => setConfirmRunId(run.id)}
                      >
                        {restoring === run.id ? 'Restoring…' : 'Restore'}
                      </button>
                    )}
                  </td>
                </tr>
                {expanded === run.id && (
                  <tr>
                    <td colSpan={6} className="px-4 py-3 bg-gray-50">
                      {restoreMsg?.id === run.id && (
                        <p className={`text-xs mb-2 px-2 py-1 rounded font-medium ${restoreMsg!.ok ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-600 font-mono'}`}>
                          {restoreMsg!.text}
                        </p>
                      )}
                      {run.backup_file_path && (
                        <p className="text-xs text-gray-600 mb-1">
                          <span className="font-medium">File:</span> {run.backup_file_path}
                        </p>
                      )}
                      {run.error_message && (
                        <p className="text-xs text-red-600 font-mono bg-red-50 rounded px-2 py-1">{run.error_message}</p>
                      )}
                      {!run.backup_file_path && !run.error_message && (
                        <p className="text-xs text-gray-400">No details available</p>
                      )}
                    </td>
                  </tr>
                )}
              </React.Fragment>
            ))}
            {runs.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-400">No backup runs yet</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
