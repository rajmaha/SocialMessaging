'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import AdminNav from '@/components/AdminNav'
import MainHeader from '@/components/MainHeader'
import { Plus, Search, User, Phone, Mail, ChevronRight } from 'lucide-react'
import axios from 'axios'
import { useRouter } from 'next/navigation'
import { useAuth, getAuthToken } from '@/lib/auth'
import { hasModuleAccess } from '@/lib/permissions'
import { API_URL } from '@/lib/config'

interface Individual {
    id: number
    full_name: string
    gender: string
    dob: string | null
    phone_numbers: string[]
    address: string | null
    email: string | null
    social_media: any[]
    is_active: number
}

export default function IndividualsPage() {
    const { user } = useAuth()
    const [individuals, setIndividuals] = useState<Individual[]>([])
    const [loading, setLoading] = useState(true)
    const [searchTerm, setSearchTerm] = useState('')
    const router = useRouter()

    useEffect(() => {
        if (user && user.role !== 'admin' && !hasModuleAccess('individuals')) {
            router.push('/dashboard')
            return
        }
        if (user) {
            fetchIndividuals()
        }
    }, [user?.user_id, user?.role, router])

    const fetchIndividuals = async () => {
        try {
            setLoading(true)
            const token = getAuthToken()
            const authHeader = token ? `Bearer ${token}` : ''

            const res = await axios.get(`${API_URL}/individuals/`, {
                headers: { Authorization: authHeader }
            })
            setIndividuals(res.data)
        } catch (error) {
            console.error('Error fetching individuals:', error)
        } finally {
            setLoading(false)
        }
    }

    const filteredIndividuals = individuals.filter(ind =>
        ind.full_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (ind.email && ind.email.toLowerCase().includes(searchTerm.toLowerCase()))
    )

    return (
        <div className="flex flex-col h-screen bg-gray-50">
            <MainHeader user={user!} />

            <div className="flex-1 flex overflow-hidden pt-14 ml-[240px]">
                <AdminNav />

                <main className="flex-1 overflow-y-auto p-8">
                    <div className="w-full">
                        <div className="flex justify-between items-center mb-8">
                            <div>
                                <h1 className="text-2xl font-bold text-gray-900">Individuals</h1>
                                <p className="text-gray-500">Manage individual contacts and their details</p>
                            </div>
                            <Link
                                href="/admin/individuals/new"
                                className="inline-flex items-center gap-2 text-white px-4 py-2 rounded-lg transition-colors font-medium shadow-sm"
                                style={{ backgroundColor: 'var(--button-primary)' }}
                            >
                                <Plus className="w-4 h-4" />
                                New Individual
                            </Link>
                        </div>

                        {/* Search */}
                        <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm mb-6 flex gap-4">
                            <div className="relative flex-1">
                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4" />
                                <input
                                    type="text"
                                    placeholder="Search individuals..."
                                    className="w-full pl-10 pr-4 py-2 bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                                    value={searchTerm}
                                    onChange={(e) => setSearchTerm(e.target.value)}
                                />
                            </div>
                        </div>

                        {/* Individual List */}
                        {loading ? (
                            <div className="flex justify-center items-center py-20">
                                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
                            </div>
                        ) : filteredIndividuals.length > 0 ? (
                            <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                                <div className="overflow-x-auto">
                                    <table className="w-full text-left border-collapse">
                                        <thead>
                                            <tr className="bg-gray-50/50 border-b border-gray-200">
                                                <th className="px-6 py-4 text-xs font-bold text-gray-500 uppercase tracking-wider">Full Name</th>
                                                <th className="px-6 py-4 text-xs font-bold text-gray-500 uppercase tracking-wider">Gender</th>
                                                <th className="px-6 py-4 text-xs font-bold text-gray-500 uppercase tracking-wider">Contact Info</th>
                                                <th className="px-6 py-4 text-xs font-bold text-gray-500 uppercase tracking-wider">Email</th>
                                                <th className="px-6 py-4 text-xs font-bold text-gray-500 uppercase tracking-wider">Status</th>
                                                <th className="px-6 py-4 text-xs font-bold text-gray-500 uppercase tracking-wider text-right">Actions</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-gray-100">
                                            {filteredIndividuals.map((ind) => (
                                                <tr
                                                    key={ind.id}
                                                    onClick={() => router.push(`/admin/individuals/${ind.id}`)}
                                                    className="hover:bg-gray-50/50 transition-colors cursor-pointer group"
                                                >
                                                    <td className="px-6 py-4">
                                                        <div className="flex items-center gap-3">
                                                            <div className="w-10 h-10 rounded-lg bg-indigo-50 flex items-center justify-center flex-shrink-0 group-hover:bg-indigo-100 transition-colors">
                                                                <User className="w-5 h-5 text-indigo-600" />
                                                            </div>
                                                            <div className="min-w-0">
                                                                <h3 className="font-semibold text-gray-900 truncate">{ind.full_name}</h3>
                                                            </div>
                                                        </div>
                                                    </td>
                                                    <td className="px-6 py-4">
                                                        <span className="text-sm text-gray-600">{ind.gender || '—'}</span>
                                                    </td>
                                                    <td className="px-6 py-4">
                                                        {ind.phone_numbers && ind.phone_numbers.length > 0 ? (
                                                            <div className="flex items-center gap-2 text-sm text-gray-600">
                                                                <Phone className="w-3.5 h-3.5 text-gray-400" />
                                                                {ind.phone_numbers[0]}
                                                            </div>
                                                        ) : (
                                                            <span className="text-gray-300 text-xs">No phone</span>
                                                        )}
                                                    </td>
                                                    <td className="px-6 py-4">
                                                        {ind.email ? (
                                                            <div className="flex items-center gap-2 text-sm text-gray-600">
                                                                <Mail className="w-3.5 h-3.5 text-gray-400" />
                                                                {ind.email}
                                                            </div>
                                                        ) : (
                                                            <span className="text-gray-300 text-xs">No email</span>
                                                        )}
                                                    </td>
                                                    <td className="px-6 py-4">
                                                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${ind.is_active ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                                                            {ind.is_active ? 'Active' : 'Inactive'}
                                                        </span>
                                                    </td>
                                                    <td className="px-6 py-4 text-right">
                                                        <ChevronRight className="w-5 h-5 text-gray-300 group-hover:text-indigo-600 transition-colors ml-auto" />
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        ) : (
                            <div className="text-center py-20 bg-white rounded-2xl border-2 border-dashed border-gray-200">
                                <User className="w-12 h-12 text-gray-300 mx-auto mb-4" />
                                <h3 className="text-lg font-medium text-gray-900">No individuals found</h3>
                                <p className="text-gray-500 mb-6 font-light">Get started by creating your first individual contact</p>
                                <Link
                                    href="/admin/individuals/new"
                                    className="inline-flex items-center gap-2 text-white px-6 py-2 rounded-lg transition-colors font-medium shadow-sm"
                                    style={{ backgroundColor: 'var(--button-primary)' }}
                                >
                                    <Plus className="w-4 h-4" />
                                    Create Individual
                                </Link>
                            </div>
                        )}
                    </div>
                </main>
            </div>
        </div>
    )
}
