/**
 * QuickTradeModal — compact floating market-order widget.
 * Can be opened from anywhere (Navbar or TradePage).
 *
 * Props:
 *   symbol       : initial symbol, e.g. "BTCUSDT"
 *   currentPrice : optional — if omitted the modal fetches live price itself
 *   onClose      : () => void
 */
import { useState, useEffect, useMemo } from 'react';
import { createPortal }        from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X, TrendingUp, TrendingDown, Zap,
  AlertCircle, CheckCircle, Loader2, ChevronDown,
} from 'lucide-react';
import { useAuth, authFetch } from '@/context/AuthContext';
import { COIN_ICONS, PAIRS, exchangeWsPath, marketApi } from '@/services/marketApi';
import { exchangeApiOrigin } from '@/lib/apiBase';
import {
  validateMarketQuickOrder,
  MIN_BASE_AMOUNT,
  MIN_ORDER_VALUE_USDT,
  MARKET_BUY_LOCK_BUFFER,
} from '@/lib/tradeRules';
import { estimateIboFee, formatIboFee, maxFeeRate } from '@/lib/iboFee';

const API  = exchangeApiOrigin(import.meta.env.VITE_BACKEND_URL);
const DEFAULT_FEE_RATE = 0.001;

const PCT_PRESETS = [
  { label: '25%', pct: 0.25 },
  { label: '50%', pct: 0.50 },
  { label: '75%', pct: 0.75 },
  { label: 'MAX', pct: 1.00 },
];

const ALL_PAIRS = PAIRS.map(p => p.symbol);

function fmt(n, decimals = 4) {
  if (!n || isNaN(n)) return '—';
  const x = parseFloat(n);
  if (x >= 1000) return x.toLocaleString(undefined, { maximumFractionDigits: 2 });
  return x.toFixed(decimals);
}

