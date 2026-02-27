from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from typing import List, Dict
import os
import shutil
import zipfile
from pathlib import Path
from app.dependencies import get_current_user, require_admin_feature
from app.models.user import User

router = APIRouter(prefix="/cloudpanel/templates", tags=["CloudPanel Templates"])

require_cloudpanel = require_admin_feature("feature_manage_cloudpanel")

TEMPLATES_DIR = os.path.join(os.path.dirname(__file__), "..", "..", "templates")
os.makedirs(TEMPLATES_DIR, exist_ok=True)

@router.get("")
def list_templates(admin_user: User = Depends(require_cloudpanel)):
    templates = []
    if os.path.exists(TEMPLATES_DIR):
        for item in os.listdir(TEMPLATES_DIR):
            item_path = os.path.join(TEMPLATES_DIR, item)
            if os.path.isdir(item_path):
                # Check if it has any files inside
                has_files = False
                for root, dirs, files in os.walk(item_path):
                    if files:
                        has_files = True
                        break
                templates.append({"name": item, "has_files": has_files})
    return templates

@router.post("")
async def upload_template(
    name: str = Form(...),
    file: UploadFile = File(...),
    admin_user: User = Depends(require_cloudpanel)
):
    if not file.filename.endswith('.zip'):
        raise HTTPException(status_code=400, detail="Only .zip files are allowed")

    template_path = os.path.join(TEMPLATES_DIR, name)
    if os.path.exists(template_path):
        try:
            shutil.rmtree(template_path)
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Failed to clear existing template: {e}")

    try:
        os.makedirs(template_path, exist_ok=True)
        zip_path = os.path.join(TEMPLATES_DIR, f"{name}.zip")
        
        # Save ZIP
        with open(zip_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
            
        # Extract ZIP
        with zipfile.ZipFile(zip_path, 'r') as zip_ref:
            # Check for single top-level directory in zip
            namelist = zip_ref.namelist()
            top_level_dirs = {item.split('/')[0] for item in namelist if item}
            
            # If everything is inside a single folder, extract flat
            if len(top_level_dirs) == 1 and f"{list(top_level_dirs)[0]}/" in namelist:
                top_dir = list(top_level_dirs)[0]
                for member in namelist:
                    if member.startswith(f"{top_dir}/") and member != f"{top_dir}/":
                        target_path = os.path.join(template_path, member[len(top_dir)+1:])
                        # ensure dir exists
                        os.makedirs(os.path.dirname(target_path), exist_ok=True)
                        if not member.endswith('/'):
                            with open(target_path, 'wb') as f_out:
                                f_out.write(zip_ref.read(member))
            else:
                # Normal extract
                zip_ref.extractall(template_path)
                
        # Clean up ZIP
        os.remove(zip_path)
        
        return {"message": f"Template '{name}' uploaded and extracted successfully"}
    except Exception as e:
        if os.path.exists(template_path):
            shutil.rmtree(template_path)
        if os.path.exists(zip_path):
            os.remove(zip_path)
        raise HTTPException(status_code=500, detail=str(e))

@router.delete("/{name}")
def delete_template(name: str, admin_user: User = Depends(require_cloudpanel)):
    if name == "default_site":
        raise HTTPException(status_code=400, detail="Cannot delete default_site template")
        
    template_path = os.path.join(TEMPLATES_DIR, name)
    if not os.path.exists(template_path):
        raise HTTPException(status_code=404, detail="Template not found")
        
    try:
        shutil.rmtree(template_path)
        return {"message": f"Template '{name}' deleted successfully"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
