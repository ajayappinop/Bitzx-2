import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, FlatList, StyleSheet, TouchableOpacity, RefreshControl, Alert } from 'react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import SafeAreaWrapper from '../../components/common/SafeAreaWrapper';
import ScreenHeader from '../../components/common/ScreenHeader';
import StatusBadge from '../../components/common/StatusBadge';
import ErrorBanner from '../../components/common/ErrorBanner';
import { WalletStackParamList } from '../../navigation/types';
import { fetchInrWithdrawals, cancelInrWithdrawal } from '../../services/inrApi';
import { effectiveInrWithdrawalStatus, formatInrAmount } from '../../utils/inrWithdrawal';
import { formatDate } from '../../utils/formatters';
import { Colors, FontFamily, FontSize, Radius, Spacing } from '../../theme';

type Nav = NativeStackNavigationProp<WalletStackParamList, 'InrWithdrawalsHistory'>;

export default function InrWithdrawalsHistoryScreen({ navigation }: { navigation: Nav }) {
  const [items, setItems] = useState<Record<string, unknown>[]>([]);
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setError('');
    try {
      const data = await fetchInrWithdrawals({ limit: 100 });
      setItems((data.items ?? []) as Record<string, unknown>[]);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const onCancel = (id: string) => {
    Alert.alert('Cancel withdrawal', 'Cancel this INR withdrawal request?', [
      { text: 'No', style: 'cancel' },
      {
        text: 'Yes, cancel',
        style: 'destructive',
        onPress: async () => {
          try {
            await cancelInrWithdrawal(id);
            await load();
          } catch (e) {
            Alert.alert('Cancel failed', (e as Error).message);
          }
        },
      },
    ]);
  };

  return (
    <SafeAreaWrapper>
      <ScreenHeader title="INR Withdrawals" onBack={() => navigation.goBack()} />
      {error ? <ErrorBanner message={error} /> : null}
      <FlatList
        data={items}
        keyExtractor={(it, i) => String(it.id ?? i)}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} tintColor={Colors.goldLight} />}
        contentContainerStyle={styles.list}
        ListEmptyComponent={<Text style={styles.empty}>No INR withdrawals yet</Text>}
        renderItem={({ item }) => {
          const id = String(item.id || '');
          const status = effectiveInrWithdrawalStatus(item as { status?: string; rejection_reason?: string });
          const canCancel = String(item.status).toLowerCase() === 'pending';
          return (
            <TouchableOpacity
              style={styles.row}
              onPress={() => navigation.navigate('InrHistoryDetail', { kind: 'withdrawal', item })}
            >
              <View style={styles.left}>
                <Text style={styles.amt}>{formatInrAmount(item.amount_inr as number)}</Text>
                <Text style={styles.sub}>{formatDate(String(item.created_at || ''))}</Text>
                {item.payout_reference ? <Text style={styles.meta}>UTR: {String(item.payout_reference)}</Text> : null}
              </View>
              <View style={styles.right}>
                <StatusBadge status={status as never} small />
                {canCancel ? (
                  <TouchableOpacity onPress={() => onCancel(id)}>
                    <Text style={styles.cancel}>Cancel</Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            </TouchableOpacity>
          );
        }}
      />
    </SafeAreaWrapper>
  );
}

const styles = StyleSheet.create({
  list: { padding: Spacing[4] },
  empty: { textAlign: 'center', color: Colors.textMuted, fontFamily: FontFamily.regular, marginTop: 40 },
  row: {
    flexDirection: 'row',
    padding: Spacing[4],
    borderRadius: Radius.lg,
    backgroundColor: Colors.surfaceCard,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.surfaceBorder,
    marginBottom: Spacing[2],
  },
  left: { flex: 1, minWidth: 0 },
  right: { alignItems: 'flex-end', gap: 6 },
  amt: { fontFamily: FontFamily.bold, fontSize: FontSize.md, color: Colors.textPrimary },
  sub: { fontFamily: FontFamily.regular, fontSize: FontSize.xs, color: Colors.textMuted, marginTop: 4 },
  meta: { fontFamily: FontFamily.regular, fontSize: FontSize.xs, color: Colors.textSecondary, marginTop: 2 },
  cancel: { fontFamily: FontFamily.semiBold, fontSize: FontSize.xs, color: Colors.danger },
});
