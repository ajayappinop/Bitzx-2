import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Icon from '../common/AppIcon';
import { walletApi } from '../../api/wallet.api';
import { Colors, FontFamily, FontSize, Radius, Spacing } from '../../theme';

export default function WalletChainsBanner() {
  const [chains, setChains] = useState<string[]>([]);

  useEffect(() => {
    walletApi.getSupportedNetworks()
      .then((res) => {
        const names = new Set<string>();
        for (const n of res.data) {
          const label = n.chain_display || n.chain_id || n.network;
          if (label) names.add(label);
        }
        setChains([...names]);
      })
      .catch(() => setChains([]));
  }, []);

  if (!chains.length) return null;

  return (
    <View style={styles.banner}>
      <Icon name="link-variant" size={18} color={Colors.goldLight} />
      <View style={styles.body}>
        <Text style={styles.title}>Supported chains</Text>
        <Text style={styles.sub} numberOfLines={2}>{chains.join(' · ')}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing[3],
    padding: Spacing[4],
    borderRadius: Radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.gold + '44',
    backgroundColor: Colors.gold + '10',
    marginBottom: Spacing[3],
  },
  body: { flex: 1, minWidth: 0 },
  title: {
    fontFamily: FontFamily.semiBold,
    fontSize: FontSize.sm,
    color: Colors.goldLight,
  },
  sub: {
    fontFamily: FontFamily.regular,
    fontSize: FontSize.xs,
    color: Colors.textSecondary,
    marginTop: 4,
  },
});
