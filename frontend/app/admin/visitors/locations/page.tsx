'use client'
import { useEffect, useState } from 'react'
import AdminNav from '@/components/AdminNav'
import { api } from '@/lib/api'
import Link from 'next/link'

interface Location { id: number; name: string; ip_camera_url?: string }

export default function VisitorLocationsPage() {
  const [locations, setLocations] = useState<Location[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editItem, setEditItem] = useState<Location | null>(null)
  const [name, setName] = useState('')
  const [cameraUrl, setCameraUrl] = useState('')
  const [saving, setSaving] = useState(false)
  const [snapshotUrl, setSnapshotUrl] = useState<string | null>(null)
  const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

  const load = () => {
    api.get('/visitors/locations')
      .then(r => setLocations(r.data))
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [])

  const openCreate = () => {
    setEditItem(null)
    setName('')
    setCameraUrl('')
    setSnapshotUrl(null)
    setShowForm(true)
  }

  const openEdit = (loc: Location) => {
    setEditItem(loc)
    setName(loc.name)
    setCameraUrl(loc.ip_camera_url || '')
    setSnapshotUrl(null)
    setShowForm(true)
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      if (editItem) {
        await api.put(`/visitors/locations/${editItem.id}`, { name, ip_camera_url: cameraUrl || null })
      } else {
        await api.post('/visitors/locations', { name, ip_camera_url: cameraUrl || null })
      }
      setShowForm(false)
      load()
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id: number) => {
    if (!confirm('Delete this location?')) return
    await api.delete(`/visitors/locations/${id}`)
    load()
  }

  const testSnapshot = (id: number) => {
    setSnapshotUrl(`${API_URL}/visitors/locations/${id}/snapshot?t=${Date.now()}`)
  }

  return (
    <>
      <AdminNav />
      <main className="ml-60 pt-14 p-6 max-w-3xl">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold">Visitor Locations</h1>
          <button onClick={openCreate}
            className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 text-sm font-medium">
            + Add Location
          </button>
        </div>

        {loading ? (
          <p className="text-gray-400">Loading…</p>
        ) : locations.length === 0 ? (
          <div className="bg-white rounded-xl border p-8 text-center text-gray-400">
            No locations yet. Add one to get started.
          </div>
        ) : (
          <div className="space-y-3">
            {locations.map(loc => (
              <div key={loc.id} className="bg-white rounded-xl border p-4 flex items-center justify-between">
                <div>
                  <p className="font-medium text-gray-800">{loc.name}</p>
                  <p className="text-xs text-gray-400 mt-0.5">
                    {loc.ip_camera_url ? `📷 ${loc.ip_camera_url}` : 'No IP camera configured'}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {loc.ip_camera_url && (
                    <>
                      <Link
                        href={`/admin/visitors/cameras?loc=${loc.id}`}
                        className="text-xs text-red-600 hover:underline font-medium">
                        📹 Live View
                      </Link>
                      <button onClick={() => testSnapshot(loc.id)}
                        className="text-xs text-blue-600 hover:underline">Snapshot</button>
                    </>
                  )}
                  <button onClick={() => openEdit(loc)}
                    className="text-xs text-gray-500 hover:text-gray-700">Edit</button>
                  <button onClick={() => handleDelete(loc.id)}
                    className="text-xs text-red-500 hover:text-red-700">Delete</button>
                </div>
              </div>
            ))}
          </div>
        )}

        {snapshotUrl && (
          <div className="mt-4 bg-white rounded-xl border p-4">
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm font-medium text-gray-700">Camera Snapshot</p>
              <button onClick={() => setSnapshotUrl(null)} className="text-gray-400 hover:text-gray-600 text-xs">✕ Close</button>
            </div>
            <img src={snapshotUrl} alt="CCTV snapshot" className="w-full rounded-lg" />
          </div>
        )}

        {/* Create/Edit Modal */}
        {showForm && (
          <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
            <div className="bg-white rounded-xl p-6 w-full max-w-md shadow-xl">
              <h2 className="text-lg font-semibold mb-4">
                {editItem ? 'Edit Location' : 'New Location'}
              </h2>
              <div className="space-y-3">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Location Name *</label>
                  <input className="w-full border rounded-lg px-3 py-2 text-sm"
                    value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Head Office Lobby" />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">IP Camera Snapshot URL</label>
                  <input className="w-full border rounded-lg px-3 py-2 text-sm"
                    value={cameraUrl} onChange={e => setCameraUrl(e.target.value)}
                    placeholder="http://192.168.1.100/snapshot.jpg" />
                  <p className="text-xs text-gray-400 mt-1">Optional. Must be a URL that returns a JPEG image.</p>
                </div>
              </div>
              <div className="flex justify-end gap-2 mt-5">
                <button onClick={() => setShowForm(false)}
                  className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">Cancel</button>
                <button onClick={handleSave} disabled={!name || saving}
                  className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50">
                  {saving ? 'Saving…' : 'Save'}
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    </>
  )
}
