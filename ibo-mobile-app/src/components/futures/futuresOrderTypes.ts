export type FuturesOrderType =
  | 'limit'
  | 'market'
  | 'stop_limit'
  | 'stop_market'
  | 'take_profit';

export type FuturesOrderTypeMeta = {
  key: FuturesOrderType;
  label: string;
  subtitle: string;
};

/** Labels match the futures form dropdown (source of truth). */
export const FUTURES_ORDER_TYPE_OPTIONS: FuturesOrderTypeMeta[] = [
  {
    key: 'limit',
    label: 'Limit',
    subtitle: 'Buy or sell at your price or better',
  },
  {
    key: 'market',
    label: 'Market',
    subtitle: 'Buy or sell immediately at the best available price',
  },
  {
    key: 'stop_limit',
    label: 'Stop limit',
    subtitle: 'When stop price is hit, places a limit order',
  },
  {
    key: 'stop_market',
    label: 'Stop market',
    subtitle: 'When stop price is hit, places a market order',
  },
  {
    key: 'take_profit',
    label: 'Take profit',
    subtitle: 'When trigger price is hit, takes profit on your position',
  },
];

export const FUTURES_ORDER_TYPE_LABEL: Record<FuturesOrderType, string> =
  Object.fromEntries(
    FUTURES_ORDER_TYPE_OPTIONS.map((o) => [o.key, o.label]),
  ) as Record<FuturesOrderType, string>;
