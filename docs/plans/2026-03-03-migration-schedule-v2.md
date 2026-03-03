# Migration Schedule v2 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the `interval_minutes` schedule with a structured one-time/recurring schedule that supports a specific date+time (or weekly day+time), auto-sends a notification email to a configurable recipient list before the migration runs, and provides a manual re-send button.

**Architecture:** Alter `db_migration_schedules` with new columns. Update the model, schemas, service (add `send_migration_notification()`, update `_upsert_job` to use APScheduler `date`/`cron` triggers), and routes (add `POST .../notify`). Rewrite the `ScheduleRow` frontend component with a full schedule form.

**Design doc:** `docs/plans/2026-03-03-migration-schedule-v2-design.md`

**Tech Stack:** FastAPI, SQLAlchemy 2.0, APScheduler (date + cron triggers), smtplib (via existing email_service pattern), Next.js 14, TailwindCSS

---

## Task 1: Inline DB Schema Migration in main.py

The existing `db_migration_schedules` table has `interval_minutes`. We need to add new columns and drop the old one.

**Files:**
- Modify: `backend/main.py`

**Step 1: Find the existing `db_migration_schedules` CREATE TABLE block (around line 733) and add the ALTER TABLE statements immediately after the three CREATE TABLE blocks, before the `conn.commit()` that follows them.**

Add this block right after the CREATE TABLE for `db_migration_schedules` and before `conn.commit()`:

```python
        # v2: replace interval_minutes with structured schedule fields
        conn.execute(text("""
            ALTER TABLE db_migration_schedules
                ADD COLUMN IF NOT EXISTS schedule_type        VARCHAR   NOT NULL DEFAULT 'recurring',
                ADD COLUMN IF NOT EXISTS run_at               TIMESTAMPTZ,
                ADD COLUMN IF NOT EXISTS day_of_week          INTEGER,
                ADD COLUMN IF NOT EXISTS time_of_day          VARCHAR,
                ADD COLUMN IF NOT EXISTS notify_emails        TEXT,
                ADD COLUMN IF NOT EXISTS notify_hours_before  INTEGER   NOT NULL DEFAULT 24,
                ADD COLUMN IF NOT EXISTS status               VARCHAR   NOT NULL DEFAULT 'scheduled'
        """))
```

**Step 2: Verify the block looks correct**

Read back lines 730–755 of `backend/main.py` to confirm the ALTER TABLE is positioned before the `conn.commit()`.

**Step 3: Commit**

```bash
git add backend/main.py
git commit -m "feat: add schedule v2 columns to db_migration_schedules (schedule_type, run_at, day_of_week, time_of_day, notify_*)"
```

---

## Task 2: Update SQLAlchemy Model

**Files:**
- Modify: `backend/app/models/db_migration.py`

**Step 1: Replace `interval_minutes` with the new columns in `DbMigrationSchedule`**

The full updated class (replace the existing `DbMigrationSchedule` class entirely):

```python
class DbMigrationSchedule(Base):
    __tablename__ = "db_migration_schedules"

    id = Column(Integer, primary_key=True, index=True)
    server_id = Column(Integer, ForeignKey("cloudpanel_servers.id", ondelete="CASCADE"),
                       nullable=False, unique=True)
    schedule_type = Column(String, nullable=False, default="recurring")  # one_time / recurring
    run_at = Column(DateTime(timezone=True), nullable=True)              # one_time only
    day_of_week = Column(Integer, nullable=True)                         # recurring: 0=Mon…6=Sun
    time_of_day = Column(String, nullable=True)                          # "HH:MM" 24h
    notify_emails = Column(Text, nullable=True)                          # comma-separated
    notify_hours_before = Column(Integer, nullable=False, default=24)
    status = Column(String, nullable=False, default="scheduled")         # scheduled/notified/completed/disabled
    enabled = Column(Boolean, nullable=False, default=False)
    last_run_at = Column(DateTime(timezone=True), nullable=True)
```

**Step 2: Commit**

