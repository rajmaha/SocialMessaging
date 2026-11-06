/**
 * Pointer and control in live help: the agent's pointer, clicks, scrolling and keys
 * reach the customer's site page (the one with the widget), where public/chat-widget.js
 * draws the pointer and, once the customer allows control, repeats them.
 *
 *   agent's card ── WebRTC data channel 'ctl' ──> customer's live window (/widget/live)
 *   live window ── LiveBus ──> the Support iframe on the site page ── postMessage ──> chat-widget.js
 *
 * The live window is a window of its own; the site page reloads on every menu click,
 * so the page it talks to changes. Every Support iframe joins a BroadcastChannel
 * (same origin as the live window) and announces itself while its page is visible;
 * the live window addresses commands to the latest one. Where a browser keeps that
 * channel apart (storage partitioning) the windows talk by postMessage instead: the live
 * window keeps the site TAB (window.opener.top), which outlives the page's reloads, and
 * writes to its frames; only the Support iframe (this origin) takes the message. The live
 * window asks 'who' every few seconds, so a reloaded page's iframe answers, and each
 * side answers whoever wrote to it.
 *
 * Messages on the bus: {ch, n, kind, ...}
 *   live window -> pages: who | cmd {to, cmd} | state {to, state, agent}
 *   page -> live window:  host {id, vw, vh} | reply {id, msg}
 * Commands (agent -> page), msg.t: ptr {x,y} | ptr-hide | tap {x,y} | click {x,y} |
 *   wheel {x,y,dx,dy} | key {key, code, ctrl, shift, alt, meta}; x and y are 0..1 of
 *   the shared picture. Control state: off | asked | on.
 * Replies (page -> agent): ctl-answer {allow} | ctl-stop | note {text}.
 */

export const BUS = 'sc-live-ctl'

function nonce() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36)
}

export class LiveBus {
  private bc: BroadcastChannel | null = null
  private seen: string[] = []
  private peers: Window[] = []             // windows that wrote to us: they hear our answers too
  private onWindow = (ev: MessageEvent) => {
    if (ev.origin !== window.location.origin) return
    const d = ev.data
    if (d && typeof d === 'object' && d.ch === BUS && ev.source && ev.source !== window) {
      const w = ev.source as Window
      if (!this.peers.includes(w)) this.peers.push(w)
    }
    this.take(d)
  }

  constructor(private onMsg: (m: any) => void, private windows: () => Window[] = () => []) {
    try {
      this.bc = new BroadcastChannel(BUS)
      this.bc.onmessage = (ev) => this.take(ev.data)
    } catch {
      this.bc = null
    }
    window.addEventListener('message', this.onWindow)
  }

  private take(d: any) {
    if (!d || typeof d !== 'object' || d.ch !== BUS || typeof d.n !== 'string') return
    if (this.seen.includes(d.n)) return            // both ways delivered it
    this.seen.push(d.n)
    if (this.seen.length > 200) this.seen.shift()
    this.onMsg(d)
  }

  send(m: any) {
    const d = { ...m, ch: BUS, n: nonce() }
    this.seen.push(d.n)
    try { this.bc?.postMessage(d) } catch { /* closed */ }
    this.peers = this.peers.filter((w) => { try { return !w.closed } catch { return false } })
    const targets = this.windows().concat(this.peers.filter((w) => !this.windows().includes(w)))
    for (const w of targets) {
      try { if (w && !w.closed) w.postMessage(d, window.location.origin) } catch { /* gone */ }
    }
  }

  close() {
    try { this.bc?.close() } catch { /* ignore */ }
    window.removeEventListener('message', this.onWindow)
  }
}

export function newHostId() {
  return 'h' + nonce()
}
