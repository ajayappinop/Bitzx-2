/**
 * Exchange order book — WebView renderer (same pattern as TradingViewChart).
 * Book updates happen inside the WebView DOM — no React row re-renders on every tick.
 */
import React, {
  useCallback, useEffect, useMemo, useRef, useState,
} from 'react';
import { View, StyleSheet, type ViewStyle } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import type { OrderBook as OrderBookType } from '@/types/market.types';
import { Colors } from '@/theme';
import { buildOrderBookTerminalHtml } from './orderBookTerminalHtml';
import { BOOK_WEBVIEW_LAYER, TERMINAL_WEBVIEW_PROPS } from './terminalWebViewProps';

const BOOK_HTML = buildOrderBookTerminalHtml();

type Variant = 'default' | 'terminal' | 'compact';

type Props = {
  orderBook: OrderBookType;
  currentPrice?: number | string;
  maxRows?: number;
  compact?: boolean;
  variant?: Variant;
  priceUp?: boolean;
  onPriceClick?: (price: string) => void;
  hideDepthFooter?: boolean;
  loading?: boolean;
  longColor?: string;
  longDim?: string;
  fairPrice?: number | string | null;
  style?: ViewStyle;
};

function postToWebView(
  ref: React.RefObject<WebView | null>,
  payload: Record<string, unknown>,
) {
  ref.current?.postMessage(JSON.stringify(payload));
}

export default function TerminalOrderBookWebView({
  orderBook,
  currentPrice,
  maxRows = 10,
  compact = false,
  variant = 'terminal',
  priceUp = true,
  onPriceClick,
  hideDepthFooter = false,
  loading = false,
  longColor = Colors.buyGreen,
  longDim = Colors.buyGreenDim,
  fairPrice = null,
  style,
}: Props) {
  const webRef = useRef<WebView>(null);
  const [ready, setReady] = useState(false);
  const onPriceClickRef = useRef(onPriceClick);
  onPriceClickRef.current = onPriceClick;

  const hasRows = (orderBook.asks?.length ?? 0) + (orderBook.bids?.length ?? 0) > 0;
  const showLoading = loading && !hasRows;

  const resolvedVariant: Variant = compact ? 'compact' : variant;

  const themeKey = useMemo(
    () => `${longColor}|${longDim}|${resolvedVariant}|${maxRows}|${hideDepthFooter}`,
    [longColor, longDim, resolvedVariant, maxRows, hideDepthFooter],
  );

  const pushBook = useCallback(() => {
    if (!ready) return;
    postToWebView(webRef, {
      type: 'SET_BOOK',
      asks: orderBook.asks ?? [],
      bids: orderBook.bids ?? [],
      currentPrice,
      maxRows,
      compact,
      variant: resolvedVariant,
      priceUp,
      hideDepthFooter,
      fairPrice,
      loading: showLoading,
      longColor,
      longDim,
    });
  }, [
    ready, orderBook.asks, orderBook.bids, currentPrice, maxRows, compact,
    resolvedVariant, priceUp, hideDepthFooter, fairPrice, showLoading,
    longColor, longDim,
  ]);

  // Feed layer coalesces WS ticks (50ms); push directly so RAF cleanup cannot drop updates.
  useEffect(() => {
    if (!ready) return;
    pushBook();
  }, [ready, orderBook, currentPrice, showLoading, themeKey, pushBook]);

  useEffect(() => {
    if (!ready) return;
    pushBook();
  }, [ready, themeKey, maxRows, resolvedVariant, pushBook]);

  const onMessage = useCallback((e: WebViewMessageEvent) => {
    try {
      const msg = JSON.parse(e.nativeEvent.data);
      if (msg?.type === 'READY') {
        setReady(true);
        return;
      }
      if (msg?.type === 'PRICE_CLICK' && msg.price) {
        onPriceClickRef.current?.(String(msg.price));
      }
    } catch { /* ignore */ }
  }, []);

  return (
    <View style={[styles.wrap, style]}>
      <WebView
        ref={webRef}
        source={{ html: BOOK_HTML }}
        style={styles.webview}
        {...(TERMINAL_WEBVIEW_PROPS as object)}
        androidLayerType={BOOK_WEBVIEW_LAYER as 'none'}
        onMessage={onMessage}
        onError={() => setReady(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    minHeight: 0,
    overflow: 'hidden',
    backgroundColor: Colors.surface,
  },
  webview: {
    flex: 1,
    backgroundColor: 'transparent',
  },
});
