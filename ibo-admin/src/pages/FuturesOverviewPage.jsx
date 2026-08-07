import { useCallback, useEffect, useState } from 'react';
import {
  RefreshCw, AlertTriangle, ShieldCheck, Power, PauseCircle, ArrowLeftRight,
  TrendingUp, TrendingDown, Banknote, Scale, Zap, BarChart3,
} from 'lucide-react';
import { api } from '@/lib/api';

// ── Helpers ─────────────────────────────────────────────────────────────
function fmtUsd(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return '—';
  const sign = v < 0 ? '-' : '';
  const abs = Math.abs(v);
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(2)}K`;
  return `${sign}$${abs.toFixed(2)}`;
}
const fmtNum = (n) => Number.isFinite(Number(n)) ? Number(n).toLocaleString() : '—';
const fmtPct = (n, dp = 4) => Number.isFinite(Number(n)) ? `${(Number(n) * 100).toFixed(dp)}%` : '—';

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

function ToggleRow({ label, hint, value, onChange, danger }) {
  return (
    <label className="flex items-center justify-between gap-3 py-2 cursor-pointer">
      <div>
        <div className={`text-sm font-bold ${danger ? 'text-rose-300' : 'text-white'}`}>{label}</div>
        {hint && <div className="text-[11px] text-white/45 mt-0.5">{hint}</div>}
      </div>
      <button
        type="button"
        onClick={() => onChange(!value)}
        className={`w-11 h-6 rounded-full relative transition-colors ${value ? (danger ? 'bg-rose-500' : 'bg-emerald-500') : 'bg-white/15'}`}
      >
        <span
          className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform ${value ? 'translate-x-5' : ''}`}
        />
      </button>
    </label>
  );
}

function NumField({ label, hint, value, onChange, step = 0.0001, suffix }) {
  return (
    <label className="block">
      <div className="text-[11px] uppercase tracking-wider text-white/55 font-bold">{label}</div>
      <div className="flex items-center gap-2 mt-1">
        <input
          type="number"
          step={step}
          value={value ?? ''}
          onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
          className="flex-1 bg-surface-dark border border-white/10 rounded-lg px-3 py-2 text-sm font-mono text-white focus:outline-none focus:border-gold-light/50"
        />
        {suffix && <span className="text-[11px] text-white/45">{suffix}</span>}
      </div>
      {hint && <div className="text-[11px] text-white/45 mt-1">{hint}</div>}
    </label>
  );
}

