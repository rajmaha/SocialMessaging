'use client';
import { useEffect, useRef, useState, useCallback } from 'react';
import { pmsApi } from '@/lib/api';
import TaskDetailPanel from './TaskDetailPanel';

interface GanttTask {
  id: number; title: string; stage: string; priority: string;
  start_date: string | null; due_date: string | null;
  milestone_id: number | null; parent_task_id: number | null;
  assignee_name: string | null; estimated_hours: number; actual_hours: number;
  dependencies: { id: number; task_id: number; depends_on_id: number; type: string }[];
}
interface Milestone { id: number; name: string; due_date: string; color: string; }
type ZoomLevel = 'day' | 'week' | 'month' | 'quarter';

const ROW_H = 36;
const LEFT_W = 260;
const STAGE_COLORS: Record<string, string> = {
  development: '#6366f1', qa: '#f59e0b', pm_review: '#8b5cf6',
  client_review: '#06b6d4', approved: '#10b981', completed: '#6b7280',
};
const ZOOM_PX: Record<ZoomLevel, number> = { day: 40, week: 14, month: 4, quarter: 2 };

function EffBadge({ value }: { value: number | null }) {
  if (value === null || value === undefined) return null;
  const c = value >= 80 ? 'bg-green-100 text-green-700' : value >= 50 ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700';
  return <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${c}`}>{value}%</span>;
}

function parseDate(d: string | null): Date | null { return d ? new Date(d) : null; }
function addDays(d: Date, n: number): Date { const r = new Date(d); r.setDate(r.getDate() + n); return r; }
function diffDays(a: Date, b: Date): number { return Math.round((b.getTime() - a.getTime()) / 86400000); }
function fmtDate(d: Date): string { return d.toISOString().split('T')[0]; }

function computeCriticalPath(tasks: GanttTask[]): Set<number> {
  const dur = (t: GanttTask) => { const s = parseDate(t.start_date), e = parseDate(t.due_date); return s && e ? Math.max(1, diffDays(s, e)) : 1; };
  const ef = new Map<number, number>();
  const visited = new Set<number>();
  const taskMap = new Map(tasks.map(t => [t.id, t]));
  function visit(id: number) {
    if (visited.has(id)) return;
    visited.add(id);
    const t = taskMap.get(id)!;
    const maxPred = t.dependencies.length ? Math.max(...t.dependencies.map(d => { visit(d.depends_on_id); return ef.get(d.depends_on_id) || 0; })) : 0;
    ef.set(id, maxPred + dur(t));
  }
  tasks.forEach(t => visit(t.id));
  const maxEF = ef.size ? Math.max(...Array.from(ef.values())) : 0;
  const critical = new Set<number>();
  tasks.forEach(t => { if ((ef.get(t.id) || 0) === maxEF && maxEF > 0) critical.add(t.id); });
  return critical;
}

function getWeek(d: Date): number {
  const jan1 = new Date(d.getFullYear(), 0, 1);
  return Math.ceil(((d.getTime() - jan1.getTime()) / 86400000 + jan1.getDay() + 1) / 7);
}

export default function GanttChart({ projectId, tasks: initialTasks, milestones, members = [] }: { projectId: number; tasks: GanttTask[]; milestones: Milestone[]; members?: any[]; }) {
  const [tasks, setTasks] = useState<GanttTask[]>(initialTasks);
  const [zoom, setZoom] = useState<ZoomLevel>('week');
  const [selectedTask, setSelectedTask] = useState<GanttTask | null>(null);
  const [depDrag, setDepDrag] = useState<{ fromId: number; x: number; y: number } | null>(null);
  const [dragging, setDragging] = useState<{ taskId: number; type: 'move' | 'resize'; startX: number; origStart: Date | null; origEnd: Date | null } | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const pxPerDay = ZOOM_PX[zoom];
  const chartDays = 365;
  const chartWidth = chartDays * pxPerDay;
  const critical = computeCriticalPath(tasks);

  const chartStart = (() => {
    const dates = tasks.flatMap(t => [parseDate(t.start_date), parseDate(t.due_date)]).filter(Boolean) as Date[];
    if (!dates.length) return addDays(new Date(), -7);
    return addDays(new Date(Math.min(...dates.map(d => d.getTime()))), -7);
  })();

  const dayToX = useCallback((d: Date) => diffDays(chartStart, d) * pxPerDay, [chartStart, pxPerDay]);

  const onMouseMove = useCallback((e: MouseEvent) => {
    if (!dragging || !svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left - LEFT_W;
    const dx = x - dragging.startX;
    const daysDelta = Math.round(dx / pxPerDay);
    setTasks(prev => prev.map(t => {
      if (t.id !== dragging.taskId) return t;
      if (dragging.type === 'move') {
        return { ...t, start_date: dragging.origStart ? fmtDate(addDays(dragging.origStart, daysDelta)) : t.start_date, due_date: dragging.origEnd ? fmtDate(addDays(dragging.origEnd, daysDelta)) : t.due_date };
      }
      return { ...t, due_date: dragging.origEnd ? fmtDate(addDays(dragging.origEnd, daysDelta)) : t.due_date };
    }));
  }, [dragging, pxPerDay]);

  const onMouseUp = useCallback(async () => {
    if (!dragging) return;
    const task = tasks.find(t => t.id === dragging.taskId);
    if (task) await pmsApi.updateTask(task.id, { start_date: task.start_date, due_date: task.due_date });
    setDragging(null);
  }, [dragging, tasks]);

  useEffect(() => {
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => { window.removeEventListener('mousemove', onMouseMove); window.removeEventListener('mouseup', onMouseUp); };
  }, [onMouseMove, onMouseUp]);

  const startDrag = (e: React.MouseEvent, taskId: number, type: 'move' | 'resize') => {
    e.stopPropagation();
    const task = tasks.find(t => t.id === taskId)!;
    const rect = svgRef.current!.getBoundingClientRect();
    setDragging({ taskId, type, startX: e.clientX - rect.left - LEFT_W, origStart: parseDate(task.start_date), origEnd: parseDate(task.due_date) });
  };

  const dropDepOn = async (toId: number) => {
    if (!depDrag || depDrag.fromId === toId) { setDepDrag(null); return; }
    await pmsApi.addDependency(depDrag.fromId, { depends_on_id: toId, type: 'finish_to_start' });
    const r = await pmsApi.listTasks(projectId);
    setTasks(r.data);
    setDepDrag(null);
  };

  const timeHeaders = () => {
    const headers: { x: number; label: string }[] = [];
    let cur = new Date(chartStart);
    while (diffDays(chartStart, cur) < chartDays) {
      const x = dayToX(cur);
      let label = '';
      if (zoom === 'day') label = cur.toLocaleDateString('en', { month: 'short', day: 'numeric' });
      else if (zoom === 'week') label = `W${getWeek(cur)}`;
      else if (zoom === 'month') label = cur.toLocaleDateString('en', { month: 'short', year: '2-digit' });
      else label = `Q${Math.ceil((cur.getMonth() + 1) / 3)} ${cur.getFullYear()}`;
      headers.push({ x, label });
      if (zoom === 'day') cur = addDays(cur, 1);
      else if (zoom === 'week') cur = addDays(cur, 7);
      else if (zoom === 'month') cur = new Date(cur.getFullYear(), cur.getMonth() + 1, 1);
      else cur = new Date(cur.getFullYear(), cur.getMonth() + 3, 1);
    }
    return headers;
  };

  const today = new Date();
  const todayX = dayToX(today);
  const svgH = Math.max(tasks.length * ROW_H + 40, 200);

  return (
    <div className="flex flex-col h-full overflow-hidden bg-white">
      <div className="flex items-center gap-2 px-4 py-2 border-b border-gray-200 flex-wrap">
        <span className="text-sm text-gray-500 font-medium">Zoom:</span>
        {(['day', 'week', 'month', 'quarter'] as ZoomLevel[]).map(z => (
          <button key={z} onClick={() => setZoom(z)}
            className={`px-3 py-1 rounded text-sm font-medium ${zoom === z ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
            {z.charAt(0).toUpperCase() + z.slice(1)}
          </button>
        ))}
        <div className="flex items-center gap-3 ml-4 flex-wrap">
          {Object.entries(STAGE_COLORS).map(([s, c]) => (
            <span key={s} className="flex items-center gap-1 text-xs text-gray-500">
              <span className="w-3 h-3 rounded-sm inline-block" style={{ background: c }} />
              {s.replace('_', ' ')}
            </span>
          ))}
          <span className="flex items-center gap-1 text-xs text-red-500">
            <span className="w-3 h-3 rounded-sm inline-block bg-red-500" /> critical path
          </span>
        </div>
      </div>

      <div className="flex flex-1 overflow-auto">
        <div className="flex-none border-r border-gray-200 bg-white" style={{ width: LEFT_W, minWidth: LEFT_W }}>
          <div className="h-10 border-b border-gray-200 flex items-center px-3 bg-gray-50">
            <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Task</span>
          </div>
          {tasks.map(t => (
            <div key={t.id} style={{ height: ROW_H }}
              className="flex items-center px-3 border-b border-gray-100 text-sm cursor-pointer hover:bg-gray-50"
              onClick={() => setSelectedTask(t)}>
              <span className="w-2 h-2 rounded-full mr-2 flex-none" style={{ background: STAGE_COLORS[t.stage] || '#6366f1' }} />
              <span className="truncate text-gray-800">{t.title}</span>
            </div>
          ))}
          {tasks.length === 0 && (
            <div className="p-4 text-sm text-gray-400 text-center">No tasks yet. Add tasks in the List tab.</div>
          )}
        </div>

        <div className="flex-1 overflow-x-auto">
          <svg ref={svgRef} width={Math.max(chartWidth, 800)} height={svgH}
            onMouseMove={e => { if (depDrag && svgRef.current) { const rect = svgRef.current.getBoundingClientRect(); setDepDrag({ ...depDrag, x: e.clientX - rect.left, y: e.clientY - rect.top }); } }}>
            <defs>
              <marker id="arrow" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
                <path d="M0,0 L0,6 L8,3 z" fill="#94a3b8" />
              </marker>
            </defs>

            {timeHeaders().map((h, i) => (
              <g key={i}>
                <line x1={h.x} y1={0} x2={h.x} y2={svgH} stroke="#e5e7eb" strokeWidth={1} />
                <text x={h.x + 4} y={14} fontSize={10} fill="#9ca3af">{h.label}</text>
              </g>
            ))}
            <line x1={0} y1={20} x2={chartWidth} y2={20} stroke="#e5e7eb" strokeWidth={1} />

            {todayX > 0 && todayX < chartWidth && (
              <line x1={todayX} y1={0} x2={todayX} y2={svgH} stroke="#6366f1" strokeWidth={1.5} strokeDasharray="4 3" />
            )}

            {milestones.map(m => {
              const mx = dayToX(new Date(m.due_date));
              return (
                <g key={m.id} transform={`translate(${mx}, 20)`}>
                  <polygon points="0,-8 8,0 0,8 -8,0" fill={m.color || '#f59e0b'} opacity={0.85} />
                  <title>{m.name}</title>
                </g>
              );
            })}

            {tasks.map((t, ti) => t.dependencies.map(dep => {
              const fromTask = tasks.find(x => x.id === dep.depends_on_id);
              if (!fromTask) return null;
              const fromIdx = tasks.indexOf(fromTask);
              const fromX = fromTask.due_date ? dayToX(new Date(fromTask.due_date)) : 0;
              const toX = t.start_date ? dayToX(new Date(t.start_date)) : 0;
              const fromY = 20 + fromIdx * ROW_H + ROW_H / 2;
              const toY = 20 + ti * ROW_H + ROW_H / 2;
              const midX = (fromX + toX) / 2;
              return (
                <path key={dep.id} d={`M${fromX},${fromY} C${midX},${fromY} ${midX},${toY} ${toX},${toY}`}
                  fill="none" stroke="#94a3b8" strokeWidth={1.5} markerEnd="url(#arrow)" />
              );
            }))}

            {tasks.map((t, i) => {
              const s = parseDate(t.start_date), e = parseDate(t.due_date);
              if (!s || !e) return null;
              const x = dayToX(s);
              const w = Math.max(8, dayToX(e) - x);
              const y = 20 + i * ROW_H + 6;
              const h = ROW_H - 12;
              const isCrit = critical.has(t.id);
              const color = isCrit ? '#ef4444' : (STAGE_COLORS[t.stage] || '#6366f1');
              return (
                <g key={t.id}>
                  <rect x={x} y={y} width={w} height={h} rx={4} fill={color} opacity={0.85}
                    style={{ cursor: 'grab' }}
                    onMouseDown={e2 => startDrag(e2, t.id, 'move')}
                    onMouseUp={() => depDrag && dropDepOn(t.id)} />
                  {w > 40 && (
                    <text x={x + 6} y={y + h / 2 + 4} fontSize={11} fill="white" style={{ pointerEvents: 'none' }}>
                      {t.title.slice(0, Math.floor(w / 7))}
                    </text>
                  )}
                  <rect x={x + w - 6} y={y} width={6} height={h} rx={2} fill="rgba(0,0,0,0.2)"
                    style={{ cursor: 'ew-resize' }}
                    onMouseDown={e2 => startDrag(e2, t.id, 'resize')} />
                  <circle cx={x + w} cy={y + h / 2} r={5} fill="white" stroke={color} strokeWidth={2}
                    style={{ cursor: 'crosshair' }}
                    onMouseDown={e2 => { e2.stopPropagation(); if (svgRef.current) { const rect = svgRef.current.getBoundingClientRect(); setDepDrag({ fromId: t.id, x: e2.clientX - rect.left, y: e2.clientY - rect.top }); } }} />
                </g>
              );
            })}

            {depDrag && (() => {
              const t = tasks.find(x => x.id === depDrag.fromId);
              const i = tasks.findIndex(x => x.id === depDrag.fromId);
              if (!t) return null;
              const x1 = t.due_date ? dayToX(new Date(t.due_date)) : 0;
              const y1 = 20 + i * ROW_H + ROW_H / 2;
              return <line x1={x1} y1={y1} x2={depDrag.x} y2={depDrag.y} stroke="#6366f1" strokeWidth={1.5} strokeDasharray="4 3" />;
            })()}
          </svg>
        </div>
      </div>

      {selectedTask && (
        <TaskDetailPanel taskId={selectedTask.id} projectId={projectId} members={members}
          onClose={() => setSelectedTask(null)}
          onUpdated={async () => { const r = await pmsApi.listTasks(projectId); setTasks(r.data); }} />
      )}
    </div>
  );
}

