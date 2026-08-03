/**
 * Refer & Earn — capture/persist the referral code from a shared link.
 *
 * A share link looks like `${website}?ref=<code>`. On first load we stash
 * the code in localStorage so it survives across the (possibly multi-step)
 * signup flow, even if the user lands on `/register` a few clicks later
 * (e.g. via the landing page CTA) rather than directly on the query param.
 */

const STORAGE_KEY = 'ibo_ex_referral_code';

export function captureReferralCodeFromUrl(search) {
  try {
    const params = new URLSearchParams(search || window.location.search);
    const ref = (params.get('ref') || params.get('referral_code') || params.get('referralCode') || '').trim();
    if (ref) {
      localStorage.setItem(STORAGE_KEY, ref.toUpperCase());
    }
    return ref || null;
  } catch {
    return null;
  }
}

export function getStoredReferralCode() {
  try {
    return localStorage.getItem(STORAGE_KEY) || '';
  } catch {
    return '';
  }
}

export function setStoredReferralCode(code) {
  try {
    const ref = String(code ?? '').trim().toUpperCase();
    if (ref) localStorage.setItem(STORAGE_KEY, ref);
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* no-op */
  }
}

/** Signup URL with ?ref= — falls back to current site /register when admin URL is unset. */
export function buildReferralSignupLink(websiteUrl, code) {
  const ref = String(code ?? '').trim();
  if (!ref) return '';
  const configured = String(websiteUrl ?? '').trim();
  const base = configured || `${window.location.origin}/register`;
  const sep = base.includes('?') ? '&' : '?';
  return `${base}${sep}ref=${encodeURIComponent(ref)}`;
}

export function clearStoredReferralCode() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* no-op */
  }
}
