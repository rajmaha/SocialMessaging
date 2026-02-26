from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer
from pydantic import BaseModel
from app.models.user import User
from app.database import SessionLocal
import json

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
    """Verify token and return user (for WebSocket use)"""
    user_id = None
    
    try:
        # Try to parse as user_id (integer)
        try:
            user_id = int(token)
        except ValueError:
            # Try to parse as JSON
            user_data = json.loads(token)
            user_id = user_data.get("user_id")
        
        if user_id is None:
            return None
        
        db = SessionLocal()
        user = db.query(User).filter(User.id == user_id).first()
        db.close()
        
        return user
    except Exception as e:
        return None

async def get_current_user(token: str = Depends(HTTPBearer())) -> User:
    """Get current user from bearer token (user_id or JSON)"""
    from app.database import SessionLocal
    import json
    
    token_str = token.credentials
    user_id = None
    
    try:
        # Try to parse as user_id (integer)
        try:
            user_id = int(token_str)
        except ValueError:
            # Try to parse as JSON
            user_data = json.loads(token_str)
            user_id = user_data.get("user_id")
        
        if user_id is None:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid token format",
                headers={"WWW-Authenticate": "Bearer"},
            )
        
        db = SessionLocal()
        user = db.query(User).filter(User.id == user_id).first()
        db.close()
        
        if user is None:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="User not found"
            )
        
        return user
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Invalid authentication credentials: {str(e)}",
            headers={"WWW-Authenticate": "Bearer"},
        )

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
    """Dependency generator to require access to a specific module or channel"""
    async def verify_module_access(current_user: User = Depends(get_current_user)):
        if current_user.role == "admin":
            return current_user
            
        from app.database import SessionLocal
        from app.models.user_permission import UserPermission
        
        db = SessionLocal()
        try:
            perm = db.query(UserPermission).filter(
                UserPermission.user_id == current_user.id,
                UserPermission.permission_key == module_key
            ).first()
            if not perm:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail=f"Access to {module_key} is disabled for your account"
                )
            return current_user
        finally:
            db.close()
            
    return verify_module_access

def require_admin_feature(feature_key: str):
    """Dependency generator for sub-admin precise feature grants"""
    async def verify_admin_access(current_user: User = Depends(get_current_user)):
        if current_user.role == "admin":
            return current_user
            
        from app.database import SessionLocal
        from app.models.user_permission import UserPermission
        
        db = SessionLocal()
        try:
            perm = db.query(UserPermission).filter(
                UserPermission.user_id == current_user.id,
                UserPermission.permission_key == feature_key
            ).first()
            if not perm:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail=f"You do not have permission to use the {feature_key} feature"
                )
            return current_user
        finally:
            db.close()
            
    return verify_admin_access
