# Universal Ticket Creation Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow agents to create tickets from messaging conversations, the email view, and a standalone workspace button — not just during call-ins — with hard links to conversations/emails and org auto-matching.

**Architecture:** A new `QuickTicketModal` React component (reused from all three entry points) handles prefill, org context lookup, and POST submission. The backend gains three column migrations, an extended `POST /api/tickets` that skips call-log creation for non-call sources, a new `GET /api/tickets/context-by-email` endpoint, and ticket_count enrichment on conversations.

**Tech Stack:** FastAPI + SQLAlchemy (backend), Next.js 14 App Router + TailwindCSS (frontend), no test framework — verify via Swagger UI and browser.

---

## Chunk 1: Backend — DB Migrations & Model

### Task 1: Add columns to Ticket model and run migrations

**Files:**
- Modify: `backend/app/models/ticket.py`
- Modify: `backend/main.py` (inline SQL migration block around line 519)

- [ ] **Step 1: Add three columns to the Ticket SQLAlchemy model**

Open `backend/app/models/ticket.py`. After the `parent_ticket_id` column (line 48), add:

```python
# Source tracking and cross-system links
conversation_id = Column(Integer, ForeignKey("conversations.id", ondelete="SET NULL"), nullable=True)
email_id = Column(Integer, ForeignKey("emails.id", ondelete="SET NULL"), nullable=True)
source = Column(String, nullable=False, server_default="call")
```

- [ ] **Step 2: Add inline SQL migrations to main.py**

In `backend/main.py`, find the block that ends with:
```python
conn.execute(text("ALTER TABLE tickets ADD COLUMN IF NOT EXISTS customer_email VARCHAR"))
```
(around line 519). Immediately after that line, add:

```python
conn.execute(text("ALTER TABLE tickets ADD COLUMN IF NOT EXISTS conversation_id INTEGER REFERENCES conversations(id) ON DELETE SET NULL"))
conn.execute(text("ALTER TABLE tickets ADD COLUMN IF NOT EXISTS email_id INTEGER REFERENCES emails(id) ON DELETE SET NULL"))
conn.execute(text("ALTER TABLE tickets ADD COLUMN IF NOT EXISTS source VARCHAR NOT NULL DEFAULT 'call'"))
```

- [ ] **Step 3: Restart backend and verify**

```bash
cd backend && source venv/bin/activate && uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

Check logs — no migration errors. Then verify via psql or Swagger:
```sql
SELECT column_name FROM information_schema.columns WHERE table_name = 'tickets' AND column_name IN ('conversation_id', 'email_id', 'source');
```
Expected: 3 rows returned.

- [ ] **Step 4: Commit**

```bash
git add backend/app/models/ticket.py backend/main.py
git commit -m "feat: add conversation_id, email_id, source columns to tickets"
```

---

## Chunk 2: Backend — Schema & Ticket Route Changes

### Task 2: Extend TicketCreate schema

**Files:**
- Modify: `backend/app/schemas/ticket.py`

- [ ] **Step 1: Add new fields to TicketCreate**

Open `backend/app/schemas/ticket.py`. Change `TicketCreate` from:

```python
class TicketCreate(TicketBase):
    pass
```

to:

```python
class TicketCreate(TicketBase):
    conversation_id: Optional[int] = None
    email_id: Optional[int] = None
    source: str = "call"  # call | messaging | email | manual
```

Also add `conversation_id`, `email_id`, and `source` to `TicketResponse`:

```python
class TicketResponse(TicketBase):
    id: int
    ticket_number: str
    created_at: datetime
    updated_at: Optional[datetime] = None
    assignee_name: Optional[str] = None
    parent_ticket_number: Optional[str] = None
    conversation_id: Optional[int] = None
    email_id: Optional[int] = None
    source: Optional[str] = None

    model_config = ConfigDict(from_attributes=True)
