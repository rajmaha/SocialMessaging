'use client'

import React, { useState, useEffect, useRef } from 'react'
import axios from 'axios'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { Blockquote } from '@tiptap/extension-blockquote'
import Underline from '@tiptap/extension-underline'
import { TextStyle, Color } from '@tiptap/extension-text-style'
import Image from '@tiptap/extension-image'

// Extend Blockquote to preserve inline style attributes (needed so quoted
// reply content keeps its border-left styling when serialised back to HTML).
const StyledBlockquote = Blockquote.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      style: {
        default: null,
        parseHTML: (el) => el.getAttribute('style'),
        renderHTML: (attrs) => (attrs.style ? { style: attrs.style } : {}),
      },
    }
  },
})
import { useBranding } from '@/lib/branding-context'
import { getAuthToken } from '@/lib/auth'
import { useEvents } from '@/lib/events-context'
import { API_URL } from '@/lib/config';

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
  is_sent?: boolean
  account_id?: number
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
  htmlContent?: string // Rich text editor output (takes precedence over field-based generation)
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
  { id: 'scheduled', label: 'Scheduled', endpoint: 'scheduled', icon: '🕐', type: 'regular' },
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

// TipTap Image extension extended with a resizable `width` attribute
const ResizableImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      width: {
        default: null,
        renderHTML: (attributes) => {
          if (!attributes.width) return {}
          return { style: `width: ${attributes.width}; max-width: 100%;` }
        },
        parseHTML: (element) => element.style.width || null,
      },
    }
  },
})

// Rich text editor used inside the Signature Settings modal
function SignatureRichEditor({ initialContent, onChange }: { initialContent: string; onChange: (html: string) => void }) {
  const imgFileRef = useRef<HTMLInputElement>(null)
  const [imgWidth, setImgWidth] = React.useState('150px')

  const sigEditor = useEditor({
    extensions: [
      StarterKit,
      Underline,
      TextStyle,
      Color,
      ResizableImage.configure({ inline: true, allowBase64: true }),
    ],
    content: initialContent || '<p></p>',
    immediatelyRender: false,
    onUpdate: ({ editor }) => onChange(editor.getHTML()),
  })

  const handleImgUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !sigEditor) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      const src = ev.target?.result as string
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      sigEditor.chain().focus().setImage({ src, width: imgWidth } as any).run()
    }
    reader.readAsDataURL(file)
    e.currentTarget.value = ''
  }

  if (!sigEditor) return <div className="h-36 border border-gray-300 rounded-lg animate-pulse bg-gray-100" />

  return (
    <div className="border border-gray-300 rounded-lg overflow-hidden">
      {/* Toolbar */}
      <div className="flex items-center flex-wrap gap-0.5 px-2 py-1.5 bg-gray-50 border-b border-gray-200">
        <button type="button" onClick={() => sigEditor.chain().focus().toggleBold().run()}
          className={`w-7 h-7 rounded flex items-center justify-center text-sm font-bold ${sigEditor.isActive('bold') ? 'bg-purple-100 text-purple-700' : 'text-gray-600 hover:bg-gray-200'}`} title="Bold">B</button>
        <button type="button" onClick={() => sigEditor.chain().focus().toggleItalic().run()}
          className={`w-7 h-7 rounded flex items-center justify-center text-sm italic ${sigEditor.isActive('italic') ? 'bg-purple-100 text-purple-700' : 'text-gray-600 hover:bg-gray-200'}`} title="Italic">I</button>
        <button type="button" onClick={() => sigEditor.chain().focus().toggleUnderline().run()}
          className={`w-7 h-7 rounded flex items-center justify-center text-sm underline ${sigEditor.isActive('underline') ? 'bg-purple-100 text-purple-700' : 'text-gray-600 hover:bg-gray-200'}`} title="Underline">U</button>
        <div className="w-px h-4 bg-gray-300 mx-0.5" />
        <input type="color" defaultValue="#000000"
          onChange={(e) => sigEditor.chain().focus().setColor(e.target.value).run()}
          className="w-6 h-6 rounded cursor-pointer border border-gray-300 p-0.5" title="Text colour" />
        <div className="w-px h-4 bg-gray-300 mx-0.5" />
        <label className="w-7 h-7 rounded flex items-center justify-center text-gray-600 hover:bg-gray-200 cursor-pointer" title="Insert logo / image">
          🖼️
          <input ref={imgFileRef} type="file" accept="image/*" className="hidden" onChange={handleImgUpload} />
        </label>
        <select value={imgWidth} onChange={(e) => setImgWidth(e.target.value)}
          className="text-xs border border-gray-300 rounded px-1 py-0.5 text-gray-600" title="Width for next inserted image">
          <option value="50px">50px</option>
          <option value="100px">100px</option>
          <option value="150px">150px</option>
          <option value="200px">200px</option>
          <option value="300px">300px</option>
          <option value="100%">Full</option>
        </select>
      </div>
      {/* Editor area */}
      <EditorContent editor={sigEditor} className="min-h-[140px] p-3 text-sm [&_.ProseMirror]:min-h-[140px] [&_.ProseMirror]:outline-none" />
    </div>
  )
}

