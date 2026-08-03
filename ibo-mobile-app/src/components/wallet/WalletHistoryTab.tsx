import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, RefreshControl, ScrollView,
} from 'react-native';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { walletApi } from '../../api/wallet.api';
import { fetchInrDeposits, fetchInrWithdrawals } from '../../services/inrApi';
import StatusBadge from '../common/StatusBadge';
import { Colors, FontFamily, FontSize, Spacing, Radius } from '../../theme';
import { formatAmount, formatDate } from '../../utils/formatters';
import { walletStyles, WALLET_H_PAD } from './walletStyles';
import { WalletStackParamList } from '../../navigation/types';
import { effectiveInrWithdrawalStatus } from '../../utils/inrWithdrawal';
import { useDepositMonitor } from '../../hooks/useDepositMonitor';
import {
  getWalletHistoryCache,
  setWalletHistoryCache,
  type HistoryDepositRow,
  type HistoryWithdrawRow,
} from '../../utils/walletHistoryCache';

type HistorySubTab = 'deposits' | 'withdrawals';

const INITIAL_LIMIT = 50;

function depositTitle(item: HistoryDepositRow): string {
  if (item.currency === 'INR') return 'INR Deposit';
  if (item.label) return item.label;
  if (item.source === 'signup_bonus') return 'Signup bonus';
  return `${item.asset ?? '—'} Deposit`;
}

function depositStatusForBadge(raw?: string): string {
  const s = String(raw || 'pending').toLowerCase();
  if (s === 'pending_kyc' || s === 'confirming' || s === 'crediting') return 'pending';
  if (s === 'credited') return 'completed';
  return s || 'pending';
}

function extractItems(data: unknown): any[] {
  if (Array.isArray(data)) return data;
  if (data && typeof data === 'object' && Array.isArray((data as any).items)) {
    return (data as any).items;
  }
  return [];
}

function byDateDesc<T extends { created_at?: string }>(a: T, b: T) {
  return new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime();
}

function mapInrDeposits(raw: any[]): HistoryDepositRow[] {
  return raw.map((d) => ({
    id: d.id || d.ref_id,
    asset: 'INR',
    amount: d.amount_inr ?? d.amount,
    tx_hash: d.utr || d.gateway_payment_id,
    network: d.payment_method_id ? `Method: ${d.payment_method_id}` : 'Bank/UPI',
    status: d.status,
    created_at: d.created_at,
    currency: 'INR',
    ref: d.ref_id || d.id,
    rejection_reason: d.rejection_reason,
  }));
}

function mapInrWithdrawals(raw: any[]): HistoryWithdrawRow[] {
  return raw.map((w) => ({
    id: w.id || w.ref_id,
    withdrawal_id: w.id,
    asset: 'INR',
    amount: w.amount_inr ?? w.amount,
    amount_inr: w.amount_inr ?? w.amount,
    fee: w.fee_inr ?? w.fee,
    address: w.payout_label || w.bank_account_no || w.upi_id || 'Bank/UPI payout',
    tx_hash: w.payout_reference || w.payout_ref || w.utr,
    network: w.payout_label || 'Bank/UPI',
    payout_label: w.payout_label,
    payout_reference: w.payout_reference,
    status: w.status,
    created_at: w.created_at,
    currency: 'INR',
    ref: w.ref_id || w.id,
    rejection_reason: w.rejection_reason,
  }));
}

