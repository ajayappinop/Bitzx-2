import type { OrderBook } from '../types/market.types';
import type { TradeMarketType } from '../components/trading/TradeMarketHeader';

export function bookDepth(book: OrderBook | null | undefined): number {
  if (!book) return 0;
  return (book.bids?.length ?? 0) + (book.asks?.length ?? 0);
}

/**
 * Pick the richest order book for chart / terminal display.
 * Futures perp books are often sparse — fall back to spot when it has more depth.
 */
export function resolveDisplayOrderBook(
  spotBook: OrderBook,
  perpBook: OrderBook,
  market: TradeMarketType,
): OrderBook {
  if (market !== 'futures') return spotBook;
  const spotD = bookDepth(spotBook);
  const perpD = bookDepth(perpBook);
  if (spotD > perpD) return spotBook;
  if (perpD > 0) return perpBook;
  return spotBook;
}
