from pydantic import BaseModel
from datetime import datetime
from typing import Optional, List


class EmailAccountCreate(BaseModel):
    """Schema for creating email account"""
    email_address: str
    account_name: str
    display_name: Optional[str] = None
    
    # IMAP Settings
    imap_host: str
    imap_port: int
    imap_username: str
    imap_password: str
    
    # SMTP Settings
    smtp_host: str
    smtp_port: int
    smtp_username: str
    smtp_password: str
    smtp_security: str = 'STARTTLS'  # SSL, TLS, STARTTLS, or NONE


class EmailAccountUpdate(BaseModel):
    """Schema for updating email account"""
    email_address: Optional[str] = None
    account_name: Optional[str] = None
    display_name: Optional[str] = None
    is_active: Optional[bool] = None
    
    # IMAP Settings (optional for updates)
    imap_host: Optional[str] = None
    imap_port: Optional[int] = None
    imap_username: Optional[str] = None
    imap_password: Optional[str] = None
    
    # SMTP Settings (optional for updates)
    smtp_host: Optional[str] = None
    smtp_port: Optional[int] = None
    smtp_username: Optional[str] = None
    smtp_password: Optional[str] = None
    smtp_security: Optional[str] = None  # SSL, TLS, STARTTLS, or NONE


class EmailAccountResponse(BaseModel):
    """Schema for email account response"""
    id: int
    email_address: str
    account_name: str
    display_name: Optional[str]
    is_active: bool
    last_sync: Optional[datetime]
    created_at: datetime
    
    class Config:
        from_attributes = True


class EmailAccountFullResponse(BaseModel):
    """Schema for email account response with credentials"""
    id: int
    user_id: int
    email_address: str
    account_name: str
    display_name: Optional[str]
    is_active: bool
    last_sync: Optional[datetime]
    
    # IMAP Settings
    imap_host: str
    imap_port: int
    imap_username: str
    imap_password: str
    
    # SMTP Settings
    smtp_host: str
    smtp_port: int
    smtp_username: str
    smtp_password: str
    smtp_security: str
    
    created_at: datetime
    
    class Config:
        from_attributes = True


class TestEmailCredentialsRequest(BaseModel):
    """Schema for testing email credentials"""
    # IMAP Settings
    imap_host: str
    imap_port: int
    imap_username: str
    imap_password: str
    
    # SMTP Settings
    smtp_host: str
    smtp_port: int
    smtp_username: str
    smtp_password: str
    smtp_security: str = 'STARTTLS'  # SSL, TLS, STARTTLS, or NONE


class TestEmailCredentialsResponse(BaseModel):
    """Schema for testing email credentials response"""
    status: str
    imap_ok: bool
    smtp_ok: bool
    imap_message: str
    smtp_message: str


class EmailAttachmentResponse(BaseModel):
    """Schema for email attachment"""
    id: int
    filename: str
    content_type: Optional[str]
    size: Optional[int]


class EmailResponse(BaseModel):
    """Schema for email response"""
    id: int
    thread_id: Optional[int]
    subject: str
    from_address: str
    to_address: str
    cc: Optional[str]
    bcc: Optional[str]
    body_text: Optional[str]
    body_html: Optional[str]
    is_read: bool
    is_starred: bool
    is_archived: bool
    is_spam: bool
    is_draft: bool
    is_sent: bool
    labels: List[str] = []
    received_at: datetime
    in_reply_to: Optional[str]
    attachments: List[EmailAttachmentResponse] = []
    
    class Config:
        from_attributes = True


class SendEmailRequest(BaseModel):
    """Schema for sending email"""
    to_address: str
    subject: str
    body: str
    cc: Optional[str] = None
    bcc: Optional[str] = None


class SendEmailReplyRequest(BaseModel):
    """Schema for sending email reply"""
    body: str
    cc: Optional[str] = None
    bcc: Optional[str] = None


class EmailListResponse(BaseModel):
    """Schema for email list response"""
    total: int
    emails: List[EmailResponse]


class SyncEmailsResponse(BaseModel):
    """Schema for email sync response"""
    status: str
    synced_count: int
    message: str


# ========== EMAIL SIGNATURE SCHEMAS ==========


class EmailSignatureCreate(BaseModel):
    """Schema for creating email signature"""
    signature_text: str
    is_html: bool = False
    is_enabled: bool = True


class EmailSignatureUpdate(BaseModel):
    """Schema for updating email signature"""
    signature_text: Optional[str] = None
    is_html: Optional[bool] = None
    is_enabled: Optional[bool] = None


class EmailSignatureResponse(BaseModel):
    """Schema for email signature response"""
    id: int
    user_id: int
    signature_text: str
    is_html: bool
    is_enabled: bool
    created_at: datetime
    updated_at: datetime
    
    class Config:
        from_attributes = True


# ========== CONTACT SCHEMAS ==========


class ContactCreate(BaseModel):
    """Schema for creating contact"""
    name: str
    email: str
    phone: Optional[str] = None
    notes: Optional[str] = None


class ContactUpdate(BaseModel):
    """Schema for updating contact"""
    name: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    notes: Optional[str] = None


class ContactResponse(BaseModel):
    """Schema for contact response"""
    id: int
    user_id: int
    name: str
    email: str
    phone: Optional[str]
    notes: Optional[str]
    created_at: datetime
    updated_at: datetime
    
    class Config:
        from_attributes = True


class ContactListResponse(BaseModel):
    """Schema for contact list response"""
    total: int
    contacts: List[ContactResponse]


# ========== EMAIL THREAD SCHEMAS ==========


class EmailThreadResponse(BaseModel):
    """Schema for email thread response with conversation"""
    id: int
    subject: str
    from_address: str
    to_addresses: str
    has_unread: bool
    is_archived: bool
    is_starred: bool
    reply_count: int
    first_email_at: datetime
    last_email_at: datetime
    emails: List[EmailResponse] = []
    
    class Config:
        from_attributes = True


class EmailThreadListResponse(BaseModel):
    """Schema for email thread list response"""
    total: int
    threads: List[EmailThreadResponse]
