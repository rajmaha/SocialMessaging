'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { API_URL } from '@/lib/config'
import { getAuthToken } from '@/lib/auth'

// Live progress for a site deployment run by the backend's
// CloudPanelService.create_site_steps(): a bar, the time so far, every step
// with a tick or a spinner, and under the running step what it is doing right
// now ("Uploaded 420 of 980 files", "Running 3-migration-bundle.sql (3 of 10)").
// Used by Admin -> CloudPanel -> Deploy and by an organization's Subscriptions.

export type DeployStepStatus = 'pending' | 'in_progress' | 'done' | 'skipped' | 'error'

export interface DeployStepState {
  id: string
  label: string
  status: DeployStepStatus
  detail?: string
  current?: number
  total?: number
}

// The order the backend runs them in -- the steps tick off top to bottom, and
// a list in another order marks the wrong row as running.
export const SITE_DEPLOY_STEPS: { id: string; label: string }[] = [
  { id: 'creating_site', label: 'Creating Site' },
  { id: 'creating_ssl', label: 'Creating SSL' },
  { id: 'creating_database', label: 'Creating Database' },
  { id: 'deploying_files', label: 'Deploying Template Files' },
  { id: 'copying_logo', label: 'Copying Company Logo' },
  { id: 'running_script', label: 'Running Auto Script' },
  { id: 'importing_database', label: 'Importing Database' },
]

// How much of the bar each step takes: uploading files and importing the
// database are minutes, the rest seconds.
const WEIGHTS: Record<string, number> = {
  creating_site: 1,
  creating_ssl: 1,
  creating_database: 1,
  deploying_files: 4,
  copying_logo: 0.5,
  running_script: 1,
  importing_database: 5,
}

export function initialDeploySteps(steps: { id: string; label: string }[]): DeployStepState[] {
  return steps.map((s, i) => ({ ...s, status: i === 0 ? 'in_progress' : 'pending' }))
}

// Applies one streamed event. A "progress" event keeps its step running and
// updates what it says; a finished step (done / skipped / error) is ticked and
// the next pending one starts.
export function applyDeployEvent(steps: DeployStepState[], ev: any): DeployStepState[] {
  const idx = steps.findIndex(s => s.id === ev?.step)
  if (idx < 0) return steps
  if (ev.status === 'progress') {
    return steps.map((s, i) => i === idx
      ? { ...s, status: 'in_progress', detail: ev.detail ?? s.detail,
          current: typeof ev.current === 'number' ? ev.current : s.current,
          total: typeof ev.total === 'number' ? ev.total : s.total }
      : s)
  }
  const status: DeployStepStatus =
    ev.status === 'done' || ev.status === 'success' ? 'done'
      : ev.status === 'skipped' ? 'skipped'
        : ev.status === 'error' ? 'error' : 'done'
  const updated = steps.map((s, i) => i === idx
    ? { ...s, status, detail: status === 'error' ? (ev.message || s.detail) : undefined }
    : s)
  const next = updated.findIndex((s, i) => i > idx && s.status === 'pending')
  if (next >= 0) updated[next] = { ...updated[next], status: 'in_progress' }
  return updated
}

// Follows a deployment started with ?background=1: asks the server every
// 1.5 s for the events since the last answer and hands each to onEvent, the
// way CI/CD Deploy follows its runs. A streamed response did not work here:
// in Docker / Coolify the proxies held it back until it ended, so the screen
// jumped from the first step to the last. Resolves when the job ends.
export async function followDeployJob(
  jobId: string,
  onEvent: (ev: any) => void,
): Promise<{ status: string; error?: string | null }> {
  let after = 0
  let misses = 0
  for (;;) {
    await new Promise(r => setTimeout(r, 1500))
    try {
      const res = await fetch(`${API_URL}/cloudpanel/deploy-jobs/${jobId}?after=${after}`, {
        headers: { Authorization: `Bearer ${getAuthToken()}` },
      })
      if (res.status === 404) {
        return { status: 'failed', error: 'The server no longer knows this deployment (it may have restarted). Check the site before trying again.' }
      }
      if (!res.ok) throw new Error(String(res.status))
      misses = 0
      const data = await res.json()
      for (const ev of data.events || []) onEvent(ev)
      after = data.next ?? after
      if (data.status !== 'running') return { status: data.status, error: data.error }
    } catch {
      // A blip (a redeploy of this app, a dropped connection): keep asking for
      // a while; the deployment itself carries on on the server.
      if (++misses > 40) return { status: 'failed', error: 'Lost contact with the server while deploying. The deployment may still be running there.' }
    }
  }
}

export function failRunningStep(steps: DeployStepState[]): DeployStepState[] {
  return steps.map(s => s.status === 'in_progress' ? { ...s, status: 'error' } : s)
}

export function finishAllSteps(steps: DeployStepState[]): DeployStepState[] {
  return steps.map(s => s.status === 'in_progress' || s.status === 'pending' ? { ...s, status: 'done', detail: undefined } : s)
}

function percentDone(steps: DeployStepState[]): number {
  let total = 0
  let done = 0
  for (const s of steps) {
    const w = WEIGHTS[s.id] ?? 0.5
    total += w
    if (s.status === 'done' || s.status === 'skipped') done += w
    else if (s.status === 'in_progress' && s.total && s.total > 0) {
      done += w * Math.min(1, (s.current ?? 0) / s.total)
    }
  }
  return total ? Math.round((done / total) * 100) : 0
}

