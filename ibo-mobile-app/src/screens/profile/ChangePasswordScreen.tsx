import React, { useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { ProfileStackParamList } from '../../navigation/types';
import { authApi } from '../../api/auth.api';
import { parseApiError } from '../../api/errors';
import ProfileSubHeader from '../../components/profile/ProfileSubHeader';
import { profileStyles } from '../../components/profile/profileStyles';
import Input from '../../components/common/Input';
import Button from '../../components/common/Button';
import ErrorBanner from '../../components/common/ErrorBanner';
import Icon from '../../components/common/AppIcon';
import { Colors, FontFamily, FontSize, Spacing, Radius } from '../../theme';
import { validateStrongPassword } from '../../utils/validation/auth.validation';
import AdaptiveKeyboardAvoidingView from '@/components/common/AdaptiveKeyboardAvoidingView';
import { iosManualKeyboardScrollProps } from '@/utils/iosKeyboardScroll';

type Props = {
  navigation: NativeStackNavigationProp<ProfileStackParamList, 'ChangePassword'>;
};

export default function ChangePasswordScreen({ navigation }: Props) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [banner, setBanner] = useState('');
  const [bannerType, setBannerType] = useState<'error' | 'success'>('error');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    const errs: Record<string, string> = {};
    if (!current) errs.current = 'Current password is required';
    const pwErr = validateStrongPassword(next);
    if (pwErr) errs.next = pwErr;
    if (next !== confirm) errs.confirm = 'Passwords do not match';
    setFieldErrors(errs);
    if (Object.keys(errs).length > 0) return;

    setLoading(true);
    setBanner('');
    try {
      await authApi.changePassword(current, next);
      setBannerType('success');
      setBanner('Password changed successfully!');
      setCurrent('');
      setNext('');
      setConfirm('');
      setTimeout(() => navigation.goBack(), 1500);
    } catch (err) {
      setBannerType('error');
      setBanner(parseApiError(err).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={profileStyles.screen} edges={['top']}>
      <ProfileSubHeader title="Change Password" onBack={() => navigation.goBack()} />

      <AdaptiveKeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          style={styles.flex}
          contentContainerStyle={profileStyles.content}
          {...iosManualKeyboardScrollProps()}
          showsVerticalScrollIndicator={false}
        >
          <ErrorBanner message={banner} type={bannerType} />

          <View style={[profileStyles.card, profileStyles.cardPad]}>
            <View style={styles.intro}>
              <View style={styles.introIcon}>
                <Icon name="lock-reset" size={20} color={Colors.goldLight} />
              </View>
              <Text style={styles.introTitle}>Update your password</Text>
              <Text style={styles.introBody}>
                Choose a strong password you do not use on other sites.
              </Text>
            </View>

            <Input
              label="Current password"
              placeholder="Your current password"
              value={current}
              onChangeText={setCurrent}
              secureTextEntry
              error={fieldErrors.current}
            />
            <Input
              label="New password"
              placeholder="At least 8 characters"
              value={next}
              onChangeText={setNext}
              secureTextEntry
              error={fieldErrors.next}
            />
            <Input
              label="Confirm new password"
              placeholder="Repeat your new password"
              value={confirm}
              onChangeText={setConfirm}
              secureTextEntry
              error={fieldErrors.confirm}
            />

            <View style={styles.tipBox}>
              <Icon name="information-outline" size={16} color={Colors.info} />
              <Text style={styles.tipText}>
                Use at least 8 characters with uppercase, lowercase, a number, and a special character.
              </Text>
            </View>

            <Button title="Update Password" onPress={handleSubmit} loading={loading} fullWidth />
          </View>
        </ScrollView>
      </AdaptiveKeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  intro: {
    alignItems: 'center',
    marginBottom: Spacing[5],
    paddingBottom: Spacing[4],
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.surfaceBorder,
  },
  introIcon: {
    width: 44,
    height: 44,
    borderRadius: Radius.lg,
    backgroundColor: Colors.goldAlpha15,
    borderWidth: 1,
    borderColor: Colors.goldAlpha30,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing[3],
  },
  introTitle: {
    fontFamily: FontFamily.semiBold,
    fontSize: FontSize.base,
    color: Colors.textPrimary,
    marginBottom: 4,
  },
  introBody: {
    fontFamily: FontFamily.regular,
    fontSize: FontSize.sm,
    color: Colors.textMuted,
    textAlign: 'center',
    lineHeight: 18,
  },
  tipBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing[2],
    backgroundColor: Colors.infoDim,
    borderWidth: 1,
    borderColor: Colors.info + '40',
    borderRadius: Radius.md,
    padding: Spacing[3],
    marginBottom: Spacing[5],
  },
  tipText: {
    flex: 1,
    fontFamily: FontFamily.regular,
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    lineHeight: 18,
  },
});
