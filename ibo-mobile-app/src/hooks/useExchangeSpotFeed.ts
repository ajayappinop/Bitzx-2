import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { marketApi } from '../api/market.api';
import { exchangeWsPath } from '../config/wsConfig';
import { wsService } from '../services/websocket.service';
import { normalizeOrderBook } from '../utils/orderbook';
import { extractSpotTicker } from '../utils/futuresQuotes';
import type { OrderBook } from '../types/market.types';
import type { MobileTicker } from '../utils/iboTicker';

type Options = { enabled?: boolean };

export function useExchangeSpotFeed(symbol: string, { enabled = true }: Options = {}) {
  const sym = String(symbol || '').toUpperCase();
  const [ticker, setTicker] = useState<MobileTicker | null>(null);
  const [orderBook, setOrderBook] = useState<OrderBook>({ bids: [], asks: [] });
  const lastPriceRef = useRef(0);

  const refresh = useCallback(async () => {
    if (!sym) return;
    try {
      const [tkRes, obRes] = await Promise.all([
        marketApi.getTicker(sym),
        marketApi.getOrderBook(sym),
      ]);
      const spot = extractSpotTicker(tkRes.data);
      if (spot.price > 0) lastPriceRef.current = spot.price;
      setTicker({
        symbol: sym,
        price: spot.price,
        changePct: spot.changePct ?? 0,
        volume: Number((tkRes.data as Record<string, unknown>)?.volume ?? 0),
        high: Number((tkRes.data as Record<string, unknown>)?.highPrice ?? 0) || undefined,
        low: Number((tkRes.data as Record<string, unknown>)?.lowPrice ?? 0) || undefined,
      });
      setOrderBook(obRes.data);
    } catch {
      /* keep last WS values */
    }
  }, [sym]);

  useEffect(() => {
    if (!enabled || !sym) return undefined;
    setTicker(null);
    setOrderBook({ bids: [], asks: [] });
    void refresh();

    const tickerUrl = exchangeWsPath(`/api/ws/ticker?symbol=${encodeURIComponent(sym)}`);
    const bookUrl = exchangeWsPath(`/api/ws/orderbook?symbol=${encodeURIComponent(sym)}`);

    wsService.subscribe(tickerUrl, (msg: unknown) => {
      const m = msg as Record<string, unknown>;
      const spot = extractSpotTicker(m.ticker ?? m);
      if (spot.price > 0) lastPriceRef.current = spot.price;
      setTicker((prev) => ({
        symbol: sym,
        price: spot.price || prev?.price || 0,
        changePct: spot.changePct ?? prev?.changePct ?? 0,
        volume: Number(m.volume ?? prev?.volume ?? 0),
        high: Number(m.highPrice ?? prev?.high ?? 0) || prev?.high,
        low: Number(m.lowPrice ?? prev?.low ?? 0) || prev?.low,
      }));
    });

    wsService.subscribe(bookUrl, (msg: unknown) => {
      const m = msg as Record<string, unknown>;
      setOrderBook(normalizeOrderBook(m.orderbook ?? m));
    });

    return () => {
      wsService.unsubscribe(tickerUrl);
      wsService.unsubscribe(bookUrl);
    };
  }, [sym, enabled, refresh]);

  return useMemo(
    () => ({ ticker, orderBook, lastPriceRef, refresh }),
    [ticker, orderBook, refresh],
  );
}
