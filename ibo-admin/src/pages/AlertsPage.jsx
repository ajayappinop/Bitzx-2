// Phase 9c — Alerts admin page.
//
// Shows the alert feed (default filter: ``status=open``) with inline
// resolve / mute actions and a meta drawer that dumps the raw JSON.
// This is the page the nav badge points at; keeping filters in the URL
// means "open critical" / "resolved 7d" are bookmarkable.

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Bell,
  AlertTriangle,
  AlertCircle,
  Info,
  CheckCircle2,
  VolumeX,
  RefreshCw,
  Search,
  X,
  TestTube2,
  Webhook,
  Circle,
} from 'lucide-react';
import { api } from '@/lib/api';
import ConfirmModal from '@/components/ConfirmModal';

const SEVERITY_ORDER = ['critical', 'warn', 'info'];

const SEVERITY_STYLE = {
  critical: 'bg-rose-500/15 text-rose-300 border border-rose-500/40',
  warn:     'bg-gold/15 text-gold-light border border-gold/30',
  info:     'bg-sky-500/15 text-sky-300 border border-sky-500/30',
};

const SEVERITY_ICON = {
  critical: <AlertTriangle size={12} />,
  warn:     <AlertCircle size={12} />,
  info:     <Info size={12} />,
};

const STATUS_STYLE = {
  open:     'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30',
  resolved: 'bg-white/10 text-white/60 border border-white/15',
  muted:    'bg-slate-500/15 text-slate-300 border border-slate-500/25',
};

function SeverityPill({ severity }) {
  const key = String(severity || 'info').toLowerCase();
  const cls = SEVERITY_STYLE[key] || SEVERITY_STYLE.info;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-[2px] rounded-md text-[11px] font-extrabold uppercase ${cls}`}>
      {SEVERITY_ICON[key]} {key}
    </span>
  );
}

function StatusPill({ status }) {
  const key = String(status || 'open').toLowerCase();
  const cls = STATUS_STYLE[key] || STATUS_STYLE.open;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-[2px] rounded-md text-[10px] font-bold uppercase ${cls}`}>
      {key}
    </span>
  );
}

function fmtDatetime(s) {
  if (!s) return '—';
  try { return new Date(s).toLocaleString(); } catch { return s; }
}

function DetailDrawer({ alert, onClose }) {
  if (!alert) return null;
  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex" onClick={onClose}>
      <div
        className="ml-auto h-full w-[min(100%,560px)] bg-surface-card border-l border-surface-border overflow-y-auto p-5 space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <SeverityPill severity={alert.severity} />
              <StatusPill status={alert.status} />
              <span className="text-[11px] font-mono text-white/40">{alert.id}</span>
            </div>
            <h3 className="text-white font-extrabold text-lg mt-2">{alert.title}</h3>
            <p className="text-white/70 text-sm mt-1">{alert.message}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-lg border border-white/10 text-white/70 hover:bg-white/5"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        <div className="grid grid-cols-2 gap-3 text-[11px] text-white/60">
          <div><div className="text-white/40 uppercase">Type</div><div className="font-mono text-white/80 break-all">{alert.type}</div></div>
          <div><div className="text-white/40 uppercase">Source</div><div className="font-mono text-white/80">{alert.source}</div></div>
          <div><div className="text-white/40 uppercase">Dedupe key</div><div className="font-mono text-white/80 break-all">{alert.dedupe_key || '—'}</div></div>
          <div><div className="text-white/40 uppercase">Occurrences</div><div className="font-mono text-white/80">{alert.occurrences}</div></div>
          <div><div className="text-white/40 uppercase">First seen</div><div className="font-mono text-white/80">{fmtDatetime(alert.first_seen_at)}</div></div>
          <div><div className="text-white/40 uppercase">Last seen</div><div className="font-mono text-white/80">{fmtDatetime(alert.last_seen_at)}</div></div>
          {alert.resolved_at ? (
            <>
              <div><div className="text-white/40 uppercase">Resolved at</div><div className="font-mono text-white/80">{fmtDatetime(alert.resolved_at)}</div></div>
              <div><div className="text-white/40 uppercase">Resolved by</div><div className="font-mono text-white/80">{alert.resolved_by || '—'}</div></div>
              {alert.resolved_note ? (
                <div className="col-span-2"><div className="text-white/40 uppercase">Note</div><div className="text-white/80">{alert.resolved_note}</div></div>
              ) : null}
            </>
          ) : null}
          <div><div className="text-white/40 uppercase">Webhook</div><div className="font-mono text-white/80">
            {alert.webhook_sent ? 'delivered' : alert.webhook_error ? `failed: ${alert.webhook_error}` : 'not sent'}
          </div></div>
          <div><div className="text-white/40 uppercase">TTL</div><div className="font-mono text-white/80">{fmtDatetime(alert.expires_at)}</div></div>
        </div>

        <div>
          <div className="text-white/40 uppercase text-[11px] mb-1">Meta</div>
          <pre className="text-[11px] font-mono text-white/70 bg-surface-dark border border-white/10 rounded-lg p-3 overflow-auto max-h-[40vh]">
{JSON.stringify(alert.meta || {}, null, 2)}
          </pre>
        </div>
      </div>
    </div>
  );
}