```

- [ ] **Step 2: Verify Swagger shows new fields**

Navigate to `http://localhost:8000/docs` → `POST /api/tickets` → click "Try it out". Confirm `conversation_id`, `email_id`, and `source` appear in the request body schema.

- [ ] **Step 3: Commit**

```bash
git add backend/app/schemas/ticket.py
git commit -m "feat: add conversation_id, email_id, source to ticket schema"
```

---

### Task 3: Extend POST /api/tickets to persist new fields and skip CallRecording for non-call sources

**Files:**
- Modify: `backend/app/routes/tickets.py`

- [ ] **Step 1: Store new fields on Ticket object**

In `backend/app/routes/tickets.py`, find the `Ticket(...)` constructor in `create_ticket` (around line 33). Add three new kwargs:

```python
new_ticket = Ticket(
    ticket_number=ticket_number,
    phone_number=ticket_in.phone_number,
    customer_name=ticket_in.customer_name,
    customer_gender=ticket_in.customer_gender,
    customer_type=ticket_in.customer_type,
    contact_person=ticket_in.contact_person,
    customer_email=ticket_in.customer_email,
    category=ticket_in.category,
    forward_target=ticket_in.forward_target,
    forward_reason=ticket_in.forward_reason,
    status=ticket_in.status,
    priority=ticket_in.priority,
    assigned_to=ticket_in.assigned_to or current_user.id,
    app_type_data=ticket_in.app_type_data,
    parent_ticket_id=ticket_in.parent_ticket_id,
    organization_id=ticket_in.organization_id,
    conversation_id=ticket_in.conversation_id,   # NEW
    email_id=ticket_in.email_id,                 # NEW
    source=ticket_in.source,                     # NEW
)
```

- [ ] **Step 2: Gate CallRecording creation on source == "call"**

Find the block starting with (around line 118):
```python
if not ticket_in.parent_ticket_id:
    recent_cutoff = ...
```

Wrap the entire `CallRecording` creation block in an additional `source == "call"` check:

```python
if not ticket_in.parent_ticket_id and ticket_in.source == "call":
    recent_cutoff = datetime.utcnow() - timedelta(minutes=30)
    existing_call = db.query(CallRecording).filter(
        CallRecording.phone_number == ticket_in.phone_number,
        CallRecording.agent_id == current_user.id,
        CallRecording.created_at >= recent_cutoff
    ).first()
    if not existing_call:
        call_log = CallRecording(
            agent_id=current_user.id,
            agent_name=getattr(current_user, 'display_name', None) or getattr(current_user, 'full_name', None) or current_user.email,
            phone_number=ticket_in.phone_number,
            organization_id=ticket_in.organization_id,
            direction="inbound",
            disposition="ANSWERED",
            duration_seconds=0,
            ticket_number=new_ticket.ticket_number,
        )
        db.add(call_log)
        db.commit()
```

- [ ] **Step 3: Verify via Swagger**

POST to `/api/tickets` with `source: "messaging"`. Confirm:
1. Ticket is created (201 response, ticket_number returned)
2. No new row appears in `call_recordings` table

Then POST with `source: "call"`. Confirm a `call_recordings` row is created.

- [ ] **Step 4: Commit**

```bash
git add backend/app/routes/tickets.py
git commit -m "feat: persist conversation_id/email_id/source on tickets, skip CallRecording for non-call sources"
```

---

### Task 4: Add GET /api/tickets/context-by-email endpoint

**Files:**
- Modify: `backend/app/routes/tickets.py`

- [ ] **Step 1: Add the new endpoint**

In `backend/app/routes/tickets.py`, add this **immediately after** the `get_ticket_context` function body (around line 238) and **before** the `update_ticket` route. This keeps fixed-string paths before any parameterised `/{ticket_id}` routes, avoiding FastAPI routing conflicts.

