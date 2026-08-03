import type { Kline } from '../../types/market.types';

export const CHART_INDICATORS = [
  'MA', 'EMA', 'BOLL', 'SAR', 'VOL', 'OBV', 'MACD', 'KDJ', 'RSI', 'WR',
] as const;

/** Drawn on the main candle pane (MA/EMA/BOLL/SAR overlays). */
export const CHART_OVERLAY_INDICATORS = ['MA', 'EMA', 'BOLL', 'SAR'] as const;

export type ChartIndicatorId = (typeof CHART_INDICATORS)[number];

export type LinePoint = { time: number; value: number };
export type HistPoint = { time: number; value: number; color?: string };

export type OverlaySeries = {
  id: string;
  data: LinePoint[];
  color: string;
  lineWidth?: number;
};

export type PaneSeries = {
  id: string;
  kind: 'line' | 'histogram';
  data: LinePoint[] | HistPoint[];
  color: string;
  lineWidth?: number;
};

export type PaneScaleOptions = {
  autoScale?: boolean;
  minimum?: number;
  maximum?: number;
};

export type IndicatorPane = {
  id: string;
  series: PaneSeries[];
  scale?: PaneScaleOptions;
};

export type IndicatorPayload = {
  vol: boolean;
  overlays: OverlaySeries[];
  panes: IndicatorPane[];
};

export type IndicatorReadoutChip = {
  key: string;
  label: string;
  value: string;
  color: string;
};

export type IndicatorReadoutGroup = {
  id: string;
  chips: IndicatorReadoutChip[];
};

const C = {
  ma7: '#F0B90B',
  ma25: '#AB47BC',
  ema12: '#29B6F6',
  ema26: '#FF9800',
  bollMid: '#848E9C',
  bollBand: '#5E6673',
  sar: '#0ECB81',
  macd: '#29B6F6',
  macdSignal: '#FF9800',
  macdHistUp: 'rgba(14,203,129,0.55)',
  macdHistDown: 'rgba(246,70,93,0.55)',
  rsi: '#AB47BC',
  kdjK: '#F0B90B',
  kdjD: '#29B6F6',
  kdjJ: '#FF5252',
  wr: '#FF7043',
  obv: '#26A69A',
  vol: '#848E9C',
};

function klineTime(t: number): number {
  const n = Number(t);
  return n > 1e12 ? Math.floor(n / 1000) : n;
}

function closes(klines: Kline[]): number[] {
  return klines.map((k) => Number(k.close));
}

function highs(klines: Kline[]): number[] {
  return klines.map((k) => Number(k.high));
}

function lows(klines: Kline[]): number[] {
  return klines.map((k) => Number(k.low));
}

function sma(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = [];
  for (let i = 0; i < values.length; i++) {
    if (i < period - 1) {
      out.push(null);
      continue;
    }
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) sum += values[j];
    out.push(sum / period);
  }
  return out;
}

function ema(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = [];
  const k = 2 / (period + 1);
  let prev: number | null = null;
  for (let i = 0; i < values.length; i++) {
    if (i < period - 1) {
      out.push(null);
      continue;
    }
    if (prev == null) {
      let sum = 0;
      for (let j = i - period + 1; j <= i; j++) sum += values[j];
      prev = sum / period;
    } else {
      prev = values[i] * k + prev * (1 - k);
    }
    out.push(prev);
  }
  return out;
}

function toLinePoints(klines: Kline[], values: (number | null)[]): LinePoint[] {
  const pts: LinePoint[] = [];
  for (let i = 0; i < klines.length; i++) {
    const v = values[i];
    if (v == null || !Number.isFinite(v)) continue;
    pts.push({ time: klineTime(klines[i].time), value: v });
  }
  return pts;
}

/** SAR points carry the candle close so the WebView can colour each segment. */
function toSarPoints(klines: Kline[], values: (number | null)[]): Array<{ time: number; value: number; close: number }> {
  const pts: Array<{ time: number; value: number; close: number }> = [];
  for (let i = 0; i < klines.length; i++) {
    const v = values[i];
    if (v == null || !Number.isFinite(v)) continue;
    pts.push({ time: klineTime(klines[i].time), value: v, close: Number(klines[i].close) });
  }
  return pts;
}

function stdDev(values: number[], period: number, i: number): number {
  let sum = 0;
  for (let j = i - period + 1; j <= i; j++) sum += values[j];
  const mean = sum / period;
  let sq = 0;
  for (let j = i - period + 1; j <= i; j++) {
    const d = values[j] - mean;
    sq += d * d;
  }
  return Math.sqrt(sq / period);
}