export default function QuickTradeModal({ symbol: initialSymbol = 'BTCUSDT', currentPrice: externalPrice, onClose }) {
  const { user, balance, kyc, fetchOrders, fetchWallet, fetchLiveSpotPositions } = useAuth();

  const [symbol,    setSymbol]    = useState(initialSymbol);
  const [livePrice, setLivePrice] = useState(null);
  const [pairOpen,  setPairOpen]  = useState(false);
  const [side,      setSide]      = useState('buy');
  const [amount,    setAmount]    = useState('');
  const [loading,   setLoading]   = useState(false);
  const [toast,     setToast]     = useState(null);
  const [feeConfig, setFeeConfig] = useState(null);

  useEffect(() => {
    let cancelled = false;
    marketApi.getTradingFeeConfig()
      .then((cfg) => { if (!cancelled) setFeeConfig(cfg); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const base  = symbol.replace('USDT', '');
  const icon  = COIN_ICONS[base];

  // Use external price if provided (from TradePage), otherwise fetch live
  const price = externalPrice
    ? parseFloat(externalPrice) || 0
    : parseFloat(livePrice)    || 0;

  useEffect(() => {
    setLivePrice(null);
    setAmount('');
    if (externalPrice) return undefined;
    const qs = new URLSearchParams({ symbol });
    const url = exchangeWsPath(`/api/ws/exchange/ticker?${qs.toString()}`);
    let closed = false;
    let reconnectTimer = null;
    let ws = null;
    const connect = () => {
      if (closed) return;
      ws = new WebSocket(url);
      ws.onmessage = (ev) => {
        try {
          const j = JSON.parse(ev.data);
          if (j.type === 'exchange_ticker' && j.ticker?.price != null) {
            setLivePrice(j.ticker.price);
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
  }, [symbol, externalPrice]);

  useEffect(() => {
    const handler = e => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const availUSDT = parseFloat(balance?.USDT  ?? 0);
  const availBase = parseFloat(balance?.[base] ?? 0);
  const availIBO  = parseFloat(balance?.IBO ?? 0);
  const maxBase   = side === 'buy' ? (price > 0 ? availUSDT / price : 0) : availBase;

  const qty     = parseFloat(amount) || 0;
  const cost    = qty * price;
  const feeRate = maxFeeRate(feeConfig, 'spot') || DEFAULT_FEE_RATE;
  const iboPx   = Number(feeConfig?.ibo_price_usdt) || 0.4523;
  const feeIbo  = estimateIboFee({
    quoteNotional: cost,
    feeRate,
    quoteAsset: 'USDT',
    iboPriceUsdt: iboPx,
  });
  const receive = side === 'buy' ? qty : cost;

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
        balanceIBO: availIBO,
        feeRate,
        iboPriceUsdt: iboPx,
        userLoggedIn: !!user,
      }),
    [symbol, side, amount, price, availUSDT, availBase, availIBO, base, user, feeRate, iboPx],
  );

  const applyPct = pct => {
    const max = maxBase * pct;
    setAmount(max > 0 ? max.toFixed(base === 'BTC' ? 6 : base === 'ETH' ? 5 : 4) : '');
  };

  const showToast = (msg, ok) => {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 4500);
  };

  const handleSubmit = async () => {
    if (!user) {
      if (!orderCheck.ok && orderCheck.message) {
        showToast(orderCheck.message, false);
        return;
      }
      window.location.href = '/login';
      return;
    }
    if (kycBlocked) {
      showToast('KYC verification required to trade', false);
      return;
    }
    if (!orderCheck.ok) {
      showToast(orderCheck.message || 'Check your order details.', false);
      return;
    }
    setLoading(true);
    try {
      const res  = await authFetch(`${API}/api/orders`, {
        method: 'POST',
        body: JSON.stringify({ symbol, side, type: 'market', amount: qty, price: 0 }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Order failed');
      showToast(`${side === 'buy' ? 'Bought' : 'Sold'} ${qty.toFixed(4)} ${base} ✓`, true);
      setAmount('');
      await Promise.all([fetchOrders(), fetchWallet(), fetchLiveSpotPositions()]);
    } catch (e) {
      showToast(e.message, false);
    } finally { setLoading(false); }
  };

  const switchPair = sym => { setSymbol(sym); setPairOpen(false); setAmount(''); };

  const priceDecs = price >= 1000 ? 2 : price >= 1 ? 4 : 6;

  return createPortal(
    <AnimatePresence>
      <div style={{ position: 'fixed', inset: 0, zIndex: 10000 }}>

        {/* Backdrop */}
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          style={{ position: 'absolute', inset: 0, background: 'rgba(12,25,34,0.45)', backdropFilter: 'blur(6px)' }}
          onClick={onClose}
        />

        {/* Panel */}
        <motion.div
          initial={{ opacity: 0, scale: 0.94, y: 24 }}
          animate={{ opacity: 1, scale: 1,    y: 0 }}
          exit={{   opacity: 0, scale: 0.94,  y: 24 }}
          transition={{ type: 'spring', stiffness: 320, damping: 26 }}
          style={{
            position: 'absolute', top: '50%', left: '50%',
            transform: 'translate(-50%, -50%)',
            width: '100%', maxWidth: 460,
            background: 'var(--ibo-card)',
            border: '1px solid var(--ibo-border-solid)',
            borderRadius: 22,
            boxShadow: 'var(--ibo-shadow)',
            overflow: 'hidden',
          }}
          onClick={e => e.stopPropagation()}
        >
          {/* ─── Header ─────────────────────────────────────────────────── */}
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '18px 22px 14px',
            borderBottom: '1px solid var(--ibo-border)',
            background: 'linear-gradient(135deg, rgba(14,164,171,0.06), transparent)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{
                width: 36, height: 36, borderRadius: 10,
                background: 'linear-gradient(135deg, #0EA4AB, #5BB8FF)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <Zap size={18} color="#050a1a" />
              </div>
              <div>
                <p style={{ fontSize: 17, fontWeight: 900, color: 'var(--ibo-ink)', lineHeight: 1 }}>Quick Trade</p>
                <p style={{ fontSize: 12, color: 'var(--ibo-muted)', marginTop: 3, fontWeight: 600 }}>
                  Instant market order · fee in IBO
                </p>
              </div>
            </div>
            <button onClick={onClose}
              style={{ background: 'var(--ibo-elevated)', border: 'none', borderRadius: 8, padding: '7px 8px', cursor: 'pointer', color: 'var(--ibo-muted)' }}
              className="hover:bg-white/[.12] transition-colors">
              <X size={17} />
            </button>
          </div>

          <div style={{ padding: '18px 22px 22px' }}>

            {/* ─── Pair selector ──────────────────────────────────────── */}
            <div style={{ marginBottom: 16, position: 'relative' }}>
              <p style={{ fontSize: 11, color: 'var(--ibo-muted)', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 8 }}>
                Trading Pair
              </p>
              <button
                onClick={() => setPairOpen(v => !v)}
                style={{
                  width: '100%', display: 'flex', alignItems: 'center', gap: 12,
                  padding: '12px 16px', borderRadius: 14, cursor: 'pointer',
                  background: 'var(--ibo-elevated)',
                  border: `1px solid ${pairOpen ? 'rgba(91,184,255,0.5)' : 'var(--ibo-border-solid)'}`,
                  transition: 'border-color 0.2s',
                }}>
                {icon && <img src={icon} alt={base} style={{ width: 28, height: 28, borderRadius: '50%', flexShrink: 0 }} />}
                <span style={{ flex: 1, textAlign: 'left', fontSize: 17, fontWeight: 800, color: 'var(--ibo-ink)' }}>
                  {base}<span style={{ color: 'var(--ibo-muted)' }}>/USDT</span>
                </span>
                {/* Live price inside selector */}
                {price > 0 && (
                  <span style={{ fontFamily: 'Inter, Plus Jakarta Sans, sans-serif', fontWeight: 800, fontSize: 15, color: '#22c55e', marginRight: 4 }}>
                    ${fmt(price, priceDecs)}
                  </span>
                )}
                <ChevronDown size={16} color="#4A4B50"
                  style={{ flexShrink: 0, transform: pairOpen ? 'rotate(180deg)' : 'none', transition: '0.2s' }} />
              </button>

              {/* Pair dropdown */}
              {pairOpen && (
                <>
                  <div style={{ position: 'fixed', inset: 0, zIndex: 10001 }} onClick={() => setPairOpen(false)} />
                  <div style={{
                    position: 'absolute', top: '100%', left: 0, right: 0, marginTop: 6,
                    background: 'var(--ibo-card)', border: '1px solid var(--ibo-border-solid)',
                    borderRadius: 14, boxShadow: '0 24px 48px rgba(0,0,0,0.8)',
                    zIndex: 10002, maxHeight: 260, overflowY: 'auto', padding: '6px 0',
                  }} className="scrollbar-hide">
                    {ALL_PAIRS.map(q => {
                      const b = q.replace('USDT', '');
                      return (
                        <button key={q} onClick={() => switchPair(q)}
                          style={{
                            width: '100%', display: 'flex', alignItems: 'center', gap: 12,
                            padding: '10px 16px', cursor: 'pointer', border: 'none',
                            background: q === symbol ? 'rgba(91,184,255,0.1)' : 'transparent',
                            color: q === symbol ? '#5BB8FF' : 'var(--ibo-ink)',
                            transition: 'background 0.15s',
                          }}
                          className="hover:bg-white/5">
                          {COIN_ICONS[b] && (
                            <img src={COIN_ICONS[b]} alt={b} style={{ width: 26, height: 26, borderRadius: '50%' }} />
                          )}
                          <span style={{ flex: 1, textAlign: 'left', fontSize: 15, fontWeight: 700 }}>{b}/USDT</span>
                          {q === symbol && (
                            <span style={{ fontSize: 10, background: 'rgba(91,184,255,0.15)', color: '#5BB8FF', padding: '2px 8px', borderRadius: 20, fontWeight: 800 }}>
                              SELECTED
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </>
              )}
            </div>

            {/* ─── Live price strip ───────────────────────────────────── */}
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              background: 'var(--ibo-elevated)', borderRadius: 12,
              padding: '12px 16px', marginBottom: 18,
              border: '1px solid var(--ibo-border-solid)',
            }}>
              <div>
                <p style={{ fontSize: 11, color: 'var(--ibo-muted)', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 4 }}>
                  Market Price
                </p>
                {price > 0 ? (
                  <p style={{ fontSize: 24, fontWeight: 900, fontFamily: 'Inter, Plus Jakarta Sans, sans-serif', color: 'var(--ibo-ink)', lineHeight: 1 }}>
                    ${fmt(price, priceDecs)}
                  </p>
                ) : (
                  <div style={{ width: 120, height: 28, background: 'var(--ibo-elevated)', borderRadius: 6 }} className="animate-pulse" />
                )}
              </div>
              <span style={{
                fontSize: 12, color: '#22c55e',
                background: 'rgba(34,197,94,0.12)',
                padding: '5px 10px', borderRadius: 8, fontWeight: 800,
              }}>
                ● LIVE
              </span>
            </div>

            {/* ─── Buy / Sell toggle ──────────────────────────────────── */}
            <div style={{
              display: 'grid', gridTemplateColumns: '1fr 1fr',
              background: 'var(--ibo-elevated)', borderRadius: 14, padding: 5,
              marginBottom: 18,
            }}>
              {['buy', 'sell'].map(s => (
                <button key={s} onClick={() => { setSide(s); setAmount(''); }}
                  style={{
                    padding: '12px 0', fontWeight: 900, fontSize: 15,
                    borderRadius: 10, border: 'none', cursor: 'pointer',
                    transition: 'all 0.2s',
                    background: side === s
                      ? (s === 'buy' ? 'rgba(34,197,94,0.22)' : 'rgba(239,68,68,0.22)')
                      : 'transparent',
                    color: side === s
                      ? (s === 'buy' ? '#22c55e' : '#ef4444')
                      : '#4A4B50',
                    textTransform: 'uppercase', letterSpacing: '0.06em',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                  }}>
                  {s === 'buy'
                    ? <><TrendingUp size={16} /> Buy {base}</>
                    : <><TrendingDown size={16} /> Sell {base}</>}
                </button>
              ))}
            </div>

            {/* ─── Available balance ──────────────────────────────────── */}
            <div style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              marginBottom: 12, fontSize: 13,
            }}>
              <span style={{ color: 'var(--ibo-muted)', fontWeight: 700 }}>Available</span>
              <span style={{ color: 'var(--ibo-ink)', fontFamily: 'Inter, Plus Jakarta Sans, sans-serif', fontWeight: 800, fontSize: 14 }}>
                {side === 'buy'
                  ? `${availUSDT.toLocaleString(undefined, { maximumFractionDigits: 2 })} USDT`
                  : `${availBase.toLocaleString(undefined, { maximumFractionDigits: 6 })} ${base}`}
              </span>
            </div>

            {/* ─── Amount input ───────────────────────────────────────── */}
            <p style={{ fontSize: 10, color: 'var(--ibo-muted)', fontWeight: 700, marginBottom: 8, lineHeight: 1.4 }}>
              Min {MIN_BASE_AMOUNT} {base} · Min ${MIN_ORDER_VALUE_USDT.toFixed(2)} USDT notional · Buys lock ≈{' '}
              {((MARKET_BUY_LOCK_BUFFER - 1) * 100).toFixed(1)}% above mark
            </p>
            <div style={{
              display: 'flex', alignItems: 'center',
              background: 'var(--ibo-elevated)',
              border: `1px solid ${
                orderCheck.errors.amount || orderCheck.errors.balance || orderCheck.errors.total
                  ? 'rgba(239,68,68,0.5)'
                  : amount
                    ? 'rgba(197,227,91,0.4)'
                    : 'var(--ibo-border-solid)'
              }`,
              borderRadius: 14, padding: '0 16px',
              marginBottom: 8, transition: 'border-color 0.2s',
            }}>
              <input
                type="number" min="0" step="any"
                value={amount}
                onChange={e => setAmount(e.target.value)}
                placeholder={`Amount (${base})`}
                style={{
                  flex: 1, background: 'transparent', border: 'none', outline: 'none',
                  fontSize: 18, fontWeight: 800, color: 'var(--ibo-ink)', padding: '14px 0',
                  fontFamily: 'Inter, Plus Jakarta Sans, sans-serif',
                }}
              />
              <span style={{ color: 'var(--ibo-muted)', fontWeight: 800, fontSize: 14, flexShrink: 0 }}>{base}</span>
            </div>
            {(orderCheck.errors.amount || orderCheck.errors.balance || orderCheck.errors.total || orderCheck.errors.price || orderCheck.errors.symbol) && (
              <p style={{ fontSize: 12, color: '#ef4444', fontWeight: 700, marginBottom: 10 }}>
                {orderCheck.errors.amount
                  || orderCheck.errors.price
                  || orderCheck.errors.total
                  || orderCheck.errors.balance
                  || orderCheck.errors.symbol}
              </p>
            )}

            {/* ─── % presets ──────────────────────────────────────────── */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, marginBottom: 18 }}>
              {PCT_PRESETS.map(({ label, pct }) => (
                <button key={label} onClick={() => applyPct(pct)}
                  style={{
                    padding: '9px 0', fontSize: 13, fontWeight: 800,
                    background: 'var(--ibo-elevated)',
                    border: '1px solid var(--ibo-border-solid)',
                    borderRadius: 10, color: '#8A8B90', cursor: 'pointer',
                    transition: 'all 0.15s',
                  }}
                  className="hover:bg-white/10 hover:text-white hover:border-white/20">
                  {label}
                </button>
              ))}
            </div>

            {/* ─── Order summary ──────────────────────────────────────── */}
            {qty > 0 && (
              <div style={{
                background: 'var(--ibo-elevated)',
                border: '1px solid var(--ibo-border-solid)',
                borderRadius: 14, padding: '14px 16px',
                marginBottom: 16,
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                  <span style={{ color: 'var(--ibo-muted)', fontSize: 13, fontWeight: 600 }}>Order Total</span>
                  <span style={{ color: 'var(--ibo-ink)', fontFamily: 'Inter, Plus Jakarta Sans, sans-serif', fontWeight: 800, fontSize: 15 }}>
                    ${cost.toLocaleString(undefined, { maximumFractionDigits: 2 })} USDT
                  </span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                  <span style={{ color: 'var(--ibo-muted)', fontSize: 13, fontWeight: 600 }}>
                    Est. fee ({(feeRate * 100).toFixed(3)}%)
                  </span>
                  <span style={{ color: '#0EA4AB', fontFamily: 'Inter, Plus Jakarta Sans, sans-serif', fontSize: 13, fontWeight: 700 }}>
                    {formatIboFee(feeIbo)}
                  </span>
                </div>
                <div style={{
                  display: 'flex', justifyContent: 'space-between',
                  borderTop: '1px solid var(--ibo-border)', paddingTop: 8,
                }}>
                  <span style={{ color: 'var(--ibo-ink)', fontSize: 14, fontWeight: 700 }}>You Receive</span>
                  <span style={{
                    fontFamily: 'Inter, Plus Jakarta Sans, sans-serif', fontWeight: 900, fontSize: 15,
                    color: side === 'buy' ? '#22c55e' : '#ef4444',
                  }}>
                    {side === 'buy'
                      ? `${receive.toFixed(base === 'BTC' ? 6 : 4)} ${base}`
                      : `$${receive.toLocaleString(undefined, { maximumFractionDigits: 2 })}`}
                  </span>
                </div>
              </div>
            )}

            {/* ─── KYC warning ────────────────────────────────────────── */}
            {kycBlocked && (
              <div style={{
                display: 'flex', alignItems: 'center', gap: 10,
                background: 'rgba(14,164,171,0.08)',
                border: '1px solid rgba(14,164,171,0.2)',
                borderRadius: 12, padding: '12px 14px', marginBottom: 14,
                fontSize: 13, color: '#0EA4AB', fontWeight: 700,
              }}>
                <AlertCircle size={15} />
                KYC required.{' '}
                <a href="/kyc" style={{ marginLeft: 2, fontWeight: 900, textDecoration: 'underline' }}>Verify now →</a>
              </div>
            )}

            {/* ─── Toast ──────────────────────────────────────────────── */}
            {toast && (
              <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  background: toast.ok ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)',
                  border: `1px solid ${toast.ok ? 'rgba(34,197,94,0.25)' : 'rgba(239,68,68,0.25)'}`,
                  borderRadius: 12, padding: '12px 14px', marginBottom: 14,
                  fontSize: 14, color: toast.ok ? '#22c55e' : '#ef4444', fontWeight: 700,
                }}>
                {toast.ok ? <CheckCircle size={16} /> : <AlertCircle size={16} />}
                {toast.msg}
              </motion.div>
            )}

            {/* ─── CTA button ─────────────────────────────────────────── */}
            {!user ? (
              <button
                type="button"
                onClick={handleSubmit}
                disabled={!orderCheck.ok}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                  width: '100%', padding: '16px 0',
                  background: !orderCheck.ok ? 'var(--ibo-elevated)' : 'linear-gradient(135deg, #0EA4AB, #5BB8FF)',
                  color: !orderCheck.ok ? 'var(--ibo-muted)' : '#050a1a', fontWeight: 900, fontSize: 16,
                  borderRadius: 14, border: 'none', cursor: !orderCheck.ok ? 'not-allowed' : 'pointer',
                }}>
                Sign In to Trade
              </button>
            ) : (
              <button onClick={handleSubmit} disabled={loading || kycBlocked || !orderCheck.ok}
                style={{
                  width: '100%', padding: '16px 0', border: 'none', cursor: 'pointer',
                  borderRadius: 14, fontWeight: 900, fontSize: 16,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                  transition: 'all 0.2s',
                  background: loading || kycBlocked || !orderCheck.ok
                    ? 'var(--ibo-elevated)'
                    : side === 'buy'
                      ? 'linear-gradient(135deg, #16a34a, #22c55e)'
                      : 'linear-gradient(135deg, #dc2626, #ef4444)',
                  color: loading || kycBlocked || !orderCheck.ok ? 'var(--ibo-muted)' : '#fff',
                  opacity: kycBlocked ? 0.55 : 1,
                  boxShadow: loading || kycBlocked || !orderCheck.ok ? 'none'
                    : side === 'buy' ? '0 8px 24px rgba(34,197,94,0.25)'
                                     : '0 8px 24px rgba(239,68,68,0.25)',
                }}>
                {loading
                  ? <><Loader2 size={20} className="animate-spin" /> Processing…</>
                  : side === 'buy'
                    ? <><TrendingUp size={20} /> Buy {base} Instantly</>
                    : <><TrendingDown size={20} /> Sell {base} Instantly</>}
              </button>
            )}
          </div>
        </motion.div>
      </div>
    </AnimatePresence>,
    document.body
  );
}
