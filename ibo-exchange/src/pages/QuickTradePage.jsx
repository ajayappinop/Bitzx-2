/**
 * QuickTradePage — convert-first instant market trade stage.
 * Pair dropdown + dual amount blocks + live fills sidebar.
 */
import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  TrendingUp, TrendingDown, Zap, AlertCircle, CheckCircle,
  Loader2, RefreshCw, Wallet, Shield, BarChart2,
  ArrowRight, Star, Search, X, ArrowDownUp, Activity, ChevronDown,
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

const API = exchangeApiOrigin(import.meta.env.VITE_BACKEND_URL);
const FEE = 0.001;
const PCTS = [
  { label: '25%', v: 25 },
  { label: '50%', v: 50 },
  { label: '75%', v: 75 },
  { label: 'MAX', v: 100 },
];

function fmtPrice(n) {
  const v = parseFloat(n);
  if (!v) return '—';
  if (v >= 10000) return v.toLocaleString(undefined, { maximumFractionDigits: 2 });
  if (v >= 1) return v.toFixed(4);
  return v.toFixed(6);
}

function fmtCompact(n) {
  const v = parseFloat(n);
  if (!v) return '—';
  if (v >= 1e9) return `${(v / 1e9).toFixed(2)}B`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(2)}M`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(2)}K`;
  return v.toFixed(2);
}

function fmtQty(n, base) {
  const v = parseFloat(n) || 0;
  const dp = base === 'BTC' ? 6 : base === 'ETH' ? 5 : 4;
  return v.toFixed(dp);
}

const ORDER_FMT = (iso) => new Date(iso).toLocaleString('en-US', {
  month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
});

function RecentFillsRail() {
  const { user, orderHistory, ordersLoading, fetchOrders } = useAuth();
  if (!user) return null;
  const last = orderHistory.slice(0, 8);

  return (
    <section className="qt2-rail">
      <div className="qt2-rail__head">
        <div className="qt2-rail__title">
          <Activity size={14} strokeWidth={2.2} />
          Live fills
        </div>
        <button
          type="button"
          onClick={fetchOrders}
          disabled={ordersLoading}
          className="qt2-icon-btn"
          aria-label="Refresh fills"
        >
          <RefreshCw size={13} className={ordersLoading ? 'animate-spin' : ''} />
        </button>
      </div>
      {last.length === 0 ? (
        <p className="qt2-rail__empty">Place a market order — fills appear here instantly.</p>
      ) : (
        <div className="qt2-rail__scroll">
          {last.map((o) => {
            const isBuy = o.side === 'buy';
            return (
              <article key={o.id} className={`qt2-fill${isBuy ? ' is-buy' : ' is-sell'}`}>
                <span className="qt2-fill__side">{isBuy ? 'BUY' : 'SELL'}</span>
                <span className="qt2-fill__sym">{o.symbol.replace('USDT', '')}</span>
                <span className="qt2-fill__qty">
                  {isBuy ? '+' : '−'}{(o.filled || 0).toFixed(4)}
                </span>
                <span className="qt2-fill__px">
                  {o.avg_price > 0 ? `@ $${fmtPrice(o.avg_price)}` : 'MKT'}
                </span>
                <span className="qt2-fill__time">{ORDER_FMT(o.created_at)}</span>
              </article>
            );
          })}
        </div>
      )}
      <Link to="/account/positions?tab=order-history" className="qt2-rail__link">
        Full history <ArrowRight size={12} />
      </Link>
    </section>
  );
}

