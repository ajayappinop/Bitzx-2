/**
 * Searchable pair picker — USDT majors + paginated IBO catalog (responsive bottom sheet).
 */
import React, { useEffect, useMemo, useState, useCallback } from 'react';
import {
  View, Text, Modal, StyleSheet, TouchableOpacity,
  TextInput, FlatList, Pressable, useWindowDimensions, ActivityIndicator, Platform,
} from 'react-native';
import { useDispatch, useSelector } from 'react-redux';
import { RootState } from '../../store';
import { fetchMarketsLiteThunk } from '../../store/market.slice';
import { loadIboCatalogOnce, getIboCatalogCached } from '../../services/sessionCatalogCache';
import { MarketRow } from '../../types/market.types';
import CoinIcon from '../common/CoinIcon';
import Icon from '../common/AppIcon';
import { Colors, FontFamily, FontSize, Spacing, Radius } from '../../theme';
import { formatPrice, formatPercent, isPositive } from '../../utils/formatters';
import { filterMarketsList, pairParts, parseMarketNum, dedupeMarketsBySymbol } from '../../utils/markets';
import type { TradeMarketType } from './TradeMarketHeader';
import { iosManualKeyboardScrollProps } from '@/utils/iosKeyboardScroll';

type SpotQuoteTab = 'all' | 'usdt' | 'ibo';

type Props = {
  visible: boolean;
  currentSymbol: string;
  marketType: TradeMarketType;
  onClose: () => void;
  onSelect: (symbol: string, market: TradeMarketType) => void;
};