```bash
git add backend/app/models/db_migration.py
git commit -m "feat: update DbMigrationSchedule model with v2 schedule fields"
```

---

## Task 3: Update Pydantic Schemas

**Files:**
- Modify: `backend/app/schemas/db_migration.py`

**Step 1: Replace `DbMigrationScheduleUpsert` and `DbMigrationScheduleResponse`**

Replace the two classes entirely:

```python
class DbMigrationScheduleUpsert(BaseModel):
    schedule_type: str = "recurring"          # "one_time" or "recurring"
    run_at: Optional[datetime] = None         # one_time: exact UTC datetime
    day_of_week: Optional[int] = None         # recurring: 0=Mon…6=Sun
    time_of_day: Optional[str] = None         # "HH:MM" 24h, both types
    enabled: bool = False
    notify_emails: Optional[str] = None       # comma-separated
    notify_hours_before: int = 24


class DbMigrationScheduleResponse(BaseModel):
    id: int
    server_id: int
    schedule_type: str
    run_at: Optional[datetime] = None
    day_of_week: Optional[int] = None
    time_of_day: Optional[str] = None
    notify_emails: Optional[str] = None
    notify_hours_before: int
    status: str
    enabled: bool
    last_run_at: Optional[datetime] = None
    server_name: Optional[str] = None

    class Config:
        from_attributes = True
```

**Step 2: Commit**

```bash
git add backend/app/schemas/db_migration.py
git commit -m "feat: update migration schedule schemas for v2 (schedule_type, run_at, day_of_week, notify_*)"
```

---

## Task 4: Update Migration Service

Replace the APScheduler helpers and add a notification function.

**Files:**
- Modify: `backend/app/services/migration_service.py`

**Step 1: Add the `send_migration_notification` function**

Add this function after `_write_log` and before `run_server_migrations_job`:

```python
def send_migration_notification(server_id: int, db: Session) -> list:
    """
    Send a notification email to notify_emails for a server's schedule.
    Returns list of addresses emailed. Updates status to 'notified' for one_time schedules.
    """
    import smtplib
    from email.mime.text import MIMEText
    from email.mime.multipart import MIMEMultipart
    from app.services.branding_service import branding_service

    schedule = db.query(DbMigrationSchedule).filter(
        DbMigrationSchedule.server_id == server_id
    ).first()
    server = db.query(CloudPanelServer).filter(CloudPanelServer.id == server_id).first()

    if not schedule or not schedule.notify_emails or not server:
        return []

    recipients = [e.strip() for e in schedule.notify_emails.split(",") if e.strip()]
    if not recipients:
        return []

    # Build human-readable run time string
    if schedule.schedule_type == "one_time" and schedule.run_at:
        run_time_str = schedule.run_at.strftime("%Y-%m-%d at %H:%M UTC")
    elif schedule.time_of_day:
        days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
        day_name = days[schedule.day_of_week] if schedule.day_of_week is not None else "weekly"
        run_time_str = f"every {day_name} at {schedule.time_of_day} UTC"
    else:
        run_time_str = "as scheduled"

    # Collect affected domain suffixes from migrations targeting this server
    migrations = db.query(DbMigration).all()
    suffixes = sorted({m.domain_suffix for m in migrations if m.domain_suffix})
    scope_str = ", ".join(suffixes) if suffixes else "all sites"

    subject = f"Scheduled Database Maintenance — {server.name} — {run_time_str}"
    html_body = f"""
    <html>
    <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
        <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
            <h2 style="color: #2563eb;">Scheduled Database Maintenance Notice</h2>
            <p>This is an advance notice that a scheduled database maintenance will be performed on:</p>
            <table style="width:100%; border-collapse:collapse; margin: 16px 0;">
                <tr style="background:#f3f4f6;">
                    <td style="padding:10px; font-weight:bold; width:140px;">Server</td>
                    <td style="padding:10px;">{server.name}</td>
                </tr>
                <tr>
                    <td style="padding:10px; font-weight:bold;">Scheduled</td>
                    <td style="padding:10px;">{run_time_str}</td>
                </tr>
                <tr style="background:#f3f4f6;">
                    <td style="padding:10px; font-weight:bold;">Scope</td>
                    <td style="padding:10px;">{scope_str}</td>
                </tr>
            </table>
            <p>During this window your database may be briefly unavailable while migrations are applied.</p>
            <p>Thank you for your patience.</p>
            <hr style="border:none; border-top:1px solid #ddd; margin:30px 0;">
            <p style="font-size:12px; color:#999;">This is an automated message.</p>
        </div>
    </body>
    </html>
    """

    try:
        smtp_config = branding_service.get_smtp_config(db)
        if not smtp_config.get("smtp_password"):
            logger.info(f"Dev mode: migration notification would go to {recipients}")
            _mark_notified(db, schedule)
            return recipients

        msg = MIMEMultipart("alternative")
        msg["Subject"] = subject
        msg["From"] = smtp_config.get("smtp_from_email", "noreply@example.com")
        msg["To"] = ", ".join(recipients)
        msg.attach(MIMEText(html_body, "html"))

        with smtplib.SMTP(smtp_config["smtp_server"], smtp_config["smtp_port"]) as s:
            if smtp_config.get("smtp_use_tls", True):
                s.starttls()
            s.login(smtp_config["smtp_username"], smtp_config["smtp_password"])
            s.sendmail(smtp_config["smtp_from_email"], recipients, msg.as_string())

        logger.info(f"Migration notification sent to {recipients} for server {server_id}")
        _mark_notified(db, schedule)
        return recipients
    except Exception as e:
        logger.error(f"Failed to send migration notification for server {server_id}: {e}")
        return []


def _mark_notified(db: Session, schedule: DbMigrationSchedule):
    """Set status=notified for one_time schedules."""
    if schedule.schedule_type == "one_time":
        schedule.status = "notified"
        db.commit()
```

