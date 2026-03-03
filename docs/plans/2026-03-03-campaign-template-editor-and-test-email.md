# Campaign Template Inline Editor + Send Test Email — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Allow staff to click directly on text in a rich email template to edit it (preserving all CSS), and add a "Send Test Email" button so staff can preview the campaign in a real inbox before sending.

**Architecture:** `EmailEditor` detects full-HTML content (`<!DOCTYPE`/`<html`) and renders a contenteditable iframe instead of Tiptap. A `SendTestEmailPopover` component calls a new backend endpoint that sends the current HTML to a specified address using the existing SMTP config.

**Tech Stack:** Next.js 14 App Router, React, TailwindCSS (frontend); FastAPI, smtplib, SQLAlchemy (backend). No test framework — verify via Swagger UI at `http://localhost:8000/docs` and browser.

---

## Context: No Test Framework

This project has no pytest or Jest. Each task ends with **manual verification steps** instead of automated test runs. Use Swagger at `http://localhost:8000/docs` for backend endpoint testing.

---

## Task 1: Backend — `POST /campaigns/send-test` endpoint

**Files:**
- Modify: `backend/app/routes/campaigns.py`

### Step 1: Add the endpoint after the `preview-audience` route (line ~231)

Open `backend/app/routes/campaigns.py`. After the `preview_audience` endpoint (~line 231), add:

```python
# ===== SEND TEST EMAIL =====

class TestEmailPayload(BaseModel):
    subject: str
    body_html: str
    to_email: str

@router.post("/send-test")
def send_test_email(
    payload: TestEmailPayload,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Send the current campaign HTML to a test address (no tracking, no merge-tag replacement)."""
    from app.services.branding_service import branding_service
    import smtplib
    from email.mime.multipart import MIMEMultipart
    from email.mime.text import MIMEText

    smtp_config = branding_service.get_smtp_config(db)

    if not smtp_config.get("smtp_password"):
        raise HTTPException(
            status_code=400,
            detail="SMTP not configured. Go to Admin → Branding to set it up.",
        )

    try:
        msg = MIMEMultipart("alternative")
        msg["Subject"] = f"[TEST] {payload.subject}"
        msg["From"] = smtp_config.get("smtp_from_email", "no-reply@example.com")
        msg["To"] = payload.to_email
        msg.attach(MIMEText(payload.body_html, "html"))

        with smtplib.SMTP(smtp_config["smtp_server"], smtp_config["smtp_port"]) as server:
            if smtp_config.get("smtp_use_tls", True):
                server.starttls()
            server.login(smtp_config["smtp_username"], smtp_config["smtp_password"])
            server.sendmail(smtp_config["smtp_from_email"], payload.to_email, msg.as_string())

        return {"ok": True}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"SMTP error: {str(e)}")
```

Also add the `BaseModel` import at the top of the file if not already present:
```python
from pydantic import BaseModel
```

### Step 2: Verify — restart backend and test via Swagger

```bash
cd backend && source venv/bin/activate && uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

Open `http://localhost:8000/docs`, find `POST /campaigns/send-test`, click **Try it out**, send:
```json
{
  "subject": "Test Subject",
  "body_html": "<p>Hello test</p>",
  "to_email": "your@email.com"
}
```
Expected: `{"ok": true}` and email in inbox. If SMTP not configured: `400` with helpful message.

### Step 3: Commit

```bash
git add backend/app/routes/campaigns.py
git commit -m "feat: add POST /campaigns/send-test endpoint"
```

---

## Task 2: Frontend — `TemplateIframeEditor` component

This is a new standalone component that handles the contenteditable iframe edit mode. Keep it separate from `EmailEditor` for clarity.

**Files:**
- Create: `frontend/components/TemplateIframeEditor.tsx`

### Step 1: Create the file

