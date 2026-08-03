import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Platform,
} from 'react-native';
import { useDispatch, useSelector } from 'react-redux';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RouteProp } from '@react-navigation/native';
import { AuthStackParamList } from '../../navigation/types';
import StorageService from '../../services/storage.service';
import { STORAGE_KEYS } from '../../config/storageKeys';
import {
  loginThunk,
  verifyRegisterEmailThunk,
  verifyRegisterMobileThunk,
  registerCompleteThunk,
  clearError,
} from '../../store/auth.slice';
import { AppDispatch, RootState } from '../../store';
import { authApi } from '../../api/auth.api';
import Input from '../../components/common/Input';
import Button from '../../components/common/Button';
import ErrorBanner from '../../components/common/ErrorBanner';
import AuthShell, { AuthShellTab } from '../../components/auth/AuthShell';
import OtpInlineButton from '../../components/auth/OtpInlineButton';
import AuthOtpInlineField from '../../components/auth/AuthOtpInlineField';
import AppIcon from '../../components/common/AppIcon';
import { Colors, FontFamily, FontSize, Spacing, Radius } from '../../theme';
import {
  validateAuthEmail,
  validateAuthPassword,
  validateStrongPassword,
  validateName,
  validateSignupMobile,
} from '../../utils/validation/auth.validation';
import { parseApiError } from '../../api/errors';
import { useSignupOtpConfig } from '../../hooks/useSignupOtpConfig';
import { ApiError } from '../../types/api.types';

type Props = {
  navigation: NativeStackNavigationProp<AuthStackParamList, 'Login'>;
  route?: RouteProp<AuthStackParamList, 'Login' | 'Register'>;
};

function mapRegisterApiErrors(err: unknown): { message: string; fields: Record<string, string> } {
  const apiErr = err instanceof ApiError ? err : parseApiError(err);
  const fields: Record<string, string> = {};
  if (apiErr.fieldErrors) {
    const fe = apiErr.fieldErrors;
    if (fe.name) fields.name = fe.name;
    if (fe.email) fields.email = fe.email;
    if (fe.mobile || fe.phone) fields.mobile = fe.mobile || fe.phone || '';
    if (fe.password) fields.password = fe.password;
  }
  return { message: apiErr.message, fields };
}

function VerifiedChip() {
  return (
    <View style={styles.verifiedChip}>
      <AppIcon name="check-circle" size={12} color={Colors.buyGreen} />
      <Text style={styles.verifiedTxt}>Verified</Text>
    </View>
  );
}

