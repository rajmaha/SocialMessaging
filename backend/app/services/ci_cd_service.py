# backend/app/services/ci_cd_service.py
"""
CI/CD deployment service.

Deployment order: git clone/pull → shell scripts (once) → SQL migrations (once per DB).

If a CloudPanelServer is attached to the repo, all commands run on that server via SSH.
Migrations run via `psql` (PostgreSQL) or `mysql` (MySQL) on the target server — no DB credentials required.
If no server is attached, everything runs locally.
"""
import contextlib
import shlex
import re
import threading
import time
import json
import logging
import os
import subprocess
import tempfile
from datetime import datetime, timedelta
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

# ── Cancelling a run ──────────────────────────────────────────────────────────
#
# A deploy runs in its own thread (routes/ci_cd.py), so there is nothing to
# signal and nothing to kill: a command that never returns leaves the row
# "running" for ever, and so does a backend restart mid-deploy. Two answers,
# both needed:
#
#   * Cancel closes the SSH channels this deployment is holding, which makes
#     the worker's current command fail, and raises the flag the worker checks
#     between steps.
#   * A run whose thread is gone (restart, crash) is reaped by age: nothing is
#     left claiming to be running that nobody is running.

_CANCELLED: set[int] = set()
_ACTIVE_CLIENTS: dict[int, list] = {}
_ACTIVE_LOCK = threading.Lock()
_CURRENT = threading.local()

STALE_DEPLOYMENT_MINUTES = int(os.environ.get("CICD_STALE_DEPLOYMENT_MINUTES", "30"))

# How long one SQL file may take on one database. A compiled migration is
# routinely megabytes of ALTERs, which is minutes on a live database, and the
# old two-minute cap cut the client off part way through the file.
MIGRATION_TIMEOUT_SECONDS = int(os.environ.get("CICD_MIGRATION_TIMEOUT_SECONDS", "900"))


class DeploymentCancelled(Exception):
    """Raised in the worker once someone pressed Cancel."""


def set_current_deployment(deployment_id: Optional[int]) -> None:
    """Tell this thread which deployment its SSH commands belong to."""
    _CURRENT.deployment_id = deployment_id


def _current_deployment_id() -> Optional[int]:
    return getattr(_CURRENT, "deployment_id", None)


def request_cancel(deployment_id: int) -> None:
    """Flag the run and drop its open SSH connections."""
    with _ACTIVE_LOCK:
        _CANCELLED.add(int(deployment_id))
        clients = list(_ACTIVE_CLIENTS.get(int(deployment_id), []))
    for client in clients:
        try:
            client.close()
        except Exception:
            pass


def is_cancelled(deployment_id: Optional[int]) -> bool:
    return deployment_id is not None and int(deployment_id) in _CANCELLED


def check_cancelled() -> None:
    if is_cancelled(_current_deployment_id()):
        raise DeploymentCancelled("Cancelled")


def clear_cancel(deployment_id: int) -> None:
    with _ACTIVE_LOCK:
        _CANCELLED.discard(int(deployment_id))
        _ACTIVE_CLIENTS.pop(int(deployment_id), None)


@contextlib.contextmanager
def _track_client(client):
    dep_id = _current_deployment_id()
    if dep_id is not None:
        with _ACTIVE_LOCK:
            _ACTIVE_CLIENTS.setdefault(int(dep_id), []).append(client)
    try:
        yield
    finally:
        if dep_id is not None:
            with _ACTIVE_LOCK:
                try:
                    _ACTIVE_CLIENTS.get(int(dep_id), []).remove(client)
                except ValueError:
                    pass


_STAGE_AVAILABLE = True


def _migration_outcome(rc: int, output: str):
    """
    What one migration did, read from the client's output rather than its
    exit code.

    mysql --force and psql both carry on past a failed statement and can still
    exit 0, so an exit code alone would report a file that refused half its
    statements as applied. Three answers:

      success  nothing complained
      partial  some statements failed, the rest of the file still ran
      failed   the client itself could not run (a refused login, no such
               database), so nothing in the file ran at all
    """
    errors = _sql_error_lines(output)
    joined = "\n".join(errors)
    if rc != 0:
        # mysql --force and psql both exit 0 when only STATEMENTS failed, so a
        # non-zero exit is the client itself giving up: a refused login, no
        # such database, an unreachable host. Nothing in the file ran.
        return "failed", (joined or output.strip() or f"the client exited {rc}")[:4000]
    if errors:
        return "partial", ("Some statements failed; the rest of the file still ran.\n"
                           + joined)[:4000]
    return "success", None


