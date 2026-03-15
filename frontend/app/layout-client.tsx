'use client'

import { BrandingProvider } from '@/lib/branding-context'
import { EventsProvider } from '@/lib/events-context'
import { EventNotifications } from '@/components/EventNotifications'
import { SoftphoneProvider } from '@/lib/softphone-context'
import { EmailComposeProvider } from '@/lib/email-compose-context'
import Softphone from '@/components/Softphone'
import EmailComposePopover from '@/components/EmailComposePopover'
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
        <SoftphoneProvider>
          <EmailComposeProvider>
            <EventNotifications />
            {children}
            <Softphone />
            <EmailComposePopover />
          </EmailComposeProvider>
        </SoftphoneProvider>
      </EventsProvider>
    </BrandingProvider>
  )
}
