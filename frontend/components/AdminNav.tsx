'use client'

import React, { useState, useEffect, Suspense } from 'react'
import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import { useBranding } from '@/lib/branding-context'
import { hasModuleAccess, hasAdminFeature } from '@/lib/permissions'
import { useEvents } from '@/lib/events-context'

const sidebarGroups = [
    {
        label: 'Account',
        items: [
            { href: '/settings?tab=profile', label: 'Profile', icon: '👤' },
            { href: '/settings?tab=accounts', label: 'Connected Accounts', icon: '🔗' },
            { href: '/settings?tab=account-settings', label: 'Account Settings', icon: '⚙️' },
        ],
    },
    {
        label: 'People',
        items: [
            { href: '/admin/users', label: 'Users', icon: '👤', permission: () => hasAdminFeature('manage_users') },
            { href: '/admin/teams', label: 'Teams', icon: '👥', permission: () => hasAdminFeature('manage_teams') },
        ],
    },
    {
        label: 'Communication',
        items: [
            { href: '/admin/email-accounts', label: 'Email Account Management', icon: '📧', permission: () => hasAdminFeature('manage_email_accounts') },
            { href: '/admin/settings', label: 'Messenger Config', icon: '⚙️', permission: () => hasAdminFeature('manage_messenger_config') },
            { href: '/admin/telephony', label: 'Telephony (VoIP)', icon: '🎧', permission: () => hasAdminFeature('manage_telephony') },
            { href: '/admin/recordings', label: 'Call Records', icon: '🎙️', permission: () => hasModuleAccess('calls') },
            { href: '/admin/extensions', label: 'SIP Extensions', icon: '📞', permission: () => hasAdminFeature('manage_extensions') },
        ],
    },
    {
        label: 'Automation',
        items: [
            { href: '/admin/bot', label: 'Chat Bot', icon: '🤖', permission: () => hasAdminFeature('manage_bot') },
            { href: '/admin/reminders', label: 'Reminder Calls', icon: '📅', permission: () => hasModuleAccess('reminders') },
            { href: '/admin/notifications', label: 'Notifications', icon: '🔔', permission: () => hasModuleAccess('notifications') },
            { href: '/admin/calendar-settings', label: 'Calendar Integration', icon: '📆', permission: () => hasAdminFeature('manage_branding') },
        ],
    },
    {
        label: 'Appearance',
        items: [
            { href: '/admin/branding', label: 'Branding', icon: '🎨', permission: () => hasAdminFeature('manage_branding') },
        ],
    },
    {
        label: 'Security',
        items: [
            { href: '/admin/roles', label: 'Role Permissions', icon: '🔑', permission: () => hasAdminFeature('manage_roles') },
            { href: '/admin/cors', label: 'CORS / Widget Origins', icon: '🌐', permission: () => hasAdminFeature('manage_cors') },
        ],
    },
    {
        label: 'Applications',
        items: [
            { href: '/admin/callcenter', label: 'Call Center', icon: '📞', permission: () => hasModuleAccess('workspace') },
            { href: '/admin/ticket-fields', label: 'Ticket Config', icon: '📝', permission: () => hasAdminFeature('manage_tickets') },
            { href: '/admin/tickets', label: 'All Tickets', icon: '📋', permission: () => hasAdminFeature('manage_tickets') },
            { href: '/admin/organizations', label: 'Organizations', icon: '🏢', permission: () => hasModuleAccess('organizations') },
            { href: '/admin/individuals', label: 'Individuals', icon: '👤', permission: () => hasModuleAccess('individuals') },
            { href: '/admin/subscription-modules', label: 'Subscription Modules', icon: '📦', permission: () => hasModuleAccess('subscriptions') },
            { href: '/admin/cloudpanel/servers', label: 'CloudPanel Servers', icon: '☁️', permission: () => hasAdminFeature('manage_cloudpanel') },
            { href: '/admin/cloudpanel/templates', label: 'Site Templates', icon: '📁', permission: () => hasAdminFeature('manage_cloudpanel') },
            { href: '/admin/cloudpanel/deploy', label: 'Deploy New Site', icon: '🚀', permission: () => hasAdminFeature('deploy_site') },
            { href: '/admin/cloudpanel/sites', label: 'Manage Sites', icon: '🌐', permission: () => hasAdminFeature('manage_cloudpanel') },
            { href: '/admin/cloudpanel/ssl', label: 'SSL Monitor', icon: '🔒', permission: () => hasAdminFeature('manage_ssl') },
            { href: '/admin/cloudpanel/migrations', label: 'DB Migrations', icon: '🗄️', permission: () => hasAdminFeature('manage_cloudpanel') },
            { href: '/admin/backups', label: 'Backups', icon: '🗄️', permission: () => hasAdminFeature('manage_cloudpanel') },
        ],
    },
    {
        label: 'Content',
        items: [
            { href: '/admin/kb', label: 'Knowledge Base', icon: '📚', permission: () => hasAdminFeature('manage_branding') },
        ],
    },
    {
        label: 'Marketing',
        items: [
            { href: '/admin/email-templates', label: 'Email Templates', icon: '🎨', permission: () => hasAdminFeature('manage_billing') },
            { href: '/admin/campaigns', label: 'Email Campaigns', icon: '📨', permission: () => hasAdminFeature('manage_billing') },
        ],
    },
    {
        label: 'Business',
        items: [
            { href: '/admin/pricing', label: 'Pricing Plans', icon: '💲', permission: () => hasAdminFeature('manage_billing') },
            { href: '/admin/usage', label: 'Usage Analytics', icon: '📊', permission: () => hasAdminFeature('manage_billing') },
            { href: '/admin/crm/leads', label: 'Leads', icon: '👥', permission: () => hasAdminFeature('feature_manage_crm') },
            { href: '/admin/crm/deals', label: 'Sales Pipeline', icon: '💼', permission: () => hasAdminFeature('feature_manage_crm') },
            { href: '/admin/crm/tasks', label: 'Tasks', icon: '✓', permission: () => hasAdminFeature('feature_manage_crm') },
            { href: '/admin/crm/analytics', label: 'Analytics', icon: '📈', permission: () => hasAdminFeature('feature_manage_crm') },
            { href: '/admin/crm/companies', label: 'Companies', icon: '🏢', permission: () => hasAdminFeature('feature_manage_crm') },
            { href: '/admin/crm/automation', label: 'Automation', icon: '⚡', permission: () => hasAdminFeature('feature_manage_crm') },
        ],
    },
]