```tsx
'use client'

import { useEffect, useRef, useState } from 'react'

interface Props {
  content: string          // full HTML string starting with <!DOCTYPE or <html
  onChange: (html: string) => void
  onSwitchToBasic: () => void
}

export default function TemplateIframeEditor({ content, onChange, onSwitchToBasic }: Props) {
  const iframeRef = useRef<HTMLIFrameElement>(null)
  // Use a key to force iframe remount when a new template is selected
  const [iframeKey, setIframeKey] = useState(0)
  const [iframeContent, setIframeContent] = useState(content)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // When parent content changes (new template selected), remount the iframe
  useEffect(() => {
    setIframeContent(content)
    setIframeKey(k => k + 1)
  }, [content])

  const handleLoad = () => {
    const iframe = iframeRef.current
    if (!iframe) return
    const doc = iframe.contentWindow?.document
    if (!doc) return

    // Make body editable
    doc.body.contentEditable = 'true'
    doc.body.spellcheck = false

    // Prevent links from navigating
    doc.querySelectorAll('a').forEach(a => {
      a.addEventListener('click', e => e.preventDefault())
    })

    // Image click → prompt for new URL
    doc.querySelectorAll('img').forEach(img => {
      img.style.cursor = 'pointer'
      img.addEventListener('click', e => {
        e.stopPropagation()
        const url = window.prompt('New image URL:', img.src)
        if (url && url.trim()) {
          img.src = url.trim()
          fireChange(doc)
        }
      })
    })

    // Listen for text edits
    doc.addEventListener('input', () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
      debounceRef.current = setTimeout(() => fireChange(doc), 400)
    })
  }

  const fireChange = (doc: Document) => {
    const html = '<!DOCTYPE html>\n' + doc.documentElement.outerHTML
    onChange(html)
  }

  const handleSwitchToBasic = () => {
    const ok = window.confirm(
      'Switching to the basic editor may remove complex styles (gradients, backgrounds) from this template. Continue?'
    )
    if (ok) onSwitchToBasic()
  }

  return (
    <div className="border border-gray-300 rounded-lg overflow-hidden focus-within:ring-2 focus-within:ring-blue-500">
      {/* Info bar */}
      <div className="flex items-center justify-between px-3 py-2 bg-amber-50 border-b border-amber-200">
        <span className="text-xs text-amber-700 font-medium">
          ✏️ Click any text to edit · Click images to replace · Colours and layout are preserved
        </span>
        <button
          type="button"
          onClick={handleSwitchToBasic}
          className="text-xs text-gray-500 hover:text-gray-700 underline ml-4 flex-shrink-0"
        >
          Switch to basic editor
        </button>
      </div>

      {/* Contenteditable iframe */}
      <iframe
        key={iframeKey}
        ref={iframeRef}
        srcDoc={iframeContent}
        onLoad={handleLoad}
        className="w-full border-none bg-white"
        style={{ minHeight: '520px', height: '600px' }}
        title="Email template editor"
      />
    </div>
  )
}
```

### Step 2: Manual verify in browser

Temporarily add this to any page to test the component in isolation:
```tsx
<TemplateIframeEditor
  content={`<!DOCTYPE html><html><body style="background:#f4f4f5;padding:20px;">
    <h1 style="color:#4f46e5;">Click me to edit</h1>
    <p style="background:linear-gradient(135deg,#667eea,#764ba2);color:white;padding:20px;">
      Gradient text block
    </p>
    <img src="https://via.placeholder.com/300x100" />
    <a href="https://example.com">Link that should not navigate</a>
  </body></html>`}
  onChange={html => console.log('changed:', html.slice(0, 100))}
  onSwitchToBasic={() => alert('switch')}
/>
```
Verify:
- Clicking the `<h1>` puts cursor there and allows typing
- Gradient background is preserved
- Clicking the `<img>` shows a URL prompt
- Clicking the link does NOT navigate
- `onChange` fires ~400ms after typing (check console)

### Step 3: Commit

```bash
git add frontend/components/TemplateIframeEditor.tsx
git commit -m "feat: add TemplateIframeEditor contenteditable iframe component"
```

---

## Task 3: Frontend — Wire `TemplateIframeEditor` into `EmailEditor`

`EmailEditor` needs to detect full-HTML content and delegate to `TemplateIframeEditor` instead of Tiptap.

**Files:**
- Modify: `frontend/components/EmailEditor.tsx`

### Step 1: Add the helper + mode state + import

At the top of `EmailEditor.tsx`, add the import:
```tsx
import TemplateIframeEditor from './TemplateIframeEditor'
```

Add a helper function (outside the component, below the `FONTS` constant):
```tsx
function isFullHtml(html: string): boolean {
  const trimmed = html.trimStart().toLowerCase()
  return trimmed.startsWith('<!doctype') || trimmed.startsWith('<html')
}
```

### Step 2: Add mode state inside the component

Inside `export default function EmailEditor(...)`, add after the existing `useState` lines:
```tsx
const [mode, setMode] = useState<'rich' | 'template'>(() =>
  isFullHtml(content) ? 'template' : 'rich'
)
```

