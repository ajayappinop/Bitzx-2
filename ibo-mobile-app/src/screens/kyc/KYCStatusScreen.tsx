import React, { useEffect, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSelector, useDispatch } from 'react-redux';
import { RootState, AppDispatch } from '../../store';
import { fetchKycThunk } from '../../store/auth.slice';
import { ProfileStackParamList } from '../../navigation/types';
import { KYCStatus } from '../../types/auth.types';
import SafeAreaWrapper from '../../components/common/SafeAreaWrapper';
import Button from '../../components/common/Button';
import Icon from '@/components/common/AppIcon';
import { Colors, FontFamily, FontSize, Spacing, Radius } from '../../theme';
import { formatDate } from '../../utils/formatters';
import {
  effectiveKycStatus,
  parseKycTier,
  isKycApproved,
  isKycPendingReview,
  isAutoKycInProgress,
} from '../../utils/kycGate';
import { navigateToKycFlowInProfile } from '../../utils/kycNavigation';
import type { KycMode } from '../../utils/kycNavigation';

type Props = {
  navigation: NativeStackNavigationProp<ProfileStackParamList, 'KYCStatus'>;
};

type StatusVisual = {
  heroIcon: string;
  accent: string;
  accentSoft: string;
  title: string;
  description: string;
  cta?: string;
};

const AUTO_KYC_IN_PROGRESS_UI: StatusVisual = {
  heroIcon: 'clock-outline',
  accent: Colors.warning,
  accentSoft: Colors.warningDim,
  title: 'Verification in progress',
  description:
    'Continue DigiLocker, PAN, or selfie verification in the app. Trading stays restricted until approved.',
  cta: 'Continue verification',
};

const STATUS_UI: Record<KYCStatus, StatusVisual> = {
  not_started: {
    heroIcon: 'shield-off-outline',
    accent: Colors.textMuted,
    accentSoft: Colors.surfaceHover,
    title: 'Identity not verified',
    description:
      'Complete KYC to unlock trading and wallet transfers. This usually takes a few minutes to submit.',
    cta: 'Start verification',
  },
  pending: {
    heroIcon: 'clock-outline',
    accent: Colors.warning,
    accentSoft: Colors.warningDim,
    title: 'Verification pending',
    description:
      'Your documents are queued for review. Trading and wallet transfers stay restricted until you are approved.',
  },
  under_review: {
    heroIcon: 'scan-helper',
    accent: Colors.info,
    accentSoft: Colors.infoDim,
    title: 'Under review',
    description:
      'Our team is reviewing your submission. Most reviews finish within 1–2 business days.',
  },
  approved: {
    heroIcon: 'shield-check-outline',
    accent: Colors.gold,
    accentSoft: Colors.goldAlpha10,
    title: 'Identity verified',
    description:
      'Your account meets compliance requirements. Trading and wallet features are fully available.',
  },
  rejected: {
    heroIcon: 'alert-circle-outline',
    accent: Colors.danger,
    accentSoft: Colors.dangerDim,
    title: 'Verification rejected',
    description:
      'Please read the reason below and submit a new application with clear, valid documents.',
    cta: 'Resubmit documents',
  },
  re_requested: {
    heroIcon: 'file-document-outline',
    accent: Colors.warning,
    accentSoft: Colors.warningDim,
    title: 'More information needed',
    description:
      'We need additional documents or details. Upload what is requested to continue verification.',
    cta: 'Continue verification',
  },
};

