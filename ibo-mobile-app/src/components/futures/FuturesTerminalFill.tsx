/**
 * Fills the futures terminal form gap — live order estimates + market tape.
 */
import React, { useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Colors, FontFamily, FontSize, Spacing, Radius } from '@/theme';
import { formatPrice } from '@/utils/formatters';
import { FuturesPosition } from '@/types/futures.types';

type Props = {
  freeMargin: number;
  leverage: number;
  refPx: number;
  baseAsset: string;
  initMargin: number;
  estFee: number;
  liqEst: number | null;
  notional: number;
  minNotional: number;
  markPrice: number;
  fundingRate: number | null;
  recentTrades: Array<Record<string, unknown>>;
  position?: FuturesPosition | null;
  onFocusClose?: () => void;
  /** `dock` = fixed strip above submit buttons; `fill` = grows in terminal gap (default). */
  layout?: 'fill' | 'dock';
};

function parseN(v: unknown): number {
  const n = typeof v === 'string' ? parseFloat(v) : Number(v);
  return Number.isFinite(n) ? n : 0;
}

function fmtN(v: number, dp = 2): string {
  return Number.isFinite(v) ? v.toFixed(dp) : '—';
}

function tradeSide(t: Record<string, unknown>): 'buy' | 'sell' {
  const s = String(t.side ?? '').toLowerCase();
  if (s === 'buy' || s === 'long') return 'buy';
  return 'sell';
}

