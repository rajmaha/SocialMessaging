/**
 * Live help: one WebRTC call between a support agent's browser and a customer's
 * browser (or app), signalled over the backend's relay
 * (app/services/support_live_relay.py). Used by the agent's Live help card and
 * the customer's live window (/widget/live).
 *
 * The customer offers -- they hold the screen -- and the agent answers. Media goes
 * peer to peer through the STUN / TURN servers the backend hands out; nothing is
 * recorded. If the two do not connect within CONNECT_MS of both being in, both
 * sides are told "Could not connect. Try a phone call" and the session is failed.
 */

import { API_URL } from './config';

export const CONNECT_MS = 20000;

export type LiveRole = 'agent' | 'customer';
export type LivePhase = 'connecting' | 'waiting' | 'live' | 'ended' | 'failed';

export interface LiveCallbacks {
    onPhase?: (phase: LivePhase, why?: string) => void;
    onRemoteStream?: (stream: MediaStream) => void;
    onMessage?: (msg: any) => void;          // the relay's own messages (hello, status, state...)
}

/** ws:// or wss:// address of a backend path, wherever the backend is reached from. */
export function socketUrl(path: string, base: string = API_URL): string {
    if (base) return base.replace(/^http/, 'ws') + path;
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${proto}//${window.location.host}${path}`;
}

export class LiveCall {
    private ws: WebSocket | null = null;
    private pc: RTCPeerConnection | null = null;
    private timer: ReturnType<typeof setTimeout> | null = null;
    private ping: ReturnType<typeof setInterval> | null = null;
    private pendingIce: RTCIceCandidateInit[] = [];
    private ice: RTCIceServer[] = [];
    private finished = false;
    phase: LivePhase = 'connecting';

    constructor(
        private role: LiveRole,
        private url: string,
        private local: MediaStream,
        private cb: LiveCallbacks = {},
    ) {}

    start() {
        const ws = new WebSocket(this.url);
        this.ws = ws;
        ws.onmessage = (ev) => {
            let msg: any;
            try { msg = JSON.parse(ev.data); } catch { return; }
            this.handle(msg);
        };
        ws.onclose = (ev) => {
            if (this.finished) return;
            if (ev.code === 4401 || ev.code === 4403) this.fail(ev.reason || 'This live help link has expired.', false);
            else if (this.phase === 'live') this.end(false);
            else this.fail('The connection to support was lost.', false);
        };
        this.ping = setInterval(() => this.send({ type: 'ping' }), 25000);
    }

    /** Sends a signalling message; answers whether it went. */
    send(msg: any): boolean {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(msg));
            return true;
        }
        return false;
    }

    private setPhase(p: LivePhase, why?: string) {
        this.phase = p;
        this.cb.onPhase?.(p, why);
    }

    private async handle(msg: any) {
        switch (msg.type) {
            case 'hello':
                this.ice = Array.isArray(msg.ice_servers) ? msg.ice_servers : [];
                this.setPhase('waiting');
                break;
            case 'ready':
                this.makePeer();
                this.timer = setTimeout(() => {
                    if (this.phase !== 'live') this.fail('Could not connect. Try a phone call.', true);
                }, CONNECT_MS);
                if (this.role === 'customer') {
                    const offer = await this.pc!.createOffer();
                    await this.pc!.setLocalDescription(offer);
                    this.send({ type: 'offer', sdp: offer.sdp });
                }
                break;
            case 'offer':
                if (this.role !== 'agent') break;
                if (!this.pc) this.makePeer();
                await this.pc!.setRemoteDescription({ type: 'offer', sdp: msg.sdp });
                await this.flushIce();
                const answer = await this.pc!.createAnswer();
                await this.pc!.setLocalDescription(answer);
                this.send({ type: 'answer', sdp: answer.sdp });
                break;
            case 'answer':
                if (this.role !== 'customer' || !this.pc) break;
                await this.pc.setRemoteDescription({ type: 'answer', sdp: msg.sdp });
                await this.flushIce();
                break;
            case 'ice':
                if (!msg.candidate) break;
                if (this.pc && this.pc.remoteDescription) {
                    try { await this.pc.addIceCandidate(msg.candidate); } catch { /* a stale candidate */ }
                } else {
                    this.pendingIce.push(msg.candidate);
                }
                break;
            case 'bye':
                this.end(false);
                break;
            case 'failed':
                this.fail(msg.reason || 'Could not connect. Try a phone call.', false);
                break;
        }
        this.cb.onMessage?.(msg);
    }

    private async flushIce() {
        const queued = this.pendingIce;
        this.pendingIce = [];
        for (const c of queued) {
            try { await this.pc!.addIceCandidate(c); } catch { /* ignore */ }
        }
    }

    private makePeer() {
        if (this.pc) return;
        const pc = new RTCPeerConnection({ iceServers: this.ice });
        this.pc = pc;
        // the customer offers, so the offer decides what flows; the answerer's tracks
        // fill the offer's lines and a side with no microphone simply receives
        this.local.getTracks().forEach((t) => pc.addTrack(t, this.local));
        if (this.role === 'customer' && this.local.getAudioTracks().length === 0) {
            pc.addTransceiver('audio', { direction: 'recvonly' });   // still hear the agent
        }
        pc.onicecandidate = (ev) => { if (ev.candidate) this.send({ type: 'ice', candidate: ev.candidate.toJSON() }); };
        pc.ontrack = (ev) => {
            const stream = ev.streams[0] || new MediaStream([ev.track]);
            this.cb.onRemoteStream?.(stream);
        };
        pc.onconnectionstatechange = () => {
            const s = pc.connectionState;
            if (s === 'connected') {
                if (this.timer) { clearTimeout(this.timer); this.timer = null; }
                this.setPhase('live');
            } else if (s === 'failed') {
                this.fail('Could not connect. Try a phone call.', true);
            } else if (s === 'disconnected' && this.phase === 'live') {
                // often comes back by itself; a lasting break turns into failed above
            }
        };
    }

    /** Stop sending (or start again) one kind of track, without ending the call. */
    setEnabled(kind: 'audio' | 'video', on: boolean) {
        this.local.getTracks().filter((t) => t.kind === kind).forEach((t) => { t.enabled = on; });
        this.send({ type: 'state', [kind === 'audio' ? 'muted' : 'sharing']: kind === 'audio' ? !on : on });
    }

    /** Hang up: the other side hears bye. */
    end(tell = true) {
        if (this.finished) return;
        if (tell) this.send({ type: 'bye' });
        this.cleanup();
        this.setPhase('ended');
    }

    private fail(why: string, tell: boolean) {
        if (this.finished) return;
        if (tell) this.send({ type: 'failed', reason: why });
        this.cleanup();
        this.setPhase('failed', why);
    }

    private cleanup() {
        this.finished = true;
        if (this.timer) clearTimeout(this.timer);
        if (this.ping) clearInterval(this.ping);
        try { this.pc?.close(); } catch { /* ignore */ }
        this.local.getTracks().forEach((t) => t.stop());
        try { this.ws?.close(); } catch { /* ignore */ }
    }
}
