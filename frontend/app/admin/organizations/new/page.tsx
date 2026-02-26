'use client'

import AdminNav from '@/components/AdminNav'
import MainHeader from '@/components/MainHeader'
import OrganizationForm from '@/components/OrganizationForm'
import { useRouter } from 'next/navigation'
import { Building2 } from 'lucide-react'
import { useAuth } from '@/lib/auth'

export default function NewOrganizationPage() {
    const { user } = useAuth()
    const router = useRouter()

    return (
        <div className="flex flex-col h-screen bg-gray-50">
            <MainHeader user={user!} />

            <div className="flex-1 flex overflow-hidden pt-14 ml-[240px]">
                <AdminNav />

                <main className="flex-1 overflow-y-auto p-8">
                    <div className="max-w-4xl mx-auto">
                        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
                            <div className="bg-indigo-600 px-8 py-6 text-white flex items-center gap-4">
                                <Building2 className="w-8 h-8 opacity-80" />
                                <div>
                                    <h1 className="text-xl font-bold">Register New Customer</h1>
                                    <p className="text-indigo-100 text-sm">Create a new organization account in the system</p>
                                </div>
                            </div>

                            <div className="p-8">
                                <OrganizationForm
                                    onSuccess={(data) => router.push(`/admin/organizations/${data.id}`)}
                                    onCancel={() => router.push('/admin/organizations')}
                                />
                            </div>
                        </div>
                    </div>
                </main>
            </div>
        </div>
    )
}
