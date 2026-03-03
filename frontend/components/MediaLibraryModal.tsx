'use client'

import { useState, useEffect, useRef } from 'react'
import axios from 'axios'
import { getAuthToken } from '@/lib/auth'
import { API_URL } from '@/lib/config'

interface MediaItem {
  url: string       // relative path e.g. /attachments/messages/xxx.png
  filename: string  // display name
  size: number
  modified: number
}

interface MediaLibraryModalProps {
  open: boolean
  onClose: () => void
  onSelect: (absoluteUrl: string) => void
}

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export default function MediaLibraryModal({ open, onClose, onSelect }: MediaLibraryModalProps) {
  const [tab, setTab] = useState<'library' | 'upload'>('library')
  const [images, setImages] = useState<MediaItem[]>([])
  const [loading, setLoading] = useState(false)
  const [selected, setSelected] = useState<MediaItem | null>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)
  const token = getAuthToken()

  const absoluteUrl = (rel: string) =>
    rel.startsWith('http') ? rel : `${API_URL}${rel}`

  const fetchLibrary = async () => {
    setLoading(true)
    try {
      const res = await axios.get(`${API_URL}/messages/media-library`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      setImages(res.data)
    } catch {
      setImages([])
    }
    setLoading(false)
  }

  useEffect(() => {
    if (open) {
      setSelected(null)
      setUploadError('')
      fetchLibrary()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    setUploadError('')
    try {
      const fd = new FormData()
      fd.append('file', file)
      const res = await axios.post(`${API_URL}/messages/upload-attachment`, fd, {
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'multipart/form-data' },
      })
      // Auto-select and switch to library view
      await fetchLibrary()
      setTab('library')
      // Find the just-uploaded item and select it
      const newItem: MediaItem = {
        url: res.data.url,
        filename: res.data.filename,
        size: res.data.size,
        modified: Date.now() / 1000,
      }
      setSelected(newItem)
    } catch (err: any) {
      setUploadError(err.response?.data?.detail || 'Upload failed')
    }
    setUploading(false)
    if (fileRef.current) fileRef.current.value = ''
  }

  const handleInsert = () => {
    if (!selected) return
    onSelect(absoluteUrl(selected.url))
    onClose()
  }

  if (!open) return null

  return (
    <div
      className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[85vh] flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Media Library</h2>
            <p className="text-xs text-gray-400 mt-0.5">Choose an image or upload a new one.</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">&times;</button>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 px-6 pt-3 border-b">
          {(['library', 'upload'] as const).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-4 py-2 text-sm font-medium rounded-t-lg border-b-2 -mb-px transition-colors ${
                tab === t
                  ? 'border-indigo-600 text-indigo-700'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              {t === 'library' ? `📁 Library (${images.length})` : '⬆ Upload New'}
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="flex flex-1 overflow-hidden">
          {/* Left: grid or upload */}
          <div className="flex-1 overflow-y-auto p-5">
            {tab === 'library' ? (
              loading ? (
                <div className="flex justify-center py-16">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-500" />
                </div>
              ) : images.length === 0 ? (
                <div className="text-center py-16 text-gray-400">
                  <p className="text-4xl mb-3">📭</p>
                  <p>No images yet. Switch to Upload to add your first one.</p>
                </div>
              ) : (
                <div className="grid grid-cols-4 gap-3">
                  {images.map(img => (
                    <button
                      key={img.url}
                      type="button"
                      onClick={() => setSelected(img)}
                      className={`rounded-xl border-2 overflow-hidden transition-all text-left ${
                        selected?.url === img.url
                          ? 'border-indigo-500 shadow-md ring-2 ring-indigo-200'
                          : 'border-gray-200 hover:border-indigo-300 hover:shadow'
                      }`}
                    >
                      <div className="h-24 bg-gray-100 overflow-hidden flex items-center justify-center">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={absoluteUrl(img.url)}
                          alt={img.filename}
                          className="w-full h-full object-cover"
                          onError={e => {
                            (e.target as HTMLImageElement).src = ''
                            ;(e.target as HTMLImageElement).style.display = 'none'
                          }}
                        />
                      </div>
                      <div className="p-2">
                        <p className="text-xs text-gray-700 truncate font-medium">{img.filename}</p>
                        <p className="text-xs text-gray-400">{formatSize(img.size)}</p>
                      </div>
                    </button>
                  ))}
                </div>
              )
            ) : (
              /* Upload tab */
              <div className="flex flex-col items-center justify-center h-full gap-4 py-8">
                {uploadError && (
                  <div className="w-full max-w-sm p-3 bg-red-50 border border-red-200 rounded text-red-700 text-sm">{uploadError}</div>
                )}
                <div
                  className="w-full max-w-sm border-2 border-dashed border-gray-300 rounded-xl p-10 flex flex-col items-center gap-3 cursor-pointer hover:border-indigo-400 hover:bg-indigo-50 transition-colors"
                  onClick={() => fileRef.current?.click()}
                >
                  <span className="text-4xl">🖼</span>
                  <p className="text-sm font-medium text-gray-600">Click to choose an image</p>
                  <p className="text-xs text-gray-400">JPG, PNG, GIF, WebP, SVG</p>
                </div>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handleUpload}
                  disabled={uploading}
                />
                {uploading && (
                  <div className="flex items-center gap-2 text-sm text-indigo-600">
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-indigo-600" />
                    Uploading…
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Right: preview pane */}
          {selected && (
            <div className="w-56 border-l bg-gray-50 flex flex-col flex-shrink-0">
              <div className="flex-1 overflow-hidden p-3 flex items-center justify-center bg-gray-100">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={absoluteUrl(selected.url)}
                  alt={selected.filename}
                  className="max-w-full max-h-48 object-contain rounded shadow"
                />
              </div>
              <div className="p-3 border-t bg-white">
                <p className="text-xs font-medium text-gray-800 truncate">{selected.filename}</p>
                <p className="text-xs text-gray-400 mb-3">{formatSize(selected.size)}</p>
                <button
                  type="button"
                  onClick={handleInsert}
                  className="w-full py-2 bg-indigo-600 text-white rounded-lg text-sm font-semibold hover:bg-indigo-700 transition-colors"
                >
                  Insert Image →
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t flex justify-end bg-gray-50">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 border border-gray-300 rounded-lg text-sm text-gray-600 hover:bg-gray-100"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
