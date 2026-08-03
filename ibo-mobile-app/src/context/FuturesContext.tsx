/**
 * FuturesContext — mirrors web `FuturesContext.jsx`.
 *
 * Three WS feeds (correct paths: /ws/futures/*):
 *   markets   → mark/index for all symbols
 *   orderbook → depth + recent trades for active symbol
 *   account   → wallet / positions / orders (authenticated)
 *
 * REST is used only to seed data on symbol switch and for account refresh —
 * not as a blocking gate before the UI renders.
 */
import React, {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
} from 'react';
import { useSelector } from 'react-redux';
import { futuresApi } from '../api/futures.api';
import { marketApi } from '../api/market.api';
import { futuresWsUrl } from '../config/wsConfig';
import { wsService } from '../services/websocket.service';
import StorageService from '../services/storage.service';
import { STORAGE_KEYS } from '../config/storageKeys';
import { RootState } from '../store';
import { toFuturesSymbol, toSpotSymbol } from '../utils/tradeSymbols';
import {
  bookBestSides,
  extractFuturesMarkPayload,
  extractSpotTicker,
  lastTradePrice,
  normalizeFuturesBook,
} from '../utils/futuresQuotes';
import type {
  FuturesOrder, FuturesPosition, FuturesSettings, FuturesSymbol, FuturesWallet,
} from '../types/futures.types';
import type { OrderBook } from '../types/market.types';

export type FuturesQuotes = {
  dispMark: number;
  dispIndex: number;
  dispBid: number;
  dispAsk: number;
  dispLast: number;
  dispSpread: number;
};

function mergeMarketTick(prev: Record<string, unknown>, incoming: Record<string, unknown>) {
  const out: Record<string, unknown> = { ...prev, ...incoming, symbol: incoming.symbol || prev.symbol };
  const pi = Number(prev.index_price);
  const pm = Number(prev.mark_price);
  const ii = Number(incoming.index_price);
  const im = Number(incoming.mark_price);
  out.index_price = ii > 0 ? ii : (pi > 0 ? pi : incoming.index_price);
  out.mark_price = im > 0 ? im : (pm > 0 ? pm : incoming.mark_price);
  return out;
}

type FuturesContextValue = {
  symbols: FuturesSymbol[];
  leverageOptions: number[];
  activeSymbol: string;
  /** Alias for activeSymbol (matches web hook naming). */
  symbol: string;
  setActiveSymbol: (sym: string) => void;
  spotSym: string;
  markets: Record<string, Record<string, unknown>>;
  orderbook: OrderBook;
  recentTrades: unknown[];
  wallet: FuturesWallet | null;
  positions: FuturesPosition[];
  openOrders: FuturesOrder[];
  orderHistory: FuturesOrder[];
  userTrades: unknown[];
  settings: Record<string, FuturesSettings>;
  activeSettings: FuturesSettings;
  fundingRate: number | null;
  spotRefPrice: number;
  spotChangePct: number | null;
  quotes: FuturesQuotes;
  refreshAccount: () => Promise<void>;
  fetchSettings: (symbol: string) => Promise<FuturesSettings | null>;
  setLeverage: (symbol: string, leverage: number) => Promise<FuturesSettings>;
  setMarginMode: (symbol: string, mode: FuturesSettings['margin_mode']) => Promise<FuturesSettings>;
};

const FuturesContext = createContext<FuturesContextValue | null>(null);

const DEFAULT_SETTINGS: FuturesSettings = { leverage: 10, margin_mode: 'cross' };

