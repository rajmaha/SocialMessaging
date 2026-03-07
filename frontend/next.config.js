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
  async rewrites() {
    const backendUrl = process.env.BACKEND_INTERNAL_URL || 'http://backend:8000';
    return [
      // Static file storage (logos, avatars, attachments, audio)
      { source: '/logos/:path*', destination: `${backendUrl}/logos/:path*` },
      { source: '/avatars/:path*', destination: `${backendUrl}/avatars/:path*` },
      { source: '/attachments/:path*', destination: `${backendUrl}/attachments/:path*` },
      { source: '/audio/:path*', destination: `${backendUrl}/audio/:path*` },
      { source: '/subscription-logos/:path*', destination: `${backendUrl}/subscription-logos/:path*` },
      // WebSocket upgrade for live chat widget
      { source: '/webchat/:path*', destination: `${backendUrl}/webchat/:path*` },
      // SSE events stream
      { source: '/events/:path*', destination: `${backendUrl}/events/:path*` },
      // All /api/* paths (pms, servers, etc.)
      { source: '/api/:path*', destination: `${backendUrl}/api/:path*` },
      // Backend REST routes — catch-all for everything that isn't a Next.js page/asset
      { source: '/auth/:path*', destination: `${backendUrl}/auth/:path*` },
      { source: '/conversations/:path*', destination: `${backendUrl}/conversations/:path*` },
      { source: '/messages/:path*', destination: `${backendUrl}/messages/:path*` },
      { source: '/accounts/:path*', destination: `${backendUrl}/accounts/:path*` },
      { source: '/admin/:path*', destination: `${backendUrl}/admin/:path*` },
      { source: '/branding/:path*', destination: `${backendUrl}/branding/:path*` },
      { source: '/teams/:path*', destination: `${backendUrl}/teams/:path*` },
      { source: '/reports/:path*', destination: `${backendUrl}/reports/:path*` },
      { source: '/email/:path*', destination: `${backendUrl}/email/:path*` },
      { source: '/billing/:path*', destination: `${backendUrl}/billing/:path*` },
      { source: '/crm/:path*', destination: `${backendUrl}/crm/:path*` },
      { source: '/automations/:path*', destination: `${backendUrl}/automations/:path*` },
      { source: '/bot/:path*', destination: `${backendUrl}/bot/:path*` },
      { source: '/webhooks/:path*', destination: `${backendUrl}/webhooks/:path*` },
      { source: '/call-center/:path*', destination: `${backendUrl}/call-center/:path*` },
      { source: '/telephony/:path*', destination: `${backendUrl}/telephony/:path*` },
      { source: '/calls/:path*', destination: `${backendUrl}/calls/:path*` },
      { source: '/extensions/:path*', destination: `${backendUrl}/extensions/:path*` },
      { source: '/agent-workspace/:path*', destination: `${backendUrl}/agent-workspace/:path*` },
      { source: '/reminders/:path*', destination: `${backendUrl}/reminders/:path*` },
      { source: '/notifications/:path*', destination: `${backendUrl}/notifications/:path*` },
      { source: '/tickets/:path*', destination: `${backendUrl}/tickets/:path*` },
      { source: '/dynamic-fields/:path*', destination: `${backendUrl}/dynamic-fields/:path*` },
      { source: '/organizations/:path*', destination: `${backendUrl}/organizations/:path*` },
      { source: '/cloudpanel/:path*', destination: `${backendUrl}/cloudpanel/:path*` },
      { source: '/individuals/:path*', destination: `${backendUrl}/individuals/:path*` },
      { source: '/todos/:path*', destination: `${backendUrl}/todos/:path*` },
      { source: '/calendar/:path*', destination: `${backendUrl}/calendar/:path*` },
      { source: '/kb/:path*', destination: `${backendUrl}/kb/:path*` },
      { source: '/campaigns/:path*', destination: `${backendUrl}/campaigns/:path*` },
      { source: '/email-templates/:path*', destination: `${backendUrl}/email-templates/:path*` },
      { source: '/db-migrations/:path*', destination: `${backendUrl}/db-migrations/:path*` },
      { source: '/backups/:path*', destination: `${backendUrl}/backups/:path*` },
      { source: '/roles/:path*', destination: `${backendUrl}/roles/:path*` },
      { source: '/forms/:path*', destination: `${backendUrl}/forms/:path*` },
      { source: '/menu/:path*', destination: `${backendUrl}/menu/:path*` },
      { source: '/user/:path*', destination: `${backendUrl}/user/:path*` },
      { source: '/logs/:path*', destination: `${backendUrl}/logs/:path*` },
      { source: '/docs', destination: `${backendUrl}/docs` },
      { source: '/openapi.json', destination: `${backendUrl}/openapi.json` },
    ];
  },
}

module.exports = nextConfig
