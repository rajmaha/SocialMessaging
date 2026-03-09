'use client'
import { useEffect, useRef, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import AdminNav from '@/components/AdminNav'
import { api } from '@/lib/api'

interface Agent { id: number; name: string; email: string }
interface Location { id: number; name: string; ip_camera_url?: string }
interface CropRect { x: number; y: number; w: number; h: number }
interface PassCard { id: number; card_no: string }

export default function NewVisitPage() {
  const router = useRouter()
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const cropImgRef = useRef<HTMLImageElement>(null)
  const cropContainerRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{ handle: string; sx: number; sy: number; oc: CropRect } | null>(null)

  const [agents, setAgents] = useState<Agent[]>([])
  const [locations, setLocations] = useState<Location[]>([])
  const [stream, setStream] = useState<MediaStream | null>(null)
  const [capturedDataUrl, setCapturedDataUrl] = useState<string | null>(null)
  const [crop, setCrop] = useState<CropRect>({ x: 0, y: 0, w: 0, h: 0 })
  const [imgNaturalSize, setImgNaturalSize] = useState<{ w: number; h: number } | null>(null)
  const [photoUrl, setPhotoUrl] = useState<string | null>(null)
  const [photoPath, setPhotoPath] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [videoReady, setVideoReady] = useState(false)
  const [capturingCctv, setCapturingCctv] = useState(false)
  const [, forceUpdate] = useState(0) // triggers re-render after crop image mounts

  // CCTV live feed
  const cctvVideoRef = useRef<HTMLVideoElement>(null)
  const cctvHlsRef = useRef<unknown>(null)
  const [cctvStatus, setCctvStatus] = useState<'idle' | 'starting' | 'live' | 'error'>('idle')

  const [form, setForm] = useState({
    visitor_name: '', visitor_organization: '', visitor_contact_no: '',
    visitor_email: '', visitor_address: '', purpose: '',
    host_agent_id: '', location_id: '', num_visitors: '1',
  })
  const [availableCards, setAvailableCards] = useState<PassCard[]>([])
  const [passCardId, setPassCardId] = useState<string>('')
  type PhotoSource = 'cctv' | 'webcam' | null
  const [photoSource, setPhotoSource] = useState<PhotoSource>(null)

  useEffect(() => {
    api.get('/visitors/agents/list').then(r => setAgents(r.data))
    api.get('/visitors/locations').then(r => setLocations(r.data))
  }, [])

  useEffect(() => {
    setPassCardId('')
    setAvailableCards([])
    if (!form.location_id) return
    api.get(`/visitors/pass-cards/available?location_id=${form.location_id}`)
      .then(r => setAvailableCards(r.data))
      .catch(() => { console.warn('Failed to load available pass cards') })
  }, [form.location_id])

  const startCamera = async () => {
    setVideoReady(false)
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } })
      setStream(s)
      // NOTE: do NOT try to set srcObject here — videoRef.current is null because the
      // <video> element only mounts after the setStream() re-render.
      // The useEffect below handles srcObject once the element is in the DOM.
    } catch { setError('Camera permission denied') }
  }

  // Set srcObject on the webcam video element once it mounts (after stream state update)
  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream
    }
  }, [stream])

  const capturePhoto = () => {
    if (!videoRef.current || !canvasRef.current) return
    const vw = videoRef.current.videoWidth
    const vh = videoRef.current.videoHeight
    // Guard: video not ready yet (happens when srcObject hasn't emitted a frame)
    if (!vw || !vh) {
      setError('Camera not ready — please wait a moment and try again')
      return
    }
    canvasRef.current.width = vw
    canvasRef.current.height = vh
    canvasRef.current.getContext('2d')!.drawImage(videoRef.current, 0, 0)
    const dataUrl = canvasRef.current.toDataURL('image/jpeg', 0.95)
    if (!dataUrl || dataUrl === 'data:,') {
      setError('Failed to capture — please try again')
      return
    }
    // Default crop: centred square at 85% of shorter side
    const size = Math.round(Math.min(vw, vh) * 0.85)
    setCrop({ x: Math.round((vw - size) / 2), y: Math.round((vh - size) / 2), w: size, h: size })
    setImgNaturalSize({ w: vw, h: vh })
    setCapturedDataUrl(dataUrl)
    stream?.getTracks().forEach(t => t.stop())
    setStream(null)
  }

  // Convert natural-pixel crop coords → display px for the overlay
  const getDisplayCrop = (): { left: number; top: number; width: number; height: number } | null => {
    const img = cropImgRef.current
    const container = cropContainerRef.current
    if (!img || !container || !imgNaturalSize) return null
    const displayW = container.clientWidth
    const displayH = displayW * imgNaturalSize.h / imgNaturalSize.w
    const sx = displayW / imgNaturalSize.w
    const sy = displayH / imgNaturalSize.h
    return { left: crop.x * sx, top: crop.y * sy, width: crop.w * sx, height: crop.h * sy }
  }

  const onDragStart = (e: React.MouseEvent, handle: string) => {
    e.preventDefault()
    dragRef.current = { handle, sx: e.clientX, sy: e.clientY, oc: { ...crop } }
  }

  const onDragMove = useCallback((e: MouseEvent) => {
    const d = dragRef.current
    const container = cropContainerRef.current
    if (!d || !container || !imgNaturalSize) return
    const displayW = container.clientWidth
    const displayH = displayW * imgNaturalSize.h / imgNaturalSize.w
    const scaleX = imgNaturalSize.w / displayW
    const scaleY = imgNaturalSize.h / displayH
    const dx = (e.clientX - d.sx) * scaleX
    const dy = (e.clientY - d.sy) * scaleY
    const MIN = 60
    let { x, y, w, h } = d.oc
    const nw = imgNaturalSize.w, nh = imgNaturalSize.h
    if (d.handle === 'move') {
      x = Math.max(0, Math.min(x + dx, nw - w))
      y = Math.max(0, Math.min(y + dy, nh - h))
    } else if (d.handle === 'se') {
      w = Math.max(MIN, Math.min(w + dx, nw - x))
      h = Math.max(MIN, Math.min(h + dy, nh - y))
    } else if (d.handle === 'nw') {
      const nx = Math.max(0, Math.min(x + dx, x + w - MIN))
      const ny = Math.max(0, Math.min(y + dy, y + h - MIN))
      w = x + w - nx; h = y + h - ny; x = nx; y = ny
    } else if (d.handle === 'ne') {
      const ny = Math.max(0, Math.min(y + dy, y + h - MIN))
      w = Math.max(MIN, Math.min(w + dx, nw - x))
      h = y + h - ny; y = ny
    } else if (d.handle === 'sw') {
      const nx = Math.max(0, Math.min(x + dx, x + w - MIN))
      w = x + w - nx; x = nx
      h = Math.max(MIN, Math.min(h + dy, nh - y))
    }
    setCrop({ x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) })
  }, [imgNaturalSize])

  const onDragEnd = useCallback(() => { dragRef.current = null }, [])

  useEffect(() => {
    window.addEventListener('mousemove', onDragMove)
    window.addEventListener('mouseup', onDragEnd)
    return () => {
      window.removeEventListener('mousemove', onDragMove)
      window.removeEventListener('mouseup', onDragEnd)
    }
  }, [onDragMove, onDragEnd])

  const applyCrop = async () => {
    if (!capturedDataUrl || !canvasRef.current) return
    setUploading(true)
    const img = new Image()
    img.onload = () => {
      canvasRef.current!.width = crop.w
      canvasRef.current!.height = crop.h
      canvasRef.current!.getContext('2d')!.drawImage(img, crop.x, crop.y, crop.w, crop.h, 0, 0, crop.w, crop.h)
      canvasRef.current!.toBlob(async blob => {
        if (!blob) { setUploading(false); return }
        const fd = new FormData()
        fd.append('file', blob, 'visitor.jpg')
        try {
          const res = await api.post('/visitors/upload-photo', fd, { headers: { 'Content-Type': 'multipart/form-data' } })
          setPhotoPath(res.data.path)
          setPhotoUrl(res.data.url)
          setCapturedDataUrl(null)
          setImgNaturalSize(null)
        } catch { setError('Failed to upload photo') }
        finally { setUploading(false) }
      }, 'image/jpeg', 0.92)
    }
    img.src = capturedDataUrl
  }

  const retakePhoto = () => {
    setCapturedDataUrl(null)
    setPhotoUrl(null)
    setPhotoPath(null)
    setImgNaturalSize(null)
    setVideoReady(false)
    const loc = locations.find(l => l.id === parseInt(form.location_id))
    if (loc?.ip_camera_url) {
      // Reset to source selection — let agent choose again
      stopCctvPlayer()
      stream?.getTracks().forEach(t => t.stop())
      setStream(null)
      setPhotoSource(null)
    } else {
      startCamera()
    }
  }

  const captureFromCctv = async (locId: number) => {
    setCapturingCctv(true)
    setError(null)
    try {
      const res = await api.get(`/visitors/locations/${locId}/snapshot`, { responseType: 'blob' })
      const blob: Blob = res.data
      const reader = new FileReader()
      reader.onload = () => {
        const dataUrl = reader.result as string
        const img = new Image()
        img.onload = () => {
          const w = img.naturalWidth || 640
          const h = img.naturalHeight || 480
          const size = Math.round(Math.min(w, h) * 0.85)
          setCrop({ x: Math.round((w - size) / 2), y: Math.round((h - size) / 2), w: size, h: size })
          setImgNaturalSize({ w, h })
          setCapturedDataUrl(dataUrl)
          setCapturingCctv(false)
        }
        img.onerror = () => {
          setError('Failed to load CCTV snapshot')
          setCapturingCctv(false)
        }
        img.src = dataUrl
      }
      reader.onerror = () => {
        setError('Failed to read CCTV snapshot')
        setCapturingCctv(false)
      }
      reader.readAsDataURL(blob)
    } catch {
      setError('Failed to capture from CCTV — try again')
      setCapturingCctv(false)
    }
  }

  // Stop CCTV HLS player
  const stopCctvPlayer = useCallback(() => {
    if (cctvHlsRef.current) {
      const hls = cctvHlsRef.current as { destroy: () => void }
      hls.destroy()
      cctvHlsRef.current = null
    }
    if (cctvVideoRef.current) cctvVideoRef.current.src = ''
    setCctvStatus('idle')
  }, [])

  // Start the chosen photo source; stops the other one first
  const selectPhotoSource = (source: 'cctv' | 'webcam') => {
    setPhotoSource(source)
    if (source === 'cctv') {
      stream?.getTracks().forEach(t => t.stop())
      setStream(null)
      startCctvStream(parseInt(form.location_id))
    } else {
      stopCctvPlayer()
      startCamera()
    }
  }

  // Start CCTV stream for the selected location
  const startCctvStream = useCallback(async (locId: number) => {
    setCctvStatus('starting')
    try {
      const res = await api.post(`/visitors/locations/${locId}/stream/start`)
      const streamUrl = `${API_URL}${res.data.stream_url}`
      // Give ffmpeg a moment to write the first segments
      await new Promise(r => setTimeout(r, 3000))
      const video = cctvVideoRef.current
      if (!video) { setCctvStatus('error'); return }
      if (video.canPlayType('application/vnd.apple.mpegurl')) {
        video.src = streamUrl
        video.play().catch(() => {})
        setCctvStatus('live')
      } else {
        import('hls.js').then(({ default: Hls }) => {
          if (Hls.isSupported()) {
            const hls = new Hls({ enableWorker: true, lowLatencyMode: true })
            hls.loadSource(streamUrl)
            hls.attachMedia(video)
            hls.on(Hls.Events.MANIFEST_PARSED, () => {
              video.play().catch(() => {})
              setCctvStatus('live')
            })
            hls.on(Hls.Events.ERROR, (_e: unknown, data: { fatal?: boolean }) => {
              if (data.fatal) setCctvStatus('error')
            })
            cctvHlsRef.current = hls
          } else {
            setCctvStatus('error')
          }
        })
      }
    } catch {
      setCctvStatus('error')
    }
  }, [])

  // When location changes: stop everything, reset photo source selection
  useEffect(() => {
    stopCctvPlayer()
    setStream(prev => { prev?.getTracks().forEach(t => t.stop()); return null })
    setPhotoSource(null)
    setCapturedDataUrl(null)
    setPhotoUrl(null)
    setPhotoPath(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.location_id])

  // Clean up HLS on unmount
  useEffect(() => {
    return () => { stopCctvPlayer() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setError(null)
    try {
      await api.post('/visitors/', {
        ...form,
        num_visitors: parseInt(form.num_visitors),
        host_agent_id: form.host_agent_id ? parseInt(form.host_agent_id) : null,
        location_id: form.location_id ? parseInt(form.location_id) : null,
        visitor_photo_path: photoPath,
        pass_card_id: passCardId ? parseInt(passCardId) : null,
      })
      router.push('/admin/visitors')
    } catch (e: any) {
      setError(e?.response?.data?.detail || 'Failed to check in visitor')
    } finally {
      setSaving(false)
    }
  }

  const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'
  const dc = getDisplayCrop()
  const hasCctv = !!(form.location_id && locations.find(l => l.id === parseInt(form.location_id))?.ip_camera_url)

  return (
    <>
      <AdminNav />
      <main className="ml-60 pt-14 p-6 max-w-5xl">
        <div className="mb-6">
          <button onClick={() => router.back()} className="text-sm text-gray-400 hover:text-gray-600 mb-1">
            ← Back
          </button>
          <h1 className="text-2xl font-bold">Check In Visitor</h1>
        </div>

        {error && <div className="mb-4 p-3 bg-red-50 text-red-600 rounded-lg text-sm">{error}</div>}

        {/* Main layout: left col = Visitor Details, right col = Photo + Visit Details */}
        <form onSubmit={handleSubmit} className="grid grid-cols-2 gap-5 items-start">

          {/* ── LEFT: Visitor Details ── */}
          <div className="bg-white rounded-xl border p-5 grid grid-cols-2 gap-4">
            <h2 className="col-span-2 font-semibold text-sm text-gray-700 uppercase tracking-wide">Visitor Details</h2>
            {([
              ['visitor_name', 'Full Name *', 'text', true],
              ['visitor_organization', 'Organisation', 'text', false],
              ['visitor_contact_no', 'Phone', 'tel', false],
              ['visitor_email', 'Email', 'email', false],
            ] as [string, string, string, boolean][]).map(([key, label, type, required]) => (
              <div key={key}>
                <label className="block text-xs text-gray-500 mb-1">{label}</label>
                <input
                  type={type}
                  required={required}
                  className="w-full border rounded-lg px-3 py-2 text-sm"
                  value={(form as any)[key]}
                  onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
                />
              </div>
            ))}
            <div className="col-span-2">
              <label className="block text-xs text-gray-500 mb-1">Address</label>
              <textarea
                className="w-full border rounded-lg px-3 py-2 text-sm"
                rows={2}
                value={form.visitor_address}
                onChange={e => setForm(f => ({ ...f, visitor_address: e.target.value }))}
              />
            </div>

            {/* ── Visit Details (moved here, below visitor fields) ── */}
            <div className="col-span-2 border-t pt-4 mt-1">
              <h2 className="font-semibold text-sm text-gray-700 uppercase tracking-wide mb-3">Visit Details</h2>
              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2">
                  <label className="block text-xs text-gray-500 mb-1">Purpose *</label>
                  <input required className="w-full border rounded-lg px-3 py-2 text-sm"
                    value={form.purpose}
                    onChange={e => setForm(f => ({ ...f, purpose: e.target.value }))} />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">No. of Visitors</label>
                  <input type="number" min={1} className="w-full border rounded-lg px-3 py-2 text-sm"
                    value={form.num_visitors}
                    onChange={e => setForm(f => ({ ...f, num_visitors: e.target.value }))} />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Host Agent</label>
                  <select className="w-full border rounded-lg px-3 py-2 text-sm"
                    value={form.host_agent_id}
                    onChange={e => setForm(f => ({ ...f, host_agent_id: e.target.value }))}>
                    <option value="">— Select host —</option>
                    {agents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                  </select>
                </div>
                <div className="col-span-2">
                  <label className="block text-xs text-gray-500 mb-1">Location</label>
                  <select className="w-full border rounded-lg px-3 py-2 text-sm"
                    value={form.location_id}
                    onChange={e => setForm(f => ({ ...f, location_id: e.target.value }))}>
                    <option value="">— Select location —</option>
                    {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
                  </select>
                </div>
                {availableCards.length > 0 && (
                  <div className="col-span-2">
                    <label className="block text-xs text-gray-500 mb-1">Pass Card</label>
                    <select
                      className="w-full border rounded-lg px-3 py-2 text-sm"
                      value={passCardId}
                      onChange={e => setPassCardId(e.target.value)}>
                      <option value="">— No card —</option>
                      {availableCards.map(c => (
                        <option key={c.id} value={c.id}>Card #{c.card_no}</option>
                      ))}
                    </select>
                  </div>
                )}
              </div>
            </div>

            {/* Submit button inside left col, full width */}
            <div className="col-span-2 pt-1">
              <button type="submit" disabled={saving}
                className="w-full bg-blue-600 text-white py-3 rounded-xl font-medium hover:bg-blue-700 disabled:opacity-50">
                {saving ? 'Checking in…' : 'Check In Visitor'}
              </button>
            </div>
          </div>

          {/* ── RIGHT: Visitor Photo + CCTV ── */}
          <div className="bg-white rounded-xl border p-5 flex flex-col gap-3">
            <h2 className="font-semibold text-sm text-gray-700 uppercase tracking-wide">Visitor Photo</h2>

            {/* Photo source toggle — only when location has CCTV and no photo in progress */}
            {hasCctv && !photoUrl && !capturedDataUrl && !stream && photoSource === null && (
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => selectPhotoSource('webcam')}
                  className={`flex-1 py-2 text-sm rounded-lg border font-medium transition-colors ${
                    photoSource === 'webcam'
                      ? 'bg-blue-600 text-white border-blue-600'
                      : 'text-gray-600 border-gray-200 hover:border-blue-400 hover:text-blue-600'
                  }`}>
                  📷 Webcam
                </button>
                <button
                  type="button"
                  onClick={() => selectPhotoSource('cctv')}
                  className={`flex-1 py-2 text-sm rounded-lg border font-medium transition-colors ${
                    photoSource === 'cctv'
                      ? 'bg-blue-600 text-white border-blue-600'
                      : 'text-gray-600 border-gray-200 hover:border-blue-400 hover:text-blue-600'
                  }`}>
                  📹 CCTV
                </button>
              </div>
            )}

            {/* CCTV Live Feed */}
            {photoSource === 'cctv' && (
              <>
                <div className="rounded-xl border overflow-hidden">
                  <div className="flex items-center justify-between px-3 py-2 border-b bg-gray-50">
                    <div className="flex items-center gap-2">
                      <span className={`w-2 h-2 rounded-full ${cctvStatus === 'live' ? 'bg-red-500 animate-pulse' : 'bg-gray-300'}`} />
                      <span className="text-xs font-medium text-gray-700">
                        CCTV — {locations.find(l => l.id === parseInt(form.location_id))?.name}
                      </span>
                      {cctvStatus === 'live' && (
                        <span className="text-xs text-red-500 font-semibold tracking-wide">LIVE</span>
                      )}
                    </div>
                    {cctvStatus === 'error' && (
                      <button type="button"
                        onClick={() => startCctvStream(parseInt(form.location_id))}
                        className="text-xs text-blue-600 hover:underline">
                        Retry
                      </button>
                    )}
                  </div>
                  <div className="relative bg-black" style={{ aspectRatio: '16/9' }}>
                    <video ref={cctvVideoRef} className="w-full h-full object-contain" autoPlay muted playsInline />
                    {cctvStatus === 'starting' && (
                      <div className="absolute inset-0 flex flex-col items-center justify-center text-gray-400">
                        <div className="w-6 h-6 border-2 border-red-500 border-t-transparent rounded-full animate-spin mb-2" />
                        <p className="text-xs">Connecting to camera…</p>
                      </div>
                    )}
                    {cctvStatus === 'error' && (
                      <div className="absolute inset-0 flex flex-col items-center justify-center text-red-400 p-4">
                        <svg className="w-6 h-6 mb-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                            d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        <p className="text-xs text-center">Could not connect to camera</p>
                      </div>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <div className="flex-1 border-t border-gray-200" />
                  <span className="text-xs text-gray-400 whitespace-nowrap">Capture Visitor Photo</span>
                  <div className="flex-1 border-t border-gray-200" />
                </div>
              </>
            )}

            {photoUrl ? (
              /* ── Final saved photo ── */
              <div className="flex flex-col items-center gap-3">
                <img src={`${API_URL}${photoUrl}`} alt="Captured"
                  className="w-full max-h-64 object-cover rounded-lg border" />
                <button type="button" onClick={retakePhoto}
                  className="text-sm text-red-500 hover:underline">Retake</button>
              </div>

            ) : capturedDataUrl ? (
              /* ── Crop step ── */
              <div className="flex flex-col gap-2">
                <p className="text-xs text-gray-400">Drag the box to reposition · drag corners to resize</p>
                <div ref={cropContainerRef} className="relative select-none rounded-lg overflow-hidden border">
                  <img
                    ref={cropImgRef}
                    src={capturedDataUrl}
                    alt="Preview"
                    className="w-full block"
                    draggable={false}
                    onLoad={() => forceUpdate(n => n + 1)}
                  />
                  {dc && (
                    <>
                      {/* Dimmed mask */}
                      <div className="absolute inset-0 pointer-events-none">
                        <div className="absolute bg-black/50" style={{ top: 0, left: 0, right: 0, height: dc.top }} />
                        <div className="absolute bg-black/50" style={{ top: dc.top + dc.height, left: 0, right: 0, bottom: 0 }} />
                        <div className="absolute bg-black/50" style={{ top: dc.top, left: 0, width: dc.left, height: dc.height }} />
                        <div className="absolute bg-black/50" style={{ top: dc.top, left: dc.left + dc.width, right: 0, height: dc.height }} />
                      </div>
                      {/* Crop box */}
                      <div
                        className="absolute border-2 border-white cursor-move"
                        style={{ left: dc.left, top: dc.top, width: dc.width, height: dc.height }}
                        onMouseDown={e => onDragStart(e, 'move')}
                      >
                        {/* Rule-of-thirds lines */}
                        <div className="absolute inset-0 pointer-events-none">
                          {[33.3, 66.6].map(pct => (
                            <div key={`h${pct}`} className="absolute left-0 right-0 border-t border-white/25" style={{ top: `${pct}%` }} />
                          ))}
                          {[33.3, 66.6].map(pct => (
                            <div key={`v${pct}`} className="absolute top-0 bottom-0 border-l border-white/25" style={{ left: `${pct}%` }} />
                          ))}
                        </div>
                        {/* Corner handles */}
                        {(['nw', 'ne', 'sw', 'se'] as const).map(handle => (
                          <div
                            key={handle}
                            className="absolute w-4 h-4 bg-white border-2 border-blue-500 rounded-sm z-10"
                            style={{
                              ...(handle.includes('n') ? { top: -6 } : { bottom: -6 }),
                              ...(handle.includes('w') ? { left: -6 } : { right: -6 }),
                              cursor: (handle === 'nw' || handle === 'se') ? 'nwse-resize' : 'nesw-resize',
                            }}
                            onMouseDown={e => { e.stopPropagation(); onDragStart(e, handle) }}
                          />
                        ))}
                      </div>
                    </>
                  )}
                </div>
                <canvas ref={canvasRef} className="hidden" />
                <div className="flex gap-2 pt-1">
                  <button type="button"
                    onClick={retakePhoto}
                    className="flex-1 border border-gray-300 text-gray-600 px-4 py-2 rounded-lg text-sm hover:bg-gray-50">
                    Retake
                  </button>
                  <button type="button" onClick={applyCrop} disabled={uploading}
                    className="flex-1 bg-blue-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-blue-700 disabled:opacity-50">
                    {uploading ? 'Saving…' : 'Use Photo ✓'}
                  </button>
                </div>
              </div>

            ) : stream ? (
              /* ── Live webcam feed ── */
              <div className="space-y-2">
                <div className="relative">
                  <video ref={videoRef} autoPlay playsInline muted
                    className="w-full rounded-lg border"
                    onCanPlay={() => setVideoReady(true)} />
                  {!videoReady && (
                    <div className="absolute inset-0 flex items-center justify-center bg-black/60 rounded-lg">
                      <div className="flex flex-col items-center gap-2 text-white">
                        <div className="w-6 h-6 border-2 border-white border-t-transparent rounded-full animate-spin" />
                        <span className="text-xs">Starting camera…</span>
                      </div>
                    </div>
                  )}
                </div>
                <canvas ref={canvasRef} className="hidden" />
                <button type="button" onClick={capturePhoto} disabled={!videoReady}
                  className="w-full bg-green-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-green-700 disabled:opacity-50 disabled:cursor-wait">
                  {videoReady ? 'Capture Photo' : 'Waiting for camera…'}
                </button>
              </div>

            ) : hasCctv && photoSource === 'cctv' ? (
              /* ── CCTV capture prompt ── */
              <button type="button"
                onClick={() => captureFromCctv(parseInt(form.location_id))}
                disabled={capturingCctv || cctvStatus === 'starting'}
                className="w-full bg-green-600 text-white px-4 py-3 rounded-lg text-sm font-medium hover:bg-green-700 disabled:opacity-50 flex items-center justify-center gap-2">
                {capturingCctv ? (
                  <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />Capturing from CCTV…</>
                ) : cctvStatus === 'starting' ? (
                  <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />Waiting for camera feed…</>
                ) : '📸 Capture Photo from CCTV'}
              </button>

            ) : !hasCctv ? (
              /* ── No CCTV: open webcam prompt ── */
              <button type="button" onClick={startCamera}
                className="flex-1 border-2 border-dashed border-gray-300 rounded-lg px-6 py-8 text-sm text-gray-400 hover:border-blue-400 hover:text-blue-500 flex flex-col items-center justify-center gap-2">
                <span className="text-3xl">📷</span>
                <span>Open Camera</span>
              </button>
            ) : null}
          </div>

        </form>
      </main>
    </>
  )
}
