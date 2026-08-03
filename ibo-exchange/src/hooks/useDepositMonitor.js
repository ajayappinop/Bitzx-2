/**
 * useDepositMonitor
 *
 * Manages the on-demand deposit monitoring session lifecycle.
 *
 * State machine
 * ─────────────
 *   idle  ──(start)──►  active  ──(expiry / scan-limit)──►  expired
 *                │                    │
 *                │               (user stop)
 *                │                    │
 *                └────────────────►  stopped
 *
 * The server is the authority on all timing.  The browser countdown is
 * display-only and derives from session.expires_at returned by the API.
 *
 * Security
 * ─────────
 * - session_id is stored in component state only (no localStorage) so it
 *   cannot be replayed after a tab close.
 * - All rate-limiting / expiry enforcement happens server-side.  The client
 *   respects ``retry_in_sec`` from scan responses to avoid hammering the API.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { authFetch } from '@/context/AuthContext';
import { exchangeApiOrigin } from '@/lib/apiBase';

const API = exchangeApiOrigin(import.meta.env.VITE_BACKEND_URL);

/** Monitoring session status values. */
export const MONITOR_STATUS = {
  IDLE:     'idle',
  STARTING: 'starting',
  ACTIVE:   'active',
  EXPIRED:  'expired',
  STOPPED:  'stopped',
  ERROR:    'error',
};

const DEFAULT_SCAN_INTERVAL_SEC = 30;
const COUNTDOWN_TICK_MS         = 1000;

/**
 * @param {object} opts
 * @param {boolean}  [opts.autoStart=false]  – start immediately on mount
 * @param {Function} [opts.onDeposit]        – called when ≥1 new event found
 * @param {Function} [opts.onExpire]         – called when session expires
 */
