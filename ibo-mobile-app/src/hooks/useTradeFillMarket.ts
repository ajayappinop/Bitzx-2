import { useLayoutEffect, useRef } from 'react';
import { subscribeSpotOrderBook } from '../services/orderBookFeed.service';
import { subscribeSpotTicker } from '../services/tickerFeed.service';
import { readChartTicker } from '../utils/chartPageCache';

function parseBookPx(raw: unknown): number | null {
  const v = parseFloat(String(raw ?? ''));
  return Number.isFinite(v) && v > 0 ? v : null;
}

/**
 * Live mark + BBO in refs only — order book / ticker ticks must not re-render the trade form.
 * Used for % slider sizing while the UI reads throttled display prices separately.
 */
export function useTradeFillMarket(symbol: string, enabled: boolean) {
  const markRef = useRef(0);
  const topBidRef = useRef<number | null>(null);
  const topAskRef = useRef<number | null>(null);

  useLayoutEffect(() => {
    if (!enabled || !symbol) return undefined;

    const cached = readChartTicker(symbol);
    const cp = parseBookPx(cached?.price);
    if (cp != null) markRef.current = cp;

    const unsubTicker = subscribeSpotTicker(symbol, (t) => {
      const p = parseBookPx(t?.price);
      if (p != null) markRef.current = p;
    });

    const unsubBook = subscribeSpotOrderBook(symbol, (book) => {
      const bids = book.bids ?? [];
      const asks = book.asks ?? [];
      let bestBid: number | null = null;
      let bestAsk: number | null = null;
      for (const row of bids) {
        const p = parseBookPx(row.price);
        if (p != null && (bestBid == null || p > bestBid)) bestBid = p;
      }
      for (const row of asks) {
        const p = parseBookPx(row.price);
        if (p != null && (bestAsk == null || p < bestAsk)) bestAsk = p;
      }
      topBidRef.current = bestBid;
      topAskRef.current = bestAsk;
    });

    return () => {
      unsubTicker();
      unsubBook();
    };
  }, [symbol, enabled]);

  return { markRef, topBidRef, topAskRef };
}
