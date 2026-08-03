import { useEffect, useState, useRef } from 'react';
import { exchangeWsPath } from '@/services/marketApi';
import { useAuth } from '@/context/AuthContext';

const fmtP = n => {
  const v = parseFloat(n);
  return v >= 10000 ? v.toLocaleString(undefined, { maximumFractionDigits: 2 })
       : v >= 1     ? v.toFixed(4)
                    : v.toFixed(6);
};
const fmtQ = n => {
  const v = parseFloat(n);
  return v >= 1e6 ? (v / 1e6).toFixed(2) + 'M'
       : v >= 1e3 ? (v / 1e3).toFixed(2) + 'K'
                 : v.toFixed(3);
};
const ts = ms => new Date(ms).toLocaleTimeString('en-US', {
  hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit',
});

export default function RecentTrades({ symbol, hideHeader = false }) {
  const { orderHistory } = useAuth();

  const [trades,  setTrades]  = useState([]);
  const [loading, setLoading] = useState(true);
  const [newestId, setNewestId] = useState(null);

  const prevTopId = useRef(null);

  useEffect(() => {
    setLoading(true);
    setTrades([]);
    prevTopId.current = null;
    const qs = new URLSearchParams({ symbol, limit: '40' });
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
        try {
          ws.close();
        } catch {
          /* ignore */
        }
      }
    };
  }, [symbol]);

  const myFilledPrices = new Set(
    (orderHistory || [])
      .filter(o => o.status === 'filled' && o.avg_price)
      .map(o => fmtP(o.avg_price))
  );

  return (
    <div className="flex flex-col h-full min-h-0 bg-[color:var(--ibo-surface)]">
      {!hideHeader ? (
        <div className="px-3 py-2 border-b border-[color:var(--ibo-border)] text-[12px] font-semibold text-[color:var(--ibo-ink)] shrink-0">
          Recent Trades
        </div>
      ) : null}
      <div className="grid grid-cols-3 gap-1 px-3 py-1.5 text-[10px] text-[color:var(--ibo-muted)] shrink-0 border-b border-white/[0.04]">
        <span>Price</span>
        <span className="text-right">Size</span>
        <span className="text-right">Time</span>
      </div>
      {loading ? (
        <div className="flex items-center justify-center py-10">
          <div className="w-5 h-5 border-2 border-[#C5E35B] border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto scrollbar-hide">
          {trades.map((t, i) => {
            const isBuy      = !t.isBuyerMaker;
            const priceStr   = fmtP(t.price);
            const qty        = parseFloat(t.qty);
            const id         = t.id ?? t.tradeId ?? i;
            const isNewest   = id === newestId;
            const isMyFill   = myFilledPrices.has(priceStr);

            return (
              <div
                key={id}
                className={`grid grid-cols-3 gap-1 px-3 py-[3px] text-[11px] font-mono transition-colors ${
                  isNewest
                    ? isBuy ? 'bg-emerald-500/15' : 'bg-rose-500/15'
                    : isMyFill
                    ? 'bg-[#C5E35B]/10'
                    : 'hover:bg-white/[0.03]'
                }`}
              >
                <span className={isBuy ? 'text-emerald-400' : 'text-rose-400'}>
                  {priceStr}
                </span>
                <span className="text-right text-[color:var(--ibo-ink)]/85">{fmtQ(qty)}</span>
                <span className="text-right text-[color:var(--ibo-muted)] tabular-nums flex items-center justify-end gap-1">
                  {ts(t.time)}
                  {isMyFill ? (
                    <span className="px-1 text-[8px] rounded bg-[#C5E35B]/20 text-[#C5E35B] font-bold uppercase">You</span>
                  ) : null}
                </span>
              </div>
            );
          })}
          {!trades.length ? (
            <p className="text-center text-[11px] text-[color:var(--ibo-muted)] py-6">No trades yet</p>
          ) : null}
        </div>
      )}
    </div>
  );
}
