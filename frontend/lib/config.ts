/**
 * Returns the API base URL, auto-upgrading HTTP → HTTPS when the page
 * is served over HTTPS (avoids mixed-content / "requested insecurely" errors).
 */
function resolveApiUrl(): string {
  const envUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';
  if (typeof window !== 'undefined' && window.location.protocol === 'https:') {
    return envUrl.replace(/^http:/, 'https:');
  }
  return envUrl;
}

export const API_URL = resolveApiUrl();
