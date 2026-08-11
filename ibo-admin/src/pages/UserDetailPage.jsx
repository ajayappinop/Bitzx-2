import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  ArrowLeft, UserCog, Ban, CheckCircle, Wallet, ListOrdered, ArrowRightLeft, Banknote, TrendingUp,
  PauseCircle, PlayCircle, CirclePause, Shield, Clock, XCircle, FileText, ExternalLink, User, RefreshCw,
  Copy, Check, Gift, Users,
} from 'lucide-react';
import { api, getStoredToken, adminWsPath } from '@/lib/api';
import { openBlankExchangeTab, navigateExchangeImpersonation, IMPERSONATE_SESSION_MINUTES } from '@/lib/exchangeUrl';
import { useAdminAuth } from '@/context/AdminAuthContext';
import { useListSort } from '@/lib/useListSort';
import SortableTh from '@/components/SortableTh';
import ConfirmModal from '@/components/ConfirmModal';
import CoinAvatar from '@/components/CoinAvatar';
import InrLedgerRefCell from '@/components/InrLedgerRefCell';
import AdminReferralNetworkTree from '@/components/AdminReferralNetworkTree';
import { AdminDataTable } from '@/components/AdminPrimitives';
import {
  formatInrAmount,
  formatInrActivityDetail,
  formatInrWithdrawalActivityDetail,
  formatWalletTxnRef,
  formatLedgerAmount,
  ledgerTypeLabel,
  ledgerStatusLabel,
  mergeLedgerWithInrDeposits,
  isInrWithdrawalRow,
} from '@/lib/inrDisplay';

const API_BASE = (import.meta.env.VITE_BACKEND_URL || 'http://localhost:8000').replace(/\/$/, '');

function mediaUrl(rel) {
  if (!rel || typeof rel !== 'string') return null;
  if (rel.startsWith('http')) return rel;
  return `${API_BASE}${rel.startsWith('/') ? '' : '/'}${rel}`;
}

function isImagePath(url) {
  if (!url) return false;
  return /\.(jpe?g|png|webp)$/i.test(url);
}

function formatDetailValue(value) {
  if (value == null || value === '') return '—';
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

function DetailRow({ label, value }) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-baseline gap-0.5 sm:gap-3 py-2">
      <span className="text-[11px] font-extrabold text-white/40 uppercase tracking-wider shrink-0 sm:w-36">{label}</span>
      <span className="text-sm text-white font-medium break-all whitespace-pre-wrap">{formatDetailValue(value)}</span>
    </div>
  );
}

function KycDocImage({ label, url }) {
  if (!url) return null;
  const href = mediaUrl(url);
  if (!href) return null;
  return (
    <div className="rounded-xl border border-surface-border bg-surface-dark p-3 max-w-xs">
      <p className="text-[10px] font-bold text-white/45 mb-2">{label}</p>
      {isImagePath(url) ? (
        <a href={href} target="_blank" rel="noreferrer" className="block">
          <img src={href} alt={label} className="max-h-48 rounded-lg object-contain border border-white/10" />
        </a>
      ) : (
        <a href={href} target="_blank" rel="noreferrer" className="text-gold-light text-xs font-bold hover:underline">
          Open file
        </a>
      )}
    </div>
  );
}

const TABS = [
  { id: 'overview', label: 'Overview', icon: User, description: 'Identity snapshot, account summary, and recent user activity.' },
  { id: 'controls', label: 'Controls', icon: UserCog, description: 'Operational account controls, pause toggles, freeze, and security actions.' },
  { id: 'compliance', label: 'Compliance', icon: Shield, description: 'KYC profile, verification documents, and compliance review actions.' },
  { id: 'notes', label: 'Notes', icon: FileText, description: 'Internal admin notes and investigation context.' },
  { id: 'sessions', label: 'Security', icon: Clock, description: 'Session inventory, forced logout, 2FA and account access controls.' },
  { id: 'money', label: 'Payments', icon: Banknote, description: 'Deposits and withdrawals with approval/credit lifecycle.' },
  { id: 'ledger', label: 'Ledger', icon: FileText, description: 'Read-only wallet transaction ledger for audit trail.' },
  { id: 'wallets', label: 'Wallets', icon: Wallet, description: 'Balances, HD deposit addresses, and manual adjustments.' },
  { id: 'analytics', label: 'Risk', icon: TrendingUp, description: 'Risk analytics and behavior indicators.' },
  { id: 'live', label: 'Activity', icon: Clock, description: 'Recent account activity timeline and key events.' },
  { id: 'live_trading', label: 'Live Trading', icon: CirclePause, description: 'Live positions and manual trading actions.' },
  { id: 'orders', label: 'Orders', icon: ListOrdered, description: 'Open/closed orders with sorting and inspection.' },
  { id: 'trades', label: 'Trades', icon: ArrowRightLeft, description: 'Executed trade history and fill details.' },
  { id: 'referral', label: 'Refer & Earn', icon: Gift, description: 'Referral code, sponsor, downstream tree, and Delta earnings.' },
];

