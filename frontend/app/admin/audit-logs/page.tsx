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

export default function AuditLogsPage() {
  const router = useRouter();
  const user = authAPI.getUser();

  const [items, setItems] = useState<AuditEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);

  // Filters
  const [filterAction, setFilterAction] = useState('');
  const [filterUserId, setFilterUserId] = useState('');
  const [filterFrom, setFilterFrom] = useState('');
  const [filterTo, setFilterTo] = useState('');

  const PAGE_SIZE = 50;

  useEffect(() => {
    if (!user || user.role !== 'admin') {
      router.push('/dashboard');
    }
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

  const exportCsv = () => {
    const params = new URLSearchParams();
    if (filterAction) params.set('action', filterAction);
    if (filterUserId) params.set('user_id', filterUserId);
    if (filterFrom) params.set('date_from', filterFrom);
    if (filterTo) params.set('date_to', filterTo);
    window.open(`${API_URL}/logs/audit/export?${params}&token=${getAuthToken()}`, '_blank');
  };

  const totalPages = Math.ceil(total / PAGE_SIZE);

  return (
    <div className="min-h-screen bg-gray-50">
      <MainHeader user={user!} />
      <div className="flex">
        <AdminNav />
        <main className="flex-1 p-6">
          <div className="flex items-center justify-between mb-4">
            <h1 className="text-2xl font-bold text-gray-800">Audit Logs</h1>
            <button
              onClick={exportCsv}
              className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 text-sm"
            >
              Export CSV
            </button>
          </div>

          {/* Filters */}
          <div className="flex flex-wrap gap-3 mb-4 bg-white p-4 rounded shadow-sm">
            <input
              type="text"
              placeholder="Filter by action (e.g. auth.login)"
              value={filterAction}
              onChange={e => { setFilterAction(e.target.value); setPage(1); }}
              className="border rounded px-3 py-2 text-sm w-64"
            />
            <input
              type="text"
              placeholder="Filter by user ID"
              value={filterUserId}
              onChange={e => { setFilterUserId(e.target.value); setPage(1); }}
              className="border rounded px-3 py-2 text-sm w-36"
            />
            <input
              type="datetime-local"
              value={filterFrom}
              onChange={e => { setFilterFrom(e.target.value); setPage(1); }}
              className="border rounded px-3 py-2 text-sm"
            />
            <input
              type="datetime-local"
              value={filterTo}
              onChange={e => { setFilterTo(e.target.value); setPage(1); }}
              className="border rounded px-3 py-2 text-sm"
            />
            <button
              onClick={() => { setFilterAction(''); setFilterUserId(''); setFilterFrom(''); setFilterTo(''); setPage(1); }}
              className="px-3 py-2 text-sm text-gray-600 hover:text-gray-800"
            >
              Clear
            </button>
          </div>

          {/* Table */}
          <div className="bg-white rounded shadow overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-100 text-gray-700 uppercase text-xs">
                <tr>
                  <th className="px-4 py-3 text-left">Timestamp</th>
                  <th className="px-4 py-3 text-left">User</th>
                  <th className="px-4 py-3 text-left">Role</th>
                  <th className="px-4 py-3 text-left">Action</th>
                  <th className="px-4 py-3 text-left">Entity</th>
                  <th className="px-4 py-3 text-left">Detail</th>
                  <th className="px-4 py-3 text-left">IP</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {loading ? (
                  <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-400">Loading…</td></tr>
                ) : items.length === 0 ? (
                  <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-400">No entries found.</td></tr>
                ) : items.map(row => (
                  <tr key={row.id} className="hover:bg-gray-50">
                    <td className="px-4 py-2 whitespace-nowrap text-gray-500 text-xs">{new Date(row.timestamp).toLocaleString()}</td>
                    <td className="px-4 py-2 text-gray-700">{row.user_email || row.user_id || '—'}</td>
                    <td className="px-4 py-2 text-gray-500">{row.user_role || '—'}</td>
                    <td className="px-4 py-2 font-mono text-blue-700">{row.action}</td>
                    <td className="px-4 py-2 text-gray-500">{row.entity_type ? `${row.entity_type} #${row.entity_id}` : '—'}</td>
                    <td className="px-4 py-2 text-gray-400 text-xs max-w-xs truncate">{row.detail ? JSON.stringify(row.detail) : '—'}</td>
                    <td className="px-4 py-2 text-gray-400 text-xs">{row.ip_address || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div className="flex items-center justify-between mt-4 text-sm text-gray-600">
            <span>{total} total entries</span>
            <div className="flex gap-2">
              <button disabled={page === 1} onClick={() => setPage(p => p - 1)}
                className="px-3 py-1 border rounded disabled:opacity-40">Previous</button>
              <span className="px-3 py-1">Page {page} of {totalPages || 1}</span>
              <button disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}
                className="px-3 py-1 border rounded disabled:opacity-40">Next</button>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
