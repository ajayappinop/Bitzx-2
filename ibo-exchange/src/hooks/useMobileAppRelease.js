import { useEffect, useState } from 'react';
import { exchangeApiOrigin } from '@/lib/apiBase';

const API = exchangeApiOrigin(import.meta.env.VITE_BACKEND_URL);

export const MOBILE_DIST_GOOGLE_PLAY = 'google_play';
export const MOBILE_DIST_DIRECT_APK = 'direct_apk';

/** True when the public release payload points at Google Play. */
export function isGooglePlayRelease(release) {
  return release?.distribution === MOBILE_DIST_GOOGLE_PLAY;
}

/** Absolute URL for direct APK download (API stream endpoint). */
export function mobileAppDownloadHref(release) {
  if (!release?.available || isGooglePlayRelease(release)) return null;
  const rel = release.download_api_url || release.download_url;
  if (!rel) return null;
  if (rel.startsWith('http://') || rel.startsWith('https://')) return rel;
  return `${API}${rel.startsWith('/') ? '' : '/'}${rel}`;
}

/** Store / download href — Google Play URL or APK download URL. */
export function mobileAppStoreHref(release) {
  if (!release?.available) return null;
  if (isGooglePlayRelease(release)) {
    const url = release.google_play_url || release.download_url;
    return url && (url.startsWith('http://') || url.startsWith('https://')) ? url : null;
  }
  return mobileAppDownloadHref(release);
}

/** Anchor props for store CTAs (Play Store opens in new tab; APK uses download). */
export function mobileAppLinkProps(release) {
  const href = mobileAppStoreHref(release);
  if (!href) return null;
  if (isGooglePlayRelease(release)) {
    return {
      href,
      target: '_blank',
      rel: 'noopener noreferrer',
    };
  }
  return {
    href,
    download: release?.version ? `ibo-${release.version}.apk` : 'ibo.apk',
  };
}

/**
 * Fetch GET /api/mobile-app/release once (public, no auth).
 */
export function useMobileAppRelease() {
  const [release, setRelease] = useState(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`${API}/api/mobile-app/release`)
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled) setRelease(data);
      })
      .catch(() => {
        if (!cancelled) setRelease({ available: false });
      })
      .finally(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => { cancelled = true; };
  }, []);

  const storeHref = mobileAppStoreHref(release);
  const downloadHref = mobileAppDownloadHref(release);
  const available = release?.available === true;
  const isGooglePlay = isGooglePlayRelease(release);
  const isDirectApk = !isGooglePlay;

  return {
    release,
    loaded,
    available,
    storeHref,
    downloadHref,
    isGooglePlay,
    isDirectApk,
    linkProps: mobileAppLinkProps(release),
  };
}
