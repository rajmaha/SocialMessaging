'use client';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { formsApi } from '@/lib/api';
import { authAPI } from '@/lib/auth';
import MainHeader from '@/components/MainHeader';
import AdminNav from '@/components/AdminNav';

const FIELD_TYPES = [
  { value: 'text', label: 'Text Input' },
  { value: 'number', label: 'Number' },
  { value: 'textarea', label: 'Text Area' },
  { value: 'email', label: 'Email' },
  { value: 'url', label: 'URL' },
  { value: 'date', label: 'Date' },
  { value: 'time', label: 'Time' },
  { value: 'dropdown', label: 'Dropdown Select' },
  { value: 'dropdown_api', label: 'Dropdown (API)' },
  { value: 'checkbox', label: 'Checkbox' },
  { value: 'checkbox_api', label: 'Checkbox (API)' },
  { value: 'yes_no', label: 'Yes/No' },
  { value: 'true_false', label: 'True/False' },
];

const FIELD_TYPE_DISPLAY: Record<string, string> = Object.fromEntries(FIELD_TYPES.map(t => [t.value, t.label]));

const PATTERN_OPTIONS = [
  { value: 'none', label: 'None' },
  { value: 'alpha', label: 'Alpha (letters only)' },
  { value: 'alphanumeric', label: 'Alphanumeric' },
  { value: 'alpha_special', label: 'Alpha + Special Characters' },
];

const OPERATOR_MAP: Record<string, string> = {
  'is equal to': 'equals',
  'is not equal to': 'not_equals',
  '<': 'lt',
  '<=': 'lte',
  '>': 'gt',
  '>=': 'gte',
};

const OPERATOR_DISPLAY = Object.keys(OPERATOR_MAP);

const PLACEHOLDER_TYPES = ['text', 'number', 'email', 'url', 'textarea'];

const defaultField = () => ({
  label: '',
  field_key: '',
  field_type: 'text',
  is_required: false,
  placeholder: '',
  options: [] as { key: string; value: string }[],
  validation: {} as Record<string, any>,
  api_config: { endpoint: '', value_key: '', label_key: '' },
  conditions: [] as { field_key: string; operator: string; value: string }[],
});

