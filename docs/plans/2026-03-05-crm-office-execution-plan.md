# CRM Office Execution Enhancement — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Improve daily agent productivity by adding a smart CRM sidebar in chat, an agent daily dashboard, and quick-action/collaboration features.

**Architecture:** Backend additions to FastAPI CRM routes with new LeadNote model and dashboard aggregation endpoints. Frontend additions as a collapsible CRM sidebar in ChatWindow and a new "My Day" dashboard page. No new dependencies required.

**Tech Stack:** FastAPI, SQLAlchemy 2.0, PostgreSQL, Next.js 14 App Router, TypeScript, TailwindCSS, Axios

**Design Doc:** `docs/plans/2026-03-05-crm-office-execution-design.md`

**Note:** This project has no test framework. Verification is done via Swagger UI (`http://localhost:8000/docs`) and browser testing at `http://localhost:3000`.

---

## Phase 1: Smart Customer Sidebar in Chat

### Task 1: Add LeadNote model

**Files:**
- Modify: `backend/app/models/crm.py` (after line 181, end of file)

**Step 1: Add the LeadNote model class**

Add after the `Activity` class at the end of `backend/app/models/crm.py`:

```python
class LeadNote(Base):
    __tablename__ = "crm_lead_notes"

    id = Column(Integer, primary_key=True)
    lead_id = Column(Integer, ForeignKey("leads.id"), nullable=False)
    content = Column(Text, nullable=False)
    is_pinned = Column(Boolean, default=False)
    created_by = Column(Integer, ForeignKey("users.id"), nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    lead = relationship("Lead", back_populates="notes")
    user = relationship("User", foreign_keys=[created_by])
```

**Step 2: Add `notes` relationship to Lead model**

In the `Lead` class (around line 98), add below the `organization` relationship:

```python
    notes = relationship("LeadNote", back_populates="lead", cascade="all, delete-orphan")
```

**Step 3: Add inline migration for safety**

In `backend/main.py` inside `_run_inline_migrations()`, add:

```python
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS crm_lead_notes (
                id SERIAL PRIMARY KEY,
                lead_id INTEGER NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
                content TEXT NOT NULL,
                is_pinned BOOLEAN DEFAULT FALSE,
                created_by INTEGER NOT NULL REFERENCES users(id),
                created_at TIMESTAMP DEFAULT NOW(),
                updated_at TIMESTAMP DEFAULT NOW()
            )
        """))
```

**Step 4: Commit**

```bash
git add backend/app/models/crm.py backend/main.py
git commit -m "feat(crm): add LeadNote model for persistent internal notes"
```

---

### Task 2: Add LeadNote Pydantic schemas

**Files:**
- Modify: `backend/app/schemas/crm.py` (append after existing schemas)

**Step 1: Add note schemas**

Append to `backend/app/schemas/crm.py`:

```python
# ========== NOTE SCHEMAS ==========

class NoteCreate(BaseModel):
    content: str
    is_pinned: Optional[bool] = False

class NoteUpdate(BaseModel):
    content: Optional[str] = None
    is_pinned: Optional[bool] = None

class NoteResponse(BaseModel):
    id: int
    lead_id: int
    content: str
    is_pinned: bool
    created_by: int
    created_by_name: Optional[str] = None
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True
```

**Step 2: Commit**

```bash
git add backend/app/schemas/crm.py
git commit -m "feat(crm): add Pydantic schemas for lead notes"
```

---

### Task 3: Add auto-match and notes API endpoints

**Files:**
- Modify: `backend/app/routes/crm.py`

**Step 1: Add imports**

At the top of `backend/app/routes/crm.py`, update the model import (line 7) to include `LeadNote`:

```python
from app.models.crm import Lead, Deal, Task, Activity, LeadNote, LeadStatus, DealStage, TaskStatus, ActivityType
```

Update the schema import (lines 10-15) to include note schemas:

```python
from app.schemas.crm import (
    LeadCreate, LeadUpdate, LeadResponse, LeadDetailResponse,
    DealCreate, DealUpdate, DealResponse,
    TaskCreate, TaskUpdate, TaskResponse,
    ActivityCreate, ActivityResponse,
    NoteCreate, NoteUpdate, NoteResponse,
)
```

Add `or_` to SQLAlchemy imports:

```python
from sqlalchemy import desc, or_, func
```

**Step 2: Add auto-match endpoint**

Add before the existing `POST /leads` endpoint (before line 28):

```python
@router.get("/leads/auto-match")
def auto_match_lead(
    phone: str = Query(None),
    email: str = Query(None),
    name: str = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Find leads matching by phone, email, or name (exact match)."""
    if phone:
        leads = db.query(Lead).filter(Lead.phone == phone).all()
        if leads:
            return leads
    if email:
        leads = db.query(Lead).filter(Lead.email == email).all()
        if leads:
            return leads
    if name:
        leads = db.query(Lead).filter(
            or_(
                func.concat(Lead.first_name, ' ', Lead.last_name).ilike(f"%{name}%"),
                Lead.first_name.ilike(f"%{name}%"),
            )
        ).all()
        if leads:
            return leads
    return []
```

**Step 3: Add notes CRUD endpoints**

Add after the activities endpoints (at end of file, before analytics section):

