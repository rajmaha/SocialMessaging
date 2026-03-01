'use client'

import { useState, useEffect } from 'react'
import { getAuthToken } from '@/lib/auth'
import { API_URL } from '@/lib/config'
import { FiX, FiSearch, FiCheck } from 'react-icons/fi'

interface InternalUser {
    id: number
    full_name: string
    display_name: string | null
    email: string
    role: string
    avatar_url: string | null
}

interface ReminderShareModalProps {
    isOpen: boolean
    onClose: () => void
    reminderId: number
    onShared: () => void
}

export default function ReminderShareModal({ isOpen, onClose, reminderId, onShared }: ReminderShareModalProps) {
    const [users, setUsers] = useState<InternalUser[]>([])
    const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())
    const [search, setSearch] = useState('')
    const [loading, setLoading] = useState(true)
    const [sharing, setSharing] = useState(false)
    const [success, setSuccess] = useState('')

    useEffect(() => {
        if (isOpen) {
            fetchUsers()
            setSelectedIds(new Set())
            setSearch('')
            setSuccess('')
        }
    }, [isOpen])

    const fetchUsers = async () => {
        setLoading(true)
        try {
            const res = await fetch(`${API_URL}/api/todos/users/internal`, {
                headers: { 'Authorization': `Bearer ${getAuthToken()}` }
            })
            if (res.ok) setUsers(await res.json())
        } catch (e) { console.error(e) }
        finally { setLoading(false) }
    }

    const filteredUsers = users.filter(u => {
        const term = search.toLowerCase()
        return (u.full_name || '').toLowerCase().includes(term) ||
            (u.display_name || '').toLowerCase().includes(term) ||
            (u.email || '').toLowerCase().includes(term)
    })

    const toggleUser = (id: number) => {
        const next = new Set(selectedIds)
        if (next.has(id)) next.delete(id)
        else next.add(id)
        setSelectedIds(next)
    }

    const toggleAll = () => {
        if (selectedIds.size === filteredUsers.length) {
            setSelectedIds(new Set())
        } else {
            setSelectedIds(new Set(filteredUsers.map(u => u.id)))
        }
    }

    const handleShare = async () => {
        if (selectedIds.size === 0) return
        setSharing(true)
        try {
            const shareAll = selectedIds.size === users.length
            const res = await fetch(`${API_URL}/api/todos/${reminderId}/share`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${getAuthToken()}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    user_ids: Array.from(selectedIds),
                    share_all: shareAll,
                }),
            })
            if (res.ok) {
                const data = await res.json()
                setSuccess(`Shared with ${data.shared_with} user(s)`)
                onShared()
                setTimeout(() => onClose(), 1500)
            }
        } catch (e) { console.error(e) }
        finally { setSharing(false) }
    }

    if (!isOpen) return null

    return (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={onClose}>
            <div className="bg-white rounded-xl shadow-xl w-full max-w-md max-h-[70vh] flex flex-col" onClick={e => e.stopPropagation()}>
                {/* Header */}
                <div className="flex items-center justify-between p-4 border-b">
                    <h2 className="text-lg font-bold">Share Reminder</h2>
                    <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
                        <FiX size={20} />
                    </button>
                </div>

                {/* Search */}
                <div className="p-4 border-b">
                    <div className="relative">
                        <FiSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
                        <input
                            type="text" placeholder="Search users..."
                            value={search} onChange={e => setSearch(e.target.value)}
                            className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                    </div>
                </div>

                {/* Select All */}
                <div className="px-4 py-2 border-b bg-gray-50">
                    <label className="flex items-center gap-2 cursor-pointer text-sm">
                        <input
                            type="checkbox"
                            checked={filteredUsers.length > 0 && selectedIds.size === filteredUsers.length}
                            onChange={toggleAll}
                            className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                        />
                        <span className="font-medium text-gray-700">Select All ({filteredUsers.length})</span>
                    </label>
                </div>

                {/* User List */}
                <div className="flex-1 overflow-y-auto p-2">
                    {loading ? (
                        <div className="text-center py-8 text-gray-400">Loading users...</div>
                    ) : filteredUsers.length === 0 ? (
                        <div className="text-center py-8 text-gray-400">No users found</div>
                    ) : (
                        filteredUsers.map(u => (
                            <label key={u.id} className="flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer hover:bg-gray-50 transition">
                                <input
                                    type="checkbox"
                                    checked={selectedIds.has(u.id)}
                                    onChange={() => toggleUser(u.id)}
                                    className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                                />
                                <div className="flex items-center gap-2 flex-1 min-w-0">
                                    {u.avatar_url ? (
                                        <img src={u.avatar_url} alt="" className="h-8 w-8 rounded-full object-cover" />
                                    ) : (
                                        <div className="h-8 w-8 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center text-sm font-semibold">
                                            {(u.full_name || u.email || '?')[0].toUpperCase()}
                                        </div>
                                    )}
                                    <div className="min-w-0">
                                        <p className="text-sm font-medium text-gray-800 truncate">{u.display_name || u.full_name}</p>
                                        <p className="text-xs text-gray-400 truncate">{u.email}</p>
                                    </div>
                                </div>
                                <span className="text-xs text-gray-400 capitalize">{u.role}</span>
                            </label>
                        ))
                    )}
                </div>

                {/* Footer */}
                <div className="p-4 border-t flex items-center justify-between">
                    {success ? (
                        <span className="text-sm text-green-600 flex items-center gap-1"><FiCheck size={16} /> {success}</span>
                    ) : (
                        <span className="text-sm text-gray-400">{selectedIds.size} selected</span>
                    )}
                    <div className="flex gap-2">
                        <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">Cancel</button>
                        <button
                            onClick={handleShare}
                            disabled={selectedIds.size === 0 || sharing}
                            className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
                        >
                            {sharing ? 'Sharing...' : 'Share'}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    )
}
