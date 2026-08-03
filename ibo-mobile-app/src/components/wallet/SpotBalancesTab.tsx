import React, { useMemo, useCallback, useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { useSelector, useDispatch } from 'react-redux';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { AppDispatch, RootState } from '../../store';
import { fetchWalletThunk, selectSessionWallet } from '../../store/wallet.slice';
import { MainTabParamList } from '../../navigation/types';
import CoinIcon from '../common/CoinIcon';
import { Colors, FontFamily, FontSize, Spacing, Radius } from '../../theme';
import { formatUSD, formatPrice } from '../../utils/formatters';
import { parseMarketNum } from '../../utils/markets';
import {
  computePortfolioUsd,
  sortedWalletAssets,
  spotPriceForAsset,
} from '../../utils/dashboard';
import { WalletAsset } from '../../types/wallet.types';
import { walletStyles, WALLET_H_PAD } from './walletStyles';
import { walletApi } from '../../api/wallet.api';
import { formatAmount } from '../../utils/formatters';

function depositStatusLabel(status: string, source?: string): string {
  const s = status.toLowerCase();
  if (source === 'signup_bonus' && s === 'pending_kyc') {
    return 'signup bonus · complete KYC to receive';
  }
  if (s === 'pending_kyc') return 'awaiting KYC approval';
  if (s === 'below_min') return 'below minimum amount';
  if (s === 'confirming') return 'confirming on chain';
  if (s === 'crediting') return 'crediting';
  return s.replace(/_/g, ' ');
}
function StatBox({
  label, value, color,
}: {
  label: string;
  value: string;
  color?: string;
}) {
  return (
    <View style={walletStyles.statBox}>
      <Text style={walletStyles.statLabel}>{label}</Text>
      <Text style={[walletStyles.statValue, color ? { color } : null]} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

function MetricCell({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <View style={styles.metricCell}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={[styles.metricValue, color ? { color } : null]} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

function AssetCard({
  asset, markets, onBuy, onSell, onSwap, isLast,
}: {
  asset: WalletAsset;
  markets: Record<string, any>;
  onBuy: () => void;
  onSell: () => void;
  onSwap?: () => void;
  isLast?: boolean;
}) {
  const available = parseMarketNum(asset.available_balance);
  const locked = parseMarketNum(asset.locked_balance);
  const total = available + locked;
  const px = spotPriceForAsset(asset.asset, markets);
  const usdVal = parseMarketNum(asset.usd_value) || total * px;
  const isStable = asset.asset === 'USDT' || asset.asset === 'USDC';
  const dec = total < 1 ? 6 : 4;

  return (
    <View style={[styles.assetCard, isLast && styles.assetCardLast]}>
      <View style={styles.assetHead}>
        <CoinIcon symbol={asset.asset} size={40} />
        <View style={styles.assetMeta}>
          <Text style={styles.assetSym}>{asset.asset}</Text>
          <Text style={styles.assetUsd}>{formatUSD(usdVal)}</Text>
        </View>
      </View>

      <View style={styles.metricGrid}>
        <MetricCell label="Available" value={formatPrice(available, dec)} color={Colors.buyGreen} />
        <MetricCell label="Locked" value={formatPrice(locked, dec)} color={Colors.goldLight} />
        <MetricCell label="Total" value={formatPrice(total, dec)} />
        <MetricCell label="Price (USD)" value={px > 0 ? formatUSD(px) : '—'} />
      </View>

      {!isStable && (
        <View style={styles.actionRow}>
          {asset.asset === 'IBO' && onSwap ? (
            <TouchableOpacity
              style={[walletStyles.actionBtn, styles.swapBtn]}
              onPress={onSwap}
            >
              <Text style={styles.swapTxt}>Swap</Text>
            </TouchableOpacity>
          ) : null}
          <TouchableOpacity style={[walletStyles.actionBtn, walletStyles.buyBtn]} onPress={onBuy}>
            <Text style={walletStyles.buyTxt}>Buy</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[walletStyles.actionBtn, walletStyles.sellBtn, { marginLeft: Spacing[2] }]} onPress={onSell}>
            <Text style={walletStyles.sellTxt}>Sell</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

export default function SpotBalancesTab({ onOpenSwap }: { onOpenSwap?: () => void }) {
  const navigation = useNavigation<NativeStackNavigationProp<MainTabParamList>>();
  const dispatch = useDispatch<AppDispatch>();
  const { assets, totalUsd } = useSelector(selectSessionWallet);
  const { markets } = useSelector((s: RootState) => s.market);
  const [pendingDeposits, setPendingDeposits] = useState<
    Array<{ asset: string; amount: number; status: string; source?: string }>
  >([]);

  const loadPending = useCallback(async () => {
    try {
      const { data } = await walletApi.getDepositEvents();
      const rows = Array.isArray(data) ? data : (data as any)?.items ?? [];
      const open = rows
        .filter((d: any) => {
          const st = String(d?.status ?? '').toLowerCase();
          return st && !['credited', 'rejected'].includes(st);
        })
        .map((d: any) => ({
          asset: String(d.asset ?? '').toUpperCase(),
          amount: Number(d.amount ?? 0),
          status: String(d.status ?? 'pending'),
          source: d.source ? String(d.source) : undefined,
        }))
        .filter((d) => d.asset && d.amount > 0);
      setPendingDeposits(open);
    } catch {
      setPendingDeposits([]);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      dispatch(fetchWalletThunk());
      void loadPending();
    }, [dispatch, loadPending]),
  );

  useEffect(() => {
    void loadPending();
  }, [loadPending, assets]);

  const portfolioUsd = useMemo(
    () => computePortfolioUsd(assets, markets, totalUsd),
    [assets, markets, totalUsd],
  );

  const sorted = useMemo(() => sortedWalletAssets(assets, markets), [assets, markets]);

  const { availableUsd, lockedUsd } = useMemo(() => {
    let avail = 0;
    let locked = 0;
    for (const a of assets) {
      const px = spotPriceForAsset(a.asset, markets);
      avail += parseMarketNum(a.available_balance) * px;
      locked += parseMarketNum(a.locked_balance) * px;
    }
    return { availableUsd: avail, lockedUsd: locked };
  }, [assets, markets]);

  const goTrade = (asset: string) => {
    const sym = asset === 'USDT' ? 'BTCUSDT' : `${asset}USDT`;
    navigation.navigate('Trade', {
      screen: 'TradePair',
      params: { symbol: sym, market: 'spot' },
    });
  };

  return (
    <View style={styles.wrap}>
      <View style={walletStyles.statGrid}>
        <StatBox label="Total portfolio" value={formatUSD(portfolioUsd)} />
        <StatBox label="Available" value={formatUSD(availableUsd)} color={Colors.buyGreen} />
        <StatBox label="Locked" value={formatUSD(lockedUsd)} color={Colors.goldLight} />
      </View>

      <Text style={walletStyles.sectionTitle}>Your assets</Text>

      {pendingDeposits.length > 0 ? (
        <View style={styles.pendingBanner}>
          <Text style={styles.pendingTitle}>Deposits processing</Text>
          {pendingDeposits.slice(0, 4).map((d, i) => (
            <Text key={`${d.asset}-${d.status}-${i}`} style={styles.pendingLine}>
              {formatAmount(d.amount, 6)} {d.asset} — {depositStatusLabel(d.status, d.source)}
            </Text>
          ))}
          <Text style={styles.pendingHint}>
            {pendingDeposits.some((d) => d.source === 'signup_bonus')
              ? 'Your signup bonus IBO is on-chain and will appear in your balance after confirmations and KYC approval.'
              : 'IBO uses your BNB Chain (BEP-20) deposit address — the same one as USDT on BSC. Check Wallet → History → Deposits for tx details. Balance updates after confirmations and KYC approval.'}
          </Text>
        </View>
      ) : null}

      {sorted.length === 0 ? (
        <View style={[walletStyles.card, walletStyles.empty]}>
          <Text style={walletStyles.emptyText}>No assets yet — use Deposit to fund your wallet</Text>
        </View>
      ) : (
        <View style={walletStyles.listCard}>
          {sorted.map((a, i) => (
            <AssetCard
              key={a.asset}
              asset={a}
              markets={markets}
              onBuy={() => goTrade(a.asset)}
              onSell={() => goTrade(a.asset)}
              onSwap={a.asset === 'IBO' ? onOpenSwap : undefined}
              isLast={i === sorted.length - 1}
            />
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    paddingHorizontal: WALLET_H_PAD,
    paddingTop: Spacing[1],
  },
  assetCard: {
    padding: Spacing[4],
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.surfaceBorder,
  },
  assetCardLast: { borderBottomWidth: 0 },
  assetHead: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: Spacing[3],
  },
  assetMeta: {
    flex: 1,
    marginLeft: Spacing[3],
  },
  assetSym: {
    fontFamily: FontFamily.bold,
    fontSize: FontSize.base,
    color: Colors.textPrimary,
  },
  assetUsd: {
    fontFamily: FontFamily.monoMedium,
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    marginTop: 2,
  },
  metricGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing[2],
    marginBottom: Spacing[3],
  },
  metricCell: {
    width: '48%',
    backgroundColor: Colors.surfaceElevated,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    paddingHorizontal: Spacing[3],
    paddingVertical: Spacing[2],
  },
  metricLabel: {
    fontFamily: FontFamily.regular,
    fontSize: 9,
    color: Colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginBottom: 4,
  },
  metricValue: {
    fontFamily: FontFamily.monoMedium,
    fontSize: FontSize.sm,
    color: Colors.textPrimary,
  },
  actionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing[2],
    marginTop: Spacing[2],
  },
  swapBtn: {
    backgroundColor: Colors.goldAlpha15,
    borderWidth: 1,
    borderColor: Colors.goldAlpha30,
  },
  swapTxt: {
    fontFamily: FontFamily.bold,
    fontSize: FontSize.xs,
    color: Colors.goldLight,
  },
  pendingBanner: {
    marginBottom: Spacing[3],
    padding: Spacing[3],
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.goldAlpha30,
    backgroundColor: Colors.goldAlpha15,
  },
  pendingTitle: {
    fontFamily: FontFamily.semiBold,
    fontSize: FontSize.sm,
    color: Colors.goldLight,
    marginBottom: Spacing[1],
  },
  pendingLine: {
    fontFamily: FontFamily.monoMedium,
    fontSize: FontSize.xs,
    color: Colors.textPrimary,
    marginTop: 2,
  },
  pendingHint: {
    fontFamily: FontFamily.regular,
    fontSize: 10,
    color: Colors.textMuted,
    marginTop: Spacing[2],
    lineHeight: 14,
  },
});
