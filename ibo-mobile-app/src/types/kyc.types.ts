/**
 * KYC API response types aligned with backend `/api/kyc/` endpoints.
 */
export interface KycStatusResponse {
  status: string;
  rawStatus?: string;
  kyc_tier?: number | string;
  tier?: number | string;
  rejection_reason?: string;
  submitted_at?: string;
  reviewed_at?: string;
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

export interface KycModeResponse {
  kyc_mode: 'manual' | 'auto' | string;
}

export interface KycInitDigilockerResponse {
  request_id: string;
  /** Backend field (Signzy authorization URL). */
  url?: string;
  /** Legacy/alternate field name used in some clients. */
  redirect_url?: string;
}

/** Pick the DigiLocker authorization URL from init API JSON. */
export function resolveDigilockerInitUrl(data: KycInitDigilockerResponse): string {
  return String(data.url ?? data.redirect_url ?? '').trim();
}

export interface KycPanVerifyResponse {
  ok: boolean;
  verified?: boolean;
  message?: string;
}

export interface KycFaceMatchResponse {
  ok: boolean;
  verified?: boolean;
  match_percentage?: number;
  message?: string;
}

export interface KycUploadResponse {
  ok: boolean;
  document_front_url?: string | null;
  document_back_url?: string | null;
  selfie_url?: string | null;
}
