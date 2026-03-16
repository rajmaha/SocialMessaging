'use client'

import React, { useState, useEffect, Suspense } from 'react'
import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import { useBranding } from '@/lib/branding-context'
import { hasModuleAccess, hasAdminFeature, hasPageAccess } from '@/lib/permissions'
import { useEvents } from '@/lib/events-context'
import { menuApi, pmsApi } from '@/lib/api'

const sidebarGroups = [
    {
        label: 'Account',
        items: [
            { href: '/settings?tab=profile', label: 'Profile', icon: '👤' },
            { href: '/settings?tab=accounts', label: 'Connected Agent Accounts', icon: '🔗' },
            { href: '/settings?tab=account-settings', label: 'Account Settings', icon: '⚙️' },
            { href: '/settings/api-credentials', label: 'My API Credentials', icon: '🔑', adminOnly: true },
        ],
    },
    {
        label: 'People',
        items: [
            { href: '/admin/users', label: 'Users', icon: '👤', permission: () => hasAdminFeature('manage_users') },
            { href: '/admin/teams', label: 'Teams', icon: '👥', pageKey: 'teams' },
        ],
    },
    {
        label: 'Communication',
        items: [
            { href: '/admin/email-accounts', label: 'Email Account Management', icon: '📧', permission: () => hasAdminFeature('manage_email_accounts') },
            { href: '/admin/settings', label: 'Messenger Config', icon: '⚙️', permission: () => hasAdminFeature('manage_messenger_config') },
            { href: '/admin/accounts', label: 'Connected Accounts', icon: '🔗', permission: () => hasAdminFeature('manage_messenger_config') },
            { href: '/admin/widget-domains', label: 'Widget Domains', icon: '🌐', permission: () => hasAdminFeature('manage_messenger_config') },
            { href: '/admin/telephony', label: 'Telephony (VoIP)', icon: '🎧', permission: () => hasAdminFeature('manage_telephony') },
            { href: '/admin/recordings', label: 'Call Records', icon: '🎙️', pageKey: 'calls' },
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
            { href: '/admin/cors', label: 'Chat Widget Embed Code', icon: '🌐', permission: () => hasAdminFeature('manage_cors') },
        ],
    },
    {
        label: 'Logs',
        items: [
            { href: '/admin/audit-logs', label: 'Audit Log', icon: '📋', pageKey: 'audit_logs' },
            { href: '/admin/error-logs', label: 'Error Log', icon: '🚨', pageKey: 'error_logs' },
        ],
    },
    {
        label: 'Visitors',
        items: [
            { href: '/admin/visitors', label: 'Visits', icon: '🏢', adminOnly: true },
            { href: '/admin/visitors/locations', label: 'Locations', icon: '📍', adminOnly: true },
        ],
    },
    {
        label: 'Applications',
        items: [
            { href: '/admin/callcenter', label: 'Call Center', icon: '📞', permission: () => hasAdminFeature('manage_telephony') },
            { href: '/admin/ticket-fields', label: 'Ticket Config', icon: '📝', permission: () => hasAdminFeature('manage_dynamic_fields') },
            { href: '/admin/tickets', label: 'All Tickets', icon: '📋', pageKey: 'tickets' },
            { href: '/admin/organizations', label: 'Organizations', icon: '🏢', permission: () => hasModuleAccess('organizations') },
            { href: '/admin/individuals', label: 'Individuals', icon: '👤', permission: () => hasModuleAccess('individuals') },
            { href: '/admin/subscription-modules', label: 'Subscription Modules', icon: '📦', permission: () => hasModuleAccess('subscriptions') },
            { href: '/admin/cicd', label: 'CI/CD Manager', icon: '🔄', adminOnly: true },
            { href: '/admin/cloudpanel/servers', label: 'CloudPanel Servers', icon: '☁️', permission: () => hasAdminFeature('manage_cloudpanel') },
            { href: '/admin/cloudpanel/templates', label: 'Site Templates', icon: '📁', permission: () => hasAdminFeature('manage_cloudpanel') },
            { href: '/admin/cloudpanel/deploy', label: 'Deploy New Site', icon: '🚀', permission: () => hasAdminFeature('deploy_site') },
            { href: '/admin/cloudpanel/sites', label: 'Manage Sites', icon: '🌐', permission: () => hasAdminFeature('manage_cloudpanel') },
            { href: '/admin/cloudpanel/ssl', label: 'SSL Monitor', icon: '🔒', permission: () => hasAdminFeature('manage_ssl') },
            { href: '/admin/cloudpanel/migrations', label: 'DB Migrations', icon: '🗄️', permission: () => hasAdminFeature('manage_cloudpanel') },
            { href: '/admin/backups', label: 'Backups', icon: '🗄️', permission: () => hasAdminFeature('manage_cloudpanel') },
            { href: '/admin/api-servers', label: 'API Servers', icon: '🔌', permission: () => hasAdminFeature('manage_forms') },
            { href: '/admin/forms', label: 'Form Pages', icon: '📋', permission: () => hasAdminFeature('manage_forms') },
        ],
    },
    {
        label: 'Navigation',
        items: [
            { href: '/admin/menus', label: 'Menu Manager', icon: '🗂️', permission: () => hasAdminFeature('manage_menus') },
        ],
    },
    {
        label: 'Content',
        items: [
            { href: '/admin/kb', label: 'Knowledge Base', icon: '📚', pageKey: 'kb' },
        ],
    },
    {
        label: 'Marketing',
        items: [
            { href: '/admin/email-templates', label: 'Email Templates', icon: '🎨', pageKey: 'campaigns' },
            { href: '/admin/campaigns', label: 'Email Campaigns', icon: '📨', pageKey: 'campaigns' },
        ],
    },
    {
        label: 'Business',
        items: [
            { href: '/admin/pricing', label: 'Pricing Plans', icon: '💲', permission: () => hasAdminFeature('manage_billing') },
            { href: '/admin/usage', label: 'Usage Analytics', icon: '📊', pageKey: 'reports' },
        ],
    },
    {
        label: 'PMS',
        items: [
            { href: '/admin/pms', label: 'Dashboard', icon: '📊', pageKey: 'pms' },
            { href: '/admin/pms/my-tasks', label: 'My Tasks', icon: '✅', pageKey: 'pms' },
            { href: '/admin/pms/approval-queue', label: 'Approval Queue', icon: '👁️', pageKey: 'pms', pmOnly: true },
            { href: '/admin/pms/team-workload', label: 'Team Workload', icon: '👥', pageKey: 'pms', pmOnly: true },
            { href: '/admin/pms/capacity', label: 'Capacity Planning', icon: '📐', pageKey: 'pms', pmOnly: true },
            { href: '/admin/pms/escalations', label: 'Escalations', icon: '🚨', pageKey: 'pms', adminOnly: true },
            { href: '/admin/pms/audit-trail', label: 'Audit Trail', icon: '📜', pageKey: 'pms', adminOnly: true },
            { href: '/admin/pms/reports', label: 'Reports', icon: '📈', pageKey: 'pms' },
            { href: '/admin/pms/labels', label: 'Labels', icon: '🏷️', pageKey: 'pms' },
        ],
    },
    {
        label: 'CRM',
        items: [
            { href: '/admin/crm/dashboard/my-day', label: 'My Day', icon: '☀️', pageKey: 'crm' },
            { href: '/admin/crm/dashboard/team-feed', label: 'Team Feed', icon: '👨‍👩‍👧‍👦', pageKey: 'crm' },
            { href: '/admin/crm/leads', label: 'Leads', icon: '👥', pageKey: 'crm' },
            { href: '/admin/crm/deals', label: 'Sales Pipeline', icon: '💼', pageKey: 'crm' },
            { href: '/admin/crm/tasks', label: 'Tasks', icon: '✓', pageKey: 'crm' },
            { href: '/admin/crm/analytics', label: 'Analytics', icon: '📈', pageKey: 'crm' },
            { href: '/admin/crm/companies', label: 'Companies', icon: '🏢', pageKey: 'crm' },
            { href: '/admin/crm/automation', label: 'Automation', icon: '⚡', pageKey: 'crm' },
            { href: '/admin/crm/reports', label: 'Reports', icon: '📊', pageKey: 'crm' },
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
    const _branding = brandingCtx?.branding

    const navRef = React.useRef<HTMLElement>(null)
    const [isMounted, setIsMounted] = useState(false)
    const [userRole, setUserRole] = useState('user')
    const { subscribe } = useEvents()
    const [crmBadge, setCrmBadge] = useState(0)
    const [dynamicMenus, setDynamicMenus] = useState<any[]>([])
    const [isPm, setIsPm] = useState(false)
    const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set())

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
        // Restore collapsed groups
        try {
            const saved = localStorage.getItem('adminNavCollapsed')
            if (saved) setCollapsedGroups(new Set(JSON.parse(saved)))
        } catch {}
        // Check PM status for PMS nav
        if (hasPageAccess('pms')) {
            pmsApi.getDashboard(7)
                .then((r: any) => setIsPm(r.data?.is_pm || false))
                .catch(() => {})
        }
    }, [])

    const toggleGroup = (label: string) => {
        setCollapsedGroups(prev => {
            const next = new Set(prev)
            if (next.has(label)) next.delete(label)
            else next.add(label)
            try { localStorage.setItem('adminNavCollapsed', JSON.stringify([...next])) } catch {}
            return next
        })
    }

    // Load dynamic menus after mount
    useEffect(() => {
        if (!isMounted) return
        menuApi.getAll()
            .then(r => {
                if (Array.isArray(r.data)) setDynamicMenus(r.data)
            })
            .catch(e => console.warn('Failed to load dynamic menus:', e?.response?.status || e))
    }, [isMounted])

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
                <nav ref={navRef} onScroll={handleNavScroll} className="flex-1 overflow-y-auto py-2 px-3 space-y-3">
                    {sidebarGroups.map(group => {
                        // Filter items based on permissions and role
                        const visibleItems = group.items.filter((item: any) => {
                            // Admins see everything
                            if (userRole === 'admin') return true;
                            if (item.adminOnly) return false;
                            if (item.pmOnly) return isPm;
                            // New RBAC: check page key
                            if (item.pageKey) {
                                return hasPageAccess(item.pageKey);
                            }
                            // Legacy: old permission function check (for admin-only features)
                            if (item.permission) {
                                return item.permission();
                            }
                            // No guard = visible to all authenticated users (Account group etc.)
                            return true;
                        });

                        if (visibleItems.length === 0) return null;

                        const isCollapsed = collapsedGroups.has(group.label)
                        return (
                            <div key={group.label}>
                                <button
                                    onClick={() => toggleGroup(group.label)}
                                    className="w-full flex items-center justify-between px-2 mb-1.5 group/hdr"
                                >
                                    <span className="text-xs font-bold uppercase tracking-widest text-gray-500 group-hover/hdr:text-gray-300 transition-colors">
                                        {group.label}
                                    </span>
                                    <span className={`text-gray-600 group-hover/hdr:text-gray-400 transition-transform duration-200 text-xl leading-none ${isCollapsed ? '-rotate-90' : ''}`}>
                                        ▾
                                    </span>
                                </button>
                                {!isCollapsed && (
                                    <ul className="space-y-0.5">
                                        {visibleItems.map(item => {
                                            const active = isActive(item.href)
                                            return (
                                                <li key={item.href}>
                                                    <Link
                                                        href={item.href}
                                                        className={`flex items-center gap-3 px-3 py-1.5 rounded-lg text-sm transition-all ${active
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
                                )}
                            </div>
                        )
                    })}

                    {/* Dynamic menu groups from Menu Manager */}
                    {dynamicMenus.map(group => {
                        const activeItems = (group.items || []).filter((i: any) => i.is_active)
                        if (activeItems.length === 0) return null
                        // Check permission for dynamic menu group
                        if (userRole !== 'admin' && !hasModuleAccess(`menu_${group.slug}`)) return null
                        const dynLabel = `dyn-${group.id}`
                        const isDynCollapsed = collapsedGroups.has(dynLabel)
                        return (
                            <div key={`menu-${group.id}`}>
                                <button
                                    onClick={() => toggleGroup(dynLabel)}
                                    className="w-full flex items-center justify-between px-2 mb-1.5 group/hdr"
                                >
                                    <span className="text-xs font-bold uppercase tracking-widest text-gray-500 group-hover/hdr:text-gray-300 transition-colors">
                                        {group.icon} {group.name}
                                    </span>
                                    <span className={`text-gray-600 group-hover/hdr:text-gray-400 transition-transform duration-200 text-xl leading-none ${isDynCollapsed ? '-rotate-90' : ''}`}>
                                        ▾
                                    </span>
                                </button>
                                {!isDynCollapsed && <ul className="space-y-0.5">
                                    {activeItems.map((item: any) => {
                                        const href = item.link_type === 'form' ? `/forms/${item.link_value}` : item.link_value
                                        const isExternal = item.link_type === 'external'
                                        const active = !isExternal && isActive(href)
                                        return (
                                            <li key={item.id}>
                                                {isExternal ? (
                                                    <a
                                                        href={href}
                                                        target="_blank"
                                                        rel="noopener noreferrer"
                                                        className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-all text-gray-300 hover:bg-white/10 hover:text-white"
                                                        style={{ color: 'var(--sidebar-text)', opacity: 0.8 }}
                                                    >
                                                        <span className="text-base w-5 text-center flex-shrink-0">{item.icon || '·'}</span>
                                                        <span className="truncate">{item.label}</span>
                                                        <span className="ml-auto text-xs opacity-50">↗</span>
                                                    </a>
                                                ) : (
                                                    <Link
                                                        href={href}
                                                        target={item.open_in_new_tab ? '_blank' : undefined}
                                                        className={`flex items-center gap-3 px-3 py-1.5 rounded-lg text-sm transition-all ${active
                                                            ? 'text-white font-semibold'
                                                            : 'text-gray-300 hover:bg-white/10 hover:text-white'
                                                            }`}
                                                        style={active ? { backgroundColor: 'var(--accent-color)', color: 'var(--sidebar-text)' } : { color: 'var(--sidebar-text)', opacity: 0.8 }}
                                                    >
                                                        <span className="text-base w-5 text-center flex-shrink-0">{item.icon || '·'}</span>
                                                        <span className="truncate">{item.label}</span>
                                                        {active && (
                                                            <span className="ml-auto w-2 h-2 rounded-full bg-indigo-300 flex-shrink-0" />
                                                        )}
                                                    </Link>
                                                )}
                                            </li>
                                        )
                                    })}
                                </ul>}
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

