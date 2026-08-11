import { Outlet, NavLink, useLocation, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, Users, UserCheck, ScrollText, LogOut, Menu, X,
  Activity, Landmark, Settings, LineChart, BarChart3, UserPlus, Wallet, Trophy, ArrowUpCircle, ArrowDownCircle, Radar, ShieldAlert, FileText, BadgeCheck,
  Shield, Bell, BookText, Scale,
  ReceiptText, HelpCircle, Clock3, Search,
  TrendingUp,
  CircleDot,
  ArrowLeftRight,
  Coins,
  Sparkles,
  Smartphone,
  Globe,
  IndianRupee,
  Image as ImageIcon,
  ShieldCheck,
  Send,
  Layers,
  Gift,
  Sun,
  Moon,
} from 'lucide-react';
import { useState, useEffect } from 'react';
import { useAdminAuth } from '@/context/AdminAuthContext';
import { useTheme } from '@/context/ThemeContext';
import { api } from '@/lib/api';
import { hasPermission, hasAnyPermission } from '@/lib/adminAccess';

const LINKS = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true, permission: 'view_dashboard' },
  { to: '/users', label: 'User Management', icon: Users, permission: 'view_users' },
  { to: '/referrals', label: 'Refer & Earn', icon: Gift, permission: 'view_users' },
  { to: '/kyc', label: 'KYC', icon: UserCheck, permission: 'view_kyc' },
  { to: '/funds', label: 'Funds Overview', icon: Layers, permission: 'view_withdrawals', end: true },
  { to: '/withdrawals', label: 'Withdrawals', icon: ArrowUpCircle, permission: 'view_withdrawals' },
  { to: '/deposit-events', label: 'Deposit events', icon: ArrowDownCircle, permission: 'view_withdrawals' },
  { to: '/inr-deposits', label: 'INR deposits', icon: IndianRupee, permission: 'view_withdrawals', inrBadge: 'deposits' },
  { to: '/inr-withdrawals', label: 'INR withdrawals', icon: IndianRupee, permission: 'view_withdrawals', inrBadge: 'withdrawals' },
  { to: '/inr-settings', label: 'INR settings', icon: IndianRupee, permission: 'manage_settings' },
  { to: '/signzy-settings', label: 'Signzy verification', icon: ShieldCheck, permission: 'manage_settings' },
  { to: '/aml', label: 'AML Operations', icon: BadgeCheck, permission: 'view_compliance' },
  { to: '/fiu', label: 'FIU Reporting', icon: Scale, permission: 'view_compliance' },
  { to: '/security', label: 'Security Controls', icon: ShieldAlert, permission: 'view_security' },
  { to: '/alerts', label: 'Alerts', icon: Bell, alertBadge: true, permission: 'view_alerts' },
  { to: '/support-disputes', label: 'Support & Disputes', icon: HelpCircle, permission: 'view_support' },
  { to: '/finance', label: 'Finance & Reports', icon: ReceiptText, permission: 'view_finance' },
  { to: '/treasury', label: 'Treasury', icon: Landmark, permission: 'view_treasury' },
  { to: '/admin-wallet', label: 'Admin wallet', icon: Wallet, permission: 'view_treasury' },
  { to: '/treasury-transfer', label: 'Treasury Transfer', icon: Send, permission: 'view_treasury' },
  { to: '/treasury-omnibus', label: 'Hot & cold wallets', icon: Wallet, permission: 'view_treasury' },
  { to: '/markets', label: 'Market Management', icon: LineChart, permission: 'view_markets' },
  { to: '/market-catalog', label: 'Market Catalog', icon: Globe, permission: 'view_listings' },
  { to: '/token-listings', label: 'Token Listings', icon: Coins, permission: 'view_listings' },
  { to: '/analysis', label: 'Reports & Analytics', icon: BarChart3, permission: 'view_analytics' },
  { to: '/trading', label: 'Trading workspace', icon: Activity, permission: 'view_orders' },
  // ✅ Futures module (cleanly added)
  { to: '/futures', label: 'Futures Operations', icon: TrendingUp, end: true,
    permissions: ['view_orders', 'view_trades', 'view_finance', 'view_markets'] },
  { to: '/futures/activity', label: 'Futures Activity', icon: Activity,
    permissions: ['view_orders', 'view_trades', 'view_finance', 'adjust_wallets'] },
  { to: '/options', label: 'Options Operations', icon: CircleDot, end: true,
    permissions: ['view_markets', 'view_orders', 'manage_settings'] },
  { to: '/p2p', label: 'P2P Operations', icon: ArrowLeftRight, end: true,
    permissions: ['view_orders', 'view_support', 'view_users'] },
  { to: '/ibo', label: 'Delta Ecosystem', icon: Coins, end: true,
    permissions: ['view_markets', 'view_orders', 'manage_settings', 'view_finance'] },
  { to: '/trading-activity', label: 'Liquidity Activity', icon: Activity, permission: 'view_trades' },
  { to: '/surveillance', label: 'Risk & Alerts', icon: Radar, permission: 'run_surveillance' },
  { to: '/leaderboard', label: 'Leaderboard', icon: Trophy, permission: 'view_analytics' },
  { to: '/ledger', label: 'Ledger', icon: BookText, permission: 'view_ledger' },
  { to: '/wallet-adjustments', label: 'Wallet Management', icon: Wallet, permissions: ['manage_users', 'adjust_wallets'] },
  { to: '/audit', label: 'Audit Logs', icon: ScrollText, permission: 'view_system_logs' },
  { to: '/system-logs', label: 'System Monitoring', icon: FileText, permission: 'view_system_logs' },
  { to: '/hedger', label: 'Binance Hedger', icon: Shield, permission: 'view_hedger' },
  { to: '/liquidity-ops', label: 'Liquidity Operations', icon: Clock3, permission: 'view_hedger' },
  // ✅ Settings (fixed order + no duplicate)
  { to: '/settings/admin-create', label: 'Create Admin', icon: UserPlus, permission: 'manage_admins' },
  { to: '/settings/mobile-app', label: 'Mobile app', icon: Smartphone, permission: 'view_settings' },
  { to: '/settings/landing-promo', label: 'Landing promo', icon: Sparkles, permission: 'view_settings' },
  { to: '/settings/app-home-banners', label: 'App home banners', icon: ImageIcon, permission: 'view_settings' },
  { to: '/settings', label: 'Settings', icon: Settings, end: true, permission: 'view_settings' },
];

