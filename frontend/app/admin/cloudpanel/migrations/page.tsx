'use client'

import React, { useState, useEffect } from 'react'
import MainHeader from '@/components/MainHeader'
import AdminNav from '@/components/AdminNav'
import { authAPI, getAuthToken } from '@/lib/auth'

interface Migration {
    id: number
    filename: string
    description: string | null
    domain_suffix: string | null
    uploaded_by: number | null
    created_at: string
}

interface MigrationLog {
    id: number
    migration_id: number
    site_id: number
    server_id: number
    status: string
    error_message: string | null
    executed_at: string
    domain_name: string | null
    server_name: string | null
}

interface Server {
    id: number
    name: string
    host: string
}

interface Schedule {
    id: number
    server_id: number
    schedule_type: string
    run_at: string | null
    day_of_week: number | null
    time_of_day: string | null
    notify_emails: string | null
    notify_hours_before: number
    status: string
    enabled: boolean
    last_run_at: string | null
    server_name: string | null
}

interface RunResult {
    server_id: number
    total_sites: number
    skipped: number
    success: number
    failed: number
    details: { site: string; migration: string; status: string; error?: string }[]
}

import { API_URL as API } from '@/lib/config'

function authHeaders(): Record<string, string> {
    const token = getAuthToken() || ''
    return { Authorization: `Bearer ${token}` }
}


