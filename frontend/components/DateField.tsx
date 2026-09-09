'use client'

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Calendar, ChevronLeft, ChevronRight } from 'lucide-react'

interface DateFieldProps {
    value: string                       // ISO yyyy-mm-dd, or '' when unset
    onChange: (value: string) => void   // emits ISO yyyy-mm-dd, or '' when cleared
    disabled?: boolean
    required?: boolean
    className?: string
    placeholder?: string
    yearsBack?: number
    yearsForward?: number
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December']
const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']

const pad = (n: number) => String(n).padStart(2, '0')
const toISO = (y: number, m: number, d: number) => `${y}-${pad(m + 1)}-${pad(d)}`

/** Parse yyyy-mm-dd without going through Date(), which applies a timezone shift. */
const parseISO = (iso: string): { y: number, m: number, d: number } | null => {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '')
    if (!match) return null
    const y = parseInt(match[1], 10)
    const m = parseInt(match[2], 10) - 1
    const d = parseInt(match[3], 10)
    if (m < 0 || m > 11 || d < 1 || d > 31) return null
    return { y, m, d }
}

const displayValue = (iso: string) => {
    const parsed = parseISO(iso)
    return parsed ? `${pad(parsed.d)}/${pad(parsed.m + 1)}/${parsed.y}` : ''
}

/**
 * Date input with its own calendar popover.
 *
 * Replaces <input type="date">, whose native picker on Safari offers no way to
 * jump to another year. The month and year here are always plain dropdowns, so
 * the control behaves identically across browsers.
 */
