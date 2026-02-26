'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import axios from 'axios'
import { getAuthToken } from '@/lib/auth'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

export default function CorsSettingsPage() {
    const router = useRouter()
    const [origins, setOrigins] = useState<string[]>([])
    const [newOrigin, setNewOrigin] = useState('')
    const [loading, setLoading] = useState(true)
    const [saving, setSaving] = useState(false)
    const [error, setError] = useState('')
    const [success, setSuccess] = useState('')

    useEffect(() => {
        fetchOrigins()
    }, [])

    const fetchOrigins = async () => {
        try {
            setLoading(true)
            const token = getAuthToken()
            const res = await axios.get(`${API_URL}/admin/cors`, {
                headers: { Authorization: `Bearer ${token}` }
            })
            setOrigins(res.data.origins || [])
        } catch (e: any) {
            setError('Failed to load CORS settings')
        } finally {
            setLoading(false)
        }
    }

    const saveOrigins = async (updated: string[]) => {
        try {
            setSaving(true)
            setError('')
            const token = getAuthToken()
            await axios.put(`${API_URL}/admin/cors`, { origins: updated }, {
                headers: { Authorization: `Bearer ${token}` }
            })
            setOrigins(updated)
            setSuccess('CORS settings saved! Restart the backend for changes to take full effect.')
            setTimeout(() => setSuccess(''), 5000)
        } catch (e: any) {
            setError('Failed to save CORS settings')
        } finally {
            setSaving(false)
        }
    }

    const addOrigin = () => {
        const trimmed = newOrigin.trim().toLowerCase().replace(/\/$/, '')
        if (!trimmed) return
        if (!trimmed.startsWith('http://') && !trimmed.startsWith('https://')) {
            setError('Origin must start with http:// or https://')
            return
        }
        if (origins.includes(trimmed)) {
            setError('This origin is already in the list.')
            return
        }
        setError('')
        const updated = [...origins, trimmed]
        setNewOrigin('')
        saveOrigins(updated)
    }

    const removeOrigin = (origin: string) => {
        saveOrigins(origins.filter(o => o !== origin))
    }

    const embedCode = `<!-- Chat Widget Embed Code -->
<script>
  window.__CHAT_WIDGET_CONFIG__ = {
    apiUrl: '${API_URL}',
    widgetColor: '#2563eb',
    greeting: 'Hello! How can we help you?'
  };
</script>
<script src="${API_URL}/widget.js" defer></script>`

    return (
        <div className="min-h-screen bg-gray-50 p-6">
            <div className="max-w-3xl mx-auto">
                {/* Header */}
                <div className="flex items-center gap-3 mb-6">
                    <button
                        onClick={() => router.back()}
                        className="p-2 rounded-lg hover:bg-gray-200 transition text-gray-600"
                    >
                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                        </svg>
                    </button>
                    <div>
                        <h1 className="text-2xl font-bold text-gray-900">CORS / Allowed Origins</h1>
                        <p className="text-sm text-gray-500">Control which websites can embed the chat widget</p>
                    </div>
                </div>

                {/* Info Banner */}
                <div className="bg-blue-50 border border-blue-200 rounded-2xl p-4 mb-6 flex gap-3 items-start">
                    <span className="text-2xl">🌐</span>
                    <div>
                        <p className="text-sm font-semibold text-blue-900">What is this?</p>
                        <p className="text-sm text-blue-700 mt-1">
                            When you embed the chat widget on a remote website (e.g., <code className="bg-blue-100 px-1 rounded">https://yourshop.com</code>),
                            the browser requires that the domain be explicitly whitelisted here. Add the exact origin (scheme + domain + port) of each site
                            that embeds your widget. <strong>http://localhost:3000</strong> is always allowed.
                        </p>
                    </div>
                </div>

                {success && (
                    <div className="bg-green-50 border border-green-200 text-green-800 px-4 py-3 rounded-xl mb-4 text-sm font-medium flex items-center gap-2">
                        <span>✅</span> {success}
                    </div>
                )}
                {error && (
                    <div className="bg-red-50 border border-red-200 text-red-800 px-4 py-3 rounded-xl mb-4 text-sm font-medium flex items-center gap-2">
                        <span>❌</span> {error}
                    </div>
                )}

                {/* Add Origin */}
                <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-5 mb-6">
                    <h2 className="text-sm font-bold text-gray-700 uppercase tracking-wider mb-3">Add Allowed Origin</h2>
                    <div className="flex gap-2">
                        <input
                            type="text"
                            value={newOrigin}
                            onChange={e => setNewOrigin(e.target.value)}
                            onKeyDown={e => e.key === 'Enter' && addOrigin()}
                            placeholder="https://yourshop.com"
                            className="flex-1 px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 shadow-sm"
                        />
                        <button
                            onClick={addOrigin}
                            disabled={saving || !newOrigin.trim()}
                            className="px-5 py-2.5 bg-blue-600 text-white rounded-xl hover:bg-blue-700 disabled:opacity-50 transition font-semibold text-sm shadow"
                        >
                            {saving ? 'Saving…' : '+ Add'}
                        </button>
                    </div>
                    <p className="text-xs text-gray-400 mt-2">Include scheme and port if non-standard, e.g. <code>https://shop.example.com</code> or <code>http://localhost:8080</code></p>
                </div>

                {/* Allowed Origins List */}
                <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-5 mb-6">
                    <h2 className="text-sm font-bold text-gray-700 uppercase tracking-wider mb-3">
                        Allowed Origins ({origins.length} custom + built-in localhost)
                    </h2>

                    {loading ? (
                        <div className="text-center py-8 text-gray-400">Loading…</div>
                    ) : origins.length === 0 ? (
                        <div className="text-center py-8 text-gray-400">
                            <p className="text-3xl mb-2">🔒</p>
                            <p className="text-sm">No custom origins added yet. Only localhost is allowed.</p>
                        </div>
                    ) : (
                        <ul className="divide-y divide-gray-100">
                            {origins.map(origin => (
                                <li key={origin} className="flex items-center justify-between py-3 gap-4">
                                    <div className="flex items-center gap-2">
                                        <span className="w-2 h-2 rounded-full bg-green-500 flex-shrink-0"></span>
                                        <span className="text-sm font-mono text-gray-800">{origin}</span>
                                    </div>
                                    <button
                                        onClick={() => removeOrigin(origin)}
                                        className="text-red-500 hover:text-red-700 transition text-xs font-semibold px-3 py-1 rounded-lg hover:bg-red-50"
                                    >
                                        Remove
                                    </button>
                                </li>
                            ))}
                        </ul>
                    )}

                    {/* Always-allowed (static) */}
                    <div className="mt-4 pt-4 border-t border-gray-100">
                        <p className="text-xs text-gray-400 font-semibold uppercase tracking-wider mb-2">Always Allowed (built-in)</p>
                        {['http://localhost:3000', 'http://localhost:3001', 'http://127.0.0.1:3000'].map(o => (
                            <div key={o} className="flex items-center gap-2 py-1">
                                <span className="w-2 h-2 rounded-full bg-gray-300 flex-shrink-0"></span>
                                <span className="text-xs font-mono text-gray-500">{o}</span>
                            </div>
                        ))}
                    </div>
                </div>

                {/* Embed Code */}
                <div className="bg-gray-900 rounded-2xl p-5 text-white">
                    <h2 className="text-sm font-bold uppercase tracking-wider mb-3 text-gray-300">📋 Chat Widget Embed Code</h2>
                    <p className="text-xs text-gray-400 mb-3">Copy and paste this into the <code>&lt;head&gt;</code> or <code>&lt;body&gt;</code> of your website:</p>
                    <pre className="bg-gray-800 rounded-xl p-4 text-xs text-green-300 overflow-x-auto whitespace-pre-wrap">{embedCode}</pre>
                    <button
                        onClick={() => {
                            navigator.clipboard.writeText(embedCode)
                                .then(() => setSuccess('Embed code copied!'))
                                .catch(() => { })
                        }}
                        className="mt-3 px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg text-xs text-white font-semibold transition flex items-center gap-2"
                    >
                        📋 Copy to Clipboard
                    </button>
                </div>
            </div>
        </div>
    )
}
