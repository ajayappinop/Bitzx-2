import { useEffect, useState, useRef } from 'react';
import { ArrowUp, ArrowDown } from 'lucide-react';
import { exchangeWsPath, displayBaseForApiSymbol, parsePairFromApiSymbol } from '@/services/marketApi';
import { useAuth } from '@/context/AuthContext';

const fmtP = (n) => {
  const v = parseFloat(n);
  if (!Number.isFinite(v)) return '—';
  return v >= 10000
    ? v.toLocaleString(undefined, { maximumFractionDigits: 1 })
    : v >= 1
      ? v.toFixed(v >= 100 ? 1 : 4)
      : v.toFixed(6);
};
const fmtQ = (n) => {
  const v = parseFloat(n);
  if (!Number.isFinite(v)) return '—';
  return v >= 1e6 ? `${(v / 1e6).toFixed(2)}M`
    : v >= 1e3 ? `${(v / 1e3).toFixed(2)}K`
    : v.toFixed(4);
};
const ts = (ms) => new Date(ms).toLocaleTimeString('en-US', {
  hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit',
});

/**
 * Delta-style recent trades: Price (arrow) · Size · Time /B|/S
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
    <div className="flex flex-col h-full min-h-0 bg-transparent select-none">
      {!hideHeader ? (
        <div className="flex h-8 items-center px-2.5 border-b border-[color:var(--ibo-border)] text-[12px] font-semibold text-[color:var(--ibo-ink)] shrink-0">
          Recent Trades
        </div>
      ) : null}

      <div className="flex px-2.5 h-[24px] items-center text-[10px] text-[color:var(--ibo-muted)] shrink-0 border-b border-[color:var(--ibo-border)]">
        <span className="w-[38%]">Price ({quoteLabel})</span>
        <span className="w-[28%] text-right">Size ({base})</span>
        <span className="w-[34%] text-right">Time/Taker</span>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-8">
          <div className="w-5 h-5 border-2 border-[color:var(--ibo-accent)] border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto scrollbar-hide">
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
                className={`flex px-2.5 h-[22px] items-center text-[11px] font-mono tabular-nums ${
                  isNewest
                    ? isBuy ? 'bg-[#0ECB81]/12' : 'bg-[#F6465D]/12'
                    : isMyFill
                      ? 'bg-[color:var(--ibo-accent-soft)]'
                      : 'hover:bg-white/[0.03]'
                }`}
              >
                <span className={`w-[38%] flex items-center gap-0.5 font-semibold ${
                  isBuy ? 'text-[#0ECB81]' : 'text-[#F6465D]'
                }`}>
                  {priceStr}
                  {isBuy
                    ? <ArrowUp size={10} className="shrink-0 opacity-90" strokeWidth={2.5} />
                    : <ArrowDown size={10} className="shrink-0 opacity-90" strokeWidth={2.5} />}
                </span>
                <span className="w-[28%] text-right text-[color:var(--ibo-ink)]">{fmtQ(qty)}</span>
                <span className="w-[34%] text-right text-[color:var(--ibo-muted)]">
                  {ts(t.time)}
                  <span className={isBuy ? 'text-[#0ECB81]' : 'text-[#F6465D]'}>
                    {isBuy ? '/B' : '/S'}
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
