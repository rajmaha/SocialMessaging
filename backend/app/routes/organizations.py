import json
import tempfile
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form, status
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from typing import List, Optional
import os
import uuid
import re

from app.database import get_db
from app.models.organization import Organization, OrganizationContact, Subscription, SubscriptionModule, SubscriptionSettings
from app.models.cloudpanel_server import CloudPanelServer
from app.models.cloudpanel_site import CloudPanelSite
from app.schemas.organization import (
    OrganizationCreate, OrganizationUpdate, OrganizationResponse,
    ContactCreate, ContactUpdate, ContactResponse,
    SubscriptionCreate, SubscriptionUpdate, SubscriptionResponse,
    SubscriptionModuleCreate, SubscriptionModuleUpdate, SubscriptionModuleResponse,
    SubscriptionSettingsUpdate, SubscriptionSettingsResponse,
)
from app.schemas.cloudpanel import CloudPanelSiteCreate
from app.services.cloudpanel_service import CloudPanelService
from app.dependencies import get_current_user, require_module, require_admin_feature
from app.models.user import User
from app.models.form import Form as FormModel, FormField
from app.models.api_server import ApiServer, UserApiCredential
from app.services.api_proxy import api_request, api_login

router = APIRouter(prefix="/organizations", tags=["organizations"])

require_orgs = require_module("module_organizations")
require_contacts = require_module("module_contacts")
require_subs = require_module("module_subscriptions")

# Subscription Module CRUD
@router.post("/subscription-modules", response_model=SubscriptionModuleResponse)
def create_subscription_module(
    module: SubscriptionModuleCreate,
    db: Session = Depends(get_db),
    admin_user: User = Depends(require_subs)
):
    db_module = SubscriptionModule(**module.model_dump())
    db.add(db_module)
    db.commit()
    db.refresh(db_module)
    return db_module

@router.get("/subscription-modules", response_model=List[SubscriptionModuleResponse])
def list_subscription_modules(
    db: Session = Depends(get_db),
    admin_user: User = Depends(require_subs)
):
    return db.query(SubscriptionModule).all()

@router.get("/subscription-modules/{module_id}", response_model=SubscriptionModuleResponse)
def get_subscription_module(
    module_id: int,
    db: Session = Depends(get_db),
    admin_user: User = Depends(require_subs)
):
    db_module = db.query(SubscriptionModule).filter(SubscriptionModule.id == module_id).first()
    if not db_module:
        raise HTTPException(status_code=404, detail="Subscription module not found")
    return db_module

@router.put("/subscription-modules/{module_id}", response_model=SubscriptionModuleResponse)
def update_subscription_module(
    module_id: int,
    module_update: SubscriptionModuleUpdate,
    db: Session = Depends(get_db),
    admin_user: User = Depends(require_subs)
):
    db_module = db.query(SubscriptionModule).filter(SubscriptionModule.id == module_id).first()
    if not db_module:
        raise HTTPException(status_code=404, detail="Subscription module not found")
    
    update_data = module_update.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(db_module, key, value)
    
    db.commit()
    db.refresh(db_module)
    return db_module

@router.delete("/subscription-modules/{module_id}")
def delete_subscription_module(
    module_id: int,
    db: Session = Depends(get_db),
    admin_user: User = Depends(require_subs)
):
    db_module = db.query(SubscriptionModule).filter(SubscriptionModule.id == module_id).first()
    if not db_module:
        raise HTTPException(status_code=404, detail="Subscription module not found")
    
    db.delete(db_module)
    db.commit()
    return {"status": "success", "message": "Subscription module deleted"}


# Subscription Settings (single-row config)
@router.get("/subscription-settings", response_model=SubscriptionSettingsResponse)
def get_subscription_settings(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_subs),
):
    settings = db.query(SubscriptionSettings).first()
    if not settings:
        settings = SubscriptionSettings(id=1)
        db.add(settings)
        db.commit()
        db.refresh(settings)
    return settings