def _sql_error_lines(text: str) -> list:
    """
    The lines a SQL client printed that are actually errors.

    Everything else it prints is noise for this purpose: an idempotent
    migration guard ends in `SELECT "oms_gr.branch_id already present"`, whose
    result and column header are ordinary stdout, and reporting the first line
    of the capture named that harmless SELECT as the reason 7 databases failed.

    Covers mysql ("ERROR 1060 (42S21) at line 3: ...") and psql
    ("psql:file.sql:12: ERROR:  ...", "FATAL:  ...").
    """
    seen, out = set(), []
    for line in (text or "").splitlines():
        line = line.strip()
        if not line or line in seen:
            continue
        if re.match(r"^ERROR\s+\d+", line) or "ERROR:" in line or line.startswith("FATAL:"):
            seen.add(line)
            out.append(line)
    return out


def _store_log(db: Session, log, what: str) -> bool:
    """
    Commit one migration-log row on its own, and say whether it landed.

    The Migrations tab is the only record of what a deploy did to which
    database, so a row that cannot be stored is reported in the backend log
    rather than being lost behind the exception of the next statement.
    """
    try:
        db.commit()
        return True
    except Exception as exc:
        db.rollback()
        logger.error("CICD: could not store migration log (%s): %s", what, exc)
        return False


def set_stage(db: Session, deployment, text_: str) -> None:
    """
    Record what the run is doing, and commit it so the popup can see it.

    Reporting progress must never cost a deploy anything: where the column is
    missing (the app started before the inline migration added it) the first
    failure switches this off for the process instead of rolling back on every
    call. Call it only when nothing else is pending on the session.
    """
    global _STAGE_AVAILABLE
    if not _STAGE_AVAILABLE:
        return
    try:
        deployment.stage = text_[:200]
        db.commit()
    except Exception as exc:
        db.rollback()
        _STAGE_AVAILABLE = False
        logger.warning("CICD: cannot record deploy stage (%s); progress text disabled", exc)


def _close_running_migration_rows(db: Session, deployment_id: int, why: str) -> None:
    """A row left at "running" belongs to a run that is no longer going."""
    rows = (
        db.query(CICDMigrationLog)
        .filter(CICDMigrationLog.deployment_id == deployment_id, CICDMigrationLog.status == "running")
        .all()
    )
    for row in rows:
        row.status = "failed"
        row.error = ((row.error or "") + "\n" + why).strip()
    if rows:
        db.commit()


def close_running_migration_rows(db: Session, deployment_id: int, why: str) -> None:
    _close_running_migration_rows(db, deployment_id, why)


def reap_stale_deployments(db: Session, minutes: int = STALE_DEPLOYMENT_MINUTES) -> int:
    """
    Close off runs that claim to be running but are not: their thread died with
    the backend, or they outlived the limit. Returns how many were closed.
    """
    cutoff = datetime.utcnow() - timedelta(minutes=minutes)
    stale = (
        db.query(CICDDeployment)
        .filter(CICDDeployment.status == "running", CICDDeployment.started_at < cutoff)
        .all()
    )
    for dep in stale:
        _close_running_migration_rows(db, dep.id, "The deploy stopped before this finished.")
        dep.status = "failed"
        dep.error = (dep.error or "") + (
            f"\nStopped: still marked running after {minutes} minutes. The deploy "
            "was cancelled, the backend restarted, or a command on the server never returned."
        )
        dep.finished_at = datetime.utcnow()
        request_cancel(dep.id)
    if stale:
        db.commit()

    return len(stale)


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
    check_cancelled()
    client = _make_paramiko_client(server)
    try:
        with _track_client(client):
            _, stdout_f, stderr_f = client.exec_command(command, timeout=timeout)
            channel = stdout_f.channel
            # recv_exit_status() blocks for ever on a command that never ends,
            # and that is what leaves a deployment stuck at "running".
            deadline = time.monotonic() + timeout
            while not channel.exit_status_ready():
                if time.monotonic() > deadline:
                    channel.close()
                    return 124, "", f"Timed out after {timeout}s: {command[:200]}"
                if is_cancelled(_current_deployment_id()):
                    channel.close()
                    raise DeploymentCancelled("Cancelled")
                time.sleep(0.2)
            exit_code = channel.recv_exit_status()
            return exit_code, stdout_f.read().decode(errors="replace"), stderr_f.read().decode(errors="replace")
    except (OSError, EOFError, paramiko.SSHException):
        # Cancel closes the connection under us; anything else is a real fault.
        if is_cancelled(_current_deployment_id()):
            raise DeploymentCancelled("Cancelled")
        raise
    finally:
        try:
            client.close()
        except Exception:
            pass


