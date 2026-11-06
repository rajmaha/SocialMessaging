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
  const audio = useRef<HTMLAudioElement>(null)
  // pointer and control (lib/live-control.ts): the page they are on, and whether they let the agent act on it
  const screenRef = useRef<MediaStreamTrack | null>(null)
  const bus = useRef<LiveBus | null>(null)
  const host = useRef<{ id: string; vw: number; vh: number } | null>(null)
  const ctlRef = useRef<Ctl>('off')
  const [ctl, setCtlShown] = useState<Ctl>('off')

  useEffect(() => {
    const i = readHash()
    if (!i) { setMissing(true); return }
    setInfo(i)
    try { history.replaceState(null, '', window.location.pathname) } catch {}
    document.title = 'Live help'
    const bye = () => { stopControlAll(); call.current?.end() }
    window.addEventListener('pagehide', bye)
    return () => window.removeEventListener('pagehide', bye)
  }, [])

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
  const toHost = (cmd: any) => { if (host.current && cmd) bus.current?.send({ kind: 'cmd', to: host.current.id, cmd }) }

  /** What the agent sends: the pointer always (it only points), the rest only while control is allowed. */
  const fromAgent = (m: any) => {
    if (!m || typeof m !== 'object') return
    const onTab = surface() === 'browser'
    if (m.t === 'ptr' || m.t === 'ptr-hide' || m.t === 'tap') {
      if (onTab) toHost(cleanCommand(m))
    } else if (m.t === 'click' || m.t === 'wheel' || m.t === 'key') {
      if (ctlRef.current === 'on' && onTab) toHost(cleanCommand(m))
    } else if (m.t === 'ctl-ask') {
      if (ctlRef.current === 'on') return
      if (!host.current) tellAgent({ t: 'note', text: 'Their site page is not open in this browser.' })
      else if (!onTab) tellAgent({ t: 'note', text: 'They are not sharing a browser tab: control needs them to share the tab with the page.' })
      else setCtl('asked')
    } else if (m.t === 'ctl-stop') {
      setCtl('off')
    }
  }

  /** What the site page says: it is there (after every page load), or the customer's answer. */
  const fromPage = (m: any) => {
    if (m.kind === 'host' && typeof m.id === 'string') {
      host.current = { id: m.id, vw: Number(m.vw) || 0, vh: Number(m.vh) || 0 }
      sendInfo()
      // the banner (or the question) follows them onto the next page
      bus.current?.send({ kind: 'state', to: m.id, state: ctlRef.current, agent: info?.agent || 'Support' })
    } else if (m.kind === 'reply' && host.current && m.id === host.current.id) {
      const r = m.msg || {}
      if (r.t === 'ctl-answer' && ctlRef.current === 'asked') setCtl(r.allow ? 'on' : 'off', r.allow ? '' : 'denied')
      else if (r.t === 'ctl-stop' && ctlRef.current !== 'off') setCtl('off', 'stopped')
      else if (r.t === 'note' && typeof r.text === 'string') tellAgent({ t: 'note', text: r.text.slice(0, 200) })
    }
  }

  const stopControlAll = () => {
    if (ctlRef.current !== 'off') setCtl('off')
    toHost({ t: 'ptr-hide' })
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
          video: { displaySurface: 'browser' } as any,
          audio: false,
          selfBrowserSurface: 'exclude',
          surfaceSwitching: 'include',
          monitorTypeSurfaces: 'include',
        } as any)
        screenTrack = display.getVideoTracks()[0] || null
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
      onRemoteStream: (stream) => { if (audio.current) audio.current.srcObject = stream },
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
    if (screenTrack) {
      bus.current = new LiveBus(fromPage, () => (window.opener && !window.opener.closed ? [window.opener] : []))
      bus.current.send({ kind: 'who' })
    }
    c.start()
  }

  // a share switched to another tab or screen (Chrome's "Share this tab instead"): tell the agent
  useEffect(() => {
    if (!sharing) return
    let last = ''
    const t = setInterval(() => {
      const now = surface()
      if (now !== last) { last = now; sendInfo(); if (now !== 'browser' && ctlRef.current !== 'off') setCtl('off') }
    }, 2000)
    return () => clearInterval(t)
  }, [sharing])

  const stop = () => { stopControlAll(); call.current?.end(); setSharing(false) }
  const toggleMute = () => { call.current?.setEnabled('audio', muted); setMuted(!muted) }

  const box = (children: React.ReactNode) => (
    <div className="h-screen flex items-center justify-center bg-gray-50 p-6 text-gray-900"
         style={{ fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif' }}>
      <div className="w-full max-w-sm bg-white rounded-xl shadow p-6 text-center space-y-4">{children}</div>
      <audio ref={audio} autoPlay />
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
            Not this small window: {info.agent} would see only this box.
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
    return box(<>
      <p className="font-semibold text-green-700">{sharing ? `Sharing your screen with ${info.agent}` : `Talking with ${info.agent}`}</p>
      <div className="flex gap-2 justify-center">
        {!noMic && <button onClick={toggleMute} className="px-4 py-2 rounded-lg border border-gray-300 text-sm font-semibold">{muted ? 'Unmute' : 'Mute'}</button>}
        <button onClick={stop} className="px-4 py-2 rounded-lg bg-red-600 text-white text-sm font-semibold">{sharing ? 'Stop' : 'End'}</button>
      </div>
      {noMic && <p className="text-xs text-amber-700">Your microphone is off: {info.agent} can see your screen but cannot hear you.</p>}
      {ctl === 'asked' && <p className="text-xs text-indigo-700">{info.agent} asked to control your page: answer on your page.</p>}
      {ctl === 'on' && (
        <div className="text-xs text-red-700 bg-red-50 rounded-lg p-2 space-y-1">
          <p>{info.agent} is controlling your page.</p>
          <button onClick={() => setCtl('off', 'stopped')} className="px-3 py-1 rounded bg-red-600 text-white font-semibold">Stop control</button>
        </div>
      )}
      {sharing && <p className="text-xs text-gray-600">Now go back to your page: {info.agent} sees what you see. If they say they see only this box, press Stop, accept again and choose Entire screen.</p>}
      <p className="text-[11px] text-gray-400">Keep this window open. Closing it ends the call.</p>
    </>)
  }

  if (phase === 'failed') {
    return box(<>
      <p className="font-semibold text-red-700">{why || 'Could not connect. Try a phone call.'}</p>
      <button onClick={() => window.close()} className="text-sm text-gray-600 underline">Close this window</button>
    </>)
  }

  return box(<>
    <p className="font-semibold">Live help has ended.</p>
    <button onClick={() => window.close()} className="text-sm text-gray-600 underline">Close this window</button>
  </>)
}
