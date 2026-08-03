/**
 * Global coin icon registry — single source of truth for the mobile app.
 * Mirrors ibo-exchange COIN_ICONS + stablecoin entries used in wallet/deposit.
 */

/** Runtime logos from deposit catalog / listings API (populated on market fetch). */
const EXTRA_COIN_LOGOS: Record<string, string> = {};

export function registerExtraCoinLogos(map: Record<string, string>): void {
  for (const [asset, url] of Object.entries(map)) {
    const key = asset.trim().toUpperCase();
    const logo = String(url ?? '').trim();
    if (!key || !logo) continue;
    if (/emergentagent\.com|emergent\.sh/i.test(logo)) continue;
    EXTRA_COIN_LOGOS[key] = logo;
  }
}

/** Synchronous logo lookup — returns from static map or already-registered extras. */
export function resolveLogoSync(base: string): string | undefined {
  const b = String(base ?? '').trim().toUpperCase();
  if (!b) return undefined;
  return COIN_ICONS[b] ?? EXTRA_COIN_LOGOS[b];
}

export const COIN_ICONS: Record<string, string> = {
  IBO:  'https://api.ibo.io/api/token-logo',
  BTC:  'https://assets.coingecko.com/coins/images/1/small/bitcoin.png',
  ETH:  'https://assets.coingecko.com/coins/images/279/small/ethereum.png',
  BNB:  'https://assets.coingecko.com/coins/images/825/small/bnb-icon2_2x.png',
  SOL:  'https://assets.coingecko.com/coins/images/4128/small/solana.png',
  XRP:  'https://assets.coingecko.com/coins/images/44/small/xrp-symbol-white-128.png',
  DOGE: 'https://assets.coingecko.com/coins/images/5/small/dogecoin.png',
  ADA:  'https://assets.coingecko.com/coins/images/975/small/cardano.png',
  POL:  'https://assets.coingecko.com/coins/images/32440/small/polygon.png',
  AVAX: 'https://assets.coingecko.com/coins/images/12559/small/Avalanche_Circle_RedWhite_Trans.png',
  DOT:  'https://assets.coingecko.com/coins/images/12171/small/polkadot.png',
  LINK: 'https://assets.coingecko.com/coins/images/877/small/chainlink-new-logo.png',
  LTC:  'https://assets.coingecko.com/coins/images/2/small/litecoin.png',
  USDT: 'https://assets.coingecko.com/coins/images/325/small/Tether.png',
  USDC: 'https://assets.coingecko.com/coins/images/6319/small/usdc.png',
  BUSD: 'https://assets.coingecko.com/coins/images/9576/small/BUSD.png',
};

const COIN_ICON_CDN = 'https://cdn.jsdelivr.net/gh/atomiclabs/cryptocurrency-icons@1a63530/128/color';

const QUOTE_SUFFIXES = ['USDT', 'USDC', 'BUSD', 'BTC', 'ETH', 'IBO'] as const;

/**
 * Resolve a trading pair or wallet asset code to its base coin ticker.
 *
 * Examples:
 *   USDT          → USDT
 *   BTCUSDT       → BTC
 *   BTCUSDT-PERP  → BTC
 *   BTC/USDT      → BTC
 */
export function resolveCoinBase(symbol: string): string {
  const raw = String(symbol ?? '').trim().toUpperCase();
  if (!raw) return '';

  if (raw.includes('/')) {
    return raw.split('/')[0].replace(/-PERP$|-OPTIONS$/i, '').trim();
  }

  const clean = raw.replace(/-PERP$|-OPTIONS$/i, '').replace(/[-_]/g, '');

  if (COIN_ICONS[clean]) return clean;

  for (const quote of QUOTE_SUFFIXES) {
    if (clean.endsWith(quote) && clean.length > quote.length) {
      return clean.slice(0, -quote.length);
    }
  }

  return clean;
}

/** Icon URL for any symbol / pair / wallet asset. */
export function getCoinIconUrl(symbol: string): string | undefined {
  const base = resolveCoinBase(symbol);
  if (!base) return undefined;
  if (COIN_ICONS[base]) return COIN_ICONS[base];
  if (EXTRA_COIN_LOGOS[base]) return EXTRA_COIN_LOGOS[base];
  // Generic fallback for long-tail/Web3 tickers when not in static map.
  return `${COIN_ICON_CDN}/${base.toLowerCase()}.png`;
}