export function FuturesProvider({ children }: { children: React.ReactNode }) {
  const user = useSelector((s: RootState) => s.auth.user);

  const [symbols, setSymbols] = useState<FuturesSymbol[]>([]);
  const [leverageOptions, setLeverageOptions] = useState([1, 5, 10, 20, 50, 100]);
  const [activeSymbol, setActiveSymbolRaw] = useState('BTCUSDT-PERP');

  const [markets, setMarkets] = useState<Record<string, Record<string, unknown>>>({});
  const [orderbook, setOrderbook] = useState<OrderBook>({ bids: [], asks: [] });
  const [recentTrades, setRecentTrades] = useState<unknown[]>([]);
  const [fundingRate, setFundingRate] = useState<number | null>(null);
  const [spotRefPrice, setSpotRefPrice] = useState(0);
  const [spotChangePct, setSpotChangePct] = useState<number | null>(null);

  const [wallet, setWallet] = useState<FuturesWallet | null>(null);
  const [positions, setPositions] = useState<FuturesPosition[]>([]);
  const [openOrders, setOpenOrders] = useState<FuturesOrder[]>([]);
  const [orderHistory, setOrderHistory] = useState<FuturesOrder[]>([]);
  const [userTrades, setUserTrades] = useState<unknown[]>([]);
  const [settings, setSettings] = useState<Record<string, FuturesSettings>>({});

  const setActiveSymbol = useCallback((raw: string) => {
    setActiveSymbolRaw(toFuturesSymbol(raw));
  }, []);

  const symbol = activeSymbol;
  const spotSym = useMemo(() => toSpotSymbol(symbol), [symbol]);

  // ── Catalog (once) ────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    const load = () => {
      futuresApi.getSymbols()
        .then((res) => {
          if (cancelled) return;
          const syms = res.data?.symbols ?? [];
          if (syms.length) {
            setSymbols(syms);
            if (res.data?.leverage_options?.length) {
              setLeverageOptions(res.data.leverage_options);
            }
          } else if (!cancelled) {
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

  // ── Markets WS ────────────────────────────────────────────────────────────
  useEffect(() => {
    const url = futuresWsUrl('/ws/futures/markets');
    wsService.subscribe(url, (msg: unknown) => {
      const m = msg as Record<string, unknown>;
      if (m?.type !== 'futures_markets') return;
      setMarkets((prev) => {
        const next = { ...prev };
        for (const row of (m.markets as Record<string, unknown>[]) ?? []) {
          if (!row?.symbol) continue;
          const sym = String(row.symbol);
          next[sym] = mergeMarketTick(prev[sym] ?? {}, row);
        }
        return next;
      });
    });
    return () => { wsService.unsubscribe(url); };
  }, []);

  // ── Orderbook WS + REST seed per symbol ───────────────────────────────────
  useEffect(() => {
    if (!symbol) return undefined;

    setOrderbook({ bids: [], asks: [] });
    setRecentTrades([]);

    const seedMark = () => {
      futuresApi.getMarkPrice(symbol)
        .then((res) => {
          const snap = Array.isArray(res.data) ? res.data[0] : res.data;
          if (!snap) return;
          setMarkets((prev) => ({
            ...prev,
            [symbol]: mergeMarketTick(prev[symbol] ?? {}, snap as unknown as Record<string, unknown>),
          }));
          const { funding } = extractFuturesMarkPayload(snap);
          if (funding != null) setFundingRate(funding);
        })
        .catch(() => {});
    };

    seedMark();
    futuresApi.getMarketTrades(symbol, 30)
      .then((res) => {
        const rows = Array.isArray(res.data) ? res.data : [];
        if (rows.length) setRecentTrades(rows);
      })
      .catch(() => {});

    futuresApi.getOrderBook(symbol, 25)
      .then((res) => setOrderbook(normalizeFuturesBook(res.data)))
      .catch(() => {});

    const obUrl = futuresWsUrl(`/ws/futures/orderbook?symbol=${encodeURIComponent(symbol)}`);
    wsService.subscribe(obUrl, (msg: unknown) => {
      const m = msg as Record<string, unknown>;
      if (m?.type !== 'futures_orderbook') return;
      if (String(m.symbol) !== symbol) return;
      const book = m.book as OrderBook | undefined;
      if (book && ((book.bids?.length ?? 0) > 0 || (book.asks?.length ?? 0) > 0)) {
        setOrderbook(normalizeFuturesBook(book));
      }
      const trades = m.recent_trades;
      if (Array.isArray(trades) && trades.length) setRecentTrades(trades);
      if (m.mark) {
        setMarkets((prev) => ({
          ...prev,
          [symbol]: mergeMarketTick(prev[symbol] ?? {}, m.mark as Record<string, unknown>),
        }));
      }
    });

    return () => { wsService.unsubscribe(obUrl); };
  }, [symbol]);

  // ── Spot reference ticker (header change %) ───────────────────────────────
  useEffect(() => {
    if (!spotSym) return undefined;
    let cancelled = false;

    const refresh = () => {
      marketApi.getTicker(spotSym)
        .then((res) => {
          if (cancelled) return;
          const spot = extractSpotTicker(res.data);
          if (spot.price > 0) setSpotRefPrice(spot.price);
          setSpotChangePct(spot.changePct);
        })
        .catch(() => {});
    };

    refresh();
    const id = setInterval(refresh, 15_000);
    return () => { cancelled = true; clearInterval(id); };
  }, [spotSym]);

  // ── Account REST + WS ─────────────────────────────────────────────────────
  const refreshAccount = useCallback(async () => {
    if (!user) return;
    try {
      const [walRes, posRes, ordRes, histRes, tradesRes] = await Promise.all([
        futuresApi.getWallet(),
        futuresApi.getPositions(),
        futuresApi.getOpenOrders(),
        futuresApi.getOrderHistory({ limit: 50 }),
        futuresApi.getMyTrades({ limit: 50 }),
      ]);
      if (walRes) setWallet(walRes);
      setPositions(Array.isArray(posRes.data) ? posRes.data : []);
      setOpenOrders(Array.isArray(ordRes.data) ? ordRes.data : []);
      setOrderHistory(Array.isArray(histRes.data) ? histRes.data : []);
      setUserTrades(Array.isArray(tradesRes.data) ? tradesRes.data : []);
    } catch {
      /* WS will catch up */
    }
  }, [user]);

  useEffect(() => {
    if (!user) {
      setWallet(null);
      setPositions([]);
      setOpenOrders([]);
      setOrderHistory([]);
      setUserTrades([]);
      return undefined;
    }
    void refreshAccount();
    return undefined;
  }, [user, refreshAccount]);

  useEffect(() => {
    if (!user) return undefined;
    let accUrl: string | null = null;
    let dead = false;

    void StorageService.get(STORAGE_KEYS.TOKEN).then((token) => {
      if (!token || dead) return;
      accUrl = futuresWsUrl(`/ws/futures/account?token=${encodeURIComponent(token)}`);
      wsService.subscribe(accUrl, (msg: unknown) => {
        const m = msg as Record<string, unknown>;
        if (m?.type !== 'futures_account') return;
        if (m.wallet) setWallet(m.wallet as FuturesWallet);
        if (Array.isArray(m.positions)) setPositions(m.positions as FuturesPosition[]);
        if (Array.isArray(m.open_orders)) setOpenOrders(m.open_orders as FuturesOrder[]);
        if (Array.isArray(m.order_history)) setOrderHistory(m.order_history as FuturesOrder[]);
        if (Array.isArray(m.user_trades)) setUserTrades(m.user_trades);
      });
    });

    return () => {
      dead = true;
      if (accUrl) wsService.unsubscribe(accUrl);
    };
  }, [user]);

  // ── Settings per symbol ───────────────────────────────────────────────────
  const fetchSettings = useCallback(async (sym: string) => {
    if (!user || !sym) return null;
    try {
      const { data } = await futuresApi.getSettings(sym);
      setSettings((prev) => ({ ...prev, [sym]: data }));
      return data;
    } catch {
      return null;
    }
  }, [user]);

  useEffect(() => {
    if (symbol && user) void fetchSettings(symbol);
  }, [symbol, user, fetchSettings]);

  const setLeverage = useCallback(async (sym: string, leverage: number) => {
    const { data } = await futuresApi.setLeverage(sym, leverage);
    setSettings((prev) => ({ ...prev, [sym]: { ...(prev[sym] ?? DEFAULT_SETTINGS), ...data } }));
    return data;
  }, []);

  const setMarginMode = useCallback(async (sym: string, mode: FuturesSettings['margin_mode']) => {
    const { data } = await futuresApi.setMarginMode(sym, mode);
    setSettings((prev) => ({ ...prev, [sym]: { ...(prev[sym] ?? DEFAULT_SETTINGS), ...data } }));
    return data;
  }, []);

  const activeMark = markets[symbol] ?? {};

  const quotes = useMemo<FuturesQuotes>(() => {
    const { mark: mk, index: idx } = extractFuturesMarkPayload(activeMark);
    const { bid, ask } = bookBestSides(orderbook);
    const last = lastTradePrice(recentTrades);
    return {
      dispMark: mk,
      dispIndex: idx,
      dispBid: bid,
      dispAsk: ask,
      dispLast: last,
      dispSpread: bid > 0 && ask > 0 ? Math.max(0, ask - bid) : 0,
    };
  }, [activeMark, orderbook, recentTrades]);

  useEffect(() => {
    const { funding: fr } = extractFuturesMarkPayload(activeMark);
    if (fr != null) setFundingRate(fr);
  }, [activeMark]);

  const activeSettings = settings[symbol] ?? DEFAULT_SETTINGS;

  const value = useMemo<FuturesContextValue>(() => ({
    symbols,
    leverageOptions,
    activeSymbol: symbol,
    symbol,
    setActiveSymbol,
    spotSym,
    markets,
    orderbook,
    recentTrades,
    wallet,
    positions,
    openOrders,
    orderHistory,
    userTrades,
    settings,
    activeSettings,
    fundingRate,
    spotRefPrice,
    spotChangePct,
    quotes,
    refreshAccount,
    fetchSettings,
    setLeverage,
    setMarginMode,
  }), [
    symbols, leverageOptions, symbol, setActiveSymbol, spotSym, markets, orderbook,
    recentTrades, wallet, positions, openOrders, orderHistory, userTrades, settings,
    activeSettings, fundingRate, spotRefPrice, spotChangePct, quotes,
    refreshAccount, fetchSettings, setLeverage, setMarginMode,
  ]);

  return (
    <FuturesContext.Provider value={value}>{children}</FuturesContext.Provider>
  );
}

export function useFutures() {
  const ctx = useContext(FuturesContext);
  if (!ctx) throw new Error('useFutures must be used inside <FuturesProvider>');
  return ctx;
}
