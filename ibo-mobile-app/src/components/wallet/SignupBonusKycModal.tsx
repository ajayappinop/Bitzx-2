import React from 'react';
import {
  Modal,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Pressable,
} from 'react-native';
import Icon from '@/components/common/AppIcon';
import { Colors, FontFamily, FontSize, Spacing, Radius } from '@/theme';
import type { SignupBonusPending } from '@/types/signupBonus.types';

type Props = {
  visible: boolean;
  prompt: SignupBonusPending | null;
  onDismiss: () => void;
  onCompleteKyc: () => void;
};

export default function SignupBonusKycModal({
  visible,
  prompt,
  onDismiss,
  onCompleteKyc,
}: Props) {
  if (!prompt?.show_prompt) return null;

  const amountLabel =
    prompt.amount_ibo != null && Number(prompt.amount_ibo) > 0
      ? `${Number(prompt.amount_ibo)} IBO`
      : null;
  const title =
    prompt.title
    || (amountLabel ? `${amountLabel} is waiting for you` : 'Your IBO signup bonus is waiting');
  const body =
    prompt.message
    || 'Complete identity verification (KYC) to receive it in your trading wallet.';

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onDismiss}>
      <Pressable style={styles.backdrop} onPress={onDismiss}>
        <Pressable style={styles.card} onPress={(e) => e.stopPropagation()}>
          <View style={styles.iconWrap}>
            <View style={styles.iconInner}>
              <Icon name="gift-outline" size={32} color={Colors.goldLight} />
            </View>
          </View>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.body}>{body}</Text>
          <View style={styles.actions}>
            <TouchableOpacity style={styles.primaryBtn} onPress={onCompleteKyc} activeOpacity={0.85}>
              <Text style={styles.primaryText}>Complete KYC</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.secondaryBtn} onPress={onDismiss} activeOpacity={0.85}>
              <Text style={styles.secondaryText}>Later</Text>
            </TouchableOpacity>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.72)',
    justifyContent: 'center',
    paddingHorizontal: Spacing[5],
  },
  card: {
    backgroundColor: Colors.surfaceCard,
    borderRadius: Radius.xl,
    borderWidth: 1,
    borderColor: Colors.goldAlpha30,
    padding: Spacing[5],
  },
  iconWrap: {
    alignSelf: 'center',
    marginBottom: Spacing[3],
  },
  iconInner: {
    width: 64,
    height: 64,
    borderRadius: 32,
    borderWidth: 1,
    borderColor: Colors.goldAlpha30,
    backgroundColor: Colors.goldAlpha10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontFamily: FontFamily.bold,
    fontSize: FontSize.lg,
    color: Colors.textPrimary,
    textAlign: 'center',
    marginBottom: Spacing[2],
  },
  body: {
    fontFamily: FontFamily.regular,
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: Spacing[5],
  },
  actions: { gap: Spacing[2] },
  primaryBtn: {
    backgroundColor: Colors.gold,
    borderRadius: Radius.lg,
    paddingVertical: Spacing[3],
    alignItems: 'center',
  },
  primaryText: {
    fontFamily: FontFamily.bold,
    fontSize: FontSize.sm,
    color: Colors.surfaceDark,
  },
  secondaryBtn: {
    paddingVertical: Spacing[2],
    alignItems: 'center',
  },
  secondaryText: {
    fontFamily: FontFamily.medium,
    fontSize: FontSize.sm,
    color: Colors.textMuted,
  },
});
