# Worklog Enhancements Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add CSV/PDF export, email notifications, dashboard summary widget, and bulk approval to the worklog module.

**Architecture:** New export endpoints return StreamingResponse (CSV) or file response (PDF). Email notifications use existing `email_service.send_system_email()`. Summary endpoint aggregates metrics. Bulk approval adds batch endpoints + enhanced frontend with checkboxes and keyboard shortcuts.

**Tech Stack:** FastAPI, SQLAlchemy, fpdf2 (PDF), Python csv module, APScheduler, Next.js 14, TypeScript, TailwindCSS

---

## Chunk 1: CSV/PDF Export

### Task 1: Add CSV Export Endpoints

**Files:**
- Modify: `backend/app/routes/worklog.py`

- [ ] **Step 1: Add CSV export for reports (admin)**

Add to the end of `backend/app/routes/worklog.py`:

```python
import csv
import io
from fastapi.responses import StreamingResponse


@router.get("/reports/export")
def export_report(
    format: str,
    start_date: date,
    end_date: date,
    user_id: Optional[int] = None,
    source: Optional[str] = None,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user)
):
    _require_admin(user)
    # Reuse existing report logic
    report = get_report(start_date=start_date, end_date=end_date, user_id=user_id, source=source, db=db, user=user)
    rows = report["rows"]

    if format == "csv":
        output = io.StringIO()
        writer = csv.writer(output)
        writer.writerow(["Agent", "Date", "Source", "Category/Project", "Task/Conversation", "Hours", "Summary", "Attachments", "Late Entry"])
        for r in rows:
            att_names = ", ".join(a["file_name"] for a in r.get("attachments", []))
            writer.writerow([r["user_name"], str(r["log_date"]), r["source"], r.get("category_or_project", ""), r.get("task_or_conversation", ""), r["hours"], r.get("summary", ""), att_names, "Yes" if r.get("is_late_entry") else ""])
        output.seek(0)
        return StreamingResponse(
            iter([output.getvalue()]),
            media_type="text/csv",
            headers={"Content-Disposition": f"attachment; filename=worklog-report-{start_date}-to-{end_date}.csv"}
        )

    if format == "pdf":
        pdf_bytes = _generate_report_pdf(rows, start_date, end_date, report["total_hours"], report["breakdown"], db)
        return StreamingResponse(
            io.BytesIO(pdf_bytes),
            media_type="application/pdf",
            headers={"Content-Disposition": f"attachment; filename=worklog-report-{start_date}-to-{end_date}.pdf"}
        )

    raise HTTPException(status_code=400, detail="format must be 'csv' or 'pdf'")
```

- [ ] **Step 2: Add CSV export for agent's own entries**

```python
@router.get("/entries/export")
def export_entries(
    format: str = "csv",
    log_date: Optional[date] = None,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user)
):
    q = db.query(WorklogEntry).filter(WorklogEntry.user_id == user.id)
    if log_date:
        q = q.filter(WorklogEntry.log_date == log_date)
    q = q.order_by(WorklogEntry.log_date.desc())
    entries = q.all()

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["Date", "Category", "Hours", "Summary", "Status", "Attachments"])
    for e in entries:
        cat_name = f"{e.category.group.name} > {e.category.name}" if e.category and e.category.group else ""
        att_names = ", ".join(a.file_name for a in e.attachments)
        writer.writerow([str(e.log_date), cat_name, e.hours, e.summary or "", e.status, att_names])
    output.seek(0)
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename=my-worklog-{date.today()}.csv"}
    )
```

- [ ] **Step 3: Add approval history export (admin)**

