import { useCallback, useEffect, useState } from 'react';
import { RefreshCw, AlertTriangle, Database, Info } from 'lucide-react';
import { api } from '@/lib/api';
import { formatAdminApiDetail } from '@/lib/adminApiDetail';
import { AdminDataTable } from '@/components/AdminPrimitives';

function fmtCount(v) {
  if (v == null || v === '') return '—';
  const n = Number(v);
  if (!Number.isFinite(n)) return '—';
  return n.toLocaleString();
}

function fmtFeePct(x) {
  const n = Number(x);
  if (!Number.isFinite(n)) return '—';
  return `${(n * 100).toFixed(4)}%`;
}

function formatSettleTick(tick) {
  if (tick == null) return '—';
  if (typeof tick !== 'object') return String(tick);
  if (tick.skipped) return `Off · ${tick.reason || 'skipped'}`;
  const parts = [];
  if (tick.at) parts.push(String(tick.at).slice(0, 19).replace('T', ' '));
  if (tick.processed != null) parts.push(`processed ${tick.processed}`);
  if (tick.ok != null) parts.push(`ok ${tick.ok}`);
  if (tick.failed != null) parts.push(`failed ${tick.failed}`);
  if (parts.length) return parts.join(' · ');
  return JSON.stringify(tick);
}

function KvTable({ rows }) {
  return (
    <AdminDataTable fullBleed={false}>
      <tbody>
        {rows.map(([k, v]) => (
          <tr key={k}>
            <td className="w-[40%] sm:w-[36%] text-[11px] uppercase tracking-wider text-white/50 font-bold align-top">
              {k}
            </td>
            <td className="text-white/90 align-top">
              <div
                className={`text-sm break-words [overflow-wrap:anywhere] ${
                  typeof v === 'string' || typeof v === 'number' ? 'font-mono tabular-nums' : ''
                }`}
              >
                {v}
              </div>
            </td>
          </tr>
        ))}
      </tbody>
    </AdminDataTable>
  );
}

