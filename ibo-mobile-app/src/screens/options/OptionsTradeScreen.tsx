import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TextInput,
  TouchableOpacity, Alert, Modal, SafeAreaView, RefreshControl,
} from 'react-native';
import { RouteProp, useNavigation } from '@react-navigation/native';
import { useSelector } from 'react-redux';
import { FuturesStackParamList } from '../../navigation/types';
import { optionsApi, OptionsContractRow, OptionsOrderRow, OptionsPositionRow, OptionsTradeRow, mergeChainWsUpdate, applyTickerWsUpdate, optionsContractLabel, normalizePosition, normalizeOrder, normalizeTrade } from '../../api/options.api';
import { parseApiError } from '../../api/errors';
import { toExchangeSymbol } from '../../utils/tradeSymbols';
import { subscribeOptionsAccount, subscribeOptionsChain, subscribeOptionsTicker } from '../../services/optionsWs.service';
import { RootState } from '../../store';
import Icon from '@/components/common/AppIcon';
import SafeAreaWrapper from '../../components/common/SafeAreaWrapper';
import TradeMarketHeader from '../../components/trading/TradeMarketHeader';
import TradingViewWidget from '../../components/trading/TradingViewWidget';
import { toTradingViewSymbol } from '../../utils/tradeSymbols';
import StatusBadge from '../../components/common/StatusBadge';
import Button from '../../components/common/Button';
import Input from '../../components/common/Input';
import ErrorBanner from '../../components/common/ErrorBanner';
import { Colors, FontFamily, FontSize, Spacing, Radius } from '../../theme';
import { formatPrice, formatAmount, formatDateTime, formatPercent, isPositive } from '../../utils/formatters';
import {
  effectiveKycStatus,
  isKycApproved,
  isKycPendingReview,
} from '../../utils/kycGate';
import { navigateToKycFlowFromRoot } from '../../utils/kycNavigation';
import { iosManualKeyboardScrollProps } from '@/utils/iosKeyboardScroll';

type Props = {
  route: RouteProp<FuturesStackParamList, 'DerivativesPair'>;
};

interface OptionsContract extends OptionsContractRow {}

type OptionsPosition = OptionsPositionRow;
type OptionsOrder = OptionsOrderRow;

type TabKey = 'chain' | 'positions' | 'orders' | 'history' | 'trades' | 'portfolio';
type ChainTypeFilter = 'all' | 'call' | 'put';

