'use client'

/**
 * The widget's Support tab: raise a request, see my requests, follow a thread.
 * Loaded by public/chat-widget.js as its own iframe (/widget/support?widget_key=...).
 *
 * Who the person is:
 *  - a site that signs its users hands the token over by postMessage
 *    ({type: 'sc:identity', token}); it is never in this page's URL. When it
 *    expires the page asks the host page for a new one ('sc:identity-expired').
 *  - otherwise, where the site allows it, the visitor verifies an email with the
 *    webchat code, sharing the chat tab's session (localStorage webchat_session_id).
 *
 * Messages to and from the host page (window.parent):
 *  out: sc:support-ready {enabled, chat_enabled}   sc:identity-expired
 *       sc:support-unread {count, increased}  -- the widget's badge and chime
 *       sc:ctl {kind: cmd|state, cmd, state, agent}  -- live help pointer and control
 *  in:  sc:identity {token}   sc:open {screen, url}   sc:shown {shown}
 *       sc:ctl-host {vw, vh, visible}   sc:ctl-reply {msg}   (lib/live-control.ts)
 *
 * Unread: a request whose last word is support's (from_support) and whose
 * updated_at differs from the one this browser saw when the thread was open on
 * screen. Kept in localStorage per widget key; the first look on a browser
 * counts what is already there as seen. A reply chimes once (announced keys).
 * Every rule is the backend's (/api/support/v1, app/routes/support_public.py).
 */

import { Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { API_URL } from '@/lib/config'
import { LiveBus, newHostId } from '@/lib/live-control'

const SESSION_KEY = 'webchat_session_id'
const NAME_KEY = 'webchat_visitor_name'
const EMAIL_KEY = 'webchat_visitor_email'
const POLL_MS = 8000
const UNREAD_POLL_MS = 20000

type Config = {
  name: string; primary_color: string | null; categories: string[]; priorities: string[]
  allow_anonymous: boolean; chat_enabled: boolean; max_files: number; max_file_mb: number; file_types: string[]
  live_help?: boolean
}
/** An agent asking to talk or to see the screen (app/services/support_live.py customer_view). */
type LiveAsk = { id: number; ticket_no: string; kind: 'talk' | 'screen'; status: string; agent: string; seconds_left: number | null }
const LIVE_POLL_MS = 15000
type Attachment = { index: number; name: string; size: number; url: string }
type Message = { id: number; author_type: 'customer' | 'agent' | 'system'; author_name: string; body: string; attachments: Attachment[]; created_at: string }
type Request = {
  ticket_no: string; subject: string; status: string; status_label: string; category?: string; priority?: string
  from_support?: boolean
  screen?: string; can_reply?: boolean; created_at?: string; updated_at?: string; messages?: Message[]; last_message?: string
}

function newRequestId() {
  return (crypto as any).randomUUID ? crypto.randomUUID().replace(/-/g, '') : String(Date.now()) + Math.random().toString(16).slice(2)
}
function sizeLabel(b: number) { return b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB` }
function readStore(key: string) { try { return localStorage.getItem(key) || '' } catch { return '' } }
function writeStore(key: string, v: string) { try { localStorage.setItem(key, v) } catch {} }

export default function SupportWidgetPage() {
  return <Suspense fallback={null}><SupportWidget /></Suspense>
}

function SupportWidget() {
  const params = useSearchParams()
  const widgetKey = params.get('widget_key') || ''

  const [config, setConfig] = useState<Config | null>(null)
  const [unavailable, setUnavailable] = useState('')
  const [token, setToken] = useState('')             // a signed identity from the host page
  const [waitingForToken, setWaitingForToken] = useState(true)
  const [session, setSession] = useState('')         // an anonymous visitor's webchat session
  const [me, setMe] = useState<{ name: string; email: string; phone: string; signed: boolean } | null>(null)
  const [view, setView] = useState<'list' | 'new' | 'thread'>('list')
  const [list, setList] = useState<Request[]>([])
  const [current, setCurrent] = useState<Request | null>(null)
  const [error, setError] = useState('')
  const [prefill, setPrefill] = useState<{ screen: string; url: string }>({ screen: '', url: '' })
  const [asking, setAsking] = useState<LiveAsk | null>(null)
  const [askLeft, setAskLeft] = useState(0)
  const [liveLink, setLiveLink] = useState('')       // the live window's address, when the browser blocked opening it
  const [liveBusy, setLiveBusy] = useState(false)
  const seenAsk = useRef(0)
  const tokenRef = useRef('')
  const tokenWaiters = useRef<((t: string) => void)[]>([])
  const shownRef = useRef(false)                    // the panel is open on this tab
  const listRef = useRef<Request[]>([])
  const currentRef = useRef<Request | null>(null)
  const lastUnread = useRef(-1)
  // live help pointer and control: this page on the bus to the live window
  const hostId = useRef(newHostId())
  const hostView = useRef<{ vw: number; vh: number; visible: boolean }>({ vw: 0, vh: 0, visible: false })
  const liveBus = useRef<LiveBus | null>(null)
  const liveWin = useRef<Window | null>(null)

  const color = config?.primary_color || '#4f46e5'
  const signedIn = !!token
  const known = signedIn || !!session

  // ── the host page ─────────────────────────────────────────────────────────
  const toParent = (msg: any) => { try { window.parent.postMessage(msg, '*') } catch {} }

  useEffect(() => {
    const onMessage = (ev: MessageEvent) => {
      if (ev.source !== window.parent || !ev.data || typeof ev.data !== 'object') return
      if (ev.data.type === 'sc:identity' && typeof ev.data.token === 'string') {
        tokenRef.current = ev.data.token
        setToken(ev.data.token)
        setWaitingForToken(false)
        tokenWaiters.current.splice(0).forEach(fn => fn(ev.data.token))
      } else if (ev.data.type === 'sc:no-identity') {
        setWaitingForToken(false)
      } else if (ev.data.type === 'sc:ctl-host') {
        hostView.current = { vw: Number(ev.data.vw) || 0, vh: Number(ev.data.vh) || 0, visible: !!ev.data.visible }
        if (hostView.current.visible) liveBus.current?.send({ kind: 'host', id: hostId.current, vw: hostView.current.vw, vh: hostView.current.vh })
      } else if (ev.data.type === 'sc:ctl-reply') {
        liveBus.current?.send({ kind: 'reply', id: hostId.current, msg: ev.data.msg })
      } else if (ev.data.type === 'sc:shown') {
        shownRef.current = !!ev.data.shown
        const c = currentRef.current
        if (shownRef.current && c) markSeenRef.current(c.ticket_no, c.updated_at || '')
        // the panel opened: show the list as it is now, not as it was when the page loaded
        if (shownRef.current && !c) loadListRef.current()
      } else if (ev.data.type === 'sc:open') {
        setPrefill({ screen: String(ev.data.screen || '').slice(0, 500), url: String(ev.data.url || '').slice(0, 500) })
        setView('new')
      }
    }
    window.addEventListener('message', onMessage)
    setSession(readStore(SESSION_KEY))
    // a page with no identity to give answers sc:no-identity; an old host page never answers
    const t = setTimeout(() => setWaitingForToken(false), 1500)
    return () => { window.removeEventListener('message', onMessage); clearTimeout(t) }
  }, [])

  // the bus to a live help window (this browser's): commands for this page go to the widget
  useEffect(() => {
    const bus = new LiveBus((m) => {
      if (m.kind === 'who') {
        if (hostView.current.visible) bus.send({ kind: 'host', id: hostId.current, vw: hostView.current.vw, vh: hostView.current.vh })
      } else if ((m.kind === 'cmd' || m.kind === 'state') && m.to === hostId.current) {
        toParent({ type: 'sc:ctl', kind: m.kind, cmd: m.cmd, state: m.state, agent: typeof m.agent === 'string' ? m.agent.slice(0, 80) : '' })
      }
    }, () => (liveWin.current && !liveWin.current.closed ? [liveWin.current] : []))
    liveBus.current = bus
    toParent({ type: 'sc:ctl-ready' })       // the widget answers with this page's size
    return () => { bus.close(); liveBus.current = null }
  }, [])

  /** A fresh token from the host page, after the one we had expired. */
  const renewToken = () => new Promise<string>(resolve => {
    tokenWaiters.current.push(resolve)
    toParent({ type: 'sc:identity-expired' })
    setTimeout(() => resolve(''), 8000)
  })

  // ── the API ───────────────────────────────────────────────────────────────
  const call = useCallback(async (path: string, init: RequestInit = {}, retried = false): Promise<any> => {
    const headers: Record<string, string> = { 'X-Support-Key': widgetKey, ...(init.headers as any || {}) }
    if (tokenRef.current) headers['Authorization'] = `Support ${tokenRef.current}`
    else if (readStore(SESSION_KEY)) headers['X-Webchat-Session'] = readStore(SESSION_KEY)
    const res = await fetch(`${API_URL}/api/support/v1${path}`, { ...init, headers })
    const data = await res.json().catch(() => ({}))
    if (res.status === 401 && tokenRef.current && !retried) {
      const fresh = await renewToken()
      if (fresh) return call(path, init, true)
    }
    if (!res.ok) throw Object.assign(new Error(typeof data.detail === 'string' ? data.detail : 'Something went wrong.'), { status: res.status })
    return data
  }, [widgetKey])

  // settings, then tell the host page whether to show this tab
  useEffect(() => {
    if (!widgetKey) { setUnavailable('This site is not set up for support.'); return }
    call('/config')
      .then((c: Config) => { setConfig(c); toParent({ type: 'sc:support-ready', enabled: true, chat_enabled: c.chat_enabled }) })
      .catch((e: any) => { setUnavailable(e.message); toParent({ type: 'sc:support-ready', enabled: false }) })
  }, [widgetKey, call])

  // ── unread replies: the widget's badge and chime ─────────────────────────
  const seenKey = `sc_support_seen_${widgetKey}`
  const announcedKey = `sc_support_told_${widgetKey}`
  const readJson = (key: string): Record<string, string> | null => {
    try { const v = JSON.parse(readStore(key) || 'null'); return v && typeof v === 'object' ? v : null } catch { return null }
  }

  const reportUnread = useCallback((items: Request[]) => {
    let seen = readJson(seenKey)
    if (!seen) {
      // the first look on this browser: what is already there is not news
      seen = {}
      items.forEach(i => { seen![i.ticket_no] = i.updated_at || '' })
      writeStore(seenKey, JSON.stringify(seen))
    }
    const unreadKeys = items
      .filter(i => i.from_support && seen![i.ticket_no] !== (i.updated_at || ''))
      .map(i => `${i.ticket_no}@${i.updated_at || ''}`)
    const told = readJson(announcedKey) || {}
    const fresh = unreadKeys.filter(k => !told[k])
    if (fresh.length) {
      fresh.forEach(k => { told[k] = '1' })
      // keep the list short: only what is still unread
      const kept: Record<string, string> = {}
      unreadKeys.forEach(k => { if (told[k]) kept[k] = '1' })
      writeStore(announcedKey, JSON.stringify(kept))
    }
    if (unreadKeys.length !== lastUnread.current || fresh.length) {
      toParent({ type: 'sc:support-unread', count: unreadKeys.length, increased: fresh.length > 0 })
      lastUnread.current = unreadKeys.length
    }
  }, [seenKey, announcedKey])

  /** The person has seen this request as it now stands. */
  const markSeen = useCallback((no: string, updatedAt: string) => {
    const seen = readJson(seenKey) || {}
    seen[no] = updatedAt
    writeStore(seenKey, JSON.stringify(seen))
    listRef.current = listRef.current.map(i => i.ticket_no === no ? { ...i, updated_at: updatedAt } : i)
    setList(listRef.current)
    reportUnread(listRef.current)
  }, [seenKey, reportUnread])
  const markSeenRef = useRef(markSeen)
  markSeenRef.current = markSeen
  useEffect(() => { currentRef.current = view === 'thread' ? current : null }, [view, current])

  const loadList = useCallback(async () => {
    try {
      const d = await call('/requests')
      listRef.current = d.items || []
      setList(listRef.current)
      setError('')
      reportUnread(listRef.current)
    } catch (e: any) { setError(e.message) }
  }, [call, reportUnread])

  const loadListRef = useRef(loadList)
  loadListRef.current = loadList

  // look for replies every 20 seconds, even with the panel shut: that is what the badge is for
  useEffect(() => {
    if (!config || waitingForToken || !known) return
    const timer = setInterval(() => {
      if (document.visibilityState !== 'visible') return
      call('/requests').then(d => {
        listRef.current = d.items || []
        setList(listRef.current)
        reportUnread(listRef.current)
      }).catch(() => {})
    }, UNREAD_POLL_MS)
    return () => clearInterval(timer)
  }, [config, waitingForToken, known, call, reportUnread])

  useEffect(() => {
    if (!config || waitingForToken || !known) return
    call('/me').then(setMe).catch(() => setMe(null))
    loadList()
  }, [config, waitingForToken, known, token, session, call, loadList])

  const openThread = async (no: string) => {
    try {
      const r = await call(`/requests/${encodeURIComponent(no)}`)
      setCurrent(r); setView('thread'); setError('')
      markSeen(r.ticket_no, r.updated_at || '')
    } catch (e: any) { setError(e.message) }
  }

  // the open thread asks for what is new every few seconds
  useEffect(() => {
    if (view !== 'thread' || !current) return
    const timer = setInterval(async () => {
      if (document.visibilityState !== 'visible') return
      const last = current.messages?.length ? current.messages[current.messages.length - 1].id : 0
      try {
        const ch = await call(`/requests/${encodeURIComponent(current.ticket_no)}/changes?after=${last}`)
        if (ch.live) showAsk(ch.live)
        if (ch.messages.length || ch.status !== current.status) {
          setCurrent(c => c ? { ...c, ...ch, messages: [...(c.messages || []), ...ch.messages] } : c)
          if (shownRef.current) markSeen(ch.ticket_no, ch.updated_at || '')
        }
      } catch {}
    }, POLL_MS)
    return () => clearInterval(timer)
  }, [view, current, call, markSeen])

  // ── live help: an agent asking to talk or to see the screen ──────────────
  const showAsk = useCallback((a: LiveAsk | null) => {
    if (a && a.status === 'requested') {
      setAsking(a)
      setAskLeft(Math.max(0, a.seconds_left ?? 60))
      if (seenAsk.current !== a.id) {
        seenAsk.current = a.id
        setLiveLink('')
        toParent({ type: 'sc:live-request', kind: a.kind, agent: a.agent })   // the widget opens on Support
      }
    } else {
      setAsking(null)
    }
  }, [])

  useEffect(() => {
    if (!config?.live_help || waitingForToken || !known) return
    const look = async () => { try { showAsk((await call('/live')).live) } catch {} }
    look()
    const timer = setInterval(look, LIVE_POLL_MS)
    return () => clearInterval(timer)
  }, [config, waitingForToken, known, call, showAsk])

  useEffect(() => {
    if (!asking) return
    if (askLeft <= 0) { setAsking(null); return }
    const t = setTimeout(() => setAskLeft(s => s - 1), 1000)
    return () => clearTimeout(t)
  }, [asking, askLeft])

  const acceptLive = async () => {
    if (!asking) return
    setLiveBusy(true); setError('')
    // opened now, while the click still counts, then sent to its address once the pass is here
    const win = window.open('', 'sc_live_help', 'width=440,height=600')
    liveWin.current = win
    try { if (win) win.document.body.innerHTML = '<p style="font-family:sans-serif;padding:24px;color:#555">Connecting...</p>' } catch {}
    const screenOk = !!(navigator.mediaDevices && (navigator.mediaDevices as any).getDisplayMedia) && !/Mobi|Android|iPhone|iPad/i.test(navigator.userAgent)
    try {
      const d = await call(`/live/${asking.id}/accept`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ screen_ok: screenOk }),
      })
      const hash = new URLSearchParams({ pass: d.pass, kind: asking.kind, agent: asking.agent || 'Support', screen: screenOk ? '1' : '0' })
      const url = `${window.location.origin}/widget/live#${hash.toString()}`
      if (win && !win.closed) win.location.href = url
      else setLiveLink(url)
      setAsking(null)
    } catch (e: any) {
      try { win?.close() } catch {}
      setError(e.message); setAsking(null)
    } finally {
      setLiveBusy(false)
    }
  }

  const denyLive = async () => {
    if (!asking) return
    setLiveBusy(true)
    try { await call(`/live/${asking.id}/deny`, { method: 'POST' }) } catch {}
    setAsking(null); setLiveBusy(false)
  }

  const liveBanner = (asking || liveLink) ? (
    <div className="m-3 rounded-lg border border-indigo-200 bg-indigo-50 p-3 text-sm space-y-2">
      {asking ? <>
        <p><span className="font-semibold">{asking.agent || 'Support'}</span> {asking.kind === 'screen' ? 'wants to see your screen and talk to you' : 'wants to talk to you'} about {asking.ticket_no}.</p>
        <p className="text-[11px] text-gray-500">{asking.kind === 'screen' ? 'They can only watch, never use your computer. ' : ''}Nothing is recorded. ({askLeft} s)</p>
        <div className="flex gap-2">
          <button onClick={acceptLive} disabled={liveBusy} className="flex-1 py-2 rounded-lg text-white font-semibold disabled:opacity-50" style={{ background: color }}>Accept</button>
          <button onClick={denyLive} disabled={liveBusy} className="flex-1 py-2 rounded-lg border border-gray-300 bg-white font-semibold disabled:opacity-50">No, thanks</button>
        </div>
      </> : <>
        <p>Your browser kept the live help window from opening.</p>
        <a href={liveLink} target="_blank" rel="noopener" onClick={() => setLiveLink('')} className="block text-center py-2 rounded-lg text-white font-semibold" style={{ background: color }}>Open live help</a>
      </>}
    </div>
  ) : null

  // ── what is shown ─────────────────────────────────────────────────────────
  if (unavailable) return <Shell color={color} title="Support"><p className="p-6 text-sm text-gray-600 text-center">{unavailable}</p></Shell>
  if (!config || waitingForToken) return <Shell color={color} title="Support"><p className="p-6 text-sm text-gray-500 text-center">Loading...</p></Shell>

  if (!known) {
    if (!config.allow_anonymous) {
      return <Shell color={color} title={config.name}><p className="p-6 text-sm text-gray-600 text-center">Sign in to the site to ask for support.</p></Shell>
    }
    return <Shell color={color} title={config.name}>
      <EmailStep color={color} onVerified={sid => { writeStore(SESSION_KEY, sid); setSession(sid) }} />
    </Shell>
  }

  return (
    <Shell color={color} title={config.name} subtitle={me ? `${me.name || me.email}${me.signed ? '' : ' (verified email)'}` : ''}
           onBack={view !== 'list' ? () => { setView('list'); setCurrent(null); loadList() } : undefined}>
      {liveBanner}
      {error && <p className="px-4 pt-3 text-xs text-red-600">{error}</p>}
      {view === 'list' && (
        <RequestList color={color} items={list} onOpen={openThread} onNew={() => setView('new')}
          unread={r => !!r.from_support && (readJson(seenKey) || {})[r.ticket_no] !== (r.updated_at || '')} />
      )}
      {view === 'new' && (
        <NewRequest color={color} config={config} phone={me?.phone || ''} prefill={prefill} call={call}
                    onCreated={r => { setCurrent(r); setView('thread'); setPrefill({ screen: '', url: '' }) }} />
      )}
      {view === 'thread' && current && (
        <Thread color={color} request={current} call={call} config={config} onUpdated={setCurrent} />
      )}
    </Shell>
  )
}

