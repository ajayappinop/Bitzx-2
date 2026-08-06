// ── Constants ────────────────────────────────────────────────────────────────
import { exchangeApiOrigin } from '@/lib/apiBase';

const BACKEND = exchangeApiOrigin(import.meta.env.VITE_BACKEND_URL);

/**
 * WebSocket origin for `/api/ws/...` paths.
 * Set `VITE_WS_URL` (e.g. `wss://api.yourdomain.com`) if sockets are on a different host than `VITE_BACKEND_URL`.
 */
const WS_ORIGIN = (import.meta.env.VITE_WS_URL || String(BACKEND).replace(/^http/, 'ws')).replace(/\/$/, '');

/** Build full `ws://` / `wss://` URL for exchange streams (public or `token=` auth). */
export function exchangeWsPath(pathWithQuery) {
  const p = pathWithQuery.startsWith('/') ? pathWithQuery : `/${pathWithQuery}`;
  return `${WS_ORIGIN}${p}`;
}

const IBO_PRICE  = 0.4523;
const IBO_CHANGE = 2.33;
const IBO_HIGH   = 0.4812;
const IBO_LOW    = 0.4156;
const IBO_VOL    = 7_284_521;

// ── Supported pairs (must match backend SYMBOL_BASE_MAP / BINANCE_USDT_PAIRS + Delta) ──
export const PAIRS = [
  { symbol: 'IBOUSDT',  base: 'IBO',  quote: 'USDT', source: 'internal' },
  { symbol: 'BTCUSDT',  base: 'BTC',  quote: 'USDT', source: 'binance'  },
  { symbol: 'ETHUSDT',  base: 'ETH',  quote: 'USDT', source: 'binance'  },
  { symbol: 'BNBUSDT',  base: 'BNB',  quote: 'USDT', source: 'binance'  },
  { symbol: 'SOLUSDT',  base: 'SOL',  quote: 'USDT', source: 'binance'  },
  { symbol: 'XRPUSDT',  base: 'XRP',  quote: 'USDT', source: 'binance'  },
  { symbol: 'DOGEUSDT', base: 'DOGE', quote: 'USDT', source: 'binance'  },
  { symbol: 'ADAUSDT',  base: 'ADA',  quote: 'USDT', source: 'binance'  },
  { symbol: 'POLUSDT',  base: 'POL',  quote: 'USDT', source: 'binance'  },
  { symbol: 'AVAXUSDT', base: 'AVAX', quote: 'USDT', source: 'binance'  },
  { symbol: 'DOTUSDT',  base: 'DOT',  quote: 'USDT', source: 'binance'  },
  { symbol: 'LINKUSDT', base: 'LINK', quote: 'USDT', source: 'binance'  },
  { symbol: 'LTCUSDT',  base: 'LTC',  quote: 'USDT', source: 'binance'  },
  // Delta-quoted pairs
  { symbol: 'BTCIBO',  base: 'BTC',  quote: 'IBO',  source: 'internal' },
  { symbol: 'ETHIBO',  base: 'ETH',  quote: 'IBO',  source: 'internal' },
  { symbol: 'BNBIBO',  base: 'BNB',  quote: 'IBO',  source: 'internal' },
  { symbol: 'SOLIBO',  base: 'SOL',  quote: 'IBO',  source: 'internal' },
  { symbol: 'XRPIBO',  base: 'XRP',  quote: 'IBO',  source: 'internal' },
  { symbol: 'DOGEIBO', base: 'DOGE', quote: 'IBO',  source: 'internal' },
];

import { BRAND_MARK, resolveBrandLogoUrl } from '@/lib/brandAssets';

/** Resolve coin logo: API/catalog URL first, then static majors map. */
export function coinIconUrl(base, logoUrl) {
  const url = logoUrl != null ? resolveBrandLogoUrl(String(logoUrl).trim(), '') : '';
  if (url) {
    if (url.startsWith('http://') || url.startsWith('https://')) return url;
    if (url.startsWith('//')) return `https:${url}`;
    const rel = url.startsWith('/') ? url : `/${url}`;
    return `${BACKEND}${rel}`;
  }
  const b = String(base || '').toUpperCase();
  return COIN_ICONS[b] || null;
}

