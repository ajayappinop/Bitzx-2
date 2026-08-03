/**
 * DepositSuccessModal
 *
 * Celebratory pop-up shown the moment the on-demand deposit monitor detects
 * a new incoming transaction. Mirrors the web app's modal so the experience
 * feels consistent across platforms. Copy adapts to `deposit.status` —
 * fully credited vs still confirming on-chain.
 */

import React, { useEffect, useRef } from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  TouchableWithoutFeedback,
  Animated,
  StyleSheet,
} from 'react-native';
import Icon from '@/components/common/AppIcon';
import { Colors, FontFamily, FontSize, Spacing, Radius } from '../../theme';
import type { DetectedDeposit } from '../../hooks/useDepositDetectedModal';

const CREDITED_STATUSES = new Set(['credited', 'approved']);

function fmtAmount(v: unknown) {
  const n = Number(v);
  if (!Number.isFinite(n)) return String(v ?? '');
  return n.toLocaleString(undefined, { maximumFractionDigits: 8 });
}

export default function DepositSuccessModal({
  visible,
  onClose,
  deposit,
  onViewHistory,
}: {
  visible: boolean;
  onClose: () => void;
  deposit: DetectedDeposit | null;
  onViewHistory?: () => void;
}) {
  const scale = useRef(new Animated.Value(0.85)).current;
  const opacity = useRef(new Animated.Value(0)).current;
  const iconScale = useRef(new Animated.Value(0.3)).current;

  useEffect(() => {
    if (visible) {
      scale.setValue(0.85);
      opacity.setValue(0);
      iconScale.setValue(0.3);
      Animated.parallel([
        Animated.timing(opacity, { toValue: 1, duration: 180, useNativeDriver: true }),
        Animated.spring(scale, { toValue: 1, damping: 16, stiffness: 260, useNativeDriver: true }),
        Animated.spring(iconScale, { toValue: 1, damping: 12, stiffness: 220, delay: 90, useNativeDriver: true }),
      ]).start();
    }
  }, [visible, scale, opacity, iconScale]);

  if (!deposit) return null;

  const isCredited = CREDITED_STATUSES.has(String(deposit.status || '').toLowerCase());

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <TouchableWithoutFeedback onPress={onClose}>
        <View style={styles.overlay}>
          <TouchableWithoutFeedback onPress={() => {}}>
            <Animated.View style={[styles.card, { opacity, transform: [{ scale }] }]}>
              <TouchableOpacity style={styles.closeBtn} onPress={onClose} accessibilityLabel="Close">
                <Icon name="close" size={18} color={Colors.textMuted} />
              </TouchableOpacity>

              <Animated.View
                style={[
                  styles.iconWrap,
                  isCredited ? styles.iconWrapSuccess : styles.iconWrapPending,
                  { transform: [{ scale: iconScale }] },
                ]}
              >
                <Icon
                  name={isCredited ? 'check-circle' : 'clock-outline'}
                  size={38}
                  color={isCredited ? Colors.success : Colors.info}
                />
              </Animated.View>

              <Text style={styles.title}>
                {isCredited ? 'Deposit successful!' : 'Deposit detected!'}
              </Text>
              <Text style={styles.body}>
                {isCredited
                  ? 'Your transaction was found on-chain and credited to your wallet.'
                  : 'Your transaction was found on-chain and is confirming now — your balance will update automatically.'}
              </Text>

              {(deposit.asset || deposit.amount != null) && (
                <View style={styles.amountBox}>
                  <Text style={styles.amountLabel}>AMOUNT</Text>
                  <Text style={styles.amountValue} numberOfLines={1}>
                    +{fmtAmount(deposit.amount)} {deposit.asset}
                  </Text>
                </View>
              )}

              {deposit.network ? (
                <Text style={styles.networkText}>
                  via <Text style={styles.networkBold}>{deposit.network}</Text>
                </Text>
              ) : null}

              <View style={styles.actionsRow}>
                <TouchableOpacity style={styles.closeAction} onPress={onClose}>
                  <Text style={styles.closeActionText}>Close</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.primaryAction}
                  onPress={() => {
                    onClose();
                    onViewHistory?.();
                  }}
                >
                  <Text style={styles.primaryActionText}>View history</Text>
                  <Icon name="arrow-right" size={14} color={Colors.surfaceDark} />
                </TouchableOpacity>
              </View>
            </Animated.View>
          </TouchableWithoutFeedback>
        </View>
      </TouchableWithoutFeedback>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.72)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing[5],
  },
  card: {
    width: '100%',
    maxWidth: 360,
    borderRadius: Radius.xl + 4,
    borderWidth: 1,
    borderColor: Colors.goldAlpha30,
    backgroundColor: Colors.surfaceCard,
    paddingHorizontal: Spacing[6],
    paddingTop: Spacing[8],
    paddingBottom: Spacing[6],
    alignItems: 'center',
  },
  closeBtn: {
    position: 'absolute',
    top: Spacing[3],
    right: Spacing[3],
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconWrap: {
    width: 76,
    height: 76,
    borderRadius: 38,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing[4],
  },
  iconWrapSuccess: { backgroundColor: Colors.successDim },
  iconWrapPending: { backgroundColor: Colors.infoDim },
  title: {
    fontFamily: FontFamily.bold,
    fontSize: FontSize.xl,
    color: Colors.textPrimary,
    textAlign: 'center',
  },
  body: {
    fontFamily: FontFamily.regular,
    fontSize: FontSize.sm,
    color: Colors.textMuted,
    textAlign: 'center',
    lineHeight: 20,
    marginTop: Spacing[2],
  },
  amountBox: {
    marginTop: Spacing[5],
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    borderRadius: Radius.lg,
    paddingHorizontal: Spacing[4],
    paddingVertical: Spacing[3],
  },
  amountLabel: {
    fontFamily: FontFamily.bold,
    fontSize: FontSize.xs,
    color: Colors.textMuted,
    letterSpacing: 1,
  },
  amountValue: {
    fontFamily: FontFamily.mono,
    fontSize: FontSize.base,
    fontWeight: '700' as any,
    color: Colors.goldLight,
  },
  networkText: {
    marginTop: Spacing[2],
    fontFamily: FontFamily.regular,
    fontSize: FontSize.xs,
    color: Colors.textMuted,
  },
  networkBold: {
    fontFamily: FontFamily.semiBold,
    color: Colors.textSecondary,
  },
  actionsRow: {
    flexDirection: 'row',
    gap: Spacing[3],
    marginTop: Spacing[6],
    width: '100%',
  },
  closeAction: {
    flex: 1,
    paddingVertical: Spacing[3],
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeActionText: {
    fontFamily: FontFamily.bold,
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
  },
  primaryAction: {
    flex: 1,
    flexDirection: 'row',
    gap: Spacing[2],
    paddingVertical: Spacing[3],
    borderRadius: Radius.lg,
    backgroundColor: Colors.goldLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryActionText: {
    fontFamily: FontFamily.bold,
    fontSize: FontSize.sm,
    color: Colors.surfaceDark,
  },
});
