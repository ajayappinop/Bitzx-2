import { useEffect, useState } from 'react';
import apiClient from '../api/client';
import { EP } from '../api/endpoints';

export type SignupOtpConfig = {
  loaded: boolean;
  emailOtpEnabled: boolean;
  smsOtpEnabled: boolean;
  smsAvailable: boolean;
  defaultCountryCode: string;
};

type SiteConfigSignup = {
  default_country_code?: string;
  email_otp_enabled?: boolean;
  sms_otp_enabled?: boolean;
  sms_available?: boolean;
};

const DEFAULT_CONFIG: SignupOtpConfig = {
  loaded: false,
  emailOtpEnabled: true,
  smsOtpEnabled: true,
  smsAvailable: false,
  defaultCountryCode: '91',
};

export function useSignupOtpConfig(): SignupOtpConfig {
  const [config, setConfig] = useState<SignupOtpConfig>(DEFAULT_CONFIG);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await apiClient.get<{ signup?: SiteConfigSignup }>(EP.PUBLIC_SITE_CONFIG);
        if (cancelled) return;
        const signup = res.data?.signup ?? {};
        setConfig({
          loaded: true,
          emailOtpEnabled: signup.email_otp_enabled !== false,
          smsOtpEnabled: signup.sms_otp_enabled !== false,
          smsAvailable: signup.sms_available === true,
          defaultCountryCode: String(signup.default_country_code || '91').replace(/\D/g, '') || '91',
        });
      } catch {
        if (!cancelled) {
          setConfig(prev => ({ ...prev, loaded: true }));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return config;
}

/** Backend message when admin disabled an OTP channel without sending a code. */
export function isInactiveOtpMessage(message?: string): boolean {
  return /inactive|proceed directly|not required|currently unavailable|verify later/i.test(message || '');
}
