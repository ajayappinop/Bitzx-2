import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  Image, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import Icon from '@/components/common/AppIcon';
import { ProfileStackParamList } from '../../navigation/types';
import { navigateToMainTab } from '../../navigation/mainTabNavigation';
import { useSelector, useDispatch } from 'react-redux';
import { RootState, AppDispatch } from '../../store';
import { logoutThunk, setUser } from '../../store/auth.slice';
import ProfileMenuRow from '../../components/profile/ProfileMenuRow';
import ErrorBanner from '../../components/common/ErrorBanner';
import { profileStyles, PROFILE_H_PAD } from '../../components/profile/profileStyles';
import { parseApiError } from '../../api/errors';
import { Colors, FontFamily, FontSize, Spacing, Radius } from '../../theme';
import { formatDate } from '../../utils/formatters';
import { effectiveKycStatus, parseKycTier } from '../../utils/kycGate';
import { launchImageLibrary } from 'react-native-image-picker';
import { authApi } from '../../api/auth.api';
import StorageService from '../../services/storage.service';
import { STORAGE_KEYS } from '../../config/storageKeys';
import { API_URL } from '../../config/env';

type Props = {
  navigation: NativeStackNavigationProp<ProfileStackParamList, 'ProfileHome'>;
};

const KYC_BADGE_COLOR: Record<string, string> = {
  approved: Colors.success,
  pending: Colors.warning,
  under_review: Colors.info,
  rejected: Colors.danger,
  re_requested: Colors.warning,
  not_started: Colors.textMuted,
};

const KYC_BADGE_LABEL: Record<string, string> = {
  approved: 'Verified',
  pending: 'Pending',
  under_review: 'In review',
  rejected: 'Rejected',
  re_requested: 'Action needed',
  not_started: 'Not started',
};

