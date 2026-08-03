/**
 * Shared trade header — Spot / Futures / Options tabs, pair picker, live price.
 * Tap the pair row to open an in-page pair list (no navigation to Markets tab).
 */
import React, { useState, useEffect, useRef } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useDispatch, useSelector } from 'react-redux';
import { RootState } from '../../store';
import { fetchMarketsLiteThunk } from '../../store/market.slice';
import CoinIcon from '../common/CoinIcon';
import Icon from '../common/AppIcon';
import TradePairPickerModal from './TradePairPickerModal';
import { Colors, FontFamily, FontSize, Spacing } from '../../theme';
import { formatPrice, formatPercent, isPositive } from '../../utils/formatters';
import { resolveSymbolForMarket, displayPairSlash, toSpotSymbol } from '../../utils/tradeSymbols';
import { useResolvedCoinLogo } from '../../hooks/useCoinLogoUrl';

const COIN_ICON = 32;

export type TradeMarketType = 'spot' | 'futures' | 'options';

const SPOT_TABS: { key: TradeMarketType; label: string }[] = [
  { key: 'spot', label: 'Spot' },
];

const DERIV_TABS: { key: TradeMarketType; label: string }[] = [
  { key: 'futures', label: 'Futures' },
  { key: 'options', label: 'Options' },
];

export type TradeStatChip = { label: string; value: string; valueColor?: string };

export type TradeMarketHeaderMode = 'spot' | 'derivatives' | 'none';

type Props = {
  symbol: string;
  price?: number;
  changePct?: number;
  stats?: TradeStatChip[];
  /** Optional right-side slot (e.g. futures margin balance) */
  rightSlot?: React.ReactNode;
  tag?: string;
  /** Spot trade hides futures/options; derivatives panel shows Futures | Options only */
  mode?: TradeMarketHeaderMode;
  /** Chart / support / transfer (derivatives toolbar) */
  onChartPress?: () => void;
  onTransferPress?: () => void;
};

function formatPair(symbol: string): string {
  if (symbol.includes('/')) {
    const slash = symbol.toUpperCase();
    if (slash.includes('-PERP') || slash.includes('-OPTIONS')) {
      return displayPairSlash(toSpotSymbol(symbol));
    }
    return slash;
  }
  return displayPairSlash(toSpotSymbol(symbol));
}

function HeaderStatChip({
  label, value, valueColor,
}: TradeStatChip) {
  return (
    <View style={styles.statChip}>
      <Text style={styles.statLabel} numberOfLines={1}>{label}</Text>
      <Text
        style={[styles.statValue, valueColor ? { color: valueColor } : null]}
        numberOfLines={1}
      >
        {value}
      </Text>
    </View>
  );
}

