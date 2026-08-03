import type { TradeMarketType } from '../components/trading/TradeMarketHeader';

/** Strip futures suffix → spot/options underlying, e.g. BTCUSDT-PERP → BTCUSDT */
export function toSpotSymbol(symbol: string): string {
  return String(symbol || '')
    .replace(/-PERP$/i, '')
    .replace(/-OPTIONS$/i, '')
    .toUpperCase();
}

/**
 * REST / WS trading symbol (no slash), e.g. BTC/USDT → BTCUSDT.
 */
export function toExchangeSymbol(symbol: string): string {
  const s = toSpotSymbol(symbol).replace(/\//g, '');
  if (s.endsWith('IBO') && s.length > 3) return s;
  if (s.endsWith('USDT')) return s;
  if (/^[A-Z0-9]{2,12}$/.test(s)) return `${s}USDT`;
  return s;
}

/** Spot/options symbol → futures perp symbol */
export function toFuturesSymbol(symbol: string): string {
  const s = String(symbol || '').toUpperCase();
  if (s.endsWith('-PERP')) return s;
  return `${toSpotSymbol(s)}-PERP`;
}

export function resolveSymbolForMarket(symbol: string, market: TradeMarketType): string {
  if (market === 'futures') return toFuturesSymbol(symbol);
  return toExchangeSymbol(symbol);
}

export type ParsedPair = {
  symbol: string;
  base: string;
  quote: string;
  quoteWire: string;
};

/** Parse API wire symbol → { symbol, base, quote, quoteWire }. */
export function parsePairFromApiSymbol(apiSym: string): ParsedPair {
  const s = String(apiSym || '').toUpperCase();
  if (s.endsWith('IBO') && s.length > 3) {
    return { symbol: s, base: s.slice(0, -3), quote: 'IBO', quoteWire: 'IBO' };
  }
  if (s.endsWith('USDT') && s.length > 4) {
    return { symbol: s, base: s.slice(0, -4), quote: 'USDT', quoteWire: 'USDT' };
  }
  return { symbol: s, base: s.replace(/USDT$/, ''), quote: 'USDT', quoteWire: 'USDT' };
}

export function displayAssetTicker(ticker: string): string {
  return String(ticker || '').toUpperCase();
}

export function displayQuoteLabel(quote: string): string {
  return String(quote || 'USDT').toUpperCase();
}

export function walletBalanceAssetForQuote(quote: string): string {
  return String(quote || 'USDT').toUpperCase();
}

export function parsePairLabel(symbol: string): { base: string; quote: string } {
  const { base, quote } = parsePairFromApiSymbol(symbol);
  return { base: displayAssetTicker(base), quote: displayQuoteLabel(quote) };
}

/** IBOUSDT uses the internal mock-market engine (not the generic IBO ticker channel). */
export function isInternalMxbUsdtPair(symbol: string): boolean {
  return toExchangeSymbol(symbol) === 'IBOUSDT';
}

/** Pre-list / demo USDT pairs — backend synthetic market (not on Binance). */
export function isInternalMockUsdtPair(symbol: string): boolean {
  return toExchangeSymbol(symbol) === 'MIDASUSDT';
}

/** `DOTIBO` → `DOT/IBO` */
export function displayPairSlash(apiSymbol: string): string {
  const { base, quote } = parsePairFromApiSymbol(apiSymbol);
  return `${base}/${quote}`;
}

/** Alias used by chart screens (maxbyte parity). */
export function formatPairLabel(symbol: string): string {
  return displayPairSlash(symbol);
}

export function isIboQuotedSymbol(sym: string): boolean {
  const s = toExchangeSymbol(sym);
  return Boolean(s && /^[A-Z0-9]{2,12}IBO$/.test(s) && s !== 'IBOIBO');
}

export function isSyntheticSpotSymbol(symbol: string): boolean {
  const s = toExchangeSymbol(symbol);
  return s === 'IBOUSDT' || isIboQuotedSymbol(s);
}

/** True for IBOUSDT and any *IBO-quoted pair — these use the IBO mock market engine. */
export function isIboMockMarketSymbol(symbol: string): boolean {
  const s = toExchangeSymbol(symbol);
  return s === 'IBOUSDT' || isIboQuotedSymbol(s);
}

/**
 * Convert an IBO internal symbol to a TradingView symbol string.
 *
 * Rules:
 *  - Spot BTCUSDT           → "BINANCE:BTCUSDT"
 *  - Futures BTCUSDT-PERP   → "BYBIT:BTCUSDTPERP"
 *  - IBO-quoted DOTIBO      → "BINANCE:DOTUSDT"  (fallback to USDT pair)
 *  - IBOUSDT                → "BINANCE:IBOUSDT"  (IBO token against USDT)
 *
 * Exchange prefix can be overridden via `exchange` param.
 */
export function toTradingViewSymbol(
  symbol: string,
  market: 'spot' | 'futures' | 'options' = 'spot',
  exchange = 'BINANCE',
): string {
  const s = String(symbol || '').toUpperCase().trim();

  // Futures perpetual → Bybit format
  if (market === 'futures' || s.endsWith('-PERP')) {
    const base = toSpotSymbol(s); // strip -PERP
    return `BYBIT:${base}PERP`;
  }

  // IBO-quoted pair: convert quote to USDT for charting
  if (isIboQuotedSymbol(s)) {
    const { base } = parsePairFromApiSymbol(s);
    return `${exchange}:${base}USDT`;
  }

  // Standard spot / options underlying
  const spot = toExchangeSymbol(s);
  return `${exchange}:${spot}`;
}
