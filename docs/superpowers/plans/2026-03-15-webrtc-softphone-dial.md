# WebRTC Softphone / Dial Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the mock softphone placeholder with a real SIP.js-powered in-browser softphone — outbound dialling and inbound call answering, gated by admin permission, integrated with the workspace ticket flow.

**Architecture:** A new backend endpoint serves SIP credentials (extension + password + WSS URL) to authorised agents. The existing `softphone-context.tsx` is upgraded from a UI-only stub to a full SIP.js UserAgent lifecycle manager. The existing `Softphone.tsx` floating popup is upgraded to use real calls. The workspace right-sidebar placeholder is replaced with a live softphone status panel; when an inbound call is answered, the existing `activeNumber` workspace flow auto-opens the TicketForm.

**Tech Stack:** FastAPI (backend), SIP.js v0.21 (browser SIP/WebRTC), React context (state), TailwindCSS (UI). No test framework — verify via Swagger UI and browser. FreePBX with WebRTC/WSS transport is an infrastructure prerequisite.

---

## File Map

| File | Action | Purpose |
|---|---|---|
| `backend/app/routes/agent_workspace.py` | Modify | Add `GET /workspace/sip-credentials` endpoint |
| `frontend/lib/softphone-context.tsx` | Rewrite | Full SIP.js UA lifecycle, real call state, credential fetch |
| `frontend/components/Softphone.tsx` | Rewrite | Real call UI using context (floating popup, upgraded) |
| `frontend/app/workspace/page.tsx` | Modify | Replace sidebar placeholder with status panel; use softphone context for `activeNumber` |

---

## Chunk 1: Backend — SIP Credentials Endpoint

### Task 1: Add `GET /workspace/sip-credentials` to agent_workspace.py

**Files:**
- Modify: `backend/app/routes/agent_workspace.py`

- [ ] **Step 1: Read the top of agent_workspace.py to understand existing imports and patterns**

```bash
head -30 backend/app/routes/agent_workspace.py
```

Look for existing imports of `get_current_user`, `require_permission`, `AgentExtension`, `TelephonySettings`. Note the router prefix (expected: `/workspace`).

- [ ] **Step 2: Add `require_permission` to the import on line 6 of agent_workspace.py**

The existing line 6 is:
```python
from app.dependencies import get_current_user
```

Change it to:
```python
from app.dependencies import get_current_user, require_permission
```

- [ ] **Step 3: Add the new endpoint at the bottom of agent_workspace.py**

Find the end of the file and add:

```python
@router.get("/sip-credentials")
def get_sip_credentials(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("callcenter", "make_call")),
):
    """Return the calling agent's SIP extension + password + FreePBX WSS URL.
    Returns 403 if agent lacks callcenter/make_call permission (enforced by dependency).
    Returns 404 if agent has permission but no extension assigned yet.
    """
    from app.models.agent_extension import AgentExtension
    from app.models.telephony import TelephonySettings

    ext = db.query(AgentExtension).filter(
        AgentExtension.user_id == current_user.id,
        AgentExtension.is_enabled == True,
    ).first()
    if not ext:
        raise HTTPException(status_code=404, detail="No SIP extension assigned to this agent. Contact admin.")

    settings = db.query(TelephonySettings).first()
    if not settings or not settings.webrtc_wss_url:
        raise HTTPException(status_code=503, detail="FreePBX WSS URL not configured. Contact admin.")

    # Derive realm from WSS URL (strip wss:// and path)
    import re
    realm_match = re.match(r"wss://([^/:]+)", settings.webrtc_wss_url)
    realm = realm_match.group(1) if realm_match else settings.host or "pbx"

    return {
        "extension": ext.extension,
        "password": ext.sip_password,
        "wss_url": settings.webrtc_wss_url,
        "realm": realm,
    }
```

Note: `Session`, `Depends`, `HTTPException`, `get_db`, `User` are already imported at the top. `require_permission` was added in Step 2 above.

- [ ] **Step 3: Verify the endpoint exists in Swagger**

