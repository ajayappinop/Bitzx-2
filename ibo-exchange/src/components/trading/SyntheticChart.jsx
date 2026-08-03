/**
 * Live synthetic candlestick chart for IBO-quoted pairs (and IBOUSDT).
 * Data from backend klines, last candle tracks the real ticker price.
 */
import { useEffect, useRef, useState, useCallback } from 'react';
import { createChart } from 'lightweight-charts';
import { marketApi, displayPairSlash } from '@/services/marketApi';
import { useTheme } from '@/context/ThemeContext';

const INTERVALS = [
  ['1m', '1m'],
  ['5m', '5m'],
  ['15m', '15m'],
  ['1h', '1H'],
  ['4h', '4H'],
  ['1d', '1D'],
];

function toChartCandles(rows) {
  const out = [];
  for (const c of rows || []) {
    const t = Number(c.time);
    const o = parseFloat(c.open);
    const h = parseFloat(c.high);
    const l = parseFloat(c.low);
    const cl = parseFloat(c.close);
    if (!Number.isFinite(t) || t <= 0 || !Number.isFinite(cl)) continue;
    out.push({
      time: t > 1e12 ? Math.floor(t / 1000) : t,
      open: o,
      high: h,
      low: l,
      close: cl,
    });
  }
  out.sort((a, b) => a.time - b.time);
  return out;
}

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
      background: { color: '#0a0b0f' },
      textColor: '#9ca3af',
    },
    grid: {
      vertLines: { color: 'rgba(26,29,36,0.85)' },
      horzLines: { color: 'rgba(26,29,36,0.85)' },
    },
    rightPriceScale: { borderColor: 'rgba(255,255,255,0.08)' },
    timeScale: { borderColor: 'rgba(255,255,255,0.08)', timeVisible: true },
  };
}

export default function SyntheticChart({ symbol, lastPrice }) {
  const containerRef = useRef(null);
  const chartRef = useRef(null);
  const seriesRef = useRef(null);
  const candlesRef = useRef([]);
  const [interval, setInterval] = useState('1h');
  const [loading, setLoading] = useState(true);
  const { isLight } = useTheme();

  const pairLabel = displayPairSlash(symbol);

  const applyCandles = useCallback((rows) => {
    const data = toChartCandles(rows);
    candlesRef.current = data;
    if (seriesRef.current && data.length) {
      seriesRef.current.setData(data);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return undefined;

    const theme = chartTheme(isLight);
    const chart = createChart(el, {
      ...theme,
      crosshair: { mode: 1 },
    });

    const series = chart.addCandlestickSeries({
      upColor: '#22c55e',
      downColor: '#ef4444',
      borderUpColor: '#22c55e',
      borderDownColor: '#ef4444',
      wickUpColor: '#22c55e',
      wickDownColor: '#ef4444',
    });

    chartRef.current = chart;
    seriesRef.current = series;

    const existing = candlesRef.current;
    if (existing.length) {
      series.setData(existing);
    }

    const ro = new ResizeObserver(() => {
      if (containerRef.current) {
        chart.applyOptions({
          width: containerRef.current.clientWidth,
          height: containerRef.current.clientHeight,
        });
      }
    });
    ro.observe(el);

    return () => {
      ro.disconnect();
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, [isLight]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    marketApi.getKlines(symbol, interval, 200).then((rows) => {
      if (!cancelled) applyCandles(rows);
    }).catch(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [symbol, interval, applyCandles]);

  useEffect(() => {
    const px = parseFloat(lastPrice);
    if (!Number.isFinite(px) || px <= 0 || !seriesRef.current) return;

    const data = [...candlesRef.current];
    if (!data.length) return;

    const last = { ...data[data.length - 1] };
    last.close = px;
    last.high = Math.max(last.high, px);
    last.low = Math.min(last.low, px);
    data[data.length - 1] = last;
    candlesRef.current = data;
    seriesRef.current.update(last);
  }, [lastPrice]);

  return (
    <div
      className="absolute inset-0 flex flex-col"
      style={{ background: isLight ? 'var(--ibo-card)' : '#0a0b0f' }}
    >
      <div
        className="flex items-center justify-between gap-2 px-3 py-2 border-b shrink-0"
        style={{ borderColor: isLight ? 'var(--ibo-border-solid)' : 'rgba(255,255,255,0.06)' }}
      >
        <span
          className="text-xs font-bold truncate"
          style={{ color: isLight ? 'var(--ibo-ink)' : 'rgba(255,255,255,0.8)' }}
        >
          {pairLabel}
        </span>
        <div className="flex gap-1 shrink-0">
          {INTERVALS.map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setInterval(id)}
              className={`px-2 py-1 rounded text-[10px] font-bold ${
                interval === id
                  ? 'bg-gold/20 text-gold-light'
                  : isLight
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
