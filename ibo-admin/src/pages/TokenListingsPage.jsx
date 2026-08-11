import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '@/lib/api';
import { useAdminAuth } from '@/context/AdminAuthContext';
import { hasPermission } from '@/lib/adminAccess';
import {
  AdminPageHeader,
  AdminPanel,
  AdminDataTable,
  GradientStatCard,
  StatusBadge,
  FilterBar,
} from '@/components/AdminPrimitives';
import {
  CheckCircle, XCircle, RefreshCw, Coins, Clock, ListChecks,
  Globe, Mail, Link2, Plus, Pencil, ChevronLeft, ChevronRight,
  Upload, History, Ban, Star,
} from 'lucide-react';
import IboPlatformTab from '@/pages/listings/IboPlatformTab';

const API_BASE = (import.meta.env.VITE_BACKEND_URL || 'http://localhost:8000').replace(/\/$/, '');

const NETWORKS = [
  'ERC-20 (Ethereum)',
  'BEP-20 (BNB Chain)',
  'TRC-20 (Tron)',
  'Bitcoin Network',
  'Solana',
];

const TOKEN_STATUSES = [
  { value: 'approved', label: 'Approved (live)' },
  { value: 'suspended', label: 'Suspended' },
  { value: 'draft', label: 'Draft' },
  { value: 'rejected', label: 'Rejected' },
];

const LIMIT_OPTIONS = [10, 25, 50, 100];

const inputCls =
  'w-full rounded-xl bg-surface-dark border border-surface-border px-3 py-2.5 text-sm text-white placeholder:text-white/35 focus:border-gold/40 outline-none';

function mediaUrl(rel) {
  if (!rel || typeof rel !== 'string') return null;
  if (rel.startsWith('http')) return rel;
  return `${API_BASE}${rel.startsWith('/') ? '' : '/'}${rel}`;
}

function statusTone(s) {
  if (s === 'approved') return 'success';
  if (s === 'rejected') return 'danger';
  if (s === 'pending') return 'warning';
  if (s === 'suspended') return 'warning';
  return 'neutral';
}

function fmtDate(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function TogglePill({ on, onClick, label, disabled }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-bold transition-colors disabled:opacity-40 ${
        on
          ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-200'
          : 'border-surface-border bg-white/5 text-white/50 hover:text-white/80'
      }`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${on ? 'bg-emerald-400' : 'bg-white/30'}`} />
      {label}
    </button>
  );
}

function PaginationBar({ skip, limit, total, onSkip, onLimit }) {
  const pages = Math.max(1, Math.ceil(total / limit));
  const page = Math.floor(skip / limit) + 1;
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 pt-4 border-t border-surface-border/60">
      <p className="text-sm text-white/50">
        {total === 0
          ? 'No rows'
          : `Showing ${skip + 1}–${Math.min(skip + limit, total)} of ${total} · page ${page} / ${pages}`}
      </p>
      <div className="flex items-center gap-2 flex-wrap">
        <select
          value={String(limit)}
          onChange={(e) => {
            onLimit(Number(e.target.value));
            onSkip(0);
          }}
          className="rounded-xl bg-surface-dark border border-surface-border px-3 py-2 text-white text-sm font-semibold"
        >
          {LIMIT_OPTIONS.map((n) => (
            <option key={n} value={n}>{n} / page</option>
          ))}
        </select>
        <button
          type="button"
          disabled={skip <= 0}
          onClick={() => onSkip(Math.max(0, skip - limit))}
          className="flex items-center gap-1 px-3 py-2 rounded-xl border border-surface-border text-sm font-bold disabled:opacity-40"
        >
          <ChevronLeft size={16} /> Prev
        </button>
        <button
          type="button"
          disabled={skip + limit >= total}
          onClick={() => onSkip(skip + limit)}
          className="flex items-center gap-1 px-3 py-2 rounded-xl border border-surface-border text-sm font-bold disabled:opacity-40"
        >
          Next <ChevronRight size={16} />
        </button>
      </div>
    </div>
  );
}

function DetailRow({ label, children, mono }) {
  return (
    <div className="py-2.5 border-b border-surface-border/50 last:border-0">
      <p className="text-[11px] font-bold uppercase tracking-wider text-white/45 mb-1">{label}</p>
      <div className={`text-sm text-white/90 break-all ${mono ? 'font-mono text-xs' : ''}`}>{children}</div>
    </div>
  );
}

