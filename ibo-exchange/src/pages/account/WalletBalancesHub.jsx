/**
 * Full multi-wallet balances hub — Account Value, Spot, FNO, Fee Voucher.
 * Used by /account/balances (matches nav wallet dropdown, with full detail).
 */
import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  Eye, EyeOff, Plus, ChevronRight, RefreshCw, Wallet,
  BarChart3, Coins, Ticket, ArrowLeftRight, Info,
} from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { futuresApi } from '@/services/futuresApi';
import WalletPage from '@/pages/WalletPage';

const USD_INR = 85;
const VIEWS = [
  { id: 'overview', label: 'Overview', icon: Wallet },
  { id: 'spot', label: 'Spot Wallet', icon: Coins },
  { id: 'fno', label: 'FNO Wallet', icon: BarChart3 },
  { id: 'voucher', label: 'Fee Voucher', icon: Ticket },
];

function num(v) {
  const n = typeof v === 'string' ? parseFloat(v) : Number(v);
  return Number.isFinite(n) ? n : 0;
}

function fmtMoney(n, dp = 2) {
  return num(n).toLocaleString(undefined, {
    minimumFractionDigits: dp,
    maximumFractionDigits: dp,
  });
}

function Dual({ inr, usd, hidden, large }) {
  if (hidden) {
    return (
      <div className={`wb-amt${large ? ' is-large' : ''}`}>
        <span className="wb-amt__inr">••••</span>
        <span className="wb-amt__usd">••••</span>
      </div>
    );
  }
  return (
    <div className={`wb-amt${large ? ' is-large' : ''}`}>
      <span className="wb-amt__inr">₹{fmtMoney(inr)}</span>
      <span className="wb-amt__usd">${fmtMoney(usd)}</span>
    </div>
  );
}

