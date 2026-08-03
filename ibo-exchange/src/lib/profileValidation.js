/** Profile & password change — aligned with backend ProfileUpdate / PasswordChange / UserCreate. */

import {
  validateStrongPassword,
  validateAuthEmail,
  validateSignupMobile,
  AUTH_PASSWORD_MAX,
  STRONG_PASSWORD_MIN,
} from './authValidation';

export const PROFILE_NAME_MIN = 2;
export const PROFILE_NAME_MAX = 80;
export const REGISTER_NAME_MAX = 50;
export const PROFILE_PHONE_MAX = 32;
export const PROFILE_COUNTRY_MAX = 80;
export const PROFILE_BIO_MAX = 500;
export const REGISTER_PASSWORD_MIN = STRONG_PASSWORD_MIN;
export const REGISTER_PASSWORD_MAX = AUTH_PASSWORD_MAX;
export const PASSWORD_CHANGE_MIN = STRONG_PASSWORD_MIN;
export const PASSWORD_CHANGE_MAX = AUTH_PASSWORD_MAX;

/**
 * @returns {Record<string, string>}
 */
/** National digits from stored E.164 (defaults to India +91). */
export function nationalFromStoredPhone(phone, countryCode = '91') {
  const digits = String(phone ?? '').replace(/\D/g, '');
  const cc = String(countryCode ?? '91').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith(cc) && digits.length > cc.length) return digits.slice(cc.length);
  if (digits.length === 10) return digits;
  return digits.length > 10 ? digits.slice(-10) : digits;
}

export function validateProfileForm({ name, mobile, country, bio }) {
  const e = {};
  const n = (name || '').trim();
  if (n.length < PROFILE_NAME_MIN) e.name = `Display name must be at least ${PROFILE_NAME_MIN} characters.`;
  else if (n.length > PROFILE_NAME_MAX) e.name = `Display name must be ${PROFILE_NAME_MAX} characters or less.`;

  const mob = String(mobile ?? '').replace(/\D/g, '');
  if (!mob) {
    e.phone = 'Enter your 10-digit mobile number.';
  } else {
    const mobErr = validateSignupMobile(mob);
    if (mobErr) e.phone = mobErr;
  }

  const c = (country || '').trim();
  if (c.length < 2) e.country = 'Enter your country or region (at least 2 characters).';
  else if (c.length > PROFILE_COUNTRY_MAX) e.country = `Country must be ${PROFILE_COUNTRY_MAX} characters or less.`;

  const b = (bio || '').trim();
  if (b.length > PROFILE_BIO_MAX) e.bio = `Bio must be ${PROFILE_BIO_MAX} characters or less.`;

  return e;
}

export function firstProfileError(errors) {
  for (const k of ['name', 'phone', 'phoneOtp', 'country', 'bio']) {
    if (errors[k]) return errors[k];
  }
  return null;
}

/**
 * @returns {Record<string, string>} per-field errors for inline UI
 */
export function validatePasswordChangeFields({ current_password, new_password, confirm }) {
  const e = {};
  const cur = current_password || '';
  const nw = new_password || '';
  const cf = confirm || '';
  if (!cur.trim()) e.current_password = 'Enter your current password.';
  const strong = validateStrongPassword(nw);
  if (strong) e.new_password = strong;
  else if (nw && nw === cur && cur.trim()) {
    e.new_password = 'New password must be different from your current password.';
  }
  if (nw && String(cf).trim() === '') e.confirm = 'Confirm your new password.';
  else if (String(cf).trim() && nw !== cf) e.confirm = 'New passwords do not match.';
  return e;
}

export function firstPasswordChangeFieldError(errors) {
  for (const k of ['current_password', 'new_password', 'confirm']) {
    if (errors[k]) return errors[k];
  }
  return null;
}

/**
 * @returns {string|null} error message or null if ok
 */
export function validatePasswordChange(fields) {
  return firstPasswordChangeFieldError(validatePasswordChangeFields(fields));
}

/**
 * @param {string} name
 * @returns {string|null}
 */
export function validateRegisterName(name) {
  const n = (name || '').trim();
  if (n.length < PROFILE_NAME_MIN) return `Name must be at least ${PROFILE_NAME_MIN} characters.`;
  if (n.length > REGISTER_NAME_MAX) return `Name must be ${REGISTER_NAME_MAX} characters or less.`;
  return null;
}

/**
 * @returns {string|null}
 */
export function validateRegisterConfirm(password, confirm) {
  const cf = confirm ?? '';
  const pw = password ?? '';
  if (!String(cf).trim() && !String(pw).trim()) return null;
  if (!String(cf).trim()) return 'Confirm your password.';
  if (cf !== pw) return 'Passwords do not match.';
  return null;
}

/**
 * Registration name / email / password (UserCreate).
 */
export function validateRegisterFields({ name, email, password }) {
  const e = {};
  const nameErr = validateRegisterName(name);
  if (nameErr) e.name = nameErr;

  const emailErr = validateAuthEmail(email ?? '');
  if (emailErr) e.email = emailErr;

  const pwMsg = validateStrongPassword(password ?? '');
  if (pwMsg) e.password = pwMsg;
  return e;
}

export function firstRegisterError(errors) {
  for (const k of ['name', 'email', 'password']) {
    if (errors[k]) return errors[k];
  }
  return null;
}