export default function TradeMarketHeader({
  symbol, price, changePct, stats, rightSlot, tag,
  mode = 'spot',
  onChartPress,
  onTransferPress,
}: Props) {
  const navigation = useNavigation<any>();
  const route      = useRoute<any>();
  const dispatch   = useDispatch();
  const marketList = useSelector((s: RootState) => s.market.marketList);
  const market: TradeMarketType = route.params?.market ?? (mode === 'derivatives' ? 'futures' : 'spot');
  const mktTabs = mode === 'derivatives' ? DERIV_TABS : mode === 'spot' ? SPOT_TABS : [];
  const positive   = isPositive(changePct ?? 0);
  const [pickerOpen, setPickerOpen] = useState(false);
  const coinLogoUrl = useResolvedCoinLogo(symbol);

  useEffect(() => {
    if (marketList.length === 0) {
      dispatch(fetchMarketsLiteThunk() as any);
    }
  }, [marketList.length, dispatch]);

  // Sync route symbol once per market+pair (avoid setParams loops)
  const paramSyncKey = useRef('');
  useEffect(() => {
    const resolved = resolveSymbolForMarket(symbol, market);
    const key = `${market}|${resolved}`;
    if (resolved === symbol || paramSyncKey.current === key) return;
    paramSyncKey.current = key;
    navigation.setParams({ symbol: resolved, market });
  }, [symbol, market, navigation]);

  const handleMarketSwitch = (mk: TradeMarketType) => {
    if (mk === market) return;
    const nextSymbol = resolveSymbolForMarket(symbol, mk);
    navigation.setParams({ symbol: nextSymbol, market: mk });
  };

  const openSupport = () => {
    navigation.navigate('Profile', { screen: 'Support' });
  };

  const handlePairSelect = (sym: string, mk: TradeMarketType) => {
    const nextSymbol = resolveSymbolForMarket(sym, mk);
    navigation.setParams({ symbol: nextSymbol, market: mk });
  };

  const openPicker = () => setPickerOpen(true);
  const hasStats = stats && stats.length > 0;

  return (
    <View style={styles.wrap}>
      <TradePairPickerModal
        visible={pickerOpen}
        currentSymbol={symbol}
        marketType={market}
        onClose={() => setPickerOpen(false)}
        onSelect={handlePairSelect}
      />

      {/* Top row: pair + live price beside name + toolbar icons */}
      <View style={styles.topRow}>
        <TouchableOpacity
          style={styles.pairCluster}
          onPress={openPicker}
          activeOpacity={0.75}
          hitSlop={{ top: 4, bottom: 4, left: 0, right: 8 }}
          accessibilityRole="button"
          accessibilityLabel="Change trading pair"
        >
          <CoinIcon symbol={symbol} size={COIN_ICON} logoUrl={coinLogoUrl} />
          <View style={styles.pairText}>
            {tag ? <Text style={styles.tag}>{tag}</Text> : null}
            <View style={styles.pairTitleRow}>
              <Text
                style={[styles.pairName, tag ? styles.pairNameCompact : null]}
                numberOfLines={1}
              >
                {formatPair(symbol)}
              </Text>
              <Icon name="chevron-down" size={14} color={Colors.goldLight} />
              {price != null && price > 0 ? (
                <>
                  <View style={styles.priceDivider} />
                  <Text
                    style={[styles.priceInline, { color: positive ? Colors.buyGreen : Colors.sellRed }]}
                    numberOfLines={1}
                  >
                    {formatPrice(price)}
                  </Text>
                  {changePct != null ? (
                    <Text
                      style={[styles.changeInline, { color: positive ? Colors.buyGreen : Colors.sellRed }]}
                      numberOfLines={1}
                    >
                      {formatPercent(changePct)}
                    </Text>
                  ) : null}
                </>
              ) : (
                <Text style={styles.pricePlaceholder} numberOfLines={1}>—</Text>
              )}
            </View>
          </View>
        </TouchableOpacity>

        <View style={styles.headerActions}>
          {onChartPress ? (
            <TouchableOpacity
              style={styles.iconBtn}
              onPress={onChartPress}
              activeOpacity={0.75}
            >
              <Icon name="chart-candlestick" size={20} color={Colors.goldLight} />
            </TouchableOpacity>
          ) : null}
          {onTransferPress ? (
            <TouchableOpacity
              style={styles.iconBtn}
              onPress={onTransferPress}
              activeOpacity={0.75}
              accessibilityLabel="Transfer funds"
            >
              <Icon name="swap-horizontal" size={20} color={Colors.goldLight} />
            </TouchableOpacity>
          ) : null}
          {mode === 'derivatives' ? (
            <TouchableOpacity style={styles.iconBtn} onPress={openSupport} activeOpacity={0.75}>
              <Icon name="headset-outline" size={20} color={Colors.goldLight} />
            </TouchableOpacity>
          ) : null}
          {rightSlot ? (
            <View style={styles.rightSlot}>
              {rightSlot}
            </View>
          ) : null}
        </View>
      </View>

      {/* 24h High / Low / Vol — horizontal strip in header */}
      {hasStats ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.statsScroll}
          contentContainerStyle={styles.statsScrollContent}
          nestedScrollEnabled
        >
          {stats!.map((st) => (
            <HeaderStatChip key={st.label} {...st} />
          ))}
        </ScrollView>
      ) : null}

      {mktTabs.length > 0 ? (
        <View style={styles.mktTabsRow}>
          {mktTabs.map(({ key, label }) => (
            <TouchableOpacity
              key={key}
              style={[styles.mktTab, market === key && styles.mktTabActive]}
              onPress={() => handleMarketSwitch(key)}
              activeOpacity={0.7}
            >
              <Text style={[styles.mktTabText, market === key && styles.mktTabTextActive]}>
                {label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: Colors.surfaceCard,
    borderBottomWidth: 1,
    borderBottomColor: Colors.surfaceBorder,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing[4],
    paddingTop: Spacing[3],
    paddingBottom: Spacing[1],
  },
  pairCluster: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    minWidth: 0,
    paddingRight: Spacing[1],
  },
  pairText: {
    marginLeft: Spacing[2],
    flex: 1,
    minWidth: 0,
    justifyContent: 'center',
  },
  pairTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minWidth: 0,
    flexWrap: 'nowrap',
  },
  pairName: {
    fontFamily: FontFamily.bold,
    fontSize: FontSize.lg,
    color: Colors.textPrimary,
    flexShrink: 1,
    marginRight: 4,
  },
  pairNameCompact: {
    fontFamily: FontFamily.semiBold,
    fontSize: FontSize.sm,
  },
  tag: {
    fontFamily: FontFamily.bold,
    fontSize: 8,
    color: Colors.goldLight,
    backgroundColor: Colors.goldAlpha15,
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 3,
    alignSelf: 'flex-start',
    marginBottom: 2,
    overflow: 'hidden',
  },
  priceDivider: {
    width: StyleSheet.hairlineWidth,
    height: 14,
    backgroundColor: Colors.surfaceBorder,
    marginHorizontal: 6,
    flexShrink: 0,
  },
  priceInline: {
    fontFamily: FontFamily.monoMedium,
    fontSize: FontSize.sm,
    flexShrink: 1,
    marginRight: 6,
  },
  changeInline: {
    fontFamily: FontFamily.medium,
    fontSize: 10,
    flexShrink: 0,
  },
  pricePlaceholder: {
    fontFamily: FontFamily.regular,
    fontSize: FontSize.sm,
    color: Colors.textMuted,
    marginLeft: 6,
    flexShrink: 0,
  },
  statsScroll: {
    flexGrow: 0,
  },
  statsScrollContent: {
    paddingHorizontal: Spacing[4],
    paddingBottom: Spacing[2],
    gap: Spacing[3],
  },
  statChip: {
    minWidth: 72,
    paddingRight: Spacing[2],
  },
  statLabel: {
    fontFamily: FontFamily.medium,
    fontSize: 10,
    color: Colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
  statValue: {
    fontFamily: FontFamily.semiBold,
    fontSize: FontSize.sm,
    color: Colors.textPrimary,
    marginTop: 2,
  },

  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    flexShrink: 0,
    marginLeft: Spacing[2],
    gap: 4,
  },
  iconBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: Colors.goldAlpha30,
    backgroundColor: Colors.goldAlpha10,
  },
  rightSlot: {
    marginLeft: Spacing[1],
    flexShrink: 0,
    maxWidth: 120,
    alignItems: 'flex-end',
    justifyContent: 'center',
  },

  mktTabsRow: {
    flexDirection: 'row',
    paddingHorizontal: Spacing[4],
    borderTopWidth: 1,
    borderTopColor: Colors.surfaceBorder,
  },
  mktTab: {
    flex: 1,
    paddingVertical: Spacing[3],
    alignItems: 'center',
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  mktTabActive: { borderBottomColor: Colors.gold },
  mktTabText: { fontFamily: FontFamily.medium, fontSize: FontSize.sm, color: Colors.textMuted },
  mktTabTextActive: { color: Colors.goldLight, fontFamily: FontFamily.semiBold },
});
