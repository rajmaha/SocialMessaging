'use client'

import { useBranding } from '@/lib/branding-context'
import Link from 'next/link'

export function AppHeader() {
  const { branding } = useBranding()

  if (!branding) return null

  return (
    <div className="flex items-center gap-3">
      {branding.logo_url && (
        <img
          src={branding.logo_url}
          alt="Logo"
          className="h-10 object-contain"
        />
      )}
      <div className="flex flex-col">
        <Link href="/" className="font-bold text-lg hover:opacity-8 0">
          {branding.company_name}
        </Link>
        {branding.company_description && (
          <p className="text-xs text-gray-600">{branding.company_description}</p>
        )}
      </div>
    </div>
  )
}
