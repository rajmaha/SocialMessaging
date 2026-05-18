'use client';
import { useEffect, useState } from 'react';
import { worklogApi } from '@/lib/api';
import { API_URL } from '@/lib/config';
import { getAuthToken } from '@/lib/auth';
import MainHeader from '@/components/MainHeader';
import AdminNav from '@/components/AdminNav';
import { authAPI } from '@/lib/auth';

type Period = 'daily' | 'weekly' | 'monthly' | 'custom';

function getDateRange(period: Period, refDate: string): { start_date: string; end_date: string } {
  const d = new Date(refDate);
  if (period === 'daily') return { start_date: refDate, end_date: refDate };
  if (period === 'weekly') {
    const day = d.getDay();
    const start = new Date(d); start.setDate(d.getDate() - day);
    const end = new Date(start); end.setDate(start.getDate() + 6);
    return { start_date: start.toISOString().split('T')[0], end_date: end.toISOString().split('T')[0] };
  }
  if (period === 'monthly') {
    const start = new Date(d.getFullYear(), d.getMonth(), 1);
    const end = new Date(d.getFullYear(), d.getMonth() + 1, 0);
    return { start_date: start.toISOString().split('T')[0], end_date: end.toISOString().split('T')[0] };
  }
  return { start_date: refDate, end_date: refDate };
}

const SOURCE_COLORS: Record<string, string> = {
  manual: 'bg-indigo-100 text-indigo-700',
  pms: 'bg-purple-100 text-purple-700',
  messaging: 'bg-green-100 text-green-700',
  email: 'bg-blue-100 text-blue-700',
  call: 'bg-orange-100 text-orange-700',
};

