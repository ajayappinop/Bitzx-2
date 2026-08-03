/**
 * Futures quote helpers — aligned with backend `/api/futures/mark-price` and WS `mark` snapshots.
 */
import type { OrderBook } from '../types/market.types';
import type { FuturesWallet } from '../types/futures.types';
import { normalizeOrderBook } from './orderbook';

export function parseQuoteNum(v: unknown): number {
  const n = typeof v === 'string' ? parseFloat(v) : Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** Signed numeric field (e.g. 24h change %) — zero and negative are valid. */
export function parseSignedNum(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = typeof v === 'string' ? parseFloat(v) : Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Balance field parser — zero is valid (unlike mark prices). */
export function parseBalanceNum(v: unknown): number {
  const n = typeof v === 'string' ? parseFloat(v) : Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** Spendable futures balance — prefer `available`, fall back to `free_margin`. */
export function futuresWalletAvailable(
  wallet: FuturesWallet | Record<string, unknown> | null | undefined,
): number {
  if (!wallet) return 0;
  const w = wallet as Record<string, unknown>;
  if (w.available != null || w.available_balance != null) {
    return parseBalanceNum(w.available ?? w.available_balance);
  }
  return parseBalanceNum(w.free_margin ?? w.free);
}

/** Next 8h funding settlement (UTC hours 0, 8, 16). */
export function nextFundingSettlementUtc(now = new Date()): Date {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const d = now.getUTCDate();
  for (const h of [0, 8, 16]) {
    const slot = new Date(Date.UTC(y, m, d, h, 0, 0, 0));
    if (slot.getTime() > now.getTime()) return slot;
  }
  return new Date(Date.UTC(y, m, d + 1, 0, 0, 0, 0));
}

export function formatFundingCountdown(now = new Date()): string {
  const next = nextFundingSettlementUtc(now);
  const diff = Math.max(0, next.getTime() - now.getTime());
  const h = Math.floor(diff / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  const sec = Math.floor((diff % 60000) / 1000);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

/** Normalize GET /api/futures/mark-price (object) or WS `mark` snapshot. */
export function extractFuturesMarkPayload(body: unknown): {
  mark: number;
  index: number;
  funding: number | null;
} {
  if (body == null) return { mark: 0, index: 0, funding: null };
  const row = Array.isArray(body)
    ? (body[0] as Record<string, unknown> | undefined)
    : (body as Record<string, unknown>);
  if (!row || typeof row !== 'object') return { mark: 0, index: 0, funding: null };

  const mark = parseQuoteNum(
    row.mark_price ?? row.markPrice ?? row.lastPrice ?? row.price,
  );
  const index = parseQuoteNum(
    row.index_price ?? row.indexPrice ?? row.mark_price ?? row.markPrice,
  ) || mark;
  const fr = row.funding_rate ?? row.fundingRate;
  const funding = fr != null && fr !== '' ? parseQuoteNum(fr) : null;

  return { mark, index, funding };
}

export function bookBestSides(book: OrderBook): { bid: number; ask: number } {
  const bid = parseQuoteNum((book.bids ?? [])[0]?.price ?? 0);
  const ask = parseQuoteNum((book.asks ?? [])[0]?.price ?? 0);
  return { bid, ask };
}

export function lastTradePrice(trades: unknown[]): number {
  if (!Array.isArray(trades) || trades.length === 0) return 0;
  const t0 = trades[0] as Record<string, unknown>;
  return parseQuoteNum(t0.price ?? t0.executed_price ?? t0.px);
}

export function extractSpotTicker(body: unknown): { price: number; changePct: number | null } {
  if (!body || typeof body !== 'object') return { price: 0, changePct: null };
  const t = body as Record<string, unknown>;
  const price = parseQuoteNum(
    t.price ?? t.lastPrice ?? t.last_price ?? t.weightedAvgPrice ?? t.weighted_avg_price,
  );
  const cp =
    t.changePct ??
    t.change_pct ??
    t.price_change_pct_24h ??
    t.priceChangePercent ??
    t.price_change_percent;
  const changePct = parseSignedNum(cp);
  return { price, changePct };
}

/** Decimal places for limit price input from contract tick size. */
export function futuresPriceDecimals(tickSize: number): number {
  if (tickSize >= 1) return 2;
  if (tickSize >= 0.01) return 4;
  if (tickSize >= 0.0001) return 6;
  return 8;
}

export function formatFuturesLimitPrice(ref: number, tickSize: number): string {
  if (!ref || ref <= 0) return '';
  return ref.toFixed(futuresPriceDecimals(tickSize));
}

/** Best USDT price for "Latest" on limit orders — mark first (perp convention). */
export function pickLatestLimitPrice(opts: {
  mark: number;
  index: number;
  spot: number;
  last: number;
  side: 'buy' | 'sell';
  bid: number;
  ask: number;
}): number {
  const { mark, index, spot, last, side, bid, ask } = opts;
  if (mark > 0) return mark;
  if (index > 0) return index;
  if (spot > 0) return spot;
  if (last > 0) return last;
  return side === 'buy' ? ask : bid;
}

export type QuoteSnap = {
  mark: number;
  index: number;
  bestBid: number;
  bestAsk: number;
  last: number;
};

export function normalizeFuturesBook(raw: unknown): OrderBook {
  return normalizeOrderBook(raw);
}
