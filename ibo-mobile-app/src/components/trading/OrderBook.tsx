/**
 * OrderBook — web-parity version
 *
 * Features:
 *  - Clickable rows → triggers onPriceClick (to pre-fill TradeForm)
 *  - Spread + mid price row (tappable → fills trade form with mid price)
 *  - Depth visualisation bars (per-row + cumulative)
 *  - compact prop for side-by-side layout
 */
import React, { useMemo, useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { OrderBook as OrderBookType } from '../../types/market.types';
import { Colors, FontFamily, FontSize, Spacing, Radius } from '../../theme';
import { formatPrice, formatAmount } from '../../utils/formatters';

interface Props {
  orderBook: OrderBookType;
  currentPrice?: number | string;
  /** Quote asset for column header (USDT, IBO, …) */
  quoteAsset?: string;
  maxRows?: number;
  /** Narrow two-column mode for side-by-side layout */
  compact?: boolean;
  /** Taller rows — futures / full-width book */
  expanded?: boolean;
  /** Stretch to fill parent pane height (split trade layout) */
  fill?: boolean;
  /** Tighter rows when filling split pane — more depth levels, less padding */
  dense?: boolean;
  /** Called when a price row or mid row is tapped — string price for the trade form */
  onPriceClick?: (price: string) => void;
}

function fmtTotal(v: number): string {
  if (!Number.isFinite(v)) return '—';
  if (v >= 1e6) return (v / 1e6).toFixed(2) + 'M';
  if (v >= 1e3) return (v / 1e3).toFixed(2) + 'K';
  return v >= 1 ? v.toFixed(2) : v.toFixed(4);
}

function OrderBook({
  orderBook, currentPrice, quoteAsset = 'USDT', maxRows = 10, compact = false, expanded = false,
  fill = false,
  dense = false,
  onPriceClick,
}: Props) {
  /** Full-width futures book — never mix with compact split pane */
  const useExpanded = expanded && !compact;
  const useCompact = compact || (fill && !useExpanded);
  const useDense = dense && fill && useCompact;
  const rowStyle = useExpanded
    ? styles.rowExpanded
    : (useDense ? styles.rowDense : (useCompact ? styles.rowCompact : styles.row));
  const priceStyle = useExpanded ? styles.priceExpanded : (useCompact ? styles.priceCompact : styles.price);
  const amountStyle = useExpanded ? styles.amountExpanded : (useCompact ? styles.amountCompact : styles.amount);
  const midRowStyle = useCompact ? styles.midRowCompact : styles.midRow;
  const quoteLabel = quoteAsset === 'USDT' ? 'USDT' : quoteAsset;
  const asks = useMemo(() => (orderBook.asks ?? []).slice(0, maxRows), [orderBook.asks, maxRows]);
  const bids = useMemo(() => (orderBook.bids ?? []).slice(0, maxRows), [orderBook.bids, maxRows]);

  // cumulative totals for depth bars
  const maxAskTotal = useMemo(() => {
    let cum = 0;
    return asks.reduce((max, a) => { cum += parseFloat(String(a.amount)); return Math.max(max, cum); }, 0);
  }, [asks]);

  const maxBidTotal = useMemo(() => {
    let cum = 0;
    return bids.reduce((max, b) => { cum += parseFloat(String(b.amount)); return Math.max(max, cum); }, 0);
  }, [bids]);

  // Spread calculation from top of book
  const topAsk = useMemo(() => {
    const sorted = (orderBook.asks ?? []).slice().sort((a, b) => parseFloat(String(a.price)) - parseFloat(String(b.price)));
    return sorted[0] ? parseFloat(String(sorted[0].price)) : null;
  }, [orderBook.asks]);

  const topBid = useMemo(() => {
    const sorted = (orderBook.bids ?? []).slice().sort((a, b) => parseFloat(String(b.price)) - parseFloat(String(a.price)));
    return sorted[0] ? parseFloat(String(sorted[0].price)) : null;
  }, [orderBook.bids]);

  const midPrice = useMemo(() => {
    const lp = parseFloat(String(currentPrice ?? ''));
    if (Number.isFinite(lp) && lp > 0) return lp;
    if (topAsk && topBid) return (topAsk + topBid) / 2;
    return topAsk ?? topBid ?? null;
  }, [topAsk, topBid, currentPrice]);

  const spread    = topAsk && topBid ? topAsk - topBid : null;
  const spreadPct = topBid && spread ? (spread / topBid) * 100 : null;

  const handleMidTap = useCallback(() => {
    if (midPrice && midPrice > 0) onPriceClick?.(midPrice.toFixed(midPrice >= 1000 ? 2 : 6));
  }, [midPrice, onPriceClick]);

  const renderRow = useCallback((
    entry: { price: number | string; amount: number | string },
    side: 'ask' | 'bid',
    cumTotal: number,
    maxTotal: number,
    notionalTotal: number,
    maxNotional: number,
    idx: number,
  ) => {
    const pct       = maxTotal > 0 ? (cumTotal / maxTotal) * 100 : 0;
    const thisPct   = maxNotional > 0 ? (parseFloat(String(entry.price)) * parseFloat(String(entry.amount)) / maxNotional) * 100 : 0;
    const isAsk     = side === 'ask';
    const color     = isAsk ? Colors.sellRed : Colors.buyGreen;
    const bgDim     = isAsk ? Colors.sellRedDim : Colors.buyGreenDim;
    const bgDarker  = isAsk ? 'rgba(239,68,68,0.07)' : 'rgba(34,197,94,0.07)';

    return (
      <TouchableOpacity
        key={`${side}-${idx}-${entry.price ?? ''}`}
        style={rowStyle}
        onPress={() => onPriceClick?.(formatPrice(entry.price))}
        activeOpacity={0.6}
      >
        {/* Cumulative depth bar */}
        <View style={[
          styles.depthBarCum,
          {
            width: `${pct}%`,
            maxWidth: '100%',
            backgroundColor: bgDarker,
            left: isAsk ? undefined : 0,
            right: isAsk ? 0 : undefined,
          },
        ]} />
        {/* Per-row bar */}
        <View style={[
          styles.depthBarRow,
          {
            width: `${thisPct}%`,
            maxWidth: '100%',
            backgroundColor: bgDim,
            left: isAsk ? undefined : 0,
            right: isAsk ? 0 : undefined,
          },
        ]} />
        <View style={styles.priceCell}>
          <Text
            style={[priceStyle, { color }]}
            numberOfLines={1}
            ellipsizeMode="tail"
            adjustsFontSizeToFit={useCompact}
            minimumFontScale={0.75}
          >
            {formatPrice(entry.price)}
          </Text>
        </View>
        <View style={styles.qtyCell}>
          <Text style={amountStyle} numberOfLines={1} ellipsizeMode="tail">
            {formatAmount(entry.amount, useCompact ? 3 : 4)}
          </Text>
        </View>
        {!compact && (
          <Text style={[styles.total, { zIndex: 2 }]}>
            {fmtTotal(parseFloat(String(entry.price)) * parseFloat(String(entry.amount)))}
          </Text>
        )}
      </TouchableOpacity>
    );
  }, [useCompact, rowStyle, priceStyle, amountStyle, onPriceClick]);

  // Compute running max notional for bar scaling
  const maxAskNotional = useMemo(() => {
    return asks.reduce((mx, a) => Math.max(mx, parseFloat(String(a.price)) * parseFloat(String(a.amount))), 0);
  }, [asks]);
  const maxBidNotional = useMemo(() => {
    return bids.reduce((mx, b) => Math.max(mx, parseFloat(String(b.price)) * parseFloat(String(b.amount))), 0);
  }, [bids]);
  const maxN = Math.max(maxAskNotional, maxBidNotional, 1);

  let askCum = 0;
  let bidCum = 0;

  const containerStyle = [
    compact ? styles.containerCompact : styles.container,
    fill && styles.containerFill,
  ];

  const bookBody = (
    <>
      {!useDense && (
        <View style={styles.sideLabel}>
          <Text style={[styles.sideLabelTxt, { color: Colors.sellRed + 'CC' }]}>▼ Asks</Text>
        </View>
      )}

      <View style={fill ? styles.asksBlockFill : undefined}>
        {[...asks].reverse().map((a, i) => {
          askCum += parseFloat(String(a.amount ?? 0));
          return renderRow(a, 'ask', askCum, maxAskTotal, parseFloat(String(a.price)) * parseFloat(String(a.amount ?? 0)), maxN, i);
        })}
      </View>

      {/* Mid price + spread row */}
      <TouchableOpacity style={midRowStyle} onPress={handleMidTap} activeOpacity={0.75}>
        <View style={styles.midLeft}>
          <Text
            style={[styles.midPrice, useCompact && styles.midPriceCompact]}
            numberOfLines={1}
            ellipsizeMode="tail"
            adjustsFontSizeToFit={useCompact}
            minimumFontScale={0.8}
          >
            {midPrice ? formatPrice(midPrice) : '—'}
          </Text>
          {!useCompact && <Text style={styles.midTag}>MID</Text>}
        </View>
        {useCompact ? (
          spreadPct != null && spreadPct > 0 ? (
            <Text style={styles.spreadPctCompact} numberOfLines={1}>
              {spreadPct.toFixed(2)}%
            </Text>
          ) : null
        ) : (
          <View style={styles.midRight}>
            {spread != null && spread > 0 && (
              <Text style={styles.spreadTxt} numberOfLines={1}>Spread {formatPrice(spread)}</Text>
            )}
            {spreadPct != null && spreadPct > 0 && (
              <Text style={styles.spreadPct}>{spreadPct.toFixed(3)}%</Text>
            )}
          </View>
        )}
      </TouchableOpacity>

      {!useDense && (
        <View style={styles.sideLabel}>
          <Text style={[styles.sideLabelTxt, { color: Colors.buyGreen + 'CC' }]}>▲ Bids</Text>
        </View>
      )}

      <View style={fill ? styles.bidsBlockFill : undefined}>
        {bids.map((b, i) => {
          bidCum += parseFloat(String(b.amount ?? 0));
          return renderRow(b, 'bid', bidCum, maxBidTotal, parseFloat(String(b.price)) * parseFloat(String(b.amount ?? 0)), maxN, i);
        })}
      </View>
    </>
  );

  return (
    <View style={containerStyle}>
      {/* Header */}
      <View style={useCompact ? styles.headerCompact : styles.header}>
        <Text style={[styles.colHead, styles.colHeadPrice]} numberOfLines={1} ellipsizeMode="tail">
          {useCompact ? 'Price' : `Price (${quoteLabel})`}
        </Text>
        <Text style={[styles.colHead, styles.colHeadQty]} numberOfLines={1}>Qty</Text>
        {!useCompact && <Text style={[styles.colHead, styles.colRight]}>Total</Text>}
      </View>

      {fill ? (
        <View style={styles.bodyFill}>{bookBody}</View>
      ) : (
        bookBody
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: Colors.surfaceCard, borderWidth: 1,
    borderColor: Colors.surfaceBorder, borderRadius: Radius.lg,
    overflow: 'hidden',
  },
  containerCompact: {
    backgroundColor: Colors.surfaceCard, borderWidth: 1,
    borderColor: Colors.surfaceBorder, borderRadius: Radius.lg,
    overflow: 'hidden',
  },
  containerFill: {
    flex: 1,
    alignSelf: 'stretch',
    minWidth: 0,
  },
  bodyFill: {
    flex: 1,
    minHeight: 0,
    overflow: 'hidden',
    justifyContent: 'center',
  },
  asksBlockFill: {
    flexGrow: 1,
    flexShrink: 1,
    minHeight: 0,
    overflow: 'hidden',
    justifyContent: 'flex-end',
  },
  bidsBlockFill: {
    flexGrow: 1,
    flexShrink: 1,
    minHeight: 0,
    overflow: 'hidden',
    justifyContent: 'flex-start',
  },
  header: {
    flexDirection: 'row', paddingHorizontal: Spacing[3], paddingVertical: Spacing[2],
    borderBottomWidth: 1, borderBottomColor: Colors.surfaceBorder,
    backgroundColor: Colors.surfaceHover,
  },
  headerCompact: {
    flexDirection: 'row', paddingHorizontal: Spacing[2], paddingVertical: Spacing[2],
    borderBottomWidth: 1, borderBottomColor: Colors.surfaceBorder,
    backgroundColor: Colors.surfaceHover,
  },
  colHead:      { fontFamily: FontFamily.medium, fontSize: 9, color: Colors.textMuted },
  colHeadPrice: { flex: 1, minWidth: 0, flexShrink: 1 },
  colHeadQty:   { flex: 1, minWidth: 0, textAlign: 'right' },
  colRight:     { textAlign: 'right' },
  priceCell: {
    flex: 1,
    minWidth: 0,
    flexShrink: 1,
    zIndex: 2,
    justifyContent: 'center',
  },
  qtyCell: {
    flex: 1,
    minWidth: 0,
    flexShrink: 1,
    zIndex: 2,
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  sideLabel: { paddingHorizontal: Spacing[2], paddingTop: 4, paddingBottom: 2, overflow: 'hidden' },
  sideLabelTxt: { fontFamily: FontFamily.bold, fontSize: 9, textTransform: 'uppercase', letterSpacing: 0.5 },
  row: {
    flexDirection: 'row', paddingHorizontal: Spacing[3], paddingVertical: 3,
    position: 'relative', overflow: 'hidden',
  },
  rowCompact: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing[2],
    paddingVertical: 2,
    position: 'relative',
    overflow: 'hidden',
    minHeight: 20,
  },
  rowDense: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing[2],
    paddingVertical: 1,
    position: 'relative',
    overflow: 'hidden',
    minHeight: 17,
  },
  rowExpanded: {
    flexDirection: 'row', paddingHorizontal: Spacing[3], paddingVertical: 6,
    position: 'relative', overflow: 'hidden',
    minHeight: 28,
  },
  priceExpanded: { fontFamily: FontFamily.mono, fontSize: FontSize.sm },
  amountExpanded: {
    fontFamily: FontFamily.mono, fontSize: FontSize.sm,
    color: Colors.textSecondary, textAlign: 'right',
  },
  depthBarCum: { position: 'absolute', top: 0, bottom: 0, opacity: 1 },
  depthBarRow: { position: 'absolute', top: 0, bottom: 0 },
  price:        { fontFamily: FontFamily.mono, fontSize: FontSize.xs },
  priceCompact: { fontFamily: FontFamily.mono, fontSize: 10 },
  amount:        { fontFamily: FontFamily.mono, fontSize: FontSize.xs, color: Colors.textSecondary, textAlign: 'right' },
  amountCompact: { fontFamily: FontFamily.mono, fontSize: 10, color: Colors.textSecondary, textAlign: 'right' },
  total:         { fontFamily: FontFamily.mono, fontSize: FontSize.xs, color: Colors.textMuted, flex: 1, textAlign: 'right' },

  midRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: Spacing[3], paddingVertical: Spacing[2],
    backgroundColor: Colors.surfaceHover,
    borderTopWidth: 1, borderBottomWidth: 1, borderColor: Colors.surfaceBorder,
    overflow: 'hidden',
  },
  midRowCompact: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing[2],
    paddingVertical: Spacing[1],
    backgroundColor: Colors.surfaceHover,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: Colors.surfaceBorder,
    overflow: 'hidden',
    minHeight: 0,
  },
  midLeft:   { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: Spacing[1] },
  midRight:  { flexShrink: 0, alignItems: 'flex-end', maxWidth: '48%' },
  midPrice:  { fontFamily: FontFamily.bold, fontSize: FontSize.md, color: Colors.goldLight, flexShrink: 1 },
  midPriceCompact: { fontSize: FontSize.sm },
  spreadPctCompact: { fontFamily: FontFamily.regular, fontSize: 9, color: Colors.textMuted, flexShrink: 0 },
  midTag:    { fontFamily: FontFamily.bold, fontSize: 9, color: Colors.textMuted, backgroundColor: Colors.white05, paddingHorizontal: 4, paddingVertical: 1, borderRadius: 3 },
  spreadTxt: { fontFamily: FontFamily.medium, fontSize: 10, color: Colors.textSecondary },
  spreadPct: { fontFamily: FontFamily.regular, fontSize: 9, color: Colors.textMuted },
});

export default React.memo(OrderBook);
