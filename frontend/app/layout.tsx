import type { Metadata } from 'next'
import './globals.css'
import { LayoutClient } from './layout-client'

export const metadata: Metadata = {
  title: 'Social Media Messenger',
  description: 'Unified messaging platform for all social media',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body>
        <LayoutClient>{children}</LayoutClient>
      </body>
    </html>
  )
}
