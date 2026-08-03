/** Tiered liquidation + market slippage — mirrors ibo-exchange FuturesTradeForm.jsx */

export type BookLevel = { price?: number | string; qty?: number | string; amount?: number | string };

export type WalkBookResult = {
  avg: number;
  last: number;
  exhausted: boolean;
  filled: number;
  slippage_pct: number;
};

// Each tier: [maxNotional, maxLeverage, IMR, MMR]
const LEVERAGE_TIERS: Record<string, number[][]> = {
  'BTCUSDT-PERP': [[50_000, 100, 0.004, 0.005], [250_000, 100, 0.005, 0.0065], [1_000_000, 50, 0.01, 0.013], [5_000_000, 20, 0.025, 0.030]],
  'ETHUSDT-PERP': [[50_000, 100, 0.005, 0.0065], [250_000, 50, 0.01, 0.013], [1_000_000, 20, 0.025, 0.030]],
  'BNBUSDT-PERP': [[50_000, 100, 0.005, 0.0065], [250_000, 50, 0.01, 0.013], [1_000_000, 20, 0.025, 0.030]],
  'SOLUSDT-PERP': [[50_000, 50, 0.01, 0.013], [250_000, 20, 0.025, 0.030]],
  'XRPUSDT-PERP': [[50_000, 50, 0.01, 0.013], [250_000, 20, 0.025, 0.030]],
  'DOGEUSDT-PERP': [[50_000, 50, 0.01, 0.013], [250_000, 20, 0.025, 0.030]],
  'ADAUSDT-PERP': [[50_000, 50, 0.01, 0.013], [250_000, 20, 0.025, 0.030]],
  'POLUSDT-PERP': [[50_000, 50, 0.01, 0.013], [250_000, 20, 0.025, 0.030]],
  'AVAXUSDT-PERP': [[50_000, 50, 0.01, 0.013], [250_000, 20, 0.025, 0.030]],
  'DOTUSDT-PERP': [[50_000, 50, 0.01, 0.013], [250_000, 20, 0.025, 0.030]],
  'LINKUSDT-PERP': [[50_000, 50, 0.01, 0.013], [250_000, 20, 0.025, 0.030]],
  'LTCUSDT-PERP': [[50_000, 50, 0.01, 0.013], [250_000, 20, 0.025, 0.030]],
};

const INSURANCE_CUT = 0.001;

function tierFor(symbol: string, notional: number): number[] {
  const tiers = LEVERAGE_TIERS[symbol] ?? [[1_000_000, 10, 0.05, 0.025]];
  for (const t of tiers) {
    if (notional <= t[0]) return t;
  }
  return tiers[tiers.length - 1];
}

/** Exact isolated-margin liquidation price (matches backend risk tiers). */
export function calcFuturesLiqPrice(
  symbol: string,
  side: 'buy' | 'sell',
  entryPrice: number,
  leverage: number,
  notional: number,
): number | null {
  if (!entryPrice || entryPrice <= 0 || !leverage) return null;
  const lev = Math.max(1, leverage);
  const [, , tierImr, mmr] = tierFor(symbol, notional || entryPrice);
  const imr = Math.max(1 / lev, tierImr);
  if (side === 'buy') {
    const denom = 1 - mmr - INSURANCE_CUT;
    if (denom <= 0) return null;
    const liq = entryPrice * (1 - imr) / denom;
    return liq > 0 && liq < entryPrice ? liq : null;
  }
  const denom = 1 + mmr + INSURANCE_CUT;
  const liq = entryPrice * (1 + imr) / denom;
  return liq > entryPrice ? liq : null;
}

/** Walk visible book depth to estimate market fill avg / slippage. */
export function walkFuturesBook(levels: BookLevel[] | undefined, qty: number): WalkBookResult | null {
  if (!levels?.length || !qty || qty <= 0) return null;
  let need = qty;
  let cost = 0;
  let last = 0;
  for (const lv of levels) {
    const lvQty = Number(lv.qty ?? lv.amount ?? 0);
    const lvPx = Number(lv.price ?? 0);
    if (lvQty <= 0 || lvPx <= 0) continue;
    const take = Math.min(need, lvQty);
    cost += take * lvPx;
    last = lvPx;
    need -= take;
    if (need <= 1e-12) break;
  }
  const filled = qty - Math.max(0, need);
  if (filled <= 0) return null;
  const avg = cost / filled;
  const top = Number(levels[0]?.price ?? 0);
  return {
    avg,
    last,
    exhausted: need > 1e-12,
    filled,
    slippage_pct: top ? Math.abs(avg - top) / top * 100 : 0,
  };
}