@router.put("/subscription-settings", response_model=SubscriptionSettingsResponse)
def update_subscription_settings(
    data: SubscriptionSettingsUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_subs),
):
    settings = db.query(SubscriptionSettings).first()
    if not settings:
        settings = SubscriptionSettings(id=1)
        db.add(settings)
        db.commit()
    update_data = data.model_dump(exclude_unset=True)
    for key, val in update_data.items():
        setattr(settings, key, val)
    db.commit()
    db.refresh(settings)
    return settings


# Organization CRUD
@router.post("/", response_model=OrganizationResponse)
def create_organization(
    org: OrganizationCreate,
    db: Session = Depends(get_db),
    admin_user: User = Depends(require_orgs)
):
    db_org = Organization(**org.model_dump())
    db.add(db_org)
    db.commit()
    db.refresh(db_org)
    return db_org

@router.get("/", response_model=List[OrganizationResponse])
def list_organizations(
    skip: int = 0,
    limit: int = 100,
    search: Optional[str] = None,
    db: Session = Depends(get_db),
    admin_user: User = Depends(require_orgs)
):
    query = db.query(Organization)
    if search:
        query = query.filter(Organization.organization_name.ilike(f"%{search}%"))
    return query.offset(skip).limit(limit).all()

@router.get("/{org_id}", response_model=OrganizationResponse)
def get_organization(
    org_id: int,
    db: Session = Depends(get_db),
    admin_user: User = Depends(require_orgs)
):
    org = db.query(Organization).filter(Organization.id == org_id).first()
    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")
    return org

@router.put("/{org_id}", response_model=OrganizationResponse)
def update_organization(
    org_id: int,
    org_update: OrganizationUpdate,
    db: Session = Depends(get_db),
    admin_user: User = Depends(require_orgs)
):
    db_org = db.query(Organization).filter(Organization.id == org_id).first()
    if not db_org:
        raise HTTPException(status_code=404, detail="Organization not found")
    
    update_data = org_update.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(db_org, key, value)
    
    db.commit()
    db.refresh(db_org)
    return db_org

@router.delete("/{org_id}")
def delete_organization(
    org_id: int,
    db: Session = Depends(get_db),
    admin_user: User = Depends(require_orgs)
):
    db_org = db.query(Organization).filter(Organization.id == org_id).first()
    if not db_org:
        raise HTTPException(status_code=404, detail="Organization not found")
    
    db.delete(db_org)
    db.commit()
    return {"status": "success", "message": "Organization deleted"}


# Organization Logo Upload
@router.post("/{org_id}/logo")
async def upload_org_logo(
    org_id: int,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    admin_user: User = Depends(require_orgs)
):
    db_org = db.query(Organization).filter(Organization.id == org_id).first()
    if not db_org:
        raise HTTPException(status_code=404, detail="Organization not found")

    # Save file
    safe_name = re.sub(r"[^\w\-. ]", "_", file.filename or "logo")
    unique_name = f"{uuid.uuid4().hex}_{safe_name}"
    
    upload_dir = os.path.join(os.path.dirname(__file__), "..", "..", "logo_storage")
    os.makedirs(upload_dir, exist_ok=True)
    
    file_path = os.path.join(upload_dir, unique_name)
    content = await file.read()
    with open(file_path, "wb") as f:
        f.write(content)
    
    db_org.logo_url = f"/logos/{unique_name}"
    db.commit()
    
    return {"url": db_org.logo_url}

# Contact CRUD
@router.post("/{org_id}/contacts", response_model=ContactResponse)
def create_organization_contact(
    org_id: int,
    contact: ContactCreate,
    db: Session = Depends(get_db),
    admin_user: User = Depends(require_contacts)
):
    if contact.organization_id != org_id:
        raise HTTPException(status_code=400, detail="Invalid organization ID in contact data")
    
    db_contact = OrganizationContact(**contact.model_dump())
    db.add(db_contact)
    db.commit()
    db.refresh(db_contact)
    return db_contact

