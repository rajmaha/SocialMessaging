'use client';

/**
 * Live help on a support ticket: Call phone, Ask to talk, Ask to see screen.
 * Only the agent holding the request can start it; the customer accepts or denies
 * in their widget (or the app). Media goes peer to peer (lib/live-help.ts); nothing
 * is recorded. Rules: app/services/support_live.py; agent routes at the end of
 * app/routes/tickets.py.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { getAuthToken } from '@/lib/auth';
import { API_URL } from '@/lib/config';
import { LiveCall, LivePhase, socketUrl } from '@/lib/live-help';
import { Phone, Mic, MicOff, Monitor, PhoneOff, Headphones } from 'lucide-react';

type LiveView = {
    id: number;
    kind: 'talk' | 'screen';
    status: string;
    screen_ok: boolean | null;
    requested_by: number;
    seconds_left: number | null;
    reason: string | null;
};
type LiveState = { enabled: boolean; holder: boolean; phone: string | null; live: LiveView | null };

const OPEN = ['requested', 'accepted', 'connected'];

const CLOSED_WORDS: Record<string, string> = {
    denied: 'The customer said no.',
    expired: 'The customer did not answer in time.',
    cancelled: 'Live help was called off.',
    ended: 'Live help has ended.',
    failed: 'Could not connect. Try a phone call.',
};

export default function SupportLiveHelp({ ticketNumber, onPhone }: { ticketNumber: string; onPhone: (phone: string) => void }) {
    const [state, setState] = useState<LiveState | null>(null);
    const [live, setLive] = useState<LiveView | null>(null);
    const [phase, setPhase] = useState<LivePhase | null>(null);
    const [left, setLeft] = useState<number | null>(null);
    const [notice, setNotice] = useState('');
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);
    const [muted, setMuted] = useState(false);
    const [hasVideo, setHasVideo] = useState(false);
    const [noMic, setNoMic] = useState(false);
    const call = useRef<LiveCall | null>(null);
    const media = useRef<HTMLVideoElement>(null);

    const auth = () => ({ Authorization: `Bearer ${getAuthToken()}` });
    const base = `${API_URL}/api/tickets/${encodeURIComponent(ticketNumber)}`;

    const load = useCallback(async () => {
        try {
            const res = await fetch(`${base}/live`, { headers: auth() });
            if (!res.ok) return;
            const data: LiveState = await res.json();
            setState(data);
            setLive(data.live);
            if (data.live) setLeft(data.live.seconds_left);
        } catch { /* the card stays as it was */ }
    }, [base]);

    useEffect(() => { load(); }, [load]);

    // the countdown, and a look at the server when it runs out
    useEffect(() => {
        if (!live || live.status !== 'requested' || left === null) return;
        if (left <= 0) { load(); return; }
        const t = setTimeout(() => setLeft((s) => (s === null ? null : s - 1)), 1000);
        return () => clearTimeout(t);
    }, [live, left, load]);

    // waiting on the customer (to answer, then to connect): check now and then, in case
    // the socket missed it, and so a pass that ran out unused shows as failed
    useEffect(() => {
        if (!live || (live.status !== 'requested' && live.status !== 'accepted')) return;
        const t = setInterval(load, 5000);
        return () => clearInterval(t);
    }, [live, load]);

    // when a session is over, show why
    useEffect(() => {
        if (live && !OPEN.includes(live.status)) {
            setNotice(live.reason && live.status === 'failed' ? `Could not connect: ${live.reason}` : CLOSED_WORDS[live.status] || '');
            if (call.current) { call.current.end(false); call.current = null; }
            setPhase(null);
        }
    }, [live]);

    useEffect(() => () => { call.current?.end(false); }, []);

    const join = (row: LiveView, mic: MediaStream) => {
        const url = socketUrl(`/api/tickets/live/ws/${row.id}?token=${encodeURIComponent(getAuthToken() || '')}`);
        const c = new LiveCall('agent', url, mic, {
            onPhase: (p, why) => {
                setPhase(p);
                if (p === 'failed') setNotice(why || 'Could not connect. Try a phone call.');
                if (p === 'ended' || p === 'failed') { call.current = null; setHasVideo(false); setTimeout(load, 500); }
            },
            onRemoteStream: (stream) => {
                if (media.current) media.current.srcObject = stream;
                setHasVideo(stream.getVideoTracks().length > 0);
                stream.onaddtrack = () => setHasVideo(stream.getVideoTracks().length > 0);
            },
            onMessage: (msg) => {
                if (msg.type === 'status' && msg.live) { setLive(msg.live); setLeft(msg.live.seconds_left); }
                if (msg.type === 'state' && typeof msg.sharing === 'boolean') setHasVideo(msg.sharing);
            },
        });
        call.current = c;
        c.start();
    };

    const ask = async (kind: 'talk' | 'screen') => {
        setError(''); setNotice(''); setBusy(true);
        let mic: MediaStream;
        try {
            mic = await navigator.mediaDevices.getUserMedia({ audio: true });
            setNoMic(false);
        } catch {
            if (kind === 'talk') {
                setBusy(false);
                setError('Allow this page to use your microphone, then ask again.');
                return;
            }
            mic = new MediaStream();   // watching needs no microphone
            setNoMic(true);
        }
        try {
            const res = await fetch(`${base}/live`, {
                method: 'POST', headers: { ...auth(), 'Content-Type': 'application/json' }, body: JSON.stringify({ kind }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                mic.getTracks().forEach((t) => t.stop());
                setError(data.detail || 'Could not ask the customer.');
                return;
            }
            setLive(data.live); setLeft(data.live.seconds_left); setMuted(false);
            join(data.live, mic);
        } finally {
            setBusy(false);
        }
    };

    const end = async () => {
        if (!live) return;
        setBusy(true);
        try {
            const res = await fetch(`${base}/live/${live.id}/cancel`, { method: 'POST', headers: auth() });
            const data = await res.json().catch(() => ({}));
            if (res.ok && data.live) setLive(data.live);
            else setError(data.detail || 'Could not end live help.');
        } finally {
            call.current?.end(false);
            call.current = null;
            setBusy(false);
        }
    };

    const callPhone = async () => {
        if (!state?.phone) return;
        setError('');
        // the call record will carry this ticket's number; dialling goes ahead even if that fails
        fetch(`${base}/call-link`, { method: 'POST', headers: { ...auth(), 'Content-Type': 'application/json' }, body: JSON.stringify({ phone: state.phone }) })
            .catch(() => undefined);
        onPhone(state.phone);
    };

    const toggleMute = () => {
        if (!call.current) return;
        call.current.setEnabled('audio', muted);
        setMuted(!muted);
    };

    if (!state) return null;
    const open = live && OPEN.includes(live.status);
    const mine = open && live && call.current !== null;
    const what = live?.kind === 'screen' ? 'see their screen' : 'talk';

    return (
        <div className="bg-white rounded-xl border border-gray-200 p-4">
            <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-bold text-gray-800 flex items-center gap-2"><Headphones size={16} /> Live help</h3>
                {!state.enabled && <span className="text-xs text-gray-400">Switched off for this site</span>}
            </div>

            {!open && (
                <div className="flex flex-wrap gap-2">
                    <button onClick={callPhone} disabled={!state.phone}
                            title={state.phone ? `Phone ${state.phone}` : 'No phone number on this request'}
                            className="px-3 py-2 text-sm font-semibold rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-40 flex items-center gap-1.5">
                        <Phone size={14} /> Call phone
                    </button>
                    {state.enabled && (
                        <>
                            <button onClick={() => ask('talk')} disabled={busy || !state.holder}
                                    title={state.holder ? '' : 'Take the request first'}
                                    className="px-3 py-2 text-sm font-semibold rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-40 flex items-center gap-1.5">
                                <Mic size={14} /> Ask to talk
                            </button>
                            <button onClick={() => ask('screen')} disabled={busy || !state.holder}
                                    title={state.holder ? '' : 'Take the request first'}
                                    className="px-3 py-2 text-sm font-semibold rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-40 flex items-center gap-1.5">
                                <Monitor size={14} /> Ask to see screen
                            </button>
                        </>
                    )}
                </div>
            )}
            {!open && state.enabled && !state.holder && (
                <p className="text-xs text-gray-500 mt-2">Take the request to talk to the customer or see their screen.</p>
            )}

            {open && live && (
                <div className="space-y-3">
                    {live.status === 'requested' && (
                        <p className="text-sm text-gray-700">
                            Asked the customer to {what}. Waiting for their answer
                            {left !== null && left > 0 ? ` (${left} s)` : ''}...
                        </p>
                    )}
                    {live.status === 'accepted' && phase !== 'live' && (
                        <p className="text-sm text-gray-700">The customer accepted. Connecting...</p>
                    )}
                    {live.kind === 'screen' && live.screen_ok === false && (
                        <p className="text-xs text-amber-700 bg-amber-50 rounded p-2">Their device cannot share a screen: this is a voice call only.</p>
                    )}
                    {mine && noMic && (
                        <p className="text-xs text-amber-700 bg-amber-50 rounded p-2">Your microphone is not available: you can watch and hear them, but they cannot hear you.</p>
                    )}
                    {(phase === 'live' || live.status === 'connected') && (
                        <p className="text-sm font-semibold text-green-700">Connected{live.kind === 'screen' && hasVideo ? ': you are seeing their screen' : ''}.</p>
                    )}
                    {!mine && (
                        <p className="text-xs text-gray-500">This live help was started on another tab or by another agent.</p>
                    )}
                    <div className="flex gap-2">
                        {mine && !noMic && (
                            <button onClick={toggleMute}
                                    className="px-3 py-2 text-sm font-semibold rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50 flex items-center gap-1.5">
                                {muted ? <><MicOff size={14} /> Unmute</> : <><Mic size={14} /> Mute</>}
                            </button>
                        )}
                        {live.requested_by && (
                            <button onClick={end} disabled={busy}
                                    className="px-3 py-2 text-sm font-semibold rounded-lg bg-red-600 text-white hover:bg-red-700 disabled:opacity-40 flex items-center gap-1.5">
                                <PhoneOff size={14} /> {live.status === 'requested' ? 'Call off' : 'End'}
                            </button>
                        )}
                    </div>
                </div>
            )}

            {/* their voice always plays through this element; their screen shows in it when shared */}
            <video ref={media} autoPlay playsInline
                   className={hasVideo && phase === 'live' ? 'mt-3 w-full rounded-lg bg-black max-h-[70vh]' : 'hidden'} />

            {notice && !open && <p className="text-sm text-gray-600 mt-3">{notice}</p>}
            {error && <p className="text-sm text-red-600 mt-3">{error}</p>}
        </div>
    );
}
