/**
 * Synthetic spot market display — mirrors ibo-exchange `lib/syntheticMarket.js`.
 */

export function isSyntheticSpotSymbol(symbol: string): boolean {
  const s = String(symbol || '').toUpperCase();
  return s === 'IBOUSDT' || (s.endsWith('IBO') && s.length > 3);
}

function randQty(): string {
  return (Math.random() * 4.99 + 0.01).toFixed(4);
}

export function synthesizeOrderBook(mid: number | string, depth = 50) {
  const m = parseFloat(String(mid));
  if (!Number.isFinite(m) || m <= 0) return { asks: [] as [string, string][], bids: [] as [string, string][] };
  const spread = m * 0.0004;
  const bestAsk = m + spread / 2;
  const bestBid = m - spread / 2;
  const asks: [string, string][] = [];
  const bids: [string, string][] = [];
  for (let i = 0; i < depth; i += 1) {
    asks.push([(bestAsk * (1 + i * 0.001)).toFixed(8), randQty()]);
    bids.push([(bestBid * (1 - i * 0.001)).toFixed(8), randQty()]);
  }
  return { asks, bids };
}

function toLevels(rows: unknown[] | undefined) {
  if (!rows?.length) return [] as [number, string][];
  return rows
    .map((row) => {
      if (Array.isArray(row)) return [parseFloat(String(row[0])), String(row[1])] as [number, string];
      const r = row as Record<string, unknown>;
      const p = r.price ?? r[0];
      const q = r.qty ?? r.quantity ?? r[1];
      if (p == null || q == null) return null;
      return [parseFloat(String(p)), String(q)] as [number, string];
    })
    .filter((x): x is [number, string] => x != null);
}

export function recenterOrderBook(book: { asks?: unknown[]; bids?: unknown[] }, newMid: number | string) {
  const mid = parseFloat(String(newMid));
  if (!Number.isFinite(mid) || mid <= 0) return synthesizeOrderBook(newMid);

  const asksAsc = toLevels(book?.asks).sort((a, b) => a[0] - b[0]);
  const bidsAsc = toLevels(book?.bids).sort((a, b) => a[0] - b[0]);
  if (!asksAsc.length && !bidsAsc.length) return synthesizeOrderBook(mid);

  const bestAsk = asksAsc[0]?.[0];
  const bestBid = bidsAsc[bidsAsc.length - 1]?.[0];
  const oldMid = bestAsk > 0 && bestBid > 0 ? (bestAsk + bestBid) / 2 : bestAsk || bestBid;
  if (!oldMid || !Number.isFinite(oldMid)) return synthesizeOrderBook(mid);

  const ratio = mid / oldMid;
  const rescale = (levels: [number, string][]) =>
    levels.map(([p, q]) => [
      (p * ratio * (1 + (Math.random() - 0.5) * 0.00015)).toFixed(8),
      typeof q === 'number' ? Number(q).toFixed(4) : String(q),
    ] as [string, string]);

  return { asks: rescale(asksAsc), bids: rescale(bidsAsc) };
}

export function jitterOrderBook(book: { asks?: unknown[]; bids?: unknown[] }) {
  const jitter = (rows: unknown[] | undefined) =>
    (rows || []).map((row) => {
      if (Array.isArray(row)) return [row[0], randQty()];
      return row;
    });
  return { asks: jitter(book?.asks), bids: jitter(book?.bids) };
}
