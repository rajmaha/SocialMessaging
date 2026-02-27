'use client';

import { useState, useEffect } from 'react';
import MainHeader from "@/components/MainHeader";
import AdminNav from '@/components/AdminNav';
import { authAPI, getAuthToken } from "@/lib/auth";
import { useRouter } from 'next/navigation';
import { Search, Filter, Eye, X, Link as LinkIcon, AlertCircle } from 'lucide-react';

export default function AdminTicketViewer() {
    const user = authAPI.getUser();
    const router = useRouter();

    const [loading, setLoading] = useState(true);
    const [tickets, setTickets] = useState<any[]>([]);
    const [agents, setAgents] = useState<any[]>([]);
    const [selectedTicket, setSelectedTicket] = useState<any | null>(null);
    const [organizations, setOrganizations] = useState<any[]>([]);
    const [searchTerm, setSearchTerm] = useState('');
    const [statusFilter, setStatusFilter] = useState('all');
    const [agentFilter, setAgentFilter] = useState('all');
    const [orgFilter, setOrgFilter] = useState('all');
    const [dateFilter, setDateFilter] = useState('');

    useEffect(() => {
        if (!user || user.role !== 'admin') {
            router.push('/login');
            return;
        }
        fetchAllTickets();
        fetchAgents();
        fetchOrganizations();
    }, []);

    const fetchAgents = async () => {
        try {
            const token = getAuthToken();
            const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/admin/users`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (res.ok) {
                const data = await res.json();
                setAgents(data);
            }
        } catch (e) {
            console.error('Error fetching agents:', e);
        }
    };

    const fetchOrganizations = async () => {
        try {
            const token = getAuthToken();
            const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/organizations`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (res.ok) {
                const data = await res.json();
                setOrganizations(data);
            }
        } catch (e) {
            console.error('Error fetching organizations:', e);
        }
    };

    const fetchAllTickets = async () => {
        setLoading(true);
        try {
            const token = getAuthToken();
            const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/tickets/all`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (res.ok) {
                const data = await res.json();
                setTickets(data);
            }
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    };

    const normalizeData = (data: any) => {
        if (!data) return {};
        // Sometimes app_type_data is stored as a stringified json inside the field, ensure it is parsed.
        if (typeof data === 'string') {
            try { return JSON.parse(data); } catch { return {}; }
        }
        return data;
    };

    const filteredTickets = tickets.filter(t => {
        const matchesStatus = statusFilter === 'all' || t.status === statusFilter;
        const matchesAgent = agentFilter === 'all' || String(t.assigned_to) === String(agentFilter);
        const matchesOrg = orgFilter === 'all' || String(t.organization_id) === String(orgFilter);

        let matchesDate = true;
        if (dateFilter) {
            const ticketDate = new Date(t.created_at).toISOString().split('T')[0];
            matchesDate = ticketDate === dateFilter;
        }

        const searchInput = searchTerm.toLowerCase();
        const matchesSearch =
            (t.ticket_number && t.ticket_number.toLowerCase().includes(searchInput)) ||
            (t.phone_number && t.phone_number.toLowerCase().includes(searchInput)) ||
            (t.customer_name && t.customer_name.toLowerCase().includes(searchInput));

        return matchesStatus && matchesSearch && matchesAgent && matchesDate && matchesOrg;
    });

    if (!user) return null;

    return (
        <div className="min-h-screen bg-gray-50 flex flex-col">
            <MainHeader user={user} />

            <div className="flex-1 flex overflow-hidden pt-16 ml-60">
                <AdminNav />

                <main className="flex-1 overflow-y-auto p-8 relative">
                    <div className="w-full space-y-6">

                        <div className="flex justify-between items-center">
                            <div>
                                <h1 className="text-2xl font-bold text-gray-900">Global Ticket Viewer</h1>
                                <p className="text-gray-500 mt-1">Review all active and historical tickets across the call center.</p>
                            </div>
                        </div>

                        {/* Top Controls */}
                        <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-200 flex flex-col md:flex-row gap-4 justify-between">
                            <div className="flex items-center bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 w-full md:w-96">
                                <Search className="w-5 h-5 text-gray-400 mr-2" />
                                <input
                                    type="text"
                                    placeholder="Search by Ticket #, Name, or Phone..."
                                    value={searchTerm}
                                    onChange={(e) => setSearchTerm(e.target.value)}
                                    className="bg-transparent border-none focus:ring-0 text-sm w-full text-gray-900"
                                />
                            </div>

                            <div className="flex flex-wrap items-center gap-4">
                                <div className="flex items-center gap-2">
                                    <Filter className="w-4 h-4 text-gray-500" />
                                    <select
                                        value={statusFilter}
                                        onChange={(e) => setStatusFilter(e.target.value)}
                                        className="bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-900 focus:ring-indigo-500"
                                    >
                                        <option value="all">All Statuses</option>
                                        <option value="pending">Pending</option>
                                        <option value="forwarded">Forwarded</option>
                                        <option value="solved">Solved</option>
                                    </select>
                                </div>

                                <div className="flex items-center gap-2">
                                    <select
                                        value={agentFilter}
                                        onChange={(e) => setAgentFilter(e.target.value)}
                                        className="bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-900 focus:ring-indigo-500"
                                    >
                                        <option value="all">All Agents</option>
                                        {agents.map(agent => (
                                            <option key={agent.id} value={agent.id}>
                                                {agent.full_name || agent.username}
                                            </option>
                                        ))}
                                    </select>
                                </div>

                                <div className="flex items-center gap-2">
                                    <select
                                        value={orgFilter}
                                        onChange={(e) => setOrgFilter(e.target.value)}
                                        className="bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-900 focus:ring-indigo-500"
                                    >
                                        <option value="all">All Organizations</option>
                                        {organizations.map(org => (
                                            <option key={org.id} value={org.id}>
                                                {org.organization_name}
                                            </option>
                                        ))}
                                    </select>
                                </div>

                                <div className="flex items-center gap-2">
                                    <input
                                        type="date"
                                        value={dateFilter}
                                        onChange={(e) => setDateFilter(e.target.value)}
                                        className="bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-900 focus:ring-indigo-500"
                                    />
                                    {dateFilter && (
                                        <button
                                            onClick={() => setDateFilter('')}
                                            className="p-1 hover:bg-gray-200 rounded text-gray-500"
                                            title="Clear Date"
                                        >
                                            <X className="w-4 h-4" />
                                        </button>
                                    )}
                                </div>
                            </div>
                        </div>

                        {/* Table */}
                        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                            {loading ? (
                                <div className="p-12 text-center text-gray-500">Loading master ticket list...</div>
                            ) : (
                                <div className="overflow-x-auto">
                                    <table className="w-full text-left text-sm text-gray-600">
                                        <thead className="bg-gray-50 border-b">
                                            <tr>
                                                <th className="px-6 py-4 font-medium text-gray-900">Ticket #</th>
                                                <th className="px-6 py-4 font-medium text-gray-900">Caller Details</th>
                                                <th className="px-6 py-4 font-medium text-gray-900">Status</th>
                                                <th className="px-6 py-4 font-medium text-gray-900">Thread</th>
                                                <th className="px-6 py-4 font-medium text-gray-900">Created</th>
                                                <th className="px-6 py-4 text-right font-medium text-gray-900">Action</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-gray-100">
                                            {filteredTickets.map(ticket => (
                                                <tr key={ticket.id} className="hover:bg-gray-50 transition-colors">
                                                    <td className="px-6 py-4 font-medium" style={{ color: 'var(--primary-color)' }}>
                                                        {ticket.ticket_number}
                                                    </td>
                                                    <td className="px-6 py-4">
                                                        <div className="font-semibold text-gray-900">{ticket.customer_name || 'Unknown'}</div>
                                                        <div className="text-xs text-gray-500 mt-0.5">{ticket.phone_number}</div>
                                                    </td>
                                                    <td className="px-6 py-4">
                                                        <span className={`text-xs px-2.5 py-1 rounded-md font-bold uppercase tracking-wide ${ticket.status === 'solved' ? 'bg-green-100 text-green-800' :
                                                            ticket.status === 'forwarded' ? 'bg-orange-100 text-orange-800' : 'bg-blue-100 text-blue-800'
                                                            }`}>
                                                            {ticket.status}
                                                        </span>
                                                    </td>
                                                    <td className="px-6 py-4 text-gray-500 flex items-center">
                                                        {ticket.parent_ticket_id ? (
                                                            <span title={`Linked to #${ticket.parent_ticket_id}`} className="flex items-center gap-1.5 text-xs font-semibold bg-gray-100 px-2 py-1 rounded text-gray-600 border">
                                                                <LinkIcon className="w-3 h-3" /> Follow-up
                                                            </span>
                                                        ) : (
                                                            <span className="text-gray-300 text-xs">Origin</span>
                                                        )}
                                                    </td>
                                                    <td className="px-6 py-4 whitespace-nowrap text-xs">
                                                        {new Date(ticket.created_at).toLocaleString()}
                                                    </td>
                                                    <td className="px-6 py-4 text-right">
                                                        <button
                                                            onClick={() => setSelectedTicket(ticket)}
                                                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition"
                                                            style={{ backgroundColor: 'var(--accent-color)', color: 'white' }}
                                                        >
                                                            <Eye className="w-3.5 h-3.5" /> View
                                                        </button>
                                                    </td>
                                                </tr>
                                            ))}
                                            {filteredTickets.length === 0 && (
                                                <tr>
                                                    <td colSpan={6} className="px-6 py-12 text-center text-gray-500 font-medium">No tickets match your filters.</td>
                                                </tr>
                                            )}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                        </div>

                    </div>
                </main>

                {/* Detail Modal Overlay */}
                {selectedTicket && (
                    <div className="fixed top-0 right-0 bottom-0 w-[500px] bg-white shadow-2xl z-50 overflow-y-auto border-l border-gray-200 transform transition-transform animate-in slide-in-from-right">
                        <div className="sticky top-0 bg-white/80 backdrop-blur-md px-6 py-4 border-b flex justify-between items-center z-10">
                            <div>
                                <h2 className="text-xl font-bold text-gray-900 leading-none">{selectedTicket.ticket_number}</h2>
                                <p className="text-sm text-gray-500 mt-1">{new Date(selectedTicket.created_at).toLocaleString()}</p>
                            </div>
                            <button
                                onClick={() => setSelectedTicket(null)}
                                className="p-2 hover:bg-red-50 text-gray-400 hover:text-red-500 rounded-full transition"
                            >
                                <X className="w-5 h-5" />
                            </button>
                        </div>

                        <div className="p-6 space-y-8">

                            {/* Chained Alert */}
                            {selectedTicket.parent_ticket_id && (
                                <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 flex gap-3 text-blue-900">
                                    <LinkIcon className="w-5 h-5 text-blue-500 flex-shrink-0" />
                                    <div className="text-sm">
                                        <p className="font-semibold">Threaded Ticket</p>
                                        <p className="mt-0.5 text-blue-800">This issue is a logged follow-up directly linked to past ticket <strong>#{selectedTicket.parent_ticket_id}</strong>.</p>
                                    </div>
                                </div>
                            )}

                            {/* Core Details */}
                            <section>
                                <h3 className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-4">Core CRM Record</h3>
                                <div className="bg-gray-50 rounded-xl p-5 border border-gray-100 grid grid-cols-2 gap-y-4 gap-x-6 text-sm">
                                    <div>
                                        <p className="text-gray-500 mb-1">Customer Name</p>
                                        <p className="font-medium text-gray-900">{selectedTicket.customer_name || 'N/A'}</p>
                                    </div>
                                    <div>
                                        <p className="text-gray-500 mb-1">Phone Number</p>
                                        <p className="font-medium text-gray-900">{selectedTicket.phone_number}</p>
                                    </div>
                                    <div>
                                        <p className="text-gray-500 mb-1">Gender</p>
                                        <p className="font-medium text-gray-900">{selectedTicket.customer_gender || 'N/A'}</p>
                                    </div>
                                    <div>
                                        <p className="text-gray-500 mb-1">Status</p>
                                        <p className="font-medium text-gray-900 uppercase">{selectedTicket.status}</p>
                                    </div>
                                    <div>
                                        <p className="text-gray-500 mb-1">Priority</p>
                                        <p className="font-medium text-gray-900 capitalize">{selectedTicket.priority}</p>
                                    </div>
                                    <div>
                                        <p className="text-gray-500 mb-1">Category</p>
                                        <p className="font-medium text-gray-900">{selectedTicket.category || 'N/A'}</p>
                                    </div>
                                </div>
                            </section>

                            {/* Escalation Block */}
                            {selectedTicket.status === 'forwarded' && (
                                <section>
                                    <h3 className="text-xs font-bold uppercase tracking-widest text-orange-400 mb-4 flex items-center gap-2">
                                        <AlertCircle className="w-3.5 h-3.5" /> Escalation Log
                                    </h3>
                                    <div className="bg-orange-50 rounded-xl p-5 border border-orange-200 text-sm">
                                        <p className="text-orange-900 mb-2">
                                            <strong>Forwarded target:</strong> {selectedTicket.forward_target}
                                        </p>
                                        <div className="bg-white p-3 rounded-lg border border-orange-100 text-gray-800">
                                            <p className="text-xs text-orange-400 font-bold mb-1">REASON FOR ESCALATION</p>
                                            <p className="whitespace-pre-wrap">{selectedTicket.forward_reason}</p>
                                        </div>
                                    </div>
                                </section>
                            )}

                            {/* Dynamic App Data */}
                            <section>
                                <h3 className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-4">Admin Configured Field Data</h3>
                                <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden text-sm">
                                    <table className="w-full text-left">
                                        <tbody className="divide-y divide-gray-100">
                                            {Object.entries(normalizeData(selectedTicket.app_type_data)).length === 0 ? (
                                                <tr>
                                                    <td className="p-4 text-center text-gray-500">No dynamic fields filled.</td>
                                                </tr>
                                            ) : (
                                                Object.entries(normalizeData(selectedTicket.app_type_data)).map(([key, value]) => {
                                                    if (!value || (Array.isArray(value) && value.length === 0)) return null;
                                                    const displayVal = Array.isArray(value) ? value.join(', ') : String(value);

                                                    return (
                                                        <tr key={key} className="hover:bg-gray-50">
                                                            <td className="py-3 px-4 w-1/3 bg-gray-50 font-medium text-gray-700 uppercase tracking-wide text-xs border-r border-gray-100">
                                                                {key.replace('_', ' ')}
                                                            </td>
                                                            <td className="py-3 px-4 text-gray-900 whitespace-pre-wrap">
                                                                {displayVal}
                                                            </td>
                                                        </tr>
                                                    );
                                                })
                                            )}
                                        </tbody>
                                    </table>
                                </div>
                            </section>

                        </div>
                    </div>
                )}
                {/* Backdrop */}
                {selectedTicket && (
                    <div className="fixed inset-0 bg-gray-900/20 backdrop-blur-[2px] z-40" onClick={() => setSelectedTicket(null)}></div>
                )}

            </div>
        </div>
    );
}
