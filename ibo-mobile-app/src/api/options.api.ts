import apiClient from './client';
import { EP } from './endpoints';

export interface OptionsContractRow {
  contract_id: string;
  id: string;
  symbol: string;
  underlying: string;
  underlying_symbol: string;
  strike: number;
  expiry: string;
  option_type: 'call' | 'put';
  mark_price?: number;
  bid?: number;
  ask?: number;
  bid_qty?: number;
  ask_qty?: number;
  iv?: number;
  delta?: number;
  open_interest?: number;
  status?: string;
  demo_contract?: boolean;
}

export function normalizeContract(raw: Record<string, any>): OptionsContractRow {
  const mkt = raw.market ?? {};
  const underlying = String(
    raw.underlying_symbol ?? raw.underlying ?? '',
  ).toUpperCase();
  const id = String(raw.id ?? raw.contract_id ?? '');
  const pickNum = (...vals: any[]) => {
    for (const v of vals) {
      if (v != null && v !== '' && Number.isFinite(Number(v))) return Number(v);
    }
    return undefined;
  };
  return {
    id,
    contract_id: id,
    symbol: String(raw.symbol ?? id),
    underlying,
    underlying_symbol: underlying,
    strike: Number(raw.strike ?? raw.strike_price ?? 0),
    expiry: String(raw.expiry ?? raw.expiry_date ?? ''),
    option_type: String(raw.option_type ?? 'call').toLowerCase() as 'call' | 'put',
    mark_price: pickNum(mkt.mark_price, mkt.mid, raw.mark_price),
    bid: pickNum(mkt.best_bid, raw.bid),
    ask: pickNum(mkt.best_ask, raw.ask),
    bid_qty: pickNum(mkt.bid_qty, raw.bid_qty),
    ask_qty: pickNum(mkt.ask_qty, raw.ask_qty),
    iv: pickNum(mkt.iv, raw.iv),
    delta: pickNum(mkt.delta, raw.delta),
    open_interest: pickNum(mkt.open_interest, raw.open_interest),
    status: raw.status,
    demo_contract: !!raw.demo_contract,
  };
}

/** Merge `/ws/options/chain` payload into existing normalized rows. */
export function mergeChainWsUpdate(
  prev: OptionsContractRow[],
  msg: Record<string, any>,
): OptionsContractRow[] {
  const rows = msg?.contracts;
  if (!Array.isArray(rows) || !rows.length) return prev;
  if (!prev.length) return rows.map((r) => normalizeContract(r));
  const updates = new Map(rows.map((r: Record<string, any>) => [String(r.id ?? r.contract_id), r]));
  return prev.map((c) => {
    const u = updates.get(c.contract_id);
    if (!u) return c;
    return normalizeContract({
      ...u,
      id: c.id,
      contract_id: c.contract_id,
      underlying_symbol: c.underlying_symbol,
      strike: c.strike,
      expiry: c.expiry,
      option_type: c.option_type,
      market: { ...(u.market || {}) },
    });
  });
}

export interface OptionsPositionRow {
  id: string;
  position_id: string;
  contract_id: string;
  qty: number;
  size: number;
  avg_premium: number;
  avg_price: number;
  mark_price?: number;
  unrealized_pnl?: number;
  status: string;
  contract?: Record<string, any>;
}

export interface OptionsOrderRow {
  id: string;
  order_id: string;
  contract_id: string;
  side: 'buy' | 'sell';
  quantity: number;
  size: number;
  filled: number;
  remaining: number;
  price?: number;
  status: string;
  created_at: string;
}

export interface OptionsTradeRow {
  id: string;
  trade_id: string;
  contract_id: string;
  side: 'buy' | 'sell';
  qty: number;
  quantity: number;
  price: number;
  premium: number;
  created_at: string;
}

function parseContractId(contractId: string) {
  const m = String(contractId || '').match(/^optc_([A-Z0-9]+)_(\d{8})_([0-9.]+)_([CP])$/i);
  if (!m) return null;
  const [, ul, ymd, strike, cp] = m;
  const base = String(ul).replace(/USDT$/i, '');
  const y = Number(ymd.slice(0, 4));
  const mo = Number(ymd.slice(4, 6));
  const d = Number(ymd.slice(6, 8));
  const dt = new Date(Date.UTC(y, mo - 1, d));
  const expiry = Number.isFinite(dt.getTime())
    ? dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
    : ymd;
  return {
    base,
    strike: Number(strike),
    type: String(cp).toUpperCase() === 'C' ? 'Call' : 'Put',
    expiry,
  };
}

