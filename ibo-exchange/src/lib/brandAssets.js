/** Brand logo assets — served from public/ so production builds stay self-contained. */

const BASE = (import.meta.env.BASE_URL || '/').replace(/\/$/, '');

/** Cache-bust when logo assets are regenerated (transparent PNG). */
export const BRAND_ASSET_VERSION = '18';

function publicAsset(path) {
  const p = path.startsWith('/') ? path : `/${path}`;
  return BASE ? `${BASE}${p}?v=${BRAND_ASSET_VERSION}` : `${p}?v=${BRAND_ASSET_VERSION}`;
}

/**
 * Theme logos (transparent PNG):
 * - Light theme → 1st logo (dark wordmark)
 * - Dark theme  → 2nd logo (light wordmark)
 */
export const BRAND_LOGO_LIGHT = publicAsset('/ibo-exchange-logo-light.png');
export const BRAND_LOGO_DARK = publicAsset('/ibo-exchange-logo.png');
/** Default / fallback: dark-theme wordmark */
export const BRAND_LOGO = BRAND_LOGO_DARK;

/** Compact mark (icon facet only, transparent). */
export const BRAND_MARK = publicAsset('/ibo-logo.png');

/** Resolve logo URL for the active color theme. */
export function brandLogoForTheme(theme) {
  return theme === 'light' ? BRAND_LOGO_LIGHT : BRAND_LOGO_DARK;
}

/** Hosts that no longer serve assets — fall back to BRAND_LOGO instead. */
const BLOCKED_LOGO_PATTERN = /emergentagent\.com|emergent\.sh/i;

/** Drop dead Emergent CDN URLs; otherwise return the candidate or fallback. */
export function resolveBrandLogoUrl(candidate, fallback = BRAND_LOGO) {
  const url = (candidate || '').trim();
  if (!url || BLOCKED_LOGO_PATTERN.test(url)) return fallback;
  return url;
}
