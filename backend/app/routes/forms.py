from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from sqlalchemy import func as sqlfunc
from typing import List, Optional
import csv
import io

from app.database import get_db
from app.dependencies import get_current_user, require_admin_feature
from app.models.user import User
from app.models.form import Form, FormField, FormSubmission
from app.models.api_server import ApiServer, UserApiCredential
from app.schemas.form import (
    FormCreate, FormUpdate, FormResponse,
    FormFieldCreate, FormFieldUpdate, FormFieldResponse, FormFieldReorder,
    FormSubmissionCreate, FormSubmissionUpdate, FormSubmissionResponse,
)
from app.services.api_proxy import api_request, _resolve_json_path

# --- Admin routes ---

admin_router = APIRouter(
    prefix="/api/admin/forms",
    tags=["admin", "forms"],
)

require_manage_forms = require_admin_feature("feature_manage_forms")


@admin_router.post("", response_model=FormResponse)
def create_form(
    data: FormCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_manage_forms),
):
    existing = db.query(Form).filter(Form.slug == data.slug).first()
    if existing:
        raise HTTPException(status_code=409, detail="A form with this slug already exists")
    form = Form(**data.model_dump(), created_by=current_user.id)
    db.add(form)
    db.commit()
    db.refresh(form)
    return _form_with_count(db, form)


@admin_router.get("", response_model=List[FormResponse])
def list_forms(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_manage_forms),
):
    forms = db.query(Form).order_by(Form.id.desc()).all()
    return [_form_with_count(db, f) for f in forms]


@admin_router.get("/{form_id}", response_model=FormResponse)
def get_form(
    form_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_manage_forms),
):
    form = db.query(Form).filter(Form.id == form_id).first()
    if not form:
        raise HTTPException(status_code=404, detail="Form not found")
    return _form_with_count(db, form)


@admin_router.put("/{form_id}", response_model=FormResponse)
def update_form(
    form_id: int,
    data: FormUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_manage_forms),
):
    form = db.query(Form).filter(Form.id == form_id).first()
    if not form:
        raise HTTPException(status_code=404, detail="Form not found")
    update_data = data.model_dump(exclude_unset=True)
    if "slug" in update_data and update_data["slug"] != form.slug:
        existing = db.query(Form).filter(Form.slug == update_data["slug"]).first()
        if existing:
            raise HTTPException(status_code=409, detail="Slug already in use")
    for key, value in update_data.items():
        setattr(form, key, value)
    db.commit()
    db.refresh(form)
    return _form_with_count(db, form)


@admin_router.delete("/{form_id}")
def delete_form(
    form_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_manage_forms),
):
    form = db.query(Form).filter(Form.id == form_id).first()
    if not form:
        raise HTTPException(status_code=404, detail="Form not found")
    db.query(FormField).filter(FormField.form_id == form_id).delete()
    db.query(FormSubmission).filter(FormSubmission.form_id == form_id).delete()
    db.delete(form)
    db.commit()
    return {"message": "Form deleted"}


def _form_with_count(db: Session, form: Form) -> dict:
    count = db.query(sqlfunc.count(FormSubmission.id)).filter(
        FormSubmission.form_id == form.id
    ).scalar()
    result = {c.name: getattr(form, c.name) for c in form.__table__.columns}
    result["submission_count"] = count or 0
    return result


# --- Fields ---

@admin_router.post("/{form_id}/fields", response_model=FormFieldResponse)
def create_field(
    form_id: int,
    data: FormFieldCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_manage_forms),
):
    form = db.query(Form).filter(Form.id == form_id).first()
    if not form:
        raise HTTPException(status_code=404, detail="Form not found")
    existing = db.query(FormField).filter(
        FormField.form_id == form_id, FormField.field_key == data.field_key
    ).first()
    if existing:
        raise HTTPException(status_code=409, detail=f"Field key '{data.field_key}' already exists in this form")
    field = FormField(form_id=form_id, **data.model_dump())
    db.add(field)
    db.commit()
    db.refresh(field)
    return field


@admin_router.get("/{form_id}/fields", response_model=List[FormFieldResponse])
def list_fields(
    form_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_manage_forms),
):
    return db.query(FormField).filter(
        FormField.form_id == form_id
    ).order_by(FormField.display_order.asc()).all()


