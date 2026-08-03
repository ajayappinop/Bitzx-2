/**
 * FuturesWalletTab
 *
 * Self-contained "Futures" tab for the user-facing Wallet page. The user
 * wallet page lives outside of the futures trade page and therefore
 * doesn't have a ``<FuturesProvider>`` mounted in its tree, so this
 * component wraps itself in the provider — that way the rest of the
 * exchange stays unaware of futures internals.
 *
 * It surfaces:
 *   - Live margin balance + free / used breakdown
 *   - Unrealized PnL (live, from the account WS)
 *   - One-click Spot ↔ Futures transfer (via the existing modal)
 *   - Recent margin ledger entries with a "Refresh" button
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowLeftRight, Wallet, TrendingUp, TrendingDown, RefreshCw, ExternalLink, Filter,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { FuturesProvider, useFutures } from '@/context/FuturesContext';
import { futuresApi } from '@/services/futuresApi';
import TransferModal from './TransferModal';

const LEDGER_TYPE_LABELS = {
  transfer_in:      'Transfer in',
  transfer_out:     'Transfer out',
  realized_pnl:     'Realized PnL',
  funding_payment:  'Funding payment',
  funding_received: 'Funding received',
  funding:          'Funding settlement',
  fee:              'Trading fee',
  liquidation:      'Liquidation',
  liquidation_fee:  'Liquidation fee',
  margin_lock:      'Margin locked',
  margin_unlock:    'Margin released',
  adjustment:       'Adjustment',
  admin_credit:     'Admin credit',
  admin_debit:      'Admin debit',
};

/**
 * Translate a ledger direction into the signed amount the user wants to
 * see. The backend stores ``amount`` as a positive scalar plus a
 * ``direction`` discriminator — credit/unlock add to spendable balance,
 * debit/lock remove it.
 */
function signedAmount(t) {
  const amt = Math.abs(Number(t?.amount || 0));
  const dir = t?.direction;
  if (dir === 'credit' || dir === 'unlock') return  amt;
  if (dir === 'debit'  || dir === 'lock')   return -amt;
  return amt;
}

function txnLabel(t) {
  const label = String(t?.label ?? t?.note ?? '').trim()
    || LEDGER_TYPE_LABELS[t?.type]
    || (t?.type || '—').replace(/_/g, ' ');
  const signed = signedAmount(t);
  const color  = signed >= 0 ? 'text-emerald-300' : 'text-rose-300';
  return { label, color };
}

function fmtAmount(n) {
  const v = Number(n || 0);
  const sign = v > 0 ? '+' : v < 0 ? '' : '';
  return `${sign}${v.toFixed(6).replace(/0+$/, '').replace(/\.$/, '')}`;
}

function balanceAfter(t) {
  if (!t?.balance_after) return 0;
  if (typeof t.balance_after === 'number') return t.balance_after;
  const av = Number(t.balance_after.available || 0);
  const lk = Number(t.balance_after.locked    || 0);
  return av + lk;
}

function fmtTime(iso) {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, {
      month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  } catch { return iso; }
}

function StatCard({ label, value, icon: Icon, tone = 'default', sub }) {
  const toneCls = tone === 'positive' ? 'text-emerald-500'
                : tone === 'negative' ? 'text-rose-500'
                : tone === 'cyan'     ? 'text-[#5BB8FF]'
                : 'text-[color:var(--ibo-ink)]';
  return (
    <div className="rounded-xl border border-[color:var(--ibo-border-solid)] bg-[color:var(--ibo-card)] p-4 shadow-[var(--ibo-shadow)]">
      <div className="flex items-center gap-2 text-xs text-[color:var(--ibo-muted)] uppercase tracking-wider mb-2 font-semibold">
        {Icon && <Icon size={12} />} {label}
      </div>
      <div className={`text-xl sm:text-2xl font-bold font-mono tabular-nums ${toneCls}`}>{value}</div>
      {sub && <div className="text-[11px] text-[color:var(--ibo-muted)] mt-1">{sub}</div>}
    </div>
  );
}

const WALLET_PAGE_SIZE = 20;

