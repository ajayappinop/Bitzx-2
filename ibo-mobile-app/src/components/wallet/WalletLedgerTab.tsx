import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView, ActivityIndicator,
} from 'react-native';
import { walletApi } from '../../api/wallet.api';
import { parseApiError } from '../../api/errors';
import StatusBadge from '../common/StatusBadge';
import { WalletTransaction, TransactionStatus } from '../../types/wallet.types';
import { Colors, FontFamily, FontSize, Spacing, Radius } from '../../theme';
import { formatAmount, formatDate } from '../../utils/formatters';
import { walletStyles, WALLET_H_PAD } from './walletStyles';
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

/** Ledger filter chips: `All` + backend `_USER_LEDGER_TYPES` (no transfer_in / transfer_out). */
const TYPE_FILTERS: Array<'All' | (typeof LEDGER_API_TYPES)[number]> = ['All', ...LEDGER_API_TYPES];

/** Single-line labels for fixed-width–friendly pills */
const FILTER_CHIP_LABEL: Record<string, string> = {
  All: 'All',
  deposit: 'Deposit',
  withdraw: 'Withdraw',
  trade: 'Trade',
  fee: 'Fee',
  adjustment: 'Adjust',
  lock: 'Lock',
  unlock: 'Unlock',
  seed: 'Seed',
  opening_balance: 'Opening',
};

const TYPE_COLOR: Record<string, string> = {
  deposit: Colors.buyGreen,
  withdraw: Colors.sellRed,
  trade: Colors.info,
  fee: Colors.textMuted,
  adjustment: Colors.textMuted,
  lock: Colors.goldLight,
  unlock: Colors.buyGreen,
  seed: Colors.gold,
  opening_balance: Colors.textSecondary,
};

