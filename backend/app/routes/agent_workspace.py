from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import func
from datetime import datetime, time, date
from app.database import get_db
from app.dependencies import get_current_user
from app.models.user import User
from app.models.agent_status import AgentStatus
from app.models.call_records import CallRecording
from app.schemas.agent_status import AgentStatusUpdate, AgentStatusResponse, WorkspaceStatsResponse

router = APIRouter(
    prefix="/workspace",
    tags=["workspace", "agent"],
    responses={404: {"description": "Not found"}},
)

@router.get("/stats", response_model=WorkspaceStatsResponse)
def get_workspace_stats(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Get metrics and current status for the logged-in agent."""
    
    # 1. Get or create current status
    status_record = db.query(AgentStatus).filter(AgentStatus.user_id == current_user.id).first()
    if not status_record:
        status_record = AgentStatus(user_id=current_user.id, status="offline")
        db.add(status_record)
        db.commit()
        db.refresh(status_record)

    # 2. Calculate today's metrics
    today_start = datetime.combine(date.today(), time.min)
    
    today_calls = db.query(CallRecording).filter(
        CallRecording.agent_id == str(current_user.id),
        CallRecording.created_at >= today_start
    ).all()
    
    total_calls = len(today_calls)
    avg_duration = 0
    if total_calls > 0:
        total_duration = sum(c.duration_seconds for c in today_calls if c.duration_seconds)
        avg_duration = int(total_duration / total_calls)

    return {
        "total_calls_today": total_calls,
        "avg_call_duration_seconds": avg_duration,
        "status": status_record
    }

@router.put("/status", response_model=AgentStatusResponse)
def update_agent_status(
    data: AgentStatusUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Update the agent's availability status."""
    valid_statuses = ["available", "busy", "away", "offline"]
    if data.status not in valid_statuses:
        raise HTTPException(status_code=400, detail=f"Invalid status. Must be one of {valid_statuses}")
        
    status_record = db.query(AgentStatus).filter(AgentStatus.user_id == current_user.id).first()
    
    if status_record:
        status_record.status = data.status
    else:
        status_record = AgentStatus(user_id=current_user.id, status=data.status)
        db.add(status_record)
        
    db.commit()
    db.refresh(status_record)
    
    # In a full FreePBX/Asterisk integration, we would also trigger an AMI command here 
    # to Pause/Unpause the queue member so calls don't ring an away agent.
    
    return status_record
