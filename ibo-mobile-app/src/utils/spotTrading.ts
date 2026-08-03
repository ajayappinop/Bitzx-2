import type { Order, SpotPosition, Trade } from '../types/trading.types';
import { toExchangeSymbol } from './tradeSymbols';

/** Resolve canonical order id from REST or WS payloads. */
export function resolveOrderId(order: { order_id?: string; id?: string } | null | undefined): string {
  if (!order) return '';
  return String(order.order_id ?? (order as { id?: string }).id ?? '');
}

export function pairLabelFromSymbol(symbol: string): string {
  const sym = toExchangeSymbol(symbol);
  if (sym.includes('/')) return sym;
  if (sym.endsWith('USDT')) return `${sym.slice(0, -4)}/USDT`;
  if (sym.endsWith('BTC')) return `${sym.slice(0, -3)}/BTC`;
  if (sym.endsWith('ETH')) return `${sym.slice(0, -3)}/ETH`;
  return sym;
}

/** Sum realized P&L per sell order from user trade fills (web parity). */
export function buildOrderRealizedPnlMap(trades: Trade[] | null | undefined): Map<string, number> {
  const m = new Map<string, number>();
  if (!Array.isArray(trades)) return m;
  for (const t of trades) {
    const oid = String((t as Trade & { order_id?: string }).order_id ?? (t as any).id ?? '');
    if (!oid) continue;
    const side = String(t.side || '').toLowerCase();
    if (side !== 'sell') continue;
    const rp = (t as Trade & { realized_pnl?: number }).realized_pnl ?? t.pnl;
    if (rp == null || !Number.isFinite(Number(rp))) continue;
    m.set(oid, (m.get(oid) || 0) + Number(rp));
  }
  return m;
}

export function normalizeSpotTrade(raw: Record<string, unknown>): Trade {
  return {
    trade_id: String(raw.trade_id ?? raw.id ?? ''),
    order_id: String(raw.order_id ?? raw.id ?? ''),
    symbol: String(raw.symbol ?? ''),
    side: raw.side as Trade['side'],
    amount: Number(raw.amount ?? raw.qty ?? 0),
    price: Number(raw.price ?? 0),
    fee: Number(raw.fee ?? 0),
    fee_asset: String(raw.fee_asset ?? 'USDT'),
    created_at: String(raw.created_at ?? ''),
    pnl: raw.realized_pnl != null ? Number(raw.realized_pnl) : raw.pnl != null ? Number(raw.pnl) : undefined,
  };
}

export function normalizeSpotPosition(raw: Record<string, unknown>): SpotPosition {
  const amount = Number(raw.amount ?? raw.size ?? 0);
  const avg = Number(
    raw.avg_entry_price ?? raw.avg_buy_price ?? raw.avg_cost ?? 0,
  );
  return {
    symbol: String(raw.symbol ?? ''),
    side: (raw.side as SpotPosition['side']) ?? 'buy',
    amount,
    avg_entry_price: avg,
    current_price: raw.current_price != null ? Number(raw.current_price) : undefined,
    unrealized_pnl: raw.unrealized_pnl != null ? Number(raw.unrealized_pnl) : undefined,
    realized_pnl: raw.realized_pnl != null ? Number(raw.realized_pnl) : undefined,
    ...(raw.source != null ? { source: String(raw.source) } as any : {}),
  };
}

export function spotPositionHasCostBasis(pos: SpotPosition & { source?: string }): boolean {
  const src = String(pos.source ?? '').toLowerCase();
  if (src === 'deposit') return false;
  return Number(pos.avg_entry_price ?? 0) > 0;
}