function calcBoll(klines: Kline[], period = 20, mult = 2) {
  const c = closes(klines);
  const mid: (number | null)[] = [];
  const upper: (number | null)[] = [];
  const lower: (number | null)[] = [];
  for (let i = 0; i < c.length; i++) {
    if (i < period - 1) {
      mid.push(null);
      upper.push(null);
      lower.push(null);
      continue;
    }
    const m = sma(c, period)[i]!;
    const sd = stdDev(c, period, i);
    mid.push(m);
    upper.push(m + mult * sd);
    lower.push(m - mult * sd);
  }
  return { mid, upper, lower };
}

function calcSar(klines: Kline[]): (number | null)[] {
  const h = highs(klines);
  const l = lows(klines);
  const n = klines.length;
  if (n < 2) return klines.map(() => null);

  const out: (number | null)[] = new Array(n).fill(null);
  let bull = true;
  let af = 0.02;
  let ep = h[0];
  let sar = l[0];
  out[0] = sar;

  for (let i = 1; i < n; i++) {
    sar = sar + af * (ep - sar);

    if (bull) {
      if (l[i] < sar) {
        bull = false;
        sar = ep;
        ep = l[i];
        af = 0.02;
      } else {
        if (h[i] > ep) {
          ep = h[i];
          af = Math.min(af + 0.02, 0.2);
        }
        if (i >= 2) sar = Math.min(sar, l[i - 1], l[i - 2]);
        else if (i >= 1) sar = Math.min(sar, l[i - 1]);
      }
    } else if (h[i] > sar) {
      bull = true;
      sar = ep;
      ep = h[i];
      af = 0.02;
    } else {
      if (l[i] < ep) {
        ep = l[i];
        af = Math.min(af + 0.02, 0.2);
      }
      if (i >= 2) sar = Math.max(sar, h[i - 1], h[i - 2]);
      else if (i >= 1) sar = Math.max(sar, h[i - 1]);
    }

    out[i] = sar;
  }
  return out;
}

function calcMacd(klines: Kline[]) {
  const c = closes(klines);
  const e12 = ema(c, 12);
  const e26 = ema(c, 26);
  const dif: (number | null)[] = c.map((_, i) => {
    if (e12[i] == null || e26[i] == null) return null;
    return e12[i]! - e26[i]!;
  });
  const difNums = dif.map((v) => v ?? 0);
  const dea = ema(difNums, 9);
  const hist: (number | null)[] = dif.map((d, i) => {
    if (d == null || dea[i] == null) return null;
    return d - dea[i]!;
  });
  return { dif, dea, hist };
}

function calcRsi(klines: Kline[], period = 14): (number | null)[] {
  const c = closes(klines);
  const out: (number | null)[] = new Array(c.length).fill(null);
  if (c.length <= period) return out;

  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i++) {
    const ch = c[i] - c[i - 1];
    if (ch >= 0) gain += ch;
    else loss -= ch;
  }
  let avgGain = gain / period;
  let avgLoss = loss / period;
  out[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);

  for (let i = period + 1; i < c.length; i++) {
    const ch = c[i] - c[i - 1];
    const g = ch > 0 ? ch : 0;
    const l = ch < 0 ? -ch : 0;
    avgGain = (avgGain * (period - 1) + g) / period;
    avgLoss = (avgLoss * (period - 1) + l) / period;
    out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return out;
}

function calcKdj(klines: Kline[], n = 9, kPeriod = 3, dPeriod = 3) {
  const h = highs(klines);
  const l = lows(klines);
  const c = closes(klines);
  const rsv: (number | null)[] = new Array(c.length).fill(null);
  const kLine: (number | null)[] = new Array(c.length).fill(null);
  const dLine: (number | null)[] = new Array(c.length).fill(null);
  const jLine: (number | null)[] = new Array(c.length).fill(null);

  for (let i = n - 1; i < c.length; i++) {
    let hh = -Infinity;
    let ll = Infinity;
    for (let j = i - n + 1; j <= i; j++) {
      hh = Math.max(hh, h[j]);
      ll = Math.min(ll, l[j]);
    }
    rsv[i] = hh === ll ? 50 : ((c[i] - ll) / (hh - ll)) * 100;
  }

  let prevK = 50;
  let prevD = 50;
  for (let i = 0; i < c.length; i++) {
    if (rsv[i] == null) continue;
    const k = (2 * prevK + rsv[i]!) / 3;
    const d = (2 * prevD + k) / 3;
    kLine[i] = k;
    dLine[i] = d;
    jLine[i] = 3 * k - 2 * d;
    prevK = k;
    prevD = d;
  }
  return { kLine, dLine, jLine };
}