```python
@router.get("/approval/history")
def get_approval_history(
    format: Optional[str] = None,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user)
):
    _require_admin(user)
    entries = db.query(WorklogEntry).filter(
        WorklogEntry.status.in_(["approved", "rejected"])
    ).order_by(WorklogEntry.reviewed_at.desc()).all()

    history = []
    for e in entries:
        history.append({
            "id": e.id,
            "user_name": e.user.full_name if e.user else "Unknown",
            "log_date": e.log_date,
            "hours": e.hours,
            "summary": e.summary,
            "status": e.status,
            "reviewer_name": e.reviewer.full_name if e.reviewer else "Unknown",
            "reviewed_at": e.reviewed_at,
            "rejection_note": e.rejection_note,
        })

    if format == "csv":
        output = io.StringIO()
        writer = csv.writer(output)
        writer.writerow(["Agent", "Date", "Hours", "Summary", "Status", "Reviewer", "Reviewed At", "Rejection Note"])
        for h in history:
            writer.writerow([h["user_name"], str(h["log_date"]), h["hours"], h["summary"] or "", h["status"], h["reviewer_name"], str(h["reviewed_at"] or ""), h["rejection_note"] or ""])
        output.seek(0)
        return StreamingResponse(
            iter([output.getvalue()]),
            media_type="text/csv",
            headers={"Content-Disposition": f"attachment; filename=approval-history-{date.today()}.csv"}
        )

    return history
```

- [ ] **Step 4: Commit**

```bash
git add backend/app/routes/worklog.py
git commit -m "feat(worklog): add CSV export endpoints for reports, entries, and approval history"
```

---

### Task 2: Add PDF Export

**Files:**
- Modify: `backend/app/routes/worklog.py`
- Modify: `backend/requirements.txt`

- [ ] **Step 1: Add fpdf2 to requirements.txt**

Append `fpdf2` to `backend/requirements.txt` and install:
```bash
echo "fpdf2" >> backend/requirements.txt
pip install fpdf2
```

- [ ] **Step 2: Add PDF generation helper function**

Add to `backend/app/routes/worklog.py` (after imports):

```python
def _generate_report_pdf(rows, start_date, end_date, total_hours, breakdown, db):
    from fpdf import FPDF

    # Get branding
    company_name = "Worklog Report"
    try:
        from app.models.branding import BrandingSettings
        b = db.query(BrandingSettings).first()
        if b and b.company_name:
            company_name = b.company_name
    except Exception:
        pass

    pdf = FPDF()
    pdf.add_page(orientation='L')
    pdf.set_auto_page_break(auto=True, margin=15)

    # Header
    pdf.set_font("Helvetica", "B", 16)
    pdf.cell(0, 10, company_name, ln=True, align="C")
    pdf.set_font("Helvetica", "", 11)
    pdf.cell(0, 7, f"Worklog Report: {start_date} to {end_date}", ln=True, align="C")
    pdf.cell(0, 7, f"Generated: {datetime.now().strftime('%Y-%m-%d %H:%M')}", ln=True, align="C")
    pdf.ln(5)

    # Table header
    pdf.set_font("Helvetica", "B", 9)
    col_widths = [35, 22, 22, 50, 50, 15, 80]
    headers = ["Agent", "Date", "Source", "Category/Project", "Task/Conversation", "Hours", "Summary"]
    for i, h in enumerate(headers):
        pdf.cell(col_widths[i], 7, h, border=1)
    pdf.ln()

    # Table rows
    pdf.set_font("Helvetica", "", 8)
    for r in rows:
        pdf.cell(col_widths[0], 6, str(r.get("user_name", ""))[:20], border=1)
        pdf.cell(col_widths[1], 6, str(r.get("log_date", "")), border=1)
        pdf.cell(col_widths[2], 6, str(r.get("source", "")), border=1)
        pdf.cell(col_widths[3], 6, str(r.get("category_or_project", "") or "")[:30], border=1)
        pdf.cell(col_widths[4], 6, str(r.get("task_or_conversation", "") or "")[:30], border=1)
        pdf.cell(col_widths[5], 6, str(r["hours"]), border=1)
        pdf.cell(col_widths[6], 6, str(r.get("summary", "") or "")[:50], border=1)
        pdf.ln()

    # Footer
    pdf.ln(5)
    pdf.set_font("Helvetica", "B", 10)
    pdf.cell(0, 7, f"Total Hours: {total_hours}", ln=True)
    breakdown_str = " | ".join(f"{k}: {v:.1f}h" for k, v in breakdown.items())
    pdf.cell(0, 7, f"Breakdown: {breakdown_str}", ln=True)

    return pdf.output()
```

