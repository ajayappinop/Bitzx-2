/** Brand logo — served from public/ (transparent PNG). */

const PUBLIC_BASE = (process.env.PUBLIC_URL || '').replace(/\/$/, '');

const v = '18';

/** Full wordmark for dark backgrounds (2nd logo / white text). */
export const BRAND_LOGO = PUBLIC_BASE
  ? `${PUBLIC_BASE}/ibo-exchange-logo.png?v=${v}`
  : `/ibo-exchange-logo.png?v=${v}`;

export const BRAND_LOGO_LIGHT = PUBLIC_BASE
  ? `${PUBLIC_BASE}/ibo-exchange-logo-light.png?v=${v}`
  : `/ibo-exchange-logo-light.png?v=${v}`;

/** Compact icon mark. */
export const BRAND_MARK = PUBLIC_BASE
  ? `${PUBLIC_BASE}/ibo-logo.png?v=${v}`
  : `/ibo-logo.png?v=${v}`;

/** Hosts that no longer serve assets — fall back to BRAND_LOGO instead. */
const BLOCKED_LOGO_PATTERN = /emergentagent\.com|emergent\.sh/i;

/** Drop dead Emergent CDN URLs; otherwise return the candidate or fallback. */
export function resolveBrandLogoUrl(candidate, fallback = BRAND_LOGO) {
  const url = (candidate || '').trim();
  if (!url || BLOCKED_LOGO_PATTERN.test(url)) return fallback;
  return url;
}
