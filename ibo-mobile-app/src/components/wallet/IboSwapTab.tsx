/**
 * IboSwapTab — IBO ↔ USDT instant swap
 *
 * Matches the web IboSwapPanel exactly:
 *   • YOU PAY / YOU RECEIVE panels with large mono inputs
 *   • Asset chips (gold-bordered pills with coin icon)
 *   • 25% / 50% / 75% / MAX quick-fill buttons
 *   • Gold circular flip button
 *   • Local quote preview (instant) + API quote (debounced)
 *   • Full swap details: route, price impact, fees, fee warning
 *   • Recent swaps history (IBOUSDT market orders)
 *   • "View all in Ledger" link
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity,
  ActivityIndicator, Alert, ScrollView,
} from 'react-native';
import { useDispatch, useSelector } from 'react-redux';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import Icon from '../common/AppIcon';
import CoinIcon from '../common/CoinIcon';
import { walletApi } from '../../api/wallet.api';
import { tradingApi } from '../../api/trading.api';
import { getSwapConfigCached } from '../../services/swapConfigCache';
import { fetchWalletThunk, selectSessionWallet } from '../../store/wallet.slice';
import { buildLocalSwapQuote } from '../../lib/swapEstimate';
import { parseApiError } from '../../api/errors';
import { AppDispatch, RootState } from '../../store';
import { Colors, FontFamily, FontSize, Radius, Spacing } from '../../theme';
import type { WalletStackParamList } from '../../navigation/types';
import type { IboSwapDirection, IboSwapQuote, IboSwapConfig } from '../../types/wallet.types';
import { iosManualKeyboardScrollProps } from '@/utils/iosKeyboardScroll';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const PCT_BTNS = [0.25, 0.5, 0.75, 1] as const;

function n(v: unknown): number {
  const x = typeof v === 'string' ? parseFloat(v) : Number(v);
  return Number.isFinite(x) ? x : 0;
}

function fmt(v: unknown, dp = 4): string {
  const x = n(v);
  if (!Number.isFinite(x)) return '—';
  return x.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: dp });
}

function fmtDate(iso?: string): string {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleString('en-US', {
      month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
    });
  } catch {
    return '';
  }
}

function swapRouteLabel(order: { side?: string }): string {
  return String(order.side ?? '').toLowerCase() === 'sell' ? 'IBO → USDT' : 'USDT → IBO';
}

// ─── Sub-components ────────────────────────────────────────────────────────────

function AssetChip({ asset }: { asset: string }) {
  return (
    <View style={chip.wrap}>
      <CoinIcon symbol={asset} size={22} />
      <Text style={chip.label}>{asset}</Text>
    </View>
  );
}

const chip = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderColor: Colors.gold + '55',
    backgroundColor: Colors.goldAlpha10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: Radius.full,
  },
  label: {
    fontFamily: FontFamily.bold,
    fontSize: FontSize.base,
    color: Colors.goldLight,
  },
});

function DetailRow({
  label, value, accent, warning,
}: {
  label: string;
  value: string;
  accent?: string;
  warning?: boolean;
}) {
  return (
    <View style={dr.row}>
      <Text style={dr.label}>{label}</Text>
      <Text style={[dr.value, accent ? { color: accent } : undefined, warning ? { color: Colors.warning } : undefined]}>
        {value}
      </Text>
    </View>
  );
}

const dr = StyleSheet.create({
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 7,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255,255,255,0.06)',
  },
  label: { fontFamily: FontFamily.regular, fontSize: FontSize.xs, color: 'rgba(255,255,255,0.50)' },
  value: { fontFamily: FontFamily.mono, fontSize: FontSize.xs, color: Colors.textPrimary, textAlign: 'right', flex: 1, marginLeft: 8 },
});

// ─── Main component ────────────────────────────────────────────────────────────

const QUOTE_DEBOUNCE_MS = 180;

export default function IboSwapTab() {
  const dispatch = useDispatch<AppDispatch>();
  const navigation = useNavigation<NativeStackNavigationProp<WalletStackParamList>>();
  const { assets } = useSelector(selectSessionWallet);

  const [direction,      setDirection]      = useState<IboSwapDirection>('ibo_to_usdt');
  const [amount,         setAmount]         = useState('');
  const [quote,          setQuote]          = useState<IboSwapQuote | null>(null);
  const [quoteSyncing,   setQuoteSyncing]   = useState(false);
  const [swapping,       setSwapping]       = useState(false);
  const [error,          setError]          = useState('');
  const [success,        setSuccess]        = useState('');
  const [swapConfig,     setSwapConfig]     = useState<IboSwapConfig | null>(null);
  const [history,        setHistory]        = useState<any[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  const quoteSeqRef = useRef(0);

  const fromAsset = direction === 'ibo_to_usdt' ? 'IBO' : 'USDT';
  const toAsset   = direction === 'ibo_to_usdt' ? 'USDT' : 'IBO';

  const iboBal  = useMemo(() => n(assets.find((a) => a.asset === 'IBO')?.available_balance),  [assets]);
  const usdtBal = useMemo(() => n(assets.find((a) => a.asset === 'USDT')?.available_balance), [assets]);
  const payBalance = fromAsset === 'IBO' ? iboBal : usdtBal;

  const available = useMemo(
    () => (quote?.available_from != null ? n(quote.available_from) : payBalance),
    [payBalance, quote],
  );

  const feeTotal = useMemo(() => {
    if (!quote) return 0;
    if (quote.fee_ibo_total != null) return n(quote.fee_ibo_total);
    return n(quote.fee_ibo_estimated) + n(quote.trading_fee_ibo_estimated);
  }, [quote]);

  const feeOk = feeTotal <= 0 || iboBal + 1e-9 >= feeTotal;

  // ── Load swap config ────────────────────────────────────────────────────────
  useEffect(() => {
    getSwapConfigCached()
      .then((cfg) => setSwapConfig(cfg ?? null))
      .catch(() => setSwapConfig(null));
  }, []);

  // ── Load history ────────────────────────────────────────────────────────────
  const loadHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      const res = await tradingApi.getOrderHistory({ symbol: 'IBOUSDT' });
      const list = Array.isArray(res.data) ? res.data : (res.data as any)?.orders ?? [];
      setHistory(
        list.filter((o: any) => String(o.type ?? '').toLowerCase() === 'market').slice(0, 12),
      );
    } catch {
      setHistory([]);
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  useEffect(() => { void loadHistory(); }, [loadHistory]);

  // ── Quote (local preview + debounced API) ───────────────────────────────────
  useEffect(() => {
    const parsed = parseFloat(amount);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      setQuote(null);
      setQuoteSyncing(false);
      return;
    }

    // Instant local preview using swap config price
    if (swapConfig) {
      setQuote(buildLocalSwapQuote(direction, parsed, swapConfig.ibo_price_usdt, swapConfig, payBalance));
    }

    const seq = ++quoteSeqRef.current;
    const t = setTimeout(async () => {
      setQuoteSyncing(true);
      try {
        const { data } = await walletApi.getSwapQuote(direction, parsed);
        if (seq !== quoteSeqRef.current) return;
        setQuote(data);
        setError('');
      } catch (e) {
        if (seq !== quoteSeqRef.current) return;
        setError(parseApiError(e).message);
      } finally {
        if (seq === quoteSeqRef.current) setQuoteSyncing(false);
      }
    }, QUOTE_DEBOUNCE_MS);

    return () => {
      clearTimeout(t);
      ++quoteSeqRef.current;
    };
  }, [amount, direction, swapConfig, payBalance]);

  // ── Actions ─────────────────────────────────────────────────────────────────
  const flip = () => {
    setDirection((d) => (d === 'ibo_to_usdt' ? 'usdt_to_ibo' : 'ibo_to_usdt'));
    setAmount('');
    setQuote(null);
    setError('');
    setSuccess('');
  };

  const setPct = (p: number) => {
    if (available <= 0) return;
    const dp = fromAsset === 'USDT' ? 2 : 6;
    setAmount(
      available * p > 0
        ? (available * p).toFixed(dp).replace(/\.?0+$/, '')
        : '',
    );
  };

  const onSwap = async () => {
    const parsed = parseFloat(amount);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      setError('Enter an amount.');
      return;
    }
    if (parsed > available + 1e-9) {
      setError(`Insufficient ${fromAsset}.`);
      return;
    }
    if (!feeOk) {
      setError(`Need ~${fmt(feeTotal, 4)} IBO for fees.`);
      return;
    }
    setSwapping(true);
    setError('');
    setSuccess('');
    try {
      await walletApi.executeSwap(direction, parsed);
      const label = `${fmt(parsed, fromAsset === 'USDT' ? 2 : 4)} ${fromAsset}`;
      setSuccess(`Swapped ${label} → ${toAsset} successfully!`);
      setAmount('');
      setQuote(null);
      await Promise.all([dispatch(fetchWalletThunk()), loadHistory()]);
    } catch (e) {
      setError(parseApiError(e).message);
    } finally {
      setSwapping(false);
    }
  };

  // ── Computed display values ─────────────────────────────────────────────────
  const receiveVal = quote
    ? fmt(n(quote.to_amount_estimated), toAsset === 'USDT' ? 2 : 4)
    : '0.0';

  const rateLine = quote?.price_usdt
    ? direction === 'ibo_to_usdt'
      ? `1 IBO = $${fmt(n(quote.price_usdt), 4)} USDT`
      : `1 IBO = $${fmt(n(quote.price_usdt), 4)} · 1 USDT ≈ ${fmt(1 / n(quote.price_usdt), 4)} IBO`
    : 'Enter an amount to load live rate';

  const canSwap = !swapping && !!amount && !!quote && feeOk;

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <ScrollView
      style={s.root}
      contentContainerStyle={s.content}
      showsVerticalScrollIndicator={false}
      {...iosManualKeyboardScrollProps()}
    >
      {/* ── Header ── */}
      <View style={s.header}>
        <View style={{ flex: 1 }}>
          <View style={s.titleRow}>
            <Text style={s.title}>Swap</Text>
            <View style={s.instantBadge}>
              <Icon name="flash" size={10} color={Colors.goldLight} />
              <Text style={s.instantText}>Instant</Text>
            </View>
          </View>
          <Text style={s.subtitle}>
            {fromAsset} → {toAsset} only · live market price
          </Text>
        </View>
      </View>

      {/* ── YOU PAY ── */}
      <View style={s.payCard}>
        <View style={s.payTopRow}>
          <Text style={s.sectionLabel}>YOU PAY</Text>
          <Text style={s.balanceText}>Balance: {fmt(payBalance, fromAsset === 'USDT' ? 2 : 6)} {fromAsset}</Text>
        </View>

        <View style={s.inputRow}>
          <TextInput
            style={s.amountInput}
            value={amount}
            onChangeText={setAmount}
            keyboardType="decimal-pad"
            placeholder="0.0"
            placeholderTextColor="rgba(255,255,255,0.20)"
          />
          <AssetChip asset={fromAsset} />
        </View>

        <View style={s.pctRow}>
          {PCT_BTNS.map((p) => (
            <TouchableOpacity key={p} style={s.pctBtn} onPress={() => setPct(p)} activeOpacity={0.75}>
              <Text style={s.pctTxt}>{p === 1 ? 'MAX' : `${Math.round(p * 100)}%`}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {/* ── Flip button ── */}
      <View style={s.flipRow}>
        <TouchableOpacity style={s.flipBtn} onPress={flip} activeOpacity={0.85}>
          <Icon name="swap-vertical" size={22} color={Colors.surfaceDark} />
        </TouchableOpacity>
      </View>

      {/* ── YOU RECEIVE ── */}
      <View style={s.receiveCard}>
        <View style={s.payTopRow}>
          <Text style={s.sectionLabel}>YOU RECEIVE</Text>
          {quoteSyncing ? <Text style={s.updatingText}>Updating…</Text> : null}
        </View>
        <View style={s.inputRow}>
          <Text style={s.receiveVal} numberOfLines={1} adjustsFontSizeToFit>
            {receiveVal}
          </Text>
          <AssetChip asset={toAsset} />
        </View>
        <Text style={s.rateLine}>{rateLine}</Text>
      </View>

      {/* ── Swap details ── */}
      {quote ? (
        <View style={s.detailsCard}>
          <DetailRow label="Route"            value={`${fromAsset} → ${toAsset}`} />
          <DetailRow label="Price impact"     value="~0% (market)" accent={Colors.success} />
          <DetailRow label="Execution"        value={`Market · ${quote.symbol ?? 'IBOUSDT'}`} />
          <DetailRow label="Minimum received" value={`${receiveVal} ${toAsset}`} />
          {n(quote.fee_ibo_estimated) > 0 && (
            <DetailRow
              label="Swap platform fee"
              value={`≈ ${fmt(n(quote.fee_ibo_estimated), 4)} IBO`}
            />
          )}
          {n(quote.trading_fee_ibo_estimated) > 0 && (
            <DetailRow
              label="Market order fee"
              value={`≈ ${fmt(n(quote.trading_fee_ibo_estimated), 4)} IBO`}
            />
          )}
          {feeTotal > 0 && (
            <DetailRow
              label="Total IBO required"
              value={`≈ ${fmt(feeTotal, 4)} IBO`}
              accent={Colors.goldLight}
            />
          )}
          {quote.min_from_amount != null && quote.min_from_amount > 0 && (
            <DetailRow
              label="Minimum pay"
              value={`${fmt(n(quote.min_from_amount), fromAsset === 'USDT' ? 2 : 4)} ${fromAsset}`}
            />
          )}

          {/* Fee warning */}
          {!feeOk && (
            <View style={s.feeWarning}>
              <Icon name="alert-circle-outline" size={14} color={Colors.warning} />
              <Text style={s.feeWarningText}>
                Add IBO for fees — need ~{fmt(feeTotal, 4)}, have {fmt(iboBal, 6)}.
              </Text>
            </View>
          )}
        </View>
      ) : swapConfig && !amount ? (
        <View style={s.detailsCard}>
          <DetailRow label="Route"    value={`${fromAsset} → ${toAsset}`} />
          <DetailRow label="Market"   value="IBOUSDT" />
          <DetailRow label="Swap fee" value={`${(n(swapConfig.swap_fee_rate) * 100).toFixed(2)}% + ${fmt(swapConfig.swap_fee_ibo_fixed, 4)} IBO`} />
        </View>
      ) : null}

      {/* ── Error / success banners ── */}
      {error ? (
        <View style={s.errorBanner}>
          <Text style={s.errorText}>{error}</Text>
        </View>
      ) : null}
      {success ? (
        <View style={s.successBanner}>
          <Text style={s.successText}>{success}</Text>
        </View>
      ) : null}

      {/* ── Swap button ── */}
      <TouchableOpacity
        style={[s.swapBtn, !canSwap && s.swapBtnDisabled]}
        onPress={onSwap}
        disabled={!canSwap}
        activeOpacity={0.85}
      >
        {swapping
          ? <ActivityIndicator size="small" color={Colors.surfaceDark} />
          : <Text style={s.swapBtnText}>
              {direction === 'ibo_to_usdt' ? 'Swap IBO for USDT' : 'Swap USDT for IBO'}
            </Text>
        }
      </TouchableOpacity>

      {/* ── Recent swaps ── */}
      <View style={s.historyCard}>
        <View style={s.historyHeader}>
          <Text style={s.historyTitle}>Recent swaps</Text>
          <TouchableOpacity onPress={loadHistory} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            {historyLoading
              ? <ActivityIndicator size="small" color={Colors.textMuted} />
              : <Icon name="refresh" size={16} color={Colors.textMuted} />
            }
          </TouchableOpacity>
        </View>

        {history.length === 0 ? (
          <View style={s.historyEmpty}>
            <Text style={s.historyEmptyText}>No IBO/USDT swaps yet.</Text>
          </View>
        ) : (
          history.map((o, i) => (
            <View key={o.order_id ?? i} style={s.historyRow}>
              <View style={{ flex: 1 }}>
                <Text style={s.historyRoute}>{swapRouteLabel(o)}</Text>
                <Text style={s.historyMeta}>
                  {fmt(n(o.filled_amount ?? o.amount), 4)} · {String(o.status ?? '').replace('_', ' ')}
                </Text>
              </View>
              <Text style={s.historyDate}>{fmtDate(o.created_at)}</Text>
            </View>
          ))
        )}

        <TouchableOpacity
          style={s.ledgerLink}
          onPress={() => navigation.navigate('Transactions', {})}
          activeOpacity={0.75}
        >
          <Text style={s.ledgerLinkText}>View all in Ledger</Text>
          <Icon name="arrow-right" size={14} color={Colors.goldLight} />
        </TouchableOpacity>
      </View>

      <View style={{ height: Spacing[10] }} />
    </ScrollView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  root:    { flex: 1, backgroundColor: Colors.surface },
  content: { paddingHorizontal: Spacing[4], paddingTop: Spacing[4] },

  header:    { marginBottom: Spacing[4] },
  titleRow:  { flexDirection: 'row', alignItems: 'center', gap: Spacing[2], marginBottom: 4 },
  title:     { fontFamily: FontFamily.extraBold ?? FontFamily.bold, fontSize: FontSize['2xl'], color: Colors.textPrimary },
  instantBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: Colors.goldAlpha15, borderWidth: 1, borderColor: Colors.goldAlpha30,
    paddingHorizontal: 8, paddingVertical: 3, borderRadius: Radius.full,
  },
  instantText: { fontFamily: FontFamily.bold, fontSize: 9, color: Colors.goldLight, textTransform: 'uppercase', letterSpacing: 0.5 },
  subtitle: { fontFamily: FontFamily.regular, fontSize: FontSize.sm, color: 'rgba(255,255,255,0.55)' },

  // YOU PAY card
  payCard: {
    backgroundColor: Colors.surfaceDark,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    borderRadius: Radius.xl,
    padding: Spacing[4],
    marginBottom: 0,
  },
  payTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Spacing[3],
  },
  sectionLabel: {
    fontFamily: FontFamily.medium,
    fontSize: 10,
    color: 'rgba(255,255,255,0.50)',
    textTransform: 'uppercase',
    letterSpacing: 1.2,
  },
  balanceText: {
    fontFamily: FontFamily.mono,
    fontSize: FontSize.xs,
    color: Colors.goldLight,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing[3],
    marginBottom: Spacing[4],
  },
  amountInput: {
    flex: 1,
    fontFamily: FontFamily.mono,
    fontSize: 34,
    color: Colors.white,
    padding: 0,
    minWidth: 0,
  },
  pctRow: {
    flexDirection: 'row',
    gap: Spacing[2],
  },
  pctBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    backgroundColor: 'rgba(255,255,255,0.04)',
    alignItems: 'center',
  },
  pctTxt: {
    fontFamily: FontFamily.bold,
    fontSize: 11,
    color: 'rgba(255,255,255,0.70)',
  },

  // Flip button
  flipRow: { alignItems: 'center', marginVertical: -16, zIndex: 10 },
  flipBtn: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: Colors.gold,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 3,
    borderColor: Colors.surface,
    shadowColor: Colors.gold,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.40,
    shadowRadius: 8,
    elevation: 8,
  },

  // YOU RECEIVE card
  receiveCard: {
    backgroundColor: Colors.goldAlpha10,
    borderWidth: 1,
    borderColor: Colors.gold + '33',
    borderRadius: Radius.xl,
    padding: Spacing[4],
    marginBottom: Spacing[3],
  },
  receiveVal: {
    flex: 1,
    fontFamily: FontFamily.mono,
    fontSize: 34,
    color: Colors.goldLight,
    minWidth: 0,
  },
  updatingText: {
    fontFamily: FontFamily.semiBold,
    fontSize: FontSize.xs,
    color: Colors.goldLight,
  },
  rateLine: {
    fontFamily: FontFamily.mono,
    fontSize: FontSize.xs,
    color: 'rgba(255,255,255,0.50)',
    marginTop: Spacing[2],
  },

  // Details card
  detailsCard: {
    backgroundColor: Colors.surfaceCard,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    borderRadius: Radius.xl,
    padding: Spacing[4],
    marginBottom: Spacing[3],
  },

  feeWarning: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    backgroundColor: Colors.warningDim,
    borderWidth: 1,
    borderColor: Colors.warning + '33',
    borderRadius: Radius.md,
    paddingHorizontal: Spacing[3],
    paddingVertical: Spacing[2],
    marginTop: Spacing[3],
  },
  feeWarningText: {
    flex: 1,
    fontFamily: FontFamily.regular,
    fontSize: FontSize.xs,
    color: Colors.warning,
    lineHeight: 16,
  },

  // Error / success
  errorBanner: {
    backgroundColor: 'rgba(239,68,68,0.10)',
    borderWidth: 1,
    borderColor: 'rgba(239,68,68,0.25)',
    borderRadius: Radius.md,
    paddingHorizontal: Spacing[3],
    paddingVertical: Spacing[2],
    marginBottom: Spacing[3],
  },
  errorText: { fontFamily: FontFamily.regular, fontSize: FontSize.sm, color: Colors.danger },
  successBanner: {
    backgroundColor: Colors.successDim,
    borderWidth: 1,
    borderColor: Colors.success + '44',
    borderRadius: Radius.md,
    paddingHorizontal: Spacing[3],
    paddingVertical: Spacing[2],
    marginBottom: Spacing[3],
  },
  successText: { fontFamily: FontFamily.regular, fontSize: FontSize.sm, color: Colors.success },

  // Swap button
  swapBtn: {
    backgroundColor: Colors.gold,
    borderRadius: Radius.xl,
    paddingVertical: Spacing[4],
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing[4],
    shadowColor: Colors.gold,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 4,
  },
  swapBtnDisabled: { opacity: 0.50 },
  swapBtnText: {
    fontFamily: FontFamily.bold,
    fontSize: FontSize.base,
    color: Colors.surfaceDark,
  },

  // History
  historyCard: {
    backgroundColor: Colors.surfaceCard,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    borderRadius: Radius.xl,
    padding: Spacing[4],
    marginBottom: Spacing[4],
  },
  historyHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Spacing[3],
  },
  historyTitle: {
    fontFamily: FontFamily.semiBold,
    fontSize: FontSize.sm,
    color: Colors.textPrimary,
  },
  historyEmpty: {
    paddingVertical: Spacing[4],
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.surfaceBorder,
    borderRadius: Radius.md,
    borderStyle: 'dashed',
    alignItems: 'center',
    marginBottom: Spacing[3],
  },
  historyEmptyText: {
    fontFamily: FontFamily.regular,
    fontSize: FontSize.xs,
    color: 'rgba(255,255,255,0.45)',
  },
  historyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.surfaceBorder,
    borderRadius: Radius.md,
    backgroundColor: 'rgba(255,255,255,0.02)',
    paddingHorizontal: Spacing[3],
    paddingVertical: Spacing[2],
    marginBottom: Spacing[2],
  },
  historyRoute: {
    fontFamily: FontFamily.semiBold,
    fontSize: FontSize.sm,
    color: Colors.textPrimary,
  },
  historyMeta: {
    fontFamily: FontFamily.mono,
    fontSize: 11,
    color: 'rgba(255,255,255,0.45)',
    marginTop: 2,
  },
  historyDate: {
    fontFamily: FontFamily.regular,
    fontSize: 10,
    color: 'rgba(255,255,255,0.40)',
    marginLeft: Spacing[2],
    flexShrink: 0,
  },
  ledgerLink: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    marginTop: Spacing[3],
    paddingTop: Spacing[3],
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Colors.surfaceBorder,
  },
  ledgerLinkText: {
    fontFamily: FontFamily.semiBold,
    fontSize: FontSize.xs,
    color: Colors.goldLight,
  },
});
