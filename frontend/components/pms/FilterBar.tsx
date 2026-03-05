'use client';
import { useState, useRef, useEffect } from 'react';

/* ── Types & defaults ─────────────────────────────────────────────── */

export type FilterState = {
  assignees: number[];
  priorities: string[];
  stages: string[];
  milestone_id: number | null;
  due_from: string;
  due_to: string;
  labels: number[];
  created_from: string;
  created_to: string;
  has_attachments: boolean | null;
};

export const defaultFilters: FilterState = {
  assignees: [],
  priorities: [],
  stages: [],
  milestone_id: null,
  due_from: '',
  due_to: '',
  labels: [],
  created_from: '',
  created_to: '',
  has_attachments: null,
};

interface FilterBarProps {
  members: any[];
  milestones: any[];
  labels: any[];
  filters: FilterState;
  onFilterChange: (filters: FilterState) => void;
  hideStageFilter?: boolean;
}

/* ── Priority config ──────────────────────────────────────────────── */

const PRIORITIES = [
  { key: 'low', label: 'Low', active: 'bg-gray-200 text-gray-700 border-gray-300', inactive: 'border-gray-300 text-gray-400' },
  { key: 'medium', label: 'Medium', active: 'bg-yellow-100 text-yellow-700 border-yellow-300', inactive: 'border-gray-300 text-gray-400' },
  { key: 'high', label: 'High', active: 'bg-orange-100 text-orange-700 border-orange-300', inactive: 'border-gray-300 text-gray-400' },
  { key: 'urgent', label: 'Urgent', active: 'bg-red-100 text-red-700 border-red-300', inactive: 'border-gray-300 text-gray-400' },
];

/* ── Stage config ─────────────────────────────────────────────────── */

const STAGES = [
  { key: 'development', label: 'Development', active: 'bg-indigo-100 text-indigo-700 border-indigo-300' },
  { key: 'qa', label: 'QA', active: 'bg-amber-100 text-amber-700 border-amber-300' },
  { key: 'pm_review', label: 'PM Review', active: 'bg-purple-100 text-purple-700 border-purple-300' },
  { key: 'client_review', label: 'Client Review', active: 'bg-cyan-100 text-cyan-700 border-cyan-300' },
  { key: 'approved', label: 'Approved', active: 'bg-green-100 text-green-700 border-green-300' },
  { key: 'completed', label: 'Completed', active: 'bg-gray-200 text-gray-700 border-gray-300' },
];

/* ── MultiSelectDropdown (reusable) ───────────────────────────────── */

function MultiSelectDropdown({ label, options, selected, onToggle, renderOption }: {
  label: string;
  options: { id: number; name: string;[k: string]: any }[];
  selected: number[];
  onToggle: (id: number) => void;
  renderOption?: (opt: any) => React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className={`text-sm px-3 py-1.5 rounded-lg border whitespace-nowrap ${
          selected.length > 0
            ? 'border-indigo-300 bg-indigo-50 text-indigo-700'
            : 'border-gray-300 text-gray-600'
        } hover:bg-gray-50`}
      >
        {label}{selected.length > 0 && ` (${selected.length})`}
        <span className="ml-1">&#9662;</span>
      </button>
      {open && (
        <div className="absolute top-full mt-1 left-0 bg-white border rounded-lg shadow-lg z-20 py-1 min-w-[180px] max-h-60 overflow-y-auto">
          {options.map(opt => (
            <label key={opt.id} className="flex items-center gap-2 px-3 py-1.5 hover:bg-gray-50 cursor-pointer text-sm">
              <input
                type="checkbox"
                checked={selected.includes(opt.id)}
                onChange={() => onToggle(opt.id)}
                className="rounded"
              />
              {renderOption ? renderOption(opt) : opt.name}
            </label>
          ))}
          {options.length === 0 && (
            <div className="px-3 py-2 text-xs text-gray-400">None available</div>
          )}
        </div>
      )}
    </div>
  );
}

/* ── FilterBar ────────────────────────────────────────────────────── */

