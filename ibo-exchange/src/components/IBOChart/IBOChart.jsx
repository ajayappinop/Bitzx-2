/**
 * IBOChart — lightweight-charts candlestick + volume with optimised incremental updates.
 *
 * Update strategy
 * ───────────────
 * • First load or interval switch  → series.setData()  (full replace, sorted + deduped)
 * • Same last-candle time          → series.update()   (OHLCV patch on live candle)
 * • New candle appended            → series.update()   (append; library handles scroll)
 *
 * This avoids rebuilding the full O(n) dataset on every WS tick (every 1s for
 * ticker, every 4s for candle) and keeps CPU usage negligible.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createChart, CrosshairMode } from 'lightweight-charts';
import { Loader2 } from 'lucide-react';
import { useTheme } from '@/context/ThemeContext';

const INTERVALS = ['1m', '5m', '15m', '1h', '4h', '1d'];

// Deduplicate by time and sort ascending — required by lightweight-charts.
function prepareData(raw) {
  if (!raw?.length) return [];
  const map = new Map();
  for (const c of raw) {
    const t = Number(c.time);
    if (!Number.isFinite(t) || t <= 0) continue;
    map.set(t, {
      time:   t,
      open:   Number(c.open)   || 0,
      high:   Number(c.high)   || 0,
      low:    Number(c.low)    || 0,
      close:  Number(c.close)  || 0,
      volume: Number(c.volume) || 0,
    });
  }
  return Array.from(map.values()).sort((a, b) => a.time - b.time);
}

function volColor(c) {
  return c.close >= c.open ? 'rgba(34,197,94,0.45)' : 'rgba(239,68,68,0.45)';
}

function layoutForTheme(isLight) {
  if (isLight) {
    return {
      layout: { background: { color: '#ffffff' }, textColor: '#4a6070' },
      grid: {
        vertLines: { color: 'rgba(12,28,38,0.07)' },
        horzLines: { color: 'rgba(12,28,38,0.07)' },
      },
      rightPriceScale: { borderColor: 'rgba(12,28,38,0.14)' },
      timeScale: {
        borderColor: 'rgba(12,28,38,0.14)',
        timeVisible: true,
        secondsVisible: false,
      },
      tipBg: 'rgba(255,255,255,0.98)',
      tipBorder: 'rgba(12,28,38,0.14)',
      tipColor: '#0c1922',
    };
  }
  return {
    layout: { background: { color: '#101013' }, textColor: '#c7c9d1' },
    grid: {
      vertLines: { color: 'rgba(255,255,255,0.04)' },
      horzLines: { color: 'rgba(255,255,255,0.04)' },
    },
    rightPriceScale: { borderColor: 'rgba(255,255,255,0.08)' },
    timeScale: {
      borderColor: 'rgba(255,255,255,0.08)',
      timeVisible: true,
      secondsVisible: false,
    },
    tipBg: 'rgba(16,16,19,0.92)',
    tipBorder: 'rgba(255,255,255,0.12)',
    tipColor: '#e1e1e2',
  };
}

export default function IBOChart({
  candles = [],
  interval = '1m',
  onIntervalChange,
  fill = false,
  loading = false,
}) {
  const containerRef = useRef(null);
  const chartRef     = useRef(null);
  const candleRef    = useRef(null);  // candlestick series
  const volRef       = useRef(null);  // volume series
  const tooltipRef   = useRef(null);
  const [active, setActive] = useState(interval);
  const { isLight } = useTheme();

  // Track last data state to choose update vs full setData.
  const lastLoadKeyRef    = useRef('');   // "<interval>-<firstTime>" — resets on dataset change
  const lastCandleTimeRef = useRef(null); // time of the last candle we fed to the chart

  // Keep interval in sync with parent.
  useEffect(() => { setActive(interval); }, [interval]);

  // ── Chart mount / teardown ────────────────────────────────────────────────
  useLayoutEffect(() => {
    if (!containerRef.current) return undefined;
    const theme = layoutForTheme(isLight);
    const h = fill ? Math.max(200, containerRef.current.clientHeight) : 430;
    const chart = createChart(containerRef.current, {
      width:  containerRef.current.clientWidth,
      height: h,
      layout: theme.layout,
      grid: theme.grid,
      rightPriceScale: theme.rightPriceScale,
      timeScale: theme.timeScale,
      crosshair: { mode: CrosshairMode.Normal },
    });
    chartRef.current = chart;

    const cSeries = chart.addCandlestickSeries({
      upColor: '#22c55e', downColor: '#ef4444',
      wickUpColor: '#22c55e', wickDownColor: '#ef4444',
      borderVisible: false,
    });
    const vSeries = chart.addHistogramSeries({
      priceFormat: { type: 'volume' },
      priceScaleId: '',
      color: 'rgba(254, 157, 85,0.4)',
    });
    vSeries.priceScale().applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });
    candleRef.current = cSeries;
    volRef.current    = vSeries;

    // Re-seed after theme remount (data effect may not re-run).
    lastLoadKeyRef.current = '';
    lastCandleTimeRef.current = null;

    // Tooltip overlay.
    const tip = document.createElement('div');
    Object.assign(tip.style, {
      position: 'absolute', display: 'none', pointerEvents: 'none',
      padding: '8px 10px', background: theme.tipBg,
      border: `1px solid ${theme.tipBorder}`, borderRadius: '8px',
      fontSize: '12px', fontFamily: 'Inter, Plus Jakarta Sans, sans-serif',
      color: theme.tipColor, zIndex: '100',
    });
    tooltipRef.current = tip;
    containerRef.current.appendChild(tip);

    chart.subscribeCrosshairMove((param) => {
      if (!param?.point || !param?.time) { tip.style.display = 'none'; return; }
      const c = param.seriesData.get(cSeries);
      const v = param.seriesData.get(vSeries);
      if (!c) { tip.style.display = 'none'; return; }
      tip.style.display = 'block';
      const w = containerRef.current?.clientWidth ?? 600;
      tip.style.left = `${Math.min(w - 170, Math.max(8, param.point.x + 14))}px`;
      tip.style.top  = `${Math.max(8, param.point.y - 14)}px`;
      const dp = (n) => Number(n) >= 1 ? Number(n).toFixed(4) : Number(n).toFixed(8);
      tip.innerHTML =
        `O ${dp(c.open)}<br/>H ${dp(c.high)}<br/>L ${dp(c.low)}<br/>C ${dp(c.close)}<br/>V ${Number(v?.value || 0).toFixed(2)}`;
    });

    // Resize observer.
    const ro = new ResizeObserver(() => {
      if (!containerRef.current || !chartRef.current) return;
      chartRef.current.applyOptions({
        width:  containerRef.current.clientWidth,
        height: fill ? Math.max(200, containerRef.current.clientHeight) : 430,
      });
    });
    ro.observe(containerRef.current);

    return () => {
      ro.disconnect();
      if (tooltipRef.current?.parentNode) tooltipRef.current.parentNode.removeChild(tooltipRef.current);
      chart.remove();
      chartRef.current = candleRef.current = volRef.current = null;
      lastLoadKeyRef.current = '';
      lastCandleTimeRef.current = null;
    };
  }, [fill, isLight]);

  // ── Data updates ─────────────────────────────────────────────────────────
  const chartData = useMemo(() => prepareData(candles), [candles]);

  useEffect(() => {
    const cSeries = candleRef.current;
    const vSeries = volRef.current;
    if (!cSeries || !vSeries) return;

    if (chartData.length === 0) {
      // Dataset cleared (interval switch or symbol change) — reset refs.
      lastLoadKeyRef.current    = '';
      lastCandleTimeRef.current = null;
      return;
    }

    const last = chartData[chartData.length - 1];
    const first = chartData[0];

    // Build a load key from interval + first candle time to detect full reloads.
    const loadKey = `${interval}-${first.time}`;

    const isFullReload = loadKey !== lastLoadKeyRef.current;
    const prevLastTime = lastCandleTimeRef.current;

    if (isFullReload) {
      // Full dataset — setData + fit content.
      try {
        cSeries.setData(chartData);
        vSeries.setData(chartData.map((c) => ({ time: c.time, value: c.volume, color: volColor(c) })));
        chartRef.current?.timeScale().fitContent();
      } catch {
        // Malformed data edge case — nothing to do.
      }
      lastLoadKeyRef.current    = loadKey;
      lastCandleTimeRef.current = last.time;
      return;
    }

    // Incremental update — only push the last candle.
    try {
      cSeries.update(last);
      vSeries.update({ time: last.time, value: last.volume, color: volColor(last) });
      // If a new candle was appended (time advanced), scroll timeline to keep it visible.
      if (prevLastTime !== null && last.time !== prevLastTime) {
        chartRef.current?.timeScale().scrollToRealTime?.();
      }
    } catch {
      // Fallback: full setData (e.g. library threw on out-of-order time).
      try {
        cSeries.setData(chartData);
        vSeries.setData(chartData.map((c) => ({ time: c.time, value: c.volume, color: volColor(c) })));
      } catch {
        // ignore
      }
      lastLoadKeyRef.current = loadKey;
    }
    lastCandleTimeRef.current = last.time;
  }, [chartData, interval, isLight]);

  return (
    <div
      className="w-full h-full flex flex-col"
      style={{ background: isLight ? 'var(--ibo-card)' : '#101013' }}
    >
      {/* Interval selector */}
      <div
        className="flex items-center gap-1.5 px-3 py-2 border-b shrink-0 flex-wrap"
        style={{ borderColor: isLight ? 'var(--ibo-border-solid)' : 'rgba(255,255,255,0.1)' }}
      >
        {INTERVALS.map((iv) => (
          <button
            key={iv}
            type="button"
            onClick={() => { setActive(iv); onIntervalChange?.(iv); }}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-colors ${
              active === iv
                ? 'text-gold-light border-gold/50 bg-gold/10'
                : isLight
                  ? 'text-[color:var(--ibo-muted)] border-[color:var(--ibo-border-solid)] hover:text-[color:var(--ibo-ink)] hover:border-[color:var(--ibo-accent)]/40'
                  : 'text-white/70 border-white/10 hover:text-white hover:border-white/30'
            }`}
          >
            {iv}
          </button>
        ))}
      </div>

      {/* Chart area */}
      <div className="relative flex-1 min-h-0">
        {loading && chartData.length === 0 && (
          <div
            className="absolute inset-0 flex flex-col items-center justify-center z-10"
            style={{ background: isLight ? 'rgba(255,255,255,0.85)' : 'rgba(16,16,19,0.85)' }}
          >
            <Loader2 className="w-8 h-8 text-gold animate-spin mb-3" />
            <span
              className="text-sm font-semibold tracking-wider uppercase"
              style={{ color: isLight ? 'var(--ibo-muted)' : 'rgba(255,255,255,0.5)' }}
            >
              Loading chart…
            </span>
          </div>
        )}
        {!loading && chartData.length === 0 && (
          <div
            className="absolute inset-0 flex flex-col items-center justify-center z-10"
            style={{ background: isLight ? 'rgba(255,255,255,0.85)' : 'rgba(16,16,19,0.85)' }}
          >
            <span
              className="text-sm font-semibold tracking-wider uppercase"
              style={{ color: isLight ? 'var(--ibo-muted)' : 'rgba(255,255,255,0.4)' }}
            >
              No price data
            </span>
          </div>
        )}
        <div ref={containerRef} className="w-full h-full" />
      </div>
    </div>
  );
}