@admin_router.put("/{form_id}/fields/{field_id}", response_model=FormFieldResponse)
def update_field(
    form_id: int,
    field_id: int,
    data: FormFieldUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_manage_forms),
):
    field = db.query(FormField).filter(
        FormField.id == field_id, FormField.form_id == form_id
    ).first()
    if not field:
        raise HTTPException(status_code=404, detail="Field not found")
    update_data = data.model_dump(exclude_unset=True)
    if "field_key" in update_data and update_data["field_key"] != field.field_key:
        existing = db.query(FormField).filter(
            FormField.form_id == form_id,
            FormField.field_key == update_data["field_key"],
            FormField.id != field_id,
        ).first()
        if existing:
            raise HTTPException(status_code=409, detail=f"Field key '{update_data['field_key']}' already exists")
    for key, value in update_data.items():
        setattr(field, key, value)
    db.commit()
    db.refresh(field)
    return field


@admin_router.delete("/{form_id}/fields/{field_id}")
def delete_field(
    form_id: int,
    field_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_manage_forms),
):
    field = db.query(FormField).filter(
        FormField.id == field_id, FormField.form_id == form_id
    ).first()
    if not field:
        raise HTTPException(status_code=404, detail="Field not found")
    db.delete(field)
    db.commit()
    return {"message": "Field deleted"}


@admin_router.put("/{form_id}/fields/reorder")
def reorder_fields(
    form_id: int,
    data: FormFieldReorder,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_manage_forms),
):
    for idx, field_id in enumerate(data.field_ids):
        db.query(FormField).filter(
            FormField.id == field_id, FormField.form_id == form_id
        ).update({"display_order": idx})
    db.commit()
    return {"message": "Fields reordered"}


# --- Submissions ---

@admin_router.get("/{form_id}/submissions", response_model=List[FormSubmissionResponse])
async def list_submissions(
    form_id: int,
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_manage_forms),
):
    form = db.query(Form).filter(Form.id == form_id).first()
    if not form:
        raise HTTPException(status_code=404, detail="Form not found")
    if form.storage_type == "api":
        return await _proxy_list(db, form, current_user)
    return db.query(FormSubmission).filter(
        FormSubmission.form_id == form_id
    ).order_by(FormSubmission.submitted_at.desc()).offset(skip).limit(limit).all()


@admin_router.get("/{form_id}/submissions/export")
def export_submissions(
    form_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_manage_forms),
):
    form = db.query(Form).filter(Form.id == form_id).first()
    if not form:
        raise HTTPException(status_code=404, detail="Form not found")
    if form.storage_type != "local":
        raise HTTPException(status_code=400, detail="Export only available for local forms")
    fields = db.query(FormField).filter(
        FormField.form_id == form_id
    ).order_by(FormField.display_order).all()
    submissions = db.query(FormSubmission).filter(
        FormSubmission.form_id == form_id
    ).order_by(FormSubmission.submitted_at.desc()).all()
    output = io.StringIO()
    writer = csv.writer(output)
    header = ["ID", "Submitted At"] + [f.field_label for f in fields] + ["Email"]
    writer.writerow(header)
    for sub in submissions:
        row = [sub.id, str(sub.submitted_at)]
        for f in fields:
            row.append(sub.data.get(f.field_key, ""))
        row.append(sub.submitter_email or "")
        writer.writerow(row)
    output.seek(0)
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename={form.slug}-submissions.csv"},
    )


@admin_router.get("/{form_id}/submissions/{sub_id}", response_model=FormSubmissionResponse)
async def get_submission(
    form_id: int,
    sub_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_manage_forms),
):
    form = db.query(Form).filter(Form.id == form_id).first()
    if not form:
        raise HTTPException(status_code=404, detail="Form not found")
    if form.storage_type == "api":
        return await _proxy_detail(db, form, current_user, sub_id)
    sub = db.query(FormSubmission).filter(
        FormSubmission.id == sub_id, FormSubmission.form_id == form_id
    ).first()
    if not sub:
        raise HTTPException(status_code=404, detail="Submission not found")
    return sub


@admin_router.put("/{form_id}/submissions/{sub_id}", response_model=FormSubmissionResponse)
async def update_submission(
    form_id: int,
    sub_id: int,
    data: FormSubmissionUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_manage_forms),
):
    form = db.query(Form).filter(Form.id == form_id).first()
    if not form:
        raise HTTPException(status_code=404, detail="Form not found")
    if form.storage_type == "api":
        return await _proxy_update(db, form, current_user, sub_id, data.data)
    sub = db.query(FormSubmission).filter(
        FormSubmission.id == sub_id, FormSubmission.form_id == form_id
    ).first()
    if not sub:
        raise HTTPException(status_code=404, detail="Submission not found")
    sub.data = data.data
    db.commit()
    db.refresh(sub)
    return sub


