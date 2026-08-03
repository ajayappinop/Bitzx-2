/**
 * Mini candlestick chart — SVG, no external deps beyond react-native-svg.
 *
 * Data strategy:
 *   buildSparkPoints() produces 6 synthetic price levels derived from
 *   open / close / high_24h / low_24h.  We treat consecutive pairs as
 *   (open, close) of 5 candles, giving a compact OHLC-style view.
 *
 *   Wicks extend slightly beyond each body.  The candle that contains
 *   the 24h extreme gets a wick reaching the actual high/low so the
 *   chart stays anchored to real data.
 */
import React from 'react';
import { View } from 'react-native';
import Svg, { Rect, Line } from 'react-native-svg';
import { Colors } from '../../theme';
import { MarketRow } from '../../types/market.types';
import { buildSparkPoints } from '../../utils/markets';
import { parseMarketNum } from '../../utils/markets';

const DEFAULT_W = 72;
const DEFAULT_H = 36;
const PAD       = 3;
const WICK_W    = 1.2;
const BODY_RATIO = 0.55; // body width as fraction of per-candle slot

type Props = {
  market: MarketRow;
  width?:  number;
  height?: number;
  /** suffix appended to svg key to prevent duplicate IDs */
  idSuffix?: string;
};

type Candle = { o: number; c: number; hi: number; lo: number };

/** Build 5 candles from 6 synthetic price points. */
function buildCandles(m: MarketRow): Candle[] | null {
  const pts = buildSparkPoints(m);
  if (!pts || pts.length < 6) return null;

  const rawHigh = parseMarketNum(m.high_24h);
  const rawLow  = parseMarketNum(m.low_24h);
  const isPos   = parseMarketNum(m.price_change_pct_24h) >= 0;

  return pts.slice(0, 5).map((o, i) => {
    const c  = pts[i + 1];
    const hi = Math.max(o, c);
    const lo = Math.min(o, c);

    // Small symmetric wicks by default
    const wickUp  = hi * 1.003;
    const wickDn  = lo * 0.997;

    // Anchor one wick to the actual 24h extreme
    let finalHi = wickUp;
    let finalLo = wickDn;

    if (isPos) {
      // The extreme-low candle is index 1 (contains the valley)
      if (i === 1 && rawLow > 0)  finalLo = rawLow;
      // The extreme-high candle is index 2 (contains the peak)
      if (i === 2 && rawHigh > 0) finalHi = rawHigh;
    } else {
      // Bearish: peak at index 1, valley at index 2
      if (i === 1 && rawHigh > 0) finalHi = rawHigh;
      if (i === 2 && rawLow  > 0) finalLo = rawLow;
    }

    return { o, c, hi: Math.max(finalHi, hi), lo: Math.min(finalLo, lo) };
  });
}

export default function CandleChart({
  market,
  width  = DEFAULT_W,
  height = DEFAULT_H,
}: Props) {
  const candles = buildCandles(market);
  if (!candles) return <View style={{ width, height }} />;

  // Overall price range for Y-axis scaling
  const allHi  = Math.max(...candles.map((c) => c.hi));
  const allLo  = Math.min(...candles.map((c) => c.lo));
  const range  = allHi - allLo || allHi * 0.004 || 1;

  const innerW = width  - PAD * 2;
  const innerH = height - PAD * 2;
  const slotW  = innerW / candles.length;
  const bodyW  = slotW  * BODY_RATIO;

  const toY = (v: number) =>
    PAD + innerH - ((v - allLo) / range) * innerH;

  const isPos = parseMarketNum(market.price_change_pct_24h) >= 0;
  const upColor   = Colors.buyGreen;
  const downColor = Colors.sellRed;

  return (
    <View style={{ width, height }}>
      <Svg width={width} height={height}>
        {candles.map((cd, i) => {
          const bull = cd.c >= cd.o;
          const color = bull ? upColor : downColor;

          const cx     = PAD + i * slotW + slotW / 2;
          const bodyTop = toY(Math.max(cd.o, cd.c));
          const bodyBot = toY(Math.min(cd.o, cd.c));
          const bodyH   = Math.max(1.5, bodyBot - bodyTop);
          const bodyX   = cx - bodyW / 2;

          const wickTop = toY(cd.hi);
          const wickBot = toY(cd.lo);

          return (
            <React.Fragment key={i}>
              {/* Wick */}
              <Line
                x1={cx}
                y1={wickTop}
                x2={cx}
                y2={wickBot}
                stroke={color}
                strokeWidth={WICK_W}
                opacity={0.75}
              />
              {/* Body */}
              <Rect
                x={bodyX}
                y={bodyTop}
                width={bodyW}
                height={bodyH}
                fill={bull ? color : Colors.transparent}
                stroke={color}
                strokeWidth={1}
                rx={1}
              />
            </React.Fragment>
          );
        })}
      </Svg>
    </View>
  );
}