```python

@router.get("/context-by-email")
def get_ticket_context_by_email(
    email: str = Query(..., description="Full email address to look up org by domain"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Retrieve org context by email address — matches on email domain."""
    from app.models.organization import Organization, OrganizationContact
    from app.models.email import Contact

    result = {
        "found": False,
        "customer_type": None,
        "customer_name": None,
        "organization_name": None,
        "organization_id": None,
        "contact_person": None,
        "email": email,
    }

    # 1. Try exact match on org contact email
    org_contact = db.query(OrganizationContact).filter(
        OrganizationContact.email.ilike(email)
    ).first()
    if org_contact and org_contact.organization:
        result.update({
            "found": True,
            "customer_type": "organization",
            "contact_person": org_contact.full_name,
            "customer_name": org_contact.organization.organization_name,
            "organization_name": org_contact.organization.organization_name,
            "organization_id": org_contact.organization.id,
        })
        return result

    # 2. Try exact match on org primary email
    org = db.query(Organization).filter(
        Organization.email.ilike(email)
    ).first()
    if org:
        result.update({
            "found": True,
            "customer_type": "organization",
            "customer_name": org.organization_name,
            "organization_name": org.organization_name,
            "organization_id": org.id,
        })
        return result

    # 3. Try domain match on org domain_name field (Organization.domain_name stores the website domain)
    if "@" in email:
        domain = email.split("@", 1)[1].lower()
        org = db.query(Organization).filter(
            Organization.domain_name.ilike(f"%{domain}%")
        ).first()
        if org:
            result.update({
                "found": True,
                "customer_type": "organization",
                "customer_name": org.organization_name,
                "organization_name": org.organization_name,
                "organization_id": org.id,
            })
            return result

    # 4. Try email Contact table
    contact = db.query(Contact).filter(Contact.email.ilike(email)).first()
    if contact:
        result.update({
            "found": True,
            "customer_type": "individual",
            "customer_name": contact.name,
        })

    return result
```

Note: `Query` is already imported at the top of tickets.py. If `Contact` does not exist in `app.models.email`, omit step 4 of the lookup.

- [ ] **Step 2: Verify via Swagger**

GET `/api/tickets/context-by-email?email=someone@example.com`

- If example.com matches an org's `email_domain`: should return `found: true` with org details
- For an unknown email: should return `found: false`

- [ ] **Step 3: Commit**

```bash
git add backend/app/routes/tickets.py
git commit -m "feat: add GET /api/tickets/context-by-email for org lookup by email domain"
```

---

### Task 5: Add ticket_count to conversations response

**Files:**
- Modify: `backend/app/schemas/conversation.py`
- Modify: `backend/app/routes/conversations.py`

- [ ] **Step 1: Add ticket_count to ConversationResponse schema**

Open `backend/app/schemas/conversation.py`. Add the field:

```python
class ConversationResponse(BaseModel):
    id: int
    platform: str
    contact_name: str
    contact_id: str
    last_message: Optional[str]
    last_message_time: Optional[datetime]
    unread_count: int
    contact_avatar: Optional[str]
    status: str = "open"
    category: Optional[str] = None
    assigned_to: Optional[int] = None
    assigned_to_name: Optional[str] = None
    platform_account_id: Optional[int] = None
    widget_domain_id: Optional[int] = None
    widget_domain_name: Optional[str] = None
    ticket_count: int = 0        # NEW

    class Config:
        from_attributes = True
```

- [ ] **Step 2: Populate ticket_count in _enrich**

Open `backend/app/routes/conversations.py`. In the `_enrich` function (line 23), add a batch ticket count lookup:

