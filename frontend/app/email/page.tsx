'use client'

import React, { useState, useEffect } from 'react'
import axios from 'axios'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { useBranding } from '@/lib/branding-context'
import { getAuthToken } from '@/lib/auth'
import { useEvents } from '@/lib/events-context'

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
  cc?: string
  labels?: string[]
  thread_id?: number
}

interface EmailThread {
  id: number
  subject: string
  from_address: string
  emails: Email[]
}

interface CustomSmartFolder {
  id: string
  label: string
  icon: string
  rules: {
    filterType: 'sender' | 'keyword' | 'hasAttachments' | 'isStarred' | 'domain' | 'subject'
    value?: string
  }[]
}

interface CustomLabel {
  id: string
  name: string
  color: string
}

interface EmailSignature {
  id: string
  name: string
  isDefault: boolean
  imageData?: string // Base64 encoded image
  // Professional signature fields
  closingStatement?: string // e.g., "Thanking you"
  fullName?: string
  title?: string // e.g., "Managing Director"
  company?: string
  address?: string
  phoneOffice?: string
  phoneMobile?: string
  website?: string
  email?: string
  skype?: string
  viber?: string
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

const FOLDERS = [
  { id: 'inbox', label: 'Inbox', endpoint: 'inbox', icon: '📥', type: 'regular' },
  { id: 'sent', label: 'Sent', endpoint: 'sent', icon: '📤', type: 'regular' },
  { id: 'drafts', label: 'Drafts', endpoint: 'drafts', icon: '📝', type: 'regular' },
  { id: 'outbox', label: 'Outbox', endpoint: 'outbox', icon: '📦', type: 'regular' },
  { id: 'trash', label: 'Trash', endpoint: 'trash', icon: '🗑️', type: 'regular' },
]

const SMART_FOLDERS = [
  { id: 'starred', label: 'Starred', icon: '⭐', type: 'smart' },
  { id: 'attachments', label: 'With Attachments', icon: '📎', type: 'smart' },
]

function EmailAutocompleteInput({
  value,
  onChange,
  placeholder,
  suggestions,
}: {
  value: string
  onChange: (v: string) => void
  placeholder: string
  suggestions: string[]
}) {
  const [open, setOpen] = React.useState(false)
  const [filtered, setFiltered] = React.useState<string[]>([])
  const [highlightedIndex, setHighlightedIndex] = React.useState(-1)
  const ref = React.useRef<HTMLDivElement>(null)

  // Reset highlight when filtered list changes
  React.useEffect(() => { setHighlightedIndex(-1) }, [filtered])

  // Current segment being typed (after the last semicolon)
  const getCurrentSegment = (v: string) => {
    const parts = v.split(';')
    return parts[parts.length - 1].trim()
  }

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value
    onChange(v)
    const segment = getCurrentSegment(v)
    if (segment.length >= 1) {
      const matches = suggestions.filter(
        s => s.toLowerCase().includes(segment.toLowerCase()) && !v.split(';').map(p => p.trim()).includes(s)
      ).slice(0, 8)
      setFiltered(matches)
      setOpen(matches.length > 0)
    } else {
      setOpen(false)
    }
  }

  const selectSuggestion = (email: string) => {
    const parts = value.split(';')
    parts[parts.length - 1] = ' ' + email
    onChange(parts.join(';') + '; ')
    setOpen(false)
  }

