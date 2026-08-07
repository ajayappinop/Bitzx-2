/**
 * Options terminal — desktop zone-1: chain (flex-1) | responsive book column | responsive ticket column.
 * Bottom tables sit in zone-2 below the fold like TradePage/FuturesTradePage.
 * URL: /options/:underlying
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useParams, useNavigate, Link } from 'react-router-dom';
import {
  RefreshCw, AlertCircle, ChevronDown, Globe, X, Download,
} from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { optionsApi, openOptionsAccountWs, openOptionsDepthWs, openOptionsChainWs } from '@/services/optionsApi';
import OptionsOrderBook from '@/components/options/OptionsOrderBook';
import OptionsRecentTrades from '@/components/options/OptionsRecentTrades';
import DeltaOptionsTicket from '@/components/options/DeltaOptionsTicket';
import { resolveChainCols } from '@/components/options/OptionsChainArm';
import DeltaSplitChainTable from '@/components/options/DeltaSplitChainTable';
import DeltaOptionsHeader from '@/components/options/DeltaOptionsHeader';
import OptionsInstrumentBar from '@/components/options/OptionsInstrumentBar';
import OptionsColumnToggles from '@/components/options/OptionsColumnToggles';
import OptionsChartPanel from '@/components/options/OptionsChartPanel';
import OptionsStrategyBuilder from '@/components/options/OptionsStrategyBuilder';
import { DEFAULT_CHAIN_COLS } from '@/components/options/optionsChainColumns';
import {
  buildOptionsDemoDepth,
  buildOptionsDemoTrades,
  depthHasLevels,
} from '@/components/options/optionsDemoBook';
import { COIN_ICONS } from '@/services/marketApi';
import { useToast, friendlyError } from '@/context/ToastContext';
import { estimateIboFee, formatIboFee } from '@/lib/iboFee';
import { isMoveContract, vanillaContractsOnly } from '@/components/options/deltaInstrumentUtils';
const DEFAULT_UNDERLYING = 'BTCUSDT';
function fmtNum(v, d = 4) {
  const n = Number(v);
  if (!Number.isFinite(n)) return '—';
  const maxFrac = Math.min(20, Math.max(0, Math.floor(Number(d)) || 4));
  const minFrac = n !== 0 && Math.abs(n) < 1e-2 ? Math.min(6, maxFrac) : 0;
  return n.toLocaleString(undefined, { maximumFractionDigits: maxFrac, minimumFractionDigits: minFrac });
}
function baseFromUsdt(sym) {
  return String(sym || '').replace(/USDT$/i, '') || sym;
}
function shortContractId(id) {
  if (!id || typeof id !== 'string') return '—';
  return id.length > 22 ? `${id.slice(0, 14)}…${id.slice(-6)}` : id;
}
/** Parse ISO expiry to ms (UTC). */
function expiryMs(iso) {
  if (!iso) return NaN;
  const raw = String(iso).trim().replace('Z', '+00:00');
  const t = Date.parse(raw);
  return Number.isFinite(t) ? t : NaN;
}
/** e.g. "Jun 27, 2025" in en-US UTC */
function formatExpiryDateUtc(iso) {
  const t = expiryMs(iso);
  if (!Number.isFinite(t)) return '—';
  return new Date(t).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
}
/** e.g. "16:00 UTC" */
function formatExpiryTimeUtc(iso) {
  const t = expiryMs(iso);
  if (!Number.isFinite(t)) return '—';
  return `${new Date(t).toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'UTC',
  })} UTC`;
}
/** Humanize days to settlement (European exercise at expiry). */
function daysToExpiryLabel(iso) {
  const t = expiryMs(iso);
  if (!Number.isFinite(t)) return '';
  const ms = t - Date.now();
  if (ms < 0) return 'Past expiry';
  const totalM = Math.floor(ms / 60000);
  const d = Math.floor(totalM / (60 * 24));
  const h = Math.floor((totalM % (60 * 24)) / 60);
  const m = totalM % 60;
  return `${d}d:${h}h:${m}m`;
}
/** e.g. "1d 2h (Daily)" for expiry section header. */
function timeToExpiryDetail(iso) {
  const t = expiryMs(iso);
  if (!Number.isFinite(t)) return '—';
  const ms = t - Date.now();
  if (ms < 0) return 'Past expiry';
  const hAll = Math.floor(ms / 3600000);
  const d = Math.floor(hAll / 24);
  const h = hAll % 24;
  const m = Math.floor((ms % 3600000) / 60000);
  const parts = [];
  if (d > 0) parts.push(`${d}d`);
  if (h > 0) parts.push(`${h}h`);
  if (parts.length === 0 && m > 0) parts.push(`${m}m`);
  if (parts.length === 0) parts.push('<1m');
  return `${parts.join(' ')} (Daily)`;
}
function expirySectionDomId(expiry) {
  const raw = String(expiry || 'exp');
  return `options-expiry-${raw.replace(/[^a-zA-Z0-9]+/g, '-').slice(0, 64)}`;
}
function buildStrikesMatrix(contracts, expiryIso) {
  const m = new Map();
  for (const c of contracts) {
    if (String(c.expiry || '') !== expiryIso) continue;
    const k = Number(c.strike);
    if (!Number.isFinite(k)) continue;
    const row = m.get(k) || { strike: k, call: null, put: null };
    const ot = String(c.option_type || '').toLowerCase();
    if (ot === 'call') row.call = c;
    else if (ot === 'put') row.put = c;
    m.set(k, row);
  }
  return [...m.values()].sort((a, b) => a.strike - b.strike);
}
function computeAtmStrike(rows, referencePrice) {
  const ref = referencePrice;
  if (ref == null || !Number.isFinite(Number(ref)) || !rows.length) return null;
  const r = Number(ref);
  let best = rows[0].strike;
  let bd = Math.abs(best - r);
  for (const row of rows) {
    const d = Math.abs(row.strike - r);
    if (d < bd) {
      bd = d;
      best = row.strike;
    }
  }
  return best;
}
/** Per-expiry divider bar (Calls / price / vol | centered date | time to expiry). */
function ExpirySectionHeader({ underlying, referenceIndex, expiry }) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-x-2 px-3 sm:px-4 py-2 sm:py-2.5 bg-[color:var(--ibo-surface)] border-b border-white/[0.09] text-[11px] sm:text-xs leading-normal">
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[color:var(--ibo-muted)]">
        <span className="font-bold text-white">Calls</span>
        <span className="font-mono font-semibold text-[color:var(--ibo-ink)]">{underlying}</span>
        <span className="whitespace-nowrap">
          Price:{' '}
          <span className="font-mono font-semibold text-white tabular-nums">
            {referenceIndex != null ? fmtNum(referenceIndex, 2) : '—'}
          </span>
        </span>
        <span className="text-zinc-600 hidden sm:inline" aria-hidden>
          |
        </span>
        <span className="text-[color:var(--ibo-muted)] whitespace-nowrap">
          ATM Vol: <span className="font-mono text-zinc-200">—</span>
        </span>
      </div>
      <div className="justify-self-center font-bold text-white font-mono text-sm sm:text-base tracking-tight text-center px-2.5 py-1 rounded-md bg-white/[0.06] border border-white/[0.08]">
        {formatExpiryTabLabel(expiry)}
      </div>
      <div className="justify-self-end text-right text-[color:var(--ibo-muted)] min-w-0">
        <span className="hidden sm:inline text-[color:var(--ibo-muted)]">Time to Expiry: </span>
        <span className="sm:hidden">TTM: </span>
        <span className="font-mono text-[color:var(--ibo-ink)] tabular-nums whitespace-nowrap">{timeToExpiryDetail(expiry)}</span>
      </div>
    </div>
  );
}
/** UI pill for listing / lifecycle (matches backend contract fields). */
function contractStatePill(c) {
  if (c.demo_contract) {
    return { label: 'Off book', className: 'bg-zinc-600/25 text-[color:var(--ibo-ink-secondary)] border border-white/[0.08]' };
  }
  if (c.settled_at || String(c.status || '').toLowerCase() === 'settled') {
    return { label: 'Settled', className: 'bg-zinc-600/25 text-[color:var(--ibo-muted)] border border-white/[0.06]' };
  }
  const st = String(c.status || '').toLowerCase();
  if (st === 'expired') {
    return { label: 'Expired', className: 'bg-zinc-700/30 text-[color:var(--ibo-muted)] border border-white/[0.06]' };
  }
  if (st === 'halted') {
    return { label: 'Halted', className: 'bg-rose-500/15 text-rose-300 border border-rose-400/20' };
  }
  if (st === 'settling') {
    return { label: 'Settling', className: 'bg-sky-500/15 text-sky-300 border border-sky-400/20' };
  }
  if (st === 'draft') {
    return { label: 'Draft', className: 'bg-white/10 text-white/55 border border-white/[0.08]' };
  }
  if (st === 'listed' && c.listed !== false && c.trading_enabled !== false) {
    return { label: 'Trading', className: 'bg-emerald-500/15 text-emerald-300 border border-emerald-400/20' };
  }
  if (c.trading_enabled === false) {
    return { label: 'Paused', className: 'bg-[rgba(254, 157, 85,0.15)] text-[#FE9D55]/90 border border-[rgba(254, 157, 85,0.25)]' };
  }
  if (c.listed === false) {
    return { label: 'Unlisted', className: 'bg-white/10 text-white/60 border border-white/[0.08]' };
  }
  return {
    label: st ? st.replace(/_/g, ' ') : '—',
    className: 'bg-white/10 text-white/70 border border-white/[0.08]',
  };
}
function contractStateTitle(c) {
  const parts = [
    `status: ${c.status ?? '—'}`,
    `listed: ${c.listed !== false}`,
    `trading_enabled: ${c.trading_enabled !== false}`,
  ];
  if (c.settled_at) parts.push(`settled_at: ${c.settled_at}`);
  if (c.demo_contract) parts.push('not connected to live matching');
  return parts.join('\n');
}
function fmtQtyBound(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return '—';
  if (Math.abs(n) >= 1e6) return `${(n / 1e6).toFixed(n % 1e6 === 0 ? 0 : 2)}M`;
  if (Math.abs(n) >= 1e3) return n.toLocaleString(undefined, { maximumFractionDigits: 6 });
  return fmtNum(n, 6);
}
/** Short local timestamp for created_at / last_at. */
function formatShortTs(iso) {
  if (!iso) return '—';
  const t = Date.parse(String(iso).trim().replace('Z', '+00:00'));
  if (!Number.isFinite(t)) return '—';
  return new Date(t).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
function fmtMarketPx(v) {
  if (v == null || v === '') return '—';
  const n = Number(v);
  if (!Number.isFinite(n)) return '—';
  const abs = Math.abs(n);
  if (abs >= 10_000) return fmtNum(n, 0);
  if (abs >= 1_000) return fmtNum(n, 1);
  if (abs >= 100) return fmtNum(n, 2);
  if (abs >= 1) return fmtNum(n, 4);
  return fmtNum(n, 6);
}
function fmtOi(v) {
  if (v == null || v === '') return '—';
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return n === 0 ? '0' : '—';
  return fmtQtyBound(n);
}
/** OI notional in USDT when mark exists; else OI contracts. */
function fmtOpenUsdtNotional(oi, mid) {
  const o = Number(oi);
  const m = Number(mid);
  if (!Number.isFinite(o) || o <= 0) return '—';
  if (!Number.isFinite(m) || m <= 0) return fmtOi(oi);
  return fmtNum(o * m, 2);
}
function positionQtyLabel(contractId, positions) {
  if (!contractId || !positions?.length) return '—';
  const p = positions.find((x) => x.contract_id === contractId && x.status === 'open');
  if (!p) return '—';
  return fmtNum(p.qty, 4);
}
/** Expiry tab label: UTC date short. */
function formatExpiryTabLabel(iso) {
  const t = expiryMs(iso);
  if (!Number.isFinite(t)) return String(iso || '').slice(0, 10) || '—';
  const d = new Date(t);
  const day = String(d.getUTCDate()).padStart(2, '0');
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const yy = String(d.getUTCFullYear()).slice(-2);
  return `${day} ${months[d.getUTCMonth()]} ${yy}`;
}
function PanelHeader({ title, right }) {
  return (
    <div className="flex items-center justify-between gap-2 border-b border-[color:var(--ibo-border-solid)] bg-[color:var(--ibo-elevated)] px-2.5 py-1.5 shrink-0">
      <span className="text-[10px] font-extrabold uppercase tracking-[0.12em] text-[#FE9D55]">{title}</span>
      {right != null ? <span className="font-mono text-[10px] font-semibold text-[color:var(--ibo-muted)]">{right}</span> : null}
    </div>
  );
}
function StatChip({ label, value, mono }) {
  return (
    <div className="flex flex-col gap-0.5 pl-4 first:pl-0 border-l border-[color:var(--ibo-border-solid)] first:border-l-0">
      <span className="text-[10px] text-[color:var(--ibo-muted)] uppercase tracking-widest font-bold whitespace-nowrap">{label}</span>
      <span className={`text-sm font-extrabold text-[color:var(--ibo-ink)] whitespace-nowrap ${mono ? 'font-mono' : ''}`}>{value}</span>
    </div>
  );
}
export default function OptionsTradePage() {
  const { underlying: rawUnderlying } = useParams();
  const navigate = useNavigate();
  const { user, kyc, balance } = useAuth();
  const toast = useToast();
  const underlying = (rawUnderlying || DEFAULT_UNDERLYING).toUpperCase().replace(/[^A-Z0-9]/g, '') || DEFAULT_UNDERLYING;
  // Guard: /options/move must never render as vanilla Options (legacy path → /move).
  useEffect(() => {
    if (underlying === 'MOVE') {
      navigate('/move/BTC', { replace: true });
    }
  }, [underlying, navigate]);
  const [underlyings, setUnderlyings] = useState([]);
  const [contracts, setContracts] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [wallet, setWallet] = useState(null);
  const [positions, setPositions] = useState([]);
  const [openOrders, setOpenOrders] = useState([]);
  const [orderHist, setOrderHist] = useState([]);
  const [myTrades, setMyTrades] = useState([]);
  const [bottomTab, setBottomTab] = useState('positions');
  const [side, setSide] = useState('buy');
  const [price, setPrice] = useState('');
  const [qty, setQty] = useState('');
  const [xferOpen, setXferOpen] = useState(false);
  const [xferDir, setXferDir] = useState('spot_to_options');
  const [xferAmt, setXferAmt] = useState('');
  const [usingDemoChain, setUsingDemoChain] = useState(false);
  const [demoIndexPrice, setDemoIndexPrice] = useState(null);
  const [depth, setDepth] = useState(undefined);
  const [recentTape, setRecentTape] = useState([]);
  const [feeRates, setFeeRates] = useState(null);
  const depthContractRef = useRef(null);
  const [pairOpen, setPairOpen] = useState(false);
  const [dropPos, setDropPos] = useState(null);
  const dropRef = useRef(null);
  const [mobilePanelTab, setMobilePanelTab] = useState('chain'); // trade | book | chain — land on chain until a strike is picked
  const [selectedExpiry, setSelectedExpiry] = useState(null);
  const [liveIndexPrice, setLiveIndexPrice] = useState(null);
  const [chainCols, setChainCols] = useState(() => ({ ...DEFAULT_CHAIN_COLS }));
  const [optionsView, setOptionsView] = useState('chain'); // chain | chart | strategy
  const [indexHistory, setIndexHistory] = useState([]);
  const [orderType, setOrderType] = useState('limit');
  const [makerOnly, setMakerOnly] = useState(false);
  const [reduceOnly, setReduceOnly] = useState(false);
  const [tif, setTif] = useState('GTC');
  const [bracketOn, setBracketOn] = useState(false);
  const [takeProfit, setTakeProfit] = useState('');
  const [stopLoss, setStopLoss] = useState('');
  const [stopTrigger, setStopTrigger] = useState('');
  // Keep full Delta column set even if HMR retained older state object without new keys
  useEffect(() => {
    setChainCols((prev) => resolveChainCols(prev));
  }, []);
  const visibleChainCols = useMemo(() => resolveChainCols(chainCols), [chainCols]);
  const premiumNotional = useMemo(() => {
    const p = parseFloat(price);
    const q = parseFloat(qty);
    if (!Number.isFinite(p) || !Number.isFinite(q) || p <= 0 || q <= 0) return 0;
    return p * q;
  }, [price, qty]);
  const estFeeIbo = useMemo(() => {
    if (!feeRates || premiumNotional <= 0) return 0;
    const taker = Number(feeRates.taker_fee_rate) || 0;
    const maker = Number(feeRates.maker_fee_rate) || 0;
    const rate = Math.max(taker, Math.max(0, maker));
    return estimateIboFee({
      quoteNotional: premiumNotional,
      feeRate: rate,
      iboPriceUsdt: Number(feeRates.ibo_price_usdt) || 0.4523,
    });
  }, [feeRates, premiumNotional]);
  const availIbo = Number(balance?.Delta ?? 0);
  const insufficientIboFee = !!user && estFeeIbo > 0 && estFeeIbo > availIbo + 1e-12;
  const selected = useMemo(
    () => contracts.find((c) => c.id === selectedId) || null,
    [contracts, selectedId],
  );
  const myPosOnContract = useMemo(() => {
    if (!selectedId || !positions.length) return null;
    return positions.find((p) => p.contract_id === selectedId && p.status === 'open') || null;
  }, [positions, selectedId]);
  const uniqueExpiries = useMemo(() => {
    const ex = [...new Set(contracts.map((c) => String(c.expiry || '')))].filter(Boolean);
    ex.sort((a, b) => a.localeCompare(b));
    return ex;
  }, [contracts]);
  useEffect(() => {
    if (!contracts.length) {
      setSelectedExpiry(null);
      return;
    }
    setSelectedExpiry((prev) => (prev && uniqueExpiries.includes(prev) ? prev : uniqueExpiries[0] || null));
  }, [contracts, uniqueExpiries]);
  /** One strikes matrix per expiry — each gets its own header + table. */
  const chainSections = useMemo(
    () => uniqueExpiries.map((exp) => ({ expiry: exp, rows: buildStrikesMatrix(contracts, exp) })),
    [contracts, uniqueExpiries],
  );
  const referenceIndex = useMemo(() => {
    if (liveIndexPrice != null && Number.isFinite(liveIndexPrice)) return liveIndexPrice;
    if (demoIndexPrice != null && Number.isFinite(Number(demoIndexPrice))) return Number(demoIndexPrice);
    const mids = contracts
      .map((x) => x.market?.mid)
      .filter((x) => x != null && Number.isFinite(Number(x)))
      .map(Number);
    if (mids.length) {
      mids.sort((a, b) => a - b);
      return mids[Math.floor(mids.length / 2)];
    }
    const strikes = [
      ...new Set(contracts.map((c) => Number(c.strike)).filter((s) => Number.isFinite(s))),
    ].sort((a, b) => a - b);
    if (strikes.length) return strikes[Math.floor(strikes.length / 2)];
    return null;
  }, [contracts, demoIndexPrice, liveIndexPrice]);
  const loadPublic = useCallback(async () => {
    setLoading(true);
    setError(null);
    let underlyingsList = [];
    try {
      const uRes = await optionsApi.listUnderlyings({ listed_only: true });
      underlyingsList = uRes.underlyings || [];
    } catch {
      underlyingsList = [{ symbol: underlying }];
    }
    setUnderlyings(underlyingsList);
    try {
      const fr = await optionsApi.feeRates();
      setFeeRates(fr);
    } catch {
      setFeeRates(null);
    }
    let list = [];
    let chainErr = null;
    try {
      const fast = await optionsApi.listContracts({
        underlying_symbol: underlying,
        listed_only: true,
        option_type: 'vanilla',
        limit: 500,
      });
      if (Array.isArray(fast?.contracts) && fast.contracts.length) {
        list = vanillaContractsOnly(fast.contracts);
        setContracts(list);
        setLoading(false);
      }
    } catch {
      /* continue to full chain */
    }
    try {
      const cRes = await optionsApi.getChain(underlying, true);
      list = vanillaContractsOnly(cRes.contracts || list);
    } catch (e) {
      chainErr = e.message || 'Could not load chain from API';
    }
    let demo = false;
    let idx = null;
    if (!list.length) {
      try {
        const d = await optionsApi.demoChain(underlying);
        if (d?.demo && Array.isArray(d.contracts) && d.contracts.length) {
          list = vanillaContractsOnly(d.contracts);
          demo = true;
          idx = d.index_price ?? null;
        }
      } catch {
        /* ignore */
      }
    }
    if (!list.length && chainErr) {
      setError('Could not load option contracts. Please refresh the page or try again in a moment.');
    }
    setUsingDemoChain(demo);
    setDemoIndexPrice(idx);
    setContracts(vanillaContractsOnly(list));
    setSelectedId((prev) => {
      if (prev && list.some((c) => c.id === prev)) return prev;
      /* No default strike — user picks Call/Put on the chain first; book + ticket appear after. */
      return null;
    });
    setLoading(false);
  }, [underlying]);
  const loadPrivate = useCallback(async () => {
    if (!user) return;
    try {
      const [w, p, o, h, t] = await Promise.all([
        optionsApi.wallet(),
        optionsApi.positions(),
        optionsApi.openOrders(),
        optionsApi.orderHistory({ limit: 40 }),
        optionsApi.myTrades({ limit: 40 }),
      ]);
      setWallet(w);
      // Vanilla Options blotter only — MOVE/straddle positions belong on /move.
      const notMove = (row) => !isMoveContract(row?.contract_id || row);
      setPositions((p.positions || []).filter(notMove));
      setOpenOrders((o.orders || []).filter(notMove));
      setOrderHist((h.orders || []).filter(notMove));
      setMyTrades((t.trades || []).filter(notMove));
    } catch {
      /* non-fatal */
    }
  }, [user]);
  useEffect(() => {
    loadPublic();
  }, [loadPublic]);
  useEffect(() => {
    loadPrivate();
  }, [loadPrivate]);
  useEffect(() => {
    setDepth(undefined);
    setRecentTape([]);
  }, [selectedId, usingDemoChain]);
  const loadDepth = useCallback(async () => {
    if (!selectedId || usingDemoChain) return;
    try {
      const d = await optionsApi.depth(selectedId, { levels: 16 });
      setDepth(d);
    } catch {
      setDepth(null);
    }
  }, [selectedId, usingDemoChain]);
  useEffect(() => {
    loadDepth();
  }, [loadDepth]);
  useEffect(() => {
    depthContractRef.current = selectedId;
    if (!selectedId || usingDemoChain) {
      setDepth(undefined);
      setRecentTape([]);
      return undefined;
    }
    setDepth(undefined);
    setRecentTape([]);
    const handle = openOptionsDepthWs(selectedId, 16, (msg) => {
      if (msg?.type !== 'options_depth') return;
      if (msg.contract_id !== depthContractRef.current) return;
      setDepth({ contract_id: msg.contract_id, bids: msg.bids || [], asks: msg.asks || [] });
      if (Array.isArray(msg.recent_trades)) setRecentTape(msg.recent_trades);
    });
    return () => handle?.close();
  }, [selectedId, usingDemoChain]);
  useEffect(() => {
    if (!user) return undefined;
    const handle = openOptionsAccountWs((msg) => {
      if (msg?.type !== 'options_account') return;
      if (msg.wallet) setWallet(msg.wallet);
      const notMove = (row) => !isMoveContract(row?.contract_id || row);
      if (Array.isArray(msg.positions)) setPositions(msg.positions.filter(notMove));
      if (Array.isArray(msg.open_orders)) setOpenOrders(msg.open_orders.filter(notMove));
      if (Array.isArray(msg.order_history)) setOrderHist(msg.order_history.filter(notMove));
      if (Array.isArray(msg.user_trades)) setMyTrades(msg.user_trades.filter(notMove));
    });
    return () => handle?.close();
  }, [user]);
  useEffect(() => {
    if (usingDemoChain) return undefined;
    const handle = openOptionsChainWs(underlying, (msg) => {
      if (msg?.type !== 'options_chain') return;
      if (msg.underlying_symbol !== underlying) return;
      if (msg.index_price != null && Number.isFinite(Number(msg.index_price))) {
        setLiveIndexPrice(Number(msg.index_price));
        setIndexHistory((prev) => {
          const next = [...prev, { t: Date.now(), index: Number(msg.index_price) }];
          return next.length > 200 ? next.slice(-200) : next;
        });
      }
      if (Array.isArray(msg.contracts) && msg.contracts.length) {
        const updates = new Map(msg.contracts.map((c) => [c.id, c]));
        setContracts((prev) =>
          prev.map((c) => {
            const u = updates.get(c.id);
            if (!u) return c;
            return { ...c, market: { ...(c.market || {}), ...u } };
          }),
        );
      }
    });
    return () => handle?.close();
  }, [underlying, usingDemoChain]);
  // Seed index chart history from live/demo reference
  useEffect(() => {
    if (liveIndexPrice == null && demoIndexPrice == null) return;
    const v = liveIndexPrice != null ? Number(liveIndexPrice) : Number(demoIndexPrice);
    if (!Number.isFinite(v)) return;
    setIndexHistory((prev) => {
      const last = prev[prev.length - 1];
      if (last && Math.abs(last.index - v) < 1e-9 && Date.now() - last.t < 2000) return prev;
      const next = [...prev, { t: Date.now(), index: v }];
      return next.length > 200 ? next.slice(-200) : next;
    });
  }, [liveIndexPrice, demoIndexPrice]);
  const selectContractFromChain = useCallback((id, sideHint = 'buy') => {
    if (!id) return;
    setSelectedId(id);
    setSide(sideHint);
    const c = contracts.find((x) => x.id === id);
    const mk = c?.market || {};
    const px = sideHint === 'buy'
      ? (mk.best_ask ?? mk.mid ?? mk.mark_price)
      : (mk.best_bid ?? mk.mid ?? mk.mark_price);
    if (px != null && Number.isFinite(Number(px)) && Number(px) > 0) {
      setPrice(String(Number(px)));
    }
    setMobilePanelTab('trade');
  }, [contracts]);
  /* Keep mobile UI coherent if selection is cleared (e.g. reload). */
  useEffect(() => {
    if (!selected && mobilePanelTab === 'trade') {
      setMobilePanelTab('chain');
    }
  }, [selected, mobilePanelTab]);
  const refresh = () => {
    loadPublic();
    loadPrivate();
    loadDepth();
    if (selectedId && !usingDemoChain) {
      optionsApi.contractTrades(selectedId, { limit: 25 }).then((r) => {
        if (Array.isArray(r?.trades)) setRecentTape(r.trades);
      }).catch(() => {});
    }
  };
  const switchUnderlying = (sym) => {
    setPairOpen(false);
    navigate(`/options/${sym}`);
  };
  const submitOrder = async (opts = {}) => {
    if (usingDemoChain) {
      toast.warning(
        'Preview contracts only',
        'These contracts are not on the live order book yet. An operator must publish tradable contracts first.',
      );
      return;
    }
    if (!user) {
      navigate('/login');
      return;
    }
    if (kyc?.status !== 'approved') {
      toast.error('KYC required', 'Complete identity verification before trading options.');
      return;
    }
    if (!selected) return;
    const ot = opts.orderType || orderType || 'limit';
    const p = ot === 'market' ? (parseFloat(price) || Number(selected.market?.mid) || Number(selected.market?.best_ask) || 0) : parseFloat(price);
    const q = parseFloat(qty);
    if (ot !== 'market' && (!Number.isFinite(p) || p <= 0)) {
      toast.error('Invalid price', 'Enter the limit premium — the price per contract in USDT.');
      return;
    }
    if (ot === 'market' && (!Number.isFinite(p) || p <= 0)) {
      toast.error('No market price', 'Cannot submit market order without a reference premium.');
      return;
    }
    if (ot === 'stop_limit' && !(parseFloat(opts.stopTrigger || stopTrigger) > 0)) {
      toast.error('Stop trigger required', 'Enter a stop trigger price for Stop Limit orders.');
      return;
    }
    if (!Number.isFinite(q) || q <= 0) {
      toast.error('Invalid quantity', 'Enter how many contracts you want to trade (must be greater than 0).');
      return;
    }
    if (insufficientIboFee) {
      toast.error(
        'Insufficient Delta',
        `Need ~${formatIboFee(estFeeIbo)} for trading fees (available ${availIbo.toFixed(8)} Delta).`,
      );
      return;
    }
    setBusy(true);
    try {
      const payload = {
        contract_id: selected.id,
        side,
        type: ot === 'market' ? 'market' : 'limit',
        quantity: q,
        price: ot === 'market' ? undefined : p,
        reduce_only: Boolean(opts.reduceOnly) || side === 'sell' || reduceOnly,
        time_in_force: String(opts.tif || tif || 'GTC').toLowerCase(),
        post_only: Boolean(opts.makerOnly || makerOnly) && ot !== 'market',
      };
      if (ot === 'stop_limit') {
        // Backend v1 is limit/market — keep stop trigger in client toast until stop orders ship
        toast.warning('Stop Limit', 'Stop trigger saved locally; order submits as a limit at your price.');
        payload.price = p;
        payload.type = 'limit';
      }
      if (opts.bracket || (bracketOn && (takeProfit || stopLoss))) {
        toast.info(
          'Bracket noted',
          `TP ${opts.bracket?.take_profit || takeProfit || '—'} · SL ${opts.bracket?.stop_loss || stopLoss || '—'} (attached after fill in a later release)`,
        );
      }
      await optionsApi.placeOrder(payload);
      setQty('');
      const optType = (selected.option_type || '').toUpperCase();
      const strike = fmtNum(selected.strike, 2);
      if (side === 'buy') {
        toast.success(
          'Buy order placed',
          `${optType} · Strike ${strike} — ${q} contract${q !== 1 ? 's' : ''} @ ${fmtNum(p, 4)} USDT`,
        );
      } else {
        toast.success(
          'Sell order placed',
          `${optType} · Strike ${strike} — closing ${q} contract${q !== 1 ? 's' : ''} @ ${fmtNum(p, 4)} USDT`,
        );
      }
      await loadPrivate();
      await loadPublic();
    } catch (e) {
      toast.error('Order failed', friendlyError(e.message));
    } finally {
      setBusy(false);
    }
  };
  const cancelOrder = async (id) => {
    if (!user) return;
    setBusy(true);
    try {
      await optionsApi.cancelOrder(id);
      toast.success('Order cancelled', 'Your open order has been removed from the book.');
      await loadPrivate();
    } catch (e) {
      toast.error('Could not cancel order', friendlyError(e.message));
    } finally {
      setBusy(false);
    }
  };
  const submitTransfer = async () => {
    if (!user) {
      navigate('/login');
      return;
    }
    const a = parseFloat(xferAmt);
    if (!Number.isFinite(a) || a <= 0) {
      toast.error('Invalid amount', 'Enter a positive USDT amount to transfer.');
      return;
    }
    setBusy(true);
    try {
      await optionsApi.transfer({ direction: xferDir, asset: 'USDT', amount: a });
      const isIn = xferDir === 'spot_to_options';
      toast.success(
        'Transfer complete',
        isIn
          ? `${fmtNum(a, 2)} USDT moved to your Options wallet — ready to trade.`
          : `${fmtNum(a, 2)} USDT returned to your Funding wallet.`,
      );
      setXferAmt('');
      setXferOpen(false);
      await loadPrivate();
    } catch (e) {
      toast.error('Transfer failed', friendlyError(e.message));
    } finally {
      setBusy(false);
    }
  };
  const base = baseFromUsdt(underlying);
  const icon = COIN_ICONS[base];
  const ul = underlyings.length ? underlyings : [{ symbol: underlying }];
  const UnderlyingDropdown = (
    <>
      <div style={{ position: 'relative', flexShrink: 0 }} ref={dropRef}>
        <button
          type="button"
          onClick={() => {
            if (!pairOpen && dropRef.current) {
              const r = dropRef.current.getBoundingClientRect();
              setDropPos({ top: r.bottom + 6, left: Math.min(r.left, window.innerWidth - 310) });
            }
            setPairOpen((v) => !v);
          }}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '7px 12px',
            borderRadius: 10,
            background: 'var(--ibo-card)',
            border: `1px solid ${pairOpen ? 'rgba(254, 157, 85,0.5)' : 'var(--ibo-border-solid)'}`,
            cursor: 'pointer',
            transition: 'border-color 0.2s',
            flexShrink: 0,
            color: 'var(--ibo-ink)',
          }}
        >
          {icon && <img src={icon} alt={base} style={{ width: 24, height: 24, borderRadius: '50%' }} />}
          <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--ibo-ink)' }}>{base}</span>
          <span style={{ fontSize: 13, color: 'var(--ibo-muted)' }}>/USDT</span>
          <span className="rounded bg-[rgba(254, 157, 85,0.15)] px-1.5 py-0.5 text-[9px] font-extrabold uppercase tracking-wider text-[#FE9D55]">
            Options
          </span>
          <ChevronDown
            size={13}
            color="var(--ibo-ink)"
            style={{ transform: pairOpen ? 'rotate(180deg)' : 'none', transition: '0.2s' }}
          />
        </button>
      </div>
      {pairOpen && dropPos && createPortal(
        <>
          <div style={{ position: 'fixed', inset: 0, zIndex: 9998 }} onClick={() => setPairOpen(false)} />
          <div
            style={{
              position: 'fixed',
              top: dropPos.top,
              left: dropPos.left,
              width: Math.min(300, window.innerWidth - 16),
              background: 'var(--ibo-card)',
              border: '1px solid var(--ibo-border-solid)',
              borderRadius: 12,
              boxShadow: 'var(--ibo-shadow)',
              zIndex: 9999,
              maxHeight: '65vh',
              overflowY: 'auto',
              padding: '6px 0',
            }}
            className="scrollbar-hide font-ui"
          >
            {ul.map((u) => {
              const sym = u.symbol || underlying;
              const b = baseFromUsdt(sym);
              const ic = COIN_ICONS[b];
              const active = sym === underlying;
              return (
                <button
                  key={sym}
                  type="button"
                  onClick={() => switchUnderlying(sym)}
                  style={{
                    width: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    padding: '11px 16px',
                    cursor: 'pointer',
                    background: active ? 'rgba(254, 157, 85,0.1)' : 'transparent',
                    border: 'none',
                    color: active ? '#FE9D55' : 'var(--ibo-ink)',
                    transition: 'background 0.15s',
                  }}
                  className="hover:bg-white/5"
                >
                  {ic && <img src={ic} alt={b} style={{ width: 26, height: 26, borderRadius: '50%' }} />}
                  <div style={{ flex: 1, textAlign: 'left' }}>
                    <div style={{ fontWeight: 700, fontSize: 14 }}>{b}/USDT</div>
                    <div style={{ fontSize: 11, color: 'var(--ibo-muted)', marginTop: 1 }}>European options</div>
                  </div>
                  {active && (
                    <span
                      style={{
                        fontSize: 10,
                        background: 'rgba(254, 157, 85,0.15)',
                        color: '#FE9D55',
                        padding: '2px 8px',
                        borderRadius: 20,
                        fontWeight: 700,
                      }}
                    >
                      ACTIVE
                    </span>
                  )}
                </button>
              );
            })}
            <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', margin: '4px 0' }}>
              <Link
                to="/markets"
                onClick={() => setPairOpen(false)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '10px 16px',
                  color: 'var(--ibo-muted)',
                  fontSize: 14,
                  textDecoration: 'none',
                }}
                className="hover:text-white hover:bg-white/5 transition-colors"
              >
                <Globe size={15} /> All markets
              </Link>
            </div>
          </div>
        </>,
        document.body,
      )}
    </>
  );
  /** Top bar: CALLS | BTC $price · Time to Expiry | PUTS */
  const chainToolbar =
    !loading && contracts.length > 0 && uniqueExpiries.length > 0 ? (
      <div className="doc-chain-bar shrink-0">
        <span className="doc-chain-bar__side is-calls">Calls</span>
        <div className="doc-chain-bar__mid">
          <span className="doc-chain-bar__idx">
            {baseFromUsdt(underlying)}{' '}
            {referenceIndex != null ? `$${fmtNum(referenceIndex, 1)}` : '—'}
          </span>
          {selectedExpiry ? (
            <span className="doc-chain-bar__ttm">
              Time to Expiry:
              <b>{daysToExpiryLabel(selectedExpiry)}</b>
            </span>
          ) : null}
        </div>
        <span className="doc-chain-bar__side is-puts">Puts</span>
      </div>
    ) : null;
  const chainMaxOi = useMemo(() => {
    let max = 1;
    for (const c of contracts) {
      const oi = Number(c.market?.open_interest ?? c.open_interest);
      if (Number.isFinite(oi) && oi > max) max = oi;
    }
    return max;
  }, [contracts]);
  const chainTableShell = (expiryKey, rows) => {
    const atm = computeAtmStrike(rows, referenceIndex);
    return (
      <DeltaSplitChainTable
        expiryKey={expiryKey}
        rows={rows}
        cols={visibleChainCols}
        selectedId={selectedId}
        referencePrice={referenceIndex}
        positions={positions}
        onPick={selectContractFromChain}
        maxOi={chainMaxOi}
        atmStrike={atm}
        fmtStrike={(n) => fmtNum(n, 0)}
      />
    );
  };
  const binanceChainTable = (
    <div className="doc-chain flex min-h-0 min-w-0 w-full max-w-full flex-1 flex-col antialiased overflow-hidden">
      {chainToolbar}
      {contracts.length > 0 && !loading && chainSections.some((s) => s.rows.length > 0) && (
        <p className="sm:hidden shrink-0 px-2 py-1 text-[10px] leading-snug text-[#8b919a] bg-[#fafbfc] border-b border-[#eef0f2]">
          Scroll · tap a cell to select
        </p>
      )}
      <div className="options-chain-scroll-v doc-chain-scroll flex-1 min-h-0 flex flex-col overflow-hidden">
        {loading && !contracts.length ? (
          <div className="flex flex-col items-center justify-center gap-2 py-10 text-sm text-[#8b919a]">
            <RefreshCw size={18} className="animate-spin text-[#fe6c02]" /> Loading option chain…
          </div>
        ) : !contracts.length ? (
          <div className="mx-auto max-w-md p-6 text-center text-sm leading-relaxed text-[#8b919a]">
            No listed contracts for <span className="font-semibold text-[#fe6c02]">{underlying}</span>.
          </div>
        ) : !uniqueExpiries.length ? (
          <div className="p-6 text-center text-sm text-[#8b919a]">No expiries listed.</div>
        ) : (
          (() => {
            const active = selectedExpiry || uniqueExpiries[0];
            const section = chainSections.find((x) => x.expiry === active) || chainSections[0];
            if (!section) return <div className="p-6 text-center text-sm text-[#8b919a]">No expiry selected.</div>;
            if (!section.rows.length) {
              return (
                <div className="py-8 px-4 text-center text-sm text-[#8b919a]">
                  No strikes for {formatExpiryTabLabel(section.expiry)}.
                </div>
              );
            }
            return (
              <div className="flex-1 min-h-0 min-w-0 flex flex-col overflow-hidden">
                {chainTableShell(section.expiry, section.rows)}
              </div>
            );
          })()
        )}
      </div>
    </div>
  );
  const showDepthLoading = Boolean(selectedId) && !usingDemoChain && depth === undefined;
  const selectedMid = useMemo(() => {
    if (!selected) return null;
    const m = selected.market || {};
    const v = m.mid ?? m.mark_price ?? m.last_price ?? selected.mark_price ?? selected.last_price
      ?? m.best_bid ?? m.best_ask ?? selected.bid ?? selected.ask;
    return v != null && Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : null;
  }, [selected]);

  const effectiveDepth = useMemo(() => {
    if (!selectedId) return undefined;
    if (depthHasLevels(depth)) return depth;
    /* Live fetch still in flight */
    if (!usingDemoChain && depth === undefined) return undefined;
    const m = selected?.market || {};
    return buildOptionsDemoDepth({
      mid: selectedMid ?? m.mid ?? m.mark_price ?? 3.3,
      bestBid: m.best_bid ?? selected?.bid,
      bestAsk: m.best_ask ?? selected?.ask,
      contractId: selectedId,
      levels: 12,
    });
  }, [selectedId, usingDemoChain, depth, selectedMid, selected]);

  const effectiveTape = useMemo(() => {
    if (!selectedId) return [];
    if (Array.isArray(recentTape) && recentTape.length > 0) return recentTape;
    const m = selected?.market || {};
    return buildOptionsDemoTrades({
      mid: selectedMid ?? m.mid ?? m.mark_price ?? 3.3,
      contractId: selectedId,
      count: 28,
    });
  }, [selectedId, recentTape, selectedMid, selected]);
  /** Ladder only — reused in card (mobile) and flat column (desktop, same as futures book stack). */
  const orderBookLadder = (
    <>
      {showDepthLoading ? (
        <div className="p-4 text-xs text-white/45 flex items-center gap-2">
          <RefreshCw size={12} className="animate-spin shrink-0" /> Loading depth…
        </div>
      ) : effectiveDepth === null ? (
        <div className="p-4 text-xs text-white/45">Depth unavailable.</div>
      ) : effectiveDepth ? (
        <div className="grid grid-cols-2 flex-1 min-h-0 divide-x divide-white/[0.06]">
          <div className="flex flex-col min-h-0 order-book-panel">
            <div className="px-2 py-1.5 text-[10px] font-bold uppercase tracking-wider text-emerald-400/90 bg-emerald-500/5 border-b border-white/[0.04]">
              Bids
            </div>
            <div className="order-book-scroll flex-1 px-2 py-1 font-mono text-[11px] space-y-px">
              {(effectiveDepth.bids || []).slice(0, 12).map((row, i) => (
                <button
                  key={`b-${i}`}
                  type="button"
                  onClick={() => setPrice(String(row[0]))}
                  className="order-book-row flex w-full justify-between gap-2 rounded px-1 py-0.5 text-left hover:bg-emerald-500/10 text-white/90"
                >
                  <span className="text-emerald-300/95 tabular-nums">{fmtNum(row[0], 6)}</span>
                  <span className="text-white/50 tabular-nums">{fmtNum(row[1], 4)}</span>
                </button>
              ))}
              {!(effectiveDepth.bids || []).length && (
                <div className="text-white/35 py-2 text-center text-[11px]">No bids yet</div>
              )}
            </div>
          </div>
          <div className="flex flex-col min-h-0 order-book-panel">
            <div className="px-2 py-1.5 text-[10px] font-bold uppercase tracking-wider text-rose-400/90 bg-rose-500/5 border-b border-white/[0.04]">
              Asks
            </div>
            <div className="order-book-scroll flex-1 px-2 py-1 font-mono text-[11px] space-y-px">
              {(effectiveDepth.asks || []).slice(0, 12).map((row, i) => (
                <button
                  key={`a-${i}`}
                  type="button"
                  onClick={() => setPrice(String(row[0]))}
                  className="order-book-row flex w-full justify-between gap-2 rounded px-1 py-0.5 text-left hover:bg-rose-500/10 text-white/90"
                >
                  <span className="text-rose-300/95 tabular-nums">{fmtNum(row[0], 6)}</span>
                  <span className="text-white/50 tabular-nums">{fmtNum(row[1], 4)}</span>
                </button>
              ))}
              {!(effectiveDepth.asks || []).length && (
                <div className="text-white/35 py-2 text-center text-[11px]">No asks yet</div>
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="p-4 text-xs text-white/45">Select a contract.</div>
      )}
    </>
  );
  const recentTradesTape = (
    <>
      {effectiveTape.slice(0, 16).map((tr) => (
        <div
          key={tr.id || `${tr.created_at}-${tr.price}`}
          className="flex justify-between gap-2 border-b border-white/[0.03] py-1"
        >
          <span className={tr.side === 'buy' ? 'text-emerald-400 font-bold w-8' : 'text-rose-400 font-bold w-8'}>
            {tr.side}
          </span>
          <span className="text-white/80 tabular-nums">{fmtNum(tr.price, 6)}</span>
          <span className="text-white/45 tabular-nums">{fmtNum(tr.qty, 4)}</span>
        </div>
      ))}
      {!effectiveTape.length && (
        <div className="text-white/35 py-3 text-center text-[11px]">No fills yet</div>
      )}
    </>
  );
  /** Book + recent trades (stacked under instrument bar with ticket). */
  const desktopBookColumn = (
    <div className="delta-trade-col delta-trade-book flex min-h-0 flex-1 min-w-0 flex-col overflow-hidden border-r border-[#e8eaed] bg-white">
      <div className="flex-[2.4] min-h-0 overflow-hidden">
        <OptionsOrderBook
          depth={effectiveDepth}
          loading={!!showDepthLoading}
          midPrice={selectedMid ?? (selected ? (selected.market?.mid ?? selected.market?.mark_price ?? null) : null)}
          markIv={selected?.market?.iv ?? selected?.iv}
          onPriceClick={(pr) => setPrice(String(pr))}
          emptyHint={selectedId ? 'No depth for this contract yet' : 'Select a contract from the chain'}
          sizeUnit={baseFromUsdt(underlying)}
        />
      </div>
      <div className="flex-[0.85] min-h-[140px] max-h-[38%] border-t border-[color:var(--ibo-border)] overflow-hidden">
        <OptionsRecentTrades trades={effectiveTape} sizeUnit={baseFromUsdt(underlying)} />
      </div>
    </div>
  );
  const onBestOffer = () => {
    if (!selected) return;
    const mk = selected.market || {};
    const px = side === 'buy'
      ? (mk.best_ask ?? mk.mid ?? mk.mark_price)
      : (mk.best_bid ?? mk.mid ?? mk.mark_price);
    if (px != null && Number.isFinite(Number(px)) && Number(px) > 0) {
      setPrice(String(Number(px)));
    }
  };

  const orderForm = (
    <DeltaOptionsTicket
      selected={selected}
      underlying={underlying}
      referenceIndex={referenceIndex}
      side={side}
      setSide={setSide}
      price={price}
      setPrice={setPrice}
      qty={qty}
      setQty={setQty}
      wallet={wallet}
      user={user}
      kyc={kyc}
      busy={busy}
      usingDemoChain={usingDemoChain}
      onSubmit={submitOrder}
      onBestOffer={onBestOffer}
      orderType={orderType}
      setOrderType={setOrderType}
      makerOnly={makerOnly}
      setMakerOnly={setMakerOnly}
      reduceOnly={reduceOnly}
      setReduceOnly={setReduceOnly}
      tif={tif}
      setTif={setTif}
      bracketOn={bracketOn}
      setBracketOn={setBracketOn}
      takeProfit={takeProfit}
      setTakeProfit={setTakeProfit}
      stopLoss={stopLoss}
      setStopLoss={setStopLoss}
      stopTrigger={stopTrigger}
      setStopTrigger={setStopTrigger}
    />
  );

  const headerStatsRow = (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 min-w-0 text-white">
      {selected && (
        <>
          <StatChip label="Type" value={String(selected.option_type || '—').toUpperCase()} />
          <StatChip label="Strike" value={fmtNum(selected.strike, 2)} mono />
          <StatChip label="Expiry" value={selected.expiry?.slice(0, 10) || '—'} mono />
        </>
      )}
      {feeRates && (
        <StatChip
          label="Fees (Delta)"
          value={`T ${(Number(feeRates.taker_fee_rate) * 100).toFixed(3)}% · M ${(Number(feeRates.maker_fee_rate) * 100).toFixed(3)}%`}
        />
      )}
      {referenceIndex != null && Number.isFinite(Number(referenceIndex)) && (
        <StatChip label="Ref. index" value={fmtNum(referenceIndex, 2)} mono />
      )}
    </div>
  );
  const bottomTables = bottomTablesFor({
    bottomTab,
    positions,
    openOrders,
    orderHist,
    myTrades,
    busy,
    cancelOrder,
    fmtNum,
    shortContractId,
    contracts,
    wallet,
    referenceIndex,
  });
  return (
    <div className="doc-opts-page bg-[color:var(--ibo-bg)] text-[color:var(--ibo-ink)] max-w-[100vw] overflow-x-hidden font-ui">

      {/* Mobile — flows vertically like Futures so the window scrolls to zone 2 */}
      <div className="flex min-h-[100dvh] flex-col md:hidden">
        <div
          className="flex flex-col gap-2 px-3 py-2.5 border-b border-white/[0.06] shrink-0 relative z-[200] bg-[color:var(--ibo-surface)]"
          style={{ pointerEvents: pairOpen ? 'none' : 'auto' }}
        >
          <div className="flex items-center gap-2 overflow-x-auto scrollbar-hide">
            {UnderlyingDropdown}
            <button
              type="button"
              onClick={refresh}
              className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-[color:var(--ibo-border-solid)] px-2.5 py-2 text-[11px] font-bold text-[color:var(--ibo-ink-secondary)] hover:text-[color:var(--ibo-ink)] hover:bg-[color:var(--ibo-hover)] shrink-0"
            >
              <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
            </button>
          </div>
          {headerStatsRow}
        </div>
        {error && (
          <div className="mx-3 mt-2 flex items-center gap-2 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
            <AlertCircle size={16} className="shrink-0" />
            <span className="flex-1">{error}</span>
            <button type="button" onClick={() => setError(null)} className="shrink-0 text-rose-300/60 hover:text-rose-200"><X size={14} /></button>
          </div>
        )}
        <div className="flex border-b border-white/[0.06] bg-[color:var(--ibo-surface)] shrink-0">
          {[
            { id: 'chain', label: 'Chain', needsContract: false },
            { id: 'book', label: 'Book', needsContract: false },
            { id: 'trade', label: 'Trade', needsContract: true },
          ].map((t) => {
            const locked = t.needsContract && !selected;
            return (
              <button
                key={t.id}
                type="button"
                disabled={locked}
                title={locked ? 'Tap a Call or Put on the chain first' : undefined}
                onClick={() => setMobilePanelTab(t.id)}
                className={`flex-1 py-2.5 text-[11px] font-extrabold uppercase tracking-wide border-b-2 transition-colors ${
                  locked ? 'border-transparent text-white/25 opacity-50 cursor-not-allowed' : ''
                } ${
                  !locked && mobilePanelTab === t.id
                    ? 'border-[#FE9D55] text-[#FE9D55] bg-[rgba(254, 157, 85,0.06)]'
                    : !locked
                      ? 'border-transparent text-white/45'
                      : ''
                }`}
              >
                {t.label}
              </button>
            );
          })}
          {selected && (
            <button
              type="button"
              title="Close book & ticket — back to chain"
              onClick={() => {
                setSelectedId(null);
                setMobilePanelTab('chain');
              }}
              className="shrink-0 px-3 py-2.5 text-white/40 hover:text-white border-b-2 border-transparent hover:bg-white/[0.05] transition-colors"
            >
              <X size={14} />
            </button>
          )}
        </div>
        {/* flex-1 fills space between tabs and bottom tables so the chain can show more strike rows */}
        <div className="flex flex-1 flex-col min-h-0 bg-[color:var(--ibo-bg)]">
          {mobilePanelTab === 'chain' && (
            <div className="flex flex-1 flex-col min-h-[280px] border-b border-white/[0.06]">
              {binanceChainTable}
            </div>
          )}
          {mobilePanelTab === 'book' && (
            <div className="grid min-h-[320px] h-[min(520px,65dvh)] grid-rows-[1.6fr_1fr] gap-0 bg-[color:var(--ibo-bg)] flex-1 min-h-0 border-b border-[color:var(--ibo-border)]">
              <div className="flex min-h-0 flex-col overflow-hidden">
                <OptionsOrderBook
                  depth={effectiveDepth}
                  loading={!!showDepthLoading}
                  midPrice={selectedMid}
                  markIv={selected?.market?.iv ?? selected?.iv}
                  onPriceClick={(pr) => setPrice(String(pr))}
                  emptyHint={selectedId ? 'No depth for this contract yet' : 'Select a contract from the chain'}
                  sizeUnit={baseFromUsdt(underlying)}
                />
              </div>
              <div className="flex min-h-0 flex-col overflow-hidden border-t border-[color:var(--ibo-border)]">
                <OptionsRecentTrades trades={effectiveTape} sizeUnit={baseFromUsdt(underlying)} />
              </div>
            </div>
          )}
          {mobilePanelTab === 'trade' && (
            <div className="flex min-h-[min(420px,55dvh)] flex-1 flex-col overflow-y-auto bg-[color:var(--ibo-bg)] p-2 scrollbar-hide pb-[max(0.5rem,env(safe-area-inset-bottom))]">
              {orderForm}
            </div>
          )}
        </div>
        <div className="border-t-2 border-[rgba(254, 157, 85,0.25)] bg-[color:var(--ibo-surface)] flex flex-col" style={{ minHeight: 460 }}>
          <div className="flex overflow-x-auto border-b border-white/[0.06] scrollbar-hide shrink-0">
            {[
                  { id: 'positions', label: 'Positions', n: positions.length },
                  { id: 'open', label: 'Open Orders', n: openOrders.length },
                  { id: 'stop', label: 'Stop Orders', n: 0 },
                  { id: 'fills', label: 'Fills', n: myTrades.length },
                  { id: 'hist', label: 'Order History', n: orderHist.length },
                  { id: 'risk', label: 'Risk & Margin', n: 0 },
                  { id: 'bills', label: 'Bills', n: 0 },
                ].map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setBottomTab(t.id)}
                className={`px-4 py-2.5 text-xs font-extrabold whitespace-nowrap border-b-2 shrink-0 ${
                  bottomTab === t.id ? 'border-[#fe6c02] text-[#fe6c02]' : 'border-transparent text-white/45'
                }`}
              >
                {t.label}
                {t.n > 0 ? <span className="ml-1.5 opacity-70">({t.n})</span> : null}
              </button>
            ))}
          </div>
          <div className="flex-1 p-3 text-xs">
            {!user ? (
              <div className="flex flex-col items-center justify-center gap-2 py-14 text-center text-sm text-white/50">
                <span>
                  <Link to="/login" className="font-bold text-[#FE9D55] hover:underline">
                    Sign in
                  </Link>{' '}
                  to view positions, orders, and trade history.
                </span>
              </div>
            ) : (
              <div className="overflow-x-auto">{bottomTables}</div>
            )}
          </div>
        </div>
      </div>
      {/* Desktop — page scrolls (like trade/futures) so bottom positions/orders tables are fully visible */}
      <div
        className="delta-trade doc-opts hidden md:flex md:flex-col md:w-full"
      >
        <div
          className="delta-options-header shrink-0 relative z-[200] flex items-stretch min-w-0 w-full border-b border-[color:var(--ibo-border)] bg-white"
          style={{ pointerEvents: pairOpen ? 'none' : 'auto' }}
        >
          <div className="delta-options-header__tools min-w-0 flex-1 overflow-hidden">
            <DeltaOptionsHeader
              optionsView={optionsView}
              setOptionsView={(v) => {
                if (v === 'strategy') {
                  navigate(`/options/strategy/${baseFromUsdt(underlying)}`);
                  return;
                }
                setOptionsView(v);
              }}
              underlyings={ul}
              underlying={underlying}
              onSelectUnderlying={(sym) => {
                if (sym === underlying) return;
                setPairOpen(false);
                navigate(`/options/${sym}`);
              }}
              expiries={uniqueExpiries}
              selectedExpiry={selectedExpiry || uniqueExpiries[0] || null}
              onSelectExpiry={setSelectedExpiry}
              cols={visibleChainCols}
              onChangeCols={(next) => setChainCols(resolveChainCols(next))}
              onRefresh={refresh}
              loading={loading}
              onStrategy={() => navigate(`/options/strategy/${baseFromUsdt(underlying)}`)}
            />
          </div>
          <div className="delta-right-col shrink-0 border-l border-[#e8eaed] min-h-0">
            <OptionsInstrumentBar
              selected={selected}
              underlying={underlying}
              referenceIndex={referenceIndex}
            />
          </div>
        </div>
        {error && (
          <div className="px-4 py-2 border-b border-rose-500/25 bg-rose-500/10 text-sm text-rose-200 flex items-center gap-2 shrink-0">
            <AlertCircle size={16} className="shrink-0" />
            <span className="flex-1">{error}</span>
            <button type="button" onClick={() => setError(null)} className="shrink-0 text-rose-300/60 hover:text-rose-200"><X size={14} /></button>
          </div>
        )}
        {/* Trading band: fixed viewport height so chain stays usable; page scrolls for blotter below */}
        <div className="flex min-h-[calc(100dvh-12rem)] h-[calc(100dvh-12rem)] max-h-[900px] min-w-0 overflow-hidden">
          <div
            className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden border-r border-[color:var(--ibo-border)] bg-[color:var(--ibo-bg)]"
          >
            {optionsView === 'chart' ? (
              <OptionsChartPanel
                history={indexHistory}
                referenceIndex={referenceIndex}
                selected={selected}
                underlying={underlying}
                depth={effectiveDepth}
                onBuy={(px) => {
                  if (px) setPrice(String(px));
                  setSide('buy');
                  if (selectedId) setMobilePanelTab('trade');
                }}
                onSell={(px) => {
                  if (px) setPrice(String(px));
                  setSide('sell');
                  if (selectedId) setMobilePanelTab('trade');
                }}
              />
            ) : optionsView === 'strategy' ? (
              <OptionsStrategyBuilder
                selected={selected}
                underlying={underlying}
                referenceIndex={referenceIndex}
                onPickLeg={(id) => selectContractFromChain(id, 'buy')}
              />
            ) : (
              binanceChainTable
            )}
          </div>
          <div className="delta-right-col delta-right-stack flex min-h-0 shrink-0 flex-col overflow-hidden bg-white border-l border-[#e8eaed]">
            <div className="flex min-h-0 flex-1 overflow-hidden">
              {desktopBookColumn}
              <div className="delta-trade-col delta-trade-ticket flex basis-[46%] grow-0 shrink-0 min-w-[250px] max-w-[320px] w-[280px] flex-col overflow-hidden bg-white border-l border-[#e8eaed]">
                <div className="min-h-0 flex-1 overflow-hidden flex flex-col">
                  {orderForm}
                </div>
              </div>
            </div>
          </div>
        </div>
        {/* Bottom blotter — full tables; page scroll reaches this band */}
        <div className="shrink-0 min-h-[320px] h-[min(420px,48dvh)] border-t border-[color:var(--ibo-border)] flex flex-col overflow-hidden bg-[color:var(--ibo-surface)]">
          <div className="flex flex-col h-full min-h-0">
            <div className="flex items-center shrink-0 overflow-x-auto border-b border-white/[0.06] scrollbar-hide h-[40px] px-1">
              {[
                  { id: 'positions', label: 'Positions', n: positions.length },
                  { id: 'open', label: 'Open Orders', n: openOrders.length },
                  { id: 'stop', label: 'Stop Orders', n: 0 },
                  { id: 'fills', label: 'Fills', n: myTrades.length },
                  { id: 'hist', label: 'Order History', n: orderHist.length },
                  { id: 'risk', label: 'Risk & Margin', n: 0 },
                  { id: 'bills', label: 'Bills', n: 0 },
                ].map((t) => {
                const on = bottomTab === t.id;
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setBottomTab(t.id)}
                    className="relative h-full px-3.5 text-[12px] font-semibold whitespace-nowrap transition-colors"
                    style={{ color: on ? '#fe6c02' : 'var(--ibo-muted)' }}
                  >
                    {t.label}
                    {t.n > 0 ? (
                      <span className="ml-1.5 text-[10px] font-bold px-1.5 py-0.5 rounded bg-[rgba(254,108,2,0.15)] text-[#fe6c02]">
                        {t.n}
                      </span>
                    ) : null}
                    {on ? (
                      <span className="absolute left-2 right-2 bottom-0 h-0.5 rounded-full bg-[#fe6c02]" />
                    ) : null}
                  </button>
                );
              })}
              <div className="ml-auto pr-2 hidden sm:flex items-center gap-1.5 text-[11px] text-[color:var(--ibo-muted)]">
                <button
                  type="button"
                  title="Refresh"
                  onClick={refresh}
                  className="inline-flex items-center justify-center h-7 w-7 rounded hover:bg-[color:var(--ibo-hover)]"
                >
                  <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
                </button>
                <button
                  type="button"
                  title="Download"
                  className="inline-flex items-center justify-center h-7 w-7 rounded hover:bg-[color:var(--ibo-hover)] opacity-60"
                  disabled
                >
                  <Download size={13} />
                </button>
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 ml-1" />
                Connected
              </div>
            </div>
            <div className="flex-1 min-h-0 overflow-auto scrollbar-hide p-3 text-sm">
              {!user ? (
                <div className="flex flex-col items-center justify-center gap-2 py-10 text-center text-white/50">
                  <span className="text-[13px]">
                    <Link to="/login" className="font-bold text-[#fe6c02] hover:underline">
                      Sign in
                    </Link>{' '}
                    to view options positions, orders, and history.
                  </span>
                </div>
              ) : (
                <div className="overflow-x-auto">{bottomTables}</div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
function bottomTablesFor({
  bottomTab,
  positions,
  openOrders,
  orderHist,
  myTrades,
  busy,
  cancelOrder,
  fmtNum,
  shortContractId,
  contracts,
  wallet,
  referenceIndex,
}) {
  const byId = new Map((contracts || []).map((c) => [c.id, c]));
  const midByContract = new Map(
    (contracts || [])
      .filter((c) => c.market?.mid != null)
      .map((c) => [c.id, Number(c.market.mid)]),
  );
  const parsedFromId = (contractId) => {
    const m = String(contractId || '').match(/^optc_([A-Z0-9]+)_(\d{8})_([0-9.]+)_([CP])$/i);
    if (!m) return null;
    const [, ul, ymd, strike, cp] = m;
    const base = String(ul).replace(/USDT$/i, '');
    const y = Number(ymd.slice(0, 4));
    const mo = Number(ymd.slice(4, 6));
    const d = Number(ymd.slice(6, 8));
    const dt = new Date(Date.UTC(y, mo - 1, d));
    const expiry = Number.isFinite(dt.getTime())
      ? dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
      : ymd;
    return {
      base,
      strike: Number(strike),
      type: String(cp).toUpperCase() === 'C' ? 'Call' : 'Put',
      expiry,
    };
  };
  const contractLabel = (contractId) => {
    const c = byId.get(contractId);
    if (c) {
      const base = baseFromUsdt(c.underlying_symbol || '');
      const t = String(c.option_type || '').toUpperCase() === 'CALL' ? 'Call' : 'Put';
      const strike = fmtNum(c.strike, 0);
      return {
        main: `${base} ${t} · K ${strike}`,
        sub: `${formatExpiryDateUtc(c.expiry)} · ${formatExpiryTimeUtc(c.expiry)}`,
      };
    }
    const p = parsedFromId(contractId);
    if (p) {
      return {
        main: `${p.base} ${p.type} · K ${fmtNum(p.strike, 0)}`,
        sub: `${p.expiry} · 00:00 UTC`,
      };
    }
    return { main: shortContractId(contractId), sub: 'Contract' };
  };
  if (bottomTab === 'positions') {
    return (
      <table className="w-full text-left text-xs min-w-[860px]">
        <thead className="text-white/45 uppercase text-[10px] tracking-wider font-extrabold border-b border-white/[0.06]">
          <tr>
            <th className="py-2 pr-3">Contract</th>
            <th className="py-2 pr-3">Qty</th>
            <th className="py-2 pr-3">Avg premium</th>
            <th className="py-2 pr-3">Mark price</th>
            <th className="py-2 pr-3">Position value</th>
            <th className="py-2">Unrealized P&amp;L</th>
            <th className="py-2">P&amp;L %</th>
          </tr>
        </thead>
        <tbody>
          {positions.map((p) => {
            const mid = midByContract.get(p.contract_id);
            const qty = Number(p.qty || 0);
            const avg = Number(p.avg_premium || 0);
            const cost = avg * qty;
            const pnl =
              mid != null && p.avg_premium != null && p.qty != null
                ? (mid - Number(p.avg_premium)) * Number(p.qty)
                : null;
            const pnlPct = pnl != null && Math.abs(cost) > 1e-12 ? (pnl / cost) * 100 : null;
            const lbl = contractLabel(p.contract_id);
            return (
              <tr key={p.id} className="border-b border-white/[0.04] hover:bg-white/[0.02]">
                <td className="py-2.5 pr-3 max-w-[260px]" title={p.contract_id}>
                  <div className="text-[#FE9D55]/90 font-semibold">{lbl.main}</div>
                  <div className="text-[10px] text-white/40">{lbl.sub}</div>
                </td>
                <td className="py-2.5 pr-3 font-mono">{fmtNum(qty, 4)}</td>
                <td className="py-2.5 pr-3 font-mono">{fmtNum(avg, 6)}</td>
                <td className="py-2.5 pr-3 text-white/70 font-mono">{mid != null ? fmtNum(mid, 6) : '—'}</td>
                <td className="py-2.5 pr-3 text-white/75 font-mono">{mid != null ? `${fmtNum(mid * qty, 4)} USDT` : '—'}</td>
                <td
                  className={`py-2.5 font-extrabold ${
                    pnl == null ? 'text-white/40' : pnl >= 0 ? 'text-emerald-400' : 'text-rose-400'
                  }`}
                >
                  {pnl == null ? '—' : `${pnl >= 0 ? '+' : ''}${fmtNum(pnl, 4)} USDT`}
                </td>
                <td className={`py-2.5 font-extrabold ${pnlPct == null ? 'text-white/35' : pnlPct >= 0 ? 'text-emerald-300' : 'text-rose-300'}`}>
                  {pnlPct == null ? '—' : `${pnlPct >= 0 ? '+' : ''}${fmtNum(pnlPct, 2)}%`}
                </td>
              </tr>
            );
          })}
          {!positions.length && (
            <tr>
              <td colSpan={7} className="py-10 text-white/35 text-center">
                No open positions
              </td>
            </tr>
          )}
        </tbody>
      </table>
    );
  }
  if (bottomTab === 'open') {
    return (
      <table className="w-full text-left text-xs min-w-[920px]">
        <thead className="text-white/45 uppercase text-[10px] tracking-wider font-extrabold border-b border-white/[0.06]">
          <tr>
            <th className="py-2 pr-2">Contract</th>
            <th className="py-2 pr-2">Side</th>
            <th className="py-2 pr-2">Price</th>
            <th className="py-2 pr-2">Qty</th>
            <th className="py-2 pr-2">Filled %</th>
            <th className="py-2 pr-2">Open value</th>
            <th className="py-2 pr-2">Mark diff</th>
            <th className="py-2 pr-2">Status</th>
            <th className="py-2 text-right">Action</th>
          </tr>
        </thead>
        <tbody>
          {openOrders.map((o) => {
            const q = Number(o.quantity || 0);
            const fill = Number(o.filled || 0);
            const px = Number(o.price || 0);
            const fillPct = q > 0 ? (fill / q) * 100 : 0;
            const mid = midByContract.get(o.contract_id);
            const diff = mid != null ? (mid - px) * q : null;
            const lbl = contractLabel(o.contract_id);
            return (
            <tr key={o.id} className="border-b border-white/[0.04] hover:bg-white/[0.02]">
              <td className="py-2.5 pr-2 max-w-[250px]" title={o.contract_id}>
                <div className="text-[#FE9D55]/85 font-semibold">{lbl.main}</div>
                <div className="text-[10px] text-white/40">{lbl.sub}</div>
              </td>
              <td className={`py-2.5 pr-2 font-extrabold uppercase ${o.side === 'buy' ? 'text-emerald-400' : 'text-rose-400'}`}>
                {o.side}
              </td>
              <td className="py-2.5 pr-2 font-mono">{fmtNum(px, 4)}</td>
              <td className="py-2.5 pr-2 font-mono text-white/90">{fmtNum(q, 4)}</td>
              <td className="py-2.5 pr-2 font-mono text-white/70">{fmtNum(fillPct, 1)}%</td>
              <td className="py-2.5 pr-2 font-mono text-white/70">{fmtNum(px * Math.max(0, q - fill), 4)} USDT</td>
              <td className={`py-2.5 pr-2 font-mono ${diff == null ? 'text-white/35' : diff >= 0 ? 'text-emerald-300' : 'text-rose-300'}`}>
                {diff == null ? '—' : `${diff >= 0 ? '+' : ''}${fmtNum(diff, 4)}`}
              </td>
              <td className="py-2.5 pr-2 text-white/55">{o.status}</td>
              <td className="py-2.5 text-right">
                <button
                  type="button"
                  className="text-rose-400 font-bold text-xs hover:underline disabled:opacity-40"
                  disabled={busy}
                  onClick={() => cancelOrder(o.id)}
                >
                  Cancel
                </button>
              </td>
            </tr>
          )})}
          {!openOrders.length && (
            <tr>
              <td colSpan={9} className="py-10 text-white/35 text-center">
                No open orders
              </td>
            </tr>
          )}
        </tbody>
      </table>
    );
  }
  if (bottomTab === 'stop') {
    return (
      <div className="py-10 text-center text-white/40 text-sm">No stop orders</div>
    );
  }
  if (bottomTab === 'risk') {
    const equity = wallet?.wallet_balance != null ? Number(wallet.wallet_balance) : null;
    const avail = wallet?.available != null ? Number(wallet.available) : null;
    const locked = wallet?.locked != null ? Number(wallet.locked) : null;
    const upnl = (positions || []).reduce((s, p) => {
      const mid = Number((contracts || []).find((c) => c.id === p.contract_id)?.market?.mid);
      const qty = Number(p.qty || 0);
      const avg = Number(p.avg_premium || 0);
      if (!Number.isFinite(mid) || !Number.isFinite(qty)) return s;
      return s + (mid - avg) * qty;
    }, 0);
    return (
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 text-sm p-1">
        {[
          { label: 'Wallet balance', value: equity != null ? `${fmtNum(equity, 4)} USDT` : '—' },
          { label: 'Available margin', value: avail != null ? `${fmtNum(avail, 4)} USDT` : '—' },
          { label: 'Locked margin', value: locked != null ? `${fmtNum(locked, 4)} USDT` : '—' },
          { label: 'Unrealized P&L', value: `${upnl >= 0 ? '+' : ''}${fmtNum(upnl, 4)} USDT` },
          { label: 'Open positions', value: String((positions || []).length) },
          { label: 'Index', value: referenceIndex != null ? fmtNum(referenceIndex, 2) : '—' },
        ].map((x) => (
          <div key={x.label} className="rounded-lg border border-white/[0.08] px-3 py-3">
            <div className="text-[10px] uppercase tracking-wider font-bold text-white/45">{x.label}</div>
            <div className="mt-1 font-mono font-extrabold text-white">{x.value}</div>
          </div>
        ))}
      </div>
    );
  }
  if (bottomTab === 'bills') {
    return (
      <table className="w-full text-left text-xs min-w-[720px]">
        <thead className="text-white/45 uppercase text-[10px] tracking-wider font-extrabold border-b border-white/[0.06]">
          <tr>
            <th className="py-2 pr-2">Time</th>
            <th className="py-2 pr-2">Type</th>
            <th className="py-2 pr-2">Asset</th>
            <th className="py-2 pr-2">Amount</th>
            <th className="py-2">Balance</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td colSpan={5} className="py-10 text-white/35 text-center">No bills yet</td>
          </tr>
        </tbody>
      </table>
    );
  }

  if (bottomTab === 'hist') {
    return (
      <table className="w-full text-left text-xs min-w-[920px]">
        <thead className="text-white/45 uppercase text-[10px] tracking-wider font-extrabold border-b border-white/[0.06]">
          <tr>
            <th className="py-2 pr-2">Contract</th>
            <th className="py-2 pr-2">Side</th>
            <th className="py-2 pr-2">Price</th>
            <th className="py-2 pr-2">Qty</th>
            <th className="py-2 pr-2">Filled</th>
            <th className="py-2 pr-2">Order value</th>
            <th className="py-2 pr-2">Live mark</th>
            <th className="py-2">Status</th>
          </tr>
        </thead>
        <tbody>
          {orderHist.map((o) => {
            const lbl = contractLabel(o.contract_id);
            const q = Number(o.quantity || 0);
            const fill = Number(o.filled || 0);
            const px = Number(o.price || 0);
            const mid = midByContract.get(o.contract_id);
            return (
            <tr key={o.id} className="border-b border-white/[0.04] hover:bg-white/[0.02]">
              <td className="py-2.5 pr-2 max-w-[250px]" title={o.contract_id}>
                <div className="text-[#FE9D55]/85 font-semibold">{lbl.main}</div>
                <div className="text-[10px] text-white/40">{lbl.sub}</div>
              </td>
              <td className={`py-2.5 pr-2 font-extrabold uppercase ${o.side === 'buy' ? 'text-emerald-400/80' : 'text-rose-400/80'}`}>
                {o.side}
              </td>
              <td className="py-2.5 pr-2 font-mono">{fmtNum(px, 4)}</td>
              <td className="py-2.5 pr-2 font-mono">{fmtNum(q, 4)}</td>
              <td className="py-2.5 pr-2 font-mono text-white/70">{fmtNum(fill, 4)}</td>
              <td className="py-2.5 pr-2 font-mono text-white/70">{fmtNum(px * q, 4)} USDT</td>
              <td className="py-2.5 pr-2 font-mono text-white/70">{mid != null ? fmtNum(mid, 6) : '—'}</td>
              <td className="py-2.5 text-white/50">{o.status}</td>
            </tr>
          )})}
          {!orderHist.length && (
            <tr>
              <td colSpan={8} className="py-10 text-white/35 text-center">
                No history
              </td>
            </tr>
          )}
        </tbody>
      </table>
    );
  }
  return (
    <table className="w-full text-left text-xs min-w-[920px]">
      <thead className="text-white/45 uppercase text-[10px] tracking-wider font-extrabold border-b border-white/[0.06]">
        <tr>
          <th className="py-2 pr-2">Contract</th>
          <th className="py-2 pr-2">Side</th>
          <th className="py-2 pr-2">Premium</th>
          <th className="py-2 pr-2">Qty</th>
          <th className="py-2">Total USDT</th>
          <th className="py-2">Mark</th>
          <th className="py-2">P&amp;L impact now</th>
        </tr>
      </thead>
      <tbody>
        {myTrades.map((t) => {
          const lbl = contractLabel(t.contract_id);
          const px = Number(t.price || 0);
          const q = Number(t.qty || 0);
          const sideMul = String(t.side || '').toLowerCase() === 'buy' ? 1 : -1;
          const mid = midByContract.get(t.contract_id);
          const impact = mid != null ? (mid - px) * q * sideMul : null;
          return (
          <tr key={t.id} className="border-b border-white/[0.04] hover:bg-white/[0.02]">
            <td className="py-2.5 pr-2 max-w-[250px]" title={t.contract_id}>
              <div className="text-[#FE9D55]/85 font-semibold">{lbl.main}</div>
              <div className="text-[10px] text-white/40">{lbl.sub}</div>
            </td>
            <td className={`py-2.5 pr-2 font-extrabold uppercase ${t.side === 'buy' ? 'text-emerald-400/80' : 'text-rose-400/80'}`}>
              {t.side}
            </td>
            <td className="py-2.5 pr-2 font-mono">{fmtNum(px, 6)}</td>
            <td className="py-2.5 pr-2 font-mono">{fmtNum(q, 4)}</td>
            <td className="py-2.5 text-white/65 font-mono">{fmtNum(px * q, 4)}</td>
            <td className="py-2.5 text-white/70 font-mono">{mid != null ? fmtNum(mid, 6) : '—'}</td>
            <td className={`py-2.5 font-extrabold ${impact == null ? 'text-white/35' : impact >= 0 ? 'text-emerald-300' : 'text-rose-300'}`}>
              {impact == null ? '—' : `${impact >= 0 ? '+' : ''}${fmtNum(impact, 4)} USDT`}
            </td>
          </tr>
        )})}
        {!myTrades.length && (
          <tr>
            <td colSpan={7} className="py-10 text-white/35 text-center">
              No fills yet
            </td>
          </tr>
        )}
      </tbody>
    </table>
  );
}
