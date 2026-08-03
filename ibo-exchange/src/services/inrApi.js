import { authFetch } from '@/context/AuthContext';
import { exchangeApiOrigin } from '@/lib/apiBase';
import { formatApiDetail } from '@/lib/authValidation';

const API = exchangeApiOrigin(import.meta.env.VITE_BACKEND_URL);

function inrApiError(data, fallback) {
  return new Error(formatApiDetail(data?.detail) || fallback);
}

export function uploadUrl(path) {
  if (!path) return '';
  if (path.startsWith('http://') || path.startsWith('https://')) return path;
  return `${API}${path.startsWith('/') ? '' : '/'}${path}`;
}

function inrAssetRelPath(pathOrUrl) {
  if (!pathOrUrl) return '';
  if (pathOrUrl.startsWith('http://') || pathOrUrl.startsWith('https://')) {
    try {
      return new URL(pathOrUrl).pathname;
    } catch {
      return '';
    }
  }
  return pathOrUrl.startsWith('/') ? pathOrUrl : `/${pathOrUrl}`;
}

/** Save an uploaded asset (QR, screenshot path from API) to the user's device. */
export async function downloadUploadAsset(pathOrUrl, filenameBase = 'ibo-download') {
  const rel = inrAssetRelPath(pathOrUrl);
  if (!rel) throw new Error('Missing file URL');

  const tryUrls = [uploadUrl(rel)];
  if (rel.startsWith('/uploads/inr/')) {
    tryUrls.push(`${API}/api/inr/asset?path=${encodeURIComponent(rel)}`);
  }

  let res = null;
  let lastStatus = 0;
  for (const url of tryUrls) {
    const attempt = await fetch(url, { mode: 'cors', credentials: 'omit' });
    lastStatus = attempt.status;
    if (attempt.ok) {
      res = attempt;
      break;
    }
  }
  if (!res) throw new Error(`Download failed (HTTP ${lastStatus})`);

  const blob = await res.blob();
  const extFromPath = (pathOrUrl || '').match(/\.(jpe?g|png|webp)(\?|$)/i);
  const extFromType = blob.type === 'image/jpeg' ? '.jpg'
    : blob.type === 'image/png' ? '.png'
    : blob.type === 'image/webp' ? '.webp'
    : '';
  const ext = extFromPath?.[0]?.replace('?', '') || extFromType || '.png';
  const safeBase = String(filenameBase).replace(/[^\w.-]+/g, '_').slice(0, 80) || 'ibo-download';
  const filename = safeBase.endsWith(ext) ? safeBase : `${safeBase}${ext}`;

  const objectUrl = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement('a');
    anchor.href = objectUrl;
    anchor.download = filename;
    anchor.rel = 'noopener';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export async function fetchInrDepositConfig() {
  const res = await authFetch(`${API}/api/inr/config`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.detail || `Could not load deposit config (HTTP ${res.status})`);
  return data;
}

/** Public INR limits for landing / wallet promos (no auth). */
export async function fetchInrPublicInfo() {
  const res = await fetch(`${API}/api/inr/public-info`, { cache: 'no-store' });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.detail || `Could not load INR info (HTTP ${res.status})`);
  return data;
}

export async function fetchInrRate() {
  const res = await authFetch(`${API}/api/inr/rate`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.detail || `Could not load rate (HTTP ${res.status})`);
  return data;
}

export async function fetchInrPaymentMethods() {
  const res = await authFetch(`${API}/api/inr/payment-methods`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.detail || `Could not load payment methods (HTTP ${res.status})`);
  return data.items || [];
}

export async function fetchInrDeposits(params = {}) {
  const u = new URLSearchParams();
  if (params.skip != null) u.set('skip', String(params.skip));
  if (params.limit != null) u.set('limit', String(params.limit));
  const qs = u.toString();
  const res = await authFetch(`${API}/api/inr/deposits${qs ? `?${qs}` : ''}`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.detail || `Could not load deposits (HTTP ${res.status})`);
  return data;
}

export async function startInrGatewayDeposit({ amount_inr, payment_method_id }) {
  const res = await authFetch(`${API}/api/inr/deposits/gateway`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      amount_inr,
      payment_method_id: payment_method_id || null,
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.detail || `Checkout failed (HTTP ${res.status})`);
  return data;
}

export async function submitInrDeposit(formData) {
  const res = await authFetch(`${API}/api/inr/deposits`, {
    method: 'POST',
    body: formData,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw inrApiError(data, `Submit failed (HTTP ${res.status})`);
  return data;
}

export async function fetchInrPayoutProfile() {
  const res = await authFetch(`${API}/api/inr/withdrawals/payout-profile`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw inrApiError(data, `Could not load payout details (HTTP ${res.status})`);
  return data;
}

export async function saveInrPayoutProfile(body) {
  const res = await authFetch(`${API}/api/inr/withdrawals/payout-profile`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw inrApiError(data, `Could not save payout details (HTTP ${res.status})`);
  return data;
}

export async function fetchInrWithdrawalEligibility() {
  const res = await authFetch(`${API}/api/inr/withdrawals/eligibility`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.detail || `Could not load withdrawal eligibility (HTTP ${res.status})`);
  return data;
}

export async function fetchInrWithdrawals(params = {}) {
  const u = new URLSearchParams();
  if (params.skip != null) u.set('skip', String(params.skip));
  if (params.limit != null) u.set('limit', String(params.limit));
  const qs = u.toString();
  const res = await authFetch(`${API}/api/inr/withdrawals${qs ? `?${qs}` : ''}`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.detail || `Could not load withdrawals (HTTP ${res.status})`);
  return data;
}

export async function submitInrWithdrawal(body) {
  const res = await authFetch(`${API}/api/inr/withdrawals`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw inrApiError(data, `Submit failed (HTTP ${res.status})`);
  return data;
}

export async function cancelInrWithdrawal(withdrawalId) {
  const res = await authFetch(`${API}/api/inr/withdrawals/${encodeURIComponent(withdrawalId)}`, {
    method: 'DELETE',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw inrApiError(data, `Cancel failed (HTTP ${res.status})`);
  return data;
}
