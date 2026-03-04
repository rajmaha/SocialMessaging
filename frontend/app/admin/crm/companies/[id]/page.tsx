'use client'
import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import api from '@/lib/api'

export default function CompanyDetailPage() {
  const { id } = useParams()
  const router = useRouter()
  const [org, setOrg] = useState<any>(null)
  const [tab, setTab] = useState<'info' | 'contacts' | 'leads'>('info')
  const [loading, setLoading] = useState(true)
  const [showAddContact, setShowAddContact] = useState(false)
  const [newContact, setNewContact] = useState({ full_name: '', email: '', designation: '', notes: '' })

  const load = () => {
    api.get(`/crm/organizations/${id}`).then(r => { setOrg(r.data); setLoading(false) })
  }
  useEffect(() => { load() }, [id])

  const addContact = async () => {
    if (!newContact.full_name) return
    await api.post(`/crm/organizations/${id}/contacts`, newContact)
    setNewContact({ full_name: '', email: '', designation: '', notes: '' })
    setShowAddContact(false)
    load()
  }

  const deleteContact = async (cid: number) => {
    if (!confirm('Remove this contact?')) return
    await api.delete(`/crm/organizations/${id}/contacts/${cid}`)
    load()
  }

  if (loading) return <div className="p-6 text-gray-400">Loading...</div>
  if (!org) return <div className="p-6 text-red-500">Not found</div>

  return (
    <div className="p-6">
      <div className="flex items-center gap-3 mb-6">
        <button onClick={() => router.back()} className="text-gray-400 hover:text-gray-600 text-sm">← Back</button>
        <div>
          <h1 className="text-2xl font-bold">{org.organization_name}</h1>
          <p className="text-sm text-gray-500">{org.industry} {org.company_size ? `· ${org.company_size} employees` : ''}</p>
        </div>
        <div className="ml-auto flex gap-3">
          <span className="text-sm text-gray-500">{org.lead_count} leads · {org.contact_count} contacts</span>
        </div>
      </div>

      <div className="flex gap-1 mb-6 border-b">
        {(['info', 'contacts', 'leads'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium capitalize ${tab === t ? 'border-b-2 border-indigo-600 text-indigo-600' : 'text-gray-500 hover:text-gray-700'}`}>
            {t} {t === 'contacts' ? `(${org.contacts?.length || 0})` : t === 'leads' ? `(${org.leads?.length || 0})` : ''}
          </button>
        ))}
      </div>

      {tab === 'info' && (
        <div className="bg-white rounded-xl border p-6 grid grid-cols-2 gap-6 max-w-2xl">
          {[
            ['Email', org.email], ['Website', org.website], ['Address', org.address],
            ['Annual Revenue', org.annual_revenue ? `$${org.annual_revenue.toLocaleString()}` : null],
            ['Description', org.description],
          ].filter(([, v]) => v).map(([label, value]) => (
            <div key={label as string}>
              <p className="text-xs text-gray-400 uppercase tracking-wide mb-1">{label}</p>
              <p className="text-sm text-gray-700">{value}</p>
            </div>
          ))}
        </div>
      )}

      {tab === 'contacts' && (
        <div>
          <div className="flex justify-between items-center mb-4">
            <h2 className="font-semibold text-gray-700">Contacts</h2>
            <button onClick={() => setShowAddContact(true)} className="text-sm bg-indigo-600 text-white px-3 py-1.5 rounded-lg hover:bg-indigo-700">+ Add Contact</button>
          </div>
          {showAddContact && (
            <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-4 mb-4 flex gap-3 flex-wrap items-end">
              {['full_name', 'email', 'designation'].map(field => (
                <div key={field}>
                  <label className="block text-xs font-medium mb-1 capitalize">{field.replace('_', ' ')}</label>
                  <input value={(newContact as any)[field]} onChange={e => setNewContact(c => ({ ...c, [field]: e.target.value }))}
                    className="border rounded px-2 py-1 text-sm focus:outline-none" placeholder={field} />
                </div>
              ))}
              <button onClick={addContact} className="bg-indigo-600 text-white px-3 py-1.5 rounded text-sm">Save</button>
              <button onClick={() => setShowAddContact(false)} className="text-sm text-gray-500 hover:text-gray-700">Cancel</button>
            </div>
          )}
          <div className="space-y-2">
            {(org.contacts || []).map((c: any) => (
              <div key={c.id} className="bg-white border rounded-xl px-4 py-3 flex items-center justify-between">
                <div>
                  <p className="font-medium text-sm">{c.full_name}</p>
                  <p className="text-xs text-gray-400">{c.designation} {c.email ? `· ${c.email}` : ''}</p>
                  {c.notes && <p className="text-xs text-gray-500 mt-1">{c.notes}</p>}
                </div>
                <button onClick={() => deleteContact(c.id)} className="text-red-400 hover:text-red-600 text-xs">Remove</button>
              </div>
            ))}
            {(org.contacts || []).length === 0 && <p className="text-gray-400 text-sm">No contacts yet.</p>}
          </div>
        </div>
      )}

      {tab === 'leads' && (
        <div className="space-y-2">
          {(org.leads || []).map((l: any) => (
            <Link key={l.id} href={`/admin/crm/leads/${l.id}`}
              className="bg-white border rounded-xl px-4 py-3 flex items-center gap-4 hover:bg-gray-50 block">
              <div className="flex-1">
                <p className="font-medium text-sm">{l.first_name} {l.last_name || ''}</p>
                <p className="text-xs text-gray-400">{l.email} · {l.position}</p>
              </div>
              <span className="text-xs px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-700">{l.status}</span>
              <span className="text-xs text-gray-400">Score: {l.score}</span>
            </Link>
          ))}
          {(org.leads || []).length === 0 && <p className="text-gray-400 text-sm">No leads linked to this company.</p>}
        </div>
      )}
    </div>
  )
}
