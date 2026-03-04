# CRM Complete System Design

**Date:** 2026-03-04
**Status:** Approved
**Scope:** Five-phase CRM enhancement delivering a complete CRM system on top of the existing lead/deal/task/activity foundation.

---

## Overview

Five phases, each fully working end-to-end before the next starts:

| Phase | Scope | New Models | New Pages |
|---|---|---|---|
| 1 | Complete in-progress features | None | None |
| 2 | Contacts & Companies | None (enhance existing) | `/admin/crm/companies/` |
| 3 | Pipeline & Forecasting | None | Enhance analytics |
| 4 | Automation & Workflows | AutomationRule, EmailSequence, EmailSequenceStep, EmailSequenceEnrollment | `/admin/crm/automation/` |
| 5 | Reporting & Insights | None | `/admin/crm/reports/` |

**Stack:** FastAPI + SQLAlchemy (backend), Next.js 14 App Router + TailwindCSS (frontend). No Alembic — all schema changes via inline SQL in `main.py`.

---

## Phase 1: Complete In-Progress

Execute the existing plan at `docs/plans/2026-03-02-crm-enhancements.md` exactly as written.

**Tasks:**
1. `GET /crm/leads/by-conversation/{id}` endpoint
2. Lead scoring service (`crm_scoring.py`)
3. CRM event types + broadcast on lead assignment and deal stage change
4. `CRM_TASK_OVERDUE` APScheduler background job (5 min)
5. CRM contact card panel in `ChatWindow`
6. AdminNav CRM badge counter
7. Toast notifications in `MainHeader`

**Files touched:** `backend/app/routes/crm.py`, `backend/app/services/crm_scoring.py`, `backend/app/services/events_service.py`, `backend/main.py`, `frontend/components/ChatWindow.tsx`, `frontend/components/AdminNav.tsx`, `frontend/components/MainHeader.tsx`

---

## Phase 2: Contacts & Companies

### Backend

**Schema changes (inline SQL in `main.py`):**
```sql
-- organizations enhancements
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS industry VARCHAR;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS company_size VARCHAR;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS website VARCHAR;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS annual_revenue FLOAT;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS tags JSON DEFAULT '[]';

-- organization_contacts enhancements
ALTER TABLE organization_contacts ADD COLUMN IF NOT EXISTS notes TEXT;
ALTER TABLE organization_contacts ADD COLUMN IF NOT EXISTS lead_id INTEGER REFERENCES leads(id) ON DELETE SET NULL;
```

**Model updates** (`backend/app/models/organization.py`):
- Add new columns to `Organization` and `OrganizationContact`
- Add `leads = relationship("Lead", back_populates="organization")` on `Organization`
- Add `lead = relationship("Lead")` on `OrganizationContact`

**Lead model** (`backend/app/models/crm.py`):
- Add `organization = relationship("Organization", back_populates="leads")` (FK already exists)

**New routes** (`backend/app/routes/crm_organizations.py`):
- `GET /crm/organizations` — list, search by name, filter by industry, includes lead_count + contact_count
- `POST /crm/organizations` — create
- `GET /crm/organizations/{id}` — detail with contacts list + linked leads list
- `PATCH /crm/organizations/{id}` — update
- `DELETE /crm/organizations/{id}` — delete (only if no linked leads)
- `POST /crm/organizations/{id}/contacts` — add contact
- `PATCH /crm/organizations/{id}/contacts/{contact_id}` — update contact
- `DELETE /crm/organizations/{id}/contacts/{contact_id}` — remove contact

**Schemas** (`backend/app/schemas/crm_organizations.py`):
- `OrganizationCreate`, `OrganizationUpdate`, `OrganizationResponse`, `OrganizationDetailResponse`
- `OrganizationContactCreate`, `OrganizationContactUpdate`, `OrganizationContactResponse`

### Frontend

**New pages:**
- `/admin/crm/companies/page.tsx` — paginated list, search, industry filter, lead count + contact count badges
- `/admin/crm/companies/new/page.tsx` — create form
- `/admin/crm/companies/[id]/page.tsx` — detail: Info tab, Contacts tab, Leads tab

**Enhancements:**
- Lead create/edit forms: add company dropdown (async search of organizations)
- AdminNav: add "Companies" link under CRM section

---

## Phase 3: Pipeline & Forecasting

### Backend

New endpoints added to `backend/app/routes/crm.py` under `/crm/analytics/`:

| Endpoint | Description |
|---|---|
| `GET /crm/analytics/forecast?months=6` | Probability-weighted revenue per month. Groups active deals by `expected_close_date`, multiplies `amount × (probability/100)`. Returns array of `{month, forecasted, pipeline_count}`. |
| `GET /crm/analytics/win-loss?days=90` | Win rate, loss rate, counts, avg deal value by outcome for the given lookback period. |
| `GET /crm/analytics/deal-velocity` | Average days deals spend in each stage. Computed from activity timestamps of stage-change activities. |
| `GET /crm/analytics/conversion-funnel` | Lead → Deal created → Deal won conversion percentages. |

### Frontend

Enhance `/admin/crm/analytics/page.tsx` with four new chart sections below existing charts:
- **Revenue Forecast** — bar chart, months on x-axis, forecasted revenue on y-axis
- **Win/Loss Ratio** — donut chart with win%, loss%, in-progress%
- **Deal Velocity** — horizontal bar chart, avg days per stage
- **Conversion Funnel** — stepped bar or funnel showing drop-off rates

