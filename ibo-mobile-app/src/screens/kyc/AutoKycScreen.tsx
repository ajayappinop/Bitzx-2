/**
 * AutoKycScreen — guided auto-KYC flow (DigiLocker → PAN → selfie).
 * Shown when kyc_mode === 'auto' from the server.
 *
 * Step derivation from server rawStatus:
 *   digilocker_pending  → 'digilocker'  (waiting for user to complete in browser)
 *   digilocker_failed   → 'start'       (with failure reason shown)
 *   awaiting_pan        → 'pan'
 *   pan_verify_failed   → 'pan'         (with error)
 *   awaiting_selfie     → 'selfie'
 *   face_match_failed   → 'selfie'      (with error)
 *   approved / pending  → 'done'
 *   default             → 'start'
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Platform,
  Linking,
  AppState,
  AppStateStatus,
} from 'react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RouteProp, useFocusEffect } from '@react-navigation/native';
import { useDispatch, useSelector } from 'react-redux';
import SafeAreaWrapper from '../../components/common/SafeAreaWrapper';
import Button from '../../components/common/Button';
import ErrorBanner from '../../components/common/ErrorBanner';
import DigilockerAuthWebView, {
  isDigilockerReturnUrl,
  parseDigilockerReturnUrl,
} from '../../components/kyc/DigilockerAuthWebView';
import InAppBrowser from 'react-native-inappbrowser-reborn';
import { openDigiLockerUrl } from '../../services/digilocker.browser';
import SelfieCaptureModal from '../../components/kyc/SelfieCaptureModal';
import Icon from '@/components/common/AppIcon';
import Input from '../../components/common/Input';
import { ProfileStackParamList } from '../../navigation/types';
import { RootState, AppDispatch } from '../../store';
import { fetchKycThunk } from '../../store/auth.slice';
import { kycApi } from '../../api/kyc.api';
import { parseApiError } from '../../api/errors';
import { resolveDigilockerInitUrl } from '../../types/kyc.types';
import { Colors, FontFamily, FontSize, Radius, Spacing } from '../../theme';
import { humanizeFaceMatchMessage, normalizeKycPayload } from '../../utils/kycGate';
import { iosManualKeyboardScrollProps } from '@/utils/iosKeyboardScroll';

type Props = {
  navigation: NativeStackNavigationProp<ProfileStackParamList, 'AutoKyc'>;
  route: RouteProp<ProfileStackParamList, 'AutoKyc'>;
};

type FlowStep = 'start' | 'digilocker' | 'pan' | 'selfie' | 'done';

const STEP_ORDER: FlowStep[] = ['start', 'digilocker', 'pan', 'selfie', 'done'];
const STEP_LABELS = ['Start', 'DigiLocker', 'PAN', 'Selfie', 'Done'];

/** Derive the correct initial step from the server rawStatus string. */
function stepFromRawStatus(
  rawStatus: string | undefined | null,
): FlowStep {
  const s = String(rawStatus ?? '').toLowerCase().trim();
  if (s === 'approved' || s === 'pending' || s === 'under_review') return 'done';
  if (s === 'digilocker_pending') return 'digilocker';
  if (s === 'digilocker_failed') return 'start';
  if (s === 'awaiting_pan' || s === 'pan_verify_failed') return 'pan';
  if (s === 'awaiting_selfie' || s === 'face_match_failed') return 'selfie';
  return 'start';
}

/** True when the raw status signals a prior step failure (so we show the server error). */
function isFailureStatus(rawStatus: string | undefined | null): boolean {
  const s = String(rawStatus ?? '').toLowerCase().trim();
  return ['digilocker_failed', 'pan_verify_failed', 'face_match_failed'].includes(s);
}

