# CRM Complete System Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Deliver a complete CRM system in 5 phases: finish in-progress features, add Companies, Pipeline Forecasting, Automation/Workflows, and full Reporting.

**Architecture:** FastAPI backend with inline SQL migrations in `main.py`, Next.js 14 App Router frontend. All new routes registered in `main.py`. No Alembic, no Jest — verify via Swagger at http://localhost:8000/docs and browser at http://localhost:3000.

**Tech Stack:** FastAPI, SQLAlchemy 2.0, PostgreSQL, Next.js 14, TailwindCSS, APScheduler.

---

# PHASE 1: Complete In-Progress Features

Execute the existing plan exactly. Reference: `docs/plans/2026-03-02-crm-enhancements.md`

Tasks 1–7 are fully specced there. Execute them in order. After all 7 tasks:

**Verify:**
1. Open a conversation linked to a lead → purple CRM banner appears in ChatWindow
2. Change a deal stage via Swagger → toast appears bottom-right, AdminNav CRM badge increments
3. Navigate to `/admin/crm/leads` → badge clears

---

# PHASE 2: Contacts & Companies

---

### Task P2-1: Add columns to organizations and organization_contacts tables

**Files:**
- Modify: `backend/main.py`

**Step 1: Find the inline migrations block**

Search for `# Organization` or `organizations` table in `main.py` migrations section (the `with engine.connect() as conn:` block). After the last organization-related migration line, add:

```python
        # Phase 2: Organization CRM enhancements
        conn.execute(text("ALTER TABLE organizations ADD COLUMN IF NOT EXISTS industry VARCHAR"))
        conn.execute(text("ALTER TABLE organizations ADD COLUMN IF NOT EXISTS company_size VARCHAR"))
        conn.execute(text("ALTER TABLE organizations ADD COLUMN IF NOT EXISTS website VARCHAR"))
        conn.execute(text("ALTER TABLE organizations ADD COLUMN IF NOT EXISTS annual_revenue FLOAT"))
        conn.execute(text("ALTER TABLE organizations ADD COLUMN IF NOT EXISTS description TEXT"))
        conn.execute(text("ALTER TABLE organizations ADD COLUMN IF NOT EXISTS tags JSON DEFAULT '[]'"))
        conn.execute(text("ALTER TABLE organization_contacts ADD COLUMN IF NOT EXISTS notes TEXT"))
        conn.execute(text("ALTER TABLE organization_contacts ADD COLUMN IF NOT EXISTS lead_id INTEGER REFERENCES leads(id) ON DELETE SET NULL"))
```

**Step 2: Restart backend**

```bash
cd /Users/rajmaha/Sites/SocialMedia/backend && source venv/bin/activate && uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

Check logs — no errors = columns created.

**Step 3: Commit**

```bash
git add backend/main.py
git commit -m "feat(crm): add CRM enhancement columns to organizations and organization_contacts"
```

---

### Task P2-2: Update Organization and Lead models

**Files:**
- Modify: `backend/app/models/organization.py`
- Modify: `backend/app/models/crm.py`

**Step 1: Update `Organization` class in `organization.py`**

Add after `is_active` column:

```python
    industry = Column(String, nullable=True)
    company_size = Column(String, nullable=True)
    website = Column(String, nullable=True)
    annual_revenue = Column(Float, nullable=True)
    description = Column(Text, nullable=True)
    tags = Column(JSON, default=list)
```

Add to `Organization` relationships (after existing ones):

```python
    leads = relationship("Lead", back_populates="organization", foreign_keys="Lead.organization_id")
```

**Step 2: Update `OrganizationContact` class in `organization.py`**

Add after `address` column:

```python
    notes = Column(Text, nullable=True)
    lead_id = Column(Integer, ForeignKey("leads.id"), nullable=True)
```

Add import at top if not present: `from sqlalchemy import Float`

**Step 3: Update `Lead` model in `crm.py`**

Add to `Lead` relationships (after existing ones):

```python
    organization = relationship("Organization", back_populates="leads", foreign_keys=[Lead.organization_id])
```

Wait — this is a forward reference. Instead add it after the class definition or use string reference:

```python
    organization = relationship("Organization", back_populates="leads", foreign_keys="[Lead.organization_id]")
```

**Step 4: Commit**

```bash
git add backend/app/models/organization.py backend/app/models/crm.py
git commit -m "feat(crm): update Organization and Lead models with CRM fields and relationships"
```

---

### Task P2-3: Create Organization CRM schemas

**Files:**
- Create: `backend/app/schemas/crm_organizations.py`

**Step 1: Create file**

```python
from pydantic import BaseModel, EmailStr
from datetime import datetime
from typing import Optional, List, Any


class OrganizationContactCreate(BaseModel):
    full_name: str
    gender: Optional[str] = None
    email: Optional[str] = None
    phone_no: Optional[List[str]] = []
    designation: Optional[str] = None
    address: Optional[str] = None
    notes: Optional[str] = None
    lead_id: Optional[int] = None


class OrganizationContactUpdate(BaseModel):
    full_name: Optional[str] = None
    gender: Optional[str] = None
    email: Optional[str] = None
    phone_no: Optional[List[str]] = None
    designation: Optional[str] = None
    address: Optional[str] = None
    notes: Optional[str] = None
    lead_id: Optional[int] = None


class OrganizationContactResponse(BaseModel):
    id: int
    organization_id: int
    full_name: str
    gender: Optional[str]
    email: Optional[str]
    phone_no: Optional[Any]
    designation: Optional[str]
    address: Optional[str]
    notes: Optional[str]
    lead_id: Optional[int]
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class OrganizationCreate(BaseModel):
    organization_name: str
    address: Optional[str] = None
    pan_no: Optional[str] = None
    domain_name: Optional[str] = None
    contact_numbers: Optional[List[str]] = []
    email: Optional[str] = None
    industry: Optional[str] = None
    company_size: Optional[str] = None
    website: Optional[str] = None
    annual_revenue: Optional[float] = None
    description: Optional[str] = None
    tags: Optional[List[str]] = []


class OrganizationUpdate(BaseModel):
    organization_name: Optional[str] = None
    address: Optional[str] = None
    pan_no: Optional[str] = None
    domain_name: Optional[str] = None
    contact_numbers: Optional[List[str]] = None
    email: Optional[str] = None
    industry: Optional[str] = None
    company_size: Optional[str] = None
    website: Optional[str] = None
    annual_revenue: Optional[float] = None
    description: Optional[str] = None
    tags: Optional[List[str]] = None
    is_active: Optional[int] = None


class OrganizationResponse(BaseModel):
    id: int
    organization_name: str
    address: Optional[str]
    pan_no: Optional[str]
    domain_name: Optional[str]
    contact_numbers: Optional[Any]
    email: Optional[str]
    industry: Optional[str]
    company_size: Optional[str]
    website: Optional[str]
    annual_revenue: Optional[float]
    description: Optional[str]
    tags: Optional[Any]
    is_active: int
    created_at: datetime
    updated_at: datetime
    lead_count: int = 0
    contact_count: int = 0

    class Config:
        from_attributes = True


class OrganizationDetailResponse(OrganizationResponse):
    contacts: List[OrganizationContactResponse] = []
    leads: List[Any] = []
```

**Step 2: Commit**

```bash
git add backend/app/schemas/crm_organizations.py
git commit -m "feat(crm): add CRM organization schemas"
```

---

### Task P2-4: Create CRM Organizations routes

**Files:**
- Create: `backend/app/routes/crm_organizations.py`

**Step 1: Create file**

```python
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import func, desc

from app.database import get_db
from app.models.organization import Organization, OrganizationContact
from app.models.crm import Lead
from app.models.user import User
from app.schemas.crm_organizations import (
    OrganizationCreate, OrganizationUpdate, OrganizationResponse,
    OrganizationDetailResponse, OrganizationContactCreate, OrganizationContactUpdate,
    OrganizationContactResponse,
)
from app.dependencies import get_current_user

router = APIRouter(prefix="/crm/organizations", tags=["crm-organizations"])


