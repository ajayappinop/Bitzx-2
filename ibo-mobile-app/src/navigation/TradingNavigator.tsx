import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { TradingStackParamList } from './types';
import MarketsScreen from '../screens/markets/MarketsScreen';
import TradeScreen from '../screens/trading/TradeScreen';
import SpotChartScreen from '../screens/trading/SpotChartScreen';
import FullChartScreen from '../screens/trading/FullChartScreen';
import IBOMarketsScreen from '../screens/ibo/IBOMarketsScreen';

const Stack = createNativeStackNavigator<TradingStackParamList>();

/**
 * Used by the Markets tab — starts at market list.
 * Both "Trade" (legacy) and "TradePair" are registered so that any call
 * to either name resolves correctly within this stack.
 */
export default function TradingNavigator() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="MarketsList" component={MarketsScreen} />
      <Stack.Screen name="IBOMarkets"  component={IBOMarketsScreen} />
      <Stack.Screen name="Trade"       component={TradeScreen} />
      <Stack.Screen name="TradePair"   component={TradeScreen} />
      <Stack.Screen name="SpotChart"   component={SpotChartScreen} />
      <Stack.Screen name="FullChartView" component={FullChartScreen} options={{ animation: 'slide_from_bottom' }} />
    </Stack.Navigator>
  );
}

/**
 * Used by the Trade tab — starts directly at the trade view for BTC/USDT.
 *
 * "TradePair" is the INITIAL screen to avoid the React Navigation warning:
 *   "Found screens with the same name nested inside one another:
 *    Main > Trade, Main > Trade > Trade"
 *
 * "Trade" is NOT registered here — MarketsScreen always navigates to
 * "TradePair" so there is no need for a secondary "Trade" screen.
 */
export function TradeTabNavigator() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }} initialRouteName="TradePair">
      <Stack.Screen
        name="TradePair"
        component={TradeScreen}
        initialParams={{ symbol: 'BTCUSDT', market: 'spot' }}
      />
      <Stack.Screen name="MarketsList" component={MarketsScreen} />
      <Stack.Screen name="IBOMarkets"  component={IBOMarketsScreen} />
      <Stack.Screen name="SpotChart"   component={SpotChartScreen} />
      <Stack.Screen name="FullChartView" component={FullChartScreen} options={{ animation: 'slide_from_bottom' }} />
    </Stack.Navigator>
  );
}
