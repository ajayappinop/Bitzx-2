/**
 * Storage keys — exact same strings used in the web exchange
 * (ibo_ex_token, ibo_ex_refresh, ibo_ex_user in AuthContext.jsx)
 */
export const STORAGE_KEYS = {
  TOKEN: 'ibo_ex_token',
  REFRESH: 'ibo_ex_refresh',
  USER: 'ibo_ex_user',
  BIOMETRIC_ENABLED: 'ibo_biometric_enabled',
  THEME: 'ibo_theme',
  DIGILOCKER_REQUEST_ID: 'ibo_digilocker_request_id',
  REFERRAL_CODE: 'ibo_ex_referral_code',
} as const;

export type StorageKey = (typeof STORAGE_KEYS)[keyof typeof STORAGE_KEYS];
