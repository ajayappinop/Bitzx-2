/** IBO Exchange web app origin (for admin "Login as user" deep links). */
export function exchangeAppOrigin() {
  const raw = (import.meta.env.VITE_EXCHANGE_URL || '').trim();
  if (raw) return raw.replace(/\/$/, '');
  if (typeof window !== 'undefined' && window.location.hostname === 'localhost') {
    return 'http://localhost:5173';
  }
  return 'https://exchange.ibo.io';
}

/** Keep in sync with backend ``IMPERSONATE_TOKEN_MINUTES`` (default 10). */
export const IMPERSONATE_SESSION_MINUTES = Number(
  import.meta.env.VITE_IMPERSONATE_SESSION_MINUTES || 10,
);

/**
 * Dedicated SPA route with token in the query string.
 * Query params survive hosting redirects better than hash fragments, and the
 * exchange ImpersonateLoginPage handles the session explicitly.
 */
export function buildExchangeImpersonationUrl(accessToken) {
  const base = exchangeAppOrigin();
  const token = String(accessToken || '').trim();
  return `${base}/auth/impersonate?t=${encodeURIComponent(token)}`;
}

/**
 * Open a blank tab synchronously on the user's click (required by browsers).
 * Do NOT pass noopener/noreferrer — those make window.open return null while
 * still opening a tab, which breaks follow-up navigation.
 */
export function openBlankExchangeTab() {
  try {
    return window.open('about:blank', '_blank');
  } catch {
    return null;
  }
}

/** Navigate a tab opened via openBlankExchangeTab once the impersonation JWT is ready. */
export function navigateExchangeImpersonation(tab, accessToken) {
  const token = String(accessToken || '').trim();
  if (!token) return false;

  const url = buildExchangeImpersonationUrl(token);

  if (tab && !tab.closed) {
    try {
      tab.document.title = 'IBO Exchange — signing in…';
      tab.document.body.innerHTML =
        '<p style="font-family:system-ui,sans-serif;padding:2rem;color:#333">Signing you in as user…</p>';
    } catch {
      /* ignore */
    }
    try {
      tab.location.href = url;
      return true;
    } catch {
      /* fall through */
    }
  }

  try {
    const opened = window.open(url, '_blank');
    if (opened) return true;
  } catch {
    /* ignore */
  }

  // Last resort: same-tab navigation (keeps the token; admin can use browser back).
  window.location.assign(url);
  return true;
}
