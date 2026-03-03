# Executive Dashboard Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a unified executive dashboard at `/admin` combining live messaging stats, CRM pipeline snapshot, and agent leaderboard in a single auto-refreshing page.

**Architecture:** One new backend endpoint `GET /reports/dashboard-summary` aggregates conversation, CRM, and billing data in a single DB query set. The frontend polls it every 30 seconds. No new DB tables needed — all data is read from existing models.

**Tech Stack:** FastAPI (Python), SQLAlchemy ORM, Next.js 14 App Router, TypeScript, TailwindCSS.

**Note:** No Alembic, no Jest. Verify manually via browser at http://localhost:3000/admin. Backend migrations use inline `text()` in main.py.

---

### Task 1: Add `GET /reports/dashboard-summary` backend endpoint

**Files:**
- Modify: `backend/app/routes/reports.py`

**Step 1: Read the existing reports router**

Read `backend/app/routes/reports.py` to find where to insert the new endpoint and understand existing imports.

**Step 2: Add the endpoint**

Find the end of the file (or a logical insertion point) and add:

```python
@router.get("/dashboard-summary")
def get_dashboard_summary(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Unified dashboard summary: messaging + CRM + agents."""
    from datetime import datetime, timedelta
    from app.models.crm import Lead, Deal, LeadStatus
    from sqlalchemy import func

    today_start = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
    week_start = datetime.utcnow() - timedelta(days=7)

    # --- Conversations ---
    total_today = db.query(Conversation).filter(Conversation.created_at >= today_start).count()
    open_count = db.query(Conversation).filter(Conversation.status == "open").count()
    pending_count = db.query(Conversation).filter(Conversation.status == "pending").count()
    resolved_count = db.query(Conversation).filter(Conversation.status == "resolved").count()

    # Avg first response time (minutes) - all time
    from app.models.conversation import Conversation as Conv
    avg_response = db.query(func.avg(
        func.extract('epoch', Conv.first_response_at - Conv.created_at) / 60
    )).filter(Conv.first_response_at.isnot(None)).scalar()

    avg_rating = db.query(func.avg(Conv.rating)).filter(Conv.rating.isnot(None)).scalar()

    # --- CRM ---
    new_leads_week = db.query(Lead).filter(Lead.created_at >= week_start).count()
    total_leads = db.query(Lead).count()
    converted_leads = db.query(Lead).filter(Lead.status == "converted").count()

    pipeline_value = db.query(func.sum(Deal.amount)).filter(
        Deal.stage.notin_(["won", "lost"])
    ).scalar() or 0

    won_deals = db.query(Deal).filter(Deal.stage == "won").count()
    total_closed = db.query(Deal).filter(Deal.stage.in_(["won", "lost"])).count()
    win_rate = round((won_deals / total_closed * 100) if total_closed else 0, 1)

    # Pipeline by stage
    from app.models.crm import DealStage
    pipeline_by_stage = {}
    for stage in ["prospect", "qualified", "proposal", "negotiation", "close", "won", "lost"]:
        count = db.query(Deal).filter(Deal.stage == stage).count()
        value = db.query(func.sum(Deal.amount)).filter(Deal.stage == stage).scalar() or 0
        pipeline_by_stage[stage] = {"count": count, "value": float(value)}

    # --- Agent leaderboard (resolved today) ---
    from app.models.user import User as UserModel
    agents = db.query(UserModel).filter(UserModel.role.in_(["admin", "agent"])).all()
    leaderboard = []
    for agent in agents:
        resolved_today = db.query(Conv).filter(
            Conv.assigned_to == agent.id,
            Conv.status == "resolved",
            Conv.resolved_at >= today_start,
        ).count()
        if resolved_today > 0:
            leaderboard.append({
                "id": agent.id,
                "name": agent.full_name or agent.email,
                "resolved_today": resolved_today,
            })
    leaderboard.sort(key=lambda x: x["resolved_today"], reverse=True)

    return {
        "conversations": {
            "total_today": total_today,
            "open": open_count,
            "pending": pending_count,
            "resolved": resolved_count,
            "avg_response_min": round(float(avg_response), 1) if avg_response else None,
            "avg_rating": round(float(avg_rating), 2) if avg_rating else None,
        },
        "crm": {
            "new_leads_week": new_leads_week,
            "total_leads": total_leads,
            "converted_leads": converted_leads,
            "pipeline_value": float(pipeline_value),
            "win_rate": win_rate,
            "pipeline_by_stage": pipeline_by_stage,
        },
        "leaderboard": leaderboard[:5],
    }
```