function RequestDetailPanel({ req, review, setReview, onApprove, onReject, canManage, readOnly }) {
  if (!req) {
    return (
      <section className="admin-section flex flex-1 items-center justify-center p-8 min-h-[280px]">
        <p className="text-white/45 text-sm text-center max-w-xs">Select a row to view application details.</p>
      </section>
    );
  }

  const pending = req.status === 'pending';

  return (
    <section className="admin-section flex flex-col min-h-0 flex-1 overflow-hidden">
      <div className="px-4 sm:px-5 py-4 border-b border-surface-border bg-white/[0.02] shrink-0">
        <div className="flex items-start gap-4">
          {req.logo_url ? (
            <img src={mediaUrl(req.logo_url)} alt="" className="w-14 h-14 rounded-2xl object-cover border border-surface-border shrink-0" />
          ) : (
            <div className="w-14 h-14 rounded-2xl bg-gold/15 border border-gold/30 flex items-center justify-center shrink-0">
              <Coins size={24} className="text-gold-light" />
            </div>
          )}
          <div className="min-w-0 flex-1">
            <h2 className="text-xl font-extrabold text-white truncate">{req.project_name}</h2>
            <p className="text-gold-light font-mono font-bold">{req.token_symbol}</p>
            <div className="flex flex-wrap gap-2 mt-1">
              <StatusBadge tone={statusTone(req.status)}>{req.status}</StatusBadge>
              <span className="text-xs text-white/45">{fmtDate(req.created_at)}</span>
            </div>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto overscroll-contain px-4 sm:px-5 py-3 scrollbar-thin min-h-0 max-h-[min(58vh,640px)]">
        <p className="text-sm text-white/75 leading-relaxed mb-4">{req.description || '—'}</p>
        <DetailRow label="Blockchain">{req.blockchain_network}</DetailRow>
        <DetailRow label="Contract" mono>{req.contract_address}</DetailRow>
        <DetailRow label="Contact">
          <span className="inline-flex items-center gap-1.5">
            <Mail size={13} className="opacity-60" />
            {req.contact_email}
          </span>
        </DetailRow>
        {req.dex_swap_link ? (
          <DetailRow label="DEX">
            <a href={req.dex_swap_link} target="_blank" rel="noopener noreferrer" className="text-cyan-300 hover:underline inline-flex items-center gap-1">
              <Link2 size={13} /> View swap
            </a>
          </DetailRow>
        ) : null}
        {req.official_website ? (
          <DetailRow label="Website">
            <a href={req.official_website} target="_blank" rel="noopener noreferrer" className="text-cyan-300 hover:underline inline-flex items-center gap-1">
              <Globe size={13} /> {req.official_website}
            </a>
          </DetailRow>
        ) : null}
        {req.admin_notes ? <DetailRow label="Admin notes">{req.admin_notes}</DetailRow> : null}
        {req.reviewed_at ? <DetailRow label="Reviewed">{fmtDate(req.reviewed_at)}</DetailRow> : null}

        {pending && canManage && !readOnly ? (
          <div className="mt-5 space-y-4">
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-white/50 mb-2">Admin notes</label>
              <textarea
                className={`${inputCls} min-h-[80px]`}
                rows={3}
                value={review.admin_notes}
                onChange={(e) => setReview((v) => ({ ...v, admin_notes: e.target.value }))}
                placeholder="Optional internal note…"
              />
            </div>
            <FilterBar className="!p-3">
              <p className="text-xs font-bold uppercase tracking-wider text-white/50 mb-3">Enable on approval</p>
              <div className="flex flex-wrap gap-2">
                <TogglePill label="Deposits" on={review.deposit_enabled} onClick={() => setReview((v) => ({ ...v, deposit_enabled: !v.deposit_enabled }))} />
                <TogglePill label="Withdrawals" on={review.withdraw_enabled} onClick={() => setReview((v) => ({ ...v, withdraw_enabled: !v.withdraw_enabled }))} />
                <TogglePill label="Trading" on={review.trading_enabled} onClick={() => setReview((v) => ({ ...v, trading_enabled: !v.trading_enabled }))} />
              </div>
            </FilterBar>
          </div>
        ) : null}
      </div>

      {pending && canManage && !readOnly ? (
        <div className="shrink-0 px-4 sm:px-5 py-4 border-t border-surface-border flex flex-wrap gap-3 bg-surface-dark/50">
          <button
            type="button"
            onClick={onApprove}
            className="inline-flex flex-1 min-w-[120px] items-center justify-center gap-2 px-4 py-2.5 rounded-xl font-bold text-sm bg-gradient-to-r from-emerald-600 to-emerald-500 text-white hover:opacity-90"
          >
            <CheckCircle size={16} /> Approve
          </button>
          <button
            type="button"
            onClick={onReject}
            className="inline-flex flex-1 min-w-[120px] items-center justify-center gap-2 px-4 py-2.5 rounded-xl font-bold text-sm border border-rose-500/40 bg-rose-500/10 text-rose-200 hover:bg-rose-500/20"
          >
            <XCircle size={16} /> Reject
          </button>
        </div>
      ) : null}
    </section>
  );
}

