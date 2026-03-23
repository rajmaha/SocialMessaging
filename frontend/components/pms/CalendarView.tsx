'use client';
import { useState, useMemo } from 'react';

const PRIORITY_DOT: Record<string, string> = { low: 'bg-gray-400', medium: 'bg-yellow-500', high: 'bg-orange-500', urgent: 'bg-red-500' };
const STAGE_COLOR: Record<string, string> = { development: 'border-indigo-400', qa: 'border-amber-400', pm_review: 'border-purple-400', client_review: 'border-cyan-400', approved: 'border-green-400', completed: 'border-gray-300' };
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export default function CalendarView({ tasks, milestones, onTaskClick }: { tasks: any[]; milestones: any[]; onTaskClick?: (task: any) => void }) {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [view, setView] = useState<'month' | 'week'>('month');

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();

  const monthDays = useMemo(() => {
    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const days: (number | null)[] = [];
    for (let i = 0; i < firstDay; i++) days.push(null);
    for (let i = 1; i <= daysInMonth; i++) days.push(i);
    return days;
  }, [year, month]);

  const weekDays = useMemo(() => {
    const start = new Date(currentDate);
    start.setDate(start.getDate() - start.getDay());
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(start);
      d.setDate(d.getDate() + i);
      return d;
    });
  }, [currentDate]);

  const tasksByDate = useMemo(() => {
    const map: Record<string, any[]> = {};
    for (const t of tasks) {
      if (t.due_date) {
        const key = t.due_date.substring(0, 10);
        if (!map[key]) map[key] = [];
        map[key].push(t);
      }
    }
    return map;
  }, [tasks]);

  const milestonesByDate = useMemo(() => {
    const map: Record<string, any[]> = {};
    for (const m of milestones) {
      if (m.due_date) {
        const key = typeof m.due_date === 'string' ? m.due_date.substring(0, 10) : m.due_date;
        if (!map[key]) map[key] = [];
        map[key].push(m);
      }
    }
    return map;
  }, [milestones]);

  const todayStr = new Date().toISOString().substring(0, 10);

  const navigate = (dir: number) => {
    const d = new Date(currentDate);
    if (view === 'month') d.setMonth(d.getMonth() + dir);
    else d.setDate(d.getDate() + dir * 7);
    setCurrentDate(d);
  };

  const renderDayCell = (dateStr: string, dayNum?: number) => {
    const dayTasks = tasksByDate[dateStr] || [];
    const dayMilestones = milestonesByDate[dateStr] || [];
    const isToday = dateStr === todayStr;
    return (
      <div className={`min-h-[100px] border border-gray-100 p-1 ${isToday ? 'bg-indigo-50/50' : 'bg-white'}`}>
        <div className={`text-xs font-medium mb-0.5 ${isToday ? 'text-indigo-600' : 'text-gray-500'}`}>
          {dayNum ?? new Date(dateStr).getDate()}
        </div>
        {dayMilestones.map((m: any) => (
          <div key={`m-${m.id}`} className="text-xs px-1 py-0.5 mb-0.5 rounded bg-amber-100 text-amber-800 truncate flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full flex-none" style={{ background: m.color || '#f59e0b' }} />
            {m.name}
          </div>
        ))}
        {dayTasks.slice(0, 3).map((t: any) => (
          <div key={t.id} onClick={() => onTaskClick?.(t)}
            className={`text-xs px-1 py-0.5 mb-0.5 rounded border-l-2 bg-white cursor-pointer hover:bg-gray-50 truncate ${STAGE_COLOR[t.stage] || 'border-gray-300'}`}>
            <span className={`inline-block w-1.5 h-1.5 rounded-full mr-1 ${PRIORITY_DOT[t.priority] || 'bg-gray-300'}`} />
            {t.title}
          </div>
        ))}
        {dayTasks.length > 3 && <div className="text-xs text-gray-400 px-1">+{dayTasks.length - 3} more</div>}
      </div>
    );
  };

  return (
    <div className="p-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <button onClick={() => navigate(-1)} className="px-2 py-1 rounded border text-sm hover:bg-gray-50">&larr;</button>
          <h2 className="text-lg font-semibold text-gray-900">
            {view === 'month'
              ? currentDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
              : `Week of ${weekDays[0].toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`}
          </h2>
          <button onClick={() => navigate(1)} className="px-2 py-1 rounded border text-sm hover:bg-gray-50">&rarr;</button>
          <button onClick={() => setCurrentDate(new Date())} className="px-2 py-1 rounded border text-xs text-gray-600 hover:bg-gray-50 ml-2">Today</button>
        </div>
        <div className="flex border rounded overflow-hidden">
          <button onClick={() => setView('month')} className={`px-3 py-1 text-xs font-medium ${view === 'month' ? 'bg-indigo-600 text-white' : 'bg-white text-gray-600'}`}>Month</button>
          <button onClick={() => setView('week')} className={`px-3 py-1 text-xs font-medium ${view === 'week' ? 'bg-indigo-600 text-white' : 'bg-white text-gray-600'}`}>Week</button>
        </div>
      </div>

      {/* Calendar Grid */}
      <div className="border rounded-lg overflow-hidden">
        {/* Day headers */}
        <div className="grid grid-cols-7 bg-gray-50">
          {DAYS.map(d => <div key={d} className="text-xs font-medium text-gray-500 text-center py-2 border-b">{d}</div>)}
        </div>

        {view === 'month' ? (
          <div className="grid grid-cols-7">
            {monthDays.map((day, idx) => {
              if (day === null) return <div key={idx} className="min-h-[100px] border border-gray-100 bg-gray-50/50" />;
              const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
              return <div key={idx}>{renderDayCell(dateStr, day)}</div>;
            })}
          </div>
        ) : (
          <div className="grid grid-cols-7">
            {weekDays.map((d, idx) => {
              const dateStr = d.toISOString().substring(0, 10);
              return <div key={idx}>{renderDayCell(dateStr, d.getDate())}</div>;
            })}
          </div>
        )}
      </div>
    </div>
  );
}