export default function DateField({
    value,
    onChange,
    disabled = false,
    required = false,
    className = '',
    placeholder = 'dd/mm/yyyy',
    yearsBack = 60,
    yearsForward = 30,
}: DateFieldProps) {
    const [open, setOpen] = useState(false)
    const [mounted, setMounted] = useState(false)
    const [coords, setCoords] = useState({ top: 0, left: 0, width: 0 })
    const wrapRef = useRef<HTMLDivElement>(null)
    const popRef = useRef<HTMLDivElement>(null)

    const today = new Date()
    const selected = parseISO(value)
    const [viewYear, setViewYear] = useState(selected?.y ?? today.getFullYear())
    const [viewMonth, setViewMonth] = useState(selected?.m ?? today.getMonth())

    useEffect(() => setMounted(true), [])

    // Follow the selected value when it changes from outside (e.g. opening the form).
    useEffect(() => {
        const parsed = parseISO(value)
        if (parsed) {
            setViewYear(parsed.y)
            setViewMonth(parsed.m)
        }
    }, [value])

    const place = () => {
        const rect = wrapRef.current?.getBoundingClientRect()
        if (!rect) return
        const popHeight = 330
        const openUp = rect.bottom + popHeight > window.innerHeight && rect.top > popHeight
        setCoords({
            top: openUp ? rect.top - popHeight - 4 : rect.bottom + 4,
            left: Math.min(rect.left, Math.max(8, window.innerWidth - 300)),
            width: rect.width,
        })
    }

    useLayoutEffect(() => {
        if (!open) return
        place()
        const onScrollOrResize = () => place()
        window.addEventListener('scroll', onScrollOrResize, true)
        window.addEventListener('resize', onScrollOrResize)
        return () => {
            window.removeEventListener('scroll', onScrollOrResize, true)
            window.removeEventListener('resize', onScrollOrResize)
        }
    }, [open])

    useEffect(() => {
        if (!open) return
        const onPointerDown = (e: MouseEvent) => {
            const target = e.target as Node
            if (wrapRef.current?.contains(target) || popRef.current?.contains(target)) return
            setOpen(false)
        }
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
        document.addEventListener('mousedown', onPointerDown)
        document.addEventListener('keydown', onKey)
        return () => {
            document.removeEventListener('mousedown', onPointerDown)
            document.removeEventListener('keydown', onKey)
        }
    }, [open])

    const currentYear = today.getFullYear()
    const firstYear = Math.min(currentYear - yearsBack, selected?.y ?? currentYear)
    const lastYear = Math.max(currentYear + yearsForward, selected?.y ?? currentYear)
    const years: number[] = []
    for (let y = firstYear; y <= lastYear; y++) years.push(y)

    const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate()
    const leadingBlanks = new Date(viewYear, viewMonth, 1).getDay()

    const shiftMonth = (delta: number) => {
        const next = new Date(viewYear, viewMonth + delta, 1)
        setViewYear(next.getFullYear())
        setViewMonth(next.getMonth())
    }

    const pick = (day: number) => {
        onChange(toISO(viewYear, viewMonth, day))
        setOpen(false)
    }

    const isSelected = (day: number) =>
        !!selected && selected.y === viewYear && selected.m === viewMonth && selected.d === day
    const isToday = (day: number) =>
        today.getFullYear() === viewYear && today.getMonth() === viewMonth && today.getDate() === day

    return (
        <div ref={wrapRef} className="relative">
            <div className="relative">
                <input
                    type="text"
                    inputMode="none"
                    required={required}
                    disabled={disabled}
                    className={`${className} pr-10`}
                    placeholder={placeholder}
                    value={displayValue(value)}
                    onClick={() => !disabled && setOpen(true)}
                    onFocus={() => !disabled && setOpen(true)}
                    // Typing is handled by the calendar, but the field stays writable
                    // (not readOnly) so `required` still takes part in form validation.
                    onChange={() => { }}
                    onKeyDown={(e) => {
                        if (e.key === 'Tab') return
                        e.preventDefault()
                        if (e.key === 'Backspace' || e.key === 'Delete') onChange('')
                        else if (e.key === 'Enter' || e.key === ' ') setOpen(true)
                    }}
                />
                <button
                    type="button"
                    tabIndex={-1}
                    disabled={disabled}
                    onClick={() => setOpen(o => !o)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 disabled:text-gray-300"
                >
                    <Calendar className="w-4 h-4" />
                </button>
            </div>

            {mounted && open && !disabled && createPortal(
                <div
                    ref={popRef}
                    style={{ top: coords.top, left: coords.left, width: Math.max(coords.width, 280) }}
                    className="fixed z-[80] bg-white rounded-xl border border-gray-200 shadow-2xl p-3 w-72"
                >
                    <div className="flex items-center gap-2 mb-2">
                        <button
                            type="button"
                            onClick={() => shiftMonth(-1)}
                            className="p-1 rounded-lg text-gray-500 hover:bg-gray-100"
                        >
                            <ChevronLeft className="w-4 h-4" />
                        </button>
                        <select
                            value={viewMonth}
                            onChange={(e) => setViewMonth(parseInt(e.target.value, 10))}
                            className="flex-1 px-2 py-1 text-sm border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-indigo-500"
                        >
                            {MONTHS.map((m, i) => <option key={m} value={i}>{m}</option>)}
                        </select>
                        <select
                            value={viewYear}
                            onChange={(e) => setViewYear(parseInt(e.target.value, 10))}
                            className="px-2 py-1 text-sm border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-indigo-500"
                        >
                            {years.map(y => <option key={y} value={y}>{y}</option>)}
                        </select>
                        <button
                            type="button"
                            onClick={() => shiftMonth(1)}
                            className="p-1 rounded-lg text-gray-500 hover:bg-gray-100"
                        >
                            <ChevronRight className="w-4 h-4" />
                        </button>
                    </div>

                    <div className="grid grid-cols-7 gap-0.5 mb-1">
                        {WEEKDAYS.map(d => (
                            <div key={d} className="text-[10px] font-bold text-gray-400 text-center py-1">{d}</div>
                        ))}
                    </div>
                    <div className="grid grid-cols-7 gap-0.5">
                        {Array.from({ length: leadingBlanks }).map((_, i) => <div key={`b${i}`} />)}
                        {Array.from({ length: daysInMonth }).map((_, i) => {
                            const day = i + 1
                            return (
                                <button
                                    key={day}
                                    type="button"
                                    onClick={() => pick(day)}
                                    className={`h-8 text-sm rounded-lg transition-colors ${isSelected(day)
                                        ? 'bg-indigo-600 text-white font-semibold'
                                        : isToday(day)
                                            ? 'bg-indigo-50 text-indigo-700 font-semibold hover:bg-indigo-100'
                                            : 'text-gray-700 hover:bg-gray-100'
                                        }`}
                                >
                                    {day}
                                </button>
                            )
                        })}
                    </div>

                    <div className="flex justify-between items-center mt-2 pt-2 border-t border-gray-100">
                        <button
                            type="button"
                            onClick={() => { onChange(''); setOpen(false) }}
                            className="text-xs text-gray-500 hover:text-gray-700 px-2 py-1"
                        >
                            Clear
                        </button>
                        <button
                            type="button"
                            onClick={() => {
                                onChange(toISO(today.getFullYear(), today.getMonth(), today.getDate()))
                                setOpen(false)
                            }}
                            className="text-xs font-medium text-indigo-600 hover:text-indigo-700 px-2 py-1"
                        >
                            Today
                        </button>
                    </div>
                </div>,
                document.body
            )}
        </div>
    )
}
