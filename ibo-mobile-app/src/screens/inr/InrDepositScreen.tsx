import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TextInput, TouchableOpacity, Alert, Linking,
  Image, Modal, ActivityIndicator,
} from 'react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { launchImageLibrary } from 'react-native-image-picker';
import SafeAreaWrapper from '../../components/common/SafeAreaWrapper';
import ScreenHeader from '../../components/common/ScreenHeader';
import Button from '../../components/common/Button';
import ErrorBanner from '../../components/common/ErrorBanner';
import { WalletStackParamList } from '../../navigation/types';
import {
  fetchInrDepositConfig,
  fetchInrPaymentMethods,
  resolveInrAssetUrl,
  startInrGatewayDeposit,
  submitInrDeposit,
} from '../../services/inrApi';
import { Colors, FontFamily, FontSize, Radius, Spacing } from '../../theme';
import { formatInrAmount, parseInrAmountInput } from '../../utils/inrWithdrawal';
import { iosManualKeyboardScrollProps } from '@/utils/iosKeyboardScroll';

type Nav = NativeStackNavigationProp<WalletStackParamList, 'InrDeposit'>;

type PaymentMethod = {
  id?: string;
  type?: string;
  label?: string;
  qr_image_url?: string;
  details?: Record<string, unknown>;
};

function methodChipLabel(m: PaymentMethod): string {
  if (m.label) return String(m.label);
  if (m.type === 'qr') return 'QR Code';
  if (m.type === 'upi') return 'UPI';
  if (m.type === 'bank') return 'Bank';
  return 'Method';
}

