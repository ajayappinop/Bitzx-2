import { useEffect, useRef, useState } from 'react';
import { createChart, ColorType, CrosshairMode } from 'lightweight-charts';
import { tradingApi } from '@/services/api';
import { generateMockUsdtKlines, isInternalMockUsdtSymbol } from '@/lib/mockMarket';

const INTERVALS = [
  { label: '1m',  value: '1m'  },
  { label: '5m',  value: '5m'  },
  { label: '15m', value: '15m' },
  { label: '1H',  value: '1h'  },
  { label: '4H',  value: '4h'  },
  { label: '1D',  value: '1d'  },
];

const CHART_TYPES = [
  { label: 'Candles', value: 'candle' },
  { label: 'Line',    value: 'line'   },
];

export default function TradingChart({ symbol }) {
  const containerRef   = useRef(null);
  const chartRef       = useRef(null);
  const candleRef      = useRef(null);
  const lineRef        = useRef(null);
  const volumeRef      = useRef(null);
  const resizeObserver = useRef(null);

  const [interval,  setInterval_]  = useState('1h');
  const [chartType, setChartType]  = useState('candle');
  const [loading,   setLoading]    = useState(true);
  const [ohlc,      setOhlc]       = useState(null); // hovered candle info

  // Initialise chart once
  useEffect(() => {
    if (!containerRef.current) return;

    const chart = createChart(containerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: '#0a1024' },
        textColor: '#8A8B90',
        fontFamily: 'Plus Jakarta Sans, sans-serif',
        fontSize: 12,
      },
      grid: {
        vertLines: { color: '#121c38', style: 1 },
        horzLines: { color: '#121c38', style: 1 },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: '#0EA4AB', labelBackgroundColor: '#0EA4AB' },
        horzLine: { color: '#0EA4AB', labelBackgroundColor: '#0EA4AB' },
      },
      rightPriceScale: {
        borderColor: '#1a2748',
        scaleMargins: { top: 0.1, bottom: 0.25 },
      },
      timeScale: {
        borderColor: '#1a2748',
        timeVisible: true,
        secondsVisible: false,
      },
      handleScroll: true,
      handleScale: true,
    });

    const candleSeries = chart.addCandlestickSeries({
      upColor:        '#22c55e',
      downColor:      '#ef4444',
      borderUpColor:  '#22c55e',
      borderDownColor:'#ef4444',
      wickUpColor:    '#22c55e',
      wickDownColor:  '#ef4444',
    });

    const lineSeries = chart.addLineSeries({
      color: '#C5E35B',
      lineWidth: 2,
      crosshairMarkerVisible: true,
      crosshairMarkerRadius: 4,
    });
    lineSeries.applyOptions({ visible: false });

    const volumeSeries = chart.addHistogramSeries({
      color: '#26a69a',
      priceFormat: { type: 'volume' },
      priceScaleId: 'vol',
    });
    chart.priceScale('vol').applyOptions({
      scaleMargins: { top: 0.8, bottom: 0 },
    });

    chart.subscribeCrosshairMove(param => {
      if (param.time && param.seriesData) {
        const d = param.seriesData.get(candleSeries);
        if (d) setOhlc(d);
      }
    });

    chartRef.current   = chart;
    candleRef.current  = candleSeries;
    lineRef.current    = lineSeries;
    volumeRef.current  = volumeSeries;

    // Responsive resize
    resizeObserver.current = new ResizeObserver(entries => {
      const { width, height } = entries[0].contentRect;
      chart.applyOptions({ width, height });
    });
    resizeObserver.current.observe(containerRef.current);

    return () => {
      resizeObserver.current?.disconnect();
      chart.remove();
    };
  }, []);

  // Load data when symbol or interval changes
  useEffect(() => {
    if (!candleRef.current) return;
    setLoading(true);
    setOhlc(null);

    const applyData = (data) => {
      if (!data?.length || !candleRef.current) return;
      candleRef.current.setData(data);
      lineRef.current.setData(data.map(d => ({ time: d.time, value: d.close })));
      volumeRef.current.setData(
        data.map(d => ({
          time:  d.time,
          value: d.volume,
          color: d.close >= d.open ? 'rgba(34,197,94,0.35)' : 'rgba(239,68,68,0.35)',
        })),
      );
      chartRef.current?.timeScale().fitContent();
    };

    // MIDAS/USDT and other internal demo pairs — render mock candles immediately (no .env flag).
    if (isInternalMockUsdtSymbol(symbol)) {
      applyData(generateMockUsdtKlines(symbol, interval, 200));
      setLoading(false);
      tradingApi.getKlines(symbol, interval, 200)
        .then((data) => { if (data?.length) applyData(data); })
        .catch(() => { /* keep client mock */ });
      return;
    }

    tradingApi.getKlines(symbol, interval, 200)
      .then(data => {
        if (!data?.length) return [];
        return data;
      })
      .then(applyData)
      .catch(err => {
        console.error(err);
      })
      .finally(() => setLoading(false));
  }, [symbol, interval]);

  // Toggle candle / line visibility
  useEffect(() => {
    if (!candleRef.current || !lineRef.current) return;
    candleRef.current.applyOptions({ visible: chartType === 'candle' });
    lineRef.current.applyOptions({   visible: chartType === 'line'   });
  }, [chartType]);

  return (
    <div className="flex flex-col h-full bg-surface-elevated">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-line flex-shrink-0">
        {/* OHLC info */}
        <div className="flex items-center gap-3 text-xs text-ink-muted">
          {ohlc ? (
            <>
              <span>O <span className="text-ink">{ohlc.open?.toFixed(4)}</span></span>
              <span>H <span className="text-green-400">{ohlc.high?.toFixed(4)}</span></span>
              <span>L <span className="text-red-400">{ohlc.low?.toFixed(4)}</span></span>
              <span>C <span className={ohlc.close >= ohlc.open ? 'text-green-400' : 'text-red-400'}>
                {ohlc.close?.toFixed(4)}
              </span></span>
            </>
          ) : (
            <span className="text-[#4A4B50]">Hover for OHLC</span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* Chart type */}
          <div className="flex bg-surface-soft rounded overflow-hidden">
            {CHART_TYPES.map(t => (
              <button
                key={t.value}
                onClick={() => setChartType(t.value)}
                className={`px-2 py-1 text-xs transition-colors ${
                  chartType === t.value
                    ? 'bg-[#0EA4AB] text-black font-semibold'
                    : 'text-ink-muted hover:text-ink'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          {/* Intervals */}
          <div className="flex bg-surface-soft rounded overflow-hidden">
            {INTERVALS.map(iv => (
              <button
                key={iv.value}
                onClick={() => setInterval_(iv.value)}
                className={`px-2 py-1 text-xs transition-colors ${
                  interval === iv.value
                    ? 'bg-[#0EA4AB] text-black font-semibold'
                    : 'text-ink-muted hover:text-ink'
                }`}
              >
                {iv.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Chart area */}
      <div className="relative flex-1 min-h-0">
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center bg-surface-elevated/80 z-10">
            <div className="w-8 h-8 border-2 border-[#0EA4AB] border-t-transparent rounded-full animate-spin" />
          </div>
        )}
        <div ref={containerRef} className="w-full h-full" />
      </div>
    </div>
  );
}