function formatDuration(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000))
  if (s < 60) return `${s}s`
  return `${Math.floor(s / 60)}m ${s % 60}s`
}

interface Props {
  title?: string
  steps: DeployStepState[]
  running: boolean
  startedAt: number | null
  error?: string
  success?: ReactNode
  onClose?: () => void
}

export default function DeployProgress({ title = 'Deploying Site', steps, running, startedAt, error, success, onClose }: Props) {
  const [now, setNow] = useState(Date.now())
  const [endedAt, setEndedAt] = useState<number | null>(null)

  useEffect(() => {
    if (!running) { setEndedAt(e => e ?? Date.now()); return }
    setEndedAt(null)
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [running])

  const elapsed = startedAt ? formatDuration((endedAt ?? now) - startedAt) : ''
  const failed = !!error || steps.some(s => s.status === 'error')
  // Only a stream that reached its end with every step ticked is a success;
  // one cut off half way (the connection dropped) is neither.
  const finishedOk = !running && !failed && !!success
    && steps.every(s => s.status === 'done' || s.status === 'skipped')
  const pct = finishedOk ? 100 : percentDone(steps)

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100 bg-gray-50/30">
          <h3 className="text-lg font-bold text-gray-900 text-center">{title}</h3>
        </div>
        <div className="p-6">
          {/* Progress bar */}
          <div className="mb-1 flex items-center justify-between text-xs">
            <span className={`font-semibold ${failed ? 'text-red-600' : finishedOk ? 'text-green-600' : 'text-blue-600'}`}>
              {failed ? 'Stopped' : finishedOk ? 'Done' : running ? `${pct}%` : `Ended at ${pct}%`}
            </span>
            <span className="text-gray-400">
              {running ? `Elapsed: ${elapsed}` : elapsed ? `${finishedOk ? 'Completed in' : 'Ran'} ${elapsed}` : ''}
            </span>
          </div>
          <div className="h-2 w-full rounded-full bg-gray-100 overflow-hidden mb-5">
            <div
              className={`h-full rounded-full transition-all duration-500 ${failed ? 'bg-red-500' : finishedOk ? 'bg-green-500' : 'bg-blue-500'} ${running ? 'animate-pulse' : ''}`}
              style={{ width: `${Math.max(pct, running ? 3 : 0)}%` }}
            />
          </div>

          <ul className="space-y-3">
            {steps.map(step => (
              <li key={step.id} className="flex items-start gap-3">
                <StepIcon status={step.status} />
                <div className="min-w-0 flex-1">
                  <span className={`text-sm font-medium ${step.status === 'done' ? 'text-green-700' : step.status === 'in_progress' ? 'text-blue-700' : step.status === 'error' ? 'text-red-700' : step.status === 'skipped' ? 'text-gray-400' : 'text-gray-500'}`}>
                    {step.label}
                    {step.status === 'skipped' && <span className="ml-1 text-xs font-normal">(skipped)</span>}
                  </span>
                  {step.detail && (step.status === 'in_progress' || step.status === 'error') && (
                    <div className={`text-xs mt-0.5 break-words ${step.status === 'error' ? 'text-red-600' : 'text-gray-500'}`}>
                      {step.detail}
                    </div>
                  )}
                  {step.status === 'in_progress' && step.total ? (
                    <div className="h-1 mt-1 w-full rounded-full bg-gray-100 overflow-hidden">
                      <div className="h-full bg-blue-300 transition-all duration-500"
                        style={{ width: `${Math.min(100, Math.round(((step.current ?? 0) / step.total) * 100))}%` }} />
                    </div>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>

          {running && (
            <p className="mt-4 text-xs text-gray-400 text-center">It runs on the server: leaving this page does not stop it.</p>
          )}

          {error && (
            <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700 break-words">{error}</div>
          )}

          {finishedOk && (
            <div className="mt-4 p-3 bg-green-50 border border-green-200 rounded-lg text-sm text-green-800">{success}</div>
          )}

          {!running && onClose && (
            <button onClick={onClose}
              className="mt-5 w-full py-2 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 transition-colors">
              Close
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

function StepIcon({ status }: { status: DeployStepStatus }) {
  if (status === 'done') return (
    <span className="flex-shrink-0 w-6 h-6 rounded-full bg-green-100 flex items-center justify-center">
      <svg className="w-4 h-4 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
      </svg>
    </span>
  )
  if (status === 'in_progress') return (
    <span className="flex-shrink-0 w-6 h-6 flex items-center justify-center">
      <svg className="animate-spin w-5 h-5 text-blue-600" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
      </svg>
    </span>
  )
  if (status === 'skipped') return (
    <span className="flex-shrink-0 w-6 h-6 rounded-full bg-gray-100 flex items-center justify-center">
      <svg className="w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M20 12H4" />
      </svg>
    </span>
  )
  if (status === 'error') return (
    <span className="flex-shrink-0 w-6 h-6 rounded-full bg-red-100 flex items-center justify-center">
      <svg className="w-4 h-4 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
      </svg>
    </span>
  )
  return <span className="flex-shrink-0 w-6 h-6 rounded-full border-2 border-gray-300" />
}
