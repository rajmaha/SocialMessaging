"""
The support desk's service API, for the subscription servers
(subscription.saraloms.com, nrp.saraloms.com) that set client sites up.

    X-Support-Service-Key: <key>     one of SUPPORT_SERVICE_KEYS ("label:key,...") in .env

POST /api/support/v1/admin/domains
    {"domain": "client.saraloms.com", "display_name": "Client Ltd",
     "organization_name": "Client Ltd", "agent_emails": ["ram@..."],
     "categories": ["Bug", ...], "webhook_url": "https://.../support-hook",
     "rotate": false}
  Finds the widget domain by its domain or makes it (support on, anonymous
  visitors off: an OMS site signs its users), turns support on, links the agents
  found by email (named back when not found; nobody is unlinked), finds or makes
  the organization, and makes an identity secret when the domain has none or
  `rotate` is true. Answers {widget_key, server_url, created, secret?, ...} --
  the secret only when it was just made. A repeat with the same domain changes
  nothing that was not asked for.

GET /api/support/v1/admin/domains?domain=client.saraloms.com
  Whether the domain is set up, without the secret.

Every call is in the audit log under the key's label. Ten wrong keys an hour
from one address stop further tries from it.
"""

import hmac
import re
import secrets
import uuid
from datetime import datetime
from typing import List, Optional, Tuple

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.config import settings
from app.database import get_db
from app.models.domain_agent import DomainAgent
from app.models.organization import Organization
from app.models.user import User
from app.models.widget_domain import WidgetDomain
from app.services import rate_limit, secret_box
from app.services.log_service import log_audit
from app.services.support_webhooks import address_problem

router = APIRouter(prefix="/api/support/v1/admin", tags=["support-admin"])

MIN_KEY_LENGTH = 24
WRONG_KEYS_PER_IP = 10      # an hour
_HOST_RE = re.compile(r"^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(:\d{1,5})?$")


def service_keys() -> List[Tuple[str, str]]:
    """(label, key) pairs from SUPPORT_SERVICE_KEYS; keys shorter than 24 characters are ignored."""
    out = []
    for part in (settings.SUPPORT_SERVICE_KEYS or "").split(","):
        part = part.strip()
        if not part:
            continue
        label, _, key = part.partition(":") if ":" in part else ("service", "", part)
        label, key = label.strip() or "service", key.strip()
        if len(key) >= MIN_KEY_LENGTH:
            out.append((label[:40], key))
    return out


def _caller(request: Request, db: Session) -> str:
    """The label of the subscription server calling, or a 401."""
    ip = rate_limit.client_ip(request)
    if rate_limit.count(db, "service_key_wrong", ip, 60) >= WRONG_KEYS_PER_IP:
        raise HTTPException(status_code=429, detail="Too many wrong keys. Try again in an hour.")
    given = (request.headers.get("x-support-service-key") or "").strip()
    label = None
    for lbl, key in service_keys():
        # compare against every key, so the time taken says nothing about which matched
        if given and hmac.compare_digest(given.encode(), key.encode()):
            label = lbl
    if label is None:
        rate_limit.hit(db, "service_key_wrong", ip)
        raise HTTPException(status_code=401, detail="Wrong or missing service key.")
    return label


def normalise_domain(value: str) -> Optional[str]:
    """client.saraloms.com from 'https://Client.saraloms.com/path', or None when it is not a host."""
    text = (value or "").strip().lower()
    text = re.sub(r"^[a-z][a-z0-9+.-]*://", "", text)
    text = text.split("/")[0].split("?")[0].split("#")[0].rstrip(".")
    if text.startswith("www."):
        text = text[4:]
    return text if _HOST_RE.match(text) else None


def public_url() -> str:
    return (settings.SUPPORT_PUBLIC_URL or settings.FRONTEND_URL or "").rstrip("/")


class DomainSetup(BaseModel):
    domain: str
    display_name: Optional[str] = None
    organization_name: Optional[str] = None
    agent_emails: List[str] = []
    categories: Optional[List[str]] = None
    webhook_url: Optional[str] = None
    rotate: bool = False


