import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Colors, FontFamily, FontSize, Spacing } from '../../theme';
import { formatInrAmount } from '../../utils/inrWithdrawal';

type Props = { minDepositInr: number };

/** Subtle gold pill — only when admin set a minimum > 0. */
export function InrMinDepositChip({ minDepositInr }: Props) {
  if (!minDepositInr || minDepositInr <= 0) return null;
  return (
    <View style={styles.chip}>
      <Text style={styles.chipText}>From {formatInrAmount(minDepositInr)} accepted</Text>
    </View>
  );
}

/** One-line note under marketing copy. */
export function InrMinDepositNote({ minDepositInr }: Props) {
  if (!minDepositInr || minDepositInr <= 0) return null;
  return (
    <Text style={styles.note}>
      Only deposits of {formatInrAmount(minDepositInr)} or more are accepted — please don&apos;t transfer less.
    </Text>
  );
}

const styles = StyleSheet.create({
  chip: {
    alignSelf: 'flex-start',
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(212, 175, 55, 0.25)',
    backgroundColor: 'rgba(212, 175, 55, 0.08)',
    paddingHorizontal: Spacing[2],
    paddingVertical: 4,
  },
  chipText: {
    fontFamily: FontFamily.medium,
    fontSize: FontSize.xs,
    color: Colors.goldLight,
    opacity: 0.9,
  },
  note: {
    fontFamily: FontFamily.regular,
    fontSize: FontSize.xs,
    color: Colors.textMuted,
    lineHeight: 18,
  },
});
