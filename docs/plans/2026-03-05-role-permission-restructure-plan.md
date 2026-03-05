# Role & Permission System Restructure — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace dual permission system (role.pages + user_permissions) with a unified permission matrix supporting per-module custom actions, menu group visibility, and user-level overrides.

**Architecture:** Roles store a JSONB `permissions` dict mapping module keys to action arrays. A module registry constant defines available modules and their actions. User overrides table allows granting/revoking specific actions per user beyond their role. A single `require_permission(module, action)` dependency replaces `require_page()`, `require_module()`, and `require_admin_feature()`.

**Tech Stack:** FastAPI, SQLAlchemy 2.0, PostgreSQL JSONB, Next.js 14 (TypeScript), TailwindCSS

**Design doc:** `docs/plans/2026-03-05-role-permission-restructure-design.md`

---

### Task 1: Add Module Registry Constant

**Files:**
- Create: `backend/app/permissions_registry.py`

**Step 1: Create the module registry file**

```python
"""
Unified module registry — defines all permission-controlled modules and their available actions.
Dynamic menu groups auto-register at runtime with prefix "menu_".
"""

MODULE_REGISTRY = {
    # Communication (split from single "messaging" page key)
    "email":        {"label": "Email",               "actions": ["view", "compose", "edit", "delete", "export"]},
    "messaging":    {"label": "Messaging Channels",   "actions": ["view", "reply", "assign", "delete"]},
    "callcenter":   {"label": "Call Center",          "actions": ["view", "make_call", "edit", "delete"]},
    "livechat":     {"label": "Live Chat",            "actions": ["view", "reply", "assign", "delete"]},

    # Business modules
    "crm":          {"label": "CRM",                  "actions": ["view", "add", "edit", "delete", "import", "export"]},
    "tickets":      {"label": "Tickets",              "actions": ["view", "add", "edit", "delete", "assign"]},
    "pms":          {"label": "Projects (PMS)",       "actions": ["view", "add", "edit", "delete"]},
    "campaigns":    {"label": "Email Campaigns",      "actions": ["view", "add", "edit", "delete", "send"]},
    "reports":      {"label": "Reports",              "actions": ["view", "export"]},
    "kb":           {"label": "Knowledge Base",       "actions": ["view", "add", "edit", "delete", "publish"]},
    "teams":        {"label": "Teams",                "actions": ["view", "add", "edit", "delete"]},

    # Admin features (migrated from feature_* permission keys)
    "manage_users":          {"label": "Manage Users",          "actions": ["view", "add", "edit", "delete"]},
    "manage_teams":          {"label": "Manage Teams",          "actions": ["view", "add", "edit", "delete"]},
    "manage_email_accounts": {"label": "Email Accounts",        "actions": ["view", "add", "edit", "delete"]},
    "manage_messenger_config": {"label": "Messenger Config",    "actions": ["view", "edit"]},
    "manage_telephony":      {"label": "Telephony (VoIP)",      "actions": ["view", "edit"]},
    "manage_extensions":     {"label": "SIP Extensions",        "actions": ["view", "add", "edit", "delete"]},
    "manage_branding":       {"label": "Branding",              "actions": ["view", "edit"]},
    "manage_roles":          {"label": "Role Permissions",      "actions": ["view", "edit"]},
    "manage_cors":           {"label": "CORS / Widget Origins", "actions": ["view", "edit"]},
    "manage_bot":            {"label": "Chat Bot",              "actions": ["view", "edit"]},
    "manage_cloudpanel":     {"label": "CloudPanel",            "actions": ["view", "add", "edit", "delete"]},
    "manage_dynamic_fields": {"label": "Dynamic Fields",        "actions": ["view", "add", "edit", "delete"]},
    "manage_ssl":            {"label": "SSL Monitor",           "actions": ["view"]},
    "manage_billing":        {"label": "Billing",               "actions": ["view", "edit"]},
    "manage_forms":          {"label": "Form Builder",          "actions": ["view", "add", "edit", "delete"]},
    "manage_menus":          {"label": "Menu Manager",          "actions": ["view", "add", "edit", "delete"]},

    # Modules (migrated from module_* permission keys)
    "organizations":  {"label": "Organizations",      "actions": ["view", "add", "edit", "delete"]},
    "contacts":       {"label": "Contacts",           "actions": ["view", "add", "edit", "delete"]},
    "subscriptions":  {"label": "Subscriptions",      "actions": ["view", "add", "edit", "delete"]},
    "calls":          {"label": "Call Records",        "actions": ["view", "export"]},
    "reminders":      {"label": "Reminder Calls",     "actions": ["view", "add", "edit", "delete"]},
    "notifications":  {"label": "Notifications",      "actions": ["view", "add", "edit", "delete"]},
    "individuals":    {"label": "Individuals",        "actions": ["view", "add", "edit", "delete"]},
}


def get_module_actions(module_key: str) -> list[str]:
    """Get available actions for a module. Returns empty list if module not found."""
    mod = MODULE_REGISTRY.get(module_key)
    return mod["actions"] if mod else []


def get_all_module_keys() -> list[str]:
    """Return all static module keys."""
    return list(MODULE_REGISTRY.keys())
```

