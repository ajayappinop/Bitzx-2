import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  TextInput,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Path, Defs, LinearGradient, Stop } from 'react-native-svg';
import { useDispatch, useSelector } from 'react-redux';
import { CompositeNavigationProp, useNavigation } from '@react-navigation/native';
import { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { MainTabParamList, RootStackParamList, TradingStackParamList } from '../../navigation/types';
import Icon from '@/components/common/AppIcon';
import { AppDispatch, RootState } from '../../store';
import { Colors, FontFamily, FontSize, Spacing, Radius } from '../../theme';
import { formatPrice, formatPercent, isPositive } from '../../utils/formatters';
import {
  filterMarketsList,
  formatVolumeCompact,
  marketOverviewStats,
  pairParts,
  buildSparkPoints,
  type MarketCategoryFilter,
} from '../../utils/markets';
import { MarketRow } from '../../types/market.types';
import { marketStoreKey } from '../../api/market.api';
import CoinIcon from '../../components/common/CoinIcon';
import { toExchangeSymbol } from '../../utils/tradeSymbols';
import { iosManualKeyboardScrollProps } from '@/utils/iosKeyboardScroll';

// ─── Constants ────────────────────────────────────────────────────────────────

const SPARK_W = 64;
const SPARK_H = 32;
const SPARK_PAD = 2;

const CATEGORY_TABS: { id: MarketCategoryFilter; label: string }[] = [
  { id: 'all',     label: 'All'     },
  { id: 'gainers', label: 'Gainers' },
  { id: 'losers',  label: 'Losers'  },
  { id: 'volume',  label: 'Top Vol' },
  { id: 'ibo',     label: 'IBO'     },
];

// ─── Sparkline ────────────────────────────────────────────────────────────────
// Wrapped in React.memo — only re-renders when the market object changes.
// This is the most expensive render in each row (SVG path + gradient).

const SparkLine = React.memo(function SparkLine({ market }: { market: MarketRow }) {
  const pts = buildSparkPoints(market);
  if (!pts || pts.length < 2) {
    return <View style={styles.sparkPlaceholder} />;
  }

  const pos = isPositive(market.price_change_pct_24h);
  const color = pos ? Colors.buyGreen : Colors.sellRed;
  // Sanitise: keep only word chars and digits so the id is CSS-safe
  const gradId = `sg_${market.symbol.replace(/\W/g, '_')}`;

  const minV = Math.min(...pts);
  const maxV = Math.max(...pts);
  const range = maxV - minV || minV * 0.002 || 1;

  const toX = (i: number) =>
    SPARK_PAD + (i / (pts.length - 1)) * (SPARK_W - SPARK_PAD * 2);
  const toY = (v: number) =>
    SPARK_H - SPARK_PAD - ((v - minV) / range) * (SPARK_H - SPARK_PAD * 2);

  // Line path: M x0,y0 L x1,y1 L x2,y2 …
  const lineParts = pts
    .map((v, i) => `${i === 0 ? 'M' : 'L'} ${toX(i).toFixed(1)},${toY(v).toFixed(1)}`)
    .join(' ');

  // Closed fill path below the line
  const fillParts = [
    `M ${toX(0).toFixed(1)},${SPARK_H}`,
    ...pts.map((v, i) => `L ${toX(i).toFixed(1)},${toY(v).toFixed(1)}`),
    `L ${toX(pts.length - 1).toFixed(1)},${SPARK_H}`,
    'Z',
  ].join(' ');

  return (
    <Svg width={SPARK_W} height={SPARK_H}>
      <Defs>
        <LinearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={color} stopOpacity={0.25} />
          <Stop offset="1" stopColor={color} stopOpacity={0} />
        </LinearGradient>
      </Defs>
      <Path d={fillParts} fill={`url(#${gradId})`} stroke="none" />
      <Path
        d={lineParts}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
});

// ─── Header component (memoized so it doesn't rebuild on every keystroke) ─────

type HeaderProps = {
  stats: ReturnType<typeof marketOverviewStats>;
  search: string;
  category: MarketCategoryFilter;
  onSearch: (v: string) => void;
  onCategory: (v: MarketCategoryFilter) => void;
  onListCoin?: () => void;
};

const MarketsHeader = React.memo(function MarketsHeader({
  stats, search, category,
  onSearch, onCategory, onListCoin,
}: HeaderProps) {
  return (
    <View>
      {/* Page title */}
      <View style={styles.pageHeader}>
        <View>
          <Text style={styles.pageTitle}>Markets</Text>
          <Text style={styles.pageSub}>
            {stats.pairCount} pairs · {formatVolumeCompact(stats.totalVolume)} vol
          </Text>
        </View>
        <View style={styles.headerRight}>
          {onListCoin ? (
            <TouchableOpacity style={styles.listCoinBtn} onPress={onListCoin} activeOpacity={0.85}>
              <Icon name="plus-circle-outline" size={16} color={Colors.goldLight} />
              <Text style={styles.listCoinBtnText}>List coin</Text>
            </TouchableOpacity>
          ) : null}
          <View style={styles.statsRow}>
            <View style={styles.statBadge}>
              <Text style={styles.statBadgeNum}>{stats.gainers}</Text>
              <Text style={[styles.statBadgeLabel, { color: Colors.buyGreen }]}>▲</Text>
            </View>
            <View style={[styles.statBadge, { marginLeft: Spacing[2] }]}>
              <Text style={styles.statBadgeNum}>{stats.losers}</Text>
              <Text style={[styles.statBadgeLabel, { color: Colors.sellRed }]}>▼</Text>
            </View>
          </View>
        </View>
      </View>

      {/* Filter card */}
      <View style={styles.filterCard}>
        <TextInput
          style={styles.searchInput}
          placeholder="Search symbol…"
          placeholderTextColor={Colors.textMuted}
          value={search}
          onChangeText={onSearch}
          autoCapitalize="characters"
          autoCorrect={false}
          clearButtonMode="while-editing"
        />

        <View style={styles.chipRow}>
          {CATEGORY_TABS.map((c, i) => (
            <TouchableOpacity
              key={c.id}
              style={[
                styles.chip,
                category === c.id && styles.chipActive,
                i < CATEGORY_TABS.length - 1 && styles.chipGap,
              ]}
              onPress={() => onCategory(c.id)}
              activeOpacity={0.85}
            >
              <Text
                style={[styles.chipText, category === c.id && styles.chipTextActive]}
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.75}
              >
                {c.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      <View style={styles.colHeader}>
        <Text style={[styles.colLabel, { flex: 1 }]}>Pair</Text>
        <Text style={[styles.colLabel, styles.colChart]}>24h Chart</Text>
        <Text style={[styles.colLabel, styles.colRight]}>Price / Change</Text>
      </View>
    </View>
  );
});

// ─── Main Screen ──────────────────────────────────────────────────────────────

type MarketsNav = CompositeNavigationProp<
  NativeStackNavigationProp<TradingStackParamList, 'MarketsList'>,
  CompositeNavigationProp<
    BottomTabNavigationProp<MainTabParamList>,
    NativeStackNavigationProp<RootStackParamList>
  >
>;

export default function MarketsScreen() {
  const navigation = useNavigation<MarketsNav>();
  const dispatch = useDispatch<AppDispatch>();
  const { markets, marketList, loading } = useSelector((s: RootState) => s.market);
  const [category, setCategory] = useState<MarketCategoryFilter>('all');
  const [search,   setSearch]   = useState('');

  /* Prices via session WS (`LiveSessionSockets` in MainTabNavigator) — no REST on every visit. */

  const scopedRows = useMemo(
    () => filterMarketsList(marketList, markets, { typeTab: 'all', category: 'all', search: '' }),
    [marketList, markets],
  );

  const stats = useMemo(() => marketOverviewStats(scopedRows), [scopedRows]);

  const rows = useMemo(
    () => filterMarketsList(marketList, markets, { typeTab: 'all', category, search }),
    [marketList, markets, category, search],
  );

  // Stable callbacks so MarketsHeader never re-renders from callback identity change
  const handleSearch   = useCallback((v: string) => setSearch(v),   []);
  const handleCategory = useCallback((v: MarketCategoryFilter) => {
    if (v === 'ibo') {
      navigation.navigate('IBOMarkets');
      return;
    }
    setCategory(v);
  }, [navigation]);
  const handleListCoin = useCallback(
    () => navigation.navigate('Profile', { screen: 'ListCoin' }),
    [navigation],
  );

  // Stable renderItem — prevents FlatList from thinking the renderer changed
  const renderItem = useCallback(
    ({ item }: { item: MarketRow }) => <MarketRowItem market={item} />,
    [],
  );

  const listHeader = useMemo(() => (
    <MarketsHeader
      stats={stats}
      search={search}
      category={category}
      onSearch={handleSearch}
      onCategory={handleCategory}
      onListCoin={handleListCoin}
    />
  // Only rebuild the header component reference when filter state changes
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ), [stats, search, category, handleListCoin]);

  const emptyComponent = useMemo(() => (
    <View style={styles.emptyWrap}>
      <Text style={styles.emptyTitle}>No markets found</Text>
      <Text style={styles.emptySub}>
        {search.trim()
          ? 'Try a different symbol or clear the search.'
          : 'Markets will appear once the feed connects.'}
      </Text>
    </View>
  ), [search]);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <FlatList
        data={rows}
        keyExtractor={(m) => marketStoreKey(m)}
        {...iosManualKeyboardScrollProps()}
        ListHeaderComponent={listHeader}
        renderItem={renderItem}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.listContent}
        initialNumToRender={15}
        maxToRenderPerBatch={10}
        updateCellsBatchingPeriod={30}
        windowSize={6}
        removeClippedSubviews
        ListEmptyComponent={emptyComponent}
      />
    </SafeAreaView>
  );
}

// ─── Row ─────────────────────────────────────────────────────────────────────
// React.memo: only re-renders when the `market` prop reference changes.
// Combined with useMemo selectors in the parent, this eliminates unnecessary
// row re-renders when the user types in the search box or switches filters.

const MarketRowItem = React.memo(function MarketRowItem({ market: m }: { market: MarketRow }) {
  const navigation = useNavigation<MarketsNav>();
  const pct  = m.price_change_pct_24h;
  const pos  = isPositive(pct);
  const { base, quote } = pairParts(m);
  const mtype = (m.market_type ?? 'spot') as 'spot' | 'futures' | 'options';
  const vol   = formatVolumeCompact(m.volume_24h);

  const openMarket = () => {
    if (mtype === 'futures' || mtype === 'options') {
      navigation.getParent()?.navigate('Futures', {
        screen: 'DerivativesPair',
        params: { symbol: m.symbol, market: mtype },
      });
      return;
    }
    // Use the raw symbol so IBO-quoted pairs (BTCIBO, ETHIBO) navigate correctly.
    // toExchangeSymbol preserves IBO suffix; USDT pairs pass through unchanged.
    const navSym = toExchangeSymbol(m.symbol || `${m.base_asset ?? ''}USDT`);
    navigation.getParent()?.navigate('Trade', {
      screen: 'TradePair',
      params: { symbol: navSym, market: 'spot' },
    });
  };

  return (
    <TouchableOpacity
      activeOpacity={0.72}
      style={styles.row}
      onPress={openMarket}
    >
      {/* Left: icon + pair */}
      <View style={styles.rowLeft}>
        <View style={styles.iconFrame}>
          <CoinIcon symbol={m.symbol} size={32} logoUrl={m.logo_url} />
        </View>
        <View style={styles.pairBlock}>
          <View style={styles.pairLine}>
            <Text style={styles.baseText}>{base}</Text>
            {quote ? <Text style={styles.quoteText}>/{quote}</Text> : null}
          </View>
          <Text style={styles.volText}>Vol {vol}</Text>
          {mtype !== 'spot' && (
            <View style={styles.typePill}>
              <Text style={styles.typePillText}>{mtype.toUpperCase()}</Text>
            </View>
          )}
        </View>
      </View>

      {/* Center: sparkline */}
      <View style={styles.sparkWrap}>
        <SparkLine market={m} />
      </View>

      {/* Right: price + change */}
      <View style={styles.rowRight}>
        <Text style={styles.priceText} numberOfLines={1}>
          {formatPrice(m.last_price)}
        </Text>
        <View
          style={[
            styles.changePill,
            {
              backgroundColor: pos ? Colors.buyGreenDim : Colors.sellRedDim,
              borderColor: pos ? 'rgba(34,197,94,0.25)' : 'rgba(239,68,68,0.25)',
            },
          ]}
        >
          <Text style={[styles.changeText, { color: pos ? Colors.buyGreen : Colors.sellRed }]}>
            {formatPercent(pct)}
          </Text>
        </View>
      </View>
    </TouchableOpacity>
  );
});

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.surfaceDark },

  listContent: { paddingBottom: Spacing[10] },

  // Page header
  pageHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing[5],
    paddingTop: Spacing[4],
    paddingBottom: Spacing[3],
  },
  pageTitle: {
    fontFamily: Platform.select({ ios: 'Georgia', android: 'serif', default: 'serif' }),
    fontSize: FontSize['3xl'],
    color: Colors.goldLight,
    fontWeight: '700',
    letterSpacing: 0.4,
  },
  pageSub: {
    fontFamily: FontFamily.regular,
    fontSize: FontSize.xs,
    color: Colors.textMuted,
    marginTop: 2,
    letterSpacing: 0.3,
  },
  headerRight: { alignItems: 'flex-end', gap: Spacing[2] },
  listCoinBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: Spacing[2],
    paddingVertical: 6,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.goldAlpha30,
    backgroundColor: Colors.goldAlpha10,
  },
  listCoinBtnText: {
    fontFamily: FontFamily.bold,
    fontSize: FontSize.xs,
    color: Colors.goldLight,
  },
  statsRow: { flexDirection: 'row', alignItems: 'center' },
  statBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surfaceCard,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing[2],
    paddingVertical: 4,
  },
  statBadgeNum: {
    fontFamily: FontFamily.semiBold,
    fontSize: FontSize.sm,
    color: Colors.textPrimary,
    marginRight: 3,
  },
  statBadgeLabel: {
    fontFamily: FontFamily.bold,
    fontSize: 10,
  },

  // Filter card
  filterCard: {
    marginHorizontal: Spacing[4],
    marginBottom: Spacing[3],
    backgroundColor: Colors.surfaceCard,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    borderRadius: Radius.xl,
    paddingHorizontal: Spacing[4],
    paddingTop: Spacing[4],
    paddingBottom: Spacing[3],
  },
  searchInput: {
    backgroundColor: Colors.surfaceHover,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    borderRadius: Radius.lg,
    paddingHorizontal: Spacing[4],
    paddingVertical: Platform.OS === 'ios' ? Spacing[3] : Spacing[2],
    color: Colors.textPrimary,
    fontFamily: FontFamily.regular,
    fontSize: FontSize.base,
    marginBottom: Spacing[3],
  },

  // Segment (market type)
  segment: {
    flexDirection: 'row',
    backgroundColor: Colors.surfaceHover,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    padding: Spacing[1],
    marginBottom: Spacing[3],
  },
  segBtn: {
    flex: 1,
    paddingVertical: Spacing[2],
    paddingHorizontal: Spacing[1],
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  segBtnActive: {
    backgroundColor: Colors.goldAlpha15,
    borderWidth: 1,
    borderColor: Colors.goldAlpha30,
  },
  segLabel: {
    fontFamily: FontFamily.semiBold,
    fontSize: FontSize.xs,
    color: Colors.textMuted,
    textAlign: 'center',
  },
  segLabelActive: { color: Colors.goldLight },

  // Category chips — equal columns, full width
  chipRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    width: '100%',
  },
  chip: {
    flex: 1,
    paddingVertical: Spacing[2],
    paddingHorizontal: Spacing[1],
    borderRadius: Radius.full,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    backgroundColor: Colors.surfaceHover,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 34,
  },
  chipGap: {
    marginRight: Spacing[2],
  },
  chipActive: {
    borderColor: Colors.goldAlpha30,
    backgroundColor: Colors.goldAlpha10,
  },
  chipText: {
    fontFamily: FontFamily.medium,
    fontSize: FontSize.xs,
    color: Colors.textMuted,
    textAlign: 'center',
  },
  chipTextActive: { color: Colors.goldLight },

  // Column header
  colHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing[5],
    paddingVertical: Spacing[2],
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.surfaceBorder,
    backgroundColor: Colors.surfaceDark,
  },
  colLabel: {
    fontFamily: FontFamily.semiBold,
    fontSize: FontSize.xs,
    color: Colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.7,
  },
  colChart: {
    width: SPARK_W,
    textAlign: 'center',
    marginHorizontal: Spacing[3],
  },
  colRight: {
    width: 96,
    textAlign: 'right',
  },

  // Empty state
  emptyWrap: {
    paddingVertical: Spacing[16],
    alignItems: 'center',
    paddingHorizontal: Spacing[8],
  },
  emptyTitle: {
    fontFamily: FontFamily.semiBold,
    fontSize: FontSize.lg,
    color: Colors.textPrimary,
    marginBottom: Spacing[2],
  },
  emptySub: {
    fontFamily: FontFamily.regular,
    fontSize: FontSize.sm,
    color: Colors.textMuted,
    textAlign: 'center',
    lineHeight: 20,
  },

  // Row
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing[5],
    paddingVertical: Spacing[3],
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.surfaceBorder,
  },
  rowLeft: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    minWidth: 0,
  },
  iconFrame: {
    width: 40,
    height: 40,
    borderRadius: Radius.md,
    backgroundColor: Colors.surfaceHover,
    borderWidth: 1,
    borderColor: Colors.goldAlpha15,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: Spacing[3],
    flexShrink: 0,
  },
  pairBlock: { flex: 1, minWidth: 0 },
  pairLine: { flexDirection: 'row', alignItems: 'baseline' },
  baseText: {
    fontFamily: FontFamily.semiBold,
    fontSize: FontSize.base,
    color: Colors.textPrimary,
  },
  quoteText: {
    fontFamily: FontFamily.regular,
    fontSize: FontSize.sm,
    color: Colors.textMuted,
    marginLeft: 1,
  },
  volText: {
    fontFamily: FontFamily.regular,
    fontSize: FontSize.xs,
    color: Colors.textMuted,
    marginTop: 2,
  },
  typePill: {
    alignSelf: 'flex-start',
    marginTop: 3,
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: Radius.full,
    backgroundColor: Colors.goldAlpha10,
    borderWidth: 1,
    borderColor: Colors.goldAlpha30,
  },
  typePillText: {
    fontFamily: FontFamily.medium,
    fontSize: 8,
    color: Colors.goldLight,
    letterSpacing: 0.5,
  },

  // Sparkline
  sparkWrap: {
    width: SPARK_W,
    height: SPARK_H,
    marginHorizontal: Spacing[3],
    alignItems: 'center',
    justifyContent: 'center',
  },
  sparkPlaceholder: {
    width: SPARK_W,
    height: SPARK_H,
  },

  // Price/change
  rowRight: {
    width: 96,
    alignItems: 'flex-end',
  },
  priceText: {
    fontFamily: FontFamily.monoMedium,
    fontSize: FontSize.sm,
    color: Colors.textPrimary,
    marginBottom: 4,
  },
  changePill: {
    borderWidth: 1,
    borderRadius: Radius.full,
    paddingHorizontal: Spacing[2],
    paddingVertical: 2,
    minWidth: 60,
    alignItems: 'center',
  },
  changeText: {
    fontFamily: FontFamily.mono,
    fontSize: FontSize.xs,
  },
});
