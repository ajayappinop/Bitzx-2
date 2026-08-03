import { InteractionManager } from 'react-native';

/** Defer heavy work until after navigation / layout animations complete. */
export function runAfterUIReady(fn: () => void): { cancel: () => void } {
  return InteractionManager.runAfterInteractions(() => {
    requestAnimationFrame(fn);
  });
}
