/**
 * Strategy Builder — Delta Exchange parity
 * @see https://www.delta.exchange/app/options_chain/trade/BTC/...?activeTab=basketOrders
 *
 * Same terminal chrome as OptionsTradePage: header + split chain | Orders Basket rail.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { AlertCircle, RefreshCw, X } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { resolveChainCols } from '@/components/options/OptionsChainArm';
import DeltaSplitChainTable from '@/components/options/DeltaSplitChainTable';
import DeltaOptionsHeader from '@/components/options/DeltaOptionsHeader';
import OrdersBasketPanel from '@/components/options/OrdersBasketPanel';
import { DEFAULT_CHAIN_COLS } from '@/components/options/optionsChainColumns';
import {
  baseFromUsdt,
  formatExpiryTabLabel,
  vanillaContractsOnly,
} from '@/components/options/deltaInstrumentUtils';
import { optionsApi } from '@/services/optionsApi';
import { legPremium, num } from '@/lib/optionsStrategy';

const TEMPLATES = [
  { id: 'custom', label: 'Custom', hint: 'Add legs from the chain' },
  { id: 'long_straddle', label: 'Long Straddle', hint: 'Buy ATM Call + Put' },
  { id: 'short_straddle', label: 'Short Straddle', hint: 'Sell ATM Call + Put' },
  { id: 'long_strangle', label: 'Long Strangle', hint: 'Buy OTM Call + Put' },
  { id: 'bull_call', label: 'Bull Call Spread', hint: 'Buy low K / Sell high K Call' },
  { id: 'bear_put', label: 'Bear Put Spread', hint: 'Buy high K / Sell low K Put' },
];

function toUsdt(base) {
  const b = baseFromUsdt(base).toUpperCase();
  return b.endsWith('USDT') ? b : `${b}USDT`;
}

function midOf(c) {
  const m = c?.market || {};
  return num(m.mid ?? m.mark_price ?? c?.mark_price ?? m.best_ask ?? m.best_bid ?? c?.ask ?? c?.bid);
}

function buildStrikesMatrix(contracts, expiryIso) {
  const m = new Map();
  for (const c of contracts || []) {
    if (String(c.expiry || '') !== expiryIso) continue;
    const k = Number(c.strike);
    if (!Number.isFinite(k)) continue;
    const row = m.get(k) || { strike: k, expiry: expiryIso, call: null, put: null };
    const ot = String(c.option_type || '').toLowerCase();
    if (ot === 'call') row.call = c;
    else if (ot === 'put') row.put = c;
    m.set(k, row);
  }
  return [...m.values()].sort((a, b) => a.strike - b.strike);
}

function uniqueExpiriesOf(contracts) {
  const set = new Set();
  for (const c of contracts || []) {
    if (c?.expiry) set.add(String(c.expiry));
  }
  return [...set].sort((a, b) => Date.parse(a) - Date.parse(b));
}

function nearestStrike(rows, target) {
  if (!rows?.length) return null;
  let best = rows[0];
  let bestD = Infinity;
  for (const r of rows) {
    const d = Math.abs(num(r.strike) - target);
    if (d < bestD) {
      bestD = d;
      best = r;
    }
  }
  return best;
}

function computeAtmStrike(rows, referencePrice) {
  if (referencePrice == null || !Number.isFinite(Number(referencePrice)) || !rows.length) return null;
  const r = Number(referencePrice);
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

export default function OptionsStrategyBuilderPage() {
  const { underlying: raw } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const toast = useToast();

  const underlying = toUsdt(raw || 'BTC');
  const base = baseFromUsdt(underlying);

  const [underlyings, setUnderlyings] = useState([{ symbol: 'BTCUSDT' }, { symbol: 'ETHUSDT' }, { symbol: 'SOLUSDT' }]);
  const [contracts, setContracts] = useState([]);
  const [indexPx, setIndexPx] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [demo, setDemo] = useState(false);
  const [selectedExpiry, setSelectedExpiry] = useState(null);
  const [chainCols, setChainCols] = useState(() => ({ ...DEFAULT_CHAIN_COLS }));
  const [legs, setLegs] = useState([]);
  const [template, setTemplate] = useState('custom');
  const [orderType, setOrderType] = useState('limit');
  const [placing, setPlacing] = useState(false);
  const [selectedId, setSelectedId] = useState(null);

  const visibleChainCols = useMemo(() => resolveChainCols(chainCols), [chainCols]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      try {
        const uRes = await optionsApi.listUnderlyings({ listed_only: true });
        if (Array.isArray(uRes?.underlyings) && uRes.underlyings.length) {
          setUnderlyings(uRes.underlyings);
        }
      } catch {
        /* keep defaults */
      }

      let list = [];
      let idx = null;
      let isDemo = false;
      try {
        const cRes = await optionsApi.getChain(underlying, true);
        list = vanillaContractsOnly(cRes?.contracts || []);
        idx = cRes?.index_price ?? null;
      } catch {
        /* demo fallback */
      }
      if (!list.length) {
        const d = await optionsApi.demoChain(underlying);
        list = vanillaContractsOnly(d?.contracts || []);
        idx = d?.index_price ?? null;
        isDemo = Boolean(d?.demo ?? true);
      }
      setContracts(list);
      setIndexPx(idx != null && Number.isFinite(Number(idx)) ? Number(idx) : null);
      setDemo(isDemo);
      const exps = uniqueExpiriesOf(list);
      setSelectedExpiry((prev) => (prev && exps.includes(prev) ? prev : exps[0] || null));
    } catch (e) {
      setError(e?.message || 'Could not load options chain');
      setContracts([]);
    } finally {
      setLoading(false);
    }
  }, [underlying]);

  useEffect(() => {
    load();
  }, [load]);

  const expiries = useMemo(() => uniqueExpiriesOf(contracts), [contracts]);
  const rows = useMemo(() => {
    const exp = selectedExpiry || expiries[0];
    if (!exp) return [];
    return buildStrikesMatrix(contracts, exp);
  }, [contracts, selectedExpiry, expiries]);

  const chainMaxOi = useMemo(() => {
    let max = 1;
    for (const c of contracts) {
      const oi = Number(c.market?.open_interest ?? c.open_interest);
      if (Number.isFinite(oi) && oi > max) max = oi;
    }
    return max;
  }, [contracts]);

  const atmStrike = useMemo(() => computeAtmStrike(rows, indexPx), [rows, indexPx]);

  const byId = useMemo(() => {
    const m = new Map();
    for (const c of contracts) m.set(c.id, c);
    return m;
  }, [contracts]);

  const addLeg = useCallback((contractId, sideHint = 'buy') => {
    const contract = byId.get(contractId);
    if (!contract) return;
    setSelectedId(contractId);
    const side = sideHint === 'sell' ? 'sell' : 'buy';
    setLegs((prev) => [
      ...prev,
      {
        id: `${contract.id}-${side}-${Date.now()}`,
        contract,
        side,
        qty: 1,
        premium: midOf(contract),
      },
    ]);
    setTemplate('custom');
  }, [byId]);

  const updateLeg = (id, patch) => {
    setLegs((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  };
  const removeLeg = (id) => setLegs((prev) => prev.filter((l) => l.id !== id));
  const clearBasket = () => {
    setLegs([]);
    setTemplate('custom');
  };

  const applyTemplate = (tplId) => {
    setTemplate(tplId);
    if (tplId === 'custom' || !rows.length) return;
    const atm = nearestStrike(rows, indexPx || num(rows[Math.floor(rows.length / 2)]?.strike));
    if (!atm) {
      toast.error('No ATM', 'No contracts for this expiry');
      return;
    }
    const strikes = [...rows].sort((a, b) => num(a.strike) - num(b.strike));
    const atmIdx = strikes.findIndex((r) => r.strike === atm.strike);
    const higher = strikes[Math.min(strikes.length - 1, atmIdx + 2)] || atm;
    const lower = strikes[Math.max(0, atmIdx - 2)] || atm;
    const mk = (c, side) => (c ? {
      id: `${c.id}-${side}-${Math.random().toString(36).slice(2, 7)}`,
      contract: c,
      side,
      qty: 1,
      premium: midOf(c),
    } : null);

    let next = [];
    if (tplId === 'long_straddle') next = [mk(atm.call, 'buy'), mk(atm.put, 'buy')];
    else if (tplId === 'short_straddle') next = [mk(atm.call, 'sell'), mk(atm.put, 'sell')];
    else if (tplId === 'long_strangle') next = [mk(higher.call, 'buy'), mk(lower.put, 'buy')];
    else if (tplId === 'bull_call') next = [mk(atm.call, 'buy'), mk(higher.call, 'sell')];
    else if (tplId === 'bear_put') next = [mk(atm.put, 'buy'), mk(lower.put, 'sell')];
    next = next.filter(Boolean);
    if (!next.length) {
      toast.error('Template failed', 'Could not build strategy for this expiry');
      return;
    }
    setLegs(next);
    toast.success(TEMPLATES.find((t) => t.id === tplId)?.label || 'Strategy', 'Loaded into Orders Basket');
  };

  const placeBasket = async () => {
    if (!legs.length) {
      toast.error('Empty basket', 'Add at least one leg');
      return;
    }
    if (!user) {
      navigate('/login');
      return;
    }
    if (demo) {
      toast.warning('Demo chain', 'Live orders unavailable on demo chain');
      return;
    }
    setPlacing(true);
    let ok = 0;
    let fail = 0;
    try {
      for (const leg of legs) {
        try {
          const px = orderType === 'market' ? undefined : num(leg.premium || legPremium(leg));
          await optionsApi.placeOrder({
            contract_id: leg.contract.id,
            side: leg.side,
            type: orderType === 'market' ? 'market' : 'limit',
            quantity: Math.max(1, num(leg.qty, 1)),
            ...(orderType === 'limit' && px > 0 ? { price: px } : {}),
            time_in_force: 'gtc',
          });
          ok += 1;
        } catch {
          fail += 1;
        }
      }
      if (ok && !fail) {
        toast.success('Basket placed', `${ok} leg${ok > 1 ? 's' : ''} submitted`);
        clearBasket();
      } else if (ok && fail) {
        toast.error('Partial basket', `${ok} placed, ${fail} failed`);
      } else {
        toast.error('Basket failed', 'Could not place any legs');
      }
    } finally {
      setPlacing(false);
    }
  };

  const setOptionsView = (v) => {
    if (v === 'strategy') return;
    navigate(`/options/${underlying}`);
  };

  const basketHeader = (
    <div className="flex h-full min-h-[72px] items-center justify-between gap-3 px-4">
      <div className="min-w-0">
        <div className="text-[15px] font-extrabold text-[color:var(--ibo-ink)]">Orders Basket</div>
        <div className="mt-0.5 text-[11px] text-[color:var(--ibo-muted)]">
          {base} · Strategy Builder
          {indexPx != null ? (
            <span className="ml-2 font-mono tabular-nums">
              Index {Number(indexPx).toLocaleString(undefined, { maximumFractionDigits: 1 })}
            </span>
          ) : null}
          {demo ? (
            <span className="ml-2 rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-bold text-amber-600">
              Demo
            </span>
          ) : null}
        </div>
      </div>
      <Link
        to={`/options/${underlying}`}
        className="shrink-0 rounded border border-[color:var(--ibo-border-solid)] px-2.5 py-1.5 text-[11px] font-bold text-[color:var(--ibo-muted)] hover:border-[#fe6c02]/40 hover:text-[#fe6c02]"
      >
        Exit builder
      </Link>
    </div>
  );

  const chainPane = (
    <div className="doc-chain flex min-h-0 min-w-0 w-full flex-1 flex-col overflow-hidden antialiased">
      <div className="doc-chain-bar flex shrink-0 items-center justify-between gap-2 border-b border-[#eef0f2] bg-[#fafbfc] px-3 py-1.5 text-[11px]">
        <span className="doc-chain-bar__side is-calls font-bold text-[#26a69a]">Calls</span>
        <span className="font-semibold text-[color:var(--ibo-muted)]">
          {selectedExpiry ? formatExpiryTabLabel(selectedExpiry) : '—'}
          {atmStrike != null ? (
            <span className="ml-2 font-mono text-[color:var(--ibo-ink)]">ATM {atmStrike}</span>
          ) : null}
        </span>
        <span className="doc-chain-bar__side is-puts font-bold text-[#d14b4b]">Puts</span>
      </div>
      <div className="options-chain-scroll-v doc-chain-scroll flex min-h-0 flex-1 flex-col overflow-hidden">
        {loading && !contracts.length ? (
          <div className="flex flex-col items-center justify-center gap-2 py-10 text-sm text-[#8b919a]">
            <RefreshCw size={18} className="animate-spin text-[#fe6c02]" /> Loading option chain…
          </div>
        ) : !rows.length ? (
          <div className="p-6 text-center text-sm text-[#8b919a]">No strikes for this expiry.</div>
        ) : (
          <DeltaSplitChainTable
            expiryKey={selectedExpiry || 'exp'}
            rows={rows}
            cols={visibleChainCols}
            selectedId={selectedId}
            referencePrice={indexPx}
            positions={[]}
            onPick={addLeg}
            maxOi={chainMaxOi}
            atmStrike={atmStrike}
            fmtStrike={(n) => Number(n).toLocaleString(undefined, { maximumFractionDigits: 0 })}
          />
        )}
      </div>
    </div>
  );

  const basketPane = (
    <OrdersBasketPanel
      legs={legs}
      underlying={underlying}
      indexPx={indexPx || 0}
      orderType={orderType}
      setOrderType={setOrderType}
      onUpdateLeg={updateLeg}
      onRemoveLeg={removeLeg}
      onClear={clearBasket}
      onPlace={placeBasket}
      placing={placing}
      user={user}
      templates={TEMPLATES}
      templateId={template}
      onTemplate={applyTemplate}
    />
  );

  return (
    <div className="doc-opts-page min-h-[calc(100vh-3.5rem)]">
      {/* Mobile */}
      <div className="flex flex-col md:hidden">
        <div className="border-b border-[color:var(--ibo-border)] bg-white px-3 py-2">
          <div className="text-[15px] font-extrabold">Strategy Builder</div>
          <div className="text-[11px] text-[color:var(--ibo-muted)]">{base} Orders Basket</div>
        </div>
        {error ? (
          <div className="flex items-center gap-2 border-b border-rose-500/25 bg-rose-500/10 px-3 py-2 text-sm text-rose-600">
            <AlertCircle size={14} /> {error}
          </div>
        ) : null}
        <div className="h-[min(48vh,420px)] overflow-hidden border-b border-[color:var(--ibo-border)]">
          {chainPane}
        </div>
        <div className="min-h-[420px]">{basketPane}</div>
      </div>

      {/* Desktop — Delta terminal */}
      <div className="delta-trade doc-opts doc-opts--strategy hidden md:flex md:w-full md:flex-col">
        <div className="delta-options-header relative z-[200] flex min-w-0 w-full shrink-0 items-stretch border-b border-[color:var(--ibo-border)] bg-white">
          <div className="delta-options-header__tools min-w-0 flex-1 overflow-hidden">
            <DeltaOptionsHeader
              optionsView="strategy"
              setOptionsView={setOptionsView}
              underlyings={underlyings}
              underlying={underlying}
              onSelectUnderlying={(sym) => {
                if (sym === underlying) return;
                navigate(`/options/strategy/${baseFromUsdt(sym)}`);
              }}
              expiries={expiries}
              selectedExpiry={selectedExpiry || expiries[0] || null}
              onSelectExpiry={setSelectedExpiry}
              cols={visibleChainCols}
              onChangeCols={(next) => setChainCols(resolveChainCols(next))}
              onRefresh={load}
              loading={loading}
            />
          </div>
          <div className="delta-right-col shrink-0 border-l border-[#e8eaed] bg-white">
            {basketHeader}
          </div>
        </div>

        {error ? (
          <div className="flex shrink-0 items-center gap-2 border-b border-rose-500/25 bg-rose-500/10 px-4 py-2 text-sm text-rose-600">
            <AlertCircle size={16} className="shrink-0" />
            <span className="flex-1">{error}</span>
            <button type="button" onClick={() => setError(null)} className="text-rose-400 hover:text-rose-600">
              <X size={14} />
            </button>
          </div>
        ) : null}

        <div className="flex min-h-[calc(100dvh-12rem)] h-[calc(100dvh-12rem)] max-h-[900px] min-w-0 overflow-hidden">
          <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden border-r border-[color:var(--ibo-border)] bg-[color:var(--ibo-bg)]">
            {chainPane}
          </div>
          <div className="delta-right-col flex min-h-0 shrink-0 flex-col overflow-hidden border-l border-[#e8eaed] bg-white">
            {basketPane}
          </div>
        </div>
      </div>
    </div>
  );
}
