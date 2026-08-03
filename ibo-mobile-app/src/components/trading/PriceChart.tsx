/**
 * Trading candlestick chart — OHLC from live klines API.
 * Pinch to zoom time range, drag horizontally to pan the window (recent candles stay reachable).
 */
import React, { useEffect, useMemo, useState, useRef, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Dimensions,
} from 'react-native';
import Svg, { Line, Rect, Text as SvgText, Circle } from 'react-native-svg';
import { GestureDetector, Gesture } from 'react-native-gesture-handler';
import { scaleLinear } from 'd3-scale';
import { marketApi } from '../../api/market.api';
import { Kline } from '../../types/market.types';
import { Colors, FontFamily, FontSize, Spacing, Radius } from '../../theme';
import {
  readKlinesCache,
  writeKlinesCache,
  klinesCacheAgeMs,
  KLINES_SOFT_TTL_MS,
} from '../../utils/klinesCache';

interface Props {
  /** Spot symbol for klines, e.g. BTCUSDT or BTCUSDT-PERP (PERP suffix stripped) */
  symbol: string;
  height?: number;
  /** Live ticker price — updates last candle for synthetic/IBO pairs */
  livePrice?: number;
  /** Optional pre-loaded klines; chart still refetches on interval change */
  klines?: Kline[];
  /** When true, klines come only from `klines` prop (IBO mock feed); interval changes call `onIntervalChange`. */
  klinesFromParent?: boolean;
  onIntervalChange?: (interval: Interval) => void;
  /** Initial / reset interval (e.g. 15m for live pulse) */
  defaultInterval?: Interval;
}

type Interval = '15m' | '1h' | '4h' | '1d' | '1w';
const INTERVALS: Interval[] = ['15m', '1h', '4h', '1d', '1w'];
const LIMIT_MAP: Record<Interval, number> = { '15m': 80, '1h': 80, '4h': 72, '1d': 60, '1w': 52 };

const PAD = { top: 12, right: 8, bottom: 28, left: 58 };
const VOL_H_RATIO = 0.18;
const MIN_VISIBLE = 8;