@contextlib.contextmanager
def _server_key_file(server: Optional[CloudPanelServer]):
    """Legacy context manager kept for call-site compatibility — yields None (paramiko handles keys)."""
    yield None


# ── CloudPanel site listing ───────────────────────────────────────────────────

def fetch_cloudpanel_sites(server: CloudPanelServer) -> list:
    """
    SSH into a CloudPanel server and list all sites by parsing nginx vhost configs.
    Returns list of dicts: {domain, path, user}.
    """
    import base64
    script = (
        "import os, json, re\n"
        "sites = []\n"
        "conf_dir = '/etc/nginx/sites-enabled'\n"
        "if not os.path.isdir(conf_dir):\n"
        "    conf_dir = '/etc/nginx/conf.d'\n"
        "for fname in sorted(os.listdir(conf_dir)):\n"
        "    if not fname.endswith('.conf'):\n"
        "        continue\n"
        "    domain = fname[:-5]\n"
        "    try:\n"
        "        content = open(os.path.join(conf_dir, fname)).read()\n"
        "        m = re.search(r'root\\s+([^;]+);', content)\n"
        "        root = m.group(1).strip() if m else ''\n"
        "        parts = root.split('/')\n"
        "        user = parts[2] if len(parts) >= 3 and parts[1] == 'home' else ''\n"
        "        sites.append({'domain': domain, 'path': root, 'user': user})\n"
        "    except Exception:\n"
        "        pass\n"
        "print(json.dumps(sites))\n"
    )
    encoded = base64.b64encode(script.encode()).decode()
    query_cmd = f"echo {encoded} | base64 -d | python3"
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
            before = subprocess.run(["git", "-C", str(local), "rev-parse", "HEAD"],
                                    capture_output=True, text=True).stdout.strip()
            output_parts.append(_rescue_local_changes(str(local)))
            for cmd, label in [
                (["git", "-C", str(local), "fetch", "origin", repo.branch], f"git fetch origin {repo.branch}"),
                (["git", "-C", str(local), "reset", "--hard", f"origin/{repo.branch}"], f"git reset --hard origin/{repo.branch}"),
            ]:
                result = subprocess.run(cmd, capture_output=True, text=True, env=env, timeout=300)
                output_parts.append(f"$ {label}\n{result.stdout}{result.stderr}")
                if result.returncode != 0:
                    raise RuntimeError(f"{label} failed (exit {result.returncode}):\n{result.stderr}")
            output_parts.append(_deleted_file_report(str(local), before))
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


def _rescue_local_changes(local: str) -> str:
    """
    Keep anything edited on the server before `reset --hard` throws it away.

    `git stash create` writes a commit holding the tracked modifications and
    staged additions without touching the working tree, so this costs the
    deploy nothing; the tag is what makes it findable afterwards
    (`git stash list` does not show it). Untracked files are not included and
    do not need to be -- reset never deletes those.
    """
    dirty = subprocess.run(["git", "-C", local, "status", "--porcelain"],
                           capture_output=True, text=True).stdout.strip()
    if not dirty:
        return ""
    sha = subprocess.run(["git", "-C", local, "stash", "create", "cicd rescue before reset"],
                         capture_output=True, text=True).stdout.strip()
    if not sha:
        return ""
    tag = "cicd-rescue-" + datetime.utcnow().strftime("%Y%m%d-%H%M%S")
    subprocess.run(["git", "-C", local, "tag", tag, sha], capture_output=True, text=True)
    count = len(dirty.splitlines())
    return (f"$ rescue\nLocal changes to {count} file(s) saved as tag {tag} "
            f"(restore with: git -C {local} checkout {tag} -- <path>)")


