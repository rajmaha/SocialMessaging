'use client';
import { useEffect, useState } from 'react';
import { pmsApi } from '@/lib/api';
import MainHeader from '@/components/MainHeader';
import AdminNav from '@/components/AdminNav';
import { authAPI } from '@/lib/auth';

const STAGE_COLORS: Record<string, string> = {
  development: '#6366f1', qa: '#f59e0b', pm_review: '#a855f7',
  client_review: '#06b6d4', approved: '#22c55e',
};

function EffBadge({ value }: { value: number | null }) {
  if (value === null) return <span className="text-xs text-gray-400">—</span>;
  const c = value >= 80 ? 'bg-green-100 text-green-700' : value >= 50 ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700';
  return <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${c}`}>{value}%</span>;
}

export default function TeamWorkloadPage() {
  const user = authAPI.getUser();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [projectId, setProjectId] = useState<string>('');
  const [sortBy, setSortBy] = useState('active_tasks');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  useEffect(() => {
    setLoading(true);
    pmsApi.getTeamWorkload({ project_id: projectId || undefined })
      .then(r => { setData(r.data); setLoading(false); })
      .catch(() => setLoading(false));
  }, [projectId]);

  const _toggleSort = (field: string) => {
    if (sortBy === field) setSortDir(d => d === 'desc' ? 'asc' : 'desc');
    else { setSortBy(field); setSortDir('desc'); }
  };

  const sorted = (data?.members || []).slice().sort((a: any, b: any) => {
    const av = a[sortBy] ?? 0;
    const bv = b[sortBy] ?? 0;
    return sortDir === 'desc' ? bv - av : av - bv;
  });

  if (!user) return null;

  return (
    <div className="ml-60 pt-14 min-h-screen bg-gray-50">
      <MainHeader user={user} />
      <AdminNav />
      <div className="p-6">
        <div className="flex justify-between items-center mb-6">
          <h1 className="text-2xl font-bold text-gray-900">Team Workload</h1>
          <select value={projectId} onChange={e => setProjectId(e.target.value)}
            className="border rounded-lg px-3 py-2 text-sm">
            <option value="">All Projects</option>
            {(data?.projects || []).map((p: any) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </div>

        {loading ? (
          <div className="text-gray-400 text-center py-20">Loading...</div>
        ) : sorted.length === 0 ? (
          <div className="text-gray-400 text-center py-20">No team members found.</div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {sorted.map((m: any) => (
              <div key={m.user_id} className="bg-white rounded-xl border border-gray-200 p-5 hover:shadow-md transition-shadow">
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-10 h-10 rounded-full bg-indigo-100 flex items-center justify-center text-indigo-700 font-semibold text-sm">
                    {(m.name || '?')[0]?.toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="font-semibold text-gray-900 truncate">{m.name}</h3>
                    <p className="text-xs text-gray-500 capitalize">{m.role}</p>
                  </div>
                  <EffBadge value={m.efficiency} />
                </div>

                <div className="grid grid-cols-3 gap-2 text-center mb-3">
                  <div>
                    <p className="text-lg font-bold text-gray-900">{m.active_tasks}</p>
                    <p className="text-xs text-gray-500">Tasks</p>
                  </div>
                  <div>
                    <p className="text-lg font-bold text-gray-900">{m.actual_hours}<span className="text-sm text-gray-400">/{m.estimated_hours}</span></p>
                    <p className="text-xs text-gray-500">Hours</p>
                  </div>
                  <div>
                    <p className={`text-lg font-bold ${m.overdue_count > 0 ? 'text-red-600' : 'text-gray-900'}`}>{m.overdue_count}</p>
                    <p className="text-xs text-gray-500">Overdue</p>
                  </div>
                </div>

                {/* Stage breakdown bar */}
                {m.active_tasks > 0 && (
                  <div className="flex rounded-full overflow-hidden h-2 bg-gray-100">
                    {Object.entries(m.stage_breakdown || {}).map(([stage, count]: [string, any]) => (
                      <div key={stage} style={{
                        width: `${(count / m.active_tasks) * 100}%`,
                        backgroundColor: STAGE_COLORS[stage] || '#9ca3af',
                      }} title={`${stage}: ${count}`} />
                    ))}
                  </div>
                )}
                {m.active_tasks > 0 && (
                  <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1.5">
                    {Object.entries(m.stage_breakdown || {}).map(([stage, count]: [string, any]) => (
                      <span key={stage} className="text-xs text-gray-400">{stage.replace('_', ' ')}: {count}</span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
