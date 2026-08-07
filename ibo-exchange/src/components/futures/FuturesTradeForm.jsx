/**

 * FuturesTradeForm

 *

 * Price field behaviour (identical to spot TradeForm):

 *   - Starts EMPTY. The current mark/best-bid-ask is shown only as a placeholder.

 *   - User types their own price freely. It never auto-overwrites what they typed.

 *   - "Latest" button → one-shot snap to the current best bid (buy) or ask (sell),

 *     exactly like clicking a level in the order book. After that the field is

 *     static again — no live tracking.

 *   - When price changes → qty / order-value / margin re-derive from whichever

 *     size field was last edited (sizeSourceRef), identical to spot's

 *     amount ↔ total sync.

 *

 * Bidirectional Quantity ↔ Order value (USDT) ↔ Margin (USDT):

 *   Edit any one of the three → the other two recalculate instantly.

 *

 * Leverage change → Margin re-derives; order value / qty are unchanged.

 *

 * Symbol switch → all inputs reset.

 */

import { useEffect, useMemo, useRef, useState, memo } from 'react';

import { Shield, Clock } from 'lucide-react';

import { Link } from 'react-router-dom';

import { useAuth } from '@/context/AuthContext';

import { useFutures } from '@/context/FuturesContext';

import { futuresApi } from '@/services/futuresApi';

import { marketApi } from '@/services/marketApi';

import LeverageSelector from './LeverageSelector';

import { useToast, friendlyError } from '@/context/ToastContext';

import { estimateIboFee, formatIboFee, feeRatesForVenue } from '@/lib/iboFee';



const TYPES = [

  { id: 'limit',  label: 'Limit' },

  { id: 'market', label: 'Market' },

  { id: 'maker',  label: 'Maker Only' },

];



const SIZE_PCTS = [10, 25, 50, 75, 100];



// ── Liquidation-price helpers (mirrors backend risk.py exactly) ────────────

// Each tier: [maxNotional, maxLeverage, IMR, MMR]

const LEVERAGE_TIERS = {

  'BTCUSDT-PERP':  [[50_000,100,0.004,0.005],[250_000,100,0.005,0.0065],[1_000_000,50,0.01,0.013],[5_000_000,20,0.025,0.030]],

  'ETHUSDT-PERP':  [[50_000,100,0.005,0.0065],[250_000,50,0.01,0.013],[1_000_000,20,0.025,0.030]],

  'BNBUSDT-PERP':  [[50_000,100,0.005,0.0065],[250_000,50,0.01,0.013],[1_000_000,20,0.025,0.030]],

  'SOLUSDT-PERP':  [[50_000,50,0.01,0.013],[250_000,20,0.025,0.030]],

  'XRPUSDT-PERP':  [[50_000,50,0.01,0.013],[250_000,20,0.025,0.030]],

  'DOGEUSDT-PERP': [[50_000,50,0.01,0.013],[250_000,20,0.025,0.030]],

  'ADAUSDT-PERP':  [[50_000,50,0.01,0.013],[250_000,20,0.025,0.030]],

  'POLUSDT-PERP':  [[50_000,50,0.01,0.013],[250_000,20,0.025,0.030]],

  'AVAXUSDT-PERP': [[50_000,50,0.01,0.013],[250_000,20,0.025,0.030]],

  'DOTUSDT-PERP':  [[50_000,50,0.01,0.013],[250_000,20,0.025,0.030]],

  'LINKUSDT-PERP': [[50_000,50,0.01,0.013],[250_000,20,0.025,0.030]],

  'LTCUSDT-PERP':  [[50_000,50,0.01,0.013],[250_000,20,0.025,0.030]],

};

const LIQ_FEE_RATE  = 0.005;   // matches LIQUIDATION_FEE_RATE in backend

const INSURANCE_CUT = 0.001;   // matches INSURANCE_HAIRCUT (early-trigger buffer)



function _tierFor(symbol, notional) {

  const tiers = LEVERAGE_TIERS[symbol] || [[1_000_000, 10, 0.05, 0.025]];

  for (const t of tiers) if (notional <= t[0]) return t;

  return tiers[tiers.length - 1];

}



/**

 * Exact isolated-margin liquidation price.

 *

 * Derived from the actual liquidation trigger: equity ≤ maintenance_margin

 *   Long:  equity = IM + (liq − entry) × qty  →  liq = entry × (1−IMR)/(1−MMR−ins)

 *   Short: equity = IM + (entry − liq) × qty  →  liq = entry × (1+IMR)/(1+MMR+ins)

 *

 * This NEVER produces liq > entry for longs or liq < entry for shorts,

 * unlike the old linear approximation which broke at high leverage (≥90×).

 */