@router.get("/{org_id}/contacts", response_model=List[ContactResponse])
def list_organization_contacts(
    org_id: int,
    db: Session = Depends(get_db),
    admin_user: User = Depends(require_contacts)
):
    return db.query(OrganizationContact).filter(OrganizationContact.organization_id == org_id).all()

@router.put("/contacts/{contact_id}", response_model=ContactResponse)
def update_contact(
    contact_id: int,
    contact_update: ContactUpdate,
    db: Session = Depends(get_db),
    admin_user: User = Depends(require_contacts)
):
    db_contact = db.query(OrganizationContact).filter(OrganizationContact.id == contact_id).first()
    if not db_contact:
        raise HTTPException(status_code=404, detail="Contact not found")
    
    update_data = contact_update.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(db_contact, key, value)
    
    db.commit()
    db.refresh(db_contact)
    return db_contact

@router.delete("/contacts/{contact_id}")
def delete_contact(
    contact_id: int,
    db: Session = Depends(get_db),
    admin_user: User = Depends(require_contacts)
):
    db_contact = db.query(OrganizationContact).filter(OrganizationContact.id == contact_id).first()
    if not db_contact:
        raise HTTPException(status_code=404, detail="Contact not found")
    
    db.delete(db_contact)
    db.commit()
    return {"status": "success", "message": "Contact deleted"}

# Subscription CRUD
@router.post("/{org_id}/subscriptions", response_model=SubscriptionResponse)
def create_subscription(
    org_id: int,
    sub: SubscriptionCreate,
    db: Session = Depends(get_db),
    admin_user: User = Depends(require_subs)
):
    if sub.organization_id != org_id:
        raise HTTPException(status_code=400, detail="Invalid organization ID in subscription data")
    
    db_sub = Subscription(**sub.model_dump())
    db.add(db_sub)
    db.commit()
    db.refresh(db_sub)
    return db_sub


def _build_form_payload(field_map: list, subscription: Subscription, organization: Organization) -> dict:
    """Build form submission data from field mapping config."""
    sources = {}
    for col in subscription.__table__.columns:
        val = getattr(subscription, col.name)
        if hasattr(val, 'isoformat'):
            val = val.isoformat()
        sources[f"subscription.{col.name}"] = val
    for col in organization.__table__.columns:
        val = getattr(organization, col.name)
        if hasattr(val, 'isoformat'):
            val = val.isoformat()
        sources[f"organization.{col.name}"] = val

    payload = {}
    for mapping in field_map:
        form_key = mapping.get("form_key")
        source_key = mapping.get("source_key")
        if form_key and source_key:
            payload[form_key] = sources.get(source_key)
    return payload


