/**
 * IBO Markets — paginated catalog, search, tier tabs, live WS overlay.
 *
 * Performance design:
 *  - Module-level page cache: second visit is instant (stale-while-revalidate).
 *  - Single stable WebSocket: does NOT reconnect on tier / search changes.
 *  - No async logo waterfall: logos resolve synchronously from already-cached map.
 *  - Memoized list header: WS price ticks don't cause header re-renders.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet,
  ActivityIndicator, TextInput, RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CompositeNavigationProp, useIsFocused, useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import { iboMarketsWsUrl } from '../../config/wsConfig';
import { Colors, FontFamily, FontSize, Spacing, Radius } from '../../theme';
import CoinIcon from '../../components/common/CoinIcon';
import Icon from '../../components/common/AppIcon';
import { marketApi } from '../../api/market.api';
import { MainTabParamList, TradingStackParamList } from '../../navigation/types';
import { iosManualKeyboardScrollProps } from '@/utils/iosKeyboardScroll';

type NavProp = CompositeNavigationProp<
  NativeStackNavigationProp<TradingStackParamList, 'IBOMarkets'>,
  BottomTabNavigationProp<MainTabParamList>
>;

function openSpotTrade(nav: NavProp, symbol: string) {
  nav.getParent()?.navigate('Trade', {
    screen: 'TradePair',
    params: { symbol, market: 'spot' },
  });
}

type TierId = 'featured' | 'major' | 'web3' | 'all';

interface IboMarketRow {
  symbol: string;
  base: string;
  logo_url?: string;
  price: string;
  priceChangePercent: string;
  highPrice?: string;
  lowPrice?: string;
  volume?: string;
}

function dedupeBySymbol(rows: IboMarketRow[]): IboMarketRow[] {
  const bySym = new Map<string, IboMarketRow>();
  for (const row of rows) {
    const sym = String(row.symbol ?? '').trim().toUpperCase();
    if (!sym) continue;
    const prev = bySym.get(sym);
    if (!prev) { bySym.set(sym, { ...row, symbol: sym }); continue; }
    if (!String(prev.logo_url ?? '').trim() && String(row.logo_url ?? '').trim()) {
      bySym.set(sym, { ...row, symbol: sym });
    }
  }
  return [...bySym.values()];
}

const PAGE_SIZE = 40;
const TIER_TABS: { id: TierId; label: string }[] = [
  { id: 'all',      label: 'All'      },
  { id: 'web3',     label: 'Web3'     },
  { id: 'major',    label: 'Majors'   },
  { id: 'featured', label: 'Featured' },
];

function pct(v: string | number): number {
  return parseFloat(String(v) || '0') || 0;
}

function normalizeRow(raw: Record<string, unknown>): IboMarketRow {
  const sym = String(raw.symbol ?? '').toUpperCase();
  const base = String(raw.base ?? raw.baseAsset ?? sym.replace(/IBO$/, ''));
  return {
    symbol: sym,
    base,
    logo_url: raw.logo_url != null ? String(raw.logo_url) : undefined,
    price: String(raw.price ?? '0'),
    priceChangePercent: String(raw.priceChangePercent ?? raw.price_change_pct_24h ?? '0'),
    highPrice: raw.highPrice != null ? String(raw.highPrice) : undefined,
    lowPrice: raw.lowPrice != null ? String(raw.lowPrice) : undefined,
    volume: raw.volume != null ? String(raw.volume) : undefined,
  };
}

// ─── Module-level page cache (stale-while-revalidate) ─────────────────────────
interface PageCache {
  items: IboMarketRow[];
  total: number;
  catalogTotal: number;
  iboPrice: number;
  fetchedAt: number;
}
const CACHE_TTL_MS = 30_000; // 30 s
const pageCache = new Map<string, PageCache>();

function cacheKey(tier: TierId, q: string): string {
  return `${tier}|${q.trim().toLowerCase()}`;
}

// ─── Row ──────────────────────────────────────────────────────────────────────

const PairRow = React.memo(function PairRow({
  market,
  onPress,
}: {
  market: IboMarketRow;
  onPress: (symbol: string) => void;
}) {
  const base = market.base || market.symbol.replace(/IBO$/, '');
  const change = pct(market.priceChangePercent);
  const isUp = change >= 0;
  const price = parseFloat(market.price || '0');

  return (
    <TouchableOpacity
      style={styles.row}
      onPress={() => onPress(market.symbol)}
      activeOpacity={0.7}
    >
      <View style={styles.rowLeft}>
        <CoinIcon symbol={base} size={36} logoUrl={market.logo_url} />
        <View style={styles.rowNames}>
          <Text style={styles.rowBase} numberOfLines={1}>
            {base}<Text style={styles.rowQuote}>/IBO</Text>
          </Text>
          <Text style={styles.rowSym} numberOfLines={1}>{market.symbol}</Text>
        </View>
      </View>
      <View style={styles.rowRight}>
        <Text style={styles.rowPrice} numberOfLines={1}>
          {price > 0
            ? price.toLocaleString(undefined, { maximumFractionDigits: 6 })
            : '—'}
        </Text>
        <View style={[styles.changeBadge, isUp ? styles.changeBadgeUp : styles.changeBadgeDown]}>
          <Text style={[styles.changeText, isUp ? styles.changeUp : styles.changeDown]}>
            {isUp ? '+' : ''}{change.toFixed(2)}%
          </Text>
        </View>
      </View>
    </TouchableOpacity>
  );
});

// ─── Header ───────────────────────────────────────────────────────────────────

type HeaderProps = {
  iboPrice: number;
  iboChange: number;
  query: string;
  tier: TierId;
  subtitle: string;
  onQueryChange: (q: string) => void;
  onTierChange: (t: TierId) => void;
  onIboPress: () => void;
};

const ListHeader = React.memo(function ListHeader({
  iboPrice, iboChange, query, tier, subtitle,
  onQueryChange, onTierChange, onIboPress,
}: HeaderProps) {
  const isUp = iboChange >= 0;
  return (
    <>
      <TouchableOpacity style={styles.banner} onPress={onIboPress} activeOpacity={0.85}>
        <View style={styles.bannerLeft}>
          <CoinIcon symbol="IBO" size={40} />
          <View style={styles.bannerTextWrap}>
            <Text style={styles.bannerTitle} numberOfLines={1}>IBO Token</Text>
            <Text style={styles.bannerSub} numberOfLines={1}>Tap to trade IBO/USDT</Text>
          </View>
        </View>
        <View style={styles.bannerRight}>
          <Text style={styles.bannerPriceLbl}>IBO/USDT</Text>
          <Text style={styles.bannerPrice}>${iboPrice > 0 ? iboPrice.toFixed(4) : '—'}</Text>
          <Text style={[styles.bannerChange, isUp ? styles.changeUp : styles.changeDown]}>
            {isUp ? '+' : ''}{iboChange.toFixed(2)}%
          </Text>
        </View>
      </TouchableOpacity>

      <View style={styles.searchWrap}>
        <Icon name="search" size={18} color={Colors.textMuted} />
        <TextInput
          style={styles.searchInput}
          placeholder="Search IBO pairs…"
          placeholderTextColor={Colors.textMuted}
          value={query}
          onChangeText={onQueryChange}
          autoCapitalize="characters"
          autoCorrect={false}
          clearButtonMode="while-editing"
        />
        {query.length > 0 && (
          <TouchableOpacity onPress={() => onQueryChange('')} hitSlop={8}>
            <Icon name="close-circle" size={18} color={Colors.textMuted} />
          </TouchableOpacity>
        )}
      </View>

      <View style={styles.tierRow}>
        {TIER_TABS.map((t) => (
          <TouchableOpacity
            key={t.id}
            style={[styles.tierChip, tier === t.id && styles.tierChipActive]}
            onPress={() => onTierChange(t.id)}
          >
            <Text style={[styles.tierChipText, tier === t.id && styles.tierChipTextActive]}>
              {t.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <View style={styles.listHeader}>
        <Text style={styles.listHeaderLeft}>Pair</Text>
        <Text style={styles.listHeaderRight}>Price / 24h</Text>
      </View>
      <Text style={styles.countLine}>{subtitle}</Text>
    </>
  );
});

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function IBOMarketsScreen() {
  const navigation = useNavigation<NavProp>();
  const isFocused = useIsFocused();

  const [tier, setTier] = useState<TierId>('all');
  const [query, setQuery] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');

  const [items, setItems]               = useState<IboMarketRow[]>(() => {
    const cached = pageCache.get(cacheKey('all', ''));
    return cached ? cached.items : [];
  });
  const [total, setTotal]               = useState<number>(() => {
    return pageCache.get(cacheKey('all', ''))?.total ?? 0;
  });
  const [catalogTotal, setCatalogTotal] = useState(0);
  const [iboPrice, setIboPrice]         = useState(() => {
    return pageCache.get(cacheKey('all', ''))?.iboPrice ?? 0;
  });
  const [iboChange, setIboChange]       = useState(0);

  const [loading, setLoading]       = useState(() => {
    const c = pageCache.get(cacheKey('all', ''));
    return !c || Date.now() - c.fetchedAt > CACHE_TTL_MS;
  });
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing]   = useState(false);

  const skipRef = useRef(0);

  // ── Debounce search ────────────────────────────────────────────────────────
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(query.trim()), 280);
    return () => clearTimeout(t);
  }, [query]);

  // ── REST fetch (tier / search / pagination) ────────────────────────────────
  const fetchPage = useCallback(async (append = false) => {
    const skip = append ? skipRef.current : 0;
    if (!append) {
      // Show stale cache instantly, then revalidate.
      const stale = pageCache.get(cacheKey(tier, debouncedQ));
      if (stale && !append) {
        setItems(stale.items);
        setTotal(stale.total);
        setCatalogTotal(stale.catalogTotal);
        setIboPrice((p) => stale.iboPrice || p);
        skipRef.current = stale.items.length;
        // Only show spinner if cache is old.
        if (Date.now() - stale.fetchedAt < CACHE_TTL_MS) { setLoading(false); return; }
        setLoading(false); // show stale immediately, fetch silently
      } else {
        setLoading(true);
      }
    } else {
      setLoadingMore(true);
    }

    try {
      const { data } = await marketApi.getIBOMarkets({
        tier,
        q: debouncedQ || undefined,
        skip,
        limit: PAGE_SIZE,
      });
      const list = dedupeBySymbol(
        (data?.markets ?? []).map((m) => normalizeRow(m as Record<string, unknown>)),
      );
      const newItems = append ? dedupeBySymbol([...items, ...list]) : list;
      setItems(newItems);
      const newTotal = Number(data?.total) || list.length;
      setTotal(newTotal);
      const newCatalogTotal = Number(data?.total_catalog) || 0;
      setCatalogTotal(newCatalogTotal);
      const summary = data as { ibo_usdt_price?: number; summary?: { ibo_usdt_price?: number } };
      const px = summary?.ibo_usdt_price ?? summary?.summary?.ibo_usdt_price;
      if (px != null && Number.isFinite(Number(px))) setIboPrice(Number(px));
      skipRef.current = skip + list.length;

      if (!append) {
        pageCache.set(cacheKey(tier, debouncedQ), {
          items: newItems,
          total: newTotal,
          catalogTotal: newCatalogTotal,
          iboPrice: px != null && Number.isFinite(Number(px)) ? Number(px) : iboPrice,
          fetchedAt: Date.now(),
        });
      }
    } catch {
      if (!append) setItems([]);
    } finally {
      setLoading(false);
      setLoadingMore(false);
      setRefreshing(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tier, debouncedQ]);

  useEffect(() => {
    skipRef.current = 0;
    fetchPage(false);
  }, [fetchPage]);

  // ── WebSocket — single stable connection, only updates featured prices ─────
  const wsRef       = useRef<WebSocket | null>(null);
  const reconnTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const connectWs = useCallback(() => {
    if (wsRef.current) { try { wsRef.current.close(); } catch { /* ignore */ } }
    const ws = new WebSocket(iboMarketsWsUrl());
    wsRef.current = ws;
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        if (msg.type !== 'ibo_markets') return;
        if (msg.ibo_usdt_price != null) setIboPrice(parseFloat(String(msg.ibo_usdt_price)));
        if (msg.ibo_change_pct != null) setIboChange(parseFloat(String(msg.ibo_change_pct)));
        // Only apply live price patches when on featured/all with no search.
        if (Array.isArray(msg.markets) && msg.markets.length) {
          const live = dedupeBySymbol(msg.markets.map((m: Record<string, unknown>) => normalizeRow(m)));
          const liveMap: Record<string, IboMarketRow> = {};
          for (const r of live) liveMap[r.symbol] = r;
          setItems((prev) => dedupeBySymbol(prev.map((row) => liveMap[row.symbol] ?? row)));
        }
      } catch { /* ignore */ }
    };
    ws.onclose = () => { reconnTimer.current = setTimeout(connectWs, 4000); };
  // connectWs intentionally has no deps — WS is independent of tier/search
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!isFocused) {
      if (reconnTimer.current) clearTimeout(reconnTimer.current);
      if (wsRef.current) { try { wsRef.current.close(); } catch { /* ignore */ } wsRef.current = null; }
      return;
    }
    connectWs();
    return () => {
      if (reconnTimer.current) clearTimeout(reconnTimer.current);
      if (wsRef.current) { try { wsRef.current.close(); } catch { /* ignore */ } }
    };
  }, [connectWs, isFocused]);

  // ── Handlers ──────────────────────────────────────────────────────────────
  const hasMore = items.length < total;

  const handlePress = useCallback((symbol: string) => {
    openSpotTrade(navigation, symbol);
  }, [navigation]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    skipRef.current = 0;
    fetchPage(false);
  }, [fetchPage]);

  const loadMore = useCallback(() => {
    if (loadingMore || loading || !hasMore) return;
    fetchPage(true);
  }, [loadingMore, loading, hasMore, fetchPage]);

  const goListCoin = useCallback(() => {
    const root = navigation.getParent()?.getParent() as { navigate: (a: string, b?: object) => void } | undefined;
    root?.navigate('Profile', { screen: 'ListCoin' });
  }, [navigation]);

  const handleIboPress = useCallback(() => openSpotTrade(navigation, 'IBOUSDT'), [navigation]);

  const onQueryChange = useCallback((q: string) => setQuery(q), []);
  const onTierChange  = useCallback((t: TierId) => {
    setTier(t);
    skipRef.current = 0;
  }, []);

  // ── Memoized stable renderItem ─────────────────────────────────────────────
  const renderItem = useCallback(
    ({ item }: { item: IboMarketRow }) => <PairRow market={item} onPress={handlePress} />,
    [handlePress],
  );

  const subtitle = useMemo(() => {
    if (catalogTotal > 0) return `${items.length} of ${total} · ${catalogTotal} in catalog`;
    return `${items.length} pairs`;
  }, [items.length, total, catalogTotal]);

  // Memoized header — only re-renders when iboPrice/iboChange/query/tier change
  const listHeader = useMemo(() => (
    <ListHeader
      iboPrice={iboPrice}
      iboChange={iboChange}
      query={query}
      tier={tier}
      subtitle={subtitle}
      onQueryChange={onQueryChange}
      onTierChange={onTierChange}
      onIboPress={handleIboPress}
    />
  ), [iboPrice, iboChange, query, tier, subtitle, onQueryChange, onTierChange, handleIboPress]);

  const refreshControl = useMemo(
    () => <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.gold} />,
    [refreshing, onRefresh],
  );

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.navBar}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn} hitSlop={12}>
          <Icon name="chevron-left" size={24} color={Colors.goldLight} />
        </TouchableOpacity>
        <Text style={styles.navTitle} numberOfLines={1}>IBO Markets</Text>
        <TouchableOpacity onPress={goListCoin} style={styles.listBtn} hitSlop={8}>
          <Icon name="plus-circle-outline" size={20} color={Colors.goldLight} />
        </TouchableOpacity>
      </View>

      {loading && items.length === 0 ? (
        <ActivityIndicator style={styles.loader} color={Colors.gold} />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item, index) => `${String(item.symbol ?? '').trim().toUpperCase()}::${index}`}
          {...iosManualKeyboardScrollProps()}
          renderItem={renderItem}
          ListHeaderComponent={listHeader}
          ListFooterComponent={
            loadingMore ? (
              <ActivityIndicator style={styles.footerLoader} color={Colors.gold} />
            ) : (
              <View style={styles.footer}>
                <Text style={styles.footerText}>Prices in IBO · Live updates</Text>
                <TouchableOpacity onPress={goListCoin} style={styles.footerLink}>
                  <Text style={styles.footerLinkText}>List your coin on Ibo →</Text>
                </TouchableOpacity>
              </View>
            )
          }
          refreshControl={refreshControl}
          onEndReached={loadMore}
          onEndReachedThreshold={0.35}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
          contentContainerStyle={styles.listContent}
          {...iosManualKeyboardScrollProps()}
          initialNumToRender={20}
          maxToRenderPerBatch={15}
          windowSize={7}
          removeClippedSubviews
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.surface },
  navBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing[4],
    paddingVertical: Spacing[2],
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255,255,255,0.08)',
  },
  backBtn: { paddingRight: Spacing[2] },
  navTitle: {
    flex: 1,
    fontSize: FontSize.lg,
    fontFamily: FontFamily.bold,
    color: Colors.textPrimary,
    minWidth: 0,
  },
  listBtn: { padding: 4 },
  banner: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: Spacing[4],
    paddingVertical: Spacing[4],
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255,255,255,0.08)',
    backgroundColor: 'rgba(155,121,65,0.06)',
    gap: Spacing[2],
  },
  bannerLeft: { flexDirection: 'row', alignItems: 'center', gap: Spacing[2], flex: 1, minWidth: 0 },
  bannerTextWrap: { flex: 1, minWidth: 0 },
  bannerTitle: { fontSize: FontSize.lg, fontFamily: FontFamily.bold, color: Colors.textPrimary },
  bannerSub: { fontSize: FontSize.xs, color: Colors.textMuted, marginTop: 2 },
  bannerRight: { alignItems: 'flex-end', flexShrink: 0 },
  bannerPriceLbl: { fontSize: FontSize.xs, color: Colors.textMuted },
  bannerPrice: { fontSize: FontSize.xl, fontFamily: FontFamily.bold, color: Colors.gold },
  bannerChange: { fontSize: FontSize.sm, fontFamily: FontFamily.semiBold },
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: Spacing[4],
    marginTop: Spacing[3],
    marginBottom: Spacing[2],
    paddingHorizontal: Spacing[3],
    paddingVertical: Spacing[2],
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    backgroundColor: Colors.surfaceDark,
    gap: Spacing[2],
  },
  searchInput: {
    flex: 1,
    minWidth: 0,
    fontFamily: FontFamily.regular,
    fontSize: FontSize.sm,
    color: Colors.textPrimary,
    paddingVertical: 0,
  },
  tierRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing[2],
    paddingHorizontal: Spacing[4],
    marginBottom: Spacing[2],
  },
  tierChip: {
    paddingHorizontal: Spacing[3],
    paddingVertical: Spacing[1],
    borderRadius: Radius.full,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    backgroundColor: Colors.surfaceDark,
  },
  tierChipActive: { borderColor: Colors.goldAlpha30, backgroundColor: Colors.goldAlpha15 },
  tierChipText: { fontFamily: FontFamily.medium, fontSize: FontSize.xs, color: Colors.textMuted },
  tierChipTextActive: { color: Colors.goldLight, fontFamily: FontFamily.bold },
  listHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing[4],
    paddingVertical: Spacing[1],
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255,255,255,0.06)',
  },
  listHeaderLeft: { fontSize: FontSize.xs, color: Colors.textMuted },
  listHeaderRight: { fontSize: FontSize.xs, color: Colors.textMuted },
  countLine: {
    fontSize: FontSize.xs,
    color: Colors.textMuted,
    paddingHorizontal: Spacing[4],
    paddingBottom: Spacing[1],
  },
  listContent: { paddingBottom: Spacing[8] },
  separator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(255,255,255,0.06)',
    marginLeft: Spacing[4],
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing[4],
    paddingVertical: Spacing[2],
    gap: Spacing[2],
  },
  rowLeft: { flexDirection: 'row', alignItems: 'center', gap: Spacing[2], flex: 1, minWidth: 0 },
  rowNames: { flex: 1, minWidth: 0 },
  rowBase: { fontSize: FontSize.md, fontFamily: FontFamily.bold, color: Colors.textPrimary },
  rowQuote: { fontFamily: FontFamily.regular, color: Colors.textMuted },
  rowSym: { fontSize: FontSize.xs, color: Colors.textMuted, marginTop: 2 },
  rowRight: { alignItems: 'flex-end', gap: 4, flexShrink: 0 },
  rowPrice: {
    fontSize: FontSize.md,
    fontFamily: FontFamily.semiBold,
    color: Colors.textPrimary,
    fontVariant: ['tabular-nums'],
  },
  changeBadge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: Radius.sm },
  changeBadgeUp: { backgroundColor: 'rgba(34,197,94,0.12)' },
  changeBadgeDown: { backgroundColor: 'rgba(239,68,68,0.12)' },
  changeText: { fontSize: FontSize.xs, fontFamily: FontFamily.semiBold },
  changeUp: { color: Colors.buyGreen },
  changeDown: { color: Colors.sellRed },
  loader: { flex: 1, justifyContent: 'center' },
  footerLoader: { paddingVertical: Spacing[4] },
  footer: {
    paddingHorizontal: Spacing[4],
    paddingVertical: Spacing[4],
    alignItems: 'center',
  },
  footerText: { fontSize: FontSize.xs, color: Colors.textMuted },
  footerLink: { marginTop: Spacing[2] },
  footerLinkText: { fontSize: FontSize.sm, fontFamily: FontFamily.bold, color: Colors.goldLight },
});
