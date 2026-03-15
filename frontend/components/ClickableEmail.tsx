'use client'

import { Mail } from 'lucide-react'
import { useEmailCompose } from '@/lib/email-compose-context'

interface ClickableEmailProps {
  email: string | null | undefined
  className?: string
  showIcon?: boolean
}

export default function ClickableEmail({ email, className = '', showIcon = true }: ClickableEmailProps) {
  const { openCompose } = useEmailCompose()

  if (!email) return <span className="text-gray-400">—</span>

  return (
    <button
      onClick={(e) => { e.stopPropagation(); openCompose(email) }}
      className={`inline-flex items-center gap-1 text-blue-600 hover:text-blue-800 hover:underline cursor-pointer transition-colors ${className}`}
      title={`Email ${email}`}
    >
      {showIcon && <Mail className="w-3 h-3" />}
      <span>{email}</span>
    </button>
  )
}