export const COIN_ICONS = {
  IBO:  BRAND_MARK,
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

/** Backend wire symbol for the internal Delta pair. */
export const INTERNAL_SPOT_SYMBOL = 'IBOUSDT';

/** Default pair when opening Trade / Spot from the navbar. */
export const DEFAULT_SPOT_TRADE_SYMBOL = 'BTCUSDT';

/** Core pairs pre-seeded by the mock engine at startup (matches backend bootstrap). */
export const IBO_MOCK_MARKET_SYMBOLS = new Set([
  'IBOUSDT',
  ...PAIRS.filter((p) => p.quote === 'IBO').map((p) => p.symbol),
]);

/** Chart / depth / tape use the Delta mock engine for IBOUSDT and every *Delta pair (incl. Web3 catalog). */
export function isIboMockMarketSymbol(sym) {
  const upper = String(sym || '').trim().toUpperCase();
  if (upper === 'IBOUSDT') return true;
  return isIboQuotedRouteSymbol(upper);
}

/**
 * TradingView is only available for Binance-listed USDT pairs.
 * Listed / internal mock USDT pairs (e.g. MIDASUSDT) use SyntheticChart + backend klines.
 */
export function isSyntheticUsdtChartSymbol(sym, marketMeta) {
  const upper = String(sym || '').trim().toUpperCase();
  if (!upper) return false;
  if (isIboMockMarketSymbol(upper)) return true;

  const meta = marketMeta && typeof marketMeta === 'object' ? marketMeta : null;
  if (meta) {
    const stats = String(meta.stats_source || '');
    if (stats === 'listed' || stats === 'internal_mock') return true;
    if (meta.is_listed || meta.source === 'listed') return true;
  }

  if (SPOT_SYMBOL_SET.has(upper)) return false;
  return isListedUsdtRouteSymbol(upper);
}

/** Route `/trade/IBOUSDT` → API symbol (identity for ibo). */
export function apiSymbolFromRouteParam(param) {
  return String(param || '').trim().toUpperCase();
}

const SPOT_SYMBOL_SET = new Set(PAIRS.map((p) => p.symbol));

/** Delta-quoted pair from route, e.g. USDDIBO (includes dynamic Web3 catalog pairs). */
export function isIboQuotedRouteSymbol(param) {
  const upper = apiSymbolFromRouteParam(param);
  return Boolean(upper && /^[A-Z0-9]{2,12}IBO$/.test(upper) && upper !== 'IBOIBO');
}

/** Listed / dynamic USDT spot pair from route, e.g. MIDASUSDT. */
export function isListedUsdtRouteSymbol(param) {
  const upper = apiSymbolFromRouteParam(param);
  return Boolean(upper && /^[A-Z0-9]{2,12}USDT$/.test(upper));
}

/** Normalize `/trade/:symbol` → API wire symbol (MIDAS → MIDASUSDT). */
export function normalizeTradeRouteSymbol(param) {
  const upper = apiSymbolFromRouteParam(param);
  if (!upper) return null;
  if (upper.endsWith('IBO') && upper.length > 3) return upper;
  if (upper.endsWith('USDT')) return upper;
  if (/^[A-Z0-9]{2,12}$/.test(upper)) return `${upper}USDT`;
  return null;
}

/** Valid spot pair from `/trade/:symbol`, or null if unknown / empty. */
export function tradeSymbolFromRouteParam(param) {
  const normalized = normalizeTradeRouteSymbol(param);
  if (!normalized) return null;
  if (SPOT_SYMBOL_SET.has(normalized)) return normalized;
  if (isIboQuotedRouteSymbol(normalized)) return normalized;
  if (isListedUsdtRouteSymbol(normalized)) return normalized;
  return null;
}

/** Pretty path segment for `/trade/:symbol`. */
export function tradePathForApiSymbol(apiSym) {
  return String(apiSym || '').toUpperCase();
}

/** Parse API wire symbol → { symbol, base, quote } (static PAIRS + dynamic *Delta). */
export function parsePairFromApiSymbol(apiSym) {
  const s = String(apiSym || '').toUpperCase();
  const row = PAIRS.find((x) => x.symbol === s);
  if (row) return { symbol: s, base: row.base, quote: row.quote };
  if (s.endsWith('IBO') && s.length > 3) {
    return { symbol: s, base: s.slice(0, -3), quote: 'IBO' };
  }
  if (s.endsWith('USDT') && s.length > 4) {
    return { symbol: s, base: s.slice(0, -4), quote: 'USDT' };
  }
  return { symbol: s, base: s.replace(/USDT$/, ''), quote: 'USDT' };
}

/** UI label for wire asset codes (IBO still used in API/routes). */
export function displayAssetCode(asset) {
  const u = String(asset || '').toUpperCase();
  if (u === 'IBO') return 'Delta';
  return asset == null || asset === '' ? '' : String(asset);
}

/** UI base ticker for an API pair symbol (e.g. DOTIBO → DOT, IBOUSDT → Delta). */
export function displayBaseForApiSymbol(apiSym) {
  return displayAssetCode(parsePairFromApiSymbol(apiSym).base);
}

/** Quote asset for an API pair symbol (e.g. DOTIBO → IBO, BTCUSDT → USDT). */
export function quoteForApiSymbol(apiSym) {
  return parsePairFromApiSymbol(apiSym).quote;
}

/** `IBOUSDT` → `Delta/USDT`, `DOTIBO` → `DOT/Delta` for header, tables, order rows. */
export function displayPairSlash(apiSymbol) {
  const { base, quote } = parsePairFromApiSymbol(apiSymbol);
  return `${displayAssetCode(base)}/${displayAssetCode(quote)}`;
}

/** Wallet / balance row: wire IBO shown as Delta. */
export function walletAssetLabel(asset) {
  return displayAssetCode(asset);
}

export function tradeHrefForWalletAsset(asset) {
  return `/trade/${asset}USDT`;
}

function iboTickerFallback() {
  return {
    symbol:             'IBOUSDT',
    price:              String(IBO_PRICE),
    priceChangePercent: String(IBO_CHANGE),
    priceChange:        String((IBO_PRICE * IBO_CHANGE / 100).toFixed(6)),
    highPrice:          String(IBO_HIGH),
    lowPrice:           String(IBO_LOW),
    volume:             String(IBO_VOL),
    quoteVolume:        String((IBO_VOL * IBO_PRICE).toFixed(2)),
  };
}

async function safeFetch(url, fallback = null) {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(12000) });
    if (!r.ok) throw new Error(r.status);
    return r.json();
  } catch {
    return fallback;
  }
}

