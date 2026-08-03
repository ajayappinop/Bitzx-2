/**
 * Synthetic spot market display (IBO-quoted pairs) — mirrors backend generators.
 * UI shows live-looking depth/candles anchored to the real ticker price used for matching.
 */

export function isSyntheticSpotSymbol(symbol) {
  const s = String(symbol || '').toUpperCase();
  return s === 'IBOUSDT' || (s.endsWith('IBO') && s.length > 3);
}

function randQty() {
  return (Math.random() * 4.99 + 0.01).toFixed(4);
}

/** Build depth book centered on `mid` (quote per base). */
export function synthesizeOrderBook(mid, depth = 50) {
  const m = parseFloat(mid);
  if (!Number.isFinite(m) || m <= 0) return { asks: [], bids: [] };
  const spread = m * 0.0004;
  const bestAsk = m + spread / 2;
  const bestBid = m - spread / 2;
  const asks = [];
  const bids = [];
  for (let i = 0; i < depth; i += 1) {
    asks.push([(bestAsk * (1 + i * 0.001)).toFixed(8), randQty()]);
    bids.push([(bestBid * (1 - i * 0.001)).toFixed(8), randQty()]);
  }
  return { asks, bids };
}

function toLevels(rows) {
  if (!rows?.length) return [];
  return rows
    .map((row) => {
      if (Array.isArray(row)) return [parseFloat(row[0]), row[1]];
      const p = row.price ?? row[0];
      const q = row.qty ?? row.quantity ?? row[1];
      if (p == null || q == null) return null;
      return [parseFloat(p), String(q)];
    })
    .filter(Boolean);
}

/** Rescale server book so best bid/ask straddle the live ticker mid. */
export function recenterOrderBook(book, newMid) {
  const mid = parseFloat(newMid);
  if (!Number.isFinite(mid) || mid <= 0) return synthesizeOrderBook(newMid);

  const asksAsc = toLevels(book?.asks).sort((a, b) => a[0] - b[0]);
  const bidsAsc = toLevels(book?.bids).sort((a, b) => a[0] - b[0]);
  if (!asksAsc.length && !bidsAsc.length) return synthesizeOrderBook(mid);

  const bestAsk = asksAsc[0]?.[0];
  const bestBid = bidsAsc[bidsAsc.length - 1]?.[0];
  const oldMid = bestAsk > 0 && bestBid > 0 ? (bestAsk + bestBid) / 2 : bestAsk || bestBid;
  if (!oldMid || !Number.isFinite(oldMid)) return synthesizeOrderBook(mid);

  const ratio = mid / oldMid;
  const rescale = (levels) =>
    levels.map(([p, q]) => [
      (p * ratio * (1 + (Math.random() - 0.5) * 0.00015)).toFixed(8),
      typeof q === 'number' ? q.toFixed(4) : String(q),
    ]);

  return {
    asks: rescale(asksAsc),
    bids: rescale(bidsAsc),
  };
}

/** Apply small qty jitter so depth rows feel active (same prices). */
export function jitterOrderBook(book) {
  const jitter = (rows) =>
    (rows || []).map((row) => {
      if (Array.isArray(row)) return [row[0], randQty()];
      return row;
    });
  return { asks: jitter(book?.asks), bids: jitter(book?.bids) };
}
