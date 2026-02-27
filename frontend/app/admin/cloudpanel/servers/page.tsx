'use client'

import React, { useState, useEffect } from 'react'
import MainHeader from "@/components/MainHeader"
import AdminNav from '@/components/AdminNav'
import { authAPI } from "@/lib/auth"

interface CloudPanelServer {
    id: number
    name: string
    host: string
    ssh_port: number
    ssh_user: string
    is_active: boolean
}

export default function CloudPanelServersPage() {
    const [isMounted, setIsMounted] = useState(false)
    const [user, setUser] = useState<any>(null)
    const [servers, setServers] = useState<CloudPanelServer[]>([])
    const [loading, setLoading] = useState(true)
    const [message, setMessage] = useState({ type: '', text: '' })

    const [serverForm, setServerForm] = useState({
        name: '', host: '', ssh_port: 22, ssh_user: 'root', ssh_password: '', ssh_key: ''
    })

    const fetchServers = async () => {
        try {
            const res = await fetch('http://localhost:8000/cloudpanel/servers')
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

    const handleAddServer = async (e: React.FormEvent) => {
        e.preventDefault()
        try {
            const res = await fetch('http://localhost:8000/cloudpanel/servers', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(serverForm)
            })
            if (res.ok) {
                setMessage({ type: 'success', text: 'Server added successfully!' })
                fetchServers()
                setServerForm({ name: '', host: '', ssh_port: 22, ssh_user: 'root', ssh_password: '', ssh_key: '' })
            } else {
                setMessage({ type: 'error', text: 'Failed to add server.' })
            }
        } catch (err) {
            setMessage({ type: 'error', text: 'Network error while adding server.' })
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
                                    <span className={`px-2 py-1 text-xs rounded-full ${s.is_active ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                                        {s.is_active ? 'Active' : 'Inactive'}
                                    </span>
                                </li>
                            ))}
                        </ul>
                    )}

                    <h3 className="font-semibold text-lg mt-8 mb-4 border-t pt-6">Add New Server</h3>
                    <form onSubmit={handleAddServer} className="space-y-4 max-w-2xl">
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
                                <input type="password" className="w-full p-2 border rounded" value={serverForm.ssh_password} onChange={e => setServerForm({ ...serverForm, ssh_password: e.target.value })} placeholder="Leave blank if using key" />
                            </div>
                        </div>
                        <div>
                            <label className="block text-sm font-medium mb-1">SSH Private Key (Optional)</label>
                            <textarea className="w-full p-2 border rounded h-32 text-xs font-mono" value={serverForm.ssh_key} onChange={e => setServerForm({ ...serverForm, ssh_key: e.target.value })} placeholder="-----BEGIN RSA PRIVATE KEY-----..." />
                        </div>
                        <button type="submit" className="text-white px-6 py-2 rounded shadow font-medium" style={{ backgroundColor: 'var(--button-primary)' }}>
                            Add Server
                        </button>
                    </form>
                </div>
            </main>
        </div>
    )
}
