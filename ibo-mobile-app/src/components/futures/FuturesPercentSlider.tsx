/**
 * FuturesPercentSlider — smooth continuous pan-based slider (0–100 %).
 * Replaces the step-button version with a draggable thumb.
 */
import React, { useCallback, useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, PanResponder, Animated, LayoutChangeEvent,
} from 'react-native';
import { Colors, FontFamily, FontSize, Spacing } from '@/theme';
import { FuturesUi } from '@/theme/futuresTerminal';

const THUMB = 18;
const STEPS = [0, 25, 50, 75, 100];

function clamp(v: number): number {
  return Math.max(0, Math.min(100, v));
}

type Props = {
  value: number;
  onChange: (pct: number) => void;
};

export default function FuturesPercentSlider({ value, onChange }: Props) {
  const trackW = useRef(0);
  const thumbX = useRef(new Animated.Value(0)).current;
  const dragStartX = useRef(0);
  const latestValue = useRef(value);
  latestValue.current = value;

  const pctToX = useCallback((pct: number): number => {
    const travel = Math.max(1, trackW.current - THUMB);
    return (clamp(pct) / 100) * travel;
  }, []);

  const xToPct = useCallback((x: number): number => {
    const travel = Math.max(1, trackW.current - THUMB);
    return clamp(Math.round((Math.max(0, Math.min(travel, x)) / travel) * 100));
  }, []);

  const moveTo = useCallback((pct: number, animate: boolean) => {
    const x = pctToX(pct);
    if (animate) {
      Animated.spring(thumbX, { toValue: x, useNativeDriver: false, tension: 200, friction: 18 }).start();
    } else {
      thumbX.setValue(x);
    }
  }, [pctToX, thumbX]);

  // Sync thumb when `value` prop changes from outside
  useEffect(() => {
    if (trackW.current > THUMB) moveTo(value, false);
  }, [value, moveTo]);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        thumbX.stopAnimation(v => { dragStartX.current = v; });
      },
      onPanResponderMove: (_, g) => {
        const travel = Math.max(1, trackW.current - THUMB);
        const x = Math.max(0, Math.min(travel, dragStartX.current + g.dx));
        thumbX.setValue(x);
        const pct = Math.round((x / travel) * 100);
        onChange(pct);
      },
      onPanResponderRelease: (_, g) => {
        const travel = Math.max(1, trackW.current - THUMB);
        const x = Math.max(0, Math.min(travel, dragStartX.current + g.dx));
        const pct = Math.round((x / travel) * 100);
        onChange(pct);
        thumbX.setValue(x);
      },
    }),
  ).current;

  const onTrackLayout = (e: LayoutChangeEvent) => {
    const w = e.nativeEvent.layout.width;
    if (w === trackW.current) return;
    trackW.current = w;
    // Re-position without animation on layout
    thumbX.setValue(pctToX(latestValue.current));
  };

  const travel = thumbX.interpolate({
    inputRange: [0, 9999],
    outputRange: [0, 9999],
    extrapolate: 'clamp',
  });

  return (
    <View style={styles.wrap}>
      {/* Track + thumb */}
      <View style={styles.sliderRow} onLayout={onTrackLayout} {...panResponder.panHandlers}>
        <View style={styles.track}>
          <Animated.View style={[styles.fill, { width: travel }]} />
        </View>
        <Animated.View
          pointerEvents="none"
          style={[styles.thumb, { transform: [{ translateX: thumbX }] }]}
        />

        {/* Step markers */}
        {STEPS.map((step) => (
          <View
            key={step}
            pointerEvents="none"
            style={[styles.stepMark, { left: `${step}%` as any }]}
          />
        ))}
      </View>

      {/* Step labels */}
      <View style={styles.labels}>
        {STEPS.map((step) => {
          const active = Math.abs(value - step) <= 1;
          return (
            <Text
              key={step}
              style={[styles.label, active && styles.labelActive]}
            >
              {step}%
            </Text>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginHorizontal: Spacing[1],
    marginBottom: Spacing[1],
  },
  sliderRow: {
    height: 24,
    justifyContent: 'center',
    paddingHorizontal: THUMB / 2,
    position: 'relative',
  },
  track: {
    height: 3,
    backgroundColor: Colors.surfaceBorder,
    borderRadius: 2,
    overflow: 'hidden',
  },
  fill: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    backgroundColor: FuturesUi.long,
    borderRadius: 2,
  },
  thumb: {
    position: 'absolute',
    left: THUMB / 2,
    top: (24 - THUMB) / 2,
    width: THUMB,
    height: THUMB,
    borderRadius: THUMB / 2,
    backgroundColor: Colors.white,
    borderWidth: 2.5,
    borderColor: FuturesUi.long,
    shadowColor: FuturesUi.long,
    shadowOpacity: 0.35,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
    elevation: 3,
  },
  stepMark: {
    position: 'absolute',
    top: (24 - 6) / 2,
    marginLeft: -3,
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: Colors.surfaceBorder,
  },
  labels: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: Spacing[1],
    paddingHorizontal: 2,
  },
  label: {
    fontFamily: FontFamily.regular,
    fontSize: 9,
    color: Colors.textMuted,
  },
  labelActive: {
    color: FuturesUi.longLight,
    fontFamily: FontFamily.semiBold,
  },
});