function FuturesWalletTabInner() {
  const { wallet } = useFutures();
  const [open, setOpen]             = useState(false);
  const [txns, setTxns]             = useState([]);
  const [loading, setLoading]       = useState(false);
  const [err, setErr]               = useState(null);
  const [posHistory, setPosHistory] = useState([]);

  // Filters for closed positions
  const [posSymFilter,  setPosSymFilter]  = useState('');
  const [posSideFilter, setPosSideFilter] = useState('all');
  const [posPnlFilter,  setPosPnlFilter]  = useState('all');
  const [posPage,       setPosPage]       = useState(1);

  // Filters for ledger
  const [txnTypeFilter, setTxnTypeFilter] = useState('');
  const [txnPage,       setTxnPage]       = useState(1);

  const balance         = Number(wallet?.wallet_balance   || 0);
  const available       = Number(wallet?.available        || 0);
  const usedMargin      = Number(wallet?.used_margin      || 0);
  const unrealizedPnl   = Number(wallet?.unrealized_pnl   || 0);
  const marginBalance   = Number(wallet?.margin_balance   || 0);
  const freeMargin      = Number(wallet?.free_margin      || 0);
  const positionMargin  = Number(wallet?.position_margin  || usedMargin);

  const equity = marginBalance || (balance + unrealizedPnl);
  const marginRatio = equity > 0 && positionMargin > 0
    ? (positionMargin / equity) * 100
    : 0;

  const totalRealizedPnl = posHistory.reduce((s, p) => s + Number(p.realized_pnl ?? 0), 0);
  const winCount  = posHistory.filter(p => Number(p.realized_pnl ?? 0) > 0).length;
  const winRate   = posHistory.length > 0 ? (winCount / posHistory.length) * 100 : 0;

  // Unique symbols for filter dropdown
  const posSymbols = useMemo(() => {
    const s = new Set(posHistory.map(p => p.symbol).filter(Boolean));
    return Array.from(s).sort();
  }, [posHistory]);

  // Filtered + paginated closed positions
  const filteredPos = useMemo(() => posHistory.filter(p => {
    if (posSymFilter && p.symbol !== posSymFilter) return false;
    if (posSideFilter !== 'all' && String(p.side ?? '').toLowerCase() !== posSideFilter) return false;
    const rpnl = Number(p.realized_pnl ?? 0);
    if (posPnlFilter === 'profit' && rpnl <= 0) return false;
    if (posPnlFilter === 'loss'   && rpnl >= 0) return false;
    return true;
  }), [posHistory, posSymFilter, posSideFilter, posPnlFilter]);

  const posTotalPages = Math.max(1, Math.ceil(filteredPos.length / WALLET_PAGE_SIZE));
  const posSlice      = filteredPos.slice((posPage - 1) * WALLET_PAGE_SIZE, posPage * WALLET_PAGE_SIZE);
  const filteredRpnl  = filteredPos.reduce((s, p) => s + Number(p.realized_pnl ?? 0), 0);

  // Filtered + paginated ledger
  const filteredTxns   = useMemo(() =>
    txnTypeFilter ? txns.filter(t => t.type === txnTypeFilter) : txns,
  [txns, txnTypeFilter]);
  const txnTotalPages  = Math.max(1, Math.ceil(filteredTxns.length / WALLET_PAGE_SIZE));
  const txnSlice       = filteredTxns.slice((txnPage - 1) * WALLET_PAGE_SIZE, txnPage * WALLET_PAGE_SIZE);

  // Unique txn types for filter
  const txnTypes = useMemo(() => {
    const s = new Set(txns.map(t => t.type).filter(Boolean));
    return Array.from(s).sort();
  }, [txns]);

  const selCls = 'bg-[color:var(--ibo-card)] border border-[color:var(--ibo-border-solid)] rounded-lg px-3 py-1.5 text-xs text-white/80 outline-none focus:border-[rgba(91,184,255,0.55)] transition-colors';

  const reload = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const [txnRes, histRes] = await Promise.allSettled([
        futuresApi.walletTxns({ limit: 50 }),
        futuresApi.positionsHistory({ limit: 100 }),
      ]);
      if (txnRes.status === 'fulfilled') {
        const r = txnRes.value;
        setTxns(Array.isArray(r?.txns) ? r.txns : (Array.isArray(r) ? r : []));
      }
      if (histRes.status === 'fulfilled') {
        setPosHistory(Array.isArray(histRes.value?.positions) ? histRes.value.positions : []);
      }
    } catch (e) {
      setErr(e?.detail || e?.message || 'failed to load history');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { reload(); }, [reload]);

  // Refetch txns whenever the wallet snapshot changes balance — this picks
  // up newly-completed transfers without spamming the endpoint on every
  // 1s account WS tick. We compare the rounded balance string so micro
  // PnL drift doesn't trigger refetches.
  const balanceKey = Number(wallet?.wallet_balance || 0).toFixed(6);
  useEffect(() => {
    if (!wallet) return;
    reload();
    // intentional: only the materialised balance, not unrealizedPnl, drives
    // a refresh. The WS-pushed `wallet` object itself is enough for stats.
  }, [balanceKey, reload, wallet]);

  const pnlTone = unrealizedPnl > 0 ? 'positive' : unrealizedPnl < 0 ? 'negative' : 'default';
  const realTone = totalRealizedPnl > 0 ? 'positive' : totalRealizedPnl < 0 ? 'negative' : 'default';
  const overallPnl = unrealizedPnl + totalRealizedPnl;

  return (
    <div className="space-y-6 animate-[fadeIn_0.2s_ease-out]">
      {/* ── Headline + actions ───────────────────────────────────────── */}
      <div className="bg-gradient-to-r from-[rgba(91,184,255,0.1)] via-[rgba(91,184,255,0.06)] to-transparent border border-[rgba(91,184,255,0.2)] rounded-2xl p-5 sm:p-6">
        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-widest text-[#5BB8FF]/80 font-bold">
              USDT-M Futures Wallet
            </p>
            <h2 className="text-2xl sm:text-3xl font-extrabold text-[color:var(--ibo-ink)] mt-1">
              {balance.toFixed(2)} <span className="text-[color:var(--ibo-muted)] text-base">USDT</span>
            </h2>
            <p className="text-xs text-white/55 mt-1">
              Margin balance ≈ {marginBalance.toFixed(2)} USDT
              {unrealizedPnl !== 0 && (
                <span className={unrealizedPnl > 0 ? 'text-emerald-300 ml-2' : 'text-rose-300 ml-2'}>
                  ({unrealizedPnl > 0 ? '+' : ''}{unrealizedPnl.toFixed(2)} unrealized)
                </span>
              )}
            </p>
            {/* Total P&L pill */}
            <div className="mt-3 inline-flex items-center gap-3 bg-[color:var(--ibo-elevated)] border border-white/[.06] rounded-xl px-4 py-2">
              <div className="text-center">
                <p className="text-[10px] text-white/40 uppercase tracking-wider">Overall P&L</p>
                <p className={`text-base font-bold font-mono ${overallPnl >= 0 ? 'text-emerald-300' : 'text-rose-300'}`}>
                  {overallPnl >= 0 ? '+' : ''}{overallPnl.toFixed(2)} USDT
                </p>
              </div>
              <div className="w-px h-8 bg-white/10" />
              <div className="text-center">
                <p className="text-[10px] text-white/40 uppercase tracking-wider">Realized</p>
                <p className={`text-base font-bold font-mono ${totalRealizedPnl >= 0 ? 'text-emerald-300' : 'text-rose-300'}`}>
                  {totalRealizedPnl >= 0 ? '+' : ''}{totalRealizedPnl.toFixed(2)} USDT
                </p>
              </div>
              <div className="w-px h-8 bg-white/10" />
              <div className="text-center">
                <p className="text-[10px] text-white/40 uppercase tracking-wider">Win rate</p>
                <p className="text-base font-bold font-mono text-[#5BB8FF]">{winRate.toFixed(0)}%</p>
              </div>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => setOpen(true)}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-gradient-to-r from-[#0EA4AB] to-[#5BB8FF] hover:opacity-95 text-[#050a1a] font-bold text-sm"
            >
              <ArrowLeftRight size={14} /> Transfer
            </button>
            <Link
              to="/futures/BTCUSDT-PERP"
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[color:var(--ibo-elevated)] hover:bg-[color:var(--ibo-hover)] text-white font-semibold text-sm border border-[color:var(--ibo-border-solid)]"
            >
              <ExternalLink size={14} /> Open trading
            </Link>
          </div>
        </div>
      </div>

      {/* ── Stat grid ────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3 sm:gap-4">
        <StatCard label="Available"       value={`${available.toFixed(2)} USDT`} icon={Wallet} tone="cyan"
                  sub="Free for new orders & withdrawals" />
        <StatCard label="Used margin"     value={`${usedMargin.toFixed(2)} USDT`}
                  sub="Locked by open orders & positions" />
        <StatCard label="Unrealized PnL"  value={`${unrealizedPnl >= 0 ? '+' : ''}${unrealizedPnl.toFixed(2)} USDT`}
                  tone={pnlTone}
                  icon={unrealizedPnl >= 0 ? TrendingUp : TrendingDown}
                  sub="Mark-to-market PnL on open positions" />
        <StatCard label="Realized PnL"    value={`${totalRealizedPnl >= 0 ? '+' : ''}${totalRealizedPnl.toFixed(2)} USDT`}
                  tone={realTone}
                  icon={totalRealizedPnl >= 0 ? TrendingUp : TrendingDown}
                  sub={`${posHistory.length} closed pos. · ${winRate.toFixed(0)}% win rate`} />
        <StatCard label="Free margin"     value={`${freeMargin.toFixed(2)} USDT`}
                  sub="Equity − initial margin requirement" />
        <StatCard label="Margin balance"  value={`${marginBalance.toFixed(2)} USDT`}
                  sub="Balance + unrealized PnL" />
      </div>

      {/* ── Margin health bar ───────────────────────────────────────── */}
      <div className="bg-surface-card border border-surface-border rounded-xl p-4">
        <div className="flex items-center justify-between text-xs mb-2">
          <span className="text-white/55 uppercase tracking-wider">Margin ratio</span>
          <span className="font-mono text-white">{marginRatio.toFixed(2)}%</span>
        </div>
        <div className="h-2 rounded bg-white/5 overflow-hidden">
          <div
            className={`h-full rounded transition-all ${
              marginRatio < 40 ? 'bg-emerald-400' :
              marginRatio < 70 ? 'bg-[#5BB8FF]' : 'bg-rose-500'
            }`}
            style={{ width: `${Math.min(100, marginRatio)}%` }}
          />
        </div>
        <p className="text-[11px] text-white/45 mt-2">
          A higher ratio means more of your equity is tied up as collateral. Liquidations begin
          when the ratio approaches 100%.
        </p>
      </div>

      {/* ── Margin ledger with type filter + pagination ──────────────── */}
      <div className="bg-surface-card border border-surface-border rounded-xl overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 p-4 border-b border-surface-border">
          <h3 className="text-sm font-bold text-white">Margin ledger</h3>
          <div className="flex flex-wrap items-center gap-2">
            {txnTypes.length > 0 && (
              <div className="flex items-center gap-1.5">
                <Filter size={11} className="text-white/40" />
                <select value={txnTypeFilter}
                  onChange={e => { setTxnTypeFilter(e.target.value); setTxnPage(1); }}
                  className={selCls}>
                  <option value="">All types</option>
                  {txnTypes.map(tp => (
                    <option key={tp} value={tp}>{LEDGER_TYPE_LABELS[tp] || tp.replace(/_/g, ' ')}</option>
                  ))}
                </select>
              </div>
            )}
            <button onClick={reload} disabled={loading}
              className="inline-flex items-center gap-1.5 text-xs text-white/60 hover:text-white px-2 py-1 rounded hover:bg-[color:var(--ibo-hover)] disabled:opacity-50">
              <RefreshCw size={11} className={loading ? 'animate-spin' : ''} /> Refresh
            </button>
          </div>
        </div>

        {err && <div className="p-4 text-xs text-rose-300">{String(err)}</div>}

        {!err && filteredTxns.length === 0 && (
          <div className="p-8 text-center text-white/45 text-sm">
            {loading ? 'Loading…' : txnTypeFilter ? 'No entries match this filter.' : 'No futures wallet activity yet.'}
          </div>
        )}

        {filteredTxns.length > 0 && (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-[color:var(--ibo-elevated)] text-white/55 text-[11px] uppercase tracking-wider">
                  <tr>
                    <th className="text-left px-4 py-2.5">When</th>
                    <th className="text-left px-4 py-2.5">Type</th>
                    <th className="text-right px-4 py-2.5">Amount</th>
                    <th className="text-right px-4 py-2.5">Balance after</th>
                    <th className="text-left px-4 py-2.5 hidden sm:table-cell">Note</th>
                  </tr>
                </thead>
                <tbody>
                  {txnSlice.map((t, idx) => {
                    const m = txnLabel(t);
                    const signed = signedAmount(t);
                    return (
                      <tr key={t.id || `${t.created_at}-${idx}`} className="border-t border-surface-border/60 hover:bg-[color:var(--ibo-elevated)]">
                        <td className="px-4 py-2.5 text-white/65 whitespace-nowrap">{fmtTime(t.created_at)}</td>
                        <td className="px-4 py-2.5"><span className={`text-xs font-semibold ${m.color}`}>{m.label}</span></td>
                        <td className={`px-4 py-2.5 text-right font-mono ${signed >= 0 ? 'text-emerald-300' : 'text-rose-300'}`}>
                          {fmtAmount(signed)} <span className="text-white/40">USDT</span>
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono text-white/80">{balanceAfter(t).toFixed(2)}</td>
                        <td className="px-4 py-2.5 text-white/55 hidden sm:table-cell truncate max-w-[280px]">
                          {t.meta?.note || t.note || t.meta?.symbol || (t.ref_id ? `#${String(t.ref_id).slice(0, 12)}` : '')}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {txnTotalPages > 1 && (
              <div className="flex items-center justify-between px-4 py-3 border-t border-surface-border text-xs text-white/40">
                <span>{filteredTxns.length} entries · page {txnPage}/{txnTotalPages}</span>
                <div className="flex gap-2">
                  <button onClick={() => setTxnPage(p => p - 1)} disabled={txnPage <= 1}
                    className="px-3 py-1.5 rounded-lg border border-[color:var(--ibo-border-solid)] font-bold text-white/60 hover:text-white disabled:opacity-25 transition-colors">← Prev</button>
                  <button onClick={() => setTxnPage(p => p + 1)} disabled={txnPage >= txnTotalPages}
                    className="px-3 py-1.5 rounded-lg border border-[color:var(--ibo-border-solid)] font-bold text-white/60 hover:text-white disabled:opacity-25 transition-colors">Next →</button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* ── Closed positions P&L history — filters + pagination ──────── */}
      {posHistory.length > 0 && (
        <div className="bg-surface-card border border-surface-border rounded-xl overflow-hidden">
          {/* Header + filters */}
          <div className="p-4 border-b border-surface-border space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <TrendingUp size={15} className="text-[#5BB8FF]" />
                Closed positions — realized P&amp;L
              </h3>
              <div className="text-right">
                <p className="text-[10px] text-white/35 uppercase tracking-wider">Filtered total</p>
                <p className={`text-sm font-bold font-mono ${filteredRpnl >= 0 ? 'text-emerald-300' : 'text-rose-300'}`}>
                  {filteredRpnl >= 0 ? '+' : ''}{filteredRpnl.toFixed(2)} USDT
                </p>
              </div>
            </div>
            {/* Filter row */}
            <div className="flex flex-wrap gap-2 items-center">
              <Filter size={11} className="text-white/35 flex-shrink-0" />
              <select value={posSymFilter}
                onChange={e => { setPosSymFilter(e.target.value); setPosPage(1); }}
                className={selCls}>
                <option value="">All symbols</option>
                {posSymbols.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
              <select value={posSideFilter}
                onChange={e => { setPosSideFilter(e.target.value); setPosPage(1); }}
                className={selCls}>
                <option value="all">Long &amp; Short</option>
                <option value="long">Long only</option>
                <option value="short">Short only</option>
              </select>
              <select value={posPnlFilter}
                onChange={e => { setPosPnlFilter(e.target.value); setPosPage(1); }}
                className={selCls}>
                <option value="all">All P&L</option>
                <option value="profit">Profit only</option>
                <option value="loss">Loss only</option>
              </select>
              <button onClick={() => { setPosSymFilter(''); setPosSideFilter('all'); setPosPnlFilter('all'); setPosPage(1); }}
                className="text-xs text-[#5BB8FF]/60 hover:text-[#5BB8FF] font-bold transition-colors ml-1">
                Reset
              </button>
              <span className="ml-auto text-xs text-white/35">{filteredPos.length} / {posHistory.length} positions</span>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-[color:var(--ibo-elevated)] text-white/55 text-[11px] uppercase tracking-wider">
                <tr>
                  <th className="text-left px-4 py-2.5">Closed</th>
                  <th className="text-left px-4 py-2.5">Symbol</th>
                  <th className="text-left px-4 py-2.5">Side</th>
                  <th className="text-right px-4 py-2.5">Size</th>
                  <th className="text-right px-4 py-2.5">Entry</th>
                  <th className="text-right px-4 py-2.5">Leverage</th>
                  <th className="text-right px-4 py-2.5">Realized P&amp;L</th>
                </tr>
              </thead>
              <tbody>
                {posSlice.length === 0 ? (
                  <tr><td colSpan={7} className="px-4 py-8 text-center text-white/35 text-sm">No positions match filters.</td></tr>
                ) : posSlice.map((p, i) => {
                  const rpnl = Number(p.realized_pnl ?? 0);
                  return (
                    <tr key={p.id || i} className="border-t border-surface-border/60 hover:bg-[color:var(--ibo-elevated)]">
                      <td className="px-4 py-2.5 text-white/55 whitespace-nowrap">{fmtTime(p.closed_at || p.updated_at)}</td>
                      <td className="px-4 py-2.5 font-bold text-white">{p.symbol}</td>
                      <td className="px-4 py-2.5">
                        <span className={`text-xs font-semibold uppercase px-2 py-0.5 rounded ${
                          String(p.side).toLowerCase() === 'long' ? 'text-emerald-300 bg-emerald-500/10' : 'text-rose-300 bg-rose-500/10'
                        }`}>{p.side}</span>
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono text-white/80">{Number(p.size ?? p.qty ?? 0).toFixed(4)}</td>
                      <td className="px-4 py-2.5 text-right font-mono text-white/80">${Number(p.entry_price ?? 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}</td>
                      <td className="px-4 py-2.5 text-right font-mono text-white/80">{Number(p.leverage ?? 1).toFixed(0)}×</td>
                      <td className={`px-4 py-2.5 text-right font-mono font-bold ${rpnl >= 0 ? 'text-emerald-300' : 'text-rose-300'}`}>
                        {rpnl >= 0 ? '+' : ''}{rpnl.toFixed(2)} USDT
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {posTotalPages > 1 && (
            <div className="flex items-center justify-between px-4 py-3 border-t border-surface-border text-xs text-white/40">
              <span>{filteredPos.length} positions · page {posPage}/{posTotalPages}</span>
              <div className="flex gap-2">
                <button onClick={() => setPosPage(p => p - 1)} disabled={posPage <= 1}
                  className="px-3 py-1.5 rounded-lg border border-[color:var(--ibo-border-solid)] font-bold text-white/60 hover:text-white disabled:opacity-25 transition-colors">← Prev</button>
                <button onClick={() => setPosPage(p => p + 1)} disabled={posPage >= posTotalPages}
                  className="px-3 py-1.5 rounded-lg border border-[color:var(--ibo-border-solid)] font-bold text-white/60 hover:text-white disabled:opacity-25 transition-colors">Next →</button>
              </div>
            </div>
          )}
        </div>
      )}

      <TransferModal open={open} onClose={() => setOpen(false)} />
    </div>
  );
}

export default function FuturesWalletTab() {
  // Self-contained provider — keeps the rest of the wallet page agnostic
  // of futures-specific WebSocket lifecycle.
  return (
    <FuturesProvider>
      <FuturesWalletTabInner />
    </FuturesProvider>
  );
}
