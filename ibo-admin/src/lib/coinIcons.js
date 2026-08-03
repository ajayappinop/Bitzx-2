/** CDN icons for admin UI (aligned with ibo-exchange `marketApi` + stablecoins). */

export const COIN_ICONS = {
  USDT: 'https://assets.coingecko.com/coins/images/325/small/Tether.png',
  IBO: '/ibo-logo.png',
  BTC: 'https://assets.coingecko.com/coins/images/1/small/bitcoin.png',
  ETH: 'https://assets.coingecko.com/coins/images/279/small/ethereum.png',
  BNB: 'https://assets.coingecko.com/coins/images/825/small/bnb-icon2_2x.png',
  SOL: 'https://assets.coingecko.com/coins/images/4128/small/solana.png',
  XRP: 'https://assets.coingecko.com/coins/images/44/small/xrp-symbol-white-128.png',
  DOGE: 'https://assets.coingecko.com/coins/images/5/small/dogecoin.png',
  ADA: 'https://assets.coingecko.com/coins/images/975/small/cardano.png',
  POL: 'https://assets.coingecko.com/coins/images/32440/small/polygon.png',
  MATIC: 'https://assets.coingecko.com/coins/images/32440/small/polygon.png',
  AVAX: 'https://assets.coingecko.com/coins/images/12559/small/Avalanche_Circle_RedWhite_Trans.png',
  DOT: 'https://assets.coingecko.com/coins/images/12171/small/polkadot.png',
  LINK: 'https://assets.coingecko.com/coins/images/877/small/chainlink-new-logo.png',
  LTC: 'https://assets.coingecko.com/coins/images/2/small/litecoin.png',
};

export function iconUrlForAsset(asset) {
  if (asset == null || asset === '') return null;
  return COIN_ICONS[String(asset).toUpperCase()] ?? null;
}

/** e.g. BTCUSDT → BTC icon */
export function iconUrlForSymbol(symbol) {
  if (symbol == null || symbol === '') return null;
  const s = String(symbol).toUpperCase();
  if (!s.endsWith('USDT')) return null;
  const base = s.slice(0, -4);
  return iconUrlForAsset(base);
}