function calcLiqPrice(symbol, side, entryPrice, leverage, notional) {

  if (!entryPrice || entryPrice <= 0 || !leverage) return null;

  const lev = Math.max(1, leverage);

  const [, , tierImr, mmr] = _tierFor(symbol, notional || entryPrice);

  const imr = Math.max(1 / lev, tierImr);

  if (side === 'buy') {

    // Long — liquidated when price falls

    const denom = 1 - mmr - INSURANCE_CUT;

    if (denom <= 0) return null;

    const liq = entryPrice * (1 - imr) / denom;

    // Sanity: for a long the liq price must be below the entry price

    return liq > 0 && liq < entryPrice ? liq : null;

  } else {

    // Short — liquidated when price rises

    const denom = 1 + mmr + INSURANCE_CUT;

    const liq = entryPrice * (1 + imr) / denom;

    // Sanity: for a short the liq price must be above the entry price

    return liq > entryPrice ? liq : null;

  }

}



// ── Number helpers ────────────────────────────────────────────────────────



function decimalsFor(step) {

  const t = Number(step) || 0.01;

  if (t >= 1) return 0;

  return Math.max(0, Math.min(8, -Math.floor(Math.log10(t))));

}



/** Align to nearest tick and render with tick's natural precision. */

function tickAlign(value, tick) {

  if (!Number.isFinite(value) || value <= 0) return '';

  const t = Number(tick) || 0.01;

  const v = Math.round(value / t) * t;

  return v.toFixed(decimalsFor(t));

}



/** Floor a quantity to the nearest lot and strip trailing zeros. */

function lotFloor(value, lot) {

  if (!Number.isFinite(value) || value <= 0) return '';

  const t = Number(lot) || 0.001;

  const v = Math.floor(value / t) * t;

  if (v <= 0) return '';

  return v.toFixed(decimalsFor(t)).replace(/\.?0+$/, '') || '0';

}



/** Round a USDT amount to ``dp`` decimals, strip trailing zeros. */

function trimUsdt(value, dp = 4) {

  if (!Number.isFinite(value) || value <= 0) return '';

  return value.toFixed(dp).replace(/\.?0+$/, '');

}



/** Walk the visible order-book to estimate a market order's avg / worst / slippage. */

function walkBook(levels, qty) {

  if (!levels?.length || !qty || qty <= 0) return null;

  let need = qty;

  let cost = 0;

  let last = 0;

  for (const lv of levels) {

    const lvQty = Number(lv.qty || 0);

    const lvPx  = Number(lv.price || 0);

    if (lvQty <= 0 || lvPx <= 0) continue;

    const take = Math.min(need, lvQty);

    cost += take * lvPx;

    last  = lvPx;

    need -= take;

    if (need <= 1e-12) break;

  }

  const filled = qty - Math.max(0, need);

  if (filled <= 0) return null;

  const avg = cost / filled;

  const top = Number(levels[0]?.price || 0);

  return {

    avg, last,

    exhausted: need > 1e-12,

    filled,

    slippage_pct: top ? Math.abs(avg - top) / top * 100 : 0,

  };

}



/** Keep last good top-of-book prices — never flash to zero between WS ticks. */

function topOfBook(orderbook) {

  let bestBid = 0;

  let bestAsk = 0;

  for (const lv of orderbook?.bids || []) {

    const p = Number(lv?.price ?? lv?.[0] ?? 0);

    if (p > bestBid) bestBid = p;

  }

  for (const lv of orderbook?.asks || []) {

    const p = Number(lv?.price ?? lv?.[0] ?? 0);

    if (p > 0 && (bestAsk === 0 || p < bestAsk)) bestAsk = p;

  }

  return { bestBid, bestAsk };

}



function useStickyLiveQuotes({ symbol, wsIndex, wsMark, seedMark, orderbook, recentTrades }) {

  const sticky = useRef({ mark: 0, index: 0, bestBid: 0, bestAsk: 0, last: 0, spread: 0 });



  useEffect(() => {

    sticky.current = { mark: 0, index: 0, bestBid: 0, bestAsk: 0, last: 0, spread: 0 };

  }, [symbol]);



  const rawIndex = Number(wsIndex || 0);

  const rawMark  = Number(wsMark || 0);

  const markRaw  = rawIndex || rawMark || Number(seedMark || 0);

  const indexRaw = rawIndex || Number(seedMark || 0);

  const { bestBid: bidRaw, bestAsk: askRaw } = topOfBook(orderbook);

  const lastRaw  = Number(recentTrades?.[0]?.price || 0);



  if (markRaw > 0)  sticky.current.mark    = markRaw;

  if (indexRaw > 0) sticky.current.index   = indexRaw;

  if (bidRaw > 0)   sticky.current.bestBid = bidRaw;

  if (askRaw > 0)   sticky.current.bestAsk = askRaw;

  if (lastRaw > 0)  sticky.current.last    = lastRaw;



  const mark    = markRaw  > 0 ? markRaw  : sticky.current.mark;

  const index   = indexRaw > 0 ? indexRaw : sticky.current.index;

  const bestBid = bidRaw   > 0 ? bidRaw   : sticky.current.bestBid;

  const bestAsk = askRaw   > 0 ? askRaw   : sticky.current.bestAsk;

  const last    = lastRaw  > 0 ? lastRaw  : sticky.current.last;

  const spreadRaw = bestBid > 0 && bestAsk > 0 ? bestAsk - bestBid : 0;

  if (spreadRaw > 0) sticky.current.spread = spreadRaw;

  const spread = spreadRaw > 0 ? spreadRaw : sticky.current.spread;



  return { mark, index, bestBid, bestAsk, last, spread };

}



