export interface User {
  uid: string;
  email: string;
  name?: string;
  phone?: string;
  country?: string;
  bio?: string;
  avatar_url?: string;
  kyc_status: KYCStatus;
  kyc_tier?: number;
  is_frozen?: boolean;
  trading_paused?: boolean;
  withdrawals_paused?: boolean;
  /** From `/auth/me` — confirmed TOTP enrollment (same source as 2FA status `enabled`). */
  two_factor_enabled?: boolean;
  created_at: string;
}

export interface AuthTokens {
  access_token: string;
  refresh_token: string;
  token_type?: string;
}

export type KYCStatus =
  | 'not_started'
  | 'pending'
  | 'under_review'
  | 'approved'
  | 'rejected'
  | 're_requested';

export interface KYCInfo {
  status: KYCStatus;
  /** Server status before UI normalization (auto KYC flow). */
  rawStatus?: string;
  tier?: number;
  rejection_reason?: string;
  submitted_at?: string;
  approved_at?: string;
  personal_info?: {
    full_name?: string;
    date_of_birth?: string;
    nationality?: string;
    address?: string;
  };
  face_match_required?: boolean;
  pan_verify_required?: boolean;
  digilocker_failure_reason?: string | null;
  face_match?: { verified?: boolean; match_percentage?: number; message?: string } | null;
  pan_verify?: { verified?: boolean; message?: string } | null;
}

export interface SessionInfo {
  uid: string;
  impersonated?: boolean;
  impersonated_by?: string;
  trading_paused?: boolean;
  withdrawals_paused?: boolean;
}

export interface TwoFAStatus {
  enabled: boolean;
  /** Backend: setup started but not verified yet */
  pending_setup?: boolean;
  backup_codes_remaining?: number;
  required_for_withdrawal?: boolean;
  /** Convenience flag for UI */
  has_backup_codes?: boolean;
}

export interface TwoFASetupResult {
  secret_b32: string;
  otpauth_url: string;
  issuer: string;
}

export interface TwoFAVerifyResult {
  enabled: boolean;
  backup_codes?: string[];
}
