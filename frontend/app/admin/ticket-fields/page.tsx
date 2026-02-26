'use client';

import { useState, useEffect } from 'react';
import MainHeader from "@/components/MainHeader";
import AdminNav from '@/components/AdminNav';
import { authAPI, getAuthToken } from "@/lib/auth";
import { useRouter } from 'next/navigation';
import { Plus, Trash2, Edit2, Save, X, GripVertical } from 'lucide-react';

const APP_TYPES = [
    { id: 'cloud_hosting', label: 'Cloud Hosting' },
    { id: 'data_center', label: 'Data Center' },
    { id: 'banking', label: 'Banking' },
    { id: 'broker_investment', label: 'Broker / Investment Company' },
    { id: 'isp', label: 'Internet Service Provider' },
    { id: 'manpower', label: 'Manpower Company' },
    { id: 'hotels', label: 'Hotels / Resorts' },
    { id: 'apartments', label: 'Appartments / Colonies' },
    { id: 'warehouses', label: 'Wirehouses' },
    { id: 'hospitals', label: 'Hospitals / Nurshing Homes' }
];

export default function TicketFieldsConfig() {
    const user = authAPI.getUser();
    const router = useRouter();

    const [loading, setLoading] = useState(true);
    const [fields, setFields] = useState<any[]>([]);
    const [selectedAppType, setSelectedAppType] = useState('cloud_hosting');
    const [editingField, setEditingField] = useState<any | null>(null);

    // Form State
    const [fieldName, setFieldName] = useState('');
    const [fieldLabel, setFieldLabel] = useState('');
    const [fieldType, setFieldType] = useState('text');
    const [optionsStr, setOptionsStr] = useState('');
    const [isRequired, setIsRequired] = useState(false);
    const [displayOrder, setDisplayOrder] = useState(0);

    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');

    useEffect(() => {
        if (!user || user.role !== 'admin') {
            router.push('/login');
            return;
        }
        fetchFields();
    }, [selectedAppType]);

    const fetchFields = async () => {
        setLoading(true);
        try {
            const token = getAuthToken();
            const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/admin/dynamic-fields/${selectedAppType}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (res.ok) {
                const data = await res.json();
                setFields(data);
            }
        } catch (e) {
            console.error(e);
            setError("Failed to load fields.");
        } finally {
            setLoading(false);
        }
    };

    const resetForm = () => {
        setEditingField(null);
        setFieldName('');
        setFieldLabel('');
        setFieldType('text');
        setOptionsStr('');
        setIsRequired(false);
        setDisplayOrder(fields.length);
        setError('');
        setSuccess('');
    };

    const handleEdit = (field: any) => {
        setEditingField(field);
        setFieldName(field.field_name);
        setFieldLabel(field.field_label);
        setFieldType(field.field_type);
        setOptionsStr(field.options ? field.options.join(', ') : '');
        setIsRequired(field.is_required);
        setDisplayOrder(field.display_order);
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    const handleDelete = async (id: number) => {
        if (!confirm("Are you sure you want to delete this field? Data on existing tickets may not render correctly.")) return;

        try {
            const token = getAuthToken();
            const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/admin/dynamic-fields/${id}`, {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (res.ok) {
                setFields(fields.filter(f => f.id !== id));
            } else {
                setError("Failed to delete field.");
            }
        } catch (e) {
            setError("An error occurred");
        }
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        setSuccess('');

        // Generate a machine-friendly name if blank
        const finalName = fieldName.trim() || fieldLabel.toLowerCase().replace(/[^a-z0-9]/g, '_');

        const payload = {
            application_type: selectedAppType,
            field_name: finalName,
            field_label: fieldLabel,
            field_type: fieldType,
            options: (fieldType === 'select' || fieldType === 'checkbox') ? optionsStr.split(',').map(s => s.trim()).filter(s => s) : null,
            is_required: isRequired,
            display_order: Number(displayOrder)
        };

        try {
            const token = getAuthToken();
            const method = editingField ? 'PUT' : 'POST';
            const url = editingField
                ? `${process.env.NEXT_PUBLIC_API_URL}/admin/dynamic-fields/${editingField.id}`
                : `${process.env.NEXT_PUBLIC_API_URL}/admin/dynamic-fields`;

            const res = await fetch(url, {
                method,
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(payload)
            });

            if (res.ok) {
                setSuccess(editingField ? "Field updated successfully." : "Field added successfully.");
                fetchFields();
                resetForm();
            } else {
                const data = await res.json();
                setError(data.detail || "Failed to save field.");
            }
        } catch (e) {
            setError("An error occurred. Make sure your server is running.");
        }
    };

    if (!user) return null;

    return (
        <div className="min-h-screen bg-gray-50 flex flex-col">
            <MainHeader user={user} />

            <div className="flex-1 flex overflow-hidden pt-16">
                <AdminNav />

                <main className="flex-1 overflow-y-auto p-8">
                    <div className="max-w-4xl mx-auto space-y-6">

                        <div className="flex justify-between items-center">
                            <div>
                                <h1 className="text-2xl font-bold text-gray-900">Ticket Dynamic Fields</h1>
                                <p className="text-gray-500 mt-1">Configure custom form fields based on your industry Application Type.</p>
                            </div>
                        </div>

                        {/* Top Filters */}
                        <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-200">
                            <label className="block text-sm font-medium text-gray-700 mb-2">Select Application Type to Configure:</label>
                            <select
                                value={selectedAppType}
                                onChange={(e) => { setSelectedAppType(e.target.value); resetForm(); }}
                                className="w-full md:w-1/2 px-4 py-2 border border-gray-300 rounded-lg text-gray-900 focus:ring-indigo-500 focus:border-indigo-500"
                            >
                                {APP_TYPES.map(type => (
                                    <option key={type.id} value={type.id}>{type.label}</option>
                                ))}
                            </select>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">

                            {/* Editor Form */}
                            <div className="md:col-span-1 bg-white rounded-xl shadow-sm border border-gray-200 p-6 h-fit sticky top-6">
                                <h3 className="text-lg font-semibold text-gray-800 mb-4 pb-2 border-b">
                                    {editingField ? 'Edit Field' : 'Add New Field'}
                                </h3>

                                {error && <div className="mb-4 p-3 bg-red-50 text-red-700 text-sm rounded-lg">{error}</div>}
                                {success && <div className="mb-4 p-3 bg-green-50 text-green-700 text-sm rounded-lg">{success}</div>}

                                <form onSubmit={handleSubmit} className="space-y-4">
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-1">Field Label *</label>
                                        <input
                                            type="text" required
                                            value={fieldLabel} onChange={(e) => setFieldLabel(e.target.value)}
                                            placeholder="e.g. Room Number"
                                            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-indigo-500 text-gray-900"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-1">Internal Name (Optional)</label>
                                        <input
                                            type="text"
                                            value={fieldName} onChange={(e) => setFieldName(e.target.value)}
                                            placeholder="e.g. room_number"
                                            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-indigo-500 text-gray-900 bg-gray-50"
                                        />
                                        <p className="text-xs text-gray-500 mt-1">Leave blank to auto-generate</p>
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-1">Input Type *</label>
                                        <select
                                            value={fieldType} onChange={(e) => setFieldType(e.target.value)}
                                            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-indigo-500 text-gray-900"
                                        >
                                            <option value="text">Short Text</option>
                                            <option value="textarea">Paragraph Box</option>
                                            <option value="select">Dropdown Menu</option>
                                            <option value="checkbox">Checkbox options</option>
                                            <option value="date">Date Picker</option>
                                            <option value="time">Time Picker</option>
                                        </select>
                                    </div>

                                    {(fieldType === 'select' || fieldType === 'checkbox') && (
                                        <div>
                                            <label className="block text-sm font-medium text-gray-700 mb-1">Options (Comma separated) *</label>
                                            <input
                                                type="text" required
                                                value={optionsStr} onChange={(e) => setOptionsStr(e.target.value)}
                                                placeholder="e.g. Sales, Billing, Tech Support"
                                                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-indigo-500 text-gray-900"
                                            />
                                        </div>
                                    )}

                                    <div className="flex items-center gap-4">
                                        <div className="flex items-center">
                                            <input
                                                type="checkbox" id="isRequired"
                                                checked={isRequired}
                                                onChange={(e) => setIsRequired(e.target.checked)}
                                                className="w-4 h-4 text-indigo-600 rounded border-gray-300 focus:ring-indigo-500"
                                            />
                                            <label htmlFor="isRequired" className="ml-2 text-sm text-gray-700">Required</label>
                                        </div>
                                    </div>

                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-1">Display Order</label>
                                        <input
                                            type="number"
                                            value={displayOrder} onChange={(e) => setDisplayOrder(Number(e.target.value))}
                                            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-indigo-500 text-gray-900"
                                        />
                                    </div>

                                    <div className="pt-4 flex gap-3">
                                        <button type="submit" className="flex-1 bg-indigo-600 text-white py-2 rounded-lg hover:bg-indigo-700 font-medium text-sm flex justify-center items-center gap-2">
                                            <Save className="w-4 h-4" /> Save Field
                                        </button>
                                        {editingField && (
                                            <button type="button" onClick={resetForm} className="px-3 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200">
                                                <X className="w-4 h-4" />
                                            </button>
                                        )}
                                    </div>
                                </form>
                            </div>

                            {/* List View */}
                            <div className="md:col-span-2 bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                                <div className="p-4 border-b bg-gray-50">
                                    <h3 className="font-semibold text-gray-800">Assigned Fields ({fields.length})</h3>
                                </div>

                                {loading ? (
                                    <div className="p-8 text-center text-gray-500">Loading fields...</div>
                                ) : fields.length === 0 ? (
                                    <div className="p-12 text-center">
                                        <div className="w-12 h-12 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-3">
                                            <Plus className="w-6 h-6 text-gray-400" />
                                        </div>
                                        <h4 className="text-gray-900 font-medium">No custom fields yet</h4>
                                        <p className="text-gray-500 text-sm mt-1">Use the form to add input fields to the ticket creation form for this industry.</p>
                                    </div>
                                ) : (
                                    <ul className="divide-y divide-gray-100">
                                        {fields.map((field) => (
                                            <li key={field.id} className={`p-4 hover:bg-gray-50 transition flex items-start gap-4 ${editingField?.id === field.id ? 'bg-indigo-50 border-l-4 border-indigo-500' : ''}`}>
                                                <div className="text-gray-400 mt-1">
                                                    <GripVertical className="w-5 h-5" />
                                                </div>
                                                <div className="flex-1">
                                                    <div className="flex justify-between items-start">
                                                        <div>
                                                            <h4 className="font-medium text-gray-900 flex items-center gap-2">
                                                                {field.field_label}
                                                                {field.is_required && <span className="text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded-full font-semibold">Req</span>}
                                                                <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded tracking-wide border font-mono">
                                                                    {field.field_type}
                                                                </span>
                                                            </h4>
                                                            <p className="text-xs text-gray-500 font-mono mt-1">Key: {field.field_name}</p>
                                                            {(field.field_type === 'select' || field.field_type === 'checkbox') && field.options && (
                                                                <p className="text-sm text-gray-600 mt-2">
                                                                    <span className="font-medium">Options:</span> {field.options.join(', ')}
                                                                </p>
                                                            )}
                                                        </div>
                                                        <div className="flex gap-2">
                                                            <button
                                                                onClick={() => handleEdit(field)}
                                                                className="p-1.5 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded"
                                                            >
                                                                <Edit2 className="w-4 h-4" />
                                                            </button>
                                                            <button
                                                                onClick={() => handleDelete(field.id)}
                                                                className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded"
                                                            >
                                                                <Trash2 className="w-4 h-4" />
                                                            </button>
                                                        </div>
                                                    </div>
                                                </div>
                                            </li>
                                        ))}
                                    </ul>
                                )}
                            </div>

                        </div>
                    </div>
                </main>
            </div>
        </div>
    );
}
