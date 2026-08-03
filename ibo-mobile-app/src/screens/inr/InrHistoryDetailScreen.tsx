import React from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import SafeAreaWrapper from '../../components/common/SafeAreaWrapper';
import ScreenHeader from '../../components/common/ScreenHeader';
import StatusBadge from '../../components/common/StatusBadge';
import { WalletStackParamList } from '../../navigation/types';
import { effectiveInrWithdrawalStatus, formatInrAmount, inrStatusLabel } from '../../utils/inrWithdrawal';
import { formatDate } from '../../utils/formatters';
import { Colors, FontFamily, FontSize, Radius, Spacing } from '../../theme';

type Props = {
  navigation: NativeStackNavigationProp<WalletStackParamList, 'InrHistoryDetail'>;
  route: RouteProp<WalletStackParamList, 'InrHistoryDetail'>;
};

function Row({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null;
  return (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.value}>{value}</Text>
    </View>
  );
}

export default function InrHistoryDetailScreen({ navigation, route }: Props) {
  const { kind, item } = route.params;
  const isDeposit = kind === 'deposit';
  const status = isDeposit
    ? String(item?.status || 'pending')
    : effectiveInrWithdrawalStatus(item);

  return (
    <SafeAreaWrapper>
      <ScreenHeader title={isDeposit ? 'INR Deposit' : 'INR Withdrawal'} onBack={() => navigation.goBack()} />
      <ScrollView contentContainerStyle={styles.pad}>
        <View style={styles.hero}>
          <Text style={styles.amt}>{formatInrAmount(item?.amount_inr ?? item?.amount)}</Text>
          <StatusBadge status={status as never} />
        </View>
        <View style={styles.card}>
          <Row label="Reference" value={String(item?.ref_id || item?.id || item?.ref || '')} />
          <Row label="Created" value={formatDate(String(item?.created_at || ''))} />
          <Row label="Status" value={inrStatusLabel(status, { rejectionReason: String(item?.rejection_reason || '') })} />
          {isDeposit ? (
            <>
              <Row label="UTR" value={String(item?.utr_number || item?.tx_hash || '')} />
              <Row label="Method" value={String(item?.payment_method_label || item?.network || '')} />
              <Row label="IBO credited" value={item?.amount_ibo != null ? String(item.amount_ibo) : null} />
            </>
          ) : (
            <>
              <Row label="Payout UTR" value={String(item?.payout_reference || item?.tx_hash || '')} />
              <Row label="Destination" value={String(item?.address || item?.payout_label || '')} />
              <Row label="Reason" value={String(item?.rejection_reason || '')} />
            </>
          )}
        </View>
      </ScrollView>
    </SafeAreaWrapper>
  );
}

const styles = StyleSheet.create({
  pad: { padding: Spacing[4], paddingBottom: Spacing[8] },
  hero: {
    alignItems: 'center',
    gap: Spacing[3],
    marginBottom: Spacing[5],
  },
  amt: {
    fontFamily: FontFamily.bold,
    fontSize: 28,
    color: Colors.goldLight,
  },
  card: {
    padding: Spacing[4],
    borderRadius: Radius.lg,
    backgroundColor: Colors.surfaceCard,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.surfaceBorder,
    gap: Spacing[3],
  },
  row: { gap: 4 },
  label: {
    fontFamily: FontFamily.bold,
    fontSize: 10,
    color: Colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  value: {
    fontFamily: FontFamily.medium,
    fontSize: FontSize.sm,
    color: Colors.textPrimary,
  },
});
