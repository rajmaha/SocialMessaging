from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import desc
from datetime import datetime, timedelta
from typing import Optional, List, Any
from pydantic import BaseModel

from app.database import get_db
from app.models.automation import AutomationRule, EmailSequence, EmailSequenceStep, EmailSequenceEnrollment
from app.models.crm import Lead
from app.models.user import User
from app.dependencies import get_current_user

router = APIRouter(prefix="/crm/automation", tags=["crm-automation"])


# ── Inline Schemas ──────────────────────────────────────────────────────────

class RuleCreate(BaseModel):
    name: str
    description: Optional[str] = None
    trigger_type: str
    conditions: Optional[Any] = {}
    actions: Optional[List[Any]] = []
    is_active: Optional[bool] = True

class RuleUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    trigger_type: Optional[str] = None
    conditions: Optional[Any] = None
    actions: Optional[List[Any]] = None
    is_active: Optional[bool] = None

class StepCreate(BaseModel):
    step_order: int
    delay_days: int
    subject: str
    body_html: str

class SequenceCreate(BaseModel):
    name: str
    description: Optional[str] = None
    is_active: Optional[bool] = True
    steps: Optional[List[StepCreate]] = []

class SequenceUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    is_active: Optional[bool] = None

class EnrollRequest(BaseModel):
    lead_id: int


# ── Automation Rules ────────────────────────────────────────────────────────

@router.get("/rules")
def list_rules(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    return db.query(AutomationRule).order_by(desc(AutomationRule.created_at)).all()

@router.post("/rules")
def create_rule(rule: RuleCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    db_rule = AutomationRule(**rule.model_dump(), created_by=current_user.id)
    db.add(db_rule)
    db.commit()
    db.refresh(db_rule)
    return db_rule

@router.patch("/rules/{rule_id}")
def update_rule(rule_id: int, rule: RuleUpdate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    db_rule = db.query(AutomationRule).filter(AutomationRule.id == rule_id).first()
    if not db_rule:
        raise HTTPException(status_code=404, detail="Rule not found")
    for k, v in rule.model_dump(exclude_unset=True).items():
        setattr(db_rule, k, v)
    db.commit()
    db.refresh(db_rule)
    return db_rule

@router.delete("/rules/{rule_id}")
def delete_rule(rule_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    db_rule = db.query(AutomationRule).filter(AutomationRule.id == rule_id).first()
    if not db_rule:
        raise HTTPException(status_code=404, detail="Rule not found")
    db.delete(db_rule)
    db.commit()
    return {"ok": True}


# ── Email Sequences ────────────────────────────────────────────────────────

@router.get("/sequences")
def list_sequences(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    seqs = db.query(EmailSequence).order_by(desc(EmailSequence.created_at)).all()
    result = []
    for s in seqs:
        enrollment_count = db.query(EmailSequenceEnrollment).filter(EmailSequenceEnrollment.sequence_id == s.id).count()
        result.append({
            "id": s.id, "name": s.name, "description": s.description,
            "is_active": s.is_active, "step_count": len(s.steps),
            "enrollment_count": enrollment_count,
            "created_at": s.created_at,
        })
    return result

@router.post("/sequences")
def create_sequence(seq: SequenceCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    db_seq = EmailSequence(name=seq.name, description=seq.description, is_active=seq.is_active, created_by=current_user.id)
    db.add(db_seq)
    db.flush()
    for step in (seq.steps or []):
        db.add(EmailSequenceStep(sequence_id=db_seq.id, **step.model_dump()))
    db.commit()
    db.refresh(db_seq)
    return db_seq

@router.get("/sequences/{seq_id}")
def get_sequence(seq_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    seq = db.query(EmailSequence).filter(EmailSequence.id == seq_id).first()
    if not seq:
        raise HTTPException(status_code=404, detail="Sequence not found")
    enrollments = db.query(EmailSequenceEnrollment).filter(EmailSequenceEnrollment.sequence_id == seq_id).all()
    return {
        "id": seq.id, "name": seq.name, "description": seq.description,
        "is_active": seq.is_active,
        "steps": [{"id": st.id, "step_order": st.step_order, "delay_days": st.delay_days, "subject": st.subject, "body_html": st.body_html} for st in seq.steps],
        "enrollments": [{"id": e.id, "lead_id": e.lead_id, "status": e.status,
                          "current_step": e.current_step, "next_send_at": e.next_send_at} for e in enrollments],
    }

@router.patch("/sequences/{seq_id}")
def update_sequence(seq_id: int, seq: SequenceUpdate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    db_seq = db.query(EmailSequence).filter(EmailSequence.id == seq_id).first()
    if not db_seq:
        raise HTTPException(status_code=404, detail="Not found")
    for k, v in seq.model_dump(exclude_unset=True).items():
        setattr(db_seq, k, v)
    db.commit()
    db.refresh(db_seq)
    return db_seq

@router.post("/sequences/{seq_id}/steps")
def add_step(seq_id: int, step: StepCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    db_step = EmailSequenceStep(sequence_id=seq_id, **step.model_dump())
    db.add(db_step)
    db.commit()
    db.refresh(db_step)
    return db_step

@router.delete("/sequences/{seq_id}/steps/{step_id}")
def delete_step(seq_id: int, step_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    step = db.query(EmailSequenceStep).filter(EmailSequenceStep.id == step_id, EmailSequenceStep.sequence_id == seq_id).first()
    if not step:
        raise HTTPException(status_code=404, detail="Step not found")
    db.delete(step)
    db.commit()
    return {"ok": True}

@router.post("/sequences/{seq_id}/enroll")
def enroll_lead(seq_id: int, req: EnrollRequest, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    seq = db.query(EmailSequence).filter(EmailSequence.id == seq_id).first()
    if not seq:
        raise HTTPException(status_code=404, detail="Sequence not found")
    existing = db.query(EmailSequenceEnrollment).filter(
        EmailSequenceEnrollment.sequence_id == seq_id,
        EmailSequenceEnrollment.lead_id == req.lead_id,
        EmailSequenceEnrollment.status == "active",
    ).first()
    if existing:
        raise HTTPException(status_code=400, detail="Lead already enrolled in this sequence")

    first_step = db.query(EmailSequenceStep).filter(EmailSequenceStep.sequence_id == seq_id).order_by(EmailSequenceStep.step_order).first()
    next_send = datetime.utcnow() + timedelta(days=first_step.delay_days) if first_step else None

    enrollment = EmailSequenceEnrollment(sequence_id=seq_id, lead_id=req.lead_id, next_send_at=next_send)
    db.add(enrollment)
    db.commit()
    db.refresh(enrollment)
    return enrollment

@router.post("/sequences/{seq_id}/unenroll/{lead_id}")
def unenroll_lead(seq_id: int, lead_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    enrollment = db.query(EmailSequenceEnrollment).filter(
        EmailSequenceEnrollment.sequence_id == seq_id,
        EmailSequenceEnrollment.lead_id == lead_id,
    ).first()
    if not enrollment:
        raise HTTPException(status_code=404, detail="Enrollment not found")
    enrollment.status = "paused"
    db.commit()
    return {"ok": True}