function spotSymbol(sym: string): string {
  return sym.replace(/-PERP$/i, '').replace(/-OPTIONS$/i, '');
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

/**
 * Y-axis domain for visible candles. Caps per-candle range vs median so one
 * violent bar (e.g. live tick on the forming candle) does not blow up the scale
 * or draw wicks outside the plot when combined with clamped rendering.
 */
function priceDomain(
  lows: number[],
  highs: number[],
  opens: number[],
  closes: number[],
): { minP: number; maxP: number } {
  const n = lows.length;
  if (n < 1) return { minP: 0, maxP: 1 };

  const ranges = lows
    .map((l, i) => highs[i] - l)
    .filter((r) => Number.isFinite(r) && r > 0)
    .sort((a, b) => a - b);
  const medRange = ranges.length
    ? ranges[Math.floor(ranges.length / 2)]
    : 0;
  const maxRange = medRange > 0 ? medRange * 5 : Infinity;

  const adjLows: number[] = [];
  const adjHighs: number[] = [];
  for (let i = 0; i < n; i += 1) {
    const l = lows[i];
    const h = highs[i];
    const mid = (opens[i] + closes[i]) / 2;
    if (medRange > 0 && h - l > maxRange) {
      const half = maxRange / 2;
      adjLows.push(Math.max(l, mid - half));
      adjHighs.push(Math.min(h, mid + half));
    } else {
      adjLows.push(l);
      adjHighs.push(h);
    }
  }

  let minP = Math.min(...adjLows);
  let maxP = Math.max(...adjHighs);
  if (!Number.isFinite(minP) || !Number.isFinite(maxP) || minP <= 0) {
    minP = Math.min(...lows.filter((v) => v > 0));
    maxP = Math.max(...highs);
  }
  const span = Math.max(maxP - minP, maxP * 0.0001);
  const pad = Math.max(span * 0.06, maxP * 0.001);
  return { minP: minP - pad, maxP: maxP + pad };
}

/** Map price → pixel Y inside the price pane (never outside minP/maxP). */
function priceToY(
  price: number,
  yScale: (v: number) => number,
  minP: number,
  maxP: number,
  topPad: number,
): number {
  const p = clamp(price, minP, maxP);
  return topPad + yScale(p);
}

function livePriceFitsCandles(lp: number, prev: Kline[]): boolean {
  if (!prev.length || !Number.isFinite(lp) || lp <= 0) return false;
  const lastClose = Number(prev[prev.length - 1].close);
  if (!Number.isFinite(lastClose) || lastClose <= 0) return true;
  const ratio = lp / lastClose;
  return ratio >= 0.15 && ratio <= 6;
}

function formatHoverDatetime(k: Kline, iv: Interval): string {
  const t = Number(k.time);
  const ms = t > 1e12 ? t : t * 1000;
  const d = new Date(ms);
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  if (iv === '1d' || iv === '1w') return `${d.getFullYear()}-${mo}-${day}`;
  return `${mo}/${day} ${hm}`;
}

export default function PriceChart({
  symbol, height = 240, livePrice, klines: klinesProp, klinesFromParent = false, onIntervalChange,
  defaultInterval = '1h',
}: Props) {
  const [interval, setChartInterval] = useState<Interval>(defaultInterval);
  const [klines, setKlines] = useState<Kline[]>(klinesProp ?? []);
  const [loading, setLoading] = useState(false);

  /** First visible candle index in full `data` */
  const [viewStart, setViewStart] = useState(0);
  /** How many candles are shown (zoom level); clamped against live `data.length` */
  const [viewCount, setViewCount] = useState(LIMIT_MAP['1h']);
  /** Global candle index under crosshair, or null */
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  /** Price at crosshair Y (from finger); null → use candle close for horizontal line */
  const [probePrice, setProbePrice] = useState<number | null>(null);
  /** Crosshair stays visible after lift finger until user taps the chart again */
  const [inspectLocked, setInspectLocked] = useState(false);

  const chartW = Dimensions.get('window').width - 32;
  const chartH = height;
  const innerW = chartW - PAD.left - PAD.right;
  const priceH = (chartH - PAD.top - PAD.bottom) * (1 - VOL_H_RATIO);
  const volH   = (chartH - PAD.top - PAD.bottom) * VOL_H_RATIO;
  const volTop = PAD.top + priceH + 4;

  const dataLenRef = useRef(0);
  const viewRef = useRef({ start: 0, count: LIMIT_MAP['1h'] });
  const panTransRef = useRef(0);
  const panScrolledRef = useRef(false);
  const pinchBaseRef = useRef({ visible: 1, start: 0, focalFrac: 0.5 });
  /** Parent-fed klines (IBO mock): only reset zoom on symbol/interval/first load — not every WS tick. */
  const parentViewportKeyRef = useRef('');

  const applyDefaultViewport = useCallback((n: number, iv: Interval) => {
    if (n < 1) {
      setViewStart(0);
      setViewCount(LIMIT_MAP[iv]);
      return;
    }
    const windowSize = Math.min(n, Math.max(MIN_VISIBLE + 2, Math.ceil(n * 0.52)));
    setViewCount(windowSize);
    setViewStart(Math.max(0, n - windowSize));
  }, []);

  useEffect(() => {
    setChartInterval(defaultInterval);
    setKlines([]);
    setHoverIdx(null);
    setProbePrice(null);
    setInspectLocked(false);
    setLoading(!klinesFromParent);
  }, [symbol, klinesFromParent, defaultInterval]);

  useEffect(() => {
    if (!klinesFromParent || !klinesProp) return;
    setKlines(klinesProp);
    const viewportKey = `${symbol}|${interval}`;
    const firstLoad = parentViewportKeyRef.current === '';
    const pairChanged = parentViewportKeyRef.current !== viewportKey;
    if (firstLoad || pairChanged) {
      applyDefaultViewport(klinesProp.length, interval);
      parentViewportKeyRef.current = viewportKey;
    }
    setLoading(false);
  }, [klinesFromParent, klinesProp, interval, symbol, applyDefaultViewport]);

  useEffect(() => {
    if (!klinesFromParent) {
      parentViewportKeyRef.current = '';
      return;
    }
    // New pair/interval → next parent klines batch may reset zoom once.
    parentViewportKeyRef.current = '';
  }, [klinesFromParent, symbol, interval]);

  const fetchKlines = useCallback(async (iv: Interval) => {
    if (klinesFromParent) {
      onIntervalChange?.(iv);
      return;
    }
    const sym = spotSymbol(symbol);
    const cacheKey = `${sym}|${iv}`;
    const cached = readKlinesCache(cacheKey);
    const age = klinesCacheAgeMs(cacheKey);
    const cacheFresh = cached?.length && age != null && age <= KLINES_SOFT_TTL_MS;

    if (cached?.length) {
      setKlines(cached);
      applyDefaultViewport(cached.length, iv);
    }

    if (!cached?.length) setLoading(true);

    if (cacheFresh) {
      setLoading(false);
      void (async () => {
        try {
          const { data } = await marketApi.getKlines(sym, { interval: iv, limit: LIMIT_MAP[iv] });
          const rows = Array.isArray(data) ? data : [];
          writeKlinesCache(cacheKey, rows);
          setKlines(rows);
          applyDefaultViewport(rows.length, iv);
        } catch { /* keep cached */ }
      })();
      return;
    }

    try {
      const { data } = await marketApi.getKlines(sym, { interval: iv, limit: LIMIT_MAP[iv] });
      const rows = Array.isArray(data) ? data : [];
      writeKlinesCache(cacheKey, rows);
      setKlines(rows);
      applyDefaultViewport(rows.length, iv);
      setHoverIdx(null);
      setProbePrice(null);
    } catch {
      if (!cached?.length) {
        setKlines([]);
        setViewStart(0);
        setViewCount(LIMIT_MAP[iv]);
        setHoverIdx(null);
        setProbePrice(null);
      }
    } finally {
      setLoading(false);
    }
  }, [symbol, applyDefaultViewport, klinesFromParent, onIntervalChange]);

  useEffect(() => {
    if (klinesFromParent) return;
    fetchKlines(interval).catch(() => {});
  }, [symbol, interval, fetchKlines, klinesFromParent]);

  const livePriceRef = useRef<number | undefined>(undefined);
  const candleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /** Nudge last candle toward live ticker — throttled so the chart does not flash every WS tick. */
  useEffect(() => {
    const lp = livePrice;
    if (!Number.isFinite(lp) || lp == null || lp <= 0) return;
    livePriceRef.current = lp;
    if (candleTimerRef.current) return;
    candleTimerRef.current = setTimeout(() => {
      candleTimerRef.current = null;
      const v = livePriceRef.current;
      if (v == null || !Number.isFinite(v) || v <= 0) return;
      setKlines((prev) => {
        if (!prev.length || !livePriceFitsCandles(v, prev)) return prev;
        const next = [...prev];
        const last = { ...next[next.length - 1] };
        const c = Number(last.close);
        const o = Number(last.open);
        const prevHigh = Number(last.high);
        const prevLow = Number(last.low);
        const tail = next.slice(-Math.min(24, next.length));
        const ranges = tail
          .map((k) => Number(k.high) - Number(k.low))
          .filter((r) => Number.isFinite(r) && r > 0)
          .sort((a, b) => a - b);
        const medRange = ranges.length
          ? ranges[Math.floor(ranges.length / 2)]
          : c * 0.008;
        const maxWick = Math.max(medRange * 4, c * 0.015, 1e-12);

        last.close = v;
        const rawHigh = Math.max(prevHigh, v, o);
        const rawLow = Math.min(prevLow, v, o);
        const mid = (o + v) / 2;
        last.high = Math.min(rawHigh, mid + maxWick);
        last.low = Math.max(rawLow, mid - maxWick);
        next[next.length - 1] = last;
        return next;
      });
    }, 450);
    return () => {
      if (candleTimerRef.current) clearTimeout(candleTimerRef.current);
    };
  }, [livePrice, symbol]);

  const data = useMemo(() => (klines?.length ? klines.slice(-LIMIT_MAP[interval]) : []), [klines, interval]);

  dataLenRef.current = data.length;
  viewRef.current = { start: viewStart, count: viewCount };

  /** If dataset length changes without a fetch reset, keep viewport in range */
  useEffect(() => {
    const n = data.length;
    if (n < 1) return;
    setViewCount(c => {
      const c2 = clamp(c, Math.min(MIN_VISIBLE, n), n);
      setViewStart(s => clamp(s, 0, Math.max(0, n - c2)));
      return c2;
    });
  }, [data.length]);

  const visibleSlice = useMemo(() => {
    const n = data.length;
    if (n < 1) return [];
    const c = clamp(viewCount, Math.min(MIN_VISIBLE, n), n);
    const s = clamp(viewStart, 0, Math.max(0, n - c));
    return data.slice(s, s + c);
  }, [data, viewStart, viewCount]);

  const chart = useMemo(() => {
    if (visibleSlice.length < 1) return null;

    const highs  = visibleSlice.map(k => Number(k.high));
    const lows   = visibleSlice.map(k => Number(k.low));
    const opens  = visibleSlice.map(k => Number(k.open));
    const closes = visibleSlice.map(k => Number(k.close));
    const vols   = visibleSlice.map(k => Number(k.volume ?? 0));
    const { minP, maxP } = priceDomain(lows, highs, opens, closes);
    const maxVol = Math.max(...vols, 1);

    const xScale = scaleLinear().domain([0, visibleSlice.length - 1]).range([0, innerW]);
    const yScale = scaleLinear().domain([minP, maxP]).range([priceH, 0]);
    const vScale = scaleLinear().domain([0, maxVol]).range([0, volH - 6]);

    const slotW  = innerW / visibleSlice.length;
    const bodyW  = Math.max(2, slotW * 0.62);

    const yTicks = Array.from({ length: 4 }, (_, i) => minP + ((maxP - minP) / 3) * i);
    const xStep  = Math.max(1, Math.floor(visibleSlice.length / 4));
    const xTicks = Array.from({ length: 4 }, (_, i) => Math.min(i * xStep, visibleSlice.length - 1));

    const first = Number(visibleSlice[0].open ?? visibleSlice[0].close);
    const last  = Number(visibleSlice[visibleSlice.length - 1].close);
    const isUp  = last >= first;

    return { xScale, yScale, vScale, bodyW, slotW, yTicks, xTicks, isUp, first, last, minP, maxP };
  }, [visibleSlice, innerW, priceH, volH]);

  const chartRef = useRef<NonNullable<typeof chart> | null>(null);
  chartRef.current = chart;

  const formatAxisPrice = (v: number) => {
    if (v >= 10000) return `${(v / 1000).toFixed(1)}k`;
    if (v >= 1) return v.toFixed(2);
    return v.toFixed(5);
  };

  const formatTime = (idx: number): string => {
    const k = visibleSlice[idx];
    if (!k) return '';
    const d = new Date((k.time > 1e12 ? k.time : k.time * 1000));
    if (interval === '1d' || interval === '1w') return `${d.getMonth() + 1}/${d.getDate()}`;
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  };

  const rawChangePct = chart && chart.first > 0
    ? ((chart.last - chart.first) / chart.first) * 100
    : 0;
  const changePct = Number.isFinite(rawChangePct)
    ? Math.max(-99.99, Math.min(99.99, rawChangePct))
    : 0;

  const composedGesture = useMemo(() => {
    const hoverFromX = (touchX: number): number | null => {
      const n = dataLenRef.current;
      if (n < 1) return null;
      const frac = (touchX - PAD.left) / innerW;
      if (frac < 0 || frac > 1) return null;
      const { start: s0, count: c0 } = viewRef.current;
      const c = clamp(c0, Math.min(MIN_VISIBLE, n), n);
      const s = clamp(s0, 0, Math.max(0, n - c));
      const span = Math.max(1, c - 1);
      const local = frac * span;
      return clamp(Math.round(s + local), s, s + c - 1);
    };

    const applyInspect = (x: number, y: number) => {
      const hi = hoverFromX(x);
      if (hi == null) {
        setHoverIdx(null);
        setProbePrice(null);
        return;
      }
      setHoverIdx(hi);
      const ch = chartRef.current;
      if (!ch) {
        setProbePrice(null);
        return;
      }
      const relY = y - PAD.top;
      if (relY >= 0 && relY <= priceH) {
        setProbePrice(ch.yScale.invert(relY));
      } else {
        setProbePrice(null);
      }
    };

    const clearInspect = () => {
      setHoverIdx(null);
      setProbePrice(null);
      setInspectLocked(false);
    };

    const pinch = Gesture.Pinch()
      .onStart((e) => {
        const n = dataLenRef.current;
        if (n < MIN_VISIBLE) return;
        const focalX = e.focalX;
        const focalFrac = clamp((focalX - PAD.left) / innerW, 0, 1);
        const { start: s0, count: c0 } = viewRef.current;
        const c = clamp(c0, Math.min(MIN_VISIBLE, n), n);
        const s = clamp(s0, 0, Math.max(0, n - c));
        pinchBaseRef.current = { visible: c, start: s, focalFrac };
        clearInspect();
      })
      .onUpdate((e) => {
        const n = dataLenRef.current;
        if (n < MIN_VISIBLE) return;
        const { visible: baseV, start: baseS, focalFrac } = pinchBaseRef.current;
        const scale = Math.max(e.scale, 0.001);
        // Ignore micro-scale noise so a horizontal pan does not zoom out.
        if (Math.abs(scale - 1) < 0.045) return;
        let nextV = Math.round(baseV / scale);
        nextV = clamp(nextV, Math.min(MIN_VISIBLE, n), n);
        const anchorIdx = baseS + focalFrac * Math.max(1, baseV - 1);
        let nextS = Math.round(anchorIdx - focalFrac * Math.max(1, nextV - 1));
        nextS = clamp(nextS, 0, Math.max(0, n - nextV));
        setViewCount(nextV);
        setViewStart(nextS);
      });

    const tap = Gesture.Tap().onEnd(e => {
      if (inspectLocked) {
        clearInspect();
        return;
      }
      applyInspect(e.x, e.y);
      setInspectLocked(true);
    });

    const pan = Gesture.Pan()
      .maxPointers(1)
      .minPointers(1)
      .activeOffsetX([-12, 12])
      .failOffsetY([-24, 24])
      .onStart((e) => {
        panTransRef.current = e.translationX;
        panScrolledRef.current = false;
        if (!inspectLocked) applyInspect(e.x, e.y);
      })
      .onUpdate((e) => {
        if (!inspectLocked) applyInspect(e.x, e.y);

        const n = dataLenRef.current;
        if (n < 1) return;
        const c = clamp(viewRef.current.count, Math.min(MIN_VISIBLE, n), n);

        const dTx = e.translationX - panTransRef.current;
        panTransRef.current = e.translationX;
        if (Math.abs(e.translationX) > 10) panScrolledRef.current = true;
        const pxPerCandle = innerW / Math.max(c, 1);
        const dCandles = dTx / pxPerCandle;
        setViewStart(prev => {
          const maxS = Math.max(0, n - c);
          return clamp(Math.round(prev - dCandles), 0, maxS);
        });
      })
      .onEnd(() => {
        if (panScrolledRef.current) {
          clearInspect();
        } else if (hoverIdx != null) {
          setInspectLocked(true);
        }
      });

    // Pinch vs pan: exclusive so one-finger horizontal drag pans; two-finger pinch zooms.
    return Gesture.Simultaneous(tap, Gesture.Exclusive(pinch, pan));
  }, [innerW, priceH, inspectLocked, hoverIdx]);

  const hoverKline = hoverIdx != null && data[hoverIdx] ? data[hoverIdx] : null;
  const hoverLocal = hoverIdx != null && chart && visibleSlice.length
    ? hoverIdx - clamp(viewStart, 0, Math.max(0, data.length - visibleSlice.length))
    : -1;

  const showChart = chart != null && visibleSlice.length >= 1;

  return (
    <View style={styles.container}>
      <View style={styles.intervalRow}>
        <View style={styles.intervalBtns}>
          {INTERVALS.map(iv => (
            <TouchableOpacity
              key={iv}
              style={[styles.ivBtn, interval === iv && styles.ivBtnActive]}
              onPress={() => setChartInterval(iv)}
            >
              <Text style={[styles.ivText, interval === iv && styles.ivTextActive]}>{iv}</Text>
            </TouchableOpacity>
          ))}
        </View>
        {chart && (
          <Text
            style={[styles.changePct, { color: chart.isUp ? Colors.buyGreen : Colors.sellRed }]}
            numberOfLines={1}
          >
            {chart.isUp ? '▲' : '▼'} {Math.abs(changePct).toFixed(2)}%
          </Text>
        )}
      </View>

      {showChart && (
        <Text style={styles.zoomHint}>
          Hold for OHLC · tap again to dismiss · pinch to zoom · drag to pan
        </Text>
      )}

      {!showChart ? (
        loading ? (
          <View style={styles.loadingRow}>
            <Text style={styles.loadingRowText}>Loading candles…</Text>
          </View>
        ) : (
          <View style={styles.placeholderEmpty}>
            <Text style={styles.placeholderText}>No chart data</Text>
          </View>
        )
      ) : (
        <View style={[styles.chartWrap, { width: chartW, height: chartH }]}>
          <GestureDetector gesture={composedGesture}>
            <View style={{ width: chartW, height: chartH }}>
              <Svg width={chartW} height={chartH}>
              {/* Price grid */}
              {chart.yTicks.map((tick, i) => {
                const y = chart.yScale(tick) + PAD.top;
                return (
                  <React.Fragment key={`yg-${i}`}>
                    <Line
                      x1={PAD.left} y1={y}
                      x2={PAD.left + innerW} y2={y}
                      stroke={Colors.surfaceBorder} strokeWidth={0.5} strokeDasharray="3,4"
                    />
                    <SvgText x={PAD.left - 4} y={y + 3} fontSize={8} fill={Colors.textMuted} textAnchor="end">
                      {formatAxisPrice(tick)}
                    </SvgText>
                  </React.Fragment>
                );
              })}

              {/* Candles + volume */}
              {visibleSlice.map((k, i) => {
                const o = Number(k.open);
                const c = Number(k.close);
                const h = Number(k.high);
                const l = Number(k.low);
                const vol = Number(k.volume ?? 0);
                const bull = c >= o;
                const color = bull ? Colors.buyGreen : Colors.sellRed;

                const cx = PAD.left + chart.xScale(i) + chart.slotW / 2;
                const bodyTop = priceToY(Math.max(o, c), chart.yScale, chart.minP, chart.maxP, PAD.top);
                const bodyBot = priceToY(Math.min(o, c), chart.yScale, chart.minP, chart.maxP, PAD.top);
                const bodyH   = Math.max(1, bodyBot - bodyTop);
                const wickTop = priceToY(h, chart.yScale, chart.minP, chart.maxP, PAD.top);
                const wickBot = priceToY(l, chart.yScale, chart.minP, chart.maxP, PAD.top);
                const volBarH = chart.vScale(vol);
                const volY    = volTop + (volH - 6) - volBarH;

                return (
                  <React.Fragment key={i}>
                    <Line x1={cx} y1={wickTop} x2={cx} y2={wickBot} stroke={color} strokeWidth={1} opacity={0.85} />
                    <Rect
                      x={cx - chart.bodyW / 2}
                      y={bodyTop}
                      width={chart.bodyW}
                      height={bodyH}
                      fill={bull ? color : Colors.transparent}
                      stroke={color}
                      strokeWidth={1}
                    />
                    <Rect
                      x={cx - chart.bodyW / 2}
                      y={volY}
                      width={chart.bodyW}
                      height={volBarH}
                      fill={color}
                      opacity={0.35}
                    />
                  </React.Fragment>
                );
              })}

              {/* Crosshair + inspect pointer */}
              {hoverKline && chart && hoverLocal >= 0 && hoverLocal < visibleSlice.length && (
                <>
                  {(() => {
                    const cx = PAD.left + chart.xScale(hoverLocal) + chart.slotW / 2;
                    const close = Number(hoverKline.close);
                    const yPrice = clamp(
                      probePrice != null ? probePrice : close,
                      chart.minP,
                      chart.maxP,
                    );
                    const cy = priceToY(yPrice, chart.yScale, chart.minP, chart.maxP, PAD.top);
                    const label = formatAxisPrice(close);
                    const tooltipW = 84;
                    const preferRight = cx < PAD.left + innerW * 0.55;
                    const boxX = preferRight
                      ? Math.min(cx + 6, PAD.left + innerW - tooltipW - 2)
                      : Math.max(PAD.left + 4, cx - tooltipW - 6);
                    const hasProbe = probePrice != null;
                    const boxH = hasProbe ? 86 : 76;
                    const dt = formatHoverDatetime(hoverKline, interval);
                    return (
                      <>
                        <Line
                          x1={cx} y1={PAD.top}
                          x2={cx} y2={volTop - 2}
                          stroke={Colors.goldLight}
                          strokeWidth={1}
                          opacity={0.9}
                          strokeDasharray="4,4"
                        />
                        <Line
                          x1={PAD.left} y1={cy}
                          x2={PAD.left + innerW} y2={cy}
                          stroke={Colors.goldLight}
                          strokeWidth={1}
                          opacity={0.55}
                          strokeDasharray="4,4"
                        />
                        <SvgText
                          x={PAD.left - 4}
                          y={cy + 3}
                          fontSize={7}
                          fill={Colors.goldLight}
                          textAnchor="end"
                        >
                          {formatAxisPrice(yPrice)}
                        </SvgText>
                        <Circle
                          cx={cx}
                          cy={cy}
                          r={5}
                          fill={Colors.surfaceCard}
                          stroke={Colors.goldLight}
                          strokeWidth={2}
                        />
                        <Rect
                          x={boxX}
                          y={PAD.top + 4}
                          width={tooltipW}
                          height={boxH}
                          rx={4}
                          fill={Colors.surfaceCard}
                          stroke={Colors.goldAlpha30}
                          strokeWidth={1}
                          opacity={0.96}
                        />
                        <SvgText x={boxX + 6} y={PAD.top + 14} fontSize={7} fill={Colors.textMuted}>
                          {dt}
                        </SvgText>
                        <SvgText x={boxX + 6} y={PAD.top + 26} fontSize={8} fill={Colors.textMuted}>
                          O {formatAxisPrice(Number(hoverKline.open))}
                        </SvgText>
                        <SvgText x={boxX + 6} y={PAD.top + 38} fontSize={8} fill={Colors.buyGreen}>
                          H {formatAxisPrice(Number(hoverKline.high))}
                        </SvgText>
                        <SvgText x={boxX + 6} y={PAD.top + 50} fontSize={8} fill={Colors.sellRed}>
                          L {formatAxisPrice(Number(hoverKline.low))}
                        </SvgText>
                        <SvgText x={boxX + 6} y={PAD.top + 62} fontSize={8} fill={Colors.goldLight}>
                          C {label}
                        </SvgText>
                        {hasProbe && probePrice != null && (
                          <SvgText x={boxX + 6} y={PAD.top + 76} fontSize={7} fill={Colors.textSecondary}>
                            @ {formatAxisPrice(probePrice)}
                          </SvgText>
                        )}
                      </>
                    );
                  })()}
                </>
              )}

              {/* Volume separator */}
              <Line
                x1={PAD.left} y1={volTop - 2}
                x2={PAD.left + innerW} y2={volTop - 2}
                stroke={Colors.surfaceBorder} strokeWidth={0.5}
              />

              {/* X labels */}
              {chart.xTicks.map(idx => (
                <SvgText
                  key={`x-${idx}`}
                  x={PAD.left + chart.xScale(idx)}
                  y={chartH - 4}
                  fontSize={8}
                  fill={Colors.textMuted}
                  textAnchor="middle"
                >
                  {formatTime(idx)}
                </SvgText>
              ))}
            </Svg>
            </View>
          </GestureDetector>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: Colors.surfaceCard,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    borderRadius: Radius.lg,
    overflow: 'hidden',
  },
  intervalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing[3],
    paddingVertical: Spacing[2],
    borderBottomWidth: 1,
    borderBottomColor: Colors.surfaceBorder,
    gap: Spacing[2],
  },
  intervalBtns: {
    flex: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    minWidth: 0,
  },
  zoomHint: {
    fontFamily: FontFamily.regular,
    fontSize: FontSize.xs,
    color: Colors.textMuted,
    paddingHorizontal: Spacing[3],
    paddingBottom: Spacing[1],
  },
  chartWrap: {
    position: 'relative',
    alignSelf: 'center',
  },
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingVertical: Spacing[3],
    paddingHorizontal: Spacing[3],
  },
  loadingRowText: {
    fontFamily: FontFamily.regular,
    fontSize: FontSize.sm,
    color: Colors.textMuted,
  },
  ivBtn: {
    paddingHorizontal: Spacing[2],
    paddingVertical: 4,
    borderRadius: Radius.sm,
    marginRight: 4,
  },
  ivBtnActive: {
    backgroundColor: Colors.goldAlpha15,
    borderWidth: 1,
    borderColor: Colors.goldAlpha30,
  },
  ivText: { fontFamily: FontFamily.medium, fontSize: FontSize.xs, color: Colors.textMuted },
  ivTextActive: { color: Colors.goldLight },
  changePct: {
    fontFamily: FontFamily.medium,
    fontSize: FontSize.xs,
    flexShrink: 0,
    maxWidth: 88,
    textAlign: 'right',
  },
  placeholder: { alignItems: 'center', justifyContent: 'center' },
  placeholderEmpty: { alignItems: 'center', justifyContent: 'center', minHeight: 96 },
  placeholderText: {
    fontFamily: FontFamily.regular,
    fontSize: FontSize.sm,
    color: Colors.textMuted,
    marginTop: Spacing[2],
  },
});
