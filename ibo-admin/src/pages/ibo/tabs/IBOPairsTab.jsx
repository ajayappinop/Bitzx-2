import { useEffect, useState, useCallback } from 'react';
import { ToggleLeft, ToggleRight, Save, AlertCircle } from 'lucide-react';
import { api } from '@/lib/api';

const COIN_ICONS = {
  BTC: 'https://assets.coingecko.com/coins/images/1/small/bitcoin.png',
  ETH: 'https://assets.coingecko.com/coins/images/279/small/ethereum.png',
  BNB: 'https://assets.coingecko.com/coins/images/825/small/bnb-icon2_2x.png',
  SOL: 'https://assets.coingecko.com/coins/images/4128/small/solana.png',
  XRP: 'https://assets.coingecko.com/coins/images/44/small/xrp-symbol-white-128.png',
  DOGE: 'https://assets.coingecko.com/coins/images/5/small/dogecoin.png',
};

export default function IBOPairsTab() {
  const [pairs, setPairs]     = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving]   = useState(null);
  const [err, setErr]         = useState(null);
  const [msgs, setMsgs]       = useState({});

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const res = await api.ibo.getPairs();
      const d = await res.json();
      if (!res.ok) throw new Error(d.detail || 'Failed to load pairs');
      setPairs(d.pairs || []);
    } catch (e) { setErr(e.message); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const updatePair = async (symbol, updates) => {
    setSaving(symbol); setMsgs((m) => ({ ...m, [symbol]: null }));
    try {
      const res = await api.ibo.updatePair(symbol, updates);
      const d = await res.json();
      if (!res.ok) throw new Error(d.detail || 'Update failed');
      setMsgs((m) => ({ ...m, [symbol]: { ok: true, text: 'Saved' } }));
      setPairs((prev) => prev.map((p) => p.symbol === symbol ? { ...p, ...updates } : p));
    } catch (e) {
      setMsgs((m) => ({ ...m, [symbol]: { ok: false, text: e.message } }));
    } finally { setSaving(null); }
  };

  if (loading) return <div className="text-white/40 text-sm py-8 text-center">Loading pairs…</div>;
  if (err)     return <div className="text-red-400 text-sm py-8 text-center">{err}</div>;

  return (
    <div className="space-y-4">
      <p className="text-xs text-white/40">Enable or disable each IBO-quoted trading pair and set minimum order sizes.</p>
      <div className="rounded-xl border border-white/8 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-white/8 bg-white/3">
              <th className="text-left px-4 py-2.5 text-xs font-semibold text-white/50 uppercase tracking-wider">Pair</th>
              <th className="text-left px-4 py-2.5 text-xs font-semibold text-white/50 uppercase tracking-wider">Symbol</th>
              <th className="text-left px-4 py-2.5 text-xs font-semibold text-white/50 uppercase tracking-wider">Min Order</th>
              <th className="text-center px-4 py-2.5 text-xs font-semibold text-white/50 uppercase tracking-wider">Status</th>
              <th className="px-4 py-2.5" />
            </tr>
          </thead>
          <tbody>
            {pairs.map((pair) => {
              const base = pair.base || pair.symbol?.replace('IBO', '');
              const icon = COIN_ICONS[base];
              const isSaving = saving === pair.symbol;
              const msg = msgs[pair.symbol];
              return (
                <tr key={pair.symbol} className="border-b border-white/5 last:border-0 hover:bg-white/2 transition-colors">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      {icon && <img src={icon} alt={base} className="w-5 h-5 rounded-full" />}
                      <span className="font-bold text-white">{base}<span className="text-white/40">/IBO</span></span>
                    </div>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-white/50">{pair.symbol}</td>
                  <td className="px-4 py-3">
                    <input
                      type="number" min="0" step="0.0001"
                      defaultValue={pair.min_order_size || ''}
                      placeholder="0 (any)"
                      onBlur={(e) => {
                        const v = parseFloat(e.target.value);
                        if (!isNaN(v)) updatePair(pair.symbol, { min_order_size: v });
                      }}
                      className="w-24 bg-white/5 border border-white/10 rounded px-2 py-1 text-xs text-white focus:outline-none focus:border-gold/50"
                    />
                  </td>
                  <td className="px-4 py-3 text-center">
                    <button
                      onClick={() => updatePair(pair.symbol, { enabled: !pair.enabled })}
                      disabled={isSaving}
                      className="inline-flex items-center gap-1.5 text-xs font-semibold"
                    >
                      {pair.enabled
                        ? <><ToggleRight size={18} className="text-green-400" /><span className="text-green-400">Active</span></>
                        : <><ToggleLeft size={18} className="text-red-400" /><span className="text-red-400">Paused</span></>}
                    </button>
                  </td>
                  <td className="px-4 py-3 text-right text-xs">
                    {isSaving && <span className="text-white/30">Saving…</span>}
                    {msg?.ok    && <span className="text-green-400">{msg.text}</span>}
                    {msg && !msg.ok && <span className="text-red-400 flex items-center gap-1"><AlertCircle size={10}/>{msg.text}</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
