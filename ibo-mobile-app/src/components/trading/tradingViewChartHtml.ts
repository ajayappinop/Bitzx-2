/**
 * Self-contained HTML for TradingView Lightweight Charts inside a WebView.
 * Chart library loads from Android assets (release) or CDN (iOS) — not the RN bundle.
 */
import {
  chartLibraryAssetSrc,
  chartLibraryCdnSrc,
  chartLibraryScriptSrc,
} from './chartLibraryAsset';

export function buildTradingViewChartHtml(): string {
  const chartScriptSrc = chartLibraryScriptSrc();
  const chartCdnSrc = chartLibraryCdnSrc();
  const chartAssetSrc = chartLibraryAssetSrc();

  return `<!DOCTYPE html>

<html lang="en">

<head>

  <meta charset="UTF-8" />

  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />

  <style>

    * { margin: 0; padding: 0; box-sizing: border-box; }

    html, body { width: 100%; height: 100%; background: #0d0f14; overflow: hidden; touch-action: none; }

    #chart-wrap { position: relative; width: 100%; height: 100%; touch-action: none; }

    #chart { width: 100%; height: 100%; touch-action: none; }

    #inspect-tip {
      position: absolute;
      z-index: 20;
      pointer-events: none;
      padding: 8px 10px;
      background: rgba(18, 20, 26, 0.96);
      border: 1px solid rgba(14, 164, 171, 0.4);
      border-radius: 6px;
      font: 11px/1.4 -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      color: #e8e8ea;
      min-width: 112px;
      max-width: 168px;
      max-height: 240px;
      overflow-y: auto;
      box-shadow: 0 4px 14px rgba(0, 0, 0, 0.4);
    }

    #inspect-tip.hidden { display: none; }

    #inspect-tip .tip-time { color: #8A8B90; font-size: 10px; margin-bottom: 5px; }

    #inspect-tip .tip-row { display: flex; justify-content: space-between; gap: 10px; font-size: 10px; }

    #inspect-tip .tip-label { color: #8A8B90; }

    #inspect-tip .tip-hi { color: #22c55e; }

    #inspect-tip .tip-lo { color: #ef4444; }

    #inspect-tip .tip-close { color: #0EA4AB; font-weight: 600; }

    #inspect-tip .tip-divider { height: 1px; background: rgba(14, 164, 171, 0.25); margin: 5px 0; }

    #inspect-tip .tip-ind { color: #29B6F6; }

  </style>

</head>

<body>

  <div id="chart-wrap">
    <div id="chart"></div>
    <div id="inspect-tip" class="hidden"></div>
  </div>

  <script src="${chartScriptSrc}" id="lwc-lib"></script>

  <script>

    (function () {
      var CHART_CDN = ${JSON.stringify(chartCdnSrc)};
      var CHART_ASSET = ${JSON.stringify(chartAssetSrc)};

      var UP = '#22c55e';

      var DOWN = '#ef4444';

      var BG = '#0d0f14';

      var GRID = '#1a1d24';

      var TEXT = '#8A8B90';



      var chart = null;

      var candleSeries = null;

      var volumeSeries = null;

      var priceLine = null;

      var mode = 'preview';

      var lastCandles = [];

      var overlaySeriesMap = {};

      var paneSeriesMap = {};

      var lastIndicatorPayload = null;

      /* true after the first full SET_DATA so applyIndicators knows
         not to reset the viewport on subsequent indicator-only pushes */
      var dataInitialised = false;

      var chartCompact = false;

      var crosshairRaf = null;

      var inspectActive = false;

      var pinnedParam = null;

      var inspectTouchMoved = false;

      var inspectTouchStartX = 0;

      var inspectTouchStartY = 0;

      var inspectGesturesBound = false;

      var SERIES_LABELS = {
        ma7: 'MA7', ma25: 'MA25',
        ema12: 'EMA12', ema26: 'EMA26',
        bollUp: 'BOLL↑', bollMid: 'BOLL', bollLow: 'BOLL↓',
        sar: 'SAR',
        macdDif: 'DIF', macdDea: 'DEA', macdHist: 'MACD',
        rsi14: 'RSI14',
        kdjK: 'K', kdjD: 'D', kdjJ: 'J',
        wr14: 'WR14',
        obvLine: 'OBV',
      };



      function formatTipOsc(v) {

        var n = Number(v);

        if (!Number.isFinite(n)) return '—';

        var abs = Math.abs(n);

        if (abs >= 100) return n.toFixed(1);

        if (abs >= 1) return n.toFixed(2);

        return n.toFixed(4);

      }



      function seriesTipValue(pt) {

        if (!pt) return null;

        if (pt.value != null && Number.isFinite(Number(pt.value))) return Number(pt.value);

        if (pt.close != null && Number.isFinite(Number(pt.close))) return Number(pt.close);

        return null;

      }



      function buildIndicatorTipRows(param) {

        if (!param || !param.seriesData) return '';

        var rows = '';

        var keys = [];

        Object.keys(overlaySeriesMap).forEach(function (k) { keys.push(k); });

        Object.keys(paneSeriesMap).forEach(function (k) { keys.push(k); });

        keys.sort();

        keys.forEach(function (key) {

          if (key.indexOf('sar_seg_') === 0 && keys.indexOf('sar') >= 0) return;

          var ser = overlaySeriesMap[key] || paneSeriesMap[key];

          if (!ser) return;

          var pt = param.seriesData.get(ser);

          var val = seriesTipValue(pt);

          if (val == null) return;

          var label = SERIES_LABELS[key] || (key.indexOf('sar_seg_') === 0 ? 'SAR' : key);

          var isOsc = key.indexOf('macd') === 0 || key.indexOf('rsi') === 0

            || key.indexOf('kdj') === 0 || key.indexOf('wr') === 0 || key === 'obvLine';

          rows += '<div class="tip-row"><span class="tip-label">' + label + '</span><span class="tip-ind">'

            + (isOsc ? formatTipOsc(val) : formatTipPrice(val)) + '</span></div>';

        });

        return rows;

      }



      function formatTipPrice(v) {

        var n = Number(v);

        if (!Number.isFinite(n)) return '—';

        if (n >= 10000) return (n / 1000).toFixed(2) + 'k';

        if (n >= 1) return n.toFixed(2);

        if (n >= 0.01) return n.toFixed(4);

        return n.toFixed(6);

      }



      function formatTipVol(v) {

        var n = Number(v);

        if (!Number.isFinite(n) || n <= 0) return '—';

        if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B';

        if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';

        if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';

        return String(Math.round(n));

      }



      function formatTipTime(t) {

        var sec = Number(t);

        if (!Number.isFinite(sec)) return '';

        var d = new Date(sec * 1000);

        var mo = d.getMonth() + 1;

        var da = d.getDate();

        var hh = String(d.getHours()).padStart(2, '0');

        var mm = String(d.getMinutes()).padStart(2, '0');

        return mo + '/' + da + ' ' + hh + ':' + mm;

      }



      function crosshairPayload(param) {

        if (!param || param.time === undefined) {

          return { type: 'CROSSHAIR', time: null, locked: inspectActive };

        }

        var candle = candleSeries && param.seriesData ? param.seriesData.get(candleSeries) : null;

        var vol = volumeSeries && param.seriesData ? param.seriesData.get(volumeSeries) : null;

        return {

          type: 'CROSSHAIR',

          time: param.time,

          locked: inspectActive,

          point: param.point ? { x: param.point.x, y: param.point.y } : null,

          ohlc: candle ? {

            open: candle.open,

            high: candle.high,

            low: candle.low,

            close: candle.close,

            volume: vol ? vol.value : null,

          } : null,

        };

      }



      function hideInspectTip() {

        var tip = document.getElementById('inspect-tip');

        if (tip) tip.classList.add('hidden');

      }



      function updateInspectTip(param) {

        var tip = document.getElementById('inspect-tip');

        if (!tip) return;

        if (!param || param.time === undefined || !param.point) {

          if (!inspectActive) hideInspectTip();

          return;

        }

        pinnedParam = param;

        var candle = candleSeries && param.seriesData ? param.seriesData.get(candleSeries) : null;

        if (!candle) {

          if (!inspectActive) hideInspectTip();

          return;

        }

        var vol = volumeSeries && param.seriesData ? param.seriesData.get(volumeSeries) : null;

        var volVal = vol && vol.value != null ? vol.value : null;

        if (volVal == null) {

          for (var vi = lastCandles.length - 1; vi >= 0; vi--) {

            if (lastCandles[vi].time === param.time) {

              var rawVol = lastCandles[vi].volume;

              if (rawVol != null && Number.isFinite(Number(rawVol))) volVal = Number(rawVol);

              break;

            }

          }

        }

        var indRows = buildIndicatorTipRows(param);

        tip.innerHTML =

          '<div class="tip-time">' + formatTipTime(param.time) + '</div>' +

          '<div class="tip-row"><span class="tip-label">O</span><span>' + formatTipPrice(candle.open) + '</span></div>' +

          '<div class="tip-row"><span class="tip-label">H</span><span class="tip-hi">' + formatTipPrice(candle.high) + '</span></div>' +

          '<div class="tip-row"><span class="tip-label">L</span><span class="tip-lo">' + formatTipPrice(candle.low) + '</span></div>' +

          '<div class="tip-row"><span class="tip-label">C</span><span class="tip-close">' + formatTipPrice(candle.close) + '</span></div>' +

          (volVal != null && volVal > 0

            ? '<div class="tip-row"><span class="tip-label">V</span><span>' + formatTipVol(volVal) + '</span></div>'

            : '') +

          (indRows ? '<div class="tip-divider"></div>' + indRows : '');

        tip.classList.remove('hidden');

        var wrap = document.getElementById('chart-wrap');

        var w = wrap ? wrap.clientWidth : 300;

        var h = wrap ? wrap.clientHeight : 300;

        var left = Math.min(Math.max(8, param.point.x + 12), w - tip.offsetWidth - 8);

        var top = Math.max(8, Math.min(param.point.y - 120, h - tip.offsetHeight - 8));

        tip.style.left = left + 'px';

        tip.style.top = top + 'px';

      }



      function setInspectInteractive(on) {

        if (!chart) return;

        var interactive = mode === 'fullscreen' && !on;

        chart.applyOptions({

          handleScroll: interactive,

          handleScale: interactive,

          kineticScroll: { touch: interactive, mouse: interactive },

          crosshair: {

            mode: (on || mode === 'fullscreen')

              ? LightweightCharts.CrosshairMode.Normal

              : LightweightCharts.CrosshairMode.Magnet,

          },

        });

      }



      function pinCrosshair() {

        if (!chart || !pinnedParam || pinnedParam.time === undefined || !candleSeries) return;

        var candle = pinnedParam.seriesData ? pinnedParam.seriesData.get(candleSeries) : null;

        if (!candle) return;

        try {

          chart.setCrosshairPosition(candle.close, pinnedParam.time, candleSeries);

        } catch (e) {}

      }



      function clearInspect() {

        inspectActive = false;

        pinnedParam = null;

        hideInspectTip();

        try { if (chart) chart.clearCrosshairPosition(); } catch (e) {}

        post({ type: 'CROSSHAIR', time: null, locked: false });

        setInspectInteractive(false);

      }



      function inspectAtClientPoint(clientX, clientY) {

        if (!chart || !candleSeries) return;

        var el = document.getElementById('chart');

        if (!el) return;

        var rect = el.getBoundingClientRect();

        var x = clientX - rect.left;

        var time = chart.timeScale().coordinateToTime(x);

        if (time == null) return;

        var candle = null;

        for (var i = lastCandles.length - 1; i >= 0; i--) {

          if (lastCandles[i].time === time) { candle = lastCandles[i]; break; }

        }

        if (!candle && lastCandles.length) candle = lastCandles[lastCandles.length - 1];

        if (!candle) return;

        try {

          chart.setCrosshairPosition(candle.close, time, candleSeries);

          inspectActive = true;

          setInspectInteractive(true);

          post({

            type: 'CROSSHAIR',

            time: time,

            locked: true,

            ohlc: {

              open: candle.open,

              high: candle.high,

              low: candle.low,

              close: candle.close,

              volume: null,

            },

          });

        } catch (e) {}

      }



      function bindInspectGestures() {

        if (inspectGesturesBound) return;

        var wrap = document.getElementById('chart-wrap');

        if (!wrap) return;

        inspectGesturesBound = true;



        wrap.addEventListener('touchstart', function (e) {

          if (!e.touches || !e.touches[0]) return;

          inspectTouchMoved = false;

          inspectTouchStartX = e.touches[0].clientX;

          inspectTouchStartY = e.touches[0].clientY;

          if (!inspectActive) setInspectInteractive(true);

        }, { passive: true });



        wrap.addEventListener('touchmove', function () {

          inspectTouchMoved = true;

        }, { passive: true });



        wrap.addEventListener('touchend', function () {

          if (inspectActive && !inspectTouchMoved) {

            clearInspect();

            return;

          }

          if (pinnedParam && pinnedParam.time !== undefined) {

            inspectActive = true;

            pinCrosshair();

            updateInspectTip(pinnedParam);

            post(crosshairPayload(pinnedParam));

            setInspectInteractive(true);

            return;

          }

          if (!inspectTouchMoved && !inspectActive) {

            inspectAtClientPoint(inspectTouchStartX, inspectTouchStartY);

            return;

          }

          if (!inspectActive) setInspectInteractive(false);

        }, { passive: true });

      }



      function toTime(t) {

        var n = Number(t);

        if (!Number.isFinite(n)) return 0;

        return n > 1e12 ? Math.floor(n / 1000) : n;

      }



      function toCandle(k) {

        return {

          time: toTime(k.time),

          open: Number(k.open),

          high: Number(k.high),

          low: Number(k.low),

          close: Number(k.close),

        };

      }



      function toVolume(k) {

        var up = Number(k.close) >= Number(k.open);

        return {

          time: toTime(k.time),

          value: Number(k.volume) || 0,

          color: up ? 'rgba(34,197,94,0.35)' : 'rgba(239,68,68,0.35)',

        };

      }



      function post(msg) {

        if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {

          window.ReactNativeWebView.postMessage(JSON.stringify(msg));

        }

      }



      function removeSeries(map) {

        Object.keys(map).forEach(function (key) {

          try { chart.removeSeries(map[key]); } catch (e) {}

          delete map[key];

        });

      }



      function pruneSeriesMap(map, keepIds) {

        Object.keys(map).forEach(function (key) {

          if (keepIds.indexOf(key) < 0) {

            try { chart.removeSeries(map[key]); } catch (e) {}

            delete map[key];

          }

        });

      }



      function chartHeightPx() {

        var el = document.getElementById('chart');

        return el && el.clientHeight > 0 ? el.clientHeight : 300;

      }



      /** Snap viewport so recent candles fill the plot — no empty gap on the right. */
      function snapDefaultViewport() {

        if (!chart || !lastCandles.length) return;

        var el = document.getElementById('chart');

        var chartW = el && el.clientWidth > 0 ? el.clientWidth : 300;

        var baseSpacing = chartCompact ? 5 : 7;

        var axisW = 56;

        var plotW = Math.max(96, chartW - axisW);

        var barsOnScreen = Math.max(28, Math.floor(plotW / baseSpacing));

        var n = lastCandles.length;

        try {

          if (n <= barsOnScreen) {

            chart.timeScale().applyOptions({ rightOffset: 0 });

            chart.timeScale().fitContent();

            return;

          }

          var vis = Math.min(n, barsOnScreen);

          var spacing = plotW / vis;

          chart.timeScale().applyOptions({ barSpacing: spacing, rightOffset: 0 });

          chart.timeScale().setVisibleLogicalRange({

            from: n - vis,

            to: n,

          });

        } catch (e) {}

      }



      /** Height-aware pane stacking — main chart on top, volume under candles, oscillators below volume. */

      function computeLayout(payload) {

        var H = chartHeightPx();

        var volOn = payload && payload.vol;

        var paneCount = payload && payload.panes ? payload.panes.length : 0;

        var MIN_VOL = mode === 'preview' ? 44 : 68;

        var MIN_PANE = mode === 'preview' ? 48 : 64;

        var GAP = 2;

        var timeAxis = Math.max(22, Math.round(H * 0.06));

        var topPad = Math.max(0.04, 28 / H);



        var volPx = volOn ? MIN_VOL : 0;

        var panePx = paneCount > 0 ? paneCount * MIN_PANE + Math.max(0, paneCount - 1) * GAP : 0;

        var subPx = volPx + panePx;

        var maxSubFrac = mode === 'preview' ? 0.42 : 0.58;

        var maxSubPx = Math.floor(H * maxSubFrac);

        if (subPx > maxSubPx && subPx > 0) {

          var scale = maxSubPx / subPx;

          volPx = Math.floor(volPx * scale);

          panePx = Math.floor(panePx * scale);

          subPx = volPx + panePx;

        }



        var volFrac = volPx / H;

        var paneFracEach = paneCount > 0 ? panePx / paneCount / H : 0;

        var oscFrac = paneCount * paneFracEach;

        var subFrac = oscFrac + volFrac;

        var mainBottom = Math.min(0.82, (subPx + timeAxis) / H);



        return {

          H: H,

          volOn: volOn,

          paneCount: paneCount,

          volFrac: volFrac,

          paneFracEach: paneFracEach,

          oscFrac: oscFrac,

          subFrac: subFrac,

          mainBottom: mainBottom,

          topPad: topPad,

          timeAxis: timeAxis,

        };

      }



      function layoutScales(payload) {

        if (!chart) return;

        var layout = computeLayout(payload);

        var volOn = layout.volOn;

        var paneCount = layout.paneCount;

        var volFrac = layout.volFrac;

        var paneFrac = layout.paneFracEach;

        var oscFrac = layout.oscFrac;

        var mainBottom = layout.mainBottom;



        /* Main candle pane — overlays (MA/EMA/BOLL/SAR) share this scale. */

        chart.priceScale('right').applyOptions({

          scaleMargins: { top: layout.topPad, bottom: mainBottom },

          borderVisible: true,

        });



        /* Volume strip directly under the main chart (website-style). */

        if (volumeSeries) {

          volumeSeries.applyOptions({ visible: !!volOn });

          if (volOn) {

            try {

              chart.priceScale('vol').applyOptions({

                scaleMargins: { top: Math.max(0, 1 - oscFrac - volFrac), bottom: oscFrac },

                borderVisible: false,

                alignLabels: true,

              });

            } catch (e) {}

          }

        }



        /* Oscillator panes below volume — first in payload sits just under volume, last is closest to time axis. */

        if (payload && payload.panes) {

          payload.panes.forEach(function (pane, i) {

            var idxFromBottom = paneCount - 1 - i;

            var bottom = idxFromBottom * paneFrac;

            var top = bottom + paneFrac;

            var scaleOpts = {

              scaleMargins: { top: Math.max(0, 1 - top - volFrac), bottom: Math.max(0, bottom) },

              borderVisible: false,

              alignLabels: true,

            };

            if (pane.scale) {

              if (pane.scale.autoScale === false) {

                scaleOpts.autoScale = false;

                if (pane.scale.minimum != null) scaleOpts.minimum = pane.scale.minimum;

                if (pane.scale.maximum != null) scaleOpts.maximum = pane.scale.maximum;

              } else {

                scaleOpts.autoScale = true;

              }

            }

            try {

              chart.priceScale(pane.id).applyOptions(scaleOpts);

            } catch (e) {}

          });

        }

      }



      /* SAR needs dots not a connected line across bullish↔bearish flips.
         We detect the crossover by comparing SAR vs close price.
         When SAR is below the close it is bullish (dot below candle);
         when above it is bearish (dot above candle).
         We break the series at every flip so no line crosses the candles. */
      function splitSarSegments(data) {
        /* data = [ { time, value, close } ] — close is sent by chartIndicators */
        var segments = [];
        var current = null;
        for (var i = 0; i < data.length; i++) {
          var pt = data[i];
          var bull = pt.close != null ? pt.value < pt.close : true;
          if (current === null || current.bull !== bull) {
            current = { bull: bull, pts: [] };
            segments.push(current);
          }
          current.pts.push({ time: pt.time, value: pt.value });
        }
        return segments;
      }

      function upsertOverlay(ov) {

        if (!ov.data || !ov.data.length) return;

        /* SAR: render as separate line segments per trend to avoid
           the connecting line crossing through candles on a reversal. */
        if (ov.id === 'sar' && ov.data[0] && ov.data[0].close != null) {

          /* Remove previous single SAR series if it exists */
          if (overlaySeriesMap['sar']) {
            try { chart.removeSeries(overlaySeriesMap['sar']); } catch (e) {}
            delete overlaySeriesMap['sar'];
          }

          /* Remove stale SAR segment series from a previous render */
          Object.keys(overlaySeriesMap).forEach(function (key) {
            if (key.indexOf('sar_seg_') === 0) {
              try { chart.removeSeries(overlaySeriesMap[key]); } catch (e) {}
              delete overlaySeriesMap[key];
            }
          });

          var segments = splitSarSegments(ov.data);
          segments.forEach(function (seg, idx) {
            var key = 'sar_seg_' + idx;
            var s = chart.addLineSeries({
              color: seg.bull ? UP : DOWN,
              lineWidth: 1,
              lineStyle: 1, /* dotted */
              priceLineVisible: false,
              lastValueVisible: false,
              crosshairMarkerVisible: true,
              crosshairMarkerRadius: 3,
              priceScaleId: 'right',
            });
            s.setData(seg.pts);
            overlaySeriesMap[key] = s;
          });

          return;
        }

        var opts = {

          color: ov.color || TEXT,

          lineWidth: ov.lineWidth || 1,

          priceLineVisible: false,

          lastValueVisible: false,

          crosshairMarkerVisible: false,

          priceScaleId: 'right',

        };

        var s = overlaySeriesMap[ov.id];

        if (!s) {

          s = chart.addLineSeries(opts);

          overlaySeriesMap[ov.id] = s;

        } else {

          s.applyOptions(opts);

        }

        s.setData(ov.data);

      }



      function upsertPaneSeries(pane, ser) {

        if (!ser.data || !ser.data.length) return;

        var scaleId = pane.id;

        if (ser.kind === 'histogram') {

          var hOpts = {

            priceScaleId: scaleId,

            priceLineVisible: false,

            lastValueVisible: false,

          };

          var h = paneSeriesMap[ser.id];

          if (!h) {

            h = chart.addHistogramSeries(hOpts);

            paneSeriesMap[ser.id] = h;

          } else {

            h.applyOptions(hOpts);

          }

          h.setData(ser.data);

        } else {

          var lOpts = {

            priceScaleId: scaleId,

            color: ser.color || TEXT,

            lineWidth: ser.lineWidth || 1,

            priceLineVisible: false,

            lastValueVisible: false,

            crosshairMarkerVisible: false,

          };

          var l = paneSeriesMap[ser.id];

          if (!l) {

            l = chart.addLineSeries(lOpts);

            paneSeriesMap[ser.id] = l;

          } else {

            l.applyOptions(lOpts);

          }

          l.setData(ser.data);

        }

      }



      function applyIndicators(payload) {

        if (!chart) return;

        lastIndicatorPayload = payload || { vol: false, overlays: [], panes: [] };



        var overlayIds = (lastIndicatorPayload.overlays || []).map(function (o) { return o.id; });

        /* SAR may be rendered as multiple sar_seg_N series — keep them if
           'sar' is in the active list, prune them all if it's not. */
        var sarActive = overlayIds.indexOf('sar') >= 0;
        if (!sarActive) {
          Object.keys(overlaySeriesMap).forEach(function (key) {
            if (key.indexOf('sar_seg_') === 0) {
              try { chart.removeSeries(overlaySeriesMap[key]); } catch (e) {}
              delete overlaySeriesMap[key];
            }
          });
        }
        /* Exclude sar_seg_* from the normal prune so they are managed above */
        var overlayIdsForPrune = Object.keys(overlaySeriesMap).filter(function (k) {
          return k.indexOf('sar_seg_') < 0;
        }).map(function (k) { return k; });
        /* Prune only non-SAR overlays */
        Object.keys(overlaySeriesMap).forEach(function (key) {
          if (key.indexOf('sar_seg_') === 0) return;
          if (overlayIds.indexOf(key) < 0) {
            try { chart.removeSeries(overlaySeriesMap[key]); } catch (e) {}
            delete overlaySeriesMap[key];
          }
        });

        var paneSeriesIds = [];

        (lastIndicatorPayload.panes || []).forEach(function (pane) {

          (pane.series || []).forEach(function (ser) { paneSeriesIds.push(ser.id); });

        });



        pruneSeriesMap(paneSeriesMap, paneSeriesIds);



        (lastIndicatorPayload.overlays || []).forEach(upsertOverlay);



        (lastIndicatorPayload.panes || []).forEach(function (pane) {

          (pane.series || []).forEach(function (ser) {

            upsertPaneSeries(pane, ser);

          });

        });



        layoutScales(lastIndicatorPayload);

      }



      function ensureChart() {

        if (chart) return;

        var el = document.getElementById('chart');

        chart = LightweightCharts.createChart(el, {

          layout: { background: { color: BG }, textColor: TEXT, fontSize: 11, attributionLogo: false },

          grid: {

            vertLines: { color: GRID, style: 1 },

            horzLines: { color: GRID, style: 1 },

          },

          crosshair: {

            mode: LightweightCharts.CrosshairMode.Normal,

            vertLine: { color: '#0EA4AB', width: 1, style: 2, labelBackgroundColor: '#0EA4AB' },

            horzLine: { color: '#0EA4AB', width: 1, style: 2, labelBackgroundColor: '#0EA4AB' },

          },

          rightPriceScale: { borderColor: '#2a2d35', scaleMargins: { top: 0.06, bottom: 0.2 } },

          leftPriceScale: { visible: false },

          timeScale: {

            borderColor: '#2a2d35',

            timeVisible: true,

            secondsVisible: false,

            rightOffset: 0,

            barSpacing: 7,

            fixLeftEdge: false,

            fixRightEdge: false,

          },

          handleScroll: false,

          handleScale: false,

          kineticScroll: { touch: false, mouse: false },

        });



        candleSeries = chart.addCandlestickSeries({

          upColor: UP,

          downColor: DOWN,

          borderVisible: false,

          wickUpColor: UP,

          wickDownColor: DOWN,

          priceScaleId: 'right',

        });



        volumeSeries = chart.addHistogramSeries({

          priceFormat: { type: 'volume' },

          priceScaleId: 'vol',

        });

        try {

          chart.priceScale('vol').applyOptions({

            scaleMargins: { top: 0.82, bottom: 0 },

            borderVisible: false,

          });

        } catch (e) {}



        var ro = new ResizeObserver(function () {

          if (chart && el) {

            chart.applyOptions({ width: el.clientWidth, height: el.clientHeight });

            if (lastIndicatorPayload) layoutScales(lastIndicatorPayload);

          }

        });

        ro.observe(el);

        chart.applyOptions({ width: el.clientWidth, height: el.clientHeight });

        chart.subscribeCrosshairMove(function (param) {

          if (crosshairRaf) cancelAnimationFrame(crosshairRaf);

          crosshairRaf = requestAnimationFrame(function () {

            crosshairRaf = null;

            if (!param || param.time === undefined) {

              if (!inspectActive) {

                hideInspectTip();

                post({ type: 'CROSSHAIR', time: null, locked: false });

              }

              return;

            }

            updateInspectTip(param);

            post(crosshairPayload(param));

          });

        });



        bindInspectGestures();

        post({ type: 'READY' });

      }



      function applyMode(next) {

        mode = next === 'fullscreen' ? 'fullscreen' : 'preview';

        if (!chart) return;

        if (inspectActive) {

          setInspectInteractive(true);

          return;

        }

        var interactive = mode === 'fullscreen';

        chart.applyOptions({

          handleScroll: interactive,

          handleScale: interactive,

          kineticScroll: { touch: interactive, mouse: interactive },

          crosshair: {

            mode: interactive

              ? LightweightCharts.CrosshairMode.Normal

              : LightweightCharts.CrosshairMode.Magnet,

          },

        });

        if (!interactive) {

          snapDefaultViewport();

        }

        if (lastIndicatorPayload) layoutScales(lastIndicatorPayload);

      }



      function setTracer(price) {

        if (!candleSeries || !Number.isFinite(price)) return;

        if (priceLine) {

          try { candleSeries.removePriceLine(priceLine); } catch (e) {}

          priceLine = null;

        }

        priceLine = candleSeries.createPriceLine({

          price: price,

          color: UP,

          lineWidth: 1,

          lineStyle: 2,

          axisLabelVisible: true,

          title: '',

        });

      }



      function applyCompactLayout(on) {

        if (!chart) return;

        if (on) {

          chart.applyOptions({

            rightPriceScale: { scaleMargins: { top: 0.05, bottom: 0.1 } },

            timeScale: {

              visible: true,

              timeVisible: true,

              secondsVisible: false,

              borderColor: GRID,

              barSpacing: 5,

              rightOffset: 0,

            },

          });

          if (volumeSeries) {
            var showVol = lastIndicatorPayload && lastIndicatorPayload.vol;
            volumeSeries.applyOptions({ visible: !!showVol });
          }

        }

      }



      function setData(klines, livePrice, indicators, compact) {

        ensureChart();

        if (!Array.isArray(klines) || !klines.length) return;



        var candles = [];

        var volumes = [];

        for (var i = 0; i < klines.length; i++) {

          var c = toCandle(klines[i]);

          if (!c.time) continue;

          candles.push(c);

          volumes.push(toVolume(klines[i]));

        }

        if (!candles.length) return;



        /* Reset dataInitialised when loading a completely new symbol/interval
           so the viewport snaps to fit the fresh dataset. */
        dataInitialised = false;

        lastCandles = candles;

        candleSeries.setData(candles);

        volumeSeries.setData(volumes);



        if (indicators) {

          applyIndicators(indicators);

        } else if (lastIndicatorPayload) {

          applyIndicators(lastIndicatorPayload);

        } else {

          layoutScales({ vol: false, overlays: [], panes: [] });

          volumeSeries.applyOptions({ visible: false });

        }



        var last = candles[candles.length - 1];

        var tracer = Number.isFinite(livePrice) ? livePrice : last.close;

        setTracer(tracer);

        chartCompact = !!compact;

        applyCompactLayout(!!compact);

        dataInitialised = true;

        snapDefaultViewport();

      }



      function updateCandle(kline, livePrice) {

        if (!candleSeries || !kline) return;

        ensureChart();

        var c = toCandle(kline);

        var v = toVolume(kline);

        if (!c.time) return;



        if (!lastCandles.length) {

          lastCandles = [c];

          candleSeries.setData([c]);

          volumeSeries.setData([v]);

          setTracer(Number.isFinite(livePrice) ? livePrice : c.close);

          return;

        }



        var last = lastCandles[lastCandles.length - 1];

        if (c.time === last.time) {

          candleSeries.update(c);

          volumeSeries.update(v);

          lastCandles[lastCandles.length - 1] = c;

        } else if (c.time > last.time) {

          candleSeries.update(c);

          volumeSeries.update(v);

          lastCandles.push(c);

          if (lastCandles.length > 1000) lastCandles.shift();

        } else {

          return;

        }



        var tracer = Number.isFinite(livePrice) ? livePrice : c.close;

        setTracer(tracer);

        /* Keep overlay series (MA/EMA/BOLL/SAR) and pane series (MACD/RSI etc.)
           in sync with the latest candle by updating the last data point for
           every series that already has data. This avoids a full
           SET_INDICATORS round-trip on every tick. */
        try {
          Object.keys(overlaySeriesMap).forEach(function (key) {
            var s = overlaySeriesMap[key];
            var d = s.data ? s.data() : null;
            if (d && d.length) {
              var last = d[d.length - 1];
              if (last && last.time === c.time) {
                /* The last point belongs to this bar — no-op; indicator
                   recalc from RN will arrive shortly via SET_INDICATORS. */
              }
            }
          });
        } catch (e) {}

        if (mode === 'preview') {

          snapDefaultViewport();

        }

      }



      function updateLive(price) {

        if (!candleSeries || !Number.isFinite(price) || !lastCandles.length) return;

        var last = lastCandles[lastCandles.length - 1];

        var updated = {

          time: last.time,

          open: last.open,

          high: Math.max(last.high, price),

          low: Math.min(last.low, price),

          close: price,

        };

        candleSeries.update(updated);

        lastCandles[lastCandles.length - 1] = updated;

        setTracer(price);

      }



      function onMessage(raw) {

        try {

          var msg = typeof raw === 'string' ? JSON.parse(raw) : raw;

          if (!msg || !msg.type) return;

          if (msg.type === 'SET_MODE') {

            applyMode(msg.mode);

            return;

          }

          if (msg.type === 'CLEAR_INSPECT') {

            clearInspect();

            return;

          }

          if (msg.type === 'SET_INDICATORS') {

            applyIndicators(msg.indicators);

            return;

          }

          if (msg.type === 'SET_DATA') {

            if (msg.mode) applyMode(msg.mode);

            setData(msg.klines, msg.livePrice, msg.indicators, msg.compact);

            return;

          }

          if (msg.type === 'UPDATE_CANDLE') {

            updateCandle(msg.kline, msg.livePrice);

            return;

          }



          if (msg.type === 'UPDATE_PRICE') {

            updateLive(msg.price);

          }

        } catch (e) {}

      }



      document.addEventListener('message', function (e) { onMessage(e.data); });

      window.addEventListener('message', function (e) { onMessage(e.data); });



      function loadScript(id, src, onDone) {

        if (document.getElementById(id)) return;

        var s = document.createElement('script');

        s.id = id;

        s.src = src;

        s.onload = function () { onDone(); };

        s.onerror = function () { onDone(true); };

        document.head.appendChild(s);

      }



      function loadCdnFallback() {

        loadScript('lwc-cdn', CHART_CDN, function (failed) {

          if (failed) post({ type: 'SCRIPT_ERROR', message: 'CDN load failed' });

          else bootstrap(0);

        });

      }



      function loadAssetFallback() {

        if (!CHART_ASSET) { loadCdnFallback(); return; }

        loadScript('lwc-asset', CHART_ASSET, function (failed) {

          if (failed) loadCdnFallback();

          else bootstrap(0);

        });

      }



      function bootstrap(attempts) {

        if (typeof LightweightCharts !== 'undefined') {

          try { ensureChart(); } catch (err) { post({ type: 'ERROR', message: String(err) }); }

          return;

        }

        if (attempts >= 40) {

          loadAssetFallback();

          return;

        }

        setTimeout(function () { bootstrap(attempts + 1); }, 50);

      }



      var libTag = document.getElementById('lwc-lib');

      if (libTag) {

        libTag.onerror = function () { loadAssetFallback(); };

      }

      bootstrap(0);

    })();

  </script>

</body>

</html>`;

}