export function optionsContractLabel(
  contractId: string,
  contracts?: OptionsContractRow[],
  contract?: Record<string, any> | null,
): { main: string; sub: string } {
  const c =
    contract
    ?? contracts?.find((row) => row.contract_id === contractId || row.id === contractId);
  if (c) {
    const base = String(c.underlying_symbol || c.underlying || '').replace(/USDT$/i, '');
    const t = String(c.option_type || '').toUpperCase() === 'CALL' ? 'Call' : 'Put';
    const strike = Number(c.strike ?? 0);
    const expiry = c.expiry
      ? new Date(String(c.expiry).replace('Z', '+00:00')).toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric',
          timeZone: 'UTC',
        })
      : '';
    return {
      main: `${base || 'OPT'} ${t} · K ${strike}`,
      sub: expiry ? `${expiry} · UTC` : contractId,
    };
  }
  const parsed = parseContractId(contractId);
  if (parsed) {
    return {
      main: `${parsed.base} ${parsed.type} · K ${parsed.strike}`,
      sub: `${parsed.expiry} · UTC`,
    };
  }
  const short = contractId.length > 18 ? `${contractId.slice(0, 10)}…${contractId.slice(-6)}` : contractId;
  return { main: short, sub: 'Contract' };
}

export function normalizePosition(raw: Record<string, any>): OptionsPositionRow {
  const id = String(raw.id ?? raw.position_id ?? '');
  const qty = Number(raw.qty ?? raw.size ?? 0);
  const avgPremium = Number(raw.avg_premium ?? raw.avg_price ?? 0);
  return {
    id,
    position_id: id,
    contract_id: String(raw.contract_id ?? ''),
    qty,
    size: qty,
    avg_premium: avgPremium,
    avg_price: avgPremium,
    mark_price: raw.mark_price != null && raw.mark_price !== '' ? Number(raw.mark_price) : undefined,
    unrealized_pnl:
      raw.unrealized_pnl != null && raw.unrealized_pnl !== '' ? Number(raw.unrealized_pnl) : undefined,
    status: String(raw.status ?? 'open'),
    contract: raw.contract,
  };
}

export function normalizeOrder(raw: Record<string, any>): OptionsOrderRow {
  const id = String(raw.id ?? raw.order_id ?? '');
  const quantity = Number(raw.quantity ?? raw.size ?? 0);
  const filled = Number(raw.filled ?? raw.filled_size ?? 0);
  return {
    id,
    order_id: id,
    contract_id: String(raw.contract_id ?? ''),
    side: String(raw.side ?? 'buy').toLowerCase() as 'buy' | 'sell',
    quantity,
    size: quantity,
    filled,
    remaining: Number(raw.remaining ?? Math.max(0, quantity - filled)),
    price: raw.price != null && raw.price !== '' ? Number(raw.price) : undefined,
    status: String(raw.status ?? ''),
    created_at: String(raw.created_at ?? raw.updated_at ?? ''),
  };
}

export function normalizeTrade(raw: Record<string, any>): OptionsTradeRow {
  const id = String(raw.id ?? raw.trade_id ?? '');
  const qty = Number(raw.qty ?? raw.quantity ?? 0);
  const price = Number(raw.price ?? raw.premium ?? 0);
  return {
    id,
    trade_id: id,
    contract_id: String(raw.contract_id ?? ''),
    side: String(raw.side ?? 'buy').toLowerCase() as 'buy' | 'sell',
    qty,
    quantity: qty,
    price,
    premium: price,
    created_at: String(raw.created_at ?? ''),
  };
}

export function applyTickerWsUpdate(
  prev: OptionsContractRow[],
  contractId: string,
  ticker: Record<string, any> | null | undefined,
): OptionsContractRow[] {
  if (!ticker || !contractId) return prev;
  return prev.map((c) => {
    if (c.contract_id !== contractId) return c;
    return normalizeContract({
      ...c,
      market: {
        mark_price: ticker.mark_price,
        mid: ticker.mark_price,
        best_bid: ticker.best_bid,
        best_ask: ticker.best_ask,
        bid_qty: ticker.bid_qty,
        ask_qty: ticker.ask_qty,
        iv: ticker.iv,
        delta: ticker.delta,
        gamma: ticker.gamma,
        theta: ticker.theta,
        vega: ticker.vega,
        rho: ticker.rho,
        open_interest: ticker.open_interest,
        last_price: ticker.last_price,
      },
    });
  });
}

