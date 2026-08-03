import { useFutures } from '@/context/FuturesContext';

export default function FuturesOrderHistory() {
  const { orderHistory } = useFutures();
  if (!orderHistory.length) {
    return <div className="px-4 py-8 text-center text-sm text-white/40">No order history.</div>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-white/40 uppercase tracking-wider text-[10px]">
            <th className="text-left px-3 py-2">Time</th>
            <th className="text-left px-3 py-2">Symbol</th>
            <th className="text-left px-3 py-2">Type</th>
            <th className="text-left px-3 py-2">Side</th>
            <th className="text-right px-3 py-2">Price</th>
            <th className="text-right px-3 py-2">Filled</th>
            <th className="text-left px-3 py-2 pr-4">Status</th>
          </tr>
        </thead>
        <tbody>
          {orderHistory.map((o) => (
            <tr key={o.id} className="border-t border-white/5">
              <td className="px-3 py-2 text-white/60">{(o.updated_at || o.created_at || '').slice(0, 19).replace('T', ' ')}</td>
              <td className="px-3 py-2">{o.symbol}</td>
              <td className="px-3 py-2 capitalize text-white/70">{o.type}</td>
              <td className={`px-3 py-2 font-semibold ${o.side === 'buy' ? 'text-emerald-300' : 'text-rose-300'}`}>
                {o.side.toUpperCase()}
              </td>
              <td className="px-3 py-2 text-right font-mono">{o.price ? Number(o.price).toFixed(2) : 'MKT'}</td>
              <td className="px-3 py-2 text-right font-mono">{Number(o.filled || 0).toFixed(4)} / {Number(o.quantity).toFixed(4)}</td>
              <td className="px-3 py-2 capitalize text-white/70 pr-4">{o.status?.replace('_', ' ')}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
