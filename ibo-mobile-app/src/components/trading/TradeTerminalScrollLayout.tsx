/**
 * Trade / Futures terminal scroll — chart overlays the top; only the lower pane scrolls.
 * Chart pans independently; scrolling the lower area pushes the chart up and off-screen.
 */
import React, { useRef, useState, useEffect } from 'react';
import {
  View,
  Animated,
  StyleSheet,
  Platform,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { iosManualKeyboardScrollProps } from '../../utils/iosKeyboardScroll';

type Props = {
  chart: React.ReactNode;
  /** Reset scroll position when chart height/content changes (e.g. expand/collapse). */
  chartResetKey?: string | number;
  scrollEnabled?: boolean;
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  contentContainerStyle?: StyleProp<ViewStyle>;
};

export default function TradeTerminalScrollLayout({
  chart,
  chartResetKey,
  scrollEnabled = true,
  children,
  style,
  contentContainerStyle,
}: Props) {
  const scrollY = useRef(new Animated.Value(0)).current;
  const scrollRef = useRef<Animated.ScrollView>(null);
  const [chartH, setChartH] = useState(0);

  useEffect(() => {
    scrollY.setValue(0);
    scrollRef.current?.scrollTo({ y: 0, animated: false });
  }, [chartResetKey, scrollY]);

  const chartTranslateY = scrollY.interpolate({
    inputRange: [0, Math.max(chartH, 1)],
    outputRange: [0, -Math.max(chartH, 1)],
    extrapolate: 'clamp',
  });

  return (
    <View style={[styles.wrap, style]} collapsable={false}>
      <Animated.ScrollView
        ref={scrollRef}
        style={styles.scroll}
        contentContainerStyle={[
          chartH > 0 ? { paddingTop: chartH } : null,
          contentContainerStyle,
        ]}
        showsVerticalScrollIndicator={false}
        {...iosManualKeyboardScrollProps()}
        nestedScrollEnabled
        scrollEnabled={scrollEnabled}
        scrollEventThrottle={16}
        onScroll={Animated.event(
          [{ nativeEvent: { contentOffset: { y: scrollY } } }],
          { useNativeDriver: true },
        )}
      >
        {children}
      </Animated.ScrollView>

      <Animated.View
        style={[
          styles.chartOverlay,
          chartH > 0 ? { transform: [{ translateY: chartTranslateY }] } : null,
        ]}
        pointerEvents="box-none"
        collapsable={false}
      >
        <View
          onLayout={(e) => {
            const h = Math.ceil(e.nativeEvent.layout.height);
            if (h > 0 && h !== chartH) setChartH(h);
          }}
        >
          {chart}
        </View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    overflow: 'hidden',
  },
  chartOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 1,
    overflow: 'hidden',
    ...(Platform.OS === 'android' ? { elevation: 1 } : null),
  },
  scroll: {
    flex: 1,
  },
});
