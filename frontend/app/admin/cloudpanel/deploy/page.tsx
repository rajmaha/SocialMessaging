'use client'

import React, { useState, useEffect } from 'react'
import MainHeader from "@/components/MainHeader"
import AdminNav from '@/components/AdminNav'
import { authAPI, getAuthToken } from "@/lib/auth"
import { API_URL } from "@/lib/config"
import { hasAdminFeature } from '@/lib/permissions'
import { useRouter } from 'next/navigation'
import DeployProgress, {
    SITE_DEPLOY_STEPS, applyDeployEvent, failRunningStep, followDeployJob, initialDeploySteps, type DeployStepState
} from '@/components/DeployProgress'

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
    const [deploySteps, setDeploySteps] = useState<DeployStepState[]>([])
    const [deployResult, setDeployResult] = useState<any>(null)
    const [deployStartedAt, setDeployStartedAt] = useState<number | null>(null)
    const [deployError, setDeployError] = useState('')

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
        sslMode: 'auto', isWildcard: false, customCert: '', customKey: '', customChain: '', emailFrom: ''
    })
    const [logoFile, setLogoFile] = useState<File | null>(null)
    const [logoPreview, setLogoPreview] = useState<string | null>(null)

    // Read a File as a bare base64 string (data URI prefix stripped by the backend too)
    const fileToBase64 = (file: File) => new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(String(reader.result))
        reader.onerror = () => reject(reader.error)
        reader.readAsDataURL(file)
    })

    function authHeaders(): Record<string, string> {
        const token = getAuthToken() || ''
        return { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }
    }

    const fetchServersAndTemplates = async () => {
        try {
            const headers = { 'Authorization': `Bearer ${getAuthToken()}` }
            const [serversRes, templatesRes] = await Promise.all([
                fetch(`${API_URL}/cloudpanel/servers`, { headers }),
                fetch(`${API_URL}/cloudpanel/templates`, { headers })
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
        setDeployResult(null)
        setMessage({ type: '', text: '' })

        // Initialize all steps as pending, first one as in_progress
        setDeploySteps(initialDeploySteps(SITE_DEPLOY_STEPS))
        setDeployStartedAt(Date.now())
        setDeployError('')

        let logoBase64: string | undefined
        if (logoFile) {
            try {
                logoBase64 = await fileToBase64(logoFile)
            } catch {
                setMessage({ type: 'error', text: 'Could not read the selected logo file.' })
                setSiteDeploying(false)
                setDeploySteps([])
                return
            }
        }

        try {
            // Started as a background job and followed by polling, like CI/CD
            // Deploy: a streamed response was held back by the proxies in Docker /
            // Coolify until it ended, so only the first and last steps showed.
            const res = await fetch(`${API_URL}/cloudpanel/servers/${siteForm.serverId}/sites/deploy-stream?background=1`, {
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
                    custom_ssl_chain: siteForm.sslMode === 'custom' && siteForm.customChain ? siteForm.customChain : undefined,
                    company_logo_base64: logoBase64,
                    company_logo_filename: logoFile?.name,
                    email_from: siteForm.emailFrom || undefined
                })
            })

            if (!res.ok) {
                const errData = await res.json().catch(() => ({}))
                const text = errData.detail || 'Failed to deploy site.'
                setMessage({ type: 'error', text })
                setDeployError(text)
                setDeploySteps(prev => failRunningStep(prev))
                setSiteDeploying(false)
                return
            }

            // Apply each event as the polling hands it over, so the steps tick off one
            // by one. Returns true when the deployment has ended (error).
            const applyEvent = (eventData: any): boolean => {
                if (eventData.step === 'error') {
                    const text = eventData.message || 'Deployment failed.'
                    setMessage({ type: 'error', text })
                    setDeployError(text)
                    setDeploySteps(prev => failRunningStep(prev))
                    return true
                }

                if (eventData.step === 'complete') {
                    setDeployResult(eventData)
                    setMessage({
                        type: 'success',
                        text: `Site deployed successfully! DB Name: ${eventData.db_name}, DB User: ${eventData.db_user}`
                    })
                    setSiteForm({ ...siteForm, domainName: '', dbName: '', dbUser: '', dbPassword: '', customCert: '', customKey: '', customChain: '', emailFrom: '' })
                    setLogoFile(null)
                    setLogoPreview(null)
                } else {
                    // A finished step is ticked and the next one starts; a
                    // progress event updates what the running step says.
                    setDeploySteps(prev => applyDeployEvent(prev, eventData))
                }
                return false
            }

            const { job_id } = await res.json()
            let ended = false
            const outcome = await followDeployJob(job_id, ev => {
                if (!ended && applyEvent(ev)) ended = true
            })
            // The job failed without an error event reaching us (the server
            // restarted, contact lost): say so rather than leave a spinner.
            if (outcome.status !== 'success' && !ended) {
                const text = outcome.error || 'Deployment failed.'
                setMessage({ type: 'error', text })
                setDeployError(text)
                setDeploySteps(prev => failRunningStep(prev))
            }
        } catch (err) {
            setMessage({ type: 'error', text: 'Network error while deploying site.' })
            setDeployError('Network error while deploying site.')
            setDeploySteps(prev => failRunningStep(prev))
        } finally {
            setSiteDeploying(false)
        }
    }

    if (!isMounted) {
        return (
            <div className="ml-0 md:ml-60 pt-14 min-h-screen bg-gray-50 pb-16 md:pb-0" />
        )
    }

    return (
        <div className="ml-0 md:ml-60 pt-14 min-h-screen bg-gray-50 pb-16 md:pb-0">
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
                    <DeployProgress
                        steps={deploySteps}
                        running={siteDeploying}
                        startedAt={deployStartedAt}
                        error={deployError}
                        success={deployResult ? (
                            <>
                                <p className="font-semibold mb-1">Deployment Complete!</p>
                                <p>DB: {deployResult.db_name} | User: {deployResult.db_user}</p>
                            </>
                        ) : undefined}
                        onClose={() => { setDeploySteps([]); setDeployResult(null); setDeployError('') }}
                    />
                )}

                <div className="bg-white p-6 rounded-lg shadow border border-gray-100">
                    <form onSubmit={handleAddSite} className="space-y-6">
                        <div>
                            <label className="block text-sm font-medium mb-1">Select Server</label>
                            <select required className="w-full p-2 border rounded" value={siteForm.serverId} onChange={e => setSiteForm({ ...siteForm, serverId: e.target.value })}>
                                <option value="">-- Select a Server --</option>
                                {servers.map(s => (
                                    <option key={s.id} value={s.id}>{s.name}</option>
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

                        <div>
                            <label className="block text-sm font-medium mb-1">Email From</label>
                            <input
                                type="email"
                                className="w-full p-2 border rounded"
                                value={siteForm.emailFrom}
                                onChange={e => setSiteForm({ ...siteForm, emailFrom: e.target.value })}
                                placeholder="noreply@example.com"
                            />
                            <p className="text-xs text-gray-500 mt-1">Replaces the [email_from] placeholder in the template, so the deployed system sends its emails from this address.</p>
                        </div>

                        <div>
                            <label className="block text-sm font-medium mb-1">Company Logo</label>
                            <div className="flex items-center gap-4">
                                {logoPreview ? (
                                    <div className="relative w-16 h-16 rounded-lg border border-gray-200 overflow-hidden bg-gray-50 flex-shrink-0">
                                        <img src={logoPreview} alt="Company logo" className="w-full h-full object-contain" />
                                        <button
                                            type="button"
                                            onClick={() => { setLogoFile(null); setLogoPreview(null) }}
                                            className="absolute top-0 right-0 bg-red-500 text-white text-xs leading-none rounded-bl px-1 py-0.5"
                                        >
                                            &times;
                                        </button>
                                    </div>
                                ) : (
                                    <div className="w-16 h-16 rounded-lg border-2 border-dashed border-gray-200 bg-gray-50 flex-shrink-0" />
                                )}
                                <div>
                                    <label className="cursor-pointer inline-block px-3 py-2 bg-gray-50 border border-gray-200 rounded text-sm text-gray-600 hover:bg-gray-100">
                                        {logoPreview ? 'Change Logo' : 'Upload Logo'}
                                        <input
                                            type="file"
                                            className="hidden"
                                            accept="image/jpeg,image/png,image/gif,image/webp,image/svg+xml"
                                            onChange={e => {
                                                const file = e.target.files?.[0]
                                                if (!file) return
                                                if (file.size > 200 * 1024) {
                                                    setMessage({ type: 'error', text: 'Logo file too large. Maximum size is 200KB.' })
                                                    return
                                                }
                                                setMessage({ type: '', text: '' })
                                                setLogoFile(file)
                                                setLogoPreview(URL.createObjectURL(file))
                                            }}
                                        />
                                    </label>
                                    <p className="text-xs text-gray-500 mt-1">Max 200KB. JPEG, PNG, GIF, WebP, SVG. Copied to uploads/oms_company_info on the deployed site.</p>
                                </div>
                            </div>
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
                                        <option value="auto">Let&apos;s Encrypt (Auto-issue)</option>
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
