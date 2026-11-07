import type { Metadata, Viewport } from 'next'
import './globals.css'
import { LayoutClient } from './layout-client'
import GlobalErrorCapture from '@/components/GlobalErrorCapture'
import ErrorBoundary from '@/components/ErrorBoundary'

// Render all pages at runtime — backend isn't available during Docker build
export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Social Media Messenger',
  description: 'Unified messaging platform for all social media',
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // Required for env(safe-area-inset-*) to report real values. Without it
  // iOS lays the page out inside the safe area and reports every inset as
  // 0, so lib/native.ts probed 0, --sa-top stayed 0px, and the fixed header
  // rendered underneath the status bar and Dynamic Island.
  viewportFit: 'cover',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body>
        <GlobalErrorCapture />
        <ErrorBoundary>
          <LayoutClient>{children}</LayoutClient>
        </ErrorBoundary>
      </body>
    </html>
  )
}
