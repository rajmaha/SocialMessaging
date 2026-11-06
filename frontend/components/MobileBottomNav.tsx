'use client'

/**
 * Bottom tab bar — the app's primary navigation on phones.
 *
 * Beyond routing it carries the things that make the bar feel native:
 * live unread badges, haptic feedback on tap, safe-area padding above the
 * home indicator, and the "press back again to exit" hint raised by
 * NativeShell.  Hidden on tablets/desktop (md+), inside iframes, on
 * unauthenticated pages, and in the Electron desktop app.
 */

import { useState, useEffect } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import {
  FiMessageSquare, FiMail, FiMoreHorizontal, FiX,
  FiHeadphones, FiGrid, FiSettings, FiUser, FiActivity,
} from 'react-icons/fi'
import { useUnreadCounts } from '@/lib/use-unread'
import { tapFeedback, isDesktopApp } from '@/lib/native'

export default function MobileBottomNav() {
  const pathname = usePathname()
  const router = useRouter()
  const searchParams = useSearchParams()
  const {
    messages: messageBadge,
    emails: emailBadge,
    clearMessages,
    clearEmails,
  } = useUnreadCounts()

  const [drawerOpen, setDrawerOpen] = useState(false)
  const [exitHint, setExitHint] = useState(false)

  // Detect if rendered inside an iframe (e.g. /email embedded in /dashboard)
  const [isIframe, setIsIframe] = useState(false)
  // The desktop app renders the same tree; the bar is phone-only chrome.
  const [isDesktop, setIsDesktop] = useState(false)
  useEffect(() => {
    if (window.self !== window.top) setIsIframe(true)
    setIsDesktop(isDesktopApp())
  }, [])

  // Opening a tab clears its badge optimistically; the next refresh corrects it.
  useEffect(() => {
    if (pathname === '/dashboard' && searchParams.get('tab') !== 'email') clearMessages()
    if (pathname.includes('/email') || searchParams.get('tab') === 'email') clearEmails()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, searchParams])

  // ── "Press back again to exit" ────────────────────────────────────────────

  useEffect(() => {
    const onHint = () => {
      setExitHint(true)
      setTimeout(() => setExitHint(false), 2000)
    }
    window.addEventListener('nativebackhint', onHint)
    return () => window.removeEventListener('nativebackhint', onHint)
  }, [])

  // The hardware back button should close this drawer before navigating.
  useEffect(() => {
    if (!drawerOpen) return
    const onBack = (e: Event) => {
      e.preventDefault()
      setDrawerOpen(false)
    }
    window.addEventListener('nativeback', onBack)
    return () => window.removeEventListener('nativeback', onBack)
  }, [drawerOpen])

  // Hide on login/register/widget pages, inside an iframe, or on desktop
  if (isIframe || isDesktop || pathname.startsWith('/login') || pathname.startsWith('/register') ||
      pathname.startsWith('/widget') || pathname.startsWith('/reset')) {
    return null
  }

  const go = (href: string) => {
    tapFeedback()
    router.push(href)
  }

  const tabs = [
    { key: 'messaging', label: 'Messaging', icon: FiMessageSquare, href: '/dashboard?tab=messaging', badge: messageBadge },
    { key: 'email', label: 'Email', icon: FiMail, href: '/dashboard?tab=email', badge: emailBadge },
    { key: 'workspace', label: 'Workspace', icon: FiHeadphones, href: '/workspace', badge: 0 },
  ]

  const drawerItems = [
    { label: 'Daily Ops', icon: FiActivity, href: '/daily-ops' },
    { label: 'Admin', icon: FiGrid, href: '/admin' },
    { label: 'Settings', icon: FiSettings, href: '/settings' },
    { label: 'Profile', icon: FiUser, href: '/settings?tab=profile' },
  ]

  const activeTabParam = searchParams.get('tab')
  const isActive = (key: string) => {
    if (key === 'messaging') return pathname === '/dashboard' && activeTabParam !== 'email'
    if (key === 'email') return pathname.includes('/email') || (pathname === '/dashboard' && activeTabParam === 'email')
    if (key === 'workspace') return pathname.startsWith('/workspace')
    return false
  }

  return (
    <>
      {exitHint && <div className="back-exit-hint md:hidden">Press back again to exit</div>}

      {/* Drawer overlay */}
      {drawerOpen && (
        <div className="fixed inset-0 z-[70] md:hidden">
          <div className="absolute inset-0 bg-black/50" onClick={() => setDrawerOpen(false)} />
          <div className="absolute bottom-0 left-0 right-0 bg-white rounded-t-2xl p-4 shadow-xl safe-area-bottom">
            <div className="flex justify-between items-center mb-4">
              <span className="font-semibold text-lg">More</span>
              <button onClick={() => setDrawerOpen(false)} className="p-2" aria-label="Close menu">
                <FiX size={20} />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {drawerItems.map((item) => (
                <button
                  key={item.label}
                  onClick={() => { go(item.href); setDrawerOpen(false) }}
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
      <nav
        className="fixed bottom-0 left-0 right-0 z-[60] border-t border-gray-200 flex md:hidden safe-area-bottom mobile-bottom-nav"
        aria-label="Main navigation"
      >
        {tabs.map((tab) => {
          const active = isActive(tab.key)
          return (
            <button
              key={tab.key}
              onClick={() => go(tab.href)}
              aria-current={active ? 'page' : undefined}
              className={`relative flex-1 flex flex-col items-center justify-center gap-1 pt-3 pb-2 min-h-[56px] ${
                active ? 'text-blue-600' : 'text-gray-500'
              }`}
              style={active ? { color: 'var(--primary-color)' } : undefined}
            >
              <tab.icon size={22} />
              <span className="text-xs">{tab.label}</span>
              {tab.badge > 0 && (
                <span className="tab-badge">{tab.badge > 99 ? '99+' : tab.badge}</span>
              )}
            </button>
          )
        })}
        <button
          onClick={() => { tapFeedback(); setDrawerOpen(true) }}
          className="flex-1 flex flex-col items-center justify-center gap-1 pt-3 pb-2 min-h-[56px] text-gray-500"
          aria-label="More"
        >
          <FiMoreHorizontal size={22} />
          <span className="text-xs">More</span>
        </button>
      </nav>
    </>
  )
}
