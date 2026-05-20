'use client';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { pmsApi } from '@/lib/api';
import { authAPI } from '@/lib/auth';
import MainHeader from '@/components/MainHeader';
import AdminNav from '@/components/AdminNav';
import GanttChart from '@/components/pms/GanttChart';
import BoardView from '@/components/pms/BoardView';
import ListView from '@/components/pms/ListView';

const TABS = ['Overview', 'Gantt', 'Board', 'List', 'Milestones', 'Sprints', 'Settings'];

export default function ProjectDetailPage() {
  const { id } = useParams();
  const projectId = Number(id);
  const user = authAPI.getUser();
  const [project, setProject] = useState<any>(null);
  const [tasks, setTasks] = useState<any[]>([]);
  const [milestones, setMilestones] = useState<any[]>([]);
  const [activeTab, setActiveTab] = useState('Overview');
  const [loading, setLoading] = useState(true);

  const reload = async () => {
    const [pRes, tRes, mRes] = await Promise.all([
      pmsApi.getProject(projectId),
      pmsApi.listTasks(projectId),
      pmsApi.listMilestones(projectId),
    ]);
    setProject(pRes.data);
    setTasks(tRes.data);
    setMilestones(mRes.data);
    setLoading(false);
  };

  useEffect(() => { reload(); }, [projectId]);

  if (!user) return null;
  if (loading) return (
    <div className="ml-60 pt-14 min-h-screen bg-gray-50">
      <MainHeader user={user} />
      <AdminNav />
      <div className="flex items-center justify-center h-64 text-gray-400">Loading...</div>
    </div>
  );

  return (
    <div className="ml-60 pt-14 min-h-screen bg-gray-50 flex flex-col">
      <MainHeader user={user} />
      <AdminNav />
      {/* Project header */}
      <div className="px-6 py-4 border-b border-gray-200 bg-white flex items-center gap-4">
        <div className="w-3 h-3 rounded-full flex-none" style={{ background: project?.color }} />
        <h1 className="text-lg font-semibold text-gray-900">{project?.name}</h1>
        <span className="text-xs text-gray-400 capitalize">{project?.status?.replace('_', ' ')}</span>
      </div>
      {/* Tabs */}
      <div className="border-b border-gray-200 bg-white px-6">
        <div className="flex gap-1">
          {TABS.map(tab => (
            <button key={tab} onClick={() => setActiveTab(tab)}
              className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                activeTab === tab ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}>
              {tab}
            </button>
          ))}
        </div>
      </div>
      {/* Tab content — Gantt gets fixed height, others scroll naturally */}
      <div className={activeTab === 'Gantt' || activeTab === 'Board' ? 'flex-1 overflow-hidden' : 'flex-1'}>
        {activeTab === 'Overview' && <OverviewTab projectId={projectId} tasks={tasks} milestones={milestones} members={project?.members || []} />}
        {activeTab === 'Gantt' && (
          <div className="h-full" style={{ height: 'calc(100vh - 14rem)' }}>
            <GanttChart projectId={projectId} tasks={tasks} milestones={milestones} members={project?.members || []} />
          </div>
        )}
        {activeTab === 'Board' && (
          <div style={{ height: 'calc(100vh - 14rem)' }}>
            <BoardView projectId={projectId} tasks={tasks} members={project?.members || []} milestones={milestones} onReload={reload} />
          </div>
        )}
        {activeTab === 'List' && <ListView projectId={projectId} tasks={tasks} milestones={milestones} members={project?.members || []} onReload={reload} />}
        {activeTab === 'Milestones' && <MilestonesTab projectId={projectId} milestones={milestones} tasks={tasks} onReload={reload} />}
        {activeTab === 'Sprints' && <SprintsTab projectId={projectId} tasks={tasks} members={project?.members || []} onReload={reload} />}
        {activeTab === 'Settings' && <SettingsTab project={project} onReload={reload} />}
      </div>
    </div>
  );
}

const STAGE_LABELS: Record<string, string> = {
  development: 'Development', qa: 'QA', pm_review: 'PM Review',
  client_review: 'Client Review', approved: 'Approved', completed: 'Completed',
};
const STAGE_COLORS: Record<string, string> = {
  development: 'bg-indigo-500', qa: 'bg-amber-500', pm_review: 'bg-purple-500',
  client_review: 'bg-cyan-500', approved: 'bg-green-500', completed: 'bg-gray-400',
};
const PRIORITY_COLORS: Record<string, string> = {
  urgent: 'bg-red-500', high: 'bg-orange-500', medium: 'bg-yellow-500', low: 'bg-gray-400',
};