export default function FuturesOverviewPage() {
  const [overview, setOverview] = useState(null);
  const [controls, setControls] = useState(null);
  const [marks,    setMarks]    = useState([]);
  const [loading, setLoading]   = useState(true);
  const [saving, setSaving]     = useState(false);
  const [savedAt, setSavedAt]   = useState(null);
  const [error, setError]       = useState(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [oRes, cRes, mRes] = await Promise.all([
        api.futures.overview(),
        api.futures.getControls(),
        api.futures.listMarks(),
      ]);
      const oj = await oRes.json(); const cj = await cRes.json(); const mj = await mRes.json();
      if (!oRes.ok) throw new Error(oj.detail || 'overview failed');
      if (!cRes.ok) throw new Error(cj.detail || 'controls failed');
      setOverview(oj); setControls(cj);
      if (mRes.ok) setMarks(mj.marks || []);
    } catch (e) {
      setError(e.message || 'failed to load');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const t = setInterval(load, 15000); return () => clearInterval(t);
  }, [load]);

  const patch = async (next) => {
    setSaving(true); setError(null);
    try {
      const res = await api.futures.patchControls(next);
      const j = await res.json();
      if (!res.ok) throw new Error(j.detail || 'patch failed');
      setControls(j); setSavedAt(new Date());
    } catch (e) { setError(e.message || 'failed to save'); }
    finally { setSaving(false); }
  };

  if (loading && !overview) return (
    <div className="flex items-center justify-center py-24 text-white/50 gap-2">
      <RefreshCw size={16} className="animate-spin" /> Loading futures overview…
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-end gap-3 text-[12px] text-white/40">
        {savedAt && <span>saved {savedAt.toLocaleTimeString()}</span>}
        <button onClick={load} className="text-white/70 hover:text-white" title="Refresh">
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {error && (
        <div className="rounded-xl border border-rose-400/30 bg-rose-500/10 text-rose-300 px-4 py-3 text-sm flex items-center gap-2">
          <AlertTriangle size={14} /> {error}
        </div>
      )}

      {/* Metrics */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard icon={Banknote}  label="Open interest"      value={fmtUsd(overview?.total_oi)} hint={`Long ${fmtUsd(overview?.long_oi)} · Short ${fmtUsd(overview?.short_oi)}`} />
        <StatCard icon={Scale}     label="Skew (long − short)" value={fmtUsd(overview?.skew)} accent={Number(overview?.skew) >= 0 ? 'text-emerald-300' : 'text-rose-300'} />
        <StatCard icon={ShieldCheck} label="Margin locked"     value={fmtUsd(overview?.total_margin_locked)} hint={`User wallets: ${fmtUsd(overview?.wallet_total_available)} avail / ${fmtUsd(overview?.wallet_total_locked)} locked`} />
        <StatCard icon={BarChart3} label="Open positions"     value={fmtNum(overview?.open_positions)} hint={`Open orders ${fmtNum(overview?.open_orders)}`} />

        <StatCard icon={TrendingUp}   label="24h volume"      value={fmtUsd(overview?.volume_24h)} hint={`${fmtNum(overview?.trades_24h)} trades`} />
        <StatCard icon={TrendingDown} label="24h liquidations" value={fmtNum(overview?.liquidations_24h)} hint={`Burned ${fmtUsd(overview?.liquidation_burned_24h)}`} accent="text-rose-300" />
        <StatCard icon={Zap}          label="24h fees collected" value={fmtUsd(overview?.fees_paid_24h)} accent="text-gold-light" />
        <StatCard icon={ArrowLeftRight} label="24h funding"   value={`${fmtUsd(overview?.funding_received_24h)} → users / ${fmtUsd(overview?.funding_paid_24h)} ← users`} hint="Net is the platform's exposure" />
      </div>

      {/* Per-symbol */}
      <div className="rounded-2xl border border-surface-border bg-surface-card overflow-hidden">
        <div className="px-4 py-3 border-b border-white/10 text-sm font-bold text-white">Per-symbol breakdown</div>
        <table className="w-full text-sm">
          <thead className="text-[11px] uppercase tracking-wider text-white/45">
            <tr className="border-b border-white/5">
              <th className="text-left  px-4 py-2">Symbol</th>
              <th className="text-right px-4 py-2">Open positions</th>
              <th className="text-right px-4 py-2">Long OI</th>
              <th className="text-right px-4 py-2">Short OI</th>
              <th className="text-right px-4 py-2">Total OI</th>
              <th className="text-right px-4 py-2">24h volume</th>
              <th className="text-right px-4 py-2">24h trades</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(overview?.per_symbol || {}).map(([sym, s]) => (
              <tr key={sym} className="border-b border-white/5 hover:bg-white/[.02]">
                <td className="px-4 py-2 font-bold text-white">{sym}</td>
                <td className="px-4 py-2 text-right font-mono">{fmtNum(s.open_positions)}</td>
                <td className="px-4 py-2 text-right font-mono text-emerald-300">{fmtUsd(s.long_oi)}</td>
                <td className="px-4 py-2 text-right font-mono text-rose-300">{fmtUsd(s.short_oi)}</td>
                <td className="px-4 py-2 text-right font-mono">{fmtUsd(s.open_interest)}</td>
                <td className="px-4 py-2 text-right font-mono">{fmtUsd(s.volume_24h)}</td>
                <td className="px-4 py-2 text-right font-mono">{fmtNum(s.trades_24h)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Live mark prices */}
      {marks.length > 0 && (
        <div className="rounded-2xl border border-surface-border bg-surface-card overflow-hidden">
          <div className="px-4 py-3 border-b border-white/10 text-sm font-bold text-white flex items-center justify-between">
            <span>Live mark prices</span>
            <span className="text-[11px] text-white/40 font-normal">Updated every ~5 s by the mark-price worker</span>
          </div>
          <table className="w-full text-sm">
            <thead className="text-[11px] uppercase tracking-wider text-white/45">
              <tr className="border-b border-white/5">
                <th className="text-left  px-4 py-2">Symbol</th>
                <th className="text-right px-4 py-2">Mark price</th>
                <th className="text-right px-4 py-2">Index price</th>
                <th className="text-right px-4 py-2">Basis (mark−index)</th>
                <th className="text-right px-4 py-2">Age</th>
              </tr>
            </thead>
            <tbody>
              {marks.map((m) => {
                const mark  = Number(m.mark_price  || 0);
                const index = Number(m.index_price || 0);
                const basis = mark && index ? mark - index : null;
                const basisPct = index > 0 && basis !== null ? (basis / index) * 100 : null;
                const ageSec = m.ts ? Math.round(Date.now() / 1000 - m.ts) : null;
                return (
                  <tr key={m.symbol} className="border-b border-white/5 hover:bg-white/[.02]">
                    <td className="px-4 py-2 font-bold text-white">{m.symbol}</td>
                    <td className="px-4 py-2 text-right font-mono text-gold-light">
                      ${fmtUsd(mark).replace('$', '')}
                    </td>
                    <td className="px-4 py-2 text-right font-mono text-white/70">
                      {index > 0 ? `$${fmtUsd(index).replace('$', '')}` : '—'}
                    </td>
                    <td className={`px-4 py-2 text-right font-mono ${basis !== null ? (basis >= 0 ? 'text-emerald-300' : 'text-rose-300') : ''}`}>
                      {basis !== null ? `${basis >= 0 ? '+' : ''}${basis.toFixed(2)} (${basisPct >= 0 ? '+' : ''}${basisPct?.toFixed(4)}%)` : '—'}
                    </td>
                    <td className={`px-4 py-2 text-right text-[12px] ${ageSec !== null && ageSec > 30 ? 'text-rose-300' : 'text-white/50'}`}>
                      {ageSec !== null ? `${ageSec}s ago` : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Controls */}
      {controls && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          <div className="rounded-2xl border border-surface-border bg-surface-card p-4">
            <div className="flex items-center gap-2 text-sm font-bold text-white mb-1">
              <Power size={14} /> Engine status
            </div>
            <p className="text-[12px] text-white/45 mb-3">Master switches — all changes are written to <code>platform_controls</code> and audited.</p>
            <ToggleRow
              label="Futures module enabled"
              hint="Hard kill switch. When OFF every futures endpoint returns 503-style errors and workers idle."
              value={!!controls.futures_enabled}
              onChange={(v) => patch({ futures_enabled: v })}
              danger
            />
            <ToggleRow
              label="Pause all trading"
              hint="Existing positions stay open; new orders, cancels, and matching are blocked."
              value={!!controls.futures_trading_paused}
              onChange={(v) => patch({ futures_trading_paused: v })}
            />
            <ToggleRow
              label="Pause new orders only"
              hint="Existing book and orders unaffected; only `POST /orders` is blocked."
              value={!!controls.futures_new_orders_paused}
              onChange={(v) => patch({ futures_new_orders_paused: v })}
            />
            <ToggleRow
              label="Pause spot ↔ futures transfers"
              hint="Users cannot move USDT in or out until you re-enable."
              value={!!controls.futures_transfers_paused}
              onChange={(v) => patch({ futures_transfers_paused: v })}
            />
            <ToggleRow
              label="Allow synthetic SYSTEM fills"
              hint="When OFF, market orders that walk past the book are rejected (no synthetic mark-priced fill)."
              value={!!controls.futures_synthetic_fills_enabled}
              onChange={(v) => patch({ futures_synthetic_fills_enabled: v })}
            />
          </div>

          <div className="rounded-2xl border border-surface-border bg-surface-card p-4 space-y-3">
            <div className="flex items-center gap-2 text-sm font-bold text-white">
              <PauseCircle size={14} /> Limits & fees
            </div>
            <div className="grid grid-cols-2 gap-3">
              <NumField
                label="Max leverage cap (global)"
                hint="Tighter than any per-symbol max."
                value={controls.futures_max_leverage_cap}
                onChange={(v) => patch({ futures_max_leverage_cap: v })}
                step={1}
                suffix="x"
              />
              <NumField
                label="Min order notional"
                hint="Reject orders below this USD value."
                value={controls.futures_min_notional_usdt}
                onChange={(v) => patch({ futures_min_notional_usdt: v })}
                step={1}
                suffix="USDT"
              />
              <NumField
                label="Maker fee rate"
                hint="% of fill notional — debited in IBO from spot wallet."
                value={controls.futures_maker_fee_rate}
                onChange={(v) => patch({ futures_maker_fee_rate: v })}
                step={0.0001}
                suffix={fmtPct(controls.futures_maker_fee_rate)}
              />
              <NumField
                label="Taker fee rate"
                hint="% of fill notional — debited in IBO from spot wallet."
                value={controls.futures_taker_fee_rate}
                onChange={(v) => patch({ futures_taker_fee_rate: v })}
                step={0.0001}
                suffix={fmtPct(controls.futures_taker_fee_rate)}
              />
              <NumField
                label="Liquidation fee rate"
                hint="% of position notional at liquidation — debited in IBO."
                value={controls.futures_liquidation_fee_rate}
                onChange={(v) => patch({ futures_liquidation_fee_rate: v })}
                step={0.0001}
                suffix={fmtPct(controls.futures_liquidation_fee_rate)}
              />
              <NumField
                label="Funding cap (per period)"
                value={controls.futures_funding_cap}
                onChange={(v) => patch({ futures_funding_cap: v })}
                step={0.0001}
                suffix={fmtPct(controls.futures_funding_cap, 2)}
              />
              <NumField
                label="Mark blend: index weight"
                hint="0 = local mid only · 1 = Binance index only"
                value={controls.futures_mark_blend_index_weight}
                onChange={(v) => patch({ futures_mark_blend_index_weight: v })}
                step={0.05}
              />
            </div>
            {saving && <div className="text-[11px] text-white/45">saving…</div>}
          </div>
        </div>
      )}
    </div>
  );
}
