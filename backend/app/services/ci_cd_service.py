# backend/app/services/ci_cd_service.py
"""
CI/CD deployment service.

Deployment order: git clone/pull → shell scripts (once) → SQL migrations (once per DB).

If a CloudPanelServer is attached to the repo, all commands run on that server via SSH.
Migrations run via `psql` (PostgreSQL) or `mysql` (MySQL) on the target server — no DB credentials required.
If no server is attached, everything runs locally.
"""
import contextlib
import json
import logging
import os
import subprocess
import tempfile
from datetime import datetime
from io import StringIO
from pathlib import Path
from typing import Optional

import paramiko
from sqlalchemy.orm import Session

from app.models.ci_cd import CICDDeployment, CICDMigrationLog, CICDRepo, CICDScriptLog
from app.models.cloudpanel_server import CloudPanelServer

logger = logging.getLogger(__name__)

# Known CloudPanel SQLite DB paths (tried in order)
_CLOUDPANEL_DB_CANDIDATES = [
    "/home/cloudpanel/service/cloud-panel.db",
    "/home/clp/services/cloud-panel.db",
    "/var/lib/cloudpanel/cloud-panel.db",
]


# ── SSH helpers ───────────────────────────────────────────────────────────────

def _make_paramiko_client(server: CloudPanelServer) -> paramiko.SSHClient:
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    kwargs: dict = {
        "hostname": server.host,
        "port": server.ssh_port or 22,
        "username": server.ssh_user,
        "timeout": 15,
    }
    if server.ssh_key:
        pkey = None
        for key_class in [paramiko.RSAKey, paramiko.Ed25519Key, paramiko.ECDSAKey, paramiko.DSSKey]:
            try:
                pkey = key_class.from_private_key(StringIO(server.ssh_key))
                break
            except Exception:
                continue
        if pkey is None:
            raise ValueError("Could not parse SSH private key (unsupported key type)")
        kwargs["pkey"] = pkey
    elif server.ssh_password:
        kwargs["password"] = server.ssh_password
    else:
        raise RuntimeError("No SSH credentials configured for this server (no key, no password).")
    client.connect(**kwargs)
    return client


def _ssh_run(server: CloudPanelServer, command: str, _key_file: Optional[str] = None,
             timeout: int = 300) -> tuple[int, str, str]:
    """Run a command on the remote server via paramiko. Returns (exit_code, stdout, stderr)."""
    client = _make_paramiko_client(server)
    try:
        _, stdout_f, stderr_f = client.exec_command(command, timeout=timeout)
        exit_code = stdout_f.channel.recv_exit_status()
        return exit_code, stdout_f.read().decode(errors="replace"), stderr_f.read().decode(errors="replace")
    finally:
        client.close()


@contextlib.contextmanager
def _server_key_file(server: Optional[CloudPanelServer]):
    """Legacy context manager kept for call-site compatibility — yields None (paramiko handles keys)."""
    yield None


# ── CloudPanel site listing ───────────────────────────────────────────────────

def fetch_cloudpanel_sites(server: CloudPanelServer) -> list:
    """
    SSH into a CloudPanel server and query its SQLite DB to list all sites.
    Tries multiple known DB paths automatically.
    Returns list of dicts: {domain, path, user}.
    """
    candidates_repr = repr(_CLOUDPANEL_DB_CANDIDATES)
    query_cmd = (
        f"python3 -c '"
        f"import sqlite3,json,os,sys;"
        f"c={candidates_repr};"
        f"db=next((p for p in c if os.path.exists(p)),None);"
        f"sys.stderr.write(\"CloudPanel DB not found in \"+str(c)+\"\\n\") or sys.exit(1) if not db else None;"
        f"cur=sqlite3.connect(db).cursor();"
        f"cur.execute(\"SELECT domain_name,root_directory,user FROM site WHERE deleted=0 ORDER BY domain_name\");"
        f"print(json.dumps([{{\"domain\":r[0],\"path\":r[1],\"user\":r[2]}} for r in cur.fetchall()]))"
        f"'"
    )
    with _server_key_file(server) as kf:
        rc, out, err = _ssh_run(server, query_cmd, kf, timeout=15)

    if rc != 0:
        raise RuntimeError(f"SSH query failed (exit {rc}): {err.strip()}")

    try:
        return json.loads(out.strip())
    except json.JSONDecodeError as e:
        raise RuntimeError(f"Could not parse CloudPanel response: {e}\nOutput: {out[:500]}")


