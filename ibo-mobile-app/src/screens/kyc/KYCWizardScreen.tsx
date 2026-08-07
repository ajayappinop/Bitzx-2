/**
 * KYCWizardScreen — 3-step manual KYC form (Personal → Document → Review & Submit).
 * Mirrors the web KYCPage.jsx manual flow and submit payload exactly.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Icon from '@/components/common/AppIcon';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  Image,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { ProfileStackParamList } from '../../navigation/types';
import { useDispatch, useSelector } from 'react-redux';
import { RootState, AppDispatch } from '../../store';
import { fetchKycThunk } from '../../store/auth.slice';
import { kycApi } from '../../api/kyc.api';
import { parseApiError } from '../../api/errors';
import { launchImageLibrary, launchCamera } from 'react-native-image-picker';
import SafeAreaWrapper from '../../components/common/SafeAreaWrapper';
import Input from '../../components/common/Input';
import Button from '../../components/common/Button';
import ErrorBanner from '../../components/common/ErrorBanner';
import { Colors, FontFamily, FontSize, Spacing, Radius } from '../../theme';
import { effectiveKycStatus, isKycApproved } from '../../utils/kycGate';
import AdaptiveKeyboardAvoidingView from '@/components/common/AdaptiveKeyboardAvoidingView';
import { iosManualKeyboardScrollProps } from '@/utils/iosKeyboardScroll';
import { API_URL } from '../../config/env';

function kycMediaUrl(rel?: string | null): string {
  if (!rel) return '';
  if (/^https?:\/\//i.test(rel)) return rel;
  return `${API_URL}${rel.startsWith('/') ? '' : '/'}${rel}`;
}

function isKycImagePath(url?: string | null): boolean {
  if (!url) return false;
  return /\.(jpe?g|png|webp)$/i.test(url);
}

type Props = {
  navigation: NativeStackNavigationProp<ProfileStackParamList, 'KYCWizard'>;
};

type StepKey = 'personal' | 'document' | 'review';

const STEPS: { key: StepKey; title: string; iconName: string }[] = [
  { key: 'personal', title: 'Personal Info', iconName: 'account' },
  { key: 'document', title: 'Document',       iconName: 'card-account-details' },
  { key: 'review',   title: 'Review & Submit', iconName: 'check-circle-outline' },
];

const DOC_TYPES: { value: string; label: string; emoji: string }[] = [
  { value: 'passport',        label: 'Passport',         emoji: '🛂' },
  { value: 'national_id',     label: 'National ID',      emoji: '🪪' },
  { value: 'driving_license', label: 'Driving License',  emoji: '🚗' },
];

interface PersonalInfo {
  full_name: string;
  date_of_birth: string;
  nationality: string;
  address: string;
  city: string;
  country: string;
  postal_code: string;
}

interface DocInfo {
  document_type: string;
  document_number: string;
  document_expiry: string;
}

function validatePersonal(p: PersonalInfo): Record<string, string> {
  const e: Record<string, string> = {};
  const name = p.full_name.trim();
  if (name.length < 3) e.full_name = 'Enter your full legal name (at least 3 characters).';
  else if (!/^[\w\s'.-]+$/u.test(name)) e.full_name = 'Use letters only (spaces, apostrophes, and hyphens allowed).';
  else if (name.split(/\s+/).filter(Boolean).length < 2) e.full_name = 'Enter your first and last name as on your ID.';

  const dob = p.date_of_birth.trim();
  if (!dob) {
    e.date_of_birth = 'Date of birth is required.';
  } else {
    const d = new Date(`${dob}T12:00:00`);
    if (isNaN(d.getTime())) {
      e.date_of_birth = 'Invalid date. Use YYYY-MM-DD format.';
    } else {
      const today = new Date();
      let age = today.getFullYear() - d.getFullYear();
      const md = today.getMonth() - d.getMonth();
      if (md < 0 || (md === 0 && today.getDate() < d.getDate())) age -= 1;
      if (d > today) e.date_of_birth = 'Date of birth cannot be in the future.';
      else if (age < 18) e.date_of_birth = 'You must be at least 18 years old.';
      else if (age > 110) e.date_of_birth = 'Please enter a valid date of birth.';
    }
  }

  const nat = p.nationality.trim();
  if (nat.length < 2) e.nationality = 'Enter your nationality (e.g. Indian, British).';
  else if (nat.length > 80) e.nationality = 'Nationality is too long.';

  const addr = p.address.trim();
  if (addr.length < 12) e.address = 'Enter a complete street address (at least 12 characters).';
  else if (addr.length > 500) e.address = 'Address is too long.';

  const city = p.city.trim();
  if (city.length < 2) e.city = 'Enter your city.';
  else if (city.length > 100) e.city = 'City name is too long.';

  const country = p.country.trim();
  if (country.length < 2) e.country = 'Enter your country.';
  else if (country.length > 100) e.country = 'Country name is too long.';

  const zip = p.postal_code.trim();
  if (zip.length < 2) e.postal_code = 'Postal / ZIP code is required.';
  else if (zip.length > 16) e.postal_code = 'Postal code must be at most 16 characters.';
  else if (!/^[A-Z0-9][A-Z0-9\s-]*$/i.test(zip)) e.postal_code = 'Use letters, numbers, spaces, or hyphens only.';

  return e;
}

function validateDoc(
  d: DocInfo,
  hasFront: boolean,
): Record<string, string> {
  const e: Record<string, string> = {};

  if (!d.document_type || !DOC_TYPES.find((t) => t.value === d.document_type)) {
    e.document_type = 'Select a document type.';
  }

  const num = d.document_number.trim();
  if (num.length < 4) e.document_number = 'Enter the full document number (at least 4 characters).';
  else if (num.length > 80) e.document_number = 'Document number is too long.';

  const exp = d.document_expiry.trim();
  if (!exp) {
    e.document_expiry = 'Expiry date is required.';
  } else {
    const expDate = new Date(`${exp}T23:59:59`);
    if (isNaN(expDate.getTime())) e.document_expiry = 'Invalid expiry date.';
    else if (expDate < new Date()) e.document_expiry = 'Document appears expired. Use a valid, unexpired ID.';
  }

  if (!hasFront) e.document_front = 'Upload the front of your ID (required).';

  return e;
}

async function pickImage(useCamera: boolean) {
  const res = useCamera
    ? await launchCamera({ mediaType: 'photo', quality: 1, saveToPhotos: false })
    : await launchImageLibrary({ mediaType: 'photo', selectionLimit: 1 });
  return res.assets?.[0] ?? null;
}

export default function KYCWizardScreen({ navigation }: Props) {
  const dispatch = useDispatch<AppDispatch>();
  const { kyc, user, kycMode, kycModeLoading } = useSelector((s: RootState) => s.auth);
  const kycStatus = effectiveKycStatus(kyc, user);

  useEffect(() => {
    if (kycMode == null) dispatch(fetchKycThunk());
  }, [kycMode, dispatch]);

  useEffect(() => {
    if (kycMode === 'auto' && !isKycApproved(kycStatus)) {
      navigation.replace('AutoKyc');
    }
  }, [kycMode, kycStatus, navigation]);

  const [currentStep, setCurrentStep] = useState(0);
  const [loading, setLoading] = useState(false);
  const [banner, setBanner] = useState('');
  const [bannerType, setBannerType] = useState<'error' | 'success'>('error');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  // Step 1 — Personal
  const [personal, setPersonal] = useState<PersonalInfo>({
    full_name: '',
    date_of_birth: '',
    nationality: '',
    address: '',
    city: '',
    country: '',
    postal_code: '',
  });

  // Step 2 — Document
  const [doc, setDoc] = useState<DocInfo>({
    document_type: 'passport',
    document_number: '',
    document_expiry: '',
  });
  const [frontUri, setFrontUri] = useState('');
  const [backUri, setBackUri] = useState('');
  const [frontType, setFrontType] = useState('image/jpeg');
  const [frontName, setFrontName] = useState('front.jpg');
  const [backType, setBackType] = useState('image/jpeg');
  const [backName, setBackName] = useState('back.jpg');
  const [uploadingDocs, setUploadingDocs] = useState(false);
  const [clearingSide, setClearingSide] = useState<'front' | 'back' | null>(null);
  const [docFrontUrl, setDocFrontUrl] = useState('');
  const [docBackUrl, setDocBackUrl] = useState('');

  const hasFront = !!(frontUri || docFrontUrl);

  const handlePickImage = async (side: 'front' | 'back') => {
    const asset = await pickImage(false);
    if (!asset?.uri) return;
    if (side === 'front') {
      setFrontUri(asset.uri);
      setFrontType(asset.type || 'image/jpeg');
      setFrontName(asset.fileName || 'front.jpg');
      setDocFrontUrl('');
    } else {
      setBackUri(asset.uri);
      setBackType(asset.type || 'image/jpeg');
      setBackName(asset.fileName || 'back.jpg');
      setDocBackUrl('');
    }
    setFieldErrors((e) => ({ ...e, document_front: '' }));
  };

  const handleClearUpload = async (side: 'front' | 'back') => {
    setBanner('');
    if (side === 'front') {
      setFrontUri('');
      if (!docFrontUrl) return;
    } else {
      setBackUri('');
      if (!docBackUrl) return;
    }
    setClearingSide(side);
    try {
      await kycApi.deleteUpload(side);
      if (side === 'front') setDocFrontUrl('');
      else setDocBackUrl('');
    } catch (err) {
      setBannerType('error');
      setBanner(parseApiError(err));
    } finally {
      setClearingSide(null);
    }
  };

  // Upload picked files and return { front_url, back_url }
  const uploadDocFiles = useCallback(async () => {
    if (!frontUri && !backUri) return { front: docFrontUrl, back: docBackUrl };
    setUploadingDocs(true);
    try {
      const fd = new FormData();
      if (frontUri) {
        fd.append('document_front', {
          uri: frontUri,
          type: frontType,
          name: frontName,
        } as unknown as Blob);
      }
      if (backUri) {
        fd.append('document_back', {
          uri: backUri,
          type: backType,
          name: backName,
        } as unknown as Blob);
      }
      const { data } = await kycApi.upload(fd);
      const fUrl = (data as any).document_front_url || docFrontUrl;
      const bUrl = (data as any).document_back_url || docBackUrl;
      if (fUrl) setDocFrontUrl(fUrl);
      if (bUrl) setDocBackUrl(bUrl);
      setFrontUri('');
      setBackUri('');
      return { front: fUrl, back: bUrl };
    } finally {
      setUploadingDocs(false);
    }
  }, [frontUri, backUri, frontType, frontName, backType, backName, docFrontUrl, docBackUrl]);

  const handleNext = async () => {
    setBanner('');
    if (currentStep === 0) {
      const errs = validatePersonal(personal);
      setFieldErrors(errs);
      if (Object.keys(errs).length > 0) {
        setBannerType('error');
        setBanner(Object.values(errs)[0]);
        return;
      }
      setCurrentStep(1);
      return;
    }
    if (currentStep === 1) {
      const errs = validateDoc(doc, hasFront);
      setFieldErrors(errs);
      if (Object.keys(errs).length > 0) {
        setBannerType('error');
        setBanner(Object.values(errs)[0]);
        return;
      }
      // Upload files before moving to review
      if (frontUri || backUri) {
        setLoading(true);
        try {
          await uploadDocFiles();
        } catch (err) {
          setBannerType('error');
          setBanner(parseApiError(err).message);
          setLoading(false);
          return;
        } finally {
          setLoading(false);
        }
      }
      setCurrentStep(2);
    }
  };

  const handleSubmit = async () => {
    setBanner('');
    // Final validation
    const pErrs = validatePersonal(personal);
    const dErrs = validateDoc(doc, hasFront);
    if (Object.keys(pErrs).length || Object.keys(dErrs).length) {
      setFieldErrors({ ...pErrs, ...dErrs });
      setBannerType('error');
      setBanner(Object.values({ ...pErrs, ...dErrs })[0] || 'Please fix all errors before submitting.');
      return;
    }
    if (!docFrontUrl) {
      setBannerType('error');
      setBanner('Missing document upload. Go back and upload your ID front image.');
      return;
    }

    setLoading(true);
    try {
      await kycApi.submit({
        personal_info: personal,
        document_info: {
          document_type: doc.document_type,
          document_number: doc.document_number,
          document_expiry: doc.document_expiry,
        },
        document_front_url: docFrontUrl,
        document_back_url: docBackUrl || null,
      });
      await dispatch(fetchKycThunk());
      setBannerType('success');
      setBanner('KYC submitted! We will review your documents within 1–2 business days.');
      setTimeout(() => navigation.navigate('KYCStatus'), 2000);
    } catch (err) {
      const parsed = parseApiError(err);
      setBannerType('error');
      setBanner(parsed.message);
      if (parsed.fieldErrors) {
        const errs = parsed.fieldErrors as Record<string, string>;
        setFieldErrors(errs);
        // Navigate back to relevant step
        const personalKeys = ['full_name', 'date_of_birth', 'nationality', 'address', 'city', 'country', 'postal_code'];
        const hasPersonalErr = Object.keys(errs).some((k) => personalKeys.includes(k));
        if (hasPersonalErr) setCurrentStep(0);
        else setCurrentStep(1);
      }
    } finally {
      setLoading(false);
    }
  };

  const step = STEPS[currentStep];

  const docTypeLabel = useMemo(
    () => DOC_TYPES.find((t) => t.value === doc.document_type)?.label ?? doc.document_type,
    [doc.document_type],
  );

  if ((kycMode == null && kycModeLoading) || (kycMode === 'auto' && !isKycApproved(kycStatus))) {
    return (
      <SafeAreaWrapper>
        <View style={styles.modeGate}>
          <ActivityIndicator color={Colors.goldLight} size="large" />
          <Text style={styles.modeGateText}>Opening verification…</Text>
        </View>
      </SafeAreaWrapper>
    );
  }

  return (
    <SafeAreaWrapper>
      <View style={styles.topBar}>
        <TouchableOpacity
          onPress={() => {
            if (currentStep === 0) navigation.goBack();
            else { setBanner(''); setCurrentStep((p) => p - 1); }
          }}
          style={styles.backBtn}
        >
          <Icon name="arrow-left" size={22} color={Colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.pageTitle}>Identity Verification</Text>
      </View>

      {/* Step indicators */}
      <View style={styles.stepBar}>
        {STEPS.map((s, i) => (
          <View key={s.key} style={styles.stepItem}>
            <View style={[
              styles.stepCircle,
              i < currentStep && styles.stepDone,
              i === currentStep && styles.stepActive,
            ]}>
              {i < currentStep
                ? <Icon name="check" size={14} color={Colors.success} />
                : <Text style={[styles.stepNum, i === currentStep && styles.stepNumActive]}>{i + 1}</Text>}
            </View>
            <Text style={[styles.stepLabel, i === currentStep && styles.stepLabelActive]}>
              {s.title}
            </Text>
            {i < STEPS.length - 1 && (
              <View style={[styles.stepLine, i < currentStep && styles.stepLineDone]} />
            )}
          </View>
        ))}
      </View>

      <AdaptiveKeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.content}
          {...iosManualKeyboardScrollProps()}
          showsVerticalScrollIndicator={false}
        >
          <ErrorBanner message={banner} type={bannerType} />

          <View style={styles.card}>
            <View style={styles.stepTitleRow}>
              <View style={styles.stepTitleIcon}>
                <Icon name={step.iconName} size={20} color={Colors.goldLight} />
              </View>
              <Text style={styles.stepTitle}>{step.title}</Text>
            </View>

            {/* ── Step 1: Personal Info ── */}
            {currentStep === 0 && (
              <>
                <Input
                  label="Full legal name"
                  placeholder="Exactly as on your identity document"
                  value={personal.full_name}
                  onChangeText={(v) => {
                    setPersonal((p) => ({ ...p, full_name: v }));
                    setFieldErrors((e) => ({ ...e, full_name: '' }));
                  }}
                  error={fieldErrors.full_name}
                />
                <Input
                  label="Date of birth"
                  placeholder="YYYY-MM-DD"
                  value={personal.date_of_birth}
                  onChangeText={(v) => {
                    setPersonal((p) => ({ ...p, date_of_birth: v }));
                    setFieldErrors((e) => ({ ...e, date_of_birth: '' }));
                  }}
                  keyboardType="numbers-and-punctuation"
                  error={fieldErrors.date_of_birth}
                />
                <Input
                  label="Nationality"
                  placeholder="e.g. Indian, British, American"
                  value={personal.nationality}
                  onChangeText={(v) => {
                    setPersonal((p) => ({ ...p, nationality: v }));
                    setFieldErrors((e) => ({ ...e, nationality: '' }));
                  }}
                  error={fieldErrors.nationality}
                />
                <Input
                  label="Street address"
                  placeholder="House / flat, street, area, landmark"
                  value={personal.address}
                  onChangeText={(v) => {
                    setPersonal((p) => ({ ...p, address: v }));
                    setFieldErrors((e) => ({ ...e, address: '' }));
                  }}
                  multiline
                  error={fieldErrors.address}
                />
                <Input
                  label="City"
                  placeholder="e.g. Mumbai, London, New York"
                  value={personal.city}
                  onChangeText={(v) => {
                    setPersonal((p) => ({ ...p, city: v }));
                    setFieldErrors((e) => ({ ...e, city: '' }));
                  }}
                  error={fieldErrors.city}
                />
                <Input
                  label="Country"
                  placeholder="e.g. India, United Kingdom"
                  value={personal.country}
                  onChangeText={(v) => {
                    setPersonal((p) => ({ ...p, country: v }));
                    setFieldErrors((e) => ({ ...e, country: '' }));
                  }}
                  error={fieldErrors.country}
                />
                <Input
                  label="Postal / ZIP code"
                  placeholder="e.g. 560001, SW1A 1AA, 10001"
                  value={personal.postal_code}
                  onChangeText={(v) => {
                    const clean = v.replace(/[^A-Za-z0-9\s-]/g, '').slice(0, 16);
                    setPersonal((p) => ({ ...p, postal_code: clean }));
                    setFieldErrors((e) => ({ ...e, postal_code: '' }));
                  }}
                  autoCapitalize="characters"
                  maxLength={16}
                  error={fieldErrors.postal_code}
                />
              </>
            )}

            {/* ── Step 2: Document ── */}
            {currentStep === 1 && (
              <>
                <Text style={styles.fieldLabel}>Document type</Text>
                <View style={styles.docTypeRow}>
                  {DOC_TYPES.map((t) => (
                    <TouchableOpacity
                      key={t.value}
                      style={[
                        styles.docTypeChip,
                        doc.document_type === t.value && styles.docTypeChipActive,
                      ]}
                      onPress={() => {
                        setDoc((d) => ({ ...d, document_type: t.value }));
                        setFieldErrors((e) => ({ ...e, document_type: '' }));
                      }}
                    >
                      <Text style={styles.docTypeEmoji}>{t.emoji}</Text>
                      <Text style={[
                        styles.docTypeText,
                        doc.document_type === t.value && styles.docTypeTextActive,
                      ]}>
                        {t.label}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
                {fieldErrors.document_type ? (
                  <Text style={styles.fieldError}>{fieldErrors.document_type}</Text>
                ) : null}

                <Input
                  label="Document number"
                  placeholder="As shown on the document"
                  value={doc.document_number}
                  onChangeText={(v) => {
                    setDoc((d) => ({ ...d, document_number: v.toUpperCase() }));
                    setFieldErrors((e) => ({ ...e, document_number: '' }));
                  }}
                  autoCapitalize="characters"
                  error={fieldErrors.document_number}
                />
                <Input
                  label="Expiry date"
                  placeholder="YYYY-MM-DD"
                  value={doc.document_expiry}
                  onChangeText={(v) => {
                    setDoc((d) => ({ ...d, document_expiry: v }));
                    setFieldErrors((e) => ({ ...e, document_expiry: '' }));
                  }}
                  keyboardType="numbers-and-punctuation"
                  error={fieldErrors.document_expiry}
                />

                {/* Front upload */}
                <Text style={styles.fieldLabel}>
                  Front side <Text style={styles.required}>*</Text>
                  {fieldErrors.document_front ? (
                    <Text style={styles.fieldError}> — {fieldErrors.document_front}</Text>
                  ) : null}
                </Text>
                <View style={styles.uploadWrap}>
                  {(frontUri || docFrontUrl) ? (
                    <TouchableOpacity
                      style={styles.removeBtn}
                      onPress={() => handleClearUpload('front')}
                      disabled={clearingSide === 'front'}
                    >
                      {clearingSide === 'front' ? (
                        <ActivityIndicator size="small" color={Colors.danger} />
                      ) : (
                        <>
                          <Icon name="trash-can-outline" size={14} color={Colors.danger} />
                          <Text style={styles.removeText}>Remove</Text>
                        </>
                      )}
                    </TouchableOpacity>
                  ) : null}
                  <TouchableOpacity style={styles.uploadBox} onPress={() => handlePickImage('front')}>
                    {frontUri ? (
                      <Image source={{ uri: frontUri }} style={styles.previewImg} resizeMode="cover" />
                    ) : docFrontUrl && isKycImagePath(docFrontUrl) ? (
                      <Image source={{ uri: kycMediaUrl(docFrontUrl) }} style={styles.previewImg} resizeMode="cover" />
                    ) : docFrontUrl ? (
                      <View style={styles.uploadedBadge}>
                        <Icon name="check-circle" size={22} color={Colors.success} />
                        <Text style={styles.uploadedText}>Uploaded</Text>
                      </View>
                    ) : (
                      <>
                        <Icon name="camera-outline" size={28} color={Colors.textMuted} />
                        <Text style={styles.uploadText}>Tap to upload front side</Text>
                      </>
                    )}
                  </TouchableOpacity>
                </View>

                {/* Back upload (optional for passport) */}
                {doc.document_type !== 'passport' && (
                  <>
                    <Text style={styles.fieldLabel}>Back side (optional)</Text>
                    <View style={styles.uploadWrap}>
                      {(backUri || docBackUrl) ? (
                        <TouchableOpacity
                          style={styles.removeBtn}
                          onPress={() => handleClearUpload('back')}
                          disabled={clearingSide === 'back'}
                        >
                          {clearingSide === 'back' ? (
                            <ActivityIndicator size="small" color={Colors.danger} />
                          ) : (
                            <>
                              <Icon name="trash-can-outline" size={14} color={Colors.danger} />
                              <Text style={styles.removeText}>Remove</Text>
                            </>
                          )}
                        </TouchableOpacity>
                      ) : null}
                      <TouchableOpacity style={styles.uploadBox} onPress={() => handlePickImage('back')}>
                        {backUri ? (
                          <Image source={{ uri: backUri }} style={styles.previewImg} resizeMode="cover" />
                        ) : docBackUrl && isKycImagePath(docBackUrl) ? (
                          <Image source={{ uri: kycMediaUrl(docBackUrl) }} style={styles.previewImg} resizeMode="cover" />
                        ) : docBackUrl ? (
                          <View style={styles.uploadedBadge}>
                            <Icon name="check-circle" size={22} color={Colors.success} />
                            <Text style={styles.uploadedText}>Uploaded</Text>
                          </View>
                        ) : (
                          <>
                            <Icon name="camera-outline" size={28} color={Colors.textMuted} />
                            <Text style={styles.uploadText}>Tap to upload back side</Text>
                          </>
                        )}
                      </TouchableOpacity>
                    </View>
                  </>
                )}

                {uploadingDocs && (
                  <View style={styles.uploadingRow}>
                    <Icon name="loading" size={16} color={Colors.warning} />
                    <Text style={styles.uploadingText}>Uploading…</Text>
                  </View>
                )}
              </>
            )}

            {/* ── Step 3: Review & Submit ── */}
            {currentStep === 2 && (
              <>
                {/* Personal summary */}
                <View style={styles.reviewSection}>
                  <Text style={styles.reviewSectionTitle}>Personal Information</Text>
                  {([
                    ['Full Name',      personal.full_name],
                    ['Date of Birth',  personal.date_of_birth],
                    ['Nationality',    personal.nationality],
                    ['Address',        personal.address],
                    ['City',           personal.city],
                    ['Country',        personal.country],
                    ['Postal Code',    personal.postal_code],
                  ] as [string, string][]).map(([label, value]) => (
                    <View key={label} style={styles.reviewRow}>
                      <Text style={styles.reviewLabel}>{label}</Text>
                      <Text style={styles.reviewValue} numberOfLines={2}>{value || '—'}</Text>
                    </View>
                  ))}
                </View>

                {/* Document summary */}
                <View style={styles.reviewSection}>
                  <Text style={styles.reviewSectionTitle}>Document Information</Text>
                  {([
                    ['Document Type',   docTypeLabel],
                    ['Document Number', doc.document_number],
                    ['Expiry Date',     doc.document_expiry],
                    ['Front Image',     docFrontUrl || frontUri ? 'Attached' : '—'],
                    ['Back Image',      docBackUrl || backUri ? 'Attached' : 'Not provided'],
                  ] as [string, string][]).map(([label, value]) => (
                    <View key={label} style={styles.reviewRow}>
                      <Text style={styles.reviewLabel}>{label}</Text>
                      <Text style={styles.reviewValue}>{value}</Text>
                    </View>
                  ))}
                </View>

                {/* Front / back image preview */}
                {(frontUri || (docFrontUrl && isKycImagePath(docFrontUrl))) && (
                  <View style={styles.previewCard}>
                    <Text style={styles.previewLabel}>ID front preview</Text>
                    <Image
                      source={{ uri: frontUri || kycMediaUrl(docFrontUrl) }}
                      style={styles.previewFull}
                      resizeMode="contain"
                    />
                  </View>
                )}
                {(backUri || (docBackUrl && isKycImagePath(docBackUrl))) && (
                  <View style={styles.previewCard}>
                    <Text style={styles.previewLabel}>ID back preview</Text>
                    <Image
                      source={{ uri: backUri || kycMediaUrl(docBackUrl) }}
                      style={styles.previewFull}
                      resizeMode="contain"
                    />
                  </View>
                )}

                {/* Declaration */}
                <View style={styles.declarationBox}>
                  <Icon name="alert-circle-outline" size={16} color={Colors.warning} />
                  <Text style={styles.declarationText}>
                    <Text style={{ color: Colors.warning, fontFamily: FontFamily.semiBold }}>Declaration: </Text>
                    By submitting, you confirm that all information is accurate and the documents belong to you.
                    False submissions may result in permanent account suspension.
                  </Text>
                </View>
              </>
            )}
          </View>

          {currentStep < STEPS.length - 1 ? (
            <Button
              title={`Next — ${STEPS[currentStep + 1].title}`}
              onPress={handleNext}
              loading={loading || uploadingDocs}
              fullWidth
            />
          ) : (
            <Button
              title={kyc?.rawStatus?.toLowerCase() === 'rejected' ? 'Resubmit KYC' : 'Submit KYC'}
              onPress={handleSubmit}
              loading={loading}
              fullWidth
            />
          )}

          <View style={{ height: Spacing[8] }} />
        </ScrollView>
      </AdaptiveKeyboardAvoidingView>
    </SafeAreaWrapper>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  scroll: { flex: 1 },
  content: { padding: Spacing[5], gap: Spacing[4] },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing[4],
    paddingVertical: Spacing[3],
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.surfaceBorder,
  },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', marginRight: Spacing[2] },
  pageTitle: { fontFamily: FontFamily.bold, fontSize: FontSize.xl, color: Colors.textPrimary },
  stepBar: { flexDirection: 'row', paddingHorizontal: Spacing[6], paddingBottom: Spacing[4] },
  stepItem: { flex: 1, alignItems: 'center', position: 'relative' },
  stepCircle: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: Colors.surfaceHover, borderWidth: 2, borderColor: Colors.surfaceBorder,
    alignItems: 'center', justifyContent: 'center', marginBottom: 4,
  },
  stepActive: { borderColor: Colors.gold, backgroundColor: Colors.goldAlpha15 },
  stepDone: { borderColor: Colors.success, backgroundColor: Colors.successDim },
  stepNum: { fontFamily: FontFamily.bold, fontSize: FontSize.sm, color: Colors.textMuted },
  stepNumActive: { color: Colors.goldLight },
  stepLabel: { fontFamily: FontFamily.regular, fontSize: FontSize.xs, color: Colors.textMuted, textAlign: 'center' },
  stepLabelActive: { color: Colors.goldLight, fontFamily: FontFamily.medium },
  stepLine: {
    position: 'absolute', top: 16, right: -Spacing[2],
    width: '100%', height: 2, backgroundColor: Colors.surfaceBorder,
  },
  stepLineDone: { backgroundColor: Colors.success },
  card: {
    backgroundColor: Colors.surfaceCard, borderWidth: 1,
    borderColor: Colors.surfaceBorder, borderRadius: Radius.xl, padding: Spacing[5],
    gap: Spacing[4],
  },
  stepTitleRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing[3], marginBottom: Spacing[1] },
  stepTitleIcon: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: Colors.goldAlpha10, borderWidth: 1,
    borderColor: Colors.goldAlpha30, alignItems: 'center', justifyContent: 'center',
  },
  stepTitle: { fontFamily: FontFamily.bold, fontSize: FontSize.lg, color: Colors.textPrimary },
  fieldLabel: {
    fontFamily: FontFamily.medium, fontSize: FontSize.sm,
    color: Colors.textSecondary, marginTop: Spacing[2],
  },
  required: { color: Colors.danger },
  fieldError: { fontFamily: FontFamily.regular, fontSize: FontSize.xs, color: Colors.danger },
  docTypeRow: { flexDirection: 'row', gap: Spacing[2], flexWrap: 'wrap', marginBottom: Spacing[2] },
  docTypeChip: {
    flex: 1,
    minWidth: 90,
    paddingHorizontal: Spacing[3], paddingVertical: Spacing[3],
    borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.surfaceBorder,
    backgroundColor: Colors.surfaceHover,
    alignItems: 'center',
    gap: Spacing[1],
  },
  docTypeChipActive: { borderColor: Colors.gold, backgroundColor: Colors.goldAlpha15 },
  docTypeEmoji: { fontSize: 22 },
  docTypeText: { fontFamily: FontFamily.medium, fontSize: FontSize.xs, color: Colors.textSecondary, textAlign: 'center' },
  docTypeTextActive: { color: Colors.goldLight },
  uploadBox: {
    borderWidth: 2, borderStyle: 'dashed', borderColor: Colors.surfaceBorder,
    borderRadius: Radius.lg, height: 130, alignItems: 'center', justifyContent: 'center',
    backgroundColor: Colors.surfaceHover, overflow: 'hidden',
    gap: Spacing[2],
  },
  uploadWrap: { gap: Spacing[2] },
  removeBtn: {
    alignSelf: 'flex-end',
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing[1],
    paddingVertical: Spacing[1],
    paddingHorizontal: Spacing[2],
  },
  removeText: { fontFamily: FontFamily.semiBold, fontSize: FontSize.xs, color: Colors.danger },
  uploadText: { fontFamily: FontFamily.regular, fontSize: FontSize.sm, color: Colors.textMuted },
  uploadedBadge: { alignItems: 'center', gap: Spacing[2] },
  uploadedText: { fontFamily: FontFamily.semiBold, fontSize: FontSize.sm, color: Colors.success },
  previewImg: { width: '100%', height: '100%', borderRadius: Radius.md },
  uploadingRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing[2] },
  uploadingText: { fontFamily: FontFamily.regular, fontSize: FontSize.xs, color: Colors.warning },
  reviewSection: {
    borderWidth: 1, borderColor: Colors.surfaceBorder,
    borderRadius: Radius.lg, overflow: 'hidden',
  },
  reviewSectionTitle: {
    fontFamily: FontFamily.bold, fontSize: FontSize.xs,
    color: Colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.8,
    paddingHorizontal: Spacing[4], paddingVertical: Spacing[3],
    backgroundColor: Colors.surfaceHover,
    borderBottomWidth: 1, borderBottomColor: Colors.surfaceBorder,
  },
  reviewRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: Spacing[4], paddingVertical: Spacing[3],
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: Colors.surfaceBorder,
  },
  reviewLabel: { fontFamily: FontFamily.regular, fontSize: FontSize.sm, color: Colors.textMuted, flex: 1 },
  reviewValue: {
    fontFamily: FontFamily.semiBold, fontSize: FontSize.sm, color: Colors.textPrimary,
    flex: 1, textAlign: 'right',
  },
  previewCard: {
    borderWidth: 1, borderColor: Colors.surfaceBorder,
    borderRadius: Radius.lg, padding: Spacing[3], gap: Spacing[2],
    backgroundColor: Colors.surfaceHover,
  },
  previewLabel: { fontFamily: FontFamily.medium, fontSize: FontSize.xs, color: Colors.textMuted },
  previewFull: { height: 180, borderRadius: Radius.md },
  declarationBox: {
    flexDirection: 'row', gap: Spacing[3], alignItems: 'flex-start',
    backgroundColor: Colors.warningDim,
    borderWidth: 1, borderColor: Colors.warning + '40',
    borderRadius: Radius.lg, padding: Spacing[4],
  },
  declarationText: {
    fontFamily: FontFamily.regular, fontSize: FontSize.sm,
    color: Colors.textSecondary, flex: 1, lineHeight: 20,
  },
  modeGate: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing[4],
  },
  modeGateText: {
    fontFamily: FontFamily.regular,
    fontSize: FontSize.sm,
    color: Colors.textMuted,
  },
});
