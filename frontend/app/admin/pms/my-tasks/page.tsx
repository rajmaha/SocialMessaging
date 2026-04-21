'use client';
import { useEffect, useRef, useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { pmsApi } from '@/lib/api';
import MainHeader from '@/components/MainHeader';
import AdminNav from '@/components/AdminNav';
import { authAPI } from '@/lib/auth';

const PRIORITY_COLORS: Record<string, string> = {
  low: 'bg-gray-100 text-gray-600',
  medium: 'bg-yellow-100 text-yellow-700',
  high: 'bg-orange-100 text-orange-700',
  urgent: 'bg-red-100 text-red-700',
};

const STAGE_BADGE: Record<string, string> = {
  development: 'bg-indigo-100 text-indigo-700',
  qa: 'bg-amber-100 text-amber-700',
  pm_review: 'bg-purple-100 text-purple-700',
  client_review: 'bg-cyan-100 text-cyan-700',
  approved: 'bg-green-100 text-green-700',
  completed: 'bg-gray-100 text-gray-600',
};

const STAGES = ['development', 'qa', 'pm_review', 'client_review', 'approved', 'completed'];
const PRIORITIES = ['low', 'medium', 'high', 'urgent'];

function EffBadge({ value }: { value: number | null }) {
  if (value === null) return <span className="text-xs text-gray-400">—</span>;
  const c = value >= 80 ? 'bg-green-100 text-green-700' : value >= 50 ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700';
  return <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${c}`}>{value}%</span>;
}

function avgEfficiency(tasks: any[]): number | null {
  const withEff = tasks.filter(t => t.efficiency !== null && t.efficiency !== undefined);
  if (withEff.length === 0) return null;
  return Math.round(withEff.reduce((sum, t) => sum + t.efficiency, 0) / withEff.length);
}

function isDueSoon(dateStr: string): boolean {
  if (!dateStr) return false;
  const due = new Date(dateStr);
  const now = new Date();
  const diffMs = due.getTime() - now.getTime();
  const diffDays = diffMs / (1000 * 60 * 60 * 24);
  return diffDays >= 0 && diffDays <= 2;
}

export default function MyTasksPage() {
  const router = useRouter();
  const user = authAPI.getUser();
  const [tasks, setTasks] = useState<any[]>([]);
  const [projects, setProjects] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // Filters
  const [stage, setStage] = useState('');
  const [priority, setPriority] = useState('');
  const [projectId, setProjectId] = useState('');
  const [dueFrom, setDueFrom] = useState('');
  const [dueTo, setDueTo] = useState('');

  // Create task modal
  const [showCreateTask, setShowCreateTask] = useState(false);
  const emptyTaskForm = { title: '', description: '', priority: 'medium', milestone_id: '', assignee_id: '', due_date: '', estimated_hours: '' };
  const [taskForm, setTaskForm] = useState(emptyTaskForm);
  const [createProjectId, setCreateProjectId] = useState('');
  const [createMembers, setCreateMembers] = useState<any[]>([]);
  const [createMilestones, setCreateMilestones] = useState<any[]>([]);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');
  const [createFiles, setCreateFiles] = useState<File[]>([]);
  const createFileRef = useRef<HTMLInputElement>(null);

  const handleProjectSelect = async (pid: string) => {
    setCreateProjectId(pid);
    setTaskForm(f => ({ ...f, assignee_id: '', milestone_id: '' }));
    if (!pid) { setCreateMembers([]); setCreateMilestones([]); return; }
    const [pRes, mRes] = await Promise.all([
      pmsApi.getProject(Number(pid)),
      pmsApi.listMilestones(Number(pid)),
    ]);
    setCreateMembers(pRes.data?.members || []);
    setCreateMilestones(mRes.data || []);
  };

  const handleCreateTask = async () => {
    if (!taskForm.title.trim() || !createProjectId) return;
    setCreating(true);
    setCreateError('');
    try {
      const res = await pmsApi.createTask(Number(createProjectId), {
        ...taskForm,
        milestone_id: taskForm.milestone_id ? Number(taskForm.milestone_id) : null,
        assignee_id: taskForm.assignee_id ? Number(taskForm.assignee_id) : null,
        estimated_hours: taskForm.estimated_hours ? Number(taskForm.estimated_hours) : 0,
      });
      if (createFiles.length > 0) {
        const taskId = res.data.id;
        await Promise.all(createFiles.map(f => pmsApi.uploadAttachment(taskId, f)));
      }
      fetchTasks();
      setShowCreateTask(false);
      setTaskForm(emptyTaskForm);
      setCreateProjectId('');
      setCreateMembers([]);
      setCreateMilestones([]);
      setCreateFiles([]);
    } catch (err: any) {
      setCreateError(err?.response?.data?.detail || 'Failed to create task. Please try again.');
    } finally {
      setCreating(false);
    }
  };

  // Grouping
  const [groupBy, setGroupBy] = useState<'flat' | 'project'>('flat');

  // Sorting
  const [sortBy, setSortBy] = useState<string>('due_date');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  const toggleSort = (col: string) => {
    if (sortBy === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortBy(col); setSortDir('asc'); }
  };

  const fetchTasks = () => {
    setLoading(true);
    const params: any = {};
    if (stage) params.stage = stage;
    if (priority) params.priority = priority;
    if (projectId) params.project_id = projectId;
    if (dueFrom) params.due_from = dueFrom;
    if (dueTo) params.due_to = dueTo;
    pmsApi.getMyTasks(params).then(r => {
      setTasks(r.data || []);
      setLoading(false);
    }).catch(() => setLoading(false));
  };

  useEffect(() => {
    pmsApi.listProjects().then(r => setProjects(r.data || []));
  }, []);

  useEffect(() => {
    fetchTasks();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage, priority, projectId, dueFrom, dueTo]);

  const sortedTasks = useMemo(() => {
    const sorted = [...tasks].sort((a, b) => {
      // Overdue tasks always come first
      if (a.is_overdue && !b.is_overdue) return -1;
      if (!a.is_overdue && b.is_overdue) return 1;

      let aVal: any, bVal: any;
      switch (sortBy) {
        case 'title': aVal = a.title?.toLowerCase() || ''; bVal = b.title?.toLowerCase() || ''; break;
        case 'project': aVal = a.project_name?.toLowerCase() || ''; bVal = b.project_name?.toLowerCase() || ''; break;
        case 'priority': {
          const order = { urgent: 0, high: 1, medium: 2, low: 3 };
          aVal = order[a.priority as keyof typeof order] ?? 4;
          bVal = order[b.priority as keyof typeof order] ?? 4;
          break;
        }
        case 'stage': aVal = STAGES.indexOf(a.stage) ?? 99; bVal = STAGES.indexOf(b.stage) ?? 99; break;
        case 'due_date': aVal = a.due_date || '9999'; bVal = b.due_date || '9999'; break;
        case 'hours': aVal = a.actual_hours || 0; bVal = b.actual_hours || 0; break;
        case 'efficiency': aVal = a.efficiency ?? -1; bVal = b.efficiency ?? -1; break;
        default: aVal = a.due_date || '9999'; bVal = b.due_date || '9999';
      }

      if (aVal < bVal) return sortDir === 'asc' ? -1 : 1;
      if (aVal > bVal) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });
    return sorted;
  }, [tasks, sortBy, sortDir]);

  const grouped = useMemo(() => {
    if (groupBy !== 'project') return null;
    const groups: Record<string, { project_name: string; project_color: string; tasks: any[] }> = {};
    for (const t of sortedTasks) {
      const key = t.project_id || 'unknown';
      if (!groups[key]) groups[key] = { project_name: t.project_name || 'Unknown', project_color: t.project_color || '#6366f1', tasks: [] };
      groups[key].tasks.push(t);
    }
    return Object.values(groups);
  }, [sortedTasks, groupBy]);

  const avgEff = avgEfficiency(tasks);

  if (!user) return null;

  const SortHeader = ({ col, label }: { col: string; label: string }) => (
    <th
      className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider cursor-pointer hover:text-gray-700 select-none"
      onClick={() => toggleSort(col)}
    >
      {label}
      {sortBy === col && <span className="ml-1">{sortDir === 'asc' ? '↑' : '↓'}</span>}
    </th>
  );

  const TaskRow = ({ t }: { t: any }) => (
    <tr key={t.id} className="hover:bg-gray-50 border-b border-gray-100">
      <td className="px-4 py-3">
        <button onClick={() => router.push(`/admin/pms/${t.project_id}`)} className="text-sm font-medium text-indigo-600 hover:underline text-left">
          {t.title}
        </button>
        {t.labels && t.labels.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1">
            {t.labels.map((l: any) => (
              <span key={l.id} className="text-[10px] px-1.5 py-0.5 rounded-full font-medium" style={{ background: l.color + '22', color: l.color }}>
                {l.name}
              </span>
            ))}
          </div>
        )}
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-2">
          <div className="w-2.5 h-2.5 rounded-full flex-none" style={{ background: t.project_color || '#6366f1' }} />
          <span className="text-sm text-gray-700">{t.project_name || '—'}</span>
        </div>
      </td>
      <td className="px-4 py-3">
        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${PRIORITY_COLORS[t.priority] || 'bg-gray-100 text-gray-600'}`}>
          {t.priority}
        </span>
      </td>
      <td className="px-4 py-3">
        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STAGE_BADGE[t.stage] || 'bg-gray-100 text-gray-600'}`}>
          {t.stage?.replace('_', ' ')}
        </span>
      </td>
      <td className="px-4 py-3">
        {t.due_date ? (
          <span className={`text-sm ${t.is_overdue ? 'text-red-600 font-semibold' : isDueSoon(t.due_date) ? 'text-amber-600 font-medium' : 'text-gray-700'}`}>
            {t.due_date}
            {t.is_overdue && <span className="ml-1 text-xs">(Overdue)</span>}
          </span>
        ) : (
          <span className="text-sm text-gray-400">—</span>
        )}
      </td>
      <td className="px-4 py-3">
        <span className={`text-sm ${(t.actual_hours || 0) > (t.estimated_hours || 0) && t.estimated_hours ? 'text-red-600 font-medium' : 'text-gray-700'}`}>
          {t.actual_hours ?? 0}h / {t.estimated_hours ?? 0}h
        </span>
      </td>
      <td className="px-4 py-3">
        <EffBadge value={t.efficiency} />
      </td>
    </tr>
  );

  const TableHead = () => (
    <thead className="bg-gray-50 border-b border-gray-200">
      <tr>
        <SortHeader col="title" label="Task" />
        <SortHeader col="project" label="Project" />
        <SortHeader col="priority" label="Priority" />
        <SortHeader col="stage" label="Stage" />
        <SortHeader col="due_date" label="Due Date" />
        <SortHeader col="hours" label="Hours" />
        <SortHeader col="efficiency" label="Efficiency" />
      </tr>
    </thead>
  );

  return (
    <div className="ml-0 md:ml-60 pt-14 min-h-screen bg-gray-50 pb-16 md:pb-0">
      <MainHeader user={user} />
      <AdminNav />
      <div className="p-6">
        {/* Header */}
        <div className="flex items-center gap-4 mb-6">
          <h1 className="text-2xl font-bold text-gray-900">My Tasks</h1>
          {avgEff !== null && <EffBadge value={avgEff} />}
          <div className="ml-auto flex items-center gap-2">
            <button onClick={() => setShowCreateTask(true)}
              className="bg-indigo-600 text-white px-3 py-1.5 rounded-lg text-sm font-medium hover:bg-indigo-700">
              + Create Task
            </button>
            <button onClick={() => window.open(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'}/api/pms/my-tasks/export?format=csv`, '_blank')}
              className="text-sm border border-gray-300 rounded-lg px-3 py-1.5 hover:bg-gray-50 text-gray-600">
              Export CSV
            </button>
          </div>
        </div>

        {/* Create Task Modal */}
        {showCreateTask && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className="bg-white rounded-xl p-6 w-[480px] shadow-xl max-h-[90vh] overflow-y-auto">
              <h3 className="font-semibold text-gray-900 mb-4">New Task</h3>
              <div className="space-y-3">
                <select className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white"
                  value={createProjectId} onChange={e => handleProjectSelect(e.target.value)}>
                  <option value="">Select project *</option>
                  {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
                <input className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  placeholder="Task title *" value={taskForm.title} onChange={e => setTaskForm({ ...taskForm, title: e.target.value })} />
                <textarea className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
                  placeholder="Description" rows={3}
                  value={taskForm.description} onChange={e => setTaskForm({ ...taskForm, description: e.target.value })} />
                <select className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white"
                  value={taskForm.priority} onChange={e => setTaskForm({ ...taskForm, priority: e.target.value })}>
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                  <option value="urgent">Urgent</option>
                </select>
                <select className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white"
                  value={taskForm.milestone_id} onChange={e => setTaskForm({ ...taskForm, milestone_id: e.target.value })}>
                  <option value="">No milestone</option>
                  {createMilestones.map((m: any) => <option key={m.id} value={m.id}>{m.name}</option>)}
                </select>
                <select className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white"
                  value={taskForm.assignee_id} onChange={e => setTaskForm({ ...taskForm, assignee_id: e.target.value })}>
                  <option value="">Unassigned</option>
                  {createMembers.map((m: any) => <option key={m.id} value={m.id}>{m.full_name || m.email}</option>)}
                </select>
                <input type="date" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  value={taskForm.due_date} onChange={e => setTaskForm({ ...taskForm, due_date: e.target.value })} />
                <input type="number" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  placeholder="Estimated hours" min="0" step="0.5"
                  value={taskForm.estimated_hours} onChange={e => setTaskForm({ ...taskForm, estimated_hours: e.target.value })} />
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
              {createError && <p className="mt-3 text-sm text-red-600">{createError}</p>}
              <div className="flex gap-3 mt-5">
                <button onClick={() => { setShowCreateTask(false); setTaskForm(emptyTaskForm); setCreateProjectId(''); setCreateMembers([]); setCreateMilestones([]); setCreateFiles([]); setCreateError(''); }}
                  className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-600 hover:bg-gray-50">Cancel</button>
                <button onClick={handleCreateTask} disabled={!taskForm.title.trim() || !createProjectId || creating}
                  className="flex-1 bg-indigo-600 text-white rounded-lg px-3 py-2 text-sm font-medium hover:bg-indigo-700 disabled:opacity-50">
                  {creating ? 'Creating…' : 'Create Task'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Filter bar */}
        <div className="flex flex-wrap items-center gap-3 mb-4">
          <select value={stage} onChange={e => setStage(e.target.value)} className="text-sm border border-gray-300 rounded-lg px-3 py-1.5 bg-white">
            <option value="">All Stages</option>
            {STAGES.map(s => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
          </select>
          <select value={priority} onChange={e => setPriority(e.target.value)} className="text-sm border border-gray-300 rounded-lg px-3 py-1.5 bg-white">
            <option value="">All Priorities</option>
            {PRIORITIES.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
          <select value={projectId} onChange={e => setProjectId(e.target.value)} className="text-sm border border-gray-300 rounded-lg px-3 py-1.5 bg-white">
            <option value="">All Projects</option>
            {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <input type="date" value={dueFrom} onChange={e => setDueFrom(e.target.value)} className="text-sm border border-gray-300 rounded-lg px-3 py-1.5 bg-white" title="Due From" />
          <input type="date" value={dueTo} onChange={e => setDueTo(e.target.value)} className="text-sm border border-gray-300 rounded-lg px-3 py-1.5 bg-white" title="Due To" />
        </div>

        {/* Grouping toggle */}
        <div className="flex items-center gap-1 mb-4">
          <button
            onClick={() => setGroupBy('flat')}
            className={`text-xs px-3 py-1.5 rounded-l-lg font-medium border ${groupBy === 'flat' ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'}`}
          >
            Flat
          </button>
          <button
            onClick={() => setGroupBy('project')}
            className={`text-xs px-3 py-1.5 rounded-r-lg font-medium border ${groupBy === 'project' ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'}`}
          >
            By Project
          </button>
        </div>

        {/* Table */}
        {loading ? (
          <div className="text-gray-400 text-center py-20">Loading...</div>
        ) : tasks.length === 0 ? (
          <div className="text-gray-400 text-center py-20">No tasks assigned to you.</div>
        ) : groupBy === 'flat' ? (
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="overflow-x-auto"><table className="w-full">
              <TableHead />
              <tbody>
                {sortedTasks.map(t => <TaskRow key={t.id} t={t} />)}
              </tbody>
            </table></div>
          </div>
        ) : (
          <div className="space-y-6">
            {grouped?.map((g, idx) => (
              <div key={idx}>
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-3 h-3 rounded-full" style={{ background: g.project_color }} />
                  <h2 className="font-semibold text-gray-800">{g.project_name}</h2>
                  <span className="text-xs text-gray-400">({g.tasks.length})</span>
                </div>
                <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                  <div className="overflow-x-auto"><table className="w-full">
                    <TableHead />
                    <tbody>
                      {g.tasks.map(t => <TaskRow key={t.id} t={t} />)}
                    </tbody>
                  </table></div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