```bash
cd backend && source venv/bin/activate && uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

Navigate to `http://localhost:8000/docs` → search for `/workspace/sip-credentials`. Click "Try it out" with a valid agent bearer token.

- Expected (agent with permission + extension assigned): `200` with `{ extension, password, wss_url, realm }`
- Expected (agent without `callcenter/make_call` permission): `403`
- Expected (agent with permission but no extension): `404`

- [ ] **Step 4: Commit**

```bash
git add backend/app/routes/agent_workspace.py
git commit -m "feat: add GET /workspace/sip-credentials endpoint for SIP.js registration"
```

---

## Chunk 2: Frontend — SIP.js Context

### Task 2: Install SIP.js

**Files:**
- Modify: `frontend/package.json` (via npm)

- [ ] **Step 1: Install SIP.js**

```bash
cd frontend && npm install sip.js
```

Expected: `sip.js` appears in `package.json` dependencies. Version should be `^0.21.x` or later.

- [ ] **Step 2: Verify TypeScript types are bundled**

```bash
ls frontend/node_modules/sip.js/lib/index.d.ts
```

Expected: file exists (SIP.js ships its own types).

- [ ] **Step 3: Commit**

```bash
git add frontend/package.json frontend/package-lock.json
git commit -m "feat: install sip.js for WebRTC softphone"
```

---

### Task 3: Rewrite softphone-context.tsx with real SIP.js lifecycle

**Files:**
- Rewrite: `frontend/lib/softphone-context.tsx`

- [ ] **Step 1: Read the current file to understand what the rest of the app expects from it**

```bash
grep -rn "useSoftphone\|SoftphoneProvider\|SoftphoneContext" frontend/ --include="*.tsx" --include="*.ts"
```

Note which properties are consumed: `isOpen`, `dialNumber`, `dial`, `close`, `setDialNumber`.

- [ ] **Step 2: Rewrite softphone-context.tsx**

Replace the entire file with:

