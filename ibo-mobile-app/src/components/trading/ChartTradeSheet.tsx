/**
 * Swipeable bottom-sheet modal for Buy / Sell on the chart page.
 *
 * Drag-to-dismiss uses react-native-gesture-handler (not PanResponder +
 * Animated.event, which throws "Object is not a function" on onResponderMove).
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Modal,
  Animated,
  Easing,
  Platform,
  useWindowDimensions,
  ScrollView,
  Pressable,
  Keyboard,
} from 'react-native';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AppIcon from '../common/AppIcon';
import TradeForm from './TradeForm';
import { iosManualKeyboardScrollProps } from '@/utils/iosKeyboardScroll';
import FuturesChartOrderForm from './FuturesChartOrderForm';
import { Colors, FontFamily, FontSize, Spacing, Radius, LayoutColors } from '../../theme';
import { toSpotSymbol } from '../../utils/tradeSymbols';
import type { TradeMarketType } from './TradeMarketHeader';

const OPEN_MS = 320;
const CLOSE_MS = 260;
const OPEN_EASE = Easing.bezier(0.22, 1, 0.36, 1);
const CLOSE_EASE = Easing.bezier(0.4, 0, 1, 1);
const DISMISS_PX = 100;
const DISMISS_VY = 600;

type Props = {
  open: boolean;
  symbol: string;
  market: TradeMarketType;
  side: 'buy' | 'sell';
  leverage?: number;
  onClose: () => void;
  onSideChange?: (side: 'buy' | 'sell') => void;
  onLockParentScroll?: (locked: boolean) => void;
  onOpened?: () => void;
};

export default function ChartTradeSheet({
  open, symbol, market, side, leverage,
  onClose, onSideChange, onLockParentScroll, onOpened,
}: Props) {
  const insets = useSafeAreaInsets();
  const { height: winH } = useWindowDimensions();
  const sheetH = Math.min(winH * 0.88, winH - Math.max(insets.top, 12) - 8);

  const isFutures = market === 'futures' || market === 'options';
  const spotSym = toSpotSymbol(symbol);
  const buyLabel = isFutures ? 'Long' : 'Buy';
  const sellLabel = isFutures ? 'Short' : 'Sell';

  const [visible, setVisible] = useState(false);
  const [keyboardH, setKeyboardH] = useState(0);

  const translateY = useRef(new Animated.Value(sheetH)).current;
  const sheetYRef = useRef(sheetH);
  const dragOriginY = useRef(0);
  const sheetHRef = useRef(sheetH);
  sheetHRef.current = sheetH;

  const backdropOpacity = useRef(
    translateY.interpolate({
      inputRange: [0, sheetH],
      outputRange: [1, 0],
      extrapolate: 'clamp',
    }),
  ).current;

  const animRef = useRef<Animated.CompositeAnimation | null>(null);
  const closingRef = useRef(false);
  const openRef = useRef(open);
  openRef.current = open;
  const cbClose = useRef(onClose);
  cbClose.current = onClose;
  const cbOpened = useRef(onOpened);
  cbOpened.current = onOpened;
  const doCloseRef = useRef<(notify: boolean) => void>(() => {});

  const runTo = useCallback((toValue: number, onDone?: () => void) => {
    animRef.current?.stop();
    const opening = toValue === 0;
    animRef.current = Animated.timing(translateY, {
      toValue,
      duration: opening ? OPEN_MS : CLOSE_MS,
      easing: opening ? OPEN_EASE : CLOSE_EASE,
      useNativeDriver: true,
    });
    animRef.current.start(({ finished }) => {
      if (finished) {
        sheetYRef.current = toValue;
        onDone?.();
      }
    });
  }, [translateY]);

  const seal = useCallback(() => {
    Keyboard.dismiss();
    setKeyboardH(0);
    setVisible(false);
    translateY.setValue(sheetHRef.current);
    sheetYRef.current = sheetHRef.current;
    closingRef.current = false;
  }, [translateY]);

  const doClose = useCallback((notify: boolean) => {
    if (closingRef.current) return;
    closingRef.current = true;
    translateY.stopAnimation();
    runTo(sheetHRef.current, () => {
      seal();
      if (notify) cbClose.current();
    });
  }, [runTo, seal, translateY]);

  doCloseRef.current = doClose;

  useEffect(() => {
    const showEvt = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvt = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const showSub = Keyboard.addListener(showEvt, (e) => {
      setKeyboardH(e.endCoordinates.height);
    });
    const hideSub = Keyboard.addListener(hideEvt, () => {
      setKeyboardH(0);
    });
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  useEffect(() => {
    if (open) {
      closingRef.current = false;
      translateY.setValue(sheetHRef.current);
      sheetYRef.current = sheetHRef.current;
      setVisible(true);
      const id = requestAnimationFrame(() => {
        runTo(0, () => {
          if (openRef.current) cbOpened.current?.();
        });
      });
      return () => cancelAnimationFrame(id);
    }
    if (visible && !closingRef.current) doClose(false);
    return undefined;
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const requestClose = useCallback(() => {
    doClose(true);
  }, [doClose]);

  const dismissGesture = useMemo(
    () =>
      Gesture.Pan()
        .activeOffsetY(6)
        .failOffsetX([-18, 18])
        .onStart(() => {
          animRef.current?.stop();
          translateY.stopAnimation();
          dragOriginY.current = sheetYRef.current;
        })
        .onUpdate((e) => {
          const nextY = Math.max(0, dragOriginY.current + Math.max(0, e.translationY));
          sheetYRef.current = nextY;
          translateY.setValue(nextY);
        })
        .onEnd((e) => {
          const dy = Math.max(0, e.translationY);
          if (dy > DISMISS_PX || e.velocityY > DISMISS_VY) {
            doCloseRef.current(true);
            return;
          }
          Animated.spring(translateY, {
            toValue: 0,
            useNativeDriver: true,
            damping: 22,
            stiffness: 300,
            mass: 0.8,
            overshootClamping: true,
          }).start(({ finished }) => {
            if (finished) sheetYRef.current = 0;
          });
        }),
    [translateY],
  );

  if (!visible) return null;

  const topInset = Math.max(insets.top, 12);
  const sheetMaxH = keyboardH > 0
    ? Math.min(sheetH, winH - keyboardH - topInset - 8)
    : sheetH;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      statusBarTranslucent={Platform.OS === 'android'}
      onRequestClose={requestClose}
    >
      {/* RNGH requires its own root inside Modal (Modal renders outside app tree). */}
      <GestureHandlerRootView style={styles.root}>
        <Pressable style={StyleSheet.absoluteFill} onPress={requestClose}>
          <Animated.View style={[styles.backdrop, { opacity: backdropOpacity }]} />
        </Pressable>

        <View
          style={[styles.kav, keyboardH > 0 ? { marginBottom: keyboardH } : null]}
          pointerEvents="box-none"
        >
          <Animated.View
            style={[
              styles.sheet,
              {
                maxHeight: sheetMaxH,
                ...(keyboardH > 0 ? { height: sheetMaxH } : null),
                paddingBottom: Math.max(insets.bottom, Spacing[3]),
                transform: [{ translateY }],
              },
            ]}
          >
            <View style={styles.dragZone}>
              <View style={styles.topBar}>
                <GestureDetector gesture={dismissGesture}>
                  <View style={styles.handleHit}>
                    <View style={styles.handle} />
                  </View>
                </GestureDetector>
                <TouchableOpacity
                  onPress={requestClose}
                  style={styles.closeBtn}
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                  accessibilityLabel="Close trade sheet"
                >
                  <AppIcon name="close" size={18} color={Colors.textMuted} />
                </TouchableOpacity>
              </View>

              <View style={styles.sideTabs}>
                <TouchableOpacity
                  style={[styles.sideTab, side === 'buy' && styles.sideTabBuyOn]}
                  onPress={() => onSideChange?.('buy')}
                  activeOpacity={0.88}
                >
                  <Text style={[styles.sideTabTxt, side === 'buy' && styles.sideTabTxtBuy]}>
                    {buyLabel}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.sideTab, side === 'sell' && styles.sideTabSellOn]}
                  onPress={() => onSideChange?.('sell')}
                  activeOpacity={0.88}
                >
                  <Text style={[styles.sideTabTxt, side === 'sell' && styles.sideTabTxtSell]}>
                    {sellLabel}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>

            <ScrollView
              style={styles.body}
              contentContainerStyle={[
                styles.bodyContent,
                keyboardH > 0 ? styles.bodyContentKeyboard : null,
              ]}
              {...iosManualKeyboardScrollProps()}
              keyboardShouldPersistTaps="always"
              showsVerticalScrollIndicator
              bounces
              nestedScrollEnabled
              overScrollMode="always"
            >
              {isFutures ? (
                <FuturesChartOrderForm
                  symbol={symbol}
                  initialSide={side}
                  leverageHint={leverage}
                  onOrderPlaced={requestClose}
                />
              ) : (
                <TradeForm
                  symbol={spotSym}
                  variant="card"
                  initialSide={side}
                  hideSideSelector
                  onOrderPlaced={requestClose}
                  onLockParentScroll={onLockParentScroll}
                />
              )}
            </ScrollView>
          </Animated.View>
        </View>
      </GestureHandlerRootView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  backdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
  },
  kav: {
    width: '100%',
    justifyContent: 'flex-end',
  },
  sheet: {
    width: '100%',
    flexDirection: 'column',
    backgroundColor: Colors.surfaceDark,
    borderTopLeftRadius: Radius.xl,
    borderTopRightRadius: Radius.xl,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.surfaceBorder,
  },
  dragZone: {
    paddingHorizontal: Spacing[4],
    paddingBottom: Spacing[3],
  },
  topBar: {
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 36,
    marginBottom: Spacing[3],
  },
  handleHit: {
    alignItems: 'center',
    paddingVertical: Spacing[2],
    paddingHorizontal: Spacing[8],
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: Colors.surfaceBorder,
  },
  sideTabs: {
    flexDirection: 'row',
    backgroundColor: Colors.surfaceHover,
    borderRadius: Radius.md,
    padding: 3,
    gap: 3,
  },
  sideTab: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
    borderRadius: Radius.sm,
  },
  sideTabBuyOn: {
    backgroundColor: Colors.buyGreenDim,
    borderWidth: 1,
    borderColor: LayoutColors.marketUp,
  },
  sideTabSellOn: {
    backgroundColor: Colors.sellRedDim,
    borderWidth: 1,
    borderColor: LayoutColors.marketDown,
  },
  sideTabTxt: {
    fontFamily: FontFamily.semiBold,
    fontSize: FontSize.sm,
    color: Colors.textMuted,
  },
  sideTabTxtBuy: {
    color: LayoutColors.marketUp,
    fontFamily: FontFamily.bold,
  },
  sideTabTxtSell: {
    color: LayoutColors.marketDown,
    fontFamily: FontFamily.bold,
  },
  closeBtn: {
    position: 'absolute',
    top: 0,
    right: 0,
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.md,
    backgroundColor: Colors.surfaceHover,
  },
  body: {
    flexGrow: 1,
    flexShrink: 1,
  },
  bodyContent: {
    paddingHorizontal: Spacing[4],
    paddingBottom: Spacing[2],
  },
  bodyContentKeyboard: {
    paddingBottom: Spacing[8],
  },
});
