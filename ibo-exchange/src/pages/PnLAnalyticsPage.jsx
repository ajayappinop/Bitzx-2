import { useState, useEffect, useCallback, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { RefreshCw, TrendingUp, TrendingDown, Filter, LineChart } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { PAIRS, COIN_ICONS } from '@/services/marketApi';
import ClosePositionModal from '@/components/trading/ClosePositionModal';
import TradeFillDetailModal from '@/components/trading/TradeFillDetailModal';

const PAIR_OPTIONS = PAIRS.map((p) => p.symbol);
const MIN_CLOSE_BASE = 0.0001;

function normSymbol(s) {
  if (s == null || s === '') return '';
  return String(s).replace(/\//g, '').toUpperCase();
}

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

const TRADE_FMT = (iso) =>
  new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });

function money(n, digits = 2) {
  const v = Number(n) || 0;
  return v.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits,
  });
}

function fmtP(v) {
  const n = parseFloat(v);
  if (!Number.isFinite(n)) return '—';
  if (n >= 1000) return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
  if (n >= 1) return n.toFixed(4);
  return n.toFixed(6);
}

function toneClass(n) {
  if (n > 0) return 'text-[#0ECB81]';
  if (n < 0) return 'text-[#F6465D]';
  return 'text-[color:var(--ibo-ink)]';
}

