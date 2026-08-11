import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Send, RefreshCw, Copy, Check, Search, ChevronDown, X,
  Clock, CheckCircle2, XCircle, AlertCircle,
  Wallet, TrendingUp, Hash, BarChart3, Edit2, Info,
  ArrowUpRight, ShieldAlert,
} from 'lucide-react';
import { api } from '@/lib/api';
import { useAdminAuth } from '@/context/AdminAuthContext';
import { hasPermission } from '@/lib/adminAccess';
import {
  AdminPageHeader, AdminPanel, GradientStatCard,
  FilterBar, AdminDataTable, StatusBadge,
} from '@/components/AdminPrimitives';

/* ── Helpers ──────────────────────────────────────────────────────────── */

function fmtNum(n, dp = 6) {
  const v = Number(n);
  if (!Number.isFinite(v)) return '—';
  return v.toLocaleString(undefined, { maximumFractionDigits: dp, minimumFractionDigits: 0 });
}

function fmtTs(iso) {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleString(); } catch { return iso; }
}

function trimAddr(a) {
  if (!a || a === '—') return '—';
  if (a.length <= 18) return a;
  return `${a.slice(0, 10)}…${a.slice(-8)}`;
}

function trimTx(h) {
  if (!h) return '—';
  if (h.length <= 22) return h;
  return `${h.slice(0, 12)}…${h.slice(-8)}`;
}

/* ── Shared styles ────────────────────────────────────────────────────── */

const inputCls =
  'rounded-xl bg-surface-dark border border-surface-border px-3 py-2 text-sm text-white placeholder-white/40 focus:outline-none focus:border-gold/50 w-full';

const labelCls = 'block text-xs font-semibold uppercase tracking-wide text-white/50 mb-1.5';

/* ── CopyButton ───────────────────────────────────────────────────────── */

function CopyButton({ text }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    if (!text) return;
    try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* ignore */ }
  };
  return (
    <button type="button" onClick={copy} title="Copy"
      className="p-1.5 rounded-lg border border-white/10 text-white/60 hover:text-gold hover:border-gold/40 transition-colors shrink-0">
      {copied ? <Check size={13} /> : <Copy size={13} />}
    </button>
  );
}

/* ── Status helpers ───────────────────────────────────────────────────── */

function statusTone(s) {
  if (s === 'completed') return 'success';
  if (s === 'failed') return 'error';
  if (s === 'cancelled') return 'neutral';
  return 'warning';
}

function StatusIcon({ status }) {
  if (status === 'completed') return <CheckCircle2 size={14} className="text-emerald-400" />;
  if (status === 'failed') return <XCircle size={14} className="text-rose-400" />;
  if (status === 'cancelled') return <X size={14} className="text-white/40" />;
  return <Clock size={14} className="text-gold" />;
}

/* ── AddressPicker ─────────────────────────────────────────────────────
   Always-visible tabbed picker. Shows known saved treasury addresses
   grouped by asset. Admin can also paste/type manually in the same panel.
   ──────────────────────────────────────────────────────────────────────── */

