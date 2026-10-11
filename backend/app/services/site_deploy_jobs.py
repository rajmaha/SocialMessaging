"""Site deployments run as background jobs that the browser polls.

A deployment used to be one long streamed (SSE) response. That worked under
`next dev` but not in Docker / Coolify: something on the way (Next's
production server or the reverse proxy) held the stream back until it ended,
so the deploy screen showed only the first and the last step. CI/CD Deploy
never had the problem because it runs in the background and the page asks for
its state every couple of seconds -- each answer is a short, complete
response that nothing buffers. This module gives site deployments the same
shape:

    job_id = start(owner_id, events_factory)   # returns at once
    poll(job_id, owner_id, after)              # events since `after`

`events_factory(db)` is called in a worker thread with a session of its own
(the request's session is closed once the start request has answered) and
yields event dicts -- the same ones the SSE endpoints send.

Jobs live in this process's memory. The backend runs one gunicorn worker
(backend/Dockerfile), so the poll always reaches the process holding the job;
with several workers this would need a table instead. A restart loses jobs in
flight, which also stops the deployment itself. Finished jobs are forgotten
after JOB_TTL.
"""
import logging
import threading
import time
import uuid
from typing import Callable, Iterable, Optional

from app.database import SessionLocal

logger = logging.getLogger(__name__)

JOB_TTL = 6 * 3600  # seconds a finished job stays readable

_jobs: dict = {}
_lock = threading.Lock()


def _prune(now: float) -> None:
    for jid in [j for j, job in _jobs.items()
                if job["finished_at"] and now - job["finished_at"] > JOB_TTL]:
        _jobs.pop(jid, None)


def start(owner_id: int, events_factory: Callable[..., Iterable[dict]],
          success_step: str = "complete") -> str:
    """Run the deployment in a thread; return its job id at once.

    The job succeeds when an event whose step is `success_step` arrives, and
    fails on a step "error" event, an exception, or the events running out
    without either.
    """
    job_id = uuid.uuid4().hex
    now = time.time()
    with _lock:
        _prune(now)
        _jobs[job_id] = {
            "owner_id": owner_id,
            "status": "running",
            "events": [],
            "error": None,
            "started_at": now,
            "finished_at": None,
        }

    def _emit(ev: dict) -> None:
        with _lock:
            _jobs[job_id]["events"].append(ev)

    def _finish(status: str, error: Optional[str] = None) -> None:
        with _lock:
            job = _jobs[job_id]
            job["status"] = status
            job["error"] = error
            job["finished_at"] = time.time()

    def _run() -> None:
        db = SessionLocal()
        succeeded = False
        try:
            for ev in events_factory(db):
                _emit(ev)
                if ev.get("step") == "error":
                    _finish("failed", ev.get("message") or "Deployment failed.")
                    return
                if ev.get("step") == success_step:
                    succeeded = True
            if succeeded:
                _finish("success")
            else:
                _finish("failed", "The deployment ended without finishing.")
        except Exception as e:  # never leave a job "running" for ever
            logger.exception("Site deploy job %s failed", job_id)
            _emit({"step": "error", "status": "error", "message": str(e)})
            _finish("failed", str(e))
        finally:
            db.close()

    threading.Thread(target=_run, name=f"site-deploy-{job_id[:8]}", daemon=True).start()
    return job_id


def poll(job_id: str, owner_id: int, after: int = 0) -> Optional[dict]:
    """The events since `after` and the job's state; None if no such job for
    this user (another user's job reads as missing, never as forbidden)."""
    with _lock:
        job = _jobs.get(job_id)
        if not job or job["owner_id"] != owner_id:
            return None
        after = max(0, after)
        events = job["events"][after:]
        return {
            "status": job["status"],
            "error": job["error"],
            "events": events,
            "next": after + len(events),
            "elapsed": round((job["finished_at"] or time.time()) - job["started_at"]),
        }
