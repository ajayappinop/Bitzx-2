/**
 * Navbar notifications — Delta-style right-side overlay drawer.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { AnimatePresence } from 'framer-motion';
import {
  Bell, CheckCheck, Shield, Wallet, Gift, AlertCircle, Inbox, ChevronRight,
} from 'lucide-react';
import { NavSideOverlay } from '@/components/layout/NavSideOverlay';

const STORAGE_KEY = 'iboex_nav_notifs_v1';

const SEED = [
  {
    id: 'welcome',
    title: 'Welcome to trading',
    body: 'Complete KYC to unlock deposits, withdrawals, and full trading.',
    type: 'info',
    href: '/account/kyc',
    ts: Date.now() - 1000 * 60 * 30,
  },
  {
    id: 'security',
    title: 'Secure your account',
    body: 'Enable 2FA for extra protection on logins and withdrawals.',
    type: 'security',
    href: '/account/security',
    ts: Date.now() - 1000 * 60 * 60 * 5,
  },
  {
    id: 'funds',
    title: 'Add funds to start',
    body: 'Deposit INR or crypto to fund your Funding and F&O wallets.',
    type: 'wallet',
    href: '/account/deposits',
    ts: Date.now() - 1000 * 60 * 60 * 26,
  },
  {
    id: 'refer',
    title: 'Refer & earn',
    body: 'Invite friends and earn rewards on their trading activity.',
    type: 'promo',
    href: '/account/refer',
    ts: Date.now() - 1000 * 60 * 60 * 72,
  },
];

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { dismissed: [], read: [] };
    const j = JSON.parse(raw);
    return {
      dismissed: Array.isArray(j.dismissed) ? j.dismissed : [],
      read: Array.isArray(j.read) ? j.read : [],
    };
  } catch {
    return { dismissed: [], read: [] };
  }
}

function saveState(state) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch { /* ignore */ }
}

function fmtTime(ts) {
  const d = Date.now() - ts;
  const m = Math.floor(d / 60000);
  if (m < 1) return 'Just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.floor(h / 24);
  return `${days}d ago`;
}

function typeIcon(type) {
  if (type === 'security') return Shield;
  if (type === 'wallet') return Wallet;
  if (type === 'promo') return Gift;
  if (type === 'alert') return AlertCircle;
  return Bell;
}

export default function NavNotifications({ className = '', onOpenChange }) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState('all'); // all | unread
  const [state, setState] = useState(loadState);
  const triggerRef = useRef(null);
  const panelRef = useRef(null);

  const setOpenSafe = useCallback((next) => {
    setOpen((prev) => {
      const v = typeof next === 'function' ? next(prev) : next;
      onOpenChange?.(v);
      return v;
    });
  }, [onOpenChange]);

  const items = SEED
    .filter((n) => !state.dismissed.includes(n.id))
    .map((n) => ({ ...n, read: state.read.includes(n.id) }))
    .sort((a, b) => b.ts - a.ts);

  const unread = items.filter((n) => !n.read).length;
  const visible = filter === 'unread' ? items.filter((n) => !n.read) : items;

  const persist = useCallback((next) => {
    setState(next);
    saveState(next);
  }, []);

  const markAllRead = () => {
    persist({
      ...state,
      read: Array.from(new Set([...state.read, ...items.map((n) => n.id)])),
    });
  };

  const markRead = (id) => {
    if (state.read.includes(id)) return;
    persist({ ...state, read: [...state.read, id] });
  };

  const clearAll = () => {
    persist({
      read: state.read,
      dismissed: Array.from(new Set([...state.dismissed, ...items.map((n) => n.id)])),
    });
  };

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') setOpenSafe(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, setOpenSafe]);

  return (
    <div className={`nav-overlay-trigger ${className}`.trim()}>
      <button
        type="button"
        ref={triggerRef}
        className={`delta-nav-tool-btn nav-notif-trigger${open ? ' is-active' : ''}`}
        title="Notifications"
        aria-label={unread ? `Notifications, ${unread} unread` : 'Notifications'}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpenSafe((v) => !v)}
      >
        <Bell size={18} strokeWidth={1.6} />
        {unread > 0 ? (
          <span className="nav-notif-badge" aria-hidden>
            {unread > 9 ? '9+' : unread}
          </span>
        ) : null}
      </button>

      {typeof document !== 'undefined' && createPortal(
        <AnimatePresence>
          {open ? (
            <NavSideOverlay
              open={open}
              onClose={() => setOpenSafe(false)}
              panelRef={panelRef}
              title="Notifications"
              subtitle={unread ? `${unread} unread` : "You're all caught up"}
              ariaLabel="Notifications"
              size="md"
              footer={(
                <>
                  <button type="button" className="delta-side-panel__foot-btn" onClick={clearAll} disabled={!items.length}>
                    Clear all
                  </button>
                  <div className="delta-side-panel__foot-right">
                    {unread > 0 ? (
                      <button type="button" className="delta-side-panel__foot-link" onClick={markAllRead}>
                        <CheckCheck size={14} />
                        Mark all read
                      </button>
                    ) : null}
                  </div>
                </>
              )}
            >
              <div className="delta-side-tabs" role="tablist" aria-label="Filter notifications">
                <button
                  type="button"
                  role="tab"
                  aria-selected={filter === 'all'}
                  className={`delta-side-tabs__btn${filter === 'all' ? ' is-on' : ''}`}
                  onClick={() => setFilter('all')}
                >
                  All
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={filter === 'unread'}
                  className={`delta-side-tabs__btn${filter === 'unread' ? ' is-on' : ''}`}
                  onClick={() => setFilter('unread')}
                >
                  Unread{unread ? ` (${unread})` : ''}
                </button>
              </div>

              <div className="delta-side-card nav-overlay-notif-list">
                {visible.length === 0 ? (
                  <div className="nav-overlay-empty">
                    <Inbox size={28} strokeWidth={1.5} />
                    <p>{filter === 'unread' ? 'No unread alerts' : 'No notifications'}</p>
                    <span>Trade fills, security tips, and offers show up here.</span>
                  </div>
                ) : (
                  visible.map((n) => {
                    const Icon = typeIcon(n.type);
                    const body = (
                      <>
                        <span className={`nav-overlay-notif__ico is-${n.type}`}>
                          <Icon size={16} strokeWidth={1.8} />
                        </span>
                        <span className="nav-overlay-notif__meta">
                          <span className="nav-overlay-notif__title">
                            {n.title}
                            {!n.read ? <span className="nav-overlay-notif__dot" /> : null}
                          </span>
                          <span className="nav-overlay-notif__text">{n.body}</span>
                          <span className="nav-overlay-notif__time">{fmtTime(n.ts)}</span>
                        </span>
                        <ChevronRight size={16} className="nav-overlay-notif__chev" />
                      </>
                    );
                    if (n.href) {
                      return (
                        <Link
                          key={n.id}
                          to={n.href}
                          className={`nav-overlay-notif${!n.read ? ' is-unread' : ''}`}
                          onClick={() => {
                            markRead(n.id);
                            setOpenSafe(false);
                          }}
                        >
                          {body}
                        </Link>
                      );
                    }
                    return (
                      <button
                        key={n.id}
                        type="button"
                        className={`nav-overlay-notif${!n.read ? ' is-unread' : ''}`}
                        onClick={() => markRead(n.id)}
                      >
                        {body}
                      </button>
                    );
                  })
                )}
              </div>
            </NavSideOverlay>
          ) : null}
        </AnimatePresence>,
        document.body,
      )}
    </div>
  );
}
