import apiClient from './client';
import { EP } from './endpoints';
import { Order, Trade, SpotPosition, PlaceOrderPayload } from '../types/trading.types';
import { toExchangeSymbol } from '../utils/tradeSymbols';

/** Map backend OrderOut → mobile Order (filled_amount, order_id, avg_fill_price). */
export function normalizeSpotOrder(raw: any): Order {
  const filled = Number(raw?.filled_amount ?? raw?.filled ?? 0);
  const status = raw?.status as Order['status'];
  return {
    order_id: String(raw?.order_id ?? raw?.id ?? ''),
    symbol: String(raw?.symbol ?? ''),
    side: raw?.side,
    type: raw?.type,
    amount: Number(raw?.amount ?? 0),
    price:
      raw?.price != null && raw.price !== ''
        ? Number(raw.price)
        : undefined,
    filled_amount: filled,
    avg_fill_price:
      raw?.avg_fill_price != null
        ? Number(raw.avg_fill_price)
        : raw?.avg_price != null
          ? Number(raw.avg_price)
          : undefined,
    status,
    created_at: String(raw?.created_at ?? ''),
    updated_at: raw?.updated_at != null ? String(raw.updated_at) : undefined,
    fee:
      raw?.fee != null
        ? Number(raw.fee)
        : raw?.total_fee != null
          ? Number(raw.total_fee)
          : undefined,
    fee_asset: raw?.fee_asset ?? raw?.total_fee_asset,
  };
}

export const tradingApi = {
  placeOrder: (payload: PlaceOrderPayload) =>
    apiClient
      .post<Order>(EP.ORDERS, {
        ...payload,
        symbol: toExchangeSymbol(payload.symbol),
      })
      .then((res) => ({ ...res, data: normalizeSpotOrder(res.data) })),

  /** GET /api/orders — backend returns all open orders; filter client-side by symbol if needed. */
  getOpenOrders: (symbol?: string) =>
    apiClient.get<Order[]>(EP.ORDERS, { params: symbol ? { symbol } : undefined }).then((res) => {
      const raw = res.data as any;
      const list = Array.isArray(raw?.orders) ? raw.orders : Array.isArray(raw) ? raw : [];
      const sym = symbol ? toExchangeSymbol(symbol) : '';
      const filtered =
        sym && list.length
          ? list.filter((o: any) => toExchangeSymbol(String(o.symbol ?? '')) === sym)
          : list;
      return { ...res, data: filtered.map(normalizeSpotOrder) };
    }),

  getOrderHistory: (params?: { symbol?: string; limit?: number }) =>
    apiClient.get<any>(EP.ORDERS_HISTORY, { params }).then((res) => {
      const raw = res.data as any;
      const list = Array.isArray(raw?.orders) ? raw.orders : Array.isArray(raw) ? raw : [];
      const sym = params?.symbol ? toExchangeSymbol(params.symbol) : '';
      const filtered =
        sym && list.length
          ? list.filter((o: any) => toExchangeSymbol(String(o.symbol ?? '')) === sym)
          : list;
      return { ...res, data: filtered.map(normalizeSpotOrder) };
    }),

  getTrades: (params?: { symbol?: string; limit?: number }) =>
    apiClient.get<Trade[]>(EP.ORDERS_TRADES, { params }),

  getTradingFeeConfig: () =>
    apiClient.get<{ maker_fee_rate: number; taker_fee_rate: number; fee_asset: string; ibo_price_usdt: number }>(
      EP.TRADING_FEE_CONFIG,
    ),

  cancelOrder: (orderId: string) =>
    apiClient.delete<{ ok: boolean }>(EP.ORDER_CANCEL(encodeURIComponent(orderId))),

  getPositions: () => apiClient.get<SpotPosition[]>(EP.PORTFOLIO_POSITIONS),

  closePosition: (symbol: string, amount?: number) =>
    apiClient.post<{ ok: boolean }>(EP.PORTFOLIO_CLOSE, {
      symbol: toExchangeSymbol(symbol),
      amount,
    }),
};
