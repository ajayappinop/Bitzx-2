import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Trophy, TrendingUp, TrendingDown, ArrowDownToLine, ArrowUpFromLine, RefreshCw,
  Search, SlidersHorizontal, ChevronDown, ChevronUp, Download, LayoutGrid, BarChart3, Wallet,
  Sparkles, Info,
} from 'lucide-react';
import { api } from '@/lib/api';
import { AdminPageHeader } from '@/components/AdminPrimitives';

const ASSET_OPTIONS = ['', 'USDT', 'IBO', 'BTC', 'ETH', 'BNB', 'SOL', 'XRP', 'DOGE', 'ADA', 'POL', 'AVAX', 'DOT', 'LINK', 'LTC'];

const DAY_PRESETS = [
  { value: 0, label: 'All time' },
  { value: 7, label: '7d' },
  { value: 30, label: '30d' },
  { value: 90, label: '90d' },
  { value: 180, label: '180d' },
];

const RANK_BY_OPTIONS = [
  { value: 'combined', label: 'Combined P&L' },
  { value: 'realized', label: 'Realized only' },
  { value: 'unrealized', label: 'Unrealized only' },
  { value: 'volume', label: 'Trading volume' },
];

const VOL_PRESETS = [
  { label: 'Any', value: 0 },
  { label: '≥1K', value: 1000 },
  { label: '≥ 10K', value: 10000 },
  { label: '≥ 100K', value: 100000 },
];

function pnlClass(v) {
  const n = Number(v);
  if (n > 1e-8) return 'text-emerald-400';
  if (n < -1e-8) return 'text-red-300';
  return 'text-white/60';
}

function fmtCompact(n) {
  if (n == null || Number.isNaN(n)) return '—';
  const x = Number(n);
  if (Math.abs(x) >= 1e9) return `${(x / 1e9).toFixed(2)}B`;
  if (Math.abs(x) >= 1e6) return `${(x / 1e6).toFixed(2)}M`;
  if (Math.abs(x) >= 1e3) return `${(x / 1e3).toFixed(2)}K`;
  return x.toLocaleString(undefined, { maximumFractionDigits: 4 });
}

function useFilteredRows(rows, q) {
  return useMemo(() => {
    const s = (q || '').trim().toLowerCase();
    if (!s) return rows || [];
    return (rows || []).filter((r) =>
      (r.uid || '').toLowerCase().includes(s)
      || (r.email || '').toLowerCase().includes(s)
      || (r.name || '').toLowerCase().includes(s),
    );
  }, [rows, q]);
}

function UserCell({ row }) {
  const label = row.name || row.email || row.uid;
  return (
    <div className="min-w-0">
      <Link
        to={`/users/${encodeURIComponent(row.uid)}`}
        className="font-semibold text-white hover:text-gold-light truncate block max-w-[180px] lg:max-w-[240px]"
      >
        {label}
      </Link>
      <p className="text-[11px] font-mono text-white/45 truncate">{row.uid}</p>
    </div>
  );
}

function RankBadge({ rank }) {
  const tone =
    rank === 1 ? 'bg-gradient-to-br from-gold/30 to-gold-dark/20 text-gold-light/90 border-gold/50 shadow-[0_0_20px_rgba(14,164,171,0.15)]'
      : rank === 2 ? 'bg-white/12 text-white/90 border-white/25'
        : rank === 3 ? 'bg-orange-950/40 text-orange-100/90 border-orange-600/35'
          : 'bg-white/[.06] text-white/55 border-surface-border';
  return (
    <span className={`inline-flex items-center justify-center w-9 h-9 rounded-xl border text-xs font-extrabold shrink-0 ${tone}`}>
      {rank}
    </span>
  );
}

function KpiCard({ label, value, sub, accent }) {
  return (
    <div className={`rounded-2xl border bg-surface-card/90 backdrop-blur-sm p-4 min-w-0 ${accent || 'border-surface-border'}`}>
      <p className="text-[10px] font-extrabold text-white/40 uppercase tracking-wider">{label}</p>
      <p className="text-lg sm:text-xl font-extrabold text-white mt-1 font-mono tabular-nums break-all">{value}</p>
      {sub && <p className="text-[11px] text-white/45 mt-1">{sub}</p>}
    </div>
  );
}

