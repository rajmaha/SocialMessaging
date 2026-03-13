// frontend/app/admin/visitors/[id]/page.tsx
'use client'
import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import AdminNav from '@/components/AdminNav'
import MainHeader from '@/components/MainHeader'
import { api } from '@/lib/api'
import { authAPI } from '@/lib/auth'
import { API_URL } from '@/lib/config'
import { useBranding } from '@/lib/branding-context'
import { formatDateWithTimezone } from '@/lib/date-utils'

interface Visit {
  id: number
  visitor_name: string
  visitor_organization?: string
  visitor_photo_url?: string
  cctv_photo_url?: string
  location_name?: string
  num_visitors: number
  purpose: string
  host_agent_name?: string
  check_in_at: string
  check_out_at?: string
  status: string
  pass_card_no?: string
}

export default function VisitDetailPage() {
  const user = authAPI.getUser()
  const { id } = useParams()
  const router = useRouter()
  const { branding } = useBranding()
  const tz = branding?.timezone || 'UTC'
  const [visit, setVisit] = useState<Visit | null>(null)
  const [loading, setLoading] = useState(true)

  const loadVisit = () => {
    api.get(`/visitors/${id}`)
      .then(r => setVisit(r.data))
      .finally(() => setLoading(false))
  }

  useEffect(() => { loadVisit() }, [id])

  const handleCheckout = async () => {
    await api.patch(`/visitors/${id}/checkout`)
    loadVisit()
  }

  const fmt = (dt?: string) => dt ? formatDateWithTimezone(dt, tz) : '—'

  if (loading) return (
    <><MainHeader user={user!} /><AdminNav /><main className="ml-60 pt-14 p-6 text-gray-400">Loading…</main></>
  )
  if (!visit) return (
    <><MainHeader user={user!} /><AdminNav /><main className="ml-60 pt-14 p-6 text-red-500">Visit not found</main></>
  )

  return (
    <>
      <MainHeader user={user!} />
      <AdminNav />
      <main className="ml-60 pt-14 p-6 max-w-4xl">
        <div className="flex items-center justify-between mb-6">
          <div>
            <button onClick={() => router.back()} className="text-sm text-gray-400 hover:text-gray-600 mb-1">
              ← Back
            </button>
            <h1 className="text-2xl font-bold">{visit.visitor_name}</h1>
            {visit.visitor_organization && (
              <p className="text-gray-500 text-sm mt-0.5">{visit.visitor_organization}</p>
            )}
          </div>
          {visit.status === 'checked_in' && (
            <button
              onClick={handleCheckout}
              className="bg-orange-500 text-white px-4 py-2 rounded-lg hover:bg-orange-600 text-sm font-medium">
              Check Out Now
            </button>
          )}
        </div>

        <div className="grid grid-cols-2 gap-6">
          {/* Details */}
          <div className="bg-white rounded-xl border p-5 space-y-4">
            <h2 className="font-semibold text-gray-700 text-sm uppercase tracking-wide">Visit Details</h2>
            {([
              ['Purpose', visit.purpose],
              ['Host', visit.host_agent_name || '—'],
              ['Location', visit.location_name || '—'],
              ['Pass Card', visit.pass_card_no ? `Card #${visit.pass_card_no}` : '—'],
              ['Group Size', String(visit.num_visitors)],
              ['Status', visit.status === 'checked_in' ? 'Checked In' : 'Checked Out'],
              ['Checked In', fmt(visit.check_in_at)],
              ['Checked Out', fmt(visit.check_out_at)],
            ] as [string, string][]).map(([label, value]) => (
              <div key={label} className="flex justify-between text-sm">
                <span className="text-gray-400">{label}</span>
                <span className="text-gray-800 font-medium">{value}</span>
              </div>
            ))}
          </div>

          {/* Photos */}
          <div className="space-y-4">
            {visit.visitor_photo_url && (
              <div className="bg-white rounded-xl border p-4">
                <p className="text-xs text-gray-400 uppercase tracking-wide mb-3">Visitor Photo</p>
                <img
                  src={`${API_URL}${visit.visitor_photo_url}`}
                  alt="Visitor"
                  className="w-full max-h-48 object-cover rounded-lg"
                />
              </div>
            )}
            {visit.cctv_photo_url && (
              <div className="bg-white rounded-xl border p-4">
                <p className="text-xs text-gray-400 uppercase tracking-wide mb-3">CCTV Snapshot</p>
                <img
                  src={`${API_URL}${visit.cctv_photo_url}`}
                  alt="CCTV"
                  className="w-full max-h-48 object-cover rounded-lg"
                />
              </div>
            )}
          </div>
        </div>
      </main>
    </>
  )
}
