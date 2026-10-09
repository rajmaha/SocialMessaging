'use client'

import React, { useState, useEffect, useMemo, useRef, Suspense } from 'react'
import Link from 'next/link'
import { createPortal } from 'react-dom'
import { DragDropContext, Droppable, Draggable, type DropResult, type DraggableProvided, type DraggableStateSnapshot } from '@hello-pangea/dnd'
import { usePathname, useSearchParams, useRouter } from 'next/navigation'
import { useBranding } from '@/lib/branding-context'
import { hasModuleAccess, hasAdminFeature, hasPageAccess, permissionsReady, fetchMyPermissions } from '@/lib/permissions'
import { useEvents } from '@/lib/events-context'
import { menuApi, pmsApi, menuShortcutApi } from '@/lib/api'
import { FiMenu, FiStar, FiSearch, FiX } from 'react-icons/fi'

// Every admin page renders its own sidebar, so keep the last answer here and the
// Favorites/Recent sections do not flash empty on each navigation.
let shortcutsCache: { favorites: string[]; recent: string[] } | null = null

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
            { href: '/admin/subscription-settings', label: 'Subscription API', icon: '🔗', permission: () => hasModuleAccess('subscriptions') },
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
            { href: '/admin/pms/projects', label: 'Projects', icon: '📁', pageKey: 'pms' },
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
        label: 'Worklog',
        items: [
            { href: '/admin/worklog', label: 'My Worklog', icon: '⏱️', pageKey: 'worklog' },
            { href: '/admin/worklog/approval', label: 'Approval Queue', icon: '✓', pageKey: 'worklog', adminOnly: true },
            { href: '/admin/worklog/reports', label: 'Reports', icon: '📊', pageKey: 'worklog', adminOnly: true },
            { href: '/admin/worklog/categories', label: 'Categories', icon: '🏷️', pageKey: 'worklog', adminOnly: true },
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
    const [mobileOpen, setMobileOpen] = useState(false)
    return (
        <>
            <button
                className="fixed top-[60px] left-2 z-50 p-2 bg-white rounded-lg shadow-md md:hidden"
                onClick={() => setMobileOpen(!mobileOpen)}
            >
                <FiMenu size={20} />
            </button>
            {mobileOpen && (
                <div className="fixed inset-0 bg-black/50 z-30 md:hidden" onClick={() => setMobileOpen(false)} />
            )}
            <Suspense fallback={
                <aside
                    className={`fixed left-0 bottom-0 flex flex-col border-r border-gray-700 z-40 transition-transform ${mobileOpen ? 'translate-x-0' : '-translate-x-full'} md:translate-x-0`}
                    style={{ top: 56, width: 240, backgroundColor: 'var(--secondary-color)' }}
                />
            }>
                <AdminNavInner mobileOpen={mobileOpen} setMobileOpen={setMobileOpen} />
            </Suspense>
        </>
    )
}

