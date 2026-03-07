# Clickable Phone & Email Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make phone numbers open the in-app Softphone with auto-dial, and email addresses open a floating inline compose popover with full send capabilities, across all CRM and Call Center pages.

**Architecture:** Two new React contexts (SoftphoneContext, EmailComposeContext) provide global state for the Softphone panel and compose popover. Two small wrapper components (`<ClickablePhone>`, `<ClickableEmail>`) are swapped into all display locations. Both global components mount in `layout-client.tsx`.

**Tech Stack:** Next.js 14, React Context, TailwindCSS, Tiptap, axios, existing email send API

---

## Task 1: Create SoftphoneContext

**Files:**
- Create: `frontend/lib/softphone-context.tsx`

**Step 1: Create the context file**

```tsx
// frontend/lib/softphone-context.tsx
'use client'

import { createContext, useContext, useState, useCallback, ReactNode } from 'react'

interface SoftphoneContextType {
  isOpen: boolean
  dialNumber: string | null
  dial: (number: string) => void
  close: () => void
  setDialNumber: (n: string | null) => void
}

const SoftphoneContext = createContext<SoftphoneContextType>({
  isOpen: false,
  dialNumber: null,
  dial: () => {},
  close: () => {},
  setDialNumber: () => {},
})

export function SoftphoneProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false)
  const [dialNumber, setDialNumber] = useState<string | null>(null)

  const dial = useCallback((number: string) => {
    setDialNumber(number)
    setIsOpen(true)
  }, [])

  const close = useCallback(() => {
    setIsOpen(false)
    setDialNumber(null)
  }, [])

  return (
    <SoftphoneContext.Provider value={{ isOpen, dialNumber, dial, close, setDialNumber }}>
      {children}
    </SoftphoneContext.Provider>
  )
}

export function useSoftphone() {
  return useContext(SoftphoneContext)
}
```

**Step 2: Commit**

```bash
git add frontend/lib/softphone-context.tsx
git commit -m "feat: add SoftphoneContext for global dial state management"
```

---

## Task 2: Update Softphone Component to Use Context

**Files:**
- Modify: `frontend/components/Softphone.tsx`

**Step 1: Refactor Softphone to use SoftphoneContext**

Replace the internal `isOpen` state with context-provided values. When `dialNumber` changes and is not null, auto-fill the number field and start calling.

Key changes:
- Import `useSoftphone` from `@/lib/softphone-context`
- Replace `const [isOpen, setIsOpen] = useState(false)` with `const { isOpen, dialNumber, close, setDialNumber } = useSoftphone()`
- Remove the floating toggle button (context controls open/close)
- When `dialNumber` changes (useEffect), set `number` state and auto-call after short delay
- The close button calls `close()` from context
- Keep all existing UI: dialpad, mute, hold, transfer, conference

The component signature changes from:
```tsx
export default function Softphone({ telephonySettings }: { user: any, telephonySettings: any })
```
to:
```tsx
export default function Softphone()
```

**Step 2: Commit**

```bash
git add frontend/components/Softphone.tsx
git commit -m "feat: refactor Softphone to use SoftphoneContext for dial control"
```

---

## Task 3: Create EmailComposeContext

**Files:**
- Create: `frontend/lib/email-compose-context.tsx`

**Step 1: Create the context file**

```tsx
// frontend/lib/email-compose-context.tsx
'use client'

import { createContext, useContext, useState, useCallback, ReactNode } from 'react'

interface EmailComposeContextType {
  isOpen: boolean
  prefillTo: string
  openCompose: (to?: string) => void
  closeCompose: () => void
}

const EmailComposeContext = createContext<EmailComposeContextType>({
  isOpen: false,
  prefillTo: '',
  openCompose: () => {},
  closeCompose: () => {},
})

export function EmailComposeProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false)
  const [prefillTo, setPrefillTo] = useState('')

  const openCompose = useCallback((to?: string) => {
    setPrefillTo(to || '')
    setIsOpen(true)
  }, [])

  const closeCompose = useCallback(() => {
    setIsOpen(false)
    setPrefillTo('')
  }, [])

  return (
    <EmailComposeContext.Provider value={{ isOpen, prefillTo, openCompose, closeCompose }}>
      {children}
    </EmailComposeContext.Provider>
  )
}

export function useEmailCompose() {
  return useContext(EmailComposeContext)
}
```

**Step 2: Commit**

```bash
git add frontend/lib/email-compose-context.tsx
git commit -m "feat: add EmailComposeContext for global compose popover state"
```

---

## Task 4: Create EmailComposePopover Component

**Files:**
- Create: `frontend/components/EmailComposePopover.tsx`

**Step 1: Create the floating compose popover**