def _deleted_file_report(local: str, before: str) -> str:
    """
    Say what the pull REMOVED, which is the half of a deploy nobody watches.

    One upstream commit deleted 6,934 files here (an asset tree moved from
    v3.0 to v4.0) and the deploy reported only "Git pull completed", so the
    first anyone knew of it was a site with no stylesheets.
    """
    if not before:
        return ""
    after = subprocess.run(["git", "-C", local, "rev-parse", "HEAD"],
                           capture_output=True, text=True).stdout.strip()
    if not after or after == before:
        return ""
    gone = subprocess.run(
        ["git", "-C", local, "diff", "--name-only", "--diff-filter=D", before, after],
        capture_output=True, text=True).stdout.splitlines()
    if not gone:
        return ""
    folders: dict = {}
    for path in gone:
        key = "/".join(path.split("/")[:2])
        folders[key] = folders.get(key, 0) + 1
    top = sorted(folders.items(), key=lambda kv: -kv[1])[:10]
    lines = [f"$ deletions\nThis pull DELETED {len(gone)} file(s) (recover with: "
             f"git -C {local} checkout {before} -- <path>):"]
    lines += [f"  {count:>6}  {folder}/" for folder, count in top]
    return "\n".join(lines)


def _remote_pull_script(local: str, branch: str, clone_url: str) -> str:
    """
    The shell a server runs to bring a checkout to origin/<branch>.

    Two things happen around the reset, because `reset --hard` is the most
    destructive thing this tool does on somebody else's machine:

      * anything edited on the server is first parked in a tagged stash
        commit, without touching the working tree;
      * whatever the pull DELETED is printed with the commit to recover it
        from. One upstream commit deleted 6,934 files here -- an asset tree
        that moved from v3.0 to v4.0 -- and the deploy said only "Git pull
        completed", so the first anyone knew was a site with no stylesheets.
    """
    q = f"'{local}'"
    return (
        f"if [ -d '{local}/.git' ]; then "
        f"  BEFORE=$(git -C {q} rev-parse HEAD 2>/dev/null); "
        f"  if [ -n \"$(git -C {q} status --porcelain)\" ]; then "
        f"    R=$(git -C {q} stash create 'cicd rescue before reset'); "
        f"    if [ -n \"$R\" ]; then T=cicd-rescue-$(date -u +%Y%m%d-%H%M%S); "
        f"      git -C {q} tag \"$T\" \"$R\" >/dev/null 2>&1 && "
        f"      echo \"NOTE: local changes saved as tag $T (git -C {local} checkout $T -- <path>)\"; fi; "
        f"  fi; "
        f"  git -C {q} fetch origin {branch} && git -C {q} reset --hard origin/{branch} || exit 1; "
        f"  AFTER=$(git -C {q} rev-parse HEAD); "
        f"  if [ -n \"$BEFORE\" ] && [ \"$BEFORE\" != \"$AFTER\" ]; then "
        f"    N=$(git -C {q} diff --name-only --diff-filter=D \"$BEFORE\" \"$AFTER\" | wc -l); "
        f"    if [ \"$N\" -gt 0 ]; then "
        f"      echo \"NOTE: this pull DELETED $N file(s) "
        f"(recover: git -C {local} checkout $BEFORE -- <path>):\"; "
        f"      git -C {q} diff --name-only --diff-filter=D \"$BEFORE\" \"$AFTER\" "
        f"        | cut -d/ -f1-2 | sort | uniq -c | sort -rn | head -10; fi; "
        f"  fi; "
        f"else mkdir -p '{local}' && git clone --branch {branch} --single-branch '{clone_url}' '{local}'; fi"
    )


