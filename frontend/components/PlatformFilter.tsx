'use client'

import { useEffect, useState } from 'react'
import { API_URL } from '@/lib/config';
import { getPlatformBadgeColor, getPlatformName } from '@/lib/platform-colors'

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

  // Always show webchat (built-in), plus any configured platforms (exclude email — it has its own tab)
  const platformIds = ['all', 'webchat', ...activePlatforms.filter((p) => p !== 'webchat' && p !== 'email')]

  return (
    <div className="p-4 border-b">
      <p className="text-xs text-gray-600 mb-3 font-semibold">FILTER BY PLATFORM</p>
      <div className="flex gap-2 flex-wrap">
        {platformIds.map((id) => {
          const color = id === 'all' ? 'bg-gray-500' : getPlatformBadgeColor(id)
          const name = id === 'all' ? 'All' : getPlatformName(id)
          return (
            <button
              key={id}
              onClick={() => onPlatformChange(id)}
              className={`px-3 py-1 rounded-full text-sm font-medium transition ${
                selectedPlatform === id
                  ? `${color} text-white`
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              {name}
            </button>
          )
        })}
      </div>
    </div>
  )
}

