'use client'

import { useState, useRef, useEffect, KeyboardEvent } from 'react'
import { api } from '@/lib/api'

type ChipStatus = 'pending' | 'valid' | 'risky' | 'invalid' | 'unchecked'

interface Chip {
  email: string
  status: ChipStatus
  riskScore?: number
  reason?: string
}

interface Props {
  label: string
  value: string        // comma-separated string for form compat
  onChange: (val: string) => void
  placeholder?: string
}

async function validateEmail(email: string): Promise<{ status: ChipStatus; riskScore?: number; reason?: string }> {
  try {
    const res = await api.post('/email-validator/validate', { email })
    const data = res.data
    if (data.unchecked) return { status: 'unchecked' }
    const riskScore: number = data.risk_score ?? 0
    if (data.is_valid === false) {
      return { status: 'invalid', riskScore, reason: data.reason ?? 'Invalid address' }
    }
    // is_valid=true but elevated risk score — treat as risky (UI indicator only; pass/fail decided by backend)
    if (riskScore > 0 && riskScore >= 50) {
      return { status: 'risky', riskScore }
    }
    return { status: 'valid', riskScore }
  } catch {
    return { status: 'unchecked' }
  }
}

const STATUS_STYLES: Record<ChipStatus, string> = {
  pending:   'border-gray-300 bg-gray-50 text-gray-700',
  valid:     'border-green-400 bg-green-50 text-green-800',
  risky:     'border-yellow-400 bg-yellow-50 text-yellow-800',
  invalid:   'border-red-400 bg-red-50 text-red-800',
  unchecked: 'border-gray-300 bg-white text-gray-700',
}

const STATUS_ICON: Record<ChipStatus, string> = {
  pending:   '⏳',
  valid:     '✅',
  risky:     '⚠️',
  invalid:   '❌',
  unchecked: '',
}

export default function EmailAddressInput({ label, value, onChange, placeholder }: Props) {
  const [chips, setChips] = useState<Chip[]>(() =>
    value
      ? value.split(',').map(e => e.trim()).filter(Boolean).map(email => ({ email, status: 'unchecked' as ChipStatus }))
      : []
  )
  const [inputVal, setInputVal] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const onChangeRef = useRef(onChange)
  useEffect(() => { onChangeRef.current = onChange })

  useEffect(() => {
    onChangeRef.current(chips.map(c => c.email).join(', '))
  }, [chips])

  // Sync chips when value is externally cleared (e.g. compose reset)
  const prevValueRef = useRef(value)
  useEffect(() => {
    if (value === '' && prevValueRef.current !== '') {
      setChips([])
    }
    prevValueRef.current = value
  }, [value])

  const addChip = async (raw: string) => {
    const email = raw.trim().toLowerCase()
    if (!email || chips.some(c => c.email === email)) return
    const chip: Chip = { email, status: 'pending' }
    setChips(prev => [...prev, chip])

    const result = await validateEmail(email)
    setChips(prev =>
      prev.map(c => c.email === email ? { ...c, ...result } : c)
    )
  }

  const removeChip = (email: string) => {
    setChips(prev => prev.filter(c => c.email !== email))
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (['Enter', 'Tab', ','].includes(e.key)) {
      e.preventDefault()
      if (inputVal.trim()) {
        addChip(inputVal)
        setInputVal('')
      }
    } else if (e.key === 'Backspace' && !inputVal && chips.length > 0) {
      removeChip(chips[chips.length - 1].email)
    }
  }

  const handleBlur = () => {
    if (inputVal.trim()) {
      addChip(inputVal)
      setInputVal('')
    }
  }

  return (
    <div>
      <label className="block text-xs font-medium text-gray-500 mb-1">{label}</label>
      <div
        className="flex flex-wrap gap-1 min-h-[36px] px-2 py-1 border border-gray-300 rounded-lg bg-white cursor-text focus-within:ring-2 focus-within:ring-blue-500"
        onClick={() => inputRef.current?.focus()}
      >
        {chips.map(chip => (
          <span
            key={chip.email}
            title={
              chip.status === 'risky'
                ? `Risk score: ${chip.riskScore}`
                : chip.status === 'invalid'
                ? chip.reason ?? 'Invalid address'
                : undefined
            }
            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs border ${STATUS_STYLES[chip.status]}`}
          >
            {STATUS_ICON[chip.status] && (
              <span className="text-xs">{STATUS_ICON[chip.status]}</span>
            )}
            {chip.email}
            <button
              type="button"
              aria-label={`Remove ${chip.email}`}
              onClick={e => { e.stopPropagation(); removeChip(chip.email) }}
              className="ml-1 text-gray-400 hover:text-gray-600 leading-none"
            >
              ×
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          type="text"
          value={inputVal}
          onChange={e => setInputVal(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={handleBlur}
          placeholder={chips.length === 0 ? placeholder : ''}
          className="flex-1 min-w-[120px] outline-none text-sm bg-transparent py-0.5"
        />
      </div>
    </div>
  )
}