def _git_remote(repo: CICDRepo, server: CloudPanelServer) -> str:
    local = repo.local_path
    branch = repo.branch

    if repo.auth_type == "ssh" and repo.ssh_private_key:
        escaped_key = repo.ssh_private_key.replace("'", "'\\''")
        # trap, not a trailing rm: the pull below can exit early.
        git_script = (
            f"GIT_KEY=$(mktemp) && chmod 600 \"$GIT_KEY\" && "
            f"trap 'rm -f \"$GIT_KEY\"' EXIT && "
            f"printf '%s' '{escaped_key}' > \"$GIT_KEY\" && "
            f"export GIT_SSH_COMMAND=\"ssh -i $GIT_KEY -o StrictHostKeyChecking=no -o BatchMode=yes\" && "
            + _remote_pull_script(local, branch, repo.repo_url)
        )
    elif repo.auth_type == "https" and repo.access_token:
        git_script = _remote_pull_script(local, branch, _build_https_url(repo.repo_url, repo.access_token))
    else:
        git_script = _remote_pull_script(local, branch, repo.repo_url)

    with _server_key_file(server) as kf:
        rc, out, err = _ssh_run(server, git_script, kf, timeout=300)

    if rc != 0:
        raise RuntimeError(f"git failed on {server.host} (exit {rc}):\n{err}")
    return f"$ git pull/clone on {server.host}\n{out}{err}"


# ── Custom bash script execution ─────────────────────────────────────────────

def run_custom_bash_script(repo: CICDRepo, server: Optional[CloudPanelServer] = None) -> str:
    """Run the user-supplied bash_script content after git pull. Returns combined output."""
    import base64 as _b64
    script = (repo.bash_script or "").strip()
    if not script:
        return ""

    if server:
        encoded = _b64.b64encode(script.encode()).decode()
        cmd = f"cd '{repo.local_path}' && echo {encoded} | base64 -d | bash"
        rc, out, err = _ssh_run(server, cmd, timeout=600)
        output = f"{out}{err}"
        if rc != 0:
            raise RuntimeError(f"Custom bash script failed on {server.host} (exit {rc}):\n{output[:4000]}")
        return output
    else:
        fd, tmp = tempfile.mkstemp(prefix="cicd_custom_", suffix=".sh")
        try:
            os.write(fd, script.encode())
            os.close(fd)
            os.chmod(tmp, 0o700)
            result = subprocess.run(
                ["bash", tmp],
                capture_output=True, text=True, cwd=repo.local_path, timeout=600,
            )
            output = result.stdout + result.stderr
            if result.returncode != 0:
                raise RuntimeError(f"Custom bash script failed (exit {result.returncode}):\n{output[:4000]}")
            return output
        finally:
            if os.path.exists(tmp):
                os.unlink(tmp)


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
        db.commit()
        logs.append(log)
    return logs


# ── Domain → DB name resolver (nginx + db.php) ────────────────────────────────

def _nginx_conf_dir(server: CloudPanelServer) -> str:
    """Return the nginx vhost config directory on the server."""
    rc, out, _ = _ssh_run(server, "test -d /etc/nginx/sites-enabled && echo sites-enabled || echo conf.d", timeout=10)
    return f"/etc/nginx/{out.strip() or 'sites-enabled'}"


def _db_login_from_site_root(root: str, server: CloudPanelServer) -> Optional[dict]:
    """
    Read a CodeIgniter db.php and return that site's own database login.

    The site already holds a user that can write to exactly its own database,
    so the migrations run as that user and nothing needs a shared root
    password. Without this the client is run bare and CloudPanel's MySQL
    answers "Access denied for user 'root'@'localhost' (using password: NO)".

    Returns {"database", "username", "password", "hostname"} or None.
    """
    rc, out, _ = _ssh_run(
        server,
        f"grep -E \"'(database|username|password|hostname)'[[:space:]]*=>\" '{root}/db.php' 2>/dev/null",
        timeout=10,
    )
    if rc != 0 or not out.strip():
        return None
    login = {}
    for key in ("database", "username", "password", "hostname"):
        # The value may be single- or double-quoted; take the first hit, which
        # is $db['default'] in every tree here.
        m = re.search(r"'%s'\s*=>\s*(['\"])(.*?)\1" % key, out)
        if m:
            login[key] = m.group(2)
    return login if login.get("database") else None


def _db_name_from_site_root(root: str, server: CloudPanelServer) -> Optional[str]:
    """The database name alone, for callers that do not want the login."""
    login = _db_login_from_site_root(root, server)
    return login["database"] if login else None


