'use client';
import { useEffect, useState } from 'react';
import { worklogApi } from '@/lib/api';
import MainHeader from '@/components/MainHeader';
import AdminNav from '@/components/AdminNav';

interface PendingEntry {
  id: number; user_id: number; user_name: string; category_name: string; group_name: string;
  log_date: string; hours: number; summary: string; attachments: any[]; created_at: string; is_late_entry: boolean;
}

export default function WorklogApproval() {
  const [entries, setEntries] = useState<PendingEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [rejectId, setRejectId] = useState<number | null>(null);
  const [rejectNote, setRejectNote] = useState('');

  const load = () => {
    setLoading(true);
    worklogApi.listPendingEntries().then(r => { setEntries(r.data); setLoading(false); });
  };

  useEffect(() => { load(); }, []);

  const handleApprove = async (id: number) => {
    await worklogApi.approveEntry(id);
    load();
  };

  const handleReject = async () => {
    if (!rejectId || !rejectNote.trim()) return;
    await worklogApi.rejectEntry(rejectId, { rejection_note: rejectNote });
    setRejectId(null);
    setRejectNote('');
    load();
  };

  return (
    <div className="ml-60 pt-14 min-h-screen bg-gray-50">
      <MainHeader />
      <AdminNav />
      <div className="p-6 max-w-6xl">
        <h1 className="text-2xl font-bold text-gray-900 mb-6">Worklog Approval Queue</h1>

        {rejectId && (
          <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg p-6 w-96">
              <h3 className="font-medium mb-3">Rejection Reason</h3>
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
                {entries.map(entry => (
                  <tr key={entry.id} className={entry.is_late_entry ? 'bg-amber-50' : ''}>
                    <td className="px-4 py-3">
                      <span className="font-medium text-gray-900">{entry.user_name}</span>
                      {entry.is_late_entry && <span className="ml-2 text-xs text-amber-600" title="Late entry">&#9888;</span>}
                    </td>
                    <td className="px-4 py-3 text-gray-600">{entry.log_date}</td>
                    <td className="px-4 py-3 text-gray-600">{entry.group_name} &gt; {entry.category_name}</td>
                    <td className="px-4 py-3 text-right font-bold">{entry.hours}h</td>
                    <td className="px-4 py-3 text-gray-600 max-w-xs truncate">{entry.summary || '—'}</td>
                    <td className="px-4 py-3">
                      {entry.attachments.length > 0 ? (
                        <div className="flex gap-1 flex-wrap">
                          {entry.attachments.map((a: any) => (
                            <span key={a.id} className="text-xs bg-gray-100 px-2 py-0.5 rounded">{a.file_name}</span>
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
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
