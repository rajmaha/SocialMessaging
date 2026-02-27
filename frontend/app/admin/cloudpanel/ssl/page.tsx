'use client'

import React, { useState, useEffect } from 'react'
import MainHeader from "@/components/MainHeader"
import AdminNav from '@/components/AdminNav'
import { authAPI } from "@/lib/auth"

interface CloudPanelServer {
    id: number
    name: string
    host: string
}

export default function CloudPanelSSLPage() {
    const [isMounted, setIsMounted] = useState(false)
    const [user, setUser] = useState<any>(null)
    const [servers, setServers] = useState<CloudPanelServer[]>([])
    const [message, setMessage] = useState({ type: '', text: '' })

    const [selectedMonitorServerId, setSelectedMonitorServerId] = useState<string>('')
    const [sslReports, setSslReports] = useState<{ domain: string, expiry: string }[]>([])
    const [loadingReport, setLoadingReport] = useState(false)
    const [renewingDomain, setRenewingDomain] = useState<string | null>(null)

    const fetchServers = async () => {
        try {
            const res = await fetch('http://localhost:8000/cloudpanel/servers')
            if (res.ok) {
                const data = await res.json()
                setServers(data)
            }
        } catch (err) {
            console.error('Failed to fetch servers', err)
        }
    }

    useEffect(() => {
        setIsMounted(true)
        setUser(authAPI.getUser())
        fetchServers()
    }, [])

    const fetchSslReport = async (serverId: string) => {
        if (!serverId) {
            setSslReports([])
            return
        }
        setLoadingReport(true)
        try {
            const res = await fetch(`http://localhost:8000/cloudpanel/servers/${serverId}/ssl-report`)
            if (res.ok) {
                const data = await res.json()
                setSslReports(data)
            } else {
                setMessage({ type: 'error', text: 'Failed to fetch SSL report' })
            }
        } catch (err) {
            setMessage({ type: 'error', text: 'Network error fetching SSL report' })
        } finally {
            setLoadingReport(false)
        }
    }

    const handleRenewSsl = async (domain: string) => {
        if (!selectedMonitorServerId) return
        setRenewingDomain(domain)
        try {
            const res = await fetch(`http://localhost:8000/cloudpanel/servers/${selectedMonitorServerId}/sites/${domain}/renew-ssl`, {
                method: 'POST'
            })
            if (res.ok) {
                setMessage({ type: 'success', text: `SSL renewed for ${domain}` })
                fetchSslReport(selectedMonitorServerId)
            } else {
                setMessage({ type: 'error', text: `Failed to renew SSL for ${domain}` })
            }
        } catch (err) {
            setMessage({ type: 'error', text: 'Network error during SSL renewal' })
        } finally {
            setRenewingDomain(null)
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
                <h1 className="text-2xl font-bold text-gray-900 mb-6">SSL Monitor & Renewal</h1>

                {message.text && (
                    <div className={`p-4 mb-6 rounded-md ${message.type === 'error' ? 'bg-red-100 text-red-700' :
                        message.type === 'success' ? 'bg-green-100 text-green-700' :
                            'bg-blue-100 text-blue-700'
                        }`}>
                        {message.text}
                    </div>
                )}

                <div className="bg-white p-6 rounded-lg shadow border border-gray-100">
                    <div className="mb-6">
                        <label className="block text-sm font-medium mb-2 text-gray-700">Select Server to View Certificates</label>
                        <div className="flex gap-4">
                            <select
                                className="p-2 border rounded flex-1 max-w-sm"
                                value={selectedMonitorServerId}
                                onChange={e => {
                                    setSelectedMonitorServerId(e.target.value);
                                    fetchSslReport(e.target.value);
                                }}
                            >
                                <option value="">-- Select a Server --</option>
                                {servers.map(s => (
                                    <option key={s.id} value={s.id}>{s.name} ({s.host})</option>
                                ))}
                            </select>
                            <button
                                onClick={() => fetchSslReport(selectedMonitorServerId)}
                                disabled={!selectedMonitorServerId || loadingReport}
                                className="bg-indigo-50 hover:bg-indigo-100 text-indigo-700 px-4 py-2 rounded text-sm font-medium transition disabled:opacity-50 border border-indigo-200"
                            >
                                {loadingReport ? 'Loading...' : 'Refresh'}
                            </button>
                        </div>
                    </div>

                    {selectedMonitorServerId && (
                        <div className="overflow-x-auto border rounded-lg">
                            <table className="w-full text-left border-collapse">
                                <thead>
                                    <tr className="bg-gray-50 border-b border-gray-200">
                                        <th className="p-4 font-semibold text-sm text-gray-700">Domain</th>
                                        <th className="p-4 font-semibold text-sm text-gray-700">Expiration Date</th>
                                        <th className="p-4 font-semibold text-sm text-gray-700">Actions</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {sslReports.length > 0 ? (
                                        sslReports.map(report => (
                                            <tr key={report.domain} className="border-b border-gray-100 hover:bg-gray-50 transition">
                                                <td className="p-4 text-sm font-medium text-gray-900">{report.domain}</td>
                                                <td className="p-4 text-sm text-gray-600">{report.expiry}</td>
                                                <td className="p-4">
                                                    <button
                                                        onClick={() => handleRenewSsl(report.domain)}
                                                        disabled={renewingDomain === report.domain}
                                                        className="text-xs text-white px-4 py-2 rounded-lg transition disabled:opacity-50 font-medium shadow-sm hover:opacity-90"
                                                        style={{ backgroundColor: 'var(--button-primary)' }}
                                                    >
                                                        {renewingDomain === report.domain ? 'Renewing...' : 'Renew Now'}
                                                    </button>
                                                </td>
                                            </tr>
                                        ))
                                    ) : !loadingReport ? (
                                        <tr>
                                            <td colSpan={3} className="p-8 text-center text-sm text-gray-500">No SSL certificates found for this server.</td>
                                        </tr>
                                    ) : null}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
            </main>
        </div>
    )
}
