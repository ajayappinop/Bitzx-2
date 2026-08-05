import { useEffect, useMemo, useState, useCallback } from 'react';
import { Link, Navigate } from 'react-router-dom';
import {
  RefreshCw, TrendingUp, Clock, CheckCircle, XCircle,
  ArrowUpRight, Wallet, LayoutDashboard,
} from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { COIN_ICONS, exchangeWsPath, normalizeMarketsList } from '@/services/marketApi';
import ClosePositionModal from '@/components/trading/ClosePositionModal';
import WalletPage from '@/pages/WalletPage';
import WalletBalancesHub from '@/pages/account/WalletBalancesHub';
import IboSwapPanel from '@/components/wallet/IboSwapPanel';
import ProfilePage from '@/pages/ProfilePage';
import KYCPage from '@/pages/KYCPage';
import SettingsPage from '@/pages/SettingsPage';
import ReferAndEarnPage from '@/pages/ReferAndEarnPage';
import SupportDisputesPage from '@/pages/SupportDisputesPage';
import PnLAnalyticsPage from '@/pages/PnLAnalyticsPage';
import HomeBannerCarousel from '@/components/dashboard/HomeBannerCarousel';
import {
  fetchInrWithdrawalEligibility,
  saveInrPayoutProfile,
} from '@/services/inrApi';

function fmtTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function fmtP(v) {
  const n = parseFloat(v);
  if (!Number.isFinite(n)) return '—';
  if (n >= 1000) return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
  if (n >= 1) return n.toFixed(4);
  return n.toFixed(6);
}

function EmptyState({ title, ctaTo = '/trade/IBOUSDT', cta = 'Start trading' }) {
  return (
    <div className="delta-account-empty">
      <p className="delta-account-empty__title">{title}</p>
      <Link to={ctaTo} className="delta-account-empty__cta">
        {cta} <ArrowUpRight size={14} />
      </Link>
    </div>
  );
}

function SummaryStrip({ items }) {
  return (
    <div className="delta-account-summary">
      {items.map((it) => (
        <div key={it.label} className="delta-account-summary__item">
          <p className="delta-account-summary__label">{it.label}</p>
          <p className={`delta-account-summary__value${it.tone ? ` is-${it.tone}` : ''}`}>
            {it.value}
          </p>
        </div>
      ))}
    </div>
  );
}

/* ─── Positions ─────────────────────────────────────────────────────────── */

