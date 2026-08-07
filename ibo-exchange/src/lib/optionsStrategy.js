/**
 * Strategy payoff / Greeks helpers for multi-leg European options (USDT premium).
 */

export function num(v, d = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

export function legPremium(leg) {
  const c = leg.contract || {};
  const m = c.market || {};
  return num(leg.premium ?? m.mid ?? m.mark_price ?? m.best_ask ?? m.best_bid);
}

/** Intrinsic at expiry for one long call/put. */
function intrinsic(optionType, spot, strike) {
  const ot = String(optionType || '').toLowerCase();
  if (ot === 'call') return Math.max(0, spot - strike);
  if (ot === 'put') return Math.max(0, strike - spot);
  if (ot === 'move') return Math.abs(spot - strike);
  return 0;
}

/**
 * P&L of a basket at expiry spot S (premium paid is cost).
 * Long: +intrinsic − premium; Short: +premium − intrinsic.
 */
export function basketPnlAtSpot(legs, spot) {
  let pnl = 0;
  for (const leg of legs || []) {
    const c = leg.contract || {};
    const k = num(c.strike);
    const px = legPremium(leg);
    const q = Math.max(0, num(leg.qty, 1));
    const sign = String(leg.side).toLowerCase() === 'sell' ? -1 : 1;
    const value = intrinsic(c.option_type, spot, k) - px;
    pnl += sign * value * q;
  }
  return pnl;
}

/** Build payoff series around index for charting. */
export function buildPayoffSeries(legs, indexPx, { points = 81, rangePct = 0.12 } = {}) {
  const spot0 = indexPx > 0 ? indexPx : (
    num(legs?.[0]?.contract?.strike) || 100
  );
  const lo = spot0 * (1 - rangePct);
  const hi = spot0 * (1 + rangePct);
  const step = (hi - lo) / Math.max(1, points - 1);
  const series = [];
  for (let i = 0; i < points; i += 1) {
    const s = lo + step * i;
    series.push({
      spot: Number(s.toFixed(2)),
      pnl: Number(basketPnlAtSpot(legs, s).toFixed(4)),
    });
  }
  return series;
}

export function payoffStats(legs, indexPx) {
  const series = buildPayoffSeries(legs, indexPx, { points: 121, rangePct: 0.2 });
  if (!series.length) {
    return { maxProfit: null, maxLoss: null, breakevens: [], series };
  }
  let maxProfit = -Infinity;
  let maxLoss = Infinity;
  for (const p of series) {
    if (p.pnl > maxProfit) maxProfit = p.pnl;
    if (p.pnl < maxLoss) maxLoss = p.pnl;
  }
  const breakevens = [];
  for (let i = 1; i < series.length; i += 1) {
    const a = series[i - 1];
    const b = series[i];
    if ((a.pnl <= 0 && b.pnl >= 0) || (a.pnl >= 0 && b.pnl <= 0)) {
      const t = Math.abs(a.pnl) + Math.abs(b.pnl);
      const spot = t > 1e-12
        ? a.spot + (b.spot - a.spot) * (Math.abs(a.pnl) / t)
        : a.spot;
      breakevens.push(Number(spot.toFixed(2)));
    }
  }
  return {
    maxProfit: Number.isFinite(maxProfit) ? maxProfit : null,
    maxLoss: Number.isFinite(maxLoss) ? maxLoss : null,
    breakevens,
    series,
  };
}

export function netGreeks(legs) {
  let delta = 0;
  let gamma = 0;
  let theta = 0;
  let vega = 0;
  let debit = 0;
  for (const leg of legs || []) {
    const c = leg.contract || {};
    const m = c.market || {};
    const q = Math.max(0, num(leg.qty, 1));
    const sign = String(leg.side).toLowerCase() === 'sell' ? -1 : 1;
    const mul = sign * q;
    const d = m.delta ?? c.delta;
    const g = m.gamma ?? c.gamma;
    const th = m.theta ?? c.theta;
    const v = m.vega ?? c.vega;
    if (Number.isFinite(Number(d))) delta += Number(d) * mul;
    if (Number.isFinite(Number(g))) gamma += Number(g) * mul;
    if (Number.isFinite(Number(th))) theta += Number(th) * mul;
    if (Number.isFinite(Number(v))) vega += Number(v) * mul;
    debit += legPremium(leg) * q * sign;
  }
  return { delta, gamma, theta, vega, debit };
}

/** Estimated margin ≈ sum of long premiums + short premium cushions. */
export function estimateBasketMargin(legs) {
  let margin = 0;
  for (const leg of legs || []) {
    const px = legPremium(leg);
    const q = Math.max(0, num(leg.qty, 1));
    if (String(leg.side).toLowerCase() === 'buy') {
      margin += px * q;
    } else {
      // Short options: premium received offset + IM cushion (~10% of mark notional proxy)
      const strike = num(leg.contract?.strike);
      margin += Math.max(px * q * 0.2, strike * 0.01 * q);
    }
  }
  return margin;
}

export function legLabel(c, underlying) {
  if (!c) return '—';
  const ot = String(c.option_type || 'C').toLowerCase();
  const letter = ot === 'put' ? 'P' : ot === 'move' ? 'MV' : 'C';
  const base = String(c.underlying_symbol || underlying || '')
    .replace(/USDT$/i, '')
    .toUpperCase() || 'BTC';
  const k = Math.round(Number(c.strike) || 0);
  const raw = String(c.expiry || '');
  let dmy = '——————';
  const t = Date.parse(raw.replace('Z', '+00:00'));
  if (Number.isFinite(t)) {
    const d = new Date(t);
    const dd = String(d.getUTCDate()).padStart(2, '0');
    const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
    const yy = String(d.getUTCFullYear()).slice(-2);
    dmy = `${dd}${mm}${yy}`;
  }
  return `${letter}-${base}-${k}-${dmy}`;
}
