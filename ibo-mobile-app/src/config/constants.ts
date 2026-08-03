/** Trading pairs supported — mirrors PAIRS from marketApi.js */
export const PAIRS = [
  'IBOUSDT',
  'BTCUSDT',
  'ETHUSDT',
  'BNBUSDT',
  'SOLUSDT',
  'XRPUSDT',
  // IBO-quoted pairs
  'BTCIBO',
  'ETHIBO',
  'BNBIBO',
  'SOLIBO',
  'XRPIBO',
  'DOGEIBO',
] as const;

/** IBO-quoted pairs (quote asset = IBO) */
export const IBO_QUOTED_PAIRS = [
  'BTCIBO', 'ETHIBO', 'BNBIBO', 'SOLIBO', 'XRPIBO', 'DOGEIBO',
] as const;

/** Pairs with dedicated backend mock market engine (visualization only). */
export const IBO_MOCK_MARKET_SYMBOLS = new Set(['IBOUSDT', 'BTCIBO', 'ETHIBO', 'SOLIBO']);

/** Matches ibo-exchange wallet UI minimum notional messaging */
export const MIN_WALLET_NOTIONAL_USDT = 10;

export const FUTURES_DEFAULT_SYMBOL = 'BTCUSDT-PERP';
export const OPTIONS_DEFAULT_UNDERLYING = 'BTCUSDT';

/** CDN base for coin icons — mirrors coinIcons.js */
export const COIN_ICON_CDN = 'https://cdn.jsdelivr.net/gh/atomiclabs/cryptocurrency-icons@1a63530/128/color';

export const KYC_STEPS = ['Personal', 'Document', 'Review'] as const;

export const ORDER_TYPES = {
  LIMIT: 'limit',
  MARKET: 'market',
} as const;

export const ORDER_SIDES = {
  BUY: 'buy',
  SELL: 'sell',
} as const;

export const WS_RECONNECT_DELAY_MS = 3000;
export const API_TIMEOUT_MS = 12000;
