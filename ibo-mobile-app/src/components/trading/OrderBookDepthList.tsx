/**
 * Native order-book depth ladder for the chart page (no WebView).
 * Layout mirrors TerminalOrderBookWebView — rows flex to fit the panel height.
 */
import React, { memo, useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import type { OrderBook as OrderBookType } from '../../types/market.types';
import { Colors, FontFamily, FontSize, LayoutColors } from '../../theme';

type Props = {
  orderBook: OrderBookType;
  currentPrice?: number;
  /** Panel height in px — rows are budgeted to fit without overflowing. */
  height: number;
  maxRows?: number;
  priceUp?: boolean;
  fairPrice?: number;
  loading?: boolean;
};

type BookRow = { price: string; amount: string };

const HEADER_H = 24;
const MID_H = 40;
const ROW_MIN = 20;
const ROW_MAX = 26;

function parseNum(v: unknown): number {
  const n = parseFloat(String(v));
  return Number.isFinite(n) ? n : 0;
}

function fmtPrice(p: number): string {
  if (p <= 0) return '—';
  if (p >= 1000) return p.toFixed(2);
  if (p >= 1) return p.toFixed(4);
  return p.toFixed(6);
}

function fmtAmt(a: number): string {
  if (a <= 0) return '—';
  if (a >= 1e6) return `${(a / 1e6).toFixed(2)}M`;
  if (a >= 1e3) return `${(a / 1e3).toFixed(2)}K`;
  return a >= 1 ? a.toFixed(2) : a.toFixed(4);
}

function sortAsks(rows: OrderBookType['asks']): BookRow[] {
  return [...(rows ?? [])]
    .map((r) => ({ price: String(r.price), amount: String(r.amount) }))
    .filter((r) => parseNum(r.price) > 0 && parseNum(r.amount) > 0)
    .sort((a, b) => parseNum(a.price) - parseNum(b.price));
}

function sortBids(rows: OrderBookType['bids']): BookRow[] {
  return [...(rows ?? [])]
    .map((r) => ({ price: String(r.price), amount: String(r.amount) }))
    .filter((r) => parseNum(r.price) > 0 && parseNum(r.amount) > 0)
    .sort((a, b) => parseNum(b.price) - parseNum(a.price));
}

function rowsPerSide(height: number, maxRows: number): number {
  const body = Math.max(0, height - HEADER_H - MID_H);
  const fit = Math.floor(body / 2 / ROW_MIN);
  return Math.max(4, Math.min(maxRows, fit));
}

function buildSide(
  rows: BookRow[],
  side: 'ask' | 'bid',
  limit: number,
): { rows: BookRow[]; maxCum: number; maxNotional: number } {
  let slice = rows.slice(0, limit);
  if (side === 'ask') slice = [...slice].reverse();

  let cum = 0;
  let maxCum = 0;
  let maxNotional = 1;
  for (const r of slice) {
    cum += parseNum(r.amount);
    maxCum = Math.max(maxCum, cum);
    maxNotional = Math.max(maxNotional, parseNum(r.price) * parseNum(r.amount));
  }
  return { rows: slice, maxCum: maxCum || 1, maxNotional };
}

function DepthRow({
  price,
  amount,
  side,
  cum,
  maxCum,
  notional,
  maxNotional,
}: {
  price: string;
  amount: string;
  side: 'ask' | 'bid';
  cum: number;
  maxCum: number;
  notional: number;
  maxNotional: number;
}) {
  const isAsk = side === 'ask';
  const color = isAsk ? LayoutColors.marketDown : LayoutColors.marketUp;
  const cumPct = maxCum > 0 ? (cum / maxCum) * 100 : 0;
  const rowPct = maxNotional > 0 ? (notional / maxNotional) * 100 : 0;
  const cumBg = isAsk ? 'rgba(246,70,93,0.07)' : 'rgba(14,203,129,0.07)';
  const rowBg = isAsk ? 'rgba(246,70,93,0.12)' : 'rgba(14,203,129,0.12)';

  return (
    <View style={styles.row}>
      <View
        style={[
          styles.bar,
          isAsk ? styles.barRight : styles.barLeft,
          { width: `${Math.min(100, cumPct)}%`, backgroundColor: cumBg },
        ]}
      />
      <View
        style={[
          styles.bar,
          isAsk ? styles.barRight : styles.barLeft,
          { width: `${Math.min(100, rowPct)}%`, backgroundColor: rowBg },
        ]}
      />
      <Text style={[styles.price, { color }]} numberOfLines={1}>
        {fmtPrice(parseNum(price))}
      </Text>
      <Text style={styles.amt} numberOfLines={1}>
        {fmtAmt(parseNum(amount))}
      </Text>
    </View>
  );
}

function OrderBookDepthListInner({
  orderBook,
  currentPrice,
  height,
  maxRows = 12,
  priceUp = true,
  fairPrice,
  loading = false,
}: Props) {
  const limit = useMemo(() => rowsPerSide(height, maxRows), [height, maxRows]);

  const model = useMemo(() => {
    const askSide = buildSide(sortAsks(orderBook.asks), 'ask', limit);
    const bidSide = buildSide(sortBids(orderBook.bids), 'bid', limit);

    const topAsk = askSide.rows.length
      ? parseNum(askSide.rows[askSide.rows.length - 1].price)
      : 0;
    const topBid = bidSide.rows.length ? parseNum(bidSide.rows[0].price) : 0;
    const lp = parseNum(currentPrice);
    const mid = lp > 0
      ? lp
      : topAsk && topBid
        ? (topAsk + topBid) / 2
        : topAsk || topBid;

    let spreadText = '';
    if (topAsk > 0 && topBid > 0) {
      const spread = topAsk - topBid;
      const pct = topBid > 0 ? (spread / topBid) * 100 : 0;
      if (pct > 0) spreadText = `Spread ${pct.toFixed(3)}%`;
    }
    if (fairPrice != null && fairPrice > 0) {
      spreadText = `Fair ${fmtPrice(fairPrice)}`;
    }

    return { askSide, bidSide, mid, spreadText };
  }, [orderBook.asks, orderBook.bids, currentPrice, fairPrice, limit]);

  const empty = model.askSide.rows.length === 0 && model.bidSide.rows.length === 0;
  const midColor = priceUp ? LayoutColors.marketUp : LayoutColors.marketDown;

  if (loading && empty) {
    return (
      <View style={[styles.placeholder, { height }]}>
        <Text style={styles.placeholderText}>Loading depth…</Text>
      </View>
    );
  }

  if (empty) {
    return (
      <View style={[styles.placeholder, { height }]}>
        <Text style={styles.placeholderText}>No depth data</Text>
      </View>
    );
  }

  let askCum = 0;
  let bidCum = 0;

  return (
    <View style={[styles.wrap, { height }]}>
      <View style={styles.header}>
        <Text style={styles.hdr}>Price</Text>
        <Text style={[styles.hdr, styles.hdrRight]}>Amount</Text>
      </View>

      <View style={styles.body}>
        <View style={styles.asks}>
          {model.askSide.rows.map((r, i) => {
            askCum += parseNum(r.amount);
            const notional = parseNum(r.price) * parseNum(r.amount);
            return (
              <DepthRow
                key={`a-${r.price}-${i}`}
                price={r.price}
                amount={r.amount}
                side="ask"
                cum={askCum}
                maxCum={model.askSide.maxCum}
                notional={notional}
                maxNotional={model.askSide.maxNotional}
              />
            );
          })}
        </View>

        <View style={styles.mid}>
          <Text style={[styles.midPrice, { color: midColor }]}>
            {model.mid > 0 ? fmtPrice(model.mid) : '—'}
          </Text>
          {model.spreadText ? (
            <Text style={styles.midSub}>{model.spreadText}</Text>
          ) : null}
        </View>

        <View style={styles.bids}>
          {model.bidSide.rows.map((r, i) => {
            bidCum += parseNum(r.amount);
            const notional = parseNum(r.price) * parseNum(r.amount);
            return (
              <DepthRow
                key={`b-${r.price}-${i}`}
                price={r.price}
                amount={r.amount}
                side="bid"
                cum={bidCum}
                maxCum={model.bidSide.maxCum}
                notional={notional}
                maxNotional={model.bidSide.maxNotional}
              />
            );
          })}
        </View>
      </View>
    </View>
  );
}

const OrderBookDepthList = memo(OrderBookDepthListInner);
export default OrderBookDepthList;

const styles = StyleSheet.create({
  wrap: {
    overflow: 'hidden',
    backgroundColor: Colors.surface,
  },
  header: {
    height: HEADER_H,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#1E2329',
  },
  hdr: {
    flex: 1,
    fontFamily: FontFamily.medium,
    fontSize: 9,
    color: Colors.textMuted,
    textTransform: 'uppercase',
  },
  hdrRight: {
    textAlign: 'right',
  },
  body: {
    flex: 1,
    minHeight: 0,
  },
  asks: {
    flex: 1,
    minHeight: 0,
    overflow: 'hidden',
    justifyContent: 'flex-end',
  },
  bids: {
    flex: 1,
    minHeight: 0,
    overflow: 'hidden',
  },
  row: {
    flex: 1,
    minHeight: ROW_MIN,
    maxHeight: ROW_MAX,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    overflow: 'hidden',
  },
  bar: {
    position: 'absolute',
    top: 0,
    bottom: 0,
  },
  barRight: {
    right: 0,
  },
  barLeft: {
    left: 0,
  },
  price: {
    flex: 1,
    fontFamily: FontFamily.medium,
    fontSize: 11,
    zIndex: 1,
  },
  amt: {
    flex: 1,
    textAlign: 'right',
    fontFamily: FontFamily.regular,
    fontSize: 11,
    color: Colors.textPrimary,
    zIndex: 1,
  },
  mid: {
    height: MID_H,
    alignItems: 'center',
    justifyContent: 'center',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: '#1E2329',
    backgroundColor: '#141A22',
  },
  midPrice: {
    fontFamily: FontFamily.semiBold,
    fontSize: 15,
  },
  midSub: {
    fontFamily: FontFamily.regular,
    fontSize: 9,
    color: Colors.textMuted,
    marginTop: 2,
  },
  placeholder: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.surface,
  },
  placeholderText: {
    fontFamily: FontFamily.regular,
    fontSize: FontSize.sm,
    color: Colors.textMuted,
  },
});
