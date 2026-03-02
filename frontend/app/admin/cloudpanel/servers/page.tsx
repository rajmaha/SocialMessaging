'use client'

import React, { useState, useEffect } from 'react'
import MainHeader from "@/components/MainHeader"
import AdminNav from '@/components/AdminNav'
import { authAPI, getAuthToken } from "@/lib/auth"
import { API_URL } from "@/lib/config"

interface CloudPanelServer {
    id: number
    name: string
    host: string
    ssh_port: number
    ssh_user: string
    is_active: boolean
}

const emptyForm = { name: '', host: '', ssh_port: 22, ssh_user: 'root', ssh_password: '', ssh_key: '' }

function authHeaders(): Record<string, string> {
    const token = getAuthToken() || ''
    return { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }
}

export default function CloudPanelServersPage() {
    const [isMounted, setIsMounted] = useState(false)
    const [user, setUser] = useState<any>(null)
    const [servers, setServers] = useState<CloudPanelServer[]>([])
    const [loading, setLoading] = useState(true)
    const [message, setMessage] = useState({ type: '', text: '' })
    const [showPassword, setShowPassword] = useState(false)
    const [testingConnection, setTestingConnection] = useState(false)
    const [testingServerId, setTestingServerId] = useState<number | null>(null)
    const [editingServer, setEditingServer] = useState<CloudPanelServer | null>(null)
    const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null)

    const [serverForm, setServerForm] = useState({ ...emptyForm })

    const fetchServers = async () => {
        try {
            const res = await fetch(`${API_URL}/cloudpanel/servers`, {
                headers: { 'Authorization': `Bearer ${getAuthToken()}` }
            })
            if (res.ok) {
                const data = await res.json()
                setServers(data)
            }
        } catch (err) {
            console.error('Failed to fetch servers', err)
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => {
        setIsMounted(true)
        setUser(authAPI.getUser())
        fetchServers()
    }, [])

    const resetForm = () => {
        setServerForm({ ...emptyForm })
        setEditingServer(null)
        setShowPassword(false)
    }

    const handleAddServer = async (e: React.FormEvent) => {
        e.preventDefault()
        try {
            const res = await fetch(`${API_URL}/cloudpanel/servers`, {
                method: 'POST',
                headers: authHeaders(),
                body: JSON.stringify(serverForm)
            })
            if (res.ok) {
                setMessage({ type: 'success', text: 'Server added successfully!' })
                fetchServers()
                resetForm()
            } else {
                const data = await res.json().catch(() => null)
                setMessage({ type: 'error', text: data?.detail || 'Failed to add server.' })
            }
        } catch (err) {
            setMessage({ type: 'error', text: 'Network error while adding server.' })
        }
    }

    const handleEditClick = async (server: CloudPanelServer) => {
        setEditingServer(server)
        setShowPassword(false)
        setMessage({ type: '', text: '' })
        // Fetch full server details including credentials
        try {
            const res = await fetch(`${API_URL}/cloudpanel/servers/${server.id}`, {
                headers: { 'Authorization': `Bearer ${getAuthToken()}` }
            })
            if (res.ok) {
                const data = await res.json()
                setServerForm({
                    name: data.name,
                    host: data.host,
                    ssh_port: data.ssh_port,
                    ssh_user: data.ssh_user,
                    ssh_password: data.ssh_password || '',
                    ssh_key: data.ssh_key || ''
                })
            } else {
                // Fallback without credentials
                setServerForm({
                    name: server.name,
                    host: server.host,
                    ssh_port: server.ssh_port,
                    ssh_user: server.ssh_user,
                    ssh_password: '',
                    ssh_key: ''
                })
            }
        } catch {
            setServerForm({
                name: server.name,
                host: server.host,
                ssh_port: server.ssh_port,
                ssh_user: server.ssh_user,
                ssh_password: '',
                ssh_key: ''
            })
        }
        document.getElementById('server-form')?.scrollIntoView({ behavior: 'smooth' })
    }

    const handleUpdateServer = async (e: React.FormEvent) => {
        e.preventDefault()
        if (!editingServer) return
        try {
            const payload: Record<string, any> = {
                name: serverForm.name,
                host: serverForm.host,
                ssh_port: serverForm.ssh_port,
                ssh_user: serverForm.ssh_user,
            }
            if (serverForm.ssh_password) payload.ssh_password = serverForm.ssh_password
            if (serverForm.ssh_key) payload.ssh_key = serverForm.ssh_key

            const res = await fetch(`${API_URL}/cloudpanel/servers/${editingServer.id}`, {
                method: 'PUT',
                headers: authHeaders(),
                body: JSON.stringify(payload)
            })
            if (res.ok) {
                setMessage({ type: 'success', text: 'Server updated successfully!' })
                fetchServers()
                resetForm()
            } else {
                const data = await res.json().catch(() => null)
                setMessage({ type: 'error', text: data?.detail || 'Failed to update server.' })
            }
        } catch (err) {
            setMessage({ type: 'error', text: 'Network error while updating server.' })
        }
    }

    const handleDeleteServer = async (serverId: number) => {
        try {
            const res = await fetch(`${API_URL}/cloudpanel/servers/${serverId}`, {
                method: 'DELETE',
                headers: authHeaders()
            })
            if (res.ok) {
                setMessage({ type: 'success', text: 'Server deleted successfully!' })
                setDeleteConfirm(null)
                if (editingServer?.id === serverId) resetForm()
                fetchServers()
            } else {
                const data = await res.json().catch(() => null)
                setMessage({ type: 'error', text: data?.detail || 'Failed to delete server.' })
            }
        } catch (err) {
            setMessage({ type: 'error', text: 'Network error while deleting server.' })
        }
    }

    const handleTestConnection = async () => {
        if (!serverForm.host) {
            setMessage({ type: 'error', text: 'Please fill in the host before testing.' })
            return
        }
        if (!serverForm.ssh_password && !serverForm.ssh_key) {
            setMessage({ type: 'error', text: 'Please provide SSH password or key before testing.' })
            return
        }
        setTestingConnection(true)
        setMessage({ type: '', text: '' })
        try {
            const res = await fetch(`${API_URL}/cloudpanel/servers/test-connection`, {
                method: 'POST',
                headers: authHeaders(),
                body: JSON.stringify(serverForm)
            })
            const data = await res.json()
            if (data.success) {
                setMessage({ type: 'success', text: data.message })
            } else {
                setMessage({ type: 'error', text: data.message })
            }
        } catch (err) {
            setMessage({ type: 'error', text: 'Network error while testing connection.' })
        } finally {
            setTestingConnection(false)
        }
    }

    const handleTestExistingServer = async (serverId: number) => {
        setTestingServerId(serverId)
        setMessage({ type: '', text: '' })
        try {
            const res = await fetch(`${API_URL}/cloudpanel/servers/${serverId}/test-connection`, {
                method: 'POST',
                headers: authHeaders()
            })
            const data = await res.json()
            if (data.success) {
                setMessage({ type: 'success', text: data.message })
            } else {
                setMessage({ type: 'error', text: data.message })
            }
        } catch (err) {
            setMessage({ type: 'error', text: 'Network error while testing connection.' })
        } finally {
            setTestingServerId(null)
        }
    }

    if (!isMounted) {
        return (
            <div className="ml-60 pt-14 min-h-screen bg-gray-50" />
        )
    }

    return (
        <div className="ml-60 pt-14 min-h-screen bg-gray-50">
            <MainHeader user={user!} />
            <AdminNav />
            <main className="w-full p-6">
                <h1 className="text-2xl font-bold text-gray-900 mb-6">CloudPanel Servers</h1>

                {message.text && (
                    <div className={`p-4 mb-6 rounded-md ${message.type === 'error' ? 'bg-red-100 text-red-700' :
                        message.type === 'success' ? 'bg-green-100 text-green-700' :
                            'bg-blue-100 text-blue-700'
                        }`}>
                        {message.text}
                    </div>
                )}

                <div className="bg-white p-6 rounded-lg shadow border border-gray-100">
                    <h2 className="text-xl font-bold mb-4">Configured Servers</h2>
                    {loading ? (
                        <p>Loading servers...</p>
                    ) : servers.length === 0 ? (
                        <p className="text-gray-500 mb-4">No servers configured.</p>
                    ) : (
                        <ul className="mb-6 space-y-2">
                            {servers.map(s => (
                                <li key={s.id} className="p-3 bg-gray-50 rounded border flex justify-between items-center">
                                    <div>
                                        <strong className="text-gray-900">{s.name}</strong>
                                        <span className="text-gray-600 ml-2">({s.host}:{s.ssh_port}) - {s.ssh_user}</span>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <span className={`px-2 py-1 text-xs rounded-full ${s.is_active ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                                            {s.is_active ? 'Active' : 'Inactive'}
                                        </span>
                                        <button
                                            onClick={() => handleTestExistingServer(s.id)}
                                            disabled={testingServerId === s.id}
                                            className="p-1.5 text-gray-500 hover:text-green-600 hover:bg-green-50 rounded transition-colors disabled:opacity-50"
                                            title="Test connection"
                                        >
                                            {testingServerId === s.id ? (
                                                <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                                                </svg>
                                            ) : (
                                                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                                    <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                                                    <polyline points="22 4 12 14.01 9 11.01" />
                                                </svg>
                                            )}
                                        </button>
                                        <button
                                            onClick={() => handleEditClick(s)}
                                            className="p-1.5 text-gray-500 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors"
                                            title="Edit server"
                                        >
                                            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                                                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                                            </svg>
                                        </button>
                                        {deleteConfirm === s.id ? (
                                            <div className="flex items-center gap-1">
                                                <button
                                                    onClick={() => handleDeleteServer(s.id)}
                                                    className="px-2 py-1 text-xs bg-red-600 text-white rounded hover:bg-red-700"
                                                >
                                                    Confirm
                                                </button>
                                                <button
                                                    onClick={() => setDeleteConfirm(null)}
                                                    className="px-2 py-1 text-xs bg-gray-200 text-gray-700 rounded hover:bg-gray-300"
                                                >
                                                    Cancel
                                                </button>
                                            </div>
                                        ) : (
                                            <button
                                                onClick={() => setDeleteConfirm(s.id)}
                                                className="p-1.5 text-gray-500 hover:text-red-600 hover:bg-red-50 rounded transition-colors"
                                                title="Delete server"
                                            >
                                                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                                    <polyline points="3 6 5 6 21 6" />
                                                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                                                    <line x1="10" y1="11" x2="10" y2="17" />
                                                    <line x1="14" y1="11" x2="14" y2="17" />
                                                </svg>
                                            </button>
                                        )}
                                    </div>
                                </li>
                            ))}
                        </ul>
                    )}

                    <h3 id="server-form" className="font-semibold text-lg mt-8 mb-4 border-t pt-6">
                        {editingServer ? `Edit Server: ${editingServer.name}` : 'Add New Server'}
                    </h3>
                    <form onSubmit={editingServer ? handleUpdateServer : handleAddServer} className="space-y-4 max-w-2xl">
                        <div>
                            <label className="block text-sm font-medium mb-1">Name</label>
                            <input required type="text" className="w-full p-2 border rounded" value={serverForm.name} onChange={e => setServerForm({ ...serverForm, name: e.target.value })} placeholder="e.g. Production Server" />
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="block text-sm font-medium mb-1">Host IP / Domain</label>
                                <input required type="text" className="w-full p-2 border rounded" value={serverForm.host} onChange={e => setServerForm({ ...serverForm, host: e.target.value })} placeholder="e.g. 192.168.1.100" />
                            </div>
                            <div>
                                <label className="block text-sm font-medium mb-1">SSH Port</label>
                                <input required type="number" className="w-full p-2 border rounded" value={serverForm.ssh_port} onChange={e => setServerForm({ ...serverForm, ssh_port: parseInt(e.target.value) })} />
                            </div>
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="block text-sm font-medium mb-1">SSH User</label>
                                <input required type="text" className="w-full p-2 border rounded" value={serverForm.ssh_user} onChange={e => setServerForm({ ...serverForm, ssh_user: e.target.value })} />
                            </div>
                            <div>
                                <label className="block text-sm font-medium mb-1">SSH Password</label>
                                <div className="relative">
                                    <input
                                        type={showPassword ? 'text' : 'password'}
                                        className="w-full p-2 border rounded pr-10"
                                        value={serverForm.ssh_password}
                                        onChange={e => setServerForm({ ...serverForm, ssh_password: e.target.value })}
                                        placeholder="Leave blank if using key"
                                    />
                                    <button
                                        type="button"
                                        onClick={() => setShowPassword(!showPassword)}
                                        className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700 p-1"
                                        title={showPassword ? 'Hide password' : 'Show password'}
                                    >
                                        {showPassword ? (
                                            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                                <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
                                                <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
                                                <line x1="1" y1="1" x2="23" y2="23" />
                                            </svg>
                                        ) : (
                                            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                                                <circle cx="12" cy="12" r="3" />
                                            </svg>
                                        )}
                                    </button>
                                </div>
                            </div>
                        </div>
                        <div>
                            <label className="block text-sm font-medium mb-1">SSH Private Key (Optional)</label>
                            <textarea className="w-full p-2 border rounded h-32 text-xs font-mono" value={serverForm.ssh_key} onChange={e => setServerForm({ ...serverForm, ssh_key: e.target.value })} placeholder="-----BEGIN RSA PRIVATE KEY-----..." />
                        </div>
                        <div className="flex gap-3">
                            <button type="submit" className="text-white px-6 py-2 rounded shadow font-medium" style={{ backgroundColor: 'var(--button-primary)' }}>
                                {editingServer ? 'Update Server' : 'Add Server'}
                            </button>
                            <button
                                type="button"
                                onClick={handleTestConnection}
                                disabled={testingConnection}
                                className="px-6 py-2 rounded shadow font-medium border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                            >
                                {testingConnection ? (
                                    <>
                                        <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                                        </svg>
                                        Testing...
                                    </>
                                ) : (
                                    'Test Connection'
                                )}
                            </button>
                            {editingServer && (
                                <button
                                    type="button"
                                    onClick={resetForm}
                                    className="px-6 py-2 rounded shadow font-medium border border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
                                >
                                    Cancel
                                </button>
                            )}
                        </div>
                    </form>
                </div>
            </main>
        </div>
    )
}
