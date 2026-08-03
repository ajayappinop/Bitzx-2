import React, { useState, useEffect } from 'react';
import {
  View, Text, ScrollView, StyleSheet, Platform, Linking,
} from 'react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RouteProp } from '@react-navigation/native';
import { AuthStackParamList } from '../../navigation/types';
import { authApi } from '../../api/auth.api';
import { parseApiError } from '../../api/errors';
import Input from '../../components/common/Input';
import Button from '../../components/common/Button';
import ErrorBanner from '../../components/common/ErrorBanner';
import { Colors, FontFamily, FontSize, Spacing, Radius } from '../../theme';
import { validateStrongPassword } from '../../utils/validation/auth.validation';
import AdaptiveKeyboardAvoidingView from '@/components/common/AdaptiveKeyboardAvoidingView';
import { iosManualKeyboardScrollProps } from '@/utils/iosKeyboardScroll';

type Props = {
  navigation: NativeStackNavigationProp<AuthStackParamList, 'ResetPassword'>;
  route: RouteProp<AuthStackParamList, 'ResetPassword'>;
};

function extractResetTokenFromUrl(url: string): string {
  const decoded = decodeURIComponent(url);
  const query = decoded.match(/[?&]token=([^&#]+)/i);
  if (query?.[1]) return query[1].trim();
  const path = decoded.match(/reset-password\/([^?&#]+)/i);
  return (path?.[1] ?? '').trim();
}

export default function ResetPasswordScreen({ navigation, route }: Props) {
  const initialToken = (route.params?.token ?? '').trim();
  const [token, setToken] = useState(initialToken);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [banner, setBanner] = useState('');
  const [bannerType, setBannerType] = useState<'error' | 'success'>('error');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (initialToken) return;
    const applyUrl = (url: string | null) => {
      if (!url) return;
      const parsed = extractResetTokenFromUrl(url);
      if (parsed) setToken(parsed);
    };
    void Linking.getInitialURL().then(applyUrl);
    const sub = Linking.addEventListener('url', (ev) => applyUrl(ev.url));
    return () => sub.remove();
  }, [initialToken]);

  const handleSubmit = async () => {
    const errs: Record<string, string> = {};
    const pwErr = validateStrongPassword(password);
    if (pwErr) errs.password = pwErr;
    if (password !== confirm) errs.confirm = 'Passwords do not match';
    setFieldErrors(errs);
    if (Object.keys(errs).length > 0) return;
    if (!token) {
      setBannerType('error');
      setBanner('Reset link is invalid or expired. Request a new one from Forgot Password.');
      return;
    }

    setLoading(true);
    setBanner('');
    try {
      await authApi.resetPassword(token, password);
      setBannerType('success');
      setBanner('Password reset successfully. You can now sign in.');
      setTimeout(() => navigation.navigate('Login'), 2000);
    } catch (err) {
      setBannerType('error');
      setBanner(parseApiError(err).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <AdaptiveKeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content} {...iosManualKeyboardScrollProps()}>
        <View style={styles.header}>
          <View style={styles.logoMark}><Text style={styles.logoText}>BX</Text></View>
        </View>

        <View style={styles.card}>
          <Text style={styles.title}>Set new password</Text>
          <Text style={styles.subtitle}>Choose a strong password for your account.</Text>

          {!token ? (
            <Text style={styles.missingToken}>
              Open the reset link from your email, or request a new one from Forgot Password.
            </Text>
          ) : null}

          <ErrorBanner message={banner} type={bannerType} />

          <Input
            label="New password"
            placeholder="At least 8 characters"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            error={fieldErrors.password}
          />
          <Input
            label="Confirm password"
            placeholder="Repeat your new password"
            value={confirm}
            onChangeText={setConfirm}
            secureTextEntry
            error={fieldErrors.confirm}
          />

          <Button title="Reset Password" onPress={handleSubmit} loading={loading} fullWidth disabled={!token} />
        </View>
      </ScrollView>
    </AdaptiveKeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: Colors.surfaceDark },
  scroll: { flex: 1 },
  content: { flexGrow: 1, padding: Spacing[6], justifyContent: 'center' },
  header: { alignItems: 'center', marginBottom: Spacing[8] },
  logoMark: {
    width: 64, height: 64, borderRadius: Radius.lg,
    backgroundColor: Colors.surfaceCard, borderWidth: 1,
    borderColor: Colors.goldAlpha30, alignItems: 'center', justifyContent: 'center',
  },
  logoText: { fontFamily: FontFamily.extraBold, fontSize: FontSize['2xl'], color: Colors.goldLight, letterSpacing: -1 },
  card: { backgroundColor: Colors.surfaceCard, borderWidth: 1, borderColor: Colors.surfaceBorder, borderRadius: Radius.xl, padding: Spacing[6] },
  title: { fontFamily: FontFamily.bold, fontSize: FontSize['2xl'], color: Colors.textPrimary, letterSpacing: -0.8, marginBottom: Spacing[1] },
  subtitle: { fontFamily: FontFamily.regular, fontSize: FontSize.base, color: Colors.textMuted, marginBottom: Spacing[6], lineHeight: 22 },
  missingToken: {
    fontFamily: FontFamily.regular,
    fontSize: FontSize.sm,
    color: Colors.goldLight,
    marginBottom: Spacing[4],
    lineHeight: 20,
  },
});