function calcWr(klines: Kline[], period = 14): (number | null)[] {
  const h = highs(klines);
  const l = lows(klines);
  const c = closes(klines);
  const out: (number | null)[] = new Array(c.length).fill(null);
  for (let i = period - 1; i < c.length; i++) {
    let hh = -Infinity;
    let ll = Infinity;
    for (let j = i - period + 1; j <= i; j++) {
      hh = Math.max(hh, h[j]);
      ll = Math.min(ll, l[j]);
    }
    out[i] = hh === ll ? 0 : ((hh - c[i]) / (hh - ll)) * -100;
  }
  return out;
}

/** On-Balance Volume — cumulative volume signed by close direction. */
function calcObv(klines: Kline[]): (number | null)[] {
  const out: (number | null)[] = [];
  let obv = 0;
  for (let i = 0; i < klines.length; i++) {
    const vol = Number(klines[i].volume) || 0;
    if (i === 0) {
      obv = vol;
    } else {
      const c = Number(klines[i].close);
      const prev = Number(klines[i - 1].close);
      if (c > prev) obv += vol;
      else if (c < prev) obv -= vol;
    }
    out.push(obv);
  }
  return out;
}

function valueAt(values: (number | null)[], index: number): number | null {
  if (index < 0 || index >= values.length) return null;
  const v = values[index];
  return v != null && Number.isFinite(v) ? v : null;
}

/** Map crosshair time (seconds) to the nearest kline bar index. */
export function resolveKlineBarIndex(klines: Kline[], timeSec: number | null | undefined): number {
  if (!klines.length) return -1;
  if (timeSec == null || !Number.isFinite(timeSec)) return klines.length - 1;
  let best = 0;
  for (let i = 0; i < klines.length; i++) {
    const kt = klineTime(Number(klines[i].time));
    if (kt === timeSec) return i;
    if (kt < timeSec) best = i;
    else break;
  }
  return best;
}

function fmtPrice(v: number): string {
  const abs = Math.abs(v);
  if (abs >= 1000) return v.toFixed(2);
  if (abs >= 1) return v.toFixed(4);
  if (abs >= 0.01) return v.toFixed(6);
  return v.toFixed(8);
}

function fmtOsc(v: number): string {
  const abs = Math.abs(v);
  if (abs >= 100) return v.toFixed(1);
  if (abs >= 1) return v.toFixed(2);
  return v.toFixed(4);
}

function fmtCompact(v: number): string {
  const abs = Math.abs(v);
  if (abs >= 1e9) return `${(v / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${(v / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${(v / 1e3).toFixed(2)}K`;
  return v.toFixed(2);
}

function readoutChip(
  key: string,
  label: string,
  value: number | null,
  color: string,
  format: (v: number) => string = fmtPrice,
): IndicatorReadoutChip | null {
  if (value == null || !Number.isFinite(value)) return null;
  return { key, label, value: format(value), color };
}