@router.get("", response_model=list[OrganizationResponse])
def list_organizations(
    search: str = Query(None),
    industry: str = Query(None),
    skip: int = 0,
    limit: int = 100,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    query = db.query(Organization).filter(Organization.is_active == 1)
    if search:
        query = query.filter(Organization.organization_name.ilike(f"%{search}%"))
    if industry:
        query = query.filter(Organization.industry == industry)

    orgs = query.order_by(desc(Organization.created_at)).offset(skip).limit(limit).all()

    result = []
    for org in orgs:
        lead_count = db.query(func.count(Lead.id)).filter(Lead.organization_id == org.id).scalar() or 0
        contact_count = db.query(func.count(OrganizationContact.id)).filter(OrganizationContact.organization_id == org.id).scalar() or 0
        d = OrganizationResponse.model_validate(org)
        d.lead_count = lead_count
        d.contact_count = contact_count
        result.append(d)
    return result


@router.post("", response_model=OrganizationResponse)
def create_organization(
    org: OrganizationCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    db_org = Organization(**org.model_dump())
    db.add(db_org)
    db.commit()
    db.refresh(db_org)
    d = OrganizationResponse.model_validate(db_org)
    d.lead_count = 0
    d.contact_count = 0
    return d


@router.get("/{org_id}", response_model=OrganizationDetailResponse)
def get_organization(
    org_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    org = db.query(Organization).filter(Organization.id == org_id).first()
    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")

    contacts = db.query(OrganizationContact).filter(OrganizationContact.organization_id == org_id).all()
    leads = db.query(Lead).filter(Lead.organization_id == org_id).all()

    from app.schemas.crm import LeadResponse
    d = OrganizationDetailResponse.model_validate(org)
    d.lead_count = len(leads)
    d.contact_count = len(contacts)
    d.contacts = [OrganizationContactResponse.model_validate(c) for c in contacts]
    d.leads = [LeadResponse.model_validate(l) for l in leads]
    return d


@router.patch("/{org_id}", response_model=OrganizationResponse)
def update_organization(
    org_id: int,
    org_update: OrganizationUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    org = db.query(Organization).filter(Organization.id == org_id).first()
    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")

    update_data = org_update.model_dump(exclude_unset=True)
    for k, v in update_data.items():
        setattr(org, k, v)
    db.commit()
    db.refresh(org)

    lead_count = db.query(func.count(Lead.id)).filter(Lead.organization_id == org_id).scalar() or 0
    contact_count = db.query(func.count(OrganizationContact.id)).filter(OrganizationContact.organization_id == org_id).scalar() or 0
    d = OrganizationResponse.model_validate(org)
    d.lead_count = lead_count
    d.contact_count = contact_count
    return d


@router.delete("/{org_id}")
def delete_organization(
    org_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    org = db.query(Organization).filter(Organization.id == org_id).first()
    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")
    lead_count = db.query(func.count(Lead.id)).filter(Lead.organization_id == org_id).scalar() or 0
    if lead_count > 0:
        raise HTTPException(status_code=400, detail=f"Cannot delete: {lead_count} lead(s) linked to this organization")
    db.delete(org)
    db.commit()
    return {"ok": True}


@router.post("/{org_id}/contacts", response_model=OrganizationContactResponse)
def add_contact(
    org_id: int,
    contact: OrganizationContactCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    org = db.query(Organization).filter(Organization.id == org_id).first()
    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")
    db_contact = OrganizationContact(organization_id=org_id, **contact.model_dump())
    db.add(db_contact)
    db.commit()
    db.refresh(db_contact)
    return db_contact


@router.patch("/{org_id}/contacts/{contact_id}", response_model=OrganizationContactResponse)
def update_contact(
    org_id: int,
    contact_id: int,
    contact_update: OrganizationContactUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    contact = db.query(OrganizationContact).filter(
        OrganizationContact.id == contact_id,
        OrganizationContact.organization_id == org_id,
    ).first()
    if not contact:
        raise HTTPException(status_code=404, detail="Contact not found")
    for k, v in contact_update.model_dump(exclude_unset=True).items():
        setattr(contact, k, v)
    db.commit()
    db.refresh(contact)
    return contact


@router.delete("/{org_id}/contacts/{contact_id}")
def delete_contact(
    org_id: int,
    contact_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    contact = db.query(OrganizationContact).filter(
        OrganizationContact.id == contact_id,
        OrganizationContact.organization_id == org_id,
    ).first()
    if not contact:
        raise HTTPException(status_code=404, detail="Contact not found")
    db.delete(contact)
    db.commit()
    return {"ok": True}
```

**Step 2: Register router in `main.py`**

Find the imports line:
```python
from app.routes import ... crm
```

Add `crm_organizations` to the import:
```python
from app.routes import messages, conversations, auth, accounts, admin, branding, email, events, webchat, bot, webhooks, teams, reports, call_center, telephony, calls, extensions, agent_workspace, reminders, notifications, tickets, dynamic_fields, organizations, cloudpanel, cloudpanel_templates, individuals, billing, crm, crm_organizations
```

Find where routers are included (look for `app.include_router(crm.router)`). After it add:
```python
app.include_router(crm_organizations.router)
```

**Step 3: Restart and verify**

Go to http://localhost:8000/docs → confirm `GET /crm/organizations`, `POST /crm/organizations` etc. appear.

**Step 4: Commit**

```bash
git add backend/app/routes/crm_organizations.py backend/main.py
git commit -m "feat(crm): add CRM organizations CRUD routes"
```

---

### Task P2-5: Companies list page

**Files:**
- Create: `frontend/app/admin/crm/companies/page.tsx`

**Step 1: Create file**

```tsx
'use client'
import { useState, useEffect } from 'react'
import Link from 'next/link'
import api from '@/lib/api'

interface Organization {
  id: number
  organization_name: string
  industry: string | null
  company_size: string | null
  website: string | null
  email: string | null
  lead_count: number
  contact_count: number
  is_active: number
}

export default function CompaniesPage() {
  const [orgs, setOrgs] = useState<Organization[]>([])
  const [search, setSearch] = useState('')
  const [industry, setIndustry] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    const params = new URLSearchParams()
    if (search) params.set('search', search)
    if (industry) params.set('industry', industry)
    api.get(`/crm/organizations?${params}`).then(r => {
      setOrgs(r.data)
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [search, industry])

  const industries = ['Technology', 'Finance', 'Healthcare', 'Retail', 'Manufacturing', 'Education', 'Other']

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Companies</h1>
          <p className="text-sm text-gray-500 mt-1">{orgs.length} organizations</p>
        </div>
        <Link href="/admin/crm/companies/new" className="bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-indigo-700">
          + New Company
        </Link>
      </div>

      <div className="flex gap-3 mb-4">
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search companies..."
          className="border rounded-lg px-3 py-2 text-sm flex-1 max-w-xs focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
        <select
          value={industry}
          onChange={e => setIndustry(e.target.value)}
          className="border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
        >
          <option value="">All Industries</option>
          {industries.map(i => <option key={i} value={i}>{i}</option>)}
        </select>
      </div>

      {loading ? (
        <div className="text-center py-12 text-gray-400">Loading...</div>
      ) : orgs.length === 0 ? (
        <div className="text-center py-12 text-gray-400">No companies found.</div>
      ) : (
        <div className="bg-white rounded-xl border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wide">
              <tr>
                <th className="px-4 py-3 text-left">Company</th>
                <th className="px-4 py-3 text-left">Industry</th>
                <th className="px-4 py-3 text-left">Website</th>
                <th className="px-4 py-3 text-center">Leads</th>
                <th className="px-4 py-3 text-center">Contacts</th>
                <th className="px-4 py-3 text-left">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {orgs.map(org => (
                <tr key={org.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <Link href={`/admin/crm/companies/${org.id}`} className="font-medium text-indigo-600 hover:text-indigo-800">
                      {org.organization_name}
                    </Link>
                    {org.email && <p className="text-xs text-gray-400">{org.email}</p>}
                  </td>
                  <td className="px-4 py-3 text-gray-600">{org.industry || '—'}</td>
                  <td className="px-4 py-3">
                    {org.website ? (
                      <a href={org.website} target="_blank" rel="noreferrer" className="text-indigo-500 hover:underline text-xs">{org.website}</a>
                    ) : '—'}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span className="bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded-full text-xs font-semibold">{org.lead_count}</span>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span className="bg-gray-100 text-gray-700 px-2 py-0.5 rounded-full text-xs font-semibold">{org.contact_count}</span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${org.is_active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                      {org.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
```

**Step 2: Commit**

```bash
git add frontend/app/admin/crm/companies/page.tsx
git commit -m "feat(crm): add Companies list page"
```

---

### Task P2-6: Company new/edit form and detail page

**Files:**
- Create: `frontend/app/admin/crm/companies/new/page.tsx`
- Create: `frontend/app/admin/crm/companies/[id]/page.tsx`

**Step 1: Create `new/page.tsx`**

```tsx
'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import api from '@/lib/api'

const INDUSTRIES = ['Technology', 'Finance', 'Healthcare', 'Retail', 'Manufacturing', 'Education', 'Other']
const SIZES = ['1-10', '11-50', '51-200', '201-500', '500+']

export default function NewCompanyPage() {
  const router = useRouter()
  const [form, setForm] = useState({
    organization_name: '', industry: '', company_size: '', website: '',
    email: '', description: '', annual_revenue: '', address: '',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }))

  const submit = async () => {
    if (!form.organization_name) { setError('Name is required'); return }
    setSaving(true)
    try {
      const payload = { ...form, annual_revenue: form.annual_revenue ? parseFloat(form.annual_revenue) : null }
      await api.post('/crm/organizations', payload)
      router.push('/admin/crm/companies')
    } catch (e: any) {
      setError(e.response?.data?.detail || 'Failed to create')
      setSaving(false)
    }
  }

  return (
    <div className="p-6 max-w-2xl">
      <h1 className="text-2xl font-bold mb-6">New Company</h1>
      {error && <div className="bg-red-50 text-red-600 px-4 py-2 rounded mb-4 text-sm">{error}</div>}
      <div className="bg-white rounded-xl border p-6 space-y-4">
        <div>
          <label className="block text-sm font-medium mb-1">Company Name *</label>
          <input value={form.organization_name} onChange={e => set('organization_name', e.target.value)}
            className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium mb-1">Industry</label>
            <select value={form.industry} onChange={e => set('industry', e.target.value)}
              className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
              <option value="">Select...</option>
              {INDUSTRIES.map(i => <option key={i}>{i}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Company Size</label>
            <select value={form.company_size} onChange={e => set('company_size', e.target.value)}
              className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
              <option value="">Select...</option>
              {SIZES.map(s => <option key={s}>{s}</option>)}
            </select>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium mb-1">Email</label>
            <input value={form.email} onChange={e => set('email', e.target.value)}
              className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Website</label>
            <input value={form.website} onChange={e => set('website', e.target.value)}
              className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Annual Revenue (USD)</label>
          <input type="number" value={form.annual_revenue} onChange={e => set('annual_revenue', e.target.value)}
            className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Description</label>
          <textarea value={form.description} onChange={e => set('description', e.target.value)} rows={3}
            className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
        </div>
        <div className="flex gap-3 pt-2">
          <button onClick={submit} disabled={saving}
            className="bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50">
            {saving ? 'Saving...' : 'Create Company'}
          </button>
          <button onClick={() => router.back()} className="border px-4 py-2 rounded-lg text-sm text-gray-600 hover:bg-gray-50">
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
```

**Step 2: Create `[id]/page.tsx`**

```tsx
'use client'
import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import api from '@/lib/api'

export default function CompanyDetailPage() {
  const { id } = useParams()
  const router = useRouter()
  const [org, setOrg] = useState<any>(null)
  const [tab, setTab] = useState<'info' | 'contacts' | 'leads'>('info')
  const [loading, setLoading] = useState(true)
  const [showAddContact, setShowAddContact] = useState(false)
  const [newContact, setNewContact] = useState({ full_name: '', email: '', designation: '', notes: '' })

  const load = () => {
    api.get(`/crm/organizations/${id}`).then(r => { setOrg(r.data); setLoading(false) })
  }
  useEffect(() => { load() }, [id])

  const addContact = async () => {
    if (!newContact.full_name) return
    await api.post(`/crm/organizations/${id}/contacts`, newContact)
    setNewContact({ full_name: '', email: '', designation: '', notes: '' })
    setShowAddContact(false)
    load()
  }

  const deleteContact = async (cid: number) => {
    if (!confirm('Remove this contact?')) return
    await api.delete(`/crm/organizations/${id}/contacts/${cid}`)
    load()
  }

  if (loading) return <div className="p-6 text-gray-400">Loading...</div>
  if (!org) return <div className="p-6 text-red-500">Not found</div>

  return (
    <div className="p-6">
      <div className="flex items-center gap-3 mb-6">
        <button onClick={() => router.back()} className="text-gray-400 hover:text-gray-600 text-sm">← Back</button>
        <div>
          <h1 className="text-2xl font-bold">{org.organization_name}</h1>
          <p className="text-sm text-gray-500">{org.industry} {org.company_size ? `· ${org.company_size} employees` : ''}</p>
        </div>
        <div className="ml-auto flex gap-3">
          <span className="text-sm text-gray-500">{org.lead_count} leads · {org.contact_count} contacts</span>
        </div>
      </div>

      <div className="flex gap-1 mb-6 border-b">
        {(['info', 'contacts', 'leads'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium capitalize ${tab === t ? 'border-b-2 border-indigo-600 text-indigo-600' : 'text-gray-500 hover:text-gray-700'}`}>
            {t} {t === 'contacts' ? `(${org.contacts?.length || 0})` : t === 'leads' ? `(${org.leads?.length || 0})` : ''}
          </button>
        ))}
      </div>

      {tab === 'info' && (
        <div className="bg-white rounded-xl border p-6 grid grid-cols-2 gap-6 max-w-2xl">
          {[
            ['Email', org.email], ['Website', org.website], ['Address', org.address],
            ['Annual Revenue', org.annual_revenue ? `$${org.annual_revenue.toLocaleString()}` : null],
            ['Description', org.description],
          ].map(([label, value]) => value ? (
            <div key={label as string}>
              <p className="text-xs text-gray-400 uppercase tracking-wide mb-1">{label}</p>
              <p className="text-sm text-gray-700">{value}</p>
            </div>
          ) : null)}
        </div>
      )}

      {tab === 'contacts' && (
        <div>
          <div className="flex justify-between items-center mb-4">
            <h2 className="font-semibold text-gray-700">Contacts</h2>
            <button onClick={() => setShowAddContact(true)} className="text-sm bg-indigo-600 text-white px-3 py-1.5 rounded-lg hover:bg-indigo-700">+ Add Contact</button>
          </div>
          {showAddContact && (
            <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-4 mb-4 flex gap-3 flex-wrap items-end">
              {['full_name', 'email', 'designation'].map(field => (
                <div key={field}>
                  <label className="block text-xs font-medium mb-1 capitalize">{field.replace('_', ' ')}</label>
                  <input value={(newContact as any)[field]} onChange={e => setNewContact(c => ({ ...c, [field]: e.target.value }))}
                    className="border rounded px-2 py-1 text-sm focus:outline-none" placeholder={field} />
                </div>
              ))}
              <button onClick={addContact} className="bg-indigo-600 text-white px-3 py-1.5 rounded text-sm">Save</button>
              <button onClick={() => setShowAddContact(false)} className="text-sm text-gray-500 hover:text-gray-700">Cancel</button>
            </div>
          )}
          <div className="space-y-2">
            {(org.contacts || []).map((c: any) => (
              <div key={c.id} className="bg-white border rounded-xl px-4 py-3 flex items-center justify-between">
                <div>
                  <p className="font-medium text-sm">{c.full_name}</p>
                  <p className="text-xs text-gray-400">{c.designation} {c.email ? `· ${c.email}` : ''}</p>
                  {c.notes && <p className="text-xs text-gray-500 mt-1">{c.notes}</p>}
                </div>
                <button onClick={() => deleteContact(c.id)} className="text-red-400 hover:text-red-600 text-xs">Remove</button>
              </div>
            ))}
            {(org.contacts || []).length === 0 && <p className="text-gray-400 text-sm">No contacts yet.</p>}
          </div>
        </div>
      )}

      {tab === 'leads' && (
        <div className="space-y-2">
          {(org.leads || []).map((l: any) => (
            <Link key={l.id} href={`/admin/crm/leads/${l.id}`}
              className="bg-white border rounded-xl px-4 py-3 flex items-center gap-4 hover:bg-gray-50 block">
              <div className="flex-1">
                <p className="font-medium text-sm">{l.first_name} {l.last_name || ''}</p>
                <p className="text-xs text-gray-400">{l.email} · {l.position}</p>
              </div>
              <span className="text-xs px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-700">{l.status}</span>
              <span className="text-xs text-gray-400">Score: {l.score}</span>
            </Link>
          ))}
          {(org.leads || []).length === 0 && <p className="text-gray-400 text-sm">No leads linked to this company.</p>}
        </div>
      )}
    </div>
  )
}
```

**Step 3: Commit**

```bash
git add frontend/app/admin/crm/companies/
git commit -m "feat(crm): add Companies new and detail pages"
```

---

### Task P2-7: Add Companies to AdminNav and enhance lead forms

**Files:**
- Modify: `frontend/components/AdminNav.tsx`
- Modify: `frontend/app/admin/crm/leads/new/page.tsx`

**Step 1: Add Companies link to AdminNav**

Find the CRM section in `AdminNav.tsx` (lines 94–97):
```tsx
{ href: '/admin/crm/leads', label: 'Leads', icon: '👥', ... },
{ href: '/admin/crm/deals', label: 'Sales Pipeline', icon: '💼', ... },
```

Add after analytics item:
```tsx
{ href: '/admin/crm/companies', label: 'Companies', icon: '🏢', permission: () => hasAdminFeature('feature_manage_crm') },
```

**Step 2: Add organization dropdown to lead create form**

In `frontend/app/admin/crm/leads/new/page.tsx`, add state and fetch:
```tsx
const [orgs, setOrgs] = useState<{id: number, organization_name: string}[]>([])
useEffect(() => {
  api.get('/crm/organizations?limit=200').then(r => setOrgs(r.data))
}, [])
```

Add to the form JSX (before submit button):
```tsx
<div>
  <label className="block text-sm font-medium mb-1">Company</label>
  <select value={form.organization_id || ''} onChange={e => setForm(f => ({...f, organization_id: e.target.value ? parseInt(e.target.value) : null}))}
    className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
    <option value="">No company</option>
    {orgs.map(o => <option key={o.id} value={o.id}>{o.organization_name}</option>)}
  </select>
</div>
```

Make sure `organization_id` is in form state initial value and submitted payload.

**Step 3: Commit**

```bash
git add frontend/components/AdminNav.tsx frontend/app/admin/crm/leads/new/page.tsx
git commit -m "feat(crm): add Companies nav link and org selector in lead form"
```

---

# PHASE 3: Pipeline & Forecasting

---

### Task P3-1: Add forecasting and analytics endpoints

**Files:**
- Modify: `backend/app/routes/crm.py`

**Step 1: Add imports at top of `crm.py`** (if not already present):

```python
from sqlalchemy import func, extract
from datetime import datetime, timedelta
```

**Step 2: Add four new analytics endpoints** after the existing `GET /crm/analytics/lead-scoring` endpoint:

```python
@router.get("/analytics/forecast")
def revenue_forecast(
    months: int = Query(6),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Probability-weighted revenue forecast by month."""
    from datetime import date
    import calendar as cal
    result = []
    now = datetime.utcnow()
    for i in range(months):
        month_start = datetime(now.year + (now.month + i - 1) // 12, (now.month + i - 1) % 12 + 1, 1)
        last_day = cal.monthrange(month_start.year, month_start.month)[1]
        month_end = datetime(month_start.year, month_start.month, last_day, 23, 59, 59)

        deals = db.query(Deal).filter(
            Deal.expected_close_date >= month_start,
            Deal.expected_close_date <= month_end,
            Deal.stage.notin_(["won", "lost"]),
        ).all()

        forecasted = sum((d.amount or 0) * (d.probability or 50) / 100 for d in deals)
        result.append({
            "month": month_start.strftime("%Y-%m"),
            "month_label": month_start.strftime("%b %Y"),
            "forecasted": round(forecasted, 2),
            "pipeline_count": len(deals),
        })
    return result


@router.get("/analytics/win-loss")
def win_loss_analysis(
    days: int = Query(90),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Win rate and loss rate for the given lookback period."""
    since = datetime.utcnow() - timedelta(days=days)
    won = db.query(Deal).filter(Deal.stage == "won", Deal.closed_at >= since).all()
    lost = db.query(Deal).filter(Deal.stage == "lost", Deal.closed_at >= since).all()
    total = len(won) + len(lost)
    return {
        "period_days": days,
        "won_count": len(won),
        "lost_count": len(lost),
        "total_closed": total,
        "win_rate": round(len(won) / total * 100, 1) if total else 0,
        "loss_rate": round(len(lost) / total * 100, 1) if total else 0,
        "avg_won_value": round(sum(d.amount or 0 for d in won) / len(won), 2) if won else 0,
        "total_won_revenue": round(sum(d.amount or 0 for d in won), 2),
    }


@router.get("/analytics/deal-velocity")
def deal_velocity(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Average days deals spend in each stage (from activity timestamps)."""
    stages = ["prospect", "qualified", "proposal", "negotiation", "close", "won", "lost"]
    result = []
    for stage in stages:
        deals = db.query(Deal).filter(Deal.stage == stage).all()
        if not deals:
            result.append({"stage": stage, "avg_days": 0, "count": 0})
            continue
        ages = [(datetime.utcnow() - d.created_at).days for d in deals]
        result.append({
            "stage": stage,
            "avg_days": round(sum(ages) / len(ages), 1),
            "count": len(deals),
        })
    return result


@router.get("/analytics/conversion-funnel")
def conversion_funnel(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Lead → Deal created → Deal won conversion percentages."""
    total_leads = db.query(func.count(Lead.id)).scalar() or 0
    leads_with_deals = db.query(func.count(func.distinct(Deal.lead_id))).scalar() or 0
    won_deals = db.query(func.count(Deal.id)).filter(Deal.stage == "won").scalar() or 0
    return {
        "total_leads": total_leads,
        "leads_with_deals": leads_with_deals,
        "won_deals": won_deals,
        "lead_to_deal_rate": round(leads_with_deals / total_leads * 100, 1) if total_leads else 0,
        "deal_to_won_rate": round(won_deals / leads_with_deals * 100, 1) if leads_with_deals else 0,
        "overall_conversion": round(won_deals / total_leads * 100, 1) if total_leads else 0,
    }
```

**Step 3: Restart and verify**

Go to http://localhost:8000/docs → confirm 4 new analytics endpoints appear.

**Step 4: Commit**

```bash
git add backend/app/routes/crm.py
git commit -m "feat(crm): add forecast, win-loss, deal-velocity, conversion-funnel analytics"
```

---

### Task P3-2: Add charts to analytics page

**Files:**
- Modify: `frontend/app/admin/crm/analytics/page.tsx`

**Step 1: Read current analytics page to find the end of file**

Read `frontend/app/admin/crm/analytics/page.tsx` fully to understand current structure.

**Step 2: Add state and fetches for new data**

At the top of the component, after existing state, add:
```tsx
const [forecast, setForecast] = useState<any[]>([])
const [winLoss, setWinLoss] = useState<any>(null)
const [velocity, setVelocity] = useState<any[]>([])
const [funnel, setFunnel] = useState<any>(null)

useEffect(() => {
  api.get('/crm/analytics/forecast?months=6').then(r => setForecast(r.data))
  api.get('/crm/analytics/win-loss?days=90').then(r => setWinLoss(r.data))
  api.get('/crm/analytics/deal-velocity').then(r => setVelocity(r.data))
  api.get('/crm/analytics/conversion-funnel').then(r => setFunnel(r.data))
}, [])
```

**Step 3: Add charts section to JSX** (append before closing `</div>` of the page):

```tsx
{/* ── Revenue Forecast ───────────────────────────── */}
<div className="mt-8">
  <h2 className="text-lg font-semibold mb-4">Revenue Forecast (6 Months)</h2>
  <div className="bg-white rounded-xl border p-6">
    {forecast.length === 0 ? <p className="text-gray-400 text-sm">No pipeline deals with close dates.</p> : (
      <div className="flex items-end gap-3 h-40">
        {forecast.map(f => {
          const maxVal = Math.max(...forecast.map(x => x.forecasted), 1)
          const pct = Math.round((f.forecasted / maxVal) * 100)
          return (
            <div key={f.month} className="flex flex-col items-center flex-1 gap-1">
              <span className="text-xs text-gray-500">${(f.forecasted / 1000).toFixed(1)}k</span>
              <div className="w-full bg-indigo-500 rounded-t" style={{ height: `${Math.max(pct, 4)}%` }} />
              <span className="text-xs text-gray-400">{f.month_label}</span>
              <span className="text-xs text-gray-300">{f.pipeline_count} deals</span>
            </div>
          )
        })}
      </div>
    )}
  </div>
</div>

{/* ── Win / Loss + Funnel ───────────────────────── */}
<div className="mt-6 grid grid-cols-2 gap-6">
  <div className="bg-white rounded-xl border p-6">
    <h2 className="text-lg font-semibold mb-4">Win / Loss (90 days)</h2>
    {winLoss ? (
      <div className="space-y-3">
        <div className="flex justify-between text-sm"><span className="text-green-600 font-medium">Won</span><span>{winLoss.won_count} deals · ${winLoss.total_won_revenue.toLocaleString()}</span></div>
        <div className="w-full bg-gray-100 rounded-full h-3">
          <div className="bg-green-500 h-3 rounded-full" style={{ width: `${winLoss.win_rate}%` }} />
        </div>
        <div className="flex justify-between text-sm"><span className="text-red-500 font-medium">Lost</span><span>{winLoss.lost_count} deals</span></div>
        <div className="w-full bg-gray-100 rounded-full h-3">
          <div className="bg-red-400 h-3 rounded-full" style={{ width: `${winLoss.loss_rate}%` }} />
        </div>
        <p className="text-xs text-gray-400 mt-2">Win rate: {winLoss.win_rate}% · Avg won deal: ${winLoss.avg_won_value.toLocaleString()}</p>
      </div>
    ) : <p className="text-gray-400 text-sm">No closed deals yet.</p>}
  </div>

  <div className="bg-white rounded-xl border p-6">
    <h2 className="text-lg font-semibold mb-4">Conversion Funnel</h2>
    {funnel ? (
      <div className="space-y-3">
        {[
          { label: 'Total Leads', value: funnel.total_leads, color: 'bg-indigo-500' },
          { label: 'Leads with Deals', value: funnel.leads_with_deals, color: 'bg-yellow-400', rate: funnel.lead_to_deal_rate },
          { label: 'Won Deals', value: funnel.won_deals, color: 'bg-green-500', rate: funnel.overall_conversion },
        ].map(row => (
          <div key={row.label}>
            <div className="flex justify-between text-sm mb-1">
              <span className="text-gray-600">{row.label}</span>
              <span className="font-semibold">{row.value}{row.rate !== undefined ? ` (${row.rate}%)` : ''}</span>
            </div>
            <div className="w-full bg-gray-100 rounded-full h-2">
              <div className={`${row.color} h-2 rounded-full`}
                style={{ width: `${funnel.total_leads ? Math.round(row.value / funnel.total_leads * 100) : 0}%` }} />
            </div>
          </div>
        ))}
      </div>
    ) : <p className="text-gray-400 text-sm">No data yet.</p>}
  </div>
</div>

{/* ── Deal Velocity ────────────────────────────────── */}
<div className="mt-6">
  <h2 className="text-lg font-semibold mb-4">Deal Velocity (Avg Days per Stage)</h2>
  <div className="bg-white rounded-xl border p-6 space-y-3">
    {velocity.map(v => {
      const maxDays = Math.max(...velocity.map(x => x.avg_days), 1)
      return (
        <div key={v.stage} className="flex items-center gap-3">
          <span className="text-sm text-gray-600 w-24 capitalize">{v.stage}</span>
          <div className="flex-1 bg-gray-100 rounded-full h-3">
            <div className="bg-indigo-400 h-3 rounded-full" style={{ width: `${Math.round(v.avg_days / maxDays * 100)}%` }} />
          </div>
          <span className="text-sm text-gray-500 w-20 text-right">{v.avg_days}d · {v.count}</span>
        </div>
      )
    })}
  </div>
</div>
```

**Step 4: Commit**

```bash
git add frontend/app/admin/crm/analytics/page.tsx
git commit -m "feat(crm): add forecast, win-loss, funnel, velocity charts to analytics page"
```

---

# PHASE 4: Automation & Workflows

---

### Task P4-1: Create automation models

**Files:**
- Create: `backend/app/models/automation.py`

**Step 1: Create file**

```python
from sqlalchemy import Column, Integer, String, Text, Boolean, DateTime, ForeignKey, JSON, Enum
from sqlalchemy.orm import relationship
from app.database import Base
from datetime import datetime
import enum


class TriggerType(str, enum.Enum):
    LEAD_CREATED = "lead_created"
    NO_ACTIVITY = "no_activity"
    SCORE_BELOW = "score_below"
    DEAL_STAGE_CHANGE = "deal_stage_change"
    LEAD_STATUS_CHANGE = "lead_status_change"


class EnrollmentStatus(str, enum.Enum):
    ACTIVE = "active"
    PAUSED = "paused"
    COMPLETED = "completed"
    FAILED = "failed"


class AutomationRule(Base):
    __tablename__ = "automation_rules"

    id = Column(Integer, primary_key=True)
    name = Column(String, nullable=False)
    description = Column(Text, nullable=True)
    trigger_type = Column(Enum(TriggerType), nullable=False)
    conditions = Column(JSON, default=dict)   # e.g. {"days": 3, "status": "new"}
    actions = Column(JSON, default=list)      # e.g. [{"type": "create_task", "title": "Follow up"}]
    is_active = Column(Boolean, default=True)
    last_run_at = Column(DateTime, nullable=True)
    created_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class EmailSequence(Base):
    __tablename__ = "email_sequences"

    id = Column(Integer, primary_key=True)
    name = Column(String, nullable=False)
    description = Column(Text, nullable=True)
    is_active = Column(Boolean, default=True)
    created_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    steps = relationship("EmailSequenceStep", back_populates="sequence", cascade="all, delete-orphan", order_by="EmailSequenceStep.step_order")
    enrollments = relationship("EmailSequenceEnrollment", back_populates="sequence", cascade="all, delete-orphan")


class EmailSequenceStep(Base):
    __tablename__ = "email_sequence_steps"

    id = Column(Integer, primary_key=True)
    sequence_id = Column(Integer, ForeignKey("email_sequences.id"), nullable=False)
    step_order = Column(Integer, nullable=False, default=1)
    delay_days = Column(Integer, nullable=False, default=1)
    subject = Column(String, nullable=False)
    body_html = Column(Text, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)

    sequence = relationship("EmailSequence", back_populates="steps")


class EmailSequenceEnrollment(Base):
    __tablename__ = "email_sequence_enrollments"

    id = Column(Integer, primary_key=True)
    sequence_id = Column(Integer, ForeignKey("email_sequences.id"), nullable=False)
    lead_id = Column(Integer, ForeignKey("leads.id"), nullable=False)
    status = Column(Enum(EnrollmentStatus), default=EnrollmentStatus.ACTIVE)
    current_step = Column(Integer, default=0)
    enrolled_at = Column(DateTime, default=datetime.utcnow)
    next_send_at = Column(DateTime, nullable=True)
    completed_at = Column(DateTime, nullable=True)

    sequence = relationship("EmailSequence", back_populates="enrollments")
    lead = relationship("Lead")
```

**Step 2: Create tables via inline SQL in `main.py`**

Inside the migrations `with engine.connect() as conn:` block, add:

```python
        # Phase 4: Automation & Workflows tables
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS automation_rules (
                id SERIAL PRIMARY KEY,
                name VARCHAR NOT NULL,
                description TEXT,
                trigger_type VARCHAR NOT NULL,
                conditions JSON DEFAULT '{}',
                actions JSON DEFAULT '[]',
                is_active BOOLEAN DEFAULT TRUE,
                last_run_at TIMESTAMP,
                created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
                created_at TIMESTAMP DEFAULT NOW(),
                updated_at TIMESTAMP DEFAULT NOW()
            )
        """))
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS email_sequences (
                id SERIAL PRIMARY KEY,
                name VARCHAR NOT NULL,
                description TEXT,
                is_active BOOLEAN DEFAULT TRUE,
                created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
                created_at TIMESTAMP DEFAULT NOW(),
                updated_at TIMESTAMP DEFAULT NOW()
            )
        """))
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS email_sequence_steps (
                id SERIAL PRIMARY KEY,
                sequence_id INTEGER REFERENCES email_sequences(id) ON DELETE CASCADE NOT NULL,
                step_order INTEGER NOT NULL DEFAULT 1,
                delay_days INTEGER NOT NULL DEFAULT 1,
                subject VARCHAR NOT NULL,
                body_html TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT NOW()
            )
        """))
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS email_sequence_enrollments (
                id SERIAL PRIMARY KEY,
                sequence_id INTEGER REFERENCES email_sequences(id) ON DELETE CASCADE NOT NULL,
                lead_id INTEGER REFERENCES leads(id) ON DELETE CASCADE NOT NULL,
                status VARCHAR DEFAULT 'active',
                current_step INTEGER DEFAULT 0,
                enrolled_at TIMESTAMP DEFAULT NOW(),
                next_send_at TIMESTAMP,
                completed_at TIMESTAMP
            )
        """))
```

**Step 3: Import model in `main.py`** to ensure table creation:

After existing noqa model imports, add:
```python
from app.models.automation import AutomationRule, EmailSequence, EmailSequenceStep, EmailSequenceEnrollment  # noqa: F401
```

**Step 4: Restart and verify**

Restart backend → no errors in logs = tables created.

**Step 5: Commit**

```bash
git add backend/app/models/automation.py backend/main.py
git commit -m "feat(crm): add automation models and create DB tables"
```

---

### Task P4-2: Create automation routes

**Files:**
- Create: `backend/app/routes/automation.py`

**Step 1: Create file**

```python
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import desc
from datetime import datetime
from typing import Optional, List, Any
from pydantic import BaseModel

from app.database import get_db
from app.models.automation import AutomationRule, EmailSequence, EmailSequenceStep, EmailSequenceEnrollment, EnrollmentStatus
from app.models.crm import Lead
from app.models.user import User
from app.dependencies import get_current_user

router = APIRouter(prefix="/crm/automation", tags=["crm-automation"])


# ── Schemas (inline for simplicity) ────────────────────────────────────────

class RuleCreate(BaseModel):
    name: str
    description: Optional[str] = None
    trigger_type: str
    conditions: Optional[Any] = {}
    actions: Optional[List[Any]] = []
    is_active: Optional[bool] = True

class RuleUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    trigger_type: Optional[str] = None
    conditions: Optional[Any] = None
    actions: Optional[List[Any]] = None
    is_active: Optional[bool] = None

class StepCreate(BaseModel):
    step_order: int
    delay_days: int
    subject: str
    body_html: str

class SequenceCreate(BaseModel):
    name: str
    description: Optional[str] = None
    is_active: Optional[bool] = True
    steps: Optional[List[StepCreate]] = []

class SequenceUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    is_active: Optional[bool] = None

class EnrollRequest(BaseModel):
    lead_id: int


# ── Automation Rules ────────────────────────────────────────────────────────

@router.get("/rules")
def list_rules(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    return db.query(AutomationRule).order_by(desc(AutomationRule.created_at)).all()

@router.post("/rules")
def create_rule(rule: RuleCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    db_rule = AutomationRule(**rule.model_dump(), created_by=current_user.id)
    db.add(db_rule)
    db.commit()
    db.refresh(db_rule)
    return db_rule

@router.patch("/rules/{rule_id}")
def update_rule(rule_id: int, rule: RuleUpdate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    db_rule = db.query(AutomationRule).filter(AutomationRule.id == rule_id).first()
    if not db_rule:
        raise HTTPException(status_code=404, detail="Rule not found")
    for k, v in rule.model_dump(exclude_unset=True).items():
        setattr(db_rule, k, v)
    db.commit()
    db.refresh(db_rule)
    return db_rule

@router.delete("/rules/{rule_id}")
def delete_rule(rule_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    db_rule = db.query(AutomationRule).filter(AutomationRule.id == rule_id).first()
    if not db_rule:
        raise HTTPException(status_code=404, detail="Rule not found")
    db.delete(db_rule)
    db.commit()
    return {"ok": True}


# ── Email Sequences ────────────────────────────────────────────────────────

@router.get("/sequences")
def list_sequences(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    seqs = db.query(EmailSequence).order_by(desc(EmailSequence.created_at)).all()
    result = []
    for s in seqs:
        enrollment_count = db.query(EmailSequenceEnrollment).filter(EmailSequenceEnrollment.sequence_id == s.id).count()
        result.append({
            "id": s.id, "name": s.name, "description": s.description,
            "is_active": s.is_active, "step_count": len(s.steps),
            "enrollment_count": enrollment_count,
            "created_at": s.created_at,
        })
    return result

@router.post("/sequences")
def create_sequence(seq: SequenceCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    db_seq = EmailSequence(name=seq.name, description=seq.description, is_active=seq.is_active, created_by=current_user.id)
    db.add(db_seq)
    db.flush()
    for step in (seq.steps or []):
        db.add(EmailSequenceStep(sequence_id=db_seq.id, **step.model_dump()))
    db.commit()
    db.refresh(db_seq)
    return db_seq

@router.get("/sequences/{seq_id}")
def get_sequence(seq_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    seq = db.query(EmailSequence).filter(EmailSequence.id == seq_id).first()
    if not seq:
        raise HTTPException(status_code=404, detail="Sequence not found")
    enrollments = db.query(EmailSequenceEnrollment).filter(EmailSequenceEnrollment.sequence_id == seq_id).all()
    return {
        "id": seq.id, "name": seq.name, "description": seq.description,
        "is_active": seq.is_active, "steps": seq.steps,
        "enrollments": [{"id": e.id, "lead_id": e.lead_id, "status": e.status,
                          "current_step": e.current_step, "next_send_at": e.next_send_at} for e in enrollments],
    }

@router.patch("/sequences/{seq_id}")
def update_sequence(seq_id: int, seq: SequenceUpdate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    db_seq = db.query(EmailSequence).filter(EmailSequence.id == seq_id).first()
    if not db_seq:
        raise HTTPException(status_code=404, detail="Not found")
    for k, v in seq.model_dump(exclude_unset=True).items():
        setattr(db_seq, k, v)
    db.commit()
    db.refresh(db_seq)
    return db_seq

@router.post("/sequences/{seq_id}/steps")
def add_step(seq_id: int, step: StepCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    db_step = EmailSequenceStep(sequence_id=seq_id, **step.model_dump())
    db.add(db_step)
    db.commit()
    db.refresh(db_step)
    return db_step

@router.delete("/sequences/{seq_id}/steps/{step_id}")
def delete_step(seq_id: int, step_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    step = db.query(EmailSequenceStep).filter(EmailSequenceStep.id == step_id, EmailSequenceStep.sequence_id == seq_id).first()
    if not step:
        raise HTTPException(status_code=404, detail="Step not found")
    db.delete(step)
    db.commit()
    return {"ok": True}

@router.post("/sequences/{seq_id}/enroll")
def enroll_lead(seq_id: int, req: EnrollRequest, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    seq = db.query(EmailSequence).filter(EmailSequence.id == seq_id).first()
    if not seq:
        raise HTTPException(status_code=404, detail="Sequence not found")
    existing = db.query(EmailSequenceEnrollment).filter(
        EmailSequenceEnrollment.sequence_id == seq_id,
        EmailSequenceEnrollment.lead_id == req.lead_id,
        EmailSequenceEnrollment.status == "active",
    ).first()
    if existing:
        raise HTTPException(status_code=400, detail="Lead already enrolled in this sequence")

    from datetime import timedelta
    first_step = db.query(EmailSequenceStep).filter(EmailSequenceStep.sequence_id == seq_id).order_by(EmailSequenceStep.step_order).first()
    next_send = datetime.utcnow() + timedelta(days=first_step.delay_days) if first_step else None

    enrollment = EmailSequenceEnrollment(sequence_id=seq_id, lead_id=req.lead_id, next_send_at=next_send)
    db.add(enrollment)
    db.commit()
    db.refresh(enrollment)
    return enrollment

@router.post("/sequences/{seq_id}/unenroll/{lead_id}")
def unenroll_lead(seq_id: int, lead_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    enrollment = db.query(EmailSequenceEnrollment).filter(
        EmailSequenceEnrollment.sequence_id == seq_id,
        EmailSequenceEnrollment.lead_id == lead_id,
    ).first()
    if not enrollment:
        raise HTTPException(status_code=404, detail="Enrollment not found")
    enrollment.status = EnrollmentStatus.PAUSED
    db.commit()
    return {"ok": True}
```

**Step 2: Register in `main.py`**

Import:
```python
from app.routes import automation as automation_routes
```

Include router (after crm_organizations):
```python
app.include_router(automation_routes.router)
```

**Step 3: Verify**

Restart → http://localhost:8000/docs → automation endpoints appear.

**Step 4: Commit**

```bash
git add backend/app/routes/automation.py backend/main.py
git commit -m "feat(crm): add automation rules and email sequence CRUD routes"
```

---

### Task P4-3: Add automation background jobs

**Files:**
- Modify: `backend/main.py`

**Step 1: Add `evaluate_automation_rules` job**

After `check_overdue_crm_tasks` function (from Phase 1), add:

```python
        def evaluate_automation_rules():
            """Evaluate active automation rules against leads every 5 minutes."""
            from app.models.automation import AutomationRule
            from app.models.crm import Lead, Task as CrmTask, Activity, LeadStatus
            from datetime import datetime, timedelta

            db = SessionLocal()
            try:
                rules = db.query(AutomationRule).filter(AutomationRule.is_active == True).all()
                for rule in rules:
                    try:
                        leads = db.query(Lead).all()
                        for lead in leads:
                            conditions = rule.conditions or {}
                            matched = False

                            if rule.trigger_type == "no_activity":
                                days = conditions.get("days", 3)
                                cutoff = datetime.utcnow() - timedelta(days=days)
                                last_activity = db.query(Activity).filter(
                                    Activity.lead_id == lead.id,
                                    Activity.created_at >= cutoff,
                                ).first()
                                if not last_activity:
                                    matched = True

                            elif rule.trigger_type == "score_below":
                                threshold = conditions.get("threshold", 10)
                                if lead.score < threshold:
                                    matched = True

                            if matched:
                                for action in (rule.actions or []):
                                    action_type = action.get("type")
                                    if action_type == "create_task":
                                        existing = db.query(CrmTask).filter(
                                            CrmTask.lead_id == lead.id,
                                            CrmTask.title == action.get("title"),
                                            CrmTask.status == "open",
                                        ).first()
                                        if not existing:
                                            db.add(CrmTask(
                                                lead_id=lead.id,
                                                title=action.get("title", "Follow up"),
                                                assigned_to=lead.assigned_to,
                                            ))
                                    elif action_type == "change_lead_status":
                                        new_status = action.get("status")
                                        if new_status:
                                            lead.status = new_status

                        rule.last_run_at = datetime.utcnow()
                        db.commit()
                    except Exception as e:
                        logger.warning(f"Automation rule {rule.id} error: {e}")
                        db.rollback()
            except Exception as e:
                logger.error(f"evaluate_automation_rules error: {e}")
            finally:
                db.close()


        def process_email_sequences():
            """Send due email sequence steps to enrolled leads."""
            from app.models.automation import EmailSequenceEnrollment, EmailSequenceStep, EnrollmentStatus
            from app.models.crm import Lead
            from app.services.email_service import email_service
            from datetime import datetime, timedelta

            db = SessionLocal()
            try:
                now = datetime.utcnow()
                due = db.query(EmailSequenceEnrollment).filter(
                    EmailSequenceEnrollment.status == "active",
                    EmailSequenceEnrollment.next_send_at <= now,
                    EmailSequenceEnrollment.next_send_at.isnot(None),
                ).all()

                for enrollment in due:
                    try:
                        steps = db.query(EmailSequenceStep).filter(
                            EmailSequenceStep.sequence_id == enrollment.sequence_id,
                        ).order_by(EmailSequenceStep.step_order).all()

                        if enrollment.current_step >= len(steps):
                            enrollment.status = EnrollmentStatus.COMPLETED
                            enrollment.completed_at = now
                            db.commit()
                            continue

                        step = steps[enrollment.current_step]
                        lead = db.query(Lead).filter(Lead.id == enrollment.lead_id).first()

                        if lead and lead.email:
                            try:
                                import asyncio
                                loop = asyncio.get_event_loop()
                                asyncio.run_coroutine_threadsafe(
                                    email_service.send_email(
                                        to_email=lead.email,
                                        subject=step.subject,
                                        body=step.body_html,
                                    ),
                                    loop,
                                )
                            except Exception as send_err:
                                logger.warning(f"Sequence email send error: {send_err}")

                        enrollment.current_step += 1
                        if enrollment.current_step >= len(steps):
                            enrollment.status = EnrollmentStatus.COMPLETED
                            enrollment.completed_at = now
                        else:
                            next_step = steps[enrollment.current_step]
                            enrollment.next_send_at = now + timedelta(days=next_step.delay_days)

                        db.commit()
                    except Exception as e:
                        logger.warning(f"Sequence enrollment {enrollment.id} error: {e}")
                        db.rollback()
            except Exception as e:
                logger.error(f"process_email_sequences error: {e}")
            finally:
                db.close()
```

**Step 2: Register the jobs**

After existing `scheduler.add_job(check_overdue_crm_tasks, ...)` line, add:
```python
        scheduler.add_job(evaluate_automation_rules, 'interval', minutes=5, id='evaluate_automation_rules')
        scheduler.add_job(process_email_sequences, 'interval', minutes=1, id='process_email_sequences')
```

**Step 3: Commit**

```bash
git add backend/main.py
git commit -m "feat(crm): add automation rule evaluator and email sequence processor background jobs"
```

---

### Task P4-4: Automation UI page

**Files:**
- Create: `frontend/app/admin/crm/automation/page.tsx`

**Step 1: Create file**

```tsx
'use client'
import { useState, useEffect } from 'react'
import api from '@/lib/api'

const TRIGGER_TYPES = [
  { value: 'no_activity', label: 'No activity for X days' },
  { value: 'score_below', label: 'Lead score below threshold' },
  { value: 'lead_created', label: 'Lead created' },
  { value: 'lead_status_change', label: 'Lead status changes' },
]

const ACTION_TYPES = [
  { value: 'create_task', label: 'Create Task' },
  { value: 'change_lead_status', label: 'Change Lead Status' },
  { value: 'assign_lead', label: 'Assign Lead' },
]

export default function AutomationPage() {
  const [tab, setTab] = useState<'rules' | 'sequences'>('rules')
  const [rules, setRules] = useState<any[]>([])
  const [sequences, setSequences] = useState<any[]>([])
  const [showRuleForm, setShowRuleForm] = useState(false)
  const [showSeqForm, setShowSeqForm] = useState(false)
  const [ruleForm, setRuleForm] = useState({ name: '', trigger_type: 'no_activity', conditions: { days: 3 }, actions: [{ type: 'create_task', title: 'Follow up' }] })
  const [seqForm, setSeqForm] = useState({ name: '', description: '', steps: [{ step_order: 1, delay_days: 1, subject: '', body_html: '' }] })

  const loadRules = () => api.get('/crm/automation/rules').then(r => setRules(r.data))
  const loadSeqs = () => api.get('/crm/automation/sequences').then(r => setSequences(r.data))

  useEffect(() => { loadRules(); loadSeqs() }, [])

  const saveRule = async () => {
    await api.post('/crm/automation/rules', ruleForm)
    setShowRuleForm(false)
    setRuleForm({ name: '', trigger_type: 'no_activity', conditions: { days: 3 }, actions: [{ type: 'create_task', title: 'Follow up' }] })
    loadRules()
  }

  const toggleRule = async (rule: any) => {
    await api.patch(`/crm/automation/rules/${rule.id}`, { is_active: !rule.is_active })
    loadRules()
  }

  const deleteRule = async (id: number) => {
    if (!confirm('Delete this rule?')) return
    await api.delete(`/crm/automation/rules/${id}`)
    loadRules()
  }

  const saveSeq = async () => {
    await api.post('/crm/automation/sequences', seqForm)
    setShowSeqForm(false)
    setSeqForm({ name: '', description: '', steps: [{ step_order: 1, delay_days: 1, subject: '', body_html: '' }] })
    loadSeqs()
  }

  const addStep = () => setSeqForm(f => ({
    ...f,
    steps: [...f.steps, { step_order: f.steps.length + 1, delay_days: f.steps.length + 1, subject: '', body_html: '' }]
  }))

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Automation & Workflows</h1>
          <p className="text-sm text-gray-500 mt-1">Automate lead actions and email sequences</p>
        </div>
      </div>

      <div className="flex gap-1 mb-6 border-b">
        {(['rules', 'sequences'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium capitalize ${tab === t ? 'border-b-2 border-indigo-600 text-indigo-600' : 'text-gray-500 hover:text-gray-700'}`}>
            {t === 'rules' ? `Rules (${rules.length})` : `Email Sequences (${sequences.length})`}
          </button>
        ))}
      </div>

      {tab === 'rules' && (
        <div>
          <div className="flex justify-end mb-4">
            <button onClick={() => setShowRuleForm(true)} className="bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-indigo-700">
              + New Rule
            </button>
          </div>

          {showRuleForm && (
            <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-5 mb-6 space-y-4">
              <h3 className="font-semibold text-indigo-800">New Automation Rule</h3>
              <div>
                <label className="text-sm font-medium block mb-1">Rule Name</label>
                <input value={ruleForm.name} onChange={e => setRuleForm(f => ({ ...f, name: e.target.value }))}
                  className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none" placeholder="e.g. Follow up stale leads" />
              </div>
              <div>
                <label className="text-sm font-medium block mb-1">Trigger</label>
                <select value={ruleForm.trigger_type} onChange={e => setRuleForm(f => ({ ...f, trigger_type: e.target.value }))}
                  className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none">
                  {TRIGGER_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </div>
              {ruleForm.trigger_type === 'no_activity' && (
                <div>
                  <label className="text-sm font-medium block mb-1">Days without activity</label>
                  <input type="number" value={ruleForm.conditions.days || 3}
                    onChange={e => setRuleForm(f => ({ ...f, conditions: { ...f.conditions, days: parseInt(e.target.value) } }))}
                    className="border rounded-lg px-3 py-2 text-sm w-24 focus:outline-none" />
                </div>
              )}
              <div>
                <label className="text-sm font-medium block mb-1">Action</label>
                <select value={ruleForm.actions[0]?.type} onChange={e => setRuleForm(f => ({ ...f, actions: [{ ...f.actions[0], type: e.target.value }] }))}
                  className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none">
                  {ACTION_TYPES.map(a => <option key={a.value} value={a.value}>{a.label}</option>)}
                </select>
              </div>
              {ruleForm.actions[0]?.type === 'create_task' && (
                <div>
                  <label className="text-sm font-medium block mb-1">Task title</label>
                  <input value={ruleForm.actions[0]?.title || ''} onChange={e => setRuleForm(f => ({ ...f, actions: [{ ...f.actions[0], title: e.target.value }] }))}
                    className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none" placeholder="Task title" />
                </div>
              )}
              <div className="flex gap-3">
                <button onClick={saveRule} className="bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm">Save Rule</button>
                <button onClick={() => setShowRuleForm(false)} className="border px-4 py-2 rounded-lg text-sm text-gray-600">Cancel</button>
              </div>
            </div>
          )}

          <div className="space-y-3">
            {rules.map(rule => (
              <div key={rule.id} className="bg-white border rounded-xl px-4 py-4 flex items-center gap-4">
                <div className="flex-1">
                  <p className="font-medium text-sm">{rule.name}</p>
                  <p className="text-xs text-gray-400">Trigger: {rule.trigger_type} · {(rule.actions || []).length} action(s)</p>
                  {rule.last_run_at && <p className="text-xs text-gray-300">Last run: {new Date(rule.last_run_at).toLocaleString()}</p>}
                </div>
                <button onClick={() => toggleRule(rule)}
                  className={`px-3 py-1 rounded-full text-xs font-semibold ${rule.is_active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                  {rule.is_active ? 'Active' : 'Inactive'}
                </button>
                <button onClick={() => deleteRule(rule.id)} className="text-red-400 hover:text-red-600 text-xs">Delete</button>
              </div>
            ))}
            {rules.length === 0 && !showRuleForm && <p className="text-gray-400 text-sm">No automation rules yet.</p>}
          </div>
        </div>
      )}

      {tab === 'sequences' && (
        <div>
          <div className="flex justify-end mb-4">
            <button onClick={() => setShowSeqForm(true)} className="bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-indigo-700">
              + New Sequence
            </button>
          </div>

          {showSeqForm && (
            <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-5 mb-6 space-y-4">
              <h3 className="font-semibold text-indigo-800">New Email Sequence</h3>
              <div>
                <label className="text-sm font-medium block mb-1">Sequence Name</label>
                <input value={seqForm.name} onChange={e => setSeqForm(f => ({ ...f, name: e.target.value }))}
                  className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none" placeholder="e.g. New Lead Drip" />
              </div>
              <div>
                <label className="text-sm font-medium block mb-1">Steps</label>
                <div className="space-y-3">
                  {seqForm.steps.map((step, idx) => (
                    <div key={idx} className="bg-white border rounded-lg p-3 space-y-2">
                      <div className="flex items-center gap-3">
                        <span className="text-xs font-semibold text-indigo-600 w-16">Step {idx + 1}</span>
                        <label className="text-xs text-gray-500">Send after</label>
                        <input type="number" value={step.delay_days} min={0}
                          onChange={e => setSeqForm(f => {
                            const steps = [...f.steps]; steps[idx] = { ...steps[idx], delay_days: parseInt(e.target.value) }; return { ...f, steps }
                          })}
                          className="border rounded px-2 py-1 text-xs w-16 focus:outline-none" />
                        <span className="text-xs text-gray-500">days</span>
                      </div>
                      <input value={step.subject}
                        onChange={e => setSeqForm(f => { const steps = [...f.steps]; steps[idx] = { ...steps[idx], subject: e.target.value }; return { ...f, steps } })}
                        className="w-full border rounded px-2 py-1 text-sm focus:outline-none" placeholder="Email subject" />
                      <textarea value={step.body_html}
                        onChange={e => setSeqForm(f => { const steps = [...f.steps]; steps[idx] = { ...steps[idx], body_html: e.target.value }; return { ...f, steps } })}
                        rows={3} className="w-full border rounded px-2 py-1 text-sm focus:outline-none" placeholder="Email body (HTML supported)" />
                    </div>
                  ))}
                </div>
                <button onClick={addStep} className="mt-2 text-sm text-indigo-600 hover:text-indigo-800">+ Add Step</button>
              </div>
              <div className="flex gap-3">
                <button onClick={saveSeq} className="bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm">Save Sequence</button>
                <button onClick={() => setShowSeqForm(false)} className="border px-4 py-2 rounded-lg text-sm text-gray-600">Cancel</button>
              </div>
            </div>
          )}

          <div className="space-y-3">
            {sequences.map(seq => (
              <div key={seq.id} className="bg-white border rounded-xl px-4 py-4 flex items-center gap-4">
                <div className="flex-1">
                  <p className="font-medium text-sm">{seq.name}</p>
                  <p className="text-xs text-gray-400">{seq.step_count} steps · {seq.enrollment_count} enrolled</p>
                </div>
                <span className={`px-3 py-1 rounded-full text-xs font-semibold ${seq.is_active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                  {seq.is_active ? 'Active' : 'Inactive'}
                </span>
              </div>
            ))}
            {sequences.length === 0 && !showSeqForm && <p className="text-gray-400 text-sm">No email sequences yet.</p>}
          </div>
        </div>
      )}
    </div>
  )
}
```

**Step 2: Add to AdminNav**

In `AdminNav.tsx` CRM section, after Companies link, add:
```tsx
{ href: '/admin/crm/automation', label: 'Automation', icon: '⚡', permission: () => hasAdminFeature('feature_manage_crm') },
```

**Step 3: Commit**

```bash
git add frontend/app/admin/crm/automation/page.tsx frontend/components/AdminNav.tsx
git commit -m "feat(crm): add Automation & Workflows UI page"
```

---

# PHASE 5: Reporting & Insights

---

### Task P5-1: Create reporting routes

**Files:**
- Create: `backend/app/routes/crm_reports.py`

**Step 1: Create file**

```python
from fastapi import APIRouter, Depends, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from sqlalchemy import func, desc
from datetime import datetime, timedelta
import csv
import io

from app.database import get_db
from app.models.crm import Lead, Deal, Task, Activity, LeadStatus
from app.models.user import User
from app.dependencies import get_current_user

router = APIRouter(prefix="/crm/reports", tags=["crm-reports"])


@router.get("/agent-performance")
def agent_performance(
    days: int = Query(30),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    since = datetime.utcnow() - timedelta(days=days)
    agents = db.query(User).filter(User.is_active == True).all()
    result = []
    for agent in agents:
        leads_assigned = db.query(func.count(Lead.id)).filter(Lead.assigned_to == agent.id).scalar() or 0
        deals_closed = db.query(func.count(Deal.id)).filter(Deal.assigned_to == agent.id, Deal.stage == "won").scalar() or 0
        total_deals = db.query(func.count(Deal.id)).filter(Deal.assigned_to == agent.id, Deal.stage.in_(["won", "lost"])).scalar() or 0
        won_revenue = db.query(func.sum(Deal.amount)).filter(Deal.assigned_to == agent.id, Deal.stage == "won").scalar() or 0
        avg_deal = won_revenue / deals_closed if deals_closed else 0
        result.append({
            "agent_id": agent.id,
            "agent_name": f"{agent.first_name or ''} {agent.last_name or ''}".strip() or agent.email,
            "agent_email": agent.email,
            "leads_assigned": leads_assigned,
            "deals_closed": deals_closed,
            "win_rate": round(deals_closed / total_deals * 100, 1) if total_deals else 0,
            "total_revenue": round(float(won_revenue), 2),
            "avg_deal_value": round(avg_deal, 2),
        })
    return sorted(result, key=lambda x: x["total_revenue"], reverse=True)


@router.get("/lead-aging")
def lead_aging(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    statuses = ["new", "contacted", "qualified", "lost", "converted"]
    result = []
    for status in statuses:
        leads = db.query(Lead).filter(Lead.status == status).all()
        if not leads:
            result.append({"status": status, "count": 0, "avg_age_days": 0, "oldest_days": 0})
            continue
        ages = [(datetime.utcnow() - l.created_at).days for l in leads]
        result.append({
            "status": status,
            "count": len(leads),
            "avg_age_days": round(sum(ages) / len(ages), 1),
            "oldest_days": max(ages),
        })
    return result


@router.get("/revenue")
def revenue_report(
    months: int = Query(6),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    import calendar as cal
    result = []
    now = datetime.utcnow()
    for i in range(months - 1, -1, -1):
        offset_month = now.month - i
        offset_year = now.year
        while offset_month <= 0:
            offset_month += 12
            offset_year -= 1
        month_start = datetime(offset_year, offset_month, 1)
        last_day = cal.monthrange(offset_year, offset_month)[1]
        month_end = datetime(offset_year, offset_month, last_day, 23, 59, 59)

        actual = db.query(func.sum(Deal.amount)).filter(
            Deal.stage == "won",
            Deal.closed_at >= month_start,
            Deal.closed_at <= month_end,
        ).scalar() or 0

        forecasted = db.query(func.sum(Deal.amount * Deal.probability / 100)).filter(
            Deal.stage.notin_(["won", "lost"]),
            Deal.expected_close_date >= month_start,
            Deal.expected_close_date <= month_end,
        ).scalar() or 0

        result.append({
            "month": month_start.strftime("%Y-%m"),
            "month_label": month_start.strftime("%b %Y"),
            "actual": round(float(actual), 2),
            "forecasted": round(float(forecasted), 2),
        })
    return result


@router.get("/export")
def export_csv(
    type: str = Query("leads"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    output = io.StringIO()
    writer = csv.writer(output)

    if type == "leads":
        writer.writerow(["ID", "First Name", "Last Name", "Email", "Phone", "Company", "Status", "Source", "Score", "Created At"])
        for l in db.query(Lead).order_by(desc(Lead.created_at)).all():
            writer.writerow([l.id, l.first_name, l.last_name, l.email, l.phone, l.company, l.status, l.source, l.score, l.created_at])
    elif type == "deals":
        writer.writerow(["ID", "Name", "Lead ID", "Stage", "Amount", "Probability", "Expected Close", "Closed At", "Created At"])
        for d in db.query(Deal).order_by(desc(Deal.created_at)).all():
            writer.writerow([d.id, d.name, d.lead_id, d.stage, d.amount, d.probability, d.expected_close_date, d.closed_at, d.created_at])
    elif type == "tasks":
        writer.writerow(["ID", "Title", "Lead ID", "Status", "Due Date", "Completed At", "Created At"])
        for t in db.query(Task).order_by(desc(Task.created_at)).all():
            writer.writerow([t.id, t.title, t.lead_id, t.status, t.due_date, t.completed_at, t.created_at])

    output.seek(0)
    filename = f"crm_{type}_{datetime.utcnow().strftime('%Y%m%d')}.csv"
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )
```

**Step 2: Register in `main.py`**

```python
from app.routes import crm_reports
```

```python
app.include_router(crm_reports.router)
```

**Step 3: Verify**

Restart → http://localhost:8000/docs → 4 report endpoints appear.

**Step 4: Commit**

```bash
git add backend/app/routes/crm_reports.py backend/main.py
git commit -m "feat(crm): add agent performance, lead aging, revenue, and CSV export report endpoints"
```

---

### Task P5-2: Reports UI page

**Files:**
- Create: `frontend/app/admin/crm/reports/page.tsx`

**Step 1: Create file**

```tsx
'use client'
import { useState, useEffect } from 'react'
import api from '@/lib/api'

export default function ReportsPage() {
  const [tab, setTab] = useState<'agents' | 'aging' | 'revenue' | 'export'>('agents')
  const [agentData, setAgentData] = useState<any[]>([])
  const [agingData, setAgingData] = useState<any[]>([])
  const [revenueData, setRevenueData] = useState<any[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    setLoading(true)
    Promise.all([
      api.get('/crm/reports/agent-performance?days=30').then(r => setAgentData(r.data)),
      api.get('/crm/reports/lead-aging').then(r => setAgingData(r.data)),
      api.get('/crm/reports/revenue?months=6').then(r => setRevenueData(r.data)),
    ]).finally(() => setLoading(false))
  }, [])

  const downloadCSV = (type: string) => {
    const url = `${process.env.NEXT_PUBLIC_API_URL}/crm/reports/export?type=${type}`
    const token = localStorage.getItem('auth_token') || localStorage.getItem('token') || ''
    fetch(url, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.blob())
      .then(blob => {
        const a = document.createElement('a')
        a.href = URL.createObjectURL(blob)
        a.download = `crm_${type}_${new Date().toISOString().slice(0,10)}.csv`
        a.click()
      })
  }

  const agingColor = (days: number) =>
    days > 30 ? 'text-red-600' : days > 7 ? 'text-yellow-600' : 'text-green-600'

  const maxRevenue = Math.max(...revenueData.flatMap(r => [r.actual, r.forecasted]), 1)

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">CRM Reports</h1>
        <p className="text-sm text-gray-500 mt-1">Operational and revenue insights</p>
      </div>

      <div className="flex gap-1 mb-6 border-b">
        {(['agents', 'aging', 'revenue', 'export'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium capitalize ${tab === t ? 'border-b-2 border-indigo-600 text-indigo-600' : 'text-gray-500 hover:text-gray-700'}`}>
            {t === 'agents' ? 'Agent Performance' : t === 'aging' ? 'Lead Aging' : t === 'revenue' ? 'Revenue' : 'Export'}
          </button>
        ))}
      </div>

      {loading && <div className="text-gray-400 text-sm">Loading...</div>}

      {!loading && tab === 'agents' && (
        <div>
          <div className="bg-white rounded-xl border overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wide">
                <tr>
                  <th className="px-4 py-3 text-left">Agent</th>
                  <th className="px-4 py-3 text-center">Leads</th>
                  <th className="px-4 py-3 text-center">Deals Closed</th>
                  <th className="px-4 py-3 text-center">Win Rate</th>
                  <th className="px-4 py-3 text-right">Revenue</th>
                  <th className="px-4 py-3 text-right">Avg Deal</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {agentData.map(a => (
                  <tr key={a.agent_id} className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <p className="font-medium">{a.agent_name}</p>
                      <p className="text-xs text-gray-400">{a.agent_email}</p>
                    </td>
                    <td className="px-4 py-3 text-center">{a.leads_assigned}</td>
                    <td className="px-4 py-3 text-center">{a.deals_closed}</td>
                    <td className="px-4 py-3 text-center">
                      <span className={`font-semibold ${a.win_rate >= 50 ? 'text-green-600' : a.win_rate >= 25 ? 'text-yellow-600' : 'text-red-500'}`}>
                        {a.win_rate}%
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right font-semibold">${a.total_revenue.toLocaleString()}</td>
                    <td className="px-4 py-3 text-right text-gray-600">${a.avg_deal_value.toLocaleString()}</td>
                  </tr>
                ))}
                {agentData.length === 0 && <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-400">No data.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {!loading && tab === 'aging' && (
        <div className="bg-white rounded-xl border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wide">
              <tr>
                <th className="px-4 py-3 text-left">Status</th>
                <th className="px-4 py-3 text-center">Count</th>
                <th className="px-4 py-3 text-center">Avg Age</th>
                <th className="px-4 py-3 text-center">Oldest</th>
                <th className="px-4 py-3 text-left">Age Distribution</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {agingData.map(row => (
                <tr key={row.status} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium capitalize">{row.status}</td>
                  <td className="px-4 py-3 text-center">{row.count}</td>
                  <td className={`px-4 py-3 text-center font-semibold ${agingColor(row.avg_age_days)}`}>{row.avg_age_days}d</td>
                  <td className={`px-4 py-3 text-center ${agingColor(row.oldest_days)}`}>{row.oldest_days}d</td>
                  <td className="px-4 py-3">
                    <div className="w-full bg-gray-100 rounded-full h-2">
                      <div className={`h-2 rounded-full ${row.avg_age_days > 30 ? 'bg-red-400' : row.avg_age_days > 7 ? 'bg-yellow-400' : 'bg-green-400'}`}
                        style={{ width: `${Math.min(row.avg_age_days / 60 * 100, 100)}%` }} />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!loading && tab === 'revenue' && (
        <div>
          <div className="bg-white rounded-xl border p-6">
            <div className="flex items-center gap-6 mb-4 text-xs">
              <span className="flex items-center gap-2"><span className="w-3 h-3 bg-green-500 rounded inline-block" /> Actual (Won)</span>
              <span className="flex items-center gap-2"><span className="w-3 h-3 bg-indigo-300 rounded inline-block" /> Forecasted</span>
            </div>
            <div className="flex items-end gap-4 h-48">
              {revenueData.map(r => (
                <div key={r.month} className="flex-1 flex flex-col items-center gap-1">
                  <div className="w-full flex items-end gap-1 h-36">
                    <div className="flex-1 bg-green-500 rounded-t" style={{ height: `${Math.max(r.actual / maxRevenue * 100, r.actual > 0 ? 4 : 0)}%` }} />
                    <div className="flex-1 bg-indigo-300 rounded-t" style={{ height: `${Math.max(r.forecasted / maxRevenue * 100, r.forecasted > 0 ? 4 : 0)}%` }} />
                  </div>
                  <span className="text-xs text-gray-400">{r.month_label}</span>
                </div>
              ))}
            </div>
            <div className="mt-4 grid grid-cols-6 gap-2 text-xs text-center text-gray-500">
              {revenueData.map(r => (
                <div key={r.month}>
                  <p className="text-green-600">${(r.actual / 1000).toFixed(1)}k</p>
                  <p className="text-indigo-400">${(r.forecasted / 1000).toFixed(1)}k</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {tab === 'export' && (
        <div className="max-w-md">
          <div className="bg-white rounded-xl border p-6 space-y-4">
            <h2 className="font-semibold text-gray-700">Download CSV Reports</h2>
            <p className="text-sm text-gray-500">Export data for offline analysis or import into other tools.</p>
            <div className="space-y-3">
              {[
                { type: 'leads', label: 'Leads', desc: 'All leads with status, source, and score' },
                { type: 'deals', label: 'Deals', desc: 'All deals with stage, amount, and close dates' },
                { type: 'tasks', label: 'Tasks', desc: 'All CRM tasks with status and due dates' },
              ].map(item => (
                <div key={item.type} className="flex items-center justify-between border rounded-lg px-4 py-3">
                  <div>
                    <p className="font-medium text-sm">{item.label}</p>
                    <p className="text-xs text-gray-400">{item.desc}</p>
                  </div>
                  <button onClick={() => downloadCSV(item.type)}
                    className="bg-indigo-600 text-white px-3 py-1.5 rounded text-xs font-medium hover:bg-indigo-700">
                    Download
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
```

**Step 2: Add to AdminNav**

In the CRM section of `AdminNav.tsx`, after Automation link, add:
```tsx
{ href: '/admin/crm/reports', label: 'Reports', icon: '📊', permission: () => hasAdminFeature('feature_manage_crm') },
```

**Step 3: Commit**

```bash
git add frontend/app/admin/crm/reports/page.tsx frontend/components/AdminNav.tsx
git commit -m "feat(crm): add Reports & Insights page with agent performance, lead aging, revenue, and CSV export"
```

---

## Final Verification Checklist

After all phases are complete, verify:

- [ ] Phase 1: CRM banner in ChatWindow for linked conversations, toast notifications, AdminNav badge
- [ ] Phase 2: `/admin/crm/companies` loads list, create form works, detail page shows contacts + leads tabs, lead form has company dropdown
- [ ] Phase 3: `/admin/crm/analytics` shows forecast bars, win/loss progress bars, funnel, velocity chart
- [ ] Phase 4: `/admin/crm/automation` — create a rule (no activity 3 days → create task), create sequence with 2 steps, backend logs show jobs running
- [ ] Phase 5: `/admin/crm/reports` — agent table, lead aging table with color coding, revenue chart, CSV download works

---

**Plan complete and saved to `docs/plans/2026-03-04-crm-complete-implementation.md`.**

**Two execution options:**

**1. Subagent-Driven (this session)** — Fresh subagent per task, review between tasks, fast iteration

**2. Parallel Session (separate)** — Open new session with executing-plans, batch execution with checkpoints

**Which approach?**
