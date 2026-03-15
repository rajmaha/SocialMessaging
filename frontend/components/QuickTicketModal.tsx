'use client'

import { useState, useEffect } from 'react'
import axios from 'axios'
import { getAuthToken } from '@/lib/auth'
import { API_URL } from '@/lib/config'

interface QuickTicketModalProps {
  open: boolean
  onClose: () => void
  onCreated: () => void
  prefill?: {
    phone?: string
    email?: string
    contactName?: string
    conversationId?: number
    emailId?: number
  }
}

const CATEGORIES = ['General', 'Billing', 'Technical Support', 'Sales', 'Complaint', 'Other']
const PRIORITIES = ['low', 'normal', 'high', 'urgent']
const STATUSES = ['pending', 'solved', 'forwarded']

export default function QuickTicketModal({ open, onClose, onCreated, prefill = {} }: QuickTicketModalProps) {
  const [lookupValue, setLookupValue] = useState(prefill.phone || prefill.email || '')
  const [lookupType, setLookupType] = useState<'phone' | 'email'>(prefill.email && !prefill.phone ? 'email' : 'phone')
  const [context, setContext] = useState<any>(null)
  const [contextLoading, setContextLoading] = useState(false)

  const [form, setForm] = useState({
    category: '',
    priority: 'normal',
    status: 'pending',
    assigned_to: '',
    note: '',
  })
  const [agents, setAgents] = useState<{ id: number; full_name: string }[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  // Fetch agents list once when modal opens
  useEffect(() => {
    if (!open) return
    const token = getAuthToken()
    axios.get(`${API_URL}/conversations/agents`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => setAgents(r.data))
      .catch(() => {})
  }, [open])

  // Auto-lookup when modal opens with prefilled phone/email
  useEffect(() => {
    if (!open) return
    const val = prefill.phone || prefill.email || ''
    const type = prefill.email && !prefill.phone ? 'email' : 'phone'
    setLookupValue(val)
    setLookupType(type)
    setContext(null)
    setError('')
    setSuccess('')
    setForm({ category: '', priority: 'normal', status: 'pending', assigned_to: '', note: '' })
    if (val) doLookup(val, type)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, prefill.phone, prefill.email])

  async function doLookup(val: string, type: 'phone' | 'email') {
    if (!val.trim()) return
    setContextLoading(true)
    setContext(null)
    try {
      const token = getAuthToken()
      const url = type === 'email'
        ? `${API_URL}/api/tickets/context-by-email?email=${encodeURIComponent(val)}`
        : `${API_URL}/api/tickets/context/${encodeURIComponent(val)}`
      const r = await axios.get(url, { headers: { Authorization: `Bearer ${token}` } })
      setContext(r.data)
    } catch {
      setContext(null)
    } finally {
      setContextLoading(false)
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.category) { setError('Category is required'); return }
    setSubmitting(true)
    setError('')
    try {
      const token = getAuthToken()
      const source = prefill.conversationId ? 'messaging' : prefill.emailId ? 'email' : 'manual'
      // phone_number is NOT NULL in DB — use sentinel for email-only tickets
      const phone = lookupType === 'phone' ? lookupValue : (context?.phone_number || 'email-only')
      const customerEmail = lookupType === 'email' ? lookupValue : context?.email || undefined

      await axios.post(`${API_URL}/api/tickets`, {
        phone_number: phone,
        customer_name: prefill.contactName || context?.customer_name || context?.caller_name || '',
        customer_type: context?.customer_type || 'individual',
        customer_email: customerEmail,
        organization_id: context?.organization_id || undefined,
        category: form.category,
        priority: form.priority,
        status: form.status,
        assigned_to: form.assigned_to ? Number(form.assigned_to) : undefined,
        app_type_data: form.note ? { description: form.note } : undefined,
        conversation_id: prefill.conversationId || undefined,
        email_id: prefill.emailId || undefined,
        source,
      }, { headers: { Authorization: `Bearer ${token}` } })

      setSuccess('Ticket created successfully')
      setTimeout(() => {
        onCreated()
        onClose()
        setSuccess('')
      }, 1200)
    } catch (err: any) {
      setError(err?.response?.data?.detail || 'Failed to create ticket')
    } finally {
      setSubmitting(false)
    }
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b bg-indigo-50">
          <h2 className="text-lg font-bold text-indigo-800">Create Ticket</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl font-bold leading-none">&times;</button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {/* Lookup row */}
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1 uppercase tracking-wide">Customer Lookup</label>
            <div className="flex gap-2">
              <select
                value={lookupType}
                onChange={e => { setLookupType(e.target.value as 'phone' | 'email'); setContext(null) }}
                className="text-sm border border-gray-200 rounded-lg px-2 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-200"
              >
                <option value="phone">Phone</option>
                <option value="email">Email</option>
              </select>
              <input
                type={lookupType === 'email' ? 'email' : 'tel'}
                value={lookupValue}
                onChange={e => setLookupValue(e.target.value)}
                onBlur={() => doLookup(lookupValue, lookupType)}
                placeholder={lookupType === 'email' ? 'customer@example.com' : '+1234567890'}
                className="flex-1 text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-200"
                readOnly={!!(prefill.phone || prefill.email)}
              />
            </div>

            {/* Context result */}
            {contextLoading && <p className="text-xs text-gray-400 mt-1">Looking up customer…</p>}
            {context && (
              <div className="mt-2 px-3 py-2 bg-indigo-50 rounded-lg text-sm">
                {context.found ? (
                  <>
                    <span className="font-semibold text-indigo-700">{context.organization_name || context.customer_name}</span>
                    {context.contact_person && <span className="text-gray-500"> · {context.contact_person}</span>}
                    <span className="ml-2 text-xs text-green-600 font-medium">Matched</span>
                  </>
                ) : (
                  <span className="text-gray-400">No org match found — ticket will be unlinked</span>
                )}
              </div>
            )}
          </div>

          {/* Category */}
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1 uppercase tracking-wide">Category <span className="text-red-500">*</span></label>
            <select
              value={form.category}
              onChange={e => setForm(f => ({ ...f, category: e.target.value }))}
              className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-200"
              required
            >
              <option value="">Select category…</option>
              {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>

          {/* Priority & Status */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1 uppercase tracking-wide">Priority</label>
              <select
                value={form.priority}
                onChange={e => setForm(f => ({ ...f, priority: e.target.value }))}
                className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-200"
              >
                {PRIORITIES.map(p => <option key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1 uppercase tracking-wide">Status</label>
              <select
                value={form.status}
                onChange={e => setForm(f => ({ ...f, status: e.target.value }))}
                className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-200"
              >
                {STATUSES.map(s => <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>)}
              </select>
            </div>
          </div>

          {/* Assign to */}
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1 uppercase tracking-wide">Assign To</label>
            <select
              value={form.assigned_to}
              onChange={e => setForm(f => ({ ...f, assigned_to: e.target.value }))}
              className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-200"
            >
              <option value="">Self (default)</option>
              {agents.map(a => <option key={a.id} value={a.id}>{a.full_name}</option>)}
            </select>
          </div>

          {/* Note */}
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1 uppercase tracking-wide">Description / Note <span className="text-gray-400">(optional)</span></label>
            <textarea
              value={form.note}
              onChange={e => setForm(f => ({ ...f, note: e.target.value }))}
              rows={3}
              placeholder="Brief description of the issue…"
              className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-200 resize-none"
            />
          </div>

          {error && <p className="text-sm text-red-500">{error}</p>}
          {success && <p className="text-sm text-green-600 font-medium">{success}</p>}

          {/* Actions */}
          <div className="flex gap-3 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2 rounded-lg border border-gray-200 text-sm text-gray-600 hover:bg-gray-50 transition"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="flex-1 py-2 rounded-lg bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 transition disabled:opacity-50"
            >
              {submitting ? 'Creating…' : 'Create Ticket'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
