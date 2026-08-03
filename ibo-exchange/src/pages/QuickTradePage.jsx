/**
 * QuickTradePage — full-screen instant market-order interface.
 *
 * Layout:
 * ┌──────────────────────────────────────────────────────────────────┐
 * │  Page header: title + subtitle                                    │
 * ├────────────────────────────┬─────────────────────────────────────┤
 * │  LEFT — Pair grid          │  RIGHT — Order form + Recent fills   │
 * │  Live price cards for all  │  Large buy/sell form, balance,       │
 * │  supported pairs. Click    │  % presets, summary, submit CTA.    │
 * │  to switch.                │  Recent trade history below.         │
 * └────────────────────────────┴─────────────────────────────────────┘
 */
import { useState, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { Link, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  TrendingUp, TrendingDown, Zap, AlertCircle, CheckCircle,
  Loader2, RefreshCw, Wallet, Shield, BarChart2,
  ArrowRight, Star, ChevronDown, Search, X,
} from 'lucide-react';
import { COIN_ICONS, PAIRS, exchangeWsPath, normalizeMarketsList } from '@/services/marketApi';
import { useAuth, authFetch } from '@/context/AuthContext';
import { exchangeApiOrigin } from '@/lib/apiBase';
import {
  validateMarketQuickOrder,
  MIN_BASE_AMOUNT,
  MIN_ORDER_VALUE_USDT,
  MARKET_BUY_LOCK_BUFFER,
} from '@/lib/tradeRules';

const API  = exchangeApiOrigin(import.meta.env.VITE_BACKEND_URL);
const FEE  = 0.001;
const PCTS = [{ label: '25%', v: 25 }, { label: '50%', v: 50 }, { label: '75%', v: 75 }, { label: 'MAX', v: 100 }];

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmtPrice(n) {
  const v = parseFloat(n);
  if (!v) return '—';
  if (v >= 10000) return v.toLocaleString(undefined, { maximumFractionDigits: 2 });
  if (v >= 1)     return v.toFixed(4);
  return v.toFixed(6);
}
function fmtCompact(n) {
  const v = parseFloat(n);
  if (!v) return '—';
  if (v >= 1e9) return (v / 1e9).toFixed(2) + 'B';
  if (v >= 1e6) return (v / 1e6).toFixed(2) + 'M';
  if (v >= 1e3) return (v / 1e3).toFixed(2) + 'K';
  return v.toFixed(2);
}

// ── Pair card ─────────────────────────────────────────────────────────────────
function PairCard({ pair, ticker, isSelected, onSelect }) {
  const base    = pair.base;
  const icon    = COIN_ICONS[base];
  const price   = parseFloat(ticker?.price ?? 0);
  const pct     = parseFloat(ticker?.priceChangePercent ?? 0);
  const isUp    = pct >= 0;

  return (
    <motion.button
      layout
      type="button"
      onClick={() => onSelect(pair.symbol)}
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.98 }}
      className="font-ui"
      style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '10px 12px', borderRadius: 12, cursor: 'pointer',
        width: '100%', textAlign: 'left', border: 'none',
        background: isSelected
          ? 'linear-gradient(135deg, rgba(91,184,255,0.14), rgba(14,164,171,0.08))'
          : 'var(--ibo-card)',
        borderStyle: 'solid', borderWidth: 1,
        borderColor: isSelected ? 'rgba(91,184,255,0.5)' : 'var(--ibo-border-solid)',
        boxShadow: isSelected ? '0 8px 24px rgba(91,184,255,0.12)' : 'var(--ibo-shadow)',
        transition: 'border-color 0.2s, background 0.2s, box-shadow 0.2s',
        fontFamily: "Inter, 'Plus Jakarta Sans', system-ui, sans-serif",
      }}
    >
      <div style={{ position: 'relative', flexShrink: 0 }}>
        {icon
          ? <img src={icon} alt={base} style={{ width: 28, height: 28, borderRadius: '50%' }} />
          : <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'rgba(91,184,255,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, color: '#5BB8FF', fontSize: 11 }}>{base[0]}</div>
        }
        {isSelected && (
          <div style={{ position: 'absolute', bottom: -1, right: -1, width: 10, height: 10, borderRadius: '50%', background: '#22c55e', border: '2px solid var(--ibo-card)' }} />
        )}
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: isSelected ? '#5BB8FF' : 'var(--ibo-ink)', lineHeight: 1.15, fontFamily: "Inter, 'Plus Jakarta Sans', system-ui, sans-serif" }}>
          {base}<span style={{ color: 'var(--ibo-muted)', fontWeight: 500 }}>/USDT</span>
        </div>
        <div style={{ fontSize: 10, color: 'var(--ibo-muted)', marginTop: 2, fontWeight: 500, fontFamily: "Inter, 'Plus Jakarta Sans', system-ui, sans-serif" }}>
          Vol {fmtCompact(ticker?.volume)} {base}
        </div>
      </div>

      <div style={{ textAlign: 'right', flexShrink: 0 }}>
        {price > 0 ? (
          <>
            <div style={{ fontSize: 13, fontWeight: 700, fontFamily: "Inter, 'Plus Jakarta Sans', system-ui, sans-serif", color: 'var(--ibo-ink)', lineHeight: 1.15, fontVariantNumeric: 'tabular-nums' }}>
              ${fmtPrice(price)}
            </div>
            <div style={{
              fontSize: 11, fontWeight: 700, marginTop: 2,
              color: isUp ? '#22c55e' : '#ef4444',
              fontFamily: "Inter, 'Plus Jakarta Sans', system-ui, sans-serif",
            }}>
              {isUp ? '▲' : '▼'} {isUp ? '+' : ''}{pct.toFixed(2)}%
            </div>
          </>
        ) : (
          <div style={{ width: 64, height: 24, background: 'var(--ibo-elevated)', borderRadius: 6 }} className="animate-pulse" />
        )}
      </div>
    </motion.button>
  );
}

