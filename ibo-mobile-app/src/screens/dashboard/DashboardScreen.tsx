import React, { useEffect, useCallback, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  FlatList,
  Platform,
  Animated,
  Easing,
  Pressable,
  Keyboard,
} from 'react-native';
import { useSelector } from 'react-redux';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CompositeNavigationProp, useNavigation } from '@react-navigation/native';
import { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import Icon from '@/components/common/AppIcon';
import { RootState } from '../../store';
import { selectSessionWallet } from '../../store/wallet.slice';
import { selectSessionTrading } from '../../store/trading.slice';
import CoinIcon from '../../components/common/CoinIcon';
import MiniSparkLine from '../../components/dashboard/MiniSparkLine';import AllocationRing from '../../components/dashboard/AllocationRing';
import TickerBar from '../../components/dashboard/TickerBar';
import HomeBannerCarousel from '../../components/dashboard/HomeBannerCarousel';
import { Colors, FontFamily, FontSize, Spacing, Radius } from '../../theme';
import { iosManualKeyboardScrollProps } from '../../utils/iosKeyboardScroll';
import {
  formatUSD,
  formatPercent,
  formatPrice,
  isPositive,
} from '../../utils/formatters';
import { effectiveKycStatus } from '../../utils/kycGate';
import { navigateToKycFlowFromRoot } from '../../utils/kycNavigation';
import {
  computePortfolioUsd,
  computeUnrealizedPnL,
  walletAllocation,
  topSpotMarkets,
  defaultTradeTarget,
  sortedWalletAssets,
  spotMarketOverview,
  resolveSpotTradeSymbol,
  spotPriceForAsset,
} from '../../utils/dashboard';
import {
  formatVolumeCompact,
  pairParts,
  parseMarketNum,
  filterMarketsList,
} from '../../utils/markets';
import { marketStoreKey } from '../../api/market.api';
import { MainTabParamList, RootStackParamList } from '../../navigation/types';
import { MarketRow } from '../../types/market.types';

// ─── Constants ────────────────────────────────────────────────────────────────

const HERO_H_PAD = Spacing[5];

type Nav = CompositeNavigationProp<
  BottomTabNavigationProp<MainTabParamList, 'Dashboard'>,
  NativeStackNavigationProp<RootStackParamList>
>;

// ─── Animated pulse dot (live indicator) ─────────────────────────────────────

function PulseDot({ color }: { color: string }) {
  const scale   = useRef(new Animated.Value(1)).current;
  const opacity = useRef(new Animated.Value(0.9)).current;
  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.parallel([
          Animated.timing(scale,   { toValue: 1.6, duration: 700, useNativeDriver: true, easing: Easing.out(Easing.ease) }),
          Animated.timing(opacity, { toValue: 0,   duration: 700, useNativeDriver: true }),
        ]),
        Animated.parallel([
          Animated.timing(scale,   { toValue: 1, duration: 0, useNativeDriver: true }),
          Animated.timing(opacity, { toValue: 0.9, duration: 0, useNativeDriver: true }),
        ]),
        Animated.delay(600),
      ]),
    ).start();
  }, []);
  return (
    <View style={{ width: 10, height: 10, alignItems: 'center', justifyContent: 'center' }}>
      <Animated.View style={{
        position: 'absolute',
        width: 10, height: 10, borderRadius: 5,
        backgroundColor: color,
        opacity, transform: [{ scale }],
      }} />
      <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: color }} />
    </View>
  );
}

// ─── Animated counter ─────────────────────────────────────────────────────────

function AnimatedUSD({ value }: { value: number }) {
  const prev    = useRef(value);
  const anim    = useRef(new Animated.Value(value)).current;
  const [display, setDisplay] = React.useState(formatUSD(value));

  useEffect(() => {
    if (Math.abs(value - prev.current) < 0.005) return;
    const from = prev.current;
    prev.current = value;
    anim.setValue(from);

    // addListener drives the text update — no setInterval / _value access
    const listenerId = anim.addListener(({ value: v }) => setDisplay(formatUSD(v)));
    Animated.timing(anim, {
      toValue: value,
      duration: 650,
      useNativeDriver: false,
      easing: Easing.out(Easing.cubic),
    }).start(({ finished }) => {
      anim.removeListener(listenerId);
      if (finished) setDisplay(formatUSD(value));
    });
    return () => anim.removeListener(listenerId);
  }, [value]);

  return <Text style={styles.portfolioValue}>{display}</Text>;
}

// ─── 24h Hi/Lo bar ───────────────────────────────────────────────────────────

