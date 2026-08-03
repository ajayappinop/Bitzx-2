/**
 * Options terminal — desktop zone-1: chain (flex-1) | responsive book column | responsive ticket column.
 * Bottom tables sit in zone-2 below the fold like TradePage/FuturesTradePage.
 * URL: /options/:underlying
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useParams, useNavigate, Link } from 'react-router-dom';
import {
  RefreshCw, Wallet, ArrowLeftRight, Layers, AlertCircle, ChevronDown, Globe, X, Shield, Clock,
} from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { optionsApi, openOptionsAccountWs, openOptionsDepthWs, openOptionsChainWs } from '@/services/optionsApi';
import { COIN_ICONS } from '@/services/marketApi';
import { useToast, friendlyError } from '@/context/ToastContext';
import { estimateIboFee, formatIboFee } from '@/lib/iboFee';

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
  const d = Math.ceil((t - Date.now()) / 86400000);
  if (d < 0) return 'Past expiry';
  if (d === 0) return 'Today';
  if (d === 1) return '1 day';
  return `${d} days`;
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
    return { label: 'Paused', className: 'bg-[rgba(91,184,255,0.15)] text-[#5BB8FF]/90 border border-[rgba(91,184,255,0.25)]' };
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
  return new Date(t).toISOString().slice(0, 10);
}

/**
 * Binance-style chain arm — mirrored columns (reference layout).
 * Calls outer→strike: Ask sz · Bid sz · Open (USDT) · Delta · Ask/IV · Mark/IV · Bid/IV · Pos
 * Puts strike→outer: Pos · Bid/IV · Mark/IV · Ask/IV · Delta · Open · Bid sz · Ask sz
 */
function ChainArm({
  contract,
  side,
  selectedId,
  referencePrice,
  positions,
  onPick,
}) {
  const empty = (
    <td colSpan={8} className="border-b border-white/[0.06] bg-[color:var(--ibo-bg)] text-center text-[11px] text-[color:var(--ibo-muted)] py-3 align-middle font-mono tracking-wider">
      — — — — — — — —
    </td>
  );
  if (!contract) return empty;

  const isSel = selectedId === contract.id;
  const strike = Number(contract.strike);
  const refOk = referencePrice != null && Number.isFinite(referencePrice) && Number.isFinite(strike);
  const itm = refOk && (side === 'call' ? referencePrice > strike : referencePrice < strike);

  // Richer ITM shading so in-the-money rows are obviously distinct
  const rowBg = isSel
    ? side === 'call' ? 'bg-emerald-900/25' : 'bg-rose-900/25'
    : itm
      ? side === 'call' ? 'bg-emerald-950/55' : 'bg-rose-950/55'
      : 'bg-[color:var(--ibo-bg)]';

  const m = contract.market || {};
  const pickBuy = (e) => { e.stopPropagation(); onPick(contract.id, 'buy'); };
  const pickSell = (e) => { e.stopPropagation(); onPick(contract.id, 'sell'); };

  const ivStr = m.iv != null && Number.isFinite(Number(m.iv))
    ? `${(Number(m.iv) * 100).toFixed(1)}%`
    : '—';
  const deltaVal = m.delta != null && Number.isFinite(Number(m.delta))
    ? fmtNum(Number(m.delta), 3)
    : '—';
  const hasDelta = m.delta != null && Number.isFinite(Number(m.delta));
  const posLabel = positionQtyLabel(contract.id, positions);
  const hasPos = posLabel !== '—';

  // Shared cell wrapper: compact, no duplicate sub-labels (header row already labels columns).
  const Cell = ({ children, accent = false, className = '', onClick, clickable = false }) => (
    <div
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      onClick={onClick}
      onKeyDown={clickable && onClick ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(e); } } : undefined}
      className={`flex flex-col items-center justify-center px-1 py-1.5 min-h-[40px] sm:min-h-[44px] min-w-0 max-w-full overflow-hidden font-mono text-center ${
        accent ? 'bg-white/[0.015]' : ''
      } ${clickable ? 'cursor-pointer hover:bg-white/[0.05] active:bg-white/[0.08]' : ''} ${className}`}
    >
      {children}
    </div>
  );

  const Num = ({ v, cls = 'text-zinc-200', title }) => (
    <span
      title={title ?? (v !== '—' ? String(v) : undefined)}
      className={`block w-full max-w-full text-[10px] sm:text-[11px] font-bold tabular-nums leading-tight truncate ${cls}`}
    >
      {v}
    </span>
  );
  const IvSub = () => (
    <span className={`block w-full truncate text-[8px] sm:text-[9px] leading-none mt-px font-mono ${ivStr === '—' ? 'text-[color:var(--ibo-muted)]' : 'text-sky-400/70'}`}>
      {ivStr === '—' ? '—' : `IV ${ivStr}`}
    </span>
  );

  const askSzCell = (
    <Cell>
      <Num v={m.ask_qty != null ? fmtNum(m.ask_qty, 2) : '—'} cls="text-rose-400/90" />
    </Cell>
  );
  const bidSzCell = (
    <Cell>
      <Num v={m.bid_qty != null ? fmtNum(m.bid_qty, 2) : '—'} cls="text-emerald-400/90" />
    </Cell>
  );
  const openCell = (
    <Cell>
      <Num v={fmtOpenUsdtNotional(m.open_interest, m.mid)} cls="text-[#5BB8FF]/85" />
    </Cell>
  );
  const deltaCell = (
    <Cell accent>
      <Num v={deltaVal} cls={hasDelta ? 'text-sky-300/90' : 'text-zinc-600'} />
    </Cell>
  );
  const askCell = (
    <Cell accent clickable onClick={pickBuy} title="Buy (lift ask)">
      <Num v={fmtMarketPx(m.best_ask)} cls={m.best_ask != null ? 'text-rose-300 font-extrabold' : 'text-zinc-600'} />
      <IvSub />
    </Cell>
  );
  const markCell = (
    <Cell accent clickable onClick={pickBuy} title="Buy at mark">
      <Num v={fmtMarketPx(m.mid ?? m.mark_price)} cls={(m.mid ?? m.mark_price) != null ? 'text-white font-extrabold' : 'text-zinc-600'} />
      <IvSub />
    </Cell>
  );
  const bidCell = (
    <Cell accent clickable onClick={pickSell} title="Sell to close (hit bid)">
      <Num v={fmtMarketPx(m.best_bid)} cls={m.best_bid != null ? 'text-emerald-300 font-extrabold' : 'text-zinc-600'} />
      <IvSub />
    </Cell>
  );
  const posCell = (
    <Cell>
      <Num v={posLabel} cls={hasPos ? 'text-[#5BB8FF] font-extrabold' : 'text-[color:var(--ibo-muted)]'} />
    </Cell>
  );

  const armGrid = 'grid h-full min-w-0 divide-x divide-white/[0.06] [grid-template-columns:repeat(8,minmax(4.5rem,1fr))] sm:[grid-template-columns:repeat(8,minmax(5rem,1fr))]';

  const inner = side === 'call' ? (
    <div className={armGrid}>
      {askSzCell}{bidSzCell}{openCell}{deltaCell}{askCell}{markCell}{bidCell}{posCell}
    </div>
  ) : (
    <div className={armGrid}>
      {posCell}{bidCell}{markCell}{askCell}{deltaCell}{openCell}{bidSzCell}{askSzCell}
    </div>
  );

  return (
    <td
      colSpan={8}
      title={`${contractStateTitle(contract)}\nTap Ask/Mark to buy · Bid to sell`}
      className={`border-b border-white/[0.06] p-0 align-stretch transition-colors ${rowBg} ${
        isSel
          ? 'ring-2 ring-inset ring-[#5BB8FF]/80 z-[1] relative shadow-[inset_0_0_0_1px_rgba(91,184,255,0.2)]'
          : ''
      }`}
    >
      {inner}
    </td>
  );
}