def _resolve_domain_db_names(domain_pattern: str, server: CloudPanelServer,
                             logins: Optional[dict] = None) -> list[str]:
    """
    Resolve a domain or wildcard pattern to real DB names via nginx configs + db.php.
      "example.com"   → exact nginx vhost match → reads db.php for DB name
      "*.example.com" → all vhosts matching *.example.com → reads each db.php
    Returns a (possibly empty) list of database names.
    """
    conf_dir = _nginx_conf_dir(server)
    results: list[str] = []

    if domain_pattern.startswith("*."):
        parent = domain_pattern[2:]  # "saraloms.com"
        # List all .conf files whose domain ends with .parent (subdomains only)
        rc, out, _ = _ssh_run(
            server,
            f"ls '{conf_dir}'/*.conf 2>/dev/null | grep -v '/default.conf$'",
            timeout=10,
        )
        if rc != 0 or not out.strip():
            return []
        for conf_path in out.splitlines():
            conf_path = conf_path.strip()
            domain = Path(conf_path).stem  # strip .conf
            if not domain.endswith(f".{parent}"):
                continue
            rc2, root_out, _ = _ssh_run(
                server,
                f"grep -m1 'root ' '{conf_path}' | awk '{{print $2}}' | tr -d ';'",
                timeout=10,
            )
            root = root_out.strip()
            if not root:
                continue
            login = _db_login_from_site_root(root, server)
            if login:
                results.append(login["database"])
                if logins is not None:
                    logins.setdefault(login["database"], login)
    else:
        # Exact domain
        conf_path = f"{conf_dir}/{domain_pattern}.conf"
        rc, root_out, _ = _ssh_run(
            server,
            f"grep -m1 'root ' '{conf_path}' 2>/dev/null | awk '{{print $2}}' | tr -d ';'",
            timeout=10,
        )
        root = root_out.strip()
        if root:
            login = _db_login_from_site_root(root, server)
            if login:
                results.append(login["database"])
                if logins is not None:
                    logins.setdefault(login["database"], login)

    return results


def _is_domain_pattern(entry: str) -> bool:
    """Return True if the CSV entry looks like a domain or wildcard domain rather than a DB name."""
    return "." in entry and " " not in entry


