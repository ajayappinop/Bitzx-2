import { useEffect, useState, useCallback } from 'react';
import { Search, ChevronLeft, ChevronRight, RefreshCw } from 'lucide-react';
import { api } from '@/lib/api';

export default function IBOHoldingsTab() {
  const [items, setItems]       = useState([]);
  const [total, setTotal]       = useState(0);
  const [page, setPage]         = useState(1);
  const [search, setSearch]     = useState('');
  const [sort, setSort]         = useState('balance_desc');
  const [loading, setLoading]   = useState(true);
  const [err, setErr]           = useState(null);
  const LIMIT = 25;

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const res = await api.ibo.getUserHoldings({ page, limit: LIMIT, search: search || undefined, sort });
      const d = await res.json();
      if (!res.ok) throw new Error(d.detail || 'Failed');
      setItems(d.items || []);
      setTotal(d.total || 0);
    } catch (e) { setErr(e.message); }
    finally { setLoading(false); }
  }, [page, search, sort]);

  useEffect(() => { load(); }, [load]);

  const pages = Math.max(1, Math.ceil(total / LIMIT));
  const fmt = (n, dp = 4) => Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: dp });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3 items-center">
        <div className="relative flex-1 min-w-[200px] max-w-xs">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/30" />
          <input
            value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            placeholder="Search by user ID…"
            className="w-full pl-8 pr-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm text-white placeholder:text-white/25 focus:outline-none focus:border-gold/50"
          />
        </div>
        <select
          value={sort} onChange={(e) => { setSort(e.target.value); setPage(1); }}
          className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none"
        >
          <option value="balance_desc">Balance ↓</option>
          <option value="balance_asc">Balance ↑</option>
          <option value="uid_asc">User ID ↑</option>
        </select>
        <button onClick={load} className="flex items-center gap-1 text-xs text-white/40 hover:text-gold-light transition-colors ml-auto">
          <RefreshCw size={12} /> Refresh
        </button>
      </div>

      {err && <div className="text-red-400 text-sm py-4 text-center">{err}</div>}

      <div className="rounded-xl border border-white/8 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-white/8 bg-white/3">
              {['User ID', 'Available IBO', 'Locked IBO', 'Total IBO', 'USDT Equiv', 'Updated'].map((h) => (
                <th key={h} className="text-left px-4 py-2.5 text-xs font-semibold text-white/50 uppercase tracking-wider">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} className="text-white/30 text-sm text-center py-8">Loading…</td></tr>
            ) : items.length === 0 ? (
              <tr><td colSpan={6} className="text-white/30 text-sm text-center py-8">No IBO holders found</td></tr>
            ) : items.map((row) => (
              <tr key={row.uid} className="border-b border-white/5 last:border-0 hover:bg-white/2">
                <td className="px-4 py-2.5 font-mono text-xs text-white/60">{row.uid?.slice(0, 16)}…</td>
                <td className="px-4 py-2.5 text-white font-semibold">{fmt(row.available)}</td>
                <td className="px-4 py-2.5 text-gold-light">{fmt(row.locked)}</td>
                <td className="px-4 py-2.5 text-gold-light font-bold">{fmt(row.total_ibo)}</td>
                <td className="px-4 py-2.5 text-white/50">${fmt(row.usdt_equiv, 2)}</td>
                <td className="px-4 py-2.5 text-xs text-white/30">{row.updated_at ? new Date(row.updated_at).toLocaleDateString() : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {pages > 1 && (
        <div className="flex items-center gap-2 justify-end text-xs text-white/50">
          <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1} className="p-1 hover:text-white disabled:opacity-30"><ChevronLeft size={14}/></button>
          <span>Page {page} of {pages} ({total} users)</span>
          <button onClick={() => setPage((p) => Math.min(pages, p + 1))} disabled={page === pages} className="p-1 hover:text-white disabled:opacity-30"><ChevronRight size={14}/></button>
        </div>
      )}
    </div>
  );
}
