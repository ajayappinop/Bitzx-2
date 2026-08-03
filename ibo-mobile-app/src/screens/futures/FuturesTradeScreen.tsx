/**
 * FuturesTradeScreen — Binance-style futures terminal
 *
 * Header → mini chart → scroll: form + book → data tabs.
 */
import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import Icon from '@/components/common/AppIcon';
import {
  View, Text, StyleSheet, TouchableOpacity,
  Modal, TextInput, Platform,
  Alert, Dimensions, LayoutAnimation, LayoutChangeEvent,
} from 'react-native';
import { RouteProp, useNavigation, useFocusEffect } from '@react-navigation/native';
import { useRefreshIfStale } from '../../hooks/useRefreshIfStale';
import { useSpotTickerFeed } from '../../hooks/useTickerFeed';
import {
  useSpotOrderBookFeed,
  useFuturesOrderBookFeed,
  useFuturesMarketMeta,
} from '../../hooks/useOrderBookFeed';
import { useSelector, useDispatch } from 'react-redux';
import { FuturesStackParamList } from '../../navigation/types';
import { AppDispatch, RootState } from '../../store';
import { fetchKycThunk } from '../../store/auth.slice';
import { fetchWalletThunk, selectSessionWallet } from '../../store/wallet.slice';
import { findWalletAvailable } from '../../utils/walletBalance';
import {
  scheduleTransferRefresh,
  submitFuturesTransfer,
} from '../../services/futuresTransfer.service';
import { futuresApi, FuturesOrderPayload, peekFuturesWalletCache } from '../../api/futures.api';
import { parseApiError } from '../../api/errors';
import {
  FuturesPosition, FuturesOrder, FuturesWallet,
  FuturesSettings, MarginMode,
} from '../../types/futures.types';
import { OrderBook as OrderBookType } from '../../types/market.types';
import { wsManager } from '../../services/websocket.service';
import { subscribeBinanceSpotIndex } from '../../services/binancePublicFeed.service';
import { futuresWsUrl } from '../../config/wsConfig';
import StorageService from '../../services/storage.service';
import { STORAGE_KEYS } from '../../config/storageKeys';
import { getMemoryAccessToken } from '../../api/client';
import SafeAreaWrapper from '../../components/common/SafeAreaWrapper';
import TradeMarketHeader from '../../components/trading/TradeMarketHeader';
import ChartPreviewCard from '../../components/trading/ChartPreviewCard';
import FuturesChartToggleBar from '../../components/futures/FuturesChartToggleBar';
import TradeTerminalScrollLayout from '../../components/trading/TradeTerminalScrollLayout';
import type { ChartInterval } from '../../components/trading/chartIntervals';
import { TRADE_CHART_PANEL_H } from '../../components/trading/chartIntervals';
import TradeTerminalPane from '../../components/trading/TradeTerminalPane';
import LinearGradient from 'react-native-linear-gradient';
import OrderBookComp from '../../components/futures/FuturesTerminalOrderBook';
import LeverageSelector from '../../components/futures/LeverageSelector';
import FuturesInlineOrderOptions from '../../components/futures/FuturesInlineOrderOptions';
import FuturesInlineTpSlFields from '../../components/futures/FuturesInlineTpSlFields';
import {
  resolveBracketTriggerPrice,
  isValidBracketPrice,
  type TpSlTriggerMode,
} from '../../components/futures/tpSlTrigger';
import MarginModePickerModal from '../../components/futures/MarginModePickerModal';
import FuturesTerminalSizingBlock from '../../components/futures/FuturesTerminalSizingBlock';
import TerminalNumericInput from '../../components/trading/TerminalNumericInput';
import FuturesOrderSettingsModal from '../../components/futures/FuturesOrderSettingsModal';
import { useStableNumber } from '../../hooks/useStableNumber';
import { resolveFuturesFillPrice, resolveSizingFillPx } from '../../utils/tradeFillPrice';
import {
  getSizingDisplay,
  pctToSizingValues,
  sizingValuesToPct,
  contractsToQty,
  qtyToContracts,
  unitButtonLabel,
  maxOpenQty as calcMaxOpenQty,
  maxOpenNotional as calcMaxOpenNotional,
  type FuturesSizingCaps,
} from '../../utils/futuresOrderSizing';
import type { FuturesAmountUnit, FuturesSizingMode } from '../../types/futuresOrderSizing.types';
import FuturesStackedSubmit from '../../components/futures/FuturesStackedSubmit';
import { FuturesUi } from '../../theme/futuresTerminal';
import { isNewArchitectureEnabled } from '../../utils/newArchitecture';
import OrderTypePickerModal, { FuturesOrderType } from '../../components/futures/OrderTypePickerModal';
import FuturesOrderTypeIcon from '../../components/futures/FuturesOrderTypeIcon';
import { FUTURES_ORDER_TYPE_LABEL } from '../../components/futures/futuresOrderTypes';
import Button from '../../components/common/Button';
import { Colors, FontFamily, FontSize, Spacing, Radius } from '../../theme';
import { useTradeLayoutHeights } from '../../hooks/useTradeLayoutHeights';
import { computeTerminalBookRows } from '../../theme/tradeTerminal';
import { formatPrice, formatUSD, formatDateTime, formatPercent } from '../../utils/formatters';
import {
  getCachedOrderBook,
  setCachedOrderBook,
  orderBookHasDepth,
} from '../../utils/orderBookCache';
import { resolveDisplayOrderBook } from '../../utils/orderBookDisplay';
import { prefetchChartPageData } from '../../services/chartPagePrefetch.service';
import { instantChartKlines } from '../../utils/chartPageBootstrap';
import { toFuturesSymbol, toSpotSymbol, toExchangeSymbol } from '../../utils/tradeSymbols';
import {
  bookBestSides,
  extractFuturesMarkPayload,
  formatFuturesLimitPrice,
  futuresWalletAvailable,
  formatFundingCountdown,
  lastTradePrice,
  nextFundingSettlementUtc,
  pickLatestLimitPrice,
  parseQuoteNum,
  type QuoteSnap,
} from '../../utils/futuresQuotes';
import {
  effectiveKycStatus,
  isKycApproved,
  isKycPendingReview,
  kycTradeSubmitLabel,
} from '../../utils/kycGate';
import { navigateToKycFlowFromRoot } from '../../utils/kycNavigation';
import { estimateIboFee, formatIboFee, DEFAULT_IBO_PRICE_USDT } from '../../utils/iboFee';
import { calcFuturesLiqPrice, walkFuturesBook } from '../../utils/futuresLiqEstimate';
import AdaptiveKeyboardAvoidingView from '@/components/common/AdaptiveKeyboardAvoidingView';

// ── Helpers ──────────────────────────────────────────────────────────────────
function parseN(v: any): number {
  const n = typeof v === 'string' ? parseFloat(v) : Number(v);
  return Number.isFinite(n) ? n : 0;
}

function trimN(v: number, dp = 4): string {
  if (!Number.isFinite(v) || v <= 0) return '';
  return v.toFixed(dp).replace(/\.?0+$/, '');
}

function positionMatchesSymbol(posSymbol: string, chartSymbol: string): boolean {
  const pos = String(posSymbol || '').toUpperCase();
  const chart = String(chartSymbol || '').toUpperCase();
  if (pos === chart) return true;
  return pos.replace(/-PERP$/i, '') === chart.replace(/-PERP$/i, '');
}
function safeUpper(v: unknown, fallback = '—'): string {
  if (v == null || v === '') return fallback;
  return String(v).toUpperCase();
}
function fmtN(v: number, dp = 2): string {
  return Number.isFinite(v) ? v.toFixed(dp) : '—';
}
const DEFAULT_MAKER_FEE = 0.0002;
const DEFAULT_TAKER_FEE = 0.0005;

const TXN_TYPE_LABEL: Record<string, string> = {
  transfer_in: 'Transfer in',
  transfer_out: 'Transfer out',
  realized_pnl: 'Realized PnL',
  funding_payment: 'Funding',
  funding_received: 'Funding',
  fee: 'Fee',
  liquidation: 'Liquidation',
  margin_lock: 'Margin lock',
  margin_unlock: 'Margin unlock',
  adjustment: 'Adjustment',
};

function signedTxnAmount(tx: { amount?: unknown; direction?: string }): number {
  const amt = Math.abs(parseN(tx.amount));
  const dir = String(tx.direction ?? '');
  if (dir === 'credit' || dir === 'unlock') return amt;
  if (dir === 'debit' || dir === 'lock') return -amt;
  return parseN(tx.amount);
}

type Props = { route: RouteProp<FuturesStackParamList, 'DerivativesPair'> };
type OrderType = FuturesOrderType;
type TIF        = 'GTC' | 'IOC' | 'FOK';

const TERMINAL_COMPACT = true;
type FuturesDataTab = 'positions' | 'orders' | 'history';

/** Smooth resize when optional form rows appear (TP/SL, stop trigger, alerts). */
function animateTerminalLayout() {
  if (isNewArchitectureEnabled()) return;
  LayoutAnimation.configureNext({
    duration: 220,
    update: { type: LayoutAnimation.Types.easeInEaseOut },
    create: { type: LayoutAnimation.Types.easeInEaseOut, property: LayoutAnimation.Properties.opacity },
    delete: { type: LayoutAnimation.Types.easeInEaseOut, property: LayoutAnimation.Properties.opacity },
  });
}

if (Platform.OS === 'android' && !isNewArchitectureEnabled()) {
  const { UIManager } = require('react-native');
  UIManager.setLayoutAnimationEnabledExperimental?.(true);
}