function SpotlightCard({ title, row, valueLabel, value, valueClass, icon: Icon }) {
  if (!row) {
    return (
      <div className="rounded-2xl border border-dashed border-surface-border bg-surface-dark/30 p-4 flex flex-col justify-center min-h-[120px]">
        <p className="text-xs font-extrabold text-white/35 uppercase tracking-wider">{title}</p>
        <p className="text-sm text-white/40 mt-2">No data yet</p>
      </div>
    );
  }
  return (
    <div className="rounded-2xl border border-surface-border bg-gradient-to-b from-white/[.07] to-surface-card/80 p-4 relative overflow-hidden min-h-[120px]">
      <div className="absolute -right-6 -top-6 w-24 h-24 rounded-full bg-gold/10 blur-2xl pointer-events-none" />
      <div className="relative flex items-start gap-3">
        <div className="p-2 rounded-xl bg-white/[.06] border border-white/10 text-gold-light">
          <Icon size={20} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-extrabold text-white/45 uppercase tracking-wider">{title}</p>
          <Link to={`/users/${encodeURIComponent(row.uid)}`} className="font-bold text-white hover:text-gold-light truncate block mt-1">
            {row.name || row.email || row.uid}
          </Link>
          <p className="text-[10px] font-mono text-white/40 truncate">{row.uid}</p>
          <p className={`text-sm font-mono font-extrabold mt-2 tabular-nums ${valueClass}`}>
            <span className="text-white/50 text-xs font-sans font-semibold mr-2">{valueLabel}</span>
            {value}
          </p>
        </div>
      </div>
    </div>
  );
}

