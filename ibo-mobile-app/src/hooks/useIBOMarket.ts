import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { API_URL } from '../config/env';
import { exchangeWsPath } from '../config/wsConfig';
import { wsService } from '../services/websocket.service';
import { normalizeOrderBook } from '../utils/orderbook';
import type { OrderBook } from '../types/market.types';

const MAX_TRADES = 50;
const MAX_CANDLES = 500;

type IboTicker = Record<string, unknown> | null;

type Options = {
  symbol?: string;
  interval?: string;
  enabled?: boolean;
};

export function useIBOMarket({
  symbol = 'IBOUSDT',
  interval = '1m',
  enabled = true,
}: Options = {}) {
  const [candles, setCandles] = useState<Record<string, unknown>[]>([]);
  const [orderbook, setOrderbook] = useState<OrderBook>({ bids: [], asks: [] });
  const [trades, setTrades] = useState<Record<string, unknown>[]>([]);
  const [ticker, setTicker] = useState<IboTicker>(null);
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pendingObRef = useRef<OrderBook | null>(null);
  const obRafRef = useRef<number | null>(null);

  const scheduleObUpdate = useCallback((ob: OrderBook) => {
    pendingObRef.current = ob;
    if (obRafRef.current != null) return;
    obRafRef.current = requestAnimationFrame(() => {
      obRafRef.current = null;
      if (pendingObRef.current) {
        setOrderbook(pendingObRef.current);
        pendingObRef.current = null;
      }
    });
  }, []);

  useEffect(() => {
    setCandles([]);
    setOrderbook({ bids: [], asks: [] });
    setTrades([]);
    setTicker(null);
    setError(null);
    if (obRafRef.current != null) cancelAnimationFrame(obRafRef.current);
    pendingObRef.current = null;
  }, [symbol, interval]);

  useEffect(() => {
    if (!enabled) return undefined;
    const sym = String(symbol).toUpperCase();
    const iv = String(interval).toLowerCase();
    let dead = false;
    const ctrl = new AbortController();

    async function bootstrap() {
      setLoading(true);
      setError(null);
      try {
        const base = `${API_URL}/api/ibo`;
        const [cRes, obRes, trRes, tkRes] = await Promise.all([
          fetch(`${base}/candles?symbol=${encodeURIComponent(sym)}&interval=${encodeURIComponent(iv)}&limit=200`, { signal: ctrl.signal }),
          fetch(`${base}/orderbook?symbol=${encodeURIComponent(sym)}`, { signal: ctrl.signal }),
          fetch(`${base}/trades?symbol=${encodeURIComponent(sym)}&limit=20`, { signal: ctrl.signal }),
          fetch(`${base}/ticker?symbol=${encodeURIComponent(sym)}`, { signal: ctrl.signal }),
        ]);
        if (dead) return;
        const bad = [cRes, obRes, trRes, tkRes].find((r) => !r.ok);
        if (bad) throw new Error(`Market API ${bad.status}`);
        const [cData, obData, trData, tkData] = await Promise.all([
          cRes.json(), obRes.json(), trRes.json(), tkRes.json(),
        ]);
        if (dead) return;
        setCandles(Array.isArray(cData) ? cData : []);
        scheduleObUpdate(normalizeOrderBook(obData));
        setTrades(Array.isArray(trData) ? trData : []);
        setTicker(tkData && typeof tkData === 'object' ? tkData : null);
      } catch (err) {
        if (dead || (err as Error).name === 'AbortError') return;
        setError((err as Error).message || 'Failed to load market data');
      } finally {
        if (!dead) setLoading(false);
      }
    }

    void bootstrap();

    const wsUrl = exchangeWsPath(`/api/ws/ibo-market?symbol=${encodeURIComponent(sym)}&interval=${encodeURIComponent(iv)}`);
    wsService.subscribe(wsUrl, (raw: unknown) => {
      const msg = raw as Record<string, unknown>;
      if (!msg || typeof msg !== 'object') return;
      switch (msg.type) {
        case 'snapshot':
          setCandles(Array.isArray(msg.candles) ? msg.candles as Record<string, unknown>[] : []);
          if (msg.orderbook) scheduleObUpdate(normalizeOrderBook(msg.orderbook));
          setTrades(Array.isArray(msg.trades) ? msg.trades as Record<string, unknown>[] : []);
          setTicker((msg.ticker as IboTicker) ?? null);
          setConnected(true);
          setLoading(false);
          break;
        case 'candle':
          if (!msg.candle) break;
          setCandles((prev) => {
            const c = msg.candle as Record<string, unknown>;
            const next = [...prev];
            const idx = next.findIndex((x) => Number(x.time) === Number(c.time));
            if (idx >= 0) next[idx] = c;
            else next.push(c);
            return next.length > MAX_CANDLES ? next.slice(-MAX_CANDLES) : next;
          });
          break;
        case 'ticker':
          setTicker(msg as IboTicker);
          break;
        case 'orderbook':
          scheduleObUpdate(normalizeOrderBook(msg));
          break;
        case 'trade':
          setTrades((prev) => [msg, ...prev].slice(0, MAX_TRADES));
          break;
        default:
          break;
      }
    });

    return () => {
      dead = true;
      ctrl.abort();
      setConnected(false);
      wsService.unsubscribe(wsUrl);
      if (obRafRef.current != null) cancelAnimationFrame(obRafRef.current);
    };
  }, [symbol, interval, enabled, scheduleObUpdate]);

  return useMemo(
    () => ({ candles, orderbook, trades, ticker, connected, loading, error }),
    [candles, orderbook, trades, ticker, connected, loading, error],
  );
}

export default useIBOMarket;
