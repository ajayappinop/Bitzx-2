export type FuturesOrderType =
  | 'limit'
  | 'market'
  | 'stop_limit'
  | 'stop_market'
  | 'take_profit';

/**
 * Effective price for futures % slider / qty sizing across all order types.
 * Market-like orders use BBO; limit-like orders use typed price with mark/BBO fallback.
 */
export function resolveFuturesFillPrice(opts: {
  orderType: FuturesOrderType;
  side: 'buy' | 'sell';
  limitPx: number;
  markPx: number;
  lastPx?: number;
  topBid?: number;
  topAsk?: number;
}): number {
  const {
    orderType, side, limitPx, markPx, lastPx = 0, topBid = 0, topAsk = 0,
  } = opts;
  const marketLike = orderType === 'market'
    || orderType === 'stop_market'
    || orderType === 'take_profit';

  if (marketLike) {
    if (side === 'buy') return topAsk || markPx || lastPx || topBid || 0;
    return topBid || markPx || lastPx || topAsk || 0;
  }

  if (limitPx > 0) return limitPx;
  if (markPx > 0) return markPx;
  if (side === 'buy') return topAsk || lastPx || 0;
  return topBid || lastPx || 0;
}

/**
 * Price for % slider / max-qty sizing. Open-tab market uses mark/mid so long & short
 * CTAs share the same filled amount; close tab and limit orders are side/price aware.
 */
export function resolveSizingFillPx(opts: {
  orderType: FuturesOrderType;
  side: 'buy' | 'sell';
  openCloseTab: 'open' | 'close';
  limitPx: number;
  markPx: number;
  lastPx?: number;
  topBid?: number;
  topAsk?: number;
}): number {
  const {
    orderType, side, openCloseTab, limitPx, markPx, lastPx = 0, topBid = 0, topAsk = 0,
  } = opts;
  const marketLike = orderType === 'market'
    || orderType === 'stop_market'
    || orderType === 'take_profit';

  if (marketLike) {
    if (openCloseTab === 'open') {
      const mid = topBid > 0 && topAsk > 0 ? (topBid + topAsk) / 2 : 0;
      return markPx || lastPx || mid || topAsk || topBid || 0;
    }
    if (side === 'buy') return topAsk || markPx || lastPx || topBid || 0;
    return topBid || markPx || lastPx || topAsk || 0;
  }

  if (limitPx > 0) return limitPx;
  return markPx || lastPx || (side === 'buy' ? (topAsk || topBid) : (topBid || topAsk)) || 0;
}

/**
 * Resolve an effective price for % slider sizing — mirrors web TradeForm setPct logic
 * but falls back to mark / BBO when limit price is not entered yet.
 */
export function resolveTradeFillPrice(opts: {  orderType: 'market' | 'limit';
  side: 'buy' | 'sell';
  markPx: number;
  limitPx: number;
  topBid?: number | null;
  topAsk?: number | null;
}): number {
  const { orderType, side, markPx, limitPx, topBid, topAsk } = opts;

  if (orderType === 'market') {
    if (side === 'buy' && topAsk && topAsk > 0) return topAsk;
    if (side === 'sell' && topBid && topBid > 0) return topBid;
    if (markPx > 0) return markPx;
    return 0;
  }

  if (limitPx > 0) return limitPx;
  if (markPx > 0) return markPx;
  if (side === 'buy' && topAsk && topAsk > 0) return topAsk;
  if (side === 'sell' && topBid && topBid > 0) return topBid;
  return 0;
}
