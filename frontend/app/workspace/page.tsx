'use client';

import { useState, useEffect } from 'react';
import MainHeader from "@/components/MainHeader";
import { authAPI, getAuthToken } from "@/lib/auth";
import { useRouter } from 'next/navigation';
import { Phone, Clock, PhoneCall, Headphones, PhoneIncoming, PhoneOutgoing, PhoneMissed } from 'lucide-react';
import TicketForm from "@/components/TicketForm";
import TicketHistory from "@/components/TicketHistory";
import { API_URL } from '@/lib/config';
import QuickTicketModal from '@/components/QuickTicketModal'
import { useSoftphone } from '@/lib/softphone-context'

export default function Workspace() {
    const [user, setUser] = useState<any>(null);
    const [isMounted, setIsMounted] = useState(false);
    const router = useRouter();

    const [stats, setStats] = useState({
        total_calls_today: 0,
        avg_call_duration_seconds: 0,
        follow_up_count: 0,
        forwarded_count: 0,
        status: { status: 'offline' }
    });

    // Call Center App Type
    const [appType, setAppType] = useState('cloud_hosting');

    // Ticketing Simulation State
    // activeNumber drives TicketForm and TicketHistory sidebar
    // It is now a union of the real softphone caller (when inbound call is answered)
    // and the manual simulate-call button (unchanged behavior)
    const { callerNumber: softphoneCallerNumber, isOpen: softphoneOpen, status: softphoneStatus, dial: softphoneDial, myExtension } = useSoftphone()
    const [manualActiveNumber, setManualActiveNumber] = useState<string | null>(null)
    const activeNumber = softphoneCallerNumber || manualActiveNumber
    const setActiveNumber = (n: string | null) => setManualActiveNumber(n)
    const [callerContext, setCallerContext] = useState<any>(null);
    const [reloadHistory, setReloadHistory] = useState(0);
    const [parentTicketId, setParentTicketId] = useState<number | null>(null);
    const [myTickets, setMyTickets] = useState<any[]>([]);
    const [simulateNumber, setSimulateNumber] = useState('');
    const [filterType, setFilterType] = useState<'all' | 'forwarded'>('all');
    const [quickTicketOpen, setQuickTicketOpen] = useState(false)
    const [recentCalls, setRecentCalls] = useState<any[]>([])
    const [callTab, setCallTab] = useState<'all' | 'inbound' | 'outbound' | 'missed'>('all')

    useEffect(() => {
        setIsMounted(true);
        const currentUser = authAPI.getUser();
        setUser(currentUser);

        if (currentUser) {
            fetchStats();
            fetchAppType();
            fetchMyTickets();
            fetchRecentCalls();
        } else {
            router.push('/login');
        }
    }, [reloadHistory]);

    const fetchMyTickets = async () => {
        try {
            const token = getAuthToken();
            const res = await fetch(`${API_URL}/api/tickets/my-tickets`, {
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

    const fetchRecentCalls = async () => {
        try {
            const token = getAuthToken();
            const today = new Date().toISOString().slice(0, 10);
            const res = await fetch(
                `${API_URL}/calls/recordings?date_from=${today}&limit=25`,
                { headers: { 'Authorization': `Bearer ${token}` } }
            );
            if (res.ok) {
                const data = await res.json();
                setRecentCalls(data.results || []);
            }
        } catch (e) {
            console.error(e);
        }
    };

    const fetchAppType = async () => {
        try {
            const token = getAuthToken();
            const res = await fetch(`${API_URL}/admin/callcenter/settings`, {
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

            const response = await fetch(`${API_URL}/workspace/stats`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });

            if (response.ok) {
                const data = await response.json();
                setStats(data);
            }
        } catch (error) {
            console.error('Failed to fetch workspace stats:', error);
        }
    };

    const updateStatus = async (newStatus: string) => {
        try {
            setStats({ ...stats, status: { ...stats.status, status: newStatus } });

            const token = getAuthToken();
            await fetch(`${API_URL}/workspace/status`, {
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
        if (simulateNumber.trim()) {
            setActiveNumber(simulateNumber.trim());
        } else {
            // Generates a mock phone number if input is empty
            const numbers = ['+15551234567', '+15559876543', '+447911123456'];
            const num = numbers[Math.floor(Math.random() * numbers.length)];
            setActiveNumber(num);
        }
        setParentTicketId(null);
        setCallerContext(null);
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

    if (!isMounted) return null;
    if (!user) return null;

    return (
        <div className="pt-14 min-h-screen bg-gray-50 flex flex-col pb-16 md:pb-0">
            <MainHeader user={user} />

            <main className="flex-1 w-full mx-auto p-4 md:p-6 flex flex-col lg:flex-row gap-6">

                {/* Left/Main Column: Dashboard & Ticketing Form */}
                <div className="flex-1 space-y-6 flex flex-col">

                    <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6 flex flex-col sm:flex-row gap-4 justify-between items-start sm:items-center">
                        <div>
                            <h1 className="text-2xl font-bold text-gray-900">Agent Workspace</h1>
                            <p className="text-gray-500 mt-1 flex items-center gap-2 text-sm">
                                <Headphones className="w-4 h-4" /> Ready to tackle today&apos;s queues?
                            </p>
                        </div>
                        <div className="flex flex-wrap items-center gap-4 w-full sm:w-auto">
                            <button
                              onClick={() => setQuickTicketOpen(true)}
                              className="px-4 py-2 bg-amber-100 text-amber-700 font-medium rounded-lg hover:bg-amber-200 transition text-sm flex items-center gap-2"
                            >
                              🎫 Create Ticket
                            </button>
                            {process.env.NODE_ENV !== 'production' && (
                                <div className="flex items-center gap-2">
                                    <input
                                        type="text"
                                        placeholder="Phone # (optional)"
                                        value={simulateNumber}
                                        onChange={(e) => setSimulateNumber(e.target.value)}
                                        className="w-36 text-sm border border-gray-300 rounded-lg py-2 px-3 focus:outline-none focus:ring-2 focus:ring-indigo-200"
                                    />
                                    <button
                                        onClick={simulateIncomingCall}
                                        className="px-4 py-2 bg-indigo-100 text-indigo-700 font-medium rounded-lg hover:bg-indigo-200 transition text-sm flex items-center gap-2"
                                    >
                                        <PhoneCall className="w-4 h-4" /> Simulate Call
                                    </button>
                                </div>
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
                                <div className="flex gap-3 mt-1">
                                    <span className="text-xs text-indigo-600 font-medium">{stats.follow_up_count} follow-ups</span>
                                    <span className="text-xs text-orange-600 font-medium">{stats.forwarded_count} forwarded</span>
                                </div>
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
                                <div className="p-6 bg-gray-50 flex-1">
                                    <TicketForm
                                        activeNumber={activeNumber}
                                        appType={appType}
                                        parentTicketId={parentTicketId}
                                        onTicketSaved={() => setReloadHistory(prev => prev + 1)}
                                        onContextChange={(ctx) => setCallerContext(ctx)}
                                        callerContext={callerContext}
                                        onEndCall={() => { setActiveNumber(null); setParentTicketId(null); setCallerContext(null); }}
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
                                Inbox
                                <span className="bg-indigo-100 text-indigo-800 text-xs px-2 py-0.5 rounded-full">{myTickets.length}</span>
                            </h3>

                            <div className="flex gap-2">
                                <button
                                    onClick={() => setFilterType('all')}
                                    className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors ${filterType === 'all' ? 'bg-indigo-600 text-white shadow-sm' : 'bg-white text-gray-600 border border-gray-300 hover:bg-gray-50'}`}
                                >
                                    My Open Tickets
                                </button>
                                <button
                                    onClick={() => setFilterType('forwarded')}
                                    className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors ${filterType === 'forwarded' ? 'bg-indigo-600 text-white shadow-sm' : 'bg-white text-gray-600 border border-gray-300 hover:bg-gray-50'}`}
                                >
                                    Forwarded to Me
                                </button>
                            </div>
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
                                                <th className="px-6 py-3 font-medium text-gray-900 text-right">Action</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-gray-100">
                                            {myTickets
                                                .filter(t => filterType === 'all' || t.status === 'forwarded')
                                                .map(ticket => (
                                                    <tr key={ticket.id} className="hover:bg-gray-50 transition-colors">
                                                        <td className="px-6 py-4 font-medium text-indigo-600">
                                                            {ticket.ticket_number}
                                                            {ticket.parent_ticket_id && (
                                                                <span title={`Follow up to #${ticket.parent_ticket_id}`} className="ml-2 inline-block w-2 h-2 rounded-full bg-blue-400"></span>
                                                            )}
                                                        </td>
                                                        <td className="px-6 py-4">
                                                            <div className="font-medium text-gray-900">{ticket.customer_name || 'Unknown'}</div>
                                                            <button
                                                                onClick={(e) => { e.stopPropagation(); initiateCall(ticket.phone_number); }}
                                                                className="text-xs text-indigo-600 hover:text-indigo-800 hover:underline flex items-center gap-1 mt-1 font-medium transition-colors"
                                                                title="Click to call"
                                                            >
                                                                <Phone className="w-3 h-3" />
                                                                {ticket.phone_number}
                                                            </button>
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
                                                        <td className="px-6 py-4 text-right">
                                                            <button
                                                                onClick={() => router.push(`/workspace/tickets/${ticket.ticket_number}?from=workspace`)}
                                                                className="px-3 py-1.5 bg-indigo-50 text-indigo-600 hover:bg-indigo-100 rounded-lg text-xs font-semibold transition-colors"
                                                            >
                                                                Follow Up
                                                            </button>
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
                            <div className="flex flex-col h-full gap-3">
                              {/* Softphone status card (compact) */}
                              <div className="bg-white rounded-2xl shadow-sm border border-gray-200 flex flex-col items-center p-5 gap-3">
                                <div className="flex items-center gap-3">
                                  <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
                                    softphoneStatus === 'registered' ? 'bg-green-100' :
                                    softphoneStatus === 'registering' ? 'bg-yellow-100' :
                                    softphoneStatus === 'unauthorized' || softphoneStatus === 'no_extension' ? 'bg-gray-100' :
                                    'bg-red-100'
                                  }`}>
                                    <Phone className={`w-5 h-5 ${
                                      softphoneStatus === 'registered' ? 'text-green-600' :
                                      softphoneStatus === 'registering' ? 'text-yellow-600 animate-pulse' :
                                      softphoneStatus === 'unauthorized' || softphoneStatus === 'no_extension' ? 'text-gray-400' :
                                      'text-red-500'
                                    }`} />
                                  </div>
                                  <div>
                                    <p className="font-semibold text-gray-800 text-sm">
                                      {softphoneStatus === 'registered' ? 'Softphone Ready' :
                                       softphoneStatus === 'registering' ? 'Connecting…' :
                                       softphoneStatus === 'unauthorized' ? 'Dial Not Available' :
                                       softphoneStatus === 'no_extension' ? 'No Extension Assigned' :
                                       softphoneStatus === 'error' ? 'Connection Failed' : 'Loading…'}
                                    </p>
                                    <div className="flex items-center gap-2 mt-0.5">
                                      {user?.full_name && (
                                        <span className="text-xs text-gray-500">{user.full_name}</span>
                                      )}
                                      {myExtension && (
                                        <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-indigo-100 text-indigo-700">
                                          <Phone className="w-2.5 h-2.5" /> {myExtension}
                                        </span>
                                      )}
                                    </div>
                                  </div>
                                  {softphoneStatus === 'registered' && !softphoneOpen && (
                                    <button
                                      onClick={() => softphoneDial('')}
                                      className="ml-auto px-3 py-1.5 bg-indigo-600 text-white rounded-lg font-medium text-xs hover:bg-indigo-700 transition flex items-center gap-1.5"
                                    >
                                      <Phone className="w-3 h-3" /> Dial
                                    </button>
                                  )}
                                </div>
                              </div>

                              {/* Today's Recent Calls */}
                              <div className="bg-white rounded-2xl shadow-sm border border-gray-200 flex-1 flex flex-col overflow-hidden">
                                {/* Header + Tabs */}
                                <div className="border-b border-gray-100">
                                  <div className="px-4 pt-3 pb-2 flex items-center justify-between">
                                    <div className="flex items-center gap-2">
                                      <Clock className="w-4 h-4 text-gray-400" />
                                      <h3 className="text-sm font-semibold text-gray-700">Today&apos;s Calls</h3>
                                    </div>
                                    <span className="text-xs text-gray-400 font-medium">{recentCalls.length} total</span>
                                  </div>
                                  <div className="flex px-3 gap-1">
                                    {([
                                      { key: 'all', label: 'All' },
                                      { key: 'inbound', label: 'Incoming' },
                                      { key: 'outbound', label: 'Outgoing' },
                                      { key: 'missed', label: 'Missed' },
                                    ] as const).map(tab => {
                                      const count = tab.key === 'all' ? recentCalls.length
                                        : tab.key === 'missed' ? recentCalls.filter(c => c.disposition === 'NO ANSWER' || c.disposition === 'BUSY' || c.disposition === 'FAILED').length
                                        : recentCalls.filter(c => c.direction === tab.key).length
                                      return (
                                        <button
                                          key={tab.key}
                                          onClick={() => setCallTab(tab.key)}
                                          className={`px-2.5 py-1.5 text-xs font-medium rounded-t-lg transition ${
                                            callTab === tab.key
                                              ? 'bg-indigo-50 text-indigo-700 border-b-2 border-indigo-600'
                                              : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'
                                          }`}
                                        >
                                          {tab.label}{count > 0 ? ` (${count})` : ''}
                                        </button>
                                      )
                                    })}
                                  </div>
                                </div>

                                <div className="flex-1 overflow-y-auto">
                                  {(() => {
                                    const filtered = recentCalls.filter(call => {
                                      const isMissed = call.disposition === 'NO ANSWER' || call.disposition === 'BUSY' || call.disposition === 'FAILED'
                                      if (callTab === 'all') return true
                                      if (callTab === 'missed') return isMissed
                                      if (callTab === 'inbound') return call.direction === 'inbound'
                                      if (callTab === 'outbound') return call.direction === 'outbound'
                                      return true
                                    })
                                    if (filtered.length === 0) return (
                                      <div className="flex flex-col items-center justify-center py-12 text-gray-400">
                                        <PhoneCall className="w-8 h-8 mb-2 opacity-40" />
                                        <p className="text-sm">
                                          {callTab === 'all' ? 'No calls today' :
                                           callTab === 'missed' ? 'No missed calls' :
                                           callTab === 'inbound' ? 'No incoming calls' : 'No outgoing calls'}
                                        </p>
                                      </div>
                                    )
                                    return (
                                    <div className="divide-y divide-gray-50">
                                      {filtered.map((call: any) => {
                                        const isInbound = call.direction === 'inbound'
                                        const isMissed = call.disposition === 'NO ANSWER' || call.disposition === 'BUSY' || call.disposition === 'FAILED'
                                        const dur = call.duration_seconds || 0
                                        const durStr = dur > 0
                                          ? `${Math.floor(dur / 60)}m ${dur % 60}s`
                                          : isMissed ? 'Missed' : '0s'
                                        // Format time-only — treat naive timestamps as local time (not UTC)
                                        let time = ''
                                        if (call.created_at) {
                                          // Backend returns timezone-aware ISO (e.g. "16:07:48+05:45").
                                          // new Date() correctly converts to UTC, then toLocaleTimeString
                                          // converts to the browser's local timezone for display.
                                          const d = new Date(call.created_at)
                                          if (!isNaN(d.getTime())) {
                                            time = d.toLocaleTimeString('en-US', {
                                              hour: 'numeric', minute: '2-digit', hour12: true,
                                            })
                                          }
                                        }

                                        return (
                                          <div
                                            key={call.id}
                                            className="px-4 py-2.5 hover:bg-gray-50 transition cursor-pointer flex items-center gap-3"
                                            onClick={() => {
                                              if (call.phone_number) {
                                                softphoneDial(call.phone_number)
                                              }
                                            }}
                                            title={`Click to call ${call.phone_number}`}
                                          >
                                            {/* Direction icon */}
                                            <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${
                                              isMissed ? 'bg-red-50' : isInbound ? 'bg-blue-50' : 'bg-green-50'
                                            }`}>
                                              {isMissed ? (
                                                <PhoneMissed className="w-3.5 h-3.5 text-red-500" />
                                              ) : isInbound ? (
                                                <PhoneIncoming className="w-3.5 h-3.5 text-blue-500" />
                                              ) : (
                                                <PhoneOutgoing className="w-3.5 h-3.5 text-green-600" />
                                              )}
                                            </div>

                                            {/* Call info */}
                                            <div className="flex-1 min-w-0">
                                              <div className="flex items-center gap-1.5">
                                                <span className="text-sm font-medium text-gray-800 truncate">
                                                  {call.customer_name || call.phone_number || 'Unknown'}
                                                </span>
                                              </div>
                                              <div className="flex items-center gap-2 mt-0.5">
                                                {call.customer_name && call.phone_number && (
                                                  <span className="text-[11px] text-gray-400">{call.phone_number}</span>
                                                )}
                                                {call.ticket_number && (
                                                  <span className="text-[10px] font-medium text-indigo-600 bg-indigo-50 px-1.5 py-0.5 rounded">
                                                    {call.ticket_number}
                                                  </span>
                                                )}
                                              </div>
                                            </div>

                                            {/* Time + duration */}
                                            <div className="text-right flex-shrink-0">
                                              <p className="text-xs text-gray-500">{time}</p>
                                              <p className={`text-[11px] font-medium ${isMissed ? 'text-red-500' : 'text-gray-400'}`}>
                                                {durStr}
                                              </p>
                                            </div>
                                          </div>
                                        )
                                      })}
                                    </div>
                                    )
                                  })()}
                                </div>
                              </div>
                            </div>
                        )}
                    </div>
                </div>

            </main>
            <QuickTicketModal
                open={quickTicketOpen}
                onClose={() => setQuickTicketOpen(false)}
                onCreated={() => { setQuickTicketOpen(false); fetchMyTickets() }}
                prefill={{}}
            />
        </div>
    );
}
