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

  if (envUrl && typeof window !== 'undefined') {
    const isLocalhostUrl = /localhost|127\.0\.0\.1/.test(envUrl);
    const isLocalhostOrigin = /localhost|127\.0\.0\.1/.test(window.location.hostname);

    // In production (non-localhost), ignore localhost API URLs and use
    // same-origin rewrites instead (Next.js proxies to backend internally)
    if (isLocalhostUrl && !isLocalhostOrigin) {
      return '';
    }

    // Upgrade http → https when page is served over HTTPS
    if (window.location.protocol === 'https:') {
      return envUrl.replace(/^http:/, 'https:');
    }
  }

  return envUrl;
}

export const API_URL = resolveApiUrl();
