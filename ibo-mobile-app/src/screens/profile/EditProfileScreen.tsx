import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  Image,
  Alert,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useDispatch, useSelector } from 'react-redux';
import { launchImageLibrary } from 'react-native-image-picker';
import Icon from '@/components/common/AppIcon';
import Input from '../../components/common/Input';
import Button from '../../components/common/Button';
import ErrorBanner from '../../components/common/ErrorBanner';
import ProfileSubHeader from '../../components/profile/ProfileSubHeader';
import { ProfileStackParamList } from '../../navigation/types';
import { AppDispatch, RootState } from '../../store';
import { setUser } from '../../store/auth.slice';
import { authApi } from '../../api/auth.api';
import { parseApiError } from '../../api/errors';
import { profileStyles } from '../../components/profile/profileStyles';
import { Colors, FontFamily, FontSize, Spacing, Radius } from '../../theme';
import { API_URL } from '../../config/env';
import StorageService from '../../services/storage.service';
import { STORAGE_KEYS } from '../../config/storageKeys';
import { User } from '../../types/auth.types';
import {
  firstProfileError,
  nationalFromStoredPhone,
  validateProfileForm,
} from '../../utils/validation/profile.validation';
import { isInactiveOtpMessage, useSignupOtpConfig } from '../../hooks/useSignupOtpConfig';
import AdaptiveKeyboardAvoidingView from '@/components/common/AdaptiveKeyboardAvoidingView';
import { iosManualKeyboardScrollProps } from '@/utils/iosKeyboardScroll';

type Nav = NativeStackNavigationProp<ProfileStackParamList, 'EditProfile'>;

function absolutizeUrl(pathOrUrl?: string): string | undefined {
  const raw = (pathOrUrl || '').trim();
  if (!raw) return undefined;
  if (raw.startsWith('http://') || raw.startsWith('https://')) return raw;
  const rel = raw.startsWith('/') ? raw : `/${raw}`;
  return `${API_URL}${rel}`;
}

function normalizeUserPayload(user: User): User {
  return { ...user, avatar_url: absolutizeUrl(user.avatar_url) };
}

function OtpSendButton({
  label,
  loading,
  disabled,
  onPress,
}: {
  label: string;
  loading?: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      style={[styles.otpBtn, (disabled || loading) && styles.otpBtnDisabled]}
      onPress={onPress}
      disabled={disabled || loading}
      activeOpacity={0.85}
    >
      {loading ? (
        <ActivityIndicator size="small" color={Colors.goldLight} />
      ) : (
        <Text style={styles.otpBtnText}>{label}</Text>
      )}
    </TouchableOpacity>
  );
}

