import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  ArrowDownCircle, RefreshCw, AlertCircle, IndianRupee, Search,
} from 'lucide-react';
import { formatInrAmount } from '@/lib/inrDisplay';
import { api } from '@/lib/api';
import { useAdminAuth } from '@/context/AdminAuthContext';
import { hasPermission } from '@/lib/adminAccess';
import ConfirmModal from '@/components/ConfirmModal';
import CoinAvatar from '@/components/CoinAvatar';
import { AdminPageHeader, AdminDataTable } from '@/components/AdminPrimitives';

function fmtTs(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return String(iso);
  }
}

function trimTx(h) {
  if (!h) return '—';
  if (h.length <= 22) return h;
  return `${h.slice(0, 12)}…${h.slice(-8)}`;
}

const INR_STATUS_OPTIONS = [
  { value: '', label: 'All statuses' },
  { value: 'pending', label: 'Pending' },
  { value: 'approving', label: 'Processing' },
  { value: 'approved', label: 'Approved' },
  { value: 'rejected', label: 'Rejected' },
];

const ONCHAIN_STATUS_OPTIONS = [
  { value: '', label: 'All statuses' },
  { value: 'pending', label: 'Pending' },
  { value: 'confirming', label: 'Confirming' },
  { value: 'pending_kyc', label: 'Pending KYC' },
  { value: 'below_min', label: 'Below minimum' },
  { value: 'crediting', label: 'Crediting' },
  { value: 'credited', label: 'Credited' },
  { value: 'orphan', label: 'Orphan' },
  { value: 'reorg_review', label: 'Reorg review' },
];

const fieldClass =
  'h-9 rounded-lg bg-surface-dark border border-surface-border px-3 text-sm font-semibold text-white';
const searchClass =
  'h-9 w-full rounded-lg bg-surface-dark border border-surface-border pl-8 pr-3 text-sm text-white font-mono placeholder:text-white/35 outline-none focus:border-gold/40';

