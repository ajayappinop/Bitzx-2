/**
 * Profile form validation — mirrors ibo-exchange/src/lib/profileValidation.js
 */
import { validateSignupMobile } from './auth.validation';

export const PROFILE_NAME_MIN = 2;
export const PROFILE_NAME_MAX = 80;
export const PROFILE_COUNTRY_MAX = 80;
export const PROFILE_BIO_MAX = 500;

/** National digits from stored E.164 (defaults to India +91). */
export function nationalFromStoredPhone(phone?: string | null, countryCode = '91'): string {
  const digits = String(phone ?? '').replace(/\D/g, '');
  const cc = String(countryCode ?? '91').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith(cc) && digits.length > cc.length) return digits.slice(cc.length);
  if (digits.length === 10) return digits;
  return digits.length > 10 ? digits.slice(-10) : digits;
}

export function validateProfileForm(fields: {
  name: string;
  mobile: string;
  country: string;
  bio: string;
}): Record<string, string> {
  const e: Record<string, string> = {};
  const n = (fields.name || '').trim();
  if (n.length < PROFILE_NAME_MIN) {
    e.name = `Display name must be at least ${PROFILE_NAME_MIN} characters.`;
  } else if (n.length > PROFILE_NAME_MAX) {
    e.name = `Display name must be ${PROFILE_NAME_MAX} characters or less.`;
  }

  const mob = String(fields.mobile ?? '').replace(/\D/g, '');
  if (!mob) {
    e.phone = 'Enter your 10-digit mobile number.';
  } else {
    const mobErr = validateSignupMobile(mob);
    if (mobErr) e.phone = mobErr;
  }

  const c = (fields.country || '').trim();
  if (c.length < 2) e.country = 'Enter your country or region (at least 2 characters).';
  else if (c.length > PROFILE_COUNTRY_MAX) {
    e.country = `Country must be ${PROFILE_COUNTRY_MAX} characters or less.`;
  }

  const b = (fields.bio || '').trim();
  if (b.length > PROFILE_BIO_MAX) {
    e.bio = `Bio must be ${PROFILE_BIO_MAX} characters or less.`;
  }

  return e;
}

export function firstProfileError(errors: Record<string, string>): string | null {
  for (const k of ['name', 'phone', 'phoneOtp', 'country', 'bio']) {
    if (errors[k]) return errors[k];
  }
  return null;
}
