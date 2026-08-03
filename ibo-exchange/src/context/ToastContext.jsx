/**
 * Global floating toast notifications.
 *
 * Usage:
 *   const toast = useToast();
 *   toast.success('Order placed', 'Limit buy — 0.5 BTC @ 95,000 USDT');
 *   toast.error('Order failed', 'Insufficient balance');
 *   toast.info('Tip', 'Your order is resting on the book.');
 *   toast.warning('Market wide spread', 'Slippage may be high.');
 *
 * Wrap your app with <ToastProvider> in main.jsx.
 */

import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { CheckCircle2, XCircle, Info, AlertTriangle, X } from 'lucide-react';

// ─── Helpers ────────────────────────────────────────────────────────────────

let _seq = 0;

const ICON = {
  success: CheckCircle2,
  error: XCircle,
  info: Info,
  warning: AlertTriangle,
};

const STYLES = {
  success: {
    border: 'border-emerald-500/35',
    iconColor: 'text-emerald-400',
    bar: '#10b981',
    bg: 'bg-[#0d1a14]',
  },
  error: {
    border: 'border-rose-500/35',
    iconColor: 'text-rose-400',
    bar: '#f43f5e',
    bg: 'bg-[#1a0d10]',
  },
  info: {
    border: 'border-sky-500/35',
    iconColor: 'text-sky-400',
    bar: '#0ea5e9',
    bg: 'bg-[#0d141a]',
  },
  warning: {
    border: 'border-gold/35',
    iconColor: 'text-gold',
    bar: '#FE6C02',
    bg: 'bg-[#1a1408]',
  },
};

const DURATION = { success: 4000, error: 6000, info: 4500, warning: 5000 };

/**
 * Turn raw API / JS error messages into plain-English copy that any user can understand.
 */
export function friendlyError(raw) {
  if (!raw) return 'Something went wrong. Please try again.';
  const s = String(raw).toLowerCase();
  if (s.includes('insufficient') || s.includes('not enough') || s.includes('balance'))
    return 'Insufficient balance to complete this action.';
  if (s.includes('trading is paused') || s.includes('trading_paused'))
    return 'Trading is temporarily paused by the operator.';
  if (s.includes('new orders paused') || s.includes('orders_paused'))
    return 'New orders are temporarily paused. Please try again soon.';
  if (s.includes('transfers paused') || s.includes('transfers_paused'))
    return 'Transfers are temporarily paused by the operator.';
  if (s.includes('contract not found') || s.includes('contract has not'))
    return 'Contract not found — it may have expired or been delisted.';
  if (s.includes('position') && s.includes('not found'))
    return 'No open position found to close.';
  if (s.includes('order not found'))
    return 'Order not found — it may have already been filled or cancelled.';
  if (s.includes('not reached expiry'))
    return 'This contract has not yet expired and cannot be settled early.';
  if (s.includes('kyc') || s.includes('verification required'))
    return 'Identity verification (KYC) is required to trade.';
  if (s.includes('network') || s.includes('fetch') || s.includes('failed to fetch'))
    return 'Network error. Please check your connection and try again.';
  if (s.includes('unauthorized') || s.includes('401'))
    return 'Session expired. Please log in again.';
  if (s.includes('invalid') && s.includes('price'))
    return 'Invalid price — please enter a valid number.';
  if (s.includes('invalid') && s.includes('quantity'))
    return 'Invalid quantity — please enter a valid number.';
  // Return the raw message if it seems readable (no stack traces, no internal IDs)
  if (raw.length < 180 && !raw.includes('\n') && !raw.includes('Error:'))
    return raw;
  return 'Something went wrong. Please try again.';
}

// ─── Single toast item ───────────────────────────────────────────────────────

