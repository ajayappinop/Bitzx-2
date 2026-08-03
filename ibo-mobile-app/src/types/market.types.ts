export interface MarketRow {
  symbol: string;
  base_asset: string;
  quote_asset: string;
  logo_url?: string;
  last_price: number | string;
  price_change_24h: number | string;
  price_change_pct_24h: number | string;
  volume_24h: number | string;
  high_24h?: number | string;
  low_24h?: number | string;
  market_type?: 'spot' | 'futures' | 'options';
}

export interface Ticker {
  symbol: string;
  price: number | string;
  change: number | string;
  changePct: number | string;
  volume: number | string;
  high?: number | string;
  low?: number | string;
}

export interface Kline {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface OrderBookEntry {
  price: number | string;
  amount: number | string;
  total?: number;
}

export interface OrderBook {
  bids: OrderBookEntry[];
  asks: OrderBookEntry[];
  symbol?: string;
}

export interface RecentTrade {
  id: string;
  price: number | string;
  amount: number | string;
  side: 'buy' | 'sell';
  timestamp: number | string;
}
