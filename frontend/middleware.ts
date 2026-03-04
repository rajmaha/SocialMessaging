import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

// Map route prefixes to required page keys
const PAGE_GUARDS: Array<[string, string]> = [
  ['/admin/pms', 'pms'],
  ['/admin/tickets', 'tickets'],
  ['/admin/ticket-fields', 'tickets'],
  ['/admin/crm', 'crm'],
  ['/dashboard', 'messaging'],
  ['/admin/callcenter', 'callcenter'],
  ['/admin/recordings', 'callcenter'],
  ['/admin/telephony', 'callcenter'],
  ['/admin/extensions', 'callcenter'],
  ['/admin/campaigns', 'campaigns'],
  ['/admin/email-templates', 'campaigns'],
  ['/admin/reports', 'reports'],
  ['/admin/usage', 'reports'],
  ['/admin/kb', 'kb'],
  ['/admin/teams', 'teams'],
]

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Find matching guard
  const guard = PAGE_GUARDS.find(([prefix]) => pathname.startsWith(prefix))
  if (!guard) return NextResponse.next()

  const [, requiredPage] = guard

  // Read role and pages from cookies set at login
  const userRole = request.cookies.get('user_role')?.value
  const pagesCookie = request.cookies.get('user_pages')?.value

  if (!userRole) {
    return NextResponse.redirect(new URL('/login', request.url))
  }

  // Admin bypasses all checks
  if (userRole === 'admin') return NextResponse.next()

  // Check page access
  try {
    const pages: string[] = pagesCookie ? JSON.parse(pagesCookie) : []
    if (!pages.includes(requiredPage)) {
      return NextResponse.redirect(new URL('/unauthorized', request.url))
    }
  } catch {
    return NextResponse.redirect(new URL('/unauthorized', request.url))
  }

  return NextResponse.next()
}

export const config = {
  matcher: [
    '/admin/pms/:path*',
    '/admin/tickets/:path*',
    '/admin/ticket-fields',
    '/admin/crm/:path*',
    '/dashboard/:path*',
    '/admin/callcenter/:path*',
    '/admin/recordings',
    '/admin/telephony',
    '/admin/extensions',
    '/admin/campaigns/:path*',
    '/admin/email-templates',
    '/admin/reports',
    '/admin/usage',
    '/admin/kb/:path*',
    '/admin/teams',
  ],
}
