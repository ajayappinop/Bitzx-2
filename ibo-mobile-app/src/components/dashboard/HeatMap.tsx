/**
 * Market Heatmap
 *   colour = 24h price change  (theme-aware dark tints)
 *   height = volume weight     (taller = more traded)
 *
 * Tiles are packed into rows that always sum to exactly ROW_COLS columns,
 * so there are NEVER empty trailing gaps.
 */
import React, { useEffect, useRef } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Animated } from 'react-native';
import { Colors, FontFamily, FontSize, Spacing, Radius } from '../../theme';
import { MarketRow } from '../../types/market.types';
import { formatPercent } from '../../utils/formatters';
import { formatVolumeCompact, pairParts, parseMarketNum } from '../../utils/markets';

export type HeatTile = {
  market: MarketRow;
  weight: number; // 0–1 normalised volume share
};

type Props = {
  tiles: HeatTile[];
  onPress: (market: MarketRow) => void;
};

const ROW_COLS = 3; // total column units per row
const GAP = 3;      // px gap between tiles

function tileTheme(pct: number): { bg: string; border: string; textColor: string } {
  const v = Math.max(-12, Math.min(12, pct));
  if (v >= 5)   return { bg: 'rgba(34,197,94,0.18)',  border: 'rgba(34,197,94,0.35)',  textColor: Colors.buyGreen };
  if (v >= 2)   return { bg: 'rgba(34,197,94,0.12)',  border: 'rgba(34,197,94,0.22)',  textColor: Colors.buyGreen };
  if (v >= 0.5) return { bg: 'rgba(34,197,94,0.06)',  border: 'rgba(34,197,94,0.14)',  textColor: '#6ee7a0' };
  if (v > -0.5) return { bg: Colors.surfaceElevated,  border: Colors.surfaceBorder,    textColor: Colors.textMuted };
  if (v > -2)   return { bg: 'rgba(239,68,68,0.06)',  border: 'rgba(239,68,68,0.14)',  textColor: '#fca5a5' };
  if (v > -5)   return { bg: 'rgba(239,68,68,0.12)',  border: 'rgba(239,68,68,0.22)',  textColor: Colors.sellRed };
  return          { bg: 'rgba(239,68,68,0.20)',  border: 'rgba(239,68,68,0.38)',  textColor: Colors.sellRed };
}

/** How many column units this tile should occupy (1 or 2 out of ROW_COLS=3) */
function tileColSpan(weight: number): 1 | 2 {
  return weight > 0.55 ? 2 : 1;
}

/**
 * Pack tiles into rows of exactly ROW_COLS column-units each.
 * If the last row is short, the final tile's span is expanded to fill.
 */
function packRows(tiles: HeatTile[]): Array<{ tile: HeatTile; span: number }[]> {
  const rows: Array<{ tile: HeatTile; span: number }[]> = [];
  let current: { tile: HeatTile; span: number }[] = [];
  let usedCols = 0;

  for (const tile of tiles) {
    let span = tileColSpan(tile.weight);
    // If it won't fit, start a new row
    if (usedCols + span > ROW_COLS) {
      if (current.length > 0) rows.push(current);
      current = [];
      usedCols = 0;
      span = Math.min(span, ROW_COLS) as 1 | 2;
    }
    current.push({ tile, span });
    usedCols += span;
    if (usedCols === ROW_COLS) {
      rows.push(current);
      current = [];
      usedCols = 0;
    }
  }

  // Last partial row — expand last tile to fill remaining columns
  if (current.length > 0) {
    const remaining = ROW_COLS - usedCols;
    if (remaining > 0) {
      current[current.length - 1].span += remaining;
    }
    rows.push(current);
  }

  return rows;
}

function FadeTile({
  tile,
  span,
  index,
  onPress,
}: {
  tile: HeatTile;
  span: number;
  index: number;
  onPress: () => void;
}) {
  const opacity = useRef(new Animated.Value(0)).current;
  const scale   = useRef(new Animated.Value(0.9)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity, {
        toValue: 1,
        duration: 220,
        delay: index * 18,
        useNativeDriver: true,
        easing: (t) => t,
      }),
      Animated.spring(scale, {
        toValue: 1,
        useNativeDriver: true,
        delay: index * 18,
        tension: 140,
        friction: 9,
      }),
    ]).start();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pct = parseMarketNum(tile.market.price_change_pct_24h);
  const { bg, border, textColor } = tileTheme(pct);
  const { base } = pairParts(tile.market);
  const tileH = 58 + Math.round(tile.weight * 36);

  return (
    <Animated.View style={{ flex: span, opacity, transform: [{ scale }] }}>
      <TouchableOpacity
        activeOpacity={0.7}
        onPress={onPress}
        style={[styles.tile, { backgroundColor: bg, borderColor: border, height: tileH }]}
      >
        <Text style={styles.tileBase} numberOfLines={1}>{base}</Text>
        <Text style={[styles.tilePct, { color: textColor }]}>{formatPercent(pct)}</Text>
        <Text style={styles.tileVol}>{formatVolumeCompact(tile.market.volume_24h)}</Text>
      </TouchableOpacity>
    </Animated.View>
  );
}

export default function HeatMap({ tiles, onPress }: Props) {
  if (tiles.length === 0) return null;

  const rows = packRows(tiles);
  let globalIndex = 0;

  return (
    <View style={styles.wrap}>
      {rows.map((row, ri) => (
        <View key={ri} style={styles.row}>
          {row.map(({ tile, span }) => {
            const idx = globalIndex++;
            return (
              <FadeTile
                key={tile.market.symbol}
                tile={tile}
                span={span}
                index={idx}
                onPress={() => onPress(tile.market)}
              />
            );
          })}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: GAP },
  row: {
    flexDirection: 'row',
    gap: GAP,
  },
  tile: {
    borderRadius: Radius.md,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: Spacing[2],
    overflow: 'hidden',
  },
  tileBase: {
    fontFamily: FontFamily.bold,
    fontSize: FontSize.sm,
    color: Colors.textPrimary,
    textAlign: 'center',
  },
  tilePct: {
    fontFamily: FontFamily.monoMedium,
    fontSize: 9,
    marginTop: 2,
    textAlign: 'center',
  },
  tileVol: {
    fontFamily: FontFamily.mono,
    fontSize: 8,
    color: Colors.textMuted,
    marginTop: 1,
    textAlign: 'center',
  },
});
