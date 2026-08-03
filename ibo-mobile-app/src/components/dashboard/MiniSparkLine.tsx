import React from 'react';
import { View } from 'react-native';
import Svg, { Path, Defs, LinearGradient, Stop } from 'react-native-svg';
import { Colors } from '../../theme';
import { MarketRow } from '../../types/market.types';
import { buildSparkPoints } from '../../utils/markets';
import { isPositive } from '../../utils/formatters';

const W = 72;
const H = 36;
const PAD = 2;

type Props = {
  market: MarketRow;
  width?: number;
  height?: number;
  idSuffix?: string;
};

export default function MiniSparkLine({
  market,
  width = W,
  height = H,
  idSuffix = '',
}: Props) {
  const pts = buildSparkPoints(market);
  if (!pts || pts.length < 2) {
    return <View style={{ width, height }} />;
  }

  const pos = isPositive(market.price_change_pct_24h);
  const color = pos ? Colors.buyGreen : Colors.sellRed;
  const gradId = `dash_${market.symbol.replace(/\W/g, '_')}${idSuffix}`;

  const minV = Math.min(...pts);
  const maxV = Math.max(...pts);
  const range = maxV - minV || minV * 0.002 || 1;

  const toX = (i: number) => PAD + (i / (pts.length - 1)) * (width - PAD * 2);
  const toY = (v: number) =>
    height - PAD - ((v - minV) / range) * (height - PAD * 2);

  const lineParts = pts
    .map((v, i) => `${i === 0 ? 'M' : 'L'} ${toX(i).toFixed(1)},${toY(v).toFixed(1)}`)
    .join(' ');

  const fillParts = [
    `M ${toX(0).toFixed(1)},${height}`,
    ...pts.map((v, i) => `L ${toX(i).toFixed(1)},${toY(v).toFixed(1)}`),
    `L ${toX(pts.length - 1).toFixed(1)},${height}`,
    'Z',
  ].join(' ');

  return (
    <Svg width={width} height={height}>
      <Defs>
        <LinearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={color} stopOpacity={0.3} />
          <Stop offset="1" stopColor={color} stopOpacity={0} />
        </LinearGradient>
      </Defs>
      <Path d={fillParts} fill={`url(#${gradId})`} stroke="none" />
      <Path
        d={lineParts}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}
