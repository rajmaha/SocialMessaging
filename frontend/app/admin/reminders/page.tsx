'use client'

import { useState, useEffect, useRef } from 'react'
import MainHeader from '@/components/MainHeader'
import AdminNav from '@/components/AdminNav'
import { authAPI } from '@/lib/auth'
import { API_URL } from '@/lib/config';

const API = API_URL

/* ─── Types ──────────────────────────────────────────────────────────────── */
interface ReminderSchedule {
    id: number
    name: string
    schedule_datetime: string
    audio_file: string | null
    remarks: string | null
    phone_numbers: string[]
    is_enabled: boolean
    status: string
    created_at: string
}
interface CallLog {
    id: number
    schedule_id: number
    phone_number: string
    attempt: number
    call_status: string
    called_at: string | null
    next_retry_at: string | null
}
interface AudioFile {
    filename: string
    path: string
    size_bytes: number
}

/* ─── Constants ──────────────────────────────────────────────────────────── */
const STATUS_COLORS: Record<string, string> = {
    pending: 'bg-yellow-100 text-yellow-800',
    running: 'bg-blue-100 text-blue-800',
    completed: 'bg-green-100 text-green-800',
    disabled: 'bg-gray-100 text-gray-500',
    failed: 'bg-red-100 text-red-800',
}
const CALL_STATUS_COLORS: Record<string, string> = {
    pending: 'bg-yellow-100 text-yellow-700',
    answered: 'bg-green-100 text-green-700',
    no_answer: 'bg-orange-100 text-orange-700',
    declined: 'bg-red-100 text-red-700',
    busy: 'bg-purple-100 text-purple-700',
    failed: 'bg-red-200 text-red-800',
}

/* ─── Example CSV strings (for download) ────────────────────────────────── */
const PHONE_CSV_EXAMPLE =
    'phone_no\n0981234567\n0977654321\n0984001122\n'

const SCHEDULES_CSV_EXAMPLE =
    'name,schedule_datetime,phone_numbers,audio_file,remarks\n' +
    'March Reminder,2026-03-01T09:00:00,0981234567;0977654321,reminder.wav,Monthly call\n' +
    'April Reminder,2026-04-01T09:00:00,0984001122,,\n'

