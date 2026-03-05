'use client';
import { useEffect, useState } from 'react';
import { pmsApi } from '@/lib/api';
import MainHeader from '@/components/MainHeader';
import AdminNav from '@/components/AdminNav';
import { authAPI } from '@/lib/auth';
import {
  LineChart, Line, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer
} from 'recharts';

const PRIORITY_COLORS: Record<string, string> = { low: '#9ca3af', medium: '#eab308', high: '#f97316', urgent: '#ef4444' };
const PROJECT_COLORS = ['#6366f1', '#3b82f6', '#22c55e', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6'];

export default function ReportsPage() {
  const user = authAPI.getUser();
  const [data, setData] = useState<any>(null);
  const [projects, setProjects] = useState<any[]>([]);
  const [projectId, setProjectId] = useState<string>('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => { pmsApi.listProjects().then(r => setProjects(r.data)); }, []);

  useEffect(() => {
    setLoading(true);
    const params: any = {};
    if (projectId) params.project_id = projectId;
    if (startDate) params.start_date = startDate;
    if (endDate) params.end_date = endDate;
    pmsApi.getReports(params)
      .then(r => { setData(r.data); setLoading(false); })
      .catch(() => setLoading(false));
  }, [projectId, startDate, endDate]);

  return (
    <>
      <MainHeader user={user!} />
      <AdminNav />
      <div className="ml-60 pt-14 min-h-screen bg-gray-50">
        <div className="p-6 max-w-7xl mx-auto">
          {/* Top Bar */}
          <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
            <h1 className="text-xl font-bold text-gray-900">Reports &amp; Analytics</h1>
            <div className="flex flex-wrap items-center gap-3">
              <select
                className="border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white"
                value={projectId}
                onChange={e => setProjectId(e.target.value)}
              >
                <option value="">All Projects</option>
                {projects.map((p: any) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
              <input
                type="date"
                className="border border-gray-300 rounded-lg px-3 py-2 text-sm"
                value={startDate}
                onChange={e => setStartDate(e.target.value)}
              />
              <input
                type="date"
                className="border border-gray-300 rounded-lg px-3 py-2 text-sm"
                value={endDate}
                onChange={e => setEndDate(e.target.value)}
              />
            </div>
          </div>

          {loading && (
            <p className="text-center text-gray-500 py-20">Loading reports...</p>
          )}

          {!loading && !data && (
            <p className="text-center text-gray-500 py-20">No data available for the selected filters.</p>
          )}

          {!loading && data && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* 1. Burndown Chart */}
              {data.burndown && data.burndown.length > 0 && (
                <div className="bg-white rounded-xl border border-gray-200 p-5">
                  <h3 className="text-sm font-semibold text-gray-700 mb-3">Burndown Chart</h3>
                  <ResponsiveContainer width="100%" height={250}>
                    <LineChart data={data.burndown}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="date" tick={{ fontSize: 12 }} />
                      <YAxis tick={{ fontSize: 12 }} />
                      <Tooltip />
                      <Legend />
                      <Line type="monotone" dataKey="remaining" stroke="#3b82f6" name="Remaining" strokeWidth={2} />
                      <Line type="monotone" dataKey="ideal" stroke="#9ca3af" name="Ideal" strokeDasharray="5 5" strokeWidth={2} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}

              {/* 2. Velocity */}
              {data.velocity && data.velocity.length > 0 && (
                <div className="bg-white rounded-xl border border-gray-200 p-5">
                  <h3 className="text-sm font-semibold text-gray-700 mb-3">Velocity</h3>
                  <ResponsiveContainer width="100%" height={250}>
                    <BarChart data={data.velocity}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="week" tick={{ fontSize: 12 }} />
                      <YAxis tick={{ fontSize: 12 }} />
                      <Tooltip />
                      <Bar dataKey="completed" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}

              {/* 3. Stage Cycle Time */}
              {data.avg_stage_times && Object.keys(data.avg_stage_times).length > 0 && (
                <div className="bg-white rounded-xl border border-gray-200 p-5">
                  <h3 className="text-sm font-semibold text-gray-700 mb-3">Stage Cycle Time</h3>
                  <ResponsiveContainer width="100%" height={250}>
                    <BarChart
                      layout="vertical"
                      data={Object.entries(data.avg_stage_times).map(([stage, days]) => ({ stage: stage.replace('_', ' '), days }))}
                    >
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis type="number" tick={{ fontSize: 12 }} />
                      <YAxis type="category" dataKey="stage" tick={{ fontSize: 12 }} width={100} />
                      <Tooltip />
                      <Bar dataKey="days" fill="#6366f1" radius={[0, 4, 4, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}

              {/* 4. Priority Distribution */}
              {data.priority_distribution && Object.keys(data.priority_distribution).length > 0 && (
                <div className="bg-white rounded-xl border border-gray-200 p-5">
                  <h3 className="text-sm font-semibold text-gray-700 mb-3">Priority Distribution</h3>
                  <ResponsiveContainer width="100%" height={250}>
                    <PieChart>
                      <Pie
                        data={Object.entries(data.priority_distribution).map(([name, value]) => ({ name, value }))}
                        cx="50%"
                        cy="50%"
                        outerRadius={90}
                        dataKey="value"
                        label={({ name, percent }: any) => `${name} ${(percent * 100).toFixed(0)}%`}
                      >
                        {Object.entries(data.priority_distribution).map(([name]) => (
                          <Cell key={name} fill={PRIORITY_COLORS[name] || '#6366f1'} />
                        ))}
                      </Pie>
                      <Tooltip />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              )}

              {/* 5. Milestone Progress */}
              {data.milestone_progress && data.milestone_progress.length > 0 && (
                <div className="bg-white rounded-xl border border-gray-200 p-5">
                  <h3 className="text-sm font-semibold text-gray-700 mb-3">Milestone Progress</h3>
                  <div className="max-h-[250px] overflow-y-auto">
                    {data.milestone_progress.map((ms: any) => (
                      <div key={ms.id} className="mb-3">
                        <div className="flex justify-between text-sm mb-1">
                          <span className="font-medium text-gray-700">{ms.name}</span>
                          <span className="text-gray-500">{ms.completed}/{ms.total} ({ms.pct}%)</span>
                        </div>
                        <div className="w-full bg-gray-100 rounded-full h-2">
                          <div className="h-2 rounded-full bg-indigo-500" style={{ width: `${ms.pct}%` }} />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* 6. Hours: Estimated vs Actual */}
              {data.hours_comparison && data.hours_comparison.length > 0 && (
                <div className="bg-white rounded-xl border border-gray-200 p-5">
                  <h3 className="text-sm font-semibold text-gray-700 mb-3">Hours: Estimated vs Actual</h3>
                  <ResponsiveContainer width="100%" height={250}>
                    <BarChart data={data.hours_comparison}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="project" tick={{ fontSize: 12 }} />
                      <YAxis tick={{ fontSize: 12 }} />
                      <Tooltip />
                      <Legend />
                      <Bar dataKey="estimated" fill="#3b82f6" name="Estimated" radius={[4, 4, 0, 0]} />
                      <Bar dataKey="actual" fill="#6366f1" name="Actual" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}

              {/* 7. Per-Member Workload */}
              {data.member_workload && data.member_workload.length > 0 && (
                <div className="bg-white rounded-xl border border-gray-200 p-5">
                  <h3 className="text-sm font-semibold text-gray-700 mb-3">Per-Member Workload</h3>
                  <ResponsiveContainer width="100%" height={250}>
                    <BarChart layout="vertical" data={data.member_workload}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis type="number" tick={{ fontSize: 12 }} />
                      <YAxis type="category" dataKey="name" tick={{ fontSize: 12 }} width={100} />
                      <Tooltip />
                      <Legend />
                      <Bar dataKey="low" stackId="a" fill={PRIORITY_COLORS.low} name="Low" />
                      <Bar dataKey="medium" stackId="a" fill={PRIORITY_COLORS.medium} name="Medium" />
                      <Bar dataKey="high" stackId="a" fill={PRIORITY_COLORS.high} name="High" />
                      <Bar dataKey="urgent" stackId="a" fill={PRIORITY_COLORS.urgent} name="Urgent" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}

              {/* 8. Per-Member Completion */}
              {data.member_completion && data.member_completion.length > 0 && (
                <div className="bg-white rounded-xl border border-gray-200 p-5">
                  <h3 className="text-sm font-semibold text-gray-700 mb-3">Per-Member Completion</h3>
                  <ResponsiveContainer width="100%" height={250}>
                    <BarChart data={data.member_completion}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                      <YAxis tick={{ fontSize: 12 }} />
                      <Tooltip />
                      <Legend />
                      <Bar dataKey="assigned" fill="#9ca3af" name="Assigned" radius={[4, 4, 0, 0]} />
                      <Bar dataKey="completed" fill="#22c55e" name="Completed" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}

              {/* 9. Per-Member Efficiency */}
              {data.member_efficiency && data.member_efficiency.length > 0 && (
                <div className="bg-white rounded-xl border border-gray-200 p-5">
                  <h3 className="text-sm font-semibold text-gray-700 mb-3">Per-Member Efficiency</h3>
                  <ResponsiveContainer width="100%" height={250}>
                    <BarChart data={data.member_efficiency}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                      <YAxis tick={{ fontSize: 12 }} />
                      <Tooltip />
                      <Bar dataKey="efficiency" name="Efficiency %">
                        {data.member_efficiency.map((entry: any, idx: number) => (
                          <Cell
                            key={idx}
                            fill={entry.efficiency >= 80 ? '#22c55e' : entry.efficiency >= 50 ? '#eab308' : '#ef4444'}
                          />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}

              {/* 10. Project Efficiency */}
              {data.project_efficiency !== undefined && (
                <div className="bg-white rounded-xl border border-gray-200 p-5">
                  <h3 className="text-sm font-semibold text-gray-700 mb-3">Project Efficiency</h3>
                  <div className="flex flex-col items-center justify-center h-[250px]">
                    <p
                      className="text-6xl font-bold"
                      style={{
                        color: data.project_efficiency === null
                          ? '#6b7280'
                          : data.project_efficiency >= 80
                            ? '#15803d'
                            : data.project_efficiency >= 50
                              ? '#d97706'
                              : '#dc2626'
                      }}
                    >
                      {data.project_efficiency ?? '\u2014'}%
                    </p>
                    <p className="text-sm text-gray-500 mt-2">Overall Efficiency</p>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── Admin-Only: Project Comparison & Team Velocity ──── */}
          {!loading && data && user?.role === 'admin' && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-6">
              {/* Project Comparison Bar Chart */}
              {data.project_comparison && data.project_comparison.length > 0 && (
                <div className="bg-white rounded-xl border border-gray-200 p-5">
                  <h3 className="text-sm font-semibold text-gray-700 mb-1">Project Comparison</h3>
                  <p className="text-xs text-gray-400 mb-3">Completion, efficiency &amp; on-time rate per project</p>
                  <ResponsiveContainer width="100%" height={280}>
                    <BarChart data={data.project_comparison}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="name" tick={{ fontSize: 11 }} interval={0} angle={-20} textAnchor="end" height={50} />
                      <YAxis tick={{ fontSize: 12 }} domain={[0, 100]} />
                      <Tooltip />
                      <Legend />
                      <Bar dataKey="completion_pct" fill="#6366f1" name="Completion %" radius={[4, 4, 0, 0]} />
                      <Bar dataKey="efficiency" fill="#3b82f6" name="Efficiency %" radius={[4, 4, 0, 0]} />
                      <Bar dataKey="on_time_pct" fill="#22c55e" name="On-Time %" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}

              {/* Team Velocity Comparison Line Chart */}
              {data.team_velocity && data.team_velocity.length > 0 && (
                <div className="bg-white rounded-xl border border-gray-200 p-5">
                  <h3 className="text-sm font-semibold text-gray-700 mb-1">Team Velocity Comparison</h3>
                  <p className="text-xs text-gray-400 mb-3">Completed tasks per week across projects</p>
                  <ResponsiveContainer width="100%" height={280}>
                    <LineChart data={data.team_velocity}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="week" tick={{ fontSize: 12 }} />
                      <YAxis tick={{ fontSize: 12 }} />
                      <Tooltip />
                      <Legend />
                      {Object.keys(data.team_velocity[0] || {})
                        .filter((k: string) => k !== 'week')
                        .map((projectName: string, i: number) => (
                          <Line
                            key={projectName}
                            type="monotone"
                            dataKey={projectName}
                            stroke={PROJECT_COLORS[i % PROJECT_COLORS.length]}
                            strokeWidth={2}
                            dot={{ r: 3 }}
                          />
                        ))}
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
