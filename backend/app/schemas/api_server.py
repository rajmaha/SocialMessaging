from pydantic import BaseModel, ConfigDict
from typing import Optional, List, Any
from datetime import datetime


class ApiServerCreate(BaseModel):
    name: str
    base_url: str
    auth_type: str = "none"
    api_key_header: Optional[str] = None
    api_key_value: Optional[str] = None
    token_header: Optional[str] = None
    login_endpoint: Optional[str] = None
    login_username_field: Optional[str] = "username"
    login_password_field: Optional[str] = "password"
    token_response_path: Optional[str] = "data.token"
    request_content_type: str = "json"
    preserved_fields: Optional[List[dict]] = None  # [{"key": "remote_user_id", "path": "data.id"}]
    response_success_path: Optional[str] = None  # e.g. "status" or "success"
    response_message_path: Optional[str] = "message"  # e.g. "message"
    response_data_path: Optional[str] = "data"  # e.g. "data"
    spec_file_name: Optional[str] = None


class ApiServerUpdate(BaseModel):
    name: Optional[str] = None
    base_url: Optional[str] = None
    auth_type: Optional[str] = None
    api_key_header: Optional[str] = None
    api_key_value: Optional[str] = None
    token_header: Optional[str] = None
    login_endpoint: Optional[str] = None
    login_username_field: Optional[str] = None
    login_password_field: Optional[str] = None
    token_response_path: Optional[str] = None
    request_content_type: Optional[str] = None
    preserved_fields: Optional[List[dict]] = None
    response_success_path: Optional[str] = None
    response_message_path: Optional[str] = None
    response_data_path: Optional[str] = None


class ApiServerResponse(ApiServerCreate):
    id: int
    created_at: datetime
    model_config = ConfigDict(from_attributes=True)


class UserApiCredentialCreate(BaseModel):
    user_id: int
    username: str
    password: str


class UserApiCredentialUpdate(BaseModel):
    username: Optional[str] = None
    password: Optional[str] = None


class UserApiCredentialResponse(BaseModel):
    id: int
    user_id: int
    api_server_id: int
    username: str
    is_active: bool
    token_expires_at: Optional[datetime] = None
    model_config = ConfigDict(from_attributes=True)


class ApiLoginRequest(BaseModel):
    username: str
    password: str


class ApiServerPublicResponse(BaseModel):
    id: int
    name: str
    base_url: str
    auth_type: str
    model_config = ConfigDict(from_attributes=True)


class UserApiCredentialSelfCreate(BaseModel):
    api_server_id: int
    username: str
    password: str


class SpecFieldDef(BaseModel):
    key: str
    label: str
    type: str = "string"
    format: Optional[str] = None
    required: bool = False
    description: Optional[str] = None
    enum: Optional[List[str]] = None
    default: Optional[Any] = None
    location: str = "body"  # body, query, path


class ApiServerEndpointResponse(BaseModel):
    id: int
    api_server_id: int
    path: str
    method: str
    summary: Optional[str] = None
    fields: Optional[List[dict]] = None
    source_type: str
    created_at: datetime
    model_config = ConfigDict(from_attributes=True)


class SpecUploadResponse(BaseModel):
    message: str
    spec_file_name: str
    endpoints_count: int
    endpoints: List[ApiServerEndpointResponse]


class AutoGenerateFieldsRequest(BaseModel):
    endpoint_id: int
