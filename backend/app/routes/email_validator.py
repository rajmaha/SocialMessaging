"""
Email Validator proxy routes — frontend calls these; backend adds the secret.
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel
from app.database import get_db
from app.dependencies import get_current_user
from app.models.user import User
from app.services.email_validator_service import email_validator_service

router = APIRouter(prefix="/email-validator", tags=["email-validator"])


class SingleValidateRequest(BaseModel):
    email: str


class BulkValidateRequest(BaseModel):
    emails: list[str]


@router.post("/validate")
def proxy_validate_single(
    body: SingleValidateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Proxy single email validation to external API."""
    result = email_validator_service.validate_single(body.email, db)
    if result is None:
        # Not configured or failed — return unchecked state
        return {"email": body.email, "is_valid": None, "risk_score": None, "unchecked": True}
    return {"email": body.email, **result}


@router.post("/validate-bulk")
def proxy_validate_bulk(
    body: BulkValidateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Proxy bulk email validation to external API."""
    results = email_validator_service.validate_bulk(body.emails, db)
    return {"results": results}


@router.post("/recheck-lead/{lead_id}")
def recheck_lead_email(
    lead_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Re-validate a lead's email. Updates lead.email_valid and EmailSuppression.
    Returns updated validity status.
    """
    from app.models.crm import Lead
    from app.models.email_suppression import EmailSuppression

    lead = db.query(Lead).filter(Lead.id == lead_id).first()
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
    if not lead.email:
        return {"lead_id": lead_id, "email": None, "email_valid": None, "message": "No email on lead"}

    result = email_validator_service.validate_single(lead.email, db)

    if result is None:
        # Validator not configured or timed out — fail open, don't change status
        return {"lead_id": lead_id, "email": lead.email, "email_valid": lead.email_valid, "unchecked": True}

    config = email_validator_service.get_validator_config(db)
    threshold = config[2] if config else 60
    risk_score = result.get("risk_score", 0)
    passed = result.get("is_valid", True) and risk_score < threshold

    if passed:
        lead.email_valid = True
        # Remove any "invalid" suppression for this email
        db.query(EmailSuppression).filter(
            EmailSuppression.email == lead.email,
            EmailSuppression.reason == "invalid",
        ).delete(synchronize_session=False)
    else:
        lead.email_valid = False
        # Upsert suppression with reason="invalid"
        existing = db.query(EmailSuppression).filter(
            EmailSuppression.email == lead.email,
            EmailSuppression.reason == "invalid",
        ).first()
        if not existing:
            db.add(EmailSuppression(email=lead.email, reason="invalid"))

    db.commit()
    db.refresh(lead)
    return {
        "lead_id": lead_id,
        "email": lead.email,
        "email_valid": lead.email_valid,
        "risk_score": risk_score,
        "unchecked": False,
    }
