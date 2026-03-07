'use client'

import { Phone } from 'lucide-react'
import { useSoftphone } from '@/lib/softphone-context'

interface ClickablePhoneProps {
  number: string | null | undefined
  className?: string
  showIcon?: boolean
}

export default function ClickablePhone({ number, className = '', showIcon = true }: ClickablePhoneProps) {
  const { dial } = useSoftphone()

  if (!number) return <span className="text-gray-400">—</span>

  return (
    <button
      onClick={(e) => { e.stopPropagation(); dial(number) }}
      className={`inline-flex items-center gap-1 text-indigo-600 hover:text-indigo-800 hover:underline cursor-pointer transition-colors ${className}`}
      title={`Call ${number}`}
    >
      {showIcon && <Phone className="w-3 h-3" />}
      <span>{number}</span>
    </button>
  )
}