export default function FieldBuilderPage() {
  const user = authAPI.getUser();
  const params = useParams();
  const formId = Number(params.id);

  const [formTitle, setFormTitle] = useState('');
  const [fields, setFields] = useState<any[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [field, setField] = useState(defaultField());
  const [saving, setSaving] = useState(false);

  const loadForm = async () => {
    try {
      const res = await formsApi.get(formId);
      setFormTitle(res.data.title || '');
    } catch {}
  };

  const loadFields = async () => {
    try {
      const res = await formsApi.listFields(formId);
      setFields(res.data);
    } catch {}
  };

  useEffect(() => {
    loadForm();
    loadFields();
  }, [formId]);

  const labelToKey = (label: string) =>
    label.toLowerCase().replace(/[^a-z0-9\s_]/g, '').replace(/\s+/g, '_');

  const openCreate = () => {
    setEditing(null);
    setField(defaultField());
    setShowModal(true);
  };

  const openEdit = (item: any) => {
    setEditing(item);
    const opts = Array.isArray(item.options)
      ? item.options.map((o: any) => (typeof o === 'object' ? { key: o.key || '', value: o.value || '' } : { key: o, value: o }))
      : [];
    const conds = Array.isArray(item.conditions)
      ? item.conditions.map((c: any) => ({
          field_key: c.field_key || '',
          operator: Object.entries(OPERATOR_MAP).find(([, v]) => v === c.operator)?.[0] || 'is equal to',
          value: c.value || '',
        }))
      : [];
    setField({
      label: item.label || '',
      field_key: item.field_key || '',
      field_type: item.field_type || 'text',
      is_required: item.is_required || false,
      placeholder: item.placeholder || '',
      options: opts.length > 0 ? opts : [],
      validation: item.validation || {},
      api_config: item.api_config || { endpoint: '', value_key: '', label_key: '' },
      conditions: conds,
    });
    setShowModal(true);
  };

  const handleSave = async () => {
    if (!field.label) return;
    setSaving(true);
    try {
      const payload: any = {
        label: field.label,
        field_key: field.field_key,
        field_type: field.field_type,
        is_required: field.is_required,
        placeholder: PLACEHOLDER_TYPES.includes(field.field_type) ? field.placeholder : '',
      };

      // Options for dropdown / checkbox
      if (['dropdown', 'checkbox'].includes(field.field_type)) {
        payload.options = field.options.filter(o => o.key || o.value);
      } else {
        payload.options = [];
      }

      // Validation
      const v: any = {};
      if (field.field_type === 'text') {
        if (field.validation.min_length) v.min_length = Number(field.validation.min_length);
        if (field.validation.max_length) v.max_length = Number(field.validation.max_length);
        if (field.validation.pattern && field.validation.pattern !== 'none') v.pattern = field.validation.pattern;
      } else if (field.field_type === 'number') {
        if (field.validation.default_value !== undefined && field.validation.default_value !== '') v.default_value = Number(field.validation.default_value);
        if (field.validation.min_value !== undefined && field.validation.min_value !== '') v.min_value = Number(field.validation.min_value);
        if (field.validation.max_value !== undefined && field.validation.max_value !== '') v.max_value = Number(field.validation.max_value);
      } else if (field.field_type === 'date') {
        if (field.validation.min_date) v.min_date = field.validation.min_date;
        if (field.validation.max_date) v.max_date = field.validation.max_date;
      } else if (field.field_type === 'time') {
        if (field.validation.min_time) v.min_time = field.validation.min_time;
        if (field.validation.max_time) v.max_time = field.validation.max_time;
      } else if (['checkbox', 'checkbox_api'].includes(field.field_type)) {
        if (field.validation.min_selections !== undefined && field.validation.min_selections !== '') v.min_selections = Number(field.validation.min_selections);
        if (field.validation.max_selections !== undefined && field.validation.max_selections !== '') v.max_selections = Number(field.validation.max_selections);
      }
      payload.validation = v;

      // API config
      if (['dropdown_api', 'checkbox_api'].includes(field.field_type)) {
        payload.api_config = field.api_config;
      } else {
        payload.api_config = null;
      }

      // Conditions
      payload.conditions = field.conditions
        .filter(c => c.field_key && c.value)
        .map(c => ({
          field_key: c.field_key,
          operator: OPERATOR_MAP[c.operator] || 'equals',
          value: c.value,
        }));

      if (editing) {
        await formsApi.updateField(formId, editing.id, payload);
      } else {
        await formsApi.createField(formId, payload);
      }
      setShowModal(false);
      setEditing(null);
      loadFields();
    } catch (err) {
      console.error('Failed to save field', err);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (fieldId: number) => {
    if (!confirm('Delete this field? This action cannot be undone.')) return;
    try {
      await formsApi.deleteField(formId, fieldId);
      loadFields();
    } catch {}
  };

  const handleMove = async (index: number, direction: 'up' | 'down') => {
    const newFields = [...fields];
    const swapIndex = direction === 'up' ? index - 1 : index + 1;
    if (swapIndex < 0 || swapIndex >= newFields.length) return;
    [newFields[index], newFields[swapIndex]] = [newFields[swapIndex], newFields[index]];
    setFields(newFields);
    try {
      await formsApi.reorderFields(formId, newFields.map((f: any) => f.id));
    } catch {
      loadFields();
    }
  };

  const updateField = (updates: Partial<ReturnType<typeof defaultField>>) => {
    setField(prev => ({ ...prev, ...updates }));
  };

  const updateValidation = (key: string, value: any) => {
    setField(prev => ({ ...prev, validation: { ...prev.validation, [key]: value } }));
  };

  const updateApiConfig = (key: string, value: string) => {
    setField(prev => ({ ...prev, api_config: { ...prev.api_config, [key]: value } }));
  };

  // Options management
  const addOption = () => {
    setField(prev => ({ ...prev, options: [...prev.options, { key: '', value: '' }] }));
  };
  const removeOption = (i: number) => {
    setField(prev => ({ ...prev, options: prev.options.filter((_, idx) => idx !== i) }));
  };
  const updateOption = (i: number, k: 'key' | 'value', val: string) => {
    setField(prev => {
      const opts = [...prev.options];
      opts[i] = { ...opts[i], [k]: val };
      return { ...prev, options: opts };
    });
  };

  // Conditions management
  const addCondition = () => {
    setField(prev => ({ ...prev, conditions: [...prev.conditions, { field_key: '', operator: 'is equal to', value: '' }] }));
  };
  const removeCondition = (i: number) => {
    setField(prev => ({ ...prev, conditions: prev.conditions.filter((_, idx) => idx !== i) }));
  };
  const updateCondition = (i: number, key: string, val: string) => {
    setField(prev => {
      const conds = [...prev.conditions];
      conds[i] = { ...conds[i], [key]: val };
      return { ...prev, conditions: conds };
    });
  };

  // Other fields for condition dropdown (exclude current editing field)
  const otherFields = fields.filter(f => !editing || f.id !== editing.id);

  const handleLabelChange = (val: string) => {
    const updates: any = { label: val };
    if (!editing) updates.field_key = labelToKey(val);
    updateField(updates);
  };

  const handleTypeChange = (val: string) => {
    updateField({
      field_type: val,
      validation: {},
      options: ['dropdown', 'checkbox'].includes(val) ? [{ key: '', value: '' }] : [],
      api_config: { endpoint: '', value_key: '', label_key: '' },
    });
  };

  if (!user) return null;

  return (
    <div className="ml-60 pt-14 min-h-screen bg-gray-50">
      <MainHeader user={user} />
      <AdminNav />
      <div className="p-6 max-w-4xl">
        {/* Page Header */}
        <div className="flex justify-between items-center mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Form Fields</h1>
            <p className="text-sm text-gray-500 mt-1">
              Manage the fields for this form{formTitle ? `: ${formTitle}` : ''}
            </p>
          </div>
          <button
            onClick={openCreate}
            className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700"
          >
            + Add Field
          </button>
        </div>

        {/* Field List */}
        <div className="space-y-3">
          {fields.map((item: any, index: number) => (
            <div
              key={item.id}
              className="bg-white border border-gray-200 rounded-xl p-4 flex items-start gap-3"
            >
              {/* Drag handle */}
              <span className="text-gray-300 mt-1 cursor-grab select-none text-lg leading-none" title="Drag to reorder">&#x2807;&#x2807;</span>

              {/* Field info */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-semibold text-gray-900">{item.label}</span>
                  {item.is_required && (
                    <span className="text-xs text-red-600 font-medium">*Required</span>
                  )}
                </div>
                <p className="text-sm text-gray-500 mt-0.5">
                  Type: {FIELD_TYPE_DISPLAY[item.field_type] || item.field_type}
                </p>
                {Array.isArray(item.options) && item.options.length > 0 && (
                  <p className="text-sm text-gray-400 mt-0.5">
                    Options: {item.options.map((o: any) => (typeof o === 'object' ? o.value || o.key : o)).join(', ')}
                  </p>
                )}
                {item.placeholder && (
                  <p className="text-sm text-gray-400 mt-0.5">Placeholder: {item.placeholder}</p>
                )}
              </div>

              {/* Actions */}
              <div className="flex items-center gap-1 flex-none">
                <button
                  onClick={() => handleMove(index, 'up')}
                  disabled={index === 0}
                  title="Move up"
                  className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" /></svg>
                </button>
                <button
                  onClick={() => handleMove(index, 'down')}
                  disabled={index === fields.length - 1}
                  title="Move down"
                  className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                </button>
                <button
                  onClick={() => openEdit(item)}
                  title="Edit"
                  className="p-1.5 rounded-lg text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                </button>
                <button
                  onClick={() => handleDelete(item.id)}
                  title="Delete"
                  className="p-1.5 rounded-lg text-red-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                </button>
              </div>
            </div>
          ))}
          {fields.length === 0 && (
            <p className="text-gray-400 text-sm py-10 text-center">
              No fields yet. Click &quot;+ Add Field&quot; to get started.
            </p>
          )}
        </div>
      </div>

      {/* Add / Edit Field Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 w-full max-w-xl shadow-2xl max-h-[90vh] overflow-y-auto">
            <h2 className="font-semibold text-lg mb-4">{editing ? 'Edit Field' : 'Add Field'}</h2>

            {/* Label */}
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Field Label <span className="text-red-500">*</span>
            </label>
            <input
              className="w-full border rounded-lg px-3 py-2 text-sm mb-3"
              placeholder="e.g. Full Name"
              value={field.label}
              onChange={e => handleLabelChange(e.target.value)}
            />

            {/* Field Key */}
            <label className="block text-sm font-medium text-gray-700 mb-1">Field Key</label>
            <input
              className="w-full border rounded-lg px-3 py-2 text-sm mb-3 bg-gray-50 text-gray-600"
              value={field.field_key}
              onChange={e => updateField({ field_key: e.target.value })}
            />

            {/* Field Type */}
            <label className="block text-sm font-medium text-gray-700 mb-1">Field Type</label>
            <select
              className="w-full border rounded-lg px-3 py-2 text-sm mb-3 bg-white"
              value={field.field_type}
              onChange={e => handleTypeChange(e.target.value)}
            >
              {FIELD_TYPES.map(t => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>

            {/* Placeholder */}
            {PLACEHOLDER_TYPES.includes(field.field_type) && (
              <>
                <label className="block text-sm font-medium text-gray-700 mb-1">Placeholder Text</label>
                <input
                  className="w-full border rounded-lg px-3 py-2 text-sm mb-3"
                  placeholder="e.g. Enter your name..."
                  value={field.placeholder}
                  onChange={e => updateField({ placeholder: e.target.value })}
                />
              </>
            )}

            {/* Type-specific validation */}
            {field.field_type === 'text' && (
              <div className="border border-gray-200 rounded-lg p-3 mb-3 bg-gray-50 space-y-2">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Text Validation</p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-gray-600 mb-1">Min Length</label>
                    <input
                      type="number"
                      className="w-full border rounded-lg px-3 py-2 text-sm bg-white"
                      value={field.validation.min_length || ''}
                      onChange={e => updateValidation('min_length', e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-600 mb-1">Max Length</label>
                    <input
                      type="number"
                      className="w-full border rounded-lg px-3 py-2 text-sm bg-white"
                      value={field.validation.max_length || ''}
                      onChange={e => updateValidation('max_length', e.target.value)}
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-xs text-gray-600 mb-1">Pattern</label>
                  <select
                    className="w-full border rounded-lg px-3 py-2 text-sm bg-white"
                    value={field.validation.pattern || 'none'}
                    onChange={e => updateValidation('pattern', e.target.value)}
                  >
                    {PATTERN_OPTIONS.map(p => (
                      <option key={p.value} value={p.value}>{p.label}</option>
                    ))}
                  </select>
                </div>
              </div>
            )}

            {field.field_type === 'number' && (
              <div className="border border-gray-200 rounded-lg p-3 mb-3 bg-gray-50 space-y-2">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Number Validation</p>
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="block text-xs text-gray-600 mb-1">Default Value</label>
                    <input
                      type="number"
                      className="w-full border rounded-lg px-3 py-2 text-sm bg-white"
                      value={field.validation.default_value ?? ''}
                      onChange={e => updateValidation('default_value', e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-600 mb-1">Min Value</label>
                    <input
                      type="number"
                      className="w-full border rounded-lg px-3 py-2 text-sm bg-white"
                      value={field.validation.min_value ?? ''}
                      onChange={e => updateValidation('min_value', e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-600 mb-1">Max Value</label>
                    <input
                      type="number"
                      className="w-full border rounded-lg px-3 py-2 text-sm bg-white"
                      value={field.validation.max_value ?? ''}
                      onChange={e => updateValidation('max_value', e.target.value)}
                    />
                  </div>
                </div>
              </div>
            )}

            {field.field_type === 'date' && (
              <div className="border border-gray-200 rounded-lg p-3 mb-3 bg-gray-50 space-y-2">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Date Validation</p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-gray-600 mb-1">Min Date</label>
                    <input
                      type="date"
                      className="w-full border rounded-lg px-3 py-2 text-sm bg-white"
                      value={field.validation.min_date || ''}
                      onChange={e => updateValidation('min_date', e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-600 mb-1">Max Date</label>
                    <input
                      type="date"
                      className="w-full border rounded-lg px-3 py-2 text-sm bg-white"
                      value={field.validation.max_date || ''}
                      onChange={e => updateValidation('max_date', e.target.value)}
                    />
                  </div>
                </div>
              </div>
            )}

            {field.field_type === 'time' && (
              <div className="border border-gray-200 rounded-lg p-3 mb-3 bg-gray-50 space-y-2">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Time Validation</p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-gray-600 mb-1">Min Time</label>
                    <input
                      type="time"
                      className="w-full border rounded-lg px-3 py-2 text-sm bg-white"
                      value={field.validation.min_time || ''}
                      onChange={e => updateValidation('min_time', e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-600 mb-1">Max Time</label>
                    <input
                      type="time"
                      className="w-full border rounded-lg px-3 py-2 text-sm bg-white"
                      value={field.validation.max_time || ''}
                      onChange={e => updateValidation('max_time', e.target.value)}
                    />
                  </div>
                </div>
              </div>
            )}

            {['checkbox', 'checkbox_api'].includes(field.field_type) && (
              <div className="border border-gray-200 rounded-lg p-3 mb-3 bg-gray-50 space-y-2">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Selection Limits</p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-gray-600 mb-1">Min Selections</label>
                    <input
                      type="number"
                      className="w-full border rounded-lg px-3 py-2 text-sm bg-white"
                      value={field.validation.min_selections ?? ''}
                      onChange={e => updateValidation('min_selections', e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-600 mb-1">Max Selections</label>
                    <input
                      type="number"
                      className="w-full border rounded-lg px-3 py-2 text-sm bg-white"
                      value={field.validation.max_selections ?? ''}
                      onChange={e => updateValidation('max_selections', e.target.value)}
                    />
                  </div>
                </div>
              </div>
            )}

            {/* Options Editor (dropdown, checkbox) */}
            {['dropdown', 'checkbox'].includes(field.field_type) && (
              <div className="border border-gray-200 rounded-lg p-3 mb-3 bg-gray-50">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Options</p>
                <div className="space-y-2">
                  {field.options.map((opt, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <input
                        className="flex-1 border rounded-lg px-3 py-2 text-sm bg-white"
                        placeholder="Key"
                        value={opt.key}
                        onChange={e => updateOption(i, 'key', e.target.value)}
                      />
                      <input
                        className="flex-1 border rounded-lg px-3 py-2 text-sm bg-white"
                        placeholder="Value"
                        value={opt.value}
                        onChange={e => updateOption(i, 'value', e.target.value)}
                      />
                      <button
                        onClick={() => removeOption(i)}
                        className="text-red-400 hover:text-red-600 p-1"
                        title="Remove option"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                      </button>
                    </div>
                  ))}
                </div>
                <button
                  onClick={addOption}
                  className="mt-2 text-sm text-blue-600 hover:text-blue-800 font-medium"
                >
                  + Add Option
                </button>
              </div>
            )}

            {/* API Config (dropdown_api, checkbox_api) */}
            {['dropdown_api', 'checkbox_api'].includes(field.field_type) && (
              <div className="border border-gray-200 rounded-lg p-3 mb-3 bg-gray-50 space-y-2">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">API Configuration</p>
                <div>
                  <label className="block text-xs text-gray-600 mb-1">API Endpoint URL</label>
                  <input
                    className="w-full border rounded-lg px-3 py-2 text-sm bg-white"
                    placeholder="https://api.example.com/items"
                    value={field.api_config.endpoint}
                    onChange={e => updateApiConfig('endpoint', e.target.value)}
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-gray-600 mb-1">Value Key</label>
                    <input
                      className="w-full border rounded-lg px-3 py-2 text-sm bg-white"
                      placeholder="e.g. id"
                      value={field.api_config.value_key}
                      onChange={e => updateApiConfig('value_key', e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-600 mb-1">Label Key</label>
                    <input
                      className="w-full border rounded-lg px-3 py-2 text-sm bg-white"
                      placeholder="e.g. name"
                      value={field.api_config.label_key}
                      onChange={e => updateApiConfig('label_key', e.target.value)}
                    />
                  </div>
                </div>
              </div>
            )}

            {/* Required toggle */}
            <label className="flex items-center justify-between cursor-pointer mb-4">
              <span className="text-sm font-medium text-gray-700">Required field</span>
              <button
                type="button"
                onClick={() => updateField({ is_required: !field.is_required })}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${field.is_required ? 'bg-blue-600' : 'bg-gray-300'}`}
              >
                <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${field.is_required ? 'translate-x-6' : 'translate-x-1'}`} />
              </button>
            </label>

            {/* Conditional visibility */}
            <div className="border border-gray-200 rounded-lg p-3 mb-4">
              <p className="text-sm font-medium text-gray-700 mb-2">Show this field only when:</p>
              <div className="space-y-2">
                {field.conditions.map((cond, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <select
                      className="flex-1 border rounded-lg px-2 py-1.5 text-sm bg-white"
                      value={cond.field_key}
                      onChange={e => updateCondition(i, 'field_key', e.target.value)}
                    >
                      <option value="">Select field...</option>
                      {otherFields.map((f: any) => (
                        <option key={f.id} value={f.field_key}>{f.label}</option>
                      ))}
                    </select>
                    <select
                      className="border rounded-lg px-2 py-1.5 text-sm bg-white"
                      value={cond.operator}
                      onChange={e => updateCondition(i, 'operator', e.target.value)}
                    >
                      {OPERATOR_DISPLAY.map(op => (
                        <option key={op} value={op}>{op}</option>
                      ))}
                    </select>
                    <input
                      className="flex-1 border rounded-lg px-2 py-1.5 text-sm bg-white"
                      placeholder="Value"
                      value={cond.value}
                      onChange={e => updateCondition(i, 'value', e.target.value)}
                    />
                    <button
                      onClick={() => removeCondition(i)}
                      className="text-red-400 hover:text-red-600 p-1"
                      title="Remove condition"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                    </button>
                  </div>
                ))}
              </div>
              <button
                onClick={addCondition}
                className="mt-2 text-sm text-blue-600 hover:text-blue-800 font-medium"
              >
                + Add Condition
              </button>
            </div>

            {/* Modal actions */}
            <div className="flex gap-3">
              <button
                onClick={() => { setShowModal(false); setEditing(null); }}
                className="flex-1 border rounded-lg px-4 py-2 text-sm"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={!field.label || saving}
                className="flex-1 bg-blue-600 text-white rounded-lg px-4 py-2 text-sm disabled:opacity-50 hover:bg-blue-700"
              >
                {saving ? 'Saving...' : 'Save Field'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
