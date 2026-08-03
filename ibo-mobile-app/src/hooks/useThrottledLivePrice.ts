import { useEffect, useRef, useState } from 'react';

/** Throttle live price updates for header display (reduces flicker). */
export function useThrottledLivePrice(
  price: number | undefined,
  intervalMs = 450,
): number | undefined {
  const [display, setDisplay] = useState(price);
  const lastRef = useRef(price);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (price == null || !Number.isFinite(price)) {
      setDisplay(undefined);
      lastRef.current = undefined;
      return;
    }
    lastRef.current = price;
    if (timerRef.current) return;
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      setDisplay(lastRef.current);
    }, intervalMs);
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [price, intervalMs]);

  return display ?? price;
}