export default function LoginScreen({ navigation, route }: Props) {
  const dispatch = useDispatch<AppDispatch>();
  const { loginLoading, error } = useSelector((s: RootState) => s.auth);

  const deepLinkRef = route?.params?.ref;
  const [tab, setTab] = useState<AuthShellTab>(deepLinkRef ? 'register' : 'login');
  const [regReferralCode, setRegReferralCode] = useState(deepLinkRef || '');

  // Capture a referral code shared via deep link (ibo://register?ref=CODE)
  // and persist it so it also survives navigating away and back.
  useEffect(() => {
    if (deepLinkRef) {
      const code = String(deepLinkRef).trim().toUpperCase();
      setRegReferralCode(code);
      StorageService.set(STORAGE_KEYS.REFERRAL_CODE, code);
      setTab('register');
    } else {
      StorageService.get(STORAGE_KEYS.REFERRAL_CODE).then((stored) => {
        if (stored) setRegReferralCode(stored);
      });
    }
  }, [deepLinkRef]);

  // ── Login ───────────────────────────────────────────────────────────────────
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [loginErrors, setLoginErrors] = useState<Record<string, string>>({});

  // ── Register (single screen — mirrors web RegisterPage) ─────────────────────
  const [regEmail, setRegEmail] = useState('');
  const [regEmailOtp, setRegEmailOtp] = useState('');
  const [regEmailOtpSent, setRegEmailOtpSent] = useState(false);
  const [regEmailVerified, setRegEmailVerified] = useState(false);

  const [regMobile, setRegMobile] = useState('');
  const [regSmsOtp, setRegSmsOtp] = useState('');
  const [regSmsOtpSent, setRegSmsOtpSent] = useState(false);
  const [regSmsVerified, setRegSmsVerified] = useState(false);

  const signupOtp = useSignupOtpConfig();
  const {
    loaded: serviceConfigLoaded,
    emailOtpEnabled,
    smsOtpEnabled,
    defaultCountryCode,
  } = signupOtp;

  const [countryCode, setCountryCode] = useState('91');
  const [phoneHint, setPhoneHint] = useState('');

  const [regName, setRegName] = useState('');
  const [regPassword, setRegPassword] = useState('');
  const [regConfirm, setRegConfirm] = useState('');

  const [regErrors, setRegErrors] = useState<Record<string, string>>({});
  const [regBannerError, setRegBannerError] = useState('');
  const [regSuccess, setRegSuccess] = useState('');

  const [emailSendLoading, setEmailSendLoading] = useState(false);
  const [emailVerifyLoading, setEmailVerifyLoading] = useState(false);
  const [smsSendLoading, setSmsSendLoading] = useState(false);
  const [smsVerifyLoading, setSmsVerifyLoading] = useState(false);

  useEffect(() => {
    if (defaultCountryCode) {
      setCountryCode(defaultCountryCode);
    }
  }, [defaultCountryCode]);

  const resetRegister = useCallback(() => {
    setRegEmail('');
    setRegEmailOtp('');
    setRegEmailOtpSent(false);
    setRegEmailVerified(false);
    setRegMobile('');
    setRegSmsOtp('');
    setRegSmsOtpSent(false);
    setRegSmsVerified(false);
    setPhoneHint('');
    setRegName('');
    setRegPassword('');
    setRegConfirm('');
    setRegErrors({});
    setRegBannerError('');
    setRegSuccess('');
  }, []);

  const handleTabChange = (next: AuthShellTab) => {
    setTab(next);
    dispatch(clearError());
    setLoginErrors({});
    resetRegister();
  };

  const linkRegisterContact = useCallback(() => ({
    email: regEmail.trim().toLowerCase(),
    mobile: regMobile.replace(/\D/g, ''),
    country_code: countryCode,
  }), [regEmail, regMobile, countryCode]);

  const clearRegFieldError = (key: string) => {
    setRegErrors(prev => {
      if (!prev[key]) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  // ── Login submit ────────────────────────────────────────────────────────────
  const handleLogin = () => {
    const errs: Record<string, string> = {};
    const emailErr = validateAuthEmail(loginEmail);
    const pwErr = validateAuthPassword(loginPassword);
    if (emailErr) errs.email = emailErr;
    if (pwErr) errs.password = pwErr;
    setLoginErrors(errs);
    if (Object.keys(errs).length > 0) return;
    dispatch(clearError());
    dispatch(loginThunk({ email: loginEmail.trim().toLowerCase(), password: loginPassword }));
  };

  // ── Register: email OTP ─────────────────────────────────────────────────────
  const handleSendEmailOtp = async () => {
    dispatch(clearError());
    const emailErr = validateAuthEmail(regEmail);
    if (emailErr) {
      setRegErrors({ email: emailErr });
      return;
    }
    setRegErrors({});
    setRegBannerError('');
    setRegSuccess('');
    setEmailSendLoading(true);
    try {
      const { email, mobile, country_code } = linkRegisterContact();
      const { data } = await authApi.requestRegisterEmailOtp({
        email, mobile, country_code,
        referral_code: regReferralCode.trim() || undefined,
      });
      if (data.phone_hint) setPhoneHint(data.phone_hint);
      setRegEmailOtpSent(true);
      setRegEmailOtp('');
      setRegSuccess(data.message || 'Verification code sent to your email.');
    } catch (err) {
      const { message, fields } = mapRegisterApiErrors(err);
      setRegErrors(prev => ({ ...prev, ...fields }));
      setRegBannerError(message);
    } finally {
      setEmailSendLoading(false);
    }
  };

  const handleVerifyEmailOtp = async () => {
    dispatch(clearError());
    if (!regEmailOtp || regEmailOtp.replace(/\D/g, '').length < 6) {
      setRegErrors({ emailOtp: 'Enter the 6-digit email code' });
      return;
    }
    setRegErrors({});
    setRegBannerError('');
    setRegSuccess('');
    setEmailVerifyLoading(true);
    try {
      await dispatch(verifyRegisterEmailThunk({
        email: regEmail.trim().toLowerCase(),
        code: regEmailOtp.trim(),
      })).unwrap();
      setRegEmailVerified(true);
      setRegSuccess('Email verified. You can verify your mobile next.');
    } catch (err) {
      const msg = typeof err === 'string' ? err : parseApiError(err).message;
      setRegBannerError(msg);
    } finally {
      setEmailVerifyLoading(false);
    }
  };

  const handleResendEmailOtp = async () => {
    setRegBannerError('');
    setRegSuccess('');
    setEmailSendLoading(true);
    try {
      await authApi.resendRegisterOtp(regEmail.trim().toLowerCase(), 'email');
      setRegEmailOtp('');
      setRegSuccess('A new code has been sent to your email.');
    } catch (err) {
      setRegBannerError(parseApiError(err).message);
    } finally {
      setEmailSendLoading(false);
    }
  };

  // ── Register: SMS OTP ───────────────────────────────────────────────────────
  const handleSendSmsOtp = async () => {
    dispatch(clearError());
    const mobileErr = validateSignupMobile(regMobile);
    if (mobileErr) {
      setRegErrors({ mobile: mobileErr });
      return;
    }
    setRegErrors({});
    setRegBannerError('');
    setRegSuccess('');
    setSmsSendLoading(true);
    try {
      const { email, mobile, country_code } = linkRegisterContact();
      let data;
      if (regSmsOtpSent && !regSmsVerified) {
        const res = await authApi.resendRegisterOtp(email, 'sms');
        data = res.data;
      } else {
        const res = await authApi.sendRegisterMobileOtp({
          mobile,
          email: email || undefined,
          country_code,
        });
        data = res.data;
      }
      if (data.phone_hint) setPhoneHint(data.phone_hint);
      setRegSmsOtpSent(true);
      setRegSmsOtp('');
      setRegSuccess(data.message || 'SMS code sent.');
    } catch (err) {
      setRegBannerError(parseApiError(err).message);
    } finally {
      setSmsSendLoading(false);
    }
  };

  const handleVerifySmsOtp = async () => {
    dispatch(clearError());
    if (!regSmsOtp || regSmsOtp.replace(/\D/g, '').length < 6) {
      setRegErrors({ smsOtp: 'Enter the 6-digit SMS code' });
      return;
    }
    setRegErrors({});
    setRegBannerError('');
    setSmsVerifyLoading(true);
    try {
      const { email, mobile, country_code } = linkRegisterContact();
      await dispatch(verifyRegisterMobileThunk({
        email: email || undefined,
        mobile,
        country_code,
        code: regSmsOtp.trim(),
      })).unwrap();
      setRegSmsVerified(true);
      setRegSuccess('Mobile verified. Complete your profile below.');
    } catch (err) {
      const msg = typeof err === 'string' ? err : parseApiError(err).message;
      setRegBannerError(msg);
    } finally {
      setSmsVerifyLoading(false);
    }
  };

  // ── Register: create account ────────────────────────────────────────────────
  const handleCreateAccount = async () => {
    dispatch(clearError());
    if (emailOtpEnabled && !regEmailVerified) {
      setRegBannerError('Verify your email with the code we sent.');
      return;
    }
    if (smsOtpEnabled && !regSmsVerified) {
      setRegBannerError('Verify your mobile with the SMS code we sent.');
      return;
    }

    const errs: Record<string, string> = {};
    const nameErr = validateName(regName);
    const emailErr = validateAuthEmail(regEmail);
    const mobileDigits = regMobile.replace(/\D/g, '');
    let mobileErr: string | null = null;
    if (smsOtpEnabled) {
      mobileErr = validateSignupMobile(regMobile);
    } else if (mobileDigits) {
      mobileErr = validateSignupMobile(regMobile);
    }
    const pwErr = validateStrongPassword(regPassword);
    if (nameErr) errs.name = nameErr;
    if (emailErr) errs.email = emailErr;
    if (mobileErr) errs.mobile = mobileErr;
    if (pwErr) errs.password = pwErr;
    if (regPassword !== regConfirm) errs.confirmPassword = 'Passwords do not match';
    setRegErrors(errs);
    if (Object.keys(errs).length > 0) return;

    setRegBannerError('');
    setRegSuccess('');
    try {
      const { email, mobile, country_code } = linkRegisterContact();

      if (!emailOtpEnabled && !regEmailOtpSent) {
        const { data } = await authApi.requestRegisterEmailOtp({
          email,
          mobile: mobile || undefined,
          country_code: mobile ? country_code : undefined,
          referral_code: regReferralCode.trim() || undefined,
        });
        if (data.phone_hint) setPhoneHint(data.phone_hint);
        setRegEmailOtpSent(true);
      }

      await dispatch(registerCompleteThunk({
        name: regName.trim(),
        email,
        password: regPassword,
        mobile: mobile || undefined,
        country_code: mobile ? country_code : undefined,
        referral_code: regReferralCode.trim() || undefined,
      })).unwrap();
    } catch (err) {
      const msg = typeof err === 'string' ? err : parseApiError(err).message;
      setRegBannerError(msg);
    }
  };

  const canCreateAccount =
    serviceConfigLoaded &&
    (!emailOtpEnabled || regEmailVerified) &&
    (!smsOtpEnabled || regSmsVerified);

  return (
    <AuthShell activeTab={tab} onTabChange={handleTabChange}>

      {tab === 'login' && (
        <>
          <ErrorBanner message={error} />

          <Input
            variant="auth"
            label="Email Address"
            placeholder="you@example.com"
            value={loginEmail}
            onChangeText={setLoginEmail}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            error={loginErrors.email}
          />

          <Input
            variant="auth"
            label="Password"
            placeholder="Enter your password"
            value={loginPassword}
            onChangeText={setLoginPassword}
            secureTextEntry
            error={loginErrors.password}
          />

          <TouchableOpacity
            onPress={() => navigation.navigate('ForgotPassword')}
            style={styles.recoverWrap}
            hitSlop={{ top: 8, bottom: 8 }}
          >
            <Text style={styles.recoverText}>Recover Access</Text>
          </TouchableOpacity>

          <Button
            title="Authenticate"
            onPress={handleLogin}
            loading={loginLoading}
            fullWidth
            size="lg"
            endIcon={<AppIcon name="arrow-right" size={18} color={Colors.surfaceDark} />}
            style={styles.primaryBtn}
            textStyle={styles.primaryBtnText}
          />
        </>
      )}

      {tab === 'register' && (
        <>
          <ErrorBanner message={regBannerError} />
          {regSuccess ? <Text style={styles.successText}>{regSuccess}</Text> : null}

          <Text style={styles.stepTitle}>Create your account</Text>
          <Text style={styles.stepSub}>
            {emailOtpEnabled && smsOtpEnabled
              ? 'Verify email and mobile with OTP — in any order — then set your password and sign up.'
              : emailOtpEnabled
                ? 'Verify your email with OTP, then set your password and sign up.'
                : smsOtpEnabled
                  ? 'Verify your mobile with OTP, then set your password and sign up.'
                  : 'Enter your details and create your account. Verify email or phone later from your profile.'}
          </Text>

          {/* Email + Send OTP */}
          <AuthOtpInlineField
            label={`Email Address${serviceConfigLoaded && !emailOtpEnabled ? ' (OTP inactive)' : ''}`}
            error={regErrors.email}
            button={
              emailOtpEnabled && !regEmailVerified ? (
                <OtpInlineButton
                  label={regEmailOtpSent ? 'Resend' : 'Send OTP'}
                  onPress={regEmailOtpSent ? handleResendEmailOtp : handleSendEmailOtp}
                  loading={emailSendLoading}
                />
              ) : undefined
            }
            inputProps={{
              placeholder: 'you@example.com',
              value: regEmail,
              onChangeText: t => { setRegEmail(t); clearRegFieldError('email'); },
              keyboardType: 'email-address',
              autoCapitalize: 'none',
              autoCorrect: false,
              editable: emailOtpEnabled ? !regEmailVerified : true,
              rightElement: regEmailVerified && emailOtpEnabled ? <VerifiedChip /> : undefined,
            }}
          />

          {/* Email OTP + Verify */}
          {emailOtpEnabled && regEmailOtpSent && !regEmailVerified && (
            <AuthOtpInlineField
              label="Email verification code"
              error={regErrors.emailOtp}
              button={(
                <OtpInlineButton
                  label="Verify"
                  variant="solid"
                  onPress={handleVerifyEmailOtp}
                  loading={emailVerifyLoading}
                />
              )}
              inputProps={{
                placeholder: '6-digit code',
                value: regEmailOtp,
                onChangeText: t => { setRegEmailOtp(t.replace(/\D/g, '')); clearRegFieldError('emailOtp'); },
                keyboardType: 'number-pad',
                maxLength: 6,
              }}
            />
          )}

          {!emailOtpEnabled && serviceConfigLoaded ? (
            <Text style={styles.inactiveNotice}>
              Email verification is optional during signup. Verify your email later from Profile.
            </Text>
          ) : null}

          {smsOtpEnabled ? (
          <>
          {/* Mobile + Send OTP */}
          <AuthOtpInlineField
            label="Mobile number"
            error={regErrors.mobile}
            button={
              !regSmsVerified ? (
                <OtpInlineButton
                  label={regSmsOtpSent ? 'Resend' : 'Send OTP'}
                  onPress={handleSendSmsOtp}
                  loading={smsSendLoading}
                />
              ) : undefined
            }
            inputProps={{
              placeholder: '10-digit number',
              value: regMobile,
              onChangeText: t => {
                setRegMobile(t.replace(/\D/g, '').slice(0, 15));
                clearRegFieldError('mobile');
              },
              keyboardType: 'phone-pad',
              editable: !regSmsVerified,
              leftIcon: <Text style={styles.dialCode}>+{countryCode}</Text>,
              rightElement: regSmsVerified ? <VerifiedChip /> : undefined,
            }}
          />
          {phoneHint && !regSmsVerified ? (
            <Text style={styles.phoneHint}>Code will be sent to {phoneHint}</Text>
          ) : null}

          {/* SMS OTP + Verify */}
          {regSmsOtpSent && !regSmsVerified && (
            <AuthOtpInlineField
              label="SMS verification code"
              error={regErrors.smsOtp}
              button={(
                <OtpInlineButton
                  label="Verify"
                  variant="solid"
                  onPress={handleVerifySmsOtp}
                  loading={smsVerifyLoading}
                />
              )}
              inputProps={{
                placeholder: '6-digit code',
                value: regSmsOtp,
                onChangeText: t => { setRegSmsOtp(t.replace(/\D/g, '')); clearRegFieldError('smsOtp'); },
                keyboardType: 'number-pad',
                maxLength: 6,
              }}
            />
          )}
          </>
          ) : (
            <>
              <Input
                variant="auth"
                label={`Mobile number${serviceConfigLoaded ? ' (SMS inactive)' : ''}`}
                placeholder="10-digit number (optional)"
                value={regMobile}
                onChangeText={t => {
                  setRegMobile(t.replace(/\D/g, '').slice(0, 15));
                  clearRegFieldError('mobile');
                }}
                keyboardType="phone-pad"
                leftIcon={<Text style={styles.dialCode}>+{countryCode}</Text>}
                error={regErrors.mobile}
              />
              {serviceConfigLoaded ? (
                <Text style={styles.phoneHint}>
                  Your number will be saved without SMS verification. Verify later from Profile when SMS is enabled.
                </Text>
              ) : null}
            </>
          )}

          <Input
            variant="auth"
            label="Full Name"
            placeholder="John Doe"
            value={regName}
            onChangeText={t => { setRegName(t); clearRegFieldError('name'); }}
            autoCapitalize="words"
            error={regErrors.name}
          />

          <Input
            variant="auth"
            label="Password"
            placeholder="Create a strong password"
            value={regPassword}
            onChangeText={t => { setRegPassword(t); clearRegFieldError('password'); }}
            secureTextEntry
            error={regErrors.password}
          />

          <Input
            variant="auth"
            label="Confirm Password"
            placeholder="Repeat password"
            value={regConfirm}
            onChangeText={t => { setRegConfirm(t); clearRegFieldError('confirmPassword'); }}
            secureTextEntry
            error={regErrors.confirmPassword}
          />

          <Input
            variant="auth"
            label="Referral Code (optional)"
            placeholder="e.g. ABCD1234"
            value={regReferralCode}
            onChangeText={t => {
              const code = t.toUpperCase();
              setRegReferralCode(code);
              StorageService.set(STORAGE_KEYS.REFERRAL_CODE, code.trim());
            }}
            autoCapitalize="characters"
          />

          <Button
            title="Create Free Account"
            onPress={handleCreateAccount}
            loading={loginLoading}
            disabled={!canCreateAccount}
            fullWidth
            size="lg"
            endIcon={<AppIcon name="arrow-right" size={18} color={Colors.surfaceDark} />}
            style={styles.primaryBtn}
            textStyle={styles.primaryBtnText}
          />
          {!canCreateAccount && serviceConfigLoaded ? (
            <Text style={styles.createHint}>
              {emailOtpEnabled && smsOtpEnabled
                ? 'Verify email and mobile above to enable account creation.'
                : emailOtpEnabled
                  ? 'Verify your email above to enable account creation.'
                  : smsOtpEnabled
                    ? 'Verify your mobile above to enable account creation.'
                    : 'Complete the form above to create your account.'}
            </Text>
          ) : null}
        </>
      )}

    </AuthShell>
  );
}

const styles = StyleSheet.create({
  recoverWrap: {
    alignSelf: 'flex-end',
    marginTop: -Spacing[2],
    marginBottom: Spacing[5],
  },
  recoverText: {
    fontFamily: FontFamily.medium,
    fontSize: FontSize.sm,
    color: Colors.goldLight,
    letterSpacing: 0.2,
  },
  primaryBtn: {
    marginTop: Spacing[2],
    borderRadius: Radius.lg,
    minHeight: 52,
  },
  primaryBtnText: {
    fontFamily: Platform.select({ ios: 'Georgia', android: 'serif', default: 'serif' }),
    fontSize: FontSize.lg,
    letterSpacing: 0.4,
    fontWeight: '700',
  },
  stepTitle: {
    fontFamily: FontFamily.bold,
    fontSize: FontSize['2xl'],
    color: Colors.textPrimary,
    letterSpacing: -0.5,
    marginBottom: Spacing[1],
  },
  stepSub: {
    fontFamily: FontFamily.regular,
    fontSize: FontSize.base,
    color: Colors.textMuted,
    marginBottom: Spacing[4],
    lineHeight: 22,
  },
  successText: {
    fontFamily: FontFamily.medium,
    fontSize: FontSize.sm,
    color: Colors.success,
    marginBottom: Spacing[3],
  },
  dialCode: {
    fontFamily: FontFamily.bold,
    fontSize: FontSize.sm,
    color: Colors.goldLight,
  },
  verifiedChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingRight: Spacing[1],
  },
  verifiedTxt: {
    fontFamily: FontFamily.semiBold,
    fontSize: 10,
    color: Colors.buyGreen,
  },
  phoneHint: {
    fontFamily: FontFamily.regular,
    fontSize: FontSize.xs,
    color: Colors.textMuted,
    marginTop: -Spacing[2],
    marginBottom: Spacing[3],
  },
  createHint: {
    fontFamily: FontFamily.regular,
    fontSize: FontSize.xs,
    color: Colors.textMuted,
    textAlign: 'center',
    marginTop: Spacing[2],
    lineHeight: 18,
  },
  inactiveNotice: {
    fontFamily: FontFamily.medium,
    fontSize: FontSize.sm,
    color: Colors.goldLight,
    backgroundColor: 'rgba(14,164,171,0.12)',
    borderRadius: Radius.lg,
    paddingHorizontal: Spacing[3],
    paddingVertical: Spacing[2],
    marginBottom: Spacing[3],
    lineHeight: 20,
  },
});