@admin_router.delete("/{form_id}/submissions/{sub_id}")
async def delete_submission(
    form_id: int,
    sub_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_manage_forms),
):
    form = db.query(Form).filter(Form.id == form_id).first()
    if not form:
        raise HTTPException(status_code=404, detail="Form not found")
    if form.storage_type == "api":
        return await _proxy_delete(db, form, current_user, sub_id)
    sub = db.query(FormSubmission).filter(
        FormSubmission.id == sub_id, FormSubmission.form_id == form_id
    ).first()
    if not sub:
        raise HTTPException(status_code=404, detail="Submission not found")
    db.delete(sub)
    db.commit()
    return {"message": "Submission deleted"}


# --- API Proxy helpers ---

def _get_credential(db: Session, form: Form, user: User) -> tuple:
    server = db.query(ApiServer).filter(ApiServer.id == form.api_server_id).first()
    if not server:
        raise HTTPException(status_code=400, detail="Form's API server not found")
    cred = db.query(UserApiCredential).filter(
        UserApiCredential.user_id == user.id,
        UserApiCredential.api_server_id == server.id,
    ).first()
    if not cred:
        raise HTTPException(
            status_code=401,
            detail="login_required",
            headers={"X-Login-Required": "true"},
        )
    return server, cred


async def _proxy_list(db: Session, form: Form, user: User):
    if not form.api_list_method:
        raise HTTPException(status_code=400, detail="No list endpoint configured")
    server, cred = _get_credential(db, form, user)
    return await api_request(db, server, cred, form.api_list_method)


async def _proxy_detail(db: Session, form: Form, user: User, record_id: int):
    if not form.api_detail_method:
        raise HTTPException(status_code=400, detail="No detail endpoint configured")
    server, cred = _get_credential(db, form, user)
    return await api_request(db, server, cred, form.api_detail_method, path_params={"id": str(record_id)})


async def _proxy_update(db: Session, form: Form, user: User, record_id: int, data: dict):
    if not form.api_update_method:
        raise HTTPException(status_code=400, detail="No update endpoint configured")
    server, cred = _get_credential(db, form, user)
    return await api_request(db, server, cred, form.api_update_method, path_params={"id": str(record_id)}, body=data)


async def _proxy_delete(db: Session, form: Form, user: User, record_id: int):
    if not form.api_delete_method:
        raise HTTPException(status_code=400, detail="No delete endpoint configured")
    server, cred = _get_credential(db, form, user)
    return await api_request(db, server, cred, form.api_delete_method, path_params={"id": str(record_id)})


# --- Public routes ---

public_router = APIRouter(
    prefix="/api/forms",
    tags=["forms"],
)


@public_router.get("/{slug}")
def get_public_form(
    slug: str,
    db: Session = Depends(get_db),
):
    form = db.query(Form).filter(Form.slug == slug, Form.is_published == True).first()
    if not form:
        raise HTTPException(status_code=404, detail="Form not found or not published")
    fields = db.query(FormField).filter(
        FormField.form_id == form.id
    ).order_by(FormField.display_order.asc()).all()
    form_dict = {c.name: getattr(form, c.name) for c in form.__table__.columns}
    form_dict["fields"] = [
        {c.name: getattr(f, c.name) for c in f.__table__.columns}
        for f in fields
    ]
    return form_dict


@public_router.post("/{slug}/submit")
async def submit_form(
    slug: str,
    data: FormSubmissionCreate,
    db: Session = Depends(get_db),
):
    form = db.query(Form).filter(Form.slug == slug, Form.is_published == True).first()
    if not form:
        raise HTTPException(status_code=404, detail="Form not found or not published")
    if form.storage_type == "local":
        submission = FormSubmission(
            form_id=form.id,
            data=data.data,
            submitter_email=data.submitter_email,
        )
        db.add(submission)
        db.commit()
        db.refresh(submission)
        return {"message": form.success_message, "submission_id": submission.id}
    raise HTTPException(status_code=400, detail="API form submission requires authentication")
