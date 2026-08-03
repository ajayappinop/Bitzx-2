/**
 * Client-side spot / market order rules — aligned with backend/server.py:
 * MIN_BASE_AMOUNT = 0.0001, MIN_ORDER_VALUE_USDT = 1.0,
 * market buy lock ≈ market_price * 1.005
 */
import { PAIRS, isIboQuotedRouteSymbol } from '@/services/marketApi';

export const MIN_BASE_AMOUNT = 0.0001;
export const MIN_ORDER_VALUE_USDT = 1.0;
/** Backend `MIN_ORDER_VALUE_USDT_CLOSE` for `/portfolio/close_position`. */
export const MIN_CLOSE_ORDER_VALUE_USDT = 0.01;
/** Matches backend lock_px for market buys (limit_px == 0). */
export const MARKET_BUY_LOCK_BUFFER = 1.005;
/** Reject absurd inputs before API (backend has no explicit max). */
export const MAX_ORDER_BASE_QTY = 1e14;
export const MAX_LIMIT_PRICE_USDT = 1e15;

const ALLOWED_SYMBOLS = new Set(PAIRS.map(p => p.symbol));

export function isAllowedTradeSymbol(symbol) {
  if (!symbol || typeof symbol !== 'string') return false;
  const sym = symbol.toUpperCase();
  return ALLOWED_SYMBOLS.has(sym) || isIboQuotedRouteSymbol(sym);
}

export function parseAmount(str) {
  if (str === '' || str == null) return null;
  const n = parseFloat(String(str).replace(/,/g, '').trim());
  if (!Number.isFinite(n)) return null;
  return n;
}

export function parseLimitPrice(str) {
  if (str === '' || str == null) return null;
  const n = parseFloat(String(str).replace(/,/g, '').trim());
  if (!Number.isFinite(n)) return null;
  return n;
}

export function parseMarketReferencePrice(currentPrice) {
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

/**
 * @returns {{ ok: boolean, errors: Record<string, string>, message: string|null, qty: number|null, effPrice: number|null }}
 */
export function validateSpotOrder({
  symbol,
  side,
  type,
  amountStr,
  priceStr,
  currentPrice,
  balanceUSDT,
  balanceBase,
  baseAsset,
  quoteAsset = 'USDT',
  balanceQuote,
  balanceIBO,
  feeRate,
  iboPriceUsdt,
  userLoggedIn,
}) {
  const quote = (quoteAsset || 'USDT').toUpperCase();
  const quoteBal = balanceQuote != null ? Number(balanceQuote) : Number(balanceUSDT);
  const errors = {};
  const sym = (symbol || '').toUpperCase();

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
  let effPrice = null;
  if (isMarket) {
    effPrice = parseMarketReferencePrice(currentPrice);
    if (effPrice == null || effPrice <= 0) {
      errors.price = 'Wait for the live price to load, then try again.';
    }
  } else {
    const px = parseLimitPrice(priceStr);
    if (px == null || px <= 0) {
      errors.price = 'Enter a limit price greater than zero.';
    } else if (px > MAX_LIMIT_PRICE_USDT) {
      errors.price = `Limit price is unrealistically high (max ${MAX_LIMIT_PRICE_USDT.toExponential(0)} USDT).`;
    } else {
      effPrice = px;
    }
  }

  if (qty != null && qty >= MIN_BASE_AMOUNT && effPrice != null && effPrice > 0) {
    const orderValue = effPrice * qty;
    if (orderValue < MIN_ORDER_VALUE_USDT) {
      const yours = orderValue.toFixed(4);
      errors.total =
        quote === 'USDT'
          ? `Minimum order value is $${MIN_ORDER_VALUE_USDT.toFixed(2)} USDT (yours ≈ $${yours}).`
          : `Minimum order value is ${MIN_ORDER_VALUE_USDT.toFixed(2)} ${quote} (yours ≈ ${yours} ${quote}).`;
    }
  }

  if (userLoggedIn) {
    const base = Number(balanceBase);
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
    if (
      !errors.balance &&
      qty != null &&
      qty > 0 &&
      effPrice != null &&
      effPrice > 0 &&
      Number.isFinite(Number(balanceIBO)) &&
      Number.isFinite(Number(feeRate))
    ) {
      const quoteNotional = effPrice * qty;
      const q = (quote || 'USDT').toUpperCase();
      const feeIbo =
        q === 'IBO'
          ? quoteNotional * Number(feeRate)
          : quoteNotional * Number(feeRate) / Math.max(Number(iboPriceUsdt) || 0, 1e-12);
      const iboBal = Number(balanceIBO) || 0;
      if (feeIbo > iboBal + 1e-12) {
        errors.balance = `Insufficient IBO for fee. Need ≈ ${feeIbo.toFixed(8)} IBO, available ${iboBal.toFixed(8)} IBO.`;
      }
    }
  }

  const keys = ['symbol', 'amount', 'price', 'total', 'balance'];
  let message = null;
  for (const k of keys) {
    if (errors[k]) {
      message = errors[k];
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

/**
 * Market-only quick trade (QuickTrade page / modal).
 */
export function validateMarketQuickOrder({
  symbol,
  side,
  amountStr,
  price,
  balanceUSDT,
  balanceBase,
  baseAsset,
  balanceIBO,
  feeRate,
  iboPriceUsdt,
  userLoggedIn,
}) {
  return validateSpotOrder({
    symbol,
    side,
    type: 'market',
    amountStr,
    priceStr: '',
    currentPrice: price,
    balanceUSDT,
    balanceBase,
    baseAsset,
    balanceIBO,
    feeRate,
    iboPriceUsdt,
    userLoggedIn,
  });
}
