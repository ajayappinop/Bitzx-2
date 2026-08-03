import { useEffect, useState } from 'react';
import { exchangeApiOrigin } from '@/lib/apiBase';

const API = exchangeApiOrigin(import.meta.env.VITE_BACKEND_URL);

const DEFAULT_CONFIG = {
  loaded: false,
  emailOtpEnabled: true,
  smsOtpEnabled: true,
  smsAvailable: false,
  defaultCountryCode: '91',
};

/** Reads /api/public/site-config signup OTP flags for register/profile UI. */
export function useSignupOtpConfig() {
  const [config, setConfig] = useState(DEFAULT_CONFIG);

  useEffect(() => {
    let cancelled = false;
    fetch(`${API}/api/public/site-config`)
      .then((r) => r.json())
      .then((cfg) => {
        if (cancelled) return;
        const signup = cfg?.signup ?? {};
        setConfig({
          loaded: true,
          emailOtpEnabled: signup.email_otp_enabled !== false,
          smsOtpEnabled: signup.sms_otp_enabled !== false,
          smsAvailable: signup.sms_available === true,
          defaultCountryCode: String(signup.default_country_code || '91').replace(/\D/g, '') || '91',
        });
      })
      .catch(() => {
        if (!cancelled) setConfig((prev) => ({ ...prev, loaded: true }));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return config;
}

export function isInactiveOtpMessage(message) {
  return /inactive|proceed directly|not required|currently unavailable|verify later/i.test(message || '');
}
