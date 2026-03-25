# backend/app/routes/ci_cd.py
import threading
import logging
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.database import SessionLocal, get_db
from app.dependencies import get_admin_user
from app.models.ci_cd import CICDDeployment, CICDMigrationLog, CICDRepo, CICDScriptLog
from app.models.cloudpanel_server import CloudPanelServer
from app.schemas.ci_cd import (
    CICDCloudPanelSite,
    CICDDeploymentDetailOut,
    CICDDeploymentOut,
    CICDMigrationLogOut,
    CICDRepoCreate,
    CICDRepoOut,
    CICDRepoUpdate,
    CICDScriptLogOut,
    CICDServerOut,
)
from app.services import ci_cd_service

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/cicd", tags=["CI/CD"])


# ── Helpers ───────────────────────────────────────────────────────────────────

def _get_repo_or_404(repo_id: int, db: Session) -> CICDRepo:
    repo = db.query(CICDRepo).filter(CICDRepo.id == repo_id).first()
    if not repo:
        raise HTTPException(status_code=404, detail="Repository not found")
    return repo


def _repo_out(repo: CICDRepo, db: Session) -> CICDRepoOut:
    srv = db.query(CloudPanelServer).filter(CloudPanelServer.id == repo.server_id).first() if repo.server_id else None
    return CICDRepoOut.from_orm_masked(repo, server=srv)


def _deploy_in_thread(repo_id: int, triggered_by: str):
    def _run():
        db = SessionLocal()
        try:
            ci_cd_service.deploy(repo_id, triggered_by, db)
        except Exception as exc:
            logger.error("CICD background deploy repo %d error: %s", repo_id, exc)
        finally:
            db.close()
    threading.Thread(target=_run, daemon=True).start()


def _sync_scheduler(repo: CICDRepo, remove: bool = False):
    try:
        from main import scheduler  # type: ignore
        if scheduler is None:
            return
        job_id = f"cicd_deploy_{repo.id}"
        if remove or not repo.schedule_enabled or not repo.schedule_cron:
            try:
                scheduler.remove_job(job_id)
            except Exception:
                pass
        else:
            from apscheduler.triggers.cron import CronTrigger  # type: ignore
            scheduler.add_job(
                _deploy_in_thread,
                CronTrigger.from_crontab(repo.schedule_cron),
                id=job_id,
                args=[repo.id, "scheduled"],
                replace_existing=True,
            )
    except ImportError:
        pass
    except Exception as exc:
        logger.warning("CICD scheduler sync error for repo %d: %s", repo.id, exc)


# ── Servers (read-only passthrough from cloudpanel_servers) ───────────────────

@router.get("/servers", response_model=List[CICDServerOut])
def list_servers(db: Session = Depends(get_db), _=Depends(get_admin_user)):
    """Return all CloudPanel servers formatted for CI/CD use."""
    servers = db.query(CloudPanelServer).order_by(CloudPanelServer.id).all()
    return [
        CICDServerOut(
            id=s.id,
            name=s.name,
            host=s.host,
            port=s.ssh_port,
            username=s.ssh_user,
            auth_type="key" if s.ssh_key else "password",
            has_ssh_key=bool(s.ssh_key),
            has_ssh_password=bool(s.ssh_password),
            is_cloudpanel=True,
            created_at=s.created_at,
        )
        for s in servers
    ]


@router.get("/servers/{server_id}/cloudpanel-sites", response_model=List[CICDCloudPanelSite])
def get_cloudpanel_sites(server_id: int, db: Session = Depends(get_db), _=Depends(get_admin_user)):
    """SSH into the CloudPanel server and list all its sites."""
    server = db.query(CloudPanelServer).filter(CloudPanelServer.id == server_id).first()
    if not server:
        raise HTTPException(status_code=404, detail="Server not found")
    try:
        return ci_cd_service.fetch_cloudpanel_sites(server)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Failed to query CloudPanel: {exc}")


# ── Repo CRUD ─────────────────────────────────────────────────────────────────

@router.get("/repos", response_model=List[CICDRepoOut])
def list_repos(db: Session = Depends(get_db), _=Depends(get_admin_user)):
    return [_repo_out(r, db) for r in db.query(CICDRepo).order_by(CICDRepo.id).all()]


@router.post("/repos", response_model=CICDRepoOut)
def create_repo(data: CICDRepoCreate, db: Session = Depends(get_db), _=Depends(get_admin_user)):
    repo = CICDRepo(**data.model_dump())
    db.add(repo)
    db.commit()
    db.refresh(repo)
    _sync_scheduler(repo)
    return _repo_out(repo, db)


@router.get("/repos/{repo_id}", response_model=CICDRepoOut)
def get_repo(repo_id: int, db: Session = Depends(get_db), _=Depends(get_admin_user)):
    return _repo_out(_get_repo_or_404(repo_id, db), db)