export default function UserDetailPage() {
  const { uid } = useParams();
  const { admin } = useAdminAuth();
  const privilegedOps = admin && ['superadmin', 'finance'].includes(String(admin.role || '').toLowerCase());
  const canImpersonate = admin && ['superadmin', 'support'].includes(String(admin.role || '').toLowerCase());
  const canManageCompliance = (() => {
    if (!admin) return false;
    const role = String(admin.role || '').toLowerCase();
    if (role === 'superadmin' || role === 'finance') return true;
    const perms = Array.isArray(admin.permissions)
      ? admin.permissions.map((p) => String(p || '').trim())
      : [];
    return perms.includes('*') || perms.includes('manage_compliance');
  })();
  const [tab, setTab] = useState('overview');
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [adminNotes, setAdminNotes] = useState('');
  const [notesDirty, setNotesDirty] = useState(false);
  const [pauseNoteDraft, setPauseNoteDraft] = useState('');
  const [confirm, setConfirm] = useState({ open: false, type: '', next: null });
  const [notice, setNotice] = useState('');
  const [walletAdjustments, setWalletAdjustments] = useState([]);
  const [futWalletSnapshot, setFutWalletSnapshot] = useState(null);
  const [futWalletTxns, setFutWalletTxns]         = useState([]);
  const [adjLoading, setAdjLoading] = useState(false);
  const [adjUid, setAdjUid] = useState(uid);
  const [adjAsset, setAdjAsset] = useState('USDT');
  const [adjDirection, setAdjDirection] = useState('credit');
  const [adjAmount, setAdjAmount] = useState('');
  const [adjNote, setAdjNote] = useState('');
  const [adjBusy, setAdjBusy] = useState(false);
  const [adjConfirmOpen, setAdjConfirmOpen] = useState(false);
  const [freezeScope, setFreezeScope] = useState('full');
  const [freezeReason, setFreezeReason] = useState('');
  const [freezeUntil, setFreezeUntil] = useState('');
  const [tierDraft, setTierDraft] = useState('tier_1');
  const [copiedAddr, setCopiedAddr] = useState('');

  const load = useCallback(async () => {
    setErr('');
    setAdjLoading(true);
    // Fan out spot user/adjustments and futures snapshot/ledger in parallel.
    // Futures endpoints are best-effort: a 403 from a viewer-role admin
    // shouldn't break the rest of the page.
    const [rUser, rAdj, rFutSnap, rFutTxns] = await Promise.all([
      api.user(uid),
      api.walletAdjustments({ uid, limit: '20', skip: '0' }),
      api.futures.walletSnapshot(uid).catch(() => null),
      api.futures.walletTxns(uid, { limit: 20 }).catch(() => null),
    ]);
    if (!rUser.ok) {
      setErr('User not found or access denied');
      setData(null);
      setWalletAdjustments([]);
      setFutWalletSnapshot(null);
      setFutWalletTxns([]);
      setAdjLoading(false);
      return;
    }
    const j = await rUser.json();
    setData(j);
    setTierDraft(j.user?.kyc_tier || 'tier_1');
    setAdminNotes(j.user?.admin_notes || '');
    setNotesDirty(false);
    setPauseNoteDraft(j.user?.user_pause_note || '');
    if (rAdj.ok) {
      const a = await rAdj.json().catch(() => ({}));
      setWalletAdjustments(a.items || []);
    } else {
      setWalletAdjustments([]);
    }
    if (rFutSnap?.ok) {
      const fs = await rFutSnap.json().catch(() => null);
      setFutWalletSnapshot(fs || null);
    } else {
      setFutWalletSnapshot(null);
    }
    if (rFutTxns?.ok) {
      const ft = await rFutTxns.json().catch(() => ({}));
      setFutWalletTxns(ft?.txns || []);
    } else {
      setFutWalletTxns([]);
    }
    setAdjLoading(false);
  }, [uid]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    setAdjUid(uid);
  }, [uid]);

  const patchUserFeaturesPaused = async nextPaused => {
    setBusy(true);
    try {
      const body = {
        user_features_paused: nextPaused,
        user_pause_note: nextPaused ? pauseNoteDraft.trim() : '',
      };
      const r = await api.patchUser(uid, body);
      if (!r.ok) throw new Error('Update failed');
      await load();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  const patchUserTradingPaused = async nextPaused => {
    setBusy(true);
    try {
      const r = await api.patchUser(uid, { user_trading_paused: nextPaused });
      if (!r.ok) throw new Error('Update failed');
      await load();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  const runAccountFreeze = async () => {
    if (!freezeReason.trim() || freezeReason.trim().length < 3) {
      setErr('Enter a freeze reason (at least 3 characters).');
      return;
    }
    setBusy(true);
    setErr('');
    try {
      const r = await api.accountFreeze(uid, {
        scope: freezeScope,
        reason: freezeReason.trim(),
        frozen_until: freezeUntil.trim() || undefined,
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.detail || 'Freeze failed');
      setNotice('Account freeze applied.');
      setFreezeReason('');
      setFreezeUntil('');
      await load();
    } catch (e) {
      setErr(e.message || 'Freeze failed');
    } finally {
      setBusy(false);
    }
  };

  const runAccountUnfreeze = async () => {
    setBusy(true);
    setErr('');
    try {
      const r = await api.accountUnfreeze(uid);
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.detail || 'Unfreeze failed');
      setNotice('Account unfreeze applied.');
      await load();
    } catch (e) {
      setErr(e.message || 'Unfreeze failed');
    } finally {
      setBusy(false);
    }
  };

  const runPatchKycTier = async () => {
    setBusy(true);
    setErr('');
    try {
      const r = await api.patchKycTier(uid, { kyc_tier: tierDraft });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.detail || 'KYC tier update failed');
      setNotice(`KYC tier set to ${j.kyc_tier || tierDraft}.`);
      await load();
    } catch (e) {
      setErr(e.message || 'KYC tier update failed');
    } finally {
      setBusy(false);
    }
  };

  const patchUserWithdrawalsPaused = async nextPaused => {
    setBusy(true);
    try {
      const r = await api.patchUser(uid, { user_withdrawals_paused: nextPaused });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.detail || 'Update failed');
      }
      await load();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  const patchActive = async is_active => {
    setBusy(true);
    try {
      const r = await api.patchUser(uid, { is_active });
      if (!r.ok) throw new Error('Update failed');
      await load();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  const saveNotes = async () => {
    setBusy(true);
    try {
      const r = await api.patchUser(uid, { admin_notes: adminNotes });
      if (!r.ok) throw new Error('Could not save notes');
      await load();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  const startImpersonation = async (preOpenedTab = null) => {
    setBusy(true);
    setErr('');
    setNotice('');
    try {
      const r = await api.impersonate(uid);
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        const detail = j.detail;
        const msg = typeof detail === 'string'
          ? detail
          : Array.isArray(detail)
            ? detail.map((d) => d?.msg || d).join(', ')
            : (detail?.msg || 'Impersonation failed');
        throw new Error(msg);
      }
      if (!j.access_token) {
        throw new Error('Server did not return an impersonation token.');
      }

      navigateExchangeImpersonation(preOpenedTab, j.access_token);

      const mins = j.impersonation?.expires_in_minutes ?? IMPERSONATE_SESSION_MINUTES;
      const email = data?.user?.email || uid;
      setNotice(`Opened Delta Exchange as ${email}. Session expires in ${mins} minutes.`);
    } catch (e) {
      if (preOpenedTab && !preOpenedTab.closed) {
        try { preOpenedTab.close(); } catch { /* ignore */ }
      }
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  const kycApprove = async () => {
    setBusy(true);
    try {
      const r = await api.approveKyc(uid);
      if (!r.ok) throw new Error('Failed');
      await load();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  const kycReject = async (reason) => {
    setBusy(true);
    try {
      const r = await api.rejectKyc(uid, reason);
      if (!r.ok) throw new Error('Failed');
      await load();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  const submitWalletAdjustment = async () => {
    const targetUid = (adjUid || '').trim();
    const amountNum = Number(adjAmount);
    if (!targetUid) {
      setErr('UID is required for wallet adjustment');
      return;
    }
    if (!Number.isFinite(amountNum) || amountNum <= 0) {
      setErr('Wallet adjustment amount must be greater than zero');
      return;
    }
    setAdjBusy(true);
    setErr('');
    try {
      const r = await api.adjustUserWallet(targetUid, {
        direction: adjDirection,
        asset: adjAsset,
        amount: amountNum,
        note: adjNote.trim() || undefined,
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.detail || 'Wallet adjustment failed');
      setAdjAmount('');
      setAdjNote('');
      await load();
    } catch (e) {
      setErr(e.message);
    } finally {
      setAdjBusy(false);
    }
  };

  if (!data && !err) {
    return (
      <div className="flex justify-center py-24">
        <div className="w-10 h-10 border-2 border-gold border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (err && !data) {
    return (
      <div>
        <Link to="/users" className="text-gold-light text-sm font-bold inline-flex items-center gap-1 mb-4">
          <ArrowLeft size={16} /> Users
        </Link>
        <p className="text-red-400">{err}</p>
      </div>
    );
  }

  const u = data.user;
  const kyc = data.kyc;
  const activeTabMeta = TABS.find((t) => t.id === tab) || TABS[0];
  const accountActive = u.is_active !== false;
  const featuresPaused = !!u.user_features_paused;
  const tradingPaused = !!u.user_trading_paused;
  const withdrawalsPaused = !!u.user_withdrawals_paused;
  const complianceFrozen = !!u.account_frozen_at;
  const showOverview = tab === 'overview';
  const showControls = tab === 'controls';
  const showCompliance = tab === 'compliance';
  const showNotes = tab === 'notes';

  return (
    <div className="admin-page">
      <Link to="/users" className="text-gold-light text-sm font-bold inline-flex items-center gap-1 mb-4 hover:underline">
        <ArrowLeft size={16} /> Back to users
      </Link>

      <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4 mb-6">
        <div className="min-w-0">
          <h1 className="admin-title break-words">{u.name}</h1>
          <p className="text-white/80 text-base mt-1">{u.email}</p>
          <p className="text-white/60 font-mono text-sm mt-1">{u.uid}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => setConfirm({ open: true, type: 'active', next: !accountActive })}
            className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold border ${
              accountActive
                ? 'border-red-500/30 text-red-300 hover:bg-red-500/10'
                : 'border-green-500/30 text-green-300 hover:bg-green-500/10'
            }`}
          >
            {accountActive ? <><Ban size={16} /> Disable account</> : <><CheckCircle size={16} /> Enable account</>}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => setConfirm({ open: true, type: 'features', next: !featuresPaused })}
            title="Blocks trading, deposits, withdrawals, KYC submit, profile edits, and password changes while the user stays logged in."
            className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold border ${
              featuresPaused
                ? 'border-emerald-500/35 text-emerald-300 hover:bg-emerald-500/10'
                : 'border-gold/35 text-gold-light hover:bg-gold/10'
            }`}
          >
            {featuresPaused ? <><PlayCircle size={16} /> Resume features</> : <><PauseCircle size={16} /> Pause all features</>}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => setConfirm({ open: true, type: 'trading', next: !tradingPaused })}
            title="Only blocks placing orders, closing positions, and cancelling open orders."
            className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold border ${
              tradingPaused
                ? 'border-emerald-500/35 text-emerald-300 hover:bg-emerald-500/10'
                : 'border-sky-500/35 text-sky-200 hover:bg-sky-500/10'
            }`}
          >
            {tradingPaused ? <><PlayCircle size={16} /> Resume trading</> : <><CirclePause size={16} /> Pause trading only</>}
          </button>
          {privilegedOps ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => setConfirm({ open: true, type: 'withdrawals', next: !withdrawalsPaused })}
              title="Blocks new withdrawal requests only (deposits and trading can still work unless separately paused)."
              className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold border ${
                withdrawalsPaused
                  ? 'border-emerald-500/35 text-emerald-300 hover:bg-emerald-500/10'
                  : 'border-orange-500/35 text-orange-200 hover:bg-orange-500/10'
              }`}
            >
              {withdrawalsPaused ? <><PlayCircle size={16} /> Resume withdrawals</> : <><PauseCircle size={16} /> Pause withdrawals</>}
            </button>
          ) : null}
          {canImpersonate ? (
            <button
              type="button"
              disabled={busy || !accountActive}
              onClick={() => setConfirm({ open: true, type: 'impersonate', next: null })}
              title={accountActive ? 'Open exchange as this user in a new tab' : 'Enable the account before impersonation'}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold border border-gold/35 text-gold-light hover:bg-gold/10 disabled:opacity-40"
            >
              <UserCog size={16} /> Login as user
            </button>
          ) : null}
        </div>
      </div>

      <div className="mb-4 -mx-1 px-1 adm-table-x scrollbar-thin">
        <div className="admin-tabs w-max min-w-full">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={`admin-tab-btn shrink-0 ${
              tab === id
                ? 'active'
                : ''
            }`}
          >
            {Icon && <Icon size={16} />}
            {label}
          </button>
        ))}
        </div>
      </div>
      <div className="rounded-2xl border border-surface-border bg-surface-card/75 px-4 py-3 mb-6">
        <p className="text-base font-bold text-white">{activeTabMeta.label}</p>
        <p className="text-sm text-white/70 mt-1">{activeTabMeta.description}</p>
      </div>

      {err && <p className="text-red-400 text-sm mb-4">{err}</p>}

      {(showOverview || showControls || showCompliance || showNotes) && (
        <>
          {/* Quick status strip */}
          <div className="flex flex-wrap gap-2 mb-6">
            <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-extrabold border ${
              accountActive ? 'border-emerald-500/35 bg-emerald-500/10 text-emerald-200' : 'border-red-500/35 bg-red-500/10 text-red-200'
            }`}>
              {accountActive ? <CheckCircle size={12} /> : <Ban size={12} />}
              Account {accountActive ? 'active' : 'disabled'}
            </span>
            <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-extrabold border ${
              u.kyc_status === 'approved'
                ? 'border-emerald-500/35 bg-emerald-500/10 text-emerald-200'
                : u.kyc_status === 'pending'
                  ? 'border-gold/35 bg-gold/10 text-gold-light'
                  : u.kyc_status === 'rejected'
                    ? 'border-red-500/35 bg-red-500/10 text-red-200'
                    : 'border-white/15 bg-white/[.05] text-white/65'
            }`}>
              <Shield size={12} />
              KYC: {u.kyc_status || 'unverified'}
            </span>
            <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-extrabold border ${
              featuresPaused ? 'border-gold/35 bg-gold/10 text-gold-light' : 'border-white/15 bg-white/[.05] text-white/65'
            }`}>
              {featuresPaused ? <PauseCircle size={12} /> : <PlayCircle size={12} />}
              Features {featuresPaused ? 'paused' : 'on'}
            </span>
            <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-extrabold border ${
              tradingPaused ? 'border-sky-500/35 bg-sky-500/10 text-sky-200' : 'border-white/15 bg-white/[.05] text-white/65'
            }`}>
              <CirclePause size={12} />
              Trading {tradingPaused ? 'paused' : 'on'}
            </span>
            <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-extrabold border ${
              withdrawalsPaused ? 'border-orange-500/35 bg-orange-500/10 text-orange-200' : 'border-white/15 bg-white/[.05] text-white/65'
            }`}>
              <Banknote size={12} />
              WD {withdrawalsPaused ? 'paused' : 'on'}
            </span>
            {u.kyc_tier ? (
              <span className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-extrabold border border-violet-500/30 bg-violet-500/10 text-violet-200">
                Tier {String(u.kyc_tier).replace('tier_', '')}
              </span>
            ) : null}
            {u.aml_risk_score != null ? (
              <span className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-extrabold border border-fuchsia-500/30 bg-fuchsia-500/10 text-fuchsia-200">
                AML {u.aml_risk_score}
              </span>
            ) : null}
            {complianceFrozen ? (
              <span className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-extrabold border border-rose-500/40 bg-rose-500/15 text-rose-100">
                Compliance freeze ({u.account_frozen_scope || 'full'})
              </span>
            ) : null}
          </div>

          {showControls && (
          <div className="rounded-2xl border border-gold/25 bg-gold/5 p-5 mb-6">
            <p className="text-xs font-extrabold text-gold-light/80 uppercase tracking-wider mb-2">Per-user feature pause</p>
            <p className="text-sm text-white/65 mb-3">
              When paused, the user can still browse read-only data but cannot trade, move funds, submit KYC, edit profile, change password, place/cancel orders, or close positions.
              Optional message below is returned as the API error detail (HTTP 403).
            </p>
            <textarea
              value={pauseNoteDraft}
              onChange={e => setPauseNoteDraft(e.target.value)}
              rows={2}
              disabled={busy}
              className="w-full rounded-xl bg-surface-dark border border-surface-border px-4 py-3 text-sm text-white placeholder:text-white/30 mb-3"
              placeholder="Short reason shown to the user (optional)"
            />
            <p className="text-xs text-white/45">
              Status:{' '}
              <span className={featuresPaused ? 'text-gold-light font-bold' : 'text-emerald-300 font-bold'}>
                {featuresPaused ? 'All actions paused' : 'Actions allowed'}
              </span>
              {!featuresPaused && (
                <span className="ml-2">
                  | Trading:{' '}
                  <span className={tradingPaused ? 'text-sky-300 font-bold' : 'text-emerald-300 font-bold'}>
                    {tradingPaused ? 'Paused only' : 'Allowed'}
                  </span>
                  {' '}| Withdrawals:{' '}
                  <span className={withdrawalsPaused ? 'text-orange-300 font-bold' : 'text-emerald-300 font-bold'}>
                    {withdrawalsPaused ? 'Paused' : 'Allowed'}
                  </span>
                </span>
              )}
            </p>
          </div>
          )}

          {showControls && privilegedOps ? (
            <div className="rounded-2xl border border-surface-border bg-surface-card p-5 mb-6">
              <p className="text-xs font-extrabold text-white/50 uppercase tracking-wider mb-3">Security actions</p>
              <p className="text-[12px] text-white/50 mb-3">
                Force logout bumps <code className="font-mono text-white/70">sessions_epoch</code> and clears refresh tokens.
                Password reset sends the same email as the user &quot;forgot password&quot; flow (requires SMTP on the API host).
              </p>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setConfirm({ open: true, type: 'forceLogout', next: null })}
                  className="px-3 py-2 rounded-xl border border-gold/35 text-gold-light text-sm font-bold hover:bg-gold/10"
                >
                  Force logout
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setConfirm({ open: true, type: 'reset2fa', next: null })}
                  className="px-3 py-2 rounded-xl border border-rose-500/35 text-rose-200 text-sm font-bold hover:bg-rose-500/10"
                >
                  Reset 2FA
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setConfirm({ open: true, type: 'passwordResetEmail', next: null })}
                  className="px-3 py-2 rounded-xl border border-sky-500/35 text-sky-200 text-sm font-bold hover:bg-sky-500/10"
                >
                  Email password reset
                </button>
              </div>
              {notice ? <p className="text-emerald-300 text-xs mt-2">{notice}</p> : null}
            </div>
          ) : null}

          {showControls && privilegedOps ? (
            <div className="rounded-2xl border border-rose-500/25 bg-rose-500/5 p-5 mb-6">
              <p className="text-xs font-extrabold text-rose-200/90 uppercase tracking-wider mb-2">Account freeze</p>
              <p className="text-sm text-white/65 mb-3">
                Applies compliance holds with an audit trail. Unfreeze clears the last recorded freeze scope.
              </p>
              <div className="grid sm:grid-cols-2 gap-3 mb-3">
                <label className="text-xs text-white/70 block">
                  <span className="block mb-1 font-bold text-white/80">Scope</span>
                  <select
                    value={freezeScope}
                    onChange={e => setFreezeScope(e.target.value)}
                    disabled={busy}
                    className="w-full rounded-xl bg-surface-dark border border-surface-border px-3 py-2 text-sm text-white"
                  >
                    <option value="full">Full (features + trading + withdrawals)</option>
                    <option value="trading">Trading only</option>
                    <option value="withdrawals">Withdrawals only</option>
                  </select>
                </label>
                <label className="text-xs text-white/70 block">
                  <span className="block mb-1 font-bold text-white/80">Until (optional ISO)</span>
                  <input
                    value={freezeUntil}
                    onChange={e => setFreezeUntil(e.target.value)}
                    disabled={busy}
                    placeholder="e.g. 2026-12-31T23:59:59+00:00"
                    className="w-full rounded-xl bg-surface-dark border border-surface-border px-3 py-2 text-sm text-white font-mono"
                  />
                </label>
              </div>
              <textarea
                value={freezeReason}
                onChange={e => setFreezeReason(e.target.value)}
                rows={2}
                disabled={busy}
                className="w-full rounded-xl bg-surface-dark border border-surface-border px-4 py-3 text-sm text-white mb-3"
                placeholder="Reason (shown to the user via pause note)"
              />
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={runAccountFreeze}
                  className="px-3 py-2 rounded-xl border border-rose-500/40 text-rose-200 text-sm font-bold hover:bg-rose-500/10"
                >
                  Apply freeze
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={runAccountUnfreeze}
                  className="px-3 py-2 rounded-xl border border-emerald-500/35 text-emerald-200 text-sm font-bold hover:bg-emerald-500/10"
                >
                  Unfreeze
                </button>
              </div>
            </div>
          ) : null}

          {showCompliance && canManageCompliance ? (
            <div className="rounded-2xl border border-violet-500/25 bg-violet-500/5 p-5 mb-6">
              <p className="text-xs font-extrabold text-violet-200/90 uppercase tracking-wider mb-2">KYC tier</p>
              <p className="text-sm text-white/65 mb-3">
                Adjusts stored tier on the user and KYC record; AML risk is recomputed on the server.
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={tierDraft}
                  onChange={e => setTierDraft(e.target.value)}
                  disabled={busy}
                  className="rounded-xl bg-surface-dark border border-surface-border px-3 py-2 text-sm text-white min-w-[140px]"
                >
                  <option value="tier_0">tier_0</option>
                  <option value="tier_1">tier_1</option>
                  <option value="tier_2">tier_2</option>
                </select>
                <button
                  type="button"
                  disabled={busy || tierDraft === (u.kyc_tier || '')}
                  onClick={runPatchKycTier}
                  className="px-3 py-2 rounded-xl border border-violet-500/40 text-violet-200 text-sm font-bold hover:bg-violet-500/10 disabled:opacity-40"
                >
                  Save tier
                </button>
              </div>
            </div>
          ) : null}

          {showOverview && (
          <div className="grid lg:grid-cols-2 gap-5 mb-6">
            <div className="rounded-2xl border border-surface-border bg-surface-card p-5 lg:p-6">
              <p className="text-xs font-extrabold text-gold-light/90 uppercase tracking-wider mb-4 flex items-center gap-2">
                <User size={14} className="opacity-80" />
                Profile &amp; account
              </p>
              <div className="divide-y divide-white/[0.06] -mt-1">
                <DetailRow label="Name" value={u.name} />
                <DetailRow label="Email" value={u.email} />
                <DetailRow label="UID" value={u.uid} />
                <DetailRow label="Phone" value={u.phone} />
                <DetailRow label="Country" value={u.country} />
                <DetailRow label="Joined" value={u.created_at ? new Date(u.created_at).toLocaleString() : null} />
                <DetailRow label="Last login" value={u.last_login_at ? new Date(u.last_login_at).toLocaleString() : null} />
                <DetailRow label="Last activity" value={u.last_activity_at ? new Date(u.last_activity_at).toLocaleString() : null} />
                <DetailRow label="KYC tier" value={u.kyc_tier || '—'} />
                <DetailRow label="AML risk score" value={u.aml_risk_score != null ? String(u.aml_risk_score) : '—'} />
                <DetailRow
                  label="AML factors"
                  value={Array.isArray(u.aml_risk_factors) && u.aml_risk_factors.length ? u.aml_risk_factors.join(', ') : '—'}
                />
                <DetailRow label="Freeze until" value={u.account_frozen_until || '—'} />
              </div>
              <div className="mt-4 pt-4 border-t border-white/[0.06]">
                <p className="text-[11px] font-extrabold text-white/40 uppercase tracking-wider mb-2">Bio</p>
                <p className="text-sm text-white/80 whitespace-pre-wrap leading-relaxed">{u.bio || '—'}</p>
              </div>
            </div>

            <div className="rounded-2xl border border-surface-border bg-surface-card p-5 lg:p-6">
              <p className="text-xs font-extrabold text-gold-light/90 uppercase tracking-wider mb-4 flex items-center gap-2">
                <TrendingUp size={14} className="opacity-80" />
                Activity summary
              </p>
              <div className="grid grid-cols-2 gap-3">
                {[
                  ['Orders', data.counts?.orders ?? 0],
                  ['Trades', data.counts?.trades ?? 0],
                  ['Deposits', data.counts?.deposits ?? 0],
                  ['Withdrawals', data.counts?.withdrawals ?? 0],
                ].map(([label, n]) => (
                  <div key={label} className="rounded-xl border border-surface-border/80 bg-surface-dark/50 px-4 py-3">
                    <p className="text-[10px] font-extrabold text-white/40 uppercase">{label}</p>
                    <p className="text-xl font-extrabold text-white font-mono mt-1">{n}</p>
                  </div>
                ))}
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-2 mt-5 text-xs font-bold">
                <Link to={`/deposits?uid=${uid}`} className="text-gold-light hover:underline inline-flex items-center gap-1">
                  Deposits <ExternalLink size={12} className="opacity-60" />
                </Link>
                <Link to={`/withdrawals?uid=${uid}`} className="text-gold-light hover:underline inline-flex items-center gap-1">
                  Withdrawals <ExternalLink size={12} className="opacity-60" />
                </Link>
                <Link to={`/trading?uid=${uid}`} className="text-gold-light hover:underline inline-flex items-center gap-1">
                  Trading feed <ExternalLink size={12} className="opacity-60" />
                </Link>
              </div>
            </div>
          </div>
          )}

          {/* KYC — full detail */}
          {showCompliance && (
          <div className="rounded-2xl border border-surface-border bg-surface-card overflow-hidden mb-6">
            <div className="px-5 py-4 border-b border-surface-border bg-white/[.03] flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <div className={`p-2 rounded-xl shrink-0 ${
                  u.kyc_status === 'approved' ? 'bg-emerald-500/15 text-emerald-300'
                    : u.kyc_status === 'pending' ? 'bg-gold/15 text-gold-light'
                      : u.kyc_status === 'rejected' ? 'bg-red-500/15 text-red-300'
                        : 'bg-white/10 text-white/60'
                }`}>
                  {u.kyc_status === 'approved' ? <CheckCircle size={20} />
                    : u.kyc_status === 'pending' ? <Clock size={20} />
                      : u.kyc_status === 'rejected' ? <XCircle size={20} />
                        : <Shield size={20} />}
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-extrabold text-white/45 uppercase tracking-wider">KYC verification</p>
                  <p className="text-lg font-extrabold text-white capitalize">{u.kyc_status || 'unverified'}</p>
                  {kyc?.status && kyc.status !== u.kyc_status && (
                    <p className="text-[11px] text-white/45 mt-0.5 font-mono">Record: {kyc.status.replace(/_/g, ' ')}</p>
                  )}
                  {kyc?.status === 'draft' && u.kyc_status !== 'pending' && (
                    <p className="text-[11px] text-sky-300/90 mt-0.5">Application in progress on exchange (draft saved).</p>
                  )}
                  {kyc?.verification?.engine === 'signzy_digilocker' && (
                    <p className="text-[11px] text-emerald-300/90 mt-0.5">Verified via DigiLocker (Signzy)</p>
                  )}
                </div>
              </div>
              <Link
                to="/kyc"
                className="text-xs font-bold px-3 py-2 rounded-xl border border-surface-border text-white/85 hover:bg-white/[.06] inline-flex items-center gap-1.5 shrink-0"
              >
                KYC queue <ExternalLink size={12} />
              </Link>
            </div>

            <div className="p-5 lg:p-6 space-y-5">
              {u.kyc_status === 'approved' && (
                <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/[0.07] px-4 py-3 text-sm text-emerald-100/90">
                  <strong className="text-emerald-200">Verified.</strong>{' '}
                  KYC is complete; approve and reject actions are not shown for this user.
                  {kyc?.reviewed_at && (
                    <span className="block mt-2 text-xs text-emerald-200/70">
                      Reviewed: {new Date(kyc.reviewed_at).toLocaleString()}
                    </span>
                  )}
                </div>
              )}

              {u.kyc_status === 'rejected' && (
                <div className="rounded-xl border border-red-500/25 bg-red-500/[0.07] px-4 py-3 text-sm text-red-100/90">
                  <strong className="text-red-200">Last application rejected.</strong>{' '}
                  The user can submit again from the exchange. Reason recorded:
                  {kyc?.rejection_reason ? (
                    <span className="block mt-2 text-white/90 font-medium whitespace-pre-wrap">{kyc.rejection_reason}</span>
                  ) : (
                    <span className="block mt-2 text-white/50 italic">No reason stored.</span>
                  )}
                </div>
              )}

              {(u.kyc_status === 'unverified' || !u.kyc_status) && !kyc && (
                <p className="text-sm text-white/50">No KYC record on file. The user has not started or saved a submission yet.</p>
              )}

              {u.kyc_status === 'pending' && (
                <div className="rounded-xl border border-gold/25 bg-gold/10 px-4 py-3 text-sm text-gold-light/90/90">
                  <strong className="text-gold-light">Pending review.</strong>{' '}
                  Use Approve or Reject below after checking identity details and documents.
                </div>
              )}

              {(kyc?.personal_info && typeof kyc.personal_info === 'object') && (
                <div>
                  <p className="text-[11px] font-extrabold text-white/45 uppercase tracking-wider mb-2 flex items-center gap-2">
                    <FileText size={12} /> Submitted personal info
                  </p>
                  <div className="rounded-xl border border-surface-border bg-surface-dark/40 px-4 divide-y divide-white/[0.06]">
                    {Object.entries(kyc.personal_info).map(([key, val]) => (
                      <DetailRow key={key} label={key.replace(/_/g, ' ')} value={val} />
                    ))}
                  </div>
                </div>
              )}

              {(kyc?.document_info && typeof kyc.document_info === 'object') && (
                <div>
                  <p className="text-[11px] font-extrabold text-white/45 uppercase tracking-wider mb-2">Document metadata</p>
                  <div className="rounded-xl border border-surface-border bg-surface-dark/40 px-4 divide-y divide-white/[0.06]">
                    {Object.entries(kyc.document_info).map(([key, val]) => (
                      <DetailRow key={key} label={key.replace(/_/g, ' ')} value={val} />
                    ))}
                  </div>
                </div>
              )}

              {kyc?.pan_info && (
                <div>
                  <p className="text-[11px] font-extrabold text-white/45 uppercase tracking-wider mb-2">PAN (DigiLocker)</p>
                  <div className="rounded-xl border border-surface-border bg-surface-dark/40 px-4 divide-y divide-white/[0.06]">
                    <DetailRow label="Linked" value={kyc.pan_info.linked ? 'Yes' : 'No'} />
                    {kyc.pan_info.source && (
                      <DetailRow label="Source" value={kyc.pan_info.source.replace(/_/g, ' ')} />
                    )}
                    {kyc.pan_info.linked && (
                      <>
                        <DetailRow label="PAN number" value={kyc.pan_info.number} />
                        {kyc.pan_info.issuer && <DetailRow label="Issuer" value={kyc.pan_info.issuer} />}
                      </>
                    )}
                    {!kyc.pan_info.linked && kyc.pan_info.verified && kyc.pan_info.number && (
                      <>
                        <DetailRow label="PAN number" value={kyc.pan_info.number} />
                        <DetailRow label="Verified" value="Yes (Signzy PAN Verify)" />
                        {kyc.pan_info.pan_status && (
                          <DetailRow label="PAN status" value={kyc.pan_info.pan_status} />
                        )}
                      </>
                    )}
                  </div>
                </div>
              )}

              {kyc?.verification?.engine === 'signzy_digilocker' && (
                <div>
                  <p className="text-[11px] font-extrabold text-white/45 uppercase tracking-wider mb-2">DigiLocker verification</p>
                  <div className="rounded-xl border border-surface-border bg-surface-dark/40 px-4 divide-y divide-white/[0.06]">
                    <DetailRow label="Engine" value={kyc.verification.engine} />
                    {kyc.verification.digilocker_id && (
                      <DetailRow label="DigiLocker ID" value={kyc.verification.digilocker_id} />
                    )}
                    <DetailRow label="eAadhaar linked" value={kyc.verification.eaadhaar_linked ? 'Yes' : 'No'} />
                    {kyc.verification.checked_at && (
                      <DetailRow label="Checked at" value={new Date(kyc.verification.checked_at).toLocaleString()} />
                    )}
                    {kyc.digilocker_request_id && (
                      <DetailRow label="Signzy request ID" value={kyc.digilocker_request_id} />
                    )}
                  </div>
                </div>
              )}

              {kyc?.pan_verify && (
                <div>
                  <p className="text-[11px] font-extrabold text-white/45 uppercase tracking-wider mb-2">PAN verify (Signzy)</p>
                  <div className={`rounded-xl border px-4 py-3 ${
                    kyc.pan_verify.verified
                      ? 'border-emerald-500/25 bg-emerald-500/[0.07]'
                      : 'border-red-500/25 bg-red-500/[0.07]'
                  }`}>
                    <p className={`text-sm font-bold ${kyc.pan_verify.verified ? 'text-emerald-300' : 'text-red-300'}`}>
                      {kyc.pan_verify.verified ? 'Verified' : 'Failed'}
                    </p>
                    {kyc.pan_verify.pan && (
                      <p className="text-xs text-white/70 mt-1 font-mono">{kyc.pan_verify.pan}</p>
                    )}
                    {kyc.pan_verify.message && (
                      <p className="text-xs text-white/50 mt-1">{kyc.pan_verify.message}</p>
                    )}
                    {kyc.pan_verify.checked_at && (
                      <p className="text-[11px] text-white/40 mt-2">
                        {new Date(kyc.pan_verify.checked_at).toLocaleString()}
                      </p>
                    )}
                  </div>
                </div>
              )}

              {kyc?.face_match && (
                <div>
                  <p className="text-[11px] font-extrabold text-white/45 uppercase tracking-wider mb-2">Face match (Signzy)</p>
                  <div className={`rounded-xl border px-4 py-3 ${
                    kyc.face_match.verified
                      ? 'border-emerald-500/25 bg-emerald-500/[0.07]'
                      : 'border-red-500/25 bg-red-500/[0.07]'
                  }`}>
                    <p className={`text-sm font-bold ${kyc.face_match.verified ? 'text-emerald-300' : 'text-red-300'}`}>
                      {kyc.face_match.verified ? 'Verified' : 'Failed'}
                    </p>
                    {kyc.face_match.match_percentage != null && (
                      <p className="text-xs text-white/70 mt-1">Match: {kyc.face_match.match_percentage}%</p>
                    )}
                    {kyc.face_match.message && (
                      <p className="text-xs text-white/50 mt-1">{kyc.face_match.message}</p>
                    )}
                    {kyc.face_match.checked_at && (
                      <p className="text-[11px] text-white/40 mt-2">
                        {new Date(kyc.face_match.checked_at).toLocaleString()}
                      </p>
                    )}
                  </div>
                </div>
              )}

              <div className="flex flex-wrap gap-2 text-xs text-white/50">
                {kyc?.submitted_at && (
                  <span className="rounded-lg bg-white/[.06] px-2.5 py-1 border border-white/10">
                    Submitted: {new Date(kyc.submitted_at).toLocaleString()}
                  </span>
                )}
                {kyc?.reviewed_at && u.kyc_status !== 'pending' && (
                  <span className="rounded-lg bg-white/[.06] px-2.5 py-1 border border-white/10">
                    Reviewed: {new Date(kyc.reviewed_at).toLocaleString()}
                  </span>
                )}
              </div>

              {(kyc?.document_front_url || kyc?.document_back_url || kyc?.selfie_url || kyc?.aadhaar_photo_url) && (
                <div>
                  <p className="text-[11px] font-extrabold text-white/45 uppercase tracking-wider mb-3">Identity images</p>
                  <div className="flex flex-wrap gap-4">
                    <KycDocImage
                      label={kyc?.verification?.engine === 'signzy_digilocker' ? 'Aadhaar photo' : 'ID front'}
                      url={kyc.aadhaar_photo_url || kyc.document_front_url}
                    />
                    {kyc.document_back_url && (
                      <KycDocImage label="ID back" url={kyc.document_back_url} />
                    )}
                    <KycDocImage label="Selfie" url={kyc.selfie_url} />
                  </div>
                </div>
              )}

              {u.kyc_status === 'pending' && (
                <div className="flex flex-wrap gap-2 pt-2 border-t border-surface-border">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => setConfirm({ open: true, type: 'kycApprove', next: null })}
                    className="text-xs font-bold px-4 py-2 rounded-xl bg-green-500/15 text-green-400 border border-green-500/25 hover:bg-green-500/20"
                  >
                    Approve KYC
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => setConfirm({ open: true, type: 'kycReject', next: null })}
                    className="text-xs font-bold px-4 py-2 rounded-xl bg-red-500/15 text-red-400 border border-red-500/25 hover:bg-red-500/20"
                  >
                    Reject KYC
                  </button>
                </div>
              )}
            </div>
          </div>
          )}

          {showNotes && (
          <div className="rounded-2xl border border-surface-border bg-surface-card p-5 mb-8">
            <p className="text-xs font-extrabold text-white/50 uppercase tracking-wider mb-3">Internal admin notes</p>
            <p className="text-white/45 text-xs mb-2">Visible only via admin API — not shown to the user.</p>
            <textarea
              value={adminNotes}
              onChange={e => { setAdminNotes(e.target.value); setNotesDirty(true); }}
              rows={4}
              className="w-full rounded-xl bg-surface-dark border border-surface-border px-4 py-3 text-sm text-white placeholder:text-white/30"
              placeholder="Risk flags, support history, etc."
            />
            <button
              type="button"
              disabled={busy || !notesDirty}
              onClick={saveNotes}
              className="mt-3 px-4 py-2 rounded-xl bg-gold/20 border border-gold/35 text-gold-light text-sm font-bold disabled:opacity-40"
            >
              Save notes
            </button>
          </div>
          )}
        </>
      )}

      {tab === 'live' && <UserOverviewRecentActivity uid={uid} />}
      {tab === 'live_trading' && <UserLiveTradingPanel uid={uid} />}
      {tab === 'analytics' && <UserAnalyticsPanel uid={uid} />}

      {tab === 'wallets' && (
        <div className="space-y-4">
          <div className="rounded-2xl border border-surface-border bg-surface-card p-4">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
              <p className="text-xs font-extrabold text-white/55 uppercase tracking-wider">Adjust wallet balance (quick)</p>
              <p className="text-[11px] text-white/45">Use credit to add balance, debit to reduce available balance.</p>
            </div>
            <div className="grid sm:grid-cols-2 lg:grid-cols-6 gap-3">
              <input
                value={adjUid}
                onChange={(e) => setAdjUid(e.target.value)}
                placeholder="User UID"
                className="rounded-xl bg-surface-dark border border-surface-border px-3 py-2 text-sm text-white font-mono lg:col-span-2"
              />
              <select value={adjAsset} onChange={(e) => setAdjAsset(e.target.value)} className="rounded-xl bg-surface-dark border border-surface-border px-3 py-2 text-sm text-white">
                {['USDT', 'IBO', 'BTC', 'ETH', 'BNB', 'SOL', 'XRP', 'DOGE', 'ADA', 'POL', 'AVAX', 'DOT', 'LINK', 'LTC'].map((a) => (
                  <option key={a} value={a}>{a === 'IBO' ? 'Delta' : a}</option>
                ))}
              </select>
              <select value={adjDirection} onChange={(e) => setAdjDirection(e.target.value)} className="rounded-xl bg-surface-dark border border-surface-border px-3 py-2 text-sm text-white">
                <option value="credit">Add (credit)</option>
                <option value="debit">Reduce (debit)</option>
              </select>
              <input
                type="number"
                min="0"
                step="0.00000001"
                value={adjAmount}
                onChange={(e) => setAdjAmount(e.target.value)}
                placeholder="Amount"
                className="rounded-xl bg-surface-dark border border-surface-border px-3 py-2 text-sm text-white font-mono"
              />
              <button
                type="button"
                disabled={adjBusy}
                onClick={() => setAdjConfirmOpen(true)}
                className={`rounded-xl px-4 py-2 text-sm font-bold border disabled:opacity-40 ${
                  adjDirection === 'debit'
                    ? 'border-red-500/30 text-red-300 bg-red-500/10'
                    : 'border-green-500/30 text-green-300 bg-green-500/10'
                }`}
              >
                {adjDirection === 'debit' ? 'Reduce balance' : 'Add balance'}
              </button>
            </div>
            <input
              value={adjNote}
              onChange={(e) => setAdjNote(e.target.value)}
              placeholder="Reason / note (optional)"
              className="mt-3 w-full rounded-xl bg-surface-dark border border-surface-border px-3 py-2 text-sm text-white"
            />
          </div>

          <div>
            <div className="px-4 py-3 border-b border-surface-border flex items-center justify-between">
              <p className="text-xs font-extrabold text-white/55 uppercase tracking-wider">Spot wallets</p>
              <p className="text-[11px] text-white/45">Live balances per asset</p>
            </div>
            <AdminDataTable minWidth="480px">
              <thead>
                <tr>
                  <th>Asset</th>
                  <th className="text-right">Available</th>
                  <th className="text-right">Locked</th>
                </tr>
              </thead>
              <tbody>
                {(data.wallets || []).length === 0 ? (
                  <tr><td colSpan={3} className="text-center text-white/45 py-8">No wallet rows</td></tr>
                ) : (
                  data.wallets.map(w => (
                    <tr key={w.asset}>
                      <td className="font-bold">
                        <span className="inline-flex items-center gap-2">
                          <CoinAvatar asset={w.asset} className="h-6 w-6" />
                          {w.asset}
                        </span>
                      </td>
                      <td className="text-right font-mono text-green-400">{Number(w.available).toFixed(6)}</td>
                      <td className="text-right font-mono text-gold-light/80">{Number(w.locked).toFixed(6)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </AdminDataTable>
          </div>

          <div>
            <div className="px-4 py-3 border-b border-surface-border flex items-center justify-between gap-2 flex-wrap">
              <div>
                <p className="text-xs font-extrabold text-white/55 uppercase tracking-wider">HD deposit addresses</p>
                <p className="text-[11px] text-white/45">Per-user deposit addresses for this account (private keys never shown).</p>
              </div>
            </div>
            <AdminDataTable minWidth="640px">
              <thead>
                <tr>
                  <th>Asset</th>
                  <th>Network</th>
                  <th>Address</th>
                  <th>Path / index</th>
                  <th className="w-16" />
                </tr>
              </thead>
              <tbody>
                {(data.deposit_addresses || []).length === 0 ? (
                  <tr>
                    <td colSpan={5} className="text-center text-white/45 py-8">
                      No HD deposit addresses yet — they appear after the user opens Deposit for an asset.
                    </td>
                  </tr>
                ) : (
                  data.deposit_addresses.map((row) => {
                    const key = `${row.asset}:${row.network}:${row.address}`;
                    const copied = copiedAddr === key;
                    return (
                      <tr key={row.id || key}>
                        <td className="font-bold">
                          <span className="inline-flex items-center gap-2">
                            <CoinAvatar asset={row.asset} className="h-6 w-6" />
                            {row.asset}
                          </span>
                        </td>
                        <td className="text-white/80">{row.network || '—'}</td>
                        <td className="font-mono text-xs text-white/90 break-all max-w-[280px]">
                          {row.address || '—'}
                        </td>
                        <td className="font-mono text-[11px] text-white/50">
                          {row.derivation_path || '—'}
                          {row.derivation_index != null ? (
                            <span className="block text-white/35">idx {row.derivation_index}</span>
                          ) : null}
                        </td>
                        <td>
                          {row.address ? (
                            <button
                              type="button"
                              title="Copy address"
                              onClick={async () => {
                                try {
                                  await navigator.clipboard.writeText(row.address);
                                  setCopiedAddr(key);
                                  setTimeout(() => setCopiedAddr((cur) => (cur === key ? '' : cur)), 1500);
                                } catch { /* ignore */ }
                              }}
                              className="inline-flex items-center justify-center rounded-lg border border-surface-border bg-surface-dark/60 p-1.5 text-white/70 hover:text-gold-light hover:border-gold-light/40"
                            >
                              {copied ? <Check size={14} className="text-green-400" /> : <Copy size={14} />}
                            </button>
                          ) : null}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </AdminDataTable>
          </div>

          {/* Futures margin wallet — separate ledger (futures_wallets/futures_wallet_txns). */}
          <div className="rounded-2xl border border-surface-border bg-surface-card overflow-hidden">
            <div className="px-4 py-3 border-b border-surface-border flex items-center justify-between gap-3 flex-wrap">
              <div>
                <p className="text-xs font-extrabold text-white/55 uppercase tracking-wider">Futures wallet (USDT margin)</p>
                <p className="text-[11px] text-white/45">Isolated from spot · used as collateral for perpetuals.</p>
              </div>
              <Link to={`/wallet-adjustments?venue=futures&uid=${uid}`} className="text-gold-light text-xs font-bold hover:underline">
                Open futures Wallet Mgmt →
              </Link>
            </div>
            {!futWalletSnapshot ? (
              <p className="px-4 py-8 text-center text-white/45 text-sm">No futures wallet for this user yet.</p>
            ) : (
              <div className="grid sm:grid-cols-2 lg:grid-cols-5 gap-3 p-4">
                <div className="rounded-xl bg-surface-dark/50 border border-surface-border p-3">
                  <p className="text-[10px] uppercase tracking-wider text-white/45 font-bold">Margin balance</p>
                  <p className="text-lg font-mono font-extrabold text-white mt-1">{Number(futWalletSnapshot.margin_balance || 0).toFixed(2)}</p>
                  <p className="text-[10px] text-white/40">USDT</p>
                </div>
                <div className="rounded-xl bg-surface-dark/50 border border-surface-border p-3">
                  <p className="text-[10px] uppercase tracking-wider text-white/45 font-bold">Available</p>
                  <p className="text-lg font-mono font-extrabold text-green-400 mt-1">{Number(futWalletSnapshot.available || 0).toFixed(2)}</p>
                </div>
                <div className="rounded-xl bg-surface-dark/50 border border-surface-border p-3">
                  <p className="text-[10px] uppercase tracking-wider text-white/45 font-bold">Locked</p>
                  <p className="text-lg font-mono font-extrabold text-gold-light/80 mt-1">{Number(futWalletSnapshot.locked || 0).toFixed(2)}</p>
                </div>
                <div className="rounded-xl bg-surface-dark/50 border border-surface-border p-3">
                  <p className="text-[10px] uppercase tracking-wider text-white/45 font-bold">Free margin</p>
                  <p className="text-lg font-mono font-extrabold text-gold-light mt-1">{Number(futWalletSnapshot.free_margin || 0).toFixed(2)}</p>
                </div>
                <div className="rounded-xl bg-surface-dark/50 border border-surface-border p-3">
                  <p className="text-[10px] uppercase tracking-wider text-white/45 font-bold">Unrealized PnL</p>
                  <p className={`text-lg font-mono font-extrabold mt-1 ${Number(futWalletSnapshot.unrealized_pnl || 0) >= 0 ? 'text-green-300' : 'text-red-300'}`}>
                    {Number(futWalletSnapshot.unrealized_pnl || 0) >= 0 ? '+' : ''}{Number(futWalletSnapshot.unrealized_pnl || 0).toFixed(2)}
                  </p>
                </div>
              </div>
            )}
            {futWalletTxns.length > 0 && (
              <AdminDataTable minWidth="600px" className="!rounded-none !border-x-0 !border-b-0 border-t">
                  <thead>
                    <tr>
                      <th>Time</th>
                      <th>Type</th>
                      <th>Direction</th>
                      <th className="text-right">Amount</th>
                      <th className="text-right">After</th>
                      <th>Ref</th>
                    </tr>
                  </thead>
                  <tbody>
                    {futWalletTxns.slice(0, 12).map((t) => (
                      <tr key={t.id}>
                        <td className="text-[12px] text-white/55 font-mono whitespace-nowrap">{(t.created_at || '').slice(0, 19).replace('T', ' ')}</td>
                        <td className="text-[12px] capitalize text-white/80">{t.type}</td>
                        <td className="text-[12px]">
                          <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold uppercase ${
                            t.direction === 'credit' ? 'bg-green-500/15 text-green-400' : 'bg-red-500/15 text-red-300'
                          }`}>{t.direction}</span>
                        </td>
                        <td className={`text-right font-mono ${t.direction === 'credit' ? 'text-green-400' : 'text-red-300'}`}>
                          {Number(t.amount || 0).toFixed(4)}
                        </td>
                        <td className="text-right font-mono text-xs text-white/75">
                          {Number(t.balance_after?.available ?? 0).toFixed(4)}
                        </td>
                        <td className="text-[11px] text-white/55">{t.ref_type || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
              </AdminDataTable>
            )}
          </div>

          <div>
            <div className="px-4 py-3 border-b border-surface-border flex items-center justify-between gap-3">
              <p className="text-xs font-extrabold text-white/55 uppercase tracking-wider">Wallet adjustment history</p>
              <Link to={`/wallet-adjustments?uid=${uid}`} className="text-gold-light text-xs font-bold hover:underline">Open full history</Link>
            </div>
            <AdminDataTable minWidth="700px">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Asset</th>
                  <th>Type</th>
                  <th className="text-right">Amount</th>
                  <th className="text-right">Before {'->'} After</th>
                  <th>Admin</th>
                </tr>
              </thead>
              <tbody>
                {adjLoading ? (
                  <tr><td colSpan={6} className="text-center text-white/45 py-8">Loading adjustments…</td></tr>
                ) : walletAdjustments.length === 0 ? (
                  <tr><td colSpan={6} className="text-center text-white/45 py-8">No wallet adjustments for this user.</td></tr>
                ) : (
                  walletAdjustments.map((row) => (
                    <tr key={row.id}>
                      <td className="text-xs text-white/60 whitespace-nowrap">{row.created_at ? new Date(row.created_at).toLocaleString() : '—'}</td>
                      <td className="font-bold">
                        <span className="inline-flex items-center gap-2">
                          <CoinAvatar asset={row.asset} className="h-6 w-6" />
                          {row.asset}
                        </span>
                      </td>
                      <td>
                        <span className={`text-xs font-bold uppercase px-2 py-1 rounded-md ${row.direction === 'credit' ? 'bg-green-500/15 text-green-400' : 'bg-red-500/15 text-red-300'}`}>
                          {row.direction}
                        </span>
                      </td>
                      <td className={`text-right font-mono ${row.direction === 'credit' ? 'text-green-400' : 'text-red-300'}`}>{Number(row.amount || 0).toFixed(6)}</td>
                      <td className="text-right font-mono text-xs text-white/70">{Number(row.balance_before || 0).toFixed(6)} {'->'} {Number(row.balance_after || 0).toFixed(6)}</td>
                      <td className="text-xs text-white/60">{row.admin_email || row.admin_aid || '—'}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </AdminDataTable>
          </div>
        </div>
      )}

      {tab === 'orders' && <UserOrdersPanel uid={uid} />}
      {tab === 'trades' && <UserTradesPanel uid={uid} />}
      {tab === 'referral' && <UserReferralPanel uid={uid} />}
      {tab === 'money' && <UserMoneyPanel uid={uid} />}
      {tab === 'ledger' && <UserLedgerPanel uid={uid} />}
      {tab === 'sessions' && (
        <div className="space-y-4">
          {privilegedOps ? (
            <div className="rounded-2xl border border-surface-border bg-surface-card p-5">
              <p className="text-xs font-extrabold text-white/50 uppercase tracking-wider mb-3">Security actions</p>
              <p className="text-[12px] text-white/50 mb-3">
                Force logout bumps <code className="font-mono text-white/70">sessions_epoch</code> and clears refresh tokens.
                Password reset sends the same email as the user forgot-password flow.
              </p>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setConfirm({ open: true, type: 'forceLogout', next: null })}
                  className="px-3 py-2 rounded-xl border border-gold/35 text-gold-light text-sm font-bold hover:bg-gold/10"
                >
                  Force logout
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setConfirm({ open: true, type: 'reset2fa', next: null })}
                  className="px-3 py-2 rounded-xl border border-rose-500/35 text-rose-200 text-sm font-bold hover:bg-rose-500/10"
                >
                  Reset 2FA
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setConfirm({ open: true, type: 'passwordResetEmail', next: null })}
                  className="px-3 py-2 rounded-xl border border-sky-500/35 text-sky-200 text-sm font-bold hover:bg-sky-500/10"
                >
                  Email password reset
                </button>
              </div>
              {notice ? <p className="text-emerald-300 text-xs mt-2">{notice}</p> : null}
            </div>
          ) : null}
          <UserSessionsPanel uid={uid} />
        </div>
      )}

      <ConfirmModal
        open={confirm.open}
        title={
          confirm.type === 'active' ? (confirm.next ? 'Enable user account' : 'Disable user account')
            : confirm.type === 'features' ? (confirm.next ? 'Pause all user features' : 'Resume all user features')
              : confirm.type === 'trading' ? (confirm.next ? 'Pause user trading only' : 'Resume user trading')
                : confirm.type === 'withdrawals' ? (confirm.next ? 'Pause withdrawals' : 'Resume withdrawals')
                  : confirm.type === 'kycApprove' ? 'Approve KYC'
                    : confirm.type === 'kycReject' ? 'Reject KYC'
                    : confirm.type === 'forceLogout' ? 'Force logout user'
                      : confirm.type === 'reset2fa' ? 'Reset user 2FA'
                        : confirm.type === 'impersonate' ? 'Login as user'
                          : 'Send password reset email'
        }
        message={
          confirm.type === 'active'
            ? `Are you sure you want to ${confirm.next ? 'enable' : 'disable'} this user account?`
            : confirm.type === 'features'
              ? `Are you sure you want to ${confirm.next ? 'pause all features' : 'resume all features'} for this user?`
              : confirm.type === 'trading'
                ? `Are you sure you want to ${confirm.next ? 'pause trading only' : 'resume trading'} for this user?`
                : confirm.type === 'withdrawals'
                  ? `Are you sure you want to ${confirm.next ? 'block new withdrawal requests' : 'allow withdrawals again'} for this user?`
                  : confirm.type === 'kycApprove'
                    ? 'Confirm KYC approval for this user.'
                    : confirm.type === 'kycReject'
                      ? 'Confirm KYC rejection and provide reason.'
                      : confirm.type === 'forceLogout'
                        ? 'Force logout this user from all devices?'
                        : confirm.type === 'reset2fa'
                          ? 'Remove 2FA for this user? They can re-enroll from the exchange.'
                          : confirm.type === 'impersonate'
                            ? `You are about to open Delta Exchange in a new tab as ${u?.email || uid}. This support session will automatically expire in ${IMPERSONATE_SESSION_MINUTES} minutes. The user's own login session will not be affected and they will not be notified. All actions are logged for audit.`
                            : `Send password-reset email to ${u.email}?`
        }
        inputLabel={confirm.type === 'kycReject' ? 'Rejection reason' : ''}
        inputPlaceholder="Documents insufficient"
        initialValue="Documents insufficient"
        required={confirm.type === 'kycReject'}
        danger={
          confirm.type === 'kycReject'
          || (confirm.type === 'active' && !confirm.next)
          || (confirm.type === 'features' && confirm.next)
          || (confirm.type === 'withdrawals' && confirm.next)
        }
        confirmText={
          confirm.type === 'active' ? (confirm.next ? 'Enable' : 'Disable')
            : confirm.type === 'features' ? (confirm.next ? 'Pause all' : 'Resume all')
              : confirm.type === 'trading' ? (confirm.next ? 'Pause trading' : 'Resume trading')
                : confirm.type === 'withdrawals' ? (confirm.next ? 'Pause WD' : 'Resume WD')
                  : confirm.type === 'kycApprove' ? 'Approve'
                    : confirm.type === 'kycReject' ? 'Reject'
                      : confirm.type === 'forceLogout' ? 'Force logout'
                        : confirm.type === 'reset2fa' ? 'Reset 2FA'
                          : confirm.type === 'impersonate' ? 'Yes, login'
                            : 'Send email'
        }
        busy={busy}
        onClose={() => { if (!busy) setConfirm({ open: false, type: '', next: null }); }}
        onConfirm={async (value) => {
          const c = confirm;
          setConfirm({ open: false, type: '', next: null });
          if (c.type === 'impersonate') {
            const tab = openBlankExchangeTab();
            await startImpersonation(tab);
            return;
          }
          if (c.type === 'active') await patchActive(!!c.next);
          if (c.type === 'features') await patchUserFeaturesPaused(!!c.next);
          if (c.type === 'trading') await patchUserTradingPaused(!!c.next);
          if (c.type === 'withdrawals') await patchUserWithdrawalsPaused(!!c.next);
          if (c.type === 'kycApprove') await kycApprove();
          if (c.type === 'kycReject') await kycReject(value || 'Rejected');
          if (c.type === 'forceLogout') {
            setBusy(true);
            setErr('');
            try {
              const r = await api.userForceLogout(uid);
              const j = await r.json().catch(() => ({}));
              if (!r.ok) throw new Error(j.detail || 'Failed');
              await load();
            } catch (e) { setErr(e.message); }
            finally { setBusy(false); }
          }
          if (c.type === 'reset2fa') {
            setBusy(true);
            setErr('');
            try {
              const r = await api.userReset2fa(uid);
              const j = await r.json().catch(() => ({}));
              if (!r.ok) throw new Error(j.detail || 'Failed');
              await load();
            } catch (e) { setErr(e.message); }
            finally { setBusy(false); }
          }
          if (c.type === 'passwordResetEmail') {
            setBusy(true);
            setErr('');
            setNotice('');
            try {
              const r = await api.userPasswordResetRequest(uid, {});
              const j = await r.json().catch(() => ({}));
              if (!r.ok) throw new Error(j.detail || 'Failed');
              setNotice(j.message || 'Email sent (if SMTP configured).');
            } catch (e) { setErr(e.message); }
            finally { setBusy(false); }
          }
        }}
      />
      <ConfirmModal
        open={adjConfirmOpen}
        title={adjDirection === 'debit' ? 'Reduce wallet balance' : 'Add wallet balance'}
        message={`Confirm ${adjDirection === 'debit' ? 'debit' : 'credit'} of ${adjAmount || 0} ${adjAsset === 'IBO' ? 'Delta' : adjAsset} for UID ${adjUid || '(empty)'}.`}
        confirmText={adjDirection === 'debit' ? 'Reduce balance' : 'Add balance'}
        danger={adjDirection === 'debit'}
        busy={adjBusy}
        onClose={() => { if (!adjBusy) setAdjConfirmOpen(false); }}
        onConfirm={async () => {
          setAdjConfirmOpen(false);
          await submitWalletAdjustment();
        }}
      />
    </div>
  );
}

function UserOverviewRecentActivity({ uid }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let ok = true;
    setLoading(true);
    Promise.all([
      api.userOrders(uid, { skip: '0', limit: '6' }).then(r => r.ok ? r.json() : { items: [] }),
      api.userTrades(uid, { skip: '0', limit: '6' }).then(r => r.ok ? r.json() : { items: [] }),
      api.depositEvents({ uid, skip: '0', limit: '6' }).then(r => r.ok ? r.json() : { items: [] }),
      api.inrDeposits({ uid, skip: '0', limit: '6' }).then(r => r.ok ? r.json() : { items: [] }),
      api.inrWithdrawals({ uid, skip: '0', limit: '6' }).then(r => r.ok ? r.json() : { items: [] }),
      api.withdrawals({ uid, skip: '0', limit: '6' }).then(r => r.ok ? r.json() : { items: [] }),
    ]).then(([orders, trades, deps, inrDeps, inrWds, wds]) => {
      if (!ok) return;
      const merged = [
        ...(orders.items || []).map((o) => ({
          id: `order_${o.id}`,
          created_at: o.created_at,
          type: 'Order',
          title: `${o.side?.toUpperCase()} ${o.symbol}`,
          detail: `${o.type || 'limit'} • ${o.status || 'open'} • ${Number(o.amount || 0).toFixed(6)}`,
        })),
        ...(trades.items || []).map((t) => ({
          id: `trade_${t.id}`,
          created_at: t.created_at,
          type: 'Trade',
          title: `${t.symbol}`,
          detail: `${Number(t.amount || 0).toFixed(6)} @ ${Number(t.price || 0).toFixed(6)}`,
        })),
        ...(deps.items || []).map((d) => ({
          id: `dep_${d.id}`,
          created_at: d.created_at,
          type: d.source === 'signup_bonus' ? 'Signup bonus' : 'Deposit',
          title: d.source === 'signup_bonus' ? `🎁 ${d.asset} signup bonus` : `${d.asset} deposit`,
          detail: `${Number(d.amount || 0).toFixed(6)} • ${d.status || 'pending'}`,
        })),
        ...(inrDeps.items || []).map((d) => ({
          id: `inr_${d.id}`,
          created_at: d.created_at,
          type: 'INR deposit',
          title: formatInrAmount(d.amount_inr),
          detail: formatInrActivityDetail(d),
          utr: d.utr_number || null,
        })),
        ...(inrWds.items || []).map((w) => ({
          id: `inrw_${w.id}`,
          created_at: w.reviewed_at || w.updated_at || w.created_at,
          type: 'INR sell / payout',
          title: formatInrAmount(w.amount_inr),
          detail: formatInrWithdrawalActivityDetail(w),
          utr: w.payout_reference || null,
        })),
        ...(wds.items || []).map((w) => ({
          id: `wd_${w.id}`,
          created_at: w.created_at,
          type: 'Withdrawal',
          title: `${w.asset} withdrawal`,
          detail: `${Number(w.amount || 0).toFixed(6)} • ${w.status || ''}`,
        })),
      ]
        .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))
        .slice(0, 12);
      setRows(merged);
    }).finally(() => {
      if (ok) setLoading(false);
    });
    return () => { ok = false; };
  }, [uid]);

  return (
    <div className="rounded-2xl border border-surface-border bg-surface-card p-5 mb-6">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <p className="text-xs font-extrabold text-white/50 uppercase tracking-wider">Recent activity</p>
        <div className="flex items-center gap-3 text-xs font-bold">
          <Link to={`/deposit-events?channel=inr&uid=${encodeURIComponent(uid)}`} className="text-gold-light hover:underline">INR deposits</Link>
          <Link to={`/inr-withdrawals?uid=${encodeURIComponent(uid)}`} className="text-gold-light hover:underline">INR payouts</Link>
          <Link to={`/trading?uid=${uid}`} className="text-gold-light hover:underline">Trades</Link>
        </div>
      </div>
      <AdminDataTable minWidth="640px">
          <thead>
            <tr>
              <th>Time</th>
              <th>Type</th>
              <th>Activity</th>
              <th>Details</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={4} className="text-center text-white/45 py-10">Loading recent activity…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={4} className="text-center text-white/45 py-10">No recent activity found.</td></tr>
            ) : (
              rows.map((r) => (
                <tr key={r.id}>
                  <td className="text-[11px] text-white/55 whitespace-nowrap">{r.created_at ? new Date(r.created_at).toLocaleString() : '—'}</td>
                  <td className="text-xs font-bold text-gold-light">{r.type}</td>
                  <td className="font-semibold text-white">{r.title}</td>
                  <td className="text-xs text-white/70">
                    {r.utr ? (
                      <div className="space-y-0.5 min-w-0">
                        <p>{r.detail}</p>
                        <p className="font-mono text-[11px] text-white/50 truncate" title={r.utr}>{r.utr}</p>
                      </div>
                    ) : (
                      <span className="font-mono">{r.detail}</span>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
      </AdminDataTable>
    </div>
  );
}

function UserLiveTradingPanel({ uid }) {
  const [positions, setPositions] = useState([]);
  const [updatedAt, setUpdatedAt] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [orderForm, setOrderForm] = useState({
    symbol: 'BTCUSDT', side: 'buy', type: 'market', amount: '', price: '',
  });
  const [closeForm, setCloseForm] = useState({
    symbol: 'BTCUSDT', order_type: 'market', amount: '', fraction: '', price: '',
  });
  const [closeConfirm, setCloseConfirm] = useState({ open: false, kind: '', symbol: '' });
  const wsRef = useRef(null);

  const refreshFromRest = useCallback(async () => {
    setErr('');
    try {
      const r = await api.userLivePositions(uid);
      if (!r.ok) throw new Error('Could not load live positions');
      const j = await r.json();
      setPositions(j.positions || []);
      setUpdatedAt(j.updated_at || '');
    } catch (e) {
      setErr(e.message || 'Could not load live positions');
    }
  }, [uid]);

  useEffect(() => {
    setLoading(true);
    setErr('');
    const token = getStoredToken();
    if (!token) {
      setErr('Not authenticated');
      setPositions([]);
      setLoading(false);
      return;
    }
    const path = `/api/admin/ws/users/${encodeURIComponent(uid)}/positions/live?token=${encodeURIComponent(token)}`;
    const url = adminWsPath(path);
    let closed = false;
    let reconnectTimer = null;
    const connect = () => {
      if (closed) return;
      try {
        const ws = new WebSocket(url);
        wsRef.current = ws;
        ws.onopen = () => setErr('');
        ws.onmessage = (ev) => {
          try {
            const j = JSON.parse(ev.data);
            if (j.type === 'error' && j.detail) {
              setErr(String(j.detail));
              return;
            }
            if (j.type === 'user_live_positions') {
              setPositions(j.positions || []);
              setUpdatedAt(j.updated_at || '');
              setLoading(false);
            }
          } catch {
            /* ignore */
          }
        };
        ws.onerror = () => {
          if (!closed) setErr('WebSocket error');
        };
        ws.onclose = () => {
          wsRef.current = null;
          if (!closed) reconnectTimer = window.setTimeout(connect, 3000);
        };
      } catch (e) {
        setErr(e.message || 'WebSocket failed');
        setLoading(false);
        if (!closed) reconnectTimer = window.setTimeout(connect, 3000);
      }
    };
    connect();
    return () => {
      closed = true;
      if (reconnectTimer) window.clearTimeout(reconnectTimer);
      if (wsRef.current) {
        try {
          wsRef.current.close();
        } catch {
          /* ignore */
        }
        wsRef.current = null;
      }
    };
  }, [uid]);

  const placeOrder = async () => {
    const amount = Number(orderForm.amount);
    const body = {
      symbol: orderForm.symbol.trim().toUpperCase(),
      side: orderForm.side,
      type: orderForm.type,
      amount,
    };
    if (!body.symbol || !Number.isFinite(amount) || amount <= 0) {
      setErr('Order symbol and amount are required');
      return;
    }
    if (orderForm.type === 'limit') {
      const p = Number(orderForm.price);
      if (!Number.isFinite(p) || p <= 0) {
        setErr('Limit order requires valid price');
        return;
      }
      body.price = p;
    }
    setBusy(true);
    setErr('');
    try {
      const r = await api.adminPlaceUserOrder(uid, body);
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.detail || 'Order failed');
      setOrderForm((v) => ({ ...v, amount: '', price: '' }));
      await refreshFromRest();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  const runClose = async (body, { clearCloseFormFields = false } = {}) => {
    setBusy(true);
    setErr('');
    try {
      const r = await api.adminCloseUserPosition(uid, body);
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.detail || 'Close failed');
      if (clearCloseFormFields) {
        setCloseForm((v) => ({ ...v, amount: '', fraction: '', price: '' }));
      }
      await refreshFromRest();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  const closePosition = async () => {
    const body = {
      symbol: closeForm.symbol.trim().toUpperCase(),
      order_type: closeForm.order_type,
    };
    const amountNum = Number(closeForm.amount);
    const fractionNum = Number(closeForm.fraction);
    if (!body.symbol) {
      setErr('Close position requires symbol');
      return;
    }
    if (closeForm.amount.trim()) body.amount = amountNum;
    if (closeForm.fraction.trim()) body.fraction = fractionNum;
    if (closeForm.order_type === 'limit' && closeForm.price.trim()) body.price = Number(closeForm.price);
    if (!body.amount && !body.fraction) {
      body.fraction = 1;
    }
    await runClose(body, { clearCloseFormFields: true });
  };

  const closeRowAtMarket = (symbol) => {
    const sym = String(symbol || '').trim().toUpperCase();
    if (!sym) return;
    setCloseConfirm({ open: true, kind: 'single', symbol: sym });
  };

  const closeAllAtMarket = async () => {
    if (!positions.length) return;
    setCloseConfirm({ open: true, kind: 'all', symbol: '' });
  };

  const confirmMarketClose = async () => {
    if (closeConfirm.kind === 'single' && closeConfirm.symbol) {
      await runClose({ symbol: closeConfirm.symbol, order_type: 'market' });
      setCloseConfirm({ open: false, kind: '', symbol: '' });
      return;
    }
    if (closeConfirm.kind !== 'all') return;
    setBusy(true);
    setErr('');
    try {
      const syms = [...new Set(positions.map((p) => String(p.symbol || '').trim().toUpperCase()).filter(Boolean))];
      for (const sym of syms) {
        const r = await api.adminCloseUserPosition(uid, { symbol: sym, order_type: 'market' });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(`${sym}: ${j.detail || 'Close failed'}`);
      }
      await refreshFromRest();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
      setCloseConfirm({ open: false, kind: '', symbol: '' });
    }
  };

  return (
    <div className="space-y-4">
      {err ? <p className="text-red-400 text-sm">{err}</p> : null}
      <div className="grid lg:grid-cols-2 gap-4">
        <div className="rounded-2xl border border-surface-border bg-surface-card p-4">
          <p className="text-xs font-extrabold text-white/50 uppercase tracking-wider mb-3">Admin place order for this user</p>
          <div className="grid sm:grid-cols-2 gap-3">
            <input value={orderForm.symbol} onChange={(e) => setOrderForm((v) => ({ ...v, symbol: e.target.value }))} placeholder="Symbol" className="rounded-xl bg-surface-dark border border-surface-border px-3 py-2 text-sm text-white font-mono uppercase" />
            <select value={orderForm.side} onChange={(e) => setOrderForm((v) => ({ ...v, side: e.target.value }))} className="rounded-xl bg-surface-dark border border-surface-border px-3 py-2 text-sm text-white">
              <option value="buy">Buy</option>
              <option value="sell">Sell</option>
            </select>
            <select value={orderForm.type} onChange={(e) => setOrderForm((v) => ({ ...v, type: e.target.value }))} className="rounded-xl bg-surface-dark border border-surface-border px-3 py-2 text-sm text-white">
              <option value="market">Market</option>
              <option value="limit">Limit</option>
            </select>
            <input value={orderForm.amount} onChange={(e) => setOrderForm((v) => ({ ...v, amount: e.target.value }))} type="number" step="0.00000001" min="0" placeholder="Amount" className="rounded-xl bg-surface-dark border border-surface-border px-3 py-2 text-sm text-white font-mono" />
            {orderForm.type === 'limit' ? (
              <input value={orderForm.price} onChange={(e) => setOrderForm((v) => ({ ...v, price: e.target.value }))} type="number" step="0.00000001" min="0" placeholder="Price" className="rounded-xl bg-surface-dark border border-surface-border px-3 py-2 text-sm text-white font-mono sm:col-span-2" />
            ) : null}
          </div>
          <button type="button" disabled={busy} onClick={placeOrder} className="mt-3 px-4 py-2 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 text-sm font-bold disabled:opacity-40">
            Place order
          </button>
        </div>

        <div className="rounded-2xl border border-surface-border bg-surface-card p-4">
          <p className="text-xs font-extrabold text-white/50 uppercase tracking-wider mb-1">Admin close user position</p>
          <p className="text-[11px] text-white/40 mb-3">For a full market close, use <strong className="text-white/55">Close</strong> on a row below or <strong className="text-white/55">Close all</strong>. This form is for limit or partial closes.</p>
          <div className="grid sm:grid-cols-2 gap-3">
            <input value={closeForm.symbol} onChange={(e) => setCloseForm((v) => ({ ...v, symbol: e.target.value }))} placeholder="Symbol" className="rounded-xl bg-surface-dark border border-surface-border px-3 py-2 text-sm text-white font-mono uppercase" />
            <select value={closeForm.order_type} onChange={(e) => setCloseForm((v) => ({ ...v, order_type: e.target.value }))} className="rounded-xl bg-surface-dark border border-surface-border px-3 py-2 text-sm text-white">
              <option value="market">Market close</option>
              <option value="limit">Limit close</option>
            </select>
            <input value={closeForm.amount} onChange={(e) => setCloseForm((v) => ({ ...v, amount: e.target.value, fraction: '' }))} type="number" step="0.00000001" min="0" placeholder="Amount (optional)" className="rounded-xl bg-surface-dark border border-surface-border px-3 py-2 text-sm text-white font-mono" />
            <input value={closeForm.fraction} onChange={(e) => setCloseForm((v) => ({ ...v, fraction: e.target.value, amount: '' }))} type="number" step="0.0001" min="0" max="1" placeholder="Fraction 0-1 (optional)" className="rounded-xl bg-surface-dark border border-surface-border px-3 py-2 text-sm text-white font-mono" />
            {closeForm.order_type === 'limit' ? (
              <input value={closeForm.price} onChange={(e) => setCloseForm((v) => ({ ...v, price: e.target.value }))} type="number" step="0.00000001" min="0" placeholder="Limit price" className="rounded-xl bg-surface-dark border border-surface-border px-3 py-2 text-sm text-white font-mono sm:col-span-2" />
            ) : null}
          </div>
          <button type="button" disabled={busy} onClick={closePosition} className="mt-3 px-4 py-2 rounded-xl bg-red-500/15 border border-red-500/30 text-red-300 text-sm font-bold disabled:opacity-40">
            Close position
          </button>
        </div>
      </div>

      <div>
        <div className="px-4 py-3 border-b border-surface-border flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs font-extrabold text-white/50 uppercase tracking-wider">Live open positions</p>
          <div className="flex flex-wrap items-center gap-3">
            {positions.length > 0 ? (
              <button
                type="button"
                disabled={busy}
                onClick={closeAllAtMarket}
                className="px-3 py-1.5 rounded-lg bg-red-500/15 border border-red-500/35 text-red-300 text-xs font-bold disabled:opacity-40"
              >
                Close all (market)
              </button>
            ) : null}
            <p className="text-xs text-white/50">Last update: {updatedAt ? new Date(updatedAt).toLocaleTimeString() : '—'}</p>
          </div>
        </div>
        <AdminDataTable minWidth="1000px">
          <thead>
            <tr>
              <th>Symbol</th>
              <th className="text-right">Amount</th>
              <th className="text-right">Available</th>
              <th className="text-right">Locked</th>
              <th className="text-right">Avg cost</th>
              <th className="text-right">Mark</th>
              <th className="text-right">Market value</th>
              <th className="text-right">U.P&amp;L</th>
              <th className="text-right whitespace-nowrap">Action</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={9} className="text-center text-white/45 py-10">Loading live positions…</td></tr>
            ) : positions.length === 0 ? (
              <tr><td colSpan={9} className="text-center text-white/45 py-10">No open positions.</td></tr>
            ) : (
              positions.map((p) => (
                <tr key={p.symbol}>
                  <td>
                    <span className="inline-flex items-center gap-2 font-mono font-bold text-gold-light/80">
                      <CoinAvatar symbol={p.symbol} className="h-6 w-6" />
                      {p.symbol}
                    </span>
                  </td>
                  <td className="text-right font-mono">{Number(p.amount || 0).toFixed(8)}</td>
                  <td className="text-right font-mono text-green-400">{Number(p.available || 0).toFixed(8)}</td>
                  <td className="text-right font-mono text-gold-light/85">{Number(p.locked || 0).toFixed(8)}</td>
                  <td className="text-right font-mono">{Number(p.avg_cost || 0).toFixed(8)}</td>
                  <td className="text-right font-mono">{Number(p.current_price || 0).toFixed(8)}</td>
                  <td className="text-right font-mono">{Number(p.market_value_usdt || 0).toFixed(4)}</td>
                  <td className={`text-right font-mono ${Number(p.unrealized_pnl || 0) >= 0 ? 'text-green-400' : 'text-red-300'}`}>{Number(p.unrealized_pnl || 0).toFixed(4)}</td>
                  <td className="text-right">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => closeRowAtMarket(p.symbol)}
                      className="px-2.5 py-1 rounded-lg bg-red-500/15 border border-red-500/30 text-red-300 text-[11px] font-bold whitespace-nowrap disabled:opacity-40"
                    >
                      Market close
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </AdminDataTable>
      </div>
      <ConfirmModal
        open={closeConfirm.open}
        title={closeConfirm.kind === 'single' ? 'Market-close position' : 'Market-close all positions'}
        message={closeConfirm.kind === 'single'
          ? `Market-close the entire ${closeConfirm.symbol} position for this user?`
          : `Market-close all ${positions.length} open position(s) for this user?`}
        confirmText={closeConfirm.kind === 'single' ? 'Close position' : 'Close all'}
        danger
        busy={busy}
        onClose={() => { if (!busy) setCloseConfirm({ open: false, kind: '', symbol: '' }); }}
        onConfirm={confirmMarketClose}
      />
    </div>
  );
}

function UserAnalyticsPanel({ uid }) {
  const [a, setA] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  useEffect(() => {
    let ok = true;
    setLoading(true);
    setErr('');
    api.userTradingAnalytics(uid)
      .then(async r => {
        if (!ok) return;
        if (!r.ok) {
          setErr('Could not load analytics');
          setA(null);
          return;
        }
        setA(await r.json());
      })
      .catch(() => {
        if (ok) {
          setErr('Could not load analytics');
          setA(null);
        }
      })
      .finally(() => { if (ok) setLoading(false); });
    return () => { ok = false; };
  }, [uid]);

  if (loading) {
    return <div className="text-white/45 py-12 text-center">Loading trading analytics…</div>;
  }
  if (err || !a) {
    return <p className="text-red-400">{err || 'No data'}</p>;
  }

  const fmt = n => (typeof n === 'number' && !Number.isNaN(n) ? n.toFixed(4) : '—');
  const pnlClass = v => (v > 0 ? 'text-emerald-400' : v < 0 ? 'text-red-400' : 'text-white/70');

  return (
    <div className="space-y-6">
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="rounded-2xl border border-surface-border bg-surface-card p-4">
          <p className="text-[11px] font-extrabold text-white/45 uppercase tracking-wider mb-1">Realized P&amp;L (USDT)</p>
          <p className={`text-xl font-extrabold font-mono ${pnlClass(a.realized_pnl_usdt)}`}>{fmt(a.realized_pnl_usdt)}</p>
        </div>
        <div className="rounded-2xl border border-surface-border bg-surface-card p-4">
          <p className="text-[11px] font-extrabold text-white/45 uppercase tracking-wider mb-1">Unrealized (mark)</p>
          <p className={`text-xl font-extrabold font-mono ${pnlClass(a.unrealized_pnl_usdt)}`}>{fmt(a.unrealized_pnl_usdt)}</p>
        </div>
        <div className="rounded-2xl border border-surface-border bg-surface-card p-4">
          <p className="text-[11px] font-extrabold text-white/45 uppercase tracking-wider mb-1">Combined estimate</p>
          <p className={`text-xl font-extrabold font-mono ${pnlClass(a.combined_pnl_estimate_usdt)}`}>{fmt(a.combined_pnl_estimate_usdt)}</p>
        </div>
        <div className="rounded-2xl border border-surface-border bg-surface-card p-4">
          <p className="text-[11px] font-extrabold text-white/45 uppercase tracking-wider mb-1">Volume (notional)</p>
          <p className="text-xl font-extrabold font-mono text-white">{fmt(a.volume_notional_usdt)}</p>
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <div className="rounded-2xl border border-surface-border bg-surface-card p-4">
          <p className="text-xs font-extrabold text-white/50 uppercase tracking-wider mb-3">Sell fills (realized legs)</p>
          <ul className="text-sm text-white/80 space-y-1 font-mono">
            <li>Total fills: {a.trade_fill_count}</li>
            <li>Sell fills: {a.sell_fill_count}</li>
            <li className="text-emerald-400/90">Winning: {a.winning_sell_fills}</li>
            <li className="text-red-400/90">Losing: {a.losing_sell_fills}</li>
            <li className="text-white/50">Breakeven: {a.breakeven_sell_fills}</li>
          </ul>
        </div>
        <div className="rounded-2xl border border-surface-border bg-surface-card p-4">
          <p className="text-xs font-extrabold text-white/50 uppercase tracking-wider mb-3">Fees paid (all fills)</p>
          {(a.fees_by_asset || []).length === 0 ? (
            <p className="text-white/45 text-sm">No fee rows</p>
          ) : (
            <ul className="text-sm font-mono space-y-1">
              {a.fees_by_asset.map(f => (
                <li key={f.asset} className="flex justify-between items-center gap-2 text-white/80">
                  <span className="inline-flex items-center gap-2">
                    <CoinAvatar asset={f.asset} className="h-5 w-5" />
                    {f.asset}
                  </span>
                  <span>{Number(f.total).toFixed(8)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div>
        <p className="text-xs font-extrabold text-white/50 uppercase tracking-wider px-4 pt-4 mb-2">Realized P&amp;L by symbol</p>
        <AdminDataTable minWidth="360px">
          <thead>
            <tr>
              <th>Symbol</th>
              <th className="text-right">Realized USDT</th>
            </tr>
          </thead>
          <tbody>
            {(a.realized_pnl_by_symbol || []).length === 0 ? (
              <tr><td colSpan={2} className="text-center text-white/45 py-8">No realized sells yet</td></tr>
            ) : (
              a.realized_pnl_by_symbol.map(row => (
                <tr key={row.symbol}>
                  <td>
                    <span className="inline-flex items-center gap-2 font-mono font-bold text-gold-light/80">
                      <CoinAvatar symbol={row.symbol} className="h-6 w-6" />
                      {row.symbol}
                    </span>
                  </td>
                  <td className={`text-right font-mono ${pnlClass(row.realized_pnl)}`}>{fmt(row.realized_pnl)}</td>
                </tr>
              ))
            )}
          </tbody>
        </AdminDataTable>
      </div>

      <div>
        <p className="text-xs font-extrabold text-white/50 uppercase tracking-wider px-4 pt-4 mb-2">Open positions (unrealized)</p>
        <AdminDataTable minWidth="720px">
          <thead>
            <tr>
              <th>Symbol</th>
              <th className="text-right">Qty</th>
              <th className="text-right">Avg cost</th>
              <th className="text-right">Mark</th>
              <th className="text-right">U.P&amp;L</th>
            </tr>
          </thead>
          <tbody>
            {(a.open_positions || []).length === 0 ? (
              <tr><td colSpan={5} className="text-center text-white/45 py-8">No open spot positions</td></tr>
            ) : (
              a.open_positions.map(p => (
                <tr key={p.symbol}>
                  <td>
                    <span className="inline-flex items-center gap-2 font-mono">
                      <CoinAvatar symbol={p.symbol} className="h-6 w-6" />
                      {p.symbol}
                    </span>
                  </td>
                  <td className="text-right font-mono">{Number(p.amount).toFixed(8)}</td>
                  <td className="text-right font-mono">{Number(p.avg_cost).toFixed(8)}</td>
                  <td className="text-right font-mono">{Number(p.current_price).toFixed(8)}</td>
                  <td className={`text-right font-mono ${pnlClass(p.unrealized_pnl)}`}>{fmt(p.unrealized_pnl)}</td>
                </tr>
              ))
            )}
          </tbody>
        </AdminDataTable>
      </div>

      <p className="text-[11px] text-white/40 leading-relaxed">{a.methodology}</p>
    </div>
  );
}

function UserOrdersPanel({ uid }) {
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [skip, setSkip] = useState(0);
  const [status, setStatus] = useState('');
  const limit = 25;
  const [loading, setLoading] = useState(true);
  const { sortBy, sortDir, sortParams, toggleSort: _toggleSort } = useListSort('created_at', 'desc');
  const toggleSort = useCallback((key) => {
    setSkip(0);
    _toggleSort(key);
  }, [_toggleSort]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = { skip: String(skip), limit: String(limit) };
      if (status) params.status = status;
      Object.assign(params, sortParams);
      const r = await api.userOrders(uid, params);
      if (!r.ok) throw new Error('load');
      const d = await r.json();
      setItems(d.items || []);
      setTotal(d.total ?? 0);
    } catch {
      setItems([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [uid, skip, status, sortParams]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div>
      <div className="flex gap-3 mb-4">
        <select
          value={status}
          onChange={e => { setSkip(0); setStatus(e.target.value); }}
          className="rounded-xl bg-surface-card border border-surface-border px-4 py-2 text-white text-sm font-bold"
        >
          <option value="">All statuses</option>
          <option value="open">open</option>
          <option value="partially_filled">partially_filled</option>
          <option value="filled">filled</option>
          <option value="cancelled">cancelled</option>
        </select>
      </div>
      <AdminDataTable minWidth="900px">
          <thead>
            <tr>
              <SortableTh sortKey="id" activeKey={sortBy} dir={sortDir} onSort={toggleSort}>ID</SortableTh>
              <SortableTh sortKey="symbol" activeKey={sortBy} dir={sortDir} onSort={toggleSort}>Symbol</SortableTh>
              <SortableTh sortKey="side" activeKey={sortBy} dir={sortDir} onSort={toggleSort}>Side</SortableTh>
              <SortableTh sortKey="type" activeKey={sortBy} dir={sortDir} onSort={toggleSort}>Type</SortableTh>
              <SortableTh sortKey="status" activeKey={sortBy} dir={sortDir} onSort={toggleSort}>Status</SortableTh>
              <SortableTh sortKey="price" activeKey={sortBy} dir={sortDir} onSort={toggleSort} align="right">Price</SortableTh>
              <SortableTh sortKey="amount" activeKey={sortBy} dir={sortDir} onSort={toggleSort} align="right">Amount</SortableTh>
              <th className="text-right">Filled</th>
              <SortableTh sortKey="created_at" activeKey={sortBy} dir={sortDir} onSort={toggleSort}>Created</SortableTh>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={9} className="text-center text-white/45 py-12">Loading…</td></tr>
            ) : items.length === 0 ? (
              <tr><td colSpan={9} className="text-center text-white/45 py-12">No orders.</td></tr>
            ) : (
              items.map(o => (
                <tr key={o.id}>
                  <td className="font-mono text-[11px] text-white/70">{o.id}</td>
                  <td>
                    <span className="inline-flex items-center gap-2 font-mono">
                      <CoinAvatar symbol={o.symbol} className="h-6 w-6" />
                      {o.symbol}
                    </span>
                  </td>
                  <td>{o.side}</td>
                  <td>{o.type}</td>
                  <td>{o.status}</td>
                  <td className="text-right font-mono">{Number(o.price || 0).toFixed(8)}</td>
                  <td className="text-right font-mono">{Number(o.amount).toFixed(8)}</td>
                  <td className="text-right font-mono">{Number(o.filled || 0).toFixed(8)}</td>
                  <td className="text-[11px] text-white/50">{o.created_at ? new Date(o.created_at).toLocaleString() : '—'}</td>
                </tr>
              ))
            )}
          </tbody>
      </AdminDataTable>
      {total > limit && (
        <p className="text-white/50 text-sm mt-3">
          Showing {skip + 1}–{Math.min(skip + limit, total)} of {total}
          <button type="button" disabled={skip <= 0} onClick={() => setSkip(s => Math.max(0, s - limit))} className="ml-3 text-gold-light font-bold disabled:opacity-40">Prev</button>
          <button type="button" disabled={skip + limit >= total} onClick={() => setSkip(s => s + limit)} className="ml-2 text-gold-light font-bold disabled:opacity-40">Next</button>
        </p>
      )}
    </div>
  );
}

function UserReferralPanel({ uid }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setErr('');
    try {
      const r = await api.userReferrals(uid);
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.detail || 'Could not load referral data');
      setData(j);
    } catch (e) {
      setErr(e.message);
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [uid]);

  useEffect(() => {
    load();
  }, [load]);

  const copyCode = () => {
    if (!data?.referral_code) return;
    navigator.clipboard?.writeText(data.referral_code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  if (loading) return <p className="text-white/55 text-sm">Loading…</p>;
  if (err) return <p className="text-red-400 text-sm">{err}</p>;
  if (!data) return null;

  const summary = data.summary || {};
  const referrals = data.referrals || [];
  const rootUser = data.root || { uid, name: '', email: '', avatar_url: '' };

  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-surface-border bg-surface-card p-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-[11px] font-extrabold text-white/40 uppercase tracking-wider mb-1">Referral code</p>
            <div className="flex items-center gap-2">
              <span className="text-lg font-mono font-extrabold text-gold-light">{data.referral_code}</span>
              <button
                type="button"
                onClick={copyCode}
                className="p-1.5 rounded-lg border border-surface-border text-white/60 hover:text-white"
                title="Copy code"
              >
                {copied ? <Check size={14} /> : <Copy size={14} />}
              </button>
            </div>
          </div>
          <div>
            <p className="text-[11px] font-extrabold text-white/40 uppercase tracking-wider mb-1">Referred by (upline)</p>
            {data.referred_by ? (
              <Link
                to={`/users/${encodeURIComponent(data.referred_by.uid)}`}
                className="text-sm font-bold text-white hover:text-gold-light"
              >
                {data.referred_by.name || data.referred_by.email || data.referred_by.uid}
              </Link>
            ) : (
              <span className="text-sm text-white/50">No sponsor (direct signup)</span>
            )}
          </div>
          <div className="flex gap-6">
            <div>
              <p className="text-[11px] font-extrabold text-white/40 uppercase tracking-wider mb-1">Direct referrals</p>
              <p className="text-lg font-extrabold text-white">{summary.direct_referral_count ?? 0}</p>
            </div>
            <div>
              <p className="text-[11px] font-extrabold text-white/40 uppercase tracking-wider mb-1">Total downstream</p>
              <p className="text-lg font-extrabold text-white">{summary.total_referral_count ?? 0}</p>
            </div>
            <div>
              <p className="text-[11px] font-extrabold text-white/40 uppercase tracking-wider mb-1">Total earned</p>
              <p className="text-lg font-extrabold text-gold-light">{Number(summary.total_earned_ibo || 0).toFixed(4)} Delta</p>
            </div>
            <div>
              <p className="text-[11px] font-extrabold text-white/40 uppercase tracking-wider mb-1">Pending (awaiting KYC)</p>
              <p className="text-lg font-extrabold text-gold">{Number(summary.total_pending_ibo || 0).toFixed(4)} Delta</p>
            </div>
          </div>
        </div>
      </div>

      <div>
        <div className="px-5 py-3 border-b border-surface-border">
          <h3 className="text-sm font-extrabold text-white/90 uppercase tracking-wide">Per-level breakdown</h3>
        </div>
        <AdminDataTable>
          <thead>
            <tr>
              <th>Level</th>
              <th>Reward / referral</th>
              <th>Referral count</th>
              <th>Earned (Delta)</th>
              <th>Pending (Delta)</th>
            </tr>
          </thead>
          <tbody>
            {(summary.levels || []).map((lvl) => (
              <tr key={lvl.level}>
                <td className="font-bold text-white">L{lvl.level}</td>
                <td className="text-white/75">{Number(lvl.amount_ibo || 0).toFixed(4)} Delta</td>
                <td className="text-white/75">{lvl.referral_count ?? 0}</td>
                <td className="text-gold-light font-semibold">{Number(lvl.earned_ibo || 0).toFixed(4)}</td>
                <td className="text-gold font-semibold">{Number(lvl.pending_ibo || 0).toFixed(4)}</td>
              </tr>
            ))}
          </tbody>
        </AdminDataTable>
      </div>

      <div className="rounded-2xl border border-surface-border bg-surface-card overflow-hidden">
        <div className="px-5 py-3 border-b border-surface-border flex items-center justify-between">
          <h3 className="text-sm font-extrabold text-white/90 uppercase tracking-wide">Referral network</h3>
          <Link
            to={`/referrals?q=${encodeURIComponent(uid)}`}
            className="inline-flex items-center gap-1.5 text-xs font-bold text-gold-light hover:underline"
          >
            <Users size={14} /> Open full tree view
          </Link>
        </div>
        <div className="p-4">
          <AdminReferralNetworkTree
            rootUser={rootUser}
            referrals={referrals}
            summary={summary}
          />
        </div>
      </div>
    </div>
  );
}

function UserTradesPanel({ uid }) {
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [skip, setSkip] = useState(0);
  const [symbol, setSymbol] = useState('');
  const limit = 25;
  const [loading, setLoading] = useState(true);
  const { sortBy, sortDir, sortParams, toggleSort: _toggleSort } = useListSort('created_at', 'desc');
  const toggleSort = useCallback((key) => {
    setSkip(0);
    _toggleSort(key);
  }, [_toggleSort]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = { skip: String(skip), limit: String(limit) };
      if (symbol.trim()) params.symbol = symbol.trim().toUpperCase();
      Object.assign(params, sortParams);
      const r = await api.userTrades(uid, params);
      if (!r.ok) throw new Error('load');
      const d = await r.json();
      setItems(d.items || []);
      setTotal(d.total ?? 0);
    } catch {
      setItems([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [uid, skip, symbol, sortParams]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div>
      <div className="flex gap-3 mb-4">
        <input
          value={symbol}
          onChange={e => { setSkip(0); setSymbol(e.target.value); }}
          placeholder="Filter symbol"
          className="rounded-xl bg-surface-card border border-surface-border px-4 py-2 text-white text-sm font-mono uppercase flex-1 max-w-xs"
        />
      </div>
      <AdminDataTable minWidth="880px">
          <thead>
            <tr>
              <SortableTh sortKey="created_at" activeKey={sortBy} dir={sortDir} onSort={toggleSort}>Time</SortableTh>
              <SortableTh sortKey="symbol" activeKey={sortBy} dir={sortDir} onSort={toggleSort}>Symbol</SortableTh>
              <SortableTh sortKey="price" activeKey={sortBy} dir={sortDir} onSort={toggleSort} align="right">Price</SortableTh>
              <SortableTh sortKey="amount" activeKey={sortBy} dir={sortDir} onSort={toggleSort} align="right">Amount</SortableTh>
              <th>Role</th>
              <th>Fees</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} className="text-center text-white/45 py-12">Loading…</td></tr>
            ) : items.length === 0 ? (
              <tr><td colSpan={6} className="text-center text-white/45 py-12">No trades.</td></tr>
            ) : (
              items.map(t => {
                const isTaker = t.taker_uid === uid;
                return (
                  <tr key={t.id}>
                    <td className="text-[11px] text-white/55 whitespace-nowrap">{t.created_at ? new Date(t.created_at).toLocaleString() : '—'}</td>
                    <td>
                      <span className="inline-flex items-center gap-2 font-mono font-bold text-gold-light/80">
                        <CoinAvatar symbol={t.symbol} className="h-6 w-6" />
                        {t.symbol}
                      </span>
                    </td>
                    <td className="text-right font-mono">{Number(t.price).toFixed(8)}</td>
                    <td className="text-right font-mono">{Number(t.amount).toFixed(8)}</td>
                    <td className="text-xs">{isTaker ? `Taker (${t.taker_side})` : `Maker (${t.maker_side})`}</td>
                    <td className="text-[11px] font-mono text-white/60">
                      {isTaker
                        ? `${Number(t.taker_fee || 0).toFixed(6)} ${t.taker_fee_asset || ''}`
                        : `${Number(t.maker_fee || 0).toFixed(6)} ${t.maker_fee_asset || ''}`}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
      </AdminDataTable>
      {total > limit && (
        <p className="text-white/50 text-sm mt-3">
          Showing {skip + 1}–{Math.min(skip + limit, total)} of {total}
          <button type="button" disabled={skip <= 0} onClick={() => setSkip(s => Math.max(0, s - limit))} className="ml-3 text-gold-light font-bold disabled:opacity-40">Prev</button>
          <button type="button" disabled={skip + limit >= total} onClick={() => setSkip(s => s + limit)} className="ml-2 text-gold-light font-bold disabled:opacity-40">Next</button>
        </p>
      )}
    </div>
  );
}

function UserMoneyPanel({ uid }) {
  const [deps, setDeps] = useState([]);
  const [inrDeps, setInrDeps] = useState([]);
  const [inrWds, setInrWds] = useState([]);
  const [wds, setWds] = useState([]);
  const [loading, setLoading] = useState(true);

  const [crediting, setCrediting] = useState('');  // event id currently being credited
  const [creditError, setCreditError] = useState('');
  const [creditPrompt, setCreditPrompt] = useState(null);

  const reload = useCallback(() => {
    let ok = true;
    setLoading(true);
    Promise.all([
      api.depositEvents({ uid, limit: '30', skip: '0' }).then(r => (r.ok ? r.json() : { items: [] })),
      api.inrDeposits({ uid, limit: '30', skip: '0' }).then(r => (r.ok ? r.json() : { items: [] })),
      api.inrWithdrawals({ uid, limit: '30', skip: '0' }).then(r => (r.ok ? r.json() : { items: [] })),
      api.withdrawals({ uid, limit: '30', skip: '0' }).then(r => (r.ok ? r.json() : { items: [] })),
    ]).then(([d, inr, inrWd, w]) => {
      if (!ok) return;
      setDeps(d.items || []);
      setInrDeps(inr.items || []);
      setInrWds(inrWd.items || []);
      setWds(w.items || []);
    }).finally(() => { if (ok) setLoading(false); });
    return () => { ok = false; };
  }, [uid]);

  useEffect(() => {
    const cleanup = reload();
    return cleanup;
  }, [reload]);

  // Phase 5 — manual credit override. Calls the backend, then reloads the
  // row list so the updated status (credited / 12/12) is reflected. We
  // don't optimistically mutate local state because the backend also
  // writes ``credited_amount``, ``wallet_txn_id``, etc.
  const handleCredit = useCallback(async (ev, noteValue = '') => {
    if (!ev?.id) return;
    const note = String(noteValue || '').trim();
    setCrediting(ev.id);
    setCreditError('');
    try {
      const res = await api.creditDepositEvent(ev.id, {
        note: (note || '').trim() || undefined,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.detail || `HTTP ${res.status}`);
      reload();
    } catch (e) {
      setCreditError(e.message || 'Manual credit failed');
    } finally {
      setCrediting('');
    }
  }, [reload]);

  if (loading) {
    return <div className="text-white/45 py-12 text-center">Loading…</div>;
  }

  const canCredit = (s) =>
    ['pending', 'confirming', 'pending_kyc', 'below_min'].includes(String(s || '').toLowerCase());

  return (
    <div className="space-y-6">
    <div className="grid lg:grid-cols-2 gap-6">
      <div>
        <h3 className="text-sm font-extrabold text-white/80 uppercase tracking-wider mb-2">On-chain deposits</h3>
        {creditError && (
          <div className="mb-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-200">
            {creditError}
          </div>
        )}
        <AdminDataTable>
            <thead>
              <tr>
                <th>When</th>
                <th>Asset</th>
                <th className="text-right">Amt</th>
                <th>Conf</th>
                <th>St</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {deps.length === 0 ? (
                <tr><td colSpan={6} className="text-center text-white/40 py-6">None</td></tr>
              ) : deps.map(d => {
                const isBonus = d.source === 'signup_bonus';
                return (
                <tr key={d.id} className={isBonus ? 'bg-gold/5' : undefined}>
                  <td className="text-white/55 whitespace-nowrap">{d.created_at ? new Date(d.created_at).toLocaleString() : '—'}</td>
                  <td className="font-bold">
                    {isBonus ? (
                      <span className="inline-flex items-center gap-1 text-gold-light">
                        <CoinAvatar asset={d.asset} className="h-5 w-5" />
                        🎁 {d.asset} bonus
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5">
                        <CoinAvatar asset={d.asset} className="h-5 w-5" />
                        {d.asset}
                      </span>
                    )}
                  </td>
                  <td className="text-right font-mono text-green-400">{Number(d.amount).toFixed(4)}</td>
                  <td className="font-mono text-white/70 whitespace-nowrap">
                    {Number(d.threshold) > 0
                      ? `${Math.min(Number(d.confirmations || 0), Number(d.threshold))}/${Number(d.threshold)}`
                      : Number(d.confirmations || 0)}
                  </td>
                  <td className="whitespace-nowrap">{d.status}</td>
                  <td className="text-right">
                    {canCredit(d.status) && !isBonus && (
                      <button
                        type="button"
                        onClick={() => {
                          const obs = Number(d.amount || 0).toFixed(8).replace(/0+$/, '').replace(/\.$/, '');
                          setCreditPrompt({ ev: d, note: '', obs });
                        }}
                        disabled={crediting === d.id}
                        className="px-2 py-1 text-[11px] font-bold rounded-md border border-gold/40 text-gold-light hover:bg-gold/10 disabled:opacity-50"
                        title="Manually credit this sighting (wallet + ledger)"
                      >
                        {crediting === d.id ? 'Crediting…' : 'Credit'}
                      </button>
                    )}
                  </td>
                </tr>
                );
              })}
            </tbody>
        </AdminDataTable>
      </div>
      <div>
        <h3 className="text-sm font-extrabold text-white/80 uppercase tracking-wider mb-2">Recent withdrawals</h3>
        <p className="text-[11px] text-white/45 mb-2">
          <Link to={`/withdrawals?uid=${encodeURIComponent(uid)}`} className="text-gold-light font-bold hover:underline">Open withdrawal queue</Link>
          {' '}for approve / hold / reject.
        </p>
        <AdminDataTable>
            <thead>
              <tr>
                <th>When</th>
                <th>Asset</th>
                <th className="text-right">Amt</th>
                <th>St</th>
                <th>To</th>
              </tr>
            </thead>
            <tbody>
              {wds.length === 0 ? (
                <tr><td colSpan={5} className="text-center text-white/40 py-6">None</td></tr>
              ) : wds.map((w) => {
                const addr = String(w.address || '');
                const short = addr.length > 18 ? `${addr.slice(0, 10)}…${addr.slice(-6)}` : addr || '—';
                const flags = Array.isArray(w.risk_flags) ? w.risk_flags.filter(Boolean).join(', ') : '';
                return (
                  <tr key={w.id}>
                    <td className="text-white/55 whitespace-nowrap">{w.created_at ? new Date(w.created_at).toLocaleString() : '—'}</td>
                    <td className="font-bold">
                      <span className="inline-flex items-center gap-1.5">
                        <CoinAvatar asset={w.asset} className="h-5 w-5" />
                        {w.asset}
                      </span>
                    </td>
                    <td className="text-right font-mono text-gold-light/90">{Number(w.amount ?? w.net_amount ?? 0).toFixed(4)}</td>
                    <td className="whitespace-nowrap">
                      <span className="font-mono">{w.status}</span>
                      {flags ? <span className="block text-[10px] text-rose-300/90 mt-0.5">{flags}</span> : null}
                    </td>
                    <td className="font-mono text-white/60 break-all max-w-[140px]" title={addr}>{short}</td>
                  </tr>
                );
              })}
            </tbody>
        </AdminDataTable>
      </div>
      <ConfirmModal
        open={!!creditPrompt}
        title="Manual credit override"
        message={creditPrompt ? `Manually credit ${creditPrompt.obs} ${creditPrompt.ev?.asset} to this user?` : ''}
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

      <div>
        <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
          <h3 className="text-sm font-extrabold text-white/80 uppercase tracking-wider">INR (₹) deposits</h3>
          <Link
            to={`/inr-deposits?uid=${encodeURIComponent(uid)}`}
            className="text-[11px] font-bold text-gold-light hover:underline"
          >
            Open INR queue
          </Link>
        </div>
        <AdminDataTable>
            <thead>
              <tr>
                <th>When</th>
                <th className="text-right">INR</th>
                <th className="text-right">Delta</th>
                <th>UTR</th>
                <th>St</th>
              </tr>
            </thead>
            <tbody>
              {inrDeps.length === 0 ? (
                <tr><td colSpan={5} className="text-center text-white/40 py-6">None</td></tr>
              ) : inrDeps.map((d) => (
                <tr key={d.id}>
                  <td className="text-white/55 whitespace-nowrap">{d.created_at ? new Date(d.created_at).toLocaleString() : '—'}</td>
                  <td className="text-right font-mono text-gold-light/90/90">{formatInrAmount(d.amount_inr)}</td>
                  <td className="text-right font-mono text-green-400/90">
                    {d.status === 'approved' && d.amount_ibo != null ? Number(d.amount_ibo).toFixed(4) : '—'}
                  </td>
                  <td className="font-mono text-white/60 max-w-[120px] truncate" title={d.utr_number}>{d.utr_number || '—'}</td>
                  <td className="whitespace-nowrap font-mono">{d.status}</td>
                </tr>
              ))}
            </tbody>
        </AdminDataTable>
      </div>

      <div>
        <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
          <h3 className="text-sm font-extrabold text-white/80 uppercase tracking-wider">INR sell / payouts</h3>
          <Link
            to={`/inr-withdrawals?uid=${encodeURIComponent(uid)}`}
            className="text-[11px] font-bold text-gold-light hover:underline"
          >
            Open INR payout queue
          </Link>
        </div>
        <AdminDataTable>
            <thead>
              <tr>
                <th>When</th>
                <th className="text-right">INR</th>
                <th className="text-right">Delta</th>
                <th>Payout UTR</th>
                <th>St</th>
              </tr>
            </thead>
            <tbody>
              {inrWds.length === 0 ? (
                <tr><td colSpan={5} className="text-center text-white/40 py-6">None</td></tr>
              ) : inrWds.map((w) => (
                <tr key={w.id}>
                  <td className="text-white/55 whitespace-nowrap">
                    {(w.reviewed_at || w.updated_at || w.created_at)
                      ? new Date(w.reviewed_at || w.updated_at || w.created_at).toLocaleString()
                      : '—'}
                  </td>
                  <td className="text-right font-mono text-gold-light/90/90">{formatInrAmount(w.amount_inr)}</td>
                  <td className="text-right font-mono text-gold-light/80">
                    {w.amount_ibo != null ? Number(w.amount_ibo).toFixed(4) : '—'}
                  </td>
                  <td className="font-mono text-white/60 max-w-[120px] truncate" title={w.payout_reference}>
                    {w.payout_reference || '—'}
                  </td>
                  <td className="whitespace-nowrap capitalize">
                    {ledgerStatusLabel({
                      status: w.status,
                      inr_request_status: w.status,
                      rejection_reason: w.rejection_reason,
                    })}
                  </td>
                </tr>
              ))}
            </tbody>
        </AdminDataTable>
      </div>
    </div>
  );
}

function UserLedgerPanel({ uid }) {
  const [mergedAll, setMergedAll] = useState([]);
  const [skip, setSkip] = useState(0);
  const limit = 40;
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  const load = useCallback(() => {
    let alive = true;
    setLoading(true);
    setErr('');
    Promise.all([
      api.userWalletTxns(uid, { skip: '0', limit: '250' }),
      api.inrDeposits({ uid, skip: '0', limit: '100' }),
      api.inrWithdrawals({ uid, skip: '0', limit: '100' }),
    ])
      .then(async ([wRes, inrRes, inrWdRes]) => {
        const wj = await wRes.json().catch(() => ({}));
        const ij = await inrRes.json().catch(() => ({}));
        const iwj = await inrWdRes.json().catch(() => ({}));
        if (!alive) return;
        if (!wRes.ok) {
          setErr(wj.detail || 'Could not load ledger');
          setMergedAll([]);
          return;
        }
        const rows = mergeLedgerWithInrDeposits(
          wj.items,
          inrRes.ok ? ij.items : [],
          inrWdRes.ok ? iwj.items : [],
        );
        setMergedAll(rows);
      })
      .catch(() => {
        if (!alive) return;
        setErr('Could not load ledger');
        setMergedAll([]);
      })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [uid]);

  useEffect(() => {
    const c = load();
    return c;
  }, [load]);

  const total = mergedAll.length;
  const items = mergedAll.slice(skip, skip + limit);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-white/55">
          Wallet ledger plus INR deposits and sell/payout requests (approved / rejected shown on outcome rows).
        </p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={load}
            disabled={loading}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border border-white/10 text-white/80 hover:bg-white/5 text-xs font-bold disabled:opacity-40"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh
          </button>
          <Link
            to={`/inr-deposits?uid=${encodeURIComponent(uid)}`}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border border-white/10 text-white/80 hover:bg-white/5 text-xs font-bold"
          >
            INR deposits
          </Link>
          <Link
            to={`/inr-withdrawals?uid=${encodeURIComponent(uid)}`}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border border-white/10 text-white/80 hover:bg-white/5 text-xs font-bold"
          >
            INR payouts
          </Link>
          <Link
            to={`/ledger?uid=${encodeURIComponent(uid)}`}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border border-gold/35 text-gold-light hover:bg-gold/10 text-xs font-bold"
          >
            Full explorer + CSV
          </Link>
        </div>
      </div>
      {err ? <div className="p-3 rounded-xl border border-rose-500/30 bg-rose-500/10 text-rose-300 text-sm">{err}</div> : null}
      <AdminDataTable minWidth="720px">
          <thead>
            <tr>
              <th>Time</th>
              <th>Asset</th>
              <th>Type</th>
              <th>Dir / status</th>
              <th className="text-right">Amount</th>
              <th>Reference</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} className="text-center text-white/45 py-10">Loading…</td></tr>
            ) : items.length === 0 ? (
              <tr><td colSpan={6} className="text-center text-white/45 py-10">No ledger rows.</td></tr>
            ) : (
              items.map((row) => {
                const isInrRequest = row._ledgerKind?.startsWith('inr_');
                const isInr =
                  isInrRequest
                  || row.ref_type === 'inr_deposit'
                  || row.ref_type === 'inr_withdrawal'
                  || isInrWithdrawalRow(row);
                return (
                <tr key={row.id}>
                  <td className="text-white/55 whitespace-nowrap">{row.created_at ? new Date(row.created_at).toLocaleString() : '—'}</td>
                  <td className="font-bold">
                    <span className="inline-flex items-center gap-1.5">
                      {row.asset !== 'INR' ? <CoinAvatar asset={row.asset} className="h-5 w-5" /> : null}
                      {row.asset}
                    </span>
                  </td>
                  <td className="font-mono text-white/75">{ledgerTypeLabel(row)}</td>
                  <td className="uppercase text-white/60 capitalize">
                    {isInrRequest || row.inr_request_status ? ledgerStatusLabel(row) : row.direction}
                  </td>
                  <td className="text-right font-mono text-white/85">{formatLedgerAmount(row)}</td>
                  <td className="min-w-0">
                    {isInr ? (
                      <InrLedgerRefCell row={row} />
                    ) : (
                      <span className="font-mono text-[11px] text-white/50 break-all">{formatWalletTxnRef(row)}</span>
                    )}
                  </td>
                </tr>
              );
              })
            )}
          </tbody>
      </AdminDataTable>
      {total > limit ? (
        <p className="text-white/50 text-sm">
          Showing {skip + 1}–{Math.min(skip + limit, total)} of {total}
          <button type="button" disabled={skip <= 0} onClick={() => setSkip(s => Math.max(0, s - limit))} className="ml-3 text-gold-light font-bold disabled:opacity-40">Prev</button>
          <button type="button" disabled={skip + limit >= total} onClick={() => setSkip(s => s + limit)} className="ml-2 text-gold-light font-bold disabled:opacity-40">Next</button>
        </p>
      ) : null}
    </div>
  );
}

function UserSessionsPanel({ uid }) {
  const [payload, setPayload] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  const load = useCallback(() => {
    let alive = true;
    setLoading(true);
    setErr('');
    api.userSessions(uid)
      .then(async (r) => {
        const j = await r.json().catch(() => ({}));
        if (!alive) return;
        if (!r.ok) {
          setErr(j.detail || 'Could not load sessions');
          setPayload(null);
          return;
        }
        setPayload(j);
      })
      .catch(() => {
        if (!alive) return;
        setErr('Could not load sessions');
        setPayload(null);
      })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [uid]);

  useEffect(() => {
    const c = load();
    return c;
  }, [load]);

  const rows = payload?.refresh_sessions || [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-white/55">
          Refresh-token sessions (JTI masked). Current <code className="font-mono text-xs text-white/70">sessions_epoch</code>
          {payload != null ? `: ${payload.sessions_epoch}` : ''}.
        </p>
        <button
          type="button"
          onClick={load}
          disabled={loading}
          className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border border-white/10 text-white/80 hover:bg-white/5 text-xs font-bold disabled:opacity-40"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>
      {err ? <div className="p-3 rounded-xl border border-rose-500/30 bg-rose-500/10 text-rose-300 text-sm">{err}</div> : null}
      <AdminDataTable minWidth="560px">
          <thead>
            <tr>
              <th>JTI (masked)</th>
              <th>Epoch</th>
              <th>Created</th>
              <th>Expires</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={4} className="text-center text-white/45 py-10">Loading…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={4} className="text-center text-white/45 py-10">No active refresh sessions.</td></tr>
            ) : (
              rows.map((s, i) => (
                <tr key={`${s.jti_masked}-${i}`}>
                  <td className="font-mono text-white/75">{s.jti_masked}</td>
                  <td className="font-mono">{s.epoch}</td>
                  <td className="text-white/55 whitespace-nowrap">{s.created_at ? new Date(s.created_at).toLocaleString() : '—'}</td>
                  <td className="text-white/55 whitespace-nowrap">{s.expires_at ? new Date(s.expires_at).toLocaleString() : '—'}</td>
                </tr>
              ))
            )}
          </tbody>
      </AdminDataTable>
    </div>
  );
}
