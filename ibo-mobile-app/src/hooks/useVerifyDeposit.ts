/**
 * useVerifyDeposit
 *
 * Calls GET /api/wallet/verify-deposit while the deposit/history page is
 * mounted and stops automatically when the component unmounts (user navigates
 * away).  Zero background RPC usage — the blockchain is only queried while
 * the user is actively viewing the deposit page.
 *
 * Flow:
 *   Screen mounts   → immediate verify call + start interval
 *   Every 5 min     → verify call (configurable via VERIFY_DEPOSIT_INTERVAL_MS)
 *   Screen unmounts → clearTimeout → no further calls
 *
 * @param opts.onDeposit   - called with event count when ≥1 new deposit is found
 * @param opts.intervalMs  - polling interval in ms (default: 5 minutes)
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { walletApi } from '../api/wallet.api';

const DEFAULT_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

export interface UseVerifyDepositResult {
  /** True while an RPC scan is in-flight. */
  isVerifying: boolean;
  /** ISO timestamp of the last completed call, or null before the first call. */
  lastVerifiedAt: string | null;
  /** Running total of new deposit events found this session. */
  depositsFound: number;
  /** Error message from the most recent failed call, or null. */
  error: string | null;
  /** Imperatively trigger a scan (e.g. pull-to-refresh). */
  refresh: () => void;
}

export function useVerifyDeposit(opts?: {
  onDeposit?: (count: number) => void;
  intervalMs?: number;
}): UseVerifyDepositResult {
  const { onDeposit, intervalMs = DEFAULT_INTERVAL_MS } = opts ?? {};

  const [isVerifying,    setIsVerifying]    = useState(false);
  const [lastVerifiedAt, setLastVerifiedAt] = useState<string | null>(null);
  const [depositsFound,  setDepositsFound]  = useState(0);
  const [error,          setError]          = useState<string | null>(null);

  const mountedRef     = useRef(true);
  const timerRef       = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryAfterRef  = useRef(0); // server-requested back-off (ms)

  const doVerify = useCallback(async () => {
    if (!mountedRef.current) return;

    setIsVerifying(true);
    setError(null);

    try {
      const res  = await walletApi.verifyDeposit();
      const data = res.data;

      if (!mountedRef.current) return;

      if (data.skipped && (data.retry_in_sec ?? 0) > 0) {
        retryAfterRef.current = (data.retry_in_sec as number) * 1000;
      } else if ((data.events_found ?? 0) > 0) {
        setDepositsFound(prev => prev + (data.events_found ?? 0));
        onDeposit?.(data.events_found ?? 0);
      }

      setLastVerifiedAt(new Date().toISOString());
    } catch (err: any) {
      if (mountedRef.current) {
        const msg =
          err?.response?.data?.detail ||
          err?.message ||
          'Deposit check failed.';
        setError(typeof msg === 'string' ? msg : 'Deposit check failed.');
      }
    } finally {
      if (mountedRef.current) {
        setIsVerifying(false);
      }
    }
  }, [onDeposit]);

  const scheduleNext = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    const delay = retryAfterRef.current > 0 ? retryAfterRef.current : intervalMs;
    retryAfterRef.current = 0;
    timerRef.current = setTimeout(async () => {
      await doVerify();
      if (mountedRef.current) scheduleNext();
    }, delay);
  }, [doVerify, intervalMs]);

  useEffect(() => {
    mountedRef.current = true;

    // Fire immediately, then schedule recurring.
    (async () => {
      await doVerify();
      if (mountedRef.current) scheduleNext();
    })();

    return () => {
      mountedRef.current = false;
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    isVerifying,
    lastVerifiedAt,
    depositsFound,
    error,
    refresh: doVerify,
  };
}