  // Close on outside click
  React.useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  return (
    <div ref={ref} className="relative">
      <input
        type="text"
        placeholder={placeholder}
        value={value}
        onChange={handleChange}
        onFocus={() => {
          const segment = getCurrentSegment(value)
          if (segment.length >= 1) {
            const matches = suggestions.filter(
              s => s.toLowerCase().includes(segment.toLowerCase()) && !value.split(';').map(p => p.trim()).includes(s)
            ).slice(0, 8)
            setFiltered(matches)
            setOpen(matches.length > 0)
          }
        }}
        onKeyDown={(e) => {
          if (!open) return
          if (e.key === 'Escape') { setOpen(false); return }
          if (e.key === 'ArrowDown') {
            e.preventDefault()
            setHighlightedIndex(i => Math.min(i + 1, filtered.length - 1))
          } else if (e.key === 'ArrowUp') {
            e.preventDefault()
            setHighlightedIndex(i => Math.max(i - 1, 0))
          } else if (e.key === 'Enter' && filtered.length > 0) {
            e.preventDefault()
            selectSuggestion(filtered[highlightedIndex >= 0 ? highlightedIndex : 0])
          }
        }}
        className="w-full bg-transparent border-0 text-sm text-gray-800 placeholder-gray-400 focus:outline-none focus:ring-0 py-1"
      />
      {open && (
        <ul className="absolute z-50 top-full left-0 right-0 bg-white border border-gray-200 rounded-b shadow-lg max-h-48 overflow-y-auto">
          {filtered.map((email, index) => (
            <li
              key={email}
              onMouseDown={(e) => { e.preventDefault(); selectSuggestion(email) }}
              onMouseEnter={() => setHighlightedIndex(index)}
              className={`px-3 py-2 text-sm cursor-pointer flex items-center gap-2 ${highlightedIndex === index ? 'bg-blue-100' : 'hover:bg-blue-50'}`}
            >
              <span className="text-gray-400">✉</span>
              <span>{email}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export default function EmailPage() {
  const brandingContext = useBranding()
  const branding = brandingContext?.branding || DEFAULT_BRANDING
  
  const [currentFolder, setCurrentFolder] = useState('inbox')
  const [threads, setThreads] = useState<EmailThread[]>([])
  const [unreadCounts, setUnreadCounts] = useState<Record<string, number>>({})
  const [selectedThread, setSelectedThread] = useState<EmailThread | null>(null)
  const [expandedEmailId, setExpandedEmailId] = useState<number | null>(null)
  const [loading, setLoading] = useState(false)
  const [emailAccountConfigured, setEmailAccountConfigured] = useState<boolean | null>(null)
  const [requestMessage, setRequestMessage] = useState('')
  const [requestStatus, setRequestStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle')
  const [requestError, setRequestError] = useState('')
  const [requestResponse, setRequestResponse] = useState('')
  const [showCompose, setShowCompose] = useState(false)
  const [pendingThread, setPendingThread] = useState<EmailThread | null>(null)
  const [showComposeGuard, setShowComposeGuard] = useState(false)
  const [currentDraftId, setCurrentDraftId] = useState<number | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [replyMode, setReplyMode] = useState<'none' | 'reply' | 'replyAll' | 'forward'>('none')
  const [composeData, setComposeData] = useState({
    to: '',
    cc: '',
    bcc: '',
    subject: '',
    message: '',
    attachments: [] as File[],
  })
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null)
  const [toastTimer, setToastTimer] = useState<NodeJS.Timeout | null>(null)
  const [sortBy, setSortBy] = useState<'date' | 'sender' | 'subject'>('date')
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc')
  const [showUnreadOnly, setShowUnreadOnly] = useState(false)
  const [customSmartFolders, setCustomSmartFolders] = useState<CustomSmartFolder[]>([])
  const [showCreateSmartFolder, setShowCreateSmartFolder] = useState(false)
  const [draggedEmailId, setDraggedEmailId] = useState<number | null>(null)
  const [customLabels, setCustomLabels] = useState<CustomLabel[]>([])
  const [showCreateLabel, setShowCreateLabel] = useState(false)
  const [newLabelName, setNewLabelName] = useState('')
  const [selectedLabelColor, setSelectedLabelColor] = useState('bg-blue-100')
  const [signatures, setSignatures] = useState<EmailSignature[]>([])
  const [showSignatureSettings, setShowSignatureSettings] = useState(false)
  
  // New signature state
  const [newSignatureName, setNewSignatureName] = useState('')
  const [newSignatureClosing, setNewSignatureClosing] = useState('')
  const [newSignatureFullName, setNewSignatureFullName] = useState('')
  const [newSignatureTitle, setNewSignatureTitle] = useState('')
  const [newSignatureCompany, setNewSignatureCompany] = useState('')
  const [newSignatureAddress, setNewSignatureAddress] = useState('')
  const [newSignaturePhoneOffice, setNewSignaturePhoneOffice] = useState('')
  const [newSignaturePhoneMobile, setNewSignaturePhoneMobile] = useState('')
  const [newSignatureWebsite, setNewSignatureWebsite] = useState('')
  const [newSignatureEmail, setNewSignatureEmail] = useState('')
  const [newSignatureSkype, setNewSignatureSkype] = useState('')
  const [newSignatureViber, setNewSignatureViber] = useState('')
  const [newSignatureImage, setNewSignatureImage] = useState<string | null>(null)
  
  // Edit signature state
  const [selectedSignatureId, setSelectedSignatureId] = useState<string>('')
  const [editingSignatureId, setEditingSignatureId] = useState<string | null>(null)
  const [editSignatureName, setEditSignatureName] = useState('')
  const [editSignatureClosing, setEditSignatureClosing] = useState('')
  const [editSignatureFullName, setEditSignatureFullName] = useState('')
  const [editSignatureTitle, setEditSignatureTitle] = useState('')
  const [editSignatureCompany, setEditSignatureCompany] = useState('')
  const [editSignatureAddress, setEditSignatureAddress] = useState('')
  const [editSignaturePhoneOffice, setEditSignaturePhoneOffice] = useState('')
  const [editSignaturePhoneMobile, setEditSignaturePhoneMobile] = useState('')
  const [editSignatureWebsite, setEditSignatureWebsite] = useState('')
  const [editSignatureEmail, setEditSignatureEmail] = useState('')
  const [editSignatureSkype, setEditSignatureSkype] = useState('')
  const [editSignatureViber, setEditSignatureViber] = useState('')
  const [editSignatureImage, setEditSignatureImage] = useState<string | null>(null)
  
  const [companyLogo, setCompanyLogo] = useState<string | null>(null)
  const [showBrandingSettings, setShowBrandingSettings] = useState(false)
  const [labelColors] = useState([
    'bg-blue-100',
    'bg-red-100',
    'bg-green-100',
    'bg-yellow-100',
    'bg-purple-100',
    'bg-pink-100',
    'bg-indigo-100',
  ])
  const [smartFolderForm, setSmartFolderForm] = useState({
    label: '',
    icon: '📁',
    filterType: 'sender' as 'sender' | 'keyword' | 'hasAttachments' | 'isStarred' | 'domain' | 'subject',
    value: ''
  })

  const showToast = (message: string, type: 'success' | 'error' = 'success') => {
    // Clear existing timer
    if (toastTimer) clearTimeout(toastTimer)
    
    // Show new toast
    setToast({ message, type })
    
    // Auto-dismiss after 1 second
    const timer = setTimeout(() => {
      setToast(null)
    }, 1000)
    
    setToastTimer(timer)
  }

  const editor = useEditor({
    extensions: [StarterKit],
    content: '',
    immediatelyRender: false,
    editable: true,
    onUpdate: ({ editor }) => {
      setComposeData(prev => ({ ...prev, message: editor.getHTML() }))
    },
  })

  useEffect(() => {
    // Check if email account is configured for this user
    const checkEmailAccount = async () => {
      try {
        const token = getAuthToken()
        if (!token) { setEmailAccountConfigured(false); return }
        await axios.get(`${API_URL}/email/account`, {
          headers: { Authorization: `Bearer ${token}` }
        })
        setEmailAccountConfigured(true)
      } catch {
        setEmailAccountConfigured(false)
      }
    }
    checkEmailAccount()
  }, [])

  useEffect(() => {
    // Ensure test user is set up
    if (!getAuthToken()) {
      localStorage.setItem('user', JSON.stringify({ user_id: 2, email: 'test@example.com' }))
    }
    fetchEmails()
  }, [currentFolder])

  // Auto-poll every 60 seconds for new emails
  useEffect(() => {
    const POLL_INTERVAL = 60_000
    const poll = async () => {
      try {
        const token = getAuthToken()
        if (!token) return
        const res = await axios.post(`${API_URL}/email/account/sync`, {}, {
          headers: { Authorization: `Bearer ${token}` }
        })
        if ((res.data?.synced_count ?? 0) > 0) {
          playNewEmailSound()
          await fetchEmails()
        }
      } catch {
        // silently ignore polling errors
      }
    }
    const id = setInterval(poll, POLL_INTERVAL)
    return () => clearInterval(id)
  }, [])

  // Listen for real-time email_received WebSocket events
  const { subscribe } = useEvents()
  useEffect(() => {
    const unsub = subscribe('email_received', async () => {
      playNewEmailSound()
      await fetchEmails()
    })
    return unsub
  }, [subscribe])

  useEffect(() => {
    // Update editor content when switching between reply/compose modes
    if (editor) {
      if (replyMode !== 'none' && composeData.message) {
        // For reply/forward - set previously composed content
        editor.commands.setContent(composeData.message)
        setTimeout(() => {
          editor.commands.focus('start')
        }, 0)
      }
    }
  }, [replyMode, editor])

  useEffect(() => {
    // Clear and focus editor when opening new compose
    if (showCompose && replyMode === 'none' && editor) {
      setTimeout(() => {
        editor.commands.setContent('')
        editor.commands.focus()
      }, 0)
    }
  }, [showCompose, editor, replyMode])

  useEffect(() => {
    // Auto-expand the first email when a thread is selected
    if (selectedThread && selectedThread.emails.length > 0) {
      setExpandedEmailId(selectedThread.emails[0].id)
    }
  }, [selectedThread])

  useEffect(() => {
    // Auto-mark email as read after 10 seconds of being expanded
    if (expandedEmailId && selectedThread) {
      const email = selectedThread.emails.find((e) => e.id === expandedEmailId)
      if (email && !email.is_read) {
        const timer = setTimeout(() => {
          handleMarkRead(expandedEmailId, false) // Don't show toast for auto-read
        }, 10000) // 10 seconds

        return () => clearTimeout(timer)
      }
    }
  }, [expandedEmailId, selectedThread])

  useEffect(() => {
    // Load custom smart folders from localStorage
    const saved = localStorage.getItem('customSmartFolders')
    if (saved) {
      try {
        setCustomSmartFolders(JSON.parse(saved))
      } catch (error) {
        console.error('Error loading custom smart folders:', error)
      }
    }
  }, [])

  const saveSmartFolders = (folders: CustomSmartFolder[]) => {
    setCustomSmartFolders(folders)
    localStorage.setItem('customSmartFolders', JSON.stringify(folders))
  }

  const createSmartFolder = () => {
    if (!smartFolderForm.label.trim()) {
      showToast('Please enter a folder name', 'error')
      return
    }

    const newFolder: CustomSmartFolder = {
      id: `custom_${Date.now()}`,
      label: smartFolderForm.label,
      icon: smartFolderForm.icon || '📁',
      rules: [
        {
          filterType: smartFolderForm.filterType,
          ...(smartFolderForm.filterType !== 'hasAttachments' && smartFolderForm.filterType !== 'isStarred' && { value: smartFolderForm.value })
        }
      ]
    }

    const updated = [...customSmartFolders, newFolder]
    saveSmartFolders(updated)
    
    // Reset form
    setSmartFolderForm({
      label: '',
      icon: '📁',
      filterType: 'sender',
      value: ''
    })
    setShowCreateSmartFolder(false)
    showToast(`✓ Smart folder "${newFolder.label}" created`)
  }

  const deleteSmartFolder = (folderId: string) => {
    const updated = customSmartFolders.filter(f => f.id !== folderId)
    saveSmartFolders(updated)
    if (currentFolder === folderId) {
      setCurrentFolder('inbox')
    }
    showToast('✓ Smart folder deleted')
  }

  // Label management functions
  const loadLabels = () => {
    const saved = localStorage.getItem('customLabels')
    if (saved) {
      try {
        setCustomLabels(JSON.parse(saved))
      } catch (error) {
        console.error('Error loading labels:', error)
      }
    }
  }

  const saveLabels = (labels: CustomLabel[]) => {
    setCustomLabels(labels)
    localStorage.setItem('customLabels', JSON.stringify(labels))
  }

  const createLabel = () => {
    if (!newLabelName.trim()) {
      showToast('Please enter a label name', 'error')
      return
    }

    const newLabel: CustomLabel = {
      id: `label-${Date.now()}`,
      name: newLabelName,
      color: selectedLabelColor,
    }

    const updated = [...customLabels, newLabel]
    saveLabels(updated)
    setNewLabelName('')
    setShowCreateLabel(false)
    showToast(`✓ Label "${newLabel.name}" created`)
  }

  const deleteLabel = (labelId: string) => {
    const updated = customLabels.filter(l => l.id !== labelId)
    saveLabels(updated)
    showToast('✓ Label deleted')
  }

  // Signature management functions
  const loadSignatures = () => {
    const saved = localStorage.getItem('emailSignatures')
    if (saved) {
      try {
        setSignatures(JSON.parse(saved))
      } catch (error) {
        console.error('Error loading signatures:', error)
      }
    }
  }

  const saveSignatures = (sigs: EmailSignature[]) => {
    setSignatures(sigs)
    localStorage.setItem('emailSignatures', JSON.stringify(sigs))
  }

  const createSignature = () => {
    if (!newSignatureName.trim() || !newSignatureFullName.trim()) {
      showToast('Please enter signature name and full name', 'error')
      return
    }

    const newSignature: EmailSignature = {
      id: `sig-${Date.now()}`,
      name: newSignatureName,
      isDefault: signatures.length === 0,
      imageData: newSignatureImage || undefined,
      closingStatement: newSignatureClosing,
      fullName: newSignatureFullName,
      title: newSignatureTitle,
      company: newSignatureCompany,
      address: newSignatureAddress,
      phoneOffice: newSignaturePhoneOffice,
      phoneMobile: newSignaturePhoneMobile,
      website: newSignatureWebsite,
      email: newSignatureEmail,
      skype: newSignatureSkype,
      viber: newSignatureViber
    }

    const updated = [...signatures, newSignature]
    saveSignatures(updated)
    
    if (newSignature.isDefault) {
      setSelectedSignatureId(newSignature.id)
    }

    setNewSignatureName('')
    setNewSignatureClosing('')
    setNewSignatureFullName('')
    setNewSignatureTitle('')
    setNewSignatureCompany('')
    setNewSignatureAddress('')
    setNewSignaturePhoneOffice('')
    setNewSignaturePhoneMobile('')
    setNewSignatureWebsite('')
    setNewSignatureEmail('')
    setNewSignatureSkype('')
    setNewSignatureViber('')
    setNewSignatureImage(null)
    showToast(`✓ Signature "${newSignature.name}" created`)
  }

  const deleteSignature = (sigId: string) => {
    const updated = signatures.filter(s => s.id !== sigId)
    
    // If deleted signature was default, make first one default
    if (signatures.find(s => s.id === sigId)?.isDefault && updated.length > 0) {
      updated[0].isDefault = true
      setSelectedSignatureId(updated[0].id)
    }

    saveSignatures(updated)
    showToast('✓ Signature deleted')
  }

  const setDefaultSignature = (sigId: string) => {
    const updated = signatures.map(s => ({
      ...s,
      isDefault: s.id === sigId
    }))
    saveSignatures(updated)
    setSelectedSignatureId(sigId)
    showToast('✓ Default signature updated')
  }

  const startEditSignature = (sig: EmailSignature) => {
    setEditingSignatureId(sig.id)
    setEditSignatureName(sig.name)
    setEditSignatureClosing(sig.closingStatement || '')
    setEditSignatureFullName(sig.fullName || '')
    setEditSignatureTitle(sig.title || '')
    setEditSignatureCompany(sig.company || '')
    setEditSignatureAddress(sig.address || '')
    setEditSignaturePhoneOffice(sig.phoneOffice || '')
    setEditSignaturePhoneMobile(sig.phoneMobile || '')
    setEditSignatureWebsite(sig.website || '')
    setEditSignatureEmail(sig.email || '')
    setEditSignatureSkype(sig.skype || '')
    setEditSignatureViber(sig.viber || '')
    setEditSignatureImage(sig.imageData || null)
  }

  const handleNewSignatureImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      const reader = new FileReader()
      reader.onload = (event) => {
        setNewSignatureImage(event.target?.result as string)
        showToast('✓ Image added to signature')
      }
      reader.readAsDataURL(file)
    }
  }

  const handleEditSignatureImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      const reader = new FileReader()
      reader.onload = (event) => {
        setEditSignatureImage(event.target?.result as string)
        showToast('✓ Image updated')
      }
      reader.readAsDataURL(file)
    }
  }

  const updateSignature = () => {
    if (!editingSignatureId) return
    if (!editSignatureName.trim() || !editSignatureFullName.trim()) {
      showToast('Please enter signature name and full name', 'error')
      return
    }

    const updated = signatures.map(s =>
      s.id === editingSignatureId
        ? {
            ...s,
            name: editSignatureName,
            imageData: editSignatureImage || undefined,
            closingStatement: editSignatureClosing,
            fullName: editSignatureFullName,
            title: editSignatureTitle,
            company: editSignatureCompany,
            address: editSignatureAddress,
            phoneOffice: editSignaturePhoneOffice,
            phoneMobile: editSignaturePhoneMobile,
            website: editSignatureWebsite,
            email: editSignatureEmail,
            skype: editSignatureSkype,
            viber: editSignatureViber
          }
        : s
    )
    saveSignatures(updated)
    setEditingSignatureId(null)
    setEditSignatureName('')
    setEditSignatureClosing('')
    setEditSignatureFullName('')
    setEditSignatureTitle('')
    setEditSignatureCompany('')
    setEditSignatureAddress('')
    setEditSignaturePhoneOffice('')
    setEditSignaturePhoneMobile('')
    setEditSignatureWebsite('')
    setEditSignatureEmail('')
    setEditSignatureSkype('')
    setEditSignatureViber('')
    setEditSignatureImage(null)
    showToast('✓ Signature updated')
  }

  const cancelEditSignature = () => {
    setEditingSignatureId(null)
    setEditSignatureName('')
    setEditSignatureClosing('')
    setEditSignatureFullName('')
    setEditSignatureTitle('')
    setEditSignatureCompany('')
    setEditSignatureAddress('')
    setEditSignaturePhoneOffice('')
    setEditSignaturePhoneMobile('')
    setEditSignatureWebsite('')
    setEditSignatureEmail('')
    setEditSignatureSkype('')
    setEditSignatureViber('')
    setEditSignatureImage(null)
  }

  const generateSignatureHTML = (sig: EmailSignature): string => {
    let html = ''
    
    // Closing statement
    if (sig.closingStatement) {
      html += `<p>${sig.closingStatement}</p>\n`
    }
    
    // Name and title/company
    html += `<p style="margin: 8px 0; font-weight: 600; font-size: 14px;"><strong>${sig.fullName || ''}</strong></p>\n`
    
    if (sig.title) {
      html += `<p style="margin: 2px 0; font-size: 13px; color: #666;">${sig.title}</p>\n`
    }
    
    if (sig.company) {
      html += `<p style="margin: 2px 0; font-size: 13px; color: #666;">${sig.company}</p>\n`
    }
    
    // Logo/Image
    if (sig.imageData) {
      html += `\n<p style="margin: 12px 0;"><img src="${sig.imageData}" style="max-width: 150px; max-height: 80px; border-radius: 4px;" alt="logo" /></p>\n`
    }
    
    // Address
    if (sig.address) {
      html += `<p style="margin: 8px 0; font-size: 12px; color: #444;">${sig.address}</p>\n`
    }
    
    // Contact information
    let contactInfo = ''
    if (sig.phoneOffice) {
      contactInfo += `Phone: ${sig.phoneOffice}<br />`
    }
    if (sig.phoneMobile) {
      contactInfo += `Mobile: ${sig.phoneMobile}<br />`
    }
    if (sig.website) {
      contactInfo += `Web: <a href="${sig.website}" style="color: #0066cc; text-decoration: none;">${sig.website}</a><br />`
    }
    if (sig.email) {
      contactInfo += `Email: <a href="mailto:${sig.email}" style="color: #0066cc; text-decoration: none;">${sig.email}</a><br />`
    }
    if (sig.skype) {
      contactInfo += `Skype: ${sig.skype}<br />`
    }
    if (sig.viber) {
      contactInfo += `Viber: ${sig.viber}`
    }
    
    if (contactInfo) {
      html += `<p style="margin: 8px 0; font-size: 12px; line-height: 1.6; color: #444;">${contactInfo}</p>\n`
    }
    
    return html
  }

  const loadCompanyLogo = () => {
    const saved = localStorage.getItem('companyLogo')
    if (saved) {
      setCompanyLogo(saved)
    }
  }

  const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      const reader = new FileReader()
      reader.onload = (event) => {
        const logoData = event.target?.result as string
        setCompanyLogo(logoData)
        localStorage.setItem('companyLogo', logoData)
        showToast('✓ Company logo uploaded')
      }
      reader.readAsDataURL(file)
    }
  }

  const removeLogo = () => {
    setCompanyLogo(null)
    localStorage.removeItem('companyLogo')
    showToast('✓ Company logo removed')
  }

  useEffect(() => {
    loadSignatures()
    loadCompanyLogo()
  }, [])

  const handleAssignLabel = async (emailId: number, labelId: string) => {
    try {
      const token = getAuthToken()
      const email = threads.flatMap(t => t.emails).find(e => e.id === emailId)
      if (!email) return

      // Toggle label
      let newLabels = email.labels || []
      if (Array.isArray(newLabels)) {
        if (newLabels.includes(labelId)) {
          newLabels = newLabels.filter(id => id !== labelId)
        } else {
          newLabels = [...newLabels, labelId]
        }
      } else {
        newLabels = [labelId]
      }

      await axios.put(
        `${API_URL}/email/emails/${emailId}/labels`,
        newLabels,
        {
          headers: { Authorization: `Bearer ${token}` }
        }
      )

      // Update local state immediately
      setThreads(threads.map(thread => ({
        ...thread,
        emails: thread.emails.map(e => 
          e.id === emailId ? { ...e, labels: newLabels } : e
        )
      })))

      fetchEmails()
      showToast(`✓ Label ${newLabels.includes(labelId) ? 'added' : 'removed'}`)
    } catch (error) {
      console.error('Error assigning label:', error)
      showToast('Failed to assign label', 'error')
    }
  }

  const filterThreadsByLabel = (threadsToFilter: EmailThread[]): EmailThread[] => {
    const isCategoryLabel = currentFolder.startsWith('label-')
    if (!isCategoryLabel) return threadsToFilter

    return threadsToFilter.filter((thread) => {
      const email = thread.emails[0]
      const labels = Array.isArray(email.labels) ? email.labels : []
      return labels.includes(currentFolder)
    })
  }

  useEffect(() => {
    loadLabels()
  }, [])

  const filterThreadsBySmartFolder = (threadsToFilter: EmailThread[]): EmailThread[] => {
    const folder = customSmartFolders.find(f => f.id === currentFolder)
    if (!folder) return threadsToFilter

    return threadsToFilter.filter((thread) => {
      const email = thread.emails[0]
      return folder.rules.every((rule) => {
        switch (rule.filterType) {
          case 'sender':
            return email.from_address.toLowerCase().includes(rule.value?.toLowerCase() || '')
          case 'domain':
            return email.from_address.toLowerCase().includes('@' + rule.value?.toLowerCase().replace('@', '') || '')
          case 'keyword':
            return email.subject.toLowerCase().includes(rule.value?.toLowerCase() || '') ||
                   email.body_text?.toLowerCase().includes(rule.value?.toLowerCase() || '') ||
                   email.body_html?.toLowerCase().includes(rule.value?.toLowerCase() || '')
          case 'subject':
            return email.subject.toLowerCase().includes(rule.value?.toLowerCase() || '')
          case 'hasAttachments':
            return email.attachments && email.attachments.length > 0
          case 'isStarred':
            return email.is_starred
          default:
            return true
        }
      })
    })
  }

  const getFilteredThreads = (threadsToFilter: EmailThread[]): EmailThread[] => {
    const isSmart = SMART_FOLDERS.some(f => f.id === currentFolder)
    const isCustom = customSmartFolders.some(f => f.id === currentFolder)
    const isLabel = currentFolder.startsWith('label-')

    if (isCustom) {
      return filterThreadsBySmartFolder(threadsToFilter)
    }

    if (isLabel) {
      return filterThreadsByLabel(threadsToFilter)
    }

    return threadsToFilter
  }

  const fetchUnreadCounts = async () => {
    try {
      const token = getAuthToken()
      if (!token) return
      // Fetch inbox emails (limit high enough to count unread)
      const response = await axios.get(`${API_URL}/email/inbox?limit=200`, {
        headers: { Authorization: `Bearer ${token}` }
      })
      if (response.data?.emails) {
        const emails: any[] = response.data.emails
        const counts: Record<string, number> = {}
        // inbox unread count
        counts['inbox'] = emails.filter(e => !e.is_read).length
        // starred unread
        counts['starred'] = emails.filter(e => e.is_starred && !e.is_read).length
        // attachments unread
        counts['attachments'] = emails.filter(e => e.attachments?.length > 0 && !e.is_read).length
        // custom smart folders
        customSmartFolders.forEach(folder => {
          counts[folder.id] = emails.filter(email => {
            if (!folder.rules.every(rule => {
              switch (rule.filterType) {
                case 'sender': return email.from_address.toLowerCase().includes(rule.value?.toLowerCase() || '')
                case 'domain': return email.from_address.toLowerCase().includes('@' + (rule.value?.toLowerCase().replace('@', '') || ''))
                case 'keyword': return email.subject.toLowerCase().includes(rule.value?.toLowerCase() || '') || email.body_text?.toLowerCase().includes(rule.value?.toLowerCase() || '')
                case 'subject': return email.subject.toLowerCase().includes(rule.value?.toLowerCase() || '')
                case 'hasAttachments': return email.attachments?.length > 0
                case 'isStarred': return email.is_starred
                default: return true
              }
            })) return false
            return !email.is_read
          }).length
        })
        // custom labels
        customLabels.forEach(label => {
          counts[label.id] = emails.filter(e => {
            const labels = Array.isArray(e.labels) ? e.labels : []
            return labels.includes(label.id) && !e.is_read
          }).length
        })

        // outbox: fetch separately (unsent emails)
        try {
          const outboxResp = await axios.get(`${API_URL}/email/outbox?limit=200`, {
            headers: { Authorization: `Bearer ${token}` }
          })
          counts['outbox'] = outboxResp.data?.emails?.length ?? 0
        } catch {
          // ignore outbox errors
        }

        // drafts count
        try {
          const draftsResp = await axios.get(`${API_URL}/email/drafts?limit=200`, {
            headers: { Authorization: `Bearer ${token}` }
          })
          counts['drafts'] = draftsResp.data?.emails?.length ?? 0
        } catch {
          // ignore drafts errors
        }

        setUnreadCounts(counts)
      }
    } catch {
      // silently ignore
    }
  }

  const playNewEmailSound = () => {
    try {
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)()
      // Two-tone chime: high then mid
      const notes = [{ freq: 880, start: 0, dur: 0.15 }, { freq: 660, start: 0.18, dur: 0.25 }]
      notes.forEach(({ freq, start, dur }) => {
        const osc = ctx.createOscillator()
        const gain = ctx.createGain()
        osc.connect(gain)
        gain.connect(ctx.destination)
        osc.frequency.value = freq
        osc.type = 'sine'
        gain.gain.setValueAtTime(0, ctx.currentTime + start)
        gain.gain.linearRampToValueAtTime(0.4, ctx.currentTime + start + 0.02)
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + start + dur)
        osc.start(ctx.currentTime + start)
        osc.stop(ctx.currentTime + start + dur)
      })
      setTimeout(() => ctx.close(), 1000)
    } catch {
      // Audio not supported — silently ignore
    }
  }

  const handleSync = async () => {
    try {
      const token = getAuthToken()
      if (!token) { showToast('Please log in', 'error'); return }
      showToast('Syncing emails...')
      await axios.post(`${API_URL}/email/account/sync`, {}, {
        headers: { Authorization: `Bearer ${token}` }
      })
    } catch (error: any) {
      const msg = error?.response?.data?.detail || 'Sync failed'
      showToast(msg, 'error')
    } finally {
      const prevCount = threads.reduce((n, t) => n + t.emails.length, 0)
      await fetchEmails()
      const newCount = threads.reduce((n, t) => n + t.emails.length, 0)
      if (newCount > prevCount) playNewEmailSound()
    }
  }

  const fetchEmails = async () => {
    try {
      setLoading(true)
      const token = getAuthToken()
      
      // Determine which endpoint to call based on folder type
      let endpoint = currentFolder
      const isSmart = SMART_FOLDERS.some(f => f.id === currentFolder)
      const isCustom = customSmartFolders.some(f => f.id === currentFolder)
      const isLabel = currentFolder.startsWith('label-')
      
      if (isSmart || isCustom || isLabel) {
        endpoint = 'inbox' // Fetch all inbox emails for filtering
      }

      const limit = (isSmart || isCustom || isLabel) ? 200 : 50
      const response = await axios.get(`${API_URL}/email/${endpoint}?limit=${limit}`, {
        headers: { Authorization: `Bearer ${token}` }
      })
      
      if (response.data?.emails) {
        let emails = response.data.emails
        
        // Apply smart folder filtering
        if (currentFolder === 'starred') {
          emails = emails.filter((email: Email) => email.is_starred)
        } else if (currentFolder === 'attachments') {
          emails = emails.filter((email: Email) => email.attachments && email.attachments.length > 0)
        }
        
        // Group emails by thread_id; emails without thread_id each get their own group
        const threadMap = new Map<string, any>()
        emails.forEach((email: Email) => {
          const key = email.thread_id != null ? `t-${email.thread_id}` : `solo-${email.id}`
          if (!threadMap.has(key)) {
            threadMap.set(key, {
              id: email.thread_id ?? email.id,
              subject: email.subject || '(No subject)',
              from_address: email.from_address,
              emails: []
            })
          }
          threadMap.get(key).emails.push(email)
        })
        const grouped = Array.from(threadMap.values()).map(t => ({
          ...t,
          emails: [...t.emails].sort((a: Email, b: Email) =>
            new Date(a.received_at).getTime() - new Date(b.received_at).getTime()
          )
        }))
        // Sort threads by most recent email descending
        grouped.sort((a, b) => {
          const aLast = new Date(a.emails[a.emails.length - 1].received_at).getTime()
          const bLast = new Date(b.emails[b.emails.length - 1].received_at).getTime()
          return bLast - aLast
        })
        setThreads(grouped)
      }
    } catch (error) {
      console.error('Error fetching emails:', error)
    } finally {
      setLoading(false)
    }
    fetchUnreadCounts()
  }

  const filteredThreads = threads.filter((thread) => {
    const query = searchQuery.toLowerCase()
    const matchesSearch = (
      thread.subject.toLowerCase().includes(query) ||
      thread.from_address.toLowerCase().includes(query)
    )
    
    if (showUnreadOnly) {
      return matchesSearch && !thread.emails[0]?.is_read
    }
    
    return matchesSearch
  }).sort((a, b) => {
    let comparison = 0
    
    if (sortBy === 'date') {
      const dateA = new Date(a.emails[0]?.received_at || 0).getTime()
      const dateB = new Date(b.emails[0]?.received_at || 0).getTime()
      comparison = dateA - dateB
    } else if (sortBy === 'sender') {
      comparison = a.from_address.localeCompare(b.from_address)
    } else if (sortBy === 'subject') {
      comparison = a.subject.localeCompare(b.subject)
    }
    
    return sortOrder === 'desc' ? -comparison : comparison
  })

  const finalFilteredThreads = getFilteredThreads(filteredThreads)

  // Collect all known email addresses from loaded threads for autocomplete
  const knownEmails = React.useMemo(() => {
    const set = new Set<string>()
    threads.forEach(thread => {
      thread.emails.forEach(email => {
        if (email.from_address) email.from_address.split(',').forEach(e => { const t = e.trim(); if (t && t.includes('@')) set.add(t) })
        if (email.to_address) email.to_address.split(',').forEach(e => { const t = e.trim(); if (t && t.includes('@')) set.add(t) })
        if (email.cc) email.cc.split(',').forEach(e => { const t = e.trim(); if (t && t.includes('@')) set.add(t) })
      })
    })
    return Array.from(set).sort()
  }, [threads])

  const handleDownloadEmailList = () => {
    if (knownEmails.length === 0) {
      showToast('No email addresses found. Sync your inbox first.', 'error')
      return
    }
    const csv = 'Email Address\n' + knownEmails.join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `email-list-${new Date().toISOString().slice(0, 10)}.csv`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
    showToast(`✓ Downloaded ${knownEmails.length} unique email addresses`)
  }

  const parseEmails = (emailString: string): string[] => {
    return emailString
      .split(';')
      .map((email) => email.trim())
      .filter((email) => email.length > 0)
  }

  const resetCompose = () => {
    setShowCompose(false)
    setReplyMode('none')
    setComposeData({ to: '', cc: '', bcc: '', subject: '', message: '', attachments: [] })
    setCurrentDraftId(null)
    if (editor) {
      editor.commands.setContent('')
    }
  }

  const saveDraft = async () => {
    try {
      const token = getAuthToken()
      const payload = {
        to_address: composeData.to.trim(),
        cc: composeData.cc.trim() || undefined,
        bcc: composeData.bcc.trim() || undefined,
        subject: composeData.subject,
        body: composeData.message,
      }
      if (currentDraftId) {
        await axios.put(
          `${API_URL}/email/drafts/${currentDraftId}`,
          payload,
          { headers: { Authorization: `Bearer ${token}` } }
        )
      } else {
        const res = await axios.post(
          `${API_URL}/email/drafts/save`,
          payload,
          { headers: { Authorization: `Bearer ${token}` } }
        )
        if (res.data?.draft_id) setCurrentDraftId(res.data.draft_id)
      }
      showToast('✓ Draft saved')
      fetchUnreadCounts()
    } catch (error) {
      console.error('Error saving draft:', error)
      showToast('Failed to save draft', 'error')
    }
  }

  const buildQuotedSeparator = (email: Email, mode: 'reply' | 'forward', thread?: EmailThread) => {
    const date = new Date(email.received_at).toLocaleString('en-US', { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })

    // Build full chain: all prior emails in the thread (oldest first), excluding the current one
    const priorEmails = thread
      ? [...thread.emails]
          .sort((a, b) => new Date(a.received_at).getTime() - new Date(b.received_at).getTime())
          .filter(e => e.id !== email.id || thread.emails.length === 1)
      : []

    // Build nested quoted chain from oldest to newest prior emails
    const buildChain = (emails: Email[]): string => {
      if (emails.length === 0) return email.body_html || `<p style="white-space:pre-wrap">${email.body_text || ''}</p>`
      let inner = email.body_html || `<p style="white-space:pre-wrap">${email.body_text || ''}</p>`
      // Append prior chain below current email body
      const chainItems = emails.map(e => {
        const d = new Date(e.received_at).toLocaleString('en-US', { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
        return `<div style="border-top:1px solid #e5e7eb;margin-top:12px;padding-top:8px;color:#6b7280;font-size:12px">` +
          `<p style="margin:0 0 4px"><strong>On ${d}, ${e.from_address} wrote:</strong></p>` +
          `<blockquote style="margin:0 0 0 10px;padding:6px 10px;border-left:3px solid #93c5fd;background:#f0f9ff;color:#374151;font-size:13px">` +
          (e.body_html || `<p style="white-space:pre-wrap">${e.body_text || ''}</p>`) +
          `</blockquote></div>`
      })
      return inner + chainItems.join('')
    }

    const combinedBody = buildChain(priorEmails)

    const header = mode === 'reply'
      ? `<p><strong>On ${date}, ${email.from_address} wrote:</strong></p>`
      : `<table style="border:none;border-collapse:collapse;margin:0;padding:0"><tr><td style="padding:0"><p style="margin:0"><strong>---------- Forwarded message ----------</strong></p><p style="margin:4px 0 0"><strong>From:</strong> ${email.from_address}</p><p style="margin:4px 0 0"><strong>Date:</strong> ${date}</p><p style="margin:4px 0 0"><strong>Subject:</strong> ${email.subject}</p>${email.to_address ? `<p style="margin:4px 0 0"><strong>To:</strong> ${email.to_address}</p>` : ''}</td></tr></table>`
    return (
      `<p><br></p>` +
      `<div style="border-top:2px solid #e5e7eb;margin:16px 0 12px;padding-top:12px;color:#6b7280;font-size:13px">` +
      header +
      `</div>` +
      `<blockquote style="margin:0 0 0 12px;padding:8px 12px;border-left:4px solid #3b82f6;background:#f8fafc;color:#374151;font-size:14px;border-radius:0 4px 4px 0">` +
      combinedBody +
      `</blockquote>`
    )
  }

  const buildNewComposeContent = () =>
    `<p></p>`

  const handleReply = (email: Email, thread?: EmailThread) => {
    setReplyMode('reply')
    setComposeData({
      to: email.from_address,
      cc: '',
      bcc: '',
      subject: email.subject?.startsWith('Re:') ? email.subject : `Re: ${email.subject}`,
      message: buildNewComposeContent() + buildQuotedSeparator(email, 'reply', thread),
      attachments: [],
    })
  }

  const handleReplyAll = (email: Email, thread: EmailThread) => {
    setReplyMode('replyAll')
    setComposeData({
      to: email.from_address,
      cc: email.cc || '',
      bcc: '',
      subject: email.subject?.startsWith('Re:') ? email.subject : `Re: ${email.subject}`,
      message: buildNewComposeContent() + buildQuotedSeparator(email, 'reply', thread),
      attachments: [],
    })
  }

  const handleForward = (email: Email, thread?: EmailThread) => {
    setReplyMode('forward')
    setComposeData({
      to: '',
      cc: '',
      bcc: '',
      subject: email.subject?.startsWith('Fwd:') ? email.subject : `Fwd: ${email.subject}`,
      message: buildNewComposeContent() + buildQuotedSeparator(email, 'forward', thread),
      attachments: [],
    })
  }

  const handleDelete = async (emailId: number) => {
    if (!confirm('Are you sure you want to delete this email?')) return
    try {
      const token = getAuthToken()
      await axios.put(`${API_URL}/email/emails/${emailId}/trash`, {}, {
        headers: { Authorization: `Bearer ${token}` }
      })
      setSelectedThread(null)
      fetchEmails()
      showToast('✓ Email deleted')
    } catch (error) {
      console.error('Error deleting email:', error)
      showToast('Failed to delete email', 'error')
    }
  }

  const handleMarkUnread = async (emailId: number) => {
    try {
      const token = getAuthToken()
      await axios.put(
        `${API_URL}/email/emails/${emailId}/mark-unread`,
        {},
        {
          headers: { Authorization: `Bearer ${token}` }
        }
      )
      fetchEmails()
      showToast('✓ Marked as unread')
    } catch (error) {
      console.error('Error marking email:', error)
      showToast('Failed to mark as unread', 'error')
    }
  }

  const handleMarkRead = async (emailId: number, showNotification: boolean = true) => {
    try {
      const token = getAuthToken()
      await axios.put(
        `${API_URL}/email/emails/${emailId}/mark-read`,
        { is_read: true },
        {
          headers: { Authorization: `Bearer ${token}` }
        }
      )
      fetchEmails()
      if (showNotification) {
        showToast('✓ Marked as read')
      }
    } catch (error) {
      console.error('Error marking email as read:', error)
    }
  }

  const handleStar = async (emailId: number, isStar: boolean) => {
    try {
      const token = getAuthToken()
      await axios.put(
        `${API_URL}/email/emails/${emailId}/star`,
        { is_starred: !isStar },
        {
          headers: { Authorization: `Bearer ${token}` }
        }
      )
      fetchEmails()
      showToast(isStar ? '✓ Removed from starred' : '✓ Added to starred')
    } catch (error) {
      console.error('Error starring email:', error)
      showToast('Failed to update star', 'error')
    }
  }

  const handleMoveEmailToFolder = async (emailId: number, targetFolder: string) => {
    try {
      const token = getAuthToken()
      
      if (targetFolder === 'trash') {
        // Move to trash
        await axios.put(`${API_URL}/email/emails/${emailId}/trash`, {}, {
          headers: { Authorization: `Bearer ${token}` }
        })
        showToast('✓ Moved to trash')
      } else if (targetFolder === 'inbox') {
        // Restore from trash
        await axios.put(`${API_URL}/email/emails/${emailId}/restore`, {}, {
          headers: { Authorization: `Bearer ${token}` }
        })
        showToast('✓ Restored to inbox')
      } else if (targetFolder === 'starred') {
        // Star the email
        const email = threads.flatMap(t => t.emails).find(e => e.id === emailId)
        if (email) {
          await handleStar(emailId, email.is_starred)
        }
        return
      }
      
      fetchEmails()
    } catch (error) {
      console.error('Error moving email:', error)
      showToast('Failed to move email', 'error')
    }
  }

  const isBrowserFriendly = (attachment: any): boolean => {
    const ct: string = attachment.content_type || ''
    return ct.startsWith('image/') || ct === 'application/pdf' ||
      ct.startsWith('text/') || ct.startsWith('video/') || ct.startsWith('audio/')
  }

  const handleOpenAttachmentInBrowser = async (emailId: number, attachment: any) => {
    try {
      const token = getAuthToken()
      const response = await axios.get(
        `${API_URL}/email/${emailId}/attachments/${attachment.id}`,
        { headers: { Authorization: `Bearer ${token}` }, responseType: 'blob' }
      )
      const blob = new Blob([response.data], { type: attachment.content_type || 'application/octet-stream' })
      const url = window.URL.createObjectURL(blob)
      window.open(url, '_blank')
      // Revoke after a delay to allow the tab to load
      setTimeout(() => window.URL.revokeObjectURL(url), 30000)
    } catch (error) {
      console.error('Error opening attachment:', error)
      showToast('Failed to open attachment', 'error')
    }
  }

  const handleDownloadAttachment = async (emailId: number, attachment: any) => {
    try {
      console.log('Downloading attachment:', attachment)
      const token = getAuthToken()
      
      // Try different endpoint patterns
      const endpoints = [
        `${API_URL}/email/${emailId}/attachments/${attachment.id}`,
        `${API_URL}/email/${emailId}/attachments/${attachment.filename}`,
        `${API_URL}/email/${emailId}/attachment/${attachment.id}`,
        `${API_URL}/email/${emailId}/attachment/${attachment.filename}`,
        `${API_URL}/attachment/${attachment.id}`,
        attachment.url // If attachment has direct URL
      ].filter(Boolean)

      let downloaded = false
      
      for (const endpoint of endpoints) {
        try {
          console.log('Trying endpoint:', endpoint)
          const response = await axios.get(endpoint, {
            headers: { Authorization: `Bearer ${token}` },
            responseType: 'blob'
          })

          // Create blob URL and trigger download
          const blob = new Blob([response.data])
          const url = window.URL.createObjectURL(blob)
          const link = document.createElement('a')
          link.href = url
          link.download = attachment.filename || 'attachment'
          document.body.appendChild(link)
          link.click()
          document.body.removeChild(link)
          window.URL.revokeObjectURL(url)
          
          downloaded = true
          showToast('✓ Attachment downloaded successfully!')
          break
        } catch (err) {
          console.log('Endpoint failed:', endpoint, err)
          continue
        }
      }

      if (!downloaded) {
        console.error('All download endpoints failed')
        showToast('Could not download attachment. The download endpoint may not be implemented on the backend yet.', 'error')
      }
    } catch (error) {
      console.error('Error downloading attachment:', error)
      showToast('Failed to download attachment. Please check the browser console for details.', 'error')
    }
  }

  const handleSend = async () => {
    const token = getAuthToken()
    if (!token) {
      showToast('Please log in to send emails', 'error')
      return
    }
    if (!composeData.to.trim()) {
      showToast('Please enter a recipient email address', 'error')
      return
    }
    try {
      if (replyMode === 'reply' || replyMode === 'replyAll') {
        const replyEmailId = expandedEmailId || selectedThread?.emails[0]?.id
        if (!replyEmailId) {
          showToast('Could not determine which email to reply to', 'error')
          return
        }
        await axios.post(
          `${API_URL}/email/emails/${replyEmailId}/reply`,
          {
            body: composeData.message,
            cc: composeData.cc || null,
            bcc: composeData.bcc || null,
          },
          { headers: { Authorization: `Bearer ${token}` } }
        )
      } else {
        // New compose or forward
        await axios.post(
          `${API_URL}/email/send`,
          {
            to_address: composeData.to,
            subject: composeData.subject,
            body: composeData.message,
            cc: composeData.cc || null,
            bcc: composeData.bcc || null,
          },
          { headers: { Authorization: `Bearer ${token}` } }
        )
      }
      showToast('✓ Email sent successfully!')
      resetCompose()
    } catch (error: any) {
      console.error('Error sending email:', error)
      showToast(error?.response?.data?.detail || 'Failed to send email', 'error')
    }
  }

  if (emailAccountConfigured === false) {
    const handleRequest = async (e: React.FormEvent) => {
      e.preventDefault()
      setRequestStatus('sending')
      setRequestError('')
      try {
        const token = getAuthToken()
        const res = await axios.post(
          `${API_URL}/email/request-account`,
          { message: requestMessage },
          { headers: { Authorization: `Bearer ${token}` } }
        )
        setRequestResponse(res.data?.message || 'Your request has been recorded.')
        setRequestStatus('sent')
      } catch (err: any) {
        setRequestError(err?.response?.data?.detail || 'Failed to send request. Please try again.')
        setRequestStatus('error')
      }
    }

    return (
      <div className="h-screen bg-gray-100 flex items-center justify-center">
        <div className="bg-white rounded-2xl shadow-lg p-10 max-w-md w-full text-center">
          <div className="text-5xl mb-4">✉️</div>
          <h2 className="text-2xl font-bold text-gray-800 mb-2">Email Not Configured</h2>
          <p className="text-gray-500 mb-6">
            Your email account has not been set up yet. Fill in the form below to request the administrator to configure one for you.
          </p>

          {requestStatus === 'sent' ? (
            <div className="bg-green-50 border border-green-200 rounded-lg p-6">
              <div className="text-4xl mb-2">✅</div>
              <p className="text-green-700 font-semibold">Request submitted!</p>
              <p className="text-green-600 text-sm mt-1">{requestResponse}</p>
            </div>
          ) : (
            <form onSubmit={handleRequest} className="text-left space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Message to Admin <span className="text-gray-400 font-normal">(optional)</span></label>
                <textarea
                  value={requestMessage}
                  onChange={(e) => setRequestMessage(e.target.value)}
                  rows={3}
                  placeholder="e.g. I need access to the company support inbox…"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm resize-none"
                />
              </div>
              {requestStatus === 'error' && (
                <p className="text-red-500 text-sm">{requestError}</p>
              )}
              <button
                type="submit"
                disabled={requestStatus === 'sending'}
                className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white font-semibold px-6 py-3 rounded-lg transition-colors"
              >
                {requestStatus === 'sending' ? 'Sending…' : 'Request Email Account'}
              </button>
            </form>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="h-screen bg-gray-100 flex">
      {/* Toast Notification */}
      {toast && (
        <div className={`fixed top-4 right-4 px-6 py-3 rounded-lg shadow-lg text-white font-semibold z-50 animate-fade-in ${
          toast.type === 'success' ? 'bg-green-500' : 'bg-red-500'
        }`}>
          {toast.message}
        </div>
      )}
      {/* Folders Column */}
      <div className="w-52 bg-white border-r border-gray-200 flex flex-col overflow-hidden">
        {/* Sidebar header */}
        <div className="bg-white border-b border-gray-200 px-4 py-3 flex-shrink-0">
          <div className="flex items-center justify-between">
            <span className="text-gray-700 font-bold text-sm tracking-wide">📬 Mail</span>
            {/* Action icon buttons */}
            <div className="flex items-center gap-1">
              <div className="group relative">
                <button
                  onClick={() => {
                    if (showCompose) {
                      resetCompose()
                    } else {
                      setShowCompose(true)
                      setReplyMode('none')
                      setComposeData({ to: '', cc: '', bcc: '', subject: '', message: '', attachments: [] })
                      if (editor) {
                        editor.commands.setContent(buildNewComposeContent())
                        editor.commands.focus('end')
                      }
                    }
                  }}
                  className="w-8 h-8 flex items-center justify-center rounded-lg bg-blue-500 hover:bg-blue-600 text-white transition text-base shadow-sm"
                >
                  ✏️
                </button>
                <span className="absolute top-full left-1/2 -translate-x-1/2 mt-1 px-2 py-0.5 text-xs bg-gray-800 text-white rounded whitespace-nowrap invisible group-hover:visible z-50">Compose</span>
              </div>
              <div className="group relative">
                <button
                  onClick={handleSync}
                  className="w-8 h-8 flex items-center justify-center rounded-lg bg-gray-200 hover:bg-gray-300 text-gray-700 transition text-base shadow-sm"
                >
                  🔄
                </button>
                <span className="absolute top-full left-1/2 -translate-x-1/2 mt-1 px-2 py-0.5 text-xs bg-gray-800 text-white rounded whitespace-nowrap invisible group-hover:visible z-50">Sync</span>
              </div>
              <div className="group relative">
                <button
                  onClick={handleDownloadEmailList}
                  className="w-8 h-8 flex items-center justify-center rounded-lg bg-emerald-100 hover:bg-emerald-200 text-emerald-700 transition text-base shadow-sm"
                >
                  ⬇️
                </button>
                <span className="absolute top-full left-1/2 -translate-x-1/2 mt-1 px-2 py-0.5 text-xs bg-gray-800 text-white rounded whitespace-nowrap invisible group-hover:visible z-50">Export Emails{knownEmails.length > 0 ? ` (${knownEmails.length})` : ''}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Scrollable nav */}
        <div className="flex-1 overflow-y-auto">
        <div className="px-3 py-3">

          <p className="text-xs font-bold text-gray-400 uppercase tracking-wider px-1 mb-2">Folders</p>
          <div className="space-y-0.5 mb-4">
            {FOLDERS.map((folder) => (
              <button
                key={folder.id}
                onClick={() => {
                  setCurrentFolder(folder.id)
                  setSelectedThread(null)
                }}
                onDrop={(e) => {
                  e.preventDefault()
                  const movable = ['inbox', 'trash'].includes(folder.id)
                  if (movable && draggedEmailId) {
                    handleMoveEmailToFolder(draggedEmailId, folder.id)
                    setDraggedEmailId(null)
                  }
                }}
                onDragOver={(e) => {
                  const movable = ['inbox', 'trash'].includes(folder.id)
                  if (movable && draggedEmailId) {
                    e.preventDefault()
                    e.currentTarget.style.opacity = '0.7'
                  }
                }}
                onDragLeave={(e) => {
                  e.currentTarget.style.opacity = '1'
                }}
                className={`w-full text-left px-3 py-2 rounded-lg text-sm transition flex items-center gap-2 ${
                  currentFolder === folder.id
                    ? 'bg-blue-500 text-white font-semibold shadow-sm'
                    : 'hover:bg-gray-100 text-gray-700'
                }`}
              >
                <span className="text-lg">{folder.icon}</span>
                <span className="flex-1">{folder.label}</span>
                {(unreadCounts[folder.id] ?? 0) > 0 && (
                  <span className={`text-xs font-bold px-1.5 py-0.5 rounded-full min-w-[1.2rem] text-center ${
                    currentFolder === folder.id ? 'bg-white text-blue-600' : 'bg-blue-500 text-white'
                  }`}>
                    {unreadCounts[folder.id]}
                  </span>
                )}
              </button>
            ))}
          </div>

          <p className="text-xs font-bold text-gray-400 uppercase tracking-wider px-1 mb-2 mt-4">Smart Folders</p>
          <div className="space-y-0.5 mb-3">
            {SMART_FOLDERS.map((folder) => (
              <button
                key={folder.id}
                onClick={() => {
                  setCurrentFolder(folder.id)
                  setSelectedThread(null)
                }}
                onDrop={(e) => {
                  e.preventDefault()
                  if (folder.id === 'starred' && draggedEmailId) {
                    handleMoveEmailToFolder(draggedEmailId, folder.id)
                    setDraggedEmailId(null)
                  }
                }}
                onDragOver={(e) => {
                  if (folder.id === 'starred' && draggedEmailId) {
                    e.preventDefault()
                    e.currentTarget.style.opacity = '0.7'
                  }
                }}
                onDragLeave={(e) => {
                  e.currentTarget.style.opacity = '1'
                }}
                className={`w-full text-left px-3 py-2 rounded-lg text-sm transition flex items-center gap-2 ${
                  currentFolder === folder.id
                    ? 'bg-purple-500 text-white font-semibold shadow-sm'
                    : 'hover:bg-gray-100 text-gray-700'
                }`}
              >
                <span className="text-lg">{folder.icon}</span>
                <span className="flex-1">{folder.label}</span>
                {(unreadCounts[folder.id] ?? 0) > 0 && (
                  <span className={`text-xs font-bold px-1.5 py-0.5 rounded-full min-w-[1.2rem] text-center ${
                    currentFolder === folder.id ? 'bg-white text-purple-600' : 'bg-purple-500 text-white'
                  }`}>
                    {unreadCounts[folder.id]}
                  </span>
                )}
              </button>
            ))}
            {customSmartFolders.map((folder) => (
              <div key={folder.id} className="flex items-center gap-1 group">
                <button
                  onClick={() => {
                    setCurrentFolder(folder.id)
                    setSelectedThread(null)
                  }}
                  onDrop={(e) => {
                    e.preventDefault()
                    // Custom folders are read-only filtered views
                  }}
                  onDragOver={(e) => {
                    // Don't accept drops
                  }}
                className={`flex-1 text-left px-3 py-2 rounded-lg text-sm transition flex items-center gap-2 ${
                  currentFolder === folder.id
                    ? 'bg-indigo-500 text-white font-semibold shadow-sm'
                    : 'hover:bg-gray-100 text-gray-700'
                }`}
                >
                  <span className="text-lg">{folder.icon}</span>
                  <span className="flex-1 truncate">{folder.label}</span>
                  {(unreadCounts[folder.id] ?? 0) > 0 && (
                    <span className={`text-xs font-bold px-1.5 py-0.5 rounded-full min-w-[1.2rem] text-center ${
                      currentFolder === folder.id ? 'bg-white text-indigo-600' : 'bg-indigo-500 text-white'
                    }`}>
                      {unreadCounts[folder.id]}
                    </span>
                  )}
                </button>
                <button
                  onClick={() => deleteSmartFolder(folder.id)}
                  className="opacity-0 group-hover:opacity-100 px-2 py-1 text-red-500 hover:text-red-700 transition text-xs"
                  title="Delete folder"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>

          <button
            onClick={() => setShowCreateSmartFolder(true)}
            className="w-full text-xs px-3 py-2 rounded-lg transition font-semibold bg-indigo-50 text-indigo-600 hover:bg-indigo-100 border border-indigo-100 mt-1"
          >
            + Smart Folder
          </button>

          <p className="text-xs font-bold text-gray-400 uppercase tracking-wider px-1 mb-2 mt-4">Labels</p>
          <div className="space-y-0.5 mb-3">
            {customLabels.map((label) => (
              <div key={label.id} className="flex items-center gap-1 group">
                <button
                  onClick={() => {
                    setCurrentFolder(label.id)
                    setSelectedThread(null)
                  }}
                  onDrop={(e) => {
                    e.preventDefault()
                    if (draggedEmailId) {
                      handleAssignLabel(draggedEmailId, label.id)
                      setDraggedEmailId(null)
                    }
                  }}
                  onDragOver={(e) => {
                    if (draggedEmailId) {
                      e.preventDefault()
                      e.currentTarget.style.opacity = '0.7'
                    }
                  }}
                  onDragLeave={(e) => {
                    e.currentTarget.style.opacity = '1'
                  }}
                  className={`flex-1 text-left px-3 py-2 rounded-lg text-sm transition flex items-center gap-2 ${
                    currentFolder === label.id
                      ? 'text-white font-semibold shadow-sm'
                      : 'hover:bg-gray-100 text-gray-700'
                  } ${currentFolder === label.id ? label.color.replace('100', '500') : label.color}`}
                >
                  <span className="w-2 h-2 rounded-full flex-shrink-0" style={{backgroundColor: label.color.includes('blue') ? '#3b82f6' : label.color.includes('red') ? '#ef4444' : label.color.includes('green') ? '#10b981' : label.color.includes('yellow') ? '#f59e0b' : label.color.includes('purple') ? '#a855f7' : label.color.includes('pink') ? '#ec4899' : '#6366f1'}}></span>
                  <span className="flex-1">{label.name}</span>
                  {(unreadCounts[label.id] ?? 0) > 0 && (
                    <span className="text-xs font-bold px-1.5 py-0.5 rounded-full min-w-[1.2rem] text-center bg-white text-gray-700">
                      {unreadCounts[label.id]}
                    </span>
                  )}
                </button>
                <button
                  onClick={() => deleteLabel(label.id)}
                  className="opacity-0 group-hover:opacity-100 px-2 py-1 text-red-500 hover:text-red-700 transition text-xs"
                  title="Delete label"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>

          <button
            onClick={() => setShowCreateLabel(true)}
            className="w-full text-xs px-3 py-2 rounded-lg transition font-semibold bg-green-50 text-green-700 hover:bg-green-100 border border-green-100 mt-1"
          >
            + Create Label
          </button>

          <button
            onClick={() => setShowSignatureSettings(true)}
            className="w-full text-xs px-3 py-2 mt-2 rounded-lg transition font-semibold bg-purple-50 text-purple-700 hover:bg-purple-100 border border-purple-100"
          >
            ✍️ Signatures
          </button>
        </div>
        </div>
      </div>

      {/* Email List Column */}
      <div className="w-80 bg-white border-r border-gray-200 overflow-y-auto flex flex-col">
        <div className="p-4 border-b border-gray-200">
          <div className="mb-3">
            <input
              type="text"
              placeholder="Search emails..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
            />
          </div>
          
          <div className="mb-3">
            <button
              onClick={() => setShowUnreadOnly(!showUnreadOnly)}
              className={`w-full text-xs px-3 py-2 rounded transition font-semibold ${
                showUnreadOnly
                  ? 'bg-red-500 text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              {showUnreadOnly ? '🔴 Unread Only' : '⚪ All Emails'}
            </button>
          </div>
          
          <div className="mb-3">
            <div className="flex gap-2 flex-wrap">
              <button
                onClick={() => {
                  if (sortBy === 'date') {
                    setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')
                  } else {
                    setSortBy('date')
                    setSortOrder('desc')
                  }
                }}
                className={`flex-1 text-xs px-2 py-1 rounded transition ${
                  sortBy === 'date'
                    ? 'bg-blue-500 text-white'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                📅 Date {sortBy === 'date' && (sortOrder === 'desc' ? '↓' : '↑')}
              </button>
              <button
                onClick={() => {
                  if (sortBy === 'sender') {
                    setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')
                  } else {
                    setSortBy('sender')
                    setSortOrder('asc')
                  }
                }}
                className={`flex-1 text-xs px-2 py-1 rounded transition ${
                  sortBy === 'sender'
                    ? 'bg-blue-500 text-white'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                👤 Sender {sortBy === 'sender' && (sortOrder === 'desc' ? '↓' : '↑')}
              </button>
              <button
                onClick={() => {
                  if (sortBy === 'subject') {
                    setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')
                  } else {
                    setSortBy('subject')
                    setSortOrder('asc')
                  }
                }}
                className={`flex-1 text-xs px-2 py-1 rounded transition ${
                  sortBy === 'subject'
                    ? 'bg-blue-500 text-white'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                📝 Subject {sortBy === 'subject' && (sortOrder === 'desc' ? '↓' : '↑')}
              </button>
            </div>
          </div>
          
          <h3 className="text-sm font-semibold text-gray-600">Emails ({finalFilteredThreads.length})</h3>
        </div>

        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="p-4 text-center text-gray-500 text-sm">Loading...</div>
          ) : finalFilteredThreads.length === 0 ? (
            <div className="p-4 text-center text-gray-500 text-sm">{searchQuery ? 'No emails match' : 'No emails'}</div>
          ) : (
            <div>
              {finalFilteredThreads.map((thread) => {
                const receivedAt = new Date(thread.emails[0]?.received_at)
                const today = new Date()
                const isToday = receivedAt.toDateString() === today.toDateString()
                const dateDisplay = isToday 
                  ? receivedAt.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
                  : receivedAt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
                const isUnread = !thread.emails[0]?.is_read
                
                return (
                <button
                  key={thread.id}
                  onClick={() => {
                    if (showCompose) {
                      setPendingThread(thread)
                      setShowComposeGuard(true)
                    } else {
                      setSelectedThread(thread)
                    }
                  }}
                  draggable
                  onDragStart={() => setDraggedEmailId(thread.emails[0].id)}
                  onDragEnd={() => setDraggedEmailId(null)}
                  className={`w-full text-left p-3 border-b border-gray-200 transition ${
                    draggedEmailId === thread.emails[0].id ? 'opacity-50' : ''
                  } ${
                    selectedThread?.id === thread.id ? 'bg-blue-50' : isUnread ? 'bg-blue-50 hover:bg-blue-100' : 'hover:bg-gray-50'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 truncate">
                      {isUnread && <span className="inline-block w-2 h-2 bg-blue-500 rounded-full mr-2"></span>}
                      <div className={`text-xs ${isUnread ? 'font-bold text-gray-900' : 'font-semibold text-gray-700'}`}>{thread.subject}</div>
                      <div className={`text-xs mt-1 truncate ${isUnread ? 'text-gray-700 font-medium' : 'text-gray-600'}`}>{thread.from_address}</div>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <div className={`text-xs whitespace-nowrap ${isUnread ? 'text-blue-600 font-medium' : 'text-gray-500'}`}>{dateDisplay}</div>
                      {thread.emails.length > 1 && (
                        <span className="text-xs bg-gray-200 text-gray-600 font-semibold px-1.5 py-0.5 rounded-full min-w-[1.2rem] text-center">
                          {thread.emails.length}
                        </span>
                      )}
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          handleStar(thread.emails[0].id, thread.emails[0].is_starred)
                        }}
                        className="text-lg hover:scale-110 active:scale-95 transition"
                      >
                        {thread.emails[0]?.is_starred ? '⭐' : '☆'}
                      </button>
                      {thread.emails[0]?.attachments && thread.emails[0].attachments.length > 0 && (
                        <span className="text-lg">📎</span>
                      )}
                    </div>
                  </div>
                </button>
              )
              })}
            </div>
          )}
        </div>
      </div>

      {/* Email Detail Column */}
      <div className="flex-1 bg-gray-50 overflow-y-auto">
        {showCompose ? (
          <div className="p-6">
            <div className="bg-white rounded-xl shadow-md border border-gray-200">
              {/* Compose Header */}
              <div className="bg-gray-50 border-b border-gray-200 px-6 py-4 flex justify-between items-center rounded-t-xl">
                <div className="flex items-center gap-3">
                  <span className="text-2xl">✉️</span>
                  <div>
                    <h2 className="text-lg font-bold text-gray-800">
                      {replyMode === 'reply' ? 'Reply' : replyMode === 'replyAll' ? 'Reply All' : replyMode === 'forward' ? 'Forward' : 'New Email'}
                    </h2>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <span className="inline-block w-2 h-2 bg-green-400 rounded-full animate-pulse"></span>
                      <span className="text-xs text-gray-500 font-medium">Online</span>
                    </div>
                  </div>
                </div>
                <button
                  onClick={resetCompose}
                  className="text-gray-400 hover:text-gray-600 hover:bg-gray-200 rounded-full w-8 h-8 flex items-center justify-center transition text-lg"
                >
                  ✕
                </button>
              </div>

              {/* Form Fields */}
              <div className="divide-y divide-gray-100">
                {/* From */}
                <div className="flex items-center px-6 py-3 hover:bg-gray-50 transition">
                  <span className="w-20 text-xs font-bold text-gray-400 uppercase tracking-wider flex-shrink-0">From:</span>
                  <div className="flex items-center gap-2 flex-1">
                    <span className="inline-block w-2 h-2 bg-green-500 rounded-full flex-shrink-0"></span>
                    <span className="text-sm text-gray-700 font-medium">
                      {(() => { try { const u = JSON.parse(localStorage.getItem('user') || '{}'); return u.email || 'me' } catch { return 'me' } })()}
                    </span>
                  </div>
                </div>

                {/* To */}
                <div className="px-6 py-3 hover:bg-gray-50 transition">
                  <div className="flex items-start gap-3">
                    <label className="w-20 text-xs font-bold text-gray-400 uppercase tracking-wider flex-shrink-0 pt-2.5">To:</label>
                    <div className="flex-1">
                      <EmailAutocompleteInput
                        value={composeData.to}
                        onChange={(v) => setComposeData({ ...composeData, to: v })}
                        placeholder="recipient@example.com ; another@example.com"
                        suggestions={knownEmails}
                      />
                      {composeData.to && (
                        <div className="flex flex-wrap gap-1.5 mt-2">
                          {parseEmails(composeData.to).map((email, idx) => (
                            <span key={idx} className="bg-blue-50 text-blue-700 border border-blue-200 px-2.5 py-0.5 rounded-full text-xs font-medium">
                              {email}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* CC */}
                <div className="px-6 py-3 hover:bg-gray-50 transition">
                  <div className="flex items-start gap-3">
                    <label className="w-20 text-xs font-bold text-gray-400 uppercase tracking-wider flex-shrink-0 pt-2.5">CC:</label>
                    <div className="flex-1">
                      <EmailAutocompleteInput
                        value={composeData.cc}
                        onChange={(v) => setComposeData({ ...composeData, cc: v })}
                        placeholder="cc@example.com ; another@example.com"
                        suggestions={knownEmails}
                      />
                      {composeData.cc && (
                        <div className="flex flex-wrap gap-1.5 mt-2">
                          {parseEmails(composeData.cc).map((email, idx) => (
                            <span key={idx} className="bg-purple-50 text-purple-700 border border-purple-200 px-2.5 py-0.5 rounded-full text-xs font-medium">
                              {email}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* BCC */}
                <div className="px-6 py-3 hover:bg-gray-50 transition">
                  <div className="flex items-start gap-3">
                    <label className="w-20 text-xs font-bold text-gray-400 uppercase tracking-wider flex-shrink-0 pt-2.5">BCC:</label>
                    <div className="flex-1">
                      <EmailAutocompleteInput
                        value={composeData.bcc}
                        onChange={(v) => setComposeData({ ...composeData, bcc: v })}
                        placeholder="bcc@example.com ; hidden@example.com"
                        suggestions={knownEmails}
                      />
                      {composeData.bcc && (
                        <div className="flex flex-wrap gap-1.5 mt-2">
                          {parseEmails(composeData.bcc).map((email, idx) => (
                            <span key={idx} className="bg-gray-50 text-gray-700 border border-gray-200 px-2.5 py-0.5 rounded-full text-xs font-medium">
                              {email}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Subject */}
                <div className="px-6 py-3 hover:bg-gray-50 transition">
                  <div className="flex items-center gap-3">
                    <label className="w-20 text-xs font-bold text-gray-400 uppercase tracking-wider flex-shrink-0">Subject:</label>
                    <input
                      type="text"
                      placeholder="Email subject"
                      value={composeData.subject}
                      onChange={(e) => setComposeData({ ...composeData, subject: e.target.value })}
                      className="flex-1 bg-transparent border-0 text-sm text-gray-800 placeholder-gray-400 focus:outline-none focus:ring-0 font-medium py-1"
                    />
                  </div>
                </div>
              </div>

              {/* Message body */}
              <div className="px-6 pt-2 pb-4">
                <div>
                  <label className="block text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">Message:</label>
                  {editor && (
                    <div className="border border-gray-200 rounded-lg overflow-hidden shadow-sm">
                      <div className="bg-gray-50 border-b border-gray-200 p-2 flex flex-wrap gap-1">
                        <div className="group relative">
                          <button onClick={() => editor.chain().focus().toggleBold().run()} disabled={!editor.can().chain().focus().toggleBold().run()} className={`w-8 h-8 flex items-center justify-center rounded text-sm font-bold transition disabled:opacity-40 ${editor.isActive('bold') ? 'bg-blue-500 text-white' : 'bg-gray-200 hover:bg-gray-300 text-gray-700'}`}><strong>B</strong></button>
                          <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 px-2 py-0.5 text-xs bg-gray-800 text-white rounded whitespace-nowrap invisible group-hover:visible z-10">Bold</span>
                        </div>
                        <div className="group relative">
                          <button onClick={() => editor.chain().focus().toggleItalic().run()} disabled={!editor.can().chain().focus().toggleItalic().run()} className={`w-8 h-8 flex items-center justify-center rounded text-sm font-bold transition disabled:opacity-40 ${editor.isActive('italic') ? 'bg-blue-500 text-white' : 'bg-gray-200 hover:bg-gray-300 text-gray-700'}`}><em>I</em></button>
                          <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 px-2 py-0.5 text-xs bg-gray-800 text-white rounded whitespace-nowrap invisible group-hover:visible z-10">Italic</span>
                        </div>
                        <div className="group relative">
                          <button onClick={() => editor.chain().focus().toggleStrike().run()} disabled={!editor.can().chain().focus().toggleStrike().run()} className={`w-8 h-8 flex items-center justify-center rounded text-sm font-bold transition disabled:opacity-40 ${editor.isActive('strike') ? 'bg-blue-500 text-white' : 'bg-gray-200 hover:bg-gray-300 text-gray-700'}`}><s>S</s></button>
                          <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 px-2 py-0.5 text-xs bg-gray-800 text-white rounded whitespace-nowrap invisible group-hover:visible z-10">Strikethrough</span>
                        </div>
                        <div className="w-px bg-gray-300 mx-0.5"></div>
                        <div className="group relative">
                          <button onClick={() => editor.chain().focus().toggleBulletList().run()} disabled={!editor.can().chain().focus().toggleBulletList().run()} className={`w-8 h-8 flex items-center justify-center rounded text-sm transition disabled:opacity-40 ${editor.isActive('bulletList') ? 'bg-blue-500 text-white' : 'bg-gray-200 hover:bg-gray-300 text-gray-700'}`}>•≡</button>
                          <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 px-2 py-0.5 text-xs bg-gray-800 text-white rounded whitespace-nowrap invisible group-hover:visible z-10">Bullet List</span>
                        </div>
                        <div className="group relative">
                          <button onClick={() => editor.chain().focus().toggleOrderedList().run()} disabled={!editor.can().chain().focus().toggleOrderedList().run()} className={`w-8 h-8 flex items-center justify-center rounded text-sm transition disabled:opacity-40 ${editor.isActive('orderedList') ? 'bg-blue-500 text-white' : 'bg-gray-200 hover:bg-gray-300 text-gray-700'}`}>1≡</button>
                          <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 px-2 py-0.5 text-xs bg-gray-800 text-white rounded whitespace-nowrap invisible group-hover:visible z-10">Ordered List</span>
                        </div>
                        <div className="w-px bg-gray-300 mx-0.5"></div>
                        <div className="group relative">
                          <button onClick={() => editor.chain().focus().undo().run()} disabled={!editor.can().chain().focus().undo().run()} className="w-8 h-8 flex items-center justify-center rounded text-sm bg-gray-200 hover:bg-gray-300 text-gray-700 transition disabled:opacity-40">↶</button>
                          <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 px-2 py-0.5 text-xs bg-gray-800 text-white rounded whitespace-nowrap invisible group-hover:visible z-10">Undo</span>
                        </div>
                        <div className="group relative">
                          <button onClick={() => editor.chain().focus().redo().run()} disabled={!editor.can().chain().focus().redo().run()} className="w-8 h-8 flex items-center justify-center rounded text-sm bg-gray-200 hover:bg-gray-300 text-gray-700 transition disabled:opacity-40">↷</button>
                          <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 px-2 py-0.5 text-xs bg-gray-800 text-white rounded whitespace-nowrap invisible group-hover:visible z-10">Redo</span>
                        </div>
                      </div>
                      <div
                        className="bg-white p-3 min-h-[16rem] overflow-y-auto cursor-text"
                        onClick={() => editor?.commands.focus()}
                      >
                        <EditorContent editor={editor} className="outline-none min-h-[14rem]" />
                      </div>
                    </div>
                  )}
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">📎 Attachments:</label>
                  <div className="flex items-center gap-2">
                    <input
                      type="file"
                      multiple
                      onChange={(e) => setComposeData({ ...composeData, attachments: Array.from(e.target.files || []) })}
                      className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-400"
                    />
                  </div>
                  {composeData.attachments.length > 0 && (
                    <div className="mt-2 space-y-1">
                      {composeData.attachments.map((file, idx) => (
                        <div key={idx} className="text-xs text-gray-600 flex justify-between items-center bg-gray-50 p-2 rounded">
                          <span>📄 {file.name}</span>
                          <button
                            onClick={() => {
                              const newAttachments = composeData.attachments.filter((_, i) => i !== idx)
                              setComposeData({ ...composeData, attachments: newAttachments })
                            }}
                            className="text-red-500 hover:text-red-700 font-bold"
                          >
                            ✕
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-3 pt-4 border-t border-gray-100 mt-2">
                  <button onClick={handleSend} className="bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2 px-6 rounded-lg transition flex items-center gap-2 shadow-sm">
                    <span>📤</span> Send
                  </button>
                  {signatures.length > 0 && (
                    <select
                      onChange={(e) => {
                        const sig = signatures.find(s => s.id === e.target.value)
                        if (sig && editor) {
                          // Insert separator
                          editor.chain()
                            .focus('end')
                            .insertContent('<p><br /></p><hr style="border: none; border-top: 2px solid #ddd; margin: 20px 0;" />')
                            .run()
                          
                          // Insert the formatted signature
                          const signatureHTML = generateSignatureHTML(sig)
                          editor.chain()
                            .focus('end')
                            .insertContent(signatureHTML)
                            .run()
                          
                          // Update compose data
                          setTimeout(() => {
                            setComposeData({ ...composeData, message: editor.getHTML() })
                          }, 100)
                          
                          e.target.value = ''
                        }
                      }}
                      className="bg-white border border-gray-200 text-gray-700 font-medium py-2 px-4 rounded-lg hover:bg-gray-50 transition text-sm shadow-sm"
                    >
                      <option value="">➕ Add Signature</option>
                      {signatures.map((sig) => (
                        <option key={sig.id} value={sig.id}>
                          {sig.name} {sig.isDefault ? '(default)' : ''}
                        </option>
                      ))}
                    </select>
                  )}
                  <div className="group relative">
                    <button
                      onClick={saveDraft}
                      className="bg-amber-500 hover:bg-amber-600 text-white p-2 rounded-lg transition text-lg"
                    >
                      💾
                    </button>
                    <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 px-2 py-0.5 text-xs bg-gray-800 text-white rounded whitespace-nowrap invisible group-hover:visible z-10">Save Draft</span>
                  </div>
                  <div className="group relative">
                    <button
                      onClick={resetCompose}
                      className="bg-gray-400 hover:bg-gray-500 text-white p-2 rounded-lg transition text-lg"
                    >
                      ✕
                    </button>
                    <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 px-2 py-0.5 text-xs bg-gray-800 text-white rounded whitespace-nowrap invisible group-hover:visible z-10">Cancel</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        ) : selectedThread ? (
          <div className="p-4 space-y-3">
            {replyMode === 'none' ? (
              <>
                {/* Thread header */}
                <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                  <div className="bg-gray-50 border-b border-gray-200 px-6 py-4 flex items-start gap-3">
                    <span className="text-2xl mt-0.5">📬</span>
                    <div className="flex-1 min-w-0">
                      <h2 className="text-lg font-bold text-gray-800 leading-snug truncate">{selectedThread.subject}</h2>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="text-xs text-gray-500">{selectedThread.emails.length} message{selectedThread.emails.length !== 1 ? 's' : ''} in thread</span>
                        {selectedThread.emails.some(e => !e.is_read) && (
                          <span className="bg-blue-500 text-white text-xs font-semibold px-2 py-0.5 rounded-full">Unread</span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Email cards */}
                {selectedThread.emails.map((email, emailIdx) => (
                  <div key={email.id} className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                    {/* Collapsed header */}
                    <button
                      onClick={() => setExpandedEmailId(expandedEmailId === email.id ? null : email.id)}
                      className="w-full text-left px-4 py-3 hover:bg-gray-50 transition flex items-center gap-3"
                    >
                      {/* Avatar */}
                      <div className="w-9 h-9 rounded-full bg-gradient-to-br from-blue-400 to-indigo-600 flex items-center justify-center text-white font-bold text-sm flex-shrink-0">
                        {(email.from_address || '?')[0].toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2">
                          <span className={`text-sm font-semibold truncate ${!email.is_read ? 'text-gray-900' : 'text-gray-700'}`}>
                            {email.from_address}
                          </span>
                          <span className="text-xs text-gray-400 whitespace-nowrap flex-shrink-0">
                            {new Date(email.received_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </div>
                        <div className="text-xs text-gray-400 truncate mt-0.5">
                          {email.is_starred ? '⭐ ' : ''}{emailIdx === selectedThread.emails.length - 1 ? 'Latest' : `Message ${emailIdx + 1}`}
                          {email.attachments && email.attachments.length > 0 ? ` · 📎 ${email.attachments.length}` : ''}
                        </div>
                      </div>
                      <span className="text-gray-400 text-xs flex-shrink-0">{expandedEmailId === email.id ? '▾' : '▸'}</span>
                    </button>

                    {expandedEmailId === email.id && (
                      <div className="border-t border-gray-100">
                        {/* Metadata rows */}
                        <div className="divide-y divide-gray-50 bg-gray-50/50 px-4 py-2">
                          <div className="flex items-start gap-3 py-1.5">
                            <span className="w-12 text-xs font-bold text-gray-400 uppercase tracking-wider flex-shrink-0 pt-0.5">From</span>
                            <span className="text-sm text-gray-800 break-all">{email.from_address}</span>
                          </div>
                          <div className="flex items-start gap-3 py-1.5">
                            <span className="w-12 text-xs font-bold text-gray-400 uppercase tracking-wider flex-shrink-0 pt-0.5">To</span>
                            <span className="text-sm text-gray-800 break-all">{email.to_address}</span>
                          </div>
                          {email.cc && (
                            <div className="flex items-start gap-3 py-1.5">
                              <span className="w-12 text-xs font-bold text-gray-400 uppercase tracking-wider flex-shrink-0 pt-0.5">CC</span>
                              <span className="text-sm text-gray-800 break-all">{email.cc}</span>
                            </div>
                          )}
                        </div>

                        {/* Email body */}
                        <div className="px-4 py-4">
                          <div className="bg-white rounded-lg border border-gray-100 p-4 overflow-auto max-h-[60vh] text-sm text-gray-800 leading-relaxed">
                            {email.body_html ? (
                              <div dangerouslySetInnerHTML={{ __html: email.body_html }} />
                            ) : (
                              <pre className="whitespace-pre-wrap font-sans">{email.body_text || 'No content'}</pre>
                            )}
                          </div>
                        </div>

                        {/* Attachments Section */}
                        {email.attachments && email.attachments.length > 0 && (
                          <div className="border-t border-gray-100 px-4 py-3">
                            <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">📎 Attachments ({email.attachments.length})</h4>
                            <div className="space-y-2">
                              {email.attachments.map((attachment: any, idx: number) => (
                                <div key={idx} className="flex items-center justify-between bg-white p-2 rounded-lg border border-gray-200 hover:border-blue-300 hover:shadow-sm transition">
                                  <div className="flex items-center gap-2 flex-1">
                                    <span className="text-lg">📄</span>
                                    <div className="flex-1 truncate">
                                      <p className="text-sm font-medium text-gray-800 truncate">{attachment.filename || `attachment_${idx}`}</p>
                                      {attachment.size && <p className="text-xs text-gray-500">{(attachment.size / 1024).toFixed(2)} KB</p>}
                                    </div>
                                  </div>
                                  <div className="flex items-center gap-2">
                                    {isBrowserFriendly(attachment) && (
                                      <div className="group relative">
                                        <button
                                          onClick={() => handleOpenAttachmentInBrowser(email.id, attachment)}
                                          className="bg-gray-100 hover:bg-gray-200 text-gray-700 p-2 rounded text-base transition"
                                        >
                                          🔗
                                        </button>
                                        <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 px-2 py-0.5 text-xs bg-gray-800 text-white rounded whitespace-nowrap invisible group-hover:visible z-10">Open in browser</span>
                                      </div>
                                    )}
                                    <div className="group relative">
                                      <button
                                        onClick={() => handleDownloadAttachment(email.id, attachment)}
                                        className="bg-blue-500 hover:bg-blue-600 text-white p-2 rounded text-base transition"
                                      >
                                        ⬇️
                                      </button>
                                      <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 px-2 py-0.5 text-xs bg-gray-800 text-white rounded whitespace-nowrap invisible group-hover:visible z-10">Download</span>
                                    </div>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Action Buttons */}
                        <div className="flex flex-wrap items-center gap-2 px-4 py-3 border-t border-gray-100 bg-gray-50/50">
                          <div className="group relative">
                            <button onClick={() => handleReply(email, selectedThread)} className="bg-blue-500 hover:bg-blue-600 text-white p-2 rounded-lg transition text-lg">↩️</button>
                            <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 px-2 py-0.5 text-xs bg-gray-800 text-white rounded whitespace-nowrap invisible group-hover:visible z-10">Reply</span>
                          </div>
                          <div className="group relative">
                            <button onClick={() => handleReplyAll(email, selectedThread)} className="bg-purple-500 hover:bg-purple-600 text-white p-2 rounded-lg transition text-lg">↩️↩️</button>
                            <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 px-2 py-0.5 text-xs bg-gray-800 text-white rounded whitespace-nowrap invisible group-hover:visible z-10">Reply All</span>
                          </div>
                          <div className="group relative">
                            <button onClick={() => handleForward(email, selectedThread)} className="bg-green-500 hover:bg-green-600 text-white p-2 rounded-lg transition text-lg">↪️</button>
                            <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 px-2 py-0.5 text-xs bg-gray-800 text-white rounded whitespace-nowrap invisible group-hover:visible z-10">Forward</span>
                          </div>
                          <div className="group relative">
                            <button onClick={() => handleMarkUnread(email.id)} className="bg-yellow-500 hover:bg-yellow-600 text-white p-2 rounded-lg transition text-lg">👁️</button>
                            <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 px-2 py-0.5 text-xs bg-gray-800 text-white rounded whitespace-nowrap invisible group-hover:visible z-10">Mark Unread</span>
                          </div>
                          <div className="group relative">
                            <button onClick={() => handleStar(email.id, email.is_starred)} className={`p-2 rounded-lg transition text-lg ${email.is_starred ? 'bg-amber-500 hover:bg-amber-600 text-white' : 'bg-gray-200 hover:bg-gray-300 text-gray-700'}`}>
                              {email.is_starred ? '⭐' : '☆'}
                            </button>
                            <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 px-2 py-0.5 text-xs bg-gray-800 text-white rounded whitespace-nowrap invisible group-hover:visible z-10">{email.is_starred ? 'Unstar' : 'Star'}</span>
                          </div>
                          <div className="group relative">
                            <button onClick={() => handleDelete(email.id)} className="bg-red-500 hover:bg-red-600 text-white p-2 rounded-lg transition text-lg">🗑️</button>
                            <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 px-2 py-0.5 text-xs bg-gray-800 text-white rounded whitespace-nowrap invisible group-hover:visible z-10">Delete</span>
                          </div>
                          {/* Labels */}
                          {customLabels.length > 0 && (
                            <div className="ml-auto flex flex-wrap gap-1.5">
                              {customLabels.map((label) => (
                                <button
                                  key={label.id}
                                  onClick={() => handleAssignLabel(email.id, label.id)}
                                  className={`px-2.5 py-1 rounded-full text-xs font-medium transition ${
                                    email.labels && email.labels.includes(label.id)
                                      ? `${label.color} text-gray-900 ring-2 ring-gray-400 ring-offset-1`
                                      : `${label.color} text-gray-600 opacity-60 hover:opacity-100`
                                  }`}
                                >
                                  {label.name}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </>
            ) : (
              <div className="bg-white rounded-xl shadow-md border border-gray-200">
                {/* Header */}
                <div className="bg-gray-50 border-b border-gray-200 px-6 py-4 flex justify-between items-center rounded-t-xl">
                  <div className="flex items-center gap-3">
                    <span className="text-2xl">{replyMode === 'forward' ? '↪️' : '↩️'}</span>
                    <div>
                      <h2 className="text-lg font-bold text-gray-800">{replyMode === 'reply' ? 'Reply' : replyMode === 'replyAll' ? 'Reply All' : 'Forward'}</h2>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <span className="inline-block w-2 h-2 bg-green-400 rounded-full animate-pulse"></span>
                        <span className="text-xs text-gray-500 font-medium">Online</span>
                      </div>
                    </div>
                  </div>
                  <button
                    onClick={() => { setReplyMode('none'); resetCompose() }}
                    className="text-gray-400 hover:text-gray-600 hover:bg-gray-200 rounded-full w-8 h-8 flex items-center justify-center transition text-lg"
                  >
                    ✕
                  </button>
                </div>

                {/* Form fields */}
                <div className="divide-y divide-gray-100">
                  {/* From */}
                  <div className="flex items-center px-6 py-3 hover:bg-gray-50 transition">
                    <span className="w-20 text-xs font-bold text-gray-400 uppercase tracking-wider flex-shrink-0">From:</span>
                    <div className="flex items-center gap-2 flex-1">
                      <span className="inline-block w-2 h-2 bg-green-500 rounded-full flex-shrink-0"></span>
                      <span className="text-sm text-gray-700 font-medium">
                        {(() => { try { const u = JSON.parse(localStorage.getItem('user') || '{}'); return u.email || 'me' } catch { return 'me' } })()}
                      </span>
                    </div>
                  </div>
                  {/* To */}
                  <div className="px-6 py-3 hover:bg-gray-50 transition">
                    <div className="flex items-start gap-3">
                      <label className="w-20 text-xs font-bold text-gray-400 uppercase tracking-wider flex-shrink-0 pt-2.5">To:</label>
                      <div className="flex-1">
                        <EmailAutocompleteInput
                          value={composeData.to}
                          onChange={(v) => setComposeData({ ...composeData, to: v })}
                          placeholder="recipient@example.com"
                          suggestions={knownEmails}
                        />
                        {composeData.to && (
                          <div className="flex flex-wrap gap-1.5 mt-2">
                            {parseEmails(composeData.to).map((email, idx) => (
                              <span key={idx} className="bg-blue-50 text-blue-700 border border-blue-200 px-2.5 py-0.5 rounded-full text-xs font-medium">{email}</span>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                  {/* CC */}
                  <div className="px-6 py-3 hover:bg-gray-50 transition">
                    <div className="flex items-start gap-3">
                      <label className="w-20 text-xs font-bold text-gray-400 uppercase tracking-wider flex-shrink-0 pt-2.5">CC:</label>
                      <div className="flex-1">
                        <EmailAutocompleteInput
                          value={composeData.cc}
                          onChange={(v) => setComposeData({ ...composeData, cc: v })}
                          placeholder="cc@example.com"
                          suggestions={knownEmails}
                        />
                        {composeData.cc && (
                          <div className="flex flex-wrap gap-1.5 mt-2">
                            {parseEmails(composeData.cc).map((email, idx) => (
                              <span key={idx} className="bg-purple-50 text-purple-700 border border-purple-200 px-2.5 py-0.5 rounded-full text-xs font-medium">{email}</span>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                  {/* BCC */}
                  <div className="px-6 py-3 hover:bg-gray-50 transition">
                    <div className="flex items-start gap-3">
                      <label className="w-20 text-xs font-bold text-gray-400 uppercase tracking-wider flex-shrink-0 pt-2.5">BCC:</label>
                      <div className="flex-1">
                        <EmailAutocompleteInput
                          value={composeData.bcc}
                          onChange={(v) => setComposeData({ ...composeData, bcc: v })}
                          placeholder="bcc@example.com"
                          suggestions={knownEmails}
                        />
                        {composeData.bcc && (
                          <div className="flex flex-wrap gap-1.5 mt-2">
                            {parseEmails(composeData.bcc).map((email, idx) => (
                              <span key={idx} className="bg-gray-50 text-gray-700 border border-gray-200 px-2.5 py-0.5 rounded-full text-xs font-medium">{email}</span>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                  {/* Subject */}
                  <div className="px-6 py-3 hover:bg-gray-50 transition">
                    <div className="flex items-center gap-3">
                      <label className="w-20 text-xs font-bold text-gray-400 uppercase tracking-wider flex-shrink-0">Subject:</label>
                      <input
                        type="text"
                        placeholder="Email subject"
                        value={composeData.subject}
                        onChange={(e) => setComposeData({ ...composeData, subject: e.target.value })}
                        className="flex-1 bg-transparent border-0 text-sm text-gray-800 placeholder-gray-400 focus:outline-none focus:ring-0 font-medium py-1"
                      />
                    </div>
                  </div>
                </div>

                {/* Message body */}
                <div className="px-6 pt-2 pb-4">
                  <div>
                    <label className="block text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">Message:</label>
                    {editor && (
                      <div className="border border-gray-200 rounded-lg overflow-hidden shadow-sm">
                        <div className="bg-gray-50 border-b border-gray-200 p-2 flex flex-wrap gap-1">
                          <div className="group relative">
                            <button onClick={() => editor.chain().focus().toggleBold().run()} disabled={!editor.can().chain().focus().toggleBold().run()} className={`w-8 h-8 flex items-center justify-center rounded text-sm font-bold transition disabled:opacity-40 ${editor.isActive('bold') ? 'bg-blue-500 text-white' : 'bg-gray-200 hover:bg-gray-300 text-gray-700'}`}><strong>B</strong></button>
                            <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 px-2 py-0.5 text-xs bg-gray-800 text-white rounded whitespace-nowrap invisible group-hover:visible z-10">Bold</span>
                          </div>
                          <div className="group relative">
                            <button onClick={() => editor.chain().focus().toggleItalic().run()} disabled={!editor.can().chain().focus().toggleItalic().run()} className={`w-8 h-8 flex items-center justify-center rounded text-sm font-bold transition disabled:opacity-40 ${editor.isActive('italic') ? 'bg-blue-500 text-white' : 'bg-gray-200 hover:bg-gray-300 text-gray-700'}`}><em>I</em></button>
                            <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 px-2 py-0.5 text-xs bg-gray-800 text-white rounded whitespace-nowrap invisible group-hover:visible z-10">Italic</span>
                          </div>
                          <div className="group relative">
                            <button onClick={() => editor.chain().focus().toggleStrike().run()} disabled={!editor.can().chain().focus().toggleStrike().run()} className={`w-8 h-8 flex items-center justify-center rounded text-sm font-bold transition disabled:opacity-40 ${editor.isActive('strike') ? 'bg-blue-500 text-white' : 'bg-gray-200 hover:bg-gray-300 text-gray-700'}`}><s>S</s></button>
                            <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 px-2 py-0.5 text-xs bg-gray-800 text-white rounded whitespace-nowrap invisible group-hover:visible z-10">Strikethrough</span>
                          </div>
                          <div className="w-px bg-gray-300 mx-0.5"></div>
                          <div className="group relative">
                            <button onClick={() => editor.chain().focus().toggleBulletList().run()} disabled={!editor.can().chain().focus().toggleBulletList().run()} className={`w-8 h-8 flex items-center justify-center rounded text-sm transition disabled:opacity-40 ${editor.isActive('bulletList') ? 'bg-blue-500 text-white' : 'bg-gray-200 hover:bg-gray-300 text-gray-700'}`}>•≡</button>
                            <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 px-2 py-0.5 text-xs bg-gray-800 text-white rounded whitespace-nowrap invisible group-hover:visible z-10">Bullet List</span>
                          </div>
                          <div className="group relative">
                            <button onClick={() => editor.chain().focus().toggleOrderedList().run()} disabled={!editor.can().chain().focus().toggleOrderedList().run()} className={`w-8 h-8 flex items-center justify-center rounded text-sm transition disabled:opacity-40 ${editor.isActive('orderedList') ? 'bg-blue-500 text-white' : 'bg-gray-200 hover:bg-gray-300 text-gray-700'}`}>1≡</button>
                            <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 px-2 py-0.5 text-xs bg-gray-800 text-white rounded whitespace-nowrap invisible group-hover:visible z-10">Ordered List</span>
                          </div>
                          <div className="w-px bg-gray-300 mx-0.5"></div>
                          <div className="group relative">
                            <button onClick={() => editor.chain().focus().undo().run()} disabled={!editor.can().chain().focus().undo().run()} className="w-8 h-8 flex items-center justify-center rounded text-sm bg-gray-200 hover:bg-gray-300 text-gray-700 transition disabled:opacity-40">↶</button>
                            <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 px-2 py-0.5 text-xs bg-gray-800 text-white rounded whitespace-nowrap invisible group-hover:visible z-10">Undo</span>
                          </div>
                          <div className="group relative">
                            <button onClick={() => editor.chain().focus().redo().run()} disabled={!editor.can().chain().focus().redo().run()} className="w-8 h-8 flex items-center justify-center rounded text-sm bg-gray-200 hover:bg-gray-300 text-gray-700 transition disabled:opacity-40">↷</button>
                            <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 px-2 py-0.5 text-xs bg-gray-800 text-white rounded whitespace-nowrap invisible group-hover:visible z-10">Redo</span>
                          </div>
                        </div>
                        <div 
                          className="bg-white p-3 min-h-[16rem] overflow-y-auto cursor-text"
                          onClick={() => editor?.commands.focus()}
                        >
                          <EditorContent editor={editor} className="outline-none w-full min-h-[14rem]" />
                        </div>
                      </div>
                    )}
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">📎 Attachments:</label>
                    <div className="flex items-center gap-2">
                      <input
                        type="file"
                        multiple
                        onChange={(e) => setComposeData({ ...composeData, attachments: Array.from(e.target.files || []) })}
                        className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-400"
                      />
                    </div>
                    {composeData.attachments.length > 0 && (
                      <div className="mt-2 space-y-1">
                        {composeData.attachments.map((file, idx) => (
                          <div key={idx} className="text-xs text-gray-600 flex justify-between items-center bg-gray-50 p-2 rounded">
                            <span>📄 {file.name}</span>
                            <button
                              onClick={() => {
                                const newAttachments = composeData.attachments.filter((_, i) => i !== idx)
                                setComposeData({ ...composeData, attachments: newAttachments })
                              }}
                              className="text-red-500 hover:text-red-700 font-bold"
                            >
                              ✕
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-3 pt-4 border-t border-gray-100">
                    <button onClick={handleSend} className="bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2 px-6 rounded-lg transition flex items-center gap-2 shadow-sm">
                      <span>📤</span> Send
                    </button>
                    {signatures.length > 0 && (
                      <select
                        onChange={(e) => {
                          const sig = signatures.find(s => s.id === e.target.value)
                          if (sig && editor) {
                            // Insert separator first
                            editor.chain()
                              .focus('end')
                              .insertContent('<p><br></p><hr style="border: none; border-top: 2px solid #ddd; margin: 20px 0;" />')
                              .run()
                            
                            // Insert logo if available
                            if (sig.imageData) {
                              editor.chain()
                                .focus('end')
                                .insertContent('<p><img src="' + sig.imageData + '" style="max-width: 150px; height: auto; border-radius: 4px; margin: 10px 0;" /></p>')
                                .run()
                            }
                            
                            // Insert signature text
                            editor.chain()
                              .focus('end')
                              .insertContent('<pre style="color: #444; font-size: 13px; font-family: Courier, monospace; line-height: 1.5; white-space: pre-wrap; word-wrap: break-word; margin: 0;">' + sig.content.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</pre>')
                              .run()
                            
                            // Update composeData to store the updated message
                            setComposeData({ ...composeData, message: editor.getHTML() })
                            e.target.value = ''
                          }
                        }}
                        className="bg-white border border-gray-200 text-gray-700 font-medium py-2 px-4 rounded-lg hover:bg-gray-50 transition text-sm shadow-sm"
                      >
                        <option value="">➕ Add Signature</option>
                        {signatures.map((sig) => (
                          <option key={sig.id} value={sig.id}>
                            {sig.name} {sig.isDefault ? '(default)' : ''}
                          </option>
                        ))}
                      </select>
                    )}
                    <div className="group relative">
                      <button onClick={saveDraft} className="bg-amber-500 hover:bg-amber-600 text-white p-2 rounded-lg transition text-lg">💾</button>
                      <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 px-2 py-0.5 text-xs bg-gray-800 text-white rounded whitespace-nowrap invisible group-hover:visible z-10">Save Draft</span>
                    </div>
                    <div className="group relative">
                      <button onClick={() => { setReplyMode('none'); resetCompose() }} className="bg-gray-400 hover:bg-gray-500 text-white p-2 rounded-lg transition text-lg">✕</button>
                      <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 px-2 py-0.5 text-xs bg-gray-800 text-white rounded whitespace-nowrap invisible group-hover:visible z-10">Cancel</span>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="h-full flex flex-col items-center justify-center gap-3 text-gray-400">
            <span className="text-5xl">📬</span>
            <p className="text-base font-medium">Select an email to read</p>
            <p className="text-sm">Choose a conversation from the list on the left</p>
          </div>
        )}
      </div>
      {/* Create Smart Folder Modal */}
      {showCreateSmartFolder && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4 shadow-xl">
            <h2 className="text-2xl font-bold mb-4">Create Smart Folder</h2>
            
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">Folder Name:</label>
                <input
                  type="text"
                  placeholder="e.g., From Boss, Important Keywords"
                  value={smartFolderForm.label}
                  onChange={(e) => setSmartFolderForm({ ...smartFolderForm, label: e.target.value })}
                  className="w-full border border-gray-300 rounded px-3 py-2 focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">Icon:</label>
                <select
                  value={smartFolderForm.icon}
                  onChange={(e) => setSmartFolderForm({ ...smartFolderForm, icon: e.target.value })}
                  className="w-full border border-gray-300 rounded px-3 py-2 focus:outline-none focus:border-indigo-500"
                >
                  <option value="📁">📁 Folder</option>
                  <option value="💼">💼 Work</option>
                  <option value="👥">👥 People</option>
                  <option value="🎯">🎯 Important</option>
                  <option value="📌">📌 Pinned</option>
                  <option value="🏷️">🏷️ Tagged</option>
                  <option value="📧">📧 Messages</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">Filter Type:</label>
                <select
                  value={smartFolderForm.filterType}
                  onChange={(e) => setSmartFolderForm({ ...smartFolderForm, filterType: e.target.value as any })}
                  className="w-full border border-gray-300 rounded px-3 py-2 focus:outline-none focus:border-indigo-500"
                >
                  <option value="sender">From Sender (email address)</option>
                  <option value="domain">From Domain (*@domain.com)</option>
                  <option value="subject">Subject Contains</option>
                  <option value="keyword">Contains Keyword (subject or body)</option>
                  <option value="hasAttachments">Has Attachments</option>
                  <option value="isStarred">Starred Emails</option>
                </select>
              </div>

              {smartFolderForm.filterType !== 'hasAttachments' && smartFolderForm.filterType !== 'isStarred' && (
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">
                    {smartFolderForm.filterType === 'sender' && 'Email Address:'}
                    {smartFolderForm.filterType === 'domain' && 'Domain (without @):'}
                    {smartFolderForm.filterType === 'subject' && 'Subject Contains:'}
                    {smartFolderForm.filterType === 'keyword' && 'Keyword:'}
                  </label>
                  <input
                    type="text"
                    placeholder={
                      smartFolderForm.filterType === 'sender' ? 'john@example.com' :
                      smartFolderForm.filterType === 'domain' ? 'gmail.com' :
                      smartFolderForm.filterType === 'subject' ? 'e.g., Project Update' :
                      'Search term'
                    }
                    value={smartFolderForm.value}
                    onChange={(e) => setSmartFolderForm({ ...smartFolderForm, value: e.target.value })}
                    className="w-full border border-gray-300 rounded px-3 py-2 focus:outline-none focus:border-indigo-500"
                  />
                </div>
              )}

              <div className="flex gap-2 pt-4">
                <button
                  onClick={createSmartFolder}
                  className="flex-1 bg-indigo-500 hover:bg-indigo-600 text-white font-semibold py-2 px-4 rounded transition"
                >
                  ✓ Create
                </button>
                <button
                  onClick={() => setShowCreateSmartFolder(false)}
                  className="flex-1 bg-gray-300 hover:bg-gray-400 text-gray-800 font-semibold py-2 px-4 rounded transition"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Compose Guard Modal */}
      {showComposeGuard && pendingThread && (
        <div className="fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 max-w-sm w-full mx-4 shadow-xl border border-gray-200">
            <div className="flex items-center gap-3 mb-4">
              <span className="text-2xl">✉️</span>
              <div>
                <h3 className="font-bold text-gray-800">You&apos;re composing an email</h3>
                <p className="text-sm text-gray-500 mt-0.5">What would you like to do with it?</p>
              </div>
            </div>
            <div className="flex flex-col gap-2">
              <button
                onClick={async () => {
                  await handleSend()
                  setShowComposeGuard(false)
                  setSelectedThread(pendingThread)
                  setPendingThread(null)
                }}
                className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2 px-4 rounded-lg transition flex items-center gap-2"
              >
                <span>📤</span> Send &amp; Open Email
              </button>
              <button
                onClick={async () => {
                  await saveDraft()
                  resetCompose()
                  setShowComposeGuard(false)
                  setSelectedThread(pendingThread)
                  setPendingThread(null)
                }}
                className="w-full bg-amber-500 hover:bg-amber-600 text-white font-semibold py-2 px-4 rounded-lg transition flex items-center gap-2"
              >
                <span>💾</span> Save Draft &amp; Open Email
              </button>
              <button
                onClick={() => {
                  resetCompose()
                  setShowComposeGuard(false)
                  setSelectedThread(pendingThread)
                  setPendingThread(null)
                }}
                className="w-full bg-red-500 hover:bg-red-600 text-white font-semibold py-2 px-4 rounded-lg transition flex items-center gap-2"
              >
                <span>🗑️</span> Discard &amp; Open Email
              </button>
              <button
                onClick={() => { setShowComposeGuard(false); setPendingThread(null) }}
                className="w-full bg-gray-100 hover:bg-gray-200 text-gray-700 font-semibold py-2 px-4 rounded-lg transition"
              >
                Cancel (keep composing)
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Create Label Modal */}
      {showCreateLabel && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4 shadow-xl">
            <h2 className="text-2xl font-bold mb-4">Create Label</h2>
            
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">Label Name:</label>
                <input
                  type="text"
                  placeholder="e.g., Job Application, Resignation"
                  value={newLabelName}
                  onChange={(e) => setNewLabelName(e.target.value)}
                  className="w-full border border-gray-300 rounded px-3 py-2 focus:outline-none focus:border-green-500"
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">Color:</label>
                <div className="grid grid-cols-4 gap-2">
                  {labelColors.map((color) => (
                    <button
                      key={color}
                      onClick={() => setSelectedLabelColor(color)}
                      className={`h-8 rounded border-2 transition ${
                        selectedLabelColor === color ? 'border-gray-800' : 'border-gray-300'
                      } ${color}`}
                      title={color}
                    />
                  ))}
                </div>
              </div>

              <div className="flex gap-2 pt-4">
                <button
                  onClick={createLabel}
                  className="flex-1 bg-green-500 hover:bg-green-600 text-white font-semibold py-2 px-4 rounded transition"
                >
                  ✓ Create
                </button>
                <button
                  onClick={() => {
                    setShowCreateLabel(false)
                    setNewLabelName('')
                    setSelectedLabelColor('bg-blue-100')
                  }}
                  className="flex-1 bg-gray-300 hover:bg-gray-400 text-gray-800 font-semibold py-2 px-4 rounded transition"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Signatures Settings Modal */}
      {showSignatureSettings && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-2xl w-full mx-4 shadow-xl max-h-96 overflow-y-auto">
            <h2 className="text-2xl font-bold mb-4">Email Signatures</h2>
            
            <div className="space-y-4">
              {/* Create New Signature */}
              <div className="border-b pb-4">
                <h3 className="font-semibold text-gray-700 mb-3">Create Professional Signature</h3>
                <div className="space-y-3 grid grid-cols-2 gap-3">
                  <div className="col-span-2">
                    <label className="block text-sm font-semibold text-gray-700 mb-1">Signature Name:</label>
                    <input
                      type="text"
                      placeholder="e.g., Main, Official"
                      value={newSignatureName}
                      onChange={(e) => setNewSignatureName(e.target.value)}
                      className="w-full border border-gray-300 rounded px-3 py-2 focus:outline-none focus:border-purple-500"
                    />
                  </div>
                  
                  <div className="col-span-2">
                    <label className="block text-sm font-semibold text-gray-700 mb-1">Closing Statement:</label>
                    <input
                      type="text"
                      placeholder="e.g., Thanking you, Best regards"
                      value={newSignatureClosing}
                      onChange={(e) => setNewSignatureClosing(e.target.value)}
                      className="w-full border border-gray-300 rounded px-3 py-2 focus:outline-none focus:border-purple-500 text-sm"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-1">Full Name:</label>
                    <input
                      type="text"
                      placeholder="e.g., Rajendra Maharjan"
                      value={newSignatureFullName}
                      onChange={(e) => setNewSignatureFullName(e.target.value)}
                      className="w-full border border-gray-300 rounded px-3 py-2 focus:outline-none focus:border-purple-500 text-sm"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-1">Title:</label>
                    <input
                      type="text"
                      placeholder="e.g., Managing Director"
                      value={newSignatureTitle}
                      onChange={(e) => setNewSignatureTitle(e.target.value)}
                      className="w-full border border-gray-300 rounded px-3 py-2 focus:outline-none focus:border-purple-500 text-sm"
                    />
                  </div>

                  <div className="col-span-2">
                    <label className="block text-sm font-semibold text-gray-700 mb-1">Company:</label>
                    <input
                      type="text"
                      placeholder="e.g., Podami Nepal"
                      value={newSignatureCompany}
                      onChange={(e) => setNewSignatureCompany(e.target.value)}
                      className="w-full border border-gray-300 rounded px-3 py-2 focus:outline-none focus:border-purple-500 text-sm"
                    />
                  </div>

                  <div className="col-span-2">
                    <label className="block text-sm font-semibold text-gray-700 mb-1">Address:</label>
                    <input
                      type="text"
                      placeholder="e.g., Teku Road, Tripureshwore, Kathmandu, Nepal"
                      value={newSignatureAddress}
                      onChange={(e) => setNewSignatureAddress(e.target.value)}
                      className="w-full border border-gray-300 rounded px-3 py-2 focus:outline-none focus:border-purple-500 text-sm"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-1">Phone (Office):</label>
                    <input
                      type="tel"
                      placeholder="e.g., +977 1 4101043"
                      value={newSignaturePhoneOffice}
                      onChange={(e) => setNewSignaturePhoneOffice(e.target.value)}
                      className="w-full border border-gray-300 rounded px-3 py-2 focus:outline-none focus:border-purple-500 text-sm"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-1">Mobile:</label>
                    <input
                      type="tel"
                      placeholder="e.g., +977 9801147370"
                      value={newSignaturePhoneMobile}
                      onChange={(e) => setNewSignaturePhoneMobile(e.target.value)}
                      className="w-full border border-gray-300 rounded px-3 py-2 focus:outline-none focus:border-purple-500 text-sm"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-1">Email:</label>
                    <input
                      type="email"
                      placeholder="e.g., rajendra@podamibenepal.com"
                      value={newSignatureEmail}
                      onChange={(e) => setNewSignatureEmail(e.target.value)}
                      className="w-full border border-gray-300 rounded px-3 py-2 focus:outline-none focus:border-purple-500 text-sm"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-1">Website:</label>
                    <input
                      type="url"
                      placeholder="e.g., https://www.podamibenepal.com"
                      value={newSignatureWebsite}
                      onChange={(e) => setNewSignatureWebsite(e.target.value)}
                      className="w-full border border-gray-300 rounded px-3 py-2 focus:outline-none focus:border-purple-500 text-sm"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-1">Skype:</label>
                    <input
                      type="text"
                      placeholder="e.g., rajmaha570"
                      value={newSignatureSkype}
                      onChange={(e) => setNewSignatureSkype(e.target.value)}
                      className="w-full border border-gray-300 rounded px-3 py-2 focus:outline-none focus:border-purple-500 text-sm"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-1">Viber:</label>
                    <input
                      type="tel"
                      placeholder="e.g., +977 9851047370"
                      value={newSignatureViber}
                      onChange={(e) => setNewSignatureViber(e.target.value)}
                      className="w-full border border-gray-300 rounded px-3 py-2 focus:outline-none focus:border-purple-500 text-sm"
                    />
                  </div>

                  <div className="col-span-2">
                    <label className="block text-sm font-semibold text-gray-700 mb-1">Logo/Image (Optional):</label>
                    <label className="flex items-center justify-center w-full px-4 py-3 border-2 border-dashed border-purple-300 rounded bg-purple-50 hover:bg-purple-100 cursor-pointer transition">
                      <div className="text-center">
                        <span className="text-2xl mb-1 block">🖼️</span>
                        <span className="text-sm font-medium text-purple-700">Click to upload logo/image</span>
                      </div>
                      <input
                        type="file"
                        accept="image/*"
                        onChange={handleNewSignatureImageUpload}
                        className="hidden"
                      />
                    </label>
                    {newSignatureImage && (
                      <div className="mt-2 flex items-center gap-2 p-2 bg-purple-50 rounded">
                        <img src={newSignatureImage} alt="Logo preview" className="h-12 w-auto rounded border" />
                        <button
                          onClick={() => setNewSignatureImage(null)}
                          className="text-xs bg-red-100 text-red-700 hover:bg-red-200 px-2 py-1 rounded"
                        >
                          ✕ Remove
                        </button>
                      </div>
                    )}
                  </div>

                  <button
                    onClick={createSignature}
                    className="col-span-2 w-full bg-purple-500 hover:bg-purple-600 text-white font-semibold py-2 px-4 rounded transition"
                  >
                    + Create Signature
                  </button>
                </div>
              </div>

              {/* List Existing Signatures */}
              <div>
                <h3 className="font-semibold text-gray-700 mb-3">Your Signatures</h3>
                {signatures.length === 0 ? (
                  <p className="text-gray-500 text-sm">No signatures created yet</p>
                ) : (
                  <div className="space-y-2">
                    {signatures.map((sig) => (
                      <div key={sig.id} className="bg-gray-50 p-3 rounded border border-gray-200">
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-2">
                            {sig.imageData && (
                              <img src={sig.imageData} alt={sig.name} className="h-8 w-auto rounded" />
                            )}
                            <span className="font-semibold text-gray-800">{sig.name}</span>
                            {sig.isDefault && (
                              <span className="text-xs bg-blue-100 text-blue-700 px-2 py-1 rounded">Default</span>
                            )}
                          </div>
                          <div className="flex gap-2">
                            <button
                              onClick={() => startEditSignature(sig)}
                              className="text-xs bg-amber-100 text-amber-700 hover:bg-amber-200 px-2 py-1 rounded transition"
                            >
                              ✏️ Edit
                            </button>
                            {!sig.isDefault && (
                              <button
                                onClick={() => setDefaultSignature(sig.id)}
                                className="text-xs bg-blue-100 text-blue-700 hover:bg-blue-200 px-2 py-1 rounded transition"
                              >
                                Set Default
                              </button>
                            )}
                            <button
                              onClick={() => deleteSignature(sig.id)}
                              className="text-xs bg-red-100 text-red-700 hover:bg-red-200 px-2 py-1 rounded transition"
                            >
                              Delete
                            </button>
                          </div>
                        </div>
                        {sig.imageData && (
                          <div className="mb-2 pb-2 border-b">
                            <img src={sig.imageData} alt={sig.name} className="h-16 w-auto rounded" />
                          </div>
                        )}
                        <div className="text-xs bg-white p-2 rounded border border-gray-300 overflow-auto max-h-24 text-gray-700 space-y-1">
                          {sig.closingStatement && <p><strong>{sig.closingStatement}</strong></p>}
                          {sig.fullName && <p><strong>{sig.fullName}</strong></p>}
                          {sig.title && <p>{sig.title}</p>}
                          {sig.company && <p>{sig.company}</p>}
                          {sig.address && <p>{sig.address}</p>}
                          {(sig.phoneOffice || sig.phoneMobile || sig.email || sig.website) && (
                            <div className="text-xs">
                              {sig.phoneOffice && <p>Phone: {sig.phoneOffice}</p>}
                              {sig.phoneMobile && <p>Mobile: {sig.phoneMobile}</p>}
                              {sig.email && <p>Email: {sig.email}</p>}
                              {sig.website && <p>Web: {sig.website}</p>}
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Edit Signature Form */}
              {editingSignatureId && (
                <div className="border-t pt-4">
                  <h3 className="font-semibold text-gray-700 mb-3">Edit Signature</h3>
                  <div className="space-y-3 grid grid-cols-2 gap-3">
                    <div className="col-span-2">
                      <label className="block text-sm font-semibold text-gray-700 mb-1">Signature Name:</label>
                      <input
                        type="text"
                        placeholder="e.g., Main, Official"
                        value={editSignatureName}
                        onChange={(e) => setEditSignatureName(e.target.value)}
                        className="w-full border border-gray-300 rounded px-3 py-2 focus:outline-none focus:border-amber-500"
                      />
                    </div>
                    
                    <div className="col-span-2">
                      <label className="block text-sm font-semibold text-gray-700 mb-1">Closing Statement:</label>
                      <input
                        type="text"
                        placeholder="e.g., Thanking you, Best regards"
                        value={editSignatureClosing}
                        onChange={(e) => setEditSignatureClosing(e.target.value)}
                        className="w-full border border-gray-300 rounded px-3 py-2 focus:outline-none focus:border-amber-500 text-sm"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-semibold text-gray-700 mb-1">Full Name:</label>
                      <input
                        type="text"
                        placeholder="e.g., Rajendra Maharjan"
                        value={editSignatureFullName}
                        onChange={(e) => setEditSignatureFullName(e.target.value)}
                        className="w-full border border-gray-300 rounded px-3 py-2 focus:outline-none focus:border-amber-500 text-sm"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-semibold text-gray-700 mb-1">Title:</label>
                      <input
                        type="text"
                        placeholder="e.g., Managing Director"
                        value={editSignatureTitle}
                        onChange={(e) => setEditSignatureTitle(e.target.value)}
                        className="w-full border border-gray-300 rounded px-3 py-2 focus:outline-none focus:border-amber-500 text-sm"
                      />
                    </div>

                    <div className="col-span-2">
                      <label className="block text-sm font-semibold text-gray-700 mb-1">Company:</label>
                      <input
                        type="text"
                        placeholder="e.g., Podami Nepal"
                        value={editSignatureCompany}
                        onChange={(e) => setEditSignatureCompany(e.target.value)}
                        className="w-full border border-gray-300 rounded px-3 py-2 focus:outline-none focus:border-amber-500 text-sm"
                      />
                    </div>

                    <div className="col-span-2">
                      <label className="block text-sm font-semibold text-gray-700 mb-1">Address:</label>
                      <input
                        type="text"
                        placeholder="e.g., Teku Road, Tripureshwore, Kathmandu, Nepal"
                        value={editSignatureAddress}
                        onChange={(e) => setEditSignatureAddress(e.target.value)}
                        className="w-full border border-gray-300 rounded px-3 py-2 focus:outline-none focus:border-amber-500 text-sm"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-semibold text-gray-700 mb-1">Phone (Office):</label>
                      <input
                        type="tel"
                        placeholder="e.g., +977 1 4101043"
                        value={editSignaturePhoneOffice}
                        onChange={(e) => setEditSignaturePhoneOffice(e.target.value)}
                        className="w-full border border-gray-300 rounded px-3 py-2 focus:outline-none focus:border-amber-500 text-sm"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-semibold text-gray-700 mb-1">Mobile:</label>
                      <input
                        type="tel"
                        placeholder="e.g., +977 9801147370"
                        value={editSignaturePhoneMobile}
                        onChange={(e) => setEditSignaturePhoneMobile(e.target.value)}
                        className="w-full border border-gray-300 rounded px-3 py-2 focus:outline-none focus:border-amber-500 text-sm"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-semibold text-gray-700 mb-1">Email:</label>
                      <input
                        type="email"
                        placeholder="e.g., rajendra@podamibenepal.com"
                        value={editSignatureEmail}
                        onChange={(e) => setEditSignatureEmail(e.target.value)}
                        className="w-full border border-gray-300 rounded px-3 py-2 focus:outline-none focus:border-amber-500 text-sm"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-semibold text-gray-700 mb-1">Website:</label>
                      <input
                        type="url"
                        placeholder="e.g., https://www.podamibenepal.com"
                        value={editSignatureWebsite}
                        onChange={(e) => setEditSignatureWebsite(e.target.value)}
                        className="w-full border border-gray-300 rounded px-3 py-2 focus:outline-none focus:border-amber-500 text-sm"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-semibold text-gray-700 mb-1">Skype:</label>
                      <input
                        type="text"
                        placeholder="e.g., rajmaha570"
                        value={editSignatureSkype}
                        onChange={(e) => setEditSignatureSkype(e.target.value)}
                        className="w-full border border-gray-300 rounded px-3 py-2 focus:outline-none focus:border-amber-500 text-sm"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-semibold text-gray-700 mb-1">Viber:</label>
                      <input
                        type="tel"
                        placeholder="e.g., +977 9851047370"
                        value={editSignatureViber}
                        onChange={(e) => setEditSignatureViber(e.target.value)}
                        className="w-full border border-gray-300 rounded px-3 py-2 focus:outline-none focus:border-amber-500 text-sm"
                      />
                    </div>

                    <div className="col-span-2">
                      <label className="block text-sm font-semibold text-gray-700 mb-1">Logo/Image (Optional):</label>
                      <label className="flex items-center justify-center w-full px-4 py-3 border-2 border-dashed border-amber-300 rounded bg-amber-50 hover:bg-amber-100 cursor-pointer transition">
                        <div className="text-center">
                          <span className="text-2xl mb-1 block">🖼️</span>
                          <span className="text-sm font-medium text-amber-700">Click to upload logo/image</span>
                        </div>
                        <input
                          type="file"
                          accept="image/*"
                          onChange={handleEditSignatureImageUpload}
                          className="hidden"
                        />
                      </label>
                      {editSignatureImage && (
                        <div className="mt-2 flex items-center gap-2 p-2 bg-amber-50 rounded">
                          <img src={editSignatureImage} alt="Logo preview" className="h-12 w-auto rounded border" />
                          <button
                            onClick={() => setEditSignatureImage(null)}
                            className="text-xs bg-red-100 text-red-700 hover:bg-red-200 px-2 py-1 rounded"
                          >
                            ✕ Remove
                          </button>
                        </div>
                      )}
                    </div>
                    
                    <button
                      onClick={updateSignature}
                      className="col-span-1 bg-amber-500 hover:bg-amber-600 text-white font-semibold py-2 px-4 rounded transition"
                    >
                      💾 Save Changes
                    </button>
                    <button
                      onClick={cancelEditSignature}
                      className="col-span-1 bg-gray-300 hover:bg-gray-400 text-gray-800 font-semibold py-2 px-4 rounded transition"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
              <div className="flex gap-2 pt-4">
                <button
                  onClick={() => setShowSignatureSettings(false)}
                  className="flex-1 bg-gray-300 hover:bg-gray-400 text-gray-800 font-semibold py-2 px-4 rounded transition"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
