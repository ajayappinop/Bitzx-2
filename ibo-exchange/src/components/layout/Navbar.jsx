import { useState, useEffect, useLayoutEffect, useRef, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ChevronDown, LogOut, User, LayoutDashboard, Menu, X, Wallet,
  ExternalLink, Shield, Zap, LineChart, HelpCircle, Settings,
  Download, Coins, Gift, Search, ArrowLeftRight, CircleHelp,
  LayoutGrid, Sun, Moon, CircleDollarSign,
  BarChart3, Store, QrCode, Users,
  FileText, Banknote, Share2, Monitor,
  StickyNote, Mail,
} from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useTheme } from '@/context/ThemeContext';
import { exchangeWsPath, normalizeMarketsList } from '@/services/marketApi';
import { exchangeApiOrigin } from '@/lib/apiBase';
import BrandLogo from '@/components/ui/BrandLogo';
import NavWalletDropdown from '@/components/layout/NavWalletDropdown';
import NavNotifications from '@/components/layout/NavNotifications';
import NavSettings from '@/components/layout/NavSettings';
import { useMobileAppRelease } from '@/hooks/useMobileAppRelease';
import { SITE_CONFIG } from '@/lib/siteConfig';

const API = exchangeApiOrigin(import.meta.env.VITE_BACKEND_URL);
const IS_DEV = import.meta.env.DEV;

