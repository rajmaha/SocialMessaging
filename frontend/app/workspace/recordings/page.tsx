'use client';

import { useState, useEffect, useRef } from 'react';
import MainHeader from "@/components/MainHeader";
import { authAPI, getAuthToken } from "@/lib/auth";
import { useRouter } from 'next/navigation';
import {
    PhoneCall, PhoneIncoming, PhoneOutgoing, Clock, Play, Pause,
    Download, Search, X, Filter
} from 'lucide-react';

const API = process.env.NEXT_PUBLIC_API_URL;

export default function MyRecordings() {
    const user = authAPI.getUser();
    const router = useRouter();
    const audioRef = useRef<HTMLAudioElement | null>(null);

    const [loading, setLoading] = useState(true);
    const [recordings, setRecordings] = useState<any[]>([]);
    const [total, setTotal] = useState(0);
    const [organizations, setOrganizations] = useState<any[]>([]);
    const [playingId, setPlayingId] = useState<number | null>(null);

    // Filters
    const [phone, setPhone] = useState('');
    const [direction, setDirection] = useState('');
    const [organizationId, setOrganizationId] = useState('');
    const [dateFrom, setDateFrom] = useState('');
    const [dateTo, setDateTo] = useState('');

    // Ticket Filters
    const [ticketStatus, setTicketStatus] = useState('');
    const [ticketPriority, setTicketPriority] = useState('');
    const [ticketCategory, setTicketCategory] = useState('');

    const [page, setPage] = useState(0);
    const limit = 20;

    useEffect(() => {
        const token = getAuthToken();
        if (!token) { router.push('/login'); return; }
        fetchOrganizations();
    }, []);

    useEffect(() => {
        fetchRecordings();
    }, [phone, direction, dateFrom, dateTo, organizationId, ticketStatus, ticketPriority, ticketCategory, page]);

    const buildParams = () => {
        const p = new URLSearchParams();
        p.set('skip', String(page * limit));
        p.set('limit', String(limit));
        if (phone) p.set('phone', phone);
        if (direction) p.set('direction', direction);
        if (organizationId) p.set('organization_id', organizationId);
        if (dateFrom) p.set('date_from', dateFrom);
        if (dateTo) p.set('date_to', dateTo);
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

    const fetchOrganizations = async () => {
        try {
            const token = getAuthToken();
            const res = await fetch(`${API}/organizations`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (res.ok) setOrganizations(await res.json());
        } catch (e) { }
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
        setPhone(''); setDirection('');
        setDateFrom(''); setDateTo('');
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
    const hasActiveFilters = phone || direction || dateFrom || dateTo || organizationId || ticketStatus || ticketPriority || ticketCategory;

    if (!user) return null;

    return (
        <div className="pt-14 min-h-screen bg-gray-50">
            <MainHeader user={user} />

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

            <main className="max-w-5xl mx-auto p-6">
                {/* Header */}
                <div className="mb-6">
                    <h2 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
                        <PhoneCall className="w-7 h-7 text-indigo-600" /> My Call History
                    </h2>
                    <p className="text-gray-500 mt-1 text-sm">Review and playback your recorded calls.</p>
                </div>

                {/* Filters */}
                <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 mb-5">
                    <div className="flex items-center gap-2 mb-3">
                        <Filter className="w-4 h-4 text-gray-400" />
                        <span className="text-sm font-medium text-gray-600">Filter Calls</span>
                        {hasActiveFilters && (
                            <button onClick={clearFilters} className="ml-auto flex items-center gap-1 text-xs text-red-500 hover:text-red-700">
                                <X className="w-3 h-3" /> Clear
                            </button>
                        )}
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
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
                        <select
                            value={direction}
                            onChange={e => { setDirection(e.target.value); setPage(0); }}
                            className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-indigo-500 focus:border-indigo-500"
                        >
                            <option value="">All Directions</option>
                            <option value="inbound">Inbound</option>
                            <option value="outbound">Outbound</option>
                        </select>
                        <input
                            type="date"
                            value={dateFrom}
                            onChange={e => { setDateFrom(e.target.value); setPage(0); }}
                            className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-indigo-500 focus:border-indigo-500"
                        />
                        <input
                            type="date"
                            value={dateTo}
                            onChange={e => { setDateTo(e.target.value); setPage(0); }}
                            className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-indigo-500 focus:border-indigo-500"
                        />

                        {/* Ticket Status */}
                        <select
                            value={ticketStatus}
                            onChange={e => { setTicketStatus(e.target.value); setPage(0); }}
                            className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-indigo-500 focus:border-indigo-500"
                        >
                            <option value="">All Ticket Statuses</option>
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
                            <option value="">All Ticket Priorities</option>
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
                            <option value="">All Ticket Categories</option>
                            <option value="Technical Support">Technical Support</option>
                            <option value="Billing / Finance">Billing / Finance</option>
                            <option value="Sales / Renewal">Sales / Renewal</option>
                            <option value="General Inquiry">General Inquiry</option>
                        </select>
                    </div>
                </div>

                {/* Table */}
                <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                    <div className="px-5 py-3 border-b border-gray-100 bg-gray-50 flex items-center justify-between">
                        <span className="text-sm text-gray-500">
                            {loading ? 'Loading…' : `${total} call${total !== 1 ? 's' : ''}`}
                        </span>
                        {totalPages > 1 && (
                            <div className="flex items-center gap-2">
                                <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}
                                    className="px-3 py-1 text-xs border border-gray-300 rounded-md disabled:opacity-40 hover:bg-gray-100">← Prev</button>
                                <span className="text-xs text-gray-600">Page {page + 1} / {totalPages}</span>
                                <button onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1}
                                    className="px-3 py-1 text-xs border border-gray-300 rounded-md disabled:opacity-40 hover:bg-gray-100">Next →</button>
                            </div>
                        )}
                    </div>

                    {loading ? (
                        <div className="flex justify-center py-14"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div></div>
                    ) : recordings.length === 0 ? (
                        <div className="text-center py-14">
                            <PhoneCall className="w-10 h-10 text-gray-300 mx-auto mb-3" />
                            <p className="text-gray-500 font-medium">No calls found</p>
                            <p className="text-gray-400 text-sm mt-1">
                                {hasActiveFilters ? 'Try adjusting your filters.' : 'Your completed calls will appear here.'}
                            </p>
                        </div>
                    ) : (
                        <table className="min-w-full divide-y divide-gray-100">
                            <thead className="bg-gray-50">
                                <tr>
                                    <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Direction</th>
                                    <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Customer Phone</th>
                                    <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Date & Time</th>
                                    <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Duration</th>
                                    <th className="px-5 py-3 text-right text-xs font-semibold text-gray-500 uppercase">Audio</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100">
                                {recordings.map(rec => (
                                    <tr key={rec.id} className={`hover:bg-gray-50 transition-colors ${playingId === rec.id ? 'bg-indigo-50' : ''}`}>
                                        <td className="px-5 py-3.5">
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
                                        <td className="px-5 py-3.5">
                                            <span className="text-sm font-semibold text-gray-900 font-mono">{rec.phone_number}</span>
                                        </td>
                                        <td className="px-5 py-3.5 text-sm text-gray-500">
                                            {rec.created_at ? new Date(rec.created_at).toLocaleString() : '—'}
                                        </td>
                                        <td className="px-5 py-3.5">
                                            <div className="flex items-center gap-1.5 text-sm text-gray-600">
                                                <Clock className="w-3.5 h-3.5 text-gray-400" />
                                                {formatDuration(rec.duration_seconds)}
                                            </div>
                                        </td>
                                        <td className="px-5 py-3.5 text-right">
                                            {rec.has_audio ? (
                                                <div className="flex justify-end items-center gap-2">
                                                    {playingId === rec.id && (
                                                        <div className="flex items-center gap-0.5">
                                                            <span className="w-1 h-4 bg-indigo-500 rounded animate-pulse"></span>
                                                            <span className="w-1 h-6 bg-indigo-400 rounded animate-pulse delay-75"></span>
                                                            <span className="w-1 h-3 bg-indigo-500 rounded animate-pulse delay-150"></span>
                                                        </div>
                                                    )}
                                                    <button
                                                        onClick={() => togglePlay(rec)}
                                                        className={`p-2 rounded-full transition-all ${playingId === rec.id
                                                            ? 'bg-indigo-600 text-white'
                                                            : 'bg-gray-100 text-gray-600 hover:bg-indigo-50 hover:text-indigo-600'}`}
                                                    >
                                                        {playingId === rec.id ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 ml-0.5" />}
                                                    </button>
                                                    <a href={audioStreamUrl(rec.id)} download
                                                        className="p-2 rounded-full bg-gray-100 text-gray-500 hover:bg-gray-200 transition-colors"
                                                        title="Download">
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
                </div>
            </main>
        </div>
    );
}
