import React, { useState } from 'react';
import {
  View, Text, Modal, StyleSheet, TouchableOpacity, TextInput, Alert, Platform,
} from 'react-native';
import { futuresApi } from '../../api/futures.api';
import { parseApiError } from '../../api/errors';
import Button from '../common/Button';
import Icon from '../common/AppIcon';
import { Colors, FontFamily, FontSize, Spacing, Radius } from '../../theme';
import AdaptiveKeyboardAvoidingView from '@/components/common/AdaptiveKeyboardAvoidingView';

type Props = {
  visible: boolean;
  onClose: () => void;
  onSuccess?: () => void;
};

export default function WalletTransferModal({ visible, onClose, onSuccess }: Props) {
  const [direction, setDirection] = useState<'spot_to_futures' | 'futures_to_spot'>('spot_to_futures');
  const [amount, setAmount] = useState('');
  const [loading, setLoading] = useState(false);

  const handleTransfer = async () => {
    const amt = parseFloat(amount);
    if (!amount || isNaN(amt) || amt <= 0) {
      Alert.alert('Transfer', 'Enter a valid amount');
      return;
    }
    setLoading(true);
    try {
      await futuresApi.transfer({ direction, amount: amt, asset: 'USDT' });
      setAmount('');
      onClose();
      onSuccess?.();
    } catch (err) {
      Alert.alert('Transfer failed', parseApiError(err).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <AdaptiveKeyboardAvoidingView
        style={styles.overlay}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={onClose} />
        <View style={styles.sheet}>
          <View style={styles.handle} />
          <Text style={styles.title}>Transfer USDT</Text>
          <Text style={styles.sub}>Move funds between Spot and Futures wallets</Text>

          <View style={styles.dirRow}>
            {(['spot_to_futures', 'futures_to_spot'] as const).map((dir) => (
              <TouchableOpacity
                key={dir}
                style={[styles.dirBtn, direction === dir && styles.dirBtnActive]}
                onPress={() => setDirection(dir)}
              >
                <Text style={[styles.dirTxt, direction === dir && styles.dirTxtActive]}>
                  {dir === 'spot_to_futures' ? 'Spot → Futures' : 'Futures → Spot'}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={styles.label}>Amount (USDT)</Text>
          <TextInput
            style={styles.input}
            value={amount}
            onChangeText={setAmount}
            keyboardType="decimal-pad"
            placeholder="0.00"
            placeholderTextColor={Colors.textMuted}
          />

          <View style={styles.actions}>
            <Button title="Cancel" variant="ghost" onPress={onClose} />
            <Button title="Transfer" onPress={handleTransfer} loading={loading} />
          </View>

          <TouchableOpacity style={styles.closeIcon} onPress={onClose}>
            <Icon name="x" size={20} color={Colors.textSecondary} />
          </TouchableOpacity>
        </View>
      </AdaptiveKeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(0,0,0,0.5)' },
  sheet: {
    backgroundColor: Colors.surfaceCard,
    borderTopLeftRadius: Radius.xl,
    borderTopRightRadius: Radius.xl,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    padding: Spacing[5],
    paddingBottom: Spacing[8],
  },
  handle: {
    width: 40, height: 4, borderRadius: 2,
    backgroundColor: Colors.surfaceBorder,
    alignSelf: 'center', marginBottom: Spacing[4],
  },
  title: {
    fontFamily: FontFamily.bold,
    fontSize: FontSize.lg,
    color: Colors.textPrimary,
  },
  sub: {
    fontFamily: FontFamily.regular,
    fontSize: FontSize.xs,
    color: Colors.textMuted,
    marginTop: 4,
    marginBottom: Spacing[4],
  },
  dirRow: { flexDirection: 'row', gap: Spacing[2], marginBottom: Spacing[4] },
  dirBtn: {
    flex: 1,
    paddingVertical: Spacing[3],
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    alignItems: 'center',
  },
  dirBtnActive: {
    borderColor: Colors.goldAlpha30,
    backgroundColor: Colors.goldAlpha15,
  },
  dirTxt: {
    fontFamily: FontFamily.medium,
    fontSize: FontSize.xs,
    color: Colors.textSecondary,
  },
  dirTxtActive: { color: Colors.goldLight },
  label: {
    fontFamily: FontFamily.medium,
    fontSize: FontSize.xs,
    color: Colors.textMuted,
    marginBottom: Spacing[2],
  },
  input: {
    backgroundColor: Colors.surfaceElevated,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    borderRadius: Radius.lg,
    paddingHorizontal: Spacing[4],
    paddingVertical: Spacing[3],
    fontFamily: FontFamily.monoMedium,
    fontSize: FontSize.base,
    color: Colors.textPrimary,
    marginBottom: Spacing[4],
  },
  actions: { flexDirection: 'row', gap: Spacing[3], justifyContent: 'flex-end' },
  closeIcon: { position: 'absolute', top: Spacing[5], right: Spacing[5] },
});
