'use client'
import { useEffect, useRef, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import AdminNav from '@/components/AdminNav'
import { api } from '@/lib/api'

interface Agent { id: number; name: string; email: string }
interface Location { id: number; name: string }
interface CropRect { x: number; y: number; w: number; h: number }

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

  const [form, setForm] = useState({
    visitor_name: '', visitor_organization: '', visitor_contact_no: '',
    visitor_email: '', visitor_address: '', purpose: '',
    host_agent_id: '', location_id: '', num_visitors: '1',
  })

  useEffect(() => {
    api.get('/visitors/agents/list').then(r => setAgents(r.data))
    api.get('/visitors/locations').then(r => setLocations(r.data))
  }, [])

  const startCamera = async () => {
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: true })
      setStream(s)
      if (videoRef.current) videoRef.current.srcObject = s
    } catch { setError('Camera permission denied') }
  }

  const capturePhoto = () => {
    if (!videoRef.current || !canvasRef.current) return
    const vw = videoRef.current.videoWidth
    const vh = videoRef.current.videoHeight
    canvasRef.current.width = vw
    canvasRef.current.height = vh
    canvasRef.current.getContext('2d')!.drawImage(videoRef.current, 0, 0)
    const dataUrl = canvasRef.current.toDataURL('image/jpeg', 0.95)
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
    startCamera()
  }

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

        <form onSubmit={handleSubmit} className="space-y-5">
          {/* Visitor Details + Photo side by side */}
          <div className="grid grid-cols-2 gap-5 items-start">
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
            </div>

            {/* Webcam — right of Visitor Details */}
            <div className="bg-white rounded-xl border p-5 flex flex-col gap-3">
              <h2 className="font-semibold text-sm text-gray-700 uppercase tracking-wide">Visitor Photo</h2>

              {photoUrl ? (
                /* ── Final saved photo ── */
                <div className="flex flex-col items-center gap-3">
                  <img src={`${API_URL}${photoUrl}`} alt="Captured"
                    className="w-full max-h-52 object-cover rounded-lg border" />
                  <button type="button" onClick={retakePhoto}
                    className="text-sm text-red-500 hover:underline">Retake</button>
                </div>

              ) : capturedDataUrl ? (
                /* ── Crop step ── */
                <div className="flex flex-col gap-2">
                  <p className="text-xs text-gray-400">
                    Drag the box to reposition · drag corners to resize
                  </p>
                  {/* Crop container */}
                  <div ref={cropContainerRef} className="relative select-none rounded-lg overflow-hidden border">
                    <img
                      ref={cropImgRef}
                      src={capturedDataUrl}
                      alt="Preview"
                      className="w-full block"
                      draggable={false}
                    />
                    {dc && (
                      <>
                        {/* Dimmed mask — four regions around the crop box */}
                        <div className="absolute inset-0 pointer-events-none">
                          <div className="absolute bg-black/50"
                            style={{ top: 0, left: 0, right: 0, height: dc.top }} />
                          <div className="absolute bg-black/50"
                            style={{ top: dc.top + dc.height, left: 0, right: 0, bottom: 0 }} />
                          <div className="absolute bg-black/50"
                            style={{ top: dc.top, left: 0, width: dc.left, height: dc.height }} />
                          <div className="absolute bg-black/50"
                            style={{ top: dc.top, left: dc.left + dc.width, right: 0, height: dc.height }} />
                        </div>

                        {/* Crop box */}
                        <div
                          className="absolute border-2 border-white cursor-move"
                          style={{ left: dc.left, top: dc.top, width: dc.width, height: dc.height }}
                          onMouseDown={e => onDragStart(e, 'move')}
                        >
                          {/* Rule-of-thirds guide lines */}
                          <div className="absolute inset-0 pointer-events-none">
                            {[33.3, 66.6].map(pct => (
                              <div key={`h${pct}`} className="absolute left-0 right-0 border-t border-white/25"
                                style={{ top: `${pct}%` }} />
                            ))}
                            {[33.3, 66.6].map(pct => (
                              <div key={`v${pct}`} className="absolute top-0 bottom-0 border-l border-white/25"
                                style={{ left: `${pct}%` }} />
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
                      onClick={() => { setCapturedDataUrl(null); setImgNaturalSize(null); startCamera() }}
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
                /* ── Live camera feed ── */
                <div className="space-y-2">
                  <video ref={videoRef} autoPlay className="w-full rounded-lg border" />
                  <canvas ref={canvasRef} className="hidden" />
                  <button type="button" onClick={capturePhoto}
                    className="w-full bg-green-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-green-700">
                    Capture Photo
                  </button>
                </div>

              ) : (
                /* ── Open camera prompt ── */
                <button type="button" onClick={startCamera}
                  className="flex-1 border-2 border-dashed border-gray-300 rounded-lg px-6 py-8 text-sm text-gray-400 hover:border-blue-400 hover:text-blue-500 flex flex-col items-center justify-center gap-2">
                  <span className="text-3xl">📷</span>
                  <span>Open Camera</span>
                </button>
              )}
            </div>
          </div>

          <div className="bg-white rounded-xl border p-5 grid grid-cols-2 gap-4">
            <h2 className="col-span-2 font-semibold text-sm text-gray-700 uppercase tracking-wide">Visit Details</h2>
            <div>
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
            <div>
              <label className="block text-xs text-gray-500 mb-1">Location</label>
              <select className="w-full border rounded-lg px-3 py-2 text-sm"
                value={form.location_id}
                onChange={e => setForm(f => ({ ...f, location_id: e.target.value }))}>
                <option value="">— Select location —</option>
                {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
            </div>
          </div>

          <button type="submit" disabled={saving}
            className="w-full bg-blue-600 text-white py-3 rounded-xl font-medium hover:bg-blue-700 disabled:opacity-50">
            {saving ? 'Checking in…' : 'Check In Visitor'}
          </button>
        </form>
      </main>
    </>
  )
}