# ── Git helpers ───────────────────────────────────────────────────────────────

def _build_https_url(repo_url: str, access_token: str) -> str:
    if "://" in repo_url:
        scheme, rest = repo_url.split("://", 1)
        return f"{scheme}://{access_token}@{rest}"
    return repo_url


def git_pull_or_clone(repo: CICDRepo, server: Optional[CloudPanelServer] = None) -> str:
    if server:
        return _git_remote(repo, server)
    return _git_local(repo)


def _git_local(repo: CICDRepo) -> str:
    local = Path(repo.local_path)
    env = os.environ.copy()
    ssh_key_file: Optional[str] = None
    try:
        if repo.auth_type == "ssh" and repo.ssh_private_key:
            fd, ssh_key_file = tempfile.mkstemp(prefix="cicd_ssh_", suffix=".pem")
            os.write(fd, repo.ssh_private_key.encode())
            os.close(fd)
            os.chmod(ssh_key_file, 0o600)
            env["GIT_SSH_COMMAND"] = f"ssh -i {ssh_key_file} -o StrictHostKeyChecking=no -o BatchMode=yes"
            clone_url = repo.repo_url
        elif repo.auth_type == "https" and repo.access_token:
            clone_url = _build_https_url(repo.repo_url, repo.access_token)
        else:
            clone_url = repo.repo_url

        output_parts = []
        git_dot = local / ".git"
        if git_dot.exists():
            for cmd, label in [
                (["git", "-C", str(local), "fetch", "origin", repo.branch], f"git fetch origin {repo.branch}"),
                (["git", "-C", str(local), "reset", "--hard", f"origin/{repo.branch}"], f"git reset --hard origin/{repo.branch}"),
            ]:
                result = subprocess.run(cmd, capture_output=True, text=True, env=env, timeout=300)
                output_parts.append(f"$ {label}\n{result.stdout}{result.stderr}")
                if result.returncode != 0:
                    raise RuntimeError(f"{label} failed (exit {result.returncode}):\n{result.stderr}")
        else:
            local.mkdir(parents=True, exist_ok=True)
            result = subprocess.run(
                ["git", "clone", "--branch", repo.branch, "--single-branch", clone_url, str(local)],
                capture_output=True, text=True, env=env, timeout=300,
            )
            output_parts.append(f"$ git clone ...\n{result.stdout}{result.stderr}")
            if result.returncode != 0:
                raise RuntimeError(f"git clone failed (exit {result.returncode}):\n{result.stderr}")
        return "\n".join(output_parts)
    finally:
        if ssh_key_file and os.path.exists(ssh_key_file):
            os.unlink(ssh_key_file)


def _git_remote(repo: CICDRepo, server: CloudPanelServer) -> str:
    local = repo.local_path
    branch = repo.branch

    if repo.auth_type == "ssh" and repo.ssh_private_key:
        escaped_key = repo.ssh_private_key.replace("'", "'\\''")
        git_script = (
            f"GIT_KEY=$(mktemp) && chmod 600 \"$GIT_KEY\" && "
            f"printf '%s' '{escaped_key}' > \"$GIT_KEY\" && "
            f"export GIT_SSH_COMMAND=\"ssh -i $GIT_KEY -o StrictHostKeyChecking=no -o BatchMode=yes\" && "
            f"if [ -d '{local}/.git' ]; then "
            f"  git -C '{local}' fetch origin {branch} && git -C '{local}' reset --hard origin/{branch}; "
            f"else mkdir -p '{local}' && git clone --branch {branch} --single-branch '{repo.repo_url}' '{local}'; fi; "
            f"EC=$?; rm -f \"$GIT_KEY\"; exit $EC"
        )
    elif repo.auth_type == "https" and repo.access_token:
        clone_url = _build_https_url(repo.repo_url, repo.access_token)
        git_script = (
            f"if [ -d '{local}/.git' ]; then "
            f"  git -C '{local}' fetch origin {branch} && git -C '{local}' reset --hard origin/{branch}; "
            f"else mkdir -p '{local}' && git clone --branch {branch} --single-branch '{clone_url}' '{local}'; fi"
        )
    else:
        git_script = (
            f"if [ -d '{local}/.git' ]; then "
            f"  git -C '{local}' fetch origin {branch} && git -C '{local}' reset --hard origin/{branch}; "
            f"else mkdir -p '{local}' && git clone --branch {branch} --single-branch '{repo.repo_url}' '{local}'; fi"
        )

    with _server_key_file(server) as kf:
        rc, out, err = _ssh_run(server, git_script, kf, timeout=300)

    if rc != 0:
        raise RuntimeError(f"git failed on {server.host} (exit {rc}):\n{err}")
    return f"$ git pull/clone on {server.host}\n{out}{err}"


