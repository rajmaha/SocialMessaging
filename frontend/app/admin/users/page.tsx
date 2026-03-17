'use client';

import { useState, useEffect } from 'react';
import MainHeader from "@/components/MainHeader";
import { authAPI } from "@/lib/auth";
import { useRouter } from 'next/navigation';
import { getAuthToken } from '@/lib/auth';
import AdminNav from '@/components/AdminNav';
import { API_URL } from '@/lib/config';
import { rolesApi, permissionOverrideApi } from '@/lib/api';

interface User {
  id: number;
  username: string;
  email: string;
  full_name: string;
  display_name?: string;
  role: string;
  is_active: boolean;
  created_at: string;
}

interface RegistryModule {
  key: string;
  label: string;
  actions: string[];
}

interface PermissionOverride {
  id: number;
  user_id: number;
  module_key: string;
  granted_actions: string[];
  revoked_actions: string[];
}

export default function AdminUsers() {
  const user = authAPI.getUser();
  const router = useRouter();
  const [users, setUsers] = useState<User[]>([]);
  const [roles, setRoles] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [editingUserId, setEditingUserId] = useState<number | null>(null);
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editFormData, setEditFormData] = useState({
    full_name: '',
    display_name: '',
    email: '',
    role: 'user',
    is_active: true
  });

  // Permission overrides state
  const [overridesExpanded, setOverridesExpanded] = useState(false);
  const [registry, setRegistry] = useState<RegistryModule[]>([]);
  const [existingOverrides, setExistingOverrides] = useState<PermissionOverride[]>([]);
  const [overrideEdits, setOverrideEdits] = useState<Record<string, { granted: string[]; revoked: string[] }>>({});
  const [overridesSaving, setOverridesSaving] = useState(false);

  // Account access state
  const [accountAccessExpanded, setAccountAccessExpanded] = useState(false);
  const [allPlatformAccounts, setAllPlatformAccounts] = useState<any[]>([]);
  const [userAccountIds, setUserAccountIds] = useState<number[]>([]);
  const [accountAccessLoading, setAccountAccessLoading] = useState(false);

  // Sorting & pagination
  const [sortField, setSortField] = useState<'name' | 'email' | 'role' | 'status'>('name');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [currentPage, setCurrentPage] = useState(1);
  const PAGE_SIZE = 10;

  // Form state
  const [formData, setFormData] = useState({
    username: '',
    email: '',
    password: '',
    full_name: '',
    display_name: '',
    role: 'user'
  });

  useEffect(() => {
    fetchUsers();
    rolesApi.list().then(r => setRoles(r.data));
  }, []);

  const fetchUsers = async () => {
    try {
      const token = getAuthToken();
      if (!token) {
        router.push('/login');
        return;
      }
      const response = await fetch(`${API_URL}/admin/users`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });
      if (response.status === 403) {
        router.push('/dashboard');
        return;
      }
      if (!response.ok) {
        throw new Error('Failed to fetch users');
      }
      const data = await response.json();
      setUsers(data);
      setCurrentPage(1);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setLoading(false);
    }
  };

  // Modal edit handlers
  const handleEditClick = async (u: User) => {
    setEditingUserId(u.id);
    setEditFormData({
      full_name: u.full_name,
      display_name: u.display_name || '',
      email: u.email,
      role: u.role,
      is_active: u.is_active
    });
    setOverridesExpanded(false);
    setOverrideEdits({});
    setAccountAccessExpanded(false);
    setUserAccountIds([]);
    setAllPlatformAccounts([]);
    setEditModalOpen(true);

    // Fetch registry, overrides, and platform accounts in parallel
    const token = getAuthToken();
    try {
      const [registryRes, overridesRes, allAccountsRes, userAccountsRes] = await Promise.all([
        rolesApi.registry(),
        permissionOverrideApi.list(u.id),
        fetch(`${API_URL}/admin/platform-accounts`, {
          headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }
        }),
        fetch(`${API_URL}/admin/platform-accounts/user/${u.id}/accounts`, {
          headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }
        })
      ]);
      const rawRegistry = registryRes.data;
      setRegistry(
        Array.isArray(rawRegistry)
          ? rawRegistry
          : Object.entries(rawRegistry).map(([key, val]: [string, any]) => ({ key, label: val.label, actions: val.actions }))
      );
      const overrides: PermissionOverride[] = overridesRes.data;
      setExistingOverrides(overrides);

      // Initialize override edits from existing data
      const edits: Record<string, { granted: string[]; revoked: string[] }> = {};
      overrides.forEach((o: PermissionOverride) => {
        edits[o.module_key] = {
          granted: [...o.granted_actions],
          revoked: [...o.revoked_actions]
        };
      });
      setOverrideEdits(edits);

      // Platform account access
      if (allAccountsRes.ok) {
        const allAccounts = await allAccountsRes.json();
        setAllPlatformAccounts(allAccounts);
      }
      if (userAccountsRes.ok) {
        const userAccounts = await userAccountsRes.json();
        setUserAccountIds(userAccounts.map((a: any) => a.id));
      }
    } catch (err) {
      console.error('Failed to fetch permission data:', err);
    }
  };

  const handleEditChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value, type } = e.target;
    let checked = false;
    if (type === 'checkbox') {
      checked = (e.target as HTMLInputElement).checked;
    }
    setEditFormData((prev) => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : value
    }));
  };

  const handleEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingUserId) return;
    try {
      const token = getAuthToken();
      if (!token) {
        setError('Not authenticated');
        return;
      }
      const response = await fetch(`${API_URL}/admin/users/${editingUserId}`, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(editFormData)
      });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.detail || 'Failed to update user');
      }

      // Save permission overrides if the section was opened
      if (overridesExpanded) {
        await saveOverrides();
      }

      // Save account access if the section was opened
      if (accountAccessExpanded) {
        await saveAccountAccess();
      }

      setEditModalOpen(false);
      setEditingUserId(null);
      await fetchUsers();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    }
  };

  const saveOverrides = async () => {
    if (!editingUserId) return;
    setOverridesSaving(true);
    try {
      // Delete all existing overrides for this user
      for (const o of existingOverrides) {
        await permissionOverrideApi.delete(o.id);
      }
      // Create new overrides for modules that have content
      for (const [moduleKey, actions] of Object.entries(overrideEdits)) {
        if (actions.granted.length > 0 || actions.revoked.length > 0) {
          await permissionOverrideApi.create({
            user_id: editingUserId,
            module_key: moduleKey,
            granted_actions: actions.granted,
            revoked_actions: actions.revoked
          });
        }
      }
      // Refresh overrides
      const res = await permissionOverrideApi.list(editingUserId);
      setExistingOverrides(res.data);
    } catch (err) {
      console.error('Failed to save overrides:', err);
      setError('Failed to save permission overrides');
    } finally {
      setOverridesSaving(false);
    }
  };

  const handleEditModalClose = () => {
    setEditModalOpen(false);
    setEditingUserId(null);
    setOverridesExpanded(false);
    setOverrideEdits({});
    setAccountAccessExpanded(false);
    setUserAccountIds([]);
  };

  // Toggle a platform account checkbox
  const toggleAccountAccess = (accountId: number) => {
    setUserAccountIds(prev =>
      prev.includes(accountId)
        ? prev.filter(id => id !== accountId)
        : [...prev, accountId]
    );
  };

  // Save account access assignments
  const saveAccountAccess = async () => {
    if (!editingUserId) return;
    const token = getAuthToken();
    try {
      await fetch(`${API_URL}/admin/platform-accounts/user/${editingUserId}/accounts`, {
        method: 'PUT',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ platform_account_ids: userAccountIds })
      });
    } catch (err) {
      console.error('Failed to save account access:', err);
      setError('Failed to save account access');
    }
  };

  // Group platform accounts by platform
  const groupAccountsByPlatform = (accounts: any[]): Record<string, any[]> => {
    return accounts.reduce((groups: Record<string, any[]>, account: any) => {
      const platform = account.platform || 'unknown';
      if (!groups[platform]) groups[platform] = [];
      groups[platform].push(account);
      return groups;
    }, {});
  };

  const platformColors: Record<string, string> = {
    facebook: 'bg-blue-100 text-blue-800',
    whatsapp: 'bg-green-100 text-green-800',
    viber: 'bg-purple-100 text-purple-800',
    linkedin: 'bg-sky-100 text-sky-800',
  };

  // Get role actions for a module
  const getRoleActionsForModule = (roleSlug: string, moduleKey: string): string[] => {
    const role = roles.find((r: any) => r.slug === roleSlug);
    if (!role || !role.permissions) return [];
    return role.permissions[moduleKey] || [];
  };

  // Toggle a granted action for a module
  const toggleGrantedAction = (moduleKey: string, action: string) => {
    setOverrideEdits(prev => {
      const current = prev[moduleKey] || { granted: [], revoked: [] };
      const granted = current.granted.includes(action)
        ? current.granted.filter(a => a !== action)
        : [...current.granted, action];
      return { ...prev, [moduleKey]: { ...current, granted } };
    });
  };

  // Toggle a revoked action for a module
  const toggleRevokedAction = (moduleKey: string, action: string) => {
    setOverrideEdits(prev => {
      const current = prev[moduleKey] || { granted: [], revoked: [] };
      const revoked = current.revoked.includes(action)
        ? current.revoked.filter(a => a !== action)
        : [...current.revoked, action];
      return { ...prev, [moduleKey]: { ...current, revoked } };
    });
  };

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const token = getAuthToken();
      if (!token) {
        setError('Not authenticated');
        return;
      }
      const response = await fetch(`${API_URL}/admin/users`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(formData)
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.detail || 'Failed to create user');
      }

      setFormData({
        username: '',
        email: '',
        password: '',
        full_name: '',
        display_name: '',
        role: 'user'
      });
      setShowCreateForm(false);
      await fetchUsers();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    }
  };

  const handleRoleChange = async (userId: number, newRole: string) => {
    try {
      const token = getAuthToken();
      if (!token) return;
      await fetch(`${API_URL}/admin/users/${userId}`, {
        method: 'PUT',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: newRole })
      });
      await fetchUsers();
    } catch (err) {
      console.error('Failed to change role:', err);
    }
  };

  const handleDeactivateUser = async (userId: number) => {
    if (!confirm('Are you sure you want to deactivate this user?')) {
      return;
    }

    try {
      const token = getAuthToken();
      if (!token) {
        setError('Not authenticated');
        return;
      }
      const response = await fetch(`${API_URL}/admin/users/${userId}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        throw new Error('Failed to deactivate user');
      }

      await fetchUsers();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    }
  };

  const handleSort = (field: 'name' | 'email' | 'role' | 'status') => {
    if (sortField === field) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDir('asc');
    }
    setCurrentPage(1);
  };

  const sortedUsers = [...users].sort((a, b) => {
    let aVal = '';
    let bVal = '';
    if (sortField === 'name') { aVal = a.full_name; bVal = b.full_name; }
    else if (sortField === 'email') { aVal = a.email; bVal = b.email; }
    else if (sortField === 'role') { aVal = a.role; bVal = b.role; }
    else if (sortField === 'status') { aVal = a.is_active ? 'active' : 'inactive'; bVal = b.is_active ? 'active' : 'inactive'; }
    return sortDir === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
  });

  const totalPages = Math.max(1, Math.ceil(sortedUsers.length / PAGE_SIZE));
  const pagedUsers = sortedUsers.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500"></div>
      </div>
    );
  }

  return (
    <div className="ml-0 md:ml-60 pt-14 min-h-screen bg-gray-100 pb-16 md:pb-0">
      <MainHeader user={user!} />
      <AdminNav />
      <main className="w-full p-6">
        <div className="mb-8 flex flex-wrap gap-4 justify-between items-center">
          <div>
            <h2 className="text-3xl font-bold text-gray-900">User Management</h2>
            <p className="text-gray-600 mt-2">Create and manage system users</p>
          </div>
          <button
            onClick={() => setShowCreateForm(!showCreateForm)}
            className="text-white font-semibold py-2 px-4 rounded-lg transition"
            style={{ backgroundColor: 'var(--button-primary)' }}
          >
            {showCreateForm ? 'Cancel' : 'Create User'}
          </button>
        </div>
        {error && (
          <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-6">{error}</div>
        )}
        {showCreateForm && (
          <div className="bg-white rounded-lg shadow p-6 mb-8">
            <h3 className="text-xl font-bold text-gray-900 mb-6">Create New User</h3>
            <form onSubmit={handleCreateUser}>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <label className="block text-gray-700 text-sm font-bold mb-2">Full Name</label>
                  <input type="text" required value={formData.full_name} onChange={(e) => setFormData({ ...formData, full_name: e.target.value })} className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:border-blue-500" placeholder="John Doe" />
                </div>
                <div>
                  <label className="block text-gray-700 text-sm font-bold mb-2">Chat Nickname <span className="font-normal text-gray-400">(shown to visitors)</span></label>
                  <input type="text" value={formData.display_name} onChange={(e) => setFormData({ ...formData, display_name: e.target.value })} className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:border-blue-500" placeholder="e.g. Alex (optional)" />
                </div>
                <div>
                  <label className="block text-gray-700 text-sm font-bold mb-2">Username</label>
                  <input type="text" required value={formData.username} onChange={(e) => setFormData({ ...formData, username: e.target.value })} className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:border-blue-500" placeholder="john_doe" />
                </div>
                <div>
                  <label className="block text-gray-700 text-sm font-bold mb-2">Email</label>
                  <input type="email" required value={formData.email} onChange={(e) => setFormData({ ...formData, email: e.target.value })} className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:border-blue-500" placeholder="john@example.com" />
                </div>
                <div>
                  <label className="block text-gray-700 text-sm font-bold mb-2">Password</label>
                  <input type="password" required value={formData.password} onChange={(e) => setFormData({ ...formData, password: e.target.value })} className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:border-blue-500" placeholder="••••••••" />
                </div>
                <div>
                  <label className="block text-gray-700 text-sm font-bold mb-2">Role</label>
                  <select value={formData.role} onChange={(e) => setFormData({ ...formData, role: e.target.value })} className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:border-blue-500">
                    {roles.map(r => (
                      <option key={r.id} value={r.slug}>{r.name}</option>
                    ))}
                  </select>
                </div>
              </div>
              <button type="submit" className="bg-green-500 hover:bg-green-600 text-white font-semibold py-2 px-6 rounded-lg transition mt-6">Create User</button>
            </form>
          </div>
        )}
        <div className="bg-white rounded-lg shadow">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  {(['name', 'email', 'role', 'status'] as const).map(field => (
                    <th
                      key={field}
                      onClick={() => handleSort(field)}
                      className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer select-none hover:bg-gray-100"
                    >
                      <span className="flex items-center gap-1">
                        {field.charAt(0).toUpperCase() + field.slice(1)}
                        <span className="text-gray-400">
                          {sortField === field ? (sortDir === 'asc' ? '↑' : '↓') : '↕'}
                        </span>
                      </span>
                    </th>
                  ))}
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Created</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {pagedUsers.map((user) => (
                  <tr key={user.id}>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div>
                        <p className="text-sm font-medium text-gray-900">{user.full_name}</p>
                        {user.display_name && (
                          <p className="text-xs" style={{ color: 'var(--primary-color)' }}>nickname: {user.display_name}</p>
                        )}
                        <p className="text-sm text-gray-500">@{user.username}</p>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{user.email}</td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <select
                        value={user.role || 'support'}
                        onChange={e => handleRoleChange(user.id, e.target.value)}
                        className="text-xs border rounded-lg px-2 py-1 bg-white text-gray-700 cursor-pointer hover:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                      >
                        {roles.map((r: any) => (
                          <option key={r.slug} value={r.slug}>{r.name}</option>
                        ))}
                      </select>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${user.is_active ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>{user.is_active ? 'Active' : 'Inactive'}</span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{new Date(user.created_at).toLocaleDateString()}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                      <button onClick={() => handleEditClick(user)} className="hover:opacity-80 mr-2" style={{ color: 'var(--primary-color)' }}>Edit</button>
                      {user.is_active && (
                        <button onClick={() => handleDeactivateUser(user.id)} className="text-red-600 hover:text-red-900">Deactivate</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        {users.length === 0 && (
          <div className="bg-white rounded-lg shadow p-12 text-center">
            <p className="text-gray-600">No users found. Create your first user to get started.</p>
          </div>
        )}
        {users.length > 0 && (
          <div className="mt-4 flex items-center justify-between text-sm text-gray-600">
            <span>
              Showing {Math.min((currentPage - 1) * PAGE_SIZE + 1, users.length)}–{Math.min(currentPage * PAGE_SIZE, users.length)} of {users.length}
            </span>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                disabled={currentPage === 1}
                className="px-3 py-1 rounded border border-gray-300 bg-white hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Prev
              </button>
              {Array.from({ length: totalPages }, (_, i) => i + 1).map(page => (
                <button
                  key={page}
                  onClick={() => setCurrentPage(page)}
                  className={`px-3 py-1 rounded border ${currentPage === page ? 'border-blue-500 bg-blue-500 text-white' : 'border-gray-300 bg-white hover:bg-gray-50'}`}
                >
                  {page}
                </button>
              ))}
              <button
                onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                disabled={currentPage === totalPages}
                className="px-3 py-1 rounded border border-gray-300 bg-white hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Next
              </button>
            </div>
          </div>
        )}
        {editModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-40">
            <div className="bg-white rounded-lg shadow-lg w-full max-w-4xl relative max-h-[90vh] flex flex-col">
              <div className="flex items-center justify-between p-6 pb-0">
                <h3 className="text-xl font-bold text-gray-900">Edit User</h3>
                <button onClick={handleEditModalClose} className="text-gray-500 hover:text-gray-700" aria-label="Close">
                  <span className="text-2xl">&times;</span>
                </button>
              </div>
              <div className="overflow-y-auto flex-1 p-6 pt-4">
                <form onSubmit={handleEditSubmit} id="editUserForm">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-gray-700 text-sm font-bold mb-2">Full Name</label>
                      <input type="text" name="full_name" value={editFormData.full_name} onChange={handleEditChange} className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:border-blue-500" required />
                    </div>
                    <div>
                      <label className="block text-gray-700 text-sm font-bold mb-2">Chat Nickname <span className="font-normal text-gray-400">(shown to visitors)</span></label>
                      <input type="text" name="display_name" value={editFormData.display_name} onChange={handleEditChange} className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:border-blue-500" placeholder="e.g. Alex (optional — leave blank to use real name)" />
                    </div>
                    <div>
                      <label className="block text-gray-700 text-sm font-bold mb-2">Email</label>
                      <input type="email" name="email" value={editFormData.email} onChange={handleEditChange} className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:border-blue-500" required />
                    </div>
                    <div>
                      <label className="block text-gray-700 text-sm font-bold mb-2">Role</label>
                      <select name="role" value={editFormData.role} onChange={handleEditChange} className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:border-blue-500">
                        {roles.map(r => (
                          <option key={r.id} value={r.slug}>{r.name}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <div className="mt-4">
                    <label className="block text-gray-700 text-sm font-bold mb-2">Active</label>
                    <input type="checkbox" name="is_active" checked={editFormData.is_active} onChange={handleEditChange} className="mr-2" />
                    <span>{editFormData.is_active ? 'Active' : 'Inactive'}</span>
                  </div>
                </form>

                {/* Permission Overrides Section */}
                <div className="mt-6 border-t pt-4">
                  <button
                    type="button"
                    onClick={() => setOverridesExpanded(!overridesExpanded)}
                    className="flex items-center gap-2 text-sm font-bold text-gray-700 hover:text-gray-900 w-full text-left"
                  >
                    <svg
                      className={`w-4 h-4 transition-transform ${overridesExpanded ? 'rotate-90' : ''}`}
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                    Permission Overrides
                    {Object.values(overrideEdits).some(v => v.granted.length > 0 || v.revoked.length > 0) && (
                      <span className="ml-2 text-xs bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded-full">
                        {Object.values(overrideEdits).filter(v => v.granted.length > 0 || v.revoked.length > 0).length} module(s)
                      </span>
                    )}
                  </button>
                  <p className="text-xs text-gray-500 mt-1 ml-6">Grant extra permissions or revoke role permissions for this specific user.</p>

                  {overridesExpanded && (
                    <div className="mt-4 space-y-3">
                      {registry.length === 0 && (
                        <p className="text-sm text-gray-400 italic">No permission modules registered.</p>
                      )}
                      {registry.map((mod) => {
                        const roleActions = getRoleActionsForModule(editFormData.role, mod.key);
                        const currentOverrides = overrideEdits[mod.key] || { granted: [], revoked: [] };
                        const nonRoleActions = mod.actions.filter(a => !roleActions.includes(a));

                        return (
                          <div key={mod.key} className="border rounded-lg p-3">
                            <div className="flex flex-col lg:flex-row lg:items-start gap-3">
                              {/* Module info */}
                              <div className="lg:w-1/4 min-w-0">
                                <p className="text-sm font-semibold text-gray-800">{mod.label}</p>
                                <p className="text-xs text-gray-400 mt-0.5">Role grants:</p>
                                <div className="flex flex-wrap gap-1 mt-1">
                                  {roleActions.length > 0 ? roleActions.map(action => (
                                    <span key={action} className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded">
                                      {action}
                                    </span>
                                  )) : (
                                    <span className="text-xs text-gray-400 italic">none</span>
                                  )}
                                </div>
                              </div>

                              {/* Grant controls - actions NOT in role */}
                              <div className="lg:w-[37.5%] min-w-0">
                                <p className="text-xs font-medium text-green-700 mb-1">Grant extra</p>
                                <div className="flex flex-wrap gap-1.5">
                                  {nonRoleActions.length > 0 ? nonRoleActions.map(action => (
                                    <label
                                      key={action}
                                      className={`inline-flex items-center gap-1 text-xs px-2 py-1 rounded cursor-pointer border transition ${
                                        currentOverrides.granted.includes(action)
                                          ? 'bg-green-50 border-green-400 text-green-800'
                                          : 'bg-white border-gray-200 text-gray-500 hover:border-green-300'
                                      }`}
                                    >
                                      <input
                                        type="checkbox"
                                        className="sr-only"
                                        checked={currentOverrides.granted.includes(action)}
                                        onChange={() => toggleGrantedAction(mod.key, action)}
                                      />
                                      <span className={`w-3 h-3 rounded border flex items-center justify-center ${
                                        currentOverrides.granted.includes(action)
                                          ? 'bg-green-500 border-green-500'
                                          : 'border-gray-300'
                                      }`}>
                                        {currentOverrides.granted.includes(action) && (
                                          <svg className="w-2 h-2 text-white" fill="currentColor" viewBox="0 0 12 12">
                                            <path d="M10.28 2.28L3.989 8.575 1.695 6.28A1 1 0 00.28 7.695l3 3a1 1 0 001.414 0l7-7A1 1 0 0010.28 2.28z"/>
                                          </svg>
                                        )}
                                      </span>
                                      {action}
                                    </label>
                                  )) : (
                                    <span className="text-xs text-gray-400 italic">Role already has all actions</span>
                                  )}
                                </div>
                              </div>

                              {/* Revoke controls - actions IN role */}
                              <div className="lg:w-[37.5%] min-w-0">
                                <p className="text-xs font-medium text-red-700 mb-1">Revoke from role</p>
                                <div className="flex flex-wrap gap-1.5">
                                  {roleActions.length > 0 ? roleActions.map(action => (
                                    <label
                                      key={action}
                                      className={`inline-flex items-center gap-1 text-xs px-2 py-1 rounded cursor-pointer border transition ${
                                        currentOverrides.revoked.includes(action)
                                          ? 'bg-red-50 border-red-400 text-red-800'
                                          : 'bg-white border-gray-200 text-gray-500 hover:border-red-300'
                                      }`}
                                    >
                                      <input
                                        type="checkbox"
                                        className="sr-only"
                                        checked={currentOverrides.revoked.includes(action)}
                                        onChange={() => toggleRevokedAction(mod.key, action)}
                                      />
                                      <span className={`w-3 h-3 rounded border flex items-center justify-center ${
                                        currentOverrides.revoked.includes(action)
                                          ? 'bg-red-500 border-red-500'
                                          : 'border-gray-300'
                                      }`}>
                                        {currentOverrides.revoked.includes(action) && (
                                          <svg className="w-2 h-2 text-white" fill="currentColor" viewBox="0 0 12 12">
                                            <path d="M10.28 2.28L3.989 8.575 1.695 6.28A1 1 0 00.28 7.695l3 3a1 1 0 001.414 0l7-7A1 1 0 0010.28 2.28z"/>
                                          </svg>
                                        )}
                                      </span>
                                      {action}
                                    </label>
                                  )) : (
                                    <span className="text-xs text-gray-400 italic">No role actions to revoke</span>
                                  )}
                                </div>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Account Access Section */}
                <div className="mt-6 border-t pt-4">
                  <button
                    type="button"
                    onClick={() => setAccountAccessExpanded(!accountAccessExpanded)}
                    className="flex items-center gap-2 text-sm font-bold text-gray-700 hover:text-gray-900 w-full text-left"
                  >
                    <svg
                      className={`w-4 h-4 transition-transform ${accountAccessExpanded ? 'rotate-90' : ''}`}
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                    Account Access
                    {userAccountIds.length > 0 && (
                      <span className="ml-2 text-xs bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded-full">
                        {userAccountIds.length} account(s)
                      </span>
                    )}
                  </button>
                  <p className="text-xs text-gray-500 mt-1 ml-6">Assign platform accounts this agent can access.</p>

                  {accountAccessExpanded && (
                    <div className="mt-4">
                      {allPlatformAccounts.length === 0 ? (
                        <p className="text-sm text-gray-400 italic">No platform accounts configured.</p>
                      ) : (
                        <div className="space-y-4">
                          {Object.entries(groupAccountsByPlatform(allPlatformAccounts)).map(([platform, accounts]) => (
                            <div key={platform}>
                              <div className="flex items-center gap-2 mb-2">
                                <span className={`text-xs font-semibold px-2 py-0.5 rounded-full capitalize ${platformColors[platform] || 'bg-gray-100 text-gray-800'}`}>
                                  {platform}
                                </span>
                              </div>
                              <div className="ml-4 space-y-1.5">
                                {accounts.map((account: any) => (
                                  <label
                                    key={account.id}
                                    className="flex items-center gap-2 cursor-pointer group"
                                  >
                                    <input
                                      type="checkbox"
                                      checked={userAccountIds.includes(account.id)}
                                      onChange={() => toggleAccountAccess(account.id)}
                                      className="w-4 h-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                                    />
                                    <span className="text-sm text-gray-700 group-hover:text-gray-900">
                                      {account.account_name || account.name || 'Unnamed'}
                                    </span>
                                    {(account.account_id || account.identifier) && (
                                      <span className="text-xs text-gray-400">
                                        ({account.account_id || account.identifier})
                                      </span>
                                    )}
                                  </label>
                                ))}
                              </div>
                            </div>
                          ))}
                          <p className="text-xs text-gray-400 italic mt-3 ml-1">
                            If no accounts are selected, agent will see conversations from all accounts.
                          </p>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* Footer with save button */}
              <div className="p-6 pt-4 border-t bg-gray-50 rounded-b-lg flex justify-end gap-3">
                <button
                  type="button"
                  onClick={handleEditModalClose}
                  className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800 border border-gray-300 rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  form="editUserForm"
                  disabled={overridesSaving}
                  className="text-white font-semibold py-2 px-6 rounded-lg transition disabled:opacity-50"
                  style={{ backgroundColor: 'var(--button-primary)' }}
                >
                  {overridesSaving ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
