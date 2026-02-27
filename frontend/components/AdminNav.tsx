'use client'

import React, { useState, useEffect } from 'react'
import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import { useBranding } from '@/lib/branding-context'
import { hasModuleAccess, hasAdminFeature } from '@/lib/permissions'

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
            { href: '/admin/subscription-modules', label: 'Subscription Modules', icon: '📦', permission: () => hasModuleAccess('subscriptions') },
            { href: '/admin/cloudpanel/servers', label: 'CloudPanel Servers', icon: '☁️', permission: () => hasAdminFeature('manage_cloudpanel') },
            { href: '/admin/cloudpanel/templates', label: 'Site Templates', icon: '📁', permission: () => hasAdminFeature('manage_cloudpanel') },
            { href: '/admin/cloudpanel/deploy', label: 'Deploy New Site', icon: '🚀', permission: () => hasAdminFeature('deploy_site') },
            { href: '/admin/cloudpanel/ssl', label: 'SSL Monitor', icon: '🔒', permission: () => hasAdminFeature('manage_ssl') },
        ],
    },
]

export default function AdminNav() {
    const pathname = usePathname()
    const searchParams = useSearchParams()
    const brandingCtx = useBranding()
    const branding = brandingCtx?.branding

    const [isMounted, setIsMounted] = useState(false)
    const [userRole, setUserRole] = useState('user')

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
                <nav className="flex-1 overflow-y-auto py-4 px-3 space-y-5">
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
                                                    {active && (
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

