'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import MainHeader from '@/components/MainHeader'
import AdminNav from '@/components/AdminNav'
import { authAPI, getAuthToken } from '@/lib/auth'
import { API_URL } from '@/lib/config'

// ── Types ─────────────────────────────────────────────────────────────────────

interface ApiServer {
  id: number
  name: string
  base_url: string
  auth_type: string
}

interface ApiEndpoint {
  id: number
  method: string
  path: string
  summary: string | null
  fields: { key: string; label: string; type?: string; required?: boolean }[]
}

interface FieldMapping {
  form_key: string      // remote API field name
  source_key: string    // local source e.g. "organization.organization_name"
}

interface Settings {
  id: number
  api_server_id: number | null
  api_server_name: string | null
  api_endpoint: string | null
  post_create_field_map: FieldMapping[] | null
}

// ── Available local source fields ─────────────────────────────────────────────

const SOURCE_FIELDS = [
  { group: 'Organization', options: [
    { value: 'organization.id',                label: 'ID' },
    { value: 'organization.organization_name', label: 'Organization Name' },
    { value: 'organization.email',             label: 'Email' },
    { value: 'organization.domain_name',       label: 'Domain Name' },
    { value: 'organization.pan_no',            label: 'PAN No' },
    { value: 'organization.address',           label: 'Address' },
    { value: 'organization.contact_numbers',   label: 'Contact Numbers' },
    { value: 'organization.industry',          label: 'Industry' },
    { value: 'organization.company_size',      label: 'Company Size' },
    { value: 'organization.website',           label: 'Website' },
    { value: 'organization.annual_revenue',    label: 'Annual Revenue' },
    { value: 'organization.description',       label: 'Description' },
    { value: 'organization.tags',              label: 'Tags' },
  ]},
  { group: 'Subscription', options: [
    { value: 'subscription.id',                label: 'ID' },
    { value: 'subscription.subscribed_product',label: 'Product' },
    { value: 'subscription.modules',           label: 'Modules' },
    { value: 'subscription.system_url',        label: 'System URL' },
    { value: 'subscription.company_logo_url',  label: 'Company Logo URL' },
    { value: 'subscription.subscribed_on_date',label: 'Subscribed On Date' },
    { value: 'subscription.billed_from_date',  label: 'Billed From Date' },
    { value: 'subscription.expire_date',       label: 'Expire Date' },
    { value: 'subscription.status',            label: 'Status' },
    { value: 'subscription.created_at',        label: 'Created At' },
  ]},
]

const HTTP_METHODS = ['POST', 'PUT', 'PATCH']