This is a floating panel (fixed position, bottom-right, like Gmail compose). It provides:
- **Header bar** with "New Message" title, minimize toggle, close button (draggable optional)
- **To field** (pre-filled from context), CC/BCC toggle + fields
- **Subject field**
- **Body** — Tiptap rich text editor (import existing EmailEditor component or use simpler textarea for initial version)
- **Attachment support** — file input, chips showing filename/size, X to remove
- **Email account selector** — fetches from `GET /email/accounts`
- **Send button** — calls `POST /email/send` with `{ to_address, subject, body, cc, bcc }`

The component:
```tsx
'use client'
import { useState, useEffect, useRef } from 'react'
import { useEmailCompose } from '@/lib/email-compose-context'
import { X, Minus, Maximize2, Paperclip, Send } from 'lucide-react'
import axios from 'axios'
import { API_URL } from '@/lib/config'
import { getAuthToken } from '@/lib/auth'
```

Key behaviors:
- On mount/when `prefillTo` changes, set `to` field
- Send clears form and closes popover on success
- Show toast on success/error
- Minimize mode collapses to just the header bar
- Attachments: store as File[] in state, format size (KB/MB), include in multipart POST if backend supports it (initially just send without attachments, matching existing API)

Size: ~500px wide, ~450px tall, with resize handle or fixed

**Step 2: Commit**

```bash
git add frontend/components/EmailComposePopover.tsx
git commit -m "feat: add EmailComposePopover floating email composer"
```

---

## Task 5: Create ClickablePhone and ClickableEmail Components

**Files:**
- Create: `frontend/components/ClickablePhone.tsx`
- Create: `frontend/components/ClickableEmail.tsx`

**Step 1: Create ClickablePhone**

```tsx
// frontend/components/ClickablePhone.tsx
'use client'

import { Phone } from 'lucide-react'
import { useSoftphone } from '@/lib/softphone-context'

interface ClickablePhoneProps {
  number: string | null | undefined
  className?: string
  showIcon?: boolean
}

export default function ClickablePhone({ number, className = '', showIcon = true }: ClickablePhoneProps) {
  const { dial } = useSoftphone()

  if (!number) return <span className="text-gray-400">—</span>

  return (
    <button
      onClick={(e) => { e.stopPropagation(); dial(number) }}
      className={`inline-flex items-center gap-1 text-indigo-600 hover:text-indigo-800 hover:underline cursor-pointer transition-colors ${className}`}
      title={`Call ${number}`}
    >
      {showIcon && <Phone className="w-3 h-3" />}
      <span>{number}</span>
    </button>
  )
}
```

**Step 2: Create ClickableEmail**

```tsx
// frontend/components/ClickableEmail.tsx
'use client'

import { Mail } from 'lucide-react'
import { useEmailCompose } from '@/lib/email-compose-context'

interface ClickableEmailProps {
  email: string | null | undefined
  className?: string
  showIcon?: boolean
}

export default function ClickableEmail({ email, className = '', showIcon = true }: ClickableEmailProps) {
  const { openCompose } = useEmailCompose()

  if (!email) return <span className="text-gray-400">—</span>

  return (
    <button
      onClick={(e) => { e.stopPropagation(); openCompose(email) }}
      className={`inline-flex items-center gap-1 text-blue-600 hover:text-blue-800 hover:underline cursor-pointer transition-colors ${className}`}
      title={`Email ${email}`}
    >
      {showIcon && <Mail className="w-3 h-3" />}
      <span>{email}</span>
    </button>
  )
}
```

**Step 3: Commit**

```bash
git add frontend/components/ClickablePhone.tsx frontend/components/ClickableEmail.tsx
git commit -m "feat: add ClickablePhone and ClickableEmail wrapper components"
```

---

## Task 6: Mount Contexts and Global Components in Layout

**Files:**
- Modify: `frontend/app/layout-client.tsx`

**Step 1: Add providers and global components**

Current layout-client.tsx wraps children with BrandingProvider and EventsProvider. Add:
- Import and wrap with `SoftphoneProvider`
- Import and wrap with `EmailComposeProvider`
- Import and render `<Softphone />` after `{children}`
- Import and render `<EmailComposePopover />` after `{children}`

The render tree becomes:
```tsx
<BrandingProvider>
  <EventsProvider>
    <SoftphoneProvider>
      <EmailComposeProvider>
        <EventNotifications />
        {children}
        <Softphone />
        <EmailComposePopover />
      </EmailComposeProvider>
    </SoftphoneProvider>
  </EventsProvider>
</BrandingProvider>
```

**Step 2: Commit**

```bash
git add frontend/app/layout-client.tsx
git commit -m "feat: mount Softphone and EmailCompose contexts + components in global layout"
```

---

## Task 7: Swap Phone/Email to Clickable in LeadDetailPanel

**Files:**
- Modify: `frontend/components/LeadDetailPanel.tsx`

**Step 1: Replace plain text displays**

Find the `<Field>` components for phone and email and replace their `value` prop with the clickable wrappers:

- Line 259: `<Field label="Email" value={lead.email} />` → replace value with `<ClickableEmail email={lead.email} />`
- Line 260: `<Field label="Phone" value={lead.phone} />` → replace value with `<ClickablePhone number={lead.phone} />`

