/**
 * Multi-Market Trading Chart
 *
 * Looks like the reference image: candlestick chart (green/red) with
 * teal volume bars at the bottom and a smooth MA line with white dots.
 *
 * ── Data strategy ──────────────────────────────────────────────────────────────
 * Each of the top-N markets contributes 5 synthetic candles from
 * buildSparkPoints().  Candle price-levels are converted to % change from
 * each market's open, then chained together so the chart reads as a single
 * continuous price series (like a 40-bar 24h chart).
 *
 * ── Animation (JS-thread free) ─────────────────────────────────────────────────
 * Only `opacity` and `transform` animations are used — all run on the native
 * driver.  No height/width/position animations = zero JS-thread warnings.
 *
 * buildVolumeBarItems / BarItem are kept for DashboardScreen compatibility.
 */
import React, { useEffect, useRef, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Animated,
  Easing,
  useWindowDimensions,
} from 'react-native';
import Svg, { Path, Rect, Line, Circle, Defs, LinearGradient, Stop } from 'react-native-svg';
import { Colors, FontFamily, FontSize, Spacing, Radius } from '../../theme';
import { MarketRow } from '../../types/market.types';
import { formatPercent, isPositive } from '../../utils/formatters';
import { formatVolumeCompact, pairParts, parseMarketNum, buildSparkPoints } from '../../utils/markets';

// ── Public types (keep DashboardScreen working) ─────────────────────────────────
export type BarItem = { market: MarketRow; sharePct: number };
export function buildVolumeBarItems(markets: MarketRow[]): BarItem[] {
  if (!markets.length) return [];
  const maxVol = Math.max(...markets.map((m) => parseMarketNum(m.volume_24h)));
  if (maxVol <= 0) return markets.map((m) => ({ market: m, sharePct: 30 }));
  return markets.map((m) => ({
    market: m,
    sharePct: Math.max(8, (parseMarketNum(m.volume_24h) / maxVol) * 100),
  }));
}

// ── Constants ────────────────────────────────────────────────────────────────────
const CANDLES_PER_MKT = 5;
const CHART_H    = 150; // candlestick area height px
const VOL_H      = 28;  // volume bars height px
const LABEL_H    = 32;  // label row height px
const PAD_L      = 6;
const PAD_R      = 6;
const PAD_TOP    = 8;
const WICK_W     = 1.2;
const BULL_COLOR = '#26a69a'; // teal-green (like reference)
const BEAR_COLOR = '#ef5350'; // red
const VOL_COLOR  = '#26a69a';
const MA_COLOR   = '#fff';
const DOT_COLOR  = '#fff';
const MA_STROKE  = 1.8;

// ── Data builder ────────────────────────────────────────────────────────────────

type Candle = { o: number; c: number; hi: number; lo: number; bull: boolean; mktIdx: number };

function buildContinuousCandles(items: BarItem[]): {
  candles: Candle[];
  closes: number[];     // one closing price per market (for MA / dots)
  volShares: number[];  // normalised 0-1 per market
  yMin: number;
  yMax: number;
} {
  let level = 0;
  const candles: Candle[] = [];
  const closes: number[]  = [];
  const maxVol = Math.max(...items.map((it) => parseMarketNum(it.market.volume_24h)), 1);

  items.forEach((item, mktIdx) => {
    const pts = buildSparkPoints(item.market);
    const openPx = pts ? parseMarketNum(pts[0]) : 1;

    if (!pts || openPx <= 0) {
      // Flat placeholder
      for (let i = 0; i < CANDLES_PER_MKT; i++) {
        candles.push({ o: level, c: level, hi: level + 0.1, lo: level - 0.1, bull: true, mktIdx });
      }
      closes.push(level);
      return;
    }

    // Shift each point to % distance from open + running level
    const shifted = pts.map((p) => ((parseMarketNum(p) - openPx) / openPx) * 100 + level);

    const rawHi  = parseMarketNum(item.market.high_24h);
    const rawLo  = parseMarketNum(item.market.low_24h);
    const hiPct  = rawHi > 0 ? ((rawHi - openPx) / openPx) * 100 + level : level;
    const loPct  = rawLo > 0 ? ((rawLo - openPx) / openPx) * 100 + level : level;
    const isPos  = parseMarketNum(item.market.price_change_pct_24h) >= 0;

    for (let i = 0; i < CANDLES_PER_MKT; i++) {
      const o  = shifted[i];
      const c  = shifted[i + 1];
      let hi   = Math.max(o, c) + 0.25;
      let lo   = Math.min(o, c) - 0.25;

      // Anchor one candle to the actual 24h extreme per market
      if (isPos) {
        if (i === 1) lo = Math.min(lo, loPct);
        if (i === 2) hi = Math.max(hi, hiPct);
      } else {
        if (i === 1) hi = Math.max(hi, hiPct);
        if (i === 2) lo = Math.min(lo, loPct);
      }

      candles.push({ o, c, hi: Math.max(hi, Math.max(o, c)), lo: Math.min(lo, Math.min(o, c)), bull: c >= o, mktIdx });
    }

    level = shifted[CANDLES_PER_MKT]; // chain: next market opens at this close
    closes.push(level);
  });

  const allVals = candles.flatMap((cd) => [cd.hi, cd.lo]);
  const yMin    = Math.min(...allVals);
  const yMax    = Math.max(...allVals);
  const volShares = items.map((it) => parseMarketNum(it.market.volume_24h) / maxVol);

  return { candles, closes, volShares, yMin, yMax };
}

