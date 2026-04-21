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
import ActivityFeed from '@/components/pms/ActivityFeed';
import CalendarView from '@/components/pms/CalendarView';

const TABS = ['Gantt', 'Board', 'List', 'Calendar', 'Milestones', 'Sprints', 'Activity', 'Settings'];

export default function ProjectDetailPage() {
  const { id } = useParams();
  const projectId = Number(id);
  const user = authAPI.getUser();
  const [project, setProject] = useState<any>(null);
  const [tasks, setTasks] = useState<any[]>([]);
  const [milestones, setMilestones] = useState<any[]>([]);
  const [activeTab, setActiveTab] = useState('Gantt');
  const [loading, setLoading] = useState(true);
  const [showCreateTask, setShowCreateTask] = useState(false);
  const emptyTaskForm = { title: '', description: '', priority: 'medium', milestone_id: '', assignee_id: '', due_date: '', estimated_hours: '' };
  const [taskForm, setTaskForm] = useState(emptyTaskForm);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');

  const handleCreateTask = async () => {
    if (!taskForm.title.trim()) return;
    setCreating(true);
    setCreateError('');
    try {
      await pmsApi.createTask(projectId, {
        ...taskForm,
        milestone_id: taskForm.milestone_id ? Number(taskForm.milestone_id) : null,
        assignee_id: taskForm.assignee_id ? Number(taskForm.assignee_id) : null,
        estimated_hours: taskForm.estimated_hours ? Number(taskForm.estimated_hours) : 0,
      });
      await reload();
      setShowCreateTask(false);
      setTaskForm(emptyTaskForm);
    } catch (err: any) {
      setCreateError(err?.response?.data?.detail || 'Failed to create task. Please try again.');
    } finally {
      setCreating(false);
    }
  };

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
    <div className="ml-0 md:ml-60 pt-14 min-h-screen bg-gray-50 pb-16 md:pb-0">
      <MainHeader user={user} />
      <AdminNav />
      <div className="flex items-center justify-center h-64 text-gray-400">Loading...</div>
    </div>
  );

  return (
    <div className="ml-0 md:ml-60 pt-14 min-h-screen bg-gray-50 flex flex-col pb-16 md:pb-0">
      <MainHeader user={user} />
      <AdminNav />
      {/* Project header */}
      <div className="px-6 py-4 border-b border-gray-200 bg-white flex items-center gap-4">
        <div className="w-3 h-3 rounded-full flex-none" style={{ background: project?.color }} />
        <h1 className="text-lg font-semibold text-gray-900">{project?.name}</h1>
        <span className="text-xs text-gray-400 capitalize">{project?.status?.replace('_', ' ')}</span>
        <button onClick={() => setShowCreateTask(true)}
          className="ml-auto bg-indigo-600 text-white px-3 py-1.5 rounded-lg text-sm font-medium hover:bg-indigo-700">
          + Create Task
        </button>
      </div>

      {/* Create Task Modal */}
      {showCreateTask && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 w-[480px] shadow-xl max-h-[90vh] overflow-y-auto">
            <h3 className="font-semibold text-gray-900 mb-4">New Task</h3>
            <div className="space-y-3">
              <input className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                placeholder="Task title *" value={taskForm.title} onChange={e => setTaskForm({ ...taskForm, title: e.target.value })} autoFocus />
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
                {milestones.map((m: any) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
              <select className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white"
                value={taskForm.assignee_id} onChange={e => setTaskForm({ ...taskForm, assignee_id: e.target.value })}>
                <option value="">Unassigned</option>
                {(project?.members || []).map((m: any) => <option key={m.id} value={m.id}>{m.full_name || m.email}</option>)}
              </select>
              <input type="date" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                value={taskForm.due_date} onChange={e => setTaskForm({ ...taskForm, due_date: e.target.value })} />
              <input type="number" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                placeholder="Estimated hours" min="0" step="0.5"
                value={taskForm.estimated_hours} onChange={e => setTaskForm({ ...taskForm, estimated_hours: e.target.value })} />
            </div>
            {createError && <p className="mt-3 text-sm text-red-600">{createError}</p>}
            <div className="flex gap-3 mt-5">
              <button onClick={() => { setShowCreateTask(false); setTaskForm(emptyTaskForm); setCreateError(''); }}
                className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-600 hover:bg-gray-50">Cancel</button>
              <button onClick={handleCreateTask} disabled={!taskForm.title.trim() || creating}
                className="flex-1 bg-indigo-600 text-white rounded-lg px-3 py-2 text-sm font-medium hover:bg-indigo-700 disabled:opacity-50">
                {creating ? 'Creating…' : 'Create Task'}
              </button>
            </div>
          </div>
        </div>
      )}
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
        {activeTab === 'Gantt' && (
          <div className="h-full" style={{ height: 'calc(100vh - 14rem)' }}>
            <GanttChart projectId={projectId} tasks={tasks} milestones={milestones} />
          </div>
        )}
        {activeTab === 'Board' && (
          <div style={{ height: 'calc(100vh - 14rem)' }}>
            <BoardView projectId={projectId} tasks={tasks} members={project?.members || []} milestones={milestones} onReload={reload} />
          </div>
        )}
        {activeTab === 'List' && <ListView projectId={projectId} tasks={tasks} milestones={milestones} members={project?.members || []} onReload={reload} />}
        {activeTab === 'Calendar' && <CalendarView tasks={tasks} milestones={milestones} />}
        {activeTab === 'Milestones' && <MilestonesTab projectId={projectId} milestones={milestones} onReload={reload} />}
        {activeTab === 'Sprints' && <SprintsTab projectId={projectId} />}
        {activeTab === 'Activity' && <ActivityFeed projectId={projectId} />}
        {activeTab === 'Settings' && <SettingsTab project={project} onReload={reload} />}
      </div>
    </div>
  );
}