export default function EmailPage() {
  const brandingContext = useBranding()
  const branding = brandingContext?.branding

  const [currentFolder, setCurrentFolder] = useState('inbox')
  const currentFolderRef = useRef('inbox')  // always mirrors currentFolder for use in intervals
  const [threads, setThreads] = useState<EmailThread[]>([])
  const [emailOffset, setEmailOffset] = useState(0)
  const [hasMore, setHasMore] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [unreadCounts, setUnreadCounts] = useState<Record<string, number>>({})
  const [selectedThread, setSelectedThread] = useState<EmailThread | null>(null)
  const [expandedEmailIds, setExpandedEmailIds] = useState<Set<number>>(new Set())
  const [loading, setLoading] = useState(false)
  const [emailAccounts, setEmailAccounts] = useState<{ id: number; email_address: string; provider: string }[]>([])
  const [selectedAccountId, setSelectedAccountId] = useState<number | null>(null)
  const [emailAccountConfigured, setEmailAccountConfigured] = useState<boolean | null>(null)
  const [requestMessage, setRequestMessage] = useState('')
  const [requestStatus, setRequestStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle')
  const [showCompose, setShowCompose] = useState(false)
  const [requestResponse, setRequestResponse] = useState('')
  const [requestError, setRequestError] = useState('')
  const [currentDraftId, setCurrentDraftId] = useState<number | null>(null)
  const currentDraftIdRef = useRef<number | null>(null)  // ref so saveDraft closure always sees latest value
  const [autoSaveStatus, setAutoSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle')
  const isSavingDraftRef = useRef(false)  // guard against concurrent saves
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const saveDraftRef = useRef<(silent?: boolean) => Promise<void>>(async () => { })  // always points to latest saveDraft
  // always points to the latest fetchEmails so the poll interval never uses a stale closure
  const fetchEmailsRef = useRef<(append?: boolean) => Promise<void>>(async () => { })
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

  // Custom Delete Confirmation Modal state
  const [deleteDialog, setDeleteDialog] = useState<{ isOpen: boolean; message: string; onConfirm: () => void } | null>(null)
  const [skipDeleteConfirm, setSkipDeleteConfirm] = useState(false)

  // Load delete preference on mount
  useEffect(() => {
    if (typeof window !== 'undefined') {
      setSkipDeleteConfirm(localStorage.getItem('email_skip_delete_confirm') === 'true')
    }
  }, [])

  const [sortBy, setSortBy] = useState<'date' | 'sender' | 'subject'>('date')
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc')
  const [showUnreadOnly, setShowUnreadOnly] = useState(false)
  const [customSmartFolders, setCustomSmartFolders] = useState<CustomSmartFolder[]>([])
  const [showCreateSmartFolder, setShowCreateSmartFolder] = useState(false)
  const [draggedEmailId, setDraggedEmailId] = useState<number | null>(null)
  const [selectedThreadIds, setSelectedThreadIds] = useState<Set<number>>(new Set())
  const [showBulkLabelMenu, setShowBulkLabelMenu] = useState(false)
  const [customLabels, setCustomLabels] = useState<CustomLabel[]>([])
  const [showCreateLabel, setShowCreateLabel] = useState(false)
  const [newLabelName, setNewLabelName] = useState('')
  const [selectedLabelColor, setSelectedLabelColor] = useState('bg-blue-100')
  const [signatures, setSignatures] = useState<EmailSignature[]>([])
  const [showSignatureSettings, setShowSignatureSettings] = useState(false)
  const [showCcBcc, setShowCcBcc] = useState(false)
  const [textColor, setTextColor] = useState('#000000')

  // --- Email Templates / Canned Responses ---
  const [templates, setTemplates] = useState<{ id: number; name: string; subject?: string; body: string }[]>([])
  const [showTemplatesModal, setShowTemplatesModal] = useState(false)
  const [templateForm, setTemplateForm] = useState({ name: '', subject: '', body: '' })
  const [editingTemplateId, setEditingTemplateId] = useState<number | null>(null)
  const [showCannedDropdown, setShowCannedDropdown] = useState(false)

  // ── Auto-reply state ──────────────────────────────────────────────────────
  const [showAutoReplyModal, setShowAutoReplyModal] = useState(false)
  const [autoReplyConfig, setAutoReplyConfig] = useState({
    is_enabled: false,
    mode: 'fixed' as 'fixed' | 'ai',
    subject_prefix: 'Re: ',
    reply_body: '',
    ai_system_prompt: '',
    skip_if_from: '',
  })
  const [autoReplySaving, setAutoReplySaving] = useState(false)
  const [autoReplyTestStatus, setAutoReplyTestStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle')

  // --- Snooze ---
  const [snoozeEmailId, setSnoozeEmailId] = useState<number | null>(null)
  const [showSnoozeMenu, setShowSnoozeMenu] = useState(false)
  // const [showSnoozedFolder, setShowSnoozedFolder] = useState(false)
  const [snoozedEmails, setSnoozedEmails] = useState<any[]>([])

  // --- Undo Send ---
  const [undoSendState, setUndoSendState] = useState<{ scheduledId: number; countdown: number; timer: ReturnType<typeof setInterval> | null } | null>(null)
  const undoSendRef = useRef<{ scheduledId: number; timer: ReturnType<typeof setInterval> | null } | null>(null)

  // --- Notification Center ---
  const [showNotificationPanel, setShowNotificationPanel] = useState(false)
  const [notificationHistory, setNotificationHistory] = useState<{ id: string; title: string; desc: string; icon: string; time: string; read: boolean }[]>([])
  const [unreadNotifCount, setUnreadNotifCount] = useState(0)

  // --- Mobile Layout ---
  const [showMobileSidebar, setShowMobileSidebar] = useState(false)
  const [mobileView, setMobileView] = useState<'list' | 'detail'>('list')

  // --- Email Rules ---
  const [rules, setRules] = useState<{ id: number; name: string; is_active: boolean; match_all: boolean; conditions: { field: string; op: string; value: string }[]; actions: { type: string; value?: string }[] }[]>([])
  const [showRulesModal, setShowRulesModal] = useState(false)
  const [ruleForm, setRuleForm] = useState<{ name: string; match_all: boolean; conditions: { field: string; op: string; value: string }[]; actions: { type: string; value: string }[] }>({ name: '', match_all: true, conditions: [{ field: 'from', op: 'contains', value: '' }], actions: [{ type: 'label', value: '' }] })
  const [editingRuleId, setEditingRuleId] = useState<number | null>(null)

  // Send Later state
  const [showSendLater, setShowSendLater] = useState(false)
  const [scheduledAt, setScheduledAt] = useState('')
  const [scheduledEmails, setScheduledEmails] = useState<{
    id: number; to_address: string; subject: string; scheduled_at: string; body_html?: string
  }[]>([])

  // Signature state
  const [newSignatureName, setNewSignatureName] = useState('')
  const [signatureEditorContent, setSignatureEditorContent] = useState('<p></p>')
  const [sigEditorKey, setSigEditorKey] = useState(0)

  // Edit signature state
  const [editingSignatureId, setEditingSignatureId] = useState<string | null>(null)
  const [editSignatureName, setEditSignatureName] = useState('')
  const [editSignatureEditorContent, setEditSignatureEditorContent] = useState('<p></p>')
  const [editSigEditorKey, setEditSigEditorKey] = useState(0)
  const [showSigDropdown, setShowSigDropdown] = useState(false)
  const [showRequestModal, setShowRequestModal] = useState(false)

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

  // Normalize bare UTC timestamps (backend stores naive UTC without Z suffix)
  const parseUtcDate = (ts: string) => new Date(
    ts && !ts.endsWith('Z') && !ts.includes('+') && !ts.includes('-', 10) ? ts + 'Z' : ts
  )

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

  const [isSending, setIsSending] = useState(false)

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ blockquote: false }),
      StyledBlockquote,
      Underline, TextStyle, Color,
      Image.configure({ inline: false, allowBase64: true }),
    ],

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
        const res = await axios.get(`${API_URL}/email/account`, {
          headers: { Authorization: `Bearer ${token}` }
        })
        setEmailAccountConfigured(true)
        // Also fetch all accounts
        fetchAccounts()
      } catch {
        setEmailAccountConfigured(false)
      }
    }
    checkEmailAccount()
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }
  }, [])

  const fetchAccounts = async () => {
    try {
      const token = getAuthToken()
      if (!token) return
      const res = await axios.get(`${API_URL}/email/accounts`, {
        headers: { Authorization: `Bearer ${token}` }
      })
      setEmailAccounts(res.data)
      if (res.data.length > 0 && selectedAccountId === null) {
        setSelectedAccountId(res.data[0].id)
      }
    } catch (err) {
      console.error('Failed to fetch accounts', err)
    }
  }



  useEffect(() => {
    // Ensure test user is set up
    if (!getAuthToken()) {
      localStorage.setItem('user', JSON.stringify({ user_id: 2, email: 'test@example.com' }))
    }
    setEmailOffset(0)
    setHasMore(false)
    if (currentFolder === 'scheduled') {
      fetchScheduledEmails()
    } else {
      fetchEmails()
    }
  }, [currentFolder, selectedAccountId])

  // Keep ref in sync with currentFolder so poll intervals can read the latest value
  useEffect(() => {
    currentFolderRef.current = currentFolder
  }, [currentFolder])

  // Auto-poll every 60 seconds for new emails
  useEffect(() => {
    const POLL_INTERVAL = 60_000
    const poll = async () => {
      try {
        const token = getAuthToken()
        if (!token) return
        const res = await axios.post(`${API_URL}/email/account/sync`, {}, {
          headers: { Authorization: `Bearer ${token}` },
          params: selectedAccountId ? { account_id: selectedAccountId } : {}
        })
        const count = res.data?.synced_count || 0
        if (count > 0) {
          playNewEmailSound()
          showToast(`${count} new emails synced`, 'success')

          if ('Notification' in window && Notification.permission === 'granted' && document.hidden) {
            new Notification('New Email', {
              body: `You have ${count} new email${count > 1 ? 's' : ''}.`,
              icon: '/favicon.ico'
            })
          }
          // Only refresh the list when new emails arrive AND the user is in inbox.
          // Use fetchEmailsRef (not fetchEmails directly) so we always call the
          // latest version of the function — avoiding the stale-closure bug that
          // caused inbox data to overwrite other folders like Outbox.
          if (currentFolderRef.current === 'inbox') {
            await fetchEmailsRef.current()
          }
        }

        // Always refresh the scheduled folder view so emails sent by the
        // background scheduler are removed without needing a manual reload.
        if (currentFolderRef.current === 'scheduled') {
          fetchScheduledEmails()
          fetchUnreadCounts()  // update badge count too
        }
      } catch (error: any) {
        // silently ignore sync errors
      }
    }
    const id = setInterval(poll, POLL_INTERVAL)
    return () => clearInterval(id)
  }, [])

  // Auto-save draft while composing (debounced 3s after last change)
  useEffect(() => {
    if (!showCompose) return
    const hasContent = composeData.to || composeData.subject || composeData.message
    if (!hasContent) return
    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current)
    autoSaveTimerRef.current = setTimeout(() => { saveDraftRef.current(true) }, 3000)
    return () => { if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current) }
  }, [composeData.to, composeData.subject, composeData.message, composeData.cc, composeData.bcc, showCompose])

  // Listen for real-time email_received WebSocket events
  const { subscribe } = useEvents()
  useEffect(() => {
    const unsub = subscribe('email_received', async (event: any) => {
      playNewEmailSound()
      const d = event.data || event
      addNotifHistory('New Email', d.sender ? `From: ${d.sender}` : 'New email received', '📬')
      if ('Notification' in window && Notification.permission === 'granted' && document.hidden) {
        new Notification('New Email', {
          body: d.sender ? `From: ${d.sender}` : 'You have a new email.',
          icon: '/favicon.ico'
        })
      }
      // Only refresh the email list when the user is viewing inbox — same guard
      // as the polling interval — so new messages never overwrite sent/outbox/etc.
      if (currentFolderRef.current === 'inbox') {
        await fetchEmailsRef.current()
      }
    })
    const unsubSent = subscribe('email_sent', (event: any) => {
      const d = event.data || event
      addNotifHistory('Email Sent', `To: ${d.recipient || ''}`, '📧')
      playEmailSentSound()
    })
    return () => { unsub(); unsubSent() }
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
    // Set editor content when opening new compose (includes default sig if any)
    if (showCompose && replyMode === 'none' && editor) {
      const sigContent = buildDefaultSigInsert()
      const content = buildNewComposeContent() + sigContent
      setTimeout(() => {
        editor.commands.setContent(content)
        editor.commands.focus('start')
      }, 0)
    }
  }, [showCompose, editor, replyMode])

  useEffect(() => {
    // Auto-expand the most recent (last) email when a thread is selected
    if (selectedThread && selectedThread.emails.length > 0) {
      const lastEmail = selectedThread.emails[selectedThread.emails.length - 1]
      setExpandedEmailIds(new Set([lastEmail.id]))
    } else {
      setExpandedEmailIds(new Set())
    }
  }, [selectedThread])

  useEffect(() => {
    // Auto-mark expanded unread emails as read after 5 seconds
    if (expandedEmailIds.size === 0 || !selectedThread) return
    const timers: ReturnType<typeof setTimeout>[] = []
    expandedEmailIds.forEach(id => {
      const email = selectedThread.emails.find((e) => e.id === id)
      if (email && !email.is_read) {
        timers.push(setTimeout(() => {
          handleMarkRead(id, false)
        }, 5000))
      }
    })
    return () => timers.forEach(clearTimeout)
  }, [expandedEmailIds, selectedThread])

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
  const loadSignatures = async () => {
    // Try localStorage first as a fast cache, then sync from API
    const cached = localStorage.getItem('emailSignatures')
    if (cached) {
      try { setSignatures(JSON.parse(cached)) } catch { /* ignore */ }
    }
    try {
      const token = getAuthToken()
      const res = await axios.get(`${API_URL}/email/signatures-all`, {
        headers: { Authorization: `Bearer ${token}` }
      })
      const sigs: EmailSignature[] = res.data || []
      if (sigs.length > 0) {
        // API has data — use it as the source of truth
        setSignatures(sigs)
        localStorage.setItem('emailSignatures', JSON.stringify(sigs))
      } else if (!cached) {
        // API is empty and no local cache — truly empty
        setSignatures([])
      }
      // If API returns empty but we have cached data, keep the cached data
      // (avoids wiping signatures due to a transient API issue)
    } catch {
      // Fall back to localStorage if API unavailable
    }
  }

  const saveSignatures = async (sigs: EmailSignature[]) => {
    setSignatures(sigs)
    localStorage.setItem('emailSignatures', JSON.stringify(sigs))
    try {
      const token = getAuthToken()
      await axios.put(
        `${API_URL}/email/signatures-all`,
        { signatures: sigs },
        { headers: { Authorization: `Bearer ${token}` } }
      )
    } catch {
      // API save failed — data is still safe in localStorage
    }
  }

  const createSignature = () => {
    if (!newSignatureName.trim()) {
      showToast('Please enter a signature name', 'error')
      return
    }

    const htmlContent = signatureEditorContent === '<p></p>' ? '<p></p>' : signatureEditorContent

    const newSignature: EmailSignature = {
      id: `sig-${Date.now()}`,
      name: newSignatureName,
      isDefault: signatures.length === 0,
      htmlContent,
    }

    const updated = [...signatures, newSignature]
    void saveSignatures(updated)

    setNewSignatureName('')
    setSignatureEditorContent('<p></p>')
    setSigEditorKey(k => k + 1)
    showToast(`✓ Signature "${newSignature.name}" created`)
  }

  const deleteSignature = (sigId: string) => {
    const updated = signatures.filter(s => s.id !== sigId)

    // If deleted signature was default, make first one default
    if (signatures.find(s => s.id === sigId)?.isDefault && updated.length > 0) {
      updated[0].isDefault = true
    }

    void saveSignatures(updated)
    showToast('✓ Signature deleted')
  }

  const setDefaultSignature = (sigId: string) => {
    const updated = signatures.map(s => ({
      ...s,
      isDefault: s.id === sigId
    }))
    void saveSignatures(updated)
    showToast('✓ Default signature updated')
  }

  const startEditSignature = (sig: EmailSignature) => {
    setEditingSignatureId(sig.id)
    setEditSignatureName(sig.name)
    // Prefer stored htmlContent; fall back to generating from legacy field data
    const content = sig.htmlContent || generateSignatureHTML(sig)
    setEditSignatureEditorContent(content)
    setEditSigEditorKey(k => k + 1)
  }

  const updateSignature = () => {
    if (!editingSignatureId) return
    if (!editSignatureName.trim()) {
      showToast('Please enter a signature name', 'error')
      return
    }

    const updated = signatures.map(s =>
      s.id === editingSignatureId
        ? { ...s, name: editSignatureName, htmlContent: editSignatureEditorContent }
        : s
    )
    void saveSignatures(updated)
    setEditingSignatureId(null)
    setEditSignatureName('')
    setEditSignatureEditorContent('<p></p>')
    showToast('✓ Signature updated')
  }

  const cancelEditSignature = () => {
    setEditingSignatureId(null)
    setEditSignatureName('')
    setEditSignatureEditorContent('<p></p>')
  }



  const generateSignatureHTML = (sig: EmailSignature): string => {
    // Prefer htmlContent saved by the rich editor
    if (sig.htmlContent && sig.htmlContent !== '<p></p>') return sig.htmlContent

    // Legacy fallback: generate HTML from individual fields
    let html = ''
    if (sig.closingStatement) html += `<p>${sig.closingStatement}</p>\n`
    html += `<p style="margin: 8px 0; font-weight: 600; font-size: 14px;"><strong>${sig.fullName || ''}</strong></p>\n`
    if (sig.title) html += `<p style="margin: 2px 0; font-size: 13px; color: #666;">${sig.title}</p>\n`
    if (sig.company) html += `<p style="margin: 2px 0; font-size: 13px; color: #666;">${sig.company}</p>\n`
    if (sig.imageData) html += `\n<p style="margin: 12px 0;"><img src="${sig.imageData}" style="max-width: 150px; max-height: 80px; border-radius: 4px;" alt="logo" /></p>\n`
    if (sig.address) html += `<p style="margin: 8px 0; font-size: 12px; color: #444;">${sig.address}</p>\n`
    let contactInfo = ''
    if (sig.phoneOffice) contactInfo += `Phone: ${sig.phoneOffice}<br />`
    if (sig.phoneMobile) contactInfo += `Mobile: ${sig.phoneMobile}<br />`
    if (sig.website) contactInfo += `Web: <a href="${sig.website}" style="color: #0066cc; text-decoration: none;">${sig.website}</a><br />`
    if (sig.email) contactInfo += `Email: <a href="mailto:${sig.email}" style="color: #0066cc; text-decoration: none;">${sig.email}</a><br />`
    if (sig.skype) contactInfo += `Skype: ${sig.skype}<br />`
    if (sig.viber) contactInfo += `Viber: ${sig.viber}`
    if (contactInfo) html += `<p style="margin: 8px 0; font-size: 12px; line-height: 1.6; color: #444;">${contactInfo}</p>\n`
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
    void loadSignatures()
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

  useEffect(() => {
    void loadTemplates()
    void loadRules()
  }, [])

  useEffect(() => {
    if (currentFolder === 'snoozed') fetchSnoozedEmails()
  }, [currentFolder])

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
      const params: any = { limit: 200 }
      if (selectedAccountId) params.account_id = selectedAccountId

      const response = await axios.get(`${API_URL}/email/inbox`, {
        headers: { Authorization: `Bearer ${token}` },
        params
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

        // scheduled count
        try {
          const scheduledResp = await axios.get(`${API_URL}/email/scheduled`, {
            headers: { Authorization: `Bearer ${token}` }
          })
          counts['scheduled'] = (scheduledResp.data?.emails ?? scheduledResp.data ?? []).length
        } catch {
          // ignore scheduled errors
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

  const playEmailSentSound = () => {
    try {
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)()
      // Upward swoosh: low → high → fade feels like "sent away"
      const notes = [
        { freq: 440, start: 0, dur: 0.12 },
        { freq: 660, start: 0.10, dur: 0.12 },
        { freq: 880, start: 0.20, dur: 0.20 },
      ]
      notes.forEach(({ freq, start, dur }) => {
        const osc = ctx.createOscillator()
        const gain = ctx.createGain()
        osc.connect(gain)
        gain.connect(ctx.destination)
        osc.frequency.value = freq
        osc.type = 'sine'
        gain.gain.setValueAtTime(0, ctx.currentTime + start)
        gain.gain.linearRampToValueAtTime(0.3, ctx.currentTime + start + 0.02)
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

  const fetchEmails = async (append = false) => {
    fetchEmailsRef.current = fetchEmails  // keep ref updated on every render
    try {
      setLoading(!append)
      if (append) setLoadingMore(true)
      if (!append) setThreads([])  // clear old folder's emails immediately on folder switch

      const token = getAuthToken()
      if (!token) return

      const folder = FOLDERS.find(f => f.id === currentFolder)
      // const smart = SMART_FOLDERS.find(f => f.id === currentFolder) || customSmartFolders.find(f => f.id === currentFolder)

      let endpoint = folder?.endpoint || 'inbox'
      const currentOffset = append ? emailOffset : 0

      const isCustom = customSmartFolders.some(f => f.id === currentFolder)
      const isLabel = currentFolder.startsWith('label-')
      const PAGE_SIZE = 50

      const params = new URLSearchParams()
      params.set('skip', String(currentOffset))
      params.set('limit', currentFolder.startsWith('label-') || customSmartFolders.some(f => f.id === currentFolder) ? '200' : '50')

      if (selectedAccountId) {
        params.set('account_id', String(selectedAccountId))
      }

      if (currentFolder === 'starred') {
        endpoint = 'inbox'
        params.set('starred', 'true')
      } else if (currentFolder === 'attachments') {
        endpoint = 'inbox'
        params.set('has_attachments', 'true')
      } else if (currentFolder.startsWith('label-') || customSmartFolders.some(f => f.id === currentFolder)) {
        endpoint = 'inbox'
      }

      if (searchQuery) {
        params.set('search', searchQuery)
      }

      const response = await axios.get(`${API_URL}/email/${endpoint}?${params.toString()}`, {
        headers: { Authorization: `Bearer ${token}` }
      })

      if (response.data?.emails) {
        let emails = response.data.emails

        // Client-side filtering only needed for custom smart folders and labels
        // (starred and attachments are now server-filtered)
        if (isCustom) {
          emails = emails.filter((email: Email) => {
            const folder = customSmartFolders.find(f => f.id === currentFolder)
            if (!folder) return true
            return folder.rules.every((rule: any) => {
              switch (rule.filterType) {
                case 'sender': return email.from_address.toLowerCase().includes(rule.value?.toLowerCase() || '')
                case 'domain': return email.from_address.toLowerCase().includes('@' + (rule.value?.toLowerCase().replace('@', '') || ''))
                case 'keyword': return email.subject.toLowerCase().includes(rule.value?.toLowerCase() || '') || (email.body_text || '').toLowerCase().includes(rule.value?.toLowerCase() || '')
                case 'subject': return email.subject.toLowerCase().includes(rule.value?.toLowerCase() || '')
                case 'hasAttachments': return email.attachments && email.attachments.length > 0
                case 'isStarred': return email.is_starred
                default: return true
              }
            })
          })
        } else if (isLabel) {
          emails = emails.filter((email: Email) => {
            const labels = Array.isArray(email.labels) ? email.labels : []
            return labels.includes(currentFolder)
          })
        }

        // Group emails by thread_id; emails without thread_id each get their own group
        const normalizeSubject = (s: string) =>
          (s || '').replace(/^\s*(Re|Fwd|Fw|RE|FW|FWD)\s*:\s*/i, '').trim() || '(No Subject)'

        const threadMap = new Map<string, any>()
        emails.forEach((email: Email) => {
          // Prefer thread_id; fall back to normalized subject so unthreaded emails still group
          const key = email.thread_id != null
            ? `t-${email.thread_id}`
            : `subj-${email.account_id ?? 0}-${normalizeSubject(email.subject)}`
          if (!threadMap.has(key)) {
            threadMap.set(key, {
              id: email.thread_id ?? key,
              subject: normalizeSubject(email.subject),
              from_address: email.from_address,
              emails: []
            })
          }
          threadMap.get(key).emails.push(email)
        })
        const grouped = Array.from(threadMap.values()).map(t => ({
          ...t,
          emails: [...t.emails].sort((a: Email, b: Email) =>
            parseUtcDate(a.received_at).getTime() - parseUtcDate(b.received_at).getTime()
          )
        }))
        // Sort threads by most recent email descending
        grouped.sort((a, b) => {
          const aLast = parseUtcDate(a.emails[a.emails.length - 1].received_at).getTime()
          const bLast = parseUtcDate(b.emails[b.emails.length - 1].received_at).getTime()
          return bLast - aLast
        })
        const total: number = response.data.total ?? grouped.length
        const fetchedCount = isCustom || isLabel ? 200 : PAGE_SIZE
        if (append) {
          setThreads(prev => {
            const existingIds = new Set(prev.map(t => t.id))
            const newThreads = grouped.filter(t => !existingIds.has(t.id))
            return [...prev, ...newThreads]
          })
          const newOffset = currentOffset + fetchedCount
          setEmailOffset(newOffset)
          setHasMore(newOffset < total)
        } else {
          setThreads(grouped)
          setEmailOffset(fetchedCount)
          setHasMore(fetchedCount < total)
        }
      }
    } catch (error) {
      console.error('Error fetching emails:', error)
    } finally {
      setLoading(false)
      setLoadingMore(false)
    }
    fetchUnreadCounts()
  }

  const filteredThreads = threads.filter((thread) => {
    if (showUnreadOnly) {
      return !thread.emails[0]?.is_read
    }
    return true
  }).sort((a, b) => {
    let comparison = 0

    if (sortBy === 'date') {
      const dateA = a.emails[0]?.received_at ? parseUtcDate(a.emails[0].received_at).getTime() : 0
      const dateB = b.emails[0]?.received_at ? parseUtcDate(b.emails[0].received_at).getTime() : 0
      comparison = dateA - dateB
    } else if (sortBy === 'sender') {
      comparison = a.from_address.localeCompare(b.from_address)
    } else if (sortBy === 'subject') {
      comparison = a.subject.localeCompare(b.subject)
    }

    return sortOrder === 'desc' ? -comparison : comparison
  })

  const finalFilteredThreads = getFilteredThreads(filteredThreads)

  // When selecting a thread with a real thread_id, fetch the FULL thread (received + sent replies)
  const selectThread = async (thread: EmailThread) => {
    setSelectedThread(thread) // Show immediately with preloaded data
    if (typeof thread.id === 'number') {
      try {
        const token = getAuthToken()
        const res = await axios.get(`${API_URL}/email/thread/${thread.id}`, {
          headers: { Authorization: `Bearer ${token}` }
        })
        if (res.data?.emails?.length) {
          const normalizeSubject = (s: string) =>
            (s || '').replace(/^\s*(Re|Fwd|Fw|RE|FW|FWD)\s*:\s*/i, '').trim() || '(No Subject)'
          const sorted = [...res.data.emails].sort(
            (a: Email, b: Email) => parseUtcDate(a.received_at).getTime() - parseUtcDate(b.received_at).getTime()
          )
          setSelectedThread({
            ...thread,
            subject: normalizeSubject(sorted[0]?.subject || thread.subject),
            emails: sorted,
          })
        }
      } catch {
        // Keep preloaded data on error
      }
    }
  }


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
    currentDraftIdRef.current = null
    setShowCcBcc(false)
    if (editor) {
      editor.commands.setContent('')
    }
  }

  const deleteDraft = async (draftId: number) => {
    try {
      const token = getAuthToken()
      await axios.delete(`${API_URL}/email/drafts/${draftId}`, {
        headers: { Authorization: `Bearer ${token}` }
      })
    } catch (e) {
      // Non-critical: draft will remain but that's acceptable
      console.error('Failed to delete draft after send:', e)
    }
  }

  const saveDraft = async (silent = false) => {
    // NB: saveDraftRef.current is kept in sync below (after this function definition)
    if (isSavingDraftRef.current) return  // prevent concurrent saves
    isSavingDraftRef.current = true
    try {
      if (silent) setAutoSaveStatus('saving')
      const token = getAuthToken()
      const payload = {
        to_address: composeData.to.trim(),
        cc: composeData.cc.trim() || undefined,
        bcc: composeData.bcc.trim() || undefined,
        subject: composeData.subject,
        body: composeData.message,
      }
      const draftId = currentDraftIdRef.current
      if (draftId) {
        await axios.put(
          `${API_URL}/email/drafts/${draftId}`,
          payload,
          { headers: { Authorization: `Bearer ${token}` } }
        )
      } else {
        const res = await axios.post(
          `${API_URL}/email/drafts/save`,
          payload,
          { headers: { Authorization: `Bearer ${token}` } }
        )
        if (res.data?.draft_id) {
          currentDraftIdRef.current = res.data.draft_id
          setCurrentDraftId(res.data.draft_id)
        }
      }
      if (silent) {
        setAutoSaveStatus('saved')
        setTimeout(() => setAutoSaveStatus('idle'), 3000)
      } else {
        showToast('✓ Draft saved')
      }
      fetchUnreadCounts()
    } catch (error) {
      console.error('Error saving draft:', error)
      if (!silent) showToast('Failed to save draft', 'error')
      if (silent) setAutoSaveStatus('idle')
    } finally {
      isSavingDraftRef.current = false
    }
  }
  saveDraftRef.current = saveDraft  // keep ref always up-to-date so auto-save useEffect closure sees latest draftId

  const buildQuotedSeparator = (email: Email, mode: 'reply' | 'forward', thread?: EmailThread) => {
    const date = parseUtcDate(email.received_at).toLocaleString('en-US', { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })

    // Build full chain: all prior emails in the thread (oldest first), always excluding the current one
    const priorEmails = thread
      ? [...thread.emails]
        .sort((a, b) => parseUtcDate(a.received_at).getTime() - parseUtcDate(b.received_at).getTime())
        .filter(e => e.id !== email.id)
      : []

    // Current email body (what is being replied to / forwarded)
    const currentBody = email.body_html || `<p style="white-space:pre-wrap">${email.body_text || ''}</p>`

    // Build nested quoted chain of older emails in the thread
    const priorChain = priorEmails.map(e => {
      const d = parseUtcDate(e.received_at).toLocaleString('en-US', { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
      return `<div style="margin-top:12px;padding-top:8px;color:#6b7280;font-size:12px;">` +
        `<p style="margin:0 0 4px;"><strong>On ${d}, ${e.from_address} wrote:</strong></p>` +
        `<blockquote style="margin:0 0 0 20px;padding:6px 12px;border-left:3px solid #93c5fd;background:#f0f9ff;color:#374151;font-size:13px;border-radius:0 4px 4px 0;">` +
        (e.body_html || `<p style="white-space:pre-wrap">${e.body_text || ''}</p>`) +
        `</blockquote></div>`
    }).join('')

    const combinedBody = currentBody + priorChain

    const header = mode === 'reply'
      ? `<p style="margin:0 0 8px;"><strong>On ${date}, ${email.from_address} wrote:</strong></p>`
      : `<p style="margin:0 0 4px;"><strong>---------- Forwarded message ----------</strong></p>` +
      `<p style="margin:2px 0;"><strong>From:</strong> ${email.from_address}</p>` +
      `<p style="margin:2px 0;"><strong>Date:</strong> ${date}</p>` +
      `<p style="margin:2px 0;"><strong>Subject:</strong> ${email.subject}</p>` +
      (email.to_address ? `<p style="margin:2px 0;"><strong>To:</strong> ${email.to_address}</p>` : '')

    return (
      `<p><br></p>` +
      `<hr style="border:none;border-top:2px solid #d1d5db;margin:20px 0 16px;" />` +
      `<blockquote style="margin:0 0 0 8px;padding:10px 14px;border-left:4px solid #3b82f6;background:#f8fafc;color:#374151;font-size:14px;border-radius:0 4px 4px 0;">` +
      `<div style="color:#6b7280;font-size:13px;margin-bottom:10px;">` +
      header +
      `</div>` +
      combinedBody +
      `</blockquote>`
    )
  }

  const buildNewComposeContent = () =>
    `<p></p>`

  const buildDefaultSigInsert = () => {
    const defaultSig = signatures.find(s => s.isDefault)
    if (!defaultSig) return ''
    const sigHTML = generateSignatureHTML(defaultSig)
    if (!sigHTML || sigHTML === '<p></p>') return ''
    return `<p><br></p><hr style="border:none;border-top:2px solid #e5e7eb;margin:16px 0;">${sigHTML}`
  }

  const handleReply = (email: Email, thread?: EmailThread) => {
    setReplyMode('reply')
    setShowCompose(true)
    setMobileView('detail')
    setComposeData({
      to: email.from_address,
      cc: '',
      bcc: '',
      subject: email.subject?.startsWith('Re:') ? email.subject : `Re: ${email.subject}`,
      message: buildNewComposeContent() + buildDefaultSigInsert() + buildQuotedSeparator(email, 'reply', thread),
      attachments: [],
    })
  }

  const handleReplyAll = (email: Email, thread: EmailThread) => {
    setReplyMode('replyAll')
    setShowCompose(true)
    setMobileView('detail')
    setComposeData({
      to: email.from_address,
      cc: email.cc || '',
      bcc: '',
      subject: email.subject?.startsWith('Re:') ? email.subject : `Re: ${email.subject}`,
      message: buildNewComposeContent() + buildDefaultSigInsert() + buildQuotedSeparator(email, 'reply', thread),
      attachments: [],
    })
  }

  const handleForward = (email: Email, thread?: EmailThread) => {
    setReplyMode('forward')
    setShowCompose(true)
    setMobileView('detail')
    setComposeData({
      to: '',
      cc: '',
      bcc: '',
      subject: email.subject?.startsWith('Fwd:') ? email.subject : `Fwd: ${email.subject}`,
      message: buildNewComposeContent() + buildDefaultSigInsert() + buildQuotedSeparator(email, 'forward', thread),
      attachments: [],
    })
  }

  // Helper: ask for delete confirmation using our custom modal unless user has opted out.
  // This completely bypasses the browser's native confirm() which can be permanently
  // blocked by checking 'Prevent this page from showing dialogs'.
  const requestDelete = (msg: string, onConfirm: () => void) => {
    if (skipDeleteConfirm || localStorage.getItem('email_skip_delete_confirm') === 'true') {
      onConfirm()
    } else {
      setDeleteDialog({ isOpen: true, message: msg, onConfirm })
    }
  }

  const handleDelete = (target: EmailThread | number) => {
    const isThread = typeof target !== 'number';
    const primaryId = isThread ? target.emails[0].id : target;

    const isDrafts = currentFolder === 'drafts';
    const isTrash = currentFolder === 'trash';
    const msg = isDrafts ? 'Permanently delete this thread?' : isTrash ? 'Permanently delete this thread?' : 'Move this to Trash?';
    requestDelete(msg, async () => {
      try {
        const token = getAuthToken()
        if (isDrafts || isTrash) {
          // Single-email permanent delete cascades to the full thread via thread_id on the backend
          await axios.delete(`${API_URL}/email/emails/${primaryId}/permanent`, {
            headers: { Authorization: `Bearer ${token}` }
          })
        } else {
          // Single-email trash cascades to the full thread via thread_id on the backend
          await axios.put(`${API_URL}/email/emails/${primaryId}/trash`, {}, {
            headers: { Authorization: `Bearer ${token}` }
          })
        }
        setSelectedThread(null)
        fetchEmails()
        showToast(isDrafts ? '✓ Draft thread deleted' : isTrash ? '✓ Thread permanently deleted' : '✓ Thread deleted')
      } catch (error) {
        console.error('Error deleting email:', error)
        showToast('Failed to delete', 'error')
      }
    })
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

  const handleBulkMoveToTrash = async () => {
    const isDrafts = currentFolder === 'drafts';
    const isTrash = currentFolder === 'trash';
    const ids = Array.from(selectedThreadIds)
    // Send all email IDs in the selected threads so the entire thread gets trashed/deleted
    const emailIds = threads
      .filter(t => ids.includes(t.id))
      .flatMap(t => t.emails.map(e => e.id))

    const token = getAuthToken()
    try {
      if (isDrafts || isTrash) {
        await axios.post(`${API_URL}/email/bulk-delete-permanent`, emailIds, {
          headers: { Authorization: `Bearer ${token}` }
        })
      } else {
        await axios.post(`${API_URL}/email/bulk-trash`, emailIds, {
          headers: { Authorization: `Bearer ${token}` }
        })
      }
      setSelectedThreadIds(new Set())
      fetchEmails()
      if (isDrafts) {
        showToast(`✓ Deleted ${ids.length} draft thread${ids.length > 1 ? 's' : ''}`)
      } else if (isTrash) {
        showToast(`✓ Permanently deleted ${ids.length} thread${ids.length > 1 ? 's' : ''}`)
      } else {
        showToast(`✓ Moved ${ids.length} thread${ids.length > 1 ? 's' : ''} to trash`)
      }
    } catch (e) {
      console.error((isDrafts || isTrash) ? 'Bulk permanent delete failed:' : 'Bulk trash failed:', e)
      showToast((isDrafts || isTrash) ? 'Bulk delete failed' : 'Bulk move to trash failed', 'error')
    }
  }

  const handleBulkAddLabel = async (labelId: string) => {
    const ids = Array.from(selectedThreadIds)
    const emailIds = threads.filter(t => ids.includes(t.id)).map(t => t.emails[0].id)
    const token = getAuthToken()
    try {
      await axios.post(`${API_URL}/email/bulk-add-label`, {
        email_ids: emailIds,
        label_id: labelId
      }, {
        headers: { Authorization: `Bearer ${token}` }
      })
      setSelectedThreadIds(new Set())
      setShowBulkLabelMenu(false)
      fetchEmails()
      showToast(`✓ Label applied`)
    } catch (e) {
      console.error('Bulk label failed:', e)
      showToast('Bulk labeling failed', 'error')
    }
  }

  const handleBulkMarkRead = async (read: boolean) => {
    const ids = Array.from(selectedThreadIds)
    const emailIds = threads.filter(t => ids.includes(t.id)).map(t => t.emails[0].id)
    const token = getAuthToken()
    try {
      await axios.post(`${API_URL}/email/bulk-mark-read`, {
        email_ids: emailIds,
        is_read: read
      }, {
        headers: { Authorization: `Bearer ${token}` }
      })
      setSelectedThreadIds(new Set())
      fetchEmails()
      showToast(`✓ Marked as ${read ? 'read' : 'unread'}`)
    } catch (e) {
      console.error('Bulk read/unread failed:', e)
      showToast('Bulk read/unread failed', 'error')
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
    setIsSending(true)
    try {
      if (replyMode === 'reply' || replyMode === 'replyAll') {
        const lastExpandedId = expandedEmailIds.size > 0 ? [...expandedEmailIds].at(-1) : undefined
        const replyEmailId = lastExpandedId ?? selectedThread?.emails[selectedThread.emails.length - 1]?.id
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
      playEmailSentSound()
      // Delete the draft from the backend before resetting compose state
      const sentDraftId = currentDraftIdRef.current
      resetCompose()
      if (sentDraftId) deleteDraft(sentDraftId)
      // Refresh: if replying inside a thread, reload full thread so reply appears immediately
      if ((replyMode === 'reply' || replyMode === 'replyAll') && selectedThread) {
        selectThread(selectedThread)
      }
      fetchEmails()
    } catch (error: any) {
      console.error('Error sending email:', error)
      showToast(error?.response?.data?.detail || 'Failed to send email', 'error')
    } finally {
      setIsSending(false)
    }
  }

  const fetchScheduledEmails = async () => {
    const token = getAuthToken()
    if (!token) return
    try {
      const res = await axios.get(`${API_URL}/email/scheduled`, {
        headers: { Authorization: `Bearer ${token}` }
      })
      setScheduledEmails(res.data || [])
    } catch (e) {
      console.error('Error fetching scheduled emails:', e)
    }
  }

  const handleScheduleLater = async () => {
    if (!scheduledAt) {
      showToast('Please pick a date and time', 'error')
      return
    }
    if (!composeData.to.trim()) {
      showToast('Please enter a recipient email address', 'error')
      return
    }
    const schedDate = new Date(scheduledAt)
    if (schedDate <= new Date()) {
      showToast('Scheduled time must be in the future', 'error')
      return
    }
    const token = getAuthToken()
    if (!token) return
    setIsSending(true)
    try {
      await axios.post(
        `${API_URL}/email/send-later`,
        {
          to_address: composeData.to,
          subject: composeData.subject,
          body: composeData.message,
          scheduled_at: schedDate.toISOString(),
          cc: composeData.cc || null,
          bcc: composeData.bcc || null,
        },
        { headers: { Authorization: `Bearer ${token}` } }
      )
      showToast(`✓ Email scheduled for ${schedDate.toLocaleString()}`)
      playEmailSentSound()
      resetCompose()
      setShowSendLater(false)
      setScheduledAt('')
      if (currentFolder === 'scheduled') fetchScheduledEmails()
    } catch (e: any) {
      showToast(e?.response?.data?.detail || 'Failed to schedule email', 'error')
    } finally {
      setIsSending(false)
    }
  }

  const handleCancelScheduled = async (id: number) => {
    const token = getAuthToken()
    if (!token) return
    try {
      await axios.delete(`${API_URL}/email/scheduled/${id}`, {
        headers: { Authorization: `Bearer ${token}` }
      })
      showToast('Scheduled email cancelled')
      setScheduledEmails(prev => prev.filter(e => e.id !== id))
      fetchUnreadCounts()  // update sidebar badge
    } catch (e: any) {
      showToast(e?.response?.data?.detail || 'Failed to cancel', 'error')
    }
  }

  // ===== EMAIL TEMPLATES =====
  const loadTemplates = async () => {
    try {
      const token = getAuthToken()
      const res = await axios.get(`${API_URL}/email/templates`, { headers: { Authorization: `Bearer ${token}` } })
      setTemplates(res.data || [])
    } catch { /* ignore */ }
  }

  const saveTemplate = async () => {
    if (!templateForm.name.trim() || !templateForm.body.trim()) { showToast('Name and body required', 'error'); return }
    try {
      const token = getAuthToken()
      if (editingTemplateId) {
        await axios.put(`${API_URL}/email/templates/${editingTemplateId}`, templateForm, { headers: { Authorization: `Bearer ${token}` } })
        showToast('✓ Template updated')
      } else {
        await axios.post(`${API_URL}/email/templates`, templateForm, { headers: { Authorization: `Bearer ${token}` } })
        showToast('✓ Template created')
      }
      setTemplateForm({ name: '', subject: '', body: '' })
      setEditingTemplateId(null)
      loadTemplates()
    } catch { showToast('Failed to save template', 'error') }
  }

  const deleteTemplate = async (id: number) => {
    try {
      const token = getAuthToken()
      await axios.delete(`${API_URL}/email/templates/${id}`, { headers: { Authorization: `Bearer ${token}` } })
      showToast('✓ Template deleted')
      loadTemplates()
    } catch { showToast('Failed to delete template', 'error') }
  }

  const insertTemplate = (t: { id: number; name: string; subject?: string; body: string }) => {
    if (t.subject) setComposeData(prev => ({ ...prev, subject: t.subject || prev.subject }))
    if (editor) {
      editor.chain().focus().insertContent(t.body).run()
      setTimeout(() => setComposeData(prev => ({ ...prev, message: editor.getHTML() })), 50)
    }
    setShowCannedDropdown(false)
  }

  // ===== SNOOZE =====
  const fetchSnoozedEmails = async () => {
    try {
      const token = getAuthToken()
      const res = await axios.get(`${API_URL}/email/snoozed`, { headers: { Authorization: `Bearer ${token}` } })
      setSnoozedEmails(res.data?.emails || [])
    } catch { /* ignore */ }
  }

  const handleSnooze = async (emailId: number, until: Date) => {
    try {
      const token = getAuthToken()
      await axios.post(`${API_URL}/email/emails/${emailId}/snooze`, { snoozed_until: until.toISOString() }, { headers: { Authorization: `Bearer ${token}` } })
      showToast(`✓ Snoozed until ${until.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`)
      setSnoozeEmailId(null)
      setShowSnoozeMenu(false)
      fetchEmails()
    } catch { showToast('Failed to snooze email', 'error') }
  }

  const handleUnsnooze = async (emailId: number) => {
    try {
      const token = getAuthToken()
      await axios.delete(`${API_URL}/email/emails/${emailId}/snooze`, { headers: { Authorization: `Bearer ${token}` } })
      showToast('✓ Unsnoozed')
      fetchSnoozedEmails()
    } catch { showToast('Failed to unsnooze', 'error') }
  }

  const getSnoozeOptions = (): { label: string; date: Date }[] => {
    const now = new Date()
    const laterToday = new Date(now); laterToday.setHours(now.getHours() + 3)
    const tomorrow = new Date(now); tomorrow.setDate(now.getDate() + 1); tomorrow.setHours(8, 0, 0, 0)
    const nextWeek = new Date(now); nextWeek.setDate(now.getDate() + 7); nextWeek.setHours(8, 0, 0, 0)
    return [
      { label: '3 hours', date: laterToday },
      { label: 'Tomorrow 8am', date: tomorrow },
      { label: 'Next week', date: nextWeek },
    ]
  }

  // ===== UNDO SEND =====
  const handleSendWithUndo = async () => {
    const token = getAuthToken()
    if (!token) { showToast('Please log in', 'error'); return }
    if (!composeData.to.trim()) { showToast('Please enter a recipient', 'error'); return }
    setIsSending(true)
    try {
      const sendAt = new Date(Date.now() + 6000) // 6 second window
      const res = await axios.post(`${API_URL}/email/send-later`, {
        to_address: composeData.to,
        subject: composeData.subject,
        body: composeData.message,
        scheduled_at: sendAt.toISOString(),
        cc: composeData.cc || null,
        bcc: composeData.bcc || null,
      }, { headers: { Authorization: `Bearer ${token}` } })
      const scheduledId = res.data?.email_id || res.data?.id
      const sentDraftId = currentDraftIdRef.current
      resetCompose()
      // Don't delete draft yet — wait until undo window expires so user can undo

      // Start undo countdown
      let countdown = 5
      setUndoSendState({ scheduledId, countdown, timer: null })
      const timer = setInterval(() => {
        countdown -= 1
        setUndoSendState(prev => prev ? { ...prev, countdown } : null)
        if (countdown <= 0) {
          clearInterval(timer)
          setUndoSendState(null)
          undoSendRef.current = null
          if (sentDraftId) deleteDraft(sentDraftId)  // delete draft only after send is confirmed
          fetchEmails()
        }
      }, 1000)
      undoSendRef.current = { scheduledId, timer }
      setUndoSendState({ scheduledId, countdown, timer })
    } catch (e: any) {
      showToast(e?.response?.data?.detail || 'Failed to send email', 'error')
    } finally {
      setIsSending(false)
    }
  }

  const handleUndoSend = async () => {
    if (!undoSendRef.current) return
    const { scheduledId, timer } = undoSendRef.current
    if (timer) clearInterval(timer)
    try {
      const token = getAuthToken()
      await axios.delete(`${API_URL}/email/scheduled/${scheduledId}`, { headers: { Authorization: `Bearer ${token}` } })
      showToast('✓ Send cancelled')
    } catch { showToast('Could not cancel — email may have already sent', 'error') }
    setUndoSendState(null)
    undoSendRef.current = null
  }

  // ===== PERMANENT BULK DELETE FROM TRASH =====
  const handleBulkPermanentDelete = () => {
    if (selectedThreadIds.size === 0) return
    const msg = `Permanently delete ${selectedThreadIds.size} email(s)? This cannot be undone.`
    requestDelete(msg, async () => {
      const ids = Array.from(selectedThreadIds)
      const emailIds = threads.filter(t => ids.includes(t.id)).flatMap(t => t.emails.map(e => e.id))
      try {
        const token = getAuthToken()
        await axios.post(`${API_URL}/email/bulk-delete-permanent`, emailIds, { headers: { Authorization: `Bearer ${token}` } })
        setSelectedThreadIds(new Set())
        fetchEmails()
        showToast(`✓ Permanently deleted ${emailIds.length} email(s)`)
      } catch { showToast('Failed to delete emails', 'error') }
    })
  }

  /*
  const handlePermanentDeleteSingle = async (emailId: number) => {
    if (!confirm('Permanently delete this email? This cannot be undone.')) return
    try {
      const token = getAuthToken()
      await axios.delete(`${API_URL}/email/emails/${emailId}/permanent`, { headers: { Authorization: `Bearer ${token}` } })
      setSelectedThread(null)
      fetchEmails()
      showToast('✓ Permanently deleted')
    } catch { showToast('Failed to permanently delete email', 'error') }
  }
  */

  // ===== NOTIFICATION CENTER =====
  const addNotifHistory = (title: string, desc: string, icon: string) => {
    const entry = { id: `n-${Date.now()}-${Math.random()}`, title, desc, icon, time: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }), read: false }
    setNotificationHistory(prev => [entry, ...prev].slice(0, 50))
    setUnreadNotifCount(prev => prev + 1)
  }

  const markAllNotifsRead = () => {
    setNotificationHistory(prev => prev.map(n => ({ ...n, read: true })))
    setUnreadNotifCount(0)
  }

  // ===== EMAIL RULES =====
  const loadRules = async () => {
    try {
      const token = getAuthToken()
      const res = await axios.get(`${API_URL}/email/rules`, { headers: { Authorization: `Bearer ${token}` } })
      setRules(res.data || [])
    } catch { /* ignore */ }
  }

  const saveRule = async () => {
    if (!ruleForm.name.trim()) { showToast('Rule name required', 'error'); return }
    if (ruleForm.conditions.length === 0) { showToast('Add at least one condition', 'error'); return }
    if (ruleForm.actions.length === 0) { showToast('Add at least one action', 'error'); return }
    try {
      const token = getAuthToken()
      const payload = { name: ruleForm.name, is_active: true, match_all: ruleForm.match_all, conditions: ruleForm.conditions, actions: ruleForm.actions }
      if (editingRuleId) {
        await axios.put(`${API_URL}/email/rules/${editingRuleId}`, payload, { headers: { Authorization: `Bearer ${token}` } })
        showToast('✓ Rule updated')
      } else {
        await axios.post(`${API_URL}/email/rules`, payload, { headers: { Authorization: `Bearer ${token}` } })
        showToast('✓ Rule created')
      }
      setRuleForm({ name: '', match_all: true, conditions: [{ field: 'from', op: 'contains', value: '' }], actions: [{ type: 'label', value: '' }] })
      setEditingRuleId(null)
      loadRules()
    } catch { showToast('Failed to save rule', 'error') }
  }

  const deleteRule = async (id: number) => {
    try {
      const token = getAuthToken()
      await axios.delete(`${API_URL}/email/rules/${id}`, { headers: { Authorization: `Bearer ${token}` } })
      showToast('✓ Rule deleted')
      loadRules()
    } catch { showToast('Failed to delete rule', 'error') }
  }

  const toggleRule = async (rule: typeof rules[0]) => {
    try {
      const token = getAuthToken()
      await axios.put(`${API_URL}/email/rules/${rule.id}`, { ...rule, is_active: !rule.is_active }, { headers: { Authorization: `Bearer ${token}` } })
      loadRules()
    } catch { showToast('Failed to toggle rule', 'error') }
  }

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

  if (emailAccountConfigured === false) {

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
    <div className="h-screen bg-gray-100 flex flex-col">
      {/* Toast Notification */}
      {toast && (
        <div className={`fixed top-4 right-4 px-6 py-3 rounded-lg shadow-lg text-white font-semibold z-50 animate-fade-in ${toast.type === 'success' ? 'bg-green-500' : 'bg-red-500'
          }`}>
          {toast.message}
        </div>
      )}

      {/* Custom Delete Confirmation Modal */}
      {deleteDialog && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black bg-opacity-50">
          <div className="bg-white rounded-xl shadow-2xl overflow-hidden max-w-sm w-full animate-scale-up">
            <div className="bg-red-50 border-b border-red-100 p-5 flex items-center gap-3">
              <svg className="w-6 h-6 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
              <h3 className="font-bold text-red-900 leading-tight">Confirm Deletion</h3>
            </div>
            <div className="p-6">
              <p className="text-gray-700 text-sm mb-6 font-medium">{deleteDialog.message}</p>
              <label className="flex items-center gap-3 bg-gray-50 p-3 rounded-lg border border-gray-200 cursor-pointer hover:bg-gray-100 transition group mb-6">
                <input
                  type="checkbox"
                  className="w-4 h-4 text-red-600 rounded border-gray-300 focus:ring-red-500 cursor-pointer"
                  checked={skipDeleteConfirm}
                  onChange={(e) => {
                    setSkipDeleteConfirm(e.target.checked)
                    if (e.target.checked) {
                      localStorage.setItem('email_skip_delete_confirm', 'true')
                    } else {
                      localStorage.removeItem('email_skip_delete_confirm')
                    }
                  }}
                />
                <span className="text-sm font-medium text-gray-700 select-none group-hover:text-gray-900">Don't ask me again</span>
              </label>
              <div className="flex justify-end gap-3">
                <button
                  onClick={() => setDeleteDialog(null)}
                  className="px-5 py-2.5 rounded-lg font-semibold text-gray-700 hover:bg-gray-100 hover:text-gray-900 transition border border-transparent"
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    deleteDialog.onConfirm();
                    setDeleteDialog(null);
                  }}
                  className="px-5 py-2.5 bg-red-600 hover:bg-red-700 text-white rounded-lg font-semibold shadow-sm transition hover:shadow focus:ring-2 focus:ring-red-500 focus:ring-offset-2"
                >
                  Delete
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      {/* Notification Panel */}
      {showNotificationPanel && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setShowNotificationPanel(false)} />
          <div className="fixed top-0 right-0 h-full w-full max-w-sm bg-white shadow-2xl z-50 flex flex-col border-l border-gray-200">
            <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between bg-gray-50">
              <h2 className="font-bold text-gray-800 text-base">Notifications</h2>
              <div className="flex items-center gap-2">
                {unreadNotifCount > 0 && <button onClick={markAllNotifsRead} className="text-xs text-blue-600 hover:underline">Mark all read</button>}
                <button onClick={() => setShowNotificationPanel(false)} className="text-gray-400 hover:text-gray-700 text-xl leading-none">&times;</button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto">
              {notificationHistory.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-gray-400 text-sm gap-2 pb-12">
                  <span className="text-4xl">&#128276;</span>
                  <p>No notifications yet</p>
                </div>
              ) : notificationHistory.map(n => (
                <div key={n.id} className={`flex items-start gap-3 px-4 py-3 border-b border-gray-100 transition ${n.read ? 'opacity-60' : 'bg-blue-50'}`}>
                  <span className="text-xl flex-shrink-0">{n.icon}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-gray-800">{n.title}</p>
                    <p className="text-xs text-gray-500 truncate">{n.desc}</p>
                  </div>
                  <span className="text-xs text-gray-400 flex-shrink-0">{n.time}</span>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {/* Mobile backdrop */}
      {showMobileSidebar && (
        <div className="fixed inset-0 bg-black bg-opacity-40 z-20 md:hidden" onClick={() => setShowMobileSidebar(false)} />
      )}

      {/* Mobile top bar */}
      <div className="md:hidden flex-shrink-0 bg-white border-b border-gray-200 flex items-center gap-2 px-3 py-2">
        <button onClick={() => setShowMobileSidebar(v => !v)} className="w-8 h-8 flex items-center justify-center rounded text-gray-600 hover:bg-gray-100">
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" /></svg>
        </button>
        <span className="font-bold text-gray-800 text-sm flex-1">Mail</span>
        <button
          onClick={() => {
            setRequestStatus('idle')
            setRequestMessage('')
            setShowRequestModal(true)
          }}
          className="relative w-8 h-8 flex items-center justify-center rounded text-blue-600 hover:bg-gray-100 text-lg"
          title="Request Account"
        >
          ➕
        </button>
        <button onClick={() => { setShowNotificationPanel(v => !v); markAllNotifsRead() }} className="relative w-8 h-8 flex items-center justify-center rounded text-gray-600 hover:bg-gray-100 text-lg">
          &#128276;
          {unreadNotifCount > 0 && <span className="absolute -top-0.5 -right-0.5 w-4 h-4 bg-red-500 text-white text-[9px] font-bold rounded-full flex items-center justify-center">{unreadNotifCount}</span>}
        </button>
        {mobileView === 'detail' && (
          <button onClick={() => setMobileView('list')} className="text-xs text-blue-600 font-semibold px-2">&larr; Back</button>
        )}
      </div>

      {/* Main inner row */}
      <div className="flex flex-1 min-h-0 overflow-hidden">

        {/* Folders Column */}
        <div className={`${showMobileSidebar ? 'translate-x-0' : '-translate-x-full'} md:translate-x-0 fixed md:static z-30 md:z-auto top-0 left-0 h-full w-52 bg-white border-r border-gray-200 flex flex-col overflow-hidden transition-transform duration-200`}>
          {/* Sidebar header */}
          <div className="bg-white border-b border-gray-200 px-4 py-3 flex-shrink-0">
            <div className="mb-3">
              <label className="text-[10px] font-bold text-gray-400 uppercase tracking-tighter block mb-1">Email Account</label>
              <div className="flex items-center gap-1.5">
                <div className="relative flex-1">
                  <select
                    value={selectedAccountId || ''}
                    onChange={(e) => setSelectedAccountId(Number(e.target.value))}
                    className="w-full bg-gray-50 border border-gray-200 text-xs rounded-md py-1.5 pl-2 pr-8 appearance-none focus:outline-none focus:ring-1 focus:ring-blue-500 text-gray-700 font-medium truncate"
                  >
                    {emailAccounts.map(acc => (
                      <option key={acc.id} value={acc.id}>{acc.email_address}</option>
                    ))}
                    {emailAccounts.length === 0 && <option value="">No accounts</option>}
                  </select>
                  <div className="absolute inset-y-0 right-0 flex items-center pr-2 pointer-events-none text-gray-400">
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"></path></svg>
                  </div>
                </div>
                <button
                  onClick={() => {
                    setRequestStatus('idle')
                    setRequestMessage('')
                    setShowRequestModal(true)
                  }}
                  title="Request additional email account"
                  className="w-7 h-7 flex items-center justify-center rounded-md bg-blue-50 text-blue-600 hover:bg-blue-100 transition flex-shrink-0 border border-blue-100 shadow-sm"
                >
                  <span className="text-lg leading-none">+</span>
                </button>
              </div>
            </div>

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
                        const sigContent = buildDefaultSigInsert()
                        const initialContent = buildNewComposeContent() + sigContent
                        setShowCompose(true)
                        setMobileView('detail')
                        setReplyMode('none')
                        setComposeData({ to: '', cc: '', bcc: '', subject: '', message: initialContent, attachments: [] })
                        // We do not synchronously call editor.commands here because EditorContent is not mounted yet,
                        // which would throw an error and break the click interaction. Let React render the modal first.
                        setTimeout(() => {
                          if (editor) {
                            editor.commands.setContent(initialContent)
                            editor.commands.focus('start')
                          }
                        }, 50)
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
                {/* Notification Center Trigger */}
                <div className="group relative">
                  <button
                    onClick={() => setShowNotificationPanel(!showNotificationPanel)}
                    className={`w-8 h-8 flex items-center justify-center rounded-lg transition text-base shadow-sm ${showNotificationPanel ? 'bg-amber-500 text-white' : 'bg-amber-100 hover:bg-amber-200 text-amber-700'}`}
                  >
                    🔔
                    {unreadNotifCount > 0 && (
                      <span className="absolute -top-1 -right-1 bg-red-500 text-white text-[10px] font-bold w-4 h-4 rounded-full flex items-center justify-center border-2 border-white">
                        {unreadNotifCount}
                      </span>
                    )}
                  </button>
                  <span className="absolute top-full left-1/2 -translate-x-1/2 mt-1 px-2 py-0.5 text-xs bg-gray-800 text-white rounded whitespace-nowrap invisible group-hover:visible z-50">Notifications</span>
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
                    className={`w-full text-left px-3 py-2 rounded-lg text-sm transition flex items-center gap-2 ${currentFolder === folder.id
                      ? 'text-white font-semibold shadow-sm'
                      : 'hover:bg-gray-100 text-gray-700'
                      }`}
                    style={currentFolder === folder.id ? { backgroundColor: 'var(--button-primary)' } : {}}
                  >
                    <span className="text-lg">{folder.icon}</span>
                    <span className="flex-1">{folder.label}</span>
                    {(unreadCounts[folder.id] ?? 0) > 0 && (
                      <span className={`text-xs font-bold px-1.5 py-0.5 rounded-full min-w-[1.2rem] text-center ${currentFolder === folder.id ? 'bg-white' : 'text-white'
                        }`}
                        style={currentFolder === folder.id ? { color: 'var(--button-primary)' } : { backgroundColor: 'var(--button-primary)' }}
                      >
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
                    className={`w-full text-left px-3 py-2 rounded-lg text-sm transition flex items-center gap-2 ${currentFolder === folder.id
                      ? 'text-white font-semibold shadow-sm'
                      : 'hover:bg-gray-100 text-gray-700'
                      }`}
                    style={currentFolder === folder.id ? { backgroundColor: 'var(--primary-color)' } : {}}
                  >
                    <span className="text-lg">{folder.icon}</span>
                    <span className="flex-1">{folder.label}</span>
                    {(unreadCounts[folder.id] ?? 0) > 0 && (
                      <span className={`text-xs font-bold px-1.5 py-0.5 rounded-full min-w-[1.2rem] text-center ${currentFolder === folder.id ? 'bg-white text-purple-600' : 'bg-purple-500 text-white'
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
                      className={`flex-1 text-left px-3 py-2 rounded-lg text-sm transition flex items-center gap-2 ${currentFolder === folder.id
                        ? 'bg-indigo-500 text-white font-semibold shadow-sm'
                        : 'hover:bg-gray-100 text-gray-700'
                        }`}
                    >
                      <span className="text-lg">{folder.icon}</span>
                      <span className="flex-1 truncate">{folder.label}</span>
                      {(unreadCounts[folder.id] ?? 0) > 0 && (
                        <span className={`text-xs font-bold px-1.5 py-0.5 rounded-full min-w-[1.2rem] text-center ${currentFolder === folder.id ? 'bg-white text-indigo-600' : 'bg-indigo-500 text-white'
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
                      className={`flex-1 text-left px-3 py-2 rounded-lg text-sm transition flex items-center gap-2 ${currentFolder === label.id
                        ? 'text-white font-semibold shadow-sm'
                        : 'hover:bg-gray-100 text-gray-700'
                        } ${currentFolder === label.id ? label.color.replace('100', '500') : label.color}`}
                    >
                      <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: label.color.includes('blue') ? '#3b82f6' : label.color.includes('red') ? '#ef4444' : label.color.includes('green') ? '#10b981' : label.color.includes('yellow') ? '#f59e0b' : label.color.includes('purple') ? '#a855f7' : label.color.includes('pink') ? '#ec4899' : '#6366f1' }}></span>
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
                &#9997; Signatures
              </button>

              <button
                onClick={() => { setCurrentFolder('snoozed'); setSelectedThread(null); setShowMobileSidebar(false) }}
                className={`w-full text-xs px-3 py-2 mt-1 rounded-lg transition font-semibold border ${currentFolder === 'snoozed' ? 'bg-sky-500 text-white border-sky-500' : 'bg-sky-50 text-sky-700 hover:bg-sky-100 border-sky-100'}`}
              >
                &#9201; Snoozed
              </button>

              <button
                onClick={() => { setShowTemplatesModal(true); setShowMobileSidebar(false) }}
                className="w-full text-xs px-3 py-2 mt-1 rounded-lg transition font-semibold bg-teal-50 text-teal-700 hover:bg-teal-100 border border-teal-100"
              >
                &#128196; Templates
              </button>

              <button
                onClick={() => { setShowRulesModal(true); setShowMobileSidebar(false) }}
                className="w-full text-xs px-3 py-2 mt-1 rounded-lg transition font-semibold bg-orange-50 text-orange-700 hover:bg-orange-100 border border-orange-100"
              >
                &#9881; Rules
              </button>

              <button
                onClick={() => {
                  setShowAutoReplyModal(true)
                  setShowMobileSidebar(false)
                  // Fetch current config on open
                  const token = localStorage.getItem('access_token')
                  fetch(`${API_URL || 'http://localhost:8000'}/email/auto-reply`, {
                    headers: { Authorization: `Bearer ${token}` }
                  }).then(r => r.json()).then(d => setAutoReplyConfig({
                    is_enabled: d.is_enabled ?? false,
                    mode: (d.mode === 'ai' ? 'ai' : 'fixed'),
                    subject_prefix: d.subject_prefix || 'Re: ',
                    reply_body: d.reply_body || '',
                    ai_system_prompt: d.ai_system_prompt || '',
                    skip_if_from: d.skip_if_from || '',
                  })).catch(() => { })
                }}
                className={`w-full text-xs px-3 py-2 mt-1 rounded-lg transition font-semibold border ${autoReplyConfig.is_enabled
                  ? 'bg-purple-600 text-white border-purple-600'
                  : 'bg-purple-50 text-purple-700 hover:bg-purple-100 border-purple-100'
                  }`}
              >
                🤖 Auto-Reply {autoReplyConfig.is_enabled ? '(ON)' : ''}
              </button>
            </div>
          </div>
        </div>

        {/* Email List Column */}
        <div className={`${mobileView === 'detail' ? 'hidden' : 'flex'} w-full md:w-80 md:flex bg-white border-r border-gray-200 flex flex-col flex-shrink-0`}>
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
                className={`w-full text-xs px-3 py-2 rounded transition font-semibold ${showUnreadOnly
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
                  className={`flex-1 text-xs px-2 py-1 rounded transition ${sortBy === 'date'
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
                  className={`flex-1 text-xs px-2 py-1 rounded transition ${sortBy === 'sender'
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
                  className={`flex-1 text-xs px-2 py-1 rounded transition ${sortBy === 'subject'
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

          {/* Bulk action bar */}
          {selectedThreadIds.size > 0 && (
            <div className="flex items-center gap-2 px-3 py-2 bg-blue-50 border-b border-blue-200 flex-shrink-0">
              <span className="text-xs font-semibold text-blue-700">{selectedThreadIds.size} selected</span>
              <button onClick={() => handleBulkMarkRead(true)} className="text-xs px-2.5 py-1 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition text-gray-600">Mark Read</button>
              <button onClick={() => handleBulkMarkRead(false)} className="text-xs px-2.5 py-1 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition text-gray-600">Mark Unread</button>
              <div className="relative">
                <button onClick={() => setShowBulkLabelMenu(v => !v)} className="text-xs px-2.5 py-1 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition text-gray-600">🏷️ Label</button>
                {showBulkLabelMenu && (
                  <div className="absolute left-0 top-8 z-50 bg-white border border-gray-200 rounded-xl shadow-lg min-w-[150px] py-1">
                    {customLabels.length === 0 ? (
                      <div className="px-3 py-2 text-xs text-gray-400">No labels yet</div>
                    ) : customLabels.map(label => (
                      <button key={label.id} onClick={() => handleBulkAddLabel(label.id)} className="w-full text-left px-3 py-1.5 text-xs hover:bg-gray-50 flex items-center gap-2">
                        <span className={`w-2.5 h-2.5 rounded-full ${label.color}`}></span>
                        {label.name}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <button onClick={handleBulkMoveToTrash} className="text-xs px-2.5 py-1 bg-white border border-red-200 rounded-lg hover:bg-red-50 transition text-red-500">&#128465; Trash</button>
              {currentFolder === 'trash' && selectedThreadIds.size > 0 && (
                <button onClick={handleBulkPermanentDelete} className="text-xs px-2.5 py-1 bg-red-600 hover:bg-red-700 text-white border border-red-600 rounded-lg transition font-semibold">&#10006; Delete Forever</button>
              )}
              <button onClick={() => { setSelectedThreadIds(new Set()); setShowBulkLabelMenu(false) }} className="ml-auto text-xs text-gray-400 hover:text-gray-600">&times; Clear</button>
            </div>
          )}

          <div className="flex-1 overflow-y-auto">
            {currentFolder === 'snoozed' ? (
              snoozedEmails.length === 0 ? (
                <div className="p-8 text-center text-gray-400 text-sm">No snoozed emails</div>
              ) : (
                <div className="divide-y divide-gray-100">
                  {snoozedEmails.map((email: any) => (
                    <div key={email.id} className="flex items-center gap-3 px-4 py-3 hover:bg-sky-50 transition">
                      <div className="text-2xl select-none">&#9201;</div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-gray-800 truncate">{email.from_address}</p>
                        <p className="text-sm text-gray-600 truncate">{email.subject || '(No Subject)'}</p>
                        <p className="text-xs text-sky-600 mt-0.5">Until {new Date(email.snoozed_until).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</p>
                      </div>
                      <button onClick={() => handleUnsnooze(email.id)} className="text-xs text-sky-600 hover:text-sky-800 px-2.5 py-1 border border-sky-200 rounded-lg hover:bg-sky-50 transition flex-shrink-0">Unsnooze</button>
                    </div>
                  ))}
                </div>
              )
            ) : currentFolder === 'scheduled' ? (
              scheduledEmails.length === 0 ? (
                <div className="p-8 text-center text-gray-400 text-sm">No scheduled emails</div>
              ) : (
                <div className="divide-y divide-gray-100">
                  {scheduledEmails.map(email => {
                    const sendAt = new Date(email.scheduled_at)
                    return (
                      <div key={email.id} className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50 transition">
                        <div className="text-2xl select-none">🕐</div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-gray-800 truncate">{email.to_address}</p>
                          <p className="text-sm text-gray-600 truncate">{email.subject || '(No Subject)'}</p>
                          <p className="text-xs text-blue-600 mt-0.5">
                            Sending {sendAt.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                          </p>
                        </div>
                        <button
                          onClick={() => handleCancelScheduled(email.id)}
                          className="text-xs text-red-500 hover:text-red-700 px-2.5 py-1 border border-red-200 rounded-lg hover:bg-red-50 transition flex-shrink-0"
                        >
                          Cancel
                        </button>
                      </div>
                    )
                  })}
                </div>
              )
            ) : loading ? (
              <div className="p-4 text-center text-gray-500 text-sm">Loading...</div>
            ) : finalFilteredThreads.length === 0 ? (
              <div className="p-4 text-center text-gray-500 text-sm">{searchQuery ? 'No emails match' : 'No emails'}</div>
            ) : (
              <div>
                {finalFilteredThreads.map((thread) => {
                  const lastEmail = thread.emails[thread.emails.length - 1]
                  const receivedAt = lastEmail?.received_at ? parseUtcDate(lastEmail.received_at) : new Date(0)
                  const dayFmt = new Intl.DateTimeFormat('en-US', { hour: '2-digit', minute: '2-digit', timeZone: branding?.timezone || 'UTC' })
                  const fullFmt = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: branding?.timezone || 'UTC' })

                  const today = new Date()
                  const isToday = receivedAt.toDateString() === today.toDateString()
                  const dateDisplay = isToday ? dayFmt.format(receivedAt) : fullFmt.format(receivedAt)
                  const isUnread = !thread.emails[0]?.is_read

                  return (
                    <div key={thread.id} className="relative group flex items-stretch border-b border-gray-200">
                      {/* Checkbox column */}
                      <div
                        className={`flex items-center pl-2 pr-1 flex-shrink-0 transition-all ${selectedThreadIds.size > 0 ? 'w-8 opacity-100' : 'w-0 overflow-hidden opacity-0 group-hover:w-8 group-hover:opacity-100'
                          }`}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <input
                          type="checkbox"
                          checked={selectedThreadIds.has(thread.id)}
                          onChange={(e) => {
                            e.stopPropagation()
                            setSelectedThreadIds(prev => {
                              const next = new Set(prev)
                              if (e.target.checked) next.add(thread.id)
                              else next.delete(thread.id)
                              return next
                            })
                          }}
                          className="w-4 h-4 rounded border-gray-300 text-blue-500 cursor-pointer"
                        />
                      </div>
                      {/* Main thread button */}
                      <button
                        onClick={() => {
                          if (currentFolder === 'outbox') {
                            // Open outbox emails in compose view for retry/edit
                            const email = thread.emails[0]
                            resetCompose()
                            setComposeData({
                              to: email.to_address || '',
                              cc: email.cc || '',
                              bcc: '',
                              subject: email.subject || '',
                              message: email.body_html || email.body_text || '',
                              attachments: [],
                            })
                            setShowCompose(true)
                            setMobileView('detail')
                            setTimeout(() => {
                              if (editor) {
                                editor.commands.setContent(email.body_html || email.body_text || '')
                                editor.commands.focus('start')
                              }
                            }, 50)
                            return
                          }
                          if (currentFolder === 'drafts') {
                            // Open draft in compose view for editing
                            const email = thread.emails[0]
                            resetCompose()
                            setComposeData({
                              to: email.to_address || '',
                              cc: email.cc || '',
                              bcc: '',
                              subject: email.subject || '',
                              message: email.body_html || email.body_text || '',
                              attachments: [],
                            })
                            setCurrentDraftId(email.id)
                            currentDraftIdRef.current = email.id
                            setShowCompose(true)
                            setMobileView('detail')
                            setTimeout(() => {
                              if (editor) {
                                editor.commands.setContent(email.body_html || email.body_text || '')
                                editor.commands.focus('start')
                              }
                            }, 50)
                            return
                          }
                          if (showCompose) {
                            resetCompose()
                          }
                          selectThread(thread)
                        }}
                        draggable
                        onDragStart={() => setDraggedEmailId(thread.emails[0].id)}
                        onDragEnd={() => setDraggedEmailId(null)}
                        className={`flex-1 text-left p-3 transition min-w-0 ${draggedEmailId === thread.emails[0].id ? 'opacity-50' : ''
                          } ${selectedThreadIds.has(thread.id) ? 'bg-blue-50' : selectedThread?.id === thread.id ? 'bg-blue-50' : isUnread ? 'bg-blue-50 hover:bg-blue-100' : 'hover:bg-gray-50'
                          }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1 truncate">
                            {isUnread && <span className="inline-block w-2 h-2 bg-blue-500 rounded-full mr-2"></span>}
                            <div className={`text-xs ${isUnread ? 'font-bold text-gray-900' : 'font-semibold text-gray-700'}`}>{thread.subject}</div>
                            <div className={`text-xs mt-1 truncate ${isUnread ? 'text-gray-700 font-medium' : 'text-gray-600'}`}>{thread.from_address}</div>
                          </div>
                          <div className="flex items-center gap-1.5 flex-shrink-0">
                            <div className={`text-xs whitespace-nowrap ${isUnread ? 'text-blue-600 font-medium' : 'text-gray-500'}`}>{dateDisplay}</div>
                            {thread.emails.length > 1 && (
                              <span className="text-xs bg-gray-200 text-gray-600 font-semibold px-1.5 py-0.5 rounded-full min-w-[1.2rem] text-center">
                                {thread.emails.length}
                              </span>
                            )}
                            {thread.emails[0]?.attachments && thread.emails[0].attachments.length > 0 && (
                              <span className="text-base">📎</span>
                            )}
                          </div>
                        </div>
                      </button>
                      {/* Action buttons column — collapses to 0 width, expands on hover */}
                      <div className="flex flex-col justify-center gap-0.5 overflow-hidden transition-all flex-shrink-0 w-0 group-hover:w-8">
                        <button
                          onClick={() => handleStar(thread.emails[0].id, thread.emails[0].is_starred)}
                          title={thread.emails[0]?.is_starred ? 'Unstar' : 'Star'}
                          className="w-6 h-6 rounded flex items-center justify-center text-gray-400 hover:bg-yellow-50 hover:text-yellow-500 transition text-sm flex-shrink-0"
                        >
                          {thread.emails[0]?.is_starred ? '⭐' : '☆'}
                        </button>
                        <button
                          onClick={() => handleMarkUnread(thread.emails[0].id)}
                          title="Mark unread"
                          className="w-6 h-6 rounded flex items-center justify-center text-gray-400 hover:bg-blue-50 hover:text-blue-500 transition flex-shrink-0"
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>
                        </button>
                        <button
                          onClick={() => handleDelete(thread)}
                          title="Delete"
                          className="w-6 h-6 rounded flex items-center justify-center text-gray-400 hover:bg-red-50 hover:text-red-500 transition flex-shrink-0"
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); setSnoozeEmailId(thread.emails[0].id); setShowSnoozeMenu(true) }}
                          title="Snooze"
                          className="w-6 h-6 rounded flex items-center justify-center text-gray-400 hover:bg-sky-50 hover:text-sky-500 transition flex-shrink-0 text-xs"
                        >
                          &#9201;
                        </button>
                      </div>
                    </div>
                  )
                })}

                {/* Load More Button */}
                {threads.length > 0 && threads.length % 50 === 0 && (
                  <div className="p-4 border-t border-gray-100 flex justify-center">
                    <button
                      onClick={() => fetchEmails(true)}
                      disabled={loadingMore}
                      className="px-6 py-2 text-sm font-medium text-blue-600 hover:text-blue-800 disabled:opacity-50 transition-colors"
                    >
                      {loadingMore ? 'Loading more...' : 'Load older emails'}
                    </button>
                  </div>
                )}
              </div>
            )}
            {hasMore && (
              <div className="p-3 border-t border-gray-100 text-center">
                <button
                  onClick={() => fetchEmails(true)}
                  disabled={loadingMore}
                  className="w-full text-xs px-4 py-2 rounded-lg bg-blue-50 text-blue-600 hover:bg-blue-100 font-semibold transition disabled:opacity-50"
                >
                  {loadingMore ? 'Loading…' : '↓ Load more'}
                </button>
              </div>
            )}
          </div>
          {/* Undo Send Banner - bottom of email list */}
          {undoSendState && (
            <div className="flex-shrink-0 flex items-center justify-center bg-gray-900 text-white text-sm px-4 py-2.5 gap-3 border-t border-gray-700">
              <span>Sending in {undoSendState.countdown}s&hellip;</span>
              <button onClick={handleUndoSend} className="bg-amber-400 hover:bg-amber-300 text-gray-900 font-bold px-4 py-1 rounded-full transition text-sm">&#x21a9; Undo</button>
            </div>
          )}
        </div>

        {/* Email Detail Column */}
        <div className={`${mobileView === 'list' ? 'hidden' : 'flex'} md:flex flex-1 overflow-hidden flex-col bg-white`}>
          {showCompose ? (
            <div className="flex flex-col h-full">
              {/* Header */}
              <div className="bg-slate-700 text-white px-4 py-3 flex items-center justify-between flex-shrink-0">
                <span className="text-sm font-semibold tracking-wide">
                  {replyMode === 'reply' ? 'Reply' : replyMode === 'replyAll' ? 'Reply All' : replyMode === 'forward' ? 'Forward' : 'New Message'}
                </span>
                <button onClick={resetCompose} title="Discard" className="hover:bg-slate-600 rounded p-1 transition text-slate-300 hover:text-white">
                  <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" /></svg>
                </button>
              </div>
              {/* To */}
              <div className="flex items-start gap-3 px-4 py-2.5 border-b border-gray-100">
                <span className="text-xs font-medium text-gray-400 w-14 flex-shrink-0 pt-1.5">To</span>
                <div className="flex-1 min-w-0">
                  <EmailAutocompleteInput value={composeData.to} onChange={(v) => setComposeData({ ...composeData, to: v })} placeholder="Recipients" suggestions={knownEmails} />
                  {composeData.to && <div className="flex flex-wrap gap-1 mt-1">{parseEmails(composeData.to).map((e, i) => <span key={i} className="bg-blue-50 text-blue-700 border border-blue-200 px-2 py-0.5 rounded-full text-xs">{e}</span>)}</div>}
                </div>
                {!showCcBcc && <button onClick={() => setShowCcBcc(true)} className="text-xs text-blue-500 hover:underline flex-shrink-0 pt-1.5">Cc Bcc</button>}
              </div>
              {/* CC */}
              {showCcBcc && (
                <div className="flex items-start gap-3 px-4 py-2.5 border-b border-gray-100">
                  <span className="text-xs font-medium text-gray-400 w-14 flex-shrink-0 pt-1.5">Cc</span>
                  <div className="flex-1 min-w-0">
                    <EmailAutocompleteInput value={composeData.cc} onChange={(v) => setComposeData({ ...composeData, cc: v })} placeholder="Cc" suggestions={knownEmails} />
                    {composeData.cc && <div className="flex flex-wrap gap-1 mt-1">{parseEmails(composeData.cc).map((e, i) => <span key={i} className="bg-purple-50 text-purple-700 border border-purple-200 px-2 py-0.5 rounded-full text-xs">{e}</span>)}</div>}
                  </div>
                </div>
              )}
              {/* BCC */}
              {showCcBcc && (
                <div className="flex items-start gap-3 px-4 py-2.5 border-b border-gray-100">
                  <span className="text-xs font-medium text-gray-400 w-14 flex-shrink-0 pt-1.5">Bcc</span>
                  <div className="flex-1 min-w-0">
                    <EmailAutocompleteInput value={composeData.bcc} onChange={(v) => setComposeData({ ...composeData, bcc: v })} placeholder="Bcc" suggestions={knownEmails} />
                    {composeData.bcc && <div className="flex flex-wrap gap-1 mt-1">{parseEmails(composeData.bcc).map((e, i) => <span key={i} className="bg-gray-100 text-gray-700 border border-gray-200 px-2 py-0.5 rounded-full text-xs">{e}</span>)}</div>}
                  </div>
                </div>
              )}
              {/* Subject */}
              <div className="flex items-center gap-3 px-4 py-2.5 border-b border-gray-100">
                <span className="text-xs font-medium text-gray-400 w-14 flex-shrink-0">Subject</span>
                <input type="text" placeholder="Subject" value={composeData.subject} onChange={(e) => setComposeData({ ...composeData, subject: e.target.value })} className="flex-1 text-sm text-gray-800 placeholder-gray-400 focus:outline-none bg-transparent" />
              </div>
              {/* Editor */}
              <div className="flex-1 overflow-y-auto px-4 pt-3 pb-2 min-h-0 cursor-text [&_.ProseMirror_blockquote]:border-l-4 [&_.ProseMirror_blockquote]:border-blue-400 [&_.ProseMirror_blockquote]:bg-slate-50 [&_.ProseMirror_blockquote]:pl-4 [&_.ProseMirror_blockquote]:pr-3 [&_.ProseMirror_blockquote]:py-2 [&_.ProseMirror_blockquote]:my-2 [&_.ProseMirror_blockquote]:rounded-r [&_.ProseMirror_blockquote]:text-gray-600 [&_.ProseMirror_blockquote]:not-italic" onClick={() => editor?.commands.focus()}>
                {editor && <EditorContent editor={editor} className="outline-none text-sm text-gray-800 min-h-[180px]" />}
              </div>
              {/* Attachment chips */}
              {composeData.attachments.length > 0 && (
                <div className="px-4 pb-2 flex flex-wrap gap-1.5">
                  {composeData.attachments.map((file, idx) => (
                    <span key={idx} className="flex items-center gap-1 bg-gray-100 text-gray-600 text-xs px-2 py-1 rounded-full">
                      📄 {file.name}
                      <button onClick={() => setComposeData({ ...composeData, attachments: composeData.attachments.filter((_, i) => i !== idx) })} className="text-gray-400 hover:text-red-500 ml-0.5">✕</button>
                    </span>
                  ))}
                </div>
              )}
              {/* Footer toolbar */}
              <div className="border-t border-gray-200 px-3 py-2.5 flex items-center gap-1 flex-shrink-0 bg-white">
                <button
                  onClick={handleSendWithUndo}
                  disabled={isSending}
                  className={`text-white text-sm font-semibold px-5 py-1.5 rounded-full transition flex items-center gap-1.5 mr-2 ${isSending
                    ? 'bg-blue-400 cursor-not-allowed'
                    : 'bg-blue-600 hover:bg-blue-700 active:scale-95'
                    }`}
                >
                  {isSending ? (
                    <>
                      <svg className="w-3.5 h-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4l3-3-3-3v4a8 8 0 00-8 8h4z" />
                      </svg>
                      Sending&hellip;
                    </>
                  ) : (
                    <>
                      Send
                      <svg xmlns="http://www.w3.org/2000/svg" className="w-3 h-3" viewBox="0 0 20 20" fill="currentColor"><path d="M10.894 2.553a1 1 0 00-1.788 0l-7 14a1 1 0 001.169 1.409l5-1.429A1 1 0 009 15.571V11a1 1 0 112 0v4.571a1 1 0 00.725.962l5 1.428a1 1 0 001.17-1.408l-7-14z" /></svg>
                    </>
                  )}
                </button>
                {/* Canned responses / templates button */}
                {templates.length > 0 && (
                  <div className="relative">
                    <button
                      onClick={() => setShowCannedDropdown(v => !v)}
                      title="Insert template"
                      className="w-7 h-7 rounded flex items-center justify-center text-gray-500 hover:bg-teal-50 hover:text-teal-600 transition text-sm font-bold mr-0.5"
                    >
                      &#128196;
                    </button>
                    {showCannedDropdown && (
                      <>
                        <div className="fixed inset-0 z-40" onClick={() => setShowCannedDropdown(false)} />
                        <div className="absolute bottom-full left-0 mb-1 bg-white border border-gray-200 rounded-xl shadow-xl z-50 min-w-[200px] py-1 max-h-48 overflow-y-auto">
                          {templates.map(t => (
                            <button key={t.id} onClick={() => insertTemplate(t)} className="w-full text-left px-3 py-2 text-sm text-gray-700 hover:bg-teal-50 hover:text-teal-700 truncate">
                              {t.name}
                            </button>
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                )}
                <div className="relative">
                  <button
                    onClick={() => setShowSendLater(v => !v)}
                    disabled={isSending}
                    title="Schedule send"
                    className="w-7 h-7 rounded flex items-center justify-center text-gray-500 hover:bg-gray-100 transition disabled:opacity-40 mr-1"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </button>
                  {showSendLater && (
                    <div className="absolute bottom-10 left-0 z-50 bg-white border border-gray-200 rounded-xl shadow-xl p-4 w-72">
                      <p className="text-sm font-semibold text-gray-700 mb-2">Schedule send</p>
                      <input
                        type="datetime-local"
                        value={scheduledAt}
                        min={(() => {
                          // datetime-local always works in LOCAL time — never use toISOString() (UTC) here
                          const d = new Date(Date.now() + 60_000)
                          const pad = (n: number) => String(n).padStart(2, '0')
                          return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
                        })()}
                        onChange={e => setScheduledAt(e.target.value)}
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm mb-3 focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                      <button
                        onClick={handleScheduleLater}
                        disabled={!scheduledAt || isSending}
                        className="w-full bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold py-1.5 rounded-lg disabled:opacity-40 transition"
                      >
                        {isSending ? 'Scheduling…' : 'Schedule'}
                      </button>
                    </div>
                  )}
                </div>
                <div className="w-px bg-gray-200 h-5 mx-0.5" />
                {editor && <>
                  <button onClick={() => editor.chain().focus().toggleBold().run()} title="Bold" className={`w-7 h-7 rounded flex items-center justify-center text-xs font-bold transition ${editor.isActive('bold') ? 'bg-blue-100 text-blue-700' : 'hover:bg-gray-100 text-gray-600'}`}><strong>B</strong></button>
                  <button onClick={() => editor.chain().focus().toggleItalic().run()} title="Italic" className={`w-7 h-7 rounded flex items-center justify-center text-xs italic transition ${editor.isActive('italic') ? 'bg-blue-100 text-blue-700' : 'hover:bg-gray-100 text-gray-600'}`}><em>I</em></button>
                  <button onClick={() => editor.chain().focus().toggleUnderline().run()} title="Underline" className={`w-7 h-7 rounded flex items-center justify-center text-xs transition ${editor.isActive('underline') ? 'bg-blue-100 text-blue-700' : 'hover:bg-gray-100 text-gray-600'}`}><u>U</u></button>
                  <button onClick={() => editor.chain().focus().toggleStrike().run()} title="Strikethrough" className={`w-7 h-7 rounded flex items-center justify-center text-xs transition ${editor.isActive('strike') ? 'bg-blue-100 text-blue-700' : 'hover:bg-gray-100 text-gray-600'}`}><s>S</s></button>
                  <div className="w-px bg-gray-200 h-4 mx-0.5" />
                  <label title="Text color" className="relative w-7 h-7 rounded flex flex-col items-center justify-center cursor-pointer hover:bg-gray-100 transition gap-px">
                    <span className="text-xs font-bold text-gray-700 leading-none" style={{ color: textColor }}>A</span>
                    <span className="w-4 h-1 rounded-sm" style={{ backgroundColor: textColor }} />
                    <input type="color" value={textColor} onChange={(e) => { setTextColor(e.target.value); editor.chain().focus().setColor(e.target.value).run() }} className="absolute inset-0 opacity-0 w-full h-full cursor-pointer" />
                  </label>
                  <div className="w-px bg-gray-200 h-4 mx-0.5" />
                  <button onClick={() => editor.chain().focus().toggleBulletList().run()} title="Bullet list" className={`w-7 h-7 rounded flex items-center justify-center transition ${editor.isActive('bulletList') ? 'bg-blue-100 text-blue-700' : 'hover:bg-gray-100 text-gray-500'}`}>
                    <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" /></svg>
                  </button>
                  <button onClick={() => editor.chain().focus().toggleOrderedList().run()} title="Numbered list" className={`w-7 h-7 rounded flex items-center justify-center transition ${editor.isActive('orderedList') ? 'bg-blue-100 text-blue-700' : 'hover:bg-gray-100 text-gray-500'}`}>
                    <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" /></svg>
                  </button>
                  <div className="w-px bg-gray-200 h-4 mx-0.5" />
                  <label title="Insert image" className="w-7 h-7 rounded flex items-center justify-center text-gray-500 hover:bg-gray-100 cursor-pointer transition">
                    <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                    <input type="file" accept="image/*" className="hidden" onChange={(e) => { const file = e.target.files?.[0]; if (!file) return; const reader = new FileReader(); reader.onload = (ev) => { const src = ev.target?.result as string; if (src) editor.chain().focus().setImage({ src }).run() }; reader.readAsDataURL(file); e.currentTarget.value = '' }} />
                  </label>
                  <div className="w-px bg-gray-200 h-4 mx-0.5" />
                  <button onClick={() => editor.chain().focus().undo().run()} disabled={!editor.can().chain().focus().undo().run()} title="Undo" className="w-7 h-7 rounded flex items-center justify-center text-gray-500 hover:bg-gray-100 transition disabled:opacity-30 text-sm">↶</button>
                  <button onClick={() => editor.chain().focus().redo().run()} disabled={!editor.can().chain().focus().redo().run()} title="Redo" className="w-7 h-7 rounded flex items-center justify-center text-gray-500 hover:bg-gray-100 transition disabled:opacity-30 text-sm">↷</button>
                </>}
                <div className="flex-1" />
                <label htmlFor="compose-attach-main" title="Attach file" className="w-7 h-7 rounded flex items-center justify-center text-gray-500 hover:bg-gray-100 cursor-pointer transition">
                  <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" /></svg>
                  <input id="compose-attach-main" type="file" multiple className="hidden" onChange={(e) => setComposeData({ ...composeData, attachments: Array.from(e.target.files || []) })} />
                </label>
                {signatures.length > 0 && (
                  <div className="relative">
                    <button
                      onClick={() => setShowSigDropdown(v => !v)}
                      title="Insert signature"
                      className="w-7 h-7 rounded flex items-center justify-center text-gray-500 hover:bg-gray-100 transition text-base"
                    >✍️</button>
                    {showSigDropdown && (
                      <>
                        <div className="fixed inset-0 z-40" onClick={() => setShowSigDropdown(false)} />
                        <div className="absolute bottom-full right-0 mb-1 bg-white border border-gray-200 rounded shadow-lg z-50 min-w-max">
                          {signatures.map((sig) => (
                            <button
                              key={sig.id}
                              type="button"
                              onClick={() => {
                                if (editor) {
                                  const separator = '<hr style="border:none;border-top:2px solid #e5e7eb;margin:16px 0;">'
                                  editor.chain().focus('end').insertContent(`<p><br /></p>${separator}${generateSignatureHTML(sig)}`).run()
                                  setTimeout(() => setComposeData(prev => ({ ...prev, message: editor.getHTML() })), 50)
                                }
                                setShowSigDropdown(false)
                              }}
                              className="block w-full text-left px-3 py-1.5 text-sm text-gray-700 hover:bg-purple-50 hover:text-purple-700 whitespace-nowrap"
                            >
                              {sig.isDefault ? '✓ ' : ''}{sig.name}
                            </button>
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                )}
                {autoSaveStatus === 'saving' && (
                  <span className="text-xs text-gray-400 px-1 animate-pulse">Saving…</span>
                )}
                {autoSaveStatus === 'saved' && (
                  <span className="text-xs text-green-500 px-1">✓ Saved</span>
                )}
                <button onClick={() => saveDraft(false)} title="Save draft" className="w-7 h-7 rounded flex items-center justify-center text-gray-500 hover:bg-gray-100 transition">
                  <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" /></svg>
                </button>
                <div className="ml-auto flex items-center gap-3">
                  {autoSaveStatus !== 'idle' && (
                    <span className="text-[10px] uppercase font-bold tracking-widest text-gray-400 flex items-center gap-1.5 animate-fade-in">
                      {autoSaveStatus === 'saving' ? (
                        <>
                          <span className="w-1.5 h-1.5 bg-blue-400 rounded-full animate-pulse" />
                          Saving...
                        </>
                      ) : (
                        <>
                          <span className="text-green-500 font-bold">✓</span>
                          Saved
                        </>
                      )}
                    </span>
                  )}
                  <button onClick={resetCompose} title="Discard" className="w-7 h-7 rounded flex items-center justify-center text-gray-500 hover:bg-red-50 hover:text-red-500 transition">
                    <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                  </button>
                </div>
              </div>
            </div>
          ) : selectedThread ? (
            <div className="flex flex-col h-full">
              <>
                {/* Thread header — matches compose/reply style */}
                <div className="bg-slate-700 text-white px-4 py-3 flex items-center gap-3 flex-shrink-0">
                  <div className="flex-1 min-w-0">
                    <h2 className="text-sm font-semibold truncate leading-snug">{selectedThread.subject}</h2>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-xs text-slate-400">{selectedThread.emails.length} message{selectedThread.emails.length !== 1 ? 's' : ''} in thread</span>
                      {selectedThread.emails.some(e => !e.is_read) && (
                        <span className="bg-blue-400 text-white text-xs font-semibold px-2 py-0.5 rounded-full">Unread</span>
                      )}
                    </div>
                  </div>
                  <button onClick={() => setSelectedThread(null)} title="Close" className="hover:bg-slate-600 rounded p-1 transition text-slate-300 hover:text-white flex-shrink-0">
                    <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" /></svg>
                  </button>
                </div>

                {/* Scrollable email list */}
                <div className="flex-1 overflow-y-auto min-h-0 p-4">
                  {/* Email cards — chronological timeline */}
                  <div className="relative space-y-3">
                    {/* Timeline spine connecting all messages */}
                    <div className="absolute left-3.5 top-6 bottom-6 w-0.5 bg-gray-200 rounded-full pointer-events-none" />
                    {selectedThread.emails.map((email, emailIdx) => {
                      const isSent = email.is_sent
                      return (
                        <div key={email.id} className={`relative ${isSent ? 'pl-14' : 'pl-10'}`}>
                          {/* Timeline dot */}
                          <div className={`absolute top-4 w-4 h-4 rounded-full border-2 border-white shadow-sm ${isSent ? 'left-4 bg-emerald-500' : 'left-1.5 bg-blue-500'}`} />
                          <div className={`rounded-xl shadow-sm border overflow-hidden ${isSent ? 'bg-blue-50 border-blue-200' : 'bg-white border-gray-200'}`}>
                            {/* Collapsed header */}
                            <button
                              onClick={() => setExpandedEmailIds(prev => { const next = new Set(prev); next.has(email.id) ? next.delete(email.id) : next.add(email.id); return next })}
                              className={`w-full text-left px-4 py-3 transition flex items-center gap-3 ${isSent ? 'hover:bg-blue-100' : 'hover:bg-gray-50'}`}
                            >
                              {/* Avatar — green for sent, blue for received */}
                              <div className={`w-9 h-9 rounded-full flex items-center justify-center text-white font-bold text-sm flex-shrink-0 ${isSent ? 'bg-gradient-to-br from-green-400 to-emerald-600' : 'bg-gradient-to-br from-blue-400 to-indigo-600'}`}>
                                {isSent ? '↑' : (email.from_address || '?')[0].toUpperCase()}
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center justify-between gap-2">
                                  <span className={`text-sm font-semibold truncate ${!email.is_read ? 'text-gray-900' : 'text-gray-700'}`}>
                                    {isSent ? <span className="text-emerald-700">You → {email.to_address}</span> : email.from_address}
                                  </span>
                                  <span className="text-xs text-gray-400 whitespace-nowrap flex-shrink-0">
                                    {parseUtcDate(email.received_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                                  </span>
                                </div>
                                <div className="text-xs text-gray-400 truncate mt-0.5">
                                  {isSent ? '📤 Sent' : ''}{email.is_starred ? ' ⭐' : ''}{!isSent && emailIdx === selectedThread.emails.length - 1 ? 'Latest' : ''}
                                  {email.attachments && email.attachments.length > 0 ? ` · 📎 ${email.attachments.length}` : ''}
                                </div>
                              </div>
                              <span className="text-gray-400 text-xs flex-shrink-0">{expandedEmailIds.has(email.id) ? '▾' : '▸'}</span>
                            </button>

                            {expandedEmailIds.has(email.id) && (
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
                                  <div className="bg-white rounded-lg border border-gray-100 p-4 overflow-auto max-h-[60vh] text-sm text-gray-800 leading-relaxed email-body">
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

                              </div>
                            )}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>{/* end scrollable list */}

                {/* Bottom toolbar — actions for latest email */}
                <div className="border-t border-gray-200 px-3 py-2.5 flex items-center gap-2 flex-shrink-0 bg-white">
                  {(() => {
                    const latestEmail = selectedThread.emails[selectedThread.emails.length - 1]
                    return (<>
                      <button onClick={() => handleReply(latestEmail, selectedThread)} className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold px-4 py-1.5 rounded-full transition flex items-center gap-1.5">
                        <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M7.707 3.293a1 1 0 010 1.414L5.414 7H11a7 7 0 017 7v2a1 1 0 11-2 0v-2a5 5 0 00-5-5H5.414l2.293 2.293a1 1 0 11-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 0z" clipRule="evenodd" /></svg>
                        Reply
                      </button>
                      <button onClick={() => handleReplyAll(latestEmail, selectedThread)} className="bg-purple-500 hover:bg-purple-600 text-white text-sm font-semibold px-4 py-1.5 rounded-full transition flex items-center gap-1.5">
                        Reply All
                      </button>
                      <button onClick={() => handleForward(latestEmail, selectedThread)} className="bg-emerald-500 hover:bg-emerald-600 text-white text-sm font-semibold px-4 py-1.5 rounded-full transition flex items-center gap-1.5">
                        <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M12.293 3.293a1 1 0 011.414 0l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414-1.414L14.586 10H9a5 5 0 00-5 5v2a1 1 0 11-2 0v-2a7 7 0 017-7h5.586l-2.293-2.293a1 1 0 010-1.414z" clipRule="evenodd" /></svg>
                        Forward
                      </button>
                      <div className="w-px bg-gray-200 h-5 mx-1" />
                      <button onClick={() => handleMarkUnread(latestEmail.id)} className="w-8 h-8 rounded-full flex items-center justify-center text-gray-400 hover:bg-yellow-50 hover:text-yellow-600 transition" title="Mark Unread">
                        <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>
                      </button>
                      <div className="flex-1" />
                      {customLabels.length > 0 && (
                        <div className="flex flex-wrap gap-1">
                          {customLabels.map((label) => (
                            <button
                              key={label.id}
                              onClick={() => handleAssignLabel(latestEmail.id, label.id)}
                              className={`px-2 py-0.5 rounded-full text-xs font-medium transition ${latestEmail.labels && latestEmail.labels.includes(label.id)
                                ? `${label.color} text-gray-900 ring-2 ring-gray-400 ring-offset-1`
                                : `${label.color} text-gray-600 opacity-60 hover:opacity-100`
                                }`}
                            >
                              {label.name}
                            </button>
                          ))}
                        </div>
                      )}
                      <button onClick={() => handleStar(latestEmail.id, latestEmail.is_starred)} className={`w-8 h-8 rounded-full flex items-center justify-center transition text-base ${latestEmail.is_starred ? 'bg-amber-100 text-amber-500 hover:bg-amber-200' : 'hover:bg-gray-100 text-gray-400'}`} title={latestEmail.is_starred ? 'Unstar' : 'Star'}>
                        {latestEmail.is_starred ? '⭐' : '☆'}
                      </button>
                      <button onClick={() => handleDelete(latestEmail.id)} className="w-8 h-8 rounded-full flex items-center justify-center text-gray-400 hover:bg-red-50 hover:text-red-500 transition" title="Delete">
                        <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                      </button>
                    </>)
                  })()}
                </div>
              </>
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
                        className={`h-8 rounded border-2 transition ${selectedLabelColor === color ? 'border-gray-800' : 'border-gray-300'
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
            <div className="bg-white rounded-xl w-full max-w-3xl mx-4 shadow-2xl flex flex-col max-h-[90vh]">

              {/* Header */}
              <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 flex-shrink-0">
                <h2 className="text-xl font-bold text-gray-900">Email Signatures</h2>
                <button onClick={() => setShowSignatureSettings(false)} className="w-8 h-8 rounded-full flex items-center justify-center text-gray-500 hover:bg-gray-100 transition text-lg">✕</button>
              </div>

              <div className="overflow-y-auto flex-1 p-6 space-y-6">

                {/* Create New Signature */}
                <div className="border border-purple-200 rounded-xl p-4 bg-purple-50">
                  <h3 className="font-semibold text-purple-800 mb-3">✏️ Create New Signature</h3>
                  <div className="space-y-3">
                    <div>
                      <label className="block text-sm font-semibold text-gray-700 mb-1">Signature Name</label>
                      <input
                        type="text"
                        placeholder="e.g., Main, Work, Official"
                        value={newSignatureName}
                        onChange={(e) => setNewSignatureName(e.target.value)}
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:border-purple-500 text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-semibold text-gray-700 mb-1">Signature Content</label>
                      <SignatureRichEditor
                        key={sigEditorKey}
                        initialContent={signatureEditorContent}
                        onChange={setSignatureEditorContent}
                      />
                    </div>
                    <button
                      onClick={createSignature}
                      className="w-full bg-purple-600 hover:bg-purple-700 text-white font-semibold py-2 px-4 rounded-lg transition"
                    >
                      + Create Signature
                    </button>
                  </div>
                </div>

                {/* Existing Signatures */}
                <div>
                  <h3 className="font-semibold text-gray-700 mb-3">Your Signatures</h3>
                  {signatures.length === 0 ? (
                    <p className="text-gray-400 text-sm italic">No signatures yet — create one above.</p>
                  ) : (
                    <div className="space-y-3">
                      {signatures.map((sig) => (
                        <div key={sig.id} className="border border-gray-200 rounded-xl overflow-hidden">

                          {/* Signature header row */}
                          <div className="flex items-center justify-between px-4 py-2.5 bg-gray-50 border-b border-gray-200">
                            <div className="flex items-center gap-2 min-w-0">
                              <span className="font-semibold text-gray-800 truncate">{sig.name}</span>
                              {sig.isDefault && (
                                <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full flex-shrink-0">Default</span>
                              )}
                            </div>
                            <div className="flex items-center gap-1.5 flex-shrink-0">
                              <button
                                onClick={() => startEditSignature(sig)}
                                className="text-xs bg-amber-100 text-amber-700 hover:bg-amber-200 px-2.5 py-1 rounded-lg transition"
                              >✏️ Edit</button>
                              {!sig.isDefault && (
                                <button
                                  onClick={() => setDefaultSignature(sig.id)}
                                  className="text-xs bg-blue-100 text-blue-700 hover:bg-blue-200 px-2.5 py-1 rounded-lg transition"
                                >Set Default</button>
                              )}
                              <button
                                onClick={() => deleteSignature(sig.id)}
                                className="text-xs bg-red-100 text-red-700 hover:bg-red-200 px-2.5 py-1 rounded-lg transition"
                              >Delete</button>
                            </div>
                          </div>

                          {/* Signature preview */}
                          <div className="px-4 py-3 text-sm max-h-40 overflow-y-auto bg-white">
                            {sig.htmlContent && sig.htmlContent !== '<p></p>' ? (
                              <div dangerouslySetInnerHTML={{ __html: sig.htmlContent }} className="prose prose-sm max-w-none" />
                            ) : (
                              <div className="text-gray-400 italic text-xs">No preview — edit to add content.</div>
                            )}
                          </div>

                          {/* Edit Form (inline, below the card) */}
                          {editingSignatureId === sig.id && (
                            <div className="border-t border-amber-200 bg-amber-50 p-4 space-y-3">
                              <h4 className="font-semibold text-amber-800 text-sm">Edit "{sig.name}"</h4>
                              <div>
                                <label className="block text-xs font-semibold text-gray-600 mb-1">Signature Name</label>
                                <input
                                  type="text"
                                  value={editSignatureName}
                                  onChange={(e) => setEditSignatureName(e.target.value)}
                                  className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:border-amber-500 text-sm"
                                />
                              </div>
                              <div>
                                <label className="block text-xs font-semibold text-gray-600 mb-1">Signature Content</label>
                                <SignatureRichEditor
                                  key={editSigEditorKey}
                                  initialContent={editSignatureEditorContent}
                                  onChange={setEditSignatureEditorContent}
                                />
                              </div>
                              <div className="flex gap-2">
                                <button
                                  onClick={updateSignature}
                                  className="flex-1 bg-amber-500 hover:bg-amber-600 text-white font-semibold py-2 px-4 rounded-lg transition"
                                >💾 Save Changes</button>
                                <button
                                  onClick={cancelEditSignature}
                                  className="flex-1 bg-gray-200 hover:bg-gray-300 text-gray-700 font-semibold py-2 px-4 rounded-lg transition"
                                >Cancel</button>
                              </div>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* === EMAIL TEMPLATES MODAL === */}
        {showTemplatesModal && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-xl w-full max-w-2xl mx-4 shadow-2xl flex flex-col max-h-[85vh]">
              <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 flex-shrink-0">
                <h2 className="text-xl font-bold text-gray-900">Email Templates</h2>
                <button onClick={() => { setShowTemplatesModal(false); setEditingTemplateId(null); setTemplateForm({ name: '', subject: '', body: '' }) }} className="w-8 h-8 rounded-full flex items-center justify-center text-gray-500 hover:bg-gray-100 text-lg">&times;</button>
              </div>
              <div className="overflow-y-auto flex-1 p-6 space-y-6">
                {/* Create / Edit Form */}
                <div className="border border-blue-200 rounded-xl p-4 bg-blue-50">
                  <h3 className="font-semibold text-blue-800 mb-3">{editingTemplateId ? 'Edit Template' : '+ New Template'}</h3>
                  <div className="space-y-2">
                    <input type="text" placeholder="Template name (e.g. Welcome Reply)" value={templateForm.name} onChange={e => setTemplateForm(f => ({ ...f, name: e.target.value }))} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500" />
                    <input type="text" placeholder="Subject (optional)" value={templateForm.subject} onChange={e => setTemplateForm(f => ({ ...f, subject: e.target.value }))} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500" />
                    <textarea placeholder="Template body" rows={5} value={templateForm.body} onChange={e => setTemplateForm(f => ({ ...f, body: e.target.value }))} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500 resize-none" />
                    <div className="flex gap-2">
                      <button onClick={saveTemplate} className="flex-1 bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2 rounded-lg transition text-sm">{editingTemplateId ? 'Update' : '+ Create'}</button>
                      {editingTemplateId && <button onClick={() => { setEditingTemplateId(null); setTemplateForm({ name: '', subject: '', body: '' }) }} className="px-4 py-2 bg-gray-200 hover:bg-gray-300 rounded-lg text-sm">Cancel</button>}
                    </div>
                  </div>
                </div>
                {/* Template list */}
                {templates.length === 0 ? (
                  <p className="text-gray-400 text-sm italic">No templates yet — create one above.</p>
                ) : (
                  <div className="space-y-2">
                    {templates.map(t => (
                      <div key={t.id} className="border border-gray-200 rounded-xl p-3 flex items-start justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <p className="font-semibold text-gray-800 text-sm">{t.name}</p>
                          {t.subject && <p className="text-xs text-gray-500 truncate">Subject: {t.subject}</p>}
                          <p className="text-xs text-gray-400 truncate mt-0.5" dangerouslySetInnerHTML={{ __html: t.body.replace(/<[^>]*>/g, '') }} />
                        </div>
                        <div className="flex gap-1.5 flex-shrink-0">
                          {showCompose && <button onClick={() => { insertTemplate(t); setShowTemplatesModal(false) }} className="text-xs bg-green-100 text-green-700 hover:bg-green-200 px-2.5 py-1 rounded-lg transition">Insert</button>}
                          <button onClick={() => { setEditingTemplateId(t.id); setTemplateForm({ name: t.name, subject: t.subject || '', body: t.body }) }} className="text-xs bg-amber-100 text-amber-700 hover:bg-amber-200 px-2.5 py-1 rounded-lg transition">Edit</button>
                          <button onClick={() => deleteTemplate(t.id)} className="text-xs bg-red-100 text-red-700 hover:bg-red-200 px-2.5 py-1 rounded-lg transition">Delete</button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* === EMAIL RULES MODAL === */}
        {showRulesModal && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-xl w-full max-w-2xl mx-4 shadow-2xl flex flex-col max-h-[90vh]">
              <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 flex-shrink-0">
                <h2 className="text-xl font-bold text-gray-900">Email Rules / Filters</h2>
                <button onClick={() => { setShowRulesModal(false); setEditingRuleId(null) }} className="w-8 h-8 rounded-full flex items-center justify-center text-gray-500 hover:bg-gray-100 text-lg">&times;</button>
              </div>
              <div className="overflow-y-auto flex-1 p-6 space-y-6">
                {/* Rule form */}
                <div className="border border-orange-200 rounded-xl p-4 bg-orange-50">
                  <h3 className="font-semibold text-orange-800 mb-3">{editingRuleId ? 'Edit Rule' : '+ New Rule'}</h3>
                  <div className="space-y-3">
                    <input type="text" placeholder="Rule name" value={ruleForm.name} onChange={e => setRuleForm(f => ({ ...f, name: e.target.value }))} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-gray-700">Match:</span>
                      <button onClick={() => setRuleForm(f => ({ ...f, match_all: true }))} className={`text-xs px-3 py-1 rounded-full border transition ${ruleForm.match_all ? 'bg-orange-500 text-white border-orange-500' : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'}`}>All conditions</button>
                      <button onClick={() => setRuleForm(f => ({ ...f, match_all: false }))} className={`text-xs px-3 py-1 rounded-full border transition ${!ruleForm.match_all ? 'bg-orange-500 text-white border-orange-500' : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'}`}>Any condition</button>
                    </div>
                    <div className="space-y-2">
                      <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Conditions</p>
                      {ruleForm.conditions.map((cond, i) => (
                        <div key={i} className="flex items-center gap-2">
                          <select value={cond.field} onChange={e => setRuleForm(f => ({ ...f, conditions: f.conditions.map((c, j) => j === i ? { ...c, field: e.target.value } : c) }))} className="text-xs border border-gray-300 rounded px-2 py-1.5">
                            <option value="from">From</option><option value="subject">Subject</option><option value="to">To</option>
                          </select>
                          <select value={cond.op} onChange={e => setRuleForm(f => ({ ...f, conditions: f.conditions.map((c, j) => j === i ? { ...c, op: e.target.value } : c) }))} className="text-xs border border-gray-300 rounded px-2 py-1.5">
                            <option value="contains">contains</option><option value="equals">equals</option><option value="starts_with">starts with</option>
                          </select>
                          <input type="text" placeholder="value" value={cond.value} onChange={e => setRuleForm(f => ({ ...f, conditions: f.conditions.map((c, j) => j === i ? { ...c, value: e.target.value } : c) }))} className="flex-1 text-xs border border-gray-300 rounded px-2 py-1.5" />
                          <button onClick={() => setRuleForm(f => ({ ...f, conditions: f.conditions.filter((_, j) => j !== i) }))} className="text-red-400 hover:text-red-600 text-sm px-1">&times;</button>
                        </div>
                      ))}
                      <button onClick={() => setRuleForm(f => ({ ...f, conditions: [...f.conditions, { field: 'from', op: 'contains', value: '' }] }))} className="text-xs text-orange-600 hover:underline">+ Add condition</button>
                    </div>
                    <div className="space-y-2">
                      <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Actions</p>
                      {ruleForm.actions.map((action, i) => (
                        <div key={i} className="flex items-center gap-2">
                          <select value={action.type} onChange={e => setRuleForm(f => ({ ...f, actions: f.actions.map((a, j) => j === i ? { ...a, type: e.target.value } : a) }))} className="text-xs border border-gray-300 rounded px-2 py-1.5">
                            <option value="label">Apply label</option><option value="star">Star</option><option value="mark_read">Mark read</option><option value="move">Move to folder</option>
                          </select>
                          {(action.type === 'label' || action.type === 'move') && (
                            <input type="text" placeholder={action.type === 'label' ? 'Label name' : 'Folder name'} value={action.value} onChange={e => setRuleForm(f => ({ ...f, actions: f.actions.map((a, j) => j === i ? { ...a, value: e.target.value } : a) }))} className="flex-1 text-xs border border-gray-300 rounded px-2 py-1.5" />
                          )}
                          <button onClick={() => setRuleForm(f => ({ ...f, actions: f.actions.filter((_, j) => j !== i) }))} className="text-red-400 hover:text-red-600 text-sm px-1">&times;</button>
                        </div>
                      ))}
                      <button onClick={() => setRuleForm(f => ({ ...f, actions: [...f.actions, { type: 'label', value: '' }] }))} className="text-xs text-orange-600 hover:underline">+ Add action</button>
                    </div>
                    <div className="flex gap-2 pt-2">
                      <button onClick={saveRule} className="flex-1 bg-orange-500 hover:bg-orange-600 text-white font-semibold py-2 rounded-lg transition text-sm">{editingRuleId ? 'Update Rule' : '+ Create Rule'}</button>
                      {editingRuleId && <button onClick={() => { setEditingRuleId(null); setRuleForm({ name: '', match_all: true, conditions: [{ field: 'from', op: 'contains', value: '' }], actions: [{ type: 'label', value: '' }] }) }} className="px-4 py-2 bg-gray-200 hover:bg-gray-300 rounded-lg text-sm">Cancel</button>}
                    </div>
                  </div>
                </div>
                {/* Existing rules */}
                {rules.length === 0 ? (
                  <p className="text-gray-400 text-sm italic">No rules yet.</p>
                ) : (
                  <div className="space-y-2">
                    {rules.map(r => (
                      <div key={r.id} className="border border-gray-200 rounded-xl p-3 flex items-center gap-3">
                        <button onClick={() => toggleRule(r)} title={r.is_active ? 'Disable' : 'Enable'} className={`w-10 h-5 rounded-full transition flex-shrink-0 ${r.is_active ? 'bg-green-500' : 'bg-gray-300'}`}>
                          <span className={`block w-4 h-4 rounded-full bg-white shadow transition-transform mx-0.5 ${r.is_active ? 'translate-x-5' : 'translate-x-0'}`} />
                        </button>
                        <div className="flex-1 min-w-0">
                          <p className="font-semibold text-sm text-gray-800">{r.name}</p>
                          <p className="text-xs text-gray-500 truncate">{r.conditions.length} condition(s) &rarr; {r.actions.length} action(s)</p>
                        </div>
                        <button onClick={() => { setEditingRuleId(r.id); setRuleForm({ name: r.name, match_all: r.match_all, conditions: r.conditions, actions: r.actions.map(a => ({ type: a.type, value: a.value || '' })) }) }} className="text-xs bg-amber-100 text-amber-700 hover:bg-amber-200 px-2.5 py-1 rounded-lg">Edit</button>
                        <button onClick={() => deleteRule(r.id)} className="text-xs bg-red-100 text-red-700 hover:bg-red-200 px-2.5 py-1 rounded-lg">Delete</button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* === SNOOZE PICKER POPOVER === */}
        {showSnoozeMenu && snoozeEmailId && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => { setShowSnoozeMenu(false); setSnoozeEmailId(null) }} />
            <div className="fixed bottom-20 left-1/2 -translate-x-1/2 z-50 bg-white rounded-xl shadow-2xl border border-gray-200 p-4 w-72">
              <p className="text-sm font-semibold text-gray-700 mb-3">&#9201; Snooze until&hellip;</p>
              <div className="space-y-2">
                {getSnoozeOptions().map(opt => (
                  <button key={opt.label} onClick={() => handleSnooze(snoozeEmailId, opt.date)} className="w-full text-left text-sm px-3 py-2 rounded-lg bg-gray-50 hover:bg-blue-50 hover:text-blue-700 transition flex items-center justify-between">
                    <span>{opt.label}</span>
                    <span className="text-xs text-gray-400">{opt.date.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                  </button>
                ))}
              </div>
            </div>
          </>
        )}
      </div>

      {/* ===== AUTO-REPLY SETTINGS MODAL ===== */}
      {showRequestModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60] p-4 animate-in fade-in duration-200">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden animate-in zoom-in-95 duration-200">
            <div className="bg-blue-600 px-6 py-4 flex items-center justify-between text-white">
              <h3 className="font-bold">Request Additional Account</h3>
              <button onClick={() => setShowRequestModal(false)} className="hover:bg-white/20 rounded-full w-8 h-8 flex items-center justify-center transition">✕</button>
            </div>
            <div className="p-6">
              {requestStatus === 'sent' ? (
                <div className="text-center py-4">
                  <div className="text-4xl mb-3">✅</div>
                  <p className="text-green-700 font-semibold mb-2">Request submitted!</p>
                  <p className="text-gray-600 text-sm mb-6">{requestResponse}</p>
                  <button onClick={() => setShowRequestModal(false)} className="bg-blue-600 hover:bg-blue-700 text-white font-semibold px-8 py-2 rounded-lg transition shadow-md">Close</button>
                </div>
              ) : (
                <form onSubmit={handleRequest} className="space-y-4">
                  <p className="text-sm text-gray-500 mb-2">
                    Request the administrator to configure an additional email account for you.
                  </p>
                  <div>
                    <label className="block text-xs font-bold text-gray-400 uppercase tracking-wider mb-1.5 ml-1">Message to Admin (optional)</label>
                    <textarea
                      autoFocus
                      value={requestMessage}
                      onChange={(e) => setRequestMessage(e.target.value)}
                      rows={3}
                      placeholder="e.g. I need access to support@company.com..."
                      className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm resize-none shadow-sm placeholder:text-gray-300"
                    />
                  </div>
                  {requestStatus === 'error' && <p className="text-red-500 text-xs font-medium bg-red-50 p-3 rounded-lg border border-red-100">{requestError}</p>}
                  <div className="flex justify-end gap-3 pt-2">
                    <button type="button" onClick={() => setShowRequestModal(false)} className="px-5 py-2 text-sm font-semibold text-gray-500 hover:text-gray-700 transition">Cancel</button>
                    <button
                      type="submit"
                      disabled={requestStatus === 'sending'}
                      className="bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white font-semibold px-6 py-2.5 rounded-xl transition shadow-lg flex items-center gap-2"
                    >
                      {requestStatus === 'sending' ? (
                        <>
                          <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                          </svg>
                          Sending...
                        </>
                      ) : 'Submit Request'}
                    </button>
                  </div>
                </form>
              )}
            </div>
          </div>
        </div>
      )}

      {showAutoReplyModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl w-full max-w-xl mx-4 shadow-2xl flex flex-col max-h-[90vh]">
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
              <div>
                <h2 className="text-xl font-bold text-gray-900">🤖 Auto-Reply Settings</h2>
                <p className="text-xs text-gray-500 mt-0.5">Automatically reply to incoming emails</p>
              </div>
              <button onClick={() => setShowAutoReplyModal(false)} className="w-8 h-8 rounded-full flex items-center justify-center text-gray-500 hover:bg-gray-100 text-lg">&times;</button>
            </div>

            {/* Body */}
            <div className="overflow-y-auto flex-1 p-6 space-y-5">

              {/* Enable toggle */}
              <div className="flex items-center justify-between p-4 bg-gray-50 rounded-xl border border-gray-200">
                <div>
                  <p className="font-semibold text-gray-800">Enable Auto-Reply</p>
                  <p className="text-xs text-gray-500 mt-0.5">
                    {autoReplyConfig.is_enabled ? '✅ Active — replies will be sent automatically' : 'Disabled — no automatic replies'}
                  </p>
                </div>
                <button
                  onClick={() => setAutoReplyConfig(c => ({ ...c, is_enabled: !c.is_enabled }))}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${autoReplyConfig.is_enabled ? 'bg-purple-600' : 'bg-gray-300'
                    }`}
                >
                  <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${autoReplyConfig.is_enabled ? 'translate-x-6' : 'translate-x-1'
                    }`} />
                </button>
              </div>

              {/* Mode selector */}
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">Reply Mode</label>
                <div className="grid grid-cols-2 gap-3">
                  {(['fixed', 'ai'] as const).map(m => (
                    <button
                      key={m}
                      onClick={() => setAutoReplyConfig(c => ({ ...c, mode: m }))}
                      className={`p-3 rounded-xl border-2 text-left transition ${autoReplyConfig.mode === m
                        ? 'border-purple-500 bg-purple-50'
                        : 'border-gray-200 hover:border-gray-300'
                        }`}
                    >
                      <p className="font-semibold text-sm">{m === 'fixed' ? '📝 Fixed Reply' : '🧠 AI-Powered Reply'}</p>
                      <p className="text-xs text-gray-500 mt-0.5">
                        {m === 'fixed' ? 'Always send the same canned message' : 'AI drafts a context-aware reply'}
                      </p>
                    </button>
                  ))}
                </div>
              </div>

              {/* Subject prefix */}
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">Subject Prefix</label>
                <input
                  type="text"
                  value={autoReplyConfig.subject_prefix}
                  onChange={e => setAutoReplyConfig(c => ({ ...c, subject_prefix: e.target.value }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-purple-400"
                  placeholder="Re: "
                />
              </div>

              {/* Fixed mode body */}
              {autoReplyConfig.mode === 'fixed' && (
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">Auto-Reply Message</label>
                  <textarea
                    value={autoReplyConfig.reply_body}
                    onChange={e => setAutoReplyConfig(c => ({ ...c, reply_body: e.target.value }))}
                    rows={5}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-purple-400 resize-none"
                    placeholder="Thank you for your email. I am currently out of office and will respond as soon as possible."
                  />
                  <p className="text-xs text-gray-400 mt-1">Plain text or simple HTML. This exact text will be sent.</p>
                </div>
              )}

              {/* AI mode prompt */}
              {autoReplyConfig.mode === 'ai' && (
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">AI System Prompt</label>
                  <textarea
                    value={autoReplyConfig.ai_system_prompt}
                    onChange={e => setAutoReplyConfig(c => ({ ...c, ai_system_prompt: e.target.value }))}
                    rows={5}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-purple-400 resize-none"
                    placeholder="You are a helpful customer support agent. Reply professionally to this email, acknowledge the sender's concern, and let them know the team will follow up within 24 hours."
                  />
                  <p className="text-xs text-gray-400 mt-1">
                    ⚠️ Requires <code className="bg-gray-100 px-1 rounded">GROQ_API_KEY</code> set in your backend .env file.
                  </p>
                </div>
              )}

              {/* Skip sender list */}
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">Skip Auto-Reply For</label>
                <input
                  type="text"
                  value={autoReplyConfig.skip_if_from}
                  onChange={e => setAutoReplyConfig(c => ({ ...c, skip_if_from: e.target.value }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-purple-400"
                  placeholder="noreply@example.com, @mailchimp.com, newsletter@..."
                />
                <p className="text-xs text-gray-400 mt-1">Comma-separated. Use @domain.com to skip entire domains.</p>
              </div>

            </div>

            {/* Footer */}
            <div className="flex items-center justify-between px-6 py-4 border-t border-gray-200 bg-gray-50 rounded-b-xl flex-shrink-0">
              <button
                disabled={autoReplyTestStatus === 'sending' || !autoReplyConfig.is_enabled}
                onClick={async () => {
                  setAutoReplyTestStatus('sending')
                  try {
                    const token = localStorage.getItem('access_token')
                    const r = await fetch(`${API_URL || 'http://localhost:8000'}/email/auto-reply/test`, {
                      method: 'POST',
                      headers: { Authorization: `Bearer ${token}` }
                    })
                    setAutoReplyTestStatus(r.ok ? 'sent' : 'error')
                  } catch { setAutoReplyTestStatus('error') }
                  setTimeout(() => setAutoReplyTestStatus('idle'), 3000)
                }}
                className="text-sm px-4 py-2 rounded-lg border border-purple-200 text-purple-700 hover:bg-purple-50 disabled:opacity-40 transition"
              >
                {autoReplyTestStatus === 'sending' ? 'Sending test…' : autoReplyTestStatus === 'sent' ? '✅ Test sent!' : autoReplyTestStatus === 'error' ? '❌ Failed' : '🧪 Send Test'}
              </button>

              <div className="flex gap-2">
                <button onClick={() => setShowAutoReplyModal(false)} className="px-4 py-2 text-sm text-gray-600 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition">
                  Cancel
                </button>
                <button
                  disabled={autoReplySaving}
                  onClick={async () => {
                    setAutoReplySaving(true)
                    try {
                      const token = localStorage.getItem('access_token')
                      await fetch(`${API_URL || 'http://localhost:8000'}/email/auto-reply`, {
                        method: 'POST',
                        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
                        body: JSON.stringify(autoReplyConfig)
                      })
                      setShowAutoReplyModal(false)
                    } catch { /* ignore */ }
                    setAutoReplySaving(false)
                  }}
                  className="px-4 py-2 text-sm font-semibold text-white bg-purple-600 rounded-lg hover:bg-purple-700 disabled:opacity-50 transition"
                >
                  {autoReplySaving ? 'Saving…' : 'Save Settings'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ====== TEMPLATES / CANNED RESPONSES MODAL ====== */}
      {showTemplatesModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl flex flex-col max-h-[90vh]">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 flex-shrink-0">
              <h2 className="text-lg font-bold text-gray-900">📄 Email Templates</h2>
              <button onClick={() => { setShowTemplatesModal(false); setEditingTemplateId(null); setTemplateForm({ name: '', subject: '', body: '' }) }} className="text-gray-400 hover:text-gray-700 text-2xl leading-none">&times;</button>
            </div>
            <div className="flex flex-1 min-h-0 overflow-hidden">
              <div className="w-48 flex-shrink-0 border-r border-gray-100 overflow-y-auto py-2">
                {templates.length === 0 ? (
                  <p className="text-xs text-gray-400 px-4 py-6 text-center">No templates yet. Create one →</p>
                ) : templates.map(t => (
                  <div key={t.id} className={`group flex items-center gap-1 px-3 py-2 cursor-pointer transition rounded-lg mx-1 ${editingTemplateId === t.id ? 'bg-teal-50 border border-teal-200' : 'hover:bg-gray-50'}`}
                    onClick={() => { setEditingTemplateId(t.id); setTemplateForm({ name: t.name, subject: t.subject || '', body: t.body }) }}>
                    <span className="flex-1 text-xs font-medium text-gray-700 truncate">{t.name}</span>
                    <button onClick={(e) => { e.stopPropagation(); deleteTemplate(t.id) }} className="opacity-0 group-hover:opacity-100 text-red-400 hover:text-red-600 text-xs px-1 transition">✕</button>
                  </div>
                ))}
                <button onClick={() => { setEditingTemplateId(null); setTemplateForm({ name: '', subject: '', body: '' }) }}
                  className="w-full text-left text-xs text-teal-600 hover:bg-teal-50 px-4 py-2 mt-1 font-semibold transition">+ New Template</button>
              </div>
              <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">Template Name *</label>
                  <input type="text" value={templateForm.name} onChange={e => setTemplateForm(p => ({ ...p, name: e.target.value }))}
                    placeholder="e.g. Greeting, Follow-up, Refund Policy…"
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">Subject <span className="font-normal text-gray-400">(optional)</span></label>
                  <input type="text" value={templateForm.subject} onChange={e => setTemplateForm(p => ({ ...p, subject: e.target.value }))}
                    placeholder="e.g. Re: Your recent inquiry"
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">Body *</label>
                  <textarea value={templateForm.body} onChange={e => setTemplateForm(p => ({ ...p, body: e.target.value }))}
                    rows={8} placeholder="Template content (HTML or plain text)…"
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400 resize-y font-mono" />
                </div>
                <div className="flex items-center gap-2 pt-1">
                  <button onClick={saveTemplate} className="bg-teal-600 hover:bg-teal-700 text-white text-sm font-semibold px-5 py-2 rounded-lg transition">
                    {editingTemplateId ? 'Update' : 'Create'} Template
                  </button>
                  {editingTemplateId && (
                    <>
                      <button onClick={() => {
                        const t = templates.find(x => x.id === editingTemplateId)
                        if (t) { insertTemplate(t); setShowTemplatesModal(false) }
                      }} className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold px-4 py-2 rounded-lg transition">
                        ↩ Insert into Compose
                      </button>
                      <button onClick={() => { setEditingTemplateId(null); setTemplateForm({ name: '', subject: '', body: '' }) }}
                        className="text-sm text-gray-500 hover:text-gray-700 px-3 py-2 transition">Cancel</button>
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ====== EMAIL RULES / FILTERS MODAL ====== */}
      {showRulesModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl flex flex-col max-h-[90vh]">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 flex-shrink-0">
              <h2 className="text-lg font-bold text-gray-900">⚙️ Email Rules &amp; Filters</h2>
              <button onClick={() => { setShowRulesModal(false); setEditingRuleId(null); setRuleForm({ name: '', match_all: true, conditions: [{ field: 'from', op: 'contains', value: '' }], actions: [{ type: 'label', value: '' }] }) }}
                className="text-gray-400 hover:text-gray-700 text-2xl leading-none">&times;</button>
            </div>
            <div className="flex flex-1 min-h-0 overflow-hidden">
              <div className="w-48 flex-shrink-0 border-r border-gray-100 overflow-y-auto py-2">
                {rules.length === 0 ? (
                  <p className="text-xs text-gray-400 px-4 py-6 text-center">No rules yet. Create one →</p>
                ) : rules.map(r => (
                  <div key={r.id} className={`group flex items-center gap-1 px-3 py-2 cursor-pointer transition rounded-lg mx-1 ${editingRuleId === r.id ? 'bg-orange-50 border border-orange-200' : 'hover:bg-gray-50'}`}
                    onClick={() => { setEditingRuleId(r.id); setRuleForm({ name: r.name, match_all: r.match_all, conditions: r.conditions, actions: r.actions }) }}>
                    <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${r.is_active ? 'bg-green-500' : 'bg-gray-300'}`} />
                    <span className="flex-1 text-xs font-medium text-gray-700 truncate">{r.name}</span>
                    <div className="opacity-0 group-hover:opacity-100 flex gap-0.5">
                      <button onClick={(e) => { e.stopPropagation(); toggleRule(r) }} className="text-gray-400 hover:text-green-600 text-xs px-0.5 transition" title={r.is_active ? 'Disable' : 'Enable'}>{r.is_active ? '⏸' : '▶'}</button>
                      <button onClick={(e) => { e.stopPropagation(); deleteRule(r.id) }} className="text-red-400 hover:text-red-600 text-xs px-0.5 transition">✕</button>
                    </div>
                  </div>
                ))}
                <button onClick={() => { setEditingRuleId(null); setRuleForm({ name: '', match_all: true, conditions: [{ field: 'from', op: 'contains', value: '' }], actions: [{ type: 'label', value: '' }] }) }}
                  className="w-full text-left text-xs text-orange-600 hover:bg-orange-50 px-4 py-2 mt-1 font-semibold transition">+ New Rule</button>
              </div>
              <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">Rule Name *</label>
                  <input type="text" value={ruleForm.name} onChange={e => setRuleForm(p => ({ ...p, name: e.target.value }))}
                    placeholder="e.g. Label newsletters, Auto-trash promotions…"
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400" />
                </div>
                <div>
                  <div className="flex items-center gap-3 mb-2">
                    <label className="text-xs font-semibold text-gray-600">Conditions</label>
                    <div className="flex items-center gap-1 text-xs">
                      <span className="text-gray-400">Match</span>
                      <button onClick={() => setRuleForm(p => ({ ...p, match_all: true }))} className={`px-2 py-0.5 rounded transition ${ruleForm.match_all ? 'bg-orange-500 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>All</button>
                      <button onClick={() => setRuleForm(p => ({ ...p, match_all: false }))} className={`px-2 py-0.5 rounded transition ${!ruleForm.match_all ? 'bg-orange-500 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>Any</button>
                    </div>
                  </div>
                  <div className="space-y-2">
                    {ruleForm.conditions.map((cond, idx) => (
                      <div key={idx} className="flex items-center gap-2">
                        <select value={cond.field} onChange={e => setRuleForm(p => ({ ...p, conditions: p.conditions.map((c, i) => i === idx ? { ...c, field: e.target.value } : c) }))}
                          className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-orange-400">
                          <option value="from">From</option>
                          <option value="to">To</option>
                          <option value="subject">Subject</option>
                          <option value="body">Body</option>
                        </select>
                        <select value={cond.op} onChange={e => setRuleForm(p => ({ ...p, conditions: p.conditions.map((c, i) => i === idx ? { ...c, op: e.target.value } : c) }))}
                          className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-orange-400">
                          <option value="contains">contains</option>
                          <option value="equals">equals</option>
                          <option value="starts_with">starts with</option>
                        </select>
                        <input type="text" value={cond.value} onChange={e => setRuleForm(p => ({ ...p, conditions: p.conditions.map((c, i) => i === idx ? { ...c, value: e.target.value } : c) }))}
                          placeholder="value…" className="flex-1 border border-gray-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-orange-400" />
                        {ruleForm.conditions.length > 1 && (
                          <button onClick={() => setRuleForm(p => ({ ...p, conditions: p.conditions.filter((_, i) => i !== idx) }))} className="text-red-400 hover:text-red-600 text-xs transition">✕</button>
                        )}
                      </div>
                    ))}
                  </div>
                  <button onClick={() => setRuleForm(p => ({ ...p, conditions: [...p.conditions, { field: 'from', op: 'contains', value: '' }] }))}
                    className="text-xs text-orange-600 hover:underline mt-1.5 font-semibold">+ Add condition</button>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-2">Actions</label>
                  <div className="space-y-2">
                    {ruleForm.actions.map((action, idx) => (
                      <div key={idx} className="flex items-center gap-2">
                        <select value={action.type} onChange={e => setRuleForm(p => ({ ...p, actions: p.actions.map((a, i) => i === idx ? { ...a, type: e.target.value, value: '' } : a) }))}
                          className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-orange-400">
                          <option value="label">Apply label</option>
                          <option value="star">Star it</option>
                          <option value="mark_read">Mark as read</option>
                          <option value="move">Move to trash</option>
                        </select>
                        {action.type === 'label' && (
                          <input type="text" value={action.value} onChange={e => setRuleForm(p => ({ ...p, actions: p.actions.map((a, i) => i === idx ? { ...a, value: e.target.value } : a) }))}
                            placeholder="label name…" className="flex-1 border border-gray-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-orange-400" />
                        )}
                        {ruleForm.actions.length > 1 && (
                          <button onClick={() => setRuleForm(p => ({ ...p, actions: p.actions.filter((_, i) => i !== idx) }))} className="text-red-400 hover:text-red-600 text-xs transition">✕</button>
                        )}
                      </div>
                    ))}
                  </div>
                  <button onClick={() => setRuleForm(p => ({ ...p, actions: [...p.actions, { type: 'label', value: '' }] }))}
                    className="text-xs text-orange-600 hover:underline mt-1.5 font-semibold">+ Add action</button>
                </div>
                <div className="flex items-center gap-2 pt-1">
                  <button onClick={saveRule} className="bg-orange-600 hover:bg-orange-700 text-white text-sm font-semibold px-5 py-2 rounded-lg transition">
                    {editingRuleId ? 'Update Rule' : 'Create Rule'}
                  </button>
                  {editingRuleId && (
                    <button onClick={() => { setEditingRuleId(null); setRuleForm({ name: '', match_all: true, conditions: [{ field: 'from', op: 'contains', value: '' }], actions: [{ type: 'label', value: '' }] }) }}
                      className="text-sm text-gray-500 hover:text-gray-700 px-3 py-2 transition">Cancel</button>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

    </div>
  )
}