function downloadCsv(content: string, filename: string) {
    const blob = new Blob([content], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
}

/* ─── Helpers ────────────────────────────────────────────────────────────── */
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

/* ═══════════════════════════════════════════════════════════════════════════
   Main Page
═══════════════════════════════════════════════════════════════════════════ */
export default function RemindersPage() {
    const user = authAPI.getUser()

    const [schedules, setSchedules] = useState<ReminderSchedule[]>([])
    const [audioFiles, setAudioFiles] = useState<AudioFile[]>([])
    const [showModal, setShowModal] = useState(false)
    const [editItem, setEditItem] = useState<ReminderSchedule | null>(null)
    const [expandedLogs, setExpandedLogs] = useState<Record<number, CallLog[]>>({})
    const [loadingLogs, setLoadingLogs] = useState<Record<number, boolean>>({})
    const [triggeringId, setTriggeringId] = useState<number | null>(null)
    const [toast, setToast] = useState('')
    const [loading, setLoading] = useState(true)
    const [saving, setSaving] = useState(false)
    const [error, setError] = useState('')

    // Form state
    const [form, setForm] = useState({
        name: '',
        schedule_datetime: '',
        audio_file: '',
        remarks: '',
        phone_numbers_text: '',
        is_enabled: true,
    })
    const audioUploadRef = useRef<HTMLInputElement>(null)
    const bulkCsvRef = useRef<HTMLInputElement>(null)
    // Per-schedule phone CSV refs stored as a map via data-attribute trick
    const phoneFileRef = useRef<HTMLInputElement>(null)
    const [pendingPhoneScheduleId, setPendingPhoneScheduleId] = useState<number | null>(null)

    useEffect(() => { load() }, [])

    function showToast(msg: string) {
        setToast(msg)
        setTimeout(() => setToast(''), 3500)
    }

    /* ── Data ─────────────────────────────────────────────────────────────── */
    async function load() {
        setLoading(true)
        try {
            const [sr, ar] = await Promise.all([
                fetch(`${API}/admin/reminders/`, { headers: authHeader() }),
                fetch(`${API}/admin/reminders/audio-files`, { headers: authHeader() }),
            ])
            if (sr.ok) setSchedules(await sr.json())
            if (ar.ok) setAudioFiles(await ar.json())
        } catch { }
        setLoading(false)
    }

    /* ── CRUD ─────────────────────────────────────────────────────────────── */
    function openCreate() {
        setEditItem(null)
        setForm({ name: '', schedule_datetime: '', audio_file: '', remarks: '', phone_numbers_text: '', is_enabled: true })
        setError('')
        setShowModal(true)
    }
    function openEdit(s: ReminderSchedule) {
        setEditItem(s)
        setForm({
            name: s.name,
            schedule_datetime: toLocalDatetimeInput(s.schedule_datetime),
            audio_file: s.audio_file || '',
            remarks: s.remarks || '',
            phone_numbers_text: (s.phone_numbers || []).join('\n'),
            is_enabled: s.is_enabled,
        })
        setError('')
        setShowModal(true)
    }

    async function save() {
        if (!form.name || !form.schedule_datetime) return
        setSaving(true)
        setError('')
        const phones = form.phone_numbers_text.split(/[,;\n]+/).map(p => p.trim()).filter(Boolean)
        const payload = {
            name: form.name,
            schedule_datetime: new Date(form.schedule_datetime).toISOString(),
            audio_file: form.audio_file || null,
            remarks: form.remarks || null,
            phone_numbers: phones,
            is_enabled: form.is_enabled,
        }
        try {
            const url = editItem ? `${API}/admin/reminders/${editItem.id}` : `${API}/admin/reminders/`
            const method = editItem ? 'PUT' : 'POST'
            const res = await fetch(url, { method, headers: authHeader(), body: JSON.stringify(payload) })
            if (!res.ok) {
                const data = await res.json()
                setError(data.detail || 'Save failed')
            } else {
                setShowModal(false)
                showToast(editItem ? 'Schedule updated.' : 'Schedule created.')
                load()
            }
        } catch (e: any) { setError(e.message) }
        setSaving(false)
    }

    async function deleteSchedule(id: number) {
        if (!confirm('Delete this schedule and all its call logs?')) return
        await fetch(`${API}/admin/reminders/${id}`, { method: 'DELETE', headers: authHeader() })
        showToast('Schedule deleted.')
        load()
    }

    async function toggle(id: number) {
        await fetch(`${API}/admin/reminders/${id}/toggle`, { method: 'PATCH', headers: authHeader() })
        load()
    }

    async function trigger(id: number) {
        setTriggeringId(id)
        const res = await fetch(`${API}/admin/reminders/${id}/trigger`, { method: 'POST', headers: authHeader() })
        const data = await res.json()
        showToast(data.message)
        setTriggeringId(null)
        load()
    }

    /* ── Call Logs ────────────────────────────────────────────────────────── */
    async function loadLogs(id: number) {
        if (expandedLogs[id]) {
            setExpandedLogs(prev => { const n = { ...prev }; delete n[id]; return n })
            return
        }
        setLoadingLogs(prev => ({ ...prev, [id]: true }))
        const res = await fetch(`${API}/admin/reminders/${id}/logs`, { headers: authHeader() })
        if (res.ok) {
            const logs = await res.json()
            setExpandedLogs(prev => ({ ...prev, [id]: logs }))
        }
        setLoadingLogs(prev => ({ ...prev, [id]: false }))
    }

    /* ── File Uploads ─────────────────────────────────────────────────────── */
    async function uploadAudio(e: React.ChangeEvent<HTMLInputElement>) {
        const file = e.target.files?.[0]
        if (!file) return
        const fd = new FormData()
        fd.append('file', file)
        const res = await fetch(`${API}/admin/reminders/upload-audio`, {
            method: 'POST',
            headers: { Authorization: authHeader().Authorization },
            body: fd,
        })
        if (res.ok) {
            const data = await res.json()
            setForm(f => ({ ...f, audio_file: data.filename }))
            showToast(`Audio uploaded: ${data.filename}`)
            load()
        }
        e.target.value = ''
    }

    /**
     * Import phone numbers INTO a specific schedule from a CSV file.
     * The schedule ID comes from `pendingPhoneScheduleId` set when the user
     * clicks the "Import Phones" button on a schedule row.
     */
    async function importPhones(e: React.ChangeEvent<HTMLInputElement>) {
        const file = e.target.files?.[0]
        const scheduleId = pendingPhoneScheduleId
        if (!file || !scheduleId) return
        const fd = new FormData()
        fd.append('file', file)
        const res = await fetch(`${API}/admin/reminders/${scheduleId}/import-phones`, {
            method: 'POST',
            headers: { Authorization: authHeader().Authorization },
            body: fd,
        })
        const data = await res.json()
        showToast(data.message)
        setPendingPhoneScheduleId(null)
        load()
        e.target.value = ''
    }

    /**
     * Bulk-create schedules from a CSV file (one schedule per row).
     * Format: name, schedule_datetime, phone_numbers (semicolon-sep), audio_file, remarks
     */
    async function handleBulkImport(e: React.ChangeEvent<HTMLInputElement>) {
        const file = e.target.files?.[0]
        if (!file) return
        const fd = new FormData()
        fd.append('file', file)
        const res = await fetch(`${API}/admin/reminders/import-csv`, {
            method: 'POST',
            headers: { Authorization: authHeader().Authorization },
            body: fd,
        })
        const data = await res.json()
        showToast(data.message)
        load()
        e.target.value = ''
    }

    /* ─────────────────────────────────────────────────────────────────────── */
    return (
        <div className="ml-60 pt-14 min-h-screen bg-gray-50">
            <MainHeader user={user!} />
            <AdminNav />
            {/* Toast */}
            {toast && (
                <div className="fixed top-4 right-4 z-[100] bg-gray-900 text-white px-4 py-3 rounded-xl shadow-xl text-sm flex items-center gap-2 animate-fade-in">
                    ✅ {toast}
                </div>
            )}

            {/* Hidden shared file inputs */}
            {/* Phone CSV – triggered per-schedule */}
            <input
                ref={phoneFileRef}
                type="file"
                accept=".csv"
                className="hidden"
                onChange={importPhones}
            />
            {/* Bulk schedule CSV */}
            <input
                ref={bulkCsvRef}
                type="file"
                accept=".csv"
                className="hidden"
                onChange={handleBulkImport}
            />

            <div className="max-w-7xl mx-auto px-6 py-8">
                {/* ── Header ──────────────────────────────────────────────────────── */}
                <div className="flex items-start justify-between mb-8 gap-4">
                    <div>
                        <h1 className="text-2xl font-bold text-gray-900">📅 Reminder Calls</h1>
                        <p className="text-sm text-gray-500 mt-1 max-w-xl">
                            Schedule automated outbound calls that play an audio recording.
                            Unanswered / declined / busy calls are retried up to <strong>5 times</strong> (1 hour apart).
                        </p>
                    </div>

                    {/* Top-right actions */}
                    <div className="flex items-center gap-2 flex-shrink-0">
                        {/* Bulk schedule import */}
                        <div className="flex items-center gap-1">
                            <button
                                onClick={() => bulkCsvRef.current?.click()}
                                className="px-3 py-2 bg-white border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
                                title="Import multiple schedules at once from a CSV file"
                            >
                                📥 Import Schedules CSV
                            </button>
                            <button
                                onClick={() => downloadCsv(SCHEDULES_CSV_EXAMPLE, 'reminder_schedules_example.csv')}
                                className="px-2 py-2 bg-white border border-gray-200 rounded-lg text-xs text-indigo-600 hover:bg-indigo-50 transition-colors"
                                title="Download example CSV format"
                            >
                                ↓ Example
                            </button>
                        </div>

                        <button
                            onClick={openCreate}
                            className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-semibold hover:bg-indigo-700 transition-colors"
                        >
                            + New Schedule
                        </button>
                    </div>
                </div>

                {/* Info box explaining the two CSV types */}
                <div className="mb-6 bg-indigo-50 border border-indigo-100 rounded-xl p-4 text-sm text-indigo-800 flex gap-3">
                    <span className="text-xl flex-shrink-0">ℹ️</span>
                    <div>
                        <strong>Two types of CSV import:</strong>
                        <ul className="list-disc ml-5 mt-1 space-y-1 text-indigo-700">
                            <li>
                                <strong>Import Schedules CSV</strong> (top-right) — creates <em>new schedules</em> in bulk. Each row becomes one schedule.
                            </li>
                            <li>
                                <strong>Import Phones CSV</strong> (📋 button on each row) — adds phone numbers into <em>that specific schedule</em>. One phone number per row.
                            </li>
                        </ul>
                    </div>
                </div>

                {/* ── Content ─────────────────────────────────────────────────────── */}
                {loading ? (
                    <div className="text-center py-20 text-gray-400">Loading…</div>
                ) : schedules.length === 0 ? (
                    <div className="text-center py-20 bg-white rounded-xl border border-dashed border-gray-300">
                        <div className="text-5xl mb-4">📅</div>
                        <h2 className="text-lg font-semibold text-gray-700 mb-2">No reminder schedules yet</h2>
                        <p className="text-gray-500 text-sm mb-6">
                            Create a schedule to auto-call phone numbers and play your audio message.
                        </p>
                        <div className="flex items-center justify-center gap-3">
                            <button onClick={openCreate} className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700">
                                + New Schedule
                            </button>
                            <button
                                onClick={() => bulkCsvRef.current?.click()}
                                className="px-4 py-2 bg-white border border-gray-300 rounded-lg text-sm text-gray-700 hover:bg-gray-50"
                            >
                                📥 Import Schedules CSV
                            </button>
                        </div>
                    </div>
                ) : (
                    <div className="space-y-4">
                        {schedules.map(s => (
                            <div key={s.id} className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                                <div className="p-5">
                                    <div className="flex items-start gap-4">
                                        {/* Enable/Disable toggle */}
                                        <button
                                            onClick={() => toggle(s.id)}
                                            className={`mt-1 relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ${s.is_enabled ? 'bg-indigo-600' : 'bg-gray-300'}`}
                                            title={s.is_enabled ? 'Click to disable' : 'Click to enable'}
                                        >
                                            <span className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow transition duration-200 ${s.is_enabled ? 'translate-x-4' : 'translate-x-0'}`} />
                                        </button>

                                        {/* Info */}
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-3 flex-wrap">
                                                <h3 className="text-base font-semibold text-gray-900">{s.name}</h3>
                                                <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[s.status] || 'bg-gray-100 text-gray-600'}`}>
                                                    {s.status}
                                                </span>
                                                <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-indigo-50 text-indigo-700">
                                                    📞 {(s.phone_numbers || []).length} number{(s.phone_numbers || []).length !== 1 ? 's' : ''}
                                                </span>
                                            </div>
                                            <div className="flex items-center gap-4 mt-1 text-sm text-gray-500 flex-wrap">
                                                <span>🕐 {new Date(s.schedule_datetime).toLocaleString()}</span>
                                                {s.audio_file && <span>🔊 {s.audio_file}</span>}
                                                {s.remarks && <span>📝 {s.remarks}</span>}
                                            </div>
                                        </div>

                                        {/* Actions */}
                                        <div className="flex items-center gap-2 flex-shrink-0 flex-wrap justify-end">
                                            {/* Import phones into THIS schedule */}
                                            <button
                                                onClick={() => {
                                                    setPendingPhoneScheduleId(s.id)
                                                    // slight delay so state is set before file dialog opens
                                                    setTimeout(() => phoneFileRef.current?.click(), 50)
                                                }}
                                                className="px-3 py-1 text-xs bg-indigo-50 text-indigo-700 rounded-lg hover:bg-indigo-100 font-medium"
                                                title="Import phone numbers from CSV into this schedule"
                                            >
                                                📋 Import Phones
                                            </button>

                                            <button
                                                onClick={() => loadLogs(s.id)}
                                                className="px-3 py-1 text-xs bg-gray-100 text-gray-600 rounded-lg hover:bg-gray-200 font-medium"
                                            >
                                                {expandedLogs[s.id] ? '▲ Logs' : '▼ Logs'}
                                            </button>

                                            <button
                                                onClick={() => trigger(s.id)}
                                                disabled={triggeringId === s.id || !s.is_enabled}
                                                className="px-3 py-1 text-xs bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50"
                                                title={!s.is_enabled ? 'Enable the schedule first' : 'Trigger calls now'}
                                            >
                                                {triggeringId === s.id ? '…' : '▶ Trigger Now'}
                                            </button>

                                            <button
                                                onClick={() => openEdit(s)}
                                                className="px-3 py-1 text-xs bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200"
                                            >
                                                Edit
                                            </button>
                                            <button
                                                onClick={() => deleteSchedule(s.id)}
                                                className="px-3 py-1 text-xs bg-red-50 text-red-600 rounded-lg hover:bg-red-100"
                                            >
                                                Delete
                                            </button>
                                        </div>
                                    </div>
                                </div>

                                {/* ── Call Logs Panel ────────────────────────────────────── */}
                                {loadingLogs[s.id] && (
                                    <div className="border-t border-gray-100 bg-gray-50 px-5 py-3 text-xs text-gray-400">Loading logs…</div>
                                )}
                                {expandedLogs[s.id] && (
                                    <div className="border-t border-gray-100 bg-gray-50 px-5 py-4">
                                        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Call Logs</p>
                                        {expandedLogs[s.id].length === 0 ? (
                                            <p className="text-sm text-gray-400 italic">No call attempts yet.</p>
                                        ) : (
                                            <div className="overflow-x-auto">
                                                <table className="min-w-full text-xs">
                                                    <thead>
                                                        <tr className="text-gray-400 uppercase tracking-wide">
                                                            <th className="text-left pb-2 pr-4">Phone</th>
                                                            <th className="text-left pb-2 pr-4">Attempt</th>
                                                            <th className="text-left pb-2 pr-4">Status</th>
                                                            <th className="text-left pb-2 pr-4">Called At</th>
                                                            <th className="text-left pb-2">Next Retry</th>
                                                        </tr>
                                                    </thead>
                                                    <tbody>
                                                        {expandedLogs[s.id].map(log => (
                                                            <tr key={log.id} className="border-t border-gray-200">
                                                                <td className="py-2 pr-4 font-mono">{log.phone_number}</td>
                                                                <td className="py-2 pr-4">{log.attempt} / 5</td>
                                                                <td className="py-2 pr-4">
                                                                    <span className={`px-2 py-0.5 rounded-full font-medium ${CALL_STATUS_COLORS[log.call_status] || 'bg-gray-100 text-gray-600'}`}>
                                                                        {log.call_status}
                                                                    </span>
                                                                </td>
                                                                <td className="py-2 pr-4 text-gray-500">
                                                                    {log.called_at ? new Date(log.called_at).toLocaleString() : '—'}
                                                                </td>
                                                                <td className="py-2 text-gray-500">
                                                                    {log.next_retry_at ? new Date(log.next_retry_at).toLocaleString() : '—'}
                                                                </td>
                                                            </tr>
                                                        ))}
                                                    </tbody>
                                                </table>
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* ═══ Create / Edit Modal ════════════════════════════════════════════ */}
            {showModal && (
                <div
                    className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
                    onClick={e => { if (e.target === e.currentTarget) setShowModal(false) }}
                >
                    <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
                        <div className="px-6 py-5 border-b border-gray-100">
                            <h2 className="text-lg font-bold text-gray-900">
                                {editItem ? `Edit: ${editItem.name}` : 'New Reminder Schedule'}
                            </h2>
                        </div>

                        <div className="px-6 py-5 space-y-4">
                            {error && (
                                <div className="p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">{error}</div>
                            )}

                            {/* Name */}
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Schedule Name *</label>
                                <input
                                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                                    value={form.name}
                                    onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                                    placeholder="e.g. Monthly Payment Reminder"
                                />
                            </div>

                            {/* Datetime */}
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Schedule Date & Time *</label>
                                <input
                                    type="datetime-local"
                                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                                    value={form.schedule_datetime}
                                    onChange={e => setForm(f => ({ ...f, schedule_datetime: e.target.value }))}
                                />
                            </div>

                            {/* Audio File */}
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Audio File</label>
                                <div className="flex gap-2">
                                    <select
                                        className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                                        value={form.audio_file}
                                        onChange={e => setForm(f => ({ ...f, audio_file: e.target.value }))}
                                    >
                                        <option value="">— Select previously uploaded file —</option>
                                        {audioFiles.map(af => (
                                            <option key={af.filename} value={af.filename}>{af.filename}</option>
                                        ))}
                                    </select>
                                    <label
                                        className="px-3 py-2 bg-gray-100 border border-gray-300 rounded-lg text-sm cursor-pointer hover:bg-gray-200 flex items-center gap-1 whitespace-nowrap"
                                        title="Upload a new audio file"
                                    >
                                        ⬆ Upload New
                                        <input
                                            ref={audioUploadRef}
                                            type="file"
                                            accept=".wav,.mp3,.gsm,.ogg,.ulaw,.alaw"
                                            className="hidden"
                                            onChange={uploadAudio}
                                        />
                                    </label>
                                </div>
                                <p className="text-xs text-gray-400 mt-1">Supported: .wav .mp3 .gsm .ogg .ulaw .alaw</p>
                            </div>

                            {/* Phone Numbers */}
                            <div>
                                <div className="flex items-center justify-between mb-1">
                                    <label className="text-sm font-medium text-gray-700">
                                        Phone Numbers
                                        <span className="text-gray-400 font-normal"> (comma, semicolon or one per line)</span>
                                    </label>
                                </div>
                                <textarea
                                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500"
                                    rows={4}
                                    value={form.phone_numbers_text}
                                    onChange={e => setForm(f => ({ ...f, phone_numbers_text: e.target.value }))}
                                    placeholder={'0981234567\n0977654321\n0984001122'}
                                />

                                {/* Phone CSV import (only on existing schedule edit) */}
                                {editItem ? (
                                    <div className="mt-2 flex items-center gap-2">
                                        <span className="text-xs text-gray-500">Or import from CSV:</span>
                                        <button
                                            type="button"
                                            onClick={() => {
                                                setPendingPhoneScheduleId(editItem.id)
                                                setTimeout(() => phoneFileRef.current?.click(), 50)
                                            }}
                                            className="px-3 py-1 text-xs bg-indigo-50 text-indigo-700 rounded-lg hover:bg-indigo-100 font-medium"
                                        >
                                            📋 Import Phones CSV
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => downloadCsv(PHONE_CSV_EXAMPLE, 'phones_example.csv')}
                                            className="text-xs text-indigo-500 hover:underline"
                                        >
                                            ↓ Example CSV
                                        </button>
                                    </div>
                                ) : (
                                    <p className="text-xs text-gray-400 mt-1">
                                        💡 To import phones from a CSV file, save this schedule first then use the <strong>📋 Import Phones</strong> button on the schedule row.{' '}
                                        <button
                                            type="button"
                                            className="text-indigo-500 hover:underline"
                                            onClick={() => downloadCsv(PHONE_CSV_EXAMPLE, 'phones_example.csv')}
                                        >
                                            ↓ Download example phone CSV
                                        </button>
                                    </p>
                                )}
                            </div>

                            {/* Remarks */}
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Remarks</label>
                                <textarea
                                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                                    rows={2}
                                    value={form.remarks}
                                    onChange={e => setForm(f => ({ ...f, remarks: e.target.value }))}
                                    placeholder="Optional notes"
                                />
                            </div>

                            {/* Enable toggle */}
                            <div className="flex items-center gap-3">
                                <button
                                    type="button"
                                    onClick={() => setForm(f => ({ ...f, is_enabled: !f.is_enabled }))}
                                    className={`relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ${form.is_enabled ? 'bg-indigo-600' : 'bg-gray-300'}`}
                                >
                                    <span className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow transition duration-200 ${form.is_enabled ? 'translate-x-4' : 'translate-x-0'}`} />
                                </button>
                                <span className="text-sm text-gray-700">{form.is_enabled ? 'Enabled — will run at scheduled time' : 'Disabled — will not run'}</span>
                            </div>
                        </div>

                        <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-3">
                            <button
                                onClick={() => setShowModal(false)}
                                className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={save}
                                disabled={saving || !form.name || !form.schedule_datetime}
                                className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 disabled:opacity-50"
                            >
                                {saving ? 'Saving…' : editItem ? 'Update Schedule' : 'Create Schedule'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}
