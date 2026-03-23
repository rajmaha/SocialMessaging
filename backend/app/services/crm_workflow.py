"""
CRM Workflow Automation — evaluate trigger rules and execute actions.
"""
import logging
from datetime import datetime, timedelta
from sqlalchemy.orm import Session
from app.models.crm import CRMWorkflowRule, Task, Lead, Activity, TaskStatus

logger = logging.getLogger(__name__)


def matches_conditions(conditions: dict, context: dict) -> bool:
    """Check if all conditions match the context."""
    if not conditions:
        return True
    for key, expected in conditions.items():
        actual = context.get(key)
        if actual is None:
            return False
        if isinstance(expected, list):
            if actual not in expected:
                return False
        elif str(actual) != str(expected):
            return False
    return True


def execute_action(db: Session, action_type: str, action_config: dict, context: dict):
    """Execute a workflow action."""
    try:
        if action_type == "create_task":
            lead_id = context.get("lead_id")
            if not lead_id:
                return
            lead = db.query(Lead).filter(Lead.id == lead_id).first()
            if not lead:
                return
            due_days = action_config.get("due_days", 3)
            task = Task(
                lead_id=lead_id,
                deal_id=context.get("deal_id"),
                title=action_config.get("task_title", "Follow-up task"),
                description=action_config.get("task_description", "Auto-created by workflow rule"),
                status=TaskStatus.OPEN,
                assigned_to=lead.assigned_to,
                due_date=datetime.utcnow() + timedelta(days=due_days),
            )
            db.add(task)
            activity = Activity(
                lead_id=lead_id,
                type="task_created",
                title=f"Auto-task: {task.title}",
                description="Created by workflow automation",
            )
            db.add(activity)
            db.flush()

        elif action_type == "change_status":
            lead_id = context.get("lead_id")
            if not lead_id:
                return
            lead = db.query(Lead).filter(Lead.id == lead_id).first()
            if lead:
                new_status = action_config.get("new_status")
                if new_status:
                    lead.status = new_status
                    lead.updated_at = datetime.utcnow()

        elif action_type == "send_notification":
            from app.services.events_service import events_service, EventTypes
            import asyncio
            lead_id = context.get("lead_id")
            lead = db.query(Lead).filter(Lead.id == lead_id).first() if lead_id else None
            assigned_to = lead.assigned_to if lead else None
            if assigned_to:
                message = action_config.get("message", "Workflow notification triggered")
                event = events_service.create_event(
                    EventTypes.SYSTEM_NOTIFICATION,
                    {"message": message, "lead_id": lead_id},
                )
                try:
                    loop = asyncio.get_event_loop()
                    loop.create_task(events_service.broadcast_to_user(assigned_to, event))
                except RuntimeError:
                    pass

    except Exception as e:
        logger.error(f"Workflow action error ({action_type}): {e}")


def evaluate_rules(db: Session, trigger_type: str, context: dict):
    """Find and execute all matching active workflow rules for a trigger."""
    rules = (
        db.query(CRMWorkflowRule)
        .filter(CRMWorkflowRule.trigger_type == trigger_type, CRMWorkflowRule.is_active == True)
        .all()
    )
    for rule in rules:
        try:
            if matches_conditions(rule.conditions or {}, context):
                execute_action(db, rule.action_type, rule.action_config or {}, context)
        except Exception as e:
            logger.error(f"Workflow rule #{rule.id} ({rule.name}) error: {e}")