```python
# ========== NOTE ENDPOINTS ==========

@router.get("/leads/{lead_id}/notes", response_model=list[NoteResponse])
def get_lead_notes(
    lead_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    lead = db.query(Lead).filter(Lead.id == lead_id).first()
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
    notes = (
        db.query(LeadNote)
        .filter(LeadNote.lead_id == lead_id)
        .order_by(LeadNote.is_pinned.desc(), LeadNote.created_at.desc())
        .all()
    )
    result = []
    for note in notes:
        user = db.query(User).filter(User.id == note.created_by).first()
        result.append(NoteResponse(
            id=note.id,
            lead_id=note.lead_id,
            content=note.content,
            is_pinned=note.is_pinned,
            created_by=note.created_by,
            created_by_name=user.full_name if user else None,
            created_at=note.created_at,
            updated_at=note.updated_at,
        ))
    return result


@router.post("/leads/{lead_id}/notes", response_model=NoteResponse)
def create_note(
    lead_id: int,
    note: NoteCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    lead = db.query(Lead).filter(Lead.id == lead_id).first()
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
    db_note = LeadNote(
        lead_id=lead_id,
        content=note.content,
        is_pinned=note.is_pinned,
        created_by=current_user.id,
    )
    db.add(db_note)
    db.commit()
    db.refresh(db_note)
    return NoteResponse(
        id=db_note.id,
        lead_id=db_note.lead_id,
        content=db_note.content,
        is_pinned=db_note.is_pinned,
        created_by=db_note.created_by,
        created_by_name=current_user.full_name,
        created_at=db_note.created_at,
        updated_at=db_note.updated_at,
    )


@router.patch("/leads/notes/{note_id}", response_model=NoteResponse)
def update_note(
    note_id: int,
    note_update: NoteUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    note = db.query(LeadNote).filter(LeadNote.id == note_id).first()
    if not note:
        raise HTTPException(status_code=404, detail="Note not found")
    update_data = note_update.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(note, key, value)
    db.commit()
    db.refresh(note)
    user = db.query(User).filter(User.id == note.created_by).first()
    return NoteResponse(
        id=note.id,
        lead_id=note.lead_id,
        content=note.content,
        is_pinned=note.is_pinned,
        created_by=note.created_by,
        created_by_name=user.full_name if user else None,
        created_at=note.created_at,
        updated_at=note.updated_at,
    )


@router.delete("/leads/notes/{note_id}")
def delete_note(
    note_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    note = db.query(LeadNote).filter(LeadNote.id == note_id).first()
    if not note:
        raise HTTPException(status_code=404, detail="Note not found")
    db.delete(note)
    db.commit()
    return {"detail": "Note deleted"}
```

**Step 4: Verify via Swagger**

Run backend: `cd backend && uvicorn main:app --reload --port 8000`
Open: `http://localhost:8000/docs`
Test: `GET /crm/leads/auto-match?name=test` — should return empty array
Test: `POST /crm/leads/{any_lead_id}/notes` with `{"content": "Test note"}` — should create note

**Step 5: Commit**

```bash
git add backend/app/routes/crm.py
git commit -m "feat(crm): add auto-match and notes CRUD endpoints"
```

---

### Task 4: Build CrmSidebar frontend component

**Files:**
- Create: `frontend/components/CrmSidebar.tsx`

**Step 1: Create the CrmSidebar component**

Create `frontend/components/CrmSidebar.tsx`:

