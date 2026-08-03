/**
 * Disables parent RefreshControl while a child horizontal gesture is active
 * (carousel, slider, etc.) so diagonal drags don't pull the loader down.
 */
import { useCallback, useState } from 'react';

export function usePullRefreshLock() {
  const [locked, setLocked] = useState(false);

  const onGestureActiveChange = useCallback((active: boolean) => {
    setLocked(active);
  }, []);

  return {
    refreshEnabled: !locked,
    onGestureActiveChange,
  };
}
