// frontend/components/GlobalErrorCapture.tsx
'use client';

import { useEffect } from 'react';
import { API_URL } from '@/lib/config';

export default function GlobalErrorCapture() {
  useEffect(() => {
    const sendError = (message: string, stack?: string, url?: string, line?: number, col?: number) => {
      fetch(`${API_URL}/logs/frontend-error`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, stack, url, line, col, error_type: 'JavaScriptError' }),
      }).catch(() => {}); // swallow any fetch errors silently
    };

    const onError = (event: ErrorEvent) => {
      sendError(event.message, event.error?.stack, event.filename, event.lineno, event.colno);
    };

    const onUnhandledRejection = (event: PromiseRejectionEvent) => {
      const reason = event.reason;
      sendError(
        reason?.message || String(reason),
        reason?.stack,
        window.location.href,
      );
    };

    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onUnhandledRejection);

    return () => {
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onUnhandledRejection);
    };
  }, []);

  return null;
}