**Step 2: Add the APScheduler notification job wrapper**

Add this function after `send_migration_notification`:

```python
def send_migration_notification_job(server_id: int):
    """APScheduler-compatible wrapper for the notification email."""
    db = SessionLocal()
    try:
        send_migration_notification(server_id, db)
    except Exception as e:
        logger.error(f"Notification job error server={server_id}: {e}")
    finally:
        db.close()
```

**Step 3: Replace `_upsert_job` with a v2 version that supports both trigger types**

Replace the existing `_upsert_job` function:

```python
def _upsert_job(scheduler, server_id: int, schedule):
    """
    Register or replace APScheduler jobs for migration run + notification.
    `schedule` is a DbMigrationSchedule ORM object.
    """
    run_job_id = f"db_migration_server_{server_id}"
    notify_job_id = f"db_migration_notify_{server_id}"

    # Remove old jobs
    for jid in (run_job_id, notify_job_id):
        if scheduler.get_job(jid):
            scheduler.remove_job(jid)

    if not schedule.enabled:
        return

    if schedule.schedule_type == "one_time":
        if not schedule.run_at:
            logger.warning(f"one_time schedule for server {server_id} has no run_at — skipping")
            return
        # Migration run job
        scheduler.add_job(
            run_server_migrations_job,
            "date",
            run_date=schedule.run_at,
            id=run_job_id,
            args=[server_id],
        )
        # Notification job (fires notify_hours_before hours before)
        from datetime import timedelta
        notify_at = schedule.run_at - timedelta(hours=schedule.notify_hours_before or 24)
        from datetime import datetime as _dt, timezone as _tz
        if notify_at > _dt.now(_tz.utc):
            scheduler.add_job(
                send_migration_notification_job,
                "date",
                run_date=notify_at,
                id=notify_job_id,
                args=[server_id],
            )

    elif schedule.schedule_type == "recurring":
        if not schedule.time_of_day:
            logger.warning(f"recurring schedule for server {server_id} has no time_of_day — skipping")
            return
        hh, mm = map(int, schedule.time_of_day.split(":"))
        dow = schedule.day_of_week  # 0=Mon…6=Sun; None = every day

        # Migration run cron job
        scheduler.add_job(
            run_server_migrations_job,
            "cron",
            day_of_week=str(dow) if dow is not None else "*",
            hour=hh,
            minute=mm,
            id=run_job_id,
            args=[server_id],
        )

        # Notification cron job: notify_hours_before hours earlier
        notify_hours = schedule.notify_hours_before or 24
        from datetime import timedelta, datetime as _dt
        base = _dt(2000, 1, 1, hh, mm)
        notify_dt = base - timedelta(hours=notify_hours)
        notify_hh = notify_dt.hour
        notify_mm = notify_dt.minute
        notify_dow = dow  # APScheduler handles day rollover automatically for cron

        scheduler.add_job(
            send_migration_notification_job,
            "cron",
            day_of_week=str(notify_dow) if notify_dow is not None else "*",
            hour=notify_hh,
            minute=notify_mm,
            id=notify_job_id,
            args=[server_id],
        )
```

