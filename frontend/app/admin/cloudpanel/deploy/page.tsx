'use client'

import React, { useState, useEffect } from 'react'
import MainHeader from "@/components/MainHeader"
import AdminNav from '@/components/AdminNav'
import { authAPI } from "@/lib/auth"
import { hasAdminFeature } from '@/lib/permissions'
import { useRouter } from 'next/navigation'

interface CloudPanelServer {
    id: number
    name: string
    host: string
}

export default function CloudPanelDeployPage() {
    const [isMounted, setIsMounted] = useState(false)
    const [user, setUser] = useState<any>(null)
    const router = useRouter()
    const [servers, setServers] = useState<CloudPanelServer[]>([])
    const [templates, setTemplates] = useState<{ name: string, has_files: boolean }[]>([])
    const [siteDeploying, setSiteDeploying] = useState(false)
    const [message, setMessage] = useState({ type: '', text: '' })

    useEffect(() => {
        setIsMounted(true)
        const currentUser = authAPI.getUser()
        setUser(currentUser)

        // Enforce permission
        if (currentUser && currentUser.role !== 'admin' && !hasAdminFeature('deploy_site')) {
            router.push('/dashboard')
            return
        }
        fetchServersAndTemplates()
    }, [router])

    const [siteForm, setSiteForm] = useState({
        serverId: '', domainName: '', phpVersion: '8.2', vhostTemplate: 'Generic', templateName: 'default_site', dbName: '', dbUser: '', dbPassword: '',
        sslMode: 'auto', isWildcard: false, customCert: '', customKey: '', customChain: ''
    })

    const fetchServersAndTemplates = async () => {
        try {
            const [serversRes, templatesRes] = await Promise.all([
                fetch('http://localhost:8000/cloudpanel/servers'),
                fetch('http://localhost:8000/cloudpanel/templates')
            ])

            if (serversRes.ok) {
                const data = await serversRes.json()
                setServers(data)
            }
            if (templatesRes.ok) {
                const data = await templatesRes.json()
                setTemplates(data)
            }
        } catch (err) {
            console.error('Failed to fetch data', err)
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
                    templateName: siteForm.templateName,
                    dbName: siteForm.dbName || undefined,
                    dbUser: siteForm.dbUser || undefined,
                    dbPassword: siteForm.dbPassword || undefined,
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
            } else {
                setMessage({ type: 'error', text: data.detail || 'Failed to deploy site.' })
            }
        } catch (err) {
            setMessage({ type: 'error', text: 'Network error while deploying site.' })
        } finally {
            setSiteDeploying(false)
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
                <h1 className="text-2xl font-bold text-gray-900 mb-6">Deploy New Site</h1>

                {message.text && (
                    <div className={`p-4 mb-6 rounded-md ${message.type === 'error' ? 'bg-red-100 text-red-700' :
                        message.type === 'success' ? 'bg-green-100 text-green-700' :
                            'bg-blue-100 text-blue-700'
                        }`}>
                        {message.text}
                    </div>
                )}

                <div className="bg-white p-6 rounded-lg shadow border border-gray-100">
                    <form onSubmit={handleAddSite} className="space-y-6">
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

                        <div>
                            <label className="block text-sm font-medium mb-1">Site Template</label>
                            <select className="w-full p-2 border rounded" value={siteForm.templateName} onChange={e => setSiteForm({ ...siteForm, templateName: e.target.value })}>
                                {templates.length > 0 ? templates.map(t => (
                                    <option key={t.name} value={t.name}>{t.name === 'default_site' ? 'default_site (System default)' : `${t.name} ${t.has_files ? '' : '(Empty)'}`}</option>
                                )) : <option value="default_site">default_site (System default)</option>}
                            </select>
                            <p className="text-xs text-gray-500 mt-1">Select the ZIP template files you previously uploaded to deploy to this domain root.</p>
                        </div>

                        <div className="pt-4 border-t border-gray-100">
                            <h4 className="font-semibold mb-2 text-gray-800">Database Options (Optional)</h4>
                            <p className="text-sm text-gray-500 mb-4">Leave blank to auto-generate based on domain name.</p>

                            <div className="space-y-4">
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">DB Name</label>
                                    <input type="text" className="w-full p-2 border rounded" value={siteForm.dbName} onChange={e => setSiteForm({ ...siteForm, dbName: e.target.value })} placeholder="Auto-generated if empty" />
                                </div>
                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-1">DB User</label>
                                        <input type="text" className="w-full p-2 border rounded" value={siteForm.dbUser} onChange={e => setSiteForm({ ...siteForm, dbUser: e.target.value })} placeholder="Auto" />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-1">DB Password</label>
                                        <input type="password" className="w-full p-2 border rounded" value={siteForm.dbPassword} onChange={e => setSiteForm({ ...siteForm, dbPassword: e.target.value })} placeholder="Auto-generated" />
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* SSL Options */}
                        <div className="pt-4 border-t border-gray-100">
                            <h4 className="font-semibold mb-2 text-gray-800">SSL Details</h4>
                            <div className="space-y-4">
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">SSL Mode</label>
                                    <select className="w-full p-2 border rounded" value={siteForm.sslMode} onChange={e => setSiteForm({ ...siteForm, sslMode: e.target.value })}>
                                        <option value="none">No SSL</option>
                                        <option value="auto">Let's Encrypt (Auto-issue)</option>
                                        <option value="custom">Custom/Purchased SSL</option>
                                    </select>
                                </div>

                                {siteForm.sslMode === 'auto' && (
                                    <div className="flex items-center gap-2 mt-2">
                                        <input type="checkbox" id="wildcard" checked={siteForm.isWildcard} onChange={e => setSiteForm({ ...siteForm, isWildcard: e.target.checked })} />
                                        <label htmlFor="wildcard" className="text-sm text-gray-700">Issue Wildcard SSL (*.domain) (Requires CloudPanel DNS configured)</label>
                                    </div>
                                )}

                                {siteForm.sslMode === 'custom' && (
                                    <div className="space-y-4 mt-2">
                                        <div>
                                            <label className="block text-sm font-medium text-gray-700 mb-1">Certificate (.crt)</label>
                                            <textarea required className="w-full p-2 text-sm font-mono border rounded h-24" value={siteForm.customCert} onChange={e => setSiteForm({ ...siteForm, customCert: e.target.value })} placeholder="-----BEGIN CERTIFICATE-----..." />
                                        </div>
                                        <div>
                                            <label className="block text-sm font-medium text-gray-700 mb-1">Private Key (.key)</label>
                                            <textarea required className="w-full p-2 text-sm font-mono border rounded h-24" value={siteForm.customKey} onChange={e => setSiteForm({ ...siteForm, customKey: e.target.value })} placeholder="-----BEGIN PRIVATE KEY-----..." />
                                        </div>
                                        <div>
                                            <label className="block text-sm font-medium text-gray-700 mb-1">Certificate Chain (Optional)</label>
                                            <textarea className="w-full p-2 text-sm font-mono border rounded h-24" value={siteForm.customChain} onChange={e => setSiteForm({ ...siteForm, customChain: e.target.value })} placeholder="-----BEGIN CERTIFICATE-----..." />
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>

                        <button
                            type="submit"
                            disabled={siteDeploying}
                            className={`w-full font-medium px-4 py-3 mt-4 rounded-lg shadow text-white transition-opacity ${siteDeploying ? 'cursor-not-allowed opacity-50' : 'hover:opacity-90'}`}
                            style={{ backgroundColor: 'var(--button-primary)' }}
                        >
                            {siteDeploying ? 'Deploying...' : 'Deploy Site & Database'}
                        </button>
                    </form>
                </div>
            </main>
        </div>
    )
}
