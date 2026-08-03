import { useState, useEffect, useMemo, useRef } from 'react';
import { Wallet, Plus, Shield, Clock } from 'lucide-react';
import { useAuth, authFetch } from '@/context/AuthContext';
import { useNavigate, Link } from 'react-router-dom';
import { exchangeApiOrigin } from '@/lib/apiBase';
import {
  validateSpotOrder,
  MIN_BASE_AMOUNT,
  MIN_ORDER_VALUE_USDT,
  parseLimitPrice,
  parseMarketReferencePrice,
  parseAmount,
} from '@/lib/tradeRules';
import { parsePairFromApiSymbol, marketApi } from '@/services/marketApi';
import { useToast, friendlyError } from '@/context/ToastContext';

const API  = exchangeApiOrigin(import.meta.env.VITE_BACKEND_URL);
const PCTS = [25, 50, 75, 100];
const DEFAULT_FEE_RATE = 0.001;
const DEFAULT_IBO_PRICE_USDT = 0.4523;

/** Format ticker last for display / placeholders (live-updating when `n` changes each tick). */
function fmtLiveUsdt(n) {
  if (n == null || !Number.isFinite(Number(n)) || Number(n) <= 0) return '—';
  const v = Number(n);
  if (v >= 1000) return v.toLocaleString(undefined, { maximumFractionDigits: 2 });
  if (v >= 1) return v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 6 });
  return v.toLocaleString(undefined, { minimumFractionDigits: 4, maximumFractionDigits: 8 });
}

/** Trim trailing zeros for order form strings. */
function trimDecimalString(s, maxDecimals) {
  if (s == null || s === '') return '';
  const n = parseFloat(String(s).replace(/,/g, ''));
  if (!Number.isFinite(n) || n <= 0) return '';
  const t = Math.floor(n * 10 ** maxDecimals + 1e-12) / 10 ** maxDecimals;
  let out = t.toFixed(maxDecimals);
  out = out.replace(/\.?0+$/, '');
  return out || '0';
}

