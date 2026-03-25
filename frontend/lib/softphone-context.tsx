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
  transfer: (targetExtension: string) => Promise<boolean>
  startConference: (targetExtension: string) => Promise<boolean>
  close: () => void
  setDialNumber: (n: string | null) => void

  // Call timer
  callSeconds: number
  isMuted: boolean
  isOnHold: boolean

  // Registered identity
  myExtension: string | null

  // Increments on every call end (answered or missed) — lets workspace refresh call list
  callEndCounter: number

  // Re-open the popup (for resuming active call control)
  open: () => void
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
  transfer: async () => false,
  startConference: async () => false,
  close: () => {},
  setDialNumber: () => {},
  callSeconds: 0,
  isMuted: false,
  isOnHold: false,
  myExtension: null,
  callEndCounter: 0,
  open: () => {},
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
  const [myExtension, setMyExtension] = useState<string | null>(null)
  const [callEndCounter, setCallEndCounter] = useState(0)

  // SIP.js refs — stored as any to avoid type import issues at module load time
  // SIP.js is dynamically imported so it is not bundled until needed
  const uaRef = useRef<any>(null)
  const sessionRef = useRef<any>(null)
  const timerRef = useRef<NodeJS.Timeout | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  // Cache UserAgent constructor from dynamic import so dial() can use makeURI without require()
  const UserAgentClassRef = useRef<any>(null)
  // Ringtone refs (Web Audio API oscillator-based ring)
  const ringCtxRef = useRef<AudioContext | null>(null)
  const ringIntervalRef = useRef<NodeJS.Timeout | null>(null)

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

  // ── Ringtone helpers ─────────────────────────────────────────────────────
  // Extracted so answer/hangup can stop the ringtone immediately (synchronously)
  // without waiting for the useEffect cleanup which may race with scheduled oscillators.
  function stopRingtone() {
    if (ringIntervalRef.current) { clearInterval(ringIntervalRef.current); ringIntervalRef.current = null }
    if (ringCtxRef.current) { ringCtxRef.current.close().catch(() => {}); ringCtxRef.current = null }
  }

  // ── Ringtone (Web Audio API oscillator — US phone ring pattern) ──────────
  useEffect(() => {
    if (callState !== 'ringing_in') {
      stopRingtone()
      return
    }
    // Start ringtone: 2-second ring, 4-second cycle (ring 2s, silence 2s)
    const ctx = new AudioContext()
    ringCtxRef.current = ctx

    function playBurst() {
      if (ctx.state === 'closed') return
      // Two-tone oscillator (440Hz + 480Hz) = US ring cadence
      const osc1 = ctx.createOscillator()
      const osc2 = ctx.createOscillator()
      const gain = ctx.createGain()
      osc1.frequency.value = 440
      osc2.frequency.value = 480
      gain.gain.value = 0.15
      osc1.connect(gain)
      osc2.connect(gain)
      gain.connect(ctx.destination)
      const now = ctx.currentTime
      osc1.start(now)
      osc2.start(now)
      osc1.stop(now + 2)
      osc2.stop(now + 2)
    }

    playBurst() // immediate first ring
    ringIntervalRef.current = setInterval(playBurst, 4000)

    return () => stopRingtone()
  }, [callState])

  // ── Credential fetch + SIP.js bootstrap ─────────────────────────────────
  useEffect(() => {
    const token = getAuthToken()
    if (!token) { setStatus('unauthorized'); return }

    let destroyed = false
    // API_URL is '' (empty string) in production (same-origin rewrites) — do NOT use || fallback
    // because '' is falsy and would incorrectly resolve to localhost:8000 in production.
    const apiUrl = API_URL

    async function bootstrap() {
      try {
        const res = await fetch(`${apiUrl}/workspace/sip-credentials`, {
          headers: { Authorization: `Bearer ${token}` },
        })
        if (destroyed) return

        if (res.status === 403) { setStatus('unauthorized'); return }
        if (res.status === 404) { setStatus('no_extension'); return }
        if (!res.ok) { setStatus('error'); return }

        const creds = await res.json()
        setMyExtension(creds.extension || null)
        // Dynamically import SIP.js — only loaded for authorised agents
        const { UserAgent, Registerer, Inviter, SessionState } = await import('sip.js')
        if (destroyed) return
        // Cache UserAgent and SessionState so dial()/hangup() don't need re-import
        UserAgentClassRef.current = UserAgent
        SessionStateRef.current = SessionState

        const uri = UserAgent.makeURI(`sip:${creds.extension}@${creds.realm}`)
        if (!uri) { setStatus('error'); return }

        // Build ICE servers config from API response (STUN/TURN)
        const iceServers = creds.ice_servers && creds.ice_servers.length > 0
          ? creds.ice_servers
          : [
              { urls: 'stun:stun.l.google.com:19302' },
              { urls: 'stun:stun1.l.google.com:19302' },
            ]

        const ua = new UserAgent({
          uri,
          transportOptions: { server: creds.wss_url },
          authorizationUsername: creds.extension,
          authorizationPassword: creds.password,
          sessionDescriptionHandlerFactoryOptions: {
            peerConnectionConfiguration: {
              iceServers,
            },
            constraints: { audio: true, video: false },
          },
          delegate: {
            onInvite(session: any) {
              // Inbound call
              sessionRef.current = session

              // ── Extract caller extension from SIP headers ──
              // Grandstream UCM PBXes often put the device name (e.g. "UCM6204") in the
              // From header's user part. The real calling extension is usually in
              // P-Asserted-Identity, Remote-Party-ID, or Diversion headers.
              let remoteId = session.remoteIdentity?.uri?.user || 'Unknown'
              const rawName = session.remoteIdentity?.displayName || null

              // Try P-Asserted-Identity first, then Remote-Party-ID, then Diversion
              const pai = session.request?.getHeader?.('P-Asserted-Identity')
              const rpid = session.request?.getHeader?.('Remote-Party-ID')
              const diversion = session.request?.getHeader?.('Diversion')
              const fromHeader = session.request?.getHeader?.('From')
              const extractSipUser = (header: string | undefined) => {
                if (!header) return null
                const m = header.match(/sip:([^@>]+)@/)
                return m ? m[1] : null
              }
              const paiUser = extractSipUser(pai)
              const rpidUser = extractSipUser(rpid)
              const diversionUser = extractSipUser(diversion)

              // Pattern to detect PBX device names (not real caller extensions)
              const pbxNamePattern = /^(UCM|GXW|GRP|GXP|DP|WP|GS|FXS|FXO|HT|GDS|TRUNK)\d/i

              // If remoteId looks like a PBX device name, prefer PAI/RPID/Diversion extension
              const isPbxName = pbxNamePattern.test(remoteId)
              if (isPbxName) {
                // Try headers in priority order
                const resolved = paiUser || rpidUser || diversionUser
                if (resolved && !pbxNamePattern.test(resolved)) {
                  remoteId = resolved
                } else if (rawName && /^\d{3,}$/.test(rawName)) {
                  // Display name is a numeric extension — use it as caller ID
                  remoteId = rawName
                }
              }

              console.log('[Softphone] Incoming SIP identity:', JSON.stringify({
                uri_user: session.remoteIdentity?.uri?.user,
                displayName: rawName,
                resolvedCaller: remoteId,
                pai, rpid, diversion,
                fromHeader,
              }))

              // Ignore display names that are just the PBX/trunk system name or match the extension
              const displayName = rawName && rawName !== remoteId && !pbxNamePattern.test(rawName)
                ? rawName : null
              setCallerNumber(remoteId)
              setRemoteDisplayName(displayName)
              setCallState('ringing_in')
              setIsOpen(true)

              // Track whether the call was answered (for missed call logging)
              let wasAnswered = false

              session.stateChange.addListener((state: any) => {
                if (state === SessionState.Established) {
                  wasAnswered = true
                }
                if (state === SessionState.Terminated) {
                  // Log missed/rejected calls to backend
                  if (!wasAnswered) {
                    logMissedCall(remoteId)
                  }
                  resetCall()
                }
              })
            },
          },
        })

        uaRef.current = ua
        setStatus('registering')

        const registerer = new Registerer(ua)
        ;(ua as any)._registerer = registerer  // store before awaits so cleanup can unregister
        await ua.start()
        if (destroyed) { await ua.stop(); return }
        await registerer.register()
        if (destroyed) { await registerer.unregister(); await ua.stop(); return }
        setStatus('registered')

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

  // ── Log missed/rejected call to backend ──────────────────────────────────
  async function logMissedCall(phoneNumber: string) {
    try {
      const token = getAuthToken()
      await fetch(`${API_URL}/calls/log-missed`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ phone_number: phoneNumber }),
      })
    } catch (err) {
      console.error('[Softphone] Failed to log missed call', err)
    }
  }

  // ── Helpers ───────────────────────────────────────────────────────────────
  function resetCall() {
    setCallState('idle')
    setCallerNumber(null)
    setRemoteDisplayName(null)
    setIsMuted(false)
    setIsOnHold(false)
    sessionRef.current = null
    if (audioRef.current) { audioRef.current.srcObject = null as any }
    setCallEndCounter(c => c + 1)
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
    audioRef.current.srcObject = remoteStream as any
  }

  // ── Public actions ────────────────────────────────────────────────────────
  const dial = useCallback(async (number: string) => {
    if (!number) { setIsOpen(true); return }
    if (callState !== 'idle') return
    try {
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
    } catch (err) {
      console.error('[Softphone] dial error', err)
      resetCall()
    }
  }, [status, callState])

  const answer = useCallback(async () => {
    const session = sessionRef.current
    if (!session) return
    // Stop ringtone immediately on click — don't wait for state change
    stopRingtone()
    try {
      await session.accept()
      attachAudio(session)
      setCallState('active')
    } catch (err) {
      console.error('[Softphone] answer error', err)
      // If accept fails, try to clean up
      resetCall()
    }
    // Trigger workspace TicketForm — callerNumber is already set from onInvite
  }, [])

  // Cache SessionState from SIP.js so hangup doesn't need a dynamic import each time
  const SessionStateRef = useRef<any>(null)

  const hangup = useCallback(async () => {
    const session = sessionRef.current
    // Stop ringtone immediately on click
    stopRingtone()
    if (!session) { resetCall(); setIsOpen(false); return }
    let terminated = false
    try {
      // Use cached SessionState, or import if not yet cached
      let SS = SessionStateRef.current
      if (!SS) {
        const sip = await import('sip.js')
        SS = sip.SessionState
        SessionStateRef.current = SS
      }
      if (session.state === SS.Established) {
        session.bye()
      } else if (session.state === SS.Initial || session.state === SS.Establishing) {
        // SIP.js Invitation (incoming) uses .reject(), Inviter (outgoing) uses .cancel()
        // Try both with individual error handling — some SIP.js versions differ
        let rejected = false
        if (typeof session.reject === 'function') {
          try { await session.reject(); rejected = true } catch (e) {
            console.warn('[Softphone] session.reject() failed, trying alternatives', e)
          }
        }
        if (!rejected && typeof session.cancel === 'function') {
          try { await session.cancel(); rejected = true } catch (e) {
            console.warn('[Softphone] session.cancel() failed', e)
          }
        }
        // If neither worked, force dispose
        if (!rejected) {
          try { if (typeof session.dispose === 'function') session.dispose() } catch {}
          terminated = true
        }
      } else if (session.state === SS.Terminated) {
        terminated = true
      }
    } catch (err) {
      console.error('[Softphone] hangup error', err)
      terminated = true
    }
    // If session is already terminated or we couldn't cleanly end it, reset immediately
    if (terminated) {
      resetCall()
    } else {
      // Force-reset after a short delay if stateChange listener doesn't fire
      setTimeout(() => {
        if (sessionRef.current === session) {
          console.warn('[Softphone] Force-resetting call after hangup timeout')
          resetCall()
        }
      }, 2000)
    }
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
    try {
      if (newHold) await session.invite({ sessionDescriptionHandlerOptions: { hold: true } })
      else await session.invite({ sessionDescriptionHandlerOptions: { hold: false } })
      setIsOnHold(newHold)
      setCallState(newHold ? 'on_hold' : 'active')
    } catch (err) {
      console.error('[Softphone] hold toggle error', err)
      // Do not update state — SIP hold failed, keep current state
    }
  }, [isOnHold])

  // ── Blind transfer (SIP REFER via session.refer()) ───────────────────────
  const transfer = useCallback(async (targetExtension: string): Promise<boolean> => {
    const session = sessionRef.current
    const ua = uaRef.current
    if (!session || !ua) return false
    try {
      const UA = UserAgentClassRef.current
      if (!UA) return false
      const targetUri = UA.makeURI(`sip:${targetExtension}@${ua.configuration.uri.host}`)
      if (!targetUri) return false
      // SIP.js v0.21: session.refer(targetURI) sends a REFER for blind transfer
      await session.refer(targetUri)
      resetCall()
      return true
    } catch (err) {
      console.error('[Softphone] transfer error', err)
      return false
    }
  }, [])

  // ── Conference call (AMI-based — adds another party via backend) ────────
  const startConference = useCallback(async (targetExtension: string): Promise<boolean> => {
    if (!myExtension) return false
    try {
      const token = getAuthToken()
      const res = await fetch(`${API_URL}/calls/conference`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          current_extension: myExtension,
          target_extension: targetExtension,
        }),
      })
      return res.ok
    } catch (err) {
      console.error('[Softphone] conference error', err)
      return false
    }
  }, [myExtension])

  const close = useCallback(() => {
    setIsOpen(false)
    setDialNumber(null)
  }, [])

  const open = useCallback(() => {
    setIsOpen(true)
  }, [])

  return (
    <SoftphoneContext.Provider value={{
      status, callState, callerNumber, remoteDisplayName,
      isOpen, dialNumber,
      dial, answer, hangup, toggleMute, toggleHold, transfer, startConference,
      close, open, setDialNumber,
      callSeconds, isMuted, isOnHold, myExtension, callEndCounter,
    }}>
      {children}
    </SoftphoneContext.Provider>
  )
}

export function useSoftphone() {
  return useContext(SoftphoneContext)
}
