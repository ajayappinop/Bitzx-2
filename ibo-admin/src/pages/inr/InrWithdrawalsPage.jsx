import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  IndianRupee, RefreshCw, CheckCircle, XCircle, Eye, Clock, AlertCircle, X,
} from 'lucide-react';
import { api } from '@/lib/api';
import { useAdminAuth } from '@/context/AdminAuthContext';
import { hasPermission } from '@/lib/adminAccess';
import { AdminPageHeader, AdminDataTable } from '@/components/AdminPrimitives';

function fmtTs(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return String(iso);
  }
}

function fmtInr(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return '—';
  return `₹${v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtIbo(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return '—';
  return v.toFixed(8);
}

const STATUS_STYLES = {
  pending: { bg: 'bg-gold/15 text-gold-light', icon: Clock, label: 'Pending' },
  approved: { bg: 'bg-emerald-500/15 text-emerald-300', icon: CheckCircle, label: 'Approved' },
  rejected: { bg: 'bg-red-500/15 text-red-300', icon: XCircle, label: 'Rejected' },
  cancelled: { bg: 'bg-zinc-500/20 text-zinc-200', icon: XCircle, label: 'Cancelled' },
  approving: { bg: 'bg-sky-500/15 text-sky-300', icon: RefreshCw, label: 'Processing' },
};

function effectiveStatus(rowOrStatus, rejectionReason) {
  if (typeof rowOrStatus === 'object' && rowOrStatus !== null) {
    const st = String(rowOrStatus.status || '').toLowerCase();
    const rr = String(rowOrStatus.rejection_reason || '').trim().toLowerCase();
    if (st === 'rejected' && (rr === 'cancelled by user' || rr.startsWith('cancelled by user') || rr.startsWith('cancelled'))) return 'cancelled';
    return st;
  }
  const st = String(rowOrStatus || '').toLowerCase();
  const rr = String(rejectionReason || '').trim().toLowerCase();
  if (st === 'rejected' && (rr === 'cancelled by user' || rr.startsWith('cancelled by user') || rr.startsWith('cancelled'))) return 'cancelled';
  return st;
}

function StatusPill({ status, row }) {
  const st = effectiveStatus(row ?? status, row?.rejection_reason);
  const def = STATUS_STYLES[st] || { bg: 'bg-white/10 text-white/70', icon: AlertCircle, label: status || '—' };
  const Icon = def.icon;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold uppercase ${def.bg}`}>
      <Icon size={10} className={st === 'approving' ? 'animate-spin' : ''} />
      {def.label}
    </span>
  );
}

function payoutTypeLabel(t) {
  const v = String(t || '').toLowerCase();
  if (v === 'bank') return 'Bank';
  if (v === 'upi') return 'UPI';
  return v || '—';
}

function DetailRow({ label, children }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wide text-white/40 mb-1">{label}</p>
      <div className="text-sm text-white/90">{children}</div>
    </div>
  );
}

function PayoutDetailsBlock({ row }) {
  const d = row.payout_details || {};
  const t = String(row.payout_type || '').toLowerCase();
  if (t === 'bank') {
    return (
      <div className="space-y-2 text-sm">
        <p><span className="text-white/45">Bank</span> {d.bank_name || '—'}</p>
        <p><span className="text-white/45">Holder</span> {d.account_holder_name || '—'}</p>
        <p className="font-mono text-xs break-all"><span className="text-white/45">Account</span> {d.account_number || '—'}</p>
        <p className="font-mono text-xs"><span className="text-white/45">IFSC</span> {d.ifsc_code || '—'}</p>
        {d.branch ? <p><span className="text-white/45">Branch</span> {d.branch}</p> : null}
      </div>
    );
  }
  if (t === 'upi') {
    return (
      <div className="space-y-2 text-sm">
        <p className="font-mono text-xs break-all"><span className="text-white/45">UPI ID</span> {d.upi_id || '—'}</p>
        {d.display_name ? <p><span className="text-white/45">Name</span> {d.display_name}</p> : null}
      </div>
    );
  }
  return <p className="text-white/50 text-sm">—</p>;
}

