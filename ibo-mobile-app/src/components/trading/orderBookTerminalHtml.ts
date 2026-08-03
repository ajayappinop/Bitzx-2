/**
 * Self-contained exchange-style order book HTML for WebView.
 * Renders depth ladder in JS — updates via postMessage without React re-renders.
 */
export function buildOrderBookTerminalHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
    html, body {
      width: 100%; height: 100%;
      background: #0a0f18;
      overflow: hidden;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      touch-action: manipulation;
    }
    #root { display: flex; flex-direction: column; width: 100%; height: 100%; }
    .header {
      display: flex; flex-shrink: 0;
      padding: 4px 6px;
      border-bottom: 1px solid #1E2329;
      color: #848E9C;
      font-size: 9px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.3px;
    }
    .header span { flex: 1; }
    .header .right { text-align: right; }
    .body {
      flex: 1; min-height: 0;
      display: flex; flex-direction: column;
    }
    .asks { flex: 1; min-height: 0; display: flex; flex-direction: column; justify-content: flex-end; overflow: hidden; }
    .bids { flex: 1; min-height: 0; display: flex; flex-direction: column; justify-content: flex-start; overflow: hidden; }
    .row {
      position: relative; display: flex; align-items: center;
      flex: 1; min-height: 12px; max-height: 28px;
      padding: 0 6px; overflow: hidden; cursor: pointer;
    }
    .row .bar-cum, .row .bar-row {
      position: absolute; top: 0; bottom: 0; opacity: 1;
    }
    .row.ask .bar-cum, .row.ask .bar-row { right: 0; }
    .row.bid .bar-cum, .row.bid .bar-row { left: 0; }
    .row .price, .row .amt {
      position: relative; z-index: 2; flex: 1;
      font-size: 11px; font-variant-numeric: tabular-nums;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .row .amt { text-align: right; color: #EAECEF; }
    .mid {
      flex-shrink: 0; text-align: center;
      padding: 5px 6px;
      border-top: 1px solid #1E2329;
      border-bottom: 1px solid #1E2329;
      background: #141A22;
    }
    .mid-price { font-size: 15px; font-weight: 600; font-variant-numeric: tabular-nums; }
    .mid-sub { font-size: 9px; color: #848E9C; margin-top: 2px; }
    .footer { flex-shrink: 0; padding: 4px 6px 6px; }
    .depth-bar { display: flex; height: 3px; border-radius: 2px; overflow: hidden; }
    .depth-bid { background: var(--long); opacity: 0.75; }
    .depth-ask { background: var(--short); opacity: 0.75; }
    .depth-labels { display: flex; justify-content: space-between; padding-top: 2px; font-size: 9px; font-weight: 700; }
    .loading #root { opacity: 0.42; }
    .spinner { display: none; width: 18px; height: 18px; margin: 0 auto;
      border: 2px solid #1E2329; border-top-color: #F0B90B; border-radius: 50%;
      animation: spin 0.7s linear infinite; }
    .loading .spinner { display: block; }
    @keyframes spin { to { transform: rotate(360deg); } }
    .compact .row .total { display: none; }
    .default .side { padding: 2px 6px; font-size: 9px; font-weight: 700; text-transform: uppercase; }
  </style>
</head>
<body>
  <div id="root">
    <div class="header" id="hdr">
      <span>Price</span>
      <span class="right" id="amtLabel">Amount</span>
      <span class="right col-total" id="totalLabel" style="display:none">Total</span>
    </div>
    <div class="body" id="body">
      <div class="asks" id="asks"></div>
      <div class="mid" id="mid">
        <div class="spinner" id="spin"></div>
        <div class="mid-price" id="midPrice">—</div>
        <div class="mid-sub" id="midSub"></div>
      </div>
      <div class="bids" id="bids"></div>
    </div>
    <div class="footer" id="footer" style="display:none">
      <div class="depth-bar" id="depthBar"></div>
      <div class="depth-labels" id="depthLabels"></div>
    </div>
  </div>
  <script>
    (function () {
      var SHORT = '#F6465D';
      var LONG = '#0ECB81';
      var LONG_DIM = 'rgba(14,203,129,0.12)';
      var SHORT_DIM = 'rgba(246,70,93,0.12)';
      var SHORT_DARK = 'rgba(246,70,93,0.07)';
      var LONG_DARK = 'rgba(14,203,129,0.07)';

      var state = {
        variant: 'terminal',
        maxRows: 10,
        compact: false,
        priceUp: true,
        hideDepthFooter: false,
        fairPrice: null,
        loading: false,
      };

      function post(obj) {
        if (window.ReactNativeWebView) {
          window.ReactNativeWebView.postMessage(JSON.stringify(obj));
        }
      }

      function num(v) {
        var n = parseFloat(String(v));
        return Number.isFinite(n) ? n : 0;
      }

      function fmtPrice(p) {
        var n = num(p);
        if (n <= 0) return '—';
        if (n >= 1000) return n.toFixed(2);
        if (n >= 1) return n.toFixed(4);
        return n.toFixed(6);
      }

      function fmtAmt(a) {
        var n = num(a);
        if (n <= 0) return '—';
        if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
        if (n >= 1e3) return (n / 1e3).toFixed(2) + 'K';
        return n >= 1 ? n.toFixed(2) : n.toFixed(4);
      }

      function fmtTotal(v) {
        if (!Number.isFinite(v) || v <= 0) return '—';
        if (v >= 1e6) return (v / 1e6).toFixed(2) + 'M';
        if (v >= 1e3) return (v / 1e3).toFixed(2) + 'K';
        return v >= 1 ? v.toFixed(2) : v.toFixed(4);
      }

      function sortAsks(rows) {
        return rows.slice().sort(function (a, b) { return num(a.price) - num(b.price); });
      }

      function sortBids(rows) {
        return rows.slice().sort(function (a, b) { return num(b.price) - num(a.price); });
      }

      function rowHtml(entry, side, cum, maxCum, notional, maxN, showTotal) {
        var isAsk = side === 'ask';
        var color = isAsk ? SHORT : LONG;
        var pct = maxCum > 0 ? (cum / maxCum) * 100 : 0;
        var rowPct = maxN > 0 ? (notional / maxN) * 100 : 0;
        var bgCum = isAsk ? SHORT_DARK : LONG_DARK;
        var bgRow = isAsk ? SHORT_DIM : LONG_DIM;
        var align = isAsk ? 'right' : 'left';
        var totalCol = showTotal
          ? '<span class="amt total" style="text-align:right;color:#848E9C">' + fmtTotal(notional) + '</span>'
          : '';
        return '<div class="row ' + side + '" data-price="' + entry.price + '">' +
          '<div class="bar-cum" style="width:' + pct + '%;background:' + bgCum + ';' + align + ':0"></div>' +
          '<div class="bar-row" style="width:' + rowPct + '%;background:' + bgRow + ';' + align + ':0"></div>' +
          '<span class="price" style="color:' + color + '">' + fmtPrice(entry.price) + '</span>' +
          '<span class="amt">' + fmtAmt(entry.amount) + '</span>' +
          totalCol +
        '</div>';
      }

      function renderRows(container, rows, side, maxRows, showTotal) {
        var sorted = side === 'ask' ? sortAsks(rows) : sortBids(rows);
        var slice = sorted.slice(0, maxRows);
        if (side === 'ask') slice = slice.reverse();
        var cum = 0;
        var maxCum = 0;
        var maxN = 1;
        slice.forEach(function (r) {
          cum += num(r.amount);
          maxCum = Math.max(maxCum, cum);
          maxN = Math.max(maxN, num(r.price) * num(r.amount));
        });
        cum = 0;
        var html = '';
        slice.forEach(function (r, i) {
          cum += num(r.amount);
          var n = num(r.price) * num(r.amount);
          html += rowHtml(r, side, cum, maxCum, n, maxN, showTotal);
        });
        container.innerHTML = html;
      }

      function renderMid(currentPrice, asks, bids) {
        var topAsk = asks.length ? num(asks[asks.length - 1].price) : 0;
        var topBid = bids.length ? num(bids[0].price) : 0;
        var lp = num(currentPrice);
        var mid = lp > 0 ? lp : (topAsk && topBid ? (topAsk + topBid) / 2 : (topAsk || topBid || 0));
        var midEl = document.getElementById('midPrice');
        var subEl = document.getElementById('midSub');
        var color = state.priceUp ? LONG : SHORT;
        if (state.loading && asks.length === 0 && bids.length === 0) {
          midEl.textContent = '—';
          subEl.textContent = '';
          return;
        }
        midEl.textContent = mid > 0 ? fmtPrice(mid) : '—';
        midEl.style.color = color;
        if (state.fairPrice != null && state.variant === 'terminal') {
          subEl.textContent = 'Fair Price ' + fmtPrice(state.fairPrice);
        } else if (topAsk && topBid) {
          var spread = topAsk - topBid;
          var pct = topBid > 0 ? (spread / topBid) * 100 : 0;
          subEl.textContent = pct > 0 ? ('Spread ' + pct.toFixed(3) + '%') : '';
        } else {
          subEl.textContent = '';
        }
      }

      function renderDepth(asks, bids) {
        var footer = document.getElementById('footer');
        if (state.hideDepthFooter || state.variant !== 'terminal') {
          footer.style.display = 'none';
          return;
        }
        footer.style.display = 'block';
        var askVol = 0, bidVol = 0;
        asks.forEach(function (a) { askVol += num(a.amount); });
        bids.forEach(function (b) { bidVol += num(b.amount); });
        var total = askVol + bidVol;
        var bidPct = total > 0 ? (bidVol / total) * 100 : 50;
        var askPct = 100 - bidPct;
        document.getElementById('depthBar').innerHTML =
          '<div class="depth-bid" style="flex:' + bidPct + '"></div>' +
          '<div class="depth-ask" style="flex:' + askPct + '"></div>';
        document.getElementById('depthLabels').innerHTML =
          '<span style="color:' + LONG + '">' + bidPct.toFixed(2) + '%</span>' +
          '<span style="color:' + SHORT + '">' + askPct.toFixed(2) + '%</span>';
      }

      function applyBook(payload) {
        if (payload.longColor) { LONG = payload.longColor; document.documentElement.style.setProperty('--long', LONG); }
        if (payload.longDim) LONG_DIM = payload.longDim;
        if (payload.variant) state.variant = payload.variant;
        if (payload.maxRows != null) state.maxRows = payload.maxRows;
        if (payload.compact != null) state.compact = payload.compact;
        if (payload.priceUp != null) state.priceUp = payload.priceUp;
        if (payload.hideDepthFooter != null) state.hideDepthFooter = payload.hideDepthFooter;
        if (payload.fairPrice !== undefined) state.fairPrice = payload.fairPrice;
        if (payload.loading != null) state.loading = payload.loading;

        document.body.className =
          (state.loading ? 'loading ' : '') +
          (state.compact ? 'compact' : state.variant || 'terminal');
        document.getElementById('totalLabel').style.display =
          state.variant === 'default' && !state.compact ? 'block' : 'none';

        var asks = payload.asks || [];
        var bids = payload.bids || [];
        var showTotal = state.variant === 'default' && !state.compact;
        var asksEl = document.getElementById('asks');
        var bidsEl = document.getElementById('bids');

        if (state.variant === 'default') {
          asksEl.innerHTML = '<div class="side" style="color:' + SHORT + 'cc">▼ Asks</div>';
          bidsEl.innerHTML = '<div class="side" style="color:' + LONG + 'cc">▲ Bids</div>';
        }

        var asksWrap = document.createElement('div');
        var bidsWrap = document.createElement('div');
        renderRows(asksWrap, asks, 'ask', state.maxRows, showTotal);
        renderRows(bidsWrap, bids, 'bid', state.maxRows, showTotal);
        if (state.variant === 'default') {
          asksEl.appendChild(asksWrap);
          bidsEl.appendChild(bidsWrap);
        } else {
          asksEl.innerHTML = asksWrap.innerHTML;
          bidsEl.innerHTML = bidsWrap.innerHTML;
        }

        renderMid(payload.currentPrice, sortAsks(asks).slice(0, state.maxRows), sortBids(bids).slice(0, state.maxRows));
        renderDepth(
          sortAsks(asks).slice(0, state.maxRows),
          sortBids(bids).slice(0, state.maxRows),
        );
      }

      document.getElementById('body').addEventListener('click', function (e) {
        var el = e.target;
        while (el && el !== document.body) {
          if (el.classList && el.classList.contains('row') && el.dataset.price) {
            post({ type: 'PRICE_CLICK', price: String(el.dataset.price) });
            return;
          }
          el = el.parentElement;
        }
        if (e.target.closest && e.target.closest('#mid')) {
          var mp = document.getElementById('midPrice').textContent;
          if (mp && mp !== '—') post({ type: 'PRICE_CLICK', price: mp });
        }
      });

      function onMessage(e) {
        var data = e.data;
        if (typeof data === 'string') {
          try { data = JSON.parse(data); } catch (err) { return; }
        }
        if (!data || !data.type) return;
        if (data.type === 'SET_BOOK') applyBook(data);
        if (data.type === 'UPDATE_PRICE') {
          var mp = document.getElementById('midPrice');
          if (mp) mp.textContent = fmtPrice(data.price);
        }
      }

      document.addEventListener('message', onMessage);
      window.addEventListener('message', onMessage);
      post({ type: 'READY' });
    })();
  </script>
</body>
</html>`;
}
