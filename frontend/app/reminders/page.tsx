'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { authAPI, getAuthToken } from '@/lib/auth'
import { API_URL } from '@/lib/config'
import MainHeader from '@/components/MainHeader'
import ReminderShareModal from '@/components/ReminderShareModal'
import SocialShareButtons from '@/components/SocialShareButtons'
import { useEvents } from '@/lib/events-context'
import { FiPlus, FiEdit2, FiTrash2, FiShare2, FiMessageSquare, FiCalendar, FiClock, FiCheck, FiX } from 'react-icons/fi'

interface Reminder {
    id: number
    user_id: number
    title: string
    description: string | null
    priority: string
    status: string
    due_date: string | null
    original_due_date: string | null
    created_at: string
    updated_at: string | null
    owner_name: string | null
    share_count: number
    comment_count: number
}

interface SharedReminder {
    id: number
    reminder_id: number
    shared_by: number
    shared_with: number
    is_seen: boolean
    created_at: string
    sharer_name: string | null
    reminder_title: string | null
    reminder_description: string | null
    reminder_priority: string | null
    reminder_due_date: string | null
    reminder_status: string | null
}

interface Comment {
    id: number
    reminder_id: number
    user_id: number
    content: string
    created_at: string
    author_name: string | null
}

const PRIORITY_COLORS: Record<string, string> = {
    planning: 'bg-gray-100 text-gray-700',
    low: 'bg-blue-100 text-blue-700',
    as_usual: 'bg-yellow-100 text-yellow-700',
    urgent: 'bg-red-100 text-red-700',
}

const PRIORITY_LABELS: Record<string, string> = {
    planning: 'Planning',
    low: 'Low',
    as_usual: 'As Usual',
    urgent: 'Urgent',
}

const STATUS_COLORS: Record<string, string> = {
    scheduled: 'bg-blue-100 text-blue-700',
    pending: 'bg-yellow-100 text-yellow-700',
    completed: 'bg-green-100 text-green-700',
}

const STATUS_LABELS: Record<string, string> = {
    scheduled: 'Scheduled',
    pending: 'Pending',
    completed: 'Completed',
}

