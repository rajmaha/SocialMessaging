'use client';
import { useState } from 'react';
import { pmsApi } from '@/lib/api';

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

export default function BoardView({ projectId, tasks, onReload }: { projectId: number; tasks: any[]; onReload: () => void }) {
  const [dragTaskId, setDragTaskId] = useState<number | null>(null);

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
    <div className="flex gap-4 p-4 h-full overflow-x-auto overflow-y-hidden">
      {STAGES.map(stage => {
        const stageTasks = tasks.filter(t => t.stage === stage);
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
              {stageTasks.map(t => (
                <div key={t.id} draggable
                  onDragStart={() => setDragTaskId(t.id)}
                  className="bg-white rounded-lg p-3 shadow-sm border border-gray-100 cursor-grab active:cursor-grabbing select-none">
                  <div className="flex items-start gap-2 mb-1">
                    <span className={`w-2 h-2 rounded-full mt-1 flex-none ${PRIORITY_DOT[t.priority] || 'bg-gray-300'}`} />
                    <span className="text-sm font-medium text-gray-800 leading-snug">{t.title}</span>
                  </div>
                  {t.assignee_name && <div className="text-xs text-gray-400 ml-4">{t.assignee_name}</div>}
                  {t.due_date && <div className="text-xs text-gray-400 ml-4 mt-1">Due {t.due_date}</div>}
                  {t.subtask_count > 0 && <div className="text-xs text-indigo-400 ml-4 mt-1">+{t.subtask_count} subtasks</div>}
                </div>
              ))}
              {stageTasks.length === 0 && <div className="text-xs text-gray-300 text-center py-4">Empty</div>}
            </div>
          </div>
        );
      })}
    </div>
  );
}
