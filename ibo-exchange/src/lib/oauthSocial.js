/**
 * Google / Apple OAuth helpers for Login + Register (GIS + AppleJS).
 */
import { exchangeApiOrigin } from '@/lib/apiBase';

const API = exchangeApiOrigin(import.meta.env.VITE_BACKEND_URL);

const GSI_SRC = 'https://accounts.google.com/gsi/client';
const APPLE_SRC = 'https://appleid.cdn-apple.com/appleauth/static/jsapi/appleid/1/en_US/appleid.auth.js';

let gsiPromise = null;
let applePromise = null;
let oauthConfigCache = null;

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${src}"]`);
    if (existing) {
      if (existing.dataset.loaded === '1') {
        resolve();
        return;
      }
      existing.addEventListener('load', () => resolve());
      existing.addEventListener('error', () => reject(new Error(`Failed to load ${src}`)));
      return;
    }
    const s = document.createElement('script');
    s.src = src;
    s.async = true;
    s.onload = () => {
      s.dataset.loaded = '1';
      resolve();
    };
    s.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(s);
  });
}

export async function fetchOauthConfig() {
  if (oauthConfigCache) return oauthConfigCache;
  const envFallback = {
    google_client_id: (import.meta.env.VITE_GOOGLE_CLIENT_ID || '').trim(),
    apple_client_id: (import.meta.env.VITE_APPLE_CLIENT_ID || '').trim(),
    apple_redirect_uri: (import.meta.env.VITE_APPLE_REDIRECT_URI || `${window.location.origin}/login`).trim(),
    google_enabled: Boolean((import.meta.env.VITE_GOOGLE_CLIENT_ID || '').trim()),
    apple_enabled: Boolean((import.meta.env.VITE_APPLE_CLIENT_ID || '').trim()),
  };
  try {
    const res = await fetch(`${API}/api/auth/oauth/config`, { headers: { Accept: 'application/json' } });
    if (!res.ok) {
      oauthConfigCache = envFallback;
      return oauthConfigCache;
    }
    const data = await res.json();
    oauthConfigCache = {
      google_client_id: (data.google_client_id || envFallback.google_client_id || '').trim(),
      apple_client_id: (data.apple_client_id || envFallback.apple_client_id || '').trim(),
      apple_redirect_uri: (data.apple_redirect_uri || envFallback.apple_redirect_uri || '').trim(),
      google_enabled: Boolean(data.google_enabled || envFallback.google_enabled),
      apple_enabled: Boolean(data.apple_enabled || envFallback.apple_enabled),
    };
    // Prefer server flags based on configured IDs
    oauthConfigCache.google_enabled = Boolean(oauthConfigCache.google_client_id);
    oauthConfigCache.apple_enabled = Boolean(oauthConfigCache.apple_client_id);
    return oauthConfigCache;
  } catch {
    oauthConfigCache = envFallback;
    return oauthConfigCache;
  }
}

function loadGsi() {
  if (!gsiPromise) gsiPromise = loadScript(GSI_SRC);
  return gsiPromise;
}

function loadApple() {
  if (!applePromise) applePromise = loadScript(APPLE_SRC);
  return applePromise;
}

/**
 * Opens Google account picker and resolves with access_token (or id_token when available).
 */
export async function signInWithGooglePopup() {
  const cfg = await fetchOauthConfig();
  if (!cfg.google_client_id) {
    throw new Error('Google Sign-In is not configured. Set GOOGLE_OAUTH_CLIENT_ID / VITE_GOOGLE_CLIENT_ID.');
  }
  await loadGsi();
  const google = window.google;
  if (!google?.accounts?.oauth2) {
    throw new Error('Google Sign-In failed to load. Check your network and try again.');
  }

  return new Promise((resolve, reject) => {
    try {
      const client = google.accounts.oauth2.initTokenClient({
        client_id: cfg.google_client_id,
        scope: 'openid email profile',
        callback: (resp) => {
          if (resp?.error) {
            reject(new Error(resp.error_description || resp.error || 'Google sign-in cancelled'));
            return;
          }
          if (resp?.access_token) {
            resolve({ access_token: resp.access_token });
            return;
          }
          reject(new Error('Google did not return an access token'));
        },
        error_callback: (err) => {
          reject(new Error(err?.message || 'Google sign-in failed'));
        },
      });
      client.requestAccessToken({ prompt: 'select_account' });
    } catch (err) {
      reject(err instanceof Error ? err : new Error('Google sign-in failed'));
    }
  });
}

/**
 * Opens Apple Sign In (popup). Resolves { id_token, name? }.
 */
export async function signInWithApplePopup() {
  const cfg = await fetchOauthConfig();
  if (!cfg.apple_client_id) {
    throw new Error('Apple Sign-In is not configured. Set APPLE_OAUTH_CLIENT_ID / VITE_APPLE_CLIENT_ID.');
  }
  const redirectURI = cfg.apple_redirect_uri || `${window.location.origin}/login`;
  await loadApple();
  const AppleID = window.AppleID;
  if (!AppleID?.auth) {
    throw new Error('Apple Sign-In failed to load. Check your network and try again.');
  }

  AppleID.auth.init({
    clientId: cfg.apple_client_id,
    scope: 'name email',
    redirectURI,
    usePopup: true,
  });

  const data = await AppleID.auth.signIn();
  const idToken = data?.authorization?.id_token;
  if (!idToken) {
    throw new Error('Apple did not return an ID token');
  }
  let name = '';
  const n = data?.user?.name;
  if (n) {
    name = [n.firstName, n.lastName].filter(Boolean).join(' ').trim();
  }
  return { id_token: idToken, name: name || undefined };
}