**Step 2: Verify import works**

Run: `cd /Users/rajmaha/Sites/SocialMedia/backend && python -c "from app.permissions_registry import MODULE_REGISTRY; print(len(MODULE_REGISTRY), 'modules')"`
Expected: `XX modules` (no import errors)

**Step 3: Commit**

```bash
git add backend/app/permissions_registry.py
git commit -m "feat(permissions): add unified module registry constant"
```

---

### Task 2: Update Role Model — Add `permissions` Column

**Files:**
- Modify: `backend/app/models/role.py`
- Modify: `backend/main.py` (inline migration)

**Step 1: Add `permissions` column to Role model**

In `backend/app/models/role.py`, add a `permissions` JSONB column alongside the existing `pages` column (keep `pages` for now during migration):

```python
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
    pages = Column(JSONB, default=list)          # LEGACY — kept for migration
    permissions = Column(JSONB, default=dict)     # NEW — unified permission matrix
    created_at = Column(DateTime, default=datetime.utcnow)
```

**Step 2: Add inline migration in `main.py`**

Find the section with `text()` migrations in `backend/main.py` and add:

```python
# Add permissions JSONB column to roles table
conn.execute(text("""
    ALTER TABLE roles ADD COLUMN IF NOT EXISTS permissions JSONB DEFAULT '{}'::jsonb;
"""))
```

**Step 3: Verify by starting backend**

Run: `cd /Users/rajmaha/Sites/SocialMedia && ./start.sh` (or just the backend)
Check: No startup errors, column exists in DB.

**Step 4: Commit**

```bash
git add backend/app/models/role.py backend/main.py
git commit -m "feat(permissions): add permissions JSONB column to Role model"
```

---

### Task 3: Create UserPermissionOverride Model

**Files:**
- Create: `backend/app/models/user_permission_override.py`
- Modify: `backend/main.py` (import model + inline migration)

**Step 1: Create the override model**

```python
from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import relationship
from datetime import datetime
from app.database import Base


class UserPermissionOverride(Base):
    """Per-user permission overrides — grant or revoke specific actions beyond the role default."""
    __tablename__ = "user_permission_overrides"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    module_key = Column(String(100), nullable=False)
    granted_actions = Column(JSONB, default=list)
    revoked_actions = Column(JSONB, default=list)
    granted_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    __table_args__ = (
        UniqueConstraint("user_id", "module_key", name="uq_user_module_override"),
    )

    user = relationship("User", foreign_keys=[user_id])
    granter = relationship("User", foreign_keys=[granted_by])
```

**Step 2: Import in `main.py`**

Add to the imports section of `backend/main.py`:

```python
from app.models.user_permission_override import UserPermissionOverride
```

The `Base.metadata.create_all()` call will auto-create the table.

**Step 3: Verify by starting backend**

Run backend, check no errors, `user_permission_overrides` table created.

**Step 4: Commit**

```bash
git add backend/app/models/user_permission_override.py backend/main.py
git commit -m "feat(permissions): add UserPermissionOverride model"
```

---

### Task 4: Add `require_permission()` Dependency

**Files:**
- Modify: `backend/app/dependencies.py`

**Step 1: Add `require_permission` and `get_effective_permissions` functions**

