import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { futuresApi } from '../../api/futures.api';
import { parseApiError } from '../../api/errors';
import { MainTabParamList } from '../../navigation/types';
import WalletTransferModal from './WalletTransferModal';
import Icon from '../common/AppIcon';
import { Colors, FontFamily, FontSize, Spacing, Radius } from '../../theme';
import { walletStyles, WALLET_H_PAD } from './walletStyles';

const LEDGER_LABELS: Record<string, string> = {
  transfer_in: 'Transfer in',
  transfer_out: 'Transfer out',
  realized_pnl: 'Realized PnL',
  funding_payment: 'Funding',
  funding_received: 'Funding',
  fee: 'Trading fee',
  liquidation: 'Liquidation',
  margin_lock: 'Margin locked',
  margin_unlock: 'Margin released',
  adjustment: 'Adjustment',
};

type FuturesWalletData = {
  wallet_balance?: number;
  balance?: number;
  available?: number;
  used_margin?: number;
  unrealized_pnl?: number;
  margin_balance?: number;
  free_margin?: number;
  position_margin?: number;
  locked?: number;
};

type Txn = {
  id?: string;
  type?: string;
  direction?: string;
  amount?: number | string;
  balance_after?: number | { available?: number; locked?: number };
  created_at?: string;
};

function n(v: unknown): number {
  const x = typeof v === 'string' ? parseFloat(v) : Number(v);
  return isNaN(x) ? 0 : x;
}

function signedAmount(t: Txn): number {
  const amt = Math.abs(n(t.amount));
  const dir = t.direction;
  if (dir === 'credit' || dir === 'unlock') return amt;
  if (dir === 'debit' || dir === 'lock') return -amt;
  return amt;
}

function StatCard({
  label, value, sub, tone,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: 'green' | 'red' | 'gold' | 'default';
}) {
  const color = tone === 'green' ? Colors.buyGreen
    : tone === 'red' ? Colors.sellRed
    : tone === 'gold' ? Colors.goldLight
    : Colors.textPrimary;
  return (
    <View style={walletStyles.statBox}>
      <Text style={walletStyles.statLabel}>{label}</Text>
      <Text style={[walletStyles.statValue, { color }]} numberOfLines={1}>{value}</Text>
      {sub ? <Text style={walletStyles.statSub}>{sub}</Text> : null}
    </View>
  );
}

