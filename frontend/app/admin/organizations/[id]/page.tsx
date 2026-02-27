'use client'

import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import AdminNav from '@/components/AdminNav'
import MainHeader from '@/components/MainHeader'
import OrganizationForm from '@/components/OrganizationForm'
import ContactManagement from '@/components/ContactManagement'
import SubscriptionManagement from '@/components/SubscriptionManagement'
import { User, CreditCard, ChevronLeft, LayoutDashboard, Settings } from 'lucide-react'
import axios from 'axios'
import { useAuth, getAuthToken } from '@/lib/auth'
import { hasModuleAccess } from '@/lib/permissions'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

type TabType = 'overview' | 'contacts' | 'subscriptions'

export default function OrganizationDetailPage() {
    const { user } = useAuth()
    const { id } = useParams()
    const router = useRouter()
    const [organization, setOrganization] = useState<any>(null)
    const [activeTab, setActiveTab] = useState<TabType>('overview')
    const [loading, setLoading] = useState(true)

    useEffect(() => {
        // Enforce base permission
        if (user && user.role !== 'admin' && !hasModuleAccess('organizations')) {
            router.push('/dashboard')
            return
        }
        fetchOrganization()
    }, [id, user, router])

    const fetchOrganization = async () => {
        try {
            setLoading(true)
            const token = getAuthToken()
            const authHeader = token ? `Bearer ${token}` : ''
            const res = await axios.get(`${API_URL}/organizations/${id}`, {
                headers: { Authorization: authHeader }
            })
            setOrganization(res.data)
        } catch (error) {
            console.error('Error fetching organization:', error)
            router.push('/admin/organizations')
        } finally {
            setLoading(false)
        }
    }

    if (loading) {
        return (
            <div className="flex flex-col h-screen bg-gray-50">
                <MainHeader user={user!} />
                <div className="flex-1 flex items-center justify-center pt-14 ml-[240px]">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
                </div>
            </div>
        )
    }

    const allTabs = [
        { id: 'overview', label: 'Overview', icon: LayoutDashboard, permission: () => true },
        { id: 'contacts', label: 'Contacts', icon: User, permission: () => hasModuleAccess('contacts') },
        { id: 'subscriptions', label: 'Subscriptions', icon: CreditCard, permission: () => hasModuleAccess('subscriptions') },
    ]

    const tabs = allTabs.filter(tab => {
        if (!user) return false;
        if (user.role === 'admin') return true;
        return tab.permission();
    })

    return (
        <div className="flex flex-col h-screen bg-gray-50">
            <MainHeader user={user!} />

            <div className="flex-1 flex overflow-hidden pt-14 ml-[240px]">
                <AdminNav />

                <main className="flex-1 overflow-y-auto p-4 md:p-8">
                    <div className="w-full">
                        {/* Header Area */}
                        <div className="mb-6 flex flex-col md:flex-row md:items-end justify-between gap-4">
                            <div className="flex items-center gap-4">
                                <button
                                    onClick={() => router.push('/admin/organizations')}
                                    className="p-2 bg-white border border-gray-200 rounded-xl hover:bg-gray-50 transition-colors shadow-sm"
                                >
                                    <ChevronLeft className="w-5 h-5 text-gray-600" />
                                </button>
                                <div>
                                    <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
                                        {organization?.organization_name}
                                        {organization?.is_active ? (
                                            <span className="text-[10px] bg-green-50 text-green-700 px-2 py-0.5 rounded-full border border-green-100 uppercase tracking-tighter">Active</span>
                                        ) : (
                                            <span className="text-[10px] bg-red-50 text-red-700 px-2 py-0.5 rounded-full border border-red-100 uppercase tracking-tighter">Inactive</span>
                                        )}
                                    </h1>
                                    <p className="text-gray-500 text-sm font-light">ID: {organization?.id} • Domain: {organization?.domain_name || 'N/A'}</p>
                                </div>
                            </div>

                            {/* Tab Switcher */}
                            <div className="flex bg-white p-1 rounded-xl border border-gray-200 shadow-sm self-start md:self-auto">
                                {tabs.map(tab => (
                                    <button
                                        key={tab.id}
                                        onClick={() => setActiveTab(tab.id as TabType)}
                                        className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${activeTab === tab.id
                                            ? 'text-white shadow-md'
                                            : 'text-gray-500 hover:bg-gray-50'
                                            }`}
                                        style={activeTab === tab.id ? { backgroundColor: 'var(--button-primary)' } : {}}
                                    >
                                        <tab.icon className="w-4 h-4" />
                                        {tab.label}
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* Tab Content */}
                        <div className="bg-white rounded-3xl border border-gray-100 shadow-xl shadow-gray-200/50 min-h-[500px] overflow-hidden">
                            {activeTab === 'overview' && (
                                <div className="p-8">
                                    <div className="flex items-center gap-3 mb-8">
                                        <div className="p-2 bg-indigo-50 rounded-lg">
                                            <Settings className="w-5 h-5 text-indigo-600" />
                                        </div>
                                        <h2 className="text-lg font-bold text-gray-900 leading-none">Settings & Information</h2>
                                    </div>
                                    <OrganizationForm
                                        initialData={organization}
                                        onSuccess={(data) => {
                                            setOrganization(data)
                                            alert('Settings saved successfully')
                                        }}
                                        onCancel={() => router.push('/admin/organizations')}
                                    />
                                </div>
                            )}

                            {activeTab === 'contacts' && (
                                <div className="p-8">
                                    <ContactManagement organizationId={Number(id)} />
                                </div>
                            )}

                            {activeTab === 'subscriptions' && (
                                <div className="p-8">
                                    <SubscriptionManagement organizationId={Number(id)} />
                                </div>
                            )}
                        </div>
                    </div>
                </main>
            </div>
        </div>
    )
}
