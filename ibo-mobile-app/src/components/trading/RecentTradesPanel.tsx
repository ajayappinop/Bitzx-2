/**
 * RecentTradesPanel — live tape of recent public trades for a symbol.
 * Subscribes to the exchange WebSocket trades stream and highlights:
 *   - Newest trade (brief flash)
 *   - "Your fill" when the price matches a user's filled order
 */
import React, { useEffect, useState, useRef, useCallback } from 'react';
import {
  View, Text, StyleSheet, ActivityIndicator, ScrollView,
} from 'react-native';
import { useSelector } from 'react-redux';
import { RootState } from '../../store';
import { wsService } from '../../services/websocket.service';
import { exchangeWsPath } from '../../config/wsConfig';
import { Colors, FontFamily, FontSize, Spacing, Radius } from '../../theme';

interface Trade {
  id?: string | number;
  tradeId?: string | number;
  price: string | number;
  qty: string | number;
  time: number;
  isBuyerMaker: boolean;
}

interface Props {
  symbol: string;
  maxRows?: number;
}

const fmtP = (n: string | number): string => {
  const v = parseFloat(String(n));
  if (!Number.isFinite(v)) return '—';
  if (v >= 10000) return v.toLocaleString('en-US', { maximumFractionDigits: 2 });
  if (v >= 1) return v.toFixed(4);
  return v.toFixed(6);
};

const fmtQ = (n: string | number): string => {
  const v = parseFloat(String(n));
  if (!Number.isFinite(v)) return '—';
  if (v >= 1e6) return (v / 1e6).toFixed(2) + 'M';
  if (v >= 1e3) return (v / 1e3).toFixed(2) + 'K';
  return v.toFixed(3);
};

const fmtTime = (ms: number): string =>
  new Date(ms).toLocaleTimeString('en-US', {
    hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit',
  });

export default function RecentTradesPanel({ symbol, maxRows = 30 }: Props) {
  const [trades, setTrades] = useState<Trade[]>([]);
  const [loading, setLoading] = useState(true);
  const [newestId, setNewestId] = useState<string | number | null>(null);
  const prevTopId = useRef<string | number | null>(null);

  const orderHistory = useSelector((s: RootState) => s.trading.orderHistory);

  const myFilledPrices = useRef(new Set<string>());
  useEffect(() => {
    myFilledPrices.current = new Set(
      orderHistory
        .filter((o) => o.status === 'filled' && o.avg_fill_price)
        .map((o) => fmtP(o.avg_fill_price!)),
    );
  }, [orderHistory]);

  const handleMessage = useCallback((data: unknown) => {
    try {
      const j = data as { type?: string; trades?: Trade[] };
      if (j.type === 'exchange_trades' && Array.isArray(j.trades) && j.trades.length) {
        const slice = j.trades.slice(0, maxRows);
        setLoading(false);
        setTrades(slice);
        const topId = slice[0]?.id ?? slice[0]?.tradeId ?? null;
        if (topId != null && topId !== prevTopId.current) {
          prevTopId.current = topId;
          setNewestId(topId);
          setTimeout(() => setNewestId(null), 900);
        }
      } else if (j.type === 'exchange_trades') {
        setLoading(false);
      }
    } catch {
      /* ignore */
    }
  }, [maxRows]);

  useEffect(() => {
    setLoading(true);
    setTrades([]);
    prevTopId.current = null;

    const qs = new URLSearchParams({ symbol, limit: String(maxRows) });
    const url = exchangeWsPath(`/api/ws/exchange/trades?${qs.toString()}`);

    wsService.subscribe(url, handleMessage);
    return () => wsService.unsubscribe(url);
  }, [symbol, maxRows, handleMessage]);

  if (loading) {
    return (
      <View style={styles.loader}>
        <ActivityIndicator size="small" color={Colors.gold} />
      </View>
    );
  }

  if (!trades.length) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyText}>No recent trades</Text>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      {/* Column headers */}
      <View style={styles.headerRow}>
        <Text style={[styles.colPrice, styles.hdr]}>Price</Text>
        <Text style={[styles.colQty, styles.hdr]}>Qty</Text>
        <Text style={[styles.colTime, styles.hdr]}>Time</Text>
      </View>

      <ScrollView
        style={styles.scroll}
        showsVerticalScrollIndicator={false}
        nestedScrollEnabled
      >
        {trades.map((t, i) => {
          const isBuy    = !t.isBuyerMaker;
          const priceStr = fmtP(t.price);
          const id       = t.id ?? t.tradeId ?? i;
          const isNewest = id === newestId;
          const isMyFill = myFilledPrices.current.has(priceStr);

          return (
            <View
              key={String(id)}
              style={[
                styles.row,
                isNewest ? (isBuy ? styles.flashBuy : styles.flashSell) : null,
                isMyFill && !isNewest ? styles.myFill : null,
              ]}
            >
              <Text style={[styles.colPrice, { color: isBuy ? Colors.buyGreen : Colors.sellRed, fontFamily: FontFamily.mono, fontSize: FontSize.xs }]}>
                {priceStr}
              </Text>
              <Text style={[styles.colQty, styles.qty]}>
                {fmtQ(t.qty)}
              </Text>
              <View style={[styles.colTime, styles.timeRow]}>
                <Text style={styles.time}>{fmtTime(t.time)}</Text>
                {isMyFill && (
                  <View style={styles.youBadge}>
                    <Text style={styles.youText}>You</Text>
                  </View>
                )}
              </View>
            </View>
          );
        })}
        <View style={{ height: Spacing[3] }} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    minHeight: 0,
  },
  loader: {
    paddingVertical: Spacing[6],
    alignItems: 'center',
  },
  empty: {
    paddingVertical: Spacing[6],
    alignItems: 'center',
  },
  emptyText: {
    fontFamily: FontFamily.regular,
    fontSize: FontSize.xs,
    color: Colors.textMuted,
  },
  scroll: {
    flex: 1,
  },
  headerRow: {
    flexDirection: 'row',
    paddingHorizontal: Spacing[2],
    paddingVertical: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.surfaceBorder,
    marginBottom: 2,
  },
  hdr: {
    fontFamily: FontFamily.medium,
    fontSize: 10,
    color: Colors.textMuted,
    // colPrice/colQty/colTime already set flex; these are Text overrides only
  },
  row: {
    flexDirection: 'row',
    paddingHorizontal: Spacing[2],
    paddingVertical: 5,
    borderRadius: 2,
  },
  flashBuy:  { backgroundColor: Colors.buyGreen + '28' },
  flashSell: { backgroundColor: Colors.sellRed  + '28' },
  myFill:    { backgroundColor: Colors.gold     + '18' },
  colPrice: { flex: 2, fontFamily: FontFamily.mono, fontSize: FontSize.xs },
  colQty:   { flex: 1.5 },
  colTime:  { flex: 2.5 },
  qty: {
    fontFamily: FontFamily.mono,
    fontSize: FontSize.xs,
    color: Colors.textSecondary,
    textAlign: 'right',
  },
  timeRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: 4,
  },
  time: {
    fontFamily: FontFamily.mono,
    fontSize: 10,
    color: Colors.textDisabled,
  },
  youBadge: {
    backgroundColor: Colors.goldAlpha15,
    borderRadius: 3,
    paddingHorizontal: 3,
    paddingVertical: 1,
  },
  youText: {
    fontFamily: FontFamily.bold,
    fontSize: 8,
    color: Colors.goldLight,
    textTransform: 'uppercase',
  },
});
