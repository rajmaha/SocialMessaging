'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { authAPI, getAuthToken } from '@/lib/auth';
import AdminNav from '@/components/AdminNav';
import MainHeader from '@/components/MainHeader';
import { API_URL } from '@/lib/config';

interface AuditEntry {
  id: number;
  timestamp: string;
  user_id: number | null;
  user_email: string | null;
  user_role: string | null;
  action: string;
  entity_type: string | null;
  entity_id: number | null;
  detail: Record<string, unknown> | null;
  ip_address: string | null;
  request_path: string | null;
  request_method: string | null;
}

const ACTION_COLORS: Record<string, string> = {
  'auth.login': 'bg-green-100 text-green-700',
  'auth.login_failed': 'bg-red-100 text-red-700',
  'user.created': 'bg-blue-100 text-blue-700',
  'user.updated': 'bg-yellow-100 text-yellow-700',
  'user.deleted': 'bg-red-100 text-red-700',
  'conversation.assigned': 'bg-purple-100 text-purple-700',
  'conversation.status_changed': 'bg-indigo-100 text-indigo-700',
  'message.sent': 'bg-teal-100 text-teal-700',
};

function ActionBadge({ action }: { action: string }) {
  const color = ACTION_COLORS[action] || 'bg-gray-100 text-gray-700';
  return <span className={`px-2 py-0.5 rounded text-xs font-mono font-medium ${color}`}>{action}</span>;
}

