import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Wallet, RefreshCw, AlertCircle, ChevronLeft, BookOpen, Snowflake, Flame,
  ArrowDownToLine, ChevronDown, ShieldCheck, ShieldOff, ToggleLeft, ToggleRight,
  Info, CheckCircle2, Plus, Lock, X,
} from 'lucide-react';

/* ── Asset → Network catalogue ────────────────────────────────────────────
   Covers the most common chains an exchange handles. Admin can always pick
   "Other (custom)" at the bottom of either list to free-type anything.     */
// IMPORTANT: network names here must exactly match what the treasury registry
// uses. BNB Chain was previously called "Binance Smart Chain (BSC)". The
// canonical name used by this backend is "BEP-20 (BNB Chain)".
const ASSET_NETWORKS = {
  // Platform token — must use exactly "BEP-20 (BNB Chain)" for the treasury gate
  IBO:        ['BEP-20 (BNB Chain)'],
  BTC:        ['Bitcoin Network'],
  ETH:        ['ERC-20 (Ethereum)'],
  // BNB Chain = BSC = "BEP-20 (BNB Chain)"
  BNB:        ['BEP-20 (BNB Chain)'],
  USDT:       ['BEP-20 (BNB Chain)', 'ERC-20 (Ethereum)', 'TRC-20 (Tron)'],
  USDC:       ['ERC-20 (Ethereum)', 'BEP-20 (BNB Chain)'],
  TRX:        ['TRC-20 (Tron)'],
  MATIC:      ['Polygon (MATIC)'],
  SOL:        ['Solana'],
  XRP:        ['XRP Ledger'],
  DOGE:       ['Dogecoin'],
  LTC:        ['Litecoin'],
  ADA:        ['Cardano'],
  AVAX:       ['Avalanche C-Chain'],
  __custom__: [],
};
const ALL_ASSETS = Object.keys(ASSET_NETWORKS);

/* All unique networks, for the network dropdown when asset is custom */
const ALL_NETWORKS = [
  ...new Set(Object.values(ASSET_NETWORKS).flat()),
  'Other (custom)',
];
import { api } from '@/lib/api';
import { useAdminAuth } from '@/context/AdminAuthContext';
import { hasPermission } from '@/lib/adminAccess';
import { AdminPageHeader, AdminPanel } from '@/components/AdminPrimitives';
import { sweepPreviewIssue } from '@/lib/treasuryUx';

function fmtTs(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return String(iso);
  }
}