---

## Phase 4: Automation & Workflows

### Backend

**New models** (`backend/app/models/automation.py`):

```python
class AutomationRule:
    id, name, description
    trigger_type: Enum(lead_created, no_activity_X_days, score_below, deal_stage_change, lead_status_change)
    conditions: JSON  # e.g. {"status": "new", "days": 3}
    actions: JSON     # e.g. [{"type": "assign_lead", "user_id": 2}, {"type": "create_task", "title": "Follow up"}]
    is_active: Boolean
    last_run_at: DateTime
    created_by: FK(users)

class EmailSequence:
    id, name, description, is_active, created_by

class EmailSequenceStep:
    id, sequence_id, step_order, delay_days, subject, body_html

class EmailSequenceEnrollment:
    id, sequence_id, lead_id
    status: Enum(active, paused, completed, failed)
    current_step: Integer
    enrolled_at, next_send_at, completed_at
```

**Schema changes (inline SQL in `main.py`):** Create four new tables.

**New routes** (`backend/app/routes/automation.py`):
- Full CRUD for AutomationRule, EmailSequence (with nested steps), EmailSequenceEnrollment
- `POST /automation/sequences/{id}/enroll` — enroll a lead in a sequence
- `POST /automation/sequences/{id}/unenroll/{lead_id}` — remove from sequence

**Background jobs** in `main.py`:
- `evaluate_automation_rules()` every 5 min — load active rules, evaluate each against matching leads, execute actions, update `last_triggered_at` per rule per lead (stored in JSON to prevent re-triggering)
- `process_email_sequences()` every 1 min — find enrollments where `next_send_at <= now` and `status = active`, send email via existing SMTP service, advance `current_step`, update `next_send_at`

**Supported actions:**
- `assign_lead` — set `lead.assigned_to`
- `create_task` — create a CRM task on the lead
- `enroll_in_sequence` — enroll lead in specified email sequence
- `change_lead_status` — update lead status
- `send_notification` — broadcast SSE notification to assigned agent

### Frontend

**New page:** `/admin/crm/automation/page.tsx` — two tabs:

**Rules tab:**
- List of rules with active/inactive toggle, last run time
- Create/edit rule: trigger type dropdown → dynamic condition fields → action builder (add multiple actions)

**Sequences tab:**
- List of sequences with enrollment count, active/inactive toggle
- Create/edit sequence → add steps: step order, delay (days), subject, body (textarea)
- Per-sequence enrollment list showing lead name + current step + status

---

## Phase 5: Reporting & Insights

### Backend

New routes (`backend/app/routes/crm_reports.py`):

| Endpoint | Description |
|---|---|
| `GET /crm/reports/agent-performance?days=30` | Per agent: leads_assigned, deals_closed, win_rate, avg_deal_value, total_revenue |
| `GET /crm/reports/lead-aging` | Per lead status: count, avg_age_days, oldest_lead_days |
| `GET /crm/reports/revenue?period=monthly&months=6` | Actual closed revenue by month (won deals) + forecasted side by side |
| `GET /crm/reports/export?type=leads\|deals\|tasks&from=&to=` | StreamingResponse returning CSV |

### Frontend

**New page:** `/admin/crm/reports/page.tsx` — four tabs:

| Tab | Content |
|---|---|
| Agent Performance | Table (sortable) + bar chart: deals closed, win rate, revenue per agent |
| Lead Aging | Table: status, count, avg age (color-coded: green <7d, yellow 7-30d, red >30d) |
| Revenue | Dual-line chart: actual vs forecasted revenue by month |
| Export | Date range picker + buttons: Export Leads CSV, Export Deals CSV, Export Tasks CSV |

**AdminNav:** Add "Reports" link under CRM section.

---

## File Inventory

### New Files
| File | Phase |
|---|---|
| `backend/app/services/crm_scoring.py` | 1 |
| `backend/app/routes/crm_organizations.py` | 2 |
| `backend/app/schemas/crm_organizations.py` | 2 |
| `backend/app/models/automation.py` | 4 |
| `backend/app/routes/automation.py` | 4 |
| `backend/app/schemas/automation.py` | 4 |
| `backend/app/routes/crm_reports.py` | 5 |
| `frontend/app/admin/crm/companies/page.tsx` | 2 |
| `frontend/app/admin/crm/companies/new/page.tsx` | 2 |
| `frontend/app/admin/crm/companies/[id]/page.tsx` | 2 |
| `frontend/app/admin/crm/automation/page.tsx` | 4 |
| `frontend/app/admin/crm/reports/page.tsx` | 5 |

### Modified Files
| File | Phases |
|---|---|
| `backend/app/routes/crm.py` | 1, 3 |
| `backend/app/services/events_service.py` | 1 |
| `backend/app/models/organization.py` | 2 |
| `backend/app/models/crm.py` | 2 |
| `backend/main.py` | 1, 2, 4 |
| `frontend/components/ChatWindow.tsx` | 1 |
| `frontend/components/AdminNav.tsx` | 1, 2, 5 |
| `frontend/components/MainHeader.tsx` | 1 |
| `frontend/app/admin/crm/analytics/page.tsx` | 3 |
| `frontend/app/admin/crm/leads/new/page.tsx` | 2 |
| `frontend/app/admin/crm/leads/[id]/edit/page.tsx` | 2 |