function RoleBadge({ role }: { role: string | null }) {
  if (!role) return <span className="text-gray-300">—</span>;
  const color = role === 'admin' ? 'bg-red-50 text-red-700' : 'bg-blue-50 text-blue-700';
  return <span className={`px-2 py-0.5 rounded text-xs font-semibold ${color}`}>{role}</span>;
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

function AuditDetailPanel({ entry, onClose }: { entry: AuditEntry; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex">
      {/* Backdrop */}
      <div className="flex-1 bg-black/30" onClick={onClose} />

      {/* Panel */}
      <div className="w-full max-w-xl bg-white shadow-2xl flex flex-col h-full overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 bg-gray-50">
          <div>
            <h2 className="text-base font-bold text-gray-900">Audit Log #{entry.id}</h2>
            <p className="text-xs text-gray-400 mt-0.5">{new Date(entry.timestamp).toLocaleString()}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">✕</button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">

          {/* Action */}
          <div className="bg-white border border-gray-100 rounded-xl p-4">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Action</p>
            <ActionBadge action={entry.action} />
          </div>

          {/* User info */}
          <div className="bg-white border border-gray-100 rounded-xl p-4 space-y-3">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">User</p>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <p className="text-xs text-gray-400 mb-0.5">Email</p>
                <p className="text-gray-800 font-medium">{entry.user_email || '—'}</p>
              </div>
              <div>
                <p className="text-xs text-gray-400 mb-0.5">User ID</p>
                <p className="text-gray-800 font-mono">{entry.user_id ?? '—'}</p>
              </div>
              <div>
                <p className="text-xs text-gray-400 mb-0.5">Role</p>
                <RoleBadge role={entry.user_role} />
              </div>
              <div>
                <p className="text-xs text-gray-400 mb-0.5">IP Address</p>
                <p className="text-gray-800 font-mono text-xs">{entry.ip_address || '—'}</p>
              </div>
            </div>
          </div>

          {/* Entity */}
          {(entry.entity_type || entry.entity_id) && (
            <div className="bg-white border border-gray-100 rounded-xl p-4 space-y-2">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Entity</p>
              <div className="flex items-center gap-3">
                <span className="px-2 py-1 bg-indigo-50 text-indigo-700 rounded text-xs font-semibold">{entry.entity_type}</span>
                {entry.entity_id && <span className="text-gray-500 font-mono text-sm">#{entry.entity_id}</span>}
              </div>
            </div>
          )}

          {/* Request info */}
          <div className="bg-white border border-gray-100 rounded-xl p-4 space-y-3">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Request</p>
            <div className="flex items-center gap-2">
              <MethodBadge method={entry.request_method} />
              <span className="text-gray-600 font-mono text-xs">{entry.request_path || '—'}</span>
            </div>
          </div>

          {/* Detail JSON */}
          {entry.detail && (
            <div className="bg-white border border-gray-100 rounded-xl p-4">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Detail</p>
              <div className="space-y-2">
                {Object.entries(entry.detail).map(([k, v]) => (
                  <div key={k} className="flex items-start gap-3">
                    <span className="text-xs font-semibold text-gray-500 min-w-[100px] mt-0.5">{k}</span>
                    <span className="text-xs text-gray-800 font-mono bg-gray-50 px-2 py-0.5 rounded break-all">
                      {v === null ? 'null' : String(v)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function AuditLogsPage() {
  const router = useRouter();
  const user = authAPI.getUser();

  const [items, setItems] = useState<AuditEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<AuditEntry | null>(null);

  // Filters
  const [filterAction, setFilterAction] = useState('');
  const [filterUserId, setFilterUserId] = useState('');
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
      if (filterAction) params.set('action', filterAction);
      if (filterUserId) params.set('user_id', filterUserId);
      if (filterFrom) params.set('date_from', filterFrom);
      if (filterTo) params.set('date_to', filterTo);
      const res = await fetch(`${API_URL}/logs/audit?${params}`, {
        headers: { Authorization: `Bearer ${getAuthToken()}` },
      });
      const data = await res.json();
      setItems(data.items || []);
      setTotal(data.total || 0);
    } finally {
      setLoading(false);
    }
  }, [page, filterAction, filterUserId, filterFrom, filterTo]);

  useEffect(() => { fetchLogs(); }, [fetchLogs]);

  const exportCsv = async () => {
    const params = new URLSearchParams();
    if (filterAction) params.set('action', filterAction);
    if (filterUserId) params.set('user_id', filterUserId);
    if (filterFrom) params.set('date_from', filterFrom);
    if (filterTo) params.set('date_to', filterTo);
    const res = await fetch(`${API_URL}/logs/audit/export?${params}`, {
      headers: { Authorization: `Bearer ${getAuthToken()}` },
    });
    if (!res.ok) return;
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'audit_logs.csv'; a.click();
    URL.revokeObjectURL(url);
  };

  const totalPages = Math.ceil(total / PAGE_SIZE);

  return (
    <div className="min-h-screen bg-gray-50">
      <MainHeader user={user!} />
      <AdminNav />
      <main className="ml-60 pt-14 p-6">
        <div className="max-w-7xl mx-auto">

          {/* Header */}
          <div className="flex items-center justify-between mb-6">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Audit Logs</h1>
              <p className="text-sm text-gray-500 mt-0.5">{total.toLocaleString()} total entries — click any row for full detail</p>
            </div>
            <button onClick={exportCsv}
              className="px-4 py-2 bg-green-600 text-white rounded-xl hover:bg-green-700 text-sm font-semibold shadow-sm">
              ↓ Export CSV
            </button>
          </div>

          {/* Filters */}
          <div className="flex flex-wrap gap-3 mb-5 bg-white p-4 rounded-2xl border border-gray-200 shadow-sm">
            <input type="text" placeholder="Filter by action (e.g. auth.login)"
              value={filterAction}
              onChange={e => { setFilterAction(e.target.value); setPage(1); }}
              className="border border-gray-200 rounded-xl px-3 py-2 text-sm w-64 focus:outline-none focus:ring-2 focus:ring-blue-500" />
            <input type="text" placeholder="User ID"
              value={filterUserId}
              onChange={e => { setFilterUserId(e.target.value); setPage(1); }}
              className="border border-gray-200 rounded-xl px-3 py-2 text-sm w-28 focus:outline-none focus:ring-2 focus:ring-blue-500" />
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
            <button onClick={() => { setFilterAction(''); setFilterUserId(''); setFilterFrom(''); setFilterTo(''); setPage(1); }}
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
                  <th className="px-4 py-3 text-left">User</th>
                  <th className="px-4 py-3 text-left">Role</th>
                  <th className="px-4 py-3 text-left">Action</th>
                  <th className="px-4 py-3 text-left">Entity</th>
                  <th className="px-4 py-3 text-left">Method</th>
                  <th className="px-4 py-3 text-left">IP</th>
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
                    className="hover:bg-blue-50 cursor-pointer transition-colors">
                    <td className="px-4 py-2.5 text-gray-400 font-mono text-xs">#{row.id}</td>
                    <td className="px-4 py-2.5 text-gray-500 text-xs whitespace-nowrap">
                      {new Date(row.timestamp).toLocaleString()}
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="text-gray-800 text-xs font-medium">{row.user_email || '—'}</div>
                      {row.user_id && <div className="text-gray-400 text-xs font-mono">#{row.user_id}</div>}
                    </td>
                    <td className="px-4 py-2.5"><RoleBadge role={row.user_role} /></td>
                    <td className="px-4 py-2.5"><ActionBadge action={row.action} /></td>
                    <td className="px-4 py-2.5 text-gray-500 text-xs">
                      {row.entity_type ? `${row.entity_type} #${row.entity_id}` : '—'}
                    </td>
                    <td className="px-4 py-2.5"><MethodBadge method={row.request_method} /></td>
                    <td className="px-4 py-2.5 text-gray-400 font-mono text-xs">{row.ip_address || '—'}</td>
                    <td className="px-4 py-2.5">
                      <span className="text-xs text-blue-500 hover:underline">View →</span>
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
      {selected && <AuditDetailPanel entry={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}