def _organization(db: Session, name: Optional[str], domain: str) -> Optional[Organization]:
    name = (name or "").strip()[:200]
    org = (db.query(Organization).filter(func.lower(Organization.domain_name) == domain).first()
           or (db.query(Organization).filter(func.lower(Organization.organization_name) == name.lower()).first()
               if name else None))
    if org is None and name:
        org = Organization(organization_name=name, domain_name=domain, is_active=1)
        db.add(org)
        db.flush()
    return org


@router.post("/domains")
def set_up_domain(body: DomainSetup, request: Request, db: Session = Depends(get_db)):
    label = _caller(request, db)
    domain = normalise_domain(body.domain)
    if not domain:
        raise HTTPException(status_code=422, detail="That is not a domain name.")
    webhook = (body.webhook_url or "").strip() or None
    if webhook:
        problem = address_problem(webhook)
        if problem:
            raise HTTPException(status_code=422, detail=problem[0].upper() + problem[1:] + ".")

    wd = db.query(WidgetDomain).filter(WidgetDomain.domain == domain).first()
    created = wd is None
    if created:
        wd = WidgetDomain(domain=domain, widget_key=str(uuid.uuid4()),
                          display_name=(body.display_name or domain).strip()[:200], is_active=1,
                          support_enabled=1, chat_enabled=1, allow_anonymous=0)
        db.add(wd)
        db.flush()
    else:
        wd.support_enabled = 1
        if body.display_name and body.display_name.strip():
            wd.display_name = body.display_name.strip()[:200]

    if body.categories is not None:
        cats, seen = [], set()
        for c in body.categories:
            c = (c or "").strip()[:60]
            if c and c.lower() not in seen:
                seen.add(c.lower())
                cats.append(c)
        wd.support_categories = cats[:20] or None
    if webhook:
        wd.webhook_url = webhook

    org = _organization(db, body.organization_name or body.display_name, domain)
    if org is not None and not wd.organization_id:
        wd.organization_id = org.id

    linked, not_found = [], []
    have = {r.user_id for r in db.query(DomainAgent).filter(DomainAgent.widget_domain_id == wd.id)}
    for email in dict.fromkeys(e.strip().lower() for e in body.agent_emails if e and e.strip()):
        user = db.query(User).filter(func.lower(User.email) == email, User.is_active.is_(True)).first()
        if user is None:
            not_found.append(email)
            continue
        if user.id not in have:
            db.add(DomainAgent(widget_domain_id=wd.id, user_id=user.id))
            have.add(user.id)
        linked.append(email)

    secret = None
    if body.rotate or not wd.identity_secret:
        secret = secrets.token_urlsafe(32)
        try:
            wd.identity_secret = secret_box.seal(secret)
        except RuntimeError as err:
            db.rollback()
            raise HTTPException(status_code=500, detail=str(err))
    wd.updated_at = datetime.utcnow()
    db.commit()

    log_audit(db, "support.domain_setup", user_email=f"service:{label}", user_role="service",
              entity_type="widget_domain", entity_id=wd.id,
              detail={"domain": domain, "created": created, "secret_made": secret is not None,
                      "agents_linked": linked, "agents_not_found": not_found},
              ip_address=rate_limit.client_ip(request), request_path=str(request.url.path),
              request_method="POST")

    answer = {
        "domain": domain,
        "widget_key": wd.widget_key,
        "server_url": public_url(),
        "created": created,
        "support_enabled": True,
        "organization_id": wd.organization_id,
        "agents_linked": linked,
        "agents_not_found": not_found,
    }
    if secret:
        answer["secret"] = secret
    return answer


@router.get("/domains")
def get_domain(request: Request, domain: str = Query(...), db: Session = Depends(get_db)):
    _caller(request, db)
    host = normalise_domain(domain)
    wd = db.query(WidgetDomain).filter(WidgetDomain.domain == host).first() if host else None
    if wd is None:
        raise HTTPException(status_code=404, detail="That domain is not set up.")
    agents = (db.query(User.email).join(DomainAgent, DomainAgent.user_id == User.id)
              .filter(DomainAgent.widget_domain_id == wd.id).all())
    return {
        "domain": wd.domain,
        "widget_key": wd.widget_key,
        "server_url": public_url(),
        "is_active": bool(wd.is_active),
        "support_enabled": bool(wd.support_enabled),
        "has_identity_secret": bool(wd.identity_secret),
        "webhook_url": wd.webhook_url,
        "agents": [a[0] for a in agents],
    }
