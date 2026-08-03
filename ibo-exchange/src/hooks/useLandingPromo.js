import { useEffect, useState } from 'react';
import { exchangeApiOrigin } from '@/lib/apiBase';

const API = exchangeApiOrigin(import.meta.env.VITE_BACKEND_URL);
const DISMISS_KEY = 'ibo_landing_promo_dismissed';

export function promoAssetUrl(path) {
  if (!path) return null;
  if (path.startsWith('http://') || path.startsWith('https://')) return path;
  return `${API}${path.startsWith('/') ? '' : '/'}${path}`;
}

export function isPromoDismissed(dismissHours = 24) {
  try {
    const raw = localStorage.getItem(DISMISS_KEY);
    if (!raw) return false;
    const until = parseInt(raw, 10);
    if (!Number.isFinite(until)) return false;
    return Date.now() < until;
  } catch {
    return false;
  }
}

export function dismissPromo(dismissHours = 24) {
  const hrs = Math.max(1, Number(dismissHours) || 24);
  try {
    localStorage.setItem(DISMISS_KEY, String(Date.now() + hrs * 3600 * 1000));
  } catch {
    /* ignore */
  }
}

/** Build active slides from public promo payload. */
export function buildPromoSlides(promo) {
  if (!promo?.enabled) return [];
  const slides = [];
  if (promo.coin?.enabled) slides.push({ key: 'coin', type: 'coin', data: promo.coin });
  if (promo.app?.enabled) slides.push({ key: 'app', type: 'app', data: promo.app, apk: promo.app?.apk });
  return slides;
}

export function useLandingPromo() {
  const [promo, setPromo] = useState(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`${API}/api/landing-promo`)
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled) setPromo(data);
      })
      .catch(() => {
        if (!cancelled) setPromo({ enabled: false });
      })
      .finally(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => { cancelled = true; };
  }, []);

  const slides = buildPromoSlides(promo);
  // Show on every full page load/refresh of the landing page (no localStorage gate).
  const shouldShow = loaded && slides.length > 0;

  return { promo, loaded, slides, shouldShow };
}
