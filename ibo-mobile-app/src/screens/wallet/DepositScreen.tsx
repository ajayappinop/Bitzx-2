import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  Share,
  ActivityIndicator,
} from 'react-native';
import Clipboard from '@react-native-clipboard/clipboard';
import QRCode from 'react-native-qrcode-svg';
import Icon from '@/components/common/AppIcon';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RouteProp, useNavigation } from '@react-navigation/native';
import { useSelector, useDispatch } from 'react-redux';
import { WalletStackParamList } from '../../navigation/types';
import { RootState } from '../../store';
import { fetchMarketsLiteThunk } from '../../store/market.slice';
import { resolveLogoUrlForSymbol } from '../../utils/coinLogoResolve';
import { walletApi } from '../../api/wallet.api';
import { parseApiError } from '../../api/errors';
import { DepositAddress, SupportedNetwork } from '../../types/wallet.types';
import SafeAreaWrapper from '../../components/common/SafeAreaWrapper';
import { iosManualKeyboardScrollProps } from '@/utils/iosKeyboardScroll';
import ErrorBanner from '../../components/common/ErrorBanner';
import CoinIcon from '../../components/common/CoinIcon';
import Button from '../../components/common/Button';
import { Colors, FontFamily, FontSize, Spacing, Radius } from '../../theme';
import { WALLET_H_PAD } from '../../components/wallet/walletStyles';
import { MIN_WALLET_NOTIONAL_USDT } from '../../config/constants';
import NetworkChainDetailsCard from '../../components/wallet/NetworkChainDetailsCard';
import NetworkSelectList from '../../components/wallet/NetworkSelectList';
import WalletChainsBanner from '../../components/wallet/WalletChainsBanner';
import DepositTokenSearch from '../../components/wallet/DepositTokenSearch';
import { useDepositCatalog, type DepositCatalogItem } from '../../hooks/useDepositCatalog';
import { useDepositMonitor } from '../../hooks/useDepositMonitor';
import { useDepositDetectedModal } from '../../hooks/useDepositDetectedModal';
import DepositSuccessModal from '../../components/wallet/DepositSuccessModal';
import { InrMinDepositChip, InrMinDepositNote } from '../../components/inr/InrMinDepositHint';
import { useInrMinDeposit } from '../../hooks/useInrMinDeposit';
import {
  effectiveKycStatus,
  isKycApproved,
  isKycPendingReview,
} from '../../utils/kycGate';

type DepositMode = 'bsc' | 'all';

type Props = {
  navigation: NativeStackNavigationProp<WalletStackParamList, 'Deposit'>;
  route: RouteProp<WalletStackParamList, 'Deposit'>;
};

