import { OrderBook, OrderBookEntry } from '../types/market.types';

/**
 * Binance / backend depth rows are often `[price, qty]` tuples.
 * Some paths use `{ price, amount }` or `{ price, qty }`.
 */
export function normalizeDepthRow(row: unknown): OrderBookEntry | null {
  if (Array.isArray(row) && row.length >= 2) {
    return { price: row[0] as number | string, amount: row[1] as number | string };
  }
  if (row && typeof row === 'object') {
    const o = row as Record<string, unknown>;
    const price = o.price ?? o.p;
    const amount = o.amount ?? o.qty ?? o.quantity ?? o.q;
    if (price != null && amount != null) {
      return { price: price as number | string, amount: amount as number | string };
    }
  }
  return null;
}

/** Normalize REST or WebSocket `book` payloads to `{ bids, asks }` with consistent entries. */
export function normalizeOrderBook(raw: unknown): OrderBook {
  if (!raw || typeof raw !== 'object') return { bids: [], asks: [] };
  const r = raw as Record<string, unknown>;
  const bidsIn = Array.isArray(r.bids) ? r.bids : [];
  const asksIn = Array.isArray(r.asks) ? r.asks : [];
  const bids = bidsIn.map(normalizeDepthRow).filter((x): x is OrderBookEntry => x != null);
  const asks = asksIn.map(normalizeDepthRow).filter((x): x is OrderBookEntry => x != null);
  return {
    bids,
    asks,
    symbol: r.symbol != null ? String(r.symbol) : undefined,
  };
}
