export type OrderSide = 'buy' | 'sell';
export type OrderType = 'limit' | 'market';
export type OrderStatus =
  | 'open'
  | 'filled'
  | 'partially_filled'
  | 'cancelled'
  | 'rejected';

export interface Order {
  order_id: string;
  symbol: string;
  side: OrderSide;
  type: OrderType;
  amount: number;
  price?: number;
  filled_amount?: number;
  avg_fill_price?: number;
  status: OrderStatus;
  created_at: string;
  updated_at?: string;
  fee?: number;
  fee_asset?: string;
}

export interface Trade {
  trade_id: string;
  order_id: string;
  symbol: string;
  side: OrderSide;
  amount: number;
  price: number;
  fee: number;
  fee_asset: string;
  created_at: string;
  pnl?: number;
}

export interface SpotPosition {
  symbol: string;
  side: OrderSide;
  amount: number;
  avg_entry_price: number;
  current_price?: number;
  unrealized_pnl?: number;
  realized_pnl?: number;
}

export interface PlaceOrderPayload {
  symbol: string;
  side: OrderSide;
  type: OrderType;
  amount: number;
  price?: number;
}
