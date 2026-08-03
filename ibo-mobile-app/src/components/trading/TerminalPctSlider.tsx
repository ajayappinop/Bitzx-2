/**
 * Terminal % slider — Binance-style: gesture-driven, self-contained, isolated from
 * parent re-renders. Thumb/fill use native updates while dragging; amount fill is
 * delegated via onLiveChange without feeding value back from parent.
 */
import React, { useRef, useCallback, useMemo, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, TextInput, LayoutChangeEvent, Pressable,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { Colors, FontFamily, FontSize, Spacing, Radius } from '@/theme';
import { FuturesUi } from '@/theme/futuresTerminal';

const PCT_MARKERS = [0, 25, 50, 75, 100] as const;
const SLIDER_THUMB = 20;
const SLIDER_DOT = 8;
const SLIDER_TRACK_H = 2;
const SLIDER_HIT_H = 36;
const SLIDER_LABEL_H = 16;
const SLIDER_LABEL_W = 32;

function clampPct(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function pctToProgress(pct: number): number {
  return clampPct(pct) / 100;
}

function progressToPct(progress: number): number {
  return clampPct(progress * 100);
}

function progressToThumbX(progress: number, trackW: number, thumbSize = SLIDER_THUMB): number {
  if (trackW <= thumbSize) return 0;
  const p = Math.max(0, Math.min(1, progress));
  return p * (trackW - thumbSize);
}

function progressToFillW(progress: number, trackW: number, thumbSize = SLIDER_THUMB): number {
  return progressToThumbX(progress, trackW, thumbSize) + thumbSize / 2;
}

function locationXToProgress(locationX: number, trackW: number): number {
  if (trackW <= 0) return 0;
  return Math.max(0, Math.min(1, locationX / trackW));
}

function markerLeft(pct: number, trackW: number, dotSize = SLIDER_DOT): number {
  if (trackW <= dotSize) return 0;
  if (pct <= 0) return 0;
  if (pct >= 100) return trackW - dotSize;
  const c = (clampPct(pct) / 100) * trackW;
  return c - dotSize / 2;
}

function sanitizePctInput(raw: string): string {
  const digits = raw.replace(/\D/g, '').slice(0, 3);
  if (digits === '') return '';
  const n = parseInt(digits, 10);
  if (Number.isFinite(n) && n > 100) return '100';
  return digits;
}

function parsePctInput(raw: string): number | null {
  const t = raw.trim();
  if (t === '') return null;
  const n = parseInt(t, 10);
  if (!Number.isFinite(n)) return null;
  return clampPct(n);
}

function labelLeft(pct: number, trackW: number, labelWidth = SLIDER_LABEL_W): number {
  if (trackW <= 0) return 0;
  if (pct === 0) return 0;
  if (pct === 100) return Math.max(0, trackW - labelWidth);
  const c = (clampPct(pct) / 100) * trackW;
  return Math.max(0, Math.min(trackW - labelWidth, c - labelWidth / 2));
}

type Props = {
  resetKey?: string;
  onLiveChange?: (pct: number) => void;
  onChange: (pct: number) => void;
  side?: 'buy' | 'sell';
  size?: 'default' | 'large';
  /** Hide built-in % field (futures uses external % row). */
  hidePctInput?: boolean;
  /** Sync thumb from parent % field without fighting drag. */
  syncPct?: number;
  /** Lock parent ScrollView while dragging (prevents vertical scroll stealing pan). */
  onLockParentScroll?: (locked: boolean) => void;
};

function TerminalPctSlider({
  resetKey = '',
  onLiveChange,
  onChange,
  side = 'buy',
  size = 'default',
  hidePctInput = false,
  syncPct,
  onLockParentScroll,
}: Props) {
  const isLarge = size === 'large';
  const thumb = isLarge ? 22 : SLIDER_THUMB;
  const dot = isLarge ? 10 : SLIDER_DOT;
  const trackH = isLarge ? 2.5 : SLIDER_TRACK_H;
  const hitH = isLarge ? 40 : SLIDER_HIT_H;
  const labelH = isLarge ? 18 : SLIDER_LABEL_H;
  const labelW = isLarge ? 34 : SLIDER_LABEL_W;
  const trackTop = (hitH - trackH) / 2;
  const thumbTop = (hitH - thumb) / 2;
  const dotTop = (hitH - dot) / 2;

  const [dotPct, setDotPct] = useState(0);
  const [trackReady, setTrackReady] = useState(false);
  const [inputKey, setInputKey] = useState(0);

  const trackWRef = useRef(0);
  const pctRef = useRef(0);
  const progressRef = useRef(0);
  const draggingRef = useRef(false);
  const editingPctRef = useRef(false);
  const grantXRef = useRef(0);
  const lastLivePctRef = useRef(-1);
  const onChangeRef = useRef(onChange);
  const onLiveChangeRef = useRef(onLiveChange);
  const fillRef = useRef<View>(null);
  const thumbRef = useRef<View>(null);
  const pctInputRef = useRef<TextInput>(null);
  const resetKeyRef = useRef(resetKey);
  const lockScrollRef = useRef(onLockParentScroll);
  lockScrollRef.current = onLockParentScroll;

  onChangeRef.current = onChange;
  onLiveChangeRef.current = onLiveChange;

  const setScrollLocked = useCallback((locked: boolean) => {
    lockScrollRef.current?.(locked);
  }, []);

  const accent = side === 'buy' ? FuturesUi.long : Colors.sellRed;

  const paintNative = useCallback((p: number) => {
    const w = trackWRef.current;
    if (w <= 0) return;
    fillRef.current?.setNativeProps({ style: { width: progressToFillW(p, w, thumb) } });
    thumbRef.current?.setNativeProps({
      style: { transform: [{ translateX: progressToThumbX(p, w, thumb) }] },
    });
  }, [thumb]);

  const syncPctInput = useCallback((pct: number) => {
    pctInputRef.current?.setNativeProps({ text: String(clampPct(pct)) });
  }, []);

  const commitInternal = useCallback((rawPct: number, notifyParent: boolean) => {
    const next = clampPct(rawPct);
    pctRef.current = next;
    progressRef.current = pctToProgress(next);
    if (!draggingRef.current) setDotPct(next);
    if (!editingPctRef.current) syncPctInput(next);
    paintNative(progressRef.current);
    if (notifyParent) {
      lastLivePctRef.current = next;
      onLiveChangeRef.current?.(next);
      onChangeRef.current(next);
    }
    return next;
  }, [paintNative, syncPctInput]);

  const emitLive = useCallback((nextPct: number) => {
    const clamped = clampPct(nextPct);
    if (clamped === lastLivePctRef.current) return;
    lastLivePctRef.current = clamped;
    onLiveChangeRef.current?.(clamped);
  }, []);

  const applyX = useCallback((x: number, live: boolean) => {
    const w = trackWRef.current;
    if (w <= 0) return 0;
    const clampedX = Math.max(0, Math.min(w, x));
    const p = locationXToProgress(clampedX, w);
    progressRef.current = p;
    const nextPct = progressToPct(p);
    pctRef.current = nextPct;
    paintNative(p);
    if (!editingPctRef.current) syncPctInput(nextPct);
    if (live) emitLive(nextPct);
    return nextPct;
  }, [paintNative, syncPctInput, emitLive]);

  const commitPct = useCallback((rawPct: number) => {
    commitInternal(rawPct, true);
  }, [commitInternal]);

  const inputTextRef = useRef('0');

  const handlePctInputChange = useCallback((text: string) => {
    const t = sanitizePctInput(text);
    inputTextRef.current = t;
    const parsed = parsePctInput(t);
    if (parsed == null) {
      pctInputRef.current?.setNativeProps({ text: t });
      return;
    }
    commitPct(parsed);
  }, [commitPct]);

  const handlePctInputBlur = useCallback(() => {
    editingPctRef.current = false;
    const parsed = parsePctInput(inputTextRef.current);
    commitPct(parsed ?? 0);
  }, [commitPct]);

  useEffect(() => {
    if (resetKeyRef.current === resetKey) return;
    resetKeyRef.current = resetKey;
    draggingRef.current = false;
    editingPctRef.current = false;
    lastLivePctRef.current = -1;
    pctRef.current = 0;
    progressRef.current = 0;
    setDotPct(0);
    setInputKey((k) => k + 1);
    paintNative(0);
    onChangeRef.current(0);
  }, [resetKey, paintNative]);

  useEffect(() => {
    if (syncPct == null || draggingRef.current || editingPctRef.current) return;
    const next = clampPct(syncPct);
    if (next === pctRef.current) return;
    commitInternal(next, false);
  }, [syncPct, commitInternal]);

  const panGesture = useMemo(
    () =>
      Gesture.Pan()
        .activeOffsetX([-4, 4])
        .failOffsetY([-12, 12])
        .onBegin((e) => {
          editingPctRef.current = false;
          draggingRef.current = true;
          setScrollLocked(true);
          grantXRef.current = e.x;
          applyX(grantXRef.current, true);
        })
        .onUpdate((e) => {
          applyX(grantXRef.current + e.translationX, true);
        })
        .onEnd((e) => {
          if (!draggingRef.current) return;
          const nextPct = applyX(grantXRef.current + e.translationX, false);
          draggingRef.current = false;
          setScrollLocked(false);
          setDotPct(clampPct(nextPct));
          commitInternal(nextPct, true);
        })
        .onFinalize(() => {
          if (!draggingRef.current) return;
          draggingRef.current = false;
          setScrollLocked(false);
          setDotPct(pctRef.current);
          commitInternal(pctRef.current, true);
        }),
    [applyX, commitInternal, setScrollLocked],
  );

  const tapGesture = useMemo(
    () =>
      Gesture.Tap()
        .onEnd((e) => {
          if (trackWRef.current <= 0) return;
          const nextPct = applyX(e.x, false);
          commitInternal(nextPct, true);
        }),
    [applyX, commitInternal],
  );

  const trackGesture = useMemo(
    () => Gesture.Race(panGesture, tapGesture),
    [panGesture, tapGesture],
  );

  const onTrackLayout = (e: LayoutChangeEvent) => {
    const w = e.nativeEvent.layout.width;
    if (w <= 0) return;
    if (Math.abs(w - trackWRef.current) < 1) return;
    trackWRef.current = w;
    if (!trackReady) setTrackReady(true);
    if (!draggingRef.current) paintNative(progressRef.current);
  };

  const trackW = trackWRef.current;

  return (
    <View style={[styles.wrap, hidePctInput && styles.wrapCompact]} collapsable={false}>
      {!hidePctInput ? (
        <View style={styles.pctInputRow}>
          <TextInput
            key={`pct-in-${inputKey}`}
            ref={pctInputRef}
            style={[styles.pctValueInput, { color: accent, borderColor: accent }]}
            defaultValue="0"
            onChangeText={handlePctInputChange}
            onFocus={() => { editingPctRef.current = true; }}
            onBlur={handlePctInputBlur}
            keyboardType="number-pad"
            maxLength={3}
            selectTextOnFocus
            placeholder="0"
            placeholderTextColor={Colors.textMuted}
          />
          <Text style={[styles.pctInputSuffix, { color: accent }]}>%</Text>
        </View>
      ) : null}
      <GestureDetector gesture={trackGesture}>
        <View
          style={[styles.pctTrackHit, { height: hitH }]}
          onLayout={onTrackLayout}
          collapsable={false}
        >
          <View
            pointerEvents="none"
            style={[styles.pctTrack, { top: trackTop, height: trackH }]}
          >
            <View
              ref={fillRef}
              style={[
                styles.pctTrackFill,
                {
                  width: trackReady ? progressToFillW(progressRef.current, trackW, thumb) : 0,
                  backgroundColor: accent,
                  height: trackH,
                },
              ]}
            />
          </View>
          {trackReady &&
            PCT_MARKERS.map((p) => (
              <Pressable
                key={p}
                onPress={() => commitPct(p)}
                style={[
                  styles.pctMarkerHit,
                  {
                    left: markerLeft(p, trackW, dot) - 6,
                    top: dotTop - 6,
                    width: dot + 12,
                    height: dot + 12,
                  },
                ]}
              >
                <View
                  style={[
                    styles.pctDot,
                    { width: dot, height: dot, borderRadius: dot / 2 },
                    dotPct === p && { borderColor: accent, backgroundColor: accent },
                  ]}
                />
              </Pressable>
            ))}
          <View
            ref={thumbRef}
            pointerEvents="none"
            style={[
              styles.pctThumb,
              {
                top: thumbTop,
                width: thumb,
                height: thumb,
                borderRadius: thumb / 2,
                borderColor: accent,
                backgroundColor: Colors.surfaceCard,
                transform: [{
                  translateX: trackReady
                    ? progressToThumbX(progressRef.current, trackW, thumb)
                    : 0,
                }],
              },
            ]}
          />
        </View>
      </GestureDetector>
      {trackReady && (
        <View style={[styles.pctLabelsRow, { height: labelH }]} pointerEvents="none">
          {PCT_MARKERS.map((p) => (
            <Text
              key={p}
              style={[
                styles.pctLabelTxt,
                isLarge && styles.pctLabelTxtLarge,
                { left: labelLeft(p, trackW, labelW), width: labelW },
              ]}
            >
              {p}%
            </Text>
          ))}
        </View>
      )}
    </View>
  );
}

export default React.memo(TerminalPctSlider);

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: 2, minHeight: SLIDER_HIT_H + SLIDER_LABEL_H + 30 },
  wrapCompact: { minHeight: SLIDER_HIT_H + SLIDER_LABEL_H + 4, paddingTop: 0 },
  pctInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-end',
    marginBottom: 2,
    gap: 2,
  },
  pctValueInput: {
    minWidth: 44,
    height: 24,
    paddingHorizontal: 6,
    paddingVertical: 0,
    fontFamily: FontFamily.monoMedium,
    fontSize: FontSize.sm,
    textAlign: 'center',
    backgroundColor: Colors.surfaceCard,
    borderWidth: 1,
    borderRadius: Radius.sm,
    color: Colors.textPrimary,
  },
  pctInputSuffix: { fontFamily: FontFamily.monoMedium, fontSize: FontSize.sm },
  pctTrackHit: { position: 'relative' },
  pctTrack: {
    position: 'absolute',
    left: 0,
    right: 0,
    backgroundColor: Colors.surfaceBorder,
    borderRadius: 1,
    overflow: 'hidden',
  },
  pctTrackFill: { borderRadius: 1 },
  pctMarkerHit: {
    position: 'absolute',
    zIndex: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pctDot: {
    backgroundColor: Colors.surfaceCard,
    borderWidth: 2,
    borderColor: Colors.surfaceBorder,
  },
  pctThumb: {
    position: 'absolute',
    left: 0,
    borderWidth: 2,
    zIndex: 4,
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.35,
    shadowRadius: 2,
  },
  pctLabelsRow: { position: 'relative', marginTop: 0 },
  pctLabelTxt: {
    position: 'absolute',
    fontFamily: FontFamily.medium,
    fontSize: 10,
    color: Colors.textSecondary,
    textAlign: 'center',
  },
  pctLabelTxtLarge: {
    fontSize: FontSize.xs,
  },
});