Add these after the existing `require_page` function in `backend/app/dependencies.py`:

```python
def require_permission(module_key: str, action: str):
    """
    Unified permission check: role permissions + user overrides.
    Admins bypass all checks.
    Usage: Depends(require_permission("crm", "edit"))
    """
    async def _check(
        current_user=Depends(get_current_user),
        db: Session = Depends(get_db)
    ):
        if current_user.role == "admin":
            return current_user

        from app.models.role import Role
        from app.models.user_permission_override import UserPermissionOverride

        # 1. Get role permissions
        role = db.query(Role).filter(Role.slug == current_user.role).first()
        role_actions = (role.permissions or {}).get(module_key, []) if role else []

        # 2. Apply user overrides
        override = db.query(UserPermissionOverride).filter(
            UserPermissionOverride.user_id == current_user.id,
            UserPermissionOverride.module_key == module_key
        ).first()

        if override:
            effective = set(role_actions)
            effective |= set(override.granted_actions or [])
            effective -= set(override.revoked_actions or [])
        else:
            effective = set(role_actions)

        if action not in effective:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"No '{action}' permission for '{module_key}'"
            )
        return current_user
    return _check


async def get_effective_permissions(user, db: Session) -> dict:
    """
    Compute the full effective permission matrix for a user.
    Returns: {"module_key": ["action1", "action2"], ...}
    """
    if user.role == "admin":
        from app.permissions_registry import MODULE_REGISTRY
        return {k: v["actions"][:] for k, v in MODULE_REGISTRY.items()}

    from app.models.role import Role
    from app.models.user_permission_override import UserPermissionOverride

    role = db.query(Role).filter(Role.slug == user.role).first()
    base_permissions = dict(role.permissions or {}) if role else {}

    overrides = db.query(UserPermissionOverride).filter(
        UserPermissionOverride.user_id == user.id
    ).all()

    result = {}
    # Start with role permissions
    for mod_key, actions in base_permissions.items():
        result[mod_key] = set(actions)

    # Apply overrides
    for ov in overrides:
        if ov.module_key not in result:
            result[ov.module_key] = set()
        result[ov.module_key] |= set(ov.granted_actions or [])
        result[ov.module_key] -= set(ov.revoked_actions or [])

    # Convert sets to sorted lists, drop empty
    return {k: sorted(v) for k, v in result.items() if v}
```

**Step 2: Keep old functions as shims (backward compatibility)**

Update `require_page`, `require_module`, and `require_admin_feature` to delegate to `require_permission`. Replace their bodies:

```python
def require_page(page_key: str):
    """LEGACY SHIM — delegates to require_permission(page_key, "view")"""
    return require_permission(page_key, "view")

def require_module(module_key: str):
    """LEGACY SHIM — delegates to require_permission for module access"""
    # Strip "module_" prefix if present (old format)
    clean_key = module_key.replace("module_", "")
    return require_permission(clean_key, "view")

def require_admin_feature(feature_key: str):
    """LEGACY SHIM — delegates to require_permission for admin features"""
    # Strip "feature_" prefix if present (old format)
    clean_key = feature_key.replace("feature_", "")
    return require_permission(clean_key, "view")
```

**Step 3: Verify backend starts**

Run backend, ensure no import errors.

**Step 4: Commit**

```bash
git add backend/app/dependencies.py
git commit -m "feat(permissions): add require_permission() and legacy shims"
```

---

### Task 5: Update Role Schemas

**Files:**
- Modify: `backend/app/schemas/role.py`

**Step 1: Update schemas to use `permissions` dict**

```python
from pydantic import BaseModel
from typing import Dict, List, Optional
from datetime import datetime


class RoleCreate(BaseModel):
    name: str
    slug: str
    permissions: Dict[str, List[str]] = {}


class RoleUpdate(BaseModel):
    name: Optional[str] = None
    permissions: Optional[Dict[str, List[str]]] = None


class RoleOut(BaseModel):
    id: int
    name: str
    slug: str
    is_system: bool
    permissions: Dict[str, List[str]]
    created_at: datetime

    class Config:
        from_attributes = True


class UserRoleUpdate(BaseModel):
    role: str  # slug of the target role
```

**Step 2: Commit**

