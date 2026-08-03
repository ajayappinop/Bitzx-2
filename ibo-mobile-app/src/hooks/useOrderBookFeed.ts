import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { OrderBook } from '../types/market.types';
import type { TradeMarketType } from '../components/trading/TradeMarketHeader';
import {
  getCachedOrderBook,
  orderBookHasDepth,
} from '../utils/orderBookCache';
import { resolveDisplayOrderBook } from '../utils/orderBookDisplay';
import {
  subscribeSpotOrderBook,
  subscribeFuturesOrderBook,
  subscribeFuturesMarketMeta,
  type FuturesMarketMeta,
} from '../services/orderBookFeed.service';

function initialBook(symbol: string): OrderBook {
  return getCachedOrderBook(symbol) ?? { bids: [], asks: [] };
}

export function useSpotOrderBookFeed(symbol: string) {
  const symRef = useRef(symbol);
  symRef.current = symbol;

  const [orderBook, setOrderBook] = useState<OrderBook>(() => initialBook(symbol));
  const hasDepth = orderBookHasDepth(orderBook);

  // Subscribe in layout phase so cached depth + WS connect happen before first paint.
  useLayoutEffect(() => {
    setOrderBook(initialBook(symbol));
    return subscribeSpotOrderBook(symbol, (book) => {
      if (symRef.current !== symbol) return;
      setOrderBook(book);
    });
  }, [symbol]);

  return { orderBook, hasDepth };
}

export function useFuturesOrderBookFeed(symbol: string) {
  const symRef = useRef(symbol);
  symRef.current = symbol;

  const [orderBook, setOrderBook] = useState<OrderBook>(() => initialBook(symbol));
  const hasDepth = orderBookHasDepth(orderBook);

  useLayoutEffect(() => {
    setOrderBook(initialBook(symbol));
    return subscribeFuturesOrderBook(symbol, (book) => {
      if (symRef.current !== symbol) return;
      setOrderBook(book);
    });
  }, [symbol]);

  return { orderBook, hasDepth };
}

export function useFuturesMarketMeta(symbol: string) {
  const symRef = useRef(symbol);
  symRef.current = symbol;

  const [meta, setMeta] = useState<FuturesMarketMeta>({
    mark: 0,
    index: 0,
    recentTrades: [],
  });

  useLayoutEffect(() => {
    setMeta({ mark: 0, index: 0, recentTrades: [] });
    return subscribeFuturesMarketMeta(symbol, (next) => {
      if (symRef.current !== symbol) return;
      setMeta(next);
    });
  }, [symbol]);

  return meta;
}

/** Chart page — spot + perp feeds; uses deepest book (futures often needs spot fallback). */
export function useChartOrderBookFeed(
  spotSymbol: string,
  futuresSymbol: string,
  market: TradeMarketType,
) {
  const { orderBook: spotBook } = useSpotOrderBookFeed(spotSymbol);
  const { orderBook: perpBook } = useFuturesOrderBookFeed(futuresSymbol);

  const orderBook = useMemo(
    () => resolveDisplayOrderBook(spotBook, perpBook, market),
    [spotBook, perpBook, market],
  );

  const hasDepth = orderBookHasDepth(orderBook);

  return { orderBook, hasDepth };
}
