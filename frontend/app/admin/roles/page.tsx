'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import MainHeader from '@/components/MainHeader'
import AdminNav from '@/components/AdminNav'
import { getAuthToken, type User } from '@/lib/auth'

interface AgentUser {
    id: number
    username: string
    email: string
    full_name: string
    role: string
}

interface PermissionToggle {
    key: string
    label: string
    description?: string
}

const MODULES: PermissionToggle[] = [
    { key: 'module_email', label: 'Email' },
    { key: 'module_workspace', label: 'Workspace' },
    { key: 'module_reports', label: 'Reports' },
    { key: 'module_reminders', label: 'Reminders' },
    { key: 'module_notifications', label: 'Notifications' },
]

const CHANNELS: PermissionToggle[] = [
    { key: 'channel_whatsapp', label: 'WhatsApp' },
    { key: 'channel_viber', label: 'Viber' },
    { key: 'channel_linkedin', label: 'LinkedIn' },
    { key: 'channel_messenger', label: 'Messenger' },
    { key: 'channel_webchat', label: 'Webchat' },
]

const FEATURES: PermissionToggle[] = [
    { key: 'feature_manage_users', label: 'Manage Users' },
    { key: 'feature_manage_email_accounts', label: 'Manage Emails' },
    { key: 'feature_manage_agents', label: 'Manage Agents' },
    { key: 'feature_manage_extensions', label: 'Manage Extensions' },
]