@router.put("/repos/{repo_id}", response_model=CICDRepoOut)
def update_repo(repo_id: int, data: CICDRepoUpdate, db: Session = Depends(get_db), _=Depends(get_admin_user)):
    repo = _get_repo_or_404(repo_id, db)
    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(repo, field, value)
    db.commit()
    db.refresh(repo)
    _sync_scheduler(repo)
    return _repo_out(repo, db)


@router.delete("/repos/{repo_id}")
def delete_repo(repo_id: int, db: Session = Depends(get_db), _=Depends(get_admin_user)):
    repo = _get_repo_or_404(repo_id, db)
    _sync_scheduler(repo, remove=True)
    db.delete(repo)
    db.commit()
    return {"ok": True}


# ── Deploy ────────────────────────────────────────────────────────────────────

@router.post("/repos/{repo_id}/deploy")
def trigger_deploy(repo_id: int, db: Session = Depends(get_db), _=Depends(get_admin_user)):
    _get_repo_or_404(repo_id, db)
    deployment = CICDDeployment(repo_id=repo_id, status="running", triggered_by="manual")
    db.add(deployment)
    db.commit()
    db.refresh(deployment)
    dep_id = deployment.id

    def _run():
        inner_db = SessionLocal()
        try:
            dep = inner_db.query(CICDDeployment).filter(CICDDeployment.id == dep_id).first()
            repo = inner_db.query(CICDRepo).filter(CICDRepo.id == repo_id).first()
            if not dep or not repo:
                return
            srv = inner_db.query(CloudPanelServer).filter(CloudPanelServer.id == repo.server_id).first() if repo.server_id else None
            from datetime import datetime
            try:
                dep.git_output = ci_cd_service.git_pull_or_clone(repo, srv)
                inner_db.commit()  # commit git stage so polling can see progress

                ci_cd_service.run_scripts(repo, dep, inner_db, srv)
                inner_db.commit()  # commit script logs so polling can see progress

                ci_cd_service.run_migrations(repo, dep, inner_db, srv)
                inner_db.commit()  # commit migration logs so polling can see progress

                dep.status = "success"
            except Exception as exc:
                logger.error("CICD manual deploy repo %d failed: %s", repo_id, exc)
                dep.status = "failed"
                dep.error = str(exc)[:4000]
            finally:
                dep.finished_at = datetime.utcnow()
                repo.last_deployed_at = datetime.utcnow()
                inner_db.commit()
        finally:
            inner_db.close()

    threading.Thread(target=_run, daemon=True).start()
    return {"deployment_id": dep_id, "status": "running"}


# ── Deployments ───────────────────────────────────────────────────────────────

@router.get("/repos/{repo_id}/deployments", response_model=List[CICDDeploymentOut])
def list_deployments(
    repo_id: int,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
    _=Depends(get_admin_user),
):
    _get_repo_or_404(repo_id, db)
    return (
        db.query(CICDDeployment)
        .filter(CICDDeployment.repo_id == repo_id)
        .order_by(CICDDeployment.started_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )


@router.get("/repos/{repo_id}/deployments/{dep_id}", response_model=CICDDeploymentDetailOut)
def get_deployment(repo_id: int, dep_id: int, db: Session = Depends(get_db), _=Depends(get_admin_user)):
    _get_repo_or_404(repo_id, db)
    dep = db.query(CICDDeployment).filter(CICDDeployment.id == dep_id, CICDDeployment.repo_id == repo_id).first()
    if not dep:
        raise HTTPException(status_code=404, detail="Deployment not found")
    script_logs = db.query(CICDScriptLog).filter(CICDScriptLog.deployment_id == dep_id).order_by(CICDScriptLog.executed_at).all()
    migration_logs = db.query(CICDMigrationLog).filter(CICDMigrationLog.deployment_id == dep_id).order_by(CICDMigrationLog.database_name, CICDMigrationLog.sql_filename).all()
    return CICDDeploymentDetailOut(
        **{c.name: getattr(dep, c.name) for c in dep.__table__.columns},
        script_logs=script_logs,
        migration_logs=migration_logs,
    )


# ── Script / Migration logs ───────────────────────────────────────────────────

@router.get("/repos/{repo_id}/script-logs", response_model=List[CICDScriptLogOut])
def list_script_logs(repo_id: int, db: Session = Depends(get_db), _=Depends(get_admin_user)):
    _get_repo_or_404(repo_id, db)
    return db.query(CICDScriptLog).filter(CICDScriptLog.repo_id == repo_id).order_by(CICDScriptLog.executed_at.desc()).all()


@router.get("/repos/{repo_id}/migration-logs", response_model=List[CICDMigrationLogOut])
def list_migration_logs(
    repo_id: int,
    database_name: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    _=Depends(get_admin_user),
):
    _get_repo_or_404(repo_id, db)
    q = db.query(CICDMigrationLog).filter(CICDMigrationLog.repo_id == repo_id)
    if database_name:
        q = q.filter(CICDMigrationLog.database_name == database_name)
    return q.order_by(CICDMigrationLog.database_name, CICDMigrationLog.sql_filename).all()