/** Indicator values for legend readouts at a specific bar (crosshair or latest). */
export function buildIndicatorReadouts(
  klines: Kline[],
  active: Iterable<string>,
  barIndex?: number,
): IndicatorReadoutGroup[] {
  const set = new Set(active);
  if (!klines.length || set.size === 0) return [];

  const idx = barIndex == null || barIndex < 0 || barIndex >= klines.length
    ? klines.length - 1
    : barIndex;

  const groups: IndicatorReadoutGroup[] = [];
  const push = (id: string, chips: (IndicatorReadoutChip | null)[]) => {
    const valid = chips.filter((c): c is IndicatorReadoutChip => c != null);
    if (valid.length) groups.push({ id, chips: valid });
  };

  if (set.has('MA')) {
    const c = closes(klines);
    push('MA', [
      readoutChip('ma7', 'MA7', valueAt(sma(c, 7), idx), C.ma7),
      readoutChip('ma25', 'MA25', valueAt(sma(c, 25), idx), C.ma25),
    ]);
  }

  if (set.has('EMA')) {
    const c = closes(klines);
    push('EMA', [
      readoutChip('ema12', 'EMA12', valueAt(ema(c, 12), idx), C.ema12),
      readoutChip('ema26', 'EMA26', valueAt(ema(c, 26), idx), C.ema26),
    ]);
  }

  if (set.has('BOLL')) {
    const { mid, upper, lower } = calcBoll(klines);
    push('BOLL', [
      readoutChip('bollUp', 'BOLL↑', valueAt(upper, idx), C.bollBand),
      readoutChip('bollMid', 'BOLL', valueAt(mid, idx), C.bollMid),
      readoutChip('bollLow', 'BOLL↓', valueAt(lower, idx), C.bollBand),
    ]);
  }

  if (set.has('SAR')) {
    push('SAR', [readoutChip('sar', 'SAR', valueAt(calcSar(klines), idx), C.sar)]);
  }

  if (set.has('VOL')) {
    const vol = Number(klines[idx]?.volume) || 0;
    push('VOL', [readoutChip('vol', 'VOL', vol > 0 ? vol : null, C.vol, fmtCompact)]);
  }

  if (set.has('OBV')) {
    push('OBV', [readoutChip('obv', 'OBV', valueAt(calcObv(klines), idx), C.obv, fmtCompact)]);
  }

  if (set.has('MACD')) {
    const { dif, dea, hist } = calcMacd(klines);
    push('MACD', [
      readoutChip('macdDif', 'DIF', valueAt(dif, idx), C.macd, fmtOsc),
      readoutChip('macdDea', 'DEA', valueAt(dea, idx), C.macdSignal, fmtOsc),
      readoutChip('macdHist', 'MACD', valueAt(hist, idx), C.macd, fmtOsc),
    ]);
  }

  if (set.has('RSI')) {
    push('RSI', [readoutChip('rsi14', 'RSI14', valueAt(calcRsi(klines), idx), C.rsi, fmtOsc)]);
  }

  if (set.has('KDJ')) {
    const { kLine, dLine, jLine } = calcKdj(klines);
    push('KDJ', [
      readoutChip('kdjK', 'K', valueAt(kLine, idx), C.kdjK, fmtOsc),
      readoutChip('kdjD', 'D', valueAt(dLine, idx), C.kdjD, fmtOsc),
      readoutChip('kdjJ', 'J', valueAt(jLine, idx), C.kdjJ, fmtOsc),
    ]);
  }

  if (set.has('WR')) {
    push('WR', [readoutChip('wr14', 'WR14', valueAt(calcWr(klines), idx), C.wr, fmtOsc)]);
  }

  return groups;
}