export default function WorklogReports() {
  const user = authAPI.getUser();
  const [period, setPeriod] = useState<Period>('daily');
  const [refDate, setRefDate] = useState(new Date().toISOString().split('T')[0]);
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  const [sourceFilter, setSourceFilter] = useState('');
  const [agentFilter, setAgentFilter] = useState('');
  const [agents, setAgents] = useState<any[]>([]);
  const [report, setReport] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const token = getAuthToken();
    fetch(`${API_URL}/admin/users`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json())
      .then(data => setAgents(Array.isArray(data) ? data : []))
      .catch(() => {});
  }, []);

  const loadReport = async () => {
    setLoading(true);
    let params: any;
    if (period === 'custom') {
      params = { start_date: customStart, end_date: customEnd };
    } else {
      params = getDateRange(period, refDate);
    }
    if (sourceFilter) params.source = sourceFilter;
    if (agentFilter) params.user_id = agentFilter;
    const res = await worklogApi.getReport(params);
    setReport(res.data);
    setLoading(false);
  };

  const handleDownloadAttachment = async (id: number, fileName: string) => {
    const res = await worklogApi.downloadAttachment(id);
    const url = window.URL.createObjectURL(new Blob([res.data]));
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.click();
    window.URL.revokeObjectURL(url);
  };

  const handleExport = async (format: string) => {
    let params: any;
    if (period === 'custom') {
      params = { format, start_date: customStart, end_date: customEnd };
    } else {
      params = { format, ...getDateRange(period, refDate) };
    }
    if (sourceFilter) params.source = sourceFilter;
    if (agentFilter) params.user_id = agentFilter;
    const res = await worklogApi.exportReport(params);
    const url = window.URL.createObjectURL(new Blob([res.data]));
    const a = document.createElement('a');
    a.href = url;
    a.download = `worklog-report.${format}`;
    a.click();
    window.URL.revokeObjectURL(url);
  };

  useEffect(() => {
    if (period === 'custom' && (!customStart || !customEnd)) return;
    loadReport();
  }, [period, refDate, customStart, customEnd, sourceFilter, agentFilter]);

  return (
    <div className="ml-60 pt-14 min-h-screen bg-gray-50">
      <MainHeader user={user!} />
      <AdminNav />
      <div className="p-6 max-w-7xl">
        <h1 className="text-2xl font-bold text-gray-900 mb-6">Worklog Report</h1>

        {/* Filters */}
        <div className="bg-white border rounded-lg p-4 mb-4">
          <div className="flex flex-wrap gap-4 items-end">
            <div>
              <label className="text-xs text-gray-500 block mb-1">Period</label>
              <select value={period} onChange={e => setPeriod(e.target.value as Period)} className="border border-gray-300 rounded px-3 py-2 text-sm bg-white">
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
                <option value="custom">Custom Range</option>
              </select>
            </div>
            {period !== 'custom' && (
              <div>
                <label className="text-xs text-gray-500 block mb-1">Reference Date</label>
                <input type="date" value={refDate} onChange={e => setRefDate(e.target.value)} className="border border-gray-300 rounded px-3 py-2 text-sm bg-white h-[38px]" />
              </div>
            )}
            {period === 'custom' && (
              <>
                <div>
                  <label className="text-xs text-gray-500 block mb-1">Start</label>
                  <input type="date" value={customStart} onChange={e => setCustomStart(e.target.value)} className="border border-gray-300 rounded px-3 py-2 text-sm bg-white h-[38px]" />
                </div>
                <div>
                  <label className="text-xs text-gray-500 block mb-1">End</label>
                  <input type="date" value={customEnd} onChange={e => setCustomEnd(e.target.value)} className="border border-gray-300 rounded px-3 py-2 text-sm bg-white h-[38px]" />
                </div>
              </>
            )}
            <div>
              <label className="text-xs text-gray-500 block mb-1">Agent</label>
              <select value={agentFilter} onChange={e => setAgentFilter(e.target.value)} className="border border-gray-300 rounded px-3 py-2 text-sm bg-white">
                <option value="">All Agents</option>
                {agents.map((a: any) => (
                  <option key={a.id} value={a.id}>{a.full_name || a.email}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">Source</label>
              <select value={sourceFilter} onChange={e => setSourceFilter(e.target.value)} className="border border-gray-300 rounded px-3 py-2 text-sm bg-white">
                <option value="">All Sources</option>
                <option value="manual">Manual</option>
                <option value="pms">PMS Tasks</option>
                <option value="messaging">Messaging</option>
                <option value="email">Email</option>
                <option value="call">Calls</option>
              </select>
            </div>
            <div className="flex gap-2 ml-auto">
              <button onClick={() => handleExport('csv')} className="px-3 py-2 bg-green-600 text-white rounded text-sm font-medium hover:bg-green-700">Export CSV</button>
              <button onClick={() => handleExport('pdf')} className="px-3 py-2 bg-red-600 text-white rounded text-sm font-medium hover:bg-red-700">Export PDF</button>
            </div>
          </div>
        </div>

        {/* Summary Cards */}
        {report && (
          <div className="grid grid-cols-2 md:grid-cols-6 gap-3 mb-4">
            <div className="bg-white border rounded-lg p-3 text-center">
              <div className="text-2xl font-bold text-gray-900">{report.total_hours}h</div>
              <div className="text-xs text-gray-500">Total</div>
            </div>
            {Object.entries(report.breakdown as Record<string, number>).map(([src, hrs]) => (
              <div key={src} className="bg-white border rounded-lg p-3 text-center">
                <div className="text-xl font-bold text-gray-900">{(hrs as number).toFixed(1)}h</div>
                <div className="text-xs text-gray-500 capitalize">{src}</div>
              </div>
            ))}
          </div>
        )}

        {/* Report Table */}
        <div className="bg-white border rounded-lg overflow-hidden">
          {loading ? (
            <div className="p-8 text-center text-gray-500">Loading report...</div>
          ) : !report || report.rows.length === 0 ? (
            <div className="p-8 text-center text-gray-500">No data for selected period.</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b">
                <tr>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Agent</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Date</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Source</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Category / Project</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Task / Conversation</th>
                  <th className="text-right px-4 py-3 font-medium text-gray-600">Hours</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Summary</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Attachments</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {report.rows.map((row: any, i: number) => (
                  <tr key={i} className={row.is_late_entry ? 'bg-amber-50' : ''}>
                    <td className="px-4 py-3 font-medium text-gray-900">
                      {row.user_name}
                      {row.is_late_entry && <span className="ml-1 text-amber-600" title="Late entry">&#9888;</span>}
                    </td>
                    <td className="px-4 py-3 text-gray-600">{row.log_date}</td>
                    <td className="px-4 py-3">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${SOURCE_COLORS[row.source] || ''}`}>{row.source}</span>
                    </td>
                    <td className="px-4 py-3 text-gray-600">{row.category_or_project || '—'}</td>
                    <td className="px-4 py-3 text-gray-600">{row.task_or_conversation || '—'}</td>
                    <td className="px-4 py-3 text-right font-bold">{row.hours}h</td>
                    <td className="px-4 py-3 text-gray-600 max-w-xs truncate">{row.summary ? <span dangerouslySetInnerHTML={{ __html: row.summary }} /> : '—'}</td>
                    <td className="px-4 py-3">
                      {row.attachments?.length > 0 ? (
                        <div className="flex gap-1 flex-wrap">
                          {row.attachments.map((a: any) => (
                            <button key={a.id} onClick={() => handleDownloadAttachment(a.id, a.file_name)}
                              className="text-xs bg-gray-100 px-2 py-0.5 rounded text-indigo-600 hover:text-indigo-800 hover:bg-gray-200 cursor-pointer">{a.file_name}</button>
                          ))}
                        </div>
                      ) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
