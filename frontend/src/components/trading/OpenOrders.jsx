import { useState } from 'react';
import { X, Clock } from 'lucide-react';

const TABS = ['Open Orders', 'Order History'];

const formatTime = iso =>
  new Date(iso).toLocaleString('en-US', { month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });

export default function OpenOrders({ orders = [], onCancel }) {
  const [tab, setTab] = useState('Open Orders');

  const open    = orders.filter(o => o.status === 'open');
  const history = orders.filter(o => o.status !== 'open');
  const rows    = tab === 'Open Orders' ? open : history;

  return (
    <div className="flex flex-col min-h-[320px] bg-surface">
      {/* Tab row */}
      <div className="flex border-b border-line flex-shrink-0 sticky top-0 bg-surface z-10">
        {TABS.map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-3 py-2 text-[12px] font-semibold transition-colors border-b-2 ${
              tab === t
                ? 'border-[#0EA4AB] text-ink-accent'
                : 'border-transparent text-[#4A4B50] hover:text-ink-muted'
            }`}
          >
            {t}
            {t === 'Open Orders' && open.length > 0 && (
              <span className="ml-1 bg-[#0EA4AB]/30 text-ink-accent text-[9px] px-1.5 py-0.5 rounded-full">
                {open.length}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Table header */}
      <div className="grid grid-cols-7 px-3 py-2 text-[10px] text-[#4A4B50] border-b border-line flex-shrink-0 uppercase tracking-wide">
        <span>Date</span>
        <span>Pair</span>
        <span>Type</span>
        <span>Side</span>
        <span className="text-right">Price</span>
        <span className="text-right">Amount</span>
        {tab === 'Open Orders' ? <span className="text-right">Action</span> : <span className="text-right">Status</span>}
      </div>

      {/* Rows — grow with page scroll (no tiny clipped pane) */}
      <div className="min-h-[220px]">
        {rows.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-2 text-[#4A4B50]">
            <Clock size={28} />
            <span className="text-xs">No {tab.toLowerCase()}</span>
          </div>
        ) : (
          rows.map(o => (
            <div
              key={o.id}
              className="grid grid-cols-7 px-3 py-2.5 text-[12px] border-b border-line/50 hover:bg-white/5 items-center"
            >
              <span className="text-ink-muted">{formatTime(o.time)}</span>
              <span className="text-ink font-semibold">{o.symbol}</span>
              <span className="text-ink-muted capitalize">{o.type}</span>
              <span className={o.side === 'buy' ? 'text-green-400' : 'text-red-400'}>
                {o.side.toUpperCase()}
              </span>
              <span className="text-right text-ink font-mono">{parseFloat(o.price).toFixed(4)}</span>
              <span className="text-right text-ink-soft font-mono">{parseFloat(o.amount).toFixed(2)}</span>
              {tab === 'Open Orders' ? (
                <button
                  onClick={() => onCancel?.(o.id)}
                  className="flex justify-end items-center gap-1 text-red-400 hover:text-red-300 transition-colors"
                >
                  <X size={12} />
                  <span>Cancel</span>
                </button>
              ) : (
                <span className={`text-right capitalize ${
                  o.status === 'filled'    ? 'text-green-400' :
                  o.status === 'cancelled' ? 'text-red-400'   :
                  'text-ink-muted'
                }`}>
                  {o.status}
                </span>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
