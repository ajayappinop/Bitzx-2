import { useMemo } from 'react';
import { useWindowDimensions } from 'react-native';
import {
  DATA_PANEL_MAX_HEIGHT,
  DATA_PANEL_MIN_HEIGHT,
  TERMINAL_HEIGHT_RATIO,
} from '../theme/tradeTerminal';

/** Reference-style split: fixed-height terminal on top, scrollable positions below. */
export function useTradeLayoutHeights(heightRatio = TERMINAL_HEIGHT_RATIO) {
  const { height: windowH } = useWindowDimensions();

  return useMemo(() => {
    const terminalHeight = Math.round(windowH * heightRatio);
    const dataPanelMinHeight = Math.max(
      DATA_PANEL_MIN_HEIGHT,
      windowH - terminalHeight - 120,
    );
    const dataPanelMaxHeight = Math.min(
      DATA_PANEL_MAX_HEIGHT,
      dataPanelMinHeight,
    );
    return { terminalHeight, dataPanelMaxHeight, windowH };
  }, [windowH, heightRatio]);
}
