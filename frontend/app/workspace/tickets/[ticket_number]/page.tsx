'use client';

import { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import MainHeader from "@/components/MainHeader";
import TicketHistory from "@/components/TicketHistory";
import { authAPI, getAuthToken } from "@/lib/auth";
import { ArrowLeft, Save, Phone } from 'lucide-react';
import { API_URL } from '@/lib/config';

export default function TicketFollowUpWrapper({ params }: { params: { ticket_number: string } }) {
    return (
        <Suspense fallback={<div className="flex items-center justify-center h-screen bg-gray-50"><div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500"></div></div>}>
            <TicketFollowUp params={params} />
        </Suspense>
    )
}

function TicketFollowUp({ params }: { params: { ticket_number: string } }) {
    const { ticket_number } = params;
    const router = useRouter();
    const searchParams = useSearchParams();
    const user = authAPI.getUser();

    // Navigate back to the correct origin page:
    // - workspace inbox passes ?from=workspace → force a fresh push so myTickets refreshes
    // - all other pages (call records, admin tickets, etc.) → regular browser back
    const handleBack = () => {
        if (searchParams.get('from') === 'workspace') {
            router.push('/workspace');
        } else {
            router.back();
        }
    };

    const [ticket, setTicket] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);

    // Form State
    const [note, setNote] = useState('');
    const [actionTaken, setActionTaken] = useState('');
    const [status, setStatus] = useState('');
    const [priority, setPriority] = useState('');
    const [reloadHistory, setReloadHistory] = useState(0);

    useEffect(() => {
        if (!user) { router.push('/login'); return; }
        fetchTicket();
    }, [ticket_number]);

    const fetchTicket = async () => {
        try {
            const token = getAuthToken();
            const res = await fetch(`${API_URL}/api/tickets/find?number=${ticket_number}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (res.ok) {
                const data = await res.json();
                setTicket(data);
                setStatus(data.status);
                setPriority(data.priority);
            }
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    };

    const handleSave = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!note.trim() && !actionTaken.trim() && status === ticket.status && priority === ticket.priority) return;

        setSaving(true);
        try {
            const token = getAuthToken();
            const res = await fetch(`${API_URL}/api/tickets/${ticket_number}/notes`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    note: note.trim() || undefined,
                    action_taken: actionTaken.trim() || undefined,
                    status: status !== ticket.status ? status : undefined,
                    priority: priority !== ticket.priority ? priority : undefined
                })
            });

            if (res.ok) {
                setNote('');
                setActionTaken('');
                fetchTicket(); // refresh ticket details
                setReloadHistory(prev => prev + 1); // refresh history sidebar
            }
        } catch (e) {
            console.error(e);
        } finally {
            setSaving(false);
        }
    };

    const initiateCall = async (phone: string) => {
        try {
            const token = getAuthToken();
            const response = await fetch(`${API_URL}/calls/originate`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ phone_number: phone })
            });
            if (!response.ok) {
                console.error("Failed to initiate call");
            }
        } catch (e) {
            console.error("Error initiating call:", e);
        }
    };

    if (loading) return <div className="min-h-screen bg-gray-50 flex items-center justify-center"><div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600"></div></div>;
    if (!ticket || !user) return <div className="min-h-screen bg-gray-50 flex items-center justify-center text-gray-500">Ticket not found or unauthorized.</div>;

    return (
        <div className="pt-14 min-h-screen bg-gray-50 flex flex-col">
            <MainHeader user={user} />

            {/* Top Navigation */}
            <div className="bg-white border-b border-gray-200 px-6 py-4 flex items-center gap-4">
                <button
                    onClick={handleBack}
                    className="p-2 hover:bg-gray-100 rounded-full transition-colors text-gray-600"
                >
                    <ArrowLeft className="w-5 h-5" />
                </button>
                <div>
                    <h1 className="text-xl font-bold text-gray-900 flex items-center gap-3">
                        Follow-Up: #{ticket.ticket_number}
                        <span className={`text-xs px-2.5 py-1 rounded-md font-bold uppercase tracking-wide ${ticket.status === 'solved' ? 'bg-green-100 text-green-800' :
                            ticket.status === 'forwarded' ? 'bg-orange-100 text-orange-800' :
                                ticket.status === 'closed' ? 'bg-gray-100 text-gray-800' :
                                    'bg-blue-100 text-blue-800'
                            }`}>
                            {ticket.status}
                        </span>
                    </h1>
                </div>
            </div>

            {/* 3-Column Layout */}
            <main className="flex-1 w-full p-4 md:p-6 grid grid-cols-1 lg:grid-cols-12 gap-6 h-full min-h-0">

                {/* LEFT: Ticket Details */}
                <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden lg:col-span-3 flex flex-col">
                    <div className="p-4 border-b border-gray-100 bg-gray-50 font-bold text-gray-700">Ticket Details</div>
                    <div className="p-5 space-y-5 overflow-y-auto flex-1">
                        <div>
                            <p className="text-xs font-bold text-gray-700 uppercase">Customer</p>
                            <p className="text-sm font-medium text-gray-900 mt-1">{ticket.customer_name || 'N/A'}</p>
                            <button
                                onClick={() => initiateCall(ticket.phone_number)}
                                className="text-sm text-indigo-600 hover:text-indigo-800 hover:underline flex items-center gap-1.5 font-mono mt-1 transition-colors text-left"
                                title="Click to call"
                            >
                                <Phone className="w-3.5 h-3.5 shrink-0" />
                                {ticket.phone_number}
                            </button>
                        </div>
                        {ticket.organization_name && (
                            <div>
                                <p className="text-xs font-bold text-gray-700 uppercase">Organization</p>
                                <p className="text-sm text-gray-900 mt-1">{ticket.organization_name}</p>
                            </div>
                        )}
                        <div>
                            <p className="text-xs font-bold text-gray-700 uppercase">Current Priority</p>
                            <p className="text-sm font-medium text-gray-900 mt-1 capitalize">{ticket.priority}</p>
                        </div>
                        <div>
                            <p className="text-xs font-bold text-gray-700 uppercase">Category</p>
                            <p className="text-sm text-gray-900 mt-1">{ticket.category || 'None'}</p>
                        </div>
                        <div>
                            <p className="text-xs font-bold text-gray-700 uppercase">Created</p>
                            <p className="text-sm text-gray-600 mt-1">{new Date(ticket.created_at).toLocaleString()}</p>
                        </div>

                        {/* Dynamic / application-specific fields from ticket creation */}
                        {ticket.app_type_data && Object.keys(ticket.app_type_data).length > 0 && (
                            <div className="border-t border-gray-100 pt-4">
                                <p className="text-xs font-bold text-gray-700 uppercase mb-3">Application Data</p>
                                <div className="space-y-3">
                                    {Object.entries(ticket.app_type_data as Record<string, any>).map(([k, v]) => {
                                        if (v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0)) return null;
                                        const displayValue = Array.isArray(v) ? v.join(', ') : String(v);
                                        return (
                                            <div key={k}>
                                                <p className="text-[10px] font-bold text-indigo-500 uppercase tracking-widest leading-tight">{k.replace(/_/g, ' ')}</p>
                                                <p className="text-sm text-gray-900 mt-0.5 font-medium break-words">{displayValue}</p>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        )}
                    </div>
                    <div className="p-4 border-t border-gray-100 bg-gray-50 mt-auto">
                        <button
                            onClick={() => initiateCall(ticket.phone_number)}
                            className="w-full px-4 py-2 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 rounded-lg font-bold transition-colors flex items-center justify-center gap-2 border border-indigo-200 shadow-sm"
                        >
                            <Phone className="w-4 h-4" /> Call Now
                        </button>
                    </div>
                </div>

                {/* MIDDLE: Follow-Up Form */}
                <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden lg:col-span-5 flex flex-col">
                    <div className="p-4 border-b border-gray-100 bg-gray-50 font-bold text-gray-700">Update Ticket</div>
                    <form onSubmit={handleSave} className="p-6 flex flex-col gap-5 flex-1 overflow-y-auto">

                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="block text-sm font-semibold text-gray-700 mb-1">Update Status</label>
                                <select
                                    value={status}
                                    onChange={e => setStatus(e.target.value)}
                                    className="w-full border-gray-300 rounded-lg text-sm focus:ring-indigo-500 focus:border-indigo-500"
                                >
                                    <option value="pending">Pending</option>
                                    <option value="forwarded">Forwarded</option>
                                    <option value="solved">Solved</option>
                                </select>
                            </div>
                            <div>
                                <label className="block text-sm font-semibold text-gray-700 mb-1">Update Priority</label>
                                <select
                                    value={priority}
                                    onChange={e => setPriority(e.target.value)}
                                    className="w-full border-gray-300 rounded-lg text-sm focus:ring-indigo-500 focus:border-indigo-500"
                                >
                                    <option value="low">Low</option>
                                    <option value="normal">Normal</option>
                                    <option value="high">High</option>
                                    <option value="urgent">Urgent</option>
                                </select>
                            </div>
                        </div>

                        <div className="flex-1 flex flex-col gap-4">
                            <div className="flex-1 flex flex-col">
                                <label className="block text-sm font-semibold text-gray-700 mb-1">Follow-Up Note</label>
                                <textarea
                                    value={note}
                                    onChange={e => setNote(e.target.value)}
                                    placeholder="Type your follow-up notes here..."
                                    className="w-full flex-1 border-gray-300 rounded-lg p-3 text-sm focus:ring-indigo-500 focus:border-indigo-500 resize-none min-h-[100px]"
                                />
                            </div>
                            <div className="flex-1 flex flex-col">
                                <label className="block text-sm font-semibold text-gray-700 mb-1">Action Taken</label>
                                <textarea
                                    value={actionTaken}
                                    onChange={e => setActionTaken(e.target.value)}
                                    placeholder="Document any actions taken..."
                                    className="w-full flex-1 border-gray-300 rounded-lg p-3 text-sm focus:ring-indigo-500 focus:border-indigo-500 resize-none min-h-[100px]"
                                />
                            </div>
                        </div>

                        <div className="pt-4 border-t border-gray-100 mt-auto flex justify-end">
                            <button
                                type="submit"
                                disabled={saving || (!note.trim() && !actionTaken.trim() && status === ticket.status && priority === ticket.priority)}
                                className="px-6 py-2.5 bg-indigo-600 text-white rounded-xl font-bold hover:bg-indigo-700 disabled:opacity-50 transition-colors flex items-center gap-2"
                            >
                                {saving ? 'Saving...' : <><Save className="w-4 h-4" /> Save Update</>}
                            </button>
                        </div>
                    </form>
                </div>

                {/* RIGHT: Ticket History */}
                <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden lg:col-span-4 flex flex-col">
                    <TicketHistory
                        activeNumber={ticket.phone_number}
                        reloadKey={reloadHistory}
                        onFollowUpClick={() => { }}
                    />
                </div>

            </main>
        </div>
    );
}
