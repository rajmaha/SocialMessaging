import { useState, useEffect } from 'react';
import { getAuthToken } from "@/lib/auth";
import { API_URL } from '@/lib/config';

export default function TicketHistory({
    activeNumber,
    reloadKey,
    onFollowUpClick,
    ticketId
}: {
    activeNumber: string;
    reloadKey: number;
    onFollowUpClick: (ticketId: number) => void;
    ticketId?: number;
}) {
    const [history, setHistory] = useState<any[]>([]);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        if (!activeNumber && !ticketId) return;
        fetchHistory();
    }, [activeNumber, reloadKey, ticketId]);

    const fetchHistory = async () => {
        setLoading(true);
        try {
            const token = getAuthToken();
            // If ticketId is provided, fetch only that ticket's thread
            const url = ticketId
                ? `${API_URL}/api/tickets/${ticketId}/thread`
                : `${API_URL}/api/tickets/history/${activeNumber}`;
            const res = await fetch(url, {
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

    if (!activeNumber && !ticketId) {
        return (
            <div className="bg-white border border-gray-200 rounded-xl p-6 text-center text-gray-500 shadow-sm h-full flex flex-col justify-center">
                <p>Waiting for incoming call...</p>
                <p className="text-sm mt-2">Ticket history will appear here.</p>
            </div>
        );
    }

    // ── Threading: flatten all follow-ups under their root origin ticket ──────
    // A follow-up can point to another follow-up (nested), so we walk up the
    // parent chain to find the true origin and group everything under it.
    const sorted = [...history].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
    const byId: Record<number, any> = {};
    sorted.forEach(t => { byId[t.id] = t; });

    const findRoot = (t: any): number => {
        let current = t;
        while (current.parent_ticket_id && byId[current.parent_ticket_id]) {
            current = byId[current.parent_ticket_id];
        }
        return current.id;
    };

    const originTickets = sorted.filter(t => !t.parent_ticket_id);
    const followUpMap: Record<number, any[]> = {};
    sorted.forEach(t => {
        if (t.parent_ticket_id) {
            const rootId = findRoot(t);
            if (!followUpMap[rootId]) followUpMap[rootId] = [];
            followUpMap[rootId].push(t);
        }
    });

    return (
        <div className="bg-white border text-gray-900 border-gray-200 rounded-xl flex flex-col shadow-sm h-full overflow-hidden max-h-[800px]">
            <div className="bg-gray-50 px-5 py-4 border-b border-gray-200">
                <h3 className="font-bold text-gray-900">
                    {ticketId ? 'Ticket Thread' : `History for ${activeNumber}`}
                </h3>
                <p className="text-xs text-gray-500 mt-1">
                    {originTickets.length} ticket{originTickets.length !== 1 ? 's' : ''},{' '}
                    {history.length - originTickets.length} follow-up{(history.length - originTickets.length) !== 1 ? 's' : ''}
                </p>
            </div>

            <div className="overflow-y-auto flex-1 p-4 space-y-5">
                {loading ? (
                    <div className="text-center py-4">Loading...</div>
                ) : originTickets.length === 0 ? (
                    <div className="text-center py-8 text-gray-500 text-sm">
                        No previous history found for this number.
                    </div>
                ) : (
                    originTickets.map(ticket => {
                        const children = followUpMap[ticket.id] || [];
                        return (
                            <div key={ticket.id}>
                                {/* ── Origin Ticket Card ─────────────────── */}
                                <div className="border border-gray-200 rounded-lg p-4 bg-gray-50 hover:bg-white transition-colors relative shadow-sm">
                                    <div className="flex justify-between items-start mb-2">
                                        <div className="flex items-center gap-2 flex-wrap">
                                            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                                                ticket.status === 'solved'    ? 'bg-green-100 text-green-800' :
                                                ticket.status === 'forwarded' ? 'bg-yellow-100 text-yellow-800' :
                                                                                'bg-red-100 text-red-800'
                                            }`}>
                                                {ticket.status.toUpperCase()}
                                            </span>
                                            {children.length > 0 && (
                                                <span className="text-[10px] bg-indigo-50 text-indigo-600 px-2 py-0.5 rounded-full font-bold border border-indigo-100">
                                                    {children.length} follow-up{children.length !== 1 ? 's' : ''}
                                                </span>
                                            )}
                                        </div>
                                        <span className="text-xs text-gray-500 shrink-0">
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
                                        <span className={`inline-block w-2.5 h-2.5 rounded-full shrink-0 ${
                                            ticket.priority === 'urgent' ? 'bg-red-600' :
                                            ticket.priority === 'high'   ? 'bg-orange-500' :
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

                                    {/* Dynamic / application-specific fields */}
                                    {ticket.app_type_data && Object.keys(ticket.app_type_data).length > 0 && (
                                        <div className="text-sm text-gray-700 mb-4 space-y-2 bg-white p-3 rounded-lg border border-gray-100">
                                            {Object.entries(ticket.app_type_data || {}).map(([k, v]) => {
                                                if (!v || (Array.isArray(v) && v.length === 0)) return null;
                                                const displayValue = Array.isArray(v) ? v.join(', ') : String(v);
                                                return (
                                                    <div key={k} className="flex flex-col mb-1 last:mb-0">
                                                        <span className="text-[10px] font-bold text-indigo-400 uppercase tracking-widest leading-tight">{k.replace(/_/g, ' ')}</span>
                                                        <span className="text-gray-800 font-medium" style={{ wordBreak: 'break-word' }} title={displayValue}>{displayValue}</span>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    )}

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

                                {/* ── Follow-Up Thread ───────────────────── */}
                                {children.length > 0 && (
                                    <div className="ml-4 mt-1 border-l-2 border-indigo-200 pl-3 space-y-2 pt-2">
                                        {children.map((fu, idx) => {
                                            const fuNote   = fu.app_type_data?.follow_up_note;
                                            const fuAction = fu.app_type_data?.action_taken;
                                            return (
                                                <div key={fu.id} className="relative">
                                                    {/* connector dot on the left border */}
                                                    <span className="absolute -left-[17px] top-3 w-2.5 h-2.5 rounded-full bg-indigo-300 border-2 border-white"></span>
                                                    <div className="bg-indigo-50/60 border border-indigo-100 rounded-lg p-3">
                                                        <div className="flex justify-between items-center mb-1.5">
                                                            <span className="text-[10px] font-bold text-indigo-600 uppercase tracking-widest">
                                                                ↳ Follow-up #{idx + 1} · {fu.ticket_number}
                                                            </span>
                                                            <span className="text-[10px] text-gray-400 shrink-0">
                                                                {new Date(fu.created_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                                                            </span>
                                                        </div>
                                                        <div className="flex items-center gap-2 mb-2">
                                                            <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold ${
                                                                fu.status === 'solved'    ? 'bg-green-100 text-green-700' :
                                                                fu.status === 'forwarded' ? 'bg-yellow-100 text-yellow-700' :
                                                                                            'bg-red-100 text-red-700'
                                                            }`}>
                                                                {fu.status.toUpperCase()}
                                                            </span>
                                                        </div>
                                                        {fuNote && (
                                                            <div className="mb-1.5">
                                                                <p className="text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-0.5">Note</p>
                                                                <p className="text-xs text-gray-800 whitespace-pre-wrap">{fuNote}</p>
                                                            </div>
                                                        )}
                                                        {fuAction && (
                                                            <div>
                                                                <p className="text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-0.5">Action Taken</p>
                                                                <p className="text-xs text-gray-800 whitespace-pre-wrap">{fuAction}</p>
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>
                        );
                    })
                )}
            </div>
        </div>
    );
}