export default function AutoKycScreen({ navigation }: Props) {
  const dispatch = useDispatch<AppDispatch>();
  const { kyc, user } = useSelector((s: RootState) => s.auth);
  const uid = user?.uid ?? '';

  const rawStatus = kyc?.rawStatus;

  const initialStep = useMemo(() => stepFromRawStatus(rawStatus), [rawStatus]);
  const [step, setStep] = useState<FlowStep>(initialStep);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // PAN
  const [panNumber, setPanNumber] = useState('');
  const [panVerified, setPanVerified] = useState(false);

  // DigiLocker
  const [digiRequestId, setDigiRequestId] = useState('');
  const [digiUrl, setDigiUrl] = useState('');
  const [digiWebViewVisible, setDigiWebViewVisible] = useState(false);
  const [selfieModalVisible, setSelfieModalVisible] = useState(false);
  const [selfieStatus, setSelfieStatus] = useState('');
  const completingDigiRef = useRef(false);
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);

  // Seed initial failure messages from server state
  const serverFailureMsg = useMemo(() => {
    if (!isFailureStatus(rawStatus)) return '';
    const s = String(rawStatus ?? '').toLowerCase();
    if (s === 'digilocker_failed') {
      return kyc?.digilocker_failure_reason
        ? `DigiLocker failed: ${kyc.digilocker_failure_reason}`
        : 'DigiLocker verification failed. Please try again.';
    }
    if (s === 'pan_verify_failed') {
      return kyc?.pan_verify?.message || 'PAN verification failed. Please check your PAN number.';
    }
    if (s === 'face_match_failed') {
      return humanizeFaceMatchMessage(kyc?.face_match?.message, {
        verified: false,
        matchPercentage: kyc?.face_match?.match_percentage,
      });
    }
    return '';
  }, [rawStatus, kyc]);

  useEffect(() => {
    if (serverFailureMsg) setError(serverFailureMsg);
  }, [serverFailureMsg, uid]);

  // Reset wizard state when a different account is active (e.g. login without logout).
  useEffect(() => {
    setStep(stepFromRawStatus(rawStatus));
    setLoading(false);
    setError('');
    setPanNumber('');
    setPanVerified(false);
    setDigiRequestId('');
    setDigiUrl('');
    setDigiWebViewVisible(false);
    setSelfieModalVisible(false);
    setSelfieStatus('');
    completingDigiRef.current = false;
  }, [uid]);

  useFocusEffect(
    useCallback(() => {
      void dispatch(fetchKycThunk());
    }, [dispatch, uid]),
  );

  useEffect(() => {
    setStep(stepFromRawStatus(rawStatus));
  }, [rawStatus]);


  const refreshKyc = useCallback(async () => {
    const result = await dispatch(fetchKycThunk());
    const bundle = (result as { payload?: { status?: unknown } }).payload;
    const updated = bundle?.status ? normalizeKycPayload(bundle.status) : null;
    if (updated?.rawStatus) {
      const next = stepFromRawStatus(updated.rawStatus);
      setStep(next);
      if (isFailureStatus(updated.rawStatus)) {
        const s = String(updated.rawStatus).toLowerCase();
        if (s === 'digilocker_failed') {
          setError(
            updated.digilocker_failure_reason
              ? `DigiLocker failed: ${updated.digilocker_failure_reason}`
              : 'DigiLocker verification failed. Please try again.',
          );
        } else if (s === 'pan_verify_failed') {
          setError(updated.pan_verify?.message || 'PAN verification failed.');
        } else if (s === 'face_match_failed') {
          setError(
            humanizeFaceMatchMessage(updated.face_match?.message, {
              verified: false,
              matchPercentage: updated.face_match?.match_percentage,
            }),
          );
        }
      }
    }
  }, [dispatch]);

  // ── DigiLocker ───────────────────────────────────────────────────────────────
  /**
   * Opens DigiLocker inside an in-app browser (Chrome Custom Tab on Android,
   * SFSafariViewController on iOS). When the user finishes or dismisses the
   * browser, we immediately poll /api/kyc/status so the step advances
   * automatically — no manual "I've completed it" button needed.
   */
  const digilockerClient = Platform.OS === 'android' ? 'android' : Platform.OS === 'ios' ? 'ios' : 'web';

  const finalizeDigilocker = useCallback(
    async (returnUrl?: string) => {
      if (completingDigiRef.current) return;
      completingDigiRef.current = true;
      setDigiWebViewVisible(false);
      setLoading(true);
      setError('');

      const fromUrl = returnUrl ? parseDigilockerReturnUrl(returnUrl).requestId : undefined;
      if (fromUrl && digiRequestId && fromUrl !== digiRequestId) {
        // Stale deep link from another account/session — ignore URL request_id.
        await refreshKyc();
        setLoading(false);
        completingDigiRef.current = false;
        return;
      }

      try {
        if (digiRequestId) {
          await kycApi.completeDigilocker({ request_id: digiRequestId });
        } else if (rawStatus === 'digilocker_pending' || rawStatus === 'digilocker_failed') {
          await kycApi.completeDigilocker();
        }
      } catch {
        /* Signzy webhook may have already applied — still refresh */
      }
      await refreshKyc();
      setLoading(false);
      completingDigiRef.current = false;
    },
    [digiRequestId, rawStatus, refreshKyc],
  );

  const handleDigilockerReturnUrl = useCallback(
    (url: string) => {
      if (!isDigilockerReturnUrl(url)) return;
      void finalizeDigilocker(url);
    },
    [finalizeDigilocker],
  );

  // Deep link: ibo://kyc/digilocker-complete (return bridge page)
  useFocusEffect(
    useCallback(() => {
      const onUrl = ({ url }: { url: string }) => {
        handleDigilockerReturnUrl(url);
      };
      const sub = Linking.addEventListener('url', onUrl);
      Linking.getInitialURL()
        .then((url) => {
          if (url) handleDigilockerReturnUrl(url);
        })
        .catch(() => {});
      return () => sub.remove();
    }, [handleDigilockerReturnUrl]),
  );

  // If user switched apps during DigiLocker, poll when they return
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      if (
        appStateRef.current.match(/inactive|background/) &&
        next === 'active' &&
        step === 'digilocker' &&
        digiRequestId &&
        !digiWebViewVisible
      ) {
        void finalizeDigilocker();
      }
      appStateRef.current = next;
    });
    return () => sub.remove();
  }, [step, digiRequestId, digiWebViewVisible, finalizeDigilocker]);

  const openDigilockerSession = useCallback(
    async (authUrl: string, requestId: string) => {
      setDigiRequestId(requestId);
      setDigiUrl(authUrl);
      setStep('digilocker');
      setError('');
      completingDigiRef.current = false;

      const native = Platform.OS === 'android' || Platform.OS === 'ios';
      if (native) {
        try {
          if (await InAppBrowser.isAvailable()) {
            setDigiWebViewVisible(false);
            await openDigiLockerUrl(authUrl);
            if (!completingDigiRef.current) {
              await finalizeDigilocker();
            }
            return;
          }
        } catch {
          /* fall through to in-app WebView */
        }
      }

      setDigiWebViewVisible(true);
    },
    [finalizeDigilocker],
  );

  const startDigilocker = async () => {
    setLoading(true);
    setError('');
    try {
      const { data } = await kycApi.initDigilocker(digilockerClient);
      const authUrl = resolveDigilockerInitUrl(data);
      if (!authUrl) {
        setError('DigiLocker URL was not returned by the server. Please try again.');
        return;
      }
      if (!data.request_id) {
        setError('DigiLocker session could not be started. Please try again.');
        return;
      }
      await openDigilockerSession(authUrl, data.request_id);
    } catch (err) {
      setError(parseApiError(err).message);
    } finally {
      setLoading(false);
    }
  };

  const reopenDigilocker = async () => {
    if (digiUrl && digiRequestId) {
      await openDigilockerSession(digiUrl, digiRequestId);
      return;
    }
    await startDigilocker();
  };

  const checkDigilockerStatus = async () => {
    setLoading(true);
    setError('');
    try {
      await finalizeDigilocker();
    } finally {
      setLoading(false);
    }
  };

  // ── PAN ──────────────────────────────────────────────────────────────────────
  const verifyPan = async () => {
    const pan = panNumber.trim().toUpperCase();
    if (!/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(pan)) {
      setError('Enter a valid 10-character PAN number (e.g. ABCDE1234F).');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const personal = kyc?.personal_info;
      await kycApi.verifyPan(pan, {
        name: personal?.full_name,
        date_of_birth: personal?.date_of_birth,
      });
      setPanVerified(true);
      await refreshKyc();
    } catch (err) {
      setError(parseApiError(err).message);
    } finally {
      setLoading(false);
    }
  };

  // ── Selfie ───────────────────────────────────────────────────────────────────
  const openSelfieCapture = () => {
    setError('');
    setSelfieModalVisible(true);
  };

  /** Called by SelfieCaptureModal when the WebView has uploaded the selfie successfully. */
  const handleSelfieUploaded = async (selfieUrl: string) => {
    if (!selfieUrl) {
      setError('Selfie upload failed — please try again.');
      return;
    }
    setLoading(true);
    setError('');
    setSelfieStatus('Verifying face match — this can take up to 2 minutes…');
    try {
      const matchRes = await kycApi.faceMatch();
      const match = matchRes.data;
      if (!match?.verified) {
        setError(
          humanizeFaceMatchMessage(match?.message, {
            verified: false,
            matchPercentage: match?.match_percentage,
          }),
        );
        await refreshKyc();
        return;
      }
      await refreshKyc();
    } catch (err) {
      const parsed = parseApiError(err);
      const msg = parsed.message ?? '';
      // Backend requires PAN before face-match — redirect user to PAN step
      if (
        msg.toLowerCase().includes('pan verification required') ||
        msg.toLowerCase().includes('pan/verify') ||
        parsed.status === 400 && msg.toLowerCase().includes('pan')
      ) {
        setStep('pan');
        setError('PAN verification is required before face match. Please verify your PAN first.');
      } else {
        setError(msg || 'Face verification failed. Please try again.');
      }
    } finally {
      setSelfieStatus('');
      setLoading(false);
    }
  };

  // ── Step index for progress bar ───────────────────────────────────────────────
  const stepIndex = STEP_ORDER.indexOf(step);

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <SafeAreaWrapper>
      <View style={styles.topBar}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Icon name="arrow-left" size={22} color={Colors.textSecondary} />
        </TouchableOpacity>
        <Text style={styles.title}>Auto KYC</Text>
      </View>

      <ScrollView contentContainerStyle={styles.body} {...iosManualKeyboardScrollProps()}>

        {/* Step progress indicator */}
        <View style={styles.stepRow}>
          {STEP_ORDER.map((s, i) => {
            const done = stepIndex > i;
            const active = step === s;
            return (
              <View key={s} style={styles.stepItem}>
                <View style={[styles.dot, active && styles.dotActive, done && styles.dotDone]}>
                  {done
                    ? <Icon name="check" size={12} color={Colors.surfaceDark} />
                    : <Text style={[styles.dotNum, active && styles.dotNumActive]}>{i + 1}</Text>
                  }
                </View>
                <Text style={[styles.stepLabel, active && styles.stepLabelActive]}>{STEP_LABELS[i]}</Text>
              </View>
            );
          })}
        </View>

        {error ? <ErrorBanner message={error} /> : null}

        {/* ── START ── */}
        {step === 'start' && (
          <View style={styles.card}>
            <View style={styles.cardIconWrap}>
              <Icon name="shield-check-outline" size={38} color={Colors.goldLight} />
            </View>
            <Text style={styles.cardTitle}>Instant Verification</Text>
            <Text style={styles.cardBody}>
              Link your DigiLocker account to verify your identity automatically using your Aadhaar. No document uploads needed.
            </Text>

            <View style={styles.howItWorks}>
              <Text style={styles.howTitle}>How it works</Text>
              {[
                'Tap "Start with DigiLocker" — verification opens inside this app.',
                'Log in with your Aadhaar-linked mobile number.',
                'Grant consent to share your Aadhaar details with IBO.',
                'When finished, you return here automatically — no manual refresh.',
              ].map((t, i) => (
                <View key={i} style={styles.howRow}>
                  <View style={styles.howNum}><Text style={styles.howNumText}>{i + 1}</Text></View>
                  <Text style={styles.howText}>{t}</Text>
                </View>
              ))}
            </View>

            <Button
              title="Start with DigiLocker"
              onPress={startDigilocker}
              loading={loading}
              fullWidth
            />
          </View>
        )}

        {/* ── DIGILOCKER ── */}
        {step === 'digilocker' && (
          <View style={styles.card}>
            <View style={styles.cardIconWrap}>
              <Icon name="link-variant" size={38} color={Colors.info} />
            </View>
            <Text style={styles.cardTitle}>Complete DigiLocker</Text>
            <Text style={styles.cardBody}>
              Finish login and consent in the in-app window. When DigiLocker redirects back,
              we verify your status and move you to the next step automatically.
            </Text>

            <View style={[styles.infoBanner, { borderColor: Colors.infoDim ?? Colors.surfaceBorder }]}>
              <Icon name="information-outline" size={16} color={Colors.info} />
              <Text style={[styles.infoBannerText, { color: Colors.info }]}>
                Window closed early? Tap Reopen DigiLocker to continue where you left off.
              </Text>
            </View>

            <Button
              title={digiWebViewVisible ? 'DigiLocker open…' : 'Open DigiLocker'}
              onPress={reopenDigilocker}
              loading={loading}
              disabled={digiWebViewVisible}
              fullWidth
            />
            <TouchableOpacity onPress={checkDigilockerStatus} style={styles.secondaryBtn}>
              <Icon name="refresh" size={15} color={Colors.textMuted} />
              <Text style={[styles.secondaryBtnText, { color: Colors.textMuted }]}>
                Sync verification status
              </Text>
            </TouchableOpacity>
          </View>
        )}

        {/* ── PAN ── */}
        {step === 'pan' && (
          <View style={styles.card}>
            <View style={styles.cardIconWrap}>
              <Icon name="card-account-details-outline" size={38} color={Colors.goldLight} />
            </View>
            <Text style={styles.cardTitle}>PAN Verification</Text>
            <Text style={styles.cardBody}>
              Enter your PAN card number exactly as printed on your card. This is used to verify your tax identity.
            </Text>
            <Input
              label="PAN Number"
              value={panNumber}
              onChangeText={(t) => {
                setError('');
                setPanNumber(t.toUpperCase().replace(/[^A-Z0-9]/g, ''));
              }}
              autoCapitalize="characters"
              maxLength={10}
              placeholder="ABCDE1234F"
              keyboardType="default"
            />
            {panVerified && (
              <View style={[styles.infoBanner, { borderColor: Colors.success + '40' }]}>
                <Icon name="check-circle-outline" size={16} color={Colors.success} />
                <Text style={[styles.infoBannerText, { color: Colors.success }]}>PAN verified successfully</Text>
              </View>
            )}
            <Button
              title="Verify PAN"
              onPress={verifyPan}
              loading={loading}
              fullWidth
            />
          </View>
        )}

        {/* ── SELFIE ── */}
        {step === 'selfie' && (
          <View style={styles.card}>
            <View style={styles.cardIconWrap}>
              <Icon name="camera-enhance-outline" size={38} color={Colors.goldLight} />
            </View>
            <Text style={styles.cardTitle}>Face Match</Text>
            <Text style={styles.cardBody}>
              Take a <Text style={{ color: Colors.goldLight, fontFamily: FontFamily.semiBold }}>live selfie</Text> in the
              preview below. Your face must match the photo on your Aadhaar document.
            </Text>

            <View style={styles.selfieGuide}>
              {[
                { icon: 'weather-sunny',    text: 'Good, even lighting — no harsh shadows' },
                { icon: 'eye-outline',      text: 'Eyes open, full face visible' },
                { icon: 'glasses',          text: 'Remove glasses if possible' },
                { icon: 'image-filter-none',text: 'No filters, masks, or blur' },
                { icon: 'camera-front',     text: 'Live front-camera preview inside the app' },
              ].map((tip, i) => (
                <View key={i} style={styles.selfieGuideRow}>
                  <Icon name={tip.icon} size={18} color={Colors.goldLight} />
                  <Text style={styles.selfieGuideText}>{tip.text}</Text>
                </View>
              ))}
            </View>

            <Button
              title={
                loading
                  ? selfieStatus || 'Verifying…'
                  : 'Take Live Selfie'
              }
              onPress={openSelfieCapture}
              loading={loading}
              disabled={loading}
              fullWidth
            />
            {loading && selfieStatus ? (
              <Text style={styles.selfieStatusText}>{selfieStatus}</Text>
            ) : null}
          </View>
        )}

        {/* ── DONE ── */}
        {step === 'done' && (
          <View style={styles.card}>
            <View style={[styles.cardIconWrap, { backgroundColor: Colors.success + '18' }]}>
              <Icon name="check-circle-outline" size={48} color={Colors.success} />
            </View>
            <Text style={styles.cardTitle}>
              {String(rawStatus ?? '').toLowerCase() === 'approved'
                ? 'Identity Verified!'
                : 'Submitted for Review'}
            </Text>
            <Text style={styles.cardBody}>
              {String(rawStatus ?? '').toLowerCase() === 'approved'
                ? 'Your KYC has been approved. Trading and wallet features are now fully available.'
                : 'Your auto-KYC data has been submitted. Most reviews complete within minutes. We will notify you once approved.'}
            </Text>
            <Button
              title="Back to Verification Status"
              onPress={() => navigation.navigate('KYCStatus')}
              fullWidth
            />
          </View>
        )}
      </ScrollView>

      <DigilockerAuthWebView
        visible={digiWebViewVisible}
        url={digiUrl}
        onClose={() => {
          setDigiWebViewVisible(false);
          // User dismissed the window — still sync (webhook may have completed).
          if (digiRequestId && !completingDigiRef.current) {
            void finalizeDigilocker();
          }
        }}
        onReturn={handleDigilockerReturnUrl}
      />

      <SelfieCaptureModal
        visible={selfieModalVisible}
        onClose={() => setSelfieModalVisible(false)}
        onUploadComplete={(selfieUrl) => {
          setSelfieModalVisible(false);
          void handleSelfieUploaded(selfieUrl);
        }}
        onUploadError={(msg) => {
          setSelfieModalVisible(false);
          setError(`Selfie upload failed: ${msg}`);
        }}
      />
    </SafeAreaWrapper>
  );
}

