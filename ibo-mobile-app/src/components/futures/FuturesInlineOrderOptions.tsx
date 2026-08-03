import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import Icon from '@/components/common/AppIcon';
import { Colors, FontFamily, FontSize } from '@/theme';
import { FuturesUi } from '@/theme/futuresTerminal';

type Props = {
  tpSl: boolean;
  onTpSlChange: (v: boolean) => void;
};

/** TP/SL checkbox toggle (maxbyte-style) above the submit row. */
export default function FuturesInlineOrderOptions({ tpSl, onTpSlChange }: Props) {
  return (
    <View style={styles.wrap}>
      <TouchableOpacity
        style={styles.row}
        onPress={() => onTpSlChange(!tpSl)}
        activeOpacity={0.85}
      >
        <View style={[styles.box, tpSl && styles.boxOn]}>
          {tpSl ? <Icon name="check" size={10} color={FuturesUi.long} /> : null}
        </View>
        <Text style={styles.lbl}>TP/SL</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '100%',
    paddingVertical: 4,
    minHeight: 32,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  box: {
    width: 16,
    height: 16,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    backgroundColor: Colors.surfaceHover,
    alignItems: 'center',
    justifyContent: 'center',
  },
  boxOn: {
    borderColor: Colors.buyGreen,
    backgroundColor: Colors.buyGreenDim,
  },
  lbl: {
    fontFamily: FontFamily.medium,
    fontSize: FontSize.xs,
    color: Colors.textSecondary,
  },
});