const STATIC_USDT = ['IBOUSDT', 'BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'XRPUSDT', 'DOGEUSDT'];

function formatVolume(value: number | string | undefined): string {
  const n = parseMarketNum(value);
  if (n <= 0) return '—';
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return n.toFixed(2);
}

export default function TradePairPickerModal({
  visible, currentSymbol, marketType, onClose, onSelect,
}: Props) {
  const { width: screenW, height: screenH } = useWindowDimensions();
  const sheetH = Math.min(screenH * 0.88, 640);
  const dispatch = useDispatch();
  const { markets, marketList, loading } = useSelector((s: RootState) => s.market);
  const [search, setSearch] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  const [spotTab, setSpotTab] = useState<SpotQuoteTab>('all');
  const [iboCatalog, setIboCatalog] = useState<MarketRow[]>([]);
  const [iboCatalogLoading, setIboCatalogLoading] = useState(false);
  const [iboCatalogTotal, setIboCatalogTotal] = useState(0);

  const currentEx = currentSymbol.replace(/\//g, '').toUpperCase();

  useEffect(() => {
    if (visible && marketList.length === 0) {
      dispatch(fetchMarketsLiteThunk() as any);
    }
  }, [visible, marketList.length, dispatch]);

  useEffect(() => {
    if (!visible) {
      setSearch('');
      setDebouncedQ('');
      setSpotTab('all');
      setIboCatalog([]);
      setIboCatalogTotal(0);
    }
  }, [visible]);

  /** Full IBO catalog — once per app session when picker opens. */
  useEffect(() => {
    if (!visible || marketType !== 'spot') return;
    const cached = getIboCatalogCached();
    if (cached?.length) {
      setIboCatalog(cached);
      setIboCatalogTotal(cached.length);
      return;
    }
    let cancelled = false;
    setIboCatalogLoading(true);
    loadIboCatalogOnce()
      .then((list) => {
        if (cancelled) return;
        setIboCatalog(list);
        setIboCatalogTotal(list.length);
      })
      .catch(() => {
        if (!cancelled) setIboCatalog([]);
      })
      .finally(() => {
        if (!cancelled) setIboCatalogLoading(false);
      });
    return () => { cancelled = true; };
  }, [visible, marketType]);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(search.trim()), 280);
    return () => clearTimeout(t);
  }, [search]);

  const filterIboCatalog = useCallback((list: MarketRow[], q: string) => {
    if (!q) return list;
    const needle = q.toUpperCase();
    return list.filter((m) => {
      const { base, quote } = pairParts(m);
      return m.symbol.includes(needle) || base.includes(needle) || quote.includes(needle);
    });
  }, []);

  const usdtRows = useMemo(() => {
    const q = debouncedQ.toUpperCase();
    let rows = marketList
      .map((s) => markets[s])
      .filter((m): m is MarketRow => Boolean(m)
        && (m.market_type === 'spot' || !m.market_type)
        && (m.quote_asset === 'USDT' || m.symbol.endsWith('USDT')));
    if (q) {
      rows = rows.filter((m) => {
        const { base, quote } = pairParts(m);
        return m.symbol.includes(q) || base.includes(q) || quote.includes(q);
      });
    }
    const order = new Map(STATIC_USDT.map((s, i) => [s, i]));
    return dedupeMarketsBySymbol(rows).sort(
      (a, b) => (order.get(a.symbol) ?? 99) - (order.get(b.symbol) ?? 99),
    );
  }, [marketList, markets, debouncedQ]);

  const iboRows = useMemo(() => {
    const sorted = [...filterIboCatalog(iboCatalog, debouncedQ)].sort(
      (a, b) => parseMarketNum(b.volume_24h) - parseMarketNum(a.volume_24h),
    );
    return dedupeMarketsBySymbol(sorted);
  }, [iboCatalog, debouncedQ, filterIboCatalog]);

  const rows = useMemo(() => {
    if (marketType !== 'spot') {
      return filterMarketsList(marketList, markets, {
        typeTab: marketType,
        category: 'volume',
        search: debouncedQ,
      });
    }
    if (spotTab === 'usdt') return usdtRows;
    if (spotTab === 'ibo') return iboRows;
    return dedupeMarketsBySymbol([
      ...usdtRows,
      ...iboRows.filter((b) => !usdtRows.some((u) => u.symbol === b.symbol)),
    ]);
  }, [marketType, marketList, markets, debouncedQ, spotTab, usdtRows, iboRows]);

  const handleSelect = useCallback((m: MarketRow) => {
    const mtype = (m.market_type ?? 'spot') as TradeMarketType;
    onSelect(m.symbol, mtype);
    onClose();
  }, [onSelect, onClose]);

  const renderItem = useCallback(({ item: m }: { item: MarketRow }) => {
    const { base, quote } = pairParts(m);
    const pct = parseMarketNum(m.price_change_pct_24h);
    const pos = isPositive(pct);
    const selected = m.symbol.replace(/\//g, '').toUpperCase() === currentEx;
    const isIbo = quote === 'IBO';

    return (
      <TouchableOpacity
        style={[styles.row, selected && styles.rowSelected]}
        onPress={() => handleSelect(m)}
        activeOpacity={0.7}
      >
        <CoinIcon symbol={base} size={36} logoUrl={m.logo_url} />
        <View style={styles.rowMid}>
          <View style={styles.pairLine}>
            <Text style={styles.baseText} numberOfLines={1}>{base}</Text>
            {quote ? (
              <Text style={[styles.quoteText, isIbo && styles.quoteIbo]} numberOfLines={1}>/{quote}</Text>
            ) : null}
          </View>
          <Text style={styles.volText} numberOfLines={1}>Vol {formatVolume(m.volume_24h)}</Text>
        </View>
        <View style={styles.rowRight}>
          <Text style={styles.priceText} numberOfLines={1}>{formatPrice(m.last_price)}</Text>
          <Text style={[styles.pctText, { color: pos ? Colors.buyGreen : Colors.sellRed }]} numberOfLines={1}>
            {formatPercent(pct)}
          </Text>
        </View>
        {selected ? <Icon name="check" size={16} color={Colors.goldLight} /> : null}
      </TouchableOpacity>
    );
  }, [currentEx, handleSelect]);

  const keyExtractor = useCallback((m: MarketRow) => `${m.market_type ?? 'spot'}:${m.symbol}`, []);

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}
      statusBarTranslucent={Platform.OS === 'android'}
    >
      <View style={styles.modalRoot}>
        <Pressable style={styles.backdrop} onPress={onClose} />
        <View style={[styles.sheet, { height: sheetH, maxWidth: screenW }]}>
        <View style={styles.handle} />

        <View style={styles.header}>
          <Text style={styles.title}>Select pair</Text>
          <TouchableOpacity onPress={onClose} style={styles.closeBtn} hitSlop={12}>
            <Icon name="x" size={20} color={Colors.textSecondary} />
          </TouchableOpacity>
        </View>

        <View style={styles.searchBox}>
          <Icon name="search" size={16} color={Colors.textMuted} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search (e.g. BTC, DOT, ULTIMA)"
            placeholderTextColor={Colors.textDisabled}
            value={search}
            onChangeText={setSearch}
            autoCapitalize="characters"
            autoCorrect={false}
            selectionColor={Colors.gold}
          />
          {search.length > 0 ? (
            <TouchableOpacity onPress={() => setSearch('')} hitSlop={8}>
              <Icon name="x" size={14} color={Colors.textMuted} />
            </TouchableOpacity>
          ) : null}
        </View>

        {marketType === 'spot' ? (
          <View style={styles.spotTabs}>
            {([
              ['all', 'All'],
              ['usdt', 'USDT'],
              ['ibo', 'IBO'],
            ] as [SpotQuoteTab, string][]).map(([id, label]) => (
              <TouchableOpacity
                key={id}
                style={[styles.spotTabBtn, spotTab === id && styles.spotTabBtnActive]}
                onPress={() => setSpotTab(id)}
              >
                <Text style={[styles.spotTabTxt, spotTab === id && styles.spotTabTxtActive]}>{label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        ) : (
          <Text style={styles.subtitle}>
            {marketType.charAt(0).toUpperCase() + marketType.slice(1)} · by volume
          </Text>
        )}

        {marketType === 'spot' && (spotTab === 'ibo' || spotTab === 'all') ? (
          <Text style={styles.catalogHint}>
            {iboCatalogLoading
              ? 'Loading full IBO catalog…'
              : `${iboRows.length}${iboCatalogTotal ? ` of ${iboCatalogTotal}` : ''} IBO pairs`}
          </Text>
        ) : null}

        {iboCatalogLoading && !rows.length ? (
          <View style={styles.searchingRow}>
            <ActivityIndicator size="small" color={Colors.gold} />
            <Text style={styles.searchingTxt}>Loading all IBO markets…</Text>
          </View>
        ) : null}

        <FlatList
          style={styles.list}
          data={rows}
          keyExtractor={keyExtractor}
          renderItem={renderItem}
          showsVerticalScrollIndicator={false}
          {...iosManualKeyboardScrollProps()}
          initialNumToRender={16}
          maxToRenderPerBatch={12}
          windowSize={7}
          contentContainerStyle={styles.listContent}
          ListEmptyComponent={
            loading && !debouncedQ ? (
              <ActivityIndicator style={{ marginTop: Spacing[8] }} color={Colors.gold} />
            ) : (
              <View style={styles.center}>
                <Text style={styles.emptyText}>No pairs found</Text>
                {marketType === 'spot' && spotTab !== 'usdt' && !debouncedQ && !iboCatalogLoading ? (
                  <Text style={styles.emptyHint}>Pull to refresh markets if the list is empty</Text>
                ) : null}
              </View>
            )
          }
        />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalRoot: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: Colors.black60,
  },
  sheet: {
    backgroundColor: Colors.surfaceCard,
    borderTopLeftRadius: Radius.xl,
    borderTopRightRadius: Radius.xl,
    borderWidth: 1,
    borderBottomWidth: 0,
    borderColor: Colors.surfaceBorder,
    overflow: 'hidden',
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: Colors.surfaceBorder,
    alignSelf: 'center',
    marginTop: Spacing[2],
    marginBottom: Spacing[1],
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing[4],
    paddingVertical: Spacing[2],
  },
  title: {
    fontFamily: FontFamily.bold,
    fontSize: FontSize.lg,
    color: Colors.textPrimary,
    flex: 1,
  },
  closeBtn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 18,
    backgroundColor: Colors.surfaceHover,
  },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: Spacing[4],
    marginBottom: Spacing[2],
    paddingHorizontal: Spacing[3],
    minHeight: 44,
    backgroundColor: Colors.surfaceHover,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
  },
  searchInput: {
    flex: 1,
    minWidth: 0,
    marginLeft: Spacing[2],
    fontFamily: FontFamily.regular,
    fontSize: FontSize.sm,
    color: Colors.textPrimary,
    paddingVertical: Spacing[2],
  },
  spotTabs: {
    flexDirection: 'row',
    gap: Spacing[2],
    paddingHorizontal: Spacing[4],
    marginBottom: Spacing[2],
  },
  spotTabBtn: {
    flex: 1,
    minWidth: 0,
    paddingVertical: Spacing[2],
    alignItems: 'center',
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    backgroundColor: Colors.surfaceHover,
  },
  spotTabBtnActive: {
    backgroundColor: Colors.goldAlpha15,
    borderColor: Colors.goldAlpha30,
  },
  spotTabTxt: {
    fontFamily: FontFamily.bold,
    fontSize: FontSize.xs,
    color: Colors.textMuted,
  },
  spotTabTxtActive: { color: Colors.goldLight },
  subtitle: {
    fontFamily: FontFamily.regular,
    fontSize: 10,
    color: Colors.textMuted,
    paddingHorizontal: Spacing[4],
    marginBottom: Spacing[2],
  },
  searchingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing[2],
    paddingHorizontal: Spacing[4],
    paddingBottom: Spacing[2],
  },
  searchingTxt: { fontFamily: FontFamily.regular, fontSize: FontSize.xs, color: Colors.textMuted },
  catalogHint: {
    fontFamily: FontFamily.regular,
    fontSize: FontSize.xs,
    color: Colors.textMuted,
    paddingHorizontal: Spacing[4],
    marginBottom: Spacing[1],
  },
  list: { flex: 1 },
  listContent: { paddingBottom: Spacing[10] },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing[4],
    paddingVertical: Spacing[3],
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.surfaceBorder,
    gap: Spacing[2],
  },
  rowSelected: { backgroundColor: Colors.goldAlpha10 },
  rowMid: { flex: 1, minWidth: 0, marginLeft: Spacing[1] },
  pairLine: { flexDirection: 'row', alignItems: 'baseline', flexWrap: 'wrap' },
  baseText: { fontFamily: FontFamily.semiBold, fontSize: FontSize.base, color: Colors.textPrimary },
  quoteText: { fontFamily: FontFamily.regular, fontSize: FontSize.sm, color: Colors.textMuted },
  quoteIbo: { color: Colors.goldLight },
  volText: { fontFamily: FontFamily.regular, fontSize: 10, color: Colors.textMuted, marginTop: 2 },
  rowRight: { alignItems: 'flex-end', maxWidth: '38%', marginRight: Spacing[1] },
  priceText: { fontFamily: FontFamily.monoMedium, fontSize: FontSize.sm, color: Colors.textPrimary },
  pctText: { fontFamily: FontFamily.medium, fontSize: FontSize.xs, marginTop: 2 },
  center: { alignItems: 'center', justifyContent: 'center', paddingVertical: Spacing[10], paddingHorizontal: Spacing[4] },
  emptyText: { fontFamily: FontFamily.regular, fontSize: FontSize.sm, color: Colors.textMuted, textAlign: 'center' },
  emptyHint: { fontFamily: FontFamily.regular, fontSize: FontSize.xs, color: Colors.textDisabled, marginTop: Spacing[2], textAlign: 'center' },
});
