/**
 * TradeForm — parity with maxByte-exchange web TradeForm
 *
 * Features:
 *  - Buy / Sell side selector
 *  - Limit / Market order type
 *  - Limit price field (or live-reference read-only for market)
 *  - Amount field (base asset)
 *  - Total USDT field (bidirectional sync with amount × limit price)
 *  - 25 / 50 / 75 / 100 % quick-fill buttons
 *  - Live order summary (size, notional, locked USDT, fee estimate)
 *  - Limit hint (rests on book vs crosses market)
 *  - KYC: single submit button navigates to verification when not approved
 *  - Inline field-level validation errors
 *  - Success / error result toast with fill detail
 *  - Deposit shortcut "+" button next to available balance
 *  - priceSeed prop — populated when user taps an OrderBook row
 */
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, TextInput, Animated,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useSelector } from 'react-redux';
import { tradingApi } from '../../api/trading.api';
import { publicApi } from '../../api/public.api';
import { parseApiError } from '../../api/errors';
import { OrderSide, OrderType } from '../../types/trading.types';
import { RootState } from '../../store';
import { selectSessionWallet } from '../../store/wallet.slice';
import { selectSessionTrading } from '../../store/trading.slice';
import Icon from '@/components/common/AppIcon';
import TerminalNumericInput from './TerminalNumericInput';
import StableTerminalPctSlider from './StableTerminalPctSlider';
import {
  parsePairFromApiSymbol,
  parsePairLabel,
  toExchangeSymbol,
  walletBalanceAssetForQuote,
} from '../../utils/tradeSymbols';
import { resolveTradeFillPrice } from '../../utils/tradeFillPrice';
import { useTradeFillMarket } from '../../hooks/useTradeFillMarket';
import {
  MIN_BASE_AMOUNT,
  MIN_ORDER_VALUE,
  MARKET_BUY_LOCK_BUFFER,
  validateSpotOrder,
} from '../../utils/tradeRules';
import { Colors, FontFamily, FontSize, Spacing, Radius } from '../../theme';
import { FuturesUi } from '../../theme/futuresTerminal';
import { formatAmount, formatPrice } from '../../utils/formatters';
import {
  effectiveKycStatus,
  isKycApproved,
  kycTradeSubmitLabel,
} from '../../utils/kycGate';
import { navigateToKycFlowFromRoot, normalizeKycMode } from '../../utils/kycNavigation';
import { findWalletAvailable } from '../../utils/walletBalance';

const DEFAULT_FEE_RATE = 0.001; // fallback until /api/public/fee-config loads

