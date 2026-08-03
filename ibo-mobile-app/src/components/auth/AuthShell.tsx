import React, { useRef, useState, useEffect, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Platform,
  ScrollView,
  Keyboard,
  Dimensions,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors, FontFamily, FontSize, Spacing, Radius } from '../../theme';
import { AuthScrollContext } from './AuthScrollContext';
import AppLogo from '../common/AppLogo';
import AdaptiveKeyboardAvoidingView from '../common/AdaptiveKeyboardAvoidingView';
import { iosManualKeyboardScrollProps } from '../../utils/iosKeyboardScroll';

export type AuthShellTab = 'login' | 'register';

type Props = {
  activeTab: AuthShellTab;
  onTabChange: (tab: AuthShellTab) => void;
  children: React.ReactNode;
};

// Padding above the focused field so it doesn't sit flush at the visible top
const FIELD_MARGIN_ABOVE = 16;

export default function AuthShell({ activeTab, onTabChange, children }: Props) {
  const insets = useSafeAreaInsets();
  const scrollRef = useRef<ScrollView>(null);
  const contentRef = useRef<View>(null);
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const keyboardHeightRef = useRef(0);
  const scrollOffsetRef = useRef(0);
  const pendingFieldRef = useRef<React.RefObject<View | null> | null>(null);

  /**
   * Scroll only enough so the focused field is visible above the keyboard.
   * Does NOT scroll if the field is already fully visible.
   */
  const scrollFieldIntoView = useCallback(
    (fieldRef: React.RefObject<View | null>, kbH = keyboardHeightRef.current) => {
      const field = fieldRef.current;
      const content = contentRef.current;
      const scroll = scrollRef.current;
      if (!field || !content || !scroll) return;

      field.measureLayout(
        content,
        (_x, fieldY, _w, fieldH) => {
          const screenH = Dimensions.get('window').height;
          const currentScrollY = scrollOffsetRef.current;

          // The visible window in content coordinates
          // Top of visible area = currentScrollY
          // Bottom of visible area = currentScrollY + (screenH - kbH - safeTop - safeBottom)
          const safeTop = insets.top;
          const safeBottom = insets.bottom;
          const visibleH = screenH - kbH - safeTop - safeBottom;
          const visibleTop = currentScrollY;
          const visibleBottom = currentScrollY + visibleH - FIELD_MARGIN_ABOVE;

          // Bottom edge of the field in content coordinates
          const fieldBottom = fieldY + fieldH;

          if (fieldBottom > visibleBottom) {
            // Field is below the visible area — scroll just enough to show it
            const targetY = fieldBottom - visibleH + FIELD_MARGIN_ABOVE;
            scroll.scrollTo({ y: Math.max(0, targetY), animated: true });
          } else if (fieldY < visibleTop) {
            // Field is above the visible area — scroll up just enough
            scroll.scrollTo({ y: Math.max(0, fieldY - FIELD_MARGIN_ABOVE), animated: true });
          }
          // Otherwise field is already visible — do nothing
        },
        () => {},
      );
    },
    [insets.top, insets.bottom],
  );

  const scrollFieldIntoViewRef = useRef(scrollFieldIntoView);
  scrollFieldIntoViewRef.current = scrollFieldIntoView;

  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';

    const onShow = Keyboard.addListener(showEvent, (e) => {
      const h = e.endCoordinates.height;
      keyboardHeightRef.current = h;
      setKeyboardHeight(h);
      if (pendingFieldRef.current) {
        const fieldRef = pendingFieldRef.current;
        pendingFieldRef.current = null;
        requestAnimationFrame(() => scrollFieldIntoViewRef.current(fieldRef, h));
      }
    });

    const onHide = Keyboard.addListener(hideEvent, () => {
      keyboardHeightRef.current = 0;
      setKeyboardHeight(0);
    });

    return () => {
      onShow.remove();
      onHide.remove();
    };
  }, []);

  const scrollFieldIntoViewDeferred = useCallback(
    (fieldRef: React.RefObject<View | null>) => {
      pendingFieldRef.current = fieldRef;
      const kbH = keyboardHeightRef.current;
      if (kbH > 0) {
        // Keyboard already open — schedule after layout settles
        pendingFieldRef.current = null;
        const delay = Platform.OS === 'ios' ? 50 : 150;
        setTimeout(() => scrollFieldIntoViewRef.current(fieldRef, kbH), delay);
      }
      // else: keyboard isn't open yet — the keyboardWillShow/keyboardDidShow
      // listener will fire and pick it up from pendingFieldRef
    },
    [],
  );

  const scrollCtx = useMemo(
    () => ({ scrollFieldIntoView: scrollFieldIntoViewDeferred }),
    [scrollFieldIntoViewDeferred],
  );

  const { width: screenW } = useWindowDimensions();
  const keyboardOpen = keyboardHeight > 0;

  // Responsive logo sizing: ~55% of screen width, capped for large screens
  const logoW     = Math.min(Math.round(screenW * 0.55), 220);
  const logoH     = Math.round(logoW / 2.8);            // logo aspect ≈ 2.8:1
  const logoWsm   = Math.min(Math.round(screenW * 0.38), 150);
  const logoHsm   = Math.round(logoWsm / 2.8);

  return (
    <AuthScrollContext.Provider value={scrollCtx}>
      <SafeAreaView style={styles.safe} edges={['top']}>
        <AdaptiveKeyboardAvoidingView
          style={styles.flex}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          keyboardVerticalOffset={Platform.OS === 'ios' ? insets.top : 0}
        >
          <ScrollView
            ref={scrollRef}
            style={styles.scroll}
            onScroll={(e) => { scrollOffsetRef.current = e.nativeEvent.contentOffset.y; }}
            scrollEventThrottle={16}
            contentContainerStyle={[
              styles.scrollContent,
              Platform.OS !== 'ios' && keyboardOpen && styles.scrollContentKeyboard,
              {
                paddingBottom:
                  Platform.OS !== 'ios' && keyboardOpen
                    ? keyboardHeight + Spacing[6]
                    : Spacing[8] + insets.bottom,
              },
            ]}
            {...iosManualKeyboardScrollProps()}
            showsVerticalScrollIndicator={false}
          >
            <View ref={contentRef} collapsable={false}>
              <View style={[styles.brandBlock, Platform.OS === 'ios' && keyboardOpen && styles.brandBlockCompact]}>
                <AppLogo
                  width={Platform.OS === 'ios' && keyboardOpen ? logoWsm : logoW}
                  height={Platform.OS === 'ios' && keyboardOpen ? logoHsm : logoH}
                />
              {!keyboardOpen && (
                <Text style={styles.tagline}>Professional Crypto Exchange</Text>
              )}
            </View>

            <View style={styles.card}>
              <View style={styles.segment}>
                <TouchableOpacity
                  style={[styles.segmentBtn, activeTab === 'login' && styles.segmentBtnActive]}
                  onPress={() => onTabChange('login')}
                  activeOpacity={0.85}
                >
                  <Text style={[styles.segmentLabel, activeTab === 'login' && styles.segmentLabelActive]}>
                    Log In
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.segmentBtn, activeTab === 'register' && styles.segmentBtnActive]}
                  onPress={() => onTabChange('register')}
                  activeOpacity={0.85}
                >
                  <Text style={[styles.segmentLabel, activeTab === 'register' && styles.segmentLabelActive]}>
                    Sign Up
                  </Text>
                </TouchableOpacity>
              </View>

                <View style={styles.cardBody}>{children}</View>
              </View>

              {!keyboardOpen && (
                <Text style={styles.footer}>
                  By continuing, you agree to our Terms of Service and Privacy Policy.
                </Text>
              )}
            </View>
          </ScrollView>
        </AdaptiveKeyboardAvoidingView>
      </SafeAreaView>
    </AuthScrollContext.Provider>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.surfaceDark },
  flex: { flex: 1 },
  scroll: { flex: 1 },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: Spacing[6],
    paddingTop: Spacing[4],
    justifyContent: 'center',
  },
  scrollContentKeyboard: {
    justifyContent: 'flex-start',
    paddingTop: Spacing[2],
  },

  brandBlock: { alignItems: 'center', marginBottom: Spacing[7] },
  brandBlockCompact: { marginBottom: Spacing[3] },
  tagline: {
    fontFamily: FontFamily.regular,
    fontSize: FontSize.sm,
    color: Colors.textMuted,
    marginTop: Spacing[2],
    letterSpacing: 0.6,
    textAlign: 'center',
  },

  card: {
    backgroundColor: Colors.surfaceCard,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    borderRadius: Radius.xl,
    overflow: 'hidden',
  },
  segment: {
    flexDirection: 'row',
    padding: Spacing[2],
    backgroundColor: Colors.surfaceHover,
    borderBottomWidth: 1,
    borderBottomColor: Colors.surfaceBorder,
  },
  segmentBtn: {
    flex: 1,
    marginHorizontal: Spacing[1],
    paddingVertical: Spacing[3],
    borderRadius: Radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  segmentBtnActive: {
    backgroundColor: Colors.goldAlpha15,
    borderWidth: 1,
    borderColor: Colors.goldAlpha30,
  },
  segmentLabel: {
    fontFamily: FontFamily.semiBold,
    fontSize: FontSize.md,
    color: Colors.textMuted,
    letterSpacing: 0.3,
  },
  segmentLabelActive: {
    color: Colors.goldLight,
  },
  cardBody: {
    paddingHorizontal: Spacing[6],
    paddingTop: Spacing[6],
    paddingBottom: Spacing[6],
  },

  footer: {
    fontFamily: FontFamily.regular,
    fontSize: FontSize.xs,
    color: Colors.textDisabled,
    textAlign: 'center',
    lineHeight: 18,
    marginTop: Spacing[6],
    paddingHorizontal: Spacing[2],
  },
});
