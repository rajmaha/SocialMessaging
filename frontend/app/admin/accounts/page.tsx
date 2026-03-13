'use client';

import React, { useState, useEffect } from 'react';
import MainHeader from "@/components/MainHeader";
import { authAPI } from "@/lib/auth";
import { useRouter } from 'next/navigation';
import { getAuthToken } from '@/lib/auth';
import AdminNav from '@/components/AdminNav';
import { API_URL } from '@/lib/config';

interface PlatformAccount {
    id: number;
    platform: string;
    account_id: string;
    account_name: string;
    is_active: boolean;
    created_at: string;
    updated_at: string;
}

interface User {
    id: number;
    username: string;
    email: string;
    role: string;
}

const PLATFORM_BADGES: Record<string, { bg: string; text: string; label: string }> = {
    facebook: { bg: 'bg-blue-100', text: 'text-blue-800', label: 'Facebook' },
    whatsapp: { bg: 'bg-green-100', text: 'text-green-800', label: 'WhatsApp' },
    viber: { bg: 'bg-purple-100', text: 'text-purple-800', label: 'Viber' },
    linkedin: { bg: 'bg-sky-100', text: 'text-sky-800', label: 'LinkedIn' },
};

const DEFAULT_FORM_DATA = {
    platform: 'facebook',
    account_id: '',
    account_name: '',
    access_token: '',
    phone_number: '',
    app_secret: '',
    verify_token: '',
    metadata: {} as Record<string, string>,
};

