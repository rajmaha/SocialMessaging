'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { pmsApi } from '@/lib/api';
import MainHeader from '@/components/MainHeader';
import AdminNav from '@/components/AdminNav';
import { authAPI } from '@/lib/auth';

const SEVERITY_STYLES: Record<string, { border: string; badge: string; bg: string }> = {
  critical: { border: 'border-l-red-600', badge: 'bg-red-100 text-red-700', bg: 'bg-red-50' },
  high:     { border: 'border-l-orange-500', badge: 'bg-orange-100 text-orange-700', bg: 'bg-orange-50' },
  medium:   { border: 'border-l-yellow-400', badge: 'bg-yellow-100 text-yellow-700', bg: 'bg-yellow-50' },
};

const SEVERITY_ORDER: Record<string, number> = { critical: 0, high: 1, medium: 2 };

const TRIGGER_COLORS: Record<string, string> = {
  overdue: 'bg-red-100 text-red-700',
  hours_exceeded: 'bg-orange-100 text-orange-700',
  stuck: 'bg-amber-100 text-amber-700',
};

export default function EscalationsPage() {
  const user = authAPI.getUser();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    pmsApi.getEscalations()
      .then((r: any) => { setData(r.data); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  if (!user) return null;

  const counts = data?.counts || { critical: 0, high: 0, medium: 0 };
  const escalations = (data?.escalations || [])
    .slice()
    .sort((a: any, b: any) => (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9));

  return (
    <div className="ml-0 md:ml-60 pt-14 min-h-screen bg-gray-50 pb-16 md:pb-0">
      <MainHeader user={user} />
      <AdminNav />
      <div className="p-6">
        <h1 className="text-2xl font-bold text-gray-900 mb-6">Escalations</h1>

        {/* Summary Bar */}
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4 mb-6">
          <div className="bg-white rounded-xl border border-red-200 p-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-red-100 flex items-center justify-center">
              <span className="text-red-600 font-bold text-lg">{counts.critical}</span>
            </div>
            <div>
              <div className="text-sm font-medium text-gray-500">Critical</div>
              <div className="text-xs text-red-600">Immediate attention</div>
            </div>
          </div>
          <div className="bg-white rounded-xl border border-orange-200 p-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-orange-100 flex items-center justify-center">
              <span className="text-orange-600 font-bold text-lg">{counts.high}</span>
            </div>
            <div>
              <div className="text-sm font-medium text-gray-500">High</div>
              <div className="text-xs text-orange-600">Needs review</div>
            </div>
          </div>
          <div className="bg-white rounded-xl border border-yellow-200 p-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-yellow-100 flex items-center justify-center">
              <span className="text-yellow-600 font-bold text-lg">{counts.medium}</span>
            </div>
            <div>
              <div className="text-sm font-medium text-gray-500">Medium</div>
              <div className="text-xs text-yellow-600">Monitor</div>
            </div>
          </div>
        </div>

        {/* Content */}
        {loading ? (
          <div className="text-gray-400 text-center py-20">Loading...</div>
        ) : escalations.length === 0 ? (
          <div className="text-center py-20">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-green-100 mb-4">
              <svg className="w-8 h-8 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <div className="text-green-600 font-semibold text-lg">No escalations. All clear!</div>
          </div>
        ) : (
          <div className="space-y-3">
            {escalations.map((e: any) => {
              const styles = SEVERITY_STYLES[e.severity] || SEVERITY_STYLES.medium;
              return (
                <div key={e.id} className={`bg-white rounded-xl border border-gray-200 border-l-4 ${styles.border} p-5`}>
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <Link href={`/admin/pms/${e.project_id}`} className="font-semibold text-gray-900 hover:text-indigo-600 truncate">
                          {e.title}
                        </Link>
                      </div>
                      <div className="flex items-center gap-3 text-sm text-gray-500 flex-wrap mb-2">
                        <span className="flex items-center gap-1">
                          {e.project_color && <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: e.project_color }} />}
                          {e.project_name}
                        </span>
                        <span>&middot;</span>
                        <span>{e.assignee_name || 'Unassigned'}</span>
                        <span>&middot;</span>
                        <span>{e.stage?.replace(/_/g, ' ')}</span>
                        {e.due_date && (
                          <>
                            <span>&middot;</span>
                            <span>Due: {e.due_date}</span>
                          </>
                        )}
                      </div>
                      {/* Triggers */}
                      {e.triggers && e.triggers.length > 0 && (
                        <div className="flex items-center gap-2 flex-wrap">
                          {e.triggers.map((t: any, i: number) => (
                            <span key={i} className={`text-xs px-2 py-0.5 rounded-full font-medium ${TRIGGER_COLORS[t.type] || 'bg-gray-100 text-gray-600'}`}>
                              {t.detail}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="flex flex-col items-end gap-2 flex-shrink-0">
                      <span className={`text-xs px-2.5 py-1 rounded-full font-semibold capitalize ${styles.badge}`}>
                        {e.severity}
                      </span>
                      {(e.estimated_hours != null || e.actual_hours != null) && (
                        <span className="text-xs text-gray-500">
                          {e.actual_hours ?? 0}h / {e.estimated_hours ?? 0}h
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
