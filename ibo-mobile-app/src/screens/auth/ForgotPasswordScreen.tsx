import React, { useState } from 'react';
import {
  View, Text, StyleSheet,
  TouchableOpacity,
  Platform, ScrollView, useWindowDimensions,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { AuthStackParamList } from '../../navigation/types';
import { authApi } from '../../api/auth.api';
import { parseApiError } from '../../api/errors';
import Input from '../../components/common/Input';
import Button from '../../components/common/Button';
import ErrorBanner from '../../components/common/ErrorBanner';
import AppLogo from '../../components/common/AppLogo';
import { Colors, FontFamily, FontSize, Spacing, Radius } from '../../theme';
import { validateAuthEmail } from '../../utils/validation/auth.validation';
import AdaptiveKeyboardAvoidingView from '@/components/common/AdaptiveKeyboardAvoidingView';
import { iosManualKeyboardScrollProps } from '@/utils/iosKeyboardScroll';

type Props = { navigation: NativeStackNavigationProp<AuthStackParamList, 'ForgotPassword'> };

export default function ForgotPasswordScreen({ navigation }: Props) {
  const insets = useSafeAreaInsets();
  const { width: screenW } = useWindowDimensions();
  const [email, setEmail] = useState('');
  const [fieldError, setFieldError] = useState('');
  const [banner, setBanner] = useState('');
  const [bannerType, setBannerType] = useState<'error' | 'success'>('error');
  const [loading, setLoading] = useState(false);

  const logoW = Math.min(Math.round(screenW * 0.52), 200);
  const logoH = Math.round(logoW / 2.8);

  const handleSubmit = async () => {
    const err = validateAuthEmail(email);
    if (err) { setFieldError(err); return; }
    setFieldError('');
    setBanner('');
    setLoading(true);
    try {
      await authApi.forgotPassword(email.trim().toLowerCase());
      setBannerType('success');
      setBanner('If that email is registered, a reset link has been sent.');
    } catch (err) {
      setBannerType('error');
      setBanner(parseApiError(err).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <AdaptiveKeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? insets.top : 0}
      >
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={[
            styles.content,
            { paddingBottom: Spacing[8] + insets.bottom },
          ]}
          {...iosManualKeyboardScrollProps()}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.header}>
            <AppLogo width={logoW} height={logoH} />
            <Text style={styles.tagline}>Professional Crypto Exchange</Text>
          </View>

          <View style={styles.card}>
            <Text style={styles.title}>Reset password</Text>
            <Text style={styles.subtitle}>
              Enter your email and we'll send you a reset link.
            </Text>

            <ErrorBanner message={banner} type={bannerType} />

            <Input
              variant="auth"
              label="Email Address"
              placeholder="you@example.com"
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              error={fieldError}
            />

            <Button
              title="Send Reset Link"
              onPress={handleSubmit}
              loading={loading}
              fullWidth
              size="lg"
              style={styles.btn}
            />

            <TouchableOpacity
              onPress={() => navigation.navigate('Login')}
              style={styles.backBtn}
              hitSlop={{ top: 8, bottom: 8 }}
            >
              <Text style={styles.backText}>← Back to Sign In</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </AdaptiveKeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:    { flex: 1, backgroundColor: Colors.surfaceDark },
  flex:    { flex: 1 },
  scroll:  { flex: 1 },
  content: {
    flexGrow: 1,
    paddingHorizontal: Spacing[6],
    paddingTop: Spacing[4],
    justifyContent: 'center',
  },
  header: {
    alignItems: 'center',
    marginBottom: Spacing[8],
  },
  tagline: {
    fontFamily: FontFamily.regular,
    fontSize: FontSize.sm,
    color: Colors.textMuted,
    marginTop: Spacing[2],
    letterSpacing: 0.6,
    textAlign: 'center',
  },
  card: {
    backgroundColor: Colors.surfaceCard,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    borderRadius: Radius.xl,
    padding: Spacing[6],
  },
  title: {
    fontFamily: FontFamily.bold,
    fontSize: FontSize['2xl'],
    color: Colors.textPrimary,
    letterSpacing: -0.5,
    marginBottom: Spacing[1],
  },
  subtitle: {
    fontFamily: FontFamily.regular,
    fontSize: FontSize.base,
    color: Colors.textMuted,
    marginBottom: Spacing[5],
    lineHeight: FontSize.base * 1.6,
  },
  btn: {
    marginTop: Spacing[2],
    borderRadius: Radius.lg,
    minHeight: 52,
  },
  backBtn: { alignItems: 'center', marginTop: Spacing[5] },
  backText: {
    fontFamily: FontFamily.medium,
    fontSize: FontSize.sm,
    color: Colors.goldLight,
  },
});
