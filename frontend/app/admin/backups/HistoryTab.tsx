'use client';

import { useEffect, useState } from 'react';
import { getBackupRuns, getBackupJobs } from '@/lib/api';

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

  return (
    <div>
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
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {runs.map(run => (
              <>
                <tr
                  key={run.id}
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
                </tr>
                {expanded === run.id && (
                  <tr key={`${run.id}-detail`}>
                    <td colSpan={5} className="px-4 py-3 bg-gray-50">
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
              </>
            ))}
            {runs.length === 0 && (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-400">No backup runs yet</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
