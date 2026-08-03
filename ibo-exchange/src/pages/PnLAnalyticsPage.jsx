import { useState, useEffect, useCallback, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { RefreshCw, TrendingUp, TrendingDown, Filter, ArrowLeft } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { PAIRS, COIN_ICONS } from '@/services/marketApi';
import ClosePositionModal from '@/components/trading/ClosePositionModal';
import TradeFillDetailModal from '@/components/trading/TradeFillDetailModal';

const PAIR_OPTIONS = PAIRS.map(p => p.symbol);

const cardShell =
  'rounded-2xl border border-[color:var(--ibo-border-solid)] bg-[color:var(--ibo-card)] shadow-[var(--ibo-shadow)]';
const fieldShell =
  'mt-1.5 w-full rounded-xl bg-[color:var(--ibo-elevated)] border border-[color:var(--ibo-border-solid)] px-3 py-2.5 text-sm font-semibold text-[color:var(--ibo-ink)] focus:outline-none focus:border-[rgba(91,184,255,0.55)] transition-colors';
const labelShell =
  'text-[11px] font-extrabold text-[color:var(--ibo-muted)] uppercase tracking-widest';

/** API symbols are like BTCUSDT; normalize for comparisons. */
function normSymbol(s) {
  if (s == null || s === '') return '';
  return String(s).replace(/\//g, '').toUpperCase();
}

/** Local calendar day bounds for yyyy-mm-dd from &lt;input type="date" /&gt;. */
function localDayBounds(ymd) {
  const parts = ymd.split('-').map(Number);
  const y = parts[0];
  const m = parts[1];
  const d = parts[2];
  if (!y || !m || !d) return null;
  const start = new Date(y, m - 1, d, 0, 0, 0, 0).getTime();
  const end = new Date(y, m - 1, d, 23, 59, 59, 999).getTime();
  return { start, end };
}

function parseTradeTimeMs(iso) {
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : ms;
}

const TRADE_FMT = iso =>
  new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });

const MIN_CLOSE_BASE = 0.0001;

function SummaryCard({ label, children, hint }) {
  return (
    <div className={`${cardShell} p-5`}>
      <p className="text-[color:var(--ibo-muted)] text-xs font-extrabold uppercase tracking-widest mb-1">{label}</p>
      {children}
      {hint ? <p className="text-[color:var(--ibo-muted)] text-xs mt-2">{hint}</p> : null}
    </div>
  );
}

