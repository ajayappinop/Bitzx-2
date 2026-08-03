import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, ScrollView, StyleSheet,
  TouchableOpacity,
} from 'react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { ProfileStackParamList } from '../../navigation/types';
import apiClient from '../../api/client';
import { EP } from '../../api/endpoints';
import { parseApiError } from '../../api/errors';
import { Trade } from '../../types/trading.types';
import SafeAreaWrapper from '../../components/common/SafeAreaWrapper';
import ErrorBanner from '../../components/common/ErrorBanner';
import { Colors, FontFamily, FontSize, Spacing, Radius } from '../../theme';
import { formatUSD, formatPrice, formatDateTime, formatPercent } from '../../utils/formatters';

type Props = {
  navigation: NativeStackNavigationProp<ProfileStackParamList, 'ProfileHome'>;
};

type PeriodKey = '7D' | '30D' | '3M' | 'ALL';

const PERIODS: PeriodKey[] = ['7D', '30D', '3M', 'ALL'];

function calcStats(trades: Trade[]) {
  let totalPnl = 0;
  let winCount = 0;
  let lossCount = 0;
  let totalFees = 0;
  let bestTrade = 0;
  let worstTrade = 0;

  for (const t of trades) {
    const pnl = t.pnl ?? 0;
    totalPnl += pnl;
    totalFees += t.fee ?? 0;
    if (pnl > 0) winCount++;
    if (pnl < 0) lossCount++;
    if (pnl > bestTrade) bestTrade = pnl;
    if (pnl < worstTrade) worstTrade = pnl;
  }

  const totalTrades = trades.length;
  const winRate = totalTrades > 0 ? (winCount / totalTrades) * 100 : 0;

  return { totalPnl, winCount, lossCount, totalFees, bestTrade, worstTrade, totalTrades, winRate };
}

function filterByPeriod(trades: Trade[], period: PeriodKey): Trade[] {
  if (period === 'ALL') return trades;
  const days = { '7D': 7, '30D': 30, '3M': 90 }[period];
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  return trades.filter(t => new Date(t.created_at).getTime() >= cutoff);
}

interface StatCardProps {
  label: string;
  value: string;
  valueColor?: string;
  sub?: string;
}

function StatCard({ label, value, valueColor, sub }: StatCardProps) {
  return (
    <View style={styles.statCard}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={[styles.statValue, valueColor ? { color: valueColor } : {}]}>{value}</Text>
      {sub ? <Text style={styles.statSub}>{sub}</Text> : null}
    </View>
  );
}

