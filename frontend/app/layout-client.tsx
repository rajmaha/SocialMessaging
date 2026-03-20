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
    if (token) {
      fetchMyPermissions()
    }
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
