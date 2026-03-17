'use client';
import { useEffect, useState } from 'react';
import { menuApi, formsApi } from '@/lib/api';
import { authAPI } from '@/lib/auth';
import MainHeader from '@/components/MainHeader';
import AdminNav from '@/components/AdminNav';

const LINK_TYPES = [
  { value: 'form', label: 'Form', color: 'bg-emerald-100 text-emerald-700' },
  { value: 'internal', label: 'Internal Page', color: 'bg-blue-100 text-blue-700' },
  { value: 'external', label: 'External URL', color: 'bg-amber-100 text-amber-700' },
];

const EMOJI_OPTIONS = [
  '📁', '📂', '📋', '📝', '📄', '📑', '📊', '📈',
  '🏠', '🏢', '🔗', '🌐', '⚙️', '🔧', '🛠️', '🔑',
  '👤', '👥', '📧', '📞', '💼', '💰', '🛒', '🎯',
  '📅', '📆', '🕐', '⏰', '🔔', '📢', '💬', '💡',
  '✅', '❌', '⭐', '🎨', '🚀', '🔒', '📦', '🗂️',
  '🏥', '🎓', '🏦', '✈️', '🍔', '🎮', '🎵', '📸',
];

const defaultGroup = { name: '', slug: '', icon: '📁', public_access: false, is_active: true };
const defaultItem = { label: '', link_type: 'internal', link_value: '', icon: '', open_in_new_tab: false, is_active: true };

