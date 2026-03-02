'use client'

import { useState, useEffect } from 'react'
import { Plus, CreditCard, Globe, Trash2, Edit2, X, CheckCircle2, Upload, Image, Server, FileCode } from 'lucide-react'
import axios from 'axios'
import { getAuthToken } from '@/lib/auth'
import { API_URL } from '@/lib/config';

interface Subscription {
    id: number
    subscribed_product: string | null
    modules: string[]
    system_url: string | null
    company_logo_url: string | null
    subscribed_on_date: string | null
    billed_from_date: string | null
    expire_date: string | null
    organization_id: number
}

interface SubscriptionModule {
    id: number
    name: string
    is_active: number
}

interface CloudPanelServer {
    id: number
    name: string
    host: string
}

interface SiteTemplate {
    name: string
    has_files: boolean
}

interface DeployStep {
    id: string
    label: string
    status: 'pending' | 'done' | 'skipped' | 'error' | 'in_progress'
}

interface SubscriptionManagementProps {
    organizationId: number
}

const DEPLOY_STEPS = [
    { id: 'creating_site', label: 'Creating Site' },
    { id: 'creating_ssl', label: 'Creating SSL' },
    { id: 'deploying_files', label: 'Deploying Template Files' },
    { id: 'copying_logo', label: 'Copying Company Logo' },
    { id: 'running_script', label: 'Running Auto Script' },
    { id: 'creating_database', label: 'Creating Database' },
    { id: 'importing_database', label: 'Importing Database' },
]