### Step 3: Update the content effect to also update mode

The existing `useEffect` that syncs `content` → Tiptap editor (around line 76) already handles Tiptap. Add a second effect below it:
```tsx
// Sync mode when parent picks a new template
useEffect(() => {
  if (isFullHtml(content)) {
    setMode('template')
  }
}, [content])
```

### Step 4: Add the conditional render

Find the `return (` at the start of the JSX (after `if (!editor) return null`). Wrap the entire return with a conditional:

```tsx
// Template mode: contenteditable iframe
if (mode === 'template') {
  return (
    <TemplateIframeEditor
      content={content}
      onChange={onChange}
      onSwitchToBasic={() => setMode('rich')}
    />
  )
}
```

Place this block **before** the existing `return (` that renders the Tiptap toolbar + editor. The final structure looks like:

```tsx
if (!editor) return null

// Template mode: contenteditable iframe
if (mode === 'template') {
  return (
    <TemplateIframeEditor
      content={content}
      onChange={onChange}
      onSwitchToBasic={() => setMode('rich')}
    />
  )
}

// Rich mode: Tiptap editor
return (
  <>
    ...existing Tiptap JSX...
  </>
)
```

### Step 5: Manual verify

- Go to `/admin/campaigns/new`
- Click "Choose Template" → select a preset (e.g. "Promotional / Offer")
- The editor should show the amber info bar + the full rendered template in the iframe
- Click on "Exclusive Deal" text → should get a cursor, be editable
- Type something → the text changes in the preview
- Click on the gradient button → type a new label
- Save the campaign → the edited HTML should be saved (check in edit page)

### Step 6: Commit

```bash
git add frontend/components/EmailEditor.tsx
git commit -m "feat: switch EmailEditor to TemplateIframeEditor for full-HTML templates"
```

---

## Task 4: Frontend — `SendTestEmailPopover` component

**Files:**
- Create: `frontend/components/SendTestEmailPopover.tsx`

### Step 1: Create the file

```tsx
'use client'

import { useState, useRef, useEffect } from 'react'
import axios from 'axios'
import { getAuthToken, authAPI } from '@/lib/auth'
import { API_URL } from '@/lib/config'

interface Props {
  subject: string
  bodyHtml: string
}

export default function SendTestEmailPopover({ subject, bodyHtml }: Props) {
  const user = authAPI.getUser()
  const [open, setOpen] = useState(false)
  const [toEmail, setToEmail] = useState(user?.email || '')
  const [status, setStatus] = useState<'idle' | 'sending' | 'success' | 'error'>('idle')
  const [errorMsg, setErrorMsg] = useState('')
  const popoverRef = useRef<HTMLDivElement>(null)

  // Close on outside click
  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setOpen(false)
        setStatus('idle')
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  // Auto-close after success
  useEffect(() => {
    if (status === 'success') {
      const t = setTimeout(() => {
        setOpen(false)
        setStatus('idle')
      }, 3000)
      return () => clearTimeout(t)
    }
  }, [status])

  const handleSend = async () => {
    if (!toEmail.trim()) return
    setStatus('sending')
    setErrorMsg('')
    try {
      await axios.post(
        `${API_URL}/campaigns/send-test`,
        { subject: subject || '(no subject)', body_html: bodyHtml, to_email: toEmail.trim() },
        { headers: { Authorization: `Bearer ${getAuthToken()}` } }
      )
      setStatus('success')
    } catch (err: any) {
      setErrorMsg(err.response?.data?.detail || 'Failed to send. Check SMTP settings.')
      setStatus('error')
    }
  }

  return (
    <div className="relative flex-shrink-0" ref={popoverRef}>
      <button
        type="button"
        onClick={() => { setOpen(o => !o); setStatus('idle') }}
        className="flex items-center gap-1.5 px-3 py-1.5 text-sm border border-gray-300 rounded-lg bg-white hover:bg-gray-50 text-gray-600 font-medium transition-colors"
      >
        📧 Test in Email
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-80 bg-white border border-gray-200 rounded-xl shadow-xl z-50 p-4">
          <p className="text-sm font-semibold text-gray-800 mb-3">Send Test Email</p>

          <label className="block text-xs font-medium text-gray-500 mb-1">Send to:</label>
          <input
            type="email"
            value={toEmail}
            onChange={e => setToEmail(e.target.value)}
            disabled={status === 'sending' || status === 'success'}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 mb-2 disabled:opacity-50"
            placeholder="you@example.com"
          />

          {subject && (
            <p className="text-xs text-gray-400 mb-3">
              Subject: <span className="font-medium text-gray-600">{subject}</span>
            </p>
          )}

          {status === 'error' && (
            <p className="text-xs text-red-600 mb-2">❌ {errorMsg}</p>
          )}
          {status === 'success' && (
            <p className="text-xs text-green-600 mb-2">✅ Sent! Check your inbox.</p>
          )}

          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => { setOpen(false); setStatus('idle') }}
              className="flex-1 px-3 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 text-gray-600"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSend}
              disabled={status === 'sending' || status === 'success' || !toEmail.trim()}
              className="flex-1 px-3 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 font-medium flex items-center justify-center gap-1.5"
            >
              {status === 'sending' ? (
                <><span className="animate-spin inline-block w-3 h-3 border-2 border-white border-t-transparent rounded-full" /> Sending…</>
              ) : 'Send Test →'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
```