function TokenEditModal({ open, token, canManage, onClose, onSaved, onError }) {
  const [form, setForm] = useState(null);
  const [logoFile, setLogoFile] = useState(null);
  const [logoPreview, setLogoPreview] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open || !token) return;
    setLogoFile(null);
    setLogoPreview(null);
    setForm({
      project_name: token.project_name || '',
      token_name: token.token_name || '',
      token_symbol: token.token_symbol || '',
      blockchain_network: token.blockchain_network || NETWORKS[1],
      contract_address: token.contract_address || '',
      dex_swap_link: token.dex_swap_link || '',
      official_website: token.official_website || '',
      contact_email: token.contact_email || '',
      description: token.description || '',
      quote_asset: token.quote_asset || 'USDT',
      status: token.status || 'approved',
      deposit_enabled: !!token.deposit_enabled,
      withdraw_enabled: !!token.withdraw_enabled,
      trading_enabled: !!token.trading_enabled,
      admin_notes: token.admin_notes || '',
    });
  }, [open, token?.id]);

  useEffect(() => {
    if (!logoFile) {
      setLogoPreview(null);
      return undefined;
    }
    const url = URL.createObjectURL(logoFile);
    setLogoPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [logoFile]);

  if (!open || !token || !form) return null;

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const displayLogo = logoPreview || mediaUrl(token.logo_url);

  const save = async () => {
    if (!canManage) return;
    setBusy(true);
    onError('');
    try {
      let res;
      if (logoFile) {
        const fd = new FormData();
        Object.entries(form).forEach(([k, v]) => fd.append(k, String(v)));
        fd.append('logo', logoFile);
        res = await api.listings.patchTokenDirect(token.id, fd);
      } else {
        res = await api.listings.patchToken(token.id, form);
      }
      const data = await res.json();
      if (!res.ok) {
        const detail = data.detail;
        const msg = typeof detail === 'string'
          ? detail
          : Array.isArray(detail)
            ? detail.map((d) => d.msg || d).join(', ')
            : 'Update failed';
        throw new Error(msg);
      }
      onSaved(data.token);
      onClose();
    } catch (e) {
      onError(e.message || 'Update failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[120] bg-black/75 backdrop-blur-md flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="w-full max-w-2xl max-h-[min(90dvh,800px)] overflow-y-auto rounded-3xl border border-surface-border bg-surface-card p-5 sm:p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-xl font-black text-white mb-1 flex items-center gap-2">
          <Pencil size={20} className="text-gold-light" />
          Edit {token.token_symbol}
        </h3>
        <p className="text-sm text-white/55 mb-5 font-mono">{token.spot_symbol || `${token.token_symbol}USDT`}</p>

        <div className="flex items-center gap-4 mb-5 p-4 rounded-2xl border border-surface-border bg-white/[0.02]">
          {displayLogo ? (
            <img src={displayLogo} alt="" className="w-16 h-16 rounded-2xl object-cover border border-surface-border shrink-0" />
          ) : (
            <div className="w-16 h-16 rounded-2xl bg-gold/15 border border-gold/30 flex items-center justify-center shrink-0">
              <Coins size={28} className="text-gold-light" />
            </div>
          )}
          <div className="min-w-0 flex-1">
            <p className="text-xs font-bold uppercase tracking-wider text-white/50 mb-2">Token logo</p>
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              disabled={!canManage}
              onChange={(e) => setLogoFile(e.target.files?.[0] || null)}
              className="text-sm text-white/70 w-full"
            />
            <p className="text-[11px] text-white/45 mt-1.5">PNG, JPEG, or WebP · max 2 MB. Leave empty to keep current logo.</p>
            {logoFile ? (
              <button
                type="button"
                onClick={() => setLogoFile(null)}
                className="mt-2 text-xs font-bold text-rose-300/90 hover:text-rose-200"
              >
                Clear new logo
              </button>
            ) : null}
          </div>
        </div>

        <div className="grid sm:grid-cols-2 gap-4">
          <label className="block space-y-1.5 sm:col-span-2">
            <span className="text-xs font-bold uppercase text-white/50">Project name</span>
            <input className={inputCls} value={form.project_name} onChange={(e) => set('project_name', e.target.value)} />
          </label>
          <label className="block space-y-1.5">
            <span className="text-xs font-bold uppercase text-white/50">Token name</span>
            <input className={inputCls} value={form.token_name} onChange={(e) => set('token_name', e.target.value)} />
          </label>
          <label className="block space-y-1.5">
            <span className="text-xs font-bold uppercase text-white/50">Symbol</span>
            <input className={inputCls} value={form.token_symbol} onChange={(e) => set('token_symbol', e.target.value.toUpperCase())} disabled={token.is_platform_default} />
          </label>
          <label className="block space-y-1.5">
            <span className="text-xs font-bold uppercase text-white/50">Network</span>
            <select className={inputCls} value={form.blockchain_network} onChange={(e) => set('blockchain_network', e.target.value)} disabled={token.is_platform_default}>
              {NETWORKS.map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
          <label className="block space-y-1.5">
            <span className="text-xs font-bold uppercase text-white/50">Status</span>
            <select className={inputCls} value={form.status} onChange={(e) => set('status', e.target.value)} disabled={token.is_platform_default}>
              {TOKEN_STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </label>
          <label className="block space-y-1.5 sm:col-span-2">
            <span className="text-xs font-bold uppercase text-white/50">Contract</span>
            <input className={`${inputCls} font-mono`} value={form.contract_address} onChange={(e) => set('contract_address', e.target.value)} disabled={token.is_platform_default} />
          </label>
          <label className="block space-y-1.5 sm:col-span-2">
            <span className="text-xs font-bold uppercase text-white/50">Description</span>
            <textarea className={inputCls} rows={3} value={form.description} onChange={(e) => set('description', e.target.value)} />
          </label>
        </div>

        <div className="flex flex-wrap gap-2 mt-5">
          <TogglePill label="Deposits" on={form.deposit_enabled} onClick={() => set('deposit_enabled', !form.deposit_enabled)} disabled={!canManage} />
          <TogglePill label="Withdrawals" on={form.withdraw_enabled} onClick={() => set('withdraw_enabled', !form.withdraw_enabled)} disabled={!canManage} />
          <TogglePill label="Trading" on={form.trading_enabled} onClick={() => set('trading_enabled', !form.trading_enabled)} disabled={!canManage} />
        </div>

        <div className="flex gap-3 mt-6">
          <button type="button" onClick={onClose} className="flex-1 py-2.5 rounded-xl border border-surface-border text-sm font-bold">Cancel</button>
          <button
            type="button"
            disabled={busy || !canManage}
            onClick={save}
            className="flex-1 py-2.5 rounded-xl bg-gradient-to-r from-gold/80 to-gold text-[#0a0b0d] text-sm font-extrabold disabled:opacity-50"
          >
            {busy ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </div>
    </div>
  );
}

const ADD_INITIAL = {
  project_name: '',
  token_name: '',
  token_symbol: '',
  blockchain_network: 'BEP-20 (BNB Chain)',
  contract_address: '',
  dex_swap_link: '',
  official_website: '',
  contact_email: '',
  description: '',
  quote_asset: 'USDT',
  deposit_enabled: false,
  withdraw_enabled: false,
  trading_enabled: true,
};

export default function TokenListingsPage() {
  const { admin } = useAdminAuth();
  const canManage = hasPermission(admin, 'manage_listings');

  const [tab, setTab] = useState('ibo');
  const [stats, setStats] = useState(null);
  const [error, setError] = useState('');
  const [okMsg, setOkMsg] = useState('');

  const [pendingItems, setPendingItems] = useState([]);
  const [pendingTotal, setPendingTotal] = useState(0);
  const [pendingSkip, setPendingSkip] = useState(0);
  const [pendingLimit, setPendingLimit] = useState(25);
  const [pendingLoading, setPendingLoading] = useState(false);
  const [selectedPending, setSelectedPending] = useState(null);
  const [review, setReview] = useState({
    admin_notes: '',
    deposit_enabled: true,
    withdraw_enabled: false,
    trading_enabled: true,
  });

  const [historyItems, setHistoryItems] = useState([]);
  const [historyTotal, setHistoryTotal] = useState(0);
  const [historySkip, setHistorySkip] = useState(0);
  const [historyLimit, setHistoryLimit] = useState(25);
  const [historyStatus, setHistoryStatus] = useState('approved');
  const [historyLoading, setHistoryLoading] = useState(false);
  const [selectedHistory, setSelectedHistory] = useState(null);

  const [tokenItems, setTokenItems] = useState([]);
  const [tokenTotal, setTokenTotal] = useState(0);
  const [tokenSkip, setTokenSkip] = useState(0);
  const [tokenLimit, setTokenLimit] = useState(25);
  const [tokenStatus, setTokenStatus] = useState('');
  const [tokenLoading, setTokenLoading] = useState(false);
  const [editToken, setEditToken] = useState(null);

  const [addForm, setAddForm] = useState(ADD_INITIAL);
  const [addLogo, setAddLogo] = useState(null);
  const [addBusy, setAddBusy] = useState(false);

  const loadStats = useCallback(async () => {
    try {
      const res = await api.listings.stats();
      const data = await res.json();
      if (res.ok) setStats(data);
    } catch {
      /* non-blocking */
    }
  }, []);

  const loadPending = useCallback(async () => {
    setPendingLoading(true);
    setError('');
    try {
      const res = await api.listings.listRequests({
        status: 'pending',
        skip: String(pendingSkip),
        limit: String(pendingLimit),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Failed to load pending requests');
      const items = data.items || [];
      setPendingItems(items);
      setPendingTotal(data.total ?? 0);
      setSelectedPending((prev) => {
        if (!items.length) return null;
        if (prev && items.some((r) => r.id === prev.id)) return items.find((r) => r.id === prev.id);
        return items[0];
      });
    } catch (e) {
      setError(e.message || 'Load failed');
      setPendingItems([]);
      setPendingTotal(0);
    } finally {
      setPendingLoading(false);
    }
  }, [pendingSkip, pendingLimit]);

  const loadHistory = useCallback(async () => {
    setHistoryLoading(true);
    setError('');
    try {
      const params = { skip: String(historySkip), limit: String(historyLimit) };
      if (historyStatus) {
        params.status = historyStatus;
      } else {
        params.exclude_status = 'pending';
      }
      const res = await api.listings.listRequests(params);
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Failed to load request history');
      const items = data.items || [];
      setHistoryItems(items);
      setHistoryTotal(data.total ?? 0);
      setSelectedHistory((prev) => {
        if (!items.length) return null;
        if (prev && items.some((r) => r.id === prev.id)) return items.find((r) => r.id === prev.id);
        return items[0];
      });
    } catch (e) {
      setError(e.message || 'Load failed');
      setHistoryItems([]);
      setHistoryTotal(0);
    } finally {
      setHistoryLoading(false);
    }
  }, [historySkip, historyLimit, historyStatus]);

  const loadTokens = useCallback(async () => {
    setTokenLoading(true);
    setError('');
    try {
      const params = { skip: String(tokenSkip), limit: String(tokenLimit) };
      if (tokenStatus) params.status = tokenStatus;
      const res = await api.listings.listTokens(params);
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Failed to load tokens');
      setTokenItems(data.items || []);
      setTokenTotal(data.total ?? 0);
    } catch (e) {
      setError(e.message || 'Load failed');
      setTokenItems([]);
      setTokenTotal(0);
    } finally {
      setTokenLoading(false);
    }
  }, [tokenSkip, tokenLimit, tokenStatus]);

  useEffect(() => {
    loadStats();
  }, [loadStats]);

  useEffect(() => {
    if (tab === 'pending') loadPending();
  }, [tab, loadPending]);

  useEffect(() => {
    if (tab === 'history') loadHistory();
  }, [tab, loadHistory]);

  useEffect(() => {
    if (tab === 'tokens') loadTokens();
  }, [tab, loadTokens]);

  useEffect(() => {
    if (selectedPending) {
      setReview({
        admin_notes: '',
        deposit_enabled: true,
        withdraw_enabled: false,
        trading_enabled: true,
      });
    }
  }, [selectedPending?.id]);

  const refreshAll = async () => {
    await loadStats();
    if (tab === 'pending') await loadPending();
    else if (tab === 'history') await loadHistory();
    else if (tab === 'tokens') await loadTokens();
  };

  const submitReview = async (status) => {
    if (!selectedPending || !canManage) return;
    setError('');
    try {
      const res = await api.listings.reviewRequest(selectedPending.id, { ...review, status });
      const data = await res.json();
      if (!res.ok) {
        const detail = data.detail;
        const msg = typeof detail === 'string'
          ? detail
          : Array.isArray(detail)
            ? detail.map((d) => d.msg || d).join(', ')
            : 'Review failed';
        throw new Error(msg);
      }
      setOkMsg(status === 'approved' ? 'Application approved and token listed.' : 'Application rejected.');
      await loadStats();
      await loadPending();
      if (tab === 'history') await loadHistory();
      if (tab === 'tokens') await loadTokens();
    } catch (e) {
      setError(e.message || 'Review failed');
    }
  };

  const toggleToken = async (tok, field) => {
    if (!canManage) return;
    setError('');
    try {
      const res = await api.listings.patchToken(tok.id, { [field]: !tok[field] });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Update failed');
      await loadTokens();
      await loadStats();
    } catch (e) {
      setError(e.message || 'Update failed');
    }
  };

  const suspendToken = async (tok) => {
    if (!canManage || tok.is_platform_default) return;
    setError('');
    try {
      const res = await api.listings.patchToken(tok.id, { status: 'suspended', trading_enabled: false, deposit_enabled: false });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Suspend failed');
      setOkMsg(`${tok.token_symbol} suspended.`);
      await loadTokens();
      await loadStats();
    } catch (e) {
      setError(e.message || 'Suspend failed');
    }
  };

  const submitAddToken = async (e) => {
    e.preventDefault();
    if (!canManage) return;
    setAddBusy(true);
    setError('');
    setOkMsg('');
    try {
      const desc = (addForm.description || '').trim();
      const payload = {
        ...addForm,
        token_symbol: addForm.token_symbol.trim().toUpperCase(),
        description: desc.length >= 20 ? desc : 'Admin-created listing on Delta Exchange.',
        dex_swap_link: addForm.dex_swap_link.trim() || 'https://ibo.io',
        official_website: addForm.official_website.trim() || 'https://ibo.io',
        contact_email: addForm.contact_email.trim() || 'admin@ibo.local',
      };
      const fd = new FormData();
      Object.entries(payload).forEach(([k, v]) => fd.append(k, String(v)));
      if (addLogo) fd.append('logo', addLogo);
      const res = await api.listings.createTokenDirect(fd);
      const data = await res.json();
      if (!res.ok) {
        const detail = data.detail;
        const msg = typeof detail === 'string'
          ? detail
          : Array.isArray(detail)
            ? detail.map((d) => d.msg || d).join(', ')
            : 'Create failed';
        throw new Error(msg);
      }
      setOkMsg(`Token ${data.token?.token_symbol || ''} created and listed.`);
      setAddForm(ADD_INITIAL);
      setAddLogo(null);
      setTokenSkip(0);
      await loadStats();
      setTab('tokens');
      await loadTokens();
    } catch (err) {
      setError(err.message || 'Create failed');
    } finally {
      setAddBusy(false);
    }
  };

  const kpi = useMemo(() => ({
    pending: stats?.requests_pending ?? '—',
    approvedReq: stats?.requests_approved ?? '—',
    rejected: stats?.requests_rejected ?? '—',
    liveTokens: stats?.tokens_approved ?? '—',
  }), [stats]);

  const switchTab = (next) => {
    setTab(next);
    setError('');
    setOkMsg('');
  };

  const requestsTable = (rows, selected, onSelect, loading) => (
    <>
      {loading ? (
        <p className="text-white/50 text-sm py-8 text-center">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-white/50 text-sm py-8 text-center">No records on this page.</p>
      ) : (
        <AdminDataTable minWidth="640px" className="!border-0 !shadow-none !p-0 max-h-[min(52vh,560px)] overflow-auto">
            <thead>
              <tr>
                <th>Symbol</th>
                <th>Project</th>
                <th>Network</th>
                <th>Submitted</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.id}
                  onClick={() => onSelect(r)}
                  className={`cursor-pointer ${selected?.id === r.id ? 'bg-gold/10' : ''}`}
                >
                  <td className="font-mono font-bold text-gold-light">{r.token_symbol}</td>
                  <td className="font-semibold">{r.project_name}</td>
                  <td className="text-white/70 text-sm">{r.blockchain_network}</td>
                  <td className="text-white/55 text-xs">{fmtDate(r.created_at)}</td>
                  <td>
                    <StatusBadge tone={statusTone(r.status)}>{r.status}</StatusBadge>
                  </td>
                </tr>
              ))}
            </tbody>
        </AdminDataTable>
      )}
    </>
  );

  return (
    <div className="admin-page w-full min-w-0 flex flex-col gap-5 pb-6">
      <AdminPageHeader
        icon={Coins}
        iconClassName="text-gold-light"
        title="Token listings"
        subtitle="Review applications, manage listed tokens, and control deposit, withdrawal, and trading."
        actions={(
          <>
            <Link
              to="/market-catalog"
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-surface-border text-sm font-bold text-white/90 hover:border-gold/40"
            >
              <Globe size={15} /> Market catalog
            </Link>
            {canManage ? (
              <button
                type="button"
                onClick={() => switchTab('add')}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-gradient-to-r from-gold/90 to-gold text-[#0a0b0d] text-sm font-extrabold"
              >
                <Plus size={15} /> Add token
              </button>
            ) : null}
            <button
              type="button"
              onClick={refreshAll}
              disabled={pendingLoading || historyLoading || tokenLoading}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-surface-border bg-surface-dark text-sm font-bold text-white/90 hover:border-gold/40"
            >
              <RefreshCw size={15} className={(pendingLoading || historyLoading || tokenLoading) ? 'animate-spin' : ''} />
              Refresh
            </button>
          </>
        )}
      />

      {error ? (
        <div className="rounded-xl border border-rose-500/35 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">{error}</div>
      ) : null}
      {okMsg ? (
        <div className="rounded-xl border border-emerald-500/35 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">{okMsg}</div>
      ) : null}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 w-full">
        <GradientStatCard label="Pending" value={kpi.pending} hint="Awaiting review" tone="amber" />
        <GradientStatCard label="Approved apps" value={kpi.approvedReq} hint="Listing requests" tone="emerald" />
        <GradientStatCard label="Rejected apps" value={kpi.rejected} hint="Closed applications" tone="rose" />
        <GradientStatCard label="Live tokens" value={kpi.liveTokens} hint="Approved in catalog" tone="cyan" />
      </div>

      <div className="w-full adm-table-x scrollbar-thin">
        <div className="admin-tabs w-full min-w-0 flex flex-wrap">
          <button type="button" className={`admin-tab-btn ${tab === 'ibo' ? 'active' : ''}`} onClick={() => switchTab('ibo')}>
            <Star size={14} />
            Your token (Delta)
          </button>
          <button type="button" className={`admin-tab-btn ${tab === 'pending' ? 'active' : ''}`} onClick={() => switchTab('pending')}>
            <Clock size={14} /> Pending
            {stats?.requests_pending > 0 ? (
              <span className="ml-1 rounded-full bg-gold/25 px-1.5 text-[10px]">{stats.requests_pending}</span>
            ) : null}
          </button>
          <button type="button" className={`admin-tab-btn ${tab === 'history' ? 'active' : ''}`} onClick={() => switchTab('history')}>
            <History size={14} /> Request history
          </button>
          <button type="button" className={`admin-tab-btn ${tab === 'tokens' ? 'active' : ''}`} onClick={() => switchTab('tokens')}>
            <ListChecks size={14} /> Listed tokens
            <span className="ml-1 text-[10px] opacity-70">({stats?.tokens_total ?? 0})</span>
          </button>
          {canManage ? (
            <button type="button" className={`admin-tab-btn ${tab === 'add' ? 'active' : ''}`} onClick={() => switchTab('add')}>
              <Plus size={14} /> Add token
            </button>
          ) : null}
        </div>
      </div>

      {tab === 'ibo' ? (
        <IboPlatformTab onError={setError} onOk={setOkMsg} />
      ) : null}

      {tab === 'pending' ? (
        <div className="w-full flex flex-col gap-4 lg:flex-row lg:items-stretch min-h-[min(480px,calc(100dvh-20rem))]">
          <AdminPanel
            className="flex flex-col min-h-0 flex-1 lg:max-w-[58%]"
            title="Pending applications"
            subtitle="Only open submissions. Paginated — select a row to review."
          >
            {requestsTable(pendingItems, selectedPending, setSelectedPending, pendingLoading)}
            <PaginationBar skip={pendingSkip} limit={pendingLimit} total={pendingTotal} onSkip={setPendingSkip} onLimit={setPendingLimit} />
          </AdminPanel>
          <div className="flex flex-col min-h-0 flex-1 lg:max-w-[42%]">
            <RequestDetailPanel
              req={selectedPending}
              review={review}
              setReview={setReview}
              canManage={canManage}
              onApprove={() => submitReview('approved')}
              onReject={() => submitReview('rejected')}
            />
          </div>
        </div>
      ) : null}

      {tab === 'history' ? (
        <div className="w-full flex flex-col gap-4 lg:flex-row lg:items-stretch min-h-[min(480px,calc(100dvh-20rem))]">
          <AdminPanel
            className="flex flex-col min-h-0 flex-1 lg:max-w-[58%]"
            title="Request history"
            subtitle="Reviewed applications (approved or rejected)."
            right={(
              <select
                value={historyStatus}
                onChange={(e) => { setHistoryStatus(e.target.value); setHistorySkip(0); }}
                className="rounded-lg bg-surface-dark border border-surface-border px-3 py-1.5 text-xs text-white font-semibold"
              >
                <option value="approved">Approved</option>
                <option value="rejected">Rejected</option>
                <option value="">All reviewed</option>
              </select>
            )}
          >
            {requestsTable(historyItems, selectedHistory, setSelectedHistory, historyLoading)}
            <PaginationBar skip={historySkip} limit={historyLimit} total={historyTotal} onSkip={setHistorySkip} onLimit={setHistoryLimit} />
          </AdminPanel>
          <div className="flex flex-col min-h-0 flex-1 lg:max-w-[42%]">
            <RequestDetailPanel req={selectedHistory} review={review} setReview={setReview} canManage={false} readOnly />
          </div>
        </div>
      ) : null}

      {tab === 'tokens' ? (
        <AdminPanel
          className="w-full"
          title="Listed tokens"
          subtitle="Deposit, withdrawal, trading, and status per token."
          right={(
            <select
              value={tokenStatus}
              onChange={(e) => { setTokenStatus(e.target.value); setTokenSkip(0); }}
              className="rounded-lg bg-surface-dark border border-surface-border px-3 py-1.5 text-xs text-white font-semibold"
            >
              <option value="">All statuses</option>
              {TOKEN_STATUSES.map((s) => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </select>
          )}
        >
          {tokenLoading ? (
            <p className="text-white/50 text-sm py-10 text-center">Loading tokens…</p>
          ) : tokenItems.length === 0 ? (
            <p className="text-white/50 text-sm py-10 text-center">No tokens match this filter.</p>
          ) : (
            <AdminDataTable className="!border-0 !shadow-none !p-0">
              <thead>
                <tr>
                  <th>Token</th>
                  <th>Pair</th>
                  <th>Network</th>
                  <th>Deposits</th>
                  <th>Withdrawals</th>
                  <th>Trading</th>
                  <th>Status</th>
                  <th className="text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {tokenItems.map((t) => (
                  <tr key={t.id}>
                    <td>
                      <div className="flex items-center gap-3">
                        {t.logo_url ? (
                          <img src={mediaUrl(t.logo_url)} alt="" className="w-8 h-8 rounded-full object-cover border border-surface-border" />
                        ) : (
                          <div className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center text-xs font-bold">{t.token_symbol?.slice(0, 2)}</div>
                        )}
                        <div>
                          <p className="font-bold text-white">{t.token_name || t.token_symbol}</p>
                          <p className="font-mono text-xs text-gold-light/90">{t.token_symbol}</p>
                        </div>
                      </div>
                    </td>
                    <td className="font-mono text-white/80 text-sm">{t.spot_symbol || '—'}</td>
                    <td className="text-white/65 text-sm">{t.blockchain_network}</td>
                    <td>
                      <TogglePill disabled={!canManage} on={t.deposit_enabled} label={t.deposit_enabled ? 'On' : 'Off'} onClick={() => toggleToken(t, 'deposit_enabled')} />
                    </td>
                    <td>
                      <TogglePill disabled={!canManage} on={t.withdraw_enabled} label={t.withdraw_enabled ? 'On' : 'Off'} onClick={() => toggleToken(t, 'withdraw_enabled')} />
                    </td>
                    <td>
                      <TogglePill disabled={!canManage} on={t.trading_enabled} label={t.trading_enabled ? 'On' : 'Off'} onClick={() => toggleToken(t, 'trading_enabled')} />
                    </td>
                    <td>
                      <StatusBadge tone={statusTone(t.status)}>{t.status}</StatusBadge>
                      {t.is_platform_default ? (
                        <span className="block mt-1 text-[10px] text-cyan-300/80">Platform default</span>
                      ) : null}
                    </td>
                    <td>
                      <div className="flex justify-end gap-2 flex-wrap">
                        <button
                          type="button"
                          disabled={!canManage}
                          onClick={() => setEditToken(t)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-surface-border text-xs font-bold hover:border-gold/40 disabled:opacity-40"
                        >
                          <Pencil size={12} /> Edit
                        </button>
                        {canManage && !t.is_platform_default && t.status === 'approved' ? (
                          <button
                            type="button"
                            onClick={() => suspendToken(t)}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-rose-500/30 text-xs font-bold text-rose-200 hover:bg-rose-500/10"
                          >
                            <Ban size={12} /> Suspend
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </AdminDataTable>
          )}
          <PaginationBar skip={tokenSkip} limit={tokenLimit} total={tokenTotal} onSkip={setTokenSkip} onLimit={setTokenLimit} />
        </AdminPanel>
      ) : null}

      {tab === 'add' && canManage ? (
        <AdminPanel title="Add token directly" subtitle="Create an approved listing without a public application. Requires manage_listings.">
          <form onSubmit={submitAddToken} className="grid sm:grid-cols-2 gap-4 max-w-4xl">
            <label className="block space-y-1.5 sm:col-span-2">
              <span className="text-xs font-bold uppercase text-white/50">Project name *</span>
              <input className={inputCls} required value={addForm.project_name} onChange={(e) => setAddForm((f) => ({ ...f, project_name: e.target.value }))} />
            </label>
            <label className="block space-y-1.5">
              <span className="text-xs font-bold uppercase text-white/50">Token name *</span>
              <input className={inputCls} required value={addForm.token_name} onChange={(e) => setAddForm((f) => ({ ...f, token_name: e.target.value }))} />
            </label>
            <label className="block space-y-1.5">
              <span className="text-xs font-bold uppercase text-white/50">Symbol *</span>
              <input className={inputCls} required value={addForm.token_symbol} onChange={(e) => setAddForm((f) => ({ ...f, token_symbol: e.target.value.toUpperCase() }))} />
            </label>
            <label className="block space-y-1.5">
              <span className="text-xs font-bold uppercase text-white/50">Network *</span>
              <select className={inputCls} value={addForm.blockchain_network} onChange={(e) => setAddForm((f) => ({ ...f, blockchain_network: e.target.value }))}>
                {NETWORKS.map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </label>
            <label className="block space-y-1.5 sm:col-span-2">
              <span className="text-xs font-bold uppercase text-white/50">Contract *</span>
              <input className={`${inputCls} font-mono`} required value={addForm.contract_address} onChange={(e) => setAddForm((f) => ({ ...f, contract_address: e.target.value }))} />
            </label>
            <label className="block space-y-1.5">
              <span className="text-xs font-bold uppercase text-white/50">DEX link</span>
              <input className={inputCls} value={addForm.dex_swap_link} onChange={(e) => setAddForm((f) => ({ ...f, dex_swap_link: e.target.value }))} />
            </label>
            <label className="block space-y-1.5">
              <span className="text-xs font-bold uppercase text-white/50">Website</span>
              <input className={inputCls} value={addForm.official_website} onChange={(e) => setAddForm((f) => ({ ...f, official_website: e.target.value }))} />
            </label>
            <label className="block space-y-1.5">
              <span className="text-xs font-bold uppercase text-white/50">Contact email</span>
              <input className={inputCls} type="email" value={addForm.contact_email} onChange={(e) => setAddForm((f) => ({ ...f, contact_email: e.target.value }))} />
            </label>
            <label className="block space-y-1.5 sm:col-span-2">
              <span className="text-xs font-bold uppercase text-white/50">Description</span>
              <textarea className={inputCls} rows={3} value={addForm.description} onChange={(e) => setAddForm((f) => ({ ...f, description: e.target.value }))} />
            </label>
            <label className="block space-y-1.5 sm:col-span-2">
              <span className="text-xs font-bold uppercase text-white/50">Logo (optional)</span>
              <input type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => setAddLogo(e.target.files?.[0] || null)} className="text-sm text-white/70" />
            </label>
            <div className="sm:col-span-2 flex flex-wrap gap-2">
              <TogglePill label="Deposits" on={addForm.deposit_enabled} onClick={() => setAddForm((f) => ({ ...f, deposit_enabled: !f.deposit_enabled }))} />
              <TogglePill label="Withdrawals" on={addForm.withdraw_enabled} onClick={() => setAddForm((f) => ({ ...f, withdraw_enabled: !f.withdraw_enabled }))} />
              <TogglePill label="Trading" on={addForm.trading_enabled} onClick={() => setAddForm((f) => ({ ...f, trading_enabled: !f.trading_enabled }))} />
            </div>
            <div className="sm:col-span-2">
              <button
                type="submit"
                disabled={addBusy}
                className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-gradient-to-r from-gold/90 to-gold text-[#0a0b0d] font-extrabold text-sm disabled:opacity-50"
              >
                <Upload size={16} />
                {addBusy ? 'Creating…' : 'Create listed token'}
              </button>
            </div>
          </form>
        </AdminPanel>
      ) : null}

      <TokenEditModal
        open={!!editToken}
        token={editToken}
        canManage={canManage}
        onClose={() => setEditToken(null)}
        onSaved={() => {
          setOkMsg('Token updated.');
          loadTokens();
          loadStats();
        }}
        onError={setError}
      />
    </div>
  );
}
