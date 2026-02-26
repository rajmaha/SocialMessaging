'use client';

import { useState, useEffect } from 'react';
import MainHeader from "@/components/MainHeader";
import { authAPI, getAuthToken } from "@/lib/auth";
import { useRouter } from 'next/navigation';
import { Phone, Clock, PhoneMissed, PhoneCall, Headphones, CheckCircle, MinusCircle, Moon } from 'lucide-react';

export default function Workspace() {
    const user = authAPI.getUser();
    const router = useRouter();

    const [loading, setLoading] = useState(true);
    const [stats, setStats] = useState({
        total_calls_today: 0,
        avg_call_duration_seconds: 0,
        status: { status: 'offline' }
    });

    useEffect(() => {
        fetchStats();
    }, []);

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

    const getStatusColor = (status: string) => {
        switch (status) {
            case 'available': return 'bg-green-500';
            case 'busy': return 'bg-red-500';
            case 'away': return 'bg-yellow-500';
            default: return 'bg-gray-400';
        }
    };

    const formatDuration = (seconds: number) => {
        const mins = Math.floor(seconds / 60);
        const s = seconds % 60;
        return `${mins}m ${s}s`;
    };

    if (!user) return null;

    return (
        <div className="pt-14 min-h-screen bg-gray-50 flex flex-col">
            <MainHeader user={user} />

            <main className="flex-1 max-w-7xl w-full mx-auto p-6 md:p-8 flex gap-8">
                {/* Left Column: Dashboard */}
                <div className="flex-1 space-y-6">

                    <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8 flex justify-between items-center">
                        <div>
                            <h1 className="text-3xl font-bold text-gray-900">Good Morning, {user.full_name || 'Agent'}</h1>
                            <p className="text-gray-500 mt-2 flex items-center gap-2">
                                <Headphones className="w-5 h-5" /> Ready to tackle today's queues?
                            </p>
                        </div>
                        <div>
                            <div className="relative inline-block w-48">
                                <select
                                    value={stats.status.status}
                                    onChange={(e) => updateStatus(e.target.value)}
                                    className="block w-full appearance-none bg-white border border-gray-300 text-gray-700 py-3 rounded-xl leading-tight focus:outline-none focus:bg-white focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 pl-4 pr-10 shadow-sm font-medium transition-all"
                                >
                                    <option value="available">🟢 Available</option>
                                    <option value="busy">🔴 Busy / DND</option>
                                    <option value="away">🟡 Away</option>
                                    <option value="offline">⚪ Offline</option>
                                </select>
                                <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-4 text-gray-700">
                                    <svg className="fill-current h-4 w-4" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><path d="M9.293 12.95l.707.707L15.657 8l-1.414-1.414L10 10.828 5.757 6.586 4.343 8z" /></svg>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6 flex items-center gap-4">
                            <div className="w-14 h-14 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center">
                                <PhoneCall className="w-7 h-7" />
                            </div>
                            <div>
                                <p className="text-sm font-medium text-gray-500">Calls Handled Today</p>
                                <h3 className="text-2xl font-bold text-gray-900">{stats.total_calls_today}</h3>
                            </div>
                        </div>

                        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6 flex items-center gap-4">
                            <div className="w-14 h-14 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center">
                                <Clock className="w-7 h-7" />
                            </div>
                            <div>
                                <p className="text-sm font-medium text-gray-500">Average Handle Time</p>
                                <h3 className="text-2xl font-bold text-gray-900">{formatDuration(stats.avg_call_duration_seconds)}</h3>
                            </div>
                        </div>

                        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6 flex items-center gap-4">
                            <div className="w-14 h-14 rounded-xl bg-red-50 text-red-600 flex items-center justify-center">
                                <PhoneMissed className="w-7 h-7" />
                            </div>
                            <div>
                                <p className="text-sm font-medium text-gray-500">Missed Calls</p>
                                <h3 className="text-2xl font-bold text-gray-900">0</h3>
                            </div>
                        </div>
                    </div>

                    <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6 flex flex-col justify-center items-center min-h-[300px]">
                        <img src="/illustrations/empty-state.svg" onError={(e) => { e.currentTarget.style.display = 'none'; }} alt="Empty state" className="w-48 mb-6 opacity-80" />
                        <h3 className="text-xl font-bold text-gray-800 mb-2">No active sessions</h3>
                        <p className="text-gray-500 text-center max-w-md">When a call or chat arrives, it will automatically populate your workspace context here. Stay tuned!</p>
                    </div>

                </div>

                {/* Right Column: Embedded Softphone Placeholder */}
                <div className="w-96 hidden lg:flex flex-col">
                    <div className="bg-white rounded-2xl shadow-xl border border-gray-200 overflow-hidden flex-1 relative flex flex-col items-center justify-center p-8 bg-gradient-to-br from-indigo-500 to-purple-600 text-white">
                        <Phone className="w-16 h-16 text-white opacity-90 mb-6 drop-shadow-md" />
                        <h2 className="text-2xl font-bold mb-2 tracking-wide text-center drop-shadow-sm">Global Softphone</h2>
                        <p className="text-indigo-100 text-center text-sm px-4 leading-relaxed font-medium">
                            Your PBX WebRTC Softphone is currently docked in your layout.<br /><br />
                            Use the floating dialer button to make or receive calls seamlessly while navigating the platform.
                        </p>

                        <div className={`mt-8 px-6 py-2 rounded-full border-2 border-white border-opacity-30 flex items-center gap-2 font-semibold shadow-inner transition-colors duration-500 ${stats.status.status === 'available' ? 'bg-green-500/80 text-white' : stats.status.status === 'busy' ? 'bg-red-500/80 text-white' : 'bg-white/20 text-white'}`}>
                            <span className={`w-2.5 h-2.5 rounded-full shadow-[0_0_8px_rgba(255,255,255,0.8)] ${stats.status.status === 'available' ? 'bg-white animate-pulse' : 'bg-gray-300'}`}></span>
                            Status: {stats.status.status.toUpperCase()}
                        </div>

                        {/* Background floating elements for aesthetics */}
                        <div className="absolute top-[-20%] right-[-10%] w-64 h-64 bg-white opacity-10 rounded-full blur-3xl mix-blend-overlay"></div>
                        <div className="absolute bottom-[-10%] left-[-20%] w-80 h-80 bg-purple-300 opacity-20 rounded-full blur-3xl mix-blend-overlay"></div>
                    </div>
                </div>
            </main>
        </div>
    );
}
