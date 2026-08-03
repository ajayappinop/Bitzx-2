import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, ScrollView, StyleSheet,
  TouchableOpacity, Alert, Platform,
} from 'react-native';
import Clipboard from '@react-native-clipboard/clipboard';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RouteProp, useFocusEffect, useNavigation } from '@react-navigation/native';
import { WalletStackParamList } from '../../navigation/types';
import { walletApi } from '../../api/wallet.api';
import { authApi } from '../../api/auth.api';
import { parseApiError } from '../../api/errors';
import { SupportedNetwork, WithdrawConfig } from '../../types/wallet.types';
import { useSelector } from 'react-redux';
import { RootState } from '../../store';
import { selectSessionWallet } from '../../store/wallet.slice';
import SafeAreaWrapper from '../../components/common/SafeAreaWrapper';
import Input from '../../components/common/Input';
import Button from '../../components/common/Button';
import ErrorBanner from '../../components/common/ErrorBanner';
import { Colors, FontFamily, FontSize, Spacing, Radius } from '../../theme';
import { WALLET_H_PAD } from '../../components/wallet/walletStyles';
import { formatAmount } from '../../utils/formatters';
import {
  effectiveKycStatus,
  isKycApproved,
  isKycPendingReview,
} from '../../utils/kycGate';
import {
  withdrawalRequiresTotp,
  withdrawalBlockedUntilTwoFaEnrolled,
} from '../../utils/twoFaGate';
import type { TwoFAStatus } from '../../types/auth.types';
import Icon from '@/components/common/AppIcon';
import NetworkChainDetailsCard from '../../components/wallet/NetworkChainDetailsCard';
import NetworkSelectList from '../../components/wallet/NetworkSelectList';
import AddressQrScannerModal from '../../components/wallet/AddressQrScannerModal';
import { invalidateWalletHistoryCache } from '../../utils/walletHistoryCache';
import AdaptiveKeyboardAvoidingView from '@/components/common/AdaptiveKeyboardAvoidingView';
import { iosManualKeyboardScrollProps } from '@/utils/iosKeyboardScroll';

type Props = {
  navigation: NativeStackNavigationProp<WalletStackParamList, 'Withdraw'>;
  route: RouteProp<WalletStackParamList, 'Withdraw'>;
};

