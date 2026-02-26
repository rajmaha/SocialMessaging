'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const sidebarGroups = [
    {
        label: 'People',
        items: [
            { href: '/admin/users', label: 'Users', icon: '👤' },
            { href: '/admin/teams', label: 'Teams', icon: '👥' },
        ],
    },
    {
        label: 'Communication',
        items: [
            { href: '/admin/email-accounts', label: 'Email Accounts', icon: '📧' },
            { href: '/admin/settings', label: 'Messenger Config', icon: '⚙️' },
            { href: '/admin/telephony', label: 'Telephony (VoIP)', icon: '🎧' },
            { href: '/admin/recordings', label: 'Call Records', icon: '🎙️' },
            { href: '/admin/extensions', label: 'SIP Extensions', icon: '📞' },
        ],
    },
    {
        label: 'Automation',
        items: [
            { href: '/admin/bot', label: 'Chat Bot', icon: '🤖' },
            { href: '/admin/reminders', label: 'Reminder Calls', icon: '📅' },
            { href: '/admin/notifications', label: 'Notifications', icon: '🔔' },
        ],
    },
    {
        label: 'Appearance',
        items: [
            { href: '/admin/branding', label: 'Branding', icon: '🎨' },
        ],
    },
    {
        label: 'Security',
        items: [
            { href: '/admin/cors', label: 'CORS / Widget Origins', icon: '🌐' },
        ],
    },
    {
        label: 'Applications',
        items: [
            { href: '/admin/callcenter', label: 'Call Center', icon: '📞' },
        ],
    },
]

export default function AdminNav() {
    const pathname = usePathname()

    const isActive = (href: string, exact = false) =>
        exact ? pathname === href : pathname.startsWith(href)

    return (
        <>
            {/* ── Left Sidebar (below MainHeader) ── */}
            <aside
                className="fixed left-0 bottom-0 bg-gray-900 text-white flex flex-col border-r border-gray-700"
                style={{ top: 56, width: 240 }}
            >
                <nav className="flex-1 overflow-y-auto py-4 px-3 space-y-5">
                    {sidebarGroups.map(group => (
                        <div key={group.label}>
                            <p className="text-xs font-bold uppercase tracking-widest text-gray-500 px-2 mb-1.5">
                                {group.label}
                            </p>
                            <ul className="space-y-0.5">
                                {group.items.map(item => {
                                    const active = isActive(item.href)
                                    return (
                                        <li key={item.href}>
                                            <Link
                                                href={item.href}
                                                className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-all ${active
                                                    ? 'bg-indigo-600 text-white font-semibold'
                                                    : 'text-gray-300 hover:bg-gray-800 hover:text-white'
                                                    }`}
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
                    ))}
                </nav>

                {/* Footer */}
                <div className="px-3 py-3 border-t border-gray-700">
                    <p className="px-2 text-xs text-gray-600">Admin Console</p>
                </div>
            </aside>
        </>
    )
}