function formatExpiryLabel(iso: string): string {
  const t = Date.parse(String(iso).replace('Z', '+00:00'));
  if (!Number.isFinite(t)) return iso;
  return new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

function daysToExpiry(iso: string): string {
  const t = Date.parse(String(iso).replace('Z', '+00:00'));
  if (!Number.isFinite(t)) return '';
  const d = Math.ceil((t - Date.now()) / 86400000);
  if (d < 0) return 'Expired';
  if (d === 0) return 'Today';
  if (d === 1) return '1d';
  return `${d}d`;
}

type StrikeRow = { strike: number; call: OptionsContract | null; put: OptionsContract | null };

function buildStrikeRows(contracts: OptionsContract[], expiry: string): StrikeRow[] {
  const map = new Map<number, StrikeRow>();
  for (const c of contracts) {
    if (c.expiry !== expiry) continue;
    const row = map.get(c.strike) ?? { strike: c.strike, call: null, put: null };
    if (c.option_type === 'call') row.call = c;
    else row.put = c;
    map.set(c.strike, row);
  }
  return [...map.values()].sort((a, b) => a.strike - b.strike);
}

export default function OptionsTradeScreen({ route }: Props) {
  const underlying = toExchangeSymbol(route.params.symbol);
  const navigation = useNavigation<any>();
  const scrollRef = useRef<ScrollView>(null);
  const { user, kyc, kycMode } = useSelector((s: RootState) => s.auth);
  const kycStatus = effectiveKycStatus(kyc, user);
  const kycPending = Boolean(user && isKycPendingReview(kycStatus));
  const kycRequired = Boolean(user && !isKycApproved(kycStatus) && !kycPending);
  const kycBlocked = Boolean(user && !isKycApproved(kycStatus));

  const [chartOpen, setChartOpen] = useState(false);
  const [contracts, setContracts] = useState<OptionsContract[]>([]);
  const [positions, setPositions] = useState<OptionsPosition[]>([]);
  const [orders,    setOrders]    = useState<OptionsOrder[]>([]);
  const [history,   setHistory]   = useState<OptionsOrderRow[]>([]);
  const [myTrades,  setMyTrades]  = useState<OptionsTradeRow[]>([]);
  const [wallet,    setWallet]    = useState<any>(null);
  const [portfolio, setPortfolio] = useState<any>(null);
  const [contractTicker, setContractTicker] = useState<any>(null);
  const [usingDemoChain, setUsingDemoChain] = useState(false);
  const [chainLoading, setChainLoading] = useState(true);
  const [refPrice, setRefPrice] = useState(0);
  const [changePct, setChangePct] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [tab, setTab] = useState<TabKey>('chain');
  const [selectedExpiry, setSelectedExpiry] = useState('');
  const [selectedContract, setSelectedContract] = useState<OptionsContract | null>(null);
  const [orderSide, setOrderSide] = useState<'buy' | 'sell'>('buy');
  const [orderSize, setOrderSize] = useState('');
  const [orderPrice, setOrderPrice] = useState('');
  const [orderLoading, setOrderLoading] = useState(false);
  const [banner, setBanner] = useState('');
  const [bannerType, setBannerType] = useState<'error' | 'success'>('error');
  const [showTransfer, setShowTransfer] = useState(false);
  const [transferDir, setTransferDir] = useState<'spot_to_options' | 'options_to_spot'>('spot_to_options');
  const [transferAmt, setTransferAmt] = useState('');
  const [transferLoading, setTransferLoading] = useState(false);
  const [tradeSheetOpen, setTradeSheetOpen] = useState(false);
  const [chainTypeFilter, setChainTypeFilter] = useState<ChainTypeFilter>('all');

  const accountLoadedRef = useRef(false);
  const selectedContractIdRef = useRef<string | null>(null);

  const loadChain = useCallback(async () => {
    const safeGet = async (fn: () => Promise<any>) => {
      try { return await fn(); } catch { return null; }
    };

    setChainLoading(true);

    const [contractsRes, indexRes] = await Promise.all([
      safeGet(() => optionsApi.getContracts(underlying)),
      safeGet(() => optionsApi.getIndexPrice(underlying)),
    ]);

    const fastChain: OptionsContract[] = contractsRes?.data?.length ? contractsRes.data : [];
    if (fastChain.length) {
      setContracts(fastChain);
      setUsingDemoChain(fastChain.some(c => c.demo_contract));
      setChainLoading(false);
    }

    const idx = indexRes?.data as any;
    const px = Number(idx?.price ?? idx?.index_price ?? 0);
    if (px > 0) setRefPrice(px);

    const chainRes = await safeGet(() => optionsApi.getChain(underlying, true));
    if (chainRes?.data?.length) {
      setContracts(chainRes.data);
      setUsingDemoChain(chainRes.data.some((c: OptionsContract) => c.demo_contract));
    }
    setChainLoading(false);
  }, [underlying]);

  const loadAccount = useCallback(async () => {
    if (!user) return;
    const safeGet = async (fn: () => Promise<any>) => {
      try { return await fn(); } catch { return null; }
    };

    const [ordRes, histRes, tradesRes, portRes] = await Promise.all([
      safeGet(() => optionsApi.getOpenOrders()),
      safeGet(() => optionsApi.getOrderHistory()),
      safeGet(() => optionsApi.getMyTrades()),
      safeGet(() => optionsApi.getPortfolio()),
    ]);
    if (ordRes)    setOrders(Array.isArray(ordRes.data)       ? ordRes.data    : []);
    if (histRes)   setHistory(Array.isArray(histRes.data)     ? histRes.data   : []);
    if (tradesRes) setMyTrades(Array.isArray(tradesRes.data)  ? tradesRes.data : []);
    if (portRes?.data) {
      setPortfolio(portRes.data);
      setWallet(portRes.data.wallet ?? null);
      if (Array.isArray(portRes.data.positions)) {
        setPositions(portRes.data.positions);
      }
    }
    accountLoadedRef.current = true;
  }, [user]);

  const load = useCallback(async () => {
    await loadChain();
    if (user) await loadAccount();
  }, [loadChain, loadAccount, user]);

  useEffect(() => {
    void loadChain();
  }, [loadChain]);

  useEffect(() => {
    selectedContractIdRef.current = selectedContract?.contract_id ?? null;
  }, [selectedContract?.contract_id]);

  useEffect(() => {
    const id = selectedContractIdRef.current;
    if (!id) return;
    const fresh = contracts.find(c => c.contract_id === id);
    if (fresh) setSelectedContract(fresh);
  }, [contracts]);

  useEffect(() => {
    if (usingDemoChain) return undefined;
    const unsub = subscribeOptionsChain(underlying, (raw) => {
      const msg = raw as Record<string, any>;
      if (msg?.type !== 'options_chain') return;
      if (String(msg.underlying_symbol || '').toUpperCase() !== underlying.toUpperCase()) return;
      const idx = Number(msg.index_price);
      if (Number.isFinite(idx) && idx > 0) setRefPrice(idx);
      setContracts(prev => mergeChainWsUpdate(prev, msg));
    });
    return unsub;
  }, [underlying, usingDemoChain]);

  useEffect(() => {
    if (!user || usingDemoChain) return undefined;
    let unsub: (() => void) | undefined;
    let cancelled = false;
    void subscribeOptionsAccount((raw) => {
      const msg = raw as Record<string, any>;
      if (msg?.type !== 'options_account') return;
      if (msg.wallet) setWallet(msg.wallet);
      if (msg.portfolio) setPortfolio(msg.portfolio);
      if (Array.isArray(msg.positions)) {
        setPositions(msg.positions.map((p: Record<string, any>) => normalizePosition(p)));
      }
      if (Array.isArray(msg.open_orders)) {
        setOrders(msg.open_orders.map((o: Record<string, any>) => normalizeOrder(o)));
      }
      if (Array.isArray(msg.order_history)) {
        setHistory(msg.order_history.map((o: Record<string, any>) => normalizeOrder(o)));
      }
      if (Array.isArray(msg.user_trades)) {
        setMyTrades(msg.user_trades.map((t: Record<string, any>) => normalizeTrade(t)));
      }
    }).then((fn) => {
      if (cancelled) fn();
      else unsub = fn;
    });
    return () => {
      cancelled = true;
      unsub?.();
    };
  }, [user, usingDemoChain]);

  useEffect(() => {
    const cid = selectedContract?.contract_id;
    if (!cid || usingDemoChain) return undefined;
    const unsub = subscribeOptionsTicker(cid, (raw) => {
      const msg = raw as Record<string, any>;
      if (msg?.type !== 'options_ticker') return;
      if (msg.contract_id !== cid) return;
      const tick = msg.ticker as Record<string, any> | undefined;
      setContractTicker(tick ?? null);
      setContracts(prev => applyTickerWsUpdate(prev, cid, tick));
    });
    return unsub;
  }, [selectedContract?.contract_id, usingDemoChain]);

  useEffect(() => {
    if (!user) {
      accountLoadedRef.current = false;
      return;
    }
    if (accountLoadedRef.current) return;
    void loadAccount();
  }, [user, loadAccount]);

  const onOptionsRefresh = useCallback(async () => {
    setRefreshing(true);
    accountLoadedRef.current = false;
    try {
      await loadChain();
      if (user) await loadAccount();
    } finally {
      setRefreshing(false);
    }
  }, [loadChain, loadAccount, user]);

  const expiries = useMemo(() => {
    const set = new Set(contracts.map(c => c.expiry).filter(Boolean));
    return [...set].sort();
  }, [contracts]);

  useEffect(() => {
    if (expiries.length && !selectedExpiry) setSelectedExpiry(expiries[0]);
  }, [expiries, selectedExpiry]);

  const strikeRows = useMemo(
    () => (selectedExpiry ? buildStrikeRows(contracts, selectedExpiry) : []),
    [contracts, selectedExpiry],
  );

  const atmStrike = useMemo(() => {
    if (!refPrice || !strikeRows.length) return null;
    return strikeRows.reduce((best, row) =>
      Math.abs(row.strike - refPrice) < Math.abs(best.strike - refPrice) ? row : best,
    ).strike;
  }, [strikeRows, refPrice]);

  const handleSelectContract = (c: OptionsContract | null, sideHint?: 'buy' | 'sell') => {
    setSelectedContract(prev => {
      const next = prev?.contract_id === c?.contract_id ? null : c;
      if (next) {
        if (sideHint) setOrderSide(sideHint);
        const side = sideHint ?? orderSide;
        const px = next.mark_price ?? (side === 'buy' ? next.ask : next.bid) ?? 0;
        if (px > 0) setOrderPrice(String(px));
        optionsApi.getTicker(next.contract_id)
          .then(res => setContractTicker((res as any).data ?? null))
          .catch(() => {});
        setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 80);
        setTradeSheetOpen(true);
      } else {
        setOrderPrice('');
        setContractTicker(null);
        setTradeSheetOpen(false);
      }
      return next;
    });
  };

  const handleCancelOrder = async (orderId: string) => {
    Alert.alert(
      'Cancel Order',
      'Are you sure you want to cancel this options order?',
      [
        { text: 'No', style: 'cancel' },
        {
          text: 'Yes, Cancel',
          style: 'destructive',
          onPress: async () => {
            try {
              await optionsApi.cancelOrder(orderId);
              setOrders(prev => prev.filter(o => o.order_id !== orderId));
            } catch (err) {
              setBannerType('error');
              setBanner(parseApiError(err).message);
            }
          },
        },
      ],
    );
  };

  const handleTransfer = async () => {
    const amt = parseFloat(transferAmt);
    if (!transferAmt || isNaN(amt) || amt <= 0) return;
    setTransferLoading(true);
    try {
      await optionsApi.transfer({ direction: transferDir, amount: amt });
      setShowTransfer(false);
      setTransferAmt('');
      load();
    } catch (err) {
      setBannerType('error');
      setBanner('Transfer failed');
    } finally {
      setTransferLoading(false);
    }
  };

  const handlePlaceOrder = async () => {
    if (!selectedContract) return;
    if (usingDemoChain || selectedContract.demo_contract) {
      setBannerType('error');
      setBanner('Demo contracts are view-only — select a listed contract to trade');
      return;
    }
    const size = parseFloat(orderSize);
    const price = parseFloat(orderPrice);
    if (!orderSize || isNaN(size) || size <= 0) {
      setBannerType('error');
      setBanner('Enter a valid size');
      return;
    }
    if (!orderPrice || isNaN(price) || price <= 0) {
      setBannerType('error');
      setBanner('Enter a valid premium price');
      return;
    }
    setOrderLoading(true);
    setBanner('');
    try {
      await optionsApi.placeOrder({
        contract_id: selectedContract.contract_id,
        side: orderSide,
        quantity: size,
        price,
      });
      setBannerType('success');
      setBanner('Options order placed!');
      setOrderSize('');
      setOrderPrice('');
      setSelectedContract(null);
      setTradeSheetOpen(false);
      load();
    } catch (err) {
      setBannerType('error');
      setBanner(parseApiError(err).message);
    } finally {
      setOrderLoading(false);
    }
  };

  const contractLabel = useCallback(
    (contractId: string, contract?: Record<string, any>) =>
      optionsContractLabel(contractId, contracts, contract),
    [contracts],
  );

  const headerStats = [
    { label: 'Index', value: refPrice > 0 ? formatPrice(refPrice) : '—' },
    { label: 'Change', value: formatPercent(changePct), valueColor: isPositive(changePct) ? Colors.buyGreen : Colors.sellRed },
    { label: 'Contracts', value: String(contracts.length) },
    { label: 'Expiries', value: String(expiries.length) },
  ];

  const TABS: { key: TabKey; label: string }[] = [
    { key: 'chain',     label: 'Chain' },
    { key: 'positions', label: `Pos${positions.length > 0 ? ` (${positions.length})` : ''}` },
    { key: 'orders',    label: `Orders${orders.length > 0 ? ` (${orders.length})` : ''}` },
    { key: 'history',   label: 'History' },
    { key: 'trades',    label: 'Trades' },
    { key: 'portfolio', label: 'Portfolio' },
  ];

  return (
    <SafeAreaWrapper>
      <TradeMarketHeader
        symbol={underlying}
        price={refPrice > 0 ? refPrice : undefined}
        changePct={changePct}
        stats={headerStats}
        tag="OPTIONS"
        mode="derivatives"
        onChartPress={() => setChartOpen(true)}
      />

      <View style={styles.tabBar}>
        {TABS.map(t => (
          <TouchableOpacity key={t.key} style={[styles.tabBtn, tab === t.key && styles.tabBtnActive]} onPress={() => setTab(t.key)}>
            <Text style={[styles.tabBtnText, tab === t.key && styles.tabBtnTextActive]}>{t.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <View style={styles.body}>
      <ScrollView
          ref={scrollRef}
          style={styles.scroll}
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onOptionsRefresh} tintColor={Colors.gold} />
          }
          {...iosManualKeyboardScrollProps()}
        >
          <ErrorBanner message={banner} type={bannerType} />

          {tab === 'chain' && (
            <>
              <TradingViewWidget
                symbol={underlying}
                market="options"
                mini
                onExpand={() => setChartOpen(true)}
              />

              {/* Expiry tabs from live chain data */}
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.expiryRow}>
                {expiries.map(exp => (
                  <TouchableOpacity
                    key={exp}
                    style={[styles.expiryChip, selectedExpiry === exp && styles.expiryChipActive]}
                    onPress={() => { setSelectedExpiry(exp); setSelectedContract(null); }}
                  >
                    <Text style={[styles.expiryChipText, selectedExpiry === exp && styles.expiryChipTextActive]}>
                      {formatExpiryLabel(exp)}
                    </Text>
                    <Text style={styles.expirySub}>{daysToExpiry(exp)}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>

              <View style={styles.typeFilterRow}>
                {([
                  { key: 'all' as ChainTypeFilter, label: 'All' },
                  { key: 'call' as ChainTypeFilter, label: 'Calls' },
                  { key: 'put' as ChainTypeFilter, label: 'Puts' },
                ]).map(opt => (
                  <TouchableOpacity
                    key={opt.key}
                    style={[styles.typeFilterChip, chainTypeFilter === opt.key && styles.typeFilterChipActive]}
                    onPress={() => setChainTypeFilter(opt.key)}
                  >
                    <Text style={[styles.typeFilterText, chainTypeFilter === opt.key && styles.typeFilterTextActive]}>
                      {opt.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              {selectedExpiry && (
                <View style={styles.expiryBanner}>
                  <Text style={styles.expiryBannerTitle}>{formatExpiryLabel(selectedExpiry)}</Text>
                  <Text style={styles.expiryBannerSub}>
                    {underlying} · Ref {refPrice > 0 ? formatPrice(refPrice) : '—'} · {daysToExpiry(selectedExpiry)} to expiry
                  </Text>
                </View>
              )}

              {/* Chain matrix header */}
              <View style={styles.matrixHeader}>
                {(chainTypeFilter === 'all' || chainTypeFilter === 'call') && (
                  <>
                    <Text style={[styles.matrixHead, styles.callCol]}>Call Bid</Text>
                    <Text style={[styles.matrixHead, styles.callCol, styles.right]}>Call Ask</Text>
                  </>
                )}
                <Text style={[styles.matrixHead, styles.strikeCol]}>Strike</Text>
                {(chainTypeFilter === 'all' || chainTypeFilter === 'put') && (
                  <>
                    <Text style={[styles.matrixHead, styles.putCol, styles.right]}>Put Bid</Text>
                    <Text style={[styles.matrixHead, styles.putCol, styles.right]}>Put Ask</Text>
                  </>
                )}
              </View>

              {chainLoading && contracts.length === 0 ? (
                <View style={styles.empty}>
                  <Text style={styles.emptyText}>Loading options chain…</Text>
                </View>
              ) : strikeRows.length === 0 ? (
                <View style={styles.empty}>
                  <Text style={styles.emptyText}>
                    {contracts.length === 0
                      ? 'Contracts syncing — pull to refresh in a moment'
                      : 'No contracts for this expiry'}
                  </Text>
                </View>
              ) : (
                strikeRows.map(row => {
                  const isAtm = atmStrike != null && row.strike === atmStrike;
                  return (
                    <View key={row.strike} style={[styles.matrixRow, isAtm && styles.matrixRowAtm]}>
                      {(chainTypeFilter === 'all' || chainTypeFilter === 'call') && (
                        <>
                          <TouchableOpacity style={styles.callCol} onPress={() => row.call && handleSelectContract(row.call, 'sell')}>
                            <Text style={[styles.cellBid, row.call && selectedContract?.contract_id === row.call.contract_id && styles.cellSelected]}>
                              {row.call?.bid ? formatPrice(row.call.bid) : '—'}
                            </Text>
                          </TouchableOpacity>
                          <TouchableOpacity style={[styles.callCol, styles.rightCell]} onPress={() => row.call && handleSelectContract(row.call, 'buy')}>
                            <Text style={[styles.cellAsk, styles.right]}>{row.call?.ask ? formatPrice(row.call.ask) : '—'}</Text>
                          </TouchableOpacity>
                        </>
                      )}
                      <View style={styles.strikeCol}>
                        <Text style={[styles.strikeText, isAtm && styles.strikeAtm]}>{formatPrice(row.strike)}</Text>
                        {isAtm && <Text style={styles.atmTag}>ATM</Text>}
                      </View>
                      {(chainTypeFilter === 'all' || chainTypeFilter === 'put') && (
                        <>
                          <TouchableOpacity style={[styles.putCol, styles.rightCell]} onPress={() => row.put && handleSelectContract(row.put, 'sell')}>
                            <Text style={[styles.cellBid, styles.right, row.put && selectedContract?.contract_id === row.put.contract_id && styles.cellSelected]}>
                              {row.put?.bid ? formatPrice(row.put.bid) : '—'}
                            </Text>
                          </TouchableOpacity>
                          <TouchableOpacity style={[styles.putCol, styles.rightCell]} onPress={() => row.put && handleSelectContract(row.put, 'buy')}>
                            <Text style={[styles.cellAsk, styles.right]}>{row.put?.ask ? formatPrice(row.put.ask) : '—'}</Text>
                          </TouchableOpacity>
                        </>
                      )}
                    </View>
                  );
                })
              )}

              {selectedContract && (
                <View style={styles.ticketCard}>
                  <Text style={styles.ticketTitle}>Order Ticket</Text>
                  <Text style={styles.ticketSub}>
                    {selectedContract.underlying} {formatPrice(selectedContract.strike)}{' '}
                    {selectedContract.option_type.toUpperCase()} · exp {formatExpiryLabel(selectedContract.expiry)}
                  </Text>

                  <View style={styles.greeksRow}>
                    <GreekItem label="Mark" value={contractTicker?.mark_price ? formatPrice(contractTicker.mark_price) : (selectedContract.mark_price ? formatPrice(selectedContract.mark_price) : '—')} />
                    <GreekItem label="IV" value={contractTicker?.iv ? `${(contractTicker.iv * 100).toFixed(1)}%` : (selectedContract.iv ? `${(selectedContract.iv * 100).toFixed(1)}%` : '—')} />
                    <GreekItem label="Δ Delta" value={contractTicker?.delta?.toFixed(3) ?? selectedContract.delta?.toFixed(3) ?? '—'} />
                    <GreekItem label="OI" value={contractTicker?.open_interest != null ? String(contractTicker.open_interest) : (selectedContract.open_interest != null ? String(selectedContract.open_interest) : '—')} />
                  </View>
                  <View style={styles.greeksRow}>
                    <GreekItem label="Γ Gamma" value={contractTicker?.gamma?.toFixed(5) ?? '—'} />
                    <GreekItem label="Θ Theta" value={contractTicker?.theta?.toFixed(4) ?? '—'} />
                    <GreekItem label="V Vega" value={contractTicker?.vega?.toFixed(4) ?? '—'} />
                    <GreekItem label="ρ Rho" value={contractTicker?.rho?.toFixed(4) ?? '—'} />
                  </View>

                  <View style={styles.sideToggle}>
                    <TouchableOpacity style={[styles.sideBtn, orderSide === 'buy' && styles.sideBtnBuy]} onPress={() => setOrderSide('buy')}>
                      <Text style={[styles.sideBtnText, orderSide === 'buy' && styles.sideBtnTextBuy]}>BUY</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={[styles.sideBtn, orderSide === 'sell' && styles.sideBtnSell]} onPress={() => setOrderSide('sell')}>
                      <Text style={[styles.sideBtnText, orderSide === 'sell' && styles.sideBtnTextSell]}>SELL</Text>
                    </TouchableOpacity>
                  </View>

                  <Input label="Premium (USDT)" placeholder="0.00" value={orderPrice} onChangeText={setOrderPrice} keyboardType="numeric" />
                  <Input label="Size (contracts)" placeholder="1" value={orderSize} onChangeText={setOrderSize} keyboardType="numeric" />

                  {kycPending && (
                    <TouchableOpacity
                      style={styles.kycBanner}
                      onPress={() => navigation.navigate('Profile', { screen: 'KYCStatus' })}
                      activeOpacity={0.8}
                    >
                      <Icon name="clock" size={14} color={Colors.warning} />
                      <View style={{ flex: 1, marginLeft: Spacing[2] }}>
                        <Text style={[styles.kycTitle, { color: Colors.warning }]}>KYC Under Review</Text>
                        <Text style={styles.kycBody}>Options trading will be enabled once your documents are approved.</Text>
                      </View>
                    </TouchableOpacity>
                  )}
                  {kycRequired && !kycPending && (
                    <TouchableOpacity
                      style={[styles.kycBanner, { backgroundColor: Colors.dangerDim, borderColor: Colors.dangerDim }]}
                      onPress={() => navigateToKycFlowFromRoot(navigation, kycMode, kycStatus)}
                      activeOpacity={0.8}
                    >
                      <Icon name="shield" size={14} color={Colors.danger} />
                      <View style={{ flex: 1, marginLeft: Spacing[2] }}>
                        <Text style={[styles.kycTitle, { color: Colors.danger }]}>KYC Verification Required</Text>
                        <Text style={styles.kycBody}>Complete identity verification to trade options. Tap to begin.</Text>
                      </View>
                    </TouchableOpacity>
                  )}

                  <Button
                    title={`${orderSide.toUpperCase()} ${selectedContract.option_type.toUpperCase()}`}
                    variant={orderSide === 'buy' ? 'buy' : 'sell'}
                    onPress={handlePlaceOrder}
                    loading={orderLoading}
                    disabled={kycBlocked}
                    fullWidth
                  />
                </View>
              )}
            </>
          )}

          {tab === 'positions' && (
            positions.length === 0 ? (
              <View style={styles.empty}>
                <Text style={styles.emptyText}>No open options positions</Text>
              </View>
            ) : (
              positions.map(pos => {
                const lbl = contractLabel(pos.contract_id, pos.contract);
                return (
                <View key={pos.position_id || pos.id} style={styles.posCard}>
                  <View style={styles.posTop}>
                    <View style={{ flex: 1, paddingRight: Spacing[2] }}>
                      <Text style={styles.posSymbol}>{lbl.main}</Text>
                      <Text style={styles.posMetaText}>{lbl.sub}</Text>
                    </View>
                    <Text style={[styles.posPnl, { color: (pos.unrealized_pnl ?? 0) >= 0 ? Colors.buyGreen : Colors.sellRed }]}>
                      {pos.unrealized_pnl != null ? formatPrice(pos.unrealized_pnl) : '—'}
                    </Text>
                  </View>
                  <Text style={styles.posMetaText}>
                    LONG · Qty {pos.qty} · Entry {formatPrice(pos.avg_premium)}
                    {pos.mark_price != null ? ` · Mark ${formatPrice(pos.mark_price)}` : ''}
                  </Text>
                  <StatusBadge status={pos.status} />
                </View>
              );})
            )
          )}

          {tab === 'orders' && (
            orders.length === 0 ? (
              <View style={styles.empty}>
                <Text style={styles.emptyText}>No open options orders</Text>
              </View>
            ) : (
              orders.map(o => {
                const lbl = contractLabel(o.contract_id);
                return (
                <View key={o.order_id} style={styles.orderCard}>
                  <View style={styles.posTop}>
                    <Text style={[styles.orderSide, { color: o.side === 'buy' ? Colors.buyGreen : Colors.sellRed }]}>
                      {o.side.toUpperCase()}
                    </Text>
                    <StatusBadge status={o.status} />
                    {(o.status === 'open' || o.status === 'partially_filled') && (
                      <TouchableOpacity
                        style={styles.cancelOrderBtn}
                        onPress={() => handleCancelOrder(o.order_id)}
                        activeOpacity={0.7}
                      >
                        <Text style={styles.cancelOrderTxt}>Cancel</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                  <Text style={styles.posSymbol}>{lbl.main}</Text>
                  <Text style={styles.posMetaText}>
                    Qty {o.quantity} · Rem {o.remaining} · {o.price ? formatPrice(o.price) : 'Market'}
                  </Text>
                  <Text style={styles.orderDate}>{formatDateTime(o.created_at)}</Text>
                </View>
              );})
            )
          )}

          {/* ── Order History tab ── */}
          {tab === 'history' && (
            history.length === 0 ? (
              <View style={styles.empty}>
                <Text style={styles.emptyText}>No order history yet</Text>
              </View>
            ) : (
              history.map((o, i) => {
                const isBuy  = o.side === 'buy';
                const filled = o.filled;
                const total  = o.quantity;
                const pctFill = total > 0 ? Math.round((filled / total) * 100) : 0;
                const lbl = contractLabel(o.contract_id);
                return (
                  <View key={o.order_id ?? o.id ?? i} style={styles.orderCard}>
                    <View style={styles.posTop}>
                      <Text style={[styles.orderSide, { color: isBuy ? Colors.buyGreen : Colors.sellRed }]}>
                        {o.side?.toUpperCase()}
                      </Text>
                      <StatusBadge status={o.status} />
                    </View>
                    <Text style={styles.posSymbol}>{lbl.main}</Text>
                    <Text style={styles.posMetaText}>
                      Filled {filled} / {total} ({pctFill}%) · {o.price ? formatPrice(o.price) : 'Market'}
                    </Text>
                    <Text style={styles.orderDate}>{formatDateTime(o.created_at)}</Text>
                  </View>
                );
              })
            )
          )}

          {/* ── My Trades tab ── */}
          {tab === 'trades' && (
            myTrades.length === 0 ? (
              <View style={styles.empty}>
                <Text style={styles.emptyText}>No trades yet</Text>
              </View>
            ) : (
              myTrades.map((t, i) => {
                const isBuy  = t.side === 'buy';
                const lbl = contractLabel(t.contract_id);
                return (
                  <View key={t.trade_id ?? t.id ?? i} style={styles.orderCard}>
                    <View style={styles.posTop}>
                      <Text style={[styles.orderSide, { color: isBuy ? Colors.buyGreen : Colors.sellRed }]}>
                        {t.side?.toUpperCase()}
                      </Text>
                    </View>
                    <Text style={styles.posSymbol}>{lbl.main}</Text>
                    <Text style={styles.posMetaText}>
                      Premium {formatPrice(t.price)} · Qty {t.qty}
                    </Text>
                    <Text style={styles.orderDate}>{formatDateTime(t.created_at)}</Text>
                  </View>
                );
              })
            )
          )}

          {/* ── Portfolio tab ── */}
          {tab === 'portfolio' && (
            portfolio ? (
              <View>
                {[
                  ['Portfolio Value', `${Number(portfolio.portfolio_value ?? 0).toFixed(2)} USDT`],
                  ['Total PNL', `${Number(portfolio.total_pnl ?? 0).toFixed(4)} USDT`, Number(portfolio.total_pnl ?? 0) >= 0],
                  ['Realized PNL', `${Number(portfolio.realized_pnl ?? 0).toFixed(4)} USDT`],
                  ['Unrealized PNL', `${Number(portfolio.unrealized_pnl ?? 0).toFixed(4)} USDT`, Number(portfolio.unrealized_pnl ?? 0) >= 0],
                  ["Today's PNL", `${Number(portfolio.today_pnl ?? 0).toFixed(4)} USDT`, Number(portfolio.today_pnl ?? 0) >= 0],
                  ['Margin Used', `${Number(portfolio.margin_used ?? 0).toFixed(2)} USDT`],
                  ['Margin Available', `${Number(portfolio.margin_available ?? 0).toFixed(2)} USDT`],
                  ['Open Interest', String(Number(portfolio.open_interest ?? 0).toFixed(0)) + ' contracts'],
                ].map(([lbl, val, isGreen]) => (
                  <View key={String(lbl)} style={styles.portRow}>
                    <Text style={styles.portLabel}>{lbl}</Text>
                    <Text style={[styles.portVal, isGreen !== undefined ? { color: isGreen ? Colors.buyGreen : Colors.sellRed } : {}]}>
                      {val}
                    </Text>
                  </View>
                ))}
              </View>
            ) : (
              <View style={styles.empty}>
                <Text style={styles.emptyText}>Portfolio data unavailable. Sign in to view.</Text>
              </View>
            )
          )}

          {/* Wallet strip */}
          {wallet && (
            <View style={styles.walletStrip}>
              <View style={styles.walletStripRow}>
                <Text style={styles.walletStripLabel}>Options Wallet</Text>
                <TouchableOpacity style={styles.transferTrigger} onPress={() => setShowTransfer(true)}>
                  <Text style={styles.transferTriggerTxt}>Transfer</Text>
                </TouchableOpacity>
              </View>
              {[
                ['Available', wallet.available ?? wallet.free ?? 0],
                ['Locked',    wallet.locked ?? wallet.used ?? 0],
                ['Balance',   wallet.balance ?? wallet.total ?? 0],
              ].map(([lbl, val]: any) => (
                <View key={lbl} style={styles.walletRow}>
                  <Text style={styles.walletLabel}>{lbl}</Text>
                  <Text style={styles.walletVal}>{Number(val).toFixed(4)} USDT</Text>
                </View>
              ))}
            </View>
          )}

          <View style={{ height: Spacing[8] }} />
        </ScrollView>

        {tab === 'chain' && selectedContract && (
          <View style={styles.stickyTradeBar}>
            <View style={styles.stickyTradeInfo}>
              <Text style={styles.stickyTradeTitle}>
                {selectedContract.option_type.toUpperCase()} · {formatPrice(selectedContract.strike)}
              </Text>
              <Text style={styles.stickyTradeSub}>
                {orderSide.toUpperCase()} · {selectedContract.mark_price ? formatPrice(selectedContract.mark_price) : 'Tap ticket to set price'}
              </Text>
            </View>
            <View style={styles.stickySideToggle}>
              <TouchableOpacity
                style={[styles.stickySideBtn, orderSide === 'buy' && styles.stickySideBtnBuy]}
                onPress={() => setOrderSide('buy')}
              >
                <Text style={[styles.stickySideBtnText, orderSide === 'buy' && styles.stickySideBtnTextBuy]}>BUY</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.stickySideBtn, orderSide === 'sell' && styles.stickySideBtnSell]}
                onPress={() => setOrderSide('sell')}
              >
                <Text style={[styles.stickySideBtnText, orderSide === 'sell' && styles.stickySideBtnTextSell]}>SELL</Text>
              </TouchableOpacity>
            </View>
            <TouchableOpacity
              style={[styles.stickySubmitBtn, orderSide === 'buy' ? styles.stickySubmitBuy : styles.stickySubmitSell]}
              onPress={() => setTradeSheetOpen(true)}
            >
              <Text style={styles.stickySubmitText}>{orderSide === 'buy' ? 'Buy' : 'Sell'}</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>

      {/* Transfer Modal */}
      {showTransfer && (
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Transfer Funds</Text>
            <View style={styles.dirRow}>
              {(['spot_to_options', 'options_to_spot'] as const).map(dir => (
                <TouchableOpacity
                  key={dir}
                  style={[styles.dirBtn, transferDir === dir && styles.dirBtnActive]}
                  onPress={() => setTransferDir(dir)}
                >
                  <Text style={[styles.dirBtnTxt, transferDir === dir && styles.dirBtnTxtActive]}>
                    {dir === 'spot_to_options' ? 'Spot → Options' : 'Options → Spot'}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            {wallet && (
              <Text style={styles.modalSub}>
                Available: {Number(wallet.available ?? 0).toFixed(4)} USDT
              </Text>
            )}
            <TextInput
              style={styles.modalInput}
              value={transferAmt}
              onChangeText={setTransferAmt}
              keyboardType="numeric"
              placeholder="Amount (USDT)"
              placeholderTextColor={Colors.textDisabled}
            />
            <View style={styles.modalBtns}>
              <TouchableOpacity
                style={[styles.modalBtn, styles.modalBtnGhost]}
                onPress={() => { setShowTransfer(false); setTransferAmt(''); }}
              >
                <Text style={styles.modalBtnGhostTxt}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalBtn, styles.modalBtnPrimary]}
                onPress={handleTransfer}
                disabled={transferLoading}
              >
                <Text style={styles.modalBtnTxt}>{transferLoading ? 'Transferring…' : 'Transfer'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      )}

      <Modal
        visible={tradeSheetOpen && !!selectedContract}
        animationType="slide"
        transparent
        onRequestClose={() => setTradeSheetOpen(false)}
      >
        <View style={styles.sheetOverlay}>
          <TouchableOpacity style={styles.sheetBackdrop} activeOpacity={1} onPress={() => setTradeSheetOpen(false)} />
          <View style={styles.sheetCard}>
            <View style={styles.sheetHeader}>
              <View style={{ flex: 1 }}>
                <Text style={styles.sheetTitle}>
                  {orderSide.toUpperCase()} {selectedContract?.option_type?.toUpperCase() ?? ''}
                </Text>
                <Text style={styles.sheetSub}>
                  {selectedContract?.underlying} {selectedContract ? formatPrice(selectedContract.strike) : ''} · exp{' '}
                  {selectedContract ? formatExpiryLabel(selectedContract.expiry) : ''}
                </Text>
              </View>
              <TouchableOpacity onPress={() => setTradeSheetOpen(false)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                <Text style={styles.sheetClose}>✕</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.sideToggle}>
              <TouchableOpacity style={[styles.sideBtn, orderSide === 'buy' && styles.sideBtnBuy]} onPress={() => setOrderSide('buy')}>
                <Text style={[styles.sideBtnText, orderSide === 'buy' && styles.sideBtnTextBuy]}>BUY</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.sideBtn, orderSide === 'sell' && styles.sideBtnSell]} onPress={() => setOrderSide('sell')}>
                <Text style={[styles.sideBtnText, orderSide === 'sell' && styles.sideBtnTextSell]}>SELL</Text>
              </TouchableOpacity>
            </View>

            <Input label="Premium (USDT)" placeholder="0.00" value={orderPrice} onChangeText={setOrderPrice} keyboardType="numeric" />
            <Input label="Size (contracts)" placeholder="1" value={orderSize} onChangeText={setOrderSize} keyboardType="numeric" />

            <Button
              title={`${orderSide.toUpperCase()} ${selectedContract?.option_type?.toUpperCase() ?? 'OPTION'}`}
              variant={orderSide === 'buy' ? 'buy' : 'sell'}
              onPress={handlePlaceOrder}
              loading={orderLoading}
              disabled={kycBlocked}
              fullWidth
            />
          </View>
        </View>
      </Modal>

      {/* Full-screen TradingView chart Modal */}
      <Modal
        visible={chartOpen}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setChartOpen(false)}
      >
        <SafeAreaView style={{ flex: 1, backgroundColor: Colors.surfaceDark }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: Spacing[4], paddingVertical: Spacing[3], borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: Colors.surfaceBorder }}>
            <Text style={{ fontFamily: FontFamily.bold, fontSize: FontSize.lg, color: Colors.textPrimary }}>
              {underlying} · OPTIONS
            </Text>
            <TouchableOpacity onPress={() => setChartOpen(false)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Text style={{ fontSize: 22, color: Colors.textSecondary }}>✕</Text>
            </TouchableOpacity>
          </View>
          <TradingViewWidget
            symbol={underlying}
            market="options"
            mini={false}
          />
        </SafeAreaView>
      </Modal>
    </SafeAreaWrapper>
  );
}

function GreekItem({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.greekItem}>
      <Text style={styles.greekLabel}>{label}</Text>
      <Text style={styles.greekValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  body: { flex: 1 },
  tabBar: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: Colors.surfaceBorder, backgroundColor: Colors.surfaceCard },
  tabBtn: { flex: 1, paddingVertical: Spacing[3], alignItems: 'center' },
  tabBtnActive: { borderBottomWidth: 2, borderBottomColor: Colors.gold },
  tabBtnText: { fontFamily: FontFamily.medium, fontSize: FontSize.xs, color: Colors.textMuted },
  tabBtnTextActive: { color: Colors.goldLight },
  scroll: { flex: 1 },
  content: { padding: Spacing[4] },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  expiryRow: { marginVertical: Spacing[3] },
  expiryChip: {
    paddingHorizontal: Spacing[3], paddingVertical: Spacing[2],
    borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceBorder,
    backgroundColor: Colors.surfaceHover, marginRight: Spacing[2], alignItems: 'center',
  },
  expiryChipActive: { borderColor: Colors.gold, backgroundColor: Colors.goldAlpha15 },
  expiryChipText: { fontFamily: FontFamily.semiBold, fontSize: FontSize.sm, color: Colors.textSecondary },
  expiryChipTextActive: { color: Colors.goldLight },
  expirySub: { fontFamily: FontFamily.regular, fontSize: 9, color: Colors.textMuted, marginTop: 2 },
  typeFilterRow: { flexDirection: 'row', gap: Spacing[2], marginBottom: Spacing[3] },
  typeFilterChip: {
    paddingHorizontal: Spacing[3],
    paddingVertical: Spacing[2],
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    backgroundColor: Colors.surfaceHover,
  },
  typeFilterChipActive: { borderColor: Colors.gold, backgroundColor: Colors.goldAlpha15 },
  typeFilterText: { fontFamily: FontFamily.semiBold, fontSize: FontSize.xs, color: Colors.textSecondary },
  typeFilterTextActive: { color: Colors.goldLight },
  expiryBanner: {
    backgroundColor: Colors.surfaceHover, borderRadius: Radius.md,
    padding: Spacing[3], marginBottom: Spacing[3],
    borderWidth: 1, borderColor: Colors.surfaceBorder,
  },
  expiryBannerTitle: { fontFamily: FontFamily.bold, fontSize: FontSize.sm, color: Colors.textPrimary },
  expiryBannerSub: { fontFamily: FontFamily.regular, fontSize: FontSize.xs, color: Colors.textMuted, marginTop: 2 },
  matrixHeader: {
    flexDirection: 'row', paddingVertical: Spacing[2], paddingHorizontal: Spacing[2],
    backgroundColor: Colors.surfaceHover, borderRadius: Radius.md, marginBottom: 2,
  },
  matrixHead: { fontFamily: FontFamily.medium, fontSize: 9, color: Colors.textMuted },
  matrixRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: Spacing[2], paddingHorizontal: Spacing[2],
    borderBottomWidth: 1, borderBottomColor: Colors.surfaceBorder,
  },
  matrixRowAtm: { backgroundColor: Colors.goldAlpha10 },
  callCol: { flex: 1.1 },
  strikeCol: { flex: 1.3, alignItems: 'center' },
  putCol: { flex: 1.1 },
  right: { textAlign: 'right' },
  rightCell: { alignItems: 'flex-end' },
  cellBid: { fontFamily: FontFamily.mono, fontSize: 10, color: Colors.buyGreen },
  cellAsk: { fontFamily: FontFamily.mono, fontSize: 10, color: Colors.sellRed },
  cellSelected: { fontFamily: FontFamily.bold, textDecorationLine: 'underline' },
  strikeText: { fontFamily: FontFamily.semiBold, fontSize: FontSize.xs, color: Colors.textPrimary },
  strikeAtm: { color: Colors.goldLight },
  atmTag: { fontFamily: FontFamily.bold, fontSize: 8, color: Colors.gold, marginTop: 1 },
  ticketCard: {
    backgroundColor: Colors.surfaceCard, borderWidth: 1, borderColor: Colors.goldAlpha30,
    borderRadius: Radius.xl, padding: Spacing[4], marginTop: Spacing[4],
  },
  ticketTitle: { fontFamily: FontFamily.bold, fontSize: FontSize.lg, color: Colors.textPrimary },
  ticketSub: { fontFamily: FontFamily.regular, fontSize: FontSize.sm, color: Colors.textMuted, marginBottom: Spacing[3], marginTop: 4 },
  greeksRow: { flexDirection: 'row', marginBottom: Spacing[3] },
  greekItem: { flex: 1 },
  greekLabel: { fontFamily: FontFamily.regular, fontSize: 9, color: Colors.textMuted },
  greekValue: { fontFamily: FontFamily.monoMedium, fontSize: FontSize.xs, color: Colors.textPrimary },
  sideToggle: { flexDirection: 'row', borderRadius: Radius.md, overflow: 'hidden', borderWidth: 1, borderColor: Colors.surfaceBorder, marginBottom: Spacing[3] },
  sideBtn: { flex: 1, paddingVertical: Spacing[3], alignItems: 'center', backgroundColor: Colors.surfaceHover },
  sideBtnBuy: { backgroundColor: Colors.buyGreenDim },
  sideBtnSell: { backgroundColor: Colors.sellRedDim },
  sideBtnText: { fontFamily: FontFamily.bold, fontSize: FontSize.sm, color: Colors.textMuted },
  sideBtnTextBuy: { color: Colors.buyGreen },
  sideBtnTextSell: { color: Colors.sellRed },
  stickyTradeBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing[2],
    paddingHorizontal: Spacing[3],
    paddingVertical: Spacing[3],
    borderTopWidth: 1,
    borderTopColor: Colors.surfaceBorder,
    backgroundColor: Colors.surfaceCard,
  },
  stickyTradeInfo: { flex: 1, minWidth: 0 },
  stickyTradeTitle: { fontFamily: FontFamily.semiBold, fontSize: FontSize.sm, color: Colors.textPrimary },
  stickyTradeSub: { fontFamily: FontFamily.regular, fontSize: 9, color: Colors.textMuted, marginTop: 2 },
  stickySideToggle: {
    flexDirection: 'row',
    borderRadius: Radius.md,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
  },
  stickySideBtn: { paddingHorizontal: Spacing[3], paddingVertical: Spacing[2], backgroundColor: Colors.surfaceHover },
  stickySideBtnBuy: { backgroundColor: Colors.buyGreenDim },
  stickySideBtnSell: { backgroundColor: Colors.sellRedDim },
  stickySideBtnText: { fontFamily: FontFamily.bold, fontSize: FontSize.xs, color: Colors.textMuted },
  stickySideBtnTextBuy: { color: Colors.buyGreen },
  stickySideBtnTextSell: { color: Colors.sellRed },
  stickySubmitBtn: {
    paddingHorizontal: Spacing[4],
    paddingVertical: Spacing[2],
    borderRadius: Radius.md,
  },
  stickySubmitBuy: { backgroundColor: Colors.buyGreen },
  stickySubmitSell: { backgroundColor: Colors.sellRed },
  stickySubmitText: { fontFamily: FontFamily.bold, fontSize: FontSize.sm, color: Colors.surfaceDark },
  sheetOverlay: { flex: 1, justifyContent: 'flex-end' },
  sheetBackdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.55)' },
  sheetCard: {
    backgroundColor: Colors.surfaceCard,
    borderTopLeftRadius: Radius.xl,
    borderTopRightRadius: Radius.xl,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    padding: Spacing[4],
    paddingBottom: Spacing[6],
  },
  sheetHeader: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: Spacing[3] },
  sheetTitle: { fontFamily: FontFamily.bold, fontSize: FontSize.lg, color: Colors.textPrimary },
  sheetSub: { fontFamily: FontFamily.regular, fontSize: FontSize.sm, color: Colors.textMuted, marginTop: 4 },
  sheetClose: { fontSize: 22, color: Colors.textSecondary, paddingLeft: Spacing[2] },
  empty: { paddingVertical: Spacing[10], alignItems: 'center' },
  emptyText: { fontFamily: FontFamily.regular, fontSize: FontSize.sm, color: Colors.textMuted, textAlign: 'center' },
  posCard: { backgroundColor: Colors.surfaceCard, borderWidth: 1, borderColor: Colors.surfaceBorder, borderRadius: Radius.lg, padding: Spacing[4], marginBottom: Spacing[2] },
  posTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: Spacing[2] },
  posSymbol: { fontFamily: FontFamily.semiBold, fontSize: FontSize.base, color: Colors.textPrimary },
  posPnl: { fontFamily: FontFamily.bold, fontSize: FontSize.base },
  posMetaText: { fontFamily: FontFamily.mono, fontSize: FontSize.xs, color: Colors.textSecondary, marginBottom: Spacing[2] },
  orderCard: { backgroundColor: Colors.surfaceCard, borderWidth: 1, borderColor: Colors.surfaceBorder, borderRadius: Radius.lg, padding: Spacing[4], marginBottom: Spacing[2] },
  orderSide: { fontFamily: FontFamily.bold, fontSize: FontSize.sm },
  orderDate: { fontFamily: FontFamily.regular, fontSize: 9, color: Colors.textDisabled, marginTop: Spacing[1] },
  cancelOrderBtn: {
    marginLeft: 'auto' as any,
    paddingHorizontal: Spacing[3],
    paddingVertical: Spacing[1],
    borderRadius: Radius.sm,
    borderWidth: 1,
    borderColor: Colors.sellRed + '60',
    backgroundColor: Colors.sellRedDim,
  },
  cancelOrderTxt: {
    fontFamily: FontFamily.bold,
    fontSize: 10,
    color: Colors.sellRed,
  },
  kycBanner: {
    flexDirection: 'row', alignItems: 'flex-start',
    backgroundColor: Colors.warningDim, borderColor: Colors.warningDim,
    borderWidth: 1, borderRadius: Radius.md,
    padding: Spacing[3], marginBottom: Spacing[3],
  },
  kycTitle: { fontFamily: FontFamily.bold, fontSize: FontSize.xs, marginBottom: 2 },
  kycBody: { fontFamily: FontFamily.regular, fontSize: 10, color: Colors.textMuted, lineHeight: 14 },

  walletStrip: { backgroundColor: Colors.surfaceCard, borderWidth: 1, borderColor: Colors.surfaceBorder, borderRadius: Radius.lg, padding: Spacing[4], marginTop: Spacing[4] },
  walletStripRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: Spacing[2] },
  walletStripLabel: { fontFamily: FontFamily.bold, fontSize: FontSize.sm, color: Colors.textPrimary },
  transferTrigger: { paddingHorizontal: Spacing[3], paddingVertical: Spacing[1], backgroundColor: Colors.goldAlpha15, borderWidth: 1, borderColor: Colors.goldAlpha30, borderRadius: Radius.md },
  transferTriggerTxt: { fontFamily: FontFamily.bold, fontSize: FontSize.xs, color: Colors.goldLight },
  walletRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4, borderTopWidth: 1, borderTopColor: Colors.surfaceBorder },
  walletLabel: { fontFamily: FontFamily.regular, fontSize: FontSize.xs, color: Colors.textMuted },
  walletVal: { fontFamily: FontFamily.monoMedium, fontSize: FontSize.xs, color: Colors.textPrimary },

  modalOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: '#000c', justifyContent: 'flex-end' },
  modalCard: { backgroundColor: Colors.surfaceCard, borderTopLeftRadius: Radius.xl, borderTopRightRadius: Radius.xl, padding: Spacing[6] },
  modalTitle: { fontFamily: FontFamily.bold, fontSize: FontSize.lg, color: Colors.textPrimary, marginBottom: Spacing[4] },
  modalSub: { fontFamily: FontFamily.regular, fontSize: FontSize.sm, color: Colors.textMuted, marginBottom: Spacing[3] },
  modalInput: { backgroundColor: Colors.surfaceHover, borderWidth: 1, borderColor: Colors.surfaceBorder, borderRadius: Radius.md, padding: Spacing[3], fontFamily: FontFamily.mono, fontSize: FontSize.base, color: Colors.textPrimary, marginBottom: Spacing[4] },
  modalBtns: { flexDirection: 'row', gap: Spacing[3] },
  modalBtn: { flex: 1, paddingVertical: Spacing[3], borderRadius: Radius.md, alignItems: 'center' },
  modalBtnGhost: { borderWidth: 1, borderColor: Colors.surfaceBorder },
  modalBtnGhostTxt: { fontFamily: FontFamily.medium, fontSize: FontSize.sm, color: Colors.textMuted },
  modalBtnPrimary: { backgroundColor: Colors.gold },
  modalBtnTxt: { fontFamily: FontFamily.bold, fontSize: FontSize.sm, color: '#000' },
  dirRow: { flexDirection: 'row', gap: Spacing[2], marginBottom: Spacing[4] },
  dirBtn: { flex: 1, paddingVertical: Spacing[2], borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.surfaceBorder, backgroundColor: Colors.surfaceHover, alignItems: 'center' },
  dirBtnActive: { borderColor: Colors.gold, backgroundColor: Colors.goldAlpha15 },
  dirBtnTxt: { fontFamily: FontFamily.medium, fontSize: FontSize.xs, color: Colors.textMuted },
  dirBtnTxtActive: { color: Colors.goldLight },
  portRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: Spacing[3], borderBottomWidth: 1, borderBottomColor: Colors.surfaceBorder },
  portLabel: { fontFamily: FontFamily.regular, fontSize: FontSize.sm, color: Colors.textMuted },
  portVal: { fontFamily: FontFamily.monoMedium, fontSize: FontSize.sm, color: Colors.textPrimary },
});