**Step 4: Update `register_migration_jobs` to pass the full schedule object**

Replace the existing `register_migration_jobs`:

```python
def register_migration_jobs(scheduler):
    """Load all enabled schedules from DB and register APScheduler jobs."""
    db = SessionLocal()
    try:
        schedules = db.query(DbMigrationSchedule).filter(
            DbMigrationSchedule.enabled == True
        ).all()
        for s in schedules:
            _upsert_job(scheduler, s.server_id, s)
        logger.info(f"Loaded {len(schedules)} migration schedule job(s)")
    except Exception as e:
        logger.warning(f"Could not load migration schedules: {e}")
    finally:
        db.close()
```

**Step 5: Update the `run_server_migrations` function to set `status = 'completed'` for one_time schedules**

At the end of `run_server_migrations`, just before `return summary`, replace the existing last_run_at block:

```python
    # Update last_run_at and status
    schedule = db.query(DbMigrationSchedule).filter(
        DbMigrationSchedule.server_id == server_id
    ).first()
    if schedule:
        schedule.last_run_at = datetime.utcnow()
        if schedule.schedule_type == "one_time":
            schedule.status = "completed"
        db.commit()
```

**Step 6: Update exports — add `send_migration_notification` and `send_migration_notification_job` to the public API**

No explicit `__all__` needed; just confirm the route imports will work (checked in Task 5).

**Step 7: Commit**

```bash
git add backend/app/services/migration_service.py
git commit -m "feat: migration service v2 — cron/date triggers, notification email, status tracking"
```

---

## Task 5: Update API Routes

**Files:**
- Modify: `backend/app/routes/db_migrations.py`

**Step 1: Update the `upsert_schedule` route imports**

Change the import from `migration_service`:

```python
from app.services.migration_service import (
    run_server_migrations, _upsert_job, remove_job, MIGRATION_DIR,
    send_migration_notification,
)
```

**Step 2: Update `list_schedules` to return new fields**

Replace the `list_schedules` body so the response uses the new fields. The `DbMigrationScheduleResponse` now includes them, so just make sure the default `DbMigrationScheduleResponse` for servers without a schedule row uses new defaults:

```python
@router.get("/schedules", response_model=List[DbMigrationScheduleResponse])
def list_schedules(
    db: Session = Depends(get_db),
    admin: User = Depends(require_cp),
):
    servers = db.query(CloudPanelServer).all()
    result = []
    for server in servers:
        schedule = db.query(DbMigrationSchedule).filter(
            DbMigrationSchedule.server_id == server.id
        ).first()
        if schedule:
            item = DbMigrationScheduleResponse(
                id=schedule.id,
                server_id=schedule.server_id,
                schedule_type=schedule.schedule_type,
                run_at=schedule.run_at,
                day_of_week=schedule.day_of_week,
                time_of_day=schedule.time_of_day,
                notify_emails=schedule.notify_emails,
                notify_hours_before=schedule.notify_hours_before,
                status=schedule.status,
                enabled=schedule.enabled,
                last_run_at=schedule.last_run_at,
                server_name=server.name,
            )
        else:
            item = DbMigrationScheduleResponse(
                id=0,
                server_id=server.id,
                schedule_type="recurring",
                run_at=None,
                day_of_week=None,
                time_of_day=None,
                notify_emails=None,
                notify_hours_before=24,
                status="scheduled",
                enabled=False,
                last_run_at=None,
                server_name=server.name,
            )
        result.append(item)
    return result
```

