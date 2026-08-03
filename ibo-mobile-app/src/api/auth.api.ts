import apiClient from './client';
import { EP } from './endpoints';
import { AuthTokens, User, KYCInfo, TwoFAStatus, TwoFASetupResult, TwoFAVerifyResult } from '../types/auth.types';

export interface LoginPayload {
  email: string;
  password: string;
  totp_code?: string;
}

export interface RegisterEmailOtpPayload {
  email: string;
  mobile?: string;
  country_code?: string;
  referral_code?: string;
}

export interface RegisterMobileOtpPayload {
  mobile: string;
  email?: string;
  country_code?: string;
}

export interface RegisterCompletePayload {
  name: string;
  email: string;
  password: string;
  mobile?: string;
  country_code?: string;
  referral_code?: string;
}

export interface RegisterRequestResponse {
  message: string;
  email_hint?: string;
  phone_hint?: string;
  verify_channel?: string;
}

export interface RegisterVerifyStepResponse {
  ok?: boolean;
  message: string;
  next_step?: string;
}

export interface RegisterPayload {
  email: string;
  password: string;
  name?: string;
  referral_code?: string;
  verification_code: string;
}

export interface UpdateProfilePayload {
  name?: string;
  mobile?: string;
  country_code?: string;
  phone_otp?: string;
  country?: string;
  bio?: string;
}

export interface ProfilePhoneOtpPayload {
  mobile: string;
  country_code?: string;
}

export interface ProfilePhoneOtpResponse {
  message: string;
  phone_hint?: string;
  otp_required?: boolean;
}

export interface LoginResponse extends AuthTokens {
  user: User;
  require_2fa?: boolean;
}

