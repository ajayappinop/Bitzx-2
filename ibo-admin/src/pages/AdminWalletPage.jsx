import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Wallet, RefreshCw, ArrowUpRight, Copy, Check, Search, Pencil, X,
} from 'lucide-react';
import { api } from '@/lib/api';
import { useAdminAuth } from '@/context/AdminAuthContext';
import { hasPermission } from '@/lib/adminAccess';
import { AdminPageHeader, AdminPanel, GradientStatCard, FilterBar, AdminDataTable, StatusBadge } from '@/components/AdminPrimitives';
import UserUidSuggestInput from '@/components/UserUidSuggestInput';

function fmtNum(n, dp = 4) {
  const v = Number(n);
  if (!Number.isFinite(v)) return '—';
  return v.toLocaleString(undefined, { maximumFractionDigits: dp, minimumFractionDigits: 0 });
}

function fmtTs(iso) {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleString(); } catch { return iso; }
}

function trimAddr(a) {
  if (!a) return '—';
  if (a.length <= 18) return a;
  return `${a.slice(0, 10)}…${a.slice(-8)}`;
}

function trimTx(h) {
  if (!h) return '—';
  if (h.length <= 22) return h;
  return `${h.slice(0, 12)}…${h.slice(-8)}`;
}

function assetHint(byAsset) {
  if (!byAsset || typeof byAsset !== 'object') return '';
  const parts = Object.entries(byAsset)
    .filter(([, v]) => Number(v) > 0)
    .sort((a, b) => Number(b[1]) - Number(a[1]))
    .slice(0, 3)
    .map(([a, v]) => `${fmtNum(v)} ${a}`);
  return parts.join(' · ') || '';
}

const inputClass = 'rounded-xl bg-surface-dark border border-surface-border px-3 py-2 text-sm text-white placeholder-white/40 focus:outline-none focus:border-gold/50';
const selectClass = `${inputClass} min-h-[42px]`;

const OVERVIEW_CACHE_KEY = 'ibo:admin-wallet:overview:v1';
const TX_CACHE_PREFIX = 'ibo:admin-wallet:tx:v1:';

function readSessionJson(key) {
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function writeSessionJson(key, payload) {
  try {
    sessionStorage.setItem(key, JSON.stringify(payload));
  } catch {
    /* session quota */
  }
}

function readOverviewCache() {
  return readSessionJson(OVERVIEW_CACHE_KEY)?.data ?? null;
}

function writeOverviewCache(data) {
  writeSessionJson(OVERVIEW_CACHE_KEY, { savedAt: Date.now(), data });
}

function txCacheKey(params) {
  return `${TX_CACHE_PREFIX}${JSON.stringify(params)}`;
}

function readTxCache(params) {
  return readSessionJson(txCacheKey(params))?.data ?? null;
}

function writeTxCache(params, data) {
  writeSessionJson(txCacheKey(params), { savedAt: Date.now(), data });
}

function SearchField({ value, onChange, placeholder, mono = false }) {
  return (
    <div className="relative w-full">
      <span
        className="pointer-events-none absolute inset-y-0 left-0 z-10 flex w-9 items-center justify-center text-gold-light/80"
        aria-hidden
      >
        <Search size={15} strokeWidth={2.25} />
      </span>
      <input
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        className={`${inputClass} w-full min-h-[42px] pl-10 pr-3 ${mono ? 'font-mono' : ''}`}
      />
    </div>
  );
}

function CopyButton({ text }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* ignore */ }
  };
  return (
    <button
      type="button"
      onClick={copy}
      className="p-1.5 rounded-lg border border-white/10 text-white/60 hover:text-gold hover:border-gold/40 transition-colors"
      title="Copy"
    >
      {copied ? <Check size={14} /> : <Copy size={14} />}
    </button>
  );
}


function rpcStatusLabel(rpc = {}) {
  if (rpc.admin_disabled) return { text: 'RPC disabled in admin settings', tone: 'amber' };
  if (rpc.rpc_configured === false) return { text: 'RPC not configured', tone: 'amber' };
  if (rpc.rpc_active === false) return { text: 'RPC inactive', tone: 'amber' };
  return { text: 'RPC connected', tone: 'emerald' };
}

function addressPlaceholder(slot) {
  const net = (slot?.network || '').toLowerCase();
  if (net.includes('tron')) return 'T…';
  if ((slot?.asset || '').toUpperCase() === 'BTC') return 'bc1…';
  return '0x…';
}

