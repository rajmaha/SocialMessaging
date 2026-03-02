import { useState, useEffect } from 'react';
import { getAuthToken } from "@/lib/auth";
import { API_URL } from '@/lib/config';

export default function TicketForm({
    activeNumber,
    appType,
    onTicketSaved,
    parentTicketId = null,
    onContextChange,
    callerContext,
    onEndCall
}: {
    activeNumber: string;
    appType: string;
    onTicketSaved: () => void;
    parentTicketId?: number | null;
    onContextChange?: (context: { found: boolean, caller_name?: string, organization_name?: string, organization_id?: number | null }) => void;
    callerContext?: any;
    onEndCall?: () => void;
}) {
    const [saving, setSaving] = useState(false);

    // Core Fields
    const [status, setStatus] = useState('pending');
    const [priority, setPriority] = useState('normal');
    const [customerName, setCustomerName] = useState('');
    const [customerGender, setCustomerGender] = useState('');
    const [category, setCategory] = useState('');
    const [forwardTarget, setForwardTarget] = useState('');
    const [forwardReason, setForwardReason] = useState('');
    const [organizationId, setOrganizationId] = useState<number | null>(null);
    const [customerType, setCustomerType] = useState('');
    const [contactPerson, setContactPerson] = useState('');
    const [customerEmail, setCustomerEmail] = useState('');

    // Success Tracking
    const [lastSavedTicket, setLastSavedTicket] = useState<any | null>(null);

    // Manual Linking Fallback
    const [showManualLink, setShowManualLink] = useState(false);
    const [manualTicketNo, setManualTicketNo] = useState('');

    // Dynamic Admin Fields Configuration & State
    const [dynamicFields, setDynamicFields] = useState<any[]>([]);
    const [appData, setAppData] = useState<Record<string, any>>({});
    const [loadingFields, setLoadingFields] = useState(true);

    // Linking History 
    const [history, setHistory] = useState<any[]>([]);
    const [selectedParentId, setSelectedParentId] = useState<number | ''>(parentTicketId || '');

    // Sync prop changes
    useEffect(() => {
        if (parentTicketId) {
            setSelectedParentId(parentTicketId);
        }
    }, [parentTicketId]);

    // Fetch History for linking
    useEffect(() => {
        if (!activeNumber) return;
        const fetchHistory = async () => {
            try {
                const token = getAuthToken();
                const res = await fetch(`${API_URL}/api/tickets/history/${activeNumber}`, {
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                if (res.ok) {
                    const data = await res.json();
                    setHistory(data);
                }
            } catch (e) {
                console.error("Failed to load history", e);
            }
        };
        fetchHistory();
    }, [activeNumber]);

    // Load Fields Definition from Admin Backend
    useEffect(() => {
        if (!appType) return;
        const fetchFields = async () => {
            setLoadingFields(true);
            try {
                const token = getAuthToken();
                const res = await fetch(`${API_URL}/api/admin/dynamic-fields/${appType}`, {
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                if (res.ok) {
                    const data = await res.json();
                    setDynamicFields(data);

                    // Initialize appData with defaults based on type
                    const defaultData: Record<string, any> = {};
                    data.forEach((f: any) => {
                        if (f.field_type === 'checkbox') {
                            defaultData[f.field_name] = [];
                        } else {
                            defaultData[f.field_name] = '';
                        }
                    });
                    setAppData(defaultData);
                }
            } catch (e) {
                console.error("Failed to map dynamic fields", e);
            } finally {
                setLoadingFields(false);
            }
        };
        fetchFields();
    }, [appType]);

    // Reset Core State when phone number changes and fetch context
    useEffect(() => {
        setStatus('pending');
        setPriority('normal');
        setCustomerName('');
        setCustomerGender('');
        setCategory('');
        setForwardTarget('');
        setForwardReason('');
        setOrganizationId(null);
        setCustomerType('');
        setContactPerson('');
        setCustomerEmail('');
        if (onContextChange) onContextChange({ found: false });
        if (!parentTicketId) setSelectedParentId('');

        // Reset dynamic data arrays/strings
        setAppData(prev => {
            const reset = { ...prev };
            Object.keys(reset).forEach(k => {
                reset[k] = Array.isArray(reset[k]) ? [] : '';
            });
            return reset;
        });

        // Auto-fetch context from number
        if (activeNumber) {
            const fetchContext = async () => {
                try {
                    const token = getAuthToken();
                    const res = await fetch(`${API_URL}/api/tickets/context/${encodeURIComponent(activeNumber)}`, {
                        headers: { 'Authorization': `Bearer ${token}` }
                    });
                    if (res.ok) {
                        const data = await res.json();
                        if (onContextChange) {
                            onContextChange(data);
                        }
                        if (data.found) {
                            if (data.organization_id) setOrganizationId(data.organization_id);
                            if (data.customer_type) setCustomerType(data.customer_type);
                            if (data.customer_name) setCustomerName(data.customer_name);
                            if (data.contact_person) setContactPerson(data.contact_person);
                            if (data.gender) setCustomerGender(data.gender);
                            if (data.email) setCustomerEmail(data.email);

                            // Fallback for legacy: if no customer_name but has caller_name
                            if (!data.customer_name && data.caller_name && data.caller_name !== "Valued Customer") {
                                setCustomerName(data.caller_name);
                            }
                        }
                    }
                } catch (e) {
                    console.error("Failed to load caller context", e);
                }
            };
            fetchContext();
        }
    }, [activeNumber]);

    const handleDynamicFieldChange = (fieldName: string, value: any) => {
        setAppData(prev => ({ ...prev, [fieldName]: value }));
    };

    const handleCheckboxToggle = (fieldName: string, option: string, checked: boolean) => {
        setAppData(prev => {
            const current = Array.isArray(prev[fieldName]) ? prev[fieldName] : [];
            const updated = checked
                ? [...current, option]
                : current.filter((v: string) => v !== option);
            return { ...prev, [fieldName]: updated };
        });
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        // Validation for required fields
        const missing = dynamicFields.filter(f => f.is_required && !appData[f.field_name]);
        if (missing.length > 0) {
            alert(`Please complete the required fields: ${missing.map(f => f.field_label).join(', ')}`);
            return;
        }

        if (status === 'forwarded' && (!forwardTarget || !forwardReason)) {
            alert("Please provide the Forward Target and Reason.");
            return;
        }

        let finalParentId: number | null = selectedParentId || null;

        // If manual link is provided, we need to resolve it or just send it?
        // Actually the backend expects parent_ticket_id (int). 
        // We might need to fetch the ID for that manual number first.
        if (showManualLink && manualTicketNo) {
            try {
                const token = getAuthToken();
                const res = await fetch(`${API_URL}/api/tickets/find?number=${manualTicketNo}`, {
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                if (res.ok) {
                    const found = await res.json();
                    finalParentId = found.id;
                } else {
                    alert("Manual Ticket Number not found. Please verify.");
                    return;
                }
            } catch (e) {
                console.error(e);
            }
        }

        setSaving(true);
        try {
            const token = getAuthToken();
            const response = await fetch(`${API_URL}/api/tickets`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    phone_number: activeNumber,
                    customer_name: customerName,
                    customer_gender: customerGender,
                    customer_type: customerType,
                    contact_person: contactPerson,
                    customer_email: customerEmail,
                    category: category,
                    forward_target: forwardTarget,
                    forward_reason: forwardReason,
                    status: status,
                    priority: priority,
                    app_type_data: appData,
                    parent_ticket_id: finalParentId,
                    organization_id: organizationId
                })
            });
            if (response.ok) {
                const newTicket = await response.json();
                onTicketSaved();
                setLastSavedTicket(newTicket);
            } else {
                alert('Failed to save ticket');
            }
        } catch (err) {
            console.error(err);
        } finally {
            setSaving(false);
        }
    };

    const resetForm = () => {
        setLastSavedTicket(null);
        setCustomerName('');
        setCustomerGender('');
        setCustomerType('');
        setContactPerson('');
        setCustomerEmail('');
        setForwardTarget('');
        setForwardReason('');
        setCategory('');
        setManualTicketNo('');
        setShowManualLink(false);
        setSelectedParentId('');
        setOrganizationId(null);
        if (onContextChange) onContextChange({ found: false });
        // Dynamic reset logic is already in the useEffect, but we'll trigger a refresh
        setAppData(prev => {
            const reset = { ...prev };
            Object.keys(reset).forEach(k => {
                reset[k] = Array.isArray(reset[k]) ? [] : '';
            });
            return reset;
        });
    };

    if (lastSavedTicket) {
        return (
            <div className="bg-white border border-green-100 shadow-xl rounded-2xl p-8 h-full flex flex-col items-center justify-center text-center">
                <div className="w-20 h-20 bg-green-50 text-green-500 rounded-full flex items-center justify-center mb-6 animate-bounce">
                    <svg className="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7"></path>
                    </svg>
                </div>
                <h3 className="text-2xl font-bold text-gray-900 mb-2">Ticket Successfully Created!</h3>
                <p className="text-gray-500 mb-8 max-w-sm">The ticket has been logged and assigned. Please provide the reference number below to the caller.</p>

                <div className="bg-gray-50 border-2 border-dashed border-indigo-200 rounded-2xl p-6 mb-8 w-full max-w-sm relative group">
                    <span className="text-xs font-bold text-indigo-400 uppercase tracking-widest absolute -top-3 left-1/2 -translate-x-1/2 bg-white px-3 border border-indigo-100 rounded-full">Reference Number</span>
                    <h4 className="text-3xl font-black text-indigo-600 tracking-tighter mb-1 cursor-pointer select-all" onClick={() => { navigator.clipboard.writeText(lastSavedTicket.ticket_number); alert("Copied!"); }}>
                        {lastSavedTicket.ticket_number}
                    </h4>
                    <p className="text-xs text-gray-400">Click number to copy</p>
                </div>

                <div className="flex gap-4">
                    <button
                        onClick={resetForm}
                        className="px-6 py-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-bold shadow-lg shadow-indigo-100 transition-all flex items-center gap-2"
                    >
                        Create New Ticket
                    </button>
                    <button
                        onClick={() => window.location.reload()}
                        className="px-6 py-3 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-xl font-bold transition-all"
                    >
                        Go to Inbox
                    </button>
                </div>
            </div>
        );
    }

    return (
        <form onSubmit={handleSubmit} className="bg-white border text-gray-900 border-indigo-100 shadow-sm rounded-xl p-6 h-full flex flex-col overflow-y-auto">
            <div className="flex flex-col xl:flex-row justify-between items-start xl:items-center mb-6 pb-4 border-b gap-4">
                {/* 1. Active Call & Context */}
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-indigo-100 text-indigo-600 rounded-full flex items-center justify-center animate-pulse shrink-0">
                        <span className="text-lg">📞</span>
                    </div>
                    <div>
                        <h2 className="font-bold text-lg text-gray-900 flex items-center gap-2">
                            {activeNumber}
                            <span className="text-xs font-bold px-2 py-0.5 bg-blue-100 text-blue-700 rounded uppercase tracking-wider">
                                {appType.replace('_', ' ')}
                            </span>
                        </h2>
                        <div className="mt-1">
                            {callerContext?.organization_name || callerContext?.caller_name ? (
                                <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-indigo-50 text-indigo-700 border border-indigo-200 rounded-md text-sm font-bold shadow-sm">
                                    {callerContext.organization_name && <span>🏢 {callerContext.organization_name}</span>}
                                    {callerContext.organization_name && callerContext.caller_name && <span className="text-indigo-300">|</span>}
                                    {callerContext.caller_name && <span>👤 Contact: {callerContext.caller_name}</span>}
                                </span>
                            ) : (
                                <span className="text-sm text-gray-500 italic">Unknown Caller</span>
                            )}
                        </div>
                    </div>
                </div>

                {/* 2. Link Ticket & End Call */}
                <div className="flex flex-col items-end gap-2 w-full xl:w-auto">
                    <div className="flex items-center gap-2 w-full xl:w-auto justify-end">
                        <div className="bg-gray-50 border border-gray-200 rounded-lg px-2 py-1 flex items-center gap-2 w-full xl:w-80">
                            <span className="text-gray-400 text-sm shrink-0" title="Link to previous ticket">🔗</span>
                            {history.length > 0 ? (
                                <select
                                    value={selectedParentId}
                                    onChange={(e) => setSelectedParentId(e.target.value ? Number(e.target.value) : '')}
                                    className="w-full bg-transparent border-none text-sm text-gray-700 py-1 focus:ring-0 cursor-pointer"
                                >
                                    <option value="">New Unrelated Issue</option>
                                    {history.map(t => (
                                        <option key={t.id} value={t.id}>
                                            Follow-up #{t.ticket_number}
                                        </option>
                                    ))}
                                </select>
                            ) : (
                                <span className="text-xs text-gray-400 flex-1">No history to link</span>
                            )}
                            <button
                                type="button"
                                onClick={() => setShowManualLink(!showManualLink)}
                                className="text-gray-400 hover:text-indigo-600 shrink-0 p-1 rounded transition-colors"
                                title="Manual Link"
                            >
                                ⌨️
                            </button>
                        </div>

                        {onEndCall && (
                            <button
                                type="button"
                                onClick={onEndCall}
                                className="p-2 bg-red-50 text-red-600 hover:bg-red-100 rounded-lg transition-colors flex items-center gap-2 font-medium text-sm border border-red-100 shrink-0"
                                title="End Call"
                            >
                                ✕ End
                            </button>
                        )}
                    </div>

                    {showManualLink && (
                        <div className="w-full xl:w-80 animate-in slide-in-from-top-2 duration-200">
                            <input
                                type="text"
                                value={manualTicketNo}
                                onChange={(e) => setManualTicketNo(e.target.value)}
                                placeholder="Enter Ticket # (e.g. TCK-2026...)"
                                className="w-full px-3 py-1.5 border text-gray-900 border-indigo-200 rounded-lg focus:ring-indigo-500 focus:border-indigo-500 text-sm font-mono"
                            />
                        </div>
                    )}
                </div>
            </div>

            <div className="space-y-6 flex-1">

                {/* ---------- CORE CRM FIELDS ---------- */}
                <div>
                    <h4 className="text-xs font-bold uppercase tracking-wider text-gray-400 mb-3">Customer Identifier</h4>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Customer Type</label>
                            <select
                                value={customerType}
                                onChange={(e) => setCustomerType(e.target.value)}
                                className="w-full h-10 px-3 py-2 border text-gray-900 border-gray-300 rounded-lg focus:ring-indigo-500 focus:border-indigo-500"
                            >
                                <option value="">Select type...</option>
                                <option value="individual">Individual</option>
                                <option value="organization">Organization</option>
                            </select>
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Customer Name</label>
                            <input
                                type="text"
                                value={customerName}
                                onChange={(e) => setCustomerName(e.target.value)}
                                placeholder="Enter caller name"
                                className="w-full h-10 px-3 py-2 border text-gray-900 border-gray-300 rounded-lg focus:ring-indigo-500 focus:border-indigo-500"
                            />
                        </div>
                        {customerType === 'organization' && (
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Contact Person</label>
                                <input
                                    type="text"
                                    value={contactPerson}
                                    onChange={(e) => setContactPerson(e.target.value)}
                                    placeholder="Contact person name"
                                    className="w-full h-10 px-3 py-2 border text-gray-900 border-gray-300 rounded-lg focus:ring-indigo-500 focus:border-indigo-500"
                                />
                            </div>
                        )}
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
                            <input
                                type="email"
                                value={customerEmail}
                                onChange={(e) => setCustomerEmail(e.target.value)}
                                placeholder="Customer email"
                                className="w-full h-10 px-3 py-2 border text-gray-900 border-gray-300 rounded-lg focus:ring-indigo-500 focus:border-indigo-500"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Gender</label>
                            <select
                                value={customerGender}
                                onChange={(e) => setCustomerGender(e.target.value)}
                                className="w-full h-10 px-3 py-2 border text-gray-900 border-gray-300 rounded-lg focus:ring-indigo-500 focus:border-indigo-500"
                            >
                                <option value="">Select gender...</option>
                                <option value="Male">Male</option>
                                <option value="Female">Female</option>
                                <option value="Other">Other / NA</option>
                            </select>
                        </div>
                    </div>
                </div>

                {/* ---------- TICKET PARAMETERS ---------- */}
                <div>
                    <h4 className="text-xs font-bold uppercase tracking-wider text-gray-400 mb-3">Resolution Details</h4>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Status</label>
                            <select
                                value={status}
                                onChange={(e) => setStatus(e.target.value)}
                                className="w-full h-10 px-3 py-2 border text-gray-900 border-gray-300 rounded-lg focus:ring-indigo-500 focus:border-indigo-500"
                            >
                                <option value="pending">Pending</option>
                                <option value="solved">Solved</option>
                                <option value="forwarded">Forwarded</option>
                            </select>
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Priority</label>
                            <select
                                value={priority}
                                onChange={(e) => setPriority(e.target.value)}
                                className="w-full h-10 px-3 py-2 border text-gray-900 border-gray-300 rounded-lg focus:ring-indigo-500 focus:border-indigo-500"
                            >
                                <option value="low">Low</option>
                                <option value="normal">Normal</option>
                                <option value="high">High</option>
                                <option value="urgent">Urgent</option>
                            </select>
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Ticket Category</label>
                            <select
                                value={category}
                                onChange={(e) => setCategory(e.target.value)}
                                className="w-full h-10 px-3 py-2 border text-gray-900 border-gray-300 rounded-lg focus:ring-indigo-500 focus:border-indigo-500"
                            >
                                <option value="">Select Category...</option>
                                <option value="Technical Support">Technical Support</option>
                                <option value="Billing / Finance">Billing / Finance</option>
                                <option value="Sales / Renewal">Sales / Renewal</option>
                                <option value="General Inquiry">General Inquiry</option>
                                <option value="Complaint">Complaint</option>
                            </select>
                        </div>
                    </div>
                </div>

                {/* ---------- FORWARDING SECTION ---------- */}
                {status === 'forwarded' && (
                    <div className="bg-orange-50 p-4 rounded-xl border border-orange-200 mb-6">
                        <h4 className="font-semibold text-orange-900 flex items-center gap-2 mb-3">
                            <span className="w-2 h-2 rounded-full bg-orange-500"></span>
                            Escalation Handling
                        </h4>
                        <div className="space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-orange-900 mb-1">Forwarding Target (To whom?) *</label>
                                <input
                                    type="text"
                                    value={forwardTarget}
                                    placeholder="e.g. L2 Technician Team, Admin Desk"
                                    onChange={(e) => setForwardTarget(e.target.value)}
                                    className="w-full h-10 px-3 py-2 border border-orange-300 rounded-md focus:ring-orange-500 focus:border-orange-500"
                                    required={status === 'forwarded'}
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-orange-900 mb-1">Reason for Escalation *</label>
                                <textarea
                                    value={forwardReason}
                                    placeholder="Why is it being forwarded?"
                                    onChange={(e) => setForwardReason(e.target.value)}
                                    rows={2}
                                    className="w-full px-3 py-2 border border-orange-300 rounded-md focus:ring-orange-500 focus:border-orange-500"
                                    required={status === 'forwarded'}
                                />
                            </div>
                        </div>
                    </div>
                )}


                {/* ---------- DYNAMIC INDUSTRY FIELDS ---------- */}
                <div>
                    <h4 className="text-xs font-bold uppercase tracking-wider text-gray-400 mb-3 border-b pb-2">Application Specific Details</h4>

                    {loadingFields ? (
                        <div className="text-gray-400 text-sm py-4">Loading dynamic forms...</div>
                    ) : dynamicFields.length === 0 ? (
                        <div className="bg-gray-50 border border-gray-200 rounded-lg p-6 text-center text-sm text-gray-500">
                            No custom fields configured for this application type by Admin.
                        </div>
                    ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-5">
                            {dynamicFields.map((field) => (
                                <div key={field.id} className={field.field_type === 'textarea' ? 'md:col-span-2' : ''}>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">
                                        {field.field_label}
                                        {field.is_required && <span className="text-red-500 ml-1">*</span>}
                                    </label>

                                    {/* Text Inputs */}
                                    {field.field_type === 'text' && (
                                        <input
                                            type="text"
                                            value={appData[field.field_name] || ''}
                                            onChange={(e) => handleDynamicFieldChange(field.field_name, e.target.value)}
                                            className="w-full h-10 px-3 py-2 border border-gray-300 rounded-lg focus:ring-indigo-500 focus:border-indigo-500 text-sm text-gray-900 shadow-sm"
                                        />
                                    )}

                                    {/* Textarea Inputs */}
                                    {field.field_type === 'textarea' && (
                                        <textarea
                                            value={appData[field.field_name] || ''}
                                            onChange={(e) => handleDynamicFieldChange(field.field_name, e.target.value)}
                                            rows={3}
                                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-indigo-500 focus:border-indigo-500 text-sm text-gray-900 shadow-sm"
                                        />
                                    )}

                                    {/* Select Inputs */}
                                    {field.field_type === 'select' && (
                                        <select
                                            value={appData[field.field_name] || ''}
                                            onChange={(e) => handleDynamicFieldChange(field.field_name, e.target.value)}
                                            className="w-full h-10 px-3 py-2 border border-gray-300 rounded-lg focus:ring-indigo-500 focus:border-indigo-500 text-sm text-gray-900 shadow-sm"
                                        >
                                            <option value="">Select option...</option>
                                            {(field.options || []).map((opt: string) => (
                                                <option key={opt} value={opt}>{opt}</option>
                                            ))}
                                        </select>
                                    )}

                                    {/* Checkbox Inputs */}
                                    {field.field_type === 'checkbox' && (
                                        <div className="space-y-2 mt-2">
                                            {(field.options || []).map((opt: string) => {
                                                const checked = (appData[field.field_name] || []).includes(opt);
                                                return (
                                                    <div key={opt} className="flex items-center">
                                                        <input
                                                            type="checkbox"
                                                            checked={checked}
                                                            onChange={(e) => handleCheckboxToggle(field.field_name, opt, e.target.checked)}
                                                            className="h-4 w-4 text-indigo-600 focus:ring-indigo-500 border-gray-300 rounded"
                                                        />
                                                        <label className="ml-2 text-sm text-gray-700">{opt}</label>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    )}

                                    {/* Date Inputs */}
                                    {field.field_type === 'date' && (
                                        <input
                                            type="date"
                                            value={appData[field.field_name] || ''}
                                            onChange={(e) => handleDynamicFieldChange(field.field_name, e.target.value)}
                                            className="w-full h-10 px-3 py-2 border border-gray-300 rounded-lg focus:ring-indigo-500 focus:border-indigo-500 text-sm text-gray-900 shadow-sm"
                                        />
                                    )}

                                    {/* Time Inputs */}
                                    {field.field_type === 'time' && (
                                        <input
                                            type="time"
                                            value={appData[field.field_name] || ''}
                                            onChange={(e) => handleDynamicFieldChange(field.field_name, e.target.value)}
                                            className="w-full h-10 px-3 py-2 border border-gray-300 rounded-lg focus:ring-indigo-500 focus:border-indigo-500 text-sm text-gray-900 shadow-sm"
                                        />
                                    )}

                                </div>
                            ))}
                        </div>
                    )}
                </div>

            </div>

            <div className="mt-8 pt-4 border-t border-gray-100 flex justify-end">
                <button
                    type="submit"
                    disabled={saving}
                    className="px-6 py-2.5 bg-indigo-600 text-white font-medium rounded-lg hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 transition-colors disabled:opacity-50 flex items-center gap-2 shadow-sm"
                >
                    {saving ? 'Processing...' : 'Submit Resolution Ticket'}
                </button>
            </div>
        </form>
    );
}
