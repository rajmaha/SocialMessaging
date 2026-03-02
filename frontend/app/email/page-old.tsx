'use client'

import React, { useState, useEffect } from 'react'
import axios from 'axios'
import Link from 'next/link'
import { useBranding } from '@/lib/branding-context'
import { API_URL } from '@/lib/config';

interface EmailAccount {
  id: number
  email_address: string
  account_name: string
  display_name?: string
  is_active: boolean
  last_sync?: string
}

interface Email {
  id: number
  thread_id?: number
  subject: string
  from_address: string
  to_address: string
  cc?: string
  body_html?: string
  body_text?: string
  received_at: string
  is_read: boolean
  is_starred: boolean
  is_sent: boolean
  in_reply_to?: string
}

interface EmailThread {
  id: number
  subject: string
  from_address: string
  to_addresses: string
  has_unread: boolean
  is_archived: boolean
  is_starred: boolean
  reply_count: number
  first_email_at: string
  last_email_at: string
  emails: Email[]
}

export default function EmailPage() {
  const { branding } = useBranding()
  const [account, setAccount] = useState<EmailAccount | null>(null)
  const [threads, setThreads] = useState<EmailThread[]>([])
  const [selectedThread, setSelectedThread] = useState<EmailThread | null>(null)
  const [loading, setLoading] = useState(false)
  const [showCompose, setShowCompose] = useState(false)

  // Fetch email account
  useEffect(() => {
    fetchAccount()
  }, [])

  // Fetch emails when account loads
  useEffect(() => {
    if (account) {
      fetchEmails()
    }
  }, [account])

  const fetchAccount = async () => {
    try {
      const token = localStorage.getItem('token')
      const response = await axios.get(`${API_URL}/email/account`, {
        headers: { Authorization: `Bearer ${token}` }
      })
      setAccount(response.data)
    } catch (error: any) {
      if (error.response?.status === 404) {
        console.log('No email account configured')
      } else {
        console.error('Error fetching account:', error)
      }
    }
  }

  const fetchEmails = async () => {
    if (!account) return
    try {
      setLoading(true)
      const token = localStorage.getItem('token')
      const response = await axios.get(`${API_URL}/email/inbox?limit=50`, {
        headers: { Authorization: `Bearer ${token}` }
      })
      // For now, treat each email as a separate thread
      const threadedEmails = response.data.emails.map((email: Email) => ({
        id: email.thread_id || email.id,
        subject: email.subject,
        from_address: email.from_address,
        to_addresses: email.to_address,
        has_unread: !email.is_read,
        is_archived: false,
        is_starred: email.is_starred,
        reply_count: 0,
        first_email_at: email.received_at,
        last_email_at: email.received_at,
        emails: [email]
      }))
      setThreads(threadedEmails)
    } catch (error) {
      console.error('Error fetching emails:', error)
    } finally {
      setLoading(false)
    }
  }

  const syncEmails = async () => {
    if (!account) return

    try {
      setLoading(true)
      const token = localStorage.getItem('token')
      await axios.post(`${API_URL}/email/account/sync`, {}, {
        headers: { Authorization: `Bearer ${token}` }
      })
      await fetchEmails()
    } catch (error) {
      console.error('Error syncing emails:', error)
    } finally {
      setLoading(false)
    }
  }

  if (!branding) {
    return <div>Loading...</div>
  }

  if (!account) {
    return (
      <div className="h-screen flex items-center justify-center bg-gray-100">
        <div className="bg-white p-8 rounded-lg shadow text-center max-w-md">
          <h2 className="text-xl font-bold mb-2">📧 Email Not Configured</h2>
          <p className="text-gray-600 mb-4">
            Your administrator needs to configure an email account for you. 
            Please contact them to set up your email.
          </p>
          <Link href="/admin/email-accounts" className="text-blue-600 hover:underline">
            Go to Email Accounts Setup
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="h-screen bg-gray-100 flex flex-col">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 p-4 flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: branding.primary_color }}>
            📧 Email
          </h1>
          <p className="text-sm text-gray-600">{account.email_address}</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setShowCompose(true)}
            className="px-4 py-2 text-white rounded-lg hover:opacity-90"
            style={{ backgroundColor: branding.primary_color }}
          >
            ✏️ Compose
          </button>
          <button
            onClick={syncEmails}
            disabled={loading}
            className="px-4 py-2 rounded-lg hover:opacity-90 disabled:opacity-50"
            style={{ backgroundColor: branding.secondary_color, color: 'white' }}
          >
            🔄 Sync
          </button>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Thread List */}
        <div className="w-96 bg-white border-r border-gray-200 overflow-y-auto">
          <div className="sticky top-0 bg-white border-b border-gray-200 p-4">
            <h2 className="font-semibold">Inbox</h2>
            <p className="text-xs text-gray-500 mt-1">{threads.length} conversations</p>
          </div>

          {loading && threads.length === 0 ? (
            <div className="p-4 text-center text-gray-500">Loading emails...</div>
          ) : threads.length === 0 ? (
            <div className="p-4 text-center text-gray-500">No emails yet</div>
          ) : (
            <div className="divide-y">
              {threads.map((thread) => (
                <button
                  key={thread.id}
                  onClick={() => setSelectedThread(thread)}
                  className={`w-full text-left p-4 hover:bg-gray-50 transition ${
                    selectedThread?.id === thread.id ? 'bg-blue-50' : ''
                  } ${thread.has_unread ? 'font-semibold bg-blue-50' : ''}`}
                >
                  <div className="flex justify-between items-start gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">{thread.subject}</div>
                      <div className="text-xs text-gray-600 truncate">{thread.from_address}</div>
                      <div className="text-xs text-gray-500 mt-1">
                        {thread.reply_count > 0 && `${thread.reply_count} replies • `}
                        {new Date(thread.last_email_at).toLocaleDateString()}
                      </div>
                    </div>
                    <div className="flex gap-1">
                      {thread.is_starred && <span className="text-lg">⭐</span>}
                      {thread.has_unread && <span className="w-2 h-2 bg-blue-600 rounded-full mt-1"></span>}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Email Thread Details or Compose */}
        <div className="flex-1 bg-gray-50 overflow-y-auto">
          {showCompose ? (
            <ComposeEmail
              account={account}
              branding={branding}
              onClose={() => setShowCompose(false)}
              onSent={() => {
                fetchEmails()
                setShowCompose(false)
              }}
            />
          ) : selectedThread ? (
            <EmailThreadView
              thread={selectedThread}
              account={account}
              branding={branding}
              onReplySuccess={() => fetchEmails()}
            />
          ) : (
            <div className="h-full flex items-center justify-center text-gray-500">
              Select a conversation to read
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// Compose Email Component
function ComposeEmail({ account, branding, onClose, onSent }: any) {
  const [to, setTo] = useState('')
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [sending, setSending] = useState(false)

  const handleSend = async () => {
    if (!to || !subject) {
      alert('Please fill in To and Subject')
      return
    }

    try {
      setSending(true)
      const token = localStorage.getItem('token')
      await axios.post(`${API_URL}/email/send/${account.id}`, {
        to_address: to,
        subject,
        body
      }, {
        headers: { Authorization: `Bearer ${token}` }
      })
      onSent()
    } catch (error) {
      console.error('Error sending email:', error)
      alert('Failed to send email')
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="p-6">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-lg font-bold">Compose Email</h2>
        <button onClick={onClose} className="text-gray-500 hover:text-gray-700">✕</button>
      </div>

      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">From</label>
          <input
            type="email"
            value={account.email_address}
            disabled
            className="w-full px-3 py-2 border rounded-lg bg-gray-100"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">To</label>
          <input
            type="email"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            placeholder="recipient@example.com"
            className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2"
            style={{ focusRingColor: branding.primary_color }}
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Subject</label>
          <input
            type="text"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="Email subject"
            className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2"
            style={{ focusRingColor: branding.primary_color }}
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Message</label>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Write your email..."
            rows={10}
            className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2"
            style={{ focusRingColor: branding.primary_color }}
          />
        </div>

        <div className="flex gap-2">
          <button
            onClick={handleSend}
            disabled={sending}
            className="px-4 py-2 text-white rounded-lg hover:opacity-90 disabled:opacity-50"
            style={{ backgroundColor: branding.primary_color }}
          >
            {sending ? 'Sending...' : 'Send Email'}
          </button>
          <button
            onClick={onClose}
            className="px-4 py-2 border rounded-lg hover:bg-gray-50"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}

// Email Detail Component
function EmailDetail({ email, branding }: any) {
  return (
    <div className="p-6">
      <h2 className="text-2xl font-bold mb-4">{email.subject}</h2>

      <div className="bg-white rounded-lg p-4 mb-4 space-y-2 border">
        <div>
          <span className="text-sm text-gray-600">From:</span>
          <p className="font-medium">{email.from_address}</p>
        </div>
        <div>
          <span className="text-sm text-gray-600">To:</span>
          <p className="font-medium">{email.to_address}</p>
        </div>
        <div>
          <span className="text-sm text-gray-600">Date:</span>
          <p className="font-medium">{new Date(email.received_at).toLocaleString()}</p>
        </div>
      </div>

      <div className="bg-white rounded-lg p-4 border">
        <div
          className="prose max-w-none"
          dangerouslySetInnerHTML={{ __html: email.body_html || email.body_text || 'No content' }}
        />
      </div>
    </div>
  )
}

// Add Account Modal
function AddAccountModal({ branding, onClose, onAdded }: any) {
  const [loading, setLoading] = useState(false)
  const [formData, setFormData] = useState({
    email_address: '',
    account_name: '',
    display_name: '',
    imap_host: '',
    imap_port: 993,
    imap_username: '',
    imap_password: '',
    smtp_host: '',
    smtp_port: 587,
    smtp_username: '',
    smtp_password: ''
  })

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    try {
      setLoading(true)
      const token = localStorage.getItem('token')
      await axios.post(`${API_URL}/email/accounts`, formData, {
        headers: { Authorization: `Bearer ${token}` }
      })
      onAdded()
    } catch (error) {
      console.error('Error adding account:', error)
      alert('Failed to add email account')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-lg max-w-2xl w-full max-h-screen overflow-y-auto p-6">
        <h2 className="text-xl font-bold mb-4">Add Email Account</h2>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Email Address</label>
              <input
                type="email"
                required
                value={formData.email_address}
                onChange={(e) => setFormData({ ...formData, email_address: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg"
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">Account Name</label>
              <input
                type="text"
                required
                value={formData.account_name}
                onChange={(e) => setFormData({ ...formData, account_name: e.target.value })}
                placeholder="e.g., Personal, Work"
                className="w-full px-3 py-2 border rounded-lg"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Display Name</label>
            <input
              type="text"
              value={formData.display_name}
              onChange={(e) => setFormData({ ...formData, display_name: e.target.value })}
              placeholder="Your name for sending emails"
              className="w-full px-3 py-2 border rounded-lg"
            />
          </div>

          <div className="border-t pt-4">
            <h3 className="font-semibold mb-3">IMAP Settings</h3>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-1">IMAP Host</label>
                <input
                  type="text"
                  required
                  value={formData.imap_host}
                  onChange={(e) => setFormData({ ...formData, imap_host: e.target.value })}
                  placeholder="imap.gmail.com"
                  className="w-full px-3 py-2 border rounded-lg"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">IMAP Port</label>
                <input
                  type="number"
                  required
                  value={formData.imap_port}
                  onChange={(e) => setFormData({ ...formData, imap_port: parseInt(e.target.value) })}
                  className="w-full px-3 py-2 border rounded-lg"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">IMAP Username</label>
                <input
                  type="text"
                  required
                  value={formData.imap_username}
                  onChange={(e) => setFormData({ ...formData, imap_username: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">IMAP Password</label>
                <input
                  type="password"
                  required
                  value={formData.imap_password}
                  onChange={(e) => setFormData({ ...formData, imap_password: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg"
                />
              </div>
            </div>
          </div>

          <div className="border-t pt-4">
            <h3 className="font-semibold mb-3">SMTP Settings</h3>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-1">SMTP Host</label>
                <input
                  type="text"
                  required
                  value={formData.smtp_host}
                  onChange={(e) => setFormData({ ...formData, smtp_host: e.target.value })}
                  placeholder="smtp.gmail.com"
                  className="w-full px-3 py-2 border rounded-lg"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">SMTP Port</label>
                <input
                  type="number"
                  required
                  value={formData.smtp_port}
                  onChange={(e) => setFormData({ ...formData, smtp_port: parseInt(e.target.value) })}
                  className="w-full px-3 py-2 border rounded-lg"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">SMTP Username</label>
                <input
                  type="text"
                  required
                  value={formData.smtp_username}
                  onChange={(e) => setFormData({ ...formData, smtp_username: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">SMTP Password</label>
                <input
                  type="password"
                  required
                  value={formData.smtp_password}
                  onChange={(e) => setFormData({ ...formData, smtp_password: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg"
                />
              </div>
            </div>
          </div>

          <div className="flex gap-2 pt-4 border-t">
            <button
              type="submit"
              disabled={loading}
              className="px-4 py-2 text-white rounded-lg hover:opacity-90 disabled:opacity-50"
              style={{ backgroundColor: branding.primary_color }}
            >
              {loading ? 'Adding...' : 'Add Account'}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 border rounded-lg hover:bg-gray-50"
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
