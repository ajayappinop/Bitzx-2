/**
 * Order book — WebView depth ladder (TradingView-chart pattern).
 * Data from orderBookFeed.service (WS-first + REST seed) — renderer stays off the React tree.
 */
import React from 'react';
import { StyleSheet } from 'react-native';
import type { OrderBook as OrderBookType } from '../../types/market.types';
import TerminalOrderBookWebView from '../trading/TerminalOrderBookWebView';

interface Props {
  orderBook: OrderBookType;
  currentPrice?: number | string;
  maxRows?: number;
  compact?: boolean;
  variant?: 'default' | 'terminal';
  priceUp?: boolean;
  onPriceClick?: (price: string) => void;
  hideDepthFooter?: boolean;
  loading?: boolean;
  longColor?: string;
  longDim?: string;
  fairPrice?: number | string | null;
}

export default function OrderBook(props: Props) {
  return (
    <TerminalOrderBookWebView
      {...props}
      style={props.variant === 'terminal' ? styles.terminal : styles.card}
    />
  );
}

const styles = StyleSheet.create({
  terminal: {
    flex: 1,
    minHeight: 0,
  },
  card: {
    flex: 1,
    minHeight: 200,
  },
});
