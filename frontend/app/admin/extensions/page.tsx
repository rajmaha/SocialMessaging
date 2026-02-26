'use client';

import { useState, useEffect } from 'react';
import MainHeader from "@/components/MainHeader";
import AdminNav from '@/components/AdminNav';
import { authAPI, getAuthToken } from "@/lib/auth";
import { useRouter } from 'next/navigation';
import { Phone, Edit2, Check, X, Server, RefreshCw, ToggleLeft, ToggleRight, CheckCircle, AlertCircle, Wifi } from 'lucide-react';

export default function PBXSetup() {
    const user = authAPI.getUser();
    const router = useRouter();

    const [loading, setLoading] = useState(true);
    const [users, setUsers] = useState<any[]>([]);
    const [editingUserId, setEditingUserId] = useState<number | null>(null);
    const [syncing, setSyncing] = useState<number | null>(null);
    const [toggling, setToggling] = useState<number | null>(null);

    const [editForm, setEditForm] = useState({
        extension: '',
        sip_password: ''
    });

    const [message, setMessage] = useState({ type: '', text: '' });

    useEffect(() => {
        fetchUsersAndExtensions();
    }, []);

    const fetchUsersAndExtensions = async () => {
        try {
            const token = getAuthToken();
            if (!token) return router.push('/login');

            const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/admin/extensions`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });

            if (response.ok) {
                const data = await response.json();
                setUsers(data);
            }
        } catch (error) {
            console.error('Failed to fetch extensions:', error);
        } finally {
            setLoading(false);
        }
    };

    const startEdit = (u: any) => {
        setEditingUserId(u.id);
        setEditForm({
            extension: u.extension?.extension || '',
            sip_password: u.extension?.sip_password || ''
        });
    };

    const cancelEdit = () => {
        setEditingUserId(null);
        setEditForm({ extension: '', sip_password: '' });
    };

    const showMessage = (type: string, text: string, duration = 4000) => {
        setMessage({ type, text });
        setTimeout(() => setMessage({ type: '', text: '' }), duration);
    };

    const saveExtension = async (userId: number) => {
        if (!editForm.extension || !editForm.sip_password) {
            showMessage('error', 'Extension and Password are required.');
            return;
        }
        try {
            const token = getAuthToken();
            const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/admin/extensions`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    user_id: userId,
                    extension: editForm.extension,
                    sip_password: editForm.sip_password
                })
            });

            if (!response.ok) {
                const errData = await response.json();
                throw new Error(errData.detail || 'Failed to save extension.');
            }

            const result = await response.json();
            const syncMsg = result.freepbx_synced
                ? '✅ Extension assigned & synced to FreePBX!'
                : '⚠️ Extension saved locally, but FreePBX sync failed. Configure FreePBX credentials in Telephony Settings.';

            showMessage(result.freepbx_synced ? 'success' : 'warning', syncMsg, 6000);
            setEditingUserId(null);
            fetchUsersAndExtensions();
        } catch (error: any) {
            showMessage('error', error.message);
        }
    };

    const removeExtension = async (userId: number) => {
        if (!confirm('Are you sure you want to remove this extension? It will also be deleted from FreePBX.')) return;

        try {
            const token = getAuthToken();
            const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/admin/extensions/${userId}`, {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${token}` }
            });

            if (response.ok) {
                showMessage('success', 'Extension removed from system and FreePBX.');
                fetchUsersAndExtensions();
            }
        } catch (error) {
            showMessage('error', 'Failed to remove extension.');
        }
    };

    const toggleExtension = async (userId: number) => {
        setToggling(userId);
        try {
            const token = getAuthToken();
            const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/admin/extensions/${userId}/toggle`, {
                method: 'PATCH',
                headers: { 'Authorization': `Bearer ${token}` }
            });

            if (response.ok) {
                const result = await response.json();
                showMessage('success', `Extension ${result.extension} ${result.is_enabled ? 'enabled' : 'disabled'}.`);
                fetchUsersAndExtensions();
            } else {
                const e = await response.json();
                showMessage('error', e.detail || 'Toggle failed.');
            }
        } catch (error) {
            showMessage('error', 'Failed to toggle extension.');
        } finally {
            setToggling(null);
        }
    };

    const syncExtension = async (userId: number) => {
        setSyncing(userId);
        try {
            const token = getAuthToken();
            const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/admin/extensions/${userId}/sync`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}` }
            });

            if (response.ok) {
                const result = await response.json();
                showMessage(result.freepbx_synced ? 'success' : 'error', result.message);
                fetchUsersAndExtensions();
            }
        } catch (error) {
            showMessage('error', 'Failed to sync extension.');
        } finally {
            setSyncing(null);
        }
    };

    return (
        <div className="ml-60 pt-14 min-h-screen bg-gray-50">
            <MainHeader user={user!} />
            <AdminNav />

            <main className="max-w-6xl mx-auto p-6">
                <div className="mb-8 flex justify-between items-center">
                    <div>
                        <h2 className="text-3xl font-bold text-gray-900 flex items-center gap-2">
                            <Server className="w-8 h-8 text-indigo-600" /> PBX Extensions Setup
                        </h2>
                        <p className="text-gray-600 mt-2">Assign extensions to agents — they are automatically created in FreePBX.</p>
                    </div>

                    <button
                        onClick={() => router.push('/admin/telephony')}
                        className="px-4 py-2 bg-white border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 flex items-center shadow-sm gap-2"
                    >
                        <Phone className="w-4 h-4" /> FreePBX Settings
                    </button>
                </div>

                {/* Legend */}
                <div className="flex items-center gap-6 mb-6 bg-white border border-gray-200 rounded-lg p-3 px-4 text-sm text-gray-600 shadow-sm">
                    <div className="flex items-center gap-1.5"><CheckCircle className="w-4 h-4 text-green-500" /> Synced to FreePBX</div>
                    <div className="flex items-center gap-1.5"><AlertCircle className="w-4 h-4 text-amber-500" /> Not yet synced</div>
                    <div className="flex items-center gap-1.5"><ToggleRight className="w-4 h-4 text-green-500" /> Extension enabled</div>
                    <div className="flex items-center gap-1.5"><ToggleLeft className="w-4 h-4 text-gray-400" /> Extension disabled</div>
                </div>

                {message.text && (
                    <div className={`p-4 rounded-md mb-6 ${message.type === 'success' ? 'bg-green-50 text-green-800 border border-green-200' :
                            message.type === 'warning' ? 'bg-amber-50 text-amber-800 border border-amber-200' :
                                'bg-red-50 text-red-800 border border-red-200'
                        }`}>
                        {message.text}
                    </div>
                )}

                <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                    {loading ? (
                        <div className="flex justify-center p-12">
                            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
                        </div>
                    ) : (
                        <table className="min-w-full divide-y divide-gray-200">
                            <thead className="bg-gray-50">
                                <tr>
                                    <th className="px-6 py-4 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Agent / User</th>
                                    <th className="px-6 py-4 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Role</th>
                                    <th className="px-6 py-4 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Extension</th>
                                    <th className="px-6 py-4 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">SIP Password</th>
                                    <th className="px-6 py-4 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">FreePBX</th>
                                    <th className="px-6 py-4 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">State</th>
                                    <th className="px-6 py-4 text-right text-xs font-semibold text-gray-500 uppercase tracking-wider">Actions</th>
                                </tr>
                            </thead>
                            <tbody className="bg-white divide-y divide-gray-200">
                                {users.map((u) => {
                                    const isEditing = editingUserId === u.id;
                                    const isSyncing = syncing === u.id;
                                    const isToggling = toggling === u.id;
                                    const ext = u.extension;

                                    return (
                                        <tr key={u.id} className="hover:bg-gray-50 transition-colors">
                                            <td className="px-6 py-4 whitespace-nowrap">
                                                <div className="text-sm font-medium text-gray-900">{u.full_name}</div>
                                                <div className="text-sm text-gray-500">{u.email}</div>
                                            </td>
                                            <td className="px-6 py-4 whitespace-nowrap">
                                                <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${u.role === 'admin' ? 'bg-purple-100 text-purple-800' : 'bg-green-100 text-green-800'}`}>
                                                    {u.role}
                                                </span>
                                            </td>

                                            <td className="px-6 py-4 whitespace-nowrap">
                                                {isEditing ? (
                                                    <input
                                                        type="text"
                                                        className="w-24 px-3 py-1.5 border border-indigo-300 rounded text-sm focus:ring-indigo-500 focus:border-indigo-500"
                                                        placeholder="e.g. 1001"
                                                        value={editForm.extension}
                                                        onChange={(e) => setEditForm({ ...editForm, extension: e.target.value })}
                                                    />
                                                ) : (
                                                    ext ? (
                                                        <span className="font-semibold text-indigo-600 px-3 py-1 border border-indigo-100 bg-indigo-50 rounded-md">
                                                            Ext: {ext.extension}
                                                        </span>
                                                    ) : (
                                                        <span className="text-sm text-gray-400 italic">Not Assigned</span>
                                                    )
                                                )}
                                            </td>

                                            <td className="px-6 py-4 whitespace-nowrap">
                                                {isEditing ? (
                                                    <input
                                                        type="text"
                                                        className="w-32 px-3 py-1.5 border border-indigo-300 rounded text-sm focus:ring-indigo-500 focus:border-indigo-500"
                                                        placeholder="SIP Secret"
                                                        value={editForm.sip_password}
                                                        onChange={(e) => setEditForm({ ...editForm, sip_password: e.target.value })}
                                                    />
                                                ) : (
                                                    ext ? (
                                                        <span className="text-sm font-mono text-gray-500 bg-gray-100 px-2 py-1 rounded">••••••••</span>
                                                    ) : (
                                                        <span className="text-sm text-gray-400">-</span>
                                                    )
                                                )}
                                            </td>

                                            {/* FreePBX Sync Status */}
                                            <td className="px-6 py-4 whitespace-nowrap">
                                                {ext ? (
                                                    <div className="flex items-center gap-2">
                                                        {ext.freepbx_synced ? (
                                                            <span className="flex items-center gap-1 text-xs font-medium text-green-700 bg-green-50 border border-green-200 px-2 py-1 rounded-full">
                                                                <CheckCircle className="w-3 h-3" /> Synced
                                                            </span>
                                                        ) : (
                                                            <span className="flex items-center gap-1 text-xs font-medium text-amber-700 bg-amber-50 border border-amber-200 px-2 py-1 rounded-full">
                                                                <AlertCircle className="w-3 h-3" /> Not synced
                                                            </span>
                                                        )}
                                                        {!isEditing && (
                                                            <button
                                                                onClick={() => syncExtension(u.id)}
                                                                disabled={isSyncing}
                                                                title="Sync to FreePBX"
                                                                className="text-gray-400 hover:text-indigo-600 transition-colors disabled:opacity-40"
                                                            >
                                                                <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
                                                            </button>
                                                        )}
                                                    </div>
                                                ) : (
                                                    <span className="text-sm text-gray-400">-</span>
                                                )}
                                            </td>

                                            {/* Enable/Disable Toggle */}
                                            <td className="px-6 py-4 whitespace-nowrap">
                                                {ext ? (
                                                    <button
                                                        onClick={() => toggleExtension(u.id)}
                                                        disabled={isToggling || isEditing}
                                                        title={ext.is_enabled ? 'Click to disable' : 'Click to enable'}
                                                        className={`flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full border transition-colors disabled:opacity-50 ${ext.is_enabled
                                                                ? 'bg-green-50 text-green-700 border-green-200 hover:bg-green-100'
                                                                : 'bg-gray-100 text-gray-500 border-gray-200 hover:bg-gray-200'
                                                            }`}
                                                    >
                                                        {ext.is_enabled
                                                            ? <><ToggleRight className="w-4 h-4" /> Enabled</>
                                                            : <><ToggleLeft className="w-4 h-4" /> Disabled</>
                                                        }
                                                    </button>
                                                ) : (
                                                    <span className="text-sm text-gray-400">-</span>
                                                )}
                                            </td>

                                            {/* Actions */}
                                            <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                                                {isEditing ? (
                                                    <div className="flex justify-end space-x-2">
                                                        <button
                                                            onClick={() => saveExtension(u.id)}
                                                            className="text-green-600 hover:text-green-900 bg-green-50 p-1.5 rounded-md border border-green-200"
                                                            title="Save"
                                                        >
                                                            <Check className="w-4 h-4" />
                                                        </button>
                                                        <button
                                                            onClick={cancelEdit}
                                                            className="text-gray-500 hover:text-gray-700 bg-gray-100 p-1.5 rounded-md border border-gray-200"
                                                            title="Cancel"
                                                        >
                                                            <X className="w-4 h-4" />
                                                        </button>
                                                    </div>
                                                ) : (
                                                    <div className="flex justify-end space-x-3">
                                                        <button
                                                            onClick={() => startEdit(u)}
                                                            className="text-indigo-600 hover:text-indigo-900 flex items-center text-xs bg-indigo-50 px-3 py-1.5 rounded-md border border-indigo-100 transition-colors gap-1"
                                                        >
                                                            <Edit2 className="w-3.5 h-3.5" /> {ext ? 'Edit' : 'Assign SIP'}
                                                        </button>

                                                        {ext && (
                                                            <button
                                                                onClick={() => removeExtension(u.id)}
                                                                className="text-red-500 hover:text-red-700 text-xs px-2 py-1.5 transition-colors"
                                                            >
                                                                Remove
                                                            </button>
                                                        )}
                                                    </div>
                                                )}
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    )}
                </div>
            </main>
        </div>
    );
}
