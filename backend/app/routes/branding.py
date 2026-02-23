"""
Branding routes for managing company branding and SMTP settings
"""

from fastapi import APIRouter, Depends, HTTPException, status, Header
from sqlalchemy.orm import Session
from app.database import get_db
from app.models.user import User
from app.services.branding_service import branding_service
from pydantic import BaseModel
from typing import Optional, List

router = APIRouter(prefix="/branding", tags=["branding"])

def get_current_user(authorization: Optional[str] = Header(None), db: Session = Depends(get_db)) -> User:
    """Extract user from Authorization header"""
    if not authorization:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authorization header required"
        )
    
    try:
        parts = authorization.split()
        if len(parts) != 2 or parts[0].lower() != "bearer":
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid authorization header"
            )
        
        user_id = int(parts[1])
        user = db.query(User).filter(User.id == user_id).first()
        
        if not user:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="User not found"
            )
        
        return user
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid authorization token"
        )

def verify_admin(user: User = Depends(get_current_user)) -> User:
    """Verify user is admin"""
    if user.role != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin access required"
        )
    return user

class BrandingUpdate(BaseModel):
    company_name: Optional[str] = None
    company_description: Optional[str] = None
    logo_url: Optional[str] = None
    favicon_url: Optional[str] = None
    primary_color: Optional[str] = None
    secondary_color: Optional[str] = None
    accent_color: Optional[str] = None
    support_url: Optional[str] = None
    privacy_url: Optional[str] = None
    terms_url: Optional[str] = None
    timezone: Optional[str] = None
    admin_email: Optional[str] = None
    allowed_file_types: Optional[List[str]] = None
    max_file_size_mb: Optional[int] = None

class SmtpUpdate(BaseModel):
    smtp_server: Optional[str] = None
    smtp_port: Optional[int] = None
    smtp_username: Optional[str] = None
    smtp_password: Optional[str] = None
    smtp_from_email: Optional[str] = None
    smtp_from_name: Optional[str] = None
    smtp_use_tls: Optional[bool] = None
    email_footer_text: Optional[str] = None
    email_support_url: Optional[str] = None

@router.get("/")
def get_branding_public(db: Session = Depends(get_db)):
    """Get public branding settings (no authentication required)"""
    branding_obj = branding_service.get_branding(db)
    return {
        "status": "success",
        "data": {
            "company_name": branding_obj.company_name,
            "company_description": branding_obj.company_description,
            "logo_url": branding_obj.logo_url,
            "favicon_url": branding_obj.favicon_url,
            "primary_color": branding_obj.primary_color,
            "secondary_color": branding_obj.secondary_color,
            "accent_color": branding_obj.accent_color,
            "support_url": branding_obj.support_url,
            "privacy_url": branding_obj.privacy_url,
            "terms_url": branding_obj.terms_url,
            "timezone": branding_obj.timezone,
            "admin_email": branding_obj.admin_email,
            "allowed_file_types": branding_obj.allowed_file_types,
            "max_file_size_mb": branding_obj.max_file_size_mb or 10,
        }
    }

@router.get("/admin")
def get_branding_admin(
    user: User = Depends(verify_admin),
    db: Session = Depends(get_db)
):
    """Get full branding settings (admin only)"""
    branding = branding_service.get_branding(db)
    
    return {
        "status": "success",
        "data": {
            "company_name": branding.company_name,
            "company_description": branding.company_description,
            "logo_url": branding.logo_url,
            "favicon_url": branding.favicon_url,
            "primary_color": branding.primary_color,
            "secondary_color": branding.secondary_color,
            "accent_color": branding.accent_color,
            "smtp_server": branding.smtp_server,
            "smtp_port": branding.smtp_port,
            "smtp_username": branding.smtp_username,
            "smtp_password": "***" if branding.smtp_password else None,
            "smtp_from_email": branding.smtp_from_email,
            "smtp_from_name": branding.smtp_from_name,
            "smtp_use_tls": branding.smtp_use_tls,
            "email_footer_text": branding.email_footer_text,
            "email_support_url": branding.email_support_url,
            "support_url": branding.support_url,
            "privacy_url": branding.privacy_url,
            "terms_url": branding.terms_url,
            "timezone": branding.timezone,
            "admin_email": branding.admin_email,
            "allowed_file_types": branding.allowed_file_types,
            "max_file_size_mb": branding.max_file_size_mb or 10,
            "created_at": branding.created_at,
            "updated_at": branding.updated_at,
        }
    }

@router.post("/update")
def update_branding(
    update_data: BrandingUpdate,
    user: User = Depends(verify_admin),
    db: Session = Depends(get_db)
):
    """Update branding settings (admin only)"""
    
    update_dict = update_data.dict(exclude_unset=True)
    branding = branding_service.update_branding(db, **update_dict)
    
    return {
        "status": "success",
        "message": "Branding updated successfully",
        "data": {
            "company_name": branding.company_name,
            "company_description": branding.company_description,
            "logo_url": branding.logo_url,
            "primary_color": branding.primary_color,
        }
    }

@router.post("/smtp")
def update_smtp(
    smtp_data: SmtpUpdate,
    user: User = Depends(verify_admin),
    db: Session = Depends(get_db)
):
    """Update SMTP settings (admin only)"""
    
    update_dict = smtp_data.dict(exclude_unset=True)
    branding = branding_service.update_branding(db, **update_dict)
    
    return {
        "status": "success",
        "message": "SMTP settings updated successfully",
        "data": {
            "smtp_server": branding.smtp_server,
            "smtp_port": branding.smtp_port,
            "smtp_from_email": branding.smtp_from_email,
            "smtp_from_name": branding.smtp_from_name,
        }
    }

@router.post("/test-smtp")
def test_smtp(
    user: User = Depends(verify_admin),
    db: Session = Depends(get_db)
):
    """Send test SMTP email (admin only)"""
    import smtplib
    from email.mime.text import MIMEText
    from email.mime.multipart import MIMEMultipart
    
    branding = branding_service.get_branding(db)
    
    if not branding.smtp_password or not branding.smtp_username:
        return {
            "status": "error",
            "message": "SMTP credentials not configured"
        }
    
    try:
        message = MIMEMultipart("alternative")
        message["Subject"] = "SMTP Configuration Test"
        message["From"] = f"{branding.smtp_from_name} <{branding.smtp_from_email}>"
        message["To"] = user.email
        
        html_body = f"""
        <html>
            <body style="font-family: Arial, sans-serif;">
                <h2 style="color: {branding.primary_color};">SMTP Configuration Test</h2>
                <p>This is a test email from {branding.company_name}.</p>
                <p style="color: #888; font-size: 12px;">
                    {branding.email_footer_text}
                </p>
            </body>
        </html>
        """
        
        message.attach(MIMEText(html_body, "html"))
        
        with smtplib.SMTP(branding.smtp_server, branding.smtp_port) as server:
            if branding.smtp_use_tls:
                server.starttls()
            server.login(branding.smtp_username, branding.smtp_password)
            server.sendmail(branding.smtp_from_email, user.email, message.as_string())
        
        return {
            "status": "success",
            "message": f"Test email sent to {user.email}"
        }
    
    except Exception as e:
        return {
            "status": "error",
            "message": f"Failed to send test email: {str(e)}"
        }
