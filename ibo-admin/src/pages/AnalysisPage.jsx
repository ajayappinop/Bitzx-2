import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { BarChart3, Filter } from 'lucide-react';
import { api } from '@/lib/api';
import CoinAvatar from '@/components/CoinAvatar';
import { AdminPageHeader, GradientStatCard, FilterBar, AdminDataTable } from '@/components/AdminPrimitives';

const DAY_OPTS = [7, 14, 30, 60, 90, 120];

function daySelectOptions(current) {
  const s = new Set(DAY_OPTS);
  s.add(current);
  return [...s].sort((a, b) => a - b);
}

function formatVol(n) {
  if (n == null) return '—';
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(2)}K`;
  return Number(n).toLocaleString(undefined, { maximumFractionDigits: 2 });
}

export default function AnalysisPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const rawDays = Number(searchParams.get('days') || '30') || 30;
  const days = Math.min(120, Math.max(1, rawDays));
  const symbol = (searchParams.get('symbol') || '').trim().toUpperCase();

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [symInput, setSymInput] = useState(symbol);

  useEffect(() => {
    setSymInput(symbol);
  }, [symbol]);

  const load = useCallback(async () => {
    setLoading(true);
    setErr('');
    try {
      const params = { days: String(days) };
      if (symbol) params.symbol = symbol;
      const r = await api.analytics(params);
      if (!r.ok) throw new Error('Failed to load analytics');
      setData(await r.json());
    } catch {
      setData(null);
      setErr('Could not load analytics.');
    } finally {
      setLoading(false);
    }
  }, [days, symbol]);

  useEffect(() => {
    load();
  }, [load]);

  const applyFilters = () => {
    const p = new URLSearchParams();
    p.set('days', String(days));
    if (symInput.trim()) p.set('symbol', symInput.trim().toUpperCase());
    setSearchParams(p, { replace: true });
  };

  const daily = data?.daily || [];
  const maxTrades = Math.max(1, ...daily.map(d => d.trades || 0));
  const maxVol = Math.max(1, ...daily.map(d => d.volume_usdt || 0));

  return (
    <div className="admin-page">
      <AdminPageHeader
        icon={BarChart3}
        title="Reports & Analytics"
        subtitle="Daily volume, trade counts, and fees in USDT. Filter by date range and optionally by trading pair."
      />

      <FilterBar className="mb-6">
        <p className="text-base font-semibold text-white mb-3 flex items-center gap-2">
          <Filter size={14} /> Pick a range and coin
        </p>
        <div className="flex flex-col sm:flex-row gap-3 flex-wrap min-w-0">
          <select
            value={String(days)}
            onChange={e => {
              const p = new URLSearchParams(searchParams);
              p.set('days', e.target.value);
              setSearchParams(p, { replace: true });
            }}
            className="rounded-xl bg-surface-dark border border-surface-border px-4 py-3 text-white font-bold text-sm w-full sm:w-auto sm:min-w-[140px] min-w-0"
          >
            {daySelectOptions(days).map(d => (
              <option key={d} value={d}>Last {d} days</option>
            ))}
          </select>
          <input
            value={symInput}
            onChange={e => setSymInput(e.target.value)}
            placeholder="Symbol filter (optional, e.g. BTCUSDT)"
            className="flex-1 min-w-0 sm:min-w-[200px] rounded-xl bg-surface-dark border border-surface-border px-4 py-2.5 text-white font-mono text-sm uppercase"
          />
          <button
            type="button"
            onClick={applyFilters}
            className="w-full sm:w-auto px-5 py-2.5 rounded-xl bg-gold/20 border border-gold/35 text-gold-light font-bold text-sm"
          >
            Apply
          </button>
          <button
            type="button"
            onClick={() => {
              setSymInput('');
              const p = new URLSearchParams();
              p.set('days', String(days));
              setSearchParams(p, { replace: true });
            }}
            className="w-full sm:w-auto px-4 py-2.5 rounded-xl border border-surface-border text-white/80 text-sm font-bold"
          >
            Clear symbol
          </button>
        </div>
      </FilterBar>

      {err && <p className="text-red-400 text-sm mb-4">{err}</p>}

      {loading ? (
        <div className="flex justify-center py-24">
          <div className="w-10 h-10 border-2 border-gold border-t-transparent rounded-full animate-spin" />
        </div>
      ) : data && (
        <>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
            <GradientStatCard label="Trading days" value={daily.length} tone="violet" />
            <GradientStatCard label="Total trades (window)" value={daily.reduce((s, d) => s + (d.trades || 0), 0).toLocaleString()} tone="cyan" />
            <GradientStatCard label="Notional volume (window)" value={formatVol(daily.reduce((s, d) => s + (d.volume_usdt || 0), 0))} tone="emerald" />
          </div>

          <h2 className="text-lg font-extrabold text-white mb-3">Daily trades</h2>
          <div className="rounded-2xl border border-surface-border bg-surface-card p-4 mb-8 adm-table-x scrollbar-thin min-w-0">
            <div className="flex items-end gap-1 min-w-[min(100%,720px)] h-40 px-1">
              {daily.length === 0 ? (
                <p className="text-white/45 text-sm py-8">No trades in this window{symbol ? ` for ${symbol}` : ''}.</p>
              ) : (
                daily.map(d => (
                  <div key={d.date} className="flex-1 min-w-[6px] flex flex-col items-center justify-end group">
                    <div
                      className="w-full max-w-[14px] rounded-t bg-gradient-to-t from-violet-600/40 to-violet-400/90 mx-auto transition-all group-hover:from-gold/30 group-hover:to-gold-light"
                      style={{ height: `${(d.trades / maxTrades) * 100}%`, minHeight: d.trades ? '4px' : 0 }}
                      title={`${d.date}: ${d.trades} trades`}
                    />
                  </div>
                ))
              )}
            </div>
            <p className="text-sm text-white/65 mt-2 text-center">Taller bar = more trades that day</p>
          </div>

          <h2 className="text-xl font-extrabold text-white mb-3">Daily trading volume (USDT)</h2>
          <div className="rounded-2xl border border-surface-border bg-surface-card p-4 mb-8 adm-table-x scrollbar-thin min-w-0">
            <div className="flex items-end gap-1 min-w-[min(100%,720px)] h-40 px-1">
              {daily.length === 0 ? null : (
                daily.map(d => (
                  <div key={`v-${d.date}`} className="flex-1 min-w-[6px] flex flex-col items-center justify-end">
                    <div
                      className="w-full max-w-[14px] rounded-t bg-gradient-to-t from-emerald-900/50 to-emerald-400/85 mx-auto"
                      style={{ height: `${(d.volume_usdt / maxVol) * 100}%`, minHeight: d.volume_usdt ? '4px' : 0 }}
                      title={`${d.date}: ${formatVol(d.volume_usdt)}`}
                    />
                  </div>
                ))
              )}
            </div>
          </div>

          <h2 className="text-xl font-extrabold text-white mb-3">Fees collected in this period</h2>
          <AdminDataTable>
            <thead>
              <tr>
                <th>Asset</th>
                <th className="text-right">Total fees</th>
              </tr>
            </thead>
            <tbody>
              {(data.fees_period || []).length === 0 ? (
                <tr><td colSpan={2} className="text-center text-white/45 py-8">No fees in period.</td></tr>
              ) : (
                data.fees_period.map(f => (
                  <tr key={f.asset}>
                    <td className="font-bold">
                      <span className="inline-flex items-center gap-2">
                        <CoinAvatar asset={f.asset} className="h-6 w-6" />
                        {f.asset}
                      </span>
                    </td>
                    <td className="text-right font-mono text-gold-light/90">{f.total}</td>
                  </tr>
                ))
              )}
            </tbody>
          </AdminDataTable>

          <div className="mt-6 flex flex-wrap gap-4 text-sm font-bold">
            <Link to="/treasury" className="text-gold-light hover:underline">Treasury &amp; flows →</Link>
            <Link to="/markets" className="text-gold-light hover:underline">Market charts →</Link>
          </div>
        </>
      )}
    </div>
  );
}
