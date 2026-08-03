/**
 * Throttle + price helpers for live market UI (avoids 60fps re-renders from WS).
 */

export function throttle<T extends () => void>(fn: T, ms: number): T {
  let last = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const run = () => {
    timer = null;
    last = Date.now();
    fn();
  };

  return (() => {
    const now = Date.now();
    if (now - last >= ms) {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      run();
    } else if (!timer) {
      timer = setTimeout(run, ms - (now - last));
    }
  }) as T;
}

/** Skip UI updates when price wiggle is below display precision. */
export function priceChangedEnough(prev: number, next: number, relEps = 0.00005, absEps = 0.01): boolean {
  if (!Number.isFinite(next) || next <= 0) return false;
  if (!Number.isFinite(prev) || prev <= 0) return true;
  if (Math.abs(next - prev) < absEps) return false;
  const base = Math.max(prev, next, 1);
  return Math.abs(next - prev) / base > relEps;
}
