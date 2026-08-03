/** IBO fee estimates — mirrors ibo-exchange/src/lib/iboFee.js */

export const FEE_ASSET = 'IBO';
export const DEFAULT_IBO_PRICE_USDT = 0.4523;

export function roundIbo(n: number): number {
  return Math.round(Number(n) * 1e8) / 1e8;
}

export function estimateIboFee(opts: {
  quoteNotional: number;
  feeRate: number;
  quoteAsset?: string;
  iboPriceUsdt?: number;
}): number {
  const q = Math.max(Number(opts.quoteNotional) || 0, 0);
  const r = Math.max(Number(opts.feeRate) || 0, 0);
  if (q <= 0 || r <= 0) return 0;
  if (String(opts.quoteAsset || 'USDT').toUpperCase() === 'IBO') {
    return roundIbo(q * r);
  }
  const px = Math.max(Number(opts.iboPriceUsdt) || 0, 1e-12);
  return roundIbo((q * r) / px);
}

export function formatIboFee(feeIbo: number, maxDecimals = 4): string {
  const v = Number(feeIbo) || 0;
  if (v <= 0) return `0 ${FEE_ASSET}`;
  const s = v.toFixed(maxDecimals).replace(/\.?0+$/, '');
  return `${s} ${FEE_ASSET}`;
}

export function feeRatesForVenue(
  config: Record<string, unknown> | null | undefined,
  venue = 'spot',
): { maker: number; taker: number } {
  const block = config?.[venue] as { maker_fee_rate?: number; taker_fee_rate?: number } | undefined;
  if (block) {
    return {
      maker: Number(block.maker_fee_rate) || 0,
      taker: Number(block.taker_fee_rate) || 0,
    };
  }
  return {
    maker: Number(config?.maker_fee_rate) || 0.001,
    taker: Number(config?.taker_fee_rate) || 0.001,
  };
}
