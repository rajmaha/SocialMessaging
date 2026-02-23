from fastapi import APIRouter, Depends, HTTPException, status, Header, Query, Body
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session
from datetime import datetime
from app.database import get_db
from app.models.user import User
from app.models.platform_settings import PlatformSettings
from app.models.email import UserEmailAccount
from app.routes.auth import get_password_hash, verify_password
from app.schemas.email import EmailAccountCreate, EmailAccountUpdate, EmailAccountResponse, EmailAccountFullResponse, TestEmailCredentialsRequest
from pydantic import BaseModel
import json
import os

router = APIRouter(prefix="/admin", tags=["admin"])

def get_current_user(authorization: str = Header(None), db: Session = Depends(get_db)) -> dict:
    """Extract current user from Authorization header"""
    if not authorization:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authorization header required"
        )
    
    try:
        # Authorization: Bearer <user_json_or_id>
        parts = authorization.split()
        if len(parts) != 2 or parts[0].lower() != "bearer":
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid authorization header format"
            )
        
        token = parts[1]
        
        # Try to parse as user_id first
        try:
            user_id = int(token)
            user = db.query(User).filter(User.id == user_id).first()
            if not user:
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail="User not found"
                )
            return {
                "user_id": user.id,
                "username": user.username,
                "email": user.email,
                "role": user.role,
                "is_active": user.is_active
            }
        except ValueError:
            # Try to parse as JSON
            try:
                user_data = json.loads(token)
                if "user_id" not in user_data:
                    raise HTTPException(
                        status_code=status.HTTP_401_UNAUTHORIZED,
                        detail="Invalid token format"
                    )
                # Verify user exists in database
                user = db.query(User).filter(User.id == user_data["user_id"]).first()
                if not user:
                    raise HTTPException(
                        status_code=status.HTTP_401_UNAUTHORIZED,
                        detail="User not found"
                    )
                return {
                    "user_id": user.id,
                    "username": user.username,
                    "email": user.email,
                    "role": user.role,
                    "is_active": user.is_active
                }
            except json.JSONDecodeError:
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail="Invalid token"
                )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=str(e)
        )

def verify_admin(current_user: dict = Depends(get_current_user)) -> dict:
    """Verify user is admin"""
    if not current_user or current_user.get("role") != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin access required"
        )
    return current_user

class UserCreate(BaseModel):
    username: str
    email: str
    password: str
    full_name: str
    role: str = "user"  # "admin" or "user"

class UserResponse(BaseModel):
    id: int
    username: str
    email: str
    full_name: str
    role: str
    is_active: bool
    created_at: datetime
    
    class Config:
        from_attributes = True

class UserUpdate(BaseModel):
    full_name: str | None = None
    email: str | None = None
    is_active: bool | None = None

@router.get("/users", response_model=list[UserResponse])
async def list_users(current_user: dict = Depends(verify_admin), db: Session = Depends(get_db)):
    """List all users (admin only)"""
    users = db.query(User).all()
    return users

@router.post("/users", response_model=UserResponse)
async def create_user(
    user_data: UserCreate,
    current_user: dict = Depends(verify_admin),
    db: Session = Depends(get_db)
):
    """Create new user (admin only)"""
    
    # Check if user already exists
    existing_user = db.query(User).filter(
        (User.email == user_data.email) | (User.username == user_data.username)
    ).first()
    
    if existing_user:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Username or email already registered"
        )
    
    # Validate role
    if user_data.role not in ["admin", "user"]:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Role must be 'admin' or 'user'"
        )
    
    # Create new user
    db_user = User(
        username=user_data.username,
        email=user_data.email,
        password_hash=get_password_hash(user_data.password),
        full_name=user_data.full_name,
        role=user_data.role,
        created_by=current_user.get("user_id"),
        is_active=True
    )
    
    db.add(db_user)
    db.commit()
    db.refresh(db_user)
    
    return db_user

@router.get("/users/{user_id}", response_model=UserResponse)
async def get_user(
    user_id: int,
    current_user: dict = Depends(verify_admin),
    db: Session = Depends(get_db)
):
    """Get user details (admin only)"""
    
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found"
        )
    
    return user

@router.put("/users/{user_id}", response_model=UserResponse)
async def update_user(
    user_id: int,
    user_update: UserUpdate,
    current_user: dict = Depends(verify_admin),
    db: Session = Depends(get_db)
):
    """Update user info (admin only)"""
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found"
        )
    if user_update.full_name is not None:
        user.full_name = user_update.full_name
    if user_update.email is not None:
        # Check for email conflict
        existing = db.query(User).filter(User.email == user_update.email, User.id != user_id).first()
        if existing:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Email already in use"
            )
        user.email = user_update.email
    if user_update.is_active is not None:
        user.is_active = user_update.is_active
    user.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(user)
    return user

