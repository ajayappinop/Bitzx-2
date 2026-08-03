import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { ProfileStackParamList } from './types';
import ProfileScreen from '../screens/profile/ProfileScreen';
import EditProfileScreen from '../screens/profile/EditProfileScreen';
import SecurityScreen from '../screens/profile/SecurityScreen';
import SessionsScreen from '../screens/profile/SessionsScreen';
import ChangePasswordScreen from '../screens/profile/ChangePasswordScreen';
import KYCStatusScreen from '../screens/kyc/KYCStatusScreen';
import KYCWizardScreen from '../screens/kyc/KYCWizardScreen';
import AutoKycScreen from '../screens/kyc/AutoKycScreen';
import SupportScreen from '../screens/support/SupportScreen';
import TicketDetailScreen from '../screens/support/TicketDetailScreen';
import PnLAnalyticsScreen from '../screens/pnl/PnLAnalyticsScreen';
import ListCoinScreen from '../screens/listings/ListCoinScreen';
import InrPayoutDetailsScreen from '../screens/profile/InrPayoutDetailsScreen';
import ReferAndEarnScreen from '../screens/profile/ReferAndEarnScreen';
import ExploreScreen from '../screens/explore/ExploreScreen';
import QuickTradeScreen from '../screens/trading/QuickTradeScreen';
import P2PMarketplaceScreen from '../screens/p2p/P2PMarketplaceScreen';

const Stack = createNativeStackNavigator<ProfileStackParamList>();

export default function ProfileNavigator() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="ProfileHome" component={ProfileScreen} />
      <Stack.Screen name="Explore" component={ExploreScreen} />
      <Stack.Screen name="QuickTrade" component={QuickTradeScreen} />
      <Stack.Screen name="P2PMarketplace" component={P2PMarketplaceScreen} />
      <Stack.Screen name="EditProfile" component={EditProfileScreen} />
      <Stack.Screen name="ListCoin" component={ListCoinScreen} />
      <Stack.Screen name="InrPayoutDetails" component={InrPayoutDetailsScreen} />
      <Stack.Screen name="Security" component={SecurityScreen} />
      <Stack.Screen name="Sessions" component={SessionsScreen} />
      <Stack.Screen name="ChangePassword" component={ChangePasswordScreen} />
      <Stack.Screen name="KYCStatus" component={KYCStatusScreen} />
      <Stack.Screen name="AutoKyc" component={AutoKycScreen} />
      <Stack.Screen name="KYCWizard" component={KYCWizardScreen} />
      <Stack.Screen name="Support" component={SupportScreen} />
      <Stack.Screen name="TicketDetail" component={TicketDetailScreen} />
      <Stack.Screen name="PnLAnalytics" component={PnLAnalyticsScreen} />
      <Stack.Screen name="ReferAndEarn" component={ReferAndEarnScreen} />
    </Stack.Navigator>
  );
}