// ── SVG helpers ─────────────────────────────────────────────────────────────────

function toSvgY(v: number, yMin: number, yMax: number, h: number, pad: number) {
  const range = yMax - yMin || 1;
  return pad + (1 - (v - yMin) / range) * (h - pad * 2);
}

// Catmull-Rom smooth path through an array of [x, y] points
function smoothPath(pts: [number, number][]): string {
  if (pts.length < 2) return '';
  let d = `M ${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}`;
  for (let i = 1; i < pts.length; i++) {
    const prev2 = pts[Math.max(0, i - 2)];
    const prev  = pts[i - 1];
    const cur   = pts[i];
    const next  = pts[Math.min(pts.length - 1, i + 1)];
    const cp1x  = prev[0] + (cur[0] - prev2[0]) / 6;
    const cp1y  = prev[1] + (cur[1] - prev2[1]) / 6;
    const cp2x  = cur[0]  - (next[0] - prev[0]) / 6;
    const cp2y  = cur[1]  - (next[1] - prev[1]) / 6;
    d += ` C ${cp1x.toFixed(1)} ${cp1y.toFixed(1)} ${cp2x.toFixed(1)} ${cp2y.toFixed(1)} ${cur[0].toFixed(1)} ${cur[1].toFixed(1)}`;
  }
  return d;
}

// ── Animated MA dot ──────────────────────────────────────────────────────────────

function AnimDot({ cx, cy, delay }: { cx: number; cy: number; delay: number }) {
  const opacity = useRef(new Animated.Value(0)).current;
  const scale   = useRef(new Animated.Value(0.3)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration: 250, delay, useNativeDriver: true }),
      Animated.spring(scale, { toValue: 1, delay, useNativeDriver: true, tension: 160, friction: 7 }),
    ]).start();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Animated.View
      style={{
        position: 'absolute',
        left: cx - 5,
        top: cy - 5,
        width: 10,
        height: 10,
        borderRadius: 5,
        backgroundColor: DOT_COLOR,
        opacity,
        transform: [{ scale }],
        shadowColor: '#fff',
        shadowOpacity: 0.8,
        shadowRadius: 4,
        elevation: 4,
      }}
    />
  );
}

// ── Main component ───────────────────────────────────────────────────────────────

type Props = {
  items: BarItem[];
  onPress: (m: MarketRow) => void;
  onChartPress?: () => void;
};

