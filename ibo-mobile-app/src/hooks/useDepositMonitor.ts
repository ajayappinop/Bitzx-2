/**
 * useDepositMonitor (mobile)
 *
 * Mirrors the web app's session-based on-demand deposit monitor. A single
 * ~7-minute session lives on the server; opening the Deposit screen or the
 * Transactions/History screen resumes the same session instead of starting
 * a new timer. No countdown is exposed here on purpose — screens should
 * only show a static "stay on this page" reminder while `isActive` is true.
 *
 * State machine
 * -------------
 *   idle → starting → active → (expiry / scan-limit) → expired
 *                         │
 *                    (screen unmount just stops local polling;
 *                     the backend session itself keeps its expiry time)
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { walletApi } from '../api/wallet.api';

export const MONITOR_STATUS = {
  IDLE: 'idle',
  STARTING: 'starting',
  ACTIVE: 'active',
  EXPIRED: 'expired',
  STOPPED: 'stopped',
  ERROR: 'error',
} as const;

export type MonitorStatus = (typeof MONITOR_STATUS)[keyof typeof MONITOR_STATUS];

const DEFAULT_SCAN_INTERVAL_SEC = 30;

export interface UseDepositMonitorResult {
  status: MonitorStatus;
  isActive: boolean;
  error: string | null;
  totalFound: number;
}

export function useDepositMonitor(opts?: {
  autoStart?: boolean;
  onDeposit?: (count: number) => void;
}): UseDepositMonitorResult {
  const { autoStart = true, onDeposit } = opts ?? {};

  const [status, setStatus] = useState<MonitorStatus>(MONITOR_STATUS.IDLE);
  const [error, setError] = useState<string | null>(null);
  const [totalFound, setTotalFound] = useState(0);

  const scanTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryDelayRef = useRef(0);
  const mountedRef = useRef(true);
  const sessionRef = useRef<any>(null);

  const clearTimer = useCallback(() => {
    if (scanTimerRef.current) {
      clearTimeout(scanTimerRef.current);
      scanTimerRef.current = null;
    }
  }, []);

  const scheduleScan = useCallback((session: any, cfg: any, immediate = false) => {
    clearTimer();
    const intervalSec = cfg?.scan_interval_sec ?? DEFAULT_SCAN_INTERVAL_SEC;
    const delay = immediate ? 0 : (retryDelayRef.current > 0 ? retryDelayRef.current * 1000 : intervalSec * 1000);
    retryDelayRef.current = 0;

    scanTimerRef.current = setTimeout(async () => {
      scanTimerRef.current = null;
      const sid = session?.id;
      if (!sid || !mountedRef.current) return;

      try {
        const { data } = await walletApi.scanDepositMonitor(sid);

        if (!mountedRef.current) return;

        if (data.status === 'expired' || data.status === 'stopped' || !data.ok) {
          if (data.status === 'expired' || (data as any).status === 'not_found') {
            setStatus(MONITOR_STATUS.EXPIRED);
          } else {
            setStatus(MONITOR_STATUS.STOPPED);
          }
          clearTimer();
          return;
        }

        if (data.skipped && (data.retry_in_sec ?? 0) > 0) {
          retryDelayRef.current = data.retry_in_sec as number;
        }

        if ((data.events_found ?? 0) > 0) {
          setTotalFound((prev) => prev + (data.events_found ?? 0));
          onDeposit?.(data.events_found ?? 0);
        }

        scheduleScan(session, cfg);
      } catch {
        // Network hiccup — retry after the usual interval.
        scheduleScan(session, cfg);
      }
    }, delay);
  }, [clearTimer, onDeposit]);

  const startSession = useCallback(async () => {
    setStatus(MONITOR_STATUS.STARTING);
    setError(null);
    clearTimer();
    try {
      const { data } = await walletApi.startDepositMonitor();
      const session = data?.session;
      const cfg = data?.config;
      sessionRef.current = session;

      if (session?.status === 'active') {
        setStatus(MONITOR_STATUS.ACTIVE);
        scheduleScan(session, cfg, true);
      } else {
        setStatus(MONITOR_STATUS.EXPIRED);
      }
    } catch (err: any) {
      const msg =
        err?.response?.data?.detail?.message ||
        err?.response?.data?.detail ||
        err?.message ||
        'Could not start deposit monitoring.';
      if (mountedRef.current) {
        setError(typeof msg === 'string' ? msg : 'Could not start deposit monitoring.');
        setStatus(MONITOR_STATUS.IDLE);
      }
    }
  }, [clearTimer, scheduleScan]);

  const restoreOrStart = useCallback(async () => {
    try {
      const { data } = await walletApi.getDepositMonitorStatus();
      const session = data?.session;
      const cfg = data?.config;

      if (session?.status === 'active') {
        sessionRef.current = session;
        setStatus(MONITOR_STATUS.ACTIVE);
        scheduleScan(session, cfg, true);
        return;
      }

      if (session?.status === 'expired' || session?.status === 'stopped') {
        // Let the server enforce cooldown — just attempt to start; the
        // server returns 429 if a cooldown is still active, which we
        // surface as a (silent) idle state.
        if (autoStart) await startSession();
        return;
      }

      if (autoStart) await startSession();
    } catch {
      if (autoStart) await startSession();
    }
  }, [autoStart, scheduleScan, startSession]);

  useEffect(() => {
    mountedRef.current = true;
    restoreOrStart();
    return () => {
      mountedRef.current = false;
      clearTimer();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    status,
    isActive: status === MONITOR_STATUS.ACTIVE,
    error,
    totalFound,
  };
}