export default function PnLAnalyticsPage({ accountMode = false } = {}) {
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
  const [view, setView] = useState('positions'); // positions | fills
  const [filtersOpen, setFiltersOpen] = useState(false);

  const allPairOptions = useMemo(() => {
    const set = new Set(PAIR_OPTIONS.map(normSymbol));
    positions.forEach((p) => {
      if (p.symbol) set.add(normSymbol(p.symbol));
    });
    userTrades.forEach((t) => {
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
    return positions.filter((p) => {
      if (want && normSymbol(p.symbol) !== want) return false;
      const upnl = Number(p.unrealized_pnl ?? 0);
      if (posPnlFilter === 'profit' && upnl <= 0) return false;
      if (posPnlFilter === 'loss' && upnl >= 0) return false;
      return true;
    });
  }, [positions, pairFilter, posPnlFilter]);

  const filteredTrades = useMemo(() => {
    const want = normSymbol(pairFilter);
    return userTrades.filter((t) => {
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

  const activeFilterCount = [
    pairFilter,
    posPnlFilter !== 'all',
    tradeSide !== 'all',
    dateFrom,
    dateTo,
  ].filter(Boolean).length;

  const resetFilters = () => {
    setPairFilter('');
    setPosPnlFilter('all');
    setTradeSide('all');
    setDateFrom('');
    setDateTo('');
  };

  return (
    <div className={`pnl-hub font-ui ${accountMode ? 'min-w-0' : 'ibo-page'}`}>
      <div className={accountMode ? 'w-full min-w-0 space-y-4' : 'w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8 space-y-4'}>

        {/* Toolbar */}
        <div className="delta-account-toolbar !mb-0">
          <div className="flex items-center gap-2 min-w-0">
            <LineChart size={16} className="text-[#FE6C02] shrink-0" />
            <div className="min-w-0">
              <h2 className="text-[15px] font-semibold text-[color:var(--ibo-ink)] truncate m-0 leading-tight">
                P&amp;L overview
              </h2>
              {!accountMode ? (
                <p className="text-[11px] text-[color:var(--ibo-muted)] mt-0.5">
                  Spot positions and fill history
                </p>
              ) : null}
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setFiltersOpen((o) => !o)}
              className={`wallet-action-ghost text-xs !px-2.5 !py-1.5 ${filtersOpen || activeFilterCount ? 'border-[#FE6C02]/40 text-[#FE6C02]' : ''}`}
            >
              <Filter size={13} />
              Filters
              {activeFilterCount > 0 ? (
                <span className="ml-0.5 tabular-nums text-[10px] font-bold">({activeFilterCount})</span>
              ) : null}
            </button>
            <button
              type="button"
              onClick={refreshAll}
              disabled={loading}
              className="wallet-action-ghost text-xs !px-2.5 !py-1.5 disabled:opacity-40"
              title="Refresh"
            >
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
              <span className="hidden sm:inline">Refresh</span>
            </button>
            <Link to="/trade/IBOUSDT" className="wallet-action-primary text-xs !px-2.5 !py-1.5">
              Trade
            </Link>
          </div>
        </div>

        {loadError ? (
          <div
            className="rounded-xl border border-[#F6465D]/30 bg-[rgba(246,70,93,0.08)] px-4 py-3 text-sm font-semibold text-[#F6465D]"
            role="alert"
          >
            {loadError}
          </div>
        ) : null}

        {/* Filters — collapsible strip */}
        {filtersOpen ? (
          <div className="wallet-surface p-4 sm:p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[color:var(--ibo-muted)]">
                Filters
              </p>
              <p className="text-[11px] text-[color:var(--ibo-muted)]">
                Pair applies to positions and fills · dates use device timezone
              </p>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
              <label className="block min-w-0">
                <span className="ibo-field-label !mb-1.5">Pair</span>
                <select
                  value={pairFilter}
                  onChange={(e) => setPairFilter(normSymbol(e.target.value))}
                  className="wallet-field !py-2"
                >
                  <option value="">All pairs</option>
                  {allPairOptions.map((s) => (
                    <option key={s} value={s}>
                      {s.replace('USDT', '/USDT')}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block min-w-0">
                <span className="ibo-field-label !mb-1.5">Unrealized</span>
                <select
                  value={posPnlFilter}
                  onChange={(e) => setPosPnlFilter(e.target.value)}
                  className="wallet-field !py-2"
                >
                  <option value="all">All</option>
                  <option value="profit">Profit only</option>
                  <option value="loss">Loss only</option>
                </select>
              </label>

              <label className="block min-w-0">
                <span className="ibo-field-label !mb-1.5">Trade side</span>
                <select
                  value={tradeSide}
                  onChange={(e) => setTradeSide(e.target.value)}
                  className="wallet-field !py-2"
                >
                  <option value="all">Buy &amp; sell</option>
                  <option value="buy">Buy only</option>
                  <option value="sell">Sell only</option>
                </select>
              </label>

              <label className="block min-w-0">
                <span className="ibo-field-label !mb-1.5">From</span>
                <input
                  type="date"
                  value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                  className="wallet-field !py-2"
                />
              </label>

              <label className="block min-w-0">
                <span className="ibo-field-label !mb-1.5">To</span>
                <input
                  type="date"
                  value={dateTo}
                  onChange={(e) => setDateTo(e.target.value)}
                  className="wallet-field !py-2"
                />
              </label>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="flex flex-wrap gap-1.5">
                {[
                  { id: 'all', label: 'All P&L' },
                  { id: 'profit', label: 'In profit' },
                  { id: 'loss', label: 'In loss' },
                ].map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => setPosPnlFilter(c.id)}
                    className={`wallet-chip-btn ${posPnlFilter === c.id ? (c.id === 'profit' ? 'wallet-chip-btn--pos' : c.id === 'loss' ? 'wallet-chip-btn--neg' : 'border-[#FE6C02]/40 text-[#FE6C02]') : ''}`}
                  >
                    {c.label}
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={resetFilters}
                className="ml-auto text-xs font-bold text-[#FE6C02] hover:underline"
              >
                Reset
              </button>
            </div>
          </div>
        ) : null}

        {/* Snapshot metrics — account summary strip */}
        <div className="delta-account-summary">
          <div className="delta-account-summary__item">
            <p className="delta-account-summary__label">Unrealized P&amp;L</p>
            <p
              className={`delta-account-summary__value flex items-center gap-1.5 ${
                posSummary.unrealized > 0 ? 'is-up' : posSummary.unrealized < 0 ? 'is-down' : ''
              }`}
            >
              {posSummary.unrealized >= 0 ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
              {posSummary.unrealized >= 0 ? '+' : ''}${money(posSummary.unrealized)}
            </p>
          </div>
          <div className="delta-account-summary__item">
            <p className="delta-account-summary__label">Market value</p>
            <p className="delta-account-summary__value">${money(posSummary.mval)}</p>
            <p className="text-[10px] text-[color:var(--ibo-muted)] mt-0.5 tabular-nums">
              Cost ${money(posSummary.invested)}
            </p>
          </div>
          <div className="delta-account-summary__item">
            <p className="delta-account-summary__label">Buy / sell volume</p>
            <p className="delta-account-summary__value text-sm sm:text-[15px] leading-snug">
              <span className="text-[#0ECB81]">${money(tradeSummary.buyVol, 0)}</span>
              <span className="text-[color:var(--ibo-muted)] mx-1">/</span>
              <span className="text-[#F6465D]">${money(tradeSummary.sellVol, 0)}</span>
            </p>
          </div>
          <div className="delta-account-summary__item">
            <p className="delta-account-summary__label">USDT fees</p>
            <p className="delta-account-summary__value text-[#FE6C02]">
              ${money(tradeSummary.feesUsdt, 4)}
            </p>
          </div>
          <div className="delta-account-summary__item">
            <p className="delta-account-summary__label">Realized P&amp;L</p>
            <p
              className={`delta-account-summary__value ${
                tradeSummary.realizedSum > 0 ? 'is-up' : tradeSummary.realizedSum < 0 ? 'is-down' : ''
              }`}
            >
              {tradeSummary.realizedSum >= 0 ? '+' : ''}${money(tradeSummary.realizedSum)}
            </p>
          </div>
        </div>

        {/* View tabs + counts */}
        <div className="delta-account-tabs">
          <button
            type="button"
            onClick={() => setView('positions')}
            className={`delta-account-tabs__btn${view === 'positions' ? ' is-active' : ''}`}
          >
            Open positions
            <span className="ml-1.5 tabular-nums opacity-70">{posSummary.count}</span>
          </button>
          <button
            type="button"
            onClick={() => setView('fills')}
            className={`delta-account-tabs__btn${view === 'fills' ? ' is-active' : ''}`}
          >
            Trade fills
            <span className="ml-1.5 tabular-nums opacity-70">{tradeSummary.count}</span>
          </button>
        </div>

        {/* Positions view */}
        {view === 'positions' ? (
          <section className="space-y-3">
            <p className="text-[12px] text-[color:var(--ibo-muted)] leading-relaxed max-w-3xl">
              Average cost vs mark. Close sells available balance (same as Trade → Assets). Approved KYC required.
            </p>

            {loading && positions.length === 0 ? (
              <div className="delta-account-empty">
                <p className="delta-account-empty__title flex items-center justify-center gap-2">
                  <RefreshCw className="animate-spin text-[#FE6C02]" size={16} /> Loading positions…
                </p>
              </div>
            ) : filteredPositions.length === 0 ? (
              <div className="delta-account-empty">
                <p className="delta-account-empty__title">No positions match these filters</p>
                <Link to="/trade/IBOUSDT" className="delta-account-empty__cta">
                  Start trading
                </Link>
              </div>
            ) : (
              <>
                {/* Desktop table */}
                <div className="delta-account-table-wrap hidden md:block">
                  <table className="delta-account-table">
                    <thead>
                      <tr>
                        <th className="text-left">Asset</th>
                        <th className="text-right">Amount</th>
                        <th className="text-right">Avg cost</th>
                        <th className="text-right">Mark</th>
                        <th className="text-right">Value</th>
                        <th className="text-right">Unrealized</th>
                        <th className="text-right">ROE</th>
                        <th className="text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredPositions.map((p) => {
                        const icon = COIN_ICONS[p.asset];
                        const upnl = Number(p.unrealized_pnl ?? 0);
                        const pct = Number(p.unrealized_pnl_pct ?? 0);
                        return (
                          <tr key={p.asset}>
                            <td className="text-left">
                              <div className="flex items-center gap-2">
                                {icon ? (
                                  <img src={icon} alt="" className="w-5 h-5 rounded-full" />
                                ) : null}
                                <span className="font-semibold text-[color:var(--ibo-ink)]">
                                  {p.asset}/USDT
                                </span>
                                <span className="delta-account-pill">Spot</span>
                              </div>
                            </td>
                            <td className="text-right font-mono tabular-nums">{fmtP(p.amount)}</td>
                            <td className="text-right font-mono tabular-nums text-[color:var(--ibo-muted)]">
                              ${fmtP(p.avg_cost)}
                            </td>
                            <td className="text-right font-mono tabular-nums">${fmtP(p.current_price)}</td>
                            <td className="text-right font-mono tabular-nums font-semibold">
                              ${money(p.market_value_usdt)}
                            </td>
                            <td className={`text-right font-mono tabular-nums font-semibold ${toneClass(upnl)}`}>
                              {upnl >= 0 ? '+' : ''}${money(upnl)}
                            </td>
                            <td className={`text-right font-mono tabular-nums ${toneClass(pct)}`}>
                              {pct >= 0 ? '+' : ''}
                              {pct.toFixed(2)}%
                            </td>
                            <td className="text-right">
                              {Number(p.available) >= MIN_CLOSE_BASE ? (
                                <button
                                  type="button"
                                  onClick={() => setClosePosition(p)}
                                  className="delta-account-close-btn"
                                >
                                  Close
                                </button>
                              ) : (
                                <span className="text-[color:var(--ibo-muted)] text-xs">—</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Mobile cards */}
                <div className="md:hidden space-y-2">
                  {filteredPositions.map((p) => {
                    const icon = COIN_ICONS[p.asset];
                    const upnl = Number(p.unrealized_pnl ?? 0);
                    const pct = Number(p.unrealized_pnl_pct ?? 0);
                    return (
                      <div key={p.asset} className="wallet-surface p-4 space-y-3">
                        <div className="flex items-center justify-between gap-3">
                          <div className="flex items-center gap-2 min-w-0">
                            {icon ? (
                              <img src={icon} alt="" className="w-7 h-7 rounded-full shrink-0" />
                            ) : null}
                            <div className="min-w-0">
                              <p className="font-bold text-[color:var(--ibo-ink)] truncate">
                                {p.asset}/USDT
                              </p>
                              <p className="text-[11px] text-[color:var(--ibo-muted)] font-mono">
                                {fmtP(p.amount)} · mark ${fmtP(p.current_price)}
                              </p>
                            </div>
                          </div>
                          <div className="text-right shrink-0">
                            <p className={`font-mono font-bold tabular-nums ${toneClass(upnl)}`}>
                              {upnl >= 0 ? '+' : ''}${money(upnl)}
                            </p>
                            <p className={`text-[11px] font-mono tabular-nums ${toneClass(pct)}`}>
                              {pct >= 0 ? '+' : ''}
                              {pct.toFixed(2)}%
                            </p>
                          </div>
                        </div>
                        <div className="grid grid-cols-3 gap-2 text-[11px]">
                          <div>
                            <p className="text-[color:var(--ibo-muted)]">Avg cost</p>
                            <p className="font-mono font-semibold text-[color:var(--ibo-ink)]">
                              ${fmtP(p.avg_cost)}
                            </p>
                          </div>
                          <div>
                            <p className="text-[color:var(--ibo-muted)]">Value</p>
                            <p className="font-mono font-semibold text-[color:var(--ibo-ink)]">
                              ${money(p.market_value_usdt)}
                            </p>
                          </div>
                          <div className="flex items-end justify-end">
                            {Number(p.available) >= MIN_CLOSE_BASE ? (
                              <button
                                type="button"
                                onClick={() => setClosePosition(p)}
                                className="delta-account-close-btn"
                              >
                                Close
                              </button>
                            ) : null}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            )}

            <p className="text-[11px] text-[color:var(--ibo-muted)]">
              Also sell from{' '}
              <Link to="/account/balances" className="text-[#FE6C02] font-semibold hover:underline">
                Balances
              </Link>{' '}
              or{' '}
              <Link to="/trade/IBOUSDT" className="text-[#FE6C02] font-semibold hover:underline">
                Trade
              </Link>
              .
            </p>
          </section>
        ) : null}

        {/* Fills view */}
        {view === 'fills' ? (
          <section className="space-y-3">
            <p className="text-[12px] text-[color:var(--ibo-muted)] leading-relaxed max-w-3xl">
              Each row is one execution. Tap a row for fees, notional, and realized P&amp;L detail.
              Realized P&amp;L appears on sell fills only (avg-cost basis).
            </p>

            {loading && userTrades.length === 0 ? (
              <div className="delta-account-empty">
                <p className="delta-account-empty__title flex items-center justify-center gap-2">
                  <RefreshCw className="animate-spin text-[#FE6C02]" size={16} /> Loading fills…
                </p>
              </div>
            ) : filteredTrades.length === 0 ? (
              <div className="delta-account-empty">
                <p className="delta-account-empty__title">No fills match these filters</p>
              </div>
            ) : (
              <>
                <div className="delta-account-table-wrap hidden md:block">
                  <table className="delta-account-table">
                    <thead>
                      <tr>
                        <th className="text-left">Time</th>
                        <th className="text-left">Pair</th>
                        <th className="text-left">Side</th>
                        <th className="text-left">Source</th>
                        <th className="text-right">Price</th>
                        <th className="text-right">Amount</th>
                        <th className="text-right">Notional</th>
                        <th className="text-right">Realized</th>
                        <th className="text-right">Fee</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredTrades.map((t) => {
                        const n = Number(t.price) * Number(t.amount);
                        const rp = t.realized_pnl != null ? Number(t.realized_pnl) : null;
                        const showPnl =
                          String(t.side).toLowerCase() === 'sell' && rp != null && !Number.isNaN(rp);
                        return (
                          <tr
                            key={t.id}
                            role="button"
                            tabIndex={0}
                            onClick={() => setFillDetail(t)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                setFillDetail(t);
                              }
                            }}
                            className="cursor-pointer"
                          >
                            <td className="text-left text-[color:var(--ibo-muted)] whitespace-nowrap font-mono text-xs">
                              {TRADE_FMT(t.created_at)}
                            </td>
                            <td className="text-left font-semibold">
                              {String(t.symbol || '').replace('USDT', '/USDT')}
                            </td>
                            <td
                              className={`text-left font-bold uppercase text-xs ${
                                t.side === 'buy' ? 'text-[#0ECB81]' : 'text-[#F6465D]'
                              }`}
                            >
                              {t.side}
                            </td>
                            <td className="text-left">
                              <span className="delta-account-pill">
                                {String(t.liquidity_source || 'USER')}
                              </span>
                            </td>
                            <td className="text-right font-mono tabular-nums">${fmtP(t.price)}</td>
                            <td className="text-right font-mono tabular-nums">{fmtP(t.amount)}</td>
                            <td className="text-right font-mono tabular-nums font-semibold">
                              ${money(n)}
                            </td>
                            <td
                              className={`text-right font-mono tabular-nums font-semibold ${
                                showPnl ? toneClass(rp) : 'text-[color:var(--ibo-muted)]'
                              }`}
                            >
                              {showPnl ? (
                                <>
                                  {rp >= 0 ? '+' : ''}${money(rp)}
                                </>
                              ) : (
                                '—'
                              )}
                            </td>
                            <td className="text-right font-mono tabular-nums text-[color:var(--ibo-muted)] text-xs">
                              {Number(t.fee).toLocaleString(undefined, { maximumFractionDigits: 8 })}{' '}
                              {t.fee_asset}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                <div className="md:hidden space-y-2">
                  {filteredTrades.map((t) => {
                    const n = Number(t.price) * Number(t.amount);
                    const rp = t.realized_pnl != null ? Number(t.realized_pnl) : null;
                    const showPnl =
                      String(t.side).toLowerCase() === 'sell' && rp != null && !Number.isNaN(rp);
                    return (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => setFillDetail(t)}
                        className="wallet-surface p-4 w-full text-left space-y-2 hover:border-[#FE6C02]/35 transition-colors"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2 min-w-0">
                            <span
                              className={`text-[11px] font-bold uppercase ${
                                t.side === 'buy' ? 'text-[#0ECB81]' : 'text-[#F6465D]'
                              }`}
                            >
                              {t.side}
                            </span>
                            <span className="font-bold text-[color:var(--ibo-ink)] truncate">
                              {String(t.symbol || '').replace('USDT', '/USDT')}
                            </span>
                          </div>
                          <span className="text-[11px] font-mono text-[color:var(--ibo-muted)] shrink-0">
                            {TRADE_FMT(t.created_at)}
                          </span>
                        </div>
                        <div className="flex items-end justify-between gap-3">
                          <div className="text-[12px] text-[color:var(--ibo-muted)] font-mono">
                            {fmtP(t.amount)} @ ${fmtP(t.price)}
                          </div>
                          <div className="text-right">
                            <p className="font-mono font-bold text-[color:var(--ibo-ink)] tabular-nums">
                              ${money(n)}
                            </p>
                            {showPnl ? (
                              <p className={`text-[11px] font-mono font-semibold ${toneClass(rp)}`}>
                                {rp >= 0 ? '+' : ''}${money(rp)} realized
                              </p>
                            ) : null}
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </>
            )}
          </section>
        ) : null}
      </div>

      {closePosition ? (
        <ClosePositionModal
          position={closePosition}
          onDismiss={() => setClosePosition(null)}
          onSuccess={async () => {
            setClosePosition(null);
            await Promise.all([fetchLiveSpotPositions(), fetchWallet(), fetchOrders()]);
          }}
        />
      ) : null}
      {fillDetail ? (
        <TradeFillDetailModal trade={fillDetail} onClose={() => setFillDetail(null)} />
      ) : null}
    </div>
  );
}