```tsx
"use client";
import { useState, useEffect } from "react";
import axios from "axios";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

interface Lead {
  id: number;
  first_name: string;
  last_name?: string;
  email?: string;
  phone?: string;
  company?: string;
  position?: string;
  status: string;
  source: string;
  score: number;
  estimated_value?: number;
}

interface Deal {
  id: number;
  name: string;
  stage: string;
  amount?: number;
  probability?: number;
  expected_close_date?: string;
}

interface Activity {
  id: number;
  type: string;
  title: string;
  description?: string;
  created_at: string;
  created_by_name?: string;
}

interface Note {
  id: number;
  lead_id: number;
  content: string;
  is_pinned: boolean;
  created_by: number;
  created_by_name?: string;
  created_at: string;
}

interface CrmSidebarProps {
  conversationId: number | null;
  contactName?: string;
  contactPhone?: string;
  contactEmail?: string;
  onCreateLead?: (prefill: { first_name?: string; phone?: string; email?: string; conversation_id?: number }) => void;
}

const STATUS_COLORS: Record<string, string> = {
  new: "bg-blue-100 text-blue-700",
  contacted: "bg-yellow-100 text-yellow-700",
  qualified: "bg-green-100 text-green-700",
  lost: "bg-red-100 text-red-700",
  converted: "bg-purple-100 text-purple-700",
};

const STAGE_COLORS: Record<string, string> = {
  prospect: "bg-gray-100 text-gray-700",
  qualified: "bg-blue-100 text-blue-700",
  proposal: "bg-indigo-100 text-indigo-700",
  negotiation: "bg-yellow-100 text-yellow-700",
  close: "bg-orange-100 text-orange-700",
  won: "bg-green-100 text-green-700",
  lost: "bg-red-100 text-red-700",
};

const ACTIVITY_ICONS: Record<string, string> = {
  call: "📞",
  email: "📧",
  meeting: "📅",
  message: "💬",
  note: "📝",
  task_created: "✅",
  deal_stage_change: "📊",
};

export default function CrmSidebar({
  conversationId,
  contactName,
  contactPhone,
  contactEmail,
  onCreateLead,
}: CrmSidebarProps) {
  const [lead, setLead] = useState<Lead | null>(null);
  const [deals, setDeals] = useState<Deal[]>([]);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [notes, setNotes] = useState<Note[]>([]);
  const [matchCandidates, setMatchCandidates] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newNote, setNewNote] = useState("");
  const [activeTab, setActiveTab] = useState<"overview" | "activity" | "notes">("overview");

  const token = typeof window !== "undefined" ? localStorage.getItem("token") : null;
  const headers = { Authorization: `Bearer ${token}` };

  useEffect(() => {
    if (!conversationId && !contactPhone && !contactName) return;
    fetchLeadData();
  }, [conversationId, contactPhone, contactName]);

  const fetchLeadData = async () => {
    setLoading(true);
    setError(null);
    try {
      // Try by conversation first
      if (conversationId) {
        try {
          const res = await axios.get(`${API_URL}/crm/leads/by-conversation/${conversationId}`, { headers });
          if (res.data) {
            setLead(res.data);
            await loadLeadDetails(res.data.id);
            return;
          }
        } catch {
          // No lead linked to conversation, try auto-match
        }
      }

      // Auto-match by phone/email/name
      const params = new URLSearchParams();
      if (contactPhone) params.set("phone", contactPhone);
      if (contactEmail) params.set("email", contactEmail);
      if (contactName) params.set("name", contactName);

      if (params.toString()) {
        const res = await axios.get(`${API_URL}/crm/leads/auto-match?${params}`, { headers });
        if (res.data.length === 1) {
          setLead(res.data[0]);
          await loadLeadDetails(res.data[0].id);
        } else if (res.data.length > 1) {
          setMatchCandidates(res.data);
        }
      }
    } catch (err) {
      setError("Unable to load CRM data");
    } finally {
      setLoading(false);
    }
  };

  const loadLeadDetails = async (leadId: number) => {
    try {
      const [dealsRes, activitiesRes, notesRes] = await Promise.all([
        axios.get(`${API_URL}/crm/deals?lead_id=${leadId}&limit=5`, { headers }),
        axios.get(`${API_URL}/crm/activities/${leadId}?limit=10`, { headers }),
        axios.get(`${API_URL}/crm/leads/${leadId}/notes`, { headers }),
      ]);
      setDeals(dealsRes.data);
      setActivities(activitiesRes.data);
      setNotes(notesRes.data);
    } catch {
      // Non-critical — lead card still shows
    }
  };

  const selectCandidate = async (candidate: Lead) => {
    setLead(candidate);
    setMatchCandidates([]);
    await loadLeadDetails(candidate.id);
  };

  const handleAddNote = async () => {
    if (!newNote.trim() || !lead) return;
    try {
      const res = await axios.post(
        `${API_URL}/crm/leads/${lead.id}/notes`,
        { content: newNote.trim() },
        { headers }
      );
      setNotes((prev) => [res.data, ...prev]);
      setNewNote("");
    } catch {
      // Silently fail — user can retry
    }
  };

  const togglePin = async (noteId: number, currentPinned: boolean) => {
    try {
      await axios.patch(`${API_URL}/crm/leads/notes/${noteId}`, { is_pinned: !currentPinned }, { headers });
      setNotes((prev) =>
        prev.map((n) => (n.id === noteId ? { ...n, is_pinned: !currentPinned } : n))
          .sort((a, b) => (b.is_pinned ? 1 : 0) - (a.is_pinned ? 1 : 0))
      );
    } catch {}
  };

  const deleteNote = async (noteId: number) => {
    try {
      await axios.delete(`${API_URL}/crm/leads/notes/${noteId}`, { headers });
      setNotes((prev) => prev.filter((n) => n.id !== noteId));
    } catch {}
  };

  if (loading) {
    return (
      <div className="w-80 border-l border-gray-200 bg-gray-50 flex items-center justify-center">
        <div className="text-gray-400 text-sm">Loading CRM data...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="w-80 border-l border-gray-200 bg-gray-50 p-4">
        <div className="text-red-500 text-sm mb-2">{error}</div>
        <button onClick={fetchLeadData} className="text-sm text-blue-600 hover:underline">
          Retry
        </button>
      </div>
    );
  }

  // Multiple candidates
  if (matchCandidates.length > 0) {
    return (
      <div className="w-80 border-l border-gray-200 bg-gray-50 p-4 overflow-y-auto">
        <h3 className="font-semibold text-sm mb-3">Multiple matches found</h3>
        {matchCandidates.map((c) => (
          <button
            key={c.id}
            onClick={() => selectCandidate(c)}
            className="w-full text-left p-3 mb-2 bg-white rounded-lg border hover:border-blue-400 transition"
          >
            <div className="font-medium text-sm">{c.first_name} {c.last_name}</div>
            <div className="text-xs text-gray-500">{c.company || c.email || c.phone}</div>
          </button>
        ))}
      </div>
    );
  }

  // No lead found
  if (!lead) {
    return (
      <div className="w-80 border-l border-gray-200 bg-gray-50 p-4 flex flex-col items-center justify-center">
        <div className="text-gray-400 text-sm mb-3">No CRM contact linked</div>
        <button
          onClick={() =>
            onCreateLead?.({
              first_name: contactName?.split(" ")[0],
              phone: contactPhone,
              email: contactEmail,
              conversation_id: conversationId ?? undefined,
            })
          }
          className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 transition"
        >
          Create Lead
        </button>
      </div>
    );
  }

  // Lead found — full sidebar
  return (
    <div className="w-80 border-l border-gray-200 bg-gray-50 flex flex-col h-full overflow-hidden">
      {/* Contact Card */}
      <div className="p-4 bg-white border-b">
        <div className="flex items-center justify-between mb-2">
          <h3 className="font-semibold text-sm truncate">
            {lead.first_name} {lead.last_name}
          </h3>
          <span className={`text-xs px-2 py-0.5 rounded-full ${STATUS_COLORS[lead.status] || "bg-gray-100"}`}>
            {lead.status}
          </span>
        </div>
        {lead.company && <div className="text-xs text-gray-500">{lead.position ? `${lead.position} at ` : ""}{lead.company}</div>}
        {lead.email && <div className="text-xs text-gray-400 mt-1">{lead.email}</div>}
        {lead.phone && <div className="text-xs text-gray-400">{lead.phone}</div>}
        <div className="flex items-center gap-3 mt-2">
          <span className="text-xs bg-blue-50 text-blue-600 px-2 py-0.5 rounded">Score: {lead.score}</span>
          {lead.estimated_value && (
            <span className="text-xs bg-green-50 text-green-600 px-2 py-0.5 rounded">
              ${lead.estimated_value.toLocaleString()}
            </span>
          )}
        </div>
        <div className="flex gap-2 mt-3">
          <a href={`/admin/crm/leads/${lead.id}/edit`} className="text-xs text-blue-600 hover:underline">Edit</a>
          <a href={`/admin/crm/deals/new?lead_id=${lead.id}`} className="text-xs text-blue-600 hover:underline">+ Deal</a>
          <a href={`/admin/crm/tasks/new?lead_id=${lead.id}`} className="text-xs text-blue-600 hover:underline">+ Task</a>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b bg-white">
        {(["overview", "activity", "notes"] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`flex-1 py-2 text-xs font-medium capitalize ${
              activeTab === tab ? "text-blue-600 border-b-2 border-blue-600" : "text-gray-500 hover:text-gray-700"
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div className="flex-1 overflow-y-auto p-3">
        {activeTab === "overview" && (
          <div className="space-y-3">
            <h4 className="text-xs font-semibold text-gray-500 uppercase">Active Deals</h4>
            {deals.length === 0 ? (
              <div className="text-xs text-gray-400">No active deals</div>
            ) : (
              deals.map((deal) => (
                <a key={deal.id} href={`/admin/crm/deals/${deal.id}`} className="block p-2 bg-white rounded border hover:border-blue-300 transition">
                  <div className="text-sm font-medium truncate">{deal.name}</div>
                  <div className="flex items-center gap-2 mt-1">
                    <span className={`text-xs px-1.5 py-0.5 rounded ${STAGE_COLORS[deal.stage] || "bg-gray-100"}`}>
                      {deal.stage}
                    </span>
                    {deal.amount && <span className="text-xs text-gray-500">${deal.amount.toLocaleString()}</span>}
                    {deal.probability != null && <span className="text-xs text-gray-400">{deal.probability}%</span>}
                  </div>
                </a>
              ))
            )}
          </div>
        )}

        {activeTab === "activity" && (
          <div className="space-y-2">
            {activities.length === 0 ? (
              <div className="text-xs text-gray-400">No recent activity</div>
            ) : (
              activities.map((act) => (
                <div key={act.id} className="flex gap-2 p-2 bg-white rounded border">
                  <span className="text-sm">{ACTIVITY_ICONS[act.type] || "📌"}</span>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-medium truncate">{act.title}</div>
                    {act.description && <div className="text-xs text-gray-400 truncate">{act.description}</div>}
                    <div className="text-xs text-gray-300 mt-0.5">
                      {new Date(act.created_at).toLocaleDateString()}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {activeTab === "notes" && (
          <div className="space-y-2">
            {notes.map((note) => (
              <div key={note.id} className={`p-2 bg-white rounded border ${note.is_pinned ? "border-yellow-300" : ""}`}>
                <div className="flex items-start justify-between">
                  <p className="text-xs text-gray-700 whitespace-pre-wrap flex-1">{note.content}</p>
                  <div className="flex gap-1 ml-2 flex-shrink-0">
                    <button onClick={() => togglePin(note.id, note.is_pinned)} className="text-xs" title={note.is_pinned ? "Unpin" : "Pin"}>
                      {note.is_pinned ? "📌" : "📍"}
                    </button>
                    <button onClick={() => deleteNote(note.id)} className="text-xs text-red-400 hover:text-red-600">×</button>
                  </div>
                </div>
                <div className="text-xs text-gray-400 mt-1">
                  {note.created_by_name} · {new Date(note.created_at).toLocaleDateString()}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Add Note (always visible at bottom when on notes tab) */}
      {activeTab === "notes" && (
        <div className="p-3 border-t bg-white">
          <div className="flex gap-2">
            <input
              type="text"
              value={newNote}
              onChange={(e) => setNewNote(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleAddNote()}
              placeholder="Add a note..."
              className="flex-1 text-xs border rounded px-2 py-1.5 focus:outline-none focus:border-blue-400"
            />
            <button onClick={handleAddNote} className="text-xs bg-blue-600 text-white px-3 py-1.5 rounded hover:bg-blue-700">
              Add
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
```

**Step 2: Verify file created**

Confirm file exists: `ls frontend/components/CrmSidebar.tsx`

**Step 3: Commit**

```bash
git add frontend/components/CrmSidebar.tsx
git commit -m "feat(crm): add CrmSidebar component with auto-match, deals, activity, notes"
```

---

### Task 5: Integrate CrmSidebar into ChatWindow

**Files:**
- Modify: `frontend/components/ChatWindow.tsx`

**Step 1: Import CrmSidebar**

Add import at top of ChatWindow.tsx:

```tsx
import CrmSidebar from "./CrmSidebar";
```

**Step 2: Add sidebar toggle state**

Add alongside existing state variables (near existing `crmCardOpen` state):

```tsx
const [crmSidebarOpen, setCrmSidebarOpen] = useState(true);
```

**Step 3: Add toggle button in the ChatWindow header area**

Find the header/toolbar area of ChatWindow (where conversation controls are). Add a toggle button:

```tsx
<button
  onClick={() => setCrmSidebarOpen((prev) => !prev)}
  className="p-1.5 rounded hover:bg-gray-100 text-sm"
  title={crmSidebarOpen ? "Hide CRM" : "Show CRM"}
>
  {crmSidebarOpen ? "◀ CRM" : "▶ CRM"}
</button>
```

**Step 4: Wrap main content in flex layout with sidebar**

Wrap the ChatWindow's content area to include the sidebar on the right:

```tsx
<div className="flex h-full">
  <div className="flex-1 flex flex-col min-w-0">
    {/* Existing message area and input */}
  </div>
  {crmSidebarOpen && conversation && (
    <CrmSidebar
      conversationId={conversation.id}
      contactName={conversation.contact_name}
      contactPhone={conversation.contact_id}
      onCreateLead={(prefill) => {
        // Open existing lead creation modal with prefill data
        setShowLeadModal(true);
      }}
    />
  )}
</div>
```

**Step 5: Verify in browser**

Open `http://localhost:3000`, select a conversation. The CRM sidebar should appear on the right with auto-match results or "Create Lead" prompt.

**Step 6: Commit**

```bash
git add frontend/components/ChatWindow.tsx
git commit -m "feat(crm): integrate CRM sidebar into ChatWindow"
```

---

## Phase 2: Agent Daily Dashboard

### Task 6: Add My Day backend endpoint

**Files:**
- Modify: `backend/app/routes/crm.py`

**Step 1: Add the dashboard endpoint**

Add a new section in `backend/app/routes/crm.py` (after analytics endpoints):

```python
# ========== DASHBOARD ENDPOINTS ==========

@router.get("/dashboard/my-day")
def get_my_day(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Aggregated daily dashboard for the current agent."""
    from datetime import timedelta
    now = datetime.utcnow()
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    today_end = today_start + timedelta(days=1)
    seven_days_ago = now - timedelta(days=7)
    seven_days_ahead = now + timedelta(days=7)

    # Overdue tasks
    overdue_tasks = (
        db.query(Task)
        .filter(
            Task.assigned_to == current_user.id,
            Task.status.in_([TaskStatus.OPEN, TaskStatus.IN_PROGRESS]),
            Task.due_date < now,
            Task.due_date.isnot(None),
        )
        .order_by(Task.due_date)
        .limit(20)
        .all()
    )

    # Today's tasks
    today_tasks = (
        db.query(Task)
        .filter(
            Task.assigned_to == current_user.id,
            Task.status.in_([TaskStatus.OPEN, TaskStatus.IN_PROGRESS]),
            Task.due_date >= today_start,
            Task.due_date < today_end,
        )
        .order_by(Task.due_date)
        .all()
    )

    # Stale leads (no activity in 7+ days)
    from sqlalchemy import and_, exists, select
    recent_activity_subq = (
        select(Activity.id)
        .where(
            and_(
                Activity.lead_id == Lead.id,
                Activity.created_at >= seven_days_ago,
            )
        )
        .correlate(Lead)
        .exists()
    )
    stale_leads = (
        db.query(Lead)
        .filter(
            Lead.assigned_to == current_user.id,
            Lead.status.in_([LeadStatus.NEW, LeadStatus.CONTACTED, LeadStatus.QUALIFIED]),
            ~recent_activity_subq,
        )
        .limit(20)
        .all()
    )

    # Deals closing soon
    deals_closing_soon = (
        db.query(Deal)
        .filter(
            Deal.assigned_to == current_user.id,
            Deal.stage.notin_([DealStage.WON, DealStage.LOST]),
            Deal.expected_close_date <= seven_days_ahead,
            Deal.expected_close_date >= now,
        )
        .order_by(Deal.expected_close_date)
        .limit(10)
        .all()
    )

    # Recent activity across agent's leads
    agent_lead_ids = [l.id for l in db.query(Lead.id).filter(Lead.assigned_to == current_user.id).all()]
    recent_activity = []
    if agent_lead_ids:
        recent_activity = (
            db.query(Activity)
            .filter(Activity.lead_id.in_(agent_lead_ids))
            .order_by(Activity.created_at.desc())
            .limit(20)
            .all()
        )

    # Stats
    open_leads_count = db.query(Lead).filter(
        Lead.assigned_to == current_user.id,
        Lead.status.in_([LeadStatus.NEW, LeadStatus.CONTACTED, LeadStatus.QUALIFIED]),
    ).count()

    pipeline_value = db.query(func.sum(Deal.amount)).filter(
        Deal.assigned_to == current_user.id,
        Deal.stage.notin_([DealStage.WON, DealStage.LOST]),
    ).scalar() or 0

    tasks_completed_today = db.query(Task).filter(
        Task.assigned_to == current_user.id,
        Task.status == TaskStatus.COMPLETED,
        Task.completed_at >= today_start,
    ).count()

    conversations_active = 0
    try:
        conversations_active = db.query(Conversation).filter(
            Conversation.assigned_to == current_user.id,
            Conversation.status == "open",
        ).count()
    except Exception:
        pass

    return {
        "overdue_tasks": [{"id": t.id, "title": t.title, "due_date": t.due_date.isoformat() if t.due_date else None, "lead_id": t.lead_id, "status": t.status.value} for t in overdue_tasks],
        "today_tasks": [{"id": t.id, "title": t.title, "due_date": t.due_date.isoformat() if t.due_date else None, "lead_id": t.lead_id, "status": t.status.value} for t in today_tasks],
        "stale_leads": [{"id": l.id, "first_name": l.first_name, "last_name": l.last_name, "company": l.company, "status": l.status.value, "score": l.score} for l in stale_leads],
        "deals_closing_soon": [{"id": d.id, "name": d.name, "stage": d.stage.value, "amount": d.amount, "probability": d.probability, "expected_close_date": d.expected_close_date.isoformat() if d.expected_close_date else None} for d in deals_closing_soon],
        "recent_activity": [{"id": a.id, "type": a.type.value, "title": a.title, "description": a.description, "lead_id": a.lead_id, "created_at": a.created_at.isoformat()} for a in recent_activity],
        "stats": {
            "open_leads_count": open_leads_count,
            "pipeline_value": float(pipeline_value),
            "tasks_completed_today": tasks_completed_today,
            "conversations_active": conversations_active,
        },
    }
```

**Step 2: Verify via Swagger**

Test: `GET /crm/dashboard/my-day` — should return JSON with all sections.

**Step 3: Commit**

```bash
git add backend/app/routes/crm.py
git commit -m "feat(crm): add /crm/dashboard/my-day aggregated endpoint"
```

---

### Task 7: Build My Day frontend page

**Files:**
- Create: `frontend/app/dashboard/my-day/page.tsx`

**Step 1: Create the My Day page**

Create `frontend/app/dashboard/my-day/page.tsx`:

```tsx
"use client";
import { useState, useEffect } from "react";
import axios from "axios";
import { useRouter } from "next/navigation";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

interface TaskItem {
  id: number;
  title: string;
  due_date: string | null;
  lead_id: number;
  status: string;
}

interface StaleLead {
  id: number;
  first_name: string;
  last_name?: string;
  company?: string;
  status: string;
  score: number;
}

interface DealItem {
  id: number;
  name: string;
  stage: string;
  amount?: number;
  probability?: number;
  expected_close_date?: string;
}

interface ActivityItem {
  id: number;
  type: string;
  title: string;
  description?: string;
  lead_id: number;
  created_at: string;
}

interface MyDayData {
  overdue_tasks: TaskItem[];
  today_tasks: TaskItem[];
  stale_leads: StaleLead[];
  deals_closing_soon: DealItem[];
  recent_activity: ActivityItem[];
  stats: {
    open_leads_count: number;
    pipeline_value: number;
    tasks_completed_today: number;
    conversations_active: number;
  };
}

const ACTIVITY_ICONS: Record<string, string> = {
  call: "📞", email: "📧", meeting: "📅", message: "💬",
  note: "📝", task_created: "✅", deal_stage_change: "📊",
};

const STAGE_COLORS: Record<string, string> = {
  prospect: "bg-gray-100 text-gray-700",
  qualified: "bg-blue-100 text-blue-700",
  proposal: "bg-indigo-100 text-indigo-700",
  negotiation: "bg-yellow-100 text-yellow-700",
  close: "bg-orange-100 text-orange-700",
  won: "bg-green-100 text-green-700",
  lost: "bg-red-100 text-red-700",
};

export default function MyDayPage() {
  const [data, setData] = useState<MyDayData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const token = typeof window !== "undefined" ? localStorage.getItem("token") : null;

  useEffect(() => {
    fetchMyDay();
  }, []);

  const fetchMyDay = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await axios.get(`${API_URL}/crm/dashboard/my-day`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setData(res.data);
    } catch {
      setError("Failed to load dashboard");
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-gray-400">Loading your day...</div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex flex-col items-center justify-center h-screen gap-4">
        <div className="text-red-500">{error}</div>
        <button onClick={fetchMyDay} className="text-blue-600 hover:underline">Retry</button>
      </div>
    );
  }

  const { stats } = data;

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-7xl mx-auto">
        <h1 className="text-2xl font-bold text-gray-800 mb-6">My Day</h1>

        {/* Stat Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          <StatCard label="Open Leads" value={stats.open_leads_count} color="blue" />
          <StatCard label="Pipeline Value" value={`$${stats.pipeline_value.toLocaleString()}`} color="green" />
          <StatCard label="Tasks Done Today" value={stats.tasks_completed_today} color="purple" />
          <StatCard label="Active Conversations" value={stats.conversations_active} color="orange" />
        </div>

        {/* Two-column layout */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Left: Action Items */}
          <div className="space-y-6">
            {/* Overdue Tasks */}
            <Section title="Overdue Tasks" count={data.overdue_tasks.length} color="red">
              {data.overdue_tasks.length === 0 ? (
                <EmptyState text="No overdue tasks" />
              ) : (
                data.overdue_tasks.map((task) => (
                  <div
                    key={task.id}
                    onClick={() => router.push(`/admin/crm/leads/${task.lead_id}`)}
                    className="p-3 bg-white rounded-lg border border-red-100 hover:border-red-300 cursor-pointer transition"
                  >
                    <div className="text-sm font-medium">{task.title}</div>
                    {task.due_date && (
                      <div className="text-xs text-red-500 mt-1">
                        Due: {new Date(task.due_date).toLocaleDateString()}
                      </div>
                    )}
                  </div>
                ))
              )}
            </Section>

            {/* Today's Tasks */}
            <Section title="Today's Tasks" count={data.today_tasks.length} color="blue">
              {data.today_tasks.length === 0 ? (
                <EmptyState text="No tasks for today" />
              ) : (
                data.today_tasks.map((task) => (
                  <div
                    key={task.id}
                    onClick={() => router.push(`/admin/crm/leads/${task.lead_id}`)}
                    className="p-3 bg-white rounded-lg border hover:border-blue-300 cursor-pointer transition"
                  >
                    <div className="text-sm font-medium">{task.title}</div>
                    <div className="text-xs text-gray-400 mt-1">{task.status}</div>
                  </div>
                ))
              )}
            </Section>

            {/* Stale Leads */}
            <Section title="Stale Leads" count={data.stale_leads.length} color="amber">
              {data.stale_leads.length === 0 ? (
                <EmptyState text="No stale leads" />
              ) : (
                data.stale_leads.map((lead) => (
                  <div
                    key={lead.id}
                    onClick={() => router.push(`/admin/crm/leads/${lead.id}`)}
                    className="p-3 bg-white rounded-lg border border-amber-100 hover:border-amber-300 cursor-pointer transition flex justify-between items-center"
                  >
                    <div>
                      <div className="text-sm font-medium">{lead.first_name} {lead.last_name}</div>
                      {lead.company && <div className="text-xs text-gray-400">{lead.company}</div>}
                    </div>
                    <span className="text-xs bg-amber-50 text-amber-600 px-2 py-0.5 rounded">No activity 7d+</span>
                  </div>
                ))
              )}
            </Section>
          </div>

          {/* Right: Pipeline Watch + Activity */}
          <div className="space-y-6">
            {/* Deals Closing Soon */}
            <Section title="Deals Closing Soon" count={data.deals_closing_soon.length} color="indigo">
              {data.deals_closing_soon.length === 0 ? (
                <EmptyState text="No deals closing soon" />
              ) : (
                data.deals_closing_soon.map((deal) => (
                  <div
                    key={deal.id}
                    onClick={() => router.push(`/admin/crm/deals/${deal.id}`)}
                    className="p-3 bg-white rounded-lg border hover:border-indigo-300 cursor-pointer transition"
                  >
                    <div className="text-sm font-medium">{deal.name}</div>
                    <div className="flex items-center gap-2 mt-1">
                      <span className={`text-xs px-1.5 py-0.5 rounded ${STAGE_COLORS[deal.stage] || "bg-gray-100"}`}>
                        {deal.stage}
                      </span>
                      {deal.amount && <span className="text-xs text-gray-500">${deal.amount.toLocaleString()}</span>}
                      {deal.expected_close_date && (
                        <span className="text-xs text-gray-400">
                          Closes: {new Date(deal.expected_close_date).toLocaleDateString()}
                        </span>
                      )}
                    </div>
                  </div>
                ))
              )}
            </Section>

            {/* Recent Activity */}
            <Section title="Recent Activity" count={data.recent_activity.length} color="gray">
              {data.recent_activity.length === 0 ? (
                <EmptyState text="No recent activity" />
              ) : (
                data.recent_activity.map((act) => (
                  <div
                    key={act.id}
                    onClick={() => router.push(`/admin/crm/leads/${act.lead_id}`)}
                    className="flex gap-2 p-2 bg-white rounded border hover:border-gray-300 cursor-pointer transition"
                  >
                    <span className="text-sm">{ACTIVITY_ICONS[act.type] || "📌"}</span>
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-medium truncate">{act.title}</div>
                      {act.description && <div className="text-xs text-gray-400 truncate">{act.description}</div>}
                      <div className="text-xs text-gray-300 mt-0.5">
                        {new Date(act.created_at).toLocaleDateString()}
                      </div>
                    </div>
                  </div>
                ))
              )}
            </Section>
          </div>
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value, color }: { label: string; value: string | number; color: string }) {
  const colorMap: Record<string, string> = {
    blue: "bg-blue-50 text-blue-700 border-blue-100",
    green: "bg-green-50 text-green-700 border-green-100",
    purple: "bg-purple-50 text-purple-700 border-purple-100",
    orange: "bg-orange-50 text-orange-700 border-orange-100",
  };
  return (
    <div className={`p-4 rounded-xl border ${colorMap[color] || "bg-gray-50"}`}>
      <div className="text-2xl font-bold">{value}</div>
      <div className="text-xs mt-1 opacity-70">{label}</div>
    </div>
  );
}

function Section({ title, count, color, children }: { title: string; count: number; color: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <h2 className="text-sm font-semibold text-gray-700">{title}</h2>
        <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">{count}</span>
      </div>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return <div className="text-xs text-gray-400 py-4 text-center">{text}</div>;
}
```

**Step 2: Verify in browser**

Navigate to `http://localhost:3000/dashboard/my-day` — should show stat cards and sections.

**Step 3: Commit**

```bash
git add frontend/app/dashboard/my-day/page.tsx
git commit -m "feat(crm): add My Day dashboard page"
```

---

### Task 8: Add My Day navigation link

**Files:**
- Modify: `frontend/components/MainHeader.tsx` (or wherever the main navigation/sidebar is)

**Step 1: Find the navigation component**

Search for the sidebar or main navigation that links to `/dashboard`, `/admin/crm`, etc. Add a "My Day" link:

```tsx
<a href="/dashboard/my-day" className="flex items-center gap-2 px-3 py-2 text-sm rounded hover:bg-gray-100">
  📋 My Day
</a>
```

Place it prominently — ideally as the first or second item in the navigation.

**Step 2: Commit**

```bash
git add <navigation-file>
git commit -m "feat(crm): add My Day link to main navigation"
```

---

## Phase 3: Quick Actions & Collaboration

### Task 9: Add lead tags backend support

**Files:**
- Modify: `backend/app/models/crm.py` — add tags column to Lead
- Modify: `backend/main.py` — add migration for tags column
- Modify: `backend/app/schemas/crm.py` — add tags to schemas
- Modify: `backend/app/routes/crm.py` — add tag filter and tags endpoint

**Step 1: Add tags column to Lead model**

In `backend/app/models/crm.py`, add to Lead class imports:

```python
from sqlalchemy import Column, Integer, String, Float, DateTime, ForeignKey, Text, Boolean, Enum, JSON
```

Add to Lead class (after `organization_id`):

```python
    tags = Column(JSON, default=list)
```

**Step 2: Add inline migration**

In `backend/main.py` `_run_inline_migrations()`:

```python
        conn.execute(text(
            "ALTER TABLE leads ADD COLUMN IF NOT EXISTS tags JSON DEFAULT '[]'"
        ))
```

**Step 3: Update schemas**

In `backend/app/schemas/crm.py`, add to `LeadCreate`:
```python
    tags: Optional[list[str]] = []
```

Add to `LeadUpdate`:
```python
    tags: Optional[list[str]] = None
```

Add to `LeadResponse`:
```python
    tags: Optional[list[str]] = []
```

**Step 4: Add tags endpoint and filter**

In `backend/app/routes/crm.py`, add endpoint:

```python
@router.get("/tags")
def get_all_tags(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get all unique tags across leads for autocomplete."""
    leads = db.query(Lead.tags).filter(Lead.tags.isnot(None)).all()
    all_tags = set()
    for (tags,) in leads:
        if isinstance(tags, list):
            all_tags.update(tags)
    return sorted(all_tags)
```

Update `GET /crm/leads` to accept `tag` query parameter and filter:

```python
tag: str = Query(None),
```

Add filter logic:
```python
if tag:
    # PostgreSQL JSON contains
    query = query.filter(Lead.tags.contains([tag]))
```

**Step 5: Commit**

```bash
git add backend/app/models/crm.py backend/main.py backend/app/schemas/crm.py backend/app/routes/crm.py
git commit -m "feat(crm): add tags support to leads with autocomplete endpoint"
```

---

### Task 10: Add bulk operations endpoint

**Files:**
- Modify: `backend/app/routes/crm.py`

**Step 1: Add bulk action endpoint**

```python
@router.post("/leads/bulk")
def bulk_lead_action(
    payload: dict,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Bulk operations: assign, tag, or change status for multiple leads."""
    lead_ids = payload.get("lead_ids", [])
    action = payload.get("action")
    value = payload.get("value")

    if not lead_ids or not action:
        raise HTTPException(status_code=400, detail="lead_ids and action required")

    results = {"success": [], "failed": []}
    leads = db.query(Lead).filter(Lead.id.in_(lead_ids)).all()

    for lead in leads:
        try:
            if action == "assign":
                lead.assigned_to = int(value) if value else None
            elif action == "status":
                lead.status = LeadStatus(value)
            elif action == "add_tag":
                current_tags = lead.tags or []
                if value not in current_tags:
                    lead.tags = current_tags + [value]
            elif action == "remove_tag":
                current_tags = lead.tags or []
                lead.tags = [t for t in current_tags if t != value]
            else:
                results["failed"].append({"id": lead.id, "error": f"Unknown action: {action}"})
                continue
            results["success"].append(lead.id)
        except Exception as e:
            results["failed"].append({"id": lead.id, "error": str(e)})

    db.commit()
    return results
```

**Step 2: Commit**

```bash
git add backend/app/routes/crm.py
git commit -m "feat(crm): add bulk operations endpoint for leads"
```

---

### Task 11: Add contact merge endpoint

**Files:**
- Modify: `backend/app/routes/crm.py`

**Step 1: Add merge endpoint**

```python
@router.post("/leads/merge")
def merge_leads(
    payload: dict,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Merge secondary lead into primary. Moves all related records."""
    primary_id = payload.get("primary_lead_id")
    secondary_id = payload.get("secondary_lead_id")

    if not primary_id or not secondary_id or primary_id == secondary_id:
        raise HTTPException(status_code=400, detail="Two different lead IDs required")

    primary = db.query(Lead).filter(Lead.id == primary_id).first()
    secondary = db.query(Lead).filter(Lead.id == secondary_id).first()

    if not primary or not secondary:
        raise HTTPException(status_code=404, detail="One or both leads not found")

    # Fill in blank fields on primary from secondary
    for field in ["last_name", "email", "phone", "company", "position", "estimated_value", "organization_id"]:
        if not getattr(primary, field) and getattr(secondary, field):
            setattr(primary, field, getattr(secondary, field))

    # Merge tags
    primary_tags = primary.tags or []
    secondary_tags = secondary.tags or []
    primary.tags = list(set(primary_tags + secondary_tags))

    # Move related records
    db.query(Deal).filter(Deal.lead_id == secondary_id).update({"lead_id": primary_id})
    db.query(Task).filter(Task.lead_id == secondary_id).update({"lead_id": primary_id})
    db.query(Activity).filter(Activity.lead_id == secondary_id).update({"lead_id": primary_id})
    db.query(LeadNote).filter(LeadNote.lead_id == secondary_id).update({"lead_id": primary_id})

    # Log merge activity
    merge_activity = Activity(
        lead_id=primary_id,
        type=ActivityType.NOTE,
        title=f"Merged with lead #{secondary_id} ({secondary.first_name} {secondary.last_name or ''})",
        description=f"All deals, tasks, activities, and notes transferred from lead #{secondary_id}",
        created_by=current_user.id,
    )
    db.add(merge_activity)

    # Delete secondary
    db.delete(secondary)
    db.commit()

    return {"detail": f"Lead #{secondary_id} merged into #{primary_id}", "primary_lead_id": primary_id}
```

**Step 2: Commit**

```bash
git add backend/app/routes/crm.py
git commit -m "feat(crm): add lead merge endpoint"
```

---

### Task 12: Add tag input and bulk actions to leads list frontend

**Files:**
- Modify: `frontend/app/admin/crm/leads/page.tsx`

**Step 1: Add checkbox column to table**

Add state for selected leads:
```tsx
const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
const [showBulkBar, setShowBulkBar] = useState(false);
```

Add checkbox to table header:
```tsx
<th className="w-8">
  <input
    type="checkbox"
    onChange={(e) => {
      if (e.target.checked) {
        setSelectedIds(new Set(leads.map((l) => l.id)));
      } else {
        setSelectedIds(new Set());
      }
    }}
  />
</th>
```

Add checkbox to each row:
```tsx
<td>
  <input
    type="checkbox"
    checked={selectedIds.has(lead.id)}
    onChange={(e) => {
      const next = new Set(selectedIds);
      e.target.checked ? next.add(lead.id) : next.delete(lead.id);
      setSelectedIds(next);
    }}
  />
</td>
```

**Step 2: Add bulk action toolbar**

Show when selectedIds.size > 0:
```tsx
{selectedIds.size > 0 && (
  <div className="flex items-center gap-3 p-3 bg-blue-50 rounded-lg mb-4">
    <span className="text-sm font-medium">{selectedIds.size} selected</span>
    <select
      onChange={async (e) => {
        const action = e.target.value;
        if (!action) return;
        const value = prompt(`Enter value for ${action}:`);
        if (value === null) return;
        await axios.post(`${API_URL}/crm/leads/bulk`, {
          lead_ids: Array.from(selectedIds),
          action,
          value,
        }, { headers: { Authorization: `Bearer ${token}` } });
        setSelectedIds(new Set());
        fetchLeads();
      }}
      className="text-sm border rounded px-2 py-1"
      defaultValue=""
    >
      <option value="">Bulk action...</option>
      <option value="status">Change status</option>
      <option value="assign">Assign to</option>
      <option value="add_tag">Add tag</option>
      <option value="remove_tag">Remove tag</option>
    </select>
  </div>
)}
```

**Step 3: Add tag filter**

Add tag filter alongside existing status filter:
```tsx
const [tagFilter, setTagFilter] = useState("");
const [availableTags, setAvailableTags] = useState<string[]>([]);

// Fetch tags on mount
useEffect(() => {
  axios.get(`${API_URL}/crm/tags`, { headers: { Authorization: `Bearer ${token}` } })
    .then((res) => setAvailableTags(res.data))
    .catch(() => {});
}, []);
```

Add tag filter UI:
```tsx
<select
  value={tagFilter}
  onChange={(e) => { setTagFilter(e.target.value); }}
  className="text-sm border rounded px-2 py-1"
>
  <option value="">All tags</option>
  {availableTags.map((tag) => (
    <option key={tag} value={tag}>{tag}</option>
  ))}
</select>
```

Update fetchLeads to include tag filter:
```tsx
if (tagFilter) params.set("tag", tagFilter);
```

**Step 4: Display tags on each lead row**

Add a tags column showing lead tags as chips:
```tsx
<td>
  <div className="flex flex-wrap gap-1">
    {(lead.tags || []).map((tag: string) => (
      <span key={tag} className="text-xs bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded">{tag}</span>
    ))}
  </div>
</td>
```

**Step 5: Commit**

```bash
git add frontend/app/admin/crm/leads/page.tsx
git commit -m "feat(crm): add tag filter, bulk operations, and checkboxes to leads list"
```

---

### Task 13: Add merge UI to lead detail page

**Files:**
- Modify: `frontend/app/admin/crm/leads/[id]/page.tsx`

**Step 1: Add merge button and modal**

Add state:
```tsx
const [showMergeModal, setShowMergeModal] = useState(false);
const [mergeTargetId, setMergeTargetId] = useState("");
```

Add button in the lead detail actions area:
```tsx
<button
  onClick={() => setShowMergeModal(true)}
  className="text-sm px-3 py-1.5 border border-orange-300 text-orange-600 rounded hover:bg-orange-50"
>
  Merge Lead
</button>
```

Add merge modal:
```tsx
{showMergeModal && (
  <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
    <div className="bg-white rounded-xl p-6 w-96">
      <h3 className="font-semibold mb-4">Merge Lead</h3>
      <p className="text-sm text-gray-500 mb-3">
        Enter the ID of the lead to merge INTO this one. All their deals, tasks, and notes will be transferred here.
      </p>
      <input
        type="number"
        value={mergeTargetId}
        onChange={(e) => setMergeTargetId(e.target.value)}
        placeholder="Secondary lead ID"
        className="w-full border rounded px-3 py-2 mb-4"
      />
      <p className="text-xs text-red-500 mb-4">This action cannot be undone. The secondary lead will be deleted.</p>
      <div className="flex gap-2 justify-end">
        <button onClick={() => setShowMergeModal(false)} className="text-sm px-4 py-2 border rounded">Cancel</button>
        <button
          onClick={async () => {
            if (!mergeTargetId) return;
            try {
              await axios.post(`${API_URL}/crm/leads/merge`, {
                primary_lead_id: lead.id,
                secondary_lead_id: parseInt(mergeTargetId),
              }, { headers: { Authorization: `Bearer ${token}` } });
              setShowMergeModal(false);
              // Refresh lead data
              fetchLead();
            } catch (err: any) {
              alert(err.response?.data?.detail || "Merge failed");
            }
          }}
          className="text-sm px-4 py-2 bg-orange-600 text-white rounded hover:bg-orange-700"
        >
          Merge
        </button>
      </div>
    </div>
  </div>
)}
```

**Step 2: Commit**

```bash
git add frontend/app/admin/crm/leads/[id]/page.tsx
git commit -m "feat(crm): add merge UI to lead detail page"
```

---

### Task 14: Final verification and cleanup commit

**Step 1: Start both services**

```bash
./start.sh
```

**Step 2: Verify backend endpoints via Swagger**

Open `http://localhost:8000/docs` and test:
- `GET /crm/leads/auto-match?name=test` — returns matches or empty array
- `POST /crm/leads/{id}/notes` — creates a note
- `GET /crm/leads/{id}/notes` — returns notes list
- `GET /crm/dashboard/my-day` — returns aggregated dashboard data
- `GET /crm/tags` — returns unique tags list
- `POST /crm/leads/bulk` — performs bulk operation
- `POST /crm/leads/merge` — merges two leads

**Step 3: Verify frontend in browser**

- Open conversation in dashboard → CRM sidebar shows on right
- Navigate to `/dashboard/my-day` → stats and sections render
- Visit `/admin/crm/leads` → checkboxes, tag filter, bulk bar visible
- Visit lead detail → "Merge Lead" button present

**Step 4: Final commit if any fixes needed**

```bash
git add -A
git commit -m "fix(crm): address issues found during verification"
```