@router.post("/{org_id}/subscriptions/deploy-and-create")
async def deploy_and_create_subscription(
    org_id: int,
    server_id: int = Form(...),
    subscribed_product: str = Form(""),
    modules: str = Form("[]"),  # JSON array string
    system_url: str = Form(""),
    template_name: str = Form("default_site"),
    php_version: str = Form("8.2"),
    vhost_template: str = Form("Generic"),
    db_name: str = Form(""),
    db_user: str = Form(""),
    db_password: str = Form(""),
    ssl_mode: str = Form("auto"),
    is_wildcard: str = Form("false"),
    custom_ssl_cert: str = Form(""),
    custom_ssl_key: str = Form(""),
    custom_ssl_chain: str = Form(""),
    subscribed_on_date: str = Form(""),
    billed_from_date: str = Form(""),
    expire_date: str = Form(""),
    company_logo: Optional[UploadFile] = File(None),
    db: Session = Depends(get_db),
    admin_user: User = Depends(require_subs)
):
    """Deploy a site via CloudPanel and create the subscription only on success.
    Returns an SSE stream with deployment progress."""
    # Validate organization exists
    org = db.query(Organization).filter(Organization.id == org_id).first()
    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")

    # Validate server exists
    server = db.query(CloudPanelServer).filter(CloudPanelServer.id == server_id).first()
    if not server:
        raise HTTPException(status_code=404, detail="Server not found")

    # Strip protocol from system_url to get domain name
    domain = system_url.strip()
    domain = re.sub(r'^https?://', '', domain)
    domain = domain.rstrip('/')
    if not domain:
        raise HTTPException(status_code=400, detail="System URL is required to deploy a site")

    # Parse modules JSON
    try:
        modules_list = json.loads(modules)
    except (json.JSONDecodeError, TypeError):
        modules_list = []

    # Save logo to temp file if provided
    logo_temp_path = None
    logo_ext = ""
    logo_content = None
    if company_logo and company_logo.filename:
        logo_content = await company_logo.read()
        if len(logo_content) > 200 * 1024:
            raise HTTPException(status_code=400, detail="Logo file too large. Maximum size is 200KB")
        logo_ext = os.path.splitext(company_logo.filename)[1] or ".png"
        tmp = tempfile.NamedTemporaryFile(delete=False, suffix=logo_ext)
        tmp.write(logo_content)
        tmp.close()
        logo_temp_path = tmp.name

    # Build CloudPanel site create data
    site_data = CloudPanelSiteCreate(
        domainName=domain,
        phpVersion=php_version,
        vhostTemplate=vhost_template,
        templateName=template_name,
        dbName=db_name or None,
        dbUser=db_user or None,
        dbPassword=db_password or None,
        issue_ssl=ssl_mode == "auto",
        is_wildcard_ssl=ssl_mode == "auto" and is_wildcard.lower() == "true",
        custom_ssl_cert=custom_ssl_cert or None if ssl_mode == "custom" else None,
        custom_ssl_key=custom_ssl_key or None if ssl_mode == "custom" else None,
        custom_ssl_chain=custom_ssl_chain or None if ssl_mode == "custom" else None,
        company_logo_local_path=logo_temp_path,
    )

    def event_generator():
        try:
            with CloudPanelService(server) as service:
                result = None
                for step_event in service.create_site_steps(site_data):
                    yield f"data: {json.dumps(step_event)}\n\n"
                    if step_event.get("step") == "complete":
                        result = step_event

            if result and result.get("status") == "success":
                # Save CloudPanel site record
                site_record = CloudPanelSite(
                    server_id=server_id,
                    domain_name=result["domain"],
                    php_version=site_data.phpVersion,
                    site_user=result["sys_user"],
                    db_name=result["db_name"],
                    db_user=result["db_user"],
                    template_name=site_data.templateName,
                )
                db.add(site_record)
                db.commit()

                # Create subscription record linked to the deployed site
                db_sub = Subscription(
                    organization_id=org_id,
                    subscribed_product=subscribed_product or None,
                    modules=modules_list,
                    system_url=system_url or None,
                    cloudpanel_site_id=site_record.id,
                    subscribed_on_date=subscribed_on_date or None,
                    billed_from_date=billed_from_date or None,
                    expire_date=expire_date or None,
                )
                db.add(db_sub)
                db.commit()
                db.refresh(db_sub)

                # Save logo locally for subscription record if provided
                if logo_content:
                    safe_name = re.sub(r"[^\w\-. ]", "_", company_logo.filename or "logo")
                    unique_name = f"{uuid.uuid4().hex}_{safe_name}"
                    upload_dir = os.path.join(os.path.dirname(__file__), "..", "..", "subscription_logo_storage")
                    os.makedirs(upload_dir, exist_ok=True)
                    file_path = os.path.join(upload_dir, unique_name)
                    with open(file_path, "wb") as f:
                        f.write(logo_content)
                    db_sub.company_logo_url = f"/subscription-logos/{unique_name}"
                    db.commit()

                yield f"data: {json.dumps({'step': 'subscription_created', 'status': 'success', 'subscription_id': db_sub.id})}\n\n"

                # Auto-submit post-create form if configured
                try:
                    settings = db.query(SubscriptionSettings).first()
                    if settings and settings.post_create_form_slug and settings.post_create_field_map:
                        form_obj = db.query(FormModel).filter(
                            FormModel.slug == settings.post_create_form_slug,
                            FormModel.is_published == True,
                        ).first()
                        if form_obj and form_obj.api_create_method and form_obj.api_server_id:
                            org = db.query(Organization).filter(Organization.id == org_id).first()
                            form_data = _build_form_payload(settings.post_create_field_map, db_sub, org)

                            # Inject hidden fields
                            from app.routes.forms import _inject_hidden_fields
                            form_data = _inject_hidden_fields(db, form_obj, form_data, current_user)

                            server_api = db.query(ApiServer).filter(ApiServer.id == form_obj.api_server_id).first()
                            cred = db.query(UserApiCredential).filter(
                                UserApiCredential.user_id == current_user.id,
                                UserApiCredential.api_server_id == server_api.id,
                            ).first()
                            if server_api and cred:
                                import asyncio
                                loop = asyncio.get_event_loop()
                                result = loop.run_until_complete(
                                    api_request(db, server_api, cred, form_obj.api_create_method, body=form_data)
                                )
                                yield f"data: {json.dumps({'step': 'form_submitted', 'status': 'success', 'message': 'Form submitted to remote API'})}\n\n"
                except Exception as form_err:
                    import logging
                    logging.getLogger(__name__).warning(f"Post-create form submission failed: {form_err}")
                    yield f"data: {json.dumps({'step': 'form_submit_failed', 'status': 'warning', 'message': str(form_err)})}\n\n"

        except Exception as e:
            yield f"data: {json.dumps({'step': 'error', 'status': 'error', 'message': str(e)})}\n\n"
        finally:
            # Clean up temp logo file
            if logo_temp_path and os.path.exists(logo_temp_path):
                os.unlink(logo_temp_path)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        }
    )

