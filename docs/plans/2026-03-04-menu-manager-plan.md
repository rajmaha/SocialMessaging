# Menu Manager Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a general-purpose menu manager so admins can create menu groups with items linking to forms, internal pages, or external URLs — visible in the admin sidebar and optionally on a public portal and chat widget.

**Architecture:** Two new DB tables (menu_groups, menu_items) with full CRUD API. Admin manages menus from `/admin/menus`. Dynamic groups render in AdminNav sidebar after hardcoded groups. Public groups appear on `/portal` page and in chat widget when `public_access` is enabled.

**Tech Stack:** FastAPI + SQLAlchemy (backend), Next.js 14 App Router + TailwindCSS (frontend), inline SQL migrations in main.py

---

### Task 1: Backend Model — MenuGroup + MenuItem

**Files:**
- Create: `backend/app/models/menu.py`

**Step 1: Create the model file**

```python
from sqlalchemy import Column, Integer, String, Boolean, DateTime, ForeignKey, func
from app.database import Base


class MenuGroup(Base):
    __tablename__ = "menu_groups"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(100), nullable=False)
    slug = Column(String(100), unique=True, nullable=False, index=True)
    icon = Column(String(10), nullable=True, default="📁")
    display_order = Column(Integer, default=0)
    public_access = Column(Boolean, default=False)
    is_active = Column(Boolean, default=True)
    created_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class MenuItem(Base):
    __tablename__ = "menu_items"

    id = Column(Integer, primary_key=True, index=True)
    group_id = Column(Integer, ForeignKey("menu_groups.id", ondelete="CASCADE"), nullable=False, index=True)
    label = Column(String(200), nullable=False)
    link_type = Column(String(20), nullable=False, default="internal")  # form, internal, external
    link_value = Column(String(500), nullable=False)
    icon = Column(String(10), nullable=True)
    open_in_new_tab = Column(Boolean, default=False)
    display_order = Column(Integer, default=0)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
```

**Step 2: Commit**

```bash
git add backend/app/models/menu.py
git commit -m "feat(menu): add MenuGroup and MenuItem SQLAlchemy models"
```

---

### Task 2: Backend Schemas

**Files:**
- Create: `backend/app/schemas/menu.py`

**Step 1: Create Pydantic schemas**

```python
from pydantic import BaseModel
from typing import List, Optional
from datetime import datetime


class MenuItemCreate(BaseModel):
    label: str
    link_type: str = "internal"  # form, internal, external
    link_value: str
    icon: Optional[str] = None
    open_in_new_tab: bool = False
    display_order: int = 0
    is_active: bool = True


class MenuItemUpdate(BaseModel):
    label: Optional[str] = None
    link_type: Optional[str] = None
    link_value: Optional[str] = None
    icon: Optional[str] = None
    open_in_new_tab: Optional[bool] = None
    display_order: Optional[int] = None
    is_active: Optional[bool] = None


class MenuItemOut(BaseModel):
    id: int
    group_id: int
    label: str
    link_type: str
    link_value: str
    icon: Optional[str]
    open_in_new_tab: bool
    display_order: int
    is_active: bool
    created_at: datetime

    class Config:
        from_attributes = True


class MenuGroupCreate(BaseModel):
    name: str
    slug: str
    icon: Optional[str] = "📁"
    display_order: int = 0
    public_access: bool = False
    is_active: bool = True


class MenuGroupUpdate(BaseModel):
    name: Optional[str] = None
    icon: Optional[str] = None
    display_order: Optional[int] = None
    public_access: Optional[bool] = None
    is_active: Optional[bool] = None


class MenuGroupOut(BaseModel):
    id: int
    name: str
    slug: str
    icon: Optional[str]
    display_order: int
    public_access: bool
    is_active: bool
    created_by: Optional[int]
    created_at: datetime
    items: List[MenuItemOut] = []

    class Config:
        from_attributes = True
```

**Step 2: Commit**

```bash
git add backend/app/schemas/menu.py
git commit -m "feat(menu): add Pydantic schemas for menu groups and items"
```

