from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from typing import List
from app.database import get_db
from app.dependencies import get_current_user, get_admin_user
from app.models.user import User
from app.models.agent_extension import AgentExtension
from app.schemas.agent_extension import AgentExtensionCreate, AgentExtensionUpdate, AgentExtensionResponse
from app.services.freepbx_service import freepbx_service

router = APIRouter(
    prefix="/admin/extensions",
    tags=["admin", "extensions"],
    responses={404: {"description": "Not found"}},
)


def _get_user_display(user: User) -> str:
    return user.display_name or user.full_name or user.email.split("@")[0]


@router.get("", response_model=List[dict])
def get_user_extensions(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_admin_user)
):
    """Get all users and their assigned SIP extensions (with FreePBX sync status)."""
    users = db.query(User).all()
    extensions = db.query(AgentExtension).all()

    ext_map = {
        e.user_id: {
            "id": e.id,
            "extension": e.extension,
            "sip_password": e.sip_password,
            "is_enabled": e.is_enabled,
            "freepbx_synced": e.freepbx_synced,
        }
        for e in extensions
    }

    result = []
    for u in users:
        result.append({
            "id": u.id,
            "email": u.email,
            "full_name": u.display_name or u.full_name or u.email.split("@")[0],
            "role": u.role,
            "extension": ext_map.get(u.id)
        })

    return result


@router.post("", response_model=AgentExtensionResponse)
def assign_extension(
    data: AgentExtensionCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_admin_user)
):
    """Assign or update a SIP extension for a user and auto-create it in FreePBX."""
    # Check user exists
    user = db.query(User).filter(User.id == data.user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    # Check extension not stolen from another user
    existing_ext = db.query(AgentExtension).filter(AgentExtension.extension == data.extension).first()
    if existing_ext and existing_ext.user_id != data.user_id:
        raise HTTPException(
            status_code=400,
            detail=f"Extension {data.extension} is already assigned to another user."
        )

    # Update or Create DB record
    ext_record = db.query(AgentExtension).filter(AgentExtension.user_id == data.user_id).first()

    if ext_record:
        ext_record.extension = data.extension
        ext_record.sip_password = data.sip_password
        ext_record.freepbx_synced = False   # Reset until confirmed by FreePBX
    else:
        ext_record = AgentExtension(
            user_id=data.user_id,
            extension=data.extension,
            sip_password=data.sip_password,
            is_enabled=True,
            freepbx_synced=False,
        )
        db.add(ext_record)

    db.commit()
    db.refresh(ext_record)

    # Auto-push to FreePBX (non-blocking — failure won't roll back the DB save)
    display_name = _get_user_display(user)
    synced = freepbx_service.create_or_update_extension(
        db=db,
        extension=data.extension,
        sip_password=data.sip_password,
        display_name=display_name,
        email=user.email,
    )
    ext_record.freepbx_synced = synced
    db.commit()
    db.refresh(ext_record)

    return ext_record


@router.delete("/{user_id}")
def remove_extension(
    user_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_admin_user)
):
    """Remove a SIP extension assignment from a user and delete it from FreePBX."""
    ext_record = db.query(AgentExtension).filter(AgentExtension.user_id == user_id).first()
    if not ext_record:
        raise HTTPException(status_code=404, detail="No extension assigned to this user")

    extension_number = ext_record.extension

    # Remove from local DB first
    db.delete(ext_record)
    db.commit()

    # Then delete from FreePBX (non-blocking)
    freepbx_service.delete_extension(db=db, extension=extension_number)

    return {"message": "Extension removed successfully"}


@router.patch("/{user_id}/toggle")
def toggle_extension(
    user_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_admin_user)
):
    """Enable or disable an agent's extension (both in DB and FreePBX)."""
    ext_record = db.query(AgentExtension).filter(AgentExtension.user_id == user_id).first()
    if not ext_record:
        raise HTTPException(status_code=404, detail="No extension assigned to this user")

    # Flip the state
    ext_record.is_enabled = not ext_record.is_enabled
    db.commit()
    db.refresh(ext_record)

    # Apply to FreePBX
    if ext_record.is_enabled:
        freepbx_service.enable_extension(db=db, extension=ext_record.extension)
    else:
        freepbx_service.disable_extension(db=db, extension=ext_record.extension)

    state = "enabled" if ext_record.is_enabled else "disabled"
    return {
        "message": f"Extension {ext_record.extension} {state}",
        "is_enabled": ext_record.is_enabled,
        "extension": ext_record.extension,
    }


@router.post("/{user_id}/sync")
def sync_extension_to_freepbx(
    user_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_admin_user)
):
    """Manually re-push an agent's extension to FreePBX (useful after connectivity issues)."""
    ext_record = db.query(AgentExtension).filter(AgentExtension.user_id == user_id).first()
    if not ext_record:
        raise HTTPException(status_code=404, detail="No extension assigned to this user")

    user = db.query(User).filter(User.id == user_id).first()
    display_name = _get_user_display(user) if user else ""

    synced = freepbx_service.create_or_update_extension(
        db=db,
        extension=ext_record.extension,
        sip_password=ext_record.sip_password,
        display_name=display_name,
        email=user.email if user else "",
    )

    ext_record.freepbx_synced = synced
    db.commit()
    db.refresh(ext_record)

    return {
        "message": "Sync successful" if synced else "Sync failed — check FreePBX connection settings",
        "freepbx_synced": synced,
        "extension": ext_record.extension,
    }
