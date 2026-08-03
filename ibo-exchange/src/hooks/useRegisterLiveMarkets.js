import { useCallback, useEffect, useRef, useState } from 'react';
import { exchangeWsPath, marketApi, normalizeMarketsList } from '@/services/marketApi';

export const REGISTER_PREVIEW_PAIRS = ['BTCUSDT', 'ETHUSDT', 'IBOUSDT', 'SOLUSDT'];

function rowsFromMap(map) {
  return REGISTER_PREVIEW_PAIRS.map((sym) => map.get(sym)).filter(Boolean);
}

function mergeTickerRow(symbol, ticker, prev) {
  if (!ticker) return prev;
  return {
    symbol,
    price: ticker.price ?? prev?.price,
    priceChangePercent: ticker.priceChangePercent ?? prev?.priceChangePercent,
  };
}

/** Live register-page market rows via REST bootstrap + per-symbol ticker WebSockets. */
export function useRegisterLiveMarkets() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const mapRef = useRef(new Map());

  const publish = useCallback(() => {
    setRows(rowsFromMap(mapRef.current));
    setLoading(false);
  }, []);

  const applyTicker = useCallback((symbol, ticker) => {
    const prev = mapRef.current.get(symbol);
    const next = mergeTickerRow(symbol, ticker, prev);
    if (!next?.price) return;
    mapRef.current.set(symbol, next);
    publish();
  }, [publish]);

  useEffect(() => {
    let cancelled = false;

    marketApi.getMarkets().then((list) => {
      if (cancelled) return;
      for (const row of normalizeMarketsList(list)) {
        if (REGISTER_PREVIEW_PAIRS.includes(row.symbol)) {
          mapRef.current.set(row.symbol, row);
        }
      }
      if (mapRef.current.size) publish();
      else setLoading(false);
    }).catch(() => {
      if (!cancelled) setLoading(false);
    });

    const cleanups = REGISTER_PREVIEW_PAIRS.map((symbol) => {
      let closed = false;
      let reconnectTimer = null;
      let pingTimer = null;
      let ws = null;

      const connect = () => {
        if (closed || cancelled) return;
        const qs = new URLSearchParams({ symbol });
        ws = new WebSocket(exchangeWsPath(`/api/ws/exchange/ticker?${qs.toString()}`));

        ws.onopen = () => {
          pingTimer = window.setInterval(() => {
            if (ws?.readyState === WebSocket.OPEN) {
              try {
                ws.send('ping');
              } catch {
                /* ignore */
              }
            }
          }, 25000);
        };

        ws.onmessage = (ev) => {
          try {
            const j = JSON.parse(ev.data);
            if (j.type === 'exchange_ticker' && j.ticker) {
              applyTicker(symbol, j.ticker);
            }
          } catch {
            /* ignore */
          }
        };

        ws.onerror = () => {
          try {
            ws?.close();
          } catch {
            /* ignore */
          }
        };

        ws.onclose = () => {
          ws = null;
          if (pingTimer) {
            window.clearInterval(pingTimer);
            pingTimer = null;
          }
          if (!closed && !cancelled) {
            reconnectTimer = window.setTimeout(connect, 3000);
          }
        };
      };

      connect();

      return () => {
        closed = true;
        if (reconnectTimer) window.clearTimeout(reconnectTimer);
        if (pingTimer) window.clearInterval(pingTimer);
        if (ws) {
          try {
            ws.close();
          } catch {
            /* ignore */
          }
        }
      };
    });

    return () => {
      cancelled = true;
      cleanups.forEach((fn) => fn());
    };
  }, [applyTicker, publish]);

  return { rows, loading };
}