---

### Task 3: Backend API Routes

**Files:**
- Create: `backend/app/routes/menus.py`

**Step 1: Create the routes file**

This file contains all admin CRUD endpoints (protected by `require_admin_feature("manage_menus")`), plus public `GET /menu` and authenticated `GET /menu/all`.

```python
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from app.database import get_db
from app.dependencies import get_current_user, require_admin_feature
from app.models.menu import MenuGroup, MenuItem
from app.schemas.menu import (
    MenuGroupCreate, MenuGroupUpdate, MenuGroupOut,
    MenuItemCreate, MenuItemUpdate, MenuItemOut,
)
from typing import List

router = APIRouter(tags=["menus"])

# ── Helpers ─────────────────────────────────────────────────────────────

def _group_with_items(group, db):
    """Attach ordered items to a group and return as dict."""
    items = db.query(MenuItem).filter(
        MenuItem.group_id == group.id
    ).order_by(MenuItem.display_order).all()
    d = {c.name: getattr(group, c.name) for c in group.__table__.columns}
    d["items"] = items
    return d

# ── Public ──────────────────────────────────────────────────────────────

@router.get("/menu", response_model=List[MenuGroupOut])
def get_public_menus(db: Session = Depends(get_db)):
    groups = db.query(MenuGroup).filter(
        MenuGroup.is_active == True,
        MenuGroup.public_access == True,
    ).order_by(MenuGroup.display_order).all()
    return [_group_with_items(g, db) for g in groups]

# ── Internal (logged-in) ────────────────────────────────────────────────

@router.get("/menu/all", response_model=List[MenuGroupOut])
def get_all_menus(db: Session = Depends(get_db), _=Depends(get_current_user)):
    groups = db.query(MenuGroup).filter(
        MenuGroup.is_active == True,
    ).order_by(MenuGroup.display_order).all()
    return [_group_with_items(g, db) for g in groups]

# ── Admin: Groups ───────────────────────────────────────────────────────

_perm = require_admin_feature("manage_menus")

@router.get("/admin/menu-groups", response_model=List[MenuGroupOut])
def list_groups(db: Session = Depends(get_db), _=Depends(_perm)):
    groups = db.query(MenuGroup).order_by(MenuGroup.display_order).all()
    return [_group_with_items(g, db) for g in groups]

@router.post("/admin/menu-groups", response_model=MenuGroupOut)
def create_group(data: MenuGroupCreate, db: Session = Depends(get_db), user=Depends(_perm)):
    if db.query(MenuGroup).filter(MenuGroup.slug == data.slug).first():
        raise HTTPException(400, "A menu group with that slug already exists")
    group = MenuGroup(**data.model_dump(), created_by=user.id)
    db.add(group)
    db.commit()
    db.refresh(group)
    return _group_with_items(group, db)

@router.put("/admin/menu-groups/{group_id}", response_model=MenuGroupOut)
def update_group(group_id: int, data: MenuGroupUpdate, db: Session = Depends(get_db), _=Depends(_perm)):
    group = db.query(MenuGroup).filter(MenuGroup.id == group_id).first()
    if not group:
        raise HTTPException(404, "Menu group not found")
    for k, v in data.model_dump(exclude_none=True).items():
        setattr(group, k, v)
    db.commit()
    db.refresh(group)
    return _group_with_items(group, db)

@router.delete("/admin/menu-groups/{group_id}")
def delete_group(group_id: int, db: Session = Depends(get_db), _=Depends(_perm)):
    group = db.query(MenuGroup).filter(MenuGroup.id == group_id).first()
    if not group:
        raise HTTPException(404, "Menu group not found")
    db.delete(group)
    db.commit()
    return {"ok": True}

@router.put("/admin/menu-groups/reorder")
def reorder_groups(body: dict, db: Session = Depends(get_db), _=Depends(_perm)):
    group_ids = body.get("group_ids", [])
    for order, gid in enumerate(group_ids):
        db.query(MenuGroup).filter(MenuGroup.id == gid).update({"display_order": order})
    db.commit()
    return {"ok": True}

# ── Admin: Items ────────────────────────────────────────────────────────

@router.post("/admin/menu-groups/{group_id}/items", response_model=MenuItemOut)
def create_item(group_id: int, data: MenuItemCreate, db: Session = Depends(get_db), _=Depends(_perm)):
    group = db.query(MenuGroup).filter(MenuGroup.id == group_id).first()
    if not group:
        raise HTTPException(404, "Menu group not found")
    item = MenuItem(**data.model_dump(), group_id=group_id)
    db.add(item)
    db.commit()
    db.refresh(item)
    return item

@router.put("/admin/menu-groups/{group_id}/items/{item_id}", response_model=MenuItemOut)
def update_item(group_id: int, item_id: int, data: MenuItemUpdate, db: Session = Depends(get_db), _=Depends(_perm)):
    item = db.query(MenuItem).filter(MenuItem.id == item_id, MenuItem.group_id == group_id).first()
    if not item:
        raise HTTPException(404, "Menu item not found")
    for k, v in data.model_dump(exclude_none=True).items():
        setattr(item, k, v)
    db.commit()
    db.refresh(item)
    return item

@router.delete("/admin/menu-groups/{group_id}/items/{item_id}")
def delete_item(group_id: int, item_id: int, db: Session = Depends(get_db), _=Depends(_perm)):
    item = db.query(MenuItem).filter(MenuItem.id == item_id, MenuItem.group_id == group_id).first()
    if not item:
        raise HTTPException(404, "Menu item not found")
    db.delete(item)
    db.commit()
    return {"ok": True}

@router.put("/admin/menu-groups/{group_id}/items/reorder")
def reorder_items(group_id: int, body: dict, db: Session = Depends(get_db), _=Depends(_perm)):
    item_ids = body.get("item_ids", [])
    for order, iid in enumerate(item_ids):
        db.query(MenuItem).filter(MenuItem.id == iid, MenuItem.group_id == group_id).update({"display_order": order})
    db.commit()
    return {"ok": True}
```

