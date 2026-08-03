import { createContext, useContext, useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { useAuth } from '@/context/AuthContext';
import {
  futuresApi,
  openAccountWs,
  openMarketsWs,
  openOrderbookWs,
} from '@/services/futuresApi';

/**
 * FuturesContext
 *
 * Source of truth contract:
 *   - The URL (`/futures/:symbol`) owns the active symbol.
 *   - Page calls `setActiveSymbol(symbol)` whenever `useParams().symbol` changes.
 *   - The provider does NOT mutate the URL on its own (that caused the
 *     pair-switch race — selecting a new symbol re-mounted the WS, which
 *     synced the old cache back to the URL).
 *
 * Three WebSocket feeds:
 *   - markets   (public, all symbols)  → mark/index price for header & PnL
 *   - orderbook (public, active symbol) → bids/asks/recent trades
 *   - account   (auth, per-user)       → wallet/positions/open/history
 */

const FuturesContext = createContext(null);

/** Never let a stale/null backend tick wipe live Binance prices. */
function mergeMarketTick(prev = {}, incoming = {}) {
  const out = { ...prev, ...incoming, symbol: incoming.symbol || prev.symbol };
  const pi = Number(prev.index_price);
  const pm = Number(prev.mark_price);
  const ii = Number(incoming.index_price);
  const im = Number(incoming.mark_price);
  out.index_price = ii > 0 ? ii : (pi > 0 ? pi : incoming.index_price);
  out.mark_price  = im > 0 ? im : (pm > 0 ? pm : incoming.mark_price);
  return out;
}

export function FuturesProvider({ children, initialSymbol = null }) {
  const { user } = useAuth();

  const [symbols, setSymbols] = useState([]);
  const [leverageOptions, setLeverageOptions] = useState([1, 5, 10, 20, 50, 100]);
  // Seed from URL so the page renders on the very first paint without a flash.
  const [activeSymbol, setActiveSymbol] = useState(initialSymbol);

  const [markets, setMarkets] = useState({});
  const [orderbook, setOrderbook] = useState({ bids: [], asks: [] });
  const [recentTrades, setRecentTrades] = useState([]);

  const [wallet, setWallet] = useState(null);
  const [positions, setPositions] = useState([]);
  const [openOrders, setOpenOrders] = useState([]);
  const [orderHistory, setOrderHistory] = useState([]);
  const [userTrades, setUserTrades] = useState([]);
  const [settings, setSettings] = useState({});

  // ── Catalog (load once; retry on failure) ────────────────────────────
  useEffect(() => {
    let cancelled = false;
    let retryTimer = null;

    const load = () => {
      futuresApi.listSymbols()
        .then((data) => {
          if (cancelled) return;
          const syms = data?.symbols || [];
          if (syms.length) {
            setSymbols(syms);
            setLeverageOptions(data?.leverage_options || [1, 5, 10, 20, 50, 100]);
          } else if (!cancelled) {
            // Empty response — retry after 4 s
            retryTimer = setTimeout(load, 4000);
          }
        })
        .catch(() => {
          if (!cancelled) retryTimer = setTimeout(load, 5000);
        });
    };

    load();
    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, []);

  // ── Markets WS (public, fan-out for every supported symbol) ───────────
  const marketsWsRef = useRef(null);
  useEffect(() => {
    let cancelled = false;
    let ws = null;
    let timer = null;

    const connect = () => {
      if (cancelled) return;
      ws = openMarketsWs((msg) => {
        if (msg?.type !== 'futures_markets') return;
        setMarkets((prev) => {
          const next = { ...prev };
          for (const m of msg.markets || []) {
            if (!m?.symbol) continue;
            next[m.symbol] = mergeMarketTick(prev[m.symbol], m);
          }
          return next;
        });
      });
      marketsWsRef.current = ws;
      ws.onclose = () => { if (!cancelled) timer = setTimeout(connect, 3000); };
    };
    connect();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      try { ws?.close(); } catch { /* ignore */ }
    };
  }, []);

  // ── Binance public miniTicker WS — live index prices ──────────────────
  // The backend mark-price worker may lag or be unreachable.  Binance's
  // public stream (no API key, CORS-open for WebSocket) gives us a
  // sub-second index feed directly in the browser.
  //
  // Rule: always overwrite `index_price` with the Binance live price.
  //       Only overwrite `mark_price` when the backend hasn't supplied one
  //       yet (i.e. mark_price is 0 / absent) — the backend's blended mark
  //       takes precedence for PnL / liquidation math once it arrives.
  //
  // Symbol mapping: futures "BTCUSDT-PERP" → Binance "btcusdt" (strip -PERP).
  useEffect(() => {
    // Build stream list from the known futures symbols.
    const FUTURES_SYMBOLS = [
      'BTCUSDT-PERP', 'ETHUSDT-PERP', 'BNBUSDT-PERP', 'SOLUSDT-PERP',
      'XRPUSDT-PERP', 'DOGEUSDT-PERP', 'ADAUSDT-PERP', 'POLUSDT-PERP',
      'AVAXUSDT-PERP', 'DOTUSDT-PERP',
    ];
    // binance stream name → futures symbol
    const binToFut = {};
    for (const sym of FUTURES_SYMBOLS) {
      const binSym = sym.replace('-PERP', '').toLowerCase();
      binToFut[binSym] = sym;
    }
    const streams = Object.keys(binToFut).map(s => `${s}@miniTicker`).join('/');
    const url = `wss://stream.binance.com:9443/stream?streams=${streams}`;

    let cancelled   = false;
    let ws          = null;
    let timer       = null;
    // Throttle: buffer incoming prices and flush to state max every 300 ms.
    // This prevents every single tick (~100 ms) from triggering a React
    // re-render and causing the header / trade-form to "jump" visually.
    const pendingPrices = {};
    let flushTimer = null;

    const flush = () => {
      flushTimer = null;
      const snapshot = { ...pendingPrices };
      for (const k in pendingPrices) delete pendingPrices[k];
      setMarkets((prev) => {
        const next = { ...prev };
        for (const [sym, tick] of Object.entries(snapshot)) {
          const existing = next[sym] || {};
          const px = typeof tick === 'number' ? tick : Number(tick?.price || 0);
          if (!px) continue;
          const patch = {
            symbol: sym,
            index_price: px,
            mark_price: existing.mark_price > 0 ? existing.mark_price : px,
          };
          if (tick && typeof tick === 'object') {
            if (tick.high_24h > 0) patch.high_24h = tick.high_24h;
            if (tick.low_24h > 0) patch.low_24h = tick.low_24h;
            if (tick.volume_24h > 0) patch.volume_24h = tick.volume_24h;
            if (Number.isFinite(tick.change_pct)) patch.change_pct = tick.change_pct;
          }
          next[sym] = mergeMarketTick(existing, patch);
        }
        return next;
      });
    };

    const connect = () => {
      if (cancelled) return;
      try {
        ws = new WebSocket(url);
        ws.onmessage = (e) => {
          try {
            const msg  = JSON.parse(e.data);
            const tick = msg?.data;
            if (!tick?.s || !tick?.c) return;
            const futSym = binToFut[tick.s.toLowerCase()];
            if (!futSym) return;
            const price = parseFloat(tick.c);
            if (!price || price <= 0) return;
            // Buffer richer miniTicker fields for the Delta-style market header.
            const open = parseFloat(tick.o) || 0;
            pendingPrices[futSym] = {
              price,
              high_24h: parseFloat(tick.h) || 0,
              low_24h: parseFloat(tick.l) || 0,
              volume_24h: parseFloat(tick.q) || 0, // quote volume (USDT)
              change_pct: open > 0 ? ((price - open) / open) * 100 : 0,
            };
            if (!flushTimer) flushTimer = setTimeout(flush, 300);
          } catch { /* ignore parse errors */ }
        };
        ws.onerror = () => { try { ws.close(); } catch { /* ignore */ } };
        ws.onclose = () => {
          if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
          if (!cancelled) timer = setTimeout(connect, 4000);
        };
      } catch { /* ignore — connect will retry */ }
    };
    connect();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      if (flushTimer) clearTimeout(flushTimer);
      try { ws?.close(); } catch { /* ignore */ }
    };
  }, []);

  // ── Orderbook WS (per active symbol) ──────────────────────────────────
  useEffect(() => {
    if (!activeSymbol) return undefined;
    let cancelled = false;
    let ws = null;
    let timer = null;
    let markTimer = null;
    let obFlushTimer = null;
    let pendingBook = null;
    let pendingTrades = null;

    setOrderbook({ bids: [], asks: [] });
    setRecentTrades([]);

    const flushOb = () => {
      obFlushTimer = null;
      if (pendingBook) {
        const bids = pendingBook.bids || [];
        const asks = pendingBook.asks || [];
        // Ignore empty book snapshots — they flash the UI to dashes between ticks.
        if (bids.length > 0 || asks.length > 0) {
          setOrderbook(pendingBook);
        }
        pendingBook = null;
      }
      if (pendingTrades) {
        if (pendingTrades.length > 0) setRecentTrades(pendingTrades);
        pendingTrades = null;
      }
    };

    // Seed headline/orderbook sections immediately on symbol switch so
    // the header never stays empty while WS reconnects.
    const refreshMark = () => {
      futuresApi.markPrice(activeSymbol)
        .then((snap) => {
          if (cancelled || !snap) return;
          setMarkets((prev) => ({
            ...prev,
            [activeSymbol]: mergeMarketTick(prev[activeSymbol], snap),
          }));
        })
        .catch(() => {});
    };
    refreshMark();
    // Keep mark/index fresh even when WS source gets temporarily stale.
    markTimer = setInterval(refreshMark, 2000);
    futuresApi.marketTrades(activeSymbol, 30)
      .then((snap) => {
        if (cancelled) return;
        const rows = Array.isArray(snap?.trades) ? snap.trades : [];
        if (rows.length) setRecentTrades(rows);
      })
      .catch(() => {});
    futuresApi.orderbook(activeSymbol, 25)
      .then((snap) => {
        if (cancelled) return;
        if (snap?.book) setOrderbook(snap.book);
      })
      .catch(() => {});

    const connect = () => {
      if (cancelled) return;
      ws = openOrderbookWs(activeSymbol, (msg) => {
        if (msg?.type !== 'futures_orderbook') return;
        if (msg.symbol !== activeSymbol) return;
        pendingBook = msg.book || { bids: [], asks: [] };
        pendingTrades = msg.recent_trades || [];
        if (!obFlushTimer) obFlushTimer = setTimeout(flushOb, 250);
      });
      ws.onclose = () => { if (!cancelled) timer = setTimeout(connect, 3000); };
    };
    connect();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      if (markTimer) clearInterval(markTimer);
      if (obFlushTimer) clearTimeout(obFlushTimer);
      try { ws?.close(); } catch { /* ignore */ }
    };
  }, [activeSymbol]);

  // ── Account data (REST + WS) ────────────────────────────────────────────
  const refreshAccount = useCallback(async () => {
    if (!user) return;
    try {
      const [walletRes, posRes, openRes, histRes, tradesRes] = await Promise.all([
        futuresApi.wallet(),
        futuresApi.positions(),
        futuresApi.openOrders(),
        futuresApi.orderHistory({ limit: 50 }),
        futuresApi.myTrades({ limit: 50 }),
      ]);
      if (walletRes) setWallet(walletRes);
      setPositions(posRes?.positions ?? []);
      setOpenOrders(openRes?.orders ?? []);
      setOrderHistory(histRes?.orders ?? []);
      setUserTrades(tradesRes?.trades ?? []);
    } catch { /* WS will catch up */ }
  }, [user]);

  const upsertOpenOrder = useCallback((order) => {
    if (!order?.id) return;
    const st = String(order.status || '').toLowerCase();
    if (st !== 'open' && st !== 'partially_filled') return;
    setOpenOrders((prev) => {
      const i = prev.findIndex((o) => o.id === order.id);
      if (i >= 0) {
        const next = [...prev];
        next[i] = order;
        return next;
      }
      return [order, ...prev];
    });
  }, []);

  useEffect(() => {
    if (!user) return undefined;
    refreshAccount();
    return undefined;
  }, [user, refreshAccount]);

  // ── Account WS (per logged-in user) ───────────────────────────────────
  useEffect(() => {
    if (!user) {
      setWallet(null); setPositions([]); setOpenOrders([]);
      setOrderHistory([]); setUserTrades([]);
      return undefined;
    }
    let cancelled = false;
    let ws = null;
    let timer = null;

    const connect = () => {
      if (cancelled) return;
      ws = openAccountWs((msg) => {
        if (msg?.type !== 'futures_account') return;
        setWallet(msg.wallet);
        setPositions(msg.positions || []);
        setOpenOrders(msg.open_orders || []);
        setOrderHistory(msg.order_history || []);
        setUserTrades(msg.user_trades || []);
      });
      if (ws) ws.onclose = () => { if (!cancelled) timer = setTimeout(connect, 3000); };
    };
    connect();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      try { ws?.close(); } catch { /* ignore */ }
    };
  }, [user]);

  // ── Settings (per symbol) ─────────────────────────────────────────────
  const fetchSettings = useCallback(async (symbol) => {
    if (!user || !symbol) return null;
    try {
      const s = await futuresApi.settings(symbol);
      setSettings((prev) => ({ ...prev, [symbol]: s }));
      return s;
    } catch { return null; }
  }, [user]);

  useEffect(() => {
    if (activeSymbol && user) fetchSettings(activeSymbol);
  }, [activeSymbol, user, fetchSettings]);

  const setLeverage = useCallback(async (symbol, leverage) => {
    const res = await futuresApi.setLeverage({ symbol, leverage });
    setSettings((prev) => ({ ...prev, [symbol]: { ...(prev[symbol] || {}), ...res } }));
    return res;
  }, []);

  const setMarginMode = useCallback(async (symbol, mode) => {
    const res = await futuresApi.setMarginMode({ symbol, mode });
    setSettings((prev) => ({ ...prev, [symbol]: { ...(prev[symbol] || {}), ...res } }));
    return res;
  }, []);

  const placeOrder    = useCallback((body) => futuresApi.placeOrder(body), []);
  const cancelOrder   = useCallback((orderId) => futuresApi.cancelOrder(orderId), []);
  const closePosition = useCallback((body) => futuresApi.closePosition(body), []);
  const transfer      = useCallback((body) => futuresApi.transfer(body), []);
  const syncLocked    = useCallback(() => futuresApi.syncLocked(), []);

  const value = useMemo(() => ({
    symbols, leverageOptions, activeSymbol, setActiveSymbol,
    markets, orderbook, recentTrades,
    wallet, positions, openOrders, orderHistory, userTrades,
    settings, setLeverage, setMarginMode,
    placeOrder, cancelOrder, closePosition, transfer, syncLocked,
    refreshAccount, upsertOpenOrder,
    activeMark: activeSymbol ? markets[activeSymbol] : null,
  }), [
    symbols, leverageOptions, activeSymbol, markets, orderbook, recentTrades,
    wallet, positions, openOrders, orderHistory, userTrades, settings,
    setLeverage, setMarginMode, placeOrder, cancelOrder, closePosition, transfer, syncLocked,
    refreshAccount, upsertOpenOrder,
  ]);

  return <FuturesContext.Provider value={value}>{children}</FuturesContext.Provider>;
}

export function useFutures() {
  const ctx = useContext(FuturesContext);
  if (!ctx) throw new Error('useFutures must be used inside <FuturesProvider>');
  return ctx;
}