**Step 3: Update `upsert_schedule` to use the new service API**

Replace the existing `upsert_schedule` route:

```python
@router.post("/schedules/{server_id}", response_model=DbMigrationScheduleResponse)
def upsert_schedule(
    server_id: int,
    payload: DbMigrationScheduleUpsert,
    db: Session = Depends(get_db),
    admin: User = Depends(require_cp),
):
    server = db.query(CloudPanelServer).filter(CloudPanelServer.id == server_id).first()
    if not server:
        raise HTTPException(status_code=404, detail="Server not found")

    schedule = db.query(DbMigrationSchedule).filter(
        DbMigrationSchedule.server_id == server_id
    ).first()

    if schedule:
        schedule.schedule_type = payload.schedule_type
        schedule.run_at = payload.run_at
        schedule.day_of_week = payload.day_of_week
        schedule.time_of_day = payload.time_of_day
        schedule.notify_emails = payload.notify_emails
        schedule.notify_hours_before = payload.notify_hours_before
        schedule.enabled = payload.enabled
        # Reset status when schedule changes
        schedule.status = "scheduled"
    else:
        schedule = DbMigrationSchedule(
            server_id=server_id,
            schedule_type=payload.schedule_type,
            run_at=payload.run_at,
            day_of_week=payload.day_of_week,
            time_of_day=payload.time_of_day,
            notify_emails=payload.notify_emails,
            notify_hours_before=payload.notify_hours_before,
            enabled=payload.enabled,
            status="scheduled",
        )
        db.add(schedule)
    db.commit()
    db.refresh(schedule)

    # Update APScheduler live
    import app.scheduler_ref as sched_ref
    if sched_ref.scheduler:
        _upsert_job(sched_ref.scheduler, server_id, schedule)

    return DbMigrationScheduleResponse(
        id=schedule.id,
        server_id=schedule.server_id,
        schedule_type=schedule.schedule_type,
        run_at=schedule.run_at,
        day_of_week=schedule.day_of_week,
        time_of_day=schedule.time_of_day,
        notify_emails=schedule.notify_emails,
        notify_hours_before=schedule.notify_hours_before,
        status=schedule.status,
        enabled=schedule.enabled,
        last_run_at=schedule.last_run_at,
        server_name=server.name,
    )
```

**Step 4: Add the `POST .../notify` endpoint**

Add after `upsert_schedule`:

```python
@router.post("/schedules/{server_id}/notify")
def send_notification_now(
    server_id: int,
    db: Session = Depends(get_db),
    admin: User = Depends(require_cp),
):
    """Manually send the maintenance notification email right now."""
    server = db.query(CloudPanelServer).filter(CloudPanelServer.id == server_id).first()
    if not server:
        raise HTTPException(status_code=404, detail="Server not found")

    sent_to = send_migration_notification(server_id, db)
    if not sent_to:
        raise HTTPException(status_code=400, detail="No notify_emails configured or send failed")
    return {"ok": True, "sent_to": sent_to}
```

**Step 5: Remove the old `remove_job` call in imports — it's no longer needed externally**

The `remove_job` helper is now called only inside `_upsert_job`. Remove it from the route import:

```python
from app.services.migration_service import (
    run_server_migrations, _upsert_job, MIGRATION_DIR,
    send_migration_notification,
)
```

**Step 6: Verify imports work**

```bash
cd backend && source venv/bin/activate
python -c "from app.routes.db_migrations import router; print('ok')"
```

Expected: `ok`

**Step 7: Commit**