/** Normalize `/api/trading/markets` row → legacy client shape */
function normalizeMarketRow(m) {
  if (!m || !m.symbol) return null;
  const base = m.base ?? m.baseAsset ?? m.symbol.replace('USDT', '');
  const src = m.source ?? (m.symbol === 'IBOUSDT' ? 'internal' : 'binance');
  const px = parseFloat(m.price || 0);
  const spr = px * 0.0004;
  return {
    symbol: m.symbol,
    base,
    quote: m.quote ?? m.quoteAsset ?? (m.symbol?.endsWith('IBO') ? 'IBO' : 'USDT'),
    source: src,
    price: m.price,
    priceChange: m.priceChange,
    priceChangePercent: m.priceChangePercent,
    openPrice: m.openPrice,
    highPrice: m.highPrice,
    lowPrice: m.lowPrice,
    volume: m.volume,
    quoteVolume: m.quoteVolume,
    weightedAvgPrice: m.weightedAvgPrice ?? m.price,
    bidPrice: m.bidPrice ?? String(Math.max(px - spr / 2, 1e-8)),
    askPrice: m.askPrice ?? String(px + spr / 2),
    prevClosePrice: m.prevClosePrice,
    count: m.count != null ? String(m.count) : undefined,
    project_name: m.project_name,
    token_name: m.token_name,
    logo_url: m.logo_url,
    description: m.description,
    market_tagline: m.market_tagline,
    market_category: m.market_category,
    market_visible: m.market_visible,
    featured_landing: m.featured_landing,
    market_sort_order: m.market_sort_order,
    listed_token_id: m.listed_token_id,
    is_listed: m.is_listed,
    stats_source: m.stats_source ?? (src === 'binance' ? 'binance' : src === 'internal' ? 'internal' : ''),
    is_platform_default: m.is_platform_default,
    blockchain_network: m.blockchain_network,
    official_website: m.official_website,
  };
}

export function normalizeMarketsList(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.map(normalizeMarketRow).filter(Boolean);
}

/** WebSocket path for Delta market streams. */
export function iboWsPath(pathWithQuery) {
  return exchangeWsPath(pathWithQuery);
}