function formatCrosshairTime(t: number): string {
  const sec = Number(t);
  if (!Number.isFinite(sec)) return '';
  const d = new Date(sec > 1e12 ? sec : sec * 1000);
  const mo = d.getMonth() + 1;
  const da = d.getDate();
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${mo}/${da} ${hh}:${mm}`;
}

/** OHLCV + every active indicator at the crosshair bar (hold-to-inspect). */
export function buildCrosshairReadouts(
  klines: Kline[],
  active: Iterable<string>,
  barIndex: number,
): IndicatorReadoutGroup[] {
  if (!klines.length || barIndex < 0 || barIndex >= klines.length) {
    return buildIndicatorReadouts(klines, active, barIndex);
  }

  const k = klines[barIndex];
  const o = Number(k.open);
  const h = Number(k.high);
  const l = Number(k.low);
  const c = Number(k.close);
  const vol = Number(k.volume ?? 0);
  const groups: IndicatorReadoutGroup[] = [];

  groups.push({
    id: 'time',
    chips: [{
      key: 'time',
      label: '',
      value: formatCrosshairTime(klineTime(Number(k.time))),
      color: '#0EA4AB',
    }],
  });

  const ohlcChips: IndicatorReadoutChip[] = [
    readoutChip('o', 'O', o, C.bollMid),
    readoutChip('h', 'H', h, '#22c55e'),
    readoutChip('l', 'L', l, '#ef4444'),
    readoutChip('c', 'C', c, '#0EA4AB'),
    readoutChip('v', 'V', vol > 0 ? vol : null, C.vol, fmtCompact),
  ].filter((chip): chip is IndicatorReadoutChip => chip != null);

  if (ohlcChips.length) groups.push({ id: 'ohlc', chips: ohlcChips });

  const indicatorGroups = buildIndicatorReadouts(klines, active, barIndex)
    .filter((g) => g.id !== 'VOL');

  return groups.concat(indicatorGroups);
}

function macdHistPoints(klines: Kline[], hist: (number | null)[]): HistPoint[] {
  const pts: HistPoint[] = [];
  for (let i = 0; i < klines.length; i++) {
    const v = hist[i];
    if (v == null || !Number.isFinite(v)) continue;
    pts.push({
      time: klineTime(klines[i].time),
      value: v,
      color: v >= 0 ? C.macdHistUp : C.macdHistDown,
    });
  }
  return pts;
}

/** Build overlay lines + oscillator panes for the TradingView Lightweight Charts WebView. */
export function buildIndicatorPayload(
  klines: Kline[],
  active: Iterable<string>,
): IndicatorPayload {
  const set = new Set(active);
  const overlays: OverlaySeries[] = [];
  const panes: IndicatorPane[] = [];

  if (!klines.length) {
    return { vol: set.has('VOL'), overlays, panes };
  }

  if (set.has('MA')) {
    overlays.push(
      { id: 'ma7', data: toLinePoints(klines, sma(closes(klines), 7)), color: C.ma7, lineWidth: 1 },
      { id: 'ma25', data: toLinePoints(klines, sma(closes(klines), 25)), color: C.ma25, lineWidth: 1 },
    );
  }

  if (set.has('EMA')) {
    overlays.push(
      { id: 'ema12', data: toLinePoints(klines, ema(closes(klines), 12)), color: C.ema12, lineWidth: 1 },
      { id: 'ema26', data: toLinePoints(klines, ema(closes(klines), 26)), color: C.ema26, lineWidth: 1 },
    );
  }

  if (set.has('BOLL')) {
    const { mid, upper, lower } = calcBoll(klines);
    overlays.push(
      { id: 'bollUp', data: toLinePoints(klines, upper), color: C.bollBand, lineWidth: 1 },
      { id: 'bollMid', data: toLinePoints(klines, mid), color: C.bollMid, lineWidth: 1 },
      { id: 'bollLow', data: toLinePoints(klines, lower), color: C.bollBand, lineWidth: 1 },
    );
  }

  if (set.has('SAR')) {
    overlays.push({
      id: 'sar',
      data: toSarPoints(klines, calcSar(klines)) as unknown as LinePoint[],
      color: C.sar,
      lineWidth: 1,
    });
  }

  if (set.has('OBV')) {
    panes.push({
      id: 'obv',
      scale: { autoScale: true },
      series: [
        { id: 'obvLine', kind: 'line', data: toLinePoints(klines, calcObv(klines)), color: C.obv, lineWidth: 1 },
      ],
    });
  }

  if (set.has('MACD')) {
    const { dif, dea, hist } = calcMacd(klines);
    panes.push({
      id: 'macd',
      scale: { autoScale: true },
      series: [
        { id: 'macdHist', kind: 'histogram', data: macdHistPoints(klines, hist), color: C.macd },
        { id: 'macdDif', kind: 'line', data: toLinePoints(klines, dif), color: C.macd, lineWidth: 1 },
        { id: 'macdDea', kind: 'line', data: toLinePoints(klines, dea), color: C.macdSignal, lineWidth: 1 },
      ],
    });
  }

  if (set.has('RSI')) {
    panes.push({
      id: 'rsi',
      scale: { autoScale: false, minimum: 0, maximum: 100 },
      series: [
        { id: 'rsi14', kind: 'line', data: toLinePoints(klines, calcRsi(klines)), color: C.rsi, lineWidth: 1 },
      ],
    });
  }

  if (set.has('KDJ')) {
    const { kLine, dLine, jLine } = calcKdj(klines);
    panes.push({
      id: 'kdj',
      scale: { autoScale: false, minimum: 0, maximum: 100 },
      series: [
        { id: 'kdjK', kind: 'line', data: toLinePoints(klines, kLine), color: C.kdjK, lineWidth: 1 },
        { id: 'kdjD', kind: 'line', data: toLinePoints(klines, dLine), color: C.kdjD, lineWidth: 1 },
        { id: 'kdjJ', kind: 'line', data: toLinePoints(klines, jLine), color: C.kdjJ, lineWidth: 1 },
      ],
    });
  }

  if (set.has('WR')) {
    panes.push({
      id: 'wr',
      scale: { autoScale: false, minimum: -100, maximum: 0 },
      series: [
        { id: 'wr14', kind: 'line', data: toLinePoints(klines, calcWr(klines)), color: C.wr, lineWidth: 1 },
      ],
    });
  }

  return { vol: set.has('VOL'), overlays, panes };
}

/** Oscillator panes that need extra vertical space in preview mode. */
export const CHART_OSCILLATOR_IDS = ['OBV', 'MACD', 'KDJ', 'RSI', 'WR'] as const;

export function countOscillatorPanes(active: Iterable<string>): number {
  const set = new Set(active);
  return CHART_OSCILLATOR_IDS.filter((id) => set.has(id)).length;
}

export function previewChartHeight(baseHeight: number, active?: Iterable<string>): number {
  const panes = active ? countOscillatorPanes(active) : 0;
  if (panes <= 0) return baseHeight;
  return baseHeight + Math.min(panes * 36, 140);
}