function mergeSignupBonusFromLedger(
  cryptoDeposits: HistoryDepositRow[],
  ledgerItems: Array<Record<string, unknown>>,
) {
  const depositHashes = new Set(
    cryptoDeposits
      .map((d) => String(d.tx_hash ?? '').toLowerCase())
      .filter(Boolean),
  );
  for (const txn of ledgerItems) {
    const meta = txn.meta && typeof txn.meta === 'object' ? txn.meta as Record<string, unknown> : {};
    const source = String(txn.source ?? meta.source ?? '').toLowerCase();
    if (source !== 'signup_bonus') continue;
    const hash = String(txn.tx_hash ?? meta.tx_hash ?? '').toLowerCase();
    if (hash && depositHashes.has(hash)) continue;
    cryptoDeposits.push({
      id: txn.txn_id as string | undefined,
      asset: txn.asset as string | undefined,
      amount: txn.amount as number | string | undefined,
      tx_hash: (txn.tx_hash ?? meta.tx_hash) as string | undefined,
      network: (txn.network ?? meta.network) as string | undefined,
      status: 'credited',
      source: 'signup_bonus',
      label: (txn.label as string | undefined) || 'Signup bonus',
      status_note: 'Credited to trading wallet',
      created_at: txn.created_at as string | undefined,
      currency: 'CRYPTO',
    });
    if (hash) depositHashes.add(hash);
  }
}

