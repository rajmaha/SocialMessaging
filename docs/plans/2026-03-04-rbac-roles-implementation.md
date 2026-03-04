# RBAC Role System Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the current `admin/user` two-value role system with a full RBAC system — fixed system roles + custom admin-managed roles — with page-level access control on both backend and frontend.

**Architecture:** A new `roles` DB table stores all roles (system and custom) with a `pages` JSON array. The `users.role` column stores the slug of the assigned role. Backend gets a `require_page()` dependency; frontend gets a `middleware.ts` + updated `AdminNav`.

**Tech Stack:** FastAPI + SQLAlchemy (backend), Next.js 14 App Router + TypeScript (frontend), PostgreSQL, TailwindCSS. No test framework — use Swagger UI at http://localhost:8000/docs for backend verification.

---

## Page Key Reference

| Key | Routes guarded |
|---|---|
| `pms` | `/admin/pms/*` |
| `tickets` | `/admin/tickets/*`, `/admin/ticket-fields` |
| `crm` | `/admin/crm/*` |
| `messaging` | `/dashboard/*` |
| `callcenter` | `/admin/callcenter`, `/admin/recordings`, `/admin/extensions`, `/admin/telephony` |
| `campaigns` | `/admin/campaigns/*`, `/admin/email-templates` |
| `reports` | `/admin/reports`, `/admin/usage` |
| `kb` | `/admin/kb/*` |
| `teams` | `/admin/teams` |

Admin role bypasses all page checks.

---

## Task 1: DB Migration — `roles` table + seed fixed roles

**Files:**
- Modify: `backend/main.py` — inside `_run_inline_migrations()`

**Step 1: Add the migration SQL**

Inside `_run_inline_migrations()` in `backend/main.py`, add AFTER the existing migrations:

```python
# ── RBAC Roles ──────────────────────────────────────────────
conn.execute(text("""
    CREATE TABLE IF NOT EXISTS roles (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        slug VARCHAR(100) UNIQUE NOT NULL,
        is_system BOOLEAN DEFAULT FALSE,
        pages JSONB DEFAULT '[]',
        created_at TIMESTAMP DEFAULT NOW()
    )
"""))

# Seed fixed system roles (upsert by slug)
fixed_roles = [
    ('Admin',               'admin',              True,  '["pms","tickets","crm","messaging","callcenter","campaigns","reports","kb","teams"]'),
    ('Project Manager',     'project_manager',    True,  '["pms","tickets","teams","reports","crm","kb"]'),
    ('Developer',           'developer',          True,  '["pms","tickets"]'),
    ('Frontend / Designer', 'frontend_designer',  True,  '["pms","tickets"]'),
    ('QA',                  'qa',                 True,  '["pms","tickets"]'),
    ('Support',             'support',            True,  '["messaging","callcenter","tickets","kb"]'),
    ('Sales',               'sales',              True,  '["crm","messaging","campaigns"]'),
    ('Marketer',            'marketer',           True,  '["campaigns","reports"]'),
    ('Viewer',              'viewer',             True,  '[]'),
]
for name, slug, is_system, pages in fixed_roles:
    conn.execute(text("""
        INSERT INTO roles (name, slug, is_system, pages)
        VALUES (:name, :slug, :is_system, :pages::jsonb)
        ON CONFLICT (slug) DO NOTHING
    """), {"name": name, "slug": slug, "is_system": is_system, "pages": pages})
```

**Step 2: Migrate existing users.role values**

Still inside `_run_inline_migrations()`, add AFTER the roles seed:

```python
# Migrate old role values: 'user' → 'support', keep 'admin'
conn.execute(text("""
    UPDATE users SET role = 'support' WHERE role = 'user'
"""))
```

**Step 3: Verify**

Start backend: `cd backend && source venv/bin/activate && uvicorn main:app --reload`

Check logs for no migration errors. Then in Swagger (`http://localhost:8000/docs`) or psql:
```sql
SELECT slug, name, is_system FROM roles ORDER BY id;
SELECT DISTINCT role FROM users;
```
Expected: 9 rows in `roles`, `users.role` values are `admin` or `support`.

