import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, FlatList, StyleSheet, TouchableOpacity, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import ProfileSubHeader from '../../components/profile/ProfileSubHeader';
import ErrorBanner from '../../components/common/ErrorBanner';
import StatusBadge from '../../components/common/StatusBadge';
import { ProfileStackParamList } from '../../navigation/types';
import apiClient from '../../api/client';
import { parseApiError } from '../../api/errors';
import { profileStyles } from '../../components/profile/profileStyles';
import { Colors, FontFamily, FontSize, Radius, Spacing } from '../../theme';
import { formatPrice } from '../../utils/formatters';

type Nav = NativeStackNavigationProp<ProfileStackParamList, 'P2PMarketplace'>;

type P2PAd = {
  id: string;
  side?: string;
  asset?: string;
  fiat?: string;
  price?: number | string;
  available?: number | string;
  payment_methods?: string[];
  merchant_name?: string;
  status?: string;
};

export default function P2PMarketplaceScreen({ navigation }: { navigation: Nav }) {
  const [ads, setAds] = useState<P2PAd[]>([]);
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setError('');
    try {
      const { data } = await apiClient.get<{ items?: P2PAd[] }>('/api/p2p/ads', {
        params: { limit: 50 },
      });
      setAds(data?.items ?? []);
    } catch (err) {
      setError(parseApiError(err).message);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  return (
    <SafeAreaView style={profileStyles.screen} edges={['top']}>
      <ProfileSubHeader title="P2P Marketplace" onBack={() => navigation.goBack()} />
      {error ? <ErrorBanner message={error} /> : null}
      <FlatList
        data={ads}
        keyExtractor={(it) => it.id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} tintColor={Colors.goldLight} />}
        contentContainerStyle={styles.list}
        ListEmptyComponent={<Text style={styles.empty}>No P2P ads available</Text>}
        renderItem={({ item }) => (
          <TouchableOpacity style={styles.card} activeOpacity={0.9}>
            <View style={styles.top}>
              <Text style={styles.merchant}>{item.merchant_name || 'Merchant'}</Text>
              <StatusBadge status={(item.side === 'sell' ? 'sell' : 'buy') as never} small />
            </View>
            <Text style={styles.pair}>{item.asset || 'USDT'} / {item.fiat || 'INR'}</Text>
            <Text style={styles.price}>{formatPrice(Number(item.price ?? 0))}</Text>
            <Text style={styles.sub}>Available: {String(item.available ?? '—')}</Text>
            {item.payment_methods?.length ? (
              <Text style={styles.sub}>Pay: {item.payment_methods.join(', ')}</Text>
            ) : null}
          </TouchableOpacity>
        )}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  list: { padding: Spacing[4] },
  empty: { textAlign: 'center', color: Colors.textMuted, fontFamily: FontFamily.regular, marginTop: 40 },
  card: {
    padding: Spacing[4],
    borderRadius: Radius.lg,
    backgroundColor: Colors.surfaceCard,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.surfaceBorder,
    marginBottom: Spacing[3],
  },
  top: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  merchant: { fontFamily: FontFamily.semiBold, fontSize: FontSize.md, color: Colors.textPrimary },
  pair: { fontFamily: FontFamily.medium, fontSize: FontSize.sm, color: Colors.textSecondary, marginTop: 4 },
  price: { fontFamily: FontFamily.bold, fontSize: FontSize.lg, color: Colors.goldLight, marginTop: 8 },
  sub: { fontFamily: FontFamily.regular, fontSize: FontSize.xs, color: Colors.textMuted, marginTop: 4 },
});
