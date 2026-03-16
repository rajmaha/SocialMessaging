'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { authAPI, getAuthToken } from '@/lib/auth';
import AdminNav from '@/components/AdminNav';
import MainHeader from '@/components/MainHeader';
import { API_URL } from '@/lib/config';

interface ErrorEntry {
  id: number;
  timestamp: string;
  severity: string;
  source: string;
  error_type: string | null;
  message: string;
  traceback: string | null;
  user_id: number | null;
  request_path: string | null;
  request_method: string | null;
  context: Record<string, unknown> | null;
}

const SEVERITY_COLORS: Record<string, string> = {
  warning: 'bg-yellow-100 text-yellow-800',
  error: 'bg-red-100 text-red-700',
  critical: 'bg-red-200 text-red-900 font-bold',
};

const SOURCE_COLORS: Record<string, string> = {
  api: 'bg-blue-50 text-blue-700',
  background_job: 'bg-purple-50 text-purple-700',
  integration: 'bg-indigo-50 text-indigo-700',
  frontend: 'bg-orange-50 text-orange-700',
};

const SOURCE_ICONS: Record<string, string> = {
  api: '🔌',
  background_job: '⚙️',
  integration: '🔗',
  frontend: '🌐',
};

function SeverityBadge({ severity }: { severity: string }) {
  return (
    <span className={`px-2 py-0.5 rounded text-xs font-semibold ${SEVERITY_COLORS[severity] || 'bg-gray-100 text-gray-600'}`}>
      {severity}
    </span>
  );
}

function SourceBadge({ source }: { source: string }) {
  return (
    <span className={`px-2 py-0.5 rounded text-xs font-medium ${SOURCE_COLORS[source] || 'bg-gray-100 text-gray-600'}`}>
      {SOURCE_ICONS[source] || ''} {source.replace('_', ' ')}
    </span>
  );
}

function MethodBadge({ method }: { method: string | null }) {
  if (!method) return <span className="text-gray-300">—</span>;
  const colors: Record<string, string> = {
    GET: 'bg-green-50 text-green-700',
    POST: 'bg-blue-50 text-blue-700',
    PUT: 'bg-yellow-50 text-yellow-700',
    PATCH: 'bg-orange-50 text-orange-700',
    DELETE: 'bg-red-50 text-red-700',
  };
  return <span className={`px-1.5 py-0.5 rounded text-xs font-bold ${colors[method] || 'bg-gray-50 text-gray-600'}`}>{method}</span>;
}

// ── Detail slide-over panel ───────────────────────────────────────────────────

