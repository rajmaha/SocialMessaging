'use client'

import { useState, useEffect, useRef } from 'react'
import { useEmailCompose } from '@/lib/email-compose-context'
import { X, Minus, Maximize2, Paperclip, Send, ChevronDown } from 'lucide-react'
import axios from 'axios'
import { API_URL } from '@/lib/config'
import { getAuthToken } from '@/lib/auth'

interface EmailAccount {
  id: number
  email_address: string
  provider: string
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export default function EmailComposePopover() {
  const { isOpen, prefillTo, closeCompose } = useEmailCompose()

  const [minimized, setMinimized] = useState(false)
  const [to, setTo] = useState('')
  const [cc, setCc] = useState('')
  const [bcc, setBcc] = useState('')
  const [showCcBcc, setShowCcBcc] = useState(false)
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [attachments, setAttachments] = useState<File[]>([])
  const [accounts, setAccounts] = useState<EmailAccount[]>([])
  const [selectedAccountId, setSelectedAccountId] = useState<number | null>(null)
  const [sending, setSending] = useState(false)

  const fileInputRef = useRef<HTMLInputElement>(null)

  // Fetch email accounts on mount
  useEffect(() => {
    if (!isOpen) return
    const fetchAccounts = async () => {
      try {
        const token = getAuthToken()
        if (!token) return
        const res = await axios.get(`${API_URL}/email/accounts`, {
          headers: { Authorization: `Bearer ${token}` },
        })
        setAccounts(res.data)
        if (res.data.length > 0 && selectedAccountId === null) {
          setSelectedAccountId(res.data[0].id)
        }
      } catch (err) {
        console.error('Failed to fetch email accounts', err)
      }
    }
    fetchAccounts()
  }, [isOpen])

  // Pre-fill "to" field when context value changes
  useEffect(() => {
    if (prefillTo) {
      setTo(prefillTo)
    }
  }, [prefillTo])

  // Reset form when popover closes
  useEffect(() => {
    if (!isOpen) {
      setTo('')
      setCc('')
      setBcc('')
      setShowCcBcc(false)
      setSubject('')
      setBody('')
      setAttachments([])
      setMinimized(false)
    }
  }, [isOpen])

  const handleAttach = () => {
    fileInputRef.current?.click()
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      setAttachments(prev => [...prev, ...Array.from(e.target.files!)])
    }
    // Reset input so the same file can be re-selected
    e.target.value = ''
  }

  const removeAttachment = (index: number) => {
    setAttachments(prev => prev.filter((_, i) => i !== index))
  }

  const handleSend = async () => {
    if (!to.trim()) {
      alert('Please enter a recipient email address.')
      return
    }

    const token = getAuthToken()
    if (!token) {
      alert('You are not authenticated.')
      return
    }

    setSending(true)
    try {
      await axios.post(
        `${API_URL}/email/send`,
        {
          to_address: to.trim(),
          subject: subject.trim(),
          body,
          cc: cc.trim() || null,
          bcc: bcc.trim() || null,
        },
        { headers: { Authorization: `Bearer ${token}` } }
      )
      alert('Email sent successfully!')
      closeCompose()
    } catch (error: any) {
      console.error('Error sending email:', error)
      alert(error?.response?.data?.detail || 'Failed to send email.')
    } finally {
      setSending(false)
    }
  }

  if (!isOpen) return null

