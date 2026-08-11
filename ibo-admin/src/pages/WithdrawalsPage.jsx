import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  ArrowUpCircle, Search, RefreshCw, CheckCircle, XCircle, AlertCircle, Clock,
} from 'lucide-react';
import { api } from '@/lib/api';
import { useAdminAuth } from '@/context/AdminAuthContext';
import ConfirmModal from '@/components/ConfirmModal';
import CoinAvatar from '@/components/CoinAvatar';
import { describeTreasuryGateReason, shortTreasuryGateLabel } from '@/lib/treasuryUx';
import { AdminDataTable, AdminPageHeader } from '@/components/AdminPrimitives';

// Phase 6 — admin queue for on-chain withdrawals.
//
// Responsibilities:
//   - Surface every ``withdrawal_requests`` row with enough context
//     (amount, fee, destination, tx_hash, reject reasons) to triage.
//   - Let ops approve pending-approval rows (hands off to executor).
//   - Let ops reject pending-approval rows (refunds the user atomically).
//
// Broadcast/confirmation progress is read-only — that happens via the
// ``withdrawal_executor`` worker. Every state transition is surfaced
// via status + timestamps, no admin action needed.

const STATUS_BADGES = {
  pending_approval: { bg: 'bg-yellow-500/15 text-gold-light',   icon: Clock,       label: 'Pending approval' },
  awaiting_treasury: { bg: 'bg-gold/20 text-gold-light',   icon: AlertCircle, label: 'Waiting: payout wallet' },
  on_hold:          { bg: 'bg-violet-500/15 text-violet-200',   icon: AlertCircle, label: 'On hold' },
  approved:         { bg: 'bg-sky-500/15 text-sky-300',         icon: CheckCircle, label: 'Approved' },
  broadcasting:     { bg: 'bg-sky-500/15 text-sky-300',         icon: RefreshCw,   label: 'Broadcasting' },
  broadcasted:      { bg: 'bg-sky-500/15 text-sky-300',         icon: RefreshCw,   label: 'Broadcasted' },
  confirmed:        { bg: 'bg-green-500/15 text-green-300',     icon: CheckCircle, label: 'Confirmed' },
  rejected:         { bg: 'bg-red-500/15 text-red-300',         icon: XCircle,     label: 'Rejected' },
  failed:           { bg: 'bg-red-500/15 text-red-300',         icon: XCircle,     label: 'Failed' },
};