function resolveKycStatusUi(
  status: KYCStatus,
  rawStatus: string | undefined | null,
  kycMode: KycMode | null,
): StatusVisual {
  if (kycMode === 'auto' && isAutoKycInProgress(rawStatus)) {
    return AUTO_KYC_IN_PROGRESS_UI;
  }

  const base = STATUS_UI[status] ?? STATUS_UI.not_started;
  if (kycMode !== 'auto') return base;

  if (status === 'not_started') {
    return {
      ...base,
      heroIcon: 'link-variant',
      title: 'Instant verification available',
      description:
        'Verify with DigiLocker in a few minutes. PAN and selfie steps may follow if required by your account.',
      cta: 'Start with DigiLocker',
    };
  }

  if (status === 'rejected') {
    return {
      ...base,
      heroIcon: 'alert-circle-outline',
      accent: Colors.danger,
      accentSoft: Colors.dangerDim,
      title: 'Verification unsuccessful',
      description:
        'Restart instant verification with DigiLocker. Complete PAN or selfie steps again if prompted.',
      cta: 'Restart verification',
    };
  }

  if (status === 're_requested') {
    return {
      ...base,
      title: 'More information needed',
      description:
        'Continue instant verification with DigiLocker to provide the details we requested.',
      cta: 'Continue verification',
    };
  }

  return base;
}

const TIER_BENEFITS = [
  { tier: 1, name: 'Basic', withdraw: '$10,000/day', trading: 'Spot trading', badge: '🥉' },
  { tier: 2, name: 'Standard', withdraw: '$50,000/day', trading: 'Spot + Futures', badge: '🥈' },
  { tier: 3, name: 'Advanced', withdraw: 'Unlimited', trading: 'All products', badge: '🥇' },
];

const ACCESS_ROWS = [
  {
    id: 'trading',
    title: 'Trading',
    subtitle: 'Spot, options, and futures',
    icon: 'chart-line',
  },
  {
    id: 'wallet',
    title: 'Wallet',
    subtitle: 'Deposits and withdrawals',
    icon: 'wallet-outline',
  },
] as const;

function statusDisplayLabel(s: KYCStatus): string {
  const labels: Record<KYCStatus, string> = {
    not_started: 'Not started',
    pending: 'Pending',
    under_review: 'Under review',
    approved: 'Approved',
    rejected: 'Rejected',
    re_requested: 'Action needed',
  };
  return labels[s] ?? s;
}

