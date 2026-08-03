/**
 * ChartScreen — Full-page chart matching the Ourbit "Chart Page" design.
 *
 * Layout (top → bottom):
 *   ┌─────────────────────────────────────┐
 *   │  ← BTC/USDT ▼          [🔗][🔔][⋮] │  compact nav header
 *   ├─────────────────────────────────────┤
 *   │  75,724.27                          │  large price
 *   │  +75,603.11  -1.04%                 │  abs + pct change
 *   │  24h High │ 24h Vol(BTC)            │  stats 2×2 grid
 *   │  24h Low  │ 24h Vol(USDT)           │
 *   ├─────────────────────────────────────┤
 *   │  [1m][15m][1h][4h][1d][More▼]  ⚙   │  timeframe row (handled inside PriceChart)
 *   │                                     │
 *   │  ▓▓▓▓ CANDLESTICK CHART ▓▓▓▓▓▓▓▓▓  │
 *   │                                     │
 *   ├─────────────────────────────────────┤
 *   │  [MA][EMA][BOLL][SAR][VOL][MACD]…  │  indicator pill toggles (local state)
 *   ├─────────────────────────────────────┤
 *   │  ▒▒▒▒ LIVE PULSE PANEL ▒▒▒▒▒▒▒▒▒▒▒  │  filled price + volume
 *   ├─────────────────────────────────────┤
 *   │  Depth          Trades              │  tab row
 *   │  buy / sell order book two columns  │
 *   └─────────────────────────────────────┘
 *   ╔═══════════════════════════════════╗
 *   ║  [ BUY  ]         [ SELL ]        ║  sticky CTA (goes back and sets side)
 *   ╚═══════════════════════════════════╝
 *
 * Navigated to by tapping the candlestick icon in TradeMarketHeader.
 * Pressing Buy / Sell pops back to the trade screen.
 */
import React, {
  useState, useEffect, useCallback, useRef, useMemo, useLayoutEffect,
} from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView,
  Dimensions,
} from 'react-native';
import { useSelector } from 'react-redux';
import SafeAreaWrapper from '../../components/common/SafeAreaWrapper';
import Icon from '../../components/common/AppIcon';
import CoinIcon from '../../components/common/CoinIcon';
import ChartPreviewCard from '../../components/trading/ChartPreviewCard';
import FuturesChartToggleBar from '../../components/futures/FuturesChartToggleBar';
import type { ChartInterval } from '../../components/trading/chartIntervals';
import { TRADE_CHART_PANEL_H } from '../../components/trading/chartIntervals';
import ChartDepthPanel from '../../components/trading/ChartDepthPanel';
import OrderBookDepthList from '../../components/trading/OrderBookDepthList';
import TradePairPickerModal from '../../components/trading/TradePairPickerModal';
import ChartTradeSheet from '../../components/trading/ChartTradeSheet';
import { useResolvedCoinLogo } from '../../hooks/useCoinLogoUrl';
import { Colors, FontFamily, FontSize, Spacing, LayoutColors, Radius } from '../../theme';
import {
  formatPrice, formatPercent, isPositive, formatAmount,
} from '../../utils/formatters';
import { prefetchChartPageData } from '../../services/chartPagePrefetch.service';
import { useChartOrderBookFeed } from '../../hooks/useOrderBookFeed';
import { useSpotTickerFeed } from '../../hooks/useTickerFeed';
import { useSpotTradesFeed } from '../../hooks/useTradesFeed';
import { ensureSpotOrderBook } from '../../services/orderBookFeed.service';
import { setCachedOrderBook, orderBookHasDepth } from '../../utils/orderBookCache';
import { toSpotSymbol, toFuturesSymbol, formatPairLabel, parsePairLabel } from '../../utils/tradeSymbols';
import {
  readChartTrades,
  resolveChartTicker,
  bootstrapChartPageCaches,
} from '../../utils/chartPageCache';
import { instantChartKlines } from '../../utils/chartPageBootstrap';
import { OrderBook } from '../../types/market.types';
import { RootState } from '../../store';
import { useFocusEffect } from '@react-navigation/native';
import type { TradeMarketType } from '../../components/trading/TradeMarketHeader';
import { iosManualKeyboardScrollProps } from '@/utils/iosKeyboardScroll';