// ── Main component ────────────────────────────────────────────────────────



export default function FuturesTradeForm({ symbol, limitPriceSeed = null }) {

  const { user, kyc, balance } = useAuth();

  const {

    wallet, settings, placeOrder, activeMark, symbols, orderbook, recentTrades,

    refreshAccount, upsertOpenOrder,

  } = useFutures();

  const toast = useToast();



  // ── Derived symbol metadata ──────────────────────────────────────────

  const meta     = useMemo(() => symbols.find((s) => s.symbol === symbol) || {}, [symbols, symbol]);

  const base     = meta.base || (symbol || '').replace(/USDT.*/i, '') || 'BASE';

  const leverage = settings[symbol]?.leverage ?? 10;

  const tick     = Number(meta.tick_size || 0.01);

  const lot      = Number(meta.lot_size  || 0.001);

  // Use `available` (unencumbered USDT) — the backend locks against this field,

  // not free_margin. free_margin includes unrealized PnL which can't be pledged

  // as margin for NEW isolated positions, so using it causes the UI to allow

  // orders that the backend will reject with InsufficientFundsError.

  const free     = Number(wallet?.available || 0);



  // ── Live market data ─────────────────────────────────────────────────

  // REST-seed the mark price so the placeholder is visible immediately,

  // before the first WS tick arrives.

  const [seedMark, setSeedMark] = useState(0);

  useEffect(() => {

    let cancelled = false;

    if (!symbol) return undefined;

    futuresApi.markPrice(symbol)

      .then((r) => {

        const px = Number(r?.mark_price || r?.index_price || 0);

        if (!cancelled && px > 0) setSeedMark(px);

      })

      .catch(() => {});

    return () => { cancelled = true; };

  }, [symbol]);



  // index_price is now fed from Binance's live miniTicker WS (FuturesContext),

  // so it updates in real-time even when the backend mark is stale.

  // Use index as the primary live reference; fall back to backend mark only

  // when no index is available yet.

  const wsIndex = Number(activeMark?.index_price || 0);

  const wsMark  = Number(activeMark?.mark_price  || 0);

  const { mark, index, bestBid, bestAsk, last, spread } = useStickyLiveQuotes({

    symbol, wsIndex, wsMark, seedMark, orderbook, recentTrades,

  });



  // ── User inputs ──────────────────────────────────────────────────────

  const [side,       setSide]    = useState('buy');

  const [type,       setType]    = useState('market');

  const [price,      setPrice]   = useState('');     // empty by default (same as spot)

  const [stopPrice,  setStop]    = useState('');

  const [qty,        setQty]     = useState('');

  const [totalUsdt,  setTotal]   = useState('');     // order value = qty × price

  const [marginUsdt, setMargin]  = useState('');     // = totalUsdt / leverage

  const [reduceOnly, setRO]      = useState(false);

  const [tif,        setTif]     = useState('GTC');

  const [busy,       setBusy]    = useState(false);

  const [err,        setErr]     = useState(null);

  const [feeConfig, setFeeConfig] = useState(null);



  useEffect(() => {

    let cancelled = false;

    marketApi.getTradingFeeConfig()

      .then((cfg) => { if (!cancelled) setFeeConfig(cfg); })

      .catch(() => {});

    return () => { cancelled = true; };

  }, []);



  // Tracks which size field the user last touched so that when the price

  // changes (user typing or "Latest" snap) the correct companion field is

  // re-derived, identical to spot's `limitSizeSourceRef`.

  const sizeSourceRef  = useRef('qty');

  // De-dup key so the price-change sync effect doesn't re-run for the same

  // (symbol, price) pair twice in a row — same technique as spot's

  // `limitPriceSyncKeyRef`.

  const priceSyncKeyRef = useRef('');



  // Stable mirrors so effects can read current values without adding them

  // to dependency arrays (prevents feedback loops).

  const qtyRef    = useRef(qty);

  const totalRef  = useRef(totalUsdt);

  const marginRef = useRef(marginUsdt);

  const priceRef  = useRef(price);   // always holds the latest price string

  qtyRef.current    = qty;

  totalRef.current  = totalUsdt;

  marginRef.current = marginUsdt;

  priceRef.current  = price;



  // ── Reset on symbol change ───────────────────────────────────────────

  useEffect(() => {

    setPrice(''); setStop(''); setQty(''); setTotal(''); setMargin('');

    setErr(null);

    sizeSourceRef.current  = 'qty';

    priceSyncKeyRef.current = '';

  }, [symbol]);



  // ── Order-book row click → pre-fill price ────────────────────────────

  // `limitPriceSeed` is { symbol, price } — we only apply it when the seed

  // is for THIS symbol, so switching pairs never carries over a stale price.

  useEffect(() => {

    if (!limitPriceSeed?.price || limitPriceSeed.symbol !== symbol) return;

    priceSyncKeyRef.current = ''; // allow the sync effect to re-run

    setPrice(String(limitPriceSeed.price));

  }, [limitPriceSeed, symbol]);



  // Clear sizes when switching to market (no price, no total field).

  useEffect(() => {

    if (type === 'market') {

      setTotal('');

      priceSyncKeyRef.current = '';

    }

  }, [type]);



  const isMarket = type === 'market';

  const isLimitLike = type === 'limit' || type === 'maker';

  const submitType = type === 'maker' ? 'limit' : type;



  // ── Price → size sync (same as spot's equivalent effect) ────────────

  // When the limit price changes (user typing or "Latest" button), keep

  // qty / order-value / margin consistent.

  useEffect(() => {

    if (isMarket) return;

    const px = parseFloat(price);

    if (!Number.isFinite(px) || px <= 0) return;

    const key = `${symbol}|${price}`;

    if (priceSyncKeyRef.current === key) return;

    priceSyncKeyRef.current = key;



    const lev = Math.max(1, leverage);

    const src = sizeSourceRef.current;



    if (src === 'total') {

      const t = parseFloat(totalRef.current);

      if (Number.isFinite(t) && t > 0) {

        setQty(lotFloor(t / px, lot));

        setMargin(trimUsdt(t / lev, 4));

      }

    } else if (src === 'margin') {

      const m = parseFloat(marginRef.current);

      if (Number.isFinite(m) && m > 0) {

        const tot = m * lev;

        setTotal(trimUsdt(tot, 4));

        setQty(lotFloor(tot / px, lot));

      }

    } else {

      const q = parseFloat(qtyRef.current);

      if (Number.isFinite(q) && q > 0) {

        const tot = q * px;

        setTotal(trimUsdt(tot, 4));

        setMargin(trimUsdt(tot / lev, 4));

      }

    }

  }, [price, symbol, type, leverage, lot, isMarket]);



  const limitPx  = isLimitLike ? (parseFloat(price) || 0) : 0;

  const marketPx = isMarket

    ? (side === 'buy' ? (bestAsk || mark || bestBid || last) : (bestBid || mark || bestAsk || last))

    : 0;

  const refPx = isMarket ? marketPx : limitPx;

  const summaryPx = isMarket ? (index || mark || last) : limitPx;



  // ── Bidirectional size-field onChange handlers ───────────────────────

  // Each handler sets its own field and re-derives the other two.



  const onQtyChange = (raw) => {

    sizeSourceRef.current = 'qty';

    setQty(raw);

    const px  = refPx;

    const lev = Math.max(1, leverage);

    const q   = parseFloat(raw);

    if (!Number.isFinite(q) || q <= 0 || px <= 0) { setTotal(''); setMargin(''); return; }

    const tot = q * px;

    setTotal(trimUsdt(tot, 4));

    setMargin(trimUsdt(tot / lev, 4));

  };



  const onTotalChange = (raw) => {

    sizeSourceRef.current = 'total';

    setTotal(raw);

    const px  = refPx;

    const lev = Math.max(1, leverage);

    const t   = parseFloat(raw);

    if (!Number.isFinite(t) || t <= 0 || px <= 0) { setQty(''); setMargin(''); return; }

    setQty(lotFloor(t / px, lot));

    setMargin(trimUsdt(t / lev, 4));

  };



  const onMarginChange = (raw) => {

    sizeSourceRef.current = 'margin';

    setMargin(raw);

    const px  = isMarket ? refPx : (parseFloat(priceRef.current) || 0);

    const lev = Math.max(1, leverage);

    const m   = parseFloat(raw);

    if (!Number.isFinite(m) || m <= 0) { setQty(''); setTotal(''); return; }

    const tot = m * lev;

    setTotal(trimUsdt(tot, 4));

    if (px > 0) setQty(lotFloor(tot / px, lot));

  };



  // ── Leverage-change propagation ──────────────────────────────────────

  // When leverage changes, re-derive Margin from the current order value.

  const prevLevRef = useRef(leverage);

  useEffect(() => {

    if (leverage === prevLevRef.current) return;

    prevLevRef.current = leverage;

    const lev = Math.max(1, leverage);

    const t   = parseFloat(totalRef.current);

    if (Number.isFinite(t) && t > 0) {

      setMargin(trimUsdt(t / lev, 4));

    }

  }, [leverage]);



  // ── Margin → Quantity sync effect ────────────────────────────────────

  // Ensures Quantity is always derived when:

  //   a) user fills Margin first, then types the Limit price, OR

  //   b) the price changes while Margin is the active size source.

  // This complements the inline handler and covers cases where the closure

  // in onMarginChange held a stale refPx (e.g. React concurrent re-renders).

  useEffect(() => {

    if (isMarket) return;

    if (sizeSourceRef.current !== 'margin') return;

    const px = parseFloat(price);

    if (!Number.isFinite(px) || px <= 0) return;

    const m   = parseFloat(marginRef.current);

    if (!Number.isFinite(m) || m <= 0) return;

    const lev = Math.max(1, leverage);

    const tot = m * lev;

    setTotal(trimUsdt(tot, 4));

    setQty(lotFloor(tot / px, lot));

  }, [price, leverage, lot, isMarket]);



  // ── Derived summary values ───────────────────────────────────────────

  const qtyNum        = Math.max(0, parseFloat(qty || 0) || 0);

  const notional      = isMarket && qtyNum > 0 ? qtyNum * marketPx : qtyNum * limitPx;

  const initialMargin = leverage > 0 && notional > 0 ? notional / leverage : 0;

  const insufficient  = !!user && initialMargin > 0 && initialMargin > free;



  const marketFill = useMemo(() => {

    if (!isMarket || qtyNum <= 0) return null;

    const levels = side === 'buy' ? orderbook?.asks : orderbook?.bids;

    return walkBook(levels, qtyNum);

  }, [isMarket, side, qtyNum, orderbook]);



  // Maker when the limit price rests without crossing; taker when it crosses.

  const limitRestsBook = !!(

    isLimitLike && mark > 0 && limitPx > 0 &&

    (side === 'buy' ? limitPx < mark : limitPx > mark)

  );

  const limitCrossBook = !!(

    isLimitLike && mark > 0 && limitPx > 0 && !limitRestsBook

  );

  const limitRole = isLimitLike && limitPx > 0

    ? (limitRestsBook ? 'maker' : 'taker')

    : null;



  const futRates = feeRatesForVenue(feeConfig, 'futures');

  const feeRate = limitRole === 'maker' ? futRates.maker : futRates.taker;

  const iboPx = Number(feeConfig?.ibo_price_usdt) || 0.4523;

  const estFeeIbo = estimateIboFee({

    quoteNotional: notional,

    feeRate,

    quoteAsset: 'USDT',

    iboPriceUsdt: iboPx,

  });

  const availIbo = Number(balance?.Delta ?? 0);

  const insufficientIboFee = !!user && estFeeIbo > 0 && estFeeIbo > availIbo + 1e-12;

  // Liq estimate always uses the live index price so it updates in real-time.

  const liqEst = calcLiqPrice(symbol, side, summaryPx, leverage, notional);



  // ── % of free margin shortcut ─────────────────────────────────────────

  const onPickPct = (pct) => {

    if (!refPx || refPx <= 0 || !free) return;

    const targetMargin = (free * pct) / 100;

    onMarginChange(trimUsdt(targetMargin, 4));

  };



  // ── "Latest" button ───────────────────────────────────────────────────

  // One-shot snap to the best bid (buy) / best ask (sell), exactly like

  // clicking an order-book row in the spot view. After the snap the field

  // stays static until the user types or clicks Latest again.

  const snapToLatest = () => {

    const ref = side === 'buy'

      ? (bestBid || mark || bestAsk || last)

      : (bestAsk || mark || bestBid || last);

    if (!ref) return;

    const aligned = tickAlign(ref, tick);

    priceSyncKeyRef.current = ''; // force sync effect to re-run

    setPrice(aligned);

  };



  // ── Order submission ─────────────────────────────────────────────────

  const submit = async () => {

    setErr(null);

    if (kyc?.status !== 'approved') {

      toast.error('KYC required', 'Complete identity verification before trading futures.');

      return;

    }

    if (type === 'maker' && limitCrossBook) {

      setErr('Maker Only orders cannot cross the book. Adjust your price.');

      return;

    }

    if (insufficientIboFee) {

      setErr(`Insufficient Delta for fee (need ~${formatIboFee(estFeeIbo)}).`);

      return;

    }

    try {

      setBusy(true);

      const order = await placeOrder({

        symbol, side, type: submitType,

        quantity:   qtyNum,

        price:      isMarket ? null : limitPx || null,

        stop_price: null,

        leverage, tif,

        reduce_only: reduceOnly,

      });

      // Build friendly success message.

      const isLong   = side === 'buy';

      const qtyStr   = `${qtyNum} ${base}`;

      const execType = order.type || type;

      let title, desc;

      if (order.status === 'filled') {

        const fills    = order.fills || [];

        const avgFill  = fills.length

          ? fills.reduce((s, f) => s + Number(f.price || 0) * Number(f.qty || 0), 0)

            / fills.reduce((s, f) => s + Number(f.qty || 0), 0)

          : (order.avg_price || 0);

        const avgStr   = avgFill > 0 ? ` @ $${Number(avgFill).toFixed(2)}` : '';

        title = isLong ? `Long filled — ${qtyStr}` : `Short filled — ${qtyStr}`;

        desc  = `${execType === 'limit' ? 'Limit' : 'Market'} order filled${avgStr}.`;

      } else if (order.status === 'partially_filled') {

        title = isLong ? `Partial long filled` : `Partial short filled`;

        desc  = `${qtyStr} — partial fill received, remainder on the book.`;

      } else {

        const priceStr  = order.price

          ? ` @ $${Number(order.price).toLocaleString(undefined, { maximumFractionDigits: 4 })}`

          : '';

        const typeLabel = execType === 'stop_limit' ? 'Stop-limit'

          : execType === 'market' ? 'Market' : 'Limit';

        title = isLong ? `${typeLabel} long placed` : `${typeLabel} short placed`;

        desc  = `${qtyStr}${priceStr} — resting on the order book.`;

      }

      toast.success(title, desc);

      upsertOpenOrder(order);

      await refreshAccount();

      setQty(''); setTotal(''); setMargin('');

      sizeSourceRef.current = 'qty';

    } catch (e) {

      toast.error('Order failed', friendlyError(e?.detail || e?.message));

    } finally {

      setBusy(false);

    }

  };



  // ── Render ───────────────────────────────────────────────────────────



  // ── Placeholder for the price input ─────────────────────────────────

  // Shows the live mark/best-bid-ask so the user knows what level to fill

  // at — but it never auto-writes to the field.

  const pricePlaceholder = (() => {

    const ref = side === 'buy'

      ? (bestBid || mark || bestAsk || last)

      : (bestAsk || mark || bestBid || last);

    return ref ? tickAlign(ref, tick) : '0.00';

  })();



  const kycBlocked = !!user && kyc?.status !== 'approved';

  const canSubmit = !!user && !busy && !insufficient && qtyNum > 0 && !kycBlocked

    && (isMarket || (limitPx > 0))

    && !(type === 'maker' && limitCrossBook);



  const submitLabel = !user

    ? 'Sign in to trade'

    : kycBlocked

      ? 'Get Verified To Trade'

      : busy

        ? 'Placing…'

        : side === 'buy'

          ? `Buy / Long ${base}`

          : `Sell / Short ${base}`;



  return (

    <div className="font-ui flex flex-col h-full min-h-0 text-[color:var(--ibo-ink)]">

      {/* Long / Short */}

      <div className="flex items-center gap-2 px-3 pt-3 pb-2">

        <div className="flex flex-1 rounded-md overflow-hidden border border-[color:var(--ibo-border-solid)]">

          <button

            type="button"

            onClick={() => setSide('buy')}

            className={`flex-1 py-2 text-[13px] font-bold transition-colors ${

              side === 'buy'

                ? 'bg-emerald-500/15 text-emerald-400 border-b-2 border-emerald-400'

                : 'bg-transparent text-[color:var(--ibo-muted)] hover:bg-[rgba(254,108,2,0.08)] hover:text-[#FE6C02]'

            }`}

          >

            Long

          </button>

          <button

            type="button"

            onClick={() => setSide('sell')}

            className={`flex-1 py-2 text-[13px] font-bold transition-colors ${

              side === 'sell'

                ? 'bg-rose-500/15 text-rose-400 border-b-2 border-rose-400'

                : 'bg-transparent text-[color:var(--ibo-muted)] hover:bg-[rgba(254,108,2,0.08)] hover:text-[#FE6C02]'

            }`}

          >

            Short

          </button>

        </div>

      </div>

      {/* Full-width Delta-style leverage range */}

      <LeverageSelector symbol={symbol} max={meta.max_leverage} />



      {/* Order type tabs */}

      <div className="flex items-center gap-0 px-3 border-b border-[color:var(--ibo-border)]">

        {TYPES.map((t) => {

          const on = type === t.id;

          return (

            <button

              key={t.id}

              type="button"

              onClick={() => setType(t.id)}

              className="relative px-3 py-2 text-[12px] font-semibold transition-colors"

              style={{ color: on ? '#FE6C02' : 'var(--ibo-muted)' }}

            >

              {t.label}

              {on ? <span className="absolute left-2 right-2 bottom-0 h-0.5 rounded-full bg-[#FE6C02]" /> : null}

            </button>

          );

        })}

      </div>



      <div className="flex-1 overflow-y-auto scrollbar-hide px-3 py-3 space-y-3">

        {isMarket ? (

          <div className="flex items-center justify-between rounded-md bg-[color:var(--ibo-elevated)] border border-white/[.06] px-3 py-2">

            <span className="text-[11px] text-[color:var(--ibo-muted)]">Index (live)</span>

            <LivePriceValue value={summaryPx > 0 ? summaryPx : 0} tick={tick} fallback={pricePlaceholder || '—'} cls="text-[13px] text-[#FE6C02] font-bold" />

          </div>

        ) : (

          <div>

            <div className="flex items-center justify-between mb-1">

              <span className="text-[11px] text-[color:var(--ibo-muted)]">Price</span>

              <button type="button" onClick={snapToLatest} className="text-[11px] font-semibold text-[#FE6C02] hover:underline">

                Latest

              </button>

            </div>

            <input

              type="number"

              inputMode="decimal"

              step={tick}

              value={price}

              onChange={(e) => { priceSyncKeyRef.current = ''; setPrice(e.target.value); }}

              placeholder={pricePlaceholder}

              className="w-full h-10 bg-[color:var(--ibo-card)] border border-[color:var(--ibo-border-solid)] rounded-md px-3 text-[13px] font-mono text-white focus:outline-none focus:border-[#FE6C02]/50 placeholder:text-white/30"

            />

            {type === 'maker' && limitCrossBook ? (

              <p className="text-[10px] mt-1 text-rose-400">Maker Only cannot cross the book — adjust price.</p>

            ) : null}

            {limitRole && type !== 'maker' ? (

              <p className={`text-[10px] mt-1 ${limitRole === 'maker' ? 'text-emerald-400' : 'text-[#FE6C02]'}`}>

                {limitRole === 'maker' ? 'Rests on book (maker)' : 'Crosses book (taker)'}

              </p>

            ) : null}

          </div>

        )}



        <div>

          <div className="flex items-center justify-between mb-1">

            <span className="text-[11px] text-[color:var(--ibo-muted)]">Enter Quantity</span>

            <span className="text-[10px] text-[color:var(--ibo-muted)]">Lot</span>

          </div>

          <div className="flex items-center h-10 rounded-md border border-[color:var(--ibo-border-solid)] bg-[color:var(--ibo-card)] px-3">

            <input

              type="number"

              inputMode="decimal"

              step={lot}

              value={qty}

              onChange={(e) => onQtyChange(e.target.value)}

              placeholder="0"

              className="flex-1 bg-transparent outline-none text-[13px] font-mono text-white placeholder:text-white/25"

            />

            <span className="text-[11px] text-[color:var(--ibo-muted)] font-semibold shrink-0">{base}</span>

          </div>

          <p className="text-[10px] text-[color:var(--ibo-muted)] mt-1">1 Lot = {lot} {base}</p>

        </div>



        <div className="grid grid-cols-5 gap-1">

          {SIZE_PCTS.map((p) => (

            <button

              key={p}

              type="button"

              onClick={() => onPickPct(p)}

              disabled={!user || !refPx || free <= 0}

              className="text-[11px] py-1.5 rounded border border-[color:var(--ibo-border)] text-[color:var(--ibo-muted)] hover:border-[#FE6C02]/40 hover:text-[#FE6C02] disabled:opacity-35 font-semibold"

            >

              {p}%

            </button>

          ))}

        </div>



        {!isMarket ? (

          <SizeField

            label="Order value"

            value={totalUsdt}

            step="any"

            unit="USDT"

            placeholder="0.00"

            onChange={onTotalChange}

          />

        ) : null}



        <div className="space-y-1.5 text-[11px] pt-1">

          <div className="flex justify-between">

            <span className="text-[color:var(--ibo-muted)]">Funds req.</span>

            <span className="font-mono">{initialMargin > 0 ? `~${initialMargin.toFixed(2)} USD` : '~0.00 USD'}</span>

          </div>

          <div className="flex justify-between">

            <span className="text-[color:var(--ibo-muted)]">Available Margin</span>

            <span className="font-mono">{free.toFixed(2)} USD</span>

          </div>

          {estFeeIbo > 0 ? (

            <div className="flex justify-between">

              <span className="text-[color:var(--ibo-muted)]">Est. fee</span>

              <span className={`font-mono ${insufficientIboFee ? 'text-rose-400' : ''}`}>{formatIboFee(estFeeIbo)}</span>

            </div>

          ) : null}

          {liqEst ? (

            <div className="flex justify-between">

              <span className="text-[color:var(--ibo-muted)]">Liq. price (est.)</span>

              <span className="font-mono">{`$${tickAlign(liqEst, tick)}`}</span>

            </div>

          ) : null}

        </div>



        {isMarket && marketFill ? (

          <div className="rounded-md border border-white/[0.06] bg-[color:var(--ibo-elevated)] px-2.5 py-2 space-y-1 text-[11px]">

            <SummaryRow label="Est. avg fill" value={`$${tickAlign(marketFill.avg, tick)}`} />

            <SummaryRow label="Slippage" value={`${marketFill.slippage_pct.toFixed(3)}%`}

              cls={marketFill.slippage_pct > 0.5 ? 'text-rose-400' : 'text-white'} />

          </div>

        ) : null}



        {err ? (

          <div className="text-[11px] rounded border px-2.5 py-1.5 bg-rose-500/10 border-rose-400/30 text-rose-300">{String(err)}</div>

        ) : null}



        {kycBlocked ? (

          <div className={`rounded-lg p-3 border ${

            kyc?.status === 'pending' ? 'bg-[#FE6C02]/10 border-[#FE6C02]/25' : 'bg-rose-500/10 border-rose-500/25'

          }`}>

            <p className="text-[12px] font-bold mb-1 flex items-center gap-1.5">

              {kyc?.status === 'pending' ? <><Clock size={13} /> KYC under review</> : <><Shield size={13} /> Verify to trade</>}

            </p>

            <p className="text-[11px] text-white/70 mb-2 leading-relaxed">

              {kyc?.status === 'pending'

                ? 'Trading unlocks once identity verification is approved.'

                : kyc?.status === 'rejected'

                  ? 'Your KYC was rejected. Please resubmit with valid documents.'

                  : 'Complete identity verification to start futures trading.'}

            </p>

            <Link

              to="/kyc"

              className="inline-flex items-center gap-1.5 text-[12px] font-bold text-[#FE6C02] hover:underline"

            >

              <Shield size={12} />

              {kyc?.status === 'pending' ? 'Check status' : kyc?.status === 'rejected' ? 'Resubmit KYC' : 'Get verified →'}

            </Link>

          </div>

        ) : null}



        {kycBlocked ? (

          <Link

            to="/kyc"

            className="w-full h-11 rounded-md text-[14px] font-extrabold bg-[#FE6C02] text-[#0a0f1a] hover:brightness-110 flex items-center justify-center"

          >

            Get Verified To Trade

          </Link>

        ) : (

          <button

            type="button"

            disabled={!canSubmit}

            onClick={submit}

            className={`w-full h-11 rounded-md text-[14px] font-extrabold transition-colors ${

              side === 'buy'

                ? 'bg-[color:var(--ibo-positive)] hover:brightness-110 text-white'

                : 'bg-[color:var(--ibo-negative)] hover:brightness-110 text-white'

            } disabled:opacity-40 disabled:cursor-not-allowed`}

          >

            {submitLabel}

          </button>

        )}



        <label className="flex items-center gap-2 text-[11px] text-[color:var(--ibo-muted)] cursor-pointer">

          <input type="checkbox" checked={reduceOnly} onChange={(e) => setRO(e.target.checked)} className="accent-[#FE6C02]" />

          Reduce Only

        </label>

      </div>

    </div>

  );

}