**Step 2: Commit**

```bash
git add backend/app/routes/menus.py
git commit -m "feat(menu): add all menu group and item API endpoints"
```

---

### Task 4: Backend main.py — Migrations + Router Registration

**Files:**
- Modify: `backend/main.py`

**Step 1: Add import at top of main.py (near other route imports around line 15)**

Add after `from app.routes import roles as roles_routes`:

```python
from app.routes.menus import router as menus_router
```

**Step 2: Add CREATE TABLE statements in the startup migration block**

Add after the `form_submissions` table creation (around line 600). Follow the existing pattern using `conn.execute(text(...))`:

```python
        # ── Menu Groups & Items ─────────────────────────────────────
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS menu_groups (
                id SERIAL PRIMARY KEY,
                name VARCHAR(100) NOT NULL,
                slug VARCHAR(100) UNIQUE NOT NULL,
                icon VARCHAR(10) DEFAULT '📁',
                display_order INTEGER DEFAULT 0,
                public_access BOOLEAN DEFAULT FALSE,
                is_active BOOLEAN DEFAULT TRUE,
                created_by INTEGER REFERENCES users(id),
                created_at TIMESTAMPTZ DEFAULT NOW()
            )
        """))
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS menu_items (
                id SERIAL PRIMARY KEY,
                group_id INTEGER NOT NULL REFERENCES menu_groups(id) ON DELETE CASCADE,
                label VARCHAR(200) NOT NULL,
                link_type VARCHAR(20) NOT NULL DEFAULT 'internal',
                link_value VARCHAR(500) NOT NULL,
                icon VARCHAR(10),
                open_in_new_tab BOOLEAN DEFAULT FALSE,
                display_order INTEGER DEFAULT 0,
                is_active BOOLEAN DEFAULT TRUE,
                created_at TIMESTAMPTZ DEFAULT NOW()
            )
        """))
```

**Step 3: Register the router (after `app.include_router(forms_public_router)` around line 1332)**

