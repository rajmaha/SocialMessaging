from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from typing import List
from app.database import get_db
from app.dependencies import get_current_user, require_admin_feature
from app.models.user import User
from app.models.cloudpanel_server import CloudPanelServer
from app.schemas.cloudpanel import CloudPanelServerCreate, CloudPanelServerResponse, CloudPanelServerUpdate, CloudPanelSiteCreate
from app.services.cloudpanel_service import CloudPanelService

router = APIRouter(prefix="/cloudpanel", tags=["CloudPanel Integration"])

require_cloudpanel = require_admin_feature("feature_manage_cloudpanel")

@router.post("/servers", response_model=CloudPanelServerResponse)
def create_server(
    server: CloudPanelServerCreate,
    db: Session = Depends(get_db),
    admin_user: User = Depends(require_cloudpanel)
):
    db_server = CloudPanelServer(**server.model_dump())
    db.add(db_server)
    db.commit()
    db.refresh(db_server)
    return db_server

@router.get("/servers", response_model=List[CloudPanelServerResponse])
def get_servers(
    skip: int = 0,
    limit: int = 100,
    db: Session = Depends(get_db),
    admin_user: User = Depends(require_cloudpanel)
):
    servers = db.query(CloudPanelServer).offset(skip).limit(limit).all()
    return servers

@router.post("/servers/{server_id}/sites")
def create_site_on_server(
    server_id: int,
    site_data: CloudPanelSiteCreate,
    db: Session = Depends(get_db),
    admin_user: User = Depends(require_cloudpanel)
):
    server = db.query(CloudPanelServer).filter(CloudPanelServer.id == server_id).first()
    if not server:
        raise HTTPException(status_code=404, detail="Server not found")
        
    try:
        with CloudPanelService(server) as service:
            result = service.create_site(site_data)
        return {"message": "Site created successfully", "details": result}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"CloudPanel error: {str(e)}")

@router.get("/servers/{server_id}/ssl-report")
def get_ssl_report(
    server_id: int,
    db: Session = Depends(get_db),
    admin_user: User = Depends(require_cloudpanel)
):
    server = db.query(CloudPanelServer).filter(CloudPanelServer.id == server_id).first()
    if not server:
        raise HTTPException(status_code=404, detail="Server not found")
        
    try:
        with CloudPanelService(server) as service:
            report = service.get_ssl_report()
        return report
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to fetch SSL report: {str(e)}")

@router.post("/servers/{server_id}/sites/{domain:path}/renew-ssl")
def renew_ssl(
    server_id: int,
    domain: str,
    db: Session = Depends(get_db),
    admin_user: User = Depends(require_cloudpanel)
):
    server = db.query(CloudPanelServer).filter(CloudPanelServer.id == server_id).first()
    if not server:
        raise HTTPException(status_code=404, detail="Server not found")
        
    try:
        with CloudPanelService(server) as service:
            output = service.renew_ssl(domain)
        return {"message": f"SSL renewed for {domain}", "output": output}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to renew SSL: {str(e)}")
