import React, { useState, useEffect } from 'react';
import {
  View, Text, ScrollView, StyleSheet,
} from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { SafeAreaView } from 'react-native-safe-area-context';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { ProfileStackParamList } from '../../navigation/types';
import { authApi } from '../../api/auth.api';
import { parseApiError } from '../../api/errors';
import { TwoFAStatus } from '../../types/auth.types';
import ProfileSubHeader from '../../components/profile/ProfileSubHeader';
import { profileStyles } from '../../components/profile/profileStyles';
import Input from '../../components/common/Input';
import Button from '../../components/common/Button';
import ErrorBanner from '../../components/common/ErrorBanner';
import Icon from '../../components/common/AppIcon';
import { Colors, FontFamily, FontSize, Spacing, Radius } from '../../theme';
import { iosManualKeyboardScrollProps } from '@/utils/iosKeyboardScroll';

type Props = {
  navigation: NativeStackNavigationProp<ProfileStackParamList, 'Security'>;
};

type Step = 'status' | 'setup_qr' | 'setup_verify' | 'disable';

const SETUP_STEPS = [
  { key: 'setup_qr', label: 'Scan', icon: 'qr-code-scan' },
  { key: 'setup_verify', label: 'Verify', icon: 'numeric' },
] as const;

function StepHeader({
  icon, title, subtitle,
}: {
  icon: string;
  title: string;
  subtitle: string;
}) {
  return (
    <View style={styles.stepHeader}>
      <View style={styles.stepIconBox}>
        <Icon name={icon} size={22} color={Colors.goldLight} />
      </View>
      <View style={styles.stepHeaderText}>
        <Text style={styles.stepTitle}>{title}</Text>
        <Text style={styles.stepSubtitle}>{subtitle}</Text>
      </View>
    </View>
  );
}

function InfoRow({ icon, text }: { icon: string; text: string }) {
  return (
    <View style={styles.infoRow}>
      <View style={styles.infoIcon}>
        <Icon name={icon} size={16} color={Colors.goldLight} />
      </View>
      <Text style={styles.infoText}>{text}</Text>
    </View>
  );
}

function SetupStepper({ activeStep }: { activeStep: 'setup_qr' | 'setup_verify' }) {
  const activeIdx = activeStep === 'setup_verify' ? 1 : 0;
  return (
    <View style={styles.stepper}>
      {SETUP_STEPS.map((s, i) => {
        const done = i < activeIdx;
        const active = i === activeIdx;
        return (
          <React.Fragment key={s.key}>
            <View style={styles.stepperItem}>
              <View style={[
                styles.stepperDot,
                done && styles.stepperDotDone,
                active && styles.stepperDotActive,
              ]}>
                {done ? (
                  <Icon name="check" size={12} color={Colors.surfaceDark} />
                ) : (
                  <Icon name={s.icon} size={14} color={active ? Colors.goldLight : Colors.textMuted} />
                )}
              </View>
              <Text style={[styles.stepperLabel, active && styles.stepperLabelActive]}>
                {s.label}
              </Text>
            </View>
            {i < SETUP_STEPS.length - 1 && (
              <View style={[styles.stepperLine, done && styles.stepperLineDone]} />
            )}
          </React.Fragment>
        );
      })}
    </View>
  );
}

