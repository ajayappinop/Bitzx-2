import { useEffect, useState, useRef } from 'react';
import { ArrowUp, ArrowDown } from 'lucide-react';
import { tradingApi } from '@/services/api';

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

const formatTime = (ms) => {
  const d = new Date(ms);
  return d.toLocaleTimeString('en-US', {
    hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
};

export default function RecentTrades({ symbol, baseAsset }) {
  const [trades, setTrades] = useState([]);
  const [loading, setLoading] = useState(true);
  const timerRef = useRef(null);
  const base = baseAsset || (symbol || '').replace(/USDT|USD$/i, '') || 'BTC';

  const load = () => {
    tradingApi.getRecentTrades(symbol, 50)
      .then((data) => { setTrades(Array.isArray(data) ? data : []); setLoading(false); })
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
    <div className="flex flex-col h-full min-h-0 bg-transparent select-none">
      <div className="flex h-8 items-center px-2.5 border-b border-line text-[12px] font-semibold text-ink shrink-0">
        Recent Trades
      </div>

      <div className="flex px-2.5 h-[24px] items-center text-[10px] text-[#4A4B50] shrink-0 border-b border-line">
        <span className="w-[38%]">Price (USD)</span>
        <span className="w-[28%] text-right">Size ({base})</span>
        <span className="w-[34%] text-right">Time/Taker</span>
      </div>

      {loading ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="w-5 h-5 border-2 border-[#FE6C02]/60 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto scrollbar-hide">
          {trades.map((t, i) => {
            const isBuy = !t.isBuyerMaker;
            return (
              <div
                key={t.id ?? i}
                className="flex px-2.5 h-[22px] items-center text-[11px] font-mono tabular-nums hover:bg-white/[0.03]"
              >
                <span className={`w-[38%] flex items-center gap-0.5 font-semibold ${
                  isBuy ? 'text-[#0ECB81]' : 'text-[#F6465D]'
                }`}>
                  {fmtP(t.price)}
                  {isBuy
                    ? <ArrowUp size={10} className="shrink-0 opacity-90" strokeWidth={2.5} />
                    : <ArrowDown size={10} className="shrink-0 opacity-90" strokeWidth={2.5} />}
                </span>
                <span className="w-[28%] text-right text-ink">{fmtQ(t.qty)}</span>
                <span className="w-[34%] text-right text-[#4A4B50]">
                  {formatTime(t.time)}
                  <span className={isBuy ? 'text-[#0ECB81]' : 'text-[#F6465D]'}>
                    {isBuy ? '/B' : '/S'}
                  </span>
                </span>
              </div>
            );
          })}
          {!trades.length ? (
            <p className="text-center text-[10px] text-[#4A4B50] py-6">No trades yet</p>
          ) : null}
        </div>
      )}
    </div>
  );
}
