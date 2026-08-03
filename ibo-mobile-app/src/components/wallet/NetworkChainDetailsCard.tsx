import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Icon from '../common/AppIcon';
import { Colors, FontFamily, FontSize, Radius, Spacing } from '../../theme';
import { networkChainDetailRows } from '../../utils/walletChainDetails';
import type { SupportedNetwork } from '../../types/wallet.types';

type Props = {
  network: SupportedNetwork | null | undefined;
  mode?: 'deposit' | 'withdraw';
  /** Tighter inline layout for withdraw screen — no duplicate header block. */
  variant?: 'default' | 'compact';
};

export default function NetworkChainDetailsCard({
  network,
  mode = 'deposit',
  variant = 'default',
}: Props) {
  if (!network) return null;
  const compact = variant === 'compact';
  const rows = networkChainDetailRows(network, { mode, compact });
  if (!rows.length) return null;

  const isLive = mode === 'deposit' ? network.deposit_enabled : network.withdraw_enabled;
  const isPlanned = network.status === 'coming_soon';

  if (compact) {
    return (
      <View style={styles.compactCard}>
        {rows.map((row) => (
          <View key={`${row.label}-${row.value}`} style={styles.compactRow}>
            <Text style={styles.compactLabel}>{row.label}</Text>
            <Text
              style={[
                styles.compactValue,
                row.highlight === 'ok' && { color: Colors.success },
                row.highlight === 'warn' && { color: Colors.warning },
                row.highlight === 'muted' && { color: Colors.textMuted },
              ]}
              numberOfLines={2}
            >
              {row.value}
            </Text>
          </View>
        ))}
      </View>
    );
  }

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Text style={styles.kicker}>Selected network</Text>
          <Text style={styles.title}>{network.network_name || network.network}</Text>
          <Text style={styles.asset}>{network.asset}</Text>
        </View>
        <View style={[styles.badge, isPlanned ? styles.badgeWarn : isLive ? styles.badgeOk : styles.badgeMuted]}>
          <Icon
            name={isPlanned ? 'clock-outline' : isLive ? 'flash-outline' : 'alert-circle-outline'}
            size={12}
            color={isPlanned ? Colors.warning : isLive ? Colors.success : Colors.textMuted}
          />
          <Text style={styles.badgeTxt}>
            {isPlanned ? 'Soon' : isLive ? (mode === 'deposit' ? 'Live' : 'On') : 'Limited'}
          </Text>
        </View>
      </View>
      {rows.map((row) => (
        <View key={`${row.label}-${row.value}`} style={styles.row}>
          <Text style={styles.rowLabel}>{row.label}</Text>
          <Text
            style={[
              styles.rowValue,
              row.highlight === 'ok' && { color: Colors.success },
              row.highlight === 'warn' && { color: Colors.warning },
              row.highlight === 'muted' && { color: Colors.textMuted },
            ]}
          >
            {row.value}
          </Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginTop: Spacing[3],
    borderRadius: Radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.surfaceBorder,
    backgroundColor: Colors.surfaceCard,
    overflow: 'hidden',
  },
  compactCard: {
    marginTop: Spacing[2],
    paddingTop: Spacing[2],
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Colors.surfaceBorder,
    gap: 2,
  },
  compactRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: Spacing[3],
    paddingVertical: 3,
  },
  compactLabel: {
    fontFamily: FontFamily.medium,
    fontSize: 11,
    color: Colors.textMuted,
    minWidth: 72,
  },
  compactValue: {
    flex: 1,
    fontFamily: FontFamily.medium,
    fontSize: 11,
    color: Colors.textSecondary,
    textAlign: 'right',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: Spacing[3],
    padding: Spacing[4],
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.surfaceBorder,
  },
  headerLeft: { flex: 1, minWidth: 0 },
  kicker: {
    fontFamily: FontFamily.bold,
    fontSize: 10,
    color: Colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  title: {
    fontFamily: FontFamily.semiBold,
    fontSize: FontSize.md,
    color: Colors.textPrimary,
    marginTop: 4,
  },
  asset: {
    fontFamily: FontFamily.medium,
    fontSize: FontSize.xs,
    color: Colors.textSecondary,
    marginTop: 2,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: Radius.full,
    borderWidth: 1,
  },
  badgeOk: { borderColor: Colors.success + '55', backgroundColor: Colors.success + '18' },
  badgeWarn: { borderColor: Colors.warning + '55', backgroundColor: Colors.warning + '18' },
  badgeMuted: { borderColor: Colors.surfaceBorder, backgroundColor: Colors.surfaceElevated },
  badgeTxt: {
    fontFamily: FontFamily.semiBold,
    fontSize: 10,
    color: Colors.textPrimary,
  },
  row: {
    paddingHorizontal: Spacing[4],
    paddingVertical: Spacing[2],
  },
  rowLabel: {
    fontFamily: FontFamily.bold,
    fontSize: 10,
    color: Colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  rowValue: {
    fontFamily: FontFamily.medium,
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    marginTop: 2,
  },
});
