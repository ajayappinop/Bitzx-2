/**
 * Wallet hub — tabbed spot / futures / deposit / withdraw / history / ledger.
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useDispatch, useSelector } from 'react-redux';
import { RouteProp, useNavigation, useRoute } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import Icon from '@/components/common/AppIcon';
import { WalletStackParamList, MainTabParamList } from '../../navigation/types';
import { WalletTab } from '../../types/wallet.tabs';
import { AppDispatch, RootState } from '../../store';
import { fetchWalletThunk, selectSessionWallet } from '../../store/wallet.slice';
import { fetchMarketsLiteThunk } from '../../store/market.slice';
import { getSwapConfigCached } from '../../services/swapConfigCache';
import WalletTabBar from '../../components/wallet/WalletTabBar';
import SpotBalancesTab from '../../components/wallet/SpotBalancesTab';
import IboSwapTab from '../../components/wallet/IboSwapTab';
import FuturesWalletTab from '../../components/wallet/FuturesWalletTab';
import WalletHistoryTab from '../../components/wallet/WalletHistoryTab';
import WalletLedgerTab from '../../components/wallet/WalletLedgerTab';
import DepositScreen from './DepositScreen';
import WithdrawScreen from './WithdrawScreen';
import { Colors, FontFamily, FontSize, Spacing, Radius } from '../../theme';
import { WALLET_H_PAD } from '../../components/wallet/walletStyles';

type Nav = NativeStackNavigationProp<WalletStackParamList, 'WalletHome'>;
type Route = RouteProp<WalletStackParamList, 'WalletHome'>;

export default function WalletScreen() {
  const dispatch = useDispatch<AppDispatch>();
  const navigation = useNavigation<Nav>();
  const route = useRoute<Route>();
  const tabNav = useNavigation<NativeStackNavigationProp<MainTabParamList>>();
  const { user } = useSelector((s: RootState) => s.auth);
  const { assets: sessionAssets } = useSelector(selectSessionWallet);
  const marketListLen = useSelector((s: RootState) => s.market.marketList.length);
  const walletAssetsLen = sessionAssets.length;

  const [tab, setTab] = useState<WalletTab>(route.params?.tab ?? 'balances');

  useEffect(() => {
    if (route.params?.tab) setTab(route.params.tab);
  }, [route.params?.tab]);

  const load = useCallback((force = false) => {
    if (force || walletAssetsLen === 0) dispatch(fetchWalletThunk());
    if (force || marketListLen === 0) dispatch(fetchMarketsLiteThunk());
  }, [dispatch, walletAssetsLen, marketListLen]);

  useEffect(() => {
    load(false);
    void getSwapConfigCached();
  }, [load]);

  const email = user?.email ?? '';

  const renderTab = () => {
    switch (tab) {
      case 'balances':
        return <SpotBalancesTab onOpenSwap={() => setTab('swap')} />;
      case 'swap':
        return <IboSwapTab />;
      case 'futures':
        return <FuturesWalletTab />;
      case 'deposit':
        return (
          <DepositScreen
            navigation={navigation as any}
            route={{ key: 'deposit-embed', name: 'Deposit', params: { embedded: true } } as any}
          />
        );
      case 'withdraw':
        return (
          <WithdrawScreen
            navigation={navigation as any}
            route={{ key: 'withdraw-embed', name: 'Withdraw', params: { embedded: true } } as any}
          />
        );
      case 'history':
        return <WalletHistoryTab />;
      case 'ledger':
        return <WalletLedgerTab />;
      default:
        return <SpotBalancesTab />;
    }
  };

  const selfScroll = tab === 'futures' || tab === 'deposit' || tab === 'withdraw' || tab === 'ledger' || tab === 'swap';

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <View style={styles.titleRow}>
            <Icon name="wallet-outline" size={22} color={Colors.goldLight} />
            <Text style={styles.heading}>Wallet</Text>
          </View>
          <Text style={styles.subheading}>Manage your funds</Text>
          {email ? <Text style={styles.email} numberOfLines={1}>{email}</Text> : null}
        </View>
        <View style={styles.headerActions}>
          <TouchableOpacity style={styles.iconBtn} onPress={() => load(true)} activeOpacity={0.8}>
            <Icon name="refresh" size={16} color={Colors.goldLight} />
            <Text style={styles.iconBtnTxt}>Refresh</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.tradeBtn}
            onPress={() => tabNav.navigate('Trade', {
              screen: 'TradePair',
              params: { symbol: 'BTCUSDT', market: 'spot' },
            })}
            activeOpacity={0.85}
          >
            <Icon name="chart-line" size={14} color={Colors.surfaceDark} />
            <Text style={styles.tradeBtnTxt}>Trade</Text>
          </TouchableOpacity>
        </View>
      </View>

      <WalletTabBar active={tab} onChange={setTab} />

      {selfScroll ? (
        <View style={styles.tabBody}>{renderTab()}</View>
      ) : (
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.scrollContent}
        >
          {renderTab()}
          <View style={{ height: Spacing[12] }} />
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.surface },
  scrollContent: { paddingBottom: Spacing[4] },
  tabBody: { flex: 1 },
  header: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    paddingHorizontal: WALLET_H_PAD,
    paddingTop: Spacing[3],
    paddingBottom: Spacing[2],
    gap: Spacing[3],
  },
  headerLeft: { flex: 1, minWidth: 160 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing[2] },
  heading: {
    fontFamily: FontFamily.bold,
    fontSize: FontSize['2xl'],
    color: Colors.textPrimary,
    letterSpacing: -0.5,
  },
  subheading: {
    fontFamily: FontFamily.regular,
    fontSize: FontSize.xs,
    color: Colors.textMuted,
    marginTop: 2,
  },
  email: {
    fontFamily: FontFamily.regular,
    fontSize: FontSize.xs,
    color: Colors.textSecondary,
    marginTop: 4,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing[2],
    flexShrink: 0,
  },
  iconBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: Spacing[3],
    paddingVertical: Spacing[2],
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    backgroundColor: Colors.surfaceCard,
  },
  iconBtnTxt: {
    fontFamily: FontFamily.medium,
    fontSize: 10,
    color: Colors.goldLight,
  },
  tradeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: Spacing[3],
    paddingVertical: Spacing[2],
    borderRadius: Radius.lg,
    backgroundColor: Colors.gold,
  },
  tradeBtnTxt: {
    fontFamily: FontFamily.bold,
    fontSize: 10,
    color: Colors.surfaceDark,
  },
});