**Step 4: Commit**

```bash
git add backend/main.py
git commit -m "feat: add roles table with fixed system roles and migrate users.role"
```

---

## Task 2: SQLAlchemy Model for Role

**Files:**
- Create: `backend/app/models/role.py`
- Modify: `backend/app/models/__init__.py` (add import)

**Step 1: Create the model**

```python
# backend/app/models/role.py
from sqlalchemy import Column, Integer, String, Boolean, DateTime
from sqlalchemy.dialects.postgresql import JSONB
from datetime import datetime
from app.database import Base


class Role(Base):
    __tablename__ = "roles"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(100), nullable=False)
    slug = Column(String(100), unique=True, nullable=False)
    is_system = Column(Boolean, default=False)
    pages = Column(JSONB, default=list)
    created_at = Column(DateTime, default=datetime.utcnow)
```

**Step 2: Register in models __init__**

Open `backend/app/models/__init__.py` and add:
```python
from app.models.role import Role  # noqa: F401
```

**Step 3: Verify**

Restart backend — no import errors in logs.

**Step 4: Commit**

```bash
git add backend/app/models/role.py backend/app/models/__init__.py
git commit -m "feat: add Role SQLAlchemy model"
```

---

## Task 3: Pydantic Schemas for Roles

**Files:**
- Create: `backend/app/schemas/role.py`

**Step 1: Create schemas**

```python
# backend/app/schemas/role.py
from pydantic import BaseModel
from typing import List, Optional
from datetime import datetime


class RoleCreate(BaseModel):
    name: str
    slug: str
    pages: List[str] = []


class RoleUpdate(BaseModel):
    name: Optional[str] = None
    pages: Optional[List[str]] = None


class RoleOut(BaseModel):
    id: int
    name: str
    slug: str
    is_system: bool
    pages: List[str]
    created_at: datetime

    class Config:
        from_attributes = True


class UserRoleUpdate(BaseModel):
    role: str  # slug of the target role
```

**Step 2: Commit**

```bash
git add backend/app/schemas/role.py
git commit -m "feat: add Role Pydantic schemas"
```

---

## Task 4: Roles API Routes

**Files:**
- Create: `backend/app/routes/roles.py`
- Modify: `backend/main.py` — register router

**Step 1: Create roles router**

```python
# backend/app/routes/roles.py
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from app.database import get_db
from app.dependencies import get_current_user, get_admin_user
from app.models.role import Role
from app.schemas.role import RoleCreate, RoleUpdate, RoleOut
from typing import List

router = APIRouter(prefix="/roles", tags=["roles"])


@router.get("", response_model=List[RoleOut])
def list_roles(db: Session = Depends(get_db), _=Depends(get_current_user)):
    """Any logged-in user can list roles (needed for user management dropdowns)."""
    return db.query(Role).order_by(Role.id).all()


@router.post("", response_model=RoleOut)
def create_role(data: RoleCreate, db: Session = Depends(get_db), _=Depends(get_admin_user)):
    if db.query(Role).filter(Role.slug == data.slug).first():
        raise HTTPException(400, "A role with that slug already exists")
    role = Role(name=data.name, slug=data.slug, pages=data.pages, is_system=False)
    db.add(role)
    db.commit()
    db.refresh(role)
    return role


@router.put("/{role_id}", response_model=RoleOut)
def update_role(role_id: int, data: RoleUpdate, db: Session = Depends(get_db), _=Depends(get_admin_user)):
    role = db.query(Role).filter(Role.id == role_id).first()
    if not role:
        raise HTTPException(404, "Role not found")
    if role.is_system:
        raise HTTPException(403, "System roles cannot be modified")
    if data.name is not None:
        role.name = data.name
    if data.pages is not None:
        role.pages = data.pages
    db.commit()
    db.refresh(role)
    return role


@router.delete("/{role_id}")
def delete_role(role_id: int, db: Session = Depends(get_db), _=Depends(get_admin_user)):
    role = db.query(Role).filter(Role.id == role_id).first()
    if not role:
        raise HTTPException(404, "Role not found")
    if role.is_system:
        raise HTTPException(403, "System roles cannot be deleted")
    # Reassign users with this role to 'viewer'
    from app.models.user import User
    db.query(User).filter(User.role == role.slug).update({"role": "viewer"})
    db.delete(role)
    db.commit()
    return {"ok": True}
```

