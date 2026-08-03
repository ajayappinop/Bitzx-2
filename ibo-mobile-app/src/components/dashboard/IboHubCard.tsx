import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import Icon from '../common/AppIcon';
import CoinIcon from '../common/CoinIcon';
import { Colors, FontFamily, FontSize, Spacing, Radius } from '../../theme';
import { formatPercent, formatPrice, isPositive } from '../../utils/formatters';
import { MarketRow } from '../../types/market.types';
import { parseMarketNum } from '../../utils/markets';

type Props = {
  iboMarket?: MarketRow;
  iboBalance?: number;
  onTradeIbo: () => void;
  onIboMarkets: () => void;
  onListCoin: () => void;
};

export default function IboHubCard({
  iboMarket,
  iboBalance = 0,
  onTradeIbo,
  onIboMarkets,
  onListCoin,
}: Props) {
  const price = parseMarketNum(iboMarket?.last_price);
  const chg = parseMarketNum(iboMarket?.price_change_pct_24h);
  const up = isPositive(chg);

  return (
    <View style={styles.wrap}>
      <View style={styles.card}>
        <View style={styles.topRow}>
          <CoinIcon symbol="IBO" size={44} />
          <View style={styles.titleBlock}>
            <Text style={styles.title}>IBO Token (IBO)</Text>
            <Text style={styles.sub}>Platform token · IBO/USDT & IBO-quoted pairs</Text>
          </View>
          {price > 0 ? (
            <View style={styles.priceBlock}>
              <Text style={styles.price}>{formatPrice(price)}</Text>
              <Text style={[styles.chg, up ? styles.chgUp : styles.chgDown]}>
                {formatPercent(chg)}
              </Text>
            </View>
          ) : null}
        </View>

        {iboBalance > 0 ? (
          <Text style={styles.holdings}>
            Your holdings: {iboBalance.toLocaleString(undefined, { maximumFractionDigits: 4 })} IBO
          </Text>
        ) : null}

        <View style={styles.actions}>
          <TouchableOpacity style={[styles.btn, styles.btnPrimary]} onPress={onTradeIbo} activeOpacity={0.85}>
            <Icon name="chart-line" size={16} color={Colors.surfaceDark} />
            <Text style={styles.btnPrimaryText}>Trade IBO/USDT</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.btn, styles.btnSecondary]} onPress={onIboMarkets} activeOpacity={0.85}>
            <Icon name="view-grid-outline" size={16} color={Colors.goldLight} />
            <Text style={styles.btnSecondaryText}>IBO Markets</Text>
          </TouchableOpacity>
        </View>
      </View>

      <TouchableOpacity style={styles.listRow} onPress={onListCoin} activeOpacity={0.8}>
        <Icon name="plus-circle-outline" size={18} color={Colors.goldLight} />
        <View style={styles.listText}>
          <Text style={styles.listTitle}>List your coin</Text>
          <Text style={styles.listSub}>Apply for token listing on Ibo Exchange</Text>
        </View>
        <Icon name="chevron-right" size={20} color={Colors.textMuted} />
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginHorizontal: Spacing[5],
    marginBottom: Spacing[4],
    gap: Spacing[2],
  },
  card: {
    borderRadius: Radius.xl,
    borderWidth: 1,
    borderColor: Colors.goldAlpha30,
    backgroundColor: Colors.goldAlpha10,
    padding: Spacing[4],
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing[3],
  },
  titleBlock: { flex: 1 },
  title: {
    fontFamily: FontFamily.bold,
    fontSize: FontSize.md,
    color: Colors.textPrimary,
  },
  sub: {
    fontFamily: FontFamily.regular,
    fontSize: FontSize.xs,
    color: Colors.textMuted,
    marginTop: 2,
  },
  priceBlock: { alignItems: 'flex-end' },
  price: {
    fontFamily: FontFamily.bold,
    fontSize: FontSize.md,
    color: Colors.goldLight,
  },
  chg: {
    fontFamily: FontFamily.semiBold,
    fontSize: FontSize.xs,
    marginTop: 2,
  },
  chgUp: { color: Colors.buyGreen },
  chgDown: { color: Colors.sellRed },
  holdings: {
    fontFamily: FontFamily.regular,
    fontSize: FontSize.xs,
    color: Colors.textSecondary,
    marginTop: Spacing[3],
  },
  actions: {
    flexDirection: 'row',
    gap: Spacing[2],
    marginTop: Spacing[4],
  },
  btn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: Spacing[2],
    borderRadius: Radius.lg,
  },
  btnPrimary: {
    backgroundColor: Colors.gold,
  },
  btnPrimaryText: {
    fontFamily: FontFamily.bold,
    fontSize: FontSize.sm,
    color: Colors.surfaceDark,
  },
  btnSecondary: {
    borderWidth: 1,
    borderColor: Colors.goldAlpha30,
    backgroundColor: 'rgba(0,0,0,0.2)',
  },
  btnSecondaryText: {
    fontFamily: FontFamily.bold,
    fontSize: FontSize.sm,
    color: Colors.goldLight,
  },
  listRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing[3],
    padding: Spacing[3],
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    backgroundColor: Colors.surfaceCard,
  },
  listText: { flex: 1 },
  listTitle: {
    fontFamily: FontFamily.bold,
    fontSize: FontSize.sm,
    color: Colors.textPrimary,
  },
  listSub: {
    fontFamily: FontFamily.regular,
    fontSize: FontSize.xs,
    color: Colors.textMuted,
    marginTop: 2,
  },
});
