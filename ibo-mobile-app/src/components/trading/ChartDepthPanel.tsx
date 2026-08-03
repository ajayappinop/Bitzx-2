/**
 * ChartDepthPanel — mirrored cumulative depth (buy left / sell right).
 * Separator pinned to width/2 so it lines up with the two-column order book below.
 */
import React, { useMemo, memo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Svg, {
  Path,
  Line as SvgLine,
  Text as SvgText,
  Defs,
  LinearGradient,
  Stop,
} from 'react-native-svg';
import { OrderBook as OrderBookType } from '../../types/market.types';
import { Colors, FontFamily, FontSize, Spacing, LayoutColors } from '../../theme';

type Props = {
  orderBook: OrderBookType;
  currentPrice?: number;
  width: number;
  height?: number;
  loading?: boolean;
};

type Pt = { x: number; y: number };

const LEVELS = 100;
const PAD = { left: 0, right: 0, top: 24, bottom: 20 };
const AXIS_FONT = 9;
const AXIS_WHITE = Colors.textPrimary;

/** Monotone cubic-Bezier through sorted points (horizontal tangent at each knot). */
function smoothCurve(points: Pt[]): string {
  if (points.length < 2) return '';
  const f = (n: number) => n.toFixed(1);
  let d = `M ${f(points[0].x)} ${f(points[0].y)}`;
  for (let i = 1; i < points.length; i++) {
    const p0 = points[i - 1];
    const p1 = points[i];
    const cx = ((p0.x + p1.x) / 2).toFixed(1);
    d += ` C ${cx} ${f(p0.y)}, ${cx} ${f(p1.y)}, ${f(p1.x)} ${f(p1.y)}`;
  }
  return d;
}

/** Buy side: left screen edge (high) → separator bottom (pinch). */
function bidAreaPath(topPts: Pt[], baselineY: number): string {
  if (topPts.length < 2) return '';
  const f = (n: number) => n.toFixed(1);
  const left = topPts[0];
  let d = `M ${f(left.x)} ${f(baselineY)} L ${f(left.x)} ${f(left.y)}`;
  for (let i = 1; i < topPts.length; i++) {
    const p0 = topPts[i - 1];
    const p1 = topPts[i];
    const cx = ((p0.x + p1.x) / 2).toFixed(1);
    d += ` C ${cx} ${f(p0.y)}, ${cx} ${f(p1.y)}, ${f(p1.x)} ${f(p1.y)}`;
  }
  d += ' Z';
  return d;
}

/** Sell side: separator bottom → right screen edge (high). */
function askAreaPath(topPts: Pt[], baselineY: number): string {
  if (topPts.length < 2) return '';
  const f = (n: number) => n.toFixed(1);
  const right = topPts[topPts.length - 1];
  let d = smoothCurve(topPts);
  d += ` L ${f(right.x)} ${f(baselineY)} Z`;
  return d;
}

function smoothLinePath(points: Pt[]): string {
  return smoothCurve(points);
}

/** Keep curve monotone in X; prefer higher depth (lower y) on duplicates. */
function dedupeTopPts(pts: Pt[]): Pt[] {
  if (pts.length <= 1) return pts;
  const out: Pt[] = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const prev = out[out.length - 1];
    const cur = pts[i];
    if (Math.abs(cur.x - prev.x) < 0.5) {
      if (cur.y < prev.y) out[out.length - 1] = cur;
    } else {
      out.push(cur);
    }
  }
  return out;
}

function fmtAxisPrice(p: number): string {
  if (!Number.isFinite(p) || p <= 0) return '—';
  if (p >= 1000) return p.toFixed(2);
  if (p >= 1) return p.toFixed(4);
  if (p >= 0.01) return p.toFixed(5);
  return p.toPrecision(4);
}

