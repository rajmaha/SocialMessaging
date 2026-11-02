from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer
from pydantic import BaseModel
from sqlalchemy.orm import Session
from app.models.user import User
from app.database import SessionLocal

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

security = HTTPBearer()

class TokenData(BaseModel):
    user_id: int
    role: str

oauth2_scheme = None  # Will be set in auth.py

async def verify_token(token: str) -> User:
    """The user a signed sign-in token names, or None (for WebSocket use).

    Only a token issued at sign-in (app.auth_tokens) is accepted -- never a
    bare user id or JSON, which anybody can write.
    """
    from app.auth_tokens import user_from_token

    db = SessionLocal()
    try:
        return user_from_token(token, db)
    finally:
        db.close()

async def get_current_user(token=Depends(HTTPBearer())) -> User:
    """The signed-in agent or admin, from `Authorization: Bearer <token>`."""
    user = await verify_token(token.credentials)
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Your session has ended. Please sign in again.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return user

async def get_admin_user(current_user: User = Depends(get_current_user)):
    """Verify current user is an admin"""
    if current_user.role != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only administrators can access this resource"
        )
    return current_user

def verify_admin_role(user: User) -> bool:
    """Check if user has admin role"""
    return user.role == "admin"

def verify_user_role(user: User) -> bool:
    """Check if user has user role"""
    return user.role in ["user", "admin"]

def require_module(module_key: str):
    """LEGACY SHIM — delegates to require_permission for module access"""
    clean_key = module_key.replace("module_", "")
    return require_permission(clean_key, "view")

def require_admin_feature(feature_key: str):
    """LEGACY SHIM — delegates to require_permission for admin features"""
    clean_key = feature_key.replace("feature_", "")
    return require_permission(clean_key, "view")


def require_page(page_key: str):
    """LEGACY SHIM — delegates to require_permission(page_key, "view")"""
    return require_permission(page_key, "view")


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
    for mod_key, actions in base_permissions.items():
        result[mod_key] = set(actions)

    for ov in overrides:
        if ov.module_key not in result:
            result[ov.module_key] = set()
        result[ov.module_key] |= set(ov.granted_actions or [])
        result[ov.module_key] -= set(ov.revoked_actions or [])

    return {k: sorted(v) for k, v in result.items() if v}