// ── Sub-components ────────────────────────────────────────────────────────



function SizeField({ label, value, step, unit, placeholder, onChange, hint, warn }) {

  return (

    <div>

      <label className="block text-[10px] uppercase tracking-widest text-white/50 font-bold mb-1">

        {label}

      </label>

      <div className={`flex items-center bg-[color:var(--ibo-card)] border rounded-lg px-3 py-2.5 transition-colors ${

        warn ? 'border-rose-500/50' : 'border-[color:var(--ibo-border-solid)] focus-within:border-[#FE6C02]/55'

      }`}>

        <input

          type="number"

          inputMode="decimal"

          step={step}

          value={value}

          onChange={(e) => onChange(e.target.value)}

          placeholder={placeholder}

          className="flex-1 bg-transparent outline-none text-sm font-mono text-white placeholder:text-white/25"

        />

        <span className="text-[11px] text-white/45 ml-2 font-bold shrink-0">{unit}</span>

      </div>

      {warn && <p className="text-[10px] mt-1 text-rose-300">{warn}</p>}

      {!warn && hint && <p className="text-[10px] mt-1 text-white/35">{hint}</p>}

    </div>

  );

}



function PriceCell({ label, value, tick, cls }) {

  return (

    <div className="flex items-center justify-between gap-2">

      <span className="text-white/50 shrink-0">{label}</span>

      <LivePriceValue value={value} tick={tick} cls={cls || 'text-white'} />

    </div>

  );

}



