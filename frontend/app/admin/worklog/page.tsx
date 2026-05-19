'use client';
import { useEffect, useState, useRef } from 'react';
import { useSearchParams } from 'next/navigation';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { worklogApi } from '@/lib/api';
import MainHeader from '@/components/MainHeader';
import AdminNav from '@/components/AdminNav';
import { authAPI } from '@/lib/auth';

interface CategoryGroup { id: number; name: string; color: string; categories: { id: number; name: string; }[]; }
interface Entry { id: number; category_id: number; category_name: string; group_name: string; log_date: string; hours: number; summary: string; status: string; rejection_note: string | null; attachments: any[]; created_at: string; }

type EntryMode = 'manual' | 'timer';

function MiniToolbar({ editor }: { editor: any }) {
  if (!editor) return null;
  return (
    <div className="flex items-center gap-0.5 px-2 py-1 border-b bg-gray-50 rounded-t">
      <button type="button" onClick={() => editor.chain().focus().toggleBold().run()}
        className={`px-1.5 py-0.5 rounded text-xs font-bold ${editor.isActive('bold') ? 'bg-indigo-100 text-indigo-700' : 'text-gray-600 hover:bg-gray-100'}`}>B</button>
      <button type="button" onClick={() => editor.chain().focus().toggleItalic().run()}
        className={`px-1.5 py-0.5 rounded text-xs italic ${editor.isActive('italic') ? 'bg-indigo-100 text-indigo-700' : 'text-gray-600 hover:bg-gray-100'}`}>I</button>
      <button type="button" onClick={() => editor.chain().focus().toggleBulletList().run()}
        className={`px-1.5 py-0.5 rounded text-xs ${editor.isActive('bulletList') ? 'bg-indigo-100 text-indigo-700' : 'text-gray-600 hover:bg-gray-100'}`}>&#8226; List</button>
      <button type="button" onClick={() => editor.chain().focus().toggleOrderedList().run()}
        className={`px-1.5 py-0.5 rounded text-xs ${editor.isActive('orderedList') ? 'bg-indigo-100 text-indigo-700' : 'text-gray-600 hover:bg-gray-100'}`}>1. List</button>
    </div>
  );
}

