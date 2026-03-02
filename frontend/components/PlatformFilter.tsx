'use client'

import { useEffect, useState } from 'react'
import { API_URL } from '@/lib/config';

const PLATFORM_META: Record<string, { name: string; color: string }> = {
  whatsapp: { name: 'WhatsApp', color: 'bg-green-500' },
  facebook: { name: 'Facebook', color: 'bg-blue-600' },
  viber:    { name: 'Viber',    color: 'bg-purple-600' },
  linkedin: { name: 'LinkedIn', color: 'bg-blue-700' },
  webchat:  { name: 'Web Chat', color: 'bg-teal-500' },
  email:    { name: 'Email',    color: 'bg-orange-500' },
}

interface PlatformFilterProps {
  selectedPlatform: string
  onPlatformChange: (platform: string) => void
}

export default function PlatformFilter({
  selectedPlatform,
  onPlatformChange,
}: PlatformFilterProps) {
  const [activePlatforms, setActivePlatforms] = useState<string[]>([])

  useEffect(() => {
    fetch(`${API_URL}/accounts/active-platforms`)
      .then((r) => r.json())
      .then((d) => setActivePlatforms(d.platforms || []))
      .catch(() => {})
  }, [])

  // Always show webchat (built-in), plus any configured platforms
  const platformIds = ['all', 'webchat', ...activePlatforms.filter((p) => p !== 'webchat')]

  return (
    <div className="p-4 border-b">
      <p className="text-xs text-gray-600 mb-3 font-semibold">FILTER BY PLATFORM</p>
      <div className="flex gap-2 flex-wrap">
        {platformIds.map((id) => {
          const meta = id === 'all'
            ? { name: 'All', color: 'bg-gray-500' }
            : (PLATFORM_META[id] || { name: id.charAt(0).toUpperCase() + id.slice(1), color: 'bg-gray-500' })
          return (
            <button
              key={id}
              onClick={() => onPlatformChange(id)}
              className={`px-3 py-1 rounded-full text-sm font-medium transition ${
                selectedPlatform === id
                  ? `${meta.color} text-white`
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              {meta.name}
            </button>
          )
        })}
      </div>
    </div>
  )
}

