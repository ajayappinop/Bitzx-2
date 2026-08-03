/**
 * LeveragePickerModal — bottom-sheet leverage selector.
 * Matches the Binance-style reference: current value display, -/+ buttons,
 * continuous slider, preset pills, info row, apply-all checkbox, Confirm CTA.
 */
import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Modal, Pressable,
  PanResponder, Animated, LayoutChangeEvent,
} from 'react-native';
import Icon from '../common/AppIcon';
import { Colors, FontFamily, FontSize, Spacing, Radius } from '../../theme';
import { FuturesUi } from '../../theme/futuresTerminal';

const THUMB = 20;

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, Math.round(v)));
}
function levToX(lev: number, lo: number, hi: number, travel: number): number {
  if (hi <= lo || travel <= 0) return 0;
  return ((clamp(lev, lo, hi) - lo) / (hi - lo)) * travel;
}
function xToLev(x: number, lo: number, hi: number, travel: number): number {
  if (hi <= lo || travel <= 0) return lo;
  return clamp(lo + (Math.max(0, Math.min(1, x / travel))) * (hi - lo), lo, hi);
}

type Props = {
  visible: boolean;
  value: number;
  max?: number;
  min?: number;
  presets?: number[];
  symbol: string;
  markPrice?: number;
  freeMargin?: number;
  onClose: () => void;
  onConfirm: (leverage: number, applyToAll?: boolean) => void;
};

