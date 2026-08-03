import { useEffect, useState, useRef } from 'react';
import { tradingApi } from '@/services/api';

const formatTime = ms => {
  const d = new Date(ms);
  return d.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
};

export default function RecentTrades({ symbol }) {
  const [trades,  setTrades]  = useState([]);
  const [loading, setLoading] = useState(true);
  const timerRef = useRef(null);

  const load = () => {
    tradingApi.getRecentTrades(symbol, 50)
      .then(data => { setTrades(data); setLoading(false); })
      .catch(console.error);
  };

  useEffect(() => {
    setLoading(true);
    load();
    timerRef.current = setInterval(load, 2000);
    return () => clearInterval(timerRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol]);

  return (
    <div className="flex flex-col h-full bg-surface-elevated">
      <div className="px-3 py-2 border-b border-line flex-shrink-0">
        <span className="text-xs font-semibold text-ink">Trades</span>
      </div>

      <div className="flex justify-between px-3 py-1 text-[10px] text-[#4A4B50] flex-shrink-0">
        <span>Price (USDT)</span>
        <span>Amount</span>
        <span>Time</span>
      </div>

      {loading ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="w-6 h-6 border-2 border-[#0EA4AB] border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto scrollbar-hide">
          {trades.map((t, i) => {
            const isBuy = !t.isBuyerMaker;
            return (
              <div
                key={t.id ?? i}
                className="flex items-center justify-between px-3 py-[3px] text-xs hover:bg-white/5"
              >
                <span className={`font-mono ${isBuy ? 'text-green-400' : 'text-red-400'}`}>
                  {parseFloat(t.price).toFixed(4)}
                </span>
                <span className="text-ink-soft">
                  {parseFloat(t.qty) >= 1000
                    ? (parseFloat(t.qty) / 1000).toFixed(2) + 'K'
                    : parseFloat(t.qty).toFixed(2)}
                </span>
                <span className="text-[#4A4B50]">{formatTime(t.time)}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