function AdminNavInner({ mobileOpen, setMobileOpen }: { mobileOpen: boolean; setMobileOpen: (open: boolean) => void }) {
    const pathname = usePathname()
    const searchParams = useSearchParams()
    const router = useRouter()
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
    const [favorites, setFavorites] = useState<string[]>(shortcutsCache?.favorites ?? [])
    const [recent, setRecent] = useState<string[]>(shortcutsCache?.recent ?? [])
    const [query, setQuery] = useState('')
    const [hi, setHi] = useState(0)
    const searchRef = useRef<HTMLInputElement>(null)
    const lastVisit = useRef('')

    // Re-render trigger — incremented when permissions finish loading
    const [permVer, setPermVer] = useState(0)

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
        // Re-render sidebar when permissions finish loading (async)
        const onPermsLoaded = () => {
            console.debug('[AdminNav] permissions-loaded event received, re-rendering sidebar')
            setPermVer(v => v + 1)
        }
        window.addEventListener('permissions-loaded', onPermsLoaded)

        // If permissions haven't loaded yet, trigger a fetch (safety net)
        if (!permissionsReady()) {
            console.debug('[AdminNav] Permissions not ready, triggering fetch')
            fetchMyPermissions()
        }

        // Also re-fetch permissions when tab becomes visible (handles role changes)
        const onVisibility = () => {
            if (document.visibilityState === 'visible') {
                fetchMyPermissions()
            }
        }
        document.addEventListener('visibilitychange', onVisibility)

        return () => {
            window.removeEventListener('permissions-loaded', onPermsLoaded)
            document.removeEventListener('visibilitychange', onVisibility)
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

    // Favourites and recent menus (kept per user on the server)
    useEffect(() => {
        if (!isMounted) return
        menuShortcutApi.get()
            .then(r => {
                const fav = Array.isArray(r.data?.favorites) ? r.data.favorites : []
                const rec = Array.isArray(r.data?.recent) ? r.data.recent : []
                shortcutsCache = { favorites: fav, recent: rec }
                setFavorites(fav)
                setRecent(rec)
            })
            .catch(e => console.warn('Failed to load menu shortcuts:', e?.response?.status || e))
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


    // ── Menu search, favourites, recent ─────────────────────────────────────
    // Everything is resolved against this catalog, i.e. the menus THIS user can
    // see right now. Only paths are stored, so a stored path never grants access.
    const catalog = useMemo(() => {
        const visible = (item: any) => {
            if (userRole === 'admin') return true
            if (item.adminOnly) return false
            if (item.pmOnly) return isPm
            if (item.pageKey) return hasPageAccess(item.pageKey)
            if (item.permission) return item.permission()
            return true
        }
        const out = new Map<string, any>()
        for (const g of sidebarGroups) {
            for (const it of g.items as any[]) {
                if (visible(it) && !out.has(it.href)) out.set(it.href, { href: it.href, label: it.label, icon: it.icon, group: g.label })
            }
        }
        for (const g of dynamicMenus) {
            if (userRole !== 'admin' && !hasModuleAccess(`menu_${g.slug}`)) continue
            for (const i of (g.items || [])) {
                if (!i.is_active || i.link_type === 'external') continue
                const href = i.link_type === 'form' ? `/forms/${i.link_value}` : i.link_value
                if (typeof href !== 'string' || !href.startsWith('/') || out.has(href)) continue
                out.set(href, { href, label: i.label, icon: i.icon || '·', group: g.name, newTab: !!i.open_in_new_tab })
            }
        }
        return out
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [userRole, isPm, permVer, dynamicMenus])

    // Record the menu this page belongs to (the longest matching link wins, so
    // /admin/pms/projects counts as Projects, not Dashboard).
    useEffect(() => {
        if (!isMounted) return
        let cur: any = null
        catalog.forEach(it => {
            if (isActive(it.href) && (!cur || it.href.split('?')[0].length > cur.href.split('?')[0].length)) cur = it
        })
        if (!cur || lastVisit.current === cur.href) return
        const href = cur.href
        lastVisit.current = href
        setRecent(r => {
            const next = [href, ...r.filter(p => p !== href)].slice(0, 20)
            shortcutsCache = { favorites: shortcutsCache?.favorites ?? [], recent: next }
            return next
        })
        menuShortcutApi.visit(href).catch(() => {})
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isMounted, catalog, pathname, searchParams])

    useEffect(() => {
        if (shortcutsCache) shortcutsCache = { ...shortcutsCache, favorites }
    }, [favorites])

    const toggleFav = (href: string) => {
        const on = !favorites.includes(href)
        setFavorites(f => (on ? [...f, href] : f.filter(p => p !== href)))
        menuShortcutApi.setFavorite(href, on).catch(() =>
            setFavorites(f => (on ? f.filter(p => p !== href) : [...f, href]))
        )
    }

    const clearRecent = () => {
        setRecent([])
        menuShortcutApi.clearRecent().catch(() => {})
    }

    const onFavDragEnd = (res: DropResult) => {
        if (!res.destination || res.destination.index === res.source.index) return
        const shown = favorites.filter(p => catalog.has(p))
        const [moved] = shown.splice(res.source.index, 1)
        shown.splice(res.destination.index, 0, moved)
        // Favorites this user cannot see right now keep their place, after the rest.
        const next = [...shown, ...favorites.filter(p => !catalog.has(p))]
        const prev = favorites
        setFavorites(next)
        menuShortcutApi.reorderFavorites(next).catch(() => setFavorites(prev))
    }

    const favItems = favorites.map(p => catalog.get(p)).filter(Boolean) as any[]
    const recentItems = recent.map(p => catalog.get(p)).filter(Boolean).slice(0, 10) as any[]

    // Every word must appear in the label or its group, so "purch req" finds it.
    const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
    const results: any[] = terms.length === 0 ? [] : Array.from(catalog.values())
        .map(it => {
            const label = String(it.label).toLowerCase()
            if (!terms.every(t => `${label} ${String(it.group).toLowerCase()}`.includes(t))) return null
            const score = label.startsWith(terms[0]) ? 0 : label.split(/\s+/).some(w => w.startsWith(terms[0])) ? 1 : 2
            return { it, score }
        })
        .filter(Boolean)
        .sort((a: any, b: any) => a.score - b.score)
        .slice(0, 30)
        .map((r: any) => r.it)

    const openMenu = (item: any) => {
        setQuery('')
        setMobileOpen(false)
        if (item.newTab) window.open(item.href, '_blank')
        else router.push(item.href)
    }

    const onSearchKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Escape') { setQuery(''); e.currentTarget.blur() }
        else if (e.key === 'ArrowDown') { e.preventDefault(); setHi(h => Math.min(h + 1, Math.max(results.length - 1, 0))) }
        else if (e.key === 'ArrowUp') { e.preventDefault(); setHi(h => Math.max(h - 1, 0)) }
        else if (e.key === 'Enter' && results[hi]) { e.preventDefault(); openMenu(results[hi]) }
    }

    // Ctrl/Cmd+K, or "/" outside a field, jumps to the search box.
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            const t = e.target as HTMLElement | null
            const typing = !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)
            if (((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') || (e.key === '/' && !typing && !e.ctrlKey && !e.metaKey && !e.altKey)) {
                e.preventDefault()
                setMobileOpen(true)
                searchRef.current?.focus()
                searchRef.current?.select()
            }
        }
        document.addEventListener('keydown', onKey)
        return () => document.removeEventListener('keydown', onKey)
    }, [setMobileOpen])

    useEffect(() => { setHi(0) }, [query])

    const renderRow = (item: any, opts: { highlighted?: boolean; showGroup?: boolean; drag?: { provided: DraggableProvided; snapshot: DraggableStateSnapshot } } = {}) => {
        const active = isActive(item.href)
        const fav = favorites.includes(item.href)
        const d = opts.drag
        // The sidebar has a CSS transform, which would offset a position:fixed drag
        // preview, so the row being dragged is drawn on <body> instead.
        const dragging = !!d?.snapshot.isDragging
        const row = (
            <li
                key={item.href}
                className={`group/row relative ${dragging ? 'rounded-lg shadow-xl' : ''}`}
                ref={d?.provided.innerRef}
                {...(d?.provided.draggableProps ?? {})}
                {...(d?.provided.dragHandleProps ?? {})}
                style={{ ...(d?.provided.draggableProps.style ?? {}), ...(dragging ? { backgroundColor: 'var(--secondary-color)', color: 'var(--sidebar-text)' } : {}) }}
                title={d ? 'Drag to reorder' : undefined}
            >
                <Link
                    href={item.href}
                    draggable={false}
                    target={item.newTab ? '_blank' : undefined}
                    onClick={() => { setMobileOpen(false); setQuery('') }}
                    className={`flex items-center gap-3 pl-3 pr-8 py-1.5 rounded-lg text-sm transition-all ${active
                        ? 'text-white font-semibold'
                        : 'text-gray-300 hover:bg-white/10 hover:text-white'
                        } ${opts.highlighted ? 'bg-white/15 ring-1 ring-white/30' : ''}`}
                    style={active ? { backgroundColor: 'var(--accent-color)', color: 'var(--sidebar-text)' } : { color: 'var(--sidebar-text)', opacity: 0.8 }}
                >
                    <span className="text-base w-5 text-center flex-shrink-0">{item.icon || '·'}</span>
                    <span className="min-w-0 flex-1">
                        <span className="block truncate">{item.label}</span>
                        {opts.showGroup && <span className="block truncate text-[10px] uppercase tracking-wider opacity-60">{item.group}</span>}
                    </span>
                    {crmBadge > 0 && item.href.startsWith('/admin/crm') && (
                        <span className="bg-red-500 text-white text-xs rounded-full h-5 min-w-[20px] flex items-center justify-center px-1 flex-shrink-0">
                            {crmBadge > 99 ? '99+' : crmBadge}
                        </span>
                    )}
                    {active && crmBadge === 0 && (
                        <span className="w-2 h-2 rounded-full bg-indigo-300 flex-shrink-0" />
                    )}
                </Link>
                <button
                    type="button"
                    onClick={e => { e.preventDefault(); e.stopPropagation(); toggleFav(item.href) }}
                    title={fav ? 'Remove from favorites' : 'Add to favorites'}
                    aria-label={fav ? `Remove ${item.label} from favorites` : `Add ${item.label} to favorites`}
                    aria-pressed={fav}
                    className={`absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded transition-opacity hover:bg-white/20 focus:opacity-100 ${fav ? 'text-yellow-300 opacity-100' : 'text-gray-400 md:opacity-0 md:group-hover/row:opacity-100'}`}
                >
                    <FiStar size={14} fill={fav ? 'currentColor' : 'none'} />
                </button>
            </li>
        )
        return dragging ? createPortal(row, document.body) : row
    }

    const sectionHeader = (key: string, title: React.ReactNode, extra?: React.ReactNode) => (
        <div className="flex items-center justify-between px-2 mb-1.5">
            <button onClick={() => toggleGroup(key)} className="flex-1 flex items-center justify-between group/hdr">
                <span className="text-xs font-bold uppercase tracking-widest text-gray-500 group-hover/hdr:text-gray-300 transition-colors">{title}</span>
                <span className={`text-gray-600 group-hover/hdr:text-gray-400 transition-transform duration-200 text-xl leading-none ${collapsedGroups.has(key) ? '-rotate-90' : ''}`}>▾</span>
            </button>
            {extra}
        </div>
    )

    if (!isMounted) {
        return (
            <aside
                className={`fixed left-0 bottom-0 flex flex-col border-r border-gray-700 z-40 transition-transform ${mobileOpen ? 'translate-x-0' : '-translate-x-full'} md:translate-x-0`}
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
                className={`fixed left-0 bottom-0 flex flex-col border-r border-gray-700 z-40 transition-transform ${mobileOpen ? 'translate-x-0' : '-translate-x-full'} md:translate-x-0`}
                style={{
                    top: 56,
                    width: 240,
                    backgroundColor: 'var(--secondary-color)',
                    color: 'var(--sidebar-text)'
                }}
            >
                <nav ref={navRef} onScroll={handleNavScroll} className="flex-1 overflow-y-auto py-2 px-3 space-y-3">
                    <div className="sticky top-0 z-10 -mx-3 px-3 -mt-2 pt-2 pb-1" style={{ backgroundColor: 'var(--secondary-color)' }}>
                        <div className="relative">
                            <FiSearch size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                            <input
                                ref={searchRef}
                                type="text"
                                value={query}
                                onChange={e => setQuery(e.target.value)}
                                onKeyDown={onSearchKey}
                                placeholder="Search menus…  (Ctrl+K)"
                                aria-label="Search menus"
                                autoComplete="off"
                                className="w-full pl-8 pr-7 py-1.5 text-sm rounded-lg bg-white/10 text-white placeholder-gray-400 border border-white/10 focus:outline-none focus:bg-white/15 focus:border-white/30"
                            />
                            {query && (
                                <button
                                    type="button"
                                    onClick={() => { setQuery(''); searchRef.current?.focus() }}
                                    aria-label="Clear search"
                                    className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white"
                                >
                                    <FiX size={14} />
                                </button>
                            )}
                        </div>
                    </div>

                    {terms.length > 0 ? (
                        results.length === 0 ? (
                            <p className="px-2 py-3 text-sm text-gray-400">No menu matches “{query.trim()}”.</p>
                        ) : (
                            <ul className="space-y-0.5">
                                {results.map((item, i) => renderRow(item, { highlighted: i === hi, showGroup: true }))}
                            </ul>
                        )
                    ) : (<>
                    {/* Favorites */}
                    <div>
                        {sectionHeader('__favorites', <>⭐ Favorites</>)}
                        {!collapsedGroups.has('__favorites') && (
                            favItems.length === 0
                                ? <p className="px-3 text-xs text-gray-500">Click the ☆ beside any menu to pin it here.</p>
                                : (
                                    <DragDropContext onDragEnd={onFavDragEnd}>
                                        <Droppable droppableId="menu-favorites">
                                            {dropProvided => (
                                                <ul className="space-y-0.5" ref={dropProvided.innerRef} {...dropProvided.droppableProps}>
                                                    {favItems.map((item, i) => (
                                                        <Draggable key={item.href} draggableId={item.href} index={i}>
                                                            {(provided, snapshot) => renderRow(item, { drag: { provided, snapshot } })}
                                                        </Draggable>
                                                    ))}
                                                    {dropProvided.placeholder}
                                                </ul>
                                            )}
                                        </Droppable>
                                    </DragDropContext>
                                )
                        )}
                    </div>

                    {/* Recent */}
                    {recentItems.length > 0 && (
                        <div>
                            {sectionHeader('__recent', <>🕘 Recent</>, (
                                <button onClick={clearRecent} title="Clear recent menus" className="ml-2 text-[10px] uppercase tracking-wider text-gray-500 hover:text-gray-300">Clear</button>
                            ))}
                            {!collapsedGroups.has('__recent') && (
                                <ul className="space-y-0.5">{recentItems.map(item => renderRow(item))}</ul>
                            )}
                        </div>
                    )}

                    {sidebarGroups.map(group => {
                        const visibleItems = group.items.filter((item: any) => catalog.get(item.href)?.group === group.label)

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
                                        {visibleItems.map((item: any) => renderRow(item))}
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
                                        if (isExternal) {
                                            return (
                                                <li key={item.id}>
                                                    <a
                                                        href={href}
                                                        target="_blank"
                                                        rel="noopener noreferrer"
                                                        onClick={() => setMobileOpen(false)}
                                                        className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-all text-gray-300 hover:bg-white/10 hover:text-white"
                                                        style={{ color: 'var(--sidebar-text)', opacity: 0.8 }}
                                                    >
                                                        <span className="text-base w-5 text-center flex-shrink-0">{item.icon || '·'}</span>
                                                        <span className="truncate">{item.label}</span>
                                                        <span className="ml-auto text-xs opacity-50">↗</span>
                                                    </a>
                                                </li>
                                            )
                                        }
                                        const entry = catalog.get(href)
                                        return entry ? renderRow(entry) : null
                                    })}
                                </ul>}
                            </div>
                        )
                    })}
                    </>)}
                </nav>

                <div className="px-3 py-3 border-t border-gray-700">
                    <p className="px-2 text-xs text-gray-600">Admin Console</p>
                </div>
            </aside>
        </>
    )
}