export default function WithdrawScreen({ navigation, route }: Props) {
  const tabNavigation = useNavigation<any>();
  const { asset: initialAsset, embedded } = route.params ?? {};
  const { assets: walletAssets } = useSelector(selectSessionWallet);
  const { user, kyc } = useSelector((s: RootState) => s.auth);
  const kycStatus = effectiveKycStatus(kyc, user);
  const kycWithdrawBlocked = Boolean(user && !isKycApproved(kycStatus));
  const kycWithdrawPending = Boolean(user && isKycPendingReview(kycStatus));

  const [twoFaStatus, setTwoFaStatus] = useState<TwoFAStatus | null>(null);
  const [totpCode, setTotpCode] = useState('');
  const [allNetworks, setAllNetworks] = useState<SupportedNetwork[]>([]);
  const [withdrawConfig, setWithdrawConfig] = useState<WithdrawConfig | null>(null);
  const [selectedAsset, setSelectedAsset] = useState<string>(initialAsset ?? '');
  const [selectedNetwork, setSelectedNetwork] = useState<string>('');
  const [address, setAddress] = useState('');
  const [memo, setMemo] = useState('');
  const [amount, setAmount] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [banner, setBanner] = useState('');
  const [bannerType, setBannerType] = useState<'error' | 'success'>('error');
  const [submitLoading, setSubmitLoading] = useState(false);
  const [scannerVisible, setScannerVisible] = useState(false);
  const [showNetworkDetails, setShowNetworkDetails] = useState(false);
  const [showFeeDetails, setShowFeeDetails] = useState(false);

  useEffect(() => {
    loadNetworks();
  }, []);

  useEffect(() => {
    loadWithdrawConfig(selectedNetwork);
  }, [selectedNetwork]);

  const loadWithdrawConfig = async (network?: string) => {
    try {
      const { data } = await walletApi.getWithdrawConfig(
        network ? { network } : undefined,
      );
      setWithdrawConfig(data);
    } catch {
      setWithdrawConfig(null);
    }
  };

  const loadTwoFaStatus = useCallback(async () => {
    if (!user) {
      setTwoFaStatus(null);
      return;
    }
    try {
      const { data } = await authApi.get2FAStatus();
      setTwoFaStatus(data);
    } catch {
      setTwoFaStatus(null);
    }
  }, [user]);

  useFocusEffect(
    useCallback(() => {
      loadTwoFaStatus();
    }, [loadTwoFaStatus]),
  );

  const needsWithdrawTotp =
    withdrawalRequiresTotp(twoFaStatus) ||
    (twoFaStatus == null && Boolean(user?.two_factor_enabled));
  const twoFaEnrollBlocked = withdrawalBlockedUntilTwoFaEnrolled(twoFaStatus);
  const twoFaPendingSetup = Boolean(twoFaStatus?.pending_setup && !twoFaStatus?.enabled);

  const loadNetworks = async () => {
    try {
      const { data } = await walletApi.getSupportedNetworks();
      setAllNetworks(data);
      const withdrawActive = data.filter((n) => n.withdraw_enabled && n.status !== 'coming_soon');
      if (!selectedAsset && withdrawActive.length > 0) {
        setSelectedAsset(withdrawActive[0].asset);
        setSelectedNetwork(withdrawActive[0].network);
      } else if (selectedAsset) {
        const activeForAsset = withdrawActive.filter((n) => n.asset === selectedAsset);
        const anyForAsset = data.filter((n) => n.asset === selectedAsset);
        if (activeForAsset.length) setSelectedNetwork(activeForAsset[0].network);
        else if (anyForAsset.length) setSelectedNetwork(anyForAsset[0].network);
      } else if (data.length > 0) {
        const assets = [...new Set(data.map((n) => n.asset))];
        setSelectedAsset(assets[0]);
        const nets = data.filter((n) => n.asset === assets[0]);
        setSelectedNetwork(nets[0]?.network ?? '');
      }
    } catch (err) {
      setAllNetworks([]);
      setBanner(parseApiError(err).message);
    }
  };

  const uniqueAssets = [...new Set(allNetworks.map((n) => n.asset))];
  const assetNetworksWithdraw = allNetworks.filter(
    (n) => n.asset === selectedAsset && n.withdraw_enabled && n.status !== 'coming_soon',
  );
  const assetNetworksPlanned = allNetworks.filter(
    (n) =>
      n.asset === selectedAsset &&
      (!n.withdraw_enabled || n.status === 'coming_soon'),
  );
  const selectedNetworkData = allNetworks.find(
    (n) => n.asset === selectedAsset && n.network === selectedNetwork,
  );
  const withdrawReady = Boolean(
    selectedNetworkData?.withdraw_enabled && selectedNetworkData?.status !== 'coming_soon',
  );
  const assetBalance = walletAssets.find(a => a.asset === selectedAsset);
  const iboBalance = walletAssets.find(a => a.asset === 'IBO');
  const available = parseFloat(String(assetBalance?.available_balance ?? 0));
  const iboAvailable = parseFloat(String(iboBalance?.available_balance ?? 0));
  const feeRate = withdrawConfig?.withdraw_fee_rate ?? 0;
  const iboPrice = Number(withdrawConfig?.ibo_price_usdt) || 0;
  const iboGasFee = selectedAsset.toUpperCase() === 'IBO'
    ? 0
    : (withdrawConfig?.withdraw_gas_fee_ibo ?? 0);
  const amtNum = parseFloat(amount);
  const withdrawNotionalUsdt = (() => {
    if (!Number.isFinite(amtNum) || amtNum <= 0) return 0;
    const a = selectedAsset.toUpperCase();
    if (a === 'USDT') return amtNum;
    if (a === 'IBO' && iboPrice > 0) return amtNum * iboPrice;
    return 0;
  })();
  const platformFeeUsdt = withdrawNotionalUsdt > 0 && feeRate > 0
    ? withdrawNotionalUsdt * feeRate
    : 0;
  const platformFeeIbo = platformFeeUsdt > 0 && iboPrice > 0
    ? platformFeeUsdt / iboPrice
    : 0;
  const totalAssetDebit = Number.isFinite(amtNum) && amtNum > 0 ? amtNum : 0;
  const totalIboFees = platformFeeIbo + iboGasFee;
  const showFeePanel = feeRate > 0 || iboGasFee > 0;
  const needsMemo = selectedNetworkData
    && ['XRP', 'XLM', 'EOS', 'ATOM', 'BNB'].includes(selectedAsset);

  const handleMax = () => setAmount(String(available));

  const handlePasteAddress = async () => {
    const text = await Clipboard.getString();
    if (text?.trim()) {
      setAddress(text.trim());
      setFieldErrors((e) => ({ ...e, address: '' }));
    }
  };

  const handleScanAddress = (scanned: string) => {
    setAddress(scanned);
    setFieldErrors((e) => ({ ...e, address: '' }));
  };

  const validate = () => {
    const errs: Record<string, string> = {};
    if (!address.trim()) errs.address = 'Withdrawal address is required';
    const amt = parseFloat(amount);
    if (!amount || isNaN(amt) || amt <= 0) errs.amount = 'Enter a valid amount';
    else if (amt > available) errs.amount = 'Insufficient available balance';
    else if (selectedNetworkData?.min_withdraw && amt < selectedNetworkData.min_withdraw) {
      errs.amount = `Minimum withdrawal is ${selectedNetworkData.min_withdraw} ${selectedAsset}`;
    }
    const iboNeeded = selectedAsset.toUpperCase() === 'IBO'
      ? totalAssetDebit + totalIboFees
      : totalIboFees;
    if (iboNeeded > 0 && iboNeeded > iboAvailable + 1e-12) {
      errs.ibo = selectedAsset.toUpperCase() === 'IBO'
        ? `Insufficient IBO. Need ${formatAmount(iboNeeded)} IBO (withdraw + fees)`
        : `Insufficient IBO for fees (need ${formatAmount(totalIboFees)} IBO)`;
    }
    if (needsWithdrawTotp) {
      const t = totpCode.trim();
      if (t.length < 6) errs.totp = 'Enter your 6-digit authenticator code or a backup code';
    }
    return errs;
  };

  const handleSubmit = () => {
    if (!withdrawReady) {
      setBannerType('error');
      setBanner('Withdrawals are not enabled for this network yet.');
      return;
    }
    if (kycWithdrawBlocked) {
      setBannerType('error');
      setBanner('Identity verification (KYC) is required before withdrawing.');
      return;
    }
    if (twoFaEnrollBlocked) {
      setBannerType('error');
      setBanner(
        twoFaPendingSetup
          ? 'Finish two-factor setup in Profile → Security before withdrawing.'
          : 'This exchange requires two-factor authentication for withdrawals. Enable it in Profile → Security.',
      );
      return;
    }
    const errs = validate();
    setFieldErrors(errs);
    if (Object.keys(errs).length > 0) return;

    const feeLines = [
      `Amount sent: ${amount} ${selectedAsset}`,
      platformFeeIbo > 0 ? `Platform fee: ${formatAmount(platformFeeIbo)} IBO` : null,
      iboGasFee > 0 ? `Gas fee: ${formatAmount(iboGasFee)} IBO` : null,
      totalIboFees > 0 ? `Total IBO fees: ${formatAmount(totalIboFees)} IBO` : null,
      `Total ${selectedAsset} locked: ${formatAmount(totalAssetDebit)} ${selectedAsset}`,
    ].filter(Boolean).join('\n');

    Alert.alert(
      'Confirm Withdrawal',
      `Asset: ${selectedAsset}\nNetwork: ${selectedNetwork}\nAddress: ${address.slice(0, 16)}...\n\n${feeLines}`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Confirm', onPress: submitWithdraw },
      ],
    );
  };

  const submitWithdraw = async () => {
    setSubmitLoading(true);
    setBanner('');
    try {
      await walletApi.withdraw({
        asset: selectedAsset,
        network: selectedNetwork,
        address: address.trim(),
        amount: parseFloat(amount),
        memo: memo.trim() || undefined,
        ...(needsWithdrawTotp ? { totp: totpCode.trim() } : {}),
      });
      invalidateWalletHistoryCache();
      setBannerType('success');
      setBanner('Withdrawal submitted successfully!');
      setAddress('');
      setMemo('');
      setAmount('');
      setTotpCode('');
      setTimeout(() => navigation.navigate('Transactions', {}), 2000);
    } catch (err) {
      const msg = parseApiError(err).message;
      setBannerType('error');
      setBanner(msg);
      if (/two-factor|2fa|totp/i.test(msg)) {
        await loadTwoFaStatus();
      }
    } finally {
      setSubmitLoading(false);
    }
  };

  const addressActions = (
    <View style={styles.addressActions}>
      <TouchableOpacity style={styles.iconBtn} onPress={() => setScannerVisible(true)} hitSlop={8}>
        <Icon name="qr-code-scan" size={20} color={Colors.goldLight} />
      </TouchableOpacity>
      <TouchableOpacity style={styles.iconBtn} onPress={handlePasteAddress} hitSlop={8}>
        <Icon name="clipboard-outline" size={20} color={Colors.goldLight} />
      </TouchableOpacity>
    </View>
  );

  const body = (
    <>
      {!embedded ? (
        <View style={styles.topBar}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
            <Text style={styles.backText}>‹</Text>
          </TouchableOpacity>
          <Text style={styles.pageTitle}>Withdraw</Text>
          <TouchableOpacity style={styles.inrBtn} onPress={() => navigation.navigate('InrWithdraw')}>
            <Text style={styles.inrBtnText}>INR</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      <AdaptiveKeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={[styles.content, embedded && styles.contentEmbedded]}
          {...iosManualKeyboardScrollProps()}
          showsVerticalScrollIndicator={false}
        >
          <ErrorBanner message={banner} type={bannerType} />

          {!embedded ? (
            <TouchableOpacity style={styles.inrLink} onPress={() => navigation.navigate('InrWithdraw')}>
              <Text style={styles.inrLinkText}>Need INR to bank/UPI? </Text>
              <Text style={styles.inrLinkAction}>Use INR Withdraw →</Text>
            </TouchableOpacity>
          ) : null}

          {kycWithdrawBlocked && (
            <GateBanner
              icon="shield-check-outline"
              tone={kycWithdrawPending ? 'pending' : 'warn'}
              text={
                kycWithdrawPending
                  ? 'Your KYC is under review. Withdrawals unlock after approval.'
                  : kycStatus === 'rejected'
                    ? 'KYC was rejected. Resubmit documents before withdrawing.'
                    : 'Complete identity verification to withdraw funds.'
              }
              actionLabel="Go to KYC"
              onAction={() => tabNavigation.navigate('Profile', { screen: 'KYCStatus' })}
            />
          )}

          {!kycWithdrawBlocked && twoFaEnrollBlocked && (
            <GateBanner
              icon="shield-key-outline"
              tone="warn"
              text={
                twoFaPendingSetup
                  ? 'Finish two-factor setup in Security to withdraw.'
                  : 'Enable two-factor authentication in Security to withdraw.'
              }
              actionLabel="Open Security"
              onAction={() => tabNavigation.navigate('Profile', { screen: 'Security' })}
            />
          )}

          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <Text style={styles.sectionLabel}>Send crypto</Text>
              {assetBalance ? (
                <Text style={styles.balanceInline}>
                  {formatAmount(available, 8)} {selectedAsset} available
                </Text>
              ) : null}
            </View>

            <Text style={styles.fieldLabel}>Asset</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipScroll}>
              {uniqueAssets.map(asset => (
                <TouchableOpacity
                  key={asset}
                  style={[styles.chip, selectedAsset === asset && styles.chipActive]}
                  onPress={() => {
                    setSelectedAsset(asset);
                    const active = allNetworks.filter(
                      (n) => n.asset === asset && n.withdraw_enabled && n.status !== 'coming_soon',
                    );
                    const any = allNetworks.filter((n) => n.asset === asset);
                    if (active.length) setSelectedNetwork(active[0].network);
                    else if (any.length) setSelectedNetwork(any[0].network);
                  }}
                >
                  <Text style={[styles.chipText, selectedAsset === asset && styles.chipTextActive]}>
                    {asset}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>

            {uniqueAssets.length > 0 ? (
              <>
                <Text style={[styles.fieldLabel, { marginTop: Spacing[4] }]}>Network</Text>
                <NetworkSelectList
                  networks={assetNetworksWithdraw}
                  plannedNetworks={assetNetworksPlanned}
                  selectedNetwork={selectedNetwork}
                  onSelect={setSelectedNetwork}
                  mode="withdraw"
                  compact
                />
              </>
            ) : null}

            {!withdrawReady && selectedNetworkData ? (
              <View style={styles.inlineWarn}>
                <Text style={styles.inlineWarnText}>
                  {selectedAsset.toUpperCase() === 'IBO'
                    ? 'On-chain IBO withdrawal is not active yet. Use INR Withdraw for bank/UPI.'
                    : `Withdrawals for ${selectedNetworkData.network_name} are not enabled yet.`}
                </Text>
              </View>
            ) : null}

            {selectedNetworkData && withdrawReady ? (
              <TouchableOpacity
                style={styles.detailsToggle}
                onPress={() => setShowNetworkDetails((v) => !v)}
              >
                <Text style={styles.detailsToggleText}>
                  {showNetworkDetails ? 'Hide' : 'Show'} network details
                </Text>
                <Icon
                  name={showNetworkDetails ? 'chevron-up' : 'chevron-down'}
                  size={18}
                  color={Colors.textMuted}
                />
              </TouchableOpacity>
            ) : null}

            {showNetworkDetails && selectedNetworkData ? (
              <NetworkChainDetailsCard network={selectedNetworkData} mode="withdraw" variant="compact" />
            ) : null}
          </View>

          <View style={styles.card}>
            <Input
              label="Recipient address"
              placeholder="Scan QR or paste wallet address"
              value={address}
              onChangeText={setAddress}
              error={fieldErrors.address}
              autoCapitalize="none"
              rightElement={addressActions}
            />

            {needsMemo ? (
              <Input
                label="Memo / Tag (if required)"
                placeholder="Destination tag or memo"
                value={memo}
                onChangeText={setMemo}
              />
            ) : null}

            <Input
              label={`Amount (${selectedAsset})`}
              placeholder="0.00"
              value={amount}
              onChangeText={setAmount}
              keyboardType="numeric"
              error={fieldErrors.amount}
              rightElement={
                <TouchableOpacity style={styles.maxBtn} onPress={handleMax} hitSlop={8}>
                  <Text style={styles.maxBtnText}>MAX</Text>
                </TouchableOpacity>
              }
            />

            {needsWithdrawTotp && !twoFaEnrollBlocked ? (
              <Input
                label="Authenticator code"
                placeholder="6-digit code or backup code"
                value={totpCode}
                onChangeText={setTotpCode}
                keyboardType="default"
                autoCapitalize="characters"
                maxLength={32}
                error={fieldErrors.totp}
              />
            ) : null}

            {showFeePanel ? (
              <View style={styles.feeCompact}>
                <TouchableOpacity
                  style={styles.feeToggle}
                  onPress={() => setShowFeeDetails((v) => !v)}
                >
                  <Text style={styles.feeSummary}>
                    Fees: {formatAmount(totalIboFees)} IBO
                    {totalAssetDebit > 0 ? ` · ${formatAmount(totalAssetDebit)} ${selectedAsset} sent` : ''}
                  </Text>
                  <Icon
                    name={showFeeDetails ? 'chevron-up' : 'chevron-down'}
                    size={18}
                    color={Colors.textMuted}
                  />
                </TouchableOpacity>
                {showFeeDetails ? (
                  <View style={styles.feePanel}>
                    {platformFeeIbo > 0 ? (
                      <FeeRow
                        label={`Platform fee (${(feeRate * 100).toFixed(2)}%)`}
                        value={`${formatAmount(platformFeeIbo)} IBO`}
                      />
                    ) : null}
                    {iboGasFee > 0 ? (
                      <FeeRow label="Network gas fee" value={`${formatAmount(iboGasFee)} IBO`} />
                    ) : null}
                    <FeeRow label="Total IBO fees" value={`${formatAmount(totalIboFees)} IBO`} bold />
                    <FeeRow
                      label={`${selectedAsset} locked`}
                      value={`${formatAmount(totalAssetDebit)} ${selectedAsset}`}
                    />
                    <Text style={styles.feeHint}>
                      IBO balance: {formatAmount(iboAvailable)}. Fees are charged in IBO only.
                    </Text>
                    {fieldErrors.ibo ? <Text style={styles.fieldError}>{fieldErrors.ibo}</Text> : null}
                  </View>
                ) : null}
              </View>
            ) : null}
          </View>

          <Text style={styles.footerNote}>
            Verify the address and network. Withdrawals cannot be reversed.
          </Text>

          <Button
            title="Review Withdrawal"
            onPress={handleSubmit}
            loading={submitLoading}
            fullWidth
            disabled={kycWithdrawBlocked || twoFaEnrollBlocked || !withdrawReady}
          />

          <View style={{ height: Spacing[8] }} />
        </ScrollView>
      </AdaptiveKeyboardAvoidingView>
    </>
  );

  const scannerModal = (
    <AddressQrScannerModal
      visible={scannerVisible}
      onClose={() => setScannerVisible(false)}
      onScan={handleScanAddress}
    />
  );

  return (
    <>
      {embedded ? body : <SafeAreaWrapper>{body}</SafeAreaWrapper>}
      {scannerModal}
    </>
  );
}

function GateBanner({
  icon,
  tone,
  text,
  actionLabel,
  onAction,
}: {
  icon: string;
  tone: 'pending' | 'warn';
  text: string;
  actionLabel: string;
  onAction: () => void;
}) {
  return (
    <View style={[styles.kycBanner, tone === 'pending' ? styles.kycPending : styles.kycWarn]}>
      <Icon name={icon as any} size={18} color={Colors.goldLight} />
      <Text style={styles.kycText}>{text} </Text>
      <TouchableOpacity onPress={onAction}>
        <Text style={styles.kycLink}>{actionLabel}</Text>
      </TouchableOpacity>
    </View>
  );
}

function FeeRow({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <View style={styles.feeRowInner}>
      <Text style={[styles.feeLabel, bold && styles.feeTotalLabel]}>{label}</Text>
      <Text style={[styles.feeValue, bold && styles.feeTotalValue]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  scroll: { flex: 1 },
  content: { padding: Spacing[5], gap: Spacing[3] },
  contentEmbedded: {
    paddingHorizontal: WALLET_H_PAD,
    paddingTop: Spacing[1],
    paddingBottom: Spacing[10],
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing[4],
    paddingVertical: Spacing[3],
  },
  backBtn: {
    width: 40, height: 40, alignItems: 'center', justifyContent: 'center', marginRight: Spacing[2],
  },
  backText: {
    fontFamily: FontFamily.semiBold, fontSize: 28, color: Colors.textSecondary, lineHeight: 32,
  },
  pageTitle: { flex: 1, fontFamily: FontFamily.bold, fontSize: FontSize.xl, color: Colors.textPrimary },
  inrBtn: {
    paddingHorizontal: Spacing[3],
    paddingVertical: Spacing[2],
    borderRadius: Radius.full,
    borderWidth: 1,
    borderColor: Colors.goldAlpha30,
    backgroundColor: Colors.goldAlpha15,
  },
  inrBtnText: { fontFamily: FontFamily.bold, fontSize: FontSize.xs, color: Colors.goldLight },
  inrLink: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: Spacing[1] },
  inrLinkText: { fontFamily: FontFamily.regular, fontSize: FontSize.xs, color: Colors.textMuted },
  inrLinkAction: { fontFamily: FontFamily.semiBold, fontSize: FontSize.xs, color: Colors.goldLight },
  card: {
    backgroundColor: Colors.surfaceCard,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    borderRadius: Radius.xl,
    padding: Spacing[4],
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: Spacing[3],
    gap: Spacing[2],
  },
  sectionLabel: {
    fontFamily: FontFamily.semiBold,
    fontSize: FontSize.sm,
    color: Colors.textPrimary,
  },
  balanceInline: {
    fontFamily: FontFamily.medium,
    fontSize: FontSize.xs,
    color: Colors.textMuted,
    flexShrink: 1,
    textAlign: 'right',
  },
  fieldLabel: {
    fontFamily: FontFamily.semiBold,
    fontSize: FontSize.xs,
    color: Colors.textMuted,
    letterSpacing: 1,
    marginBottom: Spacing[2],
  },
  chipScroll: { marginBottom: Spacing[1] },
  chip: {
    paddingHorizontal: Spacing[4],
    paddingVertical: Spacing[2],
    borderRadius: Radius.full,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    backgroundColor: Colors.surfaceHover,
    marginRight: Spacing[2],
  },
  chipActive: { borderColor: Colors.gold, backgroundColor: Colors.goldAlpha15 },
  chipText: { fontFamily: FontFamily.medium, fontSize: FontSize.sm, color: Colors.textSecondary },
  chipTextActive: { color: Colors.goldLight },
  inlineWarn: {
    marginTop: Spacing[3],
    padding: Spacing[3],
    borderRadius: Radius.md,
    backgroundColor: Colors.goldAlpha10,
    borderWidth: 1,
    borderColor: Colors.goldAlpha30,
  },
  inlineWarnText: {
    fontFamily: FontFamily.regular,
    fontSize: FontSize.xs,
    color: Colors.goldLight,
    lineHeight: 18,
  },
  detailsToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: Spacing[2],
    paddingTop: Spacing[2],
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Colors.surfaceBorder,
  },
  detailsToggleText: {
    fontFamily: FontFamily.medium,
    fontSize: FontSize.xs,
    color: Colors.textMuted,
  },
  addressActions: { flexDirection: 'row', alignItems: 'center', gap: Spacing[1] },
  iconBtn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.md,
    backgroundColor: Colors.goldAlpha10,
    borderWidth: 1,
    borderColor: Colors.goldAlpha30,
  },
  maxBtn: {
    paddingHorizontal: Spacing[2],
    paddingVertical: 6,
    backgroundColor: Colors.goldAlpha15,
    borderWidth: 1,
    borderColor: Colors.goldAlpha30,
    borderRadius: Radius.sm,
  },
  maxBtnText: { fontFamily: FontFamily.bold, fontSize: FontSize.xs, color: Colors.goldLight },
  feeCompact: {
    marginTop: Spacing[3],
    paddingTop: Spacing[3],
    borderTopWidth: 1,
    borderTopColor: Colors.surfaceBorder,
  },
  feeToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing[2],
  },
  feeSummary: {
    flex: 1,
    fontFamily: FontFamily.medium,
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
  },
  feePanel: { marginTop: Spacing[3], gap: Spacing[2] },
  feeRowInner: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  feeLabel: { fontFamily: FontFamily.regular, fontSize: FontSize.sm, color: Colors.textMuted },
  feeValue: { fontFamily: FontFamily.medium, fontSize: FontSize.sm, color: Colors.textSecondary },
  feeTotalLabel: { color: Colors.textPrimary, fontFamily: FontFamily.semiBold },
  feeTotalValue: { color: Colors.goldLight, fontFamily: FontFamily.semiBold },
  feeHint: {
    fontFamily: FontFamily.regular,
    fontSize: FontSize.xs,
    color: Colors.textMuted,
    lineHeight: 18,
  },
  fieldError: { fontFamily: FontFamily.medium, fontSize: FontSize.xs, color: Colors.danger },
  footerNote: {
    fontFamily: FontFamily.regular,
    fontSize: FontSize.xs,
    color: Colors.textMuted,
    textAlign: 'center',
    lineHeight: 18,
    paddingHorizontal: Spacing[2],
  },
  kycBanner: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: Spacing[2],
    padding: Spacing[3],
    borderRadius: Radius.lg,
    borderWidth: 1,
  },
  kycPending: { backgroundColor: Colors.warningDim, borderColor: 'rgba(245,158,11,0.35)' },
  kycWarn: { backgroundColor: Colors.dangerDim, borderColor: 'rgba(239,68,68,0.35)' },
  kycText: {
    flex: 1,
    minWidth: 120,
    fontFamily: FontFamily.regular,
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    lineHeight: 20,
  },
  kycLink: { fontFamily: FontFamily.bold, fontSize: FontSize.sm, color: Colors.goldLight },
});