function ToastItem({ id, type, title, description, duration, onDismiss }) {
  const [visible, setVisible] = useState(false);
  const [progress, setProgress] = useState(100);
  const st = STYLES[type] ?? STYLES.info;
  const Icon = ICON[type] ?? Info;

  // Slide-in after mount
  useEffect(() => {
    const t = setTimeout(() => setVisible(true), 16);
    return () => clearTimeout(t);
  }, []);

  // Progress shrink
  useEffect(() => {
    const start = Date.now();
    const interval = setInterval(() => {
      const elapsed = Date.now() - start;
      setProgress(Math.max(0, 100 - (elapsed / duration) * 100));
    }, 50);
    return () => clearInterval(interval);
  }, [duration]);

  const dismiss = useCallback(() => {
    setVisible(false);
    setTimeout(() => onDismiss(id), 250);
  }, [id, onDismiss]);

  // Auto-dismiss
  useEffect(() => {
    const t = setTimeout(dismiss, duration);
    return () => clearTimeout(t);
  }, [dismiss, duration]);

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        transition: 'opacity 0.22s ease, transform 0.22s ease',
        opacity: visible ? 1 : 0,
        transform: visible ? 'translateX(0)' : 'translateX(20px)',
      }}
      className={`relative flex items-start gap-3 w-[340px] max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border ${st.border} ${st.bg} px-4 py-3.5 shadow-2xl`}
    >
      <Icon size={17} className={`${st.iconColor} shrink-0 mt-0.5`} strokeWidth={2.5} />

      <div className="flex-1 min-w-0">
        <p className="text-[13px] font-bold text-white leading-snug">{title}</p>
        {description && (
          <p className="text-[11px] text-white/55 mt-0.5 leading-relaxed break-words">{description}</p>
        )}
      </div>

      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss notification"
        className="shrink-0 ml-1 mt-0.5 rounded p-0.5 text-white/30 hover:text-white/70 hover:bg-white/[0.07] transition-colors"
      >
        <X size={13} />
      </button>

      {/* Progress bar */}
      <div className="absolute bottom-0 left-0 right-0 h-[2px]">
        <div
          style={{ width: `${progress}%`, backgroundColor: st.bar, transition: 'width 0.05s linear', opacity: 0.5 }}
          className="h-full"
        />
      </div>
    </div>
  );
}

// ─── Container ───────────────────────────────────────────────────────────────

function ToastContainer({ toasts, onDismiss }) {
  return createPortal(
    <div
      className="fixed top-4 right-4 z-[99990] flex flex-col gap-2 items-end pointer-events-none"
      aria-label="Notifications"
    >
      {toasts.map((t) => (
        <div key={t.id} className="pointer-events-auto">
          <ToastItem {...t} onDismiss={onDismiss} />
        </div>
      ))}
    </div>,
    document.body,
  );
}

// ─── Context + Provider ──────────────────────────────────────────────────────

const ToastCtx = createContext(null);

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const dismiss = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const add = useCallback((type, title, description) => {
    const id = ++_seq;
    const duration = DURATION[type] ?? 4500;
    setToasts((prev) => [...prev.slice(-4), { id, type, title, description, duration }]);
  }, []);

  return (
    <ToastCtx.Provider value={add}>
      {children}
      <ToastContainer toasts={toasts} onDismiss={dismiss} />
    </ToastCtx.Provider>
  );
}

// ─── Hook ────────────────────────────────────────────────────────────────────

export function useToast() {
  const add = useContext(ToastCtx);
  if (!add) {
    // Graceful degradation if used outside provider (e.g. tests)
    return {
      success: () => {},
      error: () => {},
      info: () => {},
      warning: () => {},
    };
  }
  return {
    /** Green toast — order placed, transfer complete, etc. */
    success: (title, description) => add('success', title, description),
    /** Red toast — order failed, network error, etc. */
    error: (title, description) => add('error', title, description),
    /** Blue/neutral toast — tips, informational messages. */
    info: (title, description) => add('info', title, description),
    /** Amber toast — warnings, degraded modes. */
    warning: (title, description) => add('warning', title, description),
  };
}
