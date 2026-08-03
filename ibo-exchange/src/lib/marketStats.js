import { num } from '@/lib/marketFormat';

function hasPositivePrice(market) {
  return num(market?.price) > 0;
}

/**
 * True when 24h % / volume / heatmap should use this row (live Binance, platform Delta, or backend mock).
 * Excludes flat Binance fallbacks and catalog stubs with no price.
 */
export function hasLive24hStats(market) {
  if (!market) return false;
  const statsSource = String(market.stats_source || '');
  const src = String(market.source || '');

  if (statsSource === 'binance') return true;
  if (statsSource === 'fallback') return false;
  if (statsSource === 'internal' && market.symbol === 'IBOUSDT') return true;

  if (statsSource === 'listed' || statsSource === 'internal_mock') {
    return (
      market.priceChangePercent != null
      && market.priceChangePercent !== ''
      && hasPositivePrice(market)
    );
  }

  if (market.source === 'binance' && statsSource !== 'fallback') return true;

  // Listed pairs merged from catalog may omit stats_source; trust live OHLC from WS when priced.
  if (
    (src === 'listed' || market.is_listed) &&
    market.priceChangePercent != null &&
    market.priceChangePercent !== '' &&
    hasPositivePrice(market)
  ) {
    return true;
  }
  return false;
}

/** USDT spot row (excludes Delta-quoted pairs that duplicate the same base in heatmaps). */
export function isUsdtSpotMarket(market) {
  if (!market) return false;
  const sym = (market.symbol || '').toUpperCase();
  const quote = (market.quote || market.quoteAsset || '').toUpperCase();
  if (quote === 'IBO' || sym.endsWith('IBO')) return false;
  if (quote === 'USDT') return true;
  return sym.endsWith('USDT');
}

/** Markets safe for gainers, losers, heatmap, and volume breadth. */
export function marketsWithLiveStats(markets, { usdtSpotOnly = false } = {}) {
  let list = (markets || []).filter(hasLive24hStats);
  if (usdtSpotOnly) list = list.filter(isUsdtSpotMarket);
  return list;
}

export function computeMarketBreadth(markets, { usdtSpotOnly = false } = {}) {
  const live = marketsWithLiveStats(markets, { usdtSpotOnly });
  const pcts = live.map((m) => num(m.priceChangePercent));
  const sorted = [...live].sort((a, b) => num(b.priceChangePercent) - num(a.priceChangePercent));
  return {
    liveMarkets: live,
    minPct: pcts.length ? Math.min(...pcts) : 0,
    maxPct: pcts.length ? Math.max(...pcts) : 0,
    gainers: sorted.filter((m) => num(m.priceChangePercent) > 0).slice(0, 6),
    losers: [...live]
      .sort((a, b) => num(a.priceChangePercent) - num(b.priceChangePercent))
      .filter((m) => num(m.priceChangePercent) < 0)
      .slice(0, 6),
    totalQuoteVol: live.reduce((s, m) => s + num(m.quoteVolume), 0),
    upCount: live.filter((m) => num(m.priceChangePercent) > 0).length,
    downCount: live.filter((m) => num(m.priceChangePercent) < 0).length,
    pairCount: live.length,
  };
}