```python
def _enrich(convs, db: Session):
    """Attach assigned_to_name, assigned_team_name, and ticket_count by doing batched lookups."""
    from app.models.ticket import Ticket
    from sqlalchemy import func

    user_ids = {c.assigned_to for c in convs if c.assigned_to}
    team_ids = {getattr(c, 'assigned_team_id', None) for c in convs if getattr(c, 'assigned_team_id', None)}
    users = {u.id: (u.full_name or u.username) for u in
             db.query(User).filter(User.id.in_(user_ids)).all()} if user_ids else {}
    teams = {t.id: t.name for t in
             db.query(Team).filter(Team.id.in_(team_ids)).all()} if team_ids else {}

    # Batch ticket counts
    conv_ids = [c.id for c in convs]
    ticket_counts = {}
    if conv_ids:
        rows = db.query(Ticket.conversation_id, func.count(Ticket.id)).filter(
            Ticket.conversation_id.in_(conv_ids)
        ).group_by(Ticket.conversation_id).all()
        ticket_counts = {row[0]: row[1] for row in rows}

    result = []
    for c in convs:
        d = {col.name: getattr(c, col.name) for col in c.__table__.columns}
        d['assigned_to_name'] = users.get(c.assigned_to) if c.assigned_to else None
        d['assigned_team_id'] = getattr(c, 'assigned_team_id', None)
        d['assigned_team_name'] = teams.get(d['assigned_team_id']) if d['assigned_team_id'] else None
        d['ticket_count'] = ticket_counts.get(c.id, 0)   # NEW
        result.append(d)
    return result
```

- [ ] **Step 3: Verify via Swagger**

GET `/conversations/?user_id=1`. Confirm each conversation object has `ticket_count` field. Create a ticket with a known `conversation_id`, re-fetch conversations — confirm `ticket_count` incremented.

- [ ] **Step 4: Commit**

```bash
git add backend/app/schemas/conversation.py backend/app/routes/conversations.py
git commit -m "feat: add ticket_count to conversations list response"
```

---

## Chunk 3: Frontend — QuickTicketModal Component

### Task 6: Build QuickTicketModal

**Files:**
- Create: `frontend/components/QuickTicketModal.tsx`

- [ ] **Step 1: Create the component file**

Create `frontend/components/QuickTicketModal.tsx` with this content:

```tsx
'use client'

import { useState, useEffect } from 'react'
import axios from 'axios'
import { getAuthToken } from '@/lib/auth'
import { API_URL } from '@/lib/config'

interface QuickTicketModalProps {
  open: boolean
  onClose: () => void
  onCreated: () => void
  prefill?: {
    phone?: string
    email?: string
    contactName?: string
    conversationId?: number
    emailId?: number
  }
}

const CATEGORIES = ['General', 'Billing', 'Technical Support', 'Sales', 'Complaint', 'Other']
const PRIORITIES = ['low', 'normal', 'high', 'urgent']
const STATUSES = ['pending', 'solved', 'forwarded']

export default function QuickTicketModal({ open, onClose, onCreated, prefill = {} }: QuickTicketModalProps) {
  const [lookupValue, setLookupValue] = useState(prefill.phone || prefill.email || '')
  const [lookupType, setLookupType] = useState<'phone' | 'email'>(prefill.email && !prefill.phone ? 'email' : 'phone')
  const [context, setContext] = useState<any>(null)
  const [contextLoading, setContextLoading] = useState(false)

  const [form, setForm] = useState({
    category: '',
    priority: 'normal',
    status: 'pending',
    assigned_to: '',
    note: '',
  })
  const [agents, setAgents] = useState<{ id: number; full_name: string }[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  // Fetch agents list once
  useEffect(() => {
    if (!open) return
    const token = getAuthToken()
    axios.get(`${API_URL}/conversations/agents`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => setAgents(r.data))
      .catch(() => {})
  }, [open])

  // Auto-lookup when modal opens with prefilled phone/email
  useEffect(() => {
    if (!open) return
    const val = prefill.phone || prefill.email || ''
    const type = prefill.email && !prefill.phone ? 'email' : 'phone'
    setLookupValue(val)
    setLookupType(type)
    setContext(null)
    setError('')
    setSuccess('')
    setForm({ category: '', priority: 'normal', status: 'pending', assigned_to: '', note: '' })
    if (val) doLookup(val, type)
  }, [open, prefill.phone, prefill.email])

  async function doLookup(val: string, type: 'phone' | 'email') {
    if (!val.trim()) return
    setContextLoading(true)
    setContext(null)
    try {
      const token = getAuthToken()
      const url = type === 'email'
        ? `${API_URL}/api/tickets/context-by-email?email=${encodeURIComponent(val)}`
        : `${API_URL}/api/tickets/context/${encodeURIComponent(val)}`
      const r = await axios.get(url, { headers: { Authorization: `Bearer ${token}` } })
      setContext(r.data)
    } catch {
      setContext(null)
    } finally {
      setContextLoading(false)
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.category) { setError('Category is required'); return }
    setSubmitting(true)
    setError('')
    try {
      const token = getAuthToken()
      const source = prefill.conversationId ? 'messaging' : prefill.emailId ? 'email' : 'manual'
      // For email-only tickets, phone_number is NOT NULL — use sentinel 'email-only'
      const phone = lookupType === 'phone' ? lookupValue : (context?.phone_number || 'email-only')
      const customerEmail = lookupType === 'email' ? lookupValue : context?.email || undefined

      await axios.post(`${API_URL}/api/tickets`, {
        phone_number: phone,
        customer_name: prefill.contactName || context?.customer_name || context?.caller_name || '',
        customer_type: context?.customer_type || 'individual',
        customer_email: customerEmail,
        organization_id: context?.organization_id || undefined,
        category: form.category,
        priority: form.priority,
        status: form.status,
        assigned_to: form.assigned_to ? Number(form.assigned_to) : undefined,
        app_type_data: form.note ? { description: form.note } : undefined,
        conversation_id: prefill.conversationId || undefined,
        email_id: prefill.emailId || undefined,
        source,
      }, { headers: { Authorization: `Bearer ${token}` } })

      setSuccess('Ticket created successfully')
      setTimeout(() => {
        onCreated()
        onClose()
        setSuccess('')
      }, 1200)
    } catch (err: any) {
      setError(err?.response?.data?.detail || 'Failed to create ticket')
    } finally {
      setSubmitting(false)
    }
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b bg-indigo-50">
          <h2 className="text-lg font-bold text-indigo-800">Create Ticket</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl font-bold leading-none">&times;</button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {/* Lookup row */}
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1 uppercase tracking-wide">Customer Lookup</label>
            <div className="flex gap-2">
              <select
                value={lookupType}
                onChange={e => { setLookupType(e.target.value as 'phone' | 'email'); setContext(null) }}
                className="text-sm border border-gray-200 rounded-lg px-2 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-200"
              >
                <option value="phone">Phone</option>
                <option value="email">Email</option>
              </select>
              <input
                type={lookupType === 'email' ? 'email' : 'tel'}
                value={lookupValue}
                onChange={e => setLookupValue(e.target.value)}
                onBlur={() => doLookup(lookupValue, lookupType)}
                placeholder={lookupType === 'email' ? 'customer@example.com' : '+1234567890'}
                className="flex-1 text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-200"
                readOnly={!!(prefill.phone || prefill.email)}
              />
            </div>

            {/* Context result */}
            {contextLoading && <p className="text-xs text-gray-400 mt-1">Looking up customer…</p>}
            {context && (
              <div className="mt-2 px-3 py-2 bg-indigo-50 rounded-lg text-sm">
                {context.found ? (
                  <>
                    <span className="font-semibold text-indigo-700">{context.organization_name || context.customer_name}</span>
                    {context.contact_person && <span className="text-gray-500"> · {context.contact_person}</span>}
                    <span className="ml-2 text-xs text-green-600 font-medium">Matched</span>
                  </>
                ) : (
                  <span className="text-gray-400">No org match found — ticket will be unlinked</span>
                )}
              </div>
            )}
          </div>

          {/* Category */}
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1 uppercase tracking-wide">Category <span className="text-red-500">*</span></label>
            <select
              value={form.category}
              onChange={e => setForm(f => ({ ...f, category: e.target.value }))}
              className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-200"
              required
            >
              <option value="">Select category…</option>
              {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>

          {/* Priority & Status */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1 uppercase tracking-wide">Priority</label>
              <select
                value={form.priority}
                onChange={e => setForm(f => ({ ...f, priority: e.target.value }))}
                className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-200"
              >
                {PRIORITIES.map(p => <option key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1 uppercase tracking-wide">Status</label>
              <select
                value={form.status}
                onChange={e => setForm(f => ({ ...f, status: e.target.value }))}
                className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-200"
              >
                {STATUSES.map(s => <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>)}
              </select>
            </div>
          </div>

          {/* Assign to */}
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1 uppercase tracking-wide">Assign To</label>
            <select
              value={form.assigned_to}
              onChange={e => setForm(f => ({ ...f, assigned_to: e.target.value }))}
              className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-200"
            >
              <option value="">Self (default)</option>
              {agents.map(a => <option key={a.id} value={a.id}>{a.full_name}</option>)}
            </select>
          </div>

          {/* Note */}
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1 uppercase tracking-wide">Description / Note <span className="text-gray-400">(optional)</span></label>
            <textarea
              value={form.note}
              onChange={e => setForm(f => ({ ...f, note: e.target.value }))}
              rows={3}
              placeholder="Brief description of the issue…"
              className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-200 resize-none"
            />
          </div>

          {error && <p className="text-sm text-red-500">{error}</p>}
          {success && <p className="text-sm text-green-600 font-medium">{success}</p>}

          {/* Actions */}
          <div className="flex gap-3 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2 rounded-lg border border-gray-200 text-sm text-gray-600 hover:bg-gray-50 transition"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="flex-1 py-2 rounded-lg bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 transition disabled:opacity-50"
            >
              {submitting ? 'Creating…' : 'Create Ticket'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Verify the component compiles**

```bash
cd frontend && npm run build 2>&1 | grep -E "error|QuickTicketModal"
```

Expected: no TypeScript errors for the new file.

- [ ] **Step 3: Commit**

```bash
git add frontend/components/QuickTicketModal.tsx
git commit -m "feat: add QuickTicketModal component for universal ticket creation"
```

---

## Chunk 4: Frontend — Wire Up Entry Points

### Task 7: Add ticket_count badge to ConversationList

**Files:**
- Modify: `frontend/components/ConversationList.tsx`

- [ ] **Step 1: Add ticket_count to the Conversation interface**

In `frontend/components/ConversationList.tsx`, find the `interface Conversation` block (line 4). Add:

```ts
ticket_count?: number
```

- [ ] **Step 2: Render the badge**

Find the block that renders `contact_name` (around line 122):

```tsx
<span className="font-semibold text-gray-800">
  {conversation.contact_name}
