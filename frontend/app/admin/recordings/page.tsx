'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import MainHeader from "@/components/MainHeader";
import AdminNav from '@/components/AdminNav';
import { authAPI, getAuthToken } from "@/lib/auth";
import { useRouter } from 'next/navigation';
import {
    PhoneCall, PhoneIncoming, PhoneOutgoing, Clock, Play, Pause,
    Download, Search, RefreshCw, Filter, X, User as UserIcon, Calendar, Hash
} from 'lucide-react';

const API = process.env.NEXT_PUBLIC_API_URL;

export default function Recordings() {
    const user = authAPI.getUser();
    const router = useRouter();
    const audioRef = useRef<HTMLAudioElement | null>(null);

    const [loading, setLoading] = useState(true);
    const [syncing, setSyncing] = useState(false);
    const [recordings, setRecordings] = useState<any[]>([]);
    const [total, setTotal] = useState(0);
    const [stats, setStats] = useState<any>(null);
    const [agents, setAgents] = useState<any[]>([]);
    const [organizations, setOrganizations] = useState<any[]>([]);
    const [playingId, setPlayingId] = useState<number | null>(null);

    // Filters
    const [phone, setPhone] = useState('');
    const [agentId, setAgentId] = useState('');
    const [direction, setDirection] = useState('');
    const [dateFrom, setDateFrom] = useState('');
    const [dateTo, setDateTo] = useState('');
    const [hasRecording, setHasRecording] = useState('');
    const [organizationId, setOrganizationId] = useState('');

    // Ticket Filters
    const [ticketStatus, setTicketStatus] = useState('');
    const [ticketPriority, setTicketPriority] = useState('');
    const [ticketCategory, setTicketCategory] = useState('');

    const [page, setPage] = useState(0);
    const limit = 25;

    useEffect(() => {
        const token = getAuthToken();
        if (!token) { router.push('/login'); return; }
        fetchAgents();
        fetchOrganizations();
    }, []);

    useEffect(() => {
        fetchRecordings();
        fetchStats();
    }, [phone, agentId, direction, dateFrom, dateTo, hasRecording, organizationId, ticketStatus, ticketPriority, ticketCategory, page]);

    const buildParams = () => {
        const p = new URLSearchParams();
        p.set('skip', String(page * limit));
        p.set('limit', String(limit));
        if (phone) p.set('phone', phone);
        if (agentId) p.set('agent_id', agentId);
        if (direction) p.set('direction', direction);
        if (dateFrom) p.set('date_from', dateFrom);
        if (dateTo) p.set('date_to', dateTo);
        if (hasRecording !== '') p.set('has_recording', hasRecording);
        if (organizationId) p.set('organization_id', organizationId);
        if (ticketStatus) p.set('ticket_status', ticketStatus);
        if (ticketPriority) p.set('ticket_priority', ticketPriority);
        if (ticketCategory) p.set('ticket_category', ticketCategory);
        return p.toString();
    };

    const fetchRecordings = async () => {
        setLoading(true);
        try {
            const token = getAuthToken();
            const res = await fetch(`${API}/calls/recordings?${buildParams()}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (res.ok) {
                const data = await res.json();
                setRecordings(data.results || []);
                setTotal(data.total || 0);
            }
        } catch (e) { console.error(e); }
        finally { setLoading(false); }
    };

    const fetchStats = async () => {
        try {
            const token = getAuthToken();
            const p = new URLSearchParams();
            if (agentId) p.set('agent_id', agentId);
            if (organizationId) p.set('organization_id', organizationId);
            if (dateFrom) p.set('date_from', dateFrom);
            if (dateTo) p.set('date_to', dateTo);
            const res = await fetch(`${API}/calls/recordings/stats?${p.toString()}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (res.ok) setStats(await res.json());
        } catch (e) { }
    };

    const fetchAgents = async () => {
        try {
            const token = getAuthToken();
            const res = await fetch(`${API}/calls/agents-list`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (res.ok) setAgents(await res.json());
        } catch (e) { }
    };

    const fetchOrganizations = async () => {
        try {
            const token = getAuthToken();
            const res = await fetch(`${API}/organizations`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (res.ok) setOrganizations(await res.json());
        } catch (e) { }
    };

    const syncFromFreePBX = async () => {
        setSyncing(true);
        try {
            const token = getAuthToken();
            const res = await fetch(`${API}/calls/recordings/sync-from-freepbx`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (res.ok) {
                const data = await res.json();
                fetchRecordings();
                fetchStats();
            }
        } catch (e) { }
        finally { setSyncing(false); }
    };

    const togglePlay = (rec: any) => {
        if (playingId === rec.id) {
            audioRef.current?.pause();
            setPlayingId(null);
        } else {
            setPlayingId(rec.id);
        }
    };

    const clearFilters = () => {
        setPhone(''); setAgentId(''); setDirection('');
        setDateFrom(''); setDateTo(''); setHasRecording('');
        setOrganizationId('');
        setTicketStatus(''); setTicketPriority(''); setTicketCategory('');
        setPage(0);
    };

    const formatDuration = (s: number) => {
        if (!s) return '0:00';
        const m = Math.floor(s / 60);
        const sec = s % 60;
        return `${m}:${sec.toString().padStart(2, '0')}`;
    };

    const audioStreamUrl = (id: number) =>
        `${API}/calls/recordings/${id}/stream?token=${getAuthToken()}`;

    const totalPages = Math.ceil(total / limit);
    const hasActiveFilters = phone || agentId || direction || dateFrom || dateTo || hasRecording !== '' || organizationId || ticketStatus || ticketPriority || ticketCategory;

    return (
        <div className="ml-60 pt-14 min-h-screen bg-gray-50">
            <MainHeader user={user!} />
            <AdminNav />

            {playingId !== null && (
                <audio
                    ref={audioRef}
                    key={playingId}
                    src={audioStreamUrl(playingId)}
                    autoPlay
                    onEnded={() => setPlayingId(null)}
                    className="hidden"
                />
            )}

            <main className="max-w-7xl mx-auto p-6">
                {/* Header */}
                <div className="mb-6 flex justify-between items-start">
                    <div>
                        <h2 className="text-3xl font-bold text-gray-900 flex items-center gap-2">
                            <PhoneCall className="w-8 h-8 text-indigo-600" /> Call Records & Playback
                        </h2>
                        <p className="text-gray-500 mt-1">Search, filter, and play back recorded calls from FreePBX.</p>
                    </div>
                    <button
                        onClick={syncFromFreePBX}
                        disabled={syncing}
                        className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors disabled:opacity-50 text-sm font-medium shadow-sm"
                    >
                        <RefreshCw className={`w-4 h-4 ${syncing ? 'animate-spin' : ''}`} />
                        {syncing ? 'Syncing…' : 'Sync from FreePBX'}
                    </button>
                </div>

                {/* Stats Cards */}
                {stats && (
                    <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
                        {[
                            { label: 'Total Calls', value: stats.total, color: 'blue' },
                            { label: 'Inbound', value: stats.inbound, color: 'green' },
                            { label: 'Outbound', value: stats.outbound, color: 'purple' },
                            { label: 'With Audio', value: stats.with_audio, color: 'indigo' },
                            { label: 'Avg Duration', value: formatDuration(stats.avg_duration_seconds), color: 'orange' },
                        ].map(({ label, value, color }) => (
                            <div key={label} className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
                                <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">{label}</p>
                                <p className={`text-2xl font-bold mt-1 text-${color}-600`}>{value}</p>
                            </div>
                        ))}
                    </div>
                )}

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
                        {/* Phone search */}
                        <div className="relative">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
                            <input
                                type="text"
                                placeholder="Customer phone…"
                                value={phone}
                                onChange={e => { setPhone(e.target.value); setPage(0); }}
                                className="w-full pl-8 pr-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-indigo-500 focus:border-indigo-500"
                            />
                        </div>

                        {/* Agent filter (admin only) */}
                        {user?.role === 'admin' && (
                            <select
                                value={agentId}
                                onChange={e => { setAgentId(e.target.value); setPage(0); }}
                                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-indigo-500 focus:border-indigo-500"
                            >
                                <option value="">All Agents</option>
                                {agents.map(a => (
                                    <option key={a.id} value={a.id}>{a.name}</option>
                                ))}
                            </select>
                        )}

                        {/* Organization filter */}
                        <select
                            value={organizationId}
                            onChange={e => { setOrganizationId(e.target.value); setPage(0); }}
                            className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-indigo-500 focus:border-indigo-500"
                        >
                            <option value="">All Organizations</option>
                            {organizations.map(o => (
                                <option key={o.id} value={o.id}>{o.organization_name}</option>
                            ))}
                        </select>

                        {/* Direction */}
                        <select
                            value={direction}
                            onChange={e => { setDirection(e.target.value); setPage(0); }}
                            className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-indigo-500 focus:border-indigo-500"
                        >
                            <option value="">All Directions</option>
                            <option value="inbound">Inbound</option>
                            <option value="outbound">Outbound</option>
                        </select>

                        {/* Date From */}
                        <input
                            type="date"
                            value={dateFrom}
                            onChange={e => { setDateFrom(e.target.value); setPage(0); }}
                            className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-indigo-500 focus:border-indigo-500"
                        />

                        {/* Date To */}
                        <input
                            type="date"
                            value={dateTo}
                            onChange={e => { setDateTo(e.target.value); setPage(0); }}
                            className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-indigo-500 focus:border-indigo-500"
                        />

                        {/* Has Recording */}
                        <select
                            value={hasRecording}
                            onChange={e => { setHasRecording(e.target.value); setPage(0); }}
                            className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-indigo-500 focus:border-indigo-500"
                        >
                            <option value="">All Calls</option>
                            <option value="true">With Audio</option>
                            <option value="false">No Audio</option>
                        </select>

                        {/* Ticket Status */}
                        <select
                            value={ticketStatus}
                            onChange={e => { setTicketStatus(e.target.value); setPage(0); }}
                            className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-indigo-500 focus:border-indigo-500"
                        >
                            <option value="">Any Ticket Status</option>
                            <option value="pending">Pending</option>
                            <option value="solved">Solved</option>
                            <option value="forwarded">Forwarded</option>
                        </select>

                        {/* Ticket Priority */}
                        <select
                            value={ticketPriority}
                            onChange={e => { setTicketPriority(e.target.value); setPage(0); }}
                            className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-indigo-500 focus:border-indigo-500"
                        >
                            <option value="">Any Ticket Priority</option>
                            <option value="low">Low</option>
                            <option value="normal">Normal</option>
                            <option value="high">High</option>
                            <option value="urgent">Urgent</option>
                        </select>

                        {/* Ticket Category */}
                        <select
                            value={ticketCategory}
                            onChange={e => { setTicketCategory(e.target.value); setPage(0); }}
                            className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-indigo-500 focus:border-indigo-500"
                        >
                            <option value="">Any Ticket Category</option>
                            <option value="Technical Support">Technical Support</option>
                            <option value="Billing / Finance">Billing / Finance</option>
                            <option value="Sales / Renewal">Sales / Renewal</option>
                            <option value="General Inquiry">General Inquiry</option>
                        </select>

                    </div>
                </div>

                {/* Results table */}
                <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                    {/* Result count */}
                    <div className="px-6 py-3 border-b border-gray-100 flex items-center justify-between bg-gray-50">
                        <span className="text-sm text-gray-500">
                            {loading ? 'Loading…' : `${total} call${total !== 1 ? 's' : ''} found`}
                        </span>
                        {totalPages > 1 && (
                            <div className="flex items-center gap-2">
                                <button
                                    onClick={() => setPage(p => Math.max(0, p - 1))}
                                    disabled={page === 0}
                                    className="px-3 py-1 text-xs border border-gray-300 rounded-md disabled:opacity-40 hover:bg-gray-100"
                                >← Prev</button>
                                <span className="text-xs text-gray-600">Page {page + 1} / {totalPages}</span>
                                <button
                                    onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
                                    disabled={page >= totalPages - 1}
                                    className="px-3 py-1 text-xs border border-gray-300 rounded-md disabled:opacity-40 hover:bg-gray-100"
                                >Next →</button>
                            </div>
                        )}
                    </div>

                    {loading ? (
                        <div className="flex justify-center py-16">
                            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
                        </div>
                    ) : recordings.length === 0 ? (
                        <div className="text-center py-16">
                            <PhoneCall className="w-12 h-12 text-gray-300 mx-auto mb-3" />
                            <p className="text-gray-500 font-medium">No call records found</p>
                            <p className="text-gray-400 text-sm mt-1">
                                {hasActiveFilters ? 'Try adjusting your filters.' : 'Click "Sync from FreePBX" to import call records.'}
                            </p>
                        </div>
                    ) : (
                        <table className="min-w-full divide-y divide-gray-100">
                            <thead className="bg-gray-50">
                                <tr>
                                    <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Direction</th>
                                    <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Customer Name</th>
                                    <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Caller Number</th>
                                    <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Agent</th>
                                    <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Date & Time</th>
                                    <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Ticket</th>
                                    <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Duration</th>
                                    <th className="px-5 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wider">Playback</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100">
                                {recordings.map(rec => (
                                    <tr key={rec.id} className={`hover:bg-gray-50 transition-colors ${playingId === rec.id ? 'bg-indigo-50' : ''}`}>
                                        <td className="px-5 py-3.5 whitespace-nowrap">
                                            {rec.direction === 'inbound' ? (
                                                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800">
                                                    <PhoneIncoming className="w-3 h-3" /> Inbound
                                                </span>
                                            ) : (
                                                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                                                    <PhoneOutgoing className="w-3 h-3" /> Outbound
                                                </span>
                                            )}
                                        </td>
                                        <td className="px-5 py-3.5 whitespace-nowrap">
                                            <span className="text-sm font-semibold text-gray-900">{rec.customer_name || '—'}</span>
                                        </td>
                                        <td className="px-5 py-3.5 whitespace-nowrap">
                                            <span className="text-sm text-gray-600 font-mono">{rec.phone_number}</span>
                                        </td>
                                        <td className="px-5 py-3.5 whitespace-nowrap">
                                            <span className="text-sm text-gray-700">{rec.agent_name || '—'}</span>
                                        </td>
                                        <td className="px-5 py-3.5 whitespace-nowrap text-sm text-gray-500">
                                            {rec.created_at ? new Date(rec.created_at).toLocaleString() : '—'}
                                        </td>
                                        <td className="px-5 py-3.5 whitespace-nowrap">
                                            {rec.ticket_number ? (
                                                <Link href={`/workspace/tickets/${rec.ticket_number}`} className="inline-flex items-center gap-1 text-xs font-bold text-indigo-600 hover:text-indigo-800 hover:underline bg-indigo-50 px-2 py-0.5 rounded-md border border-indigo-100 transition-colors">
                                                    <Hash className="w-3 h-3" /> {rec.ticket_number}
                                                </Link>
                                            ) : (
                                                <span className="text-xs text-gray-400 italic">—</span>
                                            )}
                                        </td>
                                        <td className="px-5 py-3.5 whitespace-nowrap">
                                            <div className="flex items-center gap-1.5 text-sm text-gray-600">
                                                <Clock className="w-3.5 h-3.5 text-gray-400" />
                                                {formatDuration(rec.duration_seconds)}
                                            </div>
                                        </td>
                                        <td className="px-5 py-3.5 whitespace-nowrap text-right">
                                            {rec.has_audio ? (
                                                <div className="flex justify-end items-center gap-2">
                                                    {playingId === rec.id && (
                                                        <div className="flex items-center gap-1">
                                                            <span className="inline-block w-1.5 h-4 bg-indigo-500 rounded animate-pulse"></span>
                                                            <span className="inline-block w-1.5 h-6 bg-indigo-400 rounded animate-pulse delay-75"></span>
                                                            <span className="inline-block w-1.5 h-3 bg-indigo-500 rounded animate-pulse delay-150"></span>
                                                        </div>
                                                    )}
                                                    <button
                                                        onClick={() => togglePlay(rec)}
                                                        className={`p-2 rounded-full transition-all ${playingId === rec.id
                                                            ? 'bg-indigo-600 text-white shadow-md'
                                                            : 'bg-gray-100 text-gray-600 hover:bg-indigo-50 hover:text-indigo-600'
                                                            }`}
                                                        title={playingId === rec.id ? 'Pause' : 'Play recording'}
                                                    >
                                                        {playingId === rec.id
                                                            ? <Pause className="w-4 h-4" />
                                                            : <Play className="w-4 h-4 ml-0.5" />
                                                        }
                                                    </button>
                                                    <a
                                                        href={audioStreamUrl(rec.id)}
                                                        download
                                                        className="p-2 rounded-full bg-gray-100 text-gray-500 hover:bg-gray-200 transition-colors"
                                                        title="Download recording"
                                                    >
                                                        <Download className="w-3.5 h-3.5" />
                                                    </a>
                                                </div>
                                            ) : (
                                                <span className="text-xs text-gray-400 italic">No recording</span>
                                            )}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                    {/* Pagination Footer */}
                    {!loading && totalPages > 1 && recordings.length > 0 && (
                        <div className="px-6 py-4 border-t border-gray-100 flex items-center justify-between bg-white">
                            <span className="text-sm text-gray-500">
                                Showing {page * limit + 1} to {Math.min((page + 1) * limit, total)} of {total} results
                            </span>
                            <div className="flex items-center gap-2">
                                <button
                                    onClick={() => setPage(p => Math.max(0, p - 1))}
                                    disabled={page === 0}
                                    className="px-3 py-1.5 text-xs font-medium border border-gray-300 rounded-md disabled:opacity-40 hover:bg-gray-50 transition-colors"
                                >← Previous</button>
                                <span className="text-sm font-medium text-gray-700 px-2">Page {page + 1} of {totalPages}</span>
                                <button
                                    onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
                                    disabled={page >= totalPages - 1}
                                    className="px-3 py-1.5 text-xs font-medium border border-gray-300 rounded-md disabled:opacity-40 hover:bg-gray-50 transition-colors"
                                >Next →</button>
                            </div>
                        </div>
                    )}
                </div>
            </main>
        </div>
    );
}
