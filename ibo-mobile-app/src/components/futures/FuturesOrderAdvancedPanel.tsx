/**
 * Collapsible advanced futures order options (compact terminal layout).
 */
import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, TextInput } from 'react-native';
import Icon from '../common/AppIcon';
import { Colors, FontFamily, FontSize, Spacing, Radius } from '../../theme';
import type { FuturesOrderType } from './OrderTypePickerModal';

type TIF = 'GTC' | 'IOC' | 'FOK';

type Props = {
  orderType: FuturesOrderType;
  reduceOnly: boolean;
  onReduceOnlyChange: (v: boolean) => void;
  postOnly: boolean;
  onPostOnlyChange: (v: boolean) => void;
  tif: TIF;
  onTifChange: (t: TIF) => void;
  tpPrice: string;
  onTpPriceChange: (v: string) => void;
  slPrice: string;
  onSlPriceChange: (v: string) => void;
  trailingPercent: string;
  onTrailingPercentChange: (v: string) => void;
  trailingOffset: string;
  onTrailingOffsetChange: (v: string) => void;
  /** Fired when the panel is expanded or collapsed (e.g. parent scrolls form). */
  onOpenChange?: (open: boolean) => void;
};

function ToggleChip({
  label,
  on,
  onPress,
}: {
  label: string;
  on: boolean;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      style={[styles.chip, on && styles.chipOn]}
      onPress={onPress}
      activeOpacity={0.85}
    >
      <Text style={[styles.chipTxt, on && styles.chipTxtOn]}>{label}</Text>
    </TouchableOpacity>
  );
}

function Field({
  label,
  value,
  onChangeText,
  unit,
  placeholder = 'Optional',
}: {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  unit: string;
  placeholder?: string;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <View style={styles.fieldBox}>
        <TextInput
          style={styles.fieldInput}
          keyboardType="decimal-pad"
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={Colors.textDisabled}
          selectionColor={Colors.gold}
        />
        <Text style={styles.fieldUnit}>{unit}</Text>
      </View>
    </View>
  );
}

