'use client'

import { useState, useEffect } from 'react'
import axios from 'axios'
import { getAuthToken } from '@/lib/auth'
import { API_URL } from '@/lib/config'

interface Template {
  id: number
  name: string
  category: string
  is_preset: boolean
  body_html: string
}

const CATEGORY_LABELS: Record<string, string> = {
  newsletter: 'Newsletter',
  promotional: 'Promotional',
  welcome: 'Welcome',
  followup: 'Follow-up',
}

const CATEGORY_COLORS: Record<string, string> = {
  newsletter: 'bg-indigo-100 text-indigo-700',
  promotional: 'bg-purple-100 text-purple-700',
  welcome: 'bg-green-100 text-green-700',
  followup: 'bg-blue-100 text-blue-700',
}

interface Props {
  onSelect: (html: string) => void
  trigger?: React.ReactNode
}

export default function EmailTemplateGallery({ onSelect, trigger }: Props) {
  const [open, setOpen] = useState(false)
  const [templates, setTemplates] = useState<Template[]>([])
  const [tab, setTab] = useState<'presets' | 'custom'>('presets')
  const [loading, setLoading] = useState(false)
  const [preview, setPreview] = useState<Template | null>(null)

  const fetchTemplates = async () => {
    setLoading(true)
    try {
      const res = await axios.get(`${API_URL}/email-templates/`, {
        headers: { Authorization: `Bearer ${getAuthToken()}` },
      })
      setTemplates(res.data)
    } catch {}
    setLoading(false)
  }

  useEffect(() => {
    if (open) fetchTemplates()
  }, [open])

  const presets = templates.filter(t => t.is_preset)
  const custom = templates.filter(t => !t.is_preset)
  const displayed = tab === 'presets' ? presets : custom

  const handleSelect = (t: Template) => {
    onSelect(t.body_html)
    setOpen(false)
    setPreview(null)
  }

  return (
    <>
      {/* Trigger */}
      <div onClick={() => setOpen(true)} className="inline-block cursor-pointer">
        {trigger ?? (
          <button
            type="button"
            className="px-4 py-2 border border-indigo-300 text-indigo-700 bg-indigo-50 rounded-lg text-sm hover:bg-indigo-100 font-medium transition-colors"
          >
            📨 Choose Template
          </button>
        )}
      </div>

      {/* Modal */}
      {open && (
        <div
          className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
          onClick={() => setOpen(false)}
        >
          <div
            className="bg-white rounded-2xl shadow-2xl w-full max-w-5xl max-h-[90vh] flex flex-col overflow-hidden"
            onClick={e => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">Choose Email Template</h2>
                <p className="text-xs text-gray-400 mt-0.5">Pick a template to pre-fill the editor, then customise it.</p>
              </div>
              <button onClick={() => setOpen(false)} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">&times;</button>
            </div>

            {/* Tabs */}
            <div className="flex gap-1 px-6 pt-4 border-b">
              {(['presets', 'custom'] as const).map(t => (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  className={`px-4 py-2 text-sm font-medium rounded-t-lg border-b-2 -mb-px transition-colors ${
                    tab === t
                      ? 'border-indigo-600 text-indigo-700'
                      : 'border-transparent text-gray-500 hover:text-gray-700'
                  }`}
                >
                  {t === 'presets' ? `Presets (${presets.length})` : `My Templates (${custom.length})`}
                </button>
              ))}
              <div className="ml-auto pb-2">
                <a href="/admin/email-templates/new" target="_blank" className="text-xs text-indigo-600 hover:underline">
                  + Create new template
                </a>
              </div>
            </div>

            {/* Body */}
            <div className="flex flex-1 overflow-hidden">
              {/* Grid */}
              <div className="flex-1 overflow-y-auto p-6">
                {loading ? (
                  <div className="flex justify-center py-16">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-500" />
                  </div>
                ) : displayed.length === 0 ? (
                  <div className="text-center py-16 text-gray-400">
                    <p className="text-4xl mb-3">📭</p>
                    <p>{tab === 'custom' ? 'No custom templates yet.' : 'No presets found.'}</p>
                    {tab === 'custom' && (
                      <a href="/admin/email-templates/new" target="_blank" className="mt-3 inline-block text-indigo-600 text-sm hover:underline">
                        Create your first template →
                      </a>
                    )}
                  </div>
                ) : (
                  <div className="grid grid-cols-3 gap-4">
                    {displayed.map(t => (
                      <div
                        key={t.id}
                        onClick={() => setPreview(t)}
                        className={`rounded-xl border-2 cursor-pointer transition-all overflow-hidden ${
                          preview?.id === t.id
                            ? 'border-indigo-500 shadow-md'
                            : 'border-gray-200 hover:border-indigo-300 hover:shadow'
                        }`}
                      >
                        {/* Scaled thumbnail */}
                        <div className="h-40 bg-gray-50 overflow-hidden relative">
                          <iframe
                            srcDoc={t.body_html}
                            sandbox="allow-same-origin"
                            className="w-full border-none pointer-events-none"
                            style={{
                              height: '600px',
                              transform: 'scale(0.27)',
                              transformOrigin: 'top left',
                              width: '370%',
                            }}
                            title={t.name}
                          />
                        </div>
                        <div className="p-3">
                          <p className="font-medium text-sm text-gray-900 truncate">{t.name}</p>
                          <div className="flex items-center justify-between mt-1">
                            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${CATEGORY_COLORS[t.category] || 'bg-gray-100 text-gray-600'}`}>
                              {CATEGORY_LABELS[t.category] || t.category}
                            </span>
                            {t.is_preset && <span className="text-xs text-gray-400">Preset</span>}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Preview pane */}
              {preview && (
                <div className="w-80 border-l bg-gray-50 flex flex-col flex-shrink-0">
                  <div className="px-4 py-3 border-b bg-white">
                    <p className="font-semibold text-sm text-gray-900">{preview.name}</p>
                    <p className="text-xs text-gray-400 capitalize">{CATEGORY_LABELS[preview.category] || preview.category}</p>
                  </div>
                  <div className="flex-1 overflow-hidden p-2">
                    <iframe
                      srcDoc={preview.body_html}
                      sandbox="allow-same-origin"
                      className="w-full h-full border-none rounded"
                      title={`Preview: ${preview.name}`}
                    />
                  </div>
                  <div className="p-4 border-t bg-white">
                    <button
                      onClick={() => handleSelect(preview)}
                      className="w-full py-2.5 bg-indigo-600 text-white rounded-lg text-sm font-semibold hover:bg-indigo-700 transition-colors"
                    >
                      Use This Template →
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="px-6 py-3 border-t flex justify-between items-center bg-gray-50">
              <button
                type="button"
                onClick={() => { onSelect('<p></p>'); setOpen(false) }}
                className="text-sm text-gray-500 hover:text-gray-700"
              >
                Start with blank email
              </button>
              <button
                onClick={() => setOpen(false)}
                className="px-4 py-2 border border-gray-300 rounded-lg text-sm text-gray-600 hover:bg-gray-100"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