export default function FuturesWalletTab() {
  const navigation = useNavigation<NativeStackNavigationProp<MainTabParamList>>();
  const [wallet, setWallet] = useState<FuturesWalletData | null>(null);
  const [txns, setTxns] = useState<Txn[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [transferOpen, setTransferOpen] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      const [wRes, tRes] = await Promise.all([
        futuresApi.getWallet(),
        futuresApi.getWalletTxns({ limit: 50 }),
      ]);
      setWallet((wRes as FuturesWalletData) ?? null);
      const raw = tRes.data as any;
      const list = Array.isArray(raw?.txns) ? raw.txns : Array.isArray(raw) ? raw : [];
      setTxns(list);
    } catch (err) {
      setError(parseApiError(err).message);
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const onRefresh = () => {
    setRefreshing(true);
    load();
  };

  const handleSyncLocked = async () => {
    setSyncing(true);
    setSyncMsg('');
    try {
      const res = await futuresApi.syncLocked();
      const data = res.data;
      if (data.ok) {
        const adj = data.adjusted ?? 0;
        setSyncMsg(
          Math.abs(adj) < 0.000001
            ? 'Margin is already correct — no change needed.'
            : `Adjusted by ${adj >= 0 ? '+' : ''}${adj.toFixed(6)} USDT. Refreshing…`,
        );
        load();
      } else {
        setSyncMsg('Sync failed — contact support.');
      }
    } catch (err) {
      setSyncMsg(parseApiError(err).message);
    } finally {
      setSyncing(false);
      setTimeout(() => setSyncMsg(''), 6000);
    }
  };

  const balance = n(wallet?.wallet_balance ?? wallet?.balance);
  const available = n(wallet?.available);
  const usedMargin = n(wallet?.used_margin ?? wallet?.locked);
  const unrealized = n(wallet?.unrealized_pnl);
  const marginBalance = n(wallet?.margin_balance) || balance + unrealized;
  const freeMargin = n(wallet?.free_margin) || available;
  const positionMargin = n(wallet?.position_margin) || usedMargin;
  const equity = marginBalance || balance + unrealized;
  const marginRatio = equity > 0 && positionMargin > 0 ? (positionMargin / equity) * 100 : 0;

  return (
    <>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.wrap}
      >
        <View style={styles.hero}>
          <Text style={styles.heroLabel}>USDT-M FUTURES WALLET</Text>
          <Text style={styles.heroBal}>
            {balance.toFixed(2)} <Text style={styles.heroUnit}>USDT</Text>
          </Text>
          <Text style={styles.heroSub}>
            Margin balance ≈ {marginBalance.toFixed(2)} USDT
            {unrealized !== 0 && (
              <Text style={{ color: unrealized >= 0 ? Colors.buyGreen : Colors.sellRed }}>
                {' '}({unrealized >= 0 ? '+' : ''}{unrealized.toFixed(2)} unrealized)
              </Text>
            )}
          </Text>
          <View style={styles.heroActions}>
            <TouchableOpacity style={styles.transferBtn} onPress={() => setTransferOpen(true)} activeOpacity={0.85}>
              <Icon name="swap-horizontal" size={14} color={Colors.surfaceDark} />
              <Text style={styles.transferTxt}>Transfer</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.tradeBtn}
              onPress={() => navigation.navigate('Futures', {
                screen: 'DerivativesPair',
                params: { symbol: 'BTCUSDT', market: 'futures' },
              })}
              activeOpacity={0.85}
            >
              <Icon name="chart-line" size={14} color={Colors.goldLight} />
              <Text style={styles.tradeTxt}>Open trading</Text>
            </TouchableOpacity>
          </View>
          <TouchableOpacity
            style={styles.syncBtn}
            onPress={handleSyncLocked}
            disabled={syncing}
            activeOpacity={0.8}
          >
            <Icon name={syncing ? 'loading' : 'refresh'} size={13} color={Colors.textMuted} />
            <Text style={styles.syncTxt}>{syncing ? 'Syncing…' : 'Sync locked margin'}</Text>
          </TouchableOpacity>
          {syncMsg ? <Text style={styles.syncMsg}>{syncMsg}</Text> : null}
        </View>

        {error ? <Text style={walletStyles.error}>{error}</Text> : null}

        <View style={walletStyles.statGrid}>
          <StatCard label="Available" value={available.toFixed(2)} sub="USDT" tone="gold" />
          <StatCard label="Used margin" value={usedMargin.toFixed(2)} sub="USDT" />
          <StatCard
            label="Unrealized PnL"
            value={`${unrealized >= 0 ? '+' : ''}${unrealized.toFixed(2)}`}
            sub="USDT"
            tone={unrealized >= 0 ? 'green' : 'red'}
          />
          <StatCard label="Free margin" value={freeMargin.toFixed(2)} sub="USDT" />
        </View>

        <View style={[walletStyles.card, styles.ratioCard]}>
          <View style={styles.ratioHead}>
            <Text style={styles.ratioLabel}>Margin ratio</Text>
            <Text style={styles.ratioVal}>{marginRatio.toFixed(1)}%</Text>
          </View>
          <View style={styles.ratioTrack}>
            <View
              style={[
                styles.ratioFill,
                {
                  width: `${Math.min(100, marginRatio)}%`,
                  backgroundColor: marginRatio > 80 ? Colors.sellRed : marginRatio > 50 ? Colors.gold : Colors.buyGreen,
                },
              ]}
            />
          </View>
        </View>

        <Text style={walletStyles.sectionTitle}>Recent margin ledger</Text>

        {txns.length === 0 ? (
          <View style={[walletStyles.card, walletStyles.empty]}>
            <Text style={walletStyles.emptyText}>No futures wallet activity yet</Text>
          </View>
        ) : (
          <View style={walletStyles.listCard}>
            {txns.map((t, i) => {
              const signed = signedAmount(t);
              const label = LEDGER_LABELS[t.type ?? ''] ?? (t.type ?? '—').replace(/_/g, ' ');
              return (
                <View
                  key={t.id ?? i}
                  style={[walletStyles.listRow, i === txns.length - 1 && walletStyles.listRowLast]}
                >
                  <View style={styles.txnLeft}>
                    <Text style={styles.txnType}>{label}</Text>
                    <Text style={styles.txnTime}>
                      {t.created_at ? new Date(t.created_at).toLocaleString() : '—'}
                    </Text>
                  </View>
                  <Text style={[styles.txnAmt, { color: signed >= 0 ? Colors.buyGreen : Colors.sellRed }]}>
                    {signed >= 0 ? '+' : ''}{signed.toFixed(4)} USDT
                  </Text>
                </View>
              );
            })}
          </View>
        )}
        <View style={{ height: Spacing[10] }} />
      </ScrollView>

      <WalletTransferModal
        visible={transferOpen}
        onClose={() => setTransferOpen(false)}
        onSuccess={load}
      />
    </>
  );
}

