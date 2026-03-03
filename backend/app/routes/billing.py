import os
from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session
import stripe

from app.database import get_db
from app.models.organization import PricingPlan, Subscription, UsageEvent
from app.schemas.organization import (
    PricingPlanCreate, PricingPlanResponse,
    UsageEventCreate, UsageEventResponse,
    SubscriptionResponse,
)
from app.dependencies import require_admin_feature, get_current_user
# configuration helpers (can be edited directly instead of using .env)
from app import stripe_settings

# feature guard for billing/admin operations
require_billing = require_admin_feature("feature_manage_billing")
from app.models.user import User

router = APIRouter(prefix="/billing", tags=["billing"])

# initialize Stripe key from settings module or environment
stripe.api_key = stripe_settings.API_KEY or os.getenv("STRIPE_SECRET_KEY", "")

# pricing plan management (admin only)
@router.post("/pricing-plans", response_model=PricingPlanResponse)
def create_pricing_plan(
    plan: PricingPlanCreate,
    db: Session = Depends(get_db),
    admin: User = Depends(require_billing),
):
    db_plan = PricingPlan(**plan.model_dump())
    db.add(db_plan)
    db.commit()
    db.refresh(db_plan)
    return db_plan

# admin endpoint; normal users should call the public version below
@router.get("/pricing-plans", response_model=list[PricingPlanResponse])
def list_pricing_plans(
    db: Session = Depends(get_db),
    admin: User = Depends(require_billing),
):
    return db.query(PricingPlan).all()

# public pricing data (no auth required)
@router.get("/public/pricing-plans", response_model=list[PricingPlanResponse])
def list_pricing_plans_public(db: Session = Depends(get_db)):
    return db.query(PricingPlan).all()

# get current organization's subscription (assume user belongs to org)
@router.get("/organizations/{org_id}/subscription", response_model=SubscriptionResponse)
def get_subscription(
    org_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    sub = db.query(Subscription).filter(Subscription.organization_id == org_id).first()
    if not sub:
        raise HTTPException(status_code=404, detail="Subscription not found")
    return sub

# stripe checkout session creation
@router.post("/create-checkout-session")
async def create_checkout_session(
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    data = await request.json()
    price_id = data.get("price_id")
    org_id = data.get("organization_id")
    if not price_id:
        raise HTTPException(status_code=400, detail="price_id required")
    if org_id is None:
        raise HTTPException(status_code=400, detail="organization_id required")
    domain = os.getenv("FRONTEND_URL", "http://localhost:3000")
    try:
        session = stripe.checkout.Session.create(
            customer_email=user.email,
            line_items=[{"price": price_id, "quantity": 1}],
            mode="subscription",
            success_url=f"{domain}/settings/billing?success=1",
            cancel_url=f"{domain}/settings/billing?canceled=1",
            metadata={"organization_id": org_id},
        )
        return {"sessionId": session.id}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# stripe webhook endpoint
@router.post("/webhook")
async def stripe_webhook(request: Request, db: Session = Depends(get_db)):
    payload = await request.body()
    signature = request.headers.get("stripe-signature")
    webhook_secret = stripe_settings.WEBHOOK_SECRET or os.getenv("STRIPE_WEBHOOK_SECRET")
    event = None
    try:
        event = stripe.Webhook.construct_event(
            payload, signature, webhook_secret
        )
    except Exception as e:
        return JSONResponse(status_code=400, content={"error": str(e)})

    # handle relevant events
    if event.type == "checkout.session.completed":
        session = event.data.object
        cust_email = session.customer_email
        org_id = None
        if session.metadata and session.metadata.get("organization_id"):
            org_id = int(session.metadata.get("organization_id"))
        # find user or organization
        if org_id:
            sub = db.query(Subscription).filter(Subscription.organization_id == org_id).first()
            if not sub:
                # create a blank subscription record
                sub = Subscription(organization_id=org_id)
                db.add(sub)
            sub.stripe_customer_id = session.customer
            sub.stripe_subscription_id = session.subscription
            sub.status = "active"
            db.commit()
        else:
            # no organization metadata; ignore or log
            pass
    elif event.type.startswith("invoice."):
        pass
    # ... other events
    return JSONResponse(status_code=200, content={"received": True})

# analytics usage events
@router.post("/usage-events", response_model=UsageEventResponse)
def record_usage(
    event: UsageEventCreate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    # adapt key change from metadata to data
    event_dict = event.model_dump()
    # rename if provided
    if 'metadata' in event_dict:
        event_dict['data'] = event_dict.pop('metadata')
    db_event = UsageEvent(**event_dict)
    if user:
        db_event.user_id = user.id
    db.add(db_event)
    db.commit()
    db.refresh(db_event)
    return db_event

@router.get("/usage-events", response_model=list[UsageEventResponse])
def list_usage(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    # admins see all events; others only their own
    query = db.query(UsageEvent)
    if user.role != "admin":
        query = query.filter(UsageEvent.user_id == user.id)
    return query.all()
