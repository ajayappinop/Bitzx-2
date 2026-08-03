import { useState } from 'react';
import { X, Clock, CheckCircle, RefreshCw, AlertCircle } from 'lucide-react';
import { useAuth, authFetch } from '@/context/AuthContext';
import { exchangeApiOrigin } from '@/lib/apiBase';
import { displayPairSlash } from '@/services/marketApi';

const API = exchangeApiOrigin(import.meta.env.VITE_BACKEND_URL);

const fmt  = iso => new Date(iso).toLocaleString('en-US', {
  month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
});
const fmtP = v => {
  const n = parseFloat(v);
  return n >= 1000 ? n.toLocaleString(undefined, { maximumFractionDigits: 2 })
       : n >= 1    ? n.toFixed(4)
                   : n.toFixed(6);
};

export default function OpenOrders() {
  const { openOrders, orderHistory, ordersLoading, fetchOrders, fetchWallet, fetchLiveSpotPositions } = useAuth();
  const [tab,        setTab]        = useState('open');
  const [cancelling, setCancelling] = useState(null);

  const rows = tab === 'open' ? openOrders : orderHistory;

  const handleCancel = async orderId => {
    setCancelling(orderId);
    try {
      const res = await authFetch(`${API}/api/orders/${orderId}`, { method: 'DELETE' });
      if (res.ok) await Promise.all([fetchOrders(), fetchWallet(), fetchLiveSpotPositions()]);
    } catch { /* ignore */ }
    finally { setCancelling(null); }
  };

  const statusColor = s =>
    s === 'filled'           ? 'text-green-400'  :
    s === 'partially_filled' ? 'text-blue-400'   :
    s === 'cancelled'        ? 'text-red-400'     : 'text-[#8A8B90]';

  const statusIcon = s =>
    s === 'filled'    ? <CheckCircle size={11} /> :
    s === 'cancelled' ? <AlertCircle size={11} />
                      : <Clock size={11} />;

  return (
    <div className="flex flex-col h-full bg-surface-DEFAULT">

      {/* Tabs + refresh */}
      <div className="flex items-center border-b border-surface-border flex-shrink-0 px-1">
        {[['open', 'Open Orders'], ['history', 'Order History']].map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)}
              className={`px-4 py-3 text-sm font-semibold border-b-2 transition-colors ${
              tab === k
                ? 'border-gold text-gold-light'
                : 'border-transparent text-[#4A4B50] hover:text-[#8A8B90]'
            }`}>
            {label}
            {k === 'open' && openOrders.length > 0 && (
              <span className="ml-2 bg-gold/20 text-gold-light text-[10px] px-1.5 py-0.5 rounded-full font-bold">
                {openOrders.length}
              </span>
            )}
          </button>
        ))}

        <button onClick={fetchOrders} disabled={ordersLoading}
          className="ml-auto px-3 py-2 text-[#4A4B50] hover:text-white disabled:opacity-40 transition-colors">
          <RefreshCw size={14} className={ordersLoading ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* Column headers */}
      <div className="grid grid-cols-9 gap-2 px-4 py-2.5 text-[11px] text-[#4A4B50] uppercase tracking-wider border-b border-surface-border flex-shrink-0">
        <span>Date</span>
        <span>Pair</span>
        <span>Type</span>
        <span>Side</span>
        <span className="text-right">Price</span>
        <span className="text-right">Amount</span>
        <span className="text-right">Filled</span>
        <span className="text-right">Remain</span>
        <span className="text-right">{tab === 'open' ? 'Action' : 'Status'}</span>
      </div>

      {/* Rows */}
      <div className="flex-1 overflow-y-auto scrollbar-hide">
        {ordersLoading && rows.length === 0 ? (
          <div className="flex items-center justify-center h-full gap-2 text-[#4A4B50] text-sm">
            <RefreshCw size={16} className="animate-spin" /> Loading…
          </div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-2 text-[#4A4B50]">
            <Clock size={26} />
            <span className="text-sm">No {tab === 'open' ? 'open orders' : 'order history'}</span>
          </div>
        ) : (
          rows.map(o => (
            <div key={o.id}
              className="grid grid-cols-9 gap-2 px-4 py-3 text-[13px] border-b border-surface-border/40 hover:bg-white/[.04] items-center transition-colors">
              <span className="text-[#4A4B50] truncate text-xs">{fmt(o.created_at)}</span>
              <span className="text-white font-semibold">{displayPairSlash(o.symbol)}</span>
              <span className="text-[#8A8B90] capitalize">{o.type}</span>
              <span className={`font-bold capitalize ${o.side === 'buy' ? 'text-green-400' : 'text-red-400'}`}>
                {o.side.toUpperCase()}
              </span>
              <span className="text-right text-white font-mono">
                {o.type === 'market' ? <span className="text-[#4A4B50]">MKT</span> : `$${fmtP(o.price)}`}
              </span>
              <span className="text-right text-[#D5D5D0] font-mono">{o.amount.toFixed(4)}</span>
              <span className="text-right font-mono">
                <span className={o.filled > 0 ? 'text-white' : 'text-[#8A8B90]'}>{o.filled.toFixed(4)}</span>
                {o.amount > 0 && (
                  <span className="text-[#4A4B50] text-[10px] ml-0.5">
                    ({((o.filled / o.amount) * 100).toFixed(0)}%)
                  </span>
                )}
              </span>
              <span className="text-right text-gold-light/90 font-mono text-xs">
                {(o.remaining != null ? o.remaining : Math.max(0, o.amount - o.filled)).toFixed(4)}
              </span>

              {tab === 'open' ? (
                <button
                  onClick={() => handleCancel(o.id)}
                  disabled={cancelling === o.id}
                  className="flex justify-end items-center gap-1.5 text-red-400 hover:text-red-300 disabled:opacity-40 transition-colors text-xs font-semibold">
                  {cancelling === o.id
                    ? <RefreshCw size={12} className="animate-spin" />
                    : <><X size={12} /> Cancel</>}
                </button>
              ) : (
                <span className={`flex justify-end items-center gap-1.5 capitalize font-semibold text-xs ${statusColor(o.status)}`}>
                  {statusIcon(o.status)} {o.status.replace('_', ' ')}
                </span>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