export default function TreasuryOmnibusWalletsPage() {
  const { admin } = useAdminAuth();
  const canManage = hasPermission(admin, 'manage_treasury');
  const canViewTreasury = hasPermission(admin, 'view_treasury');

  const [items, setItems] = useState([]);
  const [enabledHotCount, setEnabledHotCount] = useState(0);
  const [treasurySigners, setTreasurySigners] = useState({});
  const [treasuryColdSigner, setTreasuryColdSigner] = useState(null);
  const [allowedPairs, setAllowedPairs] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [assetFilter, setAssetFilter] = useState('');

  const [createOpen, setCreateOpen] = useState(false);
  const [createBusy, setCreateBusy] = useState(false);
  const [createForm, setCreateForm] = useState({
    role: 'hot',
    asset: 'IBO',
    network: 'BEP-20 (BNB Chain)',
    networkCustom: '',
    assetCustom: '',
    address: '',
    label: '',
    enabled: true,
    is_default_payout: false,
    idempotency_key: '',
  });

  const openCreateWallet = (preset = {}) => {
    setCreateForm((f) => ({
      ...f,
      role: preset.role || 'hot',
      asset: preset.asset || f.asset,
      network: preset.network || (ASSET_NETWORKS[preset.asset || f.asset]?.[0] ?? f.network),
      assetCustom: '',
      networkCustom: '',
      address: '',
      label: preset.label || '',
      enabled: true,
      is_default_payout: preset.role === 'cold' ? false : (preset.is_default_payout ?? true),
      idempotency_key: '',
    }));
    setCreateOpen(true);
  };

  const hotWalletCount = enabledHotCount;

  const [auditWalletId, setAuditWalletId] = useState(null);
  const [auditRows, setAuditRows] = useState([]);
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditErr, setAuditErr] = useState('');

  const [sweepAsset, setSweepAsset] = useState('');
  const [sweepNetwork, setSweepNetwork] = useState('');
  const [sweepLimit, setSweepLimit] = useState(30);
  const [sweepPlan, setSweepPlan] = useState([]);
  const [sweepPlanLoading, setSweepPlanLoading] = useState(false);
  const [sweepErr, setSweepErr] = useState('');
  const [sweepRunBusy, setSweepRunBusy] = useState(false);
  const [sweepLastRun, setSweepLastRun] = useState(null);
  const [sweepConfirmLive, setSweepConfirmLive] = useState(false);
  const [autoGasFund, setAutoGasFund] = useState(false);

  // Sweep history
  const [sweepHistory, setSweepHistory] = useState([]);
  const [sweepHistoryLoading, setSweepHistoryLoading] = useState(false);
  const [sweepHistoryTotal, setSweepHistoryTotal] = useState(0);
  const [sweepHistoryOffset, setSweepHistoryOffset] = useState(0);
  const [expandedRunId, setExpandedRunId] = useState(null);
  const [runDetail, setRunDetail] = useState({});

  // Live sweep enablement state (loaded from backend)
  const [liveStatus, setLiveStatus] = useState(null); // { env_flag_set, admin_panel_flag_set, effective }
  const [liveStatusLoading, setLiveStatusLoading] = useState(true);
  const [liveToggleBusy, setLiveToggleBusy] = useState(false);
  const [liveToggleMsg, setLiveToggleMsg] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setErr('');
    try {
      const params = { limit: '100' };
      if (roleFilter) params.role = roleFilter;
      if (assetFilter) params.asset = assetFilter;
      const r = await api.treasuryOmnibusWallets(params);
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.detail || `HTTP ${r.status}`);
      const loaded = Array.isArray(j.items) ? j.items : [];
      setItems(loaded);
      if (!roleFilter && !assetFilter) {
        setEnabledHotCount(loaded.filter((row) => row.role === 'hot' && row.enabled).length);
      }
      setTotal(Number(j.total) || 0);
      setAllowedPairs(Array.isArray(j.allowed_asset_networks) ? j.allowed_asset_networks : []);
      setTreasurySigners(j.treasury_signers && typeof j.treasury_signers === 'object' ? j.treasury_signers : {});
      setTreasuryColdSigner(j.treasury_cold_signer || null);
    } catch (e) {
      setErr(String(e?.message || e));
      setItems([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [roleFilter, assetFilter]);

  const loadLiveStatus = useCallback(async () => {
    setLiveStatusLoading(true);
    try {
      const r = await api.depositSweepLiveStatus();
      const j = await r.json().catch(() => ({}));
      if (r.ok) setLiveStatus(j);
    } catch { /* ignore */ }
    finally { setLiveStatusLoading(false); }
  }, []);

  const loadSweepHistory = useCallback(async (offset = 0) => {
    setSweepHistoryLoading(true);
    try {
      const r = await api.depositSweepHistory({ limit: 20, offset });
      const j = await r.json().catch(() => ({}));
      if (r.ok) {
        setSweepHistory(j.runs || []);
        setSweepHistoryTotal(j.total || 0);
        setSweepHistoryOffset(offset);
      }
    } catch { /* ignore */ }
    finally { setSweepHistoryLoading(false); }
  }, []);

  const loadRunDetail = async (runId) => {
    if (runDetail[runId]) { setExpandedRunId(runId); return; }
    try {
      const r = await api.depositSweepRunDetail(runId);
      const j = await r.json().catch(() => ({}));
      if (r.ok && j.run) {
        setRunDetail((prev) => ({ ...prev, [runId]: j.run }));
        setExpandedRunId(runId);
      }
    } catch { /* ignore */ }
  };

  useEffect(() => {
    load();
    loadLiveStatus();
    loadSweepHistory(0);
  }, [load, loadLiveStatus, loadSweepHistory]);

  const toggleLiveSweep = async () => {
    if (!canManage) return;
    const newVal = !(liveStatus?.admin_panel_flag_set ?? false);
    setLiveToggleBusy(true);
    setLiveToggleMsg('');
    setErr('');
    try {
      const r = await api.setDepositSweepLiveEnabled(newVal);
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.detail || `HTTP ${r.status}`);
      setLiveToggleMsg(newVal ? 'Live sweep enabled.' : 'Live sweep disabled.');
      await loadLiveStatus();
    } catch (e) {
      setErr(String(e?.message || e));
    } finally {
      setLiveToggleBusy(false);
    }
  };

  const openAudit = async (walletId) => {
    setAuditWalletId(walletId);
    setAuditErr('');
    setAuditLoading(true);
    setAuditRows([]);
    try {
      const r = await api.treasuryOmnibusWalletAudit(walletId, { limit: '50' });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.detail || `HTTP ${r.status}`);
      setAuditRows(Array.isArray(j.items) ? j.items : []);
    } catch (e) {
      setAuditErr(String(e?.message || e));
    } finally {
      setAuditLoading(false);
    }
  };

  const submitCreate = async (e) => {
    e.preventDefault();
    setCreateBusy(true);
    setErr('');
    try {
      const effectiveAsset = createForm.asset === '__custom__'
        ? (createForm.assetCustom || '').trim().toUpperCase()
        : createForm.asset.trim().toUpperCase();
      const effectiveNetwork = createForm.network === 'Other (custom)'
        ? (createForm.networkCustom || '').trim()
        : createForm.network.trim();
      if (!effectiveAsset) { setErr('Please enter a coin symbol.'); setCreateBusy(false); return; }
      if (!effectiveNetwork) { setErr('Please enter a network name.'); setCreateBusy(false); return; }
      const body = {
        role: createForm.role,
        asset: effectiveAsset,
        network: effectiveNetwork,
        address: createForm.address.trim(),
        label: createForm.label.trim() || null,
        enabled: createForm.enabled,
        is_default_payout: createForm.role === 'hot' && createForm.is_default_payout,
        idempotency_key: createForm.idempotency_key.trim() || null,
      };
      const r = await api.createTreasuryOmnibusWallet(body);
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.detail || `HTTP ${r.status}`);
      setCreateOpen(false);
      setCreateForm((f) => ({
        ...f,
        address: '',
        label: '',
        idempotency_key: '',
        is_default_payout: false,
        assetCustom: '',
        networkCustom: '',
      }));
      await load();
    } catch (e) {
      setErr(String(e?.message || e));
    } finally {
      setCreateBusy(false);
    }
  };

  const toggleEnabled = async (row) => {
    if (!canManage) return;
    setErr('');
    try {
      const r = await api.patchTreasuryOmnibusWallet(row.id, { enabled: !row.enabled });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.detail || `HTTP ${r.status}`);
      await load();
    } catch (e) {
      setErr(String(e?.message || e));
    }
  };

  const setDefaultPayout = async (row) => {
    if (!canManage || row.role !== 'hot') return;
    setErr('');
    try {
      const r = await api.patchTreasuryOmnibusWallet(row.id, { is_default_payout: true });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.detail || `HTTP ${r.status}`);
      await load();
    } catch (e) {
      setErr(String(e?.message || e));
    }
  };

  const sweepPreviewParams = () => {
    const p = { limit: String(Math.min(500, Math.max(1, Number(sweepLimit) || 30))) };
    if (sweepAsset.trim()) p.asset = sweepAsset.trim().toUpperCase();
    if (sweepNetwork.trim()) p.network = sweepNetwork.trim();
    return p;
  };

  const runSweepPreview = async () => {
    if (!canViewTreasury) return;
    setSweepPlanLoading(true);
    setSweepErr('');
    setSweepLastRun(null);
    try {
      const r = await api.treasuryDepositSweepsPreview(sweepPreviewParams());
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.detail || `HTTP ${r.status}`);
      setSweepPlan(Array.isArray(j.items) ? j.items : []);
    } catch (e) {
      setSweepErr(String(e?.message || e));
      setSweepPlan([]);
    } finally {
      setSweepPlanLoading(false);
    }
  };

  const runSweepExecute = async ({ dryRun, confirmLive }) => {
    if (!canManage) return;
    setSweepRunBusy(true);
    setSweepErr('');
    setSweepLastRun(null);
    try {
      const body = {
        dry_run: !!dryRun,
        confirm_live: !!confirmLive,
        auto_gas_fund: !dryRun && !!autoGasFund,
        limit: Math.min(500, Math.max(1, Number(sweepLimit) || 30)),
      };
      if (sweepAsset.trim()) body.asset = sweepAsset.trim().toUpperCase();
      if (sweepNetwork.trim()) body.network = sweepNetwork.trim();
      const r = await api.treasuryDepositSweepsRun(body);
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.detail || `HTTP ${r.status}`);
      setSweepLastRun(j);
      if (Array.isArray(j.run?.items)) setSweepPlan(j.run.items);
      // Refresh history so the new run appears at the top
      loadSweepHistory(0);
    } catch (e) {
      setSweepErr(String(e?.message || e));
    } finally {
      setSweepRunBusy(false);
    }
  };

  const effectiveCreateAsset = createForm.asset === '__custom__'
    ? (createForm.assetCustom || '').trim().toUpperCase()
    : createForm.asset;
  const expectedHotSigner = treasurySigners[effectiveCreateAsset] || null;
  const expectedColdSigner = effectiveCreateAsset === 'IBO' ? treasuryColdSigner : null;
  const requiredSigner = createForm.role === 'hot' ? expectedHotSigner : expectedColdSigner;
  const addressMismatch = requiredSigner
    && createForm.address.trim()
    && createForm.address.trim().toLowerCase() !== requiredSigner.toLowerCase();

  return (
    <div className="admin-page">
      <AdminPageHeader
        icon={Wallet}
        title="Hot & cold wallets"
        subtitle="Register the platform’s on-chain addresses. Hot = money the system can send from. Cold = long-term storage you track for records only."
        actions={(
          <div className="flex flex-wrap items-center gap-2">
            <Link
              to="/treasury"
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-surface-border text-sm font-bold text-white hover:border-gold/40"
            >
              <ChevronLeft size={16} /> Trading treasury (balances)
            </Link>
            <button
              type="button"
              onClick={() => load()}
              disabled={loading}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-surface-border text-sm font-bold text-white hover:border-gold/40 disabled:opacity-40"
            >
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh
            </button>
            {canManage && (
              <button
                type="button"
                onClick={() => openCreateWallet()}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-gold/90 text-surface-dark text-sm font-bold"
              >
                <Plus size={16} /> Add wallet address
              </button>
            )}
          </div>
        )}
      />

      {/* ── Permission notice (view-only admins) ───────────────────────── */}
      {!canManage && (
        <div className="mb-6 rounded-2xl border border-gold/30 bg-gold/10 px-5 py-4 flex items-start gap-3">
          <Lock size={18} className="text-gold shrink-0 mt-0.5" />
          <div className="text-sm text-gold-light/90/90 leading-relaxed">
            <p className="font-bold text-gold-light/90 mb-1">You can view this page but cannot add wallets</p>
            <p>
              The <strong>"Add wallet address"</strong> button requires the <code className="bg-black/20 px-1 rounded text-xs">manage_treasury</code> permission.
              Your role can view treasury data only. Ask a <strong>Super Admin</strong> or <strong>Finance</strong> admin to add the hot wallet, or grant you <code className="bg-black/20 px-1 rounded text-xs">manage_treasury</code> in Admin settings.
            </p>
          </div>
        </div>
      )}

      {/* ── Prominent setup card (manage_treasury admins) ──────────────── */}
      {canManage && (
        <div className={`mb-6 rounded-2xl border p-5 flex flex-wrap items-center justify-between gap-4 ${
          hotWalletCount === 0
            ? 'border-gold/40 bg-gradient-to-r from-gold/15 to-transparent'
            : 'border-surface-border bg-surface-card/50'
        }`}>
          <div className="flex items-start gap-3 min-w-0">
            <div className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 ${hotWalletCount === 0 ? 'bg-gold/20' : 'bg-white/10'}`}>
              <Flame size={22} className={hotWalletCount === 0 ? 'text-gold-light' : 'text-gold-light'} />
            </div>
            <div>
              <p className="text-base font-bold text-white">
                {hotWalletCount === 0 ? 'Step 1 — Add your first hot wallet' : 'Register a wallet address'}
              </p>
              <p className="text-sm text-white/60 mt-0.5 max-w-xl leading-relaxed">
                {hotWalletCount === 0
                  ? 'Before sweeps or withdrawals work, register the server payout address here as a Hot wallet. For IBO use coin IBO and network BEP-20 (BNB Chain).'
                  : `${hotWalletCount} active hot wallet${hotWalletCount > 1 ? 's' : ''} saved. Click below to add another (hot or cold).`}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => openCreateWallet({ asset: 'IBO', network: 'BEP-20 (BNB Chain)', role: 'hot' })}
            className="inline-flex items-center gap-2 px-5 py-3 rounded-xl bg-gold text-surface-dark text-sm font-extrabold shadow-lg hover:opacity-90 transition-opacity shrink-0"
          >
            <Plus size={18} />
            Add wallet address
          </button>
        </div>
      )}

      <div className="mb-6 rounded-2xl border border-gold/25 bg-gradient-to-br from-gold/[.07] to-transparent p-5">
        <h2 className="text-sm font-extrabold text-gold-light uppercase tracking-wide mb-3">How this works (simple)</h2>
        <ol className="list-decimal list-inside space-y-2 text-sm text-white/85 leading-relaxed">
          <li>
            <strong className="text-white">Users deposit</strong> to their own personal deposit address (created automatically). That is not this page.
          </li>
          <li>
            <strong className="text-white">Hot wallet</strong> is the address your <em>server</em> uses to pay withdrawals. You only save the <strong>public</strong> address here; the secret key stays on the server. The address you type must <strong>exactly match</strong> the server payout address, or withdrawals stay blocked.
          </li>
          <li>
            <strong className="text-white">Cold wallet</strong> is optional: a record of a safer / offline address for your team. It is <strong>not</strong> used for automatic payouts.
          </li>
          <li>
            <strong className="text-white">Optional sweep</strong> (below): move leftover coins from user deposit addresses into the hot wallet. Always preview first; live sends need extra confirmation.
          </li>
        </ol>
        <p className="mt-3 text-xs text-white/55">
          You can register any coin and network — BTC, ETH, BNB, USDT (BEP-20 / ERC-20 / TRC-20), and more, or type a custom one. If withdrawals are stuck open <Link to="/withdrawals" className="text-gold-light font-semibold hover:underline">Withdrawals</Link> and look for “Waiting: payout wallet”.
        </p>
      </div>

      {err && (
        <div className="mb-4 flex items-start gap-2 rounded-xl border border-red-500/25 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          <AlertCircle size={16} className="shrink-0 mt-0.5" /> {err}
        </div>
      )}

      <AdminPanel title="Coins you can add on this screen" className="mb-6">
        <p className="text-sm text-white/65 mb-3">
          You can only register addresses for the combinations below. (Balance display for these rows may come in a later update.)
        </p>
        <div className="flex flex-wrap gap-2">
          {allowedPairs.map((p) => (
            <span
              key={`${p.asset}-${p.network}`}
              className="text-xs font-mono px-3 py-1 rounded-lg bg-white/[.06] border border-white/10 text-gold-light"
            >
              {p.asset} · {p.network}
            </span>
          ))}
        </div>
      </AdminPanel>

      {canViewTreasury && (
        <AdminPanel
          title="Move deposits to the hot wallet (optional)"
          subtitle="Preview user deposit-address balances and sweep them to your hot wallet. Supported: ETH, USDT (ERC-20), IBO (BEP-20), USDT (BEP-20). Dry run saves a report without broadcasting. Token sweeps need a small amount of ETH/BNB gas on the deposit address — see instructions if gas is missing."
          className="mb-6"
        >
          {/* ── Live Sweep Toggle ─────────────────────────────────────────── */}
          <div className={`mb-5 rounded-xl border p-4 ${
            liveStatus?.effective
              ? 'border-emerald-500/40 bg-emerald-500/[.07]'
              : 'border-surface-border bg-white/[.03]'
          }`}>
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div className="flex items-start gap-3">
                {liveStatus?.effective
                  ? <ShieldCheck size={20} className="text-emerald-400 shrink-0 mt-0.5" />
                  : <ShieldOff size={20} className="text-white/35 shrink-0 mt-0.5" />
                }
                <div>
                  <p className={`text-sm font-bold ${liveStatus?.effective ? 'text-emerald-200' : 'text-white/70'}`}>
                    Live Sweep — {liveStatus?.effective ? 'ENABLED' : 'DISABLED'}
                    {liveStatusLoading && <span className="ml-2 text-xs text-white/30">Loading…</span>}
                  </p>
                  <p className="text-xs text-white/50 mt-0.5 max-w-lg leading-relaxed">
                    When enabled, clicking <strong className="text-white/70">"Send live sweep"</strong> broadcasts real on-chain transactions to move funds from user deposit addresses into the hot wallet.
                    When disabled, only Dry Run (no actual send) is possible.
                  </p>
                  {liveStatus && (
                    <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-[11px]">
                      <span className={`flex items-center gap-1 ${liveStatus.env_flag_set ? 'text-emerald-300' : 'text-white/30'}`}>
                        {liveStatus.env_flag_set ? <CheckCircle2 size={11} /> : <Info size={11} />}
                        Server env var ({liveStatus.env_flag_set ? 'ON' : 'OFF'})
                      </span>
                      <span className={`flex items-center gap-1 ${liveStatus.admin_panel_flag_set ? 'text-emerald-300' : 'text-white/30'}`}>
                        {liveStatus.admin_panel_flag_set ? <CheckCircle2 size={11} /> : <Info size={11} />}
                        Admin panel toggle ({liveStatus.admin_panel_flag_set ? 'ON' : 'OFF'})
                      </span>
                    </div>
                  )}
                  {liveToggleMsg && (
                    <p className="text-xs text-emerald-300 mt-1.5 flex items-center gap-1">
                      <CheckCircle2 size={11} /> {liveToggleMsg}
                    </p>
                  )}
                </div>
              </div>
              {canManage && (
                <button
                  type="button"
                  onClick={toggleLiveSweep}
                  disabled={liveToggleBusy || liveStatusLoading}
                  className={`flex items-center gap-2 px-4 py-2 rounded-xl border font-bold text-sm transition-colors disabled:opacity-40 shrink-0 ${
                    liveStatus?.admin_panel_flag_set
                      ? 'border-rose-500/40 bg-rose-500/10 text-rose-300 hover:bg-rose-500/15'
                      : 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/15'
                  }`}
                >
                  {liveStatus?.admin_panel_flag_set
                    ? <><ToggleRight size={16} /> Disable live sweep</>
                    : <><ToggleLeft size={16} /> Enable live sweep</>
                  }
                </button>
              )}
            </div>
            {liveStatus?.effective && (
              <div className="mt-3 rounded-lg border border-gold/25 bg-gold/10 px-3 py-2 text-xs text-gold-light/80 flex items-start gap-2">
                <AlertCircle size={13} className="shrink-0 mt-0.5 text-gold" />
                <span>
                  Live sweep is active. <strong>"Send live sweep"</strong> will broadcast real on-chain transactions.
                  Always run a <strong>Preview</strong> or <strong>Dry Run</strong> first to review the list before going live.
                </span>
              </div>
            )}
          </div>

          <div className="flex flex-wrap gap-3 mb-4 items-end">
            <label className="text-xs text-white/55 block">
              Coin (optional — leave blank for all)
              <select
                value={sweepAsset}
                onChange={(e) => {
                  const a = e.target.value;
                  setSweepAsset(a);
                  const nets = ASSET_NETWORKS[a] || [];
                  if (nets.length === 1) setSweepNetwork(nets[0]);
                  else setSweepNetwork('');
                }}
                className="mt-1 block w-36 bg-surface-card border border-surface-border rounded-xl px-3 py-2 text-sm text-white"
              >
                <option value="">All coins</option>
                {ALL_ASSETS.filter(a => a !== '__custom__').map((a) => (
                  <option key={a} value={a}>{a}</option>
                ))}
              </select>
            </label>
            <label className="text-xs text-white/55 block min-w-[10rem]">
              Network (optional — leave blank for all)
              {sweepAsset && (ASSET_NETWORKS[sweepAsset] || []).length > 0 ? (
                <select
                  value={sweepNetwork}
                  onChange={(e) => setSweepNetwork(e.target.value)}
                  className="mt-1 block w-full min-w-[14rem] bg-surface-card border border-surface-border rounded-xl px-3 py-2 text-sm text-white"
                >
                  <option value="">All networks for {sweepAsset}</option>
                  {(ASSET_NETWORKS[sweepAsset] || []).map((n) => (
                    <option key={n} value={n}>{n}</option>
                  ))}
                </select>
              ) : (
                <input
                  value={sweepNetwork}
                  onChange={(e) => setSweepNetwork(e.target.value)}
                  placeholder="e.g. ERC-20 (Ethereum)"
                  className="mt-1 block w-full min-w-[14rem] bg-surface-card border border-surface-border rounded-xl px-3 py-2 text-sm text-white"
                />
              )}
            </label>
            <label className="text-xs text-white/55 block">
              Max addresses
              <input
                type="number"
                min={1}
                max={500}
                value={sweepLimit}
                onChange={(e) => setSweepLimit(Number(e.target.value))}
                className="mt-1 block w-24 bg-surface-card border border-surface-border rounded-xl px-3 py-2 text-sm text-white"
              />
            </label>
            <button
              type="button"
              onClick={() => runSweepPreview()}
              disabled={sweepPlanLoading}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-surface-border text-sm font-bold text-white hover:border-gold/40 disabled:opacity-40"
            >
              <ArrowDownToLine size={16} /> Preview list
            </button>
            {canManage && (
              <>
                <button
                  type="button"
                  onClick={() => runSweepExecute({ dryRun: true, confirmLive: false })}
                  disabled={sweepRunBusy}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-white/10 border border-white/15 text-sm font-bold text-white hover:bg-white/15 disabled:opacity-40"
                >
                  Save dry run (no send)
                </button>
                <div className="flex flex-col gap-2">
                  <label className="flex items-center gap-2 text-xs text-gold-light/90 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={sweepConfirmLive}
                      onChange={(e) => setSweepConfirmLive(e.target.checked)}
                    />
                    I understand this broadcasts real on-chain transactions
                  </label>
                  <label className="flex items-start gap-2 text-xs text-blue-200/90 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      className="mt-0.5 shrink-0"
                      checked={autoGasFund}
                      onChange={(e) => setAutoGasFund(e.target.checked)}
                    />
                    <span>
                      <strong>Auto gas-fund + IBO fee deduction</strong> — for token addresses with
                      no BNB for gas, the hot wallet sends ~0.0008 BNB, then sweeps
                      <strong> (IBO balance − gas fee in IBO)</strong> to hot wallet.
                      Gas cost (BNB) is recovered from the user's IBO balance using live BNB/USDT and IBO/USDT prices.
                      Addresses with too little IBO to cover the fee are skipped.
                    </span>
                  </label>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    if (!liveStatus?.effective) {
                      setSweepErr('Enable the "Live Sweep" toggle above before running a live broadcast.');
                      return;
                    }
                    if (!sweepConfirmLive) {
                      setSweepErr('Check the confirmation box to confirm you understand this sends real transactions.');
                      return;
                    }
                    runSweepExecute({ dryRun: false, confirmLive: true });
                  }}
                  disabled={sweepRunBusy || !sweepConfirmLive || !liveStatus?.effective}
                  title={!liveStatus?.effective ? 'Enable Live Sweep toggle first' : undefined}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-red-600/85 text-white text-sm font-bold hover:bg-red-600 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {autoGasFund ? 'Auto-fund gas + sweep live' : 'Send live sweep'}
                </button>
              </>
            )}
          </div>
          {sweepErr && (
            <p className="text-sm text-red-300 mb-3">{sweepErr}</p>
          )}

          {/* ── RPC diagnostic banner ─────────────────────────────────── */}
          {!sweepPlanLoading && sweepPlan.length > 0 && (() => {
            const unreadableCount = sweepPlan.filter(
              (r) => r.balance_human == null && !r.gate_block,
            ).length;
            const hasEthRows = sweepPlan.some(
              (r) => ['ETH', 'USDT'].includes(r.asset) &&
                     (r.network || '').includes('Ethereum') && r.balance_human == null,
            );
            if (unreadableCount === 0) return null;
            return (
              <div className="mb-4 rounded-xl border border-gold/30 bg-gold/10 px-4 py-3 text-xs text-white/80 space-y-1.5">
                <div className="flex items-start gap-2">
                  <AlertCircle size={15} className="shrink-0 mt-0.5 text-gold" />
                  <div>
                    <p className="font-bold text-white">
                      {unreadableCount} address{unreadableCount > 1 ? 'es' : ''} — balance could not be read
                    </p>
                    <p className="text-white/60 mt-0.5 leading-relaxed">
                      The balance check for these addresses returned null, so the sweep skips them.
                      This usually means the RPC endpoint for their chain is not configured.
                    </p>
                    {hasEthRows && (
                      <div className="mt-2 p-2 rounded-lg bg-white/[.05] border border-white/10 space-y-1 leading-relaxed">
                        <p className="font-semibold text-white/90">ETH / USDT (ERC-20) addresses are unreadable</p>
                        <p className="text-white/65">
                          Your <code className="bg-white/10 px-1 rounded">QUICKNODE_ETH_URL</code> is currently
                          <strong className="text-rose-300"> commented out</strong> in your backend <code className="bg-white/10 px-1 rounded">.env</code> file.
                          While the Ethereum endpoint is paused at QuickNode, ETH and USDT ERC-20 balances cannot be read and those addresses cannot be swept.
                        </p>
                        <p className="font-semibold text-white/85">To fix:</p>
                        <ol className="list-decimal pl-4 space-y-0.5 text-white/65">
                          <li>Re-activate your QuickNode Ethereum endpoint (or create a new one)</li>
                          <li>Uncomment <code className="bg-white/10 px-1 rounded">QUICKNODE_ETH_URL=…</code> in <code className="bg-white/10 px-1 rounded">backend/.env</code></li>
                          <li>Restart the backend server</li>
                          <li>Re-run Preview — ETH/USDT balances will appear</li>
                        </ol>
                        <p className="text-white/45 mt-1">
                          IBO (BEP-20 / BSC) and USDT BEP-20 are unaffected — they use the BSC endpoint which is active.
                        </p>
                      </div>
                    )}
                    {!hasEthRows && (
                      <p className="text-white/55 mt-1">
                        Check that <code className="bg-white/10 px-1 rounded">QUICKNODE_BSC_URL</code>, <code className="bg-white/10 px-1 rounded">IBO_CONTRACT_ADDRESS</code>, and <code className="bg-white/10 px-1 rounded">USDT_BEP20_CONTRACT</code> are set correctly in your backend <code className="bg-white/10 px-1 rounded">.env</code>.
                      </p>
                    )}
                  </div>
                </div>
              </div>
            );
          })()}

          {sweepPlanLoading && <p className="text-white/50 text-sm py-2">Loading plan…</p>}
          {!sweepPlanLoading && sweepPlan.length > 0 && (() => {
            const blocked = sweepPlan.filter((r) => !r.sweepable);
            const ready = sweepPlan.filter((r) => r.sweepable);
            const withIssue = blocked.map((r) => ({ row: r, issue: sweepPreviewIssue(r) }));

            const gateGroups = [];
            const seenGate = new Set();
            for (const { row, issue } of withIssue) {
              if (!row.gate_block) continue;
              const key = `${row.asset}|${row.network}|${issue.code}`;
              if (!seenGate.has(key)) {
                seenGate.add(key);
                gateGroups.push({
                  asset: row.asset,
                  network: row.network,
                  gate_block: row.gate_block,
                  issue,
                  count: withIssue.filter((x) => x.row.asset === row.asset && x.row.network === row.network && x.row.gate_block === row.gate_block).length,
                });
              }
            }

            const emptyCount = withIssue.filter((x) => x.issue.code === 'below_min').length;
            const balanceUnknownCount = withIssue.filter((x) => x.issue.code === 'balance_unavailable').length;
            const notImplementedCount = withIssue.filter((x) => x.issue.code === 'sweep_not_implemented').length;
            const noGasRows = withIssue.filter((x) => x.issue.code === 'insufficient_gas');

            return (
              <div className="space-y-4">
                {gateGroups.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-xs font-bold text-white/50 uppercase tracking-wide">
                      {gateGroups.length} setup issue{gateGroups.length > 1 ? 's' : ''} — fix hot wallet registration
                    </p>
                    {gateGroups.map((g) => {
                      const isNoWallet = g.gate_block === 'no_hot_wallet';
                      const isSignerMissing = g.gate_block === 'signer_not_configured';
                      const isMismatch = g.gate_block === 'hot_signer_mismatch';
                      return (
                        <div
                          key={`${g.asset}-${g.gate_block}-${g.network}`}
                          className={`rounded-xl border px-4 py-3 ${
                            isSignerMissing
                              ? 'border-rose-500/35 bg-rose-500/[.07]'
                              : isMismatch
                              ? 'border-gold/35 bg-gold/10'
                              : 'border-gold/30 bg-gold/[.06]'
                          }`}
                        >
                          <div className="flex items-start gap-3 flex-wrap">
                            <AlertCircle size={16} className={`shrink-0 mt-0.5 ${isSignerMissing ? 'text-rose-400' : 'text-gold'}`} />
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-bold text-white">
                                {g.count} {g.asset} address{g.count > 1 ? 'es' : ''} — {g.issue.label}
                              </p>
                              <p className="text-xs text-white/60 mt-0.5 leading-relaxed">{g.issue.detail}</p>
                              {isNoWallet && (
                                <div className="mt-2 p-2.5 rounded-lg bg-white/[.04] border border-white/10 text-xs text-white/70 leading-relaxed space-y-1">
                                  <p className="font-semibold text-white/85">How to fix:</p>
                                  <ol className="list-decimal pl-4 space-y-1">
                                    <li>Click <strong>Add wallet address</strong></li>
                                    <li><strong>Wallet type = Hot</strong></li>
                                    <li><strong>Coin = {g.asset}</strong>, <strong>Network = {g.network}</strong></li>
                                    <li>Paste the server signer address (same as <code className="bg-white/10 px-1 rounded">TREASURY_ETH_PRIVATE_KEY</code> for ETH/USDT/IBO on EVM)</li>
                                    <li>Save → re-run Preview</li>
                                  </ol>
                                </div>
                              )}
                              {isSignerMissing && (
                                <div className="mt-2 p-2.5 rounded-lg bg-white/[.04] border border-white/10 text-xs text-white/70 leading-relaxed space-y-1">
                                  <p className="font-semibold text-white/85">How to fix:</p>
                                  <ol className="list-decimal pl-4 space-y-1">
                                    <li>Set <code className="bg-white/10 px-1 rounded">TREASURY_ETH_PRIVATE_KEY</code> in backend .env</li>
                                    <li>Restart the backend</li>
                                    <li>Add matching hot wallet row here</li>
                                  </ol>
                                </div>
                              )}
                              {isMismatch && (
                                <div className="mt-2 p-2.5 rounded-lg bg-white/[.04] border border-white/10 text-xs text-white/70 leading-relaxed space-y-1">
                                  <p className="font-semibold text-white/85">How to fix:</p>
                                  <ol className="list-decimal pl-4 space-y-1">
                                    <li>Disable the wrong hot wallet row in Saved addresses</li>
                                    <li>Add a new hot row with the exact server signer address</li>
                                  </ol>
                                </div>
                              )}
                            </div>
                            {canManage && isNoWallet && (
                              <button
                                type="button"
                                onClick={() => openCreateWallet({
                                  role: 'hot',
                                  asset: g.asset,
                                  network: g.network,
                                })}
                                className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-gold/90 text-surface-dark text-xs font-bold hover:opacity-90 transition-opacity"
                              >
                                <Plus size={14} /> Add {g.asset} hot wallet
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* ── Insufficient gas cards ──────────────────────────── */}
                {noGasRows.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-xs font-bold text-white/50 uppercase tracking-wide">
                      {noGasRows.length} address{noGasRows.length > 1 ? 'es' : ''} — token balance present but no gas for sweep
                    </p>
                    {noGasRows.map(({ row, issue }) => (
                      <div
                        key={row.deposit_address_id || row.address}
                        className="rounded-xl border border-gold/30 bg-gold/[.06] px-4 py-3 text-xs text-white/70 space-y-2"
                      >
                        <div className="flex items-start gap-3 flex-wrap">
                          <AlertCircle size={15} className="shrink-0 mt-0.5 text-gold" />
                          <div className="flex-1 min-w-0">
                            <p className="font-bold text-white text-sm">
                              {row.asset} on {row.network} — {issue.label}
                            </p>
                            <p className="font-mono text-white/50 break-all mt-0.5">{row.address}</p>
                            <p className="mt-1 leading-relaxed">{issue.detail}</p>
                          </div>
                        </div>
                        <div className="p-2.5 rounded-lg bg-white/[.04] border border-white/10 leading-relaxed space-y-1">
                          <p className="font-semibold text-white/85">How to fix:</p>
                          <ol className="list-decimal pl-4 space-y-1">
                            <li>Go to <strong>Treasury Transfer</strong> (sidebar)</li>
                            <li>Select <strong>{issue.gas_info?.sym || 'native gas coin'}</strong> and paste the deposit address: <code className="bg-white/10 px-1 rounded break-all">{issue.gas_info?.address || row.address}</code></li>
                            <li>Send at least <strong>{issue.gas_info?.need || '0.001'} {issue.gas_info?.sym || 'gas'}</strong> from the hot wallet</li>
                            <li>Come back here and re-run Preview → then live sweep</li>
                          </ol>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {(emptyCount > 0 || balanceUnknownCount > 0 || notImplementedCount > 0) && (
                  <div className="rounded-xl border border-white/10 bg-white/[.03] px-4 py-3 text-xs text-white/60 space-y-1.5">
                    <p className="font-semibold text-white/75">Other blocked rows</p>
                    {emptyCount > 0 && (
                      <p><strong>{emptyCount}</strong> address{emptyCount > 1 ? 'es have' : ' has'} <strong>no on-chain balance</strong> (or below minimum) — nothing to sweep yet.</p>
                    )}
                    {balanceUnknownCount > 0 && (
                      <p><strong>{balanceUnknownCount}</strong> address{balanceUnknownCount > 1 ? 'es' : ''} — balance could not be read (check RPC and contract env vars).</p>
                    )}
                    {notImplementedCount > 0 && (
                      <p><strong>{notImplementedCount}</strong> address{notImplementedCount > 1 ? 'es have' : ' has'} funds but their coin (BTC / TRX / SOL) requires separate signing infrastructure not yet implemented for sweep.</p>
                    )}
                  </div>
                )}

                {/* ── Ready-to-sweep summary ───────────────────────── */}
                {ready.length > 0 && (
                  <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/[.05] px-4 py-2.5 text-xs text-emerald-200 flex items-center gap-2">
                    <CheckCircle2 size={14} className="shrink-0 text-emerald-400" />
                    <span><strong>{ready.length}</strong> address{ready.length > 1 ? 'es' : ''} ready to sweep — hot wallet configured and balance above minimum.</span>
                  </div>
                )}

                {/* ── Full table ───────────────────────────────────── */}
                <div className="overflow-x-auto rounded-xl border border-white/10">
                  <table className="w-full text-xs sm:text-sm">
                    <thead>
                      <tr className="text-left text-white/55 border-b border-white/10 bg-white/[.02]">
                        <th className="p-2 pl-3">Asset</th>
                        <th className="p-2">Network</th>
                        <th className="p-2">Address</th>
                        <th className="p-2">Balance</th>
                        <th className="p-2" title="Enough balance and payout wallet ready">Sweep?</th>
                        <th className="p-2 pr-3">Issue</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sweepPlan.map((row) => {
                        const issue = sweepPreviewIssue(row);
                        return (
                        <tr
                          key={row.deposit_address_id || row.address}
                          className={`border-b border-white/5 ${row.sweepable ? '' : 'opacity-60'}`}
                        >
                          <td className="p-2 pl-3 font-mono font-bold text-gold-light">{row.asset}</td>
                          <td className="p-2 text-white/60 text-xs max-w-[120px] truncate" title={row.network}>{row.network || '—'}</td>
                          <td className="p-2 font-mono text-xs text-white/75 break-all max-w-[180px]">{row.address}</td>
                          <td className="p-2 font-mono">{row.balance_human != null ? String(row.balance_human) : '—'}</td>
                          <td className="p-2">
                            {row.sweepable
                              ? <span className="text-emerald-400 font-bold">✓ Yes</span>
                              : <span className="text-white/40">No</span>
                            }
                          </td>
                          <td
                            className={`p-2 pr-3 text-xs max-w-[180px] ${row.sweepable ? 'text-white/35' : 'text-gold-light/90'}`}
                            title={issue.detail}
                          >
                            {row.sweepable ? '—' : issue.label}
                          </td>
                        </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })()}
          {!sweepPlanLoading && sweepPlan.length === 0 && !sweepErr && (
            <p className="text-white/45 text-sm">Click “Preview list” to load rows, or run a dry run to store a report without sending coins.</p>
          )}
          {sweepLastRun?.run && (() => {
            const run = sweepLastRun.run;
            const s = run.summary || {};
            const isLive = run.mode === 'live';
            const refused = run.status === 'refused';
            const byAsset = s.by_asset ? Object.values(s.by_asset) : [];
            return (
              <div className={`mt-4 rounded-xl border px-4 py-3 ${
                refused ? 'border-rose-500/30 bg-rose-500/[.06]'
                : isLive && s.swept > 0 ? 'border-emerald-500/30 bg-emerald-500/[.06]'
                : 'border-white/10 bg-white/[.03]'
              }`}>
                <div className="flex items-center gap-2 flex-wrap mb-2">
                  <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${
                    refused ? 'bg-rose-500/20 text-rose-300'
                    : isLive ? 'bg-emerald-500/20 text-emerald-300'
                    : 'bg-white/10 text-white/60'
                  }`}>
                    {refused ? 'Refused' : isLive ? 'Live sweep' : 'Dry run'}
                  </span>
                  <span className="text-xs text-white/50">{fmtTs(run.created_at)}</span>
                </div>
                {refused && (
                  <p className="text-sm text-rose-300 mb-2">{run.refusal_reason}</p>
                )}
                {!refused && (
                  <>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center mb-2">
                      {[
                      { label: isLive ? 'Swept' : 'Would sweep', val: s.swept ?? 0, color: s.swept > 0 ? 'text-emerald-400' : 'text-white/40' },
                      { label: 'Dry-run previewed', val: s.dry_run_previewed ?? 0, color: 'text-blue-300' },
                      { label: 'No gas / low IBO', val: (s.insufficient_gas ?? 0) + (s.insufficient_ibo_for_fee ?? 0), color: ((s.insufficient_gas ?? 0) + (s.insufficient_ibo_for_fee ?? 0)) > 0 ? 'text-gold' : 'text-white/30' },
                      { label: 'Skipped/failed', val: (s.skipped ?? 0) + (s.failed ?? 0), color: 'text-white/35' },
                      ].map((item) => (
                        <div key={item.label} className="rounded-lg bg-white/[.04] p-2">
                          <p className={`text-lg font-bold ${item.color}`}>{item.val}</p>
                          <p className="text-xs text-white/45">{item.label}</p>
                        </div>
                      ))}
                    </div>
                    {(s.gas_funded > 0 || s.gas_fund_total_wei > 0 || s.insufficient_ibo_for_fee > 0) && (
                      <div className="mb-3 rounded-lg border border-blue-500/25 bg-blue-500/[.07] px-3 py-2 text-xs text-blue-200 space-y-1.5">
                        <div className="flex items-center gap-2 flex-wrap font-bold text-blue-300">⛽ Gas station summary</div>
                        <div className="flex flex-wrap gap-x-4 gap-y-1 text-blue-200/80">
                          {s.gas_funded > 0 && (
                            <span>{s.gas_funded} address{s.gas_funded !== 1 ? 'es' : ''} funded with BNB</span>
                          )}
                          {s.gas_fund_total_wei > 0 && (
                            <span>BNB sent: <strong>{(s.gas_fund_total_wei / 1e18).toFixed(6)} BNB</strong></span>
                          )}
                          {s.total_gas_fee_ibo > 0 && (
                            <span>Gas fee deducted: <strong>{Number(s.total_gas_fee_ibo).toFixed(6)} IBO</strong> from sweep amounts</span>
                          )}
                          {s.insufficient_ibo_for_fee > 0 && (
                            <span className="text-gold-light">{s.insufficient_ibo_for_fee} skipped (not enough IBO to cover fee)</span>
                          )}
                        </div>
                      </div>
                    )}
                  </>
                )}
                {byAsset.length > 0 && (
                  <div className="overflow-x-auto rounded-lg border border-white/10">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="text-left text-white/45 border-b border-white/10 bg-white/[.02]">
                          <th className="p-2 pl-3">Coin</th>
                          <th className="p-2">Network</th>
                          <th className="p-2">{isLive ? 'Swept' : 'Would sweep'}</th>
                          <th className="p-2">Amount moved</th>
                          <th className="p-2">No gas</th>
                          <th className="p-2 pr-3">Skipped</th>
                        </tr>
                      </thead>
                      <tbody>
                        {byAsset.map((b) => (
                          <tr key={`${b.asset}|${b.network}`} className="border-b border-white/5">
                            <td className="p-2 pl-3 font-bold text-gold-light font-mono">{b.asset}</td>
                            <td className="p-2 text-white/50 text-xs">{b.network}</td>
                            <td className={`p-2 font-bold ${b.swept > 0 ? 'text-emerald-400' : 'text-white/30'}`}>{b.swept}</td>
                            <td className="p-2 font-mono text-white/70">{b.swept_amount > 0 ? b.swept_amount : '—'}</td>
                            <td className={`p-2 ${b.insufficient_gas > 0 ? 'text-gold font-bold' : 'text-white/30'}`}>{b.insufficient_gas || '—'}</td>
                            <td className="p-2 pr-3 text-white/35">{(b.skipped || 0) + (b.failed || 0) || '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })()}
        </AdminPanel>
      )}

      {/* ── Sweep Run History ──────────────────────────────────────────── */}
      {canViewTreasury && (
        <AdminPanel
          title="Sweep Run History"
          subtitle="All past sweep runs — newest first. Click any row to expand details and see per-address results."
          className="mb-6"
          right={
            <button type="button" onClick={() => loadSweepHistory(0)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white/10 text-white/70 text-xs hover:bg-white/15 transition-colors">
              <RefreshCw size={13} /> Refresh
            </button>
          }
        >
          {sweepHistoryLoading && <p className="text-white/45 text-sm">Loading history…</p>}
          {!sweepHistoryLoading && sweepHistory.length === 0 && (
            <p className="text-white/35 text-sm">No sweep runs yet. Run a dry run or live sweep above — history will appear here.</p>
          )}
          {sweepHistory.length > 0 && (
            <div className="space-y-2">
              {sweepHistory.map((run) => {
                const s = run.summary || {};
                const isLive = run.mode === 'live';
                const refused = run.status === 'refused';
                const expanded = expandedRunId === run.id;
                const detail = runDetail[run.id];
                return (
                  <div key={run.id} className={`rounded-xl border ${
                    refused ? 'border-rose-500/20 bg-rose-500/[.04]'
                    : isLive && s.swept > 0 ? 'border-emerald-500/20 bg-emerald-500/[.03]'
                    : 'border-white/10 bg-white/[.02]'
                  }`}>
                    <button
                      type="button"
                      onClick={() => expanded ? setExpandedRunId(null) : loadRunDetail(run.id)}
                      className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-white/[.02] transition-colors rounded-xl"
                    >
                      <span className={`shrink-0 text-xs font-bold px-2 py-0.5 rounded-full ${
                        refused ? 'bg-rose-500/20 text-rose-300'
                        : isLive ? 'bg-emerald-500/15 text-emerald-300'
                        : 'bg-white/10 text-white/55'
                      }`}>
                        {refused ? 'Refused' : isLive ? 'Live' : 'Dry run'}
                      </span>
                      <span className="flex-1 text-xs text-white/60">{fmtTs(run.created_at)}</span>
                      {!refused && (
                        <span className="text-xs hidden sm:block">
                          {s.swept > 0 && <span className="text-emerald-400 font-bold mr-2">✓ {s.swept} swept</span>}
                          {s.gas_funded > 0 && <span className="text-blue-300 mr-2">⛽ {s.gas_funded} funded</span>}
                          {s.insufficient_gas > 0 && <span className="text-gold mr-2">{s.insufficient_gas} no-gas</span>}
                          {s.dry_run_previewed > 0 && <span className="text-blue-300 mr-2">{s.dry_run_previewed} previewed</span>}
                          {s.swept === 0 && s.dry_run_previewed === 0 && <span className="text-white/30 mr-2">0 addresses actionable</span>}
                        </span>
                      )}
                      <ChevronDown size={14} className={`shrink-0 text-white/30 transition-transform ${expanded ? 'rotate-180' : ''}`} />
                    </button>
                    {expanded && (
                      <div className="px-4 pb-3 border-t border-white/10 pt-3 space-y-2">
                        {refused && <p className="text-sm text-rose-300">{run.refusal_reason || 'Refused'}</p>}
                        {!refused && s.by_asset && (
                          <div className="overflow-x-auto rounded-lg border border-white/10">
                            <table className="w-full text-xs">
                              <thead>
                                <tr className="text-left text-white/40 border-b border-white/10 bg-white/[.02]">
                                  <th className="p-2 pl-3">Coin</th>
                                  <th className="p-2">Network</th>
                                  <th className="p-2">{isLive ? 'Swept' : 'Would sweep'}</th>
                                  <th className="p-2">Amount</th>
                                  <th className="p-2">No gas</th>
                                  <th className="p-2 pr-3">Skipped</th>
                                </tr>
                              </thead>
                              <tbody>
                                {Object.values(s.by_asset).map((b) => (
                                  <tr key={`${b.asset}|${b.network}`} className="border-b border-white/5">
                                    <td className="p-2 pl-3 font-bold text-gold-light font-mono">{b.asset}</td>
                                    <td className="p-2 text-white/45 text-xs">{b.network}</td>
                                    <td className={`p-2 font-bold ${b.swept > 0 ? 'text-emerald-400' : 'text-white/30'}`}>{b.swept}</td>
                                    <td className="p-2 font-mono text-white/65">{b.swept_amount > 0 ? b.swept_amount : '—'}</td>
                                    <td className={`p-2 ${b.insufficient_gas > 0 ? 'text-gold font-bold' : 'text-white/30'}`}>{b.insufficient_gas || '—'}</td>
                                    <td className="p-2 pr-3 text-white/30">{(b.skipped || 0) + (b.failed || 0) || '—'}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                        {detail && Array.isArray(detail.items) && detail.items.length > 0 && (
                          <details className="mt-1">
                            <summary className="text-xs text-white/40 cursor-pointer hover:text-white/60">Show all {detail.items.length} addresses in this run</summary>
                            <div className="mt-2 overflow-x-auto rounded-lg border border-white/10">
                              <table className="w-full text-xs">
                                <thead>
                                  <tr className="text-left text-white/40 border-b border-white/10 bg-white/[.02]">
                                    <th className="p-2 pl-3">Coin</th>
                                    <th className="p-2">Deposit address</th>
                                    <th className="p-2">User</th>
                                    <th className="p-2">Balance</th>
                                    <th className="p-2">Result</th>
                                    <th className="p-2 pr-3">TX hash</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {detail.items.map((it, i) => {
                                    const res = it.result || {};
                                    const gf = it.gas_fund_result || {};
                                    const ok = res.ok === true;
                                    const drRun = res.dry_run === true;
                                    const gasFunded = gf.ok === true;
                                    const isEth = it.network?.includes('Ethereum');
                                    const explorerTxBase = isEth ? 'https://etherscan.io/tx/' : 'https://bscscan.com/tx/';
                                    const explorerAddrBase = isEth ? 'https://etherscan.io/address/' : 'https://bscscan.com/address/';
                                    const uid = it.uid;
                                    return (
                                      <tr key={it.deposit_address_id || i} className="border-b border-white/5 hover:bg-white/[.02] transition-colors">
                                        <td className="p-2 pl-3 font-mono font-bold text-gold-light text-xs whitespace-nowrap">{it.asset}</td>
                                        <td className="p-2 max-w-[160px]">
                                          <div className="flex flex-col gap-0.5">
                                            <span className="font-mono text-xs text-white/55 break-all">{it.address}</span>
                                            <a
                                              href={`${explorerAddrBase}${it.address}`}
                                              target="_blank"
                                              rel="noopener noreferrer"
                                              className="text-[10px] text-blue-400/60 hover:text-blue-400 transition-colors"
                                            >
                                              View on explorer ↗
                                            </a>
                                          </div>
                                        </td>
                                        <td className="p-2">
                                          {uid ? (
                                            <Link
                                              to={`/users/${uid}`}
                                              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-white/[.07] border border-white/10 text-xs text-white/70 hover:bg-white/[.12] hover:text-white transition-colors font-mono"
                                              title={`Open user ${uid}`}
                                            >
                                              <span>👤</span>
                                              <span>{uid.slice(0, 8)}…</span>
                                            </Link>
                                          ) : (
                                            <span className="text-white/25 text-xs">—</span>
                                          )}
                                        </td>
                                        <td className="p-2 font-mono text-xs">{it.balance_human != null ? it.balance_human : '—'}</td>
                                        <td className={`p-2 text-xs font-bold ${
                                          it.skipped_reason ? 'text-white/30'
                                          : drRun && ok ? 'text-blue-300'
                                          : ok ? 'text-emerald-400'
                                          : res.error ? 'text-red-400'
                                          : 'text-white/30'
                                        }`}>
                                          {it.skipped_reason ? 'Skipped'
                                            : drRun && ok ? 'Dry run OK'
                                            : ok ? '✓ Swept'
                                            : res.error ? String(res.error).split(':')[0]
                                            : '—'}
                                          {ok && res.sweep_amount_human != null && res.token_balance_human != null
                                            && Math.abs(res.sweep_amount_human - res.token_balance_human) > 0.000001 && (
                                            <span className="ml-1 text-white/50 font-normal text-xs">
                                              ({Number(res.sweep_amount_human).toFixed(4)} swept
                                              {res.gas_fee_ibo ? `, −${Number(res.gas_fee_ibo).toFixed(4)} IBO fee` : ''})
                                            </span>
                                          )}
                                          {gasFunded && (
                                            <span className="ml-1 text-blue-300 font-normal">
                                              (⛽ {gf.amount_human?.toFixed(5)} {gf.native_symbol})
                                            </span>
                                          )}
                                        </td>
                                        <td className="p-2 pr-3 font-mono text-xs text-white/45 space-y-0.5 max-w-[150px]">
                                          {res.tx_hash ? (
                                            <a href={`${explorerTxBase}${res.tx_hash}`} target="_blank" rel="noopener noreferrer"
                                              className="block text-blue-400 hover:underline break-all">
                                              sweep: {res.tx_hash.slice(0, 12)}…
                                            </a>
                                          ) : '—'}
                                          {gf.tx_hash && (
                                            <a href={`${explorerTxBase}${gf.tx_hash}`} target="_blank" rel="noopener noreferrer"
                                              className="block text-blue-300/70 hover:underline break-all text-xs">
                                              gas: {gf.tx_hash.slice(0, 12)}…
                                            </a>
                                          )}
                                        </td>
                                      </tr>
                                    );
                                  })}
                                </tbody>
                              </table>
                            </div>
                          </details>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
              {sweepHistoryTotal > 20 && (
                <div className="flex items-center justify-between pt-2">
                  <span className="text-xs text-white/40">{sweepHistoryTotal} total runs</span>
                  <div className="flex gap-2">
                    <button type="button" disabled={sweepHistoryOffset === 0}
                      onClick={() => loadSweepHistory(Math.max(0, sweepHistoryOffset - 20))}
                      className="px-3 py-1 rounded-xl bg-white/10 text-xs text-white/70 disabled:opacity-30 hover:bg-white/15">
                      ← Prev
                    </button>
                    <button type="button" disabled={sweepHistoryOffset + 20 >= sweepHistoryTotal}
                      onClick={() => loadSweepHistory(sweepHistoryOffset + 20)}
                      className="px-3 py-1 rounded-xl bg-white/10 text-xs text-white/70 disabled:opacity-30 hover:bg-white/15">
                      Next →
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </AdminPanel>
      )}

      <AdminPanel
        title="Saved addresses"
        subtitle="Hot wallets must match the server signing address exactly. Cold wallets are for records only."
        className="mb-6"
        right={canManage ? (
          <button
            type="button"
            onClick={() => openCreateWallet()}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-gold/90 text-surface-dark text-sm font-bold hover:opacity-90"
          >
            <Plus size={16} /> Add wallet address
          </button>
        ) : null}
      >
        <div className="flex flex-wrap gap-3 mb-4">
          <select
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value)}
            className="bg-surface-card border border-surface-border rounded-xl px-3 py-2 text-sm text-white"
            title="Filter by hot (payout) or cold (record only)"
          >
            <option value="">Hot and cold</option>
            <option value="hot">Hot only</option>
            <option value="cold">Cold only</option>
          </select>
          <select
            value={assetFilter}
            onChange={(e) => setAssetFilter(e.target.value)}
            className="bg-surface-card border border-surface-border rounded-xl px-3 py-2 text-sm text-white"
          >
            <option value="">All coins</option>
            {ALL_ASSETS.filter(a => a !== '__custom__').map((a) => (
              <option key={a} value={a}>{a}</option>
            ))}
          </select>
        </div>

        {loading ? (
          <p className="text-white/50 text-sm py-8 text-center">Loading…</p>
        ) : items.length === 0 ? (
          <div className="py-10 text-center space-y-4">
            <p className="text-white/50 text-sm">No addresses saved yet.</p>
            {canManage ? (
              <>
                <p className="text-xs text-white/40 max-w-md mx-auto">
                  For withdrawals and sweeps to work you need at least one enabled hot wallet that matches the server payout address.
                </p>
                <button
                  type="button"
                  onClick={() => openCreateWallet({ asset: 'IBO', network: 'BEP-20 (BNB Chain)', role: 'hot' })}
                  className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-gold text-surface-dark text-sm font-extrabold hover:opacity-90"
                >
                  <Plus size={18} /> Add wallet address
                </button>
              </>
            ) : (
              <p className="text-xs text-gold-light/80 max-w-md mx-auto">
                Ask an admin with <strong>manage_treasury</strong> permission to add the hot wallet.
              </p>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wider text-white/45 border-b border-surface-border">
                  <th className="pb-2 pr-3" title="Hot = payout from server; cold = record only">Type</th>
                  <th className="pb-2 pr-3">Coin</th>
                  <th className="pb-2 pr-3">Network</th>
                  <th className="pb-2 pr-3">Public address</th>
                  <th className="pb-2 pr-3">Note</th>
                  <th className="pb-2 pr-3" title="Preferred hot wallet for this coin + network">Main payout?</th>
                  <th className="pb-2 pr-3">Active</th>
                  <th className="pb-2 pr-3">Last change</th>
                  <th className="pb-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {items.map((row) => (
                  <tr key={row.id} className="border-b border-surface-border/40">
                    <td className="py-3 pr-3">
                      <span className={`inline-flex items-center gap-1 font-bold ${row.role === 'hot' ? 'text-gold-light' : 'text-sky-300'}`}>
                        {row.role === 'hot' ? <Flame size={14} /> : <Snowflake size={14} />}
                        {row.role}
                      </span>
                    </td>
                    <td className="py-3 pr-3 font-mono text-white">{row.asset}</td>
                    <td className="py-3 pr-3 text-white/80 max-w-[200px] truncate" title={row.network}>{row.network}</td>
                    <td className="py-3 pr-3 font-mono text-xs text-gold-light max-w-[220px] truncate" title={row.address}>{row.address}</td>
                    <td className="py-3 pr-3 text-white/70">{row.label || '—'}</td>
                    <td className="py-3 pr-3">{row.is_default_payout ? <span className="text-green-400 font-bold">Yes</span> : <span className="text-white/40">No</span>}</td>
                    <td className="py-3 pr-3">{row.enabled ? <span className="text-green-400">Yes</span> : <span className="text-white/40">No</span>}</td>
                    <td className="py-3 pr-3 text-white/55 text-xs whitespace-nowrap">{fmtTs(row.updated_at)}</td>
                    <td className="py-3">
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => openAudit(row.id)}
                          className="text-xs font-bold px-2 py-1 rounded-lg border border-surface-border text-white hover:border-gold/40"
                        >
                          <BookOpen size={12} className="inline mr-1" />
                          History
                        </button>
                        {canManage && row.role === 'hot' && !row.is_default_payout && (
                          <button
                            type="button"
                            onClick={() => setDefaultPayout(row)}
                            className="text-xs font-bold px-2 py-1 rounded-lg border border-gold/30 text-gold-light hover:bg-gold/10"
                          >
                            Set as main payout
                          </button>
                        )}
                        {canManage && (
                          <button
                            type="button"
                            onClick={() => toggleEnabled(row)}
                            className="text-xs font-bold px-2 py-1 rounded-lg border border-surface-border text-white hover:border-gold/40"
                          >
                            {row.enabled ? 'Turn off' : 'Turn on'}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="text-xs text-white/40 mt-3">{total} row(s)</p>
          </div>
        )}
      </AdminPanel>

      {auditWalletId && (
        <AdminPanel title={`Change history · ${auditWalletId}`} className="mb-6">
          <button
            type="button"
            onClick={() => { setAuditWalletId(null); setAuditRows([]); }}
            className="text-xs font-bold text-white/60 hover:text-white mb-3"
          >
            Close
          </button>
          {auditLoading ? <p className="text-white/50 text-sm">Loading…</p> : null}
          {auditErr ? <p className="text-red-300 text-sm">{auditErr}</p> : null}
          {!auditLoading && !auditErr && auditRows.length === 0 ? (
            <p className="text-white/50 text-sm">No saved changes yet.</p>
          ) : null}
          <ul className="space-y-2 max-h-80 overflow-y-auto">
            {auditRows.map((a) => (
              <li key={a.id} className="text-xs border border-surface-border rounded-lg p-3 bg-white/[.03]">
                <span className="font-bold text-gold-light">{a.action}</span>
                <span className="text-white/40 mx-2">{fmtTs(a.created_at)}</span>
                <span className="text-white/50">{a.admin_email || a.admin_aid || '—'}</span>
              </li>
            ))}
          </ul>
        </AdminPanel>
      )}

      {createOpen && (
        <div
          className="fixed inset-0 z-50 overflow-y-auto bg-black/75 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-labelledby="add-wallet-title"
        >
          <div className="flex min-h-full items-end sm:items-center justify-center p-3 sm:p-4">
            <div className="w-full max-w-lg max-h-[min(92dvh,880px)] flex flex-col rounded-2xl border border-surface-border bg-surface-card shadow-2xl overflow-hidden">
              {/* Header — sticky */}
              <div className="shrink-0 flex items-start justify-between gap-3 px-4 sm:px-6 pt-4 sm:pt-5 pb-3 border-b border-surface-border/60">
                <div className="min-w-0 pr-2">
                  <h3 id="add-wallet-title" className="text-base sm:text-lg font-bold text-white">
                    Add a wallet address
                  </h3>
                  <p className="text-xs text-white/55 mt-1 leading-relaxed">
                    Public address only — never paste private keys here.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setCreateOpen(false)}
                  className="shrink-0 p-2 rounded-lg text-white/50 hover:text-white hover:bg-white/10 transition-colors"
                  aria-label="Close"
                >
                  <X size={20} />
                </button>
              </div>

              {/* Scrollable body */}
              <form onSubmit={submitCreate} className="flex flex-col min-h-0 flex-1">
                <div className="flex-1 overflow-y-auto overscroll-contain px-4 sm:px-6 py-4 space-y-4">
                  <div>
                    <label className="block text-xs text-white/55 mb-1.5">Wallet type</label>
                    <select
                      value={createForm.role}
                      onChange={(e) => setCreateForm((f) => ({ ...f, role: e.target.value, is_default_payout: e.target.value === 'cold' ? false : f.is_default_payout }))}
                      className="w-full bg-surface-dark border border-surface-border rounded-xl px-3 py-2.5 text-sm text-white"
                    >
                      <option value="hot">Hot — payouts &amp; sweeps (must match server address)</option>
                      <option value="cold">Cold — storage record only</option>
                    </select>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="min-w-0">
                      <label className="block text-xs text-white/55 mb-1.5">Coin</label>
                      <select
                        value={createForm.asset}
                        onChange={(e) => {
                          const asset = e.target.value;
                          const nets = ASSET_NETWORKS[asset] || [];
                          const network = nets.length > 0 ? nets[0] : '';
                          setCreateForm((f) => ({ ...f, asset, network, assetCustom: '', networkCustom: '' }));
                        }}
                        className="w-full bg-surface-dark border border-surface-border rounded-xl px-3 py-2.5 text-sm text-white"
                      >
                        {ALL_ASSETS.filter(a => a !== '__custom__').map((a) => (
                          <option key={a} value={a}>{a}</option>
                        ))}
                        <option value="__custom__">Other (type below)</option>
                      </select>
                      {createForm.asset === '__custom__' && (
                        <input
                          value={createForm.assetCustom}
                          onChange={(e) => setCreateForm((f) => ({ ...f, assetCustom: e.target.value.toUpperCase() }))}
                          placeholder="e.g. SHIB, ARB, OP…"
                          className="mt-2 w-full bg-surface-dark border border-gold/30 rounded-xl px-3 py-2.5 text-sm text-white placeholder-white/30 focus:outline-none focus:border-gold/50"
                        />
                      )}
                    </div>
                    <div className="min-w-0">
                      <label className="block text-xs text-white/55 mb-1.5">Network / Chain</label>
                      {createForm.asset === '__custom__' ? (
                        <input
                          value={createForm.networkCustom}
                          onChange={(e) => setCreateForm((f) => ({ ...f, networkCustom: e.target.value }))}
                          placeholder="e.g. BEP-20 (BNB Chain)"
                          className="w-full bg-surface-dark border border-surface-border rounded-xl px-3 py-2.5 text-sm text-white placeholder-white/30 focus:outline-none focus:border-gold/40"
                        />
                      ) : (ASSET_NETWORKS[createForm.asset] || []).length > 1 ? (
                        <select
                          value={createForm.network}
                          onChange={(e) => setCreateForm((f) => ({ ...f, network: e.target.value, networkCustom: '' }))}
                          className="w-full bg-surface-dark border border-surface-border rounded-xl px-3 py-2.5 text-sm text-white"
                        >
                          {(ASSET_NETWORKS[createForm.asset] || []).map((n) => (
                            <option key={n} value={n}>{n}</option>
                          ))}
                          <option value="Other (custom)">Other (type below)</option>
                        </select>
                      ) : (
                        <div className="w-full bg-surface-dark/50 border border-surface-border rounded-xl px-3 py-2.5 text-sm text-white/80 flex items-center justify-between gap-2 min-w-0">
                          <span className="truncate">{createForm.network || '—'}</span>
                          <button
                            type="button"
                            title="Type a different network instead"
                            onClick={() => setCreateForm((f) => ({ ...f, network: 'Other (custom)' }))}
                            className="text-[10px] text-white/35 hover:text-gold-light shrink-0"
                          >
                            change
                          </button>
                        </div>
                      )}
                      {createForm.network === 'Other (custom)' && createForm.asset !== '__custom__' && (
                        <input
                          value={createForm.networkCustom}
                          onChange={(e) => setCreateForm((f) => ({ ...f, networkCustom: e.target.value }))}
                          placeholder="e.g. Arbitrum One"
                          className="mt-2 w-full bg-surface-dark border border-gold/30 rounded-xl px-3 py-2.5 text-sm text-white placeholder-white/30 focus:outline-none focus:border-gold/50"
                        />
                      )}
                      {createForm.asset === 'USDT' && (
                        <div className="flex flex-wrap gap-1.5 mt-2">
                          {['BEP-20 (BNB Chain)', 'ERC-20 (Ethereum)', 'TRC-20 (Tron)'].map((n) => (
                            <button
                              key={n}
                              type="button"
                              onClick={() => setCreateForm((f) => ({ ...f, network: n }))}
                              className={`text-[10px] font-semibold px-2 py-1 rounded-full border transition-colors ${
                                createForm.network === n
                                  ? 'border-gold/50 bg-gold/15 text-gold-light'
                                  : 'border-surface-border text-white/40 hover:border-white/30 hover:text-white/70'
                              }`}
                            >
                              {n.replace(' (', ' · ').replace(')', '')}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>

                  <div>
                    {createForm.role === 'hot' && (
                      <div className={`mb-3 rounded-xl border px-3 py-2.5 text-xs leading-relaxed ${
                        expectedHotSigner
                          ? 'border-cyan-500/30 bg-cyan-500/10 text-cyan-100'
                          : 'border-gold/30 bg-gold/10 text-gold-light/90'
                      }`}>
                        {expectedHotSigner ? (
                          <>
                            <p className="font-semibold text-cyan-50 mb-1">Required hot wallet address (from server)</p>
                            <p className="font-mono text-[11px] break-all text-cyan-100/90">{expectedHotSigner}</p>
                            <p className="mt-1.5 text-cyan-100/70">
                              Hot wallets must exactly match <code className="bg-black/20 px-1 rounded">TREASURY_ETH_PRIVATE_KEY</code> on the server. Paste this address — not a different one.
                            </p>
                            <button
                              type="button"
                              onClick={() => setCreateForm((f) => ({ ...f, address: expectedHotSigner }))}
                              className="mt-2 text-[11px] font-bold text-gold-light hover:underline"
                            >
                              Use this address
                            </button>
                          </>
                        ) : (
                          <p>
                            Server signing key is not configured for {effectiveCreateAsset || 'this coin'}.
                            Set <code className="bg-black/20 px-1 rounded">TREASURY_ETH_PRIVATE_KEY</code> in backend .env first.
                          </p>
                        )}
                      </div>
                    )}
                    {createForm.role === 'cold' && effectiveCreateAsset === 'IBO' && expectedColdSigner && (
                      <div className="mb-3 rounded-xl border border-sky-500/30 bg-sky-500/10 px-3 py-2.5 text-xs text-sky-100 leading-relaxed">
                        <p className="font-semibold text-sky-50 mb-1">Required cold wallet address (from server)</p>
                        <p className="font-mono text-[11px] break-all">{expectedColdSigner}</p>
                        <button
                          type="button"
                          onClick={() => setCreateForm((f) => ({ ...f, address: expectedColdSigner }))}
                          className="mt-2 text-[11px] font-bold text-gold-light hover:underline"
                        >
                          Use this address
                        </button>
                      </div>
                    )}
                    <label className="block text-xs text-white/55 mb-1.5">Address</label>
                    <input
                      value={createForm.address}
                      onChange={(e) => setCreateForm((f) => ({ ...f, address: e.target.value }))}
                      className={`w-full bg-surface-dark border rounded-xl px-3 py-2.5 text-sm font-mono text-white break-all ${
                        addressMismatch ? 'border-rose-500/50' : 'border-surface-border'
                      }`}
                      placeholder={expectedHotSigner && createForm.role === 'hot' ? expectedHotSigner : 'bc1… or 0x…'}
                      required
                      autoComplete="off"
                      spellCheck={false}
                    />
                    {addressMismatch && (
                      <p className="mt-1.5 text-xs text-rose-300">
                        This address does not match the server signer. Use {requiredSigner} instead.
                      </p>
                    )}
                  </div>

                  <div>
                    <label className="block text-xs text-white/55 mb-1.5">Label <span className="text-white/30">(optional)</span></label>
                    <input
                      value={createForm.label}
                      onChange={(e) => setCreateForm((f) => ({ ...f, label: e.target.value }))}
                      className="w-full bg-surface-dark border border-surface-border rounded-xl px-3 py-2.5 text-sm text-white"
                    />
                  </div>

                  <div className="space-y-3 rounded-xl border border-white/10 bg-white/[.03] p-3">
                    {createForm.role === 'hot' && (
                      <label className="flex items-start gap-2.5 text-sm text-white cursor-pointer">
                        <input
                          type="checkbox"
                          className="mt-0.5 shrink-0"
                          checked={createForm.is_default_payout}
                          onChange={(e) => setCreateForm((f) => ({ ...f, is_default_payout: e.target.checked }))}
                        />
                        <span className="leading-relaxed">Make this the main hot wallet for this coin and network</span>
                      </label>
                    )}
                    <label className="flex items-start gap-2.5 text-sm text-white cursor-pointer">
                      <input
                        type="checkbox"
                        className="mt-0.5 shrink-0"
                        checked={createForm.enabled}
                        onChange={(e) => setCreateForm((f) => ({ ...f, enabled: e.target.checked }))}
                      />
                      <span className="leading-relaxed">Address is active (turn off to pause use of this row)</span>
                    </label>
                  </div>

                  <div>
                    <label className="block text-xs text-white/55 mb-1.5">
                      Idempotency key <span className="text-white/30">(optional)</span>
                    </label>
                    <input
                      value={createForm.idempotency_key}
                      onChange={(e) => setCreateForm((f) => ({ ...f, idempotency_key: e.target.value }))}
                      className="w-full bg-surface-dark border border-surface-border rounded-xl px-3 py-2.5 text-sm font-mono text-white"
                      placeholder="Prevents duplicate save if clicked twice"
                    />
                  </div>
                </div>

                {/* Footer — sticky */}
                <div className="shrink-0 flex flex-col-reverse sm:flex-row gap-2 sm:gap-3 px-4 sm:px-6 py-4 border-t border-surface-border/60 bg-surface-card/95">
                  <button
                    type="button"
                    onClick={() => setCreateOpen(false)}
                    className="w-full sm:w-auto sm:min-w-[100px] px-4 py-2.5 rounded-xl border border-surface-border text-sm font-bold text-white hover:bg-white/5"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={createBusy}
                    className="w-full sm:flex-1 py-2.5 rounded-xl bg-gold/90 text-surface-dark font-bold text-sm disabled:opacity-50"
                  >
                    {createBusy ? 'Saving…' : 'Save wallet'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