@router.get("/{org_id}/subscriptions", response_model=List[SubscriptionResponse])
def list_organization_subscriptions(
    org_id: int,
    db: Session = Depends(get_db),
    admin_user: User = Depends(require_subs)
):
    return db.query(Subscription).filter(Subscription.organization_id == org_id).all()

@router.put("/subscriptions/{sub_id}", response_model=SubscriptionResponse)
def update_subscription(
    sub_id: int,
    sub_update: SubscriptionUpdate,
    db: Session = Depends(get_db),
    admin_user: User = Depends(require_subs)
):
    db_sub = db.query(Subscription).filter(Subscription.id == sub_id).first()
    if not db_sub:
        raise HTTPException(status_code=404, detail="Subscription not found")
    
    update_data = sub_update.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(db_sub, key, value)
    
    db.commit()
    db.refresh(db_sub)
    return db_sub

# Subscription Company Logo Upload
@router.post("/subscriptions/{sub_id}/company-logo")
async def upload_subscription_logo(
    sub_id: int,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    admin_user: User = Depends(require_subs)
):
    db_sub = db.query(Subscription).filter(Subscription.id == sub_id).first()
    if not db_sub:
        raise HTTPException(status_code=404, detail="Subscription not found")

    # Validate image type
    allowed_types = {"image/jpeg", "image/png", "image/gif", "image/webp", "image/svg+xml"}
    if file.content_type not in allowed_types:
        raise HTTPException(status_code=400, detail="Only image files (JPEG, PNG, GIF, WebP, SVG) are allowed")

    # Validate file size (max 200KB)
    content = await file.read()
    if len(content) > 200 * 1024:
        raise HTTPException(status_code=400, detail="File too large. Maximum size is 200KB")

    safe_name = re.sub(r"[^\w\-. ]", "_", file.filename or "logo")
    unique_name = f"{uuid.uuid4().hex}_{safe_name}"

    upload_dir = os.path.join(os.path.dirname(__file__), "..", "..", "subscription_logo_storage")
    os.makedirs(upload_dir, exist_ok=True)

    file_path = os.path.join(upload_dir, unique_name)
    with open(file_path, "wb") as f:
        f.write(content)

    db_sub.company_logo_url = f"/subscription-logos/{unique_name}"
    db.commit()

    return {"url": db_sub.company_logo_url}

