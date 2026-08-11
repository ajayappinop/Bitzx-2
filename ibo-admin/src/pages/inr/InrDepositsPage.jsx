import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  IndianRupee, RefreshCw, CheckCircle, XCircle, Eye, Clock, AlertCircle, X, Search,
} from 'lucide-react';
import { api } from '@/lib/api';
import { useAdminAuth } from '@/context/AdminAuthContext';
import { hasPermission } from '@/lib/adminAccess';
import { AdminPageHeader, AdminPanel, AdminDataTable } from '@/components/AdminPrimitives';

const BACKEND = import.meta.env.VITE_BACKEND_URL || 'http://localhost:8000';

function uploadUrl(path) {
  if (!path) return '';
  if (path.startsWith('http')) return path;
  return `${BACKEND}${path}`;
}

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

/** Table cell: short display + hover title with full precision when abbreviated or trimmed. */
function fmtInrTable(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return { display: '—', title: '' };
  const full = fmtInr(v);
  if (Math.abs(v) >= 10_000_000) {
    const display = new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      notation: 'compact',
      maximumFractionDigits: 2,
    }).format(v);
    return { display, title: full };
  }
  return { display: full, title: '' };
}

function fmtIboTable(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return { display: '—', title: '' };
  const full = fmtIbo(v);
  const abs = Math.abs(v);
  if (abs >= 1_000_000) {
    const display = new Intl.NumberFormat('en-US', {
      notation: 'compact',
      maximumFractionDigits: 4,
    }).format(v);
    return { display, title: `${full} Delta` };
  }
  if (abs >= 10_000) {
    const display = v.toLocaleString(undefined, { maximumFractionDigits: 4 });
    return { display, title: full };
  }
  const trimmed = full.replace(/(\.\d*?[1-9])0+$/, '$1').replace(/\.$/, '');
  return { display: trimmed, title: trimmed !== full ? full : '' };
}

function TableAmount({ display, title, className = '', sub = null }) {
  return (
    <div className="inline-block max-w-full min-w-0">
      <span
        className={`block truncate tabular-nums ${className}`}
        title={title || undefined}
      >
        {display}
      </span>
      {sub}
    </div>
  );
}

function fmtUsd(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return '—';
  return `$${v.toFixed(6)}`;
}

function rowIboAmount(row) {
  const st = String(row.status || '').toLowerCase();
  if (st === 'approved') return row.amount_ibo;
  if (st === 'pending' || st === 'approving') {
    return row.preview_amount_ibo ?? row.amount_ibo;
  }
  return null;
}

function paymentMethodTypeLabel(type) {
  const t = String(type || '').toLowerCase();
  if (t === 'bank') return 'Bank';
  if (t === 'upi') return 'UPI';
  if (t === 'qr') return 'QR';
  return type ? String(type) : '—';
}

/** List column: method kind (UPI/Bank/QR); tooltip holds account/display label when different. */
function paymentMethodListCell(row) {
  const kind = paymentMethodTypeLabel(row.payment_method_type);
  const detail = (row.payment_method_label || '').trim();
  const title = detail && detail.toLowerCase() !== kind.toLowerCase() ? detail : '';
  return { kind, title };
}

const STATUS_STYLES = {
  pending: { bg: 'bg-gold/15 text-gold-light', icon: Clock, label: 'Pending' },
  approved: { bg: 'bg-emerald-500/15 text-emerald-300', icon: CheckCircle, label: 'Approved' },
  rejected: { bg: 'bg-red-500/15 text-red-300', icon: XCircle, label: 'Rejected' },
  approving: { bg: 'bg-sky-500/15 text-sky-300', icon: RefreshCw, label: 'Processing' },
};