function StatusPill({ status }) {
  const def = STATUS_BADGES[status] || { bg: 'bg-white/10 text-white/70', icon: AlertCircle, label: status || 'Unknown' };
  const Icon = def.icon;
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px] font-bold uppercase tracking-wider ${def.bg}`}>
      <Icon size={11} /> {def.label}
    </span>
  );
}

function fmtTs(iso) {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleString(); }
  catch { return String(iso); }
}

function trimAddress(addr) {
  if (!addr) return '—';
  if (addr.length <= 20) return addr;
  return `${addr.slice(0, 10)}…${addr.slice(-6)}`;
}

export default function WithdrawalsPage() {
  const [searchParams] = useSearchParams();
  const { admin } = useAdminAuth();
  const privileged = admin && ['superadmin', 'finance'].includes(String(admin.role || '').toLowerCase());

  const [items,   setItems]   = useState([]);
  const [total,   setTotal]   = useState(0);
  const [loading, setLoading] = useState(true);
  const [err,     setErr]     = useState('');
  const [ok,      setOk]      = useState('');

  // Filters — most common first so the queue opens on "needs approval".
  const [statusFilter, setStatusFilter] = useState(searchParams.get('status') || 'pending_approval');
  const [searchQ, setSearchQ] = useState(searchParams.get('uid') || searchParams.get('q') || '');
  const [appliedQ, setAppliedQ] = useState(
    () => String(searchParams.get('uid') || searchParams.get('q') || '').trim(),
  );
  const [assetFilter, setAssetFilter] = useState('');
  const [riskFilter, setRiskFilter] = useState('');
  const [skip, setSkip] = useState(0);
  const [limit, setLimit] = useState(25);

  // Confirm-modal state. We reuse the same modal for approve + reject so the
  // UI stays compact; ``action`` selects behaviour and ``row`` holds context.
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [action, setAction] = useState('approve');
  const [activeRow, setActiveRow] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (override) => {
    const active = {
      skip: override?.skip ?? skip,
      limit: override?.limit ?? limit,
      statusFilter: override?.statusFilter ?? statusFilter,
      assetFilter: override?.assetFilter ?? assetFilter,
      riskFilter: override?.riskFilter ?? riskFilter,
      q: override?.q ?? appliedQ,
    };
    setLoading(true);
    setErr('');
    try {
      const params = { skip: String(active.skip), limit: String(active.limit) };
      if (active.statusFilter) params.status = active.statusFilter;
      if (active.assetFilter) params.asset = active.assetFilter;
      if (active.riskFilter.trim()) params.risk_flag = active.riskFilter.trim();
      if (String(active.q || '').trim()) params.q = String(active.q).trim();

      const r = await api.withdrawals(params);
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.detail || `HTTP ${r.status}`);
      setItems(Array.isArray(j.items) ? j.items : []);
      setTotal(Number.isFinite(j.total) ? j.total : 0);
    } catch (e) {
      setErr(e.message || 'Could not load withdrawals');
      setItems([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [skip, limit, statusFilter, assetFilter, riskFilter, appliedQ]);

  useEffect(() => { load(); }, [skip, limit, statusFilter, assetFilter, riskFilter, appliedQ]); // eslint-disable-line react-hooks/exhaustive-deps

  function applySearch(raw) {
    setSkip(0);
    setAppliedQ(String(raw || '').trim());
  }

  function clearFilters() {
    setSkip(0);
    setStatusFilter('pending_approval');
    setSearchQ('');
    setAppliedQ('');
    setAssetFilter('');
    setRiskFilter('');
  }

  const pages = useMemo(() => Math.max(1, Math.ceil(total / limit)), [total, limit]);
  const page  = useMemo(() => Math.floor(skip / limit) + 1, [skip, limit]);

  const openApprove = (row) => {
    setAction('approve');
    setActiveRow(row);
    setConfirmOpen(true);
  };
  const openReject = (row) => {
    setAction('reject');
    setActiveRow(row);
    setConfirmOpen(true);
  };
  const openHold = (row) => {
    setAction('hold');
    setActiveRow(row);
    setConfirmOpen(true);
  };

  const performAction = async (value) => {
    if (!activeRow) return;
    setBusy(true);
    setErr('');
    setOk('');
    try {
      if (action === 'approve') {
        const r = await api.approveWithdrawal(activeRow.id, {});
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j.detail || 'Approve failed');
        if (j.withdrawal?.status === 'awaiting_treasury') {
          setOk(`Approved in principle. ${activeRow.id} is waiting until the hot wallet is set up correctly on the Hot & cold wallets page.`);
        } else {
          setOk(`Approved ${activeRow.id}`);
        }
      } else if (action === 'reject') {
        const reason = String(value || '').trim();
        if (reason.length < 3) {
          setErr('Please provide a reject reason (at least 3 characters).');
          setBusy(false);
          return;
        }
        const r = await api.rejectWithdrawal(activeRow.id, reason);
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j.detail || 'Reject failed');
        setOk(`Rejected ${activeRow.id}`);
      } else {
        const note = String(value || '').trim();
        const r = await api.holdWithdrawal(activeRow.id, { note: note || undefined });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j.detail || 'Hold failed');
        setOk(`On hold: ${activeRow.id}`);
      }
      setConfirmOpen(false);
      setActiveRow(null);
      await load();
    } catch (e) {
      setErr(e.message || 'Action failed');
    } finally {
      setBusy(false);
    }
  };

  const isPending = (s) => String(s || '').toLowerCase() === 'pending_approval';
  const canApprove = (s) => {
    const x = String(s || '').toLowerCase();
    return x === 'pending_approval' || x === 'on_hold';
  };
  const canReject = (s) => {
    const x = String(s || '').toLowerCase();
    return x === 'pending_approval' || x === 'on_hold' || x === 'awaiting_treasury';
  };

  return (
    <div className="admin-page">
      <AdminPageHeader
        icon={ArrowUpCircle}
        iconClassName="text-gold-light"
        title="Withdrawals"
        subtitle={(
          <>
            Review cash-out requests. <strong className="text-white/90">Approve</strong> lets the system send crypto to the user’s address once all checks pass.
            <strong className="text-white/90"> Reject</strong> unlocks their balance and cancels the payout.
            If a row says <em>Waiting: payout wallet</em>, finish setup on{' '}
            <Link to="/treasury-omnibus" className="text-gold-light font-semibold hover:underline">Hot & cold wallets</Link>
            {' '}— no amount of approving will send coins until that matches the server.
          </>
        )}
        badge={`${total.toLocaleString()} total`}
      />

      {err && <p className="text-red-400 text-sm mb-4">{err}</p>}
      {ok  && <p className="text-green-400 text-sm mb-4">{ok}</p>}

      {statusFilter === 'awaiting_treasury' && (
        <div className="mb-4 rounded-xl border border-gold/35 bg-gold/10 px-4 py-3 text-sm text-gold-light/90/95 flex flex-col gap-1">
          <span className="font-bold text-gold-light">These withdrawals are paused for a setup step</span>
          <span>
            The user already passed policy checks. The system will not broadcast until an <strong>enabled hot wallet</strong> is saved and it <strong>exactly matches</strong> the server payout address.
            Open <Link to="/treasury-omnibus" className="text-gold-light font-semibold hover:underline">Hot & cold wallets</Link> to fix it; rows usually move forward automatically after you save.
          </span>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-surface-border bg-surface-card px-3 py-2.5 mb-4">
          <div className="relative min-w-0 w-full sm:w-64 sm:flex-1 lg:flex-none">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-white/45 pointer-events-none" />
            <input
              value={searchQ}
              onChange={(e) => setSearchQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  applySearch(e.currentTarget.value);
                }
              }}
              placeholder="Search UID, address, or tx hash…"
              className="h-9 w-full rounded-lg bg-surface-dark border border-surface-border pl-8 pr-3 text-sm text-white font-mono placeholder:text-white/35 outline-none focus:border-gold/40"
              aria-label="Search by UID, destination address, or tx hash"
            />
          </div>
          <select
            value={statusFilter}
            onChange={(e) => { setSkip(0); setStatusFilter(e.target.value); }}
            className="h-9 rounded-lg bg-surface-dark border border-surface-border px-3 text-sm font-semibold text-white"
            aria-label="Filter by status"
          >
            <option value="">All statuses</option>
            <option value="pending_approval">Pending approval</option>
            <option value="on_hold">On hold</option>
            <option value="awaiting_treasury">Waiting: payout wallet</option>
            <option value="approved">Approved</option>
            <option value="broadcasting">Broadcasting</option>
            <option value="broadcasted">Broadcasted</option>
            <option value="confirmed">Confirmed</option>
            <option value="rejected">Rejected</option>
            <option value="failed">Failed</option>
          </select>
          <select
            value={assetFilter}
            onChange={(e) => { setSkip(0); setAssetFilter(e.target.value); }}
            className="h-9 rounded-lg bg-surface-dark border border-surface-border px-3 text-sm font-semibold text-white"
            aria-label="Filter by asset"
          >
            <option value="">All assets</option>
            {['USDT', 'ETH', 'USDT-ERC20', 'BTC'].map((a) => (
              <option key={a} value={a}>{a}</option>
            ))}
          </select>
          <select
            value={riskFilter}
            onChange={(e) => { setSkip(0); setRiskFilter(e.target.value); }}
            className="h-9 rounded-lg bg-surface-dark border border-surface-border px-3 text-sm font-semibold text-white"
            aria-label="Filter by risk flag"
          >
            <option value="">Any risk flag</option>
            <option value="large_amount">large_amount</option>
            <option value="new_address">new_address</option>
            <option value="velocity">velocity</option>
          </select>
          <button
            type="button"
            onClick={clearFilters}
            className="h-9 px-4 rounded-lg border border-surface-border text-sm font-bold text-white/90 shrink-0"
          >
            Clear
          </button>
          <button
            type="button"
            onClick={load}
            disabled={loading}
            className="inline-flex h-9 items-center gap-2 px-3 rounded-lg border border-surface-border text-sm font-bold text-white/90 shrink-0 disabled:opacity-40 ml-auto"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh
          </button>
      </div>

      <AdminDataTable minWidth="1200px">
            <thead>
              <tr>
                <th>ID</th>
                <th>User</th>
                <th>Asset</th>
                <th className="text-right">Amount</th>
                <th className="text-right">Fee</th>
                <th>Destination</th>
                <th>Tx hash</th>
                <th>Confirmations</th>
                <th>Risk</th>
                <th>Status</th>
                <th className="whitespace-nowrap">Created</th>
                <th className="text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={12} className="text-center text-white/50 !py-16">Loading…</td></tr>
              ) : items.length === 0 ? (
                <tr><td colSpan={12} className="text-center text-white/50 !py-16">No withdrawals found.</td></tr>
              ) : (
                items.map((row) => (
                  <tr key={row.id}>
                    <td className="font-mono text-[11px] text-white/80">{row.id}</td>
                    <td className="font-mono text-[11px] text-white">{row.uid}</td>
                    <td className="font-bold">
                      <span className="inline-flex items-center gap-2">
                        <CoinAvatar asset={row.asset} className="h-5 w-5" />
                        {row.asset}
                      </span>
                      <div className="text-[10px] font-normal text-white/45 mt-0.5">{row.network}</div>
                    </td>
                    <td className="text-right font-mono text-white">
                      {Number(row.amount || 0).toFixed(6)}
                    </td>
                    <td className="text-right font-mono text-xs text-white/65">
                      {Number(row.fee_amount || 0).toFixed(6)}
                    </td>
                    <td className="font-mono text-[11px] text-white/80" title={row.address}>
                      {trimAddress(row.address)}
                    </td>
                    <td className="font-mono text-[11px] text-white/65" title={row.tx_hash || ''}>
                      {row.tx_hash ? trimAddress(row.tx_hash) : '—'}
                    </td>
                    <td className="text-xs font-mono text-white/75">
                      {Number(row.threshold) > 0
                        ? `${Math.min(Number(row.confirmations || 0), Number(row.threshold))}/${Number(row.threshold)}`
                        : Number(row.confirmations || 0)}
                    </td>
                    <td className="text-[11px] text-white/70 max-w-[140px]">
                      {(row.risk_flags && row.risk_flags.length)
                        ? row.risk_flags.map((f) => (
                          <span key={f} className="inline-block mr-1 mb-1 px-1.5 py-0.5 rounded bg-gold/15 text-gold-light font-bold">{f}</span>
                        ))
                        : <span className="text-white/35">—</span>}
                    </td>
                    <td>
                      <StatusPill status={row.status} />
                      {row.auto_approved && row.status !== 'pending_approval' && (
                        <div className="text-[10px] text-white/40 mt-0.5">auto-approved</div>
                      )}
                      {row.reject_reason && (
                        <div className="text-[10px] text-red-300/80 mt-0.5 max-w-[200px] truncate" title={row.reject_reason}>
                          {row.reject_reason}
                        </div>
                      )}
                      {row.failure_reason && (
                        <div className="text-[10px] text-red-300/80 mt-0.5 max-w-[200px] truncate" title={row.failure_reason}>
                          {row.failure_reason}
                        </div>
                      )}
                      {row.treasury_gate_reason && (
                        <div
                          className="text-[10px] text-gold-light/90 mt-0.5 max-w-[240px] line-clamp-2"
                          title={describeTreasuryGateReason(row.treasury_gate_reason)}
                        >
                          <span className="text-white/50">Hold reason:</span>{' '}
                          {shortTreasuryGateLabel(row.treasury_gate_reason)}
                        </div>
                      )}
                    </td>
                    <td className="text-xs text-white/55 whitespace-nowrap">{fmtTs(row.created_at)}</td>
                    <td className="text-right">
                      {!privileged ? (
                        <span className="text-white/30 text-[11px]" title="Superadmin or finance role required">—</span>
                      ) : canApprove(row.status) || canReject(row.status) ? (
                        <div className="inline-flex flex-wrap justify-end gap-1.5">
                          {canApprove(row.status) && isPending(row.status) ? (
                            <button
                              type="button"
                              onClick={() => openHold(row)}
                              disabled={busy}
                              className="px-2.5 py-1 text-[11px] font-bold rounded-md border border-violet-500/30 text-violet-200 bg-violet-500/10 hover:bg-violet-500/20 disabled:opacity-40"
                            >
                              Hold
                            </button>
                          ) : null}
                          {canApprove(row.status) ? (
                            <button
                              type="button"
                              onClick={() => openApprove(row)}
                              className="px-2.5 py-1 text-[11px] font-bold rounded-md border border-green-500/30 text-green-300 bg-green-500/10 hover:bg-green-500/20"
                            >
                              Approve
                            </button>
                          ) : null}
                          {canReject(row.status) ? (
                            <button
                              type="button"
                              onClick={() => openReject(row)}
                              className="px-2.5 py-1 text-[11px] font-bold rounded-md border border-red-500/30 text-red-300 bg-red-500/10 hover:bg-red-500/20"
                            >
                              Reject
                            </button>
                          ) : null}
                        </div>
                      ) : (
                        <span className="text-white/30 text-[11px]">—</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
      </AdminDataTable>

      <div className="flex items-center justify-between mt-4 flex-wrap gap-3">
        <p className="text-white/50 text-sm">{total} rows · page {page} / {pages}</p>
        <div className="flex items-center gap-2">
          <select
            value={String(limit)}
            onChange={(e) => { setSkip(0); setLimit(Number(e.target.value)); }}
            className="rounded-xl bg-surface-card border border-surface-border px-3 py-2 text-white text-sm font-semibold"
          >
            {[10, 25, 50, 100].map((n) => <option key={n} value={n}>{n}/page</option>)}
          </select>
          <button
            type="button"
            disabled={skip <= 0}
            onClick={() => setSkip((s) => Math.max(0, s - limit))}
            className="px-4 py-2 rounded-xl border border-surface-border text-sm font-bold disabled:opacity-40"
          >
            Prev
          </button>
          <button
            type="button"
            disabled={skip + limit >= total}
            onClick={() => setSkip((s) => s + limit)}
            className="px-4 py-2 rounded-xl border border-surface-border text-sm font-bold disabled:opacity-40"
          >
            Next
          </button>
        </div>
      </div>

      <ConfirmModal
        open={confirmOpen}
        title={action === 'approve' ? 'Approve withdrawal' : action === 'reject' ? 'Reject withdrawal' : 'Hold withdrawal'}
        message={
          action === 'approve'
            ? `Approve ${activeRow?.amount} ${activeRow?.asset} to ${trimAddress(activeRow?.address)}? If the payout wallet is configured, the system will send on-chain soon. If it is still waiting on wallet setup, the status will show “Waiting: payout wallet” until that is fixed.`
            : action === 'reject'
              ? `Reject withdrawal ${activeRow?.id}? The user's locked funds will be refunded.`
              : `Place withdrawal ${activeRow?.id} on hold for manual review.`
        }
        confirmText={action === 'approve' ? 'Approve' : action === 'reject' ? 'Reject' : 'Put on hold'}
        danger={action !== 'approve'}
        busy={busy}
        inputLabel={action === 'reject' ? 'Reason (shared with user)' : action === 'hold' ? 'Hold note (optional)' : ''}
        inputPlaceholder={action === 'reject' ? 'e.g. Destination flagged by compliance' : action === 'hold' ? 'e.g. Awaiting enhanced due diligence' : ''}
        required={action === 'reject'}
        onClose={() => { if (!busy) { setConfirmOpen(false); setActiveRow(null); } }}
        onConfirm={performAction}
      />
    </div>
  );
}