export default function VolumeBarChart({ items, onPress, onChartPress }: Props) {
  const { width: screenW } = useWindowDimensions();
  const cardPad = Spacing[4] * 2;
  const svgW    = screenW - cardPad * 2;

  // Entrance: whole chart fades + slides in
  const chartOpacity  = useRef(new Animated.Value(0)).current;
  const chartTranslY  = useRef(new Animated.Value(10)).current;
  // MA line fade
  const maOpacity     = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(chartOpacity, {
        toValue: 1, duration: 450, useNativeDriver: true, easing: Easing.out(Easing.quad),
      }),
      Animated.timing(chartTranslY, {
        toValue: 0, duration: 450, useNativeDriver: true, easing: Easing.out(Easing.quad),
      }),
    ]).start(() => {
      // MA line draws in after candles appear
      Animated.timing(maOpacity, {
        toValue: 1, duration: 600, delay: 100, useNativeDriver: true, easing: Easing.out(Easing.ease),
      }).start();
    });
  }, []);

  const { candles, closes, volShares, yMin, yMax } = useMemo(
    () => buildContinuousCandles(items),
    [items],
  );

  if (!candles.length) return null;

  const totalCandles = candles.length;
  const innerW  = svgW - PAD_L - PAD_R;
  const slotW   = innerW / totalCandles;
  const bodyW   = Math.max(2, slotW * 0.55);

  // Y-mapping for candlestick area
  const toY = (v: number) => toSvgY(v, yMin, yMax, CHART_H, PAD_TOP);

  // Candle SVG strings
  const candleEls = candles.map((cd, i) => {
    const cx   = PAD_L + i * slotW + slotW / 2;
    const topY = toY(cd.hi);
    const botY = toY(cd.lo);
    const oY   = toY(cd.o);
    const cY   = toY(cd.c);
    const bodyTop = Math.min(oY, cY);
    const bodyH   = Math.max(1.5, Math.abs(oY - cY));
    const color   = cd.bull ? BULL_COLOR : BEAR_COLOR;
    return { cx, topY, botY, bodyTop, bodyH, bodyW, color, bull: cd.bull };
  });

  // MA path + dot positions (one per market = every CANDLES_PER_MKT candles)
  const maPts: [number, number][] = closes.map((cl, mi) => {
    const candleIdx = mi * CANDLES_PER_MKT + (CANDLES_PER_MKT - 1);
    const cx = PAD_L + candleIdx * slotW + slotW / 2;
    return [cx, toY(cl)];
  });
  const maPath = smoothPath(maPts);

  // Volume bars
  const volBarsPerMkt = volShares.map((share, mi) => {
    const firstCandle = mi * CANDLES_PER_MKT;
    const lastCandle  = firstCandle + CANDLES_PER_MKT - 1;
    const barX  = PAD_L + firstCandle * slotW;
    const barW2 = slotW * CANDLES_PER_MKT - 2;
    const barH  = Math.max(3, share * VOL_H);
    return { barX, barW: barW2, barH };
  });

  // Market group labels (below SVG)
  const marketLabels = items.map((item, mi) => {
    const firstCandle = mi * CANDLES_PER_MKT;
    const cx = PAD_L + firstCandle * slotW + (slotW * CANDLES_PER_MKT) / 2;
    const { base } = pairParts(item.market);
    const pos = isPositive(item.market.price_change_pct_24h);
    return { cx, base, pct: formatPercent(item.market.price_change_pct_24h), pos, market: item.market };
  });

  const totalH = CHART_H + 4 + VOL_H;

  return (
    <View>
      {/* Top info row */}
      <View style={styles.infoRow}>
        <View style={styles.infoLeft}>
          <View style={[styles.legendDot, { backgroundColor: BULL_COLOR }]} />
          <Text style={styles.legendText}>Bullish</Text>
          <View style={[styles.legendDot, { backgroundColor: BEAR_COLOR, marginLeft: Spacing[3] }]} />
          <Text style={styles.legendText}>Bearish</Text>
        </View>
        <Text style={styles.infoSub}>5 candles per pair · normalised 24h</Text>
      </View>

      {/* Chart */}
      <Animated.View
        style={{ opacity: chartOpacity, transform: [{ translateY: chartTranslY }] }}
      >
        {/* SVG chart area — tap to open full chart explorer */}
        <TouchableOpacity
          style={[styles.chartWrap, { height: totalH + 4 }]}
          onPress={onChartPress}
          activeOpacity={0.92}
          disabled={!onChartPress}
        >
          <Svg width={svgW} height={totalH}>
            <Defs>
              <LinearGradient id="volGrad" x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0" stopColor={VOL_COLOR} stopOpacity={0.7} />
                <Stop offset="1" stopColor={VOL_COLOR} stopOpacity={0.15} />
              </LinearGradient>
            </Defs>

            {/* Grid lines */}
            {[0.25, 0.5, 0.75].map((f, i) => (
              <Line
                key={i}
                x1={PAD_L} y1={PAD_TOP + f * (CHART_H - PAD_TOP * 2)}
                x2={svgW - PAD_R} y2={PAD_TOP + f * (CHART_H - PAD_TOP * 2)}
                stroke="rgba(255,255,255,0.05)"
                strokeWidth={1}
                strokeDasharray="4 4"
              />
            ))}

            {/* Market group dividers */}
            {items.map((_, mi) => {
              if (mi === 0) return null;
              const x = PAD_L + mi * CANDLES_PER_MKT * slotW;
              return (
                <Line
                  key={mi}
                  x1={x} y1={PAD_TOP}
                  x2={x} y2={CHART_H}
                  stroke="rgba(255,255,255,0.06)"
                  strokeWidth={1}
                />
              );
            })}

            {/* Candlestick wicks */}
            {candleEls.map((cd, i) => (
              <Line
                key={`w${i}`}
                x1={cd.cx} y1={cd.topY}
                x2={cd.cx} y2={cd.botY}
                stroke={cd.color}
                strokeWidth={WICK_W}
                opacity={0.75}
              />
            ))}

            {/* Candlestick bodies */}
            {candleEls.map((cd, i) => (
              <Rect
                key={`b${i}`}
                x={cd.cx - cd.bodyW / 2}
                y={cd.bodyTop}
                width={cd.bodyW}
                height={cd.bodyH}
                fill={cd.bull ? cd.color : 'transparent'}
                stroke={cd.color}
                strokeWidth={1}
                rx={0.5}
              />
            ))}

            {/* Volume divider */}
            <Line
              x1={PAD_L} y1={CHART_H + 2}
              x2={svgW - PAD_R} y2={CHART_H + 2}
              stroke="rgba(255,255,255,0.1)"
              strokeWidth={1}
            />

            {/* Volume bars */}
            {volBarsPerMkt.map((vb, mi) => (
              <Rect
                key={`v${mi}`}
                x={vb.barX + 2}
                y={CHART_H + 4 + (VOL_H - vb.barH)}
                width={Math.max(2, vb.barW - 4)}
                height={vb.barH}
                fill="url(#volGrad)"
                rx={2}
              />
            ))}
          </Svg>

          {/* Animated MA line (separate so opacity animates on native thread) */}
          <Animated.View
            style={[StyleSheet.absoluteFill, { opacity: maOpacity }]}
            pointerEvents="none"
          >
            <Svg width={svgW} height={totalH}>
              {/* MA line shadow / glow */}
              <Path
                d={maPath}
                stroke={MA_COLOR}
                strokeWidth={3.5}
                fill="none"
                opacity={0.12}
              />
              {/* MA line */}
              <Path
                d={maPath}
                stroke={MA_COLOR}
                strokeWidth={MA_STROKE}
                fill="none"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </Svg>

            {/* Animated dots (one per market closing price) */}
            {maPts.map(([cx, cy], mi) => (
              <AnimDot key={mi} cx={cx} cy={cy} delay={200 + mi * 60} />
            ))}
          </Animated.View>
        </TouchableOpacity>

        {/* Labels row */}
        <View style={[styles.labelsRow, { width: svgW }]}>
          {marketLabels.map((ml, mi) => (
            <TouchableOpacity
              key={mi}
              style={[styles.labelGroup, { left: ml.cx - 24, width: 48 }]}
              onPress={() => onPress(ml.market)}
              activeOpacity={0.7}
            >
              <Text style={styles.labelBase} numberOfLines={1}>{ml.base}</Text>
              <Text style={[styles.labelPct, { color: ml.pos ? Colors.buyGreen : Colors.sellRed }]}>
                {ml.pct}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </Animated.View>
    </View>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: Spacing[3],
  },
  infoLeft: { flexDirection: 'row', alignItems: 'center' },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  legendText: {
    fontFamily: FontFamily.regular,
    fontSize: FontSize.xs,
    color: Colors.textMuted,
    marginLeft: Spacing[1],
  },
  infoSub: {
    fontFamily: FontFamily.regular,
    fontSize: 9,
    color: Colors.textMuted,
  },

  chartWrap: {
    position: 'relative',
    backgroundColor: '#0d1117',
    borderRadius: Radius.md,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
  },

  labelsRow: {
    height: LABEL_H,
    position: 'relative',
    marginTop: Spacing[2],
  },
  labelGroup: {
    position: 'absolute',
    alignItems: 'center',
  },
  labelBase: {
    fontFamily: FontFamily.bold,
    fontSize: 9,
    color: Colors.textSecondary,
  },
  labelPct: {
    fontFamily: FontFamily.monoMedium,
    fontSize: 8,
    marginTop: 1,
  },
});