function LeveragePickerModal({
  visible, value, max = 125, min = 1, presets = [1, 25, 50, 75, 100, 125],
  symbol, markPrice = 0, freeMargin = 0, onClose, onConfirm,
}: Props) {
  const levMax = Math.max(min, Math.round(max));
  const levMin = Math.max(1, Math.round(min));

  const chipPresets = useMemo(() => {
    const chips = presets.filter(x => x >= levMin && x <= levMax);
    if (!chips.includes(levMax)) chips.push(levMax);
    return [...new Set(chips)].sort((a, b) => a - b);
  }, [presets, levMin, levMax]);

  const [local, setLocal] = useState(() => clamp(value, levMin, levMax));
  const [applyAll, setApplyAll] = useState(false);
  const [trackW, setTrackW] = useState(0);

  const trackWRef = useRef(0);
  const boundsRef = useRef({ min: levMin, max: levMax });
  boundsRef.current = { min: levMin, max: levMax };

  const thumbX = useRef(new Animated.Value(0)).current;
  const dragStartX = useRef(0);

  const travel = Math.max(1, trackW - THUMB);

  const moveTo = useCallback((lev: number, animate: boolean) => {
    const t = Math.max(1, trackWRef.current - THUMB);
    const { min: lo, max: hi } = boundsRef.current;
    const x = levToX(lev, lo, hi, t);
    if (animate) {
      Animated.spring(thumbX, { toValue: x, useNativeDriver: false, tension: 120, friction: 12 }).start();
    } else {
      thumbX.setValue(x);
    }
  }, [thumbX]);

  // Sync when modal opens or value changes
  useEffect(() => {
    if (visible) {
      const next = clamp(value, levMin, levMax);
      setLocal(next);
      // wait for layout
      setTimeout(() => moveTo(next, false), 30);
    }
  }, [visible, value, levMin, levMax, moveTo]);

  useEffect(() => {
    if (trackW > THUMB) moveTo(local, false);
  }, [trackW, local, moveTo]);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        thumbX.stopAnimation(v => { dragStartX.current = v; });
      },
      onPanResponderMove: (_, g) => {
        const t = Math.max(1, trackWRef.current - THUMB);
        const x = Math.max(0, Math.min(t, dragStartX.current + g.dx));
        thumbX.setValue(x);
        const { min: lo, max: hi } = boundsRef.current;
        setLocal(xToLev(x, lo, hi, t));
      },
      onPanResponderRelease: (_, g) => {
        const t = Math.max(1, trackWRef.current - THUMB);
        const x = Math.max(0, Math.min(t, dragStartX.current + g.dx));
        const { min: lo, max: hi } = boundsRef.current;
        const lev = xToLev(x, lo, hi, t);
        setLocal(lev);
        moveTo(lev, true);
      },
    }),
  ).current;

  const onTrackLayout = (e: LayoutChangeEvent) => {
    const w = e.nativeEvent.layout.width;
    trackWRef.current = w;
    setTrackW(w);
  };

  const fillWidth = thumbX.interpolate({
    inputRange: [0, travel],
    outputRange: [0, travel],
    extrapolate: 'clamp',
  });

  const step = (delta: number) => {
    const next = clamp(local + delta, levMin, levMax);
    setLocal(next);
    moveTo(next, true);
  };

  const pickPreset = (lev: number) => {
    const next = clamp(lev, levMin, levMax);
    setLocal(next);
    moveTo(next, true);
  };

  // Info: max openable qty at market price
  const maxQty = markPrice > 0 ? (freeMargin * local) / markPrice : 0;
  const maxNotional = freeMargin * local;
  const base = symbol.replace(/-PERP$/i, '').replace(/USDT$/i, '');

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={st.backdrop} onPress={onClose} />
      <View style={st.sheet}>
        <View style={st.handle} />

        {/* Header */}
        <View style={st.header}>
          <Text style={st.title}>Leverage</Text>
          <TouchableOpacity onPress={onClose} style={st.closeBtn} hitSlop={8}>
            <Icon name="x" size={18} color={Colors.textMuted} />
          </TouchableOpacity>
        </View>

        {/* Value + -/+ */}
        <View style={st.valueRow}>
          <TouchableOpacity style={st.stepBtn} onPress={() => step(-1)} activeOpacity={0.75}>
            <Icon name="minus" size={18} color={Colors.textPrimary} />
          </TouchableOpacity>
          <Text style={st.valueText}>{local}X</Text>
          <TouchableOpacity style={st.stepBtn} onPress={() => step(1)} activeOpacity={0.75}>
            <Icon name="plus" size={18} color={Colors.textPrimary} />
          </TouchableOpacity>
        </View>

        {/* Slider */}
        <View style={st.sliderWrap} onLayout={onTrackLayout} {...panResponder.panHandlers}>
          <View style={st.track}>
            <Animated.View style={[st.trackFill, { width: fillWidth }]} />
          </View>
          <Animated.View
            pointerEvents="none"
            style={[st.thumb, { transform: [{ translateX: thumbX }] }]}
          />
        </View>

        {/* Preset labels */}
        <View style={st.presetRow}>
          {chipPresets.map((p) => (
            <TouchableOpacity key={p} style={st.presetBtn} onPress={() => pickPreset(p)} activeOpacity={0.75}>
              <Text style={[st.presetTxt, local === p && st.presetTxtActive]}>{p}X</Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Info */}
        <View style={st.infoBox}>
          <Text style={st.infoTxt}>
            Max. openable position at market price and current leverage:{' '}
            <Text style={st.infoVal}>{maxQty > 0 ? maxQty.toFixed(2) : '0'} {base}</Text>
          </Text>
          <Text style={st.infoTxt}>
            Maximum Position (Current Leverage):{' '}
            <Text style={st.infoVal}>{maxNotional > 0 ? maxNotional.toFixed(2) : '0'} USDT</Text>
          </Text>
        </View>

        {/* Apply to all */}
        <TouchableOpacity
          style={st.applyAllRow}
          onPress={() => setApplyAll(v => !v)}
          activeOpacity={0.8}
        >
          <View style={[st.checkbox, applyAll && st.checkboxOn]}>
            {applyAll && <Icon name="check" size={10} color={FuturesUi.long} />}
          </View>
          <Text style={st.applyAllTxt}>Apply leverage adjustment to all futures</Text>
          <TouchableOpacity hitSlop={8}>
            <Icon name="information-outline" size={14} color={Colors.textMuted} />
          </TouchableOpacity>
        </TouchableOpacity>

        {/* Confirm */}
        <TouchableOpacity
          style={st.confirmBtn}
          onPress={() => { onConfirm(local, applyAll); onClose(); }}
          activeOpacity={0.85}
        >
          <Text style={st.confirmTxt}>Confirm</Text>
        </TouchableOpacity>
      </View>
    </Modal>
  );
}