const LiveMarketTicker = memo(function LiveMarketTicker({

  mark, index, bestBid, bestAsk, spread, last, tick,

}) {

  return (

    <div className="rounded-lg bg-[color:var(--ibo-elevated)] border border-white/[0.06] px-3 py-2 grid grid-cols-2 gap-y-1 text-[11px]">

      <PriceCell label="Mark"     value={mark}    tick={tick} cls="text-[#FE9D55]" />

      <PriceCell label="Index"    value={index}   tick={tick} cls="text-white/75" />

      <PriceCell label="Best bid" value={bestBid} tick={tick} cls="text-emerald-300" />

      <PriceCell label="Best ask" value={bestAsk} tick={tick} cls="text-rose-300" />

      <div className="flex items-center justify-between col-span-2 mt-1 pt-1 border-t border-[color:var(--ibo-border-solid)] gap-2">

        <span className="text-white/50 shrink-0">Spread</span>

        <span className="font-mono tabular-nums text-right text-white min-w-[5.5rem]">

          {spread > 0

            ? <>{tickAlign(spread, tick)}{' '}

                <span className="text-white/40">

                  ({mark > 0 ? ((spread / mark) * 100).toFixed(3) : '—'}%)

                </span>

              </>

            : '—'}

        </span>

      </div>

      <div className="flex items-center justify-between col-span-2 gap-2">

        <span className="text-white/50 shrink-0">Last trade</span>

        <LivePriceValue value={last} tick={tick} cls="text-white" />

      </div>

    </div>

  );

});



