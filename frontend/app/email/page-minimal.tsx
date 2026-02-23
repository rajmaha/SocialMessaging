'use client'

import React, { useState, useEffect } from 'react'
import axios from 'axios'
import { useBranding } from '@/lib/branding-context'
import { getAuthToken } from '@/lib/auth'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

interface Email {
  id: number
  subject: string
  from_address: string
  to_address: string
  body_html?: string
  body_text?: string
  received_at: string
  is_read: boolean
  is_starred: boolean
  attachments?: any[]
}

interface EmailThread {
  id: number
  subject: string
  from_address: string
  emails: Email[]
}

const DEFAULT_BRANDING = {
  company_name: 'Social Media Messenger',
  company_description: 'Unified messaging platform',
  logo_url: null,
  favicon_url: null,
  primary_color: '#2563eb',
  secondary_color: '#1e40af',
  accent_color: '#3b82f6',
  support_url: null,
  privacy_url: null,
  terms_url: null,
  timezone: 'UTC',
}

export default function EmailPage() {
  const brandingContext = useBranding()
  const branding = brandingContext?.branding || DEFAULT_BRANDING
  
  const [threads, setThreads] = useState<EmailThread[]>([])
  const [selectedThread, setSelectedThread] = useState<EmailThread | null>(null)
  const [expandedEmailId, setExpandedEmailId] = useState<number | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    fetchEmails()
  }, [])

  const fetchEmails = async () => {
    try {
      setLoading(true)
      const token = getAuthToken()
      const response = await axios.get(`${API_URL}/email/inbox?limit=50`, {
        headers: { Authorization: `Bearer ${token}` }
      })
      
      if (response.data?.emails) {
        const threadedEmails = response.data.emails.map((email: Email) => ({
          id: email.id,
          subject: email.subject || '(No subject)',
          from_address: email.from_address,
          emails: [email]
        }))
        setThreads(threadedEmails)
      }
    } catch (error) {
      console.error('Error fetching emails:', error)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="h-screen bg-gray-100 flex">
      {/* Email List */}
      <div className="w-96 bg-white border-r border-gray-200 overflow-y-auto">
        <div className="p-4 border-b border-gray-200">
          <h2 className="text-lg font-bold">Emails</h2>
        </div>
        
        {loading ? (
          <div className="p-4 text-center text-gray-500">Loading...</div>
        ) : threads.length === 0 ? (
          <div className="p-4 text-center text-gray-500">No emails found</div>
        ) : (
          <div>
            {threads.map((thread) => (
              <button
                key={thread.id}
                onClick={() => setSelectedThread(thread)}
                className={`w-full text-left p-4 border-b border-gray-200 hover:bg-gray-50 transition ${
                  selectedThread?.id === thread.id ? 'bg-blue-50' : ''
                }`}
              >
                <div className="font-semibold text-sm">{thread.subject}</div>
                <div className="text-xs text-gray-600 mt-1">{thread.from_address}</div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Email Detail */}
      <div className="flex-1 bg-gray-50 overflow-y-auto">
        {selectedThread ? (
          <div className="p-6 space-y-4">
            <div className="bg-white p-6 rounded-lg border">
              <h2 className="text-2xl font-bold mb-4">{selectedThread.subject}</h2>
              
              {selectedThread.emails.map((email) => (
                <div key={email.id} className="bg-white rounded-lg border mb-4">
                  <button
                    onClick={() => setExpandedEmailId(expandedEmailId === email.id ? null : email.id)}
                    className="w-full text-left p-4 hover:bg-gray-50 flex justify-between items-center"
                  >
                    <div className="flex-1">
                      <div className="font-medium">{email.from_address}</div>
                      <div className="text-xs text-gray-500">{new Date(email.received_at).toLocaleString()}</div>
                    </div>
                    <span>{expandedEmailId === email.id ? '▼' : '▶'}</span>
                  </button>

                  {expandedEmailId === email.id && (
                    <div className="border-t p-4 bg-gray-50">
                      <div className="mb-4">
                        <strong>From:</strong> {email.from_address}<br />
                        <strong>To:</strong> {email.to_address}
                      </div>
                      <div className="bg-white p-3 rounded border whitespace-pre-wrap overflow-auto max-h-96">
                        {email.body_html ? (
                          <div dangerouslySetInnerHTML={{ __html: email.body_html }} />
                        ) : (
                          email.body_text || 'No content'
                        )}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="h-full flex items-center justify-center text-gray-500">
            Select an email to read
          </div>
        )}
      </div>
    </div>
  )
}