@router.delete("/subscriptions/{sub_id}")
def delete_subscription(
    sub_id: int,
    db: Session = Depends(get_db),
    admin_user: User = Depends(require_subs)
):
    db_sub = db.query(Subscription).filter(Subscription.id == sub_id).first()
    if not db_sub:
        raise HTTPException(status_code=404, detail="Subscription not found")

    db.delete(db_sub)
    db.commit()
    return {"status": "success", "message": "Subscription deleted"}


# Organization Emails (filtered by domain)
@router.get("/{org_id}/emails")
def get_organization_emails(
    org_id: int,
    skip: int = 0,
    limit: int = 20,
    db: Session = Depends(get_db),
    admin_user: User = Depends(require_orgs)
):
    """Get emails sent from or received by the organization's domain."""
    org = db.query(Organization).filter(Organization.id == org_id).first()
    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")

    if not org.domain_name:
        return {"total": 0, "emails": []}

    from app.models.email import Email as EmailModel
    from sqlalchemy import or_

    domain = org.domain_name.lstrip('@').strip()
    pattern = f"%@{domain}"

    query = db.query(EmailModel).filter(
        or_(
            EmailModel.from_address.ilike(pattern),
            EmailModel.to_address.ilike(pattern),
        ),
        EmailModel.is_draft == False,
    ).order_by(EmailModel.received_at.desc())

    total = query.count()
    emails = query.offset(skip).limit(limit).all()

    result = []
    for e in emails:
        result.append({
            "id": e.id,
            "from_address": e.from_address,
            "to_address": e.to_address,
            "cc": e.cc,
            "subject": e.subject,
            "body_html": e.body_html,
            "body_text": e.body_text,
            "received_at": e.received_at.isoformat() if e.received_at else None,
            "is_read": e.is_read,
            "is_sent": e.is_sent,
            "is_archived": e.is_archived,
            "thread_id": e.thread_id,
        })

    return {"total": total, "emails": result}


# Organization Call Records (by organization_id or org/contact phone numbers)
@router.get("/{org_id}/call-records")
def get_organization_call_records(
    org_id: int,
    skip: int = 0,
    limit: int = 20,
    db: Session = Depends(get_db),
    admin_user: User = Depends(require_orgs)
):
    """Get call records linked to the organization or its contact phone numbers."""
    org = db.query(Organization).filter(Organization.id == org_id).first()
    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")

    from app.models.call_records import CallRecording as CallRecordingModel
    from sqlalchemy import or_

    # Collect phone numbers from org and its contacts
    phone_numbers = []
    if org.contact_numbers:
        phone_numbers.extend([str(p) for p in org.contact_numbers if p])
    contacts = db.query(OrganizationContact).filter(
        OrganizationContact.organization_id == org_id
    ).all()
    for contact in contacts:
        if contact.phone_no:
            phone_numbers.extend([str(p) for p in contact.phone_no if p])

    filters = [CallRecordingModel.organization_id == org_id]
    if phone_numbers:
        filters.append(CallRecordingModel.phone_number.in_(phone_numbers))

    query = db.query(CallRecordingModel).filter(
        or_(*filters)
    ).order_by(CallRecordingModel.created_at.desc())

    total = query.count()
    records = query.offset(skip).limit(limit).all()

    from app.models.ticket import Ticket as TicketModel

    result = []
    for r in records:
        ticket_id = None
        if r.ticket_number:
            linked = db.query(TicketModel).filter(TicketModel.ticket_number == r.ticket_number).first()
            if linked:
                ticket_id = linked.id
        result.append({
            "id": r.id,
            "phone_number": r.phone_number,
            "direction": r.direction,
            "disposition": r.disposition,
            "duration_seconds": r.duration_seconds,
            "agent_name": r.agent_name,
            "ticket_number": r.ticket_number,
            "ticket_id": ticket_id,
            "created_at": r.created_at.isoformat() if r.created_at else None,
        })

    return {"total": total, "call_records": result}