function WithdrawalDetailModal({
  row, onClose, canAct, acting, onApprove, onReject,
}) {
  if (!row) return null;
  const st = String(row.status || '').toLowerCase();
  const pending = st === 'pending';

  return (
    <div
      className="fixed inset-0 z-[100] bg-black/75 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="w-full max-w-3xl max-h-[min(90vh,720px)] flex flex-col rounded-2xl border border-surface-border bg-surface-card shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className="shrink-0 flex items-start justify-between gap-3 px-5 py-4 border-b border-surface-border">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2 mb-1">
              <h3 className="text-lg font-bold text-white">INR withdrawal</h3>
              <StatusPill row={row} />
            </div>
            <p className="text-xs text-white/45 font-mono truncate">{row.id}</p>
            <p className="text-xs text-white/50 mt-0.5">Submitted {fmtTs(row.created_at)}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="p-2 rounded-lg border border-surface-border text-white/60 hover:text-white">
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto p-5 space-y-5">
          <div className="grid grid-cols-2 gap-4">
            <DetailRow label="Amount (INR)">
              <span className="text-xl font-bold tabular-nums">{fmtInr(row.amount_inr)}</span>
            </DetailRow>
            <DetailRow label="Delta locked at submit">
              <span className="font-mono text-gold-light font-bold">{fmtIbo(row.amount_ibo)}</span>
            </DetailRow>
          </div>

          <DetailRow label="User">
            <Link to={`/users/${row.uid}`} className="font-mono text-xs text-gold-light hover:underline break-all">
              {row.uid}
            </Link>
            {row.user_email && <p className="text-xs text-white/60 mt-1">{row.user_email}</p>}
            {row.user_name && <p className="text-xs text-white/60">{row.user_name}</p>}
          </DetailRow>

          <DetailRow label={`Payout · ${payoutTypeLabel(row.payout_type)}`}>
            {row.payout_label && <p className="text-xs text-white/55 mb-2">{row.payout_label}</p>}
            <PayoutDetailsBlock row={row} />
          </DetailRow>

          {row.payout_reference && (
            <DetailRow label="Payout reference (UTR / txn id)">
              <span className="font-mono text-xs break-all">{row.payout_reference}</span>
            </DetailRow>
          )}

          {st === 'rejected' && row.rejection_reason && (
            <DetailRow label="Rejection reason">
              <span className="text-red-200/90 whitespace-pre-wrap">{row.rejection_reason}</span>
            </DetailRow>
          )}

          {row.reviewed_at && (
            <p className="text-xs text-white/40">
              Reviewed {fmtTs(row.reviewed_at)}
              {row.reviewed_by ? ` · ${row.reviewed_by}` : ''}
            </p>
          )}
        </div>

        {pending && canAct && (
          <div className="shrink-0 flex flex-wrap gap-2 justify-end px-5 py-4 border-t border-surface-border bg-surface-dark">
            <button
              type="button"
              disabled={!!acting}
              onClick={() => onReject(row)}
              className="px-4 py-2.5 rounded-xl text-sm font-bold border border-red-500/40 bg-red-500/20 text-red-100 disabled:opacity-40"
            >
              Reject
            </button>
            <button
              type="button"
              disabled={!!acting}
              onClick={() => onApprove(row)}
              className="px-4 py-2.5 rounded-xl text-sm font-bold border border-emerald-500/45 bg-emerald-500/25 text-emerald-100 disabled:opacity-40"
            >
              Mark paid &amp; approve
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

const STATUS_OPTIONS = [
  { value: 'pending', label: 'Pending (needs action)' },
  { value: '', label: 'All statuses' },
  { value: 'approving', label: 'Processing' },
  { value: 'approved', label: 'Approved' },
  { value: 'cancelled', label: 'Cancelled' },
  { value: 'rejected', label: 'Rejected' },
];

export default function InrWithdrawalsPage() {
  const { admin } = useAdminAuth();
  const canAct = hasPermission(admin, 'manage_treasury');
  const [searchParams] = useSearchParams();
  const uidFromUrl = (searchParams.get('uid') || '').trim();

  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [ok, setOk] = useState('');
  const [statusFilter, setStatusFilter] = useState(uidFromUrl ? '' : 'pending');
  const [uidFilter, setUidFilter] = useState(uidFromUrl);
  const [skip, setSkip] = useState(0);
  const limit = 25;

  const [detailRow, setDetailRow] = useState(null);
  const [approveTarget, setApproveTarget] = useState(null);
  const [payoutRef, setPayoutRef] = useState('');
  const [approveNote, setApproveNote] = useState('');
  const [rejectTarget, setRejectTarget] = useState(null);
  const [rejectReason, setRejectReason] = useState('');
  const [acting, setActing] = useState('');

  const load = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setLoading(true);
    setErr('');
    try {
      const params = { skip: String(skip), limit: String(limit) };
      if (statusFilter) params.status = statusFilter;
      if (uidFilter.trim()) params.uid = uidFilter.trim();
      const r = await api.inrWithdrawals(params);
      const j = await r.json();
      if (!r.ok) throw new Error(j.detail || `HTTP ${r.status}`);
      setItems(Array.isArray(j.items) ? j.items : []);
      setTotal(Number.isFinite(j.total) ? j.total : 0);
    } catch (e) {
      setErr(e.message || 'Could not load INR withdrawals');
      if (!silent) {
        setItems([]);
        setTotal(0);
      }
    } finally {
      if (!silent) setLoading(false);
    }
  }, [skip, statusFilter, uidFilter]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!ok) return undefined;
    const t = setTimeout(() => setOk(''), 4000);
    return () => clearTimeout(t);
  }, [ok]);

  const pages = useMemo(() => Math.max(1, Math.ceil(total / limit)), [total]);
  const page = useMemo(() => Math.floor(skip / limit) + 1, [skip]);

  const doApprove = async () => {
    const row = approveTarget;
    if (!row?.id) return;
    const ref = payoutRef.trim();
    if (!ref) {
      setErr('Enter the payout UTR / bank reference before confirming.');
      return;
    }
    setActing(row.id);
    setErr('');
    setOk('');
    try {
      const body = { payout_reference: ref };
      const note = approveNote.trim();
      if (note) body.note = note;
      const r = await api.inrApproveWithdrawal(row.id, body);
      const j = await r.json();
      if (!r.ok) throw new Error(j.detail || `HTTP ${r.status}`);
      setApproveTarget(null);
      setPayoutRef('');
      setApproveNote('');
      setDetailRow(null);
      await load({ silent: true });
      setOk(`Payout confirmed · ${fmtInr(row.amount_inr)} · UTR ${ref}`);
    } catch (e) {
      setErr(e.message || 'Approve failed');
    } finally {
      setActing('');
    }
  };

  const doReject = async () => {
    const row = rejectTarget;
    if (!row?.id) return;
    const reason = rejectReason.trim();
    if (reason.length < 3) {
      setErr('Rejection reason is required (min 3 characters)');
      return;
    }
    setActing(row.id);
    setErr('');
    setOk('');
    try {
      const r = await api.inrRejectWithdrawal(row.id, { reason });
      if (!r.ok) {
        const j = await r.json();
        throw new Error(j.detail || `HTTP ${r.status}`);
      }
      setRejectTarget(null);
      setRejectReason('');
      setDetailRow(null);
      await load({ silent: true });
      setOk(`Rejected withdrawal for ${row.uid} — Delta unlocked`);
    } catch (e) {
      setErr(e.message || 'Reject failed');
    } finally {
      setActing('');
    }
  };

  return (
    <div className="admin-page">
      <AdminPageHeader
        icon={IndianRupee}
        title="INR withdrawals"
        subtitle="Review payout details, send bank/UPI transfer, then approve. Delta was locked when the user submitted."
        actions={(
          <button
            type="button"
            onClick={() => load()}
            disabled={loading && items.length === 0}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-surface-border text-sm font-bold text-white hover:border-gold/40 disabled:opacity-40"
          >
            <RefreshCw size={14} className={loading && items.length === 0 ? 'animate-spin' : ''} /> Refresh
          </button>
        )}
      />

      {!canAct && (
        <div className="mb-4 rounded-xl border border-gold/30 bg-gold/10 px-4 py-3 text-sm text-gold-light/90">
          Approve / reject requires <code className="text-gold-light">manage_treasury</code>.
        </div>
      )}

      <div className="flex flex-wrap gap-3 mb-4 items-center">
        <select
          value={statusFilter}
          onChange={(e) => { setStatusFilter(e.target.value); setSkip(0); }}
          className="rounded-xl border border-surface-border bg-surface-dark px-3 py-2 text-sm text-white"
        >
          {STATUS_OPTIONS.map((o) => (
            <option key={o.value || 'all'} value={o.value}>{o.label}</option>
          ))}
        </select>
        <input
          type="text"
          value={uidFilter}
          onChange={(e) => { setUidFilter(e.target.value); setSkip(0); }}
          placeholder="Filter by user UID"
          className="rounded-xl border border-surface-border bg-surface-dark px-3 py-2 text-sm text-white font-mono min-w-[200px] placeholder:text-white/35"
        />
        <Link to="/inr-deposits" className="text-sm font-bold text-gold-light hover:underline">
          INR deposits →
        </Link>
      </div>

      {err && (
        <p className="text-rose-300 text-sm mb-3 flex justify-between gap-3">
          <span>{err}</span>
          <button type="button" onClick={() => setErr('')} className="text-white/50 text-xs shrink-0">Dismiss</button>
        </p>
      )}
      {ok && (
        <p className="text-emerald-300 text-sm mb-3 flex justify-between gap-3">
          <span>{ok}</span>
          <button type="button" onClick={() => setOk('')} className="text-white/50 text-xs shrink-0">Dismiss</button>
        </p>
      )}

      <AdminDataTable minWidth="680px">
            <thead>
              <tr className="text-center">
                <th>User</th>
                <th>INR</th>
                <th>Delta locked</th>
                <th>Payout</th>
                <th>Status</th>
                <th>Submitted</th>
                <th>View</th>
              </tr>
            </thead>
            <tbody>
              {loading && items.length === 0 ? (
                <tr><td colSpan={7} className="text-center text-white/50 !py-12">Loading…</td></tr>
              ) : items.length === 0 ? (
                <tr><td colSpan={7} className="text-center text-white/50 !py-12">No withdrawals found.</td></tr>
              ) : (
                items.map((row) => (
                  <tr key={row.id}>
                    <td className="text-center">
                      <Link to={`/users/${row.uid}`} className="font-mono text-[11px] text-gold-light hover:underline truncate inline-block max-w-[120px]" title={row.uid}>
                        {row.uid}
                      </Link>
                    </td>
                    <td className="text-center font-semibold text-white tabular-nums">{fmtInr(row.amount_inr)}</td>
                    <td className="text-center font-mono text-xs text-gold-light">{fmtIbo(row.amount_ibo)}</td>
                    <td className="text-center text-xs font-bold uppercase" title={row.payout_label || ''}>
                      {payoutTypeLabel(row.payout_type)}
                    </td>
                    <td className="text-center"><StatusPill row={row} /></td>
                    <td className="text-center text-xs text-white/55 whitespace-nowrap">{fmtTs(row.created_at)}</td>
                    <td className="text-center">
                      <button
                        type="button"
                        onClick={() => setDetailRow(row)}
                        className="h-8 px-3 text-[11px] font-bold rounded-md border border-surface-border text-white/80 bg-white/5 hover:bg-white/10 inline-flex items-center gap-1"
                      >
                        <Eye size={12} /> View
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
      </AdminDataTable>

      <div className="flex items-center justify-between mt-4 text-sm text-white/60">
        <span>Page {page} / {pages} · {total} total</span>
        <div className="flex gap-2">
          <button type="button" disabled={skip <= 0} onClick={() => setSkip((s) => Math.max(0, s - limit))} className="px-3 py-1.5 rounded-lg border border-surface-border disabled:opacity-40">Prev</button>
          <button type="button" disabled={skip + limit >= total} onClick={() => setSkip((s) => s + limit)} className="px-3 py-1.5 rounded-lg border border-surface-border disabled:opacity-40">Next</button>
        </div>
      </div>

      <WithdrawalDetailModal
        row={detailRow}
        onClose={() => setDetailRow(null)}
        canAct={canAct}
        acting={acting}
        onApprove={(r) => { setApproveTarget(r); setPayoutRef(''); setApproveNote(''); }}
        onReject={(r) => { setRejectTarget(r); setRejectReason(''); }}
      />

      {approveTarget && (
        <div className="fixed inset-0 z-[120] bg-black/75 flex items-center justify-center p-4" onClick={() => !acting && setApproveTarget(null)} role="presentation">
          <div className="w-full max-w-lg rounded-2xl border border-surface-border bg-surface-card p-6 space-y-4 relative" onClick={(e) => e.stopPropagation()}>
            <button type="button" onClick={() => !acting && setApproveTarget(null)} disabled={!!acting} className="absolute top-4 right-4 p-2 rounded-lg border border-surface-border text-white/60">
              <X size={18} />
            </button>
            <h3 className="text-xl font-black text-white pr-10">Confirm INR payout</h3>
            <p className="text-sm text-white/60">
              After you send {fmtInr(approveTarget.amount_inr)} to the user&apos;s bank or UPI, confirm below.
              This completes their Delta sell — reserved Delta ({fmtIbo(approveTarget.amount_ibo)}) is settled; nothing is sent on-chain.
            </p>
            <div className="rounded-xl border border-white/10 bg-surface-dark p-3">
              <PayoutDetailsBlock row={approveTarget} />
            </div>
            <label className="block text-xs font-bold text-white/50 uppercase">
              Payout UTR / reference *
              <input
                value={payoutRef}
                onChange={(e) => setPayoutRef(e.target.value)}
                placeholder="Bank or UPI transaction reference"
                required
                className="mt-1 w-full rounded-xl border border-surface-border bg-surface-dark px-3 py-2 text-white text-sm font-mono"
              />
            </label>
            <label className="block text-xs font-bold text-white/50 uppercase">
              Internal note
              <input
                value={approveNote}
                onChange={(e) => setApproveNote(e.target.value)}
                placeholder="Optional"
                className="mt-1 w-full rounded-xl border border-surface-border bg-surface-dark px-3 py-2 text-white text-sm"
              />
            </label>
            <div className="flex justify-end gap-2">
              <button type="button" disabled={!!acting} onClick={() => setApproveTarget(null)} className="px-4 py-2 rounded-xl border border-surface-border text-sm font-bold text-white">Cancel</button>
              <button
                type="button"
                disabled={!!acting || !payoutRef.trim()}
                onClick={doApprove}
                className="px-4 py-2 rounded-xl bg-emerald-500/25 border border-emerald-500/45 text-emerald-100 text-sm font-bold disabled:opacity-40"
              >
                {acting ? 'Processing…' : 'Confirm approve'}
              </button>
            </div>
          </div>
        </div>
      )}

      {rejectTarget && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/70 p-4">
          <div className="bg-surface-card border border-surface-border rounded-2xl p-6 max-w-md w-full space-y-4 relative">
            <button type="button" onClick={() => setRejectTarget(null)} disabled={!!acting} className="absolute top-4 right-4 p-2 rounded-lg border border-surface-border text-white/60">
              <X size={18} />
            </button>
            <h3 className="text-lg font-bold text-white pr-10">Reject withdrawal</h3>
            <p className="text-sm text-white/60">{rejectTarget.uid} · {fmtInr(rejectTarget.amount_inr)} · Delta will be unlocked</p>
            <textarea
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              rows={4}
              placeholder="Reason for rejection"
              className="w-full rounded-xl border border-surface-border bg-surface-dark px-3 py-2 text-white text-sm"
            />
            <div className="flex gap-2 justify-end">
              <button type="button" onClick={() => setRejectTarget(null)} className="px-4 py-2 rounded-xl border border-surface-border text-sm font-bold text-white">Cancel</button>
              <button type="button" disabled={!!acting} onClick={doReject} className="px-4 py-2 rounded-xl bg-red-500/30 text-red-200 text-sm font-bold border border-red-500/40">
                {acting ? 'Rejecting…' : 'Reject'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
