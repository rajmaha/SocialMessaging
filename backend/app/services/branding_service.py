"""
Branding service for managing company branding and SMTP settings
"""

from sqlalchemy.orm import Session
from app.models.branding import BrandingSettings
from typing import Optional

class BrandingService:
    """Service for managing branding settings"""
    
    @staticmethod
    def get_branding(db: Session) -> BrandingSettings:
        """Get current branding settings"""
        branding = db.query(BrandingSettings).first()
        
        if not branding:
            # Create default branding if not exists
            branding = BrandingSettings()
            db.add(branding)
            db.commit()
            db.refresh(branding)
        
        return branding
    
    @staticmethod
    def get_branding_public(db: Session) -> dict:
        """Get branding settings for public display (no sensitive data)"""
        branding = BrandingService.get_branding(db)
        
        return {
            "company_name": branding.company_name,
            "company_description": branding.company_description,
            "logo_url": branding.logo_url,
            "favicon_url": branding.favicon_url,
            "primary_color": branding.primary_color,
            "secondary_color": branding.secondary_color,
            "accent_color": branding.accent_color,
            "support_url": branding.support_url,
            "privacy_url": branding.privacy_url,
            "terms_url": branding.terms_url,
            "timezone": branding.timezone,
        }
    
    @staticmethod
    def update_branding(db: Session, **kwargs) -> BrandingSettings:
        """Update branding settings"""
        branding = BrandingService.get_branding(db)
        
        # Allowed fields for update
        allowed_fields = {
            'company_name', 'company_description', 'logo_url', 'favicon_url',
            'primary_color', 'secondary_color', 'accent_color',
            'smtp_server', 'smtp_port', 'smtp_username', 'smtp_password',
            'smtp_from_email', 'smtp_from_name', 'smtp_use_tls',
            'email_footer_text', 'email_support_url',
            'support_url', 'privacy_url', 'terms_url', 'timezone', 'admin_email',
            'button_primary_color', 'button_primary_hover_color', 'sidebar_text_color',
            'header_bg_color', 'layout_bg_color'
        }
        
        for key, value in kwargs.items():
            if key in allowed_fields:
                setattr(branding, key, value)
        
        db.commit()
        db.refresh(branding)
        return branding
    
    @staticmethod
    def get_smtp_config(db: Session) -> dict:
        """Get SMTP configuration"""
        branding = BrandingService.get_branding(db)
        
        return {
            "smtp_server": branding.smtp_server,
            "smtp_port": branding.smtp_port,
            "smtp_username": branding.smtp_username,
            "smtp_password": branding.smtp_password,
            "smtp_from_email": branding.smtp_from_email,
            "smtp_from_name": branding.smtp_from_name,
            "smtp_use_tls": branding.smtp_use_tls,
        }

# Singleton instance
branding_service = BrandingService()