export const optionsApi = {
  getChain: async (underlyingSymbol: string, includeMarket = true) => {
    const res = await apiClient.get(EP.OPTIONS_CHAIN, {
      params: {
        underlying_symbol: underlyingSymbol.toUpperCase(),
        listed_only: true,
        include_market: includeMarket,
      },
    });
    const rows = (res.data as any)?.contracts ?? [];
    return { ...res, data: rows.map((r: Record<string, any>) => normalizeContract(r)) as OptionsContractRow[] };
  },

  /** Fast path — contracts only (no Binance quote enrichment). */
  getContracts: async (underlyingSymbol: string) => {
    const res = await apiClient.get(EP.OPTIONS_CONTRACTS, {
      params: {
        underlying_symbol: underlyingSymbol.toUpperCase(),
        listed_only: true,
        limit: 500,
      },
    });
    const rows = (res.data as any)?.contracts ?? [];
    return { ...res, data: rows.map((r: Record<string, any>) => normalizeContract(r)) as OptionsContractRow[] };
  },

  getDemoChain: async (underlyingSymbol: string) => {
    const res = await apiClient.get(EP.OPTIONS_DEMO_CHAIN, {
      params: { underlying_symbol: underlyingSymbol.toUpperCase() },
    });
    const rows = (res.data as any)?.contracts ?? [];
    return { ...res, data: rows.map((r: Record<string, any>) => normalizeContract(r)) as OptionsContractRow[] };
  },

  getPositions: () =>
    apiClient.get(EP.OPTIONS_POSITIONS).then((res) => ({
      ...res,
      data: ((res.data as any)?.positions ?? []).map((p: Record<string, any>) => normalizePosition(p)),
    })),

  getOpenOrders: () =>
    apiClient.get(EP.OPTIONS_ORDERS_OPEN).then((res) => ({
      ...res,
      data: ((res.data as any)?.orders ?? []).map((o: Record<string, any>) => normalizeOrder(o)),
    })),

  cancelOrder: (orderId: string) =>
    apiClient.delete<{ ok: boolean }>(EP.OPTIONS_ORDER_CANCEL(orderId)),

  getOrderHistory: (params?: { limit?: number }) =>
    apiClient.get(EP.OPTIONS_ORDERS_HISTORY, { params: { limit: 50, ...params } })
      .then((res) => ({
        ...res,
        data: ((res.data as any)?.orders ?? (res.data as any) ?? []).map((o: Record<string, any>) =>
          normalizeOrder(o),
        ),
      })),

  getMyTrades: (params?: { limit?: number }) =>
    apiClient.get(EP.OPTIONS_TRADES_ME, { params: { limit: 50, ...params } })
      .then((res) => ({
        ...res,
        data: ((res.data as any)?.trades ?? (res.data as any) ?? []).map((t: Record<string, any>) =>
          normalizeTrade(t),
        ),
      })),

  getWallet: () =>
    apiClient.get(EP.OPTIONS_WALLET),

  transfer: (body: { direction: 'spot_to_options' | 'options_to_spot'; amount: number; asset?: string }) =>
    apiClient.post<{ ok: boolean }>(EP.OPTIONS_WALLET_TRANSFER, body),

  placeOrder: (body: {
    contract_id: string;
    side: 'buy' | 'sell';
    quantity: number;
    price?: number;
    type?: 'limit' | 'market';
    reduce_only?: boolean;
    post_only?: boolean;
    time_in_force?: 'gtc' | 'ioc' | 'fok';
  }) => apiClient.post(EP.OPTIONS_ORDERS, {
    type: body.type ?? 'limit',
    reduce_only: body.side === 'sell' ? true : (body.reduce_only ?? false),
    ...body,
  }),

  getTicker: (contractId: string) =>
    apiClient.get(EP.OPTIONS_TICKER(contractId)),

  getOrderBook: (contractId: string, limit = 25) =>
    apiClient.get(EP.OPTIONS_ORDERBOOK(contractId), { params: { limit } }),

  getContractTrades: (contractId: string, limit = 40) =>
    apiClient.get(EP.OPTIONS_TRADES_CONTRACT(contractId), { params: { limit } }),

  getHistory: (params: { contract_id?: string; underlying_symbol?: string; interval?: string; limit?: number }) =>
    apiClient.get(EP.OPTIONS_HISTORY, { params: { interval: '1h', limit: 200, ...params } }),

  getPortfolio: () =>
    apiClient.get(EP.OPTIONS_PORTFOLIO).then((res) => {
      const data = (res.data as Record<string, any>) ?? {};
      return {
        ...res,
        data: {
          ...data,
          positions: Array.isArray(data.positions)
            ? data.positions.map((p: Record<string, any>) => normalizePosition(p))
            : [],
        },
      };
    }),

  getIndexPrice: (symbol: string) =>
    apiClient.get(EP.OPTIONS_INDEX_PRICE, { params: { symbol: symbol.toUpperCase() } }),
};
