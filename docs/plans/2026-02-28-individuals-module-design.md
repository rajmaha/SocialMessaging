# Individuals Module Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add an "Individuals" CRUD module with admin UI, and integrate it with the ticket creation form — including enhanced caller lookup and auto-insert on ticket creation.

**Architecture:** New `Individual` SQLAlchemy model + FastAPI CRUD routes following the same patterns as Organizations. Ticket model gets 3 new columns. The `/api/tickets/context/{phone}` endpoint is enhanced to also search individuals. Ticket creation auto-inserts new org/individual records when caller is unknown.

**Tech Stack:** FastAPI, SQLAlchemy, PostgreSQL, Next.js 14, TailwindCSS, Axios

---

### Task 1: Backend — Individual Model

**Files:**
- Create: `backend/app/models/individual.py`

**Step 1: Create the Individual model**

```python
from sqlalchemy import Column, Integer, String, Text, DateTime, JSON, Date
from datetime import datetime
from app.database import Base

class Individual(Base):
    __tablename__ = "individuals"

    id = Column(Integer, primary_key=True, index=True)
    full_name = Column(String, index=True, nullable=False)
    gender = Column(String, nullable=False)  # Male, Female, Other
    dob = Column(Date, nullable=True)
    phone_numbers = Column(JSON, default=list)
    address = Column(Text, nullable=True)
    email = Column(String, nullable=True)
    social_media = Column(JSON, default=list)  # [{"platform": "Facebook", "url": "..."}]
    is_active = Column(Integer, default=1)

    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
```

**Step 2: Commit**

```bash
git add backend/app/models/individual.py
git commit -m "feat: add Individual SQLAlchemy model"
```

---

### Task 2: Backend — Individual Schemas

**Files:**
- Create: `backend/app/schemas/individual.py`

**Step 1: Create Pydantic schemas**

```python
from pydantic import BaseModel, ConfigDict
from typing import Optional, List, Any
from datetime import datetime, date

class SocialMediaEntry(BaseModel):
    platform: str
    url: str

class IndividualBase(BaseModel):
    full_name: str
    gender: str
    dob: Optional[date] = None
    phone_numbers: Optional[List[str]] = []
    address: Optional[str] = None
    email: Optional[str] = None
    social_media: Optional[List[SocialMediaEntry]] = []
    is_active: int = 1

class IndividualCreate(IndividualBase):
    pass

class IndividualUpdate(BaseModel):
    full_name: Optional[str] = None
    gender: Optional[str] = None
    dob: Optional[date] = None
    phone_numbers: Optional[List[str]] = None
    address: Optional[str] = None
    email: Optional[str] = None
    social_media: Optional[List[SocialMediaEntry]] = None
    is_active: Optional[int] = None

class IndividualResponse(IndividualBase):
    id: int
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)
```

**Step 2: Commit**

```bash
git add backend/app/schemas/individual.py
git commit -m "feat: add Individual Pydantic schemas"
```

---

### Task 3: Backend — Individual CRUD Routes

**Files:**
- Create: `backend/app/routes/individuals.py`

**Step 1: Create CRUD routes**

```python
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List, Optional

from app.database import get_db
from app.models.individual import Individual
from app.schemas.individual import IndividualCreate, IndividualUpdate, IndividualResponse
from app.dependencies import get_current_user, require_module
from app.models.user import User

router = APIRouter(prefix="/individuals", tags=["individuals"])

require_individuals = require_module("module_individuals")

@router.post("/", response_model=IndividualResponse)
def create_individual(
    individual: IndividualCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_individuals)
):
    db_individual = Individual(**individual.model_dump())
    db.add(db_individual)
    db.commit()
    db.refresh(db_individual)
    return db_individual

@router.get("/", response_model=List[IndividualResponse])
def list_individuals(
    skip: int = 0,
    limit: int = 100,
    search: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_individuals)
):
    query = db.query(Individual)
    if search:
        query = query.filter(Individual.full_name.ilike(f"%{search}%"))
    return query.offset(skip).limit(limit).all()

@router.get("/{individual_id}", response_model=IndividualResponse)
def get_individual(
    individual_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_individuals)
):
    individual = db.query(Individual).filter(Individual.id == individual_id).first()
    if not individual:
        raise HTTPException(status_code=404, detail="Individual not found")
    return individual

@router.put("/{individual_id}", response_model=IndividualResponse)
def update_individual(
    individual_id: int,
    individual_update: IndividualUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_individuals)
):
    db_individual = db.query(Individual).filter(Individual.id == individual_id).first()
    if not db_individual:
        raise HTTPException(status_code=404, detail="Individual not found")

    update_data = individual_update.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(db_individual, key, value)

    db.commit()
    db.refresh(db_individual)
    return db_individual

@router.delete("/{individual_id}")
def delete_individual(
    individual_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_individuals)
):
    db_individual = db.query(Individual).filter(Individual.id == individual_id).first()
    if not db_individual:
        raise HTTPException(status_code=404, detail="Individual not found")

    db.delete(db_individual)
    db.commit()
    return {"status": "success", "message": "Individual deleted"}
```