function HLBar({ market: m }: { market: MarketRow }) {
  const hi  = parseMarketNum(m.high_24h);
  const lo  = parseMarketNum(m.low_24h);
  const cur = parseMarketNum(m.last_price);
  if (!hi || !lo || hi <= lo) return null;
  const pct = Math.min(1, Math.max(0, (cur - lo) / (hi - lo)));
  return (
    <View style={styles.hlWrap}>
      <Text style={styles.hlEdge}>{formatPrice(lo)}</Text>
      <View style={styles.hlTrack}>
        <View style={[styles.hlFill, { width: `${Math.round(pct * 100)}%` as any }]} />
        <View style={[styles.hlDot, { left: `${Math.round(pct * 100)}%` as any }]} />
      </View>
      <Text style={styles.hlEdge}>{formatPrice(hi)}</Text>
    </View>
  );
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function DashboardScreen() {
  const navigation = useNavigation<Nav>();

  const { user, kyc, kycMode }                       = useSelector((s: RootState) => s.auth);
  const { assets, totalUsd } = useSelector(selectSessionWallet);
  const { openOrders, livePositions }        = useSelector(selectSessionTrading);
  const { markets, marketList } = useSelector((s: RootState) => s.market);

  // ── Derived data ────────────────────────────────────────────────────────────

  const portfolioUsd = useMemo(
    () => computePortfolioUsd(assets, markets, totalUsd),
    [assets, markets, totalUsd],
  );
  const { unrealized, pct: unrealizedPct } = useMemo(
    () => computeUnrealizedPnL(livePositions), [livePositions],
  );
  const allocation   = useMemo(() => walletAllocation(assets, markets),       [assets, markets]);
  const overview     = useMemo(() => spotMarketOverview(marketList, markets),  [marketList, markets]);
  const futuresMkts  = useMemo(
    () => filterMarketsList(marketList, markets, { typeTab: 'futures', category: 'volume', search: '' }).slice(0, 6),
    [marketList, markets],
  );
  const topAssets    = useMemo(() => sortedWalletAssets(assets, markets).slice(0, 5), [assets, markets]);
  const tradeTarget  = useMemo(() => defaultTradeTarget(assets, marketList, markets), [assets, marketList, markets]);
  const tickerMkts   = useMemo(() => topSpotMarkets(marketList, markets, 14), [marketList, markets]);
  const marketFeed = useMemo(() => topSpotMarkets(marketList, markets, 5), [marketList, markets]);

  const firstName   = user?.name?.split(' ')[0] ?? user?.email?.split('@')[0] ?? 'Trader';
  const hasPnL      = livePositions.length > 0;
  const hasAlloc    = allocation.length > 0;
  const hasAssets   = topAssets.length > 0;
  const hasOrders   = openOrders.length > 0;
  const hasFutures  = futuresMkts.length > 0;
  const kycStatus = effectiveKycStatus(kyc, user);
  const kycStep = kycStatus === 'approved' ? 2 : kycStatus === 'pending' || kycStatus === 'under_review' ? 1 : 0;
  const [searchQuery, setSearchQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);

  const showSearchDropdown = searchOpen && searchQuery.trim().length > 0;

  const closeSearch = useCallback(() => {
    setSearchOpen(false);
    setSearchQuery('');
    Keyboard.dismiss();
  }, []);
  const dashboardSearchResults = useMemo(() => {
    const q = searchQuery.trim().toUpperCase();
    if (!q) return [];
    const spotMatches = topSpotMarkets(marketList, markets, 40)
      .filter((m) => {
        const symbol = String(m.symbol ?? '').toUpperCase();
        const pair = symbol.replace('USDT', '/USDT');
        return symbol.includes(q) || pair.includes(q);
      })
      .slice(0, 8)
      .map((m) => ({ type: 'market' as const, key: `m-${m.symbol}`, market: m }));
    const assetMatches = sortedWalletAssets(assets, markets)
      .filter((a) => String(a.asset ?? '').toUpperCase().includes(q))
      .slice(0, 5)
      .map((a) => ({ type: 'asset' as const, key: `a-${a.asset}`, asset: a }));
    return [...spotMatches, ...assetMatches].slice(0, 10);
  }, [searchQuery, marketList, markets, assets]);

  const goTrade = (symbol: string) =>
    navigation.navigate('Trade', { screen: 'TradePair', params: { symbol, market: 'spot' } });

  const goDerivatives = (symbol: string, market: 'futures' | 'options' = 'futures') =>
    navigation.navigate('Futures', { screen: 'DerivativesPair', params: { symbol, market } });

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <TickerBar
        markets={tickerMkts}
        onPress={(m) => goTrade(m.symbol)}
      />

      {/* Fixed header — search dropdown floats over content below */}
      <View style={styles.header}>
        <View style={styles.headerTopRow}>
          <TouchableOpacity
            style={styles.userBubble}
            activeOpacity={0.8}
            onPress={() => navigation.navigate('Profile', { screen: 'ProfileHome' })}
          >
            <Text style={styles.userBubbleText}>
              {(user?.name?.[0] ?? user?.email?.[0] ?? 'U').toUpperCase()}
            </Text>
          </TouchableOpacity>
          <View style={styles.liveSearchBar}>
            <Icon name="search-outline" size={16} color={Colors.textMuted} />
            <TextInput
              value={searchQuery}
              onChangeText={(t) => {
                setSearchQuery(t);
                if (t.trim()) setSearchOpen(true);
              }}
              placeholder="Search pair or asset"
              placeholderTextColor={Colors.textMuted}
              style={styles.searchInput}
              onFocus={() => setSearchOpen(true)}
              returnKeyType="search"
            />
            {searchQuery.length > 0 && (
              <TouchableOpacity
                onPress={() => (searchQuery ? setSearchQuery('') : closeSearch())}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Icon name="close-circle" size={15} color={Colors.textMuted} />
              </TouchableOpacity>
            )}
          </View>
          <View style={styles.headerTopActions}>
            <TouchableOpacity
              style={styles.headerIconBtn}
              onPress={() => navigation.navigate('Wallet', { screen: 'Deposit', params: {} })}
              activeOpacity={0.8}
            >
              <Icon name="arrow-down-circle-outline" size={18} color={Colors.goldLight} />
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.headerIconBtn}
              onPress={() => navigation.navigate('Profile', { screen: 'Support' })}
              activeOpacity={0.8}
            >
              <Icon name="headset-outline" size={18} color={Colors.goldLight} />
            </TouchableOpacity>
          </View>
        </View>
      </View>

      <View style={styles.body}>
        {showSearchDropdown && (
          <>
            <Pressable style={styles.searchBackdrop} onPress={closeSearch} />
            <View style={styles.searchDropdown}>
              {dashboardSearchResults.length === 0 ? (
                <Text style={styles.searchEmpty}>No matching pairs or assets.</Text>
              ) : (
                <FlatList
                  data={dashboardSearchResults}
                  keyExtractor={(item) => item.key}
                  {...iosManualKeyboardScrollProps()}
                  nestedScrollEnabled
                  showsVerticalScrollIndicator={false}
                  renderItem={({ item }) => {
                    if (item.type === 'market') {
                      const m = item.market;
                      return (
                        <TouchableOpacity
                          style={styles.searchRow}
                          activeOpacity={0.8}
                          onPress={() => {
                            closeSearch();
                            const mk = (m.market_type ?? 'spot') as 'spot' | 'futures' | 'options';
                            if (mk === 'futures' || mk === 'options') goDerivatives(m.symbol, mk);
                            else goTrade(m.symbol);
                          }}
                        >
                          <CoinIcon symbol={m.symbol} size={24} logoUrl={m.logo_url} />
                          <View style={styles.searchMeta}>
                            <Text style={styles.searchTitle}>{String(m.symbol).replace('USDT', '/USDT')}</Text>
                            <Text style={styles.searchSub}>{formatPrice(m.last_price)}</Text>
                          </View>
                          <Text style={[
                            styles.searchPct,
                            { color: isPositive(m.price_change_pct_24h) ? Colors.buyGreen : Colors.sellRed },
                          ]}>
                            {formatPercent(m.price_change_pct_24h)}
                          </Text>
                        </TouchableOpacity>
                      );
                    }
                    return (
                      <TouchableOpacity
                        style={styles.searchRow}
                        activeOpacity={0.8}
                        onPress={() => {
                          closeSearch();
                          navigation.navigate('Wallet', { screen: 'WalletHome' });
                        }}
                      >
                        <CoinIcon symbol={item.asset.asset} size={24} />
                        <View style={styles.searchMeta}>
                          <Text style={styles.searchTitle}>{item.asset.asset}</Text>
                          <Text style={styles.searchSub}>Wallet asset</Text>
                        </View>
                      </TouchableOpacity>
                    );
                  }}
                />
              )}
            </View>
          </>
        )}

        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.scroll}
          {...iosManualKeyboardScrollProps()}
        >
          {kycStatus !== 'approved' && (
            <View style={[styles.verifyCard, styles.verifyCardInScroll]}>
              <View style={styles.verifyHead}>
                <View style={styles.verifyShieldWrap}>
                  <Icon name="shield-checkmark-outline" size={15} color={Colors.goldLight} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.verifyTitle}>Complete identity verification</Text>
                  <Text style={styles.verifySubtitle}>Verify in minutes to unlock deposits, trading, and withdrawals.</Text>
                </View>
              </View>
              <View style={styles.verifyStepsRow}>
                {['Identity', 'Review', 'Approved'].map((step, idx) => {
                  const done = idx <= kycStep;
                  return (
                    <View key={step} style={styles.verifyStep}>
                      <View style={[styles.verifyStepDot, done && styles.verifyStepDotActive]} />
                      <Text style={[styles.verifyStepLabel, done && styles.verifyStepLabelActive]}>{step}</Text>
                    </View>
                  );
                })}
              </View>
              <TouchableOpacity
                style={styles.verifyBtn}
                onPress={() => navigateToKycFlowFromRoot(navigation, kycMode, kycStatus)}
                activeOpacity={0.85}
              >
                <Text style={styles.verifyBtnText}>Verify now</Text>
                <Icon name="arrow-forward" size={14} color={Colors.surfaceDark} />
              </TouchableOpacity>
            </View>
          )}

        {/* ── Hero card ── */}
        <View style={styles.heroCard}>
          <Text style={styles.fieldLabel}>Total portfolio value</Text>
          <TouchableOpacity
            activeOpacity={0.75}
            onPress={() => navigation.navigate('Wallet', { screen: 'WalletHome' })}
            hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
          >
            <AnimatedUSD value={portfolioUsd} />
          </TouchableOpacity>

          {hasPnL && (
            <TouchableOpacity
              style={styles.pnlRow}
              activeOpacity={0.7}
              onPress={() => navigation.navigate('Profile', { screen: 'PnLAnalytics' })}
            >
              <Icon
                name={unrealized >= 0 ? 'arrow-up-circle-outline' : 'arrow-down-circle-outline'}
                size={13}
                color={unrealized >= 0 ? Colors.buyGreen : Colors.sellRed}
              />
              <Text style={[styles.pnlText, { color: unrealized >= 0 ? Colors.buyGreen : Colors.sellRed }]}>
                {formatUSD(unrealized)} unrealized
                {Math.abs(unrealizedPct) > 0.01 ? ` (${formatPercent(unrealizedPct)})` : ''}
              </Text>
              <Icon name="chevron-right" size={12} color={Colors.textMuted} style={{ marginLeft: 2 }} />
            </TouchableOpacity>
          )}

          {/* Action buttons */}
          <View style={styles.heroActions}>
            <TouchableOpacity
              style={[styles.heroBtn, styles.depositBtn]}
              onPress={() => navigation.navigate('Wallet', { screen: 'Deposit', params: {} })}
              activeOpacity={0.85}
            >
              <Icon name="arrow-down-circle-outline" size={15} color={Colors.surfaceDark} />
              <Text style={styles.depositBtnText}>Deposit</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.heroBtn, styles.secondaryBtn]}
              onPress={() => navigation.navigate('Wallet', { screen: 'Withdraw', params: {} })}
              activeOpacity={0.85}
            >
              <Icon name="arrow-up-circle-outline" size={15} color={Colors.textPrimary} />
              <Text style={styles.secondaryBtnText}>Withdraw</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.heroBtn, styles.tradeBtn]}
              onPress={() => {
                if (tradeTarget) goTrade(tradeTarget.symbol);
                else navigation.navigate('Markets', { screen: 'MarketsList' });
              }}
              activeOpacity={0.85}
            >
              <Icon name="swap-horizontal" size={15} color={Colors.goldLight} />
              <Text style={styles.tradeBtnText}>Trade</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* 4 × 2 grid — extra features live under All → Explore */}
        <View style={styles.quickActionsCard}>
          <ActionGridItem
            icon="grid-outline"
            label="All"
            segment="Features"
            onPress={() => navigation.navigate('Profile', { screen: 'Explore' })}
          />
          <ActionGridItem
            icon="swap-horizontal"
            label="Trade"
            onPress={() => {
              if (tradeTarget) goTrade(tradeTarget.symbol);
              else navigation.navigate('Markets', { screen: 'MarketsList' });
            }}
          />
          <ActionGridItem
            icon="speedometer-outline"
            label="Futures"
            onPress={() => goDerivatives('BTCUSDT', 'futures')}
          />
          <ActionGridItem
            icon="analytics-outline"
            label="Markets"
            onPress={() => navigation.navigate('Markets', { screen: 'MarketsList' })}
          />
          <ActionGridItem
            icon="wallet-outline"
            label="Wallet"
            onPress={() => navigation.navigate('Wallet', { screen: 'WalletHome' })}
          />
          <ActionGridItem
            icon="swap-vertical"
            label="Swap"
            segment="IBO/USDT"
            onPress={() => navigation.navigate('Wallet', { screen: 'WalletHome', params: { tab: 'swap' } })}
          />
          <ActionGridItem
            icon="view-grid-outline"
            label="IBO"
            onPress={() => navigation.navigate('Markets', { screen: 'IBOMarkets' })}
          />
          <ActionGridItem
            icon="cash-outline"
            label="INR"
            onPress={() => navigation.navigate('Wallet', { screen: 'InrDeposit' })}
          />
        </View>

        <HomeBannerCarousel />

        {/* ── Market overview strip ── */}
        <View style={styles.overviewStrip}>
          <OverviewTile label="Spot pairs" value={String(overview.pairCount)}              color={Colors.goldLight}      onPress={() => navigation.navigate('Markets', { screen: 'MarketsList' })} />
          <View style={styles.stripDiv} />
          <OverviewTile label="Gainers"    value={String(overview.gainers)}                color={Colors.buyGreen}        onPress={() => navigation.navigate('Markets', { screen: 'MarketsList' })} />
          <View style={styles.stripDiv} />
          <OverviewTile label="Losers"     value={String(overview.losers)}                 color={Colors.sellRed}         onPress={() => navigation.navigate('Markets', { screen: 'MarketsList' })} />
          <View style={styles.stripDiv} />
          <OverviewTile label="24h Vol"    value={formatVolumeCompact(overview.totalVolume)} color={Colors.textSecondary} onPress={() => navigation.navigate('Markets', { screen: 'MarketsList' })} />
        </View>


        {/* ── Futures strip ── */}
        {hasFutures && (
          <View style={styles.card}>
            <SectionHead
              title="Futures"
              sub="Perpetual contracts"
              onSeeAll={() => navigation.navigate('Futures', { screen: 'DerivativesPair', params: { symbol: 'BTCUSDT', market: 'futures' } })}
              seeAllLabel="All"
            />
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View style={styles.futuresRow}>
                {futuresMkts.map((m) => {
                  const { base } = pairParts(m);
                  const pos = isPositive(m.price_change_pct_24h);
                  return (
                    <TouchableOpacity
                      key={marketStoreKey(m)}
                      style={styles.futuresCard}
                      onPress={() => goDerivatives(m.symbol, 'futures')}
                      activeOpacity={0.75}
                    >
                      <View style={styles.futuresCardTop}>
                        <CoinIcon symbol={m.symbol} size={22} logoUrl={m.logo_url} />
                        <Text style={styles.futuresBase} numberOfLines={1}>{base}</Text>
                      </View>
                      <Text style={styles.futuresPx} numberOfLines={1}>{formatPrice(m.last_price)}</Text>
                      <View style={[styles.futuresPill, {
                        backgroundColor: pos ? Colors.buyGreenDim : Colors.sellRedDim,
                      }]}>
                        <Text style={[styles.futuresPct, { color: pos ? Colors.buyGreen : Colors.sellRed }]}>
                          {formatPercent(m.price_change_pct_24h)}
                        </Text>
                      </View>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </ScrollView>
          </View>
        )}

        {/* ── Holdings ── */}
        {(hasAlloc || hasAssets) && (
          <View style={styles.card}>
            <SectionHead
              title="Holdings"
              onSeeAll={() => navigation.navigate('Wallet', { screen: 'WalletHome' })}
              seeAllLabel="Wallet"
            />

            {hasAlloc && (
              <View style={styles.allocRow}>
                <AllocationRing
                  slices={allocation}
                  totalLabel={formatUSD(portfolioUsd)}
                  centerLabel={`${allocation.length} assets`}
                />
                <View style={styles.allocLegend}>
                  {allocation.slice(0, 5).map((s) => {
                    const tradeSym = resolveSpotTradeSymbol(s.asset, markets);
                    return (
                      <TouchableOpacity
                        key={s.asset}
                        style={styles.legendItem}
                        activeOpacity={0.7}
                        onPress={() => {
                          if (tradeSym) goTrade(tradeSym);
                          else navigation.navigate('Wallet', { screen: 'WalletHome' });
                        }}
                      >
                        <View style={[styles.legendDot, { backgroundColor: s.color }]} />
                        <Text style={styles.legendAsset}>{s.asset}</Text>
                        <View style={styles.legendRight}>
                          <Text style={styles.legendVal}>{formatUSD(s.value)}</Text>
                          <Text style={styles.legendPct}>
                            {portfolioUsd > 0 ? `${((s.value / portfolioUsd) * 100).toFixed(1)}%` : '—'}
                          </Text>
                        </View>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>
            )}

            {hasAssets && topAssets.map((asset) => {
              const sym     = resolveSpotTradeSymbol(asset.asset, markets);
              const spotRow = sym ? markets[sym] : undefined;
              const usd     = Number(asset.usd_value) > 0
                ? Number(asset.usd_value)
                : (Number(asset.available_balance) + Number(asset.locked_balance)) *
                  spotPriceForAsset(asset.asset, markets);
              return (
                <TouchableOpacity
                  key={asset.asset}
                  style={styles.assetRow}
                  activeOpacity={0.75}
                  onPress={() => {
                    if (sym) goTrade(sym);
                    else navigation.navigate('Wallet', { screen: 'WalletHome' });
                  }}
                >
                  <CoinIcon symbol={asset.asset} size={38} />
                  <View style={styles.assetInfo}>
                    <Text style={styles.assetName}>{asset.asset}</Text>
                    <Text style={styles.assetBal}>
                      {formatPrice(asset.available_balance, asset.asset === 'USDT' ? 2 : 6)} avail
                    </Text>
                    {spotRow && <HLBar market={spotRow} />}
                  </View>
                  {spotRow && (
                    <View style={styles.assetSpark}>
                      <MiniSparkLine market={spotRow} width={52} height={26} idSuffix="_a" />
                    </View>
                  )}
                  <View style={styles.assetRight}>
                    <Text style={styles.assetUsd}>{formatUSD(usd)}</Text>
                    {spotRow && (
                      <Text style={[styles.assetChange, {
                        color: isPositive(spotRow.price_change_pct_24h) ? Colors.buyGreen : Colors.sellRed,
                      }]}>
                        {formatPercent(spotRow.price_change_pct_24h)}
                      </Text>
                    )}
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>
        )}

        {(marketFeed.length > 0 || hasOrders) && (
          <View style={styles.card}>
            <SectionHead
              title="Market Feed"
              sub="Fast movers in real time"
              onSeeAll={() => navigation.navigate('Markets', { screen: 'MarketsList' })}
              seeAllLabel="All"
            />
            {marketFeed.map((m) => (
              <TouchableOpacity
                key={`feed-${m.symbol}`}
                style={styles.orderRow}
                activeOpacity={0.75}
                onPress={() => goTrade(m.symbol)}
              >
                <View style={styles.orderLeft}>
                  <CoinIcon symbol={m.symbol} size={26} logoUrl={m.logo_url} />
                  <Text style={[styles.orderSym, { marginLeft: Spacing[2] }]}>{m.symbol?.replace('USDT', '/USDT')}</Text>
                </View>
                <View style={styles.orderMid}>
                  <Text style={styles.orderAmt}>{formatVolumeCompact(m.volume_24h)}</Text>
                  <Text style={styles.orderPx}>{formatPrice(m.last_price)}</Text>
                </View>
                <View style={[styles.sidePill, {
                  backgroundColor: isPositive(m.price_change_pct_24h) ? Colors.buyGreenDim : Colors.sellRedDim,
                }]}>
                  <Text style={[styles.sideText, {
                    color: isPositive(m.price_change_pct_24h) ? Colors.buyGreen : Colors.sellRed,
                  }]}>
                    {formatPercent(m.price_change_pct_24h)}
                  </Text>
                </View>
              </TouchableOpacity>
            ))}

            {hasOrders && (
              <TouchableOpacity
                style={styles.manageOrdersBtn}
                onPress={() => {
                  const sym = openOrders[0]?.symbol;
                  if (sym) goTrade(sym);
                }}
                activeOpacity={0.85}
              >
                <Text style={styles.manageOrdersText}>Manage Open Orders ({openOrders.length})</Text>
              </TouchableOpacity>
            )}
          </View>
        )}

      </ScrollView>
      </View>

    </SafeAreaView>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function SectionHead({
  title, sub, onSeeAll, seeAllLabel, small,
}: {
  title: string; sub?: string;
  onSeeAll?: () => void; seeAllLabel?: string; small?: boolean;
}) {
  return (
    <View style={styles.sectionHead}>
      <View style={{ flex: 1 }}>
        <Text style={[styles.sectionTitle, small && styles.sectionTitleSmall]}>{title}</Text>
        {sub ? <Text style={styles.sectionSub}>{sub}</Text> : null}
      </View>
      {onSeeAll && seeAllLabel ? (
        <TouchableOpacity onPress={onSeeAll} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Text style={styles.seeAll}>{seeAllLabel} →</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

function OverviewTile({ label, value, color, onPress }: { label: string; value: string; color: string; onPress?: () => void }) {
  return (
    <TouchableOpacity style={styles.overviewTile} onPress={onPress} activeOpacity={onPress ? 0.7 : 1} disabled={!onPress}>
      <Text style={[styles.overviewVal, { color }]}>{value}</Text>
      <Text style={styles.overviewLabel}>{label}</Text>
    </TouchableOpacity>
  );
}

function ActionGridItem({
  icon,
  label,
  segment,
  iconContent,
  onPress,
}: {
  icon?: string;
  label: string;
  segment?: string;
  iconContent?: React.ReactNode;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity style={styles.actionItem} onPress={onPress} activeOpacity={0.8}>
      <View style={styles.actionIconWrap}>
        {iconContent ?? (
          <Icon name={icon as string} size={20} color={Colors.goldLight} />
        )}
      </View>
      <Text style={styles.actionLabel}>{label}</Text>
      {segment ? <Text style={styles.actionSegment}>{segment}</Text> : null}
    </TouchableOpacity>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe:   { flex: 1, backgroundColor: Colors.surfaceDark },
  body:   { flex: 1, position: 'relative' },
  scroll: { paddingBottom: Spacing[10], paddingTop: Spacing[2] },

  header: {
    paddingHorizontal: Spacing[4],
    paddingTop: Spacing[3],
    paddingBottom: Spacing[3],
    backgroundColor: Colors.surfaceDark,
    borderBottomWidth: 1,
    borderBottomColor: Colors.surfaceBorder,
    zIndex: 20,
  },
  searchBackdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: Colors.black60,
    zIndex: 30,
  },
  searchDropdown: {
    position: 'absolute',
    top: Spacing[2],
    left: Spacing[4],
    right: Spacing[4],
    zIndex: 40,
    maxHeight: 320,
    borderWidth: 1,
    borderColor: Colors.goldAlpha30,
    borderRadius: Radius.lg,
    backgroundColor: Colors.surfaceElevated,
    overflow: 'hidden',
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.45,
        shadowRadius: 16,
      },
      android: { elevation: 16 },
      default: {},
    }),
  },
  verifyCardInScroll: {
    marginHorizontal: Spacing[4],
    marginBottom: Spacing[2],
  },
  searchInput: {
    flex: 1,
    marginLeft: Spacing[2],
    color: Colors.textPrimary,
    fontFamily: FontFamily.regular,
    fontSize: FontSize.sm,
    paddingVertical: 0,
  },

  // Top row — avatar + search + actions
  headerTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  userBubble: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 1,
    borderColor: Colors.goldAlpha30,
    backgroundColor: Colors.goldAlpha10,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: Spacing[2],
  },
  userBubbleText: {
    fontFamily: FontFamily.bold,
    fontSize: FontSize.sm,
    color: Colors.goldLight,
  },
  headerTopActions: { flexDirection: 'row', alignItems: 'center' },
  headerIconBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: Colors.surfaceCard,
    borderWidth: 1,
    borderColor: Colors.goldAlpha30,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: Spacing[1],
  },
  liveSearchBar: {
    flex: 1,
    height: 36,
    borderRadius: Radius.full,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    backgroundColor: Colors.surfaceCard,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing[3],
    marginRight: Spacing[1],
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing[3],
    paddingVertical: Spacing[3],
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.surfaceBorder,
  },
  searchMeta: { flex: 1, marginLeft: Spacing[2] },
  searchTitle: { fontFamily: FontFamily.semiBold, fontSize: FontSize.sm, color: Colors.textPrimary },
  searchSub: { fontFamily: FontFamily.regular, fontSize: FontSize.xs, color: Colors.textMuted, marginTop: 2 },
  searchPct: { fontFamily: FontFamily.mono, fontSize: FontSize.xs },
  searchEmpty: {
    fontFamily: FontFamily.regular,
    fontSize: FontSize.sm,
    color: Colors.textMuted,
    textAlign: 'center',
    paddingVertical: Spacing[4],
  },
  avatar: {
    width: 34, height: 34, borderRadius: 17,
    backgroundColor: Colors.surfaceCard,
    borderWidth: 1, borderColor: Colors.surfaceBorder,
    alignItems: 'center', justifyContent: 'center',
  },
  avatarText: { fontFamily: FontFamily.bold, fontSize: FontSize.sm, color: Colors.textPrimary },

  verifyCard: {
    marginTop: Spacing[2],
    borderRadius: Radius.xl,
    borderWidth: 1,
    borderColor: Colors.goldAlpha30,
    backgroundColor: Colors.surfaceCard,
    paddingHorizontal: Spacing[3],
    paddingVertical: Spacing[3],
  },
  verifyHead: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: Spacing[2],
  },
  verifyShieldWrap: {
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 1,
    borderColor: Colors.goldAlpha30,
    backgroundColor: Colors.goldAlpha10,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: Spacing[2],
    marginTop: 2,
  },
  verifyTitle: {
    fontFamily: FontFamily.semiBold,
    fontSize: FontSize.sm,
    color: Colors.textPrimary,
    marginBottom: 2,
  },
  verifySubtitle: {
    fontFamily: FontFamily.regular,
    fontSize: FontSize.xs,
    color: Colors.textMuted,
    lineHeight: 16,
  },
  verifyStepsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: Spacing[3],
    paddingHorizontal: 2,
  },
  verifyStep: { alignItems: 'center', flex: 1 },
  verifyStepDot: {
    width: 14,
    height: 14,
    borderRadius: 7,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
    backgroundColor: 'rgba(255,255,255,0.06)',
    marginBottom: 6,
  },
  verifyStepDotActive: {
    borderColor: Colors.gold,
    backgroundColor: Colors.goldAlpha30,
  },
  verifyStepLabel: {
    fontFamily: FontFamily.regular,
    fontSize: 10,
    color: Colors.textMuted,
  },
  verifyStepLabelActive: {
    color: Colors.goldLight,
  },
  verifyBtn: {
    height: 32,
    borderRadius: Radius.lg,
    backgroundColor: Colors.gold,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  verifyBtnText: {
    fontFamily: FontFamily.semiBold,
    fontSize: FontSize.sm,
    color: Colors.surfaceDark,
    marginRight: 6,
  },

  headerSearchRow: { marginBottom: Spacing[2] },

  fieldLabel: {
    fontFamily: FontFamily.semiBold, fontSize: FontSize.xs, color: Colors.goldLight,
    letterSpacing: 1.2, textTransform: 'uppercase', marginBottom: Spacing[2],
  },

  heroCard: {
    marginHorizontal: Spacing[4], marginTop: Spacing[3],
    backgroundColor: Colors.surfaceCard, borderWidth: 1, borderColor: Colors.surfaceBorder,
    borderRadius: Radius.xl, paddingHorizontal: HERO_H_PAD, paddingTop: HERO_H_PAD, paddingBottom: Spacing[4],
  },
  portfolioValue: {
    fontFamily: FontFamily.extraBold, fontSize: FontSize['4xl'], color: Colors.textPrimary,
    letterSpacing: -1.5, marginBottom: Spacing[1],
  },
  pnlRow: { flexDirection: 'row', alignItems: 'center', marginBottom: Spacing[4] },
  pnlText: { fontFamily: FontFamily.medium, fontSize: FontSize.sm, marginLeft: Spacing[1] },

  heroActions: { flexDirection: 'row' },
  heroBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    paddingVertical: Spacing[3], borderRadius: Radius.md, borderWidth: 1, marginRight: Spacing[2],
  },
  depositBtn:       { backgroundColor: Colors.gold,         borderColor: Colors.gold,         marginRight: Spacing[2] },
  depositBtnText:   { fontFamily: FontFamily.bold,    fontSize: FontSize.sm, color: Colors.surfaceDark, marginLeft: Spacing[1] },
  secondaryBtn:     { backgroundColor: Colors.surfaceHover, borderColor: Colors.surfaceBorder, marginRight: Spacing[2] },
  secondaryBtnText: { fontFamily: FontFamily.semiBold, fontSize: FontSize.sm, color: Colors.textPrimary, marginLeft: Spacing[1] },
  tradeBtn:         { backgroundColor: Colors.goldAlpha10,  borderColor: Colors.goldAlpha30,   marginRight: 0 },
  tradeBtnText:     { fontFamily: FontFamily.semiBold, fontSize: FontSize.sm, color: Colors.goldLight,   marginLeft: Spacing[1] },
  quickActionsCard: {
    marginHorizontal: Spacing[4],
    marginTop: Spacing[3],
    backgroundColor: Colors.surfaceCard,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    borderRadius: Radius.xl,
    padding: Spacing[3],
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
  },
  actionItem: {
    width: '24%',
    alignItems: 'center',
    marginVertical: Spacing[2],
  },
  actionIconWrap: {
    width: 42,
    height: 42,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: Colors.goldAlpha30,
    backgroundColor: Colors.goldAlpha10,
    marginBottom: 6,
  },
  actionLabel: {
    fontFamily: FontFamily.regular,
    fontSize: 10,
    color: Colors.textSecondary,
  },
  actionSegment: {
    fontFamily: FontFamily.medium,
    fontSize: 8,
    color: Colors.goldLight,
    marginTop: 2,
    letterSpacing: 0.3,
  },

  // Overview strip
  overviewStrip: {
    flexDirection: 'row', marginHorizontal: Spacing[4], marginTop: Spacing[3],
    backgroundColor: Colors.surfaceCard, borderWidth: 1, borderColor: Colors.surfaceBorder,
    borderRadius: Radius.xl, paddingVertical: Spacing[3],
  },
  overviewTile:  { flex: 1, alignItems: 'center' },
  overviewVal:   { fontFamily: FontFamily.semiBold, fontSize: FontSize.sm, marginBottom: 2 },
  overviewLabel: { fontFamily: FontFamily.regular, fontSize: 9, color: Colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.5 },
  stripDiv:      { width: 1, backgroundColor: Colors.surfaceBorder, marginVertical: Spacing[1] },

  // Generic card
  card: {
    marginHorizontal: Spacing[4], marginTop: Spacing[3],
    backgroundColor: Colors.surfaceCard, borderWidth: 1, borderColor: Colors.surfaceBorder,
    borderRadius: Radius.xl, padding: Spacing[4],
  },
  flex1: { flex: 1 },
  row2:  { flexDirection: 'row', marginHorizontal: Spacing[4], marginTop: Spacing[3] },

  sectionHead: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: Spacing[3] },
  sectionTitle: { fontFamily: FontFamily.semiBold, fontSize: FontSize.xs, color: Colors.goldLight, letterSpacing: 1, textTransform: 'uppercase' },
  sectionTitleSmall: { fontSize: 9, letterSpacing: 0.8 },
  sectionSub: { fontFamily: FontFamily.regular, fontSize: 9, color: Colors.textMuted, marginTop: 2 },
  seeAll:     { fontFamily: FontFamily.medium, fontSize: FontSize.xs, color: Colors.textMuted },
  emptyHint:  { fontFamily: FontFamily.regular, fontSize: FontSize.sm, color: Colors.textMuted, textAlign: 'center', paddingVertical: Spacing[4] },

  // Futures strip
  futuresRow: { flexDirection: 'row' },
  futuresCard: {
    width: 100, backgroundColor: Colors.surfaceElevated, borderWidth: 1, borderColor: Colors.surfaceBorder,
    borderRadius: Radius.lg, padding: Spacing[3], marginRight: Spacing[2], alignItems: 'flex-start',
  },
  futuresCardTop: { flexDirection: 'row', alignItems: 'center', marginBottom: Spacing[1] },
  futuresBase: { fontFamily: FontFamily.bold, fontSize: FontSize.xs, color: Colors.textPrimary, marginLeft: Spacing[1], flex: 1 },
  futuresPx:   { fontFamily: FontFamily.mono, fontSize: FontSize.xs, color: Colors.textPrimary, marginBottom: Spacing[1] },
  futuresPill: { borderRadius: Radius.full, paddingHorizontal: Spacing[2], paddingVertical: 2 },
  futuresPct:  { fontFamily: FontFamily.monoMedium, fontSize: 9 },

  // Hi/Lo bar
  hlWrap:  { flexDirection: 'row', alignItems: 'center', marginTop: 4 },
  hlEdge:  { fontFamily: FontFamily.mono, fontSize: 8, color: Colors.textMuted, minWidth: 28 },
  hlTrack: { flex: 1, height: 3, backgroundColor: Colors.surfaceBorder, borderRadius: 2, marginHorizontal: 3, overflow: 'hidden', position: 'relative' },
  hlFill:  { height: 3, backgroundColor: Colors.goldAlpha30, borderRadius: 2 },
  hlDot:   { position: 'absolute', top: -2, width: 7, height: 7, borderRadius: 4, backgroundColor: Colors.goldLight, marginLeft: -3 },

  // Allocation
  allocRow:   { flexDirection: 'row', alignItems: 'center', marginBottom: Spacing[4], paddingBottom: Spacing[3], borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: Colors.surfaceBorder },
  allocLegend:{ flex: 1, marginLeft: Spacing[3] },
  legendItem: { flexDirection: 'row', alignItems: 'center', marginBottom: Spacing[2] },
  legendDot:  { width: 8, height: 8, borderRadius: 4, marginRight: Spacing[2], flexShrink: 0 },
  legendAsset:{ flex: 1, fontFamily: FontFamily.semiBold, fontSize: FontSize.sm, color: Colors.textPrimary },
  legendRight:{ alignItems: 'flex-end' },
  legendVal:  { fontFamily: FontFamily.mono, fontSize: FontSize.xs, color: Colors.textSecondary },
  legendPct:  { fontFamily: FontFamily.regular, fontSize: 9, color: Colors.textMuted },

  // Asset rows
  assetRow:   { flexDirection: 'row', alignItems: 'center', paddingVertical: Spacing[3], borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: Colors.surfaceBorder },
  assetInfo:  { flex: 1, marginLeft: Spacing[3] },
  assetName:  { fontFamily: FontFamily.semiBold, fontSize: FontSize.base, color: Colors.textPrimary },
  assetBal:   { fontFamily: FontFamily.mono, fontSize: FontSize.xs, color: Colors.textMuted, marginTop: 2 },
  assetSpark: { marginHorizontal: Spacing[2] },
  assetRight: { alignItems: 'flex-end' },
  assetUsd:   { fontFamily: FontFamily.monoMedium, fontSize: FontSize.sm, color: Colors.textSecondary },
  assetChange:{ fontFamily: FontFamily.regular, fontSize: FontSize.xs, marginTop: 2 },

  // Orders
  orderRow:  { flexDirection: 'row', alignItems: 'center', paddingVertical: Spacing[3], borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: Colors.surfaceBorder },
  orderLeft: { flex: 1, flexDirection: 'row', alignItems: 'center' },
  sidePill:  { paddingHorizontal: Spacing[2], paddingVertical: 2, borderRadius: Radius.full, marginRight: Spacing[2] },
  sideText:  { fontFamily: FontFamily.bold, fontSize: FontSize.xs },
  orderSym:  { fontFamily: FontFamily.semiBold, fontSize: FontSize.sm, color: Colors.textPrimary },
  orderMid:  { alignItems: 'flex-end', marginRight: Spacing[3] },
  orderAmt:  { fontFamily: FontFamily.mono, fontSize: FontSize.sm, color: Colors.textPrimary },
  orderPx:   { fontFamily: FontFamily.mono, fontSize: FontSize.xs, color: Colors.textMuted },
  manageOrdersBtn: {
    marginTop: Spacing[2],
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    borderRadius: Radius.md,
    backgroundColor: Colors.surfaceElevated,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: Spacing[2],
  },
  manageOrdersText: {
    fontFamily: FontFamily.medium,
    fontSize: FontSize.xs,
    color: Colors.textSecondary,
  },
});