# ── Script execution ──────────────────────────────────────────────────────────

def run_scripts(repo: CICDRepo, deployment: CICDDeployment, db: Session,
                server: Optional[CloudPanelServer] = None) -> list:
    scripts_dir = f"{repo.local_path}/scripts"

    if server:
        with _server_key_file(server) as kf:
            rc, out, _ = _ssh_run(server, f"ls '{scripts_dir}'/*.sh 2>/dev/null | sort", kf)
        if rc != 0 or not out.strip():
            return []
        script_names = sorted([Path(f.strip()).name for f in out.splitlines() if f.strip()])
    else:
        sd = Path(repo.local_path) / "scripts"
        if not sd.is_dir():
            return []
        script_names = [p.name for p in sorted(sd.glob("*.sh"))]

    already_run = {
        row.script_filename
        for row in db.query(CICDScriptLog.script_filename)
        .filter(CICDScriptLog.repo_id == repo.id).all()
    }

    logs = []
    for fname in script_names:
        if fname in already_run:
            continue
        try:
            if server:
                with _server_key_file(server) as kf:
                    rc, out, err = _ssh_run(server, f"bash '{scripts_dir}/{fname}'", kf, timeout=600)
                exit_code, stdout, stderr = rc, out[:50_000], err[:50_000]
            else:
                result = subprocess.run(
                    ["bash", str(Path(repo.local_path) / "scripts" / fname)],
                    capture_output=True, text=True, cwd=repo.local_path, timeout=600,
                )
                exit_code, stdout, stderr = result.returncode, result.stdout[:50_000], result.stderr[:50_000]
        except subprocess.TimeoutExpired:
            exit_code, stdout, stderr = -1, "", "Script timed out after 600 seconds."
        except Exception as exc:
            exit_code, stdout, stderr = -1, "", str(exc)

        log = CICDScriptLog(
            repo_id=repo.id, deployment_id=deployment.id, script_filename=fname,
            exit_code=exit_code, stdout=stdout, stderr=stderr, executed_at=datetime.utcnow(),
        )
        db.add(log)
        db.flush()
        logs.append(log)
    return logs


# ── Migration execution ───────────────────────────────────────────────────────