```bash
git add backend/app/schemas/role.py
git commit -m "feat(permissions): update role schemas to use permissions dict"
```

---

### Task 6: Update Role Routes

**Files:**
- Modify: `backend/app/routes/roles.py`

**Step 1: Update CRUD to use `permissions` field**

```python
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from app.database import get_db
from app.dependencies import get_current_user, get_admin_user, get_effective_permissions
from app.models.role import Role
from app.schemas.role import RoleCreate, RoleUpdate, RoleOut
from app.permissions_registry import MODULE_REGISTRY, get_module_actions
from typing import List, Dict

router = APIRouter(prefix="/roles", tags=["roles"])


@router.get("", response_model=List[RoleOut])
def list_roles(db: Session = Depends(get_db), _=Depends(get_current_user)):
    return db.query(Role).order_by(Role.id).all()


@router.get("/registry")
def get_registry():
    """Return the module registry so frontend can render the permission matrix."""
    return MODULE_REGISTRY


@router.get("/my-permissions")
async def my_permissions(
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Return effective permission matrix for the current user (role + overrides)."""
    perms = await get_effective_permissions(current_user, db)
    return {"permissions": perms}


@router.post("", response_model=RoleOut)
def create_role(data: RoleCreate, db: Session = Depends(get_db), _=Depends(get_admin_user)):
    if db.query(Role).filter(Role.slug == data.slug).first():
        raise HTTPException(400, "A role with that slug already exists")
    # Validate permissions against registry
    for mod_key, actions in data.permissions.items():
        valid_actions = get_module_actions(mod_key)
        if valid_actions:  # skip validation for dynamic menu_ keys
            invalid = set(actions) - set(valid_actions)
            if invalid:
                raise HTTPException(400, f"Invalid actions {invalid} for module '{mod_key}'")
    role = Role(name=data.name, slug=data.slug, permissions=data.permissions, is_system=False)
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
        if data.permissions is not None:
            role.permissions = data.permissions
    else:
        if data.name is not None:
            role.name = data.name
        if data.permissions is not None:
            role.permissions = data.permissions
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
    from app.models.user import User
    db.query(User).filter(User.role == role.slug).update({"role": "viewer"})
    db.delete(role)
    db.commit()
    return {"ok": True}
```

**Step 2: Verify API works via Swagger**

Navigate to `http://localhost:8000/docs`, test `GET /roles/registry` and `GET /roles/my-permissions`.

**Step 3: Commit**

```bash
git add backend/app/routes/roles.py
git commit -m "feat(permissions): update role routes for permission matrix CRUD"
```

---

### Task 7: Add User Permission Override Routes

**Files:**
- Create: `backend/app/schemas/user_permission_override.py`
- Create: `backend/app/routes/user_permission_overrides.py`
- Modify: `backend/main.py` (register router)

**Step 1: Create schemas**

```python
from pydantic import BaseModel
from typing import List, Optional
from datetime import datetime


class OverrideCreate(BaseModel):
    user_id: int
    module_key: str
    granted_actions: List[str] = []
    revoked_actions: List[str] = []


class OverrideUpdate(BaseModel):
    granted_actions: Optional[List[str]] = None
    revoked_actions: Optional[List[str]] = None


class OverrideOut(BaseModel):
    id: int
    user_id: int
    module_key: str
    granted_actions: List[str]
    revoked_actions: List[str]
    granted_by: Optional[int]
    created_at: datetime

    class Config:
        from_attributes = True
```

**Step 2: Create routes**

