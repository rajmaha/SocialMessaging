'use client'

import React from 'react'
import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import { FiMessageSquare, FiMail, FiBarChart2, FiGrid, FiHeadphones, FiCheckSquare } from 'react-icons/fi'
import ProfileDropdown from '@/components/ProfileDropdown'
import { useBranding } from '@/lib/branding-context'
import type { User } from '@/lib/auth'
import { getAuthToken } from '@/lib/auth'
import { hasModuleAccess, hasAnyAdminPermission } from '@/lib/permissions'
import { useEvents } from '@/lib/events-context'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'
import { useState, useEffect } from 'react'

interface MainHeaderProps {
    user: User
    activeTab?: 'messaging' | 'email'
    setActiveTab?: (tab: 'messaging' | 'email') => void
}

export default function MainHeader({ user, activeTab: propActiveTab, setActiveTab }: MainHeaderProps) {
    const pathname = usePathname()
    const searchParams = useSearchParams()
    const brandingCtx = useBranding()
    const branding = brandingCtx?.branding

    // Use prop if provided, otherwise fallback to searchParams
    const activeTab = propActiveTab || searchParams.get('tab') || 'email'

    const isMessagingActive = pathname === '/dashboard' && activeTab === 'messaging'
    const isEmailActive = (pathname === '/dashboard' && activeTab === 'email') || pathname.startsWith('/email')
    const isDashboardActive = pathname === '/admin'
    const isReportsActive = pathname === '/admin/reports'
    const isWorkspaceActive = pathname === '/workspace'

    const [canAccessEmail, setCanAccessEmail] = useState(true)
    const [canAccessMessaging, setCanAccessMessaging] = useState(true)
    const [canAccessWorkspace, setCanAccessWorkspace] = useState(true)
    const [canAccessAdmin, setCanAccessAdmin] = useState(true)
    const [canAccessReports, setCanAccessReports] = useState(true)

    useEffect(() => {
        if (user) {
            if (user.role === 'admin') {
                setCanAccessEmail(true)
                setCanAccessMessaging(true)
                setCanAccessWorkspace(true)
                setCanAccessAdmin(true)
                setCanAccessReports(true)
            } else {
                setCanAccessEmail(hasModuleAccess('email'))
                setCanAccessWorkspace(hasModuleAccess('workspace'))
                setCanAccessAdmin(hasAnyAdminPermission())
                setCanAccessReports(hasModuleAccess('reports'))

                // Logic for messaging: if they have any channel or a specific messaging module
                import('@/lib/permissions').then(({ hasChannelAccess }) => {
                    setCanAccessMessaging(
                        hasChannelAccess('whatsapp') ||
                        hasChannelAccess('viber') ||
                        hasChannelAccess('linkedin') ||
                        hasChannelAccess('messenger') ||
                        hasChannelAccess('webchat')
                    )
                });
            }
        }
    }, [user])

    // Unseen shared reminders badge count
    const [unseenCount, setUnseenCount] = useState(0)
    const eventsCtx = useEvents()

    useEffect(() => {
        const fetchUnseenCount = async () => {
            try {
                const token = getAuthToken()
                if (!token) return
                const res = await fetch(`${API_URL}/api/todos/shared-with-me/unseen-count`, {
                    headers: { Authorization: `Bearer ${token}` }
                })
                if (res.ok) {
                    const data = await res.json()
                    setUnseenCount(data.unseen_count || 0)
                }
            } catch {}
        }
        fetchUnseenCount()
    }, [])

    useEffect(() => {
        if (!eventsCtx) return
        const unsubscribe = eventsCtx.subscribe('reminder_shared', () => {
            setUnseenCount(prev => prev + 1)
        })
        return unsubscribe
    }, [eventsCtx])

    const [isMounted, setIsMounted] = useState(false)
    useEffect(() => setIsMounted(true), [])

    const logoSrc = branding?.logo_url

    if (!isMounted || !user) {
        return <header className="bg-white border-b border-gray-200 flex items-center justify-between px-6 h-14 fixed top-0 left-0 right-0 z-[60]" />
    }

    return (
        <header className="border-b border-gray-200 flex items-center justify-between px-6 h-14 fixed top-0 left-0 right-0 z-[60]"
            style={{ backgroundColor: 'var(--header-bg)' }}
        >
            {/* Left: brand + tabs */}
            <div className="flex items-center gap-6">
                <Link href="/dashboard" className="flex items-center gap-2">
                    {logoSrc ? (
                        <img src={logoSrc} alt="Company logo" className="h-7 w-auto object-contain" />
                    ) : (
                        <span className="text-xl">📬</span>
                    )}
                    <span className="text-lg font-bold text-gray-800 tracking-tight">
                        {branding?.company_name || 'WorkSpace'}
                    </span>
                </Link>

                {/* Navigation Tabs */}
                <nav className="flex items-center gap-1">
                    {canAccessEmail && (
                        <Link
                            href="/dashboard?tab=email"
                            onClick={(e) => {
                                if (setActiveTab && pathname === '/dashboard') {
                                    e.preventDefault()
                                    setActiveTab('email')
                                }
                            }}
                            className={`flex items-center gap-2 px-4 py-1.5 rounded-lg text-sm font-semibold transition ${isEmailActive
                                ? 'text-white shadow-sm'
                                : 'text-gray-600 hover:bg-gray-100'
                                }`}
                            style={isEmailActive ? { backgroundColor: 'var(--primary-color)' } : {}}
                        >
                            <FiMail size={15} />
                            Email
                        </Link>
                    )}
                    {canAccessMessaging && (
                        <Link
                            href="/dashboard?tab=messaging"
                            onClick={(e) => {
                                if (setActiveTab && pathname === '/dashboard') {
                                    e.preventDefault()
                                    setActiveTab('messaging')
                                }
                            }}
                            className={`flex items-center gap-2 px-4 py-1.5 rounded-lg text-sm font-semibold transition ${isMessagingActive
                                ? 'text-white shadow-sm'
                                : 'text-gray-600 hover:bg-gray-100'
                                }`}
                            style={isMessagingActive ? { backgroundColor: 'var(--primary-color)' } : {}}
                        >
                            <FiMessageSquare size={15} />
                            Messaging
                        </Link>
                    )}
                    {canAccessWorkspace && (
                        <Link
                            href="/workspace"
                            className={`flex items-center gap-2 px-4 py-1.5 rounded-lg text-sm font-semibold transition ${isWorkspaceActive
                                ? 'text-white shadow-sm'
                                : 'text-gray-600 hover:bg-gray-100'
                                }`}
                            style={isWorkspaceActive ? { backgroundColor: 'var(--primary-color)' } : {}}
                        >
                            <FiHeadphones size={15} />
                            Workspace
                        </Link>
                    )}

                    {(user?.role === 'admin' || canAccessAdmin) && (
                        <>
                            <div className="h-6 w-px bg-gray-200 mx-2" />
                            <Link
                                href="/admin"
                                className={`flex items-center gap-2 px-4 py-1.5 rounded-lg text-sm font-semibold transition ${isDashboardActive
                                    ? 'text-white shadow-sm'
                                    : 'text-gray-600 hover:bg-gray-100'
                                    }`}
                                style={isDashboardActive ? { backgroundColor: 'var(--primary-color)' } : {}}
                            >
                                <FiGrid size={15} />
                                Dashboard
                            </Link>
                        </>
                    )}
                    {(user?.role === 'admin' || canAccessReports) && (
                        <Link
                            href="/admin/reports"
                            className={`flex items-center gap-2 px-4 py-1.5 rounded-lg text-sm font-semibold transition ${isReportsActive
                                ? 'text-white shadow-sm'
                                : 'text-gray-600 hover:bg-gray-100'
                                }`}
                            style={isReportsActive ? { backgroundColor: 'var(--primary-color)' } : {}}
                        >
                            <FiBarChart2 size={15} />
                            Reports
                        </Link>
                    )}
                </nav>
            </div>

            {/* Right: reminders badge + profile dropdown */}
            <div className="flex items-center gap-3">
                <Link href="/reminders" className="relative p-2 text-gray-600 hover:text-gray-900 transition">
                    <FiCheckSquare size={20} />
                    {unseenCount > 0 && (
                        <span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs rounded-full h-5 w-5 flex items-center justify-center">
                            {unseenCount > 99 ? '99+' : unseenCount}
                        </span>
                    )}
                </Link>
                <ProfileDropdown user={user} />
            </div>
        </header>
    )
}
