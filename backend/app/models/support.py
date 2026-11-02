"""
Support desk tables. Design: OMS repo, docs/plans/2026-11-02-support-desk-design.md.

A support request is an ordinary Ticket (source support_widget / support_app)
whose customer is a SupportUser of one widget domain. SupportMessage is the
thread the customer sees -- ticket "notes" (FLW- child tickets) stay internal.
SupportWebhook is the outbox that tells the customer's site; SupportAttempt
counts requests for rate limits.

Columns added to widget_domains and tickets live in app/support_schema.py.
"""

from datetime import datetime

from sqlalchemy import Column, DateTime, ForeignKey, Index, Integer, JSON, String, Text, text
from app.database import Base


class SupportUser(Base):
    """A person raising requests on one widget domain: signed (uid) or anonymous (verified email)."""
    __tablename__ = "support_users"
    __table_args__ = (
        Index("uq_support_users_uid", "widget_domain_id", "uid", unique=True,
              postgresql_where=text("uid IS NOT NULL")),
        Index("uq_support_users_email", "widget_domain_id", "email", unique=True,
              postgresql_where=text("uid IS NULL")),
    )

    id = Column(Integer, primary_key=True, index=True)
    widget_domain_id = Column(Integer, ForeignKey("widget_domains.id", ondelete="CASCADE"), nullable=False, index=True)
    uid = Column(String(200), nullable=True)      # from the site's signed identity
    email = Column(String(255), nullable=True)    # lower case; the person, when anonymous
    name = Column(String(200), nullable=True)
    phone = Column(String(30), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    last_seen_at = Column(DateTime, default=datetime.utcnow)


class SupportMessage(Base):
    """One message of the customer-visible thread of a support ticket."""
    __tablename__ = "support_messages"
    __table_args__ = (
        Index("ix_support_messages_ticket_created", "ticket_id", "created_at"),
    )

    id = Column(Integer, primary_key=True, index=True)
    ticket_id = Column(Integer, ForeignKey("tickets.id", ondelete="CASCADE"), nullable=False)
    author_type = Column(String(10), nullable=False)          # customer | agent | system
    author_user_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)  # the agent
    author_name = Column(String(200), nullable=True)
    body = Column(Text, nullable=False, default="")
    attachments = Column(JSON, nullable=True)                  # [{name, path, size, type}]
    request_id = Column(String(64), nullable=True, unique=True)  # a double press is one message
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)


class SupportWebhook(Base):
    """A signed POST to a site's webhook, retried until it is taken or gives up."""
    __tablename__ = "support_webhooks"
    __table_args__ = (
        Index("ix_support_webhooks_due", "status", "next_try_at"),
    )

    id = Column(Integer, primary_key=True, index=True)
    widget_domain_id = Column(Integer, ForeignKey("widget_domains.id", ondelete="CASCADE"), nullable=False, index=True)
    ticket_id = Column(Integer, ForeignKey("tickets.id", ondelete="CASCADE"), nullable=True, index=True)
    event_id = Column(String(64), nullable=False, unique=True)
    event = Column(String(40), nullable=False)                # request_created | reply | status
    payload = Column(JSON, nullable=False)
    status = Column(String(10), nullable=False, default="pending")  # pending | sending | sent | failed
    tries = Column(Integer, nullable=False, default=0)
    next_try_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    last_error = Column(String(500), nullable=True)
    sent_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)


class SupportAttempt(Base):
    """One counted action (a request, a reply) for rate limits."""
    __tablename__ = "support_attempts"
    __table_args__ = (
        Index("ix_support_attempts_lookup", "kind", "key", "created_at"),
    )

    id = Column(Integer, primary_key=True)
    kind = Column(String(20), nullable=False)    # request_user | request_ip | reply_user
    key = Column(String(255), nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
