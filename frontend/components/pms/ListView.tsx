'use client';
import { useState } from 'react';
import { pmsApi } from '@/lib/api';

const PRIORITY_COLORS: Record<string, string> = {
  low: 'text-gray-400', medium: 'text-yellow-500', high: 'text-orange-500', urgent: 'text-red-500',
};
const STAGE_BADGE: Record<string, string> = {
  development: 'bg-indigo-100 text-indigo-700', qa: 'bg-amber-100 text-amber-700',
  pm_review: 'bg-purple-100 text-purple-700', client_review: 'bg-cyan-100 text-cyan-700',
  approved: 'bg-green-100 text-green-700', completed: 'bg-gray-100 text-gray-600',
};

export default function ListView({ projectId, tasks, milestones, members, onReload }: {
  projectId: number; tasks: any[]; milestones: any[]; members: any[]; onReload: () => void;
}) {
  const [filter, setFilter] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ title: '', priority: 'medium', milestone_id: '', assignee_id: '', due_date: '', estimated_hours: '' });

  const filtered = tasks.filter(t => !t.parent_task_id && t.title?.toLowerCase().includes(filter.toLowerCase()));

  const handleCreate = async () => {
    await pmsApi.createTask(projectId, {
      ...form,
      milestone_id: form.milestone_id ? Number(form.milestone_id) : null,
      assignee_id: form.assignee_id ? Number(form.assignee_id) : null,
      estimated_hours: form.estimated_hours ? Number(form.estimated_hours) : 0,
    });
    onReload();
    setShowCreate(false);
    setForm({ title: '', priority: 'medium', milestone_id: '', assignee_id: '', due_date: '', estimated_hours: '' });
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
      <div className="flex-1 overflow-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wide sticky top-0">
            <tr>
              <th className="text-left px-4 py-2 font-semibold">Task</th>
              <th className="text-left px-4 py-2 font-semibold">Stage</th>
              <th className="text-left px-4 py-2 font-semibold">Priority</th>
              <th className="text-left px-4 py-2 font-semibold">Assignee</th>
              <th className="text-left px-4 py-2 font-semibold">Due</th>
              <th className="text-left px-4 py-2 font-semibold">Hours</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {filtered.map(t => (
              <tr key={t.id} className="hover:bg-gray-50 transition-colors">
                <td className="px-4 py-2.5 font-medium text-gray-800">
                  {t.title}
                  {t.subtask_count > 0 && <span className="ml-1 text-xs text-gray-400 font-normal">+{t.subtask_count} sub</span>}
                </td>
                <td className="px-4 py-2.5">
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STAGE_BADGE[t.stage] || 'bg-gray-100 text-gray-600'}`}>
                    {t.stage?.replace('_', ' ')}
                  </span>
                </td>
                <td className={`px-4 py-2.5 font-medium capitalize ${PRIORITY_COLORS[t.priority] || 'text-gray-600'}`}>{t.priority}</td>
                <td className="px-4 py-2.5 text-gray-500">{t.assignee_name || '—'}</td>
                <td className="px-4 py-2.5 text-gray-500">{t.due_date || '—'}</td>
                <td className={`px-4 py-2.5 ${t.actual_hours > t.estimated_hours && t.estimated_hours > 0 ? 'text-red-500 font-medium' : 'text-gray-500'}`}>
                  {t.actual_hours}/{t.estimated_hours}h
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr><td colSpan={6} className="text-center text-gray-400 py-12">No tasks found.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {showCreate && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 w-full max-w-lg shadow-2xl">
            <h2 className="text-lg font-semibold mb-4">New Task</h2>
            <div className="space-y-3">
              <input className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="Task title *"
                value={form.title} onChange={e => setForm({...form, title: e.target.value})} />
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
            </div>
            <div className="flex gap-3 mt-5">
              <button onClick={() => setShowCreate(false)} className="flex-1 border rounded-lg px-4 py-2 text-sm hover:bg-gray-50">Cancel</button>
              <button onClick={handleCreate} disabled={!form.title}
                className="flex-1 bg-indigo-600 text-white rounded-lg px-4 py-2 text-sm disabled:opacity-50 hover:bg-indigo-700">Create Task</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
