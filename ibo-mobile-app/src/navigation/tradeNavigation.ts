import type { NavigationProp, ParamListBase } from '@react-navigation/native';
import { toFuturesSymbol, toExchangeSymbol } from '../utils/tradeSymbols';
import { prefetchOrderBookForMarket } from '../services/orderBookFeed.service';

export type TradeDestinationMarket = 'spot' | 'futures' | 'options';

/**
 * Navigate to the correct bottom tab for spot, options, or futures trading.
 */
export function navigateToTradeMarket(
  navigation: NavigationProp<ParamListBase>,
  symbol: string,
  market: TradeDestinationMarket = 'spot',
) {
  const tabNav = navigation.getParent() ?? navigation;

  if (market === 'futures' || market === 'options') {
    const params =
      market === 'options'
        ? { symbol: toExchangeSymbol(symbol), market: 'options' as const }
        : { symbol: toFuturesSymbol(symbol), market: 'futures' as const };
    prefetchOrderBookForMarket(params.symbol, market);
    tabNav.navigate('Futures', {
      screen: 'DerivativesPair',
      params,
    });
    return;
  }

  const spotSym = toExchangeSymbol(symbol);
  prefetchOrderBookForMarket(spotSym, 'spot');
  tabNav.navigate('Trade', {
    screen: 'TradePair',
    params: { symbol: spotSym, market: 'spot' },
  });
}