const LINK_GROUPS = [
  { id: 'userOps', label: 'User Ops', links: ['/', '/users', '/kyc', '/support-disputes'] },
  { id: 'funds', label: 'Funds', links: ['/funds', '/withdrawals', '/deposit-events', '/inr-deposits', '/inr-withdrawals', '/inr-settings', '/signzy-settings', '/ledger', '/wallet-adjustments', '/finance', '/treasury', '/admin-wallet', '/treasury-transfer', '/treasury-omnibus'] },
  { id: 'spotTrading', label: 'Trading Ops', links: ['/trading', '/trading-activity'] },
  { id: 'futures', label: 'Futures Trading', links: ['/futures', '/futures/activity'] },
  { id: 'options', label: 'Options Trading', links: ['/options'] },
  { id: 'p2p', label: 'P2P Trading', links: ['/p2p'] },
  { id: 'ibo', label: 'Delta Trading', links: ['/ibo'] },
  { id: 'markets', label: 'Markets', links: ['/markets', '/market-catalog', '/token-listings'] },
  { id: 'analytics', label: 'Analytics', links: ['/analysis', '/leaderboard'] },
  { id: 'liquidity', label: 'Hedging & liquidity', links: ['/hedger', '/liquidity-ops'] },
  { id: 'compliance', label: 'Compliance & Security', links: ['/aml', '/fiu', '/surveillance', '/security', '/alerts', '/audit', '/system-logs'] },
  { id: 'system', label: 'System', links: ['/settings', '/settings/mobile-app', '/settings/landing-promo', '/settings/app-home-banners', '/settings/admin-create'] },
];

// Phase 9c — alert-counter badge. Kept in ``AdminLayout`` so it updates
// on every page even if the user never opens /alerts. Polled every 30s
// (aligned with the page itself) and collapses to nothing when zero.
function useAlertStats() {
  const [stats, setStats] = useState(null);
  useEffect(() => {
    let alive = true;
    let timer = null;
    async function poll() {
      try {
        const res = await api.alertsStats();
        const body = await res.json();
        if (alive && res.ok) setStats(body);
      } catch {
        // Swallow — a transient backend hiccup shouldn't crash the
        // whole admin layout.
      }
    }
    poll();
    timer = setInterval(poll, 30_000);
    return () => {
      alive = false;
      if (timer) clearInterval(timer);
    };
  }, []);
  return stats;
}