```python
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from app.database import get_db
from app.dependencies import get_admin_user
from app.models.user_permission_override import UserPermissionOverride
from app.schemas.user_permission_override import OverrideCreate, OverrideUpdate, OverrideOut
from typing import List

router = APIRouter(prefix="/admin/permission-overrides", tags=["permission-overrides"])


@router.get("/{user_id}", response_model=List[OverrideOut])
def list_overrides(user_id: int, db: Session = Depends(get_db), _=Depends(get_admin_user)):
    return db.query(UserPermissionOverride).filter(
        UserPermissionOverride.user_id == user_id
    ).order_by(UserPermissionOverride.module_key).all()


@router.post("", response_model=OverrideOut)
def create_override(data: OverrideCreate, db: Session = Depends(get_db), admin=Depends(get_admin_user)):
    existing = db.query(UserPermissionOverride).filter(
        UserPermissionOverride.user_id == data.user_id,
        UserPermissionOverride.module_key == data.module_key
    ).first()
    if existing:
        raise HTTPException(400, f"Override for module '{data.module_key}' already exists for this user")
    override = UserPermissionOverride(
        user_id=data.user_id,
        module_key=data.module_key,
        granted_actions=data.granted_actions,
        revoked_actions=data.revoked_actions,
        granted_by=admin.id,
    )
    db.add(override)
    db.commit()
    db.refresh(override)
    return override


@router.put("/{override_id}", response_model=OverrideOut)
def update_override(override_id: int, data: OverrideUpdate, db: Session = Depends(get_db), _=Depends(get_admin_user)):
    ov = db.query(UserPermissionOverride).filter(UserPermissionOverride.id == override_id).first()
    if not ov:
        raise HTTPException(404, "Override not found")
    if data.granted_actions is not None:
        ov.granted_actions = data.granted_actions
    if data.revoked_actions is not None:
        ov.revoked_actions = data.revoked_actions
    db.commit()
    db.refresh(ov)
    return ov


@router.delete("/{override_id}")
def delete_override(override_id: int, db: Session = Depends(get_db), _=Depends(get_admin_user)):
    ov = db.query(UserPermissionOverride).filter(UserPermissionOverride.id == override_id).first()
    if not ov:
        raise HTTPException(404, "Override not found")
    db.delete(ov)
    db.commit()
    return {"ok": True}
```

**Step 3: Register router in `main.py`**

Add with other router imports and includes:

```python
from app.routes.user_permission_overrides import router as permission_overrides_router
app.include_router(permission_overrides_router)
```

**Step 4: Verify via Swagger**

**Step 5: Commit**

```bash
git add backend/app/schemas/user_permission_override.py backend/app/routes/user_permission_overrides.py backend/main.py
git commit -m "feat(permissions): add user permission override CRUD routes"
```

---

### Task 8: Data Migration — Convert Existing Roles & Permissions

**Files:**
- Modify: `backend/main.py` (add migration logic in startup)

**Step 1: Add migration SQL + Python in main.py startup**

After the `ALTER TABLE roles ADD COLUMN IF NOT EXISTS permissions` migration, add:

```python
# Migrate role.pages → role.permissions (one-time)
from app.permissions_registry import MODULE_REGISTRY
from app.models.role import Role as RoleModel

roles_to_migrate = db.query(RoleModel).filter(
    RoleModel.pages != None,
    RoleModel.permissions == {}
).all()

# Mapping old page keys to new module keys + full actions
PAGE_TO_MODULES = {
    "messaging": ["email", "messaging", "callcenter", "livechat"],
    "callcenter": ["callcenter"],
    "email": ["email"],
    "crm": ["crm"],
    "tickets": ["tickets"],
    "pms": ["pms"],
    "campaigns": ["campaigns"],
    "reports": ["reports"],
    "kb": ["kb"],
    "teams": ["teams"],
}

for role in roles_to_migrate:
    new_perms = {}
    for page_key in (role.pages or []):
        module_keys = PAGE_TO_MODULES.get(page_key, [page_key])
        for mk in module_keys:
            if mk in MODULE_REGISTRY:
                new_perms[mk] = MODULE_REGISTRY[mk]["actions"][:]
    if new_perms:
        role.permissions = new_perms
        db.add(role)

db.commit()
```

Also migrate `user_permissions` rows into `user_permission_overrides`:

