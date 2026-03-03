"""
Lead scoring service — auto-increment lead score based on CRM activity.
"""
from sqlalchemy.orm import Session
from app.models.crm import Lead

# Points awarded per action type
SCORE_MAP = {
    "note": 5,
    "message": 5,
    "email": 10,
    "task_created": 10,
    "call": 20,
    "meeting": 30,
    "deal_created": 25,
    "deal_won": 50,
    "deal_lost": -10,
}


def apply_score(lead_id: int, action: str, db: Session) -> int:
    """
    Add or subtract points from a lead's score based on the action performed.
    Score is clamped to a minimum of 0.
    Returns the new score.
    """
    delta = SCORE_MAP.get(action, 0)
    if delta == 0:
        return 0

    lead = db.query(Lead).filter(Lead.id == lead_id).first()
    if not lead:
        return 0

    new_score = max(0, lead.score + delta)
    lead.score = new_score
    db.commit()
    return new_score
