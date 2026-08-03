/**
 * Shared auth validation (login, register) — keep in sync with backend password policy.
 */

export const AUTH_EMAIL_MAX = 254;
export const AUTH_PASSWORD_MAX = 128;
export const STRONG_PASSWORD_MIN = 8;
export const SIGNUP_MOBILE_NATIONAL_LEN = 10;

/** India national mobile: 10 digits starting with 6–9. */
const INDIAN_MOBILE_RE = /^[6-9]\d{9}$/;

/** RFC 5322–style practical check (same pattern as prior login/register pages). */
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * @param {unknown} detail — FastAPI `detail` string | object | validation error array
 * @returns {string}
 */
export function formatApiDetail(detail) {
  if (detail == null || detail === '') return 'Request failed';
  if (typeof detail === 'string') return detail;
  if (Array.isArray(detail)) {
    const parts = detail.map(err => {
      if (err && typeof err === 'object' && err.msg != null) return String(err.msg);
      return String(err);
    });
    return parts.filter(Boolean).join(' ') || 'Validation failed';
  }
  if (typeof detail === 'object' && detail.msg != null) return String(detail.msg);
  return String(detail);
}

/** FastAPI / Pydantic 422 `loc` segments we map to form fields. */
const FASTAPI_BODY_FIELD = new Set([
  'email', 'password', 'name', 'code',
  'current_password', 'new_password', 'token',
]);

/** Map API / alternate keys → register form keys */
const FIELD_ALIAS_TO_FORM = {
  username: 'name',
  display_name: 'name',
  full_name: 'name',
  fullName: 'name',
  displayName: 'name',
  emailAddress: 'email',
  email_address: 'email',
  pass: 'password',
  pwd: 'password',
};

/**
 * Parse 422 `detail` array into { [fieldName]: message } for inline errors.
 * Pydantic/FastAPI may use `loc` like ["body","name"] or ["body","UserCreate","email"] — walk the path.
 * @param {unknown} detail
 * @returns {Record<string, string>}
 */
export function parseFastApi422FieldErrors(detail) {
  const out = {};
  if (!Array.isArray(detail)) return out;

  for (const item of detail) {
    if (!item || typeof item !== 'object') continue;
    const loc = item.loc;
    if (!Array.isArray(loc)) continue;

    const bodyIdx = loc.indexOf('body');
    const segments = bodyIdx >= 0 ? loc.slice(bodyIdx + 1) : loc;

    let key = '';
    for (let i = segments.length - 1; i >= 0; i--) {
      const seg = segments[i];
      if (typeof seg !== 'string') continue;
      if (FASTAPI_BODY_FIELD.has(seg)) {
        key = seg;
        break;
      }
    }
    if (!key) {
      for (let i = segments.length - 1; i >= 0; i--) {
        const seg = segments[i];
        if (typeof seg !== 'string') continue;
        if (/^[a-z][a-z0-9_]*$/i.test(seg) && !['body', 'query', 'path', 'header', 'cookie'].includes(seg)) {
          const mapped = FIELD_ALIAS_TO_FORM[seg] || (FASTAPI_BODY_FIELD.has(seg) ? seg : '');
          if (mapped) {
            key = mapped;
            break;
          }
        }
      }
    }

    if (!key || !FASTAPI_BODY_FIELD.has(key)) continue;

    let msg = item.msg != null ? String(item.msg) : 'Invalid value';
    msg = msg.replace(/^Value error,\s*/i, '').trim();
    if (!out[key]) out[key] = msg;
    else out[key] = `${out[key]} · ${msg}`;
  }
  return out;
}

/**
 * @param {Record<string, string>} fieldErrors
 * @param {string} fallback — joined API message when no field map
 */
export function authFormBannerMessage(fieldErrors, fallback) {
  if (fieldErrors && Object.keys(fieldErrors).length > 0) {
    return 'Please fix the highlighted fields.';
  }
  return fallback || 'Request failed';
}

/** Thrown from AuthContext on failed login/register so pages can show field + banner errors. */
export class AuthRequestError extends Error {
  /**
   * @param {string} message
   * @param {{ fieldErrors?: Record<string, string> | null, status?: number }} [opts]
   */
  constructor(message, opts = {}) {
    super(message);
    this.name = 'AuthRequestError';
    this.fieldErrors = opts.fieldErrors ?? null;
    this.status = opts.status;
  }
}