**Step 2: Register in main.py**

Find the block where other routers are registered (e.g. `app.include_router(pms_routes.router)`) and add:

```python
from app.routes import roles as roles_routes
app.include_router(roles_routes.router)
```

**Step 3: Verify in Swagger**

- `GET /roles` → returns 9 system roles
- `POST /roles` with `{"name":"Freelancer","slug":"freelancer","pages":["pms"]}` → creates custom role
- `DELETE /roles/{id}` on a system role → 403 error
- `DELETE /roles/{id}` on the custom role → deletes it

**Step 4: Commit**

```bash
git add backend/app/routes/roles.py backend/main.py
git commit -m "feat: add roles CRUD API (system roles protected)"
```

---

## Task 5: User Role Change Endpoint

**Files:**
- Modify: `backend/app/routes/admin.py`

**Step 1: Add schema import and endpoint**

In `backend/app/routes/admin.py`, find the imports and add:
```python
from app.schemas.role import UserRoleUpdate
from app.models.role import Role
```

Then add this endpoint (near other user management endpoints):

```python
@router.patch("/users/{user_id}/role")
def change_user_role(
    user_id: int,
    data: UserRoleUpdate,
    db: Session = Depends(get_db),
    current_user=Depends(get_admin_user)
):
    if current_user.user_id == user_id:
        raise HTTPException(400, "You cannot change your own role")
    user = db.query(User).filter(User.user_id == user_id).first()
    if not user:
        raise HTTPException(404, "User not found")
    # Validate role exists
    role = db.query(Role).filter(Role.slug == data.role).first()
    if not role:
        raise HTTPException(400, f"Role '{data.role}' does not exist")
    user.role = data.role
    db.commit()
    return {"ok": True, "role": data.role}
```

**Step 2: Verify in Swagger**

`PATCH /admin/users/{id}/role` with `{"role": "developer"}` → `{"ok": true, "role": "developer"}`

**Step 3: Commit**

```bash
git add backend/app/routes/admin.py
git commit -m "feat: add PATCH /admin/users/{id}/role endpoint"
```

---

## Task 6: `require_page()` Backend Dependency

**Files:**
- Modify: `backend/app/dependencies.py`

**Step 1: Add the dependency**

In `backend/app/dependencies.py`, add after the existing `require_admin_feature` function:

```python
def require_page(page_key: str):
    """
    Dependency factory: checks that the current user's role grants access
    to the given page key. Admins bypass this check.
    Usage: Depends(require_page("pms"))
    """
    async def _check(
        current_user=Depends(get_current_user),
        db: Session = Depends(get_db)
    ):
        if current_user.role == "admin":
            return current_user
        from app.models.role import Role
        role = db.query(Role).filter(Role.slug == current_user.role).first()
        if not role or page_key not in (role.pages or []):
            raise HTTPException(
                status_code=403,
                detail=f"Your role does not have access to the '{page_key}' module"
            )
        return current_user
    return _check
```

**Step 2: Add page guards to PMS routes**

Open `backend/app/routes/pms.py`. At the top, import the new dependency:
```python
from app.dependencies import require_page
```

Find the `list_projects` endpoint (first endpoint in the file) and add the dependency:
```python
@router.get("/projects", ...)
def list_projects(..., _page=Depends(require_page("pms"))):
```

> Note: You only need to guard the list/entry endpoints — not every sub-endpoint. The frontend middleware handles the rest. Apply `require_page("pms")` to `list_projects`, `create_project`, `get_project`.

**Step 3: Add page guards to CRM routes**

