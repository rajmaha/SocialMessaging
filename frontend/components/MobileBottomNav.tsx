'use client'

import { useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { FiMessageSquare, FiMail, FiMoreHorizontal, FiX,
         FiHeadphones, FiGrid, FiSettings, FiUser } from 'react-icons/fi'

export default function MobileBottomNav() {
  const pathname = usePathname()
  const router = useRouter()
  const [drawerOpen, setDrawerOpen] = useState(false)

  // Hide on login/register/widget pages
  if (pathname.startsWith('/login') || pathname.startsWith('/register') ||
      pathname.startsWith('/widget') || pathname.startsWith('/reset')) {
    return null
  }

  const tabs = [
    { key: 'messaging', label: 'Messaging', icon: FiMessageSquare, href: '/dashboard?tab=messaging' },
    { key: 'email', label: 'Email', icon: FiMail, href: '/dashboard?tab=email' },
  ]

  const drawerItems = [
    { label: 'Workspace', icon: FiHeadphones, href: '/workspace' },
    { label: 'Admin', icon: FiGrid, href: '/admin' },
    { label: 'Settings', icon: FiSettings, href: '/settings' },
    { label: 'Profile', icon: FiUser, href: '/settings?tab=profile' },
  ]

  const isActive = (key: string) => {
    if (key === 'messaging') return pathname === '/dashboard' && !pathname.includes('tab=email')
    if (key === 'email') return pathname.includes('/email') || pathname.includes('tab=email')
    return false
  }

  return (
    <>
      {/* Drawer overlay */}
      {drawerOpen && (
        <div className="fixed inset-0 z-[70] md:hidden">
          <div className="absolute inset-0 bg-black/50" onClick={() => setDrawerOpen(false)} />
          <div className="absolute bottom-0 left-0 right-0 bg-white rounded-t-2xl p-4 pb-8 shadow-xl">
            <div className="flex justify-between items-center mb-4">
              <span className="font-semibold text-lg">More</span>
              <button onClick={() => setDrawerOpen(false)} className="p-2">
                <FiX size={20} />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {drawerItems.map((item) => (
                <button
                  key={item.label}
                  onClick={() => { router.push(item.href); setDrawerOpen(false) }}
                  className="flex flex-col items-center gap-2 p-4 rounded-xl bg-gray-50 hover:bg-gray-100 active:bg-gray-200"
                >
                  <item.icon size={24} className="text-gray-700" />
                  <span className="text-sm text-gray-700">{item.label}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Bottom tab bar - hidden on md+ screens */}
      <nav className="fixed bottom-0 left-0 right-0 z-[60] bg-white border-t border-gray-200 flex md:hidden safe-area-bottom mobile-bottom-nav">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => router.push(tab.href)}
            className={`flex-1 flex flex-col items-center gap-1 py-2 pt-3 ${
              isActive(tab.key) ? 'text-blue-600' : 'text-gray-500'
            }`}
            style={isActive(tab.key) ? { color: 'var(--primary-color)' } : undefined}
          >
            <tab.icon size={22} />
            <span className="text-xs">{tab.label}</span>
          </button>
        ))}
        <button
          onClick={() => setDrawerOpen(true)}
          className="flex-1 flex flex-col items-center gap-1 py-2 pt-3 text-gray-500"
        >
          <FiMoreHorizontal size={22} />
          <span className="text-xs">More</span>
        </button>
      </nav>
    </>
  )
}