export function AccountPositions() {
  const {
    user,
    liveSpotPositions,
    fetchLiveSpotPositions,
    balance,
  } = useAuth();
  const [closePos, setClosePos] = useState(null);
  const [mode, setMode] = useState('all'); // all | spot | futures
  const positions = liveSpotPositions ?? [];
  const loading = Boolean(user && liveSpotPositions == null);

  useEffect(() => {
    fetchLiveSpotPositions?.();
  }, [fetchLiveSpotPositions]);

  const filtered = useMemo(() => {
    if (mode === 'futures') return [];
    return positions;
  }, [mode, positions]);

  const totalUnreal = filtered.reduce((s, p) => s + (parseFloat(p.unrealized_pnl) || 0), 0);
  const totalMval = filtered.reduce((s, p) => s + (parseFloat(p.market_value_usdt) || 0), 0);
  const usdt = Number(balance?.USDT ?? 0);

  return (
    <div className="delta-account-panel">
      <SummaryStrip
        items={[
          { label: 'USDT balance', value: `$${usdt.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` },
          { label: 'Positions value', value: `$${totalMval.toLocaleString(undefined, { maximumFractionDigits: 2 })}` },
          {
            label: 'Unrealized P&L',
            value: `${totalUnreal >= 0 ? '+' : ''}$${totalUnreal.toLocaleString(undefined, { maximumFractionDigits: 2 })}`,
            tone: totalUnreal > 0 ? 'up' : totalUnreal < 0 ? 'down' : '',
          },
          { label: 'Open positions', value: String(filtered.length) },
        ]}
      />

      <div className="delta-account-tabs">
        {[
          { id: 'all', label: 'All' },
          { id: 'spot', label: 'Spot' },
          { id: 'futures', label: 'Futures' },
        ].map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setMode(t.id)}
            className={`delta-account-tabs__btn${mode === t.id ? ' is-active' : ''}`}
          >
            {t.label}
          </button>
        ))}
        <button
          type="button"
          className="delta-account-tabs__refresh"
          onClick={() => fetchLiveSpotPositions?.()}
          disabled={loading}
          title="Refresh"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {mode === 'futures' ? (
        <EmptyState
          title="No open futures positions"
          ctaTo="/futures/BTCUSDT-PERP"
          cta="Trade futures"
        />
      ) : loading ? (
        <div className="delta-account-empty">
          <p className="delta-account-empty__title">Loading positions…</p>
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState title="No open positions" />
      ) : (
        <div className="delta-account-table-wrap">
          <table className="delta-account-table">
            <thead>
              <tr>
                <th className="text-left">Contract</th>
                <th className="text-right">Size</th>
                <th className="text-right">Avg. entry</th>
                <th className="text-right">Mark</th>
                <th className="text-right">Value</th>
                <th className="text-right">Unrealized P&amp;L</th>
                <th className="text-right">ROE</th>
                <th className="text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((p) => {
                const upnl = Number(p.unrealized_pnl || 0);
                const pct = Number(p.unrealized_pnl_pct || 0);
                const qty = Number(p.amount || 0);
                const asset = p.asset || String(p.symbol || '').replace(/USDT$/i, '') || '—';
                const mark = Number(p.current_price || p.mark_price || 0);
                const entry = Number(p.avg_cost || p.avg_price || p.entry_price || 0);
                const mval = Number(p.market_value_usdt || 0);
                return (
                  <tr key={p.asset || p.symbol || asset}>
                    <td className="text-left">
                      <div className="flex items-center gap-2">
                        {COIN_ICONS[asset] ? (
                          <img src={COIN_ICONS[asset]} alt="" className="w-5 h-5 rounded-full" />
                        ) : null}
                        <span className="font-semibold text-[color:var(--ibo-ink)]">{asset}/USDT</span>
                        <span className="delta-account-pill">Spot</span>
                      </div>
                    </td>
                    <td className="text-right font-mono tabular-nums">{fmtP(qty)}</td>
                    <td className="text-right font-mono tabular-nums">{fmtP(entry)}</td>
                    <td className="text-right font-mono tabular-nums">{fmtP(mark)}</td>
                    <td className="text-right font-mono tabular-nums">
                      ${mval.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                    </td>
                    <td className={`text-right font-mono tabular-nums font-semibold ${upnl >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                      {upnl >= 0 ? '+' : ''}${upnl.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                    </td>
                    <td className={`text-right font-mono tabular-nums ${pct >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                      {pct >= 0 ? '+' : ''}{pct.toFixed(2)}%
                    </td>
                    <td className="text-right">
                      <button
                        type="button"
                        className="delta-account-close-btn"
                        onClick={() => setClosePos(p)}
                      >
                        Close
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {closePos ? (
        <ClosePositionModal
          position={closePos}
          onDismiss={() => setClosePos(null)}
          onSuccess={() => {
            setClosePos(null);
            fetchLiveSpotPositions?.();
          }}
        />
      ) : null}
    </div>
  );
}

/* ─── Orders tables ─────────────────────────────────────────────────────── */

export function AccountOrders({ mode = 'open' }) {
  const { openOrders, orderHistory, fetchOrders } = useAuth();
  const orders = mode === 'open' ? openOrders : orderHistory;

  useEffect(() => {
    fetchOrders?.();
  }, [fetchOrders]);

  return (
    <div className="delta-account-panel">
      <div className="delta-account-toolbar">
        <p className="text-sm text-[color:var(--ibo-muted)]">
          {orders.length} {mode === 'open' ? 'active' : 'total'} order{orders.length === 1 ? '' : 's'}
        </p>
        <button type="button" className="delta-account-tabs__refresh" onClick={() => fetchOrders?.()}>
          <RefreshCw size={14} />
        </button>
      </div>

      {orders.length === 0 ? (
        <EmptyState
          title={mode === 'open' ? 'No open orders' : 'No order history'}
        />
      ) : (
        <div className="delta-account-table-wrap">
          <table className="delta-account-table">
            <thead>
              <tr>
                <th className="text-left">Time</th>
                <th className="text-left">Contract</th>
                <th className="text-left">Side</th>
                <th className="text-left">Type</th>
                <th className="text-right">Price</th>
                <th className="text-right">Filled / Size</th>
                <th className="text-right">Status</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => (
                <tr key={o.id || `${o.symbol}-${o.created_at}`}>
                  <td className="text-left text-[color:var(--ibo-muted)] whitespace-nowrap">
                    {fmtTime(o.created_at || o.updated_at)}
                  </td>
                  <td className="text-left font-semibold">{o.symbol || '—'}</td>
                  <td className={`text-left font-bold uppercase ${o.side === 'buy' ? 'text-emerald-500' : 'text-rose-500'}`}>
                    {o.side}
                  </td>
                  <td className="text-left capitalize text-[color:var(--ibo-muted)]">{o.type || 'limit'}</td>
                  <td className="text-right font-mono">
                    {o.type === 'market' ? 'MKT' : `$${fmtP(o.avg_price > 0 ? o.avg_price : o.price)}`}
                  </td>
                  <td className="text-right font-mono">
                    {o.filled > 0 ? `${fmtP(o.filled)} / ` : ''}{fmtP(o.amount)}
                  </td>
                  <td className="text-right">
                    <span className="inline-flex items-center gap-1 text-xs font-semibold capitalize">
                      {o.status === 'filled' ? <CheckCircle size={12} className="text-emerald-500" /> : null}
                      {o.status === 'cancelled' ? <XCircle size={12} className="text-rose-500" /> : null}
                      {o.status === 'open' || o.status === 'new' || o.status === 'partially_filled' ? (
                        <Clock size={12} className="text-[color:var(--ibo-muted)]" />
                      ) : null}
                      {String(o.status || '').replace(/_/g, ' ')}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* ─── Trade history ─────────────────────────────────────────────────────── */

export function AccountTradeHistory() {
  const { userTrades, fetchUserTrades } = useAuth();

  useEffect(() => {
    fetchUserTrades?.();
  }, [fetchUserTrades]);

  return (
    <div className="delta-account-panel">
      <div className="delta-account-toolbar">
        <p className="text-sm text-[color:var(--ibo-muted)]">{userTrades.length} fill(s)</p>
        <button type="button" className="delta-account-tabs__refresh" onClick={() => fetchUserTrades?.()}>
          <RefreshCw size={14} />
        </button>
      </div>

      {userTrades.length === 0 ? (
        <EmptyState title="No trade history" />
      ) : (
        <div className="delta-account-table-wrap">
          <table className="delta-account-table">
            <thead>
              <tr>
                <th className="text-left">Time</th>
                <th className="text-left">Contract</th>
                <th className="text-left">Side</th>
                <th className="text-right">Price</th>
                <th className="text-right">Size</th>
                <th className="text-right">Fee</th>
                <th className="text-right">Realized P&amp;L</th>
              </tr>
            </thead>
            <tbody>
              {userTrades.map((t, i) => {
                const rpnl = t.realized_pnl != null ? Number(t.realized_pnl) : null;
                return (
                  <tr key={t.id || i}>
                    <td className="text-left text-[color:var(--ibo-muted)]">{fmtTime(t.created_at)}</td>
                    <td className="text-left font-semibold">{t.symbol}</td>
                    <td className={`text-left font-bold uppercase ${t.side === 'buy' ? 'text-emerald-500' : 'text-rose-500'}`}>
                      {t.side}
                    </td>
                    <td className="text-right font-mono">${fmtP(t.price)}</td>
                    <td className="text-right font-mono">{fmtP(t.amount)}</td>
                    <td className="text-right font-mono text-[color:var(--ibo-muted)]">
                      {fmtP(t.fee)} {t.fee_asset || ''}
                    </td>
                    <td className={`text-right font-mono ${rpnl == null ? '' : rpnl >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                      {rpnl == null ? '—' : `${rpnl >= 0 ? '+' : ''}$${rpnl.toFixed(2)}`}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* ─── Overview ──────────────────────────────────────────────────────────── */

export function AccountOverview() {
  const {
    user,
    balance,
    walletAssets,
    openOrders,
    orderHistory,
    liveSpotPositions,
  } = useAuth();
  const [priceByAsset, setPriceByAsset] = useState({ USDT: 1 });
  const positions = liveSpotPositions ?? [];

  useEffect(() => {
    if (!user) return undefined;
    let closed = false;
    let ws = null;
    let timer = null;
    const connect = () => {
      if (closed) return;
      ws = new WebSocket(exchangeWsPath('/api/ws/exchange/markets'));
      ws.onmessage = (ev) => {
        try {
          const j = JSON.parse(ev.data);
          if (j.type === 'exchange_markets' && Array.isArray(j.markets)) {
            const m = { USDT: 1 };
            for (const row of normalizeMarketsList(j.markets) || []) {
              const b = row.base || row.symbol?.replace('USDT', '');
              if (b) m[b] = parseFloat(row.price) || 0;
            }
            setPriceByAsset(m);
          }
        } catch { /* ignore */ }
      };
      ws.onclose = () => {
        ws = null;
        if (!closed) timer = window.setTimeout(connect, 3000);
      };
    };
    connect();
    return () => {
      closed = true;
      if (timer) clearTimeout(timer);
      try { ws?.close(); } catch { /* ignore */ }
    };
  }, [user]);

  const totalUSD = walletAssets.reduce(
    (s, w) => s + (w.available + w.locked) * (w.asset === 'USDT' ? 1 : (priceByAsset[w.asset] ?? 0)),
    0,
  );
  const upnl = positions.reduce((s, p) => s + (parseFloat(p.unrealized_pnl) || 0), 0);

  return (
    <div className="delta-account-panel space-y-5">
      <SummaryStrip
        items={[
          {
            label: 'Total equity (est.)',
            value: `$${totalUSD.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
          },
          {
            label: 'USDT balance',
            value: `$${(balance?.USDT || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
          },
          {
            label: 'Unrealized P&L',
            value: `${upnl >= 0 ? '+' : ''}$${upnl.toLocaleString(undefined, { maximumFractionDigits: 2 })}`,
            tone: upnl > 0 ? 'up' : upnl < 0 ? 'down' : '',
          },
          { label: 'Open orders', value: String(openOrders.length) },
        ]}
      />

      <HomeBannerCarousel className="!mb-0" height="220px" />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { to: '/account/positions', label: 'Positions', value: positions.length, icon: TrendingUp },
          { to: '/account/open-orders', label: 'Open orders', value: openOrders.length, icon: Clock },
          { to: '/account/balances', label: 'Wallet', value: walletAssets.length, icon: Wallet },
          {
            to: '/account/order-history',
            label: 'Filled orders',
            value: orderHistory.filter((o) => o.status === 'filled').length,
            icon: CheckCircle,
          },
        ].map((c) => (
          <Link key={c.to} to={c.to} className="delta-account-card">
            <c.icon size={16} className="text-[#fe6c02]" />
            <p className="delta-account-card__label">{c.label}</p>
            <p className="delta-account-card__value">{c.value}</p>
          </Link>
        ))}
      </div>

      <div className="flex flex-wrap gap-2">
        <Link to="/trade/IBOUSDT" className="delta-account-primary-btn">
          <LayoutDashboard size={14} /> Trade now
        </Link>
        <Link to="/account/deposits" className="delta-account-ghost-btn">
          Add funds
        </Link>
      </div>
    </div>
  );
}

/* ─── API Keys (Delta: /app/account/manageapikeys) ─────────────────────── */

export function AccountApiKeys() {
  return (
    <div className="delta-account-panel space-y-4">
      <p className="text-sm text-[color:var(--ibo-muted)] max-w-2xl">
        Create and manage API keys for algorithmic trading and third-party tools.
        Same surface as Delta&apos;s{' '}
        <span className="text-[color:var(--ibo-ink)] font-semibold">Manage API Keys</span>.
      </p>
      <div className="delta-account-table-wrap">
        <table className="delta-account-table">
          <thead>
            <tr>
              <th className="text-left">Name</th>
              <th className="text-left">Permissions</th>
              <th className="text-left">IP whitelist</th>
              <th className="text-left">Created</th>
              <th className="text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td colSpan={5} className="!py-12 text-center text-[color:var(--ibo-muted)]">
                No API keys yet. Key creation will appear here once trading API issuance is enabled for your account.
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <button
        type="button"
        disabled
        className="delta-account-primary-btn opacity-50 cursor-not-allowed"
        title="Coming soon"
      >
        Create API Key
      </button>
    </div>
  );
}

/* ─── Invoices (Delta Transaction Log / tax invoices) ───────────────────── */

export function AccountInvoices() {
  return (
    <div className="delta-account-panel space-y-4">
      <p className="text-sm text-[color:var(--ibo-muted)] max-w-2xl">
        Download daily, monthly, and yearly account statements — matching Delta&apos;s Invoices
        section under the account dashboard.
      </p>
      <div className="grid sm:grid-cols-3 gap-3">
        {[
          { label: 'Daily statement', desc: 'Last 24h activity summary' },
          { label: 'Monthly invoice', desc: 'Fees, funding & settles' },
          { label: 'Yearly statement', desc: 'Annual account summary' },
        ].map((c) => (
          <div key={c.label} className="delta-account-card !cursor-default">
            <p className="delta-account-card__label">{c.label}</p>
            <p className="text-sm text-[color:var(--ibo-muted)] mt-1">{c.desc}</p>
            <button
              type="button"
              className="mt-3 text-xs font-bold text-[#fe6c02] opacity-60 cursor-not-allowed"
              disabled
            >
              Download · soon
            </button>
          </div>
        ))}
      </div>
      <div className="delta-account-empty !min-h-[160px]">
        <p className="delta-account-empty__title">No invoices generated yet</p>
        <p className="text-sm text-[color:var(--ibo-muted)] text-center max-w-sm">
          Statements appear after trading activity posts to your ledger.
        </p>
        <Link to="/account/transaction-logs" className="delta-account-empty__cta mt-2">
          View transaction logs <ArrowUpRight size={14} />
        </Link>
      </div>
    </div>
  );
}

/* ─── Wallet embeds ─────────────────────────────────────────────────────── */

export function AccountBalances() {
  return (
    <div className="delta-account-embed">
      <WalletBalancesHub />
    </div>
  );
}

export function AccountDeposits() {
  return (
    <div className="delta-account-embed">
      <WalletPage accountMode forcedTab="deposit" />
    </div>
  );
}

export function AccountWithdrawals() {
  return (
    <div className="delta-account-embed">
      <WalletPage accountMode forcedTab="withdraw" />
    </div>
  );
}

export function AccountTransactionLogs() {
  return (
    <div className="delta-account-embed">
      <WalletPage accountMode forcedTab="ledger" />
    </div>
  );
}

export function AccountTransfer() {
  return (
    <div className="delta-account-embed">
      <IboSwapPanel />
    </div>
  );
}

/* ─── Thin wrappers for existing full pages ─────────────────────────────── */

export function AccountPnL() {
  return (
    <div className="delta-account-embed">
      <PnLAnalyticsPage accountMode />
    </div>
  );
}

/** @deprecated alias */
export function AccountPortfolio() {
  return <AccountPnL />;
}

export function AccountProfile() {
  return (
    <div className="delta-account-embed">
      <ProfilePage accountMode forcedTab="profile" />
    </div>
  );
}

export function AccountSecurity() {
  return (
    <div className="delta-account-embed">
      <ProfilePage accountMode forcedTab="security" />
    </div>
  );
}

export function AccountBankDetails() {
  return <BankDetailsPanel />;
}

export function AccountKyc() {
  return (
    <div className="delta-account-embed">
      <KYCPage accountMode />
    </div>
  );
}

export function AccountPreferences() {
  return (
    <div className="delta-account-embed">
      <SettingsPage accountMode />
    </div>
  );
}

export function AccountRefer() {
  return (
    <div className="delta-account-embed">
      <ReferAndEarnPage accountMode />
    </div>
  );
}

export function AccountSupport() {
  return (
    <div className="delta-account-embed">
      <SupportDisputesPage accountMode />
    </div>
  );
}

export function AccountIndexRedirect() {
  return <Navigate to="/account/positions" replace />;
}

/* ─── Bank Details (INR payout profile) ─────────────────────────────────── */

const EMPTY_BANK = {
  bank_name: '',
  account_holder_name: '',
  account_number: '',
  ifsc_code: '',
  branch: '',
};
const EMPTY_UPI = { upi_id: '', display_name: '' };

function BankDetailsPanel() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const [ok, setOk] = useState('');
  const [payoutType, setPayoutType] = useState('bank');
  const [bank, setBank] = useState(EMPTY_BANK);
  const [upi, setUpi] = useState(EMPTY_UPI);
  const [hasBank, setHasBank] = useState(false);
  const [hasUpi, setHasUpi] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setErr('');
    try {
      const elig = await fetchInrWithdrawalEligibility();
      const pp = elig?.payout_profile;
      setHasBank(!!pp?.has_bank);
      setHasUpi(!!pp?.has_upi);
      if (pp?.bank) {
        setBank({
          bank_name: pp.bank.bank_name || '',
          account_holder_name: pp.bank.account_holder_name || '',
          account_number: pp.bank.account_number || '',
          ifsc_code: pp.bank.ifsc_code || '',
          branch: pp.bank.branch || '',
        });
      }
      if (pp?.upi) {
        setUpi({
          upi_id: pp.upi.upi_id || '',
          display_name: pp.upi.display_name || '',
        });
      }
      if (pp?.has_bank) setPayoutType('bank');
      else if (pp?.has_upi) setPayoutType('upi');
    } catch (e) {
      setErr(e.message || 'Could not load bank details');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const save = async () => {
    setSaving(true);
    setErr('');
    setOk('');
    try {
      if (payoutType === 'bank') {
        if (!bank.bank_name?.trim() || !bank.account_holder_name?.trim()
          || !bank.account_number?.trim() || !bank.ifsc_code?.trim()) {
          throw new Error('Fill all required bank fields');
        }
        if (String(bank.ifsc_code).trim().length !== 11) {
          throw new Error('IFSC must be 11 characters');
        }
        await saveInrPayoutProfile({
          payout_type: 'bank',
          payout_details: {
            bank_name: bank.bank_name.trim(),
            account_holder_name: bank.account_holder_name.trim(),
            account_number: bank.account_number.trim(),
            ifsc_code: bank.ifsc_code.trim().toUpperCase(),
            ...(bank.branch?.trim() ? { branch: bank.branch.trim() } : {}),
          },
        });
      } else {
        if (!upi.upi_id?.trim() || !upi.display_name?.trim()) {
          throw new Error('UPI ID and account holder name are required');
        }
        if (!upi.upi_id.includes('@')) throw new Error('Enter a valid UPI ID');
        await saveInrPayoutProfile({
          payout_type: 'upi',
          payout_details: {
            upi_id: upi.upi_id.trim(),
            display_name: upi.display_name.trim(),
          },
        });
      }
      setOk('Bank details saved');
      await load();
    } catch (e) {
      setErr(e.message || 'Could not save bank details');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="delta-account-empty">
        <p className="delta-account-empty__title">Loading bank details…</p>
      </div>
    );
  }

  return (
    <div className="delta-account-panel max-w-xl space-y-5">
      <p className="text-sm text-[color:var(--ibo-muted)]">
        Manage the bank / UPI details used for INR deposits and withdrawals.
      </p>

      <div className="delta-account-tabs">
        {[
          { id: 'bank', label: hasBank ? 'Bank account ✓' : 'Bank account' },
          { id: 'upi', label: hasUpi ? 'UPI ✓' : 'UPI' },
        ].map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setPayoutType(t.id)}
            className={`delta-account-tabs__btn${payoutType === t.id ? ' is-active' : ''}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {err ? <p className="text-sm font-semibold text-rose-500">{err}</p> : null}
      {ok ? <p className="text-sm font-semibold text-emerald-500">{ok}</p> : null}

      {payoutType === 'bank' ? (
        <div className="space-y-3">
          {[
            ['bank_name', 'Bank name'],
            ['account_holder_name', 'Account holder name'],
            ['account_number', 'Account number'],
            ['ifsc_code', 'IFSC code'],
            ['branch', 'Branch (optional)'],
          ].map(([key, label]) => (
            <label key={key} className="block">
              <span className="text-[11px] font-bold uppercase tracking-wider text-[color:var(--ibo-muted)]">
                {label}
              </span>
              <input
                value={bank[key]}
                onChange={(e) => setBank((b) => ({ ...b, [key]: e.target.value }))}
                className="delta-account-input mt-1.5"
                autoComplete="off"
              />
            </label>
          ))}
        </div>
      ) : (
        <div className="space-y-3">
          <label className="block">
            <span className="text-[11px] font-bold uppercase tracking-wider text-[color:var(--ibo-muted)]">
              Account holder name
            </span>
            <input
              value={upi.display_name}
              onChange={(e) => setUpi((u) => ({ ...u, display_name: e.target.value }))}
              className="delta-account-input mt-1.5"
            />
          </label>
          <label className="block">
            <span className="text-[11px] font-bold uppercase tracking-wider text-[color:var(--ibo-muted)]">
              UPI ID
            </span>
            <input
              value={upi.upi_id}
              onChange={(e) => setUpi((u) => ({ ...u, upi_id: e.target.value }))}
              placeholder="name@bank"
              className="delta-account-input mt-1.5"
            />
          </label>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="delta-account-primary-btn disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save details'}
        </button>
        <Link to="/account/withdrawals" className="delta-account-ghost-btn">
          Go to withdrawals
        </Link>
      </div>
    </div>
  );
}
