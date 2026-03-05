# CRM Office Execution Enhancement — Design Document

**Date**: 2026-03-05
**Status**: Approved
**Goal**: Improve daily agent/team productivity by reducing context switching, manual data entry, and collaboration friction in the CRM.

---

## Problem Statement

The CRM has solid data structures (leads, deals, tasks, activities, organizations, analytics, automation) but lacks workflow ergonomics for daily agent use:

1. **Context switching** — Agents jump between chat window and CRM pages to see customer info
2. **Manual data entry** — Too many clicks to create leads, log activities, or link conversations
3. **No quick overview** — No single view of "what needs attention today"
4. **Collaboration gaps** — No persistent notes on contacts, no shared context on reassignment

## Phased Approach

### Phase 1: Smart Customer Sidebar in Chat (Highest Priority)

#### Backend

**New model — `LeadNote`:**
- `id` (PK), `lead_id` (FK → leads), `content` (text), `created_by` (FK → users), `is_pinned` (boolean, default false), `created_at`, `updated_at`
- Table: `crm_lead_notes`

**New endpoints:**
- `GET /crm/leads/auto-match?phone=&email=&name=` — returns matching lead(s) by exact phone/email, fallback to name
- `GET /crm/leads/{lead_id}/notes` — list notes for a lead
- `POST /crm/leads/{lead_id}/notes` — create a note (body: `{ content, is_pinned? }`)
- `PATCH /crm/leads/notes/{note_id}` — update note content or pin status
- `DELETE /crm/leads/notes/{note_id}` — delete a note

#### Frontend

**New component — `CrmSidebar`:**
- Right-side collapsible panel (~350px) inside ChatWindow layout
- Toggle button in ChatWindow header; default collapsed on mobile, expanded on desktop
- Sections:
  - **Contact card**: Name, company, position, lead score badge, status, source
  - **Deal summary**: Active deals as compact cards (stage, amount, probability)
  - **Activity timeline**: Last 10 activities, scrollable, with type icons
  - **Notes**: List + "Add note" input at bottom
  - **Quick actions**: "Edit Lead", "Create Deal", "Add Task" buttons

**Auto-match flow:**
1. Conversation opens → sidebar calls `/crm/leads/auto-match` with contact phone/name
2. Match found → load full lead data (deals, tasks, activities, notes)
3. No match → show "Create Lead from Conversation" card pre-filled with conversation data
4. Multiple matches → show candidate list, agent picks

#### Error Handling
- No match: empty state with "Create Lead" CTA
- Multiple matches: compact candidate list for agent selection
- API failure: "Unable to load CRM data" with retry; chat continues working

---

### Phase 2: Agent Daily Dashboard ("My Day")

#### Backend

**New endpoint — `GET /crm/dashboard/my-day`:**

Single aggregated response for the logged-in agent:
```json
{
  "overdue_tasks": [...],        // CRM tasks past due_date, not completed
  "today_tasks": [...],          // Tasks due today
  "stale_leads": [...],          // Assigned leads, no activity in 7+ days
  "deals_closing_soon": [...],   // Deals with expected_close_date within 7 days
  "recent_activity": [...],      // Last 20 activities across agent's leads
  "stats": {
    "open_leads_count": 12,
    "pipeline_value": 45000.00,
    "tasks_completed_today": 3,
    "conversations_active": 5
  }
}
```

**Optional — `GET /crm/dashboard/team-feed`:**
- Recent activity across entire team (for managers)

#### Frontend

**New page — `frontend/app/dashboard/my-day/page.tsx`:**
- **Top row**: 4 stat cards (open leads, pipeline value, tasks done today, active conversations)
- **Left column**: "Action Items" — overdue tasks (red), today's tasks, stale leads (amber)
- **Right column**: "Pipeline Watch" — deals closing soon + recent activity feed
- Each item clickable: tasks open in modal, leads/deals navigate to detail page
- Stale leads have inline "Log Activity" quick action

**Navigation**: "My Day" link in dashboard sidebar (prominent position).

#### Error Handling
- Empty sections: positive messaging ("No overdue tasks")
- API failure: retry button
- Stale threshold: hardcode 7 days initially, configurable later

---

### Phase 3: Quick Actions & Collaboration

#### 3A: Auto-Linking Conversations to Leads

**Backend:**
- Service function `auto_link_conversation_to_lead(conversation)` — exact match on phone, then email, then name
- Called on new conversation creation or when unlinked conversation is opened
- Creates activity log entry on successful link

**Frontend:**
- Confirmation banner in CrmSidebar: "Matched to [Name] — Confirm / Wrong match?"
- Agent confirms or dismisses; prevents silent false positives

#### 3B: Lead Tags

**Backend:**
- Add `tags` column (JSON array) to `leads` table via inline migration
- Update lead CRUD to support tag read/write
- `GET /crm/tags` — unique tags across all leads (for autocomplete)
- `GET /crm/leads?tag=` — filter by tag

**Frontend:**
- Chip-style tag input with autocomplete on lead detail/edit forms
- Tag filter chips on leads list page

#### 3C: Bulk Operations

**Backend:**
- `POST /crm/leads/bulk` — `{ lead_ids: [], action: "assign"|"tag"|"status", value: ... }`
- Returns per-lead success/failure status

**Frontend:**
- Checkbox column on leads list table
- Bulk action toolbar on selection: "Assign to...", "Add tag...", "Change status..."

#### 3D: Contact Merge

**Backend:**
- `POST /crm/leads/merge` — `{ primary_lead_id, secondary_lead_id }`
- Moves all deals, tasks, activities, notes from secondary → primary
- Primary's fields win; secondary's non-null fields fill blanks
- Soft-delete secondary (30-day retention)

**Frontend:**
- "Merge" button on lead detail (manual trigger)
- Side-by-side comparison modal; agent picks values for conflicts
- "This cannot be undone" confirmation dialog

#### 3E: Enhanced Collaboration Notes

Building on Phase 1's LeadNote model:
- `@mention` support: `@user_id` in note text → rendered as clickable agent name
- SSE notification when agent is @mentioned (via existing events system)
- Pin notes: `is_pinned` field; pinned notes appear at top of sidebar

---

## New Database Objects Summary

| Object | Type | Phase |
|---|---|---|
| `crm_lead_notes` | Table | 1 |
| `leads.tags` | Column (JSON) | 3B |

## New API Endpoints Summary

| Endpoint | Method | Phase |
|---|---|---|
| `/crm/leads/auto-match` | GET | 1 |
| `/crm/leads/{id}/notes` | GET, POST | 1 |
| `/crm/leads/notes/{id}` | PATCH, DELETE | 1 |
| `/crm/dashboard/my-day` | GET | 2 |
| `/crm/dashboard/team-feed` | GET | 2 |
| `/crm/tags` | GET | 3B |
| `/crm/leads/bulk` | POST | 3C |
| `/crm/leads/merge` | POST | 3D |

## New Frontend Pages/Components Summary

| Component/Page | Phase |
|---|---|
| `CrmSidebar` (in ChatWindow) | 1 |
| `LeadNotes` component | 1 |
| `app/dashboard/my-day/page.tsx` | 2 |
| Tag input component | 3B |
| Bulk action toolbar | 3C |
| Merge comparison modal | 3D |
