import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Colors, FontFamily, FontSize, Radius, Spacing } from '../../theme';

type BadgeTone = 'success' | 'danger' | 'warning' | 'info' | 'muted' | 'gold';

const TONE_MAP: Record<BadgeTone, { bg: string; text: string; border: string }> = {
  success: { bg: Colors.successDim, text: Colors.success, border: 'rgba(34,197,94,0.3)' },
  danger: { bg: Colors.dangerDim, text: Colors.danger, border: 'rgba(239,68,68,0.3)' },
  warning: { bg: Colors.warningDim, text: Colors.warning, border: 'rgba(245,158,11,0.3)' },
  info: { bg: Colors.infoDim, text: Colors.info, border: 'rgba(59,130,246,0.3)' },
  muted: { bg: Colors.white05, text: Colors.textMuted, border: Colors.surfaceBorder },
  gold: { bg: Colors.goldAlpha10, text: Colors.goldLight, border: Colors.goldAlpha15 },
};

const KYC_MAP: Record<string, BadgeTone> = {
  approved: 'success',
  pending: 'warning',
  under_review: 'info',
  rejected: 'danger',
  re_requested: 'warning',
  not_started: 'muted',
  unverified: 'muted',
};

const STATUS_LABEL: Record<string, string> = {
  approved: 'Verified',
  pending: 'Pending',
  under_review: 'Under Review',
  rejected: 'Rejected',
  re_requested: 'Re-requested',
  not_started: 'Not Started',
  unverified: 'Not Started',
  open: 'Open',
  filled: 'Filled',
  partially_filled: 'Partial',
  cancelled: 'Cancelled',
  completed: 'Completed',
  processing: 'Processing',
  failed: 'Failed',
};

interface StatusBadgeProps {
  status: string;
  tone?: BadgeTone;
  label?: string;
  small?: boolean;
}

export default function StatusBadge({ status, tone, label, small }: StatusBadgeProps) {
  const resolvedTone = tone ?? KYC_MAP[status] ?? 'muted';
  const t = TONE_MAP[resolvedTone];
  const displayLabel = label ?? STATUS_LABEL[status] ?? status;

  return (
    <View style={[styles.badge, { backgroundColor: t.bg, borderColor: t.border }, small && styles.small]}>
      <Text style={[styles.text, { color: t.text }, small && styles.textSmall]}>
        {displayLabel}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    borderWidth: 1,
    borderRadius: Radius.full,
    paddingHorizontal: Spacing[3],
    paddingVertical: 3,
    alignSelf: 'flex-start',
  },
  small: {
    paddingHorizontal: Spacing[2],
    paddingVertical: 2,
  },
  text: {
    fontFamily: FontFamily.medium,
    fontSize: FontSize.xs,
    letterSpacing: 0.3,
  },
  textSmall: {
    fontSize: 10,
  },
});