**Step 2: Commit**

```bash
git add backend/app/routes/individuals.py
git commit -m "feat: add Individual CRUD routes"
```

---

### Task 4: Backend — Register Router + Inline Migration

**Files:**
- Modify: `backend/main.py:6` (import line)
- Modify: `backend/main.py:520` (router registration area)
- Modify: `backend/main.py:24-329` (inline migrations section)

**Step 1: Add import**

In `main.py` line 6, add `individuals` to the import:
```python
from app.routes import messages, conversations, auth, accounts, admin, branding, email, events, webchat, bot, webhooks, teams, reports, call_center, telephony, calls, extensions, agent_workspace, reminders, notifications, tickets, dynamic_fields, organizations, cloudpanel, cloudpanel_templates, individuals
```

**Step 2: Register router**

After line 522 (`app.include_router(cloudpanel_templates.router)`), add:
```python
app.include_router(individuals.router)
```

**Step 3: Add inline migration for individuals table columns (safety net)**

Inside `_run_inline_migrations()`, before the final `conn.commit()` on line 328, add:
```python
        # Individuals table (created by SQLAlchemy create_all, but belt-and-suspenders)
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS individuals (
                id SERIAL PRIMARY KEY,
                full_name VARCHAR NOT NULL,
                gender VARCHAR NOT NULL,
                dob DATE,
                phone_numbers JSON DEFAULT '[]',
                address TEXT,
                email VARCHAR,
                social_media JSON DEFAULT '[]',
                is_active INTEGER DEFAULT 1,
                created_at TIMESTAMP DEFAULT NOW(),
                updated_at TIMESTAMP DEFAULT NOW()
            )
        """))
```

**Step 4: Commit**

```bash
git add backend/main.py
git commit -m "feat: register individuals router and add migration"
```

---

### Task 5: Backend — Add Ticket Model Columns

**Files:**
- Modify: `backend/app/models/ticket.py:27` (after customer_gender column)
- Modify: `backend/app/schemas/ticket.py` (all 3 schema classes)
- Modify: `backend/main.py` (inline migration)

**Step 1: Add columns to Ticket model**

In `backend/app/models/ticket.py`, after `customer_gender` (line 28), add:
```python
    customer_type = Column(String, nullable=True)  # individual / organization
    contact_person = Column(String, nullable=True)
    customer_email = Column(String, nullable=True)
```

**Step 2: Update TicketBase schema**

In `backend/app/schemas/ticket.py`, add to `TicketBase` after `customer_gender`:
```python
    customer_type: Optional[str] = None
    contact_person: Optional[str] = None
    customer_email: Optional[str] = None
```

**Step 3: Update TicketUpdate schema**

Add the same 3 fields to `TicketUpdate`:
```python
    customer_type: Optional[str] = None
    contact_person: Optional[str] = None
    customer_email: Optional[str] = None
```

**Step 4: Add inline migration in main.py**

Inside `_run_inline_migrations()`, add:
```python
        # Ticket new columns for customer type, contact person, email
        conn.execute(text("ALTER TABLE tickets ADD COLUMN IF NOT EXISTS customer_type VARCHAR"))
        conn.execute(text("ALTER TABLE tickets ADD COLUMN IF NOT EXISTS contact_person VARCHAR"))
        conn.execute(text("ALTER TABLE tickets ADD COLUMN IF NOT EXISTS customer_email VARCHAR"))
```

