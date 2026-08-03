import React, { useMemo, useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity, TextInput, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useDispatch, useSelector } from 'react-redux';
import ProfileSubHeader from '../../components/profile/ProfileSubHeader';
import Button from '../../components/common/Button';
import CoinIcon from '../../components/common/CoinIcon';
import { ProfileStackParamList } from '../../navigation/types';
import { AppDispatch, RootState } from '../../store';
import { fetchWalletThunk, selectSessionWallet } from '../../store/wallet.slice';
import { fetchOrdersThunk } from '../../store/trading.slice';
import { tradingApi } from '../../api/trading.api';
import { parseApiError } from '../../api/errors';
import { profileStyles } from '../../components/profile/profileStyles';
import { Colors, FontFamily, FontSize, Radius, Spacing } from '../../theme';
import { formatPrice } from '../../utils/formatters';
import { iosManualKeyboardScrollProps } from '@/utils/iosKeyboardScroll';

const PAIRS = ['IBOUSDT', 'BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT'];
const PCTS = [0.25, 0.5, 0.75, 1];

type Nav = NativeStackNavigationProp<ProfileStackParamList, 'QuickTrade'>;

export default function QuickTradeScreen({ navigation }: { navigation: Nav }) {
  const dispatch = useDispatch<AppDispatch>();
  const markets = useSelector((s: RootState) => s.market.markets);
  const { assets } = useSelector(selectSessionWallet);
  const [symbol, setSymbol] = useState('BTCUSDT');
  const [side, setSide] = useState<'buy' | 'sell'>('buy');
  const [amount, setAmount] = useState('');
  const [loading, setLoading] = useState(false);

  const row = markets[symbol];
  const price = Number(row?.last_price ?? 0);
  const base = symbol.replace('USDT', '');
  const quoteBal = Number(assets.find((a) => a.asset === 'USDT')?.available_balance ?? 0);
  const baseBal = Number(assets.find((a) => a.asset === base)?.available_balance ?? 0);

  const setPct = (p: number) => {
    if (side === 'buy' && price > 0) {
      setAmount((quoteBal * p / price).toFixed(6).replace(/\.?0+$/, ''));
    } else {
      setAmount((baseBal * p).toFixed(6).replace(/\.?0+$/, ''));
    }
  };

  const onSubmit = async () => {
    const qty = Number(amount);
    if (!qty || qty <= 0) {
      Alert.alert('Invalid amount', 'Enter a valid quantity.');
      return;
    }
    setLoading(true);
    try {
      await tradingApi.placeOrder({
        symbol,
        side,
        type: 'market',
        amount: qty,
      });
      await Promise.all([
        dispatch(fetchWalletThunk()),
        dispatch(fetchOrdersThunk()),
      ]);
      Alert.alert('Order placed', `${side.toUpperCase()} ${qty} ${base} @ market`);
      setAmount('');
    } catch (err) {
      Alert.alert('Order failed', parseApiError(err).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={profileStyles.screen} edges={['top']}>
      <ProfileSubHeader title="Quick Trade" onBack={() => navigation.goBack()} />
      <ScrollView contentContainerStyle={profileStyles.content} {...iosManualKeyboardScrollProps()}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.pairRow}>
          {PAIRS.map((sym) => {
            const active = sym === symbol;
            const b = sym.replace('USDT', '');
            return (
              <TouchableOpacity key={sym} style={[styles.pairChip, active && styles.pairChipActive]} onPress={() => setSymbol(sym)}>
                <CoinIcon symbol={b} size={22} />
                <Text style={[styles.pairTxt, active && styles.pairTxtActive]}>{b}</Text>
                <Text style={styles.pairPx}>{formatPrice(Number(markets[sym]?.last_price ?? 0))}</Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        <View style={styles.sideRow}>
          {(['buy', 'sell'] as const).map((s) => (
            <TouchableOpacity
              key={s}
              style={[styles.sideBtn, side === s && (s === 'buy' ? styles.buyOn : styles.sellOn)]}
              onPress={() => setSide(s)}
            >
              <Text style={[styles.sideTxt, side === s && styles.sideTxtOn]}>{s.toUpperCase()}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={styles.label}>Amount ({base})</Text>
        <TextInput
          style={styles.input}
          value={amount}
          onChangeText={setAmount}
          keyboardType="decimal-pad"
          placeholder="0.00"
          placeholderTextColor={Colors.textMuted}
        />
        <View style={styles.pctRow}>
          {PCTS.map((p) => (
            <TouchableOpacity key={p} style={styles.pctBtn} onPress={() => setPct(p)}>
              <Text style={styles.pctTxt}>{Math.round(p * 100)}%</Text>
            </TouchableOpacity>
          ))}
        </View>
        <Text style={styles.hint}>
          Price ≈ {formatPrice(price)} · Available {side === 'buy' ? `${quoteBal.toFixed(2)} USDT` : `${baseBal.toFixed(6)} ${base}`}
        </Text>
        <Button title={`${side === 'buy' ? 'Buy' : 'Sell'} ${base} @ market`} onPress={onSubmit} loading={loading} variant={side === 'buy' ? 'buy' : 'sell'} fullWidth />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  pairRow: { marginBottom: Spacing[4] },
  pairChip: {
    width: 96,
    padding: Spacing[3],
    marginRight: Spacing[2],
    borderRadius: Radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.surfaceBorder,
    backgroundColor: Colors.surfaceCard,
    alignItems: 'center',
    gap: 4,
  },
  pairChipActive: { borderColor: Colors.gold, backgroundColor: Colors.gold + '14' },
  pairTxt: { fontFamily: FontFamily.bold, fontSize: FontSize.sm, color: Colors.textSecondary },
  pairTxtActive: { color: Colors.goldLight },
  pairPx: { fontFamily: FontFamily.medium, fontSize: FontSize.xs, color: Colors.textMuted },
  sideRow: { flexDirection: 'row', gap: Spacing[2], marginBottom: Spacing[4] },
  sideBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: Radius.md,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
  },
  buyOn: { backgroundColor: Colors.buyGreen + '22', borderColor: Colors.buyGreen },
  sellOn: { backgroundColor: Colors.sellRed + '22', borderColor: Colors.sellRed },
  sideTxt: { fontFamily: FontFamily.bold, fontSize: FontSize.sm, color: Colors.textMuted },
  sideTxtOn: { color: Colors.textPrimary },
  label: { fontFamily: FontFamily.semiBold, fontSize: FontSize.sm, color: Colors.textSecondary },
  input: {
    marginTop: Spacing[2],
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.surfaceBorder,
    backgroundColor: Colors.surfaceCard,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing[3],
    paddingVertical: 12,
    fontFamily: FontFamily.medium,
    fontSize: FontSize.lg,
    color: Colors.textPrimary,
    textAlign: 'center',
  },
  pctRow: { flexDirection: 'row', gap: Spacing[2], marginTop: Spacing[3] },
  pctBtn: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    alignItems: 'center',
  },
  pctTxt: { fontFamily: FontFamily.semiBold, fontSize: FontSize.xs, color: Colors.textSecondary },
  hint: { fontFamily: FontFamily.regular, fontSize: FontSize.xs, color: Colors.textMuted, marginVertical: Spacing[3] },
});