function OverviewTab({ projectId, tasks, milestones, members }: { projectId: number; tasks: any[]; milestones: any[]; members: any[] }) {
  const [sprints, setSprints] = useState<any[]>([]);
  useEffect(() => { pmsApi.listSprints(projectId).then(r => setSprints(r.data)).catch(() => {}); }, [projectId]);

  const parentTasks = tasks.filter(t => !t.parent_task_id);
  const total = parentTasks.length;
  const completed = parentTasks.filter(t => t.stage === 'completed').length;
  const overdue = parentTasks.filter(t => t.due_date && new Date(t.due_date) < new Date() && t.stage !== 'completed');
  const completionPct = total > 0 ? Math.round((completed / total) * 100) : 0;

  const stageCounts: Record<string, number> = {};
  parentTasks.forEach(t => { stageCounts[t.stage] = (stageCounts[t.stage] || 0) + 1; });

  const priorityCounts: Record<string, number> = {};
  parentTasks.forEach(t => { priorityCounts[t.priority] = (priorityCounts[t.priority] || 0) + 1; });

  const totalHoursEst = parentTasks.reduce((s, t) => s + (t.estimated_hours || 0), 0);
  const totalHoursActual = parentTasks.reduce((s, t) => s + (t.actual_hours || 0), 0);

  const memberStats = members.map((m: any) => {
    const memberTasks = parentTasks.filter(t => t.assignee_id === m.user_id);
    const memberCompleted = memberTasks.filter(t => t.stage === 'completed').length;
    const memberOverdue = memberTasks.filter(t => t.due_date && new Date(t.due_date) < new Date() && t.stage !== 'completed').length;
    return { ...m, taskCount: memberTasks.length, completed: memberCompleted, overdue: memberOverdue };
  });

  const unassigned = parentTasks.filter(t => !t.assignee_id).length;
  const activeSprint = sprints.find(s => s.status === 'active');

  const upcomingMilestones = milestones
    .filter((m: any) => m.status === 'pending' && m.due_date)
    .sort((a: any, b: any) => a.due_date.localeCompare(b.due_date))
    .slice(0, 5);

  return (
    <div className="p-6 space-y-6 max-w-6xl">
      {/* Top stats row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-white rounded-xl border p-4">
          <div className="text-xs text-gray-400 font-medium uppercase">Total Tasks</div>
          <div className="text-2xl font-bold text-gray-900 mt-1">{total}</div>
          <div className="text-xs text-gray-400 mt-1">{unassigned > 0 ? `${unassigned} unassigned` : 'All assigned'}</div>
        </div>
        <div className="bg-white rounded-xl border p-4">
          <div className="text-xs text-gray-400 font-medium uppercase">Completion</div>
          <div className="text-2xl font-bold text-gray-900 mt-1">{completionPct}%</div>
          <div className="w-full bg-gray-100 rounded-full h-2 mt-2">
            <div className="bg-green-500 h-2 rounded-full transition-all" style={{ width: `${completionPct}%` }} />
          </div>
          <div className="text-xs text-gray-400 mt-1">{completed} of {total} done</div>
        </div>
        <div className="bg-white rounded-xl border p-4">
          <div className="text-xs text-gray-400 font-medium uppercase">Overdue</div>
          <div className={`text-2xl font-bold mt-1 ${overdue.length > 0 ? 'text-red-600' : 'text-green-600'}`}>{overdue.length}</div>
          <div className="text-xs text-gray-400 mt-1">{overdue.length > 0 ? 'Need attention' : 'On track'}</div>
        </div>
        <div className="bg-white rounded-xl border p-4">
          <div className="text-xs text-gray-400 font-medium uppercase">Hours</div>
          <div className="text-2xl font-bold text-gray-900 mt-1">{totalHoursActual}<span className="text-sm text-gray-400 font-normal">/{totalHoursEst}h</span></div>
          <div className="text-xs text-gray-400 mt-1">
            {totalHoursEst > 0 ? `${Math.round((totalHoursActual / totalHoursEst) * 100)}% of estimate used` : 'No estimates'}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Tasks by stage */}
        <div className="bg-white rounded-xl border p-5">
          <h3 className="text-sm font-semibold text-gray-700 mb-3">Tasks by Stage</h3>
          <div className="space-y-2">
            {['development', 'qa', 'pm_review', 'client_review', 'approved', 'completed'].map(stage => {
              const count = stageCounts[stage] || 0;
              const pct = total > 0 ? Math.round((count / total) * 100) : 0;
              return (
                <div key={stage} className="flex items-center gap-3">
                  <span className="text-xs text-gray-500 w-24 truncate">{STAGE_LABELS[stage]}</span>
                  <div className="flex-1 bg-gray-100 rounded-full h-2.5">
                    <div className={`${STAGE_COLORS[stage]} h-2.5 rounded-full transition-all`} style={{ width: `${pct}%` }} />
                  </div>
                  <span className="text-xs text-gray-500 w-12 text-right">{count} ({pct}%)</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Tasks by priority */}
        <div className="bg-white rounded-xl border p-5">
          <h3 className="text-sm font-semibold text-gray-700 mb-3">Tasks by Priority</h3>
          <div className="space-y-2">
            {['urgent', 'high', 'medium', 'low'].map(priority => {
              const count = priorityCounts[priority] || 0;
              const pct = total > 0 ? Math.round((count / total) * 100) : 0;
              return (
                <div key={priority} className="flex items-center gap-3">
                  <span className="text-xs text-gray-500 w-24 capitalize">{priority}</span>
                  <div className="flex-1 bg-gray-100 rounded-full h-2.5">
                    <div className={`${PRIORITY_COLORS[priority]} h-2.5 rounded-full transition-all`} style={{ width: `${pct}%` }} />
                  </div>
                  <span className="text-xs text-gray-500 w-12 text-right">{count} ({pct}%)</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Active Sprint */}
        <div className="bg-white rounded-xl border p-5">
          <h3 className="text-sm font-semibold text-gray-700 mb-3">Active Sprint</h3>
          {activeSprint ? (
            <div>
              <div className="flex items-center gap-2 mb-2">
                <span className="font-medium text-gray-900">{activeSprint.name}</span>
                <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full">Active</span>
              </div>
              {activeSprint.goal && <p className="text-xs text-gray-400 mb-2">{activeSprint.goal}</p>}
              <div className="text-xs text-gray-400 mb-2">{activeSprint.start_date || '?'} &rarr; {activeSprint.end_date || '?'}</div>
              <div className="flex items-center gap-3">
                <div className="flex-1">
                  <div className="w-full bg-gray-100 rounded-full h-2">
                    <div className="bg-green-500 h-2 rounded-full transition-all" style={{ width: `${activeSprint.task_count > 0 ? Math.round((activeSprint.completed_count / activeSprint.task_count) * 100) : 0}%` }} />
                  </div>
                </div>
                <span className="text-xs text-gray-500">{activeSprint.completed_count}/{activeSprint.task_count} tasks</span>
              </div>
              <div className="text-xs text-gray-400 mt-1">{activeSprint.total_actual_hours || 0}/{activeSprint.total_estimated_hours || 0}h logged</div>
            </div>
          ) : (
            <p className="text-sm text-gray-400">No active sprint. Start one from the Sprints tab.</p>
          )}
        </div>

        {/* Upcoming Milestones */}
        <div className="bg-white rounded-xl border p-5">
          <h3 className="text-sm font-semibold text-gray-700 mb-3">Upcoming Milestones</h3>
          {upcomingMilestones.length > 0 ? (
            <div className="space-y-2">
              {upcomingMilestones.map((m: any) => {
                const taskCount = m.task_count ?? 0;
                const completedCount = m.completed_count ?? 0;
                const pct = taskCount > 0 ? Math.round((completedCount / taskCount) * 100) : 0;
                const isOverdue = m.due_date && new Date(m.due_date) < new Date();
                return (
                  <div key={m.id} className="flex items-center gap-3">
                    <div className="w-2.5 h-2.5 rounded-full flex-none" style={{ background: m.color }} />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-gray-800 truncate">{m.name}</div>
                      <div className="text-xs text-gray-400">{completedCount}/{taskCount} tasks · {pct}%</div>
                    </div>
                    <span className={`text-xs flex-none ${isOverdue ? 'text-red-600 font-medium' : 'text-gray-400'}`}>
                      {isOverdue ? 'Overdue' : ''} {m.due_date}
                    </span>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-sm text-gray-400">No upcoming milestones.</p>
          )}
        </div>
      </div>

      {/* Team workload */}
      <div className="bg-white rounded-xl border p-5">
        <h3 className="text-sm font-semibold text-gray-700 mb-3">Team Workload</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {memberStats.map((m: any) => (
            <div key={m.id} className="border rounded-lg p-3 flex items-center gap-3">
              <div className="w-9 h-9 rounded-full bg-indigo-100 text-indigo-700 flex items-center justify-center text-sm font-semibold flex-none">
                {(m.user_name || 'U').charAt(0).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-gray-800 truncate">{m.user_name || `User #${m.user_id}`}</div>
                <div className="text-xs text-gray-400">
                  {m.taskCount} tasks · {m.completed} done
                  {m.overdue > 0 && <span className="text-red-500 ml-1">· {m.overdue} overdue</span>}
                </div>
              </div>
              <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded capitalize flex-none">{m.role}</span>
            </div>
          ))}
          {memberStats.length === 0 && <p className="text-sm text-gray-400 col-span-full">No team members.</p>}
        </div>
      </div>

      {/* Overdue tasks list */}
      {overdue.length > 0 && (
        <div className="bg-white rounded-xl border p-5">
          <h3 className="text-sm font-semibold text-red-600 mb-3">Overdue Tasks ({overdue.length})</h3>
          <div className="space-y-1">
            {overdue.slice(0, 10).map((t: any) => {
              const days = Math.ceil((new Date().getTime() - new Date(t.due_date).getTime()) / (1000 * 60 * 60 * 24));
              return (
                <div key={t.id} className="flex items-center gap-3 px-3 py-2 rounded hover:bg-red-50 text-sm">
                  <span className={`w-2 h-2 rounded-full flex-none ${PRIORITY_COLORS[t.priority] || 'bg-gray-400'}`} />
                  <span className="flex-1 text-gray-800 truncate">{t.title}</span>
                  <span className="text-xs text-gray-400">{t.assignee_name || 'Unassigned'}</span>
                  <span className="text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded-full">{days}d overdue</span>
                </div>
              );
            })}
            {overdue.length > 10 && <p className="text-xs text-gray-400 px-3">+{overdue.length - 10} more</p>}
          </div>
        </div>
      )}
    </div>
  );
}

function MilestonesTab({ projectId, milestones, tasks, onReload }: any) {
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ name: '', description: '', due_date: '', color: '#f59e0b' });
  const [editId, setEditId] = useState<number | null>(null);

  const handleCreate = async () => {
    await pmsApi.createMilestone(projectId, form);
    onReload();
    setShowCreate(false);
    setForm({ name: '', description: '', due_date: '', color: '#f59e0b' });
  };

  const handleStatusToggle = async (ms: any) => {
    const next = ms.status === 'pending' ? 'reached' : ms.status === 'reached' ? 'missed' : 'pending';
    await pmsApi.updateMilestone(ms.id, { status: next });
    onReload();
  };

  const handleDelete = async (id: number) => {
    await pmsApi.deleteMilestone(id);
    onReload();
  };

  return (
    <div className="p-6 max-w-3xl">
      <div className="flex justify-between items-center mb-4">
        <h2 className="font-semibold text-gray-800">Milestones</h2>
        <button onClick={() => setShowCreate(true)} className="bg-indigo-600 text-white px-3 py-1.5 rounded-lg text-sm">+ New Milestone</button>
      </div>
      <div className="space-y-3">
        {milestones.map((m: any) => {
          const taskCount = m.task_count ?? 0;
          const completedCount = m.completed_count ?? 0;
          const progress = taskCount > 0 ? Math.round((completedCount / taskCount) * 100) : 0;
          const isOverdue = m.due_date && new Date(m.due_date) < new Date() && m.status === 'pending';
          return (
            <div key={m.id} className="bg-white border rounded-lg p-4">
              <div className="flex items-center gap-3">
                <div className="w-3 h-3 rounded-full flex-none" style={{ background: m.color }} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-gray-800">{m.name}</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                      m.status === 'reached' ? 'bg-green-100 text-green-700' :
                      m.status === 'missed' ? 'bg-red-100 text-red-700' :
                      isOverdue ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-600'
                    }`}>{isOverdue ? 'Overdue' : m.status}</span>
                  </div>
                  {m.description && <p className="text-xs text-gray-400 mt-0.5">{m.description}</p>}
                </div>
                <div className="text-right flex-none">
                  <div className="text-xs text-gray-400">{m.due_date ? `Due: ${m.due_date}` : 'No due date'}</div>
                  <div className="text-xs text-gray-500 mt-0.5">{completedCount}/{taskCount} tasks</div>
                </div>
                <button onClick={() => handleStatusToggle(m)} className="text-xs text-indigo-600 hover:text-indigo-800 px-2 py-1 rounded hover:bg-indigo-50">
                  {m.status === 'pending' ? 'Mark Reached' : m.status === 'reached' ? 'Mark Missed' : 'Reset'}
                </button>
                <button onClick={() => handleDelete(m.id)} className="text-xs text-red-400 hover:text-red-600 px-1">✕</button>
              </div>
              {taskCount > 0 && (
                <div className="mt-2 ml-6">
                  <div className="w-full bg-gray-100 rounded-full h-1.5">
                    <div className="bg-green-500 h-1.5 rounded-full transition-all" style={{ width: `${progress}%` }} />
                  </div>
                  <span className="text-[10px] text-gray-400">{progress}% complete</span>
                </div>
              )}
            </div>
          );
        })}
        {milestones.length === 0 && <p className="text-gray-400 text-sm">No milestones yet. Milestones are target deadlines that group related tasks (e.g., &quot;Phase 1 Launch&quot;, &quot;Beta Release&quot;).</p>}
      </div>
      {showCreate && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 w-full max-w-md">
            <h3 className="font-semibold mb-3">New Milestone</h3>
            <div className="space-y-2">
              <input className="w-full border rounded px-3 py-2 text-sm" placeholder="Milestone name (e.g., Phase 1 Launch)"
                value={form.name} onChange={e => setForm({...form, name: e.target.value})} autoFocus />
              <textarea className="w-full border rounded px-3 py-2 text-sm resize-none" rows={2} placeholder="Description (optional)"
                value={form.description} onChange={e => setForm({...form, description: e.target.value})} />
              <div>
                <label className="text-xs text-gray-500 block mb-1">Target Due Date</label>
                <input type="date" className="w-full border rounded px-3 py-2 text-sm"
                  value={form.due_date} onChange={e => setForm({...form, due_date: e.target.value})} />
              </div>
            </div>
            <div className="flex gap-3 mt-4">
              <button onClick={() => setShowCreate(false)} className="flex-1 border rounded px-3 py-2 text-sm">Cancel</button>
              <button onClick={handleCreate} disabled={!form.name} className="flex-1 bg-indigo-600 text-white rounded px-3 py-2 text-sm disabled:opacity-50">Create</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function SprintsTab({ projectId, tasks, members, onReload }: { projectId: number; tasks: any[]; members: any[]; onReload: () => void }) {
  const [sprints, setSprints] = useState<any[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ name: '', start_date: '', end_date: '', goal: '' });
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [sprintTasks, setSprintTasks] = useState<any[]>([]);
  const [showAssign, setShowAssign] = useState<number | null>(null);

  const load = () => {
    pmsApi.listSprints(projectId).then(r => { setSprints(r.data); setLoading(false); }).catch(() => setLoading(false));
  };
  useEffect(() => { load(); }, [projectId]);

  const handleCreate = async () => {
    await pmsApi.createSprint(projectId, { ...form, status: 'planning' });
    setShowCreate(false);
    setForm({ name: '', start_date: '', end_date: '', goal: '' });
    load();
  };

  const handleStatusChange = async (id: number, status: string) => {
    await pmsApi.updateSprint(id, { status });
    load();
  };

  const handleDelete = async (id: number) => {
    await pmsApi.deleteSprint(id);
    if (expandedId === id) setExpandedId(null);
    load();
  };

  const toggleExpand = async (id: number) => {
    if (expandedId === id) { setExpandedId(null); return; }
    setExpandedId(id);
    const r = await pmsApi.getSprintTasks(id);
    setSprintTasks(r.data);
  };

  const handleAssignTask = async (sprintId: number, taskId: number) => {
    await pmsApi.assignTaskToSprint(sprintId, taskId);
    const r = await pmsApi.getSprintTasks(sprintId);
    setSprintTasks(r.data);
    load();
    onReload();
  };

  const handleRemoveTask = async (sprintId: number, taskId: number) => {
    await pmsApi.removeTaskFromSprint(sprintId, taskId);
    const r = await pmsApi.getSprintTasks(sprintId);
    setSprintTasks(r.data);
    load();
    onReload();
  };

  const STATUS_COLORS: Record<string, string> = { planning: 'bg-gray-100 text-gray-700', active: 'bg-green-100 text-green-700', completed: 'bg-blue-100 text-blue-700' };
  const STAGE_BADGE: Record<string, string> = {
    development: 'bg-indigo-100 text-indigo-700', qa: 'bg-amber-100 text-amber-700',
    pm_review: 'bg-purple-100 text-purple-700', client_review: 'bg-cyan-100 text-cyan-700',
    approved: 'bg-green-100 text-green-700', completed: 'bg-gray-100 text-gray-600',
  };

  if (loading) return <div className="text-gray-400 text-center py-10">Loading sprints...</div>;

  const sprintTaskIds = new Set(sprintTasks.map((t: any) => t.id));
  const unassignedTasks = tasks.filter(t => !t.sprint_id && !t.parent_task_id);

  return (
    <div className="p-6 max-w-4xl">
      <div className="flex justify-between items-center mb-4">
        <div>
          <h2 className="font-semibold text-gray-800">Sprints</h2>
          <p className="text-xs text-gray-400 mt-0.5">Time-boxed work periods. Assign tasks to sprints to plan and track your team&apos;s work.</p>
        </div>
        <button onClick={() => setShowCreate(true)} className="bg-indigo-600 text-white px-3 py-1.5 rounded-lg text-sm">+ New Sprint</button>
      </div>
      <div className="space-y-3">
        {sprints.map((s: any) => {
          const progress = s.task_count > 0 ? Math.round((s.completed_count / s.task_count) * 100) : 0;
          const isExpanded = expandedId === s.id;
          return (
            <div key={s.id} className="bg-white border rounded-lg overflow-hidden">
              <div className="p-4">
                <div className="flex items-center gap-3">
                  <button onClick={() => toggleExpand(s.id)} className="text-gray-400 hover:text-gray-600 flex-none">
                    <span className={`inline-block transition-transform ${isExpanded ? 'rotate-90' : ''}`}>&#9654;</span>
                  </button>
                  <div className="flex-1 min-w-0 cursor-pointer" onClick={() => toggleExpand(s.id)}>
                    <div className="flex items-center gap-2">
                      <h3 className="font-medium text-gray-900">{s.name}</h3>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLORS[s.status] || 'bg-gray-100 text-gray-600'}`}>{s.status}</span>
                    </div>
                    {s.goal && <p className="text-xs text-gray-400 mt-0.5">{s.goal}</p>}
                  </div>
                  <div className="text-right flex-none text-xs text-gray-400">
                    <div>{s.start_date || '?'} &rarr; {s.end_date || '?'}</div>
                    <div className="mt-0.5">{s.completed_count}/{s.task_count} tasks &middot; {s.total_actual_hours}/{s.total_estimated_hours}h</div>
                  </div>
                  <div className="flex gap-1 flex-none">
                    {s.status === 'planning' && <button onClick={() => handleStatusChange(s.id, 'active')} className="text-xs bg-green-50 text-green-700 px-2 py-1 rounded hover:bg-green-100">Start</button>}
                    {s.status === 'active' && <button onClick={() => handleStatusChange(s.id, 'completed')} className="text-xs bg-blue-50 text-blue-700 px-2 py-1 rounded hover:bg-blue-100">Complete</button>}
                    <button onClick={() => handleDelete(s.id)} className="text-xs text-red-400 hover:text-red-600 px-1">✕</button>
                  </div>
                </div>
                {s.task_count > 0 && (
                  <div className="mt-2 ml-7">
                    <div className="w-full bg-gray-100 rounded-full h-1.5">
                      <div className={`h-1.5 rounded-full transition-all ${s.status === 'completed' ? 'bg-blue-500' : 'bg-green-500'}`} style={{ width: `${progress}%` }} />
                    </div>
                    <span className="text-[10px] text-gray-400">{progress}% complete</span>
                  </div>
                )}
              </div>

              {isExpanded && (
                <div className="border-t bg-gray-50 p-4">
                  <div className="flex items-center justify-between mb-3">
                    <h4 className="text-xs font-semibold text-gray-500 uppercase">Sprint Tasks</h4>
                    <button onClick={() => setShowAssign(showAssign === s.id ? null : s.id)}
                      className="text-xs bg-indigo-50 text-indigo-600 px-2 py-1 rounded hover:bg-indigo-100">
                      + Assign Tasks
                    </button>
                  </div>

                  {showAssign === s.id && unassignedTasks.length > 0 && (
                    <div className="mb-3 border rounded bg-white p-2 max-h-40 overflow-y-auto">
                      <p className="text-[10px] text-gray-400 mb-1 uppercase font-semibold">Unassigned Tasks (click to add)</p>
                      {unassignedTasks.map(t => (
                        <button key={t.id} onClick={() => handleAssignTask(s.id, t.id)}
                          className="block w-full text-left text-xs px-2 py-1.5 hover:bg-indigo-50 rounded truncate text-gray-700">
                          {t.title} <span className="text-gray-400">({t.stage?.replace('_', ' ')})</span>
                        </button>
                      ))}
                    </div>
                  )}
                  {showAssign === s.id && unassignedTasks.length === 0 && (
                    <p className="mb-3 text-xs text-gray-400">All tasks are already assigned to sprints.</p>
                  )}

                  {sprintTasks.length > 0 ? (
                    <div className="space-y-1">
                      {sprintTasks.map((t: any) => (
                        <div key={t.id} className="flex items-center gap-2 bg-white rounded border px-3 py-2 text-xs">
                          <span className={`px-1.5 py-0.5 rounded-full font-medium ${STAGE_BADGE[t.stage] || 'bg-gray-100 text-gray-600'}`}>{t.stage?.replace('_', ' ')}</span>
                          <span className="flex-1 text-gray-800 truncate">{t.title}</span>
                          <span className="text-gray-400">{t.assignee_name || 'Unassigned'}</span>
                          <span className="text-gray-400">{t.actual_hours}/{t.estimated_hours}h</span>
                          <button onClick={() => handleRemoveTask(s.id, t.id)} className="text-red-400 hover:text-red-600" title="Remove from sprint">✕</button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-gray-400">No tasks assigned to this sprint yet.</p>
                  )}
                </div>
              )}
            </div>
          );
        })}
        {sprints.length === 0 && <p className="text-gray-400 text-sm">No sprints yet. Sprints are time-boxed work periods (e.g., &quot;Sprint 1: May 19-30&quot;) that group tasks for focused delivery.</p>}
      </div>
      {showCreate && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 w-full max-w-md">
            <h3 className="font-semibold mb-3">New Sprint</h3>
            <div className="space-y-2">
              <input className="w-full border rounded px-3 py-2 text-sm" placeholder="Sprint name (e.g., Sprint 1)" value={form.name} onChange={e => setForm({...form, name: e.target.value})} autoFocus />
              <div className="grid grid-cols-2 gap-2">
                <div><label className="text-xs text-gray-500">Start Date</label><input type="date" className="w-full border rounded px-3 py-2 text-sm" value={form.start_date} onChange={e => setForm({...form, start_date: e.target.value})} /></div>
                <div><label className="text-xs text-gray-500">End Date</label><input type="date" className="w-full border rounded px-3 py-2 text-sm" value={form.end_date} onChange={e => setForm({...form, end_date: e.target.value})} /></div>
              </div>
              <textarea className="w-full border rounded px-3 py-2 text-sm resize-none" placeholder="Sprint goal (optional)" rows={2} value={form.goal} onChange={e => setForm({...form, goal: e.target.value})} />
            </div>
            <div className="flex gap-3 mt-4">
              <button onClick={() => setShowCreate(false)} className="flex-1 border rounded px-3 py-2 text-sm">Cancel</button>
              <button onClick={handleCreate} disabled={!form.name} className="flex-1 bg-indigo-600 text-white rounded px-3 py-2 text-sm disabled:opacity-50">Create</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function SettingsTab({ project }: any) {
  const [members, setMembers] = useState<any[]>([]);
  const [allUsers, setAllUsers] = useState<any[]>([]);
  const [addForm, setAddForm] = useState({ user_id: '', role: 'developer' });
  const [loadingUsers, setLoadingUsers] = useState(true);

  useEffect(() => {
    // Load current project members
    pmsApi.listMembers(project.id).then(r => setMembers(r.data));

    // Load all system users for the dropdown
    const { getAuthToken } = require('@/lib/auth');
    const { API_URL } = require('@/lib/config');
    const token = getAuthToken();
    fetch(`${API_URL}/admin/users`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json())
      .then(data => { setAllUsers(Array.isArray(data) ? data : []); setLoadingUsers(false); })
      .catch(() => setLoadingUsers(false));
  }, [project.id]);

  const memberUserIds = new Set(members.map((m: any) => m.user_id));
  // Only show users not already members
  const availableUsers = allUsers.filter((u: any) => !memberUserIds.has(u.id));

  const handleAdd = async () => {
    if (!addForm.user_id) return;
    await pmsApi.addMember(project.id, { user_id: Number(addForm.user_id), role: addForm.role });
    const r = await pmsApi.listMembers(project.id);
    setMembers(r.data);
    setAddForm({ user_id: '', role: 'developer' });
  };

  const handleRemove = async (userId: number) => {
    await pmsApi.removeMember(project.id, userId);
    const r = await pmsApi.listMembers(project.id);
    setMembers(r.data);
  };

  return (
    <div className="p-6 max-w-2xl">
      <h2 className="font-semibold text-gray-800 mb-4">Project Members</h2>
      <div className="space-y-2 mb-6">
        {members.map((m: any) => (
          <div key={m.id} className="flex items-center gap-3 bg-white border rounded-lg px-4 py-3">
            <div className="w-8 h-8 rounded-full bg-indigo-100 text-indigo-700 flex items-center justify-center text-sm font-semibold flex-none">
              {(m.user_name || 'U').charAt(0).toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-gray-800 truncate">{m.user_name || `User #${m.user_id}`}</div>
              {m.user_email && <div className="text-xs text-gray-400 truncate">{m.user_email}</div>}
            </div>
            <span className="text-xs bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded font-medium capitalize">{m.role}</span>
            <button onClick={() => handleRemove(m.user_id)}
              className="text-red-400 hover:text-red-600 text-xs ml-1 hover:bg-red-50 px-2 py-1 rounded">
              Remove
            </button>
          </div>
        ))}
        {members.length === 0 && <p className="text-sm text-gray-400">No members yet.</p>}
      </div>

      <div className="bg-gray-50 rounded-lg p-4 border border-gray-200">
        <h3 className="text-sm font-semibold text-gray-700 mb-3">Add Member</h3>
        <div className="flex gap-2">
          <select
            className="flex-1 border rounded-lg px-3 py-2 text-sm bg-white disabled:opacity-50"
            value={addForm.user_id}
            disabled={loadingUsers}
            onChange={e => setAddForm({ ...addForm, user_id: e.target.value })}>
            <option value="">{loadingUsers ? 'Loading users…' : availableUsers.length === 0 ? 'All users are members' : 'Select a user…'}</option>
            {availableUsers.map((u: any) => (
              <option key={u.id} value={u.id}>
                {u.full_name || u.username || u.email} {u.email ? `(${u.email})` : ''}
              </option>
            ))}
          </select>
          <select className="border rounded-lg px-3 py-2 text-sm bg-white" value={addForm.role}
            onChange={e => setAddForm({ ...addForm, role: e.target.value })}>
            {['developer', 'qa', 'pm', 'client', 'viewer'].map(r => (
              <option key={r} value={r}>{r.charAt(0).toUpperCase() + r.slice(1)}</option>
            ))}
          </select>
          <button onClick={handleAdd} disabled={!addForm.user_id}
            className="bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-indigo-700 disabled:opacity-50">
            Add
          </button>
        </div>
      </div>
    </div>
  );
}
