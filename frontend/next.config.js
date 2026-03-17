/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: 'standalone',

  // In Docker: NEXT_PUBLIC_API_URL is empty → browser calls same origin
  // Locally:  NEXT_PUBLIC_API_URL = http://localhost:8000 → browser calls backend directly
  env: {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL || '',
  },

  // Proxy API calls to the backend when running behind the same origin (Docker/Coolify).
  // The internal backend URL defaults to http://backend:8000 (Docker service name).
  // Locally this is unused because NEXT_PUBLIC_API_URL is set to the full backend URL.
  //
  // Rewrite phases:
  //   afterFiles  — runs AFTER static pages but BEFORE dynamic routes.
  //                 Safe for paths that have NO Next.js pages (auth, conversations, etc.)
  //   fallback    — runs AFTER all Next.js pages (static AND dynamic).
  //                 Required for /admin/:path* so dynamic pages like /admin/visitors/[id]
  //                 are served by Next.js instead of being proxied to the backend.
  async rewrites() {
    const backendUrl = process.env.BACKEND_INTERNAL_URL || 'http://backend:8000';

    // Paths that have no corresponding Next.js page — safe in afterFiles phase
    const afterFiles = [
      // Static file storage
      { source: '/logos/:path*',               destination: `${backendUrl}/logos/:path*` },
      { source: '/avatars/:path*',             destination: `${backendUrl}/avatars/:path*` },
      { source: '/attachments/:path*',         destination: `${backendUrl}/attachments/:path*` },
      { source: '/audio/:path*',               destination: `${backendUrl}/audio/:path*` },
      { source: '/subscription-logos/:path*',  destination: `${backendUrl}/subscription-logos/:path*` },
      { source: '/uploads/:path*',              destination: `${backendUrl}/uploads/:path*` },
      { source: '/visitor-photos/:path*',      destination: `${backendUrl}/visitor-photos/:path*` },
      { source: '/visitor-cctv/:path*',        destination: `${backendUrl}/visitor-cctv/:path*` },
      // Real-time / WebSocket
      { source: '/webchat/:path*',             destination: `${backendUrl}/webchat/:path*` },
      { source: '/events/:path*',              destination: `${backendUrl}/events/:path*` },
      // Pure API paths (no Next.js pages at these roots)
      { source: '/api/:path*',                 destination: `${backendUrl}/api/:path*` },
      { source: '/auth/:path*',                destination: `${backendUrl}/auth/:path*` },
      { source: '/conversations/:path*',       destination: `${backendUrl}/conversations/:path*` },
      { source: '/messages/:path*',            destination: `${backendUrl}/messages/:path*` },
      { source: '/accounts/:path*',            destination: `${backendUrl}/accounts/:path*` },
      { source: '/branding/:path*',            destination: `${backendUrl}/branding/:path*` },
      { source: '/teams/:path*',               destination: `${backendUrl}/teams/:path*` },
      { source: '/reports/:path*',             destination: `${backendUrl}/reports/:path*` },
      { source: '/email/:path*',               destination: `${backendUrl}/email/:path*` },
      { source: '/billing/:path*',             destination: `${backendUrl}/billing/:path*` },
      { source: '/crm/:path*',                 destination: `${backendUrl}/crm/:path*` },
      { source: '/automations/:path*',         destination: `${backendUrl}/automations/:path*` },
      { source: '/bot/:path*',                 destination: `${backendUrl}/bot/:path*` },
      { source: '/webhooks/:path*',            destination: `${backendUrl}/webhooks/:path*` },
      { source: '/call-center/:path*',         destination: `${backendUrl}/call-center/:path*` },
      { source: '/telephony/:path*',           destination: `${backendUrl}/telephony/:path*` },
      { source: '/calls/:path*',               destination: `${backendUrl}/calls/:path*` },
      { source: '/extensions/:path*',          destination: `${backendUrl}/extensions/:path*` },
      { source: '/agent-workspace/:path*',     destination: `${backendUrl}/agent-workspace/:path*` },
      { source: '/workspace/:path*',           destination: `${backendUrl}/workspace/:path*` },
      { source: '/reminders/:path*',           destination: `${backendUrl}/reminders/:path*` },
      { source: '/notifications/:path*',       destination: `${backendUrl}/notifications/:path*` },
      { source: '/tickets/:path*',             destination: `${backendUrl}/tickets/:path*` },
      { source: '/dynamic-fields/:path*',      destination: `${backendUrl}/dynamic-fields/:path*` },
      { source: '/cloudpanel/:path*',          destination: `${backendUrl}/cloudpanel/:path*` },
      { source: '/todos/:path*',               destination: `${backendUrl}/todos/:path*` },
      { source: '/calendar/:path*',            destination: `${backendUrl}/calendar/:path*` },
      { source: '/db-migrations/:path*',       destination: `${backendUrl}/db-migrations/:path*` },
      { source: '/backups/:path*',             destination: `${backendUrl}/backups/:path*` },
      { source: '/roles/:path*',               destination: `${backendUrl}/roles/:path*` },
      { source: '/menu/:path*',                destination: `${backendUrl}/menu/:path*` },
      { source: '/user/:path*',                destination: `${backendUrl}/user/:path*` },
      { source: '/logs/:path*',                destination: `${backendUrl}/logs/:path*` },
      { source: '/docs',                       destination: `${backendUrl}/docs` },
      { source: '/openapi.json',               destination: `${backendUrl}/openapi.json` },
      // Backend API routes that share a prefix with Next.js frontend pages.
      // These are safe in afterFiles because static pages take priority, and API
      // calls are made with Authorization headers to paths like /visitors/1 (not
      // /admin/visitors/1), so there is no conflict with the frontend page tree.
      { source: '/visitors/:path*',            destination: `${backendUrl}/visitors/:path*` },
      { source: '/visitors',                   destination: `${backendUrl}/visitors/` },
      { source: '/organizations/:path*',       destination: `${backendUrl}/organizations/:path*` },
      { source: '/individuals/:path*',         destination: `${backendUrl}/individuals/:path*` },
      { source: '/kb/:path*',                  destination: `${backendUrl}/kb/:path*` },
      { source: '/campaigns/:path*',           destination: `${backendUrl}/campaigns/:path*` },
      { source: '/email-templates/:path*',     destination: `${backendUrl}/email-templates/:path*` },
      { source: '/forms/:path*',               destination: `${backendUrl}/forms/:path*` },
    ];

    // /admin/:path* MUST be in fallback so Next.js dynamic admin pages
    // (/admin/visitors/[id], /admin/organizations/[id], etc.) are served
    // by Next.js rather than proxied to the backend.
    const fallback = [
      { source: '/admin/:path*', destination: `${backendUrl}/admin/:path*` },
    ];

    return { afterFiles, fallback };
  },
}

module.exports = nextConfig