function authHeaders() {
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${getAuthToken()}` }
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function SubscriptionSettingsPage() {
  const router = useRouter()
  const [user] = useState(() => authAPI.getUser())

  const [apiServers, setApiServers] = useState<ApiServer[]>([])
  const [settings, setSettings] = useState<Settings | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  // Form state
  const [selectedServerId, setSelectedServerId] = useState<string>('')
  const [httpMethod, setHttpMethod] = useState('POST')
  const [endpointPath, setEndpointPath] = useState('')
  const [mappings, setMappings] = useState<FieldMapping[]>([])

  // Endpoint picker state (from spec)
  const [serverEndpoints, setServerEndpoints] = useState<ApiEndpoint[]>([])
  const [loadingEndpoints, setLoadingEndpoints] = useState(false)
  const [selectedEndpointId, setSelectedEndpointId] = useState<string>('')

  // ── Data fetching ──────────────────────────────────────────────────────────

  const fetchAll = useCallback(async () => {
    setLoading(true)
    try {
      const headers = { Authorization: `Bearer ${getAuthToken()}` }
      const [serversRes, settingsRes] = await Promise.all([
        fetch(`${API_URL}/admin/api-servers`, { headers }),
        fetch(`${API_URL}/organizations/subscription-settings`, { headers }),
      ])
      if (serversRes.ok) setApiServers(await serversRes.json())
      if (settingsRes.ok) {
        const data: Settings = await settingsRes.json()
        setSettings(data)
        setSelectedServerId(data.api_server_id ? String(data.api_server_id) : '')
        if (data.api_endpoint) {
          const parts = data.api_endpoint.split(' ')
          if (parts.length >= 2) {
            setHttpMethod(parts[0])
            setEndpointPath(parts.slice(1).join(' '))
          } else {
            setEndpointPath(data.api_endpoint)
          }
        }
        setMappings(data.post_create_field_map || [])
      }
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!user || user.role !== 'admin') { router.push('/dashboard'); return }
    fetchAll()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch parsed spec endpoints whenever the selected server changes
  useEffect(() => {
    if (!selectedServerId) {
      setServerEndpoints([])
      setSelectedEndpointId('')
      return
    }
    setLoadingEndpoints(true)
    setSelectedEndpointId('')
    fetch(`${API_URL}/admin/api-servers/${selectedServerId}/endpoints`, {
      headers: { Authorization: `Bearer ${getAuthToken()}` },
    })
      .then(r => r.ok ? r.json() : [])
      .then((eps: ApiEndpoint[]) => setServerEndpoints(eps))
      .catch(() => setServerEndpoints([]))
      .finally(() => setLoadingEndpoints(false))
  }, [selectedServerId])

  // When saved settings load (or server changes), try to match saved endpoint
  useEffect(() => {
    if (!serverEndpoints.length || !endpointPath) return
    const currentFull = `${httpMethod} ${endpointPath}`.trim()
    const match = serverEndpoints.find(
      ep => `${ep.method} ${ep.path}`.toLowerCase() === currentFull.toLowerCase()
    )
    if (match) setSelectedEndpointId(String(match.id))
  }, [serverEndpoints]) // eslint-disable-line react-hooks/exhaustive-deps

  const flash = (type: 'success' | 'error', text: string) => {
    setMsg({ type, text })
    setTimeout(() => setMsg(null), 5000)
  }

  // ── Endpoint selection: auto-fill method, path and field mappings ──────────

  function handleEndpointSelect(epIdStr: string) {
    setSelectedEndpointId(epIdStr)
    if (!epIdStr) return

    const ep = serverEndpoints.find(e => String(e.id) === epIdStr)
    if (!ep) return

    // Set method + path
    setHttpMethod(ep.method.toUpperCase())
    setEndpointPath(ep.path)

    // Auto-populate field mappings from the endpoint's fields (keep existing source_key if same key)
    if (ep.fields && ep.fields.length > 0) {
      const existing = Object.fromEntries(mappings.map(m => [m.form_key, m.source_key]))
      setMappings(
        ep.fields.map(f => ({
          form_key: f.key,
          source_key: existing[f.key] || '',
        }))
      )
    }
  }

  // ── Mapping row helpers ────────────────────────────────────────────────────

  function addMapping() {
    setMappings(m => [...m, { form_key: '', source_key: '' }])
  }

  function removeMapping(i: number) {
    setMappings(m => m.filter((_, idx) => idx !== i))
  }

  function updateMapping(i: number, field: keyof FieldMapping, value: string) {
    setMappings(m => m.map((row, idx) => idx === i ? { ...row, [field]: value } : row))
  }

  // ── Save ──────────────────────────────────────────────────────────────────

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    try {
      const api_endpoint = endpointPath.trim()
        ? `${httpMethod} ${endpointPath.trim()}`
        : null

      const body = {
        api_server_id: selectedServerId ? parseInt(selectedServerId) : null,
        api_endpoint,
        post_create_field_map: mappings.filter(m => m.form_key.trim() && m.source_key),
      }

      const res = await fetch(`${API_URL}/organizations/subscription-settings`, {
        method: 'PUT',
        headers: authHeaders(),
        body: JSON.stringify(body),
      })

      if (res.ok) {
        flash('success', 'Subscription API settings saved.')
        fetchAll()
      } else {
        const d = await res.json().catch(() => null)
        flash('error', d?.detail || 'Save failed.')
      }
    } finally {
      setSaving(false)
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-gray-50">
      <MainHeader user={user!} />
      <AdminNav />
      <main className="ml-0 md:ml-60 pt-14 p-6 pb-16 md:pb-0">
        <div className="max-w-3xl mx-auto">

          {/* Header */}
          <div className="mb-6">
            <h1 className="text-2xl font-bold text-gray-900">Subscription API Integration</h1>
            <p className="text-sm text-gray-500 mt-1">
              When a new subscription is created (via CloudPanel deployment or linking an existing site),
              the system will automatically call the configured remote API with the mapped field values.
            </p>
          </div>

          {/* Flash */}
          {msg && (
            <div className={`mb-4 px-4 py-3 rounded-xl text-sm font-medium flex items-center gap-2 ${
              msg.type === 'success'
                ? 'bg-green-50 border border-green-200 text-green-800'
                : 'bg-red-50 border border-red-200 text-red-800'
            }`}>
              {msg.type === 'success' ? '✅' : '❌'} {msg.text}
            </div>
          )}

          {loading ? (
            <div className="text-center py-20 text-gray-400">Loading…</div>
          ) : (
            <form onSubmit={handleSave} className="space-y-6">

              {/* ── API Server ─────────────────────────────────────────────── */}
              <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6">
                <h2 className="text-sm font-semibold text-gray-700 mb-4 flex items-center gap-2">
                  🔌 Remote API Server
                </h2>

                {apiServers.length === 0 ? (
                  <div className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
                    No API servers configured.{' '}
                    <a href="/admin/api-servers" className="underline font-semibold">Add one here</a> first.
                  </div>
                ) : (
                  <div className="space-y-4">
                    {/* Server picker */}
                    <div>
                      <label className="block text-xs font-semibold text-gray-600 mb-1">API Server</label>
                      <select
                        value={selectedServerId}
                        onChange={e => {
                          setSelectedServerId(e.target.value)
                          // Reset endpoint when server changes
                          setHttpMethod('POST')
                          setEndpointPath('')
                          setSelectedEndpointId('')
                        }}
                        className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      >
                        <option value="">— Disabled (no remote API call) —</option>
                        {apiServers.map(s => (
                          <option key={s.id} value={String(s.id)}>
                            {s.name} — {s.base_url}
                          </option>
                        ))}
                      </select>
                      {selectedServerId && (
                        <p className="text-xs text-gray-400 mt-1">
                          Make sure your user has credentials configured for this server under{' '}
                          <a href="/admin/api-servers" className="text-blue-500 hover:underline">API Servers</a>.
                        </p>
                      )}
                    </div>

                    {/* Endpoint picker (from parsed spec) */}
                    {selectedServerId && (
                      <div>
                        <label className="block text-xs font-semibold text-gray-600 mb-1">
                          API Endpoint
                          <span className="font-normal text-gray-400 ml-1">(method + path on the remote server)</span>
                        </label>

                        {loadingEndpoints ? (
                          <div className="text-xs text-gray-400 py-2">Loading endpoints…</div>
                        ) : serverEndpoints.length > 0 ? (
                          <>
                            {/* Dropdown of parsed spec endpoints */}
                            <select
                              value={selectedEndpointId}
                              onChange={e => handleEndpointSelect(e.target.value)}
                              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500 mb-2"
                            >
                              <option value="">— pick an endpoint —</option>
                              {serverEndpoints.map(ep => (
                                <option key={ep.id} value={String(ep.id)}>
                                  {ep.method.toUpperCase()} {ep.path}
                                  {ep.summary ? `  •  ${ep.summary}` : ''}
                                  {ep.fields?.length ? `  (${ep.fields.length} fields)` : ''}
                                </option>
                              ))}
                            </select>

                            {/* Still show the editable method + path in case they want to override */}
                            <div className="flex gap-2">
                              <select
                                value={httpMethod}
                                onChange={e => setHttpMethod(e.target.value)}
                                className="border border-gray-200 rounded-xl px-3 py-2 text-sm font-mono font-semibold text-blue-700 bg-blue-50 focus:outline-none focus:ring-2 focus:ring-blue-500 w-28"
                              >
                                {HTTP_METHODS.map(m => <option key={m}>{m}</option>)}
                              </select>
                              <input
                                value={endpointPath}
                                onChange={e => { setEndpointPath(e.target.value); setSelectedEndpointId('') }}
                                placeholder="/api/v1/subscriptions"
                                className="flex-1 border border-gray-200 rounded-xl px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
                              />
                            </div>
                            <p className="text-xs text-gray-400 mt-1">
                              Selecting an endpoint above auto-fills the path and field mappings from the uploaded spec.
                            </p>
                          </>
                        ) : (
                          <>
                            {/* No spec — manual entry */}
                            <div className="flex gap-2">
                              <select
                                value={httpMethod}
                                onChange={e => setHttpMethod(e.target.value)}
                                className="border border-gray-200 rounded-xl px-3 py-2 text-sm font-mono font-semibold text-blue-700 bg-blue-50 focus:outline-none focus:ring-2 focus:ring-blue-500 w-28"
                              >
                                {HTTP_METHODS.map(m => <option key={m}>{m}</option>)}
                              </select>
                              <input
                                value={endpointPath}
                                onChange={e => setEndpointPath(e.target.value)}
                                placeholder="/api/v1/subscriptions"
                                className="flex-1 border border-gray-200 rounded-xl px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
                              />
                            </div>
                            <p className="text-xs text-gray-400 mt-1">
                              No spec uploaded for this server. Path relative to the server base URL, e.g.{' '}
                              <code className="bg-gray-100 px-1 rounded">/api/v1/subscriptions</code>.
                              Upload a spec under <a href="/admin/api-servers" className="text-blue-500 hover:underline">API Servers</a> to auto-populate fields.
                            </p>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* ── Field Mapping ──────────────────────────────────────────── */}
              {selectedServerId && (
                <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6">
                  <div className="flex items-center justify-between mb-4">
                    <div>
                      <h2 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
                        🗂 Field Mapping
                      </h2>
                      <p className="text-xs text-gray-400 mt-0.5">
                        Map remote API field names (left) to local data sources (right).
                        {selectedEndpointId && serverEndpoints.length > 0 && (
                          <span className="ml-1 text-blue-500">Fields auto-populated from spec — just pick a source for each.</span>
                        )}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={addMapping}
                      className="px-3 py-1.5 bg-blue-50 text-blue-700 rounded-lg text-xs font-semibold hover:bg-blue-100"
                    >
                      + Add Field
                    </button>
                  </div>

                  {mappings.length === 0 ? (
                    <div className="text-center py-8 text-gray-400 text-sm border-2 border-dashed border-gray-200 rounded-xl">
                      {serverEndpoints.length > 0
                        ? <>Select an endpoint above to auto-populate fields, or click <span className="font-semibold">+ Add Field</span>.</>
                        : <>No field mappings yet. Click <span className="font-semibold">+ Add Field</span> to start.</>
                      }
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {/* Header row */}
                      <div className="grid grid-cols-[1fr_auto_1fr_auto] gap-2 px-1">
                        <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Remote API Field</span>
                        <span />
                        <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Local Source</span>
                        <span />
                      </div>

                      {mappings.map((row, i) => {
                        // Find the spec field metadata (type, required) for display
                        const specField = serverEndpoints
                          .find(ep => String(ep.id) === selectedEndpointId)
                          ?.fields?.find(f => f.key === row.form_key)

                        return (
                          <div key={i} className="grid grid-cols-[1fr_auto_1fr_auto] gap-2 items-center">
                            {/* Remote field name */}
                            <div className="relative">
                              <input
                                value={row.form_key}
                                onChange={e => updateMapping(i, 'form_key', e.target.value)}
                                placeholder="e.g. company_name"
                                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
                              />
                              {specField && (
                                <div className="flex gap-1 mt-0.5">
                                  {specField.type && (
                                    <span className="text-[10px] bg-gray-100 text-gray-500 px-1 rounded font-mono">{specField.type}</span>
                                  )}
                                  {specField.required && (
                                    <span className="text-[10px] bg-red-50 text-red-500 px-1 rounded">required</span>
                                  )}
                                </div>
                              )}
                            </div>

                            {/* Arrow */}
                            <span className="text-gray-400 text-sm select-none self-start mt-2">→</span>

                            {/* Local source dropdown */}
                            <div>
                              <select
                                value={row.source_key}
                                onChange={e => updateMapping(i, 'source_key', e.target.value)}
                                className={`w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                                  !row.source_key && specField?.required
                                    ? 'border-amber-300 bg-amber-50'
                                    : 'border-gray-200'
                                }`}
                              >
                                <option value="">— pick a source —</option>
                                {SOURCE_FIELDS.map(group => (
                                  <optgroup key={group.group} label={group.group}>
                                    {group.options.map(opt => (
                                      <option key={opt.value} value={opt.value}>
                                        {opt.label}
                                      </option>
                                    ))}
                                  </optgroup>
                                ))}
                              </select>
                            </div>

                            {/* Remove */}
                            <button
                              type="button"
                              onClick={() => removeMapping(i)}
                              className="text-red-400 hover:text-red-600 text-lg leading-none px-1 self-start mt-1.5"
                              title="Remove"
                            >
                              ×
                            </button>
                          </div>
                        )
                      })}
                    </div>
                  )}

                  {/* Preview */}
                  {mappings.some(m => m.form_key && m.source_key) && (
                    <div className="mt-4 bg-gray-50 rounded-xl p-4 border border-gray-100">
                      <p className="text-xs font-semibold text-gray-500 mb-2">Preview — JSON sent to remote API:</p>
                      <pre className="text-xs text-gray-700 font-mono whitespace-pre-wrap">
                        {JSON.stringify(
                          Object.fromEntries(
                            mappings
                              .filter(m => m.form_key && m.source_key)
                              .map(m => [m.form_key, `<${m.source_key}>`])
                          ),
                          null, 2
                        )}
                      </pre>
                    </div>
                  )}
                </div>
              )}

              {/* ── How it works ───────────────────────────────────────────── */}
              <div className="bg-blue-50 border border-blue-100 rounded-2xl p-4 text-sm text-blue-800">
                <p className="font-semibold mb-1">💡 How it works</p>
                <ol className="list-decimal list-inside space-y-1 text-blue-700">
                  <li>Admin creates a new subscription (<strong>Deploy New Site</strong> or <strong>Link Existing Site</strong>) on an organization</li>
                  <li>Subscription is created locally in the system</li>
                  <li>The system calls <strong>{selectedServerId ? `${httpMethod} ${endpointPath || '/your/endpoint'}` : 'your configured endpoint'}</strong> on the remote API</li>
                  <li>Field mappings are resolved and sent as a JSON body</li>
                  <li>If the call fails, a <strong>Retry Sync</strong> button appears on the subscription row</li>
                </ol>
                <p className="mt-2 text-xs text-blue-600">
                  The remote API call uses the credentials you configured under{' '}
                  <a href="/admin/api-servers" className="underline">API Servers</a> for your user account.
                  Upload an OpenAPI/Postman spec for the server to enable endpoint and field auto-population.
                </p>
              </div>

              {/* Save button */}
              <div className="flex justify-end pb-4">
                <button
                  type="submit"
                  disabled={saving}
                  className="px-6 py-2.5 bg-blue-600 text-white rounded-xl text-sm font-semibold hover:bg-blue-700 disabled:opacity-50 shadow"
                >
                  {saving ? 'Saving…' : 'Save Settings'}
                </button>
              </div>

            </form>
          )}
        </div>
      </main>
    </div>
  )
}