export default function KYCStatusScreen({ navigation }: Props) {
  const dispatch = useDispatch<AppDispatch>();
  const { kyc, user, kycMode, kycModeLoading } = useSelector((s: RootState) => s.auth);

  const load = useCallback(async () => {
    await dispatch(fetchKycThunk());
  }, [dispatch]);

  useEffect(() => {
    if (kycMode == null) load();
  }, [kycMode, load]);

  const status = effectiveKycStatus(kyc, user);
  const rawStatus = kyc?.rawStatus ?? user?.kyc_status;
  const ui = useMemo(
    () => resolveKycStatusUi(status, rawStatus, kycMode),
    [status, rawStatus, kycMode],
  );
  const currentTier = parseKycTier(kyc?.tier ?? user?.kyc_tier) ?? 0;
  const approved = isKycApproved(status);
  const pendingReview = isKycPendingReview(status);

  const accessHint = useMemo(() => {
    if (approved) return 'Your access matches an approved KYC on the server.';
    if (pendingReview) return 'Access opens automatically when status becomes approved.';
    return 'The app blocks sensitive actions until the server reports approved KYC.';
  }, [approved, pendingReview]);

  return (
    <SafeAreaWrapper>
      <View style={styles.topBar}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Text style={styles.backText}>‹</Text>
        </TouchableOpacity>
        <View style={styles.topBarTitleBlock}>
          <Text style={styles.pageTitle}>Verification</Text>
          <Text style={styles.pageSubtitle}>Identity & compliance</Text>
        </View>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.heroCard}>
          <View style={[styles.heroAccent, { backgroundColor: ui.accent }]} />
          <View style={styles.heroInner}>
            <View
              style={[
                styles.heroIconRing,
                { borderColor: ui.accent + '66', backgroundColor: ui.accentSoft },
              ]}
            >
              <Icon name={ui.heroIcon} size={36} color={ui.accent} />
            </View>
            <Text style={styles.heroTitle}>{ui.title}</Text>
            <Text style={styles.heroDesc}>{ui.description}</Text>

            <View style={styles.tierPillRow}>
              <View style={styles.tierPill}>
                <Text style={styles.tierPillLabel}>Current tier</Text>
                <Text style={styles.tierPillValue}>
                  {currentTier > 0 ? `Tier ${currentTier}` : 'Not assigned'}
                </Text>
              </View>
              <View style={[styles.statusChip, { borderColor: ui.accent + '55' }]}>
                <View style={[styles.statusDot, { backgroundColor: ui.accent }]} />
                <Text style={[styles.statusChipText, { color: ui.accent }]}>
                  {statusDisplayLabel(status)}
                </Text>
              </View>
            </View>

            {kyc?.rejection_reason && status === 'rejected' && (
              <View style={styles.rejectionBox}>
                <View style={styles.rejectionHead}>
                  <Icon name="alert-circle-outline" size={18} color={Colors.danger} />
                  <Text style={styles.rejectionHeadText}>Rejection reason</Text>
                </View>
                <Text style={styles.rejectionBody}>{kyc.rejection_reason}</Text>
              </View>
            )}

            {(kyc?.submitted_at || kyc?.approved_at) && (
              <View style={styles.metaGrid}>
                {kyc?.submitted_at ? (
                  <View style={styles.metaCell}>
                    <Text style={styles.metaLabel}>Submitted</Text>
                    <Text style={styles.metaValue}>{formatDate(kyc.submitted_at)}</Text>
                  </View>
                ) : null}
                {kyc?.approved_at ? (
                  <View style={styles.metaCell}>
                    <Text style={styles.metaLabel}>Approved</Text>
                    <Text style={styles.metaValue}>{formatDate(kyc.approved_at)}</Text>
                  </View>
                ) : null}
              </View>
            )}
          </View>
        </View>

        {ui.cta ? (
          kycMode == null && kycModeLoading ? (
            <View style={styles.ctaLoading}>
              <ActivityIndicator color={Colors.goldLight} />
              <Text style={styles.ctaLoadingText}>Loading verification options…</Text>
            </View>
          ) : (
            <Button
              title={ui.cta}
              onPress={() => navigateToKycFlowInProfile(navigation, kycMode, status)}
              fullWidth
              size="lg"
              endIcon={
                <Icon name="chevron-right" size={18} color={Colors.surfaceDark} style={{ marginLeft: 6 }} />
              }
            />
          )
        ) : null}

        <View style={styles.section}>
          <View style={styles.sectionHeadRow}>
            <Icon name="shield-check-outline" size={20} color={Colors.goldLight} />
            <Text style={styles.sectionTitle}>Platform access</Text>
          </View>
          <Text style={styles.sectionHint}>{accessHint}</Text>

          {ACCESS_ROWS.map(row => {
            const rowOk = approved;
            const rowPending = pendingReview;
            const stateIcon = rowOk
              ? 'check-circle-outline'
              : rowPending
                ? 'clock-outline'
                : 'shield-off-outline';
            const stateColor = rowOk
              ? Colors.success
              : rowPending
                ? Colors.warning
                : Colors.textMuted;
            const stateLabel = rowOk
              ? 'Available'
              : rowPending
                ? 'After approval'
                : 'Blocked';

            return (
              <View key={row.id} style={styles.accessRow}>
                <View style={styles.accessIconWrap}>
                  <Icon name={row.icon} size={22} color={Colors.goldLight} />
                </View>
                <View style={styles.accessMid}>
                  <Text style={styles.accessTitle}>{row.title}</Text>
                  <Text style={styles.accessSubtitle}>{row.subtitle}</Text>
                </View>
                <View style={styles.accessState}>
                  <Icon name={stateIcon} size={18} color={stateColor} />
                  <Text style={[styles.accessStateText, { color: stateColor }]}>{stateLabel}</Text>
                </View>
              </View>
            );
          })}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitlePlain}>Verification tiers</Text>
          <Text style={styles.sectionHint}>
            Illustrative limits — actual limits follow your account and compliance settings.
          </Text>

          <View style={styles.tierList}>
            {TIER_BENEFITS.map(t => {
              const unlocked = currentTier >= t.tier;
              return (
                <View key={t.tier}>
                  <View style={[styles.tierCard, unlocked && styles.tierCardActive]}>
                    <View style={styles.tierLeft}>
                      <Text style={styles.tierEmoji}>{t.badge}</Text>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.tierName}>
                          Tier {t.tier} — {t.name}
                        </Text>
                        <Text style={styles.tierDetail}>Withdraw: {t.withdraw}</Text>
                        <Text style={styles.tierDetail}>Trading: {t.trading}</Text>
                      </View>
                    </View>
                    {unlocked ? (
                      <View style={styles.activePill}>
                        <Icon name="check" size={14} color={Colors.goldLight} />
                        <Text style={styles.activePillText}>Active</Text>
                      </View>
                    ) : (
                      <View style={styles.lockedPill}>
                        <Text style={styles.lockedPillText}>Locked</Text>
                      </View>
                    )}
                  </View>
                </View>
              );
            })}
          </View>
        </View>

        <View style={{ height: Spacing[10] }} />
      </ScrollView>
    </SafeAreaWrapper>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  content: { paddingHorizontal: Spacing[5], paddingBottom: Spacing[6], gap: Spacing[5] },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing[4],
    paddingVertical: Spacing[3],
    borderBottomWidth: 1,
    borderBottomColor: Colors.surfaceBorder,
  },
  backBtn: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: Spacing[2],
  },
  backText: {
    fontFamily: FontFamily.semiBold,
    fontSize: 28,
    color: Colors.textSecondary,
    lineHeight: 32,
  },
  topBarTitleBlock: { flex: 1 },
  pageTitle: { fontFamily: FontFamily.bold, fontSize: FontSize.xl, color: Colors.textPrimary },
  pageSubtitle: {
    fontFamily: FontFamily.regular,
    fontSize: FontSize.xs,
    color: Colors.textMuted,
    marginTop: 2,
  },
  heroCard: {
    borderRadius: Radius.xl,
    backgroundColor: Colors.surfaceCard,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    overflow: 'hidden',
  },
  heroAccent: { height: 4, width: '100%' },
  heroInner: { padding: Spacing[5], alignItems: 'center' },
  heroIconRing: {
    width: 88,
    height: 88,
    borderRadius: 44,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing[4],
  },
  heroTitle: {
    fontFamily: FontFamily.bold,
    fontSize: FontSize['2xl'],
    color: Colors.textPrimary,
    textAlign: 'center',
    marginBottom: Spacing[2],
  },
  heroDesc: {
    fontFamily: FontFamily.regular,
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    textAlign: 'center',
    lineHeight: 21,
    maxWidth: 320,
  },
  tierPillRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: Spacing[2],
    marginTop: Spacing[5],
    width: '100%',
  },
  tierPill: {
    flexGrow: 1,
    minWidth: '40%',
    backgroundColor: Colors.surfaceHover,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    paddingVertical: Spacing[3],
    paddingHorizontal: Spacing[4],
  },
  tierPillLabel: {
    fontFamily: FontFamily.medium,
    fontSize: 10,
    color: Colors.textMuted,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  tierPillValue: { fontFamily: FontFamily.bold, fontSize: FontSize.base, color: Colors.textPrimary },
  statusChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: Spacing[3],
    paddingHorizontal: Spacing[4],
    borderRadius: Radius.lg,
    borderWidth: 1,
    backgroundColor: Colors.surfaceHover,
  },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  statusChipText: {
    fontFamily: FontFamily.semiBold,
    fontSize: FontSize.xs,
  },
  rejectionBox: {
    marginTop: Spacing[5],
    width: '100%',
    backgroundColor: Colors.dangerDim,
    borderRadius: Radius.lg,
    padding: Spacing[4],
    borderWidth: 1,
    borderColor: Colors.danger + '40',
  },
  rejectionHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing[2], marginBottom: Spacing[2] },
  rejectionHeadText: {
    fontFamily: FontFamily.semiBold,
    fontSize: FontSize.sm,
    color: Colors.danger,
  },
  rejectionBody: {
    fontFamily: FontFamily.regular,
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    lineHeight: 20,
  },
  metaGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing[3],
    marginTop: Spacing[5],
    width: '100%',
  },
  metaCell: {
    flex: 1,
    minWidth: '42%',
    backgroundColor: Colors.surfaceHover,
    borderRadius: Radius.md,
    padding: Spacing[3],
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
  },
  metaLabel: { fontFamily: FontFamily.medium, fontSize: 10, color: Colors.textMuted, marginBottom: 4 },
  metaValue: { fontFamily: FontFamily.semiBold, fontSize: FontSize.sm, color: Colors.textSecondary },
  section: { gap: Spacing[3] },
  sectionHeadRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing[2] },
  sectionTitle: {
    fontFamily: FontFamily.bold,
    fontSize: FontSize.lg,
    color: Colors.textPrimary,
  },
  sectionTitlePlain: {
    fontFamily: FontFamily.bold,
    fontSize: FontSize.lg,
    color: Colors.textPrimary,
  },
  sectionHint: {
    fontFamily: FontFamily.regular,
    fontSize: FontSize.xs,
    color: Colors.textMuted,
    lineHeight: 18,
    marginTop: -Spacing[1],
  },
  accessRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surfaceCard,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    borderRadius: Radius.lg,
    paddingVertical: Spacing[4],
    paddingHorizontal: Spacing[3],
    gap: Spacing[3],
  },
  accessIconWrap: {
    width: 44,
    height: 44,
    borderRadius: Radius.md,
    backgroundColor: Colors.goldAlpha10,
    borderWidth: 1,
    borderColor: Colors.goldAlpha30,
    alignItems: 'center',
    justifyContent: 'center',
  },
  accessMid: { flex: 1, minWidth: 0 },
  accessTitle: { fontFamily: FontFamily.semiBold, fontSize: FontSize.sm, color: Colors.textPrimary },
  accessSubtitle: {
    fontFamily: FontFamily.regular,
    fontSize: FontSize.xs,
    color: Colors.textMuted,
    marginTop: 2,
  },
  accessState: { alignItems: 'flex-end', gap: 2 },
  accessStateText: { fontFamily: FontFamily.semiBold, fontSize: 10, textTransform: 'uppercase' },
  tierList: { gap: Spacing[2] },
  tierCard: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: Colors.surfaceCard,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    borderRadius: Radius.lg,
    padding: Spacing[4],
  },
  tierCardActive: {
    borderColor: Colors.goldAlpha30,
    backgroundColor: Colors.goldAlpha10,
  },
  tierLeft: { flexDirection: 'row', alignItems: 'center', gap: Spacing[3], flex: 1 },
  tierEmoji: { fontSize: 26 },
  tierName: { fontFamily: FontFamily.semiBold, fontSize: FontSize.sm, color: Colors.textPrimary },
  tierDetail: {
    fontFamily: FontFamily.regular,
    fontSize: FontSize.xs,
    color: Colors.textMuted,
    lineHeight: 17,
    marginTop: 2,
  },
  activePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: Colors.goldAlpha15,
    borderWidth: 1,
    borderColor: Colors.goldAlpha30,
    borderRadius: Radius.full,
    paddingHorizontal: Spacing[3],
    paddingVertical: 5,
  },
  activePillText: { fontFamily: FontFamily.semiBold, fontSize: FontSize.xs, color: Colors.goldLight },
  lockedPill: {
    backgroundColor: Colors.surfaceHover,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    borderRadius: Radius.full,
    paddingHorizontal: Spacing[3],
    paddingVertical: 5,
  },
  lockedPillText: { fontFamily: FontFamily.medium, fontSize: FontSize.xs, color: Colors.textMuted },
  ctaLoading: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing[3],
    paddingVertical: Spacing[4],
  },
  ctaLoadingText: {
    fontFamily: FontFamily.regular,
    fontSize: FontSize.sm,
    color: Colors.textMuted,
  },
});
