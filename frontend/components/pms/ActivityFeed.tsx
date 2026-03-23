'use client';
import { useEffect, useState } from 'react';
import { pmsApi } from '@/lib/api';

const ACTION_ICONS: Record<string, string> = {
  stage_change: '🔀',
  assignee_change: '👤',
  member_added: '➕',
  member_removed: '➖',
  milestone_change: '🏁',
  comment_added: '💬',
  sprint_created: '🏃',
  template_applied: '📋',
};

const ACTION_COLORS: Record<string, string> = {
  stage_change: 'bg-purple-100 text-purple-700',
  assignee_change: 'bg-blue-100 text-blue-700',
  member_added: 'bg-green-100 text-green-700',
  member_removed: 'bg-red-100 text-red-700',
  milestone_change: 'bg-amber-100 text-amber-700',
  comment_added: 'bg-cyan-100 text-cyan-700',
  sprint_created: 'bg-indigo-100 text-indigo-700',
  template_applied: 'bg-teal-100 text-teal-700',
};

function formatAction(item: any): string {
  const d = item.details || {};
  switch (item.action) {
    case 'stage_change':
      return `moved task to ${(d.to || '').replace('_', ' ')}${d.from ? ` from ${d.from.replace('_', ' ')}` : ''}`;
    case 'assignee_change':
      return `reassigned task from ${d.from || 'unassigned'} to ${d.to || 'unassigned'}`;
    case 'member_added':
      return `added a member (role: ${d.role || 'developer'})`;
    case 'member_removed':
      return `removed a member`;
    case 'milestone_change':
      return `updated milestone "${d.milestone || ''}"`;
    case 'comment_added':
      return `commented: "${(d.content || '').substring(0, 80)}${(d.content || '').length > 80 ? '...' : ''}"`;
    default:
      return item.action?.replace('_', ' ') || 'action';
  }
}

export default function ActivityFeed({ projectId }: { projectId: number }) {
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    pmsApi.getProjectActivity(projectId, { limit: 100 })
      .then(r => { setItems(r.data); setLoading(false); })
      .catch(() => setLoading(false));
  }, [projectId]);

  if (loading) return <div className="text-gray-400 text-center py-10">Loading activity...</div>;
  if (items.length === 0) return <div className="text-gray-400 text-center py-10">No activity yet.</div>;

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <h2 className="text-lg font-semibold text-gray-900 mb-4">Activity</h2>
      <div className="relative">
        <div className="absolute left-4 top-0 bottom-0 w-px bg-gray-200" />
        <div className="space-y-4">
          {items.map((item: any, idx: number) => {
            const color = ACTION_COLORS[item.action] || 'bg-gray-100 text-gray-600';
            const icon = ACTION_ICONS[item.action] || '📝';
            return (
              <div key={idx} className="relative flex gap-4 pl-8">
                <div className="absolute left-2.5 top-1 w-3 h-3 rounded-full bg-white border-2 border-gray-300 z-10" />
                <div className="flex-1 bg-white rounded-lg border border-gray-200 p-3">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-sm">{icon}</span>
                    <span className="font-medium text-sm text-gray-900">{item.actor_name || 'System'}</span>
                    <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${color}`}>
                      {item.action?.replace('_', ' ')}
                    </span>
                  </div>
                  <p className="text-sm text-gray-600">{formatAction(item)}</p>
                  <p className="text-xs text-gray-400 mt-1">
                    {item.created_at ? new Date(item.created_at).toLocaleString() : ''}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