</span>
```

After the closing `</span>`, add:

```tsx
{(conversation.ticket_count ?? 0) > 0 && (
  <span
    className="ml-1 inline-flex items-center gap-0.5 text-[10px] font-semibold bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full"
    title={`${conversation.ticket_count} ticket${conversation.ticket_count === 1 ? '' : 's'}`}
  >
    🎫 {conversation.ticket_count}
  </span>
)}
```

- [ ] **Step 3: Verify in browser**

Open the dashboard. Conversations with tickets (create one via Swagger first) should show the amber pill badge.

- [ ] **Step 4: Commit**

```bash
git add frontend/components/ConversationList.tsx
git commit -m "feat: show ticket count badge on conversations with linked tickets"
```

---

### Task 8: Add Create Ticket button to ChatWindow

**Files:**
- Modify: `frontend/components/ChatWindow.tsx`

- [ ] **Step 1: Import QuickTicketModal**

At the top of `frontend/components/ChatWindow.tsx`, after the existing imports, add:

```tsx
import QuickTicketModal from './QuickTicketModal'
```

- [ ] **Step 2: Add modal state**

After the existing `useState` declarations in the component body (around line 93), add:

```tsx
const [quickTicketOpen, setQuickTicketOpen] = useState(false)
```

- [ ] **Step 3: Add the button in the header toolbar**

Find the "CRM Sidebar toggle" button (around line 627):

```tsx
<button
  onClick={() => setCrmSidebarOpen((prev) => !prev)}
  ...
