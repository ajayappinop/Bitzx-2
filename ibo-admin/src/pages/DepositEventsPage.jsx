import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  ArrowDownCircle, RefreshCw, AlertCircle, IndianRupee,
} from 'lucide-react';
import { formatInrAmount } from '@/lib/inrDisplay';
import { api } from '@/lib/api';
import { useAdminAuth } from '@/context/AdminAuthContext';
import { hasPermission } from '@/lib/adminAccess';
import ConfirmModal from '@/components/ConfirmModal';
import UserUidSuggestInput from '@/components/UserUidSuggestInput';
import CoinAvatar from '@/components/CoinAvatar';
import { AdminPageHeader, AdminPanel } from '@/components/AdminPrimitives';

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
  const [uidFilter, setUidFilter] = useState(searchParams.get('uid') || '');
  const [assetFilter, setAssetFilter] = useState('');
  const [networkFilter, setNetworkFilter] = useState('');
  const [txFilter, setTxFilter] = useState('');
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
      if (uidFilter.trim()) params.uid = uidFilter.trim();

      if (channelTab === 'inr') {
        const r = await api.inrDeposits(params);
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j.detail || `HTTP ${r.status}`);
        setItems(Array.isArray(j.items) ? j.items : []);
        setTotal(Number.isFinite(j.total) ? j.total : 0);
      } else {
        if (assetFilter.trim()) params.asset = assetFilter.trim().toUpperCase();
        if (networkFilter.trim()) params.network = networkFilter.trim();
        if (txFilter.trim()) params.tx_hash = txFilter.trim();
        if (sourceFilter.trim()) params.source = sourceFilter.trim();

        const r = await api.depositEvents(params);
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j.detail || `HTTP ${r.status}`);
        setItems(Array.isArray(j.items) ? j.items : []);
        setTotal(Number.isFinite(j.total) ? j.total : 0);
      }
    } catch (e) {
      setErr(e.message || 'Could not load deposit events');
      setItems([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [channelTab, skip, limit, statusFilter, uidFilter, assetFilter, networkFilter, txFilter, sourceFilter]);

  useEffect(() => {
    load();
  }, [load]);

  const pages = useMemo(() => Math.max(1, Math.ceil(total / limit)), [total, limit]);
  const page = useMemo(() => Math.floor(skip / limit) + 1, [skip, limit]);

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
        actions={(
          <button
            type="button"
            onClick={() => load()}
            disabled={loading}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-surface-border text-sm font-bold text-white hover:border-gold/40 disabled:opacity-40"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh
          </button>
        )}
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
          onClick={() => { setChannelTab('onchain'); setSkip(0); setStatusFilter(''); }}
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
          onClick={() => { setChannelTab('inr'); setSkip(0); setStatusFilter(''); }}
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

      <AdminPanel title="Filters" className="mb-6">
        <div className="grid sm:grid-cols-2 lg:grid-cols-6 gap-3">
          <select
            value={statusFilter}
            onChange={(e) => { setSkip(0); setStatusFilter(e.target.value); }}
            className="rounded-xl bg-surface-dark border border-surface-border px-3 py-2 text-sm text-white"
          >
            {channelTab === 'inr' ? (
              INR_STATUS_OPTIONS.map((o) => (
                <option key={o.value || 'all'} value={o.value}>{o.label}</option>
              ))
            ) : (
              <>
                <option value="">All statuses</option>
                <option value="pending">Pending</option>
                <option value="confirming">Confirming</option>
                <option value="pending_kyc">Pending KYC</option>
                <option value="below_min">Below minimum</option>
                <option value="crediting">Crediting</option>
                <option value="credited">Credited</option>
                <option value="orphan">Orphan</option>
                <option value="reorg_review">Reorg review</option>
              </>
            )}
          </select>
          <UserUidSuggestInput
            value={uidFilter}
            onChange={(v) => { setSkip(0); setUidFilter(v); }}
            placeholder="Filter UID"
            className="w-full rounded-xl bg-surface-dark border border-surface-border px-3 py-2 text-sm text-white font-mono"
          />
          {channelTab === 'onchain' ? (
            <>
              <select
                value={sourceFilter}
                onChange={(e) => { setSkip(0); setSourceFilter(e.target.value); }}
                className="rounded-xl bg-surface-dark border border-surface-border px-3 py-2 text-sm text-white"
              >
                <option value="">All sources</option>
                <option value="signup_bonus">Signup bonus only</option>
                <option value="onchain">Regular deposits only</option>
              </select>
              <input
                value={assetFilter}
                onChange={(e) => { setSkip(0); setAssetFilter(e.target.value); }}
                placeholder="Asset (e.g. IBO)"
                className="rounded-xl bg-surface-dark border border-surface-border px-3 py-2 text-sm text-white"
              />
              <input
                value={networkFilter}
                onChange={(e) => { setSkip(0); setNetworkFilter(e.target.value); }}
                placeholder="Network"
                className="rounded-xl bg-surface-dark border border-surface-border px-3 py-2 text-sm text-white"
              />
              <input
                value={txFilter}
                onChange={(e) => { setSkip(0); setTxFilter(e.target.value); }}
                placeholder="Tx hash"
                className="rounded-xl bg-surface-dark border border-surface-border px-3 py-2 text-sm text-white font-mono"
              />
            </>
          ) : (
            <div className="sm:col-span-3 text-xs text-white/45 self-center px-1">
              INR fiat deposits — filter by status or UID. Approve/reject in the INR queue.
            </div>
          )}
          <select
            value={String(limit)}
            onChange={(e) => { setSkip(0); setLimit(Number(e.target.value) || 25); }}
            className="rounded-xl bg-surface-dark border border-surface-border px-3 py-2 text-sm text-white"
          >
            {[25, 50, 100].map((n) => (
              <option key={n} value={n}>{n} / page</option>
            ))}
          </select>
        </div>
      </AdminPanel>

      <AdminPanel title={channelTab === 'inr' ? 'INR deposit requests' : 'On-chain events'}>
        {loading ? (
          <div className="flex items-center justify-center py-16 gap-3 text-white">
            <RefreshCw size={20} className="animate-spin" /> Loading…
          </div>
        ) : items.length === 0 ? (
          <p className="text-white/50 text-sm py-12 text-center">No rows match these filters.</p>
        ) : channelTab === 'inr' ? (
          <div className="overflow-x-auto adm-table-x">
            <table className="w-full text-sm min-w-[880px]">
              <thead>
                <tr className="text-left text-white/55 border-b border-surface-border text-xs uppercase tracking-wider">
                  <th className="px-3 py-2">When</th>
                  <th className="px-3 py-2">UID</th>
                  <th className="px-3 py-2 text-right">INR</th>
                  <th className="px-3 py-2 text-right">IBO</th>
                  <th className="px-3 py-2">UTR</th>
                  <th className="px-3 py-2">Method</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {items.map((row) => (
                  <tr key={row.id} className="border-b border-surface-border/40 hover:bg-white/[.02]">
                    <td className="px-3 py-2 text-xs text-white/70 whitespace-nowrap">{fmtTs(row.created_at)}</td>
                    <td className="px-3 py-2 font-mono text-xs">
                      {row.uid ? (
                        <Link to={`/users/${encodeURIComponent(row.uid)}`} className="text-gold-light font-bold hover:underline">
                          {row.uid}
                        </Link>
                      ) : (
                        <span className="text-white/40">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-gold-light/90">{formatInrAmount(row.amount_inr)}</td>
                    <td className="px-3 py-2 text-right font-mono text-green-400/90">
                      {row.status === 'approved' && row.amount_ibo != null
                        ? Number(row.amount_ibo).toFixed(4)
                        : '—'}
                    </td>
                    <td className="px-3 py-2 text-xs font-mono text-white/70 max-w-[140px] truncate" title={row.utr_number}>
                      {row.utr_number || '—'}
                    </td>
                    <td className="px-3 py-2 text-xs text-white/70 max-w-[120px] truncate" title={row.payment_method_label}>
                      {row.payment_method_label || row.payment_method_type || '—'}
                    </td>
                    <td className="px-3 py-2 text-xs font-mono">{row.status}</td>
                    <td className="px-3 py-2 text-right">
                      <Link
                        to={`/inr-deposits${row.uid ? `?uid=${encodeURIComponent(row.uid)}` : ''}`}
                        className="px-2 py-1 text-[11px] font-bold rounded-md border border-gold/40 text-gold-light hover:bg-gold/10 inline-block"
                      >
                        {canManageInr && row.status === 'pending' ? 'Review' : 'View'}
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="overflow-x-auto adm-table-x">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-white/55 border-b border-surface-border text-xs uppercase tracking-wider">
                  <th className="px-3 py-2">When</th>
                  <th className="px-3 py-2">UID</th>
                  <th className="px-3 py-2">Source</th>
                  <th className="px-3 py-2">Asset</th>
                  <th className="px-3 py-2 text-right">Amount</th>
                  <th className="px-3 py-2">Conf</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Tx</th>
                  <th className="px-3 py-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {items.map((row) => {
                  const isBonus = row.source === 'signup_bonus';
                  return (
                  <tr key={row.id || `${row.tx_hash}-${row.address}`} className={`border-b border-surface-border/40 hover:bg-white/[.02] ${isBonus ? 'bg-gold/5' : ''}`}>
                    <td className="px-3 py-2 text-xs text-white/70 whitespace-nowrap">{fmtTs(row.created_at)}</td>
                    <td className="px-3 py-2 font-mono text-xs">
                      {row.uid ? (
                        <Link to={`/users/${encodeURIComponent(row.uid)}`} className="text-gold-light font-bold hover:underline">
                          {row.uid}
                        </Link>
                      ) : (
                        <span className="text-white/40">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs">
                      {isBonus ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-gold/15 text-gold-light font-semibold text-[11px] border border-gold/25">
                          🎁 Signup bonus
                        </span>
                      ) : (
                        <span className="text-white/40 text-[11px]">deposit</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <span className="inline-flex items-center gap-1.5 font-bold text-white">
                        <CoinAvatar asset={row.asset} className="h-5 w-5" />
                        {row.asset}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-green-400">{Number(row.amount || 0).toFixed(6)}</td>
                    <td className="px-3 py-2 text-xs font-mono text-white/80 whitespace-nowrap">
                      {Number(row.threshold) > 0
                        ? `${Math.min(Number(row.confirmations || 0), Number(row.threshold))}/${Number(row.threshold)}`
                        : Number(row.confirmations || 0)}
                    </td>
                    <td className="px-3 py-2 text-xs font-mono">{row.status}</td>
                    <td className="px-3 py-2 text-xs font-mono text-white/70" title={row.tx_hash || ''}>
                      {row.tx_hash ? trimTx(row.tx_hash) : <span className="text-white/30 italic">dispatching…</span>}
                    </td>
                    <td className="px-3 py-2 text-right">
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
                })}
              </tbody>
            </table>
          </div>
        )}

        {total > limit && (
          <p className="text-white/50 text-sm mt-4">
            Page {page} / {pages} — showing {skip + 1}–{Math.min(skip + limit, total)} of {total}
            <button
              type="button"
              disabled={skip <= 0}
              onClick={() => setSkip((s) => Math.max(0, s - limit))}
              className="ml-3 text-gold-light font-bold disabled:opacity-40"
            >
              Prev
            </button>
            <button
              type="button"
              disabled={skip + limit >= total}
              onClick={() => setSkip((s) => s + limit)}
              className="ml-2 text-gold-light font-bold disabled:opacity-40"
            >
              Next
            </button>
          </p>
        )}
      </AdminPanel>

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