export default function QuickTradePage() {
  const navigate = useNavigate();
  const { user, balance, kyc, fetchOrders, fetchWallet, fetchLiveSpotPositions } = useAuth();

  const [symbol, setSymbol] = useState('BTCUSDT');
  const [tickers, setTickers] = useState({});
  const [side, setSide] = useState('buy');
  const [amount, setAmount] = useState('');
  const [placing, setPlacing] = useState(false);
  const [result, setResult] = useState(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [sheetSearch, setSheetSearch] = useState('');
  const [favs, setFavs] = useState(() => {
    try { return JSON.parse(localStorage.getItem('iboex_qt_favs') || '[]'); } catch { return []; }
  });
  const pairDdRef = useRef(null);
  const searchInputRef = useRef(null);

  const base = symbol.replace('USDT', '');
  const icon = COIN_ICONS[base];
  const ticker = tickers[symbol];
  const price = parseFloat(ticker?.price ?? 0);
  const pct = parseFloat(ticker?.priceChangePercent ?? 0);
  const isUp = pct >= 0;

  const availUSDT = parseFloat(balance?.USDT ?? 0);
  const availBase = parseFloat(balance?.[base] ?? 0);
  const maxBase = side === 'buy' ? (price > 0 ? availUSDT / price : 0) : availBase;

  const qty = parseFloat(amount) || 0;
  const cost = qty * price;
  const fee = cost * FEE;
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
            const map = {};
            normalizeMarketsList(j.markets).forEach((t) => { map[t.symbol] = t; });
            setTickers(map);
          }
        } catch { /* ignore */ }
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
        try { ws.close(); } catch { /* ignore */ }
      }
    };
  }, []);

  /* Close pair dropdown on outside click / Escape */
  useEffect(() => {
    if (!pickerOpen) return undefined;
    const onDoc = (e) => {
      if (pairDdRef.current?.contains(e.target)) return;
      setPickerOpen(false);
      setSheetSearch('');
    };
    const onKey = (e) => {
      if (e.key === 'Escape') {
        setPickerOpen(false);
        setSheetSearch('');
      }
    };
    document.addEventListener('mousedown', onDoc);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      window.removeEventListener('keydown', onKey);
    };
  }, [pickerOpen]);

  useEffect(() => {
    if (pickerOpen) {
      const t = window.setTimeout(() => searchInputRef.current?.focus(), 40);
      return () => window.clearTimeout(t);
    }
    return undefined;
  }, [pickerOpen]);

  const applyPct = (p) => {
    const max = maxBase * (p / 100);
    setAmount(max > 0 ? fmtQty(max, base) : '');
  };

  const handleSelect = useCallback((sym) => {
    setSymbol(sym);
    setAmount('');
    setResult(null);
    setPickerOpen(false);
    setSheetSearch('');
  }, []);

  const toggleFav = (sym) => {
    const next = favs.includes(sym) ? favs.filter((f) => f !== sym) : [...favs, sym];
    setFavs(next);
    localStorage.setItem('iboex_qt_favs', JSON.stringify(next));
  };

  const flipSide = () => {
    setSide((s) => (s === 'buy' ? 'sell' : 'buy'));
    setAmount('');
    setResult(null);
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
      const res = await authFetch(`${API}/api/orders`, {
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
    } finally {
      setPlacing(false);
    }
  };

  const sortedPairs = [
    ...PAIRS.filter((p) => favs.includes(p.symbol)),
    ...PAIRS.filter((p) => !favs.includes(p.symbol)),
  ];

  const sheetPairs = sheetSearch
    ? sortedPairs.filter(
      (p) =>
        p.base.toLowerCase().includes(sheetSearch.toLowerCase())
        || p.symbol.toLowerCase().includes(sheetSearch.toLowerCase()),
    )
    : sortedPairs;

  const fieldError =
    orderCheck.errors.amount
    || orderCheck.errors.price
    || orderCheck.errors.total
    || orderCheck.errors.balance
    || orderCheck.errors.symbol;

  return (
    <div className={`ibo-page qt2 qt2--${side}`}>
      <div className="qt2-bg" aria-hidden />

      <div className="qt2-wrap">
        {/* Top strip */}
        <header className="qt2-top">
          <div className="qt2-brand">
            <span className="qt2-brand__mark"><Zap size={15} strokeWidth={2.4} /></span>
            <div>
              <p className="qt2-brand__name">Quick Trade</p>
              <p className="qt2-brand__tag">Market · 0.1% fee · instant fill</p>
            </div>
          </div>
          <div className="qt2-top__actions">
            <span className="qt2-live">
              <span className="qt2-live__dot" />
              Live
            </span>
            <Link to={`/trade/${symbol}`} className="qt2-adv">
              <BarChart2 size={14} />
              Chart
            </Link>
          </div>
        </header>

        {/* Market pair dropdown (replaces horizontal rail) */}
        <div className={`qt2-pair-dd${pickerOpen ? ' is-open' : ''}`} ref={pairDdRef}>
          <button
            type="button"
            className="qt2-pair-dd__trigger"
            aria-haspopup="listbox"
            aria-expanded={pickerOpen}
            onClick={() => setPickerOpen((v) => !v)}
          >
            <span className="qt2-pair-dd__left">
              {icon
                ? <img src={icon} alt="" className="qt2-pair-dd__ico" />
                : <span className="qt2-pair-dd__ico is-letter">{base[0]}</span>}
              <span className="qt2-pair-dd__main">
                <span className="qt2-pair-dd__sym">{base}<i>/USDT</i></span>
                <span className="qt2-pair-dd__sub">Select trading pair</span>
              </span>
            </span>
            <span className="qt2-pair-dd__right">
              <span className={`qt2-pair-dd__quote${isUp ? ' is-up' : ' is-dn'}`}>
                <strong>{price > 0 ? `$${fmtPrice(price)}` : '—'}</strong>
                <em>
                  {price > 0
                    ? `${isUp ? '+' : ''}${pct.toFixed(2)}%`
                    : '· ·'}
                </em>
              </span>
              <ChevronDown
                size={18}
                className={`qt2-pair-dd__chev${pickerOpen ? ' is-open' : ''}`}
                aria-hidden
              />
            </span>
          </button>

          <AnimatePresence>
            {pickerOpen ? (
              <motion.div
                key="pair-menu"
                className="qt2-pair-dd__menu"
                role="listbox"
                aria-label="Trading pairs"
                initial={{ opacity: 0, y: -6, scale: 0.99 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -4, scale: 0.99 }}
                transition={{ duration: 0.14, ease: [0.22, 1, 0.36, 1] }}
              >
                <div className="qt2-pair-dd__search">
                  <Search size={14} />
                  <input
                    ref={searchInputRef}
                    value={sheetSearch}
                    onChange={(e) => setSheetSearch(e.target.value)}
                    placeholder="Search pairs…"
                    aria-label="Search trading pairs"
                  />
                  {sheetSearch ? (
                    <button
                      type="button"
                      className="qt2-pair-dd__clear"
                      onClick={() => setSheetSearch('')}
                      aria-label="Clear search"
                    >
                      <X size={13} />
                    </button>
                  ) : null}
                </div>

                <div className="qt2-pair-dd__list">
                  {sheetPairs.length === 0 ? (
                    <p className="qt2-pair-dd__empty">No pairs match “{sheetSearch}”</p>
                  ) : sheetPairs.map((pair) => {
                    const b = pair.base;
                    const ico = COIN_ICONS[b];
                    const tk = tickers[pair.symbol];
                    const pr = parseFloat(tk?.price ?? 0);
                    const pc = parseFloat(tk?.priceChangePercent ?? 0);
                    const up = pc >= 0;
                    const isSel = symbol === pair.symbol;
                    const isFav = favs.includes(pair.symbol);
                    return (
                      <div
                        key={pair.symbol}
                        className={`qt2-pair-dd__row${isSel ? ' is-on' : ''}`}
                      >
                        <button
                          type="button"
                          role="option"
                          aria-selected={isSel}
                          className="qt2-pair-dd__opt"
                          onClick={() => handleSelect(pair.symbol)}
                        >
                          {ico
                            ? <img src={ico} alt="" className="qt2-pair-dd__row-ico" />
                            : <span className="qt2-pair-dd__row-ico is-letter">{b[0]}</span>}
                          <span className="qt2-pair-dd__row-meta">
                            <span className="qt2-pair-dd__row-name">
                              {b}<span>/USDT</span>
                            </span>
                            <span className="qt2-pair-dd__row-vol">
                              Vol {fmtCompact(tk?.volume)}
                            </span>
                          </span>
                          <span className="qt2-pair-dd__row-quotes">
                            <span className="qt2-pair-dd__row-px">
                              {pr > 0 ? `$${fmtPrice(pr)}` : '—'}
                            </span>
                            <span className={up ? 'is-up' : 'is-dn'}>
                              {up ? '+' : ''}{pc.toFixed(2)}%
                            </span>
                          </span>
                        </button>
                        <button
                          type="button"
                          className={`qt2-pair-dd__fav${isFav ? ' is-on' : ''}`}
                          aria-label={isFav ? `Unfavorite ${b}` : `Favorite ${b}`}
                          onClick={(e) => { e.stopPropagation(); toggleFav(pair.symbol); }}
                        >
                          <Star size={13} fill={isFav ? 'currentColor' : 'none'} />
                        </button>
                      </div>
                    );
                  })}
                </div>
              </motion.div>
            ) : null}
          </AnimatePresence>
        </div>

        {/* Stage: convert column + status column */}
        <div className="qt2-stage">
          <div className="qt2-convert">
            {/* Price hero */}
            <div className="qt2-hero">
              <div className="qt2-hero__pair is-static">
                {icon
                  ? <img src={icon} alt="" className="qt2-hero__ico" />
                  : <span className="qt2-hero__ico is-letter">{base[0]}</span>}
                <div>
                  <span className="qt2-hero__name">{base}<i>/USDT</i></span>
                  <span className="qt2-hero__hint">Spot · market order</span>
                </div>
              </div>
              <div className={`qt2-hero__price${isUp ? ' is-up' : ' is-dn'}`}>
                {price > 0 ? (
                  <>
                    <strong>${fmtPrice(price)}</strong>
                    <span>{isUp ? '▲' : '▼'} {isUp ? '+' : ''}{pct.toFixed(2)}% · 24h</span>
                  </>
                ) : (
                  <strong className="qt2-hero__pulse">—</strong>
                )}
              </div>
              {ticker && (
                <div className="qt2-hero__stats">
                  <div><em>High</em><b>${fmtPrice(ticker.highPrice)}</b></div>
                  <div><em>Low</em><b>${fmtPrice(ticker.lowPrice)}</b></div>
                  <div><em>Vol</em><b>{fmtCompact(ticker.volume)} {base}</b></div>
                </div>
              )}
            </div>

            {/* Mode pills */}
            <div className="qt2-mode" role="tablist" aria-label="Order side">
              <button
                type="button"
                role="tab"
                aria-selected={side === 'buy'}
                className={`qt2-mode__btn is-buy${side === 'buy' ? ' is-on' : ''}`}
                onClick={() => { setSide('buy'); setAmount(''); setResult(null); }}
              >
                <TrendingUp size={15} /> Buy
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={side === 'sell'}
                className={`qt2-mode__btn is-sell${side === 'sell' ? ' is-on' : ''}`}
                onClick={() => { setSide('sell'); setAmount(''); setResult(null); }}
              >
                <TrendingDown size={15} /> Sell
              </button>
            </div>

            {/* Dual convert stack */}
            <div className="qt2-stack">
              <div className="qt2-block">
                <div className="qt2-block__row">
                  <span className="qt2-block__label">
                    {side === 'buy' ? 'You buy' : 'You sell'}
                  </span>
                  <span className="qt2-block__bal">
                    <Wallet size={12} />
                    {side === 'buy'
                      ? `${availUSDT.toLocaleString(undefined, { maximumFractionDigits: 2 })} USDT`
                      : `${availBase.toFixed(6)} ${base}`}
                  </span>
                </div>
                <div className={`qt2-block__field${fieldError ? ' is-err' : ''}`}>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    inputMode="decimal"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder="0.00"
                    aria-label={`${side === 'buy' ? 'Buy' : 'Sell'} amount in ${base}`}
                  />
                  <span className="qt2-block__asset">
                    {icon ? <img src={icon} alt="" /> : null}
                    {base}
                  </span>
                </div>
                <div className="qt2-pcts">
                  {PCTS.map(({ label, v }) => (
                    <button key={v} type="button" onClick={() => applyPct(v)}>{label}</button>
                  ))}
                </div>
              </div>

              <button type="button" className="qt2-flip" onClick={flipSide} aria-label="Flip buy and sell">
                <ArrowDownUp size={16} strokeWidth={2.4} />
              </button>

              <div className="qt2-block qt2-block--out">
                <div className="qt2-block__row">
                  <span className="qt2-block__label">
                    {side === 'buy' ? 'Est. total' : 'You receive'}
                  </span>
                  <span className="qt2-block__rate">
                    1 {base} ≈ ${price > 0 ? fmtPrice(price) : '—'}
                  </span>
                </div>
                <div className="qt2-block__field is-readonly">
                  <span className="qt2-block__outval">
                    {qty > 0 && price > 0
                      ? (side === 'buy'
                        ? `$${cost.toLocaleString(undefined, { maximumFractionDigits: 2 })}`
                        : `$${receive.toLocaleString(undefined, { maximumFractionDigits: 2 })}`)
                      : '$0.00'}
                  </span>
                  <span className="qt2-block__asset">USDT</span>
                </div>
                <p className="qt2-block__note">
                  {side === 'buy'
                    ? `After fee you receive ~${qty > 0 ? fmtQty(receive, base) : '0'} ${base} · 0.1% fee`
                    : `0.1% fee deducted · min ${MIN_BASE_AMOUNT} ${base} · min $${MIN_ORDER_VALUE_USDT.toFixed(2)}`}
                  {side === 'buy'
                    ? ` · buy lock ~${((MARKET_BUY_LOCK_BUFFER - 1) * 100).toFixed(1)}%`
                    : ''}
                </p>
              </div>
            </div>

            {fieldError ? (
              <p className="qt2-err">{fieldError}</p>
            ) : null}

            {qty > 0 && price > 0 ? (
              <div className="qt2-receipt">
                <div><span>Notional</span><b>${cost.toLocaleString(undefined, { maximumFractionDigits: 2 })}</b></div>
                <div><span>Fee</span><b className="is-fee">${fee.toLocaleString(undefined, { maximumFractionDigits: 4 })}</b></div>
                <div className="is-total">
                  <span>Net</span>
                  <b className={side === 'buy' ? 'is-up' : 'is-dn'}>
                    {side === 'buy'
                      ? `${fmtQty(receive, base)} ${base}`
                      : `$${receive.toLocaleString(undefined, { maximumFractionDigits: 2 })}`}
                  </b>
                </div>
              </div>
            ) : null}

            {kycBlocked && (
              <div className="qt2-kyc">
                <Shield size={16} />
                <div>
                  <strong>KYC required</strong>
                  <p>
                    {kyc?.status === 'pending'
                      ? 'Documents under review — trading unlocks after approval.'
                      : 'Verify identity before placing market orders.'}
                  </p>
                  <Link to="/kyc">{kyc?.status === 'pending' ? 'Check status' : 'Verify now'}</Link>
                </div>
              </div>
            )}

            <AnimatePresence>
              {result && (
                <motion.div
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  className={`qt2-toast${result.ok ? ' is-ok' : ' is-bad'}`}
                >
                  {result.ok
                    ? <CheckCircle size={16} />
                    : <AlertCircle size={16} />}
                  <div>
                    {result.ok ? (
                      <>
                        <strong>
                          {result.order.status === 'filled' ? 'Filled instantly' : 'Order placed'}
                        </strong>
                        <p>
                          {result.order.side.toUpperCase()}{' '}
                          {(result.order.filled > 0
                            ? result.order.filled
                            : result.order.amount).toFixed(6)}{' '}
                          {base}
                          {result.order.avg_price > 0 && ` @ $${fmtPrice(result.order.avg_price)}`}
                        </p>
                      </>
                    ) : (
                      <strong>{result.error}</strong>
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {!user ? (
              <div className="qt2-auth">
                <p>Sign in to send market orders</p>
                <div className="qt2-auth__btns">
                  <Link to="/login" className="qt2-cta qt2-cta--primary">Log in</Link>
                  <Link to="/register" className="qt2-cta qt2-cta--ghost">Register</Link>
                </div>
              </div>
            ) : (
              <button
                type="button"
                className={`qt2-cta qt2-cta--submit is-${side}`}
                disabled={placing || kycBlocked || !orderCheck.ok}
                onClick={handleSubmit}
              >
                {placing ? (
                  <><Loader2 size={18} className="animate-spin" /> Executing…</>
                ) : (
                  <>
                    {side === 'buy' ? <TrendingUp size={18} /> : <TrendingDown size={18} />}
                    {side === 'buy' ? `Buy ${base} now` : `Sell ${base} now`}
                  </>
                )}
              </button>
            )}
          </div>

          <aside className="qt2-side">
            <RecentFillsRail />
            <div className="qt2-tips">
              <h3>How it works</h3>
              <ol>
                <li>Pick an asset from the rail</li>
                <li>Enter what you pay or sell</li>
                <li>Review net after 0.1% fee</li>
                <li>Submit — fills at market</li>
              </ol>
              <Link to={`/trade/${symbol}`}>
                Need limits & books? Open advanced chart
                <ArrowRight size={13} />
              </Link>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}