function PanelHeader({ title, right }) {
  return (
    <div className="flex items-center justify-between gap-2 border-b border-[color:var(--ibo-border-solid)] bg-[color:var(--ibo-elevated)] px-2.5 py-1.5 shrink-0">
      <span className="text-[10px] font-extrabold uppercase tracking-[0.12em] text-[#5BB8FF]">{title}</span>
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

  const availIbo = Number(balance?.IBO ?? 0);
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
        limit: 500,
      });
      if (Array.isArray(fast?.contracts) && fast.contracts.length) {
        list = fast.contracts;
        setContracts(list);
        setLoading(false);
      }
    } catch {
      /* continue to full chain */
    }
    try {
      const cRes = await optionsApi.getChain(underlying, true);
      list = cRes.contracts || list;
    } catch (e) {
      chainErr = e.message || 'Could not load chain from API';
    }

    let demo = false;
    let idx = null;
    if (!list.length) {
      try {
        const d = await optionsApi.demoChain(underlying);
        if (d?.demo && Array.isArray(d.contracts) && d.contracts.length) {
          list = d.contracts;
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
    setContracts(list);
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
      setPositions(p.positions || []);
      setOpenOrders(o.orders || []);
      setOrderHist(h.orders || []);
      setMyTrades(t.trades || []);
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
      if (Array.isArray(msg.positions)) setPositions(msg.positions);
      if (Array.isArray(msg.open_orders)) setOpenOrders(msg.open_orders);
      if (Array.isArray(msg.order_history)) setOrderHist(msg.order_history);
      if (Array.isArray(msg.user_trades)) setMyTrades(msg.user_trades);
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
    if (!selected && (mobilePanelTab === 'trade' || mobilePanelTab === 'book')) {
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

  const submitOrder = async () => {
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
    const p = parseFloat(price);
    const q = parseFloat(qty);
    if (!Number.isFinite(p) || p <= 0) {
      toast.error('Invalid price', 'Enter the limit premium — the price per contract in USDT.');
      return;
    }
    if (!Number.isFinite(q) || q <= 0) {
      toast.error('Invalid quantity', 'Enter how many contracts you want to trade (must be greater than 0).');
      return;
    }
    if (insufficientIboFee) {
      toast.error(
        'Insufficient IBO',
        `Need ~${formatIboFee(estFeeIbo)} for trading fees (available ${availIbo.toFixed(8)} IBO).`,
      );
      return;
    }
    setBusy(true);
    try {
      await optionsApi.placeOrder({
        contract_id: selected.id,
        side,
        type: 'limit',
        quantity: q,
        price: p,
        reduce_only: side === 'sell',
      });
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
          : `${fmtNum(a, 2)} USDT returned to your Spot wallet.`,
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
            border: `1px solid ${pairOpen ? 'rgba(91,184,255,0.5)' : 'var(--ibo-border-solid)'}`,
            cursor: 'pointer',
            transition: 'border-color 0.2s',
            flexShrink: 0,
            color: 'var(--ibo-ink)',
          }}
        >
          {icon && <img src={icon} alt={base} style={{ width: 24, height: 24, borderRadius: '50%' }} />}
          <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--ibo-ink)' }}>{base}</span>
          <span style={{ fontSize: 13, color: 'var(--ibo-muted)' }}>/USDT</span>
          <span className="rounded bg-[rgba(91,184,255,0.15)] px-1.5 py-0.5 text-[9px] font-extrabold uppercase tracking-wider text-[#5BB8FF]">
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
                    background: active ? 'rgba(91,184,255,0.1)' : 'transparent',
                    border: 'none',
                    color: active ? '#5BB8FF' : 'var(--ibo-ink)',
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
                        background: 'rgba(91,184,255,0.15)',
                        color: '#5BB8FF',
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

  /** Top chain chrome: single title row (no duplicate PanelHeader), ref · expiry · TTM, expiry pills. */
  const chainToolbar =
    !loading && contracts.length > 0 && uniqueExpiries.length > 0 ? (
      <div
        className="shrink-0 border-b border-white/[0.08] bg-[color:var(--ibo-surface)]"
        title="Calls (left), Puts (right). Tap a cell to trade. Green/red tint = ITM."
      >
        <div className="options-chain-toolbar px-2 sm:px-3 py-2 sm:py-2 flex flex-nowrap items-center gap-x-2 sm:gap-x-2.5 min-h-[2.5rem] min-w-0 touch-pan-x">
          <span className="text-[10px] font-extrabold uppercase tracking-[0.12em] text-[#5BB8FF] shrink-0 leading-normal">
            Option chain
          </span>
          <span className="text-[color:var(--ibo-muted)] shrink-0 hidden sm:inline" aria-hidden>
            ·
          </span>
          <div className="flex flex-nowrap items-baseline gap-x-1.5 sm:gap-x-2 shrink-0 text-[11px] sm:text-xs leading-normal text-[color:var(--ibo-muted)] whitespace-nowrap">
            <span className="text-[color:var(--ibo-muted)] shrink-0">Index ref.</span>
            <span className="font-mono font-bold text-[#5BB8FF] tabular-nums shrink-0">
              {referenceIndex != null ? fmtNum(referenceIndex, 2) : '—'}
            </span>
            {selectedExpiry ? (
              <>
                <span className="text-zinc-600 shrink-0">·</span>
                <span className="shrink-0">Expiry</span>
                <span className="font-mono text-[color:var(--ibo-ink)] shrink-0">{formatExpiryDateUtc(selectedExpiry)}</span>
                <span className="text-zinc-600 shrink-0">·</span>
                <span className="shrink-0">TTM</span>
                <span className="font-mono text-zinc-200 shrink-0">{daysToExpiryLabel(selectedExpiry)}</span>
              </>
            ) : null}
          </div>
          <span className="text-zinc-600 shrink-0 select-none hidden sm:inline" aria-hidden>
            |
          </span>
          <div className="flex flex-nowrap items-center gap-1 sm:gap-1.5 shrink-0">
            {uniqueExpiries.map((ex) => (
              <button
                key={ex}
                type="button"
                onClick={() => {
                  setSelectedExpiry(ex);
                  window.requestAnimationFrame(() => {
                    document.getElementById(expirySectionDomId(ex))?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                  });
                }}
                className={`shrink-0 rounded-md px-2 py-1 sm:px-2.5 sm:py-1.5 text-[11px] sm:text-xs font-extrabold transition-colors border leading-normal ${
                  selectedExpiry === ex
                    ? 'border-[rgba(91,184,255,0.5)] bg-[rgba(91,184,255,0.18)] text-[#5BB8FF] shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]'
                    : 'border-[color:var(--ibo-border-solid)] bg-[color:var(--ibo-elevated)]/35 text-zinc-200 hover:border-white/20 hover:bg-white/[0.06] hover:text-white'
                }`}
              >
                {formatExpiryTabLabel(ex)}
              </button>
            ))}
          </div>
          <span className="ml-auto font-mono text-[11px] sm:text-xs font-bold text-white shrink-0 px-2 py-1 rounded-md border border-white/[0.12] bg-white/[0.06] leading-normal tabular-nums">
            {underlying}
          </span>
        </div>
      </div>
    ) : null;

  const chainTableShell = (expiryKey, rows) => {
    const atm = computeAtmStrike(rows, referenceIndex);

    // Shared header cell style for sub-column labels
    const Th = ({ children, cls = '', title: tip = '' }) => (
      <th title={tip} className={`px-1 py-2 text-center text-[9px] sm:text-[10px] font-bold uppercase tracking-[0.07em] border-r border-white/[0.05] last:border-r-0 ${cls}`}>
        {children}
      </th>
    );

    return (
      <table className="w-full min-w-[1040px] sm:min-w-[1120px] md:min-w-[1200px] lg:min-w-[1280px] border-collapse table-fixed">
        <thead className="sticky top-0 z-20">
          {/* Zone row: Calls | Strike | Puts */}
          <tr>
            <th colSpan={8} className="py-2 px-3 text-center text-[11px] font-extrabold uppercase tracking-widest text-emerald-400 bg-emerald-950/60 border-b border-r border-emerald-500/30">
              ▲ Calls
            </th>
            <th className="py-2 px-2 text-center text-[11px] font-extrabold uppercase tracking-widest text-[#5BB8FF] bg-[color:var(--ibo-card)] border-b border-x border-[rgba(91,184,255,0.35)] min-w-[5.5rem] sm:min-w-[6.25rem]">
              Strike
            </th>
            <th colSpan={8} className="py-2 px-3 text-center text-[11px] font-extrabold uppercase tracking-widest text-rose-400 bg-rose-950/60 border-b border-l border-rose-500/30">
              ▼ Puts
            </th>
          </tr>
          {/* Column-label row */}
          <tr className="bg-[color:var(--ibo-surface)] border-b-2 border-white/[0.10] text-[color:var(--ibo-muted)]">
            <Th cls="text-rose-400/80"  title="Ask size (contracts available to sell)">Ask sz</Th>
            <Th cls="text-emerald-400/80" title="Bid size (contracts available to buy)">Bid sz</Th>
            <Th title="Open interest (OI × mark, USDT)">OI</Th>
            <Th cls="text-sky-400/80"  title="Delta: sensitivity to spot price change">Δ Delta</Th>
            <Th cls="text-rose-300/90" title="Best ask price + implied volatility">Ask · IV</Th>
            <Th cls="text-white/80"    title="Mid (mark) price + implied volatility">Mark · IV</Th>
            <Th cls="text-emerald-300/90" title="Best bid price + implied volatility">Bid · IV</Th>
            <Th cls="text-[#5BB8FF]/80 border-r-emerald-500/20" title="Your open position in this contract">Pos</Th>
            {/* Strike column sub-header */}
            <th className="bg-[color:var(--ibo-card)] border-x border-[rgba(91,184,255,0.3)] p-0 min-w-[5.5rem] sm:min-w-[6.25rem]" />
            {/* Puts columns (mirrored) */}
            <Th cls="text-[#5BB8FF]/80 border-l-rose-500/20" title="Your open position in this contract">Pos</Th>
            <Th cls="text-emerald-300/90" title="Best bid price + implied volatility">Bid · IV</Th>
            <Th cls="text-white/80"    title="Mid (mark) price + implied volatility">Mark · IV</Th>
            <Th cls="text-rose-300/90" title="Best ask price + implied volatility">Ask · IV</Th>
            <Th cls="text-sky-400/80"  title="Delta">Δ Delta</Th>
            <Th title="Open interest">OI</Th>
            <Th cls="text-emerald-400/80" title="Bid size">Bid sz</Th>
            <Th cls="text-rose-400/80"  title="Ask size">Ask sz</Th>
          </tr>
        </thead>
        <tbody className="[&_td]:align-middle font-mono">
          {rows.map((row) => {
            const isAtm = atm != null && row.strike === atm;
            const strikeNum = Number(row.strike);
            const strikeIsItm = referenceIndex != null && Number.isFinite(referenceIndex);
            const callItm = strikeIsItm && referenceIndex > strikeNum;
            const putItm  = strikeIsItm && referenceIndex < strikeNum;
            return (
              <tr key={`${expiryKey}-${row.strike}`} className="group transition-colors hover:bg-white/[0.03]">
                <ChainArm
                  contract={row.call}
                  side="call"
                  selectedId={selectedId}
                  referencePrice={referenceIndex}
                  positions={positions}
                  onPick={selectContractFromChain}
                />

                {/* ── Strike cell ─────────────────────────────────────── */}
                <td className={`border-x border-[rgba(91,184,255,0.3)] border-b border-white/[0.06] min-w-[5.5rem] sm:min-w-[6.25rem] px-1 py-0 text-center align-middle bg-[color:var(--ibo-surface)] ${
                  isAtm ? 'ring-2 ring-inset ring-[#5BB8FF]/60 bg-[rgba(91,184,255,0.08)]' : ''
                }`}>
                  <div className="flex flex-col items-center justify-center gap-1 py-2 min-h-[44px] sm:min-h-[48px]">
                    {/* ATM badge — live index price */}
                    {isAtm && referenceIndex != null && (
                      <span className="flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-extrabold bg-[rgba(91,184,255,0.2)] text-[#5BB8FF] border border-[rgba(91,184,255,0.4)] tabular-nums whitespace-nowrap shadow-sm">
                        <span className="w-1.5 h-1.5 rounded-full bg-[#5BB8FF] animate-pulse shrink-0" />
                        {fmtNum(referenceIndex, 2)}
                      </span>
                    )}
                    {/* Strike value */}
                    <span className={`font-extrabold tabular-nums tracking-tight whitespace-nowrap leading-none ${
                      isAtm
                        ? 'text-[15px] sm:text-[16px] text-[#5BB8FF]'
                        : 'text-[13px] sm:text-[14px] text-zinc-200'
                    }`}>
                      {fmtNum(strikeNum, 0)}
                    </span>
                    {/* ITM label */}
                    {!isAtm && (callItm || putItm) && (
                      <span className={`text-[8px] sm:text-[9px] font-bold uppercase tracking-wider ${
                        callItm ? 'text-emerald-500/70' : 'text-rose-500/70'
                      }`}>ITM</span>
                    )}
                    {!isAtm && !callItm && !putItm && referenceIndex != null && (
                      <span className="text-[8px] sm:text-[9px] font-bold uppercase tracking-wider text-[color:var(--ibo-muted)]">OTM</span>
                    )}
                  </div>
                </td>

                <ChainArm
                  contract={row.put}
                  side="put"
                  selectedId={selectedId}
                  referencePrice={referenceIndex}
                  positions={positions}
                  onPick={selectContractFromChain}
                />
              </tr>
            );
          })}
        </tbody>
      </table>
    );
  };

  const binanceChainTable = (
    <div className="flex min-h-0 min-w-0 w-full max-w-full flex-1 flex-col bg-[color:var(--ibo-bg)] antialiased border border-white/[0.06] rounded-lg overflow-hidden">
      {chainToolbar}
      {contracts.length > 0 && !loading && chainSections.some((s) => s.rows.length > 0) && (
        <p className="sm:hidden shrink-0 px-2 py-1.5 text-[10px] leading-snug text-[color:var(--ibo-muted)] bg-[color:var(--ibo-elevated)] border-b border-white/[0.05]">
          Scroll sideways · tap a cell to select
        </p>
      )}
      <div className="options-chain-scroll-v flex-1 min-h-0 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
        {loading && !contracts.length ? (
          <div className="flex flex-col items-center justify-center gap-2 py-10 text-sm text-[color:var(--ibo-muted)]">
            <RefreshCw size={18} className="animate-spin text-[#5BB8FF]/80" /> Loading option chain…
          </div>
        ) : !contracts.length ? (
          <div className="mx-auto max-w-md p-6 sm:p-8 text-center text-sm leading-relaxed text-[color:var(--ibo-muted)]">
            No listed contracts for <span className="font-mono font-semibold text-[#5BB8FF]">{underlying}</span>. Ask an admin to list strikes, or try
            another underlying.
          </div>
        ) : !uniqueExpiries.length ? (
          <div className="p-6 sm:p-8 text-center text-sm text-[color:var(--ibo-muted)]">No expiries listed.</div>
        ) : (
          <div className="flex flex-col min-w-0">
            {chainSections.map(({ expiry, rows }) => (
              <section
                key={expiry}
                id={expirySectionDomId(expiry)}
                className="scroll-mt-[72px] border-b border-white/[0.07] last:border-b-0"
              >
                <ExpirySectionHeader underlying={underlying} referenceIndex={referenceIndex} expiry={expiry} />
                <div className="w-full max-w-full options-chain-scroll bg-[color:var(--ibo-bg)]">
                  {rows.length ? (
                    chainTableShell(expiry, rows)
                  ) : (
                    <div className="py-8 px-4 text-center text-sm text-[color:var(--ibo-muted)]">No strikes for {formatExpiryTabLabel(expiry)}.</div>
                  )}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>
    </div>
  );

  const showDepthLoading = Boolean(selectedId) && !usingDemoChain && depth === undefined;

  const effectiveDepth = useMemo(() => {
    if (!selectedId) return undefined;
    if (usingDemoChain) {
      return { contract_id: selectedId, bids: [], asks: [] };
    }
    if (depth === undefined) return undefined;
    return depth;
  }, [selectedId, usingDemoChain, depth]);

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
      {recentTape.slice(0, 16).map((tr) => (
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
      {!recentTape.length && (
        <div className="text-white/35 py-3 text-center text-[11px]">No fills yet</div>
      )}
    </>
  );

  /** Futures-style middle column — only mounted once a contract is selected (desktop). */
  const desktopBookColumn = (
    <div className="flex min-h-0 w-[252px] md:w-[280px] lg:w-[300px] xl:w-[340px] shrink-0 flex-col overflow-hidden border-r border-white/[0.06] bg-[color:var(--ibo-bg)] min-w-0">
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <PanelHeader title="Order book" right="Premium × Qty" />
        <div className="min-h-0 flex-1 overflow-hidden">{orderBookLadder}</div>
      </div>
      <div className="flex h-[220px] md:h-[260px] min-h-0 shrink-0 flex-col overflow-hidden border-t border-white/[0.06]">
        <PanelHeader title="Recent trades" />
        <div className="min-h-0 flex-1 overflow-y-auto order-book-scroll bg-[color:var(--ibo-elevated)] px-2 py-1 font-mono text-[11px]">
          {recentTradesTape}
        </div>
      </div>
    </div>
  );

  const orderForm = (
    <div className="flex min-w-0 flex-col gap-3 p-3 sm:p-4 border-t md:border-t-0 border-white/[0.06] md:pb-5">
      {selected ? (
        <>
          <div className="rounded-xl border border-white/[0.08] bg-gradient-to-br from-[color:var(--ibo-card)] to-[color:var(--ibo-elevated)] p-3">
            <div className="flex items-start justify-between gap-2">
              <div className="text-[10px] font-extrabold uppercase tracking-widest text-[#5BB8FF]/80">Active contract</div>
              {(() => {
                const pill = contractStatePill(selected);
                return (
                  <span
                    className={`shrink-0 rounded-md px-1.5 py-0.5 text-[9px] font-extrabold uppercase tracking-wide ${pill.className}`}
                  >
                    {pill.label}
                  </span>
                );
              })()}
            </div>
            <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-white/65">
              <span className="rounded-md bg-white/5 px-2 py-0.5 font-bold text-white">{String(selected.option_type || '').toUpperCase()}</span>
              <span>K {fmtNum(selected.strike, 2)}</span>
              <span className="text-white/40">·</span>
              <span>Tick {selected.tick_size}</span>
              <span className="text-white/40">·</span>
              <span>Lot {selected.lot_size}</span>
            </div>
          </div>

          <div className="rounded-xl border border-[rgba(91,184,255,0.25)] bg-[rgba(91,184,255,0.04)] px-3 py-2.5 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-white/70">
              <Wallet size={16} className="text-[#5BB8FF] shrink-0" />
              <span className="text-[11px] font-extrabold uppercase tracking-wide">Options USDT</span>
            </div>
            {user ? (
              <div className="text-right">
                <div className="text-lg font-mono font-extrabold text-white leading-none">{wallet ? fmtNum(wallet.wallet_balance, 4) : '—'}</div>
                <div className="text-[10px] text-white/45 mt-0.5">
                  Avail {wallet ? fmtNum(wallet.available, 4) : '—'} · Lck {wallet ? fmtNum(wallet.locked, 4) : '—'}
                </div>
              </div>
            ) : (
              <Link to="/login" className="text-xs font-bold text-[#5BB8FF] hover:underline">
                Sign in
              </Link>
            )}
          </div>

          {user && (
            <button
              type="button"
              onClick={() => setXferOpen((v) => !v)}
              className="inline-flex items-center justify-center gap-2 rounded-lg border border-[color:var(--ibo-border-solid)] py-2.5 text-xs font-bold text-white/85 hover:bg-white/[0.05] transition-colors"
            >
              <ArrowLeftRight size={14} /> Spot ↔ Options
            </button>
          )}

          {xferOpen && user && (
            <div className="rounded-xl border border-[rgba(91,184,255,0.3)] bg-[color:var(--ibo-elevated)] p-3 space-y-2 text-sm">
              <select
                value={xferDir}
                onChange={(e) => setXferDir(e.target.value)}
                className="w-full rounded-lg bg-[color:var(--ibo-card)] border border-[color:var(--ibo-border-solid)] px-2 py-2 text-xs text-white"
              >
                <option value="spot_to_options">Spot → Options</option>
                <option value="options_to_spot">Options → Spot</option>
              </select>
              <input
                type="text"
                inputMode="decimal"
                placeholder="Amount USDT"
                value={xferAmt}
                onChange={(e) => setXferAmt(e.target.value)}
                className="w-full rounded-lg bg-[color:var(--ibo-card)] border border-[color:var(--ibo-border-solid)] px-2 py-2 text-xs font-mono text-white placeholder:text-white/30"
              />
              <button
                type="button"
                disabled={busy}
                onClick={submitTransfer}
                className="w-full rounded-lg bg-[#5BB8FF] py-2.5 text-xs font-extrabold text-[#050a1a] hover:bg-[#7ec8ff] transition-colors disabled:opacity-40"
              >
                Transfer
              </button>
            </div>
          )}

          <div className="flex w-full min-w-0 rounded-xl border border-white/[0.08] overflow-hidden p-0.5 bg-[color:var(--ibo-elevated)] gap-0.5">
            <button
              type="button"
              onClick={() => setSide('buy')}
              className={`flex-1 min-w-0 py-2.5 text-sm font-extrabold rounded-lg transition-colors ${
                side === 'buy' ? 'bg-emerald-600 text-white shadow-inner' : 'text-white/45 hover:text-white/70'
              }`}
            >
              Buy
            </button>
            <button
              type="button"
              onClick={() => setSide('sell')}
              className={`flex-1 min-w-0 py-2.5 text-sm font-extrabold rounded-lg transition-colors ${
                side === 'sell' ? 'bg-rose-600 text-white shadow-inner' : 'text-white/45 hover:text-white/70'
              }`}
            >
              Sell
            </button>
          </div>
          <p className="text-[10px] text-white/45 -mt-1 leading-relaxed">
            v1 long-only — sells are reduce-only (close long). Max sell:{' '}
            <span className="font-mono text-[#5BB8FF]/90">{fmtNum(myPosOnContract?.qty ?? 0, 4)}</span> contracts.
          </p>

          <div className="space-y-1.5">
            <label className="text-[10px] font-extrabold uppercase tracking-wider text-white/45">Limit price (USDT / contract)</label>
            <input
              type="text"
              inputMode="decimal"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              className="w-full rounded-lg bg-[color:var(--ibo-card)] border border-[color:var(--ibo-border-solid)] px-3 py-2.5 font-mono text-sm text-white placeholder:text-white/25 focus:border-[rgba(91,184,255,0.4)] focus:outline-none focus:ring-1 focus:ring-[rgba(91,184,255,0.3)]"
              placeholder="0.00"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-[10px] font-extrabold uppercase tracking-wider text-white/45">Quantity (contracts)</label>
            <input
              type="text"
              inputMode="decimal"
              value={qty}
              onChange={(e) => setQty(e.target.value)}
              className="w-full rounded-lg bg-[color:var(--ibo-card)] border border-[color:var(--ibo-border-solid)] px-3 py-2.5 font-mono text-sm text-white placeholder:text-white/25 focus:border-[rgba(91,184,255,0.4)] focus:outline-none focus:ring-1 focus:ring-[rgba(91,184,255,0.3)]"
              placeholder="0"
            />
          </div>

          {premiumNotional > 0 && feeRates && (
            <div className="rounded-lg border border-white/[0.08] bg-[color:var(--ibo-elevated)] px-3 py-2 text-[11px]">
              <div className="flex justify-between gap-2">
                <span className="text-white/50">Est. fee (premium × rate)</span>
                <span className={`font-mono font-bold ${insufficientIboFee ? 'text-rose-300' : 'text-[#5BB8FF]/90'}`}>
                  {formatIboFee(estFeeIbo)}
                </span>
              </div>
              {insufficientIboFee && (
                <p className="text-rose-300/90 mt-1 leading-relaxed">
                  Spot IBO balance {availIbo.toFixed(8)} — fees are charged only in IBO.
                </p>
              )}
            </div>
          )}

          {user && kyc?.status !== 'approved' && (
            <div className={`rounded-xl p-4 border ${
              kyc?.status === 'pending'
                ? 'bg-[rgba(91,184,255,0.1)] border-[rgba(91,184,255,0.3)]'
                : 'bg-red-500/8 border-red-500/25'
            }`}>
              <p className={`font-extrabold flex items-center gap-2 mb-2 text-sm ${
                kyc?.status === 'pending' ? 'text-[#5BB8FF]' : 'text-red-300'}`}>
                {kyc?.status === 'pending'
                  ? <><Clock size={14} /> KYC Under Review</>
                  : <><Shield size={14} /> KYC Verification Required</>}
              </p>
              <p className="text-white text-xs mb-3 leading-relaxed">
                {kyc?.status === 'pending'
                  ? 'Your documents are being reviewed. Trading will be enabled once approved.'
                  : kyc?.status === 'rejected'
                  ? 'Your KYC was rejected. Please resubmit with valid documents.'
                  : 'Complete identity verification to start trading on IBO Exchange.'}
              </p>
              <Link to="/kyc"
                className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-bold ${
                  kyc?.status === 'pending'
                    ? 'bg-[rgba(91,184,255,0.2)] text-[#5BB8FF] hover:bg-[rgba(91,184,255,0.3)]'
                    : 'bg-[rgba(91,184,255,0.2)] text-[#5BB8FF] hover:bg-[rgba(91,184,255,0.3)]'
                } transition-colors`}>
                <Shield size={13} />
                {kyc?.status === 'pending' ? 'Check Status' : kyc?.status === 'rejected' ? 'Resubmit KYC' : 'Verify Now →'}
              </Link>
            </div>
          )}

          <button
            type="button"
            disabled={busy || !user || usingDemoChain || kyc?.status !== 'approved'}
            onClick={submitOrder}
            className={`w-full rounded-xl py-3.5 text-sm font-extrabold tracking-wide shadow-lg transition-opacity disabled:opacity-40 ${
              side === 'buy'
                ? 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-emerald-900/20'
                : 'bg-rose-600 hover:bg-rose-500 text-white shadow-rose-900/20'
            }`}
          >
            {usingDemoChain
              ? 'Submit unavailable'
              : !user
                ? 'Sign in to trade'
                : kyc?.status !== 'approved'
                  ? 'KYC required to trade'
                : side === 'buy'
                  ? 'Buy / Long'
                  : 'Sell / Close'}
          </button>
        </>
      ) : (
        <p className="text-sm text-white/45 text-center py-8 px-3">
          Select a <span className="text-emerald-300/90">Call</span> or <span className="text-rose-300/90">Put</span> on the chain to open the order book and
          order ticket.
        </p>
      )}
    </div>
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
          label="Fees (IBO)"
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
  });

  return (
    <div className="bg-[color:var(--ibo-bg)] text-[color:var(--ibo-ink)] max-w-[100vw] overflow-x-hidden font-ui">
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
            { id: 'book', label: 'Book', needsContract: true },
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
                    ? 'border-[#5BB8FF] text-[#5BB8FF] bg-[rgba(91,184,255,0.06)]'
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
          {mobilePanelTab === 'book' && selected && (
            <div className="grid min-h-[320px] h-[min(520px,65dvh)] grid-rows-2 gap-2 bg-[color:var(--ibo-bg)] p-2 flex-1 min-h-0">
              <div className="flex min-h-0 flex-col overflow-hidden border border-white/[0.06] bg-[color:var(--ibo-bg)]">
                <PanelHeader title="Order book" right="Premium × Qty" />
                <div className="min-h-0 flex-1 overflow-hidden">{orderBookLadder}</div>
              </div>
              <div className="flex min-h-0 flex-col overflow-hidden border border-white/[0.06] bg-[color:var(--ibo-bg)]">
                <PanelHeader title="Recent trades" />
                <div className="min-h-0 flex-1 overflow-y-auto order-book-scroll px-2 py-1 font-mono text-[11px] bg-[color:var(--ibo-elevated)]">
                  {recentTradesTape}
                </div>
              </div>
            </div>
          )}
          {mobilePanelTab === 'trade' && (
            <div className="flex min-h-[min(420px,55dvh)] flex-1 flex-col overflow-y-auto bg-[color:var(--ibo-bg)] p-2 scrollbar-hide pb-[max(0.5rem,env(safe-area-inset-bottom))]">
              {orderForm}
            </div>
          )}
        </div>

        <div className="border-t-2 border-[rgba(91,184,255,0.25)] bg-[color:var(--ibo-surface)] flex flex-col" style={{ minHeight: 460 }}>
          <div className="flex overflow-x-auto border-b border-white/[0.06] scrollbar-hide shrink-0">
            {[
              { id: 'positions', label: 'Positions', n: positions.length },
              { id: 'open', label: 'Open', n: openOrders.length },
              { id: 'hist', label: 'History', n: orderHist.length },
              { id: 'trades', label: 'Trades', n: myTrades.length },
            ].map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setBottomTab(t.id)}
                className={`px-4 py-2.5 text-xs font-extrabold whitespace-nowrap border-b-2 shrink-0 ${
                  bottomTab === t.id ? 'border-[#5BB8FF] text-[#5BB8FF]' : 'border-transparent text-white/45'
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
                  <Link to="/login" className="font-bold text-[#5BB8FF] hover:underline">
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

      {/* Desktop — zone-1: chain | book | ticket — widths scale down on md/tablet */}
      <div
        className="hidden md:flex md:flex-col md:min-h-0"
        style={{ height: 'calc(100dvh - 70px)', maxHeight: 'calc(100dvh - 70px)', overflow: 'hidden' }}
      >
        <div
          className="flex flex-col gap-2 px-4 py-2 border-b border-white/[0.06] bg-[color:var(--ibo-surface)] shrink-0 relative z-[200]"
          style={{ pointerEvents: pairOpen ? 'none' : 'auto' }}
        >
          <div className="flex flex-wrap items-center gap-3 min-w-0">
            {UnderlyingDropdown}
            <div className="hidden lg:flex flex-1 min-w-0 overflow-x-auto scrollbar-hide items-center gap-1">
              {headerStatsRow}
            </div>
            <div className="flex items-center gap-2 ml-auto shrink-0">
              <span className="hidden xl:inline text-[10px] font-bold uppercase tracking-wider text-white/35 max-w-[200px] truncate">
                Long-only · limit
              </span>
              <button
                type="button"
                onClick={refresh}
                className="inline-flex items-center gap-2 rounded-lg border border-[color:var(--ibo-border-solid)] px-3 py-2 text-xs font-bold text-[color:var(--ibo-ink)] hover:bg-[color:var(--ibo-hover)]"
              >
                <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh
              </button>
            </div>
          </div>
          <div className="lg:hidden flex flex-wrap gap-2">{headerStatsRow}</div>
        </div>

        {error && (
          <div className="px-4 py-2 border-b border-rose-500/25 bg-rose-500/10 text-sm text-rose-200 flex items-center gap-2 shrink-0">
            <AlertCircle size={16} className="shrink-0" />
            <span className="flex-1">{error}</span>
            <button type="button" onClick={() => setError(null)} className="shrink-0 text-rose-300/60 hover:text-rose-200"><X size={14} /></button>
          </div>
        )}

        <div className="flex flex-1 min-h-0 min-w-0">
          <div
            className={`flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-[color:var(--ibo-bg)] ${
              selected ? 'border-r border-white/[0.06]' : ''
            }`}
          >
            {binanceChainTable}
          </div>

          {selected ? (
            <>
              {desktopBookColumn}
              <div className="flex w-[300px] lg:w-[360px] xl:w-[420px] shrink-0 flex-col overflow-hidden bg-[color:var(--ibo-surface)] min-w-0">
                {/* Close bar — collapses both the book column and this ticket */}
                <div className="flex items-center justify-between gap-2 shrink-0 px-3 py-2 border-b border-white/[0.07] bg-[color:var(--ibo-elevated)]">
                  <span className="text-[10px] font-extrabold uppercase tracking-[0.12em] text-[#5BB8FF] truncate">
                    {String(selected.option_type || '').toUpperCase()} · K {fmtNum(selected.strike, 2)} · {selected.expiry?.slice(0, 10) || '—'}
                  </span>
                  <button
                    type="button"
                    title="Close order book & ticket"
                    onClick={() => setSelectedId(null)}
                    className="shrink-0 rounded-md p-1.5 text-white/45 hover:text-white hover:bg-white/[0.08] transition-colors"
                  >
                    <X size={14} />
                  </button>
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto scrollbar-hide">
                  {orderForm}
                  <Link
                    to="/markets"
                    className="mx-4 mb-4 inline-flex items-center gap-2 text-[11px] font-semibold text-white/40 hover:text-[#5BB8FF]/90 transition-colors"
                  >
                    <Layers size={14} /> All markets
                  </Link>
                </div>
              </div>
            </>
          ) : null}
        </div>

        {/* Pinned bottom strip — same as futures/spot */}
        <div className="shrink-0 h-[28vh] min-h-[200px] max-h-[36vh] border-t border-[color:var(--ibo-border)]">
          <div className="flex flex-col h-full min-h-0 bg-[color:var(--ibo-surface)]">
            <div className="flex items-center shrink-0 overflow-x-auto border-b border-white/[0.06] scrollbar-hide h-[40px] px-1">
              {[
                { id: 'positions', label: 'Positions', n: positions.length },
                { id: 'open', label: 'Open orders', n: openOrders.length },
                { id: 'hist', label: 'Order history', n: orderHist.length },
                { id: 'trades', label: 'Trades', n: myTrades.length },
              ].map((t) => {
                const on = bottomTab === t.id;
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setBottomTab(t.id)}
                    className="relative h-full px-3.5 text-[12px] font-semibold whitespace-nowrap transition-colors"
                    style={{ color: on ? '#C5E35B' : 'var(--ibo-muted)' }}
                  >
                    {t.label}
                    {t.n > 0 ? (
                      <span className="ml-1.5 text-[10px] font-bold px-1.5 py-0.5 rounded bg-[#C5E35B]/15 text-[#C5E35B]">
                        {t.n}
                      </span>
                    ) : null}
                    {on ? (
                      <span className="absolute left-2 right-2 bottom-0 h-0.5 rounded-full bg-[#C5E35B]" />
                    ) : null}
                  </button>
                );
              })}
              <div className="ml-auto pr-3 hidden sm:flex items-center gap-1.5 text-[11px] text-[color:var(--ibo-muted)]">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                Connected
              </div>
            </div>
            <div className="flex-1 min-h-0 overflow-auto scrollbar-hide p-3 text-sm">
              {!user ? (
                <div className="flex flex-col items-center justify-center gap-2 py-10 text-center text-white/50">
                  <span className="text-[13px]">
                    <Link to="/login" className="font-bold text-[#C5E35B] hover:underline">
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
                  <div className="text-[#5BB8FF]/90 font-semibold">{lbl.main}</div>
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
                <div className="text-[#5BB8FF]/85 font-semibold">{lbl.main}</div>
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
                <div className="text-[#5BB8FF]/85 font-semibold">{lbl.main}</div>
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
              <div className="text-[#5BB8FF]/85 font-semibold">{lbl.main}</div>
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
              No trades yet
            </td>
          </tr>
        )}
      </tbody>
    </table>
  );
}
