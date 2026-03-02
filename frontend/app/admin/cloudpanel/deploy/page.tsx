'use client'

import React, { useState, useEffect } from 'react'
import MainHeader from "@/components/MainHeader"
import AdminNav from '@/components/AdminNav'
import { authAPI, getAuthToken } from "@/lib/auth"
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
    const [deploySteps, setDeploySteps] = useState<{ id: string, label: string, status: 'pending' | 'done' | 'skipped' | 'error' | 'in_progress' }[]>([])
    const [deployResult, setDeployResult] = useState<any>(null)

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

    function authHeaders(): Record<string, string> {
        const token = getAuthToken() || ''
        return { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }
    }

    const fetchServersAndTemplates = async () => {
        try {
            const headers = { 'Authorization': `Bearer ${getAuthToken()}` }
            const [serversRes, templatesRes] = await Promise.all([
                fetch('http://localhost:8000/cloudpanel/servers', { headers }),
                fetch('http://localhost:8000/cloudpanel/templates', { headers })
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


    const DEPLOY_STEPS = [
        { id: 'creating_site', label: 'Creating Site' },
        { id: 'creating_ssl', label: 'Creating SSL' },
        { id: 'deploying_files', label: 'Deploying Files' },
        { id: 'running_script', label: 'Running Script' },
        { id: 'creating_database', label: 'Creating Database' },
        { id: 'importing_database', label: 'Importing Database' },
    ]

    const handleAddSite = async (e: React.FormEvent) => {
        e.preventDefault()
        if (!siteForm.serverId) {
            setMessage({ type: 'error', text: 'Please select a server.' })
            return
        }
        setSiteDeploying(true)
        setDeployResult(null)
        setMessage({ type: '', text: '' })

        // Initialize all steps as pending, first one as in_progress
        setDeploySteps(DEPLOY_STEPS.map((s, i) => ({ ...s, status: i === 0 ? 'in_progress' : 'pending' })))

        try {
            const res = await fetch(`http://localhost:8000/cloudpanel/servers/${siteForm.serverId}/sites/deploy-stream`, {
                method: 'POST',
                headers: authHeaders(),
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

            if (!res.ok) {
                const errData = await res.json()
                setMessage({ type: 'error', text: errData.detail || 'Failed to deploy site.' })
                setSiteDeploying(false)
                return
            }

            const reader = res.body?.getReader()
            const decoder = new TextDecoder()
            let buffer = ''

            while (reader) {
                const { done, value } = await reader.read()
                if (done) break

                buffer += decoder.decode(value, { stream: true })
                const lines = buffer.split('\n')
                buffer = lines.pop() || ''

                for (const line of lines) {
                    if (!line.startsWith('data: ')) continue
                    const eventData = JSON.parse(line.slice(6))

                    if (eventData.step === 'error') {
                        setMessage({ type: 'error', text: eventData.message || 'Deployment failed.' })
                        setDeploySteps(prev => prev.map(s => s.status === 'in_progress' ? { ...s, status: 'error' } : s))
                        setSiteDeploying(false)
                        return
                    }

                    if (eventData.step === 'complete') {
                        setDeployResult(eventData)
                        setMessage({
                            type: 'success',
                            text: `Site deployed successfully! DB Name: ${eventData.db_name}, DB User: ${eventData.db_user}`
                        })
                        setSiteForm({ ...siteForm, domainName: '', dbName: '', dbUser: '', dbPassword: '', customCert: '', customKey: '', customChain: '' })
                    } else {
                        // Mark completed step and set next step as in_progress
                        setDeploySteps(prev => {
                            const updated = prev.map(s =>
                                s.id === eventData.step ? { ...s, status: eventData.status as any } : s
                            )
                            const doneIdx = updated.findIndex(s => s.id === eventData.step)
                            if (doneIdx >= 0 && doneIdx + 1 < updated.length && updated[doneIdx + 1].status === 'pending') {
                                updated[doneIdx + 1] = { ...updated[doneIdx + 1], status: 'in_progress' }
                            }
                            return updated
                        })
                    }
                }
            }
        } catch (err) {
            setMessage({ type: 'error', text: 'Network error while deploying site.' })
            setDeploySteps(prev => prev.map(s => s.status === 'in_progress' ? { ...s, status: 'error' } : s))
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

                {(siteDeploying || deploySteps.length > 0) && (
                    <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center">
                        <div className="bg-white rounded-xl shadow-2xl p-8 max-w-md w-full mx-4">
                            <h3 className="text-lg font-semibold text-gray-900 mb-5 text-center">Deploying Site</h3>
                            <ul className="space-y-3">
                                {deploySteps.map((step) => (
                                    <li key={step.id} className="flex items-center gap-3">
                                        {step.status === 'done' && (
                                            <span className="flex-shrink-0 w-6 h-6 rounded-full bg-green-100 flex items-center justify-center">
                                                <svg className="w-4 h-4 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                                                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                                                </svg>
                                            </span>
                                        )}
                                        {step.status === 'in_progress' && (
                                            <span className="flex-shrink-0 w-6 h-6 flex items-center justify-center">
                                                <svg className="animate-spin w-5 h-5 text-blue-600" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                                                </svg>
                                            </span>
                                        )}
                                        {step.status === 'pending' && (
                                            <span className="flex-shrink-0 w-6 h-6 rounded-full border-2 border-gray-300" />
                                        )}
                                        {step.status === 'skipped' && (
                                            <span className="flex-shrink-0 w-6 h-6 rounded-full bg-gray-100 flex items-center justify-center">
                                                <svg className="w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                                                    <path strokeLinecap="round" strokeLinejoin="round" d="M20 12H4" />
                                                </svg>
                                            </span>
                                        )}
                                        {step.status === 'error' && (
                                            <span className="flex-shrink-0 w-6 h-6 rounded-full bg-red-100 flex items-center justify-center">
                                                <svg className="w-4 h-4 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                                                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                                                </svg>
                                            </span>
                                        )}
                                        <span className={`text-sm font-medium ${step.status === 'done' ? 'text-green-700' : step.status === 'in_progress' ? 'text-blue-700' : step.status === 'error' ? 'text-red-700' : step.status === 'skipped' ? 'text-gray-400' : 'text-gray-500'}`}>
                                            {step.label}
                                        </span>
                                    </li>
                                ))}
                            </ul>

                            {deployResult && (
                                <div className="mt-5 p-3 bg-green-50 border border-green-200 rounded-lg text-sm text-green-800">
                                    <p className="font-semibold mb-1">Deployment Complete!</p>
                                    <p>DB: {deployResult.db_name} | User: {deployResult.db_user}</p>
                                </div>
                            )}

                            {!siteDeploying && (
                                <button
                                    onClick={() => { setDeploySteps([]); setDeployResult(null) }}
                                    className="mt-5 w-full py-2 text-sm font-medium text-white rounded-lg transition-opacity hover:opacity-90"
                                    style={{ backgroundColor: 'var(--button-primary)' }}
                                >
                                    Close
                                </button>
                            )}
                        </div>
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
                                    <option value="7.4">7.4</option>
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