If the `<Field>` component only accepts string values, render the clickable components directly instead of using `<Field>`.

Import both components at the top of the file.

**Step 2: Commit**

```bash
git add frontend/components/LeadDetailPanel.tsx
git commit -m "feat: make phone/email clickable in LeadDetailPanel"
```

---

## Task 8: Swap Phone/Email to Clickable in ChatWindow

**Files:**
- Modify: `frontend/components/ChatWindow.tsx`

**Step 1: Replace CRM sidebar displays**

- Line 683: `{crmLead.email && <p className="text-gray-700">📧 {crmLead.email}</p>}` → replace inner content with `<ClickableEmail email={crmLead.email} />`
- Line 684: `{crmLead.phone && <p className="text-gray-700">📞 {crmLead.phone}</p>}` → replace inner content with `<ClickablePhone number={crmLead.phone} />`

Remove the emoji icons (the components have their own lucide icons).

**Step 2: Commit**

```bash
git add frontend/components/ChatWindow.tsx
git commit -m "feat: make phone/email clickable in ChatWindow CRM sidebar"
```

---

## Task 9: Swap Phone/Email to Clickable in CrmSidebar

**Files:**
- Modify: `frontend/components/CrmSidebar.tsx`

**Step 1: Replace plain text displays**

- Line 277: `{lead.email && <div className="text-xs text-gray-400 mt-1">{lead.email}</div>}` → replace with `<ClickableEmail email={lead.email} className="text-xs" />`
- Line 278: `{lead.phone && <div className="text-xs text-gray-400">{lead.phone}</div>}` → replace with `<ClickablePhone number={lead.phone} className="text-xs" />`

**Step 2: Commit**

```bash
git add frontend/components/CrmSidebar.tsx
git commit -m "feat: make phone/email clickable in CrmSidebar"
```

---

## Task 10: Swap Email to Clickable in Leads List Page

**Files:**
- Modify: `frontend/app/admin/crm/leads/page.tsx`

**Step 1: Replace email column in leads table**

- Line 374: `<td className="px-4 py-3 text-gray-500">{lead.email || "—"}</td>` → replace inner content with `<ClickableEmail email={lead.email} showIcon={false} />`

**Step 2: Commit**

```bash
git add frontend/app/admin/crm/leads/page.tsx
git commit -m "feat: make email clickable in leads list table"
```

---

## Task 11: Swap Phone/Email to Clickable in ContactManagement

**Files:**
- Modify: `frontend/components/ContactManagement.tsx`

**Step 1: Replace display elements**

Find where `contact.phone_no[0]` and `contact.email` are displayed (with Mail and Phone icons) and replace with clickable wrappers:

- Phone display: replace `{contact.phone_no?.[0] || 'N/A'}` with `<ClickablePhone number={contact.phone_no?.[0]} />`
- Email display: replace the Mail icon + text with `<ClickableEmail email={contact.email} />`

**Step 2: Commit**

```bash
git add frontend/components/ContactManagement.tsx
git commit -m "feat: make phone/email clickable in ContactManagement"
```

---

## Task 12: Swap Phone/Email to Clickable in Individuals List Page

**Files:**
- Modify: `frontend/app/admin/individuals/page.tsx`

**Step 1: Replace display elements**

- Phone: where `ind.phone_numbers[0]` is displayed with Phone icon → replace with `<ClickablePhone number={ind.phone_numbers?.[0]} />`
- Email: where `ind.email` is displayed with Mail icon → replace with `<ClickableEmail email={ind.email} />`

**Step 2: Commit**

```bash
git add frontend/app/admin/individuals/page.tsx
git commit -m "feat: make phone/email clickable in individuals list"
```

---

## Task 13: Swap Phone/Email to Clickable in Organizations Detail Page

**Files:**
- Modify: `frontend/app/admin/organizations/[id]/page.tsx`

**Step 1: Replace display elements**

Find where organization contact phone numbers and email are displayed and replace with clickable wrappers. Check the exact field names (may be `org.email`, `org.phone`, or contact numbers array).

**Step 2: Commit**

```bash
git add frontend/app/admin/organizations/[id]/page.tsx
git commit -m "feat: make phone/email clickable in organization detail page"
```

---

## Task 14: Verify All Features Work Together

**Step 1: Build frontend**

```bash
cd frontend && npm run build
```

Check: no new build errors (pre-existing CRM useSearchParams errors are OK).

**Step 2: Visual checks**

- Navigate to CRM leads list → emails should be blue clickable links
- Click an email → floating compose popover opens with To pre-filled
- Click lead detail → phone should be indigo clickable
- Click phone → Softphone panel opens with number pre-filled, starts "calling"
- Close Softphone → panel closes
- Send email from popover → success toast, popover closes
- Check individuals, organizations, chat window → same behavior

**Step 3: Commit any fixes**

```bash
git add -A && git commit -m "fix: resolve integration issues for clickable phone/email"
```
