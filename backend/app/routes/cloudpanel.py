import base64
import json
import os
import tempfile
from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from typing import List, Optional
from app.database import get_db
from app.dependencies import get_current_user, require_admin_feature
from app.models.user import User
from app.models.cloudpanel_server import CloudPanelServer
from app.models.cloudpanel_site import CloudPanelSite
from app.schemas.cloudpanel import CloudPanelServerCreate, CloudPanelServerResponse, CloudPanelServerDetailResponse, CloudPanelServerUpdate, CloudPanelSiteCreate, CloudPanelSiteResponse, CloudPanelSiteDelete
from app.services.cloudpanel_service import CloudPanelService
from app.services import site_deploy_jobs
from app.routes.auth import verify_password

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

@router.get("/servers/{server_id}", response_model=CloudPanelServerDetailResponse)
def get_server(
    server_id: int,
    db: Session = Depends(get_db),
    admin_user: User = Depends(require_cloudpanel)
):
    server = db.query(CloudPanelServer).filter(CloudPanelServer.id == server_id).first()
    if not server:
        raise HTTPException(status_code=404, detail="Server not found")
    return server

@router.post("/servers/{server_id}/test-connection")
def test_existing_server_connection(
    server_id: int,
    db: Session = Depends(get_db),
    admin_user: User = Depends(require_cloudpanel)
):
    """Test SSH connection to an existing saved server."""
    server = db.query(CloudPanelServer).filter(CloudPanelServer.id == server_id).first()
    if not server:
        raise HTTPException(status_code=404, detail="Server not found")
    try:
        with CloudPanelService(server) as service:
            service._execute("echo ok")
        return {"success": True, "message": f"Connection to {server.name} successful!"}
    except Exception as e:
        return {"success": False, "message": f"Connection failed: {str(e)}"}

@router.put("/servers/{server_id}", response_model=CloudPanelServerResponse)
def update_server(
    server_id: int,
    server_data: CloudPanelServerUpdate,
    db: Session = Depends(get_db),
    admin_user: User = Depends(require_cloudpanel)
):
    server = db.query(CloudPanelServer).filter(CloudPanelServer.id == server_id).first()
    if not server:
        raise HTTPException(status_code=404, detail="Server not found")
    for key, value in server_data.model_dump(exclude_unset=True).items():
        setattr(server, key, value)
    db.commit()
    db.refresh(server)
    return server

@router.delete("/servers/{server_id}")
def delete_server(
    server_id: int,
    db: Session = Depends(get_db),
    admin_user: User = Depends(require_cloudpanel)
):
    server = db.query(CloudPanelServer).filter(CloudPanelServer.id == server_id).first()
    if not server:
        raise HTTPException(status_code=404, detail="Server not found")
    db.delete(server)
    db.commit()
    return {"message": "Server deleted successfully"}

@router.post("/servers/test-connection")
def test_server_connection(
    server: CloudPanelServerCreate,
    admin_user: User = Depends(require_cloudpanel)
):
    """Test SSH connection to a server before adding it."""
    temp_server = CloudPanelServer(**server.model_dump())
    try:
        with CloudPanelService(temp_server) as service:
            service._execute("echo ok")
        return {"success": True, "message": "Connection successful!"}
    except Exception as e:
        return {"success": False, "message": f"Connection failed: {str(e)}"}

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

        # Save deployed site record
        site_record = CloudPanelSite(
            server_id=server_id,
            domain_name=result["domain"],
            php_version=site_data.phpVersion,
            site_user=result["sys_user"],
            db_name=result["db_name"],
            db_user=result["db_user"],
            template_name=site_data.templateName,
            created_by_id=admin_user.id,
        )
        db.add(site_record)
        db.commit()

        return {"message": "Site created successfully", "details": result}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"CloudPanel error: {str(e)}")

def _site_deploy_events(server_id: int, site_data: CloudPanelSiteCreate, user_id: int,
                        logo_temp_path: Optional[str], db: Session):
    """The deployment's progress events (dicts), for the SSE stream and the
    background job alike. Records the site once it is deployed and removes the
    temporary logo whatever happens."""
    try:
        server = db.query(CloudPanelServer).filter(CloudPanelServer.id == server_id).first()
        if not server:
            yield {'step': 'error', 'status': 'error', 'message': 'Server not found'}
            return
        with CloudPanelService(server) as service:
            result = None
            for step_event in service.create_site_steps(site_data):
                yield step_event
                if step_event.get("step") == "complete":
                    result = step_event

        # Save deployed site record
        if result and result.get("status") == "success":
            site_record = CloudPanelSite(
                server_id=server_id,
                domain_name=result["domain"],
                php_version=site_data.phpVersion,
                site_user=result["sys_user"],
                db_name=result["db_name"],
                db_user=result["db_user"],
                template_name=site_data.templateName,
                created_by_id=user_id,
            )
            db.add(site_record)
            db.commit()
    except Exception as e:
        yield {'step': 'error', 'status': 'error', 'message': str(e)}
    finally:
        if logo_temp_path and os.path.exists(logo_temp_path):
            os.unlink(logo_temp_path)


