/**
 * Synthetic options book / tape from mark for demo chain or empty API depth.
 * Deterministic per contract id so the ladder does not jump on re-render.
 */

function hashStr(s) {
  const str = String(s || '');
  let h = 2166136261;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function roundTick(px, tick) {
  if (!(tick > 0)) return px;
  return Math.round(px / tick) * tick;
}

/**
 * @param {{ mid?: number|null, mark?: number|null, bestBid?: number|null, bestAsk?: number|null, contractId?: string, levels?: number, tick?: number }} opts
 */
export function buildOptionsDemoDepth(opts = {}) {
  const midRaw = Number(opts.mid ?? opts.mark ?? 0);
  const mid = Number.isFinite(midRaw) && midRaw > 0 ? midRaw : 3.3;
  const tick = opts.tick > 0 ? opts.tick : (mid >= 50 ? 0.5 : mid >= 5 ? 0.1 : 0.05);
  const levels = Math.max(6, Math.min(16, opts.levels || 10));
  const rand = rng(hashStr(opts.contractId || String(mid)));

  let bestBid = Number(opts.bestBid);
  let bestAsk = Number(opts.bestAsk);
  if (!(bestBid > 0) || !(bestAsk > 0) || bestAsk <= bestBid) {
    const half = Math.max(tick, mid * 0.015);
    bestBid = roundTick(mid - half, tick);
    bestAsk = roundTick(mid + half, tick);
    if (bestAsk <= bestBid) bestAsk = roundTick(bestBid + tick, tick);
  }

  const bids = [];
  const asks = [];
  let bidPx = bestBid;
  let askPx = bestAsk;
  let bidSzBase = 0.15 + rand() * 0.9;
  let askSzBase = 0.15 + rand() * 0.9;

  for (let i = 0; i < levels; i += 1) {
    const bq = Math.max(0.01, +(bidSzBase * (0.6 + rand() * 1.4 + i * 0.12)).toFixed(3));
    const aq = Math.max(0.01, +(askSzBase * (0.6 + rand() * 1.4 + i * 0.12)).toFixed(3));
    bids.push([+bidPx.toFixed(tick >= 1 ? 0 : 2), bq]);
    asks.push([+askPx.toFixed(tick >= 1 ? 0 : 2), aq]);
    bidPx = roundTick(bidPx - tick * (1 + (i % 3 === 0 ? 1 : 0)), tick);
    askPx = roundTick(askPx + tick * (1 + (i % 3 === 0 ? 1 : 0)), tick);
    if (bidPx <= 0) bidPx = tick;
  }

  return {
    contract_id: opts.contractId || null,
    bids,
    asks,
    mid: +mid.toFixed(4),
    mark: +mid.toFixed(4),
    synthetic: true,
  };
}

/**
 * @param {{ mid?: number|null, contractId?: string, count?: number }} opts
 */
export function buildOptionsDemoTrades(opts = {}) {
  const midRaw = Number(opts.mid ?? 0);
  const mid = Number.isFinite(midRaw) && midRaw > 0 ? midRaw : 3.3;
  const count = Math.max(8, Math.min(40, opts.count || 24));
  const rand = rng(hashStr(`t:${opts.contractId || mid}`));
  const now = Date.now();
  const tick = mid >= 50 ? 0.5 : mid >= 5 ? 0.1 : 0.05;
  const trades = [];
  let px = mid;

  for (let i = 0; i < count; i += 1) {
    const isBuy = rand() > 0.48;
    const step = (rand() > 0.55 ? 1 : 0) * tick * (isBuy ? 1 : -1);
    px = Math.max(tick, +roundTick(px + step + (rand() - 0.5) * tick * 0.5, tick).toFixed(4));
    const qty = +(0.02 + rand() * 0.45).toFixed(3);
    trades.push({
      id: `demo-${opts.contractId || 'x'}-${i}`,
      price: px,
      qty,
      side: isBuy ? 'buy' : 'sell',
      created_at: new Date(now - i * (8000 + Math.floor(rand() * 12000))).toISOString(),
      synthetic: true,
    });
  }
  return trades;
}

export function depthHasLevels(depth) {
  if (!depth || typeof depth !== 'object') return false;
  const b = Array.isArray(depth.bids) ? depth.bids.length : 0;
  const a = Array.isArray(depth.asks) ? depth.asks.length : 0;
  return b > 0 || a > 0;
}