export default function PnLAnalyticsPage() {
  const {
    authLoading,
    fetchWallet,
    fetchOrders,
    userTrades,
    fetchUserTrades,
    liveSpotPositions,
    fetchLiveSpotPositions,
  } = useAuth();
  const [positions, setPositions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [closePosition, setClosePosition] = useState(null);
  const [fillDetail, setFillDetail] = useState(null);
  const [pairFilter, setPairFilter] = useState('');
  const [posPnlFilter, setPosPnlFilter] = useState('all');
  const [tradeSide, setTradeSide] = useState('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [loadError, setLoadError] = useState(null);

  const allPairOptions = useMemo(() => {
    const set = new Set(PAIR_OPTIONS.map(normSymbol));
    positions.forEach(p => {
      if (p.symbol) set.add(normSymbol(p.symbol));
    });
    userTrades.forEach(t => {
      if (t.symbol) set.add(normSymbol(t.symbol));
    });
    return Array.from(set).filter(Boolean).sort();
  }, [positions, userTrades]);

  useEffect(() => {
    if (liveSpotPositions != null) {
      setPositions(liveSpotPositions);
      setLoadError(null);
    }
  }, [liveSpotPositions]);

  useEffect(() => {
    setLoading(authLoading || liveSpotPositions == null);
  }, [authLoading, liveSpotPositions]);

  const refreshAll = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      await Promise.all([fetchLiveSpotPositions(), fetchUserTrades()]);
    } catch (e) {
      setLoadError(e.message || 'Network error while loading.');
    } finally {
      setLoading(false);
    }
  }, [fetchLiveSpotPositions, fetchUserTrades]);

  const fromBounds = dateFrom ? localDayBounds(dateFrom) : null;
  const toBounds = dateTo ? localDayBounds(dateTo) : null;

  const filteredPositions = useMemo(() => {
    const want = normSymbol(pairFilter);
    return positions.filter(p => {
      if (want && normSymbol(p.symbol) !== want) return false;
      const upnl = Number(p.unrealized_pnl ?? 0);
      if (posPnlFilter === 'profit' && upnl <= 0) return false;
      if (posPnlFilter === 'loss' && upnl >= 0) return false;
      return true;
    });
  }, [positions, pairFilter, posPnlFilter]);

  const filteredTrades = useMemo(() => {
    const want = normSymbol(pairFilter);
    return userTrades.filter(t => {
      if (want && normSymbol(t.symbol) !== want) return false;
      if (tradeSide !== 'all' && String(t.side).toLowerCase() !== tradeSide) return false;
      const ms = parseTradeTimeMs(t.created_at);
      if (fromBounds && (ms == null || ms < fromBounds.start)) return false;
      if (toBounds && (ms == null || ms > toBounds.end)) return false;
      return true;
    });
  }, [userTrades, pairFilter, tradeSide, fromBounds, toBounds]);

  const posSummary = useMemo(() => {
    const unrealized = filteredPositions.reduce((s, p) => s + Number(p.unrealized_pnl ?? 0), 0);
    const invested = filteredPositions.reduce((s, p) => s + Number(p.total_invested ?? 0), 0);
    const mval = filteredPositions.reduce((s, p) => s + Number(p.market_value_usdt ?? 0), 0);
    return { unrealized, invested, mval, count: filteredPositions.length };
  }, [filteredPositions]);

  const tradeSummary = useMemo(() => {
    let buyVol = 0;
    let sellVol = 0;
    let feesUsdt = 0;
    let realizedSum = 0;
    for (const t of filteredTrades) {
      const notional = Number(t.price) * Number(t.amount);
      const sd = String(t.side || '').toLowerCase();
      if (sd === 'buy') buyVol += notional;
      else sellVol += notional;
      if (t.fee_asset === 'USDT') feesUsdt += Number(t.fee ?? 0);
      if (sd === 'sell' && t.realized_pnl != null && !Number.isNaN(Number(t.realized_pnl))) {
        realizedSum += Number(t.realized_pnl);
      }
    }
    return { buyVol, sellVol, feesUsdt, realizedSum, count: filteredTrades.length };
  }, [filteredTrades]);

  const resetFilters = () => {
    setPairFilter('');
    setPosPnlFilter('all');
    setTradeSide('all');
    setDateFrom('');
    setDateTo('');
  };

  return (
    <div className="ibo-page font-ui pb-16">
      <div className="w-full px-4 sm:px-5 md:px-6 lg:px-8 xl:px-10 2xl:px-12 pt-6 sm:pt-8">

        {/* Hero */}
        <div
          className="relative overflow-hidden rounded-2xl border border-[color:var(--ibo-border-solid)] mb-6 p-5 sm:p-7"
          style={{
            background:
              'linear-gradient(135deg, var(--ibo-card) 0%, color-mix(in srgb, var(--ibo-card) 92%, #5BB8FF) 55%, var(--ibo-card) 100%)',
          }}
        >
          <div
            className="pointer-events-none absolute right-0 top-0 h-full w-1/3 opacity-25"
            style={{ background: 'radial-gradient(ellipse at right center, #5BB8FF, transparent 70%)' }}
          />
          <div className="relative flex flex-wrap items-center gap-3 sm:gap-4">
            <Link
              to="/trade/IBOUSDT"
              className="inline-flex items-center gap-2 text-[color:var(--ibo-muted)] hover:text-[#5BB8FF] text-sm font-semibold transition-colors"
            >
              <ArrowLeft size={16} /> Back to trade
            </Link>
            <div className="min-w-0">
              <p className="ibo-eyebrow mb-1">Analytics</p>
              <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-[color:var(--ibo-ink)]">
                P&amp;L &amp; fills
              </h1>
            </div>
            <button
              type="button"
              onClick={refreshAll}
              disabled={loading}
              className="ml-auto inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-[color:var(--ibo-border-solid)] text-sm font-bold text-[color:var(--ibo-ink)] hover:border-[rgba(91,184,255,0.4)] hover:bg-[color:var(--ibo-hover)] transition-colors disabled:opacity-40"
            >
              <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
              Refresh
            </button>
          </div>
        </div>

        {loadError && (
          <div
            className="mb-6 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm font-semibold text-red-500"
            role="alert"
          >
            {loadError}
          </div>
        )}

        {/* Filters */}
        <div className={`${cardShell} p-5 mb-8`}>
          <div className="flex items-center gap-2 text-[#5BB8FF] font-bold text-sm mb-4">
            <Filter size={16} /> Filters
          </div>
          <p className="text-[color:var(--ibo-muted)] text-xs mb-4 -mt-2">
            Pair applies to both open positions and trade fills. Dates use your device timezone.
          </p>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <div>
              <label className={labelShell}>Pair</label>
              <select
                value={pairFilter}
                onChange={e => setPairFilter(normSymbol(e.target.value))}
                className={fieldShell}
              >
                <option value="">All pairs</option>
                {allPairOptions.map(s => (
                  <option key={s} value={s}>
                    {s.replace('USDT', '/USDT')}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelShell}>Unrealized P&amp;L</label>
              <select
                value={posPnlFilter}
                onChange={e => setPosPnlFilter(e.target.value)}
                className={fieldShell}
              >
                <option value="all">All positions</option>
                <option value="profit">Profitable only</option>
                <option value="loss">Losing only</option>
              </select>
            </div>
            <div>
              <label className={labelShell}>Trade side</label>
              <select
                value={tradeSide}
                onChange={e => setTradeSide(e.target.value)}
                className={fieldShell}
              >
                <option value="all">Buy &amp; sell</option>
                <option value="buy">Buy only</option>
                <option value="sell">Sell only</option>
              </select>
            </div>
            <div>
              <label className={labelShell}>From date</label>
              <input
                type="date"
                value={dateFrom}
                onChange={e => setDateFrom(e.target.value)}
                className={fieldShell}
              />
            </div>
            <div>
              <label className={labelShell}>To date</label>
              <input
                type="date"
                value={dateTo}
                onChange={e => setDateTo(e.target.value)}
                className={fieldShell}
              />
            </div>
          </div>
          <button
            type="button"
            onClick={resetFilters}
            className="mt-4 text-xs font-bold text-[#5BB8FF] hover:underline"
          >
            Reset all filters
          </button>
        </div>

        {/* Summary cards */}
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4 mb-10">
          <SummaryCard
            label="Filtered unrealized P&L"
            hint={`${posSummary.count} position(s) in view`}
          >
            <p className={`text-2xl font-extrabold font-mono flex items-center gap-2 tabular-nums ${posSummary.unrealized >= 0 ? 'text-green-500' : 'text-red-500'}`}>
              {posSummary.unrealized >= 0 ? <TrendingUp size={22} /> : <TrendingDown size={22} />}
              {posSummary.unrealized >= 0 ? '+' : ''}
              ${posSummary.unrealized.toLocaleString(undefined, { maximumFractionDigits: 2 })}
            </p>
          </SummaryCard>
          <SummaryCard
            label="Market value (filtered)"
            hint={`Cost basis $${posSummary.invested.toLocaleString(undefined, { maximumFractionDigits: 2 })}`}
          >
            <p className="text-2xl font-extrabold font-mono text-[color:var(--ibo-ink)] tabular-nums">
              ${posSummary.mval.toLocaleString(undefined, { maximumFractionDigits: 2 })}
            </p>
          </SummaryCard>
          <SummaryCard label="Trade volume (filtered)">
            <p className="text-lg font-bold text-[color:var(--ibo-ink)] tabular-nums">
              Buy ${tradeSummary.buyVol.toLocaleString(undefined, { maximumFractionDigits: 0 })}
            </p>
            <p className="text-lg font-bold text-[color:var(--ibo-ink)] tabular-nums">
              Sell ${tradeSummary.sellVol.toLocaleString(undefined, { maximumFractionDigits: 0 })}
            </p>
          </SummaryCard>
          <SummaryCard
            label="Est. USDT fees (filtered)"
            hint={`${tradeSummary.count} fill(s) in view`}
          >
            <p className="text-2xl font-extrabold font-mono text-[#5BB8FF] tabular-nums">
              ${tradeSummary.feesUsdt.toLocaleString(undefined, { maximumFractionDigits: 4 })}
            </p>
          </SummaryCard>
          <SummaryCard
            label="Realized P&L on sells (filtered)"
            hint="Average-cost basis; buy fills show no per-fill P&L"
          >
            <p
              className={`text-2xl font-extrabold font-mono tabular-nums ${
                tradeSummary.realizedSum >= 0 ? 'text-green-500' : 'text-red-500'
              }`}
            >
              {tradeSummary.realizedSum >= 0 ? '+' : ''}
              ${tradeSummary.realizedSum.toLocaleString(undefined, { maximumFractionDigits: 2 })}
            </p>
          </SummaryCard>
        </div>

        {/* Positions table */}
        <section className="mb-12">
          <h2 className="text-lg font-extrabold text-[color:var(--ibo-ink)] mb-4">Open positions</h2>
          <p className="text-[color:var(--ibo-muted)] text-sm mb-3 max-w-3xl">
            Spot holdings with average cost and mark P&amp;L. Use <span className="text-[#5BB8FF] font-semibold">Close</span> to
            market or limit sell your <strong className="text-[color:var(--ibo-ink)]">available</strong> balance (same API as Trade → Assets). Requires approved KYC.
          </p>
          <div className={`${cardShell} overflow-hidden`}>
            {loading && positions.length === 0 ? (
              <div className="flex items-center justify-center py-16 gap-2 text-[color:var(--ibo-muted)]">
                <RefreshCw className="animate-spin text-[#5BB8FF]" size={20} /> Loading…
              </div>
            ) : filteredPositions.length === 0 ? (
              <p className="text-center py-14 text-[color:var(--ibo-muted)]">No positions match these filters.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-[11px] font-extrabold text-[color:var(--ibo-muted)] uppercase tracking-widest border-b border-[color:var(--ibo-border-solid)] bg-[color:var(--ibo-elevated)]">
                      <th className="px-4 py-3">Asset</th>
                      <th className="px-4 py-3 text-right">Amount</th>
                      <th className="px-4 py-3 text-right">Avg cost</th>
                      <th className="px-4 py-3 text-right">Price</th>
                      <th className="px-4 py-3 text-right">Value</th>
                      <th className="px-4 py-3">Last fill</th>
                      <th className="px-4 py-3 text-right">Unrealized P&amp;L</th>
                      <th className="px-4 py-3 text-right">P&amp;L %</th>
                      <th className="px-4 py-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredPositions.map(p => {
                      const icon = COIN_ICONS[p.asset];
                      const upnl = Number(p.unrealized_pnl ?? 0);
                      const pct = Number(p.unrealized_pnl_pct ?? 0);
                      return (
                        <tr key={p.asset} className="ibo-hover-table-row border-b border-[color:var(--ibo-border-solid)]">
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2">
                              {icon && <img src={icon} alt="" className="w-7 h-7 rounded-full" />}
                              <span className="font-extrabold text-[color:var(--ibo-ink)]">{p.asset}</span>
                            </div>
                          </td>
                          <td className="px-4 py-3 text-right font-mono text-[color:var(--ibo-ink)] tabular-nums">{Number(p.amount).toLocaleString(undefined, { maximumFractionDigits: 6 })}</td>
                          <td className="px-4 py-3 text-right font-mono text-[color:var(--ibo-ink-secondary)] tabular-nums">${Number(p.avg_cost).toLocaleString(undefined, { maximumFractionDigits: 6 })}</td>
                          <td className="px-4 py-3 text-right font-mono text-[color:var(--ibo-ink)] tabular-nums">${Number(p.current_price).toLocaleString(undefined, { maximumFractionDigits: 6 })}</td>
                          <td className="px-4 py-3 text-right font-mono font-bold text-[color:var(--ibo-ink)] tabular-nums">${Number(p.market_value_usdt).toLocaleString(undefined, { maximumFractionDigits: 2 })}</td>
                          <td className="px-4 py-3 text-xs">
                            {p.last_fill_side ? (
                              <div>
                                <span
                                  className={`font-extrabold uppercase ${
                                    String(p.last_fill_side).toLowerCase() === 'buy' ? 'text-green-500' : 'text-red-500'
                                  }`}
                                >
                                  {String(p.last_fill_side).toLowerCase() === 'buy' ? 'Buy' : 'Sell'}
                                </span>
                                <div className="text-[color:var(--ibo-ink)] font-mono mt-1 tabular-nums">
                                  {Number(p.last_fill_amount ?? 0).toLocaleString(undefined, { maximumFractionDigits: 6 })} @ $
                                  {Number(p.last_fill_price ?? 0).toLocaleString(undefined, { maximumFractionDigits: 6 })}
                                </div>
                                <div className="text-[color:var(--ibo-muted)] font-mono text-[11px] mt-0.5">
                                  {p.last_fill_at ? new Date(p.last_fill_at).toLocaleString() : '—'}
                                </div>
                              </div>
                            ) : (
                              <span className="text-[color:var(--ibo-muted)]">—</span>
                            )}
                          </td>
                          <td className={`px-4 py-3 text-right font-mono font-bold tabular-nums ${upnl >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                            {upnl >= 0 ? '+' : ''}${upnl.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                          </td>
                          <td className={`px-4 py-3 text-right font-mono font-bold tabular-nums ${pct >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                            {pct >= 0 ? '+' : ''}{pct.toFixed(2)}%
                          </td>
                          <td className="px-4 py-3 text-right">
                            {Number(p.available) >= MIN_CLOSE_BASE ? (
                              <button
                                type="button"
                                onClick={() => setClosePosition(p)}
                                className="text-xs font-extrabold px-3 py-1.5 rounded-lg bg-red-500/15 text-red-500 border border-red-500/30 hover:bg-red-500/25 transition-colors"
                              >
                                Close
                              </button>
                            ) : (
                              <span className="text-[color:var(--ibo-muted)] text-xs" title="Nothing available to sell (check locked in open orders)">
                                —
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
          <p className="text-[color:var(--ibo-muted)] text-xs mt-3">
            You can also sell from <Link to="/wallet" className="text-[#5BB8FF] font-semibold hover:underline">Wallet</Link> (Sell opens the terminal on the sell tab) or from <Link to="/trade/IBOUSDT" className="text-[#5BB8FF] font-semibold hover:underline">Trade</Link> → Assets.
          </p>
        </section>

        {/* Trades */}
        <section>
          <h2 className="text-lg font-extrabold text-[color:var(--ibo-ink)] mb-4">Trade fills</h2>
          <p className="text-[color:var(--ibo-muted)] text-sm mb-3">
            Each row is one execution (fill). <span className="text-[#5BB8FF] font-semibold">Click a row</span> for IDs, fees, notional, and realized P&amp;L.
          </p>
          <div className={`${cardShell} overflow-hidden`}>
            {loading && userTrades.length === 0 ? (
              <div className="flex items-center justify-center py-16 gap-2 text-[color:var(--ibo-muted)]">
                <RefreshCw className="animate-spin text-[#5BB8FF]" size={20} /> Loading…
              </div>
            ) : filteredTrades.length === 0 ? (
              <p className="text-center py-14 text-[color:var(--ibo-muted)]">No fills match these filters.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-[11px] font-extrabold text-[color:var(--ibo-muted)] uppercase tracking-widest border-b border-[color:var(--ibo-border-solid)] bg-[color:var(--ibo-elevated)]">
                      <th className="px-4 py-3">Time</th>
                      <th className="px-4 py-3">Pair</th>
                      <th className="px-4 py-3">Side</th>
                      <th className="px-4 py-3">Source</th>
                      <th className="px-4 py-3 text-right">Price</th>
                      <th className="px-4 py-3 text-right">Amount</th>
                      <th className="px-4 py-3 text-right">Notional</th>
                      <th className="px-4 py-3 text-right">Realized P&amp;L</th>
                      <th className="px-4 py-3 text-right">Fee</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredTrades.map(t => {
                      const n = Number(t.price) * Number(t.amount);
                      const rp = t.realized_pnl != null ? Number(t.realized_pnl) : null;
                      const showPnl = t.side === 'sell' && rp != null && !Number.isNaN(rp);
                      return (
                        <tr
                          key={t.id}
                          role="button"
                          tabIndex={0}
                          onClick={() => setFillDetail(t)}
                          onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setFillDetail(t); } }}
                          className="ibo-hover-table-row border-b border-[color:var(--ibo-border-solid)] cursor-pointer transition-colors"
                        >
                          <td className="px-4 py-3 font-mono text-[color:var(--ibo-ink-secondary)] tabular-nums">{TRADE_FMT(t.created_at)}</td>
                          <td className="px-4 py-3 font-bold text-[color:var(--ibo-ink)]">{t.symbol.replace('USDT', '/USDT')}</td>
                          <td className="px-4 py-3">
                            <span
                              className={`text-xs font-extrabold uppercase px-2 py-1 rounded-md ${
                                t.side === 'buy' ? 'bg-green-500/15 text-green-500' : 'bg-red-500/15 text-red-500'
                              }`}
                            >
                              {t.side}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            <span className="text-xs font-extrabold uppercase px-2 py-1 rounded-md bg-[rgba(91,184,255,0.12)] text-[#5BB8FF]">
                              {String(t.liquidity_source || 'USER')}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-right font-mono text-[color:var(--ibo-ink)] tabular-nums">${Number(t.price).toLocaleString(undefined, { maximumFractionDigits: 6 })}</td>
                          <td className="px-4 py-3 text-right font-mono text-[color:var(--ibo-ink)] tabular-nums">{Number(t.amount).toLocaleString(undefined, { maximumFractionDigits: 6 })}</td>
                          <td className="px-4 py-3 text-right font-mono font-semibold text-[color:var(--ibo-ink)] tabular-nums">${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}</td>
                          <td className={`px-4 py-3 text-right font-mono font-bold tabular-nums ${showPnl ? (rp >= 0 ? 'text-green-500' : 'text-red-500') : 'text-[color:var(--ibo-muted)]'}`}>
                            {showPnl ? (
                              <>
                                {rp >= 0 ? '+' : ''}${rp.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                              </>
                            ) : (
                              '—'
                            )}
                          </td>
                          <td className="px-4 py-3 text-right font-mono text-[color:var(--ibo-ink-secondary)] tabular-nums">
                            {Number(t.fee).toLocaleString(undefined, { maximumFractionDigits: 8 })} {t.fee_asset}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
          <p className="text-[color:var(--ibo-muted)] text-xs mt-3 max-w-3xl">
            <strong className="text-[color:var(--ibo-ink)]">Realized P&amp;L</strong> is shown only on{' '}
            <strong className="text-[color:var(--ibo-ink)]">sell</strong> fills: net USDT received minus average cost of that
            size (same method as open positions). Buy fills open or add to inventory, so they show &quot;—&quot;.
            History is replayed on up to 10,000 past fills for correct cost basis.
          </p>
        </section>
      </div>

      {closePosition && (
        <ClosePositionModal
          position={closePosition}
          onDismiss={() => setClosePosition(null)}
          onSuccess={async () => {
            setClosePosition(null);
            await Promise.all([fetchLiveSpotPositions(), fetchWallet(), fetchOrders()]);
          }}
        />
      )}
      {fillDetail && (
        <TradeFillDetailModal trade={fillDetail} onClose={() => setFillDetail(null)} />
      )}
    </div>
  );
}
