import { useCallback, useEffect, useState } from 'react';
import { RefreshCw, AlertTriangle, Plus } from 'lucide-react';
import { api } from '@/lib/api';
import { formatAdminApiDetail } from '@/lib/adminApiDetail';

export default function OptionsUnderlyingsPage() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [sym, setSym] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.options.listUnderlyings();
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(formatAdminApiDetail(j) || `Load failed (${res.status})`);
      setRows(Array.isArray(j.underlyings) ? j.underlyings : []);
    } catch (e) {
      setError(e.message);
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await api.options.createUnderlying({
        symbol: sym.trim().toUpperCase(),
        display_name: name.trim() || undefined,
        listed: true,
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(formatAdminApiDetail(j) || 'Create failed');
      setRows((r) => [...r, j]);
      setSym('');
      setName('');
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const toggleListed = async (row) => {
    setBusy(true);
    try {
      const res = await api.options.patchUnderlying(row.id, { listed: !row.listed });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(formatAdminApiDetail(j) || 'Update failed');
      setRows((rs) => rs.map((x) => (x.id === row.id ? j : x)));
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      {error && (
        <div className="rounded-xl border border-rose-400/30 bg-rose-500/10 text-rose-200 px-4 py-3 text-sm flex items-start gap-2">
          <AlertTriangle size={18} className="shrink-0 mt-0.5" />
          <span className="break-words">{error}</span>
        </div>
      )}

      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-white/[0.08] bg-surface-dark p-4">
        <div>
          <label className="block text-[11px] text-white/50 font-bold uppercase mb-1">Symbol (BASEUSDT)</label>
          <input
            value={sym}
            onChange={(e) => setSym(e.target.value)}
            placeholder="BTCUSDT"
            className="rounded-lg bg-surface-card border border-white/15 px-3 py-2 text-sm text-white font-mono w-44"
          />
        </div>
        <div>
          <label className="block text-[11px] text-white/50 font-bold uppercase mb-1">Display name</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Bitcoin"
            className="rounded-lg bg-surface-card border border-white/15 px-3 py-2 text-sm text-white w-48"
          />
        </div>
        <button
          type="button"
          disabled={busy || !sym.trim()}
          onClick={create}
          className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-500/20 border border-emerald-400/40 px-4 py-2 text-sm font-bold text-emerald-200 disabled:opacity-40"
        >
          <Plus size={16} /> Add underlying
        </button>
        <button
          type="button"
          onClick={load}
          className="ml-auto inline-flex items-center gap-2 rounded-lg border border-white/15 px-3 py-2 text-xs font-bold text-white/70 hover:bg-white/5"
          aria-label="Refresh"
        >
          <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      <div className="rounded-xl border border-white/[0.08] bg-surface-dark overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[520px]">
            <thead className="text-left text-[11px] uppercase text-white/50 font-bold border-b border-white/10 bg-surface-dark">
              <tr>
                <th className="px-4 py-3 text-right w-20">ID</th>
                <th className="px-4 py-3">Symbol</th>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3 text-center w-28">Listed</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.06]">
              {loading && (
                <tr>
                  <td colSpan={4} className="px-4 py-10 text-center text-white/45 text-sm">
                    Loading underlyings…
                  </td>
                </tr>
              )}
              {!loading &&
                rows.map((r) => (
                  <tr key={String(r.id)} className="hover:bg-white/[0.03]">
                    <td className="px-4 py-3 font-mono text-xs text-white/60 text-right tabular-nums whitespace-nowrap">
                      {r.id != null ? String(r.id) : '—'}
                    </td>
                    <td className="px-4 py-3 font-mono font-bold text-white whitespace-nowrap">{r.symbol || '—'}</td>
                    <td className="px-4 py-3 text-white/85 max-w-[240px] break-words">{r.display_name || '—'}</td>
                    <td className="px-4 py-3 text-center">
                      <input
                        type="checkbox"
                        className="w-4 h-4 accent-gold"
                        checked={!!r.listed}
                        disabled={busy}
                        onChange={() => toggleListed(r)}
                        aria-label={`Listed ${r.symbol}`}
                      />
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
        {!rows.length && !loading && (
          <p className="p-8 text-center text-white/45 text-sm">No underlyings yet. Add one above or seed demo data on Overview.</p>
        )}
      </div>
    </div>
  );
}