@router.get("/{org_id}/call-records/{call_id}/ticket-thread")
def get_call_ticket_thread(
    org_id: int,
    call_id: int,
    db: Session = Depends(get_db),
    admin_user: User = Depends(require_orgs)
):
    """Get the full ticket thread linked to a call record."""
    from app.models.call_records import CallRecording as CallRecordingModel
    from app.models.ticket import Ticket as TicketModel

    call = db.query(CallRecordingModel).filter(CallRecordingModel.id == call_id).first()
    if not call:
        raise HTTPException(status_code=404, detail="Call record not found")

    if not call.ticket_number:
        return {"tickets": []}

    ticket = db.query(TicketModel).filter(
        TicketModel.ticket_number == call.ticket_number
    ).first()

    if not ticket:
        return {"tickets": []}

    # Walk up to root ticket
    if ticket.parent_ticket_id:
        root = db.query(TicketModel).filter(TicketModel.id == ticket.parent_ticket_id).first()
        if root:
            ticket = root

    children = db.query(TicketModel).filter(
        TicketModel.parent_ticket_id == ticket.id
    ).order_by(TicketModel.created_at.asc()).all()

    def _to_dict(t):
        return {
            "id": t.id,
            "ticket_number": t.ticket_number,
            "phone_number": t.phone_number,
            "customer_name": t.customer_name,
            "status": t.status.value if hasattr(t.status, "value") else str(t.status),
            "priority": t.priority.value if hasattr(t.priority, "value") else str(t.priority),
            "category": t.category,
            "forward_target": t.forward_target,
            "forward_reason": t.forward_reason,
            "app_type_data": t.app_type_data,
            "created_at": t.created_at.isoformat() if t.created_at else None,
            "updated_at": t.updated_at.isoformat() if t.updated_at else None,
        }

    return {"tickets": [_to_dict(ticket)] + [_to_dict(c) for c in children]}


# Organization Conversations (filtered by domain)
@router.get("/{org_id}/conversations")
def get_organization_conversations(
    org_id: int,
    skip: int = 0,
    limit: int = 20,
    db: Session = Depends(get_db),
    admin_user: User = Depends(require_orgs)
):
    """Get conversations where the contact_id matches the organization's domain."""
    org = db.query(Organization).filter(Organization.id == org_id).first()
    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")

    if not org.domain_name:
        return {"total": 0, "conversations": []}

    from app.models.conversation import Conversation as ConversationModel

    domain = org.domain_name.lstrip('@').strip()
    pattern = f"%@{domain}"

    query = db.query(ConversationModel).filter(
        ConversationModel.contact_id.ilike(pattern)
    ).order_by(ConversationModel.updated_at.desc())

    total = query.count()
    conversations = query.offset(skip).limit(limit).all()

    result = []
    for c in conversations:
        result.append({
            "id": c.id,
            "conversation_id": c.conversation_id,
            "platform": c.platform,
            "contact_name": c.contact_name,
            "contact_id": c.contact_id,
            "contact_avatar": c.contact_avatar,
            "last_message": c.last_message,
            "last_message_time": c.last_message_time.isoformat() if c.last_message_time else None,
            "status": c.status,
            "category": c.category,
            "assigned_to": c.assigned_to,
            "rating": c.rating,
            "created_at": c.created_at.isoformat() if c.created_at else None,
            "updated_at": c.updated_at.isoformat() if c.updated_at else None,
        })

    return {"total": total, "conversations": result}