export default function WalletHistoryTab() {
  const PAGE_SIZE = 25;
  const navigation = useNavigation<NativeStackNavigationProp<WalletStackParamList>>();

  const [subTab, setSubTab] = useState<HistorySubTab>('deposits');
  const [deposits, setDeposits] = useState<HistoryDepositRow[]>(() => getWalletHistoryCache()?.deposits ?? []);
  const [withdrawals, setWithdrawals] = useState<HistoryWithdrawRow[]>(() => getWalletHistoryCache()?.withdrawals ?? []);
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [initialLoading, setInitialLoading] = useState(() => !getWalletHistoryCache());
  const [enriching, setEnriching] = useState(false);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [loadingMore, setLoadingMore] = useState(false);

  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadGenRef = useRef(0);

  const applyLists = useCallback((allDeposits: HistoryDepositRow[], allWithdrawals: HistoryWithdrawRow[]) => {
    setDeposits(allDeposits);
    setWithdrawals(allWithdrawals);
    setWalletHistoryCache(allDeposits, allWithdrawals);
  }, []);

  const load = useCallback(async (isRefresh = false) => {
    const gen = ++loadGenRef.current;
    if (!isRefresh && deposits.length === 0 && withdrawals.length === 0) {
      setInitialLoading(true);
    }
    if (!isRefresh) setError('');

    try {
      // Phase 1 — crypto history only (fast first paint)
      const [dRes, wRes] = await Promise.allSettled([
        walletApi.getDepositEvents({ limit: INITIAL_LIMIT }),
        walletApi.getWithdrawals({ limit: INITIAL_LIMIT }),
      ]);

      if (gen !== loadGenRef.current) return;

      const cryptoDeposits: HistoryDepositRow[] =
        dRes.status === 'fulfilled'
          ? extractItems(dRes.value.data).map((d: any) => ({ ...d, currency: 'CRYPTO' as const }))
          : [];
      const cryptoWithdrawals: HistoryWithdrawRow[] =
        wRes.status === 'fulfilled'
          ? extractItems(wRes.value.data).map((w: any) => ({ ...w, currency: 'CRYPTO' as const }))
          : [];

      applyLists(
        [...cryptoDeposits].sort(byDateDesc),
        [...cryptoWithdrawals].sort(byDateDesc),
      );
      setInitialLoading(false);

      const phase1Failed = [dRes, wRes].filter((r) => r.status === 'rejected').length;
      if (phase1Failed === 2) {
        setError('Unable to load history right now.');
      } else if (phase1Failed > 0) {
        setError('Some history failed to load. Pull to refresh.');
      }

      // Phase 2 — INR + signup bonus ledger (background enrich)
      setEnriching(true);
      const [inrDepRes, inrWdrRes, ledgerRes] = await Promise.allSettled([
        fetchInrDeposits({ limit: INITIAL_LIMIT }),
        fetchInrWithdrawals({ limit: INITIAL_LIMIT }),
        walletApi.getTransactionsPage({ type: 'deposit', limit: 50, page: 1 }),
      ]);

      if (gen !== loadGenRef.current) return;

      const enrichedDeposits = [...cryptoDeposits];
      if (ledgerRes.status === 'fulfilled') {
        mergeSignupBonusFromLedger(enrichedDeposits, ledgerRes.value.items as Array<Record<string, unknown>>);
      }

      const inrDeposits = inrDepRes.status === 'fulfilled' ? mapInrDeposits(inrDepRes.value?.items ?? []) : [];
      const inrWithdrawals = inrWdrRes.status === 'fulfilled' ? mapInrWithdrawals(inrWdrRes.value?.items ?? []) : [];

      applyLists(
        [...inrDeposits, ...enrichedDeposits].sort(byDateDesc),
        [...inrWithdrawals, ...cryptoWithdrawals].sort(byDateDesc),
      );
      setEnriching(false);

      const allFailed = phase1Failed === 2
        && inrDepRes.status === 'rejected'
        && inrWdrRes.status === 'rejected';
      if (!allFailed && phase1Failed < 2) setError('');

      if (enrichedDeposits.filter((d) => d.currency === 'CRYPTO').length === 0) {
        if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
        retryTimerRef.current = setTimeout(() => {
          void load(true);
        }, 8_000);
      } else if (retryTimerRef.current) {
        clearTimeout(retryTimerRef.current);
      }
    } catch {
      if (gen === loadGenRef.current) {
        setError('Could not load history. Pull to refresh.');
        setInitialLoading(false);
        setEnriching(false);
      }
    } finally {
      if (gen === loadGenRef.current) setRefreshing(false);
    }
  }, [applyLists, deposits.length, withdrawals.length]);

  useDepositMonitor({
    autoStart: true,
    onDeposit: () => {
      void load(true);
    },
  });

  useFocusEffect(
    useCallback(() => {
      const hasData = deposits.length > 0 || withdrawals.length > 0;
      void load(hasData);
      return () => {
        if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
      };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [load]),
  );

  useEffect(() => { setVisibleCount(PAGE_SIZE); }, [subTab, deposits.length, withdrawals.length]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    void load(true);
  }, [load]);

  const data = subTab === 'deposits' ? deposits : withdrawals;
  const visibleData = data.slice(0, visibleCount);
  const hasMore = visibleData.length < data.length;

  const loadMore = () => {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    setTimeout(() => {
      setVisibleCount((c) => Math.min(c + PAGE_SIZE, data.length));
      setLoadingMore(false);
    }, 80);
  };

  return (
    <ScrollView
      style={styles.wrap}
      showsVerticalScrollIndicator={false}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={onRefresh}
          tintColor={Colors.goldLight}
          colors={[Colors.goldLight]}
        />
      }
    >
      <View style={walletStyles.segmented}>
        {(['deposits', 'withdrawals'] as HistorySubTab[]).map((t) => {
          const active = subTab === t;
          return (
            <TouchableOpacity
              key={t}
              style={[walletStyles.segmentBtn, active && walletStyles.segmentBtnActive]}
              onPress={() => setSubTab(t)}
              activeOpacity={0.82}
            >
              <Text style={[walletStyles.segmentTxt, active && walletStyles.segmentTxtActive]}>
                {t.charAt(0).toUpperCase() + t.slice(1)}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {enriching && !initialLoading ? (
        <View style={styles.enrichRow}>
          <ActivityIndicator size="small" color={Colors.goldLight} />
          <Text style={styles.enrichText}>Updating INR history…</Text>
        </View>
      ) : null}

      {error ? <Text style={walletStyles.error}>{error}</Text> : null}

      {initialLoading && data.length === 0 ? (
        <View style={[walletStyles.card, styles.loadingCard]}>
          <ActivityIndicator size="large" color={Colors.goldLight} />
          <Text style={styles.loadingText}>Loading history…</Text>
        </View>
      ) : data.length === 0 ? (
        <View style={[walletStyles.card, walletStyles.empty]}>
          <Text style={walletStyles.emptyText}>No {subTab} yet</Text>
        </View>
      ) : (
        <View style={walletStyles.listCard}>
          {subTab === 'deposits'
            ? visibleData.map((item, i) => (
              <HistoryDepositRowView
                key={item.id ?? i}
                item={item}
                isLast={i === visibleData.length - 1 && !hasMore}
                onPress={() => {
                  if (item.currency === 'INR') {
                    navigation.navigate('InrHistoryDetail', { kind: 'deposit', item });
                  }
                }}
              />
            ))
            : visibleData.map((item, i) => (
              <HistoryWithdrawRowView
                key={item.id ?? i}
                item={item}
                isLast={i === visibleData.length - 1 && !hasMore}
                onPress={() => {
                  if (item.currency === 'INR') {
                    navigation.navigate('InrHistoryDetail', { kind: 'withdrawal', item });
                  }
                }}
              />
            ))}
          {hasMore ? (
            <TouchableOpacity style={styles.loadMoreBtn} onPress={loadMore} disabled={loadingMore}>
              {loadingMore ? (
                <ActivityIndicator size="small" color={Colors.goldLight} />
              ) : (
                <Text style={styles.loadMoreText}>Load more</Text>
              )}
            </TouchableOpacity>
          ) : null}
        </View>
      )}
      <View style={{ height: Spacing[4] }} />
    </ScrollView>
  );
}

function HistoryDepositRowView({
  item,
  isLast,
  onPress,
}: {
  item: HistoryDepositRow;
  isLast?: boolean;
  onPress?: () => void;
}) {
  const isSignupBonus = item.source === 'signup_bonus' || item.label === 'Signup bonus';
  const title = depositTitle(item);

  const row = (
    <View style={[walletStyles.listRow, isLast && walletStyles.listRowLast]}>
      <View style={styles.rowLeft}>
        <View style={styles.titleRow}>
          {isSignupBonus && (
            <View style={styles.bonusBadge}>
              <Text style={styles.bonusBadgeTxt}>🎁</Text>
            </View>
          )}
          <Text style={[styles.rowTitle, isSignupBonus && styles.rowTitleBonus]} numberOfLines={1}>
            {title}
          </Text>
        </View>
        <Text style={styles.rowSub}>{formatDate(item.created_at ?? '')}</Text>
        {item.status_note ? (
          <Text style={styles.rowMeta}>{item.status_note}</Text>
        ) : null}
        {item.network && !item.status_note ? (
          <Text style={styles.rowMeta}>{item.network}</Text>
        ) : null}
        {item.currency === 'INR' && item.ref ? (
          <Text style={styles.hash} numberOfLines={1}>Ref: {item.ref}</Text>
        ) : null}
        {item.tx_hash ? (
          <Text style={styles.hash} numberOfLines={1}>Tx: {item.tx_hash}</Text>
        ) : null}
      </View>
      <View style={styles.rowRight}>
        <Text style={[styles.amt, { color: Colors.buyGreen }]}>
          +{formatAmount(item.amount ?? 0, item.currency === 'INR' ? 2 : 6)}{' '}
          {item.currency === 'INR' ? 'INR' : item.asset}
        </Text>
        <View style={styles.statusBadgeAlign}>
          <StatusBadge status={depositStatusForBadge(item.status)} small />
        </View>
      </View>
    </View>
  );

  if (item.currency === 'INR') {
    return (
      <TouchableOpacity activeOpacity={0.85} onPress={onPress}>
        {row}
      </TouchableOpacity>
    );
  }
  return row;
}

function HistoryWithdrawRowView({
  item,
  isLast,
  onPress,
}: {
  item: HistoryWithdrawRow;
  isLast?: boolean;
  onPress?: () => void;
}) {
  const isInr = item.currency === 'INR';
  const row = (
    <View style={[walletStyles.listRow, isLast && walletStyles.listRowLast]}>
      <View style={styles.rowLeft}>
        <Text style={styles.rowTitle}>{isInr ? 'INR Withdrawal' : `${item.asset} Withdrawal`}</Text>
        <Text style={styles.rowSub}>{formatDate(item.created_at ?? '')}</Text>
        {isInr && item.ref ? (
          <Text style={styles.hash} numberOfLines={1}>Ref: {item.ref}</Text>
        ) : null}
        {item.address ? (
          <Text style={styles.hash} numberOfLines={1}>To: {item.address}</Text>
        ) : null}
      </View>
      <View style={styles.rowRight}>
        <Text style={[styles.amt, { color: Colors.sellRed }]}>
          -{formatAmount(item.amount ?? 0, isInr ? 2 : 6)} {isInr ? 'INR' : item.asset}
        </Text>
        <View style={styles.statusBadgeAlign}>
          <StatusBadge
            status={isInr ? (effectiveInrWithdrawalStatus(item) as any) : ((item.status as any) ?? 'pending')}
            small
          />
        </View>
      </View>
    </View>
  );

  if (isInr) {
    return (
      <TouchableOpacity activeOpacity={0.85} onPress={onPress}>
        {row}
      </TouchableOpacity>
    );
  }
  return row;
}

const styles = StyleSheet.create({
  wrap: {
    paddingHorizontal: WALLET_H_PAD,
    paddingTop: Spacing[1],
  },
  enrichRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing[2],
    marginBottom: Spacing[2],
    paddingHorizontal: Spacing[1],
  },
  enrichText: {
    fontFamily: FontFamily.regular,
    fontSize: FontSize.xs,
    color: Colors.textMuted,
  },
  loadingCard: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: Spacing[8],
    gap: Spacing[3],
  },
  loadingText: {
    fontFamily: FontFamily.regular,
    fontSize: FontSize.sm,
    color: Colors.textMuted,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  bonusBadge: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: 'rgba(197,227,91,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  bonusBadgeTxt: {
    fontSize: 10,
    lineHeight: 14,
  },
  rowLeft: { flex: 1, marginRight: Spacing[3] },
  rowTitle: {
    fontFamily: FontFamily.semiBold,
    fontSize: FontSize.sm,
    color: Colors.textPrimary,
    flexShrink: 1,
  },
  rowTitleBonus: {
    color: Colors.goldLight,
  },
  rowSub: {
    fontFamily: FontFamily.regular,
    fontSize: FontSize.xs,
    color: Colors.textMuted,
    marginTop: 2,
  },
  rowMeta: {
    fontFamily: FontFamily.regular,
    fontSize: 9,
    color: Colors.textMuted,
    marginTop: 2,
  },
  hash: {
    fontFamily: FontFamily.mono,
    fontSize: 9,
    color: Colors.textSecondary,
    marginTop: 4,
  },
  rowRight: {
    minWidth: 88,
    maxWidth: '42%',
    alignItems: 'flex-end',
    justifyContent: 'flex-start',
    gap: 6,
  },
  statusBadgeAlign: {
    alignSelf: 'flex-end',
  },
  amt: {
    fontFamily: FontFamily.monoMedium,
    fontSize: FontSize.sm,
    width: '100%',
    textAlign: 'right',
    fontVariant: ['tabular-nums'],
  },
  loadMoreBtn: {
    marginTop: Spacing[2],
    alignSelf: 'center',
    borderWidth: 1,
    borderColor: Colors.goldAlpha30,
    backgroundColor: Colors.goldAlpha10,
    borderRadius: Radius.full,
    paddingHorizontal: Spacing[4],
    paddingVertical: Spacing[2],
  },
  loadMoreText: {
    fontFamily: FontFamily.semiBold,
    fontSize: FontSize.xs,
    color: Colors.goldLight,
  },
});
