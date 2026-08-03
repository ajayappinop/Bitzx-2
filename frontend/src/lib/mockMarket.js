/** Internal USDT pairs with client-side mock chart data (not on Binance). */
export const INTERNAL_MOCK_USDT = {
  MIDASUSDT: { base: 'MIDAS', priceUsd: 0.015 },
};

export function isInternalMockUsdtSymbol(symbol) {
  const s = String(symbol || '').toUpperCase();
  return Object.prototype.hasOwnProperty.call(INTERNAL_MOCK_USDT, s);
}

function mockTargetPrice(symbol) {
  const meta = INTERNAL_MOCK_USDT[String(symbol || '').toUpperCase()];
  const px = parseFloat(meta?.priceUsd);
  return Number.isFinite(px) && px > 0 ? px : 0.0001;
}

/** Deterministic pseudo-random in [0, 1) from a string seed. */
function seededUnit(seed) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967296;
}

/**
 * Synthetic OHLCV candles for demo pairs (matches backend listed_trading shape).
 * `time` is unix seconds for lightweight-charts.
 */
export function generateMockUsdtKlines(symbol, interval = '1h', limit = 200) {
  const sym = String(symbol || '').toUpperCase();
  const target = mockTargetPrice(sym);
  const intervalSeconds = {
    '1m': 60, '5m': 300, '15m': 900, '30m': 1800,
    '1h': 3600, '4h': 14400, '1d': 86400,
  }[interval] || 3600;

  const nowTs = Math.floor(Date.now() / 1000);
  const boundary = Math.floor(nowTs / intervalSeconds) * intervalSeconds;
  const candles = [];
  let price = target * 0.92;

  for (let i = limit; i > 0; i -= 1) {
    const t = boundary - i * intervalSeconds;
    const seed = `listed-${sym}-${interval}-${i}`;
    const pct = (seededUnit(seed) - 0.48) * 0.06;
    const close = price * (1 + pct);
    const high = Math.max(price, close) * (1 + seededUnit(`${seed}-h`) * 0.012);
    const low = Math.min(price, close) * (1 - seededUnit(`${seed}-l`) * 0.012);
    const vol = 5000 + seededUnit(`${seed}-v`) * 115000;
    candles.push({
      time: t,
      open: price,
      high,
      low,
      close,
      volume: vol,
    });
    price = close;
  }

  if (candles.length && target > 0) {
    const lastClose = candles[candles.length - 1].close;
    const scale = lastClose ? target / lastClose : 1;
    for (const c of candles) {
      c.open *= scale;
      c.high *= scale;
      c.low *= scale;
      c.close *= scale;
    }
  }

  return candles;
}