export default function MenuManagerPage() {
  const user = authAPI.getUser();
  const [groups, setGroups] = useState<any[]>([]);
  const [forms, setForms] = useState<any[]>([]);
  const [expandedId, setExpandedId] = useState<number | null>(null);

  // Group modal
  const [groupModal, setGroupModal] = useState(false);
  const [editingGroup, setEditingGroup] = useState<any>(null);
  const [groupForm, setGroupForm] = useState({ ...defaultGroup });

  // Item modal
  const [itemModal, setItemModal] = useState(false);
  const [editingItem, setEditingItem] = useState<any>(null);
  const [itemForm, setItemForm] = useState({ ...defaultItem });
  const [activeGroupId, setActiveGroupId] = useState<number | null>(null);

  const load = () => menuApi.list().then(r => setGroups(r.data)).catch(() => {});
  useEffect(() => {
    load();
    formsApi.list().then(r => setForms(r.data)).catch(() => {});
  }, []);

  // ── Group CRUD ─────────────────────────────────────────────────

  const nameToSlug = (name: string) =>
    name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

  const openCreateGroup = () => {
    setEditingGroup(null);
    setGroupForm({ ...defaultGroup });
    setGroupModal(true);
  };

  const openEditGroup = (g: any) => {
    setEditingGroup(g);
    setGroupForm({ name: g.name, slug: g.slug, icon: g.icon || '📁', public_access: g.public_access, is_active: g.is_active });
    setGroupModal(true);
  };

  const saveGroup = async () => {
    if (editingGroup) {
      await menuApi.update(editingGroup.id, {
        name: groupForm.name,
        icon: groupForm.icon,
        public_access: groupForm.public_access,
        is_active: groupForm.is_active,
      });
    } else {
      await menuApi.create(groupForm);
    }
    setGroupModal(false);
    load();
  };

  const deleteGroup = async (id: number) => {
    if (!confirm('Delete this menu group and all its items?')) return;
    await menuApi.delete(id);
    if (expandedId === id) setExpandedId(null);
    load();
  };

  const moveGroup = async (idx: number, dir: -1 | 1) => {
    const newGroups = [...groups];
    const swapIdx = idx + dir;
    if (swapIdx < 0 || swapIdx >= newGroups.length) return;
    [newGroups[idx], newGroups[swapIdx]] = [newGroups[swapIdx], newGroups[idx]];
    setGroups(newGroups);
    await menuApi.reorderGroups(newGroups.map(g => g.id));
  };

  // ── Item CRUD ──────────────────────────────────────────────────

  const openCreateItem = (groupId: number) => {
    setActiveGroupId(groupId);
    setEditingItem(null);
    setItemForm({ ...defaultItem });
    setItemModal(true);
  };

  const openEditItem = (groupId: number, item: any) => {
    setActiveGroupId(groupId);
    setEditingItem(item);
    setItemForm({
      label: item.label,
      link_type: item.link_type,
      link_value: item.link_value,
      icon: item.icon || '',
      open_in_new_tab: item.open_in_new_tab,
      is_active: item.is_active,
    });
    setItemModal(true);
  };

  const saveItem = async () => {
    if (!activeGroupId) return;
    if (editingItem) {
      await menuApi.updateItem(activeGroupId, editingItem.id, itemForm);
    } else {
      await menuApi.createItem(activeGroupId, itemForm);
    }
    setItemModal(false);
    load();
  };

  const deleteItem = async (groupId: number, itemId: number) => {
    if (!confirm('Delete this menu item?')) return;
    await menuApi.deleteItem(groupId, itemId);
    load();
  };

  const moveItem = async (groupId: number, items: any[], idx: number, dir: -1 | 1) => {
    const newItems = [...items];
    const swapIdx = idx + dir;
    if (swapIdx < 0 || swapIdx >= newItems.length) return;
    [newItems[idx], newItems[swapIdx]] = [newItems[swapIdx], newItems[idx]];
    await menuApi.reorderItems(groupId, newItems.map(i => i.id));
    load();
  };

  const getLinkTypeInfo = (type: string) => LINK_TYPES.find(t => t.value === type) || LINK_TYPES[1];

  if (!user) return null;

  return (
    <div className="ml-0 md:ml-60 pt-14 min-h-screen bg-gray-50 pb-16 md:pb-0">
      <MainHeader user={user} />
      <AdminNav />
      <div className="p-6 max-w-4xl">
        <div className="flex justify-between items-center mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Menu Manager</h1>
            <p className="text-sm text-gray-500 mt-1">Organize navigation groups with links to forms, pages, and external URLs</p>
          </div>
          <button
            onClick={openCreateGroup}
            className="bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-indigo-700 transition-colors"
          >
            + New Group
          </button>
        </div>

        {/* Group List */}
        <div className="space-y-3">
          {groups.map((group, gIdx) => {
            const isExpanded = expandedId === group.id;
            const items = group.items || [];
            return (
              <div key={group.id} className="bg-white border border-gray-200 rounded-xl overflow-hidden">
                {/* Group Header */}
                <div
                  className="p-4 flex items-center gap-3 cursor-pointer hover:bg-gray-50 transition-colors"
                  onClick={() => setExpandedId(isExpanded ? null : group.id)}
                >
                  <span className="text-xl w-7 text-center flex-shrink-0">{group.icon || '📁'}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-gray-900">{group.name}</span>
                      <span className="text-xs font-mono text-gray-400 bg-gray-50 px-1.5 py-0.5 rounded">{group.slug}</span>
                      <span className="text-xs bg-indigo-50 text-indigo-600 px-2 py-0.5 rounded-full font-medium">
                        {items.length} item{items.length !== 1 ? 's' : ''}
                      </span>
                      {group.public_access && (
                        <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-medium">Public</span>
                      )}
                      {!group.is_active && (
                        <span className="text-xs bg-red-100 text-red-600 px-2 py-0.5 rounded-full font-medium">Inactive</span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0" onClick={e => e.stopPropagation()}>
                    <button
                      onClick={() => moveGroup(gIdx, -1)}
                      disabled={gIdx === 0}
                      className="p-1.5 text-gray-400 hover:text-gray-600 disabled:opacity-30 rounded hover:bg-gray-100 transition-colors"
                      title="Move up"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" /></svg>
                    </button>
                    <button
                      onClick={() => moveGroup(gIdx, 1)}
                      disabled={gIdx === groups.length - 1}
                      className="p-1.5 text-gray-400 hover:text-gray-600 disabled:opacity-30 rounded hover:bg-gray-100 transition-colors"
                      title="Move down"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                    </button>
                    <button
                      onClick={() => openEditGroup(group)}
                      className="text-sm text-indigo-600 hover:text-indigo-800 px-2.5 py-1.5 border border-indigo-200 rounded-lg hover:bg-indigo-50 transition-colors"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => deleteGroup(group.id)}
                      className="text-sm text-red-500 hover:text-red-700 px-2.5 py-1.5 border border-red-200 rounded-lg hover:bg-red-50 transition-colors"
                    >
                      Delete
                    </button>
                  </div>
                  <svg
                    className={`w-5 h-5 text-gray-400 transition-transform flex-shrink-0 ${isExpanded ? 'rotate-180' : ''}`}
                    fill="none" stroke="currentColor" viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </div>

                {/* Expanded Items */}
                {isExpanded && (
                  <div className="border-t border-gray-100 bg-gray-50/50">
                    {items.length === 0 ? (
                      <p className="text-sm text-gray-400 text-center py-6">No items yet. Add your first menu item.</p>
                    ) : (
                      <div className="divide-y divide-gray-100">
                        {items.map((item: any, iIdx: number) => {
                          const typeInfo = getLinkTypeInfo(item.link_type);
                          return (
                            <div key={item.id} className="px-5 py-3 flex items-center gap-3 hover:bg-white/80 transition-colors">
                              <span className="text-base w-6 text-center flex-shrink-0">{item.icon || '·'}</span>
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className="text-sm font-medium text-gray-800">{item.label}</span>
                                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${typeInfo.color}`}>
                                    {typeInfo.label}
                                  </span>
                                  {!item.is_active && (
                                    <span className="text-xs bg-red-100 text-red-600 px-2 py-0.5 rounded-full">Inactive</span>
                                  )}
                                  {item.open_in_new_tab && (
                                    <span className="text-xs text-gray-400">↗ new tab</span>
                                  )}
                                </div>
                                <p className="text-xs text-gray-400 font-mono truncate mt-0.5">
                                  {item.link_type === 'form' ? `/forms/${item.link_value}` : item.link_value}
                                </p>
                              </div>
                              <div className="flex items-center gap-1 flex-shrink-0">
                                <button
                                  onClick={() => moveItem(group.id, items, iIdx, -1)}
                                  disabled={iIdx === 0}
                                  className="p-1 text-gray-400 hover:text-gray-600 disabled:opacity-30 rounded hover:bg-gray-200 transition-colors"
                                >
                                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" /></svg>
                                </button>
                                <button
                                  onClick={() => moveItem(group.id, items, iIdx, 1)}
                                  disabled={iIdx === items.length - 1}
                                  className="p-1 text-gray-400 hover:text-gray-600 disabled:opacity-30 rounded hover:bg-gray-200 transition-colors"
                                >
                                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                                </button>
                                <button
                                  onClick={() => openEditItem(group.id, item)}
                                  className="text-xs text-indigo-600 hover:text-indigo-800 px-2 py-1 border border-indigo-200 rounded-lg hover:bg-indigo-50 transition-colors"
                                >
                                  Edit
                                </button>
                                <button
                                  onClick={() => deleteItem(group.id, item.id)}
                                  className="text-xs text-red-500 hover:text-red-700 px-2 py-1 border border-red-200 rounded-lg hover:bg-red-50 transition-colors"
                                >
                                  Delete
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                    <div className="px-5 py-3 border-t border-gray-100">
                      <button
                        onClick={() => openCreateItem(group.id)}
                        className="text-sm text-indigo-600 hover:text-indigo-800 font-medium flex items-center gap-1"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
                        Add Item
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
          {groups.length === 0 && (
            <div className="text-center py-16">
              <p className="text-4xl mb-3">🗂️</p>
              <p className="text-gray-500 text-sm">No menu groups yet. Click &quot;+ New Group&quot; to get started.</p>
            </div>
          )}
        </div>
      </div>

      {/* ── Group Modal ───────────────────────────────────────────── */}
      {groupModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 w-full max-w-md shadow-2xl">
            <h2 className="font-semibold text-lg mb-4">{editingGroup ? 'Edit Group' : 'New Menu Group'}</h2>

            <label className="block text-sm font-medium text-gray-700 mb-1">Name <span className="text-red-500">*</span></label>
            <input
              className="w-full border rounded-lg px-3 py-2 text-sm mb-3"
              placeholder="e.g. HR Forms"
              value={groupForm.name}
              onChange={e => {
                const name = e.target.value;
                setGroupForm(prev => ({
                  ...prev,
                  name,
                  ...(!editingGroup ? { slug: nameToSlug(name) } : {}),
                }));
              }}
            />

            {!editingGroup && (
              <>
                <label className="block text-sm font-medium text-gray-700 mb-1">Slug</label>
                <input
                  className="w-full border rounded-lg px-3 py-2 text-sm mb-3 font-mono"
                  value={groupForm.slug}
                  onChange={e => setGroupForm({ ...groupForm, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-') })}
                />
              </>
            )}

            <label className="block text-sm font-medium text-gray-700 mb-1">Icon</label>
            <div className="flex flex-wrap gap-1.5 p-2 border rounded-lg mb-4 max-h-32 overflow-y-auto bg-gray-50">
              {EMOJI_OPTIONS.map(emoji => (
                <button
                  key={emoji}
                  type="button"
                  onClick={() => setGroupForm({ ...groupForm, icon: emoji })}
                  className={`w-8 h-8 flex items-center justify-center rounded-md text-lg hover:bg-indigo-100 transition-colors ${groupForm.icon === emoji ? 'bg-indigo-200 ring-2 ring-indigo-400' : ''}`}
                >
                  {emoji}
                </button>
              ))}
            </div>

            <div className="space-y-3 mb-4">
              <label className="flex items-center justify-between cursor-pointer">
                <span className="text-sm font-medium text-gray-700">Public Access</span>
                <button
                  type="button"
                  onClick={() => setGroupForm({ ...groupForm, public_access: !groupForm.public_access })}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${groupForm.public_access ? 'bg-green-500' : 'bg-gray-300'}`}
                >
                  <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${groupForm.public_access ? 'translate-x-6' : 'translate-x-1'}`} />
                </button>
              </label>
              <p className="text-xs text-gray-400 -mt-1 ml-0.5">Visible on public portal page and chat widget</p>

              <label className="flex items-center justify-between cursor-pointer">
                <span className="text-sm font-medium text-gray-700">Active</span>
                <button
                  type="button"
                  onClick={() => setGroupForm({ ...groupForm, is_active: !groupForm.is_active })}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${groupForm.is_active ? 'bg-blue-600' : 'bg-gray-300'}`}
                >
                  <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${groupForm.is_active ? 'translate-x-6' : 'translate-x-1'}`} />
                </button>
              </label>
            </div>

            <div className="flex gap-3">
              <button onClick={() => setGroupModal(false)} className="flex-1 border rounded-lg px-4 py-2 text-sm">Cancel</button>
              <button
                onClick={saveGroup}
                disabled={!groupForm.name || (!editingGroup && !groupForm.slug)}
                className="flex-1 bg-indigo-600 text-white rounded-lg px-4 py-2 text-sm disabled:opacity-50 hover:bg-indigo-700 transition-colors"
              >
                {editingGroup ? 'Save' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Item Modal ────────────────────────────────────────────── */}
      {itemModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 w-full max-w-md shadow-2xl">
            <h2 className="font-semibold text-lg mb-4">{editingItem ? 'Edit Item' : 'Add Menu Item'}</h2>

            <label className="block text-sm font-medium text-gray-700 mb-1">Label <span className="text-red-500">*</span></label>
            <input
              className="w-full border rounded-lg px-3 py-2 text-sm mb-3"
              placeholder="e.g. Leave Request Form"
              value={itemForm.label}
              onChange={e => setItemForm({ ...itemForm, label: e.target.value })}
            />

            <label className="block text-sm font-medium text-gray-700 mb-1">Icon (optional)</label>
            <div className="flex flex-wrap gap-1.5 p-2 border rounded-lg mb-3 max-h-28 overflow-y-auto bg-gray-50">
              <button
                type="button"
                onClick={() => setItemForm({ ...itemForm, icon: '' })}
                className={`w-8 h-8 flex items-center justify-center rounded-md text-xs hover:bg-gray-200 transition-colors border border-dashed border-gray-300 ${!itemForm.icon ? 'bg-gray-200 ring-2 ring-gray-400' : ''}`}
                title="No icon"
              >
                --
              </button>
              {EMOJI_OPTIONS.map(emoji => (
                <button
                  key={emoji}
                  type="button"
                  onClick={() => setItemForm({ ...itemForm, icon: emoji })}
                  className={`w-8 h-8 flex items-center justify-center rounded-md text-lg hover:bg-indigo-100 transition-colors ${itemForm.icon === emoji ? 'bg-indigo-200 ring-2 ring-indigo-400' : ''}`}
                >
                  {emoji}
                </button>
              ))}
            </div>

            <label className="block text-sm font-medium text-gray-700 mb-1">Link Type</label>
            <select
              className="w-full border rounded-lg px-3 py-2 text-sm mb-3 bg-white"
              value={itemForm.link_type}
              onChange={e => setItemForm({ ...itemForm, link_type: e.target.value, link_value: '' })}
            >
              {LINK_TYPES.map(t => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>

            <label className="block text-sm font-medium text-gray-700 mb-1">
              {itemForm.link_type === 'form' ? 'Select Form' : itemForm.link_type === 'internal' ? 'Internal Path' : 'External URL'}
            </label>
            {itemForm.link_type === 'form' ? (
              <select
                className="w-full border rounded-lg px-3 py-2 text-sm mb-3 bg-white"
                value={itemForm.link_value}
                onChange={e => setItemForm({ ...itemForm, link_value: e.target.value })}
              >
                <option value="">Choose a form...</option>
                {forms.filter((f: any) => f.is_published).map((f: any) => (
                  <option key={f.id} value={f.slug}>{f.title} ({f.slug})</option>
                ))}
              </select>
            ) : (
              <input
                className="w-full border rounded-lg px-3 py-2 text-sm mb-3 font-mono"
                placeholder={itemForm.link_type === 'internal' ? '/dashboard' : 'https://example.com'}
                value={itemForm.link_value}
                onChange={e => setItemForm({ ...itemForm, link_value: e.target.value })}
              />
            )}

            <div className="space-y-3 mb-4">
              <label className="flex items-center justify-between cursor-pointer">
                <span className="text-sm font-medium text-gray-700">Open in new tab</span>
                <button
                  type="button"
                  onClick={() => setItemForm({ ...itemForm, open_in_new_tab: !itemForm.open_in_new_tab })}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${itemForm.open_in_new_tab ? 'bg-blue-600' : 'bg-gray-300'}`}
                >
                  <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${itemForm.open_in_new_tab ? 'translate-x-6' : 'translate-x-1'}`} />
                </button>
              </label>
              <label className="flex items-center justify-between cursor-pointer">
                <span className="text-sm font-medium text-gray-700">Active</span>
                <button
                  type="button"
                  onClick={() => setItemForm({ ...itemForm, is_active: !itemForm.is_active })}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${itemForm.is_active ? 'bg-blue-600' : 'bg-gray-300'}`}
                >
                  <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${itemForm.is_active ? 'translate-x-6' : 'translate-x-1'}`} />
                </button>
              </label>
            </div>

            <div className="flex gap-3">
              <button onClick={() => setItemModal(false)} className="flex-1 border rounded-lg px-4 py-2 text-sm">Cancel</button>
              <button
                onClick={saveItem}
                disabled={!itemForm.label || !itemForm.link_value}
                className="flex-1 bg-indigo-600 text-white rounded-lg px-4 py-2 text-sm disabled:opacity-50 hover:bg-indigo-700 transition-colors"
              >
                {editingItem ? 'Save' : 'Add Item'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