export default function RemindersPage() {
    const router = useRouter()
    const user = authAPI.getUser()
    const { subscribe } = useEvents()

    const [activeTab, setActiveTab] = useState<'my' | 'shared'>('my')
    const [reminders, setReminders] = useState<Reminder[]>([])
    const [sharedReminders, setSharedReminders] = useState<SharedReminder[]>([])
    const [loading, setLoading] = useState(true)
    const [filterStatus, setFilterStatus] = useState('')
    const [filterPriority, setFilterPriority] = useState('')

    // Modal states
    const [showCreateModal, setShowCreateModal] = useState(false)
    const [editingReminder, setEditingReminder] = useState<Reminder | null>(null)
    const [showDetailModal, setShowDetailModal] = useState(false)
    const [selectedReminder, setSelectedReminder] = useState<Reminder | null>(null)
    const [showShareModal, setShowShareModal] = useState(false)
    const [shareReminderId, setShareReminderId] = useState<number | null>(null)
    const [showRescheduleModal, setShowRescheduleModal] = useState(false)
    const [rescheduleId, setRescheduleId] = useState<number | null>(null)
    const [showSocialShare, setShowSocialShare] = useState<number | null>(null)

    // Form state
    const [form, setForm] = useState({ title: '', description: '', priority: 'as_usual', due_date: '', status: 'scheduled' })

    // Comments
    const [comments, setComments] = useState<Comment[]>([])
    const [newComment, setNewComment] = useState('')

    // Reschedule
    const [rescheduleDate, setRescheduleDate] = useState('')

    useEffect(() => {
        if (!user) { router.push('/login'); return }
        fetchReminders()
        fetchSharedReminders()
    }, [])

    // Subscribe to real-time events
    useEffect(() => {
        const unsub1 = subscribe('reminder_shared', () => {
            fetchSharedReminders()
        })
        const unsub2 = subscribe('reminder_comment', () => {
            if (selectedReminder) fetchComments(selectedReminder.id)
        })
        const unsub3 = subscribe('reminder_due', () => {
            fetchReminders()
        })
        return () => { unsub1(); unsub2(); unsub3() }
    }, [subscribe, selectedReminder])

    const headers = useCallback(() => ({
        'Authorization': `Bearer ${getAuthToken()}`,
        'Content-Type': 'application/json',
    }), [])

    const fetchReminders = async () => {
        setLoading(true)
        try {
            const params = new URLSearchParams()
            if (filterStatus) params.set('status', filterStatus)
            if (filterPriority) params.set('priority', filterPriority)
            const res = await fetch(`${API_URL}/api/todos?${params}`, { headers: headers() })
            if (res.ok) setReminders(await res.json())
        } catch (e) { console.error(e) }
        finally { setLoading(false) }
    }

    const fetchSharedReminders = async () => {
        try {
            const res = await fetch(`${API_URL}/api/todos/shared-with-me`, { headers: headers() })
            if (res.ok) setSharedReminders(await res.json())
        } catch (e) { console.error(e) }
    }

    const fetchComments = async (reminderId: number) => {
        try {
            const res = await fetch(`${API_URL}/api/todos/${reminderId}/comments`, { headers: headers() })
            if (res.ok) setComments(await res.json())
        } catch (e) { console.error(e) }
    }

    useEffect(() => { fetchReminders() }, [filterStatus, filterPriority])

    const handleCreate = async () => {
        try {
            const body: any = { title: form.title, description: form.description || null, priority: form.priority }
            if (form.priority !== 'planning' && form.due_date) {
                body.due_date = new Date(form.due_date).toISOString()
            }
            const res = await fetch(`${API_URL}/api/todos`, {
                method: 'POST', headers: headers(), body: JSON.stringify(body)
            })
            if (res.ok) {
                setShowCreateModal(false)
                setForm({ title: '', description: '', priority: 'as_usual', due_date: '', status: 'scheduled' })
                fetchReminders()
            }
        } catch (e) { console.error(e) }
    }

    const handleUpdate = async () => {
        if (!editingReminder) return
        try {
            const body: any = { title: form.title, description: form.description || null, priority: form.priority, status: form.status }
            if (form.priority !== 'planning' && form.due_date) {
                body.due_date = new Date(form.due_date).toISOString()
            }
            const res = await fetch(`${API_URL}/api/todos/${editingReminder.id}`, {
                method: 'PUT', headers: headers(), body: JSON.stringify(body)
            })
            if (res.ok) {
                setEditingReminder(null)
                setForm({ title: '', description: '', priority: 'as_usual', due_date: '', status: 'scheduled' })
                fetchReminders()
            }
        } catch (e) { console.error(e) }
    }

    const handleDelete = async (id: number) => {
        if (!confirm('Delete this reminder?')) return
        try {
            await fetch(`${API_URL}/api/todos/${id}`, { method: 'DELETE', headers: headers() })
            fetchReminders()
        } catch (e) { console.error(e) }
    }

    const handleStatusChange = async (id: number, status: string) => {
        try {
            await fetch(`${API_URL}/api/todos/${id}/status`, {
                method: 'PUT', headers: headers(), body: JSON.stringify({ status })
            })
            fetchReminders()
        } catch (e) { console.error(e) }
    }

    const handleReschedule = async () => {
        if (!rescheduleId || !rescheduleDate) return
        try {
            await fetch(`${API_URL}/api/todos/${rescheduleId}/reschedule`, {
                method: 'PUT', headers: headers(),
                body: JSON.stringify({ due_date: new Date(rescheduleDate).toISOString() })
            })
            setShowRescheduleModal(false)
            setRescheduleId(null)
            setRescheduleDate('')
            fetchReminders()
        } catch (e) { console.error(e) }
    }

    const handleAddComment = async () => {
        if (!selectedReminder || !newComment.trim()) return
        try {
            const res = await fetch(`${API_URL}/api/todos/${selectedReminder.id}/comments`, {
                method: 'POST', headers: headers(),
                body: JSON.stringify({ content: newComment.trim() })
            })
            if (res.ok) {
                setNewComment('')
                fetchComments(selectedReminder.id)
            }
        } catch (e) { console.error(e) }
    }

    const markSeen = async (shareId: number) => {
        try {
            await fetch(`${API_URL}/api/todos/shared-with-me/${shareId}/seen`, {
                method: 'PUT', headers: headers()
            })
            fetchSharedReminders()
        } catch (e) { console.error(e) }
    }

    const openDetail = async (reminder: Reminder) => {
        setSelectedReminder(reminder)
        setShowDetailModal(true)
        await fetchComments(reminder.id)
    }

    const openEdit = (reminder: Reminder) => {
        setEditingReminder(reminder)
        setForm({
            title: reminder.title,
            description: reminder.description || '',
            priority: reminder.priority,
            due_date: reminder.due_date ? new Date(reminder.due_date).toISOString().slice(0, 16) : '',
            status: reminder.status,
        })
    }

    const formatDate = (dateStr: string | null) => {
        if (!dateStr) return 'No due date'
        return new Date(dateStr).toLocaleString()
    }

    if (!user) return null

    return (
        <div className="min-h-screen bg-gray-50">
            <MainHeader user={user} />
            <div className="pt-14">
                <main className="max-w-5xl mx-auto p-6">
                    {/* Header */}
                    <div className="flex items-center justify-between mb-6">
                        <h1 className="text-2xl font-bold text-gray-800">Reminders</h1>
                        <button
                            onClick={() => { setShowCreateModal(true); setForm({ title: '', description: '', priority: 'as_usual', due_date: '', status: 'scheduled' }) }}
                            className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition"
                        >
                            <FiPlus size={16} /> New Reminder
                        </button>
                    </div>

                    {/* Tabs */}
                    <div className="flex gap-1 mb-4 bg-gray-100 p-1 rounded-lg w-fit">
                        <button
                            onClick={() => setActiveTab('my')}
                            className={`px-4 py-2 rounded-md text-sm font-medium transition ${activeTab === 'my' ? 'bg-white shadow text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}
                        >
                            My Reminders
                        </button>
                        <button
                            onClick={() => { setActiveTab('shared'); fetchSharedReminders() }}
                            className={`px-4 py-2 rounded-md text-sm font-medium transition relative ${activeTab === 'shared' ? 'bg-white shadow text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}
                        >
                            Shared With Me
                            {sharedReminders.filter(s => !s.is_seen).length > 0 && (
                                <span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs rounded-full h-5 w-5 flex items-center justify-center">
                                    {sharedReminders.filter(s => !s.is_seen).length}
                                </span>
                            )}
                        </button>
                    </div>

                    {/* My Reminders Tab */}
                    {activeTab === 'my' && (
                        <>
                            {/* Filters */}
                            <div className="flex gap-3 mb-4">
                                <select
                                    value={filterStatus}
                                    onChange={e => setFilterStatus(e.target.value)}
                                    className="border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white"
                                >
                                    <option value="">All Statuses</option>
                                    <option value="scheduled">Scheduled</option>
                                    <option value="pending">Pending</option>
                                    <option value="completed">Completed</option>
                                </select>
                                <select
                                    value={filterPriority}
                                    onChange={e => setFilterPriority(e.target.value)}
                                    className="border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white"
                                >
                                    <option value="">All Priorities</option>
                                    <option value="planning">Planning</option>
                                    <option value="low">Low</option>
                                    <option value="as_usual">As Usual</option>
                                    <option value="urgent">Urgent</option>
                                </select>
                            </div>

                            {loading ? (
                                <div className="text-center py-12 text-gray-500">Loading...</div>
                            ) : reminders.length === 0 ? (
                                <div className="text-center py-12 text-gray-400">No reminders yet. Create one!</div>
                            ) : (
                                <div className="space-y-3">
                                    {reminders.map(r => (
                                        <div key={r.id} className={`bg-white rounded-lg border p-4 hover:shadow-md transition cursor-pointer ${r.status === 'pending' ? 'border-yellow-300' : 'border-gray-200'}`}>
                                            <div className="flex items-start justify-between">
                                                <div className="flex-1" onClick={() => openDetail(r)}>
                                                    <div className="flex items-center gap-2 mb-1">
                                                        <h3 className={`font-semibold text-gray-800 ${r.status === 'completed' ? 'line-through text-gray-400' : ''}`}>
                                                            {r.title}
                                                        </h3>
                                                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${PRIORITY_COLORS[r.priority] || 'bg-gray-100'}`}>
                                                            {PRIORITY_LABELS[r.priority] || r.priority}
                                                        </span>
                                                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLORS[r.status] || 'bg-gray-100'}`}>
                                                            {STATUS_LABELS[r.status] || r.status}
                                                        </span>
                                                    </div>
                                                    {r.description && <p className="text-sm text-gray-500 mb-1 line-clamp-1">{r.description}</p>}
                                                    <div className="flex items-center gap-4 text-xs text-gray-400">
                                                        {r.due_date && (
                                                            <span className="flex items-center gap-1">
                                                                <FiCalendar size={12} /> {formatDate(r.due_date)}
                                                            </span>
                                                        )}
                                                        {r.share_count > 0 && (
                                                            <span className="flex items-center gap-1">
                                                                <FiShare2 size={12} /> {r.share_count} shared
                                                            </span>
                                                        )}
                                                        {r.comment_count > 0 && (
                                                            <span className="flex items-center gap-1">
                                                                <FiMessageSquare size={12} /> {r.comment_count}
                                                            </span>
                                                        )}
                                                    </div>
                                                </div>
                                                <div className="flex items-center gap-1 ml-2">
                                                    {r.status !== 'completed' && (
                                                        <button onClick={() => handleStatusChange(r.id, 'completed')} title="Mark complete"
                                                            className="p-1.5 text-green-500 hover:bg-green-50 rounded">
                                                            <FiCheck size={16} />
                                                        </button>
                                                    )}
                                                    {r.status === 'pending' && (
                                                        <button onClick={() => { setRescheduleId(r.id); setShowRescheduleModal(true) }} title="Reschedule"
                                                            className="p-1.5 text-blue-500 hover:bg-blue-50 rounded">
                                                            <FiClock size={16} />
                                                        </button>
                                                    )}
                                                    <button onClick={() => { setShareReminderId(r.id); setShowShareModal(true) }} title="Share"
                                                        className="p-1.5 text-purple-500 hover:bg-purple-50 rounded">
                                                        <FiShare2 size={16} />
                                                    </button>
                                                    <div className="relative">
                                                        <button onClick={() => setShowSocialShare(showSocialShare === r.id ? null : r.id)} title="Social share"
                                                            className="p-1.5 text-indigo-500 hover:bg-indigo-50 rounded text-xs font-bold">
                                                            S
                                                        </button>
                                                        {showSocialShare === r.id && (
                                                            <div className="absolute right-0 top-full mt-1 z-10">
                                                                <SocialShareButtons
                                                                    title={r.title}
                                                                    description={r.description || ''}
                                                                    dueDate={r.due_date}
                                                                    onClose={() => setShowSocialShare(null)}
                                                                />
                                                            </div>
                                                        )}
                                                    </div>
                                                    <button onClick={() => openEdit(r)} title="Edit"
                                                        className="p-1.5 text-gray-400 hover:bg-gray-50 rounded">
                                                        <FiEdit2 size={16} />
                                                    </button>
                                                    <button onClick={() => handleDelete(r.id)} title="Delete"
                                                        className="p-1.5 text-red-400 hover:bg-red-50 rounded">
                                                        <FiTrash2 size={16} />
                                                    </button>
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </>
                    )}

                    {/* Shared With Me Tab */}
                    {activeTab === 'shared' && (
                        <div className="space-y-3">
                            {sharedReminders.length === 0 ? (
                                <div className="text-center py-12 text-gray-400">No shared reminders</div>
                            ) : (
                                sharedReminders.map(s => (
                                    <div
                                        key={s.id}
                                        className={`bg-white rounded-lg border p-4 cursor-pointer hover:shadow-md transition ${!s.is_seen ? 'border-blue-300 bg-blue-50/30' : 'border-gray-200'}`}
                                        onClick={() => {
                                            if (!s.is_seen) markSeen(s.id)
                                            // Fetch full reminder for detail view
                                            fetch(`${API_URL}/api/todos/${s.reminder_id}`, { headers: headers() })
                                                .then(res => res.json())
                                                .then(data => { openDetail(data) })
                                        }}
                                    >
                                        <div className="flex items-start justify-between">
                                            <div>
                                                <div className="flex items-center gap-2 mb-1">
                                                    {!s.is_seen && <span className="h-2 w-2 rounded-full bg-blue-500" />}
                                                    <h3 className="font-semibold text-gray-800">{s.reminder_title}</h3>
                                                    {s.reminder_priority && (
                                                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${PRIORITY_COLORS[s.reminder_priority] || 'bg-gray-100'}`}>
                                                            {PRIORITY_LABELS[s.reminder_priority] || s.reminder_priority}
                                                        </span>
                                                    )}
                                                    {s.reminder_status && (
                                                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLORS[s.reminder_status] || 'bg-gray-100'}`}>
                                                            {STATUS_LABELS[s.reminder_status] || s.reminder_status}
                                                        </span>
                                                    )}
                                                </div>
                                                {s.reminder_description && <p className="text-sm text-gray-500 mb-1">{s.reminder_description}</p>}
                                                <div className="text-xs text-gray-400 flex items-center gap-3">
                                                    <span>Shared by <strong>{s.sharer_name}</strong></span>
                                                    {s.reminder_due_date && (
                                                        <span className="flex items-center gap-1"><FiCalendar size={12} /> {formatDate(s.reminder_due_date)}</span>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>
                    )}
                </main>
            </div>

            {/* Create Modal */}
            {showCreateModal && (
                <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={() => setShowCreateModal(false)}>
                    <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6" onClick={e => e.stopPropagation()}>
                        <h2 className="text-lg font-bold mb-4">New Reminder</h2>
                        <div className="space-y-3">
                            <input
                                type="text" placeholder="Title" value={form.title}
                                onChange={e => setForm({ ...form, title: e.target.value })}
                                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                            />
                            <textarea
                                placeholder="Description (optional)" value={form.description}
                                onChange={e => setForm({ ...form, description: e.target.value })}
                                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                                rows={3}
                            />
                            <select
                                value={form.priority}
                                onChange={e => setForm({ ...form, priority: e.target.value })}
                                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white"
                            >
                                <option value="planning">Planning</option>
                                <option value="low">Low</option>
                                <option value="as_usual">As Usual</option>
                                <option value="urgent">Urgent</option>
                            </select>
                            {form.priority !== 'planning' && (
                                <input
                                    type="datetime-local" value={form.due_date}
                                    onChange={e => setForm({ ...form, due_date: e.target.value })}
                                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                                />
                            )}
                        </div>
                        <div className="flex justify-end gap-2 mt-5">
                            <button onClick={() => setShowCreateModal(false)} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">Cancel</button>
                            <button onClick={handleCreate} disabled={!form.title} className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50">Create</button>
                        </div>
                    </div>
                </div>
            )}

            {/* Edit Modal */}
            {editingReminder && (
                <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={() => setEditingReminder(null)}>
                    <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6" onClick={e => e.stopPropagation()}>
                        <h2 className="text-lg font-bold mb-4">Edit Reminder</h2>
                        <div className="space-y-3">
                            <input
                                type="text" placeholder="Title" value={form.title}
                                onChange={e => setForm({ ...form, title: e.target.value })}
                                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                            />
                            <textarea
                                placeholder="Description (optional)" value={form.description}
                                onChange={e => setForm({ ...form, description: e.target.value })}
                                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                                rows={3}
                            />
                            <select
                                value={form.priority}
                                onChange={e => setForm({ ...form, priority: e.target.value })}
                                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white"
                            >
                                <option value="planning">Planning</option>
                                <option value="low">Low</option>
                                <option value="as_usual">As Usual</option>
                                <option value="urgent">Urgent</option>
                            </select>
                            <select
                                value={form.status}
                                onChange={e => setForm({ ...form, status: e.target.value })}
                                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white"
                            >
                                <option value="scheduled">Scheduled</option>
                                <option value="pending">Pending</option>
                                <option value="completed">Completed</option>
                            </select>
                            {form.priority !== 'planning' && (
                                <input
                                    type="datetime-local" value={form.due_date}
                                    onChange={e => setForm({ ...form, due_date: e.target.value })}
                                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                                />
                            )}
                        </div>
                        <div className="flex justify-end gap-2 mt-5">
                            <button onClick={() => setEditingReminder(null)} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">Cancel</button>
                            <button onClick={handleUpdate} disabled={!form.title} className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50">Save</button>
                        </div>
                    </div>
                </div>
            )}

            {/* Reschedule Modal */}
            {showRescheduleModal && (
                <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={() => setShowRescheduleModal(false)}>
                    <div className="bg-white rounded-xl shadow-xl w-full max-w-sm p-6" onClick={e => e.stopPropagation()}>
                        <h2 className="text-lg font-bold mb-4">Reschedule</h2>
                        <input
                            type="datetime-local" value={rescheduleDate}
                            onChange={e => setRescheduleDate(e.target.value)}
                            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm mb-4"
                        />
                        <div className="flex justify-end gap-2">
                            <button onClick={() => setShowRescheduleModal(false)} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">Cancel</button>
                            <button onClick={handleReschedule} disabled={!rescheduleDate} className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50">Reschedule</button>
                        </div>
                    </div>
                </div>
            )}

            {/* Detail + Comments Modal */}
            {showDetailModal && selectedReminder && (
                <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={() => { setShowDetailModal(false); setSelectedReminder(null) }}>
                    <div className="bg-white rounded-xl shadow-xl w-full max-w-lg p-6 max-h-[80vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
                        <div className="flex items-center justify-between mb-4">
                            <h2 className="text-lg font-bold">{selectedReminder.title}</h2>
                            <button onClick={() => { setShowDetailModal(false); setSelectedReminder(null) }} className="text-gray-400 hover:text-gray-600">
                                <FiX size={20} />
                            </button>
                        </div>
                        <div className="flex items-center gap-2 mb-3">
                            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${PRIORITY_COLORS[selectedReminder.priority]}`}>
                                {PRIORITY_LABELS[selectedReminder.priority]}
                            </span>
                            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLORS[selectedReminder.status]}`}>
                                {STATUS_LABELS[selectedReminder.status]}
                            </span>
                        </div>
                        {selectedReminder.description && (
                            <p className="text-sm text-gray-600 mb-3 whitespace-pre-wrap">{selectedReminder.description}</p>
                        )}
                        <div className="text-xs text-gray-400 mb-4 space-y-1">
                            {selectedReminder.due_date && <p>Due: {formatDate(selectedReminder.due_date)}</p>}
                            {selectedReminder.original_due_date && selectedReminder.original_due_date !== selectedReminder.due_date && (
                                <p>Originally: {formatDate(selectedReminder.original_due_date)}</p>
                            )}
                            <p>Created: {formatDate(selectedReminder.created_at)}</p>
                        </div>

                        {/* Comments */}
                        <div className="border-t pt-4">
                            <h3 className="text-sm font-semibold text-gray-700 mb-3">Comments ({comments.length})</h3>
                            <div className="space-y-3 mb-4 max-h-48 overflow-y-auto">
                                {comments.map(c => (
                                    <div key={c.id} className="bg-gray-50 rounded-lg p-3">
                                        <div className="flex items-center justify-between mb-1">
                                            <span className="text-xs font-semibold text-gray-700">{c.author_name || 'Unknown'}</span>
                                            <span className="text-xs text-gray-400">{formatDate(c.created_at)}</span>
                                        </div>
                                        <p className="text-sm text-gray-600">{c.content}</p>
                                    </div>
                                ))}
                                {comments.length === 0 && <p className="text-xs text-gray-400">No comments yet</p>}
                            </div>
                            <div className="flex gap-2">
                                <input
                                    type="text" placeholder="Write a comment..."
                                    value={newComment}
                                    onChange={e => setNewComment(e.target.value)}
                                    onKeyDown={e => e.key === 'Enter' && handleAddComment()}
                                    className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                                />
                                <button onClick={handleAddComment} disabled={!newComment.trim()}
                                    className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50">
                                    Send
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Share Modal */}
            {showShareModal && shareReminderId && (
                <ReminderShareModal
                    isOpen={showShareModal}
                    onClose={() => { setShowShareModal(false); setShareReminderId(null) }}
                    reminderId={shareReminderId}
                    onShared={() => fetchReminders()}
                />
            )}
        </div>
    )
}