export default function DepositScreen({ navigation, route }: Props) {
  const tabNavigation = useNavigation<any>();
  const dispatch = useDispatch();
  const { asset: initialAsset, network: initialNetwork, embedded } = route.params ?? {};
  const { user, kyc } = useSelector((s: RootState) => s.auth);
  const markets = useSelector((s: RootState) => s.market.markets);
  const marketList = useSelector((s: RootState) => s.market.marketList);

  const [allNetworks, setAllNetworks] = useState<SupportedNetwork[]>([]);
  const [selectedAsset, setSelectedAsset] = useState<string>(initialAsset ?? '');
  const [selectedNetwork, setSelectedNetwork] = useState<string>(initialNetwork ?? '');
  const [depositAddress, setDepositAddress] = useState<DepositAddress | null>(null);

  const [netsLoading, setNetsLoading] = useState(true);
  const [netsError, setNetsError] = useState('');
  const [addrLoading, setAddrLoading] = useState(false);
  const [addrError, setAddrError] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [copied, setCopied] = useState(false);
  const [depositMode, setDepositMode] = useState<DepositMode>('bsc');

  const {
    query: catalogQuery,
    setQuery: setCatalogQuery,
    items: bscCatalog,
    total: catalogTotal,
    bep20Meta,
    loading: catalogLoading,
    error: catalogError,
    refresh: refreshCatalog,
  } = useDepositCatalog('bsc', depositMode === 'bsc');

  const kycStatus = effectiveKycStatus(kyc, user);
  const kycWalletBlocked = Boolean(user && !isKycApproved(kycStatus));
  const kycPendingBanner = Boolean(user && isKycPendingReview(kycStatus));

  // On-demand deposit monitoring — starts (or resumes) a shared ~7-minute
  // backend session the moment this screen opens. No visible countdown;
  // the banner below only shows a static "stay on this page" reminder.
  // Opening Transactions/History later resumes the same session instead of
  // starting a new timer.
  const successModal = useDepositDetectedModal();
  const depositMonitor = useDepositMonitor({
    autoStart: true,
    onDeposit: (count) => {
      loadNetworks().catch(() => {});
      successModal.handleDetected(count);
    },
  });
  const { minDepositInr } = useInrMinDeposit();

  const loadNetworks = useCallback(async () => {
    setNetsError('');
    try {
      const { data } = await walletApi.getSupportedNetworks();
      setAllNetworks(data);
    } catch (err) {
      setAllNetworks([]);
      setNetsError(parseApiError(err).message);
    } finally {
      setNetsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadNetworks();
  }, [loadNetworks]);

  useEffect(() => {
    if (marketList.length === 0) {
      dispatch(fetchMarketsLiteThunk() as any);
    }
  }, [marketList.length, dispatch]);

  const catalogLogoByAsset = React.useMemo(() => {
    const map: Record<string, string> = {};
    for (const it of bscCatalog) {
      const logo = it.logo_url?.trim();
      if (logo && !map[it.asset]) map[it.asset] = logo;
    }
    return map;
  }, [bscCatalog]);

  const logoForAsset = useCallback(
    (asset: string) => catalogLogoByAsset[asset] ?? resolveLogoUrlForSymbol(asset, markets),
    [catalogLogoByAsset, markets],
  );

  const depositActive = allNetworks.filter((n) => n.deposit_enabled && n.status !== 'coming_soon');

  useEffect(() => {
    if (allNetworks.length === 0) {
      setSelectedAsset('');
      setSelectedNetwork('');
      return;
    }
    const assets = [...new Set(allNetworks.map((n) => n.asset))];
    setSelectedAsset((prev) => {
      if (prev && assets.includes(prev)) return prev;
      if (initialAsset && assets.includes(initialAsset)) return initialAsset;
      const firstWithDeposit = assets.find((a) =>
        allNetworks.some((n) => n.asset === a && n.deposit_enabled && n.status !== 'coming_soon'),
      );
      return firstWithDeposit ?? assets[0];
    });
  }, [allNetworks, initialAsset]);

  /** Default network for current asset */
  useEffect(() => {
    if (!selectedAsset) {
      setSelectedNetwork('');
      return;
    }
    const forAsset = allNetworks.filter((n) => n.asset === selectedAsset);
    const active = forAsset.filter((n) => n.deposit_enabled && n.status !== 'coming_soon');
    setSelectedNetwork((prev) => {
      if (prev && forAsset.some((n) => n.network === prev)) return prev;
      if (initialNetwork && forAsset.some((n) => n.network === initialNetwork)) return initialNetwork;
      return active[0]?.network ?? forAsset[0]?.network ?? '';
    });
  }, [allNetworks, selectedAsset, initialNetwork]);

  const selectedCatalogItem = bscCatalog.find((it) => it.asset === selectedAsset) ?? null;

  const selectedNet =
    allNetworks.find((n) => n.asset === selectedAsset && n.network === selectedNetwork) ??
    (selectedCatalogItem
      ? ({
          asset: selectedCatalogItem.asset,
          network: selectedCatalogItem.network,
          network_name: selectedCatalogItem.label,
          deposit_enabled: selectedCatalogItem.deposit_enabled,
          withdraw_enabled: selectedCatalogItem.withdraw_enabled,
          status: selectedCatalogItem.status,
          chain_id: selectedCatalogItem.chain_id,
          chain_display: 'BNB Smart Chain',
        } as SupportedNetwork)
      : undefined);

  const depositReady = Boolean(
    (selectedNet?.deposit_enabled && selectedNet?.status !== 'coming_soon') ||
      (selectedCatalogItem?.deposit_enabled && selectedCatalogItem?.status === 'active'),
  );

  const loadAddress = useCallback(async () => {
    if (!selectedAsset || !selectedNetwork) {
      setDepositAddress(null);
      setAddrError('');
      setAddrLoading(false);
      return;
    }
    const sel = allNetworks.find(
      (n) => n.asset === selectedAsset && n.network === selectedNetwork,
    );
    const cat = bscCatalog.find(
      (it) => it.asset === selectedAsset && it.network === selectedNetwork,
    );
    const canDeposit =
      (sel?.deposit_enabled && sel.status !== 'coming_soon') ||
      (cat?.deposit_enabled && cat.status === 'active');
    if (!canDeposit) {
      setDepositAddress(null);
      setAddrError('Deposits for this network are not live yet. Choose an active network.');
      setAddrLoading(false);
      return;
    }
    setAddrLoading(true);
    setAddrError('');
    setDepositAddress(null);
    try {
      const { data } = await walletApi.getDepositAddresses(selectedAsset, selectedNetwork);
      const raw = Array.isArray(data) ? data[0] : data;
      if (!raw || typeof raw !== 'object') {
        setDepositAddress(null);
        return;
      }
      const addr = raw as DepositAddress;
      const line = String(addr.address ?? '').trim();
      if (!line) {
        setDepositAddress(null);
        return;
      }
      setDepositAddress(addr);
    } catch (err) {
      setDepositAddress(null);
      setAddrError(parseApiError(err).message);
    } finally {
      setAddrLoading(false);
    }
  }, [selectedAsset, selectedNetwork, allNetworks, bscCatalog]);

  useEffect(() => {
    if (depositMode !== 'bsc' || bscCatalog.length === 0) return;
    if (selectedAsset && bscCatalog.some((it) => it.asset === selectedAsset)) return;
    const first = bscCatalog[0];
    if (first) {
      setSelectedAsset(first.asset);
      setSelectedNetwork(first.network);
    }
  }, [depositMode, bscCatalog, selectedAsset]);

  const handleBscSelect = (asset: string, item: DepositCatalogItem) => {
    setSelectedAsset(asset);
    setSelectedNetwork(item.network);
  };

  useEffect(() => {
    loadAddress();
  }, [loadAddress]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await loadNetworks();
      await refreshCatalog();
      await loadAddress();
    } finally {
      setRefreshing(false);
    }
  }, [loadNetworks, loadAddress]);

  const handleCopy = (text: string) => {
    Clipboard.setString(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleShare = async (address: string) => {
    try {
      await Share.share({ message: address });
    } catch {
      /* ignore */
    }
  };

  const uniqueAssets = [...new Set(allNetworks.map((n) => n.asset))];
  const assetNetworksActive = allNetworks.filter(
    (n) => n.asset === selectedAsset && n.deposit_enabled && n.status !== 'coming_soon',
  );
  const assetNetworksPlanned = allNetworks.filter(
    (n) => n.asset === selectedAsset && n.status === 'coming_soon',
  );
  const hasSupported =
    allNetworks.length > 0 || (depositMode === 'bsc' && bscCatalog.length > 0);
  const hasDepositActive =
    depositActive.length > 0 || (depositMode === 'bsc' && bscCatalog.some((it) => it.deposit_enabled));
  const qrValue =
    depositAddress?.qr_payload?.trim() ||
    depositAddress?.address?.trim() ||
    '';

  const syncAssetSelection = (asset: string) => {
    setSelectedAsset(asset);
  };

  const body = (
    <>
      {!embedded ? (
        <View style={styles.topBar}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
            <Icon name="arrow-left" size={22} color={Colors.textSecondary} />
          </TouchableOpacity>
          <Text style={styles.pageTitle}>Deposit</Text>
          <TouchableOpacity onPress={onRefresh} style={styles.refreshIcon}>
            <Icon name="refresh" size={22} color={Colors.goldLight} />
          </TouchableOpacity>
        </View>
      ) : null}

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.content, embedded && styles.contentEmbedded]}
        showsVerticalScrollIndicator={false}
        {...iosManualKeyboardScrollProps()}
      >
        {netsError ? <ErrorBanner message={netsError} type="warning" /> : null}

        {/* Deposit monitor status — static note only, no countdown shown. */}
        {depositMonitor.status === 'starting' ? (
          <View style={styles.monitorBanner}>
            <ActivityIndicator size="small" color={Colors.goldLight} />
            <Text style={styles.monitorBannerText}>Starting deposit check…</Text>
          </View>
        ) : depositMonitor.isActive ? (
          <View style={[styles.monitorBanner, styles.monitorBannerActive]}>
            <View style={styles.monitorDot} />
            <View style={styles.monitorTextCol}>
              <Text style={styles.monitorBannerTitle}>Checking for your deposit on-chain</Text>
              <Text style={styles.monitorBannerSubtext}>
                Please don&apos;t close or leave this screen until your transaction is detected.
              </Text>
            </View>
          </View>
        ) : null}

        {kycWalletBlocked && (
          <View
            style={[
              styles.kycBanner,
              kycPendingBanner ? styles.kycPending : styles.kycWarn,
            ]}
          >
            <Icon name="shield-check-outline" size={18} color={Colors.goldLight} />
            <Text style={styles.kycText}>
              {kycPendingBanner
                ? 'Your KYC is pending review. You can view your deposit address; credits apply after approval.'
                : kycStatus === 'rejected'
                  ? 'KYC was rejected. Resubmit to unlock deposits. Your address still appears below when available.'
                  : 'Identity verification is required before deposits are credited. You can still copy your deposit address.'}{' '}
            </Text>
            <TouchableOpacity
              onPress={() =>
                tabNavigation.navigate('Profile', { screen: 'KYCStatus' })
              }
            >
              <Text style={styles.kycLink}>Go to KYC</Text>
            </TouchableOpacity>
          </View>
        )}

        <View style={styles.inrPromoCard}>
          <View style={styles.inrPromoText}>
            <View style={styles.inrPromoTitleRow}>
              <Text style={styles.inrPromoTitle}>Deposit via INR (Bank / UPI / QR)</Text>
              <InrMinDepositChip minDepositInr={minDepositInr} />
            </View>
            <Text style={styles.inrPromoBody}>
              Pay in Indian Rupees, upload your transfer proof, and receive tokens after admin approval.
            </Text>
            <InrMinDepositNote minDepositInr={minDepositInr} />
          </View>
          <View style={styles.inrPromoActions}>
            <TouchableOpacity
              style={styles.inrPromoPrimary}
              onPress={() => navigation.navigate('InrDeposit')}
            >
              <Text style={styles.inrPromoPrimaryText}>Deposit INR</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.inrPromoSecondary}
              onPress={() => navigation.navigate('InrDepositsHistory')}
            >
              <Text style={styles.inrPromoSecondaryText}>INR history</Text>
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.introCard}>
          <Text style={styles.introTitle}>Your deposit address</Text>
          <Text style={styles.introBody}>
            Send funds to your personal address below. Deposits are detected on-chain and credited after
            confirmations. Track progress under Wallet → History.
          </Text>
          <TouchableOpacity
            style={styles.historyLink}
            onPress={() => navigation.navigate('Transactions', {})}
          >
            <Icon name="history" size={14} color={Colors.goldLight} />
            <Text style={styles.historyLinkText}>Open deposit history</Text>
            <Icon name="chevron-right" size={16} color={Colors.textMuted} />
          </TouchableOpacity>
        </View>

        {/* Step 1 — Asset & network */}
        <View style={styles.modeRow}>
          {(
            [
              { id: 'bsc' as DepositMode, label: 'BNB Chain (BEP-20)' },
              { id: 'all' as DepositMode, label: 'All networks' },
            ] as const
          ).map((m) => (
            <TouchableOpacity
              key={m.id}
              style={[styles.modeChip, depositMode === m.id && styles.modeChipActive]}
              onPress={() => setDepositMode(m.id)}
            >
              <Text
                style={[styles.modeChipText, depositMode === m.id && styles.modeChipTextActive]}
              >
                {m.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={styles.stepLabel}>STEP 1 — ASSET & NETWORK</Text>

        {depositMode === 'bsc' ? (
          <View style={styles.card}>
            <DepositTokenSearch
              items={bscCatalog}
              value={selectedAsset}
              onSelect={handleBscSelect}
              query={catalogQuery}
              onQueryChange={setCatalogQuery}
              loading={catalogLoading}
              error={catalogError}
              bep20Meta={bep20Meta}
              total={catalogTotal}
            />
            {catalogError ? <ErrorBanner message={catalogError} type="warning" /> : null}
            {selectedCatalogItem ? (
              <NetworkChainDetailsCard
                network={{
                  asset: selectedCatalogItem.asset,
                  network: selectedCatalogItem.network,
                  network_name: selectedCatalogItem.label,
                  chain_id: selectedCatalogItem.chain_id,
                  chain_display: 'BNB Smart Chain',
                  deposit_enabled: selectedCatalogItem.deposit_enabled,
                  withdraw_enabled: selectedCatalogItem.withdraw_enabled,
                  status: selectedCatalogItem.status,
                }}
                mode="deposit"
              />
            ) : null}
            {bep20Meta?.enabled && depositAddress?.address ? (
              <View style={styles.universalBanner}>
                <Text style={styles.universalBannerText}>
                  This address accepts supported BEP-20 tokens. Send only{' '}
                  <Text style={styles.universalAsset}>{selectedAsset}</Text> for this deposit.
                </Text>
              </View>
            ) : null}
          </View>
        ) : null}

        {depositMode === 'all' && netsLoading ? (
          <Text style={styles.loadingHintInline}>Loading networks…</Text>
        ) : null}

        {!netsLoading && hasSupported ? <WalletChainsBanner /> : null}

        {!netsLoading && !netsError && !hasSupported && (
          <View style={styles.emptyCard}>
            <Icon name="bank-off-outline" size={28} color={Colors.textMuted} />
            <Text style={styles.emptyTitle}>No blockchain endpoints configured</Text>
            <Text style={styles.emptyBody}>
              Add QuickNode RPC URLs on the server, then pull to refresh.
            </Text>
          </View>
        )}

        {depositMode === 'all' && hasSupported && (
          <>
            <View style={styles.card}>
              <Text style={styles.sectionLabel}>ASSET</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipRow}>
                {uniqueAssets.map((asset) => (
                  <TouchableOpacity
                    key={asset}
                    style={[styles.chip, selectedAsset === asset && styles.chipActive]}
                    onPress={() => syncAssetSelection(asset)}
                  >
                    <CoinIcon symbol={asset} size={22} logoUrl={logoForAsset(asset)} />
                    <Text style={[styles.chipText, selectedAsset === asset && styles.chipTextActive]}>
                      {asset}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>

            <View style={styles.card}>
              <Text style={styles.sectionLabel}>NETWORK</Text>
              <Text style={styles.networkHint}>
                Choose the network that matches where you send funds. Details for each chain are
                shown below.
              </Text>
              <NetworkSelectList
                networks={assetNetworksActive}
                plannedNetworks={assetNetworksPlanned}
                selectedNetwork={selectedNetwork}
                onSelect={setSelectedNetwork}
                mode="deposit"
              />
            </View>
            {selectedNet ? (
              <NetworkChainDetailsCard network={selectedNet} mode="deposit" />
            ) : null}
            {!depositReady && selectedNet?.status === 'coming_soon' ? (
              <View style={styles.comingSoonBanner}>
                <Text style={styles.comingSoonText}>
                  RPC is configured for this chain. On-chain deposit scanning is not live yet — pick an active network to deposit.
                </Text>
              </View>
            ) : null}
            {hasSupported && !hasDepositActive ? (
              <View style={styles.comingSoonBanner}>
                <Text style={styles.comingSoonText}>
                  No deposit networks are active yet. Listed assets match your configured endpoints.
                </Text>
              </View>
            ) : null}
          </>
        )}

        {/* Step 2 — Address */}
        <Text style={[styles.stepLabel, { marginTop: Spacing[2] }]}>STEP 2 — SCAN OR COPY</Text>

        {hasSupported && addrError && !addrLoading ? (
          <ErrorBanner message={addrError} type="warning" />
        ) : null}

        {hasSupported && !addrLoading && !addrError && depositAddress && qrValue ? (
          <View style={styles.card}>
            <Text style={styles.sectionLabel}>DEPOSIT ADDRESS</Text>
            {depositAddress.label ? (
              <Text style={styles.addrHeadline}>{depositAddress.label}</Text>
            ) : null}

            <View style={styles.qrBox}>
              <View style={styles.qrWrapper}>
                <QRCode value={qrValue} size={180} color="#000000" backgroundColor="#FFFFFF" />
              </View>
              <TouchableOpacity
                style={styles.shareBtn}
                onPress={() => handleShare(depositAddress.address)}
              >
                <Icon name="share-variant-outline" size={14} color={Colors.goldLight} />
                <Text style={styles.shareBtnText}>Share address</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.addressBox}>
              <Text style={styles.addressLabel}>Address</Text>
              <Text style={styles.addressText} selectable numberOfLines={4}>
                {depositAddress.address}
              </Text>
              <TouchableOpacity
                style={styles.copyBtn}
                onPress={() => handleCopy(depositAddress.address)}
              >
                <Icon name={copied ? 'check' : 'content-copy'} size={13} color={Colors.goldLight} />
                <Text style={styles.copyBtnText}>{copied ? 'Copied!' : 'Copy Address'}</Text>
              </TouchableOpacity>
            </View>

            {depositAddress.memo ? (
              <View style={[styles.addressBox, { marginTop: Spacing[3] }]}>
                <View style={styles.memoLabelRow}>
                  <Icon name="alert-circle-outline" size={13} color={Colors.warning} />
                  <Text style={[styles.addressLabel, styles.memoRequired]}>Memo / Tag — REQUIRED</Text>
                </View>
                <Text style={styles.addressText} selectable>
                  {depositAddress.memo}
                </Text>
                <TouchableOpacity
                  style={styles.copyBtn}
                  onPress={() => handleCopy(depositAddress.memo!)}
                >
                  <Icon name="content-copy" size={13} color={Colors.goldLight} />
                  <Text style={styles.copyBtnText}>Copy Memo</Text>
                </TouchableOpacity>
              </View>
            ) : null}

            <View style={styles.warningBox}>
              <View style={styles.warningRow}>
                <Icon
                  name="alert-circle"
                  size={16}
                  color={Colors.warning}
                  style={{ marginRight: Spacing[2], marginTop: 1 }}
                />
                <Text style={styles.warningText}>
                  Only send {selectedAsset} on network "{selectedNetwork}". Wrong asset or network can cause permanent
                  loss.
                  {depositAddress.memo ? '\n\nAlways include the Memo/Tag when sending.' : ''}
                </Text>
              </View>
            </View>

            {depositAddress.confirmations_required != null ? (
              <Text style={styles.confText}>
                {depositAddress.confirmations_required} confirmation(s) required before credit
              </Text>
            ) : null}
          </View>
        ) : null}

        {hasSupported && !addrLoading && !addrError && !depositAddress ? (
          <View style={styles.emptyCard}>
            <Icon name="wallet-outline" size={28} color={Colors.textMuted} />
            <Text style={styles.emptyTitle}>Address not available yet</Text>
            <Text style={styles.emptyBody}>
              A deposit address for{' '}
              <Text style={styles.monoStrong}>{selectedAsset}</Text> on{' '}
              <Text style={styles.monoStrong}>{selectedNetwork}</Text> could not be loaded. The provider may still be
              onboarding this pair — try another network or pull to refresh.
            </Text>
            <Button title="Retry" variant="outline" onPress={loadAddress} />
          </View>
        ) : null}

        {/* How it works — mirrors WalletPage.jsx */}
        <View style={styles.infoCard}>
          <View style={styles.infoHeader}>
            <Icon name="information-outline" size={18} color={Colors.goldLight} />
            <Text style={styles.infoTitle}>How it works</Text>
          </View>
          {[
            'Pick the asset and network you want to deposit.',
            'Scan the QR code or copy your personal deposit address.',
            'Send from your external wallet to that address.',
            'After network confirmations, your balance is credited automatically.',
          ].map((step, i) => (
            <View key={i} style={styles.howRow}>
              <View style={styles.howBadge}>
                <Text style={styles.howBadgeText}>{i + 1}</Text>
              </View>
              <Text style={styles.howText}>{step}</Text>
            </View>
          ))}
        </View>

        <View style={styles.importantCard}>
          <View style={styles.infoHeader}>
            <Icon name="alert-circle-outline" size={18} color={Colors.warning} />
            <Text style={styles.importantTitle}>Important</Text>
          </View>
          <Text style={styles.importantBullet}>• Always send on the correct network.</Text>
          <Text style={styles.importantBullet}>
            • Minimum deposit: {MIN_WALLET_NOTIONAL_USDT} USDT equivalent (platform rule).
          </Text>
          <Text style={styles.importantBullet}>• Incoming transfers appear in History as soon as they are detected.</Text>
          <Text style={[styles.importantBullet, styles.importantBulletStrong]}>
            • After sending funds, stay on this screen (or Transactions) until you see the deposit
            confirmation pop-up.
          </Text>
        </View>
      </ScrollView>

      <DepositSuccessModal
        visible={successModal.visible}
        onClose={successModal.close}
        deposit={successModal.deposit}
        onViewHistory={() => navigation.navigate('Transactions', {})}
      />
    </>
  );

  return embedded ? body : <SafeAreaWrapper>{body}</SafeAreaWrapper>;
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  content: { padding: Spacing[5], paddingBottom: Spacing[10], gap: Spacing[3] },
  contentEmbedded: {
    paddingHorizontal: WALLET_H_PAD,
    paddingTop: Spacing[1],
    paddingBottom: Spacing[10],
  },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing[6] },
  loadingHint: {
    marginTop: Spacing[3],
    fontFamily: FontFamily.regular,
    fontSize: FontSize.sm,
    color: Colors.textMuted,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing[4],
    paddingVertical: Spacing[3],
    borderBottomWidth: 1,
    borderBottomColor: Colors.surfaceBorder,
  },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  refreshIcon: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', marginLeft: 'auto' },
  pageTitle: {
    flex: 1,
    fontFamily: FontFamily.bold,
    fontSize: FontSize.xl,
    color: Colors.textPrimary,
  },
  inrPromoCard: {
    borderRadius: Radius.xl,
    borderWidth: 1,
    borderColor: Colors.goldAlpha30,
    backgroundColor: Colors.goldAlpha10,
    padding: Spacing[5],
    marginBottom: Spacing[4],
    gap: Spacing[4],
  },
  inrPromoText: { gap: Spacing[2] },
  inrPromoTitleRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: Spacing[2],
  },
  inrPromoTitle: {
    fontFamily: FontFamily.bold,
    fontSize: FontSize.base,
    color: Colors.textPrimary,
  },
  inrPromoBody: {
    fontFamily: FontFamily.regular,
    fontSize: FontSize.sm,
    color: Colors.textMuted,
    lineHeight: 20,
  },
  inrPromoActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing[2],
  },
  inrPromoPrimary: {
    paddingVertical: Spacing[2],
    paddingHorizontal: Spacing[4],
    borderRadius: Radius.lg,
    backgroundColor: Colors.gold,
  },
  inrPromoPrimaryText: {
    fontFamily: FontFamily.bold,
    fontSize: FontSize.sm,
    color: Colors.surfaceDark,
  },
  inrPromoSecondary: {
    paddingVertical: Spacing[2],
    paddingHorizontal: Spacing[4],
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
  },
  inrPromoSecondaryText: {
    fontFamily: FontFamily.bold,
    fontSize: FontSize.sm,
    color: Colors.textPrimary,
  },
  introCard: {
    backgroundColor: Colors.surfaceCard,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    borderRadius: Radius.xl,
    padding: Spacing[5],
  },
  introTitle: { fontFamily: FontFamily.bold, fontSize: FontSize.lg, color: Colors.textPrimary, marginBottom: Spacing[2] },
  introBody: {
    fontFamily: FontFamily.regular,
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    lineHeight: 20,
  },
  historyLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing[2],
    marginTop: Spacing[4],
    paddingTop: Spacing[3],
    borderTopWidth: 1,
    borderTopColor: Colors.surfaceBorder,
  },
  historyLinkText: { flex: 1, fontFamily: FontFamily.semiBold, fontSize: FontSize.sm, color: Colors.goldLight },
  stepLabel: {
    fontFamily: FontFamily.bold,
    fontSize: FontSize.xs,
    color: Colors.textMuted,
    letterSpacing: 1,
    marginBottom: Spacing[2],
  },
  loadingHintInline: {
    fontFamily: FontFamily.regular,
    fontSize: FontSize.xs,
    color: Colors.textMuted,
    marginBottom: Spacing[3],
  },
  networkHint: {
    fontFamily: FontFamily.regular,
    fontSize: FontSize.xs,
    color: Colors.textMuted,
    lineHeight: 18,
    marginBottom: Spacing[3],
  },
  kycBanner: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: Spacing[2],
    padding: Spacing[4],
    borderRadius: Radius.lg,
    borderWidth: 1,
  },
  kycPending: {
    backgroundColor: Colors.warningDim,
    borderColor: 'rgba(245,158,11,0.35)',
  },
  kycWarn: {
    backgroundColor: Colors.dangerDim,
    borderColor: 'rgba(239,68,68,0.35)',
  },
  kycText: {
    flex: 1,
    minWidth: 120,
    fontFamily: FontFamily.regular,
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    lineHeight: 20,
  },
  kycLink: { fontFamily: FontFamily.bold, fontSize: FontSize.sm, color: Colors.goldLight },
  emptyCard: {
    alignItems: 'center',
    backgroundColor: Colors.surfaceCard,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    borderRadius: Radius.xl,
    padding: Spacing[6],
    gap: Spacing[2],
  },
  emptyTitle: { fontFamily: FontFamily.semiBold, fontSize: FontSize.base, color: Colors.textPrimary },
  emptyBody: {
    fontFamily: FontFamily.regular,
    fontSize: FontSize.sm,
    color: Colors.textMuted,
    textAlign: 'center',
    lineHeight: 20,
  },
  monoStrong: { fontFamily: FontFamily.mono, color: Colors.goldLight },
  card: {
    backgroundColor: Colors.surfaceCard,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    borderRadius: Radius.xl,
    padding: Spacing[5],
  },
  sectionLabel: {
    fontFamily: FontFamily.semiBold,
    fontSize: FontSize.xs,
    color: Colors.textMuted,
    letterSpacing: 1.2,
    marginBottom: Spacing[3],
  },
  chipRow: { marginHorizontal: -Spacing[1] },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing[2],
    paddingHorizontal: Spacing[3],
    paddingVertical: Spacing[2],
    borderRadius: Radius.full,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    backgroundColor: Colors.surfaceHover,
    marginHorizontal: Spacing[1],
  },
  chipActive: { borderColor: Colors.gold, backgroundColor: Colors.goldAlpha15 },
  chipText: { fontFamily: FontFamily.medium, fontSize: FontSize.sm, color: Colors.textSecondary },
  chipTextActive: { color: Colors.goldLight },
  comingSoonBanner: {
    marginTop: Spacing[3],
    padding: Spacing[3],
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.goldAlpha30,
    backgroundColor: Colors.goldAlpha10,
  },
  comingSoonText: {
    fontFamily: FontFamily.regular,
    fontSize: FontSize.xs,
    color: Colors.goldLight,
    lineHeight: 18,
  },
  addrLoading: { paddingVertical: Spacing[8], alignItems: 'center' },
  addrHeadline: {
    fontFamily: FontFamily.bold,
    fontSize: FontSize.sm,
    color: Colors.goldLight,
    marginBottom: Spacing[3],
  },
  qrBox: { alignItems: 'center', marginBottom: Spacing[5], gap: Spacing[3] },
  qrWrapper: {
    padding: 16,
    backgroundColor: '#FFFFFF',
    borderRadius: Radius.lg,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 4,
  },
  shareBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing[2],
    paddingHorizontal: Spacing[4],
    paddingVertical: Spacing[2],
    borderRadius: Radius.full,
    borderWidth: 1,
    borderColor: Colors.goldAlpha30,
    backgroundColor: Colors.goldAlpha10,
  },
  shareBtnText: { fontFamily: FontFamily.medium, fontSize: FontSize.xs, color: Colors.goldLight },
  memoLabelRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 6 },
  memoRequired: { color: Colors.warning, marginLeft: 4, marginBottom: 0 },
  addressBox: {
    backgroundColor: Colors.surfaceHover,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    padding: Spacing[4],
  },
  addressLabel: { fontFamily: FontFamily.medium, fontSize: FontSize.xs, color: Colors.textMuted, marginBottom: 6 },
  addressText: { fontFamily: FontFamily.mono, fontSize: FontSize.sm, color: Colors.textPrimary, lineHeight: 20 },
  copyBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing[2],
    alignSelf: 'flex-start',
    marginTop: Spacing[3],
    paddingHorizontal: Spacing[3],
    paddingVertical: Spacing[1],
    backgroundColor: Colors.goldAlpha15,
    borderWidth: 1,
    borderColor: Colors.goldAlpha30,
    borderRadius: Radius.md,
  },
  copyBtnText: { fontFamily: FontFamily.medium, fontSize: FontSize.xs, color: Colors.goldLight },
  warningBox: {
    backgroundColor: Colors.warningDim,
    borderWidth: 1,
    borderColor: Colors.warning + '40',
    borderRadius: Radius.md,
    padding: Spacing[4],
    marginTop: Spacing[4],
  },
  warningRow: { flexDirection: 'row', alignItems: 'flex-start' },
  warningText: {
    flex: 1,
    fontFamily: FontFamily.regular,
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    lineHeight: 20,
  },
  confText: { fontFamily: FontFamily.regular, fontSize: FontSize.xs, color: Colors.textMuted, marginTop: Spacing[3] },
  infoCard: {
    backgroundColor: Colors.surfaceCard,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    borderRadius: Radius.xl,
    padding: Spacing[5],
    gap: Spacing[3],
  },
  infoHeader: { flexDirection: 'row', alignItems: 'center', gap: Spacing[2] },
  infoTitle: { fontFamily: FontFamily.bold, fontSize: FontSize.base, color: Colors.textPrimary },
  howRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing[3] },
  howBadge: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: Colors.goldAlpha15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  howBadgeText: { fontFamily: FontFamily.bold, fontSize: FontSize.xs, color: Colors.goldLight },
  howText: {
    flex: 1,
    fontFamily: FontFamily.regular,
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    lineHeight: 20,
    paddingTop: 2,
  },
  importantCard: {
    backgroundColor: Colors.warningDim,
    borderWidth: 1,
    borderColor: 'rgba(245,158,11,0.25)',
    borderRadius: Radius.xl,
    padding: Spacing[5],
    gap: Spacing[2],
    marginBottom: Spacing[4],
  },
  importantTitle: { fontFamily: FontFamily.bold, fontSize: FontSize.sm, color: Colors.warning },
  importantBullet: { fontFamily: FontFamily.regular, fontSize: FontSize.sm, color: Colors.textSecondary, lineHeight: 20 },
  importantBulletStrong: { fontFamily: FontFamily.semiBold, color: Colors.textPrimary },
  modeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing[2], marginBottom: Spacing[1] },
  modeChip: {
    paddingHorizontal: Spacing[3],
    paddingVertical: Spacing[2],
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    backgroundColor: Colors.surfaceCard,
  },
  modeChipActive: {
    borderColor: Colors.goldAlpha30,
    backgroundColor: Colors.goldAlpha15,
  },
  modeChipText: { fontFamily: FontFamily.semiBold, fontSize: FontSize.xs, color: Colors.textMuted },
  modeChipTextActive: { color: Colors.goldLight },
  universalBanner: {
    marginTop: Spacing[3],
    padding: Spacing[3],
    borderRadius: Radius.md,
    backgroundColor: 'rgba(56,189,248,0.1)',
    borderWidth: 1,
    borderColor: 'rgba(56,189,248,0.25)',
  },
  universalBannerText: {
    fontFamily: FontFamily.regular,
    fontSize: FontSize.xs,
    color: Colors.textSecondary,
    lineHeight: 18,
  },
  universalAsset: { fontFamily: FontFamily.bold, color: Colors.goldLight },

  // Deposit monitor banner
  monitorBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing[2],
    paddingHorizontal: Spacing[4],
    paddingVertical: Spacing[3],
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    backgroundColor: Colors.surfaceCard,
  },
  monitorBannerActive: {
    borderColor: 'rgba(34,197,94,0.25)',
    backgroundColor: 'rgba(34,197,94,0.08)',
  },
  monitorDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#22c55e',
    marginTop: 4,
  },
  monitorTextCol: { flex: 1, gap: 2 },
  monitorBannerTitle: {
    fontFamily: FontFamily.semiBold,
    fontSize: FontSize.xs,
    color: '#86efac',
  },
  monitorBannerSubtext: {
    fontFamily: FontFamily.regular,
    fontSize: FontSize.xs,
    color: Colors.textMuted,
    lineHeight: 16,
    marginTop: 1,
  },
  monitorBannerText: {
    fontFamily: FontFamily.semiBold,
    fontSize: FontSize.xs,
    color: Colors.textSecondary,
    flex: 1,
  },
});
