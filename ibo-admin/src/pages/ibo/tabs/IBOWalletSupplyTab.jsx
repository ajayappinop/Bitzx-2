import { useEffect, useState, useCallback } from 'react';
import { Wallet, RefreshCw } from 'lucide-react';
import { api } from '@/lib/api';

export default function IBOWalletSupplyTab() {
  const [data, setData]     = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr]       = useState(null);

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const res = await api.ibo.getWalletSupply();
      const d = await res.json();
      if (!res.ok) throw new Error(d.detail || 'Failed to load');
      setData(d);
    } catch (e) { setErr(e.message); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const fmt = (n, dp = 4) => Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: dp });
  const fmtUsd = (n) => `$${fmt(n, 2)}`;

  if (loading) return <div className="text-white/40 text-sm py-8 text-center">Loading wallet supply…</div>;
  if (err)     return <div className="text-red-400 text-sm py-8 text-center">{err}</div>;
  if (!data)   return null;

  const userPct = data.total_user_ibo + data.treasury_ibo > 0
    ? (data.total_user_ibo / (data.total_user_ibo + data.treasury_ibo) * 100).toFixed(1)
    : '0';
  const treasuryPct = data.total_user_ibo + data.treasury_ibo > 0
    ? (data.treasury_ibo / (data.total_user_ibo + data.treasury_ibo) * 100).toFixed(1)
    : '0';

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-bold text-white/60 uppercase tracking-widest flex items-center gap-2">
          <Wallet size={14} className="text-gold-light" /> IBO Platform Supply
        </h2>
        <button onClick={load} className="flex items-center gap-1 text-xs text-white/40 hover:text-gold-light transition-colors">
          <RefreshCw size={12} /> Refresh
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {[
          { label: 'Total User IBO', value: fmt(data.total_user_ibo) + ' IBO', sub: fmtUsd(data.total_user_usdt_equiv), color: 'amber' },
          { label: 'Treasury IBO',   value: fmt(data.treasury_ibo) + ' IBO',   sub: fmtUsd(data.treasury_ibo * data.ibo_price_usdt), color: 'blue' },
          { label: 'Unique Holders', value: fmt(data.holder_count, 0),          sub: 'accounts with IBO balance', color: 'purple' },
        ].map((c) => (
          <div key={c.label} className={`rounded-xl border p-4 ${c.color === 'amber' ? 'border-gold/20 bg-gold/5 text-gold-light' : c.color === 'blue' ? 'border-blue-400/20 bg-blue-400/5 text-blue-400' : 'border-purple-400/20 bg-purple-400/5 text-purple-400'}`}>
            <div className="text-xs font-semibold uppercase tracking-wider opacity-60 mb-1">{c.label}</div>
            <div className="text-2xl font-bold">{c.value}</div>
            <div className="text-xs opacity-50 mt-0.5">{c.sub}</div>
          </div>
        ))}
      </div>

      <div className="rounded-xl border border-white/8 bg-white/2 p-5">
        <h3 className="text-xs font-bold text-white/50 uppercase tracking-wider mb-4">Distribution</h3>
        <div className="space-y-3">
          <div>
            <div className="flex justify-between text-xs mb-1">
              <span className="text-white/60">User Holdings</span>
              <span className="text-gold-light font-semibold">{userPct}%</span>
            </div>
            <div className="h-2 bg-white/8 rounded-full overflow-hidden">
              <div className="h-full bg-gold rounded-full" style={{ width: `${userPct}%` }} />
            </div>
          </div>
          <div>
            <div className="flex justify-between text-xs mb-1">
              <span className="text-white/60">Treasury / SYSTEM</span>
              <span className="text-blue-400 font-semibold">{treasuryPct}%</span>
            </div>
            <div className="h-2 bg-white/8 rounded-full overflow-hidden">
              <div className="h-full bg-blue-400 rounded-full" style={{ width: `${treasuryPct}%` }} />
            </div>
          </div>
        </div>
        <div className="mt-4 pt-4 border-t border-white/5 flex justify-between text-xs text-white/40">
          <span>IBO price reference</span>
          <span className="text-gold-light font-semibold">${data.ibo_price_usdt} USDT</span>
        </div>
      </div>
    </div>
  );
}
