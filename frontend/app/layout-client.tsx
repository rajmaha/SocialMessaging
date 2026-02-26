'use client'

import { BrandingProvider } from '@/lib/branding-context'
import { EventsProvider } from '@/lib/events-context'
import { EventNotifications } from '@/components/EventNotifications'
import Softphone from '@/components/Softphone'

export function LayoutClient({ children }: { children: React.ReactNode }) {
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
