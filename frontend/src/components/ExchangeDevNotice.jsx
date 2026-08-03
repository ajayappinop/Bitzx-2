import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  forwardRef,
} from 'react';
import { AlertTriangle, X } from 'lucide-react';

export const EXCHANGE_DEV_MESSAGE =
  'The exchange website is under development. Please check back soon.';

export const BUY_DEV_MESSAGE =
  'Token purchase is under development. Please check back soon.';

const ExchangeDevNoticeContext = createContext(null);

export function ExchangeDevNoticeProvider({ children }) {
  const [visible, setVisible] = useState(false);
  const [message, setMessage] = useState(EXCHANGE_DEV_MESSAGE);
  const timerRef = useRef(null);

  const hideNotice = useCallback(() => {
    setVisible(false);
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const showNotice = useCallback((nextMessage = EXCHANGE_DEV_MESSAGE) => {
    setMessage(typeof nextMessage === 'string' ? nextMessage : EXCHANGE_DEV_MESSAGE);
    setVisible(true);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      setVisible(false);
      timerRef.current = null;
    }, 5000);
  }, []);

  const showBuyNotice = useCallback(() => {
    showNotice(BUY_DEV_MESSAGE);
  }, [showNotice]);

  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  const value = useMemo(
    () => ({ showNotice, showBuyNotice, hideNotice }),
    [showNotice, showBuyNotice, hideNotice],
  );

  return (
    <ExchangeDevNoticeContext.Provider value={value}>
      {children}
      <div
        role="status"
        aria-live="polite"
        className={`fixed left-1/2 z-[10000] w-[min(28rem,calc(100vw-1.5rem))] -translate-x-1/2 transition-all duration-300 ${
          visible
            ? 'bottom-[max(5.5rem,calc(env(safe-area-inset-bottom,0px)+4.75rem))] opacity-100 translate-y-0'
            : 'pointer-events-none bottom-0 opacity-0 translate-y-4'
        }`}
        data-testid="exchange-dev-notice"
      >
        {visible && (
          <div className="flex items-start gap-3 rounded-2xl border border-amber-500/40 bg-surface-card px-4 py-3 shadow-[0_16px_48px_rgba(0,0,0,0.35)]">
            <span className="mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-amber-500/15 text-amber-500">
              <AlertTriangle size={16} strokeWidth={2.5} />
            </span>
            <p className="flex-1 pt-1 text-sm font-medium leading-snug text-ink">
              {message}
            </p>
            <button
              type="button"
              onClick={hideNotice}
              aria-label="Dismiss notice"
              className="rounded-lg p-1 text-ink-muted hover:bg-[#0EA4AB]/10 hover:text-ink"
            >
              <X size={16} />
            </button>
          </div>
        )}
      </div>
    </ExchangeDevNoticeContext.Provider>
  );
}

export function useExchangeDevNotice() {
  const ctx = useContext(ExchangeDevNoticeContext);
  if (!ctx) {
    throw new Error('useExchangeDevNotice must be used within ExchangeDevNoticeProvider');
  }
  return ctx;
}

/**
 * Drop-in for anchors that previously opened the exchange site.
 * Shows a bottom under-development warning instead of navigating away.
 */
export const ExchangeLink = forwardRef(function ExchangeLink(
  { as: Comp = 'button', children, onClick, href, target, rel, type, ...rest },
  ref,
) {
  const { showNotice } = useExchangeDevNotice();

  const handleClick = (e) => {
    e.preventDefault();
    e.stopPropagation();
    showNotice();
    onClick?.(e);
  };

  if (Comp === 'button' || Comp === 'motion.button') {
    return (
      <Comp
        ref={ref}
        type={type || 'button'}
        onClick={handleClick}
        {...rest}
      >
        {children}
      </Comp>
    );
  }

  return (
    <Comp
      ref={ref}
      href={href || '#'}
      role="button"
      onClick={handleClick}
      {...rest}
    >
      {children}
    </Comp>
  );
});

export default ExchangeDevNoticeProvider;