const TICKER_PAIRS = ['IBOUSDT', 'BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'XRPUSDT'];
const USER_MENU_WIDTH_PX = 220;
const DROPDOWN_EDGE_GAP = 8;
const MORE_MENU_WIDTH_PX = 280;
const SEARCH_PANEL_WIDTH_PX = 360;

/** Primary — Trade · Markets · Futures · Options · Spot (flat, no nested menus) */
const NAV_PRIMARY = [
  { label: 'Trade', to: '/trade/IBOUSDT' },
  { label: 'Markets', to: '/markets' },
  { label: 'Futures', to: '/futures/BTCUSDT-PERP' },
  { label: 'Options', to: '/options/BTCUSDT' },
  { label: 'Spot', to: '/trade/IBOUSDT' },
];

/** More — other products only; none of the primary labels/routes */
const NAV_MORE = [
  { label: 'Account', to: '/account/positions', icon: LayoutDashboard },
  { label: 'Wallet', to: '/account/balances', icon: Wallet },
  { label: 'P2P', to: '/p2p', icon: Store },
  { label: 'Refer & Earn', to: '/account/refer', icon: Gift },
  { label: 'List Your Coin', to: '/list-coin', icon: Coins },
  { label: 'IBO Markets', to: '/ibo-markets', icon: BarChart3 },
  { label: 'Quick Trade', to: '/quick-trade', icon: Zap },
];

const APPS_RESOURCES = [
  { label: 'Trading Fees', to: '/terms-of-service', icon: CircleDollarSign },
  { label: 'Contract Specifications', to: '/futures/BTCUSDT-PERP', icon: LayoutGrid },
  { label: 'Trade Data', to: '/markets', icon: LineChart },
  { label: 'Settlement Prices', to: '/markets', icon: Banknote },
  { label: 'Offers', to: '/account/refer', icon: Gift },
  { label: 'Refer and Earn', to: '/account/refer', icon: Share2 },
  { label: 'Demo Trading', to: '/register', icon: Monitor },
];

const APPS_HELP = [
  { label: 'Raise a Support Ticket', to: '/account/support', icon: StickyNote },
  { label: 'Support Center', to: '/support', icon: Mail },
  { label: 'Tax Info', to: '/terms-of-service', icon: FileText },
];

const SEARCH_SHORTCUTS = [
  { label: 'Markets', to: '/markets', hint: 'Browse all pairs' },
  { label: 'BTC Futures', to: '/futures/BTCUSDT-PERP', hint: 'BTCUSDT-PERP' },
  { label: 'BTC Options', to: '/options/BTCUSDT', hint: 'Options chain' },
  { label: 'Spot Trade', to: '/trade/IBOUSDT', hint: 'IBO / USDT' },
  { label: 'Positions', to: '/account/positions', hint: 'Open positions' },
  { label: 'P&L Analytics', to: '/account/pnl', hint: 'Profit & loss' },
  { label: 'Wallet', to: '/account/balances', hint: 'Balances' },
  { label: 'Bank Details', to: '/account/bank-details', hint: 'INR payout' },
  { label: 'Profile', to: '/account/profile', hint: 'Account info' },
  { label: 'Security', to: '/account/security', hint: '2FA & password' },
  { label: 'Add Funds', to: '/account/deposits', hint: 'INR deposit' },
  { label: 'Quick Trade', to: '/quick-trade', hint: 'Convert' },
  { label: 'P2P', to: '/p2p', hint: 'Marketplace' },
  { label: 'Support', to: '/support', hint: 'Help centre' },
];

function AppsPanelLink({ item, onClick }) {
  const Icon = item.icon;
  const className = 'delta-apps-link';
  const inner = (
    <>
      <Icon size={18} strokeWidth={1.6} className="delta-apps-link__icon" />
      <span>{item.label}</span>
    </>
  );
  if (item.href) {
    return (
      <a
        href={item.href}
        className={className}
        onClick={onClick}
        {...(item.external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
      >
        {inner}
      </a>
    );
  }
  return (
    <Link to={item.to} className={className} onClick={onClick}>
      {inner}
    </Link>
  );
}

function AppsSidePanel({
  open,
  onClose,
  panelRef,
  isLight,
  appAvailable,
  appStoreHref,
  appLinkProps,
  appIsGooglePlay,
  appRelease,
}) {
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

  return (
    <AnimatePresence>
      {open ? (
        <div
          className="delta-apps-root"
          role="dialog"
          aria-modal="true"
          aria-label="Resources and apps"
          style={{ top: topOffset }}
        >
          <motion.button
            type="button"
            aria-label="Close apps panel"
            className="delta-apps-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={onClose}
          />
          <motion.aside
            ref={panelRef}
            className={`delta-apps-panel${isLight ? ' delta-apps-panel--light' : ' delta-apps-panel--dark'}`}
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'tween', duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
          >
            <div className="delta-apps-panel__scroll">
              {/* App download card */}
              <div className="delta-apps-card delta-apps-download">
                <div className="delta-apps-qr" aria-hidden>
                  <QrCode size={48} strokeWidth={1.25} />
                </div>
                <div className="delta-apps-store-btns">
                  {appAvailable && appStoreHref && appLinkProps ? (
                    <div className="delta-apps-store-btn" role="text">
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                        <path d="M3.6 1.8 13.5 12 3.6 22.2c-.5-.3-.9-.9-.9-1.6V3.4c0-.7.4-1.3.9-1.6Zm12.1 7.4 2.8 1.6c.9.5.9 1.9 0 2.4l-2.8 1.6L12 12l3.7-2.8ZM5.1 1.1l9.7 5.6-3.3 2.5L5.1 1.1Zm6.4 13.7 3.3 2.5-9.7 5.6 6.4-8.1Z" />
                      </svg>
                      <span>
                        <small>{appIsGooglePlay ? 'GET IT ON' : 'DOWNLOAD'}</small>
                        <strong>{appIsGooglePlay ? 'Google Play' : `App${appRelease?.version ? ` v${appRelease.version}` : ''}`}</strong>
                      </span>
                    </div>
                  ) : (
                    <div className="delta-apps-store-btn" role="text">
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                        <path d="M3.6 1.8 13.5 12 3.6 22.2c-.5-.3-.9-.9-.9-1.6V3.4c0-.7.4-1.3.9-1.6Zm12.1 7.4 2.8 1.6c.9.5.9 1.9 0 2.4l-2.8 1.6L12 12l3.7-2.8ZM5.1 1.1l9.7 5.6-3.3 2.5L5.1 1.1Zm6.4 13.7 3.3 2.5-9.7 5.6 6.4-8.1Z" />
                      </svg>
                      <span>
                        <small>GET IT ON</small>
                        <strong>Google Play</strong>
                      </span>
                    </div>
                  )}
                  <div className="delta-apps-store-btn" role="text">
                    <svg width="16" height="18" viewBox="0 0 16 20" fill="currentColor" aria-hidden>
                      <path d="M13.2 10.6c0-2.1 1.7-3.1 1.8-3.2-1-1.4-2.5-1.6-3-1.6-1.3-.1-2.5.8-3.1.8-.7 0-1.7-.7-2.8-.7-1.4 0-2.8.9-3.5 2.2-1.5 2.6-.4 6.5 1.1 8.6.7 1 1.6 2.2 2.7 2.2 1.1 0 1.5-.7 2.9-.7s1.7.7 2.9.7 1.9-1 2.6-2c.8-1.2 1.1-2.3 1.1-2.4 0 0-2.2-.9-2.2-3.4ZM11.2 4.4c.6-.7 1-1.7.9-2.7-1 .1-2.1.6-2.7 1.4-.6.7-1.1 1.7-1 2.7 1 .1 2.1-.5 2.8-1.4Z" />
                    </svg>
                    <span>
                      <small>Download on the</small>
                      <strong>App Store</strong>
                    </span>
                  </div>
                </div>
              </div>

              {/* Community */}
              <div className="delta-apps-card delta-apps-promo" role="text">
                <span className="delta-apps-promo__icon delta-apps-promo__icon--community">
                  <Users size={20} strokeWidth={1.6} />
                </span>
                <span className="delta-apps-promo__text">
                  Join India&apos;s Leading Crypto Trading Community
                </span>
              </div>

              {/* Resources */}
              <div className="delta-apps-card">
                <p className="delta-apps-section-title">Resources</p>
                <div className="delta-apps-grid">
                  {APPS_RESOURCES.map((item) => (
                    <AppsPanelLink key={item.label} item={item} onClick={onClose} />
                  ))}
                </div>
              </div>

              {/* Help */}
              <div className="delta-apps-card">
                <p className="delta-apps-section-title">Help</p>
                <div className="delta-apps-grid">
                  {APPS_HELP.map((item) => (
                    <AppsPanelLink key={item.label} item={item} onClick={onClose} />
                  ))}
                </div>
              </div>
            </div>
          </motion.aside>
        </div>
      ) : null}
    </AnimatePresence>
  );
}

function userAvatarSrc(user) {
  if (!user?.avatar_url) return null;
  const u = user.avatar_url;
  if (u.startsWith('http')) return u;
  const base = API.replace(/\/$/, '');
  return `${base}${u.startsWith('/') ? u : `/${u}`}`;
}

function pathActive(pathname, to) {
  if (!to) return false;
  // Exact first (avoids /trade activating /quick-trade and similar)
  if (pathname === to) return true;
  const base = to.split('?')[0];

  // More menu: Account hub — only general account sections (not Wallet / Refer)
  if (base === '/account/positions') {
    if (pathname === '/account' || pathname === '/account/') return true;
    if (!pathname.startsWith('/account/')) return false;
    const seg = pathname.slice('/account/'.length).split('/')[0] || '';
    const exclusive = new Set([
      'balances', 'deposits', 'withdrawals', 'transfer', 'transaction-logs',
      'bank-details', 'refer',
    ]);
    return Boolean(seg) && !exclusive.has(seg);
  }
  // More menu: Wallet-related account tabs
  if (base === '/account/balances') {
    const walletSegs = ['balances', 'deposits', 'withdrawals', 'transfer', 'transaction-logs', 'bank-details'];
    return walletSegs.some(
      (s) => pathname === `/account/${s}` || pathname.startsWith(`/account/${s}/`),
    );
  }
  // More menu: Referrals only
  if (base === '/account/refer') {
    return pathname === '/account/refer' || pathname.startsWith('/account/refer/');
  }

  if (base === '/markets') {
    return pathname === '/markets' || pathname.startsWith('/markets/');
  }
  if (base.startsWith('/trade/') || base === '/trade') {
    return pathname === '/trade' || pathname.startsWith('/trade/');
  }
  if (base.startsWith('/futures')) {
    return pathname.startsWith('/futures');
  }
  if (base.startsWith('/options')) {
    return pathname.startsWith('/options');
  }
  if (base.startsWith('/quick-trade')) {
    return pathname.startsWith('/quick-trade');
  }
  if (base.startsWith('/ibo-markets')) {
    return pathname.startsWith('/ibo-markets') || pathname.startsWith('/ibo-market');
  }
  if (base.startsWith('/p2p')) {
    return pathname === '/p2p' || pathname.startsWith('/p2p/');
  }
  if (base.startsWith('/wallet')) {
    return pathname === '/wallet' || pathname.startsWith('/wallet/')
      || pathname.startsWith('/account/balances')
      || pathname.startsWith('/account/deposits')
      || pathname.startsWith('/account/withdrawals')
      || pathname.startsWith('/account/transfer')
      || pathname.startsWith('/account/transaction-logs');
  }
  // Legacy catch-all for other /account routes (profile, etc.) — prefix match only when
  // the link target is a concrete path longer than '/account'
  if (base.startsWith('/account/') && base !== '/account/') {
    return pathname === base || pathname.startsWith(`${base}/`);
  }
  if (base === '/account') {
    return pathname === '/account' || pathname.startsWith('/account/');
  }
  return pathname === base || pathname.startsWith(`${base}/`);
}

function LiveTicker() {
  const [tickers, setTickers] = useState([]);

  useEffect(() => {
    const url = exchangeWsPath('/api/ws/exchange/markets');
    let closed = false;
    let reconnectTimer = null;
    let ws = null;
    const connect = () => {
      if (closed) return;
      ws = new WebSocket(url);
      ws.onmessage = (ev) => {
        try {
          const j = JSON.parse(ev.data);
          if (j.type === 'exchange_markets' && Array.isArray(j.markets)) {
            const data = normalizeMarketsList(j.markets);
            setTickers(data.filter((m) => TICKER_PAIRS.includes(m.symbol)).slice(0, 6));
          }
        } catch {
          /* ignore */
        }
      };
      ws.onclose = () => {
        ws = null;
        if (!closed) reconnectTimer = window.setTimeout(connect, 3000);
      };
    };
    connect();
    return () => {
      closed = true;
      if (reconnectTimer) window.clearTimeout(reconnectTimer);
      if (ws) {
        try { ws.close(); } catch { /* ignore */ }
      }
    };
  }, []);

  if (!tickers.length) return null;
  const items = [...tickers, ...tickers];

  return (
    <div
      className="w-full overflow-hidden hidden sm:block border-b"
      style={{
        background: 'color-mix(in srgb, var(--ibo-bg) 85%, transparent)',
        backdropFilter: 'blur(12px)',
        borderColor: 'var(--ibo-border-solid)',
      }}
    >
      <div className="flex overflow-hidden">
        <div
          className="flex gap-8 lg:gap-10 py-1.5 px-4 sm:px-6 whitespace-nowrap"
          style={{ animation: 'ticker 35s linear infinite' }}
        >
          {items.map((t, i) => {
            const pct = parseFloat(t.priceChangePercent ?? 0);
            const base = t.symbol.replace('USDT', '');
            return (
              <Link
                key={i}
                to={`/trade/${t.symbol}`}
                className="ibo-ticker-link flex items-center gap-2 text-xs sm:text-sm opacity-90 hover:opacity-100"
              >
                <span className="text-white font-semibold">{base}/USDT</span>
                <span className="text-white font-mono font-medium hidden md:inline">
                  ${parseFloat(t.price || 0).toLocaleString(undefined, { maximumFractionDigits: 4 })}
                </span>
                <span className={`font-mono font-semibold tabular-nums ${pct >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                  {pct >= 0 ? '+' : ''}{pct.toFixed(2)}%
                </span>
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function DropdownPanel({ style, width, children, panelRef, className = '' }) {
  return (
    <motion.div
      ref={panelRef}
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.12 }}
      className={`delta-dd ${className}`}
      style={{
        position: 'fixed',
        width,
        zIndex: 10050,
        ...style,
      }}
    >
      {children}
    </motion.div>
  );
}

function DropdownItem({ to, label, desc, icon: Icon, active, onClick }) {
  return (
    <Link
      to={to}
      onClick={onClick}
      className={`delta-dd__item${active ? ' is-active' : ''}`}
    >
      {Icon ? (
        <span className="delta-dd__icon">
          <Icon size={16} strokeWidth={1.75} />
        </span>
      ) : null}
      <span className="min-w-0">
        <span className="delta-dd__label">{label}</span>
        {desc ? <span className="delta-dd__desc">{desc}</span> : null}
      </span>
    </Link>
  );
}

export default function Navbar() {
  const { user, logout, fetchWallet } = useAuth();
  const { isLight, toggleTheme } = useTheme();
  const navigate = useNavigate();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const [userOpen, setUserOpen] = useState(false);
  const [openMenu, setOpenMenu] = useState(null); // more | apps | search
  const [scrolled, setScrolled] = useState(false);
  const [logoutModalOpen, setLogoutModalOpen] = useState(false);
  const [userMenuPos, setUserMenuPos] = useState(null);
  const [menuPos, setMenuPos] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const userTriggerRef = useRef(null);
  const userMenuPanelRef = useRef(null);
  const menuTriggerRefs = useRef({});
  const menuPanelRef = useRef(null);
  const appsPanelRef = useRef(null);
  const searchInputRef = useRef(null);
  const searchWrapRef = useRef(null);

  const isTrade =
    location.pathname.startsWith('/trade')
    || location.pathname.startsWith('/futures')
    || location.pathname.startsWith('/options');
  const isHome = location.pathname === '/';
  const {
    available: appAvailable,
    storeHref: appStoreHref,
    release: appRelease,
    isGooglePlay: appIsGooglePlay,
    linkProps: appLinkProps,
  } = useMobileAppRelease();

  const moreActive = NAV_MORE.some((l) => pathActive(location.pathname, l.to));

  const searchResults = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return SEARCH_SHORTCUTS;
    return SEARCH_SHORTCUTS.filter(
      (s) => s.label.toLowerCase().includes(q) || s.hint.toLowerCase().includes(q) || s.to.toLowerCase().includes(q),
    );
  }, [searchQuery]);

  useEffect(() => {
    if (user) fetchWallet?.();
  }, [user, fetchWallet]);

  useEffect(() => {
    setUserOpen(false);
    setOpenMenu(null);
    setMenuOpen(false);
    setSearchQuery('');
  }, [location.pathname]);

  useEffect(() => {
    const root = document.querySelector('[data-ibo-scroll-root]');
    const getY = () => (root ? root.scrollTop : window.scrollY);
    const onScroll = () => setScrolled(getY() > 10);
    onScroll();
    const target = root || window;
    target.addEventListener('scroll', onScroll, { passive: true });
    return () => target.removeEventListener('scroll', onScroll);
  }, [location.pathname]);

  useEffect(() => {
    if (!menuOpen) return undefined;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [menuOpen]);

  /* "/" opens search (Delta shortcut) */
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === '/' && !e.metaKey && !e.ctrlKey && !e.altKey) {
        const tag = (e.target?.tagName || '').toLowerCase();
        if (tag === 'input' || tag === 'textarea' || e.target?.isContentEditable) return;
        e.preventDefault();
        setOpenMenu('search');
        window.setTimeout(() => searchInputRef.current?.focus(), 30);
      }
      if (e.key === 'Escape') {
        setOpenMenu(null);
        setUserOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const updateUserMenuPosition = useCallback(() => {
    const el = userTriggerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    let left = r.right - USER_MENU_WIDTH_PX;
    left = Math.max(DROPDOWN_EDGE_GAP, Math.min(left, window.innerWidth - USER_MENU_WIDTH_PX - DROPDOWN_EDGE_GAP));
    setUserMenuPos({ top: r.bottom + DROPDOWN_EDGE_GAP, left });
  }, []);

  const updateOpenMenuPosition = useCallback(() => {
    if (!openMenu || openMenu === 'apps') {
      setMenuPos(null);
      return;
    }
    const el = openMenu === 'search'
      ? searchWrapRef.current
      : menuTriggerRefs.current[openMenu];
    if (!el) return;
    const r = el.getBoundingClientRect();
    const width = openMenu === 'search'
      ? SEARCH_PANEL_WIDTH_PX
      : openMenu === 'more'
        ? MORE_MENU_WIDTH_PX
        : 260;
    let left = openMenu === 'search' ? r.right - width : r.left;
    left = Math.max(DROPDOWN_EDGE_GAP, Math.min(left, window.innerWidth - width - DROPDOWN_EDGE_GAP));
    setMenuPos({ top: r.bottom + DROPDOWN_EDGE_GAP, left, width });
  }, [openMenu]);

  useLayoutEffect(() => {
    if (!userOpen) {
      setUserMenuPos(null);
      return undefined;
    }
    updateUserMenuPosition();
    window.addEventListener('scroll', updateUserMenuPosition, true);
    window.addEventListener('resize', updateUserMenuPosition);
    return () => {
      window.removeEventListener('scroll', updateUserMenuPosition, true);
      window.removeEventListener('resize', updateUserMenuPosition);
    };
  }, [userOpen, updateUserMenuPosition]);

  useLayoutEffect(() => {
    if (!openMenu || openMenu === 'apps') {
      setMenuPos(null);
      return undefined;
    }
    updateOpenMenuPosition();
    window.addEventListener('scroll', updateOpenMenuPosition, true);
    window.addEventListener('resize', updateOpenMenuPosition);
    return () => {
      window.removeEventListener('scroll', updateOpenMenuPosition, true);
      window.removeEventListener('resize', updateOpenMenuPosition);
    };
  }, [openMenu, updateOpenMenuPosition]);

  useEffect(() => {
    const onClick = (e) => {
      if (userTriggerRef.current?.contains(e.target)) return;
      if (userMenuPanelRef.current?.contains(e.target)) return;
      if (menuPanelRef.current?.contains(e.target)) return;
      if (appsPanelRef.current?.contains(e.target)) return;
      if (searchWrapRef.current?.contains(e.target)) return;
      if (Object.values(menuTriggerRefs.current).some((el) => el?.contains(e.target))) return;
      setUserOpen(false);
      setOpenMenu(null);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const handleLogout = () => setLogoutModalOpen(true);

  const confirmLogout = () => {
    logout();
    navigate('/');
    setLogoutModalOpen(false);
    setUserOpen(false);
    setOpenMenu(null);
    setMenuOpen(false);
  };

  const closeAll = () => {
    setOpenMenu(null);
    setUserOpen(false);
  };

  const toggleDropdown = (id) => {
    setUserOpen(false);
    setOpenMenu((prev) => (prev === id ? null : id));
  };

  const navAvatarSrc = user ? userAvatarSrc(user) : null;

  return (
    <>
      {IS_DEV ? (
        <div
          className="fixed bottom-2 right-2 z-[200] pointer-events-none rounded-lg bg-emerald-500/15 border border-emerald-500/35 px-2.5 py-1 text-[10px] font-bold text-emerald-200/95 shadow-lg"
          title="You are on the correct exchange app (ibo-exchange). Not frontend/ on :3000."
        >
          Exchange UI · API {API.replace(/^https?:\/\//, '')}
        </div>
      ) : null}
      <div className="sticky top-0 z-[10050] w-full" data-delta-nav-shell>
        {!isTrade && !isHome && <LiveTicker />}
        <header
          className={`delta-navbar ibo-nav-shell w-full transition-colors duration-200 ${
            scrolled ? 'delta-navbar--scrolled' : 'delta-navbar--top'
          } ${isLight ? 'delta-navbar--light' : 'delta-navbar--dark'}`}
        >
          <div className="delta-navbar__inner">
            <div className="delta-navbar__left">
              <Link to="/" className="delta-navbar__brand" aria-label="Home">
                <BrandLogo
                  alt="Delta Exchange"
                  className="h-[30px] w-auto max-w-[139px] object-contain object-left"
                />
              </Link>

              <nav className="delta-navbar__links" aria-label="Primary">
                {NAV_PRIMARY.map((l) => (
                  <Link
                    key={l.label}
                    to={l.to}
                    className={`delta-nav-link${pathActive(location.pathname, l.to) ? ' is-active' : ''}`}
                    aria-current={pathActive(location.pathname, l.to) ? 'page' : undefined}
                  >
                    {l.label}
                  </Link>
                ))}

                <div
                  className="relative h-full flex items-center"
                  ref={(el) => { menuTriggerRefs.current.more = el; }}
                >
                  <button
                    type="button"
                    onClick={() => toggleDropdown('more')}
                    className={`delta-nav-link delta-nav-link--btn${openMenu === 'more' || moreActive ? ' is-active' : ''}`}
                  >
                    More
                    <ChevronDown size={13} className={`transition-transform ${openMenu === 'more' ? 'rotate-180' : ''}`} />
                  </button>
                </div>
              </nav>
            </div>

            <div className="delta-navbar__right">
              {user ? (
                <>
                  {/* Search — Delta style */}
                  <div className="delta-nav-search hidden md:flex" ref={searchWrapRef}>
                    <Search size={15} className="delta-nav-search__icon" strokeWidth={1.75} />
                    <input
                      ref={searchInputRef}
                      type="search"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      onFocus={() => { setUserOpen(false); setOpenMenu('search'); }}
                      placeholder="Search"
                      className="delta-nav-search__input"
                      aria-label="Search"
                    />
                    <kbd className="delta-nav-search__kbd">/</kbd>
                  </div>

                  <Link to="/account/deposits" className="delta-nav-add-funds hidden sm:inline-flex">
                    Add Funds
                  </Link>

                  <NavWalletDropdown className="hidden sm:inline-flex" />

                  <Link
                    to="/account/transfer"
                    className="delta-nav-tool-btn hidden lg:inline-flex"
                    title="Transfer / swap"
                    aria-label="Transfer"
                  >
                    <ArrowLeftRight size={18} strokeWidth={1.6} />
                  </Link>

                  <Link
                    to="/account/support"
                    className="delta-nav-tool-btn hidden lg:inline-flex"
                    title="Support"
                    aria-label="Support"
                  >
                    <CircleHelp size={18} strokeWidth={1.6} />
                  </Link>

                  <NavNotifications
                    className="hidden sm:inline-flex"
                    onOpenChange={(v) => { if (v) { setUserOpen(false); setOpenMenu(null); } }}
                  />

                  <NavSettings
                    className="hidden sm:inline-flex"
                    onOpenChange={(v) => { if (v) { setUserOpen(false); setOpenMenu(null); } }}
                  />

                  <div className="relative" ref={userTriggerRef}>
                    <button
                      type="button"
                      onClick={() => { setOpenMenu(null); setUserOpen((v) => !v); }}
                      className="delta-nav-tool-btn"
                      aria-label="Account"
                      title="Account"
                    >
                      {navAvatarSrc ? (
                        <img src={navAvatarSrc} alt="" className="w-5 h-5 rounded-full object-cover" />
                      ) : (
                        <User size={18} strokeWidth={1.6} />
                      )}
                    </button>
                  </div>

                  <button
                    type="button"
                    onClick={toggleTheme}
                    className="delta-nav-tool-btn hidden sm:inline-flex"
                    aria-label={isLight ? 'Switch to dark theme' : 'Switch to light theme'}
                    title={isLight ? 'Switch to dark theme' : 'Switch to light theme'}
                  >
                    {isLight ? <Moon size={18} strokeWidth={1.6} /> : <Sun size={18} strokeWidth={1.6} />}
                  </button>

                  <div
                    className="relative hidden md:flex"
                    ref={(el) => { menuTriggerRefs.current.apps = el; }}
                  >
                    <button
                      type="button"
                      onClick={() => toggleDropdown('apps')}
                      className={`delta-nav-tool-btn${openMenu === 'apps' ? ' is-active' : ''}`}
                      aria-label="Apps"
                      title="Apps"
                    >
                      <LayoutGrid size={18} strokeWidth={1.6} />
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <div className="delta-nav-search hidden lg:flex" ref={searchWrapRef}>
                    <Search size={15} className="delta-nav-search__icon" strokeWidth={1.75} />
                    <input
                      ref={searchInputRef}
                      type="search"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      onFocus={() => setOpenMenu('search')}
                      placeholder="Search"
                      className="delta-nav-search__input"
                      aria-label="Search"
                    />
                    <kbd className="delta-nav-search__kbd">/</kbd>
                  </div>
                  <Link to="/login" className="delta-nav-login hidden sm:inline-flex">
                    Log In
                  </Link>
                  <Link to="/register" className="delta-nav-signup">
                    Sign Up
                  </Link>
                  <button
                    type="button"
                    onClick={toggleTheme}
                    className="delta-nav-tool-btn hidden sm:inline-flex"
                    aria-label={isLight ? 'Switch to dark theme' : 'Switch to light theme'}
                  >
                    {isLight ? <Moon size={18} strokeWidth={1.6} /> : <Sun size={18} strokeWidth={1.6} />}
                  </button>
                </>
              )}

              <button
                type="button"
                onClick={() => setMenuOpen((v) => !v)}
                className="delta-nav-tool-btn lg:hidden"
                aria-expanded={menuOpen}
                aria-label={menuOpen ? 'Close menu' : 'Open menu'}
              >
                {menuOpen ? <X size={22} /> : <Menu size={22} />}
              </button>
            </div>
          </div>

          {/* Dropdown portals (not apps — apps uses right drawer) */}
          {typeof document !== 'undefined' && openMenu && openMenu !== 'apps' && menuPos != null && createPortal(
            <DropdownPanel
              panelRef={menuPanelRef}
              width={menuPos.width}
              style={{ top: menuPos.top, left: menuPos.left }}
            >
              {openMenu === 'more' ? (
                <div className="delta-dd__list py-1">
                  {NAV_MORE.map((item) => (
                    <DropdownItem
                      key={item.to + item.label}
                      to={item.to}
                      label={item.label}
                      icon={item.icon}
                      active={pathActive(location.pathname, item.to)}
                      onClick={closeAll}
                    />
                  ))}
                </div>
              ) : null}

              {openMenu === 'search' ? (
                <div className="py-1 max-h-[320px] overflow-y-auto">
                  <p className="delta-dd__section-title px-3 pt-2">
                    {searchQuery ? 'Results' : 'Quick jump'}
                  </p>
                  {searchResults.length === 0 ? (
                    <p className="px-4 py-3 text-sm text-[color:var(--ibo-muted)]">No matches</p>
                  ) : (
                    searchResults.map((s) => (
                      <Link
                        key={s.to + s.label}
                        to={s.to}
                        onClick={closeAll}
                        className="delta-dd__item"
                      >
                        <span className="delta-dd__icon"><Search size={15} /></span>
                        <span className="min-w-0">
                          <span className="delta-dd__label">{s.label}</span>
                          <span className="delta-dd__desc">{s.hint}</span>
                        </span>
                      </Link>
                    ))
                  )}
                </div>
              ) : null}
            </DropdownPanel>,
            document.body,
          )}

          {typeof document !== 'undefined' && createPortal(
            <AppsSidePanel
              open={openMenu === 'apps'}
              onClose={closeAll}
              panelRef={appsPanelRef}
              isLight={isLight}
              appAvailable={appAvailable}
              appStoreHref={appStoreHref}
              appLinkProps={appLinkProps}
              appIsGooglePlay={appIsGooglePlay}
              appRelease={appRelease}
            />,
            document.body,
          )}

          {typeof document !== 'undefined' && userOpen && userMenuPos != null && createPortal(
            <DropdownPanel
              panelRef={userMenuPanelRef}
              width={USER_MENU_WIDTH_PX}
              style={{ top: userMenuPos.top, left: userMenuPos.left }}
            >
              <div className="px-3 py-2.5 border-b border-[color:var(--ibo-border-solid)]">
                <p className="text-sm font-medium text-[color:var(--ibo-ink)] truncate">{user?.name}</p>
                <p className="text-xs text-[color:var(--ibo-muted)] truncate">{user?.email}</p>
              </div>
              {[
                { to: '/account/positions', label: 'Positions', icon: LayoutDashboard },
                { to: '/account/pnl', label: 'P&L Analytics', icon: LineChart },
                { to: '/account/balances', label: 'Balances', icon: Wallet },
                { to: '/account/bank-details', label: 'Bank Details', icon: CircleDollarSign },
                { to: '/account/profile', label: 'Profile', icon: User },
                { to: '/account/security', label: 'Security', icon: Shield },
                { to: '/account/preferences', label: 'Preferences', icon: Settings },
                { to: '/account/support', label: 'Support', icon: HelpCircle },
              ].map(({ to, label, icon: Icon }) => (
                <Link
                  key={to}
                  to={to}
                  onClick={() => setUserOpen(false)}
                  className="delta-dd__item"
                >
                  <span className="delta-dd__icon"><Icon size={16} /></span>
                  <span className="delta-dd__label">{label}</span>
                </Link>
              ))}
              <div className="border-t border-[color:var(--ibo-border-solid)] my-1" />
              <button type="button" onClick={handleLogout} className="delta-dd__item delta-dd__item--danger w-full text-left">
                <span className="delta-dd__icon"><LogOut size={16} /></span>
                <span className="delta-dd__label">Sign Out</span>
              </button>
            </DropdownPanel>,
            document.body,
          )}
        </header>
      </div>

      {/* Mobile drawer */}
      {typeof document !== 'undefined' && createPortal(
        <AnimatePresence>
          {menuOpen && (
            <div className="lg:hidden" role="dialog" aria-modal="true" aria-label="Navigation menu">
              <motion.button
                type="button"
                aria-label="Close menu"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="fixed inset-0 z-[10070] bg-black/65 backdrop-blur-sm touch-manipulation"
                onClick={() => setMenuOpen(false)}
              />
              <motion.div
                initial={{ x: '100%' }}
                animate={{ x: 0 }}
                exit={{ x: '100%' }}
                transition={{ type: 'spring', damping: 28, stiffness: 320 }}
                className="fixed top-0 right-0 z-[10071] flex flex-col w-full max-w-[min(100vw,340px)] h-[100dvh] max-h-[100dvh] border-l border-[color:var(--ibo-border-solid)] shadow-2xl ibo-dropdown-panel"
                style={{
                  background: 'var(--ibo-bg)',
                  paddingTop: 'env(safe-area-inset-top, 0px)',
                  paddingBottom: 'env(safe-area-inset-bottom, 0px)',
                }}
              >
                <div className="flex items-center justify-between px-4 py-4 border-b border-[color:var(--ibo-border-solid)] flex-shrink-0">
                  <span className="text-sm font-semibold text-[color:var(--ibo-ink)]">Menu</span>
                  <button
                    type="button"
                    onClick={() => setMenuOpen(false)}
                    className="p-2.5 rounded text-[color:var(--ibo-ink-secondary)] hover:bg-black/[0.04] touch-manipulation"
                    aria-label="Close menu"
                  >
                    <X size={22} />
                  </button>
                </div>

                <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-3 py-4 space-y-4 pb-6">
                  {user ? (
                    <div className="flex items-center gap-2">
                      <Link
                        to="/account/deposits"
                        onClick={() => setMenuOpen(false)}
                        className="delta-nav-add-funds flex-1 !mr-0 justify-center"
                      >
                        Add Funds
                      </Link>
                      <NavWalletDropdown className="!mr-0" />
                      <NavNotifications className="!mr-0" />
                      <NavSettings className="!mr-0" />
                    </div>
                  ) : null}

                  <div className="space-y-3">
                    <div>
                      <p className="px-2 mb-1 text-[10px] font-semibold text-[color:var(--ibo-muted)] uppercase tracking-widest">
                        Trade
                      </p>
                      <div className="space-y-0.5">
                        {NAV_PRIMARY.map((l) => (
                          <Link
                            key={l.label}
                            to={l.to}
                            onClick={() => setMenuOpen(false)}
                            className={`flex items-center gap-2.5 px-3 py-2.5 rounded text-[14px] touch-manipulation ${
                              pathActive(location.pathname, l.to)
                                ? 'text-[#fe8935]'
                                : 'text-[color:var(--ibo-ink)] hover:bg-black/[0.04]'
                            }`}
                          >
                            {l.label}
                          </Link>
                        ))}
                      </div>
                    </div>
                    <div>
                      <p className="px-2 mb-1 text-[10px] font-semibold text-[color:var(--ibo-muted)] uppercase tracking-widest">
                        More
                      </p>
                      <div className="space-y-0.5">
                        {NAV_MORE.map((l) => {
                          const Icon = l.icon;
                          return (
                            <Link
                              key={l.to + l.label}
                              to={l.to}
                              onClick={() => setMenuOpen(false)}
                              className={`flex items-center gap-2.5 px-3 py-2.5 rounded text-[14px] touch-manipulation ${
                                pathActive(location.pathname, l.to)
                                  ? 'text-[#fe8935]'
                                  : 'text-[color:var(--ibo-ink)] hover:bg-black/[0.04]'
                              }`}
                            >
                              {Icon ? <Icon size={16} className="opacity-70 flex-shrink-0" /> : null}
                              {l.label}
                            </Link>
                          );
                        })}
                      </div>
                    </div>
                  </div>

                  {user ? (
                    <div>
                      <p className="px-2 mb-1 text-[10px] font-semibold text-[color:var(--ibo-muted)] uppercase tracking-widest">Account</p>
                      <div className="space-y-0.5">
                        {[
                          { to: '/account/positions', label: 'Positions', icon: LayoutDashboard },
                          { to: '/account/pnl', label: 'P&L Analytics', icon: LineChart },
                          { to: '/account/balances', label: 'Balances', icon: Wallet },
                          { to: '/account/bank-details', label: 'Bank Details', icon: CircleDollarSign },
                          { to: '/account/profile', label: 'Profile', icon: User },
                          { to: '/account/security', label: 'Security', icon: Shield },
                          { to: '/account/preferences', label: 'Preferences', icon: Settings },
                          { to: '/account/support', label: 'Support', icon: HelpCircle },
                        ].map(({ to, label, icon: Icon }) => (
                          <Link
                            key={to}
                            to={to}
                            onClick={() => setMenuOpen(false)}
                            className="flex items-center gap-2.5 px-3 py-2.5 rounded text-[14px] text-[color:var(--ibo-ink)] hover:bg-black/[0.04] touch-manipulation"
                          >
                            <Icon size={16} className="opacity-70" /> {label}
                          </Link>
                        ))}
                        <button
                          type="button"
                          onClick={handleLogout}
                          className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded text-[14px] text-red-500 touch-manipulation"
                        >
                          <LogOut size={16} /> Sign Out
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-2 pt-2 border-t border-[color:var(--ibo-border-solid)]">
                      <Link to="/login" onClick={() => setMenuOpen(false)} className="delta-nav-login !mr-0 w-full justify-center h-11">
                        Log In
                      </Link>
                      <Link to="/register" onClick={() => setMenuOpen(false)} className="delta-nav-signup !ml-0 !mr-0 w-full h-11">
                        Sign Up
                      </Link>
                    </div>
                  )}

                  {appAvailable && appStoreHref && appLinkProps ? (
                    <a
                      {...appLinkProps}
                      onClick={() => setMenuOpen(false)}
                      className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded text-sm text-[color:var(--ibo-ink)] border border-[color:var(--ibo-border-solid)]"
                    >
                      {appIsGooglePlay ? <ExternalLink size={16} /> : <Download size={16} />}
                      {appIsGooglePlay ? 'Get on Google Play' : `App${appRelease?.version ? ` v${appRelease.version}` : ''}`}
                    </a>
                  ) : null}

                  <button
                    type="button"
                    onClick={toggleTheme}
                    className="w-full flex items-center justify-between px-3 py-2.5 rounded border border-[color:var(--ibo-border-solid)] text-sm text-[color:var(--ibo-ink)]"
                  >
                    Appearance
                    <span className="inline-flex items-center gap-1.5 text-[color:var(--ibo-ink-secondary)]">
                      {isLight ? <Moon size={16} /> : <Sun size={16} />}
                      {isLight ? 'Dark' : 'Light'}
                    </span>
                  </button>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>,
        document.body,
      )}

      {typeof document !== 'undefined' && createPortal(
        <AnimatePresence>
          {logoutModalOpen && (
            <motion.div
              className="fixed inset-0 z-[11000] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              <motion.div
                initial={{ opacity: 0, scale: 0.97, y: 8 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.97, y: 8 }}
                transition={{ duration: 0.16 }}
                className="w-full max-w-md rounded-lg border border-[color:var(--ibo-border-solid)] bg-[color:var(--ibo-bg)] shadow-2xl"
              >
                <div className="px-5 py-4 border-b border-[color:var(--ibo-border-solid)]">
                  <h3 className="text-[color:var(--ibo-ink)] font-semibold text-lg">Sign out?</h3>
                  <p className="text-[color:var(--ibo-muted)] text-sm mt-1">
                    You will be signed out of this device.
                  </p>
                </div>
                <div className="px-5 py-4 flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setLogoutModalOpen(false)}
                    className="ibo-logout-modal__cancel"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={confirmLogout}
                    className="ibo-logout-modal__confirm"
                  >
                    Sign out
                  </button>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>,
        document.body,
      )}
    </>
  );
}