export default function RolePermissionsPage() {
    const router = useRouter()
    const [currentUser, setCurrentUser] = useState<User | null>(null)

    const [users, setUsers] = useState<AgentUser[]>([])
    const [userPermissions, setUserPermissions] = useState<Record<number, string[]>>({})

    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)

    useEffect(() => {
        const token = getAuthToken()
        if (!token) {
            router.push('/login')
            return
        }

        const userData = localStorage.getItem('user')
        if (userData) {
            const parsed = JSON.parse(userData)
            if (parsed.role !== 'admin') {
                router.push('/dashboard')
                return
            }
            setCurrentUser(parsed)
        }

        fetchUsersAndPermissions()
    }, [router])

    const fetchUsersAndPermissions = async () => {
        try {
            setLoading(true)
            const token = getAuthToken()

            // Fetch users
            const usersRes = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/admin/users`, {
                headers: { 'Authorization': `Bearer ${token}` }
            })
            if (!usersRes.ok) throw new Error('Failed to fetch users')
            const allUsers: AgentUser[] = await usersRes.json()

            // Only show agents ('user' role) in the grid, main admins don't need permissions managed
            const agents = allUsers.filter(u => u.role === 'user')
            setUsers(agents)

            // Fetch permissions for each agent
            const permsMap: Record<number, string[]> = {}
            await Promise.all(agents.map(async (agent) => {
                const pRes = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/admin/user-permissions/${agent.id}`, {
                    headers: { 'Authorization': `Bearer ${token}` }
                })
                if (pRes.ok) {
                    const data = await pRes.json()
                    permsMap[agent.id] = data.granted_keys || []
                } else {
                    permsMap[agent.id] = []
                }
            }))

            setUserPermissions(permsMap)
        } catch (err: any) {
            setError(err.message)
        } finally {
            setLoading(false)
        }
    }

    const togglePermission = async (userId: number, permissionKey: string, currentlyGranted: boolean) => {
        try {
            const token = getAuthToken()
            const method = currentlyGranted ? 'DELETE' : 'POST'
            const url = currentlyGranted
                ? `${process.env.NEXT_PUBLIC_API_URL}/admin/user-permissions/${userId}/${permissionKey}`
                : `${process.env.NEXT_PUBLIC_API_URL}/admin/user-permissions/${userId}`

            const options: RequestInit = {
                method,
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                }
            }

            if (!currentlyGranted) {
                options.body = JSON.stringify({ permission_key: permissionKey })
            }

            const res = await fetch(url, options)
            if (!res.ok) throw new Error('Failed to update permission')

            // Optimistic cache update
            setUserPermissions(prev => {
                const userPerms = prev[userId] || []
                return {
                    ...prev,
                    [userId]: currentlyGranted
                        ? userPerms.filter(k => k !== permissionKey)
                        : [...userPerms, permissionKey]
                }
            })
        } catch (err: any) {
            alert(`Error updating permission: ${err.message}`)
            // Re-fetch to heal state
            fetchUsersAndPermissions()
        }
    }

    if (loading || !currentUser) return <div className="p-8 text-center text-gray-500">Loading role permissions...</div>

    return (
        <div className="min-h-screen bg-gray-50 flex flex-col">
            <MainHeader user={currentUser} />

            <div className="flex flex-1 pt-14">
                <AdminNav />

                <main className="flex-1 ml-60 p-8 overflow-auto">
                    <div className="max-w-[1600px] mx-auto">
                        <div className="mb-8">
                            <h1 className="text-2xl font-bold text-gray-900 mb-2">User Permissions Grid</h1>
                            <p className="text-gray-500">
                                Manage granular module, conversation channel, and sub-admin feature access for every agent account. Changes are saved instantly.
                            </p>
                        </div>

                        {error && (
                            <div className="mb-6 bg-red-50 border border-red-200 text-red-600 px-4 py-3 rounded-lg">
                                {error}
                            </div>
                        )}

                        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-x-auto">
                            <table className="w-full text-sm text-left">
                                <thead className="text-xs text-gray-700 uppercase bg-gray-50 border-b border-gray-200">
                                    <tr>
                                        <th className="px-6 py-4 font-semibold w-64 sticky left-0 bg-gray-50 z-10 border-r border-gray-200">
                                            User Account
                                        </th>
                                        <th className="px-6 py-4 font-semibold bg-blue-50/50 border-r border-gray-200 text-center" colSpan={MODULES.length}>
                                            Core Modules
                                        </th>
                                        <th className="px-6 py-4 font-semibold bg-green-50/50 border-r border-gray-200 text-center" colSpan={CHANNELS.length}>
                                            Conversations
                                        </th>
                                        <th className="px-6 py-4 font-semibold bg-purple-50/50 text-center" colSpan={FEATURES.length}>
                                            Admin Features
                                        </th>
                                    </tr>
                                    <tr>
                                        <th className="px-6 py-2 sticky left-0 bg-gray-50 z-10 border-r border-gray-200 shadow-[inset_-1px_0_0_rgba(0,0,0,0.1)]">
                                            {/* Empty corner cell */}
                                        </th>
                                        {MODULES.map(m => (
                                            <th key={m.key} className="px-3 py-2 text-center border-r border-gray-200 bg-blue-50/30 whitespace-nowrap" title={m.description}>
                                                {m.label}
                                            </th>
                                        ))}
                                        {CHANNELS.map(c => (
                                            <th key={c.key} className="px-3 py-2 text-center border-r border-gray-200 bg-green-50/30 whitespace-nowrap" title={c.description}>
                                                {c.label}
                                            </th>
                                        ))}
                                        {FEATURES.map(f => (
                                            <th key={f.key} className="px-3 py-2 text-center border-r border-gray-200 bg-purple-50/30 whitespace-nowrap" title={f.description}>
                                                {f.label}
                                            </th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-200">
                                    {users.length === 0 ? (
                                        <tr>
                                            <td colSpan={1 + MODULES.length + CHANNELS.length + FEATURES.length} className="px-6 py-8 text-center text-gray-500 italic">
                                                No agent accounts found. Only users with role "user" appear here.
                                            </td>
                                        </tr>
                                    ) : (
                                        users.map(user => {
                                            const perms = userPermissions[user.id] || []
                                            return (
                                                <tr key={user.id} className="hover:bg-gray-50 transition-colors">
                                                    <td className="px-6 py-3 sticky left-0 bg-white z-10 border-r border-gray-200 shadow-[inset_-1px_0_0_rgba(0,0,0,0.05)]">
                                                        <div className="flex flex-col">
                                                            <span className="font-semibold text-gray-900 truncate max-w-[200px]" title={user.full_name}>{user.full_name}</span>
                                                            <span className="text-xs text-gray-500 truncate max-w-[200px]" title={user.email}>{user.email}</span>
                                                        </div>
                                                    </td>

                                                    {/* Modules */}
                                                    {MODULES.map(m => {
                                                        const isGranted = perms.includes(m.key)
                                                        return (
                                                            <td key={m.key} className="px-3 py-3 text-center border-r border-gray-200">
                                                                <label className="inline-flex items-center cursor-pointer group">
                                                                    <input
                                                                        type="checkbox"
                                                                        className="sr-only peer"
                                                                        checked={isGranted}
                                                                        onChange={() => togglePermission(user.id, m.key, isGranted)}
                                                                    />
                                                                    <div className="relative w-9 h-5 bg-gray-200 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-blue-600"></div>
                                                                </label>
                                                            </td>
                                                        )
                                                    })}

                                                    {/* Channels */}
                                                    {CHANNELS.map(c => {
                                                        const isGranted = perms.includes(c.key)
                                                        return (
                                                            <td key={c.key} className="px-3 py-3 text-center border-r border-gray-200">
                                                                <label className="inline-flex items-center cursor-pointer group">
                                                                    <input
                                                                        type="checkbox"
                                                                        className="sr-only peer"
                                                                        checked={isGranted}
                                                                        onChange={() => togglePermission(user.id, c.key, isGranted)}
                                                                    />
                                                                    <div className="relative w-9 h-5 bg-gray-200 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-green-300 rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-green-500"></div>
                                                                </label>
                                                            </td>
                                                        )
                                                    })}

                                                    {/* Features */}
                                                    {FEATURES.map(f => {
                                                        const isGranted = perms.includes(f.key)
                                                        return (
                                                            <td key={f.key} className="px-3 py-3 text-center border-r border-gray-200">
                                                                <label className="inline-flex items-center cursor-pointer group">
                                                                    <input
                                                                        type="checkbox"
                                                                        className="sr-only peer"
                                                                        checked={isGranted}
                                                                        onChange={() => togglePermission(user.id, f.key, isGranted)}
                                                                    />
                                                                    <div className="relative w-9 h-5 bg-gray-200 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-purple-300 rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-purple-600"></div>
                                                                </label>
                                                            </td>
                                                        )
                                                    })}

                                                </tr>
                                            )
                                        })
                                    )}
                                </tbody>
                            </table>
                        </div>

                    </div>
                </main>
            </div>
        </div>
    )
}