Open `backend/app/routes/crm.py`. Import and apply:
```python
from app.dependencies import require_page
# Add _page=Depends(require_page("crm")) to the first GET and POST endpoints
```

**Step 4: Apply to other key routes**

Apply `require_page()` to the first endpoint in each module:

| File | Page key |
|---|---|
| `backend/app/routes/campaigns.py` | `"campaigns"` |
| `backend/app/routes/reports.py` | `"reports"` |
| `backend/app/routes/kb.py` | `"kb"` |
| `backend/app/routes/call_center.py` | `"callcenter"` |
| `backend/app/routes/teams.py` | `"teams"` |
| `backend/app/routes/tickets.py` | `"tickets"` |

**Step 5: Verify**

Log in as a `support` user. Try `GET /pms/projects` in Swagger → should get 403 "does not have access to pms module".
Log in as admin → same endpoint works fine.

**Step 6: Commit**

```bash
git add backend/app/dependencies.py backend/app/routes/pms.py backend/app/routes/crm.py backend/app/routes/campaigns.py backend/app/routes/reports.py backend/app/routes/kb.py backend/app/routes/call_center.py backend/app/routes/teams.py backend/app/routes/tickets.py
git commit -m "feat: add require_page() dependency and apply to module routes"
```

---

## Task 7: Frontend — Roles API Client

**Files:**
- Modify: `frontend/lib/api.ts`

**Step 1: Add rolesApi to lib/api.ts**

At the end of `frontend/lib/api.ts`, append:

```typescript
// ─── Roles API ───────────────────────────────────────────────────────────────
export const rolesApi = {
  list: () => api.get('/roles'),
  create: (data: { name: string; slug: string; pages: string[] }) =>
    api.post('/roles', data),
  update: (id: number, data: { name?: string; pages?: string[] }) =>
    api.put(`/roles/${id}`, data),
  delete: (id: number) => api.delete(`/roles/${id}`),
  changeUserRole: (userId: number, role: string) =>
    api.patch(`/admin/users/${userId}/role`, { role }),
}
```

**Step 2: Commit**

```bash
git add frontend/lib/api.ts
git commit -m "feat: add rolesApi client"
```

---

## Task 8: Frontend — Page Access Helper

**Files:**
- Modify: `frontend/lib/permissions.ts`

**Step 1: Add page-key helpers**

Append to `frontend/lib/permissions.ts`:

```typescript
// ─── Page-level role access (new RBAC system) ─────────────────────────────

/**
 * Store the current user's page keys after login.
 * Call this once after login or role change.
 */
export function storeUserPages(pages: string[]): void {
  localStorage.setItem('user_pages', JSON.stringify(pages))
}

/**
 * Check if the current user's role grants access to a page key.
 * Admins always return true.
 */
export function hasPageAccess(pageKey: string): boolean {
  try {
    const user = localStorage.getItem('user')
    if (!user) return false
    const parsed = JSON.parse(user)
    if (parsed.role === 'admin') return true
    const stored = localStorage.getItem('user_pages')
    if (!stored) return false
    const pages: string[] = JSON.parse(stored)
    return pages.includes(pageKey)
  } catch {
    return false
  }
}

/**
 * Load and cache the user's page keys from their role.
 * Call after login. Returns the pages array.
 */
export async function fetchAndStoreUserPages(): Promise<string[]> {
  try {
    const user = localStorage.getItem('user')
    if (!user) return []
    const parsed = JSON.parse(user)
    if (parsed.role === 'admin') {
      const allPages = ['pms','tickets','crm','messaging','callcenter','campaigns','reports','kb','teams']
      storeUserPages(allPages)
      return allPages
    }
    const { rolesApi } = await import('./api')
    const res = await rolesApi.list()
    const roles: any[] = res.data
    const myRole = roles.find(r => r.slug === parsed.role)
    const pages = myRole?.pages ?? []
    storeUserPages(pages)
    return pages
  } catch {
    return []
  }
}
```

**Step 2: Commit**

```bash
git add frontend/lib/permissions.ts
git commit -m "feat: add hasPageAccess and fetchAndStoreUserPages helpers"
```

