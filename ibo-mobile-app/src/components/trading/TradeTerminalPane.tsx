/**
 * Single column in the trade/futures split — body grows, footer pins to shared baseline.
 */
import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Colors } from '../../theme';

type Props = {
  children: React.ReactNode;
  footer?: React.ReactNode;
  style?: object;
};

export default function TradeTerminalPane({ children, footer, style }: Props) {
  return (
    <View style={[styles.pane, style]}>
      <View style={styles.body}>{children}</View>
      {footer ? <View style={styles.footer}>{footer}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  pane: {
    flex: 1,
    minHeight: 0,
    flexDirection: 'column',
    borderRightWidth: StyleSheet.hairlineWidth,
    borderRightColor: Colors.surfaceBorder,
  },
  body: {
    flex: 1,
    minHeight: 0,
    overflow: 'hidden',
  },
  footer: {
    flexShrink: 0,
    paddingTop: 4,
    paddingBottom: 2,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Colors.surfaceBorder,
    backgroundColor: Colors.surface,
  },
});
