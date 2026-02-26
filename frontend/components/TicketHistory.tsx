import { useState, useEffect } from 'react';
import { getAuthToken } from "@/lib/auth";

export default function TicketHistory({
    activeNumber,
    reloadKey,
    onFollowUpClick
}: {
    activeNumber: string;
    reloadKey: number;
    onFollowUpClick: (ticketId: number) => void;
}) {
    const [history, setHistory] = useState<any[]>([]);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        if (!activeNumber) return;
        fetchHistory();
    }, [activeNumber, reloadKey]);

    const fetchHistory = async () => {
        setLoading(true);
        try {
            const token = getAuthToken();
            const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/tickets/history/${activeNumber}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (res.ok) {
                const data = await res.json();
                setHistory(data);
            }
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    };

    if (!activeNumber) {
        return (
            <div className="bg-white border border-gray-200 rounded-xl p-6 text-center text-gray-500 shadow-sm h-full flex flex-col justify-center">
                <p>Waiting for incoming call...</p>
                <p className="text-sm mt-2">Ticket history will appear here.</p>
            </div>
        );
    }

    return (
        <div className="bg-white border text-gray-900 border-gray-200 rounded-xl flex flex-col shadow-sm h-full overflow-hidden max-h-[800px]">
            <div className="bg-gray-50 px-5 py-4 border-b border-gray-200">
                <h3 className="font-bold text-gray-900">History for {activeNumber}</h3>
                <p className="text-xs text-gray-500 mt-1">{history.length} Previous Tickets</p>
            </div>

            <div className="overflow-y-auto flex-1 p-4 space-y-4">
                {loading ? (
                    <div className="text-center py-4">Loading...</div>
                ) : history.length === 0 ? (
                    <div className="text-center py-8 text-gray-500 text-sm">
                        No previous history found for this number.
                    </div>
                ) : (
                    history.map(ticket => (
                        <div key={ticket.id} className="border border-gray-200 rounded-lg p-4 bg-gray-50 hover:bg-white transition-colors relative shadow-sm">
                            <div className="flex justify-between items-start mb-2">
                                <div className="flex items-center gap-2">
                                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${ticket.status === 'solved' ? 'bg-green-100 text-green-800' :
                                        ticket.status === 'forwarded' ? 'bg-yellow-100 text-yellow-800' :
                                            'bg-red-100 text-red-800'
                                        }`}>
                                        {ticket.status.toUpperCase()}
                                    </span>
                                    {ticket.parent_ticket_id && (
                                        <span className="text-[10px] bg-blue-50 text-blue-600 px-2 py-0.5 rounded-full font-bold border border-blue-100 flex items-center gap-1">
                                            🔗 LINKED ISSUE
                                        </span>
                                    )}
                                </div>
                                <span className="text-xs text-gray-500">
                                    {new Date(ticket.created_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                                </span>
                            </div>

                            <div className="flex justify-between items-start mb-3 border-b border-gray-100 pb-2">
                                <div>
                                    <p className="text-[10px] font-bold text-indigo-500 uppercase tracking-tighter mb-0.5">Ticket #{ticket.ticket_number}</p>
                                    <h4 className="font-bold text-gray-900 text-sm">
                                        {ticket.customer_name || 'Unknown Caller'}
                                    </h4>
                                </div>
                            </div>

                            <div className="text-sm mb-3 flex items-center gap-2">
                                <span className={`inline-block w-2.5 h-2.5 rounded-full ${ticket.priority === 'urgent' ? 'bg-red-600' :
                                    ticket.priority === 'high' ? 'bg-orange-500' :
                                        ticket.priority === 'normal' ? 'bg-blue-500' : 'bg-gray-400'
                                    }`} title={`Priority: ${ticket.priority}`}></span>
                                <span className="font-semibold text-gray-800 capitalize">
                                    Priority: {ticket.priority}
                                </span>
                                {ticket.category && (
                                    <span className="text-xs bg-gray-200 text-gray-700 px-2 py-0.5 rounded-md ml-auto">
                                        {ticket.category}
                                    </span>
                                )}
                            </div>

                            <div className="text-sm text-gray-700 mb-4 space-y-2 bg-white p-3 rounded-lg border border-gray-100">
                                {Object.entries(ticket.app_type_data || {}).map(([k, v]) => {
                                    if (!v || (Array.isArray(v) && v.length === 0)) return null;
                                    const displayValue = Array.isArray(v) ? v.join(', ') : String(v);

                                    return (
                                        <div key={k} className="flex flex-col mb-1 last:mb-0">
                                            <span className="text-[10px] font-bold text-indigo-400 uppercase tracking-widest leading-tight">{k.replace('_', ' ')}</span>
                                            <span className="text-gray-800 font-medium" style={{ wordBreak: 'break-word' }} title={displayValue}>{displayValue}</span>
                                        </div>
                                    );
                                })}
                            </div>

                            {ticket.status === 'forwarded' && (
                                <div className="mb-4 bg-orange-50 text-orange-900 text-xs p-2.5 rounded border border-orange-100 italic">
                                    <span className="font-bold border-b border-orange-200 pb-0.5 mb-1 block">Escalated to: {ticket.forward_target}</span>
                                    {ticket.forward_reason}
                                </div>
                            )}

                            <button
                                onClick={() => onFollowUpClick(ticket.id)}
                                className="w-full text-center text-xs text-indigo-600 font-bold tracking-wide py-2 bg-indigo-50 hover:bg-indigo-100 rounded-md transition-colors border border-indigo-100"
                            >
                                START FOLLOW-UP THREAD ↳
                            </button>
                        </div>
                    ))
                )}
            </div>
        </div>
    );
}
