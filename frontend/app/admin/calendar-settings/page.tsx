'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import axios from 'axios'
import { authAPI, getAuthToken } from '@/lib/auth'
import MainHeader from '@/components/MainHeader'
import AdminNav from '@/components/AdminNav'
import { API_URL } from '@/lib/config'

interface CalendarSettings {
    google_enabled: boolean
    google_client_id: string
    google_client_secret: string
    microsoft_enabled: boolean
    microsoft_client_id: string
    microsoft_client_secret: string
    microsoft_tenant_id: string
}

const defaultSettings: CalendarSettings = {
    google_enabled: false,
    google_client_id: '',
    google_client_secret: '',
    microsoft_enabled: false,
    microsoft_client_id: '',
    microsoft_client_secret: '',
    microsoft_tenant_id: 'common',
}

export default function CalendarSettingsPage() {
    const router = useRouter()
    const [user, setUser] = useState<any>(null)
    const [settings, setSettings] = useState<CalendarSettings>(defaultSettings)
    const [loading, setLoading] = useState(true)
    const [saving, setSaving] = useState(false)
    const [error, setError] = useState('')
    const [success, setSuccess] = useState('')

    useEffect(() => {
        const userData = authAPI.getUser()
        if (!userData) { router.push('/login'); return }
        if (userData.role !== 'admin') { router.push('/dashboard'); return }
        setUser(userData)
        fetchSettings()
    }, [router])

    const fetchSettings = async () => {
        try {
            const token = getAuthToken()
            const resp = await axios.get(`${API_URL}/api/calendar/settings`, {
                headers: { Authorization: `Bearer ${token}` }
            })
            setSettings(resp.data)
        } catch (e) {
            console.error('Failed to load calendar settings', e)
        } finally {
            setLoading(false)
        }
    }

    const handleSave = async () => {
        setSaving(true)
        setError('')
        setSuccess('')
        try {
            const token = getAuthToken()
            await axios.put(`${API_URL}/api/calendar/settings`, settings, {
                headers: { Authorization: `Bearer ${token}` }
            })
            setSuccess('Calendar settings saved successfully!')
            setTimeout(() => setSuccess(''), 3000)
            fetchSettings()
        } catch (e: any) {
            setError(e.response?.data?.detail || 'Failed to save calendar settings')
        } finally {
            setSaving(false)
        }
    }

    if (!user) return null

    return (
        <div className="min-h-screen bg-gray-50">
            <MainHeader user={user} />
            <div className="flex pt-14">
                <AdminNav />
                <main className="flex-1 p-6 ml-64">
                    <div className="max-w-3xl">
                        <h1 className="text-2xl font-bold text-gray-800 mb-1">Calendar Integration</h1>
                        <p className="text-sm text-gray-500 mb-6">Configure OAuth credentials for Google and Microsoft calendar sync. Users can connect their calendars from Settings once enabled.</p>

                        {error && (
                            <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 flex justify-between items-center">
                                <span>{error}</span>
                                <button onClick={() => setError('')} className="text-red-500 hover:text-red-700">x</button>
                            </div>
                        )}
                        {success && (
                            <div className="mb-4 p-4 bg-green-50 border border-green-200 rounded-lg text-green-700">
                                {success}
                            </div>
                        )}

                        {loading ? (
                            <div className="text-center py-12 text-gray-500">Loading...</div>
                        ) : (
                            <div className="space-y-6">
                                {/* Google Calendar */}
                                <div className="bg-white rounded-lg border border-gray-200 p-6">
                                    <div className="flex items-center justify-between mb-4">
                                        <div className="flex items-center gap-3">
                                            <div className="w-10 h-10 bg-white border border-gray-200 rounded-lg flex items-center justify-center">
                                                <svg width="20" height="20" viewBox="0 0 24 24">
                                                    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"/>
                                                    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                                                    <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                                                    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                                                </svg>
                                            </div>
                                            <div>
                                                <h2 className="text-lg font-semibold text-gray-900">Google Calendar</h2>
                                                <p className="text-xs text-gray-500">Requires Google Cloud Console OAuth 2.0 credentials</p>
                                            </div>
                                        </div>
                                        <label className="relative inline-flex items-center cursor-pointer">
                                            <input
                                                type="checkbox"
                                                checked={settings.google_enabled}
                                                onChange={e => setSettings({ ...settings, google_enabled: e.target.checked })}
                                                className="sr-only peer"
                                            />
                                            <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                                        </label>
                                    </div>

                                    <div className="space-y-4">
                                        <div>
                                            <label className="block text-sm font-medium text-gray-700 mb-1">Client ID</label>
                                            <input
                                                type="text"
                                                value={settings.google_client_id}
                                                onChange={e => setSettings({ ...settings, google_client_id: e.target.value })}
                                                placeholder="123456789.apps.googleusercontent.com"
                                                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-sm font-medium text-gray-700 mb-1">Client Secret</label>
                                            <input
                                                type="password"
                                                value={settings.google_client_secret}
                                                onChange={e => setSettings({ ...settings, google_client_secret: e.target.value })}
                                                placeholder={settings.google_client_secret === '***' ? 'Secret is set (leave to keep)' : 'Enter client secret'}
                                                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                                            />
                                        </div>
                                    </div>

                                    <div className="mt-4 p-3 bg-blue-50 rounded-lg text-xs text-blue-800">
                                        <p className="font-medium mb-1">Setup instructions:</p>
                                        <ol className="list-decimal list-inside space-y-0.5">
                                            <li>Go to Google Cloud Console &gt; APIs &amp; Services &gt; Credentials</li>
                                            <li>Create OAuth 2.0 Client ID (Web application)</li>
                                            <li>Enable Google Calendar API</li>
                                            <li>Set redirect URI to: <code className="bg-blue-100 px-1 rounded">{API_URL}/api/calendar/callback/google</code></li>
                                        </ol>
                                    </div>
                                </div>

                                {/* Microsoft Calendar */}
                                <div className="bg-white rounded-lg border border-gray-200 p-6">
                                    <div className="flex items-center justify-between mb-4">
                                        <div className="flex items-center gap-3">
                                            <div className="w-10 h-10 bg-white border border-gray-200 rounded-lg flex items-center justify-center">
                                                <svg width="20" height="20" viewBox="0 0 23 23">
                                                    <rect fill="#F25022" x="1" y="1" width="10" height="10"/>
                                                    <rect fill="#7FBA00" x="12" y="1" width="10" height="10"/>
                                                    <rect fill="#00A4EF" x="1" y="12" width="10" height="10"/>
                                                    <rect fill="#FFB900" x="12" y="12" width="10" height="10"/>
                                                </svg>
                                            </div>
                                            <div>
                                                <h2 className="text-lg font-semibold text-gray-900">Microsoft Outlook</h2>
                                                <p className="text-xs text-gray-500">Requires Azure App Registration credentials</p>
                                            </div>
                                        </div>
                                        <label className="relative inline-flex items-center cursor-pointer">
                                            <input
                                                type="checkbox"
                                                checked={settings.microsoft_enabled}
                                                onChange={e => setSettings({ ...settings, microsoft_enabled: e.target.checked })}
                                                className="sr-only peer"
                                            />
                                            <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                                        </label>
                                    </div>

                                    <div className="space-y-4">
                                        <div>
                                            <label className="block text-sm font-medium text-gray-700 mb-1">Application (Client) ID</label>
                                            <input
                                                type="text"
                                                value={settings.microsoft_client_id}
                                                onChange={e => setSettings({ ...settings, microsoft_client_id: e.target.value })}
                                                placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                                                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-sm font-medium text-gray-700 mb-1">Client Secret</label>
                                            <input
                                                type="password"
                                                value={settings.microsoft_client_secret}
                                                onChange={e => setSettings({ ...settings, microsoft_client_secret: e.target.value })}
                                                placeholder={settings.microsoft_client_secret === '***' ? 'Secret is set (leave to keep)' : 'Enter client secret'}
                                                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-sm font-medium text-gray-700 mb-1">Tenant ID</label>
                                            <input
                                                type="text"
                                                value={settings.microsoft_tenant_id}
                                                onChange={e => setSettings({ ...settings, microsoft_tenant_id: e.target.value })}
                                                placeholder="common (for any Microsoft account)"
                                                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                                            />
                                            <p className="text-xs text-gray-400 mt-1">Use &quot;common&quot; to allow any Microsoft account, or your organization tenant ID to restrict access.</p>
                                        </div>
                                    </div>

                                    <div className="mt-4 p-3 bg-blue-50 rounded-lg text-xs text-blue-800">
                                        <p className="font-medium mb-1">Setup instructions:</p>
                                        <ol className="list-decimal list-inside space-y-0.5">
                                            <li>Go to Azure Portal &gt; App registrations &gt; New registration</li>
                                            <li>Add API permission: Microsoft Graph &gt; Calendars.ReadWrite</li>
                                            <li>Create a client secret under Certificates &amp; secrets</li>
                                            <li>Set redirect URI to: <code className="bg-blue-100 px-1 rounded">{API_URL}/api/calendar/callback/microsoft</code></li>
                                        </ol>
                                    </div>
                                </div>

                                {/* Save Button */}
                                <div className="flex justify-end">
                                    <button
                                        onClick={handleSave}
                                        disabled={saving}
                                        className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium disabled:opacity-50"
                                    >
                                        {saving ? 'Saving...' : 'Save Settings'}
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                </main>
            </div>
        </div>
    )
}
