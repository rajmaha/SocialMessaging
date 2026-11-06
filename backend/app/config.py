from pydantic_settings import BaseSettings
from typing import Optional

class Settings(BaseSettings):
    # Database
    DATABASE_URL: str = "postgresql://user:password@localhost:5432/socialmedia"
    
    # API Keys
    WHATSAPP_API_KEY: Optional[str] = None
    WHATSAPP_PHONE_NUMBER_ID: Optional[str] = None
    WHATSAPP_VERIFY_TOKEN: Optional[str] = None   # chosen by you when registering webhook
    FACEBOOK_ACCESS_TOKEN: Optional[str] = None
    FACEBOOK_PAGE_ID: Optional[str] = None
    FACEBOOK_VERIFY_TOKEN: Optional[str] = None   # chosen by you when registering webhook
    FACEBOOK_APP_SECRET: Optional[str] = None     # from Meta app dashboard
    VIBER_BOT_TOKEN: Optional[str] = None
    LINKEDIN_ACCESS_TOKEN: Optional[str] = None
    LINKEDIN_ORGANIZATION_ID: Optional[str] = None
    
    # Server
    DEBUG: bool = True
    SECRET_KEY: str = "your-secret-key-change-in-production"
    ALGORITHM: str = "HS256"
    
    # CORS
    FRONTEND_URL: str = "http://localhost:3000"

    # Calendar Integration
    GOOGLE_CLIENT_ID: Optional[str] = None
    GOOGLE_CLIENT_SECRET: Optional[str] = None
    MICROSOFT_CLIENT_ID: Optional[str] = None
    MICROSOFT_CLIENT_SECRET: Optional[str] = None
    MICROSOFT_TENANT_ID: Optional[str] = "common"
    BACKEND_URL: str = "http://localhost:8000"

    # Support desk service API (/api/support/v1/admin): the subscription servers'
    # keys, "label:key" pairs separated by commas, e.g. "subscription:...,nrp:...".
    # Each label is named in the audit log; drop one pair to withdraw that server.
    SUPPORT_SERVICE_KEYS: Optional[str] = None
    # The address sites load chat-widget.js and the support API from. Unset:
    # FRONTEND_URL (nginx serves both from one host).
    SUPPORT_PUBLIC_URL: Optional[str] = None

    # Mobile push notifications (FCM, covering Android and iOS-via-APNs).
    # Give the Firebase service-account JSON either inline or as a file path;
    # with neither set, background push is a silent no-op and the app falls
    # back to local notifications raised from the WebSocket stream.
    # Must also be named in docker-compose.yml's backend environment: block.
    FCM_SERVICE_ACCOUNT_JSON: Optional[str] = None
    FCM_SERVICE_ACCOUNT_FILE: Optional[str] = None

    class Config:
        env_file = ".env"

settings = Settings()