function DataTable({
  title,
  subtitle,
  icon: Icon,
  headClass,
  rows,
  variant,
  searchQ,
  emptyHint,
}) {
  const filtered = useFilteredRows(rows, searchQ);
  return (
    <div className="rounded-2xl border border-surface-border bg-surface-card overflow-hidden min-w-0 shadow-lg shadow-black/20">
      <div className={`px-4 py-3 border-b border-surface-border flex flex-wrap items-start justify-between gap-2 ${headClass}`}>
        <div className="flex items-center gap-2 min-w-0">
          <Icon size={20} className="shrink-0 opacity-90" />
          <div>
            <h2 className="text-sm font-extrabold text-white">{title}</h2>
            {subtitle && <p className="text-[11px] text-white/45 mt-0.5">{subtitle}</p>}
          </div>
        </div>
        <span className="text-[10px] font-bold text-white/35 uppercase">{filtered.length} shown</span>
      </div>
      <div className="adm-table-x scrollbar-thin min-w-0">
        <table className="w-full text-sm min-w-[560px]">
          <thead>
            <tr className="text-left text-[10px] font-extrabold text-white/45 uppercase border-b border-surface-border bg-surface-dark">
              <th className="px-3 py-2.5 w-14">#</th>
              <th className="px-3 py-2.5">User</th>
              {variant === 'flow' ? (
                <th className="px-3 py-2.5 text-right whitespace-nowrap">Notional (USDT)</th>
              ) : (
                <>
                  <th className="px-3 py-2.5 text-right whitespace-nowrap">Combined</th>
                  <th className="px-3 py-2.5 text-right whitespace-nowrap hidden md:table-cell">Realized</th>
                  <th className="px-3 py-2.5 text-right whitespace-nowrap hidden lg:table-cell">Unrealized</th>
                  <th className="px-3 py-2.5 text-right whitespace-nowrap">Volume</th>
                  <th className="px-3 py-2.5 text-right whitespace-nowrap">Fills</th>
                  <th className="px-3 py-2.5 text-right whitespace-nowrap hidden sm:table-cell">Sells</th>
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={variant === 'flow' ? 3 : 8} className="px-4 py-12 text-center">
                  <p className="text-white/45">{rows?.length ? 'No rows match your search.' : (emptyHint || 'No data.')}</p>
                </td>
              </tr>
            ) : (
              filtered.map((row, idx) => (
                <tr key={row.uid} className="border-b border-surface-border/40 hover:bg-white/[.04] transition-colors">
                  <td className="px-3 py-3 align-middle">
                    <RankBadge rank={idx + 1} />
                  </td>
                  <td className="px-3 py-3 align-middle">
                    <UserCell row={row} />
                  </td>
                  {variant === 'flow' ? (
                    <td className="px-3 py-3 text-right font-mono text-cyan-200/90 tabular-nums whitespace-nowrap">
                      {fmtCompact(row.total_notional_usdt)}
                    </td>
                  ) : (
                    <>
                      <td className={`px-3 py-3 text-right font-mono font-bold tabular-nums whitespace-nowrap ${pnlClass(row.combined_pnl_estimate_usdt)}`}>
                        {Number(row.combined_pnl_estimate_usdt).toFixed(4)}
                      </td>
                      <td className={`px-3 py-3 text-right font-mono tabular-nums whitespace-nowrap hidden md:table-cell ${pnlClass(row.realized_pnl_usdt)}`}>
                        {Number(row.realized_pnl_usdt).toFixed(4)}
                      </td>
                      <td className={`px-3 py-3 text-right font-mono tabular-nums whitespace-nowrap hidden lg:table-cell ${pnlClass(row.unrealized_pnl_usdt)}`}>
                        {Number(row.unrealized_pnl_usdt).toFixed(4)}
                      </td>
                      <td className="px-3 py-3 text-right font-mono text-white/70 tabular-nums whitespace-nowrap">
                        {fmtCompact(row.volume_notional_usdt)}
                      </td>
                      <td className="px-3 py-3 text-right font-mono text-white/55 tabular-nums whitespace-nowrap">
                        {row.trade_fill_count}
                      </td>
                      <td className="px-3 py-3 text-right font-mono text-white/45 tabular-nums whitespace-nowrap hidden sm:table-cell">
                        {row.sell_fill_count ?? '—'}
                      </td>
                    </>
                  )}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function exportCsv(filename, rows, columns) {
  const esc = (v) => {
    const s = v == null ? '' : String(v);
    if (s.includes('"') || s.includes(',') || s.includes('\n')) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
    const head = columns.map((c) => c.label).join(',');
    const body = rows.map((r, i) => columns.map((c) => esc(c.value(r, i))).join(',')).join('\n');
  const blob = new Blob([`${head}\n${body}`], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

export default function LeaderboardPage() {
  const [tab, setTab] = useState('overview');
  const [limit, setLimit] = useState(10);
  const [days, setDays] = useState(0);
  const [minFills, setMinFills] = useState(0);
  const [minVol, setMinVol] = useState(0);
  const [rankBy, setRankBy] = useState('combined');
  const [flowAsset, setFlowAsset] = useState('');
  const [searchQ, setSearchQ] = useState('');
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [methodologyOpen, setMethodologyOpen] = useState(false);
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(true);
  const [lastLoaded, setLastLoaded] = useState(null);

  const buildParams = useCallback(() => ({
    limit: String(limit),
    days: String(days),
    min_fills: String(minFills),
    min_volume_usdt: String(minVol),
    rank_by: rankBy,
    ...(flowAsset ? { flow_asset: flowAsset } : {}),
  }), [limit, days, minFills, minVol, rankBy, flowAsset]);

  const load = useCallback(() => {
    setLoading(true);
    setErr('');
    api.statsLeaderboard(buildParams())
      .then(async (r) => {
        if (!r.ok) {
          const j = await r.json().catch(() => ({}));
          throw new Error(j.detail || r.statusText || 'Failed');
        }
        return r.json();
      })
      .then((d) => {
        setData(d);
        setLastLoaded(new Date());
      })
      .catch((e) => {
        setErr(e.message || 'Could not load leaderboard');
        setData(null);
      })
      .finally(() => setLoading(false));
  }, [buildParams]);

  useEffect(() => {
    load();
  }, [load]);

  const summary = data?.summary;
  const rankLabel = RANK_BY_OPTIONS.find((o) => o.value === (data?.rank_by || rankBy))?.label || 'Combined P&L';

  const handleExport = () => {
    if (!data) return;
    const colsPnl = [
      { label: 'rank', value: (r, i) => i + 1 },
      { label: 'uid', value: (r) => r.uid },
      { label: 'email', value: (r) => r.email },
      { label: 'combined_pnl', value: (r) => r.combined_pnl_estimate_usdt },
      { label: 'realized', value: (r) => r.realized_pnl_usdt },
      { label: 'unrealized', value: (r) => r.unrealized_pnl_usdt },
      { label: 'volume', value: (r) => r.volume_notional_usdt },
      { label: 'fills', value: (r) => r.trade_fill_count },
    ];
    const colsFlow = [
      { label: 'rank', value: (r, i) => i + 1 },
      { label: 'uid', value: (r) => r.uid },
      { label: 'notional_usdt', value: (r) => r.total_notional_usdt },
    ];
    exportCsv('leaderboard-gainers.csv', data.top_gainers || [], colsPnl);
    exportCsv('leaderboard-losers.csv', data.top_losers || [], colsPnl);
    exportCsv('leaderboard-deposits.csv', data.top_deposits || [], colsFlow);
    exportCsv('leaderboard-withdrawals.csv', data.top_withdrawals || [], colsFlow);
  };

  return (
    <div className="admin-page pb-10">
      <AdminPageHeader
        icon={Trophy}
        title="Leaderboard"
        subtitle="Top traders, who gained or lost the most, and who moved the largest deposits or withdrawals."
        badge={lastLoaded ? `Updated ${lastLoaded.toLocaleString()} · Sorted by ${rankLabel}` : `Sorted by ${rankLabel}`}
        actions={(
          <>
            <button
              type="button"
              onClick={load}
              disabled={loading}
              className="inline-flex items-center gap-2 rounded-xl bg-gold/15 border border-gold/35 px-4 py-2.5 text-sm font-bold text-gold-light hover:bg-gold/25 disabled:opacity-40"
            >
              <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
              Refresh
            </button>
            <button
              type="button"
              onClick={handleExport}
              disabled={!data || loading}
              className="inline-flex items-center gap-2 rounded-xl border border-surface-border px-4 py-2.5 text-sm font-bold text-white/85 hover:bg-white/[.06] disabled:opacity-40"
            >
              <Download size={16} />
              Export CSV
            </button>
          </>
        )}
      />

      {/* Tabs */}
      <div className="w-full max-w-full overflow-x-auto adm-table-x scrollbar-thin">
        <div className="admin-tabs w-max min-w-full">
        {[
          { id: 'overview', label: 'Overview', Icon: LayoutGrid },
          { id: 'trading', label: 'Trading', Icon: BarChart3 },
          { id: 'flows', label: 'Deposits & withdrawals', Icon: Wallet },
        ].map(({ id, label, Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={`admin-tab-btn shrink-0 ${tab === id ? 'active' : ''}`}
          >
            <Icon size={16} />
            {label}
          </button>
        ))}
        </div>
      </div>

      {/* Filters */}
      <div className="rounded-2xl border border-surface-border bg-surface-card/80 backdrop-blur-md p-4 sm:p-5 space-y-4">
        <button
          type="button"
          onClick={() => setAdvancedOpen((v) => !v)}
          className="flex items-center gap-2 text-sm font-extrabold text-white w-full sm:w-auto"
        >
          <SlidersHorizontal size={18} className="text-gold-light" />
          Filters &amp; scope
          {advancedOpen ? <ChevronUp size={16} className="text-white/45" /> : <ChevronDown size={16} className="text-white/45" />}
        </button>

        {advancedOpen && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3 pt-2 border-t border-surface-border/80">
            <div>
              <label className="block text-[10px] font-extrabold text-white/40 uppercase tracking-wider mb-1">List size</label>
              <select
                value={String(limit)}
                onChange={(e) => setLimit(Number(e.target.value))}
                className="w-full rounded-xl bg-surface-dark border border-surface-border px-3 py-2.5 text-white text-sm font-semibold"
              >
                {[5, 10, 15, 25, 50].map((n) => (
                  <option key={n} value={n}>Top {n}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[10px] font-extrabold text-white/40 uppercase tracking-wider mb-1">Rank traders by</label>
              <select
                value={rankBy}
                onChange={(e) => setRankBy(e.target.value)}
                className="w-full rounded-xl bg-surface-dark border border-surface-border px-3 py-2.5 text-white text-sm font-semibold"
              >
                {RANK_BY_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[10px] font-extrabold text-white/40 uppercase tracking-wider mb-1">Min fills</label>
              <input
                type="number"
                min={0}
                value={minFills}
                onChange={(e) => setMinFills(Math.max(0, Number(e.target.value) || 0))}
                className="w-full rounded-xl bg-surface-dark border border-surface-border px-3 py-2.5 text-white text-sm font-mono"
              />
            </div>
            <div className="sm:col-span-2 lg:col-span-1">
              <label className="block text-[10px] font-extrabold text-white/40 uppercase tracking-wider mb-1">Min volume (USDT)</label>
              <div className="flex flex-wrap gap-1.5 mb-2">
                {VOL_PRESETS.map((p) => (
                  <button
                    key={p.label}
                    type="button"
                    onClick={() => setMinVol(p.value)}
                    className={`px-2.5 py-1 rounded-lg text-[11px] font-bold border transition-colors ${
                      minVol === p.value
                        ? 'border-gold/40 bg-gold/15 text-gold-light'
                        : 'border-surface-border text-white/55 hover:text-white'
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
              <input
                type="number"
                min={0}
                step="100"
                value={minVol}
                onChange={(e) => setMinVol(Math.max(0, Number(e.target.value) || 0))}
                className="w-full rounded-xl bg-surface-dark border border-surface-border px-3 py-2 text-white text-sm font-mono"
              />
            </div>
            <div>
              <label className="block text-[10px] font-extrabold text-white/40 uppercase tracking-wider mb-1">Flow window</label>
              <div className="flex flex-wrap gap-1">
                {DAY_PRESETS.map((d) => (
                  <button
                    key={d.value}
                    type="button"
                    onClick={() => setDays(d.value)}
                    className={`px-2.5 py-1.5 rounded-lg text-[11px] font-bold border ${
                      days === d.value
                        ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-200'
                        : 'border-surface-border text-white/55 hover:text-white'
                    }`}
                  >
                    {d.label}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="block text-[10px] font-extrabold text-white/40 uppercase tracking-wider mb-1">Flow asset</label>
              <select
                value={flowAsset}
                onChange={(e) => setFlowAsset(e.target.value)}
                className="w-full rounded-xl bg-surface-dark border border-surface-border px-3 py-2.5 text-white text-sm font-semibold"
              >
                <option value="">All assets (notional)</option>
                {ASSET_OPTIONS.filter(Boolean).map((a) => (
                  <option key={a} value={a}>{a} only</option>
                ))}
              </select>
            </div>
          </div>
        )}

        <div className="flex flex-col sm:flex-row sm:items-center gap-3 pt-2 border-t border-surface-border/80">
          <div className="relative flex-1 min-w-0 max-w-md">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/35" />
            <input
              value={searchQ}
              onChange={(e) => setSearchQ(e.target.value)}
              placeholder="Search name, email, or UID in tables…"
              className="w-full rounded-xl bg-surface-dark border border-surface-border pl-10 pr-4 py-2.5 text-white text-sm placeholder:text-white/35"
            />
          </div>
          <p className="text-[11px] text-white/40">
            {data?.flows_cutoff_note}
            {data?.flow_asset ? ` · Asset: ${data.flow_asset}` : ''}
          </p>
        </div>
      </div>

      {err && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-red-300 text-sm">
          {err}
        </div>
      )}

      {loading && !data ? (
        <div className="flex flex-col items-center justify-center py-24 gap-4">
          <div className="w-12 h-12 border-2 border-gold border-t-transparent rounded-full animate-spin" />
          <p className="text-white/45 text-sm">Crunching ranks…</p>
        </div>
      ) : data ? (
        <>
          {tab === 'overview' && (
            <div className="space-y-6">
              {summary && (
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                  <KpiCard
                    label="Traders (after filters)"
                    value={summary.traders_after_filters ?? '—'}
                    sub={`${summary.traders_with_history ?? '—'} with any trade`}
                    accent="border-emerald-500/25"
                  />
                  <KpiCard
                    label="Profitable / losing (est.)"
                    value={`${summary.traders_profitable_approx ?? 0} / ${summary.traders_losing_approx ?? 0}`}
                    sub="Combined P&L sign"
                    accent="border-cyan-500/20"
                  />
                  <KpiCard
                    label="Sum top deposits"
                    value={fmtCompact(summary.sum_top_deposits_usdt)}
                    sub="Shown in USDT"
                    accent="border-green-500/25"
                  />
                  <KpiCard
                    label="Sum top withdrawals"
                    value={fmtCompact(summary.sum_top_withdrawals_usdt)}
                    sub="Shown in USDT"
                    accent="border-gold/25"
                  />
                </div>
              )}

              <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-4">
                <SpotlightCard
                  title="#1 Gainer"
                  row={(data.top_gainers || [])[0]}
                  valueLabel="Combined"
                  value={(data.top_gainers || [])[0] ? `${Number((data.top_gainers || [])[0].combined_pnl_estimate_usdt).toFixed(4)} USDT` : ''}
                  valueClass="text-emerald-400"
                  icon={Sparkles}
                />
                <SpotlightCard
                  title="#1 Loser (lowest rank)"
                  row={(data.top_losers || [])[0]}
                  valueLabel="Combined"
                  value={(data.top_losers || [])[0] ? `${Number((data.top_losers || [])[0].combined_pnl_estimate_usdt).toFixed(4)} USDT` : ''}
                  valueClass="text-red-300"
                  icon={TrendingDown}
                />
                <SpotlightCard
                  title="#1 Deposits"
                  row={(data.top_deposits || [])[0]}
                  valueLabel="Amount"
                  value={(data.top_deposits || [])[0] ? `${fmtCompact((data.top_deposits || [])[0].total_notional_usdt)} USDT` : ''}
                  valueClass="text-cyan-200"
                  icon={ArrowDownToLine}
                />
                <SpotlightCard
                  title="#1 Withdrawals"
                  row={(data.top_withdrawals || [])[0]}
                  valueLabel="Amount"
                  value={(data.top_withdrawals || [])[0] ? `${fmtCompact((data.top_withdrawals || [])[0].total_notional_usdt)} USDT` : ''}
                  valueClass="text-gold-light"
                  icon={ArrowUpFromLine}
                />
              </div>

              <div className="grid lg:grid-cols-2 gap-5">
                <DataTable
                  title="Top gainers (preview)"
                  subtitle={`Order: ${rankLabel}`}
                  icon={TrendingUp}
                  headClass="text-emerald-400"
                  rows={(data.top_gainers || []).slice(0, 5)}
                  variant="pnl"
                  searchQ={searchQ}
                />
                <DataTable
                  title="Top depositors (preview)"
                  subtitle={data.flow_asset ? `Coin: ${data.flow_asset}` : 'All coins, value shown in USDT'}
                  icon={ArrowDownToLine}
                  headClass="text-green-400"
                  rows={(data.top_deposits || []).slice(0, 5)}
                  variant="flow"
                  searchQ={searchQ}
                />
              </div>
            </div>
          )}

          {tab === 'trading' && (
            <div className="grid xl:grid-cols-2 gap-5">
              <DataTable
                title="Top gainers"
                subtitle={`Best ${rankLabel.toLowerCase()} first (filters apply)`}
                icon={TrendingUp}
                headClass="text-emerald-400"
                rows={data.top_gainers || []}
                variant="pnl"
                searchQ={searchQ}
                emptyHint="Try lowering min fills or min volume."
              />
              <DataTable
                title="Top losers"
                subtitle={`Lowest ${rankLabel.toLowerCase()} first`}
                icon={TrendingDown}
                headClass="text-red-400"
                rows={data.top_losers || []}
                variant="pnl"
                searchQ={searchQ}
                emptyHint="Try lowering min fills or min volume."
              />
            </div>
          )}

          {tab === 'flows' && (
            <div className="grid xl:grid-cols-2 gap-5">
              <DataTable
                title="Highest approved deposits"
                subtitle={data.flow_asset ? `${data.flow_asset} only` : 'Per user, value in USDT'}
                icon={ArrowDownToLine}
                headClass="text-green-400"
                rows={data.top_deposits || []}
                variant="flow"
                searchQ={searchQ}
              />
              <DataTable
                title="Highest approved withdrawals"
                subtitle={data.flow_asset ? `${data.flow_asset} only` : 'Per user, value in USDT'}
                icon={ArrowUpFromLine}
                headClass="text-gold-light"
                rows={data.top_withdrawals || []}
                variant="flow"
                searchQ={searchQ}
              />
            </div>
          )}

          <button
            type="button"
            onClick={() => setMethodologyOpen((v) => !v)}
            className="flex items-center gap-2 text-[11px] font-bold text-white/45 hover:text-white/65"
          >
            <Info size={14} />
            Methodology
            {methodologyOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>
          {methodologyOpen && (
            <p className="text-[11px] text-white/40 leading-relaxed max-w-4xl border border-surface-border rounded-xl p-4 bg-surface-dark">
              {data.methodology} P&amp;L is always all-time. Deposit and withdrawal tables respect the flow window and optional asset filter.
            </p>
          )}
        </>
      ) : null}
    </div>
  );
}
