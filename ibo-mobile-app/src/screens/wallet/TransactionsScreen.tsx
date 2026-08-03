import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, FlatList, StyleSheet,
  TouchableOpacity, ActivityIndicator,
} from 'react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RouteProp } from '@react-navigation/native';
import { WalletStackParamList } from '../../navigation/types';
import { walletApi } from '../../api/wallet.api';
import { parseApiError } from '../../api/errors';
import { WalletTransaction, TransactionStatus } from '../../types/wallet.types';
import SafeAreaWrapper from '../../components/common/SafeAreaWrapper';
import StatusBadge from '../../components/common/StatusBadge';
import ErrorBanner from '../../components/common/ErrorBanner';
import { Colors, FontFamily, FontSize, Spacing, Radius } from '../../theme';
import { formatAmount, formatDate } from '../../utils/formatters';
import {
  LEDGER_API_TYPES,
  formatLedgerTypeLabel,
  isLedgerAmountPositive,
} from '../../utils/walletLedger';
import {
  depositEventsToTransactions,
  mergeLedgerAndDepositEvents,
  type DepositEventRow,
} from '../../utils/depositEvents';
import { useDepositMonitor } from '../../hooks/useDepositMonitor';
import { useDepositDetectedModal } from '../../hooks/useDepositDetectedModal';
import DepositSuccessModal from '../../components/wallet/DepositSuccessModal';

type Props = {
  navigation: NativeStackNavigationProp<WalletStackParamList, 'Transactions'>;
  route: RouteProp<WalletStackParamList, 'Transactions'>;
};

const TYPE_FILTERS: Array<'All' | (typeof LEDGER_API_TYPES)[number]> = ['All', ...LEDGER_API_TYPES];

const FILTER_LABEL: Record<string, string> = {
  All: 'All',
  deposit: 'Deposit',
  withdraw: 'Withdraw',
  trade: 'Trade',
  fee: 'Fee',
  adjustment: 'Adj.',
  lock: 'Lock',
  unlock: 'Unlock',
  seed: 'Seed',
  opening_balance: 'Open',
};

const TYPE_ICON: Record<string, string> = {
  deposit: '↓',
  withdraw: '↑',
  trade: '⇄',
  fee: '◈',
  adjustment: '◎',
  lock: '⊕',
  unlock: '⊖',
  seed: '★',
  opening_balance: '○',
};

const TYPE_COLOR: Record<string, string> = {
  deposit: Colors.success,
  withdraw: Colors.danger,
  trade: Colors.info,
  fee: Colors.textMuted,
  adjustment: Colors.textMuted,
  lock: Colors.gold,
  unlock: Colors.success,
  seed: Colors.gold,
  opening_balance: Colors.textMuted,
};

function TxRow({ item }: { item: WalletTransaction }) {
  const t = String(item.type);
  const icon = TYPE_ICON[t] ?? '•';
  const color = TYPE_COLOR[t] ?? Colors.textMuted;
  const isPositive = isLedgerAmountPositive(item);

  return (
    <View style={styles.txRow}>
      <View style={[styles.txIcon, { backgroundColor: color + '20', borderColor: color + '40' }]}>
        <Text style={[styles.txIconText, { color }]}>{icon}</Text>
      </View>

      <View style={styles.txMain}>
        <View style={styles.txTopRow}>
          <Text style={styles.txType} numberOfLines={2}>{formatLedgerTypeLabel(item.type)}</Text>
          <Text style={[styles.txAmount, { color: isPositive ? Colors.buyGreen : Colors.sellRed }]}>
            {isPositive ? '+' : '-'}{formatAmount(item.amount, 8)} {item.asset}
          </Text>
        </View>
        <View style={styles.txBottomRow}>
          <Text style={styles.txDate}>{formatDate(item.created_at)}</Text>
          <StatusBadge status={item.status as TransactionStatus} />
        </View>
        {item.note ? (
          <Text style={styles.txHash} numberOfLines={2}>{item.note}</Text>
        ) : null}
        {item.tx_hash && (
          <Text style={styles.txHash} numberOfLines={1}>
            Tx: {item.tx_hash.slice(0, 20)}…
          </Text>
        )}
      </View>
    </View>
  );
}

const PAGE_SIZE = 20;

