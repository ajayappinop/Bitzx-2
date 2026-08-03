import { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ChevronDown, LogOut, User, LayoutDashboard, Menu, X, Wallet, Bell,
  ExternalLink, Shield, Zap, LineChart, HelpCircle, Settings, Smartphone,
  Download, MoreHorizontal, Coins, Gift,
} from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useTheme } from '@/context/ThemeContext';
import ThemeToggle from '@/components/ThemeToggle';
import { exchangeWsPath, normalizeMarketsList } from '@/services/marketApi';
import { exchangeApiOrigin } from '@/lib/apiBase';
import { BRAND_LOGO } from '@/lib/brandAssets';
import { useMobileAppRelease } from '@/hooks/useMobileAppRelease';

const LOGO = BRAND_LOGO;
const API = exchangeApiOrigin(import.meta.env.VITE_BACKEND_URL);
const IS_DEV = import.meta.env.DEV;

const TICKER_PAIRS = ['IBOUSDT', 'BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'XRPUSDT'];
const USER_MENU_WIDTH_PX = 208;
const USER_MENU_EDGE_GAP = 8;
const MORE_MENU_WIDTH_PX = 220;

/** Always visible on large screens */
const NAV_PRIMARY = [
  { label: 'Markets', to: '/markets' },
  { label: 'Trade', to: '/trade/IBOUSDT' },
  { label: 'Futures', to: '/futures/BTCUSDT-PERP' },
  { label: 'Wallet', to: '/wallet' },
];

/** Grouped under “More” until xl, or always in mobile drawer */
const NAV_MORE = [
  { label: 'Refer & Earn', to: '/refer-earn', icon: Gift },
  { label: 'List Your Coin', to: '/list-coin', icon: Coins },
  { label: 'IBO Markets', to: '/ibo-markets' },
  { label: 'Options', to: '/options/BTCUSDT' },
  { label: 'P2P', to: '/p2p' },
  { label: 'P&L', to: '/portfolio' },
  { label: 'Quick Trade', to: '/quick-trade', icon: Zap },
];

function userAvatarSrc(user) {
  if (!user?.avatar_url) return null;
  const u = user.avatar_url;
  if (u.startsWith('http')) return u;
  const base = API.replace(/\/$/, '');
  return `${base}${u.startsWith('/') ? u : `/${u}`}`;
}

function pathActive(pathname, to) {
  if (pathname === to) return true;
  const base = to.split('/').slice(0, 2).join('/');
  return base.length > 1 && pathname.startsWith(base);
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
        try {
          ws.close();
        } catch {
          /* ignore */
        }
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

function NavLink({ to, label, active, compact, icon: Icon, accent }) {
  return (
    <Link
      to={to}
      className={`rounded-lg font-semibold transition-colors whitespace-nowrap inline-flex items-center gap-1.5 ${
        compact ? 'px-2.5 py-1.5 text-sm' : 'px-3 py-2 text-sm'
      } ${
        active
          ? 'text-gold-light bg-gold/10'
          : accent
            ? 'text-gold-light/90 hover:text-gold-light hover:bg-gold/10 ibo-nav-link'
            : 'text-white/90 hover:text-white hover:bg-white/[0.06] ibo-nav-link'
      }`}
      aria-current={active ? 'page' : undefined}
    >
      {Icon ? <Icon size={14} className="flex-shrink-0 opacity-90" /> : null}
      {label}
    </Link>
  );
}

export default function Navbar() {
  const { user, logout } = useAuth();
  const { isLight } = useTheme();
  const navigate = useNavigate();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const [userOpen, setUserOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [logoutModalOpen, setLogoutModalOpen] = useState(false);
  const [userMenuPos, setUserMenuPos] = useState(null);
  const [moreMenuPos, setMoreMenuPos] = useState(null);
  const userTriggerRef = useRef(null);
  const userMenuPanelRef = useRef(null);
  const moreTriggerRef = useRef(null);
  const moreMenuPanelRef = useRef(null);

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

  useEffect(() => {
    setUserOpen(false);
    setMoreOpen(false);
    setMenuOpen(false);
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
    return () => {
      document.body.style.overflow = prev;
    };
  }, [menuOpen]);

  const updateUserMenuPosition = useCallback(() => {
    const el = userTriggerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    let left = r.right - USER_MENU_WIDTH_PX;
    left = Math.max(
      USER_MENU_EDGE_GAP,
      Math.min(left, window.innerWidth - USER_MENU_WIDTH_PX - USER_MENU_EDGE_GAP),
    );
    setUserMenuPos({ top: r.bottom + USER_MENU_EDGE_GAP, left });
  }, []);

  const updateMoreMenuPosition = useCallback(() => {
    const el = moreTriggerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    let left = r.left;
    left = Math.max(
      USER_MENU_EDGE_GAP,
      Math.min(left, window.innerWidth - MORE_MENU_WIDTH_PX - USER_MENU_EDGE_GAP),
    );
    setMoreMenuPos({ top: r.bottom + USER_MENU_EDGE_GAP, left });
  }, []);

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
    if (!moreOpen) {
      setMoreMenuPos(null);
      return undefined;
    }
    updateMoreMenuPosition();
    window.addEventListener('scroll', updateMoreMenuPosition, true);
    window.addEventListener('resize', updateMoreMenuPosition);
    return () => {
      window.removeEventListener('scroll', updateMoreMenuPosition, true);
      window.removeEventListener('resize', updateMoreMenuPosition);
    };
  }, [moreOpen, updateMoreMenuPosition]);

  useEffect(() => {
    const onClick = (e) => {
      if (userTriggerRef.current?.contains(e.target)) return;
      if (userMenuPanelRef.current?.contains(e.target)) return;
      if (moreTriggerRef.current?.contains(e.target)) return;
      if (moreMenuPanelRef.current?.contains(e.target)) return;
      setUserOpen(false);
      setMoreOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const handleLogout = () => {
    setLogoutModalOpen(true);
  };

  const confirmLogout = () => {
    logout();
    navigate('/');
    setLogoutModalOpen(false);
    setUserOpen(false);
    setMoreOpen(false);
    setMenuOpen(false);
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
      <div className="sticky top-0 z-50 w-full">
        {!isTrade && !isHome && <LiveTicker />}
        <header
          className={`ibo-nav-shell w-full transition-colors duration-300 font-display border-b ${
            scrolled
              ? isLight
                ? 'bg-[rgba(246,249,251,0.97)] backdrop-blur-xl border-[color:var(--ibo-border-solid)]'
                : 'bg-[rgba(10,11,15,0.96)] backdrop-blur-xl border-white/[0.08]'
              : isLight
                ? 'bg-[rgba(255,255,255,0.92)] backdrop-blur-xl border-[color:var(--ibo-border-solid)]'
                : 'bg-[rgba(12,14,20,0.88)] backdrop-blur-xl border-white/[0.06]'
          }`}
        >
        <div className="w-full flex items-center gap-2 sm:gap-2.5 lg:gap-3 min-h-[56px] sm:min-h-[60px] lg:min-h-[64px] px-3 sm:px-4 md:px-5 lg:px-6 xl:px-8 min-w-0">
          {/* Logo */}
          <Link to="/" className="flex items-center gap-2 flex-shrink-0 min-w-0 max-w-[42%] sm:max-w-[220px] lg:max-w-[180px] xl:max-w-[220px] 2xl:max-w-[260px]">
            <motion.img
              src={LOGO}
              alt="IBO Exchange"
              className="ibo-brand-logo h-8 sm:h-9 lg:h-9 xl:h-10 w-auto max-w-full object-contain object-left"
              style={{ background: 'transparent' }}
              whileHover={{ scale: 1.02 }}
              transition={{ type: 'spring', stiffness: 300 }}
            />
          </Link>

          {/* Desktop nav */}
          <nav className="hidden lg:flex items-center gap-0.5 min-w-0 flex-1 justify-center overflow-hidden">
            {NAV_PRIMARY.map((l) => (
              <NavLink
                key={l.to}
                to={l.to}
                label={l.label}
                icon={l.icon}
                accent={l.accent}
                active={pathActive(location.pathname, l.to)}
                compact
              />
            ))}

            <div className="hidden 2xl:flex items-center gap-0.5 shrink-0">
              {NAV_MORE.filter((l) => l.to !== '/quick-trade').map((l) => (
                <NavLink
                  key={l.to}
                  to={l.to}
                  label={l.label}
                  icon={l.icon}
                  active={pathActive(location.pathname, l.to)}
                  compact
                />
              ))}
            </div>

            <div className="2xl:hidden relative flex-shrink-0" ref={moreTriggerRef}>
              <button
                type="button"
                onClick={() => setMoreOpen((v) => !v)}
                className={`flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-sm font-semibold transition-colors ${
                  moreOpen || moreActive
                    ? 'text-gold-light bg-gold/10'
                    : 'text-white/90 hover:bg-white/[0.06]'
                }`}
              >
                <MoreHorizontal size={16} />
                More
                <ChevronDown size={14} className={`transition-transform ${moreOpen ? 'rotate-180' : ''}`} />
              </button>
            </div>
          </nav>

          {/* Right cluster — rearranged: auth first, then Quick */}
          <div className="ml-auto flex items-center gap-1.5 sm:gap-2 flex-shrink-0">
            {user ? (
              <>
                <button
                  type="button"
                  className="hidden xl:block relative p-2 rounded-lg text-white/80 hover:text-white hover:bg-white/[0.06] transition-colors"
                  aria-label="Notifications"
                >
                  <Bell size={17} />
                  <span className="absolute top-1.5 right-1.5 w-1.5 h-1.5 bg-gold rounded-full" />
                </button>

                <div className="relative" ref={userTriggerRef}>
                  <button
                    type="button"
                    onClick={() => setUserOpen((v) => !v)}
                    className="flex items-center gap-1.5 sm:gap-2 px-2 sm:px-3 py-1.5 sm:py-2 rounded-xl bg-white/[0.04] border border-white/[0.1] hover:border-[#0ea4ab]/40 hover:bg-white/[0.06] transition-colors max-w-[140px] sm:max-w-[180px]"
                  >
                    <div className="w-7 h-7 rounded-full bg-gold/20 flex items-center justify-center text-gold-light text-sm font-bold overflow-hidden flex-shrink-0">
                      {navAvatarSrc ? (
                        <img src={navAvatarSrc} alt="" className="w-full h-full object-cover" />
                      ) : (
                        user.name?.[0]?.toUpperCase()
                      )}
                    </div>
                    <span className="hidden md:block text-sm text-white font-semibold truncate">
                      {user.name}
                    </span>
                    <ChevronDown size={14} className="text-white/70 flex-shrink-0 hidden sm:block" />
                  </button>
                </div>

                {typeof document !== 'undefined' && userOpen && userMenuPos != null && createPortal(
                  <motion.div
                    ref={userMenuPanelRef}
                    role="menu"
                    initial={{ opacity: 0, y: -6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.15 }}
                    className="w-52 rounded-xl border border-white/[0.1] bg-[rgba(12,14,20,0.96)] backdrop-blur-xl shadow-2xl py-1 ibo-dropdown-panel"
                    style={{
                      position: 'fixed',
                      top: userMenuPos.top,
                      left: userMenuPos.left,
                      zIndex: 10050,
                    }}
                  >
                    <Link to="/dashboard" onClick={() => setUserOpen(false)}
                      className="flex items-center gap-2.5 px-4 py-2.5 text-sm text-white hover:bg-white/[0.05] transition-colors">
                      <LayoutDashboard size={16} /> Dashboard
                    </Link>
                    <Link to="/refer-earn" onClick={() => setUserOpen(false)}
                      className="flex items-center gap-2.5 px-4 py-2.5 text-sm text-white hover:bg-white/[0.05] transition-colors">
                      <Gift size={16} /> Refer &amp; Earn
                    </Link>
                    <Link to="/portfolio" onClick={() => setUserOpen(false)}
                      className="flex items-center gap-2.5 px-4 py-2.5 text-sm text-white hover:bg-white/[0.05] transition-colors">
                      <LineChart size={16} /> P&amp;L &amp; fills
                    </Link>
                    <Link to="/wallet" onClick={() => setUserOpen(false)}
                      className="flex items-center gap-2.5 px-4 py-2.5 text-sm text-white hover:bg-white/[0.05] transition-colors">
                      <Wallet size={16} /> My Wallet
                    </Link>
                    <Link to="/profile" onClick={() => setUserOpen(false)}
                      className="flex items-center gap-2.5 px-4 py-2.5 text-sm text-white hover:bg-white/[0.05] transition-colors">
                      <User size={16} /> Edit Profile
                    </Link>
                    <Link to="/kyc" onClick={() => setUserOpen(false)}
                      className="flex items-center gap-2.5 px-4 py-2.5 text-sm text-white hover:bg-white/[0.05] transition-colors">
                      <Shield size={16} /> KYC
                    </Link>
                    <Link to="/support-disputes" onClick={() => setUserOpen(false)}
                      className="flex items-center gap-2.5 px-4 py-2.5 text-sm text-white hover:bg-white/[0.05] transition-colors">
                      <HelpCircle size={16} /> Support
                    </Link>
                    <Link to="/settings" onClick={() => setUserOpen(false)}
                      className="flex items-center gap-2.5 px-4 py-2.5 text-sm text-white hover:bg-white/[0.05] transition-colors">
                      <Settings size={16} /> Settings
                    </Link>
                    <div className="border-t border-white/[0.08] my-1" />
                    <button type="button" onClick={handleLogout}
                      className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-red-400 hover:bg-white/[0.05] transition-colors">
                      <LogOut size={16} /> Sign Out
                    </button>
                  </motion.div>,
                  document.body,
                )}
              </>
            ) : (
              <div className="flex items-center gap-2">
                <Link
                  to="/login"
                  className="hidden sm:block px-3 py-1.5 text-sm font-semibold text-white/90 hover:text-white transition-colors"
                >
                  Log In
                </Link>
                <Link
                  to="/register"
                  className="text-sm font-bold whitespace-nowrap transition-all px-5 py-2 rounded-full bg-logo-gradient text-surface-dark uppercase tracking-wide shadow-[0_0_24px_rgba(14,164,171,0.3)] hover:brightness-105"
                >
                  Sign Up
                </Link>
              </div>
            )}

            <Link
              to="/quick-trade"
              className="ibo-btn-accent ibo-hover-scale hidden xl:flex flex-shrink-0 rounded-lg px-3 py-1.5 text-sm"
            >
              <Zap size={14} />
              Quick Trade
            </Link>

            <ThemeToggle className="hidden sm:inline-flex" />

            {appAvailable && appStoreHref && appLinkProps && (
              <a
                {...appLinkProps}
                className="hidden xl:flex items-center gap-1.5 flex-shrink-0 px-3 py-1.5 rounded-lg font-bold text-sm text-emerald-300 border border-emerald-500/35 bg-emerald-500/10 hover:bg-emerald-500/20 transition-colors"
                title={appIsGooglePlay ? 'Get IBO on Google Play' : `Download IBO Mobile v${appRelease?.version || ''}`}
              >
                <Smartphone size={14} />
                {appIsGooglePlay ? 'Play Store' : 'App'}
              </a>
            )}

            <button
              type="button"
              onClick={() => setMenuOpen((v) => !v)}
              className="lg:hidden p-2 rounded-lg text-white hover:bg-white/[0.06] transition-colors"
              aria-expanded={menuOpen}
              aria-label={menuOpen ? 'Close menu' : 'Open menu'}
            >
              {menuOpen ? <X size={22} /> : <Menu size={22} />}
            </button>
          </div>
        </div>

        {/* More menu portal (lg–xl) */}
        {typeof document !== 'undefined' && moreOpen && moreMenuPos != null && createPortal(
          <motion.div
            ref={moreMenuPanelRef}
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.15 }}
            className="bg-[rgba(12,14,20,0.96)] border border-white/[0.1] backdrop-blur-xl rounded-xl shadow-2xl py-1 overflow-hidden ibo-dropdown-panel"
            style={{
              position: 'fixed',
              top: moreMenuPos.top,
              left: moreMenuPos.left,
              width: MORE_MENU_WIDTH_PX,
              zIndex: 10050,
            }}
          >
            {NAV_MORE.map((l) => {
              const Icon = l.icon;
              return (
                <Link
                  key={l.to}
                  to={l.to}
                  onClick={() => setMoreOpen(false)}
                  className={`flex items-center gap-2.5 px-4 py-2.5 text-sm transition-colors ${
                    pathActive(location.pathname, l.to)
                      ? 'text-gold-light bg-gold/10'
                      : 'text-white hover:bg-white/[0.05]'
                  }`}
                >
                  {Icon ? <Icon size={16} className="flex-shrink-0 opacity-80" /> : null}
                  {l.label}
                </Link>
              );
            })}
          </motion.div>,
          document.body,
        )}

      </header>
      </div>

      {/* Mobile drawer — portaled (header backdrop-filter traps fixed children otherwise) */}
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
                className="fixed top-0 right-0 z-[10071] flex flex-col w-full max-w-[min(100vw,340px)] h-[100dvh] max-h-[100dvh] border-l border-white/10 shadow-2xl ibo-dropdown-panel"
                style={{
                  background: 'var(--ibo-card)',
                  paddingTop: 'env(safe-area-inset-top, 0px)',
                  paddingBottom: 'env(safe-area-inset-bottom, 0px)',
                }}
              >
                <div className="flex items-center justify-between px-4 py-4 border-b border-white/10 flex-shrink-0">
                  <span className="text-sm font-bold text-white/80 uppercase tracking-wider">Menu</span>
                  <button
                    type="button"
                    onClick={() => setMenuOpen(false)}
                    className="p-2.5 rounded-lg text-white/70 hover:bg-white/10 touch-manipulation"
                    aria-label="Close menu"
                  >
                    <X size={22} />
                  </button>
                </div>

                <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-3 py-4 space-y-4 pb-6">
                  <Link
                    to="/quick-trade"
                    onClick={() => setMenuOpen(false)}
                    className="ibo-btn-accent w-full py-3.5 rounded-xl touch-manipulation"
                  >
                    <Zap size={16} /> Quick Trade
                  </Link>

                  {appAvailable && appStoreHref && appLinkProps ? (
                    <a
                      {...appLinkProps}
                      onClick={() => setMenuOpen(false)}
                      className="w-full flex items-center justify-center gap-2 px-4 py-3.5 rounded-xl font-bold text-sm text-emerald-300 border border-emerald-500/35 bg-emerald-500/10 touch-manipulation"
                    >
                      {appIsGooglePlay ? <ExternalLink size={16} /> : <Download size={16} />}
                      {appIsGooglePlay
                        ? 'Get on Google Play'
                        : `App${appRelease?.version ? ` v${appRelease.version}` : ''}`}
                    </a>
                  ) : null}

                  <div>
                    <p className="px-2 mb-2 text-[10px] font-bold text-white/40 uppercase tracking-widest">Trade</p>
                    <div className="space-y-1">
                      {[...NAV_PRIMARY, ...NAV_MORE.filter((l) => l.to !== '/quick-trade')].map((l) => (
                        <Link
                          key={l.to}
                          to={l.to}
                          onClick={() => setMenuOpen(false)}
                          className={`flex items-center gap-2.5 px-3 py-3 rounded-lg text-[15px] font-semibold transition-colors touch-manipulation ${
                            pathActive(location.pathname, l.to)
                              ? 'text-gold-light bg-gold/10'
                              : l.accent
                                ? 'text-gold-light/90 hover:bg-gold/10'
                                : 'text-white hover:bg-white/[0.06]'
                          }`}
                        >
                          {l.icon ? <l.icon size={16} className="flex-shrink-0 opacity-80" /> : null}
                          {l.label}
                        </Link>
                      ))}
                    </div>
                  </div>

                  {user ? (
                    <div>
                      <p className="px-2 mb-2 text-[10px] font-bold text-white/40 uppercase tracking-widest">Account</p>
                      <div className="space-y-1">
                        {[
                          { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
                          { to: '/refer-earn', label: 'Refer & Earn', icon: Gift },
                          { to: '/portfolio', label: 'P&L & fills', icon: LineChart },
                          { to: '/wallet', label: 'Wallet', icon: Wallet },
                          { to: '/profile', label: 'Profile', icon: User },
                          { to: '/kyc', label: 'KYC', icon: Shield },
                          { to: '/support-disputes', label: 'Support', icon: HelpCircle },
                          { to: '/settings', label: 'Settings', icon: Settings },
                        ].map(({ to, label, icon: Icon }) => (
                          <Link
                            key={to}
                            to={to}
                            onClick={() => setMenuOpen(false)}
                            className="flex items-center gap-2.5 px-3 py-3 rounded-lg text-[15px] font-medium touch-manipulation text-white/90 hover:bg-white/[0.06]"
                          >
                            <Icon size={16} className="opacity-70 flex-shrink-0" />
                            {label}
                          </Link>
                        ))}
                        <button
                          type="button"
                          onClick={handleLogout}
                          className="w-full flex items-center gap-2.5 px-3 py-3 rounded-lg text-[15px] font-medium text-red-400 hover:bg-white/[0.06] touch-manipulation"
                        >
                          <LogOut size={16} /> Sign Out
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-2 pt-2 border-t border-white/10">
                      <Link
                        to="/login"
                        onClick={() => setMenuOpen(false)}
                        className="block w-full text-center px-4 py-3 rounded-xl border border-white/12 text-white font-semibold text-[15px] touch-manipulation"
                      >
                        Log In
                      </Link>
                      <Link
                        to="/register"
                        onClick={() => setMenuOpen(false)}
                        className="block w-full text-center px-4 py-3 rounded-xl bg-logo-gradient text-surface-dark font-bold text-[15px] touch-manipulation"
                      >
                        Sign Up
                      </Link>
                    </div>
                  )}

                  <div className="flex items-center justify-between px-3 py-2 rounded-xl border border-white/10 bg-white/[0.03]">
                    <span className="text-sm font-semibold text-white/80">Appearance</span>
                    <ThemeToggle compact />
                  </div>
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
                className="w-full max-w-md rounded-2xl border border-white/[0.1] bg-[rgba(12,14,20,0.96)] backdrop-blur-xl shadow-2xl"
              >
                <div className="px-5 py-4 border-b border-white/[0.08]">
                  <h3 className="text-white font-bold text-lg">Sign out?</h3>
                  <p className="text-white/60 text-sm mt-1">
                    You will be signed out of this device.
                  </p>
                </div>
                <div className="px-5 py-4 flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setLogoutModalOpen(false)}
                    className="px-4 py-2 rounded-xl border border-white/[0.08] text-sm font-semibold text-white/80 hover:bg-white/5"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={confirmLogout}
                    className="px-4 py-2 rounded-xl border border-red-500/40 bg-red-500/15 text-sm font-semibold text-red-200 hover:bg-red-500/25"
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
