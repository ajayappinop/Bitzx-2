import { MarketRow } from '../types/market.types';
import { WalletAsset } from '../types/wallet.types';
import { SpotPosition } from '../types/trading.types';
import {
  filterMarketsList,
  marketOverviewStats,
  parseMarketNum,
  pairParts,
} from './markets';

const ALLOC_COLORS = [
  '#0EA4AB',
  '#3b82f6',
  '#22c55e',
  '#a855f7',
  '#f59e0b',
  '#ef4444',
  '#6366f1',
  '#14b8a6',
] as const;

export type AllocationSlice = { asset: string; value: number; color: string };

export function greetingForHour(date = new Date()): string {
  const h = date.getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

/** Live USD price for a wallet asset from the spot market feed. */
export function spotPriceForAsset(
  asset: string,
  markets: Record<string, MarketRow>,
): number {
  const a = asset.toUpperCase();
  if (a === 'USDT') return 1;
  const direct = markets[`${a}USDT`];
  if (direct?.market_type === 'spot' || !direct?.market_type) {
    const px = parseMarketNum(direct?.last_price);
    if (px > 0) return px;
  }
  const match = Object.values(markets).find(
    (m) =>
      (m.market_type ?? 'spot') === 'spot' &&
      (m.base_asset?.toUpperCase() === a || pairParts(m).base.toUpperCase() === a),
  );
  return parseMarketNum(match?.last_price);
}

export function resolveSpotTradeSymbol(
  asset: string,
  markets: Record<string, MarketRow>,
): string | null {
  const a = asset.toUpperCase();
  if (a === 'USDT') return null;
  const sym = `${a}USDT`;
  const row = markets[sym];
  if (row && (row.market_type ?? 'spot') === 'spot') return sym;
  const match = Object.values(markets).find(
    (m) =>
      (m.market_type ?? 'spot') === 'spot' &&
      (m.base_asset?.toUpperCase() === a || pairParts(m).base.toUpperCase() === a),
  );
  return match?.symbol ?? null;
}

export function computePortfolioUsd(
  assets: WalletAsset[],
  markets: Record<string, MarketRow>,
  totalUsdFromApi: string | number,
): number {
  const fromApi = parseMarketNum(totalUsdFromApi);
  if (fromApi > 0) return fromApi;

  return assets.reduce((sum, w) => {
    const usd = parseMarketNum(w.usd_value);
    if (usd > 0) return sum + usd;
    const qty =
      parseMarketNum(w.available_balance) + parseMarketNum(w.locked_balance);
    if (qty <= 0) return sum;
    return sum + qty * spotPriceForAsset(w.asset, markets);
  }, 0);
}

export function computeUnrealizedPnL(positions: SpotPosition[]) {
  let unrealized = 0;
  let invested = 0;
  positions.forEach((p) => {
    unrealized += parseMarketNum(p.unrealized_pnl);
    invested += parseMarketNum(p.avg_entry_price) * parseMarketNum(p.amount);
  });
  const pct = invested > 1e-8 ? (unrealized / invested) * 100 : 0;
  return { unrealized, invested, pct };
}

export function walletAllocation(
  assets: WalletAsset[],
  markets: Record<string, MarketRow>,
): AllocationSlice[] {
  const rows = assets
    .map((w, i) => {
      const qty =
        parseMarketNum(w.available_balance) + parseMarketNum(w.locked_balance);
      if (qty <= 1e-12) return null;
      const usd =
        parseMarketNum(w.usd_value) > 0
          ? parseMarketNum(w.usd_value)
          : qty * spotPriceForAsset(w.asset, markets);
      if (usd <= 1e-6) return null;
      return {
        asset: w.asset,
        value: usd,
        color: ALLOC_COLORS[i % ALLOC_COLORS.length],
      };
    })
    .filter(Boolean) as AllocationSlice[];

  return rows.sort((a, b) => b.value - a.value);
}

export function topSpotMarkets(
  marketList: string[],
  markets: Record<string, MarketRow>,
  limit = 6,
): MarketRow[] {
  return filterMarketsList(marketList, markets, {
    typeTab: 'spot',
    category: 'volume',
    search: '',
  }).slice(0, limit);
}

export function marketPulseRow(
  marketList: string[],
  markets: Record<string, MarketRow>,
): MarketRow | null {
  return topSpotMarkets(marketList, markets, 1)[0] ?? null;
}

export function defaultTradeTarget(
  assets: WalletAsset[],
  marketList: string[],
  markets: Record<string, MarketRow>,
): { symbol: string; market: 'spot' } | null {
  const held = [...assets]
    .filter((a) => parseMarketNum(a.available_balance) > 0)
    .sort(
      (a, b) =>
        parseMarketNum(b.usd_value) - parseMarketNum(a.usd_value) ||
        parseMarketNum(b.available_balance) - parseMarketNum(a.available_balance),
    );

  for (const w of held) {
    const sym = resolveSpotTradeSymbol(w.asset, markets);
    if (sym) return { symbol: sym, market: 'spot' };
  }

  const top = marketPulseRow(marketList, markets);
  if (top) return { symbol: top.symbol, market: 'spot' };
  return null;
}

export function sortedWalletAssets(
  assets: WalletAsset[],
  markets: Record<string, MarketRow>,
): WalletAsset[] {
  return [...assets]
    .filter(
      (a) =>
        parseMarketNum(a.available_balance) + parseMarketNum(a.locked_balance) > 0,
    )
    .sort((a, b) => {
      const usdA =
        parseMarketNum(a.usd_value) > 0
          ? parseMarketNum(a.usd_value)
          : (parseMarketNum(a.available_balance) + parseMarketNum(a.locked_balance)) *
            spotPriceForAsset(a.asset, markets);
      const usdB =
        parseMarketNum(b.usd_value) > 0
          ? parseMarketNum(b.usd_value)
          : (parseMarketNum(b.available_balance) + parseMarketNum(b.locked_balance)) *
            spotPriceForAsset(b.asset, markets);
      return usdB - usdA;
    });
}

export function spotMarketOverview(
  marketList: string[],
  markets: Record<string, MarketRow>,
) {
  const rows = filterMarketsList(marketList, markets, {
    typeTab: 'spot',
    category: 'all',
    search: '',
  });
  return marketOverviewStats(rows);
}
