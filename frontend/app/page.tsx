'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { authAPI } from '@/lib/auth'

export default function Home() {
  const router = useRouter()

  useEffect(() => {
    const isAuthenticated = authAPI.isAuthenticated()
    if (isAuthenticated) {
      router.push('/dashboard')
    } else {
      router.push('/login')
    }
  }, [router])

  return (
    <div className="flex items-center justify-center h-screen bg-gradient-to-br from-blue-500 to-blue-700">
      <div className="text-center">
        <h1 className="text-4xl font-bold text-white mb-4">Social Media Messenger</h1>
        <p className="text-blue-100">Redirecting...</p>
      </div>
    </div>
  )
}
