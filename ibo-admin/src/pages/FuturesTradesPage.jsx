import { useCallback, useEffect, useState } from 'react';
import { RefreshCw, AlertTriangle } from 'lucide-react';
import { api } from '@/lib/api';
import { AdminDataTable } from '@/components/AdminPrimitives';

const fmt = (v, dp = 4) => Number.isFinite(Number(v)) ? Number(v).toLocaleString(undefined, { maximumFractionDigits: dp }) : '—';

export default function FuturesTradesPage() {
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filters, setFilters] = useState({ symbol: '', uid: '', synthetic: '' });
  const [skip, setSkip] = useState(0);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const params = { ...filters, limit: 200, skip };
      if (params.synthetic === '') delete params.synthetic;
      const res = await api.futures.listTrades(params);
      const j = await res.json();
      if (!res.ok) throw new Error(j.detail || 'load failed');
      setRows(j.trades || []); setTotal(j.total || 0);
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
          <select value={filters.synthetic}
            onChange={(e) => setFilters((f) => ({ ...f, synthetic: e.target.value }))}
            className="bg-surface-card border border-surface-border rounded-lg px-3 py-1.5 text-sm">
            <option value="">All trades</option>
            <option value="false">User vs user</option>
            <option value="true">SYSTEM (synthetic)</option>
          </select>
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

      <AdminDataTable minWidth="1100px">
        <thead>
          <tr>
            <th>Time</th>
            <th>Trade ID</th>
            <th>Symbol</th>
            <th>Side</th>
            <th className="text-right">Price</th>
            <th className="text-right">Qty</th>
            <th className="text-right">Notional</th>
            <th>Taker UID</th>
            <th>Maker UID</th>
            <th>Source</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && !loading && (
            <tr><td colSpan={10} className="text-center text-white/40">No trades.</td></tr>
          )}
          {rows.map((t) => (
            <tr key={t.id}>
              <td className="text-[12px] text-white/55 font-mono">{(t.created_at || '').slice(0, 19).replace('T', ' ')}</td>
              <td className="text-[11px] font-mono text-white/70">{t.id?.slice(0, 14)}…</td>
              <td className="font-bold">{t.symbol}</td>
              <td className={`font-extrabold ${t.side === 'buy' ? 'text-emerald-300' : 'text-rose-300'}`}>{t.side?.toUpperCase()}</td>
              <td className="text-right font-mono">${fmt(t.price, 2)}</td>
              <td className="text-right font-mono">{fmt(t.qty)}</td>
              <td className="text-right font-mono">${fmt(Number(t.price) * Number(t.qty), 2)}</td>
              <td className="text-[12px] font-mono text-white/80">{t.taker_uid}</td>
              <td className="text-[12px] font-mono text-white/80">{t.maker_uid}</td>
              <td className="text-[11px]">
                {t.synthetic
                  ? <span className="text-gold-light font-bold">SYNTH</span>
                  : <span className="text-emerald-300 font-bold">BOOK</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </AdminDataTable>

      <div className="flex items-center justify-between text-sm text-white/55">
        <span>{total} total · showing {skip + 1}–{Math.min(skip + rows.length, total)}</span>
        <div className="flex gap-2">
          <button disabled={skip === 0} onClick={() => setSkip((s) => Math.max(0, s - 200))}
            className="px-3 py-1 rounded bg-white/5 hover:bg-white/10 disabled:opacity-30">Prev</button>
          <button disabled={skip + rows.length >= total} onClick={() => setSkip((s) => s + 200)}
            className="px-3 py-1 rounded bg-white/5 hover:bg-white/10 disabled:opacity-30">Next</button>
        </div>
      </div>
    </div>
  );
}
