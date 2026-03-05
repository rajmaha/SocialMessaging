'use client';
import { useEffect, useState } from 'react';
import { pmsApi } from '@/lib/api';
import MainHeader from '@/components/MainHeader';
import AdminNav from '@/components/AdminNav';
import { authAPI } from '@/lib/auth';

const RANGES = [
  { label: 'This Week', value: 'this_week' },
  { label: 'Next 2 Weeks', value: 'next_2_weeks' },
  { label: 'This Month', value: 'this_month' },
  { label: 'Next Month', value: 'next_month' },
] as const;

function UtilBar({ pct }: { pct: number }) {
  const color = pct > 100 ? 'bg-red-500' : pct >= 80 ? 'bg-amber-500' : 'bg-green-500';
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-2 bg-gray-200 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${Math.min(pct, 100)}%` }} />
      </div>
      <span className={`text-xs font-medium w-10 text-right ${pct > 100 ? 'text-red-600' : pct >= 80 ? 'text-amber-600' : 'text-green-600'}`}>
        {pct}%
      </span>
    </div>
  );
}

export default function CapacityPlanningPage() {
  const user = authAPI.getUser();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [projectId, setProjectId] = useState<string>('');
  const [range, setRange] = useState<string>('this_week');
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editValue, setEditValue] = useState<string>('');
  const [saving, setSaving] = useState(false);

  const fetchData = () => {
    setLoading(true);
    const params: any = { range };
    if (projectId) params.project_id = projectId;
    pmsApi.getCapacity(params)
      .then(r => { setData(r.data); setLoading(false); })
      .catch(() => setLoading(false));
  };

  useEffect(() => { fetchData(); }, [projectId, range]);

  const handleSaveHours = async (memberId: number) => {
    const hours = parseFloat(editValue);
    if (isNaN(hours) || hours < 0) return;
    setSaving(true);
    try {
      await pmsApi.updateMemberHours(memberId, hours);
      setEditingId(null);
      fetchData();
    } catch {
      // keep editing state on error
    } finally {
      setSaving(false);
    }
  };

  if (!user) return null;

  const summary = data?.summary;
  const members = data?.members || [];

  return (
    <div className="ml-60 pt-14 min-h-screen bg-gray-50">
      <MainHeader user={user} />
      <AdminNav />
      <div className="p-6">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
          <h1 className="text-2xl font-bold text-gray-900">Capacity Planning</h1>
          <div className="flex items-center gap-3">
            <select
              value={projectId}
              onChange={e => setProjectId(e.target.value)}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white"
            >
              <option value="">All Projects</option>
              {(data?.projects || []).map((p: any) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
            <div className="flex bg-white border border-gray-300 rounded-lg overflow-hidden">
              {RANGES.map(r => (
                <button
                  key={r.value}
                  onClick={() => setRange(r.value)}
                  className={`px-3 py-2 text-sm font-medium transition-colors ${
                    range === r.value
                      ? 'bg-indigo-600 text-white'
                      : 'text-gray-600 hover:bg-gray-100'
                  }`}
                >
                  {r.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {loading ? (
          <div className="text-gray-400 text-center py-20">Loading...</div>
        ) : !summary ? (
          <div className="text-gray-400 text-center py-20">No capacity data available.</div>
        ) : (
          <>
            {/* Summary Cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
              <div className="bg-white rounded-xl border border-gray-200 p-4">
                <p className="text-sm text-gray-500">Business Days</p>
                <p className="text-2xl font-bold text-gray-900">{summary.business_days}</p>
              </div>
              <div className="bg-white rounded-xl border border-gray-200 p-4">
                <p className="text-sm text-gray-500">Team Capacity</p>
                <p className="text-2xl font-bold text-gray-900">{summary.total_capacity}h</p>
              </div>
              <div className="bg-white rounded-xl border border-gray-200 p-4">
                <p className="text-sm text-gray-500">Committed</p>
                <p className="text-2xl font-bold text-gray-900">{summary.total_committed}h</p>
              </div>
              <div className="bg-white rounded-xl border border-gray-200 p-4">
                <p className="text-sm text-gray-500">Available</p>
                <p className={`text-2xl font-bold ${summary.total_available >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                  {summary.total_available}h
                </p>
              </div>
            </div>

            {/* Date Range */}
            {data?.range && (
              <p className="text-xs text-gray-400 mb-3">
                {data.range.start} &mdash; {data.range.end}
              </p>
            )}

            {/* Members Table */}
            {members.length === 0 ? (
              <div className="text-gray-400 text-center py-20">No team members found.</div>
            ) : (
              <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-200 bg-gray-50">
                      <th className="text-left px-4 py-3 font-medium text-gray-600">Member</th>
                      <th className="text-left px-4 py-3 font-medium text-gray-600">Role</th>
                      <th className="text-left px-4 py-3 font-medium text-gray-600">Hours/Day</th>
                      <th className="text-right px-4 py-3 font-medium text-gray-600">Capacity</th>
                      <th className="text-right px-4 py-3 font-medium text-gray-600">Committed</th>
                      <th className="text-right px-4 py-3 font-medium text-gray-600">Available</th>
                      <th className="px-4 py-3 font-medium text-gray-600 w-48">Utilization</th>
                    </tr>
                  </thead>
                  <tbody>
                    {members.map((m: any) => (
                      <tr key={m.member_id} className="border-b border-gray-100 hover:bg-gray-50">
                        <td className="px-4 py-3 font-medium text-gray-900">{m.name}</td>
                        <td className="px-4 py-3 text-gray-500 capitalize">{m.role}</td>
                        <td className="px-4 py-3">
                          {editingId === m.member_id ? (
                            <div className="flex items-center gap-1">
                              <input
                                type="number"
                                step="0.5"
                                min="0"
                                max="24"
                                value={editValue}
                                onChange={e => setEditValue(e.target.value)}
                                className="w-16 border border-gray-300 rounded px-2 py-1 text-sm"
                                autoFocus
                                onKeyDown={e => {
                                  if (e.key === 'Enter') handleSaveHours(m.member_id);
                                  if (e.key === 'Escape') setEditingId(null);
                                }}
                              />
                              <button
                                onClick={() => handleSaveHours(m.member_id)}
                                disabled={saving}
                                className="text-xs bg-indigo-600 text-white px-2 py-1 rounded hover:bg-indigo-700 disabled:opacity-50"
                              >
                                {saving ? '...' : 'Save'}
                              </button>
                              <button
                                onClick={() => setEditingId(null)}
                                className="text-xs text-gray-400 hover:text-gray-600 px-1"
                              >
                                Cancel
                              </button>
                            </div>
                          ) : (
                            <button
                              onClick={() => { setEditingId(m.member_id); setEditValue(String(m.hours_per_day)); }}
                              className="text-indigo-600 hover:underline cursor-pointer"
                              title="Click to edit"
                            >
                              {m.hours_per_day}
                            </button>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right text-gray-900">{m.capacity}h</td>
                        <td className="px-4 py-3 text-right text-gray-900">{m.committed}h</td>
                        <td className={`px-4 py-3 text-right font-medium ${m.available >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                          {m.available}h
                        </td>
                        <td className="px-4 py-3">
                          <UtilBar pct={m.utilization_pct} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
