'use client'

import { useState, useEffect } from 'react'
import { Plus, CreditCard, Globe, Trash2, Edit2, X, CheckCircle2 } from 'lucide-react'
import axios from 'axios'
import { getAuthToken } from '@/lib/auth'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

interface Subscription {
    id: number
    subscribed_product: string | null
    modules: string[]
    system_url: string | null
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

interface SubscriptionManagementProps {
    organizationId: number
}

export default function SubscriptionManagement({ organizationId }: SubscriptionManagementProps) {
    const [subscriptions, setSubscriptions] = useState<Subscription[]>([])
    const [loading, setLoading] = useState(true)
    const [isModalOpen, setIsModalOpen] = useState(false)
    const [currentSub, setCurrentSub] = useState<Partial<Subscription> | null>(null)
    const [saving, setSaving] = useState(false)
    const [isReadOnly, setIsReadOnly] = useState(false)
    const [availableModules, setAvailableModules] = useState<SubscriptionModule[]>([])

    useEffect(() => {
        fetchSubscriptions()
        fetchAvailableModules()
    }, [organizationId])

    const fetchAvailableModules = async () => {
        try {
            const token = getAuthToken()
            const authHeader = token ? `Bearer ${token}` : ''
            const res = await axios.get(`${API_URL}/organizations/subscription-modules`, {
                headers: { Authorization: authHeader }
            })
            // Only show active modules in the selection list
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

    const handleOpenModal = (sub: Subscription | null = null) => {
        if (sub) {
            setCurrentSub({ ...sub })
            setIsReadOnly(true)
        } else {
            setCurrentSub({
                subscribed_product: '',
                modules: [],
                system_url: '',
                subscribed_on_date: new Date().toISOString().split('T')[0],
                billed_from_date: new Date().toISOString().split('T')[0],
                expire_date: '',
                organization_id: organizationId
            })
            setIsReadOnly(false)
        }
        setIsModalOpen(true)
    }

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        if (!currentSub) return

        setSaving(true)
        try {
            const token = getAuthToken()
            const authHeader = token ? `Bearer ${token}` : ''

            const payload = { ...currentSub }

            if (currentSub.id) {
                await axios.put(`${API_URL}/organizations/subscriptions/${currentSub.id}`, payload, {
                    headers: { Authorization: authHeader }
                })
            } else {
                await axios.post(`${API_URL}/organizations/${organizationId}/subscriptions`, payload, {
                    headers: { Authorization: authHeader }
                })
            }
            setIsModalOpen(false)
            fetchSubscriptions()
        } catch (error) {
            console.error('Error saving subscription:', error)
            alert('Failed to save subscription')
        } finally {
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

            {/* Subscription Modal */}
            {isModalOpen && currentSub && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
                    <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden animate-in fade-in zoom-in duration-200">
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
                        <form onSubmit={handleSubmit} className="p-6 space-y-4 max-h-[70vh] overflow-y-auto">
                            <div>
                                <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-1">Product Name *</label>
                                <input
                                    required
                                    disabled={isReadOnly}
                                    type="text"
                                    className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none disabled:bg-gray-50 disabled:text-gray-500"
                                    placeholder="e.g. Social CRM Pro"
                                    value={currentSub.subscribed_product || ''}
                                    onChange={(e) => setCurrentSub({ ...currentSub, subscribed_product: e.target.value })}
                                />
                            </div>

                            <div>
                                <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-2">Enabled Modules</label>
                                <div className="grid grid-cols-2 gap-2">
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

                            <div>
                                <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-1">System URL</label>
                                <input
                                    disabled={isReadOnly}
                                    type="text"
                                    className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none disabled:bg-gray-50 disabled:text-gray-500"
                                    placeholder="https://customer-app.example.com"
                                    value={currentSub.system_url || ''}
                                    onChange={(e) => setCurrentSub({ ...currentSub, system_url: e.target.value })}
                                />
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-1">Subscribed On</label>
                                    <input
                                        disabled={isReadOnly}
                                        type="date"
                                        className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none disabled:bg-gray-50 disabled:text-gray-500"
                                        value={currentSub.subscribed_on_date || ''}
                                        onChange={(e) => setCurrentSub({ ...currentSub, subscribed_on_date: e.target.value })}
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-1">Billed From</label>
                                    <input
                                        disabled={isReadOnly}
                                        type="date"
                                        className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none disabled:bg-gray-50 disabled:text-gray-500"
                                        value={currentSub.billed_from_date || ''}
                                        onChange={(e) => setCurrentSub({ ...currentSub, billed_from_date: e.target.value })}
                                    />
                                </div>
                                <div className="col-span-2 text-center py-1">
                                    <label className="block text-xs font-extrabold text-red-600 uppercase tracking-wider mb-1">Expiration Date *</label>
                                    <input
                                        required
                                        disabled={isReadOnly}
                                        type="date"
                                        className={`w-full px-4 py-2 border-2 rounded-lg outline-none font-bold disabled:bg-gray-50 disabled:text-gray-500 ${isReadOnly ? 'border-gray-100' : 'border-red-100 focus:ring-4 focus:ring-red-50/50 focus:border-red-400'}`}
                                        value={currentSub.expire_date || ''}
                                        onChange={(e) => setCurrentSub({ ...currentSub, expire_date: e.target.value })}
                                    />
                                </div>
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
                                        {saving ? 'Saving...' : 'Activate Subscription'}
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