export const marketApi = {
  /** All markets — single backend call (Delta + Binance batch server-side) */
  async getMarkets() {
    const raw = await safeFetch(`${BACKEND}/api/trading/markets`, null);
    return normalizeMarketsList(raw);
  },

  /** Paginated Delta-quoted markets. Params: skip, limit, tier, q */
  async getIBOMarkets(params = {}) {
    const q = new URLSearchParams({
      skip: String(params.skip ?? 0),
      limit: String(params.limit ?? 80),
      tier: params.tier ?? 'all',
    });
    if (params.q) q.set('q', params.q);
    const raw = await safeFetch(`${BACKEND}/api/trading/ibo-markets?${q}`, null);
    if (raw && Array.isArray(raw.markets)) {
      return { ...raw, markets: normalizeMarketsList(raw.markets) };
    }
    if (Array.isArray(raw)) return { markets: normalizeMarketsList(raw), total: raw.length };
    return { markets: [], total: 0 };
  },

  /** Full Delta catalog (majors + all Web3), paginated until complete. */
  async fetchAllIboMarkets() {
    const PAGE = 80;
    const seen = new Set();
    const out = [];
    let skip = 0;
    let total = 1;
    while (skip < total) {
      const d = await marketApi.getIBOMarkets({ tier: 'all', skip, limit: PAGE });
      const list = d?.markets ?? [];
      const parsedTotal = Number(d?.total);
      total = Number.isFinite(parsedTotal) ? parsedTotal : skip + list.length;
      for (const m of list) {
        const sym = String(m?.symbol || '').toUpperCase();
        if (sym && !seen.has(sym)) {
          seen.add(sym);
          const row = normalizeMarketRow(m);
          if (row) out.push(row);
        }
      }
      skip += list.length;
      if (!list.length) break;
    }
    return out;
  },

  async getTicker(symbol) {
    const sym = symbol.toUpperCase();
    const d = await safeFetch(`${BACKEND}/api/trading/ticker/${sym}`, sym === 'IBOUSDT' ? iboTickerFallback() : null);
    if (!d) return null;
    if (sym === 'IBOUSDT') return d;
    return {
      symbol:             d.symbol,
      price:              d.price,
      priceChangePercent: d.priceChangePercent,
      priceChange:        d.priceChange,
      highPrice:          d.highPrice,
      lowPrice:           d.lowPrice,
      volume:             d.volume,
      quoteVolume:        d.quoteVolume,
      openPrice:          d.openPrice,
      bidPrice:           d.bidPrice,
      askPrice:           d.askPrice,
    };
  },

  async getKlines(symbol, interval = '1h', limit = 200) {
    const sym = symbol.toUpperCase();
    const d = await safeFetch(
      `${BACKEND}/api/trading/klines/${sym}?interval=${encodeURIComponent(interval)}&limit=${limit}`,
      [],
    );
    return Array.isArray(d) ? d : [];
  },

  async getOrderBook(symbol, limit = 20) {
    const sym = symbol.toUpperCase();
    return safeFetch(
      `${BACKEND}/api/trading/orderbook/${sym}?limit=${limit}`,
      { asks: [], bids: [] },
    );
  },

  async getRecentTrades(symbol, limit = 50) {
    const sym = symbol.toUpperCase();
    const d = await safeFetch(`${BACKEND}/api/trading/trades/${sym}?limit=${limit}`, []);
    return Array.isArray(d) ? d : [];
  },

  async getTradingFeeConfig() {
    const d = await safeFetch(`${BACKEND}/api/trading/fee-config`, null);
    if (!d || typeof d !== 'object') {
      return {
        maker_fee_rate: 0.001,
        taker_fee_rate: 0.001,
        fee_asset: 'IBO',
        ibo_price_usdt: IBO_PRICE,
        spot: { maker_fee_rate: 0.001, taker_fee_rate: 0.001 },
        futures: { maker_fee_rate: 0.0002, taker_fee_rate: 0.0005, liquidation_fee_rate: 0.005 },
        options: { maker_fee_rate: 0.0002, taker_fee_rate: 0.0005, basis: 'premium_notional' },
      };
    }
    const iboPx = Number(d.ibo_price_usdt ?? IBO_PRICE);
    return {
      ...d,
      maker_fee_rate: Number(d.maker_fee_rate ?? d.spot?.maker_fee_rate ?? 0.001),
      taker_fee_rate: Number(d.taker_fee_rate ?? d.spot?.taker_fee_rate ?? 0.001),
      fee_asset: String(d.fee_asset || 'IBO').toUpperCase(),
      ibo_price_usdt: iboPx,
      spot: d.spot || { maker_fee_rate: d.maker_fee_rate, taker_fee_rate: d.taker_fee_rate },
      futures: d.futures || { maker_fee_rate: 0.0002, taker_fee_rate: 0.0005 },
      options: d.options || { maker_fee_rate: 0.0002, taker_fee_rate: 0.0005 },
    };
  },
};
