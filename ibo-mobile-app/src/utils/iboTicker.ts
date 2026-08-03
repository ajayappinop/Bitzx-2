/** Normalize IBO mock ticker WS/REST payload → mobile trade header shape. */

export type MobileTicker = {
  symbol: string;
  price: number;
  changePct: number;
  volume: number;
  high?: number;
  low?: number;
};

export function iboTickerToMobile(symbol: string, ticker: unknown): MobileTicker | null {
  if (!ticker || typeof ticker !== 'object') return null;
  const t = ticker as Record<string, unknown>;
  const price = Number(t.price ?? t.lastPrice ?? 0);
  const changePct = Number(
    t.priceChangePercent ?? t.changePct ?? t.price_change_percent ?? 0,
  );
  const volume = Number(t.volume ?? t.quoteVolume ?? 0);
  const high = Number(t.highPrice ?? t.high ?? 0);
  const low = Number(t.lowPrice ?? t.low ?? 0);
  return {
    symbol: String(t.symbol || symbol).toUpperCase(),
    price: Number.isFinite(price) ? price : 0,
    changePct: Number.isFinite(changePct) ? changePct : 0,
    volume: Number.isFinite(volume) ? volume : 0,
    high: Number.isFinite(high) && high > 0 ? high : undefined,
    low: Number.isFinite(low) && low > 0 ? low : undefined,
  };
}