export default function SubscriptionManagement({ organizationId }: SubscriptionManagementProps) {
    const [subscriptions, setSubscriptions] = useState<Subscription[]>([])
    const [loading, setLoading] = useState(true)
    const [isModalOpen, setIsModalOpen] = useState(false)
    const [currentSub, setCurrentSub] = useState<Partial<Subscription> | null>(null)
    const [saving, setSaving] = useState(false)
    const [isReadOnly, setIsReadOnly] = useState(false)
    const [availableModules, setAvailableModules] = useState<SubscriptionModule[]>([])
    const [logoFile, setLogoFile] = useState<File | null>(null)
    const [logoPreview, setLogoPreview] = useState<string | null>(null)

    // CloudPanel deployment state
    const [servers, setServers] = useState<CloudPanelServer[]>([])
    const [templates, setTemplates] = useState<SiteTemplate[]>([])
    const [selectedServerId, setSelectedServerId] = useState('')
    const [selectedTemplate, setSelectedTemplate] = useState('default_site')
    const [deploying, setDeploying] = useState(false)
    const [deploySteps, setDeploySteps] = useState<DeployStep[]>([])
    const [deployError, setDeployError] = useState('')

    useEffect(() => {
        fetchSubscriptions()
        fetchAvailableModules()
        fetchServersAndTemplates()
    }, [organizationId])

    const fetchAvailableModules = async () => {
        try {
            const token = getAuthToken()
            const authHeader = token ? `Bearer ${token}` : ''
            const res = await axios.get(`${API_URL}/organizations/subscription-modules`, {
                headers: { Authorization: authHeader }
            })
            setAvailableModules(res.data.filter((m: SubscriptionModule) => m.is_active === 1))
        } catch (error) {
            console.error('Error fetching available modules:', error)
        }
    }

    const fetchSubscriptions = async () => {
        try {
            setLoading(true)
            const token = getAuthToken()
            const authHeader = token ? `Bearer ${token}` : ''
            const res = await axios.get(`${API_URL}/organizations/${organizationId}/subscriptions`, {
                headers: { Authorization: authHeader }
            })
            setSubscriptions(res.data)
        } catch (error) {
            console.error('Error fetching subscriptions:', error)
        } finally {
            setLoading(false)
        }
    }

    const fetchServersAndTemplates = async () => {
        try {
            const token = getAuthToken()
            const headers = { Authorization: `Bearer ${token}` }
            const [serversRes, templatesRes] = await Promise.all([
                axios.get(`${API_URL}/cloudpanel/servers`, { headers }),
                axios.get(`${API_URL}/cloudpanel/templates`, { headers })
            ])
            setServers(serversRes.data)
            setTemplates(templatesRes.data)
        } catch (error) {
            console.error('Error fetching servers/templates:', error)
        }
    }

    const handleOpenModal = (sub: Subscription | null = null) => {
        setLogoFile(null)
        setDeploySteps([])
        setDeployError('')
        setSelectedServerId('')
        setSelectedTemplate('default_site')
        if (sub) {
            setCurrentSub({ ...sub })
            setLogoPreview(sub.company_logo_url ? `${API_URL}${sub.company_logo_url}` : null)
            setIsReadOnly(true)
        } else {
            setCurrentSub({
                subscribed_product: '',
                modules: [],
                system_url: '',
                company_logo_url: null,
                subscribed_on_date: new Date().toISOString().split('T')[0],
                billed_from_date: new Date().toISOString().split('T')[0],
                expire_date: '',
                organization_id: organizationId
            })
            setLogoPreview(null)
            setIsReadOnly(false)
        }
        setIsModalOpen(true)
    }

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        if (!currentSub) return

        setSaving(true)
        setDeployError('')

        try {
            const token = getAuthToken()
            const authHeader = token ? `Bearer ${token}` : ''

            // For editing existing subscriptions, use the old flow (no deployment)
            if (currentSub.id) {
                const payload = { ...currentSub }
                await axios.put(`${API_URL}/organizations/subscriptions/${currentSub.id}`, payload, {
                    headers: { Authorization: authHeader }
                })

                // Upload company logo if a new file was selected
                if (logoFile) {
                    const logoData = new FormData()
                    logoData.append('file', logoFile)
                    await axios.post(`${API_URL}/organizations/subscriptions/${currentSub.id}/company-logo`, logoData, {
                        headers: { Authorization: authHeader, 'Content-Type': 'multipart/form-data' }
                    })
                }

                setIsModalOpen(false)
                fetchSubscriptions()
                return
            }

            // For new subscriptions: deploy site first, then create subscription
            if (!selectedServerId) {
                alert('Please select a server for deployment.')
                setSaving(false)
                return
            }

            if (!currentSub.system_url) {
                alert('System URL is required for site deployment.')
                setSaving(false)
                return
            }

            // Start deployment via SSE
            setDeploying(true)
            setDeploySteps(DEPLOY_STEPS.map((s, i) => ({ ...s, status: i === 0 ? 'in_progress' : 'pending' })))

            const formData = new FormData()
            formData.append('server_id', selectedServerId)
            formData.append('subscribed_product', currentSub.subscribed_product || '')
            formData.append('modules', JSON.stringify(currentSub.modules || []))
            formData.append('system_url', currentSub.system_url || '')
            formData.append('template_name', selectedTemplate)
            formData.append('subscribed_on_date', currentSub.subscribed_on_date || '')
            formData.append('billed_from_date', currentSub.billed_from_date || '')
            formData.append('expire_date', currentSub.expire_date || '')
            if (logoFile) {
                formData.append('company_logo', logoFile)
            }

            const res = await fetch(`${API_URL}/organizations/${organizationId}/subscriptions/deploy-and-create`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}` },
                body: formData
            })

            if (!res.ok) {
                const errData = await res.json()
                setDeployError(errData.detail || 'Failed to start deployment.')
                setDeploying(false)
                setSaving(false)
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
                        setDeployError(eventData.message || 'Deployment failed.')
                        setDeploySteps(prev => prev.map(s => s.status === 'in_progress' ? { ...s, status: 'error' } : s))
                        setDeploying(false)
                        setSaving(false)
                        return
                    }

                    if (eventData.step === 'subscription_created') {
                        // Deployment + subscription creation succeeded
                        setDeploying(false)
                        setSaving(false)
                        fetchSubscriptions()
                        // Don't close modal yet — let user see the success state and close manually
                    } else if (eventData.step === 'complete') {
                        // Site deployment complete, subscription creation follows
                        setDeploySteps(prev => prev.map(s =>
                            s.status === 'in_progress' ? { ...s, status: 'done' } : s
                        ))
                    } else {
                        // Mark completed step and set next step as in_progress
                        setDeploySteps(prev => {
                            const updated = prev.map(s =>
                                s.id === eventData.step ? { ...s, status: eventData.status as DeployStep['status'] } : s
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
        } catch (error) {
            console.error('Error saving subscription:', error)
            setDeployError('Network error during deployment.')
            setDeploySteps(prev => prev.map(s => s.status === 'in_progress' ? { ...s, status: 'error' } : s))
        } finally {
            setDeploying(false)
            setSaving(false)
        }
    }

    const handleDelete = async (id: number) => {
        if (!confirm('Are you sure you want to delete this subscription?')) return
        try {
            const token = getAuthToken()
            const authHeader = token ? `Bearer ${token}` : ''
            await axios.delete(`${API_URL}/organizations/subscriptions/${id}`, {
                headers: { Authorization: authHeader }
            })
            fetchSubscriptions()
        } catch (error) {
            console.error('Error deleting subscription:', error)
        }
    }

    const toggleModule = (moduleName: string) => {
        if (isReadOnly) return
        const currentModules = currentSub?.modules || []
        const newModules = currentModules.includes(moduleName)
            ? currentModules.filter(m => m !== moduleName)
            : [...currentModules, moduleName]
        setCurrentSub({ ...currentSub!, modules: newModules })
    }

    const isExpired = (dateStr: string | null) => {
        if (!dateStr) return false
        return new Date(dateStr) < new Date()
    }

    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center">
                <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
                    <CreditCard className="w-5 h-5 text-indigo-500" />
                    Product Subscriptions
                </h2>
                <button
                    onClick={() => handleOpenModal()}
                    className="text-sm bg-indigo-50 text-indigo-700 px-3 py-1.5 rounded-lg hover:bg-indigo-100 transition-colors font-medium flex items-center gap-1"
                >
                    <Plus className="w-4 h-4" />
                    New Subscription
                </button>
            </div>

            {loading ? (
                <div className="flex justify-center py-10">
                    <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-indigo-600"></div>
                </div>
            ) : subscriptions.length > 0 ? (
                <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
                    <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse">
                            <thead>
                                <tr className="bg-gray-50/50 border-b border-gray-100">
                                    <th className="px-6 py-4 text-xs font-bold text-gray-500 uppercase tracking-wider">Product</th>
                                    <th className="px-6 py-4 text-xs font-bold text-gray-500 uppercase tracking-wider">Modules</th>
                                    <th className="px-6 py-4 text-xs font-bold text-gray-500 uppercase tracking-wider">Dates</th>
                                    <th className="px-6 py-4 text-xs font-bold text-gray-500 uppercase tracking-wider text-right">Actions</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-50">
                                {subscriptions.map((sub) => (
                                    <tr key={sub.id} className="hover:bg-gray-50/50 transition-colors">
                                        <td className="px-6 py-4">
                                            <div className="min-w-0">
                                                <h3 className="font-bold text-gray-900">{sub.subscribed_product}</h3>
                                                {sub.system_url && (
                                                    <div className="flex items-center gap-1 text-xs text-indigo-600 hover:underline">
                                                        <Globe className="w-3 h-3" />
                                                        <a href={sub.system_url.startsWith('http') ? sub.system_url : `https://${sub.system_url}`} target="_blank" rel="noreferrer">
                                                            {sub.system_url}
                                                        </a>
                                                    </div>
                                                )}
                                            </div>
                                        </td>
                                        <td className="px-6 py-4">
                                            <div className="flex flex-wrap gap-1">
                                                {sub.modules && sub.modules.map(mod => (
                                                    <span key={mod} className="text-[10px] bg-gray-50 text-gray-600 px-1.5 py-0.5 rounded border border-gray-100 uppercase font-semibold">
                                                        {mod}
                                                    </span>
                                                ))}
                                            </div>
                                        </td>
                                        <td className="px-6 py-4">
                                            <div className="space-y-1">
                                                <div className="text-[10px] text-gray-400">Billed: {sub.billed_from_date || 'N/A'}</div>
                                                <div className={`flex items-center gap-1.5 text-xs font-bold ${isExpired(sub.expire_date) ? 'text-red-600' : 'text-gray-900'}`}>
                                                    <div className={`w-1.5 h-1.5 rounded-full ${isExpired(sub.expire_date) ? 'bg-red-500 animate-pulse' : 'bg-green-500'}`} />
                                                    Exp: {sub.expire_date || 'N/A'}
                                                </div>
                                            </div>
                                        </td>
                                        <td className="px-6 py-4 text-right">
                                            <div className="flex justify-end gap-1">
                                                <button onClick={() => handleOpenModal(sub)} className="p-1.5 text-gray-400 hover:text-indigo-600 transition-colors">
                                                    <Edit2 className="w-4 h-4" />
                                                </button>
                                                <button onClick={() => handleDelete(sub.id)} className="p-1.5 text-gray-400 hover:text-red-500 transition-colors">
                                                    <Trash2 className="w-4 h-4" />
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            ) : (
                <div className="text-center py-10 bg-gray-50 rounded-xl border-2 border-dashed border-gray-100">
                    <CreditCard className="w-8 h-8 text-gray-300 mx-auto mb-2" />
                    <p className="text-sm text-gray-500">No active subscriptions</p>
                </div>
            )}

            {/* Deployment Progress Modal */}
            {deploySteps.length > 0 && (
                <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
                    <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
                        <div className="px-6 py-4 border-b border-gray-100 bg-gray-50/30">
                            <h3 className="text-lg font-bold text-gray-900 text-center">Deploying Site</h3>
                        </div>
                        <div className="p-6">
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

                            {deployError && (
                                <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
                                    {deployError}
                                </div>
                            )}

                            {!deploying && !deployError && deploySteps.every(s => s.status === 'done' || s.status === 'skipped') && (
                                <div className="mt-4 p-3 bg-green-50 border border-green-200 rounded-lg text-sm text-green-800">
                                    <p className="font-semibold">Site deployed & subscription created successfully!</p>
                                </div>
                            )}

                            {!deploying && (
                                <button
                                    onClick={() => { setDeploySteps([]); setDeployError(''); setIsModalOpen(false) }}
                                    className="mt-5 w-full py-2 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 transition-colors"
                                >
                                    Close
                                </button>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* Subscription Modal */}
            {isModalOpen && currentSub && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
                    <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden animate-in fade-in zoom-in duration-200">
                        <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center bg-gray-50/30">
                            <h3 className="text-lg font-bold text-gray-900 flex items-center gap-2">
                                {currentSub.id ? (isReadOnly ? 'Subscription Details' : 'Edit Subscription') : 'New Subscription'}
                            </h3>
                            <div className="flex items-center gap-2">
                                {currentSub.id && isReadOnly && (
                                    <button
                                        onClick={() => setIsReadOnly(false)}
                                        className="p-2 text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors"
                                        title="Edit Subscription"
                                    >
                                        <Edit2 className="w-4 h-4" />
                                    </button>
                                )}
                                <button onClick={() => setIsModalOpen(false)} className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg">
                                    <X className="w-5 h-5" />
                                </button>
                            </div>
                        </div>
                        <form onSubmit={handleSubmit} className="p-6 space-y-3 max-h-[70vh] overflow-y-auto">
                            {/* Product Name */}
                            <div className="flex items-center gap-4">
                                <label className="w-36 flex-shrink-0 text-xs font-bold text-gray-700 uppercase tracking-wider">Product Name *</label>
                                <input
                                    required
                                    disabled={isReadOnly}
                                    type="text"
                                    className="flex-1 px-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none disabled:bg-gray-50 disabled:text-gray-500"
                                    placeholder="e.g. Social CRM Pro"
                                    value={currentSub.subscribed_product || ''}
                                    onChange={(e) => setCurrentSub({ ...currentSub, subscribed_product: e.target.value })}
                                />
                            </div>

                            {/* Enabled Modules */}
                            <div className="flex gap-4">
                                <label className="w-36 flex-shrink-0 text-xs font-bold text-gray-700 uppercase tracking-wider pt-2">Modules</label>
                                <div className="flex-1 grid grid-cols-2 gap-2">
                                    {availableModules.length > 0 ? (
                                        availableModules.map(mod => (
                                            <button
                                                type="button"
                                                key={mod.id}
                                                onClick={() => toggleModule(mod.name)}
                                                className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm border transition-all ${currentSub.modules?.includes(mod.name)
                                                    ? 'bg-indigo-50 border-indigo-200 text-indigo-700'
                                                    : 'bg-white border-gray-100 text-gray-500 hover:border-gray-300'
                                                    } ${isReadOnly ? 'cursor-default opacity-80' : ''}`}
                                            >
                                                {currentSub.modules?.includes(mod.name) ? <CheckCircle2 className="w-4 h-4" /> : <div className="w-4 h-4 bg-gray-50 rounded-full border border-gray-200" />}
                                                {mod.name}
                                            </button>
                                        ))
                                    ) : (
                                        <div className="col-span-2 py-4 text-center bg-gray-50 rounded-lg border border-dashed border-gray-200">
                                            <p className="text-xs text-gray-400 italic">No active modules defined in settings</p>
                                        </div>
                                    )}
                                </div>
                            </div>

                            {/* Server dropdown — only for new subscriptions */}
                            {!currentSub.id && (
                                <div className="flex items-center gap-4">
                                    <label className="w-36 flex-shrink-0 text-xs font-bold text-gray-700 uppercase tracking-wider flex items-center gap-1">
                                        <Server className="w-3.5 h-3.5" />
                                        Server *
                                    </label>
                                    <select
                                        required
                                        disabled={isReadOnly}
                                        className="flex-1 px-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none disabled:bg-gray-50 disabled:text-gray-500"
                                        value={selectedServerId}
                                        onChange={(e) => setSelectedServerId(e.target.value)}
                                    >
                                        <option value="">-- Select a Server --</option>
                                        {servers.map(s => (
                                            <option key={s.id} value={s.id}>{s.name} ({s.host})</option>
                                        ))}
                                    </select>
                                </div>
                            )}

                            {/* System URL */}
                            <div className="flex items-start gap-4">
                                <label className="w-36 flex-shrink-0 text-xs font-bold text-gray-700 uppercase tracking-wider pt-2.5">System URL *</label>
                                <div className="flex-1">
                                    <input
                                        required
                                        disabled={isReadOnly}
                                        type="text"
                                        className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none disabled:bg-gray-50 disabled:text-gray-500"
                                        placeholder="https://customer-app.example.com"
                                        value={currentSub.system_url || ''}
                                        onChange={(e) => setCurrentSub({ ...currentSub, system_url: e.target.value })}
                                    />
                                    {!currentSub.id && (
                                        <p className="text-[10px] text-gray-400 mt-1">The domain/subdomain from this URL will be used to deploy the site.</p>
                                    )}
                                </div>
                            </div>

                            {/* Site Template dropdown — only for new subscriptions */}
                            {!currentSub.id && (
                                <div className="flex items-center gap-4">
                                    <label className="w-36 flex-shrink-0 text-xs font-bold text-gray-700 uppercase tracking-wider flex items-center gap-1">
                                        <FileCode className="w-3.5 h-3.5" />
                                        Site Template
                                    </label>
                                    <select
                                        disabled={isReadOnly}
                                        className="flex-1 px-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none disabled:bg-gray-50 disabled:text-gray-500"
                                        value={selectedTemplate}
                                        onChange={(e) => setSelectedTemplate(e.target.value)}
                                    >
                                        {templates.length > 0 ? templates.map(t => (
                                            <option key={t.name} value={t.name}>
                                                {t.name === 'default_site' ? 'default_site (System default)' : `${t.name}${t.has_files ? '' : ' (Empty)'}`}
                                            </option>
                                        )) : <option value="default_site">default_site (System default)</option>}
                                    </select>
                                </div>
                            )}

                            {/* Company Logo */}
                            <div className="flex items-center gap-4">
                                <label className="w-36 flex-shrink-0 text-xs font-bold text-gray-700 uppercase tracking-wider">Company Logo</label>
                                <div className="flex-1 flex items-center gap-4">
                                    {logoPreview ? (
                                        <div className="relative w-14 h-14 rounded-lg border border-gray-200 overflow-hidden bg-gray-50 flex-shrink-0">
                                            <img src={logoPreview} alt="Company logo" className="w-full h-full object-contain" />
                                            {!isReadOnly && (
                                                <button
                                                    type="button"
                                                    onClick={() => { setLogoFile(null); setLogoPreview(null); }}
                                                    className="absolute -top-0 -right-0 bg-red-500 text-white rounded-full p-0.5"
                                                >
                                                    <X className="w-3 h-3" />
                                                </button>
                                            )}
                                        </div>
                                    ) : (
                                        <div className="w-14 h-14 rounded-lg border-2 border-dashed border-gray-200 flex items-center justify-center bg-gray-50 flex-shrink-0">
                                            <Image className="w-5 h-5 text-gray-300" />
                                        </div>
                                    )}
                                    {!isReadOnly && (
                                        <div>
                                            <label className="cursor-pointer inline-flex items-center gap-2 px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-100 transition-colors">
                                                <Upload className="w-4 h-4" />
                                                {logoPreview ? 'Change Logo' : 'Upload Logo'}
                                                <input
                                                    type="file"
                                                    className="hidden"
                                                    accept="image/jpeg,image/png,image/gif,image/webp,image/svg+xml"
                                                    onChange={(e) => {
                                                        const file = e.target.files?.[0]
                                                        if (!file) return
                                                        if (file.size > 200 * 1024) {
                                                            alert('File too large. Maximum size is 200KB.')
                                                            return
                                                        }
                                                        setLogoFile(file)
                                                        setLogoPreview(URL.createObjectURL(file))
                                                    }}
                                                />
                                            </label>
                                            <p className="text-[10px] text-gray-400 mt-1">Max 200KB. JPEG, PNG, GIF, WebP, SVG</p>
                                        </div>
                                    )}
                                </div>
                            </div>

                            {/* Date fields */}
                            <div className="flex items-center gap-4">
                                <label className="w-36 flex-shrink-0 text-xs font-bold text-gray-700 uppercase tracking-wider">Subscribed On</label>
                                <input
                                    disabled={isReadOnly}
                                    type="date"
                                    className="flex-1 px-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none disabled:bg-gray-50 disabled:text-gray-500"
                                    value={currentSub.subscribed_on_date || ''}
                                    onChange={(e) => setCurrentSub({ ...currentSub, subscribed_on_date: e.target.value })}
                                />
                            </div>

                            <div className="flex items-center gap-4">
                                <label className="w-36 flex-shrink-0 text-xs font-bold text-gray-700 uppercase tracking-wider">Billed From</label>
                                <input
                                    disabled={isReadOnly}
                                    type="date"
                                    className="flex-1 px-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none disabled:bg-gray-50 disabled:text-gray-500"
                                    value={currentSub.billed_from_date || ''}
                                    onChange={(e) => setCurrentSub({ ...currentSub, billed_from_date: e.target.value })}
                                />
                            </div>

                            <div className="flex items-center gap-4">
                                <label className="w-36 flex-shrink-0 text-xs font-extrabold text-red-600 uppercase tracking-wider">Expiration *</label>
                                <input
                                    required
                                    disabled={isReadOnly}
                                    type="date"
                                    className={`flex-1 px-4 py-2 border-2 rounded-lg outline-none font-bold disabled:bg-gray-50 disabled:text-gray-500 ${isReadOnly ? 'border-gray-100' : 'border-red-100 focus:ring-4 focus:ring-red-50/50 focus:border-red-400'}`}
                                    value={currentSub.expire_date || ''}
                                    onChange={(e) => setCurrentSub({ ...currentSub, expire_date: e.target.value })}
                                />
                            </div>

                            <div className="pt-4 flex justify-end gap-3 border-t border-gray-100">
                                <button
                                    type="button"
                                    onClick={() => setIsModalOpen(false)}
                                    className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg transition-colors font-medium"
                                >
                                    {isReadOnly ? 'Close' : 'Cancel'}
                                </button>
                                {!isReadOnly && (
                                    <button
                                        type="submit"
                                        disabled={saving}
                                        className="bg-indigo-600 text-white px-6 py-2 rounded-lg hover:bg-indigo-700 transition-colors font-medium disabled:opacity-50 inline-flex items-center gap-2"
                                    >
                                        {saving && <div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />}
                                        {saving ? (currentSub.id ? 'Saving...' : 'Deploying...') : 'Activate Subscription'}
                                    </button>
                                )}
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    )
}
