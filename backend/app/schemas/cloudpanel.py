from pydantic import BaseModel
from typing import Optional
from datetime import datetime

class CloudPanelServerBase(BaseModel):
    name: str
    host: str
    ssh_port: int = 22
    ssh_user: str = "root"
    is_active: bool = True

class CloudPanelServerCreate(CloudPanelServerBase):
    ssh_password: Optional[str] = None
    ssh_key: Optional[str] = None

class CloudPanelServerUpdate(BaseModel):
    name: Optional[str] = None
    host: Optional[str] = None
    ssh_port: Optional[int] = None
    ssh_user: Optional[str] = None
    ssh_password: Optional[str] = None
    ssh_key: Optional[str] = None
    is_active: Optional[bool] = None

class CloudPanelServerResponse(CloudPanelServerBase):
    id: int
    created_at: datetime
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True

class CloudPanelServerDetailResponse(CloudPanelServerResponse):
    """Includes credentials for editing - only used on single-server GET."""
    ssh_password: Optional[str] = None
    ssh_key: Optional[str] = None

class CloudPanelSiteCreate(BaseModel):
    domainName: str
    phpVersion: str = "8.2"
    vhostTemplate: str = "Generic"
    templateName: Optional[str] = "default_site"
    dbName: Optional[str] = None
    dbUser: Optional[str] = None
    dbPassword: Optional[str] = None
    sysUser: Optional[str] = None
    sysUserPassword: Optional[str] = None
    issue_ssl: bool = True
    is_wildcard_ssl: bool = False
    custom_ssl_cert: Optional[str] = None
    custom_ssl_key: Optional[str] = None
    custom_ssl_chain: Optional[str] = None
    company_logo_local_path: Optional[str] = None  # Temp file path for logo to copy to deployed site

class CloudPanelSiteResponse(BaseModel):
    id: int
    server_id: int
    domain_name: str
    php_version: Optional[str] = None
    site_user: Optional[str] = None
    db_name: Optional[str] = None
    db_user: Optional[str] = None
    template_name: Optional[str] = None
    created_at: datetime
    server_name: Optional[str] = None
    server_host: Optional[str] = None

    class Config:
        from_attributes = True

class CloudPanelSiteDelete(BaseModel):
    password: str