```python
app.include_router(menus_router)
```

**Step 4: Commit**

```bash
git add backend/main.py
git commit -m "feat(menu): add menu tables migration and register router"
```

---

### Task 5: Frontend API Client

**Files:**
- Modify: `frontend/lib/api.ts`

**Step 1: Add menuApi after the formsApi block (after line 220)**

```typescript
// --- Menus ---
export const menuApi = {
  // Admin
  list: () => api.get('/admin/menu-groups'),
  create: (data: any) => api.post('/admin/menu-groups', data),
  update: (id: number, data: any) => api.put(`/admin/menu-groups/${id}`, data),
  delete: (id: number) => api.delete(`/admin/menu-groups/${id}`),
  reorderGroups: (groupIds: number[]) => api.put('/admin/menu-groups/reorder', { group_ids: groupIds }),
  // Items
  createItem: (groupId: number, data: any) => api.post(`/admin/menu-groups/${groupId}/items`, data),
  updateItem: (groupId: number, itemId: number, data: any) => api.put(`/admin/menu-groups/${groupId}/items/${itemId}`, data),
  deleteItem: (groupId: number, itemId: number) => api.delete(`/admin/menu-groups/${groupId}/items/${itemId}`),
  reorderItems: (groupId: number, itemIds: number[]) => api.put(`/admin/menu-groups/${groupId}/items/reorder`, { item_ids: itemIds }),
  // Public / Internal
  getPublic: () => api.get('/menu'),
  getAll: () => api.get('/menu/all'),
}
```

**Step 2: Commit**

```bash
git add frontend/lib/api.ts
git commit -m "feat(menu): add menuApi client methods"
```

---

### Task 6: Admin Menu Manager Page

**Files:**
- Create: `frontend/app/admin/menus/page.tsx`

**Step 1: Build the full admin page**

This page follows the same layout pattern as other admin pages (`ml-60 pt-14`, `MainHeader`, `AdminNav`). It should include:

- State: `groups` array, `editingGroup` (for create/edit modal), `expandedGroupId`, `editingItem` (for item modal)
- Fetch `menuApi.list()` on mount
- **Group list:** Card per group showing icon, name, slug, item count badge, public_access toggle badge, is_active badge. Each card has Edit and Delete buttons. Click card to expand/collapse items.
- **Create Group button** at top right — opens modal with: name input, slug input (auto-generated from name, editable), icon input (text field for emoji), public_access toggle, is_active toggle
- **Edit Group modal** — same fields, pre-populated
- **Expanded items section** inside card: ordered list of items with icon, label, link type badge (colored: green for form, blue for internal, orange for external), link value. Each item has Edit and Delete buttons. Move up/down buttons for reorder. "Add Item" button at bottom.
- **Item modal:** label input, icon input, link_type dropdown (`form`/`internal`/`external`), link_value input (when `form` is selected, show a dropdown of published forms fetched via `formsApi.list()` — use form slug as value), open_in_new_tab checkbox
- **Reorder:** Move up/down buttons call the reorder API

Reference `frontend/app/admin/roles/page.tsx` for the modal pattern and `frontend/app/admin/forms/page.tsx` for the card layout pattern.

**Step 2: Commit**

```bash
git add frontend/app/admin/menus/page.tsx
git commit -m "feat(menu): add admin Menu Manager page"
```

---

### Task 7: Add Menu Manager to AdminNav Sidebar

**Files:**
- Modify: `frontend/components/AdminNav.tsx`

**Step 1: Add static "Menu Manager" link in the sidebar**

In the `sidebarGroups` array, add a new group after "Applications" (around line 77) and before "Content":

```typescript
    {
        label: 'Navigation',
        items: [
            { href: '/admin/menus', label: 'Menu Manager', icon: '🗂️', permission: () => hasAdminFeature('manage_menus') },
        ],
    },
```

**Step 2: Add dynamic menu groups to the sidebar**

In the AdminNav component function body (before the return), add state + fetch for dynamic menus:

