'use client'

import { useState, useEffect } from 'react'
import { Plus, User, Mail, Phone, Trash2, Edit2, X, AlertCircle } from 'lucide-react'
import axios from 'axios'
import { getAuthToken } from '@/lib/auth'
import { API_URL } from '@/lib/config';

interface Contact {
    id: number
    full_name: string
    gender: string | null
    dob: string | null
    email: string | null
    phone_no: string[]
    designation: string | null
    address: string | null
    organization_id: number
}

interface ContactManagementProps {
    organizationId: number
}

export default function ContactManagement({ organizationId }: ContactManagementProps) {
    const [contacts, setContacts] = useState<Contact[]>([])
    const [loading, setLoading] = useState(true)
    const [isModalOpen, setIsModalOpen] = useState(false)
    const [currentContact, setCurrentContact] = useState<Partial<Contact> | null>(null)
    const [saving, setSaving] = useState(false)
    const [orgDomain, setOrgDomain] = useState<string | null>(null)
    const [emailError, setEmailError] = useState<string | null>(null)
    const [isReadOnly, setIsReadOnly] = useState(false)

    useEffect(() => {
        fetchContacts()
        fetchOrgDomain()
    }, [organizationId])

    const fetchOrgDomain = async () => {
        try {
            const token = getAuthToken()
            const authHeader = token ? `Bearer ${token}` : ''
            const res = await axios.get(`${API_URL}/organizations/${organizationId}`, {
                headers: { Authorization: authHeader }
            })
            setOrgDomain(res.data.domain_name || null)
        } catch (error) {
            console.error('Error fetching org domain:', error)
        }
    }

    const fetchContacts = async () => {
        try {
            setLoading(true)
            const token = getAuthToken()
            const authHeader = token ? `Bearer ${token}` : ''
            const res = await axios.get(`${API_URL}/organizations/${organizationId}/contacts`, {
                headers: { Authorization: authHeader }
            })
            setContacts(res.data)
        } catch (error) {
            console.error('Error fetching contacts:', error)
        } finally {
            setLoading(false)
        }
    }

    const handleOpenModal = (contact: Contact | null = null) => {
        if (contact) {
            setCurrentContact({ ...contact })
            setIsReadOnly(true)
        } else {
            setCurrentContact({
                full_name: '',
                gender: '',
                dob: null,
                email: '',
                phone_no: [''],
                designation: '',
                address: '',
                organization_id: organizationId
            })
            setIsReadOnly(false)
        }
        setEmailError(null)
        setIsModalOpen(true)
    }

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        if (!currentContact) return

        if (!window.confirm('Are you sure you want to save these changes?')) {
            return
        }

        // Validate email domain if org domain exists
        if (currentContact.email && orgDomain) {
            const emailDomain = currentContact.email.split('@')[1]?.toLowerCase()
            if (emailDomain !== orgDomain.toLowerCase()) {
                setEmailError(`Email must belong to the organization's domain: ${orgDomain}`)
                return
            }
        }

        setEmailError(null)
        setSaving(true)
        try {
            const token = getAuthToken()
            const authHeader = token ? `Bearer ${token}` : ''

            // Filter empty phone numbers
            const filteredPhones = currentContact.phone_no?.filter(p => p.trim() !== '') || []
            const payload = { ...currentContact, phone_no: filteredPhones }

            if (currentContact.id) {
                await axios.put(`${API_URL}/organizations/contacts/${currentContact.id}`, payload, {
                    headers: { Authorization: authHeader }
                })
            } else {
                await axios.post(`${API_URL}/organizations/${organizationId}/contacts`, payload, {
                    headers: { Authorization: authHeader }
                })
            }
            setIsModalOpen(false)
            fetchContacts()
        } catch (error) {
            console.error('Error saving contact:', error)
            alert('Failed to save contact')
        } finally {
            setSaving(false)
        }
    }

    const handleDelete = async (id: number) => {
        if (!confirm('Are you sure you want to delete this contact?')) return
        try {
            const token = getAuthToken()
            const authHeader = token ? `Bearer ${token}` : ''
            await axios.delete(`${API_URL}/organizations/contacts/${id}`, {
                headers: { Authorization: authHeader }
            })
            fetchContacts()
        } catch (error) {
            console.error('Error deleting contact:', error)
        }
    }

    const handlePhoneChange = (idx: number, val: string) => {
        const newPhones = [...(currentContact?.phone_no || [])]
        newPhones[idx] = val
        setCurrentContact({ ...currentContact!, phone_no: newPhones })
    }

    const addPhone = () => {
        setCurrentContact({
            ...currentContact!,
            phone_no: [...(currentContact?.phone_no || []), '']
        })
    }

    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center">
                <h2 className="text-xl font-bold text-gray-900">Manage Contacts</h2>
                <button
                    onClick={() => handleOpenModal()}
                    className="flex items-center gap-2 bg-indigo-600 text-white px-4 py-2 rounded-xl hover:bg-indigo-700 transition-all shadow-md shadow-indigo-100 font-semibold text-sm"
                >
                    <Plus className="w-4 h-4" />
                    New Contact
                </button>
            </div>

            {loading ? (
                <div className="flex justify-center py-10">
                    <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-indigo-600"></div>
                </div>
            ) : contacts.length > 0 ? (
                <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
                    <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse">
                            <thead>
                                <tr className="bg-gray-50/50 border-b border-gray-100">
                                    <th className="px-6 py-4 text-xs font-bold text-gray-500 uppercase tracking-wider">Name / Designation</th>
                                    <th className="px-6 py-4 text-xs font-bold text-gray-500 uppercase tracking-wider">Contact Info</th>
                                    <th className="px-6 py-4 text-xs font-bold text-gray-500 uppercase tracking-wider text-right">Actions</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-50 bg-white">
                                {contacts.map((contact) => (
                                    <tr key={contact.id} className="hover:bg-gray-50 transition-colors">
                                        <td className="px-6 py-4">
                                            <div className="font-semibold text-gray-900">{contact.full_name}</div>
                                            <div className="text-xs text-gray-500">{contact.designation || 'No designation'}</div>
                                        </td>
                                        <td className="px-6 py-4">
                                            <div className="flex flex-col gap-1">
                                                <div className="flex items-center gap-2 text-sm text-gray-600">
                                                    <Mail className="w-3 h-3" />
                                                    {contact.email || 'N/A'}
                                                </div>
                                                <div className="flex items-center gap-2 text-sm text-gray-600">
                                                    <Phone className="w-3 h-3" />
                                                    {contact.phone_no?.[0] || 'N/A'}
                                                </div>
                                            </div>
                                        </td>
                                        <td className="px-6 py-4 text-right">
                                            <div className="flex justify-end gap-2">
                                                <button onClick={() => handleOpenModal(contact)} className="p-1.5 text-gray-400 hover:text-indigo-600 transition-colors">
                                                    <Edit2 className="w-4 h-4" />
                                                </button>
                                                <button onClick={() => handleDelete(contact.id)} className="p-1.5 text-gray-400 hover:text-red-500 transition-colors">
                                                    <Trash2 className="w-4 h-4" />
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            ) : (
                <div className="text-center py-10 bg-gray-50 rounded-xl border-2 border-dashed border-gray-100">
                    <User className="w-8 h-8 text-gray-300 mx-auto mb-2" />
                    <p className="text-sm text-gray-500">No contacts added yet</p>
                </div>
            )}

            {/* Contact Modal */}
            {isModalOpen && currentContact && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
                    <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden animate-in fade-in zoom-in duration-200">
                        <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center bg-gray-50/30">
                            <h3 className="text-lg font-bold text-gray-900 flex items-center gap-2">
                                {currentContact.id ? (isReadOnly ? 'Contact Details' : 'Edit Contact') : 'New Contact'}
                            </h3>
                            <div className="flex items-center gap-2">
                                {currentContact.id && isReadOnly && (
                                    <button
                                        onClick={() => setIsReadOnly(false)}
                                        className="p-2 text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors"
                                        title="Edit Contact"
                                    >
                                        <Edit2 className="w-4 h-4" />
                                    </button>
                                )}
                                <button onClick={() => setIsModalOpen(false)} className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg">
                                    <X className="w-5 h-5" />
                                </button>
                            </div>
                        </div>
                        <form onSubmit={handleSubmit} className="p-6 space-y-4 max-h-[70vh] overflow-y-auto">
                            <div className="grid grid-cols-2 gap-4">
                                <div className="col-span-2">
                                    <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-1">Full Name *</label>
                                    <input
                                        required
                                        disabled={isReadOnly}
                                        type="text"
                                        className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none disabled:bg-gray-50 disabled:text-gray-500"
                                        value={currentContact.full_name || ''}
                                        onChange={(e) => setCurrentContact({ ...currentContact, full_name: e.target.value })}
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-1">Designation</label>
                                    <input
                                        disabled={isReadOnly}
                                        type="text"
                                        className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none disabled:bg-gray-50 disabled:text-gray-500"
                                        value={currentContact.designation || ''}
                                        onChange={(e) => setCurrentContact({ ...currentContact, designation: e.target.value })}
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-1">Gender</label>
                                    <select
                                        disabled={isReadOnly}
                                        className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none disabled:bg-gray-50 disabled:text-gray-500"
                                        value={currentContact.gender || ''}
                                        onChange={(e) => setCurrentContact({ ...currentContact, gender: e.target.value })}
                                    >
                                        <option value="">Select Gender</option>
                                        <option value="Male">Male</option>
                                        <option value="Female">Female</option>
                                        <option value="Other">Other</option>
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-1">Email</label>
                                    <input
                                        disabled={isReadOnly}
                                        type="email"
                                        className={`w-full px-4 py-2 border rounded-lg focus:ring-2 outline-none disabled:bg-gray-50 disabled:text-gray-500 ${emailError ? 'border-red-500 focus:ring-red-500' : 'border-gray-200 focus:ring-indigo-500'}`}
                                        value={currentContact.email || ''}
                                        onChange={(e) => {
                                            setCurrentContact({ ...currentContact, email: e.target.value })
                                            if (emailError) setEmailError(null)
                                        }}
                                    />
                                    {emailError && (
                                        <div className="flex items-center gap-1 text-[10px] text-red-600 mt-1">
                                            <AlertCircle className="w-3 h-3" />
                                            {emailError}
                                        </div>
                                    )}
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-1">DOB</label>
                                    <input
                                        disabled={isReadOnly}
                                        type="date"
                                        className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none disabled:bg-gray-50 disabled:text-gray-500"
                                        value={currentContact.dob || ''}
                                        onChange={(e) => setCurrentContact({ ...currentContact, dob: e.target.value })}
                                    />
                                </div>
                            </div>

                            <div className="space-y-2">
                                <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-1">Phone Numbers</label>
                                {(currentContact.phone_no || ['']).map((phone, idx) => (
                                    <div key={idx} className="flex gap-2">
                                        <input
                                            disabled={isReadOnly}
                                            type="text"
                                            className="flex-1 px-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none disabled:bg-gray-50 disabled:text-gray-500"
                                            value={phone}
                                            onChange={(e) => handlePhoneChange(idx, e.target.value)}
                                        />
                                        {!isReadOnly && (
                                            <button type="button" onClick={() => {
                                                const newPhones = currentContact.phone_no?.filter((_, i) => i !== idx) || []
                                                setCurrentContact({ ...currentContact, phone_no: newPhones.length ? newPhones : [''] })
                                            }} className="p-2 text-gray-400 hover:text-red-500">
                                                <Trash2 className="w-4 h-4" />
                                            </button>
                                        )}
                                    </div>
                                ))}
                                {!isReadOnly && (
                                    <button type="button" onClick={addPhone} className="text-xs text-indigo-600 font-medium">+ Add Phone</button>
                                )}
                            </div>

                            <div>
                                <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-1">Address</label>
                                <textarea
                                    disabled={isReadOnly}
                                    className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none min-h-[80px] disabled:bg-gray-50 disabled:text-gray-500"
                                    value={currentContact.address || ''}
                                    onChange={(e) => setCurrentContact({ ...currentContact, address: e.target.value })}
                                />
                            </div>

                            <div className="pt-4 flex justify-end gap-3 border-t border-gray-100">
                                <button
                                    type="button"
                                    onClick={() => setIsModalOpen(false)}
                                    className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg transition-colors font-medium"
                                >
                                    {isReadOnly ? 'Close' : 'Cancel'}
                                </button>
                                {!isReadOnly && (
                                    <button
                                        type="submit"
                                        disabled={saving}
                                        className="bg-indigo-600 text-white px-6 py-2 rounded-lg hover:bg-indigo-700 transition-colors font-medium disabled:opacity-50"
                                    >
                                        {saving ? 'Saving...' : 'Save Contact'}
                                    </button>
                                )}
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    )
}
