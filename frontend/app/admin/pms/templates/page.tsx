'use client';
import { useEffect, useState } from 'react';
import { pmsApi } from '@/lib/api';
import { authAPI } from '@/lib/auth';
import MainHeader from '@/components/MainHeader';
import AdminNav from '@/components/AdminNav';

export default function TemplatesPage() {
  const user = authAPI.getUser();
  const [taskTemplates, setTaskTemplates] = useState<any[]>([]);
  const [projectTemplates, setProjectTemplates] = useState<any[]>([]);
  const [activeTab, setActiveTab] = useState<'task' | 'project'>('task');
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ name: '', description: '' });
  const [selectedTemplate, setSelectedTemplate] = useState<any>(null);
  const [itemForm, setItemForm] = useState({ title: '', priority: 'medium', estimated_hours: 0 });
  const [loading, setLoading] = useState(true);

  const loadTaskTemplates = () => pmsApi.listTaskTemplates().then(r => setTaskTemplates(r.data)).catch(() => {});
  const loadProjectTemplates = () => pmsApi.listProjectTemplates().then(r => setProjectTemplates(r.data)).catch(() => {});

  useEffect(() => {
    Promise.all([loadTaskTemplates(), loadProjectTemplates()]).then(() => setLoading(false));
  }, []);

  const handleCreate = async () => {
    if (activeTab === 'task') {
      await pmsApi.createTaskTemplate(form);
      loadTaskTemplates();
    } else {
      await pmsApi.createProjectTemplate(form);
      loadProjectTemplates();
    }
    setShowCreate(false);
    setForm({ name: '', description: '' });
  };

  const handleDelete = async (id: number) => {
    if (activeTab === 'task') {
      await pmsApi.deleteTaskTemplate(id);
      loadTaskTemplates();
    } else {
      await pmsApi.deleteProjectTemplate(id);
      loadProjectTemplates();
    }
    if (selectedTemplate?.id === id) setSelectedTemplate(null);
  };

  const handleViewTemplate = async (id: number) => {
    const r = activeTab === 'task' ? await pmsApi.getTaskTemplate(id) : await pmsApi.getProjectTemplate(id);
    setSelectedTemplate(r.data);
  };

  const handleAddItem = async () => {
    if (!selectedTemplate || !itemForm.title) return;
    if (activeTab === 'task') {
      await pmsApi.addTemplateItem(selectedTemplate.id, itemForm);
    } else {
      await pmsApi.addProjectTemplateTask(selectedTemplate.id, itemForm);
    }
    handleViewTemplate(selectedTemplate.id);
    setItemForm({ title: '', priority: 'medium', estimated_hours: 0 });
  };

  if (!user) return null;
  const templates = activeTab === 'task' ? taskTemplates : projectTemplates;

  return (
    <div className="ml-0 md:ml-60 pt-14 min-h-screen bg-gray-50 pb-16 md:pb-0">
      <MainHeader user={user} />
      <AdminNav />
      <div className="p-6">
        <div className="flex justify-between items-center mb-6">
          <h1 className="text-2xl font-bold text-gray-900">Templates</h1>
          <button onClick={() => setShowCreate(true)} className="bg-indigo-600 text-white px-4 py-2 rounded-lg hover:bg-indigo-700 font-medium text-sm">+ New Template</button>
        </div>

        {/* Tab Toggle */}
        <div className="flex gap-1 mb-6 border-b">
          <button onClick={() => { setActiveTab('task'); setSelectedTemplate(null); }}
            className={`px-4 py-3 text-sm font-medium border-b-2 ${activeTab === 'task' ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-gray-500'}`}>
            Task Templates
          </button>
          <button onClick={() => { setActiveTab('project'); setSelectedTemplate(null); }}
            className={`px-4 py-3 text-sm font-medium border-b-2 ${activeTab === 'project' ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-gray-500'}`}>
            Project Templates
          </button>
        </div>

        {loading ? <div className="text-gray-400 text-center py-20">Loading...</div> : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Template List */}
            <div className="space-y-3">
              {templates.map((t: any) => (
                <div key={t.id} className={`bg-white border rounded-lg p-4 cursor-pointer hover:shadow-md transition-shadow ${selectedTemplate?.id === t.id ? 'ring-2 ring-indigo-500' : ''}`}
                  onClick={() => handleViewTemplate(t.id)}>
                  <div className="flex items-center justify-between">
                    <h3 className="font-medium text-gray-900">{t.name}</h3>
                    <button onClick={(e) => { e.stopPropagation(); handleDelete(t.id); }}
                      className="text-red-400 hover:text-red-600 text-xs px-2 py-1 rounded hover:bg-red-50">Delete</button>
                  </div>
                  {t.description && <p className="text-sm text-gray-500 mt-1 line-clamp-2">{t.description}</p>}
                  <p className="text-xs text-gray-400 mt-2">{t.item_count || t.task_count || 0} items</p>
                </div>
              ))}
              {templates.length === 0 && <p className="text-gray-400 text-sm text-center py-10">No templates yet.</p>}
            </div>

            {/* Template Detail */}
            {selectedTemplate && (
              <div className="bg-white border rounded-lg p-6">
                <h3 className="font-semibold text-gray-900 mb-4">{selectedTemplate.name}</h3>
                {selectedTemplate.description && <p className="text-sm text-gray-500 mb-4">{selectedTemplate.description}</p>}

                <h4 className="text-sm font-medium text-gray-700 mb-2">{activeTab === 'task' ? 'Items' : 'Tasks'}</h4>
                <div className="space-y-2 mb-4">
                  {(selectedTemplate.items || selectedTemplate.tasks || []).map((item: any) => (
                    <div key={item.id} className="flex items-center gap-2 bg-gray-50 rounded px-3 py-2 text-sm">
                      <span className={`w-2 h-2 rounded-full ${item.priority === 'urgent' ? 'bg-red-500' : item.priority === 'high' ? 'bg-orange-500' : item.priority === 'medium' ? 'bg-yellow-500' : 'bg-gray-400'}`} />
                      <span className="text-gray-800">{item.title}</span>
                      {item.estimated_hours > 0 && <span className="text-xs text-gray-400 ml-auto">{item.estimated_hours}h</span>}
                    </div>
                  ))}
                </div>

                {/* Add Item */}
                <div className="border-t pt-3">
                  <h4 className="text-sm font-medium text-gray-700 mb-2">Add Item</h4>
                  <div className="flex gap-2">
                    <input className="flex-1 border rounded px-3 py-1.5 text-sm" placeholder="Item title"
                      value={itemForm.title} onChange={e => setItemForm({...itemForm, title: e.target.value})} />
                    <select className="border rounded px-2 py-1.5 text-sm" value={itemForm.priority}
                      onChange={e => setItemForm({...itemForm, priority: e.target.value})}>
                      {['low', 'medium', 'high', 'urgent'].map(p => <option key={p} value={p}>{p}</option>)}
                    </select>
                    <button onClick={handleAddItem} disabled={!itemForm.title}
                      className="bg-indigo-600 text-white px-3 py-1.5 rounded text-sm disabled:opacity-50">Add</button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Create Modal */}
        {showCreate && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className="bg-white rounded-xl p-6 w-full max-w-md">
              <h2 className="text-lg font-semibold mb-4">New {activeTab === 'task' ? 'Task' : 'Project'} Template</h2>
              <div className="space-y-3">
                <input className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="Template name"
                  value={form.name} onChange={e => setForm({...form, name: e.target.value})} />
                <textarea className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="Description" rows={3}
                  value={form.description} onChange={e => setForm({...form, description: e.target.value})} />
              </div>
              <div className="flex gap-3 mt-5">
                <button onClick={() => setShowCreate(false)} className="flex-1 border rounded-lg px-4 py-2 text-sm">Cancel</button>
                <button onClick={handleCreate} disabled={!form.name}
                  className="flex-1 bg-indigo-600 text-white rounded-lg px-4 py-2 text-sm disabled:opacity-50">Create</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