export default memo(LeveragePickerModal);

const st = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: Colors.black60 },
  sheet: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    backgroundColor: Colors.surfaceCard,
    borderTopLeftRadius: Radius.xl, borderTopRightRadius: Radius.xl,
    borderWidth: 1, borderBottomWidth: 0, borderColor: Colors.surfaceBorder,
    paddingBottom: Spacing[8], paddingHorizontal: Spacing[5],
  },
  handle: {
    width: 36, height: 4, borderRadius: 2,
    backgroundColor: Colors.surfaceBorder,
    alignSelf: 'center', marginTop: Spacing[2], marginBottom: Spacing[2],
  },
  header: {
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between', paddingVertical: Spacing[3],
  },
  title: { fontFamily: FontFamily.bold, fontSize: FontSize.lg, color: Colors.textPrimary },
  closeBtn: {
    width: 30, height: 30, alignItems: 'center', justifyContent: 'center',
    borderRadius: 15, backgroundColor: Colors.surfaceHover,
  },

  valueRow: {
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'center', gap: Spacing[6], marginBottom: Spacing[5],
  },
  stepBtn: {
    width: 44, height: 44, borderRadius: 22,
    borderWidth: 1, borderColor: Colors.surfaceBorder,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: Colors.surfaceHover,
  },
  valueText: {
    fontFamily: FontFamily.bold, fontSize: 32, color: FuturesUi.long, minWidth: 90,
    textAlign: 'center',
  },

  sliderWrap: {
    height: 40, justifyContent: 'center',
    paddingHorizontal: THUMB / 2,
    marginBottom: Spacing[2],
  },
  track: {
    height: 4, borderRadius: 2,
    backgroundColor: Colors.surfaceBorder, overflow: 'hidden',
  },
  trackFill: {
    height: '100%', backgroundColor: FuturesUi.long, borderRadius: 2,
  },
  thumb: {
    position: 'absolute', left: THUMB / 2,
    width: THUMB, height: THUMB, borderRadius: THUMB / 2,
    backgroundColor: Colors.white,
    borderWidth: 2.5, borderColor: FuturesUi.long,
    top: 10,
    shadowColor: FuturesUi.long, shadowOpacity: 0.4, shadowRadius: 4, shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },

  presetRow: {
    flexDirection: 'row', justifyContent: 'space-between',
    marginBottom: Spacing[4],
  },
  presetBtn: { alignItems: 'center' },
  presetTxt: {
    fontFamily: FontFamily.mono, fontSize: FontSize.xs, color: Colors.textMuted,
  },
  presetTxtActive: { color: FuturesUi.longLight, fontFamily: FontFamily.monoMedium },

  infoBox: {
    backgroundColor: Colors.surfaceHover,
    borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.surfaceBorder,
    padding: Spacing[3], gap: Spacing[2], marginBottom: Spacing[4],
  },
  infoTxt: { fontFamily: FontFamily.regular, fontSize: FontSize.xs, color: Colors.textMuted },
  infoVal: { color: Colors.textSecondary, fontFamily: FontFamily.medium },

  applyAllRow: {
    flexDirection: 'row', alignItems: 'center',
    gap: Spacing[2], marginBottom: Spacing[5],
  },
  checkbox: {
    width: 16, height: 16, borderRadius: 3,
    borderWidth: 1.5, borderColor: Colors.textMuted,
    alignItems: 'center', justifyContent: 'center',
  },
  checkboxOn: { borderColor: FuturesUi.long, backgroundColor: FuturesUi.longDim },
  applyAllTxt: {
    flex: 1, fontFamily: FontFamily.regular, fontSize: FontSize.xs, color: Colors.textSecondary,
  },

  confirmBtn: {
    backgroundColor: FuturesUi.long,
    borderRadius: Radius.lg, paddingVertical: 14,
    alignItems: 'center',
  },
  confirmTxt: {
    fontFamily: FontFamily.bold, fontSize: FontSize.base, color: Colors.white,
  },
});