- [ ] **Step 3: Commit**

```bash
git add backend/app/routes/worklog.py backend/requirements.txt
git commit -m "feat(worklog): add PDF export with fpdf2"
```

---

### Task 3: Add Export Buttons to Frontend

**Files:**
- Modify: `frontend/app/admin/worklog/reports/page.tsx`
- Modify: `frontend/app/admin/worklog/page.tsx`
- Modify: `frontend/app/admin/worklog/approval/page.tsx`
- Modify: `frontend/lib/api.ts`

- [ ] **Step 1: Add export API methods to frontend**

Add to `worklogApi` in `frontend/lib/api.ts`:
```typescript
  // Export
  exportReport: (params: any) => api.get('/api/worklog/reports/export', { params, responseType: 'blob' }),
  exportEntries: (params: any) => api.get('/api/worklog/entries/export', { params, responseType: 'blob' }),
  exportApprovalHistory: () => api.get('/api/worklog/approval/history?format=csv', { responseType: 'blob' }),
```

- [ ] **Step 2: Add export buttons to reports page**

In `frontend/app/admin/worklog/reports/page.tsx`, add export buttons next to the filters:

```typescript
  const handleExport = async (format: string) => {
    let params: any;
    if (period === 'custom') {
      params = { format, start_date: customStart, end_date: customEnd };
    } else {
      params = { format, ...getDateRange(period, refDate) };
    }
    if (sourceFilter) params.source = sourceFilter;
    const res = await worklogApi.exportReport(params);
    const url = window.URL.createObjectURL(new Blob([res.data]));
    const a = document.createElement('a');
    a.href = url;
    a.download = `worklog-report.${format}`;
    a.click();
    window.URL.revokeObjectURL(url);
  };
```

Add buttons in the filter bar:
```tsx
<button onClick={() => handleExport('csv')} className="px-3 py-2 bg-green-600 text-white rounded text-sm">Export CSV</button>
<button onClick={() => handleExport('pdf')} className="px-3 py-2 bg-red-600 text-white rounded text-sm">Export PDF</button>
```

- [ ] **Step 3: Add export button to agent's worklog page**

In `frontend/app/admin/worklog/page.tsx`, add "Export CSV" button in the header area:

```typescript
  const handleExportMine = async () => {
    const res = await worklogApi.exportEntries({ format: 'csv', log_date: selectedDate });
    const url = window.URL.createObjectURL(new Blob([res.data]));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'my-worklog.csv';
    a.click();
    window.URL.revokeObjectURL(url);
  };
```

- [ ] **Step 4: Add export button to approval page**

In `frontend/app/admin/worklog/approval/page.tsx`, add "Export History" button:

```typescript
  const handleExportHistory = async () => {
    const res = await worklogApi.exportApprovalHistory();
    const url = window.URL.createObjectURL(new Blob([res.data]));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'approval-history.csv';
    a.click();
    window.URL.revokeObjectURL(url);
  };
```

- [ ] **Step 5: Commit**

```bash
git add frontend/lib/api.ts frontend/app/admin/worklog/reports/page.tsx frontend/app/admin/worklog/page.tsx frontend/app/admin/worklog/approval/page.tsx
git commit -m "feat(worklog): add export buttons to frontend pages"
```

---

## Chunk 2: Email Notifications

### Task 4: Create Worklog Notification Service

**Files:**
- Create: `backend/app/services/worklog_notifications.py`

- [ ] **Step 1: Create notification service**

