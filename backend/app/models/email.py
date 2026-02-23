from sqlalchemy import Column, Integer, String, Text, DateTime, Boolean, ForeignKey, LargeBinary, JSON
from sqlalchemy.orm import relationship
from datetime import datetime
from app.database import Base


class UserEmailAccount(Base):
    """Store email account credentials for each user - SET UP BY ADMIN"""
    __tablename__ = "user_email_accounts"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, unique=True)  # One account per user
    
    # Email account info
    email_address = Column(String, unique=True, index=True, nullable=False)
    account_name = Column(String, nullable=False)  # "Personal", "Work", etc.
    
    # IMAP Settings (encrypted in production)
    imap_host = Column(String, nullable=False)
    imap_port = Column(Integer, nullable=False)
    imap_username = Column(String, nullable=False)
    imap_password = Column(String, nullable=False)  # TODO: Encrypt this
    
    # SMTP Settings (encrypted in production)
    smtp_host = Column(String, nullable=False)
    smtp_port = Column(Integer, nullable=False)
    smtp_username = Column(String, nullable=False)
    smtp_password = Column(String, nullable=False)  # TODO: Encrypt this
    smtp_security = Column(String, default='STARTTLS', nullable=False)  # SSL, TLS, STARTTLS, or NONE
    
    # Display name for sender
    display_name = Column(String, nullable=True)
    
    # Account status
    is_active = Column(Boolean, default=True)
    last_sync = Column(DateTime, nullable=True)
    
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    # Relationships
    user = relationship("User", back_populates="email_account", uselist=False)
    emails = relationship("Email", back_populates="account", cascade="all, delete-orphan")
    
    def __repr__(self):
        return f"<UserEmailAccount({self.email_address})>"


class Email(Base):
    """Store email messages"""
    __tablename__ = "emails"

    id = Column(Integer, primary_key=True, index=True)
    account_id = Column(Integer, ForeignKey("user_email_accounts.id"), nullable=False)
    thread_id = Column(Integer, ForeignKey("email_threads.id"), nullable=True)  # Thread this email belongs to
    
    # Email headers
    message_id = Column(String, unique=True, index=True, nullable=False)
    subject = Column(String, nullable=True)
    from_address = Column(String, nullable=False)
    to_address = Column(Text, nullable=False)  # Can be multiple, comma-separated
    cc = Column(Text, nullable=True)
    bcc = Column(Text, nullable=True)
    
    # Email body
    body_text = Column(Text, nullable=True)
    body_html = Column(Text, nullable=True)
    
    # Email status
    is_read = Column(Boolean, default=False)
    is_starred = Column(Boolean, default=False)
    is_archived = Column(Boolean, default=False)
    is_spam = Column(Boolean, default=False)
    is_draft = Column(Boolean, default=False)
    is_sent = Column(Boolean, default=False)
    
    # Labels/Tags (stores list of label IDs)
    labels = Column(JSON, default=list, nullable=False)
    
    # Sorting
    received_at = Column(DateTime, nullable=False)
    
    # Threading
    in_reply_to = Column(String, nullable=True)  # Message-ID this replies to
    references = Column(Text, nullable=True)  # References header
    
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    # Relationships
    account = relationship("UserEmailAccount", back_populates="emails")
    attachments = relationship("EmailAttachment", back_populates="email", cascade="all, delete-orphan")
    thread = relationship("EmailThread", back_populates="emails")
    
    def __repr__(self):
        return f"<Email({self.subject})>"


class EmailAttachment(Base):
    """Store email attachments"""
    __tablename__ = "email_attachments"

    id = Column(Integer, primary_key=True, index=True)
    email_id = Column(Integer, ForeignKey("emails.id"), nullable=False)
    
    filename = Column(String, nullable=False)
    content_type = Column(String, nullable=True)
    size = Column(Integer, nullable=True)
    
    # Store file path or URL
    file_path = Column(String, nullable=True)
    
    created_at = Column(DateTime, default=datetime.utcnow)
    
    # Relationships
    email = relationship("Email", back_populates="attachments")
    
    def __repr__(self):
        return f"<EmailAttachment({self.filename})>"


class EmailSignature(Base):
    """User's email signature"""
    __tablename__ = "email_signatures"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, unique=True)
    
    signature_text = Column(Text, nullable=False, default="")
    is_html = Column(Boolean, default=False)  # True if HTML signature
    is_enabled = Column(Boolean, default=True)
    
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    # Relationships
    user = relationship("User", back_populates="email_signature", uselist=False)
    
    def __repr__(self):
        return f"<EmailSignature(user_id={self.user_id})>"


class Contact(Base):
    """User's contact list"""
    __tablename__ = "contacts"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    
    name = Column(String, nullable=False)
    email = Column(String, nullable=False, index=True)
    phone = Column(String, nullable=True)
    notes = Column(Text, nullable=True)
    
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    # Relationships
    user = relationship("User", back_populates="contacts")
    
    def __repr__(self):
        return f"<Contact({self.name} - {self.email})>"


class EmailTemplate(Base):
    """Email templates for quick replies"""
    __tablename__ = "email_templates"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    
    name = Column(String, nullable=False)
    subject = Column(String, nullable=True)
    body = Column(Text, nullable=False)
    
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    # Relationships
    user = relationship("User", back_populates="email_templates")
    
    def __repr__(self):
        return f"<EmailTemplate({self.name})>"


class EmailThread(Base):
    """Group related emails in a conversation"""
    __tablename__ = "email_threads"

    id = Column(Integer, primary_key=True, index=True)
    account_id = Column(Integer, ForeignKey("user_email_accounts.id"), nullable=False)
    
    # Thread metadata
    subject = Column(String, nullable=True)
    thread_key = Column(String, index=True, nullable=True)  # Gmail-style conversation ID
    
    # Participants
    from_address = Column(String, nullable=False)
    to_addresses = Column(Text, nullable=False)  # Comma-separated
    cc_addresses = Column(Text, nullable=True)  # Comma-separated
    
    # Status flags
    has_unread = Column(Boolean, default=False)
    is_archived = Column(Boolean, default=False)
    is_starred = Column(Boolean, default=False)
    
    # Timestamps
    first_email_at = Column(DateTime, nullable=False)
    last_email_at = Column(DateTime, nullable=False)
    reply_count = Column(Integer, default=0)
    
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    # Relationships
    account = relationship("UserEmailAccount")
    emails = relationship("Email", back_populates="thread")
    
    def __repr__(self):
        return f"<EmailThread(subject={self.subject})>"
