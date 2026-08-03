import apiClient from './client';
import { EP } from './endpoints';
import { snapFuturesLeverage } from '../utils/futuresLeverage';
import {
  FuturesSymbol,
  FuturesPosition,
  FuturesOrder,
  FuturesWallet,
  FuturesSettings,
  FuturesMarkPrice,
  MarginMode,
} from '../types/futures.types';

const FUTURES_WALLET_TTL_MS = 20_000;
const FUNDING_RATE_TTL_MS = 60_000;
const TRANSFER_TIMEOUT_MS = 120_000;

let futuresWalletCache: { data: FuturesWallet; at: number } | null = null;
let futuresWalletInflight: Promise<FuturesWallet | null> | null = null;
const fundingCache = new Map<string, { rate: number | null; at: number }>();
const fundingInflight = new Map<string, Promise<number | null>>();

export function peekFuturesWalletCache(): FuturesWallet | null {
  if (!futuresWalletCache) return null;
  if (Date.now() - futuresWalletCache.at > FUTURES_WALLET_TTL_MS) return null;
  return futuresWalletCache.data;
}

export function invalidateFuturesWalletCache(): void {
  futuresWalletCache = null;
}

async function fetchFuturesWallet(force = false): Promise<FuturesWallet | null> {
  const now = Date.now();
  if (!force && futuresWalletCache && now - futuresWalletCache.at < FUTURES_WALLET_TTL_MS) {
    return futuresWalletCache.data;
  }
  if (!force && futuresWalletInflight) return futuresWalletInflight;

  futuresWalletInflight = apiClient
    .get<FuturesWallet>(EP.FUTURES_WALLET)
    .then((res) => {
      const data = res.data;
      if (data) futuresWalletCache = { data, at: Date.now() };
      return data ?? null;
    })
    .catch(() => futuresWalletCache?.data ?? null)
    .finally(() => {
      futuresWalletInflight = null;
    });

  return futuresWalletInflight;
}

async function fetchFundingRateCached(symbol: string, force = false): Promise<number | null> {
  const key = String(symbol || '').toUpperCase();
  const now = Date.now();
  const cached = fundingCache.get(key);
  if (!force && cached && now - cached.at < FUNDING_RATE_TTL_MS) {
    return cached.rate;
  }
  const inflight = fundingInflight.get(key);
  if (!force && inflight) return inflight;

  const p = apiClient
    .get<Record<string, unknown>>(EP.FUTURES_FUNDING_RATE, { params: { symbol: key } })
    .then((res) => {
      const raw = res.data?.rate ?? res.data?.funding_rate;
      const n = typeof raw === 'string' ? parseFloat(raw) : Number(raw);
      const rate = Number.isFinite(n) ? n : null;
      fundingCache.set(key, { rate, at: Date.now() });
      return rate;
    })
    .catch(() => cached?.rate ?? null)
    .finally(() => {
      fundingInflight.delete(key);
    });

  fundingInflight.set(key, p);
  return p;
}

export function prefetchFuturesWallet(symbol = 'BTCUSDT-PERP'): void {
  void fetchFuturesWallet();
  void fetchFundingRateCached(symbol);
}

export interface FuturesOrderPayload {
  symbol: string;
  side: 'buy' | 'sell';
  type: 'limit' | 'market' | 'stop_limit' | 'stop_market' | 'take_profit';
  quantity: number;
  price?: number | null;
  stop_price?: number | null;
  take_profit_price?: number | null;
  stop_loss_price?: number | null;
  leverage?: number;
  tif?: 'GTC' | 'IOC' | 'FOK';
  reduce_only?: boolean;
  post_only?: boolean;
  trailing_percent?: number | null;
  trailing_offset?: number | null;
  client_order_id?: string;
}