export default function PnLAnalyticsScreen() {
  const [trades, setTrades] = useState<Trade[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [period, setPeriod] = useState<PeriodKey>('30D');
  const [banner, setBanner] = useState('');

  const load = useCallback(async () => {
    try {
      const { data } = await apiClient.get(EP.ORDERS_TRADES, { params: { limit: 500 } });
      setTrades(Array.isArray(data) ? data : []);
    } catch (err) {
      setBanner(parseApiError(err).message);
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const filteredTrades = filterByPeriod(trades, period);
  const stats = calcStats(filteredTrades);

  // Build daily PnL series for simple bar chart
  const dailyPnL = filteredTrades.reduce((acc: Record<string, number>, t) => {
    const day = t.created_at.slice(0, 10);
    acc[day] = (acc[day] ?? 0) + (t.pnl ?? 0);
    return acc;
  }, {});

  const dailyEntries = Object.entries(dailyPnL).sort(([a], [b]) => a.localeCompare(b)).slice(-30);
  const maxAbsPnL = Math.max(...dailyEntries.map(([, v]) => Math.abs(v)), 1);

  return (
    <SafeAreaWrapper>
      <View style={styles.topBar}>
        <Text style={styles.pageTitle}>P&L Analytics</Text>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <ErrorBanner message={banner} type="error" />

        {/* Period selector */}
        <View style={styles.periodRow}>
          {PERIODS.map(p => (
            <TouchableOpacity
              key={p}
              style={[styles.periodChip, period === p && styles.periodChipActive]}
              onPress={() => setPeriod(p)}
            >
              <Text style={[styles.periodChipText, period === p && styles.periodChipTextActive]}>{p}</Text>
            </TouchableOpacity>
          ))}
        </View>

            {/* Stats grid */}
            <View style={styles.statsGrid}>
              <StatCard
                label="Total P&L"
                value={formatUSD(stats.totalPnl)}
                valueColor={stats.totalPnl >= 0 ? Colors.buyGreen : Colors.sellRed}
              />
              <StatCard label="Win Rate" value={`${stats.winRate.toFixed(1)}%`} sub={`${stats.winCount}W / ${stats.lossCount}L`} />
              <StatCard label="Total Trades" value={String(stats.totalTrades)} />
              <StatCard label="Total Fees" value={formatUSD(stats.totalFees)} valueColor={Colors.warning} />
              <StatCard label="Best Trade" value={formatUSD(stats.bestTrade)} valueColor={Colors.buyGreen} />
              <StatCard label="Worst Trade" value={formatUSD(stats.worstTrade)} valueColor={Colors.sellRed} />
            </View>

            {/* Daily PnL bar chart (text-based) */}
            {dailyEntries.length > 0 && (
              <View style={styles.chartCard}>
                <Text style={styles.chartTitle}>Daily P&L — Last {dailyEntries.length} days</Text>
                <View style={styles.barChart}>
                  {dailyEntries.map(([day, pnl]) => {
                    const pct = (Math.abs(pnl) / maxAbsPnL) * 100;
                    const isPos = pnl >= 0;
                    return (
                      <View key={day} style={styles.barItem}>
                        <View style={styles.barWrap}>
                          <View style={[
                            styles.bar,
                            { height: Math.max(4, (pct / 100) * 100), backgroundColor: isPos ? Colors.buyGreen : Colors.sellRed, opacity: 0.8 },
                          ]} />
                        </View>
                        <Text style={styles.barLabel}>{day.slice(5)}</Text>
                      </View>
                    );
                  })}
                </View>
              </View>
            )}

            {/* Recent trades */}
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Recent Trades</Text>
              <Text style={styles.sectionCount}>{filteredTrades.length} total</Text>
            </View>

            {filteredTrades.length === 0 ? (
              <View style={styles.empty}>
                <Text style={styles.emptyIcon}>📉</Text>
                <Text style={styles.emptyText}>No trades in this period</Text>
              </View>
            ) : (
              filteredTrades.slice(0, 20).map(trade => {
                const pnl = trade.pnl ?? 0;
                const pos = pnl >= 0;
                return (
                  <View key={trade.trade_id} style={styles.tradeRow}>
                    <View style={[styles.tradeIcon, { backgroundColor: trade.side === 'buy' ? Colors.buyGreenDim : Colors.sellRedDim }]}>
                      <Text style={[styles.tradeIconText, { color: trade.side === 'buy' ? Colors.buyGreen : Colors.sellRed }]}>
                        {trade.side === 'buy' ? '▲' : '▼'}
                      </Text>
                    </View>
                    <View style={styles.tradeMid}>
                      <Text style={styles.tradeSymbol}>{trade.symbol}</Text>
                      <Text style={styles.tradeMeta}>{formatPrice(trade.price)} × {formatPrice(trade.amount, 6)}</Text>
                      <Text style={styles.tradeDate}>{formatDateTime(trade.created_at)}</Text>
                    </View>
                    <View style={styles.tradeRight}>
                      <Text style={[styles.tradePnl, { color: pos ? Colors.buyGreen : Colors.sellRed }]}>
                        {pos ? '+' : ''}{formatUSD(pnl)}
                      </Text>
                      <Text style={styles.tradeFee}>Fee: {formatUSD(trade.fee)}</Text>
                    </View>
                  </View>
                );
              })
            )}

            <View style={{ height: Spacing[8] }} />
      </ScrollView>
    </SafeAreaWrapper>
  );
}

const styles = StyleSheet.create({
  topBar: { paddingHorizontal: Spacing[5], paddingVertical: Spacing[4] },
  pageTitle: { fontFamily: FontFamily.bold, fontSize: FontSize['2xl'], color: Colors.textPrimary },
  scroll: { flex: 1 },
  content: { padding: Spacing[5], gap: Spacing[4] },
  center: { paddingVertical: Spacing[10], alignItems: 'center' },
  periodRow: { flexDirection: 'row', gap: Spacing[2] },
  periodChip: { flex: 1, paddingVertical: Spacing[2], alignItems: 'center', borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.surfaceBorder, backgroundColor: Colors.surfaceHover },
  periodChipActive: { borderColor: Colors.gold, backgroundColor: Colors.goldAlpha15 },
  periodChipText: { fontFamily: FontFamily.medium, fontSize: FontSize.sm, color: Colors.textMuted },
  periodChipTextActive: { color: Colors.goldLight },
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing[3] },
  statCard: {
    flex: 1, minWidth: '45%', backgroundColor: Colors.surfaceCard,
    borderWidth: 1, borderColor: Colors.surfaceBorder, borderRadius: Radius.lg, padding: Spacing[4],
  },
  statLabel: { fontFamily: FontFamily.regular, fontSize: FontSize.xs, color: Colors.textMuted, marginBottom: 4 },
  statValue: { fontFamily: FontFamily.bold, fontSize: FontSize.xl, color: Colors.textPrimary },
  statSub: { fontFamily: FontFamily.regular, fontSize: FontSize.xs, color: Colors.textMuted, marginTop: 2 },
  chartCard: {
    backgroundColor: Colors.surfaceCard, borderWidth: 1,
    borderColor: Colors.surfaceBorder, borderRadius: Radius.xl, padding: Spacing[5],
  },
  chartTitle: { fontFamily: FontFamily.semiBold, fontSize: FontSize.sm, color: Colors.textSecondary, marginBottom: Spacing[4] },
  barChart: { flexDirection: 'row', alignItems: 'flex-end', height: 120, gap: 2 },
  barItem: { flex: 1, alignItems: 'center', justifyContent: 'flex-end' },
  barWrap: { width: '100%', height: 100, justifyContent: 'flex-end', alignItems: 'center' },
  bar: { width: '80%', borderRadius: 2 },
  barLabel: { fontFamily: FontFamily.regular, fontSize: 8, color: Colors.textDisabled, marginTop: 2 },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  sectionTitle: { fontFamily: FontFamily.semiBold, fontSize: FontSize.base, color: Colors.textPrimary },
  sectionCount: { fontFamily: FontFamily.regular, fontSize: FontSize.xs, color: Colors.textMuted },
  empty: { paddingVertical: Spacing[8], alignItems: 'center', gap: Spacing[3] },
  emptyIcon: { fontSize: 40 },
  emptyText: { fontFamily: FontFamily.regular, fontSize: FontSize.base, color: Colors.textMuted },
  tradeRow: {
    flexDirection: 'row', alignItems: 'center', paddingVertical: Spacing[3],
    borderBottomWidth: 1, borderBottomColor: Colors.surfaceBorder,
  },
  tradeIcon: { width: 36, height: 36, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center', marginRight: Spacing[3] },
  tradeIconText: { fontFamily: FontFamily.bold, fontSize: FontSize.base },
  tradeMid: { flex: 1 },
  tradeSymbol: { fontFamily: FontFamily.semiBold, fontSize: FontSize.sm, color: Colors.textPrimary },
  tradeMeta: { fontFamily: FontFamily.mono, fontSize: FontSize.xs, color: Colors.textMuted },
  tradeDate: { fontFamily: FontFamily.regular, fontSize: FontSize.xs, color: Colors.textDisabled, marginTop: 2 },
  tradeRight: { alignItems: 'flex-end' },
  tradePnl: { fontFamily: FontFamily.bold, fontSize: FontSize.sm },
  tradeFee: { fontFamily: FontFamily.regular, fontSize: FontSize.xs, color: Colors.textMuted, marginTop: 2 },
});