export default function WalletLedgerTab() {
  const PAGE_SIZE = 30;
  const [txns, setTxns] = useState<WalletTransaction[]>([]);
  const [typeFilter, setTypeFilter] = useState<string>('All');
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);

  const loadPage = useCallback(async (nextPage: number, replace = false) => {
    setError('');
    try {
      const showOnChain = typeFilter === 'All' || typeFilter === 'deposit';
      const res = await walletApi.getTransactionsPage({
        type: typeFilter !== 'All' ? typeFilter : undefined,
        limit: PAGE_SIZE,
        page: nextPage,
      });
      let combined = res.items;

      if (replace && showOnChain && nextPage === 1) {
        try {
          const depRes = await walletApi.getDepositEvents();
          const raw = depRes.data as { items?: DepositEventRow[] } | DepositEventRow[];
          const events = Array.isArray(raw) ? raw : (raw?.items ?? []);
          const creditedHashes = new Set(
            res.items
              .filter((t) => t.type === 'deposit' && t.tx_hash)
              .map((t) => String(t.tx_hash).toLowerCase()),
          );
          const onChain = depositEventsToTransactions(events, creditedHashes);
          combined = mergeLedgerAndDepositEvents(res.items, onChain);
        } catch {
          /* ledger-only fallback */
        }
      }

      setTxns((prev) => (replace ? combined : [...prev, ...res.items]));
      setPage(nextPage);
      setHasMore(res.items.length === PAGE_SIZE);
    } catch (err) {
      if (replace) setTxns([]);
      setError(parseApiError(err).message);
    } finally {
      setRefreshing(false);
      setLoadingMore(false);
    }
  }, [typeFilter]);

  useEffect(() => {
    loadPage(1, true);
  }, [loadPage]);

  const loadMore = () => {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    loadPage(page + 1, false);
  };

  return (
    <View style={styles.wrap}>
      <View style={styles.filterBar}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.filterScroll}
          contentContainerStyle={styles.filterContent}
        >
          {TYPE_FILTERS.map((t) => {
            const active = typeFilter === t;
            return (
              <TouchableOpacity
                key={t}
                style={[styles.pill, active && styles.pillActive]}
                onPress={() => setTypeFilter(t)}
                activeOpacity={0.75}
              >
                <Text style={[styles.pillLabel, active && styles.pillLabelActive]} numberOfLines={1}>
                  {FILTER_CHIP_LABEL[t] ?? t}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>

      {error ? <Text style={walletStyles.error}>{error}</Text> : null}

      <ScrollView
        style={styles.listScroll}
        showsVerticalScrollIndicator={false}
      >
        {txns.length === 0 ? (
          <View style={[walletStyles.card, walletStyles.empty]}>
            <Text style={walletStyles.emptyText}>No ledger entries</Text>
          </View>
        ) : (
          <View style={walletStyles.listCard}>
            {txns.map((item, i) => (
              <LedgerRow key={item.txn_id} item={item} isLast={i === txns.length - 1} />
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
      </ScrollView>
    </View>
  );
}

function LedgerRow({ item, isLast }: { item: WalletTransaction; isLast?: boolean }) {
  const t = String(item.type);
  const color = TYPE_COLOR[t] ?? Colors.textMuted;
  const positive = isLedgerAmountPositive(item);
  const balAfter = item.balance_after;

  return (
    <View style={[styles.row, isLast && walletStyles.listRowLast]}>
      <View style={[styles.dot, { backgroundColor: color }]} />
      <View style={styles.rowMain}>
        <View style={styles.rowTop}>
          <Text style={styles.rowType} numberOfLines={2}>
            {formatLedgerTypeLabel(item.type)}
          </Text>
          <Text style={[styles.rowAmt, { color: positive ? Colors.buyGreen : Colors.sellRed }]}>
            {positive ? '+' : '-'}{formatAmount(item.amount, 8)} {item.asset}
          </Text>
        </View>
        <View style={styles.rowBot}>
          <Text style={styles.rowDate}>{formatDate(item.created_at)}</Text>
          <StatusBadge status={(item.status as TransactionStatus) ?? 'completed'} small />
        </View>
        {balAfter ? (
          <Text style={styles.balAfter}>
            After: {formatAmount(balAfter.available ?? 0, 4)} avail
            {balAfter.locked != null ? ` · ${formatAmount(balAfter.locked, 4)} locked` : ''}
          </Text>
        ) : null}
        {item.note ? (
          <Text style={styles.rowNote} numberOfLines={2}>{item.note}</Text>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    paddingHorizontal: WALLET_H_PAD,
    paddingTop: Spacing[1],
    flex: 1,
  },
  listScroll: { flex: 1 },
  /** Railed strip so pills align with the rest of the wallet cards */
  filterBar: {
    backgroundColor: Colors.surfaceCard,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    borderRadius: Radius.lg,
    marginBottom: Spacing[3],
    overflow: 'hidden',
  },
  filterScroll: {
    flexGrow: 0,
  },
  filterContent: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: Spacing[2],
    paddingHorizontal: Spacing[2],
    gap: Spacing[2],
    minHeight: 44,
  },
  pill: {
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing[4],
    paddingVertical: 8,
    minHeight: 32,
    borderRadius: Radius.full,
    backgroundColor: Colors.surfaceHover,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
  },
  pillActive: {
    backgroundColor: Colors.goldAlpha15,
    borderColor: Colors.gold,
  },
  pillLabel: {
    fontFamily: FontFamily.medium,
    fontSize: FontSize.sm,
    color: Colors.textMuted,
    letterSpacing: 0.2,
  },
  pillLabelActive: {
    fontFamily: FontFamily.semiBold,
    color: Colors.goldLight,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: Spacing[4],
    paddingVertical: Spacing[3],
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.surfaceBorder,
  },
  dot: { width: 8, height: 8, borderRadius: 4, marginTop: 6, marginRight: Spacing[3] },
  rowMain: { flex: 1, minWidth: 0 },
  rowTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: Spacing[2],
  },
  rowType: {
    flex: 1,
    fontFamily: FontFamily.medium,
    fontSize: FontSize.sm,
    color: Colors.textPrimary,
  },
  rowAmt: {
    fontFamily: FontFamily.monoMedium,
    fontSize: FontSize.sm,
    textAlign: 'right',
    maxWidth: '50%',
  },
  rowBot: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 4,
  },
  rowDate: {
    fontFamily: FontFamily.regular,
    fontSize: FontSize.xs,
    color: Colors.textMuted,
  },
  balAfter: {
    fontFamily: FontFamily.mono,
    fontSize: 9,
    color: Colors.textMuted,
    marginTop: 4,
  },
  rowNote: {
    fontFamily: FontFamily.regular,
    fontSize: 10,
    color: Colors.textMuted,
    marginTop: 4,
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