```python
import logging
from sqlalchemy.orm import Session
from app.services.email_service import email_service
from app.models.user import User
from app.models.worklog import WorklogEntry

logger = logging.getLogger(__name__)

FRONTEND_URL = None

def _get_frontend_url():
    global FRONTEND_URL
    if not FRONTEND_URL:
        from app.config import settings
        FRONTEND_URL = getattr(settings, 'FRONTEND_URL', 'http://localhost:3000')
    return FRONTEND_URL


def _get_admin_emails(db: Session) -> list:
    admins = db.query(User).filter(User.role == "admin", User.is_active == True).all()
    return [a.email for a in admins if a.email]


def _build_html(title: str, body: str, action_url: str = None, action_label: str = None) -> str:
    action_btn = ""
    if action_url and action_label:
        action_btn = f'<p style="margin:20px 0;"><a href="{action_url}" style="display:inline-block;background:#4f46e5;color:#fff;text-decoration:none;padding:12px 24px;border-radius:6px;font-weight:600;">{action_label}</a></p>'
    return f"""
    <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;padding:20px;">
        <h2 style="color:#1f2937;margin-bottom:16px;">{title}</h2>
        <div style="color:#4b5563;line-height:1.6;">{body}</div>
        {action_btn}
        <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0;">
        <p style="color:#9ca3af;font-size:12px;">This is an automated notification from your worklog system.</p>
    </div>
    """


def notify_entry_submitted(entry: WorklogEntry, db: Session):
    admin_emails = _get_admin_emails(db)
    if not admin_emails:
        return
    agent_name = entry.user.full_name if entry.user else "An agent"
    url = f"{_get_frontend_url()}/admin/worklog/approval"
    html = _build_html(
        "New Worklog Entry Submitted",
        f"<p><strong>{agent_name}</strong> submitted a worklog entry:</p>"
        f"<ul><li>Date: {entry.log_date}</li><li>Hours: {entry.hours}</li><li>Summary: {entry.summary or 'N/A'}</li></ul>",
        action_url=url,
        action_label="Review Entry"
    )
    for email in admin_emails:
        email_service.send_system_email(email, f"Worklog: {agent_name} submitted {entry.hours}h for {entry.log_date}", html, db=db)


def notify_entry_approved(entry: WorklogEntry, db: Session):
    if not entry.user or not entry.user.email:
        return
    reviewer_name = entry.reviewer.full_name if entry.reviewer else "Admin"
    url = f"{_get_frontend_url()}/admin/worklog"
    html = _build_html(
        "Worklog Entry Approved",
        f"<p>Your worklog entry for <strong>{entry.log_date}</strong> ({entry.hours}h) has been approved by <strong>{reviewer_name}</strong>.</p>",
        action_url=url,
        action_label="View Worklog"
    )
    email_service.send_system_email(entry.user.email, f"Worklog approved: {entry.log_date} ({entry.hours}h)", html, db=db)


def notify_entry_rejected(entry: WorklogEntry, db: Session):
    if not entry.user or not entry.user.email:
        return
    reviewer_name = entry.reviewer.full_name if entry.reviewer else "Admin"
    url = f"{_get_frontend_url()}/admin/worklog"
    html = _build_html(
        "Worklog Entry Rejected",
        f"<p>Your worklog entry for <strong>{entry.log_date}</strong> ({entry.hours}h) was rejected by <strong>{reviewer_name}</strong>.</p>"
        f"<p><strong>Reason:</strong> {entry.rejection_note or 'No reason provided'}</p>",
        action_url=url,
        action_label="Revise & Resubmit"
    )
    email_service.send_system_email(entry.user.email, f"Worklog rejected: {entry.log_date} - {entry.rejection_note or 'See details'}", html, db=db)


def notify_entry_resubmitted(entry: WorklogEntry, db: Session):
    admin_emails = _get_admin_emails(db)
    if not admin_emails:
        return
    agent_name = entry.user.full_name if entry.user else "An agent"
    url = f"{_get_frontend_url()}/admin/worklog/approval"
    html = _build_html(
        "Worklog Entry Resubmitted",
        f"<p><strong>{agent_name}</strong> has resubmitted a worklog entry:</p>"
        f"<ul><li>Date: {entry.log_date}</li><li>Hours: {entry.hours}</li><li>Summary: {entry.summary or 'N/A'}</li></ul>",
        action_url=url,
        action_label="Review Entry"
    )
    for email in admin_emails:
        email_service.send_system_email(email, f"Worklog resubmitted: {agent_name} - {entry.log_date}", html, db=db)


def send_daily_digest(db: Session):
    pending_count = db.query(WorklogEntry).filter(WorklogEntry.status == "pending").count()
    if pending_count == 0:
        return
    admin_emails = _get_admin_emails(db)
    if not admin_emails:
        return
    url = f"{_get_frontend_url()}/admin/worklog/approval"
    html = _build_html(
        "Worklog Daily Digest",
        f"<p>You have <strong>{pending_count}</strong> pending worklog entries awaiting your approval.</p>",
        action_url=url,
        action_label="Review Entries"
    )
    for email in admin_emails:
        email_service.send_system_email(email, f"Worklog: {pending_count} entries awaiting approval", html, db=db)
```