>
```

Immediately before that button, add:

```tsx
{/* Create Ticket */}
<button
  onClick={() => setQuickTicketOpen(true)}
  className="p-1.5 rounded-lg text-sm font-medium text-gray-400 hover:text-amber-600 hover:bg-amber-50 transition"
  title="Create Ticket"
>
  🎫 Ticket
</button>
```

- [ ] **Step 4: Render the modal**

Find the closing `</div>` of the main component return (near the end of the file). Just before it, add:

```tsx
<QuickTicketModal
  open={quickTicketOpen}
  onClose={() => setQuickTicketOpen(false)}
  onCreated={() => { setQuickTicketOpen(false); onRefresh() }}
  prefill={{
    phone: conversation?.contact_id,
    contactName: conversation?.contact_name,
    conversationId: conversation?.id,
  }}
/>
```

- [ ] **Step 5: Verify in browser**

Open a conversation in the dashboard. The "🎫 Ticket" button should appear in the header toolbar. Click it — modal opens pre-filled with the contact's phone/name. Submit a ticket and confirm it appears in the admin tickets page.

- [ ] **Step 6: Commit**

```bash
git add frontend/components/ChatWindow.tsx
git commit -m "feat: add Create Ticket button to ChatWindow"
```

---

### Task 9: Add Create Ticket button to Email view

**Files:**
- Modify: `frontend/app/email/page.tsx`

- [ ] **Step 1: Import QuickTicketModal**

Near the top of `frontend/app/email/page.tsx`, add:

```tsx
import QuickTicketModal from '@/components/QuickTicketModal'
```

- [ ] **Step 2: Add modal state**

In the component state section, add:

```tsx
const [quickTicketOpen, setQuickTicketOpen] = useState(false)
const [quickTicketPrefill, setQuickTicketPrefill] = useState<{
  email?: string; contactName?: string; emailId?: number
}>({})
```

- [ ] **Step 3: Add "Create Ticket" button alongside Reply/Reply All/Forward**

Find the Reply button block (around line 3451):

```tsx
<button onClick={() => handleReply(latestEmail, selectedThread)} className="bg-blue-600 ...">
  ...Reply
</button>
```

After the Forward button (line ~3461), add:

```tsx
<button
  onClick={() => {
    setQuickTicketPrefill({
      email: latestEmail.from_address,
      contactName: latestEmail.from_address,  // Email interface has no from_name field
      emailId: latestEmail.id,
    })
    setQuickTicketOpen(true)
  }}
  className="bg-amber-500 hover:bg-amber-600 text-white text-sm font-semibold px-4 py-1.5 rounded-full transition flex items-center gap-1.5"
>
  🎫 Create Ticket
</button>
```

- [ ] **Step 4: Render the modal**

Find the outermost closing `</div>` or `</>` of the page component's return. Add before it:

```tsx
<QuickTicketModal
  open={quickTicketOpen}
  onClose={() => setQuickTicketOpen(false)}
  onCreated={() => setQuickTicketOpen(false)}
  prefill={quickTicketPrefill}