**Step 3: Verify**

Go to http://localhost:8000/docs → find `GET /reports/dashboard-summary` → Execute → confirm JSON response with `conversations`, `crm`, `leaderboard` keys.

**Step 4: Commit**

```bash
git add backend/app/routes/reports.py
git commit -m "feat: add GET /reports/dashboard-summary unified endpoint"
```

---

### Task 2: Build the Executive Dashboard page

**Files:**
- Modify: `frontend/app/admin/page.tsx`

**Step 1: Read the current file**

Read `frontend/app/admin/page.tsx` to understand its current structure.

**Step 2: Replace with the dashboard**

Replace the entire file content with:

```tsx
"use client";

import { useState, useEffect, useCallback } from "react";
import { authAPI, getAuthToken } from "@/lib/auth";
import { API_URL } from "@/lib/config";
import MainHeader from "@/components/MainHeader";
import AdminNav from "@/components/AdminNav";

const STAGE_COLORS: Record<string, string> = {
  prospect:    "bg-blue-100 text-blue-700",
  qualified:   "bg-cyan-100 text-cyan-700",
  proposal:    "bg-yellow-100 text-yellow-700",
  negotiation: "bg-orange-100 text-orange-700",
  close:       "bg-purple-100 text-purple-700",
  won:         "bg-green-100 text-green-700",
  lost:        "bg-red-100 text-red-700",
};

function KpiCard({ label, value, sub, color = "blue" }: { label: string; value: string | number; sub?: string; color?: string }) {
  const colors: Record<string, string> = {
    blue: "border-blue-400 bg-blue-50",
    green: "border-green-400 bg-green-50",
    amber: "border-amber-400 bg-amber-50",
    purple: "border-purple-400 bg-purple-50",
    red: "border-red-400 bg-red-50",
  };
  return (
    <div className={`rounded-xl border-t-4 p-5 shadow-sm ${colors[color] || colors.blue} bg-white`}>
      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{label}</p>
      <p className="text-3xl font-bold text-gray-900 mt-1">{value ?? "—"}</p>
      {sub && <p className="text-xs text-gray-500 mt-1">{sub}</p>}
    </div>
  );
}

export default function AdminDashboard() {
  const user = authAPI.getUser();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const token = getAuthToken();
      const res = await fetch(`${API_URL}/reports/dashboard-summary`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        setData(await res.json());
        setLastUpdated(new Date());
      }
    } catch {}
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 30000);
    return () => clearInterval(interval);
  }, [fetchData]);

  const conv = data?.conversations;
  const crm = data?.crm;
  const leaderboard = data?.leaderboard ?? [];

  return (
    <div className="ml-60 pt-14 min-h-screen bg-gray-50">
      <MainHeader user={user!} />
      <AdminNav />
      <main className="w-full px-6 py-8 space-y-8">

        {/* Header */}
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-2xl font-semibold text-gray-900">Executive Dashboard</h1>
            <p className="text-sm text-gray-400 mt-0.5">
              {lastUpdated ? `Updated ${lastUpdated.toLocaleTimeString()}` : "Loading…"} · auto-refreshes every 30s
            </p>
          </div>
          <button
            onClick={fetchData}
            className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg hover:bg-gray-100 text-gray-600"
          >
            ↻ Refresh
          </button>
        </div>

        {loading ? (
          <div className="flex justify-center py-24">
            <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-500" />
          </div>
        ) : (
          <>
            {/* Messaging KPIs */}
            <section>
              <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-widest mb-3">Conversations</h2>
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
                <KpiCard label="Today" value={conv?.total_today ?? 0} color="blue" />
                <KpiCard label="Open" value={conv?.open ?? 0} color="amber" />
                <KpiCard label="Pending" value={conv?.pending ?? 0} color="amber" />
                <KpiCard label="Resolved" value={conv?.resolved ?? 0} color="green" />
                <KpiCard
                  label="Avg Response"
                  value={conv?.avg_response_min != null ? `${conv.avg_response_min}m` : "—"}
                  color="blue"
                />
                <KpiCard
                  label="Avg Rating"
                  value={conv?.avg_rating != null ? `${conv.avg_rating} ★` : "—"}
                  color="purple"
                />
              </div>
            </section>

            {/* CRM KPIs */}
            <section>
              <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-widest mb-3">CRM</h2>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <KpiCard label="New Leads (7d)" value={crm?.new_leads_week ?? 0} color="blue" />
                <KpiCard label="Total Leads" value={crm?.total_leads ?? 0} color="blue" />
                <KpiCard
                  label="Pipeline Value"
                  value={crm?.pipeline_value != null ? `$${Number(crm.pipeline_value).toLocaleString()}` : "—"}
                  color="green"
                />
                <KpiCard label="Win Rate" value={crm?.win_rate != null ? `${crm.win_rate}%` : "—"} color="purple" />
              </div>
            </section>

            {/* Pipeline by Stage + Agent Leaderboard */}
            <div className="grid grid-cols-3 gap-6">
              {/* Pipeline */}
              <div className="col-span-2 bg-white rounded-xl shadow p-6">
                <h2 className="text-sm font-semibold text-gray-700 mb-4">Pipeline by Stage</h2>
                <div className="space-y-2">
                  {crm?.pipeline_by_stage && Object.entries(crm.pipeline_by_stage).map(([stage, info]: [string, any]) => (
                    <div key={stage} className="flex items-center gap-3">
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded-full capitalize ${STAGE_COLORS[stage] || "bg-gray-100 text-gray-600"}`} style={{ minWidth: 90, textAlign: "center" }}>
                        {stage}
                      </span>
                      <div className="flex-1 bg-gray-100 rounded-full h-2">
                        <div
                          className="bg-indigo-500 h-2 rounded-full transition-all"
                          style={{ width: `${Math.min((info.count / Math.max(crm.total_leads, 1)) * 100, 100)}%` }}
                        />
                      </div>
                      <span className="text-sm font-medium text-gray-700 w-6 text-right">{info.count}</span>
                      <span className="text-xs text-gray-400 w-20 text-right">${info.value.toLocaleString()}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Agent Leaderboard */}
              <div className="bg-white rounded-xl shadow p-6">
                <h2 className="text-sm font-semibold text-gray-700 mb-4">Agent Leaderboard (today)</h2>
                {leaderboard.length === 0 ? (
                  <p className="text-gray-400 text-sm">No resolved conversations today.</p>
                ) : (
                  <ol className="space-y-3">
                    {leaderboard.map((agent: any, i: number) => (
                      <li key={agent.id} className="flex items-center gap-3">
                        <span className={`text-sm font-bold w-6 ${i === 0 ? "text-yellow-500" : i === 1 ? "text-gray-400" : i === 2 ? "text-amber-600" : "text-gray-300"}`}>
                          #{i + 1}
                        </span>
                        <span className="flex-1 text-sm text-gray-800 truncate">{agent.name}</span>
                        <span className="text-sm font-semibold text-indigo-600">{agent.resolved_today}</span>
                      </li>
                    ))}
                  </ol>
                )}
              </div>
            </div>

            {/* Quick links */}
            <section>
              <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-widest mb-3">Quick Links</h2>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {[
                  { href: "/admin/reports", label: "Full Reports", icon: "📊" },
                  { href: "/admin/crm/leads", label: "Leads", icon: "👥" },
                  { href: "/admin/crm/analytics", label: "CRM Analytics", icon: "📈" },
                  { href: "/admin/users", label: "Manage Users", icon: "👤" },
                ].map(link => (
                  <a
                    key={link.href}
                    href={link.href}
                    className="flex items-center gap-2 bg-white rounded-lg shadow px-4 py-3 text-sm font-medium text-gray-700 hover:bg-gray-50 transition"
                  >
                    <span className="text-lg">{link.icon}</span>
                    {link.label}
                  </a>
                ))}
              </div>
            </section>
          </>
        )}
      </main>
    </div>
  );
}
```

**Step 3: Verify in browser**

1. Navigate to http://localhost:3000/admin
2. Should see KPI cards for conversations (today, open, pending, resolved, avg response, avg rating)
3. CRM section with new leads, pipeline value, win rate
4. Pipeline by stage bars
5. Agent leaderboard
6. Auto-refreshes every 30 seconds

**Step 4: Commit**

```bash
git add frontend/app/admin/page.tsx
git commit -m "feat: build executive dashboard with messaging, CRM, and agent stats"
```