### Step 2: Commit

```bash
git add frontend/components/SendTestEmailPopover.tsx
git commit -m "feat: add SendTestEmailPopover component"
```

---

## Task 5: Frontend — Add `SendTestEmailPopover` to both campaign pages

**Files:**
- Modify: `frontend/app/admin/campaigns/new/page.tsx`
- Modify: `frontend/app/admin/campaigns/[id]/edit/page.tsx`

### Step 1: Update `new/page.tsx`

Add the import at the top:
```tsx
import SendTestEmailPopover from '@/components/SendTestEmailPopover'
```

Find the "Email Body" label row (~line 110):
```tsx
<div className="flex items-center justify-between mb-1">
  <label className="block text-sm font-medium text-gray-600">Email Body *</label>
  <EmailTemplateGallery onSelect={html => setForm(prev => ({ ...prev, body_html: html }))} />
</div>
```

Replace with:
```tsx
<div className="flex items-center justify-between mb-1">
  <label className="block text-sm font-medium text-gray-600">Email Body *</label>
  <div className="flex items-center gap-2">
    <SendTestEmailPopover subject={form.subject} bodyHtml={form.body_html} />
    <EmailTemplateGallery onSelect={html => setForm(prev => ({ ...prev, body_html: html }))} />
  </div>
</div>
```

### Step 2: Update `[id]/edit/page.tsx` — same change

Add the import:
```tsx
import SendTestEmailPopover from '@/components/SendTestEmailPopover'
```

Find the same "Email Body" label row (~line 142) and apply the identical replacement:
```tsx
<div className="flex items-center justify-between mb-1">
  <label className="block text-sm font-medium text-gray-600">Email Body *</label>
  <div className="flex items-center gap-2">
    <SendTestEmailPopover subject={form.subject} bodyHtml={form.body_html} />
    <EmailTemplateGallery onSelect={html => setForm(prev => ({ ...prev, body_html: html }))} />
  </div>
</div>
```

### Step 3: Manual verify

- Go to `/admin/campaigns/new`
- Fill in a subject and body (or pick a template)
- Click **📧 Test in Email** button → popover appears with your email pre-filled
- Enter your email, click **Send Test →** → spinner → "✅ Sent! Check your inbox."
- Popover closes after 3 seconds
- Check inbox — email arrives with `[TEST]` prefix in subject, full HTML rendered
- If SMTP not configured → `❌ SMTP not configured. Go to Admin → Branding to set it up.`

### Step 4: Commit

```bash
git add frontend/app/admin/campaigns/new/page.tsx
git add frontend/app/admin/campaigns/[id]/edit/page.tsx
git commit -m "feat: add Send Test Email button to campaign create and edit pages"
```

---

## End-to-End Verification Checklist

- [ ] Select "Promotional / Offer" preset → template renders in iframe (gradient visible)
- [ ] Click on headline text → cursor appears, can type → gradient still there
- [ ] Click on `<img>` → URL prompt → image updates
- [ ] Click "Switch to basic editor" → confirm dialog → Tiptap loads
- [ ] Type from scratch (no template) → Tiptap loads normally (not iframe)
- [ ] "📧 Test in Email" button visible in create and edit pages
- [ ] Test email arrives with `[TEST]` subject prefix
- [ ] Merge tags like `{{first_name}}` appear literally in test email (not replaced)
- [ ] No SMTP → helpful error message shown