def run_migrations(repo: CICDRepo, deployment: CICDDeployment, db: Session,
                   server: Optional[CloudPanelServer] = None) -> list:
    database_dir = f"{repo.local_path}/database"
    db_type = repo.db_type or "postgres"
    db_host = repo.db_host or "localhost"
    default_port = 3306 if db_type == "mysql" else 5432
    db_port = repo.db_port or default_port

    if server:
        with _server_key_file(server) as kf:
            rc, csv_content, _ = _ssh_run(server, f"cat '{database_dir}/db.csv' 2>/dev/null", kf)
        if rc != 0 or not csv_content.strip():
            return []
    else:
        csv_file = Path(repo.local_path) / "database" / "db.csv"
        if not csv_file.exists():
            return []
        csv_content = csv_file.read_text()

    db_names = [n for line in csv_content.splitlines() for n in (p.strip() for p in line.split(",")) if n]
    if not db_names:
        return []

    if server:
        with _server_key_file(server) as kf:
            rc, out, _ = _ssh_run(server, f"ls '{database_dir}'/*.sql 2>/dev/null | sort", kf)
        sql_files = sorted([Path(f.strip()).name for f in out.splitlines() if f.strip()])
    else:
        sql_files = sorted([p.name for p in (Path(repo.local_path) / "database").glob("*.sql")])

    if not sql_files:
        return []

    logs = []
    for db_name in db_names:
        already_run = {
            row.sql_filename
            for row in db.query(CICDMigrationLog.sql_filename)
            .filter(
                CICDMigrationLog.repo_id == repo.id,
                CICDMigrationLog.database_name == db_name,
                CICDMigrationLog.status == "success",
            ).all()
        }
        for fname in sql_files:
            if fname in already_run:
                continue
            sql_path = f"{database_dir}/{fname}"
            mig_status = "success"
            mig_error: Optional[str] = None
            try:
                # Build the CLI command based on db_type
                if db_type == "mysql":
                    cli_cmd = f"mysql -h {db_host} -P {db_port} '{db_name}' < '{sql_path}' 2>&1"
                    local_args = ["mysql", "-h", db_host, "-P", str(db_port), db_name]
                else:
                    cli_cmd = f"psql -h {db_host} -p {db_port} -d '{db_name}' -f '{sql_path}' 2>&1"
                    local_args = ["psql", "-h", db_host, "-p", str(db_port), "-d", db_name,
                                  "-f", str(Path(repo.local_path) / "database" / fname)]

                if server:
                    with _server_key_file(server) as kf:
                        rc, out, err = _ssh_run(server, cli_cmd, kf, timeout=120)
                    if rc != 0:
                        mig_status = "failed"
                        mig_error = (out + err)[:4000]
                else:
                    if db_type == "mysql":
                        # mysql reads SQL from stdin via '<'
                        sql_file_path = str(Path(repo.local_path) / "database" / fname)
                        with open(sql_file_path) as sql_f:
                            result = subprocess.run(
                                local_args, stdin=sql_f,
                                capture_output=True, text=True, timeout=120,
                            )
                    else:
                        result = subprocess.run(
                            local_args,
                            capture_output=True, text=True, timeout=120,
                        )
                    if result.returncode != 0:
                        mig_status = "failed"
                        mig_error = (result.stdout + result.stderr)[:4000]
            except Exception as exc:
                mig_status = "failed"
                mig_error = str(exc)[:4000]

            log = CICDMigrationLog(
                repo_id=repo.id, deployment_id=deployment.id,
                database_name=db_name, sql_filename=fname,
                status=mig_status, error=mig_error, executed_at=datetime.utcnow(),
            )
            db.add(log)
            db.flush()
            logs.append(log)
            if mig_status == "failed":
                break
    return logs


# ── Main deploy entry point ────────────────────────────────────────────────────

def deploy(repo_id: int, triggered_by: str, db: Session) -> CICDDeployment:
    repo = db.query(CICDRepo).filter(CICDRepo.id == repo_id).first()
    if not repo:
        raise ValueError(f"CICDRepo {repo_id} not found")

    server = db.query(CloudPanelServer).filter(CloudPanelServer.id == repo.server_id).first() if repo.server_id else None

    deployment = CICDDeployment(
        repo_id=repo_id, status="running",
        triggered_by=triggered_by, started_at=datetime.utcnow(),
    )
    db.add(deployment)
    db.commit()
    db.refresh(deployment)

    try:
        deployment.git_output = git_pull_or_clone(repo, server)
        run_scripts(repo, deployment, db, server)
        run_migrations(repo, deployment, db, server)
        deployment.status = "success"
    except Exception as exc:
        logger.error("CICD deploy repo %d failed: %s", repo_id, exc)
        deployment.status = "failed"
        deployment.error = str(exc)[:4000]
    finally:
        deployment.finished_at = datetime.utcnow()
        repo.last_deployed_at = datetime.utcnow()
        db.commit()
        db.refresh(deployment)

    return deployment
