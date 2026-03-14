/**
 * Returns the API base URL.
 *
 * Docker / Coolify (no NEXT_PUBLIC_API_URL set): returns '' (same origin).
 *   All API calls hit the Next.js server, which proxies them via rewrites
 *   to the backend container internally.
 *
 * Local dev: NEXT_PUBLIC_API_URL = http://localhost:8000 → browser calls
 *   the backend directly (no rewrites needed).
 *
 * Separate-subdomain deploy (NEXT_PUBLIC_API_URL = http://workapi.example.com):
 *   Automatically upgraded to https:// for any non-localhost URL so that
 *   CORS pre-flight requests never hit an HTTP→HTTPS redirect (307), which
 *   browsers refuse to follow for pre-flight.  This upgrade is done without
 *   relying on window.location so it works identically on the server (SSR)
 *   and in the browser.
 */
function resolveApiUrl(): string {
  const envUrl = process.env.NEXT_PUBLIC_API_URL || '';

  if (!envUrl) return '';

  const isLocalhost = /localhost|127\.0\.0\.1/.test(envUrl);

  // In production (non-localhost), always use HTTPS regardless of what the
  // env var says.  This prevents HTTP→HTTPS 307 redirects on pre-flight.
  if (!isLocalhost) {
    return envUrl.replace(/^http:\/\//, 'https://');
  }

  // Development localhost URL: use as-is (no HTTPS needed locally).
  // But if we're running on a non-localhost page (e.g. ngrok tunnel) with a
  // localhost API URL, fall back to same-origin rewrites instead.
  if (typeof window !== 'undefined') {
    const isLocalhostOrigin = /localhost|127\.0\.0\.1/.test(window.location.hostname);
    if (!isLocalhostOrigin) {
      return '';
    }
  }

  return envUrl;
}

export const API_URL = resolveApiUrl();
