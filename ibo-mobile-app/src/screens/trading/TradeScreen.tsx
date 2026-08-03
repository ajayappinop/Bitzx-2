/**
 * TradeScreen — spot trading terminal (Binance-style layout)
 *
 * Header → chart (same engine as Chart page) → scroll: form + book → data tabs.
 * Pair change: tap header → pair picker. Spot-only (no market tabs).
 */
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  Alert, LayoutChangeEvent, Dimensions,
} from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import { useDispatch, useSelector } from 'react-redux';
import { useFocusEffect } from '@react-navigation/native';
import { useSpotOrderBookFeed } from '../../hooks/useOrderBookFeed';
import { useSpotTickerFeed } from '../../hooks/useTickerFeed';
import { AppDispatch, RootState } from '../../store';
import { cancelOrderThunk, fetchOrdersThunk, selectSessionTrading } from '../../store/trading.slice';
import { fetchWalletThunk, selectSessionWallet } from '../../store/wallet.slice';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { TradingStackParamList } from '../../navigation/types';
import { Ticker } from '../../types/market.types';
import { Order } from '../../types/trading.types';
import Icon from '@/components/common/AppIcon';
import SafeAreaWrapper from '../../components/common/SafeAreaWrapper';
import TradeMarketHeader from '../../components/trading/TradeMarketHeader';
import ChartPreviewCard from '../../components/trading/ChartPreviewCard';
import FuturesChartToggleBar from '../../components/futures/FuturesChartToggleBar';
import TradeTerminalScrollLayout from '../../components/trading/TradeTerminalScrollLayout';
import type { ChartInterval } from '../../components/trading/chartIntervals';
import { TRADE_CHART_PANEL_H } from '../../components/trading/chartIntervals';
import TerminalOrderBook from '../../components/futures/FuturesTerminalOrderBook';
import TradeFormTerminal from '../../components/trading/TradeFormTerminal';
import TradeTerminalPane from '../../components/trading/TradeTerminalPane';
import StatusBadge from '../../components/common/StatusBadge';
import { Colors, FontFamily, FontSize, Spacing, Radius } from '../../theme';
import { SpotUi } from '../../theme/spotTerminal';
import { computeTerminalBookRows } from '../../theme/tradeTerminal';
import { useTradeLayoutHeights } from '../../hooks/useTradeLayoutHeights';
import {
  formatPrice, isPositive, formatDateTime, formatAmount,
} from '../../utils/formatters';
import { toExchangeSymbol } from '../../utils/tradeSymbols';
import {
  buildOrderRealizedPnlMap,
  pairLabelFromSymbol,
  resolveOrderId,
  spotPositionHasCostBasis,
} from '../../utils/spotTrading';
import {
  readChartTicker,
  resolveChartTicker,
} from '../../utils/chartPageCache';
import { setCachedOrderBook, orderBookHasDepth } from '../../utils/orderBookCache';
import { prefetchChartPageData } from '../../services/chartPagePrefetch.service';
import { instantChartKlines } from '../../utils/chartPageBootstrap';
import type { OrderBook as OrderBookType } from '../../types/market.types';

const { width: SCREEN_W } = Dimensions.get('window');

type RouteParams = { symbol: string; market?: 'spot' | 'futures' | 'options' };
type Props = {
  navigation: NativeStackNavigationProp<TradingStackParamList, any>;
  route: { params: RouteParams };
};

type DataTab  = 'orders' | 'holdings' | 'history';

const SCREEN_H_PAD = Spacing[3];

type TradeOrderBookPaneProps = {
  orderBook: OrderBookType;
  price: number;
  bookRows: number;
  bookHasDepth: boolean;
  positive: boolean;
  footer: React.ReactNode;
  onPriceClick: (p: string) => void;
};

const TradeOrderBookPane = React.memo(function TradeOrderBookPane({
  orderBook,
  price,
  bookRows,
  bookHasDepth,
  positive,
  footer,
  onPriceClick,
}: TradeOrderBookPaneProps) {
  return (
    <TradeTerminalPane style={styles.bookPane} footer={footer}>
      <TerminalOrderBook
        orderBook={orderBook}
        currentPrice={price}
        variant="terminal"
        maxRows={bookRows}
        priceUp={positive}
        loading={!bookHasDepth}
        onPriceClick={onPriceClick}
        hideDepthFooter
        longColor={SpotUi.long}
        longDim={SpotUi.longDim}
      />
    </TradeTerminalPane>
  );
});

