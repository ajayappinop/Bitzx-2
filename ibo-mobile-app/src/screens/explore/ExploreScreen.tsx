import React from 'react';
import { View, Text, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import ProfileSubHeader from '../../components/profile/ProfileSubHeader';
import ProfileMenuRow from '../../components/profile/ProfileMenuRow';
import { ProfileStackParamList } from '../../navigation/types';
import { navigateToMainTab } from '../../navigation/mainTabNavigation';
import { profileStyles } from '../../components/profile/profileStyles';
import { useInrMinDeposit } from '../../hooks/useInrMinDeposit';
import { formatInrAmount } from '../../utils/inrWithdrawal';

type Nav = NativeStackNavigationProp<ProfileStackParamList, 'Explore'>;

export default function ExploreScreen({ navigation }: { navigation: Nav }) {
  const { minDepositInr } = useInrMinDeposit();
  const inrDepositSubtitle = minDepositInr > 0
    ? `From ${formatInrAmount(minDepositInr)} accepted`
    : 'Add INR balance';

  return (
    <SafeAreaView style={profileStyles.screen} edges={['top']}>
      <ProfileSubHeader title="All Features" onBack={() => navigation.goBack()} />
      <ScrollView contentContainerStyle={profileStyles.content}>
        <Text style={profileStyles.sectionTitle}>Trading</Text>
        <View style={profileStyles.card}>
          <ProfileMenuRow
            icon="chart-line"
            label="Markets"
            subtitle="Spot, futures & options"
            onPress={() => navigateToMainTab(navigation, 'Markets', { screen: 'MarketsList' })}
          />
          <ProfileMenuRow
            icon="swap-horizontal"
            label="Spot Trade"
            subtitle="BTC/USDT and more"
            onPress={() => navigateToMainTab(navigation, 'Trade', {
              screen: 'TradePair',
              params: { symbol: 'BTCUSDT', market: 'spot' },
            })}
          />
          <ProfileMenuRow
            icon="file-document-outline"
            label="Futures"
            subtitle="Perpetual contracts"
            onPress={() => navigateToMainTab(navigation, 'Futures', {
              screen: 'DerivativesPair',
              params: { symbol: 'BTCUSDT', market: 'futures' },
            })}
          />
          <ProfileMenuRow
            icon="view-grid-outline"
            label="IBO Markets"
            subtitle="Pairs quoted in IBO"
            onPress={() => navigateToMainTab(navigation, 'Markets', { screen: 'IBOMarkets' })}
            isLast
          />
        </View>

        <Text style={profileStyles.sectionTitle}>Wallet & fiat</Text>
        <View style={profileStyles.card}>
          <ProfileMenuRow
            icon="wallet-outline"
            label="Wallet"
            subtitle="Balances, deposit & withdraw"
            onPress={() => navigateToMainTab(navigation, 'Wallet', { screen: 'WalletHome' })}
          />
          <ProfileMenuRow
            icon="cash-outline"
            label="INR Deposit"
            subtitle={inrDepositSubtitle}
            onPress={() => navigateToMainTab(navigation, 'Wallet', { screen: 'InrDeposit' })}
          />
          <ProfileMenuRow
            icon="bank-off-outline"
            label="INR Withdraw"
            subtitle="Sell INR to bank/UPI"
            onPress={() => navigateToMainTab(navigation, 'Wallet', { screen: 'InrWithdraw' })}
          />
          <ProfileMenuRow
            icon="plus-circle-outline"
            label="List your coin"
            subtitle="Apply for token listing"
            onPress={() => navigation.navigate('ListCoin')}
            isLast
          />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
