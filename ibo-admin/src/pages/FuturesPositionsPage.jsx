import { useCallback, useEffect, useState } from 'react';
import { RefreshCw, X, AlertTriangle } from 'lucide-react';
import { api } from '@/lib/api';
import ConfirmModal from '@/components/ConfirmModal';

const fmt = (v, dp = 4) => Number.isFinite(Number(v)) ? Number(v).toLocaleString(undefined, { maximumFractionDigits: dp }) : '—';

export default function FuturesPositionsPage() {
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filters, setFilters] = useState({ status: 'open', symbol: '', uid: '' });
  const [skip, setSkip] = useState(0);
  const [confirm, setConfirm] = useState(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const params = { ...filters, limit: 100, skip };
      const res = await api.futures.listPositions(params);
      const j = await res.json();
      if (!res.ok) throw new Error(j.detail || 'load failed');
      setRows(j.positions || []); setTotal(j.total || 0);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }, [filters, skip]);

  useEffect(() => { load(); }, [load]);

  const forceClose = async (id) => {
    setError(null);
    try {
      const res = await api.futures.forceClosePosition(id, { reason: 'admin_force_close' });
      const j = await res.json();
      if (!res.ok) throw new Error(j.detail || 'force close failed');
      load();
    } catch (e) { setError(e.message); }
    setConfirm(null);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-end flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <select value={filters.status}
            onChange={(e) => { setFilters((f) => ({ ...f, status: e.target.value })); setSkip(0); }}
            className="bg-surface-card border border-surface-border rounded-lg px-3 py-1.5 text-sm">
            <option value="open">Open</option>
            <option value="closed">Closed</option>
          </select>
          <input placeholder="Symbol filter" value={filters.symbol}
            onChange={(e) => setFilters((f) => ({ ...f, symbol: e.target.value.toUpperCase() }))}
            className="bg-surface-card border border-surface-border rounded-lg px-3 py-1.5 text-sm" />
          <input placeholder="User UID" value={filters.uid}
            onChange={(e) => setFilters((f) => ({ ...f, uid: e.target.value }))}
            className="bg-surface-card border border-surface-border rounded-lg px-3 py-1.5 text-sm" />
          <button onClick={() => { setSkip(0); load(); }}
            className="px-3 py-1.5 rounded-lg bg-gold-light/15 text-gold-light border border-gold-light/30 text-sm font-bold">
            Apply
          </button>
          <button onClick={load} className="text-white/60 hover:text-white" title="Refresh">
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
        <table className="w-full text-sm min-w-[1200px]">
          <thead className="text-[11px] uppercase tracking-wider text-white/45">
            <tr className="border-b border-white/5">
              <th className="text-left  px-3 py-2">User</th>
              <th className="text-left  px-3 py-2">Symbol</th>
              <th className="text-left  px-3 py-2">Side</th>
              <th className="text-right px-3 py-2">Qty</th>
              <th className="text-right px-3 py-2">Entry</th>
              <th className="text-right px-3 py-2">Mark</th>
              <th className="text-right px-3 py-2">Lev</th>
              <th className="text-right px-3 py-2">Margin</th>
              <th className="text-right px-3 py-2">uPnL</th>
              <th className="text-right px-3 py-2">Liq.</th>
              <th className="text-left  px-3 py-2">Opened</th>
              <th className="text-left  px-3 py-2">Status</th>
              <th className="text-right px-3 py-2 pr-4">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && !loading && (
              <tr><td colSpan={13} className="px-4 py-12 text-center text-white/40">No positions match these filters.</td></tr>
            )}
            {rows.map((p) => {
              const upnl = Number(p.unrealized_pnl || 0);
              return (
                <tr key={p.id} className="border-b border-white/5 hover:bg-white/[.02]">
                  <td className="px-3 py-2 font-mono text-[12px] text-white/80">{p.uid}</td>
                  <td className="px-3 py-2 font-bold text-white">{p.symbol}</td>
                  <td className={`px-3 py-2 font-extrabold ${p.side === 'long' ? 'text-emerald-300' : 'text-rose-300'}`}>{p.side?.toUpperCase()}</td>
                  <td className="px-3 py-2 text-right font-mono">{fmt(Math.abs(p.qty))}</td>
                  <td className="px-3 py-2 text-right font-mono">${fmt(p.entry_price, 2)}</td>
                  <td className="px-3 py-2 text-right font-mono">${fmt(p.mark_price || p.entry_price, 2)}</td>
                  <td className="px-3 py-2 text-right font-mono">{p.leverage}×</td>
                  <td className="px-3 py-2 text-right font-mono">${fmt(p.isolated_margin, 2)}</td>
                  <td className={`px-3 py-2 text-right font-mono ${upnl > 0 ? 'text-emerald-300' : upnl < 0 ? 'text-rose-300' : ''}`}>
                    {upnl >= 0 ? '+' : ''}{fmt(upnl, 2)}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-gold-light">${fmt(p.liquidation_price, 2)}</td>
                  <td className="px-3 py-2 text-[12px] text-white/60">{(p.opened_at || p.closed_at || '').slice(0, 19).replace('T', ' ')}</td>
                  <td className="px-3 py-2 text-[12px] capitalize text-white/70">{p.status?.replace('_', ' ')}</td>
                  <td className="px-3 py-2 text-right pr-4">
                    {p.status === 'open' && (
                      <button onClick={() => setConfirm(p)}
                        className="px-2 py-1 rounded bg-rose-500/15 text-rose-300 border border-rose-400/30 hover:bg-rose-500/25 text-[12px] font-bold">
                        Force close
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between text-sm text-white/55">
        <span>{total} total · showing {skip + 1}–{Math.min(skip + rows.length, total)}</span>
        <div className="flex gap-2">
          <button disabled={skip === 0} onClick={() => setSkip((s) => Math.max(0, s - 100))}
            className="px-3 py-1 rounded bg-white/5 hover:bg-white/10 disabled:opacity-30">Prev</button>
          <button disabled={skip + rows.length >= total} onClick={() => setSkip((s) => s + 100)}
            className="px-3 py-1 rounded bg-white/5 hover:bg-white/10 disabled:opacity-30">Next</button>
        </div>
      </div>

      <ConfirmModal
        open={!!confirm}
        title={`Force close ${confirm?.symbol}?`}
        message={`This will close ${confirm?.uid}'s ${confirm?.side?.toUpperCase()} position at the current mark price and settle PnL+fees on their wallet. The action is logged with your admin email.`}
        confirmText="Force close"
        danger
        onConfirm={() => forceClose(confirm.id)}
        onClose={() => setConfirm(null)}
      />
    </div>
  );
}
