/** KYC form rules (client-side; backend may still reject). */

import { isKnownCountryName } from '@/data/kycLocations';

export const DOC_TYPE_VALUES = ['passport', 'national_id', 'driving_license'];
export const MAX_KYC_FILE_BYTES = 15 * 1024 * 1024;
export const MAX_KYC_NOTES_LEN = 2000;
/** Catalog max postal length when client and API are aligned (see backend `KYCPersonalInfo.postal_code`). */
export const KYC_POSTAL_CATALOG_MAX = 16;
export const MIN_POSTAL_CODE_LEN = 2;

/** @deprecated use KYC_POSTAL_CATALOG_MAX — kept for imports */
export const MAX_POSTAL_CODE_LEN = KYC_POSTAL_CATALOG_MAX;

function readEnvPostalMaxLen() {
  try {
    const raw = import.meta.env?.VITE_KYC_POSTAL_CODE_MAX;
    if (raw == null || String(raw).trim() === '') return null;
    const n = parseInt(String(raw), 10);
    if (!Number.isFinite(n) || n < MIN_POSTAL_CODE_LEN || n > 32) return null;
    return n;
  } catch {
    return null;
  }
}

/** Optional override when your API enforces a lower max than the catalog (until you redeploy backend). */
export const ENV_POSTAL_MAX_LEN = readEnvPostalMaxLen();

/** Pydantic v2: "String should have at most N characters" */
export function extractPydanticMaxStringLen(message) {
  const m = /at most (\d+) character/i.exec(String(message || ''));
  if (!m) return null;
  const n = parseInt(m[1], 10);
  return Number.isFinite(n) ? n : null;
}

const KYC_FILE_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
]);

const PERSONAL_FIELD_ORDER = [
  'full_name',
  'date_of_birth',
  'nationality',
  'address',
  'city',
  'country',
  'postal_code',
];
const DOC_FIELD_ORDER = [
  'document_type',
  'document_number',
  'document_expiry',
  'document_front',
  'document_back',
];

