'use client';
import { useState, useEffect } from 'react';
import { pmsApi } from '@/lib/api';
import FilterBar, { FilterState, defaultFilters } from './FilterBar';

const STAGES = ['development', 'qa', 'pm_review', 'client_review', 'approved', 'completed'];
const STAGE_LABELS: Record<string, string> = {
  development: 'Development', qa: 'QA', pm_review: 'PM Review',
  client_review: 'Client Review', approved: 'Approved', completed: 'Completed',
};
const STAGE_STYLES: Record<string, string> = {
  development: 'bg-indigo-50 border-indigo-200',
  qa: 'bg-amber-50 border-amber-200',
  pm_review: 'bg-purple-50 border-purple-200',
  client_review: 'bg-cyan-50 border-cyan-200',
  approved: 'bg-green-50 border-green-200',
  completed: 'bg-gray-50 border-gray-200',
};
const PRIORITY_DOT: Record<string, string> = {
  low: 'bg-gray-300', medium: 'bg-yellow-400', high: 'bg-orange-400', urgent: 'bg-red-500',
};

function EffBadge({ value }: { value: number | null }) {
  if (value === null || value === undefined) return null;
  const c = value >= 80 ? 'bg-green-100 text-green-700' : value >= 50 ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700';
  return <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${c}`}>{value}%</span>;
}

export default function BoardView({ projectId: _projectId, tasks, members = [], milestones = [], onReload }: { projectId: number; tasks: any[]; members?: any[]; milestones?: any[]; onReload: () => void }) {
  const [dragTaskId, setDragTaskId] = useState<number | null>(null);
  const [filters, setFilters] = useState<FilterState>(defaultFilters);
  const [allLabels, setAllLabels] = useState<any[]>([]);

  useEffect(() => { pmsApi.listLabels().then(r => setAllLabels(r.data)).catch(() => {}); }, []);

  const filteredTasks = tasks.filter(t => {
    if (t.parent_task_id) return false;
    if (filters.assignees.length > 0 && !filters.assignees.includes(t.assignee_id)) return false;
    if (filters.priorities.length > 0 && !filters.priorities.includes(t.priority)) return false;
    if (filters.milestone_id && t.milestone_id !== filters.milestone_id) return false;
    if (filters.due_from && t.due_date && t.due_date < filters.due_from) return false;
    if (filters.due_to && t.due_date && t.due_date > filters.due_to) return false;
    if (filters.labels.length > 0) {
      const taskLabelIds = (t.labels || []).map((l: any) => l.label_definition_id || l.id);
      if (!filters.labels.some(id => taskLabelIds.includes(id))) return false;
    }
    if (filters.created_from && t.created_at) {
      if (t.created_at.substring(0, 10) < filters.created_from) return false;
    }
    if (filters.created_to && t.created_at) {
      if (t.created_at.substring(0, 10) > filters.created_to) return false;
    }
    return true;
  });

  const onDrop = async (stage: string) => {
    if (!dragTaskId) return;
    const task = tasks.find(t => t.id === dragTaskId);
    if (!task || task.stage === stage) { setDragTaskId(null); return; }
    try {
      await pmsApi.transitionTask(dragTaskId, { to_stage: stage });
      await onReload();
    } catch (e) {
      // Transition not allowed for this role — silently ignore
    }
    setDragTaskId(null);
  };

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 pt-4 flex-none">
        <FilterBar
          members={members}
          milestones={milestones}
          labels={allLabels}
          filters={filters}
          onFilterChange={setFilters}
          hideStageFilter={true}
        />
      </div>
      <div className="flex gap-4 px-4 pb-4 flex-1 overflow-x-auto overflow-y-hidden">
      {STAGES.map(stage => {
        const stageTasks = filteredTasks.filter(t => t.stage === stage);
        return (
          <div key={stage}
            className={`flex-none w-60 rounded-xl border ${STAGE_STYLES[stage]} flex flex-col min-h-0`}
            onDragOver={e => e.preventDefault()}
            onDrop={() => onDrop(stage)}>
            <div className="px-3 py-2 border-b border-inherit flex items-center justify-between flex-none">
              <span className="text-xs font-semibold text-gray-700">{STAGE_LABELS[stage]}</span>
              <span className="text-xs bg-white rounded-full px-2 py-0.5 text-gray-500 border">{stageTasks.length}</span>
            </div>
            <div className="flex-1 overflow-y-auto p-2 space-y-2">
              {stageTasks.map(t => {
                const isOverdue = t.due_date && new Date(t.due_date) < new Date() && t.stage !== 'completed';
                return (
                <div key={t.id} draggable
                  onDragStart={() => setDragTaskId(t.id)}
                  className={`bg-white rounded-lg p-3 shadow-sm border border-gray-100 cursor-grab active:cursor-grabbing select-none ${isOverdue ? 'border-l-4 border-l-red-500' : ''}`}>
                  <div className="flex items-start gap-2 mb-1">
                    <span className={`w-2 h-2 rounded-full mt-1 flex-none ${PRIORITY_DOT[t.priority] || 'bg-gray-300'}`} />
                    <span className="text-sm font-medium text-gray-800 leading-snug">{t.title}</span>
                  </div>
                  <div className="flex flex-wrap gap-1 mt-1 ml-4">
                    {t.labels?.map((l: any) => (
                      <span key={l.id} className="text-[10px] px-1.5 py-0.5 rounded-full font-medium text-white" style={{ background: l.color }}>{l.name}</span>
                    ))}
                    {isOverdue && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-red-100 text-red-700 font-medium">Overdue</span>}
                    <EffBadge value={t.efficiency} />
                  </div>
                  {t.assignee_name && <div className="text-xs text-gray-400 ml-4">{t.assignee_name}</div>}
                  {t.due_date && <div className="text-xs text-gray-400 ml-4 mt-1">Due {t.due_date}</div>}
                  {t.subtask_count > 0 && <div className="text-xs text-indigo-400 ml-4 mt-1">+{t.subtask_count} subtasks</div>}
                </div>
                );
              })}
              {stageTasks.length === 0 && <div className="text-xs text-gray-300 text-center py-4">Empty</div>}
            </div>
          </div>
        );
      })}
      </div>
    </div>
  );
}