---

## Task 9: Frontend — Next.js Middleware for Route Protection

**Files:**
- Create: `frontend/middleware.ts`

**Step 1: Create the middleware**

```typescript
// frontend/middleware.ts
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

// Map route prefixes to required page keys
const PAGE_GUARDS: Array<[string, string]> = [
  ['/admin/pms', 'pms'],
  ['/admin/tickets', 'tickets'],
  ['/admin/ticket-fields', 'tickets'],
  ['/admin/crm', 'crm'],
  ['/dashboard', 'messaging'],
  ['/admin/callcenter', 'callcenter'],
  ['/admin/recordings', 'callcenter'],
  ['/admin/telephony', 'callcenter'],
  ['/admin/extensions', 'callcenter'],
  ['/admin/campaigns', 'campaigns'],
  ['/admin/email-templates', 'campaigns'],
  ['/admin/reports', 'reports'],
  ['/admin/usage', 'reports'],
  ['/admin/kb', 'kb'],
  ['/admin/teams', 'teams'],
]

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Find matching guard
  const guard = PAGE_GUARDS.find(([prefix]) => pathname.startsWith(prefix))
  if (!guard) return NextResponse.next()

  const [, requiredPage] = guard

  // Read user and pages from cookies (we'll store them as cookies on login)
  const userCookie = request.cookies.get('user_role')?.value
  const pagesCookie = request.cookies.get('user_pages')?.value

  if (!userCookie) {
    return NextResponse.redirect(new URL('/login', request.url))
  }

  // Admin bypasses all checks
  if (userCookie === 'admin') return NextResponse.next()

  // Check page access
  try {
    const pages: string[] = pagesCookie ? JSON.parse(pagesCookie) : []
    if (!pages.includes(requiredPage)) {
      return NextResponse.redirect(new URL('/unauthorized', request.url))
    }
  } catch {
    return NextResponse.redirect(new URL('/unauthorized', request.url))
  }

  return NextResponse.next()
}

export const config = {
  matcher: [
    '/admin/pms/:path*',
    '/admin/tickets/:path*',
    '/admin/ticket-fields',
    '/admin/crm/:path*',
    '/dashboard/:path*',
    '/admin/callcenter/:path*',
    '/admin/recordings',
    '/admin/telephony',
    '/admin/extensions',
    '/admin/campaigns/:path*',
    '/admin/email-templates',
    '/admin/reports',
    '/admin/usage',
    '/admin/kb/:path*',
    '/admin/teams',
  ],
}
```

**Step 2: Set cookies on login**

In `frontend/lib/auth.ts`, in the `verifyOTP` function, after `localStorage.setItem('user', ...)`, add:

```typescript
// Set role cookie for middleware
document.cookie = `user_role=${data.role || 'support'}; path=/; SameSite=Lax`
// Fetch and store pages, then set cookie
import('@/lib/permissions').then(({ fetchAndStoreUserPages }) => {
  fetchAndStoreUserPages().then(pages => {
    document.cookie = `user_pages=${JSON.stringify(pages)}; path=/; SameSite=Lax`
  })
})
```

Also update the `logout` function to clear cookies:
```typescript
logout: () => {
  localStorage.removeItem('user')
  localStorage.removeItem('user_pages')
  // Clear role cookies
  document.cookie = 'user_role=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT'
  document.cookie = 'user_pages=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT'
},
```

**Step 3: Create /unauthorized page**

Create `frontend/app/unauthorized/page.tsx`:

```tsx
export default function UnauthorizedPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="text-center">
        <div className="text-6xl mb-4">🔒</div>
        <h1 className="text-2xl font-bold text-gray-900 mb-2">Access Restricted</h1>
        <p className="text-gray-500 mb-6">Your role does not have access to this page.</p>
        <a href="/dashboard" className="bg-indigo-600 text-white px-6 py-2 rounded-lg hover:bg-indigo-700 text-sm font-medium">
          Go to Dashboard
        </a>
      </div>
    </div>
  )
}
```

