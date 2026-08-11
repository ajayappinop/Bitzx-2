import { useCallback, useEffect, useState } from 'react';
import { AlertCircle, AlertTriangle, FileText, Info, RefreshCw } from 'lucide-react';
import { api } from '@/lib/api';
import { AdminDataTable } from '@/components/AdminPrimitives';

const SEVERITY_STYLE = {
  critical: 'border-rose-500/40 bg-rose-500/15 text-rose-300',
  warn: 'border-gold/35 bg-gold/15 text-gold-light',
  warning: 'border-gold/35 bg-gold/15 text-gold-light',
  info: 'border-sky-500/35 bg-sky-500/10 text-sky-200',
  error: 'border-rose-500/40 bg-rose-500/15 text-rose-300',
};

const SEVERITY_ICON = {
  critical: AlertTriangle,
  warn: AlertCircle,
  warning: AlertCircle,
  error: AlertTriangle,
  info: Info,
};

const SOURCE_STYLE = {
  audit: 'border-[#FE6C02]/35 bg-[#FE6C02]/10 text-[#FE9D55]',
  security: 'border-violet-500/35 bg-violet-500/10 text-violet-200',
  alerts: 'border-emerald-500/35 bg-emerald-500/10 text-emerald-200',
};

function SeverityPill({ severity }) {
  const key = String(severity || 'info').toLowerCase();
  const Icon = SEVERITY_ICON[key] || Info;
  const cls = SEVERITY_STYLE[key] || SEVERITY_STYLE.info;
  return (
    <span className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide whitespace-nowrap ${cls}`}>
      <Icon size={11} />
      {key}
    </span>
  );
}

function SourcePill({ source }) {
  const key = String(source || '—').toLowerCase();
  const cls = SOURCE_STYLE[key] || 'border-surface-border bg-white/5 text-white/70';
  return (
    <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wide whitespace-nowrap ${cls}`}>
      {key}
    </span>
  );
}

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

  const page = Math.floor(skip / limit) + 1;
  const pages = Math.max(1, Math.ceil(total / limit) || 1);

  return (
    <div className="admin-page space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <h1 className="admin-title mb-2 flex items-center gap-2">
            <FileText className="text-white/80" size={26} /> System Monitoring
          </h1>
          <p className="admin-page-lead">Centralized read-only event stream for audit, security, and alert pipelines.</p>
        </div>
        <button
          type="button"
          onClick={load}
          disabled={loading}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-surface-border text-white/90 text-sm font-bold disabled:opacity-40 shrink-0 ml-auto"
        >
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>

      <div className="grid sm:grid-cols-3 gap-3">
        <select
          value={source}
          onChange={(e) => { setSkip(0); setSource(e.target.value); }}
          className="rounded-xl bg-surface-card border border-surface-border px-3 py-2 text-sm text-white"
        >
          <option value="">All sources</option>
          <option value="audit">Audit</option>
          <option value="security">Security</option>
          <option value="alerts">Alerts</option>
        </select>
        <input
          value={search}
          onChange={(e) => { setSkip(0); setSearch(e.target.value); }}
          placeholder="Search type / message / source"
          className="sm:col-span-2 rounded-xl bg-surface-card border border-surface-border px-3 py-2 text-sm text-white placeholder:text-white/35"
        />
      </div>

      {err ? <p className="text-red-400 text-sm">{err}</p> : null}

      <AdminDataTable fullBleed>
        <thead>
          <tr>
            <th>Time</th>
            <th>Source</th>
            <th>Type</th>
            <th>Severity</th>
            <th>Message</th>
          </tr>
        </thead>
        <tbody>
          {loading ? (
            <tr>
              <td colSpan={5} className="text-center text-white/50 !py-16">Loading…</td>
            </tr>
          ) : rows.length === 0 ? (
            <tr>
              <td colSpan={5} className="text-center text-white/50 !py-16">No log entries match.</td>
            </tr>
          ) : (
            rows.map((r) => (
              <tr key={`${r.source}-${r.id}`}>
                <td className="text-white/60 whitespace-nowrap">
                  {r.created_at ? new Date(r.created_at).toLocaleString() : '—'}
                </td>
                <td>
                  <SourcePill source={r.source} />
                </td>
                <td className="font-mono text-gold-light/90 break-all" title={r.type || ''}>
                  {r.type || '—'}
                </td>
                <td>
                  <SeverityPill severity={r.severity} />
                </td>
                <td className="text-white/75 break-words leading-relaxed" title={r.message || ''}>
                  {r.message || '—'}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </AdminDataTable>

      <div className="flex items-center justify-between flex-wrap gap-3 text-sm text-white/55">
        <span>{total} entries · page {page} / {pages}</span>
        <div className="flex items-center gap-2">
          <select
            value={String(limit)}
            onChange={(e) => { setSkip(0); setLimit(Number(e.target.value)); }}
            className="rounded-xl bg-surface-card border border-surface-border px-3 py-2 text-white text-sm font-semibold"
          >
            {[25, 50, 100, 200].map((n) => <option key={n} value={n}>{n}/page</option>)}
          </select>
          <button
            type="button"
            disabled={skip <= 0}
            onClick={() => setSkip((s) => Math.max(0, s - limit))}
            className="rounded-xl border border-surface-border px-3 py-2 text-sm font-bold disabled:opacity-40"
          >
            Prev
          </button>
          <button
            type="button"
            disabled={skip + limit >= total}
            onClick={() => setSkip((s) => s + limit)}
            className="rounded-xl border border-surface-border px-3 py-2 text-sm font-bold disabled:opacity-40"
          >
            Next
          </button>
        </div>
      </div>
    </div>
  );
}