function FuturesStatTile({
  label, value, sub, valueColor,
}: {
  label: string;
  value: string;
  sub?: string;
  valueColor?: string;
}) {
  return (
    <View style={s.stripTile}>
      <Text style={s.stripLabel} numberOfLines={1}>{label}</Text>
      <Text
        style={[s.stripValue, valueColor ? { color: valueColor } : null]}
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.75}
      >
        {value}
      </Text>
      {sub ? (
        <Text style={s.stripSub} numberOfLines={1}>{sub}</Text>
      ) : null}
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
export default function FuturesTradeScreen({ route }: Props) {
  const navigation = useNavigation<any>();
  const dispatch = useDispatch<AppDispatch>();
  const { user, kyc, kycMode } = useSelector((s: RootState) => s.auth);
  const { assets: tradeAssets } = useSelector(selectSessionWallet);
  const uid = user?.uid ?? '';
  const kycStatus = effectiveKycStatus(kyc, user);
  const kycFuturesBlocked = Boolean(user && !isKycApproved(kycStatus));

  const goToKyc = useCallback(() => {
    navigateToKycFlowFromRoot(navigation, kycMode, kycStatus);
  }, [navigation, kycMode, kycStatus]);

  const rawSymbol = route.params?.symbol ?? 'BTCUSDT-PERP';
  const routeSide = route.params?.side;
  const symbol    = toFuturesSymbol(rawSymbol);
  const spotSym   = toSpotSymbol(symbol);
  const spotExchangeSym = toExchangeSymbol(symbol);
  const baseAsset = spotSym.replace(/USDT$/i, '').replace(/\/USDT$/i, '');
  const { ticker: spotTicker } = useSpotTickerFeed(spotExchangeSym);

  // ── Market state ──────────────────────────────────────────────────────────
  const [markPrice,  setMarkPrice]  = useState(0);
  const [indexPrice, setIndexPrice] = useState(0);
  const [fundingRate,setFundingRate]= useState<number | null>(null);
  const [tickSize,   setTickSize]   = useState(0.01);
  const [lotSize,    setLotSize]    = useState(0.001);
  const [maxLev,     setMaxLev]     = useState(125);
  const [levPresets, setLevPresets] = useState<number[]>([1, 5, 10, 25, 50, 100]);
  const [levError,   setLevError]   = useState('');
  const [minNotional, setMinNotional] = useState(5);
  /** Perp matching-engine depth (often sparse). */
  const { orderBook: perpBook } = useFuturesOrderBookFeed(symbol);
  const futuresMeta = useFuturesMarketMeta(symbol);
  /** Spot/Binance depth — same live feed as Spot trade (updates ~1.5s). */
  const { orderBook: liveBook } = useSpotOrderBookFeed(spotSym);
  const [recentTrades,setRecentTrades] = useState<any[]>([]);
  /** Spot index reference (underlying) — 24h change for header context */
  const [spotRefPrice, setSpotRefPrice] = useState(0);
  const [spotBid, setSpotBid] = useState(0);
  const [spotAsk, setSpotAsk] = useState(0);

  const headerChangePct = useMemo(() => {
    const raw = spotTicker?.changePct;
    if (raw == null || raw === '') return undefined;
    const n = typeof raw === 'string' ? parseFloat(raw) : Number(raw);
    return Number.isFinite(n) ? n : undefined;
  }, [spotTicker?.changePct]);

  useEffect(() => {
    const p = Number(spotTicker?.price ?? 0);
    if (Number.isFinite(p) && p > 0) setSpotRefPrice(p);
  }, [spotTicker?.price]);

  // ── Account state ─────────────────────────────────────────────────────────
  const [wallet,     setWallet]     = useState<any>(() => peekFuturesWalletCache());
  const [settings,   setSettings]   = useState<FuturesSettings>({ leverage: 10, margin_mode: 'cross' });
  const [positions,  setPositions]  = useState<FuturesPosition[]>([]);
  const [closedPositions, setClosedPositions] = useState<any[]>([]);
  const [openOrders, setOpenOrders] = useState<FuturesOrder[]>([]);
  const [history,    setHistory]    = useState<FuturesOrder[]>([]);
  const [myTrades,   setMyTrades]   = useState<any[]>([]);
  const [walletTxns, setWalletTxns] = useState<any[]>([]);
  const [markBySymbol, setMarkBySymbol] = useState<Record<string, number>>({});

  useEffect(() => {
    setWallet(null);
    setPositions([]);
    setClosedPositions([]);
    setOpenOrders([]);
    setHistory([]);
    setMyTrades([]);
    setWalletTxns([]);
  }, [uid]);

  // ── UI state ──────────────────────────────────────────────────────────────

  // Trade form
  const [side,       setSide]       = useState<'buy' | 'sell'>(routeSide === 'sell' ? 'sell' : 'buy');
  const [orderType,  setOrderType]  = useState<OrderType>('limit');
  const [price,      setPrice]      = useState('');
  const [stopPrice,  setStopPrice]  = useState('');
  const [qty,        setQty]        = useState('');
  const [total,      setTotal]      = useState('');
  const [margin,     setMargin]     = useState('');
  const [tpPrice,    setTpPrice]    = useState('');
  const [slPrice,    setSlPrice]    = useState('');
  const [tpTriggerMode, setTpTriggerMode] = useState<TpSlTriggerMode>('pnl_ratio');
  const [slTriggerMode, setSlTriggerMode] = useState<TpSlTriggerMode>('pnl_ratio');
  const [reduceOnly, setReduceOnly] = useState(false);
  const [tif,        setTif]        = useState<TIF>('GTC');
  const [placingSide, setPlacingSide] = useState<'buy' | 'sell' | null>(null);

  useEffect(() => {
    if (routeSide === 'buy' || routeSide === 'sell') {
      setSide(routeSide);
    }
  }, [routeSide]);
  const [tradeErr,   setTradeErr]   = useState('');
  const [tradeOk,    setTradeOk]    = useState('');
  const [sliderScrollLocked, setSliderScrollLocked] = useState(false);
  const [chartExpanded, setChartExpanded] = useState(true);
  const sizeSourceRef  = useRef<'qty' | 'total' | 'margin'>('qty');
  const priceSyncKey   = useRef('');
  const limitPrefilledForSymbolRef = useRef<string | null>(null);
  const priceRef = useRef(price);
  priceRef.current = price;
  const qtyRef = useRef(qty);
  qtyRef.current = qty;
  const totalRef = useRef(total);
  totalRef.current = total;
  const marginRef = useRef(margin);
  marginRef.current = margin;

  // Transfer modal
  const [showTransfer,     setShowTransfer]     = useState(false);
  const [transferDir,      setTransferDir]      = useState<'spot_to_futures' | 'futures_to_spot'>('spot_to_futures');
  const [transferAmount,   setTransferAmount]   = useState('');
  const [transferLoading,  setTransferLoading]  = useState(false);

  // Order book price seed
  const [priceSeed, setPriceSeed] = useState('');

  const [syncingMargin, setSyncingMargin] = useState(false);
  const [dataTab, setDataTab] = useState<FuturesDataTab>('positions');

  const [showMarginModePicker, setShowMarginModePicker] = useState(false);
  const [showOrderTypePicker, setShowOrderTypePicker] = useState(false);
  const [showOrderSettings, setShowOrderSettings] = useState(false);
  const [sizingMode, setSizingMode] = useState<FuturesSizingMode>('amount');
  const [amountUnit, setAmountUnit] = useState<FuturesAmountUnit>('BASE');
  /** Open = opening new position, Close = closing existing */
  const [openCloseTab, setOpenCloseTab] = useState<'open' | 'close'>('open');
  /** HH:MM:SS countdown to next 8h funding settlement */
  const [fundingCountdown, setFundingCountdown] = useState(() => formatFundingCountdown());
  const [makerFeeRate, setMakerFeeRate] = useState(DEFAULT_MAKER_FEE);
  const [takerFeeRate, setTakerFeeRate] = useState(DEFAULT_TAKER_FEE);
  const [iboPriceUsdt, setIboPriceUsdt] = useState(DEFAULT_IBO_PRICE_USDT);
  const [quoteLoading, setQuoteLoading] = useState(true);
  const [hideOtherPairs, setHideOtherPairs] = useState(false);
  const [showLeveragePanel, setShowLeveragePanel] = useState(false);
  const [inlineTpSl, setInlineTpSl] = useState(false);
  /** Measured terminal row height — drives order-book row count when form grows/shrinks. */
  const [layoutTerminalH, setLayoutTerminalH] = useState(0);

  const handleTpSlToggle = useCallback((v: boolean) => {
    animateTerminalLayout();
    setInlineTpSl(v);
    if (!v) {
      setTpPrice('');
      setSlPrice('');
    }
  }, []);

  const toggleLeveragePanel = useCallback(() => {
    animateTerminalLayout();
    setShowLeveragePanel((v) => !v);
  }, []);

  const symbolRef = useRef(symbol);
  const spotSymRef = useRef(spotSym);
  const spotRefPriceRef = useRef(spotRefPrice);
  const futuresMetaRef = useRef(futuresMeta);
  symbolRef.current = symbol;
  spotSymRef.current = spotSym;
  spotRefPriceRef.current = spotRefPrice;
  futuresMetaRef.current = futuresMeta;

  const wsMkUnsub = useRef<(() => void) | null>(null);
  const wsAccUnsub = useRef<(() => void) | null>(null);
  const displayOrderBook = useMemo(
    () => resolveDisplayOrderBook(liveBook, perpBook, 'futures'),
    [liveBook, perpBook],
  );

  const bookHasDepth = orderBookHasDepth(displayOrderBook);

  const applyFundingRate = useCallback((raw: unknown) => {
    if (raw == null || raw === '') return;
    const rate = parseN(raw);
    if (Number.isFinite(rate)) setFundingRate(rate);
  }, []);

  const refreshAccountWallet = useCallback(async (force = false) => {
    const data = await futuresApi.getWalletCached(force);
    if (data) setWallet(data);
  }, []);

  const refreshFundingRate = useCallback(async (force = false) => {
    const rate = await futuresApi.getFundingRateCached(symbol, force);
    if (rate != null) setFundingRate(rate);
  }, [symbol]);

  // ── Load ──────────────────────────────────────────────────────────────────
  const load = useCallback(async (opts?: { refreshOnly?: boolean }): Promise<QuoteSnap> => {
    void opts;
    const safeGet = async (fn: () => Promise<any>) => {
      try {
        return await fn();
      } catch {
        return null;
      }
    };

    void refreshAccountWallet();
    void refreshFundingRate();

    const snap: QuoteSnap = { mark: 0, index: 0, bestBid: 0, bestAsk: 0, last: 0 };

    const [mpRes, symRes] = await Promise.all([
      safeGet(() => futuresApi.getMarkPrice(symbol)),
      safeGet(() => futuresApi.getSymbols()),
    ]);

    void safeGet(() => futuresApi.getPublicFeeConfig()).then((feeCfgRes) => {
      if (!feeCfgRes?.data) return;
      const root = feeCfgRes.data as Record<string, unknown>;
      const fut = (root?.futures || {}) as Record<string, unknown>;
      const m = Number(fut.maker_fee_rate);
      const t = Number(fut.taker_fee_rate);
      const ibo = Number(root.ibo_price_usdt ?? fut.ibo_price_usdt);
      if (Number.isFinite(m) && m >= 0) setMakerFeeRate(m);
      if (Number.isFinite(t) && t >= 0) setTakerFeeRate(t);
      if (Number.isFinite(ibo) && ibo > 0) setIboPriceUsdt(ibo);
    });

    void safeGet(() => futuresApi.getMarketTrades(symbol, 20)).then((tradesRes) => {
      if (symbolRef.current !== symbol) return;
      const tradesArr = Array.isArray(tradesRes?.data) ? tradesRes.data : [];
      setRecentTrades(tradesArr);
    });

    let mark = 0;
    let index = 0;
    let spotPx = spotRefPriceRef.current > 0 ? spotRefPriceRef.current : 0;
    const metaSnap = futuresMetaRef.current;
    if (mpRes?.data != null) {
      const extracted = extractFuturesMarkPayload(mpRes.data);
      mark = extracted.mark;
      index = extracted.index;
      if (extracted.funding != null && Number.isFinite(extracted.funding)) {
        applyFundingRate(extracted.funding);
      }
    }
    if (mark <= 0 && metaSnap.mark > 0) mark = metaSnap.mark;
    if (index <= 0 && metaSnap.index > 0) index = metaSnap.index;
    if (mark <= 0 && spotPx > 0) mark = spotPx;
    if (index <= 0 && mark > 0) index = mark;
    if (mark > 0) setMarkPrice(mark);
    if (index > 0) setIndexPrice(index);
    snap.mark = mark;
    snap.index = index;

    const cachedSpot = getCachedOrderBook(spotSym);
    const cachedPerp = getCachedOrderBook(symbol);
    const sides = bookBestSides(cachedPerp ?? cachedSpot ?? { bids: [], asks: [] });
    snap.bestBid = sides.bid;
    snap.bestAsk = sides.ask;
    if (spotSymRef.current === spotSym) {
      setSpotBid(sides.bid);
      setSpotAsk(sides.ask);
    }

    if (symRes) {
      const catalog = (symRes.data as any)?.symbols ?? [];
      const levPresetsRaw =
        (symRes.data as any)?.leverage_presets ?? (symRes.data as any)?.leverage_options;
      if (Array.isArray(levPresetsRaw) && levPresetsRaw.length) {
        setLevPresets(levPresetsRaw.map((x: unknown) => parseN(x)).filter((x: number) => x > 0));
      }
      const meta = catalog.find((s: any) => s.symbol === symbol);
      if (meta) {
        if (meta.tick_size != null) setTickSize(parseN(meta.tick_size));
        if (meta.lot_size || meta.min_qty) setLotSize(parseN(meta.lot_size ?? meta.min_qty));
        if (meta.max_leverage) setMaxLev(parseN(meta.max_leverage));
        if (meta.min_notional != null) setMinNotional(parseN(meta.min_notional));
      }
    }

    const lp0 = lastTradePrice(metaSnap.recentTrades);
    snap.last = lp0 > 0 ? lp0 : spotPx;

    const [posRes, ordRes, setRes] = await Promise.all([
      safeGet(() => futuresApi.getPositions(symbol)),
      safeGet(() => futuresApi.getOpenOrders(symbol)),
      safeGet(() => futuresApi.getSettings(symbol)),
    ]);

    if (posRes) setPositions(Array.isArray(posRes.data) ? posRes.data : []);
    if (ordRes) setOpenOrders(Array.isArray(ordRes.data) ? ordRes.data : []);
    if (setRes?.data) {
      const s = setRes.data as FuturesSettings;
      setSettings(prev => ({
        leverage: parseN(s.leverage) || prev.leverage,
        margin_mode: s.margin_mode === 'isolated' ? 'isolated' : 'cross',
        max_leverage: s.max_leverage ?? prev.max_leverage,
      }));
      if (s.max_leverage) setMaxLev(parseN(s.max_leverage));
    }

    void safeGet(() => futuresApi.getOrderHistory({ symbol, limit: 50 })).then((histRes) => {
      if (histRes) setHistory(Array.isArray(histRes.data) ? histRes.data : []);
    });
    void safeGet(() => futuresApi.getMyTrades({ symbol, limit: 40 })).then((myTrRes) => {
      if (myTrRes?.data) setMyTrades(Array.isArray(myTrRes.data) ? myTrRes.data : []);
    });
    void safeGet(() => futuresApi.getWalletTxns({ limit: 25 })).then((txnsRes) => {
      if (txnsRes?.data) setWalletTxns(Array.isArray(txnsRes.data) ? txnsRes.data : []);
    });
    void safeGet(() => futuresApi.getPositionsHistory({ limit: 40 })).then((posHistRes) => {
      if (!posHistRes?.data) {
        setClosedPositions([]);
        return;
      }
      const rows = Array.isArray(posHistRes.data) ? posHistRes.data : [];
      setClosedPositions(rows.filter((p: any) => !p.symbol || p.symbol === symbol));
    });

    return snap;
  }, [symbol, spotSym, refreshAccountWallet, refreshFundingRate, applyFundingRate]);

  const runLoad = useCallback(async () => {
    try {
      await load();
    } finally {
      if (symbolRef.current === symbol) setQuoteLoading(false);
    }
  }, [load, symbol]);

  const { refresh, resetStale } = useRefreshIfStale(runLoad, 45_000);

  // ── Subscriptions ─────────────────────────────────────────────────────────
  useEffect(() => {
    resetStale();
    void refresh(true);

    const mkUrl = futuresWsUrl('/ws/futures/markets');
    wsMkUnsub.current = wsManager.subscribe(mkUrl, mkUrl, (msg: any) => {
      if (msg?.type !== 'futures_markets') return;
      const markets = Array.isArray(msg.markets) ? msg.markets : [];
      const nextMarks: Record<string, number> = {};
      for (const m of markets) {
        const symKey = String(m?.symbol ?? '');
        if (!symKey) continue;
        const { mark } = extractFuturesMarkPayload(m);
        if (mark > 0) nextMarks[symKey] = mark;
      }
      if (Object.keys(nextMarks).length) {
        setMarkBySymbol((prev) => ({ ...prev, ...nextMarks }));
      }
      const row = markets.find(
        (m: Record<string, unknown>) => m?.symbol === symbol,
      );
      if (!row) return;
      const { mark, index } = extractFuturesMarkPayload(row);
      if (mark > 0) setMarkPrice(mark);
      if (index > 0) setIndexPrice(index);
      const fr = (row as Record<string, unknown>).funding_rate ?? (row as Record<string, unknown>).rate;
      if (fr != null) applyFundingRate(fr);
    });

    const connectFuturesAccount = (token: string) => {
      wsAccUnsub.current?.();
      wsAccUnsub.current = null;
      const accUrl = futuresWsUrl(`/ws/futures/account?token=${encodeURIComponent(token)}`);
      wsAccUnsub.current = wsManager.subscribe(accUrl, accUrl, (msg: any) => {
        if (msg?.type !== 'futures_account') return;
        if (msg.wallet)     setWallet(msg.wallet);
        if (Array.isArray(msg.positions))    setPositions(msg.positions);
        if (Array.isArray(msg.open_orders))  setOpenOrders(msg.open_orders);
        if (Array.isArray(msg.order_history)) setHistory(msg.order_history);
        if (Array.isArray(msg.user_trades))  setMyTrades(msg.user_trades);
        if (msg.mark_price) setMarkPrice(parseN(msg.mark_price));
        if (msg.index_price) setIndexPrice(parseN(msg.index_price));
      });
    };

    const memToken = getMemoryAccessToken();
    if (user && memToken) {
      connectFuturesAccount(memToken);
    } else if (user) {
      StorageService.get(STORAGE_KEYS.TOKEN).then((token) => {
        if (token) connectFuturesAccount(token);
      });
    }

    return () => {
      wsMkUnsub.current?.();
      wsMkUnsub.current = null;
      wsAccUnsub.current?.();
      wsAccUnsub.current = null;
    };
  }, [symbol, spotSym, refresh, resetStale, applyFundingRate, user]);

  useEffect(() => {
    if (symbolRef.current !== symbol) return;
    if (futuresMeta.recentTrades.length) setRecentTrades(futuresMeta.recentTrades);
    if (futuresMeta.mark > 0) {
      setMarkPrice(futuresMeta.mark);
      setQuoteLoading(false);
    }
    if (futuresMeta.index > 0) setIndexPrice(futuresMeta.index);
  }, [futuresMeta, symbol]);

  /** Sub-second spot index — mirrors web FuturesContext Binance miniTicker overlay. */
  useEffect(() => {
    return subscribeBinanceSpotIndex(symbol, (px) => {
      if (symbolRef.current !== symbol) return;
      setIndexPrice(px);
      setMarkPrice((prev) => (prev > 0 ? prev : px));
      setQuoteLoading(false);
    });
  }, [symbol]);

  const refreshWalletSession = useCallback(() => {
    if (!user) return;
    dispatch(fetchKycThunk());
    dispatch(fetchWalletThunk());
  }, [dispatch, user]);

  const { refresh: refreshWalletIfStale } = useRefreshIfStale(refreshWalletSession, 45_000);

  useEffect(() => {
    prefetchChartPageData(symbol, 'futures');
  }, [symbol]);

  useFocusEffect(
    useCallback(() => {
      void refresh(false);
      refreshWalletSession();
      void refreshWalletIfStale();
      void refreshAccountWallet();
      void refreshFundingRate(true);
    }, [refresh, refreshWalletSession, refreshWalletIfStale, refreshAccountWallet, refreshFundingRate]),
  );

  useEffect(() => {
    void refreshFundingRate(true);
  }, [symbol, refreshFundingRate]);

  // ── Order-book price seed → prefill price ─────────────────────────────────
  useEffect(() => {
    if (!priceSeed) return;
    priceSyncKey.current = '';
    setPrice(priceSeed);
    setOrderType('limit');
  }, [priceSeed]);

  // ── Reset form on symbol change ────────────────────────────────────────────
  useEffect(() => {
    const cachedSpot = getCachedOrderBook(spotSym);
    const cachedPerp = getCachedOrderBook(symbol);
    setQuoteLoading(true);
    setPrice(''); setStopPrice(''); setQty(''); setTotal(''); setMargin('');
    setTpPrice(''); setSlPrice('');
    setInlineTpSl(false);
    setShowLeveragePanel(false);
    setTpTriggerMode('pnl_ratio');
    setSlTriggerMode('pnl_ratio');
    setTradeErr(''); setTradeOk('');
    sizeSourceRef.current = 'qty';
    priceSyncKey.current  = '';
    limitPrefilledForSymbolRef.current = null;
    setMarkPrice(0);
    setIndexPrice(0);
    setFundingRate(null);
    setSpotRefPrice(0);
    const cachedSides = bookBestSides(cachedSpot ?? cachedPerp ?? { bids: [], asks: [] });
    setSpotBid(cachedSides.bid);
    setSpotAsk(cachedSides.ask);
    setRecentTrades([]);
  }, [symbol, spotSym]);

  // ── Derived market values ─────────────────────────────────────────────────
  const bestBid   = parseQuoteNum((displayOrderBook.bids ?? [])[0]?.price ?? 0);
  const bestAsk   = parseQuoteNum((displayOrderBook.asks ?? [])[0]?.price ?? 0);
  const lastTrade = lastTradePrice(recentTrades);

  const quotes = useMemo(() => {
    const dispMark = markPrice > 0 ? markPrice : spotRefPrice;
    const dispIndex = indexPrice > 0 ? indexPrice : spotRefPrice;
    const dispBid = bestBid > 0 ? bestBid : spotBid;
    const dispAsk = bestAsk > 0 ? bestAsk : spotAsk;
    const dispLast = lastTrade > 0 ? lastTrade : spotRefPrice;
    const dispSpread = dispBid > 0 && dispAsk > 0 ? dispAsk - dispBid : 0;
    return { dispMark, dispIndex, dispBid, dispAsk, dispLast, dispSpread };
  }, [markPrice, indexPrice, spotRefPrice, bestBid, bestAsk, spotBid, spotAsk, lastTrade]);

  const availMargin = useMemo(() => futuresWalletAvailable(wallet), [wallet]);

  const spotUsdtBalance = useMemo(
    () => findWalletAvailable(tradeAssets, 'USDT'),
    [tradeAssets],
  );
  const leverage  = parseN(settings.leverage ?? 10);

  useEffect(() => {
    if (orderType === 'limit' || orderType === 'stop_limit') {
      limitPrefilledForSymbolRef.current = null;
    }
  }, [orderType]);

  /** One-time limit price seed per symbol when quotes arrive (user can still clear/edit). */
  useEffect(() => {
    if (orderType === 'market' || orderType === 'stop_market' || orderType === 'take_profit') return;
    if (price !== '') return;
    if (limitPrefilledForSymbolRef.current === symbol) return;
    const seed = pickLatestLimitPrice({
      mark: quotes.dispMark,
      index: quotes.dispIndex,
      spot: spotRefPrice,
      last: quotes.dispLast,
      side: 'buy',
      bid: quotes.dispBid,
      ask: quotes.dispAsk,
    });
    if (!Number.isFinite(seed) || seed <= 0) return;
    limitPrefilledForSymbolRef.current = symbol;
    priceSyncKey.current = '';
    setPrice(formatFuturesLimitPrice(seed, tickSize));
  }, [symbol, orderType, price, quotes, spotRefPrice, tickSize]);

  // Throttled BBO/mark for form sizing — live quotes still drive header + order book.
  const stableDispBid = useStableNumber(quotes.dispBid);
  const stableDispAsk = useStableNumber(quotes.dispAsk);
  const stableDispMark = useStableNumber(quotes.dispMark);
  const stableDispLast = useStableNumber(quotes.dispLast);

  const limitPx   = (orderType === 'limit' || orderType === 'stop_limit') ? (parseFloat(price) || 0) : 0;
  const marketPx  = (orderType === 'market' || orderType === 'stop_market' || orderType === 'take_profit')
    ? (side === 'buy'
      ? (stableDispAsk || stableDispMark || stableDispLast)
      : (stableDispBid || stableDispMark || stableDispLast))
    : 0;

  const sizingCtxRef = useRef({
    orderType,
    side,
    limitPx: 0,
    markPx: 0,
    lastPx: 0,
    topBid: 0,
    topAsk: 0,
  });
  sizingCtxRef.current = {
    orderType,
    side,
    limitPx: parseFloat(price) || 0,
    markPx: quotes.dispMark,
    lastPx: quotes.dispLast,
    topBid: quotes.dispBid,
    topAsk: quotes.dispAsk,
  };

  const liveFillPx = resolveFuturesFillPrice(sizingCtxRef.current);
  const stableFillPx = resolveFuturesFillPrice({
    ...sizingCtxRef.current,
    markPx: stableDispMark,
    lastPx: stableDispLast,
    topBid: stableDispBid,
    topAsk: stableDispAsk,
    limitPx: (orderType === 'limit' || orderType === 'stop_limit') ? limitPx : 0,
  });

  const liveSizingPx = resolveSizingFillPx({
    orderType,
    side,
    openCloseTab,
    limitPx: parseFloat(price) || 0,
    markPx: quotes.dispMark,
    lastPx: quotes.dispLast,
    topBid: quotes.dispBid,
    topAsk: quotes.dispAsk,
  });
  const stableSizingPx = resolveSizingFillPx({
    orderType,
    side,
    openCloseTab,
    limitPx,
    markPx: stableDispMark,
    lastPx: stableDispLast,
    topBid: stableDispBid,
    topAsk: stableDispAsk,
  });
  const sizingFillPx = liveSizingPx > 0 ? liveSizingPx : stableSizingPx;

  const fillPxRef = useRef(0);
  fillPxRef.current = sizingFillPx;

  const refPx = (orderType === 'market' || orderType === 'stop_market' || orderType === 'take_profit')
    ? marketPx
    : limitPx;
  const refPxFill = sizingFillPx > 0 ? sizingFillPx : (liveFillPx > 0 ? liveFillPx : stableFillPx);

  // ── Bidirectional size sync on price change ───────────────────────────────
  useEffect(() => {
    if (orderType === 'market' || orderType === 'stop_market' || orderType === 'take_profit') return;
    const px  = parseFloat(price);
    if (!Number.isFinite(px) || px <= 0) return;
    const key = `${symbol}|${price}`;
    if (priceSyncKey.current === key) return;
    priceSyncKey.current = key;
    const lev = Math.max(1, leverage);
    const src = sizeSourceRef.current;
    if (src === 'total') {
      const t = parseFloat(total);
      if (t > 0) { setQty(trimN(t / px, 6)); setMargin(trimN(t / lev)); }
    } else if (src === 'margin') {
      const m = parseFloat(margin);
      if (m > 0) { const tot = m * lev; setTotal(trimN(tot)); setQty(trimN(tot / px, 6)); }
    } else {
      const q = parseFloat(qty);
      if (q > 0) { const tot = q * px; setTotal(trimN(tot)); setMargin(trimN(tot / lev)); }
    }
  }, [price, symbol, orderType, leverage]);

  const handleQtyChange = useCallback((v: string) => {
    sizeSourceRef.current = 'qty';
    setQty(v);
    const px = fillPxRef.current || resolveFuturesFillPrice(sizingCtxRef.current);
    const lev = Math.max(1, leverage);
    const q = parseFloat(v);
    if (q > 0 && px > 0) {
      setTotal(trimN(q * px));
      setMargin(trimN(q * px / lev));
    } else {
      setTotal('');
      setMargin('');
    }
  }, [leverage]);

  const handleTotalChange = useCallback((v: string) => {
    sizeSourceRef.current = 'total';
    setTotal(v);
    const px = fillPxRef.current || resolveFuturesFillPrice(sizingCtxRef.current);
    const lev = Math.max(1, leverage);
    const t = parseFloat(v);
    if (t > 0 && px > 0) {
      setQty(trimN(t / px, 6));
      setMargin(trimN(t / lev));
    } else {
      setQty('');
      setMargin('');
    }
  }, [leverage]);

  const handleMarginChange = useCallback((v: string) => {
    sizeSourceRef.current = 'margin';
    setMargin(v);
    const isLimitLike = sizingCtxRef.current.orderType === 'limit'
      || sizingCtxRef.current.orderType === 'stop_limit';
    const px = isLimitLike
      ? (parseFloat(priceRef.current) || fillPxRef.current || 0)
      : (fillPxRef.current || resolveFuturesFillPrice(sizingCtxRef.current));
    const lev = Math.max(1, leverage);
    const m = parseFloat(v);
    if (m > 0) {
      const tot = m * lev;
      setTotal(trimN(tot));
      if (px > 0) setQty(trimN(tot / px, 6));
    } else {
      setQty('');
      setTotal('');
    }
  }, [leverage]);

  const handleTotalChangeRef = useRef(handleTotalChange);
  handleTotalChangeRef.current = handleTotalChange;

  const prevLevSizingRef = useRef(leverage);
  useEffect(() => {
    if (leverage === prevLevSizingRef.current) return;
    prevLevSizingRef.current = leverage;
    if (sizingMode === 'cost') {
      const m = parseFloat(marginRef.current);
      if (m > 0) handleMarginChange(marginRef.current);
    } else {
      const q = parseFloat(qtyRef.current);
      if (q > 0) handleQtyChange(qtyRef.current);
      else {
        const t = parseFloat(totalRef.current);
        if (t > 0 && amountUnit === 'USDT') handleTotalChange(totalRef.current);
      }
    }
  }, [leverage, sizingMode, amountUnit, handleMarginChange, handleQtyChange, handleTotalChange]);

  // Margin → qty when limit price arrives after % fill (web FuturesTradeForm parity).
  useEffect(() => {
    if (orderType === 'market' || orderType === 'stop_market' || orderType === 'take_profit') return;
    if (sizeSourceRef.current !== 'margin') return;
    const px = parseFloat(price);
    if (!Number.isFinite(px) || px <= 0) return;
    const m = parseFloat(marginRef.current);
    if (!Number.isFinite(m) || m <= 0) return;
    const lev = Math.max(1, leverage);
    const tot = m * lev;
    setTotal(trimN(tot));
    setQty(trimN(tot / px, 6));
  }, [price, leverage, orderType]);

  const snapLatest = useCallback(() => {
    const local = pickLatestLimitPrice({
      mark: markPrice,
      index: indexPrice,
      spot: spotRefPrice,
      last: lastTrade,
      side,
      bid: bestBid > 0 ? bestBid : spotBid,
      ask: bestAsk > 0 ? bestAsk : spotAsk,
    });
    if (local > 0) {
      priceSyncKey.current = '';
      setPrice(formatFuturesLimitPrice(local, tickSize));
      return;
    }
    load({ refreshOnly: true }).then((snap) => {
      const ref = pickLatestLimitPrice({
        mark: snap.mark,
        index: snap.index,
        spot: spotRefPrice,
        last: snap.last,
        side,
        bid: snap.bestBid > 0 ? snap.bestBid : spotBid,
        ask: snap.bestAsk > 0 ? snap.bestAsk : spotAsk,
      });
      if (ref > 0) {
        priceSyncKey.current = '';
        setPrice(formatFuturesLimitPrice(ref, tickSize));
      }
    });
  }, [load, markPrice, indexPrice, spotRefPrice, lastTrade, side, bestBid, bestAsk, spotBid, spotAsk, tickSize]);

  // ── Summary values ────────────────────────────────────────────────────────
  const qtyNum  = Math.max(0, parseFloat(qty) || 0);
  const isMarketLikeOrder =
    orderType === 'market' || orderType === 'stop_market' || orderType === 'take_profit';
  const notional = qtyNum > 0 && refPx > 0 ? qtyNum * refPx : 0;
  const summaryPx = isMarketLikeOrder
    ? (quotes.dispIndex > 0 ? quotes.dispIndex : quotes.dispMark)
    : limitPx;
  const initMargin = leverage > 0 && notional > 0 ? notional / leverage : 0;
  const insufficient = initMargin > 0 && initMargin > availMargin + 1e-9;
  const belowMinNotional = notional > 0 && notional < minNotional;
  const limitRestsBook = !!(
    orderType === 'limit' && markPrice > 0 && limitPx > 0
    && (side === 'buy' ? limitPx < markPrice : limitPx > markPrice)
  );
  const limitRole = orderType === 'limit' && limitPx > 0
    ? (limitRestsBook ? 'maker' : 'taker')
    : null;
  const feeRate = limitRole === 'maker' ? makerFeeRate : takerFeeRate;
  const estFee  = notional * feeRate;
  const estFeeIbo = estimateIboFee({
    quoteNotional: notional,
    feeRate,
    iboPriceUsdt,
  });
  const availIbo = findWalletAvailable(tradeAssets, 'IBO');
  const insufficientIboFee = Boolean(user && estFeeIbo > 0 && estFeeIbo > availIbo + 1e-12);
  const tradeSubmitDisabled = placingSide !== null || insufficientIboFee;
  const liqEstLong = calcFuturesLiqPrice(symbol, 'buy', summaryPx || refPx, leverage, notional);
  const liqEstShort = calcFuturesLiqPrice(symbol, 'sell', summaryPx || refPx, leverage, notional);

  const marketFill = useMemo(() => {
    if (!isMarketLikeOrder || qtyNum <= 0) return null;
    const levels = side === 'buy'
      ? (displayOrderBook.asks ?? [])
      : (displayOrderBook.bids ?? []);
    return walkFuturesBook(levels, qtyNum);
  }, [isMarketLikeOrder, side, qtyNum, displayOrderBook.asks, displayOrderBook.bids]);

  // ── Place order ────────────────────────────────────────────────────────────
  const handlePlaceOrder = async (sideOverride?: 'buy' | 'sell') => {
    const effectiveSide = sideOverride ?? side;
    setSide(effectiveSide);
    setTradeErr(''); setTradeOk('');
    if (kycFuturesBlocked) {
      goToKyc();
      return;
    }
    if (insufficientIboFee) {
      setTradeErr(`Insufficient IBO for fee (need ~${formatIboFee(estFeeIbo)}).`);
      return;
    }
    if (openCloseTab === 'close') {
      const pos = positions.find(p => positionMatchesSymbol(p.symbol, symbol)) ?? null;
      if (!pos) {
        setTradeErr('No open position to close for this pair');
        return;
      }
      const posLong = pos.side === 'long' || (pos as any).side === 'buy';
      if (effectiveSide === 'sell' && !posLong) {
        setTradeErr('No long position to close');
        return;
      }
      if (effectiveSide === 'buy' && posLong) {
        setTradeErr('No short position to close');
        return;
      }
    }
    if (qtyNum <= 0) {
      setTradeErr('Enter a size — type an amount or use the % slider');
      return;
    }
    const isMarketLike =
      orderType === 'market'
      || orderType === 'stop_market'
      || orderType === 'take_profit';
    if (isMarketLike && refPxFill <= 0) {
      setTradeErr('Waiting for market price…');
      return;
    }
    if (openCloseTab === 'open' && insufficient) {
      setTradeErr(
        `Insufficient margin — need ≈${initMargin.toFixed(2)} USDT, available ${fmtN(availMargin, 2)} USDT`,
      );
      return;
    }
    if (
      orderType !== 'market'
      && orderType !== 'stop_market'
      && orderType !== 'take_profit'
      && (!price || limitPx <= 0)
    ) {
      setTradeErr('Enter a limit price');
      return;
    }
    if (orderType === 'stop_limit' || orderType === 'stop_market' || orderType === 'take_profit') {
      const sp = parseFloat(stopPrice);
      if (!stopPrice || !Number.isFinite(sp) || sp <= 0) {
        setTradeErr('Enter a trigger price');
        return;
      }
    }
    if (notional > 0 && notional < minNotional) {
      setTradeErr(`Minimum order notional is ${minNotional.toFixed(2)} USDT — increase size or price.`);
      return;
    }
    setPlacingSide(effectiveSide);
    try {
      let bracketTp: number | undefined;
      let bracketSl: number | undefined;

      if (inlineTpSl && (orderType === 'limit' || orderType === 'market')) {
        const entryForBracket = orderType === 'limit' ? limitPx : refPx;
        if (!entryForBracket || entryForBracket <= 0) {
          setTradeErr('Need a valid entry price to set TP/SL');
          setPlacingSide(null);
          return;
        }

        const tpRaw = parseFloat(tpPrice);
        if (tpPrice.trim() && Number.isFinite(tpRaw) && tpRaw > 0) {
          const resolvedTp = resolveBracketTriggerPrice({
            mode: tpTriggerMode,
            rawValue: tpRaw,
            leg: 'tp',
            side: effectiveSide,
            entryPrice: entryForBracket,
            quantity: qtyNum,
            leverage,
          });
          if (
            resolvedTp == null
            || !isValidBracketPrice('tp', effectiveSide, entryForBracket, resolvedTp)
          ) {
            setTradeErr('Invalid take-profit — check value and price direction');
            setPlacingSide(null);
            return;
          }
          bracketTp = parseFloat(formatFuturesLimitPrice(resolvedTp, tickSize));
        }

        const slRaw = parseFloat(slPrice);
        if (slPrice.trim() && Number.isFinite(slRaw) && slRaw > 0) {
          const resolvedSl = resolveBracketTriggerPrice({
            mode: slTriggerMode,
            rawValue: slRaw,
            leg: 'sl',
            side: effectiveSide,
            entryPrice: entryForBracket,
            quantity: qtyNum,
            leverage,
          });
          if (
            resolvedSl == null
            || !isValidBracketPrice('sl', effectiveSide, entryForBracket, resolvedSl)
          ) {
            setTradeErr('Invalid stop-loss — check value and price direction');
            setPlacingSide(null);
            return;
          }
          bracketSl = parseFloat(formatFuturesLimitPrice(resolvedSl, tickSize));
        }
      }

      const payload: FuturesOrderPayload = {
        symbol,
        side: effectiveSide,
        type: orderType,
        quantity: qtyNum,
        price: (orderType === 'limit' || orderType === 'stop_limit') ? limitPx : null,
        stop_price: (orderType === 'stop_limit' || orderType === 'stop_market' || orderType === 'take_profit')
          ? (parseFloat(stopPrice) || null)
          : null,
        take_profit_price: bracketTp ?? null,
        stop_loss_price: bracketSl ?? null,
        leverage,
        tif,
        reduce_only: openCloseTab === 'close' ? true : reduceOnly,
      };
      await futuresApi.placeOrder(payload);
      setTradeOk(`Order placed — ${effectiveSide === 'buy' ? 'Long' : 'Short'} ${qtyNum} ${spotSym}`);
      setQty(''); setTotal(''); setMargin('');
      setTpPrice(''); setSlPrice('');
      setTimeout(() => setTradeOk(''), 5000);
      load();
    } catch (err) {
      setTradeErr(parseApiError(err).message);
      setTimeout(() => setTradeErr(''), 6000);
    } finally {
      setPlacingSide(null);
    }
  };

  // ── Close position ─────────────────────────────────────────────────────────
  const handleClosePos = (pos: FuturesPosition, fraction?: number) => {
    const qty = fraction ? Math.abs((pos as any).qty ?? pos.size) * fraction : undefined;
    Alert.alert(
      'Close Position',
      `Close ${fraction ? `${fraction * 100}%` : 'all'} of ${pos.symbol} ${safeUpper(pos.side, 'position')}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Close', style: 'destructive',
          onPress: async () => {
            try {
              await futuresApi.closePosition({ symbol: pos.symbol, quantity: qty });
              load();
            } catch (err) {
              Alert.alert('Error', parseApiError(err).message);
            }
          },
        },
      ],
    );
  };

  // ── Funding countdown (ticks every second) ────────────────────────────────
  useEffect(() => {
    function tick() {
      setFundingCountdown(formatFundingCountdown());
    }
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  const handleLeverageCommit = useCallback((lev: number) => {
    setLevError('');
    futuresApi.setLeverage(symbol, lev, maxLev)
      .then((res) => {
        const applied = parseN((res.data as FuturesSettings)?.leverage ?? lev);
        setSettings(prev => ({
          ...prev,
          leverage: applied,
          max_leverage: (res.data as FuturesSettings)?.max_leverage ?? prev.max_leverage,
        }));
        const maxL = (res.data as FuturesSettings)?.max_leverage;
        if (maxL) setMaxLev(parseN(maxL));
      })
      .catch((err) => {
        const msg = parseApiError(err).message;
        setLevError(msg);
        Alert.alert('Leverage', msg);
      });
  }, [symbol, maxLev]);

  const handleMarginModeApplied = useCallback((mode: MarginMode) => {
    setSettings(prev => ({ ...prev, margin_mode: mode }));
  }, []);

  // ── Transfer ──────────────────────────────────────────────────────────────
  const handleTransfer = async () => {
    const amt = parseFloat(transferAmount);
    const max = transferDir === 'spot_to_futures' ? spotUsdtBalance : availMargin;
    if (!amt || amt <= 0) { Alert.alert('Invalid', 'Enter a valid amount'); return; }
    if (amt > max + 1e-9) {
      Alert.alert(
        'Insufficient balance',
        `Available: ${fmtN(max, 2)} USDT`,
      );
      return;
    }
    setTransferLoading(true);
    try {
      await submitFuturesTransfer(
        { direction: transferDir, amount: amt },
        { spot: spotUsdtBalance, futures: availMargin },
      );
      setShowTransfer(false);
      setTransferAmount('');
      scheduleTransferRefresh(dispatch, () => void refreshAccountWallet(true));
    } catch (err) {
      Alert.alert('Transfer Failed', parseApiError(err).message);
    } finally { setTransferLoading(false); }
  };

  const handleSyncLockedMargin = async () => {
    setSyncingMargin(true);
    try {
      const res = await futuresApi.syncLocked();
      const d = res.data as any;
      if (d?.ok === false) {
        Alert.alert('Sync margin', d?.error ?? 'Could not sync');
      } else {
        Alert.alert('Sync margin', 'Locked margin was reconciled with open positions.');
        load();
      }
    } catch (err) {
      Alert.alert('Sync margin', parseApiError(err).message);
    } finally {
      setSyncingMargin(false);
    }
  };

  // ── Header stats ──────────────────────────────────────────────────────────
  const pairDisplay = spotSym.includes('/')
    ? spotSym
    : spotSym.replace(/USDT$/, '/USDT').replace(/BTC$/, '/BTC').replace(/ETH$/, '/ETH') || spotSym;
  const bookPriceUp = (headerChangePct ?? 0) >= 0;

  const { width: screenW } = Dimensions.get('window');
  const chartContentWidth = screenW - SCREEN_H_PAD * 2;
  const candleSeed = useMemo(() => instantChartKlines(spotExchangeSym), [spotExchangeSym]);

  const toggleChartExpanded = useCallback(() => {
    setChartExpanded((prev) => !prev);
  }, []);

  const openFullscreenChart = useCallback((interval: ChartInterval) => {
    navigation.push('FullChartView', {
      symbol: rawSymbol,
      market: 'futures',
      interval,
      livePrice: quotes.dispMark > 0 ? quotes.dispMark : undefined,
    });
  }, [navigation, rawSymbol, quotes.dispMark]);

  const { terminalHeight } = useTradeLayoutHeights(FuturesUi.terminalHeightRatio);

  const showStopTrigger =
    orderType === 'stop_limit' || orderType === 'stop_market' || orderType === 'take_profit';

  const handleOrderTypeChange = useCallback((next: OrderType) => {
    setOrderType(next);
    if (next !== 'stop_limit' && next !== 'stop_market' && next !== 'take_profit') {
      setStopPrice('');
    }
  }, []);

  const handleTerminalRowLayout = useCallback((e: LayoutChangeEvent) => {
    const h = Math.ceil(e.nativeEvent.layout.height);
    if (h <= 0) return;
    const next = Math.max(terminalHeight, h);
    setLayoutTerminalH(prev => (Math.abs(prev - next) >= 2 ? next : prev));
  }, [terminalHeight]);

  const effectiveTerminalH = Math.max(terminalHeight, layoutTerminalH);
  const bookRows = useMemo(
    () => computeTerminalBookRows(effectiveTerminalH, true),
    [effectiveTerminalH],
  );

  const prevOrderTypeRef = useRef(orderType);
  useEffect(() => {
    if (prevOrderTypeRef.current !== orderType) {
      animateTerminalLayout();
      prevOrderTypeRef.current = orderType;
    }
  }, [orderType]);

  const prevTradeFeedbackRef = useRef('');
  useEffect(() => {
    const key = tradeErr || tradeOk || '';
    if (key && key !== prevTradeFeedbackRef.current) {
      animateTerminalLayout();
    }
    prevTradeFeedbackRef.current = key;
  }, [tradeErr, tradeOk]);

  const activePosition = useMemo(
    () => positions.find(p => positionMatchesSymbol(p.symbol, symbol)) ?? null,
    [positions, symbol],
  );

  const posQtyAbs = activePosition
    ? Math.abs(parseN((activePosition as any).qty ?? activePosition.size ?? 0))
    : 0;
  const posIsLong = activePosition
    ? (activePosition.side === 'long' || (activePosition as any).side === 'buy')
    : false;

  const sizingCaps: FuturesSizingCaps = useMemo(() => ({
    availMargin,
    leverage,
    fillPx: refPxFill,
    lotSize,
  }), [availMargin, leverage, refPxFill, lotSize]);

  const pctCtxRef = useRef({
    openCloseTab,
    activePosition,
    posQtyAbs,
    posIsLong,
    side,
    refPx: refPxFill,
    availMargin,
    leverage,
    lotSize,
    sizingMode,
    amountUnit,
    sizingCaps,
  });
  pctCtxRef.current = {
    openCloseTab,
    activePosition,
    posQtyAbs,
    posIsLong,
    side,
    refPx: refPxFill,
    availMargin,
    leverage,
    lotSize,
    sizingMode,
    amountUnit,
    sizingCaps,
  };
  const handleQtyChangeRef = useRef(handleQtyChange);
  handleQtyChangeRef.current = handleQtyChange;
  const handleMarginChangeRef = useRef(handleMarginChange);
  handleMarginChangeRef.current = handleMarginChange;
  const setSideRef = useRef(setSide);
  setSideRef.current = setSide;

  const lastSliderPctRef = useRef(0);

  const applyPctFill = useCallback((pct: number) => {
    const v = Math.max(0, Math.min(100, Math.round(pct)));
    lastSliderPctRef.current = v;
    const ctx = pctCtxRef.current;
    if (v <= 0) {
      if (ctx.openCloseTab === 'close') {
        handleQtyChangeRef.current('');
      } else {
        handleMarginChangeRef.current('');
      }
      return;
    }
    if (ctx.openCloseTab === 'close') {
      if (!ctx.activePosition) return;
      if (ctx.posQtyAbs <= 0) return;
      const targetQty = (ctx.posQtyAbs * v) / 100;
      const closeSide = ctx.posIsLong ? 'sell' : 'buy';
      if (ctx.side !== closeSide) setSideRef.current(closeSide);
      handleQtyChangeRef.current(trimN(targetQty, 6));
      return;
    }

    const px = ctx.refPx;
    if (!px || px <= 0) {
      setTradeErr('Waiting for market price…');
      return;
    }
    if (ctx.availMargin <= 0) {
      setTradeErr('No available margin — transfer USDT from spot wallet');
      return;
    }

    const caps: FuturesSizingCaps = { ...ctx.sizingCaps, fillPx: px };
    const values = pctToSizingValues(v, ctx.sizingMode, ctx.amountUnit, caps);

    setTradeErr('');
    if (ctx.sizingMode === 'cost') {
      const m = values.margin > 0 ? trimN(values.margin, 4) : '';
      if (m) handleMarginChangeRef.current(m);
      else if (v >= 100) handleMarginChangeRef.current(trimN(ctx.availMargin, 4));
      return;
    }
    if (ctx.amountUnit === 'USDT') {
      const t = values.total > 0 ? trimN(values.total, 4) : '';
      if (t) handleTotalChangeRef.current(t);
      else if (v >= 100) handleTotalChangeRef.current(trimN(calcMaxOpenNotional(caps), 4));
      return;
    }
    const q = values.qty > 0 ? trimN(values.qty, 6) : '';
    if (q) {
      handleQtyChangeRef.current(q);
    } else if (v >= 100 && calcMaxOpenQty(caps) > 0) {
      handleQtyChangeRef.current(trimN(calcMaxOpenQty(caps), 6));
    }
  }, []);

  const fillRafRef = useRef<number | null>(null);
  const fillPendingRef = useRef<number | null>(null);

  const onPctLive = useCallback((pct: number) => {
    fillPendingRef.current = pct;
    if (fillRafRef.current != null) return;
    fillRafRef.current = requestAnimationFrame(() => {
      fillRafRef.current = null;
      const pending = fillPendingRef.current;
      if (pending != null) applyPctFill(pending);
    });
  }, [applyPctFill]);

  const sliderResetKey = `${symbol}|${openCloseTab}`;

  const sizingUnitLabel = unitButtonLabel(sizingMode, amountUnit, baseAsset);

  const sizingHint = useMemo(() => {
    if (openCloseTab === 'close') {
      return {
        current: parseFloat(qty) || 0,
        max: posQtyAbs,
        unit: baseAsset,
      };
    }
    return getSizingDisplay({
      mode: sizingMode,
      amountUnit,
      baseAsset,
      caps: sizingCaps,
      qty: parseFloat(qty) || 0,
      total: parseFloat(total) || 0,
      margin: parseFloat(margin) || 0,
    });
  }, [
    openCloseTab, sizingMode, amountUnit, baseAsset, sizingCaps,
    qty, total, margin, posQtyAbs,
  ]);

  const handleOrderSettingsConfirm = useCallback((mode: FuturesSizingMode, unit: FuturesAmountUnit) => {
    setSizingMode(mode);
    setAmountUnit(unit);
    const pct = lastSliderPctRef.current;
    if (pct > 0) {
      requestAnimationFrame(() => applyPctFill(pct));
    }
  }, [applyPctFill]);

  const primarySizeValue = useMemo(() => {
    if (openCloseTab === 'close') return qty;
    if (sizingMode === 'cost') return margin;
    if (amountUnit === 'USDT') return total;
    if (amountUnit === 'CONT') {
      const q = parseFloat(qty) || 0;
      return q > 0 ? trimN(qtyToContracts(q, lotSize), 0) : '';
    }
    return qty;
  }, [openCloseTab, sizingMode, amountUnit, qty, total, margin, lotSize]);

  const handlePrimarySizeChange = useCallback((v: string) => {
    if (openCloseTab === 'close') {
      handleQtyChange(v);
      return;
    }
    if (sizingMode === 'cost') {
      handleMarginChange(v);
      return;
    }
    if (amountUnit === 'USDT') {
      handleTotalChange(v);
      return;
    }
    if (amountUnit === 'CONT') {
      const c = parseFloat(v) || 0;
      handleQtyChange(c > 0 ? trimN(contractsToQty(c, lotSize), 6) : '');
      return;
    }
    handleQtyChange(v);
  }, [
    openCloseTab, sizingMode, amountUnit, lotSize,
    handleQtyChange, handleMarginChange, handleTotalChange,
  ]);

  useEffect(() => {
    const pct = sizingValuesToPct({
      mode: openCloseTab === 'close' ? 'amount' : sizingMode,
      amountUnit: openCloseTab === 'close' ? 'BASE' : amountUnit,
      caps: sizingCaps,
      qty: parseFloat(qty) || 0,
      total: parseFloat(total) || 0,
      margin: parseFloat(margin) || 0,
      closeMaxQty: openCloseTab === 'close' ? posQtyAbs : undefined,
    });
    if (pct > 0) lastSliderPctRef.current = pct;
  }, [
    qty, total, margin, sizingMode, amountUnit, sizingCaps,
    openCloseTab, posQtyAbs,
  ]);

  const sliderSyncPct = useMemo(() => {
    const fromRef = lastSliderPctRef.current;
    const computed = sizingValuesToPct({
      mode: openCloseTab === 'close' ? 'amount' : sizingMode,
      amountUnit: openCloseTab === 'close' ? 'BASE' : amountUnit,
      caps: sizingCaps,
      qty: parseFloat(qty) || 0,
      total: parseFloat(total) || 0,
      margin: parseFloat(margin) || 0,
      closeMaxQty: openCloseTab === 'close' ? posQtyAbs : undefined,
    });
    return computed > 0 ? computed : fromRef;
  }, [
    openCloseTab, sizingMode, amountUnit, sizingCaps,
    qty, total, margin, posQtyAbs,
  ]);

  useEffect(() => {
    lastSliderPctRef.current = 0;
    setQty('');
    setTotal('');
    setMargin('');
    if (openCloseTab === 'open') {
      setSide('buy');
    }
  }, [openCloseTab, symbol]);

  /** Slider accent: green on Open; on Close match the closing side (sell long / buy short). */
  const sliderSide: 'buy' | 'sell' = openCloseTab === 'open'
    ? 'buy'
    : (posIsLong ? 'sell' : 'buy');

  const activePositionId = activePosition?.position_id ?? null;
  useEffect(() => {
    if (openCloseTab !== 'close') return;
    if (!activePositionId) {
      lastSliderPctRef.current = 0;
      return;
    }
    const pct = lastSliderPctRef.current;
    if (pct > 0) applyPctFill(pct);
  }, [openCloseTab, activePositionId, applyPctFill]);

  useEffect(() => {
    const pct = lastSliderPctRef.current;
    if (pct > 0) applyPctFill(pct);
  }, [orderType, price, leverage, side, openCloseTab, sizingMode, amountUnit, applyPctFill, availMargin, posQtyAbs, sizingFillPx]);

  const prevFillPxRef = useRef(0);
  useEffect(() => {
    const prev = prevFillPxRef.current;
    prevFillPxRef.current = sizingFillPx;
    if (sizingFillPx > 0 && prev <= 0) {
      const pct = lastSliderPctRef.current;
      if (pct > 0) applyPctFill(pct);
    }
  }, [sizingFillPx, applyPctFill]);

  const filteredPositions = useMemo(
    () => (hideOtherPairs ? positions.filter(p => positionMatchesSymbol(p.symbol, symbol)) : positions),
    [hideOtherPairs, positions, symbol],
  );
  const filteredOpenOrders = useMemo(
    () => (hideOtherPairs ? openOrders.filter(o => o.symbol === symbol) : openOrders),
    [hideOtherPairs, openOrders, symbol],
  );

  const sizingPx = refPxFill > 0 ? refPxFill : refPx;
  const maxOpenQty = sizingPx > 0 && leverage > 0
    ? (availMargin * leverage) / sizingPx
    : 0;
  const maxLongQty = openCloseTab === 'close'
    ? (posIsLong ? posQtyAbs : 0)
    : maxOpenQty;
  const maxShortQty = openCloseTab === 'close'
    ? (activePosition && !posIsLong ? posQtyAbs : 0)
    : maxOpenQty;

  const closeLongDisabled = openCloseTab === 'close' && !posIsLong;
  const closeShortDisabled = openCloseTab === 'close' && (posIsLong || !activePosition);

  const stepQty = (delta: number) => {
    const lotStep = lotSize > 0 ? lotSize : 0.001;
    if (openCloseTab === 'close' || (sizingMode === 'amount' && amountUnit === 'BASE')) {
      const cur = parseFloat(qty) || 0;
      handleQtyChange(trimN(Math.max(0, cur + delta * lotStep), 6));
      return;
    }
    if (sizingMode === 'amount' && amountUnit === 'CONT') {
      const cur = qtyToContracts(parseFloat(qty) || 0, lotSize);
      const next = Math.max(0, cur + delta);
      handleQtyChange(next > 0 ? trimN(contractsToQty(next, lotSize), 6) : '');
      return;
    }
    if (sizingMode === 'amount' && amountUnit === 'USDT') {
      const px = sizingFillPx > 0 ? sizingFillPx : refPxFill;
      const inc = px > 0 ? lotStep * px : lotStep;
      const cur = parseFloat(total) || 0;
      handleTotalChange(trimN(Math.max(0, cur + delta * inc), 2));
      return;
    }
    const cur = parseFloat(margin) || 0;
    handleMarginChange(trimN(Math.max(0, cur + delta * lotStep), 4));
  };

  const bookFooter = useMemo(() => {
    const bids = (displayOrderBook.bids ?? []).reduce(
      (acc, r) => acc + parseFloat(String(r.amount ?? 0)), 0,
    );
    const asks = (displayOrderBook.asks ?? []).reduce(
      (acc, r) => acc + parseFloat(String(r.amount ?? 0)), 0,
    );
    const total = bids + asks;
    const bPct = total > 0 ? Math.round((bids / total) * 100) : 50;
    const sPct = 100 - bPct;
    return (
      <>
        <View style={s.sentimentWrap}>
          <View style={[s.sentimentBar, { flex: bPct }]} />
          <View style={[s.sentimentBarSell, { flex: sPct }]} />
          <View style={s.sentimentLabels}>
            <Text style={s.sentimentBuy}>B {bPct}%</Text>
            <Text style={s.sentimentSell}>S {sPct}%</Text>
          </View>
        </View>
        {quotes.dispIndex > 0 ? (
          <Text style={s.indexPriceRow} numberOfLines={1}>
            Index Price {formatPrice(quotes.dispIndex)}
          </Text>
        ) : null}
      </>
    );
  }, [displayOrderBook.bids, displayOrderBook.asks, quotes.dispIndex]);

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <SafeAreaWrapper style={s.screen}>
      <View style={s.headerBleed}>
        <TradeMarketHeader
          symbol={symbol}
          price={quotes.dispMark > 0 ? quotes.dispMark : undefined}
          changePct={headerChangePct}
          tag="PERP"
          mode="derivatives"
          onChartPress={() => {
            if (bookHasDepth) setCachedOrderBook(spotSym, displayOrderBook);
            prefetchChartPageData(symbol, 'futures');
            navigation.navigate('FuturesChart', {
              symbol,
              market: 'futures',
              leverage: settings.leverage,
              seedOrderBook: bookHasDepth ? displayOrderBook : undefined,
            });
          }}
          onTransferPress={() => setShowTransfer(true)}
        />
      </View>

      <View style={s.screenInset}>
        <TradeTerminalScrollLayout
          chart={(
            <View style={[s.chartSection, !chartExpanded && s.chartSectionCollapsed]}>
              {chartExpanded ? (
                <>
                  <ChartPreviewCard
                    symbol={spotExchangeSym}
                    height={TRADE_CHART_PANEL_H}
                    width={chartContentWidth}
                    livePrice={quotes.dispMark > 0 ? quotes.dispMark : undefined}
                    seedKlines={candleSeed.length ? candleSeed : undefined}
                    compactIntervals
                    onLockParentScroll={setSliderScrollLocked}
                  />
                  <FuturesChartToggleBar
                    title={`${pairDisplay} Perp Chart`}
                    expanded={chartExpanded}
                    placement="bottom"
                    onToggle={toggleChartExpanded}
                    onExpand={() => openFullscreenChart('1h')}
                  />
                </>
              ) : (
                <FuturesChartToggleBar
                  title={`${pairDisplay} Perp Chart`}
                  expanded={chartExpanded}
                  onToggle={toggleChartExpanded}
                  onExpand={() => openFullscreenChart('1h')}
                />
              )}
            </View>
          )}
          chartResetKey={chartExpanded ? 'open' : 'closed'}
          scrollEnabled={!sliderScrollLocked}
          style={s.bodyScroll}
          contentContainerStyle={s.bodyScrollContent}
        >
        <View style={s.futuresToolbar}>
          <TouchableOpacity
            style={s.toolChipDropdown}
            onPress={() => setShowMarginModePicker(true)}
            activeOpacity={0.8}
          >
            <Text style={s.toolChipTxt}>
              {settings.margin_mode === 'cross' ? 'Cross' : 'Isolated'}
            </Text>
            <Icon name="chevron-down" size={11} color={Colors.textMuted} />
          </TouchableOpacity>
          <TouchableOpacity
            style={s.toolChipDropdown}
            onPress={toggleLeveragePanel}
            activeOpacity={0.8}
          >
            <Text style={s.toolChipTxt}>{leverage}X</Text>
            <Icon name="chevron-down" size={11} color={Colors.textMuted} />
          </TouchableOpacity>
        </View>

        {showLeveragePanel ? (
          <View style={s.levPanelWrap}>
            <View style={s.levPanelHeader}>
              <Text style={s.levPanelTitle}>Leverage</Text>
              <TouchableOpacity
                onPress={() => {
                  animateTerminalLayout();
                  setShowLeveragePanel(false);
                }}
                hitSlop={8}
                activeOpacity={0.7}
              >
                <Icon name="close" size={16} color={Colors.textMuted} />
              </TouchableOpacity>
            </View>
            <LeverageSelector
              value={leverage}
              max={maxLev}
              presets={levPresets}
              onCommit={handleLeverageCommit}
            />
          </View>
        ) : null}

        {levError ? (
          <Text style={s.levErrorTxt}>{levError}</Text>
        ) : null}

        <View style={s.fundingInfoBar}>
          <Text style={s.fundingInfoLbl}>Funding/Countdown</Text>
          <View style={{ flex: 1 }} />
          <Text style={[s.fundingInfoRate, {
            color: fundingRate == null
              ? Colors.textMuted
              : fundingRate >= 0 ? Colors.warning : FuturesUi.long,
          }]}>
            {fundingRate != null ? `${fundingRate >= 0 ? '+' : ''}${(fundingRate * 100).toFixed(4)}%` : '—'}
          </Text>
          {fundingCountdown ? (
            <Text style={s.fundingInfoCountdown}>/{fundingCountdown}</Text>
          ) : (
            <Text style={s.fundingInfoCountdown}>/{formatFundingCountdown()}</Text>
          )}
        </View>

        {/* ── Terminal: order book (LEFT) + form (RIGHT), height follows form content ── */}
        <View style={[s.terminalBlock, { minHeight: terminalHeight }]}>
          <View style={s.terminalRow} onLayout={handleTerminalRowLayout}>
            <TradeTerminalPane style={s.bookPane} footer={bookFooter}>
              <OrderBookComp
                orderBook={displayOrderBook}
                currentPrice={quoteLoading ? 0 : (quotes.dispMark > 0 ? quotes.dispMark : spotRefPrice)}
                variant="terminal"
                maxRows={bookRows}
                hideDepthFooter
                priceUp={bookPriceUp}
                loading={!bookHasDepth}
                longColor={FuturesUi.long}
                longDim={FuturesUi.longDim}
                fairPrice={quotes.dispMark > 0 ? quotes.dispMark : null}
                onPriceClick={(p) => setPriceSeed(p)}
              />
            </TradeTerminalPane>

            <View style={s.formPane}>
              <View style={s.formSectionTop}>
              {/* Open / Close pill tabs */}
              <View style={s.openCloseTabs}>
                <TouchableOpacity
                  style={[
                    s.openCloseTab,
                    openCloseTab === 'open' && s.openCloseTabActiveOpen,
                  ]}
                  onPress={() => { setOpenCloseTab('open'); setReduceOnly(false); }}
                  activeOpacity={0.88}
                >
                  <Text
                    style={[
                      s.openCloseTabTxt,
                      openCloseTab === 'open' && s.openCloseTabTxtActive,
                      openCloseTab === 'open' && { color: Colors.buyGreen },
                    ]}
                  >
                    Open
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    s.openCloseTab,
                    openCloseTab === 'close' && s.openCloseTabActiveClose,
                  ]}
                  onPress={() => { setOpenCloseTab('close'); setReduceOnly(true); }}
                  activeOpacity={0.88}
                >
                  <Text
                    style={[
                      s.openCloseTabTxt,
                      openCloseTab === 'close' && s.openCloseTabTxtActive,
                    ]}
                  >
                    Close
                  </Text>
                </TouchableOpacity>
              </View>

              {/* Avbl balance row */}
              <View style={s.avblRow}>
                <Text style={s.avblLbl}>Avbl</Text>
                <Text style={s.avblVal}>
                  {wallet != null ? `${fmtN(availMargin, 2)} USDT` : '… USDT'}
                </Text>
                <TouchableOpacity style={s.avblTransferBtn} onPress={() => setShowTransfer(true)} hitSlop={8}>
                  <Icon name="swap-horizontal" size={14} color={Colors.goldLight} />
                </TouchableOpacity>
              </View>

              <TouchableOpacity
                style={s.typeDropdown}
                onPress={() => setShowOrderTypePicker(true)}
                activeOpacity={0.8}
              >
                <View style={s.typeDropdownIcon}>
                  <FuturesOrderTypeIcon type={orderType} active size={22} />
                </View>
                <Text style={s.typeDropdownTxt}>{FUTURES_ORDER_TYPE_LABEL[orderType]}</Text>
                <Icon name="chevron-down" size={16} color={Colors.textMuted} />
              </TouchableOpacity>
              </View>

              <View style={s.formBody}>
              <View style={s.formSectionMid}>
                {/* Price input */}
                {orderType === 'market' || orderType === 'stop_market' || orderType === 'take_profit' ? (
                  <View style={s.fieldWrap}>
                    {!TERMINAL_COMPACT ? (
                      <Text style={[s.fieldLabel, s.fieldLabelGap]}>Price</Text>
                    ) : null}
                    <View style={[s.fieldBox, s.fieldBoxReadOnly]}>
                      <Text style={[s.fieldInput, { color: Colors.textMuted }]}>
                        {orderType === 'market' ? 'Market price' : (
                          (side === 'buy' ? quotes.dispAsk : quotes.dispBid) > 0
                            ? formatPrice(side === 'buy' ? quotes.dispAsk : quotes.dispBid)
                            : quotes.dispMark > 0
                              ? formatPrice(quotes.dispMark)
                              : '—'
                        )}
                      </Text>
                    </View>
                  </View>
                ) : (
                  <View style={s.fieldWrap}>
                    <View style={s.fieldLabelRow}>
                      <Text style={s.fieldLabel}>Price (USDT)</Text>
                      <TouchableOpacity onPress={snapLatest}>
                        <Text style={s.latestBtn}>↻ Latest</Text>
                      </TouchableOpacity>
                    </View>
                    <View style={s.fieldBox}>
                      <TerminalNumericInput
                        style={s.fieldInput}
                        keyboardType="numeric"
                        value={price}
                        onChangeText={v => { priceSyncKey.current = ''; setPrice(v); }}
                        placeholder={quotes.dispMark > 0 ? formatPrice(quotes.dispMark) : '0.00'}
                        placeholderTextColor={Colors.textDisabled}
                        selectionColor={Colors.gold}
                      />
                      <Text style={s.fieldUnit}>USDT</Text>
                    </View>
                  </View>
                )}

                {/* Stop trigger (conditional stops) */}
                {showStopTrigger && (
                  <View style={s.fieldWrap}>
                    <Text style={[s.fieldLabel, s.fieldLabelGap]}>
                      {orderType === 'take_profit' ? 'Trigger price (USDT)' : 'Stop trigger (USDT)'}
                    </Text>
                    <View style={s.fieldBox}>
                      <TerminalNumericInput
                        style={s.fieldInput}
                        keyboardType="numeric"
                        value={stopPrice}
                        onChangeText={setStopPrice}
                        placeholder="When mark crosses this price…"
                        placeholderTextColor={Colors.textDisabled}
                        selectionColor={Colors.gold}
                      />
                      <Text style={s.fieldUnit}>USDT</Text>
                    </View>
                  </View>
                )}

                {/* Size: % row + unit settings + slider (Binance-style terminal) */}
                <View style={s.qtySliderGroup}>
                {TERMINAL_COMPACT ? (
                  <FuturesTerminalSizingBlock
                    side={sliderSide}
                    sliderResetKey={sliderResetKey}
                    unitLabel={openCloseTab === 'close' ? baseAsset : sizingUnitLabel}
                    sizingHint={sizingHint}
                    primaryValue={primarySizeValue}
                    onPrimaryChange={handlePrimarySizeChange}
                    sliderPct={sliderSyncPct}
                    onPctLive={onPctLive}
                    onOpenSettings={() => setShowOrderSettings(true)}
                    settingsEnabled={openCloseTab === 'open'}
                    onStepQty={stepQty}
                    onLockParentScroll={setSliderScrollLocked}
                  />
                ) : (
                  <>
                    <View style={s.fieldWrap}>
                      <Text style={[s.fieldLabel, s.fieldLabelGap]}>Amount</Text>
                      <View style={s.fieldBox}>
                        <TouchableOpacity style={s.qtyStepBtn} onPress={() => stepQty(-1)} hitSlop={6}>
                          <Text style={s.qtyStepTxt}>−</Text>
                        </TouchableOpacity>
                        <TextInput
                          style={[s.fieldInput, s.fieldInputCenter]}
                          keyboardType="numeric"
                          value={qty}
                          onChangeText={handleQtyChange}
                          placeholder="0"
                          placeholderTextColor={Colors.textDisabled}
                          selectionColor={Colors.gold}
                        />
                        <TouchableOpacity style={s.qtyStepBtn} onPress={() => stepQty(1)} hitSlop={6}>
                          <Text style={s.qtyStepTxt}>+</Text>
                        </TouchableOpacity>
                        <Text style={s.fieldUnit}>{baseAsset}</Text>
                      </View>
                    </View>
                    <View style={[s.pctRow, s.pctRowCompact]}>
                      {[10, 25, 50, 75, 100].map(p => (
                        <TouchableOpacity key={p} style={[s.pctBtn, s.pctBtnCompact]} onPress={() => onPctLive(p)}>
                          <Text style={s.pctTxt}>{p}%</Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </>
                )}
                </View>

                {/* Order value — limit / stop-limit only (full form only) */}
                {!TERMINAL_COMPACT && (orderType === 'limit' || orderType === 'stop_limit') && (
                  <View style={s.fieldWrap}>
                    <Text style={[s.fieldLabel, s.fieldLabelGap]}>Order Value</Text>
                    <View style={s.fieldBox}>
                      <TextInput
                        style={s.fieldInput}
                        keyboardType="numeric"
                        value={total}
                        onChangeText={handleTotalChange}
                        placeholder="0.00"
                        placeholderTextColor={Colors.textDisabled}
                        selectionColor={Colors.gold}
                      />
                      <Text style={s.fieldUnit}>USDT</Text>
                    </View>
                    <Text style={s.fieldHint}>= quantity × price</Text>
                  </View>
                )}

                {/* Margin — full form only; terminal uses % row + Avbl/Max/Cost */}
                {!TERMINAL_COMPACT && (
                  <View style={s.fieldWrap}>
                    <Text style={[s.fieldLabel, s.fieldLabelGap]}>Margin ({leverage}× leverage)</Text>
                    <View style={[s.fieldBox, insufficient && s.fieldBoxErr]}>
                      <TextInput
                        style={s.fieldInput}
                        keyboardType="numeric"
                        value={margin}
                        onChangeText={handleMarginChange}
                        placeholder="0.00"
                        placeholderTextColor={Colors.textDisabled}
                        selectionColor={Colors.gold}
                      />
                      <Text style={s.fieldUnit}>USDT</Text>
                    </View>
                    {insufficient && (
                      <Text style={s.fieldErrTxt}>
                        Exceeds available ({fmtN(availMargin, 2)} USDT)
                      </Text>
                    )}
                    <Text style={s.fieldHint}>
                      Free margin: {fmtN(availMargin, 2)} USDT · Min notional: {minNotional.toFixed(2)} USDT
                    </Text>
                  </View>
                )}

                {!TERMINAL_COMPACT && (
                  <View style={s.terminalMeta}>
                    <View style={s.terminalMetaRow}>
                      <Text style={s.terminalMetaLbl}>Avbl</Text>
                      <Text style={s.terminalMetaVal}>{fmtN(availMargin, 2)} USDT</Text>
                    </View>
                    <View style={s.terminalMetaRow}>
                      <Text style={s.terminalMetaLbl}>Max</Text>
                      <Text style={s.terminalMetaVal}>
                        {sizingPx > 0 && leverage > 0
                          ? `${((availMargin * leverage) / sizingPx).toFixed(4)} ${spotSym}`
                          : `0.000 ${spotSym}`}
                      </Text>
                    </View>
                    <View style={s.terminalMetaRow}>
                      <Text style={s.terminalMetaLbl}>Cost</Text>
                      <Text style={[s.terminalMetaVal, insufficient && { color: Colors.sellRed }]}>
                        {initMargin > 0 ? `${initMargin.toFixed(2)} USDT` : '0.00 USDT'}
                      </Text>
                    </View>
                  </View>
                )}

                {TERMINAL_COMPACT
                  && (orderType === 'limit' || orderType === 'market')
                  && openCloseTab === 'open'
                  && !reduceOnly ? (
                  <View style={s.formOptionsRow}>
                    <FuturesInlineOrderOptions
                      tpSl={inlineTpSl}
                      onTpSlChange={handleTpSlToggle}
                    />
                  </View>
                ) : null}

                {TERMINAL_COMPACT && inlineTpSl ? (
                  <View style={s.formDynamicBlock}>
                    <FuturesInlineTpSlFields
                      tpPrice={tpPrice}
                      onTpPriceChange={setTpPrice}
                      slPrice={slPrice}
                      onSlPriceChange={setSlPrice}
                      tpMode={tpTriggerMode}
                      slMode={slTriggerMode}
                      onTpModeChange={setTpTriggerMode}
                      onSlModeChange={setSlTriggerMode}
                    />
                  </View>
                ) : null}

                {TERMINAL_COMPACT && openCloseTab === 'open' ? (
                  <View style={s.compactOrderOpts}>
                    <TouchableOpacity
                      style={s.reduceOnlyBtn}
                      onPress={() => setReduceOnly(v => !v)}
                      activeOpacity={0.85}
                    >
                      <View style={[s.checkbox, reduceOnly && s.checkboxActive]}>
                        {reduceOnly ? <Icon name="check" size={10} color={FuturesUi.long} /> : null}
                      </View>
                      <Text style={s.reduceOnlyTxt}>Reduce Only</Text>
                    </TouchableOpacity>
                    <View style={s.tifBtns}>
                      {(['GTC', 'IOC', 'FOK'] as TIF[]).map(t => (
                        <TouchableOpacity
                          key={t}
                          style={[s.tifBtn, tif === t && s.tifBtnActive]}
                          onPress={() => setTif(t)}
                          activeOpacity={0.85}
                        >
                          <Text style={[s.tifBtnTxt, tif === t && s.tifBtnTxtActive]}>{t}</Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </View>
                ) : null}

                {/* TIF + Reduce-only */}
                {!TERMINAL_COMPACT && (
                <View style={s.tifRow}>
                  <TouchableOpacity
                    style={s.reduceOnlyBtn}
                    onPress={() => setReduceOnly(v => !v)}
                  >
                    <View style={[s.checkbox, reduceOnly && s.checkboxActive]}>
                      {reduceOnly && <Icon name="check" size={10} color={Colors.buyGreen} />}
                    </View>
                    <Text style={s.reduceOnlyTxt}>Reduce Only</Text>
                  </TouchableOpacity>
                  <View style={s.tifBtns}>
                    {(['GTC', 'IOC', 'FOK'] as TIF[]).map(t => (
                      <TouchableOpacity key={t} style={[s.tifBtn, tif === t && s.tifBtnActive]} onPress={() => setTif(t)}>
                        <Text style={[s.tifBtnTxt, tif === t && s.tifBtnTxtActive]}>{t}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>
                )}

                {insufficientIboFee ? (
                  <Text style={s.fieldErrTxt}>
                    Insufficient IBO for fee — need ~{formatIboFee(estFeeIbo)} (have {formatIboFee(availIbo)}).
                  </Text>
                ) : null}

                {TERMINAL_COMPACT && qtyNum > 0 && refPx > 0 ? (
                  <View style={s.summaryBoxCompact}>
                    <View style={s.summaryRow}>
                      <Text style={s.summaryLabel}>Notional</Text>
                      <Text style={s.summaryVal}>{fmtN(notional, 2)} USDT</Text>
                    </View>
                    <View style={s.summaryRow}>
                      <Text style={s.summaryLabel}>Margin</Text>
                      <Text style={[s.summaryVal, insufficient && { color: Colors.sellRed }]}>
                        {fmtN(initMargin, 4)} USDT
                      </Text>
                    </View>
                    <View style={s.summaryRow}>
                      <Text style={s.summaryLabel}>Est. fee</Text>
                      <Text style={s.summaryVal}>
                        {formatIboFee(estFeeIbo)}
                        {limitRole ? ` · ${limitRole}` : ''}
                      </Text>
                    </View>
                    {liqEstLong != null || liqEstShort != null ? (
                      <View style={s.summaryRow}>
                        <Text style={s.summaryLabel}>Liq. est.</Text>
                        <Text style={s.summaryVal} numberOfLines={1}>
                          {liqEstLong != null ? `L ${formatPrice(liqEstLong)}` : '—'}
                          {' · '}
                          {liqEstShort != null ? `S ${formatPrice(liqEstShort)}` : '—'}
                        </Text>
                      </View>
                    ) : null}
                    {marketFill ? (
                      <View style={s.summaryRow}>
                        <Text style={s.summaryLabel}>Mkt fill</Text>
                        <Text style={s.summaryVal}>
                          ~{formatPrice(marketFill.avg)}
                          {marketFill.slippage_pct > 0.01
                            ? ` (${marketFill.slippage_pct.toFixed(3)}% slip)`
                            : ''}
                          {marketFill.exhausted ? ' · book thin' : ''}
                        </Text>
                      </View>
                    ) : null}
                  </View>
                ) : null}

                {tradeErr ? (
                  <View style={s.tradeAlert}>
                    <Icon name="alert-circle-outline" size={12} color={Colors.sellRed} />
                    <Text style={s.tradeAlertTxt}>{tradeErr}</Text>
                  </View>
                ) : null}
                {tradeOk ? (
                  <View style={[s.tradeAlert, s.tradeAlertOk]}>
                    <Icon name="check-circle-outline" size={12} color={FuturesUi.long} />
                    <Text style={[s.tradeAlertTxt, s.tradeAlertTxtOk]}>{tradeOk}</Text>
                  </View>
                ) : null}
                {belowMinNotional && qtyNum > 0 ? (
                  <Text style={s.fieldErrTxt}>
                    Notional is below the {minNotional.toFixed(2)} USDT minimum for this contract.
                  </Text>
                ) : null}

              </View>
              </View>

              <View style={s.formFooterCol}>
                {TERMINAL_COMPACT ? (
                  <FuturesStackedSubmit
                    size="large"
                    placingLong={placingSide === (openCloseTab === 'close' ? 'sell' : 'buy')}
                    placingShort={placingSide === (openCloseTab === 'close' ? 'buy' : 'sell')}
                    disabled={tradeSubmitDisabled}
                    kycGate={kycFuturesBlocked ? {
                      buttonLabel: kycTradeSubmitLabel(kycStatus, 'Trade'),
                      message: isKycPendingReview(kycStatus)
                        ? 'Trading unlocks once KYC is approved'
                        : 'Complete KYC to unlock trading',
                      onPress: goToKyc,
                    } : null}
                    long={{
                      maxLabel: openCloseTab === 'open' ? 'Max Long' : 'Max Close',
                      maxValue: maxLongQty > 0 ? `${maxLongQty.toFixed(4)} ${baseAsset}` : `-- ${baseAsset}`,
                      marginLabel: 'Margin',
                      marginValue: initMargin > 0 ? `${initMargin.toFixed(4)} USDT` : '0.0000 USDT',
                      buttonLabel: kycTradeSubmitLabel(kycStatus,
                        openCloseTab === 'open' ? 'Open Long' : 'Close Long'),
                      onPress: closeLongDisabled
                        ? undefined
                        : (kycFuturesBlocked ? goToKyc : () => handlePlaceOrder(openCloseTab === 'close' ? 'sell' : 'buy')),
                      variant: 'long',
                      disabled: closeLongDisabled,
                    }}
                    short={{
                      maxLabel: openCloseTab === 'open' ? 'Max Short' : 'Max Close',
                      maxValue: maxShortQty > 0 ? `${maxShortQty.toFixed(4)} ${baseAsset}` : `-- ${baseAsset}`,
                      marginLabel: 'Margin',
                      marginValue: initMargin > 0 ? `${initMargin.toFixed(4)} USDT` : '0.0000 USDT',
                      buttonLabel: kycTradeSubmitLabel(kycStatus,
                        openCloseTab === 'open' ? 'Open Short' : 'Close Short'),
                      onPress: closeShortDisabled
                        ? undefined
                        : (kycFuturesBlocked ? goToKyc : () => handlePlaceOrder(openCloseTab === 'close' ? 'buy' : 'sell')),
                      variant: 'short',
                      disabled: closeShortDisabled,
                    }}
                  />
                ) : kycFuturesBlocked ? (
                  <TouchableOpacity
                    style={s.kycCtaBtnFull}
                    onPress={goToKyc}
                    activeOpacity={0.85}
                  >
                    <Text style={s.ctaBtnTxt} numberOfLines={1}>
                      {kycTradeSubmitLabel(kycStatus, 'Trade')}
                    </Text>
                  </TouchableOpacity>
                ) : (
                  <View style={s.dualCtaRow}>
                    <TouchableOpacity
                      style={[
                        s.ctaBtnLong,
                        s.ctaBtnHalf,
                        (placingSide !== null || tradeSubmitDisabled) && s.ctaBtnDisabled,
                      ]}
                      onPressIn={() => setSide('buy')}
                      onPress={() => handlePlaceOrder('buy')}
                      disabled={placingSide !== null}
                      activeOpacity={0.85}
                    >
                      <Text style={s.ctaBtnTxt} numberOfLines={1}>
                        {placingSide === 'buy'
                          ? 'Placing…'
                          : (openCloseTab === 'open' ? 'Open Long' : 'Close Long')}
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[
                        s.ctaBtnShort,
                        s.ctaBtnHalf,
                        (placingSide !== null || tradeSubmitDisabled) && s.ctaBtnDisabled,
                      ]}
                      onPressIn={() => setSide('sell')}
                      onPress={() => handlePlaceOrder('sell')}
                      disabled={placingSide !== null}
                      activeOpacity={0.85}
                    >
                      <Text style={s.ctaBtnTxt} numberOfLines={1}>
                        {placingSide === 'sell'
                          ? 'Placing…'
                          : (openCloseTab === 'open' ? 'Open Short' : 'Close Short')}
                      </Text>
                    </TouchableOpacity>
                  </View>
                )}
              </View>
            </View>
          </View>
        </View>

        <View style={s.dataPanel}>
          <View style={s.dataTabBar}>
            {([
              { key: 'positions' as FuturesDataTab, label: 'Positions', count: filteredPositions.length },
              { key: 'orders' as FuturesDataTab, label: 'Open Orders', count: filteredOpenOrders.length },
              { key: 'history' as FuturesDataTab, label: 'History', count: history.length + closedPositions.length },
            ]).map(({ key, label, count }) => (
              <TouchableOpacity
                key={key}
                style={[s.dataTabBtn, dataTab === key && s.dataTabBtnActive]}
                onPress={() => setDataTab(key)}
                activeOpacity={0.8}
              >
                <Text style={[s.dataTabTxt, dataTab === key && s.dataTabTxtActive]}>
                  {label}({count})
                </Text>
              </TouchableOpacity>
            ))}
            <TouchableOpacity
              style={s.historyIconBtn}
              onPress={() => (navigation as any).push?.('FuturesHistory', { symbol })}
              hitSlop={8}
              activeOpacity={0.7}
            >
              <Icon name="history" size={16} color={Colors.textMuted} />
            </TouchableOpacity>
          </View>

          <TouchableOpacity
            style={s.hideOtherPairsRow}
            activeOpacity={0.8}
            onPress={() => setHideOtherPairs(v => !v)}
          >
            <View style={[s.hideOtherPairsBox, hideOtherPairs && s.hideOtherPairsBoxOn]}>
              {hideOtherPairs ? <Icon name="check" size={9} color={FuturesUi.long} /> : null}
            </View>
            <Text style={s.hideOtherPairsTxt}>Hide other pairs</Text>
          </TouchableOpacity>

          <View style={s.dataPanelScrollContent}>
          {dataTab === 'positions' && (
            !user ? (
              <GuestPromo
                onLogin={() => (navigation as any).navigate('Auth', { screen: 'Login' })}
              />
            ) : filteredPositions.length === 0 ? (
              <EmptyState label="You have no positions" />
            ) : (
              filteredPositions.map((pos) => {
                const posSym = pos.symbol;
                const samePair = positionMatchesSymbol(posSym, symbol);
                const mark  = parseN(
                  (pos as any).mark_price
                  ?? markBySymbol[posSym]
                  ?? (samePair ? markPrice : 0),
                );
                const pnl   = parseN((pos as any).unrealized_pnl ?? 0);
                const liq   = parseN((pos as any).liq_price ?? (pos as any).liquidation_price ?? 0);
                const marg  = parseN((pos as any).isolated_margin ?? (pos as any).margin ?? 0);
                const lev   = parseN((pos as any).leverage ?? settings.leverage);
                const qtyP  = parseN((pos as any).qty ?? (pos as any).size ?? 0);
                const isLong= (pos.side === 'long' || (pos as any).side === 'buy');
                return (
                  <View key={(pos as any).id ?? (pos as any).position_id} style={s.posCard}>
                    <View style={s.posTop}>
                      <Text style={s.posSymbol}>{pos.symbol}</Text>
                      <View style={[s.sidePill, { backgroundColor: isLong ? FuturesUi.longDim : Colors.sellRedDim }]}>
                        <Text style={[s.sidePillTxt, { color: isLong ? FuturesUi.long : Colors.sellRed }]}>
                          {isLong ? 'LONG' : 'SHORT'}
                        </Text>
                      </View>
                      <Text style={[s.posPnl, { color: pnl >= 0 ? FuturesUi.long : Colors.sellRed }]}>
                        {pnl >= 0 ? '+' : ''}{pnl.toFixed(2)} USDT
                      </Text>
                    </View>
                    <View style={s.posMeta}>
                      <PosMetaItem label="Size"   value={Math.abs(qtyP).toFixed(4)} />
                      <PosMetaItem label="Entry"  value={formatPrice((pos as any).entry_price ?? 0)} />
                      <PosMetaItem label="Mark"   value={formatPrice(mark)} />
                      <PosMetaItem label="Margin" value={marg.toFixed(2)} />
                      <PosMetaItem label="Liq."   value={liq > 0 ? formatPrice(liq) : '—'} danger />
                      <PosMetaItem label="Lev."   value={`${lev}×`} />
                    </View>
                    <View style={s.posActions}>
                      <Text style={s.posModeTxt}>
                        {(pos as any).margin_mode ?? settings.margin_mode} margin
                      </Text>
                      <TouchableOpacity style={s.close50Btn} onPress={() => handleClosePos(pos, 0.5)}>
                        <Text style={s.close50Txt}>Close 50%</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={s.closeAllBtn} onPress={() => handleClosePos(pos)}>
                        <Text style={s.closeAllTxt}>Close All</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                );
              })
            )
          )}

          {dataTab === 'orders' && (
            !user ? (
              <GuestPromo
                onLogin={() => (navigation as any).navigate('Auth', { screen: 'Login' })}
              />
            ) : filteredOpenOrders.length === 0 ? (
              <EmptyState label="No open orders" />
            ) : (
              filteredOpenOrders.map((order) => {
                const isLong = (order.side === 'long' || (order as any).side === 'buy');
                return (
                  <View key={order.order_id ?? (order as any).id} style={s.orderCard}>
                    <View style={s.orderTop}>
                      <Text style={s.orderSymbol}>{order.symbol}</Text>
                      <View style={[s.sidePill, { backgroundColor: isLong ? FuturesUi.longDim : Colors.sellRedDim }]}>
                        <Text style={[s.sidePillTxt, { color: isLong ? FuturesUi.long : Colors.sellRed }]}>
                          {isLong ? 'LONG' : 'SHORT'}
                        </Text>
                      </View>
                      <Text style={s.orderType}>{safeUpper(order.type)}</Text>
                    </View>
                    <View style={s.posMeta}>
                      <PosMetaItem label="Price"  value={order.price ? formatPrice(order.price) : 'Market'} />
                      <PosMetaItem label="Size"   value={parseN((order as any).quantity ?? (order as any).size ?? 0).toFixed(4)} />
                      <PosMetaItem label="Filled" value={parseN((order as any).filled ?? (order as any).filled_size ?? 0).toFixed(4)} />
                      <PosMetaItem label="Lev."   value={`${parseN(order.leverage)}×`} />
                    </View>
                    <View style={s.orderBottom}>
                      <Text style={s.orderDate}>{formatDateTime(order.created_at)}</Text>
                      <TouchableOpacity
                        style={s.cancelBtn}
                        onPress={() => {
                          const orderId = order.order_id ?? (order as any).id;
                          Alert.alert('Cancel Order', 'Cancel this open order?', [
                            { text: 'No', style: 'cancel' },
                            {
                              text: 'Yes',
                              style: 'destructive',
                              onPress: async () => {
                                try {
                                  await futuresApi.cancelOrder(orderId);
                                  load();
                                } catch (err) {
                                  Alert.alert('Error', parseApiError(err).message);
                                }
                              },
                            },
                          ]);
                        }}
                      >
                        <Text style={s.cancelTxt}>Cancel</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                );
              })
            )
          )}

          {dataTab === 'history' && (
            <>
              {history.length === 0 && closedPositions.length === 0 && myTrades.length === 0 ? (
                <EmptyState label="No order history" />
              ) : (
                <>
                  {history.map((order) => {
                  const isLong = (order.side === 'long' || (order as any).side === 'buy');
                  return (
                    <View key={order.order_id ?? (order as any).id} style={s.orderCard}>
                      <View style={s.orderTop}>
                        <Text style={s.orderSymbol}>{order.symbol}</Text>
                        <View style={[s.sidePill, { backgroundColor: isLong ? FuturesUi.longDim : Colors.sellRedDim }]}>
                          <Text style={[s.sidePillTxt, { color: isLong ? FuturesUi.long : Colors.sellRed }]}>
                            {isLong ? 'LONG' : 'SHORT'}
                          </Text>
                        </View>
                        <Text style={[s.orderType, { color: order.status === 'filled' ? FuturesUi.long : Colors.textMuted }]}>
                          {order.status?.toUpperCase()}
                        </Text>
                      </View>
                      <View style={s.posMeta}>
                        <PosMetaItem label="Price"    value={order.price ? formatPrice(order.price) : 'Market'} />
                        <PosMetaItem label="Filled"   value={`${parseN((order as any).filled ?? (order as any).filled_size ?? 0).toFixed(4)} / ${parseN((order as any).quantity ?? (order as any).size ?? 0).toFixed(4)}`} />
                        <PosMetaItem label="Type"     value={safeUpper(order.type)} />
                        <PosMetaItem label="Lev."     value={`${parseN(order.leverage)}×`} />
                      </View>
                      <Text style={s.orderDate}>{formatDateTime(order.created_at)}</Text>
                    </View>
                  );
                })}

              {closedPositions.length > 0 && (
                <>
                  <Text style={[s.sectionBlockTitle, { marginTop: Spacing[4] }]}>Closed positions</Text>
                  {closedPositions.map((pos: any, i: number) => {
                    const pnl = parseN(pos.realized_pnl ?? pos.pnl ?? 0);
                    const long = pos.side === 'long' || pos.side === 'buy';
                    const qtyC = parseN(pos.qty ?? pos.size ?? 0);
                    return (
                      <View key={String(pos.position_id ?? pos.id ?? i)} style={s.orderCard}>
                        <View style={s.orderTop}>
                          <Text style={s.orderSymbol}>{pos.symbol}</Text>
                          <View style={[s.sidePill, { backgroundColor: long ? FuturesUi.longDim : Colors.sellRedDim }]}>
                            <Text style={[s.sidePillTxt, { color: long ? FuturesUi.long : Colors.sellRed }]}>
                              {long ? 'LONG' : 'SHORT'}
                            </Text>
                          </View>
                          <Text style={[s.orderType, { color: pnl >= 0 ? FuturesUi.long : Colors.sellRed }]}>
                            {pnl >= 0 ? '+' : ''}{pnl.toFixed(2)} USDT
                          </Text>
                        </View>
                        <View style={s.posMeta}>
                          <PosMetaItem label="Size" value={Math.abs(qtyC).toFixed(4)} />
                          <PosMetaItem label="Entry" value={formatPrice(pos.entry_price ?? 0)} />
                          <PosMetaItem label="Closed" value={pos.closed_at ? formatDateTime(pos.closed_at) : '—'} />
                          <PosMetaItem label="Lev." value={`${parseN(pos.leverage)}×`} />
                        </View>
                      </View>
                    );
                  })}
                </>
              )}

              {myTrades.length > 0 && (
                <>
                  <Text style={[s.sectionBlockTitle, { marginTop: Spacing[4] }]}>My fills</Text>
                  <View style={s.tradesHeader}>
                    <Text style={[s.tradeHead, { flex: 0.75 }]}>Side</Text>
                    <Text style={[s.tradeHead, { flex: 1 }]}>Price</Text>
                    <Text style={[s.tradeHead, { flex: 0.85, textAlign: 'right' }]}>Qty</Text>
                    <Text style={[s.tradeHead, { flex: 1.15, textAlign: 'right' }]}>Time</Text>
                  </View>
                  {myTrades.slice(0, 30).map((t: any, i: number) => {
                    const buy = t.side === 'buy' || t.side === 'long';
                    return (
                      <View key={String(t.id ?? t.trade_id ?? i)} style={s.tradeRow}>
                        <Text style={[s.tradeSideLbl, { flex: 0.75, color: buy ? FuturesUi.long : Colors.sellRed }]}>
                          {buy ? 'Buy' : 'Sell'}
                        </Text>
                        <Text style={[s.tradePrice, { flex: 1 }]}>{formatPrice(t.price ?? 0)}</Text>
                        <Text style={[s.tradeSize, { flex: 0.85, textAlign: 'right' }]}>
                          {fmtN(t.qty ?? t.quantity ?? 0, 4)}
                        </Text>
                        <Text style={[s.tradeTime, { flex: 1.15, textAlign: 'right' }]}>
                          {t.created_at ? formatDateTime(t.created_at) : '—'}
                        </Text>
                      </View>
                    );
                  })}
                </>
              )}

                </>
              )}

              <TouchableOpacity
                style={[s.syncMarginBtn, { marginTop: Spacing[3] }, syncingMargin && s.submitDisabled]}
                onPress={handleSyncLockedMargin}
                disabled={syncingMargin}
              >
                <Text style={s.syncMarginTxt}>{syncingMargin ? 'Syncing…' : 'Reconcile locked margin'}</Text>
              </TouchableOpacity>
            </>
          )}
          </View>
        </View>
        </TradeTerminalScrollLayout>
      </View>

      
      <MarginModePickerModal
        visible={showMarginModePicker}
        currentMode={settings.margin_mode}
        symbol={symbol}
        onClose={() => setShowMarginModePicker(false)}
        onApplied={handleMarginModeApplied}
      />

      <OrderTypePickerModal
        visible={showOrderTypePicker}
        value={orderType}
        onClose={() => setShowOrderTypePicker(false)}
        onSelect={handleOrderTypeChange}
      />

      <FuturesOrderSettingsModal
        visible={showOrderSettings}
        baseAsset={baseAsset}
        mode={sizingMode}
        amountUnit={amountUnit}
        onClose={() => setShowOrderSettings(false)}
        onConfirm={handleOrderSettingsConfirm}
      />

      {/* ── Transfer Modal ── */}
      <Modal visible={showTransfer} animationType="slide" transparent>
        <View style={s.overlay}>
          <AdaptiveKeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <View style={s.modalCard}>
              <Text style={s.modalTitle}>Transfer Funds</Text>
              <View style={s.dirRow}>
                {(['spot_to_futures', 'futures_to_spot'] as const).map(dir => (
                  <TouchableOpacity key={dir} style={[s.dirBtn, transferDir === dir && s.dirBtnActive]} onPress={() => setTransferDir(dir)}>
                    <Text style={[s.dirBtnTxt, transferDir === dir && s.dirBtnTxtActive]}>
                      {dir === 'spot_to_futures' ? 'Spot → Futures' : 'Futures → Spot'}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
              <Text style={s.modalSub}>
                {transferDir === 'spot_to_futures'
                  ? `Spot USDT: ${formatUSD(spotUsdtBalance)} available`
                  : `Futures wallet: ${formatUSD(availMargin)} available`}
              </Text>
              <View style={s.transferAmountRow}>
                <TextInput
                  style={[s.modalInput, s.transferInputFlex]} value={transferAmount} onChangeText={setTransferAmount}
                  keyboardType="numeric" placeholder="Amount (USDT)"
                  placeholderTextColor={Colors.textDisabled}
                />
                <TouchableOpacity
                  style={s.maxBtn}
                  onPress={() => {
                    const max = transferDir === 'spot_to_futures' ? spotUsdtBalance : availMargin;
                    setTransferAmount(max > 0 ? trimN(max, 2) : '');
                  }}
                >
                  <Text style={s.maxBtnTxt}>Max</Text>
                </TouchableOpacity>
              </View>
              <View style={s.modalBtns}>
                <Button title="Cancel" variant="ghost" onPress={() => { setShowTransfer(false); setTransferAmount(''); }} />
                <Button
                  title="Transfer"
                  onPress={handleTransfer}
                  loading={transferLoading}
                  disabled={
                    transferLoading
                    || !transferAmount
                    || parseFloat(transferAmount) <= 0
                    || parseFloat(transferAmount) > (
                      transferDir === 'spot_to_futures' ? spotUsdtBalance : availMargin
                    ) + 1e-9
                  }
                />
              </View>
            </View>
          </AdaptiveKeyboardAvoidingView>
        </View>
      </Modal>
    </SafeAreaWrapper>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────
function PosMetaItem({ label, value, danger }: { label: string; value: string; danger?: boolean }) {
  return (
    <View style={s.posMetaItem}>
      <Text style={s.posMetaLabel}>{label}</Text>
      <Text style={[s.posMetaVal, danger && { color: Colors.warning }]}>{value}</Text>
    </View>
  );
}
function EmptyState({ label }: { label: string }) {
  return (
    <View style={s.emptyWrap}>
      <Text style={s.emptyTxt}>{label}</Text>
    </View>
  );
}

function GuestPromo({ onLogin }: { onLogin: () => void }) {
  return (
    <LinearGradient
      colors={['#0e2a4a', '#0B1929', '#0d1a2e']}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={s.promoCardInline}
    >
      <Icon name="gift-outline" size={40} color={Colors.goldLight} style={s.promoIcon} />
      <Text style={s.promoTitle}>
        Sign up now for a chance to receive exclusive new user bonus rewards
      </Text>
      <TouchableOpacity style={s.promoBtn} onPress={onLogin} activeOpacity={0.85}>
        <Text style={s.promoBtnTxt}>Sign up / Log in</Text>
      </TouchableOpacity>
    </LinearGradient>
  );
}

// ── Styles ───────────────────────────────────────────────────────────────────
const SCREEN_H_PAD = Spacing[3];

const F = FuturesUi.form;

const s = StyleSheet.create({
  /** Safe-area shell matches header card color; body scroll uses Colors.surface below. */
  screen: { flex: 1, backgroundColor: Colors.surfaceCard },
  headerBleed: {
    backgroundColor: Colors.surfaceCard,
    zIndex: 10,
    elevation: 10,
  },
  chartSection: {
    backgroundColor: Colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: Colors.surfaceBorder,
    paddingTop: Spacing[1],
    paddingBottom: Spacing[1],
  },
  chartSectionCollapsed: {
    paddingTop: 0,
    paddingBottom: 0,
  },
  screenInset: {
    flex: 1,
    paddingHorizontal: SCREEN_H_PAD,
    overflow: 'hidden',
    zIndex: 0,
  },
  bodyScroll: { flex: 1, backgroundColor: Colors.surface },
  bodyScrollContent: { paddingBottom: Spacing[6] },
  row:    { flexDirection: 'row', alignItems: 'center' },

  fundingInfoBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing[1],
    paddingTop: 6,
    paddingBottom: 8,
    backgroundColor: Colors.surfaceCard,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.surfaceBorder,
    gap: 4,
  },
  fundingInfoLbl: {
    fontFamily: FontFamily.medium,
    fontSize: FontSize.xs,
    color: Colors.textSecondary,
  },
  fundingInfoRate: {
    fontFamily: FontFamily.monoMedium,
    fontSize: FontSize.xs,
  },
  fundingInfoCountdown: {
    fontFamily: FontFamily.mono,
    fontSize: FontSize.xs,
    color: Colors.textMuted,
  },

  /* Sentiment bar (B% / S%) */
  sentimentWrap: {
    flexDirection: 'row',
    marginHorizontal: Spacing[1],
    marginTop: 4,
    height: 14,
    borderRadius: 3,
    overflow: 'hidden',
    position: 'relative',
  },
  sentimentBar: {
    backgroundColor: FuturesUi.long,
    opacity: 0.7,
  },
  sentimentBarSell: {
    backgroundColor: Colors.sellRed,
    opacity: 0.7,
  },
  sentimentLabels: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 4,
  },
  sentimentBuy: {
    fontFamily: FontFamily.bold,
    fontSize: 9,
    color: Colors.white,
  },
  sentimentSell: {
    fontFamily: FontFamily.bold,
    fontSize: 9,
    color: Colors.white,
  },
  indexPriceRow: {
    fontFamily: FontFamily.mono,
    fontSize: 10,
    color: Colors.textMuted,
    textAlign: 'center',
    marginTop: 2,
    paddingBottom: 4,
  },

  /* Open / Close pill tabs */
  openCloseTabs: {
    flexDirection: 'row',
    marginTop: Spacing[1],
    marginBottom: Spacing[2],
    backgroundColor: Colors.surfaceCard,
    borderRadius: Radius.lg,
    padding: 4,
    gap: 4,
  },
  openCloseTab: {
    flex: 1,
    paddingVertical: F.tabPadV,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
  },
  openCloseTabActiveOpen: {
    backgroundColor: FuturesUi.longDimStrong,
  },
  openCloseTabActiveClose: {
    backgroundColor: Colors.sellRedDim,
  },
  openCloseTabTxt: {
    fontFamily: FontFamily.semiBold,
    fontSize: FontSize.sm,
    color: Colors.textMuted,
  },
  openCloseTabTxtActive: {
    color: Colors.textPrimary,
    fontFamily: FontFamily.bold,
  },

  /* Available balance row */
  avblRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing[1],
    paddingBottom: Spacing[2],
    gap: 6,
  },
  avblLbl: {
    fontFamily: FontFamily.regular,
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
  },
  avblVal: {
    flex: 1,
    fontFamily: FontFamily.monoMedium,
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    textAlign: 'right',
  },
  avblTransferBtn: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },

  /* Dual CTA: Open Long / Open Short */
  dualCtaWrap: {
    paddingHorizontal: Spacing[1],
    gap: Spacing[1],
    marginTop: Spacing[1],
    marginBottom: Spacing[1],
  },
  ctaBlock: {
    gap: 4,
  },
  ctaMeta: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 2,
  },
  ctaMetaLbl: {
    fontFamily: FontFamily.medium,
    fontSize: FontSize.xs,
    color: Colors.textSecondary,
  },
  ctaMetaVal: {
    fontFamily: FontFamily.regular,
    fontSize: FontSize.xs,
    color: Colors.textMuted,
  },
  ctaBtnLong: {
    backgroundColor: FuturesUi.long,
    borderRadius: Radius.md,
    paddingVertical: 8,
    alignItems: 'center',
  },
  ctaBtnShort: {
    backgroundColor: Colors.sellRed,
    borderRadius: Radius.md,
    paddingVertical: 8,
    alignItems: 'center',
  },
  ctaBtnDisabled: {
    opacity: 0.5,
  },
  ctaBtnTxt: {
    fontFamily: FontFamily.bold,
    fontSize: FontSize.sm,
    color: Colors.white,
    letterSpacing: 0.3,
  },

  hideOtherPairsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing[1],
    paddingBottom: Spacing[2],
    gap: 6,
  },
  hideOtherPairsBox: {
    width: 14,
    height: 14,
    borderRadius: 3,
    borderWidth: 1.5,
    borderColor: Colors.textSecondary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  hideOtherPairsBoxOn: {
    borderColor: FuturesUi.long,
    backgroundColor: FuturesUi.longDim,
  },
  hideOtherPairsTxt: {
    fontFamily: FontFamily.regular,
    fontSize: FontSize.xs,
    color: Colors.textSecondary,
  },

  /* Not-logged-in promo */
  promoCard: {
    marginHorizontal: Spacing[4],
    marginTop: Spacing[3],
    borderRadius: 16,
    overflow: 'hidden',
    paddingHorizontal: Spacing[5],
    paddingVertical: Spacing[5],
    alignItems: 'center',
    borderWidth: 1,
    borderColor: Colors.goldAlpha15,
  },
  promoCardInline: {
    marginTop: Spacing[2],
    borderRadius: 16,
    overflow: 'hidden',
    paddingHorizontal: Spacing[4],
    paddingVertical: Spacing[5],
    alignItems: 'center',
    borderWidth: 1,
    borderColor: Colors.goldAlpha15,
  },
  promoIcon: { marginBottom: Spacing[3] },
  promoTitle: {
    fontFamily: FontFamily.medium,
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: Spacing[4],
  },
  promoBtn: {
    backgroundColor: FuturesUi.long,
    paddingHorizontal: Spacing[6],
    paddingVertical: Spacing[3],
    borderRadius: Radius.full,
  },
  promoBtnTxt: {
    fontFamily: FontFamily.bold,
    fontSize: FontSize.sm,
    color: Colors.white,
    letterSpacing: 0.3,
  },

  /* Toolbar dropdown chips */
  toolChipDropdown: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing[2],
    paddingVertical: 7,
    backgroundColor: Colors.surfaceHover,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
  },
  terminalBlock: {
    flexShrink: 0,
    borderBottomWidth: 1,
    borderBottomColor: Colors.surfaceBorder,
    paddingTop: Spacing[1],
  },
  terminalRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    width: '100%',
  },
  bookPane: {
    flex: FuturesUi.bookFlex,
    minWidth: 0,
  },
  formPane: {
    flex: FuturesUi.formFlex,
    minWidth: 0,
    flexDirection: 'column',
    paddingHorizontal: Spacing[1],
    paddingBottom: Spacing[1],
  },
  formSectionTop: {
    flexShrink: 0,
    width: '100%',
    marginBottom: Spacing[1],
  },
  formBody: {
    flexShrink: 0,
    width: '100%',
  },
  formSectionMid: {
    flexShrink: 0,
    width: '100%',
    flexDirection: 'column',
    gap: F.sectionGap,
  },
  formOptionsRow: {
    flexShrink: 0,
    width: '100%',
    marginTop: Spacing[1],
  },
  formDynamicBlock: {
    flexShrink: 0,
    width: '100%',
  },
  compactOrderOpts: {
    flexShrink: 0,
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: Spacing[1],
    paddingHorizontal: 2,
  },
  formScroll: {
    flex: 1,
    minHeight: 0,
  },
  formScrollContent: {
    flexGrow: 0,
    paddingHorizontal: Spacing[1],
    paddingBottom: Spacing[2],
  },
  formFooterCol: {
    flexShrink: 0,
    width: '100%',
    paddingTop: Spacing[2],
    paddingBottom: Spacing[1],
    marginTop: Spacing[2],
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Colors.surfaceBorder,
    backgroundColor: Colors.surface,
  },
  dataPanel: {
    backgroundColor: Colors.surface,
  },
  compactAvbl: {
    fontFamily: FontFamily.regular,
    fontSize: 10,
    color: Colors.textMuted,
    marginHorizontal: Spacing[1],
    marginBottom: 4,
  },
  dualCtaRow: {
    flexDirection: 'row',
    gap: Spacing[1],
    paddingHorizontal: Spacing[1],
    marginTop: 2,
    marginBottom: 2,
  },
  ctaBtnHalf: {
    flex: 1,
    paddingVertical: 8,
  },
  kycCtaBtnFull: {
    width: '100%',
    paddingVertical: 12,
    paddingHorizontal: Spacing[3],
    borderRadius: Radius.md,
    backgroundColor: Colors.gold,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
    marginBottom: 2,
  },
  dataPanelScrollContent: {
    paddingHorizontal: Spacing[3],
    paddingBottom: Spacing[4],
    minHeight: 280,
  },
  futuresToolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing[2],
    paddingHorizontal: 0,
    paddingVertical: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.surfaceBorder,
    backgroundColor: Colors.surfaceCard,
  },
  levPanelWrap: {
    paddingHorizontal: Spacing[2],
    paddingVertical: Spacing[2],
    backgroundColor: Colors.surfaceCard,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.surfaceBorder,
  },
  levPanelHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: Spacing[1],
  },
  levPanelTitle: {
    fontFamily: FontFamily.semiBold,
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
  },
  toolChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: Spacing[2],
    paddingVertical: 6,
    backgroundColor: Colors.surfaceHover,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
  },
  toolChipTxt: {
    fontFamily: FontFamily.semiBold,
    fontSize: FontSize.xs,
    color: Colors.textSecondary,
  },
  levWrapCompact: {
    marginBottom: Spacing[1],
    paddingHorizontal: Spacing[1],
  },
  levAdvancedLbl: {
    fontFamily: FontFamily.semiBold,
    fontSize: 10,
    color: Colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginBottom: Spacing[1],
    paddingHorizontal: Spacing[2],
  },
  levErrorTxt: {
    fontFamily: FontFamily.regular,
    fontSize: FontSize.xs,
    color: Colors.danger,
    marginTop: Spacing[1],
    paddingHorizontal: Spacing[2],
  },
  sideRowTerminal: {
    flexDirection: 'row',
    gap: Spacing[1],
    marginBottom: Spacing[1],
    paddingHorizontal: Spacing[1],
  },
  sideBtnTerminal: {
    flex: 1,
    paddingVertical: 6,
    borderRadius: Radius.md,
    alignItems: 'center',
    backgroundColor: Colors.surfaceHover,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
  },
  sideBtnBuyTerminal:  { backgroundColor: FuturesUi.long, borderColor: FuturesUi.long },
  sideBtnSellTerminal: { backgroundColor: Colors.sellRed,  borderColor: Colors.sellRed },
  sideBtnTxtTerminal: {
    fontFamily: FontFamily.bold,
    fontSize: FontSize.xs,
    color: Colors.textMuted,
  },
  sideBtnTxtBuyTerminal:  { color: Colors.textPrimary },
  sideBtnTxtSellTerminal: { color: Colors.textPrimary },
  typeDropdown: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    alignSelf: 'stretch',
    marginBottom: Spacing[2],
    paddingHorizontal: Spacing[2],
    paddingVertical: F.dropdownPadV,
    minHeight: F.dropdownMinH,
    backgroundColor: Colors.surfaceCard,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    gap: Spacing[2],
  },
  typeDropdownIcon: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  typeDropdownTxt: {
    flex: 1,
    fontFamily: FontFamily.semiBold,
    fontSize: FontSize.base,
    color: Colors.textPrimary,
  },
  fundingHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: Spacing[2],
    paddingVertical: Spacing[2],
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.surfaceBorder,
  },
  fundingLbl: {
    fontFamily: FontFamily.medium,
    fontSize: FontSize.xs,
    color: Colors.textSecondary,
  },
  fundingVal: {
    fontFamily: FontFamily.monoMedium,
    fontSize: FontSize.sm,
    color: Colors.textPrimary,
  },

  dataTabBar: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: Colors.surfaceBorder,
    marginBottom: Spacing[1],
    paddingHorizontal: Spacing[2],
  },
  dataTabBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingVertical: Spacing[2],
    paddingHorizontal: Spacing[3],
    marginRight: Spacing[1],
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  dataTabBtnActive: { borderBottomColor: Colors.gold },
  historyIconBtn: {
    marginLeft: 'auto' as any,
    padding: Spacing[2],
    alignSelf: 'center',
  },
  dataTabTxt: {
    fontFamily: FontFamily.medium,
    fontSize: FontSize.sm,
    color: Colors.textMuted,
  },
  dataTabTxtActive: { color: Colors.goldLight },
  dataBadge: {
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: Colors.goldAlpha30,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  dataBadgeTxt: {
    fontFamily: FontFamily.bold,
    fontSize: 9,
    color: Colors.goldLight,
  },

  terminalMeta: {
    marginHorizontal: Spacing[1],
    marginBottom: Spacing[2],
    paddingHorizontal: Spacing[2],
    paddingVertical: Spacing[2],
    backgroundColor: Colors.surfaceHover,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
  },
  terminalMetaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  terminalMetaLbl: {
    fontFamily: FontFamily.medium,
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
  },
  terminalMetaVal: {
    fontFamily: FontFamily.monoMedium,
    fontSize: FontSize.base,
    color: Colors.textPrimary,
  },

  marketStrip: {
    marginHorizontal: Spacing[4],
    marginTop: Spacing[2],
    marginBottom: Spacing[1],
    padding: Spacing[3],
    backgroundColor: Colors.surfaceCard,
    borderRadius: Radius.xl,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
  },
  stripTitle: {
    fontFamily: FontFamily.bold,
    fontSize: 10,
    color: Colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.7,
    marginBottom: Spacing[2],
  },
  stripGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    justifyContent: 'space-between',
  },
  stripTile: {
    flexGrow: 1,
    flexBasis: '46%',
    minWidth: 132,
    maxWidth: '100%',
    paddingVertical: Spacing[2],
    paddingHorizontal: Spacing[2],
    backgroundColor: Colors.surfaceHover,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
  },
  stripLabel: {
    fontFamily: FontFamily.medium,
    fontSize: 9,
    color: Colors.textMuted,
    marginBottom: 2,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  stripValue: {
    fontFamily: FontFamily.monoMedium,
    fontSize: 12,
    color: Colors.textPrimary,
  },
  stripSub: {
    fontFamily: FontFamily.regular,
    fontSize: 9,
    color: Colors.textSecondary,
    marginTop: 2,
  },

  walletChip:      { alignItems: 'flex-end', alignSelf: 'flex-end', maxWidth: '100%' },
  walletChipLabel: { fontFamily: FontFamily.regular, fontSize: 9, color: Colors.textMuted },
  walletChipVal:   { fontFamily: FontFamily.monoMedium, fontSize: FontSize.xs, color: Colors.goldLight, maxWidth: '100%', textAlign: 'right' },

  marginChip: {
    paddingVertical: Spacing[2],
    paddingHorizontal: Spacing[4],
    backgroundColor: Colors.goldAlpha15,
    borderWidth: 1,
    borderColor: Colors.goldAlpha30,
    borderRadius: Radius.md,
    alignSelf: 'flex-start',
  },
  marginChipTxt: {
    fontFamily: FontFamily.bold,
    fontSize: FontSize.xs,
    color: Colors.goldLight,
  },
  levWrap: {
    marginTop: Spacing[3],
  },

  sectionBlockTitle: {
    fontFamily: FontFamily.bold,
    fontSize: 11,
    color: Colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.85,
    marginBottom: Spacing[2],
    paddingHorizontal: Spacing[1],
  },
  limitsCard: {
    backgroundColor: Colors.surfaceCard,
    borderRadius: Radius.xl,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    padding: Spacing[3],
  },
  limitsRow: { flexDirection: 'row', gap: Spacing[2], marginBottom: Spacing[2] },
  limitCell: {
    flex: 1,
    paddingVertical: Spacing[2],
    paddingHorizontal: Spacing[2],
    backgroundColor: Colors.surfaceHover,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
  },
  limitLbl: {
    fontFamily: FontFamily.medium,
    fontSize: 9,
    color: Colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginBottom: 4,
  },
  limitVal: { fontFamily: FontFamily.monoMedium, fontSize: FontSize.sm, color: Colors.textPrimary },

  orderTypeSectionLbl: {
    fontFamily: FontFamily.bold,
    fontSize: 9,
    color: Colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginHorizontal: Spacing[3],
    marginBottom: Spacing[2],
  },
  orderTypeGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing[2],
    paddingHorizontal: Spacing[3],
    marginBottom: Spacing[2],
  },
  orderTypeCard: {
    flexBasis: '47%',
    flexGrow: 1,
    minWidth: 148,
    padding: Spacing[3],
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    backgroundColor: Colors.surfaceHover,
  },
  orderTypeCardActive: {
    borderColor: Colors.gold,
    backgroundColor: Colors.goldAlpha15,
  },
  orderTypeCardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
  orderTypeCardTitle: { fontFamily: FontFamily.bold, fontSize: FontSize.xs, color: Colors.textSecondary },
  orderTypeCardTitleActive: { color: Colors.goldLight },
  orderTypeCardSub: { fontFamily: FontFamily.regular, fontSize: 10, color: Colors.textMuted, lineHeight: 14 },
  orderTypeActiveDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: Colors.gold,
  },
  compactQuoteStrip: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginHorizontal: Spacing[3],
    marginBottom: Spacing[3],
    paddingVertical: Spacing[2],
    paddingHorizontal: Spacing[1],
    backgroundColor: Colors.surfaceHover,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    borderRadius: Radius.md,
    gap: 4,
    justifyContent: 'space-between',
  },
  compactQuoteCell: { flex: 1, minWidth: 52, alignItems: 'center', paddingVertical: 2 },
  compactQuoteLbl: { fontFamily: FontFamily.medium, fontSize: 8, color: Colors.textMuted, marginBottom: 2 },
  compactQuoteVal: { fontFamily: FontFamily.monoMedium, fontSize: 10, color: Colors.textPrimary },

  panelCard:       { backgroundColor: Colors.surfaceCard, borderRadius: Radius.xl, borderWidth: 1, borderColor: Colors.surfaceBorder, overflow: 'hidden' },
  hint:            { fontFamily: FontFamily.regular, fontSize: 9, color: Colors.textMuted, textAlign: 'center', paddingVertical: Spacing[2] },
  sectionLabel:    { fontFamily: FontFamily.bold, fontSize: 10, color: Colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.8, marginTop: Spacing[4], marginBottom: Spacing[2], paddingHorizontal: Spacing[2] },
  tradesHeader:    { flexDirection: 'row', paddingHorizontal: Spacing[2], paddingBottom: Spacing[1], borderBottomWidth: 1, borderBottomColor: Colors.surfaceBorder },
  tradeHead:       { fontFamily: FontFamily.medium, fontSize: 9, color: Colors.textDisabled },
  tradeRow:        { flexDirection: 'row', paddingHorizontal: Spacing[2], paddingVertical: 4, borderBottomWidth: 1, borderBottomColor: Colors.surfaceBorder + '60' },
  tradeSideLbl:    { fontFamily: FontFamily.bold, fontSize: 9 },
  tradePrice:      { flex: 1, fontFamily: FontFamily.monoMedium, fontSize: 10 },
  tradeSize:       { flex: 1, fontFamily: FontFamily.mono, fontSize: 10, color: Colors.textSecondary, textAlign: 'right' },
  tradeTime:       { flex: 1.3, fontFamily: FontFamily.mono, fontSize: 9, color: Colors.textMuted, textAlign: 'right' },

  walletPanelHead:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: Spacing[3], borderBottomWidth: 1, borderBottomColor: Colors.surfaceBorder },
  walletPanelTitle: { fontFamily: FontFamily.bold, fontSize: FontSize.sm, color: Colors.textPrimary },
  transferBtn:      { paddingHorizontal: Spacing[3], paddingVertical: Spacing[1], backgroundColor: Colors.goldAlpha15, borderWidth: 1, borderColor: Colors.goldAlpha30, borderRadius: Radius.md },
  transferBtnTxt:   { fontFamily: FontFamily.bold, fontSize: FontSize.xs, color: Colors.goldLight },
  syncMarginBtn: {
    marginHorizontal: Spacing[3],
    marginTop: Spacing[2],
    paddingVertical: Spacing[2],
    alignItems: 'center',
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    backgroundColor: Colors.surfaceHover,
  },
  syncMarginTxt: { fontFamily: FontFamily.medium, fontSize: FontSize.xs, color: Colors.textSecondary },
  ledgerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing[3],
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.surfaceBorder,
  },
  ledgerType: { fontFamily: FontFamily.medium, fontSize: FontSize.xs, color: Colors.textPrimary },
  ledgerTime: { fontFamily: FontFamily.regular, fontSize: 9, color: Colors.textMuted, marginTop: 2 },
  ledgerAmt:  { fontFamily: FontFamily.monoMedium, fontSize: FontSize.xs },
  walletRow:        { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: Spacing[3], paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: Colors.surfaceBorder },
  walletLabel:      { fontFamily: FontFamily.regular, fontSize: FontSize.xs, color: Colors.textMuted },
  walletVal:        { fontFamily: FontFamily.monoMedium, fontSize: FontSize.xs },

  sideRow:        { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: Colors.surfaceBorder },
  sideBtn:        { flex: 1, paddingVertical: Spacing[4], alignItems: 'center', backgroundColor: Colors.surfaceHover },
  sideBtnBuy:     { backgroundColor: FuturesUi.longDim },
  sideBtnSell:    { backgroundColor: Colors.sellRedDim },
  sideBtnTxt:     { fontFamily: FontFamily.bold, fontSize: FontSize.xs, color: Colors.textMuted, letterSpacing: 0.3 },
  sideBtnTxtBuy:  { color: FuturesUi.long },
  sideBtnTxtSell: { color: Colors.sellRed },

  fieldWrap:       { marginHorizontal: 0, marginBottom: 0 },
  fieldWrapFlex: {
    flexShrink: 0,
    marginHorizontal: 0,
  },
  qtySliderGroup: {
    flexShrink: 0,
    gap: Spacing[2],
  },
  qtySliderWrap: {
    flexShrink: 0,
    marginTop: 0,
    marginBottom: 0,
  },
  fieldLabelRow:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 },
  fieldLabel:      { fontFamily: FontFamily.medium, fontSize: FontSize.xs, color: Colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.5 },
  fieldLabelGap:   { marginBottom: 4 },
  latestBtn:       { fontFamily: FontFamily.bold, fontSize: FontSize.xs, color: Colors.goldLight },
  fieldBox:        { flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.surfaceHover, borderWidth: 1, borderColor: Colors.surfaceBorder, borderRadius: Radius.md, paddingHorizontal: Spacing[2], paddingVertical: F.fieldPadV, minHeight: F.fieldMinH, minWidth: 0 },
  fieldBoxReadOnly:{ opacity: 0.85 },
  fieldBoxErr:     { borderColor: Colors.dangerDim },
  fieldInput:      { flex: 1, minWidth: 0, paddingVertical: 0, marginVertical: 0, fontFamily: FontFamily.monoMedium, fontSize: FontSize.sm, color: Colors.textPrimary, textAlign: 'center' },
  fieldInputCenter:{ textAlign: 'center' },
  qtyStepBtn:      { width: F.stepBtn, height: F.stepBtn, alignItems: 'center', justifyContent: 'center' },
  qtyStepTxt:      { fontFamily: FontFamily.bold, fontSize: FontSize.xl, color: Colors.textSecondary, lineHeight: 24 },
  fieldUnit:       { fontFamily: FontFamily.semiBold, fontSize: FontSize.xs, color: Colors.textSecondary, marginLeft: Spacing[1], flexShrink: 0 },
  fieldHint:       { fontFamily: FontFamily.regular, fontSize: 9, color: Colors.textMuted, marginTop: 3 },
  fieldErrTxt:     { fontFamily: FontFamily.medium, fontSize: 10, color: Colors.danger, marginTop: 2 },

  pctRow: { flexDirection: 'row', marginHorizontal: Spacing[3], marginBottom: Spacing[3], gap: Spacing[1] },
  pctRowCompact: { marginHorizontal: Spacing[1], marginBottom: Spacing[1] },
  pctBtn: { flex: 1, paddingVertical: Spacing[2], backgroundColor: Colors.surfaceHover, borderWidth: 1, borderColor: Colors.surfaceBorder, borderRadius: Radius.md, alignItems: 'center' },
  pctBtnCompact: { paddingVertical: 4 },
  pctTxt: { fontFamily: FontFamily.semiBold, fontSize: FontSize.xs, color: Colors.textPrimary },

  summaryBox:  { marginHorizontal: Spacing[3], marginBottom: Spacing[3], backgroundColor: Colors.surfaceHover, borderWidth: 1, borderColor: Colors.surfaceBorder, borderRadius: Radius.md, padding: Spacing[3] },
  summaryBoxCompact: {
    marginTop: Spacing[1],
    marginBottom: Spacing[1],
    paddingHorizontal: Spacing[2],
    paddingVertical: Spacing[2],
    backgroundColor: Colors.surfaceHover,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    borderRadius: Radius.md,
    gap: 3,
  },
  summaryHead: { fontFamily: FontFamily.bold, fontSize: 9, color: Colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.7, marginBottom: Spacing[2] },
  summaryRow:  { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3 },
  summaryLabel:{ fontFamily: FontFamily.regular, fontSize: 10, color: Colors.textMuted },
  summaryVal:  { fontFamily: FontFamily.monoMedium, fontSize: 10, color: Colors.textPrimary },

  tifRow:          { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginHorizontal: Spacing[3], marginBottom: Spacing[3] },
  reduceOnlyBtn:   { flexDirection: 'row', alignItems: 'center', gap: 6 },
  checkbox:        { width: 16, height: 16, borderRadius: 4, borderWidth: 1, borderColor: Colors.surfaceBorder, backgroundColor: Colors.surfaceHover, alignItems: 'center', justifyContent: 'center' },
  checkboxActive:  { borderColor: Colors.buyGreen, backgroundColor: Colors.buyGreenDim },
  reduceOnlyTxt:   { fontFamily: FontFamily.medium, fontSize: FontSize.xs, color: Colors.textSecondary },
  tifBtns:         { flexDirection: 'row', gap: 4 },
  tifBtn:          { paddingHorizontal: Spacing[2], paddingVertical: 4, borderRadius: Radius.sm, borderWidth: 1, borderColor: Colors.surfaceBorder, backgroundColor: Colors.surfaceHover },
  tifBtnActive:    { borderColor: Colors.gold, backgroundColor: Colors.goldAlpha15 },
  tifBtnTxt:       { fontFamily: FontFamily.medium, fontSize: 10, color: Colors.textMuted },
  tifBtnTxtActive: { color: Colors.goldLight },

  banner:      { marginHorizontal: Spacing[3], marginBottom: Spacing[2], padding: Spacing[2], borderRadius: Radius.md, backgroundColor: Colors.dangerDim, borderWidth: 1, borderColor: Colors.dangerDim },
  bannerErr:   { fontFamily: FontFamily.medium, fontSize: FontSize.xs, color: Colors.danger },
  tradeAlert: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    marginTop: 4,
    marginBottom: 0,
    paddingHorizontal: Spacing[2],
    paddingVertical: 6,
    borderRadius: Radius.md,
    backgroundColor: Colors.sellRedDim,
    borderWidth: 1,
    borderColor: Colors.sellRedDim,
  },
  tradeAlertOk: {
    backgroundColor: FuturesUi.longDim,
    borderColor: FuturesUi.longDim,
  },
  tradeAlertTxt: {
    flex: 1,
    fontFamily: FontFamily.medium,
    fontSize: 10,
    color: Colors.sellRed,
    lineHeight: 14,
  },
  tradeAlertTxtOk: { color: FuturesUi.long },
  bannerOkWrap:{ backgroundColor: FuturesUi.longDim, borderColor: FuturesUi.longDim },
  bannerOk:    { fontFamily: FontFamily.medium, fontSize: FontSize.xs, color: FuturesUi.long },

  submitBtn:      { marginHorizontal: Spacing[1], marginVertical: Spacing[2], paddingVertical: Spacing[3], borderRadius: Radius.lg, alignItems: 'center' },
  submitBuy:      { backgroundColor: FuturesUi.long },
  submitSell:     { backgroundColor: Colors.sellRed },
  submitDisabled: { opacity: 0.45 },
  submitTxt:      { fontFamily: FontFamily.extraBold, fontSize: FontSize.base, color: Colors.white, letterSpacing: 0.5 },

  posCard:    { backgroundColor: Colors.surfaceCard, borderWidth: 1, borderColor: Colors.surfaceBorder, borderRadius: Radius.lg, padding: Spacing[3], marginBottom: Spacing[2] },
  posTop:     { flexDirection: 'row', alignItems: 'center', gap: Spacing[2], marginBottom: Spacing[2] },
  posSymbol:  { fontFamily: FontFamily.semiBold, fontSize: FontSize.sm, color: Colors.textPrimary, flex: 1 },
  posPnl:     { fontFamily: FontFamily.bold, fontSize: FontSize.sm },
  posMeta:    { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing[2], marginBottom: Spacing[2] },
  posMetaItem:{ minWidth: '30%', flex: 1 },
  posMetaLabel:{ fontFamily: FontFamily.regular, fontSize: 9, color: Colors.textMuted, marginBottom: 1 },
  posMetaVal: { fontFamily: FontFamily.monoMedium, fontSize: FontSize.xs, color: Colors.textPrimary },
  posActions: { flexDirection: 'row', alignItems: 'center', borderTopWidth: 1, borderTopColor: Colors.surfaceBorder, paddingTop: Spacing[2], gap: Spacing[2] },
  posModeTxt: { fontFamily: FontFamily.regular, fontSize: 9, color: Colors.textMuted, flex: 1 },
  close50Btn: { paddingHorizontal: Spacing[3], paddingVertical: 4, backgroundColor: Colors.surfaceHover, borderRadius: Radius.sm, borderWidth: 1, borderColor: Colors.surfaceBorder },
  close50Txt: { fontFamily: FontFamily.medium, fontSize: 10, color: Colors.textSecondary },
  closeAllBtn:{ paddingHorizontal: Spacing[3], paddingVertical: 4, backgroundColor: Colors.dangerDim, borderRadius: Radius.sm, borderWidth: 1, borderColor: Colors.dangerDim },
  closeAllTxt:{ fontFamily: FontFamily.medium, fontSize: 10, color: Colors.danger },

  sidePill:    { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  sidePillTxt: { fontFamily: FontFamily.bold, fontSize: 9, letterSpacing: 0.5 },

  orderCard:   { backgroundColor: Colors.surfaceCard, borderWidth: 1, borderColor: Colors.surfaceBorder, borderRadius: Radius.lg, padding: Spacing[3], marginBottom: Spacing[2] },
  orderTop:    { flexDirection: 'row', alignItems: 'center', gap: Spacing[2], marginBottom: Spacing[2] },
  orderSymbol: { fontFamily: FontFamily.semiBold, fontSize: FontSize.sm, color: Colors.textPrimary, flex: 1 },
  orderType:   { fontFamily: FontFamily.medium, fontSize: 10, color: Colors.textMuted },
  orderBottom: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderTopWidth: 1, borderTopColor: Colors.surfaceBorder, paddingTop: Spacing[2], marginTop: Spacing[1] },
  orderDate:   { fontFamily: FontFamily.regular, fontSize: 9, color: Colors.textDisabled },
  cancelBtn:   { paddingHorizontal: Spacing[2], paddingVertical: 3, backgroundColor: Colors.dangerDim, borderRadius: Radius.sm, borderWidth: 1, borderColor: Colors.dangerDim },
  cancelTxt:   { fontFamily: FontFamily.medium, fontSize: 10, color: Colors.danger },

  emptyWrap:  { paddingVertical: Spacing[10], alignItems: 'center', backgroundColor: Colors.surfaceCard, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceBorder, marginBottom: Spacing[3] },
  emptyTxt:   { fontFamily: FontFamily.regular, fontSize: FontSize.sm, color: Colors.textMuted },

  overlay:    { flex: 1, backgroundColor: Colors.black60, justifyContent: 'flex-end' },
  modalCard:  { backgroundColor: Colors.surfaceCard, borderTopLeftRadius: Radius.xl, borderTopRightRadius: Radius.xl, padding: Spacing[6], borderWidth: 1, borderBottomWidth: 0, borderColor: Colors.surfaceBorder },
  modalTitle: { fontFamily: FontFamily.bold, fontSize: FontSize.xl, color: Colors.textPrimary, marginBottom: 4 },
  modalSub:   { fontFamily: FontFamily.regular, fontSize: FontSize.xs, color: Colors.textMuted, marginBottom: Spacing[4] },
  modalInput: { backgroundColor: Colors.surfaceHover, borderWidth: 1, borderColor: Colors.surfaceBorder, borderRadius: Radius.md, paddingHorizontal: Spacing[4], paddingVertical: Spacing[3], fontFamily: FontFamily.mono, fontSize: FontSize.lg, color: Colors.textPrimary, marginBottom: Spacing[5] },
  transferAmountRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing[2], marginBottom: Spacing[5] },
  transferInputFlex: { flex: 1, marginBottom: 0 },
  maxBtn: {
    paddingHorizontal: Spacing[3], paddingVertical: Spacing[3],
    borderRadius: Radius.md, backgroundColor: Colors.surfaceHover,
    borderWidth: 1, borderColor: Colors.surfaceBorder,
  },
  maxBtnTxt: { fontFamily: FontFamily.bold, fontSize: FontSize.sm, color: FuturesUi.longLight },
  modalBtns:  { flexDirection: 'row', gap: Spacing[3], justifyContent: 'flex-end' },
  dirRow:     { flexDirection: 'row', gap: Spacing[3], marginBottom: Spacing[4] },
  dirBtn:     { flex: 1, paddingVertical: Spacing[3], alignItems: 'center', borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.surfaceBorder, backgroundColor: Colors.surfaceHover },
  dirBtnActive:   { borderColor: Colors.gold, backgroundColor: Colors.goldAlpha15 },
  dirBtnTxt:      { fontFamily: FontFamily.medium, fontSize: FontSize.xs, color: Colors.textMuted },
  dirBtnTxtActive:{ color: Colors.goldLight },
});
