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
  const toneCls = tone === 'positive' ? 'text-[#0ECB81]'
                : tone === 'negative' ? 'text-[#F6465D]'
                : tone === 'cyan'     ? 'text-[#FE6C02]'
                : 'text-[color:var(--ibo-ink)]';
  return (
    <div className="px-4 py-4 min-w-0">
      <div className="flex items-center gap-1.5 text-[10px] text-[color:var(--ibo-muted)] uppercase tracking-[0.12em] mb-1.5 font-semibold">
        {Icon && <Icon size={11} />} {label}
      </div>
      <div className={`text-lg sm:text-xl font-bold font-mono tabular-nums ${toneCls}`}>{value}</div>
      {sub && <div className="text-[11px] text-[color:var(--ibo-muted)] mt-1 leading-snug">{sub}</div>}
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

  const selCls = 'bg-[color:var(--ibo-bg)] border border-[color:var(--ibo-border-solid)] rounded-lg px-3 py-1.5 text-xs text-[color:var(--ibo-ink)] outline-none focus:border-[#FE6C02]/55 transition-colors';

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
    <div className="space-y-5 animate-[fadeIn_0.2s_ease-out]">
      {/* Headline band */}
      <section className="wallet-surface overflow-hidden">
        <div className="flex flex-col lg:flex-row lg:items-stretch">
          <div className="flex-1 min-w-0 px-5 sm:px-6 py-5 sm:py-6 border-b lg:border-b-0 lg:border-r border-[color:var(--ibo-border-solid)]">
            <p className="text-[11px] uppercase tracking-[0.14em] text-[#FE6C02] font-semibold">
              USDT-M Futures
            </p>
            <h2 className="text-3xl sm:text-4xl font-bold text-[color:var(--ibo-ink)] mt-2 tabular-nums tracking-tight">
              {balance.toFixed(2)} <span className="text-base font-semibold text-[color:var(--ibo-muted)]">USDT</span>
            </h2>
            <p className="text-xs text-[color:var(--ibo-muted)] mt-1.5">
              Margin balance ≈ {marginBalance.toFixed(2)} USDT
              {unrealizedPnl !== 0 && (
                <span className={unrealizedPnl > 0 ? 'text-[#0ECB81] ml-2' : 'text-[#F6465D] ml-2'}>
                  ({unrealizedPnl > 0 ? '+' : ''}{unrealizedPnl.toFixed(2)} unrealized)
                </span>
              )}
            </p>
            <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-sm">
              <div>
                <p className="text-[10px] uppercase tracking-wide text-[color:var(--ibo-muted)]">Overall P&amp;L</p>
                <p className={`font-bold font-mono tabular-nums ${overallPnl >= 0 ? 'text-[#0ECB81]' : 'text-[#F6465D]'}`}>
                  {overallPnl >= 0 ? '+' : ''}{overallPnl.toFixed(2)}
                </p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wide text-[color:var(--ibo-muted)]">Realized</p>
                <p className={`font-bold font-mono tabular-nums ${totalRealizedPnl >= 0 ? 'text-[#0ECB81]' : 'text-[#F6465D]'}`}>
                  {totalRealizedPnl >= 0 ? '+' : ''}{totalRealizedPnl.toFixed(2)}
                </p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wide text-[color:var(--ibo-muted)]">Win rate</p>
                <p className="font-bold font-mono text-[#FE6C02] tabular-nums">{winRate.toFixed(0)}%</p>
              </div>
            </div>
            <div className="mt-5 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setOpen(true)}
                className="wallet-action-primary"
              >
                <ArrowLeftRight size={14} /> Transfer
              </button>
              <Link
                to="/futures/BTCUSDT-PERP"
                className="wallet-action-ghost"
              >
                <ExternalLink size={14} /> Open trading
              </Link>
            </div>
          </div>
          <div className="lg:w-[min(100%,18rem)] px-5 sm:px-6 py-5">
            <div className="flex items-center justify-between text-xs mb-2">
              <span className="text-[color:var(--ibo-muted)] uppercase tracking-wider font-semibold">Margin ratio</span>
              <span className="font-mono text-[color:var(--ibo-ink)] tabular-nums">{marginRatio.toFixed(2)}%</span>
            </div>
            <div className="h-2 rounded-full bg-white/[0.06] overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${
                  marginRatio < 40 ? 'bg-[#0ECB81]' :
                  marginRatio < 70 ? 'bg-[#FE6C02]' : 'bg-[#F6465D]'
                }`}
                style={{ width: `${Math.min(100, marginRatio)}%` }}
              />
            </div>
            <p className="text-[11px] text-[color:var(--ibo-muted)] mt-3 leading-relaxed">
              Higher ratio means more equity is collateral. Liquidations approach when the ratio nears 100%.
            </p>
          </div>
        </div>
      </section>

      {/* Metric strip */}
      <section className="wallet-surface overflow-hidden">
        <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 divide-x divide-y lg:divide-y-0 divide-[color:var(--ibo-border-solid)]">
          <StatCard label="Available" value={`${available.toFixed(2)}`} icon={Wallet} tone="cyan"
                    sub="Free for orders" />
          <StatCard label="Used margin" value={`${usedMargin.toFixed(2)}`}
                    sub="Open risk" />
          <StatCard label="Unrealized" value={`${unrealizedPnl >= 0 ? '+' : ''}${unrealizedPnl.toFixed(2)}`}
                    tone={pnlTone}
                    icon={unrealizedPnl >= 0 ? TrendingUp : TrendingDown}
                    sub="Mark-to-market" />
          <StatCard label="Realized" value={`${totalRealizedPnl >= 0 ? '+' : ''}${totalRealizedPnl.toFixed(2)}`}
                    tone={realTone}
                    icon={totalRealizedPnl >= 0 ? TrendingUp : TrendingDown}
                    sub={`${posHistory.length} closed`} />
          <StatCard label="Free margin" value={`${freeMargin.toFixed(2)}`}
                    sub="Equity − IM" />
          <StatCard label="Margin bal." value={`${marginBalance.toFixed(2)}`}
                    sub="Balance + uPnL" />
        </div>
      </section>

      {/* Margin ledger */}
      <div className="wallet-surface overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 sm:px-5 py-3.5 border-b border-[color:var(--ibo-border-solid)]">
          <h3 className="text-sm font-bold text-[color:var(--ibo-ink)]">Margin ledger</h3>
          <div className="flex flex-wrap items-center gap-2">
            {txnTypes.length > 0 && (
              <div className="flex items-center gap-1.5">
                <Filter size={11} className="text-[color:var(--ibo-muted)]" />
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
            <button type="button" onClick={reload} disabled={loading}
              className="inline-flex items-center gap-1.5 text-xs text-[color:var(--ibo-muted)] hover:text-[color:var(--ibo-ink)] px-2 py-1 rounded disabled:opacity-50">
              <RefreshCw size={11} className={loading ? 'animate-spin' : ''} /> Refresh
            </button>
          </div>
        </div>

        {err && <div className="p-4 text-xs text-[#F6465D]">{String(err)}</div>}

        {!err && filteredTxns.length === 0 && (
          <div className="p-8 text-center text-[color:var(--ibo-muted)] text-sm">
            {loading ? 'Loading…' : txnTypeFilter ? 'No entries match this filter.' : 'No futures wallet activity yet.'}
          </div>
        )}

        {filteredTxns.length > 0 && (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-[color:var(--ibo-muted)] text-[11px] uppercase tracking-wider border-b border-[color:var(--ibo-border-solid)]">
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
                      <tr key={t.id || `${t.created_at}-${idx}`} className="border-t border-[color:var(--ibo-border-solid)] hover:bg-white/[0.02]">
                        <td className="px-4 py-2.5 text-[color:var(--ibo-muted)] whitespace-nowrap">{fmtTime(t.created_at)}</td>
                        <td className="px-4 py-2.5"><span className={`text-xs font-semibold ${m.color}`}>{m.label}</span></td>
                        <td className={`px-4 py-2.5 text-right font-mono ${signed >= 0 ? 'text-[#0ECB81]' : 'text-[#F6465D]'}`}>
                          {fmtAmount(signed)} <span className="text-[color:var(--ibo-muted)]">USDT</span>
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono text-[color:var(--ibo-ink)]">{balanceAfter(t).toFixed(2)}</td>
                        <td className="px-4 py-2.5 text-[color:var(--ibo-muted)] hidden sm:table-cell truncate max-w-[280px]">
                          {t.meta?.note || t.note || t.meta?.symbol || (t.ref_id ? `#${String(t.ref_id).slice(0, 12)}` : '')}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {txnTotalPages > 1 && (
              <div className="flex items-center justify-between px-4 py-3 border-t border-[color:var(--ibo-border-solid)] text-xs text-[color:var(--ibo-muted)]">
                <span>{filteredTxns.length} entries · page {txnPage}/{txnTotalPages}</span>
                <div className="flex gap-2">
                  <button type="button" onClick={() => setTxnPage(p => p - 1)} disabled={txnPage <= 1}
                    className="wallet-action-ghost !py-1.5 disabled:opacity-25">← Prev</button>
                  <button type="button" onClick={() => setTxnPage(p => p + 1)} disabled={txnPage >= txnTotalPages}
                    className="wallet-action-ghost !py-1.5 disabled:opacity-25">Next →</button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Closed positions */}
      {posHistory.length > 0 && (
        <div className="wallet-surface overflow-hidden">
          <div className="p-4 sm:px-5 border-b border-[color:var(--ibo-border-solid)] space-y-3">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-bold text-[color:var(--ibo-ink)] flex items-center gap-2">
                <TrendingUp size={15} className="text-[#FE6C02]" />
                Closed positions
              </h3>
              <div className="text-right">
                <p className="text-[10px] text-[color:var(--ibo-muted)] uppercase tracking-wider">Filtered total</p>
                <p className={`text-sm font-bold font-mono tabular-nums ${filteredRpnl >= 0 ? 'text-[#0ECB81]' : 'text-[#F6465D]'}`}>
                  {filteredRpnl >= 0 ? '+' : ''}{filteredRpnl.toFixed(2)} USDT
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2 items-center">
              <Filter size={11} className="text-[color:var(--ibo-muted)] flex-shrink-0" />
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
              <button type="button" onClick={() => { setPosSymFilter(''); setPosSideFilter('all'); setPosPnlFilter('all'); setPosPage(1); }}
                className="text-xs text-[#FE6C02] font-bold transition-colors ml-1">
                Reset
              </button>
              <span className="ml-auto text-xs text-[color:var(--ibo-muted)]">{filteredPos.length} / {posHistory.length}</span>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-[color:var(--ibo-muted)] text-[11px] uppercase tracking-wider border-b border-[color:var(--ibo-border-solid)]">
                <tr>
                  <th className="text-left px-4 py-2.5">Closed</th>
                  <th className="text-left px-4 py-2.5">Symbol</th>
                  <th className="text-left px-4 py-2.5">Side</th>
                  <th className="text-right px-4 py-2.5">Size</th>
                  <th className="text-right px-4 py-2.5">Entry</th>
                  <th className="text-right px-4 py-2.5">Lev</th>
                  <th className="text-right px-4 py-2.5">Realized</th>
                </tr>
              </thead>
              <tbody>
                {posSlice.length === 0 ? (
                  <tr><td colSpan={7} className="px-4 py-8 text-center text-[color:var(--ibo-muted)] text-sm">No positions match filters.</td></tr>
                ) : posSlice.map((p, i) => {
                  const rpnl = Number(p.realized_pnl ?? 0);
                  return (
                    <tr key={p.id || i} className="border-t border-[color:var(--ibo-border-solid)] hover:bg-white/[0.02]">
                      <td className="px-4 py-2.5 text-[color:var(--ibo-muted)] whitespace-nowrap">{fmtTime(p.closed_at || p.updated_at)}</td>
                      <td className="px-4 py-2.5 font-bold text-[color:var(--ibo-ink)]">{p.symbol}</td>
                      <td className="px-4 py-2.5">
                        <span className={`text-xs font-semibold uppercase px-2 py-0.5 rounded ${
                          String(p.side).toLowerCase() === 'long' ? 'text-[#0ECB81] bg-[#0ECB81]/10' : 'text-[#F6465D] bg-[#F6465D]/10'
                        }`}>{p.side}</span>
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono text-[color:var(--ibo-ink)]">{Number(p.size ?? p.qty ?? 0).toFixed(4)}</td>
                      <td className="px-4 py-2.5 text-right font-mono text-[color:var(--ibo-ink)]">${Number(p.entry_price ?? 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}</td>
                      <td className="px-4 py-2.5 text-right font-mono text-[color:var(--ibo-ink)]">{Number(p.leverage ?? 1).toFixed(0)}×</td>
                      <td className={`px-4 py-2.5 text-right font-mono font-bold ${rpnl >= 0 ? 'text-[#0ECB81]' : 'text-[#F6465D]'}`}>
                        {rpnl >= 0 ? '+' : ''}{rpnl.toFixed(2)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {posTotalPages > 1 && (
            <div className="flex items-center justify-between px-4 py-3 border-t border-[color:var(--ibo-border-solid)] text-xs text-[color:var(--ibo-muted)]">
              <span>{filteredPos.length} positions · page {posPage}/{posTotalPages}</span>
              <div className="flex gap-2">
                <button type="button" onClick={() => setPosPage(p => p - 1)} disabled={posPage <= 1}
                  className="wallet-action-ghost !py-1.5 disabled:opacity-25">← Prev</button>
                <button type="button" onClick={() => setPosPage(p => p + 1)} disabled={posPage >= posTotalPages}
                  className="wallet-action-ghost !py-1.5 disabled:opacity-25">Next →</button>
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
