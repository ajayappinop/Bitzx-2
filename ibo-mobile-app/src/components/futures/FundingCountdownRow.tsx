import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Colors, FontFamily, FontSize, Spacing } from '@/theme';

type Props = {
  fundingRate: number | null;
  intervalHours?: number;
};

function msToNextFundingUtc(intervalH: number): number {
  const now = Date.now();
  const intervalMs = intervalH * 3600 * 1000;
  const epoch = Date.UTC(1970, 0, 1);
  const elapsed = now - epoch;
  const next = Math.ceil(elapsed / intervalMs) * intervalMs + epoch;
  return Math.max(0, next - now);
}

function formatCountdown(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export default function FundingCountdownRow({ fundingRate, intervalHours = 8 }: Props) {
  const [remaining, setRemaining] = useState(() => msToNextFundingUtc(intervalHours));

  useEffect(() => {
    const tick = () => setRemaining(msToNextFundingUtc(intervalHours));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [intervalHours]);

  const rateStr =
    fundingRate != null ? `${fundingRate >= 0 ? '+' : ''}${(fundingRate * 100).toFixed(4)}%` : '—';

  return (
    <View style={styles.row}>
      <Text style={styles.label}>Funding / Countdown</Text>
      <Text
        style={[
          styles.rate,
          fundingRate != null && {
            color: fundingRate >= 0 ? Colors.warning : Colors.buyGreen,
          },
        ]}
      >
        {rateStr}
      </Text>
      <Text style={styles.timer}>{formatCountdown(remaining)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing[3],
    paddingVertical: Spacing[2],
    marginBottom: Spacing[2],
    backgroundColor: Colors.surfaceHover,
    borderRadius: 8,
    marginHorizontal: Spacing[1],
  },
  label: {
    fontFamily: FontFamily.medium,
    fontSize: FontSize.xs,
    color: Colors.textMuted,
    flex: 1,
  },
  rate: {
    fontFamily: FontFamily.monoMedium,
    fontSize: FontSize.sm,
    color: Colors.textPrimary,
    marginRight: Spacing[3],
  },
  timer: {
    fontFamily: FontFamily.mono,
    fontSize: FontSize.sm,
    color: Colors.buyGreen,
  },
});
