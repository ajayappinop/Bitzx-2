/**
 * Navbar settings — Delta-style right-side overlay drawer.
 */
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { AnimatePresence } from 'framer-motion';
import {
  Settings, User, Shield, SlidersHorizontal, KeyRound, CircleDollarSign,
  HelpCircle, ChevronRight, Moon, Sun,
} from 'lucide-react';
import { useTheme } from '@/context/ThemeContext';
import { NavSideOverlay } from '@/components/layout/NavSideOverlay';

const SETTINGS_LINKS = [
  {
    group: 'Account',
    items: [
      { label: 'Preferences', desc: 'Trading, display & notification defaults', to: '/account/preferences', icon: SlidersHorizontal },
      { label: 'Profile', desc: 'Name, email & avatar', to: '/account/profile', icon: User },
      { label: 'Security', desc: 'Password, 2FA & sessions', to: '/account/security', icon: Shield },
      { label: 'API keys', desc: 'Programmatic access', to: '/account/api-keys', icon: KeyRound },
      { label: 'Bank details', desc: 'INR payout profile', to: '/account/bank-details', icon: CircleDollarSign },
    ],
  },
  {
    group: 'Support',
    items: [
      { label: 'Help center', desc: 'Guides & FAQs', to: '/support', icon: HelpCircle },
    ],
  },
];

export default function NavSettings({ className = '', onOpenChange }) {
  const { isLight, toggleTheme } = useTheme();
  const [open, setOpen] = useState(false);
  const triggerRef = useRef(null);
  const panelRef = useRef(null);

  const setOpenSafe = (next) => {
    setOpen((prev) => {
      const v = typeof next === 'function' ? next(prev) : next;
      onOpenChange?.(v);
      return v;
    });
  };

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') setOpenSafe(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <div className={`nav-overlay-trigger ${className}`.trim()}>
      <button
        type="button"
        ref={triggerRef}
        className={`delta-nav-tool-btn${open ? ' is-active' : ''}`}
        title="Settings"
        aria-label="Settings"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpenSafe((v) => !v)}
      >
        <Settings size={18} strokeWidth={1.6} />
      </button>

      {typeof document !== 'undefined' && createPortal(
        <AnimatePresence>
          {open ? (
            <NavSideOverlay
              open={open}
              onClose={() => setOpenSafe(false)}
              panelRef={panelRef}
              title="Settings"
              subtitle="Account · trading · appearance"
              ariaLabel="Settings"
              size="md"
            >
              <div className="delta-side-card">
                <p className="delta-apps-section-title">Appearance</p>
                <button
                  type="button"
                  className="delta-side-row"
                  onClick={toggleTheme}
                >
                  <span className="delta-side-row__ico">
                    {isLight ? <Moon size={17} strokeWidth={1.7} /> : <Sun size={17} strokeWidth={1.7} />}
                  </span>
                  <span className="delta-side-row__meta">
                    <span className="delta-side-row__label">Theme</span>
                    <span className="delta-side-row__desc">
                      {isLight ? 'Light mode · tap for dark' : 'Dark mode · tap for light'}
                    </span>
                  </span>
                  <span className={`pref-switch${isLight ? '' : ' is-on'}`} aria-hidden>
                    <span className="pref-switch__track">
                      <span className="pref-switch__thumb" />
                    </span>
                  </span>
                </button>
              </div>

              {SETTINGS_LINKS.map((group) => (
                <div key={group.group} className="delta-side-card">
                  <p className="delta-apps-section-title">{group.group}</p>
                  <div className="delta-side-rows">
                    {group.items.map((item) => {
                      const Icon = item.icon;
                      return (
                        <Link
                          key={item.to + item.label}
                          to={item.to}
                          className="delta-side-row"
                          onClick={() => setOpenSafe(false)}
                        >
                          <span className="delta-side-row__ico">
                            <Icon size={17} strokeWidth={1.7} />
                          </span>
                          <span className="delta-side-row__meta">
                            <span className="delta-side-row__label">{item.label}</span>
                            <span className="delta-side-row__desc">{item.desc}</span>
                          </span>
                          <ChevronRight size={16} className="delta-side-row__chev" />
                        </Link>
                      );
                    })}
                  </div>
                </div>
              ))}
            </NavSideOverlay>
          ) : null}
        </AnimatePresence>,
        document.body,
      )}
    </div>
  );
}
