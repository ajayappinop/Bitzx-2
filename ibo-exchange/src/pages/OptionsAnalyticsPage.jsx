/**
 * Options Analytics — Delta Exchange parity
 * @see https://www.delta.exchange/app/options_analytics
 *
 * Tabs: Recent Trades · Taker Activity · Implied Volatility · Volume · Open Interest
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  BarChart,
} from 'recharts';
import { RefreshCw } from 'lucide-react';
import { optionsApi } from '@/services/optionsApi';
import { COIN_ICONS } from '@/services/marketApi';
import { baseFromUsdt, formatExpiryTabLabel, vanillaContractsOnly } from '@/components/options/deltaInstrumentUtils';
import {
  strikeBuckets,
  totalsFromBuckets,
  maxPainStrike,
  atmIv,
  buildIvRvSeries,
  oiChangeBuckets,
  synthesizeTrades,
  formatUsdCompact,
  num,
} from '@/lib/optionsAnalytics';

const UNDERLYINGS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT'];

const TABS = [
  { id: 'recent', label: 'Recent Trades' },
  { id: 'taker', label: 'Taker Activity' },
  { id: 'iv', label: 'Implied Volatility' },
  { id: 'volume', label: 'Volume' },
  { id: 'oi', label: 'Open Interest' },
];

const CALL_COLOR = '#26a69a';
const PUT_COLOR = '#ef5350';
const ACCENT = '#FE6C02';

function fmtStrike(n) {
  return Number(n).toLocaleString(undefined, { maximumFractionDigits: 0 });
}

function fmtTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return '—';
  return d.toLocaleTimeString(undefined, { hour12: false });
}

function ChartCard({ title, subtitle, children, footer }) {
  return (
    <div className="rounded-lg border border-[color:var(--ibo-border-solid)] bg-[color:var(--ibo-bg)] overflow-hidden flex flex-col min-h-[280px]">
      <div className="flex items-start justify-between gap-3 px-4 pt-3 pb-1">
        <div>
          <h3 className="text-[14px] font-extrabold text-[color:var(--ibo-ink)]">{title}</h3>
          {subtitle ? (
            <p className="text-[11px] text-[color:var(--ibo-muted)] mt-0.5">{subtitle}</p>
          ) : null}
        </div>
      </div>
      <div className="flex-1 min-h-[220px] px-1 pb-2">{children}</div>
      {footer ? (
        <div className="border-t border-[color:var(--ibo-border)] px-4 py-2.5 text-[11px] text-[color:var(--ibo-muted)]">
          {footer}
        </div>
      ) : null}
    </div>
  );
}

function StatPill({ label, value }) {
  return (
    <div className="flex flex-col gap-0.5 px-3 py-1.5 rounded-md border border-[color:var(--ibo-border-solid)] bg-[color:var(--ibo-elevated,#fafbfc)] min-w-[110px]">
      <span className="text-[10px] font-semibold uppercase tracking-wide text-[color:var(--ibo-muted)]">{label}</span>
      <span className="text-[13px] font-mono font-bold tabular-nums text-[color:var(--ibo-ink)]">{value}</span>
    </div>
  );
}

function tooltipStyle() {
  return {
    background: 'var(--ibo-bg)',
    border: '1px solid var(--ibo-border-solid)',
    borderRadius: 8,
    fontSize: 12,
  };
}

export default function OptionsAnalyticsPage() {
  const { underlying: rawUnd } = useParams();
  const navigate = useNavigate();

  const underlying = useMemo(() => {
    const u = String(rawUnd || 'BTC').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!u || u === 'ANALYTICS') return 'BTCUSDT';
    return u.endsWith('USDT') ? u : `${u}USDT`;
  }, [rawUnd]);
  const base = baseFromUsdt(underlying);

  const [tab, setTab] = useState('oi');
  const [loading, setLoading] = useState(true);
  const [contracts, setContracts] = useState([]);
  const [indexPx, setIndexPx] = useState(null);
  const [expiry, setExpiry] = useState('all');
  const [contractFilter, setContractFilter] = useState('all'); // all | call | put
  const [notionalMin, setNotionalMin] = useState('');
  const [notionalMax, setNotionalMax] = useState('');
  const [trades, setTrades] = useState([]);
  const [updatedAt, setUpdatedAt] = useState(null);

  const setUnderlying = (sym) => {
    const s = String(sym || 'BTCUSDT').toUpperCase();
    navigate(`/options/analytics/${baseFromUsdt(s)}`, { replace: true });
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      let list = [];
      let idx = null;
      try {
        const chain = await optionsApi.getChain(underlying, true, true);
        list = vanillaContractsOnly(chain?.contracts || []);
        idx = chain?.index_price ?? null;
      } catch { /* demo */ }
      if (!list.length) {
        try {
          const demo = await optionsApi.demoChain(underlying);
          list = vanillaContractsOnly(demo?.contracts || []);
          idx = demo?.index_price ?? idx;
        } catch { /* empty */ }
      }
      setContracts(list);
      setIndexPx(idx != null ? Number(idx) : null);

      let tape = [];
      try {
        const res = await optionsApi.analyticsRecentTrades({
          underlyingSymbol: underlying,
          limit: 200,
        });
        tape = res?.trades || [];
      } catch { /* synthesize */ }
      if (!tape.length) {
        tape = synthesizeTrades(list, underlying, 60);
      } else {
        tape = tape.map((t) => ({
          ...t,
          taker: t.taker === 'buy' || t.side === 'buy' ? 'Buy' : 'Sell',
        }));
      }
      setTrades(tape);
      setUpdatedAt(new Date());
    } finally {
      setLoading(false);
    }
  }, [underlying]);

  useEffect(() => { load(); }, [load]);

  const expiries = useMemo(() => {
    const set = new Set();
    for (const c of contracts) {
      if (c.expiry) set.add(String(c.expiry));
    }
    return ['all', ...[...set].sort()];
  }, [contracts]);

  const buckets = useMemo(
    () => strikeBuckets(contracts, { expiry }),
    [contracts, expiry],
  );
  const totals = useMemo(() => totalsFromBuckets(buckets), [buckets]);
  const maxPain = useMemo(() => maxPainStrike(buckets), [buckets]);
  const atm = useMemo(() => atmIv(buckets, indexPx), [buckets, indexPx]);
  const ivRv = useMemo(() => buildIvRvSeries(atm, 7), [atm]);
  const oiChg = useMemo(() => oiChangeBuckets(buckets), [buckets]);

  const vol24h = useMemo(() => {
    let s = 0;
    for (const b of buckets) {
      const mid = indexPx || b.strike;
      s += (b.callVol + b.putVol) * (mid * 0.01);
    }
    // Prefer notional from mark × volume when available
    for (const c of contracts) {
      if (expiry !== 'all' && String(c.expiry || '') !== expiry) continue;
      const m = c.market || {};
      const mark = num(m.mark_price ?? m.mid);
      const vol = num(m.volume_24h ?? c.volume_24h);
      if (mark > 0 && vol > 0) s += mark * vol;
    }
    return s;
  }, [buckets, contracts, expiry, indexPx]);

  const totOiNotional = useMemo(() => {
    let s = 0;
    for (const b of buckets) s += b.callNotional + b.putNotional;
    return s;
  }, [buckets]);

  const filteredTrades = useMemo(() => {
    const minN = Number(notionalMin);
    const maxN = Number(notionalMax);
    return (trades || []).filter((t) => {
      if (contractFilter === 'call' && String(t.option_type || '').toLowerCase() !== 'call') return false;
      if (contractFilter === 'put' && String(t.option_type || '').toLowerCase() !== 'put') return false;
      if (expiry !== 'all' && t.expiry && String(t.expiry) !== expiry) return false;
      const n = num(t.notional ?? (num(t.price) * num(t.qty)));
      if (Number.isFinite(minN) && notionalMin !== '' && n < minN) return false;
      if (Number.isFinite(maxN) && notionalMax !== '' && n > maxN) return false;
      return true;
    });
  }, [trades, contractFilter, expiry, notionalMin, notionalMax]);

  const takerByStrike = useMemo(() => {
    const map = new Map();
    for (const t of filteredTrades) {
      const k = num(t.strike);
      if (!(k > 0)) continue;
      const row = map.get(k) || { strike: k, buy: 0, sell: 0 };
      const n = num(t.notional ?? (num(t.price) * num(t.qty)));
      if (String(t.taker || t.side || '').toLowerCase().startsWith('b')) row.buy += n;
      else row.sell += n;
      map.set(k, row);
    }
    return [...map.values()].sort((a, b) => a.strike - b.strike);
  }, [filteredTrades]);

  const clearFilters = () => {
    setExpiry('all');
    setContractFilter('all');
    setNotionalMin('');
    setNotionalMax('');
  };

  return (
    <div className="delta-analytics min-h-[calc(100dvh-70px)] bg-[color:var(--ibo-bg)] text-[color:var(--ibo-ink)]">
      {/* Header */}
      <div className="sticky top-0 z-20 border-b border-[color:var(--ibo-border)] bg-[color:var(--ibo-bg)]/95 backdrop-blur-sm">
        <div className="max-w-[1400px] mx-auto px-3 sm:px-4 py-3 flex flex-wrap items-center gap-3">
          <div>
            <h1 className="text-[16px] sm:text-[18px] font-extrabold tracking-tight">Options Analytics</h1>
          </div>

          <div className="flex items-center gap-1.5 ml-auto flex-wrap">
            {UNDERLYINGS.map((sym) => {
              const b = baseFromUsdt(sym);
              const on = underlying === sym;
              const icon = COIN_ICONS[b] || COIN_ICONS[sym];
              return (
                <button
                  key={sym}
                  type="button"
                  onClick={() => setUnderlying(sym)}
                  className={`inline-flex items-center gap-1.5 h-8 px-2.5 rounded-md text-[12px] font-bold border transition-colors ${
                    on
                      ? 'border-[#FE6C02]/50 bg-[rgba(254,108,2,0.1)] text-[#FE6C02]'
                      : 'border-[color:var(--ibo-border-solid)] text-[color:var(--ibo-muted)] hover:text-[color:var(--ibo-ink)]'
                  }`}
                >
                  {icon ? <img src={icon} alt="" className="h-4 w-4 rounded-full" /> : null}
                  {b}
                </button>
              );
            })}
            <Link
              to={`/options/${underlying}`}
              className="h-8 px-3 inline-flex items-center rounded-md text-[12px] font-bold border border-[color:var(--ibo-border-solid)] text-[color:var(--ibo-muted)] hover:text-[#FE6C02]"
            >
              Trade
            </Link>
            <button
              type="button"
              onClick={load}
              className="h-8 w-8 inline-flex items-center justify-center rounded-md border border-[color:var(--ibo-border-solid)] text-[color:var(--ibo-muted)] hover:text-[#FE6C02]"
              aria-label="Refresh"
            >
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="max-w-[1400px] mx-auto px-3 sm:px-4 flex items-center gap-0 overflow-x-auto border-t border-[color:var(--ibo-border)]">
          {TABS.map((t) => {
            const on = tab === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className="relative px-3.5 py-2.5 text-[12px] sm:text-[13px] font-semibold whitespace-nowrap transition-colors"
                style={{
                  color: on ? 'var(--ibo-ink)' : 'var(--ibo-muted)',
                  fontWeight: on ? 800 : 600,
                }}
              >
                {t.label}
                {on ? (
                  <span className="absolute left-2 right-2 bottom-0 h-[3px] rounded-t-sm bg-[#FE6C02]" />
                ) : null}
              </button>
            );
          })}
        </div>
      </div>

      <div className="max-w-[1400px] mx-auto px-3 sm:px-4 py-4 space-y-4">
        {/* KPI strip */}
        <div className="flex flex-wrap items-center gap-2">
          <StatPill label="Underlying" value={base} />
          <StatPill label="Index" value={indexPx != null ? fmtStrike(indexPx) : '—'} />
          <StatPill label="24h Vol" value={formatUsdCompact(vol24h)} />
          <StatPill label="Open Interest" value={formatUsdCompact(totOiNotional)} />
          <StatPill label="ATM IV" value={atm != null ? `${atm.toFixed(1)}%` : '—'} />
          {updatedAt ? (
            <span className="text-[11px] text-[color:var(--ibo-muted)] ml-auto">
              Last updated: {updatedAt.toLocaleString()}
            </span>
          ) : null}
        </div>

        {/* Filters */}
        <div className="rounded-lg border border-[color:var(--ibo-border-solid)] bg-[color:var(--ibo-elevated,#fafbfc)] px-3 py-3">
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label className="block text-[10px] font-bold uppercase tracking-wide text-[color:var(--ibo-muted)] mb-1">Expiry</label>
              <select
                value={expiry}
                onChange={(e) => setExpiry(e.target.value)}
                className="h-9 rounded-md border border-[color:var(--ibo-border-solid)] bg-[color:var(--ibo-bg)] px-2 text-[12px] font-semibold min-w-[140px]"
              >
                {expiries.map((e) => (
                  <option key={e} value={e}>
                    {e === 'all' ? 'All' : formatExpiryTabLabel(e)}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[10px] font-bold uppercase tracking-wide text-[color:var(--ibo-muted)] mb-1">Contract</label>
              <select
                value={contractFilter}
                onChange={(e) => setContractFilter(e.target.value)}
                className="h-9 rounded-md border border-[color:var(--ibo-border-solid)] bg-[color:var(--ibo-bg)] px-2 text-[12px] font-semibold"
              >
                <option value="all">All</option>
                <option value="call">Calls</option>
                <option value="put">Puts</option>
              </select>
            </div>
            <div>
              <label className="block text-[10px] font-bold uppercase tracking-wide text-[color:var(--ibo-muted)] mb-1">Notional ($)</label>
              <div className="flex items-center gap-1.5">
                <input
                  type="number"
                  value={notionalMin}
                  onChange={(e) => setNotionalMin(e.target.value)}
                  placeholder="from"
                  className="h-9 w-24 rounded-md border border-[color:var(--ibo-border-solid)] bg-[color:var(--ibo-bg)] px-2 text-[12px] font-mono"
                />
                <span className="text-[color:var(--ibo-muted)] text-[11px]">to</span>
                <input
                  type="number"
                  value={notionalMax}
                  onChange={(e) => setNotionalMax(e.target.value)}
                  placeholder="to"
                  className="h-9 w-24 rounded-md border border-[color:var(--ibo-border-solid)] bg-[color:var(--ibo-bg)] px-2 text-[12px] font-mono"
                />
              </div>
            </div>
            <button
              type="button"
              onClick={clearFilters}
              className="h-9 px-3 rounded-md text-[12px] font-bold text-[#FE6C02] hover:bg-[rgba(254,108,2,0.08)]"
            >
              Clear All
            </button>
          </div>
        </div>

        {loading && !contracts.length ? (
          <div className="flex items-center justify-center py-24 text-[color:var(--ibo-muted)] text-sm gap-2">
            <RefreshCw size={14} className="animate-spin text-[#FE6C02]" /> Loading analytics…
          </div>
        ) : null}

        {/* ── Open Interest ─────────────────────────────────────────── */}
        {tab === 'oi' ? (
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            <ChartCard
              title="Open Interest"
              subtitle="Y — Open Interest · X — Strike"
              footer={(
                <div className="flex flex-wrap gap-x-5 gap-y-1">
                  <span>Tot. Calls <b className="text-[color:var(--ibo-ink)] ml-1">{formatUsdCompact(totals.totCalls * (indexPx || 1) * 0.01)}</b></span>
                  <span>Tot. Puts <b className="text-[color:var(--ibo-ink)] ml-1">{formatUsdCompact(totals.totPuts * (indexPx || 1) * 0.01)}</b></span>
                  <span>PCR <b className="text-[color:var(--ibo-ink)] ml-1">{totals.pcr != null ? totals.pcr.toFixed(2) : '—'}</b></span>
                  <span>Max Pain <b className="text-[#FE6C02] ml-1">{maxPain != null ? fmtStrike(maxPain) : '—'}</b></span>
                </div>
              )}
            >
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={buckets} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--ibo-border)" vertical={false} />
                  <XAxis dataKey="strike" tickFormatter={fmtStrike} tick={{ fontSize: 10 }} stroke="var(--ibo-muted)" />
                  <YAxis tick={{ fontSize: 10 }} stroke="var(--ibo-muted)" width={48} />
                  <Tooltip contentStyle={tooltipStyle()} formatter={(v, n) => [Number(v).toFixed(0), n]} labelFormatter={(l) => `Strike ${fmtStrike(l)}`} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar dataKey="callOi" name="Calls" fill={CALL_COLOR} radius={[2, 2, 0, 0]} />
                  <Bar dataKey="putOi" name="Puts" fill={PUT_COLOR} radius={[2, 2, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>

            <ChartCard
              title="Open Interest Change"
              subtitle="Last 12 hours (estimated)"
            >
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={oiChg} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--ibo-border)" vertical={false} />
                  <XAxis dataKey="strike" tickFormatter={fmtStrike} tick={{ fontSize: 10 }} stroke="var(--ibo-muted)" />
                  <YAxis tick={{ fontSize: 10 }} stroke="var(--ibo-muted)" width={48} />
                  <Tooltip contentStyle={tooltipStyle()} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar dataKey="callOiChg" name="Calls" fill={CALL_COLOR} radius={[2, 2, 0, 0]} />
                  <Bar dataKey="putOiChg" name="Puts" fill={PUT_COLOR} radius={[2, 2, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
          </div>
        ) : null}

        {/* ── Volume ────────────────────────────────────────────────── */}
        {tab === 'volume' ? (
          <ChartCard
            title="Volume vs Strike"
            subtitle="Y — Volume · X — Strike"
            footer={(
              <div className="flex flex-wrap gap-x-5">
                <span>Tot. Calls <b className="text-[color:var(--ibo-ink)] ml-1">{totals.totCallVol.toFixed(0)}</b></span>
                <span>Tot. Puts <b className="text-[color:var(--ibo-ink)] ml-1">{totals.totPutVol.toFixed(0)}</b></span>
              </div>
            )}
          >
            <ResponsiveContainer width="100%" height={320}>
              <BarChart data={buckets} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--ibo-border)" vertical={false} />
                <XAxis dataKey="strike" tickFormatter={fmtStrike} tick={{ fontSize: 10 }} stroke="var(--ibo-muted)" />
                <YAxis tick={{ fontSize: 10 }} stroke="var(--ibo-muted)" width={48} />
                <Tooltip contentStyle={tooltipStyle()} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="callVol" name="Calls" fill={CALL_COLOR} radius={[2, 2, 0, 0]} />
                <Bar dataKey="putVol" name="Puts" fill={PUT_COLOR} radius={[2, 2, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>
        ) : null}

        {/* ── Implied Volatility ────────────────────────────────────── */}
        {tab === 'iv' ? (
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            <ChartCard title="Implied Volatility" subtitle="Y — IV(%) · X — Strike">
              <ResponsiveContainer width="100%" height={280}>
                <ComposedChart data={buckets} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--ibo-border)" vertical={false} />
                  <XAxis dataKey="strike" tickFormatter={fmtStrike} tick={{ fontSize: 10 }} stroke="var(--ibo-muted)" />
                  <YAxis tick={{ fontSize: 10 }} stroke="var(--ibo-muted)" width={40} unit="%" />
                  <Tooltip contentStyle={tooltipStyle()} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Line type="monotone" dataKey="callIv" name="Call IV" stroke={CALL_COLOR} dot={false} strokeWidth={2} connectNulls />
                  <Line type="monotone" dataKey="putIv" name="Put IV" stroke={PUT_COLOR} dot={false} strokeWidth={2} connectNulls />
                </ComposedChart>
              </ResponsiveContainer>
            </ChartCard>

            <ChartCard title="IV vs RV" subtitle="ATM volatility · last 7 days">
              <ResponsiveContainer width="100%" height={280}>
                <LineChart data={ivRv} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--ibo-border)" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 10 }} stroke="var(--ibo-muted)" />
                  <YAxis tick={{ fontSize: 10 }} stroke="var(--ibo-muted)" width={40} unit="%" />
                  <Tooltip contentStyle={tooltipStyle()} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Line type="monotone" dataKey="iv" name="IV" stroke={ACCENT} strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="rv" name="RV" stroke="#60a5fa" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </ChartCard>

            <div className="xl:col-span-2">
            <ChartCard title="IV − RV" subtitle="Spread (% points) · last 7 days">
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={ivRv} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--ibo-border)" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 10 }} stroke="var(--ibo-muted)" />
                  <YAxis tick={{ fontSize: 10 }} stroke="var(--ibo-muted)" width={40} />
                  <Tooltip contentStyle={tooltipStyle()} />
                  <Bar dataKey="spread" name="IV−RV" fill={ACCENT} radius={[2, 2, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
            </div>
          </div>
        ) : null}

        {/* ── Taker Activity ────────────────────────────────────────── */}
        {tab === 'taker' ? (
          <ChartCard title="Taker Activity" subtitle="Buy vs Sell notional by strike (from recent tape)">
            <ResponsiveContainer width="100%" height={320}>
              <BarChart data={takerByStrike} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--ibo-border)" vertical={false} />
                <XAxis dataKey="strike" tickFormatter={fmtStrike} tick={{ fontSize: 10 }} stroke="var(--ibo-muted)" />
                <YAxis tick={{ fontSize: 10 }} stroke="var(--ibo-muted)" width={56} />
                <Tooltip contentStyle={tooltipStyle()} formatter={(v) => formatUsdCompact(v)} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="buy" name="Taker Buy" fill={CALL_COLOR} radius={[2, 2, 0, 0]} />
                <Bar dataKey="sell" name="Taker Sell" fill={PUT_COLOR} radius={[2, 2, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>
        ) : null}

        {/* ── Recent Trades ─────────────────────────────────────────── */}
        {tab === 'recent' ? (
          <div className="rounded-lg border border-[color:var(--ibo-border-solid)] overflow-hidden">
            <div className="px-4 py-3 border-b border-[color:var(--ibo-border)] flex items-center justify-between gap-2">
              <h3 className="text-[14px] font-extrabold">Recent Options Trades (upto last 500)</h3>
              <span className="text-[11px] text-[color:var(--ibo-muted)]">{filteredTrades.length} rows</span>
            </div>
            <div className="overflow-auto max-h-[560px]">
              <table className="w-full text-left text-[12px] min-w-[860px]">
                <thead className="sticky top-0 bg-[color:var(--ibo-elevated,#fafbfc)] text-[10px] uppercase tracking-wider text-[color:var(--ibo-muted)] font-extrabold border-b border-[color:var(--ibo-border)]">
                  <tr>
                    <th className="px-3 py-2.5">Underlying</th>
                    <th className="px-3 py-2.5">Contract</th>
                    <th className="px-3 py-2.5">Strike</th>
                    <th className="px-3 py-2.5">Expiry</th>
                    <th className="px-3 py-2.5">Price</th>
                    <th className="px-3 py-2.5">Notional ($)</th>
                    <th className="px-3 py-2.5">Taker</th>
                    <th className="px-3 py-2.5">Time</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredTrades.map((t) => {
                    const ot = String(t.option_type || '').toLowerCase();
                    const taker = String(t.taker || '').toLowerCase().startsWith('b') ? 'Buy' : 'Sell';
                    return (
                      <tr key={t.id || `${t.contract_id}-${t.created_at}`} className="border-b border-[color:var(--ibo-border)]/60 hover:bg-[rgba(254,108,2,0.04)]">
                        <td className="px-3 py-2 font-semibold">{baseFromUsdt(t.underlying_symbol || underlying)}</td>
                        <td className="px-3 py-2 capitalize">{ot || '—'}</td>
                        <td className="px-3 py-2 font-mono">{t.strike != null ? fmtStrike(t.strike) : '—'}</td>
                        <td className="px-3 py-2">{t.expiry ? formatExpiryTabLabel(t.expiry) : '—'}</td>
                        <td className="px-3 py-2 font-mono">{num(t.price).toFixed(2)}</td>
                        <td className="px-3 py-2 font-mono">{formatUsdCompact(t.notional ?? num(t.price) * num(t.qty))}</td>
                        <td className={`px-3 py-2 font-bold ${taker === 'Buy' ? 'text-[color:var(--ibo-positive)]' : 'text-[color:var(--ibo-negative)]'}`}>
                          {taker}
                        </td>
                        <td className="px-3 py-2 font-mono text-[color:var(--ibo-muted)]">{fmtTime(t.created_at)}</td>
                      </tr>
                    );
                  })}
                  {!filteredTrades.length ? (
                    <tr>
                      <td colSpan={8} className="px-3 py-12 text-center text-[color:var(--ibo-muted)]">
                        No trades match the current filters.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
