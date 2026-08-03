import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import Icon from '../common/AppIcon';
import { Colors, FontFamily, FontSize, Radius, Spacing } from '../../theme';
import type { SupportedNetwork } from '../../types/wallet.types';

type Props = {
  networks: SupportedNetwork[];
  plannedNetworks?: SupportedNetwork[];
  selectedNetwork: string;
  onSelect: (network: string) => void;
  mode?: 'deposit' | 'withdraw';
  compact?: boolean;
};

export default function NetworkSelectList({
  networks,
  plannedNetworks = [],
  selectedNetwork,
  onSelect,
  mode = 'deposit',
  compact = false,
}: Props) {
  const renderRow = (n: SupportedNetwork, planned = false) => {
    const active = selectedNetwork === n.network;
    const live = mode === 'deposit' ? n.deposit_enabled : n.withdraw_enabled;
    return (
      <TouchableOpacity
        key={`${n.asset}-${n.network}`}
        style={[styles.row, compact && styles.rowCompact, active && styles.rowActive]}
        onPress={() => onSelect(n.network)}
        activeOpacity={0.85}
      >
        <View style={styles.rowLeft}>
          <Text style={[styles.name, active && styles.nameActive]}>{n.network_name || n.network}</Text>
          {n.chain_display ? <Text style={styles.sub}>{n.chain_display}</Text> : null}
        </View>
        <View style={styles.rowRight}>
          {planned ? (
            <Text style={styles.tagSoon}>Soon</Text>
          ) : live ? (
            <Text style={styles.tagLive}>{mode === 'deposit' ? 'Live' : 'On'}</Text>
          ) : (
            <Text style={styles.tagOff}>N/A</Text>
          )}
          {active ? <Icon name="check-circle" size={18} color={Colors.goldLight} /> : null}
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <View style={[styles.wrap, compact && styles.wrapCompact]}>
      {networks.map((n) => renderRow(n, false))}
      {plannedNetworks.map((n) => renderRow(n, true))}
      {!networks.length && !plannedNetworks.length ? (
        <Text style={styles.empty}>No networks for this asset.</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: Spacing[2] },
  wrapCompact: { gap: 6 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: Spacing[3],
    borderRadius: Radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.surfaceBorder,
    backgroundColor: Colors.surfaceElevated,
  },
  rowCompact: {
    paddingVertical: Spacing[2],
    paddingHorizontal: Spacing[3],
  },
  rowActive: {
    borderColor: Colors.goldAlpha30,
    backgroundColor: Colors.goldAlpha10,
  },
  rowLeft: { flex: 1, minWidth: 0 },
  name: {
    fontFamily: FontFamily.semiBold,
    fontSize: FontSize.sm,
    color: Colors.textPrimary,
  },
  nameActive: { color: Colors.goldLight },
  sub: {
    fontFamily: FontFamily.regular,
    fontSize: FontSize.xs,
    color: Colors.textMuted,
    marginTop: 2,
  },
  rowRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  tagLive: {
    fontFamily: FontFamily.semiBold,
    fontSize: 10,
    color: Colors.success,
  },
  tagSoon: {
    fontFamily: FontFamily.semiBold,
    fontSize: 10,
    color: Colors.warning,
  },
  tagOff: {
    fontFamily: FontFamily.semiBold,
    fontSize: 10,
    color: Colors.textMuted,
  },
  empty: {
    fontFamily: FontFamily.regular,
    fontSize: FontSize.sm,
    color: Colors.textMuted,
    paddingVertical: Spacing[3],
  },
});
