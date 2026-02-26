'use client'

import React from 'react'
import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import { FiMessageSquare, FiMail, FiBarChart2, FiGrid, FiHeadphones } from 'react-icons/fi'
import ProfileDropdown from '@/components/ProfileDropdown'
import { useBranding } from '@/lib/branding-context'
import type { User } from '@/lib/auth'
import { hasModuleAccess } from '@/lib/permissions'
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

    useEffect(() => {
        if (user && user.role !== 'admin') {
            setCanAccessEmail(hasModuleAccess('email'))
            // Logic for messaging: if they have any channel or a specific messaging module (we removed messaging module, it's channels now)
            // Let's assume if they have WhatsApp or Messenger or any channel, they can access messaging
            import('@/lib/permissions').then(({ hasChannelAccess }) => {
                setCanAccessMessaging(
                    hasChannelAccess('whatsapp') ||
                    hasChannelAccess('viber') ||
                    hasChannelAccess('linkedin') ||
                    hasChannelAccess('messenger') ||
                    hasChannelAccess('webchat')
                )
            });
            setCanAccessWorkspace(hasModuleAccess('workspace'))
        }
    }, [user])

    const [isMounted, setIsMounted] = useState(false)
    useEffect(() => setIsMounted(true), [])

    const logoSrc = branding?.logo_url

    if (!isMounted || !user) {
        return <header className="bg-white border-b border-gray-200 flex items-center justify-between px-6 h-14 fixed top-0 left-0 right-0 z-[60]" />
    }

    return (
        <header className="bg-white border-b border-gray-200 flex items-center justify-between px-6 h-14 fixed top-0 left-0 right-0 z-[60]">
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
                                ? 'bg-blue-600 text-white shadow-sm'
                                : 'text-gray-600 hover:bg-gray-100'
                                }`}
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
                                ? 'bg-blue-600 text-white shadow-sm'
                                : 'text-gray-600 hover:bg-gray-100'
                                }`}
                        >
                            <FiMessageSquare size={15} />
                            Messaging
                        </Link>
                    )}
                    {canAccessWorkspace && (
                        <Link
                            href="/workspace"
                            className={`flex items-center gap-2 px-4 py-1.5 rounded-lg text-sm font-semibold transition ${isWorkspaceActive
                                ? 'bg-blue-600 text-white shadow-sm'
                                : 'text-gray-600 hover:bg-gray-100'
                                }`}
                        >
                            <FiHeadphones size={15} />
                            Workspace
                        </Link>
                    )}

                    {user?.role === 'admin' && (
                        <>
                            <div className="h-6 w-px bg-gray-200 mx-2" />
                            <Link
                                href="/admin"
                                className={`flex items-center gap-2 px-4 py-1.5 rounded-lg text-sm font-semibold transition ${isDashboardActive
                                    ? 'bg-indigo-600 text-white shadow-sm'
                                    : 'text-gray-600 hover:bg-gray-100'
                                    }`}
                            >
                                <FiGrid size={15} />
                                Dashboard
                            </Link>
                            <Link
                                href="/admin/reports"
                                className={`flex items-center gap-2 px-4 py-1.5 rounded-lg text-sm font-semibold transition ${isReportsActive
                                    ? 'bg-indigo-600 text-white shadow-sm'
                                    : 'text-gray-600 hover:bg-gray-100'
                                    }`}
                            >
                                <FiBarChart2 size={15} />
                                Reports
                            </Link>
                        </>
                    )}
                </nav>
            </div>

            {/* Right: profile dropdown */}
            <div className="flex items-center">
                <ProfileDropdown user={user} />
            </div>
        </header>
    )
}
