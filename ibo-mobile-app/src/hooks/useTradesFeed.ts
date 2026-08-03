import { useLayoutEffect, useRef, useState } from 'react';
import { readChartTrades, type ChartTradeSnapshot } from '../utils/chartPageCache';
import { subscribeSpotTrades } from '../services/tradesFeed.service';

export function useSpotTradesFeed(symbol: string) {
  const symRef = useRef(symbol);
  symRef.current = symbol;

  const [trades, setTrades] = useState<ChartTradeSnapshot[]>(
    () => readChartTrades(symbol) ?? [],
  );
  const [loading, setLoading] = useState(
    () => (readChartTrades(symbol) ?? []).length === 0,
  );

  useLayoutEffect(() => {
    const cached = readChartTrades(symbol) ?? [];
    setTrades(cached);
    setLoading(cached.length === 0);

    return subscribeSpotTrades(symbol, (rows) => {
      if (symRef.current !== symbol) return;
      if (rows.length) {
        setTrades(rows);
        setLoading(false);
      }
    });
  }, [symbol]);

  return { trades, loading };
}
