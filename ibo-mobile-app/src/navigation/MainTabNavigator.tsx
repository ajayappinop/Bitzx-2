import React, { useCallback, useEffect, useRef } from 'react';
import { Platform, StyleSheet } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { useNavigation } from '@react-navigation/native';
import { useDispatch, useSelector } from 'react-redux';
import Icon from '@/components/common/AppIcon';
import { MainTabParamList } from './types';
import DashboardScreen from '../screens/dashboard/DashboardScreen';
import TradingNavigator, { TradeTabNavigator } from './TradingNavigator';
import FuturesTabNavigator from './FuturesNavigator';
import WalletNavigator from './WalletNavigator';
import { Colors, FontFamily } from '../theme';
import { useAccountWs } from '../hooks/useAccountWs';
import { useMarketData } from '../hooks/useMarketData';
import { getSwapConfigCached } from '../services/swapConfigCache';
import { useSignupBonusPrompt } from '../hooks/useSignupBonusPrompt';
import { useVerifyDeposit } from '../hooks/useVerifyDeposit';
import SignupBonusKycModal from '../components/wallet/SignupBonusKycModal';
import { clearJustRegistered } from '../store/auth.slice';
import type { RootState } from '../store';
import { effectiveKycStatus } from '../utils/kycGate';
import { navigateToKycFlowFromRoot } from '../utils/kycNavigation';
import { navigateToMainTab } from './mainTabNavigation';

/** Markets + account WebSockets for the session (live data — no polling). */
function LiveSessionSockets() {
  useMarketData();
  useAccountWs();
  React.useEffect(() => {
    void getSwapConfigCached();
  }, []);
  return null;
}

const Tab = createBottomTabNavigator<MainTabParamList>();

const TAB_CONFIG: Record<string, { icon: string; label: string }> = {
  Dashboard: { icon: 'view-dashboard-outline', label: 'Home'    },
  Markets:   { icon: 'chart-line',             label: 'Markets' },
  Trade:     { icon: 'swap-horizontal',         label: 'Trade'   },
  Futures:   { icon: 'file-document-outline',     label: 'Futures' },
  Wallet:    { icon: 'wallet-outline',          label: 'Wallet'  },
};

/**
 * Helper: build a tabPress listener that resets the nested stack
 * to its first screen.  Without this, React Navigation preserves
 * the nested-stack state across tab switches — so tapping "Wallet"
 * while you're deep inside Deposit would keep showing Deposit.
 */
function resetOnPress(tabName: string, initialScreen: string) {
  return ({ navigation }: { navigation: any }) => ({
    tabPress: () => {
      // navigate() on the tab-level navigator pops the nested stack
      // back to `initialScreen` if it already exists in the stack,
      // or navigates to it fresh.
      navigation.navigate(tabName, { screen: initialScreen });
    },
  });
}

export default function MainTabNavigator() {
  const navigation = useNavigation<any>();
  const dispatch = useDispatch();
  const justRegistered = useSelector((s: RootState) => s.auth.justRegistered);
  const { kyc, kycMode, user } = useSelector((s: RootState) => s.auth);
  // When the signup bonus is detected, navigate to Wallet → History so the user can see it.
  const handleBonusFound = useCallback(() => {
    navigateToMainTab(navigation, 'Wallet', {
      screen: 'WalletHome',
      params: { tab: 'history' },
    });
  }, [navigation]);

  const { prompt, visible, dismiss } = useSignupBonusPrompt(handleBonusFound);

  // Background chain scan while the app is open — deposits credit without
  // requiring Wallet → History (server deposit_poller is the primary path).
  useVerifyDeposit({ intervalMs: 300_000 });

  // Mirror website behavior: navigate to Wallet → History when a new account is created.
  // This gives the user immediate feedback and lets the signup bonus async dispatch settle.
  const navigatedRef = useRef(false);
  useEffect(() => {
    if (!justRegistered || navigatedRef.current) return;
    navigatedRef.current = true;
    dispatch(clearJustRegistered());
    // Small delay so the navigator tree is fully mounted before navigating.
    const t = setTimeout(() => {
      navigateToMainTab(navigation, 'Wallet', {
        screen: 'WalletHome',
        params: { tab: 'history' },
      });
    }, 400);
    return () => clearTimeout(t);
  }, [justRegistered, navigation, dispatch]);

  return (
    <>
    <LiveSessionSockets />
    <SignupBonusKycModal
      visible={visible}
      prompt={prompt}
      onDismiss={dismiss}
      onCompleteKyc={() => {
        dismiss();
        navigateToKycFlowFromRoot(
          navigation,
          kycMode,
          effectiveKycStatus(kyc, user),
        );
      }}
    />
    <Tab.Navigator
      screenOptions={({ route }) => {
        const cfg = TAB_CONFIG[route.name];
        return {
          headerShown: false,
          animation: 'shift',
          tabBarHideOnKeyboard: Platform.OS !== 'ios',
          tabBarIcon: ({ color }) => (
            <Icon name={cfg?.icon ?? 'circle'} size={24} color={color} />
          ),
          tabBarLabel: cfg?.label ?? route.name,
          tabBarActiveTintColor: Colors.goldLight,
          tabBarInactiveTintColor: Colors.textMuted,
          tabBarStyle: {
            backgroundColor: Colors.surfaceCard,
            borderTopWidth: StyleSheet.hairlineWidth,
            borderTopColor: Colors.surfaceBorder,
            ...Platform.select({
              ios: {
                shadowColor: '#000',
                shadowOffset: { width: 0, height: -2 },
                shadowOpacity: 0.22,
                shadowRadius: 10,
              },
              android: {
                elevation: 12,
              },
              default: {},
            }),
          },
          tabBarLabelStyle: {
            fontFamily: FontFamily.medium,
            fontSize: 11,
            marginTop: 2,
          },
        };
      }}
    >
      {/* Dashboard — single screen, no nested stack to reset */}
      <Tab.Screen
        name="Dashboard"
        component={DashboardScreen}
      />

      {/* Markets — resets to MarketsList */}
      <Tab.Screen
        name="Markets"
        component={TradingNavigator}
        listeners={resetOnPress('Markets', 'MarketsList')}
      />

      {/* Trade — spot only; do not reset pair on tab press (preserves MIDASUSDT etc.) */}
      <Tab.Screen
        name="Trade"
        component={TradeTabNavigator}
      />

      {/* Futures + Options */}
      <Tab.Screen
        name="Futures"
        component={FuturesTabNavigator}
        listeners={resetOnPress('Futures', 'DerivativesPair')}
      />

      {/* Wallet — resets to WalletHome */}
      <Tab.Screen
        name="Wallet"
        component={WalletNavigator}
        listeners={resetOnPress('Wallet', 'WalletHome')}
      />
    </Tab.Navigator>
    </>
  );
}
