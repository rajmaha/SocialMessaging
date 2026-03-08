'use client'
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import AdminNav from '@/components/AdminNav'
import { api } from '@/lib/api'

interface Agent { id: number; name: string; email: string }
interface Location { id: number; name: string }

export default function NewVisitPage() {
  const router = useRouter()
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)

  const [agents, setAgents] = useState<Agent[]>([])
  const [locations, setLocations] = useState<Location[]>([])
  const [stream, setStream] = useState<MediaStream | null>(null)
  const [photoUrl, setPhotoUrl] = useState<string | null>(null)
  const [photoPath, setPhotoPath] = useState<string | null>(null)
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

  const capturePhoto = async () => {
    if (!videoRef.current || !canvasRef.current) return
    const ctx = canvasRef.current.getContext('2d')!
    canvasRef.current.width = videoRef.current.videoWidth
    canvasRef.current.height = videoRef.current.videoHeight
    ctx.drawImage(videoRef.current, 0, 0)
    canvasRef.current.toBlob(async blob => {
      if (!blob) return
      const fd = new FormData()
      fd.append('file', blob, 'visitor.jpg')
      const res = await api.post('/visitors/upload-photo', fd, {
        headers: { 'Content-Type': 'multipart/form-data' }
      })
      setPhotoPath(res.data.path)
      setPhotoUrl(res.data.url)
      stream?.getTracks().forEach(t => t.stop())
      setStream(null)
    }, 'image/jpeg')
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

  return (
    <>
      <AdminNav />
      <main className="ml-60 pt-14 p-6 max-w-3xl">
        <div className="mb-6">
          <button onClick={() => router.back()} className="text-sm text-gray-400 hover:text-gray-600 mb-1">
            ← Back
          </button>
          <h1 className="text-2xl font-bold">Check In Visitor</h1>
        </div>

        {error && <div className="mb-4 p-3 bg-red-50 text-red-600 rounded-lg text-sm">{error}</div>}

        <form onSubmit={handleSubmit} className="space-y-5">
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

          {/* Webcam */}
          <div className="bg-white rounded-xl border p-5">
            <h2 className="font-semibold text-sm text-gray-700 uppercase tracking-wide mb-3">Visitor Photo</h2>
            {photoUrl ? (
              <div className="flex items-center gap-4">
                <img src={`${API_URL}${photoUrl}`} alt="Captured"
                  className="w-24 h-24 object-cover rounded-lg border" />
                <button type="button" onClick={() => { setPhotoUrl(null); setPhotoPath(null) }}
                  className="text-sm text-red-500 hover:underline">Retake</button>
              </div>
            ) : stream ? (
              <div className="space-y-2">
                <video ref={videoRef} autoPlay className="w-full max-w-xs rounded-lg border" />
                <canvas ref={canvasRef} className="hidden" />
                <button type="button" onClick={capturePhoto}
                  className="bg-green-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-green-700">
                  Capture Photo
                </button>
              </div>
            ) : (
              <button type="button" onClick={startCamera}
                className="border-2 border-dashed border-gray-300 rounded-lg px-6 py-4 text-sm text-gray-400 hover:border-blue-400 hover:text-blue-500">
                📷 Open Camera
              </button>
            )}
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