@router.get("/deploy-jobs/{job_id}")
def deploy_job_status(
    job_id: str,
    after: int = 0,
    current_user: User = Depends(get_current_user),
):
    """A background site deployment's events since `after`, and its state.
    Polled by the CloudPanel Deploy page and an organization's Subscriptions;
    only the user who started the job can read it."""
    state = site_deploy_jobs.poll(job_id, current_user.id, after)
    if state is None:
        raise HTTPException(status_code=404, detail="Deployment not found")
    return state


@router.post("/servers/{server_id}/sites/deploy-stream")
def deploy_site_stream(
    server_id: int,
    site_data: CloudPanelSiteCreate,
    background: bool = False,
    db: Session = Depends(get_db),
    admin_user: User = Depends(require_cloudpanel)
):
    """Deploy a site, streaming progress step by step (SSE).

    With ?background=1 the deployment runs as a background job instead and
    this answers {"job_id"} at once; poll /cloudpanel/deploy-jobs/{job_id}.
    That is what the deploy screens use: a stream is held back by the proxies
    in Docker / Coolify until it ends."""
    server = db.query(CloudPanelServer).filter(CloudPanelServer.id == server_id).first()
    if not server:
        raise HTTPException(status_code=404, detail="Server not found")

    # The logo arrives inline (base64) because this endpoint streams SSE over a
    # JSON request. Write it to a temp file so create_site_steps can upload it.
    logo_temp_path = None
    if site_data.company_logo_base64:
        payload = site_data.company_logo_base64
        if payload.startswith("data:"):
            payload = payload.split(",", 1)[-1]
        try:
            logo_bytes = base64.b64decode(payload, validate=True)
        except Exception:
            raise HTTPException(status_code=400, detail="Company logo is not valid base64 data")
        if len(logo_bytes) > 200 * 1024:
            raise HTTPException(status_code=400, detail="Logo file too large. Maximum size is 200KB")
        logo_ext = os.path.splitext(site_data.company_logo_filename or "")[1] or ".png"
        tmp = tempfile.NamedTemporaryFile(delete=False, suffix=logo_ext)
        tmp.write(logo_bytes)
        tmp.close()
        logo_temp_path = tmp.name
        site_data.company_logo_local_path = logo_temp_path

    user_id = admin_user.id
    if background:
        job_id = site_deploy_jobs.start(
            user_id,
            lambda job_db: _site_deploy_events(server_id, site_data, user_id, logo_temp_path, job_db),
        )
        return {"job_id": job_id}

    def event_generator():
        # A leading comment line makes proxies send the headers and start
        # streaming right away instead of waiting for the first step.
        yield ": connected\n\n"
        for ev in _site_deploy_events(server_id, site_data, user_id, logo_temp_path, db):
            yield f"data: {json.dumps(ev)}\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",   # disables nginx/proxy buffering
        }
    )

@router.get("/sites", response_model=List[CloudPanelSiteResponse])
def list_all_sites(
    server_id: Optional[int] = None,
    unlinked: bool = False,
    db: Session = Depends(get_db),
    admin_user: User = Depends(require_cloudpanel)
):
    """List all deployed sites, optionally filtered by server.
    If unlinked=true, only return sites not yet linked to any subscription."""
    query = db.query(CloudPanelSite, CloudPanelServer.name, CloudPanelServer.host, User.full_name).join(
        CloudPanelServer, CloudPanelSite.server_id == CloudPanelServer.id
    ).outerjoin(User, CloudPanelSite.created_by_id == User.id)
    if server_id:
        query = query.filter(CloudPanelSite.server_id == server_id)
    if unlinked:
        from app.models.organization import Subscription
        linked_ids = db.query(Subscription.cloudpanel_site_id).filter(
            Subscription.cloudpanel_site_id.isnot(None)
        ).subquery()
        query = query.filter(~CloudPanelSite.id.in_(linked_ids))
    rows = query.order_by(CloudPanelSite.created_at.desc()).all()

    results = []
    for site, server_name, server_host, creator_name in rows:
        resp = CloudPanelSiteResponse.model_validate(site)
        resp.server_name = server_name
        resp.server_host = server_host
        resp.created_by_name = creator_name
        results.append(resp)
    return results

@router.delete("/sites/{site_id}")
def delete_site(
    site_id: int,
    body: CloudPanelSiteDelete,
    db: Session = Depends(get_db),
    admin_user: User = Depends(require_cloudpanel)
):
    """Delete a deployed site after password verification."""
    # Verify user password
    if not verify_password(body.password, admin_user.password_hash):
        raise HTTPException(status_code=403, detail="Incorrect password")

    site = db.query(CloudPanelSite).filter(CloudPanelSite.id == site_id).first()
    if not site:
        raise HTTPException(status_code=404, detail="Site not found")

    server = db.query(CloudPanelServer).filter(CloudPanelServer.id == site.server_id).first()
    if not server:
        raise HTTPException(status_code=404, detail="Server not found")

    # Delete from remote CloudPanel
    try:
        with CloudPanelService(server) as service:
            service._execute(f"clpctl site:delete --domainName={site.domain_name} --force")
            if site.db_name:
                try:
                    service._execute(f"clpctl db:delete --domainName={site.domain_name} --databaseName={site.db_name}")
                except Exception:
                    pass  # DB may already be removed with site
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to delete from server: {str(e)}")

    # Remove local record
    db.delete(site)
    db.commit()
    return {"message": f"Site '{site.domain_name}' deleted successfully"}

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