// ── pieces ──────────────────────────────────────────────────────────────────

function Shell({ color, title, subtitle, onBack, children }: { color: string; title: string; subtitle?: string; onBack?: () => void; children: React.ReactNode }) {
  return (
    <div className="h-screen flex flex-col bg-gray-50 text-gray-900" style={{ fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif' }}>
      <div className="px-4 py-3 text-white flex items-center gap-2 shrink-0" style={{ background: color }}>
        {onBack && <button onClick={onBack} className="text-white/90 hover:text-white text-lg leading-none" aria-label="Back">&larr;</button>}
        <div className="min-w-0">
          <p className="font-semibold text-sm truncate">{title}</p>
          {subtitle && <p className="text-[11px] text-white/80 truncate">{subtitle}</p>}
        </div>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto">{children}</div>
    </div>
  )
}

function EmailStep({ color, onVerified }: { color: string; onVerified: (sid: string) => void }) {
  const [name, setName] = useState(readStore(NAME_KEY))
  const [email, setEmail] = useState(readStore(EMAIL_KEY))
  const [code, setCode] = useState('')
  const [otpToken, setOtpToken] = useState('')
  const [step, setStep] = useState<'email' | 'code'>('email')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const ask = async () => {
    setBusy(true); setErr('')
    try {
      const r = await fetch(`${API_URL}/webchat/request-otp`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: name.trim(), email: email.trim().toLowerCase() }) })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(d.detail || 'Could not send the code.')
      setOtpToken(d.token || ''); setStep('code')
    } catch (e: any) { setErr(e.message) } finally { setBusy(false) }
  }
  const verify = async () => {
    setBusy(true); setErr('')
    try {
      const em = email.trim().toLowerCase()
      const r = await fetch(`${API_URL}/webchat/verify-otp`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: em, otp: code.trim(), token: otpToken }) })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(d.detail || 'That code did not work.')
      writeStore(NAME_KEY, d.visitor_name || name); writeStore(EMAIL_KEY, em)
      onVerified(d.session_id)
    } catch (e: any) { setErr(e.message) } finally { setBusy(false) }
  }

  return (
    <div className="p-5 space-y-3">
      <p className="text-sm text-gray-700">{step === 'email' ? 'Tell us who you are. We email you a code to check the address.' : `Enter the 6-digit code sent to ${email}.`}</p>
      {step === 'email' ? (<>
        <input value={name} onChange={e => setName(e.target.value)} placeholder="Your name" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
        <input value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" type="email" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
        <button onClick={ask} disabled={busy || !name.trim() || !email.trim()} className="w-full py-2 rounded-lg text-white text-sm font-semibold disabled:opacity-50" style={{ background: color }}>{busy ? 'Sending...' : 'Send code'}</button>
      </>) : (<>
        <input value={code} onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="000000" inputMode="numeric" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm tracking-widest text-center" />
        <button onClick={verify} disabled={busy || code.length !== 6} className="w-full py-2 rounded-lg text-white text-sm font-semibold disabled:opacity-50" style={{ background: color }}>{busy ? 'Checking...' : 'Verify'}</button>
        <button onClick={() => { setStep('email'); setCode('') }} className="w-full text-xs text-gray-500 hover:underline">Use another address</button>
      </>)}
      {err && <p className="text-xs text-red-600">{err}</p>}
    </div>
  )
}