function fmtDepth(v: number): string {
  if (!Number.isFinite(v) || v <= 0) return '0';
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(3)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(3)}K`;
  return v.toFixed(2);
}

function ChartDepthPanelInner({
  orderBook,
  currentPrice,
  width,
  height = 148,
  loading = false,
}: Props) {
  const model = useMemo(() => {
    const rawBids = [...(orderBook.bids ?? [])]
      .map((b) => ({ p: parseFloat(String(b.price)), a: parseFloat(String(b.amount)) }))
      .filter((x) => Number.isFinite(x.p) && x.p > 0 && Number.isFinite(x.a) && x.a > 0);

    const rawAsks = [...(orderBook.asks ?? [])]
      .map((a) => ({ p: parseFloat(String(a.price)), a: parseFloat(String(a.amount)) }))
      .filter((x) => Number.isFinite(x.p) && x.p > 0 && Number.isFinite(x.a) && x.a > 0);

    if (rawBids.length === 0 && rawAsks.length === 0) return null;

    const bids = rawBids.sort((a, b) => b.p - a.p).slice(0, LEVELS);
    const asks = rawAsks.sort((a, b) => a.p - b.p).slice(0, LEVELS);

    const bestBid = bids[0]?.p ?? 0;
    const bestAsk = asks[0]?.p ?? 0;
    const mid = currentPrice && currentPrice > 0
      ? currentPrice
      : bestBid && bestAsk
        ? (bestBid + bestAsk) / 2
        : bestBid || bestAsk;

    const minBid = bids.length ? bids[bids.length - 1].p : bestBid;
    const maxAsk = asks.length ? asks[asks.length - 1].p : bestAsk;

    /* Centre matches 50% of panel width (= order book column divider below) */
    const centerX = width / 2;
    const leftX = PAD.left;
    const rightX = width;
    const chartH = height - PAD.top - PAD.bottom;
    const baseY = PAD.top + chartH;
    const plotH = chartH;
    const xLabelY = height - 4;

    const bidToX = (p: number) => {
      if (bestBid <= minBid) return leftX;
      const t = (bestBid - p) / (bestBid - minBid);
      return centerX - t * (centerX - leftX);
    };
    const askToX = (p: number) => {
      if (maxAsk <= bestAsk) return rightX;
      const t = (p - bestAsk) / (maxAsk - bestAsk);
      return centerX + t * (rightX - centerX);
    };

    let totalBidCum = 0;
    let totalAskCum = 0;
    for (const b of bids) totalBidCum += b.a;
    for (const a of asks) totalAskCum += a.a;
    const maxDepth = Math.max(totalBidCum, totalAskCum, 1);
    const toY = (cum: number) => baseY - (cum / maxDepth) * plotH;

    /* Buy curve: left edge (max depth) → slopes down → separator bottom */
    const bidInterior: Pt[] = [];
    let bidCum = 0;
    for (const b of bids) {
      bidCum += b.a;
      const x = bidToX(b.p);
      if (x > leftX + 1 && x < centerX - 1) {
        bidInterior.push({ x, y: toY(bidCum) });
      }
    }
    bidInterior.sort((a, b) => a.x - b.x);
    const bidTop = dedupeTopPts([
      { x: leftX, y: toY(totalBidCum) },
      ...bidInterior,
      { x: centerX, y: baseY },
    ]);

    /* Sell curve: separator bottom → slopes up → right edge (max depth) */
    const askInterior: Pt[] = [];
    let askCum = 0;
    for (const a of asks) {
      askCum += a.a;
      const x = askToX(a.p);
      if (x > centerX + 1 && x < rightX - 1) {
        askInterior.push({ x, y: toY(askCum) });
      }
    }
    askInterior.sort((a, b) => a.x - b.x);
    const askTop = dedupeTopPts([
      { x: centerX, y: baseY },
      ...askInterior,
      { x: rightX, y: toY(totalAskCum) },
    ]);

    const yTicks = [0.2, 0.4, 0.6, 0.8, 1].map((f) => ({
      y: toY(maxDepth * f),
      label: fmtDepth(maxDepth * f),
    }));

    return {
      bidArea: bidTop.length > 1 ? bidAreaPath(bidTop, baseY) : '',
      askArea: askTop.length > 1 ? askAreaPath(askTop, baseY) : '',
      bidLine: bidTop.length > 1 ? smoothLinePath(bidTop) : '',
      askLine: askTop.length > 1 ? smoothLinePath(askTop) : '',
      centerX,
      baseY,
      plotH,
      xLabelY,
      yTicks,
      bestBid,
      bestAsk,
      minBid,
      maxAsk,
      width,
    };
  }, [orderBook, currentPrice, width, height]);

  if (loading && !model) {
    return (
      <View style={[styles.wrap, { width, height }]}>
        <Text style={styles.emptyText}>Depth loading…</Text>
      </View>
    );
  }

  if (!model) {
    return (
      <View style={[styles.wrap, { width, height }]}>
        <Text style={styles.emptyText}>Depth loading…</Text>
      </View>
    );
  }

  const {
    bidArea, askArea, bidLine, askLine, centerX, baseY, plotH, xLabelY, yTicks,
    bestBid, bestAsk, minBid, maxAsk, width: plotW,
  } = model;

  return (
    <View style={[styles.wrap, { width, height }]}>
      <View style={styles.legend}>
        <View style={styles.legendItem}>
          <View style={[styles.legendSwatch, { backgroundColor: LayoutColors.marketUp }]} />
          <Text style={styles.legendText}>Buy</Text>
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.legendSwatch, { backgroundColor: LayoutColors.marketDown }]} />
          <Text style={styles.legendText}>Sell</Text>
        </View>
      </View>

      <Svg width={width} height={height} style={StyleSheet.absoluteFill}>
        <Defs>
          <LinearGradient id="bidDepthGrad" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={LayoutColors.marketUp} stopOpacity="0.55" />
            <Stop offset="1" stopColor={LayoutColors.marketUp} stopOpacity="0.08" />
          </LinearGradient>
          <LinearGradient id="askDepthGrad" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={LayoutColors.marketDown} stopOpacity="0.55" />
            <Stop offset="1" stopColor={LayoutColors.marketDown} stopOpacity="0.08" />
          </LinearGradient>
        </Defs>

        {[0.2, 0.4, 0.6, 0.8].map((frac) => {
          const y = baseY - plotH * frac;
          return (
            <SvgLine
              key={`g-${frac}`}
              x1={PAD.left}
              y1={y}
              x2={plotW}
              y2={y}
              stroke={LayoutColors.cardAlt}
              strokeWidth={0.5}
            />
          );
        })}

        {bidArea ? <Path d={bidArea} fill="url(#bidDepthGrad)" /> : null}
        {askArea ? <Path d={askArea} fill="url(#askDepthGrad)" /> : null}
        {bidLine ? (
          <Path d={bidLine} fill="none" stroke={LayoutColors.marketUp} strokeWidth={1.75} strokeLinejoin="round" strokeLinecap="round" />
        ) : null}
        {askLine ? (
          <Path d={askLine} fill="none" stroke={LayoutColors.marketDown} strokeWidth={1.75} strokeLinejoin="round" strokeLinecap="round" />
        ) : null}

        <SvgLine
          x1={centerX}
          y1={PAD.top}
          x2={centerX}
          y2={baseY}
          stroke={Colors.surfaceBorder}
          strokeWidth={1}
          opacity={0.9}
        />

        {/* Y-axis volume labels — drawn last so they sit on top of the fill */}
        {yTicks.map((t) => (
          <SvgText
            key={`y-${t.label}`}
            x={plotW - 3}
            y={t.y + 3}
            fontSize={AXIS_FONT}
            fill={AXIS_WHITE}
            textAnchor="end"
            fontFamily={FontFamily.mono}
          >
            {t.label}
          </SvgText>
        ))}

        {/* X-axis price labels */}
        <SvgText
          x={PAD.left + 1}
          y={xLabelY}
          fontSize={AXIS_FONT}
          fill={AXIS_WHITE}
          textAnchor="start"
          fontFamily={FontFamily.mono}
        >
          {fmtAxisPrice(minBid)}
        </SvgText>
        {bestBid > 0 ? (
          <SvgText
            x={centerX - 3}
            y={xLabelY}
            fontSize={AXIS_FONT}
            fill={LayoutColors.marketUp}
            textAnchor="end"
            fontFamily={FontFamily.mono}
          >
            {fmtAxisPrice(bestBid)}
          </SvgText>
        ) : null}
        {bestAsk > 0 ? (
          <SvgText
            x={centerX + 3}
            y={xLabelY}
            fontSize={AXIS_FONT}
            fill={LayoutColors.marketDown}
            textAnchor="start"
            fontFamily={FontFamily.mono}
          >
            {fmtAxisPrice(bestAsk)}
          </SvgText>
        ) : null}
        <SvgText
          x={plotW - 3}
          y={xLabelY}
          fontSize={AXIS_FONT}
          fill={AXIS_WHITE}
          textAnchor="end"
          fontFamily={FontFamily.mono}
        >
          {fmtAxisPrice(maxAsk)}
        </SvgText>
      </Svg>
    </View>
  );
}

const ChartDepthPanel = memo(ChartDepthPanelInner);
export default ChartDepthPanel;

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: Colors.surface,
    position: 'relative',
  },
  legend: {
    position: 'absolute',
    top: Spacing[1],
    left: 0,
    right: 0,
    zIndex: 2,
    flexDirection: 'row',
    justifyContent: 'center',
    gap: Spacing[5],
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  legendSwatch: {
    width: 10,
    height: 10,
    borderRadius: 2,
  },
  legendText: {
    fontFamily: FontFamily.medium,
    fontSize: FontSize.xs,
    color: AXIS_WHITE,
  },
  emptyText: {
    fontFamily: FontFamily.regular,
    fontSize: FontSize.xs,
    color: Colors.textMuted,
  },
});