@router.put("/users/{user_id}/role")
async def update_user_role(
    user_id: int,
    role: str,
    current_user: dict = Depends(verify_admin),
    db: Session = Depends(get_db)
):
    """Update user role (admin only)"""
    
    if role not in ["admin", "user"]:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Role must be 'admin' or 'user'"
        )
    
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found"
        )
    
    user.role = role
    user.updated_at = datetime.utcnow()
    db.commit()
    
    return {
        "status": "success",
        "message": f"User role updated to {role}",
        "user_id": user_id,
        "new_role": role
    }

@router.delete("/users/{user_id}")
async def deactivate_user(
    user_id: int,
    current_user: dict = Depends(verify_admin),
    db: Session = Depends(get_db)
):
    """Deactivate user (admin only)"""
    
    # Prevent admin from deactivating themselves
    if user_id == current_user.get("user_id"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot deactivate your own account"
        )
    
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found"
        )
    
    user.is_active = False
    user.updated_at = datetime.utcnow()
    db.commit()
    
    return {
        "status": "success",
        "message": "User deactivated",
        "user_id": user_id
    }

# ============ PLATFORM SETTINGS ============

class PlatformSettingUpdate(BaseModel):
    app_id: str = None
    app_secret: str = None
    access_token: str = None
    verify_token: str = None
    business_account_id: str = None
    phone_number: str = None
    phone_number_id: str = None
    organization_id: str = None
    page_id: str = None
    config: dict = None

@router.get("/platforms")
async def get_platform_settings(current_user: dict = Depends(verify_admin), db: Session = Depends(get_db)):
    """Get all platform settings (admin only)"""
    
    platforms = db.query(PlatformSettings).all()
    return [
        {
            "id": p.id,
            "platform": p.platform,
            "is_configured": p.is_configured,
            "webhook_registered": p.webhook_registered,
            "updated_at": p.updated_at
        }
        for p in platforms
    ]

@router.get("/platforms/{platform}")
async def get_platform_setting(
    platform: str,
    current_user: dict = Depends(verify_admin),
    db: Session = Depends(get_db)
):
    """Get specific platform setting (admin only)"""
    
    setting = db.query(PlatformSettings).filter(
        PlatformSettings.platform == platform.lower()
    ).first()
    
    if not setting:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Settings for {platform} not found"
        )
    
    return {
        "id": setting.id,
        "platform": setting.platform,
        "app_id": setting.app_id,
        "business_account_id": setting.business_account_id,
        "phone_number": setting.phone_number,
        "organization_id": setting.organization_id,
        "page_id": setting.page_id,
        "is_configured": setting.is_configured,
        "webhook_registered": setting.webhook_registered,
        "config": setting.config,
        "updated_at": setting.updated_at
    }

@router.put("/platforms/{platform}")
async def update_platform_setting(
    platform: str,
    settings: PlatformSettingUpdate,
    current_user: dict = Depends(verify_admin),
    db: Session = Depends(get_db)
):
    """Update platform settings (admin only)"""
    
    platform = platform.lower()
    valid_platforms = ["facebook", "whatsapp", "viber", "linkedin"]
    
    if platform not in valid_platforms:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Platform must be one of: {', '.join(valid_platforms)}"
        )
    
    # Get or create setting
    setting = db.query(PlatformSettings).filter(
        PlatformSettings.platform == platform
    ).first()
    
    if not setting:
        setting = PlatformSettings(platform=platform)
        db.add(setting)
    
    # Update fields
    update_data = settings.dict(exclude_unset=True)
    for field, value in update_data.items():
        if value is not None:
            setattr(setting, field, value)
    
    setting.is_configured = 1  # Mark as configured
    setting.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(setting)
    
    return {
        "status": "success",
        "message": f"{platform.title()} settings updated",
        "platform": setting.platform,
        "is_configured": setting.is_configured,
        "updated_at": setting.updated_at
    }

