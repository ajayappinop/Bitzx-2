/**
 * Client-side KYC rules aligned with backend `server.py`:
 * - `_kyc_trading_gate` / `_kyc_wallet_gate`: only `kyc_status === "approved"` allows trading and deposits/withdrawals.
 * - API `/kyc/status` returns `unverified` | `pending` | `approved` | `rejected` (draft → unverified on server).
 *
 * This module only normalizes strings for UI — it does not change backend behaviour.
 */
import type { KYCInfo, KYCStatus, User } from '../types/auth.types';
import type { KycStatusResponse } from '../types/kyc.types';

/** Map API / user-document statuses into the app `KYCStatus` union. */
export function normalizeKycStatus(raw: string | undefined | null): KYCStatus {
  const s = String(raw ?? '').toLowerCase().trim();
  if (s === 'unverified' || s === 'draft' || s === '' || s === 'none') return 'not_started';
  if (s === 'approved') return 'approved';
  if (s === 'pending') return 'pending';
  if (s === 'rejected') return 'rejected';
  if (s === 'under_review' || s === 'in_review') return 'under_review';
  if (s === 're_requested') return 're_requested';
  if (
    s === 'digilocker_pending' ||
    s === 'digilocker_failed' ||
    s === 'awaiting_pan' ||
    s === 'pan_verify_failed' ||
    s === 'awaiting_selfie' ||
    s === 'face_match_failed'
  ) {
    return 'not_started';
  }
  return 'not_started';
}

const CONFUSING_FACE_MATCH_MESSAGE =
  /negative\s+result|completed with negative|verification completed|no match found/i;

/** Plain-language face-match copy (Signzy often returns confusing "negative results" wording). */
export function humanizeFaceMatchMessage(
  message: string | undefined | null,
  opts?: { verified?: boolean; matchPercentage?: number | null },
): string {
  const raw = String(message ?? '').trim();
  const verified = Boolean(opts?.verified);
  const pct = opts?.matchPercentage;
  const pctHint =
    pct != null && Number.isFinite(Number(pct)) ? ` (${Math.round(Number(pct))}% match)` : '';
  const confusing = !raw || CONFUSING_FACE_MATCH_MESSAGE.test(raw);

  if (verified) {
    return confusing ? 'Face match passed' : raw;
  }
  if (confusing) {
    return `Face verification failed${pctHint}. Please retake your selfie in good lighting with your full face visible.`;
  }
  return raw;
}

/** True when user is mid auto-KYC (DigiLocker / PAN / selfie). */
export function isAutoKycInProgress(raw: string | undefined | null): boolean {
  const s = String(raw ?? '').toLowerCase();
  return [
    'digilocker_pending',
    'digilocker_failed',
    'awaiting_pan',
    'pan_verify_failed',
    'awaiting_selfie',
    'face_match_failed',
  ].includes(s);
}

/** Parse `tier_0` / `tier_1` / numeric tier from API into a small integer for UI. */
export function parseKycTier(raw: unknown): number | undefined {
  if (raw == null || raw === '') return undefined;
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  const s = String(raw).toLowerCase().trim();
  const m = /^tier_(\d+)$/.exec(s);
  if (m) return parseInt(m[1], 10);
  const n = parseInt(s, 10);
  return Number.isFinite(n) ? n : undefined;
}

/** Prefer enriched `kyc` payload, then `user.kyc_status` (e.g. right after login before KYC fetch). */
export function effectiveKycStatus(kyc: KYCInfo | null, user: User | null): KYCStatus {
  const raw = kyc?.status ?? user?.kyc_status;
  return normalizeKycStatus(raw as string);
}

export function isKycApproved(status: KYCStatus): boolean {
  return status === 'approved';
}

/** In-review states: trading/wallet stay blocked (same as backend `pending` messaging). */
export function isKycPendingReview(status: KYCStatus): boolean {
  return status === 'pending' || status === 'under_review';
}

/** Block order / withdraw actions unless approved (mirrors `_kyc_trading_gate`). */
export function isKycTradingBlocked(status: KYCStatus): boolean {
  return !isKycApproved(status);
}

/** Block deposit/withdraw UX the same way as `_kyc_wallet_gate` (approved only). */
export function isKycWalletBlocked(status: KYCStatus): boolean {
  return !isKycApproved(status);
}

/** Profile stack screen for KYC (status vs start wizard). */
export function kycProfileScreen(status: KYCStatus): 'KYCStatus' | 'KYCWizard' {
  return isKycPendingReview(status) ? 'KYCStatus' : 'KYCWizard';
}

/** Primary trade submit label when KYC may block trading. */
export function kycTradeSubmitLabel(
  status: KYCStatus,
  approvedLabel: string,
): string {
  if (isKycApproved(status)) return approvedLabel;
  if (isKycPendingReview(status)) return 'KYC Pending';
  return 'Get Verified';
}

/**
 * Normalize `/kyc/status` JSON into `KYCInfo` for Redux.
 * Maps `reviewed_at` → `approved_at` when status is approved (mobile type has no `reviewed_at`).
 */
export function normalizeKycPayload(api: unknown): KYCInfo | null {
  if (!api || typeof api !== 'object') return null;
  const o = api as KycStatusResponse & Record<string, unknown>;
  const rawStatus = String(o.status ?? '');
  const status = normalizeKycStatus(rawStatus);
  const tier = parseKycTier(o.kyc_tier ?? o.tier);
  const reviewed_at = typeof o.reviewed_at === 'string' ? o.reviewed_at : undefined;
  const personal = o.personal_info && typeof o.personal_info === 'object'
    ? (o.personal_info as KYCInfo['personal_info'])
    : undefined;
  return {
    status,
    rawStatus,
    tier,
    rejection_reason: typeof o.rejection_reason === 'string' ? o.rejection_reason : undefined,
    submitted_at: typeof o.submitted_at === 'string' ? o.submitted_at : undefined,
    approved_at: status === 'approved' ? reviewed_at : undefined,
    personal_info: personal,
    face_match_required: Boolean(o.face_match_required),
    pan_verify_required: Boolean(o.pan_verify_required),
    digilocker_failure_reason:
      typeof o.digilocker_failure_reason === 'string' ? o.digilocker_failure_reason : null,
    face_match: (o.face_match as KYCInfo['face_match']) ?? null,
    pan_verify: (o.pan_verify as KYCInfo['pan_verify']) ?? null,
  };
}
