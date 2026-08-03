/** Ibo brand logo — served from public/ so production builds stay self-contained. */

const BASE = (import.meta.env.BASE_URL || '/').replace(/\/$/, '');

/** Cache-bust when logo assets are regenerated (transparent PNG). */
export const BRAND_ASSET_VERSION = '14';

/** Absolute path to the bundled logo (works with Vite base subpaths). */
export const BRAND_LOGO = BASE
  ? `${BASE}/ibo-exchange-logo.png?v=${BRAND_ASSET_VERSION}`
  : `/ibo-exchange-logo.png?v=${BRAND_ASSET_VERSION}`;

/** Compact mark fallback (older circular mark). */
export const BRAND_MARK = BASE
  ? `${BASE}/ibo-logo.png?v=${BRAND_ASSET_VERSION}`
  : `/ibo-logo.png?v=${BRAND_ASSET_VERSION}`;

/** Hosts that no longer serve assets — fall back to BRAND_LOGO instead. */
const BLOCKED_LOGO_PATTERN = /emergentagent\.com|emergent\.sh/i;

/** Drop dead Emergent CDN URLs; otherwise return the candidate or fallback. */
export function resolveBrandLogoUrl(candidate, fallback = BRAND_LOGO) {
  const url = (candidate || '').trim();
  if (!url || BLOCKED_LOGO_PATTERN.test(url)) return fallback;
  return url;
}
