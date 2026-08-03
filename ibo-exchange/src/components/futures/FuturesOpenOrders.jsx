import { useState } from 'react';
import { useFutures } from '@/context/FuturesContext';
import { useToast, friendlyError } from '@/context/ToastContext';

export default function FuturesOpenOrders() {
  const { openOrders, cancelOrder } = useFutures();
  const [busyId, setBusyId] = useState(null);
  const toast = useToast();

  const cancel = async (id) => {
    setBusyId(id);
    try {
      await cancelOrder(id);
      toast.success('Order cancelled', 'Your order has been removed from the book.');
    } catch (e) {
      toast.error('Could not cancel order', friendlyError(e?.detail || e?.message));
    } finally {
      setBusyId(null);
    }
  };

  if (!openOrders.length) {
    return <div className="px-4 py-8 text-center text-sm text-white/40">No open orders.</div>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-white/40 uppercase tracking-wider text-[10px]">
            <th className="text-left px-3 py-2">Symbol</th>
            <th className="text-left px-3 py-2">Type</th>
            <th className="text-left px-3 py-2">Side</th>
            <th className="text-right px-3 py-2">Price</th>
            <th className="text-right px-3 py-2">Size</th>
            <th className="text-right px-3 py-2">Filled</th>
            <th className="text-right px-3 py-2">Lev</th>
            <th className="text-right px-3 py-2 pr-4">Actions</th>
          </tr>
        </thead>
        <tbody>
          {openOrders.map((o) => (
            <tr key={o.id} className="border-t border-white/5 hover:bg-white/[0.02]">
              <td className="px-3 py-2">{o.symbol}</td>
              <td className="px-3 py-2 capitalize text-white/70">{o.type}</td>
              <td className={`px-3 py-2 font-semibold ${o.side === 'buy' ? 'text-emerald-300' : 'text-rose-300'}`}>
                {o.side.toUpperCase()}
              </td>
              <td className="px-3 py-2 text-right font-mono">{o.price ? Number(o.price).toFixed(2) : '—'}</td>
              <td className="px-3 py-2 text-right font-mono">{Number(o.quantity).toFixed(4)}</td>
              <td className="px-3 py-2 text-right font-mono">{Number(o.filled || 0).toFixed(4)}</td>
              <td className="px-3 py-2 text-right font-mono">{o.leverage}x</td>
              <td className="px-3 py-2 text-right pr-4">
                <button disabled={busyId === o.id} onClick={() => cancel(o.id)}
                  className="px-2 py-1 rounded bg-white/5 hover:bg-white/10 text-white/80 disabled:opacity-40">
                  {busyId === o.id ? 'Cancelling…' : 'Cancel'}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
