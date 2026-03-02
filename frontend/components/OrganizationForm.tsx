'use client'

import { useState, useEffect } from 'react'
import { Building2, Save, X, Upload, Phone, Mail, MapPin, Hash, Plus, Edit2 } from 'lucide-react'
import axios from 'axios'
import { getAuthToken } from '@/lib/auth'
import { API_URL } from '@/lib/config';

interface OrganizationFormProps {
    initialData?: any
    onSuccess: (data: any) => void
    onCancel: () => void
}

export default function OrganizationForm({ initialData, onSuccess, onCancel }: OrganizationFormProps) {
    const [formData, setFormData] = useState({
        organization_name: '',
        address: '',
        pan_no: '',
        domain_name: '',
        contact_numbers: [''],
        email: '',
        is_active: 1
    })
    const [logoFile, setLogoFile] = useState<File | null>(null)
    const [logoPreview, setLogoPreview] = useState<string | null>(null)
    const [loading, setLoading] = useState(false)
    const [isReadOnly, setIsReadOnly] = useState(!!initialData)

    useEffect(() => {
        if (initialData) {
            setFormData({
                organization_name: initialData.organization_name || '',
                address: initialData.address || '',
                pan_no: initialData.pan_no || '',
                domain_name: initialData.domain_name || '',
                contact_numbers: initialData.contact_numbers?.length > 0 ? initialData.contact_numbers : [''],
                email: initialData.email || '',
                is_active: initialData.is_active ?? 1
            })
            if (initialData.logo_url) {
                setLogoPreview(`${API_URL}${initialData.logo_url}`)
            }
        }
    }, [initialData])

    const handlePhoneChange = (index: number, value: string) => {
        const newPhones = [...formData.contact_numbers]
        newPhones[index] = value
        setFormData({ ...formData, contact_numbers: newPhones })
    }

    const addPhone = () => {
        setFormData({ ...formData, contact_numbers: [...formData.contact_numbers, ''] })
    }

    const removePhone = (index: number) => {
        const newPhones = formData.contact_numbers.filter((_, i) => i !== index)
        setFormData({ ...formData, contact_numbers: newPhones.length > 0 ? newPhones : [''] })
    }

    const handleLogoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            const file = e.target.files[0]
            setLogoFile(file)
            setLogoPreview(URL.createObjectURL(file))
        }
    }

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        if (loading) return

        if (!window.confirm('Are you sure you want to save these changes?')) {
            return
        }

        setLoading(true)
        try {
            const token = getAuthToken()
            const authHeader = token ? `Bearer ${token}` : ''

            let orgId = initialData?.id
            const payload = {
                ...formData,
                contact_numbers: formData.contact_numbers.filter(p => p.trim() !== '')
            }

            if (orgId) {
                await axios.put(`${API_URL}/organizations/${orgId}`, payload, {
                    headers: { Authorization: authHeader }
                })
            } else {
                const res = await axios.post(`${API_URL}/organizations/`, payload, {
                    headers: { Authorization: authHeader }
                })
                orgId = res.data.id
            }

            if (logoFile) {
                const logoData = new FormData()
                logoData.append('file', logoFile)
                await axios.post(`${API_URL}/organizations/${orgId}/logo`, logoData, {
                    headers: {
                        Authorization: authHeader,
                        'Content-Type': 'multipart/form-data'
                    }
                })
            }

            const finalRes = await axios.get(`${API_URL}/organizations/${orgId}`, {
                headers: { Authorization: authHeader }
            })
            onSuccess(finalRes.data)
            setIsReadOnly(true)
        } catch (error) {
            console.error('Error saving organization:', error)
            alert('Failed to save organization details')
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
                            <label className="block text-sm font-medium text-gray-700 mb-1 leading-none">Organization Name *</label>
                            <div className="relative">
                                <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4" />
                                <input
                                    required
                                    disabled={isReadOnly}
                                    type="text"
                                    className="w-full pl-10 pr-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none transition-all disabled:bg-gray-50 disabled:text-gray-500"
                                    placeholder="e.g. Acme Corp"
                                    value={formData.organization_name}
                                    onChange={(e) => setFormData({ ...formData, organization_name: e.target.value })}
                                />
                            </div>
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1 leading-none">PAN Number</label>
                            <div className="relative">
                                <Hash className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4" />
                                <input
                                    disabled={isReadOnly}
                                    type="text"
                                    className="w-full pl-10 pr-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none transition-all disabled:bg-gray-50 disabled:text-gray-500"
                                    placeholder="Tax ID / PAN"
                                    value={formData.pan_no}
                                    onChange={(e) => setFormData({ ...formData, pan_no: e.target.value })}
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
                                    placeholder="info@company.com"
                                    value={formData.email}
                                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                                />
                            </div>
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1 leading-none">Organization Domain (for Email Validation)</label>
                            <div className="relative">
                                <Hash className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4" />
                                <input
                                    disabled={isReadOnly}
                                    type="text"
                                    className="w-full pl-10 pr-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none transition-all disabled:bg-gray-50 disabled:text-gray-500"
                                    placeholder="e.g. acme.com (used to validate contact emails)"
                                    value={formData.domain_name}
                                    onChange={(e) => setFormData({ ...formData, domain_name: e.target.value })}
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

                    {/* Right Side: Logo & Contacts */}
                    <div className="space-y-4">
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1 leading-none">Logo</label>
                            <div className="flex items-center gap-4">
                                <div className="w-24 h-24 rounded-xl border-2 border-dashed border-gray-200 flex items-center justify-center overflow-hidden bg-gray-50">
                                    {logoPreview ? (
                                        <img src={logoPreview} alt="Logo preview" className="w-full h-full object-contain" />
                                    ) : (
                                        <Building2 className="w-8 h-8 text-gray-300" />
                                    )}
                                </div>
                                {!isReadOnly && (
                                    <label className="cursor-pointer bg-white border border-gray-200 px-4 py-2 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 flex items-center gap-2">
                                        <Upload className="w-4 h-4 text-gray-500" />
                                        Upload Logo
                                        <input type="file" className="hidden" accept="image/*" onChange={handleLogoChange} />
                                    </label>
                                )}
                            </div>
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1 leading-none">Address</label>
                            <div className="relative">
                                <MapPin className="absolute left-3 top-3 text-gray-400 w-4 h-4" />
                                <textarea
                                    disabled={isReadOnly}
                                    className="w-full pl-10 pr-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none min-h-[100px] disabled:bg-gray-50 disabled:text-gray-500"
                                    placeholder="Company physical address"
                                    value={formData.address}
                                    onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                                />
                            </div>
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-2 leading-none">Contact Numbers</label>
                            <div className="space-y-2">
                                {formData.contact_numbers.map((phone, idx) => (
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
                            {loading ? 'Saving...' : 'Save Organization'}
                        </button>
                    )}
                </div>
            </form>
        </div>
    )
}
