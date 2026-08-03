import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, Share, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSelector } from 'react-redux';
import Clipboard from '@react-native-clipboard/clipboard';
import ProfileSubHeader from '../../components/profile/ProfileSubHeader';
import ErrorBanner from '../../components/common/ErrorBanner';
import ReferralNetworkTree from '../../components/referral/ReferralNetworkTree';
import Icon from '../../components/common/AppIcon';
import { ProfileStackParamList } from '../../navigation/types';
import { referralApi, ReferralMeResponse, ReferralTreeEntry } from '../../api/referral.api';
import { parseApiError } from '../../api/errors';
import { profileStyles } from '../../components/profile/profileStyles';
import { buildReferralShareLink } from '../../utils/referral';
import { RootState } from '../../store';
import { Colors, FontFamily, FontSize, Spacing, Radius } from '../../theme';
import { iosManualKeyboardScrollProps } from '@/utils/iosKeyboardScroll';

type Nav = NativeStackNavigationProp<ProfileStackParamList, 'ReferAndEarn'>;

export default function ReferAndEarnScreen({ navigation }: { navigation: Nav }) {
  const { user } = useSelector((s: RootState) => s.auth);
  const [info, setInfo] = useState<ReferralMeResponse | null>(null);
  const [tree, setTree] = useState<ReferralTreeEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await referralApi.getMyReferralInfo();
      setInfo(res.data);
      setTree(res.data?.referrals ?? []);
    } catch (err) {
      setError(parseApiError(err).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const shareLink = info ? buildReferralShareLink(info.share_links, info.referral_code) : '';

  const copyLink = () => {
    if (!shareLink) return;
    Clipboard.setString(shareLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  const shareLinkNow = async () => {
    if (!shareLink) return;
    try {
      await Share.share({
        message: `Join IBO with my referral link and start trading! ${shareLink}`,
      });
    } catch {
      // user dismissed share sheet
    }
  };

  const levels = info?.summary?.levels ?? [];

  return (
    <SafeAreaView style={profileStyles.screen} edges={['top']}>
      <ProfileSubHeader title="Refer & Earn" onBack={() => navigation.goBack()} />
      <ScrollView contentContainerStyle={profileStyles.content} {...iosManualKeyboardScrollProps()}>
        {error ? <ErrorBanner message={error} /> : null}

        {loading ? (
          <View style={styles.loadingBox}>
            <ActivityIndicator color={Colors.goldLight} />
          </View>
        ) : (
          <>
            {info && !info.referral_enabled ? (
              <View style={styles.noticeBox}>
                <Text style={styles.noticeText}>The Refer &amp; Earn program is not currently active. Check back soon!</Text>
              </View>
            ) : null}

            {info ? (
              <View style={styles.card}>
                <Text style={styles.introText}>
                  Invite friends and earn IBO for every level of your referral network — when your referral completes KYC, you get rewarded.
                </Text>

                <Text style={styles.label}>Your referral code</Text>
                <Text style={styles.codeText}>{info.referral_code}</Text>

                <Text style={[styles.label, { marginTop: Spacing[4] }]}>Your referral link</Text>
                <Text style={styles.linkText} numberOfLines={2}>{shareLink || '—'}</Text>

                <View style={styles.actionsRow}>
                  <TouchableOpacity
                    style={[styles.actionBtn, !shareLink && styles.actionBtnDisabled]}
                    onPress={copyLink}
                    activeOpacity={0.8}
                    disabled={!shareLink}
                  >
                    <Icon name={copied ? 'check' : 'content-copy'} size={16} color={copied ? Colors.success : Colors.textPrimary} />
                    <Text style={styles.actionBtnText}>{copied ? 'Copied' : 'Copy'}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.shareBtn, !shareLink && styles.actionBtnDisabled]}
                    onPress={shareLinkNow}
                    activeOpacity={0.8}
                    disabled={!shareLink}
                  >
                    <Icon name="share-variant-outline" size={16} color={Colors.goldLight} />
                    <Text style={styles.shareBtnText}>Share</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ) : null}

            {info ? (
              <View style={styles.statsRow}>
                <View style={styles.statCard}>
                  <Text style={styles.statLabel}>Direct referrals</Text>
                  <Text style={styles.statValue}>{info.summary?.direct_referral_count ?? 0}</Text>
                </View>
                <View style={styles.statCard}>
                  <Text style={styles.statLabel}>Total network</Text>
                  <Text style={styles.statValue}>{info.summary?.total_referral_count ?? 0}</Text>
                </View>
              </View>
            ) : null}

            {info ? (
              <View style={styles.statsRow}>
                <View style={styles.statCardWide}>
                  <Text style={styles.statLabel}>Total earned</Text>
                  <Text style={styles.statValueGold}>{Number(info.summary?.total_earned_ibo || 0).toFixed(4)} IBO</Text>
                </View>
                <View style={styles.statCardWide}>
                  <Text style={styles.statLabel}>Pending (awaiting KYC)</Text>
                  <Text style={styles.statValueAmber}>{Number(info.summary?.total_pending_ibo || 0).toFixed(4)} IBO</Text>
                </View>
              </View>
            ) : null}

            {Number(info?.summary?.total_pending_ibo || 0) > 0 ? (
              <View style={styles.noticeBoxInfo}>
                <Text style={styles.noticeTextInfo}>
                  {Number(info?.summary?.total_pending_ibo || 0).toFixed(4)} IBO has already been sent on-chain for your
                  referrals and is waiting — it lands in your spendable wallet as soon as they complete KYC verification.
                </Text>
              </View>
            ) : null}

            {levels.length > 0 ? (
              <View style={styles.card}>
                <Text style={styles.sectionTitle}>Reward levels</Text>
                {levels.map((lvl) => (
                  <View key={lvl.level} style={styles.levelRow}>
                    <Text style={styles.levelRowLabel}>
                      {lvl.flat_overflow ? `Level ${lvl.flat_from_level ?? lvl.level}+` : `Level ${lvl.level}`}
                    </Text>
                    <Text style={styles.levelRowValue}>{Number(lvl.amount_ibo || 0).toFixed(4)} IBO</Text>
                    <Text style={styles.levelRowValue}>{lvl.referral_count ?? 0} users</Text>
                    <Text style={styles.levelRowEarned}>{Number(lvl.earned_ibo || 0).toFixed(4)} IBO</Text>
                    {Number(lvl.pending_ibo || 0) > 0 ? (
                      <Text style={styles.levelRowPending}>{Number(lvl.pending_ibo || 0).toFixed(4)} IBO pending</Text>
                    ) : null}
                  </View>
                ))}
              </View>
            ) : null}

            {info && user ? (
              <>
                <Text style={profileStyles.sectionTitle}>Your referral network</Text>
                <ReferralNetworkTree
                  rootUser={{
                    uid: user.uid,
                    name: user.name,
                    avatar_url: user.avatar_url,
                  }}
                  referrals={tree}
                  summary={info.summary}
                />
              </>
            ) : null}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  loadingBox: {
    paddingVertical: Spacing[10],
    alignItems: 'center',
  },
  noticeBox: {
    backgroundColor: Colors.warningDim,
    borderWidth: 1,
    borderColor: Colors.warning,
    borderRadius: Radius.lg,
    padding: Spacing[3],
  },
  noticeText: {
    fontFamily: FontFamily.regular,
    fontSize: FontSize.sm,
    color: Colors.warning,
  },
  noticeBoxInfo: {
    backgroundColor: Colors.goldAlpha10,
    borderWidth: 1,
    borderColor: Colors.goldAlpha30,
    borderRadius: Radius.lg,
    padding: Spacing[3],
  },
  noticeTextInfo: {
    fontFamily: FontFamily.regular,
    fontSize: FontSize.sm,
    color: Colors.goldLight,
    lineHeight: 18,
  },
  card: {
    backgroundColor: Colors.surfaceCard,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    borderRadius: Radius.xl,
    padding: Spacing[4],
  },
  introText: {
    fontFamily: FontFamily.regular,
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    marginBottom: Spacing[4],
    lineHeight: 19,
  },
  label: {
    fontFamily: FontFamily.semiBold,
    fontSize: FontSize.xs,
    color: Colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: Spacing[2],
  },
  codeText: {
    fontFamily: FontFamily.bold,
    fontSize: FontSize['2xl'],
    color: Colors.goldLight,
    letterSpacing: 1,
  },
  linkText: {
    fontFamily: FontFamily.regular,
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    backgroundColor: Colors.surfaceHover,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing[3],
    paddingVertical: Spacing[2],
  },
  actionsRow: {
    flexDirection: 'row',
    gap: Spacing[3],
    marginTop: Spacing[4],
  },
  actionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing[1],
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    borderRadius: Radius.lg,
    paddingVertical: Spacing[3],
  },
  actionBtnDisabled: {
    opacity: 0.45,
  },
  actionBtnText: {
    fontFamily: FontFamily.semiBold,
    fontSize: FontSize.sm,
    color: Colors.textPrimary,
  },
  shareBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing[1],
    backgroundColor: Colors.goldAlpha15,
    borderWidth: 1,
    borderColor: Colors.goldAlpha30,
    borderRadius: Radius.lg,
    paddingVertical: Spacing[3],
  },
  shareBtnText: {
    fontFamily: FontFamily.semiBold,
    fontSize: FontSize.sm,
    color: Colors.goldLight,
  },
  statsRow: {
    flexDirection: 'row',
    gap: Spacing[3],
  },
  statCard: {
    flex: 1,
    backgroundColor: Colors.surfaceCard,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    borderRadius: Radius.xl,
    padding: Spacing[4],
  },
  statCardWide: {
    flex: 1,
    backgroundColor: Colors.surfaceCard,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    borderRadius: Radius.xl,
    padding: Spacing[4],
  },
  statLabel: {
    fontFamily: FontFamily.semiBold,
    fontSize: FontSize.xs,
    color: Colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: Spacing[1],
  },
  statValue: {
    fontFamily: FontFamily.bold,
    fontSize: FontSize.xl,
    color: Colors.textPrimary,
  },
  statValueGold: {
    fontFamily: FontFamily.bold,
    fontSize: FontSize.xl,
    color: Colors.goldLight,
  },
  statValueAmber: {
    fontFamily: FontFamily.bold,
    fontSize: FontSize.xl,
    color: Colors.warning,
  },
  sectionTitle: {
    fontFamily: FontFamily.bold,
    fontSize: FontSize.sm,
    color: Colors.textPrimary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: Spacing[3],
  },
  levelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: Spacing[2],
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.surfaceBorder,
    gap: Spacing[2],
  },
  levelRowLabel: {
    flex: 1,
    fontFamily: FontFamily.semiBold,
    fontSize: FontSize.sm,
    color: Colors.textPrimary,
  },
  levelRowValue: {
    flex: 1,
    fontFamily: FontFamily.regular,
    fontSize: FontSize.xs,
    color: Colors.textSecondary,
  },
  levelRowEarned: {
    flex: 1,
    fontFamily: FontFamily.semiBold,
    fontSize: FontSize.xs,
    color: Colors.goldLight,
    textAlign: 'right',
  },
  levelRowPending: {
    flex: 1,
    fontFamily: FontFamily.semiBold,
    fontSize: FontSize.xs,
    color: Colors.warning,
    textAlign: 'right',
  },
});
