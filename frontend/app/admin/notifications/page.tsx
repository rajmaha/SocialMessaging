'use client'

import { useState, useEffect } from 'react'
import MainHeader from '@/components/MainHeader'
import AdminNav from '@/components/AdminNav'
import { authAPI } from '@/lib/auth'
import { API_URL } from '@/lib/config';

const API = API_URL

/* ─── Example CSV for download ──────────────────────────────────────────── */
const NOTIFICATION_CSV_EXAMPLE =
    'account_number,name,phone_no,message,schedule_datetime\n' +
    'ACC001,John Doe,0981234567,"Your payment of Rs 5000 is due tomorrow. Please contact us.",2026-03-01T09:00:00\n' +
    'ACC002,Jane Smith,0977654321,"Reminder: your appointment is scheduled for tomorrow at 10 AM.",2026-03-02T08:00:00\n'

function downloadCsv(content: string, filename: string) {
    const blob = new Blob([content], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
}

interface NotificationEntry {
    id: number
    account_number: string | null
    name: string
    phone_no: string
    message: string
    schedule_datetime: string | null
    schedule_status: string
    call_status: string
    retry_count: number
    next_retry_at: string | null
    created_at: string
}

const SCHEDULE_STATUS_COLORS: Record<string, string> = {
    enabled: 'bg-green-100 text-green-700',
    disabled: 'bg-gray-100 text-gray-500',
}
const CALL_STATUS_COLORS: Record<string, string> = {
    pending: 'bg-yellow-100 text-yellow-700',
    answered: 'bg-green-100 text-green-700',
    no_answer: 'bg-orange-100 text-orange-700',
    declined: 'bg-red-100 text-red-600',
    busy: 'bg-purple-100 text-purple-700',
    failed: 'bg-red-200 text-red-800',
}

function authHeader() {
    const token = localStorage.getItem('token') || ''
    return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
}

function toLocalDatetimeInput(iso: string) {
    if (!iso) return ''
    const d = new Date(iso)
    const pad = (n: number) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

const EMPTY_FORM = {
    account_number: '',
    name: '',
    phone_no: '',
    message: '',
    schedule_datetime: '',
    schedule_status: 'enabled',
}

export default function NotificationsPage() {
    const user = authAPI.getUser()

    const [entries, setEntries] = useState<NotificationEntry[]>([])
    const [showModal, setShowModal] = useState(false)
    const [editItem, setEditItem] = useState<NotificationEntry | null>(null)
    const [form, setForm] = useState({ ...EMPTY_FORM })
    const [loading, setLoading] = useState(true)
    const [saving, setSaving] = useState(false)
    const [error, setError] = useState('')
    const [triggeringId, setTriggeringId] = useState<number | null>(null)
    const [toast, setToast] = useState('')

    function showToast(msg: string) {
        setToast(msg)
        setTimeout(() => setToast(''), 3500)
    }

    // Filters
    const [filterCallStatus, setFilterCallStatus] = useState('')
    const [filterScheduleStatus, setFilterScheduleStatus] = useState('')
    const [filterPhone, setFilterPhone] = useState('')

    useEffect(() => { load() }, [filterCallStatus, filterScheduleStatus, filterPhone])

    async function load() {
        setLoading(true)
        const params = new URLSearchParams()
        if (filterCallStatus) params.set('call_status', filterCallStatus)
        if (filterScheduleStatus) params.set('schedule_status', filterScheduleStatus)
        if (filterPhone) params.set('phone', filterPhone)
        try {
            const res = await fetch(`${API}/admin/notifications/?${params}`, { headers: authHeader() })
            if (res.ok) setEntries(await res.json())
        } catch { }
        setLoading(false)
    }

    function openCreate() {
        setEditItem(null)
        setForm({ ...EMPTY_FORM })
        setShowModal(true)
        setError('')
    }

    function openEdit(e: NotificationEntry) {
        setEditItem(e)
        setForm({
            account_number: e.account_number || '',
            name: e.name,
            phone_no: e.phone_no,
            message: e.message,
            schedule_datetime: e.schedule_datetime ? toLocalDatetimeInput(e.schedule_datetime) : '',
            schedule_status: e.schedule_status,
        })
        setShowModal(true)
        setError('')
    }

    async function save() {
        if (!form.name || !form.phone_no || !form.message) return
        setSaving(true)
        setError('')
        const payload = {
            account_number: form.account_number || null,
            name: form.name,
            phone_no: form.phone_no,
            message: form.message,
            schedule_datetime: form.schedule_datetime ? new Date(form.schedule_datetime).toISOString() : null,
            schedule_status: form.schedule_status,
        }
        try {
            const url = editItem ? `${API}/admin/notifications/${editItem.id}` : `${API}/admin/notifications/`
            const method = editItem ? 'PUT' : 'POST'
            const res = await fetch(url, { method, headers: authHeader(), body: JSON.stringify(payload) })
            if (!res.ok) {
                const data = await res.json()
                setError(data.detail || 'Save failed')
            } else {
                setShowModal(false)
                load()
            }
        } catch (ex: any) { setError(ex.message) }
        setSaving(false)
    }

    async function deleteEntry(id: number) {
        if (!confirm('Delete this notification?')) return
        await fetch(`${API}/admin/notifications/${id}`, { method: 'DELETE', headers: authHeader() })
        load()
    }

    async function toggleEntry(id: number) {
        await fetch(`${API}/admin/notifications/${id}/toggle`, { method: 'PATCH', headers: authHeader() })
        load()
    }

    async function triggerEntry(id: number) {
        setTriggeringId(id)
        const res = await fetch(`${API}/admin/notifications/${id}/trigger`, { method: 'POST', headers: authHeader() })
        const data = await res.json()
        alert(data.message)
        setTriggeringId(null)
        load()
    }

    async function handleCsvImport(e: React.ChangeEvent<HTMLInputElement>) {
        const file = e.target.files?.[0]
        if (!file) return
        const fd = new FormData()
        fd.append('file', file)
        const res = await fetch(`${API}/admin/notifications/import-csv`, {
            method: 'POST',
            headers: { Authorization: authHeader().Authorization },
            body: fd,
        })
        const data = await res.json()
        const msg = `${data.message}${data.errors?.length ? '\n\nErrors:\n' + data.errors.join('\n') : ''}`
        showToast(data.message)
        if (data.errors?.length) alert(msg) // show details if there are row errors
        load()
        e.target.value = ''
    }

    return (
        <div className="ml-60 pt-14 min-h-screen bg-gray-50">
            <MainHeader user={user!} />
            <AdminNav />
            {/* Toast */}
            {toast && (
                <div className="fixed top-4 right-4 z-[100] bg-gray-900 text-white px-4 py-3 rounded-xl shadow-xl text-sm flex items-center gap-2">
                    ✅ {toast}
                </div>
            )}
            <div className="max-w-7xl mx-auto px-6 py-8">
                {/* Header */}
                <div className="flex items-center justify-between mb-6">
                    <div>
                        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
                            🔔 Notifications
                        </h1>
                        <p className="text-sm text-gray-500 mt-1">
                            Auto-call contacts and play a voice message (text-to-speech).
                            Up to 5 retry cycles (1 hour apart) for unanswered/declined calls.
                        </p>
                    </div>
                    <div className="flex gap-2">
                        <div className="flex items-center gap-1">
                            <label className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 cursor-pointer">
                                📥 Import CSV
                                <input type="file" accept=".csv" className="hidden" onChange={handleCsvImport} />
                            </label>
                            <button
                                onClick={() => downloadCsv(NOTIFICATION_CSV_EXAMPLE, 'notifications_example.csv')}
                                className="px-2 py-2 bg-white border border-gray-200 rounded-lg text-xs text-indigo-600 hover:bg-indigo-50"
                                title="Download example CSV format"
                            >
                                ↓ Example
                            </button>
                        </div>
                        <button
                            onClick={openCreate}
                            className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700"
                        >
                            + New Notification
                        </button>
                    </div>
                </div>

                {/* Filters */}
                <div className="bg-white rounded-xl border border-gray-200 p-4 mb-5 flex flex-wrap gap-3 items-center">
                    <select
                        className="px-3 py-2 border border-gray-200 rounded-lg text-sm"
                        value={filterCallStatus}
                        onChange={e => setFilterCallStatus(e.target.value)}
                    >
                        <option value="">All Call Statuses</option>
                        <option value="pending">Pending</option>
                        <option value="answered">Answered</option>
                        <option value="no_answer">No Answer</option>
                        <option value="declined">Declined</option>
                        <option value="busy">Busy</option>
                        <option value="failed">Failed</option>
                    </select>
                    <select
                        className="px-3 py-2 border border-gray-200 rounded-lg text-sm"
                        value={filterScheduleStatus}
                        onChange={e => setFilterScheduleStatus(e.target.value)}
                    >
                        <option value="">All Schedules</option>
                        <option value="enabled">Enabled</option>
                        <option value="disabled">Disabled</option>
                    </select>
                    <input
                        className="px-3 py-2 border border-gray-200 rounded-lg text-sm"
                        placeholder="Filter by phone…"
                        value={filterPhone}
                        onChange={e => setFilterPhone(e.target.value)}
                    />
                    {(filterCallStatus || filterScheduleStatus || filterPhone) && (
                        <button
                            onClick={() => { setFilterCallStatus(''); setFilterScheduleStatus(''); setFilterPhone('') }}
                            className="text-sm text-gray-400 hover:text-gray-600"
                        >✕ Clear</button>
                    )}
                    <span className="ml-auto text-xs text-gray-400">{entries.length} records</span>
                </div>

                {/* Table */}
                {loading ? (
                    <div className="text-center py-20 text-gray-400">Loading…</div>
                ) : entries.length === 0 ? (
                    <div className="text-center py-20 bg-white rounded-xl border border-dashed border-gray-300">
                        <div className="text-5xl mb-4">🔔</div>
                        <h2 className="text-lg font-semibold text-gray-700 mb-2">No notifications yet</h2>
                        <p className="text-gray-500 text-sm mb-5">Create a notification to auto-call someone with a voice message.</p>
                        <button onClick={openCreate} className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm">+ New Notification</button>
                    </div>
                ) : (
                    <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                        <div className="overflow-x-auto">
                            <table className="min-w-full divide-y divide-gray-100">
                                <thead className="bg-gray-50">
                                    <tr>
                                        <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wide px-4 py-3">Account #</th>
                                        <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wide px-4 py-3">Name</th>
                                        <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wide px-4 py-3">Phone</th>
                                        <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wide px-4 py-3">Message</th>
                                        <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wide px-4 py-3">Scheduled</th>
                                        <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wide px-4 py-3">Schedule</th>
                                        <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wide px-4 py-3">Call Status</th>
                                        <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wide px-4 py-3">Retries</th>
                                        <th className="text-right text-xs font-semibold text-gray-500 uppercase tracking-wide px-4 py-3">Actions</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-100">
                                    {entries.map(entry => (
                                        <tr key={entry.id} className="hover:bg-gray-50 transition-colors">
                                            <td className="px-4 py-3 text-sm text-gray-500 font-mono">{entry.account_number || '—'}</td>
                                            <td className="px-4 py-3 text-sm font-medium text-gray-900">{entry.name}</td>
                                            <td className="px-4 py-3 text-sm text-gray-600 font-mono">{entry.phone_no}</td>
                                            <td className="px-4 py-3 text-sm text-gray-600 max-w-xs">
                                                <span className="line-clamp-2" title={entry.message}>{entry.message}</span>
                                            </td>
                                            <td className="px-4 py-3 text-sm text-gray-500 whitespace-nowrap">
                                                {entry.schedule_datetime
                                                    ? new Date(entry.schedule_datetime).toLocaleString()
                                                    : '—'}
                                            </td>
                                            <td className="px-4 py-3">
                                                <button onClick={() => toggleEntry(entry.id)}>
                                                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium cursor-pointer ${SCHEDULE_STATUS_COLORS[entry.schedule_status] || ''}`}>
                                                        {entry.schedule_status}
                                                    </span>
                                                </button>
                                            </td>
                                            <td className="px-4 py-3">
                                                <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${CALL_STATUS_COLORS[entry.call_status] || 'bg-gray-100 text-gray-600'}`}>
                                                    {entry.call_status}
                                                </span>
                                            </td>
                                            <td className="px-4 py-3 text-sm text-center">
                                                {entry.retry_count > 0 && (
                                                    <span className="text-orange-500 font-medium">{entry.retry_count}/5</span>
                                                )}
                                                {entry.retry_count === 0 && <span className="text-gray-400">0/5</span>}
                                            </td>
                                            <td className="px-4 py-3">
                                                <div className="flex items-center justify-end gap-2">
                                                    <button
                                                        onClick={() => triggerEntry(entry.id)}
                                                        disabled={triggeringId === entry.id}
                                                        className="px-2 py-1 text-xs bg-green-600 text-white rounded-md hover:bg-green-700 disabled:opacity-50"
                                                    >
                                                        {triggeringId === entry.id ? '…' : '▶'}
                                                    </button>
                                                    <button
                                                        onClick={() => openEdit(entry)}
                                                        className="px-2 py-1 text-xs bg-gray-100 text-gray-700 rounded-md hover:bg-gray-200"
                                                    >
                                                        Edit
                                                    </button>
                                                    <button
                                                        onClick={() => deleteEntry(entry.id)}
                                                        className="px-2 py-1 text-xs bg-red-50 text-red-600 rounded-md hover:bg-red-100"
                                                    >
                                                        Del
                                                    </button>
                                                </div>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}
            </div>

            {/* Create / Edit Modal */}
            {showModal && (
                <div
                    className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
                    onClick={e => { if (e.target === e.currentTarget) setShowModal(false) }}
                >
                    <div className="bg-white rounded-2xl shadow-2xl w-full max-w-xl max-h-[90vh] overflow-y-auto">
                        <div className="px-6 py-5 border-b border-gray-100">
                            <h2 className="text-lg font-bold text-gray-900">
                                {editItem ? 'Edit Notification' : 'New Notification'}
                            </h2>
                        </div>
                        <div className="px-6 py-5 space-y-4">
                            {error && <div className="p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">{error}</div>}

                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">Account Number</label>
                                    <input
                                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                                        value={form.account_number}
                                        onChange={e => setForm(f => ({ ...f, account_number: e.target.value }))}
                                        placeholder="e.g. ACC001"
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">Name *</label>
                                    <input
                                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                                        value={form.name}
                                        onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                                        placeholder="Contact name"
                                    />
                                </div>
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Phone Number *</label>
                                <input
                                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500"
                                    value={form.phone_no}
                                    onChange={e => setForm(f => ({ ...f, phone_no: e.target.value }))}
                                    placeholder="0981234567"
                                />
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">
                                    Voice Message (TTS) *
                                </label>
                                <textarea
                                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                                    rows={4}
                                    value={form.message}
                                    onChange={e => setForm(f => ({ ...f, message: e.target.value }))}
                                    placeholder="This message will be converted to speech and played when the call is answered…"
                                />
                                <p className="text-xs text-gray-400 mt-1">💡 Converted to audio using text-to-speech (edge-tts / gTTS / pyttsx3)</p>
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Schedule Date & Time</label>
                                <input
                                    type="datetime-local"
                                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                                    value={form.schedule_datetime}
                                    onChange={e => setForm(f => ({ ...f, schedule_datetime: e.target.value }))}
                                />
                            </div>

                            <div className="flex items-center gap-3">
                                <button
                                    onClick={() => setForm(f => ({ ...f, schedule_status: f.schedule_status === 'enabled' ? 'disabled' : 'enabled' }))}
                                    className={`relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out ${form.schedule_status === 'enabled' ? 'bg-indigo-600' : 'bg-gray-300'}`}
                                >
                                    <span className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${form.schedule_status === 'enabled' ? 'translate-x-4' : 'translate-x-0'}`} />
                                </button>
                                <span className="text-sm text-gray-700">{form.schedule_status === 'enabled' ? 'Enabled' : 'Disabled'}</span>
                            </div>
                        </div>

                        <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-3">
                            <button onClick={() => setShowModal(false)} className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200">
                                Cancel
                            </button>
                            <button
                                onClick={save}
                                disabled={saving || !form.name || !form.phone_no || !form.message}
                                className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 disabled:opacity-50"
                            >
                                {saving ? 'Saving…' : editItem ? 'Update' : 'Create'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}
