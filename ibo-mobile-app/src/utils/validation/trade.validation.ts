/** Mirrors tradeRules.js from ibo-exchange/src/lib/ */
import { MIN_WALLET_NOTIONAL_USDT } from '../../config/constants';

export function validateSpotOrder(params: {
  symbol: string;
  side: 'buy' | 'sell';
  type: 'limit' | 'market';
  amount: string;
  price: string;
}): Record<string, string> {
  const errors: Record<string, string> = {};
  const amount = parseFloat(params.amount);
  const price = parseFloat(params.price);

  if (!params.amount || isNaN(amount) || amount <= 0) {
    errors.amount = 'Enter a valid amount';
  }
  if (params.type === 'limit') {
    if (!params.price || isNaN(price) || price <= 0) {
      errors.price = 'Enter a valid price';
    }
    if (!isNaN(amount) && !isNaN(price) && amount * price < MIN_WALLET_NOTIONAL_USDT) {
      errors.amount = `Order value must be at least $${MIN_WALLET_NOTIONAL_USDT} USDT`;
    }
  }

  return errors;
}

export function validateFuturesOrder(params: {
  size: string;
  leverage: number;
}): Record<string, string> {
  const errors: Record<string, string> = {};
  const size = parseFloat(params.size);
  if (!params.size || isNaN(size) || size <= 0) {
    errors.size = 'Enter a valid contract size';
  }
  if (params.leverage < 1 || params.leverage > 125) {
    errors.leverage = 'Leverage must be between 1x and 125x';
  }
  return errors;
}
