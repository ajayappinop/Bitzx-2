/** Client-side IBO ↔ USDT swap preview — mirrors backend/services/ibo_swap.py */
import type { IboSwapConfig, IboSwapDirection, IboSwapQuote } from '../types/wallet.types';

function swapUsdtNotional(direction: IboSwapDirection, fromAmount: number, priceUsdt: number): number {
  const px  = Math.max(priceUsdt || 0, 1e-12);
  const amt = Math.max(fromAmount || 0, 0);
  return direction === 'ibo_to_usdt' ? amt * px : amt;
}

function computeSwapPlatformFeeIbo(
  direction: IboSwapDirection,
  fromAmount: number,
  priceUsdt: number,
  swapFeeRate: number,
  swapFeeIboFixed: number,
  iboPriceUsdt: number,
): number {
  const rate    = Math.max(swapFeeRate || 0, 0);
  const fixed   = Math.max(swapFeeIboFixed || 0, 0);
  const notional = swapUsdtNotional(direction, fromAmount, priceUsdt);
  const feeUsdt  = rate > 0 ? notional * rate : 0;
  const px       = Math.max(iboPriceUsdt || 0, 1e-12);
  const feeFromRate = feeUsdt > 0 ? feeUsdt / px : 0;
  return Math.round((feeFromRate + fixed) * 1e8) / 1e8;
}

function estimateTradingFeeIbo(
  direction: IboSwapDirection,
  fromAmount: number,
  priceUsdt: number,
  takerFeeRate: number,
  iboPriceUsdt: number,
): number {
  const notional = swapUsdtNotional(direction, fromAmount, priceUsdt);
  const feeUsdt  = notional * Math.max(takerFeeRate || 0, 0);
  const px       = Math.max(iboPriceUsdt || 0, 1e-12);
  return feeUsdt > 0 ? Math.round((feeUsdt / px) * 1e8) / 1e8 : 0;
}

export function buildLocalSwapQuote(
  direction: IboSwapDirection,
  amount: number,
  priceUsdt: number,
  config: IboSwapConfig,
  availableFrom: number,
): IboSwapQuote {
  const px        = Math.max(priceUsdt || 0, 1e-12);
  const amt       = Math.max(amount || 0, 0);
  const fromAsset = direction === 'ibo_to_usdt' ? 'IBO' : 'USDT';
  const toAsset   = direction === 'ibo_to_usdt' ? 'USDT' : 'IBO';
  const toAmount  = direction === 'ibo_to_usdt' ? amt * px : amt / px;
  const iboPx     = (config.ibo_price_usdt > 0 ? config.ibo_price_usdt : px);

  const platformFee = computeSwapPlatformFeeIbo(
    direction, amt, px, config.swap_fee_rate, config.swap_fee_ibo_fixed, iboPx,
  );
  const tradingFee = estimateTradingFeeIbo(direction, amt, px, config.taker_fee_rate, iboPx);
  const feeTotal   = Math.round((platformFee + tradingFee) * 1e8) / 1e8;

  return {
    direction,
    symbol:                    'IBOUSDT',
    from_asset:                fromAsset,
    to_asset:                  toAsset,
    from_amount:               Math.round(amt * 1e8) / 1e8,
    to_amount_estimated:       Math.round(toAmount * 1e8) / 1e8,
    price_usdt:                Math.round(px * 1e8) / 1e8,
    fee_ibo_estimated:         platformFee,
    trading_fee_ibo_estimated: tradingFee,
    fee_ibo_total:             feeTotal,
    swap_fee_rate:             config.swap_fee_rate,
    swap_fee_ibo_fixed:        config.swap_fee_ibo_fixed,
    fee_asset:                 'IBO',
    available_from:            availableFrom,
  };
}
