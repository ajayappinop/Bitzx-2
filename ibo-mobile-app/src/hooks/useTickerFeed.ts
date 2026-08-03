import { useLayoutEffect, useRef, useState } from 'react';
import type { Ticker } from '../types/market.types';
import { readChartTicker } from '../utils/chartPageCache';
import { subscribeSpotTicker } from '../services/tickerFeed.service';

function tickerHasPrice(t: Ticker | null | undefined): boolean {
  const p = Number(t?.price ?? 0);
  return Number.isFinite(p) && p > 0;
}

export function useSpotTickerFeed(symbol: string) {
  const symRef = useRef(symbol);
  symRef.current = symbol;

  const [ticker, setTicker] = useState<Ticker | null>(() => readChartTicker(symbol));
  const [loading, setLoading] = useState(() => !tickerHasPrice(readChartTicker(symbol)));

  useLayoutEffect(() => {
    const cached = readChartTicker(symbol);
    setTicker(cached);
    setLoading(!tickerHasPrice(cached));

    return subscribeSpotTicker(symbol, (next) => {
      if (symRef.current !== symbol) return;
      setTicker(next);
      if (tickerHasPrice(next)) setLoading(false);
    });
  }, [symbol]);

  return { ticker, loading, hasPrice: tickerHasPrice(ticker) };
}