@router.post("/platforms/{platform}/verify")
async def verify_platform_setting(
    platform: str,
    current_user: dict = Depends(verify_admin),
    db: Session = Depends(get_db)
):
    """Mark platform as verified (admin only)"""
    
    setting = db.query(PlatformSettings).filter(
        PlatformSettings.platform == platform.lower()
    ).first()
    
    if not setting:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Settings for {platform} not found"
        )
    
    setting.is_configured = 2  # Mark as verified
    setting.webhook_registered = 1
    setting.updated_at = datetime.utcnow()
    db.commit()
    
    return {
        "status": "success",
        "message": f"{platform.title()} verified",
        "is_configured": setting.is_configured
    }

# ============ ADMIN DASHBOARD ============

@router.get("/dashboard")
async def admin_dashboard(current_user: dict = Depends(verify_admin), db: Session = Depends(get_db)):
    """Get admin dashboard data"""
    
    total_users = db.query(User).count()
    active_users = db.query(User).filter(User.is_active == True).count()
    admin_users = db.query(User).filter(User.role == "admin").count()
    regular_users = db.query(User).filter(User.role == "user").count()
    
    platforms_config = db.query(PlatformSettings).all()
    platforms_data = {
        p.platform: {
            "is_configured": p.is_configured,
            "webhook_registered": p.webhook_registered
        }
        for p in platforms_config
    }
    
    return {
        "total_users": total_users,
        "active_users": active_users,
        "admin_users": admin_users,
        "regular_users": regular_users,
        "platforms": platforms_data,
        "timestamp": datetime.utcnow()
    }


# ============ EMAIL ACCOUNT MANAGEMENT (ADMIN) ============

@router.post("/email-accounts", response_model=EmailAccountResponse)
async def create_user_email_account(
    user_id: int = Query(..., description="ID of user to create email account for"),
    account_data: EmailAccountCreate = Body(...),
    current_user: dict = Depends(verify_admin),
    db: Session = Depends(get_db)
):
    """Create email account for a user (admin only)"""
    
    # Check user exists
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found"
        )
    
    # Check if user already has email account
    existing = db.query(UserEmailAccount).filter(UserEmailAccount.user_id == user_id).first()
    if existing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="User already has an email account configured"
        )
    
    # Check email doesn't already exist
    email_exists = db.query(UserEmailAccount).filter(
        UserEmailAccount.email_address == account_data.email_address
    ).first()
    if email_exists:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Email address already configured for another user"
        )
    
    # Create email account
    db_account = UserEmailAccount(
        user_id=user_id,
        email_address=account_data.email_address,
        account_name=account_data.account_name,
        display_name=account_data.display_name or account_data.email_address,
        imap_host=account_data.imap_host,
        imap_port=account_data.imap_port,
        imap_username=account_data.imap_username,
        imap_password=account_data.imap_password,
        smtp_host=account_data.smtp_host,
        smtp_port=account_data.smtp_port,
        smtp_username=account_data.smtp_username,
        smtp_password=account_data.smtp_password,
        is_active=True
    )
    
    db.add(db_account)
    db.commit()
    db.refresh(db_account)
    
    return db_account


@router.get("/email-accounts", response_model=list[EmailAccountResponse])
async def list_email_accounts(
    user_id: int = None,
    current_user: dict = Depends(verify_admin),
    db: Session = Depends(get_db)
):
    """List email accounts (admin only) - optionally filter by user"""
    
    query = db.query(UserEmailAccount)
    if user_id:
        query = query.filter(UserEmailAccount.user_id == user_id)
    
    return query.all()


@router.get("/email-accounts/{account_id}", response_model=EmailAccountResponse)
async def get_email_account(
    account_id: int,
    current_user: dict = Depends(verify_admin),
    db: Session = Depends(get_db)
):
    """Get email account details (admin only)"""
    
    account = db.query(UserEmailAccount).filter(UserEmailAccount.id == account_id).first()
    if not account:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Email account not found"
        )
    
    return account


@router.get("/email-accounts/{account_id}/full", response_model=EmailAccountFullResponse)
async def get_email_account_full(
    account_id: int,
    current_user: dict = Depends(verify_admin),
    db: Session = Depends(get_db)
):
    """Get email account full details with credentials (admin only)"""
    
    account = db.query(UserEmailAccount).filter(UserEmailAccount.id == account_id).first()
    if not account:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Email account not found"
        )
    
    return account


