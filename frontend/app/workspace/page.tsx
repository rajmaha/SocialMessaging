'use client';

import { useState, useEffect } from 'react';
import MainHeader from "@/components/MainHeader";
import { authAPI, getAuthToken } from "@/lib/auth";
import { useRouter } from 'next/navigation';
import { Phone, Clock, PhoneMissed, PhoneCall, Headphones, X } from 'lucide-react';
import TicketForm from "@/components/TicketForm";
import TicketHistory from "@/components/TicketHistory";

export default function Workspace() {
    const [user, setUser] = useState<any>(null);
    const [isMounted, setIsMounted] = useState(false);
    const router = useRouter();

    const [loading, setLoading] = useState(true);
    const [stats, setStats] = useState({
        total_calls_today: 0,
        avg_call_duration_seconds: 0,
        status: { status: 'offline' }
    });

    // Call Center App Type
    const [appType, setAppType] = useState('cloud_hosting');

    // Ticketing Simulation State
    const [activeNumber, setActiveNumber] = useState<string | null>(null);
    const [reloadHistory, setReloadHistory] = useState(0);
    const [parentTicketId, setParentTicketId] = useState<number | null>(null);
    const [myTickets, setMyTickets] = useState<any[]>([]);

    useEffect(() => {
        setIsMounted(true);
        const currentUser = authAPI.getUser();
        setUser(currentUser);

        if (currentUser) {
            fetchStats();
            fetchAppType();
            fetchMyTickets();
        } else {
            router.push('/login');
        }
    }, [reloadHistory]);

    const fetchMyTickets = async () => {
        try {
            const token = getAuthToken();
            const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/tickets/my-tickets`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (res.ok) {
                const data = await res.json();
                setMyTickets(data);
            }
        } catch (e) {
            console.error(e);
        }
    };

    const fetchAppType = async () => {
        try {
            const token = getAuthToken();
            const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/admin/callcenter/settings`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (res.ok) {
                const data = await res.json();
                if (data.application_type) {
                    setAppType(data.application_type);
                }
            }
        } catch (e) {
            console.error(e);
        }
    };

    const fetchStats = async () => {
        try {
            const token = getAuthToken();
            if (!token) return router.push('/login');

            const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/workspace/stats`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });

            if (response.ok) {
                const data = await response.json();
                setStats(data);
            }
        } catch (error) {
            console.error('Failed to fetch workspace stats:', error);
        } finally {
            setLoading(false);
        }
    };

    const updateStatus = async (newStatus: string) => {
        try {
            setStats({ ...stats, status: { ...stats.status, status: newStatus } });

            const token = getAuthToken();
            await fetch(`${process.env.NEXT_PUBLIC_API_URL}/workspace/status`, {
                method: 'PUT',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ status: newStatus })
            });
        } catch (error) {
            console.error('Failed to update status:', error);
        }
    };

    const formatDuration = (seconds: number) => {
        const mins = Math.floor(seconds / 60);
        const s = seconds % 60;
        return `${mins}m ${s}s`;
    };

    const simulateIncomingCall = () => {
        // Generates a mock phone number
        const numbers = ['+15551234567', '+15559876543', '+447911123456'];
        const num = numbers[Math.floor(Math.random() * numbers.length)];
        setActiveNumber(num);
        setParentTicketId(null);
    };

    if (!isMounted) return null;
    if (!user) return null;

    return (
        <div className="pt-14 min-h-screen bg-gray-50 flex flex-col">
            <MainHeader user={user} />

            <main className="flex-1 w-full mx-auto p-4 md:p-6 flex flex-col lg:flex-row gap-6">

                {/* Left/Main Column: Dashboard & Ticketing Form */}
                <div className="flex-1 space-y-6 flex flex-col max-w-5xl">

                    <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6 flex flex-col sm:flex-row gap-4 justify-between items-start sm:items-center">
                        <div>
                            <h1 className="text-2xl font-bold text-gray-900">Agent Workspace</h1>
                            <p className="text-gray-500 mt-1 flex items-center gap-2 text-sm">
                                <Headphones className="w-4 h-4" /> Ready to tackle today's queues?
                            </p>
                        </div>
                        <div className="flex flex-wrap items-center gap-4 w-full sm:w-auto">
                            {process.env.NODE_ENV !== 'production' && (
                                <button
                                    onClick={simulateIncomingCall}
                                    className="px-4 py-2 bg-indigo-100 text-indigo-700 font-medium rounded-lg hover:bg-indigo-200 transition text-sm flex items-center gap-2"
                                >
                                    <PhoneCall className="w-4 h-4" /> Simulate Call
                                </button>
                            )}
                            <div className="relative inline-block w-40">
                                <select
                                    value={stats.status.status}
                                    onChange={(e) => updateStatus(e.target.value)}
                                    className="block w-full appearance-none bg-white border border-gray-300 text-gray-700 py-2 rounded-lg leading-tight focus:outline-none focus:ring-2 focus:ring-indigo-200 pl-3 pr-8 shadow-sm font-medium transition-all text-sm"
                                >
                                    <option value="available">🟢 Available</option>
                                    <option value="busy">🔴 Busy</option>
                                    <option value="away">🟡 Away</option>
                                    <option value="offline">⚪ Offline</option>
                                </select>
                            </div>
                        </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-5 flex items-center gap-4">
                            <div className="w-12 h-12 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center">
                                <PhoneCall className="w-6 h-6" />
                            </div>
                            <div>
                                <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Calls Today</p>
                                <h3 className="text-xl font-bold text-gray-900">{stats.total_calls_today}</h3>
                            </div>
                        </div>

                        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-5 flex items-center gap-4">
                            <div className="w-12 h-12 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center">
                                <Clock className="w-6 h-6" />
                            </div>
                            <div>
                                <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Avg Handle Time</p>
                                <h3 className="text-xl font-bold text-gray-900">{formatDuration(stats.avg_call_duration_seconds)}</h3>
                            </div>
                        </div>

                        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-5 flex items-center gap-4 relative overflow-hidden">
                            <div className="absolute top-0 right-0 p-2 opacity-10 blur-sm pointer-events-none">
                                <Phone className="w-16 h-16 text-indigo-600" />
                            </div>
                            <div>
                                <p className="text-xs font-medium text-indigo-500 uppercase tracking-wide">Application Type</p>
                                <h3 className="text-lg font-bold text-gray-900 capitalize mt-1">
                                    {appType.replace('_', ' ')}
                                </h3>
                            </div>
                        </div>
                    </div>

                    {/* Ticketing Area */}
                    <div className="flex-1 bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden min-h-[400px]">
                        {activeNumber ? (
                            <div className="h-full flex flex-col">
                                <div className="bg-gradient-to-r from-indigo-600 to-indigo-800 text-white p-4 flex justify-between items-center">
                                    <div className="flex items-center gap-3">
                                        <div className="w-10 h-10 bg-white/20 rounded-full flex items-center justify-center animate-pulse">
                                            <PhoneCall className="w-5 h-5 text-white" />
                                        </div>
                                        <div>
                                            <h2 className="font-semibold text-lg">Active Call: {activeNumber}</h2>
                                            <p className="text-indigo-100 text-xs">Fill ticket details below</p>
                                        </div>
                                    </div>
                                    <button
                                        onClick={() => { setActiveNumber(null); setParentTicketId(null); }}
                                        className="p-2 hover:bg-white/10 rounded-full transition"
                                        title="End Call"
                                    >
                                        <X className="w-5 h-5" />
                                    </button>
                                </div>

                                <div className="p-6 bg-gray-50 flex-1">
                                    <TicketForm
                                        activeNumber={activeNumber}
                                        appType={appType}
                                        parentTicketId={parentTicketId}
                                        onTicketSaved={() => setReloadHistory(prev => prev + 1)}
                                    />
                                </div>
                            </div>
                        ) : (
                            <div className="h-full flex flex-col justify-center items-center py-20">
                                <img src="/illustrations/empty-state.svg" onError={(e) => { e.currentTarget.style.display = 'none'; }} alt="Empty state" className="w-48 mb-6 opacity-60" />
                                <h3 className="text-xl font-bold text-gray-800 mb-2">Ready for Calls</h3>
                                <p className="text-gray-500 text-center text-sm max-w-sm">When a call connects, the ticketing form and customer history will automatically appear here.</p>
                            </div>
                        )}
                    </div>

                    {/* Agent Inbox: My Tickets */}
                    <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
                        <div className="bg-gray-50 px-6 py-4 border-b border-gray-200 flex justify-between items-center">
                            <h3 className="font-bold text-gray-900 flex items-center gap-2">
                                Inbox: My Open Tickets
                                <span className="bg-indigo-100 text-indigo-800 text-xs px-2 py-0.5 rounded-full">{myTickets.length}</span>
                            </h3>
                        </div>
                        <div className="p-0">
                            {myTickets.length === 0 ? (
                                <div className="p-8 text-center text-gray-500 text-sm">
                                    You have no open/pending tickets assigned to you!
                                </div>
                            ) : (
                                <div className="overflow-x-auto">
                                    <table className="w-full text-left text-sm text-gray-600">
                                        <thead className="bg-gray-50 border-b">
                                            <tr>
                                                <th className="px-6 py-3 font-medium text-gray-900">Ticket #</th>
                                                <th className="px-6 py-3 font-medium text-gray-900">Customer</th>
                                                <th className="px-6 py-3 font-medium text-gray-900">Status</th>
                                                <th className="px-6 py-3 font-medium text-gray-900">Date</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-gray-100">
                                            {myTickets.map(ticket => (
                                                <tr key={ticket.id} className="hover:bg-gray-50 transition-colors">
                                                    <td className="px-6 py-4 font-medium text-indigo-600">
                                                        {ticket.ticket_number}
                                                        {ticket.parent_ticket_id && (
                                                            <span title={`Follow up to #${ticket.parent_ticket_id}`} className="ml-2 inline-block w-2 h-2 rounded-full bg-blue-400"></span>
                                                        )}
                                                    </td>
                                                    <td className="px-6 py-4">
                                                        <div className="font-medium text-gray-900">{ticket.customer_name || 'Unknown'}</div>
                                                        <div className="text-xs text-gray-500">{ticket.phone_number}</div>
                                                    </td>
                                                    <td className="px-6 py-4">
                                                        <span className={`text-xs px-2 py-1 rounded-md font-medium ${ticket.status === 'forwarded' ? 'bg-orange-100 text-orange-800' : 'bg-blue-100 text-blue-800'
                                                            }`}>
                                                            {ticket.status.toUpperCase()}
                                                        </span>
                                                        <span className="ml-2 text-xs text-gray-500 truncate inline-block max-w-[100px] align-bottom">
                                                            P: {ticket.priority}
                                                        </span>
                                                    </td>
                                                    <td className="px-6 py-4 text-xs text-gray-500 whitespace-nowrap">
                                                        {new Date(ticket.created_at).toLocaleDateString()}
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                        </div>
                    </div>

                </div>

                {/* Right Column: Ticket History Sidebar (Or Softphone Placeholder) */}
                <div className="w-full lg:w-96 flex flex-col bg-gray-50">
                    <div className="flex-1">
                        {activeNumber ? (
                            <TicketHistory
                                activeNumber={activeNumber}
                                reloadKey={reloadHistory}
                                onFollowUpClick={(id) => setParentTicketId(id)}
                            />
                        ) : (
                            <div className="bg-white rounded-2xl shadow-xl border border-gray-200 overflow-hidden flex-1 relative flex flex-col items-center justify-center p-8 bg-gradient-to-br from-indigo-500 to-purple-600 text-white h-full min-h-[400px]">
                                <Phone className="w-16 h-16 text-white opacity-90 mb-6 drop-shadow-md" />
                                <h2 className="text-2xl font-bold mb-2 tracking-wide text-center drop-shadow-sm">Global Softphone</h2>
                                <p className="text-indigo-100 text-center text-sm px-4 leading-relaxed font-medium mt-4">
                                    Your PBX WebRTC Softphone is currently docked.
                                </p>
                                <div className="absolute top-[-20%] right-[-10%] w-64 h-64 bg-white opacity-10 rounded-full blur-3xl mix-blend-overlay"></div>
                                <div className="absolute bottom-[-10%] left-[-20%] w-80 h-80 bg-purple-300 opacity-20 rounded-full blur-3xl mix-blend-overlay"></div>
                            </div>
                        )}
                    </div>
                </div>

            </main>
        </div>
    );
}