function clampPct(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function parseNum(s: string | number | undefined | null): number | null {
  if (s == null || s === '') return null;
  const n = parseFloat(String(s).replace(/,/g, '').trim());
  return Number.isFinite(n) ? n : null;
}

function trimDec(val: number, decimals: number): string {
  const t = Math.floor(val * 10 ** decimals + 1e-12) / 10 ** decimals;
  return t.toFixed(decimals).replace(/\.?0+$/, '') || '0';
}

type Errors = Partial<Record<'price' | 'amount' | 'total' | 'balance', string>>;

function runValidation(
  side: OrderSide,
  type: OrderType,
  amountStr: string,
  priceStr: string,
  mark: number,
  balQuote: number,
  balBaseAvail: number,
  baseAsset: string,
  quoteAsset: string,
  symbol: string,
  userLoggedIn: boolean,
): Errors {
  const { errors } = validateSpotOrder({
    symbol,
    side,
    type,
    amountStr,
    priceStr,
    currentPrice: mark,
    balanceQuote: balQuote,
    balanceBase: balBaseAvail,
    baseAsset,
    quoteAsset,
    userLoggedIn,
  });
  return errors;
}

// ── Result toast ──────────────────────────────────────────────────────────────
function ResultToast({ result, base, compact }: { result: any; base: string; compact?: boolean }) {
  const opacity = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(opacity, { toValue: 1, duration: 250, useNativeDriver: true }).start();
  }, []);
  if (!result) return null;
  const ok = result.ok;
  const wrapStyle = compact ? toastStyles.wrapCompact : toastStyles.wrap;
  return (
    <Animated.View style={[wrapStyle, { opacity, borderColor: ok ? Colors.buyGreen + '50' : Colors.sellRed + '50', backgroundColor: ok ? Colors.buyGreenDim : Colors.sellRedDim }]}>
      {ok ? (
        <>
          <View style={toastStyles.row}>
            <Icon name="check-circle" size={14} color={Colors.buyGreen} />
            <Text style={[toastStyles.title, { color: Colors.buyGreen }]}>
              {result.order?.status === 'filled' ? 'Order filled' :
               result.order?.status === 'open' ? 'Limit order placed — see Open orders' :
               result.order?.status === 'partially_filled' ? 'Partially filled — remainder in Open orders' :
               `Order: ${result.order?.status}`}
            </Text>
          </View>
          <Text style={toastStyles.body}>
            {result.order?.side?.toUpperCase()}{' '}
            {result.order?.type === 'limit' && result.order?.price
              ? `@ $${formatPrice(result.order.price)} · ` : ''}
            {formatAmount((result.order?.amount ?? 0) - (result.order?.filled_amount ?? 0), 6)} / {formatAmount(result.order?.amount, 6)} {base}
            {(result.order?.avg_fill_price ?? 0) > 0 && (result.order?.filled_amount ?? 0) > 0
              ? ` · avg $${Number(result.order.avg_fill_price).toFixed(4)}` : ''}
          </Text>
          {(result.order?.fee ?? 0) > 0 && (
            <Text style={toastStyles.fee}>Fee: {result.order.fee.toFixed(6)} {result.order.fee_asset}</Text>
          )}
        </>
      ) : (
        <View style={toastStyles.row}>
          <Icon name="alert-circle" size={14} color={Colors.sellRed} />
          <Text style={[toastStyles.title, { color: Colors.sellRed }, compact && toastStyles.titleCompact]} numberOfLines={compact ? 3 : undefined}>{result.error}</Text>
        </View>
      )}
    </Animated.View>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
interface Props {
  symbol: string;
  currentPrice?: number | string;
  /** Pre-fill limit price when OrderBook row is tapped */
  priceSeed?: string;
  onOrderPlaced?: () => void;
  /** `terminal` = Binance-style compact column beside order book */
  variant?: 'card' | 'terminal';
  topBid?: number | null;
  topAsk?: number | null;
  /** Pair just changed — avoid seeding limit price from stale mark */
  quoteLoading?: boolean;
  /** Lock parent ScrollView while % slider is dragged */
  onLockParentScroll?: (locked: boolean) => void;
  /** Prefill Buy / Sell when returning from the chart page */
  initialSide?: OrderSide;
  /** Hide Buy/Sell tabs when side is already chosen by the parent (e.g. chart CTA). */
  hideSideSelector?: boolean;
}

function TradeForm({
  symbol,
  currentPrice,
  priceSeed,
  onOrderPlaced,
  variant = 'card',
  topBid,
  topAsk,
  quoteLoading = false,
  onLockParentScroll,
  initialSide,
  hideSideSelector = false,
}: Props) {
  const terminal = variant === 'terminal';
  const navigation   = useNavigation<any>();
  const { user, kyc } = useSelector((s: RootState) => s.auth);
  const { assets } = useSelector(selectSessionWallet);
  const { livePositions } = useSelector(selectSessionTrading);

  const [side,        setSide]      = useState<OrderSide>(initialSide === 'sell' ? 'sell' : 'buy');
  const [type,        setType]      = useState<OrderType>('limit');
  const [price,       setPrice]     = useState('');
  const [amount,      setAmount]    = useState('');
  const [totalUsdt,   setTotalUsdt] = useState('');
  const [loading,     setLoading]   = useState(false);
  const [result,      setResult]    = useState<any>(null);
  const [touched,     setTouched]   = useState<Record<string, boolean>>({});
  const [submitted,   setSubmitted] = useState(false);
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [spotMakerFee, setSpotMakerFee] = useState(DEFAULT_FEE_RATE);
  const [spotTakerFee, setSpotTakerFee] = useState(DEFAULT_FEE_RATE);

  useEffect(() => {
    if (initialSide === 'buy' || initialSide === 'sell') {
      setSide(initialSide);
    }
  }, [initialSide]);

  const limitSrcRef = useRef<'amount' | 'total'>('amount');
  const lastSliderPctRef = useRef(0);
  /** Avoid re-filling limit price on every ticker tick (was causing shaky UI). */
  const limitPriceAutoKey = useRef('');

  const exchangeSym = useMemo(() => toExchangeSymbol(symbol), [symbol]);
  const { base: baseAsset, quote: quoteAsset } = useMemo(
    () => parsePairLabel(symbol),
    [symbol],
  );
  const quoteWalletKey = useMemo(
    () => walletBalanceAssetForQuote(parsePairFromApiSymbol(symbol).quoteWire),
    [symbol],
  );
  const baseWalletKey = useMemo(
    () => parsePairFromApiSymbol(symbol).base,
    [symbol],
  );

  const { markRef, topBidRef, topAskRef } = useTradeFillMarket(exchangeSym, terminal);

  const [displayMark, setDisplayMark] = useState(() => parseNum(currentPrice) ?? 0);
  const [displayBbo, setDisplayBbo] = useState<{ bid: number | null; ask: number | null }>({
    bid: null,
    ask: null,
  });
  useEffect(() => {
    if (!terminal) {
      setDisplayMark(parseNum(currentPrice) ?? 0);
      return undefined;
    }
    const sync = () => {
      const live = markRef.current;
      if (live > 0) setDisplayMark(live);
      setDisplayBbo({ bid: topBidRef.current, ask: topAskRef.current });
    };
    sync();
    const id = setInterval(sync, 400);
    return () => clearInterval(id);
  }, [terminal, exchangeSym, currentPrice, markRef, topBidRef, topAskRef]);

  const markPx = terminal
    ? Math.max(displayMark, markRef.current)
    : (parseNum(currentPrice) ?? 0);
  const fillTopBid = terminal ? topBidRef.current : topBid;
  const fillTopAsk = terminal ? topAskRef.current : topAsk;
  const limitPx   = parseNum(price);
  const effPx     = type === 'market' ? markPx : (limitPx ?? 0);
  const amtNum    = parseNum(amount) ?? 0;
  const notional  = effPx * amtNum;

  const balQuote = findWalletAvailable(assets, quoteWalletKey);
  const positionBaseAvail = useMemo(() => {
    let best = 0;
    for (const p of livePositions) {
      if (toExchangeSymbol(String(p.symbol ?? '')) !== exchangeSym) continue;
      const a = Number((p as { available?: number; amount?: number }).available ?? p.amount ?? 0);
      if (Number.isFinite(a) && a > best) best = a;
    }
    return best;
  }, [livePositions, exchangeSym]);
  const balBaseAvail = Math.max(
    findWalletAvailable(assets, baseAsset),
    findWalletAvailable(assets, baseWalletKey),
    positionBaseAvail,
  );
  const balBase = balBaseAvail;
  const avail = side === 'buy' ? balQuote : balBaseAvail;
  const availUnit = side === 'buy' ? quoteAsset : baseAsset;

  const lockQuote = side === 'buy' && effPx > 0 && amtNum > 0
    ? (type === 'market' ? effPx * MARKET_BUY_LOCK_BUFFER * amtNum : effPx * amtNum)
    : null;

  // Limit order hint
  const restsOnBook  = type === 'limit' && markPx > 0 && limitPx != null
    ? (side === 'buy' ? limitPx < markPx : limitPx > markPx) : false;
  const crossesMark  = type === 'limit' && markPx > 0 && limitPx != null
    ? (side === 'buy' ? limitPx >= markPx : limitPx <= markPx) : false;

  const feeRate = type === 'market'
    ? spotTakerFee
    : crossesMark
      ? spotTakerFee
      : restsOnBook
        ? spotMakerFee
        : spotTakerFee;
  const feePctLabel = `${(feeRate * 100).toFixed(3).replace(/\.?0+$/, '')}%`;
  const feeBuy    = amtNum > 0 ? amtNum * feeRate : 0;
  const feeSell   = notional > 0 ? notional * feeRate : 0;

  // ── priceSeed: when OrderBook row is tapped, update price field ───────────
  useEffect(() => {
    if (!priceSeed) return;
    setPrice(priceSeed);
    // Recompute total from existing amount
    const px = parseNum(priceSeed);
    const a  = parseNum(amount);
    if (px && px > 0 && a && a > 0) {
      setTotalUsdt(trimDec(a * px, 6));
    }
    // Switch to limit on price tap
    setType('limit');
  }, [priceSeed]);

  useEffect(() => {
    let cancelled = false;
    publicApi.getFeeConfig().then((res) => {
      if (cancelled) return;
      const m = Number(res.data?.spot?.maker_fee_rate);
      const t = Number(res.data?.spot?.taker_fee_rate);
      if (Number.isFinite(m) && m >= 0) setSpotMakerFee(m);
      if (Number.isFinite(t) && t >= 0) setSpotTakerFee(t);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  // Reset on symbol change
  useEffect(() => {
    limitPriceAutoKey.current = '';
    setAmount(''); setTotalUsdt(''); setPrice('');
    limitSrcRef.current = 'amount';
    lastSliderPctRef.current = 0;
    setResult(null); setSubmitted(false); setTouched({});
  }, [symbol]);

  // One autofill per (symbol, type) when switching to limit — not on every mark tick
  useEffect(() => {
    if (quoteLoading || type !== 'limit' || markPx <= 0) return;
    const key = `${symbol}|${type}`;
    if (limitPriceAutoKey.current === key) return;
    limitPriceAutoKey.current = key;
    setPrice((p) => (p.trim() ? p : trimDec(markPx, markPx >= 1000 ? 2 : 6)));
  }, [symbol, type, markPx, quoteLoading]);

  // Reset totals on type switch to market; clear autofill key so returning to limit can seed price again
  useEffect(() => {
    if (type === 'market') {
      setTotalUsdt('');
      limitPriceAutoKey.current = '';
    }
  }, [type]);

  // Bidirectional sync: limit price change → update the non-source field
  useEffect(() => {
    if (type === 'market' || !limitPx || limitPx <= 0) return;
    if (limitSrcRef.current === 'total') {
      const t = parseNum(totalUsdt);
      if (t && t > 0) setAmount(trimDec(t / limitPx, 8));
    } else {
      const a = parseNum(amount);
      if (a && a > 0) setTotalUsdt(trimDec(a * limitPx, 6));
    }
  }, [price]);

  const handleAmountChange = useCallback((v: string) => {
    setAmount(v);
    limitSrcRef.current = 'amount';
    const px = parseNum(price);
    const a  = parseNum(v);
    if (px && px > 0 && a && a > 0) setTotalUsdt(trimDec(a * px, 6));
    else if (!v.trim()) setTotalUsdt('');
  }, [price]);

  const handleTotalChange = useCallback((v: string) => {
    setTotalUsdt(v);
    limitSrcRef.current = 'total';
    const px = parseNum(price);
    const t  = parseNum(v);
    if (px && px > 0 && t && t > 0) setAmount(trimDec(t / px, 8));
    else if (!v.trim()) setAmount('');
  }, [price]);

  const pctFillCtxRef = useRef({
    side, type, avail, markPx: 0, price, topBid: null as number | null, topAsk: null as number | null,
  });
  pctFillCtxRef.current = {
    side,
    type,
    avail,
    markPx,
    price,
    topBid: fillTopBid ?? null,
    topAsk: fillTopAsk ?? null,
  };

  const fillRafRef = useRef<number | null>(null);
  const fillPendingRef = useRef<number | null>(null);

  const applyPctFill = useCallback((pct: number) => {
    const v = clampPct(pct);
    lastSliderPctRef.current = v;
    if (v <= 0) {
      setAmount('');
      setTotalUsdt('');
      limitSrcRef.current = 'amount';
      return;
    }
    const {
      side: s, type: t, avail: a, markPx: mp, price: pr, topBid: bid, topAsk: ask,
    } = pctFillCtxRef.current;
    limitSrcRef.current = 'amount';
    if (a <= 0) return;

    const px = resolveTradeFillPrice({
      orderType: t,
      side: s,
      markPx: mp,
      limitPx: parseNum(pr) ?? 0,
      topBid: bid,
      topAsk: ask,
    }) || (mp > 0 ? mp : 0);
    if (px <= 0) return;

    if (s === 'buy') {
      const quoteSpend = (a * v) / 100;
      setAmount(trimDec(quoteSpend / px, 8));
      if (t === 'limit') {
        setTotalUsdt(trimDec(quoteSpend, 6));
      }
      return;
    }

    const next = trimDec((a * v) / 100, 8);
    setAmount(next);
    if (t === 'limit') {
      setTotalUsdt(trimDec(parseFloat(next) * px, 6));
    }
  }, []);

  const handlePctLive = useCallback((pct: number) => {
    fillPendingRef.current = pct;
    if (fillRafRef.current != null) return;
    fillRafRef.current = requestAnimationFrame(() => {
      fillRafRef.current = null;
      const pending = fillPendingRef.current;
      if (pending != null) applyPctFill(pending);
    });
  }, [applyPctFill]);

  const sliderResetKey = `${symbol}|${side}`;

  useEffect(() => {
    const pct = lastSliderPctRef.current;
    if (pct > 0) applyPctFill(pct);
  }, [side, symbol, type, avail, markPx, fillTopBid, fillTopAsk, price, applyPctFill]);

  const errors = useMemo(
    () =>     runValidation(
      side, type, amount, price, markPx, balQuote, balBaseAvail, baseAsset, quoteAsset, exchangeSym, Boolean(user),
    ),
    [side, type, amount, price, markPx, balQuote, balBaseAvail, baseAsset, quoteAsset, exchangeSym, user],
  );

  const showErr = (k: keyof Errors) => Boolean(errors[k] && (submitted || touched[k]));
  const touch   = (k: string) => setTouched(t => ({ ...t, [k]: true }));

  const kycStatus = effectiveKycStatus(kyc, user);
  const kycBlocked = Boolean(user && !isKycApproved(kycStatus));

  const handleSubmit = async () => {
    setSubmitted(true);
    if (!user) {
      goLogin();
      return;
    }
    if (kycBlocked) {
      navigateToKycFlowFromRoot(navigation, normalizeKycMode((kyc as { mode?: string } | null)?.mode), kycStatus);
      return;
    }
    if (Object.keys(errors).length > 0) {
      const first = errors.price ?? errors.amount ?? errors.total ?? errors.balance;
      setResult({ ok: false, error: first });
      setTimeout(() => setResult(null), 5000);
      return;
    }

    setLoading(true);
    setResult(null);
    try {
      const resp = await tradingApi.placeOrder({
        symbol: exchangeSym,
        side,
        type,
        amount: parseFloat(amount),
        price: type === 'limit' ? parseFloat(price) : undefined,
      });
      setResult({ ok: true, order: resp.data });
      setAmount(''); setTotalUsdt('');
      limitSrcRef.current = 'amount';
      if (type === 'limit') setPrice('');
      setSubmitted(false);
      setTouched({});
      onOrderPlaced?.();
      setTimeout(() => setResult(null), 6000);
    } catch (err) {
      setResult({ ok: false, error: parseApiError(err).message });
      setTimeout(() => setResult(null), 6000);
    } finally {
      setLoading(false);
    }
  };

  const maxBuyQty = useMemo(() => {
    const px = effPx > 0 ? effPx : markPx;
    if (px <= 0) return '0';
    return trimDec(balQuote / (type === 'market' ? px * MARKET_BUY_LOCK_BUFFER : px), 8);
  }, [effPx, markPx, type, balQuote]);

  const maxSellQty = useMemo(() => trimDec(balBase, 8), [balBase]);

  const liveTopBid = terminal ? displayBbo.bid : topBid;
  const liveTopAsk = terminal ? displayBbo.ask : topAsk;
  const bboPx = side === 'buy' ? liveTopAsk : liveTopBid;
  const bboReady = bboPx != null && bboPx > 0;

  const goLogin = useCallback(() => {
    navigation.navigate('Auth' as any, { screen: 'Login' });
  }, [navigation]);

  const applyBbo = useCallback(() => {
    const px = side === 'buy'
      ? (terminal ? topAskRef.current : topAsk)
      : (terminal ? topBidRef.current : topBid);
    if (!px || px <= 0) {
      setResult({ ok: false, error: 'Order book not ready — wait for live bids/asks.' });
      setTimeout(() => setResult(null), 4000);
      return;
    }
    setType('limit');
    const s = trimDec(px, px >= 1000 ? 2 : 6);
    setPrice(s);
    const a = parseNum(amount);
    if (a && a > 0) setTotalUsdt(trimDec(a * px, 6));
  }, [side, terminal, topAsk, topBid, topAskRef, topBidRef, amount]);

  // ─── Render ────────────────────────────────────────────────────────────────

  /* ── Card variant (non-terminal) ────────────────────────────────────────── */
  const submitLabel = loading
    ? 'Placing…'
    : kycTradeSubmitLabel(
        kycStatus,
        side === 'buy' ? `Buy ${baseAsset}` : `Sell ${baseAsset}`,
      );

  const cardBuySell = (
    <View style={styles.sideRow}>
      <TouchableOpacity
        style={[styles.sideBtn, side === 'buy' && styles.sideBtnBuy]}
        onPress={() => setSide('buy')} activeOpacity={0.8}
      >
        <Text style={[styles.sideTxt, side === 'buy' && styles.sideTxtBuy]}>
          {`▲ Buy ${baseAsset}`}
        </Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={[styles.sideBtn, side === 'sell' && styles.sideBtnSell]}
        onPress={() => setSide('sell')} activeOpacity={0.8}
      >
        <Text style={[styles.sideTxt, side === 'sell' && styles.sideTxtSell]}>
          {`▼ Sell ${baseAsset}`}
        </Text>
      </TouchableOpacity>
    </View>
  );

  const cardOrderType = (
    <>
      <View style={styles.typeRow}>
        {(['limit', 'market'] as OrderType[]).map(t => (
          <TouchableOpacity
            key={t}
            style={[styles.typeBtn, type === t && styles.typeBtnActive]}
            onPress={() => setType(t)} activeOpacity={0.8}
          >
            <Text style={[styles.typeTxt, type === t && styles.typeTxtActive]}>
              {t === 'limit' ? 'Limit' : 'Market'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
      <Text style={styles.typeHint}>
        {type === 'market'
          ? `Fills at best available prices now. Size is in ${baseAsset}.`
          : 'Sets a firm price — order rests on the book until matched.'}
      </Text>
    </>
  );

  /* ── Terminal variant ────────────────────────────────────────────────────── */
  if (terminal) {
    return (
      <View style={styles.wrapTerminal}>
        {/* TOP: Buy/Sell tabs + avbl + order type */}
        <View style={styles.termSectionTop}>
          {/* Buy / Sell pill tabs — matches futures Open/Close style */}
          <View style={styles.sidePillContainer}>
            <TouchableOpacity
              style={[styles.sidePillTab, side === 'buy' && styles.sidePillTabBuy]}
              onPress={() => setSide('buy')}
              activeOpacity={0.88}
            >
              <Text style={[styles.sidePillTxt, side === 'buy' && styles.sidePillTxtBuy]}>
                Buy
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.sidePillTab, side === 'sell' && styles.sidePillTabSell]}
              onPress={() => setSide('sell')}
              activeOpacity={0.88}
            >
              <Text style={[styles.sidePillTxt, side === 'sell' && styles.sidePillTxtSell]}>
                Sell
              </Text>
            </TouchableOpacity>
          </View>

          {/* Available balance */}
          <View style={styles.availRowTerminal}>
            <Text style={styles.availLabelTerminal}>Avbl</Text>
            <View style={styles.availRight}>
              <Text style={styles.availValueTerminal} numberOfLines={1}>
                {avail.toLocaleString('en-US', { maximumFractionDigits: side === 'buy' ? 2 : 6 })} {availUnit}
              </Text>
              <TouchableOpacity
                style={styles.depositBtn}
                onPress={() => navigation.navigate('Wallet', { screen: 'Deposit' })}
              >
                <Icon name="arrow-down-circle-outline" size={14} color={Colors.goldLight} />
              </TouchableOpacity>
            </View>
          </View>

          {/* Order type pills */}
          <View style={styles.typeRowTerminal}>
            {(['limit', 'market'] as OrderType[]).map(t => (
              <TouchableOpacity
                key={t}
                style={[styles.typePillTerminal, type === t && styles.typePillTerminalActive]}
                onPress={() => setType(t)}
                activeOpacity={0.85}
              >
                <Text style={[styles.typePillTerminalTxt, type === t && styles.typePillTerminalTxtActive]}>
                  {t === 'limit' ? 'Limit' : 'Market'}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* MID: fields + slider — space distributes between groups */}
        <View style={styles.termSectionMid}>
          <View style={styles.termFieldsGroup}>
          {/* Price */}
          <View style={styles.termField}>
            <Text style={styles.termFieldLabel}>
              {type === 'limit' ? 'Price' : 'Price (Market)'}
            </Text>
            <View style={[styles.terminalInputRow, showErr('price') && styles.fieldBoxError]}>
              {type === 'limit' ? (
                <TerminalNumericInput
                  style={styles.terminalInput}
                  keyboardType="numeric"
                  value={price}
                  onChangeText={setPrice}
                  onBlur={() => touch('price')}
                  placeholder={markPx > 0 ? trimDec(markPx, markPx >= 1000 ? 2 : 6) : '0.00'}
                  placeholderTextColor={Colors.textDisabled}
                  selectionColor={Colors.gold}
                />
              ) : (
                <Text style={[styles.terminalInput, { color: Colors.textSecondary }]}>
                  {markPx > 0 ? formatPrice(markPx) : '—'}
                </Text>
              )}
              <Text style={styles.fieldUnitInline}>{quoteAsset}</Text>
              {type === 'limit' && (
                <TouchableOpacity
                  style={[styles.bboBtn, !bboReady && styles.bboBtnDisabled]}
                  onPress={applyBbo}
                  activeOpacity={0.7}
                  disabled={!bboReady}
                  accessibilityLabel={bboReady
                    ? (side === 'buy' ? 'Fill best ask price' : 'Fill best bid price')
                    : 'Best bid or offer unavailable'}
                  accessibilityRole="button"
                >
                  <Text style={[styles.bboTxt, !bboReady && styles.bboTxtDisabled]}>BBO</Text>
                </TouchableOpacity>
              )}
            </View>
            {showErr('price') && (
              <View style={styles.terminalAlert}>
                <Icon name="alert-circle-outline" size={11} color={Colors.warning} />
                <Text style={styles.terminalAlertTxt} numberOfLines={2}>{errors.price}</Text>
              </View>
            )}
          </View>

          {/* Amount */}
          <View style={styles.termField}>
            <Text style={styles.termFieldLabel}>Amount</Text>
            <View style={[styles.terminalInputRow, (showErr('amount') || showErr('balance')) && styles.fieldBoxError]}>
              <TerminalNumericInput
                style={styles.terminalInput}
                keyboardType="numeric"
                value={amount}
                onChangeText={handleAmountChange}
                onBlur={() => { touch('amount'); touch('balance'); }}
                placeholder="0.00"
                placeholderTextColor={Colors.textDisabled}
                selectionColor={Colors.gold}
              />
              <Text style={styles.fieldUnitInline}>{baseAsset}</Text>
            </View>
            {(showErr('amount') || showErr('balance')) && (
              <View style={styles.terminalAlert}>
                <Icon name="alert-circle-outline" size={11} color={Colors.sellRed} />
                <Text style={styles.terminalAlertTxt} numberOfLines={2}>{errors.amount ?? errors.balance}</Text>
              </View>
            )}
          </View>

          {/* Total — limit only */}
          {type === 'limit' && (
            <View style={styles.termField}>
              <Text style={styles.termFieldLabel}>Total</Text>
              <View style={[styles.terminalInputRow, showErr('total') && styles.fieldBoxError]}>
                <TerminalNumericInput
                  style={styles.terminalInput}
                  keyboardType="numeric"
                  value={totalUsdt}
                  onChangeText={handleTotalChange}
                  onBlur={() => touch('total')}
                  placeholder="0.00"
                  placeholderTextColor={Colors.textDisabled}
                  selectionColor={Colors.gold}
                />
                <Text style={styles.fieldUnitInline}>{quoteAsset}</Text>
              </View>
              {showErr('total') && (
                <View style={styles.terminalAlert}>
                  <Icon name="alert-circle-outline" size={11} color={Colors.warning} />
                  <Text style={styles.terminalAlertTxt} numberOfLines={2}>{errors.total}</Text>
                </View>
              )}
            </View>
          )}
          </View>

          {/* % slider */}
          <View style={styles.termSliderWrap} collapsable={false}>
            <StableTerminalPctSlider
              resetKey={sliderResetKey}
              side={side}
              onLiveChange={handlePctLive}
              onChange={handlePctLive}
              size="large"
              onLockParentScroll={onLockParentScroll}
            />
          </View>
        </View>

        {/* FOOTER: toast + single CTA follows Buy/Sell tab above */}
        <View style={styles.termFooterCol}>
          {result && <ResultToast result={result} base={baseAsset} compact />}
          <View style={styles.terminalMeta}>
            <View style={styles.terminalMetaRow}>
              <Text style={styles.terminalMetaLbl}>
                {side === 'buy' ? 'Max Buy' : 'Max Sell'}
              </Text>
              <Text style={styles.terminalMetaVal}>
                {side === 'buy' ? `${maxBuyQty} ${baseAsset}` : `${maxSellQty} ${baseAsset}`}
              </Text>
            </View>
            <View style={[styles.terminalMetaRow, styles.terminalMetaRowLast]}>
              <Text style={styles.terminalMetaLbl}>Est. fee</Text>
              <Text style={styles.terminalMetaVal}>
                {side === 'buy'
                  ? `${amtNum > 0 ? feeBuy.toFixed(6) : '0'} ${baseAsset}`
                  : `${notional > 0 ? feeSell.toFixed(4) : '0'} ${quoteAsset}`}
              </Text>
            </View>
          </View>
          <TouchableOpacity
            style={[
              styles.submitBtnTerminal,
              side === 'buy' ? styles.ctaBtnBuy : styles.ctaBtnSell,
              loading && styles.submitDisabled,
            ]}
            onPress={handleSubmit}
            disabled={loading}
            activeOpacity={0.85}
          >
            <Text style={styles.submitTxtTerminal}>{submitLabel}</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.wrap}>

      {/* Card-only: Buy/Sell tabs (hidden when parent already picked the side) */}
      {!hideSideSelector ? cardBuySell : null}
      {cardOrderType}

      {/* Available balance (card) */}
      <View style={styles.availRow}>
        <Text style={styles.availLabel}>Available</Text>
        <View style={styles.availRight}>
          <Text style={styles.availValue} numberOfLines={1}>
            {avail.toLocaleString('en-US', { maximumFractionDigits: side === 'buy' ? 2 : 6 })} {availUnit}
          </Text>
          <TouchableOpacity
            style={styles.depositBtn}
            onPress={() => navigation.navigate('Wallet', { screen: 'Deposit' })}
          >
            <Icon name="arrow-down-circle-outline" size={16} color={Colors.goldLight} />
          </TouchableOpacity>
        </View>
      </View>

      {/* Price */}
      <FieldBlock
        label={type === 'limit' ? 'Limit Price' : 'Last Price (reference)'}
        hint={type === 'limit'
          ? `${quoteAsset} per 1 ${baseAsset} — order rests until market reaches this price.`
          : 'Read-only. Order fills at actual book prices.'}
        unit={quoteAsset}
        error={showErr('price') ? errors.price : undefined}
      >
        {type === 'limit' ? (
          <TextInput
            style={styles.input}
            keyboardType="numeric"
            value={price}
            onChangeText={setPrice}
            onBlur={() => touch('price')}
            placeholder={markPx > 0 ? trimDec(markPx, markPx >= 1000 ? 2 : 6) : '0'}
            placeholderTextColor={Colors.textDisabled}
            selectionColor={Colors.gold}
          />
        ) : (
          <Text style={[styles.input, { color: Colors.textSecondary }]}>
            {markPx > 0 ? formatPrice(markPx) : '—'}
          </Text>
        )}
      </FieldBlock>

      {/* Amount */}
      <FieldBlock
        label={`Amount (${baseAsset})`}
        hint={`Min ${MIN_BASE_AMOUNT} ${baseAsset} · min notional ${MIN_ORDER_VALUE.toFixed(2)} ${quoteAsset}`}
        unit={baseAsset}
        error={showErr('amount') ? errors.amount : showErr('balance') ? errors.balance : undefined}
      >
        <TextInput
          style={styles.input}
          keyboardType="numeric"
          value={amount}
          onChangeText={handleAmountChange}
          onBlur={() => { touch('amount'); touch('balance'); }}
          placeholder="0.000000"
          placeholderTextColor={Colors.textDisabled}
          selectionColor={Colors.gold}
        />
      </FieldBlock>

      {/* Total (limit only) */}
      {type === 'limit' && (
        <FieldBlock
          label={`Total (${quoteAsset})`}
          hint={`Edit total to size by quote; edit ${baseAsset} to size by base.`}
          unit={quoteAsset}
          error={showErr('total') ? errors.total : undefined}
        >
          <TextInput
            style={styles.input}
            keyboardType="numeric"
            value={totalUsdt}
            onChangeText={handleTotalChange}
            onBlur={() => touch('total')}
            placeholder="0.00"
            placeholderTextColor={Colors.textDisabled}
            selectionColor={Colors.gold}
          />
        </FieldBlock>
      )}

      {/* % slider + quick-fill */}
      <View style={styles.termSliderWrap} collapsable={false}>
        <StableTerminalPctSlider
          resetKey={sliderResetKey}
          side={side}
          onLiveChange={handlePctLive}
          onChange={handlePctLive}
          size="large"
          onLockParentScroll={onLockParentScroll}
        />
      </View>
      <View style={styles.pctRow}>
        {[25, 50, 75, 100].map(p => (
          <TouchableOpacity key={p} style={styles.pctBtn} onPress={() => handlePctLive(p)} activeOpacity={0.7}>
            <Text style={styles.pctTxt}>{p}%</Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* ── Order summary (collapsible) — card layout only ── */}
      <>
      <TouchableOpacity style={styles.summaryHead} onPress={() => setSummaryOpen(v => !v)} activeOpacity={0.7}>
        <Text style={styles.summaryHeadTxt}>
          Order Summary {type === 'market' ? '(market · live)' : '(limit)'}
        </Text>
        <Icon name={summaryOpen ? 'chevron-up' : 'chevron-down'} size={14} color={Colors.textMuted} />
      </TouchableOpacity>

      {summaryOpen && (
        <View style={styles.summaryBox}>
          <SummaryRow label="Last price" value={markPx > 0 ? `$${formatPrice(markPx)}` : '—'} />
          {type === 'limit' && limitPx != null && (
            <SummaryRow label="Your limit" value={`$${formatPrice(limitPx)}`} valueColor={Colors.goldLight} />
          )}
          <SummaryRow label="Size" value={amtNum > 0 ? `${amtNum.toFixed(6)} ${baseAsset}` : '—'} />
          <SummaryRow
            label={type === 'market' ? `Est. total (${quoteAsset})` : `Total (${quoteAsset})`}
            value={amtNum > 0 && effPx > 0 ? `$${notional.toFixed(4)}` : '—'}
          />
          {side === 'buy' && lockQuote != null && amtNum > 0 && (
            <SummaryRow
              label={type === 'market' ? `${quoteAsset} reserved (incl. buffer)` : `${quoteAsset} locked`}
              value={`≈ ${lockQuote.toFixed(4)}`}
            />
          )}
          {side === 'sell' && amtNum > 0 && (
            <SummaryRow label={`${baseAsset} locked`} value={amtNum.toFixed(8)} />
          )}
          {amtNum > 0 && (
            <View style={styles.feeRow}>
              <Text style={styles.feeLabel}>Est. fee ({feePctLabel})</Text>
              <Text style={styles.feeValue}>
                {side === 'buy'
                  ? `${feeBuy.toFixed(6)} ${baseAsset}`
                  : `${feeSell.toFixed(4)} ${quoteAsset}`}
              </Text>
            </View>
          )}
          {/* Limit hint */}
          {type === 'limit' && limitPx != null && amtNum > 0 && (
            <View style={[styles.hintBox, {
              backgroundColor: restsOnBook ? Colors.infoDim : crossesMark ? Colors.warningDim : Colors.surfaceHover,
              borderColor: restsOnBook ? Colors.infoDim : crossesMark ? Colors.warningDim : Colors.surfaceBorder,
            }]}>
              <Text style={[styles.hintTxt, {
                color: restsOnBook ? Colors.info : crossesMark ? Colors.warning : Colors.textMuted,
              }]}>
                {restsOnBook
                  ? 'Rests on the book — fills when market reaches your limit.'
                  : crossesMark
                    ? 'At or better than mark — matches visible liquidity first.'
                    : 'Check your limit price vs current market.'}
              </Text>
            </View>
          )}
        </View>
      )}
      </>

      {result && <ResultToast result={result} base={baseAsset} />}

      <TouchableOpacity
        style={[
          styles.submitBtn,
          side === 'buy' ? styles.submitBuy : styles.submitSell,
          loading && styles.submitDisabled,
        ]}
        onPress={handleSubmit}
        disabled={loading}
        activeOpacity={0.85}
      >
        <Text style={styles.submitTxt}>{submitLabel}</Text>
      </TouchableOpacity>
    </View>
  );
}

export default React.memo(TradeForm);

// ── FieldBlock sub-component ─────────────────────────────────────────────────
function FieldBlock({
  label, hint, unit, children, error,
}: {
  label: string; hint: string; unit: string;
  children: React.ReactNode; error?: string;
}) {
  return (
    <View style={styles.fieldWrap}>
      <Text style={styles.fieldLabel}>{label}</Text>
      {hint ? <Text style={styles.fieldHint}>{hint}</Text> : null}
      <View style={[styles.fieldBox, error ? styles.fieldBoxError : null]}>
        {children}
        <Text style={styles.fieldUnit}>{unit}</Text>
      </View>
      {error ? <Text style={styles.fieldError}>{error}</Text> : null}
    </View>
  );
}

// ── SummaryRow sub-component ─────────────────────────────────────────────────
function SummaryRow({ label, value, valueColor }: { label: string; value: string; valueColor?: string }) {
  return (
    <View style={styles.summaryRow}>
      <Text style={styles.summaryLabel}>{label}</Text>
      <Text style={[styles.summaryValue, valueColor ? { color: valueColor } : null]}>{value}</Text>
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  // ── Card variant ──────────────────────────────────────────────────────────
  wrap: {
    backgroundColor: Colors.surfaceCard,
    borderWidth: 1, borderColor: Colors.surfaceBorder,
    borderRadius: Radius.xl, overflow: 'hidden',
  },

  // Buy / Sell (card)
  sideRow:     { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: Colors.surfaceBorder },
  sideBtn:     { flex: 1, paddingVertical: Spacing[4], alignItems: 'center', backgroundColor: Colors.surfaceHover },
  sideBtnBuy:  { backgroundColor: Colors.buyGreenDim },
  sideBtnSell: { backgroundColor: Colors.sellRedDim },
  sideTxt:     { fontFamily: FontFamily.bold, fontSize: FontSize.sm, color: Colors.textMuted, letterSpacing: 0.3 },
  sideTxtBuy:  { color: Colors.buyGreen },
  sideTxtSell: { color: Colors.sellRed },

  // Order type (card)
  typeRow: {
    flexDirection: 'row', gap: Spacing[2],
    margin: Spacing[3], backgroundColor: Colors.surfaceHover,
    borderRadius: Radius.lg, padding: 4,
    borderWidth: 1, borderColor: Colors.surfaceBorder,
  },
  typeBtn:       { flex: 1, paddingVertical: Spacing[2], borderRadius: Radius.md, alignItems: 'center' },
  typeBtnActive: { backgroundColor: Colors.goldAlpha15, borderWidth: 1, borderColor: Colors.goldAlpha30 },
  typeTxt:       { fontFamily: FontFamily.semiBold, fontSize: FontSize.sm, color: Colors.textMuted },
  typeTxtActive: { color: Colors.goldLight },
  typeHint:      { fontFamily: FontFamily.regular, fontSize: 10, color: Colors.textMuted, marginHorizontal: Spacing[3], marginBottom: Spacing[2], lineHeight: 14 },

  // Available (card)
  availRow:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginHorizontal: Spacing[3], marginBottom: Spacing[3] },
  availLeft:  { flexDirection: 'row', alignItems: 'center', gap: 4 },
  availLabel: { fontFamily: FontFamily.medium, fontSize: FontSize.xs, color: Colors.textMuted },
  availRight: { flexDirection: 'row', alignItems: 'center', gap: Spacing[2] },
  availValue: { fontFamily: FontFamily.monoMedium, fontSize: FontSize.sm, color: Colors.textPrimary },

  // Fields (card)
  fieldWrap:  { marginHorizontal: Spacing[3], marginBottom: Spacing[2] },
  fieldLabel: { fontFamily: FontFamily.bold, fontSize: 10, color: Colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 2 },
  fieldHint:  { fontFamily: FontFamily.regular, fontSize: 9, color: Colors.textMuted, marginBottom: 4, lineHeight: 13 },
  fieldBox: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: Colors.surfaceHover, borderWidth: 1,
    borderColor: Colors.surfaceBorder, borderRadius: Radius.lg,
    paddingHorizontal: Spacing[3], paddingVertical: Spacing[3],
  },
  fieldBoxError: { borderColor: Colors.dangerDim },
  input:     { flex: 1, fontFamily: FontFamily.monoMedium, fontSize: FontSize.base, color: Colors.textPrimary, textAlign: 'center' },
  fieldUnit: { fontFamily: FontFamily.bold, fontSize: FontSize.xs, color: Colors.textSecondary, marginLeft: Spacing[2] },
  fieldError: { fontFamily: FontFamily.medium, fontSize: 10, color: Colors.danger, marginTop: 3 },

  // % buttons (card)
  pctRow: { flexDirection: 'row', gap: Spacing[2], marginHorizontal: Spacing[3], marginBottom: Spacing[3] },
  pctBtn: { flex: 1, paddingVertical: Spacing[2], backgroundColor: Colors.surfaceHover, borderWidth: 1, borderColor: Colors.surfaceBorder, borderRadius: Radius.md, alignItems: 'center' },
  pctTxt: { fontFamily: FontFamily.semiBold, fontSize: FontSize.xs, color: Colors.textPrimary },

  // Summary (card)
  summaryHead:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginHorizontal: Spacing[3], paddingVertical: Spacing[2] },
  summaryHeadTxt: { fontFamily: FontFamily.bold, fontSize: 9, color: Colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.7 },
  summaryBox:     { marginHorizontal: Spacing[3], marginBottom: Spacing[3], backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.surfaceBorder, borderRadius: Radius.lg, padding: Spacing[3] },
  summaryRow:     { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 },
  summaryLabel:   { fontFamily: FontFamily.regular, fontSize: FontSize.xs, color: Colors.textMuted },
  summaryValue:   { fontFamily: FontFamily.monoMedium, fontSize: FontSize.xs, color: Colors.textPrimary },
  feeRow:         { flexDirection: 'row', justifyContent: 'space-between', paddingTop: Spacing[2], marginTop: Spacing[1], borderTopWidth: 1, borderTopColor: Colors.surfaceBorder },
  feeLabel:       { fontFamily: FontFamily.medium, fontSize: 10, color: Colors.textMuted },
  feeValue:       { fontFamily: FontFamily.mono, fontSize: 10, color: Colors.textSecondary },
  hintBox:        { borderWidth: 1, borderRadius: Radius.md, padding: Spacing[2], marginTop: Spacing[2] },
  hintTxt:        { fontFamily: FontFamily.medium, fontSize: 10, lineHeight: 14 },

  // Submit (card)
  submitBtn:      { marginHorizontal: Spacing[3], marginTop: Spacing[3], marginBottom: Spacing[1], paddingVertical: Spacing[4], borderRadius: Radius.lg, alignItems: 'center' },
  submitBuy:      { backgroundColor: Colors.buyGreen },
  submitSell:     { backgroundColor: Colors.sellRed },
  submitDisabled: { opacity: 0.4 },
  submitTxt:      { fontFamily: FontFamily.extraBold, fontSize: FontSize.base, color: Colors.white, letterSpacing: 0.5 },

  // Deposit btn (shared)
  depositBtn: {
    width: 26, height: 26, borderRadius: 13,
    backgroundColor: Colors.goldAlpha10, borderWidth: 1,
    borderColor: Colors.goldAlpha30, alignItems: 'center', justifyContent: 'center',
  },

  // ── Terminal variant ───────────────────────────────────────────────────────
  wrapTerminal: {
    flex: 1,
    minHeight: 0,
    flexDirection: 'column',
    paddingHorizontal: Spacing[1],
    paddingTop: Spacing[1],
    paddingBottom: Spacing[2],
  },

  /* Top section: Buy/Sell tabs + avbl + type pills — does not flex-grow */
  termSectionTop: {
    flexShrink: 0,
    paddingBottom: 2,
  },

  /* Mid section: fields at top, slider below — fills space without huge gaps */
  termSectionMid: {
    flex: 1,
    minHeight: 0,
    flexDirection: 'column',
    justifyContent: 'space-between',
  },
  termFieldsGroup: {
    flexShrink: 0,
    gap: 4,
  },

  /* Footer: stacked submit buttons (futures-style) */
  termFooterCol: {
    flexShrink: 0,
    paddingTop: Spacing[1],
    paddingBottom: Spacing[1],
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Colors.surfaceBorder,
  },

  /* Buy / Sell pill tabs (matches futures Open/Close style) */
  sidePillContainer: {
    flexDirection: 'row',
    padding: 3,
    marginBottom: Spacing[1],
    backgroundColor: Colors.surfaceHover,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
  },
  sidePillTab: {
    flex: 1,
    paddingVertical: 6,
    borderRadius: Radius.sm,
    alignItems: 'center',
    backgroundColor: 'transparent',
  },
  /* Active tabs — brand blue (buy) / red (sell), matches futures */
  sidePillTabBuy:  { backgroundColor: FuturesUi.longDimStrong, borderWidth: 1, borderColor: FuturesUi.longBorder },
  sidePillTabSell: { backgroundColor: Colors.sellRedDim, borderWidth: 1, borderColor: 'rgba(239, 68, 68, 0.35)' },
  sidePillTxt:     { fontFamily: FontFamily.semiBold, fontSize: FontSize.xs, color: Colors.textMuted },
  sidePillTxtBuy:  { color: FuturesUi.longLight, fontFamily: FontFamily.bold },
  sidePillTxtSell: { color: Colors.sellRed,      fontFamily: FontFamily.bold },

  /* Available row (terminal) */
  availRowTerminal: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: Spacing[1],
    paddingHorizontal: 2,
  },
  availLabelTerminal: {
    fontFamily: FontFamily.medium,
    fontSize: 10,
    color: Colors.textSecondary,
  },
  availValueTerminal: {
    fontFamily: FontFamily.monoMedium,
    fontSize: FontSize.sm,
    color: Colors.textPrimary,
  },

  /* Order type pills (terminal) */
  typeRowTerminal: {
    flexDirection: 'row',
    marginBottom: Spacing[1],
    gap: 4,
    padding: 2,
    backgroundColor: Colors.surfaceHover,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
  },
  typePillTerminal: {
    flex: 1,
    paddingVertical: 5,
    borderRadius: Radius.sm,
    alignItems: 'center',
    backgroundColor: 'transparent',
  },
  typePillTerminalActive: {
    backgroundColor: Colors.goldAlpha15,
    borderWidth: 1,
    borderColor: Colors.goldAlpha30,
  },
  typePillTerminalTxt:       { fontFamily: FontFamily.semiBold, fontSize: 10, color: Colors.textMuted },
  typePillTerminalTxtActive: { color: Colors.goldLight },

  /* Individual field block — label + input row */
  termField: {
    flexShrink: 0,
  },
  termFieldLabel: {
    fontFamily: FontFamily.medium,
    fontSize: 10,
    color: Colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginBottom: 2,
  },

  /* Slider — moderate gap below Total field */
  termSliderWrap: {
    flexShrink: 0,
    minHeight: 78,
    marginTop: Spacing[2],
    marginBottom: Spacing[1],
  },

  /* Flex field wrapper — kept for backward compat */
  fieldWrapFlex: {
    flexShrink: 0,
  },

  /* Input row (terminal) — taller so fields look proportional */
  terminalInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surfaceHover,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing[2],
    paddingVertical: 5,
    minHeight: 32,
    minWidth: 0,
  },
  terminalInput: {
    flex: 1,
    minWidth: 0,
    fontFamily: FontFamily.monoMedium,
    fontSize: FontSize.sm,
    color: Colors.textPrimary,
    paddingVertical: 0,
    marginVertical: 0,
    textAlign: 'center',
  },
  fieldUnitInline: {
    fontFamily: FontFamily.medium,
    fontSize: 10,
    color: Colors.textSecondary,
    marginLeft: 4,
    flexShrink: 0,
  },
  bboBtn: {
    paddingHorizontal: Spacing[2],
    paddingVertical: 3,
    backgroundColor: Colors.goldAlpha15,
    borderRadius: Radius.sm,
    borderWidth: 1,
    borderColor: Colors.goldAlpha30,
    marginLeft: 4,
  },
  bboBtnDisabled: {
    opacity: 0.45,
    borderColor: Colors.surfaceBorder,
    backgroundColor: Colors.surfaceHover,
  },
  bboTxt: { fontFamily: FontFamily.bold, fontSize: 10, color: Colors.goldLight },
  bboTxtDisabled: { color: Colors.textMuted },

  terminalAlert: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 5,
    marginTop: 3,
    paddingHorizontal: Spacing[1],
    paddingVertical: 4,
    backgroundColor: Colors.dangerDim,
    borderRadius: Radius.sm,
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.35)',
  },
  terminalAlertTxt: {
    flex: 1,
    fontFamily: FontFamily.medium,
    fontSize: 10,
    color: Colors.sellRed,
    lineHeight: 13,
  },

  /* Meta: max + fee (terminal) */
  terminalMeta: {
    flexShrink: 0,
    marginTop: 2,
    paddingHorizontal: Spacing[2],
    paddingVertical: 3,
    backgroundColor: Colors.surfaceHover,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
  },
  terminalMetaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 3,
    gap: Spacing[1],
  },
  terminalMetaRowLast: { marginBottom: 0 },
  terminalMetaLbl:     { fontFamily: FontFamily.medium, fontSize: 10, color: Colors.textSecondary },
  terminalMetaVal: {
    flex: 1,
    fontFamily: FontFamily.monoMedium,
    fontSize: FontSize.sm,
    color: Colors.textPrimary,
    textAlign: 'right',
  },

  /* Dual CTA row (Buy + Sell side-by-side, mirrors futures stacked submit) */
  dualCtaRow: {
    flexDirection: 'row',
    gap: Spacing[1],
  },
  ctaBtnHalf: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 36,
  },
  ctaBtnBuy:  { backgroundColor: Colors.buyGreen },
  ctaBtnSell: { backgroundColor: Colors.sellRed },
  ctaBtnTxt: {
    fontFamily: FontFamily.extraBold,
    fontSize: FontSize.sm,
    color: Colors.white,
    letterSpacing: 0.4,
  },

  /* Unused but preserved for backward compat */
  typeDropdown: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginHorizontal: Spacing[1], marginBottom: Spacing[1], paddingHorizontal: Spacing[2], paddingVertical: 5, backgroundColor: Colors.surfaceCard, borderWidth: 1, borderColor: Colors.surfaceBorder, borderRadius: Radius.md },
  typeDropdownTxt: { fontFamily: FontFamily.semiBold, fontSize: FontSize.sm, color: Colors.textPrimary },
  submitBtnTerminal: {
    marginTop: Spacing[2],
    paddingVertical: FuturesUi.form.ctaPadV,
    minHeight: FuturesUi.form.ctaMinH,
    borderRadius: Radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  submitTxtTerminal: { fontFamily: FontFamily.bold, fontSize: FontSize.base, color: Colors.white, letterSpacing: 0.3 },
  sideBtnTerminal: { flex: 1, paddingVertical: 6, borderRadius: Radius.md, alignItems: 'center', backgroundColor: Colors.surfaceHover, borderWidth: 1, borderColor: Colors.surfaceBorder },
  sideBtnBuyTerminal: { backgroundColor: Colors.buyGreen, borderColor: Colors.buyGreen },
  sideBtnSellTerminal: { backgroundColor: Colors.sellRed, borderColor: Colors.sellRed },
  sideTxtTerminal: { fontFamily: FontFamily.bold, fontSize: FontSize.xs, color: Colors.textMuted },
  sideTxtBuyTerminal: { color: Colors.textPrimary },
  sideTxtSellTerminal: { color: Colors.textPrimary },
  sideRowTerminal: { flexDirection: 'row', gap: Spacing[1], marginBottom: Spacing[1], paddingHorizontal: Spacing[1] },
  terminalField: { marginHorizontal: Spacing[1], marginBottom: Spacing[1] },
  terminalLabel: { fontFamily: FontFamily.medium, fontSize: 9, color: Colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 3 },
  terminalFormBody: { flex: 1, minHeight: 0 },
  terminalFormFooter: { flexShrink: 0, paddingTop: 4, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: Colors.surfaceBorder },
});

const toastStyles = StyleSheet.create({
  wrap:  { marginHorizontal: Spacing[3], marginBottom: Spacing[3], padding: Spacing[3], borderWidth: 1, borderRadius: Radius.md },
  wrapCompact: {
    marginHorizontal: Spacing[1],
    marginBottom: Spacing[2],
    paddingHorizontal: Spacing[2],
    paddingVertical: Spacing[2],
    borderWidth: 1,
    borderRadius: Radius.sm,
  },
  row:   { flexDirection: 'row', alignItems: 'center', gap: Spacing[2], marginBottom: 4 },
  title: { fontFamily: FontFamily.bold, fontSize: FontSize.xs, flex: 1, lineHeight: 16 },
  titleCompact: { fontSize: 10, lineHeight: 14 },
  body:  { fontFamily: FontFamily.mono, fontSize: 10, color: Colors.textSecondary, lineHeight: 14, marginBottom: 2 },
  fee:   { fontFamily: FontFamily.regular, fontSize: 10, color: Colors.textMuted },
});
