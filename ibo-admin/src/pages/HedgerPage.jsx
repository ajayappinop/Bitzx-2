import { useEffect, useMemo, useState } from 'react';
import {
  Shield,
  ShieldAlert,
  ShieldCheck,
  RefreshCw,
  Play,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Clock,
  Ban,
  Scale,
  Camera,
  Check,
  BarChart3,
  TrendingUp,
  TrendingDown,
  Search,
  ChevronLeft,
  ChevronRight,
  X,
} from 'lucide-react';
import { api } from '@/lib/api';
import CoinAvatar from '@/components/CoinAvatar';
import ConfirmModal from '@/components/ConfirmModal';
import { AdminDataTable } from '@/components/AdminPrimitives';

// Phase 8d — Binance hedger admin page.
//
// Source of truth is GET /api/admin/hedger which returns, for every
// hedgeable symbol:
//   - effective config (mode / thresholds / cooldown)
//   - treasury position, running net_hedged_qty, effective exposure
//   - on-demand hedge suggestion (side + qty + reason)
//   - cooldown remaining
//   - unhedgeable flag (Delta — no Binance market)
//
// Mutations go through two narrow endpoints so admin audit logs capture
// them independently of generic platform_controls patches:
//   PATCH /api/admin/hedger/symbol/:sym   → update mode/thresholds
//   POST  /api/admin/hedger/symbol/:sym/execute → manual hedge

function fmtNum(n, dp = 8) {
  const v = Number(n);
  if (!Number.isFinite(v)) return '—';
  return v.toLocaleString(undefined, {
    maximumFractionDigits: dp,
    minimumFractionDigits: 0,
  });
}

function fmtUsd(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return '—';
  const sign = v < 0 ? '-' : '';
  const abs = Math.abs(v);
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(2)}K`;
  return `${sign}$${abs.toFixed(2)}`;
}

function fmtDatetime(s) {
  if (!s) return '—';
  try {
    return new Date(s).toLocaleString();
  } catch {
    return s;
  }
}

const MODE_STYLES = {
  off:    'bg-white/10 text-white/60 border border-white/10',
  manual: 'bg-gold/15 text-gold-light border border-gold/30',
  auto:   'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30',
};

function ModeBadge({ mode }) {
  const key = String(mode || 'off').toLowerCase();
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-[2px] rounded-md text-[11px] font-extrabold uppercase ${MODE_STYLES[key] || MODE_STYLES.off}`}>
      {key}
    </span>
  );
}

const STATUS_ICON = {
  filled:    <CheckCircle2 size={14} className="text-emerald-400" />,
  submitted: <Clock size={14} className="text-gold-light" />,
  dry_run:   <ShieldCheck size={14} className="text-sky-300" />,
  failed:    <XCircle size={14} className="text-rose-400" />,
  rejected:  <XCircle size={14} className="text-rose-400" />,
};

function StatusBadge({ status }) {
  const key = String(status || '').toLowerCase();
  const icon = STATUS_ICON[key] || <AlertTriangle size={14} className="text-white/60" />;
  return (
    <span className="inline-flex items-center gap-1 text-[11px] font-mono uppercase text-white/80">
      {icon}
      {key || '—'}
    </span>
  );
}

function StatCard({ icon: Icon, label, value, hint, accent = 'text-white' }) {
  return (
    <div className="rounded-2xl border border-surface-border bg-surface-card p-4">
      <div className="flex items-center gap-2 text-white/55 text-xs font-extrabold uppercase tracking-wider">
        {Icon ? <Icon size={14} /> : null}
        {label}
      </div>
      <p className={`mt-2 text-xl font-mono font-extrabold ${accent}`}>{value}</p>
      {hint ? <p className="text-[11px] text-white/40 mt-1">{hint}</p> : null}
    </div>
  );
}