@router.put("/email-accounts/{account_id}", response_model=EmailAccountResponse)
async def update_email_account(
    account_id: int,
    account_update: EmailAccountUpdate,
    current_user: dict = Depends(verify_admin),
    db: Session = Depends(get_db)
):
    """Update email account (admin only)"""
    
    account = db.query(UserEmailAccount).filter(UserEmailAccount.id == account_id).first()
    if not account:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Email account not found"
        )
    
    # Update fields
    if account_update.email_address is not None:
        account.email_address = account_update.email_address
    if account_update.account_name is not None:
        account.account_name = account_update.account_name
    if account_update.display_name is not None:
        account.display_name = account_update.display_name
    if account_update.is_active is not None:
        account.is_active = account_update.is_active
    
    # Update IMAP settings
    if account_update.imap_host is not None:
        account.imap_host = account_update.imap_host
    if account_update.imap_port is not None:
        account.imap_port = account_update.imap_port
    if account_update.imap_username is not None:
        account.imap_username = account_update.imap_username
    if account_update.imap_password is not None and account_update.imap_password.strip():  # Only update if not empty
        account.imap_password = account_update.imap_password
    
    # Update SMTP settings
    if account_update.smtp_host is not None:
        account.smtp_host = account_update.smtp_host
    if account_update.smtp_port is not None:
        account.smtp_port = account_update.smtp_port
    if account_update.smtp_username is not None:
        account.smtp_username = account_update.smtp_username
    if account_update.smtp_password is not None and account_update.smtp_password.strip():  # Only update if not empty
        account.smtp_password = account_update.smtp_password
    if account_update.smtp_security is not None:
        account.smtp_security = account_update.smtp_security
    
    account.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(account)
    
    return account


@router.delete("/email-accounts/{account_id}")
async def delete_email_account(
    account_id: int,
    current_user: dict = Depends(verify_admin),
    db: Session = Depends(get_db)
):
    """Delete email account (admin only)"""
    
    account = db.query(UserEmailAccount).filter(UserEmailAccount.id == account_id).first()
    if not account:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Email account not found"
        )
    
    user_id = account.user_id
    db.delete(account)
    db.commit()
    
    return {
        "status": "success",
        "message": "Email account deleted",
        "user_id": user_id
    }


@router.post("/email-accounts/test-credentials")
async def test_email_credentials(
    request_data: TestEmailCredentialsRequest,
    current_user: dict = Depends(verify_admin)
):
    """Test email account credentials (admin only)"""
    try:
        import smtplib
        from imap_tools import MailBox
        
        imap_ok = False
        imap_message = "Not tested"
        smtp_ok = False
        smtp_message = "Not tested"
        
        # Test IMAP connection
        try:
            with MailBox(request_data.imap_host, request_data.imap_port).login(
                request_data.imap_username, request_data.imap_password
            ) as mailbox:
                mailbox.folder.set('INBOX')
                imap_ok = True
                imap_message = f"✅ IMAP connected successfully to {request_data.imap_host}:{request_data.imap_port}"
        except Exception as e:
            imap_message = f"❌ IMAP error: {str(e)}"
        
        # Test SMTP connection
        try:
            smtp_security = request_data.smtp_security.upper()  # SSL, TLS, STARTTLS, or NONE
            
            if smtp_security == 'SSL':
                # Use SMTP_SSL for implicit SSL
                with smtplib.SMTP_SSL(request_data.smtp_host, request_data.smtp_port) as server:
                    server.login(request_data.smtp_username, request_data.smtp_password)
                    smtp_ok = True
                    smtp_message = f"✅ SMTP SSL connected successfully to {request_data.smtp_host}:{request_data.smtp_port}"
            elif smtp_security in ['STARTTLS', 'TLS']:
                # Use SMTP with starttls()
                with smtplib.SMTP(request_data.smtp_host, request_data.smtp_port) as server:
                    server.starttls()
                    server.login(request_data.smtp_username, request_data.smtp_password)
                    smtp_ok = True
                    smtp_message = f"✅ SMTP {smtp_security} connected successfully to {request_data.smtp_host}:{request_data.smtp_port}"
            else:  # NONE
                # Use SMTP without encryption
                with smtplib.SMTP(request_data.smtp_host, request_data.smtp_port) as server:
                    server.login(request_data.smtp_username, request_data.smtp_password)
                    smtp_ok = True
                    smtp_message = f"✅ SMTP (no encryption) connected successfully to {request_data.smtp_host}:{request_data.smtp_port}"
        except Exception as e:
            smtp_message = f"❌ SMTP error: {str(e)}"
        
        return {
            "status": "success" if (imap_ok and smtp_ok) else "partial",
            "imap_ok": imap_ok,
            "smtp_ok": smtp_ok,
            "imap_message": imap_message,
            "smtp_message": smtp_message
        }
        
    except Exception as e:
        raise HTTPException(
            status_code=400,
            detail=f"Error testing credentials: {str(e)}"
        )
