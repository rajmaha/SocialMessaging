/**
 * Returns the API base URL.
 *
 * Docker / Coolify: NEXT_PUBLIC_API_URL is empty → returns '' (same origin).
 *   All API calls hit the Next.js server, which proxies them via rewrites
 *   to the backend container internally.
 *
 * Local dev: NEXT_PUBLIC_API_URL = http://localhost:8000 → browser calls
 *   the backend directly (no rewrites needed).
 */
function resolveApiUrl(): string {
  const envUrl = process.env.NEXT_PUBLIC_API_URL || '';

  // If we have a full URL and the page is served over HTTPS, upgrade to HTTPS
  if (envUrl && typeof window !== 'undefined' && window.location.protocol === 'https:') {
    return envUrl.replace(/^http:/, 'https:');
  }
  return envUrl;
}

export const API_URL = resolveApiUrl();
