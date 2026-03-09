'use client'
import { Suspense, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import AdminNav from '@/components/AdminNav'
import { api } from '@/lib/api'

interface Location {
  id: number
  name: string
  ip_camera_url?: string
}

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

function CameraPlayer({ locationId, locationName }: { locationId: number; locationName: string }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const hlsRef = useRef<unknown>(null)
  const [status, setStatus] = useState<'idle' | 'starting' | 'live' | 'error'>('idle')
  const [errorMsg, setErrorMsg] = useState('')

  const startStream = async () => {
    setStatus('starting')
    setErrorMsg('')
    try {
      const res = await api.post(`/visitors/locations/${locationId}/stream/start`)
      const streamUrl = `${API_URL}${res.data.stream_url}`

      // Poll /stream/ready every 500ms instead of a hardcoded sleep.
      // Max 15 attempts = 7.5s timeout.
      const MAX_POLLS = 15
      const POLL_INTERVAL_MS = 500
      let ready = false

      for (let i = 0; i < MAX_POLLS; i++) {
        await new Promise(r => setTimeout(r, POLL_INTERVAL_MS))
        try {
          const readyRes = await api.get(`/visitors/locations/${locationId}/stream/ready`)
          if (readyRes.data.ready) {
            ready = true
            break
          }
        } catch {
          // ignore transient poll errors, keep trying
        }
      }

      if (!ready) {
        setStatus('error')
        setErrorMsg('Stream took too long to start. Check camera connection.')
        return
      }

      attachPlayer(streamUrl)
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: string } } }
      setStatus('error')
      setErrorMsg(err?.response?.data?.detail || 'Failed to start stream')
    }
  }

  const attachPlayer = (streamUrl: string) => {
    const video = videoRef.current
    if (!video) return

    if (video.canPlayType('application/vnd.apple.mpegurl')) {
      // Safari — native HLS
      video.src = streamUrl
      video.play().catch(() => {})
      setStatus('live')
    } else {
      // Chrome / Firefox — use hls.js
      import('hls.js').then(({ default: Hls }) => {
        if (Hls.isSupported()) {
          const hls = new Hls({ enableWorker: true, lowLatencyMode: true })
          hls.loadSource(streamUrl)
          hls.attachMedia(video)
          hls.on(Hls.Events.MANIFEST_PARSED, () => {
            video.play().catch(() => {})
            setStatus('live')
          })
          hls.on(Hls.Events.ERROR, (_evt: unknown, data: { fatal?: boolean }) => {
            if (data.fatal) {
              setStatus('error')
              setErrorMsg('Stream lost. Try restarting.')
            }
          })
          hlsRef.current = hls
        } else {
          setStatus('error')
          setErrorMsg('Your browser does not support HLS streaming.')
        }
      })
    }
  }

  const stopStream = async () => {
    // Destroy hls.js instance
    if (hlsRef.current) {
      const hls = hlsRef.current as { destroy: () => void }
      hls.destroy()
      hlsRef.current = null
    }
    if (videoRef.current) {
      videoRef.current.src = ''
    }
    try {
      await api.post(`/visitors/locations/${locationId}/stream/stop`)
    } catch { /* ignore */ }
    setStatus('idle')
  }

  // Resume if already streaming on mount
  useEffect(() => {
    api.get(`/visitors/locations/${locationId}/stream/status`).then(res => {
      if (res.data.running) {
        const streamUrl = `${API_URL}${res.data.stream_url}`
        attachPlayer(streamUrl)
      }
    }).catch(() => {})

    return () => {
      if (hlsRef.current) {
        const hls = hlsRef.current as { destroy: () => void }
        hls.destroy()
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locationId])

  return (
    <div className="bg-white rounded-xl border overflow-hidden shadow-sm">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b bg-gray-50">
        <div className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full ${status === 'live' ? 'bg-red-500 animate-pulse' : 'bg-gray-300'}`} />
          <span className="font-medium text-sm text-gray-800">{locationName}</span>
          {status === 'live' && (
            <span className="text-xs text-red-500 font-semibold tracking-wide">LIVE</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {status === 'idle' || status === 'error' ? (
            <button
              onClick={startStream}
              className="text-xs bg-red-600 text-white px-3 py-1 rounded-full hover:bg-red-700 font-medium">
              ▶ Start Stream
            </button>
          ) : status === 'starting' ? (
            <span className="text-xs text-gray-400 animate-pulse">Connecting…</span>
          ) : (
            <button
              onClick={stopStream}
              className="text-xs bg-gray-700 text-white px-3 py-1 rounded-full hover:bg-gray-800 font-medium">
              ■ Stop
            </button>
          )}
        </div>
      </div>

      {/* Video area */}
      <div className="relative bg-black aspect-video">
        <video
          ref={videoRef}
          className="w-full h-full object-contain"
          autoPlay
          muted
          playsInline
        />
        {status === 'idle' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-gray-500">
            <svg className="w-12 h-12 mb-2 opacity-40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M15 10l4.553-2.069A1 1 0 0121 8.87v6.26a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
            </svg>
            <p className="text-sm">Press <strong>Start Stream</strong> to view live feed</p>
          </div>
        )}
        {status === 'starting' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-gray-400">
            <div className="w-8 h-8 border-2 border-red-500 border-t-transparent rounded-full animate-spin mb-3" />
            <p className="text-sm">Connecting to camera…</p>
            <p className="text-xs mt-1 opacity-60">This may take a few seconds</p>
          </div>
        )}
        {status === 'error' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-red-400">
            <svg className="w-10 h-10 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <p className="text-sm font-medium">Stream Error</p>
            <p className="text-xs text-gray-400 mt-1 max-w-xs text-center">{errorMsg}</p>
          </div>
        )}
      </div>

      {/* Footer hint */}
      <div className="px-4 py-2 bg-gray-50 border-t text-xs text-gray-400">
        Streaming via RTSP → HLS (ffmpeg) &bull; Low latency mode
      </div>
    </div>
  )
}

function CamerasContent() {
  const searchParams = useSearchParams()
  const preselectedLocId = searchParams.get('loc') ? parseInt(searchParams.get('loc')!) : null

  const [locations, setLocations] = useState<Location[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedIds, setSelectedIds] = useState<number[]>([])

  useEffect(() => {
    api.get('/visitors/locations')
      .then(r => {
        const cams: Location[] = r.data.filter((l: Location) => !!l.ip_camera_url)
        setLocations(cams)
        if (preselectedLocId && cams.some(l => l.id === preselectedLocId)) {
          setSelectedIds([preselectedLocId])
        } else if (cams.length > 0) {
          setSelectedIds([cams[0].id])
        }
      })
      .finally(() => setLoading(false))
  }, [preselectedLocId])

  const toggleLocation = (id: number) => {
    setSelectedIds(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    )
  }

  const activeCameras = locations.filter(l => selectedIds.includes(l.id))

  return (
    <main className="ml-60 pt-14 p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Live Camera View</h1>
          <p className="text-sm text-gray-400 mt-0.5">Real-time CCTV feeds via RTSP stream</p>
        </div>
      </div>

      {loading ? (
        <p className="text-gray-400">Loading cameras…</p>
      ) : locations.length === 0 ? (
        <div className="bg-white rounded-xl border p-10 text-center">
          <svg className="w-12 h-12 mx-auto mb-3 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
              d="M15 10l4.553-2.069A1 1 0 0121 8.87v6.26a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
          </svg>
          <p className="text-gray-500 font-medium">No cameras configured</p>
          <p className="text-sm text-gray-400 mt-1">
            Add an RTSP URL to a location in{' '}
            <a href="/admin/visitors/locations" className="text-blue-600 hover:underline">Visitor Locations</a>.
          </p>
        </div>
      ) : (
        <div className="flex gap-6">
          {/* Sidebar: location selector */}
          {locations.length > 1 && (
            <div className="w-52 shrink-0">
              <p className="text-xs text-gray-500 uppercase tracking-wide font-medium mb-2">Cameras</p>
              <div className="space-y-1">
                {locations.map(loc => (
                  <button
                    key={loc.id}
                    onClick={() => toggleLocation(loc.id)}
                    className={`w-full text-left px-3 py-2 rounded-lg text-sm flex items-center gap-2 transition-colors ${
                      selectedIds.includes(loc.id)
                        ? 'bg-red-50 text-red-700 font-medium border border-red-200'
                        : 'text-gray-600 hover:bg-gray-100'
                    }`}>
                    <span className={`w-2 h-2 rounded-full shrink-0 ${
                      selectedIds.includes(loc.id) ? 'bg-red-500' : 'bg-gray-300'
                    }`} />
                    {loc.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Camera grid */}
          <div className={`flex-1 grid gap-4 ${
            activeCameras.length === 1
              ? 'grid-cols-1 max-w-3xl'
              : activeCameras.length === 2
              ? 'grid-cols-2'
              : 'grid-cols-2 xl:grid-cols-3'
          }`}>
            {activeCameras.map(loc => (
              <CameraPlayer key={loc.id} locationId={loc.id} locationName={loc.name} />
            ))}
            {activeCameras.length === 0 && (
              <p className="text-gray-400 text-sm col-span-full">
                Select a camera from the list to view its live feed.
              </p>
            )}
          </div>
        </div>
      )}
    </main>
  )
}

export default function CamerasPage() {
  return (
    <>
      <AdminNav />
      <Suspense fallback={<main className="ml-60 pt-14 p-6"><p className="text-gray-400">Loading…</p></main>}>
        <CamerasContent />
      </Suspense>
    </>
  )
}
