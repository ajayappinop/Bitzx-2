/**
 * Futures leverage — continuous integer slider (1..max). Preset pills are optional shortcuts.
 */
import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  PanResponder,
  Animated,
  LayoutChangeEvent,
} from 'react-native';
import { Colors, FontFamily, FontSize, Spacing, Radius } from '../../theme';
import { snapFuturesLeverage } from '../../utils/futuresLeverage';

const DEFAULT_PRESETS = [1, 5, 10, 25, 50, 100];
const THUMB = 18;

type Props = {
  value: number;
  max?: number;
  min?: number;
  /** Quick-pick chips only; slider accepts every integer in [min, max]. */
  presets?: number[];
  disabled?: boolean;
  onCommit: (leverage: number) => void;
};

function clampLev(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(v)));
}

function levToX(lev: number, min: number, max: number, travel: number): number {
  if (max <= min || travel <= 0) return 0;
  return ((clampLev(lev, min, max) - min) / (max - min)) * travel;
}

function xToLev(x: number, min: number, max: number, travel: number): number {
  if (max <= min || travel <= 0) return min;
  const ratio = Math.max(0, Math.min(1, x / travel));
  return clampLev(min + ratio * (max - min), min, max);
}

function LeverageSelector({
  value,
  max = 125,
  min = 1,
  presets = DEFAULT_PRESETS,
  disabled = false,
  onCommit,
}: Props) {
  const levMax = Math.max(min, Math.round(max));
  const levMin = Math.max(1, Math.round(min));

  const presetChips = useMemo(() => {
    const chips = presets.filter((x) => x >= levMin && x <= levMax);
    if (!chips.includes(levMax)) chips.push(levMax);
    return [...new Set(chips)].sort((a, b) => a - b);
  }, [presets, levMin, levMax]);

  const boundsRef = useRef({ min: levMin, max: levMax });
  boundsRef.current = { min: levMin, max: levMax };

  const [trackW, setTrackW] = useState(0);
  const trackWRef = useRef(0);
  const [local, setLocal] = useState(() => clampLev(value, levMin, levMax));

  const valueRef = useRef(value);
  valueRef.current = value;

  const disabledRef = useRef(disabled);
  disabledRef.current = disabled;

  const onCommitRef = useRef(onCommit);
  onCommitRef.current = onCommit;

  const thumbX = useRef(new Animated.Value(0)).current;
  const dragStartXRef = useRef(0);

  const travel = Math.max(1, trackW - THUMB);

  const setLevPosition = useCallback(
    (lev: number, animated: boolean) => {
      const { min: lo, max: hi } = boundsRef.current;
      const t = Math.max(1, trackWRef.current - THUMB);
      const x = levToX(lev, lo, hi, t);
      if (animated) {
        Animated.spring(thumbX, {
          toValue: x,
          useNativeDriver: false,
          tension: 120,
          friction: 12,
        }).start();
      } else {
        thumbX.setValue(x);
      }
    },
    [thumbX],
  );

  useEffect(() => {
    if (trackWRef.current <= THUMB) return;
    const next = clampLev(value, levMin, levMax);
    setLocal(next);
    setLevPosition(next, false);
  }, [trackW, value, levMin, levMax, setLevPosition]);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => !disabledRef.current,
      onPanResponderGrant: () => {
        thumbX.stopAnimation((v) => {
          dragStartXRef.current = v;
        });
      },
      onPanResponderMove: (_, gesture) => {
        const t = Math.max(1, trackWRef.current - THUMB);
        const x = Math.max(0, Math.min(t, dragStartXRef.current + gesture.dx));
        thumbX.setValue(x);
        const { min: lo, max: hi } = boundsRef.current;
        setLocal(xToLev(x, lo, hi, t));
      },
      onPanResponderRelease: (_, gesture) => {
        const t = Math.max(1, trackWRef.current - THUMB);
        if (t <= 0) return;
        const x = Math.max(0, Math.min(t, dragStartXRef.current + gesture.dx));
        const { min: lo, max: hi } = boundsRef.current;
        const lev = snapFuturesLeverage(xToLev(x, lo, hi, t), hi);
        setLocal(lev);
        setLevPosition(lev, true);
        if (lev !== valueRef.current) {
          onCommitRef.current(lev);
        }
      },
    }),
  ).current;

  const fillWidth = thumbX.interpolate({
    inputRange: [0, travel],
    outputRange: [0, travel],
    extrapolate: 'clamp',
  });

  const onTrackLayout = (e: LayoutChangeEvent) => {
    const w = e.nativeEvent.layout.width;
    trackWRef.current = w;
    setTrackW(w);
  };

  const commitPreset = (lev: number) => {
    const next = snapFuturesLeverage(clampLev(lev, levMin, levMax), levMax);
    setLocal(next);
    setLevPosition(next, true);
    if (next !== valueRef.current) {
      onCommitRef.current(next);
    }
  };

  return (
    <View style={styles.wrap} collapsable={false}>
      <View style={styles.head}>
        <Text style={styles.label}>Leverage</Text>
        <Text style={styles.value}>{local}×</Text>
      </View>

      <View
        style={styles.trackHit}
        onLayout={onTrackLayout}
        collapsable={false}
        {...panResponder.panHandlers}
      >
        <View style={styles.track}>
          <Animated.View style={[styles.trackFill, { width: fillWidth }]} />
        </View>
        <Animated.View
          pointerEvents="none"
          style={[styles.thumb, { transform: [{ translateX: thumbX }] }]}
        />
      </View>

      <Text style={styles.rangeHint}>{levMin}× – {levMax}× (any integer)</Text>

      <View style={styles.pills}>
        {presetChips.map((l) => (
          <TouchableOpacity
            key={l}
            style={[styles.pill, l === local && styles.pillActive]}
            disabled={disabled}
            onPress={() => commitPreset(l)}
            activeOpacity={0.75}
          >
            <Text style={[styles.pillTxt, l === local && styles.pillTxtActive]}>{l}×</Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}

export default memo(LeverageSelector);

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: Colors.surfaceCard,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    borderRadius: Radius.lg,
    padding: Spacing[3],
  },
  head: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Spacing[2],
  },
  label: {
    fontFamily: FontFamily.medium,
    fontSize: FontSize.xs,
    color: Colors.textMuted,
  },
  value: {
    fontFamily: FontFamily.monoMedium,
    fontSize: FontSize.sm,
    color: Colors.textPrimary,
  },
  rangeHint: {
    fontFamily: FontFamily.regular,
    fontSize: 10,
    color: Colors.textDisabled,
    marginBottom: Spacing[2],
  },
  trackHit: {
    height: 34,
    justifyContent: 'center',
    marginBottom: Spacing[1],
  },
  track: {
    height: 4,
    borderRadius: 2,
    backgroundColor: Colors.surfaceBorder,
    overflow: 'hidden',
  },
  trackFill: {
    height: '100%',
    backgroundColor: Colors.gold,
  },
  thumb: {
    position: 'absolute',
    left: 0,
    width: THUMB,
    height: THUMB,
    borderRadius: THUMB / 2,
    backgroundColor: Colors.gold,
    borderWidth: 2,
    borderColor: Colors.goldLight,
    top: 8,
  },
  pills: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  pill: {
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: Radius.sm,
    backgroundColor: Colors.surfaceCard,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    minWidth: 36,
    alignItems: 'center',
  },
  pillActive: {
    backgroundColor: Colors.goldAlpha15,
    borderColor: Colors.goldAlpha30,
  },
  pillTxt: {
    fontFamily: FontFamily.monoMedium,
    fontSize: 10,
    color: Colors.textSecondary,
  },
  pillTxtActive: {
    color: Colors.goldLight,
  },
});
