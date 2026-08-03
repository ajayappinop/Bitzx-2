/**
 * SVG donut ring with staggered fade-in animation per slice.
 * Driven purely from wallet data; nothing hardcoded.
 */
import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Animated } from 'react-native';
import Svg, { Path, Circle, G } from 'react-native-svg';
import { Colors, FontFamily, FontSize } from '../../theme';
import type { AllocationSlice } from '../../utils/dashboard';

const SIZE  = 120;
const CX    = SIZE / 2;
const CY    = SIZE / 2;
const R_OUT = 48;
const R_IN  = 30;

function polar(cx: number, cy: number, r: number, deg: number) {
  const rad = ((deg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

/** Donut arc path (annular sector) */
function donutArc(
  cx: number, cy: number,
  rOuter: number, rInner: number,
  startDeg: number, endDeg: number,
): string {
  // Cap to 359.99 to avoid degenerate full-circle arcs
  const end = Math.min(endDeg, startDeg + 359.99);
  const large = end - startDeg > 180 ? 1 : 0;

  const o1 = polar(cx, cy, rOuter, startDeg);
  const o2 = polar(cx, cy, rOuter, end);
  const i2 = polar(cx, cy, rInner, end);
  const i1 = polar(cx, cy, rInner, startDeg);

  return [
    `M ${o1.x.toFixed(2)} ${o1.y.toFixed(2)}`,
    `A ${rOuter} ${rOuter} 0 ${large} 1 ${o2.x.toFixed(2)} ${o2.y.toFixed(2)}`,
    `L ${i2.x.toFixed(2)} ${i2.y.toFixed(2)}`,
    `A ${rInner} ${rInner} 0 ${large} 0 ${i1.x.toFixed(2)} ${i1.y.toFixed(2)}`,
    'Z',
  ].join(' ');
}

type Props = {
  slices: AllocationSlice[];
  centerLabel?: string;
  totalLabel?: string;
};

export default function AllocationRing({ slices, centerLabel, totalLabel }: Props) {
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const scaleAnim = useRef(new Animated.Value(0.85)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 500,
        useNativeDriver: true,
      }),
      Animated.spring(scaleAnim, {
        toValue: 1,
        useNativeDriver: true,
        tension: 100,
        friction: 8,
      }),
    ]).start();
  }, [slices.length]); // re-animate when data changes

  const total = slices.reduce((s, x) => s + x.value, 0);

  if (total <= 0) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyText}>No balance data</Text>
      </View>
    );
  }

  let angle = 0;
  const paths = slices.map((slice) => {
    const sweep = (slice.value / total) * 360;
    const d = donutArc(CX, CY, R_OUT, R_IN, angle, angle + sweep - 1);
    angle += sweep;
    return { ...slice, d };
  });

  return (
    <Animated.View
      style={[styles.wrap, { opacity: fadeAnim, transform: [{ scale: scaleAnim }] }]}
    >
      <Svg width={SIZE} height={SIZE}>
        <G>
          {paths.map((p) => (
            <Path
              key={p.asset}
              d={p.d}
              fill={p.color}
            />
          ))}
          <Circle cx={CX} cy={CY} r={R_IN - 1} fill={Colors.surfaceCard} />
        </G>
      </Svg>
      <View style={styles.center} pointerEvents="none">
        {totalLabel ? (
          <Text style={styles.centerTotal} numberOfLines={1}>{totalLabel}</Text>
        ) : null}
        {centerLabel ? (
          <Text style={styles.centerLabel} numberOfLines={1}>{centerLabel}</Text>
        ) : null}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    width: SIZE,
    height: SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  center: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  centerTotal: {
    fontFamily: FontFamily.bold,
    fontSize: FontSize.xs,
    color: Colors.textPrimary,
    textAlign: 'center',
  },
  centerLabel: {
    fontFamily: FontFamily.regular,
    fontSize: 9,
    color: Colors.textMuted,
    textAlign: 'center',
    marginTop: 1,
  },
  empty: {
    width: SIZE,
    height: SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyText: {
    fontFamily: FontFamily.regular,
    fontSize: FontSize.xs,
    color: Colors.textMuted,
    textAlign: 'center',
  },
});
