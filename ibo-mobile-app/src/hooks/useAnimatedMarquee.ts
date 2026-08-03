import { useCallback, useEffect, useRef } from 'react';
import { Animated, Easing, PanResponder } from 'react-native';

const RESUME_MS = 2200;

type Options = {
  segmentWidth: number;
  speed?: number;
};

/**
 * Smooth native-driver marquee:
 * - Animated.translateX (UI thread, 60fps)
 * - Horizontal pan pauses auto-scroll
 * - Resumes after idle; taps pass through when movement is small
 */
export function useAnimatedMarquee({ segmentWidth, speed = 36 }: Options) {
  const translateX = useRef(new Animated.Value(0)).current;
  const animRef = useRef<Animated.CompositeAnimation | null>(null);
  const autoRef = useRef(true);
  const draggingRef = useRef(false);
  const resumeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearResume = () => {
    if (resumeTimer.current) {
      clearTimeout(resumeTimer.current);
      resumeTimer.current = null;
    }
  };

  const stopAnim = useCallback(() => {
    animRef.current?.stop();
    animRef.current = null;
  }, []);

  const runLoop = useCallback(() => {
    if (segmentWidth <= 0 || draggingRef.current || !autoRef.current) return;

    translateX.stopAnimation((current) => {
      let pos = current;
      while (pos <= -segmentWidth) pos += segmentWidth;
      while (pos > 0) pos -= segmentWidth;
      translateX.setValue(pos);

      const distance = Math.abs(-segmentWidth - pos);
      const duration = Math.max(16, (distance / speed) * 1000);

      animRef.current = Animated.timing(translateX, {
        toValue: -segmentWidth,
        duration,
        easing: Easing.linear,
        useNativeDriver: true,
      });
      animRef.current.start(({ finished }) => {
        if (!finished || draggingRef.current || !autoRef.current) return;
        translateX.setValue(0);
        runLoop();
      });
    });
  }, [segmentWidth, speed, translateX]);

  const pause = useCallback(() => {
    autoRef.current = false;
    clearResume();
    stopAnim();
  }, [stopAnim]);

  const scheduleResume = useCallback(() => {
    clearResume();
    resumeTimer.current = setTimeout(() => {
      autoRef.current = true;
      if (!draggingRef.current) runLoop();
    }, RESUME_MS);
  }, [runLoop]);

  useEffect(() => {
    autoRef.current = true;
    translateX.setValue(0);
    runLoop();
    return () => {
      stopAnim();
      clearResume();
    };
  }, [runLoop, stopAnim, translateX]);

  const panHandlers = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_, g) =>
        Math.abs(g.dx) > 8 && Math.abs(g.dx) > Math.abs(g.dy) * 1.4,
      onPanResponderGrant: () => {
        draggingRef.current = true;
        autoRef.current = false;
        clearResume();
        stopAnim();
        translateX.stopAnimation((v) => {
          translateX.setOffset(v);
          translateX.setValue(0);
        });
      },
      onPanResponderMove: (_, g) => {
        translateX.setValue(g.dx);
      },
      onPanResponderRelease: () => {
        translateX.flattenOffset();
        draggingRef.current = false;
        scheduleResume();
      },
      onPanResponderTerminate: () => {
        translateX.flattenOffset();
        draggingRef.current = false;
        scheduleResume();
      },
    }),
  ).current;

  return { translateX, panHandlers };
}
