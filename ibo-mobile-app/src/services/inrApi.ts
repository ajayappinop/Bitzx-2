/**
 * INR fiat API — mirrors ibo-exchange `services/inrApi.js` using authenticated axios client.
 */
import apiClient from '../api/client';
import { API_URL } from '../config/env';
import { parseApiError } from '../api/errors';

function inrApiError(data: unknown, fallback: string): Error {
  const d = data as { detail?: unknown; message?: string };
  const detail = d?.detail;
  const msg = typeof detail === 'string'
    ? detail
    : Array.isArray(detail)
      ? detail.map((x) => (typeof x === 'object' && x && 'msg' in x ? String((x as { msg: string }).msg) : String(x))).join(', ')
      : d?.message;
  return new Error(msg || fallback);
}

export function uploadUrl(path?: string | null): string {
  if (!path) return '';
  if (path.startsWith('http://') || path.startsWith('https://')) return path;
  return `${API_URL}${path.startsWith('/') ? '' : '/'}${path}`;
}

export function inrAssetRelPath(pathOrUrl: string): string {
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

/** Resolve INR QR/screenshot URL — uses API asset stream when static /uploads may be unavailable. */
export function resolveInrAssetUrl(pathOrUrl?: string | null): string {
  if (!pathOrUrl) return '';
  const rel = inrAssetRelPath(String(pathOrUrl));
  if (!rel) return uploadUrl(String(pathOrUrl));
  if (rel.startsWith('/uploads/inr/')) {
    return `${API_URL}/api/inr/asset?path=${encodeURIComponent(rel)}`;
  }
  return uploadUrl(rel);
}

export async function fetchInrDepositConfig() {
  const { data } = await apiClient.get('/api/inr/config');
  return data;
}

/** Public INR limits for landing / wallet promos (no auth). */
export async function fetchInrPublicInfo() {
  const res = await fetch(`${API_URL}/api/inr/public-info`, { cache: 'no-store' as RequestCache });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const d = data as { detail?: string };
    throw new Error(d?.detail || `Could not load INR info (HTTP ${res.status})`);
  }
  return data as { min_deposit_inr?: number };
}

export async function fetchInrRate() {
  const { data } = await apiClient.get('/api/inr/rate');
  return data;
}

export async function fetchInrPaymentMethods() {
  const { data } = await apiClient.get<{ items?: unknown[] }>('/api/inr/payment-methods');
  return (data?.items ?? []) as Record<string, unknown>[];
}

export async function fetchInrDeposits(params: { skip?: number; limit?: number } = {}) {
  const { data } = await apiClient.get('/api/inr/deposits', { params });
  return data as { items?: unknown[]; total?: number };
}

export async function startInrGatewayDeposit(body: { amount_inr: number; payment_method_id?: string | null }) {
  const { data } = await apiClient.post('/api/inr/deposits/gateway', {
    amount_inr: body.amount_inr,
    payment_method_id: body.payment_method_id || null,
  });
  return data;
}

export async function submitInrDeposit(formData: FormData) {
  try {
    const { data } = await apiClient.post('/api/inr/deposits', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    return data;
  } catch (err) {
    throw inrApiError((err as { response?: { data?: unknown } })?.response?.data, parseApiError(err).message);
  }
}

export async function fetchInrPayoutProfile() {
  const { data } = await apiClient.get('/api/inr/withdrawals/payout-profile');
  return data;
}

export async function saveInrPayoutProfile(body: Record<string, unknown>) {
  try {
    const { data } = await apiClient.put('/api/inr/withdrawals/payout-profile', body);
    return data;
  } catch (err) {
    throw inrApiError((err as { response?: { data?: unknown } })?.response?.data, parseApiError(err).message);
  }
}

export async function fetchInrWithdrawalEligibility() {
  const { data } = await apiClient.get('/api/inr/withdrawals/eligibility');
  return data;
}

export async function fetchInrWithdrawals(params: { skip?: number; limit?: number } = {}) {
  const { data } = await apiClient.get('/api/inr/withdrawals', { params });
  return data as { items?: unknown[]; total?: number };
}

export async function submitInrWithdrawal(body: Record<string, unknown>) {
  try {
    const { data } = await apiClient.post('/api/inr/withdrawals', body);
    return data;
  } catch (err) {
    throw inrApiError((err as { response?: { data?: unknown } })?.response?.data, parseApiError(err).message);
  }
}

export async function cancelInrWithdrawal(withdrawalId: string) {
  try {
    const { data } = await apiClient.delete(`/api/inr/withdrawals/${encodeURIComponent(withdrawalId)}`);
    return data;
  } catch (err) {
    throw inrApiError((err as { response?: { data?: unknown } })?.response?.data, parseApiError(err).message);
  }
}