const styles = StyleSheet.create({
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing[4],
    paddingVertical: Spacing[3],
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.surfaceBorder,
  },
  backBtn: { marginRight: Spacing[2] },
  title: {
    fontFamily: FontFamily.bold,
    fontSize: FontSize.xl,
    color: Colors.textPrimary,
  },
  body: {
    padding: Spacing[4],
    paddingBottom: Spacing[10],
    gap: Spacing[4],
  },
  stepRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing[2],
    marginBottom: Spacing[2],
  },
  stepItem: { alignItems: 'center', flex: 1 },
  dot: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: Colors.surfaceCard,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  dotActive: { borderColor: Colors.gold, backgroundColor: Colors.gold + '22' },
  dotDone: { borderColor: Colors.success, backgroundColor: Colors.success },
  dotNum: {
    fontFamily: FontFamily.bold,
    fontSize: 11,
    color: Colors.textMuted,
  },
  dotNumActive: { color: Colors.goldLight },
  stepLabel: {
    fontFamily: FontFamily.regular,
    fontSize: 10,
    color: Colors.textMuted,
    textAlign: 'center',
  },
  stepLabelActive: { color: Colors.goldLight, fontFamily: FontFamily.medium },
  card: {
    backgroundColor: Colors.surfaceCard,
    borderRadius: Radius.xl,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.surfaceBorder,
    padding: Spacing[5],
    gap: Spacing[4],
  },
  cardIconWrap: {
    alignSelf: 'center',
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: Colors.goldAlpha10,
    borderWidth: 1,
    borderColor: Colors.goldAlpha30,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardTitle: {
    fontFamily: FontFamily.bold,
    fontSize: FontSize.xl,
    color: Colors.textPrimary,
    textAlign: 'center',
  },
  cardBody: {
    fontFamily: FontFamily.regular,
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    textAlign: 'center',
    lineHeight: 21,
  },
  howItWorks: {
    backgroundColor: Colors.surfaceHover,
    borderRadius: Radius.lg,
    padding: Spacing[4],
    gap: Spacing[3],
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
  },
  howTitle: {
    fontFamily: FontFamily.semiBold,
    fontSize: FontSize.xs,
    color: Colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: Spacing[1],
  },
  howRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing[3] },
  howNum: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: Colors.goldAlpha15,
    borderWidth: 1,
    borderColor: Colors.goldAlpha30,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  howNumText: {
    fontFamily: FontFamily.bold,
    fontSize: 11,
    color: Colors.goldLight,
  },
  howText: {
    fontFamily: FontFamily.regular,
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    flex: 1,
    lineHeight: 20,
  },
  infoBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing[2],
    borderWidth: 1,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing[3],
    paddingVertical: Spacing[3],
    backgroundColor: Colors.surfaceHover,
  },
  infoBannerText: {
    fontFamily: FontFamily.regular,
    fontSize: FontSize.xs,
    lineHeight: 18,
    flex: 1,
    color: Colors.textSecondary,
  },
  secondaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing[2],
    paddingVertical: Spacing[2],
  },
  secondaryBtnText: {
    fontFamily: FontFamily.semiBold,
    fontSize: FontSize.sm,
    color: Colors.goldLight,
  },
  selfieGuide: {
    backgroundColor: Colors.surfaceHover,
    borderRadius: Radius.lg,
    padding: Spacing[4],
    gap: Spacing[3],
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
  },
  selfieGuideRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing[3] },
  selfieGuideText: {
    fontFamily: FontFamily.regular,
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    flex: 1,
  },
  selfieStatusText: {
    fontFamily: FontFamily.regular,
    fontSize: FontSize.xs,
    color: Colors.textMuted,
    textAlign: 'center',
    marginTop: -Spacing[2],
  },
});