function SymbolConfigEditor({ row, onSave }) {
  const cfg = row.config || {};
  const [mode, setMode] = useState(cfg.mode || 'off');
  const [threshold, setThreshold] = useState(cfg.rebalance_threshold ?? 0);
  const [maxSize, setMaxSize] = useState(cfg.max_hedge_size ?? 0);
  const [cooldown, setCooldown] = useState(cfg.cooldown_sec ?? 0);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const dirty =
    String(cfg.mode || 'off') !== String(mode)
    || Number(cfg.rebalance_threshold || 0) !== Number(threshold)
    || Number(cfg.max_hedge_size || 0) !== Number(maxSize)
    || Number(cfg.cooldown_sec || 0) !== Number(cooldown);

  async function save() {
    setSaving(true);
    setErr('');
    try {
      await onSave({
        mode,
        rebalance_threshold: Number(threshold),
        max_hedge_size:      Number(maxSize),
        cooldown_sec:        Number(cooldown),
      });
    } catch (e) {
      setErr(e?.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2 text-[12px]">
      <select
        className="bg-surface-dark border border-white/10 rounded-md px-2 py-1 text-white"
        value={mode}
        onChange={(e) => setMode(e.target.value)}
        disabled={row.unhedgeable}
      >
        <option value="off">OFF</option>
        <option value="manual">MANUAL</option>
        <option value="auto">AUTO</option>
      </select>
      <label className="flex items-center gap-1 text-white/55">
        thresh
        <input
          type="number"
          step="any"
          min="0"
          value={threshold}
          onChange={(e) => setThreshold(e.target.value)}
          className="w-20 bg-surface-dark border border-white/10 rounded-md px-2 py-1 text-white font-mono"
          disabled={row.unhedgeable}
        />
      </label>
      <label className="flex items-center gap-1 text-white/55">
        max
        <input
          type="number"
          step="any"
          min="0"
          value={maxSize}
          onChange={(e) => setMaxSize(e.target.value)}
          className="w-20 bg-surface-dark border border-white/10 rounded-md px-2 py-1 text-white font-mono"
          disabled={row.unhedgeable}
        />
      </label>
      <label className="flex items-center gap-1 text-white/55">
        cd(s)
        <input
          type="number"
          step="1"
          min="0"
          value={cooldown}
          onChange={(e) => setCooldown(e.target.value)}
          className="w-16 bg-surface-dark border border-white/10 rounded-md px-2 py-1 text-white font-mono"
          disabled={row.unhedgeable}
        />
      </label>
      <button
        type="button"
        onClick={save}
        disabled={!dirty || saving || row.unhedgeable}
        className="px-2 py-1 rounded-md bg-gold/90 text-black font-bold hover:bg-gold disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {saving ? '…' : 'Save'}
      </button>
      {err ? <span className="text-rose-400 text-[11px]">{err}</span> : null}
    </div>
  );
}

function SymbolRow({ row, masterEnabled, onExecute, onSaveConfig }) {
  const sug = row.suggestion || {};
  const hasSuggestion = sug.side && Number(sug.target_qty) > 0;
  const exposure = Number(sug.exposure || 0);
  const exposureCls = exposure > 1e-9
    ? 'text-emerald-300'
    : exposure < -1e-9 ? 'text-rose-300' : 'text-white/60';
  const execDisabled =
    row.unhedgeable
    || !masterEnabled
    || !hasSuggestion
    || row.cooldown_remaining_sec > 0;

  let execTitle = 'Execute the current hedge suggestion';
  if (row.unhedgeable) execTitle = `${row.base_asset} has no Binance market`;
  else if (!masterEnabled) execTitle = 'Hedger master switch is OFF';
  else if (!hasSuggestion) execTitle = 'Nothing to hedge — exposure within threshold';
  else if (row.cooldown_remaining_sec > 0) execTitle = `Cooldown: ${row.cooldown_remaining_sec.toFixed(0)}s remaining`;

  return (
    <tr className="align-top">
      <td>
        <div className="flex items-center gap-2">
          <CoinAvatar symbol={row.base_asset} size={24} />
          <div>
            <div className="font-extrabold text-white">{row.symbol}</div>
            <div className="text-[11px] text-white/45 font-mono">
              mark ${fmtNum(row.treasury_mark_usdt, 4)}
            </div>
          </div>
        </div>
      </td>
      <td>
        <ModeBadge mode={row.config?.mode} />
        {row.unhedgeable ? (
          <div className="mt-1 inline-flex items-center gap-1 text-[10px] text-white/40">
            <Ban size={11} /> not on Binance
          </div>
        ) : null}
      </td>
      <td className="font-mono text-right text-white/90">
        {fmtNum(row.treasury_pos_base, 6)}
      </td>
      <td className="font-mono text-right text-white/70">
        {fmtNum(row.net_hedged_qty, 6)}
      </td>
      <td className={`font-mono text-right ${exposureCls}`}>
        {fmtNum(exposure, 6)}
      </td>
      <td>
        {hasSuggestion ? (
          <div>
            <div className="text-white font-extrabold">
              {sug.side === 'buy' ? 'BUY' : 'SELL'} {fmtNum(sug.target_qty, 6)}
            </div>
            <div className="text-[11px] text-white/45 capitalize">{sug.reason}</div>
          </div>
        ) : (
          <span className="text-white/40 text-[12px]">
            {sug.reason === 'unhedgeable' ? '—' : 'within threshold'}
          </span>
        )}
      </td>
      <td>
        <SymbolConfigEditor row={row} onSave={(body) => onSaveConfig(row.symbol, body)} />
      </td>
      <td>
        <button
          type="button"
          title={execTitle}
          disabled={execDisabled}
          onClick={() => onExecute(row.symbol, sug.side, sug.target_qty)}
          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-emerald-500/90 text-black font-bold hover:bg-emerald-400 disabled:opacity-30 disabled:cursor-not-allowed"
        >
          <Play size={13} /> Execute
        </button>
        {row.cooldown_remaining_sec > 0 ? (
          <div className="text-[10px] text-gold-light mt-1 text-center">
            cooldown {row.cooldown_remaining_sec.toFixed(0)}s
          </div>
        ) : null}
      </td>
    </tr>
  );
}

function TradesTable({ trades }) {
  if (!trades?.length) {
    return (
      <p className="text-white/45 text-sm italic">
        No hedge trades yet — none have been executed (or dry-run) since cutover.
      </p>
    );
  }
  return (
    <AdminDataTable>
      <thead>
        <tr>
          <th>When</th>
          <th>Symbol</th>
          <th>Side</th>
          <th className="text-right">Requested</th>
          <th className="text-right">Executed</th>
          <th className="text-right">Avg px</th>
          <th className="text-right">Notional</th>
          <th>Status</th>
          <th>Mode</th>
          <th>By</th>
          <th>Order id / error</th>
        </tr>
      </thead>
      <tbody>
        {trades.map((t) => (
          <tr key={t.id}>
            <td className="text-white/70 text-[12px]">{fmtDatetime(t.created_at)}</td>
            <td className="text-white font-bold">{t.symbol}</td>
            <td>
              <span className={`text-[11px] font-extrabold uppercase ${t.side === 'buy' ? 'text-emerald-300' : 'text-rose-300'}`}>
                {t.side}
              </span>
            </td>
            <td className="text-right font-mono">{fmtNum(t.requested_qty, 6)}</td>
            <td className="text-right font-mono">{fmtNum(t.executed_qty, 6)}</td>
            <td className="text-right font-mono">{fmtNum(t.avg_price ?? t.binance_price, 4)}</td>
            <td className="text-right font-mono">{fmtUsd(t.notional_usdt)}</td>
            <td><StatusBadge status={t.status} /></td>
            <td><ModeBadge mode={t.mode} /></td>
            <td className="text-white/60 text-[12px]">{t.initiator_email || t.initiator || '—'}</td>
            <td className="text-white/55 text-[11px] font-mono break-all max-w-xs">
              {t.error
                ? <span className="text-rose-400">{t.error}</span>
                : (t.binance_order_id || (t.dry_run ? 'dry-run' : '—'))
              }
            </td>
          </tr>
        ))}
      </tbody>
    </AdminDataTable>
  );
}

const RECONCILE_SEVERITY_STYLES = {
  ok:       'bg-emerald-500/10 text-emerald-300 border border-emerald-500/20',
  warn:     'bg-gold/15 text-gold-light border border-gold/30',
  critical: 'bg-rose-500/15 text-rose-300 border border-rose-500/30',
};

function SeverityPill({ severity }) {
  const key = String(severity || 'ok').toLowerCase();
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-[2px] rounded-md text-[11px] font-extrabold uppercase ${RECONCILE_SEVERITY_STYLES[key] || RECONCILE_SEVERITY_STYLES.ok}`}>
      {key}
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase 9b — PnL section.
//
// Realised PnL = spread_revenue − hedge_cost. Unrealised exposure is
// reported side-by-side (open_position × current_mark) but never rolled
// into realised per the Level-A design brief. Time series is hourly for
// 24h, daily otherwise.
// ─────────────────────────────────────────────────────────────────────────────

const PNL_WINDOWS = [
  { value: '24h', label: '24h' },
  { value: '7d',  label: '7d'  },
  { value: '30d', label: '30d' },
  { value: 'all', label: 'All' },
];

function PnlNumberColor({ v, invert = false }) {
  // ``invert=true`` means "bigger is worse" (used for hedge cost).
  const n = Number(v);
  if (!Number.isFinite(n) || n === 0) return 'text-white/80';
  const good = invert ? n < 0 : n > 0;
  return good ? 'text-emerald-300' : 'text-rose-300';
}

function PnlBars({ timeseries = [] }) {
  // Compact bar chart: spread (emerald up), cost (rose down). Width %
  // scales against the max absolute value across both series so a
  // single quiet bucket doesn't dwarf a noisy one.
  if (!timeseries.length) {
    return (
      <p className="text-white/40 text-xs">No PnL activity in this window.</p>
    );
  }
  const max = Math.max(
    1e-9,
    ...timeseries.map((b) => Math.max(Math.abs(b.spread || 0), Math.abs(b.cost || 0))),
  );
  return (
    <div className="space-y-1">
      {timeseries.map((b) => {
        const spPct = Math.min(100, (Math.abs(b.spread || 0) / max) * 100);
        const csPct = Math.min(100, (Math.abs(b.cost   || 0) / max) * 100);
        return (
          <div key={b.bucket} className="grid grid-cols-[130px_1fr_1fr_100px] items-center gap-2 text-[11px]">
            <span className="font-mono text-white/50">{b.bucket}</span>
            <div className="h-3 relative rounded bg-white/5 overflow-hidden">
              <div
                className="h-full bg-emerald-500/70"
                style={{ width: `${spPct}%` }}
                title={`Spread revenue: ${fmtUsd(b.spread)}`}
              />
            </div>
            <div className="h-3 relative rounded bg-white/5 overflow-hidden">
              <div
                className={`h-full ${(b.cost || 0) >= 0 ? 'bg-rose-500/70' : 'bg-sky-500/70'}`}
                style={{ width: `${csPct}%` }}
                title={`Hedge cost: ${fmtUsd(b.cost)}${(b.cost || 0) < 0 ? ' (favourable)' : ''}`}
              />
            </div>
            <span className={`font-mono text-right ${Number(b.net) > 0 ? 'text-emerald-300' : Number(b.net) < 0 ? 'text-rose-300' : 'text-white/50'}`}>
              {fmtUsd(b.net)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function PnlSection() {
  const [win, setWin] = useState('7d');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  async function load(w = win) {
    setLoading(true);
    try {
      const res = await api.hedgerPnl(w);
      const body = await res.json();
      if (!res.ok) throw new Error(body?.detail || 'Failed to load');
      setData(body);
      setErr('');
    } catch (e) {
      setErr(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load(win);
    // Same cadence as reconciliation — PnL aggregates are cheap (indexed
    // ``created_at`` scan + $group) but we still don't want to hammer.
    const t = setInterval(() => load(win), 30_000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [win]);

  const totals = data?.totals || {};
  const rows = data?.symbols || [];
  const series = data?.timeseries || [];

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-lg font-extrabold text-white flex items-center gap-2">
          <BarChart3 size={18} className="text-emerald-300" /> PnL
          <span className="ml-2 text-white/40 text-xs font-medium">
            Realised (window) + Unrealised (live)
          </span>
        </h2>
        <div className="flex items-center gap-2">
          <div className="inline-flex rounded-lg border border-white/10 overflow-hidden">
            {PNL_WINDOWS.map((w) => (
              <button
                key={w.value}
                type="button"
                onClick={() => setWin(w.value)}
                className={`px-3 py-1.5 text-xs font-bold ${win === w.value ? 'bg-white/10 text-white' : 'text-white/60 hover:bg-white/5'}`}
              >
                {w.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => load(win)}
            disabled={loading}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-white/10 text-white/80 hover:bg-white/5 disabled:opacity-40"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh
          </button>
        </div>
      </div>

      <p className="text-white/50 text-xs max-w-3xl">
        <b>Realised</b> = spread revenue captured on SYSTEM fills − slippage vs mark on Binance hedges.
        <b className="ml-2">Unrealised</b> = current open position × mark (live, not windowed).
        Dry-run and rejected hedges are excluded from cost.
      </p>

      {err ? (
        <div className="p-3 rounded-xl border border-rose-500/30 bg-rose-500/10 text-rose-300 text-sm">
          {err}
        </div>
      ) : null}

      {/* Summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="p-3 rounded-xl border border-white/10 bg-white/[0.02]">
          <div className="text-[10px] uppercase tracking-wider text-white/40 flex items-center gap-1">
            {Number(totals.net_realized_usdt) >= 0 ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
            Net realised
          </div>
          <div className={`text-2xl font-extrabold ${PnlNumberColor({ v: totals.net_realized_usdt })}`}>
            {fmtUsd(totals.net_realized_usdt)}
          </div>
          <div className="text-[11px] text-white/40 mt-1">spread − hedge cost</div>
        </div>
        <div className="p-3 rounded-xl border border-white/10 bg-white/[0.02]">
          <div className="text-[10px] uppercase tracking-wider text-white/40">Spread revenue</div>
          <div className="text-2xl font-extrabold text-emerald-300">
            {fmtUsd(totals.spread_revenue_usdt)}
          </div>
          <div className="text-[11px] text-white/40 mt-1">
            {fmtNum(totals.fill_count, 0)} SYSTEM fills
          </div>
        </div>
        <div className="p-3 rounded-xl border border-white/10 bg-white/[0.02]">
          <div className="text-[10px] uppercase tracking-wider text-white/40">Hedge cost (vs mark)</div>
          <div className={`text-2xl font-extrabold ${PnlNumberColor({ v: totals.hedge_cost_usdt, invert: true })}`}>
            {fmtUsd(totals.hedge_cost_usdt)}
          </div>
          <div className="text-[11px] text-white/40 mt-1">
            {fmtNum(totals.hedge_count, 0)} executed hedges
            {Number(totals.hedge_cost_usdt) < 0 ? ' · favourable' : ''}
          </div>
        </div>
        <div className="p-3 rounded-xl border border-white/10 bg-white/[0.02]">
          <div className="text-[10px] uppercase tracking-wider text-white/40">Open exposure</div>
          <div className={`text-2xl font-extrabold ${Number(totals.open_exposure_usdt) !== 0 ? 'text-gold-light' : 'text-white/60'}`}>
            {fmtUsd(totals.open_exposure_usdt)}
          </div>
          <div className="text-[11px] text-white/40 mt-1">unrealised · live mark</div>
        </div>
      </div>

      {/* Per-symbol table */}
      <AdminDataTable>
        <thead>
          <tr>
              <th>Symbol</th>
              <th className="text-right">Spread revenue</th>
              <th className="text-right">Hedge cost</th>
              <th className="text-right">Net realised</th>
              <th className="text-right">Fills</th>
              <th className="text-right">Hedges</th>
              <th className="text-right">Open position</th>
              <th className="text-right">Open USD</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.symbol}>
                <td>
                  <div className="flex items-center gap-2">
                    <CoinAvatar symbol={r.base_asset} size={20} />
                    <span className="font-bold text-white">{r.symbol}</span>
                  </div>
                </td>
                <td className="text-right font-mono text-emerald-300">
                  {fmtUsd(r.spread_revenue_usdt)}
                </td>
                <td className={`text-right font-mono ${PnlNumberColor({ v: r.hedge_cost_usdt, invert: true })}`}>
                  {fmtUsd(r.hedge_cost_usdt)}
                </td>
                <td className={`text-right font-mono font-bold ${PnlNumberColor({ v: r.net_realized_usdt })}`}>
                  {fmtUsd(r.net_realized_usdt)}
                </td>
                <td className="text-right font-mono text-white/60">
                  {fmtNum(r.fill_count, 0)}
                </td>
                <td className="text-right font-mono text-white/60">
                  {fmtNum(r.hedge_count, 0)}
                </td>
                <td className="text-right font-mono text-white/80">
                  {fmtNum(r.open_exposure_base, 6)} {r.base_asset}
                </td>
                <td className={`text-right font-mono ${Number(r.open_exposure_usdt) !== 0 ? 'text-gold-light' : 'text-white/50'}`}>
                  {fmtUsd(r.open_exposure_usdt)}
                </td>
              </tr>
            ))}
            {!rows.length && !loading ? (
              <tr>
                <td className="text-white/50 text-center" colSpan={8}>
                  No symbols to report.
                </td>
              </tr>
            ) : null}
          </tbody>
        </AdminDataTable>

      {/* Time series */}
      <div className="p-3 rounded-xl border border-white/10 bg-white/[0.02] space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-extrabold text-white/80">
            Activity — {data?.granularity === 'hour' ? 'hourly' : 'daily'} ({data?.window || win})
          </h3>
          <div className="flex items-center gap-3 text-[10px] text-white/50">
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-emerald-500/70 inline-block" /> Spread</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-rose-500/70 inline-block" /> Cost</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-sky-500/70 inline-block" /> Cost (fav.)</span>
            <span className="text-white/40">= Net</span>
          </div>
        </div>
        <PnlBars timeseries={series} />
      </div>
    </div>
  );
}

// Page-size options for the reconciliation table. ``0`` is a sentinel for
// "show all" — useful when ops is hunting for a specific asset and doesn't
// want the pager to hide it.
const RECONCILE_PAGE_SIZES = [10, 25, 50, 0];

// Severity filter chips. ``all`` is the default so nothing is hidden by
// accident; ``drift`` is a convenience bucket (warn ∪ critical) because
// that's what ops cares about 90% of the time.
const RECONCILE_SEVERITY_FILTERS = [
  { id: 'all',      label: 'All',      tone: 'white' },
  { id: 'drift',    label: 'Drift',    tone: 'amber' },
  { id: 'critical', label: 'Critical', tone: 'rose'  },
  { id: 'warn',     label: 'Warn',     tone: 'amber' },
  { id: 'ok',       label: 'Healthy',  tone: 'emerald' },
];

function ReconciliationSection() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState('');
  // ── Filter / search / pagination state ──────────────────────────────
  // Kept entirely client-side: the reconcile payload is already bounded
  // (one row per tradable asset, today ~14 rows) so round-tripping the
  // filters to the backend would only add latency without upside.
  const [query, setQuery]         = useState('');
  const [severity, setSeverity]   = useState('all');
  const [pageSize, setPageSize]   = useState(25);
  const [page, setPage]           = useState(1);
  const [snapshotOpen, setSnapshotOpen] = useState(false);
  const [acceptModal, setAcceptModal] = useState({ open: false, row: null });

  async function load() {
    setLoading(true);
    try {
      const res = await api.hedgerReconcile();
      const body = await res.json();
      if (!res.ok) throw new Error(body?.detail || 'Failed to load');
      setData(body);
      setErr('');
    } catch (e) {
      setErr(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // 30s cadence is gentle on Binance rate limits (reconcile pulls the
    // full /account response). Refresh button is manual for faster polls.
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function snapshot(note = '') {
    setBusy('snapshot');
    try {
      const res = await api.hedgerReconcileSnapshot({ note });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.detail || 'Snapshot failed');
      await load();
    } catch (e) {
      setErr(`Snapshot failed: ${e?.message || e}`);
    } finally {
      setBusy('');
    }
  }

  async function accept(row, note = '') {
    setBusy(row.asset);
    try {
      const res = await api.hedgerReconcileAccept({ asset: row.asset, note });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.detail || 'Accept failed');
      await load();
    } catch (e) {
      setErr(`Accept failed: ${e?.message || e}`);
    } finally {
      setBusy('');
    }
  }

  const rows = data?.rows || [];
  const totals = data?.totals || {};
  const thresholds = data?.thresholds || {};
  const binanceError = data?.error;

  // Apply search + severity filter once per render. ``drift`` is a union
  // (warn ∪ critical) because that's the natural question ops asks ("just
  // show me what's broken"). We also pre-lowercase the query so typing
  // "btc"/"BTC" both work.
  const filteredRows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (q && !String(r.asset || '').toLowerCase().includes(q)) return false;
      if (severity === 'all') return true;
      if (severity === 'drift') {
        return r.severity === 'warn' || r.severity === 'critical';
      }
      return r.severity === severity;
    });
  }, [rows, query, severity]);

  // Reset to page 1 any time the result set shrinks — otherwise users can
  // get stranded on an empty "page 3 of 1". Also recompute total pages
  // from the live filtered length so the pager stays honest.
  const totalPages = pageSize === 0
    ? 1
    : Math.max(1, Math.ceil(filteredRows.length / pageSize));
  useEffect(() => {
    if (page > totalPages) setPage(1);
  }, [filteredRows.length, pageSize, totalPages, page]);

  const pagedRows = useMemo(() => {
    if (pageSize === 0) return filteredRows;
    const start = (page - 1) * pageSize;
    return filteredRows.slice(start, start + pageSize);
  }, [filteredRows, page, pageSize]);

  // Counts for the severity chips — computed off unfiltered ``rows`` so
  // the numbers stay stable even when a filter is active.
  const sevCounts = useMemo(() => {
    const c = { all: rows.length, drift: 0, critical: 0, warn: 0, ok: 0 };
    for (const r of rows) {
      if (r.severity === 'critical') c.critical += 1;
      else if (r.severity === 'warn') c.warn += 1;
      else c.ok += 1;
    }
    c.drift = c.critical + c.warn;
    return c;
  }, [rows]);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-extrabold text-white flex items-center gap-2">
          <Scale size={18} className="text-sky-300" /> Reconciliation
          {data?.any_critical ? (
            <span className="ml-2 text-rose-300 text-sm font-bold">— CRITICAL DRIFT</span>
          ) : data?.any_warn ? (
            <span className="ml-2 text-gold-light text-sm font-bold">— drift detected</span>
          ) : null}
        </h2>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setSnapshotOpen(true)}
            disabled={busy === 'snapshot' || loading || !!binanceError}
            title="Snapshot current Binance balances as the new reconciliation baseline (superadmin)"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-white/10 text-white/80 hover:bg-white/5 disabled:opacity-40"
          >
            <Camera size={14} /> {busy === 'snapshot' ? 'Snapping…' : 'Snapshot baseline'}
          </button>
          <button
            type="button"
            onClick={load}
            disabled={loading}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-white/10 text-white/80 hover:bg-white/5 disabled:opacity-40"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh
          </button>
        </div>
      </div>

      <p className="text-white/50 text-xs max-w-3xl">
        Compares Binance's live <b>/account</b> balance against <code className="font-mono">baseline + Σ&nbsp;net_hedged_qty</code>.
        Seed capital (ops funding) lives in baselines and is explicitly snapshotted — never auto-detected.
        Drift warns above {thresholds.warn_pct}% and {fmtUsd(thresholds.warn_usd)}; critical above {thresholds.critical_pct}% and {fmtUsd(thresholds.critical_usd)}.
      </p>

      {binanceError ? (
        <div className="p-3 rounded-xl border border-rose-500/30 bg-rose-500/10 text-rose-300 text-sm flex items-start gap-2">
          <AlertTriangle size={16} className="mt-0.5" />
          Binance fetch failed: <code className="font-mono">{binanceError}</code>. Baselines and internal
          state are still shown below, but without a live balance there's nothing to compare against.
        </div>
      ) : null}

      {err ? (
        <div className="p-3 rounded-xl border border-rose-500/30 bg-rose-500/10 text-rose-300 text-sm">{err}</div>
      ) : null}

      <div className="grid grid-cols-3 gap-3 mb-2">
        <StatCard label="Binance (USD)" value={fmtUsd(totals.binance_usd)} />
        <StatCard label="Expected (USD)" value={fmtUsd(totals.expected_usd)} />
        <StatCard
          label="Net drift (USD)"
          value={fmtUsd(totals.drift_usd)}
          accent={
            Math.abs(Number(totals.drift_usd) || 0) > Number(thresholds.critical_usd || 0)
              ? 'text-rose-300'
              : Math.abs(Number(totals.drift_usd) || 0) > Number(thresholds.warn_usd || 0)
                ? 'text-gold-light'
                : 'text-emerald-300'
          }
        />
      </div>

      {/* ── Toolbar: search + severity chips + page-size ─────────────── */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3 rounded-2xl border border-surface-border bg-surface-card p-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search
              size={14}
              className="absolute left-2.5 top-1/2 -translate-y-1/2 text-white/40 pointer-events-none"
            />
            <input
              type="text"
              value={query}
              onChange={(e) => { setQuery(e.target.value); setPage(1); }}
              placeholder="Search asset (e.g. BTC, ETH)…"
              className="pl-8 pr-7 py-1.5 w-64 rounded-lg bg-surface-dark border border-surface-border text-sm text-white placeholder-white/30"
            />
            {query ? (
              <button
                type="button"
                onClick={() => { setQuery(''); setPage(1); }}
                title="Clear search"
                className="absolute right-1.5 top-1/2 -translate-y-1/2 text-white/40 hover:text-white/80"
              >
                <X size={13} />
              </button>
            ) : null}
          </div>

          {/* Severity chips. ``drift`` is an "any drift" shortcut. */}
          <div className="flex flex-wrap items-center gap-1.5">
            {RECONCILE_SEVERITY_FILTERS.map((f) => {
              const active = severity === f.id;
              const count = sevCounts[f.id] ?? 0;
              const base = 'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-extrabold uppercase border transition-colors';
              const toneInactive = {
                white:   'border-white/10 text-white/65 hover:bg-white/5',
                amber:   'border-gold/25 text-gold-light/80 hover:bg-gold/10',
                rose:    'border-rose-500/25 text-rose-300/80 hover:bg-rose-500/10',
                emerald: 'border-emerald-500/25 text-emerald-300/80 hover:bg-emerald-500/10',
              }[f.tone] || 'border-white/10 text-white/65 hover:bg-white/5';
              const toneActive = {
                white:   'border-white/40 bg-white/10 text-white',
                amber:   'border-gold/50 bg-gold/15 text-gold-light',
                rose:    'border-rose-500/50 bg-rose-500/15 text-rose-200',
                emerald: 'border-emerald-500/50 bg-emerald-500/15 text-emerald-200',
              }[f.tone] || 'border-white/40 bg-white/10 text-white';
              return (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => { setSeverity(f.id); setPage(1); }}
                  className={`${base} ${active ? toneActive : toneInactive}`}
                >
                  {f.label}
                  <span className={`ml-0.5 text-[10px] font-bold ${active ? 'opacity-90' : 'opacity-60'}`}>
                    {count}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex items-center gap-2 text-[11px] text-white/55">
          <span>Rows per page</span>
          <select
            value={pageSize}
            onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }}
            className="rounded-md bg-surface-dark border border-surface-border px-2 py-1 text-xs text-white"
          >
            {RECONCILE_PAGE_SIZES.map((n) => (
              <option key={n} value={n}>{n === 0 ? 'All' : n}</option>
            ))}
          </select>
          <span className="text-white/35">
            {filteredRows.length} of {rows.length}
          </span>
        </div>
      </div>

      <AdminDataTable>
        <thead>
          <tr>
              <th>Asset</th>
              <th className="text-right">Binance (free / locked)</th>
              <th className="text-right">Baseline</th>
              <th className="text-right">Internal hedged</th>
              <th className="text-right">Expected</th>
              <th className="text-right">Drift</th>
              <th className="text-right">Drift (USD)</th>
              <th>Severity</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {pagedRows.map((r) => (
              <tr key={r.asset} className="align-top">
                <td>
                  <div className="flex items-center gap-2">
                    <CoinAvatar symbol={r.asset} size={22} />
                    <div>
                      <div className="font-extrabold text-white">{r.asset}</div>
                      <div className="text-[10px] text-white/40">mark ${fmtNum(r.mark_usdt, 4)}</div>
                    </div>
                  </div>
                </td>
                <td className="font-mono text-right">
                  <div>{fmtNum(r.binance_total, 6)}</div>
                  <div className="text-[10px] text-white/40">
                    {fmtNum(r.binance_free, 6)} / {fmtNum(r.binance_locked, 6)}
                  </div>
                </td>
                <td className="font-mono text-right text-white/80">
                  {fmtNum(r.baseline_qty, 6)}
                  {r.baseline_snapshot_at ? (
                    <div className="text-[10px] text-white/40">{fmtDatetime(r.baseline_snapshot_at)}</div>
                  ) : (
                    <div className="text-[10px] text-gold-light/70">not set</div>
                  )}
                </td>
                <td className="font-mono text-right text-white/70">
                  {fmtNum(r.internal_hedged, 6)}
                </td>
                <td className="font-mono text-right text-white/90">
                  {fmtNum(r.expected_qty, 6)}
                </td>
                <td className={`font-mono text-right ${
                  r.severity === 'critical'
                    ? 'text-rose-300'
                    : r.severity === 'warn' ? 'text-gold-light' : 'text-white/70'
                }`}>
                  {fmtNum(r.drift_qty, 6)}
                  <div className="text-[10px] text-white/40">{r.drift_pct}%</div>
                </td>
                <td className="font-mono text-right text-white/90">
                  {fmtUsd(r.drift_usd)}
                </td>
                <td>
                  <SeverityPill severity={r.severity} />
                  {r.is_quote ? (
                    <div className="text-[10px] text-white/40 mt-1">quote (info only)</div>
                  ) : null}
                </td>
                <td>
                  <button
                    type="button"
                    onClick={() => setAcceptModal({ open: true, row: r })}
                    disabled={!r.acceptable || busy === r.asset || r.severity === 'ok'}
                    title={
                      !r.acceptable
                        ? 'USDT or non-tradable asset — cannot be accepted into hedger state'
                        : r.severity === 'ok'
                          ? 'No drift to accept'
                          : 'Snap net_hedged_qty to match Binance balance (superadmin, audit-logged)'
                    }
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-sky-500/90 text-black font-bold hover:bg-sky-400 disabled:opacity-30 disabled:cursor-not-allowed text-[12px]"
                  >
                    <Check size={12} /> Accept
                  </button>
                </td>
              </tr>
            ))}
            {!pagedRows.length && !loading ? (
              <tr>
                <td colSpan={9} className="text-white/50 text-center">
                  {!rows.length
                    ? 'No reconcilable assets.'
                    : 'No rows match the current filters.'}
                </td>
              </tr>
            ) : null}
          </tbody>
        </AdminDataTable>

      {/* ── Pager ────────────────────────────────────────────────────── */}
      {pageSize !== 0 && filteredRows.length > pageSize ? (
        <div className="flex items-center justify-between text-[12px] text-white/60">
          <div>
            Showing{' '}
            <span className="text-white/85 font-bold">
              {(page - 1) * pageSize + 1}
              –
              {Math.min(page * pageSize, filteredRows.length)}
            </span>{' '}
            of {filteredRows.length}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-white/10 text-white/75 hover:bg-white/5 disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <ChevronLeft size={14} /> Prev
            </button>
            <span className="text-white/50">
              Page <span className="text-white/85 font-bold">{page}</span> / {totalPages}
            </span>
            <button
              type="button"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-white/10 text-white/75 hover:bg-white/5 disabled:opacity-30 disabled:cursor-not-allowed"
            >
              Next <ChevronRight size={14} />
            </button>
          </div>
        </div>
      ) : null}
      <ConfirmModal
        open={snapshotOpen}
        title="Snapshot reconciliation baseline"
        message="Snapshot all current Binance balances as the new baseline. Use this after funding Binance seed capital; prior drift becomes hidden."
        inputLabel="Optional note"
        inputPlaceholder='e.g. 2026-04 seed: +10 ETH'
        confirmText="Snapshot baseline"
        busy={busy === 'snapshot'}
        onClose={() => { if (!busy) setSnapshotOpen(false); }}
        onConfirm={async (note) => {
          await snapshot(note);
          setSnapshotOpen(false);
        }}
      />
      <ConfirmModal
        open={acceptModal.open}
        title={acceptModal.row ? `Accept drift for ${acceptModal.row.asset}` : 'Accept drift'}
        message={acceptModal.row
          ? `Binance: ${acceptModal.row.binance_total}, Expected: ${acceptModal.row.expected_qty}, Drift: ${acceptModal.row.drift_qty} (${acceptModal.row.drift_pct}%). This updates hedger_state.net_hedged_qty and is audit-logged.`
          : ''}
        inputLabel="Optional reason"
        inputPlaceholder="Why are you accepting this drift?"
        confirmText="Accept drift"
        danger
        busy={!!busy}
        onClose={() => { if (!busy) setAcceptModal({ open: false, row: null }); }}
        onConfirm={async (note) => {
          if (!acceptModal.row) return;
          await accept(acceptModal.row, note);
          setAcceptModal({ open: false, row: null });
        }}
      />
    </div>
  );
}

export default function HedgerPage() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState('');
  const [executeConfirm, setExecuteConfirm] = useState({ open: false, symbol: '', side: '', qty: '' });

  async function load() {
    setLoading(true);
    try {
      const res = await api.hedger();
      const body = await res.json();
      if (!res.ok) throw new Error(body?.detail || 'Failed to load');
      setData(body);
      setErr('');
    } catch (e) {
      setErr(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // Lightweight polling so suggestions / cooldowns stay live without
    // the operator mashing Refresh. 15s matches the default worker tick.
    const t = setInterval(load, 15_000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const symbols = data?.symbols || [];
  const masterEnabled = !!data?.enabled;
  // Phase 8d/followup — the hedger has TWO independent gates: the DB-side
  // ``hedger_enabled`` toggle (managed from Settings) AND the backend env
  // ``HEDGER_WORKER_ENABLED`` which decides whether the background task
  // is ever even attached. If the env is off, flipping the master switch
  // in Settings does literally nothing — so we surface that state here so
  // ops never has to guess "did my toggle apply?".
  const workerEnvEnabled = !!data?.worker_env_enabled;
  const workerAttached   = !!data?.worker_attached;
  // "Effectively live" means both gates are satisfied AND the worker
  // task is actually running. Anything short of that → functionality is
  // NOT active, even if the Settings card says "enabled".
  const hedgerLive = masterEnabled && workerEnvEnabled && workerAttached;

  const { exposedSymbols, withSuggestion } = useMemo(() => {
    let s = 0;
    let w = 0;
    for (const r of symbols) {
      if (Math.abs(Number(r.suggestion?.exposure || 0)) > 1e-9) s += 1;
      if (r.suggestion?.side && Number(r.suggestion?.target_qty) > 0) w += 1;
    }
    return { exposedSymbols: s, withSuggestion: w };
  }, [symbols]);

  async function saveConfig(symbol, body) {
    setBusy(symbol);
    try {
      const res = await api.patchHedgerSymbol(symbol, body);
      const data = await res.json();
      if (!res.ok) throw new Error(data?.detail || 'Save failed');
      await load();
    } finally {
      setBusy('');
    }
  }

  async function runExecute(symbol, side, qty) {
    if (!side || !qty) return;
    setBusy(symbol);
    try {
      const res = await api.executeHedge(symbol, { side, qty });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.detail || 'Execute failed');
      await load();
    } catch (e) {
      setErr(`Execute failed: ${e?.message || e}`);
    } finally {
      setBusy('');
    }
  }

  async function execute(symbol, side, qty) {
    if (!side || !qty) return;
    if (!data?.dry_run) {
      setExecuteConfirm({ open: true, symbol, side, qty });
      return;
    }
    await runExecute(symbol, side, qty);
  }

  return (
    <div className="admin-page space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="admin-title flex items-center gap-2">
            <Shield className="text-emerald-300" /> Hedging (Binance)
          </h1>
          <p className="admin-page-lead mt-2 max-w-3xl">
            Mirror customer flow on Binance to keep inventory balanced. <b>Off</b> ignores hedging for a pair unless overridden.
            <b> Manual</b> shows suggestions and you execute. <b> Auto</b> runs when the master switch is on and dry run is off. Orders appear in the tables below.
          </p>
        </div>
        <button
          type="button"
          onClick={load}
          disabled={loading}
          className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-white/10 text-white/80 hover:bg-white/5 disabled:opacity-40"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>

      {err ? (
        <div className="p-3 rounded-xl border border-rose-500/30 bg-rose-500/10 text-rose-300 text-sm">
          {err}
        </div>
      ) : null}

      {/* Global status */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <StatCard
          icon={hedgerLive ? ShieldCheck : ShieldAlert}
          label="Master switch"
          // We only claim "ENABLED" when the DB toggle, the env gate and
          // the running worker task all agree. Any mismatch collapses to
          // a dedicated label so the card never lies about live state.
          value={
            hedgerLive
              ? 'ENABLED'
              : !masterEnabled
                ? 'DISABLED'
                : !workerEnvEnabled
                  ? 'ENV OFF'
                  : 'WORKER DOWN'
          }
          hint={
            hedgerLive
              ? 'Settings toggle ON · worker running'
              : !masterEnabled
                ? 'Toggle in Settings → Binance hedger'
                : !workerEnvEnabled
                  ? 'Settings ON, but HEDGER_WORKER_ENABLED=false in backend .env'
                  : 'Worker task crashed — check backend logs'
          }
          accent={
            hedgerLive
              ? 'text-emerald-300'
              : !masterEnabled
                ? 'text-rose-300'
                : 'text-gold-light'
          }
        />
        <StatCard
          icon={ShieldCheck}
          label="Dry run"
          value={data?.dry_run ? 'ON' : 'OFF'}
          hint="Dry-run skips the actual Binance order"
          accent={data?.dry_run ? 'text-sky-300' : 'text-gold-light'}
        />
        <StatCard
          icon={Shield}
          label="Binance mode"
          value={data?.testnet ? 'TESTNET' : 'MAINNET'}
          hint={data?.has_credentials ? 'API keys loaded' : 'API keys MISSING'}
          accent={data?.testnet ? 'text-sky-300' : 'text-gold-light'}
        />
        <StatCard
          label="Default mode"
          value={String(data?.default_mode || 'off').toUpperCase()}
          hint="Applied to symbols without override"
        />
        <StatCard
          label="Exposed"
          value={`${exposedSymbols} / ${symbols.length}`}
          hint={`${withSuggestion} suggestion(s) pending execute`}
          accent={withSuggestion > 0 ? 'text-emerald-300' : 'text-white/80'}
        />
      </div>

      {/* Safety banners */}
      {masterEnabled && !workerEnvEnabled ? (
        // #1 diagnostic we've seen from ops: "I flipped the Settings
        // toggle but the Hedger page still looks dead." That's because
        // the background task is also gated by ``HEDGER_WORKER_ENABLED``
        // at process start — the Settings toggle cannot attach a new
        // task on its own. We call this out front-and-centre with a rose
        // (not amber) border because the feature is effectively OFF.
        <div className="p-3 rounded-xl border border-rose-500/40 bg-rose-500/10 text-rose-200 text-sm flex items-start gap-2">
          <AlertTriangle size={16} className="mt-0.5" />
          <div>
            <div className="font-bold">Hedger worker is not attached.</div>
            <div className="text-rose-200/85 mt-0.5">
              The Settings master switch is ON, but the background worker task
              is disabled at the process level. Set{' '}
              <code className="font-mono">HEDGER_WORKER_ENABLED=true</code> in
              <code className="font-mono mx-1">backend/.env</code> and restart
              the API. Until then no symbol — even in AUTO — will be evaluated
              or executed.
            </div>
          </div>
        </div>
      ) : null}
      {masterEnabled && workerEnvEnabled && !workerAttached ? (
        // Env says the task should run but it's not live → something
        // crashed (unhandled exception, asyncio cancel, etc). Treat this
        // the same severity as "env off" because the effect is identical.
        <div className="p-3 rounded-xl border border-rose-500/40 bg-rose-500/10 text-rose-200 text-sm flex items-start gap-2">
          <AlertTriangle size={16} className="mt-0.5" />
          <div>
            <div className="font-bold">Hedger worker task is not running.</div>
            <div className="text-rose-200/85 mt-0.5">
              The env flag is on, but the task is no longer alive. Check the
              backend logs for <code className="font-mono">hedger_worker</code>{' '}
              errors and restart the API.
            </div>
          </div>
        </div>
      ) : null}
      {masterEnabled && !data?.has_credentials ? (
        <div className="p-3 rounded-xl border border-gold/30 bg-gold/10 text-gold-light text-sm flex items-start gap-2">
          <AlertTriangle size={16} className="mt-0.5" />
          Master switch is ON but Binance API credentials are missing. Set
          <code className="font-mono mx-1">BINANCE_API_KEY</code> and
          <code className="font-mono mx-1">BINANCE_API_SECRET</code> in the backend .env.
        </div>
      ) : null}

      {/* Symbols table */}
      <div>
        <AdminDataTable>
          <thead>
            <tr>
              <th>Symbol</th>
              <th>Mode</th>
              <th className="text-right">Treasury pos</th>
              <th className="text-right">Net hedged</th>
              <th className="text-right">Exposure</th>
              <th>Suggestion</th>
              <th>Config</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {symbols.map((r) => (
              <SymbolRow
                key={r.symbol}
                row={r}
                masterEnabled={masterEnabled}
                onSaveConfig={saveConfig}
                onExecute={execute}
              />
            ))}
            {!symbols.length && !loading ? (
              <tr>
                <td className="text-white/50 text-center" colSpan={8}>
                  No hedgeable symbols configured.
                </td>
              </tr>
            ) : null}
          </tbody>
        </AdminDataTable>
        {busy ? <p className="text-[11px] text-white/40">Working on {busy}…</p> : null}
      </div>

      {/* Phase 9b — PnL */}
      <PnlSection />

      {/* Phase 9a — Reconciliation */}
      <ReconciliationSection />

      {/* Recent trades */}
      <div className="space-y-2">
        <h2 className="text-lg font-extrabold text-white">Recent hedge trades</h2>
        <TradesTable trades={data?.recent_trades || []} />
      </div>
      <ConfirmModal
        open={executeConfirm.open}
        title="Confirm real Binance order"
        message={`Place Binance MARKET ${String(executeConfirm.side || '').toUpperCase()} ${executeConfirm.qty} ${String(executeConfirm.symbol || '').slice(0, -4)} on ${data?.testnet ? 'TESTNET' : 'MAINNET'}?`}
        confirmText="Place order"
        danger
        busy={!!busy}
        onClose={() => { if (!busy) setExecuteConfirm({ open: false, symbol: '', side: '', qty: '' }); }}
        onConfirm={async () => {
          await runExecute(executeConfirm.symbol, executeConfirm.side, executeConfirm.qty);
          setExecuteConfirm({ open: false, symbol: '', side: '', qty: '' });
        }}
      />
    </div>
  );
}