export const futuresApi = {
  // ── Public market data ────────────────────────────────────────────────────
  /** GET /api/futures/symbols  → { symbols: [], leverage_options: [] } */
  getSymbols: () => apiClient.get<{ symbols: FuturesSymbol[]; leverage_options: number[] }>(EP.FUTURES_SYMBOLS),

  /** GET /api/futures/mark-price?symbol=... */
  getMarkPrice: (symbol?: string) =>
    apiClient.get<FuturesMarkPrice[]>(EP.FUTURES_MARK_PRICE, { params: { symbol } }),

  /** GET /api/futures/orderbook?symbol=...&depth=25 */
  getOrderBook: (symbol: string, depth = 25) =>
    apiClient.get(EP.FUTURES_ORDERBOOK, { params: { symbol, depth } }),

  /** GET /api/futures/trades?symbol=...&limit=50 */
  getMarketTrades: (symbol: string, limit = 50) =>
    apiClient.get(EP.FUTURES_TRADES, { params: { symbol, limit } })
      .then((res) => ({ ...res, data: (res.data as any)?.trades ?? res.data ?? [] })),

  /** GET /api/futures/funding-rate?symbol=... */
  getFundingRate: (symbol: string) =>
    apiClient.get(EP.FUTURES_FUNDING_RATE, { params: { symbol } }),

  getPublicFeeConfig: () => apiClient.get(EP.PUBLIC_FEE_CONFIG),

  // ── Authenticated ─────────────────────────────────────────────────────────
  /** GET /api/futures/wallet — cached + deduped for fast UI paint */
  getWallet: (force = false) => fetchFuturesWallet(force),

  getWalletCached: (force = false) => fetchFuturesWallet(force),

  getFundingRateCached: (symbol: string, force = false) => fetchFundingRateCached(symbol, force),

  /** GET /api/futures/wallet/txns?limit=50&skip=0 */
  getWalletTxns: (params?: { limit?: number; skip?: number }) =>
    apiClient.get(EP.FUTURES_WALLET_TXNS, { params }).then((res) => ({
      ...res,
      data: (res.data as any)?.txns ?? [],
    })),

  /**
   * POST /api/futures/wallet/transfer
   * body: { direction: 'spot_to_futures' | 'futures_to_spot', amount, asset: 'USDT' }
   */
  transfer: (body: {
    direction: 'spot_to_futures' | 'futures_to_spot';
    amount: number;
    asset?: string;
  }) =>
    apiClient.post<{ ok?: boolean; ref?: string; amount?: number }>(
      EP.FUTURES_WALLET_TRANSFER,
      {
        direction: body.direction,
        amount: Math.round(Number(body.amount) * 100) / 100,
        asset: body.asset ?? 'USDT',
      },
      { timeout: TRANSFER_TIMEOUT_MS },
    ).then((res) => {
      invalidateFuturesWalletCache();
      return res;
    }),

  /** GET /api/futures/settings?symbol=... */
  getSettings: (symbol: string) =>
    apiClient.get<FuturesSettings>(EP.FUTURES_SETTINGS, { params: { symbol } }),

  /**
   * POST /api/futures/leverage  → { symbol, leverage }
   * Mirrors web: futuresApi.setLeverage({ symbol, leverage })
   */
  setLeverage: (symbol: string, leverage: number, maxLev = 125) =>
    apiClient.post<FuturesSettings>(EP.FUTURES_LEVERAGE, {
      symbol,
      leverage: snapFuturesLeverage(leverage, maxLev),
    }),

  /**
   * POST /api/futures/margin-mode  → { symbol, mode }
   * Mirrors web: futuresApi.setMarginMode({ symbol, mode })
   * Note: backend field is 'mode' NOT 'margin_mode'
   */
  setMarginMode: (symbol: string, mode: MarginMode) =>
    apiClient.post<FuturesSettings>(EP.FUTURES_MARGIN_MODE, { symbol, mode }),

  // ── Orders ────────────────────────────────────────────────────────────────
  /** POST /api/futures/orders */
  placeOrder: (payload: FuturesOrderPayload) =>
    apiClient.post<FuturesOrder>(EP.FUTURES_ORDERS, payload),

  /** GET /api/futures/orders/open?symbol=... — mirrors web: futuresApi.openOrders(symbol) */
  getOpenOrders: (symbol?: string) =>
    apiClient.get<FuturesOrder[]>(EP.FUTURES_ORDERS_OPEN, { params: symbol ? { symbol } : undefined })
      .then((res) => ({ ...res, data: (res.data as any)?.orders ?? res.data ?? [] })),

  /** DELETE /api/futures/orders/{orderId} */
  cancelOrder: (orderId: string) =>
    apiClient.delete<{ ok: boolean }>(EP.FUTURES_ORDER_CANCEL(orderId)),

  /** GET /api/futures/orders/history?limit=50&symbol=... */
  getOrderHistory: (params?: { limit?: number; symbol?: string }) =>
    apiClient.get<FuturesOrder[]>(EP.FUTURES_ORDERS_HISTORY, { params })
      .then((res) => ({ ...res, data: (res.data as any)?.orders ?? res.data ?? [] })),

  /** GET /api/futures/trades/me?limit=50&symbol=... */
  getMyTrades: (params?: { limit?: number; symbol?: string }) =>
    apiClient.get(EP.FUTURES_TRADES_ME, { params }).then((res) => ({
      ...res,
      data: (res.data as any)?.trades ?? (Array.isArray(res.data) ? res.data : []),
    })),

  // ── Positions ─────────────────────────────────────────────────────────────
  /** GET /api/futures/positions */
  getPositions: (symbol?: string) =>
    apiClient.get<FuturesPosition[]>(EP.FUTURES_POSITIONS, { params: symbol ? { symbol } : undefined })
      .then((res) => ({ ...res, data: (res.data as any)?.positions ?? res.data ?? [] })),

  /**
   * POST /api/futures/positions/close
   * body: { symbol, quantity? }  — mirrors web: futuresApi.closePosition(body)
   */
  closePosition: (body: { symbol: string; quantity?: number }) =>
    apiClient.post<{ ok: boolean }>(EP.FUTURES_POSITIONS_CLOSE, body),

  /** GET /api/futures/positions/history?limit=50 */
  getPositionsHistory: (params?: { limit?: number }) =>
    apiClient.get(EP.FUTURES_POSITIONS_HISTORY, { params }).then((res) => ({
      ...res,
      data: (res.data as any)?.positions ?? (Array.isArray(res.data) ? res.data : []),
    })),

  /**
   * POST /api/futures/wallet/sync-locked
   * Recalculates locked margin from open positions — fixes any historical
   * double-lock that occurred before the margin lifecycle bug-fix.
   */
  syncLocked: () =>
    apiClient.post<{ ok: boolean; adjusted: number; locked_now: number }>(
      EP.FUTURES_WALLET_SYNC_LOCKED,
    ),
};
