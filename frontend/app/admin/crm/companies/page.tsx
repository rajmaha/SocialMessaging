'use client'
import { useState, useEffect } from 'react'
import Link from 'next/link'
import { api } from '@/lib/api'
import { authAPI } from '@/lib/auth'
import MainHeader from '@/components/MainHeader'
import AdminNav from '@/components/AdminNav'

interface Organization {
  id: number
  organization_name: string
  industry: string | null
  company_size: string | null
  website: string | null
  email: string | null
  lead_count: number
  contact_count: number
  is_active: number
}

export default function CompaniesPage() {
  const user = authAPI.getUser()
  const [orgs, setOrgs] = useState<Organization[]>([])
  const [search, setSearch] = useState('')
  const [industry, setIndustry] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    const params = new URLSearchParams()
    if (search) params.set('search', search)
    if (industry) params.set('industry', industry)
    api.get(`/crm/organizations?${params}`).then(r => {
      setOrgs(r.data)
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [search, industry])

  const industries = ['Technology', 'Finance', 'Healthcare', 'Retail', 'Manufacturing', 'Education', 'Other']

  return (
    <div className="ml-60 pt-14 min-h-screen bg-gray-50">
      <MainHeader user={user!} />
      <AdminNav />
      <main className="w-full px-6 py-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Companies</h1>
          <p className="text-sm text-gray-500 mt-1">{orgs.length} organizations</p>
        </div>
        <Link href="/admin/crm/companies/new" className="bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-indigo-700">
          + New Company
        </Link>
      </div>

      <div className="flex gap-3 mb-4">
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search companies..."
          className="border rounded-lg px-3 py-2 text-sm flex-1 max-w-xs focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
        <select
          value={industry}
          onChange={e => setIndustry(e.target.value)}
          className="border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
        >
          <option value="">All Industries</option>
          {industries.map(i => <option key={i} value={i}>{i}</option>)}
        </select>
      </div>

      {loading ? (
        <div className="text-center py-12 text-gray-400">Loading...</div>
      ) : orgs.length === 0 ? (
        <div className="text-center py-12 text-gray-400">No companies found.</div>
      ) : (
        <div className="bg-white rounded-xl border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wide">
              <tr>
                <th className="px-4 py-3 text-left">Company</th>
                <th className="px-4 py-3 text-left">Industry</th>
                <th className="px-4 py-3 text-left">Website</th>
                <th className="px-4 py-3 text-center">Leads</th>
                <th className="px-4 py-3 text-center">Contacts</th>
                <th className="px-4 py-3 text-left">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {orgs.map(org => (
                <tr key={org.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <Link href={`/admin/crm/companies/${org.id}`} className="font-medium text-indigo-600 hover:text-indigo-800">
                      {org.organization_name}
                    </Link>
                    {org.email && <p className="text-xs text-gray-400">{org.email}</p>}
                  </td>
                  <td className="px-4 py-3 text-gray-600">{org.industry || '—'}</td>
                  <td className="px-4 py-3">
                    {org.website ? (
                      <a href={org.website} target="_blank" rel="noreferrer" className="text-indigo-500 hover:underline text-xs">{org.website}</a>
                    ) : '—'}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span className="bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded-full text-xs font-semibold">{org.lead_count}</span>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span className="bg-gray-100 text-gray-700 px-2 py-0.5 rounded-full text-xs font-semibold">{org.contact_count}</span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${org.is_active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                      {org.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      </main>
    </div>
  )
}