**Step 4: Commit**

```bash
git add frontend/middleware.ts frontend/lib/auth.ts frontend/app/unauthorized/page.tsx
git commit -m "feat: add Next.js middleware for role-based route protection"
```

---

## Task 10: Update AdminNav — Filter by Page Key

**Files:**
- Modify: `frontend/components/AdminNav.tsx`

**Step 1: Import the new helper**

At the top of `AdminNav.tsx`, add to imports:
```typescript
import { hasPageAccess } from '@/lib/permissions'
```

**Step 2: Update sidebarGroups to use `pageKey`**

Replace all `permission` functions in the relevant items with a `pageKey` property. The logic in the render loop will check it. Here's the updated groups for PMS, CRM, messaging, and others:

In each `sidebarGroups` item, add `pageKey` next to `href`:

```typescript
// PMS group (find and update)
{
  label: 'Projects',
  items: [
    { href: '/admin/pms', label: 'Projects', icon: '📋', pageKey: 'pms' },
  ],
},

// CRM group
{
  label: 'CRM',
  items: [
    { href: '/admin/crm/leads', label: 'Leads', icon: '🎯', pageKey: 'crm' },
    { href: '/admin/crm/pipeline', label: 'Sales Pipeline', icon: '📊', pageKey: 'crm' },
    { href: '/admin/crm/tasks', label: 'Tasks', icon: '✅', pageKey: 'crm' },
    { href: '/admin/crm/analytics', label: 'Analytics', icon: '📈', pageKey: 'crm' },
    { href: '/admin/crm/companies', label: 'Companies', icon: '🏢', pageKey: 'crm' },
    { href: '/admin/crm/automation', label: 'Automation', icon: '⚡', pageKey: 'crm' },
    { href: '/admin/crm/reports', label: 'CRM Reports', icon: '📑', pageKey: 'crm' },
  ],
},
```

**Step 3: Update the filter logic in the render section**

Find the `visibleItems` filter inside the render:

```typescript
const visibleItems = group.items.filter(item => {
  if (userRole === 'admin') return true
  // Check page key first (new RBAC system)
  if ((item as any).pageKey) {
    return hasPageAccess((item as any).pageKey)
  }
  // Fall back to old permission check
  if ((item as any).permission) {
    return (item as any).permission()
  }
  // Items with no guard are visible to all (Account group etc.)
  return true
})
```

**Step 4: Commit**

```bash
git add frontend/components/AdminNav.tsx
git commit -m "feat: update AdminNav to filter by page key via hasPageAccess"
```

---

## Task 11: Rebuild `/admin/roles` Page

**Files:**
- Modify: `frontend/app/admin/roles/page.tsx` (rebuild existing)

**Step 1: Overwrite the roles page**

