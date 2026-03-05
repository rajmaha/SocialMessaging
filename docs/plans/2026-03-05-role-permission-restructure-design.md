# Role & Permission System Restructure — Design

**Date:** 2026-03-05
**Status:** Approved
**Approach:** Unified Permission Matrix (replaces dual role.pages + user_permissions system)

## Problem

1. Dynamic menu groups have no connection to the role system — anyone logged in can see them
2. Permissions are all-or-nothing per module — no CRUD-level control (view/add/edit/delete)
3. "Messaging / Inbox" is a single page key but email, messaging channels, call center, and live chat are used by different teams

## Solution Overview

Replace both `role.pages` (JSONB array) and `user_permissions` (per-user table) with a **single unified permission matrix** on roles, plus a **user-level override** table for per-user exceptions.

- Each module defines its own available actions (custom per module)
- Roles store a permissions dict: `{ module_key: [actions] }`
- User overrides can grant or revoke specific actions beyond the role default
- Dynamic menu groups become modules (`menu_{slug}`) with at minimum `"view"` action
- Admins bypass all permission checks

## Module Registry

Backend constant defining all modules and their available actions:

```python
MODULE_REGISTRY = {
    # Communication (split from single "messaging")
    "email":        {"label": "Email",              "actions": ["view", "compose", "edit", "delete", "export"]},
    "messaging":    {"label": "Messaging Channels",  "actions": ["view", "reply", "assign", "delete"]},
    "callcenter":   {"label": "Call Center",         "actions": ["view", "make_call", "edit", "delete"]},
    "livechat":     {"label": "Live Chat",           "actions": ["view", "reply", "assign", "delete"]},

    # Business modules
    "crm":          {"label": "CRM",                 "actions": ["view", "add", "edit", "delete", "import", "export"]},
    "tickets":      {"label": "Tickets",             "actions": ["view", "add", "edit", "delete", "assign"]},
    "pms":          {"label": "Projects (PMS)",      "actions": ["view", "add", "edit", "delete"]},
    "campaigns":    {"label": "Email Campaigns",     "actions": ["view", "add", "edit", "delete", "send"]},
    "reports":      {"label": "Reports",             "actions": ["view", "export"]},
    "kb":           {"label": "Knowledge Base",      "actions": ["view", "add", "edit", "delete", "publish"]},
    "teams":        {"label": "Teams",               "actions": ["view", "add", "edit", "delete"]},

    # Dynamic menu groups auto-register at runtime as "menu_{slug}"
    # with at minimum "view" action
}
```

## Role Model

```python
class Role(Base):
    __tablename__ = "roles"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(100), nullable=False)
    slug = Column(String(100), unique=True, nullable=False)
    is_system = Column(Boolean, default=False)
    permissions = Column(JSONB, default=dict)  # replaces "pages"
    created_at = Column(DateTime, default=datetime.utcnow)
```

Permissions field example:

```json
{
  "email": ["view", "compose", "edit", "delete", "export"],
  "messaging": ["view", "reply"],
  "crm": ["view", "add", "edit"],
  "reports": ["view"],
  "menu_marketing": ["view"]
}
```

- No entry for a module = no access
- Admins bypass everything (no permissions stored)

## User-Level Overrides

```python
class UserPermissionOverride(Base):
    __tablename__ = "user_permission_overrides"

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    module_key = Column(String(100), nullable=False)
    granted_actions = Column(JSONB, default=list)   # actions to ADD beyond role
    revoked_actions = Column(JSONB, default=list)    # actions to REMOVE from role
    granted_by = Column(Integer, ForeignKey("users.id"))
    created_at = Column(DateTime, default=datetime.utcnow)
    # Unique constraint: (user_id, module_key)
```

Resolution: `effective_actions = (role_actions + granted_actions) - revoked_actions`

## Backend Authorization

New `require_permission()` dependency replaces `require_page()`, `require_module()`, and `require_admin_feature()`:

```python
def require_permission(module_key: str, action: str):
    """Check role permissions + user overrides. Admins bypass."""
    async def _check(current_user=Depends(get_current_user), db=Depends(get_db)):
        if current_user.role == "admin":
            return current_user

        role = db.query(Role).filter(Role.slug == current_user.role).first()
        role_actions = (role.permissions or {}).get(module_key, []) if role else []

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
            raise HTTPException(403, f"No '{action}' permission for '{module_key}'")
        return current_user
    return _check
```

Usage:

```python
# Router-level guard
router = APIRouter(prefix="/crm", dependencies=[Depends(require_permission("crm", "view"))])

# Endpoint-level guard
@router.post("/leads")
def create_lead(..., _=Depends(require_permission("crm", "add"))): ...

@router.delete("/leads/{id}")
def delete_lead(..., _=Depends(require_permission("crm", "delete"))): ...
```

New endpoint for frontend:

```python
@router.get("/my-permissions")
def get_my_permissions(current_user, db):
    """Returns full effective permission matrix: {"email": ["view","compose"], ...}"""
```

## Frontend Changes

### permissions.ts

```typescript
// Fetch and cache effective permissions after login
export async function fetchMyPermissions(): Promise<Record<string, string[]>> { ... }

// Check specific action
export function hasPermission(moduleKey: string, action: string): boolean { ... }

// Shorthand for "view" access
export function hasModuleAccess(moduleKey: string): boolean {
    return hasPermission(moduleKey, "view");
}
```

### AdminNav.tsx

```typescript
// Hardcoded nav items
if (item.moduleKey) return hasModuleAccess(item.moduleKey);

// Dynamic menu groups
if (group.slug) return hasModuleAccess(`menu_${group.slug}`);
```

### Roles Admin Page

Permission matrix grid:
- Rows = modules (from registry + dynamic menu groups)
- Columns = available actions for that module
- Checkboxes at each intersection

User override UI accessible from the user edit page.

## Migration Strategy

Inline SQL in `main.py` (no Alembic):

1. Add `permissions` JSONB column to `roles` table
2. Migrate `role.pages` arrays to permissions dict (each page key gets all its actions by default)
3. Create `user_permission_overrides` table
4. Migrate `user_permissions` rows into overrides (module keys map directly; features become granted_actions)
5. Old `require_page()` and `require_module()` become thin shims calling `require_permission(key, "view")` during transition
6. Drop old columns and `user_permissions` table after verification

### Data Migration Example

```
Old role.pages: ["crm", "tickets", "reports"]
New role.permissions: {
    "crm": ["view", "add", "edit", "delete", "import", "export"],
    "tickets": ["view", "add", "edit", "delete", "assign"],
    "reports": ["view", "export"]
}
```

Old "messaging" page key splits into: user gets all 4 new modules (email, messaging, callcenter, livechat) with full actions — admin can then trim as needed.