```python
# Migrate user_permissions → user_permission_overrides (one-time)
from app.models.user_permission import UserPermission
from app.models.user_permission_override import UserPermissionOverride

PERM_KEY_TO_MODULE = {
    "module_email": "email",
    "module_workspace": "callcenter",
    "module_reports": "reports",
    "module_reminders": "reminders",
    "module_notifications": "notifications",
    "module_organizations": "organizations",
    "module_contacts": "contacts",
    "module_subscriptions": "subscriptions",
    "module_calls": "calls",
    "channel_whatsapp": "messaging",
    "channel_viber": "messaging",
    "channel_linkedin": "messaging",
    "channel_messenger": "messaging",
    "channel_webchat": "livechat",
}
# feature_* keys: strip "feature_" prefix
# e.g., "feature_manage_users" → "manage_users"

existing_overrides = db.query(UserPermissionOverride).count()
if existing_overrides == 0:
    old_perms = db.query(UserPermission).all()
    override_map = {}  # (user_id, module_key) → set of actions to grant

    for perm in old_perms:
        key = perm.permission_key
        if key in PERM_KEY_TO_MODULE:
            mod_key = PERM_KEY_TO_MODULE[key]
        elif key.startswith("feature_"):
            mod_key = key.replace("feature_", "")
        else:
            continue

        uid_mod = (perm.user_id, mod_key)
        if uid_mod not in override_map:
            override_map[uid_mod] = {"actions": set(), "granted_by": perm.granted_by}
        if mod_key in MODULE_REGISTRY:
            override_map[uid_mod]["actions"].update(MODULE_REGISTRY[mod_key]["actions"])

    for (user_id, mod_key), info in override_map.items():
        ov = UserPermissionOverride(
            user_id=user_id,
            module_key=mod_key,
            granted_actions=sorted(info["actions"]),
            revoked_actions=[],
            granted_by=info["granted_by"],
        )
        db.add(ov)

    db.commit()
```

**Step 2: Test migration**

Start backend, verify roles have `permissions` populated and overrides table has migrated data.

**Step 3: Commit**

```bash
git add backend/main.py
git commit -m "feat(permissions): migrate role.pages and user_permissions to new system"
```

---

### Task 9: Update Frontend `permissions.ts`

**Files:**
- Modify: `frontend/lib/permissions.ts`

**Step 1: Rewrite to use permission matrix**

```typescript
import { getAuthToken } from './auth';
import { API_URL } from '@/lib/config';

/**
 * Fetches the effective permission matrix and stores in localStorage.
 * Returns: { "module_key": ["action1", "action2"], ... }
 */
export async function fetchMyPermissions(): Promise<Record<string, string[]>> {
    const token = getAuthToken();
    if (!token) return {};

    try {
        const response = await fetch(`${API_URL}/roles/my-permissions`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!response.ok) return {};
        const data = await response.json();
        const permissions: Record<string, string[]> = data.permissions || {};
        localStorage.setItem('user_permissions', JSON.stringify(permissions));
        return permissions;
    } catch (err) {
        console.error('Failed to fetch user permissions:', err);
        return {};
    }
}

/**
 * Check if user has a specific action on a module.
 */
export function hasPermission(moduleKey: string, action: string): boolean {
    try {
        const user = localStorage.getItem('user');
        if (!user) return false;
        const parsed = JSON.parse(user);
        if (parsed.role === 'admin') return true;

        const stored = localStorage.getItem('user_permissions');
        if (!stored) return false;
        const permissions: Record<string, string[]> = JSON.parse(stored);
        return (permissions[moduleKey] || []).includes(action);
    } catch {
        return false;
    }
}

/**
 * Check if user can view a module (shorthand for hasPermission(key, "view")).
 */
export function hasModuleAccess(moduleKey: string): boolean {
    return hasPermission(moduleKey, 'view');
}

/**
 * LEGACY COMPAT — wraps hasModuleAccess for old page-key checks.
 */
export function hasPageAccess(pageKey: string): boolean {
    return hasModuleAccess(pageKey);
}

/**
 * LEGACY COMPAT — wraps hasModuleAccess for old admin feature checks.
 */
export function hasAdminFeature(featureKey: string): boolean {
    return hasModuleAccess(featureKey);
}

/**
 * LEGACY COMPAT — wraps hasModuleAccess for old channel checks.
 */
export function hasChannelAccess(channelKey: string): boolean {
    return hasModuleAccess(channelKey);
}

/**
 * Check if user has any administrative permissions.
 */
export function hasAnyAdminPermission(): boolean {
    try {
        const stored = localStorage.getItem('user_permissions');
        if (!stored) return false;
        const permissions: Record<string, string[]> = JSON.parse(stored);
        return Object.keys(permissions).length > 0;
    } catch {
        return false;
    }
}

/**
 * LEGACY COMPAT — no longer needed, permissions fetched via fetchMyPermissions.
 */
export function storeUserPages(_pages: string[]): void {
    // No-op. Permissions now stored as matrix via fetchMyPermissions.
}

export async function fetchAndStoreUserPages(): Promise<string[]> {
    const perms = await fetchMyPermissions();
    return Object.keys(perms);
}
```

