import type { Kline, RecentTrade } from '../types/market.types';

/** Normalize klines from API — handles array or `{ klines: [...] }` wrappers. */
export function normalizeKlines(raw: unknown): Kline[] {
  const list = Array.isArray(raw)
    ? raw
    : Array.isArray((raw as { klines?: unknown })?.klines)
      ? (raw as { klines: unknown[] }).klines
      : [];

  return list
    .map((row): Kline | null => {
      if (Array.isArray(row)) {
        const t = Number(row[0]);
        if (!Number.isFinite(t)) return null;
        return {
          time: t > 1e12 ? Math.floor(t / 1000) : t,
          open: Number(row[1]),
          high: Number(row[2]),
          low: Number(row[3]),
          close: Number(row[4]),
          volume: Number(row[5] ?? 0),
        };
      }
      const k = row as Record<string, unknown>;
      const t = Number(k.time ?? k.openTime ?? k.t ?? 0);
      if (!Number.isFinite(t) || t <= 0) return null;
      return {
        time: t > 1e12 ? Math.floor(t / 1000) : t,
        open: Number(k.open ?? 0),
        high: Number(k.high ?? 0),
        low: Number(k.low ?? 0),
        close: Number(k.close ?? 0),
        volume: Number(k.volume ?? k.vol ?? 0),
      };
    })
    .filter((k): k is Kline => k != null && Number.isFinite(k.close));
}

export type ExchangeTradeRow = {
  id?: string | number;
  tradeId?: string | number;
  price: string | number;
  qty?: string | number;
  amount?: string | number;
  time?: string | number;
  timestamp?: string | number;
  isBuyerMaker?: boolean;
  side?: 'buy' | 'sell';
};

/** Normalize recent trades from REST or WS payloads. */
export function normalizeRecentTrades(raw: unknown): ExchangeTradeRow[] {
  const list = Array.isArray(raw)
    ? raw
    : Array.isArray((raw as { trades?: unknown })?.trades)
      ? (raw as { trades: unknown[] }).trades
      : [];

  return list
    .map((row) => {
      const t = row as ExchangeTradeRow;
      if (t.price == null) return null;
      return t;
    })
    .filter((t): t is ExchangeTradeRow => t != null);
}

export function tradeIsBuy(t: ExchangeTradeRow): boolean {
  if (t.side === 'buy') return true;
  if (t.side === 'sell') return false;
  return !t.isBuyerMaker;
}

export function tradeQty(t: ExchangeTradeRow): number {
  return Number(t.qty ?? t.amount ?? 0);
}

export function tradeTimeMs(t: ExchangeTradeRow): number {
  const ts = Number(t.time ?? t.timestamp ?? 0);
  return ts > 1e12 ? ts : ts * 1000;
}

/** Map exchange trade row → RecentTrade type. */
export function toRecentTrade(t: ExchangeTradeRow): RecentTrade {
  const buy = tradeIsBuy(t);
  return {
    id: String(t.id ?? t.tradeId ?? ''),
    price: t.price,
    amount: t.qty ?? t.amount ?? 0,
    side: buy ? 'buy' : 'sell',
    timestamp: tradeTimeMs(t),
  };
}
