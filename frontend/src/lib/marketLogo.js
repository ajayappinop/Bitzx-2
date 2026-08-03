const BACKEND_URL = (process.env.REACT_APP_BACKEND_URL || 'http://localhost:8000').replace(/\/$/, '');

import { BRAND_LOGO, resolveBrandLogoUrl } from '@/lib/brandAssets';

const COIN_ICONS = {
  IBO:   BRAND_LOGO,
  BTC:   'https://assets.coingecko.com/coins/images/1/small/bitcoin.png',
  ETH:   'https://assets.coingecko.com/coins/images/279/small/ethereum.png',
  BNB:   'https://assets.coingecko.com/coins/images/825/small/bnb-icon2_2x.png',
  SOL:   'https://assets.coingecko.com/coins/images/4128/small/solana.png',
  XRP:   'https://assets.coingecko.com/coins/images/44/small/xrp-symbol-white-128.png',
  DOGE:  'https://assets.coingecko.com/coins/images/5/small/dogecoin.png',
  ADA:   'https://assets.coingecko.com/coins/images/975/small/cardano.png',
  MATIC: 'https://assets.coingecko.com/coins/images/4713/small/matic-token-icon.png',
};

/** Listed-token logo from API (absolute or /uploads/... on the API host), else static majors. */
export function resolveMarketLogo(marketOrBase, logoUrl) {
  const base = typeof marketOrBase === 'string'
    ? marketOrBase.replace(/USDT$/, '').replace(/IBO$/, '').toUpperCase()
    : String(marketOrBase?.baseAsset ?? marketOrBase?.base ?? marketOrBase?.symbol ?? '')
        .replace(/USDT$/, '')
        .replace(/IBO$/, '')
        .toUpperCase();

  const raw = logoUrl ?? (typeof marketOrBase === 'object' ? marketOrBase?.logo_url : null);
  const s = raw != null ? resolveBrandLogoUrl(String(raw).trim(), '') : '';
  if (s) {
    if (s.startsWith('http://') || s.startsWith('https://')) return s;
    if (s.startsWith('//')) return `https:${s}`;
    const rel = s.startsWith('/') ? s : `/${s}`;
    return `${BACKEND_URL}${rel}`;
  }
  return COIN_ICONS[base] || null;
}

export { COIN_ICONS };
