'use client'

import { BrandingProvider } from '@/lib/branding-context'
import { EventsProvider } from '@/lib/events-context'
import { EventNotifications } from '@/components/EventNotifications'
import Softphone from '@/components/Softphone'
import { useEffect } from 'react'
import { getAuthToken } from '@/lib/auth'
import { fetchMyPermissions } from '@/lib/permissions'

export function LayoutClient({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    const token = getAuthToken()
    if (token) {
      fetchMyPermissions()
    }
  }, [])

  return (
    <BrandingProvider>
      <EventsProvider>
        <EventNotifications />
        {children}
        <Softphone user={null} telephonySettings={{ is_active: true }} />
      </EventsProvider>
    </BrandingProvider>
  )
}
