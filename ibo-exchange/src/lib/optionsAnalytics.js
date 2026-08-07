/**
 * Pure helpers for Options Analytics (Delta-style OI / IV / volume / max pain).
 */

export function num(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export function marketOf(c) {
  return c?.market || {};
}

export function oiOf(c) {
  const m = marketOf(c);
  return num(m.open_interest ?? c.open_interest ?? c.oi);
}

export function volOf(c) {
  const m = marketOf(c);
  return num(m.volume_24h ?? c.volume_24h ?? c.volume);
}

export function ivOf(c) {
  const m = marketOf(c);
  const iv = num(m.iv ?? m.mark_iv ?? c.iv ?? c.mark_iv);
  // Backend may store as fraction (0.55) or percent (55)
  return iv > 0 && iv < 3 ? iv * 100 : iv;
}

export function strikeOf(c) {
  return num(c.strike);
}

export function isCall(c) {
  return String(c.option_type || '').toLowerCase() === 'call';
}

export function isPut(c) {
  return String(c.option_type || '').toLowerCase() === 'put';
}

/** Aggregate call/put OI & volume by strike for one expiry (or all). */
export function strikeBuckets(contracts, { expiry = 'all' } = {}) {
  const map = new Map();
  for (const c of contracts || []) {
    if (String(c.option_type || '').toLowerCase() === 'move') continue;
    if (expiry !== 'all' && String(c.expiry || '') !== expiry) continue;
    const k = strikeOf(c);
    if (!(k > 0)) continue;
    const row = map.get(k) || {
      strike: k,
      callOi: 0,
      putOi: 0,
      callVol: 0,
      putVol: 0,
      callIv: null,
      putIv: null,
      callNotional: 0,
      putNotional: 0,
    };
    const oi = oiOf(c);
    const vol = volOf(c);
    const mark = num(marketOf(c).mark_price ?? marketOf(c).mid ?? c.mark_price);
    const notional = mark * oi;
    if (isCall(c)) {
      row.callOi += oi;
      row.callVol += vol;
      row.callNotional += notional;
      const iv = ivOf(c);
      if (iv > 0) row.callIv = iv;
    } else if (isPut(c)) {
      row.putOi += oi;
      row.putVol += vol;
      row.putNotional += notional;
      const iv = ivOf(c);
      if (iv > 0) row.putIv = iv;
    }
    map.set(k, row);
  }
  return [...map.values()].sort((a, b) => a.strike - b.strike);
}

export function totalsFromBuckets(buckets) {
  let totCalls = 0;
  let totPuts = 0;
  let totCallVol = 0;
  let totPutVol = 0;
  for (const b of buckets) {
    totCalls += b.callOi;
    totPuts += b.putOi;
    totCallVol += b.callVol;
    totPutVol += b.putVol;
  }
  const pcr = totCalls > 0 ? totPuts / totCalls : null;
  return { totCalls, totPuts, totCallVol, totPutVol, pcr };
}

/**
 * Max pain: strike that minimizes total payout to option holders
 * (call OI × max(S−K,0) + put OI × max(K−S,0)).
 */
export function maxPainStrike(buckets) {
  if (!buckets?.length) return null;
  const strikes = buckets.map((b) => b.strike);
  let best = strikes[0];
  let bestCost = Infinity;
  for (const S of strikes) {
    let cost = 0;
    for (const b of buckets) {
      cost += b.callOi * Math.max(S - b.strike, 0);
      cost += b.putOi * Math.max(b.strike - S, 0);
    }
    if (cost < bestCost) {
      bestCost = cost;
      best = S;
    }
  }
  return best;
}

/** ATM IV from closest strike to index. */
export function atmIv(buckets, indexPx) {
  if (!buckets?.length || !(indexPx > 0)) return null;
  let best = buckets[0];
  let bd = Math.abs(best.strike - indexPx);
  for (const b of buckets) {
    const d = Math.abs(b.strike - indexPx);
    if (d < bd) {
      bd = d;
      best = b;
    }
  }
  const ivs = [best.callIv, best.putIv].filter((x) => x != null && x > 0);
  if (!ivs.length) return null;
  return ivs.reduce((a, b) => a + b, 0) / ivs.length;
}

/** Synthetic 7d IV vs RV series around ATM IV (demo when no history feed). */
export function buildIvRvSeries(atm, days = 7) {
  const base = atm > 0 ? atm : 45;
  const out = [];
  const now = Date.now();
  for (let i = days - 1; i >= 0; i -= 1) {
    const t = now - i * 86400000;
    const wobble = Math.sin(i * 1.1) * 2.2 + Math.cos(i * 0.7) * 1.4;
    const iv = Math.max(5, base + wobble);
    const rv = Math.max(5, base - 3 + wobble * 0.65);
    const d = new Date(t);
    const label = `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
    out.push({
      t,
      label,
      iv: Number(iv.toFixed(2)),
      rv: Number(rv.toFixed(2)),
      spread: Number((iv - rv).toFixed(2)),
    });
  }
  return out;
}

/** Fake OI change (±) for chart when we lack historical OI. */
export function oiChangeBuckets(buckets) {
  return (buckets || []).map((b) => {
    const seed = Math.sin(b.strike * 0.0013) * 0.18;
    return {
      ...b,
      callOiChg: b.callOi * seed,
      putOiChg: b.putOi * -seed * 0.85,
    };
  });
}

/** Build demo recent trades from chain when tape is empty. */
export function synthesizeTrades(contracts, underlying, limit = 40) {
  const list = (contracts || [])
    .filter((c) => isCall(c) || isPut(c))
    .slice(0, 80);
  if (!list.length) return [];
  const base = String(underlying || 'BTC').replace(/USDT$/i, '');
  const now = Date.now();
  const out = [];
  for (let i = 0; i < Math.min(limit, list.length * 2); i += 1) {
    const c = list[i % list.length];
    const m = marketOf(c);
    const px = num(m.last_price ?? m.mark_price ?? m.mid, 1);
    const qty = 1 + (i % 5);
    const buy = i % 3 !== 0;
    const ts = new Date(now - i * 14000 - (i % 7) * 900);
    out.push({
      id: `demo-${i}-${c.id}`,
      contract_id: c.id,
      underlying_symbol: c.underlying_symbol || underlying,
      option_type: c.option_type,
      strike: c.strike,
      expiry: c.expiry,
      price: px,
      qty,
      side: buy ? 'buy' : 'sell',
      taker: buy ? 'Buy' : 'Sell',
      notional: px * qty,
      created_at: ts.toISOString(),
      _demo: true,
      _base: base,
    });
  }
  return out;
}

export function formatUsdCompact(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return '—';
  const abs = Math.abs(v);
  if (abs >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `$${(v / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `$${(v / 1e3).toFixed(1)}K`;
  return `$${v.toFixed(2)}`;
}