export default function TransactionsScreen({ navigation, route }: Props) {
  const { asset: filterAsset } = route.params ?? {};
  const [txns, setTxns] = useState<WalletTransaction[]>([]);
  const [typeFilter, setTypeFilter] = useState<string>('All');
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [banner, setBanner] = useState('');

  // On-demand deposit monitoring — starts (or resumes) the same shared
  // ~7-minute backend session used by the Deposit screen. No visible
  // countdown; only a static "stay on this page" reminder is shown.
  const showDepositTab = typeFilter === 'All' || typeFilter === 'deposit';
  const successModal = useDepositDetectedModal();
  const depositMonitor = useDepositMonitor({
    autoStart: true,
    onDeposit: (count) => {
      if (showDepositTab) loadPage(1, true).catch(() => {});
      successModal.handleDetected(count);
    },
  });

  const loadPage = useCallback(async (p: number, replace = false) => {
    try {
      const showOnChain = typeFilter === 'All' || typeFilter === 'deposit';
      const res = await walletApi.getTransactionsPage({
        asset: filterAsset,
        type: typeFilter !== 'All' ? typeFilter : undefined,
        page: p,
        limit: PAGE_SIZE,
      });
      const { items: list, total, skip } = res;
      let combined = list;

      if (replace && showOnChain && p === 1) {
        try {
          const depRes = await walletApi.getDepositEvents();
          const raw = depRes.data as { items?: DepositEventRow[] } | DepositEventRow[];
          const events = Array.isArray(raw) ? raw : (raw?.items ?? []);
          const creditedHashes = new Set(
            list
              .filter((t) => t.type === 'deposit' && t.tx_hash)
              .map((t) => String(t.tx_hash).toLowerCase()),
          );
          const filtered = filterAsset
            ? events.filter((e) => (e.asset || '').toUpperCase() === filterAsset.toUpperCase())
            : events;
          const onChain = depositEventsToTransactions(filtered, creditedHashes);
          combined = mergeLedgerAndDepositEvents(list, onChain);
        } catch {
          /* ledger-only fallback */
        }
      }

      if (replace) {
        setTxns(combined);
      } else {
        setTxns(prev => [...prev, ...list]);
      }
      const loadedThrough = skip + list.length;
      setHasMore(loadedThrough < total && list.length === PAGE_SIZE);
      setPage(p);
    } catch (err) {
      setBanner(parseApiError(err).message);
    } finally {
      setRefreshing(false);
      setLoadingMore(false);
    }
  }, [filterAsset, typeFilter]);

  useEffect(() => {
    setTxns([]);
    loadPage(1, true);
  }, [typeFilter, filterAsset, loadPage]);

  const handleRefresh = () => {
    setRefreshing(true);
    loadPage(1, true);
  };

  const handleLoadMore = () => {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    loadPage(page + 1, false);
  };

  return (
    <SafeAreaWrapper>
      <View style={styles.topBar}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Text style={styles.backText}>‹</Text>
        </TouchableOpacity>
        <Text style={styles.pageTitle}>
          {filterAsset ? `${filterAsset} Transactions` : 'Transaction History'}
        </Text>
      </View>

      <ErrorBanner message={banner} type="error" />

      {/* Deposit monitor status — static note only, shown on deposit/all tabs */}
      {showDepositTab && (
        depositMonitor.status === 'starting' ? (
          <View style={styles.monitorBanner}>
            <ActivityIndicator size="small" color={Colors.goldLight} />
            <Text style={styles.monitorText}>Starting deposit check…</Text>
          </View>
        ) : depositMonitor.isActive ? (
          <View style={[styles.monitorBanner, styles.monitorBannerActive]}>
            <View style={styles.monitorDot} />
            <View style={styles.monitorTextCol}>
              <Text style={[styles.monitorText, { color: '#86efac' }]}>Checking for your deposit on-chain</Text>
              <Text style={styles.monitorSubtext}>
                Don&apos;t leave this screen until your transaction is detected.
              </Text>
            </View>
          </View>
        ) : null
      )}

      <DepositSuccessModal
        visible={successModal.visible}
        onClose={successModal.close}
        deposit={successModal.deposit}
        onViewHistory={() => setTypeFilter('deposit')}
      />

      {/* Filter tabs */}
      <View style={styles.filterBar}>
        {TYPE_FILTERS.map(f => (
          <TouchableOpacity
            key={f}
            style={[styles.filterChip, typeFilter === f && styles.filterChipActive]}
            onPress={() => setTypeFilter(f)}
          >
            <Text style={[styles.filterChipText, typeFilter === f && styles.filterChipTextActive]}>
              {FILTER_LABEL[f] ?? f}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <FlatList
          data={txns}
          keyExtractor={item => item.txn_id}
          renderItem={({ item }) => <TxRow item={item} />}
          contentContainerStyle={styles.listContent}
          onEndReached={handleLoadMore}
          onEndReachedThreshold={0.3}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text style={styles.emptyIcon}>📂</Text>
              <Text style={styles.emptyText}>No transactions found</Text>
            </View>
          }
          ListFooterComponent={loadingMore ? <View style={styles.loadMore} /> : null}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
          showsVerticalScrollIndicator={false}
        />
    </SafeAreaWrapper>
  );
}

const styles = StyleSheet.create({
  topBar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: Spacing[4], paddingVertical: Spacing[3] },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', marginRight: Spacing[2] },
  backText: { fontFamily: FontFamily.semiBold, fontSize: 28, color: Colors.textSecondary, lineHeight: 32 },
  pageTitle: { fontFamily: FontFamily.bold, fontSize: FontSize.xl, color: Colors.textPrimary, flex: 1 },
  filterBar: {
    flexDirection: 'row', paddingHorizontal: Spacing[4], paddingBottom: Spacing[3],
    gap: Spacing[2],
  },
  filterChip: {
    paddingHorizontal: Spacing[3], paddingVertical: Spacing[2],
    borderRadius: Radius.full, borderWidth: 1, borderColor: Colors.surfaceBorder,
    backgroundColor: Colors.surfaceHover,
  },
  filterChipActive: { borderColor: Colors.gold, backgroundColor: Colors.goldAlpha15 },
  filterChipText: { fontFamily: FontFamily.medium, fontSize: FontSize.xs, color: Colors.textMuted },
  filterChipTextActive: { color: Colors.goldLight },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  listContent: { paddingHorizontal: Spacing[4], paddingBottom: Spacing[8] },
  txRow: { flexDirection: 'row', alignItems: 'flex-start', paddingVertical: Spacing[3] },
  txIcon: {
    width: 40, height: 40, borderRadius: Radius.md,
    borderWidth: 1, alignItems: 'center', justifyContent: 'center',
    marginRight: Spacing[3],
  },
  txIconText: { fontFamily: FontFamily.bold, fontSize: FontSize.lg },
  txMain: { flex: 1 },
  txTopRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  txType: { fontFamily: FontFamily.medium, fontSize: FontSize.sm, color: Colors.textPrimary },
  txAmount: { fontFamily: FontFamily.semiBold, fontSize: FontSize.sm },
  txBottomRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  txDate: { fontFamily: FontFamily.regular, fontSize: FontSize.xs, color: Colors.textMuted },
  txHash: { fontFamily: FontFamily.mono, fontSize: FontSize.xs, color: Colors.textDisabled, marginTop: 2 },
  separator: { height: 1, backgroundColor: Colors.surfaceBorder },
  empty: { paddingVertical: Spacing[16], alignItems: 'center', gap: Spacing[3] },
  emptyIcon: { fontSize: 48 },
  emptyText: { fontFamily: FontFamily.regular, fontSize: FontSize.base, color: Colors.textMuted },
  loadMore: { paddingVertical: Spacing[4], alignItems: 'center' },

  // Deposit monitor banner
  monitorBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing[2],
    marginHorizontal: Spacing[4],
    marginBottom: Spacing[2],
    paddingHorizontal: Spacing[3],
    paddingVertical: Spacing[2],
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    backgroundColor: Colors.surfaceCard,
  },
  monitorBannerActive: {
    borderColor: 'rgba(34,197,94,0.25)',
    backgroundColor: 'rgba(34,197,94,0.08)',
  },
  monitorDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: '#22c55e',
    marginTop: 4,
  },
  monitorTextCol: { flex: 1, gap: 2 },
  monitorSubtext: {
    fontFamily: FontFamily.regular,
    fontSize: FontSize.xs,
    color: Colors.textMuted,
    lineHeight: 16,
    marginTop: 1,
  },
  monitorText: {
    fontFamily: FontFamily.medium,
    fontSize: FontSize.xs,
    color: Colors.textSecondary,
    flex: 1,
  },
  monitorTime: {
    fontFamily: FontFamily.regular,
    fontSize: FontSize.xs,
    color: Colors.textMuted,
  },
});
