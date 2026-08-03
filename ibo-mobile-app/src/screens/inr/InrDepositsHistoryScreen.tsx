import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, FlatList, StyleSheet, TouchableOpacity, RefreshControl } from 'react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import SafeAreaWrapper from '../../components/common/SafeAreaWrapper';
import ScreenHeader from '../../components/common/ScreenHeader';
import StatusBadge from '../../components/common/StatusBadge';
import ErrorBanner from '../../components/common/ErrorBanner';
import { WalletStackParamList } from '../../navigation/types';
import { fetchInrDeposits } from '../../services/inrApi';
import { formatInrAmount, inrStatusLabel } from '../../utils/inrWithdrawal';
import { formatDate } from '../../utils/formatters';
import { Colors, FontFamily, FontSize, Radius, Spacing } from '../../theme';

type Nav = NativeStackNavigationProp<WalletStackParamList, 'InrDepositsHistory'>;

export default function InrDepositsHistoryScreen({ navigation }: { navigation: Nav }) {
  const [items, setItems] = useState<Record<string, unknown>[]>([]);
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setError('');
    try {
      const data = await fetchInrDeposits({ limit: 100 });
      setItems((data.items ?? []) as Record<string, unknown>[]);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  return (
    <SafeAreaWrapper>
      <ScreenHeader title="INR Deposits" onBack={() => navigation.goBack()} />
      {error ? <ErrorBanner message={error} /> : null}
      <FlatList
        data={items}
        keyExtractor={(it, i) => String(it.id ?? i)}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.goldLight} />}
        contentContainerStyle={styles.list}
        ListEmptyComponent={<Text style={styles.empty}>No INR deposits yet</Text>}
        renderItem={({ item }) => (
          <TouchableOpacity
            style={styles.row}
            onPress={() => navigation.navigate('InrHistoryDetail', { kind: 'deposit', item })}
          >
            <View style={styles.left}>
              <Text style={styles.amt}>{formatInrAmount(item.amount_inr as number)}</Text>
              <Text style={styles.sub}>{formatDate(String(item.created_at || ''))}</Text>
              {item.utr_number ? <Text style={styles.meta}>UTR: {String(item.utr_number)}</Text> : null}
            </View>
            <StatusBadge status={String(item.status || 'pending') as never} small />
          </TouchableOpacity>
        )}
      />
    </SafeAreaWrapper>
  );
}

const styles = StyleSheet.create({
  list: { padding: Spacing[4], gap: Spacing[2] },
  empty: { textAlign: 'center', color: Colors.textMuted, fontFamily: FontFamily.regular, marginTop: 40 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: Spacing[4],
    borderRadius: Radius.lg,
    backgroundColor: Colors.surfaceCard,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.surfaceBorder,
    marginBottom: Spacing[2],
  },
  left: { flex: 1, minWidth: 0, marginRight: Spacing[3] },
  amt: { fontFamily: FontFamily.bold, fontSize: FontSize.md, color: Colors.textPrimary },
  sub: { fontFamily: FontFamily.regular, fontSize: FontSize.xs, color: Colors.textMuted, marginTop: 4 },
  meta: { fontFamily: FontFamily.regular, fontSize: FontSize.xs, color: Colors.textSecondary, marginTop: 2 },
});
