'use client';
import { useState, useEffect, useRef } from 'react';
import { pmsApi } from '@/lib/api';
import FilterBar, { FilterState, defaultFilters } from './FilterBar';
import TaskDrawer from './TaskDrawer';

const PRIORITY_COLORS: Record<string, string> = {
  low: 'text-gray-400', medium: 'text-yellow-500', high: 'text-orange-500', urgent: 'text-red-500',
};
const STAGE_BADGE: Record<string, string> = {
  development: 'bg-indigo-100 text-indigo-700', qa: 'bg-amber-100 text-amber-700',
  pm_review: 'bg-purple-100 text-purple-700', client_review: 'bg-cyan-100 text-cyan-700',
  approved: 'bg-green-100 text-green-700', completed: 'bg-gray-100 text-gray-600',
};

const PRIORITY_ORDER: Record<string, number> = { urgent: 0, high: 1, medium: 2, low: 3 };

function EffBadge({ value }: { value: number | null }) {
  if (value === null || value === undefined) return null;
  const c = value >= 80 ? 'bg-green-100 text-green-700' : value >= 50 ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700';
  return <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${c}`}>{value}%</span>;
}

export default function ListView({ projectId, tasks, milestones, members, onReload }: {
  projectId: number; tasks: any[]; milestones: any[]; members: any[]; onReload: () => void;
}) {
  const [filter, setFilter] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [drawerTaskId, setDrawerTaskId] = useState<number | null>(null);
  const [form, setForm] = useState({ title: '', description: '', priority: 'medium', milestone_id: '', assignee_id: '', due_date: '', estimated_hours: '' });
  const [createFiles, setCreateFiles] = useState<File[]>([]);
  const createFileRef = useRef<HTMLInputElement>(null);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [bulkAction, setBulkAction] = useState('');
  const [dragTaskId, setDragTaskId] = useState<number | null>(null);

  /* ── FilterBar state ───────────────────────────────────────────── */
  const [filters, setFilters] = useState<FilterState>(defaultFilters);
  const [sortBy, setSortBy] = useState<string>('');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [allLabels, setAllLabels] = useState<any[]>([]);

  useEffect(() => {
    pmsApi.listLabels().then(r => setAllLabels(r.data)).catch(() => {});
  }, []);

  /* ── Filtering ─────────────────────────────────────────────────── */
  const filtered = tasks.filter(t => {
    if (t.parent_task_id) return false;
    // Text search
    if (filter && !t.title?.toLowerCase().includes(filter.toLowerCase())) return false;
    // Assignee
    if (filters.assignees.length > 0 && !filters.assignees.includes(t.assignee_id)) return false;
    // Priority
    if (filters.priorities.length > 0 && !filters.priorities.includes(t.priority)) return false;
    // Stage
    if (filters.stages.length > 0 && !filters.stages.includes(t.stage)) return false;
    // Milestone
    if (filters.milestone_id && t.milestone_id !== filters.milestone_id) return false;
    // Due date range
    if (filters.due_from && t.due_date && t.due_date < filters.due_from) return false;
    if (filters.due_to && t.due_date && t.due_date > filters.due_to) return false;
    // Labels
    if (filters.labels.length > 0) {
      const taskLabelIds = (t.labels || []).map((l: any) => l.label_definition_id || l.id);
      if (!filters.labels.some(id => taskLabelIds.includes(id))) return false;
    }
    // Created date range
    if (filters.created_from && t.created_at) {
      const created = t.created_at.substring(0, 10);
      if (created < filters.created_from) return false;
    }
    if (filters.created_to && t.created_at) {
      const created = t.created_at.substring(0, 10);
      if (created > filters.created_to) return false;
    }
    return true;
  });

  /* ── Sorting ───────────────────────────────────────────────────── */
  const toggleSort = (col: string) => {
    if (sortBy === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortBy(col); setSortDir('asc'); }
  };

  const sorted = [...filtered].sort((a, b) => {
    if (!sortBy) return 0;
    let va: any, vb: any;
    switch (sortBy) {
      case 'priority': { va = PRIORITY_ORDER[a.priority] ?? 4; vb = PRIORITY_ORDER[b.priority] ?? 4; break; }
      case 'due_date': { va = a.due_date || '9999'; vb = b.due_date || '9999'; break; }
      case 'created_at': { va = a.created_at || ''; vb = b.created_at || ''; break; }
      case 'hours': { va = a.actual_hours || 0; vb = b.actual_hours || 0; break; }
      default: return 0;
    }
    if (va < vb) return sortDir === 'asc' ? -1 : 1;
    if (va > vb) return sortDir === 'asc' ? 1 : -1;
    return 0;
  });

  const sortIcon = (col: string) => sortBy === col ? (sortDir === 'asc' ? ' \u2191' : ' \u2193') : '';

  const handleCreate = async () => {
    const res = await pmsApi.createTask(projectId, {
      ...form,
      milestone_id: form.milestone_id ? Number(form.milestone_id) : null,
      assignee_id: form.assignee_id ? Number(form.assignee_id) : null,
      estimated_hours: form.estimated_hours ? Number(form.estimated_hours) : 0,
    });
    if (createFiles.length > 0) {
      const taskId = res.data.id;
      await Promise.all(createFiles.map(f => pmsApi.uploadAttachment(taskId, f)));
    }
    onReload();
    setShowCreate(false);
    setForm({ title: '', description: '', priority: 'medium', milestone_id: '', assignee_id: '', due_date: '', estimated_hours: '' });
    setCreateFiles([]);
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-200 bg-white flex-none">
        <input className="border rounded-lg px-3 py-1.5 text-sm w-56" placeholder="Search tasks..."
          value={filter} onChange={e => setFilter(e.target.value)} />
        <button onClick={() => setShowCreate(true)}
          className="ml-auto bg-indigo-600 text-white px-3 py-1.5 rounded-lg text-sm font-medium hover:bg-indigo-700">
          + Add Task
        </button>
      </div>

      {/* ── FilterBar ──────────────────────────────────────────────── */}
      <div className="px-4 pt-3 flex-none">
        <FilterBar
          members={members}
          milestones={milestones}
          labels={allLabels}
          filters={filters}
          onFilterChange={setFilters}
        />
      </div>

      <div className="flex-1 overflow-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wide sticky top-0">
            <tr>
              <th className="px-2 py-2 w-8">
                <input type="checkbox" className="rounded border-gray-300"
                  checked={selectedIds.size > 0 && selectedIds.size === sorted.length}
                  onChange={e => setSelectedIds(e.target.checked ? new Set(sorted.map((t: any) => t.id)) : new Set())} />
              </th>
              <th className="text-left px-4 py-2 font-semibold">Task</th>
              <th className="text-left px-4 py-2 font-semibold cursor-pointer hover:text-indigo-600 select-none" onClick={() => toggleSort('stage')}>
                Stage
              </th>
              <th className="text-left px-4 py-2 font-semibold cursor-pointer hover:text-indigo-600 select-none" onClick={() => toggleSort('priority')}>
                Priority{sortIcon('priority')}
              </th>
              <th className="text-left px-4 py-2 font-semibold">Assignee</th>
              <th className="text-left px-4 py-2 font-semibold cursor-pointer hover:text-indigo-600 select-none" onClick={() => toggleSort('due_date')}>
                Due{sortIcon('due_date')}
              </th>
              <th className="text-left px-4 py-2 font-semibold cursor-pointer hover:text-indigo-600 select-none" onClick={() => toggleSort('hours')}>
                Hours{sortIcon('hours')}
              </th>
              <th className="text-left px-4 py-2 font-semibold">Eff.</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {sorted.map(t => {
              const isOverdue = t.due_date && new Date(t.due_date) < new Date() && t.stage !== 'completed';
              const isDueSoon = !isOverdue && t.due_date && ((new Date(t.due_date).getTime() - new Date().getTime()) / 86400000) <= 2 && t.stage !== 'completed';
              return (
              <tr key={t.id}
                draggable
                onDragStart={() => setDragTaskId(t.id)}
                onDragOver={e => e.preventDefault()}
                onDrop={async () => {
                  if (dragTaskId && dragTaskId !== t.id) {
                    const dragIdx = sorted.findIndex((x: any) => x.id === dragTaskId);
                    const dropIdx = sorted.findIndex((x: any) => x.id === t.id);
                    if (dragIdx >= 0 && dropIdx >= 0) {
                      await pmsApi.updateTask(dragTaskId, { position: dropIdx });
                      onReload();
                    }
                  }
                  setDragTaskId(null);
                }}
                onDragEnd={() => setDragTaskId(null)}
                className={`hover:bg-gray-50 transition-colors cursor-grab active:cursor-grabbing ${selectedIds.has(t.id) ? 'bg-indigo-50' : ''} ${dragTaskId === t.id ? 'opacity-40' : ''}`}>
                <td className="px-2 py-2.5 w-8">
                  <input type="checkbox" className="rounded border-gray-300"
                    checked={selectedIds.has(t.id)}
                    onChange={e => {
                      const next = new Set(selectedIds);
                      e.target.checked ? next.add(t.id) : next.delete(t.id);
                      setSelectedIds(next);
                    }} />
                </td>
                <td className="px-4 py-2.5 font-medium text-gray-800">
                  <button onClick={() => setDrawerTaskId(t.id)} className="text-left hover:text-indigo-600 transition-colors">
                    {t.title}
                    {t.subtask_count > 0 && <span className="ml-1 text-xs text-gray-400 font-normal">+{t.subtask_count} sub</span>}
                  </button>
                  {t.labels?.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1">
                      {t.labels.map((l: any) => (
                        <span key={l.id} className="text-[10px] px-1.5 py-0.5 rounded-full font-medium text-white" style={{ background: l.color }}>{l.name}</span>
                      ))}
                    </div>
                  )}
                </td>
                <td className="px-4 py-2.5">
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STAGE_BADGE[t.stage] || 'bg-gray-100 text-gray-600'}`}>
                    {t.stage?.replace('_', ' ')}
                  </span>
                </td>
                <td className={`px-4 py-2.5 font-medium capitalize ${PRIORITY_COLORS[t.priority] || 'text-gray-600'}`}>{t.priority}</td>
                <td className="px-4 py-2.5 text-gray-500">{t.assignee_name || '\u2014'}</td>
                <td className={`px-4 py-2.5 ${isOverdue ? 'text-red-600 font-medium' : isDueSoon ? 'text-amber-600' : 'text-gray-500'}`}>
                  {t.due_date || '\u2014'}
                  {isOverdue && <span className="ml-1 text-[10px] px-1.5 py-0.5 rounded-full bg-red-100 text-red-700 font-medium">Overdue</span>}
                </td>
                <td className={`px-4 py-2.5 ${t.actual_hours > t.estimated_hours && t.estimated_hours > 0 ? 'text-red-500 font-medium' : 'text-gray-500'}`}>
                  {t.actual_hours}/{t.estimated_hours}h
                </td>
                <td className="px-4 py-2.5"><EffBadge value={t.efficiency} /></td>
              </tr>
              );
            })}
            {sorted.length === 0 && (
              <tr><td colSpan={7} className="text-center text-gray-400 py-12">No tasks found.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Bulk Action Bar */}
      {selectedIds.size > 0 && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 bg-indigo-600 text-white rounded-xl shadow-xl px-5 py-3 flex items-center gap-3 z-40">
          <span className="text-sm font-medium">{selectedIds.size} selected</span>
          <select value={bulkAction} onChange={e => setBulkAction(e.target.value)}
            className="text-sm bg-indigo-700 text-white rounded px-2 py-1 border border-indigo-500">
            <option value="">Choose action...</option>
            <option value="assign">Assign</option>
            <option value="move_stage">Move Stage</option>
            <option value="set_priority">Set Priority</option>
            <option value="set_milestone">Set Milestone</option>
            <option value="delete">Delete</option>
          </select>
          <button onClick={async () => {
            if (!bulkAction) return;
            let params: any = {};
            if (bulkAction === 'assign') { const id = prompt('Assignee user ID:'); if (!id) return; params = { assignee_id: Number(id) }; }
            else if (bulkAction === 'move_stage') { const s = prompt('Stage (development/qa/pm_review/client_review/approved/completed):'); if (!s) return; params = { to_stage: s }; }
            else if (bulkAction === 'set_priority') { const p = prompt('Priority (low/medium/high/urgent):'); if (!p) return; params = { priority: p }; }
            else if (bulkAction === 'set_milestone') { const m = prompt('Milestone ID:'); if (!m) return; params = { milestone_id: Number(m) }; }
            else if (bulkAction === 'delete') { if (!confirm('Delete selected tasks?')) return; }
            await pmsApi.bulkAction({ task_ids: Array.from(selectedIds), action: bulkAction, params });
            setSelectedIds(new Set());
            setBulkAction('');
            onReload();
          }} disabled={!bulkAction}
            className="text-sm bg-white text-indigo-700 px-3 py-1 rounded font-medium disabled:opacity-50">
            Apply
          </button>
          <button onClick={() => setSelectedIds(new Set())} className="text-sm text-indigo-200 hover:text-white">Cancel</button>
        </div>
      )}

      {showCreate && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 w-full max-w-lg shadow-2xl">
            <h2 className="text-lg font-semibold mb-4">New Task</h2>
            <div className="space-y-3">
              <input className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="Task title *"
                value={form.title} onChange={e => setForm({...form, title: e.target.value})} autoFocus />
              <textarea className="w-full border rounded-lg px-3 py-2 text-sm resize-none" placeholder="Description" rows={3}
                value={form.description} onChange={e => setForm({...form, description: e.target.value})} />
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-gray-500 block mb-1">Priority</label>
                  <select className="w-full border rounded-lg px-3 py-2 text-sm" value={form.priority}
                    onChange={e => setForm({...form, priority: e.target.value})}>
                    {['low', 'medium', 'high', 'urgent'].map(p => <option key={p} value={p}>{p}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-gray-500 block mb-1">Milestone</label>
                  <select className="w-full border rounded-lg px-3 py-2 text-sm" value={form.milestone_id}
                    onChange={e => setForm({...form, milestone_id: e.target.value})}>
                    <option value="">No milestone</option>
                    {milestones.map((m: any) => <option key={m.id} value={m.id}>{m.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-gray-500 block mb-1">Assignee</label>
                  <select className="w-full border rounded-lg px-3 py-2 text-sm" value={form.assignee_id}
                    onChange={e => setForm({...form, assignee_id: e.target.value})}>
                    <option value="">Unassigned</option>
                    {members.map((m: any) => <option key={m.user_id} value={m.user_id}>{m.user_name || `User ${m.user_id}`}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-gray-500 block mb-1">Due Date</label>
                  <input type="date" className="w-full border rounded-lg px-3 py-2 text-sm" value={form.due_date}
                    onChange={e => setForm({...form, due_date: e.target.value})} />
                </div>
                <div>
                  <label className="text-xs text-gray-500 block mb-1">Est. Hours</label>
                  <input type="number" step="0.5" className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="0"
                    value={form.estimated_hours} onChange={e => setForm({...form, estimated_hours: e.target.value})} />
                </div>
              </div>
              {/* References */}
              <div>
                <label className="text-xs text-gray-500 block mb-1">References (optional)</label>
                <div onClick={() => createFileRef.current?.click()}
                  className="border border-dashed border-gray-300 rounded-lg px-3 py-3 text-center cursor-pointer hover:border-indigo-400 hover:bg-indigo-50/30 transition-colors">
                  <p className="text-xs text-gray-400">Click to attach files</p>
                </div>
                <input ref={createFileRef} type="file" multiple className="hidden"
                  onChange={e => setCreateFiles(prev => [...prev, ...Array.from(e.target.files || [])])} />
                {createFiles.length > 0 && (
                  <ul className="mt-2 space-y-1">
                    {createFiles.map((f, i) => (
                      <li key={i} className="flex items-center justify-between text-xs bg-gray-50 rounded px-2 py-1">
                        <span className="truncate text-gray-700">{f.name}</span>
                        <button onClick={() => setCreateFiles(prev => prev.filter((_, j) => j !== i))}
                          className="ml-2 text-gray-400 hover:text-red-500 flex-none">✕</button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
            <div className="flex gap-3 mt-5">
              <button onClick={() => { setShowCreate(false); setCreateFiles([]); }} className="flex-1 border rounded-lg px-4 py-2 text-sm hover:bg-gray-50">Cancel</button>
              <button onClick={handleCreate} disabled={!form.title}
                className="flex-1 bg-indigo-600 text-white rounded-lg px-4 py-2 text-sm disabled:opacity-50 hover:bg-indigo-700">Create Task</button>
            </div>
          </div>
        </div>
      )}

      {drawerTaskId && (
        <TaskDrawer
          taskId={drawerTaskId}
          onClose={() => setDrawerTaskId(null)}
          onReload={onReload}
        />
      )}
    </div>
  );
}