function StatusPill({ status, label }: { status: string; label: string }) {
  const c = status === 'solved' ? 'bg-green-100 text-green-800' : status === 'replied' ? 'bg-indigo-100 text-indigo-800' : 'bg-amber-100 text-amber-800'
  return <span className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded ${c}`}>{label}</span>
}

function RequestList({ color, items, onOpen, onNew, unread }: { color: string; items: Request[]; onOpen: (no: string) => void; onNew: () => void; unread?: (r: Request) => boolean }) {
  return (
    <div className="p-4 space-y-3">
      <button onClick={onNew} className="w-full py-2.5 rounded-lg text-white text-sm font-semibold" style={{ background: color }}>New request</button>
      {items.length === 0 ? (
        <p className="text-xs text-gray-500 text-center py-6">You have not asked for help yet.</p>
      ) : items.map(r => (
        <button key={r.ticket_no} onClick={() => onOpen(r.ticket_no)} className="w-full text-left bg-white border border-gray-200 rounded-lg p-3 hover:border-gray-300">
          <div className="flex items-center gap-2">
            {unread?.(r) && <span className="w-2 h-2 rounded-full bg-red-500 shrink-0" title="New reply" />}
            <p className={`text-sm truncate flex-1 ${unread?.(r) ? 'font-bold' : 'font-semibold'}`}>{r.subject}</p>
            <StatusPill status={r.status} label={r.status_label} />
          </div>
          {r.last_message && <p className="text-xs text-gray-500 mt-1 line-clamp-2">{r.last_message}</p>}
          <p className="text-[10px] text-gray-400 mt-1">{r.ticket_no}{r.updated_at ? ` · ${new Date(r.updated_at).toLocaleString()}` : ''}</p>
        </button>
      ))}
    </div>
  )
}

function FilePicker({ files, setFiles, max, types }: { files: File[]; setFiles: (f: File[]) => void; max: number; types: string[] }) {
  const input = useRef<HTMLInputElement>(null)
  return (
    <div className="space-y-1">
      <input ref={input} type="file" multiple className="hidden" accept={types.map(t => '.' + t).join(',')}
             onChange={e => { setFiles([...files, ...Array.from(e.target.files || [])].slice(0, max)); if (input.current) input.current.value = '' }} />
      <button type="button" onClick={() => input.current?.click()} disabled={files.length >= max} className="text-xs font-semibold text-gray-700 border border-gray-300 rounded px-2 py-1 bg-white disabled:opacity-50">Attach a file</button>
      {files.map((f, i) => (
        <p key={i} className="text-xs text-gray-600 flex items-center gap-1">{f.name} ({sizeLabel(f.size)})
          <button type="button" onClick={() => setFiles(files.filter((_, j) => j !== i))} className="text-gray-400 hover:text-red-600" aria-label={`Remove ${f.name}`}>&times;</button></p>
      ))}
    </div>
  )
}

function NewRequest({ color, config, phone, prefill, call, onCreated }: {
  color: string; config: Config; phone: string; prefill: { screen: string; url: string }
  call: (p: string, i?: RequestInit) => Promise<any>; onCreated: (r: Request) => void
}) {
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [category, setCategory] = useState(config.categories[0] || '')
  const [priority, setPriority] = useState('normal')
  const [contact, setContact] = useState(phone)
  const [screen, setScreen] = useState(prefill.screen)
  const [files, setFiles] = useState<File[]>([])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const requestId = useRef(newRequestId())
  useEffect(() => { setScreen(prefill.screen) }, [prefill.screen])
  useEffect(() => { if (!contact) setContact(phone) }, [phone])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true); setErr('')
    const f = new FormData()
    Object.entries({ subject, body, category, priority, phone: contact, screen, url: prefill.url, request_id: requestId.current, source: 'support_widget' })
      .forEach(([k, v]) => f.append(k, v))
    files.forEach(x => f.append('files', x))
    try { onCreated(await call('/requests', { method: 'POST', body: f })) } catch (e: any) { setErr(e.message) } finally { setBusy(false) }
  }

  const field = 'w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white'
  return (
    <form onSubmit={submit} className="p-4 space-y-3">
      <input value={subject} onChange={e => setSubject(e.target.value)} placeholder="What is it about?" maxLength={200} className={field} />
      <textarea value={body} onChange={e => setBody(e.target.value)} placeholder="Describe what happened, and what you expected" rows={5} className={field + ' resize-none'} />
      <div className="grid grid-cols-2 gap-2">
        {config.categories.length > 0 ? (
          <select value={category} onChange={e => setCategory(e.target.value)} className={field} aria-label="Category">
            {config.categories.map(c => <option key={c}>{c}</option>)}
          </select>
        ) : (
          <input value={category} onChange={e => setCategory(e.target.value)} placeholder="Category" className={field} />
        )}
        <select value={priority} onChange={e => setPriority(e.target.value)} className={field} aria-label="Priority">
          {config.priorities.map(p => <option key={p} value={p}>{p[0].toUpperCase() + p.slice(1)}</option>)}
        </select>
      </div>
      <input value={screen} onChange={e => setScreen(e.target.value)} placeholder="Which screen or page?" className={field} />
      <input value={contact} onChange={e => setContact(e.target.value)} placeholder="Phone to call you back (optional)" className={field} />
      <FilePicker files={files} setFiles={setFiles} max={config.max_files} types={config.file_types} />
      <p className="text-[10px] text-gray-400">Up to {config.max_files} files, {config.max_file_mb} MB each.</p>
      {err && <p className="text-xs text-red-600">{err}</p>}
      <button type="submit" disabled={busy || subject.trim().length < 3 || !body.trim()} className="w-full py-2.5 rounded-lg text-white text-sm font-semibold disabled:opacity-50" style={{ background: color }}>{busy ? 'Sending...' : 'Send request'}</button>
    </form>
  )
}

function Thread({ color, request, call, config, onUpdated }: {
  color: string; request: Request; call: (p: string, i?: RequestInit) => Promise<any>; config: Config; onUpdated: (r: Request) => void
}) {
  const [body, setBody] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const requestId = useRef(newRequestId())
  const bottom = useRef<HTMLDivElement>(null)
  const count = request.messages?.length || 0
  useEffect(() => { bottom.current?.scrollIntoView({ block: 'nearest' }) }, [count])

  const send = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true); setErr('')
    const f = new FormData()
    f.append('body', body); f.append('request_id', requestId.current)
    files.forEach(x => f.append('files', x))
    try {
      onUpdated(await call(`/requests/${encodeURIComponent(request.ticket_no)}/messages`, { method: 'POST', body: f }))
      setBody(''); setFiles([]); requestId.current = newRequestId()
    } catch (e: any) { setErr(e.message) } finally { setBusy(false) }
  }

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 py-3 bg-white border-b border-gray-200">
        <div className="flex items-center gap-2">
          <p className="text-sm font-semibold flex-1">{request.subject}</p>
          <StatusPill status={request.status} label={request.status_label} />
        </div>
        <p className="text-[10px] text-gray-400 mt-0.5">{request.ticket_no}{request.screen ? ` · ${request.screen}` : ''}</p>
      </div>
      <div className="flex-1 p-4 space-y-2.5 overflow-y-auto">
        {(request.messages || []).map(m => m.author_type === 'system' ? (
          <p key={m.id} className="text-center text-[11px] text-gray-500">{m.body}</p>
        ) : (
          <div key={m.id} className={`flex ${m.author_type === 'customer' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm ${m.author_type === 'customer' ? 'text-white' : 'bg-white border border-gray-200'}`}
                 style={m.author_type === 'customer' ? { background: color } : undefined}>
              <p className={`text-[10px] font-semibold mb-0.5 ${m.author_type === 'customer' ? 'text-white/80' : 'text-gray-500'}`}>
                {m.author_name} · {new Date(m.created_at).toLocaleString()}
              </p>
              {m.body && <p className="whitespace-pre-wrap break-words">{m.body}</p>}
              {m.attachments.map(a => (
                <a key={a.index} href={`${API_URL}${a.url}`} target="_blank" rel="noopener noreferrer"
                   className={`block text-xs underline mt-1 ${m.author_type === 'customer' ? 'text-white' : 'text-indigo-600'}`}>
                  {a.name} ({sizeLabel(a.size)})
                </a>
              ))}
            </div>
          </div>
        ))}
        <div ref={bottom} />
      </div>
      {request.can_reply === false ? (
        <p className="p-4 text-xs text-gray-500 text-center border-t border-gray-200 bg-white">This request is closed. Raise a new one if you still need help.</p>
      ) : (
        <form onSubmit={send} className="p-3 border-t border-gray-200 bg-white space-y-2">
          <textarea value={body} onChange={e => setBody(e.target.value)} rows={2} placeholder={request.status === 'solved' ? 'Reply to reopen this request' : 'Write a reply'}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm resize-none" />
          <div className="flex items-start gap-2">
            <div className="flex-1"><FilePicker files={files} setFiles={setFiles} max={config.max_files} types={config.file_types} /></div>
            <button type="submit" disabled={busy || (!body.trim() && files.length === 0)} className="px-4 py-1.5 rounded-lg text-white text-sm font-semibold disabled:opacity-50" style={{ background: color }}>{busy ? '...' : 'Send'}</button>
          </div>
          {err && <p className="text-xs text-red-600">{err}</p>}
        </form>
      )}
    </div>
  )
}
