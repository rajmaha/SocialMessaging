'use client'

/**
 * The customer's live help window. The Support tab opens it when the customer
 * accepts an agent's request to talk or to see their screen. It is a window of its
 * own because the site behind the widget reloads on every menu click, which would
 * end a share running inside the widget.
 *
 * What it needs comes in the address's hash, never sent to a server:
 *   #pass=<one-time pass>&kind=talk|screen&agent=<name>&screen=1|0
 * The pass opens the signalling socket once (app/routes/support_public.py) and is
 * used up there; the hash is cleared as soon as it is read.
 */

import { useEffect, useRef, useState } from 'react'
import { LiveCall, LivePhase, socketUrl } from '@/lib/live-help'
import { LiveBus } from '@/lib/live-control'

type Ctl = 'off' | 'asked' | 'on'
const clamp01 = (v: any) => Math.max(0, Math.min(1, Number(v) || 0))
const KEYS = new Set(['Enter', 'Backspace', 'Delete', 'Tab', 'Escape', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown'])

/** An agent's command as it may go to the page: only known fields, numbers in range. */
function cleanCommand(m: any): any | null {
  switch (m && m.t) {
    case 'ptr': case 'tap': case 'click':
      return { t: m.t, x: clamp01(m.x), y: clamp01(m.y) }
    case 'ptr-hide':
      return { t: 'ptr-hide' }
    case 'wheel':
      return { t: 'wheel', x: clamp01(m.x), y: clamp01(m.y),
               dx: Math.max(-2000, Math.min(2000, Number(m.dx) || 0)), dy: Math.max(-2000, Math.min(2000, Number(m.dy) || 0)) }
    case 'key': {
      const key = typeof m.key === 'string' ? m.key : ''
      if (!(key.length === 1 || KEYS.has(key) || key === 'a')) return null
      return { t: 'key', key, code: typeof m.code === 'string' ? m.code.slice(0, 30) : '',
               ctrl: !!m.ctrl, shift: !!m.shift, alt: !!m.alt, meta: !!m.meta }
    }
  }
  return null
}

type Info = { pass: string; kind: 'talk' | 'screen'; agent: string; screen: boolean }

function readHash(): Info | null {
  const h = new URLSearchParams(window.location.hash.replace(/^#/, ''))
  const pass = h.get('pass') || ''
  if (!pass) return null
  return {
    pass,
    kind: h.get('kind') === 'screen' ? 'screen' : 'talk',
    agent: (h.get('agent') || 'Support').slice(0, 80),
    screen: h.get('screen') === '1',
  }
}

/** A captured window of this window's own size (within a few per cent) is taken to be this window. */
function looksLikeThisWindow(w: number, h: number) {
  if (!w || !h) return false
  const dpr = window.devicePixelRatio || 1
  const near = (a: number, b: number) => b > 0 && Math.abs(a - b) / b < 0.06
  return (near(w, window.outerWidth * dpr) && near(h, window.outerHeight * dpr))
      || (near(w, window.outerWidth) && near(h, window.outerHeight))
}

export default function LiveHelpWindow() {
  const [info, setInfo] = useState<Info | null>(null)
  const [missing, setMissing] = useState(false)
  const [phase, setPhase] = useState<LivePhase | 'start' | 'asking'>('start')
  const [why, setWhy] = useState('')
  const [sharing, setSharing] = useState(false)
  const [muted, setMuted] = useState(false)
  const [noMic, setNoMic] = useState(false)
  const [error, setError] = useState('')
  const call = useRef<LiveCall | null>(null)
  const audio = useRef<HTMLAudioElement | null>(null)
  const remote = useRef<MediaStream | null>(null)
  // the agent's voice: the element is drawn anew when the layout changes, so it is reattached each time
  const audioRef = (el: HTMLAudioElement | null) => {
    audio.current = el
    if (el && remote.current && el.srcObject !== remote.current) el.srcObject = remote.current
  }
  // pointer and control (lib/live-control.ts): the page they are on, and whether they let the agent act on it
  const screenRef = useRef<MediaStreamTrack | null>(null)
  const bus = useRef<LiveBus | null>(null)
  // the site's tab: the opener (the Support iframe) is replaced on every page load, its tab is not
  const siteTop = useRef<Window | null>(null)
  const whoTimer = useRef<ReturnType<typeof setInterval> | null>(null)
  const host = useRef<{ id: string; vw: number; vh: number } | null>(null)
  const ctlRef = useRef<Ctl>('off')
  // the call bar on their page (Mute / Stop there, so this window can stay small and out of the way)
  const mutedRef = useRef(false)
  const liveRef = useRef(false)
  const micRef = useRef(true)
  const [ctl, setCtlShown] = useState<Ctl>('off')

  useEffect(() => {
    const i = readHash()
    if (!i) { setMissing(true); return }
    setInfo(i)
    try { history.replaceState(null, '', window.location.pathname) } catch {}
    // the share box's Window list shows this title: say plainly it is not the one to pick
    document.title = 'Live help (do not share this window)'
    const bye = () => { stopControlAll(); call.current?.end() }
    window.addEventListener('pagehide', bye)
    return () => window.removeEventListener('pagehide', bye)
  }, [])

  // a tab, a whole screen or a window: the page works out where it sits in each
  const SURFACES = ['browser', 'monitor', 'window']
  const surfaceKnown = () => SURFACES.includes(surface())
  const surface = () => {
    try { return String((screenRef.current?.getSettings() as any)?.displaySurface || '') } catch { return '' }
  }
  const tellAgent = (m: any) => { call.current?.control(m) }
  const sendInfo = () => tellAgent({ t: 'info', surface: surface(), host: !!host.current, vw: host.current?.vw || 0, vh: host.current?.vh || 0 })
  const setCtl = (state: Ctl, why = '') => {
    ctlRef.current = state
    setCtlShown(state)
    if (host.current) bus.current?.send({ kind: 'state', to: host.current.id, state, agent: info?.agent || 'Support' })
    tellAgent({ t: 'ctl', state, why })
  }
  const sendCall = (live: boolean) => {
    if (host.current) bus.current?.send({ kind: 'call', to: host.current.id, agent: info?.agent || 'Support',
      live, muted: mutedRef.current, mic: micRef.current, sharing: !!screenRef.current })
  }
  const toHost = (cmd: any) => { if (host.current && cmd) bus.current?.send({ kind: 'cmd', to: host.current.id, cmd }) }

  /** What the agent sends: the pointer always (it only points), the rest only while control is allowed. */
  const fromAgent = (m: any) => {
    if (!m || typeof m !== 'object') return
    const shown = surfaceKnown()
    const withSurface = (c: any) => (c ? { ...c, s: surface() } : c)
    if (m.t === 'ptr' || m.t === 'ptr-hide' || m.t === 'tap') {
      if (shown) toHost(withSurface(cleanCommand(m)))
    } else if (m.t === 'click' || m.t === 'wheel' || m.t === 'key') {
      if (ctlRef.current === 'on' && shown) toHost(withSurface(cleanCommand(m)))
    } else if (m.t === 'who') {
      bus.current?.send({ kind: 'who' })                // the agent has not heard of their page: look again
    } else if (m.t === 'ctl-ask') {
      if (ctlRef.current === 'on') return
      const decide = () => {
        if (!surfaceKnown()) setCtl('off', 'not a tab')
        else if (!host.current) setCtl('off', 'no page')
        else setCtl('asked')
      }
      if (host.current) decide()
      else { bus.current?.send({ kind: 'who' }); setTimeout(decide, 1500) }   // it may only have been missed
    } else if (m.t === 'ctl-stop') {
      setCtl('off')
    }
  }

  /** What the site page says: it is there (after every page load), or the customer's answer. */
  const fromPage = (m: any) => {
    if (m.kind === 'host' && typeof m.id === 'string') {
      host.current = { id: m.id, vw: Number(m.vw) || 0, vh: Number(m.vh) || 0 }
      sendInfo()
      // the banner (or the question), and the call bar, follow them onto the next page
      bus.current?.send({ kind: 'state', to: m.id, state: ctlRef.current, agent: info?.agent || 'Support' })
      if (liveRef.current) sendCall(true)
    } else if (m.kind === 'reply' && host.current && m.id === host.current.id) {
      const r = m.msg || {}
      if (r.t === 'ctl-answer' && ctlRef.current === 'asked') setCtl(r.allow ? 'on' : 'off', r.allow ? '' : 'denied')
      else if (r.t === 'ctl-stop' && ctlRef.current !== 'off') setCtl('off', 'stopped')
      else if (r.t === 'note' && typeof r.text === 'string') tellAgent({ t: 'note', text: r.text.slice(0, 200) })
      else if (r.t === 'call-mute') setMute(!!r.mute)
      else if (r.t === 'call-end') stop()
    }
  }

  const stopControlAll = () => {
    liveRef.current = false
    sendCall(false)
    if (ctlRef.current !== 'off') setCtl('off')
    toHost({ t: 'ptr-hide' })
    if (whoTimer.current) { clearInterval(whoTimer.current); whoTimer.current = null }
    bus.current?.close()
    bus.current = null
  }

  const start = async (withScreen: boolean) => {
    if (!info) return
    setError(''); setPhase('asking')
    // The screen first, straight from the click: a browser opens its screen picker only
    // within a few seconds of a click, and answering the microphone question first used
    // that time up -- the share then failed without a word and the call went ahead as
    // voice only.
    let screenTrack: MediaStreamTrack | null = null
    if (withScreen) {
      try {
        // Open the picker on Entire screen and keep this little window out of it: people
        // picked "this window" and the agent saw only the live help box. Browsers that do
        // not know these hints ignore them.
        const display = await navigator.mediaDevices.getDisplayMedia({
          // as sharp as the screen allows: text has to be readable on the agent's side
          video: { displaySurface: 'browser', width: { ideal: 1920, max: 2560 }, height: { ideal: 1080, max: 1600 },
                   frameRate: { ideal: 15, max: 30 } } as any,
          audio: false,
          selfBrowserSurface: 'exclude',
          surfaceSwitching: 'include',
          monitorTypeSurfaces: 'include',
        } as any)
        screenTrack = display.getVideoTracks()[0] || null
        // a screen of text: keep it sharp rather than smooth (the encoder favours resolution)
        if (screenTrack && 'contentHint' in screenTrack) { try { (screenTrack as any).contentHint = 'detail' } catch { /* ignore */ } }
      } catch (e: any) {
        setPhase('start')
        const msg = String((e && e.message) || '')
        setError(/system/i.test(msg)
          // macOS answers this when the browser has not been allowed to record the screen
          ? 'Your computer did not let the browser share the screen. On a Mac: System Settings, Privacy & Security, Screen Recording, switch your browser on, reopen it, then try again.'
          : e && e.name === 'NotAllowedError'
            ? 'Your screen was not shared. Press Share my screen and choose a screen or window, or press Talk only.'
            : 'This browser could not share your screen. Press Share my screen to try again, or Talk only.')
        return
      }
      if (!screenTrack) {
        setPhase('start')
        setError('No screen was chosen. Press Share my screen to try again, or Talk only.')
        return
      }
      // A browser lists every window, this one too, and people picked it: the agent then
      // saw only this box. A window share whose picture is this window's size is this window.
      const st: any = screenTrack.getSettings ? screenTrack.getSettings() : {}
      if (st.displaySurface === 'window' && looksLikeThisWindow(Number(st.width) || 0, Number(st.height) || 0)) {
        screenTrack.stop()
        setPhase('start')
        setError(`You chose this small live help window, so ${info.agent} would see only this box. Press Share my screen again and choose the tab with your page, or Entire screen.`)
        return
      }
    }
    let mic: MediaStream | null = null
    try {
      mic = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch {
      if (!withScreen) {
        setPhase('start')
        setError('Allow this window to use your microphone, then try again.')
        return
      }
      // a screen can be shown without a microphone; they will not hear you
    }
    setNoMic(!mic)
    micRef.current = !!mic
    const tracks: MediaStreamTrack[] = mic ? [...mic.getAudioTracks()] : []
    if (screenTrack) tracks.push(screenTrack)
    if (tracks.length === 0) {
      setPhase('start')
      setError('Allow this window to use your microphone or your screen, then try again.')
      return
    }
    const local = new MediaStream(tracks)
    screenRef.current = screenTrack
    const c = new LiveCall('customer', socketUrl(`/api/support/v1/live/ws?pass=${encodeURIComponent(info.pass)}`), local, {
      onPhase: (p, w) => { setPhase(p); if (w) setWhy(w); if (p === 'ended' || p === 'failed') stopControlAll() },
      onControl: fromAgent,
      onControlOpen: (open) => { if (open) { sendInfo(); tellAgent({ t: 'ctl', state: ctlRef.current }) } },
      onRemoteStream: (stream) => { remote.current = stream; if (audio.current) audio.current.srcObject = stream },
      onMessage: (msg) => {
        if (msg.type === 'ready') c.send({ type: 'state', sharing: !!screenTrack })
      },
    })
    if (screenTrack) {
      // the browser's own "Stop sharing" button ends the share, and with it the call
      screenTrack.onended = () => { c.end(); setSharing(false) }
    }
    setSharing(!!screenTrack)
    call.current = c
    try { siteTop.current = window.opener ? window.opener.top : null } catch { siteTop.current = null }
    bus.current = new LiveBus(fromPage, () => {
      const out: Window[] = []
      try { if (window.opener && !window.opener.closed) out.push(window.opener) } catch { /* gone */ }
      // the frames of their tab, whatever page it is on now: only our own iframe takes the message
      const t = siteTop.current
      try {
        if (t && !t.closed) for (let i = 0; i < Math.min(t.frames.length, 20); i++) out.push(t.frames[i])
      } catch { /* the tab was closed */ }
      return out
    })
    bus.current.send({ kind: 'who' })
    // a reloaded page's iframe announces itself when asked
    whoTimer.current = setInterval(() => bus.current?.send({ kind: 'who' }), 3000)
    c.start()
  }

  // a share switched to another tab or screen (Chrome's "Share this tab instead"): tell the agent
  useEffect(() => {
    if (!sharing) return
    let last = ''
    const t = setInterval(() => {
      const now = surface()
      if (now !== last) { last = now; sendInfo(); if (!SURFACES.includes(now) && ctlRef.current !== 'off') setCtl('off') }
    }, 2000)
    return () => clearInterval(t)
  }, [sharing])

  const stop = () => { stopControlAll(); call.current?.end(); setSharing(false) }
  function setMute(on: boolean) {
    mutedRef.current = on
    call.current?.setEnabled('audio', !on)
    setMuted(on)
    if (liveRef.current) sendCall(true)
  }
  const toggleMute = () => setMute(!mutedRef.current)

  // the call is over: this window has done its job and closes itself (a failure stays, to be read)
  useEffect(() => {
    if (phase !== 'ended') return
    const t = setTimeout(() => { try { window.close() } catch { /* left open: the button closes it */ } }, 2000)
    return () => clearTimeout(t)
  }, [phase])

  // connected: this window shrinks to a corner (the page's call bar has Mute and Stop too).
  // A browser may refuse (a window opened full screen, or in a full-screen space): it is
  // tried again whenever the window comes back to the front, and the card stays small.
  const [big, setBig] = useState(false)
  useEffect(() => {
    if (phase !== 'live') return
    liveRef.current = true
    sendCall(true)
    const shrink = () => {
      try {
        const w = 340, h = 260
        if (window.outerWidth > w + 40 || window.outerHeight > h + 40) {
          window.resizeTo(w, h)
          const sc: any = window.screen
          window.moveTo((sc.availLeft || 0) + sc.availWidth - w - 16, (sc.availTop || 0) + sc.availHeight - h - 16)
        }
      } catch { /* refused: the window stays as it is */ }
      setTimeout(() => setBig(window.outerWidth > 600 || window.outerHeight > 500), 300)
    }
    shrink()
    window.addEventListener('focus', shrink)
    return () => window.removeEventListener('focus', shrink)
  }, [phase])

  const box = (children: React.ReactNode) => (
    <div className="h-screen flex items-center justify-center bg-gray-50 p-6 text-gray-900"
         style={{ fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif' }}>
      <div className="w-full max-w-sm bg-white rounded-xl shadow p-6 text-center space-y-4">{children}</div>
      <audio ref={audioRef} autoPlay />
    </div>
  )

  if (missing) return box(<p className="text-sm text-gray-600">This live help link has expired. Accept the request again from the Support tab.</p>)
  if (!info) return box(<p className="text-sm text-gray-500">Loading...</p>)

  const canShare = info.kind === 'screen' && info.screen && !!(navigator.mediaDevices && (navigator.mediaDevices as any).getDisplayMedia)

  if (phase === 'start' || phase === 'asking') {
    return box(<>
      <p className="font-semibold">{info.agent} from Support</p>
      <p className="text-sm text-gray-600">
        {canShare ? 'wants to see your screen and talk to you. They can only watch: they cannot use your computer.' : 'wants to talk to you.'}
      </p>
      {canShare ? (
        <>
          <p className="text-xs text-gray-700 bg-indigo-50 rounded-lg p-2 text-left">
            In the box that opens, choose the <b>tab with the page you need help on</b> (then {info.agent} can also
            point and, if you allow it, click for you), or <b>Entire screen</b>, then press <b>Share</b>.
            Not &quot;Live help&quot; (this small window): {info.agent} would see only this box.
          </p>
          <button onClick={() => start(true)} disabled={phase === 'asking'}
                  className="w-full py-2.5 rounded-lg bg-indigo-600 text-white font-semibold disabled:opacity-50">Share my screen</button>
          <button onClick={() => start(false)} disabled={phase === 'asking'}
                  className="w-full py-2 text-sm text-gray-600 hover:text-gray-900">Talk only</button>
        </>
      ) : (
        <button onClick={() => start(false)} disabled={phase === 'asking'}
                className="w-full py-2.5 rounded-lg bg-indigo-600 text-white font-semibold disabled:opacity-50">Start talking</button>
      )}
      {error && <p className="text-sm text-red-600">{error}</p>}
      <p className="text-[11px] text-gray-400">Nothing is recorded.</p>
    </>)
  }

  if (phase === 'connecting' || phase === 'waiting') {
    return box(<p className="text-sm text-gray-600">Connecting to {info.agent}...</p>)
  }

  if (phase === 'live') {
    // a small card in the middle, whatever size the window is (a browser may refuse to shrink it)
    return (
      <div className="h-screen flex items-center justify-center bg-gray-50 p-3 text-gray-900"
           style={{ fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif' }}>
      <div className="w-full max-w-[320px] bg-white rounded-xl shadow p-4 flex flex-col gap-2">
        <p className="text-sm font-semibold text-green-700 flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
          {sharing ? `Sharing with ${info.agent}` : `Talking with ${info.agent}`}
        </p>
        <div className="flex gap-2">
          {!noMic && <button onClick={toggleMute} className="flex-1 py-1.5 rounded-lg border border-gray-300 text-sm font-semibold">{muted ? 'Unmute' : 'Mute'}</button>}
          <button onClick={stop} className="flex-1 py-1.5 rounded-lg bg-red-600 text-white text-sm font-semibold">{sharing ? 'Stop' : 'End'}</button>
        </div>
        {noMic && <p className="text-[11px] text-amber-700">Your microphone is off: {info.agent} cannot hear you.</p>}
        {ctl === 'on' && (
          <button onClick={() => setCtl('off', 'stopped')} className="py-1 rounded bg-red-50 text-red-700 text-xs font-semibold">
            {info.agent} is controlling your page: Stop control
          </button>
        )}
        {ctl === 'asked' && <p className="text-[11px] text-indigo-700">{info.agent} asked to control your page: answer on your page.</p>}
        <p className="text-[11px] text-gray-500">You can go back to your page: Mute and Stop are there too. Closing this window ends the call.</p>
        {big && <p className="text-[11px] text-gray-400">You can make this window smaller or move it aside.</p>}
        <audio ref={audioRef} autoPlay />
      </div>
      </div>
    )
  }

  if (phase === 'failed') {
    return box(<>
      <p className="font-semibold text-red-700">{why || 'Could not connect. Try a phone call.'}</p>
      <button onClick={() => window.close()} className="text-sm text-gray-600 underline">Close this window</button>
    </>)
  }

  return box(<>
    <p className="font-semibold">Live help has ended.</p>
    <p className="text-xs text-gray-500">This window closes by itself.</p>
    <button onClick={() => window.close()} className="text-sm text-gray-600 underline">Close this window</button>
  </>)
}