export default function DepositEventsPage() {
  const [searchParams] = useSearchParams();
  const { admin } = useAdminAuth();
  const canCredit = hasPermission(admin, 'manage_treasury');
  const canManageInr = hasPermission(admin, 'manage_treasury');

  const initialTab = searchParams.get('channel') === 'inr' ? 'inr' : 'onchain';
  const [channelTab, setChannelTab] = useState(initialTab);

  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [ok, setOk] = useState('');

  const [statusFilter, setStatusFilter] = useState(searchParams.get('status') || '');
  const [searchQ, setSearchQ] = useState(searchParams.get('q') || '');
  const [appliedQ, setAppliedQ] = useState(() => String(searchParams.get('q') || '').trim());
  const [sourceFilter, setSourceFilter] = useState(searchParams.get('source') || '');
  const [skip, setSkip] = useState(0);
  const [limit, setLimit] = useState(25);

  const [crediting, setCrediting] = useState('');
  const [creditPrompt, setCreditPrompt] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErr('');
    try {
      const params = { skip: String(skip), limit: String(limit) };
      if (statusFilter.trim()) params.status = statusFilter.trim();

      if (channelTab === 'inr') {
        const r = await api.inrDeposits(params);
        const j = await r.json().catch(() => ({}));
        if (!r.ok) {
          const detail = typeof j.detail === 'string' ? j.detail : (j.detail ? JSON.stringify(j.detail) : `HTTP ${r.status}`);
          throw new Error(detail);
        }
        const list = Array.isArray(j.items) ? j.items : (Array.isArray(j) ? j : []);
        setItems(list);
        setTotal(Number.isFinite(j.total) ? j.total : list.length);
      } else {
        const q = String(appliedQ || '').trim();
        if (q) params.q = q;
        if (sourceFilter.trim()) params.source = sourceFilter.trim();

        const r = await api.depositEvents(params);
        const j = await r.json().catch(() => ({}));
        if (!r.ok) {
          const detail = typeof j.detail === 'string' ? j.detail : (j.detail ? JSON.stringify(j.detail) : `HTTP ${r.status}`);
          throw new Error(detail);
        }
        const list = Array.isArray(j.items) ? j.items : (Array.isArray(j) ? j : []);
        setItems(list);
        setTotal(Number.isFinite(j.total) ? j.total : list.length);
      }
    } catch (e) {
      setErr(e.message || 'Could not load deposit events');
      setItems([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [channelTab, skip, limit, statusFilter, appliedQ, sourceFilter]);

  useEffect(() => {
    load();
  }, [load]);

  const pages = useMemo(() => Math.max(1, Math.ceil(total / limit)), [total, limit]);
  const page = useMemo(() => Math.floor(skip / limit) + 1, [skip, limit]);

  function applySearch(raw) {
    setSkip(0);
    setAppliedQ(String(raw || '').trim());
  }

  function clearFilters() {
    setSkip(0);
    setStatusFilter('');
    setSearchQ('');
    setAppliedQ('');
    setSourceFilter('');
  }

  const canCreditStatus = (s) =>
    ['pending', 'confirming', 'pending_kyc', 'below_min'].includes(String(s || '').toLowerCase());

  const handleCredit = async (ev, noteValue = '') => {
    if (!ev?.id) return;
    const note = String(noteValue || '').trim();
    setCrediting(ev.id);
    setErr('');
    setOk('');
    try {
      const res = await api.creditDepositEvent(ev.id, {
        note: note || undefined,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.detail || `HTTP ${res.status}`);
      setOk(`Credited ${ev.id}`);
      await load();
    } catch (e) {
      setErr(e.message || 'Manual credit failed');
    } finally {
      setCrediting('');
    }
  };

  return (
    <div className="admin-page">
      <AdminPageHeader
        icon={ArrowDownCircle}
        title="Deposit events"
        subtitle="On-chain deposit sightings (poller) and INR fiat deposit requests. Use the INR tab to review bank/UPI proofs; approve or reject from the INR queue."
        badge={`${total.toLocaleString()} total`}
      />

      {err && (
        <div className="mb-4 flex items-start gap-2 rounded-xl border border-red-500/25 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          <AlertCircle size={16} className="shrink-0 mt-0.5" /> {err}
        </div>
      )}
      {ok && <p className="text-green-400 text-sm mb-4">{ok}</p>}

      <div className="flex flex-wrap gap-2 mb-4">
        <button
          type="button"
          onClick={() => {
            setChannelTab('onchain');
            setSkip(0);
            setStatusFilter('');
            setSearchQ('');
            setAppliedQ('');
            setSourceFilter('');
          }}
          className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold border transition-colors ${
            channelTab === 'onchain'
              ? 'border-gold/40 bg-gold/15 text-gold-light'
              : 'border-surface-border text-white/70 hover:border-white/20'
          }`}
        >
          <ArrowDownCircle size={16} /> On-chain
        </button>
        <button
          type="button"
          onClick={() => {
            setChannelTab('inr');
            setSkip(0);
            setStatusFilter('');
            setSearchQ('');
            setAppliedQ('');
            setSourceFilter('');
          }}
          className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold border transition-colors ${
            channelTab === 'inr'
              ? 'border-gold/40 bg-gold/15 text-gold-light'
              : 'border-surface-border text-white/70 hover:border-white/20'
          }`}
        >
          <IndianRupee size={16} /> INR (₹)
        </button>
        {channelTab === 'inr' && (
          <Link
            to="/inr-deposits"
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold border border-gold/35 text-gold-light hover:bg-gold/10"
          >
            Open INR approval queue →
          </Link>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-surface-border bg-surface-card px-3 py-2.5 mb-4">
        {channelTab === 'onchain' ? (
          <div className="relative min-w-0 w-full sm:w-56 sm:flex-1 lg:flex-none">
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
              placeholder="Search asset or network…"
              className={searchClass}
              aria-label="Search by asset or network"
            />
          </div>
        ) : null}
        <select
          value={statusFilter}
          onChange={(e) => { setSkip(0); setStatusFilter(e.target.value); }}
          className={fieldClass}
          aria-label="Filter by status"
        >
          {(channelTab === 'inr' ? INR_STATUS_OPTIONS : ONCHAIN_STATUS_OPTIONS).map((o) => (
            <option key={o.value || 'all'} value={o.value}>{o.label}</option>
          ))}
        </select>
        {channelTab === 'onchain' ? (
          <select
            value={sourceFilter}
            onChange={(e) => { setSkip(0); setSourceFilter(e.target.value); }}
            className={fieldClass}
            aria-label="Filter by source"
          >
            <option value="">All sources</option>
            <option value="signup_bonus">Signup bonus only</option>
            <option value="onchain">Regular deposits only</option>
          </select>
        ) : null}
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

      {channelTab === 'inr' ? (
        <AdminDataTable minWidth="880px">
          <thead>
            <tr>
              <th>When</th>
              <th>UID</th>
              <th className="text-right">INR</th>
              <th className="text-right">IBO</th>
              <th>UTR</th>
              <th>Method</th>
              <th>Status</th>
              <th className="text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={8} className="text-center text-white/50 !py-16">Loading…</td>
              </tr>
            ) : items.length === 0 ? (
              <tr>
                <td colSpan={8} className="text-center text-white/50 !py-16">No rows match these filters.</td>
              </tr>
            ) : (
              items.map((row) => (
                <tr key={row.id}>
                  <td className="text-xs text-white/70 whitespace-nowrap">{fmtTs(row.created_at)}</td>
                  <td className="font-mono text-xs">
                    {row.uid ? (
                      <Link to={`/users/${encodeURIComponent(row.uid)}`} className="text-gold-light font-bold hover:underline">
                        {row.uid}
                      </Link>
                    ) : (
                      <span className="text-white/40">—</span>
                    )}
                  </td>
                  <td className="text-right font-mono text-gold-light/90">{formatInrAmount(row.amount_inr)}</td>
                  <td className="text-right font-mono text-green-400/90">
                    {row.status === 'approved' && row.amount_ibo != null
                      ? Number(row.amount_ibo).toFixed(4)
                      : '—'}
                  </td>
                  <td className="text-xs font-mono text-white/70 max-w-[140px] truncate" title={row.utr_number}>
                    {row.utr_number || '—'}
                  </td>
                  <td className="text-xs text-white/70 max-w-[120px] truncate" title={row.payment_method_label}>
                    {row.payment_method_label || row.payment_method_type || '—'}
                  </td>
                  <td className="text-xs font-mono">{row.status}</td>
                  <td className="text-right">
                    <Link
                      to={`/inr-deposits${row.uid ? `?uid=${encodeURIComponent(row.uid)}` : ''}`}
                      className="px-2 py-1 text-[11px] font-bold rounded-md border border-gold/40 text-gold-light hover:bg-gold/10 inline-block"
                    >
                      {canManageInr && row.status === 'pending' ? 'Review' : 'View'}
                    </Link>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </AdminDataTable>
      ) : (
        <AdminDataTable minWidth="1100px">
          <thead>
            <tr>
              <th>When</th>
              <th>UID</th>
              <th>Source</th>
              <th>Asset</th>
              <th className="text-right">Amount</th>
              <th>Conf</th>
              <th>Status</th>
              <th>Tx</th>
              <th className="text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={9} className="text-center text-white/50 !py-16">Loading…</td>
              </tr>
            ) : items.length === 0 ? (
              <tr>
                <td colSpan={9} className="text-center text-white/50 !py-16">No rows match these filters.</td>
              </tr>
            ) : (
              items.map((row) => {
                const isBonus = row.source === 'signup_bonus';
                return (
                  <tr key={row.id || `${row.tx_hash}-${row.address}`} className={isBonus ? 'bg-gold/5' : undefined}>
                    <td className="text-xs text-white/70 whitespace-nowrap">{fmtTs(row.created_at)}</td>
                    <td className="font-mono text-xs">
                      {row.uid ? (
                        <Link to={`/users/${encodeURIComponent(row.uid)}`} className="text-gold-light font-bold hover:underline">
                          {row.uid}
                        </Link>
                      ) : (
                        <span className="text-white/40">—</span>
                      )}
                    </td>
                    <td className="text-xs">
                      {isBonus ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-gold/15 text-gold-light font-semibold text-[11px] border border-gold/25">
                          Signup bonus
                        </span>
                      ) : (
                        <span className="text-white/40 text-[11px]">deposit</span>
                      )}
                    </td>
                    <td>
                      <span className="inline-flex items-center gap-1.5 font-bold text-white">
                        <CoinAvatar asset={row.asset} className="h-5 w-5" />
                        {row.asset}
                      </span>
                    </td>
                    <td className="text-right font-mono text-green-400">{Number(row.amount || 0).toFixed(6)}</td>
                    <td className="text-xs font-mono text-white/80 whitespace-nowrap">
                      {Number(row.threshold) > 0
                        ? `${Math.min(Number(row.confirmations || 0), Number(row.threshold))}/${Number(row.threshold)}`
                        : Number(row.confirmations || 0)}
                    </td>
                    <td className="text-xs font-mono">{row.status}</td>
                    <td className="text-xs font-mono text-white/70" title={row.tx_hash || ''}>
                      {row.tx_hash ? trimTx(row.tx_hash) : <span className="text-white/30 italic">dispatching…</span>}
                    </td>
                    <td className="text-right">
                      {canCredit && canCreditStatus(row.status) && row.uid && !isBonus ? (
                        <button
                          type="button"
                          onClick={() => {
                            const obs = Number(row.amount || 0).toFixed(8).replace(/0+$/, '').replace(/\.$/, '');
                            setCreditPrompt({ ev: row, note: '', obs });
                          }}
                          disabled={crediting === row.id}
                          className="px-2 py-1 text-[11px] font-bold rounded-md border border-gold/40 text-gold-light hover:bg-gold/10 disabled:opacity-50"
                        >
                          {crediting === row.id ? '…' : 'Credit'}
                        </button>
                      ) : null}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </AdminDataTable>
      )}

      <div className="flex items-center justify-between mt-4 flex-wrap gap-3">
        <p className="text-white/50 text-sm">{total} rows · page {page} / {pages}</p>
        <div className="flex items-center gap-2">
          <select
            value={String(limit)}
            onChange={(e) => { setSkip(0); setLimit(Number(e.target.value) || 25); }}
            className="rounded-xl bg-surface-card border border-surface-border px-3 py-2 text-white text-sm font-semibold"
          >
            {[10, 25, 50, 100].map((n) => (
              <option key={n} value={n}>{n}/page</option>
            ))}
          </select>
          <button
            type="button"
            disabled={skip <= 0 || loading}
            onClick={() => setSkip((s) => Math.max(0, s - limit))}
            className="px-4 py-2 rounded-xl border border-surface-border text-sm font-bold disabled:opacity-40"
          >
            Prev
          </button>
          <button
            type="button"
            disabled={skip + limit >= total || loading}
            onClick={() => setSkip((s) => s + limit)}
            className="px-4 py-2 rounded-xl border border-surface-border text-sm font-bold disabled:opacity-40"
          >
            Next
          </button>
        </div>
      </div>

      <ConfirmModal
        open={!!creditPrompt}
        title="Manual credit override"
        message={creditPrompt ? `Manually credit ${creditPrompt.obs} ${creditPrompt.ev?.asset} for event ${creditPrompt.ev?.id}?` : ''}
        inputLabel="Optional audit note"
        initialValue={creditPrompt?.note || ''}
        confirmText="Credit now"
        busy={!!crediting}
        onClose={() => { if (!crediting) setCreditPrompt(null); }}
        onConfirm={async (note) => {
          if (!creditPrompt?.ev) return;
          await handleCredit(creditPrompt.ev, note);
          setCreditPrompt(null);
        }}
      />
    </div>
  );
}