```tsx
'use client'

import {
  createContext, useContext, useState, useCallback,
  useEffect, useRef, ReactNode
} from 'react'
import { getAuthToken } from '@/lib/auth'
import { API_URL } from '@/lib/config'

export type SoftphoneStatus =
  | 'unauthorized'   // 403 from API — agent lacks permission
  | 'no_extension'   // 404 from API — no SIP extension assigned
  | 'loading'        // fetching credentials
  | 'registering'    // UA connecting to FreePBX
  | 'registered'     // Ready
  | 'error'          // Registration failed

export type CallState =
  | 'idle'
  | 'ringing_in'     // inbound ringing (not yet answered)
  | 'ringing_out'    // outbound, waiting for remote to answer
  | 'active'
  | 'on_hold'

interface SoftphoneContextType {
  // Status
  status: SoftphoneStatus
  callState: CallState
  callerNumber: string | null   // set on answer — triggers workspace TicketForm
  remoteDisplayName: string | null

  // UI state (floating popup open/close)
  isOpen: boolean
  dialNumber: string | null     // pre-fill dial pad (used by click-to-call)

  // Actions
  dial: (number: string) => void
  answer: () => void
  hangup: () => void
  toggleMute: () => void
  toggleHold: () => void
  close: () => void
  setDialNumber: (n: string | null) => void

  // Call timer
  callSeconds: number
  isMuted: boolean
  isOnHold: boolean
}

const SoftphoneContext = createContext<SoftphoneContextType>({
  status: 'loading',
  callState: 'idle',
  callerNumber: null,
  remoteDisplayName: null,
  isOpen: false,
  dialNumber: null,
  dial: () => {},
  answer: () => {},
  hangup: () => {},
  toggleMute: () => {},
  toggleHold: () => {},
  close: () => {},
  setDialNumber: () => {},
  callSeconds: 0,
  isMuted: false,
  isOnHold: false,
})

export function SoftphoneProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<SoftphoneStatus>('loading')
  const [callState, setCallState] = useState<CallState>('idle')
  const [callerNumber, setCallerNumber] = useState<string | null>(null)
  const [remoteDisplayName, setRemoteDisplayName] = useState<string | null>(null)
  const [isOpen, setIsOpen] = useState(false)
  const [dialNumber, setDialNumber] = useState<string | null>(null)
  const [isMuted, setIsMuted] = useState(false)
  const [isOnHold, setIsOnHold] = useState(false)
  const [callSeconds, setCallSeconds] = useState(0)

  // SIP.js refs — stored as any to avoid type import issues at module load time
  // SIP.js is dynamically imported so it is not bundled until needed
  const uaRef = useRef<any>(null)
  const sessionRef = useRef<any>(null)
  const timerRef = useRef<NodeJS.Timeout | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  // Cache UserAgent constructor from dynamic import so dial() can use makeURI without require()
  const UserAgentClassRef = useRef<any>(null)

  // ── Call timer ───────────────────────────────────────────────────────────
  useEffect(() => {
    if (callState === 'active') {
      setCallSeconds(0)
      timerRef.current = setInterval(() => setCallSeconds(s => s + 1), 1000)
    } else {
      if (timerRef.current) clearInterval(timerRef.current)
      if (callState === 'idle') setCallSeconds(0)
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current) }
  }, [callState])

  // ── Credential fetch + SIP.js bootstrap ─────────────────────────────────
  useEffect(() => {
    const token = getAuthToken()
    if (!token) { setStatus('unauthorized'); return }

    let destroyed = false

    async function bootstrap() {
      try {
        const res = await fetch(`${API_URL}/workspace/sip-credentials`, {
          headers: { Authorization: `Bearer ${token}` },
        })
        if (destroyed) return

        if (res.status === 403) { setStatus('unauthorized'); return }
        if (res.status === 404) { setStatus('no_extension'); return }
        if (!res.ok) { setStatus('error'); return }

        const creds = await res.json()
        // Dynamically import SIP.js — only loaded for authorised agents
        const { UserAgent, Registerer, Inviter, SessionState } = await import('sip.js')
        if (destroyed) return
        // Cache UserAgent so dial() can call makeURI without a second dynamic import
        UserAgentClassRef.current = UserAgent

        const uri = UserAgent.makeURI(`sip:${creds.extension}@${creds.realm}`)
        if (!uri) { setStatus('error'); return }

        const ua = new UserAgent({
          uri,
          transportOptions: { server: creds.wss_url },
          authorizationUsername: creds.extension,
          authorizationPassword: creds.password,
          sessionDescriptionHandlerFactoryOptions: {
            constraints: { audio: true, video: false },
          },
          delegate: {
            onInvite(session: any) {
              // Inbound call
              sessionRef.current = session
              const remoteId = session.remoteIdentity?.uri?.user || 'Unknown'
              const displayName = session.remoteIdentity?.displayName || null
              setCallerNumber(remoteId)
              setRemoteDisplayName(displayName)
              setCallState('ringing_in')
              setIsOpen(true)

              session.stateChange.addListener((state: any) => {
                if (state === SessionState.Terminated) {
                  resetCall()
                }
              })
            },
          },
        })

        uaRef.current = ua
        setStatus('registering')

        const registerer = new Registerer(ua)
        await ua.start()
        if (destroyed) { await ua.stop(); return }
        await registerer.register()
        if (destroyed) { await registerer.unregister(); await ua.stop(); return }
        setStatus('registered')

        // Attach registerer for cleanup
        ;(ua as any)._registerer = registerer

      } catch (err) {
        console.error('[Softphone] bootstrap error', err)
        if (!destroyed) setStatus('error')
      }
    }

    bootstrap()

    return () => {
      destroyed = true
      const ua = uaRef.current
      if (ua) {
        try { ua._registerer?.unregister() } catch {}
        try { ua.stop() } catch {}
        uaRef.current = null
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []) // Only on mount — credentials fetched once per session

  // ── Helpers ───────────────────────────────────────────────────────────────
  function resetCall() {
    setCallState('idle')
    setCallerNumber(null)
    setRemoteDisplayName(null)
    setIsMuted(false)
    setIsOnHold(false)
    sessionRef.current = null
    if (audioRef.current) { audioRef.current.srcObject = null }
  }

  function attachAudio(session: any) {
    const pc = session.sessionDescriptionHandler?.peerConnection
    if (!pc) return
    const remoteStream = new MediaStream()
    pc.getReceivers().forEach((r: any) => {
      if (r.track) remoteStream.addTrack(r.track)
    })
    if (!audioRef.current) {
      audioRef.current = new Audio()
      audioRef.current.autoplay = true
    }
    audioRef.current.srcObject = remoteStream
  }

  // ── Public actions ────────────────────────────────────────────────────────
  const dial = useCallback(async (number: string) => {
    // Empty string: just open the popup (used by the workspace "Open Dial Pad" button)
    if (!number) { setIsOpen(true); return }
    const ua = uaRef.current
    if (!ua || status !== 'registered') return
    const { Inviter, SessionState } = await import('sip.js')
    const UA = UserAgentClassRef.current
    if (!UA) return
    const target = UA.makeURI(`sip:${number}@${ua.configuration.uri.host}`)
    if (!target) return

    const session = new Inviter(ua, target)
    sessionRef.current = session
    setCallerNumber(number)
    setRemoteDisplayName(null)
    setCallState('ringing_out')
    setIsOpen(true)

    session.stateChange.addListener((state: any) => {
      if (state === SessionState.Established) {
        attachAudio(session)
        setCallState('active')
      } else if (state === SessionState.Terminated) {
        resetCall()
      }
    })

    await session.invite()
  }, [status])

  const answer = useCallback(async () => {
    const session = sessionRef.current
    if (!session) return
    const { SessionState } = await import('sip.js')
    await session.accept()
    attachAudio(session)
    setCallState('active')
    // Trigger workspace TicketForm — callerNumber is already set from onInvite
  }, [])

  const hangup = useCallback(() => {
    const session = sessionRef.current
    if (!session) return
    try {
      if (session.state === 'Established') session.bye()
      else session.reject?.() || session.cancel?.()
    } catch {}
    resetCall()
    setIsOpen(false)
  }, [])

  const toggleMute = useCallback(() => {
    const session = sessionRef.current
    if (!session) return
    const pc = session.sessionDescriptionHandler?.peerConnection
    if (!pc) return
    const newMuted = !isMuted
    pc.getSenders().forEach((s: any) => {
      if (s.track?.kind === 'audio') s.track.enabled = !newMuted
    })
    setIsMuted(newMuted)
  }, [isMuted])

  const toggleHold = useCallback(async () => {
    const session = sessionRef.current
    if (!session) return
    const newHold = !isOnHold
    if (newHold) await session.invite({ sessionDescriptionHandlerOptions: { hold: true } })
    else await session.invite({ sessionDescriptionHandlerOptions: { hold: false } })
    setIsOnHold(newHold)
    setCallState(newHold ? 'on_hold' : 'active')
  }, [isOnHold])

  const close = useCallback(() => {
    setIsOpen(false)
    setDialNumber(null)
  }, [])

  return (
    <SoftphoneContext.Provider value={{
      status, callState, callerNumber, remoteDisplayName,
      isOpen, dialNumber,
      dial, answer, hangup, toggleMute, toggleHold, close, setDialNumber,
      callSeconds, isMuted, isOnHold,
    }}>
      {children}
    </SoftphoneContext.Provider>
  )
}

export function useSoftphone() {
  return useContext(SoftphoneContext)
}
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd frontend && npx tsc --noEmit 2>&1 | grep -i "softphone-context" | head -20
```

