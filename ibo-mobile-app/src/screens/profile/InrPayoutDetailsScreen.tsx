import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import Input from '../../components/common/Input';
import Button from '../../components/common/Button';
import ErrorBanner from '../../components/common/ErrorBanner';
import ProfileSubHeader from '../../components/profile/ProfileSubHeader';
import { ProfileStackParamList } from '../../navigation/types';
import { fetchInrPayoutProfile, saveInrPayoutProfile } from '../../services/inrApi';
import { profileStyles } from '../../components/profile/profileStyles';
import { Colors, FontFamily, FontSize, Spacing } from '../../theme';
import { iosManualKeyboardScrollProps } from '@/utils/iosKeyboardScroll';

type Nav = NativeStackNavigationProp<ProfileStackParamList, 'InrPayoutDetails'>;

export default function InrPayoutDetailsScreen({ navigation }: { navigation: Nav }) {
  const [payoutType, setPayoutType] = useState<'upi' | 'bank'>('upi');
  const [upiId, setUpiId] = useState('');
  const [accountName, setAccountName] = useState('');
  const [accountNo, setAccountNo] = useState('');
  const [ifsc, setIfsc] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await fetchInrPayoutProfile() as Record<string, unknown>;
      const type = String(data.payout_type || 'upi').toLowerCase();
      setPayoutType(type === 'bank' ? 'bank' : 'upi');
      setUpiId(String(data.upi_id || ''));
      setAccountName(String(data.account_name || data.bank_account_name || ''));
      setAccountNo(String(data.bank_account_no || ''));
      setIfsc(String(data.ifsc || ''));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const onSave = async () => {
    setSaving(true);
    setError('');
    try {
      await saveInrPayoutProfile(
        payoutType === 'upi'
          ? { payout_type: 'upi', upi_id: upiId.trim() }
          : {
              payout_type: 'bank',
              account_name: accountName.trim(),
              bank_account_no: accountNo.trim(),
              ifsc: ifsc.trim().toUpperCase(),
            },
      );
      Alert.alert('Saved', 'Payout details updated.');
      navigation.goBack();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeAreaView style={profileStyles.screen} edges={['top']}>
      <ProfileSubHeader title="INR Payout Details" onBack={() => navigation.goBack()} />
      <ScrollView contentContainerStyle={profileStyles.content} {...iosManualKeyboardScrollProps()}>
        {loading ? <Text style={styles.hint}>Loading…</Text> : null}
        {error ? <ErrorBanner message={error} /> : null}
        <View style={profileStyles.card}>
          {payoutType === 'upi' ? (
            <Input label="UPI ID" value={upiId} onChangeText={setUpiId} autoCapitalize="none" />
          ) : (
            <>
              <Input label="Account holder name" value={accountName} onChangeText={setAccountName} />
              <Input label="Account number" value={accountNo} onChangeText={setAccountNo} keyboardType="number-pad" />
              <Input label="IFSC" value={ifsc} onChangeText={setIfsc} autoCapitalize="characters" />
            </>
          )}
        </View>
        <Button title="Save payout details" onPress={onSave} loading={saving} fullWidth />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  hint: { fontFamily: FontFamily.regular, fontSize: FontSize.sm, color: Colors.textMuted, marginBottom: Spacing[3] },
});
