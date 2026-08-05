/**
 * Shared right-side nav overlay (Delta-style drawer under sticky navbar).
 */
import { useEffect, useLayoutEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { X } from 'lucide-react';
import { useTheme } from '@/context/ThemeContext';

export function useNavOverlayTop(open) {
  const [topOffset, setTopOffset] = useState(48);

  useEffect(() => {
    if (!open) return undefined;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  useLayoutEffect(() => {
    if (!open) return undefined;
    const measure = () => {
      const shell = document.querySelector('[data-delta-nav-shell]');
      if (shell) {
        const { bottom } = shell.getBoundingClientRect();
        setTopOffset(Math.max(0, Math.round(bottom)));
        return;
      }
      const header = document.querySelector('header.delta-navbar');
      if (header) {
        const { bottom } = header.getBoundingClientRect();
        setTopOffset(Math.max(0, Math.round(bottom)));
      }
    };
    measure();
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => {
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
  }, [open]);

  return topOffset;
}

export function NavSideOverlay({
  open,
  onClose,
  panelRef,
  title,
  subtitle,
  ariaLabel,
  children,
  footer,
  size = 'md',
}) {
  const { isLight } = useTheme();
  const topOffset = useNavOverlayTop(open);

  if (!open) return null;

  return (
    <div
      className="delta-apps-root delta-side-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={ariaLabel || title}
      style={{ top: topOffset }}
    >
      <motion.button
        type="button"
        aria-label={`Close ${title || 'panel'}`}
        className="delta-apps-backdrop"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.2 }}
        onClick={onClose}
      />
      <motion.aside
        ref={panelRef}
        className={`delta-apps-panel delta-side-panel delta-side-panel--${size}${isLight ? ' delta-apps-panel--light' : ' delta-apps-panel--dark'}`}
        initial={{ x: '100%' }}
        animate={{ x: 0 }}
        exit={{ x: '100%' }}
        transition={{ type: 'tween', duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
      >
        <header className="delta-side-panel__head">
          <div className="min-w-0">
            <h2 className="delta-side-panel__title">{title}</h2>
            {subtitle ? <p className="delta-side-panel__sub">{subtitle}</p> : null}
          </div>
          <button
            type="button"
            className="delta-side-panel__close"
            onClick={onClose}
            aria-label="Close"
          >
            <X size={18} strokeWidth={2} />
          </button>
        </header>
        <div className="delta-apps-panel__scroll delta-side-panel__body">
          {children}
        </div>
        {footer ? (
          <footer className="delta-side-panel__foot">
            {footer}
          </footer>
        ) : null}
      </motion.aside>
    </div>
  );
}
