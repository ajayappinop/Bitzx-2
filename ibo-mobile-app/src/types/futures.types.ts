export type MarginMode = 'cross' | 'isolated';
export type FuturesSide = 'long' | 'short';

export interface FuturesSymbol {
  symbol: string;
  base_asset: string;
  quote_asset: string;
  binance_symbol?: string;
  min_leverage: number;
  max_leverage: number;
  tick_size: number;
  min_qty: number;
  is_active: boolean;
}

export interface FuturesPosition {
  position_id: string;
  symbol: string;
  side: FuturesSide;
  size: number;
  entry_price: number;
  mark_price?: number;
  liq_price?: number;
  margin: number;
  leverage: number;
  margin_mode: MarginMode;
  unrealized_pnl?: number;
  realized_pnl?: number;
  created_at: string;
}

export interface FuturesOrder {
  order_id: string;
  symbol: string;
  side: FuturesSide;
  type: 'limit' | 'market';
  size: number;
  price?: number;
  filled_size?: number;
  leverage: number;
  margin_mode: MarginMode;
  status: string;
  created_at: string;
}

export interface FuturesWallet {
  balance?: number;
  available?: number;
  locked?: number;
  wallet_balance?: number;
  free_margin?: number;
  used_margin?: number;
  margin_balance?: number;
  unrealized_pnl?: number;
}

export interface FuturesSettings {
  leverage: number;
  margin_mode: MarginMode;
  max_leverage?: number;
}

export interface FuturesMarkPrice {
  symbol: string;
  mark_price: number;
  index_price?: number;
  funding_rate?: number;
  next_funding_time?: string;
}