const styles = StyleSheet.create({
  wrap: {
    paddingHorizontal: WALLET_H_PAD,
    paddingTop: Spacing[1],
  },
  center: { paddingVertical: Spacing[10], alignItems: 'center' },
  hero: {
    backgroundColor: Colors.goldAlpha10,
    borderWidth: 1,
    borderColor: Colors.goldAlpha30,
    borderRadius: Radius.xl,
    padding: Spacing[4],
    marginBottom: Spacing[4],
  },
  heroLabel: {
    fontFamily: FontFamily.bold,
    fontSize: 9,
    color: Colors.goldLight,
    letterSpacing: 1,
  },
  heroBal: {
    fontFamily: FontFamily.extraBold,
    fontSize: FontSize['2xl'],
    color: Colors.textPrimary,
    marginTop: 4,
  },
  heroUnit: { fontSize: FontSize.sm, color: Colors.textMuted },
  heroSub: {
    fontFamily: FontFamily.regular,
    fontSize: FontSize.xs,
    color: Colors.textMuted,
    marginTop: 4,
    lineHeight: 18,
  },
  heroActions: { flexDirection: 'row', gap: Spacing[2], marginTop: Spacing[4] },
  transferBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: Colors.gold,
    paddingVertical: Spacing[2],
    borderRadius: Radius.lg,
  },
  transferTxt: {
    fontFamily: FontFamily.bold,
    fontSize: FontSize.xs,
    color: Colors.surfaceDark,
  },
  tradeBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    backgroundColor: Colors.surfaceCard,
    paddingVertical: Spacing[2],
    borderRadius: Radius.lg,
  },
  tradeTxt: {
    fontFamily: FontFamily.semiBold,
    fontSize: FontSize.xs,
    color: Colors.goldLight,
  },
  syncBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    marginTop: Spacing[2],
    paddingVertical: Spacing[2],
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    borderRadius: Radius.lg,
  },
  syncTxt: {
    fontFamily: FontFamily.medium,
    fontSize: 10,
    color: Colors.textMuted,
  },
  syncMsg: {
    fontFamily: FontFamily.regular,
    fontSize: 10,
    color: Colors.textSecondary,
    textAlign: 'center',
    marginTop: Spacing[1],
    lineHeight: 14,
  },
  ratioCard: { padding: Spacing[4], marginBottom: Spacing[4] },
  ratioHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Spacing[2],
  },
  ratioLabel: {
    fontFamily: FontFamily.medium,
    fontSize: FontSize.xs,
    color: Colors.textMuted,
  },
  ratioVal: {
    fontFamily: FontFamily.monoMedium,
    fontSize: FontSize.sm,
    color: Colors.textPrimary,
  },
  ratioTrack: {
    height: 6,
    backgroundColor: Colors.surfaceBorder,
    borderRadius: 3,
    overflow: 'hidden',
  },
  ratioFill: { height: 6, borderRadius: 3 },
  txnLeft: { flex: 1, marginRight: Spacing[3] },
  txnType: {
    fontFamily: FontFamily.medium,
    fontSize: FontSize.sm,
    color: Colors.textPrimary,
    textTransform: 'capitalize',
  },
  txnTime: {
    fontFamily: FontFamily.regular,
    fontSize: 9,
    color: Colors.textMuted,
    marginTop: 2,
  },
  txnAmt: {
    fontFamily: FontFamily.monoMedium,
    fontSize: FontSize.sm,
    textAlign: 'right',
    maxWidth: '42%',
  },
});