function BalanceList({ parts = [], emptyLabel = 'No balance data', note }) {
  if (note) {
    return <p className="text-xs text-gold-light/85 leading-relaxed">{note}</p>;
  }
  if (!parts.length) {
    return <p className="text-sm text-white/40 font-mono">{emptyLabel}</p>;
  }
  return (
    <ul className="space-y-2">
      {parts.map((p) => (
        <li key={p.asset || p.label} className="flex items-baseline justify-between gap-3">
          <span className="text-sm text-white/55">{p.asset || '—'}</span>
          <span className="text-base font-semibold font-mono text-white tabular-nums">
            {fmtNum(p.amount)}
          </span>
        </li>
      ))}
    </ul>
  );
}

function CustodyVsHotBanner({ custody, onchainCards = [] }) {
  const rows = custody?.rows || [];
  if (!rows.length) return null;

  const expectedParts = rows
    .filter((r) => Number(r.expected_net) > 0)
    .map((r) => `${fmtNum(r.expected_net)} ${r.asset}`)
    .join(' · ');

  const hotHasFunds = onchainCards.some((c) =>
    (c.balance_parts || []).some((p) => Number(p.amount) > 0),
  );

  if (!expectedParts || hotHasFunds) return null;

  return (
    <div className="mb-4 rounded-xl border border-gold/30 bg-gold/10 px-4 py-3 text-sm text-gold-light/90/90 leading-relaxed">
      <p className="font-semibold text-gold-light">Why is the hot wallet empty?</p>
      <p className="mt-1">
        Ledger custody shows credited user deposits ({expectedParts}) but those funds are still on
        per-user HD addresses — not in the withdrawal hot wallet until you run a deposit sweep.
      </p>
      <p className="mt-2 text-xs text-gold-light/90/75">
        {custody?.note || ''}
        {' '}
        <Link to="/treasury" className="text-gold-light font-semibold hover:underline">
          Treasury page
        </Link>
        {' '}
        tracks ledger custody; this section shows the hot wallet only.
      </p>
    </div>
  );
}

function LedgerCustodyTable({ custody }) {
  const rows = custody?.rows || [];
  if (!rows.length) return null;
  return (
    <div className="mb-5 -mx-4 sm:-mx-5">
      <AdminDataTable>
        <thead>
          <tr>
            <th>Ledger custody</th>
            <th className="text-right">Expected net</th>
            <th className="text-right">Mirrored</th>
            <th className="text-right">Sync gap</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.asset}>
              <td className="font-medium">{row.asset}</td>
              <td className="text-right font-mono">{fmtNum(row.expected_net)}</td>
              <td className="text-right font-mono">{fmtNum(row.mirrored_net)}</td>
              <td className={`text-right font-mono ${Number(row.sync_gap) !== 0 ? 'text-gold-light' : ''}`}>
                {fmtNum(row.sync_gap)}
              </td>
            </tr>
          ))}
        </tbody>
      </AdminDataTable>
    </div>
  );
}

function OnchainTreasuryCards({ cards = [], custody, loading }) {
  if (loading) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {[1, 2, 3].map((n) => (
          <div key={n} className="admin-kpi-card animate-pulse min-h-[200px]">
            <p className="text-sm text-white/40">Loading balances…</p>
          </div>
        ))}
      </div>
    );
  }
  if (!cards.length) {
    return (
      <p className="text-sm text-white/45">
        No withdrawal treasury wallets configured yet.
      </p>
    );
  }
  return (
    <>
      <CustodyVsHotBanner custody={custody} onchainCards={cards} />
      <LedgerCustodyTable custody={custody} />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {cards.map((card) => {
        const isTron = (card.network || '').toLowerCase().includes('tron');
        const addr = card.address || '';
        const showEvmSigner = card.signer_configured && addr.startsWith('0x');
        const showSigner = isTron ? false : showEvmSigner;
        return (
          <article key={card.id || `${card.network}-withdrawal`} className="admin-kpi-card flex flex-col gap-4">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-sm font-semibold text-white">{card.network_label || card.network}</p>
                <p className="text-xs text-white/45 mt-0.5">Withdrawal wallet</p>
              </div>
              {showSigner ? (
                <span className="admin-pill text-[10px] uppercase tracking-wide border-emerald-500/30 bg-emerald-500/10 text-emerald-300">
                  Env signer
                </span>
              ) : null}
            </div>
            <BalanceList
              parts={card.balance_parts}
              note={card.balance_note}
              emptyLabel={isTron ? 'TRC-20 payout not live yet' : '0 — hot wallet empty (see note above)'}
            />
            {addr ? (
              <div className="pt-3 mt-auto border-t border-white/10 flex items-center gap-2">
                <p className="flex-1 font-mono text-xs text-white/70 truncate" title={addr}>
                  {trimAddr(addr)}
                </p>
                <CopyButton text={addr} />
              </div>
            ) : (
              <p className="pt-3 mt-auto border-t border-white/10 text-xs text-white/40">
                {isTron ? 'Set a Tron treasury address above' : 'Treasury address not configured'}
              </p>
            )}
            {card.hint ? (
              <p className="text-[11px] text-white/35 leading-relaxed">{card.hint}</p>
            ) : null}
          </article>
        );
      })}
      </div>
    </>
  );
}