**Step 5: Commit**

```bash
git add backend/app/models/ticket.py backend/app/schemas/ticket.py backend/main.py
git commit -m "feat: add customer_type, contact_person, customer_email to ticket model"
```

---

### Task 6: Backend — Enhanced Caller Context Lookup

**Files:**
- Modify: `backend/app/routes/tickets.py:90-143` (the `get_ticket_context` function)

**Step 1: Rewrite the context endpoint**

Replace the `get_ticket_context` function with enhanced logic that also searches Individuals and returns more fields:

```python
@router.get("/context/{phone_number}")
def get_ticket_context(
    phone_number: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Retrieve caller context by phone number for auto-filling the ticket form."""
    from app.models.organization import Organization, OrganizationContact
    from app.models.individual import Individual
    from app.models.email import Contact
    from sqlalchemy import cast, String

    clean_phone = "".join(filter(str.isdigit, phone_number))
    search_terms = [phone_number]
    if clean_phone and clean_phone != phone_number:
        search_terms.append(clean_phone)

    result = {
        "found": False,
        "customer_type": None,
        "customer_name": None,
        "caller_name": None,
        "organization_name": None,
        "organization_id": None,
        "contact_person": None,
        "gender": None,
        "email": None,
    }

    for term in search_terms:
        if result["found"]:
            break

        # 1. Search Organization Contacts
        org_contact = db.query(OrganizationContact).filter(
            cast(OrganizationContact.phone_no, String).ilike(f"%{term}%")
        ).first()
        if org_contact:
            result["found"] = True
            result["customer_type"] = "organization"
            result["contact_person"] = org_contact.full_name
            result["caller_name"] = org_contact.full_name
            result["gender"] = org_contact.gender
            result["email"] = org_contact.email
            if org_contact.organization:
                result["customer_name"] = org_contact.organization.organization_name
                result["organization_name"] = org_contact.organization.organization_name
                result["organization_id"] = org_contact.organization.id
            break

        # 2. Search Organizations directly
        org = db.query(Organization).filter(
            cast(Organization.contact_numbers, String).ilike(f"%{term}%")
        ).first()
        if org:
            result["found"] = True
            result["customer_type"] = "organization"
            result["customer_name"] = org.organization_name
            result["organization_name"] = org.organization_name
            result["organization_id"] = org.id
            result["email"] = org.email
            result["caller_name"] = "Valued Customer"
            break

        # 3. Search Individuals
        individual = db.query(Individual).filter(
            cast(Individual.phone_numbers, String).ilike(f"%{term}%")
        ).first()
        if individual:
            result["found"] = True
            result["customer_type"] = "individual"
            result["customer_name"] = individual.full_name
            result["caller_name"] = individual.full_name
            result["gender"] = individual.gender
            result["email"] = individual.email
            break

        # 4. Fallback: email contacts
        contact = db.query(Contact).filter(Contact.phone.ilike(f"%{term}%")).first()
        if contact:
            result["found"] = True
            result["caller_name"] = contact.name
            result["customer_name"] = contact.name
            break

    return result
```

**Step 2: Commit**

```bash
git add backend/app/routes/tickets.py
git commit -m "feat: enhance caller context lookup with individuals and richer response"
```

---

### Task 7: Backend — Auto-Insert on Ticket Creation

**Files:**
- Modify: `backend/app/routes/tickets.py:20-76` (the `create_ticket` function)

**Step 1: Add auto-insert logic after ticket creation**

After `db.refresh(new_ticket)` (line 49) and before the call-record auto-log block, add:

```python
    # Auto-insert org/individual if caller was not already in the system
    if ticket_in.customer_name and ticket_in.customer_type:
        from app.models.organization import Organization, OrganizationContact
        from app.models.individual import Individual
        from sqlalchemy import cast, String

        clean_phone = "".join(filter(str.isdigit, ticket_in.phone_number))
        phone_search = ticket_in.phone_number

        # Check if this phone already exists in any record
        existing_org_contact = db.query(OrganizationContact).filter(
            cast(OrganizationContact.phone_no, String).ilike(f"%{phone_search}%")
        ).first()
        existing_org = db.query(Organization).filter(
            cast(Organization.contact_numbers, String).ilike(f"%{phone_search}%")
        ).first()
        existing_individual = db.query(Individual).filter(
            cast(Individual.phone_numbers, String).ilike(f"%{phone_search}%")
        ).first()

        already_exists = existing_org_contact or existing_org or existing_individual

        if not already_exists:
            if ticket_in.customer_type == "organization":
                new_org = Organization(
                    organization_name=ticket_in.customer_name,
                    contact_numbers=[ticket_in.phone_number],
                    email=ticket_in.customer_email,
                    is_active=1,
                )
                db.add(new_org)
                db.commit()
                db.refresh(new_org)
                # Link ticket to the new org
                new_ticket.organization_id = new_org.id

                if ticket_in.contact_person:
                    new_contact = OrganizationContact(
                        organization_id=new_org.id,
                        full_name=ticket_in.contact_person,
                        gender=ticket_in.customer_gender,
                        email=ticket_in.customer_email,
                        phone_no=[ticket_in.phone_number],
                    )
                    db.add(new_contact)

                db.commit()
                db.refresh(new_ticket)

            elif ticket_in.customer_type == "individual":
                new_individual = Individual(
                    full_name=ticket_in.customer_name,
                    gender=ticket_in.customer_gender or "Other",
                    phone_numbers=[ticket_in.phone_number],
                    email=ticket_in.customer_email,
                    is_active=1,
                )
                db.add(new_individual)
                db.commit()
```

**Step 2: Update the Ticket constructor in create_ticket to include new fields**

In the `Ticket(...)` constructor (lines 32-46), add:
```python
        customer_type=ticket_in.customer_type,
        contact_person=ticket_in.contact_person,
        customer_email=ticket_in.customer_email,
```

**Step 3: Commit**

```bash
git add backend/app/routes/tickets.py
git commit -m "feat: auto-insert org/individual on ticket creation when caller is new"
```

---

### Task 8: Frontend — Admin Individuals List Page

**Files:**
- Create: `frontend/app/admin/individuals/page.tsx`

**Step 1: Create the list page**

Follow the exact same pattern as `frontend/app/admin/organizations/page.tsx`:
- Client component with `useAuth`, `hasModuleAccess('individuals')` guard
- Fetches `GET /individuals/` with auth header
- Client-side search on `full_name`, `email`
- Table columns: Full Name, Gender, Phone, Email, Status, Actions (ChevronRight)
- "New Individual" button linking to `/admin/individuals/new`
- Same MainHeader + AdminNav layout with `pt-14 ml-[240px]`

**Step 2: Commit**

```bash
git add frontend/app/admin/individuals/page.tsx
git commit -m "feat: add individuals admin list page"
```

---

### Task 9: Frontend — Admin Individuals Detail Page

**Files:**
- Create: `frontend/app/admin/individuals/[id]/page.tsx`

**Step 1: Create the detail page**

Simpler than the Organizations detail page — just one tab (overview) with the `IndividualForm`:
- `useParams()` to get `id`
- If `id !== 'new'`, fetch individual from `GET /individuals/{id}`
- Render `IndividualForm` with `initialData`, `onSuccess`, `onCancel`
- Same MainHeader + AdminNav + back button pattern

**Step 2: Commit**

```bash
git add frontend/app/admin/individuals/\[id\]/page.tsx
git commit -m "feat: add individuals admin detail page"
```

---

### Task 10: Frontend — IndividualForm Component

**Files:**
- Create: `frontend/components/IndividualForm.tsx`

**Step 1: Create the form component**

Follow same pattern as `OrganizationForm.tsx`:
- Props: `{ initialData?: any, onSuccess: (data) => void, onCancel: () => void }`
- Read-only toggle with "Edit details" button
- Fields:
  - Full Name (required, text input with User icon)
  - Gender (required, dropdown: Male / Female / Other)
  - Date of Birth (optional, date input with `max={today}` to disable future dates)
  - Email (optional, email input with Mail icon)
  - Address (optional, textarea with MapPin icon)
  - Phone Numbers (dynamic array, same pattern as OrganizationForm)
  - Social Media (dynamic array of platform dropdown + URL input)
    - Platform options: Facebook, Instagram, Twitter/X, LinkedIn, WhatsApp, TikTok
  - Status (Active/Inactive dropdown)