def _expand_db_names(raw_names: list[str], server: Optional[CloudPanelServer],
                     logins: Optional[dict] = None) -> list[str]:
    """
    Expand any domain/wildcard entries to real DB names via CloudPanel.
    Plain DB names (no dot) pass through unchanged.
    Requires a server; domain entries without a server are skipped with a warning.
    """
    result: list[str] = []
    seen: set[str] = set()

    for entry in raw_names:
        if not _is_domain_pattern(entry):
            if entry not in seen:
                seen.add(entry)
                result.append(entry)
            continue

        if server is None:
            logger.warning("db.csv entry %r looks like a domain but no server is attached — skipping", entry)
            continue

        resolved = _resolve_domain_db_names(entry, server, logins)
        if not resolved:
            logger.warning("No CloudPanel databases found for domain pattern %r", entry)
        for name in resolved:
            if name not in seen:
                seen.add(name)
                result.append(name)

    return result


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

    raw_names = [n for line in csv_content.splitlines() for n in (p.strip() for p in line.split(",")) if n]
    # A wildcard in db.csv is resolved over SSH, two commands per site, and
    # that used to happen with nothing on screen at all.
    set_stage(db, deployment, f"Finding databases for {', '.join(raw_names)[:120]}")
    # Each resolved site hands back its own db.php login, used below where the
    # repo names no database user of its own.
    site_logins: dict = {}
    db_names = _expand_db_names(raw_names, server, site_logins)
    if not db_names:
        return []

    # SQL files are read from database/migration/ when the repo has that folder,
    # and from database/ itself otherwise -- the layout this guide documents and
    # other repos still use. db.csv stays in database/ either way. Only files
    # directly in the folder are run: subfolders (backups, seeds, setup dumps)
    # are never treated as migrations.
    if server:
        with _server_key_file(server) as kf:
            rc, _, _ = _ssh_run(server, f"test -d '{database_dir}/migration'", kf)
        migration_dir = f"{database_dir}/migration" if rc == 0 else database_dir
        with _server_key_file(server) as kf:
            rc, out, _ = _ssh_run(server, f"ls '{migration_dir}'/*.sql 2>/dev/null | sort", kf)
        sql_files = sorted([Path(f.strip()).name for f in out.splitlines() if f.strip()])
    else:
        local_migration = Path(repo.local_path) / "database" / "migration"
        local_sql_dir = local_migration if local_migration.is_dir() else Path(repo.local_path) / "database"
        migration_dir = str(local_sql_dir)
        sql_files = sorted([p.name for p in local_sql_dir.glob("*.sql")])

    if not sql_files:
        return []

    logs = []
    set_stage(db, deployment, f"{len(sql_files)} file(s) over {len(db_names)} database(s)")
    for position, db_name in enumerate(db_names, start=1):
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
            check_cancelled()
            sql_path = f"{migration_dir}/{fname}"
            # The row is written before the file runs, so the deploy popup can
            # say which database is being migrated right now: a compiled
            # migration is minutes per database, and a screen that says nothing
            # for half an hour reads as a hang.
            log = CICDMigrationLog(
                repo_id=repo.id, deployment_id=deployment.id,
                database_name=db_name, sql_filename=fname,
                status="running", executed_at=datetime.utcnow(),
            )
            db.add(log)
            # Stored BEFORE the stage is touched. set_stage() commits on this
            # same session and rolls back when it cannot (an older database
            # without the stage column), and that rollback would throw away
            # this row -- the run then counted migrations that the Migrations
            # tab never showed.
            _store_log(db, log, f"{db_name}/{fname} started")
            set_stage(db, deployment, f"Migrating {db_name} ({position}/{len(db_names)}): {fname}")
            mig_status = "success"
            mig_error: Optional[str] = None
            try:
                # Build the CLI command based on db_type. The login is the
                # repo's when it has one; without it the client is run bare,
                # which only works where the SSH user has passwordless local
                # access -- CloudPanel's MySQL answers "Access denied for user
                # 'root'@'localhost' (using password: NO)". The password goes
                # through the environment, never the command line, so it is not
                # in `ps` on the server.
                # The repo's own login wins where one is set; otherwise the
                # site's own db.php login is used, which can always write to
                # exactly that database. Run bare, CloudPanel's MySQL answers
                # "Access denied for user 'root'@'localhost' (using password:
                # NO)" and nothing is applied.
                db_user = (repo.db_user or "").strip()
                db_password = repo.db_password or ""
                if not db_user:
                    site_login = site_logins.get(db_name) or {}
                    db_user = (site_login.get("username") or "").strip()
                    db_password = site_login.get("password") or ""
                local_env = dict(os.environ)
                if db_type == "mysql":
                    prefix = f"MYSQL_PWD={shlex.quote(db_password)} " if db_password else ""
                    user_arg = f"-u {shlex.quote(db_user)} " if db_user else ""
                    # --force: one refused statement does not abandon the rest
                    # of the file. A compiled migration is hundreds of
                    # independent sections, and stopping at the first one that
                    # a database has already had leaves the other 200 unrun.
                    # It exits 0 even when statements failed, so what actually
                    # happened is read out of the output below -- never from
                    # the exit code alone.
                    cli_cmd = (f"{prefix}mysql --force -h {shlex.quote(db_host)} -P {db_port} {user_arg}"
                               f"{shlex.quote(db_name)} < {shlex.quote(sql_path)} 2>&1")
                    local_args = ["mysql", "--force", "-h", db_host, "-P", str(db_port)]
                    if db_user:
                        local_args += ["-u", db_user]
                    local_args.append(db_name)
                    if db_password:
                        local_env["MYSQL_PWD"] = db_password
                else:
                    prefix = f"PGPASSWORD={shlex.quote(db_password)} " if db_password else ""
                    user_arg = f"-U {shlex.quote(db_user)} " if db_user else ""
                    cli_cmd = (f"{prefix}psql -h {shlex.quote(db_host)} -p {db_port} {user_arg}"
                               f"-d {shlex.quote(db_name)} -f {shlex.quote(sql_path)} 2>&1")
                    local_args = ["psql", "-h", db_host, "-p", str(db_port)]
                    if db_user:
                        local_args += ["-U", db_user]
                    local_args += ["-d", db_name, "-f", str(Path(migration_dir) / fname)]
                    if db_password:
                        local_env["PGPASSWORD"] = db_password

                if server:
                    with _server_key_file(server) as kf:
                        rc, out, err = _ssh_run(server, cli_cmd, kf, timeout=MIGRATION_TIMEOUT_SECONDS)
                    mig_status, mig_error = _migration_outcome(rc, out + err)
                else:
                    if db_type == "mysql":
                        # mysql reads SQL from stdin via '<'
                        sql_file_path = str(Path(migration_dir) / fname)
                        with open(sql_file_path) as sql_f:
                            result = subprocess.run(
                                local_args, stdin=sql_f, env=local_env,
                                capture_output=True, text=True, timeout=MIGRATION_TIMEOUT_SECONDS,
                            )
                    else:
                        result = subprocess.run(
                            local_args, env=local_env,
                            capture_output=True, text=True, timeout=MIGRATION_TIMEOUT_SECONDS,
                        )
                    mig_status, mig_error = _migration_outcome(
                        result.returncode, result.stdout + result.stderr)
            except Exception as exc:
                mig_status = "failed"
                mig_error = str(exc)[:4000]

            log.status = mig_status
            log.error = mig_error
            log.executed_at = datetime.utcnow()
            # Committed one at a time, not once at the end: until this commit
            # the Migrations tab and the popup show nothing at all.
            _store_log(db, log, f"{db_name}/{fname} {mig_status}")
            logs.append(log)
            if mig_status == "failed":
                break
    return logs