function RpcBadge({ rpc = {} }) {
  const s = rpcStatusLabel(rpc);
  return (
    <span
      className={`inline-block mt-1 text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded border ${
        s.tone === 'emerald'
          ? 'text-emerald-300/90 border-emerald-500/30 bg-emerald-500/10'
          : 'text-gold-light/90 border-gold/30 bg-gold/10'
      }`}
    >
      {s.text}
    </span>
  );
}

function TreasuryRailsTable({ cards = [], canManage, onEdit, loading }) {
  if (loading) {
    return <p className="text-sm text-white/45 px-1">Loading treasury rails…</p>;
  }
  if (!cards.length) {
    return <p className="text-sm text-white/45 px-1">No chain rails configured.</p>;
  }
  return (
    <div className="-mx-4 sm:-mx-5">
      <AdminDataTable>
        <thead>
          <tr>
            <th className="w-[11rem]">Chain</th>
            <th>User deposits</th>
            <th>Withdrawal treasury</th>
            {canManage ? <th className="w-12" aria-label="Actions" /> : null}
          </tr>
        </thead>
        <tbody>
          {cards.map((card) => {
            const dep = card.deposit;
            const wd = card.withdrawal;
            return (
              <tr key={card.network}>
                <td className="align-top">
                  <p className="text-sm font-semibold text-white">{card.network_label || card.network}</p>
                  <RpcBadge rpc={card.rpc} />
                </td>
                <td className="align-top max-w-sm">
                  <p className="text-sm text-white/85">Unique HD address per user</p>
                  <p className="text-xs text-white/50 mt-1">{dep?.covers_hint || '—'}</p>
                  <p className="text-xs text-white/40 mt-2 leading-relaxed">
                    No single platform deposit wallet. Per-user addresses come from the master mnemonic.
                  </p>
                  <Link
                    to="/deposit-events"
                    className="inline-flex items-center gap-1 text-xs text-gold-light hover:underline mt-2"
                  >
                    View deposit events <ArrowUpRight size={12} />
                  </Link>
                </td>
                <td className="align-top">
                  <p className="text-sm text-white/85">Platform payout &amp; sweep destination</p>
                  {wd?.covers_hint ? (
                    <p className="text-xs text-white/45 mt-1">{wd.covers_hint}</p>
                  ) : null}
                  {wd?.status_note ? (
                    <p className="text-xs text-gold-light/85 mt-1 leading-relaxed">{wd.status_note}</p>
                  ) : null}
                  {wd?.address ? (
                    <div className="flex items-start gap-2 mt-2 min-w-0">
                      <p className="font-mono text-xs text-white/80 break-all" title={wd.address}>
                        {wd.address}
                      </p>
                      <div className="flex items-center gap-1 shrink-0">
                        <CopyButton text={wd.address} />
                        {wd.signer_configured ? (
                          <span className="text-[10px] uppercase tracking-wide text-emerald-400/80">
                            env signer
                          </span>
                        ) : null}
                      </div>
                    </div>
                  ) : (
                    <p className="text-xs text-white/40 mt-2">Not configured</p>
                  )}
                  {wd?.signer_address && wd?.registered_address && wd.signer_address !== wd.registered_address ? (
                    <p className="text-[11px] text-gold-light/75 mt-1">
                      Omnibus registry ({trimAddr(wd.registered_address)}) differs from env signer.
                    </p>
                  ) : null}
                </td>
                {canManage ? (
                  <td className="align-top text-right">
                    {wd?.editable !== false ? (
                      <button
                        type="button"
                        onClick={() => onEdit(wd)}
                        className="p-1.5 rounded-lg text-white/45 hover:text-gold hover:bg-white/5 transition-colors"
                        title="Edit withdrawal treasury address"
                      >
                        <Pencil size={14} />
                      </button>
                    ) : null}
                  </td>
                ) : null}
              </tr>
            );
          })}
        </tbody>
      </AdminDataTable>
    </div>
  );
}