const LivePriceValue = memo(function LivePriceValue({ value, tick, fallback = '—', cls = 'text-white' }) {

  const lastGood = useRef('');

  const aligned = value > 0 ? tickAlign(value, tick) : '';

  if (aligned) lastGood.current = aligned;

  const text = aligned || lastGood.current || fallback;

  return (

    <span className={`font-mono tabular-nums min-w-[5.5rem] text-right ${cls}`}>

      {text}

    </span>

  );

}, (prev, next) => {

  const prevText = prev.value > 0 ? tickAlign(prev.value, prev.tick) : '';

  const nextText = next.value > 0 ? tickAlign(next.value, next.tick) : '';

  return prevText === nextText && prev.cls === next.cls && prev.fallback === next.fallback;

});



function SummaryRow({ label, value, cls }) {

  return (

    <div className="flex items-center justify-between">

      <span className="text-white/55">{label}</span>

      <span className={`font-mono ${cls || 'text-white'}`}>{value}</span>

    </div>

  );

}



function Banner({ type, children }) {

  const cls = type === 'error'

    ? 'bg-rose-500/10 border-rose-400/30 text-rose-300'

    : 'bg-emerald-500/10 border-emerald-400/30 text-emerald-300';

  return (

    <div className={`text-[11px] rounded border px-2.5 py-1.5 ${cls}`}>{children}</div>

  );

}

