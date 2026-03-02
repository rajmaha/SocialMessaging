'use client'

import React, { useState, useEffect } from 'react'
import MainHeader from "@/components/MainHeader"
import AdminNav from '@/components/AdminNav'
import { authAPI, getAuthToken } from "@/lib/auth"

interface CloudPanelSite {
    id: number
    server_id: number
    domain_name: string
    php_version: string | null
    site_user: string | null
    db_name: string | null
    db_user: string | null
    template_name: string | null
    created_at: string
    server_name: string | null
    server_host: string | null
}

interface CloudPanelServer {
    id: number
    name: string
    host: string
}

function authHeaders(): Record<string, string> {
    const token = getAuthToken() || ''
    return { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }
}

export default function CloudPanelSitesPage() {
    const [isMounted, setIsMounted] = useState(false)
    const [user, setUser] = useState<any>(null)
    const [sites, setSites] = useState<CloudPanelSite[]>([])
    const [servers, setServers] = useState<CloudPanelServer[]>([])
    const [loading, setLoading] = useState(true)
    const [message, setMessage] = useState({ type: '', text: '' })
    const [filterServerId, setFilterServerId] = useState<string>('')

    // Delete flow: step 1 = confirm, step 2 = password
    const [deleteConfirmId, setDeleteConfirmId] = useState<number | null>(null)
    const [passwordModalSiteId, setPasswordModalSiteId] = useState<number | null>(null)
    const [deletePassword, setDeletePassword] = useState('')
    const [deleting, setDeleting] = useState(false)

    useEffect(() => {
        setIsMounted(true)
        setUser(authAPI.getUser())
        fetchServers()
        fetchSites()
    }, [])

    const fetchServers = async () => {
        try {
            const res = await fetch('http://localhost:8000/cloudpanel/servers', {
                headers: { 'Authorization': `Bearer ${getAuthToken()}` }
            })
            if (res.ok) setServers(await res.json())
        } catch (err) {
            console.error('Failed to fetch servers', err)
        }
    }

    const fetchSites = async (serverId?: string) => {
        setLoading(true)
        try {
            const url = serverId
                ? `http://localhost:8000/cloudpanel/sites?server_id=${serverId}`
                : 'http://localhost:8000/cloudpanel/sites'
            const res = await fetch(url, {
                headers: { 'Authorization': `Bearer ${getAuthToken()}` }
            })
            if (res.ok) setSites(await res.json())
        } catch (err) {
            console.error('Failed to fetch sites', err)
        } finally {
            setLoading(false)
        }
    }

    const handleFilterChange = (serverId: string) => {
        setFilterServerId(serverId)
        fetchSites(serverId || undefined)
    }

    const handleDeleteConfirm = (siteId: number) => {
        setDeleteConfirmId(siteId)
        setMessage({ type: '', text: '' })
    }

    const handleDeleteProceed = (siteId: number) => {
        setDeleteConfirmId(null)
        setPasswordModalSiteId(siteId)
        setDeletePassword('')
    }

    const handleDeleteCancel = () => {
        setDeleteConfirmId(null)
        setPasswordModalSiteId(null)
        setDeletePassword('')
    }

    const handleDeleteExecute = async () => {
        if (!passwordModalSiteId || !deletePassword) return
        setDeleting(true)
        setMessage({ type: '', text: '' })

        try {
            const res = await fetch(`http://localhost:8000/cloudpanel/sites/${passwordModalSiteId}`, {
                method: 'DELETE',
                headers: authHeaders(),
                body: JSON.stringify({ password: deletePassword })
            })
            const data = await res.json()
            if (res.ok) {
                setMessage({ type: 'success', text: data.message })
                setPasswordModalSiteId(null)
                setDeletePassword('')
                fetchSites(filterServerId || undefined)
            } else {
                setMessage({ type: 'error', text: data.detail || 'Failed to delete site.' })
            }
        } catch (err) {
            setMessage({ type: 'error', text: 'Network error while deleting site.' })
        } finally {
            setDeleting(false)
        }
    }

    if (!isMounted) {
        return <div className="ml-60 pt-14 min-h-screen bg-gray-50" />
    }

    return (
        <div className="ml-60 pt-14 min-h-screen bg-gray-50">
            <MainHeader user={user!} />
            <AdminNav />
            <main className="w-full p-6">
                <h1 className="text-2xl font-bold text-gray-900 mb-6">Manage Sites</h1>

                {message.text && (
                    <div className={`p-4 mb-6 rounded-md ${message.type === 'error' ? 'bg-red-100 text-red-700' :
                        message.type === 'success' ? 'bg-green-100 text-green-700' :
                            'bg-blue-100 text-blue-700'
                        }`}>
                        {message.text}
                    </div>
                )}

                {/* Password Modal */}
                {passwordModalSiteId && (
                    <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center">
                        <div className="bg-white rounded-xl shadow-2xl p-6 max-w-sm w-full mx-4">
                            <h3 className="text-lg font-semibold text-gray-900 mb-2">Confirm Deletion</h3>
                            <p className="text-sm text-gray-500 mb-4">
                                Enter your password to permanently delete <strong>{sites.find(s => s.id === passwordModalSiteId)?.domain_name}</strong> and its database from the server.
                            </p>
                            <input
                                type="password"
                                className="w-full p-2 border rounded mb-4"
                                placeholder="Enter your password"
                                value={deletePassword}
                                onChange={e => setDeletePassword(e.target.value)}
                                onKeyDown={e => e.key === 'Enter' && handleDeleteExecute()}
                                autoFocus
                            />
                            {message.type === 'error' && message.text && (
                                <p className="text-sm text-red-600 mb-3">{message.text}</p>
                            )}
                            <div className="flex gap-3 justify-end">
                                <button
                                    onClick={handleDeleteCancel}
                                    className="px-4 py-2 text-sm rounded border border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
                                    disabled={deleting}
                                >
                                    Cancel
                                </button>
                                <button
                                    onClick={handleDeleteExecute}
                                    disabled={deleting || !deletePassword}
                                    className="px-4 py-2 text-sm rounded bg-red-600 text-white hover:bg-red-700 disabled:opacity-50 flex items-center gap-2"
                                >
                                    {deleting ? (
                                        <>
                                            <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                                            </svg>
                                            Deleting...
                                        </>
                                    ) : 'Delete Site'}
                                </button>
                            </div>
                        </div>
                    </div>
                )}

                {/* Deleting Modal */}
                {deleting && !passwordModalSiteId && (
                    <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center">
                        <div className="bg-white rounded-xl shadow-2xl p-8 max-w-sm w-full mx-4 text-center">
                            <svg className="animate-spin h-12 w-12 mx-auto mb-4 text-red-600" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                            </svg>
                            <h3 className="text-lg font-semibold text-gray-900 mb-2">Deleting Site</h3>
                            <p className="text-sm text-gray-500">Removing site and database from server...</p>
                        </div>
                    </div>
                )}

                <div className="bg-white p-6 rounded-lg shadow border border-gray-100">
                    <div className="flex items-center justify-between mb-6">
                        <h2 className="text-xl font-bold">Deployed Sites</h2>
                        <div className="flex items-center gap-3">
                            <select
                                className="p-2 border rounded text-sm"
                                value={filterServerId}
                                onChange={e => handleFilterChange(e.target.value)}
                            >
                                <option value="">All Servers</option>
                                {servers.map(s => (
                                    <option key={s.id} value={s.id}>{s.name} ({s.host})</option>
                                ))}
                            </select>
                            <button
                                onClick={() => fetchSites(filterServerId || undefined)}
                                className="p-2 text-gray-500 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors"
                                title="Refresh"
                            >
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <polyline points="23 4 23 10 17 10" />
                                    <polyline points="1 20 1 14 7 14" />
                                    <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
                                </svg>
                            </button>
                        </div>
                    </div>

                    {loading ? (
                        <p className="text-gray-500">Loading sites...</p>
                    ) : sites.length === 0 ? (
                        <p className="text-gray-500">No deployed sites found.</p>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm text-left">
                                <thead className="text-xs text-gray-500 uppercase bg-gray-50 border-b">
                                    <tr>
                                        <th className="px-4 py-3">Domain</th>
                                        <th className="px-4 py-3">Server</th>
                                        <th className="px-4 py-3">PHP</th>
                                        <th className="px-4 py-3">DB Name</th>
                                        <th className="px-4 py-3">DB User</th>
                                        <th className="px-4 py-3">Template</th>
                                        <th className="px-4 py-3">Created</th>
                                        <th className="px-4 py-3 text-right">Actions</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-100">
                                    {sites.map(site => (
                                        <tr key={site.id} className="hover:bg-gray-50">
                                            <td className="px-4 py-3 font-medium text-gray-900">{site.domain_name}</td>
                                            <td className="px-4 py-3 text-gray-600">{site.server_name || '-'}</td>
                                            <td className="px-4 py-3 text-gray-600">{site.php_version || '-'}</td>
                                            <td className="px-4 py-3">
                                                {site.db_name ? (
                                                    <code className="text-xs bg-gray-100 px-2 py-1 rounded">{site.db_name}</code>
                                                ) : '-'}
                                            </td>
                                            <td className="px-4 py-3">
                                                {site.db_user ? (
                                                    <code className="text-xs bg-gray-100 px-2 py-1 rounded">{site.db_user}</code>
                                                ) : '-'}
                                            </td>
                                            <td className="px-4 py-3 text-gray-600">{site.template_name || '-'}</td>
                                            <td className="px-4 py-3 text-gray-500 text-xs">
                                                {new Date(site.created_at).toLocaleDateString()}
                                            </td>
                                            <td className="px-4 py-3 text-right">
                                                {deleteConfirmId === site.id ? (
                                                    <div className="flex items-center justify-end gap-1">
                                                        <button
                                                            onClick={() => handleDeleteProceed(site.id)}
                                                            className="px-2 py-1 text-xs bg-red-600 text-white rounded hover:bg-red-700"
                                                        >
                                                            Yes, Delete
                                                        </button>
                                                        <button
                                                            onClick={handleDeleteCancel}
                                                            className="px-2 py-1 text-xs bg-gray-200 text-gray-700 rounded hover:bg-gray-300"
                                                        >
                                                            Cancel
                                                        </button>
                                                    </div>
                                                ) : (
                                                    <button
                                                        onClick={() => handleDeleteConfirm(site.id)}
                                                        className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors"
                                                        title="Delete site"
                                                    >
                                                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                                            <polyline points="3 6 5 6 21 6" />
                                                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                                                            <line x1="10" y1="11" x2="10" y2="17" />
                                                            <line x1="14" y1="11" x2="14" y2="17" />
                                                        </svg>
                                                    </button>
                                                )}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
            </main>
        </div>
    )
}