function MilestonesTab({ projectId, milestones, onReload }: any) {
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ name: '', due_date: '', color: '#f59e0b' });

  const handleCreate = async () => {
    await pmsApi.createMilestone(projectId, form);
    onReload();
    setShowCreate(false);
    setForm({ name: '', due_date: '', color: '#f59e0b' });
  };

  return (
    <div className="p-6">
      <div className="flex justify-between items-center mb-4">
        <h2 className="font-semibold text-gray-800">Milestones</h2>
        <button onClick={() => setShowCreate(true)} className="bg-indigo-600 text-white px-3 py-1.5 rounded-lg text-sm">+ Add</button>
      </div>
      <div className="space-y-3">
        {milestones.map((m: any) => (
          <div key={m.id} className="flex items-center gap-3 bg-white border rounded-lg p-4">
            <div className="w-3 h-3 rounded-full" style={{ background: m.color }} />
            <span className="font-medium text-gray-800">{m.name}</span>
            <span className="text-sm text-gray-400 ml-auto">{m.due_date}</span>
            <span className={`text-xs px-2 py-0.5 rounded-full ${m.status === 'reached' ? 'bg-green-100 text-green-700' : m.status === 'missed' ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-600'}`}>{m.status}</span>
          </div>
        ))}
        {milestones.length === 0 && <p className="text-gray-400 text-sm">No milestones yet.</p>}
      </div>
      {showCreate && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 w-96">
            <h3 className="font-semibold mb-3">New Milestone</h3>
            <input className="w-full border rounded px-3 py-2 text-sm mb-2" placeholder="Milestone name"
              value={form.name} onChange={e => setForm({...form, name: e.target.value})} />
            <input type="date" className="w-full border rounded px-3 py-2 text-sm mb-3"
              value={form.due_date} onChange={e => setForm({...form, due_date: e.target.value})} />
            <div className="flex gap-3">
              <button onClick={() => setShowCreate(false)} className="flex-1 border rounded px-3 py-2 text-sm">Cancel</button>
              <button onClick={handleCreate} className="flex-1 bg-indigo-600 text-white rounded px-3 py-2 text-sm">Create</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function SprintsTab({ projectId }: { projectId: number }) {
  const [sprints, setSprints] = useState<any[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ name: '', start_date: '', end_date: '', goal: '' });
  const [loading, setLoading] = useState(true);

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

  const STATUS_COLORS: Record<string, string> = { planning: 'bg-gray-100 text-gray-700', active: 'bg-green-100 text-green-700', completed: 'bg-blue-100 text-blue-700' };

  if (loading) return <div className="text-gray-400 text-center py-10">Loading sprints...</div>;

  return (
    <div className="p-6 max-w-3xl">
      <div className="flex justify-between items-center mb-4">
        <h2 className="font-semibold text-gray-800">Sprints</h2>
        <button onClick={() => setShowCreate(true)} className="bg-indigo-600 text-white px-3 py-1.5 rounded-lg text-sm">+ New Sprint</button>
      </div>
      <div className="space-y-3">
        {sprints.map((s: any) => (
          <div key={s.id} className="bg-white border rounded-lg p-4">
            <div className="flex items-center gap-3 mb-2">
              <h3 className="font-medium text-gray-900">{s.name}</h3>
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLORS[s.status] || 'bg-gray-100 text-gray-600'}`}>{s.status}</span>
              <div className="ml-auto flex gap-1">
                {s.status === 'planning' && <button onClick={() => handleStatusChange(s.id, 'active')} className="text-xs bg-green-50 text-green-700 px-2 py-1 rounded hover:bg-green-100">Start</button>}
                {s.status === 'active' && <button onClick={() => handleStatusChange(s.id, 'completed')} className="text-xs bg-blue-50 text-blue-700 px-2 py-1 rounded hover:bg-blue-100">Complete</button>}
              </div>
            </div>
            {s.goal && <p className="text-sm text-gray-500 mb-2">{s.goal}</p>}
            <div className="text-xs text-gray-400">
              {s.start_date && <span>{s.start_date}</span>}
              {s.start_date && s.end_date && <span> &rarr; </span>}
              {s.end_date && <span>{s.end_date}</span>}
            </div>
          </div>
        ))}
        {sprints.length === 0 && <p className="text-gray-400 text-sm">No sprints yet.</p>}
      </div>
      {showCreate && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 w-full max-w-md">
            <h3 className="font-semibold mb-3">New Sprint</h3>
            <div className="space-y-2">
              <input className="w-full border rounded px-3 py-2 text-sm" placeholder="Sprint name" value={form.name} onChange={e => setForm({...form, name: e.target.value})} />
              <div className="grid grid-cols-2 gap-2">
                <div><label className="text-xs text-gray-500">Start</label><input type="date" className="w-full border rounded px-3 py-2 text-sm" value={form.start_date} onChange={e => setForm({...form, start_date: e.target.value})} /></div>
                <div><label className="text-xs text-gray-500">End</label><input type="date" className="w-full border rounded px-3 py-2 text-sm" value={form.end_date} onChange={e => setForm({...form, end_date: e.target.value})} /></div>
              </div>
              <textarea className="w-full border rounded px-3 py-2 text-sm" placeholder="Sprint goal" rows={2} value={form.goal} onChange={e => setForm({...form, goal: e.target.value})} />
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
