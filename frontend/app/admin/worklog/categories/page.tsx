'use client';
import { useEffect, useState } from 'react';
import { worklogApi } from '@/lib/api';
import MainHeader from '@/components/MainHeader';
import AdminNav from '@/components/AdminNav';
import { authAPI } from '@/lib/auth';

interface Category { id: number; name: string; group_id: number; created_at: string; }
interface CategoryGroup { id: number; name: string; color: string; created_at: string; categories: Category[]; }

export default function WorklogCategories() {
  const user = authAPI.getUser();
  const [groups, setGroups] = useState<CategoryGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [showGroupForm, setShowGroupForm] = useState(false);
  const [showCatForm, setShowCatForm] = useState<number | null>(null);
  const [groupForm, setGroupForm] = useState({ name: '', color: '#6366f1' });
  const [catForm, setCatForm] = useState({ name: '' });
  const [editGroup, setEditGroup] = useState<CategoryGroup | null>(null);

  const load = () => {
    setLoading(true);
    worklogApi.listCategoryGroups().then(r => { setGroups(r.data); setLoading(false); });
  };

  useEffect(() => { load(); }, []);

  const handleCreateGroup = async () => {
    await worklogApi.createCategoryGroup(groupForm);
    setGroupForm({ name: '', color: '#6366f1' });
    setShowGroupForm(false);
    load();
  };

  const handleUpdateGroup = async () => {
    if (!editGroup) return;
    await worklogApi.updateCategoryGroup(editGroup.id, groupForm);
    setEditGroup(null);
    setGroupForm({ name: '', color: '#6366f1' });
    load();
  };

  const handleDeleteGroup = async (id: number) => {
    if (!confirm('Delete this group and all its categories?')) return;
    await worklogApi.deleteCategoryGroup(id);
    load();
  };

  const handleCreateCategory = async (groupId: number) => {
    await worklogApi.createCategory({ group_id: groupId, name: catForm.name });
    setCatForm({ name: '' });
    setShowCatForm(null);
    load();
  };

  const handleDeleteCategory = async (id: number) => {
    if (!confirm('Delete this category?')) return;
    await worklogApi.deleteCategory(id);
    load();
  };

  return (
    <div className="ml-60 pt-14 min-h-screen bg-gray-50">
      <MainHeader user={user} />
      <AdminNav />
      <div className="p-6 max-w-4xl">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold text-gray-900">Worklog Categories</h1>
          <button onClick={() => { setShowGroupForm(true); setEditGroup(null); }} className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700">
            + Add Group
          </button>
        </div>

        {(showGroupForm || editGroup) && (
          <div className="bg-white border rounded-lg p-4 mb-4">
            <h3 className="font-medium mb-3">{editGroup ? 'Edit Group' : 'New Group'}</h3>
            <div className="flex gap-3 items-end">
              <div className="flex-1">
                <label className="text-sm text-gray-600">Name</label>
                <input value={groupForm.name} onChange={e => setGroupForm({ ...groupForm, name: e.target.value })} className="w-full border rounded px-3 py-2 text-sm" placeholder="e.g., Development" />
              </div>
              <div>
                <label className="text-sm text-gray-600">Color</label>
                <input type="color" value={groupForm.color} onChange={e => setGroupForm({ ...groupForm, color: e.target.value })} className="w-12 h-9 border rounded cursor-pointer" />
              </div>
              <button onClick={editGroup ? handleUpdateGroup : handleCreateGroup} className="px-4 py-2 bg-indigo-600 text-white rounded text-sm">
                {editGroup ? 'Update' : 'Create'}
              </button>
              <button onClick={() => { setShowGroupForm(false); setEditGroup(null); }} className="px-4 py-2 bg-gray-200 rounded text-sm">Cancel</button>
            </div>
          </div>
        )}

        {loading ? (
          <div className="text-center py-12 text-gray-500">Loading...</div>
        ) : groups.length === 0 ? (
          <div className="text-center py-12 text-gray-500">No category groups yet. Create one to get started.</div>
        ) : (
          <div className="space-y-4">
            {groups.map(group => (
              <div key={group.id} className="bg-white border rounded-lg overflow-hidden">
                <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderLeftWidth: 4, borderLeftColor: group.color }}>
                  <div className="flex items-center gap-2">
                    <span className="w-3 h-3 rounded-full" style={{ backgroundColor: group.color }} />
                    <span className="font-medium text-gray-900">{group.name}</span>
                    <span className="text-xs text-gray-500">({group.categories.length} categories)</span>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => setShowCatForm(group.id)} className="text-xs text-indigo-600 hover:underline">+ Category</button>
                    <button onClick={() => { setEditGroup(group); setGroupForm({ name: group.name, color: group.color }); }} className="text-xs text-gray-500 hover:underline">Edit</button>
                    <button onClick={() => handleDeleteGroup(group.id)} className="text-xs text-red-500 hover:underline">Delete</button>
                  </div>
                </div>

                {showCatForm === group.id && (
                  <div className="px-4 py-3 bg-gray-50 border-b flex gap-2 items-end">
                    <input value={catForm.name} onChange={e => setCatForm({ name: e.target.value })} className="flex-1 border rounded px-3 py-1.5 text-sm" placeholder="Category name" />
                    <button onClick={() => handleCreateCategory(group.id)} className="px-3 py-1.5 bg-indigo-600 text-white rounded text-sm">Add</button>
                    <button onClick={() => setShowCatForm(null)} className="px-3 py-1.5 bg-gray-200 rounded text-sm">Cancel</button>
                  </div>
                )}

                {group.categories.length > 0 && (
                  <div className="divide-y">
                    {group.categories.map(cat => (
                      <div key={cat.id} className="flex items-center justify-between px-4 py-2.5 pl-8">
                        <span className="text-sm text-gray-700">{cat.name}</span>
                        <button onClick={() => handleDeleteCategory(cat.id)} className="text-xs text-red-500 hover:underline">Remove</button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