```bash
git add backend/app/routes/db_migrations.py
git commit -m "feat: update migration routes for v2 schedule (new upsert, manual notify endpoint)"
```

---

## Task 6: Update Frontend Schedule Form

Replace the simple `ScheduleRow` with a full form that supports both schedule types, notification config, and a manual notify button.

**Files:**
- Modify: `frontend/app/admin/cloudpanel/migrations/page.tsx`

**Step 1: Update the `Schedule` interface**

Replace the existing `Schedule` interface:

```tsx
interface Schedule {
    id: number
    server_id: number
    schedule_type: string
    run_at: string | null
    day_of_week: number | null
    time_of_day: string | null
    notify_emails: string | null
    notify_hours_before: number
    status: string
    enabled: boolean
    last_run_at: string | null
    server_name: string | null
}
```

**Step 2: Add a `notifying` state variable** alongside `running`:

```tsx
const [notifying, setNotifying] = useState<number | null>(null)
```

**Step 3: Add the `handleNotify` function** in the page component (next to `saveSchedule`):

```tsx
async function handleNotify(server_id: number) {
    setNotifying(server_id)
    const res = await fetch(`${API}/cloudpanel/migrations/schedules/${server_id}/notify`, {
        method: 'POST',
        headers: authHeaders(),
    })
    if (res.ok) {
        const data = await res.json()
        showMsg('success', `Notification sent to: ${data.sent_to.join(', ')}`)
    } else {
        const err = await res.json()
        showMsg('error', err.detail || 'Notify failed')
    }
    setNotifying(null)
}
```

**Step 4: Replace the `ScheduleRow` component entirely**

Replace the entire `ScheduleRow` function at the bottom of the file:

