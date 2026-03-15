'use client'
import { useEffect, useState } from 'react'
import AdminNav from '@/components/AdminNav'
import MainHeader from '@/components/MainHeader'
import { api } from '@/lib/api'
import { authAPI } from '@/lib/auth'
import Link from 'next/link'
import { useBranding } from '@/lib/branding-context'
import { formatDateWithTimezone } from '@/lib/date-utils'

const PAGE_SIZE = 25

interface Visit {
  id: number
  visitor_name: string
  visitor_organization?: string
  visitor_photo_url?: string
  location_name?: string
  num_visitors: number
  purpose: string
  host_agent_name?: string
  check_in_at: string
  check_out_at?: string
  status: 'checked_in' | 'checked_out'
}

export default function VisitorsPage() {
  const user = authAPI.getUser()
  const { branding } = useBranding()
  const tz = branding?.timezone || 'UTC'

  const [visits, setVisits] = useState<Visit[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  const load = async (p = page) => {
    setLoading(true)
    try {
      const params: Record<string, string> = { page: String(p), page_size: String(PAGE_SIZE) }
      if (search) params.search = search
      if (statusFilter) params.status = statusFilter
      if (dateFrom) params.date_from = dateFrom
      if (dateTo) params.date_to = dateTo
      const res = await api.get('/visitors/', { params })
      setVisits(res.data)
      const count = parseInt(res.headers['x-total-count'] || '0', 10)
      setTotal(count)
    } finally {
      setLoading(false)
    }
  }

  // Reset to page 1 whenever filters change
  useEffect(() => {
    setPage(1)
    load(1)
  }, [search, statusFilter, dateFrom, dateTo])

  // Load when page changes (but not on filter changes — handled above)
  useEffect(() => { load(page) }, [page])

  const handleCheckout = async (visitId: number) => {
    await api.patch(`/visitors/${visitId}/checkout`)
    load(page)
  }

  const fmt = (dt?: string) => dt ? formatDateWithTimezone(dt, tz) : '—'

  const goTo = (p: number) => {
    if (p < 1 || p > totalPages) return
    setPage(p)
  }

  return (
    <>
      <MainHeader user={user!} />
      <AdminNav />
      <main className="ml-60 pt-14 p-6">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold">Visitors</h1>
          <Link href="/admin/visitors/new"
            className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 text-sm font-medium">
            + Check In Visitor
          </Link>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap gap-3 mb-5">
          <input
            className="border rounded-lg px-3 py-2 text-sm w-56"
            placeholder="Search name or organisation…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          <select
            className="border rounded-lg px-3 py-2 text-sm"
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value)}>
            <option value="">All statuses</option>
            <option value="checked_in">Checked In</option>
            <option value="checked_out">Checked Out</option>
          </select>
          <input type="date" className="border rounded-lg px-3 py-2 text-sm"
            value={dateFrom} onChange={e => setDateFrom(e.target.value)} />
          <span className="self-center text-sm text-gray-400">to</span>
          <input type="date" className="border rounded-lg px-3 py-2 text-sm"
            value={dateTo} onChange={e => setDateTo(e.target.value)} />
        </div>

        {/* Table */}
        <div className="bg-white rounded-xl border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-500 text-left">
              <tr>
                <th className="px-4 py-3 font-medium">Visitor</th>
                <th className="px-4 py-3 font-medium">Organisation</th>
                <th className="px-4 py-3 font-medium">Purpose</th>
                <th className="px-4 py-3 font-medium">Host</th>
                <th className="px-4 py-3 font-medium">Location</th>
                <th className="px-4 py-3 font-medium">Checked In</th>
                <th className="px-4 py-3 font-medium">Checked Out</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr><td colSpan={9} className="px-4 py-8 text-center text-gray-400">Loading…</td></tr>
              ) : visits.length === 0 ? (
                <tr><td colSpan={9} className="px-4 py-8 text-center text-gray-400">No visits found</td></tr>
              ) : visits.map(v => (
                <tr key={v.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <Link href={`/admin/visitors/${v.id}`}
                      className="font-medium text-blue-600 hover:underline">
                      {v.visitor_name}
                    </Link>
                    {v.num_visitors > 1 && (
                      <span className="ml-1 text-xs text-gray-400">(+{v.num_visitors - 1})</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-gray-600">{v.visitor_organization || '—'}</td>
                  <td className="px-4 py-3 text-gray-600">{v.purpose}</td>
                  <td className="px-4 py-3 text-gray-600">{v.host_agent_name || '—'}</td>
                  <td className="px-4 py-3 text-gray-600">{v.location_name || '—'}</td>
                  <td className="px-4 py-3 text-gray-500 text-xs">{fmt(v.check_in_at)}</td>
                  <td className="px-4 py-3 text-gray-500 text-xs">{fmt(v.check_out_at)}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                      v.status === 'checked_in'
                        ? 'bg-green-100 text-green-700'
                        : 'bg-gray-100 text-gray-500'
                    }`}>
                      {v.status === 'checked_in' ? 'Checked In' : 'Checked Out'}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    {v.status === 'checked_in' && (
                      <button
                        onClick={() => handleCheckout(v.id)}
                        className="text-xs text-orange-600 hover:underline font-medium">
                        Check Out
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Pagination footer */}
          {total > PAGE_SIZE && (
            <div className="flex items-center justify-between px-4 py-3 border-t bg-gray-50 text-sm text-gray-500">
              <span>
                Showing {((page - 1) * PAGE_SIZE) + 1}–{Math.min(page * PAGE_SIZE, total)} of {total}
              </span>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => goTo(1)}
                  disabled={page === 1}
                  className="px-2 py-1 rounded hover:bg-gray-200 disabled:opacity-40 disabled:cursor-default">
                  «
                </button>
                <button
                  onClick={() => goTo(page - 1)}
                  disabled={page === 1}
                  className="px-2 py-1 rounded hover:bg-gray-200 disabled:opacity-40 disabled:cursor-default">
                  ‹
                </button>

                {/* Page number buttons — show up to 5 around current page */}
                {Array.from({ length: totalPages }, (_, i) => i + 1)
                  .filter(p => p === 1 || p === totalPages || Math.abs(p - page) <= 2)
                  .reduce<(number | '…')[]>((acc, p, idx, arr) => {
                    if (idx > 0 && p - (arr[idx - 1] as number) > 1) acc.push('…')
                    acc.push(p)
                    return acc
                  }, [])
                  .map((p, idx) =>
                    p === '…'
                      ? <span key={`ellipsis-${idx}`} className="px-2">…</span>
                      : (
                        <button
                          key={p}
                          onClick={() => goTo(p as number)}
                          className={`px-3 py-1 rounded font-medium ${
                            p === page
                              ? 'bg-blue-600 text-white'
                              : 'hover:bg-gray-200'
                          }`}>
                          {p}
                        </button>
                      )
                  )}

                <button
                  onClick={() => goTo(page + 1)}
                  disabled={page === totalPages}
                  className="px-2 py-1 rounded hover:bg-gray-200 disabled:opacity-40 disabled:cursor-default">
                  ›
                </button>
                <button
                  onClick={() => goTo(totalPages)}
                  disabled={page === totalPages}
                  className="px-2 py-1 rounded hover:bg-gray-200 disabled:opacity-40 disabled:cursor-default">
                  »
                </button>
              </div>
            </div>
          )}
        </div>
      </main>
    </>
  )
}