function AddressPicker({ addresses, value, onChange, selectedAsset }) {
  const [tab, setTab] = useState('all');
  const [filter, setFilter] = useState('');

  // Build asset tabs from the known addresses list
  const assetTabs = ['all', ...Array.from(new Set(addresses.map((a) => a.asset || 'other').filter(Boolean)))];

  const shown = addresses.filter((a) => {
    if (tab !== 'all' && (a.asset || 'other') !== tab) return false;
    if (filter.trim()) {
      const q = filter.toLowerCase();
      return (
        a.address.toLowerCase().includes(q) ||
        (a.label || '').toLowerCase().includes(q) ||
        (a.network || '').toLowerCase().includes(q)
      );
    }
    return true;
  });

  // Highlight address that matches the currently selected value
  const isSelected = (a) => a.address.toLowerCase() === value.toLowerCase();

  return (
    <div className="rounded-2xl border border-surface-border bg-surface-dark/60 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-surface-border/60 bg-white/[.02]">
        <span className="text-xs font-bold text-white/60 uppercase tracking-wide">Destination Address</span>
        {value && (
          <button type="button" onClick={() => onChange('')} className="text-[10px] text-white/35 hover:text-rose-300 transition-colors">
            Clear
          </button>
        )}
      </div>

      {/* Selected address preview */}
      {value && (
        <div className="px-3 py-2 border-b border-surface-border/40 flex items-center gap-2 bg-emerald-500/[.07]">
          <Check size={13} className="text-emerald-400 shrink-0" />
          <p className="font-mono text-xs text-emerald-200 flex-1 truncate">{value}</p>
          <CopyButton text={value} />
        </div>
      )}

      {/* Manual input */}
      <div className="px-3 pt-2.5 pb-2 border-b border-surface-border/40">
        <label className="block text-[10px] font-semibold text-white/40 uppercase tracking-wide mb-1">Type or paste address</label>
        <input
          className="w-full bg-surface-card border border-surface-border rounded-xl px-3 py-2 text-sm font-mono text-white placeholder-white/25 focus:outline-none focus:border-gold/40"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="0x… / T… / bc1… / any chain"
        />
      </div>

      {/* Known addresses section */}
      {addresses.length > 0 && (
        <>
          <div className="px-3 pt-2.5 pb-1.5 border-b border-surface-border/40">
            <div className="flex items-center justify-between gap-2 mb-2">
              <label className="block text-[10px] font-semibold text-white/40 uppercase tracking-wide">Saved treasury addresses</label>
              <div className="relative">
                <Search size={11} className="absolute left-2 top-1/2 -translate-y-1/2 text-white/35" />
                <input
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  placeholder="Search…"
                  className="pl-6 pr-2 py-1 text-[11px] rounded-lg bg-surface-card border border-surface-border text-white placeholder-white/30 focus:outline-none focus:border-gold/40 w-28"
                />
              </div>
            </div>
            {/* Asset tabs */}
            <div className="flex flex-wrap gap-1">
              {assetTabs.map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTab(t)}
                  className={`px-2.5 py-0.5 rounded-full text-[11px] font-semibold border transition-colors ${
                    tab === t
                      ? 'border-gold/50 bg-gold/15 text-gold-light'
                      : 'border-surface-border text-white/40 hover:border-white/30 hover:text-white/70'
                  }`}
                >
                  {t === 'all' ? `All (${addresses.length})` : t}
                </button>
              ))}
            </div>
          </div>
          <div className="max-h-52 overflow-y-auto divide-y divide-surface-border/30">
            {shown.length === 0 ? (
              <p className="px-3 py-3 text-xs text-white/35">No addresses match this filter.</p>
            ) : (
              shown.map((a) => (
                <button
                  key={a.address}
                  type="button"
                  onClick={() => onChange(a.address)}
                  className={`w-full text-left px-3 py-2.5 transition-colors group ${
                    isSelected(a)
                      ? 'bg-emerald-500/10 border-l-2 border-emerald-500/50'
                      : 'hover:bg-white/[.04]'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-white/90 truncate">
                        {a.label || a.address}
                      </p>
                      {a.label && (
                        <p className="font-mono text-[10px] text-white/45 mt-0.5 truncate">{a.address}</p>
                      )}
                      {(a.asset || a.network) && (
                        <p className="text-[10px] text-white/30 mt-0.5">
                          {[a.asset, a.network].filter(Boolean).join(' · ')}
                        </p>
                      )}
                    </div>
                    {isSelected(a) ? (
                      <Check size={13} className="text-emerald-400 shrink-0 mt-0.5" />
                    ) : (
                      <span className="text-[10px] text-white/25 group-hover:text-gold-light transition-colors shrink-0 mt-0.5">Select</span>
                    )}
                  </div>
                </button>
              ))
            )}
          </div>
        </>
      )}
    </div>
  );
}

/* ── ConfirmModal ─────────────────────────────────────────────────────── */

function ConfirmModal({ open, transfer, onConfirm, onCancel, busy }) {
  if (!open || !transfer) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-2xl border border-surface-border bg-surface-dark shadow-2xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-surface-border">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-full bg-gold/20 flex items-center justify-center">
              <AlertCircle size={18} className="text-gold" />
            </div>
            <h3 className="text-lg font-bold text-white">Confirm Transfer</h3>
          </div>
          <button type="button" onClick={onCancel} className="text-white/50 hover:text-white"><X size={20} /></button>
        </div>
        <div className="p-5 space-y-3">
          <p className="text-sm text-white/70 leading-relaxed">
            You are about to record a manual treasury transfer. Please verify the details carefully — this creates an audit record and cannot be auto-reversed.
          </p>
          <div className="rounded-xl border border-surface-border bg-surface-card/60 p-4 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs text-white/50">Asset</span>
              <span className="text-sm font-bold text-white">{transfer.asset}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-white/50">Network</span>
              <span className="text-sm text-white/80">{transfer.network}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-white/50">Amount</span>
              <span className="text-base font-extrabold text-gold">{fmtNum(transfer.amount)} {transfer.asset}</span>
            </div>
            <div className="pt-2 border-t border-surface-border/60">
              <span className="text-xs text-white/50 block mb-0.5">To address</span>
              <span className="font-mono text-xs text-white/85 break-all">{transfer.to_address}</span>
            </div>
            {transfer.from_address ? (
              <div>
                <span className="text-xs text-white/50 block mb-0.5">From address</span>
                <span className="font-mono text-xs text-white/65 break-all">{transfer.from_address}</span>
              </div>
            ) : null}
            {transfer.note ? (
              <div>
                <span className="text-xs text-white/50 block mb-0.5">Note</span>
                <span className="text-xs text-white/70">{transfer.note}</span>
              </div>
            ) : null}
          </div>
          <p className="text-[11px] text-gold-light/80 flex items-start gap-1.5">
            <Info size={12} className="shrink-0 mt-0.5" />
            This records the transfer as "pending". Update the status to "completed" once the on-chain transaction confirms, and attach the tx hash.
          </p>
        </div>
        <div className="flex justify-end gap-2 px-5 py-4 border-t border-surface-border">
          <button type="button" onClick={onCancel} disabled={busy}
            className="px-4 py-2 rounded-xl border border-surface-border text-sm text-white/80 hover:border-white/30 transition-colors disabled:opacity-50">
            Cancel
          </button>
          <button type="button" onClick={onConfirm} disabled={busy}
            className="px-5 py-2 rounded-xl bg-gold text-black font-bold text-sm hover:bg-gold transition-colors disabled:opacity-50 flex items-center gap-2">
            {busy ? <RefreshCw size={14} className="animate-spin" /> : <Send size={14} />}
            {busy ? 'Recording…' : 'Confirm & Record'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── UpdateStatusModal ────────────────────────────────────────────────── */

function RpcVerificationBadge({ rpc }) {
  if (!rpc) return null;
  const state = rpc.chain_status || 'pending';
  const verified = rpc.verified;

  if (!verified && rpc.error) {
    const isUnsupported = rpc.chain_status === 'unsupported';
    return (
      <div className={`rounded-lg border px-3 py-2 text-xs leading-relaxed ${isUnsupported ? 'border-white/10 bg-white/5 text-white/50' : 'border-gold/30 bg-gold/10 text-gold-light'}`}>
        <p className="font-semibold mb-0.5">{isUnsupported ? 'Manual verification required' : 'RPC check failed'}</p>
        <p className="text-white/50">{rpc.error}</p>
      </div>
    );
  }

  if (state === 'mined') {
    return (
      <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-200 space-y-1">
        <div className="flex items-center gap-1.5 font-semibold">
          <CheckCircle2 size={13} /> Transaction mined on-chain
        </div>
        {rpc.confirmations > 0 && <p className="text-emerald-300/70">Confirmations: {rpc.confirmations}</p>}
        {rpc.block_height && <p className="text-emerald-300/50">Block: {rpc.block_height}</p>}
        <p className="text-emerald-300/50 text-[10px]">Status auto-set to <strong>completed</strong></p>
      </div>
    );
  }
  if (state === 'failed') {
    return (
      <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-200 space-y-1">
        <div className="flex items-center gap-1.5 font-semibold"><XCircle size={13} /> Transaction reverted on-chain</div>
        {rpc.block_height && <p className="text-rose-300/50">Block: {rpc.block_height}</p>}
        <p className="text-rose-300/50 text-[10px]">Status auto-set to <strong>failed</strong></p>
      </div>
    );
  }
  return (
    <div className="rounded-lg border border-gold/20 bg-gold/5 px-3 py-2 text-xs text-gold-light/80 flex items-center gap-1.5">
      <Clock size={12} /> Not yet mined — status remains pending
    </div>
  );
}

function UpdateStatusModal({ open, transfer, onClose, onSaved }) {
  const [status, setStatus] = useState('');
  const [txHash, setTxHash] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [rpcResult, setRpcResult] = useState(null);

  useEffect(() => {
    if (!open || !transfer) return;
    setStatus(transfer.status || 'pending');
    setTxHash(transfer.tx_hash || '');
    setNote(transfer.note || '');
    setErr('');
    setRpcResult(transfer.rpc_verification || null);
  }, [open, transfer]);

  if (!open || !transfer) return null;

  const save = async () => {
    setBusy(true);
    setErr('');
    setRpcResult(null);
    try {
      const r = await api.patchTreasuryTransfer(transfer.id, {
        status: status || undefined,
        tx_hash: txHash.trim() || undefined,
        note: note.trim() || undefined,
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j?.detail || 'Update failed');
      // Show RPC result from the response before closing
      if (j.rpc_verification) {
        setRpcResult(j.rpc_verification);
        // Sync status field to whatever the backend auto-set
        if (j.status) setStatus(j.status);
        onSaved(j);
        // Don't auto-close — let admin see the RPC result
        setBusy(false);
        return;
      }
      onSaved(j);
      onClose();
    } catch (e) {
      setErr(String(e?.message || e));
    } finally {
      setBusy(false);
    }
  };

  const isEvm = txHash.trim().startsWith('0x') && txHash.trim().length === 66;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-2xl border border-surface-border bg-surface-dark shadow-2xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-surface-border">
          <div>
            <h3 className="text-lg font-bold text-white">Update Transfer</h3>
            <p className="text-xs text-white/40 mt-0.5">On-chain RPC verification runs on save</p>
          </div>
          <button type="button" onClick={onClose}><X size={20} className="text-white/50 hover:text-white" /></button>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <p className="text-xs text-white/50 mb-1">Transfer · <span className="font-mono">{transfer.id}</span></p>
            <p className="text-sm font-semibold text-white">{fmtNum(transfer.amount)} {transfer.asset} → {trimAddr(transfer.to_address)}</p>
          </div>
          <div>
            <label className={labelCls}>Status</label>
            <select className={inputCls} value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="pending">Pending</option>
              <option value="completed">Completed</option>
              <option value="failed">Failed</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </div>
          <div>
            <label className={labelCls}>
              Transaction Hash (on-chain)
              {isEvm && <span className="ml-1.5 text-[10px] text-emerald-400/80 normal-case font-normal">EVM — will be verified via RPC</span>}
            </label>
            <input
              className={`${inputCls} font-mono`}
              value={txHash}
              onChange={(e) => { setTxHash(e.target.value); setRpcResult(null); }}
              placeholder="0x… (EVM) or txid for other chains"
            />
            {txHash.trim() && !isEvm && (
              <p className="mt-1 text-[11px] text-gold-light/70 flex items-center gap-1">
                <Info size={11} /> Non-EVM hash — manual status update only (BTC/TRX/SOL not auto-verified)
              </p>
            )}
          </div>
          <div>
            <label className={labelCls}>Note</label>
            <textarea className={`${inputCls} resize-none`} rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Internal note…" />
          </div>

          {/* RPC verification result */}
          {rpcResult && <RpcVerificationBadge rpc={rpcResult} />}

          {err ? <p className="text-sm text-rose-300 flex items-center gap-1.5"><XCircle size={13} /> {err}</p> : null}
        </div>
        <div className="flex justify-end gap-2 px-5 py-4 border-t border-surface-border">
          <button type="button" onClick={onClose} disabled={busy}
            className="px-4 py-2 rounded-xl border border-surface-border text-sm text-white/80 hover:border-white/30 transition-colors disabled:opacity-50">
            {rpcResult ? 'Close' : 'Cancel'}
          </button>
          <button type="button" onClick={save} disabled={busy}
            className="px-5 py-2 rounded-xl bg-gold text-surface-dark font-bold text-sm hover:bg-gold/90 transition-colors disabled:opacity-50 flex items-center gap-2">
            {busy ? <RefreshCw size={14} className="animate-spin" /> : null}
            {busy ? 'Verifying…' : rpcResult ? 'Save again' : 'Save & Verify'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── TreasuryBalancesPanel ────────────────────────────────────────────── */

function TreasuryBalancesPanel({ selectedAsset, selectedNetwork }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setErr('');
    try {
      const r = await api.adminWallet();
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j?.detail || 'Failed to load balances');
      setData(j);
    } catch (e) {
      setErr(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Flatten all balance_parts from onchain_cards
  const cards = data?.onchain_cards || [];
  const hasAnyBalance = cards.some((c) => (c.balance_parts || []).some((p) => Number(p.amount) > 0));

  // Highlight the card matching current selection
  const matchNet = (selectedNetwork || '').toLowerCase();
  const matchAsset = (selectedAsset || '').toUpperCase();

  return (
    <div className="rounded-2xl border border-surface-border bg-surface-card/60 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-surface-border/60">
        <div className="flex items-center gap-2">
          <Wallet size={15} className="text-violet-300" />
          <span className="text-sm font-bold text-white">Available Treasury Balances</span>
          <span className="text-[10px] text-white/35 border border-surface-border rounded px-1.5 py-0.5">Live · on-chain</span>
        </div>
        <button
          type="button"
          onClick={load}
          disabled={loading}
          className="p-1.5 rounded-lg text-white/40 hover:text-white hover:bg-white/5 transition-colors disabled:opacity-30"
          title="Refresh balances"
        >
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* Content */}
      <div className="p-4">
        {loading ? (
          <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">
            {[1, 2, 3].map((n) => (
              <div key={n} className="h-20 rounded-xl bg-white/5 animate-pulse" />
            ))}
          </div>
        ) : err ? (
          <div className="rounded-lg border border-gold/25 bg-gold/10 px-3 py-2.5 text-xs text-gold-light/80 flex items-center gap-2">
            <ShieldAlert size={13} className="shrink-0 text-gold" />
            Could not load live balances: {err}.{' '}
            <Link to="/admin-wallet" className="text-gold-light underline hover:no-underline">Check Admin Wallet</Link>
          </div>
        ) : !cards.length ? (
          <div className="text-xs text-white/40 flex items-center gap-2">
            <Info size={13} />
            No treasury wallets configured yet.{' '}
            <Link to="/treasury-omnibus" className="text-gold-light hover:underline">Set up Hot & Cold Wallets</Link>
          </div>
        ) : (
          <>
            {!hasAnyBalance && (
              <div className="mb-3 rounded-lg border border-gold/25 bg-gold/10 px-3 py-2.5 text-xs text-gold-light/80 flex items-start gap-2">
                <ShieldAlert size={13} className="shrink-0 mt-0.5 text-gold" />
                <span>
                  Hot wallet appears empty. User deposits may still be on HD addresses — run a{' '}
                  <Link to="/treasury-omnibus" className="text-gold-light underline">deposit sweep</Link> to consolidate funds.
                </span>
              </div>
            )}
            <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">
              {cards.map((card) => {
                const cardNet = (card.network || '').toLowerCase();
                const parts = card.balance_parts || [];
                const isMatch = matchNet && cardNet.includes(matchNet.split(' ')[0])
                  || (matchNet.includes('bep') && cardNet.includes('bsc'))
                  || (matchNet.includes('erc') && cardNet.includes('eth'));
                const matchedPart = parts.find((p) => (p.asset || '').toUpperCase() === matchAsset);

                return (
                  <div
                    key={card.id || card.network}
                    className={`rounded-xl border p-3 transition-colors ${
                      isMatch
                        ? 'border-gold/40 bg-gold/10'
                        : 'border-surface-border bg-surface-dark/50'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-xs font-bold text-white/80 truncate">{card.network_label || card.network}</p>
                      {isMatch && (
                        <span className="text-[9px] font-bold uppercase tracking-wide text-gold-light border border-gold/30 rounded px-1 py-0.5">
                          Selected
                        </span>
                      )}
                    </div>
                    {card.balance_note ? (
                      <p className="text-xs text-gold-light/70 leading-relaxed">{card.balance_note}</p>
                    ) : parts.length === 0 ? (
                      <p className="text-xs text-white/30 font-mono">0</p>
                    ) : (
                      <ul className="space-y-1">
                        {parts.map((p) => {
                          const isAssetMatch = (p.asset || '').toUpperCase() === matchAsset;
                          const balance = Number(p.amount || 0);
                          return (
                            <li key={p.asset} className={`flex items-baseline justify-between gap-2 ${isAssetMatch ? 'opacity-100' : 'opacity-60'}`}>
                              <span className={`text-xs font-semibold ${isAssetMatch ? 'text-gold-light' : 'text-white/55'}`}>{p.asset}</span>
                              <span className={`text-sm font-extrabold font-mono tabular-nums ${
                                balance === 0 ? 'text-white/30' :
                                balance < 10 ? 'text-gold-light' :
                                'text-white'
                              }`}>
                                {fmtNum(balance, 4)}
                              </span>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                    {card.address && (
                      <p className="mt-2 pt-2 border-t border-white/5 font-mono text-[10px] text-white/30 truncate" title={card.address}>
                        {card.address.slice(0, 10)}…{card.address.slice(-6)}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
            <p className="mt-3 text-[11px] text-white/35 flex items-center gap-1.5">
              <Info size={11} />
              Balances are read live from RPC. Highlighted card = matches your selected network.
              {' '}<Link to="/admin-wallet" className="text-gold-light hover:underline inline-flex items-center gap-0.5">Full treasury view <ArrowUpRight size={10} /></Link>
            </p>
          </>
        )}
      </div>
    </div>
  );
}

/* ── TransferForm ─────────────────────────────────────────────────────── */

const ASSET_OPTS = [
  'USDT', 'BTC', 'ETH', 'BNB', 'IBO', 'USDC', 'TRX', 'MATIC', 'SOL',
  'XRP', 'ADA', 'DOT', 'AVAX', 'LINK', 'LTC', 'BCH', 'DOGE', 'SHIB',
];

const NETWORK_OPTS = [
  'BEP-20 (BSC)', 'ERC-20 (Ethereum)', 'TRC-20 (Tron)',
  'Bitcoin (BTC)', 'Solana', 'Polygon', 'Avalanche C-Chain',
];

function TransferForm({ onCreated, canManage, onAssetChange, onNetworkChange }) {
  const [asset, setAsset] = useState('USDT');
  const [assetCustom, setAssetCustom] = useState('');
  const [network, setNetwork] = useState('BEP-20 (BSC)');
  const [networkCustom, setNetworkCustom] = useState('');

  const handleAssetChange = (v) => { setAsset(v); onAssetChange?.(v === '__custom__' ? assetCustom : v); };
  const handleNetworkChange = (v) => { setNetwork(v); onNetworkChange?.(v === '__custom__' ? networkCustom : v); };
  const [fromAddress, setFromAddress] = useState('');
  const [toAddress, setToAddress] = useState('');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [knownAddresses, setKnownAddresses] = useState([]);
  const [supportedAssets, setSupportedAssets] = useState(ASSET_OPTS);
  const [supportedNetworks, setSupportedNetworks] = useState(NETWORK_OPTS);

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formErr, setFormErr] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  const effectiveAsset = asset === '__custom__' ? assetCustom.trim().toUpperCase() : asset;
  const effectiveNetwork = network === '__custom__' ? networkCustom.trim() : network;

  useEffect(() => {
    let alive = true;
    api.treasuryTransferKnownAddresses()
      .then((r) => r.json().catch(() => ({})))
      .then((j) => {
        if (!alive) return;
        setKnownAddresses(Array.isArray(j.addresses) ? j.addresses : []);
        if (Array.isArray(j.supported_assets) && j.supported_assets.length) setSupportedAssets(j.supported_assets);
        if (Array.isArray(j.supported_networks) && j.supported_networks.length) setSupportedNetworks(j.supported_networks);
      })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  const openConfirm = () => {
    setFormErr('');
    setSuccessMsg('');
    if (!effectiveAsset) return setFormErr('Please select or enter an asset.');
    if (!effectiveNetwork) return setFormErr('Please select or enter a network.');
    if (!toAddress.trim()) return setFormErr('Destination address is required.');
    const amt = parseFloat(amount);
    if (!amount || isNaN(amt) || amt <= 0) return setFormErr('Enter a valid positive amount.');
    setConfirmOpen(true);
  };

  const handleConfirm = async () => {
    setSubmitting(true);
    setFormErr('');
    try {
      const r = await api.createTreasuryTransfer({
        asset: effectiveAsset,
        network: effectiveNetwork,
        from_address: fromAddress.trim() || undefined,
        to_address: toAddress.trim(),
        amount: parseFloat(amount),
        note: note.trim() || undefined,
        status: 'pending',
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j?.detail || 'Failed to record transfer');
      setConfirmOpen(false);
      setSuccessMsg(`Transfer recorded successfully. ID: ${j.id}`);
      setToAddress('');
      setAmount('');
      setNote('');
      setFromAddress('');
      onCreated(j);
    } catch (e) {
      setConfirmOpen(false);
      setFormErr(String(e?.message || e));
    } finally {
      setSubmitting(false);
    }
  };

  if (!canManage) {
    return (
      <div className="rounded-xl border border-gold/30 bg-gold/10 px-4 py-3 text-sm text-gold-light">
        You need <strong>manage_treasury</strong> permission to initiate transfers.
      </div>
    );
  }

  return (
    <>
      <div className="grid gap-5 sm:grid-cols-2">
        {/* Asset */}
        <div>
          <label className={labelCls}>Asset / Coin</label>
          <div className="flex gap-2">
            <select
              className={inputCls}
              value={asset}
              onChange={(e) => handleAssetChange(e.target.value)}
            >
              {supportedAssets.map((a) => <option key={a} value={a}>{a === 'IBO' ? 'Delta' : a}</option>)}
              <option value="__custom__">Other (type below)</option>
            </select>
          </div>
          {asset === '__custom__' && (
            <input
              className={`${inputCls} mt-2`}
              value={assetCustom}
              onChange={(e) => { setAssetCustom(e.target.value.toUpperCase()); onAssetChange?.(e.target.value.toUpperCase()); }}
              placeholder="e.g. PEPE"
            />
          )}
        </div>

        {/* Network */}
        <div>
          <label className={labelCls}>Network / Chain</label>
          <select className={inputCls} value={network} onChange={(e) => handleNetworkChange(e.target.value)}>
            {supportedNetworks.map((n) => <option key={n} value={n}>{n}</option>)}
            <option value="__custom__">Other (type below)</option>
          </select>
          {network === '__custom__' && (
            <input
              className={`${inputCls} mt-2`}
              value={networkCustom}
              onChange={(e) => { setNetworkCustom(e.target.value); onNetworkChange?.(e.target.value); }}
              placeholder="e.g. Arbitrum One"
            />
          )}
        </div>

        {/* Amount */}
        <div>
          <label className={labelCls}>Amount</label>
          <div className="relative">
            <input
              type="number"
              min="0"
              step="any"
              className={`${inputCls} pr-20`}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
            />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-bold text-gold-light pointer-events-none">
              {effectiveAsset || 'ASSET'}
            </span>
          </div>
        </div>

        {/* From address */}
        <div>
          <label className={labelCls}>From Address <span className="text-white/30 font-normal normal-case">(optional — for record-keeping)</span></label>
          <input
            className={`${inputCls} font-mono`}
            value={fromAddress}
            onChange={(e) => setFromAddress(e.target.value)}
            placeholder="Treasury source wallet (0x… / T… / bc1…)"
          />
        </div>

        {/* Destination address — full width */}
        <div className="sm:col-span-2">
          <AddressPicker
            addresses={knownAddresses}
            value={toAddress}
            onChange={setToAddress}
            selectedAsset={effectiveAsset}
          />
        </div>

        {/* Note */}
        <div className="sm:col-span-2">
          <label className={labelCls}>Note / Memo <span className="text-white/30 font-normal normal-case">(optional)</span></label>
          <textarea
            className={`${inputCls} resize-none`}
            rows={2}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Internal note for audit trail…"
          />
        </div>
      </div>

      {formErr && (
        <p className="mt-3 text-sm text-rose-300 flex items-center gap-1.5">
          <XCircle size={14} /> {formErr}
        </p>
      )}
      {successMsg && (
        <div className="mt-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-2.5 text-sm text-emerald-200 flex items-center gap-2">
          <CheckCircle2 size={14} className="shrink-0" /> {successMsg}
        </div>
      )}

      <div className="mt-5 flex items-center justify-between gap-3">
        <p className="text-xs text-white/40 flex items-center gap-1">
          <Info size={12} />
          Transfer is recorded as "pending". Update status &amp; attach tx hash after broadcast.
        </p>
        <button
          type="button"
          onClick={openConfirm}
          disabled={submitting}
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-gold to-gold text-surface-dark font-bold text-sm hover:opacity-90 transition-opacity disabled:opacity-50 shrink-0"
        >
          <Send size={15} />
          Send Transfer
        </button>
      </div>

      <ConfirmModal
        open={confirmOpen}
        transfer={{ asset: effectiveAsset, network: effectiveNetwork, from_address: fromAddress, to_address: toAddress, amount: parseFloat(amount) || 0, note }}
        onConfirm={handleConfirm}
        onCancel={() => { setConfirmOpen(false); setSubmitting(false); }}
        busy={submitting}
      />
    </>
  );
}

/* ── BalanceAwareTransferForm ─────────────────────────────────────────── */

function BalanceAwareTransferForm({ onCreated, canManage }) {
  const [selectedAsset, setSelectedAsset] = useState('USDT');
  const [selectedNetwork, setSelectedNetwork] = useState('BEP-20 (BSC)');

  return (
    <div className="space-y-5">
      <TreasuryBalancesPanel selectedAsset={selectedAsset} selectedNetwork={selectedNetwork} />
      <div className="border-t border-surface-border/60" />
      <TransferForm
        onCreated={onCreated}
        canManage={canManage}
        onAssetChange={setSelectedAsset}
        onNetworkChange={setSelectedNetwork}
      />
    </div>
  );
}

/* ── Overview Stats ───────────────────────────────────────────────────── */

function StatsOverview({ stats, loading }) {
  if (loading) {
    return (
      <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {[1, 2, 3, 4].map((n) => (
          <div key={n} className="admin-kpi-card animate-pulse min-h-[90px]" />
        ))}
      </div>
    );
  }

  if (!stats) return null;

  return (
    <div className="space-y-4">
      <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <GradientStatCard
          label="Total transfers"
          value={String(stats.grand_count ?? 0)}
          hint={`${stats.completed_count ?? 0} completed · ${stats.pending_count ?? 0} pending`}
          tone="violet"
        />
        <GradientStatCard
          label="Total volume"
          value={fmtNum(stats.grand_amount, 4)}
          hint="All assets combined (units)"
          tone="cyan"
        />
        <GradientStatCard
          label="Completed volume"
          value={fmtNum(stats.completed_amount, 4)}
          hint={`${stats.completed_count ?? 0} confirmed transfers`}
          tone="emerald"
        />
        <GradientStatCard
          label="Pending"
          value={String(stats.pending_count ?? 0)}
          hint="Awaiting on-chain confirmation"
          tone="amber"
        />
      </div>

      {/* Per-asset breakdown */}
      {(stats.by_asset || []).length > 0 && (
        <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">
          {stats.by_asset.slice(0, 6).map((a) => (
            <article key={a.asset} className="admin-kpi-card py-3 px-4">
              <div className="flex items-center justify-between gap-2 mb-2">
                <span className="text-sm font-bold text-white">{a.asset}</span>
                <span className="text-[10px] text-white/40 uppercase tracking-wide">{a.total_count} txns</span>
              </div>
              <p className="text-lg font-extrabold font-mono text-gold tabular-nums">{fmtNum(a.total_amount, 6)}</p>
              <p className="text-xs text-white/45 mt-0.5">{fmtNum(a.completed_amount, 6)} completed</p>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

/* ── History Table ────────────────────────────────────────────────────── */

const STATUS_OPTS = [
  { value: '', label: 'All statuses' },
  { value: 'pending', label: 'Pending' },
  { value: 'completed', label: 'Completed' },
  { value: 'failed', label: 'Failed' },
  { value: 'cancelled', label: 'Cancelled' },
];

const ASSET_FILTER_OPTS = [
  { value: '', label: 'All assets' },
  ...['USDT', 'BTC', 'ETH', 'BNB', 'IBO', 'USDC', 'TRX'].map((a) => ({ value: a, label: a === 'IBO' ? 'Delta' : a })),
];

function HistoryTable({ canManage, newItem }) {
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [skip, setSkip] = useState(0);
  const [limit, setLimit] = useState(25);
  const [assetF, setAssetF] = useState('');
  const [statusF, setStatusF] = useState('');
  const [search, setSearch] = useState('');
  const [editTransfer, setEditTransfer] = useState(null);
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setErr('');
    try {
      const params = { skip: String(skip), limit: String(limit) };
      if (assetF) params.asset = assetF;
      if (statusF) params.status = statusF;
      if (search.trim()) params.search = search.trim();
      const r = await api.treasuryTransfers(params);
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j?.detail || 'Failed to load history');
      setItems(Array.isArray(j.items) ? j.items : []);
      setTotal(Number(j.total) || 0);
    } catch (e) {
      setErr(String(e?.message || e));
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [skip, limit, assetF, statusF, search]);

  useEffect(() => { load(); }, [load]);

  // When a new item is created, refresh
  useEffect(() => {
    if (!newItem) return;
    setSkip(0);
    load();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [newItem]);

  const page = Math.floor(skip / limit) + 1;
  const pageCount = Math.max(1, Math.ceil(total / limit));

  const handleSaved = (updated) => {
    setItems((prev) => prev.map((it) => it.id === updated.id ? updated : it));
    setEditTransfer(null);
  };

  return (
    <>
      <FilterBar className="mb-4">
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3 items-end">
          <div className="flex flex-col gap-1">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-white/45">Asset</span>
            <select
              className="rounded-xl bg-surface-dark border border-surface-border px-3 py-2 text-sm text-white focus:outline-none focus:border-gold/50 min-h-[42px]"
              value={assetF}
              onChange={(e) => { setAssetF(e.target.value); setSkip(0); }}
            >
              {ASSET_FILTER_OPTS.map((o) => <option key={o.value || 'all'} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-white/45">Status</span>
            <select
              className="rounded-xl bg-surface-dark border border-surface-border px-3 py-2 text-sm text-white focus:outline-none focus:border-gold/50 min-h-[42px]"
              value={statusF}
              onChange={(e) => { setStatusF(e.target.value); setSkip(0); }}
            >
              {STATUS_OPTS.map((o) => <option key={o.value || 'all'} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <div className="flex flex-col gap-1 sm:col-span-2">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-white/45">Search</span>
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/40 pointer-events-none" />
              <input
                value={search}
                onChange={(e) => { setSearch(e.target.value); setSkip(0); }}
                placeholder="Address, tx hash, note, admin…"
                className="rounded-xl bg-surface-dark border border-surface-border pl-9 pr-3 py-2 text-sm text-white placeholder-white/40 focus:outline-none focus:border-gold/50 min-h-[42px] w-full"
              />
            </div>
          </div>
        </div>
      </FilterBar>

      {err && (
        <div className="mb-3 rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-2.5 text-sm text-rose-200">{err}</div>
      )}

      <div className="-mx-4 sm:-mx-5">
        <AdminDataTable>
          <thead>
            <tr>
              <th>Time</th>
              <th>Asset</th>
              <th>Amount</th>
              <th>Network</th>
              <th>To Address</th>
              <th>Status</th>
              <th>Tx Hash</th>
              <th>Admin</th>
              {canManage ? <th className="w-10" /> : null}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={canManage ? 9 : 8} className="text-center text-white/45 py-8">Loading…</td></tr>
            ) : items.length === 0 ? (
              <tr>
                <td colSpan={canManage ? 9 : 8} className="py-12 text-center">
                  <div className="flex flex-col items-center gap-2 text-white/40">
                    <Send size={24} className="opacity-40" />
                    <p className="text-sm">No transfers recorded yet.</p>
                  </div>
                </td>
              </tr>
            ) : items.map((row) => (
              <tr key={row.id}>
                <td className="text-white/70 text-xs whitespace-nowrap">{fmtTs(row.created_at)}</td>
                <td>
                  <span className="inline-flex items-center gap-1">
                    <span className="text-sm font-bold text-white">{row.asset}</span>
                  </span>
                </td>
                <td className="font-mono text-sm font-semibold text-gold tabular-nums whitespace-nowrap">
                  {fmtNum(row.amount)} {row.asset}
                </td>
                <td className="text-xs text-white/60 max-w-[140px] truncate" title={row.network}>{row.network || '—'}</td>
                <td>
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className="font-mono text-[11px] text-white/70 truncate max-w-[120px]" title={row.to_address}>
                      {trimAddr(row.to_address)}
                    </span>
                    {row.to_address ? <CopyButton text={row.to_address} /> : null}
                  </div>
                  {row.from_address ? (
                    <p className="font-mono text-[10px] text-white/35 mt-0.5 truncate max-w-[140px]" title={row.from_address}>
                      from: {trimAddr(row.from_address)}
                    </p>
                  ) : null}
                </td>
                <td>
                  <span className="inline-flex items-center gap-1.5">
                    <StatusIcon status={row.status} />
                    <StatusBadge compact tone={statusTone(row.status)}>
                      {row.status || '—'}
                    </StatusBadge>
                  </span>
                  {row.note ? (
                    <p className="text-[10px] text-white/40 mt-0.5 max-w-[120px] truncate" title={row.note}>{row.note}</p>
                  ) : null}
                </td>
                <td className="font-mono text-[11px]">
                  {row.tx_hash ? (
                    <div className="flex items-center gap-1">
                      <span className="text-cyan-300 truncate max-w-[100px]" title={row.tx_hash}>{trimTx(row.tx_hash)}</span>
                      <CopyButton text={row.tx_hash} />
                    </div>
                  ) : (
                    <span className="text-white/30">—</span>
                  )}
                  {row.rpc_verification?.verified && (
                    <p className={`text-[10px] mt-0.5 flex items-center gap-0.5 ${row.rpc_verification.chain_status === 'mined' ? 'text-emerald-400/70' : 'text-rose-400/70'}`}>
                      {row.rpc_verification.chain_status === 'mined'
                        ? <><CheckCircle2 size={10} /> RPC: mined ({row.rpc_verification.confirmations}c)</>
                        : <><XCircle size={10} /> RPC: {row.rpc_verification.chain_status}</>
                      }
                    </p>
                  )}
                </td>
                <td className="text-xs text-white/50 max-w-[120px] truncate" title={row.admin_email}>{row.admin_email || '—'}</td>
                {canManage ? (
                  <td className="text-right">
                    <button
                      type="button"
                      onClick={() => setEditTransfer(row)}
                      className="p-1.5 rounded-lg text-white/40 hover:text-gold hover:bg-white/5 transition-colors"
                      title="Update status / tx hash"
                    >
                      <Edit2 size={13} />
                    </button>
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </AdminDataTable>
      </div>

      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mt-4 pt-4 border-t border-surface-border/60">
        <span className="text-sm text-white/60">{total} total · page {page} of {pageCount}</span>
        <div className="flex flex-wrap items-center gap-2">
          <select
            className="rounded-xl bg-surface-dark border border-surface-border px-3 py-2 text-sm text-white focus:outline-none focus:border-gold/50 min-h-[42px]"
            value={limit}
            onChange={(e) => { setLimit(Number(e.target.value)); setSkip(0); }}
          >
            {[10, 25, 50, 100].map((n) => <option key={n} value={n}>{n} / page</option>)}
          </select>
          <button type="button"
            className="rounded-xl bg-surface-dark border border-surface-border px-3 py-2 text-sm text-white/80 disabled:opacity-40"
            disabled={skip <= 0}
            onClick={() => setSkip(Math.max(0, skip - limit))}>
            Prev
          </button>
          <button type="button"
            className="rounded-xl bg-surface-dark border border-surface-border px-3 py-2 text-sm text-white/80 disabled:opacity-40"
            disabled={skip + limit >= total}
            onClick={() => setSkip(skip + limit)}>
            Next
          </button>
        </div>
      </div>

      <UpdateStatusModal
        open={!!editTransfer}
        transfer={editTransfer}
        onClose={() => setEditTransfer(null)}
        onSaved={handleSaved}
      />
    </>
  );
}

/* ── Main Page ────────────────────────────────────────────────────────── */

export default function TreasuryTransferPage() {
  const { admin } = useAdminAuth();
  const canManage = hasPermission(admin, 'manage_treasury');

  const [stats, setStats] = useState(null);
  const [statsLoading, setStatsLoading] = useState(true);
  const [statsErr, setStatsErr] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [newItem, setNewItem] = useState(null);

  const loadStats = useCallback(async ({ force = false } = {}) => {
    if (force) setRefreshing(true);
    setStatsErr('');
    try {
      const r = await api.treasuryTransferStats();
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j?.detail || 'Failed to load stats');
      setStats(j);
    } catch (e) {
      setStatsErr(String(e?.message || e));
    } finally {
      setStatsLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { loadStats(); }, [loadStats]);

  const handleCreated = (item) => {
    setNewItem(item);
    loadStats({ force: true });
  };

  return (
    <div className="space-y-6 pb-10">
      <AdminPageHeader
        icon={Send}
        iconClassName="text-gold"
        title="Treasury Transfer"
        subtitle="Initiate manual transfers from treasury wallets to any address. All transfers are logged with full audit trail."
        badge="manage_treasury"
        actionsWithBadge
        actions={(
          <button
            type="button"
            onClick={() => loadStats({ force: true })}
            disabled={refreshing}
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl border border-surface-border text-sm text-white/80 hover:border-gold/40 transition-colors disabled:opacity-50"
          >
            <RefreshCw size={15} className={refreshing ? 'animate-spin' : ''} />
            Refresh
          </button>
        )}
      />

      {statsErr && (
        <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">{statsErr}</div>
      )}

      {/* Stats overview */}
      <AdminPanel
        title="Overview"
        subtitle="Aggregate stats across all treasury transfers."
        right={(
          <span className="inline-flex items-center gap-1.5 text-xs text-white/45">
            <BarChart3 size={13} /> All-time
          </span>
        )}
      >
        <StatsOverview stats={stats} loading={statsLoading} />
      </AdminPanel>

      {/* Transfer form */}
      <AdminPanel
        title="New Transfer"
        subtitle="Check available balances below before sending, then fill in the form. The transfer is logged as pending — attach the on-chain tx hash to complete it."
        right={(
          <span className="inline-flex items-center gap-1.5 text-[11px] text-white/40 border border-white/10 rounded-lg px-2 py-1">
            <TrendingUp size={12} /> Audit-logged
          </span>
        )}
      >
        <BalanceAwareTransferForm onCreated={handleCreated} canManage={canManage} />
      </AdminPanel>

      {/* History */}
      <AdminPanel
        title="Transfer History"
        subtitle="All recorded treasury transfers — filter by asset, status, or address. Click the edit icon to update status or attach a transaction hash."
        right={(
          <span className="inline-flex items-center gap-1.5 text-xs text-white/45">
            <Hash size={13} /> Append-only log
          </span>
        )}
      >
        <HistoryTable canManage={canManage} newItem={newItem} />
      </AdminPanel>
    </div>
  );
}