export default function TradeForm({ symbol, lastPrice, limitPriceSeed = '', initialSide }) {
  const { user, balance, fetchWallet, fetchOrders, fetchLiveSpotPositions, upsertOpenOrder, kyc } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const { base: apiBase, quote: quoteAsset } = parsePairFromApiSymbol(symbol);
  const displayBase = apiBase;
  const isUsdtQuote = quoteAsset === 'USDT';

  const [side,    setSide]    = useState(
    initialSide === 'sell' ? 'sell' : initialSide === 'buy' ? 'buy' : 'buy',
  );

  useEffect(() => {
    if (initialSide === 'buy' || initialSide === 'sell') setSide(initialSide);
  }, [initialSide, symbol]);
  const [type,    setType]    = useState('limit');
  const [price,   setPrice]   = useState('');
  const [amount,  setAmount]  = useState('');
  // Market buy convenience: user can type quote spend (USDT) and see base qty.
  const [marketSpendUsdt, setMarketSpendUsdt] = useState('');
  /** Limit order: quote (USDT) notional — synced with amount × limit price in real time. */
  const [totalUsdt, setTotalUsdt] = useState('');
  const limitSizeSourceRef = useRef('amount'); // 'amount' | 'total' — which field user last edited for limit sizing
  const marketBuySizeSourceRef = useRef('amount'); // 'amount' | 'spend'
  const amountRef = useRef(amount);
  const totalUsdtRef = useRef(totalUsdt);
  const limitPriceSyncKeyRef = useRef('');
  amountRef.current = amount;
  totalUsdtRef.current = totalUsdt;
  const [placing, setPlacing] = useState(false);
  const [feeRate, setFeeRate] = useState(DEFAULT_FEE_RATE);
  const [iboPriceUsdt, setIboPriceUsdt] = useState(DEFAULT_IBO_PRICE_USDT);
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [touched, setTouched] = useState({});

  useEffect(() => {
    setAmount('');
    setMarketSpendUsdt('');
    setTotalUsdt('');
    limitSizeSourceRef.current = 'amount';
    marketBuySizeSourceRef.current = 'amount';
    limitPriceSyncKeyRef.current = '';
  }, [symbol]);

  /* Order-book click → prefill limit price only (do not freeze market reference — that uses `lastPrice`). */
  useEffect(() => {
    const s = limitPriceSeed == null ? '' : String(limitPriceSeed).replace(/,/g, '').trim();
    if (!s) return;
    setPrice(s);
  }, [limitPriceSeed, symbol]);

  useEffect(() => {
    if (type === 'market') {
      setTotalUsdt('');
      limitPriceSyncKeyRef.current = '';
    } else {
      setMarketSpendUsdt('');
      marketBuySizeSourceRef.current = 'amount';
    }
  }, [type]);

  const isBuy    = side === 'buy';
  const isMarket = type === 'market';

  /* Limit: when limit price changes (typing or order book), keep amount ↔ total consistent (exchange-style). */
  useEffect(() => {
    if (isMarket) return;
    const px = parseLimitPrice(price);
    if (px == null || px <= 0) return;
    const key = `${symbol}|${price}`;
    if (limitPriceSyncKeyRef.current === key) return;
    limitPriceSyncKeyRef.current = key;
    if (limitSizeSourceRef.current === 'total') {
      const t = parseAmount(totalUsdtRef.current);
      if (t != null && t > 0) setAmount(trimDecimalString(String(t / px), 8));
    } else {
      const a = parseAmount(amountRef.current);
      if (a != null && a > 0) setTotalUsdt(trimDecimalString(String(a * px), 6));
    }
  }, [price, symbol, isMarket]);

  const amtNum   = parseFloat(amount || 0) || 0;
  const markPx   = parseMarketReferencePrice(lastPrice);
  const limitPx  = parseLimitPrice(price);
  const effPrice = isMarket ? (markPx ?? 0) : (limitPx ?? 0);
  const notionalUsdt = effPrice * amtNum;
  const iboBalance = Number(balance?.IBO || 0);
  const avail    = isBuy ? (balance?.[quoteAsset] || 0) : (balance?.[apiBase] || 0);

  const limitRestsOnBook =
    !isMarket && markPx != null && limitPx != null
      ? (isBuy ? limitPx < markPx : limitPx > markPx)
      : false;
  const limitMayCross =
    !isMarket && markPx != null && limitPx != null
      ? (isBuy ? limitPx >= markPx : limitPx <= markPx)
      : false;

  const estFeeIbo = useMemo(() => {
    if (!(amtNum > 0 && effPrice > 0)) return 0;
    if (quoteAsset === 'IBO') return notionalUsdt * feeRate;
    if (!(iboPriceUsdt > 0)) return 0;
    return (notionalUsdt * feeRate) / iboPriceUsdt;
  }, [amtNum, effPrice, notionalUsdt, quoteAsset, feeRate, iboPriceUsdt]);

  const spotCheck = useMemo(
    () =>
      validateSpotOrder({
        symbol,
        side,
        type,
        amountStr: amount,
        priceStr: price,
        currentPrice: lastPrice,
        balanceUSDT: balance?.USDT ?? 0,
        balanceQuote: balance?.[quoteAsset] ?? 0,
        balanceIBO: iboBalance,
        feeRate,
        iboPriceUsdt,
        balanceBase: balance?.[apiBase] ?? 0,
        baseAsset: apiBase,
        quoteAsset,
        userLoggedIn: !!user,
      }),
    [symbol, side, type, amount, price, lastPrice, balance, apiBase, quoteAsset, iboBalance, feeRate, iboPriceUsdt, user],
  );

  useEffect(() => {
    let alive = true;
    marketApi.getTradingFeeConfig()
      .then((cfg) => {
        if (!alive) return;
        if (Number.isFinite(cfg?.taker_fee_rate)) setFeeRate(Number(cfg.taker_fee_rate));
        if (Number.isFinite(cfg?.ibo_price_usdt) && Number(cfg.ibo_price_usdt) > 0) {
          setIboPriceUsdt(Number(cfg.ibo_price_usdt));
        }
      })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  const setPct = pct => {
    limitSizeSourceRef.current = 'amount';
    const next = isBuy
      ? ((avail * (pct / 100)) / (effPrice || 1)).toFixed(6)
      : ((avail * pct) / 100).toFixed(6);
    setAmount(next);
    if (!isMarket) {
      const px = parseLimitPrice(price);
      const a = parseFloat(next) || 0;
      if (px != null && px > 0 && a > 0) setTotalUsdt(trimDecimalString(String(a * px), 6));
      else setTotalUsdt('');
    }
  };

  const onAmountInputChange = e => {
    const v = e.target.value;
    setAmount(v);
    if (isMarket) {
      if (isBuy) {
        marketBuySizeSourceRef.current = 'amount';
        const px = parseMarketReferencePrice(lastPrice);
        const a = parseAmount(v);
        if (px != null && px > 0 && a != null && a > 0) {
          setMarketSpendUsdt(trimDecimalString(String(a * px), 6));
        } else if (!String(v).trim()) {
          setMarketSpendUsdt('');
        }
      }
    } else {
      limitSizeSourceRef.current = 'amount';
      const px = parseLimitPrice(price);
      const a = parseAmount(v);
      if (px != null && px > 0 && a != null && a > 0) {
        setTotalUsdt(trimDecimalString(String(a * px), 6));
      } else if (!String(v).trim()) {
        setTotalUsdt('');
      }
    }
  };

  const onMarketSpendUsdtChange = e => {
    const v = e.target.value;
    setMarketSpendUsdt(v);
    marketBuySizeSourceRef.current = 'spend';
    const px = parseMarketReferencePrice(lastPrice);
    const spend = parseAmount(v);
    if (px != null && px > 0 && spend != null && spend > 0) {
      setAmount(trimDecimalString(String(spend / px), 8));
    } else if (!String(v).trim()) {
      setAmount('');
    }
  };

  const onTotalUsdtInputChange = e => {
    const v = e.target.value;
    setTotalUsdt(v);
    if (!isMarket) {
      limitSizeSourceRef.current = 'total';
      const px = parseLimitPrice(price);
      const t = parseAmount(v);
      if (px != null && px > 0 && t != null && t > 0) {
        setAmount(trimDecimalString(String(t / px), 8));
      } else if (!String(v).trim()) {
        setAmount('');
      }
    }
  };

  // Market buy sync on live ticker updates: if user is sizing by USDT spend,
  // keep estimated quantity fresh with each price tick.
  useEffect(() => {
    if (!isMarket || !isBuy) return;
    if (marketBuySizeSourceRef.current !== 'spend') return;
    const px = parseMarketReferencePrice(lastPrice);
    const spend = parseAmount(marketSpendUsdt);
    if (px != null && px > 0 && spend != null && spend > 0) {
      setAmount(trimDecimalString(String(spend / px), 8));
    }
  }, [isMarket, isBuy, lastPrice, marketSpendUsdt]);

  const handleSubmit = async e => {
    e.preventDefault();
    setSubmitAttempted(true);
    if (!user) {
      if (!spotCheck.ok && spotCheck.message) {
        toast.error('Cannot place order', spotCheck.message);
        return;
      }
      navigate('/login');
      return;
    }
    if (!spotCheck.ok) {
      toast.error('Cannot place order', spotCheck.message || 'Please check your order details and try again.');
      return;
    }

    setPlacing(true);
    try {
      const body = {
        symbol, side, type,
        amount: parseFloat(amount),
        ...(isMarket ? {} : { price: parseFloat(price) }),
      };
      const res  = await authFetch(`${API}/api/orders`, { method: 'POST', body: JSON.stringify(body) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Order placement failed');

      // Build a human-friendly success message
      const isBuyOrd = data.side === 'buy';
      const amtStr = `${Number(data.amount).toFixed(6).replace(/\.?0+$/, '')} ${displayBase}`;
      let title, desc;
      if (data.status === 'filled') {
        const avgStr = data.avg_price > 0 ? ` @ avg $${Number(data.avg_price).toFixed(2)}` : '';
        title = isBuyOrd ? `Bought ${amtStr}` : `Sold ${amtStr}`;
        desc = `Market order filled${avgStr}.${data.total_fee > 0 ? ` Fee: ${data.total_fee.toFixed(6)} ${data.total_fee_asset}` : ''}`;
      } else if (data.status === 'partially_filled') {
        const filledStr = `${Number(data.filled || 0).toFixed(6).replace(/\.?0+$/, '')} ${displayBase}`;
        title = isBuyOrd ? `Partial buy filled` : `Partial sell filled`;
        desc = `${filledStr} filled — remainder is resting on the order book.`;
      } else {
        const priceStr = data.price ? ` @ $${Number(data.price).toLocaleString(undefined, { maximumFractionDigits: 8 })}` : '';
        title = isBuyOrd ? `Limit buy placed` : `Limit sell placed`;
        desc = `${amtStr}${priceStr} — order is now on the book.`;
      }
      toast.success(title, desc);
      upsertOpenOrder(data);

      setAmount('');
      setTotalUsdt('');
      limitSizeSourceRef.current = 'amount';
      limitPriceSyncKeyRef.current = '';
      if (!isMarket) setPrice('');
      setSubmitAttempted(false);
      setTouched({});
      await Promise.all([fetchWallet(), fetchOrders(), fetchLiveSpotPositions()]);
    } catch (err) {
      toast.error('Order failed', friendlyError(err.message));
    } finally {
      setPlacing(false);
    }
  };

  const markTouched = (key) => setTouched((t) => ({ ...t, [key]: true }));
  const shouldShowError = (key) => Boolean(spotCheck.errors[key] && (submitAttempted || touched[key]));

  const fieldBox = (error) =>
    `flex h-10 items-center rounded-md border px-3 transition-colors bg-[color:var(--ibo-card)] ${
      error
        ? 'border-red-500/50'
        : 'border-[color:var(--ibo-border-solid)] focus-within:border-[#C5E35B]/55'
    }`;
  const fieldInput =
    'flex-1 min-w-0 bg-transparent text-[13px] font-mono font-semibold outline-none text-[color:var(--ibo-ink)] placeholder:text-[color:var(--ibo-muted)]';
  const fieldUnit = 'ml-2 shrink-0 text-[12px] font-bold text-[color:var(--ibo-muted)]';
  const fieldLabel = 'block text-[11px] font-semibold text-[color:var(--ibo-muted)] mb-1';
  const fieldHint = 'text-[10px] text-[color:var(--ibo-muted)] mb-1.5 leading-relaxed';

  const kycBlocked = !!user && kyc?.status !== 'approved';

  return (
    <div className="font-ui flex flex-col h-full min-h-0 text-[color:var(--ibo-ink)] bg-[color:var(--ibo-surface)]">
      {/* Buy / Sell */}
      <div className="flex items-center gap-2 px-3 pt-3 pb-2">
        <div className="flex flex-1 rounded-md overflow-hidden border border-[color:var(--ibo-border-solid)]">
          {['buy', 'sell'].map((s) => {
            const on = side === s;
            const buy = s === 'buy';
            return (
              <button
                key={s}
                type="button"
                onClick={() => setSide(s)}
                className={`flex-1 py-2 text-[13px] font-bold transition-colors ${
                  on
                    ? buy
                      ? 'bg-emerald-500/15 text-emerald-600 border-b-2 border-emerald-500'
                      : 'bg-rose-500/15 text-rose-600 border-b-2 border-rose-500'
                    : 'bg-[color:var(--ibo-elevated)] text-[color:var(--ibo-muted)] hover:text-[color:var(--ibo-ink)]'
                }`}
              >
                {buy ? `Buy ${displayBase}` : `Sell ${displayBase}`}
              </button>
            );
          })}
        </div>
      </div>

      {/* Limit / Market */}
      <div className="flex items-center gap-0 px-3 border-b border-[color:var(--ibo-border)]">
        {['limit', 'market'].map((t) => {
          const on = type === t;
          return (
            <button
              key={t}
              type="button"
              onClick={() => setType(t)}
              className="relative px-3 py-2 text-[12px] font-semibold capitalize transition-colors"
              style={{ color: on ? '#0ea4ab' : 'var(--ibo-muted)' }}
            >
              {t}
              {on ? (
                <span className="absolute left-2 right-2 bottom-0 h-0.5 rounded-full bg-[#0ea4ab]" />
              ) : null}
            </button>
          );
        })}
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-3 scrollbar-hide">
        <p className="text-[11px] text-[color:var(--ibo-muted)] leading-relaxed">
          {isMarket
            ? `Fills at the best available prices. Size is in ${displayBase}.`
            : 'Limit rests on the book until the market reaches your price.'}
        </p>

        <div className="flex items-center justify-between gap-2 text-[12px]">
          <span className="flex items-center gap-1.5 font-medium text-[color:var(--ibo-muted)]">
            <Wallet size={13} className="shrink-0" aria-hidden /> Available
          </span>
          <div className="flex items-center gap-2 shrink-0">
            <span className="font-mono font-bold text-[13px] tabular-nums text-[color:var(--ibo-ink)]">
              {isBuy
                ? `${avail.toLocaleString(undefined, { maximumFractionDigits: quoteAsset === 'IBO' ? 4 : 2 })} ${quoteAsset}`
                : `${avail.toFixed(6)} ${displayBase}`}
            </span>
            <Link
              to="/wallet?tab=deposit"
              className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-[#0ea4ab]/35 bg-[#0ea4ab]/10 text-[#0ea4ab] hover:bg-[#0ea4ab]/20 transition-colors"
              title="Deposit"
              aria-label="Deposit"
            >
              <Plus size={16} strokeWidth={2.5} className="shrink-0" aria-hidden />
            </Link>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          {!isMarket ? (
            <div>
              <label className={fieldLabel}>Limit price</label>
              <p className={fieldHint}>
                {quoteAsset} per 1 {displayBase}
              </p>
              <div className={fieldBox(shouldShowError('price'))}>
                <input
                  type="number"
                  step="any"
                  min="0"
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                  onBlur={() => markTouched('price')}
                  placeholder={markPx != null ? String(markPx) : '0'}
                  className={fieldInput}
                  aria-label={`Limit price in ${quoteAsset}`}
                />
                <span className={fieldUnit}>{quoteAsset}</span>
              </div>
              {shouldShowError('price') ? (
                <p className="text-[11px] text-red-500 mt-1 font-medium">{spotCheck.errors.price}</p>
              ) : null}
            </div>
          ) : (
            <div className="flex items-center justify-between rounded-md border border-[color:var(--ibo-border-solid)] bg-[color:var(--ibo-card)] px-3 py-2.5">
              <span className="text-[11px] text-[color:var(--ibo-muted)]">Last price</span>
              <span className="text-[13px] font-mono font-bold tabular-nums text-[#0ea4ab]">
                {markPx != null && markPx > 0
                  ? (isUsdtQuote ? `$${fmtLiveUsdt(markPx)}` : fmtLiveUsdt(markPx))
                  : '—'}
              </span>
            </div>
          )}

          <div>
            <label className={fieldLabel}>
              {isMarket && isBuy ? 'Quantity' : 'Amount'}
            </label>
            {!(isMarket && isBuy) ? (
              <p className={fieldHint}>
                Min {MIN_BASE_AMOUNT} {displayBase} · Min notional {MIN_ORDER_VALUE_USDT.toFixed(2)} {quoteAsset}
              </p>
            ) : null}
            <div
              className={fieldBox(
                (spotCheck.errors.amount || spotCheck.errors.balance)
                && (submitAttempted || touched.amount || touched.balance),
              )}
            >
              <input
                type="number"
                step="any"
                min="0"
                value={amount}
                onChange={onAmountInputChange}
                onBlur={() => { markTouched('amount'); markTouched('balance'); }}
                placeholder="0.0000"
                className={fieldInput}
              />
              <span className={fieldUnit}>{displayBase}</span>
            </div>
            {shouldShowError('amount') ? (
              <p className="text-[11px] text-red-500 mt-1 font-medium">{spotCheck.errors.amount}</p>
            ) : null}
            {shouldShowError('balance') ? (
              <p className="text-[11px] text-red-500 mt-1 font-medium">{spotCheck.errors.balance}</p>
            ) : null}
            {shouldShowError('symbol') ? (
              <p className="text-[11px] text-red-500 mt-1 font-medium">{spotCheck.errors.symbol}</p>
            ) : null}
          </div>

          {isMarket && isBuy ? (
            <div>
              <label className={fieldLabel}>Spend ({quoteAsset})</label>
              <div className={fieldBox(false)}>
                <input
                  type="number"
                  step="any"
                  min="0"
                  value={marketSpendUsdt}
                  onChange={onMarketSpendUsdtChange}
                  placeholder="0.00"
                  className={fieldInput}
                  aria-label={`Market buy spend in ${quoteAsset}`}
                />
                <span className={fieldUnit}>{quoteAsset}</span>
              </div>
            </div>
          ) : null}

          {!isMarket ? (
            <div>
              <label className={fieldLabel}>Total</label>
              <p className={fieldHint}>
                Order value in {quoteAsset} — edit to size by quote
              </p>
              <div className={fieldBox(shouldShowError('total'))}>
                <input
                  type="number"
                  step="any"
                  min="0"
                  value={totalUsdt}
                  onChange={onTotalUsdtInputChange}
                  onBlur={() => markTouched('total')}
                  placeholder="0.00"
                  className={fieldInput}
                  aria-label={`Limit order total in ${quoteAsset}`}
                />
                <span className={fieldUnit}>{quoteAsset}</span>
              </div>
              {shouldShowError('total') ? (
                <p className="text-[11px] text-red-500 mt-1 font-medium">{spotCheck.errors.total}</p>
              ) : null}
            </div>
          ) : null}

          <div className="grid grid-cols-4 gap-1.5">
            {PCTS.map((pct) => (
              <button
                key={pct}
                type="button"
                onClick={() => setPct(pct)}
                className="h-8 text-[11px] rounded-md border border-[color:var(--ibo-border-solid)]
                  bg-[color:var(--ibo-card)] text-[color:var(--ibo-muted)] font-semibold
                  hover:border-[#0ea4ab]/45 hover:text-[#0ea4ab] transition-colors"
              >
                {pct}%
              </button>
            ))}
          </div>

          {/* Compact summary */}
          <div className="rounded-md border border-[color:var(--ibo-border-solid)] bg-[color:var(--ibo-card)] px-3 py-2.5 space-y-1.5 text-[11px]">
            <div className="flex justify-between gap-2">
              <span className="text-[color:var(--ibo-muted)]">Last</span>
              <span className="font-mono font-semibold tabular-nums">
                {markPx != null && markPx > 0
                  ? (isUsdtQuote ? `$${fmtLiveUsdt(markPx)}` : `${fmtLiveUsdt(markPx)} ${quoteAsset}`)
                  : '—'}
              </span>
            </div>
            {!isMarket ? (
              <div className="flex justify-between gap-2">
                <span className="text-[color:var(--ibo-muted)]">Your limit</span>
                <span className="font-mono font-semibold tabular-nums text-[#0ea4ab]">
                  {limitPx != null
                    ? (isUsdtQuote
                      ? `$${limitPx.toLocaleString(undefined, { maximumFractionDigits: 8 })}`
                      : `${limitPx.toLocaleString(undefined, { maximumFractionDigits: 8 })} ${quoteAsset}`)
                    : '—'}
                </span>
              </div>
            ) : null}
            <div className="flex justify-between gap-2">
              <span className="text-[color:var(--ibo-muted)]">Size</span>
              <span className="font-mono font-semibold tabular-nums">
                {amtNum > 0 ? `${amtNum.toLocaleString(undefined, { maximumFractionDigits: 8 })} ${displayBase}` : '—'}
              </span>
            </div>
            <div className="flex justify-between gap-2">
              <span className="text-[color:var(--ibo-muted)]">{isMarket ? 'Est. total' : 'Total'}</span>
              <span className="font-mono font-semibold tabular-nums">
                {amtNum > 0 && effPrice > 0
                  ? (isUsdtQuote
                    ? `$${notionalUsdt.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`
                    : `${notionalUsdt.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })} ${quoteAsset}`)
                  : '—'}
              </span>
            </div>
            {amtNum > 0 ? (
              <div className="flex justify-between gap-2 pt-1.5 border-t border-[color:var(--ibo-border)]">
                <span className="text-[color:var(--ibo-muted)]">Est. fee ({(feeRate * 100).toFixed(3)}%)</span>
                <span className="font-mono font-semibold">{estFeeIbo.toFixed(8)} IBO</span>
              </div>
            ) : null}
            {!isMarket && markPx != null && limitPx != null && amtNum > 0 ? (
              <p
                className={`text-[10px] leading-snug pt-1 ${
                  limitRestsOnBook
                    ? 'text-sky-600'
                    : limitMayCross
                      ? 'text-[#0ea4ab]'
                      : 'text-[color:var(--ibo-muted)]'
                }`}
              >
                {limitRestsOnBook
                  ? 'Rests on the book until the market reaches your limit.'
                  : limitMayCross
                    ? 'At or better than mark — may fill immediately.'
                    : 'Check limit vs mark before submitting.'}
              </p>
            ) : null}
          </div>

          {!user ? (
            <div className="text-center space-y-2 pt-1">
              <p className="text-[12px] text-[color:var(--ibo-muted)]">Sign in to start trading</p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => navigate('/login')}
                  className="flex-1 h-10 rounded-md bg-[#0ea4ab] hover:brightness-110 text-white font-bold text-[13px] transition-all"
                >
                  Log In
                </button>
                <button
                  type="button"
                  onClick={() => navigate('/register')}
                  className="flex-1 h-10 rounded-md border border-[color:var(--ibo-border-solid)] text-[color:var(--ibo-ink)] hover:bg-[color:var(--ibo-elevated)] font-bold text-[13px] transition-all"
                >
                  Register
                </button>
              </div>
            </div>
          ) : null}

          {kycBlocked ? (
            <div
              className={`rounded-md p-3 border ${
                kyc?.status === 'pending'
                  ? 'bg-[#0ea4ab]/10 border-[#0ea4ab]/25'
                  : 'bg-red-500/8 border-red-500/25'
              }`}
            >
              <p
                className={`font-bold flex items-center gap-2 mb-1.5 text-[12px] ${
                  kyc?.status === 'pending' ? 'text-[#0ea4ab]' : 'text-red-500'
                }`}
              >
                {kyc?.status === 'pending' ? (
                  <><Clock size={13} /> KYC under review</>
                ) : (
                  <><Shield size={13} /> Verify to trade</>
                )}
              </p>
              <p className="text-[11px] text-[color:var(--ibo-muted)] mb-2 leading-relaxed">
                {kyc?.status === 'pending'
                  ? 'Trading unlocks once identity verification is approved.'
                  : kyc?.status === 'rejected'
                    ? 'Your KYC was rejected. Please resubmit with valid documents.'
                    : 'Complete identity verification to start trading.'}
              </p>
              <Link
                to="/kyc"
                className="inline-flex items-center gap-1.5 text-[12px] font-bold text-[#0ea4ab] hover:underline"
              >
                <Shield size={12} />
                {kyc?.status === 'pending' ? 'Check status' : kyc?.status === 'rejected' ? 'Resubmit KYC' : 'Get verified →'}
              </Link>
            </div>
          ) : null}

          {kycBlocked ? (
            <Link
              to="/kyc"
              className="flex w-full h-11 items-center justify-center rounded-md text-[14px] font-extrabold bg-[#C5E35B] text-[#0a0f1a] hover:brightness-110"
            >
              Get Verified To Trade
            </Link>
          ) : (
            <button
              type="submit"
              disabled={placing || !user}
              className={`w-full h-11 rounded-md text-[14px] font-extrabold transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                isBuy
                  ? 'bg-emerald-500 hover:bg-emerald-600 text-white'
                  : 'bg-rose-500 hover:bg-rose-600 text-white'
              }`}
            >
              {placing ? (
                <span className="inline-flex items-center justify-center gap-2">
                  <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  Placing…
                </span>
              ) : isBuy ? (
                `Buy ${displayBase}`
              ) : (
                `Sell ${displayBase}`
              )}
            </button>
          )}
        </form>
      </div>
    </div>
  );
}

