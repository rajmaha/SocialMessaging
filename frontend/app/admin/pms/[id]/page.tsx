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

const TABS = ['Gantt', 'Board', 'List', 'Milestones', 'Settings'];

export default function ProjectDetailPage() {
  const { id } = useParams();
  const projectId = Number(id);
  const user = authAPI.getUser();
  const [project, setProject] = useState<any>(null);
  const [tasks, setTasks] = useState<any[]>([]);
  const [milestones, setMilestones] = useState<any[]>([]);
  const [activeTab, setActiveTab] = useState('Gantt');
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
        {activeTab === 'Milestones' && <MilestonesTab projectId={projectId} milestones={milestones} onReload={reload} />}
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
