'use client';
import React, { useEffect, useState, useRef } from 'react';
import { worklogApi } from '@/lib/api';
import MainHeader from '@/components/MainHeader';
import AdminNav from '@/components/AdminNav';
import { authAPI } from '@/lib/auth';

interface PendingEntry {
  id: number; user_id: number; user_name: string; category_name: string; group_name: string;
  log_date: string; hours: number; summary: string; attachments: any[]; created_at: string; is_late_entry: boolean;
}

export default function WorklogApproval() {
  const user = authAPI.getUser();
  const [entries, setEntries] = useState<PendingEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [rejectId, setRejectId] = useState<number | null>(null);
  const [rejectNote, setRejectNote] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [groupBy, setGroupBy] = useState<'none' | 'agent' | 'date'>('none');
  const lastClickedRef = useRef<number | null>(null);

  const load = () => {
    setLoading(true);
    worklogApi.listPendingEntries().then(r => { setEntries(r.data); setLoading(false); });
  };

  useEffect(() => { load(); }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === 'a' && !e.metaKey && !e.ctrlKey && selectedIds.size > 0) {
        e.preventDefault();
        handleBulkApprove();
      }
      if (e.key === 'r' && selectedIds.size > 0) {
        e.preventDefault();
        setRejectId(-1);
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'a') {
        e.preventDefault();
        setSelectedIds(new Set(entries.map(e => e.id)));
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [selectedIds, entries]);

  const handleApprove = async (id: number) => {
    await worklogApi.approveEntry(id);
    setSelectedIds(prev => { const n = new Set(prev); n.delete(id); return n; });
    load();
  };

  const handleReject = async () => {
    if (!rejectNote.trim()) return;
    if (rejectId === -1 && selectedIds.size > 0) {
      await worklogApi.bulkReject([...selectedIds], rejectNote);
      setSelectedIds(new Set());
    } else if (rejectId && rejectId > 0) {
      await worklogApi.rejectEntry(rejectId, { rejection_note: rejectNote });
    }
    setRejectId(null);
    setRejectNote('');
    load();
  };

  const handleBulkApprove = async () => {
    if (!confirm(`Approve ${selectedIds.size} entries?`)) return;
    await worklogApi.bulkApprove([...selectedIds]);
    setSelectedIds(new Set());
    load();
  };

  const handleRowCheck = (id: number, e: React.MouseEvent<HTMLInputElement>) => {
    const newSelected = new Set(selectedIds);
    if (e.shiftKey && lastClickedRef.current !== null) {
      const ids = entries.map(entry => entry.id);
      const start = ids.indexOf(lastClickedRef.current);
      const end = ids.indexOf(id);
      const range = ids.slice(Math.min(start, end), Math.max(start, end) + 1);
      range.forEach(rid => newSelected.add(rid));
    } else {
      if (newSelected.has(id)) newSelected.delete(id);
      else newSelected.add(id);
    }
    lastClickedRef.current = id;
    setSelectedIds(newSelected);
  };

  const handleSelectAll = () => {
    if (selectedIds.size === entries.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(entries.map(e => e.id)));
    }
  };

  const handleDownloadAttachment = async (id: number, fileName: string) => {
    const res = await worklogApi.downloadAttachment(id);
    const blob = new Blob([res.data], { type: res.headers['content-type'] || '' });
    const url = window.URL.createObjectURL(blob);
    const previewable = /^(image\/|application\/pdf|text\/|video\/|audio\/)/.test(blob.type);
    if (previewable) {
      window.open(url, '_blank');
    } else {
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      a.click();
      window.URL.revokeObjectURL(url);
    }
  };

  const handleExportHistory = async () => {
    const res = await worklogApi.exportApprovalHistory();
    const url = window.URL.createObjectURL(new Blob([res.data]));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'approval-history.csv';
    a.click();
    window.URL.revokeObjectURL(url);
  };

  const groupedEntries = () => {
    if (groupBy === 'none') return [{ key: '', entries }];
    if (groupBy === 'agent') {
      const map: Record<string, PendingEntry[]> = {};
      entries.forEach(e => { (map[e.user_name] ||= []).push(e); });
      return Object.entries(map).map(([key, entries]) => ({ key, entries }));
    }
    const map: Record<string, PendingEntry[]> = {};
    entries.forEach(e => { (map[e.log_date] ||= []).push(e); });
    return Object.entries(map).map(([key, entries]) => ({ key, entries }));
  };

  const handleGroupSelect = (groupEntries: PendingEntry[]) => {
    const newSelected = new Set(selectedIds);
    const allSelected = groupEntries.every(e => newSelected.has(e.id));
    if (allSelected) {
      groupEntries.forEach(e => newSelected.delete(e.id));
    } else {
      groupEntries.forEach(e => newSelected.add(e.id));
    }
    setSelectedIds(newSelected);
  };

  return (
    <div className="ml-60 pt-14 min-h-screen bg-gray-50">
      <MainHeader user={user!} />
      <AdminNav />
      <div className="p-6 max-w-6xl">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold text-gray-900">Worklog Approval Queue</h1>
          <div className="flex items-center gap-3">
            <select value={groupBy} onChange={e => setGroupBy(e.target.value as any)} className="border rounded px-3 py-2 text-sm">
              <option value="none">No Grouping</option>
              <option value="agent">Group by Agent</option>
              <option value="date">Group by Date</option>
            </select>
            <button onClick={handleExportHistory} className="px-3 py-2 bg-green-600 text-white rounded text-sm font-medium hover:bg-green-700">Export History</button>
          </div>
        </div>

        {rejectId !== null && (
          <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg p-6 w-96">
              <h3 className="font-medium mb-3">
                {rejectId === -1 ? `Reject ${selectedIds.size} Entries` : 'Rejection Reason'}
              </h3>
              <textarea value={rejectNote} onChange={e => setRejectNote(e.target.value)} className="w-full border rounded px-3 py-2 text-sm h-24" placeholder="Explain why this entry is rejected..." />
              <div className="flex justify-end gap-2 mt-3">
                <button onClick={() => { setRejectId(null); setRejectNote(''); }} className="px-3 py-2 bg-gray-200 rounded text-sm">Cancel</button>
                <button onClick={handleReject} className="px-3 py-2 bg-red-600 text-white rounded text-sm">Reject</button>
              </div>
            </div>
          </div>
        )}

        {loading ? (
          <div className="text-center py-12 text-gray-500">Loading...</div>
        ) : entries.length === 0 ? (
          <div className="text-center py-12 text-gray-500">No pending entries to approve.</div>
        ) : (
          <div className="bg-white border rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b">
                <tr>
                  <th className="px-4 py-3 w-10">
                    <input type="checkbox" checked={selectedIds.size === entries.length && entries.length > 0} onChange={handleSelectAll} className="rounded" />
                  </th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Agent</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Date</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Category</th>
                  <th className="text-right px-4 py-3 font-medium text-gray-600">Hours</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Summary</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Attachments</th>
                  <th className="text-right px-4 py-3 font-medium text-gray-600">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {groupedEntries().map((group, gi) => (
                  <React.Fragment key={group.key || gi}>{group.key && (
                    <tr key={`group-${group.key}`} className="bg-gray-100">
                      <td className="px-4 py-2">
                        <input type="checkbox" checked={group.entries.every(e => selectedIds.has(e.id))} onChange={() => handleGroupSelect(group.entries)} className="rounded" />
                      </td>
                      <td colSpan={7} className="px-4 py-2 text-sm font-medium text-gray-700">
                        {groupBy === 'agent' ? `Agent: ${group.key}` : `Date: ${group.key}`} ({group.entries.length} entries)
                      </td>
                    </tr>
                  )}
                  {group.entries.map(entry => (
                    <tr key={entry.id} className={entry.is_late_entry ? 'bg-amber-50' : ''}>
                      <td className="px-4 py-3">
                        <input
                          type="checkbox"
                          checked={selectedIds.has(entry.id)}
                          onClick={(e) => handleRowCheck(entry.id, e as any)}
                          readOnly
                          className="rounded"
                        />
                      </td>
                      <td className="px-4 py-3">
                        <span className="font-medium text-gray-900">{entry.user_name}</span>
                        {entry.is_late_entry && <span className="ml-2 text-xs text-amber-600" title="Late entry">&#9888;</span>}
                      </td>
                      <td className="px-4 py-3 text-gray-600">{entry.log_date}</td>
                      <td className="px-4 py-3 text-gray-600">{entry.group_name} &gt; {entry.category_name}</td>
                      <td className="px-4 py-3 text-right font-bold">{entry.hours}h</td>
                      <td className="px-4 py-3 text-gray-600 max-w-xs truncate">{entry.summary ? <span dangerouslySetInnerHTML={{ __html: entry.summary }} /> : '—'}</td>
                      <td className="px-4 py-3">
                        {entry.attachments.length > 0 ? (
                          <div className="flex gap-1 flex-wrap">
                            {entry.attachments.map((a: any) => (
                              <button key={a.id} onClick={() => handleDownloadAttachment(a.id, a.file_name)}
                                className="text-xs bg-gray-100 px-2 py-0.5 rounded text-indigo-600 hover:text-indigo-800 hover:bg-gray-200 cursor-pointer">{a.file_name}</button>
                            ))}
                          </div>
                        ) : '—'}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex gap-2 justify-end">
                          <button onClick={() => handleApprove(entry.id)} className="px-3 py-1 bg-green-600 text-white rounded text-xs font-medium">Approve</button>
                          <button onClick={() => setRejectId(entry.id)} className="px-3 py-1 bg-red-100 text-red-700 rounded text-xs font-medium">Reject</button>
                        </div>
                      </td>
                    </tr>
                  ))}</React.Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Floating action bar */}
        {selectedIds.size > 0 && (
          <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-gray-900 text-white rounded-lg shadow-xl px-6 py-3 flex items-center gap-4 z-50">
            <span className="text-sm">{selectedIds.size} entries selected</span>
            <button onClick={handleBulkApprove} className="px-4 py-1.5 bg-green-500 rounded text-sm font-medium hover:bg-green-600">Approve All</button>
            <button onClick={() => setRejectId(-1)} className="px-4 py-1.5 bg-red-500 rounded text-sm font-medium hover:bg-red-600">Reject All</button>
            <button onClick={() => setSelectedIds(new Set())} className="px-4 py-1.5 bg-gray-700 rounded text-sm font-medium hover:bg-gray-600">Clear</button>
          </div>
        )}

        <div className="mt-4 text-xs text-gray-400">
          Shortcuts: <kbd className="px-1 bg-gray-200 rounded">A</kbd> approve selected &middot; <kbd className="px-1 bg-gray-200 rounded">R</kbd> reject selected &middot; <kbd className="px-1 bg-gray-200 rounded">Ctrl+A</kbd> select all
        </div>
      </div>
    </div>
  );
}
