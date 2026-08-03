/**
 * FuturesTradePage — Delta-inspired perpetual terminal.
 *
 * Single viewport (calc(100vh - navbar)):
 *   ┌─ Market header (symbol · price · 24h stats · funding) ─────────────┐
 *   ├─ Chart (+ tabs) ──┬─ Order book / trades ──┬─ Long/Short form ─────┤
 *   ├─ Positions | Open orders | History | … (pinned strip) ─────────────┤
 *   └────────────────────────────────────────────────────────────────────┘
 */
import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { ChevronDown, ChevronRight, Globe, RefreshCw } from 'lucide-react';
import { COIN_ICONS } from '@/services/marketApi';
import { FuturesProvider, useFutures } from '@/context/FuturesContext';
import { futuresApi } from '@/services/futuresApi';
import { useAuth } from '@/context/AuthContext';
import FuturesChart from '@/components/futures/FuturesChart';
import FuturesOrderBook from '@/components/futures/FuturesOrderBook';
import FuturesRecentTrades from '@/components/futures/FuturesRecentTrades';
import FuturesTradeForm from '@/components/futures/FuturesTradeForm';
import FuturesPositions from '@/components/futures/FuturesPositions';
import FuturesOpenOrders from '@/components/futures/FuturesOpenOrders';
import FuturesOrderHistory from '@/components/futures/FuturesOrderHistory';
import FuturesWalletPanel from '@/components/futures/FuturesWalletPanel';

const DEFAULT_SYMBOL = 'BTCUSDT-PERP';
const ACCENT = '#FE6C02';

const fmtPrice = (v) => {
  const n = Number(v);
  if (!n) return '—';
  return n >= 1000
    ? n.toLocaleString(undefined, { maximumFractionDigits: 1 })
    : n >= 1
      ? n.toFixed(2)
      : n.toFixed(6);
};