def migration_failure_summary(logs: list) -> Optional[str]:
    """
    What went wrong, one line per migration, for the deployment's error.

    Two kinds, and the difference matters to whoever reads it: `failed` means
    the client never ran the file (a refused login, no such database), while
    `partial` means the file ran and some statements inside it were refused.
    A deploy whose SQL never reached the databases used to finish green, so
    "13 migrations" read as "13 applied" when every one had been refused.
    """
    failed = [lg for lg in logs if lg.status == "failed"]
    partial = [lg for lg in logs if lg.status == "partial"]
    if not failed and not partial:
        return None

    def _reason(lg) -> str:
        for line in (lg.error or "").splitlines():
            line = line.strip()
            if re.match(r"^ERROR\s+\d+", line) or "ERROR:" in line or line.startswith("FATAL:"):
                return line
        first = (lg.error or "").strip().splitlines()
        return first[0] if first else "no output"

    lines = []
    if failed:
        lines.append(f"{len(failed)} of {len(logs)} migration(s) could not run:")
        for lg in failed[:10]:
            lines.append(f"  {lg.database_name} / {lg.sql_filename}: {_reason(lg)}")
        if len(failed) > 10:
            lines.append(f"  ... and {len(failed) - 10} more")
    if partial:
        lines.append(f"{len(partial)} of {len(logs)} migration(s) had failing statements "
                     f"(the rest of each file still ran):")
        for lg in partial[:10]:
            lines.append(f"  {lg.database_name} / {lg.sql_filename}: {_reason(lg)}")
        if len(partial) > 10:
            lines.append(f"  ... and {len(partial) - 10} more")

    return "\n".join(lines)[:4000]


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

    set_current_deployment(deployment.id)
    try:
        set_stage(db, deployment, "Pulling from git")
        git_out = git_pull_or_clone(repo, server)
        check_cancelled()
        set_stage(db, deployment, "Running the custom script")
        custom_out = run_custom_bash_script(repo, server)
        deployment.git_output = git_out + ("\n\n--- Custom Script ---\n" + custom_out if custom_out else "")
        check_cancelled()
        if repo.run_default_scripts:
            set_stage(db, deployment, "Running scripts/")
            run_scripts(repo, deployment, db, server)
        check_cancelled()
        set_stage(db, deployment, "Reading database/db.csv")
        mig_logs = run_migrations(repo, deployment, db, server)
        mig_error = migration_failure_summary(mig_logs)
        if mig_error:
            deployment.status = "failed"
            deployment.error = mig_error
        else:
            deployment.status = "success"
    except DeploymentCancelled:
        deployment.status = "failed"
        deployment.error = "Cancelled."
    except Exception as exc:
        logger.error("CICD deploy repo %d failed: %s", repo_id, exc)
        deployment.status = "failed"
        deployment.error = str(exc)[:4000]
    finally:
        clear_cancel(deployment.id)
        set_current_deployment(None)
        deployment.stage = None
        deployment.finished_at = datetime.utcnow()
        repo.last_deployed_at = datetime.utcnow()
        db.commit()
        db.refresh(deployment)

    return deployment
