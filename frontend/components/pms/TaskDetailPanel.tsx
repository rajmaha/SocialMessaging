'use client';
import { useEffect, useState, useRef } from 'react';
import { pmsApi } from '@/lib/api';

const STAGE_COLORS: Record<string, string> = {
  development: '#6366f1', qa: '#f59e0b', pm_review: '#8b5cf6',
  client_review: '#06b6d4', approved: '#10b981', completed: '#6b7280',
};
const STAGES = ['development', 'qa', 'pm_review', 'client_review', 'approved', 'completed'];
const PRIORITIES = ['low', 'medium', 'high', 'urgent'];

interface Props {
  taskId: number;
  projectId: number;
  members: { user_id: number; user_name: string }[];
  onClose: () => void;
  onUpdated: () => void;
}

export default function TaskDetailPanel({ taskId, projectId, members, onClose, onUpdated }: Props) {
  const [task, setTask] = useState<any>(null);
  const [form, setForm] = useState<any>({});
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  const [comments, setComments] = useState<any[]>([]);
  const [newComment, setNewComment] = useState('');
  const [history, setHistory] = useState<any[]>([]);
  const [timelogs, setTimelogs] = useState<any[]>([]);
  const [logHours, setLogHours] = useState('');
  const [logNote, setLogNote] = useState('');
  const [attachments, setAttachments] = useState<any[]>([]);
  const [checklists, setChecklists] = useState<any[]>([]);
  const [newCheckItem, setNewCheckItem] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const [expandComments, setExpandComments] = useState(true);
  const [expandTime, setExpandTime] = useState(true);
  const [expandAttachments, setExpandAttachments] = useState(true);
  const [expandChecklist, setExpandChecklist] = useState(true);
  const [expandHistory, setExpandHistory] = useState(false);

  const loadTask = async () => {
    const r = await pmsApi.getTask(taskId);
    setTask(r.data);
    setForm({
      title: r.data.title || '',
      description: r.data.description || '',
      stage: r.data.stage || 'development',
      priority: r.data.priority || 'medium',
      assignee_id: r.data.assignee_id || '',
      start_date: r.data.start_date || '',
      due_date: r.data.due_date || '',
      estimated_hours: r.data.estimated_hours || '',
    });
    setDirty(false);
  };

  const loadAll = async () => {
    await loadTask();
    pmsApi.listComments(taskId).then(r => setComments(r.data)).catch(() => {});
    pmsApi.getTaskHistory(taskId).then(r => setHistory(r.data)).catch(() => {});
    pmsApi.listTimeLogs(taskId).then(r => setTimelogs(r.data)).catch(() => {});
    pmsApi.listAttachments(taskId).then(r => setAttachments(r.data)).catch(() => {});
    pmsApi.listChecklists(taskId).then(r => setChecklists(r.data)).catch(() => {});
  };

  useEffect(() => { loadAll(); }, [taskId]);

  const updateField = (field: string, value: any) => {
    setForm((prev: any) => ({ ...prev, [field]: value }));
    setDirty(true);
  };

  const handleSave = async () => {
    setSaving(true);
    await pmsApi.updateTask(taskId, {
      ...form,
      assignee_id: form.assignee_id ? Number(form.assignee_id) : null,
      estimated_hours: form.estimated_hours ? Number(form.estimated_hours) : 0,
    });
    setSaving(false);
    setDirty(false);
    onUpdated();
    loadTask();
  };

  const handleAddComment = async () => {
    if (!newComment.trim()) return;
    await pmsApi.createComment(taskId, { content: newComment });
    setNewComment('');
    const r = await pmsApi.listComments(taskId);
    setComments(r.data);
  };

  const handleLogTime = async () => {
    if (!logHours) return;
    await pmsApi.logTime(taskId, { hours: parseFloat(logHours), note: logNote || undefined });
    setLogHours('');
    setLogNote('');
    const r = await pmsApi.listTimeLogs(taskId);
    setTimelogs(r.data);
    onUpdated();
  };

  const handleUpload = async (files: FileList | null) => {
    if (!files) return;
    for (const file of Array.from(files)) {
      await pmsApi.uploadAttachment(taskId, file);
    }
    const r = await pmsApi.listAttachments(taskId);
    setAttachments(r.data);
    onUpdated();
  };

  const handleDeleteAttachment = async (id: number) => {
    await pmsApi.deleteAttachment(id);
    setAttachments(prev => prev.filter(a => a.id !== id));
  };

  const handleAddCheckItem = async () => {
    if (!newCheckItem.trim()) return;
    await pmsApi.createChecklist(taskId, { text: newCheckItem, position: checklists.length });
    setNewCheckItem('');
    const r = await pmsApi.listChecklists(taskId);
    setChecklists(r.data);
  };

  const handleToggleCheck = async (item: any) => {
    await pmsApi.updateChecklist(item.id, { is_checked: !item.is_checked });
    setChecklists(prev => prev.map(c => c.id === item.id ? { ...c, is_checked: !c.is_checked } : c));
  };

  const handleDeleteCheckItem = async (id: number) => {
    await pmsApi.deleteChecklist(id);
    setChecklists(prev => prev.filter(c => c.id !== id));
  };

  if (!task) return (
    <div className="fixed inset-y-0 right-0 w-[420px] bg-white shadow-2xl border-l border-gray-200 flex items-center justify-center z-40">
      <span className="text-gray-400 text-sm">Loading...</span>
    </div>
  );

  const checkedCount = checklists.filter(c => c.is_checked).length;

  return (
    <>
    <div className="fixed inset-0 bg-black/20 z-40" onClick={onClose} />
    <div className="fixed top-0 bottom-0 right-0 w-[420px] bg-white shadow-2xl border-l border-gray-200 flex flex-col z-50">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b bg-gray-50 flex-none">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <span className="w-2.5 h-2.5 rounded-full flex-none" style={{ background: STAGE_COLORS[task.stage] || '#6366f1' }} />
          <span className="font-semibold text-gray-900 truncate text-sm">{task.title}</span>
        </div>
        <button onClick={onClose} className="ml-2 w-8 h-8 flex items-center justify-center rounded-full hover:bg-red-100 text-gray-500 hover:text-red-600 text-xl font-bold flex-none transition-colors" title="Close">&times;</button>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto">
        {/* Editable fields */}
        <div className="p-4 space-y-3 border-b">
          <div>
            <label className="text-[11px] font-medium text-gray-400 uppercase tracking-wide">Title</label>
            <input className="w-full border rounded px-2.5 py-1.5 text-sm mt-0.5" value={form.title}
              onChange={e => updateField('title', e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[11px] font-medium text-gray-400 uppercase tracking-wide">Stage</label>
              <select className="w-full border rounded px-2.5 py-1.5 text-sm mt-0.5" value={form.stage}
                onChange={e => updateField('stage', e.target.value)}>
                {STAGES.map(s => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[11px] font-medium text-gray-400 uppercase tracking-wide">Priority</label>
              <select className="w-full border rounded px-2.5 py-1.5 text-sm mt-0.5" value={form.priority}
                onChange={e => updateField('priority', e.target.value)}>
                {PRIORITIES.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="text-[11px] font-medium text-gray-400 uppercase tracking-wide">Assignee</label>
            <select className="w-full border rounded px-2.5 py-1.5 text-sm mt-0.5" value={form.assignee_id}
              onChange={e => updateField('assignee_id', e.target.value)}>
              <option value="">Unassigned</option>
              {members.map(m => <option key={m.user_id} value={m.user_id}>{m.user_name}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[11px] font-medium text-gray-400 uppercase tracking-wide">Start Date</label>
              <input type="date" className="w-full border rounded px-2.5 py-1.5 text-sm mt-0.5" value={form.start_date}
                onChange={e => updateField('start_date', e.target.value)} />
            </div>
            <div>
              <label className="text-[11px] font-medium text-gray-400 uppercase tracking-wide">Due Date</label>
              <input type="date" className="w-full border rounded px-2.5 py-1.5 text-sm mt-0.5" value={form.due_date}
                onChange={e => updateField('due_date', e.target.value)} />
            </div>
          </div>
          <div>
            <label className="text-[11px] font-medium text-gray-400 uppercase tracking-wide">Est. Hours</label>
            <input type="number" step="0.5" className="w-full border rounded px-2.5 py-1.5 text-sm mt-0.5"
              value={form.estimated_hours} onChange={e => updateField('estimated_hours', e.target.value)} />
          </div>
          <div>
            <label className="text-[11px] font-medium text-gray-400 uppercase tracking-wide">Description</label>
            <textarea className="w-full border rounded px-2.5 py-1.5 text-sm mt-0.5 h-16 resize-none" value={form.description}
              onChange={e => updateField('description', e.target.value)} />
          </div>
          {dirty && (
            <button onClick={handleSave} disabled={saving}
              className="w-full bg-indigo-600 text-white rounded py-1.5 text-sm font-medium hover:bg-indigo-700 disabled:opacity-50">
              {saving ? 'Saving...' : 'Save Changes'}
            </button>
          )}
          {task.actual_hours > 0 && (
            <div className="text-xs text-gray-500">
              Logged: <span className={`font-medium ${task.actual_hours > task.estimated_hours && task.estimated_hours > 0 ? 'text-red-500' : 'text-gray-800'}`}>
                {task.actual_hours}h</span> / {task.estimated_hours || 0}h est.
            </div>
          )}
        </div>

        {/* Checklist */}
        <div className="border-b">
          <button onClick={() => setExpandChecklist(!expandChecklist)}
            className="w-full flex items-center justify-between px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide hover:bg-gray-50">
            <span>{expandChecklist ? '▾' : '▸'} Checklist {checklists.length > 0 ? `(${checkedCount}/${checklists.length})` : ''}</span>
          </button>
          {expandChecklist && (
            <div className="px-4 pb-3 space-y-1.5">
              {checklists.map(item => (
                <div key={item.id} className="flex items-center gap-2 group">
                  <input type="checkbox" checked={item.is_checked} onChange={() => handleToggleCheck(item)}
                    className="rounded border-gray-300 text-indigo-600" />
                  <span className={`text-sm flex-1 ${item.is_checked ? 'line-through text-gray-400' : 'text-gray-700'}`}>{item.text}</span>
                  <button onClick={() => handleDeleteCheckItem(item.id)}
                    className="text-gray-300 hover:text-red-500 text-xs opacity-0 group-hover:opacity-100">&times;</button>
                </div>
              ))}
              <div className="flex gap-1.5 mt-1">
                <input className="flex-1 border rounded px-2 py-1 text-sm" placeholder="Add item..."
                  value={newCheckItem} onChange={e => setNewCheckItem(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleAddCheckItem()} />
                <button onClick={handleAddCheckItem} className="text-indigo-600 text-sm font-medium px-2 hover:bg-indigo-50 rounded">+</button>
              </div>
            </div>
          )}
        </div>

        {/* Attachments */}
        <div className="border-b">
          <button onClick={() => setExpandAttachments(!expandAttachments)}
            className="w-full flex items-center justify-between px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide hover:bg-gray-50">
            <span>{expandAttachments ? '▾' : '▸'} Attachments ({attachments.length})</span>
          </button>
          {expandAttachments && (
            <div className="px-4 pb-3 space-y-1.5">
              {attachments.map(a => (
                <div key={a.id} className="flex items-center gap-2 text-sm group">
                  <span className="text-gray-400">📎</span>
                  <span className="flex-1 text-gray-700 truncate">{a.file_name}</span>
                  <span className="text-[10px] text-gray-400">{a.file_size ? `${Math.round(a.file_size / 1024)}KB` : ''}</span>
                  <button onClick={() => handleDeleteAttachment(a.id)}
                    className="text-gray-300 hover:text-red-500 text-xs opacity-0 group-hover:opacity-100">&times;</button>
                </div>
              ))}
              <input ref={fileRef} type="file" multiple className="hidden" onChange={e => handleUpload(e.target.files)} />
              <button onClick={() => fileRef.current?.click()}
                className="text-sm text-indigo-600 font-medium hover:bg-indigo-50 px-2 py-1 rounded">+ Upload</button>
            </div>
          )}
        </div>

        {/* Time Log */}
        <div className="border-b">
          <button onClick={() => setExpandTime(!expandTime)}
            className="w-full flex items-center justify-between px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide hover:bg-gray-50">
            <span>{expandTime ? '▾' : '▸'} Time Log ({timelogs.length})</span>
          </button>
          {expandTime && (
            <div className="px-4 pb-3 space-y-2">
              <div className="flex gap-1.5">
                <input type="number" step="0.5" className="w-16 border rounded px-2 py-1 text-sm" placeholder="Hrs"
                  value={logHours} onChange={e => setLogHours(e.target.value)} />
                <input className="flex-1 border rounded px-2 py-1 text-sm" placeholder="Note (optional)"
                  value={logNote} onChange={e => setLogNote(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleLogTime()} />
                <button onClick={handleLogTime}
                  className="bg-indigo-600 text-white px-2.5 py-1 rounded text-sm hover:bg-indigo-700">Log</button>
              </div>
              {timelogs.map(l => (
                <div key={l.id} className="flex justify-between items-center text-sm">
                  <span className="text-gray-600">{l.user_name} — <strong>{l.hours}h</strong>{l.note ? ` · ${l.note}` : ''}</span>
                  <span className="text-gray-400 text-[11px]">{l.log_date}</span>
                </div>
              ))}
              {timelogs.length === 0 && <p className="text-xs text-gray-400">No time logged.</p>}
            </div>
          )}
        </div>

        {/* Comments */}
        <div className="border-b">
          <button onClick={() => setExpandComments(!expandComments)}
            className="w-full flex items-center justify-between px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide hover:bg-gray-50">
            <span>{expandComments ? '▾' : '▸'} Comments ({comments.length})</span>
          </button>
          {expandComments && (
            <div className="px-4 pb-3 space-y-2">
              {comments.map(c => (
                <div key={c.id} className="bg-gray-50 rounded-lg p-2.5">
                  <div className="flex items-center justify-between mb-0.5">
                    <span className="text-xs font-medium text-gray-700">{c.user_name || 'User'}</span>
                    <span className="text-[10px] text-gray-400">{c.created_at ? new Date(c.created_at).toLocaleString() : ''}</span>
                  </div>
                  <div className="text-sm text-gray-600">{c.content}</div>
                </div>
              ))}
              {comments.length === 0 && <p className="text-xs text-gray-400">No comments yet.</p>}
              <div className="flex gap-1.5">
                <input className="flex-1 border rounded px-2 py-1.5 text-sm" placeholder="Add comment..."
                  value={newComment} onChange={e => setNewComment(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleAddComment()} />
                <button onClick={handleAddComment}
                  className="bg-indigo-600 text-white px-2.5 py-1.5 rounded text-sm hover:bg-indigo-700">Send</button>
              </div>
            </div>
          )}
        </div>

        {/* History */}
        <div>
          <button onClick={() => setExpandHistory(!expandHistory)}
            className="w-full flex items-center justify-between px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide hover:bg-gray-50">
            <span>{expandHistory ? '▾' : '▸'} History ({history.length})</span>
          </button>
          {expandHistory && (
            <div className="px-4 pb-3 space-y-1.5">
              {history.map(h => (
                <div key={h.id} className="text-xs text-gray-500 border-l-2 border-indigo-200 pl-2.5 py-1">
                  <span className="font-medium text-gray-700">{h.actor_name || 'System'}</span>
                  {' → '}
                  <span className="text-indigo-600 font-medium">{h.to_stage?.replace('_', ' ')}</span>
                  {h.from_stage && <span className="text-gray-400"> (from {h.from_stage?.replace('_', ' ')})</span>}
                  {h.note && <span className="block text-gray-400 italic mt-0.5">{h.note}</span>}
                  <span className="block text-gray-300">{new Date(h.created_at).toLocaleString()}</span>
                </div>
              ))}
              {history.length === 0 && <p className="text-xs text-gray-400">No history yet.</p>}
            </div>
          )}
        </div>
      </div>
    </div>
    </>
  );
}
