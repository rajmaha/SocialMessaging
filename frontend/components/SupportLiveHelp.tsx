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
import { Phone, Mic, MicOff, Monitor, PhoneOff, Headphones, Maximize2, Minimize2, Expand, MousePointer2, Hand } from 'lucide-react';

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

// The shared screen's floating panel: where it was and how big, remembered per browser.
type Box = { x: number; y: number; w: number; h: number };
const BOX_KEY = 'sm_live_screen_box';
const BAR = 36;                       // the panel's title bar
function defaultBox(): Box {
    const w = Math.min(1100, Math.round(window.innerWidth * 0.7));
    const h = Math.min(Math.round(window.innerHeight * 0.75), Math.round(w * 0.625) + BAR);
    return { x: Math.max(16, window.innerWidth - w - 24), y: 72, w, h };
}
function fitBox(b: Box): Box {
    const w = Math.max(320, Math.min(b.w, window.innerWidth - 16));
    const h = Math.max(220, Math.min(b.h, window.innerHeight - 16));
    return { w, h, x: Math.max(8, Math.min(b.x, window.innerWidth - w - 8)), y: Math.max(8, Math.min(b.y, window.innerHeight - h - 8)) };
}
function savedBox(): Box {
    try {
        const v = JSON.parse(localStorage.getItem(BOX_KEY) || 'null');
        if (v && [v.x, v.y, v.w, v.h].every((n: any) => typeof n === 'number')) return fitBox(v);
    } catch { /* storage blocked: the default */ }
    return fitBox(defaultBox());
}

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
    // the screen opens in a floating panel that can be moved, resized and docked back
    const [big, setBig] = useState(true);
    const [box, setBox] = useState<Box | null>(null);
    const panel = useRef<HTMLDivElement>(null);
    const drag = useRef<{ dx: number; dy: number } | null>(null);
    // pointer and control (lib/live-control.ts): what the customer shares, and whether they let us act
    const [ctlOpen, setCtlOpen] = useState(false);
    const [pinfo, setPinfo] = useState<{ surface: string; host: boolean; vw: number; vh: number } | null>(null);
    const [ctl, setCtl] = useState<'off' | 'asked' | 'on'>('off');
    const [ctlNote, setCtlNote] = useState('');
    const [pointerOn, setPointerOn] = useState(true);
    const [vdim, setVdim] = useState({ w: 0, h: 0 });
    const noteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const lastPtr = useRef(0);
    const wheel = useRef({ dx: 0, dy: 0, x: 0, y: 0, t: null as ReturnType<typeof setTimeout> | null });

    const showVideo = hasVideo && phase === 'live';
    const floating = big && showVideo && box !== null;

    useEffect(() => { if (showVideo && !box) setBox(savedBox()); }, [showVideo, box]);
    useEffect(() => { if (!showVideo) setBig(true); }, [showVideo]);   // the next share opens large again

    // The share ended (or the panel was docked) while it was full screen: leave full screen,
    // or the browser keeps showing an empty full-screen panel -- an all-black screen.
    useEffect(() => {
        if (floating) return;
        const d: any = document;
        const fs = d.fullscreenElement || d.webkitFullscreenElement;
        if (fs && panel.current && (fs === panel.current || panel.current.contains(fs) || fs === media.current)) {
            (d.exitFullscreen || d.webkitExitFullscreen)?.call(d)?.catch?.(() => undefined);
        }
    }, [floating]);

    const keepBox = (b: Box) => { setBox(b); try { localStorage.setItem(BOX_KEY, JSON.stringify(b)); } catch { /* ignore */ } };

    // the panel's own corner resizes it (CSS resize): keep the size it was given
    useEffect(() => {
        if (!floating || !panel.current || typeof ResizeObserver === 'undefined') return;
        const el = panel.current;
        const ro = new ResizeObserver(() => {
            const r = el.getBoundingClientRect();
            setBox((b) => {
                if (!b || (Math.abs(b.w - r.width) < 2 && Math.abs(b.h - r.height) < 2)) return b;
                const nb = { ...b, w: Math.round(r.width), h: Math.round(r.height) };
                try { localStorage.setItem(BOX_KEY, JSON.stringify(nb)); } catch { /* ignore */ }
                return nb;
            });
        });
        ro.observe(el);
        return () => ro.disconnect();
    }, [floating]);

    // dragged by its title bar
    const startDrag = (e: React.PointerEvent) => {
        if (!box || (e.target as HTMLElement).closest('button')) return;
        e.preventDefault();
        drag.current = { dx: e.clientX - box.x, dy: e.clientY - box.y };
        const move = (ev: PointerEvent) => {
            if (!drag.current) return;
            setBox((b) => b ? fitBox({ ...b, x: ev.clientX - drag.current!.dx, y: ev.clientY - drag.current!.dy }) : b);
        };
        const up = () => {
            drag.current = null;
            window.removeEventListener('pointermove', move);
            window.removeEventListener('pointerup', up);
            setBox((b) => { if (b) { try { localStorage.setItem(BOX_KEY, JSON.stringify(b)); } catch { /* ignore */ } } return b; });
        };
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', up);
    };

    // the panel goes full screen (not the video alone), so its bar and the keyboard keep working
    const fullScreen = () => {
        const go = () => {
            const el: any = panel.current || media.current;
            if (!el) return;
            (el.requestFullscreen || el.webkitRequestFullscreen)?.call(el);
        };
        if (!floating) { setBig(true); setTimeout(go, 60); } else go();
    };

    const flashNote = (text: string) => {
        setCtlNote(text);
        if (noteTimer.current) clearTimeout(noteTimer.current);
        noteTimer.current = setTimeout(() => setCtlNote(''), 7000);
    };
    const sendCtl = (m: any) => call.current?.control(m);

    /** Where the pointer is on the shared picture, 0..1 each way (object-contain leaves bars). */
    const toPicture = (clientX: number, clientY: number) => {
        const v = media.current;
        if (!v || !v.videoWidth || !v.videoHeight) return null;
        const r = v.getBoundingClientRect();
        const k = Math.min(r.width / v.videoWidth, r.height / v.videoHeight);
        const w = v.videoWidth * k, h = v.videoHeight * k;
        const x = (clientX - (r.left + (r.width - w) / 2)) / w;
        const y = (clientY - (r.top + (r.height - h) / 2)) / h;
        return x < 0 || x > 1 || y < 0 || y > 1 ? null : { x, y };
    };

    const onTab = pinfo?.surface === 'browser';
    // a whole screen or a window works too: their page works out where it sits on it
    const shownSurface = !!pinfo && ['browser', 'monitor', 'window'].includes(pinfo.surface);
    const pageThere = !!pinfo?.host;
    const mismatch = !!(onTab && pinfo && pinfo.vw && pinfo.vh && vdim.w && vdim.h
        && Math.abs((vdim.w / vdim.h) / (pinfo.vw / pinfo.vh) - 1) > 0.05);
    const controlling = ctl === 'on' && ctlOpen;
    const canPoint = floating && ctlOpen && shownSurface && pageThere && (pointerOn || controlling);

    // Never disabled: a dim button on the drag bar read as covered. When control cannot be
    // asked for, the reason shows on the panel's bottom line; the customer's side still
    // looks for their page once more (it may have been missed) before it answers.
    const askControl = () => {
        if (ctl !== 'off') { sendCtl({ t: 'ctl-stop' }); setCtl('off'); return; }
        if (!ctlOpen) { flashNote('Pointer and control are not available on their device.'); return; }
        if (pinfo && !shownSurface) { flashNote('They are not sharing their screen, so there is nothing to control.'); return; }
        setCtl('asked');
        sendCtl({ t: 'ctl-ask' });
    };
    const togglePointer = () => {
        if (pointerOn) sendCtl({ t: 'ptr-hide' });
        setPointerOn(!pointerOn);
    };

    const onVideoMove = (e: React.MouseEvent) => {
        if (!canPoint) return;
        const now = Date.now();
        if (now - lastPtr.current < 40) return;
        lastPtr.current = now;
        const p = toPicture(e.clientX, e.clientY);
        sendCtl(p ? { t: 'ptr', ...p } : { t: 'ptr-hide' });
    };
    const onVideoClick = (e: React.MouseEvent) => {
        if (!floating) { if (showVideo) setBig(true); return; }
        if (!canPoint) return;
        const p = toPicture(e.clientX, e.clientY);
        if (!p) return;
        if (controlling) { sendCtl({ t: 'click', ...p }); panel.current?.focus(); }
        else sendCtl({ t: 'tap', ...p });
    };
    const onPanelKey = (e: React.KeyboardEvent) => {
        if (!controlling || !floating) return;
        if ((e.target as HTMLElement).closest('button')) return;
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() !== 'a') return;   // the agent's own shortcuts
        e.preventDefault();
        sendCtl({ t: 'key', key: e.key, code: e.code, ctrl: e.ctrlKey, shift: e.shiftKey, alt: e.altKey, meta: e.metaKey });
    };

    // their page not found yet: ask the customer's side to look for it every few seconds
    useEffect(() => {
        if (!ctlOpen || !shownSurface || pageThere) return;
        sendCtl({ t: 'who' });
        const t = setInterval(() => sendCtl({ t: 'who' }), 3000);
        return () => clearInterval(t);
    }, [ctlOpen, shownSurface, pageThere]);

    // scrolling over the picture scrolls their page while controlling (a passive React handler cannot stop the page's own)
    useEffect(() => {
        const v = media.current;
        if (!v || !controlling || !floating) return;
        const onWheel = (e: WheelEvent) => {
            const p = toPicture(e.clientX, e.clientY);
            if (!p) return;
            e.preventDefault();
            const w = wheel.current;
            w.dx += e.deltaX; w.dy += e.deltaY; w.x = p.x; w.y = p.y;
            if (!w.t) w.t = setTimeout(() => {
                sendCtl({ t: 'wheel', x: w.x, y: w.y, dx: Math.round(w.dx), dy: Math.round(w.dy) });
                w.dx = 0; w.dy = 0; w.t = null;
            }, 50);
        };
        v.addEventListener('wheel', onWheel, { passive: false });
        return () => v.removeEventListener('wheel', onWheel);
    }, [controlling, floating]);

    const ctlStatus = (() => {
        if (ctlNote) return ctlNote;
        if (!showVideo) return '';
        if (!ctlOpen) return 'Pointer and control are not available on their device.';
        if (!pinfo) return '';
        if (!shownSurface) return 'They are not sharing their screen.';
        if (!pageThere) return 'Their page with the support button is not open in that browser.';
        if (mismatch) return 'The picture does not match their page: ask them to share the tab with the page.';
        const rough = onTab ? '' : ' (they share a whole screen or window: it works on their page only, and is most exact when they share the tab)';
        if (ctl === 'on') return 'You are controlling their page: click, scroll and type in the picture. Passwords and PINs are theirs to type.' + rough;
        if (ctl === 'asked') return 'Waiting for the customer to allow control...';
        return (pointerOn ? 'They see your pointer on their page. Click in the picture to show them where.' : 'Your pointer is hidden.') + rough;
    })();

    // keep the panel on screen when the window shrinks
    useEffect(() => {
        if (!floating) return;
        const onResize = () => setBox((b) => (b ? fitBox(b) : b));
        window.addEventListener('resize', onResize);
        return () => window.removeEventListener('resize', onResize);
    }, [floating]);

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
                if (p === 'ended' || p === 'failed') {
                    call.current = null; setHasVideo(false); setTimeout(load, 500);
                    setCtlOpen(false); setPinfo(null); setCtl('off');
                }
            },
            onRemoteStream: (stream) => {
                if (media.current) media.current.srcObject = stream;
                setHasVideo(stream.getVideoTracks().length > 0);
                stream.onaddtrack = () => setHasVideo(stream.getVideoTracks().length > 0);
            },
            onControlOpen: (o) => { setCtlOpen(o); if (!o) { setCtl('off'); setPinfo(null); } },
            onControl: (m) => {
                if (m.t === 'info') setPinfo({ surface: String(m.surface || ''), host: !!m.host, vw: Number(m.vw) || 0, vh: Number(m.vh) || 0 });
                else if (m.t === 'ctl') {
                    const st = m.state === 'on' || m.state === 'asked' ? m.state : 'off';
                    setCtl(st);
                    if (st === 'on') flashNote('The customer allowed control.');
                    else if (st === 'off' && m.why === 'denied') flashNote('The customer said no to control.');
                    else if (st === 'off' && m.why === 'stopped') flashNote('The customer stopped control.');
                    else if (st === 'off' && m.why === 'not a tab') flashNote('They are not sharing a browser tab: ask them to stop and share the tab with the page, then ask again.');
                    else if (st === 'off' && m.why === 'no page') flashNote('Their page with the support button was not found in that browser: ask them to reload it, then ask again.');
                } else if (m.t === 'note' && typeof m.text === 'string') flashNote(m.text.slice(0, 200));
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

            {/* Their voice always plays through this one video element; their screen shows in it
                when shared. The element is never re-created (that would drop the stream): only its
                wrapper changes between the card and the floating panel. */}
            <div ref={panel} tabIndex={controlling && floating ? 0 : undefined} onKeyDown={onPanelKey}
                 className={floating ? `fixed z-[1000] outline-none ${controlling ? 'ring-4 ring-red-500' : ''} bg-gray-900 rounded-xl shadow-2xl border border-gray-700 flex flex-col` : (showVideo ? 'mt-3' : '')}
                 style={floating && box ? { left: box.x, top: box.y, width: box.w, height: box.h, resize: 'both', overflow: 'hidden', minWidth: 320, minHeight: 220 } : undefined}>
                {floating && (
                    <div onPointerDown={startDrag} title="Drag to move; drag the bottom-right corner to resize"
                         className="flex items-center gap-2 px-3 text-white text-xs font-semibold cursor-move select-none shrink-0"
                         style={{ height: BAR }}>
                        <Monitor size={14} /> <span className="flex-1 truncate">Their screen</span>
                        {ctlOpen && (
                            <>
                                <button onClick={togglePointer}
                                        title={pointerOn ? 'Hide my pointer' : 'Show my pointer on their page'}
                                        className={`px-2 py-1 rounded flex items-center gap-1 ${pointerOn ? 'bg-white/20' : 'hover:bg-white/15'}`}>
                                    <MousePointer2 size={13} /> Pointer
                                </button>
                                <button onClick={askControl}
                                        title={ctl === 'on' ? 'Stop controlling their page' : ctl === 'asked' ? 'Call off the request' : 'Ask to click and type on their page'}
                                        className={`px-2 py-1 rounded flex items-center gap-1 ${ctl === 'on' ? 'bg-red-600 hover:bg-red-700' : ctl === 'asked' ? 'bg-amber-500' : 'bg-indigo-600 hover:bg-indigo-700'}`}>
                                    <Hand size={13} /> {ctl === 'on' ? 'Stop control' : ctl === 'asked' ? 'Asking...' : 'Ask for control'}
                                </button>
                            </>
                        )}
                        <button onClick={fullScreen} title="Full screen" className="p-1 rounded hover:bg-white/15"><Expand size={14} /></button>
                        <button onClick={() => keepBox(fitBox(defaultBox()))} title="Default size" className="p-1 rounded hover:bg-white/15"><Maximize2 size={14} /></button>
                        <button onClick={() => setBig(false)} title="Put back in the ticket" className="p-1 rounded hover:bg-white/15"><Minimize2 size={14} /></button>
                    </div>
                )}
                <video ref={media} autoPlay playsInline
                       onDoubleClick={() => { if (!controlling) fullScreen(); }}
                       onClick={onVideoClick} onMouseMove={onVideoMove}
                       onMouseLeave={() => { if (canPoint) sendCtl({ t: 'ptr-hide' }); }}
                       onLoadedMetadata={(e) => setVdim({ w: e.currentTarget.videoWidth, h: e.currentTarget.videoHeight })}
                       onResize={(e) => setVdim({ w: e.currentTarget.videoWidth, h: e.currentTarget.videoHeight })}
                       className={floating ? `w-full bg-black object-contain flex-1 min-h-0 ${canPoint ? 'cursor-crosshair' : ''}` : (showVideo ? 'w-full rounded-lg bg-black max-h-[70vh] cursor-zoom-in' : 'hidden')}
                       title={floating ? (controlling ? undefined : 'Double-click for full screen') : (showVideo ? 'Click to open large' : undefined)} />
                {floating && ctlStatus && (
                    <div className={`px-3 py-1.5 text-[11px] shrink-0 rounded-b-xl ${controlling ? 'bg-red-600 text-white' : 'bg-gray-800 text-gray-200'}`}>{ctlStatus}</div>
                )}
                {!floating && showVideo && ctlOpen && (
                    <p className="text-[11px] text-gray-500 mt-1">Open large to point at or control their page.</p>
                )}
                {!floating && showVideo && (
                    <div className="flex gap-2 mt-2">
                        <button onClick={() => setBig(true)}
                                className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50 flex items-center gap-1.5">
                            <Maximize2 size={13} /> Open large
                        </button>
                        <button onClick={fullScreen}
                                className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50 flex items-center gap-1.5">
                            <Expand size={13} /> Full screen
                        </button>
                    </div>
                )}
            </div>

            {notice && !open && <p className="text-sm text-gray-600 mt-3">{notice}</p>}
            {error && <p className="text-sm text-red-600 mt-3">{error}</p>}
        </div>
    );
}
