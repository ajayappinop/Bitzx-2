/**
 * MiniTradingViewChart — compact LWC chart bar on Trade/Futures screens.
 */
import React from 'react';
import { View, StyleSheet } from 'react-native';
import TradingViewWidget from './TradingViewWidget';
import { Colors, Radius } from '../../theme';

interface Props {
  symbol: string;
  livePrice?: number;
  panelOpen: boolean;
  onPanelOpenChange: (open: boolean) => void;
  height?: number;
  market?: 'spot' | 'futures' | 'options';
}

export default function MiniTradingViewChart({
  symbol,
  livePrice,
  panelOpen,
  onPanelOpenChange,
  height = 200,
  market = 'spot',
}: Props) {
  if (panelOpen) {
    return (
      <View style={styles.fullWrap}>
        <TradingViewWidget symbol={symbol} market={market} mini={false} livePrice={livePrice} />
      </View>
    );
  }

  return (
    <View style={[styles.miniWrap, { height }]}>
      <TradingViewWidget
        symbol={symbol}
        market={market}
        mini
        livePrice={livePrice}
        height={height}
        onExpand={() => onPanelOpenChange(true)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  miniWrap: {
    width: '100%',
    borderRadius: Radius.md,
    overflow: 'hidden',
    backgroundColor: Colors.surfaceDark,
  },
  fullWrap: {
    flex: 1,
    backgroundColor: Colors.surfaceDark,
  },
});
