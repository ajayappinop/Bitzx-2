import { useMemo } from 'react';
import { useSelector } from 'react-redux';
import { RootState } from '../store';
import { resolveLogoUrlForSymbol } from '../utils/coinLogoResolve';

/** Listed-token logo from market catalog (spot row, futures/options inherit via base). */
export function useCoinLogoUrl(symbol: string): string | undefined {
  const markets = useSelector((s: RootState) => s.market.markets);
  return useMemo(() => resolveLogoUrlForSymbol(symbol, markets), [symbol, markets]);
}

/** Prefer explicit catalog URL, then market store. */
export function useResolvedCoinLogo(symbol: string, explicit?: string): string | undefined {
  const fromMarkets = useCoinLogoUrl(symbol);
  const trimmed = explicit?.trim();
  return trimmed || fromMarkets;
}
