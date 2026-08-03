import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import ProfileSubHeader from '../../components/profile/ProfileSubHeader';
import Input from '../../components/common/Input';
import Button from '../../components/common/Button';
import ErrorBanner from '../../components/common/ErrorBanner';
import { ProfileStackParamList } from '../../navigation/types';
import apiClient from '../../api/client';
import { parseApiError } from '../../api/errors';
import { profileStyles } from '../../components/profile/profileStyles';
import { Colors, FontFamily, FontSize, Spacing } from '../../theme';
import { iosManualKeyboardScrollProps } from '@/utils/iosKeyboardScroll';

type Nav = NativeStackNavigationProp<ProfileStackParamList, 'ListCoin'>;

export default function ListCoinScreen({ navigation }: { navigation: Nav }) {
  const [networks, setNetworks] = useState<string[]>([]);
  const [tokenName, setTokenName] = useState('');
  const [symbol, setSymbol] = useState('');
  const [contract, setContract] = useState('');
  const [network, setNetwork] = useState('bsc');
  const [contactEmail, setContactEmail] = useState('');
  const [website, setWebsite] = useState('');
  const [description, setDescription] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    apiClient.get<{ networks?: string[] }>('/api/listings/network-options')
      .then((res) => setNetworks(res.data?.networks ?? ['bsc']))
      .catch(() => setNetworks(['bsc']));
  }, []);

  const onSubmit = async () => {
    if (!tokenName.trim() || !symbol.trim() || !contract.trim() || !contactEmail.trim()) {
      Alert.alert('Missing fields', 'Fill token name, symbol, contract address and contact email.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const fd = new FormData();
      fd.append('token_name', tokenName.trim());
      fd.append('symbol', symbol.trim().toUpperCase());
      fd.append('contract_address', contract.trim());
      fd.append('network', network);
      fd.append('contact_email', contactEmail.trim());
      if (website.trim()) fd.append('website', website.trim());
      if (description.trim()) fd.append('description', description.trim());
      await apiClient.post('/api/listings/submit', fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      Alert.alert('Submitted', 'Your listing request was submitted for review.', [
        { text: 'OK', onPress: () => navigation.goBack() },
      ]);
    } catch (err) {
      setError(parseApiError(err).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={profileStyles.screen} edges={['top']}>
      <ProfileSubHeader title="List Your Coin" onBack={() => navigation.goBack()} />
      <ScrollView contentContainerStyle={profileStyles.content} {...iosManualKeyboardScrollProps()}>
        <Text style={styles.intro}>Apply to list a token on Ibo. Our team will review your submission.</Text>
        {error ? <ErrorBanner message={error} /> : null}
        <View style={profileStyles.card}>
          <Input label="Token name" value={tokenName} onChangeText={setTokenName} />
          <Input label="Symbol" value={symbol} onChangeText={setSymbol} autoCapitalize="characters" />
          <Input label="Contract address" value={contract} onChangeText={setContract} autoCapitalize="none" />
          <Input label="Network" value={network} onChangeText={setNetwork} placeholder={networks[0] || 'bsc'} />
          <Input label="Contact email" value={contactEmail} onChangeText={setContactEmail} keyboardType="email-address" autoCapitalize="none" />
          <Input label="Website (optional)" value={website} onChangeText={setWebsite} autoCapitalize="none" />
          <Input label="Description" value={description} onChangeText={setDescription} multiline numberOfLines={4} />
        </View>
        <Button title="Submit listing request" onPress={onSubmit} loading={loading} fullWidth />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  intro: {
    fontFamily: FontFamily.regular,
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    marginBottom: Spacing[4],
  },
});
