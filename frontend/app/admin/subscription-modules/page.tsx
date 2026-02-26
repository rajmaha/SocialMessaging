'use client'

import { useState, useEffect } from 'react'
import AdminNav from '@/components/AdminNav'
import MainHeader from '@/components/MainHeader'
import { Plus, Search, Layers, Edit2, Trash2, X, Check, AlertCircle } from 'lucide-react'
import axios from 'axios'
import { useAuth, getAuthToken } from '@/lib/auth'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

interface SubscriptionModule {
    id: number
    name: string
    description: string | null
    is_active: number
    created_at: string
}

export default function SubscriptionModulesPage() {
    const { user } = useAuth()
    const [modules, setModules] = useState<SubscriptionModule[]>([])
    const [loading, setLoading] = useState(true)
    const [searchTerm, setSearchTerm] = useState('')
    const [isModalOpen, setIsModalOpen] = useState(false)
    const [currentModule, setCurrentModule] = useState<Partial<SubscriptionModule> | null>(null)
    const [saving, setSaving] = useState(false)

    useEffect(() => {
        fetchModules()
    }, [])

    const fetchModules = async () => {
        try {
            setLoading(true)
            const token = getAuthToken()
            const authHeader = token ? `Bearer ${token}` : ''
            const res = await axios.get(`${API_URL}/organizations/subscription-modules`, {
                headers: { Authorization: authHeader }
            })
            setModules(res.data)
        } catch (error) {
            console.error('Error fetching modules:', error)
        } finally {
            setLoading(false)
        }
    }

    const handleOpenModal = (module: SubscriptionModule | null = null) => {
        if (module) {
            setCurrentModule({ ...module })
        } else {
            setCurrentModule({
                name: '',
                description: '',
                is_active: 1
            })
        }
        setIsModalOpen(true)
    }

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        if (!currentModule) return
        setSaving(true)
        try {
            const token = getAuthToken()
            const authHeader = token ? `Bearer ${token}` : ''

            if (currentModule.id) {
                await axios.put(`${API_URL}/organizations/subscription-modules/${currentModule.id}`, currentModule, {
                    headers: { Authorization: authHeader }
                })
            } else {
                await axios.post(`${API_URL}/organizations/subscription-modules`, currentModule, {
                    headers: { Authorization: authHeader }
                })
            }
            setIsModalOpen(false)
            fetchModules()
        } catch (error) {
            console.error('Error saving module:', error)
            alert('Failed to save module. Name might already exist.')
        } finally {
            setSaving(false)
        }
    }

    const handleDelete = async (id: number) => {
        if (!confirm('Are you sure you want to delete this module? This might affect organizations using it.')) return
        try {
            const token = getAuthToken()
            const authHeader = token ? `Bearer ${token}` : ''
            await axios.delete(`${API_URL}/organizations/subscription-modules/${id}`, {
                headers: { Authorization: authHeader }
            })
            fetchModules()
        } catch (error) {
            console.error('Error deleting module:', error)
            alert('Failed to delete module.')
        }
    }

    const filteredModules = modules.filter(m =>
        m.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (m.description && m.description.toLowerCase().includes(searchTerm.toLowerCase()))
    )

    return (
        <div className="flex flex-col h-screen bg-gray-50">
            <MainHeader user={user!} />

            <div className="flex-1 flex overflow-hidden pt-14 ml-[240px]">
                <AdminNav />

                <main className="flex-1 overflow-y-auto p-8">
                    <div className="max-w-5xl mx-auto">
                        <div className="flex justify-between items-center mb-8">
                            <div>
                                <h1 className="text-2xl font-bold text-gray-900">Subscription Modules</h1>
                                <p className="text-gray-500 font-light">Define available modules for product subscriptions</p>
                            </div>
                            <button
                                onClick={() => handleOpenModal()}
                                className="inline-flex items-center gap-2 bg-indigo-600 text-white px-4 py-2 rounded-xl hover:bg-indigo-700 transition-all font-semibold text-sm shadow-md shadow-indigo-100"
                            >
                                <Plus className="w-4 h-4" />
                                New Module
                            </button>
                        </div>

                        {/* Search */}
                        <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm mb-6">
                            <div className="relative max-w-md">
                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4" />
                                <input
                                    type="text"
                                    placeholder="Search modules..."
                                    className="w-full pl-10 pr-4 py-2 bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                                    value={searchTerm}
                                    onChange={(e) => setSearchTerm(e.target.value)}
                                />
                            </div>
                        </div>

                        {/* Modules Table */}
                        {loading ? (
                            <div className="flex justify-center py-20">
                                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
                            </div>
                        ) : filteredModules.length > 0 ? (
                            <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                                <table className="w-full text-left border-collapse">
                                    <thead>
                                        <tr className="bg-gray-50/50 border-b border-gray-200">
                                            <th className="px-6 py-4 text-xs font-bold text-gray-500 uppercase tracking-wider">Module Name</th>
                                            <th className="px-6 py-4 text-xs font-bold text-gray-500 uppercase tracking-wider">Description</th>
                                            <th className="px-6 py-4 text-xs font-bold text-gray-500 uppercase tracking-wider text-center">Status</th>
                                            <th className="px-6 py-4 text-xs font-bold text-gray-500 uppercase tracking-wider text-right">Actions</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-100">
                                        {filteredModules.map((m) => (
                                            <tr key={m.id} className="hover:bg-gray-50/50 transition-colors group">
                                                <td className="px-6 py-4 font-semibold text-gray-900">{m.name}</td>
                                                <td className="px-6 py-4 text-sm text-gray-500 max-w-xs truncate">{m.description || '-'}</td>
                                                <td className="px-6 py-4 text-center">
                                                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${m.is_active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                                                        {m.is_active ? 'Active' : 'Hidden'}
                                                    </span>
                                                </td>
                                                <td className="px-6 py-4 text-right">
                                                    <div className="flex justify-end gap-2">
                                                        <button onClick={() => handleOpenModal(m)} className="p-1.5 text-gray-400 hover:text-indigo-600 transition-colors">
                                                            <Edit2 className="w-4 h-4" />
                                                        </button>
                                                        <button onClick={() => handleDelete(m.id)} className="p-1.5 text-gray-400 hover:text-red-500 transition-colors">
                                                            <Trash2 className="w-4 h-4" />
                                                        </button>
                                                    </div>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        ) : (
                            <div className="text-center py-20 bg-white rounded-2xl border-2 border-dashed border-gray-200">
                                <Layers className="w-12 h-12 text-gray-300 mx-auto mb-4" />
                                <h3 className="text-lg font-medium text-gray-900">No modules found</h3>
                                <p className="text-gray-500 mb-6 font-light">Define the logic modules available for subscriptions</p>
                            </div>
                        )}
                    </div>
                </main>
            </div>

            {/* Modal */}
            {isModalOpen && currentModule && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
                    <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden animate-in fade-in zoom-in duration-200">
                        <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center bg-gray-50/30">
                            <h3 className="text-lg font-bold text-gray-900 flex items-center gap-2">
                                <Layers className="w-5 h-5 text-indigo-500" />
                                {currentModule.id ? 'Edit Module' : 'New Subscription Module'}
                            </h3>
                            <button onClick={() => setIsModalOpen(false)} className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg">
                                <X className="w-5 h-5" />
                            </button>
                        </div>
                        <form onSubmit={handleSubmit} className="p-6 space-y-4">
                            <div>
                                <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-1">Module Name *</label>
                                <input
                                    required
                                    type="text"
                                    className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                                    placeholder="e.g. AI Content Generator"
                                    value={currentModule.name || ''}
                                    onChange={(e) => setCurrentModule({ ...currentModule, name: e.target.value })}
                                />
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-1">Description</label>
                                <textarea
                                    className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none transition-all min-h-[100px]"
                                    placeholder="What does this module enable?"
                                    value={currentModule.description || ''}
                                    onChange={(e) => setCurrentModule({ ...currentModule, description: e.target.value })}
                                />
                            </div>
                            <div className="flex items-center gap-3 py-2">
                                <button
                                    type="button"
                                    onClick={() => setCurrentModule({ ...currentModule, is_active: currentModule.is_active ? 0 : 1 })}
                                    className={`w-12 h-6 rounded-full transition-colors relative ${currentModule.is_active ? 'bg-indigo-600' : 'bg-gray-200'}`}
                                >
                                    <div className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-all ${currentModule.is_active ? 'left-7' : 'left-1'}`} />
                                </button>
                                <span className="text-sm font-medium text-gray-700">Module is Active</span>
                            </div>

                            <div className="pt-4 flex justify-end gap-3 border-t border-gray-100">
                                <button
                                    type="button"
                                    onClick={() => setIsModalOpen(false)}
                                    className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg transition-colors font-medium"
                                >
                                    Cancel
                                </button>
                                <button
                                    type="submit"
                                    disabled={saving}
                                    className="bg-indigo-600 text-white px-6 py-2 rounded-lg hover:bg-indigo-700 transition-colors font-semibold shadow-md shadow-indigo-100 disabled:opacity-50"
                                >
                                    {saving ? 'Saving...' : 'Save Module'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    )
}