export default function InrDepositScreen({ navigation }: { navigation: Nav }) {
  const [methods, setMethods] = useState<PaymentMethod[]>([]);
  const [config, setConfig] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [amountInr, setAmountInr] = useState('');
  const [utr, setUtr] = useState('');
  const [note, setNote] = useState('');
  const [methodId, setMethodId] = useState('');
  const [screenshot, setScreenshot] = useState<{ uri: string; type?: string; name?: string } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [qrModalOpen, setQrModalOpen] = useState(false);
  const [qrImageError, setQrImageError] = useState(false);

  const [configLoaded, setConfigLoaded] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    setConfigLoaded(false);
    try {
      const m = await fetchInrPaymentMethods();
      const items = (m as PaymentMethod[]) ?? [];
      setMethods(items);
      if (items[0]?.id) setMethodId(String(items[0].id));

      try {
        const cfg = await fetchInrDepositConfig();
        setConfig(cfg);
      } catch (cfgErr) {
        setConfig(null);
        setError((cfgErr as Error).message || 'Could not load INR deposit settings');
      } finally {
        setConfigLoaded(true);
      }
    } catch (e) {
      setError((e as Error).message);
      setConfigLoaded(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const activeMethod = useMemo(
    () => methods.find((m) => String(m.id) === methodId) ?? methods[0],
    [methods, methodId],
  );

  const details = (activeMethod?.details ?? {}) as Record<string, unknown>;
  const qrSrc = useMemo(
    () => resolveInrAssetUrl(activeMethod?.qr_image_url),
    [activeMethod?.qr_image_url],
  );

  useEffect(() => {
    setQrImageError(false);
  }, [qrSrc, methodId]);

  const pickScreenshot = async () => {
    const res = await launchImageLibrary({ mediaType: 'photo', selectionLimit: 1 });
    const asset = res.assets?.[0];
    if (asset?.uri) {
      setScreenshot({
        uri: asset.uri,
        type: asset.type || 'image/jpeg',
        name: asset.fileName || 'proof.jpg',
      });
    }
  };

  const manualEnabled = configLoaded && config?.manual_enabled !== false;
  const gatewayEnabled = configLoaded && Boolean(config?.gateway_enabled);
  const gatewayReady = configLoaded && Boolean(config?.gateway_ready);
  const settingsReady = configLoaded && config != null;

  const minDepositInr = useMemo(() => {
    const raw = config?.min_deposit_inr;
    const n = typeof raw === 'number' ? raw : Number(raw);
    return Number.isFinite(n) && n > 0 ? n : 0;
  }, [config]);

  const parsedAmount = useMemo(() => parseInrAmountInput(amountInr), [amountInr]);
  const showBelowMinPill = useMemo(() => {
    if (minDepositInr <= 0) return false;
    if (!amountInr.trim()) return false;
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) return false;
    return parsedAmount < minDepositInr;
  }, [amountInr, minDepositInr, parsedAmount]);

  const renderMinPaymentNotice = () => {
    if (!manualEnabled || minDepositInr <= 0) return null;
    return (
      <View style={styles.minNotice}>
        <Text style={styles.minNoticeText}>
          Only deposits of {formatInrAmount(minDepositInr)} or more are accepted. Please don't transfer a lower amount.
        </Text>
      </View>
    );
  };

  const validateAmount = (amt: number): string | null => {
    if (!Number.isFinite(amt) || amt <= 0) return 'Enter a valid INR amount.';
    if (minDepositInr > 0 && amt < minDepositInr) {
      return `Minimum deposit is ${formatInrAmount(minDepositInr)}.`;
    }
    return null;
  };

  const onGateway = async () => {
    if (!settingsReady) {
      Alert.alert('Settings unavailable', 'Deposit settings could not be loaded. Pull to refresh or try again.');
      return;
    }
    if (!gatewayEnabled) {
      Alert.alert('Gateway unavailable', 'Automatic payment gateway is not enabled.');
      return;
    }
    if (!gatewayReady) {
      Alert.alert('Gateway unavailable', 'Payment gateway is not configured yet. Use manual deposit or try again later.');
      return;
    }
    const amt = parseInrAmountInput(amountInr);
    const amountError = validateAmount(amt);
    if (amountError) {
      Alert.alert('Amount required', amountError);
      return;
    }
    setSubmitting(true);
    try {
      const data = await startInrGatewayDeposit({ amount_inr: amt, payment_method_id: methodId });
      const url = String((data as Record<string, unknown>)?.checkout_url || '');
      if (url) await Linking.openURL(url);
      else Alert.alert('Gateway', 'Checkout started. Complete payment in your browser.');
    } catch (e) {
      Alert.alert('Gateway failed', (e as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  const onSubmitProof = async () => {
    if (!settingsReady) {
      Alert.alert('Settings unavailable', 'Deposit settings could not be loaded. Pull to refresh or try again.');
      return;
    }
    if (!manualEnabled) {
      Alert.alert('Manual deposit disabled', 'Manual INR deposits are not enabled. Use the payment gateway.');
      return;
    }
    const amt = parseInrAmountInput(amountInr);
    const amountError = validateAmount(amt);
    if (amountError) {
      Alert.alert('Missing fields', amountError);
      return;
    }
    if (!methodId) {
      Alert.alert('Missing fields', 'Select a payment method.');
      return;
    }
    if (!utr.trim()) {
      Alert.alert('Missing fields', 'Enter UTR/reference number.');
      return;
    }
    if (!screenshot) {
      Alert.alert('Missing fields', 'Attach a payment screenshot before submitting.');
      return;
    }
    setSubmitting(true);
    try {
      const fd = new FormData();
      fd.append('amount_inr', String(amt));
      fd.append('utr_number', utr.trim());
      if (methodId) fd.append('payment_method_id', methodId);
      if (note.trim()) fd.append('note', note.trim());
      if (screenshot) {
        fd.append('screenshot', {
          uri: screenshot.uri,
          type: screenshot.type || 'image/jpeg',
          name: screenshot.name || 'proof.jpg',
        } as unknown as Blob);
      }
      await submitInrDeposit(fd);
      Alert.alert('Submitted', 'Your INR deposit proof was submitted for review.', [
        { text: 'OK', onPress: () => navigation.navigate('InrDepositsHistory') },
      ]);
    } catch (e) {
      Alert.alert('Submit failed', (e as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  const renderMethodDetails = () => {
    if (!activeMethod) return null;
    const type = String(activeMethod.type || '');

    if (type === 'qr') {
      const label = String(details.label || activeMethod.label || 'Payment QR');
      return (
        <View style={styles.methodCard}>
          <Text style={styles.methodTitle}>{label}</Text>
          {renderMinPaymentNotice()}
          <Text style={styles.methodHint}>Scan this QR with your UPI or banking app, then submit proof below.</Text>
          {qrSrc && !qrImageError ? (
            <TouchableOpacity
              style={styles.qrTap}
              onPress={() => setQrModalOpen(true)}
              activeOpacity={0.85}
              accessibilityLabel="Payment QR code — tap to enlarge"
            >
              <Image
                source={{ uri: qrSrc }}
                style={styles.qrImage}
                resizeMode="contain"
                onError={() => setQrImageError(true)}
              />
              <Text style={styles.qrTapHint}>Tap to enlarge</Text>
            </TouchableOpacity>
          ) : (
            <View style={styles.qrMissing}>
              <Text style={styles.qrMissingText}>
                {qrImageError
                  ? 'QR image could not be loaded. Check admin upload or try again later.'
                  : 'QR image is not configured for this method yet.'}
              </Text>
            </View>
          )}
        </View>
      );
    }

    if (type === 'upi') {
      return (
        <View style={styles.methodCard}>
          <Text style={styles.methodTitle}>{String(activeMethod.label || 'UPI')}</Text>
          {renderMinPaymentNotice()}
          {details.upi_id ? <Text style={styles.methodLine}>UPI ID: {String(details.upi_id)}</Text> : null}
          {details.display_name ? (
            <Text style={styles.methodLine}>Name: {String(details.display_name)}</Text>
          ) : null}
        </View>
      );
    }

    if (type === 'bank') {
      return (
        <View style={styles.methodCard}>
          <Text style={styles.methodTitle}>{String(activeMethod.label || 'Bank transfer')}</Text>
          {renderMinPaymentNotice()}
          {details.account_holder_name ? (
            <Text style={styles.methodLine}>Account name: {String(details.account_holder_name)}</Text>
          ) : null}
          {details.account_number ? (
            <Text style={styles.methodLine}>A/C: {String(details.account_number)}</Text>
          ) : null}
          {details.ifsc_code ? <Text style={styles.methodLine}>IFSC: {String(details.ifsc_code)}</Text> : null}
          {details.bank_name ? <Text style={styles.methodLine}>Bank: {String(details.bank_name)}</Text> : null}
          {details.branch ? <Text style={styles.methodLine}>Branch: {String(details.branch)}</Text> : null}
        </View>
      );
    }

    return (
      <View style={styles.methodCard}>
        <Text style={styles.methodTitle}>{String(activeMethod.label || activeMethod.type)}</Text>
      </View>
    );
  };

  return (
    <SafeAreaWrapper>
      <ScreenHeader title="INR Deposit" onBack={() => navigation.goBack()} />
      <ScrollView contentContainerStyle={styles.pad} {...iosManualKeyboardScrollProps()}>
        {loading ? (
          <View style={styles.loadingRow}>
            <ActivityIndicator size="small" color={Colors.goldLight} />
            <Text style={styles.hint}>Loading payment methods…</Text>
          </View>
        ) : null}
        {error ? <ErrorBanner message={error} /> : null}
        {configLoaded && !config ? (
          <Text style={styles.hint}>Deposit settings could not be loaded. Minimum rules still apply on the server — tap back and re-open this screen to retry.</Text>
        ) : null}

        <Text style={styles.label}>Amount (INR)</Text>
        <TextInput
          style={styles.input}
          value={amountInr}
          onChangeText={setAmountInr}
          keyboardType="decimal-pad"
          placeholder={minDepositInr > 0 ? String(minDepositInr) : '1000'}
          placeholderTextColor={Colors.textMuted}
        />
        {showBelowMinPill ? (
          <View style={styles.minPill}>
            <Text style={styles.minPillText}>
              Minimum accepted: {formatInrAmount(minDepositInr)} — please don't deposit less
            </Text>
          </View>
        ) : null}

        <Text style={styles.label}>Payment method</Text>
        {methods.length === 0 && !loading ? (
          <Text style={styles.hint}>No payment methods are active. Contact support or try again later.</Text>
        ) : (
          <View style={styles.chips}>
            {methods.map((m) => {
              const id = String(m.id);
              const active = id === String(activeMethod?.id);
              return (
                <TouchableOpacity
                  key={id}
                  style={[styles.chip, active && styles.chipActive]}
                  onPress={() => setMethodId(id)}
                >
                  <Text style={[styles.chipTxt, active && styles.chipTxtActive]}>
                    {methodChipLabel(m)}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        )}

        {renderMethodDetails()}

        {gatewayEnabled ? (
          <>
            <Button
              title={gatewayReady ? 'Pay via gateway' : 'Gateway not configured'}
              onPress={onGateway}
              loading={submitting}
              disabled={!gatewayReady || !settingsReady}
              style={{ marginTop: Spacing[3] }}
            />
            {!gatewayReady ? (
              <Text style={styles.hint}>Gateway checkout will be available once credentials are configured.</Text>
            ) : null}
          </>
        ) : null}

        {manualEnabled ? (
          <>
            <Text style={styles.section}>Manual proof</Text>
            <Text style={styles.label}>UTR / reference</Text>
            <TextInput style={styles.input} value={utr} onChangeText={setUtr} autoCapitalize="characters" placeholder="UTR number" placeholderTextColor={Colors.textMuted} />
            <Text style={styles.label}>Note (optional)</Text>
            <TextInput style={styles.input} value={note} onChangeText={setNote} placeholder="Any note for reviewer" placeholderTextColor={Colors.textMuted} />
            <Button title={screenshot ? 'Change screenshot' : 'Attach screenshot'} variant="secondary" onPress={pickScreenshot} />
            <Button title="Submit proof" onPress={onSubmitProof} loading={submitting} disabled={!settingsReady} style={{ marginTop: Spacing[3] }} />
          </>
        ) : null}

        {!loading && !manualEnabled && !gatewayEnabled ? (
          <Text style={styles.hint}>INR deposits are not available right now. Contact support.</Text>
        ) : null}
        <TouchableOpacity onPress={() => navigation.navigate('InrDepositsHistory')}>
          <Text style={styles.link}>View deposit history</Text>
        </TouchableOpacity>
      </ScrollView>

      <Modal
        visible={qrModalOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setQrModalOpen(false)}
      >
        <TouchableOpacity
          style={styles.qrModalBackdrop}
          activeOpacity={1}
          onPress={() => setQrModalOpen(false)}
        >
          <View style={styles.qrModalCard} onStartShouldSetResponder={() => true}>
            <Text style={styles.qrModalTitle}>Scan to pay</Text>
            {qrSrc ? (
              <Image source={{ uri: qrSrc }} style={styles.qrModalImage} resizeMode="contain" />
            ) : null}
            <TouchableOpacity style={styles.qrModalClose} onPress={() => setQrModalOpen(false)}>
              <Text style={styles.qrModalCloseText}>Close</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>
    </SafeAreaWrapper>
  );
}

const styles = StyleSheet.create({
  pad: { padding: Spacing[4], gap: Spacing[2], paddingBottom: Spacing[8] },
  label: { fontFamily: FontFamily.semiBold, fontSize: FontSize.sm, color: Colors.textSecondary, marginTop: Spacing[2] },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.surfaceBorder,
    backgroundColor: Colors.surfaceCard,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing[3],
    paddingVertical: 12,
    fontFamily: FontFamily.medium,
    fontSize: FontSize.md,
    color: Colors.textPrimary,
  },
  hint: { fontFamily: FontFamily.regular, fontSize: FontSize.sm, color: Colors.textMuted },
  minPill: {
    alignSelf: 'flex-start',
    marginTop: Spacing[1],
    paddingHorizontal: Spacing[3],
    paddingVertical: 6,
    borderRadius: Radius.full,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.gold + '40',
    backgroundColor: Colors.gold + '14',
  },
  minPillText: {
    fontFamily: FontFamily.medium,
    fontSize: FontSize.xs,
    color: Colors.goldLight,
    opacity: 0.92,
  },
  minNotice: {
    marginTop: Spacing[1],
    paddingHorizontal: Spacing[3],
    paddingVertical: Spacing[2],
    borderRadius: Radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.surfaceBorder,
    backgroundColor: Colors.surfaceHover,
  },
  minNoticeText: {
    fontFamily: FontFamily.regular,
    fontSize: FontSize.xs,
    color: Colors.textMuted,
    lineHeight: 18,
  },
  loadingRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing[2] },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  chip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: Radius.full, borderWidth: 1, borderColor: Colors.surfaceBorder },
  chipActive: { borderColor: Colors.gold, backgroundColor: Colors.gold + '18' },
  chipTxt: { fontFamily: FontFamily.medium, fontSize: FontSize.sm, color: Colors.textSecondary },
  chipTxtActive: { color: Colors.goldLight },
  methodCard: {
    marginTop: Spacing[3],
    padding: Spacing[4],
    borderRadius: Radius.lg,
    backgroundColor: Colors.surfaceCard,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.surfaceBorder,
    gap: Spacing[2],
  },
  methodTitle: { fontFamily: FontFamily.bold, fontSize: FontSize.md, color: Colors.textPrimary },
  methodHint: { fontFamily: FontFamily.regular, fontSize: FontSize.sm, color: Colors.textMuted, lineHeight: 20 },
  methodLine: { fontFamily: FontFamily.regular, fontSize: FontSize.sm, color: Colors.textSecondary, marginTop: 4 },
  qrTap: { alignItems: 'center', marginTop: Spacing[2], gap: Spacing[2] },
  qrImage: {
    width: 220,
    height: 220,
    backgroundColor: '#FFFFFF',
    borderRadius: Radius.md,
  },
  qrTapHint: { fontFamily: FontFamily.medium, fontSize: FontSize.xs, color: Colors.goldLight },
  qrMissing: {
    marginTop: Spacing[2],
    padding: Spacing[3],
    borderRadius: Radius.md,
    backgroundColor: Colors.surfaceHover,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.surfaceBorder,
  },
  qrMissingText: { fontFamily: FontFamily.regular, fontSize: FontSize.sm, color: Colors.textMuted, textAlign: 'center' },
  section: { fontFamily: FontFamily.bold, fontSize: FontSize.lg, color: Colors.goldLight, marginTop: Spacing[5] },
  link: { fontFamily: FontFamily.semiBold, fontSize: FontSize.sm, color: Colors.goldLight, textAlign: 'center', marginTop: Spacing[4] },
  qrModalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.85)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing[4],
  },
  qrModalCard: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: Colors.surfaceCard,
    borderRadius: Radius.xl,
    padding: Spacing[4],
    alignItems: 'center',
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
  },
  qrModalTitle: { fontFamily: FontFamily.bold, fontSize: FontSize.md, color: Colors.textPrimary, marginBottom: Spacing[3] },
  qrModalImage: { width: 300, height: 300, backgroundColor: '#FFFFFF', borderRadius: Radius.md },
  qrModalClose: {
    marginTop: Spacing[4],
    paddingHorizontal: Spacing[5],
    paddingVertical: Spacing[2],
    borderRadius: Radius.full,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
  },
  qrModalCloseText: { fontFamily: FontFamily.semiBold, fontSize: FontSize.sm, color: Colors.goldLight },
});