function useInrPendingStats() {
  const [pending, setPending] = useState({ deposits: 0, withdrawals: 0 });
  useEffect(() => {
    let alive = true;
    let timer = null;
    async function poll() {
      try {
        const res = await api.inrStats();
        const body = await res.json();
        if (alive && res.ok) {
          setPending({
            deposits: Number(body.pending_deposit_count ?? body.pending_count) || 0,
            withdrawals: Number(body.pending_withdrawal_count) || 0,
          });
        }
      } catch {
        /* ignore */
      }
    }
    poll();
    timer = setInterval(poll, 30_000);
    return () => {
      alive = false;
      if (timer) clearInterval(timer);
    };
  }, []);
  return pending;
}

function inrBadgeCount(kind, stats) {
  if (kind === 'deposits') return stats.deposits;
  if (kind === 'withdrawals') return stats.withdrawals;
  return stats.deposits + stats.withdrawals;
}

function InrBadge({ count }) {
  if (!count) return null;
  return (
    <span className="ml-auto inline-flex items-center justify-center min-w-[22px] h-5 px-1.5 rounded-full text-xs font-extrabold bg-gold text-black">
      {count > 99 ? '99+' : count}
    </span>
  );
}

function AlertBadge({ stats }) {
  const open = stats?.open || { critical: 0, warn: 0, info: 0, total: 0 };
  if (!open.total) return null;
  // Critical → rose + pulse. Warn → amber. Info only → white.
  const isCritical = open.critical > 0;
  const isWarn = !isCritical && open.warn > 0;
  const cls = isCritical
    ? 'bg-rose-500 text-white'
    : isWarn
    ? 'bg-gold text-black'
    : 'bg-white/20 text-white';
  return (
    <span className={`ml-auto inline-flex items-center justify-center min-w-[22px] h-5 px-1.5 rounded-full text-xs font-extrabold ${cls} ${isCritical ? 'animate-pulse' : ''}`}>
      {open.total > 99 ? '99+' : open.total}
    </span>
  );
}