```tsx
'use client';
import { useEffect, useState } from 'react';
import { rolesApi } from '@/lib/api';
import { authAPI } from '@/lib/auth';
import MainHeader from '@/components/MainHeader';
import AdminNav from '@/components/AdminNav';

const ALL_PAGES = [
  { key: 'pms', label: 'Projects (PMS)' },
  { key: 'tickets', label: 'Tickets' },
  { key: 'crm', label: 'CRM' },
  { key: 'messaging', label: 'Messaging / Inbox' },
  { key: 'callcenter', label: 'Call Center' },
  { key: 'campaigns', label: 'Email Campaigns' },
  { key: 'reports', label: 'Reports' },
  { key: 'kb', label: 'Knowledge Base' },
  { key: 'teams', label: 'Teams' },
];

export default function RolesPage() {
  const user = authAPI.getUser();
  const [roles, setRoles] = useState<any[]>([]);
  const [editing, setEditing] = useState<any>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ name: '', slug: '', pages: [] as string[] });

  const load = () => rolesApi.list().then(r => setRoles(r.data));
  useEffect(() => { load(); }, []);

  const handleCreate = async () => {
    await rolesApi.create(form);
    setShowCreate(false);
    setForm({ name: '', slug: '', pages: [] });
    load();
  };

  const handleUpdate = async () => {
    await rolesApi.update(editing.id, { name: editing.name, pages: editing.pages });
    setEditing(null);
    load();
  };

  const handleDelete = async (id: number) => {
    if (!confirm('Delete this role? Users with this role will be set to Viewer.')) return;
    await rolesApi.delete(id);
    load();
  };

  const togglePage = (pages: string[], key: string) =>
    pages.includes(key) ? pages.filter(p => p !== key) : [...pages, key];

  if (!user) return null;

  return (
    <div className="ml-60 pt-14 min-h-screen bg-gray-50">
      <MainHeader user={user} />
      <AdminNav />
      <div className="p-6 max-w-4xl">
        <div className="flex justify-between items-center mb-6">
          <h1 className="text-2xl font-bold text-gray-900">Roles</h1>
          <button onClick={() => setShowCreate(true)}
            className="bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-indigo-700">
            + New Role
          </button>
        </div>

        <div className="space-y-3">
          {roles.map(role => (
            <div key={role.id} className="bg-white border border-gray-200 rounded-xl p-4 flex items-start gap-4">
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-semibold text-gray-900">{role.name}</span>
                  {role.is_system && <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">🔒 System</span>}
                  <span className="text-xs text-gray-400 font-mono">{role.slug}</span>
                </div>
                <div className="flex flex-wrap gap-1">
                  {(role.pages || []).length === 0
                    ? <span className="text-xs text-gray-400">No page access</span>
                    : (role.pages as string[]).map(p => (
                      <span key={p} className="text-xs bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded-full">
                        {ALL_PAGES.find(x => x.key === p)?.label || p}
                      </span>
                    ))
                  }
                </div>
              </div>
              {!role.is_system && (
                <div className="flex gap-2 flex-none">
                  <button onClick={() => setEditing({ ...role })}
                    className="text-sm text-indigo-600 hover:text-indigo-800 px-3 py-1 border border-indigo-200 rounded-lg">
                    Edit
                  </button>
                  <button onClick={() => handleDelete(role.id)}
                    className="text-sm text-red-500 hover:text-red-700 px-3 py-1 border border-red-200 rounded-lg">
                    Delete
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Create Modal */}
      {showCreate && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 w-full max-w-md shadow-2xl">
            <h2 className="font-semibold text-lg mb-4">New Role</h2>
            <input className="w-full border rounded-lg px-3 py-2 text-sm mb-2" placeholder="Name (e.g. Freelancer)"
              value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
            <input className="w-full border rounded-lg px-3 py-2 text-sm mb-3" placeholder="Slug (e.g. freelancer)"
              value={form.slug} onChange={e => setForm({ ...form, slug: e.target.value.toLowerCase().replace(/\s+/g, '_') })} />
            <p className="text-xs font-medium text-gray-600 mb-2">Page Access</p>
            <div className="space-y-1 mb-4">
              {ALL_PAGES.map(p => (
                <label key={p.key} className="flex items-center gap-2 text-sm cursor-pointer">
                  <input type="checkbox" checked={form.pages.includes(p.key)}
                    onChange={() => setForm({ ...form, pages: togglePage(form.pages, p.key) })} />
                  {p.label}
                </label>
              ))}
            </div>
            <div className="flex gap-3">
              <button onClick={() => setShowCreate(false)} className="flex-1 border rounded-lg px-4 py-2 text-sm">Cancel</button>
              <button onClick={handleCreate} disabled={!form.name || !form.slug}
                className="flex-1 bg-indigo-600 text-white rounded-lg px-4 py-2 text-sm disabled:opacity-50">Create</button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Modal */}
      {editing && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 w-full max-w-md shadow-2xl">
            <h2 className="font-semibold text-lg mb-4">Edit Role</h2>
            <input className="w-full border rounded-lg px-3 py-2 text-sm mb-3" placeholder="Name"
              value={editing.name} onChange={e => setEditing({ ...editing, name: e.target.value })} />
            <p className="text-xs font-medium text-gray-600 mb-2">Page Access</p>
            <div className="space-y-1 mb-4">
              {ALL_PAGES.map(p => (
                <label key={p.key} className="flex items-center gap-2 text-sm cursor-pointer">
                  <input type="checkbox" checked={(editing.pages || []).includes(p.key)}
                    onChange={() => setEditing({ ...editing, pages: togglePage(editing.pages || [], p.key) })} />
                  {p.label}
                </label>
              ))}
            </div>
            <div className="flex gap-3">
              <button onClick={() => setEditing(null)} className="flex-1 border rounded-lg px-4 py-2 text-sm">Cancel</button>
              <button onClick={handleUpdate}
                className="flex-1 bg-indigo-600 text-white rounded-lg px-4 py-2 text-sm">Save</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
```