- [ ] **Step 2: Commit**

```bash
git add backend/app/services/worklog_notifications.py
git commit -m "feat(worklog): add email notification service"
```

---

### Task 5: Integrate Notifications into Routes + Scheduler

**Files:**
- Modify: `backend/app/routes/worklog.py`
- Modify: `backend/main.py`

- [ ] **Step 1: Add notification calls to worklog routes**

In `backend/app/routes/worklog.py`, add import at top:
```python
from app.services.worklog_notifications import (
    notify_entry_submitted, notify_entry_approved,
    notify_entry_rejected, notify_entry_resubmitted
)
```

Then add notification calls:
- In `create_entry`: after `db.commit()` add `notify_entry_submitted(entry, db)`
- In `approve_entry`: after `db.commit()` add `notify_entry_approved(entry, db)`
- In `reject_entry`: after `db.commit()` add `notify_entry_rejected(entry, db)`
- In `resubmit_entry`: after `db.commit()` add `notify_entry_resubmitted(entry, db)`

- [ ] **Step 2: Add daily digest scheduler job to main.py**

In `backend/main.py`, inside the `start_scheduler` function, add after other jobs:

```python
        # Worklog daily digest at 8 AM
        def worklog_daily_digest():
            try:
                from app.services.worklog_notifications import send_daily_digest
                db = SessionLocal()
                send_daily_digest(db)
                db.close()
            except Exception as e:
                logger.error("Worklog digest error: %s", e)
                _log_job_error(f"Worklog digest error: {e}", exc=e, job_name="worklog_daily_digest")
        scheduler.add_job(worklog_daily_digest, 'cron', hour=8, minute=0, id='worklog_daily_digest')
```

- [ ] **Step 3: Commit**

```bash
git add backend/app/routes/worklog.py backend/main.py
git commit -m "feat(worklog): integrate notifications into routes and add daily digest job"
```

---

## Chunk 3: Dashboard Summary Widget

### Task 6: Add Summary Endpoint

**Files:**
- Modify: `backend/app/routes/worklog.py`

- [ ] **Step 1: Add summary endpoint**

Add to `backend/app/routes/worklog.py`:

```python
@router.get("/summary")
def get_summary(
    team: Optional[bool] = None,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user)
):
    from sqlalchemy import func as sqlfunc
    today = date.today()
    week_start = today - timedelta(days=today.weekday())  # Monday

    # Personal metrics
    today_hours = db.query(sqlfunc.coalesce(sqlfunc.sum(WorklogEntry.hours), 0)).filter(
        WorklogEntry.user_id == user.id, WorklogEntry.log_date == today
    ).scalar()

    week_hours = db.query(sqlfunc.coalesce(sqlfunc.sum(WorklogEntry.hours), 0)).filter(
        WorklogEntry.user_id == user.id, WorklogEntry.log_date >= week_start, WorklogEntry.log_date <= today
    ).scalar()

    pending_count = db.query(WorklogEntry).filter(
        WorklogEntry.user_id == user.id, WorklogEntry.status == "pending"
    ).count()

    approved_week_count = db.query(WorklogEntry).filter(
        WorklogEntry.user_id == user.id, WorklogEntry.status == "approved",
        WorklogEntry.log_date >= week_start
    ).count()

    timer_active = user.id in _active_timers

    result = {
        "today_hours": float(today_hours),
        "week_hours": float(week_hours),
        "pending_count": pending_count,
        "approved_week_count": approved_week_count,
        "timer_active": timer_active,
    }

    # Admin team metrics
    if team and getattr(user, 'role', '') == "admin":
        team_today = db.query(sqlfunc.coalesce(sqlfunc.sum(WorklogEntry.hours), 0)).filter(
            WorklogEntry.log_date == today
        ).scalar()
        total_pending = db.query(WorklogEntry).filter(WorklogEntry.status == "pending").count()
        result["team_today_hours"] = float(team_today)
        result["total_pending"] = total_pending

    return result
```

- [ ] **Step 2: Commit**

```bash
git add backend/app/routes/worklog.py
git commit -m "feat(worklog): add summary metrics endpoint"
```

---

### Task 7: Add Summary Widget to Worklog Page

**Files:**
- Modify: `frontend/app/admin/worklog/page.tsx`
- Modify: `frontend/lib/api.ts`

- [ ] **Step 1: Add getSummary to API client**

Add to `worklogApi` in `frontend/lib/api.ts`:
```typescript
  getSummary: (params?: any) => api.get('/api/worklog/summary', { params }),
```

- [ ] **Step 2: Add summary cards to worklog page**

In `frontend/app/admin/worklog/page.tsx`, add state and fetch:
```typescript
const [summary, setSummary] = useState<any>(null);
```

In the `load` function, add:
```typescript
worklogApi.getSummary().then(r => setSummary(r.data));
```

Add summary cards above the timer section:
```tsx
{summary && (
  <div className="grid grid-cols-5 gap-3 mb-4">
    <div className="bg-white border rounded-lg p-3 text-center">
      <div className="text-xl font-bold text-gray-900">{summary.today_hours.toFixed(1)}h</div>
      <div className="text-xs text-gray-500">Today</div>
    </div>
    <div className="bg-white border rounded-lg p-3 text-center">
      <div className="text-xl font-bold text-gray-900">{summary.week_hours.toFixed(1)}h</div>
      <div className="text-xs text-gray-500">This Week</div>
    </div>
    <div className="bg-white border rounded-lg p-3 text-center">
      <div className="text-xl font-bold text-yellow-600">{summary.pending_count}</div>
      <div className="text-xs text-gray-500">Pending</div>
    </div>
    <div className="bg-white border rounded-lg p-3 text-center">
      <div className="text-xl font-bold text-green-600">{summary.approved_week_count}</div>
      <div className="text-xs text-gray-500">Approved (Week)</div>
    </div>
    <div className="bg-white border rounded-lg p-3 text-center">
      <div className={`text-xl font-bold ${summary.timer_active ? 'text-red-600' : 'text-gray-400'}`}>
        {summary.timer_active ? 'Running' : 'Idle'}
      </div>
      <div className="text-xs text-gray-500">Timer</div>
    </div>
  </div>
)}
```

- [ ] **Step 3: Commit**

```bash
git add frontend/lib/api.ts frontend/app/admin/worklog/page.tsx
git commit -m "feat(worklog): add summary cards to worklog page"
```

---

### Task 8: Add Worklog Widget to Main Dashboard

**Files:**
- Modify: `frontend/app/dashboard/page.tsx`

- [ ] **Step 1: Find the dashboard layout and add a worklog summary widget**

Look at the existing dashboard page structure. Add a compact card:

```tsx
import { worklogApi } from '@/lib/api';

// In component state:
const [worklogSummary, setWorklogSummary] = useState<any>(null);

// In useEffect:
worklogApi.getSummary({ team: user?.role === 'admin' }).then(r => setWorklogSummary(r.data)).catch(() => {});
```