export const authApi = {
  requestRegisterEmailOtp: (payload: RegisterEmailOtpPayload) => {
    const body: Record<string, string> = {
      email: payload.email.trim().toLowerCase(),
    };
    const mob = (payload.mobile || '').replace(/\D/g, '');
    if (mob) body.mobile = mob;
    const cc = (payload.country_code || '').replace(/\D/g, '');
    if (cc) body.country_code = cc;
    const ref = (payload.referral_code || '').trim();
    if (ref) body.referral_code = ref;
    return apiClient.post<RegisterRequestResponse>(EP.AUTH_REGISTER_REQUEST, body);
  },

  sendRegisterMobileOtp: (payload: RegisterMobileOtpPayload) => {
    const body: Record<string, string> = {
      mobile: payload.mobile.replace(/\D/g, ''),
    };
    const em = (payload.email || '').trim().toLowerCase();
    if (em) body.email = em;
    const cc = (payload.country_code || '').replace(/\D/g, '');
    if (cc) body.country_code = cc;
    return apiClient.post<RegisterRequestResponse>(EP.AUTH_REGISTER_MOBILE_SEND_OTP, body);
  },

  verifyRegisterEmail: (email: string, code: string) =>
    apiClient.post<RegisterVerifyStepResponse>(EP.AUTH_REGISTER_VERIFY_EMAIL, {
      email: email.trim().toLowerCase(),
      code: code.trim(),
    }),

  verifyRegisterMobile: (payload: RegisterMobileOtpPayload & { code: string }) => {
    const body: Record<string, string> = {
      mobile: payload.mobile.replace(/\D/g, ''),
      code: payload.code.trim(),
    };
    const em = (payload.email || '').trim().toLowerCase();
    if (em) body.email = em;
    const cc = (payload.country_code || '').replace(/\D/g, '');
    if (cc) body.country_code = cc;
    return apiClient.post<RegisterVerifyStepResponse>(EP.AUTH_REGISTER_VERIFY_MOBILE, body);
  },

  completeRegister: (payload: RegisterCompletePayload) => {
    const body: Record<string, string> = {
      name: payload.name.trim(),
      email: payload.email.trim().toLowerCase(),
      password: payload.password,
    };
    const mob = (payload.mobile || '').replace(/\D/g, '');
    if (mob) body.mobile = mob;
    const cc = (payload.country_code || '').replace(/\D/g, '');
    if (cc) body.country_code = cc;
    const ref = (payload.referral_code || '').trim();
    if (ref) body.referral_code = ref;
    return apiClient.post<LoginResponse>(EP.AUTH_REGISTER_COMPLETE, body);
  },

  resendRegisterOtp: (email: string, channel: 'email' | 'sms') =>
    apiClient.post<RegisterRequestResponse>(EP.AUTH_REGISTER_RESEND, {
      email: email.trim().toLowerCase(),
      channel,
    }),

  verifyRegisterOtp: (email: string, code: string) =>
    apiClient.post<LoginResponse>(EP.AUTH_REGISTER_VERIFY, {
      email: email.trim().toLowerCase(),
      code: code.trim(),
    }),

  register: (payload: RegisterPayload) =>
    apiClient.post<LoginResponse>(EP.AUTH_REGISTER, payload),

  login: (payload: LoginPayload) =>
    apiClient.post<LoginResponse>(EP.AUTH_LOGIN, payload),

  refresh: (refreshToken: string) =>
    apiClient.post<AuthTokens>(EP.AUTH_REFRESH, { refresh_token: refreshToken }),

  logout: (refreshToken?: string) =>
    apiClient.post<{ ok: boolean }>(EP.AUTH_LOGOUT, { refresh_token: refreshToken }),

  me: () => apiClient.get<User>(EP.AUTH_ME),

  session: () => apiClient.get(EP.AUTH_SESSION),

  revokeAllSessions: () =>
    apiClient.post<{ ok: boolean }>(EP.AUTH_SESSIONS_REVOKE_ALL),

  forgotPassword: (email: string) =>
    apiClient.post<{ ok: boolean }>(EP.AUTH_FORGOT_PASSWORD, { email }),

  resetPassword: (token: string, password: string) =>
    apiClient.post<{ ok: boolean }>(EP.AUTH_RESET_PASSWORD, { token, password }),

  sendProfilePhoneOtp: (payload: ProfilePhoneOtpPayload) => {
    const body: Record<string, string> = {
      mobile: payload.mobile.replace(/\D/g, ''),
    };
    const cc = (payload.country_code || '').replace(/\D/g, '');
    if (cc) body.country_code = cc;
    return apiClient.post<ProfilePhoneOtpResponse>(EP.AUTH_PROFILE_PHONE_SEND_OTP, body);
  },

  updateProfile: (data: UpdateProfilePayload) =>
    apiClient.put<User>(EP.AUTH_PROFILE, data),

  uploadAvatar: (formData: FormData) =>
    apiClient.post<User>(EP.AUTH_PROFILE_AVATAR, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }),

  deleteAvatar: () => apiClient.delete<User>(EP.AUTH_PROFILE_AVATAR),

  changePassword: (current_password: string, new_password: string) =>
    apiClient.put<{ ok: boolean }>(EP.AUTH_PASSWORD, { current_password, new_password }),

  get2FAStatus: async () => {
    const res = await apiClient.get<Record<string, unknown>>(EP.AUTH_2FA_STATUS);
    const raw = res.data ?? {};
    const remaining = Number(raw.backup_codes_remaining ?? 0);
    const data: TwoFAStatus = {
      enabled: Boolean(raw.enabled),
      pending_setup: Boolean(raw.pending_setup),
      backup_codes_remaining: Number.isFinite(remaining) ? remaining : 0,
      required_for_withdrawal: Boolean(raw.required_for_withdrawal),
      has_backup_codes: remaining > 0,
    };
    return { ...res, data };
  },

  setup2FA: async () => {
    const res = await apiClient.post<Record<string, unknown>>(EP.AUTH_2FA_SETUP);
    const raw = res.data ?? {};
    const data: TwoFASetupResult = {
      secret_b32: String(raw.secret_b32 ?? raw.secret ?? ''),
      otpauth_url: String(raw.otpauth_url ?? raw.qr_uri ?? ''),
      issuer: String(raw.issuer ?? 'IBO'),
    };
    return { ...res, data };
  },

  verify2FA: async (code: string) => {
    const res = await apiClient.post<Record<string, unknown>>(EP.AUTH_2FA_VERIFY, { code });
    const raw = res.data ?? {};
    const data: TwoFAVerifyResult = {
      enabled: Boolean(raw.enabled ?? true),
      backup_codes: Array.isArray(raw.backup_codes) ? (raw.backup_codes as string[]) : undefined,
    };
    return { ...res, data };
  },

  disable2FA: (payload: { password: string; code: string }) =>
    apiClient.post<{ ok: boolean; enabled?: boolean }>(EP.AUTH_2FA_DISABLE, payload),

  getKycStatus: () => apiClient.get<KYCInfo>(EP.KYC_STATUS),
};
