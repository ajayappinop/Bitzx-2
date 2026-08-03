import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { RouteProp } from '@react-navigation/native';
import { FuturesStackParamList } from './types';
import { FuturesProvider } from '../context/FuturesContext';
import FuturesTradeScreen from '../screens/futures/FuturesTradeScreen';
import OptionsTradeScreen from '../screens/options/OptionsTradeScreen';
import FuturesChartScreen from '../screens/futures/FuturesChartScreen';
import FullChartScreen from '../screens/trading/FullChartScreen';

const Stack = createNativeStackNavigator<FuturesStackParamList>();

function DerivativesPairScreen({
  route,
  navigation,
}: {
  route: RouteProp<FuturesStackParamList, 'DerivativesPair'>;
  navigation: unknown;
}) {
  const market = route.params?.market ?? 'futures';
  if (market === 'options') {
    return <OptionsTradeScreen route={route} />;
  }
  return <FuturesTradeScreen route={route} />;
}

export default function FuturesTabNavigator() {
  return (
    <FuturesProvider>
      <Stack.Navigator screenOptions={{ headerShown: false }} initialRouteName="DerivativesPair">
        <Stack.Screen
          name="DerivativesPair"
          component={DerivativesPairScreen}
          initialParams={{ symbol: 'BTCUSDT', market: 'futures' }}
        />
        <Stack.Screen name="FuturesChart" component={FuturesChartScreen} />
        <Stack.Screen name="FullChartView" component={FullChartScreen} options={{ animation: 'slide_from_bottom' }} />
      </Stack.Navigator>
    </FuturesProvider>
  );
}

export { FuturesTabNavigator };
