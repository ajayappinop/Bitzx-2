import { useEffect, useState, useCallback, useMemo } from 'react';
import { Loader2, AlertCircle, RefreshCw, CheckCircle2, XCircle, ShieldCheck } from 'lucide-react';
import { api } from '@/lib/api';

const STATUS_PILL = {
  pending:  'inline-flex items-center rounded-full border border-gold/30 bg-gold/10 px-2 py-0.5 text-[10px] font-extrabold uppercase text-gold-light',
  approved: 'inline-flex items-center rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-extrabold uppercase text-emerald-300',
  rejected: 'inline-flex items-center rounded-full border border-rose-500/30 bg-rose-500/10 px-2 py-0.5 text-[10px] font-extrabold uppercase text-rose-300',
};

const fmtDate = (s) => {
  try { return new Date(s).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }); }
  catch { return s || '—'; }
};

export default function P2PMerchantsTab() {
  const [items, setItems]     = useState([]);
  const [total, setTotal]     = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState('');

  /* Filters */
  const [statusFilter, setStatusFilter] = useState('pending');

  /* Pagination */
  const [skip, setSkip]   = useState(0);
  const [limit, setLimit] = useState(25);
  const pages = useMemo(() => Math.max(1, Math.ceil(total / limit)), [total, limit]);
  const page  = useMemo(() => Math.floor(skip / limit) + 1, [skip, limit]);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const params = { limit: String(limit), skip: String(skip) };
      if (statusFilter) params.status = statusFilter;
      const res  = await api.p2p.listMerchantApps(params);
      const data = await res.json();
      const list = data.applications || data.merchants || [];
      setItems(list);
      setTotal(data.total ?? list.length);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }, [limit, skip, statusFilter]);

  useEffect(() => { load(); }, [load]);

  const review = async (appId, action) => {
    const rejection_reason = action === 'reject'
      ? (window.prompt('Rejection reason (will be shown to the applicant):') || '')
      : undefined;
    try {
      const res = await api.p2p.reviewMerchant(appId, { action, rejection_reason });
      if (!res.ok) { const d = await res.json().catch(() => ({})); alert(d.detail || 'Failed'); return; }
      load();
    } catch (e) { alert(e.message); }
  };

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="rounded-2xl border border-surface-border bg-surface-card p-4">
        <div className="grid sm:grid-cols-3 gap-3">
          <select
            value={statusFilter}
            onChange={(e) => { setSkip(0); setStatusFilter(e.target.value); }}
            className="rounded-xl bg-surface-dark border border-surface-border px-3 py-2 text-sm text-white"
          >
            <option value="">All statuses</option>
            <option value="pending">Pending Review</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
          </select>
          <button
            type="button"
            onClick={() => load()}
            disabled={loading}
            className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-surface-border px-3 py-2 text-white/80 text-sm font-bold disabled:opacity-40"
          >
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> Refresh
          </button>
        </div>
      </div>

      {error && <p className="text-red-400 text-sm flex items-center gap-1.5"><AlertCircle size={13} />{error}</p>}

      <div className="text-sm text-white/60">
        Total: <strong className="text-white">{total}</strong>
        {total > 0 && <span className="ml-2 text-white/40">— page {page} of {pages}</span>}
      </div>

      {/* Table */}
      <div className="rounded-2xl border border-surface-border bg-surface-card overflow-hidden">
        <div className="adm-table-x scrollbar-thin">
          <table className="w-full text-sm min-w-[900px]">
            <thead>
              <tr className="border-b border-surface-border bg-white/[.02] text-left text-[11px] font-extrabold uppercase tracking-wider text-white/50">
                <Th>Applicant UID</Th>
                <Th>Display Name</Th>
                <Th>Experience</Th>
                <Th right>Volume / mo</Th>
                <Th>Application Reason (preview)</Th>
                <Th>Applied</Th>
                <Th>Status</Th>
                <Th right>Actions</Th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={8} className="px-4 py-16 text-center text-white/50"><Loader2 size={14} className="inline animate-spin mr-1" />Loading…</td></tr>
              ) : items.length === 0 ? (
                <tr><td colSpan={8} className="px-4 py-16 text-center text-white/50">No merchant applications found.</td></tr>
              ) : items.map((a) => {
                const id = a.merchant_id || a.application_id || a.user_id;
                const displayName = a.display_name || a.business_name || '—';
                const motivation = a.application_reason || a.motivation || a.description || '—';
                const experience = a.trading_experience || a.business_type || '—';
                const appliedAt  = a.applied_at || a.submitted_at;
                return (
                  <tr key={id} className="border-b border-surface-border/60 hover:bg-white/[.025]">
                    <td className="px-4 py-3 font-mono text-[11px] text-white/70">{a.user_id || a.uid || '—'}</td>
                    <td className="px-4 py-3 text-[12px] text-white/90 font-semibold">
                      <span className="inline-flex items-center gap-1.5">
                        <ShieldCheck size={12} className="text-gold-light shrink-0" />
                        {displayName}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-[11px] text-white/50">{experience}</td>
                    <td className="px-4 py-3 text-[11px] text-white/50 tabular-nums">
                      {a.monthly_volume_usd != null ? `$${Number(a.monthly_volume_usd).toLocaleString()}` : '—'}
                    </td>
                    <td className="px-4 py-3 text-[11px] text-white/50 max-w-xs truncate">{motivation}</td>
                    <td className="px-4 py-3 text-[11px] text-white/50 whitespace-nowrap">{fmtDate(appliedAt)}</td>
                    <td className="px-4 py-3">
                      <span className={STATUS_PILL[a.status] || STATUS_PILL.pending}>{a.status}</span>
                      {a.rejection_reason && (
                        <div className="text-[10px] text-rose-400 mt-0.5 max-w-[140px] truncate">{a.rejection_reason}</div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {a.status === 'pending' && (
                        <div className="inline-flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => review(id, 'approve')}
                            className="inline-flex items-center gap-1 rounded-lg border border-emerald-500/30 px-2.5 py-1 text-[11px] font-bold text-emerald-300 hover:bg-emerald-500/10"
                          >
                            <CheckCircle2 size={11} /> Approve
                          </button>
                          <button
                            type="button"
                            onClick={() => review(id, 'reject')}
                            className="inline-flex items-center gap-1 rounded-lg border border-rose-500/30 px-2.5 py-1 text-[11px] font-bold text-rose-300 hover:bg-rose-500/10"
                          >
                            <XCircle size={11} /> Reject
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Pagination */}
      {total > 0 && (
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <p className="text-sm text-white/50">Showing {skip + 1}–{Math.min(skip + limit, total)} of {total}</p>
          <div className="flex items-center gap-2">
            <select
              value={limit}
              onChange={(e) => { setSkip(0); setLimit(Number(e.target.value)); }}
              className="rounded-xl bg-surface-card border border-surface-border px-3 py-2 text-white text-sm font-semibold"
            >
              {[10, 25, 50, 100].map((n) => <option key={n} value={n}>{n}/page</option>)}
            </select>
            <button type="button" disabled={skip <= 0} onClick={() => setSkip((s) => Math.max(0, s - limit))}
              className="px-4 py-2 rounded-xl border border-surface-border text-sm font-bold disabled:opacity-40 text-white/80">
              Prev
            </button>
            <button type="button" disabled={skip + limit >= total} onClick={() => setSkip((s) => s + limit)}
              className="px-4 py-2 rounded-xl border border-surface-border text-sm font-bold disabled:opacity-40 text-white/80">
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Th({ children, right }) {
  return <th className={`px-4 py-3 ${right ? 'text-right' : ''}`}>{children}</th>;
}