export default function ConnectedAccountsPage() {
    const user = authAPI.getUser();
    const router = useRouter();

    const [accounts, setAccounts] = useState<PlatformAccount[]>([]);
    const [loading, setLoading] = useState(true);
    const [platformFilter, setPlatformFilter] = useState('all');
    const [showModal, setShowModal] = useState(false);
    const [editingAccount, setEditingAccount] = useState<PlatformAccount | null>(null);
    const [showPasswords, setShowPasswords] = useState<Record<string, boolean>>({});
    const [agents, setAgents] = useState<User[]>([]);
    const [expandedAgents, setExpandedAgents] = useState<number | null>(null);
    const [accountAgents, setAccountAgents] = useState<Record<number, User[]>>({});
    const [users, setUsers] = useState<User[]>([]);
    const [saving, setSaving] = useState(false);

    const [formData, setFormData] = useState({ ...DEFAULT_FORM_DATA });

    const togglePassword = (key: string) =>
        setShowPasswords(prev => ({ ...prev, [key]: !prev[key] }));

    useEffect(() => {
        fetchAccounts();
        fetchUsers();
    }, []);

    const getToken = () => {
        const token = getAuthToken();
        if (!token) {
            router.push('/login');
            return null;
        }
        return token;
    };

    const fetchAccounts = async () => {
        try {
            const token = getToken();
            if (!token) return;
            const response = await fetch(`${API_URL}/admin/platform-accounts`, {
                headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }
            });
            if (response.ok) {
                const data = await response.json();
                setAccounts(Array.isArray(data) ? data : []);
            }
        } catch (err) {
            console.error('Failed to fetch accounts:', err);
        } finally {
            setLoading(false);
        }
    };

    const fetchUsers = async () => {
        try {
            const token = getToken();
            if (!token) return;
            const response = await fetch(`${API_URL}/admin/users`, {
                headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }
            });
            if (response.ok) {
                const data = await response.json();
                setUsers(Array.isArray(data) ? data : []);
            }
        } catch (err) {
            console.error('Failed to fetch users:', err);
        }
    };

    const fetchAccountAgents = async (accountId: number) => {
        try {
            const token = getToken();
            if (!token) return;
            const response = await fetch(`${API_URL}/admin/platform-accounts/${accountId}/agents`, {
                headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }
            });
            if (response.ok) {
                const data = await response.json();
                setAccountAgents(prev => ({ ...prev, [accountId]: Array.isArray(data) ? data : [] }));
            }
        } catch (err) {
            console.error('Failed to fetch account agents:', err);
        }
    };

    const handleCreate = async () => {
        const token = getToken();
        if (!token) return;
        setSaving(true);
        try {
            const response = await fetch(`${API_URL}/admin/platform-accounts`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify(formData),
            });
            if (response.ok) {
                setShowModal(false);
                resetForm();
                await fetchAccounts();
            } else {
                const err = await response.json();
                alert(err.detail || 'Failed to create account');
            }
        } catch (err) {
            console.error('Failed to create account:', err);
            alert('Failed to create account');
        } finally {
            setSaving(false);
        }
    };

    const handleUpdate = async () => {
        if (!editingAccount) return;
        const token = getToken();
        if (!token) return;
        setSaving(true);
        try {
            const response = await fetch(`${API_URL}/admin/platform-accounts/${editingAccount.id}`, {
                method: 'PUT',
                headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify(formData),
            });
            if (response.ok) {
                setShowModal(false);
                setEditingAccount(null);
                resetForm();
                await fetchAccounts();
            } else {
                const err = await response.json();
                alert(err.detail || 'Failed to update account');
            }
        } catch (err) {
            console.error('Failed to update account:', err);
            alert('Failed to update account');
        } finally {
            setSaving(false);
        }
    };

    const handleDelete = async (id: number) => {
        if (!confirm('Are you sure you want to delete this account? This action cannot be undone.')) return;
        const token = getToken();
        if (!token) return;
        try {
            const response = await fetch(`${API_URL}/admin/platform-accounts/${id}`, {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }
            });
            if (response.ok) {
                await fetchAccounts();
                if (expandedAgents === id) setExpandedAgents(null);
            } else {
                alert('Failed to delete account');
            }
        } catch (err) {
            console.error('Failed to delete account:', err);
        }
    };

    const handleToggle = async (id: number) => {
        const token = getToken();
        if (!token) return;
        try {
            const response = await fetch(`${API_URL}/admin/platform-accounts/${id}/toggle`, {
                method: 'PATCH',
                headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }
            });
            if (response.ok) {
                await fetchAccounts();
            }
        } catch (err) {
            console.error('Failed to toggle account:', err);
        }
    };

    const handleAssignAgent = async (accountId: number, userId: number) => {
        const token = getToken();
        if (!token) return;
        try {
            const response = await fetch(`${API_URL}/admin/platform-accounts/${accountId}/agents`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ user_id: userId }),
            });
            if (response.ok) {
                await fetchAccountAgents(accountId);
            }
        } catch (err) {
            console.error('Failed to assign agent:', err);
        }
    };

    const handleRemoveAgent = async (accountId: number, userId: number) => {
        const token = getToken();
        if (!token) return;
        try {
            const response = await fetch(`${API_URL}/admin/platform-accounts/${accountId}/agents/${userId}`, {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }
            });
            if (response.ok) {
                await fetchAccountAgents(accountId);
            }
        } catch (err) {
            console.error('Failed to remove agent:', err);
        }
    };

    const resetForm = () => {
        setFormData({ ...DEFAULT_FORM_DATA });
        setShowPasswords({});
    };

    const openCreateModal = () => {
        setEditingAccount(null);
        resetForm();
        setShowModal(true);
    };

    const openEditModal = (account: PlatformAccount) => {
        setEditingAccount(account);
        setFormData({
            platform: account.platform,
            account_id: account.account_id || '',
            account_name: account.account_name || '',
            access_token: '',
            phone_number: '',
            app_secret: '',
            verify_token: '',
            metadata: {},
        });
        setShowPasswords({});
        setShowModal(true);
    };

    const handleSave = () => {
        if (editingAccount) {
            handleUpdate();
        } else {
            handleCreate();
        }
    };

    const toggleAgentsPanel = (accountId: number) => {
        if (expandedAgents === accountId) {
            setExpandedAgents(null);
        } else {
            setExpandedAgents(accountId);
            fetchAccountAgents(accountId);
        }
    };

    const isAgentAssigned = (accountId: number, userId: number) => {
        const assigned = accountAgents[accountId] || [];
        return assigned.some(a => a.id === userId);
    };

    const handleAgentCheckbox = (accountId: number, userId: number, checked: boolean) => {
        if (checked) {
            handleAssignAgent(accountId, userId);
        } else {
            handleRemoveAgent(accountId, userId);
        }
    };

    const selectAllAgents = async (accountId: number) => {
        for (const u of users) {
            if (!isAgentAssigned(accountId, u.id)) {
                await handleAssignAgent(accountId, u.id);
            }
        }
    };

    const clearAllAgents = async (accountId: number) => {
        const assigned = accountAgents[accountId] || [];
        for (const a of assigned) {
            await handleRemoveAgent(accountId, a.id);
        }
    };

    const filteredAccounts = platformFilter === 'all'
        ? accounts
        : accounts.filter(a => a.platform === platformFilter);

    // Render platform-specific form fields
    const renderPlatformFields = () => {
        const platform = formData.platform;

        switch (platform) {
            case 'facebook':
                return (
                    <>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Account Name</label>
                            <input
                                type="text"
                                value={formData.account_name}
                                onChange={e => setFormData({ ...formData, account_name: e.target.value })}
                                className="w-full px-3 py-2 border rounded-lg"
                                placeholder="My Facebook Page"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Page ID</label>
                            <input
                                type="text"
                                value={formData.account_id}
                                onChange={e => setFormData({ ...formData, account_id: e.target.value })}
                                className="w-full px-3 py-2 border rounded-lg"
                                placeholder="123456789"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Access Token</label>
                            <div className="relative">
                                <input
                                    type={showPasswords['access_token'] ? 'text' : 'password'}
                                    value={formData.access_token}
                                    onChange={e => setFormData({ ...formData, access_token: e.target.value })}
                                    className="w-full px-3 py-2 border rounded-lg pr-10"
                                    placeholder={editingAccount ? '(unchanged if empty)' : ''}
                                />
                                <button
                                    type="button"
                                    onClick={() => togglePassword('access_token')}
                                    className="absolute right-2 top-1/2 transform -translate-y-1/2 text-gray-500 hover:text-gray-700"
                                >
                                    {showPasswords['access_token'] ? '\u{1F441}' : '\u{1F441}\u200D\u{1F5E8}'}
                                </button>
                            </div>
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">App Secret</label>
                            <div className="relative">
                                <input
                                    type={showPasswords['app_secret'] ? 'text' : 'password'}
                                    value={formData.app_secret}
                                    onChange={e => setFormData({ ...formData, app_secret: e.target.value })}
                                    className="w-full px-3 py-2 border rounded-lg pr-10"
                                    placeholder={editingAccount ? '(unchanged if empty)' : ''}
                                />
                                <button
                                    type="button"
                                    onClick={() => togglePassword('app_secret')}
                                    className="absolute right-2 top-1/2 transform -translate-y-1/2 text-gray-500 hover:text-gray-700"
                                >
                                    {showPasswords['app_secret'] ? '\u{1F441}' : '\u{1F441}\u200D\u{1F5E8}'}
                                </button>
                            </div>
                        </div>
                    </>
                );

            case 'whatsapp':
                return (
                    <>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Account Name</label>
                            <input
                                type="text"
                                value={formData.account_name}
                                onChange={e => setFormData({ ...formData, account_name: e.target.value })}
                                className="w-full px-3 py-2 border rounded-lg"
                                placeholder="My WhatsApp Business"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Phone Number ID</label>
                            <input
                                type="text"
                                value={formData.account_id}
                                onChange={e => setFormData({ ...formData, account_id: e.target.value })}
                                className="w-full px-3 py-2 border rounded-lg"
                                placeholder="123456789"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Phone Number</label>
                            <input
                                type="text"
                                value={formData.phone_number}
                                onChange={e => setFormData({ ...formData, phone_number: e.target.value })}
                                className="w-full px-3 py-2 border rounded-lg"
                                placeholder="+1234567890"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Access Token</label>
                            <div className="relative">
                                <input
                                    type={showPasswords['access_token'] ? 'text' : 'password'}
                                    value={formData.access_token}
                                    onChange={e => setFormData({ ...formData, access_token: e.target.value })}
                                    className="w-full px-3 py-2 border rounded-lg pr-10"
                                    placeholder={editingAccount ? '(unchanged if empty)' : ''}
                                />
                                <button
                                    type="button"
                                    onClick={() => togglePassword('access_token')}
                                    className="absolute right-2 top-1/2 transform -translate-y-1/2 text-gray-500 hover:text-gray-700"
                                >
                                    {showPasswords['access_token'] ? '\u{1F441}' : '\u{1F441}\u200D\u{1F5E8}'}
                                </button>
                            </div>
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Business Account ID</label>
                            <input
                                type="text"
                                value={formData.metadata.business_account_id || ''}
                                onChange={e => setFormData({
                                    ...formData,
                                    metadata: { ...formData.metadata, business_account_id: e.target.value }
                                })}
                                className="w-full px-3 py-2 border rounded-lg"
                                placeholder="Business Account ID"
                            />
                        </div>
                    </>
                );

            case 'viber':
                return (
                    <>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Account Name</label>
                            <input
                                type="text"
                                value={formData.account_name}
                                onChange={e => setFormData({ ...formData, account_name: e.target.value })}
                                className="w-full px-3 py-2 border rounded-lg"
                                placeholder="My Viber Bot"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Account ID</label>
                            <input
                                type="text"
                                value={formData.account_id}
                                onChange={e => setFormData({ ...formData, account_id: e.target.value })}
                                className="w-full px-3 py-2 border rounded-lg"
                                placeholder="Auto-generated or enter manually"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Bot Token</label>
                            <div className="relative">
                                <input
                                    type={showPasswords['access_token'] ? 'text' : 'password'}
                                    value={formData.access_token}
                                    onChange={e => setFormData({ ...formData, access_token: e.target.value })}
                                    className="w-full px-3 py-2 border rounded-lg pr-10"
                                    placeholder={editingAccount ? '(unchanged if empty)' : ''}
                                />
                                <button
                                    type="button"
                                    onClick={() => togglePassword('access_token')}
                                    className="absolute right-2 top-1/2 transform -translate-y-1/2 text-gray-500 hover:text-gray-700"
                                >
                                    {showPasswords['access_token'] ? '\u{1F441}' : '\u{1F441}\u200D\u{1F5E8}'}
                                </button>
                            </div>
                        </div>
                    </>
                );

            case 'linkedin':
                return (
                    <>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Account Name</label>
                            <input
                                type="text"
                                value={formData.account_name}
                                onChange={e => setFormData({ ...formData, account_name: e.target.value })}
                                className="w-full px-3 py-2 border rounded-lg"
                                placeholder="My LinkedIn Page"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Access Token</label>
                            <div className="relative">
                                <input
                                    type={showPasswords['access_token'] ? 'text' : 'password'}
                                    value={formData.access_token}
                                    onChange={e => setFormData({ ...formData, access_token: e.target.value })}
                                    className="w-full px-3 py-2 border rounded-lg pr-10"
                                    placeholder={editingAccount ? '(unchanged if empty)' : ''}
                                />
                                <button
                                    type="button"
                                    onClick={() => togglePassword('access_token')}
                                    className="absolute right-2 top-1/2 transform -translate-y-1/2 text-gray-500 hover:text-gray-700"
                                >
                                    {showPasswords['access_token'] ? '\u{1F441}' : '\u{1F441}\u200D\u{1F5E8}'}
                                </button>
                            </div>
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Organisation ID</label>
                            <input
                                type="text"
                                value={formData.metadata.organization_id || ''}
                                onChange={e => {
                                    const orgId = e.target.value;
                                    setFormData({
                                        ...formData,
                                        account_id: orgId,
                                        metadata: { ...formData.metadata, organization_id: orgId }
                                    });
                                }}
                                className="w-full px-3 py-2 border rounded-lg"
                                placeholder="Organisation ID"
                            />
                        </div>
                    </>
                );

            default:
                return null;
        }
    };

    return (
        <>
            <MainHeader user={user} />
            <AdminNav />
            <div className="ml-[240px] pt-14 p-6">
                {/* Header */}
                <div className="flex items-center justify-between mb-6">
                    <h1 className="text-2xl font-bold text-gray-800">Connected Accounts</h1>
                    <div className="flex items-center gap-3">
                        <select
                            value={platformFilter}
                            onChange={e => setPlatformFilter(e.target.value)}
                            className="px-3 py-2 border rounded-lg text-sm"
                        >
                            <option value="all">All Platforms</option>
                            <option value="facebook">Facebook</option>
                            <option value="whatsapp">WhatsApp</option>
                            <option value="viber">Viber</option>
                            <option value="linkedin">LinkedIn</option>
                        </select>
                        <button
                            onClick={openCreateModal}
                            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm font-medium"
                        >
                            Add Account
                        </button>
                    </div>
                </div>

                {/* Loading */}
                {loading && (
                    <div className="text-center py-12 text-gray-500">Loading accounts...</div>
                )}

                {/* Empty state */}
                {!loading && filteredAccounts.length === 0 && (
                    <div className="text-center py-12 text-gray-500 bg-white rounded-lg border">
                        <p className="text-lg mb-2">No connected accounts.</p>
                        <p className="text-sm">Click &quot;Add Account&quot; to get started.</p>
                    </div>
                )}

                {/* Account list table */}
                {!loading && filteredAccounts.length > 0 && (
                    <div className="bg-white rounded-lg border overflow-hidden">
                        <table className="w-full">
                            <thead className="bg-gray-50 border-b">
                                <tr>
                                    <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Platform</th>
                                    <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Account Name</th>
                                    <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Account ID</th>
                                    <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                                    <th className="text-right px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y">
                                {filteredAccounts.map(account => {
                                    const badge = PLATFORM_BADGES[account.platform] || { bg: 'bg-gray-100', text: 'text-gray-800', label: account.platform };
                                    return (
                                        <React.Fragment key={account.id}>
                                            <tr className="hover:bg-gray-50">
                                                <td className="px-4 py-3">
                                                    <span className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-medium ${badge.bg} ${badge.text}`}>
                                                        {badge.label}
                                                    </span>
                                                </td>
                                                <td className="px-4 py-3 text-sm text-gray-900">{account.account_name || '-'}</td>
                                                <td className="px-4 py-3 text-sm text-gray-500 font-mono">{account.account_id}</td>
                                                <td className="px-4 py-3">
                                                    {account.is_active ? (
                                                        <span className="inline-block px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">Active</span>
                                                    ) : (
                                                        <span className="inline-block px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-600">Disabled</span>
                                                    )}
                                                </td>
                                                <td className="px-4 py-3 text-right">
                                                    <div className="flex items-center justify-end gap-2">
                                                        <button
                                                            onClick={() => openEditModal(account)}
                                                            className="p-1.5 text-gray-500 hover:text-blue-600 hover:bg-blue-50 rounded"
                                                            title="Edit"
                                                        >
                                                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                                                            </svg>
                                                        </button>
                                                        <button
                                                            onClick={() => handleToggle(account.id)}
                                                            className={`p-1.5 rounded ${account.is_active ? 'text-green-600 hover:text-orange-600 hover:bg-orange-50' : 'text-gray-400 hover:text-green-600 hover:bg-green-50'}`}
                                                            title={account.is_active ? 'Disable' : 'Enable'}
                                                        >
                                                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                                                            </svg>
                                                        </button>
                                                        <button
                                                            onClick={() => handleDelete(account.id)}
                                                            className="p-1.5 text-gray-500 hover:text-red-600 hover:bg-red-50 rounded"
                                                            title="Delete"
                                                        >
                                                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                                            </svg>
                                                        </button>
                                                        <button
                                                            onClick={() => toggleAgentsPanel(account.id)}
                                                            className={`px-3 py-1 text-xs font-medium rounded border ${expandedAgents === account.id ? 'bg-blue-50 border-blue-300 text-blue-700' : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50'}`}
                                                        >
                                                            Manage Agents
                                                        </button>
                                                    </div>
                                                </td>
                                            </tr>

                                            {/* Expanded agents panel */}
                                            {expandedAgents === account.id && (
                                                <tr>
                                                    <td colSpan={5} className="px-4 py-4 bg-gray-50 border-t">
                                                        <div className="max-w-2xl">
                                                            <div className="flex items-center justify-between mb-3">
                                                                <h4 className="text-sm font-medium text-gray-700">Assigned Agents</h4>
                                                                <div className="flex gap-3 text-xs">
                                                                    <button
                                                                        onClick={() => selectAllAgents(account.id)}
                                                                        className="text-blue-600 hover:underline"
                                                                    >
                                                                        Select All
                                                                    </button>
                                                                    <button
                                                                        onClick={() => clearAllAgents(account.id)}
                                                                        className="text-red-600 hover:underline"
                                                                    >
                                                                        Clear All
                                                                    </button>
                                                                </div>
                                                            </div>
                                                            {users.length === 0 ? (
                                                                <p className="text-sm text-gray-500">No users found.</p>
                                                            ) : (
                                                                <div className="grid grid-cols-2 gap-2">
                                                                    {users.map(u => (
                                                                        <label key={u.id} className="flex items-center gap-2 px-3 py-2 rounded hover:bg-white cursor-pointer text-sm">
                                                                            <input
                                                                                type="checkbox"
                                                                                checked={isAgentAssigned(account.id, u.id)}
                                                                                onChange={e => handleAgentCheckbox(account.id, u.id, e.target.checked)}
                                                                                className="rounded border-gray-300"
                                                                            />
                                                                            <span className="text-gray-800">{u.username}</span>
                                                                            <span className="text-gray-400 text-xs">({u.email})</span>
                                                                        </label>
                                                                    ))}
                                                                </div>
                                                            )}
                                                        </div>
                                                    </td>
                                                </tr>
                                            )}
                                        </React.Fragment>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )}

                {/* Add/Edit Modal */}
                {showModal && (
                    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
                        <div className="bg-white rounded-xl shadow-xl w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto">
                            <div className="px-6 py-4 border-b flex items-center justify-between">
                                <h2 className="text-lg font-semibold text-gray-800">
                                    {editingAccount ? 'Edit Account' : 'Add Account'}
                                </h2>
                                <button
                                    type="button"
                                    onClick={() => { setShowModal(false); setEditingAccount(null); resetForm(); }}
                                    className="text-gray-400 hover:text-gray-600"
                                >
                                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                    </svg>
                                </button>
                            </div>
                            <div className="px-6 py-4 space-y-4">
                                {/* Platform selector */}
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">Platform</label>
                                    <select
                                        value={formData.platform}
                                        onChange={e => setFormData({ ...DEFAULT_FORM_DATA, platform: e.target.value })}
                                        disabled={!!editingAccount}
                                        className="w-full px-3 py-2 border rounded-lg disabled:bg-gray-100 disabled:cursor-not-allowed"
                                    >
                                        <option value="facebook">Facebook</option>
                                        <option value="whatsapp">WhatsApp</option>
                                        <option value="viber">Viber</option>
                                        <option value="linkedin">LinkedIn</option>
                                    </select>
                                </div>

                                {/* Dynamic platform fields */}
                                {renderPlatformFields()}
                            </div>
                            <div className="px-6 py-4 border-t flex justify-end gap-3">
                                <button
                                    type="button"
                                    onClick={() => { setShowModal(false); setEditingAccount(null); resetForm(); }}
                                    className="px-4 py-2 border rounded-lg text-gray-700 hover:bg-gray-50 text-sm"
                                >
                                    Cancel
                                </button>
                                <button
                                    type="button"
                                    onClick={handleSave}
                                    disabled={saving}
                                    className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm font-medium disabled:opacity-50"
                                >
                                    {saving ? 'Saving...' : (editingAccount ? 'Update' : 'Create')}
                                </button>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </>
    );
}