export default function AdminNav() {
    return (
        <Suspense fallback={<aside className="fixed left-0 bottom-0 flex flex-col border-r border-gray-700 z-40" style={{ top: 56, width: 240, backgroundColor: 'var(--secondary-color)' }} />}>
            <AdminNavInner />
        </Suspense>
    )
}

function AdminNavInner() {
    const pathname = usePathname()
    const searchParams = useSearchParams()
    const brandingCtx = useBranding()
    const branding = brandingCtx?.branding

    const navRef = React.useRef<HTMLElement>(null)
    const [isMounted, setIsMounted] = useState(false)
    const [userRole, setUserRole] = useState('user')
    const { subscribe } = useEvents()
    const [crmBadge, setCrmBadge] = useState(0)

    useEffect(() => {
        setIsMounted(true)
        const userStr = localStorage.getItem('user')
        if (userStr) {
            try {
                setUserRole(JSON.parse(userStr).role)
            } catch (e) {
                console.error('Failed to parse user from localStorage', e)
            }
        }
    }, [])

    // Restore saved scroll position after mount
    useEffect(() => {
        if (!isMounted || !navRef.current) return
        const saved = sessionStorage.getItem('adminNavScrollTop')
        if (saved) navRef.current.scrollTop = parseInt(saved, 10)
    }, [isMounted])

    // Save scroll position on scroll
    const handleNavScroll = (e: React.UIEvent<HTMLElement>) => {
        sessionStorage.setItem('adminNavScrollTop', String(e.currentTarget.scrollTop))
    }

    // Increment badge on any CRM event
    useEffect(() => {
        const unsub1 = subscribe('crm_lead_assigned', () => setCrmBadge(n => n + 1))
        const unsub2 = subscribe('crm_deal_stage_changed', () => setCrmBadge(n => n + 1))
        const unsub3 = subscribe('crm_task_overdue', () => setCrmBadge(n => n + 1))
        return () => { unsub1(); unsub2(); unsub3() }
    }, [subscribe])

    // Clear badge when user is on a CRM page
    useEffect(() => {
        if (pathname.startsWith('/admin/crm')) {
            setCrmBadge(0)
        }
    }, [pathname])

    const isActive = (href: string, exact = false) => {
        const [pathOnly, queryString] = href.split('?');
        if (exact) return pathname === pathOnly;

        if (pathOnly === '/settings') {
            if (pathname !== '/settings') return false;
            if (queryString) {
                const urlParams = new URLSearchParams(queryString);
                const expectedTab = urlParams.get('tab');
                const actualTab = searchParams.get('tab') || 'email-messaging';
                return actualTab === expectedTab;
            }
            return true;
        }

        return pathname.startsWith(pathOnly);
    }

    if (!isMounted) {
        return (
            <aside
                className="fixed left-0 bottom-0 flex flex-col border-r border-gray-700 z-40"
                style={{
                    top: 56,
                    width: 240,
                    backgroundColor: 'var(--secondary-color)',
                    color: 'var(--sidebar-text)'
                }}
            />
        )
    }

    return (
        <>
            <aside
                className="fixed left-0 bottom-0 flex flex-col border-r border-gray-700 z-40"
                style={{
                    top: 56,
                    width: 240,
                    backgroundColor: 'var(--secondary-color)',
                    color: 'var(--sidebar-text)'
                }}
            >
                <nav ref={navRef} onScroll={handleNavScroll} className="flex-1 overflow-y-auto py-4 px-3 space-y-5">
                    {sidebarGroups.map(group => {
                        // Filter items based on permissions and role
                        const visibleItems = group.items.filter(item => {
                            // Admins see everything
                            if (userRole === 'admin') return true;
                            // Check specific permission if defined
                            if ((item as any).permission) {
                                return (item as any).permission();
                            }
                            // Default to FALSE for non-admins if no explicit permission defined
                            return false;
                        });

                        if (visibleItems.length === 0) return null;

                        return (
                            <div key={group.label}>
                                <p className="text-xs font-bold uppercase tracking-widest text-gray-500 px-2 mb-1.5">
                                    {group.label}
                                </p>
                                <ul className="space-y-0.5">
                                    {visibleItems.map(item => {
                                        const active = isActive(item.href)
                                        return (
                                            <li key={item.href}>
                                                <Link
                                                    href={item.href}
                                                    className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-all ${active
                                                        ? 'text-white font-semibold'
                                                        : 'text-gray-300 hover:bg-white/10 hover:text-white'
                                                        }`}
                                                    style={active ? { backgroundColor: 'var(--accent-color)', color: 'var(--sidebar-text)' } : { color: 'var(--sidebar-text)', opacity: 0.8 }}
                                                >
                                                    <span className="text-base w-5 text-center flex-shrink-0">{item.icon}</span>
                                                    <span className="truncate">{item.label}</span>
                                                    {crmBadge > 0 && item.href.startsWith('/admin/crm') && (
                                                        <span className="ml-auto bg-red-500 text-white text-xs rounded-full h-5 min-w-[20px] flex items-center justify-center px-1 flex-shrink-0">
                                                            {crmBadge > 99 ? '99+' : crmBadge}
                                                        </span>
                                                    )}
                                                    {active && crmBadge === 0 && (
                                                        <span className="ml-auto w-2 h-2 rounded-full bg-indigo-300 flex-shrink-0" />
                                                    )}
                                                </Link>
                                            </li>
                                        )
                                    })}
                                </ul>
                            </div>
                        )
                    })}
                </nav>

                <div className="px-3 py-3 border-t border-gray-700">
                    <p className="px-2 text-xs text-gray-600">Admin Console</p>
                </div>
            </aside>
        </>
    )
}

