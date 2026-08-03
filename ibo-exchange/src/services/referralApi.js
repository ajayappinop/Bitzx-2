import { authFetch } from '@/context/AuthContext';
import { exchangeApiOrigin } from '@/lib/apiBase';
import { formatApiDetail } from '@/lib/authValidation';

const API = exchangeApiOrigin(import.meta.env.VITE_BACKEND_URL);
const DEFAULT_TIMEOUT_MS = 20000;

async function parseErr(res) {
  const data = await res.json().catch(() => ({}));
  if (res.status === 404) {
    throw new Error(
      'Refer & Earn is not available on this API server yet. Deploy the latest backend or point VITE_BACKEND_URL to a server that includes /api/referral routes.',
    );
  }
  throw new Error(formatApiDetail(data?.detail) || data?.message || `Request failed (${res.status})`);
}

async function fetchWithTimeout(url, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const ctrl = new AbortController();
  const timer = window.setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await authFetch(url, { signal: ctrl.signal });
    return res;
  } catch (err) {
    if (err?.name === 'AbortError') {
      throw new Error('Refer & Earn request timed out. The API may be slow or unreachable — try again.');
    }
    throw err;
  } finally {
    window.clearTimeout(timer);
  }
}

export async function fetchMyReferralInfo() {
  const res = await fetchWithTimeout(`${API}/api/referral/me`);
  if (!res.ok) await parseErr(res);
  return res.json();
}

export async function fetchMyReferralTree() {
  const res = await fetchWithTimeout(`${API}/api/referral/tree`);
  if (!res.ok) await parseErr(res);
  return res.json();
}
