/**
 * MOVE / Straddle trade terminal — layout parity with Delta Exchange MOVE:
 * Header stats → Chart | Order book + tape | Buy/Sell ticket → Positions blotter
 * @see https://www.delta.exchange/app/move_options/trade/BTC/...
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ChevronDown, ChevronRight, Info, Loader2, RefreshCw, X } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { optionsApi } from '@/services/optionsApi';
import {
  baseFromUsdt,
  expiryMs,
  formatDeltaInstrumentId,
  isMoveContract,
} from '@/components/options/deltaInstrumentUtils';
import OptionsChartPanel from '@/components/options/OptionsChartPanel';
import OptionsOrderBook from '@/components/options/OptionsOrderBook';
import OptionsRecentTrades from '@/components/options/OptionsRecentTrades';
import {
  buildOptionsDemoDepth,
  buildOptionsDemoTrades,
  depthHasLevels,
} from '@/components/options/optionsDemoBook';
import { COIN_ICONS } from '@/services/marketApi';
import { useToast, friendlyError } from '@/context/ToastContext';

function fmtPx(n, d = 2) {
  const v = Number(n);
  if (!Number.isFinite(v)) return '—';
  return v.toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d });
}

function fmtCompact(n) {
  const v = Number(n);
  if (!Number.isFinite(v) || v <= 0) return '—';
  if (v >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `$${(v / 1e3).toFixed(1)}K`;
  return `$${v.toFixed(0)}`;
}

function StatItem({ label, value, valueClass = 'text-[color:var(--ibo-ink)]' }) {
  return (
    <div className="flex flex-col gap-0.5 px-3 first:pl-0 shrink-0 border-l border-[color:var(--ibo-border)] first:border-l-0">
      <span className="text-[10px] text-[color:var(--ibo-muted)] whitespace-nowrap leading-none">{label}</span>
      <span className={`text-[12px] font-mono font-semibold tabular-nums whitespace-nowrap leading-tight ${valueClass}`}>
        {value}
      </span>
    </div>
  );
}

function SettlementCountdown({ expiry }) {
  const [label, setLabel] = useState('—');
  useEffect(() => {
    const tick = () => {
      const ms = expiryMs(expiry);
      if (!Number.isFinite(ms)) {
        setLabel('—');
        return;
      }
      let sec = Math.max(0, Math.floor((ms - Date.now()) / 1000));
      const d = Math.floor(sec / 86400);
      sec %= 86400;
      const h = Math.floor(sec / 3600);
      sec %= 3600;
      const m = Math.floor(sec / 60);
      const s = sec % 60;
      if (d > 0) {
        setLabel(`${String(d).padStart(2, '0')}d:${String(h).padStart(2, '0')}h:${String(m).padStart(2, '0')}m`);
      } else {
        setLabel(`${String(h).padStart(2, '0')}h:${String(m).padStart(2, '0')}m:${String(s).padStart(2, '0')}s`);
      }
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [expiry]);
  return label;
}

function WhatAreStraddlesModal({ open, onClose }) {
  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4" role="dialog" aria-modal>
      <button type="button" className="absolute inset-0 bg-black/55" aria-label="Close" onClick={onClose} />
      <div className="relative w-full max-w-lg rounded-xl border border-[color:var(--ibo-border-solid)] bg-[color:var(--ibo-bg)] p-5 shadow-2xl">
        <button type="button" onClick={onClose} className="absolute right-3 top-3 p-1 text-[color:var(--ibo-muted)] hover:text-[color:var(--ibo-ink)]">
          <X size={16} />
        </button>
        <h3 className="text-[15px] font-extrabold flex items-center gap-2">
          <Info size={16} className="text-[#FE6C02]" /> What are Straddles (MOVE)?
        </h3>
        <p className="mt-3 text-[13px] leading-relaxed text-[color:var(--ibo-muted)]">
          A MOVE contract is a straddle — an at-the-money call and put with the same strike.
          You trade the <b className="text-[color:var(--ibo-ink)]">magnitude</b> of the move, not the direction.
          Settlement pays <span className="font-mono text-[color:var(--ibo-ink)]">|index − strike|</span> per contract.
        </p>
        <ul className="mt-3 space-y-2 text-[12px] text-[color:var(--ibo-muted)]">
          <li><b className="text-emerald-400">Buy / Long</b> — expect a large price swing (long volatility).</li>
          <li><b className="text-rose-400">Sell / Short</b> — expect the market to stay quiet (short volatility).</li>
          <li>Long max loss = premium paid. Shorts post margin and can lose more than premium received.</li>
        </ul>
        <button
          type="button"
          onClick={onClose}
          className="mt-5 w-full h-10 rounded-md bg-[#FE6C02] text-[#101013] text-[13px] font-extrabold"
        >
          Got it
        </button>
      </div>
    </div>,
    document.body,
  );
}

function ContractPicker({ contracts, selectedId, underlying, onSelect }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null);
  const ref = useRef(null);
  const selected = contracts.find((c) => c.id === selectedId);
  const base = baseFromUsdt(underlying);
  const icon = COIN_ICONS[base];
  const label = formatDeltaInstrumentId(selected, underlying);

  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const toggle = () => {
    if (!open && ref.current) {
      const r = ref.current.getBoundingClientRect();
      setPos({ top: r.bottom + 6, left: r.left });
    }
    setOpen((o) => !o);
  };

  return (
    <div className="relative shrink-0" ref={ref}>
      <button
        type="button"
        onClick={toggle}
        className="inline-flex items-center gap-2 rounded-md px-2 py-1 hover:bg-[color:var(--ibo-hover)]"
      >
        {icon ? <img src={icon} alt="" className="w-6 h-6 rounded-full" /> : (
          <span className="w-6 h-6 rounded-full bg-[#FE6C02]/20 text-[#FE6C02] text-[10px] font-bold flex items-center justify-center">{base[0]}</span>
        )}
        <div className="text-left leading-tight">
          <div className="text-[13px] font-extrabold font-mono">{label}</div>
          <div className="text-[10px] text-[color:var(--ibo-muted)]">MOVE · Straddle</div>
        </div>
        <ChevronDown size={14} className={`text-[color:var(--ibo-muted)] ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && pos ? createPortal(
        <div
          className="fixed z-[120] w-[22rem] max-h-72 overflow-auto rounded-lg border border-[color:var(--ibo-border-solid)] bg-[color:var(--ibo-bg)] shadow-xl"
          style={{ top: pos.top, left: pos.left }}
        >
          {contracts.map((c) => {
            const id = formatDeltaInstrumentId(c, underlying);
            const on = c.id === selectedId;
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => { onSelect(c); setOpen(false); }}
                className={`w-full flex items-center justify-between gap-2 px-3 py-2 text-left text-[12px] ${
                  on ? 'bg-[rgba(254,108,2,0.12)] text-[#FE6C02]' : 'hover:bg-[color:var(--ibo-hover)]'
                }`}
              >
                <span className="font-mono font-bold">{id}</span>
                <span className="font-mono text-[color:var(--ibo-muted)]">
                  {fmtPx(c.market?.mark_price ?? c.market?.mid)}
                </span>
              </button>
            );
          })}
        </div>,
        document.body,
      ) : null}
    </div>
  );
}

function MoveTradeTicket({
  selected,
  side,
  setSide,
  otype,
  setOtype,
  price,
  setPrice,
  qty,
  setQty,
  mark,
  avail,
  placing,
  user,
  kyc,
  onSubmit,
  navigate,
  reduceOnly,
  setReduceOnly,
  base,
  onRefreshFunds,
}) {
  const [bracketOpen, setBracketOpen] = useState(false);
  const [bracketSet, setBracketSet] = useState(false);
  const [tpTrigger, setTpTrigger] = useState('');
  const [tpLimit, setTpLimit] = useState('');
  const [slTrigger, setSlTrigger] = useState('');
  const [slLimit, setSlLimit] = useState('');
  const [tpPct, setTpPct] = useState(0);
  const [slPct, setSlPct] = useState(0);
  const [qtyUnit, setQtyUnit] = useState('lot'); // lot | usd
  const [unitOpen, setUnitOpen] = useState(false);
  const [qtyInput, setQtyInput] = useState(qty || '');
  const unitRef = useRef(null);

  const lot = Number(selected?.lot_size) > 0 ? Number(selected.lot_size) : 1;
  const marketPx = Number(
    mark
    || selected?.market?.mark_price
    || selected?.market?.mid
    || selected?.market?.last_price
    || selected?.market?.best_ask
    || selected?.market?.best_bid
    || 0,
  );
  const limitPx = Number(price) || 0;
  const px = otype === 'market' ? marketPx : (limitPx > 0 ? limitPx : marketPx);
  const q = Number(qty) || 0;
  const fundsReq = px > 0 && q > 0 ? px * q : 0;
  const isBuy = side === 'buy';
  const kycBlocked = !!user && kyc?.status !== 'approved';
  const kycPending = kyc?.status === 'pending';

  useEffect(() => {
    const onDoc = (e) => {
      if (unitRef.current && !unitRef.current.contains(e.target)) setUnitOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  // qty is always stored in lots; refresh the visible field when unit / mark / % changes.
  useEffect(() => {
    const lots = Number(qty);
    if (!(lots > 0)) {
      setQtyInput('');
      return;
    }
    if (qtyUnit === 'usd') {
      if (px > 0) setQtyInput(String(Number((lots * px).toFixed(2))));
      return;
    }
    setQtyInput(String(qty));
  }, [qty, qtyUnit, px]);

  const lotsFromDisplay = (raw) => {
    const n = Number(raw);
    if (!(n > 0)) return '';
    if (qtyUnit === 'usd') {
      if (!(px > 0)) return '';
      const lots = n / px;
      return String(Number((Math.max(lot, Math.round(lots / lot) * lot)).toFixed(8)));
    }
    return String(Number((Math.max(lot, Math.round(n / lot) * lot)).toFixed(8)));
  };

  const onQtyChange = (raw) => {
    setQtyInput(raw);
    if (raw === '' || raw == null) {
      setQty('');
      return;
    }
    if (qtyUnit === 'usd' && !(px > 0)) return;
    const asLots = lotsFromDisplay(raw);
    if (asLots) setQty(asLots);
  };

  const switchQtyUnit = (next) => {
    if (next === qtyUnit) {
      setUnitOpen(false);
      return;
    }
    setQtyUnit(next);
    setUnitOpen(false);
  };

  /** Max lots affordable from available margin at ref premium. */
  const maxAffordableLots = px > 0 && avail > 0
    ? Math.max(0, Math.floor(avail / px / lot) * lot)
    : 0;

  const applyPct = (pct) => {
    let unitPx = px;
    if (!(unitPx > 0) && marketPx > 0) {
      unitPx = marketPx;
      if (otype === 'limit' && !(limitPx > 0)) {
        setPrice(String(marketPx.toFixed(2)));
      }
    }
    if (!(unitPx > 0) || !(pct > 0)) return;

    const maxFromBal = avail > 0
      ? Math.floor(avail / unitPx / lot) * lot
      : 0;

    if (avail > 0 && maxFromBal < lot) {
      setQty(String(lot));
      return;
    }

    const maxLots = maxFromBal >= lot ? maxFromBal : lot * 100;
    const raw = (maxLots * pct) / 100;
    const lots = Math.max(lot, Math.floor(raw / lot + 1e-9) * lot);
    setQty(String(Number(lots.toFixed(8))));
  };

  const entryPx = px > 0 ? px : 0;
  const applyBracketPct = (kind, pct) => {
    if (!(entryPx > 0) || !(pct > 0)) return;
    // Long: TP above entry, SL below. Short: inverted.
    const up = isBuy ? 1 + pct / 100 : 1 - pct / 100;
    const down = isBuy ? 1 - pct / 100 : 1 + pct / 100;
    if (kind === 'tp') {
      const t = Math.max(0, entryPx * up);
      setTpTrigger(t.toFixed(2));
      setTpLimit(t.toFixed(2));
      setTpPct(pct);
    } else {
      const t = Math.max(0, entryPx * down);
      setSlTrigger(t.toFixed(2));
      setSlLimit(t.toFixed(2));
      setSlPct(pct);
    }
  };

  const exitPnl = (() => {
    const lim = Number(tpLimit);
    if (!(entryPx > 0) || !(lim > 0) || !(q > 0)) return null;
    const per = isBuy ? lim - entryPx : entryPx - lim;
    return per * q;
  })();

  const stopPnl = (() => {
    const lim = Number(slLimit);
    if (!(entryPx > 0) || !(lim > 0) || !(q > 0)) return null;
    const per = isBuy ? lim - entryPx : entryPx - lim;
    return per * q;
  })();

  const unitLabel = qtyUnit === 'usd' ? 'USD' : 'Lot';
  const approxLine = qtyUnit === 'usd'
    ? (q > 0 ? `≈ ${q} lot${q === 1 ? '' : 's'}` : `~${base}`)
    : (px > 0 && q > 0 ? `≈ ${fmtPx(q * px)} USD` : `~${base}`);

  const ctaLabel = !user
    ? 'Log In To Trade'
    : kycBlocked
      ? 'Get Verified To Trade'
      : placing
        ? 'Placing…'
        : isBuy
          ? 'Buy / Long'
          : 'Sell / Short';

  const fieldBox =
    'flex h-10 items-center rounded-md border border-[color:var(--ibo-border-solid)] bg-[color:var(--ibo-elevated,#fafbfc)] px-3 focus-within:border-[#FE6C02]/55 transition-colors';

  return (
    <div className="font-ui flex flex-col h-full min-h-0 text-[color:var(--ibo-ink)]">
      {/* Buy / Sell — soft tinted active states (Delta ticket) */}
      <div className="flex items-center gap-2 px-3 pt-3 pb-2 shrink-0">
        <div className="flex flex-1 overflow-hidden rounded-md border border-[color:var(--ibo-border-solid)]">
          <button
            type="button"
            onClick={() => setSide('buy')}
            className={`flex-1 py-2.5 text-[13px] font-bold transition-colors ${
              isBuy
                ? 'bg-[color:var(--ibo-positive)]/12 text-[color:var(--ibo-positive)] ring-1 ring-inset ring-[color:var(--ibo-positive)]/70'
                : 'bg-[color:var(--ibo-elevated,#f3f4f6)] text-[color:var(--ibo-muted)] hover:text-[color:var(--ibo-ink)]'
            }`}
          >
            Buy
          </button>
          <button
            type="button"
            onClick={() => setSide('sell')}
            className={`flex-1 py-2.5 text-[13px] font-bold transition-colors ${
              !isBuy
                ? 'bg-[color:var(--ibo-negative)]/12 text-[color:var(--ibo-negative)] ring-1 ring-inset ring-[color:var(--ibo-negative)]/70'
                : 'bg-[color:var(--ibo-elevated,#f3f4f6)] text-[color:var(--ibo-muted)] hover:text-[color:var(--ibo-ink)]'
            }`}
          >
            Sell
          </button>
        </div>
      </div>

      {/* Limit / Market only — no Stop Limit */}
      <div className="flex items-center gap-0 px-3 border-b border-[color:var(--ibo-border)] shrink-0">
        {[
          { id: 'limit', label: 'Limit' },
          { id: 'market', label: 'Market' },
        ].map((t) => {
          const on = otype === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setOtype(t.id)}
              className="relative px-3 py-2.5 text-[12px] font-semibold transition-colors"
              style={{
                color: on ? 'var(--ibo-ink)' : 'var(--ibo-muted)',
                fontWeight: on ? 700 : 600,
              }}
            >
              {t.label}
              {on ? (
                <span className="absolute left-2 right-2 bottom-0 h-[3px] rounded-t-sm bg-[#FE6C02]" />
              ) : null}
            </button>
          );
        })}
      </div>

      <form onSubmit={onSubmit} className="flex-1 min-h-0 overflow-y-auto px-3 py-3 space-y-3 scrollbar-hide">
        {otype === 'limit' ? (
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-[11px] text-[color:var(--ibo-muted)]">Price</span>
              <button
                type="button"
                onClick={() => mark > 0 && setPrice(String(mark.toFixed(2)))}
                className="text-[11px] font-semibold text-[#FE6C02] hover:underline"
              >
                Mark
              </button>
            </div>
            <div className={fieldBox}>
              <input
                type="number"
                step="any"
                min="0"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                className="flex-1 min-w-0 bg-transparent outline-none font-mono text-[13px] font-semibold tabular-nums placeholder:text-[color:var(--ibo-muted)]"
                placeholder={mark ? String(mark.toFixed(2)) : '0.00'}
              />
              <span className="ml-2 shrink-0 text-[12px] font-bold text-[color:var(--ibo-muted)]">USD</span>
            </div>
          </div>
        ) : null}

        {/* Quantity + unit dropdown */}
        <div>
          <div className={`${fieldBox} relative`}>
            <input
              type="number"
              step="any"
              min="0"
              value={qtyInput}
              onChange={(e) => onQtyChange(e.target.value)}
              className="flex-1 min-w-0 bg-transparent outline-none font-mono text-[13px] font-semibold tabular-nums placeholder:text-[color:var(--ibo-muted)]"
              placeholder="Enter Quantity"
            />
            <div className="relative ml-2 shrink-0" ref={unitRef}>
              <button
                type="button"
                onClick={() => setUnitOpen((v) => !v)}
                className={`inline-flex items-center gap-0.5 text-[12px] font-bold transition-colors ${
                  unitOpen ? 'text-[#FE6C02]' : 'text-[color:var(--ibo-muted)] hover:text-[color:var(--ibo-ink)]'
                }`}
                aria-haspopup="listbox"
                aria-expanded={unitOpen}
              >
                {unitLabel}
                <ChevronDown size={12} strokeWidth={2.5} aria-hidden />
              </button>
              {unitOpen ? (
                <div
                  role="listbox"
                  className="absolute right-0 top-[calc(100%+6px)] z-30 min-w-[104px] overflow-hidden rounded-md border border-[color:var(--ibo-border-solid)] bg-[color:var(--ibo-bg)] shadow-lg"
                >
                  {[
                    { id: 'lot', label: 'Lot', hint: 'Contracts' },
                    { id: 'usd', label: 'USD', hint: 'Premium' },
                  ].map((opt) => (
                    <button
                      key={opt.id}
                      type="button"
                      role="option"
                      aria-selected={qtyUnit === opt.id}
                      onClick={() => switchQtyUnit(opt.id)}
                      className={`flex w-full flex-col items-start px-3 py-2 text-left transition-colors ${
                        qtyUnit === opt.id
                          ? 'bg-[rgba(254,108,2,0.1)] text-[#FE6C02]'
                          : 'text-[color:var(--ibo-ink)] hover:bg-[rgba(254,108,2,0.06)]'
                      }`}
                    >
                      <span className="text-[12px] font-bold">{opt.label}</span>
                      <span className="text-[10px] text-[color:var(--ibo-muted)]">{opt.hint}</span>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
          <div className="mt-2 grid grid-cols-5 gap-1">
            {[10, 25, 50, 75, 100].map((pct) => (
              <button
                key={pct}
                type="button"
                onClick={() => applyPct(pct)}
                disabled={!selected}
                className="py-1.5 text-[11px] font-semibold rounded border border-[color:var(--ibo-border)] text-[color:var(--ibo-muted)] hover:border-[#FE6C02]/45 hover:text-[#FE6C02] disabled:opacity-35 transition-colors"
              >
                {pct}%
              </button>
            ))}
          </div>
          <div className="mt-1.5 flex items-center justify-between text-[11px] text-[color:var(--ibo-muted)]">
            <span>{approxLine}</span>
            <span>1 Lot = {lot} contract{lot === 1 ? '' : 's'}</span>
          </div>
          {maxAffordableLots > 0 ? (
            <p className="mt-1 text-[10px] text-[color:var(--ibo-muted)]">
              Max ≈ {maxAffordableLots} lot{maxAffordableLots === 1 ? '' : 's'} from available margin
            </p>
          ) : null}
        </div>

        {/* Bracket Order — Delta TP/SL panel */}
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <span
              className="text-[12px] text-[color:var(--ibo-muted)] border-b border-dashed border-[color:var(--ibo-muted)]/50 cursor-help"
              title="Attach take-profit and stop-loss to your entry"
            >
              Bracket Order
            </span>
            <button
              type="button"
              onClick={() => {
                setBracketOpen((v) => !v);
                if (bracketOpen) {
                  /* closing editor keeps set state */
                } else {
                  setBracketSet(false);
                }
              }}
              className="inline-flex items-center gap-1 text-[12px] font-bold text-[#FE6C02] hover:underline"
            >
              {bracketOpen ? 'Hide TP/SL' : (bracketSet ? 'Edit TP/SL' : '+ Add TP/SL')}
            </button>
          </div>

          {!bracketOpen && bracketSet ? (
            <div className="rounded-md border border-[color:var(--ibo-border-solid)] bg-[color:var(--ibo-elevated,#fafbfc)] px-3 py-2.5 space-y-1.5 text-[12px]">
              <div className="flex justify-between text-[color:var(--ibo-muted)]">
                <span>Exit PnL</span>
                <span className="font-mono text-[color:var(--ibo-ink)]">
                  {exitPnl != null ? `${exitPnl >= 0 ? '+' : ''}${fmtPx(exitPnl)}` : '—'}
                </span>
              </div>
              <div className="flex justify-between text-[color:var(--ibo-muted)]">
                <span>Stop PnL</span>
                <span className="font-mono text-[color:var(--ibo-ink)]">
                  {stopPnl != null ? `${stopPnl >= 0 ? '+' : ''}${fmtPx(stopPnl)}` : '—'}
                </span>
              </div>
            </div>
          ) : null}

          {bracketOpen ? (
            <div className="rounded-md border border-[color:var(--ibo-border-solid)] bg-[color:var(--ibo-bg)] overflow-hidden">
              {/* Take Profit */}
              <div className="px-3 pt-3 pb-3 space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[13px] font-bold text-[color:var(--ibo-ink)]">Take Profit</span>
                  <span className="inline-flex h-7 items-center rounded border border-[color:var(--ibo-border-solid)] px-2.5 text-[11px] font-bold text-[#FE6C02]">
                    Limit
                  </span>
                </div>

                <div>
                  <label className="mb-1 inline-block text-[11px] text-[color:var(--ibo-muted)] border-b border-dashed border-[color:var(--ibo-muted)]/45">
                    Trigger Price
                  </label>
                  <div className="rounded-md bg-[color:var(--ibo-elevated,#f3f4f6)] px-3 pt-2.5 pb-2 space-y-2">
                    <input
                      type="number"
                      step="any"
                      min="0"
                      value={tpTrigger}
                      onChange={(e) => { setTpTrigger(e.target.value); setTpPct(0); }}
                      placeholder="Trigger Price USD"
                      className="w-full bg-transparent outline-none text-[13px] font-mono font-semibold placeholder:text-[color:var(--ibo-muted)] placeholder:font-medium"
                    />
                    <div className="flex items-center gap-1.5">
                      {[5, 10, 15, 20].map((pct) => (
                        <button
                          key={`tp-${pct}`}
                          type="button"
                          onClick={() => applyBracketPct('tp', pct)}
                          className={`flex-1 h-7 rounded text-[11px] font-semibold transition-colors ${
                            tpPct === pct
                              ? 'bg-[#FE6C02]/15 text-[#FE6C02]'
                              : 'text-[color:var(--ibo-muted)] hover:text-[#FE6C02] hover:bg-[rgba(254,108,2,0.06)]'
                          }`}
                        >
                          {pct}%
                        </button>
                      ))}
                      <span className="inline-flex h-7 min-w-[2.5rem] items-center justify-center rounded border border-[color:var(--ibo-border-solid)] bg-[color:var(--ibo-bg)] px-1.5 text-[11px] font-bold text-[color:var(--ibo-ink)] tabular-nums">
                        {tpPct}%
                      </span>
                    </div>
                  </div>
                </div>

                <div>
                  <label className="mb-1 inline-block text-[11px] text-[color:var(--ibo-muted)] border-b border-dashed border-[color:var(--ibo-muted)]/45">
                    Limit Price
                  </label>
                  <div className="rounded-md bg-[color:var(--ibo-elevated,#f3f4f6)] px-3 h-10 flex items-center">
                    <input
                      type="number"
                      step="any"
                      min="0"
                      value={tpLimit}
                      onChange={(e) => setTpLimit(e.target.value)}
                      placeholder="Limit Price USD"
                      className="w-full bg-transparent outline-none text-[13px] font-mono font-semibold placeholder:text-[color:var(--ibo-muted)] placeholder:font-medium"
                    />
                  </div>
                </div>
              </div>

              <div className="mx-3 border-t border-dashed border-[color:var(--ibo-border)]" />

              {/* Stop Loss */}
              <div className="px-3 pt-3 pb-3 space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[13px] font-bold text-[color:var(--ibo-ink)]">Stop Loss</span>
                  <span className="inline-flex h-7 items-center rounded border border-[color:var(--ibo-border-solid)] px-2.5 text-[11px] font-bold text-[#FE6C02]">
                    Limit
                  </span>
                </div>

                <div>
                  <label className="mb-1 inline-block text-[11px] text-[color:var(--ibo-muted)] border-b border-dashed border-[color:var(--ibo-muted)]/45">
                    Trigger Price
                  </label>
                  <div className="rounded-md bg-[color:var(--ibo-elevated,#f3f4f6)] px-3 pt-2.5 pb-2 space-y-2">
                    <input
                      type="number"
                      step="any"
                      min="0"
                      value={slTrigger}
                      onChange={(e) => { setSlTrigger(e.target.value); setSlPct(0); }}
                      placeholder="Trigger Price USD"
                      className="w-full bg-transparent outline-none text-[13px] font-mono font-semibold placeholder:text-[color:var(--ibo-muted)] placeholder:font-medium"
                    />
                    <div className="flex items-center gap-1.5">
                      {[5, 10, 15, 20].map((pct) => (
                        <button
                          key={`sl-${pct}`}
                          type="button"
                          onClick={() => applyBracketPct('sl', pct)}
                          className={`flex-1 h-7 rounded text-[11px] font-semibold transition-colors ${
                            slPct === pct
                              ? 'bg-[#FE6C02]/15 text-[#FE6C02]'
                              : 'text-[color:var(--ibo-muted)] hover:text-[#FE6C02] hover:bg-[rgba(254,108,2,0.06)]'
                          }`}
                        >
                          {pct}%
                        </button>
                      ))}
                      <span className="inline-flex h-7 min-w-[2.5rem] items-center justify-center rounded border border-[color:var(--ibo-border-solid)] bg-[color:var(--ibo-bg)] px-1.5 text-[11px] font-bold text-[color:var(--ibo-ink)] tabular-nums">
                        {slPct}%
                      </span>
                    </div>
                  </div>
                </div>

                <div>
                  <label className="mb-1 inline-block text-[11px] text-[color:var(--ibo-muted)] border-b border-dashed border-[color:var(--ibo-muted)]/45">
                    Limit Price
                  </label>
                  <div className="rounded-md bg-[color:var(--ibo-elevated,#f3f4f6)] px-3 h-10 flex items-center">
                    <input
                      type="number"
                      step="any"
                      min="0"
                      value={slLimit}
                      onChange={(e) => setSlLimit(e.target.value)}
                      placeholder="Limit Price USD"
                      className="w-full bg-transparent outline-none text-[13px] font-mono font-semibold placeholder:text-[color:var(--ibo-muted)] placeholder:font-medium"
                    />
                  </div>
                </div>
              </div>

              {/* PnL summary + Set Bracket */}
              <div className="px-3 pb-3 space-y-2.5 border-t border-[color:var(--ibo-border)] pt-3">
                <div className="flex justify-between text-[12px] text-[color:var(--ibo-muted)]">
                  <span>Exit PnL</span>
                  <span className="font-mono text-[color:var(--ibo-ink)]">
                    {exitPnl != null ? `${exitPnl >= 0 ? '+' : ''}${fmtPx(exitPnl)}` : '—'}
                  </span>
                </div>
                <div className="flex justify-between text-[12px] text-[color:var(--ibo-muted)]">
                  <span>Stop PnL</span>
                  <span className="font-mono text-[color:var(--ibo-ink)]">
                    {stopPnl != null ? `${stopPnl >= 0 ? '+' : ''}${fmtPx(stopPnl)}` : '—'}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setBracketSet(true);
                    setBracketOpen(false);
                  }}
                  className="w-full h-10 rounded-md bg-[#FE6C02] text-white text-[13px] font-extrabold hover:brightness-110 transition-[filter]"
                >
                  Set Bracket
                </button>
              </div>
            </div>
          ) : null}
        </div>

        {/* Funds / margin */}
        <div className="space-y-1.5 text-[12px] pt-0.5">
          <div className="flex justify-between items-center gap-2">
            <span className="inline-flex items-center gap-1.5 text-[color:var(--ibo-muted)]">
              <span className="border-b border-dashed border-[color:var(--ibo-muted)]/50">Funds req.</span>
              <button
                type="button"
                onClick={onRefreshFunds}
                className="text-[#FE6C02] hover:opacity-80"
                aria-label="Refresh funds"
                title="Refresh"
              >
                <RefreshCw size={12} strokeWidth={2.5} />
              </button>
            </span>
            <span className="font-mono font-semibold tabular-nums">
              ~{fmtPx(fundsReq)} USD
            </span>
          </div>
          <div className="flex justify-between items-center gap-2">
            <span className="text-[color:var(--ibo-muted)]">Available Margin</span>
            <span className="font-mono font-semibold tabular-nums">{fmtPx(avail)} USD</span>
          </div>
        </div>

        {kycBlocked ? (
          <div
            className={`rounded-lg px-3 py-2.5 border text-[11px] leading-relaxed ${
              kycPending
                ? 'bg-[#FE6C02]/10 border-[#FE6C02]/30 text-[color:var(--ibo-ink)]'
                : 'bg-[color:var(--ibo-negative)]/10 border-[color:var(--ibo-negative)]/25 text-[color:var(--ibo-ink)]'
            }`}
          >
            {kycPending
              ? 'KYC is under review. Trading unlocks once verification is approved.'
              : 'Complete identity verification to place MOVE orders.'}
            <Link to="/account/kyc" className="ml-1 font-bold text-[#FE6C02] hover:underline">
              Verify now
            </Link>
          </div>
        ) : null}

        {!user ? (
          <button
            type="button"
            onClick={() => navigate('/login')}
            className="w-full h-11 rounded-md bg-[#FE6C02] text-white font-extrabold text-[14px] hover:brightness-110 transition-[filter]"
          >
            Log In To Trade
          </button>
        ) : (
          <button
            type="submit"
            disabled={placing || !selected || kycBlocked}
            className={`w-full h-11 rounded-md text-[14px] font-extrabold text-white disabled:opacity-45 transition-[filter] ${
              kycBlocked
                ? 'bg-[#FE6C02]'
                : isBuy
                  ? 'bg-[color:var(--ibo-positive)] hover:brightness-110'
                  : 'bg-[color:var(--ibo-negative)] hover:brightness-110'
            }`}
            onClick={(e) => {
              if (kycBlocked) {
                e.preventDefault();
                navigate('/account/kyc');
              }
            }}
          >
            {placing ? <Loader2 className="animate-spin mx-auto" size={18} /> : ctaLabel}
          </button>
        )}

        <label className="inline-flex items-center gap-2 text-[12px] text-[color:var(--ibo-muted)] cursor-pointer select-none">
          <input
            type="checkbox"
            checked={reduceOnly}
            onChange={(e) => setReduceOnly(e.target.checked)}
            className="accent-[#FE6C02] rounded"
          />
          <span className="border-b border-dashed border-[color:var(--ibo-muted)]/50">Reduce Only</span>
        </label>

        <div className="text-[11px] text-[color:var(--ibo-muted)] pt-0.5">% Fees</div>
      </form>
    </div>
  );
}

export default function MoveOptionsTradePage() {
  const { underlying: rawUnd = 'BTC', contractId: urlCid } = useParams();
  const navigate = useNavigate();
  const { user, kyc } = useAuth();
  const toast = useToast();

  const underlying = useMemo(() => {
    const u = String(rawUnd || 'BTC').toUpperCase();
    return u.endsWith('USDT') ? u : `${u}USDT`;
  }, [rawUnd]);
  const base = baseFromUsdt(underlying);

  const [contracts, setContracts] = useState([]);
  const [indexPx, setIndexPx] = useState(null);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState(urlCid || null);
  const [side, setSide] = useState('buy');
  const [otype, setOtype] = useState('market');
  const [price, setPrice] = useState('');
  const [qty, setQty] = useState('');
  const [reduceOnly, setReduceOnly] = useState(false);
  const [placing, setPlacing] = useState(false);
  const [wallet, setWallet] = useState(null);
  const [depth, setDepth] = useState(null);
  const [trades, setTrades] = useState([]);
  const [positions, setPositions] = useState([]);
  const [openOrders, setOpenOrders] = useState([]);
  const [fills, setFills] = useState([]);
  const [bottomTab, setBottomTab] = useState('positions');
  const [helpOpen, setHelpOpen] = useState(false);
  const [mobileTab, setMobileTab] = useState('trade');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await optionsApi.moveChain(underlying);
      const rows = data?.contracts || [];
      setContracts(rows);
      setIndexPx(data?.index_price ?? null);
      setSelectedId((prev) => {
        if (urlCid && rows.some((r) => r.id === urlCid)) return urlCid;
        if (prev && rows.some((r) => r.id === prev)) return prev;
        const spot = Number(data?.index_price) || 0;
        if (spot > 0 && rows.length) {
          return rows.reduce((a, b) =>
            Math.abs(Number(a.strike) - spot) <= Math.abs(Number(b.strike) - spot) ? a : b
          ).id;
        }
        return rows[0]?.id || null;
      });
    } catch (e) {
      toast.error('Could not load MOVE contracts', e?.message || 'Failed to fetch');
      setContracts([]);
    } finally {
      setLoading(false);
    }
  // toast is unstable from useToast(); do not put it in deps (causes fetch storms → Failed to fetch).
  }, [underlying, urlCid]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load(); }, [load]);

  const refreshAccount = useCallback(async () => {
    if (!user) {
      setWallet(null);
      setPositions([]);
      setOpenOrders([]);
      setFills([]);
      return;
    }
    try {
      const [w, p, o, t] = await Promise.all([
        optionsApi.wallet(),
        optionsApi.positions(),
        optionsApi.openOrders(),
        optionsApi.myTrades({ limit: 50 }).catch(() => ({ trades: [] })),
      ]);
      setWallet(w);
      const onlyMove = (row) => isMoveContract(row?.contract_id || row);
      setPositions((p.positions || []).filter(onlyMove));
      setOpenOrders((o.orders || o.open_orders || []).filter(onlyMove));
      setFills((t.trades || []).filter(onlyMove));
    } catch { /* ignore */ }
  }, [user]);

  useEffect(() => { refreshAccount(); }, [refreshAccount]);

  const selected = useMemo(
    () => contracts.find((c) => c.id === selectedId) || null,
    [contracts, selectedId],
  );

  const mark = Number(selected?.market?.mark_price ?? selected?.market?.mid ?? 0) || 0;
  const last = Number(selected?.market?.last_price ?? mark) || 0;
  const strike = Number(selected?.strike) || 0;
  const changePct = Number(selected?.market?.change_24h_pct);
  const isDown = Number.isFinite(changePct) ? changePct < 0 : null;

  useEffect(() => {
    if (!selected?.id) {
      setDepth(null);
      setTrades([]);
      return undefined;
    }
    let cancelled = false;
    (async () => {
      try {
        const [d, t] = await Promise.all([
          selected.demo_contract
            ? Promise.resolve(null)
            : optionsApi.depth(selected.id, { levels: 20 }).catch(() => null),
          selected.demo_contract
            ? Promise.resolve(null)
            : optionsApi.contractTrades(selected.id, { limit: 40 }).catch(() => null),
        ]);
        if (cancelled) return;
        const mid = mark || Number(selected.market?.mid) || 1;
        const effectiveDepth = depthHasLevels(d)
          ? d
          : buildOptionsDemoDepth({
            mid,
            mark: mid,
            contractId: selected.id,
            tick: Number(selected.tick_size) || 0.1,
          });
        setDepth(effectiveDepth);
        const tape = (t?.trades?.length ? t.trades : null)
          || buildOptionsDemoTrades({ mid, contractId: selected.id });
        setTrades(tape);
      } catch {
        if (!cancelled) {
          setDepth(buildOptionsDemoDepth({ mid: mark || 1, contractId: selected.id }));
          setTrades(buildOptionsDemoTrades({ mid: mark || 1, contractId: selected.id }));
        }
      }
    })();
    return () => { cancelled = true; };
  }, [selected?.id, selected?.demo_contract, selected?.tick_size, mark]);

  useEffect(() => {
    if (selected && otype === 'limit' && mark > 0) {
      setPrice(String(mark.toFixed(2)));
    }
  }, [selected?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const selectContract = (c) => {
    setSelectedId(c.id);
    setPrice(c.market?.mark_price ? String(Number(c.market.mark_price).toFixed(2)) : '');
    navigate(`/move/${base}/${encodeURIComponent(c.id)}`, { replace: true });
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!user) { navigate('/login'); return; }
    if (kyc?.status !== 'approved') { navigate('/account/kyc'); return; }
    if (!selected?.id) return;
    const q = Number(qty);
    if (!(q > 0)) { toast.error('Enter quantity'); return; }
    setPlacing(true);
    try {
      const body = {
        contract_id: selected.id,
        side,
        type: otype,
        quantity: q,
        reduce_only: reduceOnly,
        time_in_force: 'gtc',
      };
      if (otype === 'limit') {
        const px = Number(price);
        if (!(px > 0)) throw new Error('Enter a limit premium');
        body.price = px;
      }
      await optionsApi.placeOrder(body);
      toast.success(
        side === 'buy' ? 'Buy order placed' : 'Sell order placed',
        `${formatDeltaInstrumentId(selected, underlying)} · ${q}`,
      );
      await refreshAccount();
    } catch (err) {
      toast.error('Order failed', friendlyError(err.message));
    } finally {
      setPlacing(false);
    }
  };

  const avail = Number(wallet?.available ?? 0) || 0;

  const ticketProps = {
    selected,
    side,
    setSide,
    otype,
    setOtype,
    price,
    setPrice,
    qty,
    setQty,
    mark,
    avail,
    placing,
    user,
    kyc,
    onSubmit: submit,
    navigate,
    reduceOnly,
    setReduceOnly,
    base,
    onRefreshFunds: refreshAccount,
  };

  const bottomTabs = [
    { id: 'positions', label: 'Positions', n: positions.length },
    { id: 'open', label: 'Open Orders', n: openOrders.filter((o) => !selectedId || o.contract_id === selectedId).length },
    { id: 'fills', label: 'Fills', n: fills.filter((t) => !selectedId || t.contract_id === selectedId).length },
    { id: 'history', label: 'Order History', n: null },
  ];

  const blotter = (
    <div className="border-t border-[color:var(--ibo-border)] bg-[color:var(--ibo-bg)]">
      <div className="flex items-center gap-0 px-2 border-b border-[color:var(--ibo-border)] overflow-x-auto">
        {bottomTabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setBottomTab(t.id)}
            className="relative px-3 py-2.5 text-[12px] font-semibold whitespace-nowrap"
            style={{ color: bottomTab === t.id ? '#FE6C02' : 'var(--ibo-muted)' }}
          >
            {t.label}{t.n != null ? ` (${t.n})` : ''}
            {bottomTab === t.id ? <span className="absolute left-2 right-2 bottom-0 h-0.5 rounded-full bg-[#FE6C02]" /> : null}
          </button>
        ))}
        <button type="button" onClick={refreshAccount} className="ml-auto p-2 text-[color:var(--ibo-muted)] hover:text-[#FE6C02]">
          <RefreshCw size={13} />
        </button>
      </div>
      <div className="min-h-[160px] max-h-[240px] overflow-auto">
        {!user ? (
          <p className="text-center text-[12px] text-[color:var(--ibo-muted)] py-10">
            <Link to="/login" className="text-[#FE6C02] font-semibold hover:underline">Log In</Link>
            {' '}to view content
          </p>
        ) : bottomTab === 'positions' ? (
          <table className="w-full text-[12px]">
            <thead className="sticky top-0 bg-[color:var(--ibo-bg)] text-[10px] uppercase text-[color:var(--ibo-muted)]">
              <tr>
                <th className="px-3 py-2 text-left">Contract</th>
                <th className="px-2 py-2 text-left">Side</th>
                <th className="px-2 py-2 text-right">Size</th>
                <th className="px-2 py-2 text-right">Avg Premium</th>
                <th className="px-3 py-2 text-right">Mark</th>
              </tr>
            </thead>
            <tbody>
              {positions.map((p) => {
                const c = contracts.find((x) => x.id === p.contract_id);
                return (
                  <tr key={p.id} className="border-t border-[color:var(--ibo-border)]">
                    <td className="px-3 py-2 font-mono">{formatDeltaInstrumentId(c || { id: p.contract_id, option_type: 'move', strike: 0 }, underlying)}</td>
                    <td className={`px-2 py-2 font-bold uppercase ${p.side === 'short' ? 'text-rose-400' : 'text-emerald-400'}`}>{p.side || 'long'}</td>
                    <td className="px-2 py-2 text-right font-mono">{fmtPx(p.qty, 0)}</td>
                    <td className="px-2 py-2 text-right font-mono">{fmtPx(p.avg_premium)}</td>
                    <td className="px-3 py-2 text-right font-mono">{fmtPx(c?.market?.mark_price)}</td>
                  </tr>
                );
              })}
              {!positions.length ? (
                <tr><td colSpan={5} className="px-3 py-8 text-center text-[color:var(--ibo-muted)]">No open MOVE positions</td></tr>
              ) : null}
            </tbody>
          </table>
        ) : bottomTab === 'open' ? (
          <table className="w-full text-[12px]">
            <thead className="sticky top-0 bg-[color:var(--ibo-bg)] text-[10px] uppercase text-[color:var(--ibo-muted)]">
              <tr>
                <th className="px-3 py-2 text-left">Contract</th>
                <th className="px-2 py-2 text-left">Side</th>
                <th className="px-2 py-2 text-right">Price</th>
                <th className="px-2 py-2 text-right">Qty</th>
                <th className="px-3 py-2 text-right">Filled</th>
              </tr>
            </thead>
            <tbody>
              {(openOrders.filter((o) => o.contract_id === selectedId || !selectedId)).map((o) => (
                <tr key={o.id} className="border-t border-[color:var(--ibo-border)]">
                  <td className="px-3 py-2 font-mono text-[11px]">{o.contract_id}</td>
                  <td className={`px-2 py-2 font-bold uppercase ${o.side === 'buy' ? 'text-emerald-400' : 'text-rose-400'}`}>{o.side}</td>
                  <td className="px-2 py-2 text-right font-mono">{fmtPx(o.price)}</td>
                  <td className="px-2 py-2 text-right font-mono">{fmtPx(o.quantity, 0)}</td>
                  <td className="px-3 py-2 text-right font-mono">{fmtPx(o.filled, 0)}</td>
                </tr>
              ))}
              {!openOrders.length ? (
                <tr><td colSpan={5} className="px-3 py-8 text-center text-[color:var(--ibo-muted)]">No open orders</td></tr>
              ) : null}
            </tbody>
          </table>
        ) : (
          <table className="w-full text-[12px]">
            <thead className="sticky top-0 bg-[color:var(--ibo-bg)] text-[10px] uppercase text-[color:var(--ibo-muted)]">
              <tr>
                <th className="px-3 py-2 text-left">Time</th>
                <th className="px-2 py-2 text-left">Side</th>
                <th className="px-2 py-2 text-right">Price</th>
                <th className="px-3 py-2 text-right">Size</th>
              </tr>
            </thead>
            <tbody>
              {(fills.filter((t) => t.contract_id === selectedId || !selectedId)).slice(0, 40).map((t) => (
                <tr key={t.id} className="border-t border-[color:var(--ibo-border)]">
                  <td className="px-3 py-2 text-[color:var(--ibo-muted)]">{t.created_at ? new Date(t.created_at).toLocaleTimeString() : '—'}</td>
                  <td className={`px-2 py-2 font-bold uppercase ${t.side === 'buy' ? 'text-emerald-400' : 'text-rose-400'}`}>{t.side}</td>
                  <td className="px-2 py-2 text-right font-mono">{fmtPx(t.price)}</td>
                  <td className="px-3 py-2 text-right font-mono">{fmtPx(t.qty ?? t.quantity, 3)}</td>
                </tr>
              ))}
              {!fills.length ? (
                <tr><td colSpan={4} className="px-3 py-8 text-center text-[color:var(--ibo-muted)]">No fills yet</td></tr>
              ) : null}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );

  const header = (
    <div
      className="delta-trade-header flex items-center gap-2 sm:gap-3 px-3 py-2 bg-[color:var(--ibo-bg)] shrink-0 overflow-x-auto scrollbar-hide"
      style={{ borderBottom: '1px solid var(--ibo-border)', zIndex: 40 }}
    >
      <ContractPicker
        contracts={contracts}
        selectedId={selectedId}
        underlying={underlying}
        onSelect={selectContract}
      />

      <div className="flex items-center gap-2 shrink-0 min-w-[6.5rem]">
        <span
          className={`font-mono font-bold text-[18px] sm:text-[20px] tabular-nums tracking-tight ${
            isDown == null ? 'text-[color:var(--ibo-ink)]' : isDown ? 'text-rose-400' : 'text-emerald-400'
          }`}
        >
          ${fmtPx(last || mark)}
        </span>
        {isDown != null ? (
          <span className={`text-[11px] ${isDown ? 'text-rose-400' : 'text-emerald-400'}`}>
            {isDown ? '▼' : '▲'}
          </span>
        ) : null}
      </div>

      <div className="hidden md:flex items-center">
        <StatItem
          label="24h Change"
          value={Number.isFinite(changePct) ? `${changePct >= 0 ? '+' : ''}${changePct.toFixed(2)}%` : '—'}
          valueClass={!Number.isFinite(changePct) ? '' : changePct >= 0 ? 'text-emerald-400' : 'text-rose-400'}
        />
        <StatItem label="Index Price" value={indexPx ? fmtPx(indexPx, 1) : '—'} />
        <StatItem label="24h High" value={selected?.market?.high_24h ? `$${fmtPx(selected.market.high_24h)}` : '—'} />
        <StatItem label="24h Low" value={selected?.market?.low_24h ? `$${fmtPx(selected.market.low_24h)}` : '—'} />
        <StatItem label="24h Vol." value={fmtCompact(selected?.market?.volume_24h)} />
        <StatItem label="OI" value={fmtCompact(selected?.market?.open_interest)} />
        <StatItem label="Strike Price" value={strike ? fmtPx(strike, 0) : '—'} valueClass="text-[#FE6C02]" />
        <StatItem
          label="Settlement"
          value={<SettlementCountdown expiry={selected?.expiry} />}
          valueClass="text-[#FE6C02]"
        />
        <StatItem
          label="Delta"
          value={selected?.market?.delta != null ? Number(selected.market.delta).toFixed(2) : '—'}
        />
      </div>

      <div className="ml-auto flex items-center gap-3 shrink-0">
        <button
          type="button"
          onClick={() => setHelpOpen(true)}
          className="hidden lg:inline-flex items-center gap-1 text-[12px] text-[color:var(--ibo-muted)] hover:text-[#FE6C02]"
        >
          What are Straddles <ChevronRight size={14} />
        </button>
        <Link
          to={`/options/${underlying}`}
          className="hidden sm:inline text-[11px] font-semibold text-[color:var(--ibo-muted)] hover:text-[#FE6C02]"
        >
          Options chain
        </Link>
        <button type="button" onClick={load} className="p-1.5 text-[color:var(--ibo-muted)] hover:text-[#FE6C02]" aria-label="Refresh">
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>
    </div>
  );

  if (loading && !contracts.length) {
    return (
      <div className="delta-trade flex items-center justify-center h-[calc(100vh-70px)] text-[color:var(--ibo-muted)] text-sm gap-2">
        <RefreshCw size={14} className="animate-spin text-[#FE6C02]" /> Loading MOVE…
      </div>
    );
  }

  return (
    <div className="delta-trade bg-[color:var(--ibo-bg)] text-[color:var(--ibo-ink)]">
      <WhatAreStraddlesModal open={helpOpen} onClose={() => setHelpOpen(false)} />

      {/* Mobile */}
      <div className="flex flex-col md:hidden min-h-[calc(100vh-70px)]">
        {header}
        <div style={{ height: 240 }} className="relative overflow-hidden border-b border-[color:var(--ibo-border)]">
          <OptionsChartPanel
            selected={selected}
            underlying={underlying}
            referenceIndex={indexPx}
            depth={depth}
          />
        </div>
        <div className="sticky top-0 z-10 flex bg-transparent border-b border-[color:var(--ibo-border)]">
          {[['trade', 'Trade'], ['book', 'Book']].map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setMobileTab(id)}
              className={`flex-1 py-2.5 text-[12px] font-bold ${
                mobileTab === id ? 'text-[#FE6C02] border-b-2 border-[#FE6C02]' : 'text-white/50 border-b-2 border-transparent'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="bg-[color:var(--ibo-bg)] min-h-[420px]">
          {mobileTab === 'trade' ? <MoveTradeTicket {...ticketProps} /> : (
            <div className="grid grid-rows-2 gap-0 h-[520px]">
              <OptionsOrderBook
                depth={depth}
                midPrice={mark || null}
                markIv={selected?.market?.iv}
                onPriceClick={(pr) => { setOtype('limit'); setPrice(String(pr)); setMobileTab('trade'); }}
                sizeUnit={base}
              />
              <div className="border-t border-[color:var(--ibo-border)] overflow-hidden">
                <OptionsRecentTrades trades={trades} sizeUnit={base} />
              </div>
            </div>
          )}
        </div>
        {blotter}
      </div>

      {/* Desktop — Delta MOVE layout */}
      <div className="hidden md:flex md:flex-col" style={{ minHeight: 'calc(100dvh - 4rem)' }}>
        {header}

        <div className="flex min-h-[calc(100dvh-11rem)] h-[calc(100dvh-11rem)] max-h-[960px] shrink-0">
          <div className="flex-1 min-w-0 min-h-0 relative overflow-hidden border-r border-[color:var(--ibo-border)]">
            <OptionsChartPanel
              selected={selected}
              underlying={underlying}
              referenceIndex={indexPx}
              depth={depth}
              onBuy={(px) => { setSide('buy'); setOtype('limit'); setPrice(String(px)); }}
              onSell={(px) => { setSide('sell'); setOtype('limit'); setPrice(String(px)); }}
            />
          </div>

          <div className="delta-trade-col delta-trade-book flex flex-col shrink-0 border-r border-[color:var(--ibo-border)] min-h-0 bg-transparent">
            <div className="flex-[2.2] min-h-0 overflow-hidden">
              <OptionsOrderBook
                depth={depth}
                midPrice={mark || null}
                markIv={selected?.market?.iv}
                onPriceClick={(pr) => { setOtype('limit'); setPrice(String(pr)); }}
                sizeUnit={base}
              />
            </div>
            <div className="flex-[0.65] min-h-[160px] max-h-[260px] border-t border-[color:var(--ibo-border)] overflow-hidden">
              <OptionsRecentTrades trades={trades} sizeUnit={base} />
            </div>
          </div>

          <div className="delta-trade-col delta-trade-ticket flex flex-col shrink-0 overflow-hidden bg-transparent">
            <div className="flex-1 min-h-0 overflow-y-auto scrollbar-hide">
              <MoveTradeTicket {...ticketProps} />
            </div>
          </div>
        </div>

        {blotter}
      </div>
    </div>
  );
}
