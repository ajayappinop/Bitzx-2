import { useCallback, useEffect, useState } from 'react';
import { RefreshCw, X, AlertTriangle } from 'lucide-react';
import { api } from '@/lib/api';

const fmt = (v, dp = 4) => Number.isFinite(Number(v)) ? Number(v).toLocaleString(undefined, { maximumFractionDigits: dp }) : '—';

export default function FuturesOrdersPage() {
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filters, setFilters] = useState({ status: 'open', symbol: '', uid: '' });
  const [skip, setSkip] = useState(0);
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const res = await api.futures.listOrders({ ...filters, limit: 100, skip });
      const j = await res.json();
      if (!res.ok) throw new Error(j.detail || 'load failed');
      setRows(j.orders || []); setTotal(j.total || 0);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }, [filters, skip]);

  useEffect(() => { load(); }, [load]);

  const cancel = async (id) => {
    setBusyId(id); setError(null);
    try {
      const res = await api.futures.cancelOrder(id);
      const j = await res.json();
      if (!res.ok) throw new Error(j.detail || 'cancel failed');
      load();
    } catch (e) { setError(e.message); }
    finally { setBusyId(null); }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-end flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <select value={filters.status}
            onChange={(e) => { setFilters((f) => ({ ...f, status: e.target.value })); setSkip(0); }}
            className="bg-surface-card border border-surface-border rounded-lg px-3 py-1.5 text-sm">
            <option value="open">Open / Partial</option>
            <option value="filled">Filled</option>
            <option value="cancelled">Cancelled</option>
            <option value="rejected">Rejected</option>
            <option value="">All</option>
          </select>
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
        <table className="w-full text-sm min-w-[1100px]">
          <thead className="text-[11px] uppercase tracking-wider text-white/45">
            <tr className="border-b border-white/5">
              <th className="text-left px-3 py-2">Time</th>
              <th className="text-left px-3 py-2">Order</th>
              <th className="text-left px-3 py-2">User</th>
              <th className="text-left px-3 py-2">Symbol</th>
              <th className="text-left px-3 py-2">Type</th>
              <th className="text-left px-3 py-2">Side</th>
              <th className="text-right px-3 py-2">Price</th>
              <th className="text-right px-3 py-2">Qty</th>
              <th className="text-right px-3 py-2">Filled</th>
              <th className="text-right px-3 py-2">Lev</th>
              <th className="text-left px-3 py-2">Status</th>
              <th className="text-right px-3 py-2 pr-4">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && !loading && (
              <tr><td colSpan={12} className="px-4 py-10 text-center text-white/40">No orders.</td></tr>
            )}
            {rows.map((o) => (
              <tr key={o.id} className="border-b border-white/5 hover:bg-white/[.02]">
                <td className="px-3 py-2 text-[12px] text-white/55 font-mono">{(o.created_at || '').slice(0, 19).replace('T', ' ')}</td>
                <td className="px-3 py-2 text-[11px] font-mono text-white/70">{o.id?.slice(0, 14)}…</td>
                <td className="px-3 py-2 text-[12px] font-mono text-white/80">{o.uid}</td>
                <td className="px-3 py-2 font-bold">{o.symbol}</td>
                <td className="px-3 py-2 capitalize text-white/70 text-[12px]">{o.type}</td>
                <td className={`px-3 py-2 font-extrabold ${o.side === 'buy' ? 'text-emerald-300' : 'text-rose-300'}`}>{o.side?.toUpperCase()}</td>
                <td className="px-3 py-2 text-right font-mono">{o.price ? `$${fmt(o.price, 2)}` : 'MKT'}</td>
                <td className="px-3 py-2 text-right font-mono">{fmt(o.quantity)}</td>
                <td className="px-3 py-2 text-right font-mono">{fmt(o.filled || 0)}</td>
                <td className="px-3 py-2 text-right font-mono">{o.leverage}×</td>
                <td className="px-3 py-2 text-[12px] capitalize text-white/70">{o.status?.replace('_', ' ')}</td>
                <td className="px-3 py-2 text-right pr-4">
                  {(o.status === 'open' || o.status === 'partially_filled') && (
                    <button disabled={busyId === o.id} onClick={() => cancel(o.id)}
                      className="px-2 py-1 rounded bg-rose-500/15 text-rose-300 border border-rose-400/30 hover:bg-rose-500/25 text-[12px] font-bold">
                      <X size={12} className="inline mr-0.5" /> Cancel
                    </button>
                  )}
                </td>
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
