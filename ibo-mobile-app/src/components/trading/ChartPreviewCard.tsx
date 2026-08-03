/**
 * Trade / futures mini chart — timeframe pills, indicator bar, TradingView embed or LWC fallback.
 */
import React, { useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
} from 'react-native';
import type { Kline } from '../../types/market.types';
import { Colors, FontFamily, FontSize, Spacing, Radius, LayoutColors } from '../../theme';
import { useKlinesFeed } from '../../hooks/useKlinesFeed';
import { canUseTradingViewWidget } from '../../utils/tradingViewWidgetSymbol';
import TradingViewChart, { CHART_INTERACTIVE_MODE } from './TradingViewChart';
import TradingViewMiniChart from './TradingViewMiniChart';
import ChartGestureHost from './ChartGestureHost';
import ChartMiniIndicatorBar from './ChartMiniIndicatorBar';
import ChartMiniSettingsModal from './ChartMiniSettingsModal';
import {
  DEFAULT_MINI_CHART_SETTINGS,
  type MiniChartSettings,
} from './chartIndicatorTvStudies';
import {
  CHART_PREVIEW_INTERVALS,
  CHART_KLINE_LIMITS,
  CHART_INTERVAL_TOOLBAR_H,
  CHART_MINI_INDICATOR_BAR_H,
  type ChartInterval,
} from './chartIntervals';

type Props = {
  symbol: string;
  height: number;
  width: number;
  livePrice?: number;
  seedKlines?: Kline[];
  showIntervals?: boolean;
  compactIntervals?: boolean;
  showIndicatorBar?: boolean;
  onLockParentScroll?: (locked: boolean) => void;
};

export default function ChartPreviewCard({
  symbol,
  height,
  width,
  livePrice,
  seedKlines,
  showIntervals = true,
  compactIntervals = false,
  showIndicatorBar = true,
  onLockParentScroll,
}: Props) {
  const [interval, setInterval] = useState<ChartInterval>('1h');
  const [chartSettings, setChartSettings] = useState<MiniChartSettings>({
    ...DEFAULT_MINI_CHART_SETTINGS,
  });
  const [settingsOpen, setSettingsOpen] = useState(false);

  const usesTvEmbed = useMemo(() => canUseTradingViewWidget(symbol), [symbol]);
  const indicators = chartSettings.indicators;
  const indicatorKeys = useMemo(() => indicators as string[], [indicators]);
  const activeCount = indicators.length + chartSettings.extraStudies.length
    + (chartSettings.chartStyle !== DEFAULT_MINI_CHART_SETTINGS.chartStyle ? 1 : 0)
    + (chartSettings.showLegend ? 1 : 0);

  const limit = CHART_KLINE_LIMITS[interval];
  const { klines, loading } = useKlinesFeed(symbol, interval, limit, {
    seed: interval === '1h' ? seedKlines : undefined,
  });

  const toolbarH = showIntervals
    ? (compactIntervals ? CHART_INTERVAL_TOOLBAR_H : 40)
    : (showIndicatorBar ? CHART_MINI_INDICATOR_BAR_H : 0);
  const chartH = height - toolbarH;

  return (
    <View style={styles.card}>
      {showIntervals ? (
        <View style={[styles.toolbar, compactIntervals && styles.toolbarCompact]}>
          {CHART_PREVIEW_INTERVALS.map((iv) => {
            const active = interval === iv;
            return (
              <TouchableOpacity
                key={iv}
                style={[
                  styles.tfBtn,
                  compactIntervals && styles.tfBtnCompact,
                  active && styles.tfBtnActive,
                ]}
                onPress={() => setInterval(iv)}
                activeOpacity={0.75}
              >
                <Text style={[
                  styles.tfText,
                  compactIntervals && styles.tfTextCompact,
                  active && styles.tfTextActive,
                ]}
                >
                  {iv}
                </Text>
              </TouchableOpacity>
            );
          })}
          {showIndicatorBar ? (
            <View style={styles.indicatorSlot}>
              <ChartMiniIndicatorBar
                activeCount={activeCount}
                onOpenIndicators={() => setSettingsOpen(true)}
              />
            </View>
          ) : null}
        </View>
      ) : showIndicatorBar ? (
        <ChartMiniIndicatorBar
          activeCount={activeCount}
          onOpenIndicators={() => setSettingsOpen(true)}
        />
      ) : null}

      <ChartGestureHost
        style={[styles.chartHost, { height: chartH }]}
        onLockParentScroll={onLockParentScroll}
      >
        {usesTvEmbed ? (
          <TradingViewMiniChart
            symbol={symbol}
            interval={interval}
            indicators={indicators}
            extraStudies={chartSettings.extraStudies}
            chartStyle={chartSettings.chartStyle}
            showLegend={chartSettings.showLegend}
            height={chartH}
            width={width}
          />
        ) : (
          <TradingViewChart
            klines={klines}
            livePrice={livePrice}
            height={chartH}
            width={width}
            mode={CHART_INTERACTIVE_MODE}
            indicators={indicatorKeys}
            compact={chartH < 260}
            keepAliveWhenHidden
          />
        )}
        {!usesTvEmbed && loading && klines.length === 0 ? (
          <View style={styles.emptyOverlay} pointerEvents="none">
            <Text style={styles.emptyText}>Loading chart…</Text>
          </View>
        ) : null}
      </ChartGestureHost>

      <ChartMiniSettingsModal
        visible={settingsOpen}
        settings={chartSettings}
        usesTvEmbed={usesTvEmbed}
        onClose={() => setSettingsOpen(false)}
        onApply={setChartSettings}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.surface,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.surfaceBorder,
  },
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingBottom: Spacing[1],
    gap: 6,
    flexWrap: 'nowrap',
  },
  toolbarCompact: {
    paddingBottom: 2,
    gap: 4,
  },
  indicatorSlot: {
    marginLeft: 'auto',
    paddingBottom: 0,
  },
  tfBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: Radius.sm,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  tfBtnCompact: {
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  tfBtnActive: {
    borderColor: LayoutColors.marketUp,
    backgroundColor: 'rgba(14,203,129,0.12)',
  },
  tfText: {
    fontFamily: FontFamily.medium,
    fontSize: FontSize.xs,
    color: Colors.textMuted,
  },
  tfTextCompact: {
    fontSize: 10,
  },
  tfTextActive: {
    color: LayoutColors.marketUp,
  },
  chartHost: {
    width: '100%',
    overflow: 'hidden',
  },
  emptyOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(11,14,17,0.6)',
  },
  emptyText: {
    fontFamily: FontFamily.regular,
    fontSize: FontSize.sm,
    color: Colors.textMuted,
  },
});
