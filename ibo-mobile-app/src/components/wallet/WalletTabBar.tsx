import React from 'react';
import { ScrollView, TouchableOpacity, Text, StyleSheet, View } from 'react-native';
import Icon from '../common/AppIcon';
import { Colors, FontFamily, FontSize, Spacing, Radius } from '../../theme';
import { WALLET_TABS, WalletTab } from '../../types/wallet.tabs';
import { WALLET_H_PAD } from './walletStyles';

type Props = {
  active: WalletTab;
  onChange: (tab: WalletTab) => void;
};

export default function WalletTabBar({ active, onChange }: Props) {
  return (
    <View style={styles.wrap}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.row}
      >
        {WALLET_TABS.map((t) => {
          const selected = active === t.id;
          return (
            <TouchableOpacity
              key={t.id}
              style={[styles.tab, selected && styles.tabActive]}
              onPress={() => onChange(t.id)}
              activeOpacity={0.82}
            >
              <Icon
                name={t.icon as any}
                size={15}
                color={selected ? Colors.goldLight : Colors.textMuted}
              />
              <Text style={[styles.tabText, selected && styles.tabTextActive]}>
                {t.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    borderBottomWidth: 1,
    borderBottomColor: Colors.surfaceBorder,
    backgroundColor: Colors.surface,
    marginBottom: Spacing[3],
  },
  row: {
    paddingHorizontal: WALLET_H_PAD,
    paddingVertical: Spacing[2],
    gap: Spacing[2],
    alignItems: 'center',
  },
  tab: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: Spacing[3],
    paddingVertical: Spacing[2],
    borderRadius: Radius.full,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    backgroundColor: Colors.surfaceCard,
    marginRight: Spacing[1],
  },
  tabActive: {
    backgroundColor: Colors.goldAlpha15,
    borderColor: Colors.goldAlpha30,
  },
  tabText: {
    fontFamily: FontFamily.medium,
    fontSize: FontSize.xs,
    color: Colors.textMuted,
  },
  tabTextActive: {
    color: Colors.goldLight,
    fontFamily: FontFamily.semiBold,
  },
});
