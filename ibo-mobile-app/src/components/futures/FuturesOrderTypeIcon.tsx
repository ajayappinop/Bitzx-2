/**
 * Mini pictogram for each futures order type — used in picker + form dropdown.
 */
import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Colors } from '@/theme';
import type { FuturesOrderType } from './futuresOrderTypes';

type Props = {
  type: FuturesOrderType;
  active?: boolean;
  size?: number;
};

export default function FuturesOrderTypeIcon({ type, active = false, size = 28 }: Props) {
  const col = active ? Colors.goldLight : Colors.textMuted;
  const s = size / 28;

  switch (type) {
    case 'limit':
      return (
        <View style={[styles.wrap, { width: size, height: size }]}>
          <View style={[styles.limitLine, { backgroundColor: col, width: 22 * s, height: 2 * s }]} />
          <View style={[styles.limitDot, { backgroundColor: col, width: 6 * s, height: 6 * s, borderRadius: 3 * s }]} />
        </View>
      );
    case 'market':
      return (
        <View style={[styles.wrap, { width: size, height: size }]}>
          <View
            style={[
              styles.marketWedge,
              {
                borderLeftWidth: 11 * s,
                borderRightWidth: 11 * s,
                borderBottomWidth: 20 * s,
                borderBottomColor: col,
              },
            ]}
          />
        </View>
      );
    case 'stop_limit':
      return (
        <View style={[styles.wrap, { width: size, height: size }]}>
          <View style={[styles.stopVert, { backgroundColor: col, width: 2 * s, height: 14 * s, left: 6 * s, bottom: 4 * s }]} />
          <View style={[styles.stopHoriz, { backgroundColor: col, width: 14 * s, height: 2 * s, left: 6 * s, bottom: 16 * s }]} />
          <View style={[styles.stopDot, { backgroundColor: col, width: 5 * s, height: 5 * s, borderRadius: 2.5 * s, left: 18 * s, bottom: 14.5 * s }]} />
        </View>
      );
    case 'stop_market':
      return (
        <View style={[styles.wrap, { width: size, height: size }]}>
          <View style={[styles.stopVert, { backgroundColor: col, width: 2 * s, height: 16 * s, left: 8 * s, bottom: 4 * s }]} />
          <View
            style={[
              styles.stopMarketWedge,
              {
                borderLeftWidth: 7 * s,
                borderRightWidth: 7 * s,
                borderBottomWidth: 12 * s,
                borderBottomColor: col,
                left: 12 * s,
                bottom: 6 * s,
              },
            ]}
          />
        </View>
      );
    case 'take_profit':
      return (
        <View style={[styles.wrap, { width: size, height: size }]}>
          <View style={[styles.tpLine, { backgroundColor: col, width: 18 * s, height: 2 * s, top: 8 * s }]} />
          <View style={[styles.tpFlag, { borderBottomColor: col, borderLeftWidth: 5 * s, borderBottomWidth: 8 * s, left: 16 * s, top: 4 * s }]} />
          <View style={[styles.tpStem, { backgroundColor: col, width: 2 * s, height: 10 * s, left: 16 * s, top: 12 * s }]} />
        </View>
      );
  }
}

const styles = StyleSheet.create({
  wrap: {
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative',
  },
  limitLine: {
    borderRadius: 1,
    position: 'absolute',
    left: 2,
    top: '50%',
    marginTop: -1,
  },
  limitDot: {
    position: 'absolute',
    right: 2,
    top: '50%',
    marginTop: -3,
  },
  marketWedge: {
    width: 0,
    height: 0,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    opacity: 0.75,
    position: 'absolute',
    bottom: 4,
  },
  stopVert: {
    position: 'absolute',
    borderRadius: 1,
  },
  stopHoriz: {
    position: 'absolute',
    borderRadius: 1,
  },
  stopDot: {
    position: 'absolute',
  },
  stopMarketWedge: {
    position: 'absolute',
    width: 0,
    height: 0,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    opacity: 0.8,
  },
  tpLine: {
    position: 'absolute',
    left: 4,
    borderRadius: 1,
  },
  tpFlag: {
    position: 'absolute',
    width: 0,
    height: 0,
    borderBottomColor: 'transparent',
    borderRightColor: 'transparent',
  },
  tpStem: {
    position: 'absolute',
    borderRadius: 1,
  },
});