Add widget card (position depends on existing layout):
```tsx
{worklogSummary && (
  <div className="bg-white border rounded-lg p-4 cursor-pointer hover:shadow-md transition" onClick={() => router.push(user?.role === 'admin' ? '/admin/worklog/approval' : '/admin/worklog')}>
    <h3 className="text-sm font-medium text-gray-700 mb-3 flex items-center gap-2">
      <span>⏱️</span> Worklog
    </h3>
    <div className="grid grid-cols-3 gap-2 text-center">
      <div>
        <div className="text-lg font-bold text-gray-900">{worklogSummary.today_hours?.toFixed(1)}h</div>
        <div className="text-xs text-gray-500">Today</div>
      </div>
      <div>
        <div className="text-lg font-bold text-gray-900">{worklogSummary.week_hours?.toFixed(1)}h</div>
        <div className="text-xs text-gray-500">Week</div>
      </div>
      <div>
        <div className="text-lg font-bold text-yellow-600">{worklogSummary.total_pending ?? worklogSummary.pending_count}</div>
        <div className="text-xs text-gray-500">Pending</div>
      </div>
    </div>
  </div>
)}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/app/dashboard/page.tsx
git commit -m "feat(worklog): add worklog summary widget to main dashboard"
```

---

## Chunk 4: Bulk Approval

### Task 9: Add Bulk Approval Endpoints

**Files:**
- Modify: `backend/app/routes/worklog.py`

- [ ] **Step 1: Add bulk approve/reject endpoints**

Add to `backend/app/routes/worklog.py`:

```python
from pydantic import BaseModel as PydanticBaseModel

class BulkApproveRequest(PydanticBaseModel):
    entry_ids: list

class BulkRejectRequest(PydanticBaseModel):
    entry_ids: list
    rejection_note: str


@router.post("/entries/bulk-approve")
def bulk_approve(data: BulkApproveRequest, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    _require_admin(user)
    entries = db.query(WorklogEntry).filter(
        WorklogEntry.id.in_(data.entry_ids),
        WorklogEntry.status == "pending"
    ).all()
    for entry in entries:
        entry.status = "approved"
        entry.reviewer_id = user.id
        entry.reviewed_at = datetime.now()
    db.commit()
    for entry in entries:
        notify_entry_approved(entry, db)
    return {"affected": len(entries)}


@router.post("/entries/bulk-reject")
def bulk_reject(data: BulkRejectRequest, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    _require_admin(user)
    entries = db.query(WorklogEntry).filter(
        WorklogEntry.id.in_(data.entry_ids),
        WorklogEntry.status == "pending"
    ).all()
    for entry in entries:
        entry.status = "rejected"
        entry.reviewer_id = user.id
        entry.reviewed_at = datetime.now()
        entry.rejection_note = data.rejection_note
    db.commit()
    for entry in entries:
        notify_entry_rejected(entry, db)
    return {"affected": len(entries)}
```

- [ ] **Step 2: Add bulk API methods to frontend**

Add to `worklogApi` in `frontend/lib/api.ts`:
```typescript
  bulkApprove: (entryIds: number[]) => api.post('/api/worklog/entries/bulk-approve', { entry_ids: entryIds }),
  bulkReject: (entryIds: number[], rejectionNote: string) => api.post('/api/worklog/entries/bulk-reject', { entry_ids: entryIds, rejection_note: rejectionNote }),
```

- [ ] **Step 3: Commit**

```bash
git add backend/app/routes/worklog.py frontend/lib/api.ts
git commit -m "feat(worklog): add bulk approve/reject endpoints"
```

---

### Task 10: Enhance Approval Page with Bulk Selection

**Files:**
- Modify: `frontend/app/admin/worklog/approval/page.tsx`

- [ ] **Step 1: Rewrite approval page with checkboxes, shift+click, floating bar, and keyboard shortcuts**

Replace the full content of `frontend/app/admin/worklog/approval/page.tsx` with the enhanced version that includes:

1. `selectedIds` state (Set<number>)
2. `lastClickedId` ref for shift+click range
3. Checkbox in header (select all) and each row
4. Shift+click logic: on click with shift held, select range from lastClicked to current
5. Floating action bar at bottom when selection > 0
6. Reject modal that works for bulk too
7. `useEffect` for keyboard shortcuts (A = approve, R = reject, Ctrl+A = select all)
8. Group-by toggle (agent/date) with group-level checkboxes

Key state additions:
```typescript
const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
const [groupBy, setGroupBy] = useState<'none' | 'agent' | 'date'>('none');
const lastClickedRef = useRef<number | null>(null);
```

Key handler: shift+click range selection:
```typescript
const handleRowCheck = (id: number, e: React.MouseEvent<HTMLInputElement>) => {
  const newSelected = new Set(selectedIds);
  if (e.shiftKey && lastClickedRef.current !== null) {
    const ids = entries.map(e => e.id);
    const start = ids.indexOf(lastClickedRef.current);
    const end = ids.indexOf(id);
    const range = ids.slice(Math.min(start, end), Math.max(start, end) + 1);
    range.forEach(rid => newSelected.add(rid));
  } else {
    if (newSelected.has(id)) newSelected.delete(id);
    else newSelected.add(id);
  }
  lastClickedRef.current = id;
  setSelectedIds(newSelected);
};
```

Floating action bar:
```tsx
{selectedIds.size > 0 && (
  <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-gray-900 text-white rounded-lg shadow-xl px-6 py-3 flex items-center gap-4 z-50">
    <span className="text-sm">{selectedIds.size} entries selected</span>
    <button onClick={handleBulkApprove} className="px-4 py-1.5 bg-green-500 rounded text-sm font-medium">Approve All</button>
    <button onClick={() => setRejectId(-1)} className="px-4 py-1.5 bg-red-500 rounded text-sm font-medium">Reject All</button>
    <button onClick={() => setSelectedIds(new Set())} className="px-4 py-1.5 bg-gray-700 rounded text-sm font-medium">Clear</button>
  </div>
)}
```

Keyboard shortcuts:
```typescript
useEffect(() => {
  const handler = (e: KeyboardEvent) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    if (e.key === 'a' && !e.metaKey && !e.ctrlKey && selectedIds.size > 0) {
      e.preventDefault();
      handleBulkApprove();
    }
    if (e.key === 'r' && selectedIds.size > 0) {
      e.preventDefault();
      setRejectId(-1);
    }
    if ((e.metaKey || e.ctrlKey) && e.key === 'a') {
      e.preventDefault();
      setSelectedIds(new Set(entries.map(e => e.id)));
    }
  };
  window.addEventListener('keydown', handler);
  return () => window.removeEventListener('keydown', handler);
}, [selectedIds, entries]);
```

Bulk handlers:
```typescript
const handleBulkApprove = async () => {
  if (!confirm(`Approve ${selectedIds.size} entries?`)) return;
  await worklogApi.bulkApprove([...selectedIds]);
  setSelectedIds(new Set());
  load();
};

const handleBulkReject = async () => {
  if (!rejectNote.trim()) return;
  await worklogApi.bulkReject([...selectedIds], rejectNote);
  setSelectedIds(new Set());
  setRejectId(null);
  setRejectNote('');
  load();
};
```

- [ ] **Step 2: Commit**

```bash
git add frontend/app/admin/worklog/approval/page.tsx
git commit -m "feat(worklog): enhance approval page with bulk selection, shift+click, floating bar, keyboard shortcuts"
```

---

### Task 11: Verify and Push

- [ ] **Step 1: Verify backend imports**

```bash
cd backend && python -c "from app.routes.worklog import router; from app.services.worklog_notifications import send_daily_digest; print('OK')"
```

- [ ] **Step 2: Verify frontend compiles (TypeScript check)**

```bash
cd frontend && npx tsc --noEmit --skipLibCheck 2>&1 | grep -i "worklog" | head -10
```

- [ ] **Step 3: Push all changes**

```bash
git push
```
