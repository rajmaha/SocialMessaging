'use client';
import { useEffect, useState, useMemo } from 'react';
import { rolesApi } from '@/lib/api';
import { authAPI } from '@/lib/auth';
import MainHeader from '@/components/MainHeader';
import AdminNav from '@/components/AdminNav';

// ── Module categories for grouping the permission matrix ───────────────────
const MODULE_CATEGORIES = [
  {
    label: 'Communication',
    keys: ['email', 'messaging', 'callcenter', 'livechat'],
  },
  {
    label: 'Business',
    keys: ['crm', 'tickets', 'pms', 'campaigns', 'reports', 'kb', 'teams'],
  },
  {
    label: 'Administration',
    keys: [
      'manage_users', 'manage_teams', 'manage_email_accounts', 'manage_messenger_config',
      'manage_telephony', 'manage_extensions', 'manage_branding', 'manage_roles',
      'manage_cors', 'manage_bot', 'manage_cloudpanel', 'manage_dynamic_fields',
      'manage_ssl', 'manage_billing', 'manage_forms', 'manage_menus',
    ],
  },
  {
    label: 'Modules',
    keys: ['organizations', 'contacts', 'subscriptions', 'calls', 'reminders', 'notifications', 'individuals'],
  },
];

interface RegistryModule {
  label: string;
  actions: string[];
}

type Registry = Record<string, RegistryModule>;
type Permissions = Record<string, string[]>;

interface Role {
  id: number;
  name: string;
  slug: string;
  is_system: boolean;
  permissions: Permissions;
  created_at: string;
}

interface CategoryGroup {
  label: string;
  modules: { key: string; info: RegistryModule }[];
  allActions: string[];
}

/** Build categorised groups from registry, including a dynamic "Custom Menus" bucket */
function buildCategoryGroups(registry: Registry): CategoryGroup[] {
  const groups: CategoryGroup[] = [];
  const assigned = new Set<string>();

  for (const cat of MODULE_CATEGORIES) {
    const modules: { key: string; info: RegistryModule }[] = [];
    for (const key of cat.keys) {
      if (registry[key]) {
        modules.push({ key, info: registry[key] });
        assigned.add(key);
      }
    }
    if (modules.length > 0) {
      const allActions = Array.from(new Set(modules.flatMap(m => m.info.actions)));
      groups.push({ label: cat.label, modules, allActions });
    }
  }

  // Custom Menus: any key starting with "menu_"
  const menuModules: { key: string; info: RegistryModule }[] = [];
  for (const key of Object.keys(registry)) {
    if (key.startsWith('menu_') && !assigned.has(key)) {
      menuModules.push({ key, info: registry[key] });
      assigned.add(key);
    }
  }
  if (menuModules.length > 0) {
    const allActions = Array.from(new Set(menuModules.flatMap(m => m.info.actions)));
    groups.push({ label: 'Custom Menus', modules: menuModules, allActions });
  }

  // Catch-all for any remaining keys
  const remaining: { key: string; info: RegistryModule }[] = [];
  for (const key of Object.keys(registry)) {
    if (!assigned.has(key)) {
      remaining.push({ key, info: registry[key] });
    }
  }
  if (remaining.length > 0) {
    const allActions = Array.from(new Set(remaining.flatMap(m => m.info.actions)));
    groups.push({ label: 'Other', modules: remaining, allActions });
  }

  return groups;
}

/** Count how many modules have at least one permission set */
function countEnabledModules(permissions: Permissions): number {
  return Object.keys(permissions).filter(k => permissions[k] && permissions[k].length > 0).length;
}

