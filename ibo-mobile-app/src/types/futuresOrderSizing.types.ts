/** How the user sizes futures orders (Binance-style order settings). */
export type FuturesSizingMode = 'amount' | 'cost';

/** Unit when sizing by amount. */
export type FuturesAmountUnit = 'USDT' | 'BASE' | 'CONT';

export type FuturesOrderSizingPrefs = {
  mode: FuturesSizingMode;
  amountUnit: FuturesAmountUnit;
};