export default function EditProfileScreen({ navigation }: { navigation: Nav }) {
  const dispatch = useDispatch<AppDispatch>();
  const { user } = useSelector((s: RootState) => s.auth);

  const { loaded: serviceConfigLoaded, smsOtpEnabled, defaultCountryCode } = useSignupOtpConfig();

  const [countryCode, setCountryCode] = useState('91');
  const [name, setName] = useState(user?.name || '');
  const [mobile, setMobile] = useState('');
  const [baselineMobile, setBaselineMobile] = useState('');
  const [country, setCountry] = useState(user?.country || '');
  const [bio, setBio] = useState(user?.bio || '');
  const [phoneOtp, setPhoneOtp] = useState('');
  const [phoneOtpSent, setPhoneOtpSent] = useState(false);
  const [phoneSendLoading, setPhoneSendLoading] = useState(false);

  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [banner, setBanner] = useState('');
  const [bannerType, setBannerType] = useState<'error' | 'success'>('error');
  const [saving, setSaving] = useState(false);
  const [avatarUploading, setAvatarUploading] = useState(false);

  useEffect(() => {
    if (defaultCountryCode) {
      setCountryCode(defaultCountryCode);
    }
  }, [defaultCountryCode]);

  useEffect(() => {
    if (!user) return;
    const nat = nationalFromStoredPhone(user.phone, countryCode);
    setBaselineMobile(nat);
    setName(user.name || '');
    setMobile(nat);
    setCountry(user.country || '');
    setBio(user.bio || '');
    setPhoneOtp('');
    setPhoneOtpSent(false);
    setFieldErrors({});
  }, [user, countryCode]);

  const mobileDigits = mobile.replace(/\D/g, '');
  const phoneChanged = mobileDigits !== baselineMobile.replace(/\D/g, '');

  useEffect(() => {
    if (!phoneChanged) {
      setPhoneOtp('');
      setPhoneOtpSent(false);
    }
  }, [phoneChanged]);

  const persistUser = useCallback(
    async (next: User) => {
      const normalized = normalizeUserPayload(next);
      dispatch(setUser(normalized));
      await StorageService.setJSON(STORAGE_KEYS.USER, normalized);
      return normalized;
    },
    [dispatch],
  );

  const initials = useMemo(() => {
    if (user?.name) {
      return user.name
        .split(' ')
        .map((n) => n[0])
        .join('')
        .toUpperCase()
        .slice(0, 2);
    }
    return user?.email?.slice(0, 2).toUpperCase() ?? 'BX';
  }, [user?.name, user?.email]);

  const handleSendPhoneOtp = async () => {
    if (!phoneChanged) {
      setBannerType('error');
      setBanner('Enter a new mobile number to verify.');
      return;
    }
    const mobErr = validateProfileForm({ name, mobile: mobileDigits, country, bio }).phone;
    if (mobErr) {
      setFieldErrors((prev) => ({ ...prev, phone: mobErr }));
      setBannerType('error');
      setBanner(mobErr);
      return;
    }
    setPhoneSendLoading(true);
    setBanner('');
    try {
      const { data } = await authApi.sendProfilePhoneOtp({
        mobile: mobileDigits,
        country_code: countryCode,
      });
      if (isInactiveOtpMessage(data.message) || data.otp_required === false) {
        setPhoneOtpSent(false);
      } else {
        setPhoneOtpSent(true);
        setPhoneOtp('');
      }
      setBannerType('success');
      setBanner(data.message || 'Verification code sent.');
    } catch (err) {
      setBannerType('error');
      setBanner(parseApiError(err).message);
    } finally {
      setPhoneSendLoading(false);
    }
  };

  const handlePickAvatar = async () => {
    if (avatarUploading) return;
    setBanner('');
    try {
      const result = await launchImageLibrary({
        mediaType: 'photo',
        selectionLimit: 1,
        quality: 0.9,
      });
      if (result.didCancel) return;
      if (result.errorMessage) {
        setBannerType('error');
        setBanner(result.errorMessage);
        return;
      }
      const asset = result.assets?.[0];
      if (!asset?.uri) {
        setBannerType('error');
        setBanner('No image selected.');
        return;
      }

      const formData = new FormData();
      formData.append('file', {
        uri: asset.uri,
        name: asset.fileName || `avatar_${Date.now()}.jpg`,
        type: asset.type || 'image/jpeg',
      } as unknown as Blob);

      setAvatarUploading(true);
      await authApi.uploadAvatar(formData);
      const me = await authApi.me();
      await persistUser(me.data);
      setBannerType('success');
      setBanner('Profile photo updated.');
    } catch (err) {
      setBannerType('error');
      setBanner(parseApiError(err).message || 'Could not update profile photo.');
    } finally {
      setAvatarUploading(false);
    }
  };

  const handleRemoveAvatar = () => {
    if (!user?.avatar_url || avatarUploading) return;
    Alert.alert('Remove photo', 'Remove your profile picture?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          setAvatarUploading(true);
          setBanner('');
          try {
            const { data } = await authApi.deleteAvatar();
            await persistUser(data);
            setBannerType('success');
            setBanner('Profile photo removed.');
          } catch (err) {
            setBannerType('error');
            setBanner(parseApiError(err).message || 'Could not remove profile photo.');
          } finally {
            setAvatarUploading(false);
          }
        },
      },
    ]);
  };

  const onSave = async () => {
    const errs = validateProfileForm({
      name,
      mobile: mobileDigits,
      country,
      bio,
    });
    if (phoneChanged && smsOtpEnabled) {
      if (!phoneOtpSent) {
        errs.phoneOtp = 'Send a verification code to your new number first.';
      } else if (!phoneOtp.trim() || phoneOtp.trim().length < 6) {
        errs.phoneOtp = 'Enter the 6-digit SMS code.';
      }
    }
    setFieldErrors(errs);
    if (Object.keys(errs).length > 0) {
      setBannerType('error');
      setBanner(firstProfileError(errs) || 'Please fix the highlighted fields.');
      return;
    }

    setSaving(true);
    setBanner('');
    try {
      const payload: Parameters<typeof authApi.updateProfile>[0] = {
        name: name.trim(),
        country: country.trim(),
        bio: bio.trim(),
      };
      if (phoneChanged) {
        payload.mobile = mobileDigits;
        payload.country_code = countryCode;
        if (smsOtpEnabled && phoneOtp.trim()) {
          payload.phone_otp = phoneOtp.trim();
        }
      }
      const { data } = await authApi.updateProfile(payload);
      await persistUser(data);
      setPhoneOtp('');
      setPhoneOtpSent(false);
      Alert.alert('Saved', 'Profile updated successfully.');
      navigation.goBack();
    } catch (err) {
      setBannerType('error');
      setBanner(parseApiError(err).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeAreaView style={profileStyles.screen} edges={['top']}>
      <ProfileSubHeader title="Edit Profile" onBack={() => navigation.goBack()} />

      <AdaptiveKeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 8 : 0}
      >
        <ScrollView
          style={styles.flex}
          contentContainerStyle={styles.scrollContent}
          {...iosManualKeyboardScrollProps()}
          showsVerticalScrollIndicator={false}
        >
          {banner ? <ErrorBanner message={banner} type={bannerType} style={styles.banner} /> : null}

          {/* Avatar — outside overflow:hidden card so nothing clips */}
          <View style={styles.avatarSection}>
            <Text style={styles.sectionLabel}>Profile photo</Text>
            <View style={styles.avatarRow}>
              <TouchableOpacity
                style={styles.avatarRing}
                onPress={handlePickAvatar}
                disabled={avatarUploading}
                activeOpacity={0.85}
              >
                {user?.avatar_url ? (
                  <Image source={{ uri: user.avatar_url }} style={styles.avatar} />
                ) : (
                  <View style={styles.avatarFallback}>
                    <Text style={styles.avatarInitials}>{initials}</Text>
                  </View>
                )}
                {avatarUploading ? (
                  <View style={styles.avatarOverlay}>
                    <ActivityIndicator color={Colors.goldLight} />
                  </View>
                ) : null}
              </TouchableOpacity>

              <View style={styles.avatarActions}>
                <TouchableOpacity
                  style={styles.avatarBtn}
                  onPress={handlePickAvatar}
                  disabled={avatarUploading}
                  activeOpacity={0.85}
                >
                  <Icon name="camera-outline" size={16} color={Colors.goldLight} />
                  <Text style={styles.avatarBtnText}>
                    {user?.avatar_url ? 'Change photo' : 'Upload photo'}
                  </Text>
                </TouchableOpacity>
                {user?.avatar_url ? (
                  <TouchableOpacity
                    style={[styles.avatarBtn, styles.avatarBtnDanger]}
                    onPress={handleRemoveAvatar}
                    disabled={avatarUploading}
                    activeOpacity={0.85}
                  >
                    <Icon name="close-circle" size={16} color={Colors.danger} />
                    <Text style={[styles.avatarBtnText, { color: Colors.danger }]}>Remove</Text>
                  </TouchableOpacity>
                ) : null}
                <Text style={styles.avatarHint}>JPG, PNG or WebP</Text>
              </View>
            </View>
          </View>

          <View style={[profileStyles.card, profileStyles.cardPad, styles.formCard]}>
            <View style={styles.fieldBlock}>
              <Input
                label="Display name"
                value={name}
                onChangeText={(t) => {
                  setName(t);
                  setFieldErrors((prev) => ({ ...prev, name: '' }));
                }}
                placeholder="Your display name"
                error={fieldErrors.name}
                autoCapitalize="words"
                containerStyle={styles.inputFlush}
              />
            </View>

            <View style={styles.fieldBlock}>
              <Text style={styles.fieldLabel}>Mobile number</Text>
              <View style={styles.phoneRow}>
                <View style={styles.phoneInputWrap}>
                  <Input
                    fieldOnly
                    value={mobile}
                    onChangeText={(t) => {
                      setMobile(t.replace(/\D/g, '').slice(0, 15));
                      setFieldErrors((prev) => ({ ...prev, phone: '', phoneOtp: '' }));
                    }}
                    placeholder="9876543210"
                    keyboardType="phone-pad"
                    leftIcon={<Text style={styles.dialCode}>+{countryCode}</Text>}
                    error={fieldErrors.phone}
                  />
                </View>
                {phoneChanged && smsOtpEnabled ? (
                  <OtpSendButton
                    label={phoneOtpSent ? 'Resend' : 'Send OTP'}
                    loading={phoneSendLoading}
                    disabled={mobileDigits.length < 10}
                    onPress={handleSendPhoneOtp}
                  />
                ) : null}
              </View>
              {fieldErrors.phone ? (
                <Text style={styles.fieldError}>{fieldErrors.phone}</Text>
              ) : (
                <Text style={styles.fieldHint}>
                  {user?.phone && !phoneChanged
                    ? `Current: ${user.phone}`
                    : phoneChanged && smsOtpEnabled
                      ? 'Verify your new number with SMS before saving.'
                      : phoneChanged && !smsOtpEnabled
                        ? 'SMS verification is inactive — save now and verify later from Profile.'
                        : '10-digit mobile (India: starts with 6–9)'}
                </Text>
              )}
            </View>

            {phoneChanged && smsOtpEnabled ? (
              <View style={styles.fieldBlock}>
                <Input
                  label="SMS verification code"
                  value={phoneOtp}
                  onChangeText={(t) => {
                    setPhoneOtp(t.replace(/\D/g, '').slice(0, 6));
                    setFieldErrors((prev) => ({ ...prev, phoneOtp: '' }));
                  }}
                  placeholder="6-digit code"
                  keyboardType="number-pad"
                  maxLength={6}
                  error={fieldErrors.phoneOtp}
                  hint="Enter the code sent to your new number"
                  containerStyle={styles.inputFlush}
                />
              </View>
            ) : null}

            <View style={styles.fieldBlock}>
              <Input
                label="Country / region"
                value={country}
                onChangeText={(t) => {
                  setCountry(t);
                  setFieldErrors((prev) => ({ ...prev, country: '' }));
                }}
                placeholder="India"
                error={fieldErrors.country}
                autoCapitalize="words"
                containerStyle={styles.inputFlush}
              />
            </View>

            <View style={styles.fieldBlock}>
              <Input
                label="Email address"
                value={user?.email || ''}
                editable={false}
                hint="Read-only"
                containerStyle={styles.inputFlush}
              />
            </View>

            <View style={styles.fieldBlock}>
              <Input
                label="Bio"
                value={bio}
                onChangeText={(t) => {
                  setBio(t);
                  setFieldErrors((prev) => ({ ...prev, bio: '' }));
                }}
                placeholder="Optional — a short line about you"
                multiline
                numberOfLines={4}
                maxLength={500}
                error={fieldErrors.bio}
                hint="Max 500 characters"
                style={styles.bioInput}
                containerStyle={styles.inputFlush}
              />
            </View>
          </View>

          <Button title="Save changes" onPress={onSave} loading={saving} fullWidth />
        </ScrollView>
      </AdaptiveKeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  scrollContent: {
    paddingHorizontal: Spacing[4],
    paddingTop: Spacing[3],
    paddingBottom: Spacing[8],
  },
  banner: {
    marginBottom: Spacing[2],
  },
  formCard: {
    overflow: 'visible',
    marginBottom: Spacing[4],
    paddingTop: Spacing[1],
  },
  fieldBlock: {
    marginBottom: Spacing[4],
  },
  inputFlush: {
    marginBottom: 0,
  },
  sectionLabel: {
    fontFamily: FontFamily.semiBold,
    fontSize: FontSize.xs,
    color: Colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginBottom: Spacing[3],
  },
  avatarSection: {
    marginBottom: Spacing[4],
  },
  avatarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing[4],
  },
  avatarRing: {
    position: 'relative',
  },
  avatar: {
    width: 88,
    height: 88,
    borderRadius: Radius.xl,
    borderWidth: 2,
    borderColor: Colors.goldAlpha30,
  },
  avatarFallback: {
    width: 88,
    height: 88,
    borderRadius: Radius.xl,
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
  avatarOverlay: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: Radius.xl,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarActions: {
    flex: 1,
    gap: Spacing[2],
  },
  avatarBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing[2],
    alignSelf: 'flex-start',
    paddingHorizontal: Spacing[3],
    paddingVertical: Spacing[2],
    borderRadius: Radius.lg,
    backgroundColor: Colors.goldAlpha10,
    borderWidth: 1,
    borderColor: Colors.goldAlpha30,
  },
  avatarBtnDanger: {
    backgroundColor: Colors.dangerDim,
    borderColor: Colors.danger + '40',
  },
  avatarBtnText: {
    fontFamily: FontFamily.semiBold,
    fontSize: FontSize.sm,
    color: Colors.goldLight,
  },
  avatarHint: {
    fontFamily: FontFamily.regular,
    fontSize: FontSize.xs,
    color: Colors.textMuted,
    marginTop: Spacing[1],
  },
  fieldLabel: {
    fontFamily: FontFamily.medium,
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    marginBottom: Spacing[1],
    letterSpacing: 0.2,
  },
  fieldHint: {
    fontFamily: FontFamily.regular,
    fontSize: FontSize.xs,
    color: Colors.textMuted,
    marginTop: Spacing[1],
    lineHeight: 18,
  },
  fieldError: {
    fontFamily: FontFamily.regular,
    fontSize: FontSize.xs,
    color: Colors.danger,
    marginTop: Spacing[1],
    lineHeight: 18,
  },
  phoneRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing[2],
  },
  phoneInputWrap: {
    flex: 1,
    minWidth: 0,
  },
  dialCode: {
    fontFamily: FontFamily.bold,
    fontSize: FontSize.sm,
    color: Colors.goldLight,
  },
  otpBtn: {
    minWidth: 92,
    height: 50,
    paddingHorizontal: Spacing[3],
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.goldAlpha30,
    backgroundColor: Colors.goldAlpha10,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 0,
  },
  otpBtnDisabled: {
    opacity: 0.45,
  },
  otpBtnText: {
    fontFamily: FontFamily.semiBold,
    fontSize: FontSize.xs,
    color: Colors.goldLight,
  },
  bioInput: {
    minHeight: 100,
    textAlignVertical: 'top',
  },
});
