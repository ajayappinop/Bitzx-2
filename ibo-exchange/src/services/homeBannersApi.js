import { exchangeApiOrigin } from '@/lib/apiBase';

const API = exchangeApiOrigin(import.meta.env.VITE_BACKEND_URL);

export function bannerImageUrl(path) {
  const s = String(path ?? '').trim();
  if (!s) return '';
  if (s.startsWith('http')) return s;
  return `${API}${s.startsWith('/') ? '' : '/'}${s}`;
}

export async function fetchHomeBanners() {
  const res = await fetch(`${API}/api/app/home-banners`, { cache: 'no-store' });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    return { enabled: false, auto_scroll_seconds: 5, banners: [] };
  }
  return {
    enabled: data.enabled !== false,
    auto_scroll_seconds: data.auto_scroll_seconds ?? 5,
    banners: Array.isArray(data.banners) ? data.banners : [],
  };
}
