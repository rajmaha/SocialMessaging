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

  // ── Helpers ───────────────────────────────────────────────────────────────
  function resetCall() {
    setCallState('idle')
    setCallerNumber(null)
    setRemoteDisplayName(null)
    setIsMuted(false)
    setIsOnHold(false)
    sessionRef.current = null
    if (audioRef.current) { audioRef.current.srcObject = null as any }
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
