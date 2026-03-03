'use client'

import { useState, useRef, useEffect } from 'react'
import axios from 'axios'
import { getAuthToken, authAPI } from '@/lib/auth'
import { API_URL } from '@/lib/config'

interface Props {
  subject: string
  bodyHtml: string
}

export default function SendTestEmailPopover({ subject, bodyHtml }: Props) {
  const user = authAPI.getUser()
  const [open, setOpen] = useState(false)
  const [toEmail, setToEmail] = useState(user?.email || '')
  const [status, setStatus] = useState<'idle' | 'sending' | 'success' | 'error'>('idle')
  const [errorMsg, setErrorMsg] = useState('')
  const popoverRef = useRef<HTMLDivElement>(null)

  // Close on outside click
  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setOpen(false)
        setStatus('idle')
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  // Auto-close 3s after success
  useEffect(() => {
    if (status !== 'success') return
    const t = setTimeout(() => {
      setOpen(false)
      setStatus('idle')
    }, 3000)
    return () => clearTimeout(t)
  }, [status])

  const handleSend = async () => {
    if (!toEmail.trim()) return
    setStatus('sending')
    setErrorMsg('')
    try {
      await axios.post(
        `${API_URL}/campaigns/send-test`,
        { subject: subject || '(no subject)', body_html: bodyHtml, to_email: toEmail.trim() },
        { headers: { Authorization: `Bearer ${getAuthToken()}` } }
      )
      setStatus('success')
    } catch (err: any) {
      setErrorMsg(err.response?.data?.detail || 'Failed to send. Check SMTP settings.')
      setStatus('error')
    }
  }

  return (
    <div className="relative flex-shrink-0" ref={popoverRef}>
      <button
        type="button"
        onClick={() => { setOpen(o => !o); setStatus('idle') }}
        className="flex items-center gap-1.5 px-3 py-1.5 text-sm border border-gray-300 rounded-lg bg-white hover:bg-gray-50 text-gray-600 font-medium transition-colors"
      >
        📧 Test in Email
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-80 bg-white border border-gray-200 rounded-xl shadow-xl z-50 p-4">
          <p className="text-sm font-semibold text-gray-800 mb-3">Send Test Email</p>

          <label className="block text-xs font-medium text-gray-500 mb-1">Send to:</label>
          <input
            type="email"
            value={toEmail}
            onChange={e => setToEmail(e.target.value)}
            disabled={status === 'sending' || status === 'success'}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 mb-2 disabled:opacity-50"
            placeholder="you@example.com"
          />

          {subject && (
            <p className="text-xs text-gray-400 mb-3 truncate">
              Subject: <span className="font-medium text-gray-600">{subject}</span>
            </p>
          )}

          {status === 'error' && (
            <p className="text-xs text-red-600 mb-2">❌ {errorMsg}</p>
          )}
          {status === 'success' && (
            <p className="text-xs text-green-600 mb-2">✅ Sent! Check your inbox.</p>
          )}

          <div className="flex gap-2 mt-1">
            <button
              type="button"
              onClick={() => { setOpen(false); setStatus('idle') }}
              className="flex-1 px-3 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 text-gray-600"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSend}
              disabled={status === 'sending' || status === 'success' || !toEmail.trim()}
              className="flex-1 px-3 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 font-medium flex items-center justify-center gap-1.5"
            >
              {status === 'sending'
                ? <><span className="animate-spin inline-block w-3 h-3 border-2 border-white border-t-transparent rounded-full" /> Sending…</>
                : 'Send Test →'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