  return (
    <div
      className="fixed bottom-6 right-6 z-50 flex flex-col rounded-lg shadow-2xl border border-gray-200 bg-white overflow-hidden"
      style={{ width: 500 }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 bg-gray-800 text-white cursor-pointer select-none">
        <span className="text-sm font-medium">New Message</span>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setMinimized(prev => !prev)}
            className="p-1 hover:bg-gray-700 rounded"
            title={minimized ? 'Expand' : 'Minimize'}
          >
            {minimized ? <Maximize2 size={16} /> : <Minus size={16} />}
          </button>
          <button
            onClick={closeCompose}
            className="p-1 hover:bg-gray-700 rounded"
            title="Close"
          >
            <X size={16} />
          </button>
        </div>
      </div>

      {/* Body — hidden when minimized */}
      {!minimized && (
        <div className="flex flex-col">
          {/* To field */}
          <div className="flex items-center border-b border-gray-200 px-4 py-2">
            <label className="text-sm text-gray-500 w-12 shrink-0">To</label>
            <input
              type="email"
              value={to}
              onChange={e => setTo(e.target.value)}
              className="flex-1 text-sm outline-none bg-transparent"
              placeholder="recipient@example.com"
            />
            {!showCcBcc && (
              <button
                onClick={() => setShowCcBcc(true)}
                className="text-xs text-blue-600 hover:underline ml-2 whitespace-nowrap"
              >
                CC/BCC
              </button>
            )}
          </div>

          {/* CC field */}
          {showCcBcc && (
            <div className="flex items-center border-b border-gray-200 px-4 py-2">
              <label className="text-sm text-gray-500 w-12 shrink-0">CC</label>
              <input
                type="text"
                value={cc}
                onChange={e => setCc(e.target.value)}
                className="flex-1 text-sm outline-none bg-transparent"
                placeholder="cc@example.com"
              />
            </div>
          )}

          {/* BCC field */}
          {showCcBcc && (
            <div className="flex items-center border-b border-gray-200 px-4 py-2">
              <label className="text-sm text-gray-500 w-12 shrink-0">BCC</label>
              <input
                type="text"
                value={bcc}
                onChange={e => setBcc(e.target.value)}
                className="flex-1 text-sm outline-none bg-transparent"
                placeholder="bcc@example.com"
              />
            </div>
          )}

          {/* Subject field */}
          <div className="flex items-center border-b border-gray-200 px-4 py-2">
            <label className="text-sm text-gray-500 w-12 shrink-0">Subj</label>
            <input
              type="text"
              value={subject}
              onChange={e => setSubject(e.target.value)}
              className="flex-1 text-sm outline-none bg-transparent"
              placeholder="Subject"
            />
          </div>

          {/* Body */}
          <textarea
            value={body}
            onChange={e => setBody(e.target.value)}
            className="px-4 py-3 text-sm outline-none resize-none border-b border-gray-200"
            rows={10}
            placeholder="Write your message..."
          />

          {/* Attachments list */}
          {attachments.length > 0 && (
            <div className="px-4 py-2 flex flex-wrap gap-2 border-b border-gray-200">
              {attachments.map((file, i) => (
                <div
                  key={i}
                  className="flex items-center gap-1 bg-gray-100 rounded px-2 py-1 text-xs text-gray-700"
                >
                  <span className="max-w-[140px] truncate">{file.name}</span>
                  <span className="text-gray-400">({formatFileSize(file.size)})</span>
                  <button
                    onClick={() => removeAttachment(i)}
                    className="ml-1 text-gray-400 hover:text-red-500"
                  >
                    <X size={12} />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Footer: account selector, attach, send */}
          <div className="flex items-center justify-between px-4 py-2">
            <div className="flex items-center gap-2">
              <button
                onClick={handleSend}
                disabled={sending}
                className="flex items-center gap-1.5 bg-blue-600 text-white text-sm font-medium px-4 py-1.5 rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Send size={14} />
                {sending ? 'Sending...' : 'Send'}
              </button>

              {/* Account selector */}
              {accounts.length > 1 && (
                <div className="relative">
                  <select
                    value={selectedAccountId ?? ''}
                    onChange={e => setSelectedAccountId(Number(e.target.value))}
                    className="text-xs border border-gray-300 rounded px-2 py-1 bg-white text-gray-600 outline-none focus:ring-1 focus:ring-blue-400"
                  >
                    {accounts.map(acc => (
                      <option key={acc.id} value={acc.id}>
                        {acc.email_address}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              {accounts.length === 1 && (
                <span className="text-xs text-gray-400">{accounts[0].email_address}</span>
              )}
            </div>

            <div className="flex items-center gap-1">
              <button
                onClick={handleAttach}
                className="p-1.5 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded"
                title="Attach files"
              >
                <Paperclip size={16} />
              </button>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                className="hidden"
                onChange={handleFileChange}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