function tickerHasPrice(t: Ticker | null | undefined): boolean {
  const p = Number(t?.price ?? 0);
  return Number.isFinite(p) && p > 0;
}

export default function TradeScreen({ route, navigation }: Props) {
  const { symbol: rawSymbol, side: routeSide } = route.params;
  const sym = useMemo(() => toExchangeSymbol(rawSymbol), [rawSymbol]);
  const dispatch = useDispatch<AppDispatch>();
  const formSide = routeSide === 'buy' || routeSide === 'sell' ? routeSide : undefined;

  const { ticker: feedTicker, loading: feedLoading } = useSpotTickerFeed(sym);
  const [ticker,       setTicker]       = useState<Ticker | null>(null);
  const { orderBook, hasDepth: bookHasDepth } = useSpotOrderBookFeed(sym);
  const [dataTab,      setDataTab]      = useState<DataTab>('orders');
  const [priceSeed,    setPriceSeed]    = useState<string | undefined>(undefined);
  const [quoteLoading, setQuoteLoading] = useState(true);
  const [hideOtherPairs, setHideOtherPairs] = useState(false);
  const [layoutTerminalH, setLayoutTerminalH] = useState(0);
  const [sliderScrollLocked, setSliderScrollLocked] = useState(false);
  const [chartExpanded, setChartExpanded] = useState(true);
  const { assets: walletAssets } = useSelector(selectSessionWallet);
  const user           = useSelector((s: RootState) => s.auth.user);
  const marketRow      = useSelector((s: RootState) => s.market.markets[sym] ?? null);

  // Orders/positions are kept live by the account WebSocket (useAccountWs in MainTabNavigator)
  const {
    openOrders,
    orderHistory,
    trades,
    livePositions: positions,
  } = useSelector(selectSessionTrading);
  const orderPnlById = useMemo(() => buildOrderRealizedPnlMap(trades), [trades]);

  useEffect(() => {
    setPriceSeed(undefined);
    setLayoutTerminalH(0);

    const cached = readChartTicker(sym);
    const seeded = cached ?? resolveChartTicker(sym, marketRow);
    if (seeded && tickerHasPrice(seeded)) {
      setTicker(seeded);
      setQuoteLoading(false);
    } else {
      setTicker(null);
      setQuoteLoading(true);
    }
  }, [sym, rawSymbol, marketRow]);

  useEffect(() => {
    prefetchChartPageData(rawSymbol, 'spot');
  }, [rawSymbol]);

  /** When Redux markets arrive after mount, seed 24h stats without waiting for REST. */
  useEffect(() => {
    if (tickerHasPrice(ticker) || !marketRow) return;
    const resolved = resolveChartTicker(sym, marketRow);
    if (resolved && tickerHasPrice(resolved)) {
      setTicker(resolved);
      setQuoteLoading(false);
    }
  }, [marketRow, sym, ticker]);

  useEffect(() => {
    if (feedTicker && tickerHasPrice(feedTicker)) {
      setTicker(feedTicker);
      setQuoteLoading(false);
    } else if (!feedLoading) {
      setQuoteLoading(false);
    }
  }, [feedTicker, feedLoading]);

  /** On focus, do a lightweight orders refresh if the slice data is stale. */
  useFocusEffect(
    useCallback(() => {
      dispatch(fetchOrdersThunk());
      if (user) dispatch(fetchWalletThunk());
      prefetchChartPageData(rawSymbol, 'spot');
    }, [dispatch, user, rawSymbol]),
  );

  const handleCancelOrder = (orderId: string) => {
    Alert.alert(
      'Cancel Order',
      'Are you sure you want to cancel this order?',
      [
        { text: 'No', style: 'cancel' },
        {
          text: 'Yes, Cancel',
          style: 'destructive',
          onPress: async () => {
            const result = await dispatch(cancelOrderThunk(orderId));
            if (cancelOrderThunk.rejected.match(result)) {
              Alert.alert('Cancel failed', String(result.payload ?? 'Unknown error'));
            } else {
              dispatch(fetchOrdersThunk());
              dispatch(fetchWalletThunk());
            }
          },
        },
      ],
    );
  };

  const handlePriceClick = useCallback((p: string) => {
    setPriceSeed(p);
  }, []);

  const handleOrderPlaced = useCallback(() => {
    dispatch(fetchOrdersThunk());
    dispatch(fetchWalletThunk());
    setPriceSeed(undefined);
  }, [dispatch]);

  const topAsk = useMemo(() => {
    const sorted = (orderBook.asks ?? []).slice().sort((a, b) => parseFloat(String(a.price)) - parseFloat(String(b.price)));
    const v = sorted[0] ? parseFloat(String(sorted[0].price)) : null;
    return Number.isFinite(v) ? v : null;
  }, [orderBook.asks]);

  const topBid = useMemo(() => {
    const sorted = (orderBook.bids ?? []).slice().sort((a, b) => parseFloat(String(b.price)) - parseFloat(String(a.price)));
    const v = sorted[0] ? parseFloat(String(sorted[0].price)) : null;
    return Number.isFinite(v) ? v : null;
  }, [orderBook.bids]);

  const price = quoteLoading && !tickerHasPrice(ticker) ? 0 : Number(ticker?.price ?? 0);
  const positive = quoteLoading && !tickerHasPrice(ticker) ? true : isPositive(ticker?.changePct ?? 0);
  const statsLoading = quoteLoading && !tickerHasPrice(ticker);
  const availUsdt = parseFloat(String(walletAssets.find(a => a.asset === 'USDT')?.available_balance ?? 0));
  const pairDisplay = rawSymbol.includes('/')
    ? rawSymbol
    : rawSymbol.replace(/USDT$/, '/USDT').replace(/BTC$/, '/BTC').replace(/ETH$/, '/ETH') || rawSymbol;

  const navigateToChart = useCallback(() => {
    if (orderBookHasDepth(orderBook)) {
      setCachedOrderBook(sym, orderBook);
    }
    prefetchChartPageData(rawSymbol, 'spot');
    navigation.navigate('SpotChart', {
      symbol: rawSymbol,
      market: 'spot',
      seedTicker: (ticker ?? undefined) as Record<string, unknown> | undefined,
      seedOrderBook: orderBookHasDepth(orderBook) ? orderBook : undefined,
    });
  }, [navigation, rawSymbol, sym, ticker, orderBook]);

  const contentWidth = SCREEN_W - SCREEN_H_PAD * 2;
  const candleSeed = useMemo(() => instantChartKlines(sym), [sym]);

  const toggleChartExpanded = useCallback(() => {
    setChartExpanded((prev) => !prev);
  }, []);

  const openFullscreenChart = useCallback((interval: ChartInterval) => {
    navigation.push('FullChartView', {
      symbol: rawSymbol,
      market: 'spot',
      interval,
      livePrice: price > 0 ? price : undefined,
    });
  }, [navigation, rawSymbol, price]);

  const { terminalHeight } = useTradeLayoutHeights(SpotUi.terminalHeightRatio);

  const handleTerminalRowLayout = useCallback((e: LayoutChangeEvent) => {
    const h = Math.ceil(e.nativeEvent.layout.height);
    if (h <= 0) return;
    const next = Math.max(terminalHeight, h);
    setLayoutTerminalH(prev => (Math.abs(prev - next) >= 2 ? next : prev));
  }, [terminalHeight]);

  const effectiveTerminalH = Math.max(terminalHeight, layoutTerminalH);
  /* Pass externalFooter=true so row budget matches the sentiment bar footer. */
  const bookRows = useMemo(
    () => computeTerminalBookRows(effectiveTerminalH, true),
    [effectiveTerminalH],
  );

  const filteredOpenOrders = useMemo(
    () => (hideOtherPairs ? openOrders.filter(o => toExchangeSymbol(o.symbol) === sym) : openOrders),
    [hideOtherPairs, openOrders, sym],
  );
  const filteredPositions = useMemo(
    () => (hideOtherPairs ? positions.filter(p => toExchangeSymbol((p as any).symbol ?? '') === sym) : positions),
    [hideOtherPairs, positions, sym],
  );
  const filteredOrderHistory = useMemo(
    () => (hideOtherPairs ? orderHistory.filter(o => toExchangeSymbol(o.symbol) === sym) : orderHistory),
    [hideOtherPairs, orderHistory, sym],
  );

  /* B% / S% sentiment bar shown in the book-pane footer (mirrors futures). */
  const bookFooter = useMemo(() => {
    const bidVol = (orderBook.bids ?? []).reduce(
      (s, r) => s + parseFloat(String(r.amount ?? 0)), 0,
    );
    const askVol = (orderBook.asks ?? []).reduce(
      (s, r) => s + parseFloat(String(r.amount ?? 0)), 0,
    );
    const total = bidVol + askVol;
    const bPct  = total > 0 ? Math.round((bidVol / total) * 100) : 50;
    const sPct  = 100 - bPct;
    return (
      <View style={styles.sentimentWrap}>
        <View key="bid-bar" style={[styles.sentimentBar, { flex: bPct }]} />
        <View key="ask-bar" style={[styles.sentimentBarSell, { flex: sPct }]} />
        <View style={styles.sentimentLabels}>
          <Text style={styles.sentimentBuy}>B {bPct}%</Text>
          <Text style={styles.sentimentSell}>S {sPct}%</Text>
        </View>
      </View>
    );
  }, [orderBook.bids, orderBook.asks]);

  const dataTabs = ([
    { key: 'orders' as DataTab, label: 'Open Orders', count: filteredOpenOrders.length },
    { key: 'holdings' as DataTab, label: 'Holdings', count: filteredPositions.length },
    { key: 'history' as DataTab, label: 'History', count: filteredOrderHistory.length },
  ]);

  const high24h = Number((ticker as any)?.high ?? 0);
  const low24h  = Number((ticker as any)?.low  ?? 0);

  const headerStats = useMemo(() => {
    const placeholder = [
      { label: '24h High', value: '—', valueColor: Colors.buyGreen },
      { label: '24h Low',  value: '—', valueColor: Colors.sellRed },
      { label: 'Vol',      value: '—' },
      { label: 'Vol(USDT)', value: '—' },
    ];
    if (statsLoading) return placeholder;
    const vol = Number(ticker?.volume ?? 0);
    const fmtVol = (v: number) => {
      if (!Number.isFinite(v) || v <= 0) return '—';
      if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(3)}M`;
      if (v >= 1_000) return `${(v / 1_000).toFixed(3)}K`;
      return v.toFixed(2);
    };
    return [
      { label: '24h High', value: high24h > 0 ? formatPrice(high24h) : '—', valueColor: Colors.buyGreen },
      { label: '24h Low',  value: low24h  > 0 ? formatPrice(low24h)  : '—', valueColor: Colors.sellRed },
      { label: 'Vol',      value: fmtVol(vol) },
      { label: 'Vol(USDT)', value: price > 0 ? fmtVol(vol * price) : '—' },
    ];
  }, [statsLoading, high24h, low24h, ticker?.volume, price]);

  const goLogin = useCallback(
    () => navigation.navigate('Auth' as any, { screen: 'Login' }),
    [navigation],
  );

  const dataPanelContent = useMemo(() => {
    if (!user) {
      return <GuestPromo onLogin={goLogin} />;
    }

    switch (dataTab) {
      case 'orders':
        if (filteredOpenOrders.length === 0) {
          return (
            <>
              {availUsdt < 0.01 ? (
                <View style={styles.fundsHint}>
                  <Text style={styles.fundsEmptySub}>
                    Available: {availUsdt.toFixed(2)} USDT — deposit to buy, or sell existing holdings
                  </Text>
                  <TouchableOpacity
                    style={styles.addFundsBtn}
                    onPress={() => (navigation as any).navigate('Wallet', { screen: 'Deposit' })}
                    activeOpacity={0.85}
                  >
                    <Text style={styles.addFundsTxt}>Add Funds</Text>
                  </TouchableOpacity>
                </View>
              ) : null}
              <EmptyState label={`No open orders for ${pairDisplay}`} />
            </>
          );
        }
        return (
          <>
            {filteredOpenOrders.map((o, i) => (
              <OrderRow
                key={o.order_id ?? (o as { id?: string }).id ?? `open-${i}`}
                order={o}
                onCancel={handleCancelOrder}
              />
            ))}
          </>
        );

      case 'history':
        if (filteredOrderHistory.length === 0) {
          return <EmptyState label="No order history yet" />;
        }
        return (
          <>
            {filteredOrderHistory.map((o, i) => {
              const isBuy   = o.side === 'buy';
              const filled  = o.filled_amount ?? (o as any).filled ?? 0;
              const total   = o.amount ?? 0;
              const pctFill = total > 0 ? Math.round((filled / total) * 100) : 0;
              const oid     = resolveOrderId(o);
              const pnl     = orderPnlById.get(oid) ?? (o as any).realized_pnl;
              const symLbl  = pairLabelFromSymbol(o.symbol);
              const metaItems = [
                {
                  label: 'Avg. Fill',
                  value: o.avg_fill_price ? formatPrice(o.avg_fill_price) : (o.price ? formatPrice(o.price) : 'Market'),
                },
                {
                  label: 'Executed',
                  value: `${formatAmount(filled, 4)} / ${formatAmount(total, 4)} (${pctFill}%)`,
                },
                ...(pnl != null
                  ? [{ label: 'Realized P&L', value: `${pnl >= 0 ? '+' : ''}${Number(pnl).toFixed(4)} USDT` }]
                  : []),
              ];
              return (
                <View
                  key={o.order_id ?? (o as { id?: string }).id ?? `history-${i}`}
                  style={oStyles.card}
                >
                  <View style={oStyles.top}>
                    <Text style={[oStyles.sideText, { color: Colors.textSecondary, marginRight: Spacing[2] }]}>
                      {symLbl}
                    </Text>
                    <View style={[oStyles.sidePill, { backgroundColor: isBuy ? Colors.buyGreenDim : Colors.sellRedDim }]}>
                      <Text style={[oStyles.sideText, { color: isBuy ? Colors.buyGreen : Colors.sellRed }]}>
                        {o.side.toUpperCase()}
                      </Text>
                    </View>
                    <Text style={oStyles.type}>{o.type.toUpperCase()}</Text>
                    <View style={{ flex: 1 }} />
                    <StatusBadge status={o.status} />
                  </View>
                  <View style={oStyles.meta}>
                    {metaItems.map((item) => (
                      <OrderMeta key={item.label} label={item.label} value={item.value} />
                    ))}
                  </View>
                  <Text style={oStyles.date}>{formatDateTime(o.created_at)}</Text>
                </View>
              );
            })}
          </>
        );

      case 'holdings':
        if (filteredPositions.length === 0) {
          return <EmptyState label="No spot holdings yet" />;
        }
        return (
          <>
            {filteredPositions.map((pos, i) => {
              const posSym   = (pos as any).symbol ?? '';
              const base       = posSym.replace(/USDT$/, '').replace(/\/USDT$/, '');
              const size       = Number((pos as any).amount ?? (pos as any).size ?? 0);
              const avail      = Number((pos as any).available ?? size);
              const avgBuy     = Number(
                pos.avg_entry_price ?? (pos as any).avg_buy_price ?? (pos as any).avg_cost ?? 0,
              );
              const hasCost    = spotPositionHasCostBasis(pos as any);
              const mark       = Number((pos as any).current_price ?? 0);
              const value      = mark > 0 ? mark * size : (hasCost ? avgBuy * size : 0);
              const unrealPnl  = hasCost ? Number(pos.unrealized_pnl ?? (mark > 0 && avgBuy > 0 ? (mark - avgBuy) * size : 0)) : 0;
              const pnlPct     = hasCost && avgBuy > 0 && mark > 0 ? ((mark - avgBuy) / avgBuy) * 100 : 0;
              const pnlPos     = unrealPnl >= 0;
              const metaItems = [
                { label: 'Size', value: `${formatAmount(size, 6)} ${base}` },
                { label: 'Available', value: `${formatAmount(avail, 6)} ${base}` },
                { label: 'Avg. Buy', value: hasCost && avgBuy > 0 ? formatPrice(avgBuy) : '—' },
                { label: 'Mark', value: mark > 0 ? formatPrice(mark) : '—' },
                { label: 'Value', value: value > 0 ? `$${value.toFixed(2)}` : '—' },
                ...(hasCost && pnlPct !== 0
                  ? [{ label: 'P&L %', value: `${pnlPos ? '+' : ''}${pnlPct.toFixed(2)}%` }]
                  : []),
              ];
              return (
                <View key={posSym || `pos-${i}`} style={oStyles.card}>
                  <View style={oStyles.top}>
                    <Text style={[oStyles.sideText, { color: Colors.textPrimary, fontSize: FontSize.sm }]}>{base}</Text>
                    <View style={{ flex: 1 }} />
                    <Text style={[oStyles.type, { color: hasCost && unrealPnl !== 0 ? (pnlPos ? Colors.buyGreen : Colors.sellRed) : Colors.textMuted }]}>
                      {hasCost && unrealPnl !== 0 ? `${pnlPos ? '+' : ''}${unrealPnl.toFixed(4)} USDT` : '—'}
                    </Text>
                  </View>
                  <View style={oStyles.meta}>
                    {metaItems.map((item) => (
                      <OrderMeta key={item.label} label={item.label} value={item.value} />
                    ))}
                  </View>
                </View>
              );
            })}
          </>
        );

      default:
        return null;
    }
  }, [
    user,
    goLogin,
    dataTab,
    availUsdt,
    navigation,
    orderPnlById,
    filteredOpenOrders,
    pairDisplay,
    handleCancelOrder,
    filteredOrderHistory,
    filteredPositions,
  ]);

  return (
    <SafeAreaWrapper style={styles.screen}>
      <View style={styles.headerBleed}>
        <TradeMarketHeader
          symbol={rawSymbol}
          price={price > 0 ? price : undefined}
          changePct={!statsLoading && ticker != null ? Number(ticker.changePct) : undefined}
          stats={headerStats}
          mode="none"
          onChartPress={navigateToChart}
        />
      </View>

      <View style={styles.screenInset}>
        <TradeTerminalScrollLayout
          chart={(
            <View style={[styles.chartSection, !chartExpanded && styles.chartSectionCollapsed]}>
              {chartExpanded ? (
                <>
                  <ChartPreviewCard
                    symbol={sym}
                    height={TRADE_CHART_PANEL_H}
                    width={contentWidth}
                    livePrice={price > 0 ? price : undefined}
                    seedKlines={candleSeed.length ? candleSeed : undefined}
                    compactIntervals
                    onLockParentScroll={setSliderScrollLocked}
                  />
                  <FuturesChartToggleBar
                    title={`${pairDisplay} Chart`}
                    expanded={chartExpanded}
                    placement="bottom"
                    onToggle={toggleChartExpanded}
                    onExpand={() => openFullscreenChart('1h')}
                  />
                </>
              ) : (
                <FuturesChartToggleBar
                  title={`${pairDisplay} Chart`}
                  expanded={chartExpanded}
                  onToggle={toggleChartExpanded}
                  onExpand={() => openFullscreenChart('1h')}
                />
              )}
            </View>
          )}
          chartResetKey={chartExpanded ? 'open' : 'closed'}
          scrollEnabled={!sliderScrollLocked}
          style={styles.bodyScroll}
          contentContainerStyle={styles.bodyScrollContent}
        >
        <View style={[styles.terminalBlock, { minHeight: terminalHeight }]}>
          <View style={styles.terminalRow} onLayout={handleTerminalRowLayout}>
            <TradeOrderBookPane
              orderBook={orderBook}
              price={price}
              bookRows={bookRows}
              bookHasDepth={bookHasDepth}
              positive={positive}
              footer={bookFooter}
              onPriceClick={handlePriceClick}
            />
            <View style={styles.formPane} collapsable={false}>
              <TradeFormTerminal
                symbol={sym}
                priceSeed={priceSeed}
                quoteLoading={statsLoading}
                onOrderPlaced={handleOrderPlaced}
                onLockParentScroll={setSliderScrollLocked}
                initialSide={formSide}
              />
            </View>
          </View>
        </View>

        <View style={styles.dataPanel}>
          <View style={styles.dataTabBar}>
            {dataTabs.map(({ key, label, count }) => (
              <TouchableOpacity
                key={key}
                style={[styles.dataTabBtn, dataTab === key && styles.dataTabBtnActive]}
                onPress={() => setDataTab(key)}
                activeOpacity={0.8}
              >
                <Text style={[styles.dataTabTxt, dataTab === key && styles.dataTabTxtActive]}>
                  {label}({count})
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <TouchableOpacity
            style={styles.hideOtherPairsRow}
            activeOpacity={0.8}
            onPress={() => setHideOtherPairs(v => !v)}
          >
            <View style={[styles.hideOtherPairsBox, hideOtherPairs && styles.hideOtherPairsBoxOn]}>
              {hideOtherPairs ? <Icon name="check" size={9} color={SpotUi.long} /> : null}
            </View>
            <Text style={styles.hideOtherPairsTxt}>Hide other pairs</Text>
          </TouchableOpacity>

          <View style={styles.dataBlockBody}>
            {dataPanelContent}
          </View>
        </View>
        </TradeTerminalScrollLayout>
      </View>
    </SafeAreaWrapper>
  );
}

function OrderRow({ order, onCancel }: { order: Order; onCancel: (id: string) => void }) {
  const isBuy     = order.side === 'buy';
  const canCancel = order.status === 'open' || order.status === 'partially_filled';
  const orderId   = resolveOrderId(order);
  const symLbl    = pairLabelFromSymbol(order.symbol);

  return (
    <View style={oStyles.card}>
      <View style={oStyles.top}>
        <Text style={[oStyles.sideText, { color: Colors.textSecondary, marginRight: Spacing[2] }]}>
          {symLbl}
        </Text>
        <View style={[oStyles.sidePill, { backgroundColor: isBuy ? Colors.buyGreenDim : Colors.sellRedDim }]}>
          <Text style={[oStyles.sideText, { color: isBuy ? Colors.buyGreen : Colors.sellRed }]}>
            {order.side.toUpperCase()}
          </Text>
        </View>
        <Text style={oStyles.type}>{order.type.toUpperCase()}</Text>
        <View style={{ flex: 1 }} />
        <StatusBadge status={order.status} />
        {canCancel && orderId ? (
          <TouchableOpacity style={oStyles.cancelBtn} onPress={() => onCancel(orderId)}>
            <Text style={oStyles.cancelText}>Cancel</Text>
          </TouchableOpacity>
        ) : null}
      </View>
      <View style={oStyles.meta}>
        {[
          { label: 'Price', value: order.price ? formatPrice(order.price) : 'Market' },
          { label: 'Amount', value: formatAmount(order.amount, 6) },
          { label: 'Filled', value: formatAmount(order.filled_amount ?? 0, 6) },
        ].map((item) => (
          <OrderMeta key={item.label} label={item.label} value={item.value} />
        ))}
      </View>
      <Text style={oStyles.date}>{formatDateTime(order.created_at)}</Text>
    </View>
  );
}

function OrderMeta({ label, value }: { label: string; value: string }) {
  return (
    <View style={oStyles.metaItem}>
      <Text style={oStyles.metaLabel}>{label}</Text>
      <Text style={oStyles.metaValue}>{value}</Text>
    </View>
  );
}

function EmptyState({ label }: { label: string }) {
  return (
    <View style={styles.emptyWrap}>
      <Text style={styles.emptyTxt}>{label}</Text>
    </View>
  );
}

function GuestPromo({ onLogin }: { onLogin: () => void }) {
  return (
    <LinearGradient
      colors={['#1a1408', '#0d0d0d', '#141008']}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={styles.promoCardInline}
    >
      <Icon name="gift-outline" size={40} color={Colors.goldLight} style={styles.promoIcon} />
      <Text style={styles.promoTitle}>
        Sign up now for a chance to receive exclusive new user bonus rewards
      </Text>
      <TouchableOpacity style={styles.promoBtn} onPress={onLogin} activeOpacity={0.85}>
        <Text style={styles.promoBtnTxt}>Sign up / Log in</Text>
      </TouchableOpacity>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
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

  /* ── Terminal block ──────────────────────────────────────────────── */
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
  bookPane: { flex: SpotUi.bookFlex, minWidth: 0 },
  formPane: {
    flex: SpotUi.formFlex,
    minWidth: 0,
    minHeight: 0,
    flexDirection: 'column',
    paddingBottom: Spacing[1],
    overflow: 'hidden',
  },

  /* ── Sentiment bar (book pane footer) ───────────────────────────── */
  sentimentWrap: {
    flexDirection: 'row',
    marginHorizontal: Spacing[1],
    marginTop: 4,
    height: 14,
    borderRadius: 3,
    overflow: 'hidden',
    position: 'relative',
  },
  sentimentBar:     { backgroundColor: SpotUi.long,   opacity: 0.7 },
  sentimentBarSell: { backgroundColor: Colors.sellRed,   opacity: 0.7 },
  sentimentLabels: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: Spacing[1],
  },
  sentimentBuy:  { fontFamily: FontFamily.bold, fontSize: 9, color: Colors.white },
  sentimentSell: { fontFamily: FontFamily.bold, fontSize: 9, color: Colors.white },

  /* ── Data panel ──────────────────────────────────────────────────── */
  dataPanel: { backgroundColor: Colors.surface },
  dataBlockBody: {
    paddingHorizontal: Spacing[1],
    paddingTop: Spacing[1],
    paddingBottom: Spacing[4],
    minHeight: 280,
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
    borderColor: SpotUi.long,
    backgroundColor: SpotUi.longDim,
  },
  hideOtherPairsTxt: {
    fontFamily: FontFamily.regular,
    fontSize: FontSize.xs,
    color: Colors.textSecondary,
  },

  /* ── Promo / empty states ────────────────────────────────────────── */
  promoCardInline: {
    marginTop: Spacing[2],
    borderRadius: Radius.lg,
    overflow: 'hidden',
    paddingHorizontal: Spacing[4],
    paddingVertical: Spacing[5],
    alignItems: 'center',
    borderWidth: 1,
    borderColor: Colors.goldAlpha15,
  },
  promoIcon:   { marginBottom: Spacing[3] },
  promoTitle: {
    fontFamily: FontFamily.medium,
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: Spacing[4],
  },
  promoBtn: {
    backgroundColor: Colors.gold,
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
  emptyWrap: {
    paddingVertical: Spacing[10],
    alignItems: 'center',
    backgroundColor: Colors.surfaceCard,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    marginBottom: Spacing[3],
  },
  emptyTxt: {
    fontFamily: FontFamily.regular,
    fontSize: FontSize.sm,
    color: Colors.textMuted,
  },

  /* ── Data tabs ───────────────────────────────────────────────────── */
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
  dataTabTxt:    { fontFamily: FontFamily.medium,   fontSize: FontSize.sm, color: Colors.textMuted },
  dataTabTxtActive: { color: Colors.goldLight, fontFamily: FontFamily.semiBold },

  /* ── Empty / funds empty ─────────────────────────────────────────── */
  fundsHint: {
    paddingVertical: Spacing[3],
    paddingHorizontal: Spacing[3],
    marginBottom: Spacing[2],
    alignItems: 'center',
  },
  fundsEmpty: {
    paddingVertical: Spacing[5],
    alignItems: 'center',
    backgroundColor: Colors.surfaceCard,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    marginBottom: Spacing[2],
  },
  fundsEmptyTitle: {
    fontFamily: FontFamily.semiBold,
    fontSize: FontSize.sm,
    color: Colors.textPrimary,
    marginTop: Spacing[3],
  },
  fundsEmptySub: {
    fontFamily: FontFamily.regular,
    fontSize: FontSize.xs,
    color: Colors.textMuted,
    marginTop: Spacing[1],
    marginBottom: Spacing[4],
    textAlign: 'center',
    paddingHorizontal: Spacing[6],
  },
  addFundsBtn: {
    paddingHorizontal: Spacing[6],
    paddingVertical: Spacing[3],
    backgroundColor: Colors.goldAlpha15,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.goldAlpha30,
  },
  addFundsTxt: { fontFamily: FontFamily.bold, fontSize: FontSize.sm, color: Colors.goldLight },
});

const oStyles = StyleSheet.create({
  card: {
    backgroundColor: Colors.surfaceCard,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    borderRadius: Radius.md,
    padding: Spacing[3],
    marginBottom: Spacing[2],
  },
  top: { flexDirection: 'row', alignItems: 'center', marginBottom: Spacing[2] },
  sidePill: { paddingHorizontal: Spacing[2], paddingVertical: 2, borderRadius: Radius.sm, marginRight: Spacing[2] },
  sideText: { fontFamily: FontFamily.bold, fontSize: FontSize.xs, letterSpacing: 0.5 },
  type: { fontFamily: FontFamily.medium, fontSize: FontSize.sm, color: Colors.textSecondary, marginRight: Spacing[2] },
  cancelBtn: {
    paddingHorizontal: Spacing[2], paddingVertical: 3,
    backgroundColor: Colors.dangerDim, borderRadius: Radius.sm,
    borderWidth: 1, borderColor: Colors.dangerDim,
    marginLeft: Spacing[2],
  },
  cancelText: { fontFamily: FontFamily.semiBold, fontSize: FontSize.xs, color: Colors.danger },
  meta: { flexDirection: 'row', marginBottom: Spacing[2], gap: Spacing[2] },
  metaItem: { flex: 1, minWidth: 0 },
  metaLabel: {
    fontFamily: FontFamily.medium,
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    marginBottom: 2,
  },
  metaValue: {
    fontFamily: FontFamily.monoMedium,
    fontSize: FontSize.base,
    color: Colors.textPrimary,
  },
  date: { fontFamily: FontFamily.regular, fontSize: FontSize.xs, color: Colors.textMuted },
});