function ErrorDetailPanel({ entry, onClose }: { entry: ErrorEntry; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex">
      {/* Backdrop */}
      <div className="flex-1 bg-black/30" onClick={onClose} />

      {/* Panel */}
      <div className="w-full max-w-2xl bg-white shadow-2xl flex flex-col h-full overflow-hidden">
        {/* Header */}
        <div className={`flex items-center justify-between px-6 py-4 border-b ${entry.severity === 'critical' ? 'bg-red-50 border-red-100' : entry.severity === 'error' ? 'bg-red-50 border-red-100' : 'bg-yellow-50 border-yellow-100'}`}>
          <div>
            <div className="flex items-center gap-2 mb-1">
              <SeverityBadge severity={entry.severity} />
              <SourceBadge source={entry.source} />
              <span className="text-xs text-gray-400">#{entry.id}</span>
            </div>
            <p className="text-xs text-gray-500">{new Date(entry.timestamp).toLocaleString()}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">✕</button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">

          {/* Error message */}
          <div className="bg-white border border-gray-100 rounded-xl p-4">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">Message</p>
            <p className="text-sm text-gray-900 leading-relaxed">{entry.message}</p>
            {entry.error_type && (
              <p className="text-xs font-mono text-red-600 mt-2 bg-red-50 px-2 py-1 rounded">{entry.error_type}</p>
            )}
          </div>

          {/* Request info */}
          <div className="bg-white border border-gray-100 rounded-xl p-4 space-y-3">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Request</p>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <p className="text-xs text-gray-400 mb-1">Method & Path</p>
                <div className="flex items-center gap-2">
                  <MethodBadge method={entry.request_method} />
                  <span className="font-mono text-xs text-gray-700 break-all">{entry.request_path || '—'}</span>
                </div>
              </div>
              <div>
                <p className="text-xs text-gray-400 mb-1">User ID</p>
                <p className="font-mono text-sm">{entry.user_id ?? '—'}</p>
              </div>
            </div>
          </div>

          {/* Context */}
          {entry.context && Object.keys(entry.context).length > 0 && (
            <div className="bg-white border border-gray-100 rounded-xl p-4">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Context</p>
              <div className="space-y-2">
                {Object.entries(entry.context).map(([k, v]) => v != null && (
                  <div key={k}>
                    <p className="text-xs font-semibold text-gray-500 mb-0.5">{k}</p>
                    <p className="text-xs text-gray-700 font-mono bg-gray-50 px-2 py-1 rounded break-all">
                      {typeof v === 'object' ? JSON.stringify(v) : String(v)}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Traceback */}
          {entry.traceback && (
            <div className="bg-white border border-gray-100 rounded-xl p-4">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Traceback</p>
              <pre className="text-xs text-red-800 bg-red-50 border border-red-100 p-3 rounded-xl overflow-x-auto whitespace-pre-wrap leading-relaxed max-h-96 overflow-y-auto">
                {entry.traceback}
              </pre>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function ErrorLogsPage() {
  const router = useRouter();
  const user = authAPI.getUser();

  const [items, setItems] = useState<ErrorEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<ErrorEntry | null>(null);

  // Filters
  const [filterSeverity, setFilterSeverity] = useState('');
  const [filterSource, setFilterSource] = useState('');
  const [filterFrom, setFilterFrom] = useState('');
  const [filterTo, setFilterTo] = useState('');

  const PAGE_SIZE = 50;

  useEffect(() => {
    if (!user) router.push('/login');
  }, [user, router]);

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), page_size: String(PAGE_SIZE) });
      if (filterSeverity) params.set('severity', filterSeverity);
      if (filterSource) params.set('source', filterSource);
      if (filterFrom) params.set('date_from', filterFrom);
      if (filterTo) params.set('date_to', filterTo);
      const res = await fetch(`${API_URL}/logs/errors?${params}`, {
        headers: { Authorization: `Bearer ${getAuthToken()}` },
      });
      const data = await res.json();
      setItems(data.items || []);
      setTotal(data.total || 0);
    } finally {
      setLoading(false);
    }
  }, [page, filterSeverity, filterSource, filterFrom, filterTo]);

  useEffect(() => { fetchLogs(); }, [fetchLogs]);

  const exportCsv = async () => {
    const params = new URLSearchParams();
    if (filterSeverity) params.set('severity', filterSeverity);
    if (filterSource) params.set('source', filterSource);
    if (filterFrom) params.set('date_from', filterFrom);
    if (filterTo) params.set('date_to', filterTo);
    const res = await fetch(`${API_URL}/logs/errors/export?${params}`, {
      headers: { Authorization: `Bearer ${getAuthToken()}` },
    });
    if (!res.ok) return;
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'error_logs.csv'; a.click();
    URL.revokeObjectURL(url);
  };

  const totalPages = Math.ceil(total / PAGE_SIZE);

  // Counts for summary bar
  const criticalCount = items.filter(i => i.severity === 'critical').length;
  const errorCount = items.filter(i => i.severity === 'error').length;
  const warningCount = items.filter(i => i.severity === 'warning').length;

  return (
    <div className="min-h-screen bg-gray-50">
      <MainHeader user={user!} />
      <AdminNav />
      <main className="ml-60 pt-14 p-6">
        <div className="max-w-7xl mx-auto">

          {/* Header */}
          <div className="flex items-center justify-between mb-6">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Error Logs</h1>
              <div className="flex items-center gap-3 mt-1">
                <span className="text-sm text-gray-500">{total.toLocaleString()} total</span>
                {criticalCount > 0 && <span className="px-2 py-0.5 bg-red-200 text-red-900 rounded text-xs font-bold">{criticalCount} critical</span>}
                {errorCount > 0 && <span className="px-2 py-0.5 bg-red-100 text-red-700 rounded text-xs font-semibold">{errorCount} errors</span>}
                {warningCount > 0 && <span className="px-2 py-0.5 bg-yellow-100 text-yellow-800 rounded text-xs font-semibold">{warningCount} warnings</span>}
              </div>
            </div>
            <button onClick={exportCsv}
              className="px-4 py-2 bg-green-600 text-white rounded-xl hover:bg-green-700 text-sm font-semibold shadow-sm">
              ↓ Export CSV
            </button>
          </div>

          {/* Filters */}
          <div className="flex flex-wrap gap-3 mb-5 bg-white p-4 rounded-2xl border border-gray-200 shadow-sm">
            <select value={filterSeverity}
              onChange={e => { setFilterSeverity(e.target.value); setPage(1); }}
              className="border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
              <option value="">All Severities</option>
              <option value="warning">⚠️ Warning</option>
              <option value="error">❌ Error</option>
              <option value="critical">🔴 Critical</option>
            </select>
            <select value={filterSource}
              onChange={e => { setFilterSource(e.target.value); setPage(1); }}
              className="border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
              <option value="">All Sources</option>
              <option value="api">🔌 API</option>
              <option value="background_job">⚙️ Background Job</option>
              <option value="integration">🔗 Integration</option>
              <option value="frontend">🌐 Frontend</option>
            </select>
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-400">From</span>
              <input type="datetime-local" value={filterFrom}
                onChange={e => { setFilterFrom(e.target.value); setPage(1); }}
                className="border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-400">To</span>
              <input type="datetime-local" value={filterTo}
                onChange={e => { setFilterTo(e.target.value); setPage(1); }}
                className="border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <button onClick={() => { setFilterSeverity(''); setFilterSource(''); setFilterFrom(''); setFilterTo(''); setPage(1); }}
              className="px-3 py-2 text-sm text-gray-500 hover:text-gray-800 border border-gray-200 rounded-xl hover:bg-gray-50">
              Clear
            </button>
          </div>

          {/* Table */}
          <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50 text-gray-500 uppercase text-xs">
                <tr>
                  <th className="px-4 py-3 text-left">#</th>
                  <th className="px-4 py-3 text-left">Timestamp</th>
                  <th className="px-4 py-3 text-left">Severity</th>
                  <th className="px-4 py-3 text-left">Source</th>
                  <th className="px-4 py-3 text-left">Error Type</th>
                  <th className="px-4 py-3 text-left">Message</th>
                  <th className="px-4 py-3 text-left">User</th>
                  <th className="px-4 py-3 text-left">Path</th>
                  <th className="px-4 py-3 text-left"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {loading ? (
                  <tr><td colSpan={9} className="px-4 py-10 text-center text-gray-400">Loading…</td></tr>
                ) : items.length === 0 ? (
                  <tr><td colSpan={9} className="px-4 py-10 text-center text-gray-400">No entries found.</td></tr>
                ) : items.map(row => (
                  <tr key={row.id} onClick={() => setSelected(row)}
                    className={`cursor-pointer transition-colors hover:bg-blue-50 ${row.severity === 'critical' ? 'bg-red-50' : ''}`}>
                    <td className="px-4 py-2.5 text-gray-400 font-mono text-xs">#{row.id}</td>
                    <td className="px-4 py-2.5 text-gray-500 text-xs whitespace-nowrap">
                      {new Date(row.timestamp).toLocaleString()}
                    </td>
                    <td className="px-4 py-2.5"><SeverityBadge severity={row.severity} /></td>
                    <td className="px-4 py-2.5"><SourceBadge source={row.source} /></td>
                    <td className="px-4 py-2.5 font-mono text-gray-700 text-xs">{row.error_type || '—'}</td>
                    <td className="px-4 py-2.5 text-gray-700 max-w-xs">
                      <p className="truncate">{row.message}</p>
                      {row.traceback && <span className="text-xs text-red-400">has traceback</span>}
                    </td>
                    <td className="px-4 py-2.5 text-gray-400 font-mono text-xs">{row.user_id ?? '—'}</td>
                    <td className="px-4 py-2.5 text-gray-400 font-mono text-xs max-w-[150px] truncate">
                      {row.request_path || '—'}
                    </td>
                    <td className="px-4 py-2.5">
                      <span className="text-xs text-blue-500 hover:underline whitespace-nowrap">View →</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div className="flex items-center justify-between mt-4 text-sm text-gray-600">
            <span>{total.toLocaleString()} entries · Page {page} of {totalPages || 1}</span>
            <div className="flex gap-2">
              <button disabled={page === 1} onClick={() => setPage(p => p - 1)}
                className="px-4 py-1.5 border border-gray-200 rounded-xl disabled:opacity-40 hover:bg-gray-50 text-sm">
                ← Previous
              </button>
              <button disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}
                className="px-4 py-1.5 border border-gray-200 rounded-xl disabled:opacity-40 hover:bg-gray-50 text-sm">
                Next →
              </button>
            </div>
          </div>
        </div>
      </main>

      {/* Detail panel */}
      {selected && <ErrorDetailPanel entry={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}
