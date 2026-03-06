import os
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from sqlalchemy.orm import Session
from app.database import get_db
from app.models.campaign import Campaign
from app.models.campaign_attachment import CampaignAttachment
from app.models.user import User
from app.dependencies import get_current_user, require_page

router = APIRouter(prefix="/campaigns", tags=["campaign-attachments"], dependencies=[Depends(require_page("campaigns"))])

ATTACHMENT_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "attachment_storage", "campaigns")


@router.post("/{campaign_id}/attachments")
async def upload_attachment(
    campaign_id: int,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    c = db.query(Campaign).filter(Campaign.id == campaign_id).first()
    if not c:
        raise HTTPException(status_code=404, detail="Campaign not found")

    count = db.query(CampaignAttachment).filter(CampaignAttachment.campaign_id == campaign_id).count()
    if count >= 3:
        raise HTTPException(status_code=400, detail="Maximum 3 attachments per campaign")

    content = await file.read()
    size = len(content)
    if size > 10 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="File too large (max 10MB)")

    save_dir = os.path.join(ATTACHMENT_DIR, str(campaign_id))
    os.makedirs(save_dir, exist_ok=True)
    file_path = os.path.join(save_dir, file.filename)
    with open(file_path, "wb") as f:
        f.write(content)

    att = CampaignAttachment(
        campaign_id=campaign_id,
        filename=file.filename,
        file_path=file_path,
        content_type=file.content_type or "application/octet-stream",
        size_bytes=size,
    )
    db.add(att)
    db.commit()
    db.refresh(att)
    return {"id": att.id, "filename": att.filename, "size_bytes": att.size_bytes, "content_type": att.content_type}


@router.get("/{campaign_id}/attachments")
def list_attachments(
    campaign_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    atts = db.query(CampaignAttachment).filter(CampaignAttachment.campaign_id == campaign_id).all()
    return [{"id": a.id, "filename": a.filename, "size_bytes": a.size_bytes, "content_type": a.content_type} for a in atts]


@router.delete("/{campaign_id}/attachments/{attachment_id}")
def delete_attachment(
    campaign_id: int,
    attachment_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    att = db.query(CampaignAttachment).filter(
        CampaignAttachment.id == attachment_id,
        CampaignAttachment.campaign_id == campaign_id,
    ).first()
    if not att:
        raise HTTPException(status_code=404, detail="Attachment not found")
    if os.path.exists(att.file_path):
        os.remove(att.file_path)
    db.delete(att)
    db.commit()
    return {"status": "deleted"}