export default function SecurityScreen({ navigation }: Props) {
  const [status, setStatus] = useState<TwoFAStatus | null>(null);
  const [otpauthUrl, setOtpauthUrl] = useState('');
  const [secret, setSecret] = useState('');
  const [code, setCode] = useState('');
  const [disablePassword, setDisablePassword] = useState('');
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [actionLoading, setActionLoading] = useState(false);
  const [banner, setBanner] = useState('');
  const [bannerType, setBannerType] = useState<'error' | 'success'>('error');
  const [step, setStep] = useState<Step>('status');

  useEffect(() => {
    loadStatus();
  }, []);

  const loadStatus = async () => {
    try {
      const { data } = await authApi.get2FAStatus();
      setStatus(data);
    } catch {
      setBannerType('error');
      setBanner('Failed to load 2FA status');
    }
  };

  const beginSetup = async () => {
    setActionLoading(true);
    setBanner('');
    try {
      const { data } = await authApi.setup2FA();
      if (!data.otpauth_url || !data.secret_b32) {
        setBannerType('error');
        setBanner('Setup response was incomplete. Please try again.');
        return;
      }
      setOtpauthUrl(data.otpauth_url);
      setSecret(data.secret_b32);
      setStep('setup_qr');
    } catch (err) {
      setBannerType('error');
      setBanner(parseApiError(err).message);
    } finally {
      setActionLoading(false);
    }
  };

  const handleSetup = () => {
    beginSetup();
  };

  const handleContinueSetup = () => {
    beginSetup();
  };

  const handleVerify = async () => {
    if (code.length !== 6) {
      setBannerType('error');
      setBanner('Enter the 6-digit code from your authenticator');
      return;
    }
    setActionLoading(true);
    setBanner('');
    try {
      const { data } = await authApi.verify2FA(code);
      if (data.backup_codes?.length) setBackupCodes(data.backup_codes);
      setBannerType('success');
      setBanner('2FA enabled successfully!');
      setStatus({
        enabled: true,
        pending_setup: false,
        has_backup_codes: (data.backup_codes?.length ?? 0) > 0,
        backup_codes_remaining: data.backup_codes?.length ?? 0,
      });
      setStep('status');
      setCode('');
      setOtpauthUrl('');
      setSecret('');
    } catch (err) {
      setBannerType('error');
      setBanner(parseApiError(err).message);
    } finally {
      setActionLoading(false);
    }
  };

  const handleDisable = async () => {
    if (!disablePassword.trim()) {
      setBannerType('error');
      setBanner('Enter your account password to disable 2FA');
      return;
    }
    if (code.length !== 6) {
      setBannerType('error');
      setBanner('Enter the 6-digit code from your authenticator');
      return;
    }
    setActionLoading(true);
    setBanner('');
    try {
      await authApi.disable2FA({ password: disablePassword, code });
      setBannerType('success');
      setBanner('2FA has been disabled.');
      setStatus({ enabled: false, pending_setup: false });
      setStep('status');
      setCode('');
      setDisablePassword('');
    } catch (err) {
      setBannerType('error');
      setBanner(parseApiError(err).message);
    } finally {
      setActionLoading(false);
    }
  };

  const enabled = Boolean(status?.enabled);
  const pendingSetup = Boolean(status?.pending_setup && !enabled);
  const inSetup = step === 'setup_qr' || step === 'setup_verify';

  return (
    <SafeAreaView style={profileStyles.screen} edges={['top']}>
      <ProfileSubHeader title="Two-Factor Auth" onBack={() => navigation.goBack()} />

      <ScrollView
        style={styles.flex}
        contentContainerStyle={profileStyles.content}
        showsVerticalScrollIndicator={false}
        {...iosManualKeyboardScrollProps()}
      >
        <View style={styles.heroCard}>
          <View style={[styles.heroIconRing, enabled ? styles.heroIconRingOn : styles.heroIconRingOff]}>
            <Icon
              name={enabled ? 'shield-check-outline' : 'shield-off-outline'}
              size={36}
              color={enabled ? Colors.success : Colors.textMuted}
            />
          </View>
          <Text style={styles.heroTitle}>Authenticator protection</Text>
          <Text style={styles.heroSub}>
            {enabled
              ? 'Your account is protected with time-based one-time codes.'
              : 'Add TOTP codes from Google Authenticator, Authy, or similar apps.'}
          </Text>
          <View style={[
            styles.statusPill,
            enabled ? styles.statusPillOn : styles.statusPillOff,
          ]}>
            <Icon
              name={enabled ? 'check-circle-outline' : 'shield-off-outline'}
              size={14}
              color={enabled ? Colors.success : Colors.danger}
            />
            <Text style={[styles.statusPillText, { color: enabled ? Colors.success : Colors.danger }]}>
              {enabled ? '2FA enabled' : '2FA disabled'}
            </Text>
          </View>
        </View>

        {banner ? <ErrorBanner message={banner} type={bannerType} /> : null}

        {backupCodes.length > 0 && (
          <View style={styles.backupCard}>
            <View style={styles.backupHeader}>
              <View style={styles.backupIcon}>
                <Icon name="key-variant" size={18} color={Colors.warning} />
              </View>
              <Text style={styles.backupTitle}>Save your backup codes</Text>
            </View>
            <Text style={styles.backupSub}>
              Store these in a safe place. Each code can only be used once.
            </Text>
            <View style={styles.codesGrid}>
              {backupCodes.map((c, i) => (
                <View key={i} style={styles.codeChip}>
                  <Text style={styles.codeChipText}>{c}</Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {inSetup && (
          <SetupStepper activeStep={step as 'setup_qr' | 'setup_verify'} />
        )}

        {step === 'status' && (
          <>
            <View style={[profileStyles.card, profileStyles.cardPad]}>
              <Text style={styles.inlineSectionTitle}>How it works</Text>
              <InfoRow
                icon="cellphone-key"
                text="Install an authenticator app on your phone"
              />
              <InfoRow
                icon="qr-code-scan"
                text="Scan the QR code or enter the setup key manually"
              />
              <InfoRow
                icon="numeric"
                text="Enter the 6-digit code each time you sign in"
              />
            </View>

            <View style={[profileStyles.card, profileStyles.cardPad]}>
              <StepHeader
                icon="shield-key-outline"
                title="Authenticator app"
                subtitle="TOTP-based two-factor authentication"
              />
              <Text style={styles.bodyText}>
                {enabled
                  ? 'Two-factor authentication is active. A code from your authenticator is required on every sign-in.'
                  : 'Enable 2FA to require a time-based code in addition to your password when signing in.'}
              </Text>
              {enabled ? (
                <Button
                  title="Disable 2FA"
                  variant="outline"
                  onPress={() => { setStep('disable'); setBanner(''); setCode(''); setDisablePassword(''); }}
                  fullWidth
                  endIcon={<Icon name="shield-off-outline" size={16} color={Colors.textPrimary} />}
                />
              ) : pendingSetup ? (
                <Button
                  title="Continue 2FA setup"
                  onPress={handleContinueSetup}
                  loading={actionLoading}
                  fullWidth
                  endIcon={<Icon name="qr-code-scan" size={16} color={Colors.surfaceDark} />}
                />
              ) : (
                <Button
                  title="Enable 2FA"
                  onPress={handleSetup}
                  loading={actionLoading}
                  fullWidth
                  endIcon={<Icon name="shield-check-outline" size={16} color={Colors.surfaceDark} />}
                />
              )}
            </View>
          </>
        )}

        {step === 'setup_qr' && (
          <View style={[profileStyles.card, profileStyles.cardPad]}>
            <StepHeader
              icon="qr-code-scan"
              title="Scan QR code"
              subtitle="Link your authenticator app"
            />
            <Text style={styles.bodyText}>
              Open Google Authenticator, Authy, or any TOTP app and scan this code.
            </Text>

            <View style={styles.qrFrame}>
              <View style={styles.qrCornerTL} />
              <View style={styles.qrCornerTR} />
              <View style={styles.qrCornerBL} />
              <View style={styles.qrCornerBR} />
              <View style={styles.qrInner}>
                {otpauthUrl ? (
                  <View style={styles.qrCanvas}>
                    <QRCode
                      value={otpauthUrl}
                      size={188}
                      color="#000000"
                      backgroundColor="#FFFFFF"
                      quietZone={8}
                    />
                  </View>
                ) : (
                  <Text style={styles.qrMissing}>QR unavailable — use the manual key below</Text>
                )}
              </View>
            </View>

            <View style={styles.secretBox}>
              <View style={styles.secretHead}>
                <Icon name="key-variant" size={14} color={Colors.goldLight} />
                <Text style={styles.secretLabel}>Manual entry key</Text>
              </View>
              <Text style={styles.secretText} selectable>{secret}</Text>
            </View>

            <View style={styles.flowActions}>
              <Button
                title="Back"
                variant="ghost"
                onPress={() => { setStep('status'); setBanner(''); setOtpauthUrl(''); setSecret(''); }}
                style={styles.flowBtn}
              />
              <Button
                title="Next"
                onPress={() => { setStep('setup_verify'); setBanner(''); }}
                fullWidth
                style={styles.flowBtnFlex}
                endIcon={<Icon name="arrow-right" size={16} color={Colors.surfaceDark} />}
              />
            </View>
          </View>
        )}

        {step === 'setup_verify' && (
          <View style={[profileStyles.card, profileStyles.cardPad]}>
            <StepHeader
              icon="numeric"
              title="Verify setup"
              subtitle="Confirm your authenticator works"
            />
            <Text style={styles.bodyText}>
              Enter the 6-digit code currently shown in your authenticator app.
            </Text>
            <Input
              label="Verification code"
              placeholder="000000"
              value={code}
              onChangeText={setCode}
              keyboardType="numeric"
              maxLength={6}
            />
            <View style={styles.flowActions}>
              <Button
                title="Back"
                variant="ghost"
                onPress={() => { setStep('setup_qr'); setBanner(''); setCode(''); }}
                style={styles.flowBtn}
              />
              <Button
                title="Verify & enable"
                onPress={handleVerify}
                loading={actionLoading}
                fullWidth
                style={styles.flowBtnFlex}
                endIcon={<Icon name="check-circle-outline" size={16} color={Colors.surfaceDark} />}
              />
            </View>
          </View>
        )}

        {step === 'disable' && (
          <View style={[profileStyles.card, profileStyles.cardPad]}>
            <StepHeader
              icon="shield-off-outline"
              title="Disable 2FA"
              subtitle="This reduces account security"
            />
            <View style={styles.warnBox}>
              <Icon name="alert-circle-outline" size={18} color={Colors.warning} />
              <Text style={styles.warnText}>
                Disabling 2FA removes the extra sign-in code requirement. Only proceed if you are sure.
              </Text>
            </View>
            <Input
              label="Account password"
              placeholder="Your current password"
              value={disablePassword}
              onChangeText={setDisablePassword}
              secureTextEntry
            />
            <Input
              label="Current 2FA code"
              placeholder="000000"
              value={code}
              onChangeText={setCode}
              keyboardType="numeric"
              maxLength={6}
            />
            <View style={styles.flowActions}>
              <Button
                title="Cancel"
                variant="ghost"
                onPress={() => { setStep('status'); setBanner(''); setCode(''); setDisablePassword(''); }}
                style={styles.flowBtn}
              />
              <Button
                title="Disable"
                variant="danger"
                onPress={handleDisable}
                loading={actionLoading}
                fullWidth
                style={styles.flowBtnFlex}
                endIcon={<Icon name="shield-off-outline" size={16} color={Colors.danger} />}
              />
            </View>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const CORNER = {
  position: 'absolute' as const,
  width: 18,
  height: 18,
  borderColor: Colors.goldAlpha30,
};

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  heroCard: {
    backgroundColor: Colors.goldAlpha10,
    borderWidth: 1,
    borderColor: Colors.goldAlpha30,
    borderRadius: Radius.xl,
    padding: Spacing[5],
    alignItems: 'center',
    marginBottom: Spacing[1],
  },
  heroIconRing: {
    width: 72,
    height: 72,
    borderRadius: 36,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing[3],
  },
  heroIconRingOn: {
    backgroundColor: Colors.successDim,
    borderColor: Colors.success + '50',
  },
  heroIconRingOff: {
    backgroundColor: Colors.surfaceCard,
    borderColor: Colors.surfaceBorder,
  },
  heroTitle: {
    fontFamily: FontFamily.bold,
    fontSize: FontSize.lg,
    color: Colors.textPrimary,
    textAlign: 'center',
    marginBottom: 4,
  },
  heroSub: {
    fontFamily: FontFamily.regular,
    fontSize: FontSize.sm,
    color: Colors.textMuted,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: Spacing[3],
    paddingHorizontal: Spacing[2],
  },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: Spacing[3],
    paddingVertical: 6,
    borderRadius: Radius.full,
    borderWidth: 1,
  },
  statusPillOn: {
    backgroundColor: Colors.successDim,
    borderColor: Colors.success + '40',
  },
  statusPillOff: {
    backgroundColor: Colors.dangerDim,
    borderColor: Colors.danger + '40',
  },
  statusPillText: {
    fontFamily: FontFamily.semiBold,
    fontSize: FontSize.xs,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: Spacing[2],
    marginBottom: Spacing[1],
  },
  stepperItem: { alignItems: 'center', width: 72 },
  stepperDot: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    backgroundColor: Colors.surfaceCard,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  stepperDotActive: {
    backgroundColor: Colors.goldAlpha15,
    borderColor: Colors.goldAlpha30,
  },
  stepperDotDone: {
    backgroundColor: Colors.gold,
    borderColor: Colors.gold,
  },
  stepperLabel: {
    fontFamily: FontFamily.medium,
    fontSize: 9,
    color: Colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  stepperLabelActive: { color: Colors.goldLight },
  stepperLine: {
    flex: 1,
    height: 2,
    backgroundColor: Colors.surfaceBorder,
    marginHorizontal: Spacing[1],
    marginBottom: 18,
    maxWidth: 48,
  },
  stepperLineDone: { backgroundColor: Colors.goldAlpha30 },
  stepHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing[3],
    marginBottom: Spacing[4],
  },
  stepIconBox: {
    width: 44,
    height: 44,
    borderRadius: Radius.lg,
    backgroundColor: Colors.goldAlpha15,
    borderWidth: 1,
    borderColor: Colors.goldAlpha30,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepHeaderText: { flex: 1, minWidth: 0 },
  stepTitle: {
    fontFamily: FontFamily.semiBold,
    fontSize: FontSize.base,
    color: Colors.textPrimary,
    marginBottom: 2,
  },
  stepSubtitle: {
    fontFamily: FontFamily.regular,
    fontSize: FontSize.xs,
    color: Colors.textMuted,
    lineHeight: 16,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing[3],
    marginBottom: Spacing[3],
  },
  infoIcon: {
    width: 32,
    height: 32,
    borderRadius: Radius.md,
    backgroundColor: Colors.goldAlpha15,
    borderWidth: 1,
    borderColor: Colors.goldAlpha30,
    alignItems: 'center',
    justifyContent: 'center',
  },
  infoText: {
    flex: 1,
    fontFamily: FontFamily.regular,
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    lineHeight: 20,
    paddingTop: 6,
  },
  bodyText: {
    fontFamily: FontFamily.regular,
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    lineHeight: 20,
    marginBottom: Spacing[4],
  },
  inlineSectionTitle: {
    fontFamily: FontFamily.semiBold,
    fontSize: FontSize.xs,
    color: Colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginBottom: Spacing[3],
  },
  qrFrame: {
    alignSelf: 'center',
    padding: Spacing[3],
    marginBottom: Spacing[4],
    position: 'relative',
  },
  qrCornerTL: { ...CORNER, top: 0, left: 0, borderTopWidth: 2, borderLeftWidth: 2, borderTopLeftRadius: 8 },
  qrCornerTR: { ...CORNER, top: 0, right: 0, borderTopWidth: 2, borderRightWidth: 2, borderTopRightRadius: 8 },
  qrCornerBL: { ...CORNER, bottom: 0, left: 0, borderBottomWidth: 2, borderLeftWidth: 2, borderBottomLeftRadius: 8 },
  qrCornerBR: { ...CORNER, bottom: 0, right: 0, borderBottomWidth: 2, borderRightWidth: 2, borderBottomRightRadius: 8 },
  qrInner: {
    width: 220,
    height: 220,
    borderRadius: Radius.lg,
    backgroundColor: Colors.surfaceHover,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  qrCanvas: {
    backgroundColor: Colors.white,
    borderRadius: Radius.md,
    padding: 4,
  },
  qrMissing: {
    fontFamily: FontFamily.regular,
    fontSize: FontSize.xs,
    color: Colors.textMuted,
    textAlign: 'center',
    paddingHorizontal: Spacing[3],
  },
  secretBox: {
    backgroundColor: Colors.surfaceHover,
    borderRadius: Radius.lg,
    padding: Spacing[3],
    marginBottom: Spacing[4],
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
  },
  secretHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: Spacing[2],
  },
  secretLabel: {
    fontFamily: FontFamily.medium,
    fontSize: FontSize.xs,
    color: Colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  secretText: {
    fontFamily: FontFamily.mono,
    fontSize: FontSize.sm,
    color: Colors.goldLight,
    letterSpacing: 1,
    lineHeight: 20,
  },
  backupCard: {
    backgroundColor: Colors.warningDim,
    borderWidth: 1,
    borderColor: Colors.warning + '40',
    borderRadius: Radius.xl,
    padding: Spacing[4],
  },
  backupHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing[2],
    marginBottom: 4,
  },
  backupIcon: {
    width: 32,
    height: 32,
    borderRadius: Radius.md,
    backgroundColor: Colors.surfaceCard,
    borderWidth: 1,
    borderColor: Colors.warning + '40',
    alignItems: 'center',
    justifyContent: 'center',
  },
  backupTitle: {
    fontFamily: FontFamily.bold,
    fontSize: FontSize.base,
    color: Colors.warning,
    flex: 1,
  },
  backupSub: {
    fontFamily: FontFamily.regular,
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    marginBottom: Spacing[4],
    lineHeight: 18,
  },
  codesGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing[2] },
  codeChip: {
    backgroundColor: Colors.surfaceCard,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing[3],
    paddingVertical: Spacing[2],
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
  },
  codeChipText: {
    fontFamily: FontFamily.mono,
    fontSize: FontSize.sm,
    color: Colors.textPrimary,
  },
  warnBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing[3],
    backgroundColor: Colors.warningDim,
    borderWidth: 1,
    borderColor: Colors.warning + '40',
    borderRadius: Radius.lg,
    padding: Spacing[3],
    marginBottom: Spacing[4],
  },
  warnText: {
    flex: 1,
    fontFamily: FontFamily.regular,
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    lineHeight: 18,
  },
  flowActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing[2],
  },
  flowBtn: { minWidth: 88 },
  flowBtnFlex: { flex: 1 },
});
