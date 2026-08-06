/**
 * Options Chart — same chrome as FuturesChart + SyntheticChart (site standard):
 * tab strip · interval pills · lightweight-charts candles · underlying TV.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { createChart, CrosshairMode } from 'lightweight-charts';
import TVChart from '@/components/trading/TVChart';
import { formatDeltaInstrumentId } from './deltaInstrumentUtils';
import { buildOptionsDemoDepth, depthHasLevels } from './optionsDemoBook';

const INTERVALS = [
  ['1m', '1m', 60],
  ['5m', '5m', 300],
  ['15m', '15m', 900],
  ['1h', '1H', 3600],
  ['4h', '4H', 14400],
  ['1d', '1D', 86400],
];

function chartTheme(isLight) {
  if (isLight) {
    return {
      layout: {
        background: { color: '#ffffff' },
        textColor: '#4a6070',
      },
      grid: {
        vertLines: { color: 'rgba(208,219,227,0.9)' },
        horzLines: { color: 'rgba(208,219,227,0.9)' },
      },
      rightPriceScale: { borderColor: 'rgba(12,28,38,0.12)' },
      timeScale: { borderColor: 'rgba(12,28,38,0.12)', timeVisible: true },
    };
  }
  return {
    layout: {
      background: { color: '#101013' },
      textColor: '#9ca3af',
    },
    grid: {
      vertLines: { color: 'rgba(255,255,255,0.04)' },
      horzLines: { color: 'rgba(255,255,255,0.04)' },
    },
    rightPriceScale: { borderColor: 'rgba(255,255,255,0.08)' },
    timeScale: { borderColor: 'rgba(255,255,255,0.08)', timeVisible: true },
  };
}

function hashStr(s) {
  let h = 2166136261;
  const str = String(s || '');
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function buildCandles({ seedPx, count = 160, intervalSecs = 3600, seedKey = '' }) {
  const target = Number(seedPx);
  if (!(target > 0)) return [];
  const rand = rng(hashStr(`${seedKey}:${intervalSecs}:${Math.round(target * 100)}`));
  const now = Math.floor(Date.now() / 1000);
  const aligned = Math.floor(now / intervalSecs) * intervalSecs;
  let px = target * (0.96 + rand() * 0.1);
  const out = [];
  for (let i = count - 1; i >= 0; i -= 1) {
    const t = aligned - i * intervalSecs;
    const open = px;
    const close = Math.max(target * 0.05, open + (rand() - 0.48) * target * 0.035);
    const high = Math.max(open, close) * (1 + rand() * 0.012);
    const low = Math.min(open, close) * (1 - rand() * 0.012);
    out.push({
      time: t,
      open: +open.toFixed(4),
      high: +high.toFixed(4),
      low: +low.toFixed(4),
      close: +close.toFixed(4),
    });
    px = close;
  }
  if (out.length) {
    const last = out[out.length - 1];
    last.close = +target.toFixed(4);
    last.high = Math.max(last.high, last.close);
    last.low = Math.min(last.low, last.close);
  }
  return out;
}

/** Same layout language as SyntheticChart (pair + intervals + candles). */
function OptionPriceChart({ title, lastPrice, seedKey, livePx }) {
  const containerRef = useRef(null);
  const chartRef = useRef(null);
  const seriesRef = useRef(null);
  const [interval, setIntervalId] = useState('1h');
  const [loading, setLoading] = useState(true);
  /* Options terminal is light chrome — match SyntheticChart light theme */
  const light = true;

  const intervalSecs = useMemo(
    () => (INTERVALS.find(([id]) => id === interval)?.[2]) || 3600,
    [interval],
  );

  const candles = useMemo(
    () => buildCandles({
      seedPx: livePx || lastPrice || 1,
      count: 160,
      intervalSecs,
      seedKey: `${seedKey}:${interval}`,
    }),
    [livePx, lastPrice, intervalSecs, seedKey, interval],
  );

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return undefined;

    const theme = chartTheme(light);
    const chart = createChart(el, {
      ...theme,
      width: el.clientWidth,
      height: el.clientHeight,
      crosshair: { mode: CrosshairMode.Normal },
    });
    const series = chart.addCandlestickSeries({
      upColor: '#26a69a',
      downColor: '#ef5350',
      borderUpColor: '#26a69a',
      borderDownColor: '#ef5350',
      wickUpColor: '#26a69a',
      wickDownColor: '#ef5350',
    });
    chartRef.current = chart;
    seriesRef.current = series;

    const ro = new ResizeObserver(() => {
      if (!containerRef.current || !chartRef.current) return;
      chartRef.current.applyOptions({
        width: containerRef.current.clientWidth,
        height: containerRef.current.clientHeight,
      });
    });
    ro.observe(el);

    return () => {
      ro.disconnect();
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, [light]);

  useEffect(() => {
    setLoading(true);
    if (!seriesRef.current) return;
    if (!candles.length) {
      seriesRef.current.setData([]);
      setLoading(false);
      return;
    }
    seriesRef.current.setData(candles);
    chartRef.current?.timeScale().fitContent();
    setLoading(false);
  }, [candles]);

  /* Live last tick → patch last candle (same as SyntheticChart) */
  useEffect(() => {
    const px = parseFloat(livePx);
    if (!Number.isFinite(px) || px <= 0 || !seriesRef.current || !candles.length) return;
    const last = { ...candles[candles.length - 1] };
    last.close = px;
    last.high = Math.max(last.high, px);
    last.low = Math.min(last.low, px);
    seriesRef.current.update(last);
  }, [livePx, candles]);

  return (
    <div
      className="absolute inset-0 flex flex-col"
      style={{ background: light ? 'var(--ibo-card, #fff)' : '#101013' }}
    >
      <div
        className="flex items-center justify-between gap-2 px-3 py-2 border-b shrink-0"
        style={{ borderColor: light ? 'var(--ibo-border-solid)' : 'rgba(255,255,255,0.06)' }}
      >
        <span
          className="text-xs font-bold truncate min-w-0"
          style={{ color: light ? 'var(--ibo-ink)' : 'rgba(255,255,255,0.8)' }}
        >
          {title}
        </span>
        <div className="flex gap-1 shrink-0">
          {INTERVALS.map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setIntervalId(id)}
              className={`px-2 py-1 rounded text-[10px] font-bold transition-colors ${
                interval === id
                  ? 'bg-gold/20 text-gold-light'
                  : light
                    ? 'text-[color:var(--ibo-muted)] hover:text-[color:var(--ibo-ink)]'
                    : 'text-white/45 hover:text-white/70'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <div ref={containerRef} className="relative flex-1 min-h-0 w-full" />
      {loading ? (
        <div className="absolute inset-0 top-10 flex items-center justify-center pointer-events-none">
          <div className="w-7 h-7 border-2 border-gold border-t-transparent rounded-full animate-spin" />
        </div>
      ) : null}
    </div>
  );
}

function DepthPanel({ depth, mid }) {
  const book = useMemo(() => {
    if (depthHasLevels(depth)) return depth;
    return buildOptionsDemoDepth({ mid: mid || 10, levels: 14, contractId: 'depth-panel' });
  }, [depth, mid]);
  const asks = (book.asks || []).slice(0, 24);
  const bids = (book.bids || []).slice(0, 24);
  const maxQ = Math.max(
    ...asks.map((l) => Number(l[1] || 0)),
    ...bids.map((l) => Number(l[1] || 0)),
    1,
  );

  return (
    <div className="h-full flex flex-col p-4 gap-3 overflow-hidden bg-[color:var(--ibo-bg)]">
      <p className="text-[12px] text-[color:var(--ibo-muted)] shrink-0">
        Live book depth — ask (top) / bid (bottom)
      </p>
      <div className="flex-1 min-h-0 grid grid-rows-2 gap-2">
        <div className="flex flex-col-reverse gap-0.5 overflow-hidden justify-end">
          {asks.map((lv, i) => {
            const q = Number(lv[1] || 0);
            const pct = Math.min(100, (q / maxQ) * 100);
            return (
              <div key={`a-${i}`} className="relative h-2.5 rounded-sm overflow-hidden bg-black/[0.04]">
                <div className="absolute inset-y-0 right-0 bg-rose-500/35" style={{ width: `${pct}%` }} />
              </div>
            );
          })}
        </div>
        <div className="flex flex-col gap-0.5 overflow-hidden">
          {bids.map((lv, i) => {
            const q = Number(lv[1] || 0);
            const pct = Math.min(100, (q / maxQ) * 100);
            return (
              <div key={`b-${i}`} className="relative h-2.5 rounded-sm overflow-hidden bg-black/[0.04]">
                <div className="absolute inset-y-0 left-0 bg-emerald-500/35" style={{ width: `${pct}%` }} />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/**
 * Same tab strip pattern as FuturesChart.
 */
export default function OptionsChartPanel({
  history: _history = [],
  referenceIndex = null,
  selected = null,
  underlying = 'BTCUSDT',
  depth = null,
  onBuy: _onBuy,
  onSell: _onSell,
}) {
  const [tab, setTab] = useState('mark');
  const base = String(underlying || '').replace(/USDT$/i, '') || 'BTC';
  const spot = String(underlying || 'BTCUSDT').toUpperCase();

  const mark = selected?.market?.mid
    ?? selected?.market?.mark_price
    ?? selected?.market?.last_price
    ?? selected?.mark
    ?? selected?.mark_price
    ?? null;
  const last = selected?.market?.last_price
    ?? selected?.last_price
    ?? mark;

  const instr = selected
    ? formatDeltaInstrumentId(selected, underlying)
    : null;

  const tabs = [
    { id: 'traded', label: 'Traded Price' },
    { id: 'mark', label: 'Mark Price' },
    { id: 'under', label: `${base} Chart` },
    { id: 'depth', label: 'Depth' },
  ];

  const emptyContract = (
    <div className="absolute inset-0 flex items-center justify-center bg-[color:var(--ibo-card)] px-6 text-center">
      <p className="text-[13px] text-[color:var(--ibo-muted)]">
        Select a call or put on the chain to chart mark / traded premium
      </p>
    </div>
  );

  return (
    <div className="flex flex-col h-full min-h-0 bg-[color:var(--ibo-bg)]">
      <div className="flex items-center gap-0.5 px-2 shrink-0 border-b border-[color:var(--ibo-border)] bg-transparent">
        {tabs.map((t) => {
          const on = tab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className="relative px-3 py-2 text-[12px] font-semibold transition-colors"
              style={{ color: on ? '#FE6C02' : 'var(--ibo-muted)' }}
            >
              {t.label}
              {on ? (
                <span className="absolute left-2 right-2 bottom-0 h-0.5 rounded-full bg-[#FE6C02]" />
              ) : null}
            </button>
          );
        })}
      </div>
      <div className="flex-1 min-h-0 relative">
        {tab === 'traded' && (
          selected && last != null ? (
            <OptionPriceChart
              title={`TRADED · ${instr}`}
              lastPrice={last}
              livePx={last}
              seedKey={`${selected.id}-traded`}
            />
          ) : emptyContract
        )}
        {tab === 'mark' && (
          selected && mark != null ? (
            <OptionPriceChart
              title={`MARK · ${instr}`}
              lastPrice={mark}
              livePx={mark}
              seedKey={`${selected.id}-mark`}
            />
          ) : emptyContract
        )}
        {tab === 'under' && <TVChart symbol={spot} forceLight />}
        {tab === 'depth' && <DepthPanel depth={depth} mid={mark ?? referenceIndex} />}
      </div>
    </div>
  );
}