function EditAddressModal({ open, slot, onClose, onSaved }) {
  const [address, setAddress] = useState('');
  const [label, setLabel] = useState('');
  const [enabled, setEnabled] = useState(true);
  const [busy, setBusy] = useState(false);
  const [formErr, setFormErr] = useState('');

  useEffect(() => {
    if (!open || !slot) return;
    const initial = slot.registered_address || slot.address || slot.signer_address || '';
    setAddress(initial);
    setLabel(slot.label || '');
    setEnabled(slot.enabled !== false);
    setFormErr('');
  }, [open, slot]);

  if (!open || !slot) return null;

  const networkLabel = slot.network_label || slot.network || '';
  const envKey = slot.role === 'cold' && slot.asset === 'IBO'
    ? 'TREASURY_COLD_PRIVATE_KEY'
    : (slot.role === 'hot' && ['ETH', 'USDT', 'IBO'].includes(slot.asset)
      ? 'TREASURY_ETH_PRIVATE_KEY'
      : null);

  const save = async () => {
    setBusy(true);
    setFormErr('');
    try {
      const body = {
        wallet: {
          role: slot.role,
          asset: slot.asset,
          network: slot.network,
          address: address.trim(),
          label: label.trim() || null,
          enabled,
        },
      };
      const r = await api.adminWalletPatchAddresses(body);
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j?.detail || 'Save failed');
      onSaved(j);
      onClose();
    } catch (e) {
      setFormErr(String(e?.message || e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60">
      <div className="w-full max-w-lg rounded-2xl border border-surface-border bg-surface-dark shadow-xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-surface-border">
          <h3 className="text-lg font-semibold text-white">
            Edit withdrawal treasury · {networkLabel}
          </h3>
          <button type="button" onClick={onClose} className="text-white/50 hover:text-white"><X size={20} /></button>
        </div>
        <div className="p-5 space-y-4">
          <p className="text-xs text-white/55">{slot.purpose}</p>
          {envKey ? (
            <p className="text-xs text-white/55">
              Withdrawal signing uses <code className="text-white/70">{envKey}</code> on EVM chains —
              the registered address should match the env treasury signer when that key is set.
            </p>
          ) : (
            <p className="text-xs text-white/55">
              Watch-only treasury address until an on-chain payout signer is configured for this chain.
            </p>
          )}
          <div>
            <label className="text-xs text-white/50 block mb-1">Address</label>
            <input
              className={`${inputClass} w-full font-mono`}
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder={addressPlaceholder(slot)}
            />
          </div>
          <div>
            <label className="text-xs text-white/50 block mb-1">Label</label>
            <input className={`${inputClass} w-full`} value={label} onChange={(e) => setLabel(e.target.value)} />
          </div>
          <label className="flex items-center gap-2 text-sm text-white/80">
            <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
            Enabled
          </label>
          {formErr ? <p className="text-sm text-rose-300">{formErr}</p> : null}
        </div>
        <div className="flex justify-end gap-2 px-5 py-4 border-t border-surface-border">
          <button type="button" className={inputClass} onClick={onClose} disabled={busy}>Cancel</button>
          <button
            type="button"
            onClick={save}
            disabled={busy || !address.trim()}
            className="px-4 py-2 rounded-xl bg-gold text-surface-dark font-semibold text-sm disabled:opacity-50"
          >
            {busy ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

const TYPE_OPTIONS = [
  { value: '', label: 'All types' },
  { value: 'deposit', label: 'Deposit (inbound)' },
  { value: 'signup_bonus', label: 'Signup bonus (outbound)' },
  { value: 'withdrawal', label: 'Withdrawal (outbound)' },
  { value: 'sweep', label: 'Deposit sweep (internal)' },
];

const DEPOSIT_STATUS_OPTIONS = [
  { value: '', label: 'All statuses' },
  { value: 'pending', label: 'Pending' },
  { value: 'confirming', label: 'Confirming' },
  { value: 'pending_kyc', label: 'Pending KYC' },
  { value: 'crediting', label: 'Crediting' },
  { value: 'credited', label: 'Credited' },
  { value: 'below_min', label: 'Below minimum' },
  { value: 'orphan', label: 'Orphan' },
  { value: 'reorg_review', label: 'Reorg review' },
];

const SIGNUP_BONUS_STATUS_OPTIONS = [
  { value: '', label: 'All statuses' },
  { value: 'pending', label: 'Pending' },
  { value: 'confirming', label: 'Confirming' },
  { value: 'pending_kyc', label: 'Pending KYC' },
  { value: 'crediting', label: 'Crediting' },
  { value: 'credited', label: 'Credited' },
  { value: 'below_min', label: 'Below minimum' },
  { value: 'orphan', label: 'Orphan' },
];

const WITHDRAWAL_STATUS_OPTIONS = [
  { value: '', label: 'All statuses' },
  { value: 'pending_approval', label: 'Pending approval' },
  { value: 'on_hold', label: 'On hold' },
  { value: 'awaiting_treasury', label: 'Awaiting treasury' },
  { value: 'approved', label: 'Approved' },
  { value: 'broadcasting', label: 'Broadcasting' },
  { value: 'broadcasted', label: 'Broadcasted' },
  { value: 'confirmed', label: 'Confirmed' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'failed', label: 'Failed' },
];

const ALL_STATUS_OPTIONS = [
  { value: '', label: 'All statuses' },
  ...DEPOSIT_STATUS_OPTIONS.filter((o) => o.value).map((o) => ({
    ...o,
    label: `Deposit · ${o.label}`,
  })),
  ...SIGNUP_BONUS_STATUS_OPTIONS.filter((o) => o.value).map((o) => ({
    ...o,
    label: `Bonus · ${o.label}`,
  })),
  ...WITHDRAWAL_STATUS_OPTIONS.filter((o) => o.value).map((o) => ({
    ...o,
    label: `Withdrawal · ${o.label}`,
  })),
];

function txTypeLabel(type) {
  if (type === 'deposit') return 'Deposit';
  if (type === 'signup_bonus') return 'Signup bonus';
  if (type === 'sweep') return 'Sweep';
  return 'Withdrawal';
}

function txTypeTone(type) {
  if (type === 'deposit') return 'success';
  if (type === 'signup_bonus') return 'info';
  if (type === 'sweep') return 'violet';
  return 'warning';
}

function statusOptionsForType(typeFilter) {
  if (typeFilter === 'deposit') return DEPOSIT_STATUS_OPTIONS;
  if (typeFilter === 'signup_bonus') return SIGNUP_BONUS_STATUS_OPTIONS;
  if (typeFilter === 'withdrawal') return WITHDRAWAL_STATUS_OPTIONS;
  return ALL_STATUS_OPTIONS;
}

export default function AdminWalletPage() {
  const { admin } = useAdminAuth();
  const canManage = hasPermission(admin, 'manage_treasury');

  const [overview, setOverview] = useState(() => readOverviewCache());
  const [txItems, setTxItems] = useState(() => {
    const hit = readTxCache({ skip: '0', limit: '25' });
    return Array.isArray(hit?.items) ? hit.items : [];
  });
  const [txTotal, setTxTotal] = useState(() => {
    const hit = readTxCache({ skip: '0', limit: '25' });
    return Number(hit?.total) || 0;
  });
  const [loading, setLoading] = useState(() => !readOverviewCache());
  const [txLoading, setTxLoading] = useState(() => !readTxCache({ skip: '0', limit: '25' }));
  const [err, setErr] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  const [typeFilter, setTypeFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [uidFilter, setUidFilter] = useState('');
  const [txFilter, setTxFilter] = useState('');
  const [search, setSearch] = useState('');
  const [skip, setSkip] = useState(0);
  const [limit, setLimit] = useState(25);
  const [editSlot, setEditSlot] = useState(null);

  const buildTxParams = useCallback(() => {
    const params = { skip: String(skip), limit: String(limit) };
    if (typeFilter) params.type = typeFilter;
    if (statusFilter.trim()) params.status = statusFilter.trim();
    if (uidFilter.trim()) params.uid = uidFilter.trim();
    if (txFilter.trim()) params.tx_hash = txFilter.trim();
    if (search.trim()) params.search = search.trim();
    return params;
  }, [skip, limit, typeFilter, statusFilter, uidFilter, txFilter, search]);

  const loadOverview = useCallback(async ({ force = false } = {}) => {
    if (!force) {
      const cached = readOverviewCache();
      if (cached) {
        setOverview(cached);
        setLoading(false);
        return;
      }
    }
    setRefreshing(true);
    setErr('');
    try {
      const r = await api.adminWallet();
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j?.detail || 'Failed to load admin wallet');
      setOverview(j);
      writeOverviewCache(j);
    } catch (e) {
      setErr(String(e?.message || e));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  const loadTx = useCallback(async ({ force = false } = {}) => {
    const params = buildTxParams();
    if (!force) {
      const cached = readTxCache(params);
      if (cached) {
        setTxItems(Array.isArray(cached.items) ? cached.items : []);
        setTxTotal(Number(cached.total) || 0);
        setTxLoading(false);
        return;
      }
    }
    setTxLoading(true);
    try {
      const r = await api.adminWalletTransactions(params);
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j?.detail || 'Failed to load transactions');
      const items = Array.isArray(j.items) ? j.items : [];
      const total = Number(j.total) || 0;
      setTxItems(items);
      setTxTotal(total);
      writeTxCache(params, { items, total });
    } catch (e) {
      setErr(String(e?.message || e));
      setTxItems([]);
      setTxTotal(0);
    } finally {
      setTxLoading(false);
    }
  }, [buildTxParams]);

  const handleRefresh = useCallback(() => {
    loadOverview({ force: true });
    loadTx({ force: true });
  }, [loadOverview, loadTx]);

  useEffect(() => { loadOverview(); }, [loadOverview]);
  useEffect(() => { loadTx(); }, [loadTx]);

  const statusOptions = statusOptionsForType(typeFilter);

  useEffect(() => {
    if (!statusFilter) return;
    const allowed = new Set(statusOptionsForType(typeFilter).map((o) => o.value));
    if (!allowed.has(statusFilter)) setStatusFilter('');
  }, [typeFilter, statusFilter]);

  const kpis = overview?.kpis || {};
  const treasuryRows = overview?.treasury_rows || overview?.wallet_cards || [];
  const chainCards = overview?.chain_cards?.length
    ? overview.chain_cards
    : (() => {
      const byNet = {};
      treasuryRows.forEach((row) => {
        const net = row.network || '';
        if (!byNet[net]) {
          byNet[net] = {
            network: net,
            network_label: row.network_label || net,
            rpc: row.rpc || {},
            deposit: null,
            withdrawal: null,
          };
        }
        if (row.address_kind === 'deposit') byNet[net].deposit = row;
        if (row.address_kind === 'withdrawal') {
          byNet[net].withdrawal = row;
          byNet[net].rpc = row.rpc || byNet[net].rpc;
        }
      });
      return Object.values(byNet);
    })();
  const onchainCards = (overview?.onchain_cards?.length
    ? overview.onchain_cards
    : chainCards
      .map((c) => c.withdrawal)
      .filter(Boolean)
      .map((r) => ({
        id: `${r.network}|withdrawal`,
        network: r.network,
        network_label: r.network_label || r.network,
        hint: r.covers_hint || r.purpose || '',
        address: r.address,
        signer_configured: r.signer_configured,
        balance_parts: r.balance_parts || [],
      }))
  ).map((card) => {
    const isTron = (card.network || '').toLowerCase().includes('tron');
    if (isTron && (card.address || '').startsWith('0x')) {
      return { ...card, address: null, signer_configured: false };
    }
    if (isTron) return { ...card, signer_configured: false };
    return card;
  });
  const custody = overview?.custody;
  const signupBonusCold = overview?.addresses?.signup_bonus_cold;
  const iboContract = overview?.addresses?.ibo_contract;

  const depHint = assetHint(kpis.deposits_by_asset);
  const wdHint = assetHint(kpis.withdrawals_by_asset);

  const pageCount = Math.max(1, Math.ceil(txTotal / limit));
  const page = Math.floor(skip / limit) + 1;

  return (
    <div className="space-y-6 pb-10">
      <AdminPageHeader
        icon={Wallet}
        iconClassName="text-violet-300"
        title="Admin wallet"
        subtitle="Treasury deposit & withdrawal addresses on BEP-20, ERC-20, and TRC-20 — flow KPIs and on-chain balances."
        badge="Treasury ops"
        actionsWithBadge
        actions={(
          <button
            type="button"
            onClick={handleRefresh}
            disabled={refreshing}
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl border border-surface-border text-sm text-white/80 hover:border-gold/40 transition-colors disabled:opacity-50"
          >
            <RefreshCw size={15} className={refreshing ? 'animate-spin' : ''} />
            Refresh
          </button>
        )}
      />

      {err && (
        <div className="rounded-xl border border-rose-500/35 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
          {err}
        </div>
      )}

      <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <GradientStatCard
          label="Deposits"
          value={loading ? '…' : String(kpis.deposits_count ?? 0)}
          hint={loading ? '' : (depHint || `${fmtNum(kpis.deposits_volume)} total units credited`)}
          tone="emerald"
        />
        <GradientStatCard
          label="Withdrawals"
          value={loading ? '…' : String(kpis.withdrawals_count ?? 0)}
          hint={loading ? '' : (wdHint || `${fmtNum(kpis.withdrawals_volume)} total units paid out`)}
          tone="amber"
        />
        <GradientStatCard
          label="Fees collected"
          value={loading ? '…' : `${fmtNum(kpis.fees_ibo_total)} IBO`}
          hint={loading ? '' : `${kpis.fees_withdrawal_count ?? 0} confirmed withdrawals`}
          tone="violet"
        />
        <GradientStatCard
          label="Pending"
          value={loading ? '…' : String(kpis.pending_total ?? 0)}
          hint={loading ? '' : `${kpis.pending_deposits ?? 0} deposits · ${kpis.pending_withdrawals ?? 0} withdrawals`}
          tone="cyan"
        />
      </div>

      <AdminPanel
        title="Deposit & withdrawal addresses"
        subtitle="User deposits = unique HD address per user (not listed here). Withdrawal = platform treasury hot wallet (TREASURY_ETH_PRIVATE_KEY on EVM)."
        right={(
          <Link to="/treasury-omnibus" className="text-sm text-gold-light hover:underline inline-flex items-center gap-1">
            Omnibus registry <ArrowUpRight size={14} />
          </Link>
        )}
      >
        <TreasuryRailsTable
          cards={chainCards}
          canManage={canManage}
          onEdit={setEditSlot}
          loading={loading}
        />
        {!loading ? (
          <>
            {iboContract ? (
              <p className="mt-5 pt-4 border-t border-surface-border/60 text-xs text-white/45 leading-relaxed">
                <span className="text-white/60">IBO token contract</span> (not a wallet):{' '}
                <span className="font-mono text-white/65">{trimAddr(iboContract)}</span>
                {' '}
                <CopyButton text={iboContract} />
              </p>
            ) : null}
            <p className="mt-3 text-xs text-white/35 leading-relaxed">
              Signup bonuses use a separate cold wallet (
              {signupBonusCold ? (
                <span className="font-mono text-white/50">{trimAddr(signupBonusCold)}</span>
              ) : (
                'not configured — set TREASURY_COLD_PRIVATE_KEY'
              )}
              ). Configure via Omnibus → IBO cold.
            </p>
          </>
        ) : null}
      </AdminPanel>

      <AdminPanel
        title="On-chain treasury"
        subtitle="Withdrawal hot wallet balances from RPC — not the same as ledger custody (user deposits sit on HD addresses until sweep)."
      >
        <OnchainTreasuryCards cards={onchainCards} custody={custody} loading={loading} />
      </AdminPanel>

      <EditAddressModal
        open={!!editSlot}
        slot={editSlot}
        onClose={() => setEditSlot(null)}
        onSaved={(j) => {
          setOverview(j);
          writeOverviewCache(j);
        }}
      />

      <AdminPanel
        title="Transactions"
        subtitle="On-chain treasury movements — inbound user deposits, outbound payouts, and HD→hot sweeps."
        right={(
          <Link to="/deposit-events" className="text-sm text-gold-light hover:underline inline-flex items-center gap-1">
            Deposit events <ArrowUpRight size={14} />
          </Link>
        )}
      >
        <FilterBar className="mb-4">
          <div className="grid sm:grid-cols-2 lg:grid-cols-6 gap-3 items-end">
            <div className="flex flex-col gap-1">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-white/45 px-0.5">Type</span>
              <select className={`${selectClass} w-full`} value={typeFilter} onChange={(e) => { setTypeFilter(e.target.value); setSkip(0); }}>
                {TYPE_OPTIONS.map((o) => <option key={o.value || 'all'} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-white/45 px-0.5">Status</span>
              <select className={`${selectClass} w-full`} value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setSkip(0); }}>
                {statusOptions.map((o) => <option key={o.value || 'all'} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-white/45 px-0.5">User ID</span>
              <UserUidSuggestInput
                value={uidFilter}
                onChange={(v) => { setUidFilter(v); setSkip(0); }}
                placeholder="Filter UID"
                containerClassName="w-full"
                className="w-full min-h-[42px] rounded-xl bg-surface-dark border border-surface-border px-3 py-2 text-sm text-white font-mono"
              />
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-white/45 px-0.5">Tx hash</span>
              <SearchField
                mono
                value={txFilter}
                onChange={(e) => { setTxFilter(e.target.value); setSkip(0); }}
                placeholder="0x…"
              />
            </div>
            <div className="flex flex-col gap-1 sm:col-span-2 lg:col-span-2">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-white/45 px-0.5">Search</span>
              <SearchField
                value={search}
                onChange={(e) => { setSearch(e.target.value); setSkip(0); }}
                placeholder="Tx, UID, address…"
              />
            </div>
          </div>
        </FilterBar>

        <div className="-mx-4 sm:-mx-5">
        <AdminDataTable>
          <thead>
            <tr>
              <th>Time</th>
              <th>Type</th>
              <th>Amount</th>
              <th>Status</th>
              <th>User</th>
              <th>From → To</th>
              <th>Tx</th>
            </tr>
          </thead>
          <tbody>
            {txLoading ? (
              <tr><td colSpan={7} className="text-center text-white/45 py-8">Loading…</td></tr>
            ) : txItems.length === 0 ? (
              <tr><td colSpan={7} className="text-center text-white/45 py-8">No transactions match your filters.</td></tr>
            ) : txItems.map((row) => (
              <tr key={`${row.type}-${row.id}`}>
                <td className="text-white/70 text-sm whitespace-nowrap">{fmtTs(row.created_at)}</td>
                <td>
                  <StatusBadge compact tone={txTypeTone(row.type)}>
                    {txTypeLabel(row.type)}
                  </StatusBadge>
                </td>
                <td className="font-mono text-sm">
                  {fmtNum(row.amount)} {row.asset || '—'}
                  {row.network ? (
                    <span className="block text-[10px] text-white/40 font-sans">{row.network}</span>
                  ) : null}
                </td>
                <td>
                  <StatusBadge
                    compact
                    tone={row.status === 'credited' || row.status === 'confirmed' ? 'success' : 'neutral'}
                  >
                    {row.status || '—'}
                  </StatusBadge>
                </td>
                <td>
                  {row.uid ? (
                    <Link to={`/users/${encodeURIComponent(row.uid)}`} className="text-gold-light hover:underline font-mono text-xs">
                      {row.uid}
                    </Link>
                  ) : '—'}
                </td>
                <td className="font-mono text-[11px] text-white/55">
                  {row.direction === 'in' ? (
                    <span title={row.from_address || 'external'}>{trimAddr(row.from_address || 'external')}</span>
                  ) : (
                    <span title={row.from_address}>{trimAddr(row.from_address)}</span>
                  )}
                  {' → '}
                  <span title={row.to_address}>{trimAddr(row.to_address)}</span>
                </td>
                <td className="font-mono text-[11px] text-white/70">
                  {row.tx_hash ? (
                    <a
                      href={row.explorer_url || `https://bscscan.com/tx/${row.tx_hash}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-cyan-300 hover:underline"
                      title={row.tx_hash}
                    >
                      {trimTx(row.tx_hash)}
                    </a>
                  ) : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </AdminDataTable>
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mt-4 pt-4 border-t border-surface-border/60">
          <span className="text-sm text-white/60">{txTotal} total · page {page} of {pageCount}</span>
          <div className="flex flex-wrap items-center gap-2">
            <select className={selectClass} value={limit} onChange={(e) => { setLimit(Number(e.target.value)); setSkip(0); }}>
              {[10, 25, 50, 100].map((n) => <option key={n} value={n}>{n} / page</option>)}
            </select>
            <button type="button" className={inputClass} disabled={skip <= 0} onClick={() => setSkip(Math.max(0, skip - limit))}>Prev</button>
            <button type="button" className={inputClass} disabled={skip + limit >= txTotal} onClick={() => setSkip(skip + limit)}>Next</button>
          </div>
        </div>
      </AdminPanel>
    </div>
  );
}
