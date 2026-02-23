from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List
from app.database import get_db
from app.models.platform_account import PlatformAccount
from pydantic import BaseModel

router = APIRouter(prefix="/accounts", tags=["accounts"])

class PlatformAccountCreate(BaseModel):
    user_id: int
    platform: str
    account_id: str
    account_name: str
    access_token: str = None
    phone_number: str = None

class PlatformAccountResponse(BaseModel):
    id: int
    user_id: int
    platform: str
    account_name: str
    phone_number: str = None
    is_active: int

    class Config:
        from_attributes = True

@router.post("/", response_model=dict)
def add_platform_account(
    account_data: PlatformAccountCreate,
    db: Session = Depends(get_db)
):
    """Add a new platform account"""
    
    # Check if account already exists
    existing = db.query(PlatformAccount).filter(
        PlatformAccount.account_id == account_data.account_id
    ).first()
    
    if existing:
        raise HTTPException(status_code=400, detail="Account already connected")
    
    db_account = PlatformAccount(
        user_id=account_data.user_id,
        platform=account_data.platform.lower(),
        account_id=account_data.account_id,
        account_name=account_data.account_name,
        access_token=account_data.access_token,
        phone_number=account_data.phone_number
    )
    
    db.add(db_account)
    db.commit()
    db.refresh(db_account)
    
    return {"success": True, "account_id": db_account.id}

@router.get("/user/{user_id}", response_model=List[PlatformAccountResponse])
def get_user_accounts(
    user_id: int,
    db: Session = Depends(get_db)
):
    """Get all connected accounts for a user"""
    
    accounts = db.query(PlatformAccount).filter(
        PlatformAccount.user_id == user_id
    ).all()
    
    return accounts

@router.delete("/{account_id}")
def disconnect_account(
    account_id: int,
    db: Session = Depends(get_db)
):
    """Disconnect a platform account"""
    
    account = db.query(PlatformAccount).filter(
        PlatformAccount.id == account_id
    ).first()
    
    if not account:
        raise HTTPException(status_code=404, detail="Account not found")
    
    db.delete(account)
    db.commit()
    
    return {"success": True, "message": "Account disconnected"}

@router.put("/{account_id}")
def toggle_account(
    account_id: int,
    is_active: int,
    db: Session = Depends(get_db)
):
    """Enable or disable a platform account"""
    
    account = db.query(PlatformAccount).filter(
        PlatformAccount.id == account_id
    ).first()
    
    if not account:
        raise HTTPException(status_code=404, detail="Account not found")
    
    account.is_active = is_active
    db.commit()
    
    return {"success": True, "message": "Account updated"}
