/**
 * Normalize `VITE_BACKEND_URL` so `${origin}/api/...` is always correct.
 * Strips trailing slashes and a trailing `/api` (avoids `/api/api/...` → 404).
 */
export function exchangeApiOrigin(raw) {
  if (raw == null || String(raw).trim() === '') return 'http://localhost:8000';
  let s = String(raw).trim().replace(/\/+$/, '');
  while (s.toLowerCase().endsWith('/api')) {
    s = s.slice(0, -4).replace(/\/+$/, '');
  }
  return s || 'http://localhost:8000';
}