export default function FuturesOrderAdvancedPanel({
  orderType,
  reduceOnly,
  onReduceOnlyChange,
  postOnly,
  onPostOnlyChange,
  tif,
  onTifChange,
  tpPrice,
  onTpPriceChange,
  slPrice,
  onSlPriceChange,
  trailingPercent,
  onTrailingPercentChange,
  trailingOffset,
  onTrailingOffsetChange,
  onOpenChange,
}: Props) {
  const [open, setOpen] = useState(false);

  const toggleOpen = () => {
    setOpen((v) => {
      const next = !v;
      onOpenChange?.(next);
      return next;
    });
  };

  const showBracket =
    (orderType === 'limit' || orderType === 'market') && !reduceOnly;
  const showTrailing =
    orderType === 'stop_limit' || orderType === 'stop_market' || orderType === 'take_profit';
  const showPostOnly = orderType === 'limit';

  const summary = useMemo(() => {
    const parts: string[] = [];
    if (showBracket && (tpPrice || slPrice)) parts.push('TP/SL');
    if (showTrailing && (trailingPercent || trailingOffset)) {
      parts.push(trailingPercent ? `${trailingPercent}% trail` : 'Trail offset');
    } else if (showTrailing) {
      parts.push('Trailing %');
    }
    if (reduceOnly) parts.push('Reduce');
    if (postOnly) parts.push('Post');
    if (tif !== 'GTC') parts.push(tif);
    return parts.length ? parts.join(' · ') : 'Optional';
  }, [
    showBracket,
    showTrailing,
    tpPrice,
    slPrice,
    trailingPercent,
    trailingOffset,
    reduceOnly,
    postOnly,
    tif,
  ]);

  return (
    <View style={styles.wrap}>
      <TouchableOpacity
        style={styles.header}
        onPress={toggleOpen}
        activeOpacity={0.88}
      >
        <View style={styles.headerLeft}>
          <Text style={styles.headerTitle}>Advanced</Text>
          {!open ? <Text style={styles.headerSummary} numberOfLines={1}>{summary}</Text> : null}
        </View>
        <Icon
          name={open ? 'chevron-up' : 'chevron-down'}
          size={18}
          color={Colors.textMuted}
        />
      </TouchableOpacity>

      {open ? (
        <View style={styles.body}>
          {showBracket ? (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Take profit / Stop loss</Text>
              <Text style={styles.sectionHint}>Attached to this entry when supported.</Text>
              <Field
                label="Take profit"
                value={tpPrice}
                onChangeText={onTpPriceChange}
                unit="USDT"
              />
              <Field
                label="Stop loss"
                value={slPrice}
                onChangeText={onSlPriceChange}
                unit="USDT"
              />
            </View>
          ) : null}

          {showTrailing ? (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Trailing stop</Text>
              <Text style={styles.sectionHint}>
                Use trailing % or a fixed USDT offset — not both required. Stop moves as mark price moves.
              </Text>
              <Field
                label="Trailing %"
                value={trailingPercent}
                onChangeText={onTrailingPercentChange}
                unit="%"
                placeholder="e.g. 1"
              />
              <Field
                label="Trailing offset"
                value={trailingOffset}
                onChangeText={onTrailingOffsetChange}
                unit="USDT"
                placeholder="e.g. 50"
              />
            </View>
          ) : (
            <View style={styles.section}>
              <Text style={styles.sectionHint}>
                Trailing % is available for Stop limit, Stop market, and Take profit order types.
              </Text>
            </View>
          )}

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Options</Text>
            <View style={styles.chipRow}>
              <ToggleChip
                label="Reduce only"
                on={reduceOnly}
                onPress={() => onReduceOnlyChange(!reduceOnly)}
              />
              {showPostOnly ? (
                <ToggleChip
                  label="Post only"
                  on={postOnly}
                  onPress={() => onPostOnlyChange(!postOnly)}
                />
              ) : null}
            </View>
          </View>

          <View style={[styles.section, styles.sectionLast]}>
            <Text style={styles.sectionTitle}>Time in force</Text>
            <View style={styles.tifRow}>
              {(['GTC', 'IOC', 'FOK'] as TIF[]).map((t) => {
                const active = tif === t;
                return (
                  <TouchableOpacity
                    key={t}
                    style={[styles.tifSegment, active && styles.tifSegmentOn]}
                    onPress={() => onTifChange(t)}
                    activeOpacity={0.88}
                  >
                    <Text style={[styles.tifTxt, active && styles.tifTxtOn]}>{t}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginHorizontal: Spacing[1],
    marginBottom: Spacing[2],
    borderRadius: Radius.lg,
    backgroundColor: Colors.surfaceCard,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.surfaceBorder,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: Spacing[2],
    paddingHorizontal: Spacing[3],
    minHeight: 40,
  },
  headerLeft: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing[2],
    paddingRight: Spacing[2],
  },
  headerTitle: {
    fontFamily: FontFamily.semiBold,
    fontSize: FontSize.sm,
    color: Colors.textPrimary,
  },
  headerSummary: {
    flex: 1,
    fontFamily: FontFamily.regular,
    fontSize: FontSize.xs,
    color: Colors.textMuted,
  },
  body: {
    paddingHorizontal: Spacing[3],
    paddingBottom: Spacing[3],
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Colors.surfaceBorder,
  },
  section: {
    paddingTop: Spacing[3],
    paddingBottom: Spacing[1],
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.surfaceBorder,
    gap: Spacing[2],
  },
  sectionLast: {
    borderBottomWidth: 0,
    paddingBottom: 0,
  },
  sectionTitle: {
    fontFamily: FontFamily.semiBold,
    fontSize: FontSize.xs,
    color: Colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  sectionHint: {
    fontFamily: FontFamily.regular,
    fontSize: 10,
    color: Colors.textMuted,
    marginTop: -4,
    marginBottom: Spacing[1],
  },
  field: {
    gap: 4,
  },
  fieldLabel: {
    fontFamily: FontFamily.medium,
    fontSize: 10,
    color: Colors.textMuted,
  },
  fieldBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surfaceHover,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing[2],
    minHeight: 38,
  },
  fieldInput: {
    flex: 1,
    fontFamily: FontFamily.mono,
    fontSize: FontSize.sm,
    color: Colors.textPrimary,
    paddingVertical: 8,
    textAlign: 'center',
  },
  fieldUnit: {
    fontFamily: FontFamily.medium,
    fontSize: 10,
    color: Colors.textMuted,
    marginLeft: Spacing[2],
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing[2],
  },
  chip: {
    paddingHorizontal: Spacing[3],
    paddingVertical: 8,
    borderRadius: Radius.md,
    backgroundColor: Colors.surfaceHover,
  },
  chipOn: {
    backgroundColor: Colors.goldAlpha10,
  },
  chipTxt: {
    fontFamily: FontFamily.medium,
    fontSize: FontSize.xs,
    color: Colors.textMuted,
  },
  chipTxtOn: {
    color: Colors.goldLight,
    fontFamily: FontFamily.semiBold,
  },
  tifRow: {
    flexDirection: 'row',
    backgroundColor: Colors.surfaceHover,
    borderRadius: Radius.md,
    padding: 3,
    gap: 3,
  },
  tifSegment: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: Radius.sm,
    alignItems: 'center',
  },
  tifSegmentOn: {
    backgroundColor: Colors.surfaceCard,
  },
  tifTxt: {
    fontFamily: FontFamily.semiBold,
    fontSize: FontSize.xs,
    color: Colors.textMuted,
  },
  tifTxtOn: {
    color: Colors.textPrimary,
  },
});
