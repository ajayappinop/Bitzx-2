import { useEffect, useState, useRef } from 'react';
import { exchangeWsPath, displayBaseForApiSymbol, parsePairFromApiSymbol } from '@/services/marketApi';
import { useAuth } from '@/context/AuthContext';

const fmtP = (n) => {
  const v = parseFloat(n);
  if (!Number.isFinite(v)) return '—';
  if (v >= 1000) return v.toFixed(1);
  if (v >= 1) return v.toFixed(v >= 100 ? 1 : 4);
  return v.toFixed(6);
};
const fmtQ = (n) => {
  const v = parseFloat(n);
  if (!Number.isFinite(v)) return '—';
  if (v >= 1e6) return `${(v / 1e6).toFixed(2)}M`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(2)}K`;
  // Reference: 0.025, 0.007, 1.463
  if (v >= 0.001) return v.toFixed(3);
  return v.toFixed(4);
};
const ts = (ms) => new Date(ms).toLocaleTimeString('en-US', {
  hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit',
});

/**
 * Recent trades — Price (arrow) · Size · Time /B|/S  (screenshot layout)
 */
export default function RecentTrades({ symbol, hideHeader = false }) {
  const { orderHistory } = useAuth();
  const { quote } = parsePairFromApiSymbol(symbol);
  const base = displayBaseForApiSymbol(symbol);
  const quoteLabel = quote === 'USDT' || quote === 'USD' ? 'USD' : (quote || 'USD');

  const [trades, setTrades] = useState([]);
  const [loading, setLoading] = useState(true);
  const [newestId, setNewestId] = useState(null);
  const prevTopId = useRef(null);

  useEffect(() => {
    setLoading(true);
    setTrades([]);
    prevTopId.current = null;
    const qs = new URLSearchParams({ symbol, limit: '50' });
    const url = exchangeWsPath(`/api/ws/exchange/trades?${qs.toString()}`);
    let closed = false;
    let reconnectTimer = null;
    let ws = null;
    const connect = () => {
      if (closed) return;
      ws = new WebSocket(url);
      ws.onmessage = (ev) => {
        try {
          const j = JSON.parse(ev.data);
          if (j.type === 'exchange_trades' && Array.isArray(j.trades)) {
            const data = j.trades;
            if (!data.length) {
              setLoading(false);
              return;
            }
            setLoading(false);
            setTrades(data);
            const topId = data[0]?.id ?? data[0]?.tradeId ?? null;
            if (topId && topId !== prevTopId.current) {
              prevTopId.current = topId;
              setNewestId(topId);
              setTimeout(() => setNewestId(null), 900);
            }
          }
        } catch {
          /* ignore */
        }
      };
      ws.onclose = () => {
        ws = null;
        if (!closed) reconnectTimer = window.setTimeout(connect, 3000);
      };
    };
    connect();
    return () => {
      closed = true;
      if (reconnectTimer) window.clearTimeout(reconnectTimer);
      if (ws) {
        try { ws.close(); } catch { /* ignore */ }
      }
    };
  }, [symbol]);

  const myFilledPrices = new Set(
    (orderHistory || [])
      .filter((o) => o.status === 'filled' && o.avg_price)
      .map((o) => fmtP(o.avg_price)),
  );

  return (
    <div className="rt-panel flex flex-col h-full min-h-0 bg-transparent select-none">
      {!hideHeader ? (
        <div className="rt-head">
          <h3 className="rt-head__title">Recent Trades</h3>
        </div>
      ) : null}

      <div className="rt-cols">
        <span>Price ({quoteLabel})</span>
        <span className="text-right">Size ({base})</span>
        <span className="text-right">Time/Taker</span>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-8">
          <div className="w-5 h-5 border-2 border-[color:var(--ibo-accent)] border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <div className="rt-scroll flex-1 overflow-y-auto">
          {trades.map((t, i) => {
            const isBuy = !t.isBuyerMaker;
            const priceStr = fmtP(t.price);
            const qty = parseFloat(t.qty);
            const id = t.id ?? t.tradeId ?? i;
            const isNewest = id === newestId;
            const isMyFill = myFilledPrices.has(priceStr);

            return (
              <div
                key={id}
                className={`rt-row${isNewest ? (isBuy ? ' is-flash-buy' : ' is-flash-sell') : ''}${isMyFill ? ' is-mine' : ''}`}
              >
                <span className={`rt-row__px ${isBuy ? 'is-buy' : 'is-sell'}`}>
                  {priceStr}
                  <span className="rt-row__arrow" aria-hidden>
                    {isBuy ? '↗' : '↘'}
                  </span>
                </span>
                <span className="rt-row__sz">{fmtQ(qty)}</span>
                <span className="rt-row__time">
                  {ts(t.time)}
                  <span className={isBuy ? 'is-buy' : 'is-sell'}>
                    {' '}/{isBuy ? 'B' : 'S'}
                  </span>
                </span>
              </div>
            );
          })}
          {!trades.length ? (
            <p className="text-center text-[10px] text-[color:var(--ibo-muted)] py-6">No trades yet</p>
          ) : null}
        </div>
      )}
    </div>
  );
}
