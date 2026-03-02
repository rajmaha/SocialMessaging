'use client'

import { useState, useEffect } from 'react'
import { User, Save, X, Phone, Mail, MapPin, Calendar, Plus, Edit2, Globe } from 'lucide-react'
import axios from 'axios'
import { getAuthToken } from '@/lib/auth'
import { API_URL } from '@/lib/config'

const SOCIAL_PLATFORMS = ['Facebook', 'Instagram', 'Twitter/X', 'LinkedIn', 'WhatsApp', 'TikTok']

interface IndividualFormProps {
    initialData?: any
    onSuccess: (data: any) => void
    onCancel: () => void
}

export default function IndividualForm({ initialData, onSuccess, onCancel }: IndividualFormProps) {
    const [formData, setFormData] = useState({
        full_name: '',
        gender: '',
        dob: '',
        phone_numbers: [''],
        address: '',
        email: '',
        social_media: [] as { platform: string; url: string }[],
        is_active: 1
    })
    const [loading, setLoading] = useState(false)
    const [isReadOnly, setIsReadOnly] = useState(!!initialData)

    useEffect(() => {
        if (initialData) {
            setFormData({
                full_name: initialData.full_name || '',
                gender: initialData.gender || '',
                dob: initialData.dob || '',
                phone_numbers: initialData.phone_numbers?.length > 0 ? initialData.phone_numbers : [''],
                address: initialData.address || '',
                email: initialData.email || '',
                social_media: initialData.social_media?.length > 0 ? initialData.social_media : [],
                is_active: initialData.is_active ?? 1
            })
        }
    }, [initialData])

    // Phone number helpers
    const handlePhoneChange = (index: number, value: string) => {
        const newPhones = [...formData.phone_numbers]
        newPhones[index] = value
        setFormData({ ...formData, phone_numbers: newPhones })
    }

    const addPhone = () => {
        setFormData({ ...formData, phone_numbers: [...formData.phone_numbers, ''] })
    }

    const removePhone = (index: number) => {
        const newPhones = formData.phone_numbers.filter((_, i) => i !== index)
        setFormData({ ...formData, phone_numbers: newPhones.length > 0 ? newPhones : [''] })
    }

    // Social media helpers
    const addSocialMedia = () => {
        setFormData({
            ...formData,
            social_media: [...formData.social_media, { platform: '', url: '' }]
        })
    }

    const removeSocialMedia = (index: number) => {
        setFormData({
            ...formData,
            social_media: formData.social_media.filter((_, i) => i !== index)
        })
    }

    const handleSocialMediaChange = (index: number, field: 'platform' | 'url', value: string) => {
        const updated = [...formData.social_media]
        updated[index] = { ...updated[index], [field]: value }
        setFormData({ ...formData, social_media: updated })
    }

    const today = new Date().toISOString().split('T')[0]

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        if (loading) return

        if (!formData.full_name.trim()) {
            alert('Full Name is required.')
            return
        }
        if (!formData.gender) {
            alert('Gender is required.')
            return
        }

        if (!window.confirm('Are you sure you want to save these changes?')) {
            return
        }

        setLoading(true)
        try {
            const token = getAuthToken()
            const authHeader = token ? `Bearer ${token}` : ''

            const payload = {
                ...formData,
                phone_numbers: formData.phone_numbers.filter(p => p.trim() !== ''),
                social_media: formData.social_media.filter(s => s.platform && s.url.trim()),
                dob: formData.dob || null
            }

            let individualId = initialData?.id

            if (individualId) {
                await axios.put(`${API_URL}/individuals/${individualId}`, payload, {
                    headers: { Authorization: authHeader }
                })
            } else {
                const res = await axios.post(`${API_URL}/individuals/`, payload, {
                    headers: { Authorization: authHeader }
                })
                individualId = res.data.id
            }

            const finalRes = await axios.get(`${API_URL}/individuals/${individualId}`, {
                headers: { Authorization: authHeader }
            })
            onSuccess(finalRes.data)
            setIsReadOnly(true)
        } catch (error) {
            console.error('Error saving individual:', error)
            alert('Failed to save individual details')
        } finally {
            setLoading(false)
        }
    }

    return (
        <div className="space-y-6">
            {initialData && isReadOnly && (
                <div className="flex justify-end">
                    <button
                        type="button"
                        onClick={() => setIsReadOnly(false)}
                        className="flex items-center gap-2 px-4 py-2 bg-indigo-50 text-indigo-700 rounded-lg hover:bg-indigo-100 transition-colors font-semibold text-sm border border-indigo-100 shadow-sm"
                    >
                        <Edit2 className="w-4 h-4" />
                        Edit details
                    </button>
                </div>
            )}
            <form onSubmit={handleSubmit} className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {/* Left Side: Basic Info */}
                    <div className="space-y-4">
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1 leading-none">Full Name *</label>
                            <div className="relative">
                                <User className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4" />
                                <input
                                    required
                                    disabled={isReadOnly}
                                    type="text"
                                    className="w-full pl-10 pr-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none transition-all disabled:bg-gray-50 disabled:text-gray-500"
                                    placeholder="e.g. John Doe"
                                    value={formData.full_name}
                                    onChange={(e) => setFormData({ ...formData, full_name: e.target.value })}
                                />
                            </div>
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1 leading-none">Gender *</label>
                            <select
                                required
                                disabled={isReadOnly}
                                className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none disabled:bg-gray-50 disabled:text-gray-500"
                                value={formData.gender}
                                onChange={(e) => setFormData({ ...formData, gender: e.target.value })}
                            >
                                <option value="">Select gender...</option>
                                <option value="Male">Male</option>
                                <option value="Female">Female</option>
                                <option value="Other">Other</option>
                            </select>
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1 leading-none">Date of Birth</label>
                            <div className="relative">
                                <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4" />
                                <input
                                    disabled={isReadOnly}
                                    type="date"
                                    max={today}
                                    className="w-full pl-10 pr-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none transition-all disabled:bg-gray-50 disabled:text-gray-500"
                                    value={formData.dob}
                                    onChange={(e) => setFormData({ ...formData, dob: e.target.value })}
                                />
                            </div>
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1 leading-none">Email Address</label>
                            <div className="relative">
                                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4" />
                                <input
                                    disabled={isReadOnly}
                                    type="email"
                                    className="w-full pl-10 pr-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none transition-all disabled:bg-gray-50 disabled:text-gray-500"
                                    placeholder="john@example.com"
                                    value={formData.email}
                                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                                />
                            </div>
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1 leading-none">Status</label>
                            <select
                                disabled={isReadOnly}
                                className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none disabled:bg-gray-50 disabled:text-gray-500"
                                value={formData.is_active}
                                onChange={(e) => setFormData({ ...formData, is_active: parseInt(e.target.value) })}
                            >
                                <option value={1}>Active</option>
                                <option value={0}>Inactive</option>
                            </select>
                        </div>
                    </div>

                    {/* Right Side: Address, Phones, Social Media */}
                    <div className="space-y-4">
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1 leading-none">Address</label>
                            <div className="relative">
                                <MapPin className="absolute left-3 top-3 text-gray-400 w-4 h-4" />
                                <textarea
                                    disabled={isReadOnly}
                                    className="w-full pl-10 pr-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none min-h-[100px] disabled:bg-gray-50 disabled:text-gray-500"
                                    placeholder="Physical address"
                                    value={formData.address}
                                    onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                                />
                            </div>
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-2 leading-none">Phone Numbers</label>
                            <div className="space-y-2">
                                {formData.phone_numbers.map((phone, idx) => (
                                    <div key={idx} className="flex gap-2">
                                        <div className="relative flex-1">
                                            <Phone className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4" />
                                            <input
                                                disabled={isReadOnly}
                                                type="text"
                                                className="w-full pl-10 pr-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none disabled:bg-gray-50 disabled:text-gray-500"
                                                placeholder="Phone number"
                                                value={phone}
                                                onChange={(e) => handlePhoneChange(idx, e.target.value)}
                                            />
                                        </div>
                                        {!isReadOnly && (
                                            <button
                                                type="button"
                                                onClick={() => removePhone(idx)}
                                                className="p-2 text-gray-400 hover:text-red-500 transition-colors"
                                            >
                                                <X className="w-4 h-4" />
                                            </button>
                                        )}
                                    </div>
                                ))}
                                {!isReadOnly && (
                                    <button
                                        type="button"
                                        onClick={addPhone}
                                        className="text-sm text-indigo-600 hover:text-indigo-700 font-medium flex items-center gap-1"
                                    >
                                        <Plus className="w-3 h-3" />
                                        Add another number
                                    </button>
                                )}
                            </div>
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-2 leading-none">Social Media</label>
                            <div className="space-y-2">
                                {formData.social_media.map((entry, idx) => (
                                    <div key={idx} className="flex gap-2">
                                        <select
                                            disabled={isReadOnly}
                                            className="w-40 px-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none disabled:bg-gray-50 disabled:text-gray-500 text-sm"
                                            value={entry.platform}
                                            onChange={(e) => handleSocialMediaChange(idx, 'platform', e.target.value)}
                                        >
                                            <option value="">Platform...</option>
                                            {SOCIAL_PLATFORMS.map(p => (
                                                <option key={p} value={p}>{p}</option>
                                            ))}
                                        </select>
                                        <div className="relative flex-1">
                                            <Globe className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4" />
                                            <input
                                                disabled={isReadOnly}
                                                type="text"
                                                className="w-full pl-10 pr-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none disabled:bg-gray-50 disabled:text-gray-500 text-sm"
                                                placeholder="URL or handle"
                                                value={entry.url}
                                                onChange={(e) => handleSocialMediaChange(idx, 'url', e.target.value)}
                                            />
                                        </div>
                                        {!isReadOnly && (
                                            <button
                                                type="button"
                                                onClick={() => removeSocialMedia(idx)}
                                                className="p-2 text-gray-400 hover:text-red-500 transition-colors"
                                            >
                                                <X className="w-4 h-4" />
                                            </button>
                                        )}
                                    </div>
                                ))}
                                {!isReadOnly && (
                                    <button
                                        type="button"
                                        onClick={addSocialMedia}
                                        className="text-sm text-indigo-600 hover:text-indigo-700 font-medium flex items-center gap-1"
                                    >
                                        <Plus className="w-3 h-3" />
                                        Add social media
                                    </button>
                                )}
                                {formData.social_media.length === 0 && isReadOnly && (
                                    <p className="text-sm text-gray-400 italic">No social media accounts</p>
                                )}
                            </div>
                        </div>
                    </div>
                </div>

                <div className="flex justify-end gap-3 pt-6 border-t border-gray-100">
                    <button
                        type="button"
                        onClick={onCancel}
                        className="px-4 py-2 text-gray-700 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 font-medium transition-colors"
                    >
                        {isReadOnly ? 'Close' : 'Cancel'}
                    </button>
                    {!isReadOnly && (
                        <button
                            type="submit"
                            disabled={loading}
                            className="inline-flex items-center gap-2 bg-indigo-600 text-white px-6 py-2 rounded-lg hover:bg-indigo-700 transition-colors font-medium shadow-sm disabled:opacity-50"
                        >
                            <Save className="w-4 h-4" />
                            {loading ? 'Saving...' : 'Save Individual'}
                        </button>
                    )}
                </div>
            </form>
        </div>
    )
}