/>
```

- [ ] **Step 5: Confirm `from_address` and `id` exist on the Email interface**

```bash
grep -n "from_address\|\"id\"" frontend/app/email/page.tsx | head -5
```

Expected: both fields are present. No `from_name` field exists — `from_address` is used directly as `contactName`.

- [ ] **Step 6: Verify in browser**

Open an email. The "🎫 Create Ticket" button should appear next to Reply/Reply All/Forward. Click it — modal opens pre-filled with sender email. Submit and verify ticket appears in admin.

- [ ] **Step 7: Commit**

```bash
git add frontend/app/email/page.tsx
git commit -m "feat: add Create Ticket button to email view"
```

---

### Task 10: Add standalone Create Ticket button to Workspace

**Files:**
- Modify: `frontend/app/workspace/page.tsx`

- [ ] **Step 1: Import QuickTicketModal**

Near the top of `frontend/app/workspace/page.tsx`, add:

```tsx
import QuickTicketModal from '@/components/QuickTicketModal'
```

- [ ] **Step 2: Add modal state**

In the component state section add:

```tsx
const [quickTicketOpen, setQuickTicketOpen] = useState(false)
```

- [ ] **Step 3: Add the button in the workspace header**

Find the workspace header flex container (around line 176):

```tsx
<div className="flex flex-wrap items-center gap-4 w-full sm:w-auto">
```

Inside that div, add a "Create Ticket" button before the status select (before the `{process.env.NODE_ENV !== 'production' && ...}` block or after it):

```tsx
<button
  onClick={() => setQuickTicketOpen(true)}
  className="px-4 py-2 bg-amber-100 text-amber-700 font-medium rounded-lg hover:bg-amber-200 transition text-sm flex items-center gap-2"
>
  🎫 Create Ticket
</button>
```

- [ ] **Step 4: Render the modal**

Find the closing of the workspace page return. Add before the last `</div>`:

```tsx
<QuickTicketModal
  open={quickTicketOpen}
  onClose={() => setQuickTicketOpen(false)}
  onCreated={() => { setQuickTicketOpen(false); fetchMyTickets() }}
  prefill={{}}
/>
```

Note: `fetchMyTickets` is whatever function the workspace page uses to reload the inbox (search for `fetchMyTickets` or equivalent in the file and use the correct name).

- [ ] **Step 5: Verify the correct refresh function name**

```bash
grep -n "fetchMyTickets\|loadTickets\|fetchTickets\|myTickets" frontend/app/workspace/page.tsx | head -10
```

Use the correct function name in `onCreated`.

- [ ] **Step 6: Verify in browser**

Open the workspace. "🎫 Create Ticket" button is visible in the header at all times (no active call needed). Click it — modal opens with empty prefill. Type a phone number and blur — org lookup fires. Submit and verify.

- [ ] **Step 7: Commit**

```bash
git add frontend/app/workspace/page.tsx
git commit -m "feat: add standalone Create Ticket button to workspace header"
```

---

## Chunk 5: Final Verification

### Task 11: End-to-end smoke test all three entry points

- [ ] **Step 1: Test messaging entry point**

1. Open Dashboard → select any conversation
2. Click "🎫 Ticket" button in chat header
3. Confirm modal opens with contact phone pre-filled
4. Confirm org lookup fires and shows match (or "no match")
5. Fill category, submit
6. Open Admin → Tickets — ticket appears with correct conversation link
7. Conversation list badge shows count increment

- [ ] **Step 2: Test email entry point**

1. Open Email view → select any email
2. Click "🎫 Create Ticket" button
3. Confirm modal opens with sender email pre-filled
4. Confirm org lookup fires
5. Submit — ticket appears in Admin → Tickets

- [ ] **Step 3: Test workspace standalone**

1. Open Workspace
2. Click "🎫 Create Ticket" (always visible, no call needed)
3. Type a phone number, tab out — org lookup fires
4. Fill fields, submit — ticket appears in inbox and admin view

- [ ] **Step 4: Verify call-in flow still works**

1. Simulate a call (dev only) — TicketForm activates as before
2. Submit ticket — CallRecording row created (check via Swagger GET `/api/calls`)
3. Confirm source == "call" on the ticket

- [ ] **Step 5: Final commit**

```bash
git add -A
git commit -m "feat: universal ticket creation — messaging, email, workspace entry points complete"
```
