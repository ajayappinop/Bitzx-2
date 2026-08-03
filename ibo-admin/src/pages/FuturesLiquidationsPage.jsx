import { useCallback, useEffect, useState } from 'react';
import { RefreshCw, AlertTriangle } from 'lucide-react';
import { api } from '@/lib/api';

const fmt = (v, dp = 4) => Number.isFinite(Number(v)) ? Number(v).toLocaleString(undefined, { maximumFractionDigits: dp }) : '—';

export default function FuturesLiquidationsPage() {
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filters, setFilters] = useState({ symbol: '', uid: '' });
  const [skip, setSkip] = useState(0);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const res = await api.futures.listLiquidations({ ...filters, limit: 100, skip });
      const j = await res.json();
      if (!res.ok) throw new Error(j.detail || 'load failed');
      setRows(j.liquidations || []); setTotal(j.total || 0);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }, [filters, skip]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-end flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <input placeholder="Symbol" value={filters.symbol}
            onChange={(e) => setFilters((f) => ({ ...f, symbol: e.target.value.toUpperCase() }))}
            className="bg-surface-card border border-surface-border rounded-lg px-3 py-1.5 text-sm" />
          <input placeholder="UID" value={filters.uid}
            onChange={(e) => setFilters((f) => ({ ...f, uid: e.target.value }))}
            className="bg-surface-card border border-surface-border rounded-lg px-3 py-1.5 text-sm" />
          <button onClick={() => { setSkip(0); load(); }}
            className="px-3 py-1.5 rounded-lg bg-gold-light/15 text-gold-light border border-gold-light/30 text-sm font-bold">
            Apply
          </button>
          <button onClick={load} className="text-white/60 hover:text-white">
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-rose-400/30 bg-rose-500/10 text-rose-300 px-4 py-2 text-sm flex items-center gap-2">
          <AlertTriangle size={14} /> {error}
        </div>
      )}

      <div className="rounded-2xl border border-surface-border bg-surface-card overflow-x-auto">
        <table className="w-full text-sm min-w-[1000px]">
          <thead className="text-[11px] uppercase tracking-wider text-white/45">
            <tr className="border-b border-white/5">
              <th className="text-left px-3 py-2">Time</th>
              <th className="text-left px-3 py-2">User</th>
              <th className="text-left px-3 py-2">Symbol</th>
              <th className="text-left px-3 py-2">Side</th>
              <th className="text-right px-3 py-2">Qty</th>
              <th className="text-right px-3 py-2">Entry</th>
              <th className="text-right px-3 py-2">Mark</th>
              <th className="text-right px-3 py-2">Realized PnL</th>
              <th className="text-right px-3 py-2">Fee</th>
              <th className="text-right px-3 py-2">Margin lost</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && !loading && (
              <tr><td colSpan={10} className="px-4 py-10 text-center text-white/40">No liquidations on record.</td></tr>
            )}
            {rows.map((l) => (
              <tr key={l.id} className="border-b border-white/5 hover:bg-white/[.02]">
                <td className="px-3 py-2 text-[12px] text-white/55 font-mono">{(l.created_at || '').slice(0, 19).replace('T', ' ')}</td>
                <td className="px-3 py-2 text-[12px] font-mono text-white/80">{l.uid}</td>
                <td className="px-3 py-2 font-bold">{l.symbol}</td>
                <td className={`px-3 py-2 font-extrabold ${l.side === 'long' ? 'text-emerald-300' : 'text-rose-300'}`}>{l.side?.toUpperCase()}</td>
                <td className="px-3 py-2 text-right font-mono">{fmt(l.qty)}</td>
                <td className="px-3 py-2 text-right font-mono">${fmt(l.entry_price, 2)}</td>
                <td className="px-3 py-2 text-right font-mono">${fmt(l.mark_price, 2)}</td>
                <td className={`px-3 py-2 text-right font-mono ${Number(l.realized_pnl) < 0 ? 'text-rose-300' : 'text-emerald-300'}`}>
                  {Number(l.realized_pnl) >= 0 ? '+' : ''}{fmt(l.realized_pnl, 2)}
                </td>
                <td className="px-3 py-2 text-right font-mono text-gold-light">${fmt(l.fee, 2)}</td>
                <td className="px-3 py-2 text-right font-mono">${fmt(l.isolated_margin, 2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between text-sm text-white/55">
        <span>{total} total · showing {skip + 1}–{Math.min(skip + rows.length, total)}</span>
        <div className="flex gap-2">
          <button disabled={skip === 0} onClick={() => setSkip((s) => Math.max(0, s - 100))}
            className="px-3 py-1 rounded bg-white/5 hover:bg-white/10 disabled:opacity-30">Prev</button>
          <button disabled={skip + rows.length >= total} onClick={() => setSkip((s) => s + 100)}
            className="px-3 py-1 rounded bg-white/5 hover:bg-white/10 disabled:opacity-30">Next</button>
        </div>
      </div>
    </div>
  );
}