export default function WorklogPage() {
  const user = authAPI.getUser();
  const searchParams = useSearchParams();
  const [groups, setGroups] = useState<CategoryGroup[]>([]);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedDate, setSelectedDate] = useState(searchParams.get('date') || new Date().toISOString().split('T')[0]);
  const [categoryId, setCategoryId] = useState(0);
  const [mode, setMode] = useState<EntryMode>('manual');
  const [hours, setHours] = useState('');
  const [minutes, setMinutes] = useState('');
  const [attachments, setAttachments] = useState<File[]>([]);
  const [timerActive, setTimerActive] = useState(false);
  const [timerSeconds, setTimerSeconds] = useState(0);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const [summary, setSummary] = useState<any>(null);
  const [validationError, setValidationError] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const editor = useEditor({
    extensions: [StarterKit],
    content: '',
    editorProps: {
      attributes: { class: 'prose prose-sm max-w-none px-3 py-2 min-h-[80px] focus:outline-none' },
    },
  });

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
      setCategoryId(timerRes.data.category_id);
      setMode('timer');
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
    if (!categoryId) { setValidationError('Please select a category.'); return; }
    setValidationError('');
    await worklogApi.startTimer({ category_id: categoryId, log_date: selectedDate });
    setTimerActive(true);
    setTimerSeconds(0);
  };

  const handleStopTimer = async () => {
    const summaryText = editor?.getHTML() || '';
    await worklogApi.stopTimer({ summary: summaryText });
    setTimerActive(false);
    setTimerSeconds(0);
    editor?.commands.clearContent();
    load();
  };

  const handleManualEntry = async () => {
    const totalHoursValue = (parseFloat(hours) || 0) + (parseFloat(minutes) || 0) / 60;
    if (!categoryId && totalHoursValue <= 0) { setValidationError('Please select a category and enter time.'); return; }
    if (!categoryId) { setValidationError('Please select a category.'); return; }
    if (totalHoursValue <= 0) { setValidationError('Please enter hours or minutes.'); return; }
    setValidationError('');
    const summaryText = editor?.getHTML() || '';
    const res = await worklogApi.createEntry({ category_id: categoryId, log_date: selectedDate, hours: totalHoursValue, summary: summaryText });
    if (attachments.length > 0 && res.data?.id) {
      for (const file of attachments) {
        await worklogApi.uploadAttachment(res.data.id, file);
      }
    }
    setCategoryId(0);
    setHours('');
    setMinutes('');
    setAttachments([]);
    editor?.commands.clearContent();
    if (fileInputRef.current) fileInputRef.current.value = '';
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

  const handleAddFiles = (files: FileList | null) => {
    if (!files) return;
    setAttachments(prev => [...prev, ...Array.from(files)]);
  };

  const removeAttachment = (idx: number) => {
    setAttachments(prev => prev.filter((_, i) => i !== idx));
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

  const statusBadge = (status: string) => {
    const colors: Record<string, string> = { pending: 'bg-yellow-100 text-yellow-700', approved: 'bg-green-100 text-green-700', rejected: 'bg-red-100 text-red-700' };
    return <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${colors[status] || ''}`}>{status}</span>;
  };

  const formatHoursMinutes = (h: number) => {
    const hrs = Math.floor(h);
    const mins = Math.round((h - hrs) * 60);
    if (hrs > 0 && mins > 0) return `${hrs}h ${mins}m`;
    if (hrs > 0) return `${hrs}h`;
    return `${mins}m`;
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
            <span className="text-sm text-gray-500">Total: <strong>{formatHoursMinutes(totalHours)}</strong></span>
            <button onClick={handleExportMine} className="px-3 py-2 bg-green-600 text-white rounded text-sm font-medium hover:bg-green-700">Export CSV</button>
          </div>
        </div>

        {/* Summary Cards */}
        {summary && (
          <div className="grid grid-cols-5 gap-3 mb-4">
            <div className="bg-white border rounded-lg p-3 text-center">
              <div className="text-xl font-bold text-gray-900">{formatHoursMinutes(summary.today_hours)}</div>
              <div className="text-xs text-gray-500">Today</div>
            </div>
            <div className="bg-white border rounded-lg p-3 text-center">
              <div className="text-xl font-bold text-gray-900">{formatHoursMinutes(summary.week_hours)}</div>
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

        {/* Unified New Entry Form */}
        <div className="bg-white border rounded-lg p-4 mb-4">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-medium text-gray-700">New Entry</h3>
            <div className="flex bg-gray-100 rounded-lg p-0.5">
              <button onClick={() => !timerActive && setMode('manual')}
                className={`px-3 py-1 rounded-md text-xs font-medium transition ${mode === 'manual' ? 'bg-white shadow text-gray-900' : 'text-gray-500'}`}>
                Manual
              </button>
              <button onClick={() => setMode('timer')}
                className={`px-3 py-1 rounded-md text-xs font-medium transition ${mode === 'timer' ? 'bg-white shadow text-gray-900' : 'text-gray-500'}`}>
                Timer
              </button>
            </div>
          </div>

          {validationError && (
            <div className="mb-3 px-3 py-2 bg-red-50 border border-red-200 rounded text-sm text-red-600">{validationError}</div>
          )}

          {/* Category + Hours/Timer row */}
          <div className="flex gap-3 items-end mb-3">
            <div className="flex-1">
              <label className="text-xs text-gray-500 block mb-1">Category</label>
              <select value={categoryId} onChange={e => { setCategoryId(Number(e.target.value)); setValidationError(''); }}
                className="w-full border rounded px-3 py-2 text-sm" disabled={timerActive}>
                <option value={0}>Select category...</option>
                {groups.map(g => (
                  <optgroup key={g.id} label={g.name}>
                    {g.categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </optgroup>
                ))}
              </select>
            </div>
            {mode === 'manual' ? (
              <div className="flex items-end gap-2">
                <div className="w-20">
                  <label className="text-xs text-gray-500 block mb-1">Hours</label>
                  <input type="number" min="0" max="23" step="1" value={hours} onChange={e => { setHours(e.target.value); setValidationError(''); }}
                    className="w-full border rounded px-3 py-2 text-sm" placeholder="0" />
                </div>
                <div className="w-20">
                  <label className="text-xs text-gray-500 block mb-1">Minutes</label>
                  <input type="number" min="0" max="59" step="5" value={minutes} onChange={e => { setMinutes(e.target.value); setValidationError(''); }}
                    className="w-full border rounded px-3 py-2 text-sm" placeholder="0" />
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-3">
                <span className="font-mono text-xl font-bold text-gray-900 w-28 text-center">{formatTime(timerSeconds)}</span>
                {!timerActive ? (
                  <button onClick={handleStartTimer} className="px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700">Start</button>
                ) : (
                  <button onClick={handleStopTimer} className="px-4 py-2 bg-red-600 text-white rounded-lg text-sm font-medium hover:bg-red-700">Stop &amp; Save</button>
                )}
              </div>
            )}
          </div>

          {/* Rich text summary */}
          <div className="mb-3">
            <label className="text-xs text-gray-500 block mb-1">Summary</label>
            <div className="border rounded overflow-hidden">
              <MiniToolbar editor={editor} />
              <EditorContent editor={editor} />
            </div>
          </div>

          {/* Attachments */}
          <div className="flex items-center gap-3">
            <div className="flex-1">
              <label className="text-xs text-gray-500 block mb-1">Attachments</label>
              <div className="flex items-center gap-2">
                <input ref={fileInputRef} type="file" multiple onChange={e => handleAddFiles(e.target.files)}
                  className="text-sm text-gray-600 file:mr-2 file:py-1 file:px-3 file:rounded file:border-0 file:text-xs file:font-medium file:bg-gray-100 file:text-gray-700 hover:file:bg-gray-200" />
                {attachments.length > 0 && (
                  <div className="flex gap-1 flex-wrap">
                    {attachments.map((f, i) => (
                      <span key={i} className="text-xs bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded flex items-center gap-1">
                        {f.name}
                        <button type="button" onClick={() => removeAttachment(i)} className="text-indigo-400 hover:text-indigo-700">&times;</button>
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
            {mode === 'manual' && (
              <button onClick={handleManualEntry} className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 self-end">
                Add Entry
              </button>
            )}
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
                <div key={entry.id} className="px-4 py-3 flex items-start gap-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-gray-900">{entry.group_name} &gt; {entry.category_name}</span>
                      {statusBadge(entry.status)}
                    </div>
                    {entry.summary && (
                      <div className="text-sm text-gray-600 mt-0.5 prose prose-sm max-w-none" dangerouslySetInnerHTML={{ __html: entry.summary }} />
                    )}
                    {entry.rejection_note && <p className="text-xs text-red-600 mt-1">Rejection: {entry.rejection_note}</p>}
                    {entry.attachments.length > 0 && (
                      <div className="flex gap-2 mt-1">
                        {entry.attachments.map((a: any) => (
                          <button key={a.id} onClick={() => handleDownloadAttachment(a.id, a.file_name)}
                            className="text-xs bg-gray-100 px-2 py-0.5 rounded text-indigo-600 hover:text-indigo-800 hover:bg-gray-200 cursor-pointer">{a.file_name}</button>
                        ))}
                      </div>
                    )}
                  </div>
                  <span className="text-sm font-bold text-gray-900 w-20 text-right">{formatHoursMinutes(entry.hours)}</span>
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
