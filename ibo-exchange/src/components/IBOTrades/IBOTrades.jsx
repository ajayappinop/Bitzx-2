import { useEffect, useMemo, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';

function fmtPrice(v) {
  const n = Number(v || 0);
  if (!Number.isFinite(n)) return '—';
  return n >= 1000 ? n.toLocaleString(undefined, { maximumFractionDigits: 2 }) : n.toFixed(6);
}

function fmtQty(v) {
  const n = Number(v || 0);
  if (!Number.isFinite(n)) return '—';
  return n.toLocaleString(undefined, { maximumFractionDigits: 4 });
}

function fmtTime(ms) {
  if (!ms) return '—';
  return new Date(ms).toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export default function IBOTrades({ trades, loading, hideHeader = false }) {
  const boxRef = useRef(null);
  const rows = useMemo(() => (Array.isArray(trades) ? trades.slice(0, 50) : []), [trades]);
  const topTs = rows[0]?.timestamp;

  const [flashing, setFlashing] = useState(false);

  useEffect(() => {
    if (!boxRef.current) return;
    boxRef.current.scrollTop = 0;
    
    // Trigger flash animation on new trade
    setFlashing(true);
    const tm = setTimeout(() => setFlashing(false), 300);
    return () => clearTimeout(tm);
  }, [rows.length, topTs]);

  return (
    <div className="flex flex-col h-full bg-[color:var(--ibo-surface)] select-none min-h-0">
      {!hideHeader ? (
        <div className="px-3 py-2 border-b border-[color:var(--ibo-border)] text-[12px] font-semibold text-[color:var(--ibo-ink)] shrink-0">
          Recent Trades
        </div>
      ) : null}
      <div className="flex px-3 py-1.5 text-[10px] uppercase text-[color:var(--ibo-muted)] tracking-wider font-semibold border-b border-[color:var(--ibo-border)] shrink-0">
        <span className="w-1/4">Time</span>
        <span className="w-1/4 text-right">Price</span>
        <span className="w-1/4 text-right">Amount</span>
        <span className="w-1/4 text-right">Side</span>
      </div>
      <div ref={boxRef} className="flex-1 overflow-y-auto order-book-scroll min-h-0 scrollbar-hide">
        {loading && rows.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-2 py-8">
            <Loader2 className="w-5 h-5 text-[#C5E35B] animate-spin" />
            <span className="text-[11px] text-[color:var(--ibo-muted)]">Loading trades...</span>
          </div>
        ) : rows.length === 0 ? (
          <div className="flex items-center justify-center h-full px-3 py-6 text-center text-[11px] text-[color:var(--ibo-muted)]">
            No trades
          </div>
        ) : (
          rows.map((t, i) => {
            const buy = String(t.side || '').toLowerCase() === 'buy';
            const isNew = i === 0 && flashing;
            return (
              <div 
                key={`${t.timestamp}-${i}`} 
                className={`flex px-3 py-1 text-[12px] font-mono border-b border-[color:var(--ibo-border)]/40 hover:bg-[color:var(--ibo-hover)] transition-colors ${isNew ? (buy ? 'bg-green-500/20' : 'bg-red-500/20') : ''}`}
              >
                <span className="w-1/4 text-[color:var(--ibo-muted)]">{fmtTime(t.timestamp)}</span>
                <span className={`w-1/4 text-right font-semibold ${buy ? 'text-green-400' : 'text-red-400'}`}>{fmtPrice(t.price)}</span>
                <span className="w-1/4 text-right text-[color:var(--ibo-ink)] font-medium">{fmtQty(t.qty)}</span>
                <span className={`w-1/4 text-right font-semibold ${buy ? 'text-green-400' : 'text-red-400'}`}>{buy ? 'BUY' : 'SELL'}</span>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
