import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { WalletStackParamList } from './types';
import WalletScreen from '../screens/wallet/WalletScreen';
import DepositScreen from '../screens/wallet/DepositScreen';
import WithdrawScreen from '../screens/wallet/WithdrawScreen';
import TransactionsScreen from '../screens/wallet/TransactionsScreen';
import InrDepositScreen from '../screens/inr/InrDepositScreen';
import InrDepositsHistoryScreen from '../screens/inr/InrDepositsHistoryScreen';
import InrWithdrawScreen from '../screens/inr/InrWithdrawScreen';
import InrWithdrawalsHistoryScreen from '../screens/inr/InrWithdrawalsHistoryScreen';
import InrHistoryDetailScreen from '../screens/inr/InrHistoryDetailScreen';

const Stack = createNativeStackNavigator<WalletStackParamList>();

export default function WalletNavigator() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="WalletHome" component={WalletScreen} />
      <Stack.Screen name="Deposit" component={DepositScreen} />
      <Stack.Screen name="Withdraw" component={WithdrawScreen} />
      <Stack.Screen name="Transactions" component={TransactionsScreen} />
      <Stack.Screen name="InrDeposit" component={InrDepositScreen} />
      <Stack.Screen name="InrDepositsHistory" component={InrDepositsHistoryScreen} />
      <Stack.Screen name="InrWithdraw" component={InrWithdrawScreen} />
      <Stack.Screen name="InrWithdrawalsHistory" component={InrWithdrawalsHistoryScreen} />
      <Stack.Screen name="InrHistoryDetail" component={InrHistoryDetailScreen} />
    </Stack.Navigator>
  );
}