Expected: no errors for `softphone-context.tsx`. Address any type errors before continuing.

- [ ] **Step 4: Commit**

```bash
git add frontend/lib/softphone-context.tsx
git commit -m "feat: upgrade softphone-context with real SIP.js UserAgent lifecycle"
```

---

## Chunk 3: Frontend — Softphone UI Component

### Task 4: Rewrite Softphone.tsx with real call UI

**Files:**
- Rewrite: `frontend/components/Softphone.tsx`

- [ ] **Step 1: Rewrite Softphone.tsx**

Replace the entire file with:

```tsx
'use client'

import { useState, useEffect } from 'react'
import { Phone, PhoneOff, Mic, MicOff, Pause, Play, X } from 'lucide-react'
import { useSoftphone } from '@/lib/softphone-context'

const DIAL_KEYS = [
  { num: '1', sub: '' }, { num: '2', sub: 'ABC' }, { num: '3', sub: 'DEF' },
  { num: '4', sub: 'GHI' }, { num: '5', sub: 'JKL' }, { num: '6', sub: 'MNO' },
  { num: '7', sub: 'PQRS' }, { num: '8', sub: 'TUV' }, { num: '9', sub: 'WXYZ' },
  { num: '*', sub: '' }, { num: '0', sub: '+' }, { num: '#', sub: '' },
]

function formatTime(s: number) {
  const m = Math.floor(s / 60)
  return `${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

export default function Softphone() {
  const {
    status, callState, callerNumber, remoteDisplayName,
    isOpen, dialNumber,
    dial, answer, hangup, toggleMute, toggleHold, close, setDialNumber,
    callSeconds, isMuted, isOnHold,
  } = useSoftphone()

  const [inputNumber, setInputNumber] = useState('')

  // When context sets dialNumber (click-to-call from ticket table), populate input
  useEffect(() => {
    if (dialNumber) {
      setInputNumber(dialNumber)
      setDialNumber(null)
    }
  }, [dialNumber, setDialNumber])

  if (!isOpen) return null

  const statusDot =
    status === 'registered' ? 'bg-green-400' :
    status === 'registering' ? 'bg-yellow-400 animate-pulse' :
    status === 'error' ? 'bg-red-500' : 'bg-gray-400'

  const statusLabel =
    status === 'registered' ? 'Ready' :
    status === 'registering' ? 'Connecting…' :
    status === 'unauthorized' ? 'Not authorized' :
    status === 'no_extension' ? 'No extension assigned' :
    status === 'error' ? 'Registration failed' : 'Loading…'

  return (
    <div className="fixed bottom-6 right-6 w-80 bg-white rounded-2xl shadow-2xl border border-gray-200 z-50 overflow-hidden flex flex-col">
      {/* Header */}
      <div className="bg-gray-900 text-white px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full ${statusDot}`} />
          <span className="text-sm font-medium">{statusLabel}</span>
        </div>
        <button onClick={close} className="text-gray-400 hover:text-white transition">
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="p-5 flex flex-col gap-4 bg-gray-50">

        {/* Inbound ringing */}
        {callState === 'ringing_in' && (
          <div className="flex flex-col items-center gap-3 py-4">
            <div className="w-14 h-14 rounded-full bg-indigo-100 flex items-center justify-center animate-pulse">
              <Phone className="w-7 h-7 text-indigo-600" />
            </div>
            <div className="text-center">
              <p className="text-xs text-gray-400 uppercase tracking-wide">Incoming Call</p>
              <p className="text-lg font-semibold text-gray-800 mt-0.5">
                {remoteDisplayName || callerNumber || 'Unknown'}
              </p>
              {remoteDisplayName && (
                <p className="text-sm text-gray-500">{callerNumber}</p>
              )}
            </div>
            <div className="flex gap-4 mt-2">
              <button
                onClick={hangup}
                className="w-12 h-12 rounded-full bg-red-500 flex items-center justify-center text-white hover:bg-red-600 transition"
              >
                <PhoneOff className="w-5 h-5" />
              </button>
              <button
                onClick={answer}
                className="w-12 h-12 rounded-full bg-green-500 flex items-center justify-center text-white hover:bg-green-600 transition"
              >
                <Phone className="w-5 h-5" />
              </button>
            </div>
          </div>
        )}

        {/* Active / outbound ringing */}
        {(callState === 'active' || callState === 'on_hold' || callState === 'ringing_out') && (
          <div className="flex flex-col items-center gap-4 py-2">
            <div className="text-center">
              <p className="text-xs text-gray-400 uppercase tracking-wide">
                {callState === 'ringing_out' ? 'Calling…' :
                 callState === 'on_hold' ? 'On Hold' : 'Active Call'}
              </p>
              <p className="text-lg font-semibold text-gray-800 mt-0.5">
                {remoteDisplayName || callerNumber}
              </p>
              {callState === 'active' && (
                <p className="text-sm font-mono text-gray-500 mt-1">{formatTime(callSeconds)}</p>
              )}
            </div>
            <div className="flex gap-4">
              <button
                onClick={toggleMute}
                title={isMuted ? 'Unmute' : 'Mute'}
                className={`w-11 h-11 rounded-full flex items-center justify-center transition ${
                  isMuted ? 'bg-red-100 text-red-600' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                {isMuted ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
              </button>
              <button
                onClick={toggleHold}
                title={isOnHold ? 'Resume' : 'Hold'}
                className={`w-11 h-11 rounded-full flex items-center justify-center transition ${
                  isOnHold ? 'bg-yellow-100 text-yellow-600' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                {isOnHold ? <Play className="w-5 h-5" /> : <Pause className="w-5 h-5" />}
              </button>
              <button
                onClick={hangup}
                title="Hang up"
                className="w-11 h-11 rounded-full bg-red-500 flex items-center justify-center text-white hover:bg-red-600 transition"
              >
                <PhoneOff className="w-5 h-5" />
              </button>
            </div>
          </div>
        )}

        {/* Idle — dial pad */}
        {callState === 'idle' && (
          <>
            {/* Number input */}
            <div className="flex items-center gap-2 bg-white rounded-xl border border-gray-200 px-3 py-2 shadow-sm">
              <input
                type="tel"
                value={inputNumber}
                onChange={e => setInputNumber(e.target.value)}
                placeholder="Enter number…"
                className="flex-1 text-lg font-semibold text-gray-800 focus:outline-none bg-transparent"
              />
              {inputNumber && (
                <button
                  onClick={() => setInputNumber(p => p.slice(0, -1))}
                  className="text-gray-400 hover:text-gray-600 text-lg"
                >⌫</button>
              )}
            </div>

            {/* Dial pad */}
            <div className="grid grid-cols-3 gap-2">
              {DIAL_KEYS.map(k => (
                <button
                  key={k.num}
                  onClick={() => setInputNumber(p => p + k.num)}
                  className="aspect-square rounded-full bg-white border border-gray-200 shadow-sm flex flex-col items-center justify-center hover:bg-gray-50 active:bg-gray-100 transition"
                >
                  <span className="text-lg font-semibold text-gray-800">{k.num}</span>
                  {k.sub && <span className="text-[9px] text-gray-400 uppercase tracking-widest">{k.sub}</span>}
                </button>
              ))}
            </div>

            {/* Call button */}
            <div className="flex justify-center mt-1">
              <button
                onClick={() => { if (inputNumber) dial(inputNumber) }}
                disabled={!inputNumber || status !== 'registered'}
                className="w-14 h-14 rounded-full bg-green-500 flex items-center justify-center text-white shadow-lg hover:bg-green-600 disabled:opacity-40 disabled:cursor-not-allowed transition hover:scale-105 transform"
              >
                <Phone className="w-6 h-6" />
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd frontend && npx tsc --noEmit 2>&1 | grep -i "Softphone" | head -20
```

Expected: no errors for `Softphone.tsx`.

- [ ] **Step 3: Commit**

```bash
git add frontend/components/Softphone.tsx
git commit -m "feat: upgrade Softphone component with real SIP.js call UI (inbound/outbound)"
```

---

## Chunk 4: Frontend — Workspace Integration

### Task 5: Wire workspace to softphone context + replace sidebar placeholder

**Files:**
- Modify: `frontend/app/workspace/page.tsx`

- [ ] **Step 1: Find the activeNumber state and softphone placeholder in workspace**

```bash
grep -n "activeNumber\|setActiveNumber\|Global Softphone\|softphone\|useSoftphone" frontend/app/workspace/page.tsx | head -20
```

Note line numbers for:
- `const [activeNumber, setActiveNumber]` declaration
- The sidebar placeholder div (containing "Global Softphone" text)

- [ ] **Step 2: Import useSoftphone at the top of workspace/page.tsx**

Find the existing imports block. Add:

```tsx
import { useSoftphone } from '@/lib/softphone-context'
```

- [ ] **Step 3: Replace local activeNumber state with softphone context**

Find the existing state declaration (around line 30):
```tsx
const [activeNumber, setActiveNumber] = useState<string | null>(null);
```

Replace with:
```tsx
// activeNumber drives both TicketForm (line ~257) and TicketHistory sidebar (line ~376)
// It is now a union of:
//   softphoneCallerNumber — set by the softphone context when an inbound call is answered
//   manualActiveNumber    — set by the dev Simulate Call button (unchanged)
// When softphoneCallerNumber becomes non-null (agent answers a real inbound call),
// activeNumber becomes truthy → TicketForm auto-opens with the caller number pre-filled.
const { callerNumber: softphoneCallerNumber, isOpen: softphoneOpen, status: softphoneStatus, dial: softphoneDial } = useSoftphone()
const [manualActiveNumber, setManualActiveNumber] = useState<string | null>(null)
const activeNumber = softphoneCallerNumber || manualActiveNumber
const setActiveNumber = (n: string | null) => setManualActiveNumber(n)
```

This preserves the existing simulate-call button behaviour (still uses `setActiveNumber`) while also picking up real inbound calls via `softphoneCallerNumber`. The existing TicketForm render at line ~257 (`{activeNumber ? <TicketForm activeNumber={activeNumber} ... /> : ...}`) requires no changes — it already responds to any truthy `activeNumber`.

- [ ] **Step 4: Replace the sidebar placeholder with a softphone status panel**

Find the div containing "Global Softphone" text (the gradient placeholder, around line 383):

```tsx
<div className="bg-white rounded-2xl shadow-xl border border-gray-200 overflow-hidden flex-1 relative flex flex-col items-center justify-center p-8 bg-gradient-to-br from-indigo-500 to-purple-600 text-white h-full min-h-[400px]">
  <Phone className="w-16 h-16 text-white opacity-90 mb-6 drop-shadow-md" />
  <h2 className="text-2xl font-bold mb-2 tracking-wide text-center drop-shadow-sm">Global Softphone</h2>
  <p className="text-indigo-100 text-center text-sm px-4 leading-relaxed font-medium mt-4">
      Your PBX WebRTC Softphone is currently docked.
  </p>
  <div className="absolute top-[-20%] right-[-10%] w-64 h-64 bg-white opacity-10 rounded-full blur-3xl mix-blend-overlay"></div>
  <div className="absolute bottom-[-10%] left-[-20%] w-80 h-80 bg-purple-300 opacity-20 rounded-full blur-3xl mix-blend-overlay"></div>
</div>
```

Replace with:

```tsx
<div className="bg-white rounded-2xl shadow-sm border border-gray-200 flex flex-col items-center justify-center p-8 h-full min-h-[400px] gap-6">
  {/* Status indicator */}
  <div className="flex flex-col items-center gap-3">
    <div className={`w-16 h-16 rounded-full flex items-center justify-center ${
      softphoneStatus === 'registered' ? 'bg-green-100' :
      softphoneStatus === 'registering' ? 'bg-yellow-100' :
      softphoneStatus === 'unauthorized' || softphoneStatus === 'no_extension' ? 'bg-gray-100' :
      'bg-red-100'
    }`}>
      <Phone className={`w-8 h-8 ${
        softphoneStatus === 'registered' ? 'text-green-600' :
        softphoneStatus === 'registering' ? 'text-yellow-600 animate-pulse' :
        softphoneStatus === 'unauthorized' || softphoneStatus === 'no_extension' ? 'text-gray-400' :
        'text-red-500'
      }`} />
    </div>
    <div className="text-center">
      <p className="font-semibold text-gray-800">
        {softphoneStatus === 'registered' ? 'Softphone Ready' :
         softphoneStatus === 'registering' ? 'Connecting…' :
         softphoneStatus === 'unauthorized' ? 'Dial Not Available' :
         softphoneStatus === 'no_extension' ? 'No Extension Assigned' :
         softphoneStatus === 'error' ? 'Connection Failed' : 'Loading…'}
      </p>
      <p className="text-sm text-gray-400 mt-1">
        {softphoneStatus === 'registered' ? 'Ready to make and receive calls' :
         softphoneStatus === 'unauthorized' ? 'Contact your admin to enable dialling' :
         softphoneStatus === 'no_extension' ? 'Ask admin to assign a SIP extension' :
         softphoneStatus === 'error' ? 'Check FreePBX WSS configuration' : ''}
      </p>
    </div>
  </div>

  {/* Open softphone button — only when registered and not already open */}
  {softphoneStatus === 'registered' && !softphoneOpen && (
    <button
      onClick={() => softphoneDial('')}
      className="px-5 py-2.5 bg-indigo-600 text-white rounded-xl font-medium text-sm hover:bg-indigo-700 transition flex items-center gap-2"
    >
      <Phone className="w-4 h-4" /> Open Dial Pad
    </button>
  )}
</div>
```

Note: `softphoneDial('')` opens the floating softphone with an empty number (it will set `isOpen=true`). You may need to adjust `dial` in the context to handle empty string by just opening the popup without initiating a call.

- [ ] **Step 5: Verify in browser**

1. Open workspace — right sidebar shows softphone status panel
2. If agent has SIP extension + `callcenter/make_call` permission: shows "Softphone Ready" + green icon
3. Click "Open Dial Pad" — floating softphone popup appears with empty dial pad
4. If agent lacks permission: shows "Dial Not Available" in grey; no SIP.js is loaded
5. Simulate an inbound call (requires FreePBX WebRTC): softphone shows ringing UI → answer → TicketForm auto-opens with caller number

- [ ] **Step 6: Note — no layout changes needed**

`frontend/app/layout-client.tsx` already imports and renders `<SoftphoneProvider>` and `<Softphone />` at the app root (lines 6-8, 25, 29). No changes to layout files are required.

- [ ] **Step 7: Commit**

```bash
git add frontend/app/workspace/page.tsx
git commit -m "feat: wire workspace to softphone context, replace sidebar placeholder with status panel"
```

---

## Chunk 5: Final Smoke Test

### Task 6: End-to-end verification

- [ ] **Step 1: Verify backend endpoint**

GET `http://localhost:8000/workspace/sip-credentials` with agent bearer token.
- Agent with permission + extension → `200 { extension, password, wss_url, realm }`
- Agent without permission → `403`
- Admin → `200` (admins bypass all checks)

- [ ] **Step 2: Verify admin control**

1. Open `/admin/roles` → find an agent role → uncheck `callcenter → make_call` → save
2. Log in as that agent → workspace softphone panel shows "Dial Not Available"
3. Re-check `callcenter → make_call` → agent sees "Softphone Ready" after page reload

- [ ] **Step 3: Verify outbound call flow (requires FreePBX)**

1. Agent with registered softphone clicks "Open Dial Pad"
2. Types a number → clicks green call button
3. Softphone shows "Calling…" state
4. Remote phone rings
5. On answer: softphone shows "Active Call" + timer
6. Mute/Hold buttons work
7. Hang up → softphone returns to idle

- [ ] **Step 4: Verify inbound call flow (requires FreePBX)**

1. External caller dials agent's DID
2. Browser shows ringing UI with caller number
3. Agent clicks Answer → TicketForm opens in workspace with caller number pre-filled
4. (This is the same flow as today's simulated call — no TicketForm code changed)

- [ ] **Step 5: Final commit**

```bash
git add -A
git commit -m "feat: WebRTC softphone complete — SIP.js dial + inbound, admin-gated via callcenter permission"
```
