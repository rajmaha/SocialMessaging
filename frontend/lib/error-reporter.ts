/**
 * frontend/lib/error-reporter.ts
 *
 * Shared utility for sending frontend errors to the backend error log.
 * Imported by GlobalErrorCapture, ErrorBoundary, and the axios interceptor.
 */

import { API_URL } from './config';

/** Read the logged-in user's ID from localStorage (same key authAPI uses). */
function getCurrentUserId(): number | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem('user');
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed?.user_id ?? null;
  } catch {
    return null;
  }
}

/**
 * Simple in-memory deduplication: keep a Set of recently sent error keys.
 * Each key is a short composite of (message + url). Entries expire after 60 s
 * so the same recurring error isn't logged more than once per minute.
 */
const _recentErrors = new Set<string>();
function isDuplicate(key: string): boolean {
  if (_recentErrors.has(key)) return true;
  _recentErrors.add(key);
  setTimeout(() => _recentErrors.delete(key), 60_000);
  return false;
}

export interface ErrorPayload {
  message: string;
  error_type?: string;
  stack?: string;
  url?: string;
  line?: number;
  col?: number;
}

/**
 * Send one error report to POST /logs/frontend-error.
 * - Deduplicates identical errors within a 60-second window.
 * - Automatically attaches the current user's ID (if logged in).
 * - Never throws — swallows its own failures silently.
 */
export function reportError(payload: ErrorPayload): void {
  const dedupKey = `${payload.message}|${payload.url ?? ''}`;
  if (isDuplicate(dedupKey)) return;

  fetch(`${API_URL}/logs/frontend-error`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...payload,
      user_id: getCurrentUserId(),
    }),
  }).catch(() => {}); // never let error reporting itself throw
}
