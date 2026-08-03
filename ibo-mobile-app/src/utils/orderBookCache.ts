import type { OrderBook } from '../types/market.types';

const cache = new Map<string, OrderBook>();

export function orderBookHasDepth(book: OrderBook | null | undefined): boolean {
  if (!book) return false;
  return (book.bids?.length ?? 0) + (book.asks?.length ?? 0) > 0;
}

export function getCachedOrderBook(symbol: string): OrderBook | null {
  const key = String(symbol || '').toUpperCase();
  if (!key) return null;
  const hit = cache.get(key);
  return hit && orderBookHasDepth(hit) ? hit : null;
}

export function setCachedOrderBook(symbol: string, book: OrderBook): void {
  const key = String(symbol || '').toUpperCase();
  if (!key || !orderBookHasDepth(book)) return;
  cache.set(key, book);
}