```typescript
const [dynamicMenus, setDynamicMenus] = useState<any[]>([])

useEffect(() => {
    const token = localStorage.getItem('token')
    if (token) {
        menuApi.getAll()
            .then(r => setDynamicMenus(r.data))
            .catch(() => {})
    }
}, [])
```

Import `menuApi` from `@/lib/api` at the top.

Then in the render, after mapping over `sidebarGroups`, render the dynamic groups with the same structure. Each dynamic group becomes a sidebar group header with its items as links:

- `link_type === 'form'` → href = `/forms/${link_value}`
- `link_type === 'internal'` → href = `${link_value}`
- `link_type === 'external'` → use `<a>` with `target="_blank"` instead of `<Link>`

**Step 3: Commit**

```bash
git add frontend/components/AdminNav.tsx
git commit -m "feat(menu): integrate dynamic menu groups into AdminNav sidebar"
```

---

### Task 8: Public Portal Page

**Files:**
- Create: `frontend/app/portal/page.tsx`

**Step 1: Build the public portal page**

This is a public page (no auth). It fetches `GET /menu` (via axios directly, no auth token) and renders a clean card layout.

Structure:
- Full-width page with centered max-w-4xl container
- Company branding header (fetch from `/branding/public` if available, or simple title)
- Each menu group renders as a section: group icon + name as header, then a grid of item cards
- Item cards show: icon, label, link type indicator
- Click behavior:
  - `form` → navigate to `/forms/{link_value}`
  - `internal` → navigate to `{link_value}`
  - `external` → `window.open(link_value, '_blank')`
- If no public groups exist, show a friendly "No content available" message
- Clean, professional styling — no admin chrome (no MainHeader, no AdminNav)

Use `axios` directly with `API_URL` (same pattern as `frontend/app/forms/[slug]/page.tsx` which is also a public page).

**Step 2: Commit**

```bash
git add frontend/app/portal/page.tsx
git commit -m "feat(menu): add public portal page"
```

---

### Task 9: Chat Widget Integration

**Files:**
- Modify: `frontend/public/chat-widget.js`

**Step 1: Add menu tab to the chat widget**

In the widget, add a "Menu" icon/tab button alongside the existing chat interface. When clicked:

1. Fetch `${apiUrl}/menu` (public endpoint, no auth needed)
2. Render the menu groups and items in a scrollable panel within the widget
3. Items are clickable links:
   - `form` → open `/forms/{link_value}` in a new tab (or navigate parent window)
   - `internal` → open in new tab
   - `external` → open in new tab
4. If no public menus exist, hide the menu tab entirely

Keep the implementation lightweight — this is vanilla JS in the widget script. Use `fetch()` for the API call.

**Step 2: Commit**

```bash
git add frontend/public/chat-widget.js
git commit -m "feat(menu): add menu tab to chat widget"
```

---

### Task 10: Final Verification

**Step 1: Start the backend**

```bash
cd backend && source venv/bin/activate && uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

Verify: tables `menu_groups` and `menu_items` are created (check startup logs).

**Step 2: Test API via Swagger**

Open http://localhost:8000/docs and test:
- POST `/admin/menu-groups` — create a group (e.g. name: "HR Forms", slug: "hr-forms", icon: "📋", public_access: true)
- POST `/admin/menu-groups/{id}/items` — add items (form type with a form slug, external type with a URL)
- GET `/admin/menu-groups` — verify groups return with items
- GET `/menu` — verify only public groups appear
- GET `/menu/all` — verify all active groups appear (requires auth)

**Step 3: Test frontend**

- Open http://localhost:3000/admin/menus — verify the Menu Manager page loads, CRUD works
- Check AdminNav sidebar — verify dynamic groups appear below hardcoded groups
- Open http://localhost:3000/portal — verify public groups and items render
- Test chat widget — verify menu tab appears when public menus exist

**Step 4: Final commit**

```bash
git add -A
git commit -m "feat(menu): menu manager with groups, items, sidebar integration, portal, and widget"
```