**Step 2: Commit**

```bash
git add frontend/app/admin/roles/page.tsx
git commit -m "feat: rebuild roles management page with create/edit/delete"
```

---

## Task 12: Add Role Badge + Change Dropdown to Users Page

**Files:**
- Modify: `frontend/app/admin/users/page.tsx`

**Step 1: Import rolesApi and add role state**

At the top of the component, add:
```typescript
import { rolesApi } from '@/lib/api';

// Inside the component, add alongside existing state:
const [roles, setRoles] = useState<any[]>([]);

// Inside useEffect that loads users, also load roles:
rolesApi.list().then(r => setRoles(r.data));
```

**Step 2: Add role change handler**

```typescript
const handleRoleChange = async (userId: number, newRole: string) => {
  await rolesApi.changeUserRole(userId, newRole);
  // Reload users
  // (call your existing reload/fetch function)
};
```

**Step 3: Add role dropdown to each user row**

In the user row JSX, add a role selector next to the user's name/email:

```tsx
<select
  value={user.role || 'support'}
  onChange={e => handleRoleChange(user.user_id, e.target.value)}
  className="text-xs border rounded px-2 py-1 bg-white"
>
  {roles.map((r: any) => (
    <option key={r.slug} value={r.slug}>{r.name}</option>
  ))}
</select>
```

**Step 4: Commit**

```bash
git add frontend/app/admin/users/page.tsx
git commit -m "feat: add role change dropdown to users management page"
```

---

## Task 13: Smoke Test End-to-End

**Step 1: Test role management**
- Log in as admin → go to `/admin/roles`
- Should see 9 system roles with 🔒 icon, no Edit/Delete on them
- Create a custom role "Freelancer" with slug `freelancer` and pages: pms, tickets
- Edit it → change name to "Contractor", add reports page → save
- Delete it → confirm dialog → gone

**Step 2: Test user role assignment**
- Go to `/admin/users`
- Find a non-admin user → change their role via dropdown to `developer`
- Log out, log in as that user → should only see PMS and Tickets in nav
- Try navigating to `/admin/crm` directly → redirected to `/unauthorized`

**Step 3: Test PMS project roles still work**
- Log in as a `developer` role user who is a project member
- Open a project → Board view → drag a task to next stage
- Workflow transitions should still respect the project-level role (developer, qa, etc.)

**Step 4: Final commit**

```bash
git add -A
git commit -m "feat: complete RBAC role system — fixed roles, custom roles, route protection"
```

---

## Summary

| Task | What it does |
|---|---|
| 1 | DB migration: `roles` table + seed 9 system roles + migrate users |
| 2 | SQLAlchemy `Role` model |
| 3 | Pydantic schemas |
| 4 | Roles CRUD API (system roles protected) |
| 5 | `PATCH /admin/users/{id}/role` endpoint |
| 6 | `require_page()` dependency + apply to module routes |
| 7 | Frontend `rolesApi` client |
| 8 | `hasPageAccess` + `fetchAndStoreUserPages` helpers |
| 9 | Next.js `middleware.ts` + `/unauthorized` page + cookie management |
| 10 | AdminNav updated to filter by page key |
| 11 | `/admin/roles` page rebuilt |
| 12 | Role change dropdown in `/admin/users` |
| 13 | End-to-end smoke test |
