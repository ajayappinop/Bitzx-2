/**
 * Spot chart route — full chart page (maxbyte ChartScreen parity).
 */
import React from 'react';
import { RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { TradingStackParamList } from '../../navigation/types';
import ChartScreen from './ChartScreen';

type Props = {
  navigation: NativeStackNavigationProp<TradingStackParamList, 'SpotChart' | 'FullChartView'>;
  route: RouteProp<TradingStackParamList, 'SpotChart'>;
};

export default function SpotChartScreen({ navigation, route }: Props) {
  return (
    <ChartScreen
      navigation={navigation as any}
      route={{
        ...route,
        params: {
          ...route.params,
          market: route.params.market ?? 'spot',
        },
      } as any}
    />
  );
}