- POST/PUT to `/individuals/` or `/individuals/{id}`
- Same confirm, loading, error patterns

**Step 2: Commit**

```bash
git add frontend/components/IndividualForm.tsx
git commit -m "feat: add IndividualForm component"
```

---

### Task 11: Frontend — Add Individuals to AdminNav

**Files:**
- Modify: `frontend/components/AdminNav.tsx:62` (after Organizations item)

**Step 1: Add the sidebar link**

In the `Applications` group, after the Organizations item (line 62), add:
```typescript
{ href: '/admin/individuals', label: 'Individuals', icon: '👤', permission: () => hasModuleAccess('individuals') },
```

**Step 2: Commit**

```bash
git add frontend/components/AdminNav.tsx
git commit -m "feat: add Individuals link to admin sidebar"
```

---

### Task 12: Frontend — Update TicketForm with New Fields

**Files:**
- Modify: `frontend/components/TicketForm.tsx`

**Step 1: Add state variables**

After `organizationId` state (line 32), add:
```typescript
const [customerType, setCustomerType] = useState('');
const [contactPerson, setContactPerson] = useState('');
const [customerEmail, setCustomerEmail] = useState('');
```

**Step 2: Update the reset block in the `activeNumber` useEffect (lines 112-163)**

Add resets:
```typescript
setCustomerType('');
setContactPerson('');
setCustomerEmail('');
```

And update the auto-fill block to use the new context fields:
```typescript
if (data.found) {
    if (data.organization_id) setOrganizationId(data.organization_id);
    if (data.customer_type) setCustomerType(data.customer_type);
    if (data.customer_name) setCustomerName(data.customer_name);
    if (data.contact_person) setContactPerson(data.contact_person);
    if (data.gender) setCustomerGender(data.gender);
    if (data.email) setCustomerEmail(data.email);

    // Fallback for legacy: if no customer_name but has caller_name
    if (!data.customer_name && data.caller_name && data.caller_name !== "Valued Customer") {
        setCustomerName(data.caller_name);
    }
}
```

**Step 3: Add form fields in the JSX**

In the "Customer Identifier" section (lines 400-428), restructure to add the 3 new fields:
- **Before** the Customer Name field, add Customer Type dropdown (Individual / Organization)
- **After** Customer Name field, add Contact Person (only visible when `customerType === 'organization'`)
- **After** Contact Person, add Email field

**Step 4: Update resetForm function**

Add resets for the 3 new state vars.

**Step 5: Update handleSubmit JSON body**

Add to the fetch body:
```typescript
customer_type: customerType,
contact_person: contactPerson,
customer_email: customerEmail,
```

**Step 6: Commit**

```bash
git add frontend/components/TicketForm.tsx
git commit -m "feat: add customer_type, contact_person, email fields to ticket form with auto-fill"
```

---

### Task 13: Verify — Start the App and Test

**Step 1: Start the backend**

```bash
cd backend && source venv/bin/activate && uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

Expected: Server starts, tables created, no migration errors.

**Step 2: Check Swagger docs**

Open http://localhost:8000/docs and verify:
- `/individuals` CRUD endpoints appear
- `/api/tickets` POST shows new fields
- `/api/tickets/context/{phone_number}` returns enriched response

**Step 3: Start the frontend**

```bash
cd frontend && npm run dev
```

Expected: No TypeScript compilation errors.

**Step 4: Test the Individuals CRUD**

Navigate to Admin > Individuals, create/edit/delete an individual.

**Step 5: Test the Ticket Form**

In workspace, simulate a call and verify:
- Customer Type dropdown appears
- Contact Person shows/hides based on type
- Auto-fill works for org contacts, org numbers, and individual numbers
- New records are auto-inserted on ticket save

**Step 6: Commit (if any fixes needed)**

---
