'use client'

import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import AdminNav from '@/components/AdminNav'
import MainHeader from '@/components/MainHeader'
import IndividualForm from '@/components/IndividualForm'
import { ChevronLeft } from 'lucide-react'
import axios from 'axios'
import { useAuth, getAuthToken } from '@/lib/auth'
import { API_URL } from '@/lib/config'

export default function IndividualDetailPage() {
    const { user } = useAuth()
    const { id } = useParams()
    const router = useRouter()

    const [individual, setIndividual] = useState<any>(null)
    const [loading, setLoading] = useState(true)

    useEffect(() => {
        if (id === 'new') {
            setLoading(false)
            return
        }
        fetchIndividual()
    }, [id])

    const fetchIndividual = async () => {
        try {
            setLoading(true)
            const token = getAuthToken()
            const res = await axios.get(`${API_URL}/individuals/${id}`, {
                headers: { Authorization: `Bearer ${token}` }
            })
            setIndividual(res.data)
        } catch (error) {
            console.error('Error fetching individual:', error)
        } finally {
            setLoading(false)
        }
    }

    const handleSuccess = (data: any) => {
        setIndividual(data)
        if (id === 'new') {
            router.push(`/admin/individuals/${data.id}`)
        }
    }

    return (
        <div className="flex flex-col h-screen bg-gray-50">
            <MainHeader user={user!} />

            <div className="flex-1 flex overflow-hidden pt-14 ml-[240px]">
                <AdminNav />

                <main className="flex-1 overflow-y-auto p-8">
                    <div className="w-full max-w-4xl">
                        {/* Back Button */}
                        <button
                            onClick={() => router.push('/admin/individuals')}
                            className="flex items-center gap-2 text-gray-500 hover:text-gray-700 mb-6 transition-colors"
                        >
                            <ChevronLeft className="w-4 h-4" />
                            <span className="text-sm font-medium">Back to Individuals</span>
                        </button>

                        <div className="mb-6">
                            <h1 className="text-2xl font-bold text-gray-900">
                                {id === 'new' ? 'New Individual' : individual?.full_name || 'Individual Details'}
                            </h1>
                            <p className="text-gray-500">
                                {id === 'new' ? 'Create a new individual contact' : 'View and manage individual details'}
                            </p>
                        </div>

                        {loading ? (
                            <div className="flex justify-center items-center py-20">
                                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
                            </div>
                        ) : (
                            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
                                <IndividualForm
                                    initialData={individual}
                                    onSuccess={handleSuccess}
                                    onCancel={() => router.push('/admin/individuals')}
                                />
                            </div>
                        )}
                    </div>
                </main>
            </div>
        </div>
    )
}