**Step 2: Commit**

```bash
git add frontend/lib/permissions.ts
git commit -m "feat(permissions): rewrite frontend permissions.ts for permission matrix"
```

---

### Task 10: Update Frontend `api.ts` — Role API

**Files:**
- Modify: `frontend/lib/api.ts` (update `rolesApi` type signatures)

**Step 1: Update `rolesApi` object**

Find the `rolesApi` export (~line 172) and update:

```typescript
export const rolesApi = {
  list: () => api.get('/roles'),
  registry: () => api.get('/roles/registry'),
  myPermissions: () => api.get('/roles/my-permissions'),
  create: (data: { name: string; slug: string; permissions: Record<string, string[]> }) =>
    api.post('/roles', data),
  update: (id: number, data: { name?: string; permissions?: Record<string, string[]> }) =>
    api.put(`/roles/${id}`, data),
  delete: (id: number) => api.delete(`/roles/${id}`),
}
```

Also add override API:

```typescript
export const permissionOverrideApi = {
  list: (userId: number) => api.get(`/admin/permission-overrides/${userId}`),
  create: (data: { user_id: number; module_key: string; granted_actions: string[]; revoked_actions: string[] }) =>
    api.post('/admin/permission-overrides', data),
  update: (id: number, data: { granted_actions?: string[]; revoked_actions?: string[] }) =>
    api.put(`/admin/permission-overrides/${id}`, data),
  delete: (id: number) => api.delete(`/admin/permission-overrides/${id}`),
}
```

**Step 2: Commit**

```bash
git add frontend/lib/api.ts
git commit -m "feat(permissions): update rolesApi and add permissionOverrideApi"
```

---

### Task 11: Rebuild Frontend Roles Admin Page — Permission Matrix UI

**Files:**
- Modify: `frontend/app/admin/roles/page.tsx`

**Step 1: Rewrite the roles page**

This is the largest frontend change. The page should:

1. Fetch `GET /roles/registry` to get module list and available actions
2. Fetch `GET /roles` to get all roles
3. Render each role as a card with a matrix grid (modules as rows, actions as columns)
4. Create modal shows the full permission matrix with checkboxes
5. Edit modal shows the matrix pre-filled

Key UI elements:
- Module groups organized by category (Communication, Business, Admin, etc.)
- Each module row shows its label and available action checkboxes
- "Select All" / "Clear All" per module row
- Role card shows a summary of granted modules (not the full matrix)

Use the `frontend-design` skill when implementing this page for polished UI.

The full implementation code for this page is too large for the plan — the implementing agent should use `@frontend-design` skill and reference the existing page structure at `frontend/app/admin/roles/page.tsx`.

**Step 2: Verify page loads and renders matrix**

Navigate to `http://localhost:3000/admin/roles`, verify:
- Registry loads, modules appear as rows
- Existing roles show with their permissions
- Create/edit modals show the permission matrix
- Saving works via API

**Step 3: Commit**

```bash
git add frontend/app/admin/roles/page.tsx
git commit -m "feat(permissions): rebuild roles page with permission matrix UI"
```

---

### Task 12: Update AdminNav — Dynamic Menu Permission Check

**Files:**
- Modify: `frontend/components/AdminNav.tsx`

**Step 1: Update nav item filtering to use `hasModuleAccess`**

The `AdminNav.tsx` sidebar groups already use `pageKey` and `permission()` — these will continue to work because of the legacy compat shims in `permissions.ts`. But update the `moduleKey` property on items where it makes sense.

For dynamic menus, add permission check:

In the dynamic menus rendering section (~line 297), filter by permission:

```typescript
{dynamicMenus.map(group => {
    const activeItems = (group.items || []).filter((i: any) => i.is_active)
    if (activeItems.length === 0) return null
    // Check if user has access to this menu group
    if (userRole !== 'admin' && !hasModuleAccess(`menu_${group.slug}`)) return null
    return (
        // ... existing render code
    )
})}
```

