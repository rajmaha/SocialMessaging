'use client';
import { useEffect, useState, useRef } from 'react';
import { worklogApi } from '@/lib/api';
import MainHeader from '@/components/MainHeader';
import AdminNav from '@/components/AdminNav';
import { authAPI } from '@/lib/auth';

interface CategoryGroup { id: number; name: string; color: string; categories: { id: number; name: string; }[]; }
interface Entry { id: number; category_id: number; category_name: string; group_name: string; log_date: string; hours: number; summary: string; status: string; rejection_note: string | null; attachments: any[]; created_at: string; }

export default function WorklogPage() {
  const user = authAPI.getUser();
  const [groups, setGroups] = useState<CategoryGroup[]>([]);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0]);
  const [form, setForm] = useState({ category_id: 0, hours: '', summary: '' });
  const [timerActive, setTimerActive] = useState(false);
  const [timerSeconds, setTimerSeconds] = useState(0);
  const [timerCategoryId, setTimerCategoryId] = useState(0);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const [summary, setSummary] = useState<any>(null);

  const load = async () => {
    setLoading(true);
    const [groupsRes, entriesRes, timerRes] = await Promise.all([
      worklogApi.listCategoryGroups(),
      worklogApi.listEntries({ log_date: selectedDate }),
      worklogApi.getTimerStatus(),
    ]);
    setGroups(groupsRes.data);
    setEntries(entriesRes.data);
    if (timerRes.data.active) {
      setTimerActive(true);
      setTimerSeconds(timerRes.data.elapsed_seconds);
      setTimerCategoryId(timerRes.data.category_id);
    }
    worklogApi.getSummary().then(r => setSummary(r.data)).catch(() => {});
    setLoading(false);
  };

  const handleExportMine = async () => {
    const res = await worklogApi.exportEntries({ format: 'csv', log_date: selectedDate });
    const url = window.URL.createObjectURL(new Blob([res.data]));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'my-worklog.csv';
    a.click();
    window.URL.revokeObjectURL(url);
  };

  useEffect(() => { load(); }, [selectedDate]);

  useEffect(() => {
    if (timerActive) {
      timerRef.current = setInterval(() => setTimerSeconds(s => s + 1), 1000);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [timerActive]);

  const formatTime = (secs: number) => {
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = secs % 60;
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  const handleStartTimer = async () => {
    if (!timerCategoryId) return alert('Select a category first');
    await worklogApi.startTimer({ category_id: timerCategoryId, log_date: selectedDate });
    setTimerActive(true);
    setTimerSeconds(0);
  };

  const handleStopTimer = async () => {
    const summary = prompt('Summary for this time entry:') || '';
    await worklogApi.stopTimer({ summary });
    setTimerActive(false);
    setTimerSeconds(0);
    load();
  };

  const handleManualEntry = async () => {
    if (!form.category_id || !form.hours) return;
    await worklogApi.createEntry({ category_id: form.category_id, log_date: selectedDate, hours: parseFloat(form.hours), summary: form.summary });
    setForm({ category_id: 0, hours: '', summary: '' });
    load();
  };

  const handleDelete = async (id: number) => {
    if (!confirm('Delete this entry?')) return;
    await worklogApi.deleteEntry(id);
    load();
  };

  const handleResubmit = async (id: number) => {
    await worklogApi.resubmitEntry(id);
    load();
  };

  const handleFileUpload = async (entryId: number, file: File) => {
    await worklogApi.uploadAttachment(entryId, file);
    load();
  };

  const statusBadge = (status: string) => {
    const colors: Record<string, string> = { pending: 'bg-yellow-100 text-yellow-700', approved: 'bg-green-100 text-green-700', rejected: 'bg-red-100 text-red-700' };
    return <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${colors[status] || ''}`}>{status}</span>;
  };

  const totalHours = entries.reduce((sum, e) => sum + e.hours, 0);

  return (
    <div className="ml-60 pt-14 min-h-screen bg-gray-50">
      <MainHeader user={user!} />
      <AdminNav />
      <div className="p-6 max-w-5xl">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold text-gray-900">Daily Worklog</h1>
          <div className="flex items-center gap-3">
            <input type="date" value={selectedDate} onChange={e => setSelectedDate(e.target.value)} className="border rounded px-3 py-2 text-sm" />
            <span className="text-sm text-gray-500">Total: <strong>{totalHours.toFixed(1)}h</strong></span>
            <button onClick={handleExportMine} className="px-3 py-2 bg-green-600 text-white rounded text-sm font-medium hover:bg-green-700">Export CSV</button>
          </div>
        </div>

        {/* Summary Cards */}
        {summary && (
          <div className="grid grid-cols-5 gap-3 mb-4">
            <div className="bg-white border rounded-lg p-3 text-center">
              <div className="text-xl font-bold text-gray-900">{summary.today_hours.toFixed(1)}h</div>
              <div className="text-xs text-gray-500">Today</div>
            </div>
            <div className="bg-white border rounded-lg p-3 text-center">
              <div className="text-xl font-bold text-gray-900">{summary.week_hours.toFixed(1)}h</div>
              <div className="text-xs text-gray-500">This Week</div>
            </div>
            <div className="bg-white border rounded-lg p-3 text-center">
              <div className="text-xl font-bold text-yellow-600">{summary.pending_count}</div>
              <div className="text-xs text-gray-500">Pending</div>
            </div>
            <div className="bg-white border rounded-lg p-3 text-center">
              <div className="text-xl font-bold text-green-600">{summary.approved_week_count}</div>
              <div className="text-xs text-gray-500">Approved (Week)</div>
            </div>
            <div className="bg-white border rounded-lg p-3 text-center">
              <div className={`text-xl font-bold ${summary.timer_active ? 'text-red-600' : 'text-gray-400'}`}>
                {summary.timer_active ? 'Running' : 'Idle'}
              </div>
              <div className="text-xs text-gray-500">Timer</div>
            </div>
          </div>
        )}

        {/* Timer Section */}
        <div className="bg-white border rounded-lg p-4 mb-4">
          <h3 className="text-sm font-medium text-gray-700 mb-3">Timer</h3>
          <div className="flex items-center gap-4">
            <select value={timerCategoryId} onChange={e => setTimerCategoryId(Number(e.target.value))} className="border rounded px-3 py-2 text-sm flex-1" disabled={timerActive}>
              <option value={0}>Select category...</option>
              {groups.map(g => (
                <optgroup key={g.id} label={g.name}>
                  {g.categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </optgroup>
              ))}
            </select>
            <span className="font-mono text-xl font-bold text-gray-900 w-28 text-center">{formatTime(timerSeconds)}</span>
            {!timerActive ? (
              <button onClick={handleStartTimer} className="px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700">Start</button>
            ) : (
              <button onClick={handleStopTimer} className="px-4 py-2 bg-red-600 text-white rounded-lg text-sm font-medium hover:bg-red-700">Stop</button>
            )}
          </div>
        </div>

        {/* Manual Entry Form */}
        <div className="bg-white border rounded-lg p-4 mb-4">
          <h3 className="text-sm font-medium text-gray-700 mb-3">Manual Entry</h3>
          <div className="flex gap-3 items-end">
            <div className="flex-1">
              <label className="text-xs text-gray-500">Category</label>
              <select value={form.category_id} onChange={e => setForm({ ...form, category_id: Number(e.target.value) })} className="w-full border rounded px-3 py-2 text-sm">
                <option value={0}>Select...</option>
                {groups.map(g => (
                  <optgroup key={g.id} label={g.name}>
                    {g.categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </optgroup>
                ))}
              </select>
            </div>
            <div className="w-24">
              <label className="text-xs text-gray-500">Hours</label>
              <input type="number" step="0.25" min="0" value={form.hours} onChange={e => setForm({ ...form, hours: e.target.value })} className="w-full border rounded px-3 py-2 text-sm" placeholder="2.5" />
            </div>
            <div className="flex-1">
              <label className="text-xs text-gray-500">Summary</label>
              <input value={form.summary} onChange={e => setForm({ ...form, summary: e.target.value })} className="w-full border rounded px-3 py-2 text-sm" placeholder="What did you work on?" />
            </div>
            <button onClick={handleManualEntry} className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700">Add</button>
          </div>
        </div>

        {/* Entries List */}
        <div className="bg-white border rounded-lg overflow-hidden">
          <div className="px-4 py-3 border-b bg-gray-50">
            <h3 className="text-sm font-medium text-gray-700">Today&apos;s Entries</h3>
          </div>
          {loading ? (
            <div className="p-8 text-center text-gray-500">Loading...</div>
          ) : entries.length === 0 ? (
            <div className="p-8 text-center text-gray-500">No entries for this date.</div>
          ) : (
            <div className="divide-y">
              {entries.map(entry => (
                <div key={entry.id} className="px-4 py-3 flex items-center gap-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-gray-900">{entry.group_name} &gt; {entry.category_name}</span>
                      {statusBadge(entry.status)}
                    </div>
                    {entry.summary && <p className="text-sm text-gray-600 mt-0.5">{entry.summary}</p>}
                    {entry.rejection_note && <p className="text-xs text-red-600 mt-1">Rejection: {entry.rejection_note}</p>}
                    {entry.attachments.length > 0 && (
                      <div className="flex gap-2 mt-1">
                        {entry.attachments.map((a: any) => (
                          <span key={a.id} className="text-xs bg-gray-100 px-2 py-0.5 rounded">{a.file_name}</span>
                        ))}
                      </div>
                    )}
                  </div>
                  <span className="text-sm font-bold text-gray-900 w-16 text-right">{entry.hours}h</span>
                  <div className="flex gap-2">
                    {entry.status === 'pending' && (
                      <>
                        <label className="text-xs text-indigo-600 hover:underline cursor-pointer">
                          Attach
                          <input type="file" className="hidden" onChange={e => e.target.files?.[0] && handleFileUpload(entry.id, e.target.files[0])} />
                        </label>
                        <button onClick={() => handleDelete(entry.id)} className="text-xs text-red-500 hover:underline">Delete</button>
                      </>
                    )}
                    {entry.status === 'rejected' && (
                      <button onClick={() => handleResubmit(entry.id)} className="text-xs text-indigo-600 hover:underline">Resubmit</button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
