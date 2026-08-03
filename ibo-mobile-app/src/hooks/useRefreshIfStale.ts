import { useCallback, useRef } from 'react';

/**
 * Coalesces repeated reload triggers (focus, intervals) when data is still fresh.
 * Pass `force: true` on symbol change or explicit user refresh.
 */
export function useRefreshIfStale<T extends () => void | Promise<void>>(
  fn: T,
  staleMs = 30_000,
) {
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const lastAt = useRef(0);

  const refresh = useCallback(async (force = false) => {
    const now = Date.now();
    if (!force && lastAt.current > 0 && now - lastAt.current < staleMs) return;
    lastAt.current = now;
    await fnRef.current();
  }, [staleMs]);

  const resetStale = useCallback(() => {
    lastAt.current = 0;
  }, []);

  return { refresh, resetStale };
}
