import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, Modal, StyleSheet, TouchableOpacity, Pressable, ScrollView,
} from 'react-native';
import AppIcon from '../common/AppIcon';
import Button from '../common/Button';
import { Colors, FontFamily, FontSize, Spacing, Radius } from '../../theme';
import { LayoutColors } from '../../theme/colors';
import { CHART_INDICATORS, type ChartIndicatorId } from './chartIndicators';
import {
  DEFAULT_MINI_CHART_SETTINGS,
  TV_CHART_STYLES,
  TV_EXTRA_STUDIES,
  type MiniChartSettings,
  type TvChartStyle,
} from './chartIndicatorTvStudies';

type Props = {
  visible: boolean;
  settings: MiniChartSettings;
  usesTvEmbed: boolean;
  onClose: () => void;
  onApply: (next: MiniChartSettings) => void;
};

export default function ChartMiniSettingsModal({
  visible,
  settings,
  usesTvEmbed,
  onClose,
  onApply,
}: Props) {
  const [draft, setDraft] = useState<MiniChartSettings>(settings);

  useEffect(() => {
    if (visible) setDraft(settings);
  }, [visible, settings]);

  const toggleIndicator = useCallback((id: ChartIndicatorId) => {
    setDraft((prev) => ({
      ...prev,
      indicators: prev.indicators.includes(id)
        ? prev.indicators.filter((x) => x !== id)
        : [...prev.indicators, id],
    }));
  }, []);

  const toggleExtra = useCallback((id: string) => {
    setDraft((prev) => ({
      ...prev,
      extraStudies: prev.extraStudies.includes(id)
        ? prev.extraStudies.filter((x) => x !== id)
        : [...prev.extraStudies, id],
    }));
  }, []);

  const setStyle = useCallback((chartStyle: TvChartStyle) => {
    setDraft((prev) => ({ ...prev, chartStyle }));
  }, []);

  const handleReset = useCallback(() => {
    setDraft({ ...DEFAULT_MINI_CHART_SETTINGS });
  }, []);

  const handleApply = useCallback(() => {
    onApply(draft);
    onClose();
  }, [draft, onApply, onClose]);

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={styles.sheet}>
        <View style={styles.handle} />
        <View style={styles.header}>
          <Text style={styles.title}>Chart settings</Text>
          <TouchableOpacity onPress={onClose} hitSlop={8}>
            <AppIcon name="x" size={18} color={Colors.textMuted} />
          </TouchableOpacity>
        </View>

        <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
          {usesTvEmbed ? (
            <>
              <Text style={styles.sectionLabel}>Chart type</Text>
              <Text style={styles.hint}>Same styles as the expanded TradingView chart.</Text>
              <View style={styles.chipRow}>
                {TV_CHART_STYLES.map((s) => {
                  const on = draft.chartStyle === s.id;
                  return (
                    <TouchableOpacity
                      key={s.id}
                      style={[styles.chip, on && styles.chipOn]}
                      onPress={() => setStyle(s.id)}
                      activeOpacity={0.85}
                    >
                      <Text style={[styles.chipText, on && styles.chipTextOn]}>{s.label}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              <Text style={[styles.sectionLabel, styles.sectionSpaced]}>Display</Text>
              <TouchableOpacity
                style={[styles.item, draft.showLegend && styles.itemOn]}
                onPress={() => setDraft((p) => ({ ...p, showLegend: !p.showLegend }))}
                activeOpacity={0.85}
              >
                <View style={[styles.check, draft.showLegend && styles.checkOn]}>
                  {draft.showLegend ? <AppIcon name="check" size={12} color={Colors.surfaceDark} /> : null}
                </View>
                <View style={styles.itemBody}>
                  <Text style={[styles.itemText, draft.showLegend && styles.itemTextOn]}>Legend</Text>
                  <Text style={styles.itemSub}>Show series legend on the chart</Text>
                </View>
              </TouchableOpacity>
            </>
          ) : null}

          <Text style={[styles.sectionLabel, usesTvEmbed && styles.sectionSpaced]}>Indicators</Text>
          <Text style={styles.hint}>
            {usesTvEmbed
              ? 'Studies load on the mini chart the same way as on the expanded TradingView chart.'
              : 'Overlays and panes for the exchange chart.'}
          </Text>

          {CHART_INDICATORS.map((id) => {
            const on = draft.indicators.includes(id);
            return (
              <TouchableOpacity
                key={id}
                style={[styles.item, on && styles.itemOn]}
                onPress={() => toggleIndicator(id)}
                activeOpacity={0.85}
              >
                <View style={[styles.check, on && styles.checkOn]}>
                  {on ? <AppIcon name="check" size={12} color={Colors.surfaceDark} /> : null}
                </View>
                <Text style={[styles.itemText, on && styles.itemTextOn]}>{id}</Text>
              </TouchableOpacity>
            );
          })}

          {usesTvEmbed ? (
            <>
              <Text style={[styles.sectionLabel, styles.sectionSpaced]}>More TradingView studies</Text>
              <Text style={styles.hint}>Extra studies from the expanded chart library.</Text>
              {TV_EXTRA_STUDIES.map((row) => {
                const on = draft.extraStudies.includes(row.id);
                return (
                  <TouchableOpacity
                    key={row.id}
                    style={[styles.item, on && styles.itemOn]}
                    onPress={() => toggleExtra(row.id)}
                    activeOpacity={0.85}
                  >
                    <View style={[styles.check, on && styles.checkOn]}>
                      {on ? <AppIcon name="check" size={12} color={Colors.surfaceDark} /> : null}
                    </View>
                    <Text style={[styles.itemText, on && styles.itemTextOn]}>{row.label}</Text>
                  </TouchableOpacity>
                );
              })}
            </>
          ) : null}
        </ScrollView>

        <View style={styles.footer}>
          <TouchableOpacity onPress={handleReset} style={styles.resetBtn}>
            <Text style={styles.resetText}>Clear all</Text>
          </TouchableOpacity>
          <Button title="Apply" onPress={handleApply} size="md" />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  sheet: {
    backgroundColor: Colors.surfaceCard,
    borderTopLeftRadius: Radius.xl,
    borderTopRightRadius: Radius.xl,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    paddingHorizontal: Spacing[4],
    paddingBottom: Spacing[6],
    maxHeight: '78%',
  },
  handle: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: Colors.surfaceBorder,
    marginTop: Spacing[2],
    marginBottom: Spacing[3],
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: Spacing[2],
  },
  title: {
    fontFamily: FontFamily.bold,
    fontSize: FontSize.lg,
    color: Colors.textPrimary,
  },
  scroll: {
    maxHeight: 420,
  },
  scrollContent: {
    gap: Spacing[2],
    paddingBottom: Spacing[2],
  },
  sectionLabel: {
    fontFamily: FontFamily.semiBold,
    fontSize: FontSize.xs,
    color: Colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginBottom: 2,
  },
  sectionSpaced: {
    marginTop: Spacing[3],
  },
  hint: {
    fontFamily: FontFamily.regular,
    fontSize: FontSize.xs,
    color: Colors.textSecondary,
    lineHeight: 16,
    marginBottom: Spacing[2],
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: Spacing[1],
  },
  chip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: Radius.sm,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    backgroundColor: Colors.surface,
  },
  chipOn: {
    borderColor: LayoutColors.marketUp,
    backgroundColor: 'rgba(14,203,129,0.1)',
  },
  chipText: {
    fontFamily: FontFamily.semiBold,
    fontSize: FontSize.xs,
    color: Colors.textMuted,
  },
  chipTextOn: {
    color: LayoutColors.marketUp,
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing[3],
    paddingVertical: Spacing[2],
    paddingHorizontal: Spacing[3],
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    backgroundColor: Colors.surface,
  },
  itemOn: {
    borderColor: LayoutColors.marketUp,
    backgroundColor: 'rgba(14,203,129,0.06)',
  },
  itemBody: {
    flex: 1,
  },
  check: {
    width: 20,
    height: 20,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkOn: {
    backgroundColor: LayoutColors.marketUp,
    borderColor: LayoutColors.marketUp,
  },
  itemText: {
    fontFamily: FontFamily.semiBold,
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
  },
  itemTextOn: {
    color: Colors.textPrimary,
  },
  itemSub: {
    fontFamily: FontFamily.regular,
    fontSize: 10,
    color: Colors.textMuted,
    marginTop: 1,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: Spacing[4],
    gap: Spacing[3],
  },
  resetBtn: {
    paddingVertical: Spacing[2],
    paddingHorizontal: Spacing[1],
  },
  resetText: {
    fontFamily: FontFamily.semiBold,
    fontSize: FontSize.sm,
    color: Colors.goldLight,
  },
});
