/**
 * TradingViewChart — TradingView Lightweight Charts rendered in a WebView.
 * Ported from MaxByte with Ibo-specific imports.
 *
 * Communicates via postMessage:
 *   SET_DATA     → full candle + volume + indicator load
 *   UPDATE_CANDLE → single bar tick update
 *   UPDATE_PRICE  → live price tracer line
 *   SET_MODE      → preview (locked) vs fullscreen (interactive)
 *   SET_INDICATORS → overlay/pane indicator update
 */
import React, {
  useCallback, useEffect, useMemo, useRef, useState,
} from 'react';
import { View, StyleSheet, type ViewStyle } from 'react-native';
import { useIsFocused } from '@react-navigation/native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import type { Kline } from '../../types/market.types';
import { Colors } from '../../theme';
import { buildTradingViewChartHtml } from './tradingViewChartHtml';
import { chartWebViewBaseUrl } from './chartLibraryAsset';
import { buildIndicatorPayload, buildCrosshairReadouts, buildIndicatorReadouts, resolveKlineBarIndex } from './chartIndicators';
import ChartIndicatorLegend from './ChartIndicatorLegend';
import { CHART_WEBVIEW_LAYER, TERMINAL_WEBVIEW_PROPS } from './terminalWebViewProps';

export type ChartDisplayMode = 'preview' | 'fullscreen';

export const CHART_INTERACTIVE_MODE: ChartDisplayMode = 'fullscreen';

type Props = {
  klines: Kline[];
  livePrice?: number;
  height: number;
  width: number;
  mode?: ChartDisplayMode;
  indicators?: string[];
  /** Reserve bottom space for time-axis labels on mini charts. */
  compact?: boolean;
  style?: ViewStyle;
  keepAliveWhenHidden?: boolean;
};

let cachedChartHtml: string | null = null;
const CHART_HTML_VER = 7;
let cachedChartVer = 0;
function getChartHtml(): string {
  if (!cachedChartHtml || cachedChartVer !== CHART_HTML_VER) {
    cachedChartHtml = buildTradingViewChartHtml();
    cachedChartVer = CHART_HTML_VER;
  }
  return cachedChartHtml;
}

function postToWebView(ref: React.RefObject<WebView | null>, payload: Record<string, unknown>) {
  ref.current?.postMessage(JSON.stringify(payload));
}

function klinesPushMode(prev: Kline[], next: Kline[]): 'full' | 'candle' {
  if (!prev.length || !next.length) return 'full';
  if (prev.length !== next.length) return 'full';
  if (prev[0]?.time !== next[0]?.time) return 'full';
  const pl = prev[prev.length - 1];
  const nl = next[next.length - 1];
  if (!pl || !nl) return 'full';
  return pl.time === nl.time ? 'candle' : 'full';
}