export default function OptionsOverviewPage() {
  const [overview, setOverview] = useState(null);
  const [controls, setControls] = useState(null);
  const [feeSink, setFeeSink] = useState(null);
  const [feeTaker, setFeeTaker] = useState('');
  const [feeMaker, setFeeMaker] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [seedResult, setSeedResult] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [oRes, cRes, fsRes] = await Promise.all([
        api.options.overview(),
        api.options.getControls(),
        api.options.feeSinkWallet(),
      ]);
      const o = await oRes.json().catch(() => ({}));
      const c = await cRes.json().catch(() => ({}));
      if (!oRes.ok) throw new Error(formatAdminApiDetail(o) || `Overview failed (${oRes.status})`);
      if (!cRes.ok) throw new Error(formatAdminApiDetail(c) || `Controls failed (${cRes.status})`);
      setOverview(o);
      setControls(c);
      if (fsRes.ok) {
        setFeeSink(await fsRes.json().catch(() => null));
      } else {
        setFeeSink(null);
      }
    } catch (e) {
      setError(e.message || 'Load failed');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!controls) return;
    const t = controls.options_taker_fee_rate;
    const m = controls.options_maker_fee_rate;
    setFeeTaker(t == null || t === '' ? '' : String(t));
    setFeeMaker(m == null || m === '' ? '' : String(m));
  }, [controls]);

  const patch = async (patchBody) => {
    setSaving(true);
    setError(null);
    try {
      const res = await api.options.patchControls(patchBody);
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(formatAdminApiDetail(j) || 'Save failed');
      setControls(j);
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const applyFeeOverrides = async () => {
    const body = {};
    const tt = feeTaker.trim();
    const mm = feeMaker.trim();
    if (tt !== '') {
      const x = Number(tt);
      if (!Number.isFinite(x) || x < 0 || x > 0.1) {
        setError('Taker fee must be a number between 0 and 0.1');
        return;
      }
      body.options_taker_fee_rate = x;
    }
    if (mm !== '') {
      const x = Number(mm);
      if (!Number.isFinite(x) || x < -0.05 || x > 0.1) {
        setError('Maker fee must be a number between -0.05 and 0.1');
        return;
      }
      body.options_maker_fee_rate = x;
    }
    if (!Object.keys(body).length) {
      setError('Enter at least one fee rate, or use Reset to defaults.');
      return;
    }
    await patch(body);
    await load();
  };

  const resetFeesToDefaults = async () => {
    const d = overview?.defaults_fee_rates;
    if (!d) return;
    await patch({
      options_taker_fee_rate: Number(d.taker),
      options_maker_fee_rate: Number(d.maker),
    });
    await load();
  };

  const seedDemo = async () => {
    if (
      !window.confirm(
        'Seed demo options (BTCUSDT/ETHUSDT by default)? Full strike ladder per expiry; idempotent.',
      )
    )
      return;
    setSaving(true);
    setError(null);
    setSeedResult(null);
    try {
      const res = await api.options.seedDemoData({});
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(formatAdminApiDetail(j) || `Seed failed (${res.status})`);
      setSeedResult(j);
      await load();
    } catch (e) {
      setError(e.message || 'Seed failed');
    } finally {
      setSaving(false);
    }
  };

  if (loading && !overview) {
    return (
      <div className="rounded-xl border border-white/10 bg-surface-dark py-16 text-center text-white/50 text-sm">
        Loading options overview…
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {error && (
        <div className="rounded-xl border border-rose-400/30 bg-rose-500/10 text-rose-200 px-4 py-3 text-sm flex items-start gap-2">
          <AlertTriangle size={18} className="shrink-0 mt-0.5" />
          <span className="break-words">{error}</span>
        </div>
      )}

      {seedResult && (
        <div className="rounded-xl border border-emerald-400/30 bg-emerald-500/10 px-4 py-3 text-sm">
          <div className="flex items-center justify-between gap-2 mb-2">
            <span className="text-[11px] uppercase tracking-wider font-bold text-emerald-200/90">Seed result</span>
            <button
              type="button"
              onClick={() => setSeedResult(null)}
              className="text-[11px] text-white/50 hover:text-white"
            >
              Dismiss
            </button>
          </div>
          <KvTable
            rows={[
              ...(seedResult.summary ? [['Summary', seedResult.summary]] : []),
              ['+Underlyings', fmtCount(seedResult.created_underlyings)],
              ['+Contracts', fmtCount(seedResult.created_contracts)],
              ...(seedResult.totals_for_symbols
                ? [
                    [
                      'DB totals (symbols)',
                      `${fmtCount(seedResult.totals_for_symbols.underlyings)} ul · ${fmtCount(seedResult.totals_for_symbols.contracts)} ct`,
                    ],
                  ]
                : []),
              ...(seedResult.errors?.length
                ? [['Errors', seedResult.errors.join(' · ')]]
                : []),
              ...(seedResult.contract_other_failures?.length
                ? [['Failures', seedResult.contract_other_failures.slice(0, 8).join(' · ')]]
                : []),
            ]}
          />
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={saving}
            onClick={seedDemo}
            className="inline-flex items-center gap-2 rounded-lg bg-emerald-600/25 border border-emerald-400/35 px-3 py-2 text-xs font-bold text-emerald-200 hover:bg-emerald-600/35 disabled:opacity-50"
          >
            <Database size={15} /> Seed demo (DB)
          </button>
          <button
            type="button"
            onClick={load}
            className="inline-flex items-center gap-2 rounded-lg border border-white/15 px-3 py-2 text-xs font-bold text-white/70 hover:bg-white/5"
            aria-label="Refresh"
          >
            <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
            Refresh
          </button>
        </div>
      </div>

      {overview && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {[
            ['Underlyings', overview.underlyings],
            ['Contracts', overview.contracts],
            ['Open orders', overview.open_orders],
            ['Open positions', overview.open_positions],
          ].map(([label, val]) => (
            <div
              key={label}
              className="rounded-xl border border-white/[0.08] bg-surface-dark px-4 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]"
            >
              <p className="text-[11px] uppercase tracking-wider text-white/45 font-bold">{label}</p>
              <p className="text-2xl font-extrabold text-white mt-1 tabular-nums">{fmtCount(val)}</p>
            </div>
          ))}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        {overview?.effective_fee_rates && (
          <div className="rounded-xl border border-white/[0.08] bg-surface-dark p-4 space-y-3">
            <div className="flex items-center gap-2">
              <span className="text-[11px] uppercase tracking-wider text-white/50 font-bold">Effective fees</span>
              <span
                className="inline-flex text-white/35 hover:text-white/55 cursor-help"
                title="Applied to premium notional (limit × contracts). Negative maker rebates need OPTIONS_FEE_SINK_UID."
              >
                <Info size={14} />
              </span>
            </div>
            <KvTable
              rows={[
                ['Taker', fmtFeePct(overview.effective_fee_rates.taker)],
                ['Maker', fmtFeePct(overview.effective_fee_rates.maker)],
              ]}
            />
            {overview.defaults_fee_rates && (
              <p className="text-xs text-white/40">
                Code defaults: taker {fmtFeePct(overview.defaults_fee_rates.taker)} · maker{' '}
                {fmtFeePct(overview.defaults_fee_rates.maker)}
              </p>
            )}
          </div>
        )}

        {feeSink?.enabled && feeSink.wallet && (
          <div className="rounded-xl border border-white/[0.08] bg-surface-dark p-4 space-y-3">
            <span className="text-[11px] uppercase tracking-wider text-white/50 font-bold">Fee sink wallet</span>
            <KvTable
              rows={[
                ['UID', String(feeSink.uid ?? '—')],
                [
                  'Balance (USDT)',
                  `${Number(feeSink.wallet.wallet_balance ?? 0).toLocaleString(undefined, { maximumFractionDigits: 8 })}`,
                ],
                [
                  'Available',
                  `${Number(feeSink.wallet.available ?? 0).toLocaleString(undefined, { maximumFractionDigits: 8 })}`,
                ],
                [
                  'Locked',
                  `${Number(feeSink.wallet.locked ?? 0).toLocaleString(undefined, { maximumFractionDigits: 8 })}`,
                ],
              ]}
            />
          </div>
        )}
      </div>

      {feeSink && feeSink.enabled === false && (
        <div className="rounded-xl border border-gold/25 bg-gold/10 px-4 py-3 text-sm text-gold-light/90/90">
          Fee sink is off. Set{' '}
          <code className="bg-surface-dark px-1.5 py-0.5 rounded font-mono text-xs">OPTIONS_FEE_SINK_UID</code> to route
          fees to a dedicated wallet.
        </div>
      )}

      {overview?.ops && (
        <div className="rounded-xl border border-white/[0.08] bg-surface-dark p-4 space-y-3">
          <span className="text-[11px] uppercase tracking-wider text-white/50 font-bold">Runtime & settlement</span>
          <KvTable
            rows={[
              [
                'Mongo multi-doc transactions',
                overview.ops.mongo_multi_document_transactions ? 'Yes' : 'No (replica set required)',
              ],
              ['Match lock shards', fmtCount(overview.ops.match_lock_shard_count)],
              ['Fee sink env', overview.ops.fee_sink_configured ? 'Configured' : 'Not set'],
              ['Last auto-settle tick', formatSettleTick(overview.ops.last_auto_settle_tick)],
            ]}
          />
        </div>
      )}

      {controls && (
        <div className="rounded-xl border border-white/[0.08] bg-surface-dark p-4 space-y-5 max-w-3xl">
          <h2 className="text-sm font-bold text-white">Platform controls</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {[
              { key: 'options_enabled', label: 'Options enabled' },
              { key: 'options_trading_paused', label: 'Trading paused' },
              { key: 'options_new_orders_paused', label: 'New orders paused' },
              { key: 'options_transfers_paused', label: 'Transfers paused' },
            ].map(({ key, label }) => (
              <label
                key={key}
                className="flex items-center justify-between gap-3 rounded-lg border border-white/10 bg-surface-dark px-3 py-3 cursor-pointer hover:border-white/15"
              >
                <span className="text-sm text-white/90">{label}</span>
                <input
                  type="checkbox"
                  checked={!!controls[key]}
                  disabled={saving}
                  onChange={(e) => patch({ [key]: e.target.checked })}
                  className="w-5 h-5 accent-gold shrink-0"
                />
              </label>
            ))}
          </div>

          <div className="pt-4 border-t border-white/10 space-y-3">
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-bold text-white/50 uppercase tracking-wider">Fee overrides</span>
              <span
                className="inline-flex text-white/35 hover:text-white/55 cursor-help"
                title="Stored in platform_controls. Taker fees debit Delta from spot wallet; negative maker rates pay USDT rebate on the options ledger."
              >
                <Info size={13} />
              </span>
            </div>
            <p className="text-[11px] text-white/45 leading-relaxed">
              Taker fee: % of premium — settled in Delta. Maker rebate (negative rate): USDT on options ledger.
            </p>
            <div className="flex flex-wrap items-end gap-3">
              <label className="block text-xs min-w-[8rem]">
                <span className="text-white/50">Taker (0–0.1)</span>
                <input
                  type="text"
                  value={feeTaker}
                  onChange={(e) => setFeeTaker(e.target.value)}
                  placeholder="0.0005"
                  className="mt-1 block w-full rounded-lg bg-surface-card border border-white/15 px-2 py-2 font-mono text-sm text-white tabular-nums"
                />
              </label>
              <label className="block text-xs min-w-[8rem]">
                <span className="text-white/50">Maker (−0.05–0.1)</span>
                <input
                  type="text"
                  value={feeMaker}
                  onChange={(e) => setFeeMaker(e.target.value)}
                  placeholder="-0.0001"
                  className="mt-1 block w-full rounded-lg bg-surface-card border border-white/15 px-2 py-2 font-mono text-sm text-white tabular-nums"
                />
              </label>
              <button
                type="button"
                disabled={saving}
                onClick={() => applyFeeOverrides()}
                className="rounded-lg bg-gold/20 border border-gold/40 px-3 py-2 text-xs font-bold text-gold-light hover:bg-gold/30 disabled:opacity-50"
              >
                Save fees
              </button>
              <button
                type="button"
                disabled={saving || !overview?.defaults_fee_rates}
                onClick={() => resetFeesToDefaults()}
                className="rounded-lg border border-white/15 px-3 py-2 text-xs font-bold text-white/70 hover:bg-white/5 disabled:opacity-50"
              >
                Reset defaults
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={async () => {
                  setSaving(true);
                  setError(null);
                  try {
                    const res = await api.options.patchControls({ options_clear_fee_overrides: true });
                    const j = await res.json().catch(() => ({}));
                    if (!res.ok) throw new Error(formatAdminApiDetail(j) || 'Clear failed');
                    setControls(j);
                    await load();
                  } catch (e) {
                    setError(e.message || 'Clear failed');
                  } finally {
                    setSaving(false);
                  }
                }}
                className="rounded-lg border border-zinc-500/40 px-3 py-2 text-xs font-bold text-white/60 hover:bg-white/5 disabled:opacity-50"
              >
                Clear overrides
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
