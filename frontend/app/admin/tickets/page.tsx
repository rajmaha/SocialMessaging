'use client';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import MainHeader from "@/components/MainHeader";
import AdminNav from '@/components/AdminNav';
import { authAPI, getAuthToken } from "@/lib/auth";
import { useRouter } from 'next/navigation';
import {
    Search, Filter, Eye, X, Hash, AlertCircle,
    Ticket as TicketIcon
} from 'lucide-react';
import TicketHistory from '@/components/TicketHistory';
import { API_URL } from '@/lib/config';

const PAGE_SIZE = 25;

export default function AdminTicketViewer() {
    const user = authAPI.getUser();
    const router = useRouter();

    const [loading, setLoading] = useState(true);
    const [tickets, setTickets] = useState<any[]>([]);
    const [agents, setAgents] = useState<any[]>([]);
    const [selectedTicket, setSelectedTicket] = useState<any | null>(null);
    const [organizations, setOrganizations] = useState<any[]>([]);

    // Filters
    const [searchTerm, setSearchTerm] = useState('');
    const [statusFilter, setStatusFilter] = useState('');
    const [agentFilter, setAgentFilter] = useState('');
    const [orgFilter, setOrgFilter] = useState('');
    const [priorityFilter, setPriorityFilter] = useState('');
    const [threadFilter, setThreadFilter] = useState('');
    const [dateFrom, setDateFrom] = useState('');
    const [dateTo, setDateTo] = useState('');

    const [page, setPage] = useState(0);

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
            const res = await fetch(`${API_URL}/admin/users`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (res.ok) setAgents(await res.json());
        } catch (e) { console.error('Error fetching agents:', e); }
    };

    const fetchOrganizations = async () => {
        try {
            const token = getAuthToken();
            const res = await fetch(`${API_URL}/organizations`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (res.ok) setOrganizations(await res.json());
        } catch (e) { console.error('Error fetching organizations:', e); }
    };

    const fetchAllTickets = async () => {
        setLoading(true);
        try {
            const token = getAuthToken();
            const res = await fetch(`${API_URL}/api/tickets/all`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (res.ok) setTickets(await res.json());
        } catch (e) { console.error(e); }
        finally { setLoading(false); }
    };

    // Stats
    const stats = useMemo(() => {
        const total = tickets.length;
        const pending = tickets.filter(t => t.status === 'pending').length;
        const solved = tickets.filter(t => t.status === 'solved').length;
        const forwarded = tickets.filter(t => t.status === 'forwarded').length;
        const followUps = tickets.filter(t => t.parent_ticket_id).length;
        return { total, pending, solved, forwarded, followUps };
    }, [tickets]);

    const hasActiveFilters = searchTerm || statusFilter || agentFilter || orgFilter || priorityFilter || threadFilter || dateFrom || dateTo;

    const clearFilters = () => {
        setSearchTerm(''); setStatusFilter(''); setAgentFilter('');
        setOrgFilter(''); setPriorityFilter(''); setThreadFilter('');
        setDateFrom(''); setDateTo(''); setPage(0);
    };

    const filteredTickets = useMemo(() => {
        return tickets.filter(t => {
            if (statusFilter && t.status !== statusFilter) return false;
            if (agentFilter && String(t.assigned_to) !== String(agentFilter)) return false;
            if (orgFilter && String(t.organization_id) !== String(orgFilter)) return false;
            if (priorityFilter && t.priority !== priorityFilter) return false;

            if (threadFilter === 'origin' && t.parent_ticket_id) return false;
            if (threadFilter === 'followup' && !t.parent_ticket_id) return false;

            if (dateFrom || dateTo) {
                const ticketDate = new Date(t.created_at).toISOString().split('T')[0];
                if (dateFrom && ticketDate < dateFrom) return false;
                if (dateTo && ticketDate > dateTo) return false;
            }

            if (searchTerm) {
                const s = searchTerm.toLowerCase();
                const matches =
                    (t.ticket_number && t.ticket_number.toLowerCase().includes(s)) ||
                    (t.phone_number && t.phone_number.toLowerCase().includes(s)) ||
                    (t.customer_name && t.customer_name.toLowerCase().includes(s));
                if (!matches) return false;
            }

            return true;
        });
    }, [tickets, statusFilter, agentFilter, orgFilter, priorityFilter, threadFilter, dateFrom, dateTo, searchTerm]);

    // Reset page when filters change
    useEffect(() => { setPage(0); }, [searchTerm, statusFilter, agentFilter, orgFilter, priorityFilter, threadFilter, dateFrom, dateTo]);

    const totalPages = Math.ceil(filteredTickets.length / PAGE_SIZE);
    const paginatedTickets = filteredTickets.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

    const getAgentName = (ticket: any) => {
        if (ticket.assignee_name) return ticket.assignee_name;
        if (!ticket.assigned_to) return null;
        const agent = agents.find(a => a.id === ticket.assigned_to);
        return agent ? (agent.full_name || agent.username) : null;
    };

    if (!user) return null;

    return (
        <div className="ml-60 pt-14 min-h-screen bg-gray-50">
            <MainHeader user={user} />
            <AdminNav />

            <main className="max-w-7xl mx-auto p-6">
                {/* Header */}
                <div className="mb-6">
                    <h2 className="text-3xl font-bold text-gray-900 flex items-center gap-2">
                        <TicketIcon className="w-8 h-8 text-indigo-600" /> All Tickets
                    </h2>
                    <p className="text-gray-500 mt-1">Review all active and historical tickets across the call center.</p>
                </div>

                {/* Stats Cards */}
                <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
                    {[
                        { label: 'Total Tickets', value: stats.total, color: 'blue' },
                        { label: 'Pending', value: stats.pending, color: 'indigo' },
                        { label: 'Solved', value: stats.solved, color: 'green' },
                        { label: 'Forwarded', value: stats.forwarded, color: 'orange' },
                        { label: 'Follow-Ups', value: stats.followUps, color: 'purple' },
                    ].map(({ label, value, color }) => (
                        <div key={label} className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
                            <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">{label}</p>
                            <p className={`text-2xl font-bold mt-1 text-${color}-600`}>{value}</p>
                        </div>
                    ))}
                </div>

                {/* Filters */}
                <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 mb-6">
                    <div className="flex items-center gap-2 mb-3">
                        <Filter className="w-4 h-4 text-gray-500" />
                        <span className="text-sm font-semibold text-gray-700">Search & Filter</span>
                        {hasActiveFilters && (
                            <button onClick={clearFilters} className="ml-auto flex items-center gap-1 text-xs text-red-500 hover:text-red-700">
                                <X className="w-3 h-3" /> Clear all
                            </button>
                        )}
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
                        {/* Search */}
                        <div className="relative">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
                            <input
                                type="text"
                                placeholder="Ticket #, name, phone…"
                                value={searchTerm}
                                onChange={e => { setSearchTerm(e.target.value); setPage(0); }}
                                className="w-full pl-8 pr-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-indigo-500 focus:border-indigo-500"
                            />
                        </div>

                        {/* Status */}
                        <select
                            value={statusFilter}
                            onChange={e => { setStatusFilter(e.target.value); setPage(0); }}
                            className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-indigo-500 focus:border-indigo-500"
                        >
                            <option value="">All Statuses</option>
                            <option value="pending">Pending</option>
                            <option value="forwarded">Forwarded</option>
                            <option value="solved">Solved</option>
                        </select>

                        {/* Agent */}
                        <select
                            value={agentFilter}
                            onChange={e => { setAgentFilter(e.target.value); setPage(0); }}
                            className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-indigo-500 focus:border-indigo-500"
                        >
                            <option value="">All Agents</option>
                            {agents.map(agent => (
                                <option key={agent.id} value={agent.id}>
                                    {agent.full_name || agent.username}
                                </option>
                            ))}
                        </select>

                        {/* Organization */}
                        <select
                            value={orgFilter}
                            onChange={e => { setOrgFilter(e.target.value); setPage(0); }}
                            className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-indigo-500 focus:border-indigo-500"
                        >
                            <option value="">All Organizations</option>
                            {organizations.map(org => (
                                <option key={org.id} value={org.id}>
                                    {org.organization_name}
                                </option>
                            ))}
                        </select>

                        {/* Priority */}
                        <select
                            value={priorityFilter}
                            onChange={e => { setPriorityFilter(e.target.value); setPage(0); }}
                            className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-indigo-500 focus:border-indigo-500"
                        >
                            <option value="">Any Priority</option>
                            <option value="low">Low</option>
                            <option value="normal">Normal</option>
                            <option value="high">High</option>
                            <option value="urgent">Urgent</option>
                        </select>

                        {/* Thread Type */}
                        <select
                            value={threadFilter}
                            onChange={e => { setThreadFilter(e.target.value); setPage(0); }}
                            className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-indigo-500 focus:border-indigo-500"
                        >
                            <option value="">All Threads</option>
                            <option value="origin">Origin Only</option>
                            <option value="followup">Follow-Ups Only</option>
                        </select>

                        {/* Date From */}
                        <input
                            type="date"
                            value={dateFrom}
                            onChange={e => { setDateFrom(e.target.value); setPage(0); }}
                            className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-indigo-500 focus:border-indigo-500"
                            title="From date"
                        />

                        {/* Date To */}
                        <input
                            type="date"
                            value={dateTo}
                            onChange={e => { setDateTo(e.target.value); setPage(0); }}
                            className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-indigo-500 focus:border-indigo-500"
                            title="To date"
                        />
                    </div>
                </div>

                {/* Results table */}
                <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                    {/* Result count + top pagination */}
                    <div className="px-6 py-3 border-b border-gray-100 flex items-center justify-between bg-gray-50">
                        <span className="text-sm text-gray-500">
                            {loading ? 'Loading…' : `${filteredTickets.length} ticket${filteredTickets.length !== 1 ? 's' : ''} found`}
                        </span>
                        {totalPages > 1 && (
                            <div className="flex items-center gap-2">
                                <button
                                    onClick={() => setPage(p => Math.max(0, p - 1))}
                                    disabled={page === 0}
                                    className="px-3 py-1 text-xs border border-gray-300 rounded-md disabled:opacity-40 hover:bg-gray-100"
                                >&larr; Prev</button>
                                <span className="text-xs text-gray-600">Page {page + 1} / {totalPages}</span>
                                <button
                                    onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
                                    disabled={page >= totalPages - 1}
                                    className="px-3 py-1 text-xs border border-gray-300 rounded-md disabled:opacity-40 hover:bg-gray-100"
                                >Next &rarr;</button>
                            </div>
                        )}
                    </div>

                    {loading ? (
                        <div className="flex justify-center py-16">
                            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
                        </div>
                    ) : paginatedTickets.length === 0 ? (
                        <div className="text-center py-16">
                            <TicketIcon className="w-12 h-12 text-gray-300 mx-auto mb-3" />
                            <p className="text-gray-500 font-medium">No tickets found</p>
                            <p className="text-gray-400 text-sm mt-1">
                                {hasActiveFilters ? 'Try adjusting your filters.' : 'No tickets have been created yet.'}
                            </p>
                        </div>
                    ) : (
                        <table className="min-w-full divide-y divide-gray-100">
                            <thead className="bg-gray-50">
                                <tr>
                                    <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Ticket</th>
                                    <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Customer</th>
                                    <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Agent</th>
                                    <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Status</th>
                                    <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Priority</th>
                                    <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Date & Time</th>
                                    <th className="px-5 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wider">Action</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100">
                                {paginatedTickets.map(ticket => (
                                    <tr key={ticket.id} className="hover:bg-gray-50 transition-colors">
                                        {/* Ticket # with thread badge */}
                                        <td className="px-5 py-3.5 whitespace-nowrap">
                                            <div className="flex flex-col gap-1">
                                                {ticket.parent_ticket_number && (
                                                    <Link
                                                        href={`/workspace/tickets/${ticket.parent_ticket_number}`}
                                                        className="inline-flex items-center gap-1 text-[10px] font-medium text-gray-500 hover:text-indigo-600 hover:underline"
                                                    >
                                                        <Hash className="w-2.5 h-2.5" /> {ticket.parent_ticket_number}
                                                    </Link>
                                                )}
                                                <Link
                                                    href={`/workspace/tickets/${ticket.ticket_number}`}
                                                    className={`inline-flex items-center gap-1 text-xs font-bold hover:underline px-2 py-0.5 rounded-md border transition-colors ${
                                                        ticket.parent_ticket_id
                                                            ? 'text-orange-700 hover:text-orange-900 bg-orange-50 border-orange-200'
                                                            : 'text-indigo-600 hover:text-indigo-800 bg-indigo-50 border-indigo-100'
                                                    }`}
                                                >
                                                    <Hash className="w-3 h-3" /> {ticket.ticket_number}
                                                </Link>
                                                {ticket.parent_ticket_id && (
                                                    <span className="text-[10px] font-bold text-orange-500 uppercase tracking-wide">&crarr; Follow-Up</span>
                                                )}
                                            </div>
                                        </td>

                                        {/* Customer */}
                                        <td className="px-5 py-3.5 whitespace-nowrap">
                                            <span className="text-sm font-semibold text-gray-900">{ticket.customer_name || '—'}</span>
                                            <div className="text-xs text-gray-500 font-mono mt-0.5">{ticket.phone_number}</div>
                                        </td>

                                        {/* Agent */}
                                        <td className="px-5 py-3.5 whitespace-nowrap">
                                            <span className="text-sm text-gray-700">{getAgentName(ticket) || <span className="text-gray-400 italic">—</span>}</span>
                                        </td>

                                        {/* Status */}
                                        <td className="px-5 py-3.5 whitespace-nowrap">
                                            <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium ${
                                                ticket.status === 'solved' ? 'bg-green-100 text-green-800' :
                                                ticket.status === 'forwarded' ? 'bg-orange-100 text-orange-800' :
                                                'bg-blue-100 text-blue-800'
                                            }`}>
                                                {ticket.status === 'forwarded' && <AlertCircle className="w-3 h-3" />}
                                                {ticket.status.charAt(0).toUpperCase() + ticket.status.slice(1)}
                                            </span>
                                        </td>

                                        {/* Priority */}
                                        <td className="px-5 py-3.5 whitespace-nowrap">
                                            <span className={`text-xs font-medium px-2 py-0.5 rounded ${
                                                ticket.priority === 'urgent' ? 'bg-red-100 text-red-700' :
                                                ticket.priority === 'high' ? 'bg-orange-100 text-orange-700' :
                                                ticket.priority === 'normal' ? 'bg-gray-100 text-gray-600' :
                                                'bg-gray-50 text-gray-500'
                                            }`}>
                                                {ticket.priority.charAt(0).toUpperCase() + ticket.priority.slice(1)}
                                            </span>
                                        </td>

                                        {/* Date */}
                                        <td className="px-5 py-3.5 whitespace-nowrap text-sm text-gray-500">
                                            {ticket.created_at ? new Date(ticket.created_at).toLocaleString() : '—'}
                                        </td>

                                        {/* Actions */}
                                        <td className="px-5 py-3.5 whitespace-nowrap text-right">
                                            <button
                                                onClick={() => setSelectedTicket(ticket)}
                                                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-gray-100 text-gray-600 hover:bg-indigo-50 hover:text-indigo-600 transition-colors"
                                            >
                                                <Eye className="w-3.5 h-3.5" /> View
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}

                    {/* Pagination Footer */}
                    {!loading && totalPages > 1 && paginatedTickets.length > 0 && (
                        <div className="px-6 py-4 border-t border-gray-100 flex items-center justify-between bg-white">
                            <span className="text-sm text-gray-500">
                                Showing {page * PAGE_SIZE + 1} to {Math.min((page + 1) * PAGE_SIZE, filteredTickets.length)} of {filteredTickets.length} results
                            </span>
                            <div className="flex items-center gap-2">
                                <button
                                    onClick={() => setPage(p => Math.max(0, p - 1))}
                                    disabled={page === 0}
                                    className="px-3 py-1.5 text-xs font-medium border border-gray-300 rounded-md disabled:opacity-40 hover:bg-gray-50 transition-colors"
                                >&larr; Previous</button>
                                <span className="text-sm font-medium text-gray-700 px-2">Page {page + 1} of {totalPages}</span>
                                <button
                                    onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
                                    disabled={page >= totalPages - 1}
                                    className="px-3 py-1.5 text-xs font-medium border border-gray-300 rounded-md disabled:opacity-40 hover:bg-gray-50 transition-colors"
                                >Next &rarr;</button>
                            </div>
                        </div>
                    )}
                </div>
            </main>

            {/* Threaded Detail Side Panel */}
            {selectedTicket && (
                <div className="fixed top-0 right-0 bottom-0 w-[520px] bg-white shadow-2xl z-50 border-l border-gray-200 flex flex-col animate-in slide-in-from-right">
                    <div className="shrink-0 bg-white/80 backdrop-blur-md px-6 py-4 border-b flex justify-between items-center">
                        <div>
                            <h2 className="text-lg font-bold text-gray-900 leading-none">Ticket Thread</h2>
                            <p className="text-sm text-gray-500 mt-1">{selectedTicket.customer_name || 'Unknown'} &middot; {selectedTicket.phone_number}</p>
                        </div>
                        <button
                            onClick={() => setSelectedTicket(null)}
                            className="p-2 hover:bg-red-50 text-gray-400 hover:text-red-500 rounded-full transition"
                        >
                            <X className="w-5 h-5" />
                        </button>
                    </div>
                    <div className="flex-1 overflow-hidden [&>div]:max-h-full [&>div]:rounded-none [&>div]:border-0 [&>div]:shadow-none">
                        <TicketHistory
                            activeNumber={selectedTicket.phone_number}
                            reloadKey={0}
                            onFollowUpClick={() => {}}
                            ticketId={selectedTicket.id}
                        />
                    </div>
                </div>
            )}
            {/* Backdrop */}
            {selectedTicket && (
                <div className="fixed inset-0 bg-gray-900/20 backdrop-blur-[2px] z-40" onClick={() => setSelectedTicket(null)}></div>
            )}
        </div>
    );
}
