// frontend/app/kiosk/[locationId]/page.tsx
'use client'
import { useEffect, useRef, useState } from 'react'
import { useParams } from 'next/navigation'
import { api } from '@/lib/api'

type Step = 'lookup' | 'form' | 'camera' | 'confirm' | 'checkout'

interface Agent { id: number; name: string }

export default function KioskPage() {
  const { locationId } = useParams()
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)

  const [step, setStep] = useState<Step>('lookup')
  const [agents, setAgents] = useState<Agent[]>([])
  const [stream, setStream] = useState<MediaStream | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [confirmedName, setConfirmedName] = useState('')

  const [lookup, setLookup] = useState('')
  const [checkoutPhone, setCheckoutPhone] = useState('')
  const [checkoutVisits, setCheckoutVisits] = useState<any[]>([])

  const [form, setForm] = useState({
    visitor_name: '', visitor_organization: '', visitor_contact_no: '',
    visitor_email: '', visitor_address: '', purpose: '',
    host_agent_id: '', num_visitors: '1',
  })

  useEffect(() => {
    api.get('/visitors/agents/list').then(r => setAgents(r.data))
  }, [])

  // Step 1: Lookup returning visitor
  const handleLookup = async () => {
    if (lookup.trim().length >= 2) {
      try {
        const res = await api.get('/visitors/profiles/search', { params: { q: lookup } })
        if (res.data.length > 0) {
          const p = res.data[0]
          setForm(f => ({
            ...f,
            visitor_name: p.name,
            visitor_organization: p.organization || '',
            visitor_contact_no: p.contact_no || '',
            visitor_email: p.email || '',
            visitor_address: p.address || '',
          }))
        }
      } catch {}
    }
    setStep('form')
  }

  // Step 3: Camera
  const startCamera = async () => {
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: true })
      setStream(s)
      if (videoRef.current) videoRef.current.srcObject = s
    } catch {
      // Camera permission denied — skip photo
      handleCheckin(null)
    }
  }

  const capturePhoto = () => {
    if (!videoRef.current || !canvasRef.current) return
    const ctx = canvasRef.current.getContext('2d')!
    canvasRef.current.width = videoRef.current.videoWidth
    canvasRef.current.height = videoRef.current.videoHeight
    ctx.drawImage(videoRef.current, 0, 0)
    stream?.getTracks().forEach(t => t.stop())
    setStream(null)
    canvasRef.current.toBlob(async blob => {
      if (!blob) { handleCheckin(null); return }
      const fd = new FormData()
      fd.append('file', blob, 'visitor.jpg')
      try {
        const res = await api.post('/visitors/upload-photo', fd, {
          headers: { 'Content-Type': 'multipart/form-data' }
        })
        handleCheckin(res.data.path)
      } catch {
        handleCheckin(null)
      }
    }, 'image/jpeg')
  }

  const handleCheckin = async (photo: string | null) => {
    setSubmitting(true)
    try {
      await api.post('/visitors/', {
        ...form,
        num_visitors: parseInt(form.num_visitors) || 1,
        host_agent_id: form.host_agent_id ? parseInt(form.host_agent_id) : null,
        location_id: locationId ? parseInt(locationId as string) : null,
        visitor_photo_path: photo,
      })
      setConfirmedName(form.visitor_name)
      setStep('confirm')
    } catch {
      setConfirmedName(form.visitor_name)
      setStep('confirm')
    } finally {
      setSubmitting(false)
    }
  }

  // Checkout flow
  const handleCheckoutLookup = async () => {
    try {
      const res = await api.get('/visitors/kiosk/active-visits', { params: { contact_no: checkoutPhone } })
      setCheckoutVisits(res.data)
    } catch {
      setCheckoutVisits([])
    }
  }

  const handleCheckoutVisit = async (visitId: number) => {
    await api.patch(`/visitors/${visitId}/checkout`)
    setCheckoutVisits([])
    setCheckoutPhone('')
    setStep('lookup')
  }

  // Reset after 30s on confirm screen
  useEffect(() => {
    if (step !== 'confirm') return
    const t = setTimeout(() => {
      setStep('lookup')
      setLookup('')
      setForm({
        visitor_name: '', visitor_organization: '', visitor_contact_no: '',
        visitor_email: '', visitor_address: '', purpose: '',
        host_agent_id: '', num_visitors: '1',
      })
    }, 30000)
    return () => clearTimeout(t)
  }, [step])

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-lg">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-gray-800">Visitor Check-In</h1>
          <p className="text-gray-500 mt-1">Welcome! Please sign in below.</p>
        </div>

        {step === 'lookup' && (
          <div className="bg-white rounded-2xl shadow-lg p-8 space-y-4">
            <p className="text-gray-600 text-sm">Have you visited before? Enter your phone or email to pre-fill your details.</p>
            <input className="w-full border rounded-xl px-4 py-3 text-base"
              placeholder="Phone or email…"
              value={lookup}
              onChange={e => setLookup(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleLookup()} />
            <button onClick={handleLookup}
              className="w-full bg-blue-600 text-white py-3 rounded-xl text-base font-medium hover:bg-blue-700">
              Continue →
            </button>
            <button onClick={() => setStep('checkout')}
              className="w-full text-sm text-gray-400 hover:text-gray-600 py-2">
              Checking out instead?
            </button>
          </div>
        )}

        {step === 'form' && (
          <div className="bg-white rounded-2xl shadow-lg p-8 space-y-4">
            <h2 className="font-semibold text-gray-700">Your Details</h2>
            {([
              ['visitor_name', 'Full Name *', 'text'],
              ['visitor_organization', 'Organisation', 'text'],
              ['visitor_contact_no', 'Phone', 'tel'],
              ['visitor_email', 'Email', 'email'],
            ] as [string, string, string][]).map(([key, label, type]) => (
              <div key={key}>
                <label className="text-xs text-gray-400 block mb-1">{label}</label>
                <input type={type} className="w-full border rounded-xl px-4 py-2.5 text-sm"
                  value={(form as any)[key]}
                  onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))} />
              </div>
            ))}
            <div>
              <label className="text-xs text-gray-400 block mb-1">Purpose of Visit *</label>
              <input className="w-full border rounded-xl px-4 py-2.5 text-sm"
                value={form.purpose}
                onChange={e => setForm(f => ({ ...f, purpose: e.target.value }))} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-gray-400 block mb-1">No. of Visitors</label>
                <input type="number" min={1} className="w-full border rounded-xl px-4 py-2.5 text-sm"
                  value={form.num_visitors}
                  onChange={e => setForm(f => ({ ...f, num_visitors: e.target.value }))} />
              </div>
              <div>
                <label className="text-xs text-gray-400 block mb-1">Visiting</label>
                <select className="w-full border rounded-xl px-4 py-2.5 text-sm"
                  value={form.host_agent_id}
                  onChange={e => setForm(f => ({ ...f, host_agent_id: e.target.value }))}>
                  <option value="">— Select —</option>
                  {agents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </div>
            </div>
            <div className="flex gap-2 pt-2">
              <button onClick={() => setStep('lookup')}
                className="flex-1 border py-3 rounded-xl text-sm text-gray-500 hover:bg-gray-50">← Back</button>
              <button
                disabled={!form.visitor_name || !form.purpose}
                onClick={() => { setStep('camera'); startCamera() }}
                className="flex-1 bg-blue-600 text-white py-3 rounded-xl text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
                Next: Photo →
              </button>
            </div>
          </div>
        )}

        {step === 'camera' && (
          <div className="bg-white rounded-2xl shadow-lg p-8 space-y-4 text-center">
            <h2 className="font-semibold text-gray-700">Take Your Photo</h2>
            <video ref={videoRef} autoPlay playsInline className="w-full rounded-xl border" />
            <canvas ref={canvasRef} className="hidden" />
            {submitting ? (
              <p className="text-gray-400 text-sm">Checking in…</p>
            ) : (
              <>
                <button onClick={capturePhoto}
                  className="w-full bg-green-600 text-white py-3 rounded-xl text-base font-medium hover:bg-green-700">
                  📷 Capture &amp; Check In
                </button>
                <button onClick={() => handleCheckin(null)}
                  className="w-full text-sm text-gray-400 hover:text-gray-600 py-2">
                  Skip photo
                </button>
              </>
            )}
          </div>
        )}

        {step === 'confirm' && (
          <div className="bg-white rounded-2xl shadow-lg p-10 text-center space-y-4">
            <div className="text-6xl">✅</div>
            <h2 className="text-2xl font-bold text-gray-800">Welcome, {confirmedName}!</h2>
            <p className="text-gray-500">Your host has been notified. Please take a seat.</p>
            <button onClick={() => setStep('lookup')}
              className="mt-4 text-sm text-blue-500 hover:underline">
              Check in another visitor
            </button>
          </div>
        )}

        {step === 'checkout' && (
          <div className="bg-white rounded-2xl shadow-lg p-8 space-y-4">
            <h2 className="font-semibold text-gray-700">Check Out</h2>
            <input className="w-full border rounded-xl px-4 py-3 text-base"
              placeholder="Your phone number…"
              value={checkoutPhone}
              onChange={e => setCheckoutPhone(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleCheckoutLookup()} />
            <button onClick={handleCheckoutLookup}
              className="w-full bg-orange-500 text-white py-3 rounded-xl text-base font-medium hover:bg-orange-600">
              Find My Visit
            </button>
            {checkoutVisits.length > 0 && checkoutVisits.map((v: any) => (
              <div key={v.id} className="flex items-center justify-between border rounded-xl p-3">
                <div>
                  <p className="font-medium text-sm">{v.purpose}</p>
                  <p className="text-xs text-gray-400">{new Date(v.check_in_at).toLocaleString()}</p>
                </div>
                <button onClick={() => handleCheckoutVisit(v.id)}
                  className="bg-orange-500 text-white px-4 py-2 rounded-lg text-sm font-medium">
                  Check Out
                </button>
              </div>
            ))}
            <button onClick={() => setStep('lookup')}
              className="w-full text-sm text-gray-400 hover:text-gray-600 py-2">← Back</button>
          </div>
        )}
      </div>
    </div>
  )
}
