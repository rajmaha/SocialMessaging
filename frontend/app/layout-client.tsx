'use client'

import { BrandingProvider } from '@/lib/branding-context'
import { EventsProvider } from '@/lib/events-context'
import { EventNotifications } from '@/components/EventNotifications'

export function LayoutClient({ children }: { children: React.ReactNode }) {
  return (
    <BrandingProvider>
      <EventsProvider>
        <EventNotifications />
        {children}
      </EventsProvider>
    </BrandingProvider>
  )
}