function StatusPill({ status }) {
  const st = String(status || '').toLowerCase();
  const def = STATUS_STYLES[st] || { bg: 'bg-white/10 text-white/70', icon: AlertCircle, label: status || '—' };
  const Icon = def.icon;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold uppercase ${def.bg}`}>
      <Icon size={10} className={st === 'approving' ? 'animate-spin' : ''} />
      {def.label}
    </span>
  );
}

/** Match backend ``ibo_amount_from_inr`` rounding. */
function iboAmountFromInr(amountInr, rate) {
  const inr = Number(amountInr);
  const per = Number(rate?.ibo_per_inr);
  if (!Number.isFinite(inr) || inr <= 0 || !Number.isFinite(per) || per <= 0) return null;
  return Math.round(inr * per * 1e8) / 1e8;
}

function buildInrPreview(amountInr, rate) {
  if (!rate?.ibo_per_inr) return null;
  const amount_ibo = iboAmountFromInr(amountInr, rate);
  if (amount_ibo == null) return null;
  return {
    amount_inr: Number(amountInr),
    amount_ibo,
    ibo_usdt: rate.ibo_usdt,
    inr_per_usdt: rate.inr_per_usdt,
    ibo_per_inr: rate.ibo_per_inr,
  };
}

/** Poll lightweight ``/api/admin/inr/rate`` while the deposits page is open. */
function useInrLiveRate(intervalMs = 1000) {
  const [rate, setRate] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;

    async function fetchRate() {
      try {
        const r = await api.inrRate();
        const j = await r.json();
        if (!alive) return;
        if (!r.ok) throw new Error(j.detail || `HTTP ${r.status}`);
        if (!(j.ibo_usdt > 0)) {
          setRate(null);
          setError('Delta price is zero or missing in platform controls.');
          return;
        }
        setRate({
          inr_per_usdt: j.inr_per_usdt,
          ibo_usdt: j.ibo_usdt,
          ibo_per_inr: j.ibo_per_inr,
        });
        setError('');
      } catch (e) {
        if (!alive) return;
        setError(e.message || 'Could not load Delta rate');
      } finally {
        if (alive) setLoading(false);
      }
    }

    fetchRate();
    const timer = setInterval(fetchRate, intervalMs);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [intervalMs]);

  return { rate, error, loading };
}

const STATUS_OPTIONS = [
  { value: 'pending', label: 'Pending (needs action)' },
  { value: '', label: 'All statuses' },
  { value: 'approving', label: 'Processing' },
  { value: 'approved', label: 'Approved' },
  { value: 'rejected', label: 'Rejected' },
];

const fieldClass =
  'h-9 rounded-lg bg-surface-dark border border-surface-border px-3 text-sm font-semibold text-white';
const searchClass =
  'h-9 w-full min-w-[200px] sm:w-56 rounded-lg bg-surface-dark border border-surface-border pl-8 pr-3 text-sm text-white font-mono placeholder:text-white/35 outline-none focus:border-gold/40';

function DetailRow({ label, children }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wide text-white/40 mb-1">{label}</p>
      <div className="text-sm text-white/90">{children}</div>
    </div>
  );
}

function DepositDetailModal({ row, onClose, canAct, acting, onApprove, onReject, liveRate }) {
  if (!row) return null;
  const st = String(row.status || '').toLowerCase();
  const pending = st === 'pending';
  const approving = st === 'approving';
  const approved = st === 'approved';
  const ibo = (pending && liveRate)
    ? iboAmountFromInr(row.amount_inr, liveRate)
    : rowIboAmount(row);
  const iboLabel = approved ? 'Delta credited' : approving ? 'Delta (processing)' : pending ? 'Est. Delta' : 'Delta';
  const proofSrc = row.screenshot_url ? uploadUrl(row.screenshot_url) : '';

  return (
    <div
      className="fixed inset-0 z-[100] bg-black/75 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="w-full max-w-4xl max-h-[min(90vh,720px)] flex flex-col rounded-2xl border border-surface-border bg-surface-card shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="inr-deposit-detail-title"
      >
        <div className="shrink-0 flex items-start justify-between gap-3 px-5 py-4 border-b border-surface-border bg-surface-card">
          <div className="min-w-0 pr-2">
            <div className="flex flex-wrap items-center gap-2 mb-1">
              <h3 id="inr-deposit-detail-title" className="text-lg font-bold text-white">Deposit details</h3>
              <StatusPill status={row.status} />
            </div>
            <p className="text-xs text-white/45 font-mono truncate" title={row.id}>{row.id}</p>
            <p className="text-xs text-white/50 mt-0.5">Submitted {fmtTs(row.created_at)}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="shrink-0 p-2 rounded-lg border border-surface-border text-white/60 hover:text-white hover:bg-white/10 transition-colors"
          >
            <X size={18} strokeWidth={2.5} />
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto p-5">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <div className="min-w-0 space-y-4">
              <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                <DetailRow label="Amount (INR)">
                  <span className="text-base font-bold text-white tabular-nums">{fmtInr(row.amount_inr)}</span>
                </DetailRow>
                <DetailRow label={iboLabel}>
                  <span className="font-mono text-sm text-gold-light font-bold tabular-nums">{fmtIbo(ibo)}</span>
                  {pending && ibo == null && (
                    <p className="text-[10px] text-gold-light mt-0.5 leading-tight">Rate unavailable</p>
                  )}
                </DetailRow>

                <div className="col-span-2">
                  <DetailRow label="User ID">
                    <Link to={`/users/${row.uid}`} className="font-mono text-xs text-gold-light hover:underline break-all">
                      {row.uid}
                    </Link>
                  </DetailRow>
                </div>

                {row.user_email && (
                  <DetailRow label="Email">
                    <span className="text-sm break-all">{row.user_email}</span>
                  </DetailRow>
                )}
                {row.user_name && (
                  <DetailRow label="Name">
                    <span className="text-sm">{row.user_name}</span>
                  </DetailRow>
                )}

                <DetailRow label="UTR / reference">
                  <span className="font-mono text-xs break-all">{row.utr_number || '—'}</span>
                </DetailRow>
                <DetailRow label="Payment method">
                  <div className="space-y-0.5">
                    <span className="inline-flex px-2 py-0.5 rounded-md text-[10px] font-bold uppercase bg-white/10 text-white/90">
                      {paymentMethodTypeLabel(row.payment_method_type)}
                    </span>
                    {row.payment_method_label && (
                      <p className="text-xs text-white/65 leading-snug">{row.payment_method_label}</p>
                    )}
                  </div>
                </DetailRow>

                {(row.note || approved || (st === 'rejected' && row.rejection_reason)) && (
                  <div className="col-span-2 space-y-3">
                    {row.note && (
                      <DetailRow label="User note">
                        <span className="text-sm text-white/75 whitespace-pre-wrap line-clamp-4">{row.note}</span>
                      </DetailRow>
                    )}
                    {approved && (
                      <div className="rounded-xl border border-white/10 bg-white/[.03] p-3 text-xs font-mono text-white/55 grid grid-cols-2 gap-2">
                        <p>Locked Delta {fmtUsd(row.ibo_usdt_at_time)}</p>
                        <p>INR/USDT {row.inr_per_usdt_at_time != null ? Number(row.inr_per_usdt_at_time).toFixed(2) : '—'}</p>
                      </div>
                    )}
                    {st === 'rejected' && row.rejection_reason && (
                      <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-3">
                        <p className="text-[10px] uppercase text-red-300/80 mb-1">Rejection reason</p>
                        <p className="text-sm text-red-200/90">{row.rejection_reason}</p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            <div className="min-w-0 flex flex-col">
              <p className="text-[10px] uppercase tracking-wide text-white/40 mb-2">Payment proof</p>
              {proofSrc ? (
                <a
                  href={proofSrc}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex-1 flex flex-col min-h-[200px] md:min-h-0 rounded-xl border border-surface-border bg-surface-card overflow-hidden hover:border-gold/30 transition-colors"
                >
                  <img
                    src={proofSrc}
                    alt="Payment screenshot"
                    className="w-full h-full min-h-[200px] max-h-[min(42vh,360px)] object-contain"
                  />
                </a>
              ) : (
                <div className="flex-1 min-h-[120px] rounded-xl border border-dashed border-surface-border bg-white/[.02] flex items-center justify-center px-4 text-sm text-white/45 text-center">
                  No screenshot uploaded
                </div>
              )}
              {proofSrc && (
                <p className="text-[11px] text-white/40 mt-2 text-center">Click image to open full size</p>
              )}
            </div>
          </div>
        </div>

        {pending && canAct && (
          <div className="shrink-0 flex flex-wrap gap-2 px-5 py-4 border-t border-surface-border bg-surface-card/95">
            <button
              type="button"
              disabled={!!acting}
              onClick={() => { onClose(); onApprove(row); }}
              className="flex-1 min-w-[140px] !min-h-0 h-10 inline-flex items-center justify-center gap-2 px-4 rounded-xl text-sm font-bold bg-emerald-500/20 text-emerald-200 border border-emerald-500/40 hover:bg-emerald-500/30 hover:!translate-y-0 disabled:opacity-40"
            >
              <CheckCircle size={16} />
              Approve
            </button>
            <button
              type="button"
              disabled={!!acting}
              onClick={() => { onClose(); onReject(row); }}
              className="flex-1 min-w-[120px] !min-h-0 h-10 inline-flex items-center justify-center gap-2 px-4 rounded-xl text-sm font-bold bg-red-500/15 text-red-200 border border-red-500/40 hover:bg-red-500/25 hover:!translate-y-0 disabled:opacity-40"
            >
              <XCircle size={16} />
              Reject
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function RateBanner({ rate, rateError, rateLoading }) {
  if (rateError && !rate?.ibo_usdt) {
    return (
      <div className="mb-4 rounded-xl border border-rose-500/35 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
        <strong>Could not load Delta credit rate.</strong> {rateError}
      </div>
    );
  }
  if (!rate?.ibo_usdt) {
    if (!rateLoading) return null;
    return (
      <div className="mb-4 rounded-xl border border-cyan-500/25 bg-cyan-500/10 px-4 py-3 text-sm text-white/55 animate-pulse">
        Loading live Delta rate…
      </div>
    );
  }
  return (
    <div className="mb-4 rounded-xl border border-cyan-500/25 bg-cyan-500/10 px-4 py-3 text-sm">
      <span className="text-[11px] font-bold uppercase text-cyan-200/80">Live credit rate </span>
      <span className="text-white/50 mx-2">·</span>
      <span className="text-white font-mono">{fmtUsd(rate.ibo_usdt)} Delta</span>
      <span className="text-white/50 mx-2">·</span>
      <span className="text-white/80">INR/USDT {Number(rate.inr_per_usdt).toFixed(2)}</span>
      <span className="text-white/50 mx-2">·</span>
      <span className="text-gold-light font-mono">1 INR ≈ {fmtIbo(rate.ibo_per_inr)} Delta</span>
    </div>
  );
}

export default function InrDepositsPage() {
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
  const [rejectTarget, setRejectTarget] = useState(null);
  const [rejectReason, setRejectReason] = useState('');
  const [acting, setActing] = useState('');

  const approveProcessing = !!(approveTarget && acting === approveTarget.id);
  const { rate: liveRate, error: liveRateError, loading: liveRateLoading } = useInrLiveRate(1000);

  const approveLivePreview = useMemo(
    () => (approveTarget ? buildInrPreview(approveTarget.amount_inr, liveRate) : null),
    [approveTarget, liveRate],
  );

  const load = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setLoading(true);
    setErr('');
    try {
      const params = { skip: String(skip), limit: String(limit) };
      if (statusFilter) params.status = statusFilter;
      if (uidFilter.trim()) params.uid = uidFilter.trim();
      const r = await api.inrDeposits(params);
      const j = await r.json();
      if (!r.ok) throw new Error(j.detail || `HTTP ${r.status}`);
      setItems(Array.isArray(j.items) ? j.items : []);
      setTotal(Number.isFinite(j.total) ? j.total : 0);
    } catch (e) {
      setErr(e.message || 'Could not load INR deposits');
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

  const doApprove = async (row) => {
    if (!row?.id) return;
    setActing(row.id);
    setErr('');
    setOk('');
    try {
      const r = await api.inrApproveDeposit(row.id, {});
      const j = await r.json();
      if (!r.ok) throw new Error(j.detail || `HTTP ${r.status}`);
      setApproveTarget(null);
      setDetailRow(null);
      await load({ silent: true });
      setOk(`${row.uid} — ${fmtIbo(j.amount_ibo)} Delta credited`);
    } catch (e) {
      const msg = e.message || 'Approve failed';
      if (/not pending|already processed|awaiting approval/i.test(msg)) {
        setErr('This deposit is already being processed or was completed. Refresh the list.');
      } else {
        setErr(msg);
      }
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
      const r = await api.inrRejectDeposit(row.id, { reason });
      if (!r.ok) {
        const j = await r.json();
        throw new Error(j.detail || `HTTP ${r.status}`);
      }
      setOk(`Rejected deposit for ${row.uid}`);
      setRejectTarget(null);
      setRejectReason('');
      setDetailRow(null);
      await load({ silent: true });
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
        title="INR deposits"
        subtitle="Open each deposit to review proof and details, then approve or reject from the detail view."
      />

      <RateBanner rate={liveRate} rateError={liveRateError} rateLoading={liveRateLoading} />

      {!canAct && (
        <div className="mb-4 rounded-xl border border-gold/30 bg-gold/10 px-4 py-3 text-sm text-gold-light/90">
          Approve / reject in the detail view requires <code className="text-gold-light">manage_treasury</code> (finance or superadmin).
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-surface-border bg-surface-card px-3 py-2.5 mb-4">
        <select
          value={statusFilter}
          onChange={(e) => { setStatusFilter(e.target.value); setSkip(0); }}
          className={fieldClass}
          aria-label="Filter by status"
        >
          {STATUS_OPTIONS.map((o) => (
            <option key={o.value || 'all'} value={o.value}>{o.label}</option>
          ))}
        </select>
        <div className="relative min-w-0">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-white/45 pointer-events-none" />
          <input
            type="text"
            value={uidFilter}
            onChange={(e) => { setUidFilter(e.target.value); setSkip(0); }}
            placeholder="Filter by user UID"
            className={searchClass}
            aria-label="Filter by user UID"
          />
        </div>
        {uidFilter ? (
          <button
            type="button"
            onClick={() => { setUidFilter(''); setSkip(0); }}
            className="h-9 px-4 rounded-lg border border-surface-border text-sm font-bold text-white/90 shrink-0"
          >
            Clear UID
          </button>
        ) : null}
        <Link
          to="/inr-settings"
          className="h-9 inline-flex items-center px-4 rounded-lg border border-surface-border text-sm font-bold text-gold-light shrink-0 hover:bg-gold/10"
        >
          Payment methods →
        </Link>
        <button
          type="button"
          onClick={() => load()}
          disabled={loading && items.length === 0}
          className="inline-flex h-9 items-center gap-2 px-3 rounded-lg border border-surface-border text-sm font-bold text-white/90 shrink-0 disabled:opacity-40 ml-auto"
        >
          <RefreshCw size={14} className={loading && items.length === 0 ? 'animate-spin' : ''} /> Refresh
        </button>
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
                <th>User ID</th>
                <th className="min-w-[7.5rem] max-w-[11rem]">INR</th>
                <th className="min-w-[7.5rem] max-w-[11rem]">Delta</th>
                <th>Method</th>
                <th>Status</th>
                <th className="whitespace-nowrap">Submitted</th>
                <th className="min-w-[5.5rem]">View</th>
              </tr>
            </thead>
            <tbody>
              {loading && items.length === 0 ? (
                <tr><td colSpan={7} className="text-center text-white/50 !py-12">Loading…</td></tr>
              ) : items.length === 0 ? (
                <tr><td colSpan={7} className="text-center text-white/50 !py-12">No deposits found.</td></tr>
              ) : (
                items.map((row) => {
                  const st = String(row.status || '').toLowerCase();
                  const pending = st === 'pending';
                  const ibo = (pending && liveRate)
                    ? (iboAmountFromInr(row.amount_inr, liveRate) ?? rowIboAmount(row))
                    : rowIboAmount(row);
                  const inrCell = fmtInrTable(row.amount_inr);
                  const iboCell = fmtIboTable(ibo);
                  const methodCell = paymentMethodListCell(row);
                  return (
                    <tr key={row.id}>
                      <td className="text-center">
                        <Link
                          to={`/users/${row.uid}`}
                          className="inline-block font-mono text-[11px] text-gold-light hover:underline max-w-[120px] truncate"
                          title={row.uid}
                        >
                          {row.uid}
                        </Link>
                      </td>
                      <td className="text-center max-w-[11rem]">
                        <TableAmount
                          display={inrCell.display}
                          title={inrCell.title}
                          className="font-semibold text-white"
                        />
                      </td>
                      <td className="text-center max-w-[11rem]">
                        <TableAmount
                          display={iboCell.display}
                          title={iboCell.title}
                          className="font-mono text-xs text-gold-light"
                          sub={pending && ibo != null ? (
                            <span className="block text-[9px] text-white/35 font-sans normal-case">est.</span>
                          ) : null}
                        />
                      </td>
                      <td className="text-center">
                        <span
                          className="inline-block text-xs font-bold uppercase text-white/90"
                          title={methodCell.title || undefined}
                        >
                          {methodCell.kind}
                        </span>
                      </td>
                      <td className="text-center">
                        <StatusPill status={row.status} />
                      </td>
                      <td className="text-center text-xs text-white/55 whitespace-nowrap">
                        {fmtTs(row.created_at)}
                      </td>
                      <td className="text-center">
                        <button
                          type="button"
                          onClick={() => setDetailRow(row)}
                          className="!min-h-0 h-8 shrink-0 px-3 text-[11px] font-bold rounded-md border border-surface-border text-white/80 bg-white/5 hover:bg-white/10 hover:!translate-y-0 inline-flex items-center justify-center gap-1"
                        >
                          <Eye size={12} /> View
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
      </AdminDataTable>

      <div className="flex items-center justify-between mt-4 text-sm text-white/60">
        <span>Page {page} / {pages} · {total} total</span>
        <div className="flex gap-2">
          <button
            type="button"
            disabled={skip <= 0}
            onClick={() => setSkip((s) => Math.max(0, s - limit))}
            className="px-3 py-1.5 rounded-lg border border-surface-border disabled:opacity-40"
          >
            Prev
          </button>
          <button
            type="button"
            disabled={skip + limit >= total}
            onClick={() => setSkip((s) => s + limit)}
            className="px-3 py-1.5 rounded-lg border border-surface-border disabled:opacity-40"
          >
            Next
          </button>
        </div>
      </div>

      <DepositDetailModal
        row={detailRow}
        onClose={() => setDetailRow(null)}
        canAct={canAct}
        acting={acting}
        onApprove={setApproveTarget}
        onReject={(r) => { setRejectTarget(r); setRejectReason(''); }}
        liveRate={liveRate}
      />

      {approveTarget && (
        <div
          className="fixed inset-0 z-[120] bg-black/75 backdrop-blur-md flex items-center justify-center p-4"
          onClick={() => !acting && setApproveTarget(null)}
          role="presentation"
        >
          <div
            className="w-full max-w-lg rounded-3xl border border-surface-border bg-surface-card p-6 shadow-2xl space-y-5 relative"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => !acting && setApproveTarget(null)}
              disabled={!!acting}
              aria-label="Close"
              className="absolute top-4 right-4 p-2 rounded-lg border border-surface-border text-white/60 hover:text-white hover:bg-white/10 disabled:opacity-40"
            >
              <X size={18} strokeWidth={2.5} />
            </button>
            <h3 className="text-xl font-black text-white pr-10">
              {approveProcessing ? 'Processing approval…' : 'Approve INR deposit'}
            </h3>
            <p className="text-sm text-white/60">
              {fmtInr(approveTarget.amount_inr)} · user <span className="font-mono text-white">{approveTarget.uid}</span>
            </p>

            {approveProcessing && (
              <div className="rounded-xl border border-sky-500/35 bg-sky-500/10 px-4 py-3 flex items-start gap-3">
                <RefreshCw size={18} className="text-sky-300 shrink-0 animate-spin mt-0.5" />
                <div className="text-sm text-sky-100/90">
                  <p className="font-bold text-sky-200">Crediting Delta to wallet</p>
                  <p className="text-xs text-white/55 mt-1">Do not close this window until it finishes.</p>
                </div>
              </div>
            )}

            <div className={`rounded-xl border border-cyan-500/30 bg-cyan-500/10 p-4 space-y-2 ${approveProcessing ? 'opacity-60 pointer-events-none' : ''}`}>
              <p className="text-xs font-bold uppercase text-cyan-200/80">Live Delta price</p>
              {approveLivePreview ? (
                <>
                  <p className="text-2xl font-black text-white font-mono">
                    {fmtUsd(approveLivePreview.ibo_usdt)}
                  </p>
                  <p className="text-xs text-white/55">
                    INR/USDT {Number(approveLivePreview.inr_per_usdt).toFixed(2)}
                    {' · '}
                    1 INR ≈ {fmtIbo(approveLivePreview.ibo_per_inr)} Delta
                  </p>
                </>
              ) : (
                <p className="text-sm text-white/50 animate-pulse">Loading live rate…</p>
              )}
            </div>

            <div className={`rounded-xl border border-gold/25 bg-gold/5 p-4 ${approveProcessing ? 'opacity-60' : ''}`}>
              <p className="text-xs text-white/55 uppercase font-bold mb-1">Delta to credit</p>
              <p className="text-2xl font-black text-gold-light font-mono">
                {approveLivePreview?.amount_ibo != null ? `${fmtIbo(approveLivePreview.amount_ibo)} Delta` : '—'}
              </p>
            </div>

            {!approveProcessing && !approveLivePreview && liveRateError && (
              <p className="text-sm text-gold-light">{liveRateError}</p>
            )}

            <div className="flex flex-col-reverse sm:flex-row justify-end gap-2">
              <button
                type="button"
                disabled={!!acting}
                onClick={() => setApproveTarget(null)}
                className="px-4 py-3 rounded-xl border border-surface-border text-sm font-bold text-white disabled:opacity-40"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={approveProcessing || approveLivePreview?.amount_ibo == null}
                onClick={() => doApprove(approveTarget)}
                className="px-4 py-3 rounded-xl text-sm font-bold bg-emerald-500/25 border border-emerald-500/45 text-emerald-100 disabled:opacity-40"
              >
                {approveProcessing ? 'Processing…' : 'Confirm approve'}
              </button>
            </div>
          </div>
        </div>
      )}

      {rejectTarget && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/70 p-4">
          <div className="bg-surface-card border border-surface-border rounded-2xl p-6 max-w-md w-full space-y-4 relative">
            <button
              type="button"
              onClick={() => setRejectTarget(null)}
              disabled={!!acting}
              aria-label="Close"
              className="absolute top-4 right-4 p-2 rounded-lg border border-surface-border text-white/60 hover:text-white hover:bg-white/10 disabled:opacity-40"
            >
              <X size={18} strokeWidth={2.5} />
            </button>
            <h3 className="text-lg font-bold text-white pr-10">Reject deposit</h3>
            <p className="text-sm text-white/60 font-mono">{rejectTarget.uid} · {fmtInr(rejectTarget.amount_inr)}</p>
            <textarea
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              rows={4}
              placeholder="Reason for rejection"
              className="w-full rounded-xl border border-surface-border bg-surface-dark px-3 py-2 text-white text-sm"
            />
            <div className="flex gap-2 justify-end">
              <button
                type="button"
                onClick={() => setRejectTarget(null)}
                className="px-4 py-2 rounded-xl border border-surface-border text-sm font-bold text-white"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={!!acting}
                onClick={doReject}
                className="px-4 py-2 rounded-xl bg-red-500/30 text-red-200 text-sm font-bold border border-red-500/40"
              >
                {acting ? 'Rejecting…' : 'Reject'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