export function isAuthRequestError(e) {
  return e instanceof AuthRequestError;
}

/**
 * @param {string} raw
 * @returns {string|null} error message or null
 */
export function validateAuthEmail(raw) {
  const em = (raw || '').trim();
  if (!em) return 'Email is required.';
  if (em.length > AUTH_EMAIL_MAX) return 'Email is too long.';
  if (!EMAIL_RE.test(em)) return 'Enter a valid email address.';
  return null;
}

/**
 * Strip formatting and optional +91 country prefix to national digits.
 * @param {string} raw
 * @returns {string}
 */
export function normalizeSignupMobileDigits(raw) {
  let digits = String(raw ?? '').replace(/\D/g, '');
  if (digits.length === 12 && digits.startsWith('91')) digits = digits.slice(2);
  else if (digits.length > SIGNUP_MOBILE_NATIONAL_LEN && digits.startsWith('91')) {
    digits = digits.slice(2);
  }
  return digits;
}

/**
 * Signup / profile mobile — 10-digit India national number (6–9 prefix).
 * @param {string} raw
 * @returns {string|null} error message or null if valid
 */
export function validateSignupMobile(raw) {
  const nat = normalizeSignupMobileDigits(raw);
  if (!nat) return 'Mobile number is required.';
  if (nat.length !== SIGNUP_MOBILE_NATIONAL_LEN) {
    return 'Enter a valid 10-digit mobile number.';
  }
  if (!INDIAN_MOBILE_RE.test(nat)) {
    return 'Mobile number must start with 6, 7, 8, or 9.';
  }
  return null;
}

/**
 * Login: only sanity checks (no strength — existing accounts may have legacy passwords until they rotate).
 * @param {string} raw
 * @returns {string|null}
 */
export function validateAuthPasswordLogin(raw) {
  const pw = raw ?? '';
  if (!pw) return 'Password is required.';
  if (pw.length > AUTH_PASSWORD_MAX) {
    return `Password must be ${AUTH_PASSWORD_MAX} characters or less.`;
  }
  return null;
}

/**
 * Registration / password change — must match backend `validate_strong_user_password_value`.
 * Temporary: AUTH_SIMPLE accepts any non-empty password (matches backend AUTH_RELAXED default).
 * @param {string} raw
 * @returns {string|null} first failing rule, or null if valid
 */
export function validateStrongPassword(raw) {
  const pw = raw ?? '';
  if (!pw) return 'Password is required.';
  if (pw.length > AUTH_PASSWORD_MAX) {
    return `Password must be ${AUTH_PASSWORD_MAX} characters or less.`;
  }
  // Temporary simple mode — skip complexity rules
  if (import.meta.env.VITE_AUTH_RELAXED !== '0' && import.meta.env.VITE_AUTH_RELAXED !== 'false') {
    return null;
  }
  if (pw.length < STRONG_PASSWORD_MIN) {
    return `Password must be at least ${STRONG_PASSWORD_MIN} characters.`;
  }
  if (!/[a-z]/.test(pw)) return 'Password must include at least one lowercase letter.';
  if (!/[A-Z]/.test(pw)) return 'Password must include at least one uppercase letter.';
  if (!/\d/.test(pw)) return 'Password must include at least one number.';
  if (!/[^A-Za-z0-9]/.test(pw)) {
    return 'Password must include at least one special character (e.g. !@#$%).';
  }
  return null;
}

/**
 * @param {string} password
 * @returns {{ score: number, label: string, color: string }} score 0–4 for UI meters
 */
export function getPasswordStrengthMeta(password) {
  const pw = password ?? '';
  if (!pw) return { score: 0, label: '', color: 'rgba(255,255,255,0.35)' };
  let score = 0;
  if (pw.length >= STRONG_PASSWORD_MIN) score += 1;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) score += 1;
  if (/\d/.test(pw)) score += 1;
  if (/[^A-Za-z0-9]/.test(pw)) score += 1;
  if (pw.length >= 12) score += 1;
  const capped = Math.min(score, 4);
  const labels = ['', 'Weak', 'Fair', 'Good', 'Strong'];
  const colors = ['', '#ef4444', '#0EA4AB', '#60a5fa', '#22c55e'];
  return { score: capped, label: labels[capped] || '', color: colors[capped] || '#ffffff' };
}