// ── Permission Matrix component ────────────────────────────────────────────
function PermissionMatrix({
  groups,
  permissions,
  onChange,
}: {
  groups: CategoryGroup[];
  permissions: Permissions;
  onChange: (p: Permissions) => void;
}) {
  const toggleAction = (moduleKey: string, action: string) => {
    const current = permissions[moduleKey] || [];
    let next: string[];
    if (current.includes(action)) {
      next = current.filter(a => a !== action);
    } else {
      next = [...current, action];
    }
    const updated = { ...permissions };
    if (next.length === 0) {
      delete updated[moduleKey];
    } else {
      updated[moduleKey] = next;
    }
    onChange(updated);
  };

  const selectAll = (moduleKey: string, allActions: string[]) => {
    onChange({ ...permissions, [moduleKey]: [...allActions] });
  };

  const clearAll = (moduleKey: string) => {
    const updated = { ...permissions };
    delete updated[moduleKey];
    onChange(updated);
  };

  return (
    <div className="space-y-6">
      {groups.map(group => (
        <div key={group.label}>
          {/* Category header */}
          <div className="flex items-center gap-2 mb-2">
            <span className="text-xs font-bold uppercase tracking-wide text-gray-500">{group.label}</span>
            <div className="flex-1 border-t border-gray-200" />
          </div>

          {/* Column headers */}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-gray-400 uppercase tracking-wide">
                  <th className="text-left py-1.5 pr-4 font-medium w-48 min-w-[180px]">Module</th>
                  {group.allActions.map(action => (
                    <th key={action} className="text-center py-1.5 px-2 font-medium min-w-[60px]">{action}</th>
                  ))}
                  <th className="text-center py-1.5 px-2 font-medium min-w-[50px]">All</th>
                </tr>
              </thead>
              <tbody>
                {group.modules.map(mod => {
                  const currentActions = permissions[mod.key] || [];
                  const allSelected = mod.info.actions.length > 0 && mod.info.actions.every(a => currentActions.includes(a));
                  return (
                    <tr key={mod.key} className="border-t border-gray-100 hover:bg-gray-50 transition-colors">
                      <td className="py-2 pr-4 text-gray-700 font-medium">{mod.info.label}</td>
                      {group.allActions.map(action => {
                        const isValid = mod.info.actions.includes(action);
                        if (!isValid) {
                          return <td key={action} className="text-center py-2 px-2"><span className="text-gray-200">-</span></td>;
                        }
                        const isChecked = currentActions.includes(action);
                        return (
                          <td key={action} className="text-center py-2 px-2">
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={() => toggleAction(mod.key, action)}
                              className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                            />
                          </td>
                        );
                      })}
                      <td className="text-center py-2 px-2">
                        <button
                          onClick={() => allSelected ? clearAll(mod.key) : selectAll(mod.key, mod.info.actions)}
                          className={`text-xs px-2 py-0.5 rounded font-medium transition-colors ${
                            allSelected
                              ? 'bg-indigo-100 text-indigo-700 hover:bg-indigo-200'
                              : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                          }`}
                          title={allSelected ? 'Clear all' : 'Select all'}
                        >
                          {allSelected ? 'Clear' : 'All'}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────
export default function RolesPage() {
  const user = authAPI.getUser();
  const [roles, setRoles] = useState<Role[]>([]);
  const [registry, setRegistry] = useState<Registry>({});
  const [loading, setLoading] = useState(true);

  // Modal state
  const [showCreate, setShowCreate] = useState(false);
  const [editing, setEditing] = useState<Role | null>(null);

  // Create form state
  const [createName, setCreateName] = useState('');
  const [createSlug, setCreateSlug] = useState('');
  const [createPermissions, setCreatePermissions] = useState<Permissions>({});

  // Edit form state
  const [editName, setEditName] = useState('');
  const [editPermissions, setEditPermissions] = useState<Permissions>({});

  const load = async () => {
    try {
      const [regRes, rolesRes] = await Promise.all([rolesApi.registry(), rolesApi.list()]);
      setRegistry(regRes.data);
      setRoles(rolesRes.data);
    } catch (err) {
      console.error('Failed to load roles data', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const categoryGroups = useMemo(() => buildCategoryGroups(registry), [registry]);

  // ── Create handlers ──
  const openCreate = () => {
    setCreateName('');
    setCreateSlug('');
    setCreatePermissions({});
    setShowCreate(true);
  };

  const handleCreate = async () => {
    await rolesApi.create({ name: createName, slug: createSlug, permissions: createPermissions });
    setShowCreate(false);
    load();
  };

  // ── Edit handlers ──
  const openEdit = (role: Role) => {
    setEditing(role);
    setEditName(role.name);
    setEditPermissions(role.permissions ? { ...role.permissions } : {});
  };

  const handleUpdate = async () => {
    if (!editing) return;
    await rolesApi.update(editing.id, { name: editing.is_system ? undefined : editName, permissions: editPermissions });
    setEditing(null);
    load();
  };

  // ── Delete handler ──
  const handleDelete = async (id: number) => {
    if (!confirm('Delete this role? Users with this role will be set to Viewer.')) return;
    await rolesApi.delete(id);
    load();
  };

  if (!user) return null;

  return (
    <div className="ml-60 pt-14 min-h-screen bg-gray-50">
      <MainHeader user={user} />
      <AdminNav />
      <div className="p-6 max-w-5xl">
        {/* Header */}
        <div className="flex justify-between items-center mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Roles</h1>
            <p className="text-sm text-gray-500 mt-1">
              Manage roles and fine-grained permissions with the module permission matrix.
            </p>
          </div>
          <button
            onClick={openCreate}
            className="bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-indigo-700 transition-colors"
          >
            + New Role
          </button>
        </div>

        {/* Role cards */}
        {loading ? (
          <p className="text-gray-400 text-sm py-10 text-center">Loading roles...</p>
        ) : (
          <div className="space-y-3">
            {roles.map(role => {
              const enabledCount = countEnabledModules(role.permissions || {});
              const totalModules = Object.keys(registry).length;
              return (
                <div key={role.id} className="bg-white border border-gray-200 rounded-xl p-4 flex items-start gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                      <span className="font-semibold text-gray-900">{role.name}</span>
                      {role.is_system && (
                        <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full flex items-center gap-1">
                          System
                        </span>
                      )}
                      <span className="text-xs text-gray-400 font-mono bg-gray-50 px-1.5 py-0.5 rounded">{role.slug}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-gray-500">
                        {enabledCount} of {totalModules} modules enabled
                      </span>
                      {enabledCount > 0 && (
                        <div className="flex-1 max-w-[200px] bg-gray-100 rounded-full h-1.5">
                          <div
                            className="bg-indigo-500 h-1.5 rounded-full transition-all"
                            style={{ width: `${Math.round((enabledCount / Math.max(totalModules, 1)) * 100)}%` }}
                          />
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="flex gap-2 flex-none">
                    <button
                      onClick={() => openEdit(role)}
                      className="text-sm text-indigo-600 hover:text-indigo-800 px-3 py-1.5 border border-indigo-200 rounded-lg hover:bg-indigo-50 transition-colors"
                    >
                      Edit
                    </button>
                    {!role.is_system && (
                      <button
                        onClick={() => handleDelete(role.id)}
                        className="text-sm text-red-500 hover:text-red-700 px-3 py-1.5 border border-red-200 rounded-lg hover:bg-red-50 transition-colors"
                      >
                        Delete
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
            {roles.length === 0 && (
              <p className="text-gray-400 text-sm py-10 text-center">No roles found.</p>
            )}
          </div>
        )}
      </div>

      {/* ── Create Modal ── */}
      {showCreate && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col">
            {/* Modal header */}
            <div className="px-6 pt-6 pb-4 border-b border-gray-100">
              <h2 className="font-semibold text-lg text-gray-900">New Role</h2>
              <p className="text-sm text-gray-500 mt-1">Define a name, slug, and assign module permissions.</p>
            </div>

            {/* Scrollable body */}
            <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Name</label>
                  <input
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none"
                    placeholder="e.g. Freelancer"
                    value={createName}
                    onChange={e => setCreateName(e.target.value)}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Slug</label>
                  <input
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none"
                    placeholder="e.g. freelancer"
                    value={createSlug}
                    onChange={e => setCreateSlug(e.target.value.toLowerCase().replace(/\s+/g, '_'))}
                  />
                </div>
              </div>

              <div>
                <p className="text-xs font-bold text-gray-600 mb-3 uppercase tracking-wide">Permission Matrix</p>
                <PermissionMatrix
                  groups={categoryGroups}
                  permissions={createPermissions}
                  onChange={setCreatePermissions}
                />
              </div>
            </div>

            {/* Footer */}
            <div className="px-6 py-4 border-t border-gray-100 flex gap-3">
              <button
                onClick={() => setShowCreate(false)}
                className="flex-1 border border-gray-300 rounded-lg px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleCreate}
                disabled={!createName || !createSlug}
                className="flex-1 bg-indigo-600 text-white rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50 hover:bg-indigo-700 transition-colors"
              >
                Create Role
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Edit Modal ── */}
      {editing && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col">
            {/* Modal header */}
            <div className="px-6 pt-6 pb-4 border-b border-gray-100">
              <h2 className="font-semibold text-lg text-gray-900">
                Edit Role
                {editing.is_system && (
                  <span className="text-xs text-gray-400 font-normal ml-2">(System -- name locked)</span>
                )}
              </h2>
              <p className="text-sm text-gray-500 mt-1">Update permissions for &ldquo;{editing.name}&rdquo;.</p>
            </div>

            {/* Scrollable body */}
            <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Name</label>
                <input
                  className={`w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none ${
                    editing.is_system ? 'bg-gray-100 text-gray-500 cursor-not-allowed' : ''
                  }`}
                  value={editName}
                  disabled={editing.is_system}
                  onChange={e => setEditName(e.target.value)}
                />
              </div>

              <div>
                <p className="text-xs font-bold text-gray-600 mb-3 uppercase tracking-wide">Permission Matrix</p>
                <PermissionMatrix
                  groups={categoryGroups}
                  permissions={editPermissions}
                  onChange={setEditPermissions}
                />
              </div>
            </div>

            {/* Footer */}
            <div className="px-6 py-4 border-t border-gray-100 flex gap-3">
              <button
                onClick={() => setEditing(null)}
                className="flex-1 border border-gray-300 rounded-lg px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleUpdate}
                className="flex-1 bg-indigo-600 text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-indigo-700 transition-colors"
              >
                Save Changes
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
