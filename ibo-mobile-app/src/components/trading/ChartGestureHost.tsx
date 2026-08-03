/**
 * Isolates chart pan/pinch from parent ScrollViews.
 * Locks parent vertical scroll while the finger is inside the chart bounds.
 */
import React, { useCallback, useMemo, useRef } from 'react';
import { View, PanResponder, StyleSheet, type ViewStyle } from 'react-native';

type Props = {
  children: React.ReactNode;
  style?: ViewStyle;
  /** Called when chart area captures a gesture — disable parent page scroll. */
  onLockParentScroll?: (locked: boolean) => void;
};

export default function ChartGestureHost({ children, style, onLockParentScroll }: Props) {
  const lockRef = useRef(onLockParentScroll);
  lockRef.current = onLockParentScroll;

  const setLocked = useCallback((locked: boolean) => {
    lockRef.current?.(locked);
  }, []);

  const panResponder = useMemo(
    () => PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: () => false,
      onStartShouldSetPanResponderCapture: () => {
        setLocked(true);
        return false;
      },
      onMoveShouldSetPanResponderCapture: () => false,
      onPanResponderTerminationRequest: () => true,
      onPanResponderRelease: () => setLocked(false),
      onPanResponderTerminate: () => setLocked(false),
    }),
    [setLocked],
  );

  return (
    <View
      style={[styles.host, style]}
      collapsable={false}
      {...panResponder.panHandlers}
      onTouchEnd={() => setLocked(false)}
      onTouchCancel={() => setLocked(false)}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  host: {
    overflow: 'hidden',
  },
});
