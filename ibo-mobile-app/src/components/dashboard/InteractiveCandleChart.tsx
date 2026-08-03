/**
 * Touch-interactive candlestick chart — horizontal pan + scrub bar.
 * Throttled updates keep scrubbing smooth; live klines from API.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState, memo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  PanResponder,
  LayoutChangeEvent,
} from 'react-native';
import Svg, { Line, Rect, Text as SvgText } from 'react-native-svg';
import { scaleLinear } from 'd3-scale';
import { marketApi } from '../../api/market.api';
import { Kline } from '../../types/market.types';
import { Colors, FontFamily, FontSize, Spacing, Radius } from '../../theme';
import { formatPrice, formatPercent } from '../../utils/formatters';
import { formatVolumeCompact } from '../../utils/markets';

type Interval = '15m' | '1h' | '4h' | '1d';
const INTERVALS: Interval[] = ['15m', '1h', '4h', '1d'];
const LIMIT_MAP: Record<Interval, number> = { '15m': 96, '1h': 72, '4h': 60, '1d': 45 };

const PAD = { top: 14, right: 12, bottom: 30, left: 54 };
const VOL_RATIO = 0.2;
const SLOT_MIN = 7;

function spotSymbol(sym: string): string {
  return sym.replace(/-PERP$/i, '').replace(/-OPTIONS$/i, '');
}

function formatAxisPrice(v: number): string {
  if (v >= 10000) return `${(v / 1000).toFixed(1)}k`;
  if (v >= 1) return v.toFixed(2);
  return v.toFixed(5);
}

function formatTime(ts: number, interval: Interval): string {
  const d = new Date(ts > 1e12 ? ts : ts * 1000);
  if (interval === '1d') return `${d.getMonth() + 1}/${d.getDate()}`;
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

type Props = {
  symbol: string;
  interval: Interval;
  height?: number;
};

const CandleSvg = memo(function CandleSvg({
  data,
  chart,
  innerW,
  priceH,
  volH,
  volTop,
  height,
  selectedIdx,
}: {
  data: Kline[];
  chart: NonNullable<ReturnType<typeof buildChart>>;
  innerW: number;
  priceH: number;
  volH: number;
  volTop: number;
  height: number;
  selectedIdx: number | null;
}) {
  const selCx = selectedIdx != null
    ? PAD.left + chart.xScale(selectedIdx) + chart.slotW / 2
    : null;

  return (
    <Svg width={chart.width} height={height}>
      {chart.yTicks.map((tick, i) => {
        const y = chart.yScale(tick) + PAD.top;
        return (
          <React.Fragment key={`yg-${i}`}>
            <Line
              x1={PAD.left} y1={y}
              x2={PAD.left + innerW} y2={y}
              stroke="rgba(255,255,255,0.07)"
              strokeWidth={0.5}
              strokeDasharray="3,4"
            />
            <SvgText x={PAD.left - 6} y={y + 3} fontSize={8} fill={Colors.textMuted} textAnchor="end">
              {formatAxisPrice(tick)}
            </SvgText>
          </React.Fragment>
        );
      })}

      {data.map((k, i) => {
        const o = Number(k.open);
        const c = Number(k.close);
        const h = Number(k.high);
        const l = Number(k.low);
        const vol = Number(k.volume ?? 0);
        const bull = c >= o;
        const color = bull ? Colors.buyGreen : Colors.sellRed;
        const active = i === selectedIdx;

        const cx = PAD.left + chart.xScale(i) + chart.slotW / 2;
        const bodyTop = PAD.top + chart.yScale(Math.max(o, c));
        const bodyBot = PAD.top + chart.yScale(Math.min(o, c));
        const bodyH   = Math.max(1, bodyBot - bodyTop);
        const wickTop = PAD.top + chart.yScale(h);
        const wickBot = PAD.top + chart.yScale(l);
        const volBarH = chart.vScale(vol);
        const volY    = volTop + (volH - 4) - volBarH;

        return (
          <React.Fragment key={i}>
            <Line
              x1={cx} y1={wickTop} x2={cx} y2={wickBot}
              stroke={color} strokeWidth={active ? 1.4 : 1} opacity={active ? 1 : 0.82}
            />
            <Rect
              x={cx - chart.bodyW / 2} y={bodyTop}
              width={chart.bodyW} height={bodyH}
              fill={bull ? color : 'transparent'}
              stroke={color} strokeWidth={active ? 1.4 : 1}
            />
            <Rect
              x={cx - chart.bodyW / 2} y={volY}
              width={chart.bodyW} height={volBarH}
              fill={color} opacity={active ? 0.5 : 0.28}
            />
          </React.Fragment>
        );
      })}

      {selCx != null && (
        <Line
          x1={selCx} y1={PAD.top}
          x2={selCx} y2={height - PAD.bottom}
          stroke={Colors.goldLight}
          strokeWidth={1}
          strokeDasharray="4,3"
          opacity={0.85}
        />
      )}

      {[0, Math.floor(data.length / 2), data.length - 1].map((idx) => (
        <SvgText
          key={`x-${idx}`}
          x={PAD.left + chart.xScale(idx)}
          y={height - 6}
          fontSize={8}
          fill={Colors.textMuted}
          textAnchor="middle"
        >
          {formatTime(Number(data[idx].time), chart.interval)}
        </SvgText>
      ))}
    </Svg>
  );
});

function buildChart(
  data: Kline[],
  innerW: number,
  priceH: number,
  volH: number,
  slotW: number,
  width: number,
  interval: Interval,
) {
  if (data.length < 1) return null;
  const highs = data.map((k) => Number(k.high));
  const lows  = data.map((k) => Number(k.low));
  const vols  = data.map((k) => Number(k.volume ?? 0));
  const minP  = Math.min(...lows) * 0.9996;
  const maxP  = Math.max(...highs) * 1.0004;
  const maxVol = Math.max(...vols, 1);

  const xScale = scaleLinear().domain([0, data.length - 1]).range([0, innerW]);
  const yScale = scaleLinear().domain([minP, maxP]).range([priceH, 0]);
  const vScale = scaleLinear().domain([0, maxVol]).range([0, volH - 4]);
  const bodyW  = Math.max(2.5, slotW * 0.62);
  const yTicks = Array.from({ length: 4 }, (_, i) => minP + ((maxP - minP) / 3) * i);

  return { xScale, yScale, vScale, bodyW, slotW, yTicks, width, interval };
}

export default function InteractiveCandleChart({
  symbol,
  interval,
  height = 280,
}: Props) {
  const [klines, setKlines] = useState<Kline[]>([]);
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  const [inspectLocked, setInspectLocked] = useState(false);
  const [viewportW, setViewportW] = useState(0);
  const scrollRef = useRef<ScrollView>(null);
  const scrubW = useRef(0);
  const chartInspectMoved = useRef(false);
  const inspectLockedRef = useRef(false);
  const pendingIdx = useRef<number | null>(null);
  const rafPending = useRef<number | null>(null);
  const chartMetrics = useRef({ innerW: 0, slotW: SLOT_MIN, dataLen: 0, xScale: null as ReturnType<typeof scaleLinear> | null });

  useEffect(() => {
    inspectLockedRef.current = inspectLocked;
  }, [inspectLocked]);

  const fetchKlines = useCallback(async (iv: Interval) => {
    try {
      const sym = spotSymbol(symbol);
      const { data } = await marketApi.getKlines(sym, { interval: iv, limit: LIMIT_MAP[iv] });
      const rows = Array.isArray(data) ? data : [];
      setKlines(rows);
      setSelectedIdx(rows.length > 0 ? rows.length - 1 : null);
      setInspectLocked(false);
    } catch {
      setKlines([]);
      setSelectedIdx(null);
    }
  }, [symbol]);

  useEffect(() => {
    fetchKlines(interval);
  }, [symbol, interval, fetchKlines]);

  const data = useMemo(
    () => (klines.length ? klines.slice(-LIMIT_MAP[interval]) : []),
    [klines, interval],
  );

  const slotW = SLOT_MIN;
  const chartW = Math.max(viewportW, data.length * slotW + PAD.left + PAD.right);
  const innerW = chartW - PAD.left - PAD.right;
  const priceH = (height - PAD.top - PAD.bottom) * (1 - VOL_RATIO);
  const volH   = (height - PAD.top - PAD.bottom) * VOL_RATIO;
  const volTop = PAD.top + priceH + 6;

  const chart = useMemo(
    () => buildChart(data, innerW, priceH, volH, slotW, chartW, interval),
    [data, innerW, priceH, volH, slotW, chartW, interval],
  );

  useEffect(() => {
    chartMetrics.current = {
      innerW,
      slotW,
      dataLen: data.length,
      xScale: chart?.xScale ?? null,
    };
  }, [chart, innerW, slotW, data.length]);

  const flushScrub = useCallback(() => {
    rafPending.current = null;
    const idx = pendingIdx.current;
    if (idx == null) return;
    setSelectedIdx(idx);
    if (scrollRef.current && viewportW > 0 && chartMetrics.current.xScale) {
      const xScale = chartMetrics.current.xScale as (i: number) => number;
      const cx = PAD.left + xScale(idx);
      scrollRef.current.scrollTo({ x: Math.max(0, cx - viewportW / 2), animated: false });
    }
  }, [viewportW]);

  const queueScrub = useCallback((idx: number) => {
    pendingIdx.current = Math.max(0, Math.min(data.length - 1, idx));
    if (rafPending.current == null) {
      rafPending.current = requestAnimationFrame(flushScrub);
    }
  }, [data.length, flushScrub]);

  const pickFromScrubX = useCallback((localX: number) => {
    if (data.length < 1 || scrubW.current <= 0) return;
    const ratio = Math.max(0, Math.min(1, localX / scrubW.current));
    queueScrub(Math.round(ratio * (data.length - 1)));
  }, [data.length, queueScrub]);

  const pickFromChartX = useCallback((localX: number) => {
    if (data.length < 1 || innerW <= 0) return;
    const frac = Math.max(0, Math.min(1, (localX - PAD.left) / innerW));
    queueScrub(Math.round(frac * (data.length - 1)));
  }, [data.length, innerW, queueScrub]);

  const chartInspectPan = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: (evt) => {
      chartInspectMoved.current = false;
      pickFromChartX(evt.nativeEvent.locationX);
    },
    onPanResponderMove: (evt) => {
      chartInspectMoved.current = true;
      pickFromChartX(evt.nativeEvent.locationX);
    },
    onPanResponderRelease: () => {
      if (inspectLockedRef.current && !chartInspectMoved.current) {
        setSelectedIdx(null);
        setInspectLocked(false);
        return;
      }
      flushScrub();
      setInspectLocked(true);
    },
  }), [pickFromChartX, flushScrub]);

  const scrubPan = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: (evt) => pickFromScrubX(evt.nativeEvent.locationX),
    onPanResponderMove: (evt) => pickFromScrubX(evt.nativeEvent.locationX),
    onPanResponderRelease: () => {
      flushScrub();
      setInspectLocked(true);
    },
  }), [pickFromScrubX, flushScrub]);

  useEffect(() => {
    if (!scrollRef.current || data.length < 2 || viewportW <= 0) return;
    const x = Math.max(0, chartW - viewportW);
    scrollRef.current.scrollTo({ x, animated: false });
  }, [symbol, interval]); // only reset scroll on symbol/interval change

  useEffect(() => () => {
    if (rafPending.current != null) cancelAnimationFrame(rafPending.current);
  }, []);

  const onLayout = (e: LayoutChangeEvent) => {
    setViewportW(e.nativeEvent.layout.width);
  };

  const selected = selectedIdx != null ? data[selectedIdx] : null;

  if (!chart || data.length < 1) {
    return (
      <View style={[styles.placeholder, { height }]}>
        <Text style={styles.placeholderText}>No chart data</Text>
      </View>
    );
  }

  const first = Number(data[0].open ?? data[0].close);
  const last  = Number(data[data.length - 1].close);
  const chgPct = first > 0 ? ((last - first) / first) * 100 : 0;
  const thumbPct = selectedIdx != null && data.length > 1
    ? (selectedIdx / (data.length - 1)) * 100
    : 100;

  return (
    <View style={styles.root}>
      <View style={styles.inspector}>
        {selected ? (
          <>
            <Text style={styles.inspectorTime}>
              {formatTime(Number(selected.time), interval)}
            </Text>
            <View style={styles.ohlcRow}>
              <OhlcChip label="O" value={formatPrice(selected.open)} />
              <OhlcChip label="H" value={formatPrice(selected.high)} color={Colors.buyGreen} />
              <OhlcChip label="L" value={formatPrice(selected.low)} color={Colors.sellRed} />
              <OhlcChip label="C" value={formatPrice(selected.close)} />
              <OhlcChip label="Vol" value={formatVolumeCompact(selected.volume)} muted />
            </View>
          </>
        ) : (
          <Text style={styles.hint}>Drag the scrubber below to inspect candles</Text>
        )}
        <Text style={[styles.rangePct, { color: chgPct >= 0 ? Colors.buyGreen : Colors.sellRed }]}>
          {chgPct >= 0 ? '▲' : '▼'} {formatPercent(chgPct)}
        </Text>
      </View>

      <View style={styles.chartViewport} onLayout={onLayout}>
        <ScrollView
          ref={scrollRef}
          horizontal
          nestedScrollEnabled
          showsHorizontalScrollIndicator={false}
          scrollEventThrottle={32}
          removeClippedSubviews
          contentContainerStyle={{ width: chartW }}
        >
          <View style={{ width: chartW, height }} {...chartInspectPan.panHandlers}>
            <CandleSvg
              data={data}
              chart={chart}
              innerW={innerW}
              priceH={priceH}
              volH={volH}
              volTop={volTop}
              height={height}
              selectedIdx={selectedIdx}
            />
          </View>
        </ScrollView>
      </View>

      <View
        style={styles.scrubTrack}
        onLayout={(e) => { scrubW.current = e.nativeEvent.layout.width; }}
        {...scrubPan.panHandlers}
      >
        <View style={[styles.scrubFill, { width: `${thumbPct}%` }]} />
        <View style={[styles.scrubThumb, { left: `${thumbPct}%` }]} />
      </View>

      <Text style={styles.panHint}>Hold chart to inspect · tap again to dismiss · drag scrubber</Text>
    </View>
  );
}

function OhlcChip({ label, value, color, muted }: {
  label: string; value: string; color?: string; muted?: boolean;
}) {
  return (
    <View style={styles.ohlcChip}>
      <Text style={styles.ohlcLabel}>{label}</Text>
      <Text style={[styles.ohlcVal, color ? { color } : null, muted && styles.ohlcMuted]}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  placeholder: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0d1117',
    borderRadius: Radius.md,
  },
  placeholderText: {
    fontFamily: FontFamily.regular,
    fontSize: FontSize.sm,
    color: Colors.textMuted,
    marginTop: Spacing[2],
  },
  inspector: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: Spacing[2],
    paddingHorizontal: Spacing[3],
    paddingVertical: Spacing[2],
    borderBottomWidth: 1,
    borderBottomColor: Colors.surfaceBorder,
    minHeight: 52,
  },
  inspectorTime: {
    fontFamily: FontFamily.monoMedium,
    fontSize: FontSize.xs,
    color: Colors.goldLight,
    width: '100%',
    marginBottom: 2,
  },
  ohlcRow: { flexDirection: 'row', flexWrap: 'wrap', flex: 1, gap: Spacing[2] },
  ohlcChip: { marginRight: Spacing[2] },
  ohlcLabel: { fontFamily: FontFamily.regular, fontSize: 8, color: Colors.textMuted },
  ohlcVal: { fontFamily: FontFamily.monoMedium, fontSize: FontSize.xs, color: Colors.textPrimary },
  ohlcMuted: { color: Colors.textSecondary },
  hint: { flex: 1, fontFamily: FontFamily.regular, fontSize: FontSize.xs, color: Colors.textMuted },
  rangePct: { fontFamily: FontFamily.monoMedium, fontSize: FontSize.xs, marginLeft: 'auto' },
  chartViewport: {
    flex: 1,
    backgroundColor: '#0d1117',
    borderRadius: Radius.md,
    overflow: 'hidden',
    minHeight: 200,
  },
  scrubTrack: {
    height: 32,
    marginHorizontal: Spacing[3],
    marginTop: Spacing[2],
    backgroundColor: Colors.surfaceElevated,
    borderRadius: Radius.full,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    justifyContent: 'center',
  },
  scrubFill: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    backgroundColor: Colors.goldAlpha15,
    borderRadius: Radius.full,
  },
  scrubThumb: {
    position: 'absolute',
    width: 16,
    height: 16,
    borderRadius: 8,
    marginLeft: -8,
    backgroundColor: Colors.gold,
    borderWidth: 2,
    borderColor: Colors.goldLight,
    top: 7,
  },
  panHint: {
    fontFamily: FontFamily.regular,
    fontSize: 9,
    color: Colors.textMuted,
    textAlign: 'center',
    paddingVertical: Spacing[2],
  },
});

export { INTERVALS };
export type { Interval };