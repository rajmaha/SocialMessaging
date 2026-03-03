'use client'

import { useState, useEffect, Suspense } from 'react'
import { useRouter } from 'next/navigation'
import { authAPI } from '@/lib/auth'
import MainHeader from '@/components/MainHeader'
import TodosPanel from '@/components/TodosPanel'

export default function RemindersPageWrapper() {
    return (
        <Suspense fallback={<div className="flex items-center justify-center h-screen bg-gray-50"><div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500"></div></div>}>
            <RemindersPage />
        </Suspense>
    )
}

function RemindersPage() {
    const router = useRouter()
    const [user, setUser] = useState<any>(null)
    const [isMounted, setIsMounted] = useState(false)

    useEffect(() => {
        setIsMounted(true)
        const userData = authAPI.getUser()
        if (!userData) { router.push('/login'); return }
        setUser(userData)
    }, [])

    if (!isMounted || !user) return null

    return (
        <div className="min-h-screen bg-gray-50">
            <MainHeader user={user} />
            <div className="pt-14">
                <TodosPanel mode="page" />
            </div>
        </div>
    )
}
