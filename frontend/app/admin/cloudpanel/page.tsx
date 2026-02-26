'use client'

import React, { useState, useEffect } from 'react'


interface CloudPanelServer {
    id: number
    name: string
    host: string
    ssh_port: number
    ssh_user: string
    is_active: boolean
}

export default function CloudPanelPage() {
    const [servers, setServers] = useState<CloudPanelServer[]>([])
    const [loading, setLoading] = useState(true)

    // Add Server Form
    const [serverForm, setServerForm] = useState({
        name: '', host: '', ssh_port: 22, ssh_user: 'root', ssh_password: '', ssh_key: ''
    })

    // Add Site Form
    const [siteForm, setSiteForm] = useState({
        serverId: '', domainName: '', phpVersion: '8.2', vhostTemplate: 'Generic', dbName: '', dbUser: '', dbPassword: '',
        sslMode: 'auto', isWildcard: false, customCert: '', customKey: '', customChain: ''
    })

    // SSL Monitor
    const [selectedMonitorServerId, setSelectedMonitorServerId] = useState<string>('')
    const [sslReports, setSslReports] = useState<{ domain: string, expiry: string }[]>([])
    const [loadingReport, setLoadingReport] = useState(false)
    const [renewingDomain, setRenewingDomain] = useState<string | null>(null)

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

    const [siteDeploying, setSiteDeploying] = useState(false)
    const [message, setMessage] = useState({ type: '', text: '' })

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

    const handleAddSite = async (e: React.FormEvent) => {
        e.preventDefault()
        if (!siteForm.serverId) {
            setMessage({ type: 'error', text: 'Please select a server.' })
            return
        }
        setSiteDeploying(true)
        setMessage({ type: 'info', text: 'Deploying site. This may take a moment...' })

        try {
            const res = await fetch(`http://localhost:8000/cloudpanel/servers/${siteForm.serverId}/sites`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    domainName: siteForm.domainName,
                    phpVersion: siteForm.phpVersion,
                    vhostTemplate: siteForm.vhostTemplate,
                    // Send optional db details
                    dbName: siteForm.dbName || undefined,
                    dbUser: siteForm.dbUser || undefined,
                    dbPassword: siteForm.dbPassword || undefined,
                    // Send SSL details
                    issue_ssl: siteForm.sslMode === 'auto',
                    is_wildcard_ssl: siteForm.sslMode === 'auto' ? siteForm.isWildcard : false,
                    custom_ssl_cert: siteForm.sslMode === 'custom' ? siteForm.customCert : undefined,
                    custom_ssl_key: siteForm.sslMode === 'custom' ? siteForm.customKey : undefined,
                    custom_ssl_chain: siteForm.sslMode === 'custom' && siteForm.customChain ? siteForm.customChain : undefined
                })
            })

            const data = await res.json()
            if (res.ok) {
                setMessage({
                    type: 'success',
                    text: `Site deployed successfully! DB Name: ${data.details.db_name}, DB User: ${data.details.db_user}`
                })
                setSiteForm({ ...siteForm, domainName: '', dbName: '', dbUser: '', dbPassword: '', customCert: '', customKey: '', customChain: '' })
                // Refresh ssl report if monitor is on same server
                if (selectedMonitorServerId === siteForm.serverId) fetchSslReport(siteForm.serverId)
            } else {
                setMessage({ type: 'error', text: data.detail || 'Failed to deploy site.' })
            }
        } catch (err) {
            setMessage({ type: 'error', text: 'Network error while deploying site.' })
        } finally {
            setSiteDeploying(false)
        }
    }

    return (
        <div className="flex bg-gray-50 min-h-screen pl-[240px]">
            <div className="flex-1 flex flex-col">
                <header className="bg-white border-b border-gray-200 px-6 py-4 fixed top-0 left-[240px] right-0 z-10 flex items-center justify-between">
                    <h1 className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-indigo-600 to-blue-500">
                        CloudPanel Setup
                    </h1>
                </header>
                <div className="p-8 mt-16 max-w-6xl mx-auto w-full">

                    {message.text && (
                        <div className={`p-4 mb-6 rounded-md ${message.type === 'error' ? 'bg-red-100 text-red-700' :
                            message.type === 'success' ? 'bg-green-100 text-green-700' :
                                'bg-blue-100 text-blue-700'
                            }`}>
                            {message.text}
                        </div>
                    )}

                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                        {/* Server Management */}
                        <div className="bg-white p-6 rounded-lg shadow border border-gray-100">
                            <h2 className="text-xl font-bold mb-4">CloudPanel Servers</h2>
                            {loading ? (
                                <p>Loading servers...</p>
                            ) : servers.length === 0 ? (
                                <p className="text-gray-500 mb-4">No servers configured.</p>
                            ) : (
                                <ul className="mb-6 space-y-2">
                                    {servers.map(s => (
                                        <li key={s.id} className="p-3 bg-gray-50 rounded border">
                                            <strong>{s.name}</strong> ({s.host}:{s.ssh_port}) - {s.ssh_user}
                                        </li>
                                    ))}
                                </ul>
                            )}

                            <h3 className="font-semibold mt-6 mb-3 border-t pt-4">Add New Server</h3>
                            <form onSubmit={handleAddServer} className="space-y-3">
                                <div>
                                    <label className="block text-sm font-medium">Name</label>
                                    <input required type="text" className="w-full p-2 border rounded" value={serverForm.name} onChange={e => setServerForm({ ...serverForm, name: e.target.value })} placeholder="e.g. Production Server" />
                                </div>
                                <div className="grid grid-cols-2 gap-3">
                                    <div>
                                        <label className="block text-sm font-medium">Host IP</label>
                                        <input required type="text" className="w-full p-2 border rounded" value={serverForm.host} onChange={e => setServerForm({ ...serverForm, host: e.target.value })} placeholder="e.g. 192.168.1.100" />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium">SSH Port</label>
                                        <input required type="number" className="w-full p-2 border rounded" value={serverForm.ssh_port} onChange={e => setServerForm({ ...serverForm, ssh_port: parseInt(e.target.value) })} />
                                    </div>
                                </div>
                                <div className="grid grid-cols-2 gap-3">
                                    <div>
                                        <label className="block text-sm font-medium">SSH User</label>
                                        <input required type="text" className="w-full p-2 border rounded" value={serverForm.ssh_user} onChange={e => setServerForm({ ...serverForm, ssh_user: e.target.value })} />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium">SSH Password</label>
                                        <input type="password" className="w-full p-2 border rounded" value={serverForm.ssh_password} onChange={e => setServerForm({ ...serverForm, ssh_password: e.target.value })} placeholder="Leave blank if using key" />
                                    </div>
                                </div>
                                <div>
                                    <label className="block text-sm font-medium">SSH Private Key (Optional)</label>
                                    <textarea className="w-full p-2 border rounded h-24 text-xs font-mono" value={serverForm.ssh_key} onChange={e => setServerForm({ ...serverForm, ssh_key: e.target.value })} placeholder="-----BEGIN RSA PRIVATE KEY-----..." />
                                </div>
                                <button type="submit" className="bg-indigo-600 text-white px-4 py-2 rounded shadow hover:bg-indigo-700 w-full font-medium">
                                    Add Server
                                </button>
                            </form>
                        </div>

                        {/* Deploy Site */}
                        <div className="bg-white p-6 rounded-lg shadow border border-gray-100">
                            <h2 className="text-xl font-bold mb-4">Deploy New Site</h2>
                            <form onSubmit={handleAddSite} className="space-y-4">
                                <div>
                                    <label className="block text-sm font-medium mb-1">Select Server</label>
                                    <select required className="w-full p-2 border rounded" value={siteForm.serverId} onChange={e => setSiteForm({ ...siteForm, serverId: e.target.value })}>
                                        <option value="">-- Select a Server --</option>
                                        {servers.map(s => (
                                            <option key={s.id} value={s.id}>{s.name} ({s.host})</option>
                                        ))}
                                    </select>
                                </div>

                                <div>
                                    <label className="block text-sm font-medium mb-1">Domain Name</label>
                                    <input required type="text" className="w-full p-2 border rounded" value={siteForm.domainName} onChange={e => setSiteForm({ ...siteForm, domainName: e.target.value })} placeholder="e.g. app.example.com" />
                                </div>

                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <label className="block text-sm font-medium mb-1">PHP Version</label>
                                        <select className="w-full p-2 border rounded" value={siteForm.phpVersion} onChange={e => setSiteForm({ ...siteForm, phpVersion: e.target.value })}>
                                            <option value="8.1">8.1</option>
                                            <option value="8.2">8.2</option>
                                            <option value="8.3">8.3</option>
                                        </select>
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium mb-1">VHost Template</label>
                                        <input type="text" className="w-full p-2 border rounded" value={siteForm.vhostTemplate} onChange={e => setSiteForm({ ...siteForm, vhostTemplate: e.target.value })} />
                                    </div>
                                </div>

                                <div className="mt-4 pt-4 border-t border-gray-100">
                                    <h4 className="font-semibold mb-2 text-sm text-gray-700">Database Options (Optional)</h4>
                                    <p className="text-xs text-gray-500 mb-3">Leave blank to auto-generate based on domain name.</p>

                                    <div className="space-y-3">
                                        <div>
                                            <label className="block text-xs font-medium">DB Name</label>
                                            <input type="text" className="w-full p-2 text-sm border rounded" value={siteForm.dbName} onChange={e => setSiteForm({ ...siteForm, dbName: e.target.value })} placeholder="Auto-generated if empty" />
                                        </div>
                                        <div className="grid grid-cols-2 gap-3">
                                            <div>
                                                <label className="block text-xs font-medium">DB User</label>
                                                <input type="text" className="w-full p-2 text-sm border rounded" value={siteForm.dbUser} onChange={e => setSiteForm({ ...siteForm, dbUser: e.target.value })} placeholder="Auto" />
                                            </div>
                                            <div>
                                                <label className="block text-xs font-medium">DB Password</label>
                                                <input type="password" className="w-full p-2 text-sm border rounded" value={siteForm.dbPassword} onChange={e => setSiteForm({ ...siteForm, dbPassword: e.target.value })} placeholder="Auto-generated" />
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                {/* SSL Options */}
                                <div className="mt-4 pt-4 border-t border-gray-100">
                                    <h4 className="font-semibold mb-2 text-sm text-gray-700">SSL Details</h4>
                                    <div className="space-y-3">
                                        <div>
                                            <label className="block text-xs font-medium mb-1">SSL Mode</label>
                                            <select className="w-full p-2 text-sm border rounded" value={siteForm.sslMode} onChange={e => setSiteForm({ ...siteForm, sslMode: e.target.value })}>
                                                <option value="none">No SSL</option>
                                                <option value="auto">Let's Encrypt (Auto-issue)</option>
                                                <option value="custom">Custom/Purchased SSL</option>
                                            </select>
                                        </div>

                                        {siteForm.sslMode === 'auto' && (
                                            <div className="flex items-center gap-2 mt-2">
                                                <input type="checkbox" id="wildcard" checked={siteForm.isWildcard} onChange={e => setSiteForm({ ...siteForm, isWildcard: e.target.checked })} />
                                                <label htmlFor="wildcard" className="text-xs text-gray-700">Issue Wildcard SSL (*.domain) (Requires CloudPanel DNS configured)</label>
                                            </div>
                                        )}

                                        {siteForm.sslMode === 'custom' && (
                                            <div className="space-y-2 mt-2">
                                                <div>
                                                    <label className="block text-xs font-medium">Certificate (.crt)</label>
                                                    <textarea required className="w-full p-2 text-xs font-mono border rounded h-20" value={siteForm.customCert} onChange={e => setSiteForm({ ...siteForm, customCert: e.target.value })} placeholder="-----BEGIN CERTIFICATE-----..." />
                                                </div>
                                                <div>
                                                    <label className="block text-xs font-medium">Private Key (.key)</label>
                                                    <textarea required className="w-full p-2 text-xs font-mono border rounded h-20" value={siteForm.customKey} onChange={e => setSiteForm({ ...siteForm, customKey: e.target.value })} placeholder="-----BEGIN PRIVATE KEY-----..." />
                                                </div>
                                                <div>
                                                    <label className="block text-xs font-medium">Certificate Chain (Optional)</label>
                                                    <textarea className="w-full p-2 text-xs font-mono border rounded h-20" value={siteForm.customChain} onChange={e => setSiteForm({ ...siteForm, customChain: e.target.value })} placeholder="-----BEGIN CERTIFICATE-----..." />
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                </div>

                                <button
                                    type="submit"
                                    disabled={siteDeploying}
                                    className={`w-full font-medium px-4 py-2 mt-4 rounded shadow text-white ${siteDeploying ? 'bg-indigo-400 cursor-not-allowed' : 'bg-indigo-600 hover:bg-indigo-700'}`}
                                >
                                    {siteDeploying ? 'Deploying...' : 'Deploy Site & Database'}
                                </button>
                            </form>
                        </div>
                    </div>

                    {/* SSL Monitor Section */}
                    <div className="bg-white p-6 mt-8 rounded-lg shadow border border-gray-100 mb-12">
                        <h2 className="text-xl font-bold mb-4">SSL Monitor & Renewal</h2>
                        <div className="mb-4">
                            <label className="block text-sm font-medium mb-1">Select Server to View Certificates</label>
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
                                    className="bg-gray-100 hover:bg-gray-200 px-4 py-2 rounded text-sm font-medium transition disabled:opacity-50"
                                >
                                    {loadingReport ? 'Loading...' : 'Refresh'}
                                </button>
                            </div>
                        </div>

                        {selectedMonitorServerId && (
                            <div className="overflow-x-auto">
                                <table className="w-full text-left border-collapse">
                                    <thead>
                                        <tr className="border-b bg-gray-50">
                                            <th className="p-3 font-semibold text-sm text-gray-700">Domain</th>
                                            <th className="p-3 font-semibold text-sm text-gray-700">Expiration Date</th>
                                            <th className="p-3 font-semibold text-sm text-gray-700">Actions</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {sslReports.length > 0 ? (
                                            sslReports.map(report => (
                                                <tr key={report.domain} className="border-b">
                                                    <td className="p-3 text-sm">{report.domain}</td>
                                                    <td className="p-3 text-sm">{report.expiry}</td>
                                                    <td className="p-3">
                                                        <button
                                                            onClick={() => handleRenewSsl(report.domain)}
                                                            disabled={renewingDomain === report.domain}
                                                            className="text-xs bg-indigo-50 text-indigo-600 border border-indigo-200 hover:bg-indigo-100 px-3 py-1 rounded transition disabled:opacity-50"
                                                        >
                                                            {renewingDomain === report.domain ? 'Renewing...' : 'Renew Now'}
                                                        </button>
                                                    </td>
                                                </tr>
                                            ))
                                        ) : !loadingReport ? (
                                            <tr>
                                                <td colSpan={3} className="p-4 text-center text-sm text-gray-500">No SSL certificates found for this server.</td>
                                            </tr>
                                        ) : null}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    )
}