```tsx
const DAY_OPTIONS = [
    { label: 'Monday', value: 0 },
    { label: 'Tuesday', value: 1 },
    { label: 'Wednesday', value: 2 },
    { label: 'Thursday', value: 3 },
    { label: 'Friday', value: 4 },
    { label: 'Saturday', value: 5 },
    { label: 'Sunday', value: 6 },
]

const STATUS_COLORS: Record<string, string> = {
    scheduled: 'bg-blue-900 text-blue-300',
    notified: 'bg-yellow-900 text-yellow-300',
    completed: 'bg-green-900 text-green-300',
    disabled: 'bg-gray-700 text-gray-400',
}

function ScheduleRow({ schedule, onSave, onNotify, notifying }: {
    schedule: Schedule
    onSave: (server_id: number, payload: Partial<Schedule>) => void
    onNotify: (server_id: number) => void
    notifying: number | null
}) {
    const [scheduleType, setScheduleType] = useState(schedule.schedule_type || 'recurring')
    const [runAt, setRunAt] = useState(
        schedule.run_at ? schedule.run_at.slice(0, 16) : ''  // "YYYY-MM-DDTHH:MM"
    )
    const [dayOfWeek, setDayOfWeek] = useState<number>(schedule.day_of_week ?? 0)
    const [timeOfDay, setTimeOfDay] = useState(schedule.time_of_day || '02:00')
    const [notifyEmails, setNotifyEmails] = useState(schedule.notify_emails || '')
    const [notifyHoursBefore, setNotifyHoursBefore] = useState(schedule.notify_hours_before ?? 24)
    const [enabled, setEnabled] = useState(schedule.enabled)

    function buildPayload(): Partial<Schedule> {
        return {
            schedule_type: scheduleType,
            run_at: scheduleType === 'one_time' ? (runAt ? new Date(runAt).toISOString() : null) : null,
            day_of_week: scheduleType === 'recurring' ? dayOfWeek : null,
            time_of_day: timeOfDay || null,
            notify_emails: notifyEmails.trim() || null,
            notify_hours_before: notifyHoursBefore,
            enabled,
        }
    }

    return (
        <tr className="border-b border-gray-700 align-top">
            <td className="py-3 pr-4 text-gray-300 font-medium">{schedule.server_name}</td>
            <td className="py-3 pr-4" colSpan={3}>
                <div className="flex flex-col gap-2">
                    {/* Schedule type toggle */}
                    <div className="flex gap-2">
                        {(['one_time', 'recurring'] as const).map(t => (
                            <button
                                key={t}
                                onClick={() => setScheduleType(t)}
                                className={`text-xs px-3 py-1 rounded ${scheduleType === t ? 'bg-blue-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'}`}
                            >
                                {t === 'one_time' ? 'One-time' : 'Recurring weekly'}
                            </button>
                        ))}
                    </div>

                    {/* One-time: datetime picker */}
                    {scheduleType === 'one_time' && (
                        <div>
                            <label className="text-xs text-gray-400 block mb-1">Date &amp; Time (UTC)</label>
                            <input
                                type="datetime-local"
                                value={runAt}
                                onChange={e => setRunAt(e.target.value)}
                                className="bg-gray-700 text-white text-sm rounded px-3 py-1"
                            />
                        </div>
                    )}

                    {/* Recurring: day of week + time */}
                    {scheduleType === 'recurring' && (
                        <div className="flex gap-3 items-end">
                            <div>
                                <label className="text-xs text-gray-400 block mb-1">Day of week</label>
                                <select
                                    value={dayOfWeek}
                                    onChange={e => setDayOfWeek(Number(e.target.value))}
                                    className="bg-gray-700 text-white text-sm rounded px-2 py-1"
                                >
                                    {DAY_OPTIONS.map(d => (
                                        <option key={d.value} value={d.value}>{d.label}</option>
                                    ))}
                                </select>
                            </div>
                            <div>
                                <label className="text-xs text-gray-400 block mb-1">Time (UTC)</label>
                                <input
                                    type="time"
                                    value={timeOfDay}
                                    onChange={e => setTimeOfDay(e.target.value)}
                                    className="bg-gray-700 text-white text-sm rounded px-3 py-1"
                                />
                            </div>
                        </div>
                    )}

                    {/* Notification settings */}
                    <div className="flex gap-3 items-end flex-wrap mt-1">
                        <div className="flex-1 min-w-48">
                            <label className="text-xs text-gray-400 block mb-1">Notify emails (comma-separated)</label>
                            <input
                                type="text"
                                value={notifyEmails}
                                onChange={e => setNotifyEmails(e.target.value)}
                                placeholder="client@example.com, team@company.com"
                                className="bg-gray-700 text-white text-sm rounded px-3 py-1 w-full"
                            />
                        </div>
                        <div>
                            <label className="text-xs text-gray-400 block mb-1">Hours before</label>
                            <input
                                type="number"
                                min={1}
                                value={notifyHoursBefore}
                                onChange={e => setNotifyHoursBefore(Number(e.target.value))}
                                className="bg-gray-700 text-white text-sm rounded px-3 py-1 w-20"
                            />
                        </div>
                    </div>

                    {/* Enabled + status */}
                    <div className="flex items-center gap-3 mt-1">
                        <label className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer">
                            <input
                                type="checkbox"
                                checked={enabled}
                                onChange={e => setEnabled(e.target.checked)}
                                className="w-4 h-4"
                            />
                            Enabled
                        </label>
                        {schedule.schedule_type === 'one_time' && (
                            <span className={`text-xs px-2 py-0.5 rounded ${STATUS_COLORS[schedule.status] || STATUS_COLORS.scheduled}`}>
                                {schedule.status}
                            </span>
                        )}
                        {schedule.last_run_at && (
                            <span className="text-xs text-gray-500">
                                Last run: {new Date(schedule.last_run_at).toLocaleString()}
                            </span>
                        )}
                    </div>
                </div>
            </td>
            <td className="py-3 pl-2">
                <div className="flex flex-col gap-2">
                    <button
                        onClick={() => onSave(schedule.server_id, buildPayload())}
                        className="bg-blue-600 hover:bg-blue-700 text-white text-xs px-3 py-1 rounded whitespace-nowrap"
                    >
                        Save
                    </button>
                    <button
                        onClick={() => onNotify(schedule.server_id)}
                        disabled={notifying === schedule.server_id}
                        className="bg-yellow-600 hover:bg-yellow-700 disabled:opacity-50 text-white text-xs px-3 py-1 rounded whitespace-nowrap"
                    >
                        {notifying === schedule.server_id ? 'Sending…' : 'Send Notice'}
                    </button>
                </div>
            </td>
        </tr>
    )
}
```

