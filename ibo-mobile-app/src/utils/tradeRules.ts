/**
 * Client-side spot order rules — aligned with web tradeRules.js and backend.
 */
import {
  isIboQuotedSymbol,
  parsePairFromApiSymbol,
  toExchangeSymbol,
} from './tradeSymbols';

export const MIN_BASE_AMOUNT = 0.0001;
export const MIN_ORDER_VALUE = 1.0;
export const MIN_CLOSE_ORDER_VALUE = 0.01;
export const MARKET_BUY_LOCK_BUFFER = 1.005;
export const MAX_ORDER_BASE_QTY = 1e14;
export const MAX_LIMIT_PRICE = 1e15;

const KNOWN_SYMBOLS = new Set([
  'IBOUSDT', 'BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'XRPUSDT',
  'DOGEUSDT', 'ADAUSDT', 'POLUSDT', 'AVAXUSDT', 'DOTUSDT', 'LINKUSDT', 'LTCUSDT',
  'BTCIBO', 'ETHIBO', 'BNBIBO', 'SOLIBO', 'XRPIBO', 'DOGEIBO',
]);

export function isAllowedTradeSymbol(symbol: string): boolean {
  const sym = toExchangeSymbol(symbol);
  if (KNOWN_SYMBOLS.has(sym) || isIboQuotedSymbol(sym)) return true;
  if (/^[A-Z0-9]{2,12}USDT$/.test(sym)) return true;
  return false;
}

export function parseAmount(str: string | null | undefined): number | null {
  if (str === '' || str == null) return null;
  const n = parseFloat(String(str).replace(/,/g, '').trim());
  return Number.isFinite(n) ? n : null;
}

export function parseLimitPrice(str: string | null | undefined): number | null {
  if (str === '' || str == null) return null;
  const n = parseFloat(String(str).replace(/,/g, '').trim());
  return Number.isFinite(n) ? n : null;
}

export function parseMarketReferencePrice(currentPrice: number | string | null | undefined): number | null {
  if (currentPrice == null || currentPrice === '') return null;
  if (typeof currentPrice === 'number') {
    return Number.isFinite(currentPrice) && currentPrice > 0 ? currentPrice : null;
  }
  const s = String(currentPrice).trim().replace(/,/g, '');
  if (!s || s === '—' || s === '-') return null;
  const n = parseFloat(s);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

export type SpotOrderErrors = Partial<Record<'symbol' | 'amount' | 'price' | 'total' | 'balance', string>>;

export function validateSpotOrder(opts: {
  symbol: string;
  side: 'buy' | 'sell';
  type: 'limit' | 'market';
  amountStr: string;
  priceStr: string;
  currentPrice: number | string | null | undefined;
  balanceQuote: number;
  balanceBase: number;
  baseAsset: string;
  quoteAsset?: string;
  userLoggedIn?: boolean;
}): { ok: boolean; errors: SpotOrderErrors; message: string | null; qty: number | null; effPrice: number | null } {
  const {
    symbol, side, type, amountStr, priceStr, currentPrice,
    balanceQuote, balanceBase, baseAsset,
    quoteAsset = 'USDT',
    userLoggedIn = true,
  } = opts;
  const quote = String(quoteAsset || 'USDT').toUpperCase();
  const errors: SpotOrderErrors = {};
  const sym = toExchangeSymbol(symbol);

  if (!isAllowedTradeSymbol(sym)) {
    errors.symbol = 'Unsupported or invalid trading pair.';
  }

  const qty = parseAmount(amountStr);
  if (qty == null || qty <= 0) {
    errors.amount = `Enter amount (min ${MIN_BASE_AMOUNT} ${baseAsset}).`;
  } else if (qty < MIN_BASE_AMOUNT) {
    errors.amount = `Minimum size is ${MIN_BASE_AMOUNT} ${baseAsset}.`;
  } else if (qty > MAX_ORDER_BASE_QTY) {
    errors.amount = `Amount is too large. Enter a value below ${MAX_ORDER_BASE_QTY.toExponential(0)} ${baseAsset}.`;
  }

  const isMarket = type === 'market';
  let effPrice: number | null = null;
  if (isMarket) {
    effPrice = parseMarketReferencePrice(currentPrice);
    if (effPrice == null || effPrice <= 0) {
      errors.price = 'Wait for the live price to load, then try again.';
    }
  } else {
    const px = parseLimitPrice(priceStr);
    if (px == null || px <= 0) {
      errors.price = 'Enter a limit price greater than zero.';
    } else if (px > MAX_LIMIT_PRICE) {
      errors.price = `Limit price is unrealistically high (max ${MAX_LIMIT_PRICE.toExponential(0)}).`;
    } else {
      effPrice = px;
    }
  }

  if (qty != null && qty >= MIN_BASE_AMOUNT && effPrice != null && effPrice > 0) {
    const orderValue = effPrice * qty;
    if (orderValue < MIN_ORDER_VALUE) {
      const yours = orderValue.toFixed(4);
      errors.total = quote === 'USDT'
        ? `Minimum order value is $${MIN_ORDER_VALUE.toFixed(2)} USDT (yours ≈ $${yours}).`
        : `Minimum order value is ${MIN_ORDER_VALUE.toFixed(2)} ${quote} (yours ≈ ${yours} ${quote}).`;
    }
  }

  if (userLoggedIn) {
    const base = Number(balanceBase);
    const quoteBal = Number(balanceQuote);
    if (side === 'buy' && qty != null && effPrice != null && effPrice > 0 && Number.isFinite(quoteBal)) {
      const lockPx = isMarket ? effPrice * MARKET_BUY_LOCK_BUFFER : effPrice;
      const need = lockPx * qty;
      if (need > quoteBal + 1e-12) {
        errors.balance =
          `Insufficient ${quote}. Need ≈ ${need.toFixed(4)} ${quote} locked` +
          (isMarket ? ` (includes ${((MARKET_BUY_LOCK_BUFFER - 1) * 100).toFixed(1)}% buffer on market buys).` : '.');
      }
    }
    if (side === 'sell' && qty != null && Number.isFinite(base)) {
      if (qty > base + 1e-12) {
        errors.balance = `Insufficient ${baseAsset}. Available: ${base.toFixed(8)}.`;
      }
    }
  }

  const keys: (keyof SpotOrderErrors)[] = ['symbol', 'amount', 'price', 'total', 'balance'];
  let message: string | null = null;
  for (const k of keys) {
    if (errors[k]) {
      message = errors[k] ?? null;
      break;
    }
  }

  return {
    ok: Object.keys(errors).length === 0,
    errors,
    message,
    qty,
    effPrice,
  };
}

/** Wire symbol for order API from display or route input. */
export function resolveOrderSymbol(symbol: string): string {
  return parsePairFromApiSymbol(symbol).symbol;
}
