'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { FiSettings, FiLogOut, FiPhone, FiMail, FiUser } from 'react-icons/fi'
import { authAPI, getAuthToken, type User } from '@/lib/auth'
import axios from 'axios'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

interface ProfileDropdownProps {
  user: User
}

export default function ProfileDropdown({ user }: ProfileDropdownProps) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [profile, setProfile] = useState<{
    phone?: string
    avatar_url?: string
  }>({})
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let ignore = false
    const token = getAuthToken()
    axios
      .get(`${API_URL}/auth/user/${user.user_id}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      .then((r) => {
        if (!ignore) setProfile({ phone: r.data.phone, avatar_url: r.data.avatar_url })
      })
      .catch(() => {})
    return () => { ignore = true }
  }, [user.user_id])

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const handleLogout = () => {
    authAPI.logout()
    router.push('/login')
  }

  const initials = user.full_name
    ? user.full_name.split(' ').map((n) => n[0]).slice(0, 2).join('').toUpperCase()
    : '?'

  const avatarSrc = profile.avatar_url ? `${API_URL}${profile.avatar_url}` : null

  return (
    <div className="relative" ref={ref}>
      {/* Avatar button */}
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-9 h-9 rounded-full overflow-hidden border-2 border-gray-200 hover:border-blue-400 transition focus:outline-none focus:ring-2 focus:ring-blue-400 flex items-center justify-center bg-blue-100 flex-shrink-0"
        aria-label="Profile menu"
      >
        {avatarSrc ? (
          <img src={avatarSrc} alt="Profile" className="w-full h-full object-cover" />
        ) : (
          <span className="text-blue-600 font-bold text-sm">{initials}</span>
        )}
      </button>

      {/* Dropdown */}
      {open && (
        <div className="absolute right-0 top-11 w-64 bg-white rounded-xl shadow-xl border border-gray-100 z-50 overflow-hidden">
          {/* Header */}
          <div className="p-4 bg-gradient-to-br from-blue-50 to-white flex items-center gap-3 border-b border-gray-100">
            <div className="w-12 h-12 rounded-full overflow-hidden bg-blue-100 flex items-center justify-center flex-shrink-0 border-2 border-white shadow">
              {avatarSrc ? (
                <img src={avatarSrc} alt="Profile" className="w-full h-full object-cover" />
              ) : (
                <span className="text-blue-600 font-bold text-lg">{initials}</span>
              )}
            </div>
            <div className="min-w-0">
              <p className="font-semibold text-gray-900 text-sm truncate">{user.full_name}</p>
              <span className={`inline-block mt-0.5 text-xs px-2 py-0.5 rounded-full font-medium ${user.role === 'admin' ? 'bg-purple-100 text-purple-700' : 'bg-gray-100 text-gray-600'}`}>
                {user.role === 'admin' ? 'Admin' : 'User'}
              </span>
            </div>
          </div>

          {/* Info rows */}
          <div className="px-4 py-3 space-y-2 border-b border-gray-100">
            <div className="flex items-center gap-2 text-sm text-gray-600">
              <FiMail size={13} className="text-gray-400 flex-shrink-0" />
              <span className="truncate">{user.email}</span>
            </div>
            {profile.phone && (
              <div className="flex items-center gap-2 text-sm text-gray-600">
                <FiPhone size={13} className="text-gray-400 flex-shrink-0" />
                <span>{profile.phone}</span>
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="py-1">
            <button
              onClick={() => { setOpen(false); router.push('/settings?tab=profile') }}
              className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 transition"
            >
              <FiUser size={15} className="text-gray-400" />
              Edit Profile
            </button>
            <button
              onClick={() => { setOpen(false); router.push('/settings') }}
              className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 transition"
            >
              <FiSettings size={15} className="text-gray-400" />
              Settings
            </button>
            <div className="border-t border-gray-100 mt-1 pt-1">
              <button
                onClick={handleLogout}
                className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-red-600 hover:bg-red-50 transition"
              >
                <FiLogOut size={15} />
                Logout
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
