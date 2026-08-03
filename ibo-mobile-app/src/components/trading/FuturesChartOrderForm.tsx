/**
 * Futures order form for the chart-page trade sheet — same Open/Close + Long/Short
 * flow as FuturesTradeScreen, kept compact for a bottom sheet.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ActivityIndicator,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useSelector } from 'react-redux';
import { futuresApi, type FuturesOrderPayload } from '../../api/futures.api';
import { parseApiError } from '../../api/errors';
import { useFutures } from '../../context/FuturesContext';
import { RootState } from '../../store';
import TerminalNumericInput from '../trading/TerminalNumericInput';
import Icon from '../common/AppIcon';
import { Colors, FontFamily, FontSize, Spacing, Radius } from '../../theme';
import { FuturesUi } from '../../theme/futuresTerminal';
import { formatPrice } from '../../utils/formatters';
import { toFuturesSymbol, toSpotSymbol } from '../../utils/tradeSymbols';
import {
  effectiveKycStatus,
  isKycApproved,
  kycTradeSubmitLabel,
} from '../../utils/kycGate';
import { navigateToKycFlowFromRoot, normalizeKycMode } from '../../utils/kycNavigation';

type Props = {
  symbol: string;
  initialSide?: 'buy' | 'sell';
  leverageHint?: number;
  onOrderPlaced?: () => void;
};

function fmtN(n: number, d = 2): string {
  if (!Number.isFinite(n)) return '—';
  return n.toLocaleString('en-US', { maximumFractionDigits: d });
}

export default function FuturesChartOrderForm({
  symbol: rawSymbol,
  initialSide = 'buy',
  leverageHint,
  onOrderPlaced,
}: Props) {
  const navigation = useNavigation<any>();
  const { user, kyc, kycMode } = useSelector((s: RootState) => s.auth);
  const {
    quotes,
    wallet,
    activeSettings,
    setActiveSymbol,
    refreshAccount,
  } = useFutures();

  const symbol = useMemo(() => toFuturesSymbol(rawSymbol), [rawSymbol]);
  const spotSym = useMemo(() => toSpotSymbol(symbol), [symbol]);
  const baseAsset = spotSym.replace(/USDT$/i, '');

  useEffect(() => {
    setActiveSymbol(symbol);
  }, [symbol, setActiveSymbol]);

  const [openCloseTab, setOpenCloseTab] = useState<'open' | 'close'>('open');
  const [orderType, setOrderType] = useState<'limit' | 'market'>('limit');
  const [side, setSide] = useState<'buy' | 'sell'>(initialSide);
  const [price, setPrice] = useState('');
  const [qty, setQty] = useState('');
  const [placing, setPlacing] = useState<'buy' | 'sell' | null>(null);
  const [err, setErr] = useState('');
  const [ok, setOk] = useState('');

  useEffect(() => {
    setSide(initialSide);
  }, [initialSide]);

  useEffect(() => {
    if (quotes.dispMark > 0 && !price) {
      setPrice(formatPrice(quotes.dispMark));
    }
  }, [quotes.dispMark, price]);

  const leverage = Math.max(
    1,
    Number(leverageHint || activeSettings?.leverage || 10),
  );
  const availMargin = Number(
    wallet?.available
    ?? wallet?.free_margin
    ?? wallet?.wallet_balance
    ?? wallet?.balance
    ?? 0,
  );
  const markPx = quotes.dispMark > 0 ? quotes.dispMark : 0;
  const limitPx = parseFloat(price) || 0;
  const qtyNum = parseFloat(qty) || 0;
  const fillPx = orderType === 'market'
    ? (side === 'buy'
      ? (quotes.dispAsk || markPx)
      : (quotes.dispBid || markPx))
    : limitPx;
  const notional = qtyNum > 0 && fillPx > 0 ? qtyNum * fillPx : 0;
  const initMargin = leverage > 0 ? notional / leverage : 0;

  const kycStatus = effectiveKycStatus(kyc, user);
  const kycBlocked = Boolean(user && !isKycApproved(kycStatus));

  const applyPct = useCallback((pct: number) => {
    if (openCloseTab === 'close') return;
    if (availMargin <= 0 || fillPx <= 0 || leverage <= 0) return;
    const margin = availMargin * (pct / 100);
    const maxNotional = margin * leverage;
    const maxQty = maxNotional / fillPx;
    if (maxQty > 0) {
      setQty(maxQty.toFixed(6).replace(/\.?0+$/, ''));
    }
  }, [openCloseTab, availMargin, fillPx, leverage]);

  const place = async (effectiveSide: 'buy' | 'sell') => {
    setErr('');
    setOk('');
    setSide(effectiveSide);
    if (kycBlocked) {
      navigateToKycFlowFromRoot(navigation, normalizeKycMode(kycMode), kycStatus);
      return;
    }
    if (qtyNum <= 0) {
      setErr('Enter a size — type an amount or use the % buttons');
      return;
    }
    if (orderType === 'limit' && limitPx <= 0) {
      setErr('Enter a limit price');
      return;
    }
    if (orderType === 'market' && markPx <= 0) {
      setErr('Waiting for market price…');
      return;
    }
    if (openCloseTab === 'open' && initMargin > availMargin + 1e-8) {
      setErr(`Insufficient margin — need ≈${initMargin.toFixed(2)} USDT`);
      return;
    }

    setPlacing(effectiveSide);
    try {
      const payload: FuturesOrderPayload = {
        symbol,
        side: effectiveSide,
        type: orderType,
        quantity: qtyNum,
        price: orderType === 'limit' ? limitPx : null,
        leverage,
        tif: 'GTC',
        reduce_only: openCloseTab === 'close',
      };
      await futuresApi.placeOrder(payload);
      setOk(
        `${openCloseTab === 'close' ? 'Close' : 'Open'} ${effectiveSide === 'buy' ? 'Long' : 'Short'} — ${qtyNum} ${baseAsset}`,
      );
      setQty('');
      await refreshAccount();
      onOrderPlaced?.();
    } catch (e) {
      setErr(parseApiError(e).message);
    } finally {
      setPlacing(null);
    }
  };

  const sideLabel = kycTradeSubmitLabel(
    kycStatus,
    side === 'buy'
      ? (openCloseTab === 'open' ? 'Open Long' : 'Close Long')
      : (openCloseTab === 'open' ? 'Open Short' : 'Close Short'),
  );

  return (
    <View style={styles.wrap}>
      <View style={styles.openCloseTabs}>
        <TouchableOpacity
          style={[styles.tab, openCloseTab === 'open' && styles.tabOpenOn]}
          onPress={() => setOpenCloseTab('open')}
          activeOpacity={0.88}
        >
          <Text style={[styles.tabTxt, openCloseTab === 'open' && styles.tabTxtOpen]}>Open</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, openCloseTab === 'close' && styles.tabCloseOn]}
          onPress={() => setOpenCloseTab('close')}
          activeOpacity={0.88}
        >
          <Text style={[styles.tabTxt, openCloseTab === 'close' && styles.tabTxtClose]}>Close</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.avblRow}>
        <Text style={styles.avblLbl}>Avbl</Text>
        <Text style={styles.avblVal}>{fmtN(availMargin, 2)} USDT</Text>
        <Text style={styles.levPill}>{leverage}x</Text>
      </View>

      <View style={styles.typeRow}>
        {(['limit', 'market'] as const).map((t) => (
          <TouchableOpacity
            key={t}
            style={[styles.typeBtn, orderType === t && styles.typeBtnOn]}
            onPress={() => setOrderType(t)}
            activeOpacity={0.85}
          >
            <Text style={[styles.typeTxt, orderType === t && styles.typeTxtOn]}>
              {t === 'limit' ? 'Limit' : 'Market'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {orderType === 'limit' ? (
        <View style={styles.fieldWrap}>
          <View style={styles.fieldLabelRow}>
            <Text style={styles.fieldLabel}>Price (USDT)</Text>
            <TouchableOpacity
              onPress={() => markPx > 0 && setPrice(formatPrice(markPx))}
              hitSlop={8}
            >
              <Text style={styles.latestBtn}>↻ Latest</Text>
            </TouchableOpacity>
          </View>
          <View style={styles.fieldBox}>
            <TerminalNumericInput
              style={styles.fieldInput}
              keyboardType="numeric"
              value={price}
              onChangeText={setPrice}
              placeholder={markPx > 0 ? formatPrice(markPx) : '0.00'}
              placeholderTextColor={Colors.textDisabled}
              selectionColor={Colors.gold}
            />
            <Text style={styles.fieldUnit}>USDT</Text>
          </View>
        </View>
      ) : (
        <View style={styles.fieldWrap}>
          <Text style={styles.fieldLabel}>Price</Text>
          <View style={[styles.fieldBox, styles.fieldBoxMuted]}>
            <Text style={styles.marketPriceTxt}>Market price</Text>
          </View>
        </View>
      )}

      <View style={styles.fieldWrap}>
        <Text style={styles.fieldLabel}>Amount ({baseAsset})</Text>
        <View style={styles.fieldBox}>
          <TerminalNumericInput
            style={styles.fieldInput}
            keyboardType="numeric"
            value={qty}
            onChangeText={setQty}
            placeholder="0"
            placeholderTextColor={Colors.textDisabled}
            selectionColor={Colors.gold}
          />
          <Text style={styles.fieldUnit}>{baseAsset}</Text>
        </View>
      </View>

      {openCloseTab === 'open' ? (
        <View style={styles.pctRow}>
          {[10, 25, 50, 75, 100].map((p) => (
            <TouchableOpacity key={p} style={styles.pctBtn} onPress={() => applyPct(p)} activeOpacity={0.85}>
              <Text style={styles.pctTxt}>{p}%</Text>
            </TouchableOpacity>
          ))}
        </View>
      ) : null}

      <View style={styles.metaRow}>
        <Text style={styles.metaLbl}>Cost</Text>
        <Text style={styles.metaVal}>{fmtN(initMargin, 4)} USDT</Text>
      </View>
      <View style={styles.metaRow}>
        <Text style={styles.metaLbl}>Mark</Text>
        <Text style={styles.metaVal}>{markPx > 0 ? formatPrice(markPx) : '—'}</Text>
      </View>

      {err ? (
        <View style={styles.errBox}>
          <Icon name="alert-circle-outline" size={14} color={Colors.danger} />
          <Text style={styles.errTxt}>{err}</Text>
        </View>
      ) : null}
      {ok ? (
        <View style={styles.okBox}>
          <Text style={styles.okTxt}>{ok}</Text>
        </View>
      ) : null}

      {kycBlocked ? (
        <TouchableOpacity
          style={styles.kycBtnFull}
          onPress={() => place(side)}
          disabled={placing !== null}
          activeOpacity={0.88}
        >
          {placing === side ? (
            <ActivityIndicator color={Colors.white} />
          ) : (
            <Text style={styles.ctaTxt}>{sideLabel}</Text>
          )}
        </TouchableOpacity>
      ) : (
        <TouchableOpacity
          style={[
            styles.ctaBtnSingle,
            side === 'buy' ? styles.ctaLong : styles.ctaShort,
            placing !== null && styles.ctaDisabled,
          ]}
          onPress={() => place(side)}
          disabled={placing !== null}
          activeOpacity={0.88}
        >
          {placing === side ? (
            <ActivityIndicator color={Colors.white} />
          ) : (
            <Text style={styles.ctaTxt}>{sideLabel}</Text>
          )}
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: Spacing[3],
  },
  openCloseTabs: {
    flexDirection: 'row',
    backgroundColor: Colors.surfaceHover,
    borderRadius: Radius.md,
    padding: 3,
    gap: 3,
  },
  tab: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
    borderRadius: Radius.sm,
  },
  tabOpenOn: {
    backgroundColor: FuturesUi.longDimStrong,
    borderWidth: 1,
    borderColor: FuturesUi.longBorder,
  },
  tabCloseOn: {
    backgroundColor: Colors.sellRedDim,
    borderWidth: 1,
    borderColor: 'rgba(239,68,68,0.35)',
  },
  tabTxt: {
    fontFamily: FontFamily.semiBold,
    fontSize: FontSize.sm,
    color: Colors.textMuted,
  },
  tabTxtOpen: {
    color: FuturesUi.longLight,
    fontFamily: FontFamily.bold,
  },
  tabTxtClose: {
    color: Colors.sellRed,
    fontFamily: FontFamily.bold,
  },
  avblRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing[2],
  },
  avblLbl: {
    fontFamily: FontFamily.regular,
    fontSize: FontSize.xs,
    color: Colors.textMuted,
  },
  avblVal: {
    flex: 1,
    fontFamily: FontFamily.semiBold,
    fontSize: FontSize.sm,
    color: Colors.textPrimary,
  },
  levPill: {
    fontFamily: FontFamily.bold,
    fontSize: FontSize.xs,
    color: Colors.goldLight,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: Radius.sm,
    borderWidth: 1,
    borderColor: Colors.goldAlpha30,
    backgroundColor: Colors.goldAlpha10,
    overflow: 'hidden',
  },
  typeRow: {
    flexDirection: 'row',
    gap: Spacing[2],
  },
  typeBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: Radius.sm,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    backgroundColor: Colors.surface,
  },
  typeBtnOn: {
    borderColor: Colors.goldAlpha30,
    backgroundColor: Colors.goldAlpha10,
  },
  typeTxt: {
    fontFamily: FontFamily.semiBold,
    fontSize: FontSize.xs,
    color: Colors.textMuted,
  },
  typeTxtOn: {
    color: Colors.goldLight,
  },
  fieldWrap: {
    gap: 6,
  },
  fieldLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  fieldLabel: {
    fontFamily: FontFamily.semiBold,
    fontSize: FontSize.xs,
    color: Colors.textMuted,
  },
  latestBtn: {
    fontFamily: FontFamily.semiBold,
    fontSize: FontSize.xs,
    color: Colors.goldLight,
  },
  fieldBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing[3],
    minHeight: 44,
  },
  fieldBoxMuted: {
    backgroundColor: Colors.surfaceHover,
  },
  fieldInput: {
    flex: 1,
    fontFamily: FontFamily.monoMedium,
    fontSize: FontSize.base,
    color: Colors.textPrimary,
    paddingVertical: 10,
  },
  fieldUnit: {
    fontFamily: FontFamily.semiBold,
    fontSize: FontSize.xs,
    color: Colors.textMuted,
    marginLeft: Spacing[2],
  },
  marketPriceTxt: {
    fontFamily: FontFamily.medium,
    fontSize: FontSize.sm,
    color: Colors.textMuted,
    paddingVertical: 12,
  },
  pctRow: {
    flexDirection: 'row',
    gap: 6,
  },
  pctBtn: {
    flex: 1,
    paddingVertical: 8,
    alignItems: 'center',
    borderRadius: Radius.sm,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    backgroundColor: Colors.surface,
  },
  pctTxt: {
    fontFamily: FontFamily.semiBold,
    fontSize: FontSize.xs,
    color: Colors.textSecondary,
  },
  metaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  metaLbl: {
    fontFamily: FontFamily.regular,
    fontSize: FontSize.xs,
    color: Colors.textMuted,
  },
  metaVal: {
    fontFamily: FontFamily.monoMedium,
    fontSize: FontSize.xs,
    color: Colors.textSecondary,
  },
  errBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: Colors.dangerDim,
    borderRadius: Radius.md,
    padding: Spacing[2],
  },
  errTxt: {
    flex: 1,
    fontFamily: FontFamily.regular,
    fontSize: FontSize.xs,
    color: Colors.danger,
  },
  okBox: {
    backgroundColor: Colors.successDim,
    borderRadius: Radius.md,
    padding: Spacing[2],
  },
  okTxt: {
    fontFamily: FontFamily.semiBold,
    fontSize: FontSize.xs,
    color: Colors.success,
  },
  ctaRow: {
    flexDirection: 'row',
    gap: Spacing[2],
    marginTop: Spacing[1],
  },
  ctaBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: Radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
  },
  ctaBtnSingle: {
    paddingVertical: 14,
    borderRadius: Radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
    marginTop: Spacing[1],
  },
  kycBtnFull: {
    width: '100%',
    paddingVertical: 14,
    borderRadius: Radius.lg,
    backgroundColor: Colors.gold,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
    marginTop: Spacing[1],
  },
  ctaLong: {
    backgroundColor: FuturesUi.long,
  },
  ctaShort: {
    backgroundColor: Colors.sellRed,
  },
  ctaDisabled: {
    opacity: 0.55,
  },
  ctaTxt: {
    fontFamily: FontFamily.bold,
    fontSize: FontSize.sm,
    color: Colors.white,
  },
});