export default function MigrationsPage() {
    const [user, setUser] = useState<any>(null)
    const [migrations, setMigrations] = useState<Migration[]>([])
    const [servers, setServers] = useState<Server[]>([])
    const [schedules, setSchedules] = useState<Schedule[]>([])
    const [loading, setLoading] = useState(true)
    const [message, setMessage] = useState({ type: '', text: '' })

    // Upload form
    const [uploadFile, setUploadFile] = useState<File | null>(null)
    const [uploadDesc, setUploadDesc] = useState('')
    const [uploadSuffix, setUploadSuffix] = useState('')
    const [uploading, setUploading] = useState(false)

    // Logs drawer
    const [logsDrawer, setLogsDrawer] = useState<{ open: boolean; migration: Migration | null; logs: MigrationLog[] }>({
        open: false, migration: null, logs: []
    })

    // Run result modal
    const [runResult, setRunResult] = useState<RunResult | null>(null)
    const [running, setRunning] = useState<number | null>(null)
    const [notifying, setNotifying] = useState<number | null>(null)

    useEffect(() => {
        setUser(authAPI.getUser())
        loadAll()
    }, [])

    async function loadAll() {
        setLoading(true)
        try {
            const [mRes, sRes, schRes] = await Promise.all([
                fetch(`${API}/cloudpanel/migrations`, { headers: authHeaders() }),
                fetch(`${API}/cloudpanel/servers`, { headers: authHeaders() }),
                fetch(`${API}/cloudpanel/migrations/schedules`, { headers: authHeaders() }),
            ])
            if (mRes.ok) setMigrations(await mRes.json())
            if (sRes.ok) setServers(await sRes.json())
            if (schRes.ok) setSchedules(await schRes.json())
        } catch (e) {
            showMsg('error', 'Failed to load data')
        }
        setLoading(false)
    }

    function showMsg(type: string, text: string) {
        setMessage({ type, text })
        setTimeout(() => setMessage({ type: '', text: '' }), 4000)
    }

    // ── Upload ──────────────────────────────────────────────────────────────

    async function handleUpload(e: React.FormEvent) {
        e.preventDefault()
        if (!uploadFile) return
        setUploading(true)
        const fd = new FormData()
        fd.append('file', uploadFile)
        if (uploadDesc) fd.append('description', uploadDesc)
        if (uploadSuffix.trim()) fd.append('domain_suffix', uploadSuffix.trim())
        const res = await fetch(`${API}/cloudpanel/migrations/upload`, {
            method: 'POST',
            headers: authHeaders(),
            body: fd,
        })
        if (res.ok) {
            showMsg('success', 'Migration uploaded successfully')
            setUploadFile(null)
            setUploadDesc('')
            setUploadSuffix('')
            loadAll()
        } else {
            const err = await res.json()
            showMsg('error', err.detail || 'Upload failed')
        }
        setUploading(false)
    }

    // ── Delete ──────────────────────────────────────────────────────────────

    async function handleDelete(migration: Migration) {
        if (!confirm(`Delete migration "${migration.filename}"? This cannot be undone.`)) return
        const res = await fetch(`${API}/cloudpanel/migrations/${migration.id}`, {
            method: 'DELETE',
            headers: authHeaders(),
        })
        if (res.ok) {
            showMsg('success', 'Migration deleted')
            loadAll()
        } else {
            const err = await res.json()
            showMsg('error', err.detail || 'Delete failed')
        }
    }

    // ── Logs ────────────────────────────────────────────────────────────────

    async function openLogs(migration: Migration) {
        const res = await fetch(`${API}/cloudpanel/migrations/${migration.id}/logs`, {
            headers: authHeaders(),
        })
        const logs = res.ok ? await res.json() : []
        setLogsDrawer({ open: true, migration, logs })
    }

    // ── Run ─────────────────────────────────────────────────────────────────

    async function handleRun(server_id: number) {
        setRunning(server_id)
        const res = await fetch(`${API}/cloudpanel/migrations/run/${server_id}`, {
            method: 'POST',
            headers: authHeaders(),
        })
        if (res.ok) {
            setRunResult(await res.json())
            loadAll()
        } else {
            const err = await res.json()
            showMsg('error', err.detail || 'Run failed')
        }
        setRunning(null)
    }

    // ── Schedules ────────────────────────────────────────────────────────────

    async function saveSchedule(server_id: number, payload: Partial<Schedule>) {
        const res = await fetch(`${API}/cloudpanel/migrations/schedules/${server_id}`, {
            method: 'POST',
            headers: { ...authHeaders(), 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        })
        if (res.ok) {
            showMsg('success', 'Schedule saved')
            loadAll()
        } else {
            showMsg('error', 'Failed to save schedule')
        }
    }

    async function handleNotify(server_id: number) {
        setNotifying(server_id)
        const res = await fetch(`${API}/cloudpanel/migrations/schedules/${server_id}/notify`, {
            method: 'POST',
            headers: authHeaders(),
        })
        if (res.ok) {
            const data = await res.json()
            showMsg('success', `Notification sent to: ${data.sent_to.join(', ')}`)
        } else {
            const err = await res.json()
            showMsg('error', err.detail || 'Notify failed')
        }
        setNotifying(null)
    }

    const statusColor = (status: string) => {
        if (status === 'success') return 'text-green-400'
        if (status === 'failed') return 'text-red-400'
        if (status === 'running') return 'text-yellow-400'
        return 'text-gray-400'
    }

    return (
        <div className="min-h-screen" style={{ backgroundColor: 'var(--primary-color)' }}>
            <MainHeader user={user} />
            <div className="flex" style={{ paddingTop: 56 }}>
                <AdminNav />
                <main className="flex-1 p-6 overflow-auto" style={{ marginLeft: 240 }}>
                    <h1 className="text-2xl font-bold text-white mb-6">DB Migrations</h1>

                    {message.text && (
                        <div className={`mb-4 p-3 rounded text-sm ${message.type === 'success' ? 'bg-green-900 text-green-200' : 'bg-red-900 text-red-200'}`}>
                            {message.text}
                        </div>
                    )}

                    {/* ── Upload Panel ── */}
                    <div className="bg-gray-800 rounded-lg p-5 mb-6">
                        <h2 className="text-lg font-semibold text-white mb-4">Upload Migration</h2>
                        <form onSubmit={handleUpload} className="flex flex-wrap gap-3 items-end">
                            <div>
                                <label className="block text-xs text-gray-400 mb-1">SQL File *</label>
                                <input
                                    type="file"
                                    accept=".sql"
                                    onChange={e => setUploadFile(e.target.files?.[0] || null)}
                                    className="text-sm text-gray-300"
                                    required
                                />
                            </div>
                            <div>
                                <label className="block text-xs text-gray-400 mb-1">Description</label>
                                <input
                                    type="text"
                                    value={uploadDesc}
                                    onChange={e => setUploadDesc(e.target.value)}
                                    placeholder="Optional note"
                                    className="bg-gray-700 text-white text-sm rounded px-3 py-2 w-48"
                                />
                            </div>
                            <div>
                                <label className="block text-xs text-gray-400 mb-1">Domain Suffix</label>
                                <input
                                    type="text"
                                    value={uploadSuffix}
                                    onChange={e => setUploadSuffix(e.target.value)}
                                    placeholder="e.g. abc.com (blank = all)"
                                    className="bg-gray-700 text-white text-sm rounded px-3 py-2 w-52"
                                />
                            </div>
                            <button
                                type="submit"
                                disabled={uploading || !uploadFile}
                                className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm px-4 py-2 rounded"
                            >
                                {uploading ? 'Uploading…' : 'Upload'}
                            </button>
                        </form>
                    </div>

                    {/* ── Migrations Table ── */}
                    <div className="bg-gray-800 rounded-lg p-5 mb-6">
                        <h2 className="text-lg font-semibold text-white mb-4">Migrations</h2>
                        {loading ? (
                            <p className="text-gray-400 text-sm">Loading…</p>
                        ) : migrations.length === 0 ? (
                            <p className="text-gray-400 text-sm">No migrations uploaded yet.</p>
                        ) : (
                            <div className="overflow-x-auto"><table className="w-full text-sm text-left">
                                <thead>
                                    <tr className="text-gray-400 border-b border-gray-700">
                                        <th className="py-2 pr-4">Filename</th>
                                        <th className="py-2 pr-4">Description</th>
                                        <th className="py-2 pr-4">Domain Suffix</th>
                                        <th className="py-2 pr-4">Uploaded</th>
                                        <th className="py-2">Actions</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {migrations.map(m => (
                                        <tr key={m.id} className="border-b border-gray-700 text-gray-300">
                                            <td className="py-2 pr-4 font-mono">{m.filename}</td>
                                            <td className="py-2 pr-4">{m.description || <span className="text-gray-600">—</span>}</td>
                                            <td className="py-2 pr-4">
                                                {m.domain_suffix
                                                    ? <span className="bg-blue-900 text-blue-300 px-2 py-0.5 rounded text-xs">{m.domain_suffix}</span>
                                                    : <span className="text-gray-500 text-xs">all sites</span>}
                                            </td>
                                            <td className="py-2 pr-4 text-gray-400 text-xs">
                                                {new Date(m.created_at).toLocaleDateString()}
                                            </td>
                                            <td className="py-2 flex gap-2 flex-wrap">
                                                <button
                                                    onClick={() => openLogs(m)}
                                                    className="bg-gray-700 hover:bg-gray-600 text-white text-xs px-3 py-1 rounded"
                                                >
                                                    Logs
                                                </button>
                                                {servers.map(srv => (
                                                    <button
                                                        key={srv.id}
                                                        onClick={() => handleRun(srv.id)}
                                                        disabled={running === srv.id}
                                                        className="bg-green-700 hover:bg-green-600 disabled:opacity-50 text-white text-xs px-3 py-1 rounded"
                                                    >
                                                        {running === srv.id ? '…' : `Run on ${srv.name}`}
                                                    </button>
                                                ))}
                                                <button
                                                    onClick={() => handleDelete(m)}
                                                    className="bg-red-800 hover:bg-red-700 text-white text-xs px-3 py-1 rounded"
                                                >
                                                    Delete
                                                </button>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table></div>
                        )}
                    </div>

                    {/* ── Schedules Panel ── */}
                    <div className="bg-gray-800 rounded-lg p-5">
                        <h2 className="text-lg font-semibold text-white mb-4">Auto-Run Schedules</h2>
                        {schedules.length === 0 ? (
                            <p className="text-gray-400 text-sm">No servers found.</p>
                        ) : (
                            <div className="overflow-x-auto"><table className="w-full text-sm text-left">
                                <thead>
                                    <tr className="text-gray-400 border-b border-gray-700">
                                        <th className="py-2 pr-4">Server</th>
                                        <th className="py-2 pr-4" colSpan={3}>Schedule &amp; Notifications</th>
                                        <th className="py-2">Actions</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {schedules.map(sch => (
                                        <ScheduleRow
                                            key={sch.server_id}
                                            schedule={sch}
                                            onSave={saveSchedule}
                                            onNotify={handleNotify}
                                            notifying={notifying}
                                        />
                                    ))}
                                </tbody>
                            </table></div>
                        )}
                    </div>
                </main>
            </div>

            {/* ── Logs Drawer ── */}
            {logsDrawer.open && (
                <div className="fixed inset-0 bg-black bg-opacity-60 flex justify-end z-50">
                    <div className="w-full max-w-2xl bg-gray-900 h-full overflow-y-auto p-6">
                        <div className="flex justify-between items-center mb-4">
                            <h3 className="text-white font-semibold">
                                Logs — {logsDrawer.migration?.filename}
                            </h3>
                            <button onClick={() => setLogsDrawer({ open: false, migration: null, logs: [] })}
                                className="text-gray-400 hover:text-white text-xl">✕</button>
                        </div>
                        {logsDrawer.logs.length === 0 ? (
                            <p className="text-gray-400 text-sm">No logs yet.</p>
                        ) : (
                            <div className="overflow-x-auto"><table className="w-full text-sm text-left">
                                <thead>
                                    <tr className="text-gray-400 border-b border-gray-700">
                                        <th className="py-2 pr-3">Domain</th>
                                        <th className="py-2 pr-3">Server</th>
                                        <th className="py-2 pr-3">Status</th>
                                        <th className="py-2">Executed</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {logsDrawer.logs.map(log => (
                                        <tr key={log.id} className="border-b border-gray-800 text-gray-300">
                                            <td className="py-2 pr-3 text-xs font-mono">{log.domain_name}</td>
                                            <td className="py-2 pr-3 text-xs">{log.server_name}</td>
                                            <td className={`py-2 pr-3 font-semibold text-xs ${statusColor(log.status)}`}>
                                                {log.status.toUpperCase()}
                                                {log.error_message && (
                                                    <div className="text-red-400 font-normal mt-0.5 break-all">{log.error_message}</div>
                                                )}
                                            </td>
                                            <td className="py-2 text-xs text-gray-400">
                                                {new Date(log.executed_at).toLocaleString()}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table></div>
                        )}
                    </div>
                </div>
            )}

            {/* ── Run Result Modal ── */}
            {runResult && (
                <div className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center z-50">
                    <div className="bg-gray-800 rounded-lg p-6 w-full max-w-2xl max-h-screen overflow-y-auto">
                        <div className="flex justify-between items-center mb-4">
                            <h3 className="text-white font-semibold">Migration Run Result</h3>
                            <button onClick={() => setRunResult(null)} className="text-gray-400 hover:text-white text-xl">✕</button>
                        </div>
                        <div className="flex gap-6 mb-4 text-sm">
                            <span className="text-gray-300">Sites: <strong className="text-white">{runResult.total_sites}</strong></span>
                            <span className="text-green-400">Success: <strong>{runResult.success}</strong></span>
                            <span className="text-red-400">Failed: <strong>{runResult.failed}</strong></span>
                            <span className="text-gray-400">Skipped: <strong>{runResult.skipped}</strong></span>
                        </div>
                        {runResult.details.length > 0 && (
                            <div className="overflow-x-auto"><table className="w-full text-xs text-left">
                                <thead>
                                    <tr className="text-gray-400 border-b border-gray-700">
                                        <th className="py-1 pr-3">Site</th>
                                        <th className="py-1 pr-3">Migration</th>
                                        <th className="py-1">Status / Error</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {runResult.details.map((d, i) => (
                                        <tr key={i} className="border-b border-gray-700 text-gray-300">
                                            <td className="py-1 pr-3 font-mono">{d.site}</td>
                                            <td className="py-1 pr-3">{d.migration}</td>
                                            <td className={`py-1 ${d.status === 'success' ? 'text-green-400' : 'text-red-400'}`}>
                                                {d.status}{d.error ? `: ${d.error}` : ''}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table></div>
                        )}
                    </div>
                </div>
            )}
        </div>
    )
}

const DAY_OPTIONS = [
    { label: 'Monday', value: 0 },
    { label: 'Tuesday', value: 1 },
    { label: 'Wednesday', value: 2 },
    { label: 'Thursday', value: 3 },
    { label: 'Friday', value: 4 },
    { label: 'Saturday', value: 5 },
    { label: 'Sunday', value: 6 },
]

const STATUS_COLORS: Record<string, string> = {
    scheduled: 'bg-blue-900 text-blue-300',
    notified: 'bg-yellow-900 text-yellow-300',
    completed: 'bg-green-900 text-green-300',
    disabled: 'bg-gray-700 text-gray-400',
}

function ScheduleRow({ schedule, onSave, onNotify, notifying }: {
    schedule: Schedule
    onSave: (server_id: number, payload: Partial<Schedule>) => void
    onNotify: (server_id: number) => void
    notifying: number | null
}) {
    const [scheduleType, setScheduleType] = useState(schedule.schedule_type || 'recurring')
    const [runAt, setRunAt] = useState(
        schedule.run_at ? schedule.run_at.slice(0, 16) : ''
    )
    const [dayOfWeek, setDayOfWeek] = useState<number>(schedule.day_of_week ?? 0)
    const [timeOfDay, setTimeOfDay] = useState(schedule.time_of_day || '02:00')
    const [notifyEmails, setNotifyEmails] = useState(schedule.notify_emails || '')
    const [notifyHoursBefore, setNotifyHoursBefore] = useState(schedule.notify_hours_before ?? 24)
    const [enabled, setEnabled] = useState(schedule.enabled)

    useEffect(() => {
        setScheduleType(schedule.schedule_type || 'recurring')
        setRunAt(schedule.run_at ? schedule.run_at.slice(0, 16) : '')
        setDayOfWeek(schedule.day_of_week ?? 0)
        setTimeOfDay(schedule.time_of_day || '02:00')
        setNotifyEmails(schedule.notify_emails || '')
        setNotifyHoursBefore(schedule.notify_hours_before ?? 24)
        setEnabled(schedule.enabled)
    }, [schedule])

    function buildPayload(): Partial<Schedule> {
        return {
            schedule_type: scheduleType,
            run_at: scheduleType === 'one_time' ? (runAt ? `${runAt}:00Z` : null) : null,
            day_of_week: scheduleType === 'recurring' ? dayOfWeek : null,
            time_of_day: timeOfDay || null,
            notify_emails: notifyEmails.trim() || null,
            notify_hours_before: notifyHoursBefore,
            enabled,
        }
    }

    return (
        <tr className="border-b border-gray-700 align-top">
            <td className="py-3 pr-4 text-gray-300 font-medium">{schedule.server_name}</td>
            <td className="py-3 pr-4" colSpan={3}>
                <div className="flex flex-col gap-2">
                    {/* Schedule type toggle */}
                    <div className="flex gap-2">
                        {(['one_time', 'recurring'] as const).map(t => (
                            <button
                                key={t}
                                onClick={() => setScheduleType(t)}
                                className={`text-xs px-3 py-1 rounded ${scheduleType === t ? 'bg-blue-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'}`}
                            >
                                {t === 'one_time' ? 'One-time' : 'Recurring weekly'}
                            </button>
                        ))}
                    </div>

                    {/* One-time: datetime picker */}
                    {scheduleType === 'one_time' && (
                        <div>
                            <label className="text-xs text-gray-400 block mb-1">Date &amp; Time (UTC)</label>
                            <input
                                type="datetime-local"
                                value={runAt}
                                onChange={e => setRunAt(e.target.value)}
                                className="bg-gray-700 text-white text-sm rounded px-3 py-1"
                            />
                        </div>
                    )}

                    {/* Recurring: day of week + time */}
                    {scheduleType === 'recurring' && (
                        <div className="flex gap-3 items-end">
                            <div>
                                <label className="text-xs text-gray-400 block mb-1">Day of week</label>
                                <select
                                    value={dayOfWeek}
                                    onChange={e => setDayOfWeek(Number(e.target.value))}
                                    className="bg-gray-700 text-white text-sm rounded px-2 py-1"
                                >
                                    {DAY_OPTIONS.map(d => (
                                        <option key={d.value} value={d.value}>{d.label}</option>
                                    ))}
                                </select>
                            </div>
                            <div>
                                <label className="text-xs text-gray-400 block mb-1">Time (UTC)</label>
                                <input
                                    type="time"
                                    value={timeOfDay}
                                    onChange={e => setTimeOfDay(e.target.value)}
                                    className="bg-gray-700 text-white text-sm rounded px-3 py-1"
                                />
                            </div>
                        </div>
                    )}

                    {/* Notification settings */}
                    <div className="flex gap-3 items-end flex-wrap mt-1">
                        <div className="flex-1 min-w-48">
                            <label className="text-xs text-gray-400 block mb-1">Notify emails (comma-separated)</label>
                            <input
                                type="text"
                                value={notifyEmails}
                                onChange={e => setNotifyEmails(e.target.value)}
                                placeholder="client@example.com, team@company.com"
                                className="bg-gray-700 text-white text-sm rounded px-3 py-1 w-full"
                            />
                        </div>
                        <div>
                            <label className="text-xs text-gray-400 block mb-1">Hours before</label>
                            <input
                                type="number"
                                min={1}
                                value={notifyHoursBefore}
                                onChange={e => setNotifyHoursBefore(Number(e.target.value))}
                                className="bg-gray-700 text-white text-sm rounded px-3 py-1 w-20"
                            />
                        </div>
                    </div>

                    {/* Enabled + status */}
                    <div className="flex items-center gap-3 mt-1">
                        <label className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer">
                            <input
                                type="checkbox"
                                checked={enabled}
                                onChange={e => setEnabled(e.target.checked)}
                                className="w-4 h-4"
                            />
                            Enabled
                        </label>
                        {scheduleType === 'one_time' && (
                            <span className={`text-xs px-2 py-0.5 rounded ${STATUS_COLORS[schedule.status] || STATUS_COLORS.scheduled}`}>
                                {schedule.status}
                            </span>
                        )}
                        {schedule.last_run_at && (
                            <span className="text-xs text-gray-500">
                                Last run: {new Date(schedule.last_run_at).toLocaleString()}
                            </span>
                        )}
                    </div>
                </div>
            </td>
            <td className="py-3 pl-2">
                <div className="flex flex-col gap-2">
                    <button
                        onClick={() => onSave(schedule.server_id, buildPayload())}
                        className="bg-blue-600 hover:bg-blue-700 text-white text-xs px-3 py-1 rounded whitespace-nowrap"
                    >
                        Save
                    </button>
                    <button
                        onClick={() => onNotify(schedule.server_id)}
                        disabled={notifying === schedule.server_id || !notifyEmails.trim()}
                        className="bg-yellow-600 hover:bg-yellow-700 disabled:opacity-50 text-white text-xs px-3 py-1 rounded whitespace-nowrap"
                    >
                        {notifying === schedule.server_id ? 'Sending…' : 'Send Notice'}
                    </button>
                </div>
            </td>
        </tr>
    )
}