export default function AdminLayout() {
  const { admin, logout } = useAdminAuth();
  const { isLight, toggleTheme } = useTheme();
  const navigate = useNavigate();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const [headerSearch, setHeaderSearch] = useState('');
  const [openGroups, setOpenGroups] = useState(() => ({
    userOps: true,
    funds: true,
    spotTrading: true,
    futures: true,
    options: true,
    markets: true,
    analytics: true,
    liquidity: true,
    compliance: true,
    system: true,
  }));
  const [searchOpen, setSearchOpen] = useState(false);
  const alertStats = useAlertStats();
  const inrPending = useInrPendingStats();
  const visibleLinks = LINKS.filter((link) => {
    if (link.permissions?.length) return hasAnyPermission(admin, link.permissions);
    return hasPermission(admin, link.permission);
  });
  const pageLabel = visibleLinks.find(({ to, end }) =>
    end ? location.pathname === to : location.pathname === to || location.pathname.startsWith(`${to}/`)
  )?.label || 'Admin Panel';
  const filteredLinks = headerSearch.trim()
    ? visibleLinks.filter((l) => l.label.toLowerCase().includes(headerSearch.trim().toLowerCase()))
    : [];

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  const linkClass = ({ isActive }) =>
    `flex items-center gap-3 px-4 py-3 rounded-xl text-base font-bold transition-colors ${
      isActive ? 'admin-nav-link-active text-[#FE9D55] border border-gold/25' : 'text-white/80 hover:bg-white/[.08] hover:text-white border border-transparent'
    }`;

  const groupedVisibleLinks = LINK_GROUPS.map((group) => ({
    ...group,
    links: group.links
      .map((to) => visibleLinks.find((v) => v.to === to))
      .filter(Boolean),
  })).filter((g) => g.links.length > 0);

  const jumpToLink = (to) => {
    navigate(to);
    setSearchOpen(false);
    setHeaderSearch('');
    setOpen(false);
  };

  return (
    <div className="admin-panel-root relative flex h-dvh min-h-0 max-h-dvh w-full flex-col overflow-hidden bg-surface-dark md:flex-row">
      <div className="admin-bg-blob one" />
      <div className="admin-bg-blob two" />
      <div className="admin-bg-blob three" />
      {/* Desktop sidebar — full viewport height; only the nav list scrolls */}
      <aside className="relative z-10 hidden h-full min-h-0 w-[260px] shrink-0 flex-col border-r border-surface-border bg-surface-card md:flex">
        <div className="shrink-0 border-b border-surface-border p-5">
          <p className="text-[#FE6C02] font-black text-2xl tracking-tight">Delta</p>
          <p className="text-white/55 text-sm font-semibold tracking-wide">Exchange Admin</p>
          <p className="mt-2 truncate font-mono text-sm text-white/75" title={import.meta.env.MODE}>
            {import.meta.env.MODE === 'production' ? 'Production' : 'Development'}
          </p>
        </div>
        <nav
          className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain p-3 scrollbar-thin"
          aria-label="Main navigation"
        >
          {groupedVisibleLinks.map((group) => (
            <div key={group.id} className="space-y-1">
              <button
                type="button"
                onClick={() => setOpenGroups((prev) => ({ ...prev, [group.id]: !prev[group.id] }))}
                className="w-full text-left px-2 py-1 text-[11px] uppercase tracking-wider text-white/45 font-extrabold"
              >
                {group.label}
              </button>
              {openGroups[group.id] && group.links.map(({ to, label, icon: Icon, end, alertBadge, inrBadge }) => (
                <NavLink key={to} to={to} end={end} className={linkClass} onClick={() => setOpen(false)}>
                  <Icon size={20} className="shrink-0 opacity-90" />
                  <span className="flex-1 truncate">{label}</span>
                  {alertBadge ? <AlertBadge stats={alertStats} /> : null}
                  {inrBadge ? <InrBadge count={inrBadgeCount(inrBadge, inrPending)} /> : null}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>
        <div className="shrink-0 border-t border-surface-border p-4">
          <p className="text-sm text-white/70 truncate mb-2" title={admin?.email}>{admin?.email}</p>
          <button
            type="button"
            onClick={() => { logout(); navigate('/login'); }}
            className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-bold bg-[#EB5454] text-white border border-[#EB5454] hover:bg-[#d94848] transition-colors"
          >
            <LogOut size={16} /> Log out
          </button>
        </div>
      </aside>

      {/* Main column: top bars fixed; page content scrolls */}
      <div className="relative z-10 flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <div className="hidden h-16 shrink-0 items-center justify-between border-b border-surface-border bg-surface-card px-6 md:flex">
          <div>
            <p className="text-base font-semibold text-white">{pageLabel}</p>
            <p className="text-xs text-white/70">Manage your exchange platform</p>
          </div>
          <div className="flex items-center gap-3">
            <div className="relative hidden lg:block">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/35" />
              <input
                type="text"
                value={headerSearch}
                onChange={(e) => { setHeaderSearch(e.target.value); setSearchOpen(true); }}
                onFocus={() => setSearchOpen(true)}
                placeholder="Quick jump..."
                className="w-64 pl-9 pr-4 py-2 bg-surface-card border border-surface-border rounded-lg text-white text-sm placeholder:text-white/35 focus:outline-none focus:border-gold/40"
              />
              {searchOpen && headerSearch.trim() && (
                <div className="absolute top-full mt-1 left-0 right-0 rounded-xl border border-surface-border bg-surface-card/95 shadow-2xl overflow-hidden z-20">
                  {filteredLinks.length === 0 ? (
                    <p className="px-3 py-2 text-xs text-white/50">No matching pages</p>
                  ) : filteredLinks.map((link) => (
                    <button
                      key={link.to}
                      type="button"
                      onClick={() => jumpToLink(link.to)}
                      className="w-full text-left px-3 py-2 text-sm text-white/85 hover:bg-white/[.06]"
                    >
                      {link.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={toggleTheme}
              aria-label={isLight ? 'Switch to dark theme' : 'Switch to light theme'}
              title={isLight ? 'Dark mode' : 'Light mode'}
              className="p-2 hover:bg-surface-hover rounded-lg text-white/60 hover:text-white border border-transparent hover:border-surface-border"
            >
              {isLight ? <Moon size={18} /> : <Sun size={18} />}
            </button>
            <button
              type="button"
              aria-label="Notifications"
              className="relative p-2 hover:bg-surface-hover rounded-lg text-white/60 hover:text-white"
            >
              <Bell size={18} />
              <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-rose-500" />
            </button>
            <StatusChip role={admin?.role} />
          </div>
        </div>
        <header className="z-40 flex shrink-0 items-center justify-between gap-3 border-b border-surface-border bg-surface-card px-4 py-3 pt-[max(0.75rem,env(safe-area-inset-top))] md:hidden">
          <span className="font-extrabold text-[#FE6C02]">Delta Admin</span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={toggleTheme}
              aria-label={isLight ? 'Switch to dark theme' : 'Switch to light theme'}
              className="p-2 rounded-lg border border-surface-border"
              style={{ color: 'var(--ibo-ink)' }}
            >
              {isLight ? <Moon size={18} /> : <Sun size={18} />}
            </button>
            <button
              type="button"
              onClick={() => setOpen(v => !v)}
              className="p-2 rounded-lg border border-surface-border"
              style={{ color: 'var(--ibo-ink)' }}
              aria-label="Menu"
            >
              {open ? <X size={22} /> : <Menu size={22} />}
            </button>
          </div>
        </header>

        {open && (
          <div className="md:hidden fixed inset-0 z-50 bg-black/70 backdrop-blur-sm pt-[env(safe-area-inset-top)]" onClick={() => setOpen(false)}>
            <nav
              className="absolute right-0 top-0 bottom-0 w-[min(100%,min(280px,100vw))] max-h-[100dvh] overflow-y-auto overscroll-contain bg-surface-card border-l border-surface-border p-4 pb-[max(1rem,env(safe-area-inset-bottom))] space-y-1"
              onClick={e => e.stopPropagation()}
            >
              {groupedVisibleLinks.map((group) => (
                <div key={group.id} className="space-y-1">
                  <p className="px-2 py-1 text-[11px] uppercase tracking-wider text-white/40 font-extrabold">{group.label}</p>
                  {group.links.map(({ to, label, icon: Icon, end, alertBadge, inrBadge }) => (
                    <NavLink key={to} to={to} end={end} className={linkClass} onClick={() => setOpen(false)}>
                      <Icon size={20} />
                      <span className="flex-1 truncate">{label}</span>
                      {alertBadge ? <AlertBadge stats={alertStats} /> : null}
                      {inrBadge ? <InrBadge count={inrBadgeCount(inrBadge, inrPending)} /> : null}
                    </NavLink>
                  ))}
                </div>
              ))}
              <button
                type="button"
                onClick={() => { logout(); navigate('/login'); setOpen(false); }}
                className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-lg text-sm font-bold bg-[#EB5454] text-white border border-[#EB5454] hover:bg-[#d94848] transition-colors mt-4"
              >
                <LogOut size={18} /> Log out
              </button>
            </nav>
          </div>
        )}

        {import.meta.env.DEV ? (
          <div
            className="fixed bottom-2 right-2 z-[200] pointer-events-none rounded-lg bg-[#FE6C02]/15 border border-[#FE6C02]/35 px-2.5 py-1 text-[10px] font-bold text-[#FE9D55] shadow-lg"
            title="ibo-admin on :5174 — use Market Catalog in sidebar for landing/markets display settings"
          >
            Admin UI · /market-catalog
          </div>
        ) : null}
        <div className="adm-main-scroll min-h-0 w-full min-w-0 flex-1 touch-pan-y overflow-x-hidden overflow-y-auto p-0">
          <main className="admin-content mx-auto w-full max-w-[1700px] p-3 pb-[max(1rem,env(safe-area-inset-bottom))] sm:p-5 md:p-6 lg:p-8">
            <Outlet />
          </main>
        </div>
      </div>
    </div>
  );
}

function StatusChip({ role }) {
  const label = role ? role.toUpperCase() : 'ADMIN';
  return (
    <span className="inline-flex items-center rounded-full border border-[#FE6C02]/35 bg-[#FE6C02]/10 px-3 py-1 text-sm font-bold text-[#FE9D55]">
      {label}
    </span>
  );
}