function StatCell({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <View style={styles.statCell}>
      <Text style={styles.statLbl} numberOfLines={1}>{label}</Text>
      <Text style={[styles.statVal, accent ? { color: accent } : null]} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

export default function FuturesTerminalFill({
  freeMargin,
  leverage,
  refPx,
  baseAsset,
  initMargin,
  estFee,
  liqEst,
  notional,
  minNotional,
  markPrice,
  fundingRate,
  recentTrades,
  position,
  onFocusClose,
  layout = 'fill',
}: Props) {
  const docked = layout === 'dock';
  const maxSize = refPx > 0 && leverage > 0 && freeMargin > 0
    ? (freeMargin * leverage) / refPx
    : 0;

  const tape = useMemo(
    () => recentTrades.slice(0, docked ? 0 : 6),
    [recentTrades, docked],
  );

  const posQty = position
    ? Math.abs(parseN((position as any).qty ?? (position as any).size))
    : 0;
  const posPnl = position ? parseN((position as any).unrealized_pnl) : 0;
  const posLong = position
    ? (position.side === 'long' || (position as any).side === 'buy')
    : false;

  return (
    <View style={[styles.wrap, docked && styles.wrapDock]}>
      {position && posQty > 0 ? (
        <TouchableOpacity
          style={[styles.posCard, docked && styles.posCardDock]}
          activeOpacity={0.85}
          onPress={onFocusClose}
        >
          <View style={styles.posTop}>
            <Text style={[styles.posSide, { color: posLong ? Colors.buyGreen : Colors.sellRed }]}>
              {posLong ? 'LONG' : 'SHORT'}
            </Text>
            <Text style={styles.posQty}>{fmtN(posQty, 4)} {baseAsset}</Text>
            <Text style={[styles.posPnl, { color: posPnl >= 0 ? Colors.buyGreen : Colors.sellRed }]}>
              {posPnl >= 0 ? '+' : ''}{fmtN(posPnl, 2)} USDT
            </Text>
          </View>
          {!docked ? <Text style={styles.posHint}>Tap to switch to Close</Text> : null}
        </TouchableOpacity>
      ) : null}

      <View style={[styles.summaryCard, docked && styles.summaryCardDock]}>
        <Text style={styles.sectionTitle}>Order estimate</Text>
        <View style={styles.statGrid}>
          <StatCell
            label="Max size"
            value={maxSize > 0 ? `${fmtN(maxSize, 4)} ${baseAsset}` : '—'}
          />
          <StatCell
            label="Est. margin"
            value={initMargin > 0 ? `${fmtN(initMargin, 2)} USDT` : freeMargin > 0 ? `${fmtN(freeMargin, 2)} avbl` : '—'}
            accent={initMargin > freeMargin ? Colors.sellRed : Colors.goldLight}
          />
          <StatCell
            label="Est. liq."
            value={liqEst != null && liqEst > 0 ? formatPrice(liqEst) : '—'}
            accent={Colors.warning}
          />
          <StatCell
            label="Est. fee"
            value={estFee > 0 ? `${fmtN(estFee, 4)} USDT` : '—'}
          />
        </View>
        {notional > 0 && notional < minNotional ? (
          <Text style={styles.warn}>Min notional {minNotional.toFixed(2)} USDT</Text>
        ) : null}
        {fundingRate != null ? (
          <Text style={styles.fundingLine}>
            Funding {fundingRate >= 0 ? '+' : ''}{(fundingRate * 100).toFixed(4)}%
            {markPrice > 0 ? ` · Mark ${formatPrice(markPrice)}` : ''}
          </Text>
        ) : null}
      </View>

      {!docked && tape.length > 0 ? (
        <View style={styles.tapeCard}>
          <Text style={styles.sectionTitle}>Live trades</Text>
          {tape.map((t, i) => {
            const buy = tradeSide(t) === 'buy';
            const px = parseN(t.price);
            const q = parseN(t.qty ?? t.quantity ?? t.size);
            return (
              <View key={String(t.id ?? t.trade_id ?? i)} style={styles.tapeRow}>
                <Text style={[styles.tapeSide, { color: buy ? Colors.buyGreen : Colors.sellRed }]}>
                  {buy ? 'B' : 'S'}
                </Text>
                <Text style={styles.tapePx}>{px > 0 ? formatPrice(px) : '—'}</Text>
                <Text style={styles.tapeQty}>{q > 0 ? fmtN(q, 4) : '—'}</Text>
              </View>
            );
          })}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    minHeight: 0,
    marginTop: Spacing[1],
    gap: Spacing[1],
  },
  wrapDock: {
    flex: 0,
    flexGrow: 0,
    flexShrink: 0,
    marginTop: 0,
    marginBottom: 0,
    paddingHorizontal: Spacing[1],
    paddingTop: 4,
    paddingBottom: 4,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Colors.surfaceBorder,
    backgroundColor: Colors.surface,
  },
  posCardDock: {
    paddingVertical: 4,
  },
  summaryCardDock: {
    paddingVertical: 5,
  },
  posCard: {
    backgroundColor: Colors.goldAlpha10,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.goldAlpha30,
    paddingHorizontal: Spacing[2],
    paddingVertical: 6,
  },
  posTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  posSide: {
    fontFamily: FontFamily.bold,
    fontSize: 9,
    letterSpacing: 0.4,
  },
  posQty: {
    flex: 1,
    fontFamily: FontFamily.monoMedium,
    fontSize: FontSize.xs,
    color: Colors.textPrimary,
  },
  posPnl: {
    fontFamily: FontFamily.monoMedium,
    fontSize: FontSize.xs,
  },
  posHint: {
    fontFamily: FontFamily.regular,
    fontSize: 9,
    color: Colors.textMuted,
    marginTop: 2,
  },
  summaryCard: {
    backgroundColor: Colors.surfaceCard,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    paddingHorizontal: Spacing[2],
    paddingVertical: 6,
  },
  tapeCard: {
    flex: 1,
    minHeight: 0,
    backgroundColor: Colors.surfaceCard,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    paddingHorizontal: Spacing[2],
    paddingVertical: 6,
  },
  sectionTitle: {
    fontFamily: FontFamily.semiBold,
    fontSize: 9,
    color: Colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginBottom: 4,
  },
  statGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
  },
  statCell: {
    width: '48%',
    flexGrow: 1,
    paddingVertical: 3,
  },
  statLbl: {
    fontFamily: FontFamily.regular,
    fontSize: 9,
    color: Colors.textMuted,
  },
  statVal: {
    fontFamily: FontFamily.monoMedium,
    fontSize: FontSize.xs,
    color: Colors.textPrimary,
    marginTop: 1,
  },
  warn: {
    fontFamily: FontFamily.medium,
    fontSize: 9,
    color: Colors.warning,
    marginTop: 4,
  },
  fundingLine: {
    fontFamily: FontFamily.mono,
    fontSize: 9,
    color: Colors.textSecondary,
    marginTop: 4,
  },
  tapeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 2,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.surfaceBorder,
  },
  tapeSide: {
    width: 14,
    fontFamily: FontFamily.bold,
    fontSize: 9,
  },
  tapePx: {
    flex: 1,
    fontFamily: FontFamily.monoMedium,
    fontSize: FontSize.xs,
    color: Colors.textPrimary,
  },
  tapeQty: {
    fontFamily: FontFamily.mono,
    fontSize: FontSize.xs,
    color: Colors.textMuted,
    textAlign: 'right',
    minWidth: 52,
  },
});
