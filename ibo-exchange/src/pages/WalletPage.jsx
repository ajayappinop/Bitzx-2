import { useState, useEffect, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import QrImagePreview from '@/components/ui/QrImagePreview';
import {
  Wallet,   ArrowDownCircle, ArrowUpCircle, RefreshCw, Clock, BarChart2,
  CheckCircle, XCircle, AlertCircle, ChevronDown, Copy, Check,
  ExternalLink, Info, Shield, ScrollText, TrendingUp, IndianRupee, ArrowLeftRight,
} from 'lucide-react';
import { useAuth, authFetch } from '@/context/AuthContext';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { COIN_ICONS, exchangeWsPath, normalizeMarketsList, walletAssetLabel } from '@/services/marketApi';
import { exchangeApiOrigin } from '@/lib/apiBase';
import { MIN_WALLET_NOTIONAL_USDT } from '@/lib/walletValidation';
import {
  normalizeSupportedNetworks,
  filterDepositNetworks,
  filterWithdrawNetworks,
  uniqueAssets,
  networksForAsset,
  activeNetworksForAsset,
  plannedNetworksForAsset,
  defaultAssetSelection,
  isCatalogDepositReady,
} from '@/lib/walletNetworks';
import WalletChainsBanner from '@/components/wallet/WalletChainsBanner';
import NetworkChainDetails from '@/components/wallet/NetworkChainDetails';
import NetworkSelectList from '@/components/wallet/NetworkSelectList';
import DepositTokenSearch from '@/components/wallet/DepositTokenSearch';
import DepositMonitorBanner from '@/components/wallet/DepositMonitorBanner';
import { useDepositMonitor } from '@/hooks/useDepositMonitor';
import { InrMinDepositChip, InrMinDepositNote } from '@/components/inr/InrMinDepositChip';
import { useInrMinDeposit } from '@/hooks/useInrMinDeposit';
import { useDepositCatalog } from '@/hooks/useDepositCatalog';
import FuturesWalletTab from '@/components/futures/FuturesWalletTab';
import IboSwapPanel from '@/components/wallet/IboSwapPanel';
import { cancelInrWithdrawal, fetchInrDeposits, fetchInrWithdrawals } from '@/services/inrApi';
import {
  formatInrAmount,
  formatWalletTxnRef,
  formatInrDepositRefTitle,
  formatInrWithdrawalRefTitle,
  getInrRefDisplay,
  getInrWithdrawalRefDisplay,
  isInrWithdrawalRow,
  formatLedgerAmount,
  ledgerTypeLabel,
  ledgerStatusLabel,
  mergeLedgerWithInrDeposits,
} from '@/lib/inrDisplay';

const API = exchangeApiOrigin(import.meta.env.VITE_BACKEND_URL);

const SUPPORTED_ASSETS = [
  'USDT', 'IBO', 'BTC', 'ETH', 'BNB', 'SOL', 'XRP', 'DOGE', 'ADA', 'POL',
  'AVAX', 'DOT', 'LINK', 'LTC',
];

// NOTE: The deposit asset/network table is no longer hardcoded here. It is
// fetched from ``GET /api/wallet/supported-networks`` so the UI reflects
// whatever combinations the blockchain provider can actually serve (e.g.
// ETH on Sepolia in dev, or ETH+BTC on mainnet in prod). See ``DepositTab``.

const STATUS_STYLES = {
  pending:          { color: 'text-gold', bg: 'bg-gold/10 border-gold/20',  icon: Clock,       label: 'Pending' },
  confirming:       { color: 'text-sky-400',    bg: 'bg-sky-400/10 border-sky-400/20',        icon: RefreshCw,   label: 'Confirming' },
  credited:         { color: 'text-green-400',  bg: 'bg-green-400/10 border-green-400/20',    icon: CheckCircle, label: 'Credited' },
  approved:         { color: 'text-green-400',  bg: 'bg-green-400/10 border-green-400/20',    icon: CheckCircle, label: 'Approved' },
  rejected:         { color: 'text-red-400',    bg: 'bg-red-400/10 border-red-400/20',        icon: XCircle,     label: 'Rejected' },
  pending_kyc:      { color: 'text-gold',  bg: 'bg-gold/10 border-gold/20',    icon: AlertCircle, label: 'KYC required' },
  below_min:        { color: 'text-white/70',   bg: 'bg-white/5 border-[color:var(--ibo-border-solid)]',             icon: AlertCircle, label: 'Below minimum' },
  orphan:           { color: 'text-white/60',   bg: 'bg-white/5 border-[color:var(--ibo-border-solid)]',             icon: AlertCircle, label: 'Unassigned' },
  crediting:        { color: 'text-sky-400',    bg: 'bg-sky-400/10 border-sky-400/20',        icon: RefreshCw,   label: 'Crediting' },
  reorg_review:     { color: 'text-red-300',    bg: 'bg-red-400/10 border-red-400/20',        icon: AlertCircle, label: 'Reorg review' },
  // Phase 6 — withdrawal request statuses.
  pending_approval: { color: 'text-gold', bg: 'bg-gold/10 border-gold/20',  icon: Clock,       label: 'Awaiting approval' },
  awaiting_treasury: { color: 'text-gold', bg: 'bg-gold/10 border-gold/25',     icon: AlertCircle, label: 'Awaiting treasury' },
  broadcasting:     { color: 'text-sky-400',    bg: 'bg-sky-400/10 border-sky-400/20',        icon: RefreshCw,   label: 'Broadcasting' },
  broadcasted:      { color: 'text-sky-400',    bg: 'bg-sky-400/10 border-sky-400/20',        icon: RefreshCw,   label: 'In mempool' },
  confirmed:        { color: 'text-green-400',  bg: 'bg-green-400/10 border-green-400/20',    icon: CheckCircle, label: 'Confirmed' },
  failed:           { color: 'text-red-400',    bg: 'bg-red-400/10 border-red-400/20',        icon: XCircle,     label: 'Failed' },
  approving:        { color: 'text-sky-400',    bg: 'bg-sky-400/10 border-sky-400/20',        icon: RefreshCw,   label: 'Processing' },
  cancelled:        { color: 'text-zinc-200',   bg: 'bg-zinc-500/20 border-zinc-500/30',      icon: XCircle,     label: 'Cancelled' },
};

function StatusBadge({ status }) {
  const s = STATUS_STYLES[status] || STATUS_STYLES.pending;
  const Icon = s.icon;
  const label = s.label || String(status || 'pending').replace(/_/g, ' ');
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold rounded-full border ${s.bg} ${s.color}`}>
      <Icon size={11} /> {label}
    </span>
  );
}

function normalizedInrWithdrawalStatus(status, rejectionReason) {
  const st = String(status || '').toLowerCase();
  const reason = String(rejectionReason || '').trim().toLowerCase();
  if (st === 'rejected' && reason === 'cancelled by user') return 'cancelled';
  return st || 'pending';
}

function CopyBtn({ text }) {
  const [copied, setCopied] = useState(false);
  return (
    <button onClick={() => { navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
      className="text-[color:var(--ibo-muted)] hover:text-gold transition-colors ml-1">
      {copied ? <Check size={12} className="text-green-400" /> : <Copy size={12} />}
    </button>
  );
}

function AssetSelect({ value, onChange, label, assets }) {
  const [open, setOpen] = useState(false);
  // Falls back to the static list so callers that don't pass ``assets``
  // (e.g. the balances tab) keep working identically. Deposit flows pass
  // the dynamic list returned by /api/wallet/supported-networks so the
  // dropdown matches whatever the blockchain provider can actually serve.
  const list = (Array.isArray(assets) && assets.length > 0) ? assets : SUPPORTED_ASSETS;
  return (
    <div className="relative">
      {label && <label className="block text-xs text-[color:var(--ibo-muted)] mb-1.5 uppercase tracking-wider font-semibold">{label}</label>}
      <button type="button" onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between bg-[color:var(--ibo-elevated)] border border-[color:var(--ibo-border-solid)] rounded-xl px-4 py-3 focus:border-gold/50 transition-colors">
        <div className="flex items-center gap-2.5">
          {COIN_ICONS[value]
            ? <img src={COIN_ICONS[value]} alt={walletAssetLabel(value)} className="w-6 h-6 rounded-full" />
            : <div className="w-6 h-6 rounded-full bg-gold/15 flex items-center justify-center text-gold text-[10px] font-bold">{walletAssetLabel(value)?.slice(0, 2)}</div>}
          <span className="text-[color:var(--ibo-ink)] font-semibold">{walletAssetLabel(value)}</span>
        </div>
        <ChevronDown size={14} className={`text-[color:var(--ibo-muted)] transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}
            className="absolute z-50 top-full mt-1 left-0 right-0 bg-[color:var(--ibo-card)] border border-[color:var(--ibo-border-solid)] rounded-xl shadow-[var(--ibo-shadow)] overflow-hidden">
            {list.map(a => (
              <button key={a} type="button"
                onClick={() => { onChange(a); setOpen(false); }}
                className={`w-full flex items-center gap-2.5 px-4 py-2.5 hover:bg-[color:var(--ibo-hover)] transition-colors ${a === value ? 'text-gold' : 'text-[color:var(--ibo-ink)]'}`}>
                {COIN_ICONS[a]
                  ? <img src={COIN_ICONS[a]} alt={walletAssetLabel(a)} className="w-5 h-5 rounded-full" />
                  : <div className="w-5 h-5 rounded-full bg-gold/15 flex items-center justify-center text-gold text-[10px] font-bold">{walletAssetLabel(a).slice(0, 2)}</div>}
                <span className="text-sm font-semibold">{walletAssetLabel(a)}</span>
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ── Balances Tab ─────────────────────────────────────────────────────────────

function BalancesTab({ walletAssets, walletLoading, fetchWallet, priceByAsset, onOpenSwap, onTab }) {
  const px = a => (a === 'USDT' ? 1 : (priceByAsset[a] ?? 0));
  const totalUSD = walletAssets.reduce((s, w) => s + (w.available + w.locked) * px(w.asset), 0);
  const availUSD = walletAssets.reduce((s, w) => s + w.available * px(w.asset), 0);
  const lockedUSD = totalUSD - availUSD;
  const money = (n) => `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const ranked = useMemo(() => {
    return [...walletAssets]
      .map((w) => {
        const total = w.available + w.locked;
        const usd = total * px(w.asset);
        return { ...w, total, usd, weight: totalUSD > 0 ? (usd / totalUSD) * 100 : 0 };
      })
      .sort((a, b) => b.usd - a.usd);
  }, [walletAssets, priceByAsset, totalUSD]);

  return (
    <div className="space-y-5 sm:space-y-6">
      {/* Portfolio command band */}
      <section className="wallet-surface overflow-hidden">
        <div className="flex flex-col xl:flex-row xl:items-stretch">
          <div className="flex-1 min-w-0 px-5 sm:px-6 py-5 sm:py-6 border-b xl:border-b-0 xl:border-r border-[color:var(--ibo-border-solid)]">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[color:var(--ibo-muted)]">
              Spot portfolio
            </p>
            <p className="mt-2 text-3xl sm:text-4xl font-bold tabular-nums tracking-tight text-[color:var(--ibo-ink)]">
              {money(totalUSD)}
            </p>
            <p className="mt-1 text-xs text-[color:var(--ibo-muted)]">
              Estimated USD · {walletAssets.length} asset{walletAssets.length === 1 ? '' : 's'}
            </p>
            <div className="mt-5 flex flex-wrap gap-2">
              <button type="button" onClick={() => onTab?.('deposit')} className="wallet-action-primary">
                <ArrowDownCircle size={14} /> Deposit
              </button>
              <button type="button" onClick={() => onTab?.('withdraw')} className="wallet-action-ghost">
                <ArrowUpCircle size={14} /> Withdraw
              </button>
              <button type="button" onClick={() => onOpenSwap?.()} className="wallet-action-ghost">
                <ArrowLeftRight size={14} /> Swap
              </button>
            </div>
          </div>
          <div className="xl:w-[min(100%,22rem)] grid grid-cols-3 xl:grid-cols-1 divide-x xl:divide-x-0 xl:divide-y divide-[color:var(--ibo-border-solid)]">
            {[
              { label: 'Available', value: money(availUSD), tone: 'text-[#0ECB81]' },
              { label: 'Locked', value: money(lockedUSD), tone: 'text-[#FE6C02]' },
              { label: 'In orders', value: money(lockedUSD), tone: 'text-[color:var(--ibo-ink-secondary)]' },
            ].map((s) => (
              <div key={s.label} className="px-4 sm:px-5 py-4 min-w-0">
                <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[color:var(--ibo-muted)] truncate">
                  {s.label}
                </p>
                <p className={`mt-1.5 text-base sm:text-lg font-bold tabular-nums tracking-tight ${s.tone}`}>
                  {s.value}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Asset inventory list */}
      <section className="wallet-surface overflow-hidden">
        <div className="flex items-center justify-between gap-3 px-5 sm:px-6 py-3.5 border-b border-[color:var(--ibo-border-solid)]">
          <div>
            <h2 className="text-sm font-bold text-[color:var(--ibo-ink)]">Balances</h2>
            <p className="text-[11px] text-[color:var(--ibo-muted)] mt-0.5">Spot holdings by USD weight</p>
          </div>
          <button
            type="button"
            onClick={fetchWallet}
            disabled={walletLoading}
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-[color:var(--ibo-muted)] hover:text-[color:var(--ibo-ink)] disabled:opacity-40"
          >
            <RefreshCw size={13} className={walletLoading ? 'animate-spin' : ''} /> Refresh
          </button>
        </div>

        {ranked.length === 0 ? (
          <div className="px-6 py-14 text-center">
            <Wallet className="mx-auto text-[color:var(--ibo-muted)] opacity-40 mb-3" size={28} />
            <p className="text-sm font-semibold text-[color:var(--ibo-ink)]">No spot balances yet</p>
            <p className="text-xs text-[color:var(--ibo-muted)] mt-1">Deposit crypto or INR to fund your wallet.</p>
            <button type="button" onClick={() => onTab?.('deposit')} className="wallet-action-primary mt-4 mx-auto">
              Deposit now
            </button>
          </div>
        ) : (
          <ul className="divide-y divide-[color:var(--ibo-border-solid)]">
            {ranked.map((w) => {
              const icon = COIN_ICONS[w.asset];
              const dp = w.asset === 'USDT' ? 2 : 6;
              return (
                <li
                  key={w.asset}
                  className="px-5 sm:px-6 py-4 sm:py-3.5 flex flex-col gap-3 sm:gap-0 sm:flex-row sm:items-center sm:justify-between hover:bg-white/[0.02] transition-colors"
                >
                  <div className="flex items-center gap-3 min-w-0 sm:w-[28%]">
                    {icon
                      ? <img src={icon} alt="" className="w-9 h-9 rounded-full shrink-0" />
                      : (
                        <div className="w-9 h-9 rounded-full bg-[#FE6C02]/15 flex items-center justify-center text-[#FE6C02] text-xs font-bold shrink-0">
                          {w.asset.slice(0, 2)}
                        </div>
                      )}
                    <div className="min-w-0">
                      <p className="font-bold text-[color:var(--ibo-ink)]">{walletAssetLabel(w.asset)}</p>
                      <div className="mt-1.5 h-1 w-24 sm:w-28 rounded-full bg-white/[0.06] overflow-hidden">
                        <div
                          className="h-full rounded-full bg-[#FE6C02]/80"
                          style={{ width: `${Math.min(100, Math.max(w.weight, w.weight > 0 ? 2 : 0))}%` }}
                        />
                      </div>
                      <p className="text-[10px] text-[color:var(--ibo-muted)] mt-0.5 tabular-nums">
                        {w.weight.toFixed(1)}% portfolio
                      </p>
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-3 sm:flex sm:items-center sm:gap-8 sm:flex-1 min-w-0">
                    <div className="min-w-0 sm:text-right sm:min-w-[5.5rem]">
                      <p className="text-[10px] uppercase tracking-wide text-[color:var(--ibo-muted)]">Available</p>
                      <p className="font-mono text-sm font-semibold text-[#0ECB81] tabular-nums truncate">
                        {w.available.toFixed(dp)}
                      </p>
                    </div>
                    <div className="min-w-0 sm:text-right sm:min-w-[5.5rem]">
                      <p className="text-[10px] uppercase tracking-wide text-[color:var(--ibo-muted)]">Locked</p>
                      <p className="font-mono text-sm font-semibold text-[#FE6C02] tabular-nums truncate">
                        {w.locked.toFixed(dp)}
                      </p>
                    </div>
                    <div className="min-w-0 sm:text-right sm:min-w-[6.5rem]">
                      <p className="text-[10px] uppercase tracking-wide text-[color:var(--ibo-muted)]">Value</p>
                      <p className="font-mono text-sm font-bold text-[color:var(--ibo-ink)] tabular-nums">
                        {money(w.usd)}
                      </p>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-1.5 sm:justify-end sm:w-auto sm:shrink-0 sm:ml-4">
                    {w.asset === 'IBO' && onOpenSwap ? (
                      <button type="button" onClick={onOpenSwap} className="wallet-chip-btn">
                        Swap
                      </button>
                    ) : null}
                    <Link to={`/trade/${w.asset}USDT?side=buy`} className="wallet-chip-btn wallet-chip-btn--pos">
                      Buy
                    </Link>
                    {w.asset !== 'USDT' && (
                      <Link
                        to={`/trade/${w.asset}USDT?side=sell`}
                        className={`wallet-chip-btn ${w.available > 1e-12 ? 'wallet-chip-btn--neg' : 'opacity-35 pointer-events-none'}`}
                        onClick={(e) => { if (w.available <= 1e-12) e.preventDefault(); }}
                      >
                        Sell
                      </Link>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

// ── Deposit Tab ───────────────────────────────────────────────────────────────

function DepositTab({ kycBlocked, kyc }) {
  const { minDepositInr } = useInrMinDeposit();
  // Supported (asset, network) combinations come from the backend —
  // GET /api/wallet/supported-networks reflects the live provider
  // configuration (which QuickNode URLs are set, mainnet vs testnet, …).
  // ``asset`` / ``network`` are empty strings until the list lands so we
  // never fire a deposit-addresses call with a combo the server can't serve.
  const [depositMode, setDepositMode] = useState('bsc'); // bsc | all
  const [depositOnlyFilter, setDepositOnlyFilter] = useState(false);
  const {
    query: catalogQuery,
    setQuery: setCatalogQuery,
    items: bscCatalog,
    assets: bscAssets,
    bep20Meta,
    loading: catalogLoading,
    loadingMore: catalogLoadingMore,
    error: catalogError,
    total: catalogTotal,
    counts: catalogCounts,
    hasMore: catalogHasMore,
    loadMore: loadMoreCatalog,
  } = useDepositCatalog({
    chain: 'bsc',
    enabled: depositMode === 'bsc',
    depositOnlyFilter,
  });

  const [supportedAll, setSupportedAll] = useState([]);
  const [netsLoading, setNetsLoading]   = useState(true);
  const [netsError, setNetsError]       = useState(null);
  const depositActive = filterDepositNetworks(supportedAll);
  const [asset,   setAsset]             = useState('');
  const [network, setNetwork]           = useState('');
  const [depositAddresses, setDepositAddresses] = useState([]);
  const [depAddrLoading, setDepAddrLoading]     = useState(false);
  const [depAddrError, setDepAddrError]         = useState(null);

  // Fetch supported networks once on mount. This endpoint is public so it
  // works the same way regardless of auth state.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setNetsLoading(true);
      setNetsError(null);
      try {
        const res = await fetch(`${API}/api/wallet/supported-networks`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (cancelled) return;
        const list = normalizeSupportedNetworks(data);
        setSupportedAll(list);
        const { asset: a0, network: n0 } = defaultAssetSelection(list);
        setAsset(a0);
        setNetwork(n0);
      } catch (e) {
        if (!cancelled) {
          setSupportedAll([]);
          setNetsError(
            e?.message?.includes('Failed to fetch')
              ? 'Could not reach the API. Check VITE_BACKEND_URL and CORS.'
              : 'Could not load supported networks. Try again in a moment.',
          );
        }
      } finally {
        if (!cancelled) setNetsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const availableAssets = uniqueAssets(supportedAll);
  const networksForAssetAll = networksForAsset(supportedAll, asset);
  const networksActive = activeNetworksForAsset(supportedAll, asset);
  const networksPlanned = plannedNetworksForAsset(supportedAll, asset);
  const hasAnyChains = supportedAll.length > 0 || (depositMode === 'bsc' && bscCatalog.length > 0);
  const hasDepositActive =
    depositActive.length > 0
    || (depositMode === 'bsc' && bscCatalog.some((it) => isCatalogDepositReady(it)));

  useEffect(() => {
    // Don't hit the deposit-addresses endpoint until we know which combo
    // the provider supports; otherwise the server just returns 400.
    const sel = networksForAsset(supportedAll, asset).find((n) => n.network === network);
    const catalogSel = bscCatalog.find((it) => it.asset === asset && it.network === network);
    const canDeposit =
      (sel?.deposit_enabled && sel?.status === 'active')
      || isCatalogDepositReady(catalogSel);
    if (!asset || !network || !canDeposit) {
      setDepositAddresses([]);
      setDepAddrError(canDeposit ? null : (sel?.status === 'coming_soon'
        ? 'Deposits for this network are not live yet. Choose an active network.'
        : null));
      setDepAddrLoading(false);
      return undefined;
    }
    let cancelled = false;
    (async () => {
      setDepAddrLoading(true);
      setDepAddrError(null);
      try {
        const u = new URLSearchParams({ asset, network });
        // Phase 4 — strictly the authenticated user's HD-derived deposit
        // address. The backend no longer returns shared fallback addresses,
        // so this list has at most one row (the user's own).
        const res = await authFetch(`${API}/api/wallet/deposit-addresses?${u}`);
        if (!res.ok) {
          let detail = `Could not load deposit addresses (HTTP ${res.status}).`;
          try {
            const j = await res.json();
            if (j?.detail) detail = typeof j.detail === 'string' ? j.detail : JSON.stringify(j.detail);
          } catch {
            /* ignore */
          }
          if (!cancelled) {
            setDepositAddresses([]);
            setDepAddrError(detail);
          }
          return;
        }
        const data = await res.json();
        if (cancelled) return;
        const list = Array.isArray(data) ? data : [];
        setDepositAddresses(list);
      } catch (e) {
        if (!cancelled) {
          setDepositAddresses([]);
          const isNet =
            e?.name === 'TypeError'
            || (typeof e?.message === 'string' && /fetch|network|Failed to fetch/i.test(e.message));
          setDepAddrError(
            isNet
              ? 'Could not reach the API. Confirm VITE_BACKEND_URL matches your backend and that CORS allows this site.'
              : 'Could not load deposit addresses. Try again in a moment.',
          );
        }
      } finally {
        if (!cancelled) setDepAddrLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [asset, network, supportedAll, bscCatalog]);

  const handleAsset = (a) => {
    setAsset(a);
    const active = activeNetworksForAsset(supportedAll, a);
    const nets = networksForAsset(supportedAll, a);
    setNetwork(active[0]?.network || nets[0]?.network || '');
  };

  const handleBscToken = (sym, catalogItem) => {
    setAsset(sym);
    setNetwork(catalogItem?.network || 'BEP-20 (BNB Chain)');
  };

  useEffect(() => {
    if (depositMode !== 'bsc' || bscCatalog.length === 0) return;
    if (asset && bscCatalog.some((it) => it.asset === asset)) return;
    const first = bscCatalog.find((it) => isCatalogDepositReady(it)) || bscCatalog[0];
    if (first) {
      setAsset(first.asset);
      setNetwork(first.network);
    }
  }, [depositMode, bscCatalog, asset]);

  const selectedCatalogItem = bscCatalog.find((it) => it.asset === asset) ?? null;
  const showUniversalBanner = Boolean(
    selectedCatalogItem?.universal_bep20 || bep20Meta?.enabled,
  );

  const personalAddress = depositAddresses[0] || null;
  const hasSupported = hasAnyChains;
  const selectedNet = networksForAssetAll.find((n) => n.network === network)
    || (selectedCatalogItem
      ? {
          asset: selectedCatalogItem.asset,
          network: selectedCatalogItem.network,
          deposit_enabled: selectedCatalogItem.deposit_enabled,
          status: selectedCatalogItem.status,
        }
      : null);
  const depositReady =
    (selectedNet?.deposit_enabled && selectedNet?.status === 'active')
    || isCatalogDepositReady(selectedCatalogItem);

  return (
    <div className="space-y-5">
      <div className="wallet-surface px-5 sm:px-6 py-4 sm:py-5 flex flex-wrap items-center justify-between gap-4">
        <div className="min-w-0">
          <p className="text-[color:var(--ibo-ink)] font-bold flex flex-wrap items-center gap-2 text-sm sm:text-base">
            <IndianRupee size={16} className="text-[#FE6C02] shrink-0" />
            <span>Deposit via INR (Bank / UPI / QR)</span>
            <InrMinDepositChip minDepositInr={minDepositInr} />
          </p>
          <p className="text-xs sm:text-sm text-[color:var(--ibo-muted)] mt-1 max-w-xl leading-relaxed">
            Pay in Indian Rupees, upload transfer proof, receive tokens after admin approval.
          </p>
          <InrMinDepositNote minDepositInr={minDepositInr} className="mt-2 max-w-xl" />
        </div>
        <Link to="/wallet/deposit/inr" className="wallet-action-primary shrink-0">
          Deposit INR
        </Link>
      </div>

    <div className="grid md:grid-cols-2 gap-5 lg:gap-6">
      {/* Address panel (left column — was the manual submit form) */}
      <div className="wallet-surface p-5 sm:p-6">
        <h3 className="text-base font-bold text-[color:var(--ibo-ink)] mb-1">Your deposit address</h3>
        <p className="text-[color:var(--ibo-ink-secondary)] text-sm mb-5 leading-relaxed">
          Send funds to your personal address below. Deposits are detected on-chain and credited
          after confirmations. Track progress under <strong className="text-[color:var(--ibo-ink)]">History → Deposits</strong>.
        </p>

        {kycBlocked && (
          <div className={`mb-4 rounded-xl border px-4 py-3 text-sm flex flex-wrap items-center gap-2 ${
            kyc?.status === 'pending'
              ? 'ibo-notice-info'
              : 'ibo-notice-danger'
          }`}>
            <Shield size={16} className="flex-shrink-0" />
            <span>
              {kyc?.status === 'pending'
                ? 'Your KYC is pending admin review. You can view your deposit address, but deposits will only be credited after approval.'
                : kyc?.status === 'rejected'
                  ? 'Your KYC was rejected. Resubmit documents to unlock deposits. Your deposit address still appears below.'
                  : 'Identity verification (KYC) is required before deposits are credited. Your personal deposit address still appears below so you can prepare.'}{' '}
              <Link to="/kyc" className="font-bold underline text-gold">Go to KYC →</Link>
            </span>
          </div>
        )}

        <div className="space-y-4">
          <div className="flex flex-wrap gap-2 mb-1">
            {[
              { id: 'bsc', label: 'BNB Chain (BEP-20)' },
              { id: 'all', label: 'All networks' },
            ].map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => setDepositMode(m.id)}
                className={`ibo-mode-chip ${depositMode === m.id ? 'ibo-mode-chip-active' : ''}`}
              >
                {m.label}
              </button>
            ))}
          </div>

          <p className="ibo-field-label -mb-1">Step 1 — Asset &amp; network</p>

          {depositMode === 'bsc' && (
            <DepositTokenSearch
              items={bscCatalog}
              assets={bscAssets}
              value={asset}
              onChange={handleBscToken}
              query={catalogQuery}
              onQueryChange={setCatalogQuery}
              loading={catalogLoading}
              loadingMore={catalogLoadingMore}
              error={catalogError}
              bep20Note={bep20Meta}
              disabled={catalogLoading && !bscCatalog.length}
              label="Search BEP-20 coin"
              total={catalogTotal}
              counts={catalogCounts}
              hasMore={catalogHasMore}
              onLoadMore={loadMoreCatalog}
              depositOnlyFilter={depositOnlyFilter}
              onDepositOnlyFilterChange={setDepositOnlyFilter}
            />
          )}

          {depositMode === 'bsc' && showUniversalBanner && personalAddress && (
            <div className="rounded-xl border border-gold/25 bg-gold/10 px-3 py-2.5 text-xs text-ink-secondary">
              This address accepts any supported <strong className="text-white">BEP-20</strong> token on BNB Chain.
              Send only <strong className="text-gold font-mono">{asset}</strong> — wrong tokens may be lost.
            </div>
          )}

          {depositMode === 'all' && netsLoading && (
            <p className="text-xs text-white/45">Loading supported networks…</p>
          )}
          {depositMode === 'all' && netsError && !netsLoading && (
            <div className="rounded-xl border border-gold/35 bg-gold/10 px-3 py-2.5 text-xs text-gold/90">
              <span className="font-bold text-gold">Could not load networks: </span>{netsError}
            </div>
          )}
          {depositMode === 'all' && !netsLoading && !netsError && !hasSupported && (
            <div className="rounded-xl border border-surface-border bg-surface-card/50 px-3 py-2.5 text-xs text-white/65">
              No blockchain endpoints are configured. Add QuickNode URLs in the server environment.
            </div>
          )}
          {depositMode === 'bsc' && catalogError && !catalogLoading && (
            <div className="rounded-xl border border-gold/35 bg-gold/10 px-3 py-2.5 text-xs text-gold/90">
              <span className="font-bold text-gold">Catalog: </span>{catalogError}
            </div>
          )}
          {depositMode === 'bsc' && selectedCatalogItem && (
            <NetworkChainDetails
              network={{
                asset: selectedCatalogItem.asset,
                network: selectedCatalogItem.network,
                label: selectedCatalogItem.label,
                chain_id: selectedCatalogItem.chain_id,
                chain_display: selectedCatalogItem.chain_display || 'BNB Smart Chain',
                deposit_enabled: isCatalogDepositReady(selectedCatalogItem),
                status: selectedCatalogItem.status,
                testnet: selectedCatalogItem.testnet,
              }}
              mode="deposit"
            />
          )}
          {depositMode === 'all' && hasSupported && (
            <>
              <AssetSelect value={asset} onChange={handleAsset} label="Asset" assets={availableAssets} />

              <div>
                <label className="ibo-field-label">Network</label>
                <NetworkSelectList
                  networks={networksActive}
                  plannedNetworks={networksPlanned}
                  value={network}
                  onChange={setNetwork}
                  mode="deposit"
                />
              </div>
              {selectedNet ? (
                <NetworkChainDetails network={selectedNet} mode="deposit" />
              ) : null}
              {!depositReady && selectedNet?.status === 'coming_soon' && (
                <div className="rounded-xl border border-gold/30 bg-gold/10 px-3 py-2.5 text-xs text-gold/90">
                  RPC is configured for <strong>{selectedNet.endpoint_label || selectedNet.chain}</strong>.
                  On-chain deposit scanning for this network is not live yet — choose an active network to deposit.
                </div>
              )}
              {hasSupported && !hasDepositActive && (
                <div className="rounded-xl border border-gold/30 bg-gold/10 px-3 py-2.5 text-xs text-gold/90">
                  No deposit networks are active yet. Listed assets reflect your configured endpoints.
                </div>
              )}
            </>
          )}

          <p className="text-[11px] text-white/55 uppercase font-bold tracking-wider pt-1">Step 2 — Scan or copy</p>

          {hasSupported && depAddrLoading && (
            <p className="text-xs text-white/45">Loading your deposit address…</p>
          )}
          {hasSupported && depAddrError && !depAddrLoading && (
            <div className="rounded-xl border border-gold/35 bg-gold/10 px-3 py-2.5 text-xs text-gold/90">
              <span className="font-bold text-gold">Could not load address: </span>
              {depAddrError}
            </div>
          )}
          {hasSupported && !depAddrLoading && !depAddrError && personalAddress && (
            <div className="rounded-xl border border-gold/30 bg-gold/5 p-4 flex flex-col sm:flex-row gap-4 items-start">
              <div className="shrink-0">
                <QrImagePreview
                  key={`${personalAddress.id}-${(personalAddress.qr_payload || personalAddress.address || '').slice(0, 96)}`}
                  value={personalAddress.qr_payload || personalAddress.address}
                  size={200}
                  modalSize={400}
                />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-bold text-gold mb-2">{personalAddress.label || 'Your deposit address'}</p>
                <p className="text-[11px] text-white/45 uppercase mb-1">Address</p>
                <p className="text-sm text-white font-mono break-all leading-relaxed">{personalAddress.address}</p>
                <div className="mt-3 flex items-center gap-2">
                  <span className="text-[10px] text-white/50">Copy</span>
                  <CopyBtn text={personalAddress.address} />
                </div>
              </div>
            </div>
          )}
          {hasSupported && !depAddrLoading && !depAddrError && !personalAddress && (
            <div className="rounded-xl border border-surface-border bg-surface-card/50 px-3 py-2.5 text-xs text-white/65 space-y-1.5">
              <p>
                A deposit address for <strong className="text-gold font-mono">{asset}</strong>{' '}
                on <strong className="text-white font-mono">{network}</strong> is not available yet.
              </p>
              <p className="text-white/50">
                The blockchain provider may not support this asset / network combination yet, or
                onboarding is still in progress. Try another network, or contact support if this
                persists.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Info panel */}
      <div className="space-y-4">
        <div className="wallet-surface p-5 sm:p-6">
          <p className="text-[color:var(--ibo-ink)] font-bold mb-3 flex items-center gap-2 text-sm">
            <Info size={15} className="text-[#FE6C02]" /> How it works
          </p>
          <ol className="space-y-3 text-sm text-[color:var(--ibo-ink-secondary)]">
            {[
              'Pick the asset and network you want to deposit.',
              'Scan the QR code or copy your personal deposit address.',
              'Send the funds from your external wallet to that address.',
              'The network confirms, we detect the transaction and credit your balance automatically.',
            ].map((step, i) => (
              <li key={i} className="flex items-start gap-3">
                <span className="wallet-step-num">{i + 1}</span>
                {step}
              </li>
            ))}
          </ol>
        </div>

        <div className="wallet-surface p-5 border-[#FE6C02]/25">
          <p className="text-[#FE6C02] font-semibold text-sm flex items-center gap-1.5 mb-2">
            <AlertCircle size={14} /> Important
          </p>
          <ul className="text-xs text-[color:var(--ibo-ink-secondary)] space-y-1.5 list-disc list-inside">
            <li>Always send on the correct network to avoid permanent loss.</li>
            <li>Minimum deposit: {MIN_WALLET_NOTIONAL_USDT} USDT equivalent.</li>
            <li>Your balance is credited automatically once the required confirmations are reached.</li>
            <li>Incoming transactions appear in the History tab as soon as they are detected on-chain.</li>
          </ul>
        </div>
      </div>
    </div>
    </div>
  );
}

// ── Withdraw Tab ──────────────────────────────────────────────────────────────

function WithdrawTab({ walletAssets, kycBlocked, kyc, priceByAsset = { USDT: 1 } }) {
  // Phase 6 — on-chain withdrawals via BlockchainProvider.send_transaction.
  // Only assets the backend can actually broadcast appear in the dropdown;
  // the same ``/api/wallet/supported-networks`` endpoint powers both tabs.
  const [supportedAll, setSupportedAll] = useState([]);
  const [netsLoading, setNetsLoading] = useState(true);
  const [netsError, setNetsError]     = useState(null);
  const [asset,   setAsset]           = useState('');
  const [network, setNetwork]         = useState('');
  const [address, setAddress]         = useState('');
  const [amount,  setAmount]          = useState('');
  const [note,    setNote]            = useState('');
  const [totp,    setTotp]            = useState('');
  const [submitting, setSubmitting]   = useState(false);
  const [submitError, setSubmitError] = useState(null);
  const [submitOk,    setSubmitOk]    = useState(null);
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [touched, setTouched] = useState({ address: false, amount: false, totp: false });
  const [fieldErrors, setFieldErrors] = useState({ address: '', amount: '', totp: '' });

  // Phase 7a — fetch 2FA status so we know whether to show the TOTP input
  // (user has enrolled) and whether it's strictly required. Refreshed on
  // every mount so a user who just turned 2FA off in another tab doesn't
  // keep seeing the input.
  const [twofa, setTwofa] = useState({ enabled: false, required_for_withdrawal: false });
  const [withdrawConfig, setWithdrawConfig] = useState({
    withdraw_fee_rate: 0,
    withdraw_gas_fee_ibo: 0,
    ibo_price_usdt: 0,
    gas_fee_description: '',
    platform_fee_description: '',
  });
  useEffect(() => {
    (async () => {
      try {
        const res = await authFetch(`${API}/api/auth/2fa/status`);
        if (res.ok) setTwofa(await res.json());
      } catch { /* silent — worst case the UI just hides the field */ }
    })();
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${API}/api/wallet/withdraw-config`);
        if (!res.ok) return;
        const data = await res.json();
        setWithdrawConfig({
          withdraw_fee_rate: Number(data?.withdraw_fee_rate || 0),
          withdraw_gas_fee_ibo: Number(data?.withdraw_gas_fee_ibo || 0),
          ibo_price_usdt: Number(data?.ibo_price_usdt || 0),
          gas_fee_description: data?.gas_fee_description || '',
          platform_fee_description: data?.platform_fee_description || '',
        });
      } catch { /* fee panel stays hidden when config unavailable */ }
    })();
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setNetsLoading(true);
      setNetsError(null);
      try {
        const res = await fetch(`${API}/api/wallet/supported-networks`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (cancelled) return;
        const list = normalizeSupportedNetworks(data);
        setSupportedAll(list);
        const withdrawActive = filterWithdrawNetworks(list).filter(
          (n) => String(n.asset || '').toUpperCase() !== 'IBO',
        );
        if (withdrawActive.length > 0) {
          setAsset(withdrawActive[0].asset);
          setNetwork(withdrawActive[0].network);
        } else {
          const { asset: a0, network: n0 } = defaultAssetSelection(list);
          setAsset(a0);
          setNetwork(n0);
        }
      } catch (e) {
        if (!cancelled) {
          setSupportedAll([]);
          setNetsError(
            e?.message?.includes('Failed to fetch')
              ? 'Could not reach the API. Check VITE_BACKEND_URL and CORS.'
              : 'Could not load supported networks. Try again in a moment.',
          );
        }
      } finally {
        if (!cancelled) setNetsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const withdrawActive = filterWithdrawNetworks(supportedAll);
  const availableAssets = uniqueAssets(supportedAll).filter((a) => String(a).toUpperCase() !== 'IBO');
  const isIboSelected = String(asset || '').toUpperCase() === 'IBO';
  const networksForAssetAll = networksForAsset(supportedAll, asset);
  const networksWithdrawActive = networksForAssetAll.filter((n) => n.withdraw_enabled && n.status === 'active');
  const networksWithdrawPlanned = networksForAssetAll.filter(
    (n) => !n.withdraw_enabled || n.status === 'coming_soon',
  );
  const hasSupported = supportedAll.length > 0;
  const hasWithdrawActive = withdrawActive.length > 0;
  const selectedNet = networksForAssetAll.find((n) => n.network === network);
  const withdrawReady = selectedNet?.withdraw_enabled && selectedNet?.status === 'active';

  const handleAsset = (a) => {
    setAsset(a);
    const active = networksForAsset(supportedAll, a).filter(
      (n) => n.withdraw_enabled && n.status === 'active',
    );
    const nets = networksForAsset(supportedAll, a);
    setNetwork(active[0]?.network || nets[0]?.network || '');
  };

  useEffect(() => {
    if (String(asset || '').toUpperCase() !== 'IBO' || availableAssets.length === 0) return;
    const next = availableAssets[0];
    setAsset(next);
    const active = networksForAsset(supportedAll, next).filter(
      (n) => n.withdraw_enabled && n.status === 'active',
    );
    const nets = networksForAsset(supportedAll, next);
    setNetwork(active[0]?.network || nets[0]?.network || '');
  }, [asset, availableAssets, supportedAll]);

  // Available balance for the currently selected asset (drives the Max button
  // + live balance readout). ``walletAssets`` is the canonical source from
  // AuthContext so trades and other tabs stay in sync.
  const assetRow = (walletAssets || []).find(w => w.asset === asset) || { available: 0, locked: 0 };
  const availableBalance = Number(assetRow.available || 0);
  const iboRow = (walletAssets || []).find(w => w.asset === 'IBO') || { available: 0, locked: 0 };
  const iboAvailable = Number(iboRow.available || 0);
  const amtNum = Number(amount);
  const withdrawNotionalUsdt = (() => {
    if (!Number.isFinite(amtNum) || amtNum <= 0) return 0;
    const a = String(asset || '').toUpperCase();
    const px = a === 'USDT' ? 1 : Number(priceByAsset[a] ?? 0);
    if (px > 0) return amtNum * px;
    if (a === 'IBO' && withdrawConfig.ibo_price_usdt > 0) {
      return amtNum * withdrawConfig.ibo_price_usdt;
    }
    return 0;
  })();
  const platformFeeUsdt = withdrawNotionalUsdt > 0
    ? withdrawNotionalUsdt * withdrawConfig.withdraw_fee_rate
    : 0;
  const platformFeeIbo = platformFeeUsdt > 0 && withdrawConfig.ibo_price_usdt > 0
    ? platformFeeUsdt / withdrawConfig.ibo_price_usdt
    : 0;
  const iboGasFee = asset.toUpperCase() === 'IBO' ? 0 : withdrawConfig.withdraw_gas_fee_ibo;
  const totalAssetDebit = Number.isFinite(amtNum) && amtNum > 0 ? amtNum : 0;
  const totalIboFees = platformFeeIbo + iboGasFee;
  const showFeePanel = withdrawConfig.withdraw_fee_rate > 0 || iboGasFee > 0;

  const onSubmit = async (e) => {
    e.preventDefault();
    setSubmitAttempted(true);
    setSubmitError(null);
    setSubmitOk(null);
    const nextErrors = { address: '', amount: '', totp: '' };
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt <= 0) nextErrors.amount = 'Enter a valid amount.';
    if (!address.trim()) nextErrors.address = 'Enter a destination address.';
    if (twofa.enabled && !totp.trim()) nextErrors.totp = 'Enter the code from your authenticator app (or a backup code).';
    setFieldErrors(nextErrors);
    if (!asset || !network) {
      setSubmitError('Please pick an asset and network.');
      return;
    }
    if (String(asset).toUpperCase() === 'IBO' && !withdrawReady) {
      setSubmitError('Delta on-chain withdrawal is not enabled yet. Use Withdraw INR for bank/UPI, or try again later.');
      return;
    }
    if (!withdrawReady) {
      setSubmitError('Withdrawals are not enabled for this network yet.');
      return;
    }
    if (nextErrors.amount || nextErrors.address || nextErrors.totp) {
      return;
    }
    if (totalAssetDebit > availableBalance + 1e-12) {
      setSubmitError(`Insufficient ${asset} balance (need ${totalAssetDebit.toFixed(8)} for withdrawal).`);
      return;
    }
    if (totalIboFees > 0 && totalIboFees > iboAvailable + 1e-12) {
      setSubmitError(
        `Insufficient Delta for fees (need ~${totalIboFees.toFixed(8)} Delta: `
        + `${platformFeeIbo > 0 ? `platform ~${platformFeeIbo.toFixed(8)}` : ''}`
        + `${platformFeeIbo > 0 && iboGasFee > 0 ? ', ' : ''}`
        + `${iboGasFee > 0 ? `gas ${iboGasFee.toFixed(8)}` : ''}).`,
      );
      return;
    }
    setSubmitting(true);
    try {
      const res = await authFetch(`${API}/api/wallet/withdraw`, {
        method: 'POST',
        body: JSON.stringify({
          asset, network, address: address.trim(),
          amount: amt, note: note.trim() || null,
          totp: totp.trim() || null,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.detail || `Withdrawal failed (HTTP ${res.status}).`);
      }
      setSubmitOk({
        id: data?.withdrawal?.id,
        status: data?.withdrawal?.status,
        auto: !!data?.withdrawal?.auto_approved,
      });
      setAmount('');
      setAddress('');
      setNote('');
      setTotp('');
    } catch (err) {
      setSubmitError(err.message || 'Could not submit withdrawal.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="wallet-surface px-5 sm:px-6 py-4 sm:py-5 flex flex-wrap items-center justify-between gap-4">
        <div className="min-w-0">
          <p className="text-[color:var(--ibo-ink)] font-bold flex items-center gap-2 text-sm sm:text-base">
            <IndianRupee size={16} className="text-[#FE6C02]" />
            Withdraw to INR (Bank / UPI)
          </p>
          <p className="text-xs sm:text-sm text-[color:var(--ibo-muted)] mt-1 max-w-xl leading-relaxed">
            Sell Delta for rupees — cash out Delta to bank or UPI after admin approval.
          </p>
        </div>
        <Link to="/wallet/withdraw/inr" className="wallet-action-primary shrink-0">
          Withdraw INR
        </Link>
      </div>

    <div className="grid md:grid-cols-2 gap-5 lg:gap-6">
      <div className="wallet-surface p-5 sm:p-6">
        <h3 className="text-base font-bold text-[color:var(--ibo-ink)] mb-1">On-chain withdraw</h3>
        <p className="text-[color:var(--ibo-ink-secondary)] text-sm mb-5 leading-relaxed">
          Withdrawals are broadcast on-chain automatically. Large amounts may require admin
          approval. Track progress in the History tab.
        </p>

        {kycBlocked && (
          <div className={`mb-4 rounded-xl border px-4 py-3 text-sm flex flex-wrap items-center gap-2 ${
            kyc?.status === 'pending'
              ? 'ibo-notice-info'
              : 'ibo-notice-danger'
          }`}>
            <Shield size={16} className="flex-shrink-0" />
            <span>
              {kyc?.status === 'pending'
                ? 'Your KYC is pending review. Withdrawals unlock after approval.'
                : kyc?.status === 'rejected'
                  ? 'Your KYC was rejected. Resubmit documents to unlock withdrawals.'
                  : 'Identity verification (KYC) is required before withdrawing.'}{' '}
              <Link to="/kyc" className="font-bold underline text-gold">Go to KYC →</Link>
            </span>
          </div>
        )}

        {netsLoading && (
          <p className="text-xs text-white/45">Loading supported networks…</p>
        )}
        {netsError && !netsLoading && (
          <div className="rounded-xl border border-gold/35 bg-gold/10 px-3 py-2.5 text-xs text-gold/90">
            <span className="font-bold text-gold">Could not load networks: </span>{netsError}
          </div>
        )}
        {!netsLoading && !netsError && !hasSupported && (
          <div className="rounded-xl border border-surface-border bg-surface-card/50 px-3 py-2.5 text-xs text-white/65">
            No blockchain endpoints are configured.
          </div>
        )}

        {hasSupported && (
          <form onSubmit={onSubmit} className="space-y-4">
            {isIboSelected && !withdrawReady && (
              <div className="rounded-xl border border-gold/30 bg-gold/10 px-4 py-3 text-sm text-gold/90">
                Delta on-chain withdrawal is not active on this network yet. Use{' '}
                <Link to="/wallet/withdraw/inr" className="font-bold text-gold underline">
                  Withdraw INR
                </Link>{' '}
                to receive rupees in your bank or UPI.
              </div>
            )}
            {isIboSelected && withdrawReady && (
              <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100">
                Send Delta to any external BEP-20 wallet. For INR (bank/UPI), use{' '}
                <Link to="/wallet/withdraw/inr" className="font-bold text-emerald-200 underline">
                  Withdraw INR
                </Link>.
              </div>
            )}
            <AssetSelect value={asset} onChange={handleAsset} label="Asset" assets={availableAssets} />

            <div>
              <label className="ibo-field-label">Network</label>
              <NetworkSelectList
                networks={networksWithdrawActive}
                plannedNetworks={networksWithdrawPlanned}
                value={network}
                onChange={setNetwork}
                mode="withdraw"
              />
            </div>
            {selectedNet ? (
              <NetworkChainDetails network={selectedNet} mode="withdraw" />
            ) : null}
            {!withdrawReady && selectedNet && (
              <div className="rounded-xl border border-gold/30 bg-gold/10 px-3 py-2.5 text-xs text-gold/90">
                Withdrawals for {selectedNet.label || selectedNet.network} are not enabled yet.
                {hasWithdrawActive ? ' Choose an active network above.' : ''}
              </div>
            )}
            {hasSupported && !hasWithdrawActive && (
              <div className="rounded-xl border border-gold/30 bg-gold/10 px-3 py-2.5 text-xs text-gold/90">
                No withdrawal networks are active. Assets listed match your configured RPC endpoints.
              </div>
            )}

            <div>
              <label className="ibo-field-label">Destination address</label>
              <input
                type="text"
                value={address}
                onChange={e => {
                  setAddress(e.target.value);
                  setFieldErrors(prev => ({ ...prev, address: '' }));
                }}
                onBlur={() => {
                  setTouched(prev => ({ ...prev, address: true }));
                  setFieldErrors(prev => ({ ...prev, address: address.trim() ? '' : 'Enter a destination address.' }));
                }}
                placeholder="0x… or bc1…"
                autoComplete="off"
                spellCheck={false}
                className={`ibo-input font-mono ${
                  (submitAttempted || touched.address) && fieldErrors.address ? 'border-red-500/50' : 'border-surface-border'
                }`}
              />
              {(submitAttempted || touched.address) && fieldErrors.address && (
                <p className="text-xs text-red-400 mt-1.5 font-medium">{fieldErrors.address}</p>
              )}
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="ibo-field-label !mb-0">Amount ({asset})</label>
                <span className="text-[11px] text-white/60">
                  Available: <span className="text-white font-mono">{availableBalance.toFixed(6)}</span>
                  <button type="button"
                    onClick={() => setAmount(availableBalance > 0 ? String(availableBalance) : '')}
                    className="ml-2 text-gold hover:text-gold-light font-bold">Max</button>
                </span>
              </div>
              <input
                type="number"
                value={amount}
                onChange={e => {
                  setAmount(e.target.value);
                  setFieldErrors(prev => ({ ...prev, amount: '' }));
                }}
                onBlur={() => {
                  setTouched(prev => ({ ...prev, amount: true }));
                  const amt = Number(amount);
                  setFieldErrors(prev => ({ ...prev, amount: Number.isFinite(amt) && amt > 0 ? '' : 'Enter a valid amount.' }));
                }}
                step="any"
                min="0"
                placeholder="0.00"
                className={`ibo-input font-mono ${
                  (submitAttempted || touched.amount) && fieldErrors.amount ? 'border-red-500/50' : 'border-surface-border'
                }`}
              />
              {(submitAttempted || touched.amount) && fieldErrors.amount && (
                <p className="text-xs text-red-400 mt-1.5 font-medium">{fieldErrors.amount}</p>
              )}
            </div>

            {showFeePanel && (
              <div className="rounded-xl border border-surface-border bg-[color:var(--ibo-elevated)] px-4 py-3 text-xs text-ink-secondary space-y-1.5">
                <p className="ibo-field-label !mb-0">Fee summary</p>
                {withdrawConfig.withdraw_fee_rate > 0 && (
                  <div className="flex justify-between gap-3">
                    <span>Platform fee ({(withdrawConfig.withdraw_fee_rate * 100).toFixed(2)}% notional)</span>
                    <span className="font-mono text-ink">
                      {platformFeeIbo > 0
                        ? `~${platformFeeIbo.toFixed(8)} Delta`
                        : 'Delta (rate applies to USDT notional)'}
                    </span>
                  </div>
                )}
                {iboGasFee > 0 && (
                  <div className="flex justify-between gap-3">
                    <span>Network gas fee (Delta)</span>
                    <span className="font-mono text-ink">{iboGasFee.toFixed(8)} Delta</span>
                  </div>
                )}
                <div className="flex justify-between gap-3 pt-1 border-t border-surface-border/60">
                  <span className="font-semibold text-ink">{asset} sent on-chain</span>
                  <span className="font-mono font-semibold text-gold">{totalAssetDebit.toFixed(8)} {asset}</span>
                </div>
                {totalIboFees > 0 && (
                  <div className="flex justify-between gap-3">
                    <span className="font-semibold text-ink">Total Delta fees</span>
                    <span className="font-mono font-semibold text-gold">~{totalIboFees.toFixed(8)} Delta</span>
                  </div>
                )}
                {(totalIboFees > 0 || withdrawConfig.platform_fee_description) && (
                  <p className="text-[11px] text-ink-muted leading-relaxed">
                    {withdrawConfig.platform_fee_description
                      || 'Platform and gas fees are charged in Delta from your spot wallet.'}
                    {' '}
                    {withdrawConfig.gas_fee_description || ''}
                    {' '}Delta available: <span className="font-mono text-ink-secondary">{iboAvailable.toFixed(4)}</span>
                  </p>
                )}
              </div>
            )}

            <div>
              <label className="ibo-field-label">Note <span className="normal-case tracking-normal font-medium text-ink-muted">(optional, for your records)</span></label>
              <input
                type="text"
                value={note}
                onChange={e => setNote(e.target.value)}
                maxLength={200}
                placeholder="e.g. personal wallet"
                className="ibo-input"
              />
            </div>

            {twofa.enabled && (
              <div>
                <label className="ibo-field-label">
                  2FA code <span className="text-white/40 normal-case">(authenticator or backup code)</span>
                </label>
                <input
                  type="text"
                  value={totp}
                  onChange={e => {
                    setTotp(e.target.value);
                    setFieldErrors(prev => ({ ...prev, totp: '' }));
                  }}
                  onBlur={() => {
                    setTouched(prev => ({ ...prev, totp: true }));
                    setFieldErrors(prev => ({
                      ...prev,
                      totp: twofa.enabled && !totp.trim()
                        ? 'Enter the code from your authenticator app (or a backup code).'
                        : '',
                    }));
                  }}
                  autoComplete="one-time-code"
                  inputMode="text"
                  placeholder="123 456 or backup code"
                  className={`ibo-input font-mono tracking-widest ${
                    (submitAttempted || touched.totp) && fieldErrors.totp ? 'border-red-500/50' : 'border-surface-border'
                  }`}
                />
                {(submitAttempted || touched.totp) && fieldErrors.totp && (
                  <p className="text-xs text-red-400 mt-1.5 font-medium">{fieldErrors.totp}</p>
                )}
              </div>
            )}
            {!twofa.enabled && twofa.required_for_withdrawal && (
              <div className="rounded-xl border border-gold/35 bg-gold/10 px-3 py-2.5 text-xs text-gold/90 flex items-start gap-2">
                <AlertCircle size={14} className="flex-shrink-0 mt-0.5" />
                <span>
                  Two-factor authentication is required for withdrawals. Enable 2FA in your{' '}
                  <Link to="/profile" className="font-bold underline">Profile → Security</Link> first.
                </span>
              </div>
            )}

            {submitError && (
              <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2.5 text-xs text-red-100 flex items-start gap-2">
                <AlertCircle size={14} className="flex-shrink-0 mt-0.5" />
                <span>{submitError}</span>
              </div>
            )}
            {submitOk && (
              <div className="rounded-xl border border-green-500/30 bg-green-500/10 px-3 py-2.5 text-xs text-green-100 flex items-start gap-2">
                <CheckCircle size={14} className="flex-shrink-0 mt-0.5" />
                <span>
                  Withdrawal <span className="font-mono">{submitOk.id}</span> submitted — status{' '}
                  <span className="font-bold">{submitOk.status}</span>
                  {submitOk.auto ? ' (auto-approved; broadcasting shortly)' : ' (awaiting admin approval)'}.
                </span>
              </div>
            )}

            <button
              type="submit"
              disabled={submitting || kycBlocked}
              className="ibo-btn-primary w-full py-3.5 disabled:opacity-40"
            >
              {submitting ? (<><RefreshCw size={16} className="animate-spin" /> Submitting…</>)
                : (<><ArrowUpCircle size={16} /> Submit withdrawal</>)}
            </button>
          </form>
        )}
      </div>

      <div className="space-y-4">
        <div className="wallet-surface p-5 sm:p-6">
          <p className="text-[color:var(--ibo-ink)] font-bold mb-3 flex items-center gap-2 text-sm">
            <Info size={15} className="text-[#FE6C02]" /> How it works
          </p>
          <ol className="space-y-3 text-sm text-[color:var(--ibo-ink-secondary)]">
            {[
              'Pick the asset, network and paste your destination address.',
              'We lock the amount (plus the platform fee) in your balance the moment you submit.',
              'Small withdrawals auto-broadcast on-chain; larger ones wait for admin approval.',
              'Once the network confirms the transaction, the lock is released from your balance.',
            ].map((step, i) => (
              <li key={i} className="flex items-start gap-3">
                <span className="wallet-step-num">{i + 1}</span>
                {step}
              </li>
            ))}
          </ol>
        </div>

        <div className="wallet-surface p-5 border-[#FE6C02]/25">
          <p className="text-[#FE6C02] font-semibold text-sm flex items-center gap-1.5 mb-2">
            <AlertCircle size={14} /> Important
          </p>
          <ul className="text-xs text-[color:var(--ibo-ink-secondary)] space-y-1.5 list-disc list-inside">
            <li>Double-check the destination address — on-chain sends are irreversible.</li>
            <li>Withdrawals to the platform&apos;s own deposit addresses are blocked.</li>
            <li>Network fees come out of the treasury; you are charged the platform fee rate on top of your amount.</li>
            <li>Track progress and tx hashes in the History tab.</li>
          </ul>
        </div>
      </div>
    </div>
    </div>
  );
}

// ── History Tab ───────────────────────────────────────────────────────────────

function inrHistoryFromSearchParams(params) {
  const inr = String(params.get('inr') || '').toLowerCase();
  if (inr === 'withdraw' || inr === 'deposit' || inr === 'all') {
    return { mainTab: 'inr', inrFilter: inr };
  }
  return { mainTab: 'onchain', inrFilter: 'all' };
}

function HistoryTab() {
  const [searchParams, setSearchParams] = useSearchParams();
  const inrHistoryInit = inrHistoryFromSearchParams(searchParams);
  const [mainTab, setMainTab] = useState(inrHistoryInit.mainTab);
  const [onchainTab, setOnchainTab] = useState('deposits');
  const [inrFilter, setInrFilter] = useState(inrHistoryInit.inrFilter);
  const [events, setEvents] = useState([]);
  const [inrDeposits, setInrDeposits] = useState([]);
  const [inrWithdrawals, setInrWithdrawals] = useState([]);
  const [wds, setWds] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [cancellingId, setCancellingId] = useState('');
  const [confirmInrCancelRow, setConfirmInrCancelRow] = useState(null);
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const issues = [];
    try {
      const [dRes, wRes, inrDepData, inrWdData, ledgerRes] = await Promise.all([
        authFetch(`${API}/api/wallet/deposit-events?limit=200`),
        authFetch(`${API}/api/wallet/withdrawals?limit=200`),
        fetchInrDeposits({ limit: 100 }).catch((e) => ({ error: e.message || 'INR deposits' })),
        fetchInrWithdrawals({ limit: 100 }).catch((e) => ({ error: e.message || 'INR withdrawals' })),
        authFetch(`${API}/api/wallet/transactions?type=deposit&limit=100&skip=0`),
      ]);

      if (dRes.ok) {
        const dData = await dRes.json().catch(() => ({}));
        let depItems = Array.isArray(dData.items) ? dData.items : [];

        if (ledgerRes?.ok) {
          const ledgerData = await ledgerRes.json().catch(() => ({}));
          const ledgerItems = Array.isArray(ledgerData.items) ? ledgerData.items : [];
          const depositHashes = new Set(
            depItems.map((d) => String(d.tx_hash || '').toLowerCase()).filter(Boolean),
          );
          for (const txn of ledgerItems) {
            const source = String(txn.source ?? txn.meta?.source ?? '').toLowerCase();
            if (source !== 'signup_bonus') continue;
            const hash = String(txn.tx_hash ?? txn.meta?.tx_hash ?? '').toLowerCase();
            if (hash && depositHashes.has(hash)) continue;
            depItems.push({
              id: txn.id,
              asset: txn.asset,
              amount: txn.amount,
              tx_hash: txn.tx_hash ?? txn.meta?.tx_hash,
              network: txn.network ?? txn.meta?.network,
              status: 'credited',
              source: 'signup_bonus',
              label: txn.label || 'Signup bonus',
              status_note: 'Credited to trading wallet',
              created_at: txn.created_at,
            });
            if (hash) depositHashes.add(hash);
          }
        }

        setEvents(depItems);
      } else {
        const j = await dRes.json().catch(() => ({}));
        setEvents([]);
        issues.push(j?.detail || `deposits (HTTP ${dRes.status})`);
      }

      if (inrDepData?.error) {
        setInrDeposits([]);
        issues.push(inrDepData.error);
      } else {
        setInrDeposits(Array.isArray(inrDepData?.items) ? inrDepData.items : []);
      }

      if (inrWdData?.error) {
        setInrWithdrawals([]);
        issues.push(inrWdData.error);
      } else {
        setInrWithdrawals(Array.isArray(inrWdData?.items) ? inrWdData.items : []);
      }

      if (wRes.ok) {
        const wData = await wRes.json().catch(() => ({}));
        setWds(Array.isArray(wData.items) ? wData.items : []);
      } else {
        const j = await wRes.json().catch(() => ({}));
        setWds([]);
        issues.push(j?.detail || `withdrawals (HTTP ${wRes.status})`);
      }

      if (issues.length) {
        setError(`Partial history load issue: ${issues.join(' | ')}`);
      }
    } catch (e) {
      setError(e.message || 'Could not load history.');
      setEvents([]);
      setInrDeposits([]);
      setInrWithdrawals([]);
      setWds([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // autoStart=true: the hook starts a session the moment the component mounts
  // (i.e. the user opens Wallet → History). No button press required.
  const monitor = useDepositMonitor({
    autoStart: true,
    onDeposit: () => load(),
    onExpire: () => {
      // Session ended — return user to Spot balances (default wallet tab).
      setSearchParams({}, { replace: true });
    },
  });

  const onCancelInrWithdrawal = useCallback(async (row) => {
    const id = String(row?.id || '');
    if (!id) return;
    setError(null);
    setCancellingId(id);
    try {
      await cancelInrWithdrawal(id);
      await load();
    } catch (e) {
      setError(e.message || 'Could not cancel INR withdrawal.');
    } finally {
      setCancellingId('');
    }
  }, [load]);

  useEffect(() => {
    const next = inrHistoryFromSearchParams(searchParams);
    setMainTab(next.mainTab);
    setInrFilter(next.inrFilter);
  }, [searchParams]);

  const depositRows = events
    .slice()
    .sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
  const withdrawRows = wds
    .slice()
    .sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));

  const inrHistoryRows = useMemo(() => {
    const deps = inrDeposits.map((r) => ({ ...r, _inrKind: 'deposit' }));
    const wdsInr = inrWithdrawals.map((r) => ({ ...r, _inrKind: 'withdraw' }));
    let merged = [...deps, ...wdsInr];
    if (inrFilter === 'deposit') merged = deps;
    if (inrFilter === 'withdraw') merged = wdsInr;
    return merged.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
  }, [inrDeposits, inrWithdrawals, inrFilter]);

  const fmt = iso => (iso ? new Date(iso).toLocaleString('en-US', { month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }) : '—');
  const fmtAmt = (amount, asset) => {
    const a = (asset || '').toUpperCase();
    const dec = a === 'USDT' ? 2 : a === 'IBO' ? 4 : 6;
    return Number(amount || 0).toFixed(dec);
  };
  const mainTabBtn = (id, label) => (
    <button
      key={id}
      type="button"
      onClick={() => setMainTab(id)}
      className={`px-4 py-1.5 text-xs font-semibold rounded-lg transition-colors ${
        mainTab === id
          ? 'bg-[#FE6C02]/15 text-[#FE6C02]'
          : 'text-[color:var(--ibo-muted)] hover:text-[color:var(--ibo-ink)]'
      }`}
    >
      {label}
    </button>
  );
  const onchainTabBtn = (id, label) => (
    <button
      key={id}
      type="button"
      onClick={() => setOnchainTab(id)}
      className={`px-3 py-1 text-[11px] font-semibold rounded-lg capitalize transition-colors ${
        onchainTab === id
          ? 'bg-white/[0.08] text-[color:var(--ibo-ink)]'
          : 'text-[color:var(--ibo-muted)] hover:text-[color:var(--ibo-ink-secondary)]'
      }`}
    >
      {label}
    </button>
  );
  const inrFilterBtn = (id, label) => (
    <button
      key={id}
      type="button"
      onClick={() => setInrFilter(id)}
      className={`px-3 py-1 text-[11px] font-semibold rounded-lg capitalize transition-colors ${
        inrFilter === id
          ? 'bg-[#FE6C02]/12 text-[#FE6C02]'
          : 'text-[color:var(--ibo-muted)] hover:text-[color:var(--ibo-ink-secondary)]'
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className="space-y-4">
      <div className="wallet-surface px-3 sm:px-4 py-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1 p-0.5 rounded-xl bg-white/[0.02] border border-[color:var(--ibo-border-solid)]">
          {mainTabBtn('onchain', 'On-chain')}
          {mainTabBtn('inr', 'INR history')}
        </div>
        <button onClick={load} disabled={loading}
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-[color:var(--ibo-muted)] hover:text-[color:var(--ibo-ink)] disabled:opacity-40">
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>

      {error && !loading && (
        <div className="rounded-xl border border-red-500/25 bg-red-500/10 px-4 py-3 text-sm text-red-200 flex items-start gap-2">
          <AlertCircle size={15} className="flex-shrink-0 mt-0.5" />
          {error}
        </div>
      )}

      {mainTab === 'inr' && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap gap-1 border border-surface-border/80 rounded-lg p-0.5 bg-black/20">
            {inrFilterBtn('all', 'All')}
            {inrFilterBtn('deposit', 'Deposit')}
            {inrFilterBtn('withdraw', 'Withdraw')}
          </div>
          <div className="flex flex-wrap gap-2 text-xs">
            <Link to="/wallet/deposit/inr" className="font-bold text-gold hover:underline">Deposit INR</Link>
            <span className="text-white/25">·</span>
            <Link to="/wallet/withdraw/inr" className="font-bold text-gold hover:underline">Sell for INR</Link>
          </div>
        </div>
      )}

      {mainTab === 'onchain' && (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-1">
            {onchainTabBtn('deposits', 'Deposits')}
            {onchainTabBtn('withdrawals', 'Withdrawals')}
          </div>
        </div>
      )}

      {mainTab === 'onchain' && onchainTab === 'deposits' && (
        <DepositMonitorBanner monitor={monitor} className="mb-2" />
      )}

      {mainTab === 'onchain' && onchainTab === 'deposits' && (
        <div className="wallet-surface overflow-hidden -mt-1">
          {loading ? (
            <div className="flex items-center justify-center py-16 gap-3 text-white">
              <RefreshCw size={20} className="animate-spin" /> Loading deposits…
            </div>
          ) : depositRows.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3 text-white">
              <Clock size={32} />
              <p>No on-chain deposits detected yet</p>
              <p className="text-xs text-white/50 max-w-sm text-center">
                Send funds to your personal deposit address from the Deposit tab — we&apos;ll record
                and credit them here automatically once the network confirms.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="text-[11px] text-white uppercase tracking-wider border-b border-surface-border">
                    {['Date', 'Type', 'Asset', 'Amount', 'Tx Hash', 'Network', 'Confirmations', 'Status'].map(h => (
                      <th key={h} className={`px-5 py-3 ${h === 'Status' ? 'text-right' : 'text-left'}`}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {depositRows.map(r => (
                    <tr key={`${r.asset}-${r.network}-${r.tx_hash}-${r.address}`} className="border-b border-surface-border/40 hover:bg-white/[.02] transition-colors">
                      <td className="px-5 py-3 text-xs text-white whitespace-nowrap">{fmt(r.created_at)}</td>
                      <td className="px-5 py-3">
                        <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-green-400">
                          <ArrowDownCircle size={12} />
                          {r.label || (r.source === 'signup_bonus' ? 'Signup bonus' : 'Deposit')}
                        </span>
                      </td>
                      <td className="px-5 py-3 text-sm text-white font-bold">{r.asset}</td>
                      <td className="px-5 py-3 text-sm text-white font-mono">{fmtAmt(r.amount, r.asset)}</td>
                      <td className="px-5 py-3 text-xs text-white font-mono">
                        <span className="flex items-center gap-1">
                          {(r.tx_hash || '—').slice(0, 16)}…
                          {r.tx_hash && <CopyBtn text={r.tx_hash} />}
                        </span>
                      </td>
                      <td className="px-5 py-3 text-xs text-white whitespace-nowrap">{r.network}</td>
                      <td className="px-5 py-3 text-xs text-white whitespace-nowrap font-mono">
                        {Number.isFinite(Number(r.threshold)) && Number(r.threshold) > 0 ? (
                          <span className="inline-flex items-center gap-1">
                            <span className={Number(r.confirmations ?? 0) >= Number(r.threshold) ? 'text-green-400' : 'text-white/80'}>
                              {Math.min(Number(r.confirmations ?? 0), Number(r.threshold))}
                            </span>
                            <span className="text-white/40">/</span>
                            <span className="text-white/70">{Number(r.threshold)}</span>
                          </span>
                        ) : (
                          Number(r.confirmations ?? 0)
                        )}
                      </td>
                      <td className="px-5 py-3 text-right">
                        <div className="flex flex-col items-end gap-1">
                          {r.status_note ? (
                            <span className="text-[10px] text-white/50 max-w-[140px] text-right leading-tight">{r.status_note}</span>
                          ) : null}
                          <StatusBadge status={r.status || 'pending'} />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {mainTab === 'inr' && (
        <div className="wallet-surface overflow-hidden">
          {loading ? (
            <div className="flex items-center justify-center py-16 gap-3 text-white">
              <RefreshCw size={20} className="animate-spin" /> Loading INR history…
            </div>
          ) : inrHistoryRows.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3 text-white px-4">
              <IndianRupee size={32} className="text-gold/80" />
              <p>
                {inrFilter === 'deposit' && 'No INR deposits yet'}
                {inrFilter === 'withdraw' && 'No INR withdrawals yet'}
                {inrFilter === 'all' && 'No INR activity yet'}
              </p>
              <p className="text-xs text-white/50 max-w-sm text-center">
                Bank deposits and Delta sell payouts (bank/UPI) appear here with status and UTR references.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px]">
                <thead>
                  <tr className="text-[11px] text-white uppercase tracking-wider border-b border-surface-border">
                    {['Date', 'Type', 'Amount (INR)', 'Delta', 'Reference', 'Details', 'Status', 'Action'].map((h) => (
                      <th key={h} className={`px-5 py-3 ${h === 'Status' || h === 'Action' ? 'text-center' : 'text-left'}`}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {inrHistoryRows.map((r) => {
                    const isDep = r._inrKind === 'deposit';
                    const wdStatus = !isDep
                      ? normalizedInrWithdrawalStatus(r.status, r.rejection_reason)
                      : (r.status || 'pending');
                    const depRef = isDep ? getInrRefDisplay({ ref_id: r.id, utr_number: r.utr_number, meta: { utr_number: r.utr_number } }) : null;
                    const wdRef = !isDep ? getInrWithdrawalRefDisplay({ ref_id: r.id, payout_reference: r.payout_reference, meta: { payout_reference: r.payout_reference } }) : null;
                    return (
                      <tr key={`${r._inrKind}-${r.id}`} className="border-b border-surface-border/40 hover:bg-white/[.02] transition-colors">
                        <td className="px-5 py-3 text-xs text-white whitespace-nowrap">{fmt(r.created_at)}</td>
                        <td className="px-5 py-3">
                          {isDep ? (
                            <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-300">
                              <ArrowDownCircle size={12} /> Deposit
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-gold">
                              <ArrowUpCircle size={12} /> Withdraw
                            </span>
                          )}
                        </td>
                        <td className="px-5 py-3 text-sm text-white font-mono">{formatInrAmount(r.amount_inr)}</td>
                        <td className="px-5 py-3 text-sm text-white/80 font-mono">
                          {isDep
                            ? (r.status === 'approved' && r.amount_ibo != null
                              ? `+${Number(r.amount_ibo).toFixed(4)}`
                              : '—')
                            : (r.amount_ibo != null ? `−${Number(r.amount_ibo).toFixed(4)}` : '—')}
                        </td>
                        <td className="px-5 py-3 text-xs max-w-[200px] min-w-0">
                          {isDep ? (
                            <div className="min-w-0">
                              {depRef?.utr ? (
                                <p className="font-mono text-white/90 truncate flex items-center gap-1">
                                  <span className="truncate">{depRef.utr}</span>
                                  <CopyBtn text={depRef.utr} />
                                </p>
                              ) : (
                                <p className="text-white/45 italic">UTR pending</p>
                              )}
                              {depRef?.depositId ? (
                                <p className="font-mono text-[10px] text-gold/40 truncate mt-0.5" title={depRef.depositId}>
                                  {depRef.depositId}
                                </p>
                              ) : null}
                            </div>
                          ) : (
                            <div className="min-w-0">
                              {wdRef?.utr ? (
                                <p className="font-mono text-white/90 truncate flex items-center gap-1">
                                  <span className="truncate">{wdRef.utr}</span>
                                  <CopyBtn text={wdRef.utr} />
                                </p>
                              ) : (
                                <p className="text-white/45 italic">UTR pending</p>
                              )}
                              {wdRef?.withdrawalId ? (
                                <p className="font-mono text-[10px] text-gold/40 truncate mt-0.5" title={wdRef.withdrawalId}>
                                  {wdRef.withdrawalId}
                                </p>
                              ) : null}
                            </div>
                          )}
                        </td>
                        <td className="px-5 py-3 text-xs text-white/70 max-w-[160px] truncate" title={isDep ? r.payment_method_label : r.payout_label}>
                          {isDep
                            ? (r.payment_method_label || r.payment_method_type || '—')
                            : (
                              <>
                                <span className="uppercase text-[10px] text-white/40">{r.payout_type}</span>
                                <div className="text-white/80 truncate">{r.payout_label || '—'}</div>
                              </>
                            )}
                        </td>
                        <td className="px-5 py-3 text-center">
                          <StatusBadge status={wdStatus} />
                        </td>
                        <td className="px-5 py-3 text-center">
                          {!isDep && wdStatus === 'pending' ? (
                            <button
                              type="button"
                              onClick={() => setConfirmInrCancelRow(r)}
                              disabled={cancellingId === String(r.id || '')}
                              className="px-3 py-1.5 rounded-lg border border-red-500/40 bg-red-500/10 text-xs font-bold text-red-200 hover:bg-red-500/20 disabled:opacity-60"
                            >
                              {cancellingId === String(r.id || '') ? 'Cancelling…' : 'Cancel request'}
                            </button>
                          ) : (
                            <span className="text-xs text-white/35">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {mainTab === 'onchain' && onchainTab === 'withdrawals' && (
        <div className="wallet-surface overflow-hidden -mt-1">
          {loading ? (
            <div className="flex items-center justify-center py-16 gap-3 text-white">
              <RefreshCw size={20} className="animate-spin" /> Loading withdrawals…
            </div>
          ) : withdrawRows.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3 text-white">
              <Clock size={32} />
              <p>No withdrawals yet</p>
              <p className="text-xs text-white/50 max-w-sm text-center">
                Submit a withdrawal from the Withdraw tab — small amounts are broadcast
                on-chain automatically, larger ones are sent to admin for approval first.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="text-[11px] text-white uppercase tracking-wider border-b border-surface-border">
                    {['Date', 'Asset', 'Amount', 'Fee', 'Destination', 'Tx Hash', 'Network', 'Confirmations', 'Status'].map(h => (
                      <th key={h} className={`px-5 py-3 ${h === 'Status' ? 'text-right' : 'text-left'}`}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {withdrawRows.map(r => (
                    <tr key={r.id} className="border-b border-surface-border/40 hover:bg-white/[.02] transition-colors">
                      <td className="px-5 py-3 text-xs text-white whitespace-nowrap">{fmt(r.created_at)}</td>
                      <td className="px-5 py-3 text-sm text-white font-bold">{r.asset}</td>
                      <td className="px-5 py-3 text-sm text-white font-mono">{fmtAmt(r.amount, r.asset)}</td>
                      <td className="px-5 py-3 text-xs text-white/70 font-mono">
                        {fmtAmt(r.fee_amount, r.asset)}
                        {Number(r.ibo_gas_fee) > 0 && (
                          <div className="text-[10px] text-white/45 mt-0.5">+ {fmtAmt(r.ibo_gas_fee, 'IBO')} gas</div>
                        )}
                      </td>
                      <td className="px-5 py-3 text-xs text-white font-mono">
                        <span className="flex items-center gap-1">
                          {(r.address || '—').slice(0, 10)}…{(r.address || '').slice(-6)}
                          {r.address && <CopyBtn text={r.address} />}
                        </span>
                      </td>
                      <td className="px-5 py-3 text-xs text-white font-mono">
                        {r.tx_hash ? (
                          <span className="flex items-center gap-1">
                            {r.tx_hash.slice(0, 16)}…
                            <CopyBtn text={r.tx_hash} />
                          </span>
                        ) : (
                          <span className="text-white/40">—</span>
                        )}
                      </td>
                      <td className="px-5 py-3 text-xs text-white whitespace-nowrap">{r.network}</td>
                      <td className="px-5 py-3 text-xs text-white whitespace-nowrap font-mono">
                        {Number.isFinite(Number(r.threshold)) && Number(r.threshold) > 0 ? (
                          <span className="inline-flex items-center gap-1">
                            <span className={Number(r.confirmations ?? 0) >= Number(r.threshold) ? 'text-green-400' : 'text-white/80'}>
                              {Math.min(Number(r.confirmations ?? 0), Number(r.threshold))}
                            </span>
                            <span className="text-white/40">/</span>
                            <span className="text-white/70">{Number(r.threshold)}</span>
                          </span>
                        ) : (
                          <span className="text-white/40">—</span>
                        )}
                      </td>
                      <td className="px-5 py-3 text-right"><StatusBadge status={r.status || 'pending_approval'} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {confirmInrCancelRow ? (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md rounded-2xl border border-surface-border bg-surface-card shadow-2xl">
            <div className="px-5 py-4 border-b border-surface-border">
              <h3 className="text-white font-bold text-lg">Cancel withdrawal request?</h3>
              <p className="text-white/60 text-sm mt-1">
                This will cancel your pending INR withdrawal request and unlock reserved Delta.
              </p>
            </div>
            <div className="px-5 py-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmInrCancelRow(null)}
                disabled={!!cancellingId}
                className="px-4 py-2 rounded-xl border border-surface-border text-sm font-semibold text-white/80 hover:bg-white/5 disabled:opacity-50"
              >
                Keep request
              </button>
              <button
                type="button"
                onClick={async () => {
                  const row = confirmInrCancelRow;
                  setConfirmInrCancelRow(null);
                  await onCancelInrWithdrawal(row);
                }}
                disabled={!!cancellingId}
                className="px-4 py-2 rounded-xl border border-red-500/40 bg-red-500/15 text-sm font-semibold text-red-200 hover:bg-red-500/25 disabled:opacity-50"
              >
                Yes, cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

const LEDGER_TYPES = [
  '', 'deposit', 'inr_deposit', 'inr_withdrawal', 'withdraw', 'trade', 'fee', 'adjustment',
  'lock', 'unlock', 'seed', 'opening_balance',
];

// ── Ledger tab (Phase 2 — ``GET /api/wallet/transactions`` / wallet_txns) ────

function LedgerTab() {
  const { fetchWalletTransactions } = useAuth();
  const [mergedAll, setMergedAll] = useState([]);
  const [skip, setSkip] = useState(0);
  const [limit] = useState(40);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  const [asset, setAsset] = useState('');
  const [type, setType] = useState('');
  const [refId, setRefId] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const params = { skip: 0, limit: 250 };
      if (asset.trim() && asset.trim().toUpperCase() !== 'INR') params.asset = asset.trim();
      if (type && type !== 'inr_deposit') params.type = type;
      if (refId.trim()) params.ref_id = refId.trim();
      if (dateFrom) params.date_from = `${dateFrom}T00:00:00`;
      if (dateTo) params.date_to = `${dateTo}T23:59:59`;

      const [walletData, inrData, inrWdData] = await Promise.all([
        fetchWalletTransactions(params),
        fetchInrDeposits({ limit: 100 }).catch(() => ({ items: [] })),
        fetchInrWithdrawals({ limit: 100 }).catch(() => ({ items: [] })),
      ]);

      let rows = mergeLedgerWithInrDeposits(walletData.items, inrData.items, inrWdData.items);

      const assetU = asset.trim().toUpperCase();
      if (assetU === 'INR') {
        rows = rows.filter((r) =>
          r._ledgerKind === 'inr_request'
          || r._ledgerKind === 'inr_withdrawal_request'
          || r.asset === 'INR'
          || r.ref_type === 'inr_withdrawal',
        );
      } else if (assetU) {
        rows = rows.filter((r) =>
          r._ledgerKind !== 'inr_request'
          && r._ledgerKind !== 'inr_withdrawal_request'
          && String(r.asset || '').toUpperCase() === assetU,
        );
      }

      if (type === 'inr_deposit') {
        rows = rows.filter((r) => r._ledgerKind === 'inr_request' || r.ref_type === 'inr_deposit');
      } else if (type === 'inr_withdrawal') {
        rows = rows.filter((r) =>
          r._ledgerKind === 'inr_withdrawal_request' || r.ref_type === 'inr_withdrawal',
        );
      } else if (type === 'deposit') {
        rows = rows.filter((r) =>
          r._ledgerKind === 'inr_request'
          || (r.type === 'deposit' && r.ref_type !== 'inr_deposit')
          || (r.ref_type === 'inr_deposit' && r.type === 'deposit'),
        );
      } else if (type) {
        rows = rows.filter((r) =>
          r._ledgerKind !== 'inr_request'
          && r._ledgerKind !== 'inr_withdrawal_request'
          && r.type === type,
        );
      }

      if (refId.trim()) {
        const needle = refId.trim().toLowerCase();
        rows = rows.filter((r) => {
          const meta = r.meta && typeof r.meta === 'object' ? r.meta : {};
          const utr = String(meta.utr_number || meta.payout_reference || r.payout_reference || '').toLowerCase();
          return String(r.ref_id || '').toLowerCase().includes(needle) || utr.includes(needle);
        });
      }

      if (dateFrom) {
        const from = new Date(`${dateFrom}T00:00:00`).getTime();
        rows = rows.filter((r) => !r.created_at || new Date(r.created_at).getTime() >= from);
      }
      if (dateTo) {
        const to = new Date(`${dateTo}T23:59:59`).getTime();
        rows = rows.filter((r) => !r.created_at || new Date(r.created_at).getTime() <= to);
      }

      setMergedAll(rows);
    } catch (e) {
      setErr(e.message || 'Could not load ledger.');
      setMergedAll([]);
    } finally {
      setLoading(false);
    }
  }, [fetchWalletTransactions, asset, type, refId, dateFrom, dateTo]);

  useEffect(() => {
    load();
  }, [load]);

  const total = mergedAll.length;
  const items = mergedAll.slice(skip, skip + limit);
  const pages = Math.max(1, Math.ceil(total / limit));
  const page = Math.floor(skip / limit) + 1;

  const ledgerAssets = useMemo(() => {
    const set = new Set(SUPPORTED_ASSETS);
    set.add('INR');
    return [...set];
  }, []);

  const fmtBal = (b) => {
    if (!b || typeof b !== 'object') return '—';
    const a = Number(b.available);
    const l = Number(b.locked);
    if (!Number.isFinite(a) && !Number.isFinite(l)) return '—';
    return `${Number.isFinite(a) ? a.toFixed(6) : '0'} / ${Number.isFinite(l) ? l.toFixed(6) : '0'}`;
  };

  return (
    <div className="space-y-4">
      <div className="wallet-surface p-5 sm:p-6">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-5">
          <div>
            <p className="text-[color:var(--ibo-ink)] font-bold text-sm flex items-center gap-2">
              <ScrollText size={16} className="text-[#FE6C02] shrink-0" /> Activity ledger
            </p>
            <p className="text-xs sm:text-sm text-[color:var(--ibo-muted)] mt-1 max-w-2xl leading-relaxed">
              Balance movements, INR deposits, and payouts. Newest first.
            </p>
          </div>
          <button
            type="button"
            onClick={() => { setSkip(0); load(); }}
            disabled={loading}
            className="wallet-action-ghost disabled:opacity-40 self-start"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh
          </button>
        </div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
          <div>
            <label className="block text-[11px] font-bold text-[color:var(--ibo-muted)] uppercase tracking-wider mb-1.5">Asset</label>
            <select
              value={asset}
              onChange={(e) => { setSkip(0); setAsset(e.target.value); }}
              className="wallet-field"
            >
              <option value="">All assets</option>
              {ledgerAssets.map((a) => (
                <option key={a} value={a}>{a}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-[11px] font-bold text-[color:var(--ibo-muted)] uppercase tracking-wider mb-1.5">Type</label>
            <select
              value={type}
              onChange={(e) => { setSkip(0); setType(e.target.value); }}
              className="wallet-field"
            >
              {LEDGER_TYPES.map((t) => (
                <option key={t || 'all'} value={t}>{t ? t.replace(/_/g, ' ') : 'All types'}</option>
              ))}
            </select>
          </div>
          <div className="sm:col-span-2">
            <label className="block text-[11px] font-bold text-[color:var(--ibo-muted)] uppercase tracking-wider mb-1.5">Reference ID</label>
            <input
              value={refId}
              onChange={(e) => { setSkip(0); setRefId(e.target.value); }}
              placeholder="Order id, withdrawal id, …"
              className="wallet-field font-mono"
            />
          </div>
          <div>
            <label className="block text-[11px] font-bold text-[color:var(--ibo-muted)] uppercase tracking-wider mb-1.5">From</label>
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => { setSkip(0); setDateFrom(e.target.value); }}
              className="wallet-field"
            />
          </div>
          <div>
            <label className="block text-[11px] font-bold text-[color:var(--ibo-muted)] uppercase tracking-wider mb-1.5">To</label>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => { setSkip(0); setDateTo(e.target.value); }}
              className="wallet-field"
            />
          </div>
        </div>
      </div>

      {err && (
        <div className="rounded-xl border border-[#F6465D]/25 bg-[#F6465D]/10 px-4 py-3 text-sm text-[#F6465D] flex items-start gap-2">
          <AlertCircle size={16} className="shrink-0 mt-0.5" /> {err}
        </div>
      )}

      <div className="wallet-surface overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-16 gap-3 text-[color:var(--ibo-muted)]">
            <RefreshCw size={22} className="animate-spin" /> Loading ledger…
          </div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-2 text-[color:var(--ibo-muted)] px-4 text-center">
            <ScrollText size={32} className="opacity-30" />
            <p className="font-semibold text-[color:var(--ibo-ink)]">No ledger entries match</p>
            <p className="text-xs max-w-md">Try widening filters or trade / move funds to generate ledger rows.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[880px]">
              <thead>
                <tr className="text-[11px] text-white uppercase tracking-wider border-b border-surface-border">
                  <th className="px-5 py-3 text-left">Time</th>
                  <th className="px-5 py-3 text-left">Asset</th>
                  <th className="px-5 py-3 text-left">Type</th>
                  <th className="px-5 py-3 text-left">Dir</th>
                  <th className="px-5 py-3 text-right">Amount</th>
                  <th className="px-5 py-3 text-right">Avail / locked after</th>
                  <th className="px-5 py-3 text-left">Reference</th>
                  <th className="px-5 py-3 text-left">Status</th>
                </tr>
              </thead>
              <tbody>
                {items.map((row) => {
                  const isInrDepositRequest = row._ledgerKind === 'inr_request';
                  const isInrWdRequest =
                    row._ledgerKind === 'inr_withdrawal_request'
                    || row._ledgerKind === 'inr_withdrawal_outcome';
                  const isInrRequest = isInrDepositRequest || isInrWdRequest;
                  const isInrDeposit = isInrDepositRequest || row.ref_type === 'inr_deposit';
                  const isInrWd = isInrWdRequest || isInrWithdrawalRow(row);
                  const inrRef = isInrDeposit ? getInrRefDisplay(row) : null;
                  const inrWdRef = isInrWd ? getInrWithdrawalRefDisplay(row) : null;
                  const dir = String(row.direction || '').toLowerCase();
                  const positive = dir === 'credit' || dir === 'unlock';
                  const amountClass = isInrRequest
                    ? 'text-gold/90'
                    : (positive ? 'text-green-400' : 'text-red-300');
                  return (
                    <tr key={row.id} className="border-b border-surface-border/40 hover:bg-white/[.02]">
                      <td className="px-5 py-3 text-xs text-white/70 whitespace-nowrap">
                        {row.created_at ? new Date(row.created_at).toLocaleString() : '—'}
                      </td>
                      <td className="px-5 py-3 text-sm text-white font-bold">{row.asset}</td>
                      <td className="px-5 py-3 text-xs font-mono text-white/80">{ledgerTypeLabel(row)}</td>
                      <td className="px-5 py-3">
                        {isInrRequest ? (
                          <span className="text-xs font-bold uppercase text-gold/90">request</span>
                        ) : (
                          <span className={`text-xs font-bold uppercase ${positive ? 'text-green-400' : 'text-gold'}`}>
                            {row.direction}
                          </span>
                        )}
                      </td>
                      <td className={`px-5 py-3 text-right text-sm font-mono font-semibold ${amountClass}`}>
                        {formatLedgerAmount(row)}
                      </td>
                      <td className="px-5 py-3 text-right text-xs font-mono text-white/65 whitespace-nowrap" title="available / locked">
                        {isInrRequest ? '—' : fmtBal(row.balance_after)}
                      </td>
                      <td
                        className="px-5 py-3 text-xs max-w-[260px] min-w-0"
                        title={
                          isInrDeposit
                            ? formatInrDepositRefTitle(row)
                            : isInrWd
                              ? formatInrWithdrawalRefTitle(row)
                              : formatWalletTxnRef(row)
                        }
                      >
                        {isInrDeposit ? (
                          <div className="min-w-0 max-w-[280px]" title={formatInrDepositRefTitle(row)}>
                            {inrRef.utr ? (
                              <p className="font-mono text-xs sm:text-sm text-white/90 truncate leading-snug">{inrRef.utr}</p>
                            ) : (
                              <p className="text-xs text-white/45 italic">UTR not recorded</p>
                            )}
                            {inrRef.depositId ? (
                              <p
                                className="font-mono text-[10px] text-gold/40 truncate mt-0.5 leading-tight"
                                title={`Internal deposit ID: ${inrRef.depositId}`}
                              >
                                {inrRef.depositId}
                              </p>
                            ) : null}
                          </div>
                        ) : isInrWd ? (
                          <div className="min-w-0 max-w-[280px]" title={formatInrWithdrawalRefTitle(row)}>
                            {inrWdRef.utr ? (
                              <p className="font-mono text-xs sm:text-sm text-white/90 truncate leading-snug">{inrWdRef.utr}</p>
                            ) : (
                              <p className="text-xs text-white/45 italic">UTR pending</p>
                            )}
                            {inrWdRef.withdrawalId ? (
                              <p
                                className="font-mono text-[10px] text-gold/40 truncate mt-0.5 leading-tight"
                                title={`Request ID: ${inrWdRef.withdrawalId}`}
                              >
                                {inrWdRef.withdrawalId}
                              </p>
                            ) : null}
                          </div>
                        ) : (
                          <span className="font-mono text-white/55 truncate block">{formatWalletTxnRef(row)}</span>
                        )}
                      </td>
                      <td className="px-5 py-3 text-xs text-white/60">
                        {isInrRequest || row.inr_request_status ? (
                          <StatusBadge status={row.inr_request_status || row.status || 'pending'} />
                        ) : (
                          row.inr_request_status
                            ? <StatusBadge status={row.inr_request_status} />
                            : (row.status || '—')
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {total > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-white/55">
          <span>{total} entries · page {page} / {pages}</span>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={skip <= 0 || loading}
              onClick={() => setSkip((s) => Math.max(0, s - limit))}
              className="px-4 py-2 rounded-xl border border-surface-border font-bold text-white disabled:opacity-40"
            >
              Previous
            </button>
            <button
              type="button"
              disabled={skip + limit >= total || loading}
              onClick={() => setSkip((s) => s + limit)}
              className="px-4 py-2 rounded-xl border border-surface-border font-bold text-white disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main WalletPage ───────────────────────────────────────────────────────────

const TABS = [
  { id: 'balances',    label: 'Spot balances', icon: Wallet },
  { id: 'swap',        label: 'Swap',          icon: ArrowLeftRight },
  { id: 'futures',     label: 'Futures',     icon: TrendingUp },
  { id: 'deposit',     label: 'Deposit',     icon: ArrowDownCircle },
  { id: 'withdraw',    label: 'Withdraw',    icon: ArrowUpCircle },
  { id: 'history',     label: 'History',     icon: Clock },
  { id: 'ledger',      label: 'Ledger',      icon: ScrollText },
];

function tabFromSearchParams(params) {
  const t = params.get('tab');
  return TABS.some(x => x.id === t) ? t : 'balances';
}

export default function WalletPage({ accountMode = false, forcedTab = null } = {}) {
  const { user, walletAssets, walletLoading, fetchWallet, kyc, fetchKyc } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [tab, setTab] = useState(() => forcedTab || tabFromSearchParams(searchParams));
  const [priceByAsset, setPriceByAsset] = useState({ USDT: 1 });
  const kycBlocked = user && kyc?.status !== 'approved';

  useEffect(() => {
    const url = exchangeWsPath('/api/ws/exchange/markets');
    let closed = false;
    let reconnectTimer = null;
    let ws = null;
    const applyRows = (rows) => {
      if (!Array.isArray(rows)) return;
      const m = { USDT: 1 };
      for (const row of rows) {
        const b = row.base || row.symbol?.replace('USDT', '');
        if (b) m[b] = parseFloat(row.price) || 0;
      }
      setPriceByAsset(m);
    };
    const connect = () => {
      if (closed) return;
      ws = new WebSocket(url);
      ws.onmessage = (ev) => {
        try {
          const j = JSON.parse(ev.data);
          if (j.type === 'exchange_markets' && Array.isArray(j.markets)) {
            applyRows(normalizeMarketsList(j.markets));
          }
        } catch {
          /* ignore */
        }
      };
      ws.onclose = () => {
        ws = null;
        if (!closed) reconnectTimer = window.setTimeout(connect, 3000);
      };
    };
    connect();
    return () => {
      closed = true;
      if (reconnectTimer) window.clearTimeout(reconnectTimer);
      if (ws) {
        try {
          ws.close();
        } catch {
          /* ignore */
        }
      }
    };
  }, []);

  useEffect(() => {
    if (forcedTab) {
      setTab(forcedTab);
      return;
    }
    setTab(tabFromSearchParams(searchParams));
  }, [searchParams, forcedTab]);

  useEffect(() => {
    if (user && (tab === 'deposit' || tab === 'withdraw')) fetchKyc();
  }, [user, tab, fetchKyc]);

  const selectTab = id => {
    setTab(id);
    if (accountMode) return;
    if (id === 'balances') setSearchParams({}, { replace: true });
    else if (id === 'history') {
      const inr = searchParams.get('inr');
      setSearchParams(inr ? { tab: id, inr } : { tab: id }, { replace: true });
    } else setSearchParams({ tab: id }, { replace: true });
  };

  if (!user) { navigate('/login'); return null; }

  const tabMeta = TABS.find((t) => t.id === tab) || TABS[0];
  const TabIcon = tabMeta.icon;

  const workspace = (
    <AnimatePresence mode="wait">
      <motion.div
        key={tab}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.18 }}
      >
        {tab === 'balances' && (
          <BalancesTab
            walletAssets={walletAssets}
            walletLoading={walletLoading}
            fetchWallet={fetchWallet}
            priceByAsset={priceByAsset}
            onOpenSwap={() => (accountMode ? navigate('/account/transfer') : selectTab('swap'))}
            onTab={accountMode
              ? (id) => {
                if (id === 'deposit') navigate('/account/deposits');
                else if (id === 'withdraw') navigate('/account/withdrawals');
                else if (id === 'swap') navigate('/account/transfer');
                else selectTab(id);
              }
              : selectTab}
          />
        )}
        {tab === 'swap' && <IboSwapPanel />}
        {tab === 'futures' && <FuturesWalletTab />}
        {tab === 'deposit' && <DepositTab kycBlocked={kycBlocked} kyc={kyc} />}
        {tab === 'withdraw' && (
          <WithdrawTab
            walletAssets={walletAssets}
            kycBlocked={kycBlocked}
            kyc={kyc}
            priceByAsset={priceByAsset}
          />
        )}
        {tab === 'history' && <HistoryTab />}
        {tab === 'ledger' && <LedgerTab />}
      </motion.div>
    </AnimatePresence>
  );

  if (accountMode) {
    return (
      <div className="wallet-hub font-ui min-w-0">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-[color:var(--ibo-ink-secondary)]">
            <TabIcon size={15} className="text-[#FE6C02] shrink-0" />
            <h2 className="text-sm font-bold text-[color:var(--ibo-ink)]">{tabMeta.label}</h2>
          </div>
          <button
            type="button"
            onClick={() => fetchWallet()}
            disabled={walletLoading}
            className="wallet-action-ghost disabled:opacity-40"
          >
            <RefreshCw size={14} className={walletLoading ? 'animate-spin' : ''} />
            Refresh
          </button>
        </div>
        {(tab === 'deposit' || tab === 'withdraw') && (
          <div className="mb-4">
            <WalletChainsBanner />
          </div>
        )}
        {workspace}
      </div>
    );
  }

  return (
    <div className="ibo-page font-ui wallet-hub relative">
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-[280px] opacity-90"
        style={{
          background:
            'radial-gradient(ellipse 70% 60% at 8% -10%, rgba(254,108,2,0.12), transparent 55%), radial-gradient(ellipse 40% 40% at 92% 10%, rgba(14,203,129,0.04), transparent 50%)',
        }}
      />

      <div className="relative w-full px-4 sm:px-5 md:px-6 lg:px-8 xl:px-10 2xl:px-12 pt-5 sm:pt-7 pb-16">
        <div className="w-full max-w-7xl mx-auto min-w-0">
          {/* Masthead */}
          <header className="mb-5 sm:mb-6 flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#FE6C02]">
                Funds
              </p>
              <h1 className="mt-1.5 text-[1.75rem] sm:text-[2rem] font-bold tracking-tight text-[color:var(--ibo-ink)] leading-none flex items-center gap-2.5">
                <Wallet className="text-[#FE6C02] shrink-0" size={24} strokeWidth={2.25} />
                Wallet
              </h1>
              <p className="mt-2 text-sm text-[color:var(--ibo-muted)] truncate max-w-full">
                {user.email}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => fetchWallet()}
                disabled={walletLoading}
                className="wallet-action-ghost disabled:opacity-40"
              >
                <RefreshCw size={14} className={walletLoading ? 'animate-spin' : ''} />
                Refresh
              </button>
              <Link to="/trade/IBOUSDT" className="wallet-action-primary">
                <BarChart2 size={14} /> Trade
              </Link>
            </div>
          </header>

          <div className="mb-5">
            <WalletChainsBanner />
          </div>

          {/* Hub layout: rail + workspace */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 lg:gap-7 items-start">
            <aside className="lg:col-span-3 xl:col-span-2 lg:sticky lg:top-20">
              <nav
                className="wallet-surface p-1.5 sm:p-2 flex lg:flex-col gap-1 overflow-x-auto scrollbar-hide"
                aria-label="Wallet sections"
              >
                {TABS.map((t) => {
                  const Icon = t.icon;
                  const active = tab === t.id;
                  return (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => selectTab(t.id)}
                      className={`flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl text-sm font-semibold whitespace-nowrap transition-colors shrink-0 lg:w-full ${
                        active
                          ? 'bg-[#FE6C02]/12 text-[#FE6C02]'
                          : 'text-[color:var(--ibo-muted)] hover:text-[color:var(--ibo-ink)] hover:bg-white/[0.03]'
                      }`}
                    >
                      <Icon size={16} strokeWidth={2.1} className="shrink-0" />
                      <span className="truncate">{t.label}</span>
                    </button>
                  );
                })}
              </nav>
            </aside>

            <div className="lg:col-span-9 xl:col-span-10 min-w-0">
              <div className="mb-4 flex items-center gap-2 text-[color:var(--ibo-ink-secondary)]">
                <TabIcon size={15} className="text-[#FE6C02] shrink-0" />
                <h2 className="text-sm font-bold text-[color:var(--ibo-ink)]">{tabMeta.label}</h2>
              </div>
              {workspace}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
