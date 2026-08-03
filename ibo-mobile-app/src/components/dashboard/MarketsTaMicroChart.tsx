import React, { useMemo } from 'react';
import { View } from 'react-native';
import Svg, { Line, Path, Circle, Defs, LinearGradient, Stop, Rect } from 'react-native-svg';
import { Colors } from '../../theme';
import { MarketRow } from '../../types/market.types';
import { buildSparkPoints } from '../../utils/markets';
import { isPositive } from '../../utils/formatters';

const PAD_X = 2;
const PAD_Y = 3;

type Props = {
  market: MarketRow;
  width?: number;
  height?: number;
};

const bottomY = (height: number) => height - PAD_Y;

/** Step path (horizontal-then-vertical) through synthetic intraday levels. */
function stepStroke(xs: number[], ys: number[]): string {
  if (xs.length < 2 || ys.length !== xs.length) return '';
  let d = `M ${xs[0].toFixed(1)},${ys[0].toFixed(1)}`;
  for (let i = 0; i < xs.length - 1; i += 1) {
    d += ` H ${xs[i + 1].toFixed(1)} V ${ys[i + 1].toFixed(1)}`;
  }
  return d;
}

/** Closed path: chart bottom → step series → back along bottom (for area fill). */
function stepFill(xs: number[], ys: number[], height: number): string {
  if (xs.length < 2 || ys.length !== xs.length) return '';
  const b = bottomY(height);
  let d = `M ${xs[0].toFixed(1)},${b.toFixed(1)} L ${xs[0].toFixed(1)},${ys[0].toFixed(1)}`;
  for (let i = 0; i < xs.length - 1; i += 1) {
    d += ` H ${xs[i + 1].toFixed(1)} V ${ys[i + 1].toFixed(1)}`;
  }
  d += ` L ${xs[xs.length - 1].toFixed(1)},${b.toFixed(1)} Z`;
  return d;
}

export default function MarketsTaMicroChart({
  market,
  width = 132,
  height = 46,
}: Props) {
  const model = useMemo(() => {
    const pts = buildSparkPoints(market);
    if (!pts || pts.length < 2) return null;
    const minV = Math.min(...pts);
    const maxV = Math.max(...pts);
    const range = maxV - minV || Math.abs(minV) * 0.002 || 1;
    const innerW = width - PAD_X * 2;
    const innerH = height - PAD_Y * 2;
    const toX = (i: number) => PAD_X + (i / (pts.length - 1)) * innerW;
    const toY = (v: number) => PAD_Y + innerH - ((v - minV) / range) * innerH;
    const xs = pts.map((_, i) => toX(i));
    const ys = pts.map(toY);
    const yOpen = ys[0];
    const lastIdx = pts.length - 1;
    return {
      xs,
      ys,
      yOpen,
      cx: xs[lastIdx],
      cy: ys[lastIdx],
      strokeD: stepStroke(xs, ys),
      fillD: stepFill(xs, ys, height),
    };
  }, [market, width, height]);

  if (!model) {
    return <View style={{ width, height }} />;
  }

  const pos = isPositive(market.price_change_pct_24h);
  const stroke = pos ? Colors.buyGreen : Colors.sellRed;
  const gradId = `ta_mkt_${market.symbol.replace(/\W/g, '_')}`;

  return (
    <Svg width={width} height={height}>
      <Defs>
        <LinearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={stroke} stopOpacity={0.22} />
          <Stop offset="1" stopColor={stroke} stopOpacity={0} />
        </LinearGradient>
      </Defs>
      <Rect
        x={0.5}
        y={0.5}
        width={width - 1}
        height={height - 1}
        rx={4}
        fill={Colors.surfaceDark}
        stroke={Colors.surfaceBorder}
        strokeWidth={1}
      />
      <Line
        x1={PAD_X}
        x2={width - PAD_X}
        y1={model.yOpen}
        y2={model.yOpen}
        stroke={Colors.textMuted}
        strokeWidth={1}
        strokeDasharray="4 3"
        opacity={0.55}
      />
      <Path d={model.fillD} fill={`url(#${gradId})`} stroke="none" />
      <Path
        d={model.strokeD}
        fill="none"
        stroke={stroke}
        strokeWidth={1.75}
        strokeLinecap="square"
        strokeLinejoin="miter"
      />
      <Circle cx={model.cx} cy={model.cy} r={3.5} fill={stroke} stroke={Colors.surfaceDark} strokeWidth={1.2} />
    </Svg>
  );
}
