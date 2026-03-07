// frontend/components/GlobalErrorCapture.tsx
'use client';

import { useEffect } from 'react';
import { reportError } from '@/lib/error-reporter';

/**
 * Mounted at the root layout. Attaches global listeners for:
 *   - Unhandled JS exceptions     (window 'error')
 *   - Unhandled Promise rejections (window 'unhandledrejection')
 *
 * React render errors are caught separately by <ErrorBoundary>.
 * API-level 5xx errors are captured by the axios response interceptor in lib/api.ts.
 */
export default function GlobalErrorCapture() {
  useEffect(() => {
    const onError = (event: ErrorEvent) => {
      reportError({
        message: event.message || 'Unknown error',
        // Use error.name for the specific JS type (TypeError, ReferenceError, …)
        error_type: event.error?.name || 'JavaScriptError',
        stack: event.error?.stack,
        // Page URL is more useful than the script filename for debugging
        url: window.location.href,
        line: event.lineno,
        col: event.colno,
      });
    };

    const onUnhandledRejection = (event: PromiseRejectionEvent) => {
      const reason = event.reason;
      reportError({
        message: reason?.message || String(reason) || 'Unhandled Promise rejection',
        error_type: reason?.name || 'UnhandledRejection',
        stack: reason?.stack,
        url: window.location.href,
      });
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