const { width: SCREEN_W } = Dimensions.get('window');
const SCREEN_H_PAD = Spacing[3];
const CONTENT_W = SCREEN_W - SCREEN_H_PAD * 2;
const DEPTH_PANEL_H = 176;
const BOOK_WEBVIEW_H = 360;
const BOOK_LIST_INNER_H = BOOK_WEBVIEW_H - Spacing[3] - Spacing[4];
const BOOK_ROW_H = 22;

function fmtVol(v: number): string {
  if (!Number.isFinite(v) || v <= 0) return '—';
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(3)}M`;
  if (v >= 1_000)     return `${(v / 1_000).toFixed(3)}K`;
  return v.toFixed(2);
}

function fmtQuoteApprox(p: number, quote: string): string {
  if (!Number.isFinite(p) || p <= 0) return `— ${quote}`;
  if (p >= 1) return `≈${p.toFixed(2)} ${quote}`;
  if (p >= 0.01) return `≈${p.toFixed(4)} ${quote}`;
  return `≈${p.toPrecision(4)} ${quote}`;
}

type DepthTab = 'depth' | 'trades';

export default function ChartScreen({ navigation, route }: any) {
  const {
    symbol: rawSymbol = 'BTCUSDT',
    market = 'spot',
    seedTicker,
    seedOrderBook,
    leverage: routeLeverage,
  } = route?.params ?? {};
  const spotSym = useMemo(() => toSpotSymbol(rawSymbol), [rawSymbol]);
  const futuresSym = useMemo(() => toFuturesSymbol(rawSymbol), [rawSymbol]);
  const klineSym = spotSym;
  const marketType = market as TradeMarketType;

  const marketRow = useSelector((s: RootState) => s.market.markets[spotSym]);
  const coinLogoUrl = useResolvedCoinLogo(rawSymbol, marketRow?.logo_url);
  const { base: baseAsset, quote: quoteAsset } = useMemo(
    () => parsePairLabel(rawSymbol),
    [rawSymbol],
  );
  const pairLabel = useMemo(() => formatPairLabel(rawSymbol), [rawSymbol]);

  const bootRef = useRef('');
  const bootKey = `${spotSym}|${market}|${Boolean(seedTicker)}|${Boolean(seedOrderBook)}`;
  if (bootRef.current !== bootKey) {
    bootstrapChartPageCaches({
      spotSym,
      seedTicker: seedTicker as Record<string, unknown> | undefined,
      seedOrderBook: seedOrderBook as OrderBook | undefined,
      marketRow,
    });
    bootRef.current = bootKey;
  }

  useLayoutEffect(() => {
    bootstrapChartPageCaches({
      spotSym,
      seedTicker: seedTicker as Record<string, unknown> | undefined,
      seedOrderBook: seedOrderBook as OrderBook | undefined,
      marketRow,
    });
    if (seedOrderBook && orderBookHasDepth(seedOrderBook as OrderBook)) {
      setCachedOrderBook(spotSym, seedOrderBook as OrderBook);
    }
  }, [spotSym, seedTicker, seedOrderBook, marketRow]);

  const { orderBook, hasDepth: bookHasDepth } = useChartOrderBookFeed(
    spotSym,
    futuresSym,
    marketType,
  );

  const instantTicker = useMemo(
    () => resolveChartTicker(spotSym, marketRow),
    [spotSym, marketRow],
  );
  const instantTrades = useMemo(
    () => readChartTrades(spotSym) ?? [],
    [spotSym],
  );
  const candleSeed = useMemo(() => instantChartKlines(klineSym), [klineSym]);

  const { ticker: feedTicker } = useSpotTickerFeed(spotSym);
  const { trades: feedTrades, loading: feedTradesLoading } = useSpotTradesFeed(spotSym);

  const ticker = feedTicker ?? instantTicker;
  const recentTrades = feedTrades.length ? feedTrades : instantTrades;
  const tradesLoading = feedTradesLoading && recentTrades.length === 0;
  const [depthTab,  setDepthTab]  = useState<DepthTab>('depth');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [tradeSheetSide, setTradeSheetSide] = useState<'buy' | 'sell' | null>(null);
  const [pageScrollEnabled, setPageScrollEnabled] = useState(true);
  const [chartExpanded, setChartExpanded] = useState(true);
  const scrollRef = useRef<ScrollView>(null);

  useFocusEffect(
    useCallback(() => {
      prefetchChartPageData(rawSymbol, marketType);
      ensureSpotOrderBook(spotSym);
    }, [rawSymbol, marketType, spotSym]),
  );

  useEffect(() => {
    ensureSpotOrderBook(spotSym);
    prefetchChartPageData(rawSymbol, marketType);
  }, [spotSym, rawSymbol, marketType]);

  const handlePairSelect = (newSym: string, mk: string) => {
    navigation.setParams({ symbol: newSym, market: mk });
  };

  const handleChartScrollLock = useCallback((locked: boolean) => {
    setPageScrollEnabled(!locked);
  }, []);

  const toggleChartExpanded = useCallback(() => {
    setChartExpanded((prev) => {
      if (prev) setPageScrollEnabled(true);
      return !prev;
    });
  }, []);

  const price     = Number(ticker?.price ?? 0);
  const changePct = Number(ticker?.changePct ?? 0);
  const high24h   = Number((ticker as any)?.high ?? 0);
  const low24h    = Number((ticker as any)?.low  ?? 0);
  const volBase   = fmtVol(Number(ticker?.volume ?? 0));
  const volQuote  = price > 0 ? fmtVol(Number(ticker?.volume ?? 0) * price) : '—';
  const positive  = isPositive(changePct);
  const priceColor = positive ? LayoutColors.marketUp : LayoutColors.marketDown;
  const marketTag  = market === 'futures' ? ' Perp' : market === 'options' ? ' Options' : '';

  const fairPrice = useMemo(() => {
    const topBid = [...(orderBook.bids ?? [])]
      .map((r) => parseFloat(String(r.price)))
      .filter((p) => p > 0)
      .sort((a, b) => b - a)[0] ?? 0;
    const topAsk = [...(orderBook.asks ?? [])]
      .map((r) => parseFloat(String(r.price)))
      .filter((p) => p > 0)
      .sort((a, b) => a - b)[0] ?? 0;
    if (topBid > 0 && topAsk > 0) return (topBid + topAsk) / 2;
    return price > 0 ? price : 0;
  }, [orderBook.bids, orderBook.asks, price]);

  const openFullscreenChart = useCallback((interval: ChartInterval) => {
    navigation.push('FullChartView', {
      symbol: rawSymbol,
      market: marketType,
      interval,
      livePrice: price > 0 ? price : undefined,
    });
  }, [navigation, rawSymbol, marketType, price]);

  const handleTradeSide = useCallback((side: 'buy' | 'sell') => {
    setTradeSheetSide(side);
  }, []);

  const closeTradeSheet = useCallback(() => {
    setTradeSheetSide(null);
  }, []);

  const sheetOpen = tradeSheetSide != null;

  const chartToggleTitle = marketType === 'futures'
    ? `${pairLabel} Perp Chart`
    : `${pairLabel} Chart`;

  const tradeCtaBlock = (
    <View style={styles.tradeCtaRow}>
      <TouchableOpacity
        style={[styles.tradeCtaBtn, styles.tradeCtaBuy]}
        onPress={() => handleTradeSide('buy')}
        activeOpacity={0.85}
      >
        <Text style={styles.tradeCtaBuyText}>Buy</Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={[styles.tradeCtaBtn, styles.tradeCtaSell]}
        onPress={() => handleTradeSide('sell')}
        activeOpacity={0.85}
      >
        <Text style={styles.tradeCtaSellText}>Sell</Text>
      </TouchableOpacity>
    </View>
  );

  return (
    <SafeAreaWrapper style={styles.screen}>
      <TradePairPickerModal
        visible={pickerOpen}
        currentSymbol={rawSymbol}
        marketType={market}
        onClose={() => setPickerOpen(false)}
        onSelect={handlePairSelect}
      />

      {/* ── Navigation header + compact 24h stats ── */}
      <View style={styles.navHeader}>
        <View style={styles.navBar}>
          <TouchableOpacity style={styles.navBack} onPress={() => navigation.goBack()} hitSlop={8}>
            <Icon name="arrow-left" size={20} color={Colors.textPrimary} />
          </TouchableOpacity>

          <TouchableOpacity style={styles.pairBtn} onPress={() => setPickerOpen(true)} activeOpacity={0.75}>
            <CoinIcon symbol={rawSymbol} size={22} logoUrl={coinLogoUrl} />
            <Text style={styles.pairLabel} numberOfLines={1}>
              {pairLabel}
              {marketTag ? (
                <Text style={styles.pairMarketTag}>{marketTag}</Text>
              ) : null}
            </Text>
            <Icon name="chevron-down" size={13} color={Colors.textSecondary} />
          </TouchableOpacity>

          <View style={{ flex: 1 }} />

          <View style={[styles.headerChangePill, { borderColor: priceColor }]}>
            <Text style={[styles.headerChangeTxt, { color: priceColor }]}>
              {formatPercent(changePct)}
            </Text>
          </View>
        </View>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.navStatsScroll}
          contentContainerStyle={styles.navStatsContent}
        >
          <HeaderStat label="24h High" value={high24h > 0 ? formatPrice(high24h) : '—'} valueColor={LayoutColors.marketUp} />
          <HeaderStat label="24h Low" value={low24h > 0 ? formatPrice(low24h) : '—'} valueColor={LayoutColors.marketDown} />
          <HeaderStat label={`Vol (${baseAsset})`} value={volBase} />
          <HeaderStat label={`Vol (${quoteAsset})`} value={volQuote} />
        </ScrollView>
      </View>

      {/* ── Single scrollable body — chart + depth scroll together ── */}
      <View style={styles.bodyWrap}>
      <ScrollView
        ref={scrollRef}
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        scrollEnabled={pageScrollEnabled}
        nestedScrollEnabled
        {...iosManualKeyboardScrollProps()}
      >
        <View style={styles.screenInset}>

        {/* Price strip */}
        <View style={styles.priceSection}>
          <Text style={[styles.mainPrice, { color: priceColor }]}>
            {price > 0 ? formatPrice(price) : '—'}
          </Text>
          <View style={styles.priceMetaRow}>
            <Text style={styles.usdApprox}>
              {price > 0 ? fmtQuoteApprox(price, quoteAsset) : `— ${quoteAsset}`}
            </Text>
            <Text style={[styles.pctBadge, { color: priceColor }]}>
              {formatPercent(changePct)}
            </Text>
          </View>
          <View style={styles.fairRow}>
            <View style={styles.fairLeft}>
              <Text style={styles.fairLabel}>Fair Price</Text>
              <Text style={styles.fairValue}>
                {fairPrice > 0 ? formatPrice(fairPrice) : '—'}
              </Text>
            </View>
            {marketType === 'futures' && routeLeverage > 0 ? (
              <View style={styles.marketTagPill}>
                <Text style={styles.marketTagPillText}>{routeLeverage}X</Text>
              </View>
            ) : null}
          </View>
        </View>

        {/* Mini chart — same preview as Trade / Futures trade screens */}
        <View style={[styles.chartSection, !chartExpanded && styles.chartSectionCollapsed]}>
          {chartExpanded ? (
            <>
              <ChartPreviewCard
                symbol={klineSym}
                height={TRADE_CHART_PANEL_H}
                width={CONTENT_W}
                livePrice={price > 0 ? price : undefined}
                seedKlines={candleSeed.length ? candleSeed : undefined}
                compactIntervals
                onLockParentScroll={handleChartScrollLock}
              />
              <FuturesChartToggleBar
                title={chartToggleTitle}
                expanded={chartExpanded}
                placement="bottom"
                onToggle={toggleChartExpanded}
                onExpand={() => openFullscreenChart('1h')}
              />
            </>
          ) : (
            <FuturesChartToggleBar
              title={chartToggleTitle}
              expanded={chartExpanded}
              onToggle={toggleChartExpanded}
              onExpand={() => openFullscreenChart('1h')}
            />
          )}
          {tradeCtaBlock}
        </View>

        </View>{/* end screenInset */}

        {/* ── Below-chart sections keep the same horizontal inset ── */}
        {/* ── Cumulative order-book depth (buy / sell areas) ── */}
        <View style={[styles.depthWrap, styles.hPad]}>
          <ChartDepthPanel
            orderBook={orderBook}
            currentPrice={price > 0 ? price : undefined}
            width={CONTENT_W}
            height={DEPTH_PANEL_H}
            loading={!bookHasDepth}
          />
        </View>

        {/* ── Depth / Trades tab row ── */}
        <View style={[styles.bookTabRow, styles.hPad]}>
          {(['depth', 'trades'] as DepthTab[]).map((tab) => (
            <TouchableOpacity
              key={tab}
              style={[styles.bookTab, depthTab === tab && styles.bookTabActive]}
              onPress={() => setDepthTab(tab)}
              activeOpacity={0.8}
            >
              <Text style={[styles.bookTabText, depthTab === tab && styles.bookTabTextActive]}>
                {tab === 'depth' ? 'Depth' : 'Trades'}
              </Text>
            </TouchableOpacity>
          ))}
          <View style={{ flex: 1 }} />
        </View>

        {depthTab === 'depth' && (
          <View style={[styles.bookWebView, styles.hPad]}>
            <OrderBookDepthList
              orderBook={orderBook}
              currentPrice={price > 0 ? price : undefined}
              fairPrice={fairPrice > 0 ? fairPrice : undefined}
              height={BOOK_LIST_INNER_H}
              maxRows={10}
              priceUp={positive}
              loading={!bookHasDepth}
            />
          </View>
        )}

        {depthTab === 'trades' && (
          <View style={[styles.tradesPanel, styles.hPad]}>
            <View style={styles.tradesHeader}>
              <Text style={styles.tradesHdrText}>Price</Text>
              <Text style={[styles.tradesHdrText, styles.tradesHdrRight]}>Amount</Text>
              <Text style={[styles.tradesHdrText, styles.tradesHdrRight]}>Time</Text>
            </View>
            {tradesLoading && recentTrades.length === 0 ? (
              <View style={styles.tradesPlaceholder}>
                <Text style={styles.tradesPlaceholderText}>Loading trades…</Text>
              </View>
            ) : recentTrades.length === 0 ? (
              <View style={styles.tradesPlaceholder}>
                <Icon name="swap-horizontal" size={32} color={Colors.textDisabled} />
                <Text style={styles.tradesPlaceholderText}>No recent trades</Text>
              </View>
            ) : (
              recentTrades.map((t) => {
                const sideColor = t.buy ? LayoutColors.marketUp : LayoutColors.marketDown;
                const d = new Date(t.timeMs);
                const timeStr = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
                return (
                  <View key={t.id} style={styles.tradeRow}>
                    <Text style={[styles.tradePrice, { color: sideColor }]} numberOfLines={1}>
                      {formatPrice(t.price)}
                    </Text>
                    <Text style={[styles.tradeAmt, styles.tradesHdrRight]} numberOfLines={1}>
                      {formatAmount(t.qty, 4)}
                    </Text>
                    <Text style={[styles.tradeTime, styles.tradesHdrRight]} numberOfLines={1}>
                      {timeStr}
                    </Text>
                  </View>
                );
              })
            )}
          </View>
        )}

      </ScrollView>
      </View>{/* end bodyWrap */}

      <ChartTradeSheet
        open={sheetOpen}
        symbol={rawSymbol}
        market={marketType}
        side={tradeSheetSide ?? 'buy'}
        leverage={routeLeverage}
        onClose={closeTradeSheet}
        onSideChange={setTradeSheetSide}
        onLockParentScroll={handleChartScrollLock}
      />
    </SafeAreaWrapper>
  );
}

/* ── Sub-component: compact header stat chip ── */
function HeaderStat({
  label, value, valueColor,
}: {
  label: string;
  value: string;
  valueColor?: string;
}) {
  return (
    <View style={styles.headerStatChip}>
      <Text style={styles.headerStatLabel}>{label}</Text>
      <Text style={[styles.headerStatValue, valueColor ? { color: valueColor } : null]} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

/* ── Styles ── */
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.surfaceCard },
  bodyWrap: {
    flex: 1,
    backgroundColor: Colors.surface,
  },
  screenInset: {
    /* not flex:1 — it is a scroll child, grows with content */
    paddingHorizontal: SCREEN_H_PAD,
    backgroundColor: Colors.surface,
  },
  scroll: { flex: 1, backgroundColor: Colors.surface },
  scrollContent: {
    paddingBottom: Spacing[6],
    backgroundColor: Colors.surface,
  },
  hPad: { paddingHorizontal: SCREEN_H_PAD },

  navHeader: {
    backgroundColor: Colors.surfaceCard,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.surfaceBorder,
  },
  /* Nav header */
  navBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing[3],
    paddingTop: Spacing[2],
    paddingBottom: Spacing[1],
    gap: 4,
  },
  navBack: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pairBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  pairLabel: {
    fontFamily: FontFamily.bold,
    fontSize: FontSize.lg,
    color: Colors.textPrimary,
  },
  pairMarketTag: {
    fontFamily: FontFamily.medium,
    fontSize: FontSize.xs,
    color: Colors.textMuted,
  },
  headerChangePill: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: Radius.sm,
    borderWidth: 1,
    backgroundColor: Colors.surfaceHover,
  },
  headerChangeTxt: {
    fontFamily: FontFamily.monoMedium,
    fontSize: FontSize.xs,
  },
  navStatsScroll: {
    flexGrow: 0,
  },
  navStatsContent: {
    paddingHorizontal: Spacing[3],
    paddingBottom: Spacing[2],
    gap: Spacing[2],
  },
  headerStatChip: {
    paddingHorizontal: Spacing[2],
    paddingVertical: 4,
    borderRadius: Radius.md,
    backgroundColor: Colors.surfaceHover,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    minWidth: 88,
  },
  headerStatLabel: {
    fontFamily: FontFamily.regular,
    fontSize: 9,
    color: Colors.tabInactive,
    marginBottom: 2,
  },
  headerStatValue: {
    fontFamily: FontFamily.monoMedium,
    fontSize: FontSize.xs,
    color: Colors.textSecondary,
  },

  /* Price strip — compact reference layout */
  priceSection: {
    paddingTop: Spacing[2],
    paddingBottom: Spacing[2],
    backgroundColor: Colors.surface,
    gap: 2,
  },
  mainPrice: {
    fontFamily: FontFamily.bold,
    fontSize: 32,
    letterSpacing: -0.3,
    lineHeight: 36,
  },
  priceMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing[2],
  },
  usdApprox: {
    fontFamily: FontFamily.mono,
    fontSize: FontSize.sm,
    color: Colors.textPrimary,
  },
  pctBadge: {
    fontFamily: FontFamily.monoMedium,
    fontSize: FontSize.sm,
  },
  fairRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 2,
  },
  fairLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing[2],
    flex: 1,
  },
  fairLabel: {
    fontFamily: FontFamily.regular,
    fontSize: FontSize.xs,
    color: Colors.textMuted,
    textDecorationLine: 'underline',
    textDecorationStyle: 'dotted',
  },
  fairValue: {
    fontFamily: FontFamily.monoMedium,
    fontSize: FontSize.sm,
    color: Colors.textPrimary,
  },
  marketTagPill: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: Radius.sm,
    backgroundColor: 'rgba(14,203,129,0.14)',
    borderWidth: 1,
    borderColor: 'rgba(14,203,129,0.35)',
  },
  marketTagPillText: {
    fontFamily: FontFamily.semiBold,
    fontSize: 11,
    color: LayoutColors.marketUp,
  },

  /* Mini chart preview */
  chartSection: {
    backgroundColor: Colors.surface,
    paddingTop: Spacing[1],
    paddingBottom: Spacing[1],
  },
  chartSectionCollapsed: {
    paddingTop: 0,
    paddingBottom: 0,
  },

  /* Depth line chart */
  depthWrap: {
    backgroundColor: Colors.surface,
    paddingTop: Spacing[3],
    paddingBottom: Spacing[4],
  },

  /* Book tabs */
  bookTabRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.surfaceBorder,
    backgroundColor: Colors.surface,
    marginTop: Spacing[2],
  },
  bookTab: {
    paddingVertical: Spacing[4],
    paddingHorizontal: Spacing[4],
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  bookTabActive: {
    borderBottomColor: Colors.gold,
  },
  bookTabText: {
    fontFamily: FontFamily.medium,
    fontSize: FontSize.sm,
    color: Colors.textMuted,
  },
  bookTabTextActive: {
    color: Colors.goldLight,
    fontFamily: FontFamily.semiBold,
  },

  bookWebView: {
    height: BOOK_WEBVIEW_H,
    overflow: 'hidden',
    paddingTop: Spacing[3],
    paddingBottom: Spacing[4],
    backgroundColor: Colors.surface,
  },

  tradesPanel: {
    backgroundColor: Colors.surface,
    paddingTop: Spacing[2],
    paddingBottom: Spacing[6],
    minHeight: BOOK_WEBVIEW_H,
  },
  tradesHeader: {
    flexDirection: 'row',
    paddingVertical: Spacing[3],
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.surfaceBorder,
  },
  tradesHdrText: {
    flex: 1,
    fontFamily: FontFamily.medium,
    fontSize: 10,
    color: Colors.tabInactive,
  },
  tradesHdrRight: {
    textAlign: 'right',
  },
  tradeRow: {
    flexDirection: 'row',
    paddingVertical: 7,
    minHeight: BOOK_ROW_H,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.surfaceBorder,
  },
  tradePrice: {
    flex: 1,
    fontFamily: FontFamily.monoMedium,
    fontSize: FontSize.xs,
  },
  tradeAmt: {
    flex: 1,
    fontFamily: FontFamily.mono,
    fontSize: FontSize.xs,
    color: Colors.textSecondary,
  },
  tradeTime: {
    flex: 1,
    fontFamily: FontFamily.mono,
    fontSize: FontSize.xs,
    color: Colors.textMuted,
  },
  tradesPlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: Spacing[12],
    gap: Spacing[3],
    backgroundColor: Colors.surface,
  },
  tradesPlaceholderText: {
    fontFamily: FontFamily.regular,
    fontSize: FontSize.sm,
    color: Colors.textDisabled,
  },

  tradeCtaRow: {
    flexDirection: 'row',
    gap: Spacing[2],
    marginTop: Spacing[3],
    marginBottom: Spacing[1],
  },
  tradeCtaBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: Radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tradeCtaBuy: {
    backgroundColor: LayoutColors.marketUp,
  },
  tradeCtaSell: {
    backgroundColor: LayoutColors.marketDown,
  },
  tradeCtaBuyText: {
    fontFamily: FontFamily.bold,
    fontSize: FontSize.base,
    color: Colors.white,
    letterSpacing: 0.3,
  },
  tradeCtaSellText: {
    fontFamily: FontFamily.bold,
    fontSize: FontSize.base,
    color: Colors.white,
    letterSpacing: 0.3,
  },

});
