/** Matches backend ``ALLOWED_LEVERAGE`` in futures/constants.py */
export const FUTURES_ALLOWED_LEVERAGE = [1, 2, 3, 5, 10, 20, 25, 50, 75, 100, 125] as const;

/** Snap UI slider value to the nearest exchange-allowed leverage tier. */
export function snapFuturesLeverage(lev: number, maxLev = 125): number {
  const cap = Math.max(1, Math.min(maxLev, Math.round(lev)));
  const allowed = FUTURES_ALLOWED_LEVERAGE.filter((x) => x <= maxLev);
  if (!allowed.length) return 1;
  let best = allowed[0];
  let dist = Math.abs(cap - best);
  for (const x of allowed) {
    const d = Math.abs(cap - x);
    if (d < dist) {
      best = x;
      dist = d;
    }
  }
  return best;
}