export default function TradingViewChart({
  klines,
  livePrice,
  height,
  width,
  mode = CHART_INTERACTIVE_MODE,
  indicators = [],
  compact = false,
  style,
  keepAliveWhenHidden = false,
}: Props) {
  const webRef = useRef<WebView | null>(null);
  const screenFocused = useIsFocused();
  const [ready, setReady] = useState(false);
  const [webMounted, setWebMounted] = useState(true);
  const [crosshairTime, setCrosshairTime] = useState<number | null | undefined>(undefined);
  const wasFocusedRef = useRef(screenFocused);

  const updatesActive = screenFocused || keepAliveWhenHidden;

  useEffect(() => {
    if (!screenFocused && !keepAliveWhenHidden) {
      setWebMounted(false);
      setReady(false);
      return undefined;
    }
    setWebMounted(true);
    if (!keepAliveWhenHidden) {
      return () => { setWebMounted(false); setReady(false); };
    }
    return undefined;
  }, [screenFocused, keepAliveWhenHidden]);

  const prevKlinesRef        = useRef<Kline[]>([]);
  const indicatorsKey        = useMemo(() => [...indicators].sort().join(','), [indicators]);
  const klinesSig            = useMemo(
    () => (klines.length ? `${klines.length}:${klines[0]?.time}:${klines[klines.length - 1]?.time}` : '0'),
    [klines],
  );
  const indicatorPayload     = useMemo(() => buildIndicatorPayload(klines, indicators), [klines, indicatorsKey, klinesSig]);
  const crosshairBarIndex    = useMemo(
    () => resolveKlineBarIndex(klines, crosshairTime),
    [klines, crosshairTime, klinesSig],
  );
  const isInspecting = crosshairTime != null && crosshairTime !== undefined;
  const indicatorReadouts    = useMemo(
    () => (isInspecting
      ? buildCrosshairReadouts(klines, indicators, crosshairBarIndex)
      : buildIndicatorReadouts(klines, indicators, crosshairBarIndex)),
    [klines, indicators, indicatorsKey, klinesSig, crosshairBarIndex, isInspecting],
  );
  const lastPriceRef         = useRef<number | undefined>(undefined);
  const priceRafRef          = useRef<number | null>(null);
  const dataRafRef           = useRef<number | null>(null);
  const indicatorDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastIndicatorSigRef  = useRef('');

  const pushIndicators = useCallback((immediate = false) => {
    if (!ready) return;
    const sig = `${indicatorsKey}|${klinesSig}`;
    if (!immediate && sig === lastIndicatorSigRef.current) return;
    lastIndicatorSigRef.current = sig;
    postToWebView(webRef, { type: 'SET_INDICATORS', indicators: buildIndicatorPayload(klines, indicators) });
  }, [ready, indicatorsKey, klinesSig, klines, indicators]);

  const pushFullData = useCallback(() => {
    if (!ready) return;
    postToWebView(webRef, {
      type: 'SET_DATA', mode, klines, livePrice, indicators: indicatorPayload, compact,
    });
    prevKlinesRef.current = klines;
    lastIndicatorSigRef.current = `${indicatorsKey}|${klinesSig}`;
  }, [ready, mode, klines, livePrice, indicatorPayload, indicatorsKey, klinesSig, compact]);

  const pushCandleUpdate = useCallback(() => {
    if (!ready || !klines.length) return;
    const candle = klines[klines.length - 1];
    postToWebView(webRef, { type: 'UPDATE_CANDLE', kline: candle, livePrice });
    prevKlinesRef.current = klines;
  }, [ready, klines, livePrice]);

  useEffect(() => {
    if (!ready) return;
    postToWebView(webRef, { type: 'SET_MODE', mode });
  }, [ready, mode]);

  useEffect(() => {
    const wasFocused = wasFocusedRef.current;
    wasFocusedRef.current = screenFocused;
    if (!ready || !screenFocused || wasFocused) return;
    postToWebView(webRef, { type: 'SET_MODE', mode });
    pushFullData();
  }, [screenFocused, ready, mode, pushFullData]);

  useEffect(() => {
    if (!ready || !updatesActive) return;
    const pushMode = klinesPushMode(prevKlinesRef.current, klines);
    if (dataRafRef.current != null) cancelAnimationFrame(dataRafRef.current);
    dataRafRef.current = requestAnimationFrame(() => {
      dataRafRef.current = null;
      if (pushMode === 'candle') pushCandleUpdate(); else pushFullData();
    });
    return () => { if (dataRafRef.current != null) cancelAnimationFrame(dataRafRef.current); };
  }, [ready, updatesActive, klines, pushCandleUpdate, pushFullData]);

  useEffect(() => {
    if (!ready || !updatesActive) return;
    if (indicatorDebounceRef.current) clearTimeout(indicatorDebounceRef.current);
    const immediate = !lastIndicatorSigRef.current || !lastIndicatorSigRef.current.startsWith(indicatorsKey);
    if (immediate) { pushIndicators(true); return undefined; }
    indicatorDebounceRef.current = setTimeout(() => { indicatorDebounceRef.current = null; pushIndicators(false); }, 280);
    return () => { if (indicatorDebounceRef.current) clearTimeout(indicatorDebounceRef.current); };
  }, [ready, updatesActive, indicatorsKey, klinesSig, pushIndicators]);

  useEffect(() => {
    prevKlinesRef.current = [];
    lastIndicatorSigRef.current = '';
    setCrosshairTime(undefined);
    if (ready) postToWebView(webRef, { type: 'CLEAR_INSPECT' });
  }, [mode, indicatorsKey, klinesSig, ready]);

  useEffect(() => {
    if (!ready || !updatesActive || livePrice == null || !Number.isFinite(livePrice)) return;
    if (lastPriceRef.current === livePrice) return;
    if (priceRafRef.current != null) cancelAnimationFrame(priceRafRef.current);
    priceRafRef.current = requestAnimationFrame(() => {
      priceRafRef.current = null;
      lastPriceRef.current = livePrice;
      postToWebView(webRef, { type: 'UPDATE_PRICE', price: livePrice });
    });
    return () => { if (priceRafRef.current != null) cancelAnimationFrame(priceRafRef.current); };
  }, [ready, updatesActive, livePrice]);

  const onMessage = useCallback((e: WebViewMessageEvent) => {
    try {
      const msg = JSON.parse(e.nativeEvent.data);
      if (msg?.type === 'READY') setReady(true);
      if (msg?.type === 'CROSSHAIR') setCrosshairTime(msg.time ?? null);
    } catch { /* ignore */ }
  }, []);

  const webSource = useMemo(
    () => ({ html: getChartHtml(), baseUrl: chartWebViewBaseUrl() }),
    [],
  );

  return (
    <View style={[styles.wrap, { width, height }, style]} collapsable={false}>
      {(isInspecting || indicators.length > 0) && indicatorReadouts.length > 0 ? (
        <ChartIndicatorLegend groups={indicatorReadouts} inspecting={isInspecting} />
      ) : null}
      <View style={styles.chartBody}>
        {webMounted ? (
          <WebView
            ref={webRef}
            source={webSource}
            style={styles.webview}
            {...TERMINAL_WEBVIEW_PROPS}
            androidLayerType={CHART_WEBVIEW_LAYER as 'none'}
            onMessage={onMessage}
            onError={() => setReady(false)}
            onHttpError={() => setReady(false)}
          />
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    overflow: 'hidden',
    backgroundColor: Colors.surface,
  },
  chartBody: {
    flex: 1,
    minHeight: 0,
  },
  webview: {
    flex: 1,
    backgroundColor: 'transparent',
  },
});
