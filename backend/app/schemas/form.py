from pydantic import BaseModel, ConfigDict
from typing import Optional, List, Any, Dict
from datetime import datetime


# --- Form ---

class FormCreate(BaseModel):
    title: str
    slug: str
    description: Optional[str] = None
    success_message: Optional[str] = "Thank you for your submission!"
    storage_type: str = "local"
    is_published: bool = False
    require_otp: bool = False
    api_server_id: Optional[int] = None
    api_create_method: Optional[str] = None
    api_list_method: Optional[str] = None
    api_detail_method: Optional[str] = None
    api_update_method: Optional[str] = None
    api_delete_method: Optional[str] = None
    api_list_columns: Optional[List[Dict[str, Any]]] = None
    api_record_id_path: Optional[str] = "data.id"


class FormUpdate(BaseModel):
    title: Optional[str] = None
    slug: Optional[str] = None
    description: Optional[str] = None
    success_message: Optional[str] = None
    storage_type: Optional[str] = None
    is_published: Optional[bool] = None
    require_otp: Optional[bool] = None
    api_server_id: Optional[int] = None
    api_create_method: Optional[str] = None
    api_list_method: Optional[str] = None
    api_detail_method: Optional[str] = None
    api_update_method: Optional[str] = None
    api_delete_method: Optional[str] = None
    api_list_columns: Optional[List[Dict[str, Any]]] = None
    api_record_id_path: Optional[str] = None


class FormResponse(FormCreate):
    id: int
    created_by: Optional[int] = None
    created_at: datetime
    updated_at: datetime
    submission_count: Optional[int] = 0
    model_config = ConfigDict(from_attributes=True)


# --- FormField ---

class FormFieldCreate(BaseModel):
    field_label: str
    field_key: str
    field_type: str = "text"
    placeholder: Optional[str] = None
    is_required: bool = False
    display_order: int = 0
    default_value: Optional[str] = None
    options: Optional[List[Dict[str, str]]] = None
    validation_rules: Optional[Dict[str, Any]] = None
    api_endpoint: Optional[str] = None
    api_value_key: Optional[str] = None
    api_label_key: Optional[str] = None
    condition: Optional[Any] = None
    condition_logic: Optional[str] = "AND"
    api_params: Optional[List[Dict[str, str]]] = None


class FormFieldUpdate(BaseModel):
    field_label: Optional[str] = None
    field_key: Optional[str] = None
    field_type: Optional[str] = None
    placeholder: Optional[str] = None
    is_required: Optional[bool] = None
    display_order: Optional[int] = None
    default_value: Optional[str] = None
    options: Optional[List[Dict[str, str]]] = None
    validation_rules: Optional[Dict[str, Any]] = None
    api_endpoint: Optional[str] = None
    api_value_key: Optional[str] = None
    api_label_key: Optional[str] = None
    condition: Optional[Any] = None
    condition_logic: Optional[str] = None
    api_params: Optional[List[Dict[str, str]]] = None


class FormFieldResponse(FormFieldCreate):
    id: int
    form_id: int
    created_at: datetime
    updated_at: datetime
    model_config = ConfigDict(from_attributes=True)


class FormFieldReorder(BaseModel):
    field_ids: List[int]


# --- FormSubmission ---

class FormSubmissionCreate(BaseModel):
    data: Dict[str, Any]
    submitter_email: Optional[str] = None


class FormSubmissionUpdate(BaseModel):
    data: Dict[str, Any]


class FormSubmissionResponse(BaseModel):
    id: int
    form_id: int
    data: Dict[str, Any]
    submitter_email: Optional[str] = None
    submitted_at: datetime
    updated_at: Optional[datetime] = None
    model_config = ConfigDict(from_attributes=True)
