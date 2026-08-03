/** TP/SL trigger modes — inline futures bracket fields. */
export type TpSlTriggerMode = 'pnl_ratio' | 'pnl_usdt' | 'trigger_price';

export type TpSlLeg = 'tp' | 'sl';

export type TpSlModeOption = {
  key: TpSlTriggerMode;
  title: string;
  subtitle: string;
  shortLabel: string;
};

export const TP_SL_MODE_OPTIONS: TpSlModeOption[] = [
  {
    key: 'pnl_ratio',
    title: 'PnL Ratio (%)',
    subtitle: 'Use the estimated PnL ratio as the TP/SL trigger condition',
    shortLabel: 'PnL Ratio',
  },
  {
    key: 'pnl_usdt',
    title: 'PnL (USDT)',
    subtitle: 'Use the estimated PnL amount as the TP/SL trigger condition',
    shortLabel: 'PnL',
  },
  {
    key: 'trigger_price',
    title: 'Trigger Price (USDT)',
    subtitle: "Use the trading pair's trigger price as the TP/SL trigger condition",
    shortLabel: 'Price',
  },
];

export const TP_SL_MODE_SHORT: Record<TpSlTriggerMode, string> = Object.fromEntries(
  TP_SL_MODE_OPTIONS.map((o) => [o.key, o.shortLabel]),
) as Record<TpSlTriggerMode, string>;

export function tpSlFieldLabel(leg: TpSlLeg, mode: TpSlTriggerMode): string {
  if (mode === 'pnl_ratio') return leg === 'tp' ? 'TP(%)' : '- SL(%)';
  if (mode === 'pnl_usdt') return leg === 'tp' ? 'TP(USDT)' : '- SL(USDT)';
  return leg === 'tp' ? 'TP Price' : '- SL Price';
}

export function tpSlFieldPlaceholder(mode: TpSlTriggerMode): string {
  if (mode === 'pnl_ratio') return '0';
  if (mode === 'pnl_usdt') return '0.00';
  return '0.00';
}

type ResolveParams = {
  mode: TpSlTriggerMode;
  rawValue: number;
  leg: TpSlLeg;
  /** Order side: buy = long, sell = short */
  side: 'buy' | 'sell';
  entryPrice: number;
  quantity: number;
  leverage: number;
};

/**
 * Convert inline TP/SL field value to a USDT trigger price for bracket orders.
 * PnL ratio uses ROI on margin: price move % = ratio / leverage.
 */
export function resolveBracketTriggerPrice({
  mode,
  rawValue,
  leg,
  side,
  entryPrice,
  quantity,
  leverage,
}: ResolveParams): number | null {
  if (!Number.isFinite(rawValue) || rawValue <= 0) return null;
  if (!Number.isFinite(entryPrice) || entryPrice <= 0) return null;
  if (!Number.isFinite(quantity) || quantity <= 0) return null;

  const lev = Math.max(1, leverage || 1);
  const isLong = side === 'buy';
  const isTp = leg === 'tp';

  if (mode === 'trigger_price') {
    return rawValue;
  }

  if (mode === 'pnl_usdt') {
    const delta = rawValue / quantity;
    if (isLong) {
      return isTp ? entryPrice + delta : entryPrice - delta;
    }
    return isTp ? entryPrice - delta : entryPrice + delta;
  }

  // pnl_ratio — % return on margin
  const moveFrac = rawValue / 100 / lev;
  if (isLong) {
    return isTp ? entryPrice * (1 + moveFrac) : entryPrice * (1 - moveFrac);
  }
  return isTp ? entryPrice * (1 - moveFrac) : entryPrice * (1 + moveFrac);
}

/** Sanity-check TP/SL price direction vs entry for the position side. */
export function isValidBracketPrice(
  leg: TpSlLeg,
  side: 'buy' | 'sell',
  entryPrice: number,
  triggerPrice: number,
): boolean {
  if (!Number.isFinite(triggerPrice) || triggerPrice <= 0) return false;
  if (!Number.isFinite(entryPrice) || entryPrice <= 0) return false;
  const isLong = side === 'buy';
  if (leg === 'tp') {
    return isLong ? triggerPrice > entryPrice : triggerPrice < entryPrice;
  }
  return isLong ? triggerPrice < entryPrice : triggerPrice > entryPrice;
}

export function formatBracketPrice(price: number, tickSize = 0.01): string {
  if (!Number.isFinite(price) || price <= 0) return '';
  const dp = tickSize >= 1 ? 0 : tickSize >= 0.1 ? 1 : tickSize >= 0.01 ? 2 : tickSize >= 0.001 ? 3 : 6;
  return price.toFixed(dp).replace(/\.?0+$/, '');
}