export default function FilterBar({
  members,
  milestones,
  labels,
  filters,
  onFilterChange,
  hideStageFilter = false,
}: FilterBarProps) {
  /* helpers */
  const update = (patch: Partial<FilterState>) => onFilterChange({ ...filters, ...patch });

  const toggleArray = <K extends 'assignees' | 'priorities' | 'stages' | 'labels'>(
    key: K,
    value: FilterState[K][number],
  ) => {
    const arr = filters[key] as any[];
    const next = arr.includes(value) ? arr.filter((v: any) => v !== value) : [...arr, value];
    update({ [key]: next } as any);
  };

  /* check if any filter is active */
  const hasActiveFilters =
    filters.assignees.length > 0 ||
    filters.priorities.length > 0 ||
    filters.stages.length > 0 ||
    filters.milestone_id !== null ||
    filters.due_from !== '' ||
    filters.due_to !== '' ||
    filters.labels.length > 0 ||
    filters.created_from !== '' ||
    filters.created_to !== '' ||
    filters.has_attachments !== null;

  /* build active pills */
  const pills: { key: string; label: string; onRemove: () => void }[] = [];

  filters.assignees.forEach(id => {
    const m = members.find((x: any) => x.id === id || x.user_id === id);
    pills.push({
      key: `assignee-${id}`,
      label: `Assignee: ${m?.full_name || m?.name || id}`,
      onRemove: () => toggleArray('assignees', id),
    });
  });

  filters.priorities.forEach(p => {
    pills.push({
      key: `priority-${p}`,
      label: `Priority: ${p.charAt(0).toUpperCase() + p.slice(1)}`,
      onRemove: () => toggleArray('priorities', p),
    });
  });

  filters.stages.forEach(s => {
    const stage = STAGES.find(st => st.key === s);
    pills.push({
      key: `stage-${s}`,
      label: `Stage: ${stage?.label || s}`,
      onRemove: () => toggleArray('stages', s),
    });
  });

  if (filters.milestone_id !== null) {
    const ms = milestones.find((x: any) => x.id === filters.milestone_id);
    pills.push({
      key: 'milestone',
      label: `Milestone: ${ms?.title || ms?.name || filters.milestone_id}`,
      onRemove: () => update({ milestone_id: null }),
    });
  }

  if (filters.due_from) pills.push({ key: 'due_from', label: `Due from: ${filters.due_from}`, onRemove: () => update({ due_from: '' }) });
  if (filters.due_to) pills.push({ key: 'due_to', label: `Due to: ${filters.due_to}`, onRemove: () => update({ due_to: '' }) });
  if (filters.created_from) pills.push({ key: 'created_from', label: `Created from: ${filters.created_from}`, onRemove: () => update({ created_from: '' }) });
  if (filters.created_to) pills.push({ key: 'created_to', label: `Created to: ${filters.created_to}`, onRemove: () => update({ created_to: '' }) });

  filters.labels.forEach(id => {
    const l = labels.find((x: any) => x.id === id);
    pills.push({
      key: `label-${id}`,
      label: `Label: ${l?.name || id}`,
      onRemove: () => toggleArray('labels', id),
    });
  });

  if (filters.has_attachments !== null) {
    pills.push({
      key: 'attachments',
      label: filters.has_attachments ? 'Has attachments' : 'No attachments',
      onRemove: () => update({ has_attachments: null }),
    });
  }

  /* milestone dropdown state */
  const [msOpen, setMsOpen] = useState(false);
  const msRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (msRef.current && !msRef.current.contains(e.target as Node)) setMsOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-3 mb-4">
      {/* ── Filter controls row ─────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2">
        {/* Assignee multi-select */}
        <MultiSelectDropdown
          label="Assignee"
          options={members.map((m: any) => ({ ...m, id: m.id ?? m.user_id, name: m.full_name || m.name || `User ${m.id ?? m.user_id}` }))}
          selected={filters.assignees}
          onToggle={id => toggleArray('assignees', id)}
        />

        {/* Priority chips */}
        <div className="flex items-center gap-1">
          {PRIORITIES.map(p => {
            const isActive = filters.priorities.includes(p.key);
            return (
              <button
                key={p.key}
                onClick={() => toggleArray('priorities', p.key)}
                className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                  isActive ? p.active : p.inactive
                }`}
              >
                {p.label}
              </button>
            );
          })}
        </div>

        {/* Stage chips */}
        {!hideStageFilter && (
          <div className="flex items-center gap-1">
            {STAGES.map(s => {
              const isActive = filters.stages.includes(s.key);
              return (
                <button
                  key={s.key}
                  onClick={() => toggleArray('stages', s.key)}
                  className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                    isActive ? s.active : 'border-gray-300 text-gray-400'
                  }`}
                >
                  {s.label}
                </button>
              );
            })}
          </div>
        )}

        {/* Milestone dropdown (single select) */}
        <div ref={msRef} className="relative">
          <button
            onClick={() => setMsOpen(!msOpen)}
            className={`text-sm px-3 py-1.5 rounded-lg border whitespace-nowrap ${
              filters.milestone_id !== null
                ? 'border-indigo-300 bg-indigo-50 text-indigo-700'
                : 'border-gray-300 text-gray-600'
            } hover:bg-gray-50`}
          >
            {filters.milestone_id !== null
              ? milestones.find((m: any) => m.id === filters.milestone_id)?.title ||
                milestones.find((m: any) => m.id === filters.milestone_id)?.name ||
                'Milestone'
              : 'Milestone'}
            <span className="ml-1">&#9662;</span>
          </button>
          {msOpen && (
            <div className="absolute top-full mt-1 left-0 bg-white border rounded-lg shadow-lg z-20 py-1 min-w-[180px] max-h-60 overflow-y-auto">
              <button
                onClick={() => { update({ milestone_id: null }); setMsOpen(false); }}
                className={`block w-full text-left px-3 py-1.5 text-sm hover:bg-gray-50 ${
                  filters.milestone_id === null ? 'font-semibold text-indigo-600' : 'text-gray-600'
                }`}
              >
                All Milestones
              </button>
              {milestones.map((m: any) => (
                <button
                  key={m.id}
                  onClick={() => { update({ milestone_id: m.id }); setMsOpen(false); }}
                  className={`block w-full text-left px-3 py-1.5 text-sm hover:bg-gray-50 ${
                    filters.milestone_id === m.id ? 'font-semibold text-indigo-600' : 'text-gray-600'
                  }`}
                >
                  {m.title || m.name}
                </button>
              ))}
              {milestones.length === 0 && (
                <div className="px-3 py-2 text-xs text-gray-400">None available</div>
              )}
            </div>
          )}
        </div>

        {/* Due date range */}
        <div className="flex items-center gap-1">
          <label className="text-xs text-gray-500">Due:</label>
          <input
            type="date"
            value={filters.due_from}
            onChange={e => update({ due_from: e.target.value })}
            className="text-xs border border-gray-300 rounded-lg px-2 py-1.5"
          />
          <span className="text-xs text-gray-400">–</span>
          <input
            type="date"
            value={filters.due_to}
            onChange={e => update({ due_to: e.target.value })}
            className="text-xs border border-gray-300 rounded-lg px-2 py-1.5"
          />
        </div>

        {/* Labels multi-select */}
        <MultiSelectDropdown
          label="Labels"
          options={labels.map((l: any) => ({ ...l, id: l.id, name: l.name }))}
          selected={filters.labels}
          onToggle={id => toggleArray('labels', id)}
          renderOption={(opt: any) => (
            <span className="flex items-center gap-1.5">
              <span
                className="w-2.5 h-2.5 rounded-full flex-none"
                style={{ backgroundColor: opt.color || '#9ca3af' }}
              />
              {opt.name}
            </span>
          )}
        />

        {/* Created date range */}
        <div className="flex items-center gap-1">
          <label className="text-xs text-gray-500">Created:</label>
          <input
            type="date"
            value={filters.created_from}
            onChange={e => update({ created_from: e.target.value })}
            className="text-xs border border-gray-300 rounded-lg px-2 py-1.5"
          />
          <span className="text-xs text-gray-400">–</span>
          <input
            type="date"
            value={filters.created_to}
            onChange={e => update({ created_to: e.target.value })}
            className="text-xs border border-gray-300 rounded-lg px-2 py-1.5"
          />
        </div>

        {/* Has Attachments toggle */}
        <label className="flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={filters.has_attachments === true}
            ref={el => {
              if (el) el.indeterminate = filters.has_attachments === null;
            }}
            onChange={() => {
              // cycle: null -> true -> false -> null
              if (filters.has_attachments === null) update({ has_attachments: true });
              else if (filters.has_attachments === true) update({ has_attachments: false });
              else update({ has_attachments: null });
            }}
            className="rounded"
          />
          Attachments
        </label>
      </div>

      {/* ── Active filter pills ─────────────────────────────────── */}
      {hasActiveFilters && (
        <div className="flex flex-wrap items-center gap-1.5 mt-2 pt-2 border-t border-gray-100">
          {pills.map(pill => (
            <span
              key={pill.key}
              className="inline-flex items-center gap-1 bg-indigo-100 text-indigo-700 text-xs px-2 py-1 rounded-full"
            >
              {pill.label}
              <button
                onClick={pill.onRemove}
                className="hover:text-indigo-900 font-bold leading-none"
                aria-label={`Remove filter: ${pill.label}`}
              >
                &times;
              </button>
            </span>
          ))}
          <button
            onClick={() => onFilterChange({ ...defaultFilters })}
            className="text-xs text-gray-500 hover:text-red-600 ml-1 underline"
          >
            Clear all
          </button>
        </div>
      )}
    </div>
  );
}
