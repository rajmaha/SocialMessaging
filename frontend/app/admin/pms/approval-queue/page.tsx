'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { pmsApi } from '@/lib/api';
import MainHeader from '@/components/MainHeader';
import AdminNav from '@/components/AdminNav';
import { authAPI } from '@/lib/auth';

const PRIORITY_DOT: Record<string, string> = { low: 'bg-gray-400', medium: 'bg-yellow-500', high: 'bg-orange-500', urgent: 'bg-red-500' };

export default function ApprovalQueuePage() {
  const user = authAPI.getUser();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'pm_review' | 'client_review'>('pm_review');
  const [actionNote, setActionNote] = useState('');
  const [actingOn, setActingOn] = useState<number | null>(null);

  const load = () => {
    setLoading(true);
    pmsApi.getApprovalQueue()
      .then(r => { setData(r.data); setLoading(false); })
      .catch(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const handleTransition = async (taskId: number, toStage: string) => {
    setActingOn(taskId);
    try {
      await pmsApi.transitionTask(taskId, { to_stage: toStage, note: actionNote || undefined });
      setActionNote('');
      setActingOn(null);
      load();
    } catch (e: any) {
      alert(e?.response?.data?.detail || 'Transition failed');
      setActingOn(null);
    }
  };

  if (!user) return null;

  const tasks = tab === 'pm_review' ? (data?.pm_review || []) : (data?.client_review || []);

  return (
    <div className="ml-0 md:ml-60 pt-14 min-h-screen bg-gray-50 pb-16 md:pb-0">
      <MainHeader user={user} />
      <AdminNav />
      <div className="p-6">
        <h1 className="text-2xl font-bold text-gray-900 mb-6">Approval Queue</h1>

        {/* Tabs */}
        <div className="flex gap-1 mb-6 bg-gray-100 rounded-lg p-1 w-fit">
          <button onClick={() => setTab('pm_review')}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${tab === 'pm_review' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
            Awaiting My Review
            {(data?.counts?.pm_review || 0) > 0 && (
              <span className="ml-2 bg-purple-100 text-purple-700 text-xs px-2 py-0.5 rounded-full">{data.counts.pm_review}</span>
            )}
          </button>
          <button onClick={() => setTab('client_review')}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${tab === 'client_review' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
            Client Review
            {(data?.counts?.client_review || 0) > 0 && (
              <span className="ml-2 bg-cyan-100 text-cyan-700 text-xs px-2 py-0.5 rounded-full">{data.counts.client_review}</span>
            )}
          </button>
        </div>

        {loading ? (
          <div className="text-gray-400 text-center py-20">Loading...</div>
        ) : tasks.length === 0 ? (
          <div className="text-gray-400 text-center py-20">No tasks awaiting review.</div>
        ) : (
          <div className="space-y-3">
            {tasks.map((t: any) => (
              <div key={t.id} className={`bg-white rounded-xl border p-5 ${t.is_overdue ? 'border-red-300' : 'border-gray-200'}`}>
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${PRIORITY_DOT[t.priority] || 'bg-gray-300'}`} />
                      <Link href={`/admin/pms/${t.project_id}`} className="font-semibold text-gray-900 hover:text-indigo-600 truncate">
                        {t.title}
                      </Link>
                    </div>
                    <div className="flex items-center gap-3 text-sm text-gray-500 flex-wrap">
                      <span className="flex items-center gap-1">
                        {t.project_color && <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: t.project_color }} />}
                        {t.project_name}
                      </span>
                      <span>&middot;</span>
                      <span>{t.assignee_name || 'Unassigned'}</span>
                      {t.days_in_stage != null && (
                        <>
                          <span>&middot;</span>
                          <span className={t.days_in_stage >= 3 ? 'text-amber-600 font-medium' : ''}>
                            {t.days_in_stage}d in {t.stage?.replace('_', ' ')}
                          </span>
                        </>
                      )}
                      {t.due_date && (
                        <>
                          <span>&middot;</span>
                          <span className={t.is_overdue ? 'text-red-600 font-medium' : ''}>Due: {t.due_date}</span>
                        </>
                      )}
                    </div>
                  </div>
                  {tab === 'pm_review' && (
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <input
                        value={actingOn === t.id ? actionNote : ''}
                        onChange={e => { setActingOn(t.id); setActionNote(e.target.value); }}
                        placeholder="Note (optional)"
                        className="border rounded px-2 py-1.5 text-xs w-40"
                      />
                      <button onClick={() => handleTransition(t.id, 'client_review')}
                        disabled={actingOn === t.id && actionNote === ''}
                        className="bg-green-600 text-white px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-green-700 disabled:opacity-50">
                        Approve
                      </button>
                      <button onClick={() => handleTransition(t.id, 'development')}
                        className="bg-red-50 text-red-600 px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-red-100">
                        Reject
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