const DEFAULT_FILTERS = {
  status: 'open',
  severity: '',
  source: '',
  type: '',
  search: '',
};

export default function AlertsPage() {
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState('');
  const [detail, setDetail] = useState(null);
  const [testing, setTesting] = useState(false);
  const [ok, setOk] = useState('');
  const [actionModal, setActionModal] = useState({ open: false, kind: 'resolve', row: null });
  const [testModalOpen, setTestModalOpen] = useState(false);

  const load = useCallback(async (p = page) => {
    setLoading(true);
    try {
      const res = await api.alertsList({ ...filters, page: p, limit: 50 });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.detail || 'Failed to load');
      setData(body);
      setErr('');
    } catch (e) {
      setErr(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  }, [filters, page]);

  const loadStats = useCallback(async () => {
    try {
      const res = await api.alertsStats();
      const body = await res.json();
      if (res.ok) setStats(body);
    } catch { /* silent */ }
  }, []);

  useEffect(() => {
    load(page);
    loadStats();
    // Poll every 30s so an on-call admin sitting on this tab sees new
    // incidents live without manually refreshing.
    const t = setInterval(() => { load(page); loadStats(); }, 30_000);
    return () => clearInterval(t);
  }, [load, loadStats, page]);

  // Reset to page 1 whenever filters change so we never look at a stale
  // page-5 under a different filter.
  useEffect(() => { setPage(1); }, [filters]);

  const items = data?.items || [];
  const openCounts = stats?.open || { info: 0, warn: 0, critical: 0, total: 0 };

  async function resolve(row, note = '') {
    setBusy(row.id);
    try {
      const res = await api.alertResolve(row.id, { note });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.detail || 'Resolve failed');
      await Promise.all([load(page), loadStats()]);
      setOk(`Resolved alert ${row.id}.`);
    } catch (e) {
      setErr(`Resolve failed: ${e?.message || e}`);
    } finally {
      setBusy('');
    }
  }

  async function mute(row, note = '') {
    setBusy(row.id);
    try {
      const res = await api.alertMute(row.id, { note });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.detail || 'Mute failed');
      await Promise.all([load(page), loadStats()]);
      setOk(`Muted alert ${row.id}.`);
    } catch (e) {
      setErr(`Mute failed: ${e?.message || e}`);
    } finally {
      setBusy('');
    }
  }

  async function emitTest(severity) {
    if (!severity) return;
    setTesting(true);
    try {
      const res = await api.alertTest({ severity });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.detail || 'Test failed');
      await Promise.all([load(page), loadStats()]);
      setOk(`Test alert emitted (${body?.alert?.id || '?'}). Webhook: ${body?.alert?.webhook_sent ? 'delivered' : body?.alert?.webhook_error || 'not configured'}.`);
    } catch (e) {
      setErr(`Test failed: ${e?.message || e}`);
    } finally {
      setTesting(false);
    }
  }

  return (
    <div className="admin-page space-y-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="admin-title flex items-center gap-2">
            <Bell size={22} className="text-gold-light" /> Alerts
          </h1>
          <p className="admin-page-lead mt-2">
            Unified operational alert inbox for risk, treasury, and system events with acknowledge/mute workflows.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setTestModalOpen(true)}
            disabled={testing}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-white/10 text-white/80 hover:bg-white/5 disabled:opacity-40 text-sm"
            title="Emit synthetic alert (superadmin) to validate webhook delivery"
          >
            <TestTube2 size={14} /> {testing ? 'Emitting…' : 'Emit test'}
          </button>
          <button
            type="button"
            onClick={() => { load(page); loadStats(); }}
            disabled={loading}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-white/10 text-white/80 hover:bg-white/5 disabled:opacity-40 text-sm"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh
          </button>
        </div>
      </div>
      {ok ? <p className="text-emerald-300 text-sm">{ok}</p> : null}

      {/* Open-alert counters */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="p-3 rounded-xl border border-rose-500/30 bg-rose-500/[0.05]">
          <div className="text-sm font-semibold text-rose-300/90 flex items-center gap-1">
            <AlertTriangle size={12} /> Open critical
          </div>
          <div className="text-3xl font-extrabold text-rose-300">{openCounts.critical}</div>
        </div>
        <div className="p-3 rounded-xl border border-gold/30 bg-gold/[0.05]">
          <div className="text-sm font-semibold text-gold-light/90 flex items-center gap-1">
            <AlertCircle size={12} /> Open warnings
          </div>
          <div className="text-3xl font-extrabold text-gold-light">{openCounts.warn}</div>
        </div>
        <div className="p-3 rounded-xl border border-sky-500/30 bg-sky-500/[0.05]">
          <div className="text-sm font-semibold text-sky-300/90 flex items-center gap-1">
            <Info size={12} /> Open info
          </div>
          <div className="text-3xl font-extrabold text-sky-300">{openCounts.info}</div>
        </div>
        <div className="p-3 rounded-xl border border-white/10 bg-white/[0.02]">
          <div className="text-sm font-semibold text-white/75 flex items-center gap-1">
            <Circle size={10} /> Total open
          </div>
          <div className="text-3xl font-extrabold text-white">{openCounts.total}</div>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2 p-3 rounded-xl border border-white/10 bg-white/[0.02]">
        <div className="admin-tabs">
        {['open', 'resolved', 'muted', 'all'].map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setFilters((f) => ({ ...f, status: s }))}
            className={`admin-tab-btn text-xs uppercase ${filters.status === s ? 'active' : ''}`}
          >
            {s}
          </button>
        ))}
        </div>
        <span className="w-px h-5 bg-white/10 mx-1" />
        <div className="admin-tabs">
        {['', ...SEVERITY_ORDER].map((s) => (
          <button
            key={s || 'any'}
            type="button"
            onClick={() => setFilters((f) => ({ ...f, severity: s }))}
            className={`admin-tab-btn text-xs uppercase ${filters.severity === s ? 'active' : ''}`}
          >
            {s || 'any severity'}
          </button>
        ))}
        </div>
        <div className="relative ml-auto min-w-[220px]">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-white/40" />
          <input
            type="text"
            value={filters.search}
            onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value }))}
            placeholder="Search title / message / type"
            className="w-full pl-8 pr-3 py-1.5 rounded-lg bg-surface-dark border border-white/10 text-white text-sm placeholder:text-white/30 focus:outline-none focus:border-white/30"
          />
        </div>
        <input
          type="text"
          value={filters.source}
          onChange={(e) => setFilters((f) => ({ ...f, source: e.target.value }))}
          placeholder="Source (hedger, treasury…)"
          className="w-[180px] px-3 py-1.5 rounded-lg bg-surface-dark border border-white/10 text-white text-sm placeholder:text-white/30 focus:outline-none focus:border-white/30"
        />
      </div>

      {err ? (
        <div className="p-3 rounded-xl border border-rose-500/30 bg-rose-500/10 text-rose-300 text-sm">
          {err}
        </div>
      ) : null}

      {/* Table */}
      <div className="overflow-x-auto rounded-xl border border-white/10 bg-white/[0.02]">
        <table className="w-full text-sm">
          <thead className="bg-white/5 text-white/60 text-left text-[11px] uppercase tracking-wider">
            <tr>
              <th className="px-3 py-2">Severity</th>
              <th className="px-3 py-2">Title</th>
              <th className="px-3 py-2">Source</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2 text-right">Occur.</th>
              <th className="px-3 py-2">Last seen</th>
              <th className="px-3 py-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {items.map((row) => (
              <tr
                key={row.id}
                className="hover:bg-white/[0.03] cursor-pointer"
                onClick={() => setDetail(row)}
              >
                <td className="px-3 py-2"><SeverityPill severity={row.severity} /></td>
                <td className="px-3 py-2">
                  <div className="font-bold text-white">{row.title}</div>
                  <div className="text-white/50 text-[11px] truncate max-w-[420px]" title={row.message}>
                    {row.message}
                  </div>
                  <div className="text-white/30 text-[10px] font-mono">{row.type}</div>
                </td>
                <td className="px-3 py-2 text-white/60 uppercase text-[11px] font-bold">{row.source}</td>
                <td className="px-3 py-2"><StatusPill status={row.status} /></td>
                <td className="px-3 py-2 text-right font-mono text-white/70">{row.occurrences}</td>
                <td className="px-3 py-2 text-white/50 text-[11px]">{fmtDatetime(row.last_seen_at)}</td>
                <td className="px-3 py-2 text-right" onClick={(e) => e.stopPropagation()}>
                  {row.status === 'open' ? (
                    <div className="inline-flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => setActionModal({ open: true, kind: 'resolve', row })}
                        disabled={busy === row.id}
                        className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/10 disabled:opacity-40 text-[11px] font-bold"
                        title="Mark resolved"
                      >
                        <CheckCircle2 size={12} /> Resolve
                      </button>
                      <button
                        type="button"
                        onClick={() => setActionModal({ open: true, kind: 'mute', row })}
                        disabled={busy === row.id}
                        className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-white/15 text-white/70 hover:bg-white/5 disabled:opacity-40 text-[11px] font-bold"
                        title="Mute — won't reopen on repeats"
                      >
                        <VolumeX size={12} /> Mute
                      </button>
                    </div>
                  ) : (
                    <span className="text-white/30 text-[11px]">—</span>
                  )}
                </td>
              </tr>
            ))}
            {!items.length && !loading ? (
              <tr>
                <td className="px-3 py-6 text-white/50 text-center" colSpan={7}>
                  No alerts match these filters.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {(data?.pages || 0) > 1 ? (
        <div className="flex items-center justify-between text-xs text-white/60">
          <span>
            Page {data.page} of {data.pages} · {data.total} total
          </span>
          <div className="inline-flex gap-1">
            <button
              type="button"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={data.page <= 1 || loading}
              className="px-3 py-1.5 rounded-lg border border-white/10 text-white/70 hover:bg-white/5 disabled:opacity-40"
            >
              Prev
            </button>
            <button
              type="button"
              onClick={() => setPage((p) => Math.min(data.pages, p + 1))}
              disabled={data.page >= data.pages || loading}
              className="px-3 py-1.5 rounded-lg border border-white/10 text-white/70 hover:bg-white/5 disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </div>
      ) : null}

      <div className="text-[11px] text-white/30 flex items-center gap-1">
        <Webhook size={11} /> Configure <code className="font-mono">alert_webhook_url</code> in Settings to relay alerts to Slack/Discord.
      </div>

      <DetailDrawer alert={detail} onClose={() => setDetail(null)} />
      <ConfirmModal
        open={actionModal.open}
        title={actionModal.kind === 'resolve' ? 'Resolve alert' : 'Mute alert'}
        message={actionModal.kind === 'resolve'
          ? `Resolve "${actionModal.row?.title || ''}"?`
          : `Mute "${actionModal.row?.title || ''}"? Muted alerts do not auto-reopen on repeats.`}
        inputLabel="Optional note"
        confirmText={actionModal.kind === 'resolve' ? 'Resolve' : 'Mute'}
        danger={actionModal.kind === 'mute'}
        onClose={() => setActionModal({ open: false, kind: 'resolve', row: null })}
        onConfirm={(note) => {
          if (!actionModal.row) return;
          if (actionModal.kind === 'resolve') resolve(actionModal.row, note);
          else mute(actionModal.row, note);
          setActionModal({ open: false, kind: 'resolve', row: null });
        }}
      />
      <ConfirmModal
        open={testModalOpen}
        title="Emit synthetic alert"
        message="Send a test alert to validate webhook routing."
        inputLabel="Severity"
        initialValue="warn"
        required
        confirmText="Emit test alert"
        onClose={() => setTestModalOpen(false)}
        onConfirm={(severity) => {
          emitTest(String(severity || '').trim().toLowerCase());
          setTestModalOpen(false);
        }}
      />
    </div>
  );
}
