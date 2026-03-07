'use client';

import React from 'react';
import { reportError } from '@/lib/error-reporter';

interface Props {
  children: React.ReactNode;
}

interface State {
  hasError: boolean;
  message: string;
}

/**
 * React Error Boundary — catches render / lifecycle exceptions that
 * window.onerror cannot see. Reports them to the backend error log and
 * shows a friendly fallback UI instead of a blank crash screen.
 */
export default class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, message: error?.message || 'Unknown render error' };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    reportError({
      message: error?.message || 'React render error',
      error_type: error?.name || 'ReactRenderError',
      stack: error?.stack
        ? `${error.stack}\n\nComponent stack:${info.componentStack}`
        : info.componentStack ?? undefined,
      url: typeof window !== 'undefined' ? window.location.href : undefined,
    });
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-gray-50">
          <div className="text-center max-w-md px-6">
            <div className="text-5xl mb-4">⚠️</div>
            <h1 className="text-xl font-bold text-gray-800 mb-2">Something went wrong</h1>
            <p className="text-sm text-gray-500 mb-6">
              An unexpected error occurred. Our team has been notified automatically.
            </p>
            <button
              onClick={() => {
                this.setState({ hasError: false, message: '' });
                window.location.reload();
              }}
              className="px-5 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm font-medium"
            >
              Reload page
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