// ── Recent fills ──────────────────────────────────────────────────────────────
const ORDER_FMT = iso => new Date(iso).toLocaleString('en-US', {
  month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
});

function RecentFills() {
  const { user, orderHistory, ordersLoading, fetchOrders } = useAuth();

  const last5 = orderHistory.slice(0, 5);

  if (!user) return null;

  return (
    <div style={{
      marginTop: 16, borderRadius: 14, overflow: 'hidden',
      border: '1px solid var(--ibo-border-solid)',
      background: 'var(--ibo-card)',
      boxShadow: 'var(--ibo-shadow)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', borderBottom: '1px solid var(--ibo-border)' }}>
        <p style={{ fontSize: 12, fontWeight: 700, color: 'var(--ibo-ink)' }}>Recent Fills</p>
        <button onClick={fetchOrders} disabled={ordersLoading}
          style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--ibo-muted)', opacity: ordersLoading ? 0.4 : 1 }}
          className="hover:text-white transition-colors">
          <RefreshCw size={13} className={ordersLoading ? 'animate-spin' : ''} />
        </button>
      </div>
      {last5.length === 0 ? (
        <div style={{ padding: '18px 14px', textAlign: 'center', color: 'var(--ibo-muted)', fontSize: 12 }}>
          No recent fills. Place a trade to get started.
        </div>
      ) : last5.map(o => (
        <div key={o.id} style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '9px 14px', borderBottom: '1px solid var(--ibo-border)',
          transition: 'background 0.15s',
        }} className="hover:bg-white/[.03]">
          <div style={{
            width: 28, height: 28, borderRadius: 7, flexShrink: 0,
            background: o.side === 'buy' ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            {o.side === 'buy' ? <TrendingUp size={13} color="#22c55e" /> : <TrendingDown size={13} color="#ef4444" />}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--ibo-ink)' }}>
              {o.symbol.replace('USDT', '/USDT')}
            </div>
            <div style={{ fontSize: 10, color: 'var(--ibo-muted)', marginTop: 1 }}>
              {ORDER_FMT(o.created_at)}
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{
              fontSize: 12, fontWeight: 700, fontFamily: 'Inter, Plus Jakarta Sans, sans-serif',
              color: o.side === 'buy' ? '#22c55e' : '#ef4444',
            }}>
              {o.side === 'buy' ? '+' : '-'}{o.filled.toFixed(4)}
            </div>
            <div style={{ fontSize: 10, color: 'var(--ibo-muted)', fontFamily: 'Inter, Plus Jakarta Sans, sans-serif' }}>
              {o.avg_price > 0 ? `@ $${fmtPrice(o.avg_price)}` : 'MKT'}
            </div>
          </div>
          <div style={{
            fontSize: 10, fontWeight: 600,
            color: o.status === 'filled' ? '#22c55e' : 'var(--ibo-muted)',
            background: o.status === 'filled' ? 'rgba(34,197,94,0.1)' : 'var(--ibo-elevated)',
            padding: '2px 6px', borderRadius: 5, flexShrink: 0,
          }}>
            {o.status}
          </div>
        </div>
      ))}
      <div style={{ padding: '10px 14px', textAlign: 'center' }}>
        <Link to="/trade/IBOUSDT" style={{ fontSize: 12, color: '#5BB8FF', fontWeight: 600, textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 4 }}
          className="hover:opacity-80">
          View full order history <ArrowRight size={12} />
        </Link>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function QuickTradePage() {
  const navigate = useNavigate();
  const { user, balance, kyc, fetchOrders, fetchWallet, fetchLiveSpotPositions } = useAuth();

  const [symbol,        setSymbol]        = useState('BTCUSDT');
  const [tickers,       setTickers]       = useState({});
  const [side,          setSide]          = useState('buy');
  const [amount,        setAmount]        = useState('');
  const [placing,       setPlacing]       = useState(false);
  const [result,        setResult]        = useState(null);
  const [mobileDropOpen, setMobileDropOpen] = useState(false);
  const [sheetSearch,   setSheetSearch]   = useState('');
  const [favs,          setFavs]          = useState(() => {
    try { return JSON.parse(localStorage.getItem('iboex_qt_favs') || '[]'); } catch { return []; }
  });

  const base    = symbol.replace('USDT', '');
  const icon    = COIN_ICONS[base];
  const ticker  = tickers[symbol];
  const price   = parseFloat(ticker?.price ?? 0);
  const pct     = parseFloat(ticker?.priceChangePercent ?? 0);
  const isUp    = pct >= 0;

  // Available balances
  const availUSDT = parseFloat(balance?.USDT  ?? 0);
  const availBase = parseFloat(balance?.[base] ?? 0);
  const maxBase   = side === 'buy' ? (price > 0 ? availUSDT / price : 0) : availBase;

  // Order math
  const qty     = parseFloat(amount) || 0;
  const cost    = qty * price;
  const fee     = cost * FEE;
  const receive = side === 'buy' ? qty - qty * FEE : cost - fee;

  const kycBlocked = user && kyc?.status !== 'approved';

  const orderCheck = useMemo(
    () =>
      validateMarketQuickOrder({
        symbol,
        side,
        amountStr: amount,
        price,
        balanceUSDT: availUSDT,
        balanceBase: availBase,
        baseAsset: base,
        userLoggedIn: !!user,
      }),
    [symbol, side, amount, price, availUSDT, availBase, base, user],
  );

  useEffect(() => {
    const url = exchangeWsPath('/api/ws/exchange/markets');
    let closed = false;
    let reconnectTimer = null;
    let ws = null;
    const connect = () => {
      if (closed) return;
      ws = new WebSocket(url);
      ws.onmessage = (ev) => {
        try {
          const j = JSON.parse(ev.data);
          if (j.type === 'exchange_markets' && Array.isArray(j.markets)) {
            const all = normalizeMarketsList(j.markets);
            const map = {};
            all.forEach(t => { map[t.symbol] = t; });
            setTickers(map);
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

  const applyPct = pct => {
    const max = maxBase * (pct / 100);
    setAmount(max > 0 ? max.toFixed(base === 'BTC' ? 6 : base === 'ETH' ? 5 : 4) : '');
  };

  const handleSelect = sym => {
    setSymbol(sym);
    setAmount('');
    setResult(null);
    setMobileDropOpen(false);
    setSheetSearch('');
  };

  const toggleFav = sym => {
    const next = favs.includes(sym) ? favs.filter(f => f !== sym) : [...favs, sym];
    setFavs(next);
    localStorage.setItem('iboex_qt_favs', JSON.stringify(next));
  };

  const handleSubmit = async () => {
    if (!user) {
      if (!orderCheck.ok && orderCheck.message) {
        setResult({ ok: false, error: orderCheck.message });
        return;
      }
      navigate('/login');
      return;
    }
    if (kycBlocked) {
      setResult({ ok: false, error: 'KYC verification required before trading' });
      return;
    }
    if (!orderCheck.ok) {
      setResult({ ok: false, error: orderCheck.message || 'Check your order details.' });
      return;
    }

    setPlacing(true);
    setResult(null);
    try {
      const res  = await authFetch(`${API}/api/orders`, {
        method: 'POST',
        body: JSON.stringify({ symbol, side, type: 'market', amount: qty, price: 0 }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Order failed');
      setResult({ ok: true, order: data });
      setAmount('');
      await Promise.all([fetchOrders(), fetchWallet(), fetchLiveSpotPositions()]);
      setTimeout(() => setResult(null), 6000);
    } catch (err) {
      setResult({ ok: false, error: err.message });
      setTimeout(() => setResult(null), 7000);
    } finally { setPlacing(false); }
  };

  // Sort: favourites first, then rest
  const sortedPairs = [
    ...PAIRS.filter(p => favs.includes(p.symbol)),
    ...PAIRS.filter(p => !favs.includes(p.symbol)),
  ];

  // Sheet filtered list
  const sheetPairs = sheetSearch
    ? sortedPairs.filter(p => p.base.toLowerCase().includes(sheetSearch.toLowerCase()) || p.symbol.toLowerCase().includes(sheetSearch.toLowerCase()))
    : sortedPairs;

  return (
    <div className="ibo-page font-ui">
      {/* Soft brand wash */}
      <div className="fixed inset-0 pointer-events-none"
        style={{
          background:
            'radial-gradient(ellipse 70% 45% at 70% -5%, rgba(14,164,171,0.1), transparent 55%), radial-gradient(ellipse 50% 40% at 10% 20%, rgba(91,184,255,0.07), transparent 50%)',
        }} />

      {/* ══ MOBILE BOTTOM SHEET — pair selector ══════════════════════════ */}
      {mobileDropOpen && createPortal(
        <AnimatePresence>
          <motion.div key="backdrop"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            style={{ position: 'fixed', inset: 0, background: 'rgba(12,25,34,0.45)', zIndex: 9998 }}
            onClick={() => { setMobileDropOpen(false); setSheetSearch(''); }}
          />
          <motion.div key="sheet"
            initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 28, stiffness: 280 }}
            style={{
              position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 9999,
              background: 'var(--ibo-card)', borderRadius: '24px 24px 0 0',
              maxHeight: '82vh', display: 'flex', flexDirection: 'column',
              border: '1px solid var(--ibo-border-solid)',
              fontFamily: "Inter, 'Plus Jakarta Sans', system-ui, sans-serif",
            }}
            className="font-ui">
            {/* Sheet header */}
            <div style={{ padding: '14px 16px 10px', flexShrink: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                <p style={{ fontSize: 15, fontWeight: 700, color: 'var(--ibo-ink)' }}>Select Trading Pair</p>
                <button
                  onClick={() => { setMobileDropOpen(false); setSheetSearch(''); }}
                  style={{ background: 'var(--ibo-elevated)', border: 'none', borderRadius: 8, padding: '5px 7px', cursor: 'pointer', color: 'var(--ibo-muted)' }}>
                  <X size={16} />
                </button>
              </div>
              {/* Search */}
              <div style={{
                display: 'flex', alignItems: 'center', gap: 8,
                background: 'var(--ibo-elevated)', border: '1px solid var(--ibo-border-solid)',
                borderRadius: 10, padding: '8px 12px',
              }}>
                <Search size={14} color="var(--ibo-muted)" />
                <input
                  value={sheetSearch}
                  onChange={e => setSheetSearch(e.target.value)}
                  placeholder="Search pairs…"
                  autoFocus
                  style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', color: 'var(--ibo-ink)', fontSize: 13, fontWeight: 500 }}
                />
                {sheetSearch && (
                  <button onClick={() => setSheetSearch('')}
                    style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--ibo-muted)', padding: 0 }}>
                    <X size={13} />
                  </button>
                )}
              </div>
            </div>

            {/* Pair list */}
            <div style={{ overflowY: 'auto', flex: 1, padding: '0 8px 16px' }} className="scrollbar-hide">
              {sheetPairs.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '32px 16px', color: 'var(--ibo-muted)', fontSize: 12 }}>
                  No pairs found for "{sheetSearch}"
                </div>
              ) : sheetPairs.map(pair => {
                const b    = pair.base;
                const ico  = COIN_ICONS[b];
                const tk   = tickers[pair.symbol];
                const pr   = parseFloat(tk?.price ?? 0);
                const pc   = parseFloat(tk?.priceChangePercent ?? 0);
                const up   = pc >= 0;
                const isSel = symbol === pair.symbol;
                const isFav = favs.includes(pair.symbol);
                return (
                  <button key={pair.symbol}
                    onClick={() => handleSelect(pair.symbol)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 10,
                      width: '100%', padding: '10px 10px', borderRadius: 10,
                      border: 'none', cursor: 'pointer', textAlign: 'left',
                      background: isSel ? 'linear-gradient(135deg, rgba(91,184,255,0.14), rgba(14,164,171,0.08))' : 'transparent',
                      marginBottom: 1, transition: 'background 0.15s',
                    }}
                    className="hover:bg-white/[.04]">
                    {/* Icon */}
                    <div style={{ position: 'relative', flexShrink: 0 }}>
                      {ico
                        ? <img src={ico} alt={b} style={{ width: 32, height: 32, borderRadius: '50%' }} />
                        : <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'rgba(91,184,255,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, color: '#5BB8FF', fontSize: 12 }}>{b[0]}</div>
                      }
                      {isSel && <div style={{ position: 'absolute', bottom: 0, right: 0, width: 9, height: 9, borderRadius: '50%', background: '#22c55e', border: '2px solid var(--ibo-card)' }} />}
                    </div>
                    {/* Name */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: isSel ? '#5BB8FF' : 'var(--ibo-ink)', lineHeight: 1.15, fontFamily: "Inter, 'Plus Jakarta Sans', system-ui, sans-serif" }}>
                        {b}<span style={{ color: 'var(--ibo-muted)', fontWeight: 500, fontSize: 12 }}>/USDT</span>
                      </div>
                      <div style={{ fontSize: 10, color: 'var(--ibo-muted)', marginTop: 2, fontWeight: 500 }}>
                        Vol {fmtCompact(tk?.volume)} {b}
                      </div>
                    </div>
                    {/* Price + % */}
                    <div style={{ textAlign: 'right', flexShrink: 0 }}>
                      {pr > 0 ? (
                        <>
                          <div style={{ fontSize: 13, fontWeight: 700, fontFamily: 'Inter, Plus Jakarta Sans, sans-serif', color: 'var(--ibo-ink)', lineHeight: 1.15, fontVariantNumeric: 'tabular-nums' }}>
                            ${fmtPrice(pr)}
                          </div>
                          <div style={{ fontSize: 11, fontWeight: 700, marginTop: 2, color: up ? '#22c55e' : '#ef4444' }}>
                            {up ? '▲ +' : '▼ '}{pc.toFixed(2)}%
                          </div>
                        </>
                      ) : (
                        <div style={{ width: 64, height: 24, background: 'var(--ibo-elevated)', borderRadius: 6 }} className="animate-pulse" />
                      )}
                    </div>
                    {/* Fav star */}
                    <button
                      onClick={e => { e.stopPropagation(); toggleFav(pair.symbol); }}
                      style={{ background: 'transparent', border: 'none', cursor: 'pointer', flexShrink: 0, padding: '4px 2px', opacity: isFav ? 1 : 0.35, transition: 'opacity 0.15s' }}>
                      <Star size={13} color="#5BB8FF" fill={isFav ? '#5BB8FF' : 'none'} />
                    </button>
                  </button>
                );
              })}
            </div>
          </motion.div>
        </AnimatePresence>,
        document.body
      )}

      <div className="relative z-10 w-full px-4 sm:px-5 md:px-6 lg:px-8 xl:px-10 2xl:px-12 py-4 sm:py-5">

        {/* ── Page header ─────────────────────────────────────────────────── */}
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
              style={{ background: 'linear-gradient(135deg, #0EA4AB, #5BB8FF)', boxShadow: '0 6px 14px rgba(14,164,171,0.22)' }}>
              <Zap size={15} color="#050a1a" />
            </div>
            <div>
              <h1 className="text-[17px] sm:text-lg font-bold text-[color:var(--ibo-ink)] leading-none font-ui">Quick Trade</h1>
              <p className="text-[color:var(--ibo-muted)] text-[11px] mt-0.5">
                Instant market orders · 0.1% fee
              </p>
            </div>
          </div>
          <Link to="/trade/IBOUSDT"
            className="font-ui flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-semibold
              text-[color:var(--ibo-ink)] hover:text-[color:var(--ibo-ink)] transition-colors border border-[color:var(--ibo-border-solid)]
              bg-[color:var(--ibo-card)] hover:border-[rgba(91,184,255,0.45)]">
            <BarChart2 size={13} /> Advanced
          </Link>
        </div>

        {/* ── MOBILE pair selector button (< lg) ──────────────────────────── */}
        <button
          onClick={() => setMobileDropOpen(true)}
          className="lg:hidden w-full flex items-center gap-3 p-3 rounded-xl mb-4 active:scale-[.98] transition-transform"
          style={{ background: 'var(--ibo-card)', border: '1px solid var(--ibo-border-solid)', boxShadow: 'var(--ibo-shadow)' }}>
          {icon
            ? <img src={icon} alt={base} style={{ width: 32, height: 32, borderRadius: '50%', flexShrink: 0 }} />
            : <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'rgba(91,184,255,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, color: '#5BB8FF', fontSize: 12, flexShrink: 0 }}>{base[0]}</div>
          }
          <div style={{ flex: 1, textAlign: 'left', minWidth: 0 }}>
            <p style={{ fontSize: 14, fontWeight: 700, color: 'var(--ibo-ink)', lineHeight: 1.15 }}>
              {base}<span style={{ color: 'var(--ibo-muted)', fontWeight: 500, fontSize: 12 }}>/USDT</span>
            </p>
            {price > 0 && (
              <p style={{ fontSize: 12, fontWeight: 700, marginTop: 2, color: isUp ? '#22c55e' : '#ef4444', fontFamily: 'Inter, Plus Jakarta Sans, sans-serif' }}>
                ${fmtPrice(price)} &nbsp;{isUp ? '▲ +' : '▼ '}{pct.toFixed(2)}%
              </p>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
            <span style={{ fontSize: 11, color: 'var(--ibo-muted)', fontWeight: 500 }}>Change</span>
            <ChevronDown size={16} color="#5BB8FF" />
          </div>
        </button>

        {/* ── Two-column layout ────────────────────────────────────────────── */}
        <div className="flex flex-col lg:flex-row gap-4 items-start">

          {/* LEFT — Pair selector grid (desktop only, lg+) ─────────────────── */}
          <div className="hidden lg:block w-[320px] xl:w-[360px] flex-shrink-0 space-y-1.5">
            <p className="text-[10px] font-bold text-[color:var(--ibo-muted)] uppercase tracking-wider px-1 mb-2 font-ui">
              Select Pair
            </p>
            {sortedPairs.map(pair => (
              <div key={pair.symbol} style={{ position: 'relative' }}>
                <PairCard
                  pair={pair}
                  ticker={tickers[pair.symbol]}
                  isSelected={symbol === pair.symbol}
                  onSelect={handleSelect}
                />
                <button
                  onClick={e => { e.stopPropagation(); toggleFav(pair.symbol); }}
                  style={{
                    position: 'absolute', top: 8, right: 8,
                    background: 'transparent', border: 'none', cursor: 'pointer',
                    opacity: favs.includes(pair.symbol) ? 1 : 0.3,
                    transition: 'opacity 0.15s',
                  }}
                  className="hover:opacity-100">
                  <Star size={12} color="#5BB8FF" fill={favs.includes(pair.symbol) ? '#5BB8FF' : 'none'} />
                </button>
              </div>
            ))}
          </div>

          {/* RIGHT — Order form ──────────────────────────────────────────── */}
          <div className="flex-1 min-w-0 w-full">

            {/* Selected pair hero — hidden on mobile (info is in dropdown button above) */}
            <div className="hidden sm:block rounded-xl p-4 mb-4"
              style={{ background: 'var(--ibo-card)', border: '1px solid var(--ibo-border-solid)', boxShadow: 'var(--ibo-shadow)' }}>
              <div className="flex items-center gap-3 mb-3">
                {icon && <img src={icon} alt={base} className="w-9 h-9 rounded-full" />}
                <div className="flex-1 min-w-0">
                  <h2 className="text-[16px] font-bold text-[color:var(--ibo-ink)] leading-none font-ui">
                    {base}<span className="text-[color:var(--ibo-muted)] font-semibold text-[13px]">/USDT</span>
                  </h2>
                  <p className="text-[11px] text-[color:var(--ibo-muted)] mt-1 font-medium">Spot · Market Order</p>
                </div>
                <div className="text-right flex-shrink-0">
                  {price > 0 ? (
                    <>
                      <p className="text-[20px] font-bold font-mono tabular-nums leading-none"
                        style={{ color: isUp ? '#22c55e' : '#ef4444' }}>
                        ${fmtPrice(price)}
                      </p>
                      <p className="text-[12px] font-semibold mt-1"
                        style={{ color: isUp ? '#22c55e' : '#ef4444' }}>
                        {isUp ? '▲ +' : '▼ '}{pct.toFixed(2)}% (24h)
                      </p>
                    </>
                  ) : (
                    <div className="space-y-2">
                      <div className="h-6 w-28 rounded-lg bg-white/5 animate-pulse" />
                      <div className="h-4 w-20 rounded bg-white/5 animate-pulse ml-auto" />
                    </div>
                  )}
                </div>
              </div>

              {/* 24h stats */}
              {ticker && (
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { label: '24h High', value: `$${fmtPrice(ticker.highPrice)}`, color: '#22c55e' },
                    { label: '24h Low',  value: `$${fmtPrice(ticker.lowPrice)}`,  color: '#ef4444' },
                    { label: '24h Vol',  value: `${fmtCompact(ticker.volume)} ${base}`, color: 'var(--ibo-ink)' },
                  ].map(s => (
                    <div key={s.label} className="rounded-lg p-2.5"
                      style={{ background: 'var(--ibo-elevated)', border: '1px solid var(--ibo-border-solid)' }}>
                      <p className="text-[10px] font-bold text-[color:var(--ibo-muted)] uppercase tracking-wider mb-0.5">{s.label}</p>
                      <p className="text-[13px] font-bold font-mono tabular-nums" style={{ color: s.color }}>{s.value}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Mobile compact stats bar */}
            {ticker && (
              <div className="sm:hidden flex items-center justify-between px-1 mb-3 gap-2">
                {[
                  { label: 'High', value: `$${fmtPrice(ticker.highPrice)}`, color: '#22c55e' },
                  { label: 'Low',  value: `$${fmtPrice(ticker.lowPrice)}`,  color: '#ef4444' },
                  { label: 'Vol',  value: fmtCompact(ticker.volume), color: 'var(--ibo-muted)' },
                ].map(s => (
                  <div key={s.label} style={{ textAlign: 'center', flex: 1 }}>
                    <p style={{ fontSize: 9, color: 'var(--ibo-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{s.label}</p>
                    <p style={{ fontSize: 12, fontWeight: 700, fontFamily: 'Inter, Plus Jakarta Sans, sans-serif', color: s.color, marginTop: 1 }}>{s.value}</p>
                  </div>
                ))}
              </div>
            )}

            {/* Order form card */}
            <div className="rounded-xl overflow-hidden"
              style={{ border: '1px solid var(--ibo-border-solid)', background: 'var(--ibo-card)', boxShadow: 'var(--ibo-shadow)' }}>

              {/* Buy / Sell tabs */}
              <div className="grid grid-cols-2 border-b border-[color:var(--ibo-border)]">
                {['buy', 'sell'].map(s => (
                  <button key={s} type="button" onClick={() => { setSide(s); setAmount(''); setResult(null); }}
                    className="font-ui py-2.5 font-bold text-[13px] tracking-wide transition-all border-b-2"
                    style={{
                      background: side === s
                        ? (s === 'buy' ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)')
                        : 'transparent',
                      color: side === s
                        ? (s === 'buy' ? '#22c55e' : '#ef4444')
                        : 'var(--ibo-muted)',
                      borderBottomColor: side === s
                        ? (s === 'buy' ? '#22c55e' : '#ef4444')
                        : 'transparent',
                      borderTopColor: 'transparent', borderLeftColor: 'transparent', borderRightColor: 'transparent',
                      cursor: 'pointer',
                      fontFamily: "Inter, 'Plus Jakarta Sans', system-ui, sans-serif",
                    }}>
                    {s === 'buy'
                      ? <span className="flex items-center justify-center gap-1.5"><TrendingUp size={14} /> Buy {base}</span>
                      : <span className="flex items-center justify-center gap-1.5"><TrendingDown size={14} /> Sell {base}</span>}
                  </button>
                ))}
              </div>

              <div className="p-3.5 sm:p-4 space-y-3.5">

                {/* Market price indicator */}
                <div className="flex items-center gap-3 p-2.5 sm:p-3 rounded-lg"
                  style={{ background: 'var(--ibo-elevated)', border: '1px solid var(--ibo-border-solid)' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p className="text-[10px] font-bold text-[color:var(--ibo-muted)] uppercase tracking-wider mb-0.5">Execution Price</p>
                    <p className="text-[14px] font-bold font-mono tabular-nums text-[color:var(--ibo-ink)]">
                      {price > 0 ? `$${fmtPrice(price)}` : '—'}
                    </p>
                  </div>
                  <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    <p className="text-[10px] font-bold text-[color:var(--ibo-muted)] uppercase tracking-wider mb-0.5">Type</p>
                    <p className="text-[12px] font-semibold text-[color:var(--ibo-ink)]">Market</p>
                  </div>
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-md flex-shrink-0"
                    style={{ background: 'rgba(34,197,94,0.12)', color: '#22c55e', border: '1px solid rgba(34,197,94,0.2)' }}>
                    ● LIVE
                  </span>
                </div>

                {/* Available balance */}
                <div className="flex items-center justify-between">
                  <span className="text-[12px] font-medium text-[color:var(--ibo-muted)] flex items-center gap-1.5">
                    <Wallet size={13} /> Available
                  </span>
                  <span className="text-[13px] font-bold font-mono tabular-nums text-[color:var(--ibo-ink)]">
                    {side === 'buy'
                      ? `${availUSDT.toLocaleString(undefined, { maximumFractionDigits: 2 })} USDT`
                      : `${availBase.toFixed(6)} ${base}`}
                  </span>
                </div>

                {/* Amount input */}
                <div>
                  <label className="block text-[11px] font-semibold text-[color:var(--ibo-muted)] mb-1">
                    Amount ({base})
                  </label>
                  <p className="text-[10px] text-[color:var(--ibo-muted)] mb-1.5 leading-relaxed">
                    Min {MIN_BASE_AMOUNT} {base} · Min order ${MIN_ORDER_VALUE_USDT.toFixed(2)} USDT · Buys lock ≈{' '}
                    {((MARKET_BUY_LOCK_BUFFER - 1) * 100).toFixed(1)}% above mark
                  </p>
                  <div className="flex items-center rounded-lg px-3 py-2.5 transition-colors"
                    style={{
                      background: 'var(--ibo-elevated)',
                      border: `1px solid ${
                        orderCheck.errors.amount || orderCheck.errors.balance || orderCheck.errors.total
                          ? 'rgba(239,68,68,0.45)'
                          : amount
                            ? 'rgba(91,184,255,0.45)'
                            : 'var(--ibo-border-solid)'
                      }`,
                    }}>
                    <input
                      type="number" min="0" step="any"
                      value={amount}
                      onChange={e => setAmount(e.target.value)}
                      placeholder="0.0000"
                      className="flex-1 bg-transparent outline-none font-semibold font-mono tabular-nums text-[14px]"
                      style={{ color: 'var(--ibo-ink)' }}
                    />
                    <span className="text-[12px] font-bold ml-2" style={{ color: 'var(--ibo-muted)' }}>{base}</span>
                  </div>
                  {(orderCheck.errors.amount || orderCheck.errors.balance || orderCheck.errors.total || orderCheck.errors.price || orderCheck.errors.symbol) && (
                    <p className="text-[11px] text-red-400 mt-1.5 font-medium">
                      {orderCheck.errors.amount
                        || orderCheck.errors.price
                        || orderCheck.errors.total
                        || orderCheck.errors.balance
                        || orderCheck.errors.symbol}
                    </p>
                  )}
                </div>

                {/* % presets */}
                <div className="grid grid-cols-4 gap-2">
                  {PCTS.map(({ label, v }) => (
                    <button
                      key={v}
                      type="button"
                      onClick={() => applyPct(v)}
                      className="font-ui h-8 text-[11px] font-semibold rounded-md transition-all
                        bg-[color:var(--ibo-elevated)] text-[color:var(--ibo-muted)]
                        border border-[color:var(--ibo-border-solid)]
                        hover:bg-[rgba(91,184,255,0.12)] hover:text-[#5BB8FF] hover:border-[rgba(91,184,255,0.4)]"
                    >
                      {label}
                    </button>
                  ))}
                </div>

                {/* Order summary */}
                {qty > 0 && (
                  <AnimatePresence>
                    <motion.div
                      initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
                      className="rounded-lg px-3 py-2.5 space-y-1.5"
                      style={{ background: 'var(--ibo-elevated)', border: '1px solid var(--ibo-border-solid)' }}>
                      {[
                        { label: 'Order Total', value: `$${cost.toLocaleString(undefined, { maximumFractionDigits: 2 })} USDT`, color: 'var(--ibo-ink)' },
                        { label: 'Fee (0.1%)',  value: `$${fee.toLocaleString(undefined, { maximumFractionDigits: 4 })} USDT`, color: '#0EA4AB' },
                      ].map(row => (
                        <div key={row.label} className="flex items-center justify-between text-[11px]">
                          <span className="font-medium text-[color:var(--ibo-muted)]">{row.label}</span>
                          <span className="font-semibold font-mono tabular-nums" style={{ color: row.color }}>{row.value}</span>
                        </div>
                      ))}
                      <div className="flex items-center justify-between pt-1.5 text-[12px]"
                        style={{ borderTop: '1px solid var(--ibo-border)' }}>
                        <span className="font-semibold text-[color:var(--ibo-ink)]">You Receive</span>
                        <span className="font-bold font-mono tabular-nums"
                          style={{ color: side === 'buy' ? '#22c55e' : '#ef4444' }}>
                          {side === 'buy'
                            ? `${receive.toFixed(base === 'BTC' ? 6 : 4)} ${base}`
                            : `$${receive.toLocaleString(undefined, { maximumFractionDigits: 2 })}`}
                        </span>
                      </div>
                    </motion.div>
                  </AnimatePresence>
                )}

                {/* KYC gate */}
                {kycBlocked && (
                  <div className="rounded-lg p-3 flex items-start gap-2.5"
                    style={{ background: 'rgba(14,164,171,0.08)', border: '1px solid rgba(14,164,171,0.22)' }}>
                    <Shield size={15} className="text-gold flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="text-[12px] font-bold text-gold-light mb-1">KYC Verification Required</p>
                      <p className="text-[11px] text-[color:var(--ibo-muted)] mb-2 leading-relaxed">
                        {kyc?.status === 'pending'
                          ? 'Your documents are under review. Trading will be enabled once approved.'
                          : 'Complete identity verification to start trading.'}
                      </p>
                      <Link to="/kyc"
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12px] font-bold text-gold-light hover:bg-gold/20 transition-colors"
                        style={{ background: 'rgba(14,164,171,0.12)', border: '1px solid rgba(14,164,171,0.25)' }}>
                        <Shield size={12} /> {kyc?.status === 'pending' ? 'Check Status' : 'Verify Now →'}
                      </Link>
                    </div>
                  </div>
                )}

                {/* Result feedback */}
                <AnimatePresence>
                  {result && (
                    <motion.div
                      initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                      className="rounded-lg p-3 flex items-start gap-2.5"
                      style={{
                        background: result.ok ? 'rgba(34,197,94,0.08)' : 'rgba(239,68,68,0.08)',
                        border: `1px solid ${result.ok ? 'rgba(34,197,94,0.25)' : 'rgba(239,68,68,0.25)'}`,
                      }}>
                      {result.ok ? <CheckCircle size={15} className="text-green-400 flex-shrink-0 mt-0.5" /> : <AlertCircle size={15} className="text-red-400 flex-shrink-0 mt-0.5" />}
                      <div>
                        {result.ok ? (
                          <>
                            <p className="text-[12px] font-bold text-green-400">
                              {result.order.status === 'filled' ? 'Order Filled Instantly!' : 'Order Placed!'}
                            </p>
                            <p className="text-[11px] text-[color:var(--ibo-muted)] mt-0.5 font-mono">
                              {result.order.side.toUpperCase()}{' '}
                              {result.order.filled > 0 ? result.order.filled.toFixed(6) : result.order.amount.toFixed(6)}{' '}
                              {base}
                              {result.order.avg_price > 0 && ` @ $${fmtPrice(result.order.avg_price)}`}
                            </p>
                          </>
                        ) : (
                          <p className="text-[12px] font-semibold text-red-400">{result.error}</p>
                        )}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* Submit */}
                {!user ? (
                  <div className="space-y-2 pt-0.5">
                    <p className="text-center text-[12px] text-[color:var(--ibo-muted)]">Sign in to start trading</p>
                    <div className="grid grid-cols-2 gap-2">
                      <Link to="/login"
                        className="font-ui flex items-center justify-center h-10 rounded-md font-bold text-[13px] transition-all"
                        style={{ background: 'linear-gradient(135deg, #0EA4AB, #5BB8FF)', color: '#050a1a' }}>
                        Log In
                      </Link>
                      <Link to="/register"
                        className="ibo-btn-outline font-ui flex items-center justify-center h-10 rounded-md font-bold text-[13px] transition-all">
                        Register Free
                      </Link>
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={handleSubmit}
                    disabled={placing || kycBlocked || !orderCheck.ok}
                    className="w-full h-11 rounded-md font-extrabold text-[14px] tracking-wide
                      transition-all active:scale-[.98] disabled:opacity-40 disabled:cursor-not-allowed"
                    style={{
                      background: placing || kycBlocked || !orderCheck.ok
                        ? 'var(--ibo-elevated)'
                        : side === 'buy'
                          ? 'linear-gradient(135deg, #16a34a, #22c55e)'
                          : 'linear-gradient(135deg, #dc2626, #ef4444)',
                      color: placing || kycBlocked || !orderCheck.ok ? 'var(--ibo-muted)' : '#fff',
                      boxShadow: placing || kycBlocked || !orderCheck.ok ? 'none'
                        : side === 'buy' ? '0 6px 20px rgba(34,197,94,0.25)'
                                         : '0 6px 20px rgba(239,68,68,0.25)',
                    }}>
                    {placing ? (
                      <span className="flex items-center justify-center gap-2">
                        <Loader2 size={16} className="animate-spin" /> Processing…
                      </span>
                    ) : (
                      <span className="flex items-center justify-center gap-2">
                        {side === 'buy' ? <TrendingUp size={15} /> : <TrendingDown size={15} />}
                        {side === 'buy' ? `Buy ${base} Now` : `Sell ${base} Now`}
                      </span>
                    )}
                  </button>
                )}
              </div>
            </div>

            {/* Recent fills */}
            <RecentFills />
          </div>
        </div>
      </div>
    </div>
  );
}