**Step 5: Update `saveSchedule` to accept a payload object**

Replace the existing `saveSchedule` function:

```tsx
async function saveSchedule(server_id: number, payload: Partial<Schedule>) {
    const res = await fetch(`${API}/cloudpanel/migrations/schedules/${server_id}`, {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    })
    if (res.ok) {
        showMsg('success', 'Schedule saved')
        loadAll()
    } else {
        showMsg('error', 'Failed to save schedule')
    }
}
```

**Step 6: Update the `ScheduleRow` usage in JSX** (in the schedules table body):

```tsx
{schedules.map(sch => (
    <ScheduleRow
        key={sch.server_id}
        schedule={sch}
        onSave={saveSchedule}
        onNotify={handleNotify}
        notifying={notifying}
    />
))}
```

**Step 7: Update table header columns** to match the new layout (remove the old Interval/Enabled/Last Run/Save columns — the new ScheduleRow uses colSpan):

```tsx
<thead>
    <tr className="text-gray-400 border-b border-gray-700">
        <th className="py-2 pr-4">Server</th>
        <th className="py-2 pr-4" colSpan={3}>Schedule &amp; Notifications</th>
        <th className="py-2">Actions</th>
    </tr>
</thead>
```

**Step 8: Commit**

```bash
git add frontend/app/admin/cloudpanel/migrations/page.tsx
git commit -m "feat: migration schedule v2 frontend — datetime/weekly picker, notify emails, manual send button"
```

---

## Task 7: End-to-End Verification

**Step 1: Start the backend**

```bash
cd backend && source venv/bin/activate
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

Watch startup logs. Confirm:
- `✅ DB migration scheduler jobs loaded` appears
- No import errors

**Step 2: Verify new schema columns exist**

Open http://localhost:8000/docs → `GET /cloudpanel/migrations/schedules`

Response should include `schedule_type`, `run_at`, `day_of_week`, `time_of_day`, `notify_emails`, `notify_hours_before`, `status` for each server.

**Step 3: Test upsert — recurring schedule**

`POST /cloudpanel/migrations/schedules/{server_id}` with:
```json
{
  "schedule_type": "recurring",
  "day_of_week": 6,
  "time_of_day": "02:00",
  "enabled": true,
  "notify_emails": "test@example.com",
  "notify_hours_before": 24
}
```
Expect `200` with echoed fields and `status: "scheduled"`.

**Step 4: Test upsert — one-time schedule**

`POST /cloudpanel/migrations/schedules/{server_id}` with:
```json
{
  "schedule_type": "one_time",
  "run_at": "2026-03-10T02:00:00Z",
  "enabled": true,
  "notify_emails": "test@example.com",
  "notify_hours_before": 24
}
```
Expect `200`.

**Step 5: Test manual notify endpoint**

`POST /cloudpanel/migrations/schedules/{server_id}/notify`

If SMTP is not configured: expect logs showing "Dev mode: migration notification would go to…" and `{"ok": true, "sent_to": ["test@example.com"]}`.

**Step 6: Start frontend and check UI**

Open http://localhost:3000/admin/cloudpanel/migrations

Confirm:
- Schedule rows show One-time / Recurring weekly toggle
- Selecting One-time shows datetime picker
- Selecting Recurring shows day-of-week dropdown + time picker
- Notify emails field and Hours before field visible
- Save and Send Notice buttons present
- Status badge appears for one_time schedules

**Step 7: Final commit**

```bash
git add .
git commit -m "feat: migration schedule v2 complete — structured datetime, client notifications"
```
