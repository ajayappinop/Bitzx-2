import { useEffect, useRef, useState } from 'react';

/**
 * Throttle a rapidly changing number for form UI (order book BBO, ticker).
 * Publishes at most every `intervalMs`; snaps immediately when value ≤ 0.
 */
export function useStableNumber(value: number, intervalMs = 400): number {
  const [stable, setStable] = useState(value);
  const latest = useRef(value);
  latest.current = value;

  useEffect(() => {
    if (!Number.isFinite(value) || value <= 0) {
      setStable(value);
      return undefined;
    }
    setStable((prev) => (prev <= 0 ? value : prev));
    const id = setInterval(() => {
      setStable(latest.current);
    }, intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);

  useEffect(() => {
    if (!Number.isFinite(value) || value <= 0) {
      setStable(value);
    }
  }, [value]);

  return stable;
}