function FeeVoucherPanel() {
  return (
    <section className="wallet-surface overflow-hidden">
      <div className="px-5 sm:px-6 py-10 sm:py-14 text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-[#FE6C02]/12 text-[#FE6C02]">
          <Ticket size={22} strokeWidth={2} />
        </div>
        <h3 className="text-base font-bold text-[color:var(--ibo-ink)]">No fee vouchers yet</h3>
        <p className="mt-2 mx-auto max-w-md text-sm text-[color:var(--ibo-muted)] leading-relaxed">
          Trading fee credits appear here when issued from campaigns, referrals, or support.
          Apply them automatically at settlement when available.
        </p>
        <div className="mt-6 grid grid-cols-1 sm:grid-cols-3 gap-3 max-w-lg mx-auto text-left">
          {[
            { label: 'Available', value: '₹0.00' },
            { label: 'Used', value: '₹0.00' },
            { label: 'Expired', value: '₹0.00' },
          ].map((s) => (
            <div
              key={s.label}
              className="rounded-lg border border-[color:var(--ibo-border-solid)] px-4 py-3 wb-muted-tile"
            >
              <p className="text-[10px] font-semibold uppercase tracking-wider text-[color:var(--ibo-muted)]">
                {s.label}
              </p>
              <p className="mt-1 text-sm font-bold tabular-nums text-[color:var(--ibo-ink)]">{s.value}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

export default function WalletBalancesHub() {
  const { balance, walletAssets, walletLoading, fetchWallet } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const rawView = searchParams.get('wallet') || 'overview';
  const view = VIEWS.some((v) => v.id === rawView) ? rawView : 'overview';
  const [hidden, setHidden] = useState(false);
  const [fut, setFut] = useState(null);
  const [futLoading, setFutLoading] = useState(false);

  const setView = useCallback((id) => {
    if (id === 'overview') {
      setSearchParams({}, { replace: true });
    } else {
      setSearchParams({ wallet: id }, { replace: true });
    }
  }, [setSearchParams]);

  const loadFutures = useCallback(async () => {
    setFutLoading(true);
    try {
      const w = await futuresApi.wallet();
      setFut(w);
    } catch {
      setFut(null);
    } finally {
      setFutLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchWallet?.();
    void loadFutures();
  }, [fetchWallet, loadFutures]);

  const spotInr = num(balance?.INR);
  const spotUsdt = num(balance?.USDT);

  const futAvail = num(fut?.available ?? fut?.wallet_balance);
  const futUsed = num(fut?.used_margin);
  const futUnreal = num(fut?.unrealized_pnl);

  const spotUsd = spotInr / USD_INR + spotUsdt;
  const futUsd = futAvail + futUsed;
  const accountUsd = spotUsd + futUsd + futUnreal;
  const accountInr = accountUsd * USD_INR;
  const spotWalletInr = spotInr + spotUsdt * USD_INR;
  const fnoInr = futUsd * USD_INR;
  const marginInr = futAvail * USD_INR;
  const feeUsd = 0;
  const feeInr = 0;

  const refreshAll = () => {
    fetchWallet?.();
    void loadFutures();
  };

  const loading = walletLoading || futLoading;

  return (
    <div className="wallet-hub wallet-balances-hub font-ui min-w-0 space-y-5">
      {/* Account value hero */}
      <section className="wb-hero wallet-surface overflow-hidden">
        <div className="flex flex-col lg:flex-row lg:items-stretch">
          <div className="flex-1 min-w-0 px-5 sm:px-6 py-5 sm:py-6 border-b lg:border-b-0 lg:border-r border-[color:var(--ibo-border-solid)]">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
              <button
                type="button"
                className="wb-hero__label"
                onClick={() => setHidden((h) => !h)}
                title={hidden ? 'Show balances' : 'Hide balances'}
              >
                Account Value
                {hidden ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
              <Link to="/account/pnl" className="wb-pnl">
                PNL Analytics
                <ChevronRight size={13} strokeWidth={2.4} />
              </Link>
            </div>

            <Dual inr={accountInr} usd={accountUsd} hidden={hidden} large />

            <div className="mt-5 flex flex-wrap gap-2">
              <Link to="/account/deposits" className="wallet-action-primary">
                <Plus size={14} strokeWidth={2.5} />
                Add Funds
              </Link>
              <Link to="/account/withdrawals" className="wallet-action-ghost">
                Withdraw
              </Link>
              <Link to="/account/transaction-logs?tab=transfer" className="wallet-action-ghost">
                <ArrowLeftRight size={14} />
                Transfer
              </Link>
              <button
                type="button"
                onClick={refreshAll}
                disabled={loading}
                className="wallet-action-ghost disabled:opacity-40"
              >
                <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
                Refresh
              </button>
            </div>
          </div>

          <div className="lg:w-[min(100%,20rem)] grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-1 divide-x sm:divide-x lg:divide-x-0 divide-y-0 lg:divide-y divide-[color:var(--ibo-border-solid)]">
            {[
              { label: 'Spot', inr: spotWalletInr, usd: spotUsd, id: 'spot' },
              { label: 'FNO', inr: fnoInr, usd: futUsd, id: 'fno', badge: 'Primary' },
              { label: 'Avail. margin', inr: marginInr, usd: futAvail, id: 'fno' },
              { label: 'Fee voucher', inr: feeInr, usd: feeUsd, id: 'voucher' },
            ].map((s) => (
              <button
                key={`${s.id}-${s.label}`}
                type="button"
                onClick={() => setView(s.id)}
                className="wb-hero__stat text-left transition-colors px-4 sm:px-5 py-4 min-w-0"
              >
                <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[color:var(--ibo-muted)] flex items-center gap-1.5 truncate">
                  {s.label}
                  {s.badge ? <span className="wb-badge">{s.badge}</span> : null}
                </p>
                <div className="mt-1.5">
                  <Dual inr={s.inr} usd={s.usd} hidden={hidden} />
                </div>
              </button>
            ))}
          </div>
        </div>
        <div className="wb-hero__rate">
          <span>Conversion Rate: 1 USD = INR {USD_INR}</span>
          <span className="wb-hero__rate-i" title="Indicative dual-currency rate used for display">
            <Info size={12} strokeWidth={2.4} />
          </span>
        </div>
      </section>

      {/* Wallet type tabs */}
      <nav className="wb-tabs" aria-label="Wallet types">
        {VIEWS.map((t) => {
          const Icon = t.icon;
          const active = view === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setView(t.id)}
              className={`wb-tab${active ? ' is-active' : ''}`}
            >
              <Icon size={15} strokeWidth={2.1} />
              {t.label}
            </button>
          );
        })}
      </nav>

      {/* Sections */}
      {view === 'overview' && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <button type="button" className="wb-card" onClick={() => setView('spot')}>
            <div className="wb-card__top">
              <span className="wb-card__title">Spot Wallet</span>
              <ChevronRight size={16} className="text-[#FE6C02]" />
            </div>
            <p className="wb-card__desc">INR, USDT and crypto for spot trading</p>
            <Dual inr={spotWalletInr} usd={spotUsd} hidden={hidden} large />
            <div className="wb-card__meta">
              <span>{(walletAssets || []).length} assets</span>
              <span>Deposit · Withdraw · Trade</span>
            </div>
          </button>

          <div className="wb-card" role="button" tabIndex={0} onClick={() => setView('fno')} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setView('fno'); } }}>
            <div className="wb-card__top">
              <span className="wb-card__title">
                FNO Wallet
                <span className="wb-badge ml-1.5">Primary</span>
              </span>
              <ChevronRight size={16} className="text-[#FE6C02]" />
            </div>
            <p className="wb-card__desc">USDT-M futures margin &amp; options collateral</p>
            <Dual inr={fnoInr} usd={futUsd} hidden={hidden} large />
            <div className="wb-card__meta">
              <span>Avail. ₹{hidden ? '••••' : fmtMoney(marginInr)}</span>
              <span>
                uPnL{' '}
                {hidden
                  ? '••••'
                  : `${futUnreal >= 0 ? '+' : ''}${fmtMoney(futUnreal)} USDT`}
              </span>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <Link
                to="/account/transaction-logs?tab=transfer"
                className="wallet-action-primary !py-1.5 !text-xs"
                onClick={(e) => e.stopPropagation()}
              >
                <ArrowLeftRight size={12} /> Transfer
              </Link>
              <Link
                to="/futures/BTCUSDT-PERP"
                className="wallet-action-ghost !py-1.5 !text-xs"
                onClick={(e) => e.stopPropagation()}
              >
                Trade futures
              </Link>
            </div>
          </div>

          <button type="button" className="wb-card" onClick={() => setView('voucher')}>
            <div className="wb-card__top">
              <span className="wb-card__title">Fee Voucher</span>
              <ChevronRight size={16} className="text-[#FE6C02]" />
            </div>
            <p className="wb-card__desc">Trading fee credits and campaign rewards</p>
            <Dual inr={feeInr} usd={feeUsd} hidden={hidden} large />
            <div className="wb-card__meta">
              <span>0 active vouchers</span>
              <span>Redeem at settlement</span>
            </div>
          </button>
        </div>
      )}

      {view === 'spot' && (
        <div className="delta-account-embed">
          <WalletPage accountMode forcedTab="balances" hideChrome />
        </div>
      )}

      {view === 'fno' && (
        <div className="delta-account-embed">
          <WalletPage accountMode forcedTab="futures" hideChrome />
        </div>
      )}

      {view === 'voucher' && <FeeVoucherPanel />}
    </div>
  );
}
