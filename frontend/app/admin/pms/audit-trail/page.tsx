'use client';
import { useEffect, useState } from 'react';
import { pmsApi } from '@/lib/api';
import MainHeader from '@/components/MainHeader';
import AdminNav from '@/components/AdminNav';
import { authAPI } from '@/lib/auth';

const ACTION_ICONS: Record<string, string> = {
  stage_change: '\uD83D\uDD04',
  assignee_change: '\uD83D\uDC64',
  member_added: '\u2795',
  member_removed: '\u2796',
  milestone_change: '\uD83C\uDFC1',
};

const ACTION_COLORS: Record<string, string> = {
  stage_change: 'bg-blue-100 text-blue-800',
  assignee_change: 'bg-purple-100 text-purple-800',
  member_added: 'bg-green-100 text-green-800',
  member_removed: 'bg-red-100 text-red-800',
  milestone_change: 'bg-yellow-100 text-yellow-800',
};

function formatAction(log: any): string {
  const d = log.details || {};
  switch (log.action_type) {
    case 'stage_change': {
      const base = `moved "${d.task_title || '?'}" from ${d.from || '?'} \u2192 ${d.to || '?'}`;
      return d.note ? `${base} (${d.note})` : base;
    }
    case 'assignee_change':
      return `reassigned "${d.task_title || '?'}" from ${d.from || 'unassigned'} \u2192 ${d.to || 'unassigned'}`;
    case 'member_added':
      return `added user #${d.user_id ?? '?'} as ${d.role || 'member'}`;
    case 'member_removed':
      return `removed user #${d.user_id ?? '?'}`;
    case 'milestone_change':
      return `updated milestone "${d.milestone || '?'}"`;
    default:
      return JSON.stringify(d);
  }
}

function formatTimestamp(ts: string): string {
  const date = new Date(ts);
  return date.toLocaleString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

export default function AuditTrailPage() {
  const user = authAPI.getUser();
  const [logs, setLogs] = useState<any[]>([]);
  const [_total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [filters, setFilters] = useState<any>({ projects: [], actors: [], action_types: [] });
  const [loading, setLoading] = useState(true);

  const [projectId, setProjectId] = useState('');
  const [actionType, setActionType] = useState('');
  const [actorId, setActorId] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const [appliedFilters, setAppliedFilters] = useState<any>({});

  const fetchData = (p: number, f: any) => {
    setLoading(true);
    const params: any = { page: p };
    if (f.project_id) params.project_id = f.project_id;
    if (f.action_type) params.action_type = f.action_type;
    if (f.actor_id) params.actor_id = f.actor_id;
    if (f.date_from) params.date_from = f.date_from;
    if (f.date_to) params.date_to = f.date_to;
    pmsApi.getAuditTrail(params)
      .then((r: any) => {
        const data = r.data;
        setLogs(data.logs || []);
        setTotal(data.total || 0);
        setPage(data.page || 1);
        setPages(data.pages || 1);
        if (data.filters) setFilters(data.filters);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  };

  useEffect(() => { fetchData(1, {}); }, []);

  const handleApply = () => {
    const f: any = {};
    if (projectId) f.project_id = projectId;
    if (actionType) f.action_type = actionType;
    if (actorId) f.actor_id = actorId;
    if (dateFrom) f.date_from = dateFrom;
    if (dateTo) f.date_to = dateTo;
    setAppliedFilters(f);
    fetchData(1, f);
  };

  const goToPage = (p: number) => {
    if (p < 1 || p > pages) return;
    fetchData(p, appliedFilters);
  };

  return (
    <>
      <MainHeader user={user!} />
      <AdminNav />
      <div className="ml-60 pt-14 min-h-screen bg-gray-50">
        <div className="p-6 max-w-5xl mx-auto">
          <h1 className="text-xl font-bold text-gray-900 mb-6">Audit Trail</h1>

          {/* Filter Bar */}
          <div className="bg-white border border-gray-200 rounded-lg p-4 mb-6">
            <div className="flex flex-wrap items-end gap-3">
              <div className="flex flex-col">
                <label className="text-xs font-medium text-gray-500 mb-1">Project</label>
                <select
                  className="border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white"
                  value={projectId}
                  onChange={e => setProjectId(e.target.value)}
                >
                  <option value="">All Projects</option>
                  {filters.projects.map((p: any) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col">
                <label className="text-xs font-medium text-gray-500 mb-1">Action</label>
                <select
                  className="border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white"
                  value={actionType}
                  onChange={e => setActionType(e.target.value)}
                >
                  <option value="">All Actions</option>
                  {filters.action_types.map((a: string) => (
                    <option key={a} value={a}>{a.replace(/_/g, ' ')}</option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col">
                <label className="text-xs font-medium text-gray-500 mb-1">Actor</label>
                <select
                  className="border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white"
                  value={actorId}
                  onChange={e => setActorId(e.target.value)}
                >
                  <option value="">All Actors</option>
                  {filters.actors.map((a: any) => (
                    <option key={a.id} value={a.id}>{a.name}</option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col">
                <label className="text-xs font-medium text-gray-500 mb-1">Date From</label>
                <input
                  type="date"
                  className="border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  value={dateFrom}
                  onChange={e => setDateFrom(e.target.value)}
                />
              </div>
              <div className="flex flex-col">
                <label className="text-xs font-medium text-gray-500 mb-1">Date To</label>
                <input
                  type="date"
                  className="border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  value={dateTo}
                  onChange={e => setDateTo(e.target.value)}
                />
              </div>
              <button
                onClick={handleApply}
                className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
              >
                Apply
              </button>
            </div>
          </div>

          {/* Content */}
          {loading ? (
            <div className="flex items-center justify-center py-20">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
            </div>
          ) : logs.length === 0 ? (
            <div className="bg-white border border-gray-200 rounded-lg p-12 text-center">
              <p className="text-gray-500 text-sm">No audit trail entries found.</p>
            </div>
          ) : (
            <>
              {/* Timeline */}
              <div className="space-y-3">
                {logs.map((log: any) => (
                  <div key={log.id} className="bg-white border border-gray-200 rounded-lg p-4 flex items-start gap-3">
                    <span className="text-xl mt-0.5">{ACTION_ICONS[log.action_type] || '\u2753'}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-gray-900">
                        <span className="font-semibold">{log.actor_name}</span>{' '}
                        {formatAction(log)}
                      </p>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="text-xs text-gray-400">{formatTimestamp(log.created_at)}</span>
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${ACTION_COLORS[log.action_type] || 'bg-gray-100 text-gray-700'}`}>
                          {log.action_type.replace(/_/g, ' ')}
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {/* Pagination */}
              {pages > 1 && (
                <div className="flex items-center justify-center gap-3 mt-6">
                  <button
                    onClick={() => goToPage(page - 1)}
                    disabled={page <= 1}
                    className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg bg-white hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    Prev
                  </button>
                  <span className="text-sm text-gray-600">Page {page} of {pages}</span>
                  <button
                    onClick={() => goToPage(page + 1)}
                    disabled={page >= pages}
                    className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg bg-white hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    Next
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
}
