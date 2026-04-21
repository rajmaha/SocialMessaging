'use client'

import { BrandingProvider } from '@/lib/branding-context'
import { EventsProvider } from '@/lib/events-context'
import { EventNotifications } from '@/components/EventNotifications'
import { SoftphoneProvider } from '@/lib/softphone-context'
import { EmailComposeProvider } from '@/lib/email-compose-context'
import Softphone from '@/components/Softphone'
import EmailComposePopover from '@/components/EmailComposePopover'
import MobileBottomNav from '@/components/MobileBottomNav'
import { useEffect } from 'react'
import { usePathname } from 'next/navigation'
import { getAuthToken } from '@/lib/auth'
import { fetchMyPermissions } from '@/lib/permissions'

export function LayoutClient({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()

  // Widget and public form pages run inside iframes (often cross-origin).
  // They don't need dashboard providers and those providers can crash when
  // localStorage is blocked in third-party iframe contexts.
  if (pathname.startsWith('/widget') || pathname.startsWith('/forms/') || pathname.startsWith('/kiosk/')) {
    return <>{children}</>
  }

  return <DashboardShell>{children}</DashboardShell>
}

function DashboardShell({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    const token = getAuthToken()
    if (!token) return

    // Restore user_role cookie if localStorage has the user but the cookie was lost
    // (session cookies are cleared on browser close while localStorage persists)
    const userRoleCookie = document.cookie.split(';').some(c => c.trim().startsWith('user_role='))
    if (!userRoleCookie) {
      try {
        const stored = localStorage.getItem('user')
        if (stored) {
          const user = JSON.parse(stored)
          document.cookie = `user_role=${user.role || 'support'}; path=/; SameSite=Lax; Max-Age=2592000`
        }
      } catch {}
    }

    fetchMyPermissions()
  }, [])

  return (
    <BrandingProvider>
      <EventsProvider>
        <SoftphoneProvider>
          <EmailComposeProvider>
            <EventNotifications />
            {children}
            <Softphone />
            <EmailComposePopover />
            <MobileBottomNav />
          </EmailComposeProvider>
        </SoftphoneProvider>
      </EventsProvider>
    </BrandingProvider>
  )
}