export function useDepositMonitor({ autoStart = false, onDeposit, onExpire } = {}) {
  const [status,          setStatus]          = useState(MONITOR_STATUS.IDLE);
  const [session,         setSession]         = useState(null);   // server session object
  const [config,          setConfig]          = useState(null);   // server config snapshot
  const [secondsLeft,     setSecondsLeft]     = useState(0);
  const [error,           setError]           = useState(null);
  const [lastScanAt,      setLastScanAt]      = useState(null);
  const [totalFound,      setTotalFound]      = useState(0);
  const [cooldownSec,     setCooldownSec]     = useState(0);      // seconds until restart allowed

  const scanTimerRef      = useRef(null);
  const countdownTimerRef = useRef(null);
  const cooldownTimerRef  = useRef(null);
  const retryDelayRef     = useRef(0);  // set when server asks us to wait

  // ── Helpers ───────────────────────────────────────────────────────────────

  const clearTimers = useCallback(() => {
    if (scanTimerRef.current)      { clearTimeout(scanTimerRef.current);      scanTimerRef.current = null; }
    if (countdownTimerRef.current) { clearInterval(countdownTimerRef.current); countdownTimerRef.current = null; }
  }, []);

  const startCountdown = useCallback((expiresAt) => {
    if (countdownTimerRef.current) clearInterval(countdownTimerRef.current);

    const tick = () => {
      const secs = Math.max(0, Math.floor((new Date(expiresAt) - Date.now()) / 1000));
      setSecondsLeft(secs);
    };
    tick();
    countdownTimerRef.current = setInterval(tick, COUNTDOWN_TICK_MS);
  }, []);

  const handleExpiry = useCallback(() => {
    clearTimers();
    setStatus(MONITOR_STATUS.EXPIRED);
    setSecondsLeft(0);
    onExpire?.();
  }, [clearTimers, onExpire]);

  // ── Scan logic ────────────────────────────────────────────────────────────

  const scheduleScan = useCallback((sessionObj, cfgObj, immediate = false) => {
    if (scanTimerRef.current) clearTimeout(scanTimerRef.current);

    const intervalSec = cfgObj?.scan_interval_sec ?? DEFAULT_SCAN_INTERVAL_SEC;
    const delay = immediate ? 0 : (retryDelayRef.current > 0 ? retryDelayRef.current * 1000 : intervalSec * 1000);
    retryDelayRef.current = 0;

    scanTimerRef.current = setTimeout(async () => {
      scanTimerRef.current = null;
      const sid = sessionObj?.id;
      if (!sid) return;

      try {
        const res = await authFetch(`${API}/api/wallet/deposit-monitor/scan`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ session_id: sid }),
        });

        const data = await res.json().catch(() => ({}));

        // Session expired or stopped server-side.
        if (data.status === 'expired' || data.status === 'stopped' || !data.ok) {
          if (data.status === 'expired' || data.status === 'not_found') {
            handleExpiry();
          } else {
            setStatus(MONITOR_STATUS.STOPPED);
            clearTimers();
          }
          return;
        }

        // Server asked us to back off.
        if (data.skipped && data.retry_in_sec > 0) {
          retryDelayRef.current = data.retry_in_sec;
        }

        // Update session state.
        setSession(prev => prev ? { ...prev, scan_count: data.scan_count } : prev);
        setLastScanAt(new Date().toISOString());

        if (data.events_found > 0) {
          setTotalFound(prev => prev + data.events_found);
          onDeposit?.(data.events_found);
        }

        // Schedule next scan.
        setSession(prev => {
          scheduleScan(prev, cfgObj);
          return prev;
        });
      } catch {
        // Network error — retry after interval.
        scheduleScan(sessionObj, cfgObj);
      }
    }, delay);
  }, [clearTimers, handleExpiry, onDeposit]);

  // Internal start — must be declared before `start` / `restoreOrStart` reference it.
  const startSession = useCallback(async () => {
    setStatus(MONITOR_STATUS.STARTING);
    setError(null);
    clearTimers();
    try {
      const res = await authFetch(`${API}/api/wallet/deposit-monitor/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        const msg = data?.detail?.message || data?.detail || 'Could not start monitoring.';
        const retry = data?.detail?.retry_after_sec || 0;
        setError(msg);
        setStatus(MONITOR_STATUS.IDLE);
        if (retry > 0) {
          setCooldownSec(retry);
          cooldownTimerRef.current = setInterval(() => {
            setCooldownSec(prev => {
              if (prev <= 1) {
                clearInterval(cooldownTimerRef.current);
                cooldownTimerRef.current = null;
                return 0;
              }
              return prev - 1;
            });
          }, 1000);
        }
        return;
      }

      const { session: sess, config: cfg } = data;
      setSession(sess);
      setConfig(cfg);

      if (sess.status === 'active') {
        setStatus(MONITOR_STATUS.ACTIVE);
        startCountdown(sess.expires_at);
        scheduleScan(sess, cfg, true);
      } else {
        setStatus(MONITOR_STATUS.EXPIRED);
      }
    } catch (e) {
      setError(e.message || 'Network error.');
      setStatus(MONITOR_STATUS.IDLE);
    }
  }, [clearTimers, startCountdown, scheduleScan]);

  // ── Start (user-triggered restart after expiry / stop) ────────────────────

  const start = useCallback(async () => {
    if (status === MONITOR_STATUS.STARTING || status === MONITOR_STATUS.ACTIVE) return;
    if (cooldownSec > 0) return;
    await startSession();
  }, [status, cooldownSec, startSession]);

  // ── Stop ───────────────────────────────────────────────────────────────────

  const stop = useCallback(async () => {
    clearTimers();
    setStatus(MONITOR_STATUS.STOPPED);
    setSecondsLeft(0);

    const sid = session?.id;
    if (!sid) return;
    try {
      await authFetch(`${API}/api/wallet/deposit-monitor/stop`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: sid }),
      });
    } catch {
      // Best-effort; local state is already updated.
    }
    setSession(null);
  }, [session, clearTimers]);

  // ── Restore on mount — or auto-start if no prior session ──────────────────
  //
  // On every page open we check the server for an existing session:
  //   • Active   → resume it (countdown + scans pick up where they left off).
  //   • Expired  → show expired banner + start cooldown countdown.
  //   • None     → start a brand-new session immediately (this is the normal
  //                path: user opens Wallet → History → monitoring begins).

  const restoreOrStart = useCallback(async () => {
    try {
      const res = await authFetch(`${API}/api/wallet/deposit-monitor/status`);
      if (!res.ok) {
        // Status endpoint failed — still try to start a fresh session.
        if (autoStart) await startSession();
        return;
      }
      const data = await res.json().catch(() => ({}));
      const sess = data?.session;
      const cfg  = data?.config;

      if (cfg) setConfig(cfg);

      if (sess?.status === 'active') {
        // Existing active session — resume without creating a new one.
        setSession(sess);
        setStatus(MONITOR_STATUS.ACTIVE);
        startCountdown(sess.expires_at);
        scheduleScan(sess, cfg, true);
        return;
      }

      if (sess?.status === 'expired' || sess?.status === 'stopped') {
        setSession(sess);
        setStatus(MONITOR_STATUS.EXPIRED);
        const cooldown = cfg?.cooldown_sec ?? 60;
        if (cooldown > 0) {
          const endedAt = sess.ended_at ? new Date(sess.ended_at) : new Date();
          const elapsed = (Date.now() - endedAt.getTime()) / 1000;
          const remaining = Math.max(0, cooldown - elapsed);
          if (remaining > 0) {
            setCooldownSec(Math.ceil(remaining));
            cooldownTimerRef.current = setInterval(() => {
              setCooldownSec(prev => {
                if (prev <= 1) {
                  clearInterval(cooldownTimerRef.current);
                  cooldownTimerRef.current = null;
                  return 0;
                }
                return prev - 1;
              });
            }, 1000);
            return; // don't auto-start during cooldown
          }
        }
        // Cooldown has passed — auto-start a new session.
        if (autoStart) await startSession();
        return;
      }

      // No prior session — start immediately.
      if (autoStart) await startSession();
    } catch {
      // Silent — restore failure should not block the page.
    }
  }, [autoStart, startCountdown, scheduleScan, startSession]);

  useEffect(() => {
    restoreOrStart();
    return () => {
      clearTimers();
      if (cooldownTimerRef.current) clearInterval(cooldownTimerRef.current);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Client-side countdown expiry → hide banner and run parent redirect.
  useEffect(() => {
    if (status === MONITOR_STATUS.ACTIVE && secondsLeft <= 0) {
      handleExpiry();
    }
  }, [status, secondsLeft, handleExpiry]);

  return {
    /** One of the MONITOR_STATUS values. */
    status,
    /** Raw session object returned by the server. */
    session,
    /** Platform config snapshot (scan_interval_sec, message, …). */
    config,
    /** Seconds remaining in the current session (display only). */
    secondsLeft,
    /** Seconds remaining in the post-session cooldown. */
    cooldownSec,
    /** ISO timestamp of the last successful scan. */
    lastScanAt,
    /** Count of deposit events discovered this session. */
    totalFound,
    /** Error message (auth/network/server). */
    error,
    /** Start or restart a monitoring session. */
    start,
    /** User-initiated stop. */
    stop,
    /** Whether the session is currently active. */
    isActive: status === MONITOR_STATUS.ACTIVE,
    /** Whether the user can restart now (no cooldown in progress). */
    canRestart: status !== MONITOR_STATUS.ACTIVE
                && status !== MONITOR_STATUS.STARTING
                && cooldownSec <= 0,
  };
}