/** Letters, spaces, apostrophe, hyphen, period (Unicode letters). */
const NAME_LIKE_RE = /^[\p{L}][\p{L}\s'.-]*$/u;
/** City: allow digits (e.g. "St. Louis 2"). */
const CITY_RE = /^[\p{L}\d][\p{L}\d\s'.-]*$/u;
const ADDRESS_LINE_RE = /[\p{L}\d]/u;
const DOC_NUM_RE = /^[A-Z0-9][A-Z0-9\s.-]*$/i;
/** Letters, digits, space, hyphen (international post codes). */
const POSTAL_RE = /^[A-Z0-9][A-Z0-9\s-]*$/i;

function wordCount(name) {
  return String(name || '')
    .trim()
    .split(/\s+/)
    .filter((w) => w.length > 0).length;
}

/**
 * @param {object} p
 * @param {{ postalMaxLen?: number }} [opts] — defaults to catalog max; use a lower value when API is stricter.
 * @returns {Record<string, string>} field key → error message
 */
export function validateKycPersonal(p, opts = {}) {
  const postalMaxLen = Math.min(
    KYC_POSTAL_CATALOG_MAX,
    Math.max(
      MIN_POSTAL_CODE_LEN,
      opts.postalMaxLen ?? ENV_POSTAL_MAX_LEN ?? KYC_POSTAL_CATALOG_MAX,
    ),
  );
  const e = {};
  const name = (p.full_name || '').trim();
  if (name.length < 3) e.full_name = 'Enter your full legal name (at least 3 characters).';
  else if (name.length > 200) e.full_name = 'Name is too long (max 200 characters).';
  else if (!NAME_LIKE_RE.test(name)) {
    e.full_name = 'Use letters only (spaces, apostrophes, and hyphens allowed).';
  } else if (wordCount(name) < 2) {
    e.full_name = 'Enter your first and last name as on your ID.';
  }

  const dobStr = (p.date_of_birth || '').trim();
  if (!dobStr) e.date_of_birth = 'Date of birth is required.';
  else {
    const dob = new Date(`${dobStr}T12:00:00`);
    if (Number.isNaN(dob.getTime())) e.date_of_birth = 'Invalid date.';
    else {
      const today = new Date();
      today.setHours(23, 59, 59, 999);
      if (dob > today) e.date_of_birth = 'Date of birth cannot be in the future.';
      let age = today.getFullYear() - dob.getFullYear();
      const md = today.getMonth() - dob.getMonth();
      if (md < 0 || (md === 0 && today.getDate() < dob.getDate())) age -= 1;
      if (age < 18) e.date_of_birth = 'You must be at least 18 years old.';
      if (age > 110) e.date_of_birth = 'Please enter a valid date of birth.';
    }
  }

  const nat = (p.nationality || '').trim();
  if (nat.length < 2) e.nationality = 'Enter your nationality (e.g. Indian, British).';
  else if (nat.length > 80) e.nationality = 'Nationality is too long.';
  else if (!NAME_LIKE_RE.test(nat)) {
    e.nationality = 'Use letters only (spaces allowed).';
  }

  const addr = (p.address || '').trim();
  if (addr.length < 12) e.address = 'Enter a complete street address (building, street, area — at least 12 characters).';
  else if (addr.length > 500) e.address = 'Address is too long (max 500 characters).';
  else if (!ADDRESS_LINE_RE.test(addr)) {
    e.address = 'Address must include letters or numbers.';
  }

  const city = (p.city || '').trim();
  if (city.length < 2) e.city = 'Enter your city.';
  else if (city.length > 100) e.city = 'City name is too long.';
  else if (!CITY_RE.test(city)) {
    e.city = 'Use letters and numbers for the city name.';
  }

  const country = (p.country || '').trim();
  if (country.length < 2) e.country = 'Enter or select your country.';
  else if (country.length > 100) e.country = 'Country name is too long.';
  else if (!NAME_LIKE_RE.test(country)) {
    e.country = 'Use letters for the country name.';
  } else if (!isKnownCountryName(country)) {
    e.country = 'Choose a country from the suggestions, or check the spelling.';
  }

  const zip = (p.postal_code || '').trim();
  if (zip.length < MIN_POSTAL_CODE_LEN) {
    e.postal_code = `Postal or ZIP code is required (at least ${MIN_POSTAL_CODE_LEN} characters).`;
  } else if (zip.length > postalMaxLen) {
    e.postal_code = `Postal code must be at most ${postalMaxLen} characters.`;
  } else if (!POSTAL_RE.test(zip)) {
    e.postal_code = 'Use letters, numbers, spaces, or hyphens only (no other symbols).';
  }

  return e;
}

/**
 * @param {object} doc — document_type, document_number, document_expiry
 * @param {{ hasFrontUpload: boolean }} opts
 */
export function validateKycDocument(doc, { hasFrontUpload }) {
  const e = {};
  const dt = doc.document_type;
  if (!dt || !DOC_TYPE_VALUES.includes(dt)) {
    e.document_type = 'Select a document type.';
  }

  const num = (doc.document_number || '').trim();
  if (num.length < 4) {
    e.document_number = 'Enter the full document number as printed (at least 4 characters).';
  } else if (num.length > 80) e.document_number = 'Document number is too long.';
  else if (!DOC_NUM_RE.test(num)) {
    e.document_number = 'Use letters, numbers, spaces, dots, or hyphens only.';
  }

  const expStr = (doc.document_expiry || '').trim();
  if (!expStr) e.document_expiry = 'Expiry date is required.';
  else {
    const exp = new Date(`${expStr}T23:59:59`);
    if (Number.isNaN(exp.getTime())) e.document_expiry = 'Invalid expiry date.';
    else {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      if (exp < today) e.document_expiry = 'Document appears expired. Use a valid, unexpired ID.';
    }
  }

  if (!hasFrontUpload) e.document_front = 'Upload the front of your ID (required).';

  return e;
}

export function validateKycFile(file) {
  if (!file) return null;
  if (file.size > MAX_KYC_FILE_BYTES) {
    return `Each file must be ${MAX_KYC_FILE_BYTES / (1024 * 1024)}MB or smaller.`;
  }
  if (file.type && !KYC_FILE_TYPES.has(file.type)) {
    return 'Use JPEG, PNG, WebP, or PDF only.';
  }
  return null;
}

/**
 * Parse FastAPI/Pydantic 422 `detail` for POST /kyc/submit into nested field messages.
 * @param {unknown} detail
 * @returns {{ personal: Record<string, string>, document: Record<string, string> }}
 */
export function parseKycSubmit422FieldErrors(detail) {
  const personal = {};
  const document = {};
  if (!Array.isArray(detail)) return { personal, document };

  for (const item of detail) {
    if (!item || typeof item !== 'object') continue;
    const loc = item.loc;
    if (!Array.isArray(loc)) continue;
    const msgRaw = item.msg != null ? String(item.msg) : 'Invalid value';
    const msg = msgRaw.replace(/^Value error,\s*/i, '').trim();

    const pi = loc.indexOf('personal_info');
    if (pi >= 0) {
      const field = loc[pi + 1];
      if (typeof field === 'string') {
        if (field === 'postal_code') {
          const cap = extractPydanticMaxStringLen(msg);
          personal[field] = cap
            ? `Postal code must be at most ${cap} characters.`
            : msg;
        } else {
          personal[field] = msg;
        }
      }
    }
    const di = loc.indexOf('document_info');
    if (di >= 0) {
      const field = loc[di + 1];
      if (typeof field === 'string') document[field] = msg;
    }
  }
  return { personal, document };
}

/** One-line summary for KYC submit validation errors (includes field path). */
export function formatKycSubmit422Banner(detail) {
  if (!Array.isArray(detail)) return '';
  const parts = [];
  for (const item of detail) {
    if (!item || typeof item !== 'object') continue;
    const loc = Array.isArray(item.loc) ? item.loc : [];
    const human = loc
      .filter((x) => typeof x === 'string' && !['body', 'query', 'path', 'header'].includes(x))
      .join(' › ');
    const m = item.msg != null ? String(item.msg) : '';
    if (human && m) parts.push(`${human}: ${m}`);
    else if (m) parts.push(m);
  }
  return parts.join(' · ') || 'Validation failed';
}

export function firstErrorMessage(errors) {
  if (!errors || typeof errors !== 'object') return null;
  for (const k of PERSONAL_FIELD_ORDER) {
    if (errors[k]) return errors[k];
  }
  for (const k of DOC_FIELD_ORDER) {
    if (errors[k]) return errors[k];
  }
  for (const k of Object.keys(errors)) {
    if (errors[k]) return errors[k];
  }
  return null;
}
