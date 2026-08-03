/**
 * DepositMonitorBanner
 *
 * Minimal countdown-only UI while deposit monitoring is active.
 * Hides completely when the session ends — no restart / pause messaging.
 */

import { RefreshCw, Clock } from 'lucide-react';
import { MONITOR_STATUS } from '@/hooks/useDepositMonitor';

function fmtCountdown(secs) {
  if (secs <= 0) return '0:00';
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function BannerShell({ children, className = '' }) {
  return (
    <div className={`rounded-xl border px-4 py-3 flex items-center gap-3 text-sm ${className}`}>
      {children}
    </div>
  );
}

/**
 * @param {object} props
 * @param {ReturnType<import('@/hooks/useDepositMonitor').useDepositMonitor>} props.monitor
 * @param {string}   [props.className]
 */
export default function DepositMonitorBanner({ monitor, className = '' }) {
  const { status, secondsLeft } = monitor;

  if (status === MONITOR_STATUS.IDLE || status === MONITOR_STATUS.STARTING) {
    return (
      <BannerShell className={`bg-white/3 border-[color:var(--ibo-border-solid)] ${className}`}>
        <RefreshCw size={15} className="text-[#5BB8FF]/60 shrink-0 animate-spin" />
        <p className="text-white/50 text-xs">Starting deposit check…</p>
      </BannerShell>
    );
  }

  if (status === MONITOR_STATUS.ACTIVE) {
    return (
      <BannerShell className={`bg-green-500/8 border-green-500/20 ${className}`}>
        <Clock size={15} className="text-green-400 shrink-0" />
        <span className="text-green-300 font-semibold text-xs tracking-wide">
          Checking for deposits
        </span>
        <span className="text-white/70 text-xs font-mono tabular-nums ml-auto">
          {fmtCountdown(secondsLeft)}
        </span>
      </BannerShell>
    );
  }

  // Expired, stopped, or error — hide the banner entirely.
  return null;
}