const fmtCompactUsd = (v) => {
  const n = Number(v);
  if (!n) return '—';
  if (n >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
};

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

/** Countdown to next 8h UTC funding window (00:00 / 08:00 / 16:00). */
function useFundingCountdown() {
  const [label, setLabel] = useState('—');
  useEffect(() => {
    const tick = () => {
      const now = new Date();
      const utcH = now.getUTCHours();
      const nextH = utcH < 8 ? 8 : utcH < 16 ? 16 : 24;
      const target = Date.UTC(
        now.getUTCFullYear(),
        now.getUTCMonth(),
        now.getUTCDate() + (nextH === 24 ? 1 : 0),
        nextH % 24,
        0,
        0,
      );
      let sec = Math.max(0, Math.floor((target - now.getTime()) / 1000));
      const h = String(Math.floor(sec / 3600)).padStart(2, '0');
      sec %= 3600;
      const m = String(Math.floor(sec / 60)).padStart(2, '0');
      const s = String(sec % 60).padStart(2, '0');
      setLabel(`${h}h:${m}m:${s}s`);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);
  return label;
}

function PairDropdown({ activeSymbol, symbols }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null);
  const ref = useRef(null);

  const meta = symbols.find((s) => s.symbol === activeSymbol);
  const base = meta?.base || (activeSymbol || '').split('USDT')[0] || '';
  const icon = COIN_ICONS[base];
  const switchTo = (sym) => {
    navigate(`/futures/${sym}`);
    setOpen(false);
  };

  return (
    <>
      <div ref={ref} className="relative shrink-0">
        <button
          type="button"
          onClick={() => {
            if (!open && ref.current) {
              const r = ref.current.getBoundingClientRect();
              setPos({ top: r.bottom + 4, left: Math.min(r.left, window.innerWidth - 310) });
            }
            setOpen((v) => !v);
          }}
          className="flex items-center gap-2 px-2.5 py-1.5 rounded-md border border-[color:var(--ibo-border-solid)]
            bg-[color:var(--ibo-card)] hover:border-[#FE6C02]/40 transition-colors"
        >
          {icon ? <img src={icon} alt={base} className="w-5 h-5 rounded-full" /> : null}
          <span className="text-[14px] font-bold text-[color:var(--ibo-ink)] tracking-tight">
            {base}USD
          </span>
          <ChevronDown
            size={14}
            className={`text-[color:var(--ibo-muted)] transition-transform ${open ? 'rotate-180' : ''}`}
          />
        </button>
      </div>
      {open && pos && createPortal(
        <>
          <div className="fixed inset-0 z-[9998]" onClick={() => setOpen(false)} />
          <div
            style={{
              position: 'fixed',
              top: pos.top,
              left: pos.left,
              width: Math.min(300, window.innerWidth - 16),
              background: 'var(--ibo-card)',
              border: '1px solid var(--ibo-border-solid)',
              borderRadius: 10,
              boxShadow: 'var(--ibo-shadow)',
              zIndex: 9999,
              maxHeight: '65vh',
              overflowY: 'auto',
              padding: '4px 0',
            }}
            className="scrollbar-hide"
          >
            <div className="px-3 pt-2 pb-1 text-[10px] uppercase tracking-widest text-white/45 font-bold">
              Perpetuals
            </div>
            {symbols.map((s) => {
              const active = s.symbol === activeSymbol;
              return (
                <button
                  key={s.symbol}
                  type="button"
                  onClick={() => switchTo(s.symbol)}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors
                    ${active ? 'bg-[#FE6C02]/10 text-[#FE6C02]' : 'text-[color:var(--ibo-ink)] hover:bg-white/5'}`}
                >
                  {COIN_ICONS[s.base] ? (
                    <img src={COIN_ICONS[s.base]} alt={s.base} className="w-6 h-6 rounded-full" />
                  ) : null}
                  <div className="flex-1">
                    <div className="font-bold text-[13px]">{s.base}USD</div>
                    <div className="text-[10px] text-white/45">Up to {s.max_leverage}×</div>
                  </div>
                </button>
              );
            })}
            <div className="border-t border-white/5 mt-1">
              <Link
                to="/markets"
                onClick={() => setOpen(false)}
                className="flex items-center gap-2 px-3 py-2.5 text-white/55 text-sm hover:bg-white/5"
              >
                <Globe size={14} /> All markets
              </Link>
            </div>
          </div>
        </>,
        document.body,
      )}
    </>
  );
}

function BottomPanel() {
  const [tab, setTab] = useState('positions');
  const { positions, openOrders, orderHistory } = useFutures();

  const TABS = [
    { id: 'positions', label: 'Positions', count: positions.length },
    { id: 'open', label: 'Open Orders', count: openOrders.length },
    { id: 'history', label: 'Order History', count: orderHistory.length },
    { id: 'wallet', label: 'Risk & Margin Details' },
  ];

  return (
    <div className="flex flex-col min-h-[300px] bg-transparent border-t border-[color:var(--ibo-border)]">
      <div className="flex items-center shrink-0 overflow-x-auto scrollbar-hide border-b border-[color:var(--ibo-border)] px-1 h-[40px] sticky top-0 z-10 bg-[color:var(--ibo-bg)]">
        {TABS.map((t) => {
          const on = tab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className="relative h-full px-3.5 text-[12px] font-semibold whitespace-nowrap transition-colors"
              style={{ color: on ? ACCENT : 'var(--ibo-muted)' }}
            >
              {t.label}
              {t.count > 0 ? (
                <span
                  className="ml-1.5 text-[10px] font-bold px-1.5 py-0.5 rounded"
                  style={{ background: 'rgba(254, 108, 2,0.15)', color: ACCENT }}
                >
                  {t.count}
                </span>
              ) : null}
              {on ? (
                <span
                  className="absolute left-2 right-2 bottom-0 h-0.5 rounded-full"
                  style={{ background: ACCENT }}
                />
              ) : null}
            </button>
          );
        })}
        <div className="ml-auto pr-3 hidden sm:flex items-center gap-1.5 text-[11px] text-[color:var(--ibo-muted)]">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
          Connected
        </div>
      </div>
      <div className="min-h-[260px]">
        {tab === 'positions' && <FuturesPositions />}
        {tab === 'open' && <FuturesOpenOrders />}
        {tab === 'history' && <FuturesOrderHistory />}
        {tab === 'wallet' && (
          <div className="p-3 max-w-md">
            <FuturesWalletPanel />
          </div>
        )}
      </div>
    </div>
  );
}

function MarketHeader({ funding }) {
  const { activeSymbol, symbols, markets, orderbook, recentTrades } = useFutures();
  const countdown = useFundingCountdown();
  const meta = symbols.find((s) => s.symbol === activeSymbol);
  const m = markets[activeSymbol] || {};

  const mark = Number(m.mark_price || 0);
  const idx = Number(m.index_price || 0);
  const bestBid = Number(orderbook?.bids?.[0]?.price || 0);
  const bestAsk = Number(orderbook?.asks?.[0]?.price || 0);
  const last = Number(recentTrades?.[0]?.price || 0);
  const headline = last || mark || idx || bestAsk || bestBid || 0;
  const changePct = Number(m.change_pct);
  const isDown = Number.isFinite(changePct) ? changePct < 0 : null;

  const fundingPct = funding != null ? `${(funding * 100).toFixed(4)}%` : '—';

  return (
    <div
      className="delta-trade-header flex items-center gap-2 sm:gap-3 px-3 py-2 bg-[color:var(--ibo-bg)] shrink-0 overflow-x-auto scrollbar-hide"
      style={{ borderBottom: '1px solid var(--ibo-border)', zIndex: 40 }}
    >
      <PairDropdown activeSymbol={activeSymbol} symbols={symbols} />

      <div className="flex items-center gap-2 shrink-0 min-w-[7.5rem]">
        <span
          className={`font-mono font-bold text-[18px] sm:text-[20px] tabular-nums tracking-tight ${
            isDown == null ? 'text-[color:var(--ibo-ink)]' : isDown ? 'text-rose-400' : 'text-emerald-400'
          }`}
        >
          ${fmtPrice(headline)}
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
          valueClass={
            !Number.isFinite(changePct)
              ? ''
              : changePct >= 0
                ? 'text-emerald-400'
                : 'text-rose-400'
          }
        />
        <StatItem label="Index Price" value={idx ? fmtPrice(idx) : '—'} />
        <StatItem label="24h High" value={m.high_24h ? fmtPrice(m.high_24h) : '—'} />
        <StatItem label="24h Low" value={m.low_24h ? fmtPrice(m.low_24h) : '—'} />
        <StatItem label="24h Vol" value={fmtCompactUsd(m.volume_24h)} />
        <StatItem
          label="Funding / Countdown"
          value={`${fundingPct} / ${countdown}`}
          valueClass="text-[#FE6C02]"
        />
        <StatItem label="Max Lev" value={meta ? `${meta.max_leverage}×` : '—'} />
      </div>

      <button
        type="button"
        className="ml-auto hidden lg:inline-flex items-center gap-1 text-[12px] text-[color:var(--ibo-muted)] hover:text-[#FE6C02] shrink-0"
      >
        Contract Details <ChevronRight size={14} />
      </button>
    </div>
  );
}

function FuturesTradePageInner() {
  const { symbol: routeSym } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { symbols, activeSymbol, setActiveSymbol } = useFutures();

  const [funding, setFunding] = useState(null);
  const [mobileTab, setMobileTab] = useState('trade');
  const [obPriceSeed, setObPriceSeed] = useState({ symbol: '', price: '' });

  const onOrderBookPrice = useCallback(
    (px) => setObPriceSeed({ symbol: activeSymbol, price: px }),
    [activeSymbol],
  );
  const onOrderBookPriceMobile = useCallback(
    (px) => {
      setObPriceSeed({ symbol: activeSymbol, price: px });
      setMobileTab('trade');
    },
    [activeSymbol],
  );

  useEffect(() => {
    const sym = routeSym ? routeSym.toUpperCase() : DEFAULT_SYMBOL;
    if (sym !== activeSymbol) setActiveSymbol(sym);
  }, [routeSym]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!symbols.length) return;
    if (!routeSym) {
      const target = symbols.find((s) => s.symbol === DEFAULT_SYMBOL) || symbols[0];
      if (target) navigate(`/futures/${target.symbol}`, { replace: true });
      return;
    }
    const upper = routeSym.toUpperCase();
    const found = symbols.find((s) => s.symbol === upper);
    if (!found) {
      const target = symbols.find((s) => s.symbol === DEFAULT_SYMBOL) || symbols[0];
      if (target) navigate(`/futures/${target.symbol}`, { replace: true });
    } else if (found.symbol !== activeSymbol) {
      setActiveSymbol(found.symbol);
    }
  }, [routeSym, symbols, navigate]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    let cancelled = false;
    if (!activeSymbol) return undefined;
    futuresApi
      .fundingRate(activeSymbol)
      .then((data) => {
        if (!cancelled) setFunding(data?.rate ?? null);
      })
      .catch(() => {
        if (!cancelled) setFunding(null);
      });
    return () => {
      cancelled = true;
    };
  }, [activeSymbol]);

  const formProps = useMemo(
    () => ({ symbol: activeSymbol, limitPriceSeed: obPriceSeed }),
    [activeSymbol, obPriceSeed],
  );

  if (!activeSymbol) {
    return (
      <div className="flex items-center justify-center h-[calc(100vh-70px)] bg-[color:var(--ibo-bg)] text-white/40 text-sm gap-2">
        <RefreshCw size={14} className="animate-spin" /> Loading futures…
      </div>
    );
  }

  return (
    <div className="delta-trade bg-[color:var(--ibo-bg)] text-[color:var(--ibo-ink)]">
      {/* ═════════ MOBILE ═════════ */}
      <div className="flex flex-col md:hidden min-h-[calc(100vh-70px)]">
        <MarketHeader funding={funding} />
        <div style={{ height: 260 }} className="relative overflow-hidden border-b border-[color:var(--ibo-border)]">
          <FuturesChart symbol={activeSymbol} />
        </div>
        <div className="sticky top-0 z-10 flex bg-transparent border-b border-[color:var(--ibo-border)]">
          {[['trade', 'Trade'], ['book', 'Book'], ['wallet', 'Margin']].map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setMobileTab(id)}
              className={`flex-1 py-2.5 text-[12px] font-bold transition-colors ${
                mobileTab === id
                  ? 'text-[#FE6C02] border-b-2 border-[#FE6C02]'
                  : 'text-white/50 border-b-2 border-transparent'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="bg-[color:var(--ibo-bg)] min-h-[480px] p-2">
          {mobileTab === 'trade' && <FuturesTradeForm {...formProps} />}
          {mobileTab === 'wallet' && <FuturesWalletPanel />}
          {mobileTab === 'book' && (
            <div className="grid grid-rows-2 gap-2 h-[520px]">
              <FuturesOrderBook onPriceClick={onOrderBookPriceMobile} />
              <FuturesRecentTrades />
            </div>
          )}
        </div>
        <div className="min-h-[28vh]">
          <BottomPanel />
        </div>
      </div>

      {/* ═════════ DESKTOP — single viewport ═════════ */}
      <div
        className="hidden md:flex md:flex-col"
        style={{ minHeight: 'calc(100dvh - 4rem)' }}
      >
        <MarketHeader funding={funding} />

        <div className="flex min-h-[480px] h-[min(62vh,720px)] shrink-0">
          {/* Chart */}
          <div className="flex-1 min-w-0 min-h-0 relative overflow-hidden border-r border-[color:var(--ibo-border)]">
            <FuturesChart symbol={activeSymbol} funding={funding} />
          </div>

          {/* Order book (top) + recent trades (bottom) — Delta center column */}
          <div className="delta-trade-col delta-trade-book flex flex-col shrink-0 border-r border-[color:var(--ibo-border)] min-h-0 bg-transparent">
            <div className="flex-[1.2] min-h-0 overflow-hidden">
              <FuturesOrderBook onPriceClick={onOrderBookPrice} />
            </div>
            <div className="flex-[0.85] min-h-[160px] max-h-[280px] border-t border-[color:var(--ibo-border)] overflow-hidden">
              <FuturesRecentTrades />
            </div>
          </div>

          {/* Order ticket */}
          <div className="delta-trade-col delta-trade-ticket flex flex-col shrink-0 overflow-hidden bg-transparent">
            <div className="flex-1 overflow-y-auto scrollbar-hide">
              <FuturesTradeForm {...formProps} />
              {!user ? (
                <p className="text-[11px] text-white/45 text-center py-3 px-3">
                  <Link to="/login" className="text-[#FE6C02] font-semibold hover:underline">
                    Sign in
                  </Link>{' '}
                  to trade futures
                </p>
              ) : null}
            </div>
          </div>
        </div>

        {/* Bottom orders / positions table — page scrolls so rows are fully visible */}
        <div className="min-h-[300px] border-t border-[color:var(--ibo-border)]">
          <BottomPanel />
        </div>
      </div>
    </div>
  );
}

export default function FuturesTradePage() {
  const { symbol: urlSym } = useParams();
  const initialSymbol = urlSym ? urlSym.toUpperCase() : DEFAULT_SYMBOL;
  return (
    <FuturesProvider initialSymbol={initialSymbol}>
      <FuturesTradePageInner />
    </FuturesProvider>
  );
}
