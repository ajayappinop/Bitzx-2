import { useCallback, useEffect, useState } from 'react';
import { FileText, RefreshCw } from 'lucide-react';
import { api } from '@/lib/api';

export default function SystemLogsPage() {
  const [source, setSource] = useState('');
  const [search, setSearch] = useState('');
  const [skip, setSkip] = useState(0);
  const [limit, setLimit] = useState(50);
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setErr('');
    try {
      const res = await api.systemLogs({ source, search, skip: String(skip), limit: String(limit) });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.detail || 'Failed to load system logs');
      setRows(body.items || []);
      setTotal(body.total ?? 0);
    } catch (e) {
      setErr(e.message || 'Failed to load logs');
      setRows([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [source, search, skip, limit]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="admin-page space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="admin-title mb-2 flex items-center gap-2">
            <FileText className="text-white/80" size={26} /> System Monitoring
          </h1>
          <p className="admin-page-lead">Centralized read-only event stream for audit, security, and alert pipelines.</p>
        </div>
        <button type="button" onClick={load} disabled={loading} className="inline-flex items-center gap-2 rounded-xl border border-surface-border px-3 py-2 text-white/80 text-sm font-bold disabled:opacity-40">
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>

      <div className="grid sm:grid-cols-3 gap-3">
        <select value={source} onChange={(e) => { setSkip(0); setSource(e.target.value); }} className="rounded-xl bg-surface-card border border-surface-border px-3 py-2 text-sm text-white">
          <option value="">All sources</option>
          <option value="audit">Audit</option>
          <option value="security">Security</option>
          <option value="alerts">Alerts</option>
        </select>
        <input value={search} onChange={(e) => { setSkip(0); setSearch(e.target.value); }} placeholder="Search type/message/source" className="sm:col-span-2 rounded-xl bg-surface-card border border-surface-border px-3 py-2 text-sm text-white placeholder:text-white/35" />
      </div>

      {err ? <p className="text-red-400 text-sm">{err}</p> : null}

      <div className="rounded-2xl border border-surface-border bg-surface-card overflow-hidden">
        <div className="adm-table-x">
          <table className="w-full text-sm min-w-[900px]">
            <thead>
              <tr className="text-left text-[11px] text-white/45 border-b border-surface-border">
                <th className="px-4 py-3">Time</th><th className="px-4 py-3">Source</th><th className="px-4 py-3">Type</th><th className="px-4 py-3">Severity</th><th className="px-4 py-3">Message</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={5} className="px-4 py-16 text-center text-white/50">Loading…</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={5} className="px-4 py-16 text-center text-white/50">No log entries match.</td></tr>
              ) : (
                rows.map((r) => (
                  <tr key={`${r.source}-${r.id}`} className="border-b border-surface-border/50">
                    <td className="px-4 py-3 text-xs text-white/60 whitespace-nowrap">{r.created_at ? new Date(r.created_at).toLocaleString() : '—'}</td>
                    <td className="px-4 py-3 text-xs uppercase font-bold">{r.source}</td>
                    <td className="px-4 py-3 text-xs font-mono">{r.type || '—'}</td>
                    <td className="px-4 py-3 text-xs">{r.severity || 'info'}</td>
                    <td className="px-4 py-3 text-xs text-white/70">{r.message || '—'}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="flex items-center justify-between text-sm text-white/55">
        <span>{total} rows</span>
        <div className="flex items-center gap-2">
          <select value={String(limit)} onChange={(e) => { setSkip(0); setLimit(Number(e.target.value)); }} className="rounded-xl bg-surface-card border border-surface-border px-3 py-2 text-white text-sm">
            {[25, 50, 100, 200].map((n) => <option key={n} value={n}>{n}/page</option>)}
          </select>
          <button type="button" disabled={skip <= 0} onClick={() => setSkip((s) => Math.max(0, s - limit))} className="rounded-xl border border-surface-border px-3 py-2 text-sm font-bold disabled:opacity-40">Prev</button>
          <button type="button" disabled={skip + limit >= total} onClick={() => setSkip((s) => s + limit)} className="rounded-xl border border-surface-border px-3 py-2 text-sm font-bold disabled:opacity-40">Next</button>
        </div>
      </div>
    </div>
  );
}
