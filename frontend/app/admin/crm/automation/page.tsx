'use client'
import { useState, useEffect } from 'react'
import api from '@/lib/api'

const TRIGGER_TYPES = [
  { value: 'no_activity', label: 'No activity for X days' },
  { value: 'score_below', label: 'Lead score below threshold' },
  { value: 'lead_created', label: 'Lead created' },
  { value: 'lead_status_change', label: 'Lead status changes' },
]

const ACTION_TYPES = [
  { value: 'create_task', label: 'Create Task' },
  { value: 'change_lead_status', label: 'Change Lead Status' },
  { value: 'assign_lead', label: 'Assign Lead' },
]

export default function AutomationPage() {
  const [tab, setTab] = useState<'rules' | 'sequences'>('rules')
  const [rules, setRules] = useState<any[]>([])
  const [sequences, setSequences] = useState<any[]>([])
  const [showRuleForm, setShowRuleForm] = useState(false)
  const [showSeqForm, setShowSeqForm] = useState(false)
  const [ruleForm, setRuleForm] = useState<any>({ name: '', trigger_type: 'no_activity', conditions: { days: 3 }, actions: [{ type: 'create_task', title: 'Follow up' }] })
  const [seqForm, setSeqForm] = useState<any>({ name: '', description: '', steps: [{ step_order: 1, delay_days: 1, subject: '', body_html: '' }] })

  const loadRules = () => api.get('/crm/automation/rules').then(r => setRules(r.data)).catch(() => {})
  const loadSeqs = () => api.get('/crm/automation/sequences').then(r => setSequences(r.data)).catch(() => {})

  useEffect(() => { loadRules(); loadSeqs() }, [])

  const saveRule = async () => {
    if (!ruleForm.name) return
    await api.post('/crm/automation/rules', ruleForm)
    setShowRuleForm(false)
    setRuleForm({ name: '', trigger_type: 'no_activity', conditions: { days: 3 }, actions: [{ type: 'create_task', title: 'Follow up' }] })
    loadRules()
  }

  const toggleRule = async (rule: any) => {
    await api.patch(`/crm/automation/rules/${rule.id}`, { is_active: !rule.is_active })
    loadRules()
  }

  const deleteRule = async (id: number) => {
    if (!confirm('Delete this rule?')) return
    await api.delete(`/crm/automation/rules/${id}`)
    loadRules()
  }

  const saveSeq = async () => {
    if (!seqForm.name) return
    await api.post('/crm/automation/sequences', seqForm)
    setShowSeqForm(false)
    setSeqForm({ name: '', description: '', steps: [{ step_order: 1, delay_days: 1, subject: '', body_html: '' }] })
    loadSeqs()
  }

  const addStep = () => setSeqForm((f: any) => ({
    ...f,
    steps: [...f.steps, { step_order: f.steps.length + 1, delay_days: f.steps.length + 1, subject: '', body_html: '' }]
  }))

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Automation & Workflows</h1>
          <p className="text-sm text-gray-500 mt-1">Automate lead actions and email sequences</p>
        </div>
      </div>

      <div className="flex gap-1 mb-6 border-b">
        {(['rules', 'sequences'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium capitalize ${tab === t ? 'border-b-2 border-indigo-600 text-indigo-600' : 'text-gray-500 hover:text-gray-700'}`}>
            {t === 'rules' ? `Rules (${rules.length})` : `Email Sequences (${sequences.length})`}
          </button>
        ))}
      </div>

      {tab === 'rules' && (
        <div>
          <div className="flex justify-end mb-4">
            <button onClick={() => setShowRuleForm(true)} className="bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-indigo-700">
              + New Rule
            </button>
          </div>

          {showRuleForm && (
            <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-5 mb-6 space-y-4">
              <h3 className="font-semibold text-indigo-800">New Automation Rule</h3>
              <div>
                <label className="text-sm font-medium block mb-1">Rule Name</label>
                <input value={ruleForm.name} onChange={(e: any) => setRuleForm((f: any) => ({ ...f, name: e.target.value }))}
                  className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none" placeholder="e.g. Follow up stale leads" />
              </div>
              <div>
                <label className="text-sm font-medium block mb-1">Trigger</label>
                <select value={ruleForm.trigger_type} onChange={(e: any) => setRuleForm((f: any) => ({ ...f, trigger_type: e.target.value }))}
                  className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none">
                  {TRIGGER_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </div>
              {ruleForm.trigger_type === 'no_activity' && (
                <div>
                  <label className="text-sm font-medium block mb-1">Days without activity</label>
                  <input type="number" value={ruleForm.conditions?.days || 3}
                    onChange={(e: any) => setRuleForm((f: any) => ({ ...f, conditions: { ...f.conditions, days: parseInt(e.target.value) } }))}
                    className="border rounded-lg px-3 py-2 text-sm w-24 focus:outline-none" />
                </div>
              )}
              {ruleForm.trigger_type === 'score_below' && (
                <div>
                  <label className="text-sm font-medium block mb-1">Score threshold</label>
                  <input type="number" value={ruleForm.conditions?.threshold || 10}
                    onChange={(e: any) => setRuleForm((f: any) => ({ ...f, conditions: { ...f.conditions, threshold: parseInt(e.target.value) } }))}
                    className="border rounded-lg px-3 py-2 text-sm w-24 focus:outline-none" />
                </div>
              )}
              <div>
                <label className="text-sm font-medium block mb-1">Action</label>
                <select value={ruleForm.actions[0]?.type} onChange={(e: any) => setRuleForm((f: any) => ({ ...f, actions: [{ ...f.actions[0], type: e.target.value }] }))}
                  className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none">
                  {ACTION_TYPES.map(a => <option key={a.value} value={a.value}>{a.label}</option>)}
                </select>
              </div>
              {ruleForm.actions[0]?.type === 'create_task' && (
                <div>
                  <label className="text-sm font-medium block mb-1">Task title</label>
                  <input value={ruleForm.actions[0]?.title || ''} onChange={(e: any) => setRuleForm((f: any) => ({ ...f, actions: [{ ...f.actions[0], title: e.target.value }] }))}
                    className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none" placeholder="Task title" />
                </div>
              )}
              <div className="flex gap-3">
                <button onClick={saveRule} className="bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm">Save Rule</button>
                <button onClick={() => setShowRuleForm(false)} className="border px-4 py-2 rounded-lg text-sm text-gray-600">Cancel</button>
              </div>
            </div>
          )}

          <div className="space-y-3">
            {rules.map(rule => (
              <div key={rule.id} className="bg-white border rounded-xl px-4 py-4 flex items-center gap-4">
                <div className="flex-1">
                  <p className="font-medium text-sm">{rule.name}</p>
                  <p className="text-xs text-gray-400">Trigger: {rule.trigger_type} · {(rule.actions || []).length} action(s)</p>
                  {rule.last_run_at && <p className="text-xs text-gray-300">Last run: {new Date(rule.last_run_at).toLocaleString()}</p>}
                </div>
                <button onClick={() => toggleRule(rule)}
                  className={`px-3 py-1 rounded-full text-xs font-semibold ${rule.is_active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                  {rule.is_active ? 'Active' : 'Inactive'}
                </button>
                <button onClick={() => deleteRule(rule.id)} className="text-red-400 hover:text-red-600 text-xs">Delete</button>
              </div>
            ))}
            {rules.length === 0 && !showRuleForm && <p className="text-gray-400 text-sm">No automation rules yet.</p>}
          </div>
        </div>
      )}

      {tab === 'sequences' && (
        <div>
          <div className="flex justify-end mb-4">
            <button onClick={() => setShowSeqForm(true)} className="bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-indigo-700">
              + New Sequence
            </button>
          </div>

          {showSeqForm && (
            <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-5 mb-6 space-y-4">
              <h3 className="font-semibold text-indigo-800">New Email Sequence</h3>
              <div>
                <label className="text-sm font-medium block mb-1">Sequence Name</label>
                <input value={seqForm.name} onChange={(e: any) => setSeqForm((f: any) => ({ ...f, name: e.target.value }))}
                  className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none" placeholder="e.g. New Lead Drip" />
              </div>
              <div>
                <label className="text-sm font-medium block mb-1">Steps</label>
                <div className="space-y-3">
                  {seqForm.steps.map((step: any, idx: number) => (
                    <div key={idx} className="bg-white border rounded-lg p-3 space-y-2">
                      <div className="flex items-center gap-3">
                        <span className="text-xs font-semibold text-indigo-600 w-16">Step {idx + 1}</span>
                        <label className="text-xs text-gray-500">Send after</label>
                        <input type="number" value={step.delay_days} min={0}
                          onChange={(e: any) => setSeqForm((f: any) => {
                            const steps = [...f.steps]; steps[idx] = { ...steps[idx], delay_days: parseInt(e.target.value) }; return { ...f, steps }
                          })}
                          className="border rounded px-2 py-1 text-xs w-16 focus:outline-none" />
                        <span className="text-xs text-gray-500">days</span>
                      </div>
                      <input value={step.subject}
                        onChange={(e: any) => setSeqForm((f: any) => { const steps = [...f.steps]; steps[idx] = { ...steps[idx], subject: e.target.value }; return { ...f, steps } })}
                        className="w-full border rounded px-2 py-1 text-sm focus:outline-none" placeholder="Email subject" />
                      <textarea value={step.body_html}
                        onChange={(e: any) => setSeqForm((f: any) => { const steps = [...f.steps]; steps[idx] = { ...steps[idx], body_html: e.target.value }; return { ...f, steps } })}
                        rows={3} className="w-full border rounded px-2 py-1 text-sm focus:outline-none" placeholder="Email body (HTML supported)" />
                    </div>
                  ))}
                </div>
                <button onClick={addStep} className="mt-2 text-sm text-indigo-600 hover:text-indigo-800">+ Add Step</button>
              </div>
              <div className="flex gap-3">
                <button onClick={saveSeq} className="bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm">Save Sequence</button>
                <button onClick={() => setShowSeqForm(false)} className="border px-4 py-2 rounded-lg text-sm text-gray-600">Cancel</button>
              </div>
            </div>
          )}

          <div className="space-y-3">
            {sequences.map(seq => (
              <div key={seq.id} className="bg-white border rounded-xl px-4 py-4 flex items-center gap-4">
                <div className="flex-1">
                  <p className="font-medium text-sm">{seq.name}</p>
                  <p className="text-xs text-gray-400">{seq.step_count} steps · {seq.enrollment_count} enrolled</p>
                </div>
                <span className={`px-3 py-1 rounded-full text-xs font-semibold ${seq.is_active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                  {seq.is_active ? 'Active' : 'Inactive'}
                </span>
              </div>
            ))}
            {sequences.length === 0 && !showSeqForm && <p className="text-gray-400 text-sm">No email sequences yet.</p>}
          </div>
        </div>
      )}
    </div>
  )
}