**Step 2: Verify sidebar filters correctly**

Log in as a non-admin user, verify that only permitted menu groups appear.

**Step 3: Commit**

```bash
git add frontend/components/AdminNav.tsx
git commit -m "feat(permissions): add dynamic menu group permission filtering"
```

---

### Task 13: Register Dynamic Menu Groups in Permission System

**Files:**
- Modify: `backend/app/routes/roles.py` (update `/roles/registry` endpoint)

**Step 1: Include dynamic menu groups in registry response**

Update the `get_registry` endpoint to also include menu groups from the database:

```python
@router.get("/registry")
def get_registry(db: Session = Depends(get_db)):
    """Return module registry including dynamic menu groups."""
    from app.models.menu import MenuGroup
    registry = dict(MODULE_REGISTRY)  # copy static registry
    menu_groups = db.query(MenuGroup).filter(MenuGroup.is_active == True).all()
    for mg in menu_groups:
        registry[f"menu_{mg.slug}"] = {
            "label": mg.name,
            "actions": ["view"],
        }
    return registry
```

**Step 2: Commit**

```bash
git add backend/app/routes/roles.py
git commit -m "feat(permissions): include dynamic menu groups in registry endpoint"
```

---

### Task 14: Add User Override UI to Users Admin Page

**Files:**
- Modify: `frontend/app/admin/users/page.tsx`

**Step 1: Add permission override section to user edit**

When editing a user, add a section below the role selector that shows:
- Current effective permissions (from role)
- Override controls: for each module, ability to grant/revoke specific actions
- Uses `permissionOverrideApi` from `api.ts`

This is a UI-intensive task — the implementing agent should reference the existing user edit flow in `frontend/app/admin/users/page.tsx` and add an expandable "Permission Overrides" section.

**Step 2: Verify**

Edit a user, add an override (e.g., revoke "delete" from CRM), save, verify the user's effective permissions change.

**Step 3: Commit**

```bash
git add frontend/app/admin/users/page.tsx
git commit -m "feat(permissions): add user permission override UI to users admin page"
```

---

### Task 15: Final Cleanup & Verification

**Files:**
- Review: all modified files

**Step 1: Full integration test**

1. Start backend + frontend
2. Log in as admin — should see everything
3. Create a new role "Support Agent" with permissions: `messaging: [view, reply, assign]`, `livechat: [view, reply]`, `email: [view]`
4. Assign the role to a test user
5. Log in as that user — verify sidebar only shows permitted modules
6. Try accessing a restricted route directly — should get 403
7. As admin, add an override for the test user: grant `email: [compose, edit]`
8. Re-login as test user — verify email now has compose+edit

**Step 2: Verify dynamic menu permissions**

1. Create a menu group "Marketing Tools" in Menu Manager
2. As admin, edit the Support Agent role — do NOT grant `menu_marketing-tools`
3. Log in as Support Agent — "Marketing Tools" menu group should be hidden
4. Grant `menu_marketing-tools: [view]` to the role
5. Re-login — menu group now visible

**Step 3: Final commit**

```bash
git add -A
git commit -m "feat(permissions): complete role permission restructure"
```

---

## Summary of All Files Changed

**New files:**
- `backend/app/permissions_registry.py` — module registry constant
- `backend/app/models/user_permission_override.py` — override model
- `backend/app/schemas/user_permission_override.py` — override schemas
- `backend/app/routes/user_permission_overrides.py` — override CRUD routes

**Modified files:**
- `backend/app/models/role.py` — add `permissions` column
- `backend/app/schemas/role.py` — update to use `permissions` dict
- `backend/app/routes/roles.py` — add registry/my-permissions endpoints, update CRUD
- `backend/app/dependencies.py` — add `require_permission()`, legacy shims
- `backend/main.py` — migrations, router registration
- `frontend/lib/permissions.ts` — rewrite for permission matrix
- `frontend/lib/api.ts` — update rolesApi, add permissionOverrideApi
- `frontend/app/admin/roles/page.tsx` — permission matrix UI
- `frontend/app/admin/users/page.tsx` — override UI
- `frontend/components/AdminNav.tsx` — dynamic menu permission check
