/**
 * Animated splash screen.
 * Uses ONLY translateY + opacity + scale (safe with useNativeDriver on Android).
 * No skewX / shimmer — those crash on some Android builds.
 */
import React, { useEffect, useRef, useCallback } from 'react';
import { Animated, StyleSheet, Easing, Dimensions } from 'react-native';
import AppLogo from './AppLogo';

const { height: SCREEN_H } = Dimensions.get('window');
const MIN_MS = 1800;

type Props = {
  authReady: boolean;
  onFinish: () => void;
};

export default function AnimatedSplash({ authReady, onFinish }: Props) {
  const screenOp  = useRef(new Animated.Value(1)).current;
  const logoOp    = useRef(new Animated.Value(0)).current;
  const logoY     = useRef(new Animated.Value(24)).current;
  const logoScale = useRef(new Animated.Value(0.82)).current;
  const taglineOp = useRef(new Animated.Value(0)).current;
  const taglineY  = useRef(new Animated.Value(10)).current;

  const authReadyRef  = useRef(authReady);
  const animDoneRef   = useRef(false);
  const exitCalledRef = useRef(false);
  const startedAt     = useRef(Date.now());

  useEffect(() => { authReadyRef.current = authReady; }, [authReady]);

  const doExit = useCallback(() => {
    if (exitCalledRef.current) return;
    exitCalledRef.current = true;
    Animated.timing(screenOp, {
      toValue: 0,
      duration: 500,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start(() => onFinish());
  }, [onFinish, screenOp]);

  const maybeExit = useCallback(() => {
    animDoneRef.current = true;
    const remaining = Math.max(0, MIN_MS - (Date.now() - startedAt.current));
    setTimeout(() => {
      if (authReadyRef.current) doExit();
    }, remaining);
  }, [doExit]);

  useEffect(() => {
    if (authReady && animDoneRef.current) doExit();
  }, [authReady, doExit]);

  useEffect(() => {
    Animated.sequence([
      // 1 — Logo rises + fades in
      Animated.parallel([
        Animated.timing(logoOp, {
          toValue: 1,
          duration: 400,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(logoY, {
          toValue: 0,
          duration: 420,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(logoScale, {
          toValue: 1,
          duration: 420,
          easing: Easing.out(Easing.back(1.4)),
          useNativeDriver: true,
        }),
      ]),
      // 2 — Tagline fades up
      Animated.parallel([
        Animated.timing(taglineOp, {
          toValue: 1,
          duration: 300,
          useNativeDriver: true,
        }),
        Animated.timing(taglineY, {
          toValue: 0,
          duration: 300,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
      ]),
      // 3 — Hold
      Animated.delay(700),
    ]).start(maybeExit);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Animated.View style={[styles.root, { opacity: screenOp }]}>
      {/* Gold ambient glow */}
      <Animated.View style={[styles.glow, { opacity: logoOp }]} />

      {/* Logo */}
      <Animated.View
        style={{
          transform: [{ translateY: logoY }, { scale: logoScale }],
          opacity: logoOp,
        }}
      >
        <AppLogo width={230} height={82} />
      </Animated.View>

      {/* Divider line */}
      <Animated.View style={[styles.divider, { opacity: taglineOp }]} />

      {/* Tagline */}
      <Animated.Text
        style={[
          styles.tagline,
          { opacity: taglineOp, transform: [{ translateY: taglineY }] },
        ]}
      >
        PROFESSIONAL CRYPTO EXCHANGE
      </Animated.Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    height: SCREEN_H,
    backgroundColor: '#000000',
    alignItems: 'center',
    justifyContent: 'center',
  },
  glow: {
    position: 'absolute',
    width: 280,
    height: 140,
    borderRadius: 140,
    backgroundColor: 'rgba(155, 121, 65, 0.12)',
  },
  divider: {
    marginTop: 24,
    width: 48,
    height: 1,
    backgroundColor: 'rgba(197,227,91,0.35)',
    borderRadius: 1,
  },
  tagline: {
    marginTop: 14,
    color: 'rgba(197,227,91,0.5)',
    fontSize: 10,
    letterSpacing: 3,
    fontFamily: 'sans-serif-light',
  },
});