export default function ProfileScreen({ navigation }: Props) {
  const toAbsoluteUrl = useCallback((pathOrUrl?: string) => {
    const raw = (pathOrUrl || '').trim();
    if (!raw) return undefined;
    if (raw.startsWith('http://') || raw.startsWith('https://')) return raw;
    const rel = raw.startsWith('/') ? raw : `/${raw}`;
    return `${API_URL}${rel}`;
  }, []);

  const dispatch = useDispatch<AppDispatch>();
  const { user, kyc } = useSelector((s: RootState) => s.auth);
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [avatarOk, setAvatarOk] = useState('');
  const [avatarErr, setAvatarErr] = useState('');
  const feedbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (feedbackTimerRef.current) clearTimeout(feedbackTimerRef.current);
  }, []);

  const showAvatarSuccess = useCallback((message: string) => {
    setAvatarErr('');
    setAvatarOk(message);
    if (feedbackTimerRef.current) clearTimeout(feedbackTimerRef.current);
    feedbackTimerRef.current = setTimeout(() => setAvatarOk(''), 5000);
  }, []);

  const handleLogout = useCallback(() => {
    Alert.alert('Sign Out', 'Are you sure you want to sign out?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign Out', style: 'destructive', onPress: () => dispatch(logoutThunk()) },
    ]);
  }, [dispatch]);

  const handlePickAvatar = useCallback(async () => {
    if (avatarUploading) return;
    setAvatarErr('');
    setAvatarOk('');
    try {
      const result = await launchImageLibrary({
        mediaType: 'photo',
        selectionLimit: 1,
        quality: 1,
      });
      if (result.didCancel) return;
      if (result.errorMessage) {
        setAvatarErr(result.errorMessage);
        return;
      }
      const asset = result.assets?.[0];
      if (!asset?.uri) {
        setAvatarErr('No image selected.');
        return;
      }

      const formData = new FormData();
      formData.append('file', {
        uri: asset.uri,
        name: asset.fileName || `avatar_${Date.now()}.jpg`,
        type: asset.type || 'image/jpeg',
      } as any);

      setAvatarUploading(true);
      await authApi.uploadAvatar(formData);
      const me = await authApi.me();
      const nextUser = { ...me.data, avatar_url: toAbsoluteUrl(me.data.avatar_url) };
      dispatch(setUser(nextUser));
      await StorageService.setJSON(STORAGE_KEYS.USER, nextUser);
      showAvatarSuccess('Profile picture updated.');
    } catch (e: unknown) {
      setAvatarErr(parseApiError(e).message || 'Could not update profile picture.');
    } finally {
      setAvatarUploading(false);
    }
  }, [avatarUploading, dispatch, showAvatarSuccess, toAbsoluteUrl]);

  const initials = user?.name
    ? user.name.split(' ').map((n) => n[0]).join('').toUpperCase().slice(0, 2)
    : user?.email?.slice(0, 2).toUpperCase() ?? 'BX';

  const kycStatus = effectiveKycStatus(kyc, user);
  const kycColor = KYC_BADGE_COLOR[kycStatus] ?? Colors.textMuted;
  const kycLabel = KYC_BADGE_LABEL[kycStatus] ?? 'Unknown';
  const memberSince = user?.created_at ? formatDate(user.created_at) : null;
  const tier = parseKycTier(kyc?.tier ?? user?.kyc_tier);

  return (
    <SafeAreaView style={profileStyles.screen} edges={['top']}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={profileStyles.scrollContent}
      >
        <View style={profileStyles.pageHeader}>
          <View style={profileStyles.pageTitleRow}>
            <Icon name="account-circle-outline" size={24} color={Colors.goldLight} />
            <Text style={profileStyles.pageTitle}>Profile</Text>
          </View>
          <Text style={profileStyles.pageSubtitle}>Account & security settings</Text>
        </View>

        {avatarErr ? (
          <ErrorBanner message={avatarErr} style={styles.feedbackBanner} />
        ) : null}
        {avatarOk ? (
          <ErrorBanner message={avatarOk} type="success" style={styles.feedbackBanner} />
        ) : null}

        <View style={profileStyles.heroCard}>
          <TouchableOpacity
            style={styles.avatarRing}
            activeOpacity={0.8}
            onPress={handlePickAvatar}
            disabled={avatarUploading}
          >
            {user?.avatar_url ? (
              <Image source={{ uri: user.avatar_url }} style={styles.avatar} />
            ) : (
              <View style={styles.avatarFallback}>
                <Text style={styles.avatarInitials}>{initials}</Text>
              </View>
            )}
            <View style={styles.onlineDot} />
            <View style={styles.avatarEditPill}>
              <Icon name="camera-outline" size={12} color={Colors.goldLight} />
              <Text style={styles.avatarEditTxt}>{avatarUploading ? 'Uploading' : 'Edit'}</Text>
            </View>
          </TouchableOpacity>

          <Text style={styles.userName}>{user?.name ?? 'IBO User'}</Text>
          <Text style={styles.userEmail} numberOfLines={1}>{user?.email}</Text>

          <View style={[styles.kycPill, { borderColor: kycColor + '50', backgroundColor: kycColor + '18' }]}>
            <View style={[styles.kycDot, { backgroundColor: kycColor }]} />
            <Text style={[styles.kycPillText, { color: kycColor }]}>{kycLabel}</Text>
          </View>

          <View style={styles.metaRow}>
            {memberSince ? (
              <View style={styles.metaChip}>
                <Icon name="calendar-outline" size={12} color={Colors.textMuted} />
                <Text style={styles.metaChipText}>Joined {memberSince}</Text>
              </View>
            ) : null}
            {tier != null && tier > 0 ? (
              <View style={styles.metaChip}>
                <Icon name="shield-check-outline" size={12} color={Colors.goldLight} />
                <Text style={styles.metaChipText}>Tier {tier}</Text>
              </View>
            ) : null}
          </View>
        </View>

        <View style={profileStyles.section}>
          <Text style={profileStyles.sectionTitle}>Account</Text>
          <View style={profileStyles.card}>
            <ProfileMenuRow
              icon="pencil-outline"
              label="Edit Profile"
              subtitle="Name, phone, country and bio"
              onPress={() => navigation.navigate('EditProfile')}
              isLast
            />
          </View>
        </View>

        <View style={profileStyles.section}>
          <Text style={profileStyles.sectionTitle}>Verification</Text>
          <View style={profileStyles.card}>
            <ProfileMenuRow
              icon="card-account-details-outline"
              label="KYC Verification"
              subtitle="Identity verification & withdrawal limits"
              badge={kycLabel}
              badgeColor={kycColor}
              onPress={() => navigation.navigate('KYCStatus')}
              isLast
            />
          </View>
        </View>

        <View style={profileStyles.section}>
          <Text style={profileStyles.sectionTitle}>Rewards</Text>
          <View style={profileStyles.card}>
            <ProfileMenuRow
              icon="gift-outline"
              label="Refer & Earn"
              subtitle="Invite friends and earn IBO rewards"
              onPress={() => navigation.navigate('ReferAndEarn')}
              isLast
            />
          </View>
        </View>

        <View style={profileStyles.section}>
          <Text style={profileStyles.sectionTitle}>Security</Text>
          <View style={profileStyles.card}>
            <ProfileMenuRow
              icon="shield-key-outline"
              label="Two-Factor Authentication"
              subtitle="Protect your account with TOTP"
              onPress={() => navigation.navigate('Security')}
            />
            <ProfileMenuRow
              icon="lock-reset"
              label="Change Password"
              subtitle="Update your login credentials"
              onPress={() => navigation.navigate('ChangePassword')}
            />
            <ProfileMenuRow
              icon="monitor-cellphone"
              label="Active Sessions"
              subtitle="Manage signed-in devices"
              onPress={() => navigation.navigate('Sessions')}
              isLast
            />
          </View>
        </View>

        <View style={profileStyles.section}>
          <Text style={profileStyles.sectionTitle}>Exchange</Text>
          <View style={profileStyles.card}>
            <ProfileMenuRow
              icon="grid-outline"
              label="All features"
              subtitle="Trading, wallet, fiat & listings"
              onPress={() => navigation.navigate('Explore')}
            />
            <ProfileMenuRow
              icon="plus-circle-outline"
              label="List your coin"
              subtitle="Apply for token listing on Ibo"
              onPress={() => navigation.navigate('ListCoin')}
            />
            <ProfileMenuRow
              icon="view-grid-outline"
              label="IBO Markets"
              subtitle="Trade pairs quoted in IBO"
              onPress={() => navigateToMainTab(navigation, 'Markets', { screen: 'IBOMarkets' })}
            />
            <ProfileMenuRow
              icon="history"
              label="Wallet History"
              subtitle="All deposits and withdrawals"
              onPress={() => navigateToMainTab(navigation, 'Wallet', {
                screen: 'WalletHome',
                params: { tab: 'history' },
              })}
            />
            <ProfileMenuRow
              icon="bank-off-outline"
              label="INR payout details"
              subtitle="Edit or remove saved bank / UPI details"
              onPress={() => navigation.navigate('InrPayoutDetails')}
              isLast
            />
          </View>
        </View>

        <View style={profileStyles.section}>
          <Text style={profileStyles.sectionTitle}>Insights</Text>
          <View style={profileStyles.card}>
            <ProfileMenuRow
              icon="chart-line"
              label="P&L Analytics"
              subtitle="Trade performance & history"
              onPress={() => navigation.navigate('PnLAnalytics')}
              isLast
            />
          </View>
        </View>

        <View style={profileStyles.section}>
          <Text style={profileStyles.sectionTitle}>Support</Text>
          <View style={profileStyles.card}>
            <ProfileMenuRow
              icon="ticket-outline"
              label="Support Tickets"
              subtitle="Get help from our team"
              onPress={() => navigation.navigate('Support')}
              isLast
            />
          </View>
        </View>

        <View style={profileStyles.section}>
          <View style={[profileStyles.card, styles.signOutCard]}>
            <ProfileMenuRow
              icon="logout"
              label="Sign Out"
              subtitle="Sign out of this device"
              onPress={handleLogout}
              showArrow={false}
              danger
              isLast
            />
          </View>
        </View>

        <View style={profileStyles.footer}>
          <Text style={profileStyles.footerText}>IBO Exchange · Secure trading</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  feedbackBanner: {
    marginBottom: Spacing[4],
  },
  avatarRing: {
    position: 'relative',
    marginBottom: Spacing[3],
  },
  avatar: {
    width: 88,
    height: 88,
    borderRadius: 44,
    borderWidth: 2,
    borderColor: Colors.goldAlpha30,
  },
  avatarFallback: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: Colors.goldAlpha15,
    borderWidth: 2,
    borderColor: Colors.goldAlpha30,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitials: {
    fontFamily: FontFamily.bold,
    fontSize: FontSize['2xl'],
    color: Colors.goldLight,
  },
  onlineDot: {
    position: 'absolute',
    bottom: 4,
    right: 4,
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: Colors.success,
    borderWidth: 2,
    borderColor: Colors.surface,
  },
  avatarEditPill: {
    position: 'absolute',
    bottom: -8,
    alignSelf: 'center',
    paddingHorizontal: Spacing[2],
    height: 20,
    borderRadius: Radius.full,
    backgroundColor: Colors.surfaceCard,
    borderWidth: 1,
    borderColor: Colors.goldAlpha30,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  avatarEditTxt: {
    fontFamily: FontFamily.medium,
    fontSize: 10,
    color: Colors.goldLight,
  },
  userName: {
    fontFamily: FontFamily.bold,
    fontSize: FontSize.lg,
    color: Colors.textPrimary,
    textAlign: 'center',
    marginBottom: 2,
  },
  userEmail: {
    fontFamily: FontFamily.regular,
    fontSize: FontSize.sm,
    color: Colors.textMuted,
    textAlign: 'center',
    maxWidth: '100%',
    paddingHorizontal: PROFILE_H_PAD,
    marginBottom: Spacing[3],
  },
  kycPill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing[3],
    paddingVertical: 5,
    borderRadius: Radius.full,
    borderWidth: 1,
    marginBottom: Spacing[3],
  },
  kycDot: { width: 6, height: 6, borderRadius: 3, marginRight: 6 },
  kycPillText: { fontFamily: FontFamily.semiBold, fontSize: FontSize.xs },
  metaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: Spacing[2],
  },
  metaChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: Spacing[2],
    paddingVertical: 4,
    borderRadius: Radius.full,
    backgroundColor: Colors.surfaceCard,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
  },
  metaChipText: {
    fontFamily: FontFamily.regular,
    fontSize: 9,
    color: Colors.textMuted,
  },
  signOutCard: {
    borderColor: Colors.danger + '30',
  },
});
