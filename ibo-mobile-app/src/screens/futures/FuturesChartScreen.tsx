/**
 * Futures chart route — full chart page (maxbyte ChartScreen parity).
 */
import React, { useEffect } from 'react';
import { RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { FuturesStackParamList } from '../../navigation/types';
import ChartScreen from '../trading/ChartScreen';
import { useFutures } from '../../context/FuturesContext';

type Props = {
  navigation: NativeStackNavigationProp<FuturesStackParamList, 'FuturesChart' | 'FullChartView'>;
  route: RouteProp<FuturesStackParamList, 'FuturesChart'>;
};

export default function FuturesChartScreen({ navigation, route }: Props) {
  const { setActiveSymbol, activeSettings } = useFutures();

  useEffect(() => {
    setActiveSymbol(route.params.symbol);
  }, [route.params.symbol, setActiveSymbol]);

  return (
    <ChartScreen
      navigation={navigation as any}
      route={{
        ...route,
        params: {
          ...route.params,
          market: route.params.market ?? 'futures',
          leverage: route.params.leverage ?? activeSettings.leverage,
        },
      } as any}
    />
  );
}
