import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TextInput, TouchableOpacity, Alert,
} from 'react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import SafeAreaWrapper from '../../components/common/SafeAreaWrapper';
import ScreenHeader from '../../components/common/ScreenHeader';
import Button from '../../components/common/Button';
import ErrorBanner from '../../components/common/ErrorBanner';
import { WalletStackParamList } from '../../navigation/types';
import {
  fetchInrWithdrawalEligibility,
  fetchInrPayoutProfile,
  submitInrWithdrawal,
} from '../../services/inrApi';
import { formatInrAmount } from '../../utils/inrWithdrawal';
import { Colors, FontFamily, FontSize, Radius, Spacing } from '../../theme';
import { iosManualKeyboardScrollProps } from '@/utils/iosKeyboardScroll';

type Nav = NativeStackNavigationProp<WalletStackParamList, 'InrWithdraw'>;

export default function InrWithdrawScreen({ navigation }: { navigation: Nav }) {
  const [eligibility, setEligibility] = useState<Record<string, unknown> | null>(null);
  const [payout, setPayout] = useState<Record<string, unknown> | null>(null);
  const [amountInr, setAmountInr] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [e, p] = await Promise.all([
        fetchInrWithdrawalEligibility(),
        fetchInrPayoutProfile().catch(() => null),
      ]);
      setEligibility(e as Record<string, unknown>);
      setPayout(p as Record<string, unknown> | null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const onSubmit = async () => {
    const amt = Number(amountInr);
    if (!amt || amt <= 0) {
      Alert.alert('Invalid amount', 'Enter a valid INR amount.');
      return;
    }
    setSubmitting(true);
    try {
      await submitInrWithdrawal({ amount_inr: amt });
      Alert.alert('Submitted', 'INR withdrawal request submitted.', [
        { text: 'OK', onPress: () => navigation.navigate('InrWithdrawalsHistory') },
      ]);
    } catch (err) {
      Alert.alert('Failed', (err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SafeAreaWrapper>
      <ScreenHeader title="INR Withdraw" onBack={() => navigation.goBack()} />
      <ScrollView contentContainerStyle={styles.pad} {...iosManualKeyboardScrollProps()}>
        {loading ? <Text style={styles.hint}>Loading…</Text> : null}
        {error ? <ErrorBanner message={error} /> : null}
        {eligibility?.available_inr != null ? (
          <Text style={styles.avail}>Available: {formatInrAmount(eligibility.available_inr as number)}</Text>
        ) : null}

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Payout destination</Text>
          {payout?.upi_id ? <Text style={styles.line}>UPI: {String(payout.upi_id)}</Text> : null}
          {payout?.bank_account_no ? (
            <Text style={styles.line}>Bank: {String(payout.bank_account_no)} · {String(payout.ifsc || '')}</Text>
          ) : null}
          {!payout?.upi_id && !payout?.bank_account_no ? (
            <Text style={styles.hint}>No payout details saved.</Text>
          ) : null}
          <TouchableOpacity onPress={() => navigation.getParent()?.navigate('Profile', { screen: 'InrPayoutDetails' })}>
            <Text style={styles.link}>Edit payout details</Text>
          </TouchableOpacity>
        </View>

        <Text style={styles.label}>Amount (INR)</Text>
        <TextInput
          style={styles.input}
          value={amountInr}
          onChangeText={setAmountInr}
          keyboardType="decimal-pad"
          placeholder="1000"
          placeholderTextColor={Colors.textMuted}
        />
        <Button title="Submit withdrawal" onPress={onSubmit} loading={submitting} />
        <TouchableOpacity onPress={() => navigation.navigate('InrWithdrawalsHistory')}>
          <Text style={styles.link}>View withdrawal history</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaWrapper>
  );
}

const styles = StyleSheet.create({
  pad: { padding: Spacing[4], gap: Spacing[2], paddingBottom: Spacing[8] },
  hint: { fontFamily: FontFamily.regular, fontSize: FontSize.sm, color: Colors.textMuted },
  avail: { fontFamily: FontFamily.bold, fontSize: FontSize.lg, color: Colors.goldLight, marginBottom: Spacing[3] },
  card: { padding: Spacing[4], borderRadius: Radius.lg, backgroundColor: Colors.surfaceCard, borderWidth: StyleSheet.hairlineWidth, borderColor: Colors.surfaceBorder },
  cardTitle: { fontFamily: FontFamily.semiBold, fontSize: FontSize.md, color: Colors.textPrimary },
  line: { fontFamily: FontFamily.regular, fontSize: FontSize.sm, color: Colors.textSecondary, marginTop: 6 },
  label: { fontFamily: FontFamily.semiBold, fontSize: FontSize.sm, color: Colors.textSecondary, marginTop: Spacing[4] },
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
  link: { fontFamily: FontFamily.semiBold, fontSize: FontSize.sm, color: Colors.goldLight, textAlign: 'center', marginTop: Spacing[4] },
});
