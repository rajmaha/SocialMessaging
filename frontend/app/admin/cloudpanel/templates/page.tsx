'use client'

import React, { useState, useEffect } from 'react'
import MainHeader from "@/components/MainHeader"
import AdminNav from '@/components/AdminNav'
import { authAPI } from "@/lib/auth"

export default function CloudPanelTemplatesPage() {
    const [isMounted, setIsMounted] = useState(false)
    const [user, setUser] = useState<any>(null)
    const [templates, setTemplates] = useState<{ name: string, has_files: boolean }[]>([])
    const [loading, setLoading] = useState(true)
    const [message, setMessage] = useState({ type: '', text: '' })

    const [uploading, setUploading] = useState(false)
    const [templateName, setTemplateName] = useState('')
    const [templateFile, setTemplateFile] = useState<File | null>(null)

    const fetchTemplates = async () => {
        setLoading(true)
        try {
            const res = await fetch('http://localhost:8000/cloudpanel/templates')
            if (res.ok) {
                const data = await res.json()
                setTemplates(data)
            }
        } catch (err) {
            console.error('Failed to fetch templates', err)
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => {
        setIsMounted(true)
        setUser(authAPI.getUser())
        fetchTemplates()
    }, [])

    const handleUpload = async (e: React.FormEvent) => {
        e.preventDefault()
        if (!templateName || !templateFile) {
            setMessage({ type: 'error', text: 'Please provide both name and ZIP file.' })
            return
        }

        const safeName = templateName.replace(/[^a-zA-Z0-9_-]/g, '')
        if (!safeName) {
            setMessage({ type: 'error', text: 'Invalid template name.' })
            return
        }

        setUploading(true)
        const formData = new FormData()
        formData.append('name', safeName)
        formData.append('file', templateFile)

        try {
            const res = await fetch('http://localhost:8000/cloudpanel/templates', {
                method: 'POST',
                body: formData
            })

            const data = await res.json()
            if (res.ok) {
                setMessage({ type: 'success', text: data.message })
                setTemplateName('')
                setTemplateFile(null)

                // Reset file input
                const fileInput = document.getElementById('templateZip') as HTMLInputElement
                if (fileInput) fileInput.value = ''

                fetchTemplates()
            } else {
                setMessage({ type: 'error', text: data.detail || 'Upload failed' })
            }
        } catch (err) {
            setMessage({ type: 'error', text: 'Network error during upload' })
        } finally {
            setUploading(false)
        }
    }

    const handleDelete = async (name: string) => {
        if (!confirm(`Are you sure you want to delete template '${name}'?`)) return

        try {
            const res = await fetch(`http://localhost:8000/cloudpanel/templates/${name}`, {
                method: 'DELETE'
            })
            if (res.ok) {
                setMessage({ type: 'success', text: `Template '${name}' deleted.` })
                fetchTemplates()
            } else {
                const data = await res.json()
                setMessage({ type: 'error', text: data.detail || 'Delete failed' })
            }
        } catch (err) {
            setMessage({ type: 'error', text: 'Network error during delete' })
        }
    }

    if (!isMounted) {
        return (
            <div className="ml-60 pt-14 min-h-screen bg-gray-50" />
        )
    }

    return (
        <div className="ml-60 pt-14 min-h-screen bg-gray-50">
            <MainHeader user={user!} />
            <AdminNav />
            <main className="w-full p-6">
                <h1 className="text-2xl font-bold text-gray-900 mb-6">Site Templates</h1>

                {message.text && (
                    <div className={`p-4 mb-6 rounded-md ${message.type === 'error' ? 'bg-red-100 text-red-700' :
                        message.type === 'success' ? 'bg-green-100 text-green-700' :
                            'bg-blue-100 text-blue-700'}`}>
                        {message.text}
                    </div>
                )}

                <div className="bg-white p-6 rounded-lg shadow border border-gray-100 mb-8">
                    <h2 className="text-xl font-bold mb-4">Upload New Template</h2>
                    <form onSubmit={handleUpload} className="space-y-4 max-w-lg">
                        <div>
                            <label className="block text-sm font-medium mb-1 text-gray-700">Template Name</label>
                            <input
                                required
                                type="text"
                                className="w-full p-2 border rounded"
                                value={templateName}
                                onChange={e => setTemplateName(e.target.value)}
                                placeholder="e.g. corporate_theme"
                            />
                            <p className="text-xs text-gray-500 mt-1">Alphanumeric, dashes, and underscores only</p>
                        </div>
                        <div>
                            <label className="block text-sm font-medium mb-1 text-gray-700">Template File (.zip)</label>
                            <input
                                required
                                id="templateZip"
                                type="file"
                                accept=".zip,application/zip"
                                className="w-full p-2 border rounded"
                                onChange={e => {
                                    if (e.target.files && e.target.files.length > 0) {
                                        setTemplateFile(e.target.files[0])
                                    } else {
                                        setTemplateFile(null)
                                    }
                                }}
                            />
                            <p className="text-xs text-gray-500 mt-1">The ZIP file should contain your HTML/PHP files. It will be extracted directly to the document root.</p>
                        </div>
                        <button
                            type="submit"
                            disabled={uploading}
                            className={`text-white px-6 py-2 rounded shadow font-medium ${uploading ? 'opacity-70 cursor-not-allowed' : 'hover:opacity-90'}`}
                            style={!uploading ? { backgroundColor: 'var(--button-primary)' } : { backgroundColor: 'var(--accent-color)', opacity: 0.5 }}
                        >
                            {uploading ? 'Uploading...' : 'Upload Template'}
                        </button>
                    </form>
                </div>

                <div className="bg-white p-6 rounded-lg shadow border border-gray-100">
                    <h2 className="text-xl font-bold mb-4">Available Templates</h2>
                    {loading ? (
                        <p>Loading templates...</p>
                    ) : templates.length === 0 ? (
                        <p className="text-gray-500">No templates available.</p>
                    ) : (
                        <ul className="space-y-3">
                            {templates.map(t => (
                                <li key={t.name} className="flex justify-between items-center p-4 bg-gray-50 border rounded-lg hover:bg-gray-100 transition">
                                    <div className="flex items-center">
                                        <span className="text-xl mr-3">📁</span>
                                        <strong className="text-gray-900">{t.name}</strong>
                                        {t.name !== 'default_site' && (
                                            <span className={`ml-4 text-xs font-semibold px-2 py-1 rounded-full ${t.has_files ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'}`}>
                                                {t.has_files ? 'Has Files' : 'Empty'}
                                            </span>
                                        )}
                                    </div>
                                    {t.name !== 'default_site' && (
                                        <button
                                            onClick={() => handleDelete(t.name)}
                                            className="text-red-600 hover:text-red-800 text-sm font-medium bg-red-50 hover:bg-red-100 px-3 py-1 rounded transition"
                                        >
                                            Delete
                                        </button>
                                    )}
                                    {t.name === 'default_site' && (
                                        <span className="text-xs text-gray-500 bg-gray-200 px-2 py-1 rounded-full font-medium flex items-center gap-2">
                                            System Built-in
                                            <span className={`text-xs ml-2 font-semibold px-2 py-1 rounded-full ${t.has_files ? 'bg-green-100 text-green-700 bg-opacity-50' : 'bg-yellow-100 text-yellow-700 bg-opacity-50'}`}>
                                                {t.has_files ? 'Has Files' : 'Empty'}
                                            </span>
                                        </span>
                                    )}
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
            </main>
        </div>
    )
}
