/**
 * useIBOMarket — real-time Delta pair market data hook.
 *
 * Flow
 * ────
 * 1. REST bootstrap loads initial candles / orderbook / trades / ticker.
 * 2. WebSocket immediately follows for live streaming.
 * 3. WS snapshot (server sends on connect) replaces REST data if it arrives
 *    before we finish REST (last-write-wins — both carry same data anyway).
 *
 * No price-ratio scaling
 * ──────────────────────
 * The backend guarantees that the open candle's close == ticker.price at all
 * times (the `candles()` API always returns `close = st.price`).  Therefore
 * there is never a mismatch between candle prices and the live ticker, and we
 * can use raw prices from the server without any client-side scaling.
 * Removing the ratio is what makes the chart look identical on every refresh.
 *
 * Edge cases handled
 * ──────────────────
 * • Symbol / interval change  → abort in-flight requests, close WS, clear state.
 * • WS close code 4403        → mock market disabled on server; show error, no retry.
 * • WS close code 4400        → unsupported symbol; show error, no retry.
 * • Exponential back-off retry with NO hard cap (max 30 s delay).
 * • `{type:"ping"}` heartbeat → silently ignored.
 * • Orderbook updates batched via requestAnimationFrame.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { exchangeApiOrigin } from '@/lib/apiBase';
import { exchangeWsPath } from '@/services/marketApi';

const API = exchangeApiOrigin(import.meta.env.VITE_BACKEND_URL);
const MAX_TRADES = 50;
const MAX_CANDLES_KEPT = 500;

// ── Hook ─────────────────────────────────────────────────────────────────────
export function useIBOMarket({ symbol = 'IBOUSDT', interval = '1m', enabled = true } = {}) {
  const [candles,   setCandles]   = useState([]);
  const [orderbook, setOrderbook] = useState({ bids: [], asks: [] });
  const [trades,    setTrades]    = useState([]);
  const [ticker,    setTicker]    = useState(null);
  const [connected, setConnected] = useState(false);
  const [loading,   setLoading]   = useState(false);
  const [error,     setError]     = useState(null);

  const wsRef        = useRef(null);
  const reconnectRef = useRef(null);
  const retryRef     = useRef(0);
  // rAF handle for batched orderbook updates
  const obRafRef     = useRef(null);
  const pendingObRef = useRef(null);

  // Flush pending orderbook update on next animation frame.
  const scheduleObUpdate = useCallback((ob) => {
    pendingObRef.current = ob;
    if (obRafRef.current) return;
    obRafRef.current = requestAnimationFrame(() => {
      obRafRef.current = null;
      if (pendingObRef.current) {
        setOrderbook(pendingObRef.current);
        pendingObRef.current = null;
      }
    });
  }, []);

  // ── Clear state on symbol / interval change ───────────────────────────────
  useEffect(() => {
    setCandles([]);
    setOrderbook({ bids: [], asks: [] });
    setTrades([]);
    setTicker(null);
    setError(null);
    if (obRafRef.current) { cancelAnimationFrame(obRafRef.current); obRafRef.current = null; }
    pendingObRef.current = null;
  }, [symbol, interval]);

  // ── Bootstrap + WebSocket lifecycle ──────────────────────────────────────
  useEffect(() => {
    if (!enabled) return undefined;

    const sym = String(symbol).toUpperCase();
    const iv  = String(interval).toLowerCase();
    const ctrl = new AbortController();
    let dead = false;
    let noRetry = false; // set true on fatal WS close codes

    // ── REST bootstrap ────────────────────────────────────────────────────
    async function bootstrap() {
      setLoading(true);
      setError(null);
      try {
        const base = `${API}/api/ibo`;
        const [cRes, obRes, trRes, tkRes] = await Promise.all([
          fetch(`${base}/candles?symbol=${encodeURIComponent(sym)}&interval=${encodeURIComponent(iv)}&limit=200`, { signal: ctrl.signal }),
          fetch(`${base}/orderbook?symbol=${encodeURIComponent(sym)}`, { signal: ctrl.signal }),
          fetch(`${base}/trades?symbol=${encodeURIComponent(sym)}&limit=20`,  { signal: ctrl.signal }),
          fetch(`${base}/ticker?symbol=${encodeURIComponent(sym)}`,  { signal: ctrl.signal }),
        ]);
        if (dead) return;

        // Surface the first non-OK response as a human-readable error.
        const bad = [cRes, obRes, trRes, tkRes].find((r) => !r.ok);
        if (bad) {
          let msg = `Market API ${bad.status}`;
          try {
            const body = await bad.json();
            if (typeof body?.detail === 'string') msg = body.detail;
          } catch { /* ignore */ }
          throw new Error(msg);
        }

        const [cData, obData, trData, tkData] = await Promise.all([
          cRes.json(), obRes.json(), trRes.json(), tkRes.json(),
        ]);
        if (dead) return;

        const tk = tkData && typeof tkData === 'object' ? tkData : null;
        // No ratio scaling: the backend guarantees last candle close == ticker
        // price, so we use raw prices directly from the server.
        setCandles(Array.isArray(cData) ? cData : []);
        scheduleObUpdate(
          obData && typeof obData === 'object'
            ? { bids: obData.bids || [], asks: obData.asks || [] }
            : { bids: [], asks: [] },
        );
        setTrades(Array.isArray(trData) ? trData : []);
        setTicker(tk);
        setLoading(false);
      } catch (err) {
        if (dead || err.name === 'AbortError') return;
        setError(err.message || 'Failed to load market data');
        setLoading(false);
      }
    }

    // ── WebSocket connection ──────────────────────────────────────────────
    function connectWS() {
      if (dead || noRetry) return;
      const url = exchangeWsPath(
        `/api/ws/ibo-market?symbol=${encodeURIComponent(sym)}&interval=${encodeURIComponent(iv)}`,
      );
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        retryRef.current = 0;
        setConnected(true);
        setError(null);
      };

      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data);
          if (!msg || typeof msg !== 'object') return;

          switch (msg.type) {
            // ── Full snapshot (sent immediately after connect) ──────────
            case 'snapshot': {
              const tk = msg.ticker || null;
              setCandles(Array.isArray(msg.candles) ? msg.candles : []);
              scheduleObUpdate(
                msg.orderbook && typeof msg.orderbook === 'object'
                  ? { bids: msg.orderbook.bids || [], asks: msg.orderbook.asks || [] }
                  : { bids: [], asks: [] },
              );
              setTrades(Array.isArray(msg.trades) ? msg.trades : []);
              setTicker(tk);
              setLoading(false);
              break;
            }

            // ── Live candle update (sent every ~4 s) ────────────────────
            case 'candle': {
              if (!msg.candle) break;
              const c = msg.candle;
              setCandles((prev) => {
                const next = [...prev];
                const idx = next.findIndex((x) => Number(x.time) === Number(c.time));
                if (idx >= 0) {
                  next[idx] = c;
                } else {
                  next.push(c);
                }
                return next.length > MAX_CANDLES_KEPT ? next.slice(-MAX_CANDLES_KEPT) : next;
              });
              break;
            }

            // ── Ticker (every ~1 s) ─────────────────────────────────────
            case 'ticker':
              setTicker(msg);
              break;

            // ── Orderbook (every ~1 s, tracks live price) ─────────────────
            case 'orderbook':
              scheduleObUpdate({ bids: msg.bids || [], asks: msg.asks || [] });
              break;

            // ── Single trade (every ~1 s) ───────────────────────────────
            case 'trade': {
              const row = { side: msg.side, price: msg.price, qty: msg.qty, timestamp: msg.timestamp };
              setTrades((prev) => [row, ...prev].slice(0, MAX_TRADES));
              break;
            }

            // ── Heartbeat ───────────────────────────────────────────────
            case 'ping':
              // No-op: WS keepalive confirmed.  Reply pong not required
              // because the server only checks send-side, not receive-side.
              break;

            default:
              break;
          }
        } catch {
          // Malformed frame — ignore silently.
        }
      };

      ws.onerror = () => {
        setConnected(false);
      };

      ws.onclose = (evt) => {
        setConnected(false);
        if (dead) return;

        // 4403 = mock market disabled server-side, 4400 = unsupported symbol.
        if (evt.code === 4403) {
          noRetry = true;
          setError('Delta mock market is disabled on the server (IBO_MOCK_MARKET=true needed).');
          return;
        }
        if (evt.code === 4400) {
          noRetry = true;
          setError(`Unsupported Delta symbol: ${sym}`);
          return;
        }

        // Exponential back-off: 1s → 2s → 4s → … → max 30s. No hard cap on
        // retry count — the hook lives as long as the component is mounted.
        retryRef.current += 1;
        const delay = Math.min(30_000, 1_000 * 2 ** (retryRef.current - 1));
        reconnectRef.current = setTimeout(() => {
          if (!dead) bootstrap().then(() => { if (!dead) connectWS(); });
        }, delay);
      };
    }

    // Initial flow: bootstrap REST data → open WS.
    bootstrap().then(() => { if (!dead) connectWS(); });

    return () => {
      dead = true;
      ctrl.abort();
      setConnected(false);
      if (reconnectRef.current) clearTimeout(reconnectRef.current);
      if (obRafRef.current) { cancelAnimationFrame(obRafRef.current); obRafRef.current = null; }
      if (wsRef.current) {
        try { wsRef.current.close(); } catch { /* noop */ }
        wsRef.current = null;
      }
    };
  }, [symbol, interval, enabled, scheduleObUpdate]);

  return useMemo(
    () => ({ candles, orderbook, trades, ticker, connected, loading, error }),
    [candles, orderbook, trades, ticker, connected, loading, error],
  );
}

export default useIBOMarket;
