'use client';

import React, { useState, useEffect } from 'react';
import MainHeader from '@/components/MainHeader';
import { authAPI, getAuthToken } from '@/lib/auth';
import { useRouter } from 'next/navigation';
import AdminNav from '@/components/AdminNav';
import { API_URL } from '@/lib/config';

interface WidgetDomain {
    id: number;
    domain: string;
    display_name: string;
    widget_key: string;
    is_active: boolean;
    branding_overrides: Record<string, any> | null;
    created_at: string;
    updated_at: string;
}

interface PlatformAccount {
    id: number;
    platform: string;
    account_name: string;
    is_active: boolean;
}

interface User {
    id: number;
    username: string;
    email: string;
    role: string;
}

const DEFAULT_FORM_DATA = {
    domain: '',
    display_name: '',
    branding_overrides: {
        company_name: '',
        logo_url: '',
        primary_color: '',
        welcome_message: '',
    },
};

export default function WidgetDomainsPage() {
    const user = authAPI.getUser();
    const router = useRouter();

    const [domains, setDomains] = useState<WidgetDomain[]>([]);
    const [loading, setLoading] = useState(true);
    const [showModal, setShowModal] = useState(false);
    const [editingDomain, setEditingDomain] = useState<WidgetDomain | null>(null);
    const [saving, setSaving] = useState(false);
    const [formData, setFormData] = useState({ ...DEFAULT_FORM_DATA });
    const [copyFeedback, setCopyFeedback] = useState<number | null>(null);

    // Accounts assignment
    const [platformAccounts, setPlatformAccounts] = useState<PlatformAccount[]>([]);
    const [expandedAccounts, setExpandedAccounts] = useState<number | null>(null);
    const [domainAccounts, setDomainAccounts] = useState<Record<number, number[]>>({});

    // Agents assignment
    const [agents, setAgents] = useState<User[]>([]);
    const [expandedAgents, setExpandedAgents] = useState<number | null>(null);
    const [domainAgents, setDomainAgents] = useState<Record<number, number[]>>({});

    const getToken = () => {
        const token = getAuthToken();
        if (!token) {
            router.push('/login');
            return null;
        }
        return token;
    };

    useEffect(() => {
        fetchDomains();
        fetchPlatformAccounts();
        fetchAgents();
    }, []);

    const fetchDomains = async () => {
        try {
            const token = getToken();
            if (!token) return;
            const response = await fetch(`${API_URL}/admin/widget-domains/`, {
                headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }
            });
            if (response.ok) {
                const data = await response.json();
                setDomains(Array.isArray(data) ? data : []);
            }
        } catch (err) {
            console.error('Failed to fetch widget domains:', err);
        } finally {
            setLoading(false);
        }
    };

    const fetchPlatformAccounts = async () => {
        try {
            const token = getToken();
            if (!token) return;
            const response = await fetch(`${API_URL}/admin/platform-accounts/`, {
                headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }
            });
            if (response.ok) {
                const data = await response.json();
                setPlatformAccounts(Array.isArray(data) ? data : []);
            }
        } catch (err) {
            console.error('Failed to fetch platform accounts:', err);
        }
    };

    const fetchAgents = async () => {
        try {
            const token = getToken();
            if (!token) return;
            const response = await fetch(`${API_URL}/conversations/agents`, {
                headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }
            });
            if (response.ok) {
                const data = await response.json();
                setAgents(Array.isArray(data) ? data : []);
            }
        } catch (err) {
            console.error('Failed to fetch agents:', err);
        }
    };

    const fetchDomainAccounts = async (domainId: number) => {
        try {
            const token = getToken();
            if (!token) return;
            const response = await fetch(`${API_URL}/admin/widget-domains/${domainId}/accounts`, {
                headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }
            });
            if (response.ok) {
                const data = await response.json();
                const ids = Array.isArray(data) ? data.map((a: any) => a.id) : [];
                setDomainAccounts(prev => ({ ...prev, [domainId]: ids }));
            }
        } catch (err) {
            console.error('Failed to fetch domain accounts:', err);
        }
    };

    const fetchDomainAgents = async (domainId: number) => {
        try {
            const token = getToken();
            if (!token) return;
            const response = await fetch(`${API_URL}/admin/widget-domains/${domainId}/agents`, {
                headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }
            });
            if (response.ok) {
                const data = await response.json();
                const ids = Array.isArray(data) ? data.map((a: any) => a.id) : [];
                setDomainAgents(prev => ({ ...prev, [domainId]: ids }));
            }
        } catch (err) {
            console.error('Failed to fetch domain agents:', err);
        }
    };

    const handleCreate = async () => {
        const token = getToken();
        if (!token) return;
        setSaving(true);
        try {
            const payload: any = {
                domain: formData.domain,
                display_name: formData.display_name,
            };
            const overrides: Record<string, string> = {};
            if (formData.branding_overrides.company_name) overrides.company_name = formData.branding_overrides.company_name;
            if (formData.branding_overrides.logo_url) overrides.logo_url = formData.branding_overrides.logo_url;
            if (formData.branding_overrides.primary_color) overrides.primary_color = formData.branding_overrides.primary_color;
            if (formData.branding_overrides.welcome_message) overrides.welcome_message = formData.branding_overrides.welcome_message;
            if (Object.keys(overrides).length > 0) payload.branding_overrides = overrides;

            const response = await fetch(`${API_URL}/admin/widget-domains/`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });
            if (response.ok) {
                setShowModal(false);
                resetForm();
                await fetchDomains();
            } else {
                const err = await response.json();
                alert(err.detail || 'Failed to create domain');
            }
        } catch (err) {
            console.error('Failed to create domain:', err);
            alert('Failed to create domain');
        } finally {
            setSaving(false);
        }
    };

    const handleUpdate = async () => {
        if (!editingDomain) return;
        const token = getToken();
        if (!token) return;
        setSaving(true);
        try {
            const payload: any = {
                domain: formData.domain,
                display_name: formData.display_name,
            };
            const overrides: Record<string, string> = {};
            if (formData.branding_overrides.company_name) overrides.company_name = formData.branding_overrides.company_name;
            if (formData.branding_overrides.logo_url) overrides.logo_url = formData.branding_overrides.logo_url;
            if (formData.branding_overrides.primary_color) overrides.primary_color = formData.branding_overrides.primary_color;
            if (formData.branding_overrides.welcome_message) overrides.welcome_message = formData.branding_overrides.welcome_message;
            payload.branding_overrides = Object.keys(overrides).length > 0 ? overrides : null;

            const response = await fetch(`${API_URL}/admin/widget-domains/${editingDomain.id}`, {
                method: 'PUT',
                headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });
            if (response.ok) {
                setShowModal(false);
                setEditingDomain(null);
                resetForm();
                await fetchDomains();
            } else {
                const err = await response.json();
                alert(err.detail || 'Failed to update domain');
            }
        } catch (err) {
            console.error('Failed to update domain:', err);
            alert('Failed to update domain');
        } finally {
            setSaving(false);
        }
    };

    const handleDelete = async (id: number) => {
        if (!confirm('Are you sure you want to delete this widget domain? This action cannot be undone.')) return;
        const token = getToken();
        if (!token) return;
        try {
            const response = await fetch(`${API_URL}/admin/widget-domains/${id}`, {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }
            });
            if (response.ok) {
                await fetchDomains();
                if (expandedAccounts === id) setExpandedAccounts(null);
                if (expandedAgents === id) setExpandedAgents(null);
            } else {
                alert('Failed to delete domain');
            }
        } catch (err) {
            console.error('Failed to delete domain:', err);
        }
    };

    const handleToggle = async (id: number) => {
        const token = getToken();
        if (!token) return;
        try {
            const response = await fetch(`${API_URL}/admin/widget-domains/${id}/toggle`, {
                method: 'PATCH',
                headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }
            });
            if (response.ok) {
                await fetchDomains();
            }
        } catch (err) {
            console.error('Failed to toggle domain:', err);
        }
    };

    const handleCopyEmbed = (domain: WidgetDomain) => {
        const serverUrl = typeof window !== 'undefined' ? window.location.origin : '';
        const snippet = `<script src="${serverUrl}/chat-widget.js" data-key="${domain.widget_key}"></script>`;
        navigator.clipboard.writeText(snippet).then(() => {
            setCopyFeedback(domain.id);
            setTimeout(() => setCopyFeedback(null), 2000);
        });
    };

    const saveAccountAssignments = async (domainId: number, accountIds: number[]) => {
        const token = getToken();
        if (!token) return;
        try {
            await fetch(`${API_URL}/admin/widget-domains/${domainId}/accounts`, {
                method: 'PUT',
                headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ platform_account_ids: accountIds }),
            });
            setDomainAccounts(prev => ({ ...prev, [domainId]: accountIds }));
        } catch (err) {
            console.error('Failed to save account assignments:', err);
        }
    };

    const saveAgentAssignments = async (domainId: number, userIds: number[]) => {
        const token = getToken();
        if (!token) return;
        try {
            await fetch(`${API_URL}/admin/widget-domains/${domainId}/agents`, {
                method: 'PUT',
                headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ user_ids: userIds }),
            });
            setDomainAgents(prev => ({ ...prev, [domainId]: userIds }));
        } catch (err) {
            console.error('Failed to save agent assignments:', err);
        }
    };

    const toggleAccountCheckbox = (domainId: number, accountId: number, checked: boolean) => {
        const current = domainAccounts[domainId] || [];
        const next = checked ? [...current, accountId] : current.filter(id => id !== accountId);
        saveAccountAssignments(domainId, next);
    };

    const toggleAgentCheckbox = (domainId: number, userId: number, checked: boolean) => {
        const current = domainAgents[domainId] || [];
        const next = checked ? [...current, userId] : current.filter(id => id !== userId);
        saveAgentAssignments(domainId, next);
    };

    const resetForm = () => {
        setFormData({ ...DEFAULT_FORM_DATA, branding_overrides: { ...DEFAULT_FORM_DATA.branding_overrides } });
    };

    const openCreateModal = () => {
        setEditingDomain(null);
        resetForm();
        setShowModal(true);
    };

    const openEditModal = (domain: WidgetDomain) => {
        setEditingDomain(domain);
        const bo = domain.branding_overrides || {};
        setFormData({
            domain: domain.domain,
            display_name: domain.display_name || '',
            branding_overrides: {
                company_name: bo.company_name || '',
                logo_url: bo.logo_url || '',
                primary_color: bo.primary_color || '',
                welcome_message: bo.welcome_message || '',
            },
        });
        setShowModal(true);
    };

    const handleSave = () => {
        if (editingDomain) {
            handleUpdate();
        } else {
            handleCreate();
        }
    };

    const toggleAccountsPanel = (domainId: number) => {
        if (expandedAccounts === domainId) {
            setExpandedAccounts(null);
        } else {
            setExpandedAccounts(domainId);
            setExpandedAgents(null);
            fetchDomainAccounts(domainId);
        }
    };

    const toggleAgentsPanel = (domainId: number) => {
        if (expandedAgents === domainId) {
            setExpandedAgents(null);
        } else {
            setExpandedAgents(domainId);
            setExpandedAccounts(null);
            fetchDomainAgents(domainId);
        }
    };

    // Group platform accounts by platform
    const accountsByPlatform = platformAccounts.reduce<Record<string, PlatformAccount[]>>((acc, a) => {
        if (!acc[a.platform]) acc[a.platform] = [];
        acc[a.platform].push(a);
        return acc;
    }, {});

    return (
        <>
            <MainHeader />
            <AdminNav />
            <div className="ml-[240px] p-6">
                {/* Header */}
                <div className="flex items-center justify-between mb-6">
                    <h1 className="text-2xl font-bold text-gray-800">Widget Domains</h1>
                    <button
                        onClick={openCreateModal}
                        className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm font-medium"
                    >
                        Add Domain
                    </button>
                </div>

                {/* Loading */}
                {loading && (
                    <div className="text-center py-12 text-gray-500">Loading domains...</div>
                )}

                {/* Empty state */}
                {!loading && domains.length === 0 && (
                    <div className="text-center py-12 text-gray-500 bg-white rounded-lg border">
                        <p className="text-lg mb-2">No widget domains configured.</p>
                        <p className="text-sm">Click &quot;Add Domain&quot; to get started.</p>
                    </div>
                )}

                {/* Domain list table */}
                {!loading && domains.length > 0 && (
                    <div className="bg-white rounded-lg border overflow-hidden">
                        <table className="w-full">
                            <thead className="bg-gray-50 border-b">
                                <tr>
                                    <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Domain</th>
                                    <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Display Name</th>
                                    <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Widget Key</th>
                                    <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                                    <th className="text-right px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y">
                                {domains.map(domain => (
                                    <React.Fragment key={domain.id}>
                                        <tr className="hover:bg-gray-50">
                                            <td className="px-4 py-3 text-sm text-gray-900 font-mono">{domain.domain}</td>
                                            <td className="px-4 py-3 text-sm text-gray-900">{domain.display_name || '-'}</td>
                                            <td className="px-4 py-3 text-sm text-gray-500 font-mono text-xs">{domain.widget_key}</td>
                                            <td className="px-4 py-3">
                                                {domain.is_active ? (
                                                    <span className="inline-block px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">Active</span>
                                                ) : (
                                                    <span className="inline-block px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-600">Disabled</span>
                                                )}
                                            </td>
                                            <td className="px-4 py-3 text-right">
                                                <div className="flex items-center justify-end gap-2">
                                                    <button
                                                        onClick={() => handleCopyEmbed(domain)}
                                                        className={`px-3 py-1 text-xs font-medium rounded border ${copyFeedback === domain.id ? 'bg-green-50 border-green-300 text-green-700' : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50'}`}
                                                        title="Copy embed code"
                                                    >
                                                        {copyFeedback === domain.id ? 'Copied!' : 'Copy Embed'}
                                                    </button>
                                                    <button
                                                        onClick={() => openEditModal(domain)}
                                                        className="p-1.5 text-gray-500 hover:text-blue-600 hover:bg-blue-50 rounded"
                                                        title="Edit"
                                                    >
                                                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                                                        </svg>
                                                    </button>
                                                    <button
                                                        onClick={() => handleToggle(domain.id)}
                                                        className={`p-1.5 rounded ${domain.is_active ? 'text-green-600 hover:text-orange-600 hover:bg-orange-50' : 'text-gray-400 hover:text-green-600 hover:bg-green-50'}`}
                                                        title={domain.is_active ? 'Disable' : 'Enable'}
                                                    >
                                                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                                                        </svg>
                                                    </button>
                                                    <button
                                                        onClick={() => handleDelete(domain.id)}
                                                        className="p-1.5 text-gray-500 hover:text-red-600 hover:bg-red-50 rounded"
                                                        title="Delete"
                                                    >
                                                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                                        </svg>
                                                    </button>
                                                    <button
                                                        onClick={() => toggleAccountsPanel(domain.id)}
                                                        className={`px-3 py-1 text-xs font-medium rounded border ${expandedAccounts === domain.id ? 'bg-blue-50 border-blue-300 text-blue-700' : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50'}`}
                                                    >
                                                        Accounts
                                                    </button>
                                                    <button
                                                        onClick={() => toggleAgentsPanel(domain.id)}
                                                        className={`px-3 py-1 text-xs font-medium rounded border ${expandedAgents === domain.id ? 'bg-blue-50 border-blue-300 text-blue-700' : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50'}`}
                                                    >
                                                        Agents
                                                    </button>
                                                </div>
                                            </td>
                                        </tr>

                                        {/* Expanded accounts panel */}
                                        {expandedAccounts === domain.id && (
                                            <tr>
                                                <td colSpan={5} className="px-4 py-4 bg-gray-50 border-t">
                                                    <div className="max-w-3xl">
                                                        <div className="flex items-center justify-between mb-3">
                                                            <h4 className="text-sm font-medium text-gray-700">Assigned Platform Accounts</h4>
                                                            <div className="flex gap-3 text-xs">
                                                                <button
                                                                    onClick={() => saveAccountAssignments(domain.id, platformAccounts.filter(a => a.is_active).map(a => a.id))}
                                                                    className="text-blue-600 hover:underline"
                                                                >
                                                                    Select All
                                                                </button>
                                                                <button
                                                                    onClick={() => saveAccountAssignments(domain.id, [])}
                                                                    className="text-red-600 hover:underline"
                                                                >
                                                                    Clear All
                                                                </button>
                                                            </div>
                                                        </div>
                                                        {Object.keys(accountsByPlatform).length === 0 ? (
                                                            <p className="text-sm text-gray-500">No platform accounts found.</p>
                                                        ) : (
                                                            <div className="space-y-3">
                                                                {Object.entries(accountsByPlatform).map(([platform, accts]) => (
                                                                    <div key={platform}>
                                                                        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">{platform}</p>
                                                                        <div className="grid grid-cols-2 gap-1">
                                                                            {accts.map(acct => (
                                                                                <label key={acct.id} className="flex items-center gap-2 px-3 py-2 rounded hover:bg-white cursor-pointer text-sm">
                                                                                    <input
                                                                                        type="checkbox"
                                                                                        checked={(domainAccounts[domain.id] || []).includes(acct.id)}
                                                                                        onChange={e => toggleAccountCheckbox(domain.id, acct.id, e.target.checked)}
                                                                                        className="rounded border-gray-300"
                                                                                    />
                                                                                    <span className="text-gray-800">{acct.account_name}</span>
                                                                                    {!acct.is_active && <span className="text-gray-400 text-xs">(disabled)</span>}
                                                                                </label>
                                                                            ))}
                                                                        </div>
                                                                    </div>
                                                                ))}
                                                            </div>
                                                        )}
                                                    </div>
                                                </td>
                                            </tr>
                                        )}

                                        {/* Expanded agents panel */}
                                        {expandedAgents === domain.id && (
                                            <tr>
                                                <td colSpan={5} className="px-4 py-4 bg-gray-50 border-t">
                                                    <div className="max-w-2xl">
                                                        <div className="flex items-center justify-between mb-3">
                                                            <h4 className="text-sm font-medium text-gray-700">Assigned Agents</h4>
                                                            <div className="flex gap-3 text-xs">
                                                                <button
                                                                    onClick={() => saveAgentAssignments(domain.id, agents.map(a => a.id))}
                                                                    className="text-blue-600 hover:underline"
                                                                >
                                                                    Select All
                                                                </button>
                                                                <button
                                                                    onClick={() => saveAgentAssignments(domain.id, [])}
                                                                    className="text-red-600 hover:underline"
                                                                >
                                                                    Clear All
                                                                </button>
                                                            </div>
                                                        </div>
                                                        {agents.length === 0 ? (
                                                            <p className="text-sm text-gray-500">No agents found.</p>
                                                        ) : (
                                                            <div className="grid grid-cols-2 gap-2">
                                                                {agents.map(agent => (
                                                                    <label key={agent.id} className="flex items-center gap-2 px-3 py-2 rounded hover:bg-white cursor-pointer text-sm">
                                                                        <input
                                                                            type="checkbox"
                                                                            checked={(domainAgents[domain.id] || []).includes(agent.id)}
                                                                            onChange={e => toggleAgentCheckbox(domain.id, agent.id, e.target.checked)}
                                                                            className="rounded border-gray-300"
                                                                        />
                                                                        <span className="text-gray-800">{agent.username}</span>
                                                                        <span className="text-gray-400 text-xs">({agent.email})</span>
                                                                    </label>
                                                                ))}
                                                            </div>
                                                        )}
                                                    </div>
                                                </td>
                                            </tr>
                                        )}
                                    </React.Fragment>
                                ))}
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
                                    {editingDomain ? 'Edit Widget Domain' : 'Add Widget Domain'}
                                </h2>
                                <button
                                    type="button"
                                    onClick={() => { setShowModal(false); setEditingDomain(null); resetForm(); }}
                                    className="text-gray-400 hover:text-gray-600"
                                >
                                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                    </svg>
                                </button>
                            </div>
                            <div className="px-6 py-4 space-y-4">
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">Domain</label>
                                    <input
                                        type="text"
                                        value={formData.domain}
                                        onChange={e => setFormData({ ...formData, domain: e.target.value })}
                                        className="w-full px-3 py-2 border rounded-lg"
                                        placeholder="shop.example.com"
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">Display Name</label>
                                    <input
                                        type="text"
                                        value={formData.display_name}
                                        onChange={e => setFormData({ ...formData, display_name: e.target.value })}
                                        className="w-full px-3 py-2 border rounded-lg"
                                        placeholder="My Shop"
                                    />
                                </div>

                                {/* Branding Overrides */}
                                <div className="border-t pt-4">
                                    <h3 className="text-sm font-semibold text-gray-700 mb-3">Branding Overrides <span className="font-normal text-gray-400">(optional - empty = use global defaults)</span></h3>
                                    <div className="space-y-3">
                                        <div>
                                            <label className="block text-sm font-medium text-gray-700 mb-1">Company Name</label>
                                            <input
                                                type="text"
                                                value={formData.branding_overrides.company_name}
                                                onChange={e => setFormData({
                                                    ...formData,
                                                    branding_overrides: { ...formData.branding_overrides, company_name: e.target.value }
                                                })}
                                                className="w-full px-3 py-2 border rounded-lg"
                                                placeholder="Override company name"
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-sm font-medium text-gray-700 mb-1">Logo URL</label>
                                            <input
                                                type="text"
                                                value={formData.branding_overrides.logo_url}
                                                onChange={e => setFormData({
                                                    ...formData,
                                                    branding_overrides: { ...formData.branding_overrides, logo_url: e.target.value }
                                                })}
                                                className="w-full px-3 py-2 border rounded-lg"
                                                placeholder="https://example.com/logo.png"
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-sm font-medium text-gray-700 mb-1">Primary Color</label>
                                            <div className="flex gap-2">
                                                <input
                                                    type="color"
                                                    value={formData.branding_overrides.primary_color || '#3B82F6'}
                                                    onChange={e => setFormData({
                                                        ...formData,
                                                        branding_overrides: { ...formData.branding_overrides, primary_color: e.target.value }
                                                    })}
                                                    className="w-10 h-10 rounded border cursor-pointer"
                                                />
                                                <input
                                                    type="text"
                                                    value={formData.branding_overrides.primary_color}
                                                    onChange={e => setFormData({
                                                        ...formData,
                                                        branding_overrides: { ...formData.branding_overrides, primary_color: e.target.value }
                                                    })}
                                                    className="flex-1 px-3 py-2 border rounded-lg"
                                                    placeholder="#3B82F6"
                                                />
                                            </div>
                                        </div>
                                        <div>
                                            <label className="block text-sm font-medium text-gray-700 mb-1">Welcome Message</label>
                                            <textarea
                                                value={formData.branding_overrides.welcome_message}
                                                onChange={e => setFormData({
                                                    ...formData,
                                                    branding_overrides: { ...formData.branding_overrides, welcome_message: e.target.value }
                                                })}
                                                className="w-full px-3 py-2 border rounded-lg"
                                                rows={2}
                                                placeholder="Welcome! How can we help you?"
                                            />
                                        </div>
                                    </div>
                                </div>
                            </div>
                            <div className="px-6 py-4 border-t flex justify-end gap-3">
                                <button
                                    type="button"
                                    onClick={() => { setShowModal(false); setEditingDomain(null); resetForm(); }}
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
                                    {saving ? 'Saving...' : (editingDomain ? 'Update' : 'Create')}
                                </button>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </>
    );
}
