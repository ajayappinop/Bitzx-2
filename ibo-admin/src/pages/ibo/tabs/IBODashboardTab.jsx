import { useEffect, useState, useCallback } from 'react';
import { TrendingUp, TrendingDown, Zap, Users, Activity, DollarSign, RefreshCw } from 'lucide-react';
import { api } from '@/lib/api';

const COIN_ICONS = {
  BTC: 'https://assets.coingecko.com/coins/images/1/small/bitcoin.png',
  ETH: 'https://assets.coingecko.com/coins/images/279/small/ethereum.png',
  BNB: 'https://assets.coingecko.com/coins/images/825/small/bnb-icon2_2x.png',
  SOL: 'https://assets.coingecko.com/coins/images/4128/small/solana.png',
  XRP: 'https://assets.coingecko.com/coins/images/44/small/xrp-symbol-white-128.png',
  DOGE: 'https://assets.coingecko.com/coins/images/5/small/dogecoin.png',
};

function KpiCard({ icon: Icon, label, value, sub, color = 'amber' }) {
  const colors = {
    amber: 'text-gold-light bg-gold/10 border-gold/20',
    green: 'text-green-400 bg-green-400/10 border-green-400/20',
    blue:  'text-blue-400 bg-blue-400/10 border-blue-400/20',
    purple:'text-purple-400 bg-purple-400/10 border-purple-400/20',
  };
  return (
    <div className={`rounded-xl border p-4 ${colors[color]}`}>
      <div className="flex items-center gap-2 mb-2">
        <Icon size={16} />
        <span className="text-xs font-semibold uppercase tracking-wider opacity-70">{label}</span>
      </div>
      <div className="text-2xl font-bold">{value}</div>
      {sub && <div className="text-xs opacity-60 mt-1">{sub}</div>}
    </div>
  );
}

function PairRow({ pair }) {
  const base = pair.symbol?.replace('IBO', '') || '';
  const icon = COIN_ICONS[base];
  const enabled = pair.enabled !== false;
  const change = parseFloat(pair.priceChangePercent ?? 0);
  return (
    <div className="flex items-center gap-3 py-2.5 border-b border-white/5 last:border-0">
      <div className="flex items-center gap-2 w-28">
        {icon && <img src={icon} alt={base} className="w-5 h-5 rounded-full" />}
        <span className="text-sm font-bold text-white">{base}<span className="text-white/40">/IBO</span></span>
      </div>
      <div className="flex-1 text-xs text-white/50 font-mono">{pair.symbol}</div>
      <div className={`text-xs font-semibold ${change >= 0 ? 'text-green-400' : 'text-red-400'}`}>
        {change >= 0 ? '+' : ''}{change.toFixed(2)}%
      </div>
      <div className="text-xs text-white/50 w-24 text-right">{Number(pair.volume_ibo || 0).toLocaleString()} IBO</div>
      <div className="text-xs ml-2">
        {enabled
          ? <span className="px-2 py-0.5 rounded-full bg-green-500/15 text-green-400 font-semibold">Active</span>
          : <span className="px-2 py-0.5 rounded-full bg-red-500/15 text-red-400 font-semibold">Paused</span>}
      </div>
    </div>
  );
}

export default function IBODashboardTab() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const res = await api.ibo.dashboard();
      const d = await res.json();
      if (!res.ok) throw new Error(d.detail || 'Failed');
      setData(d);
    } catch (e) { setErr(e.message); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading) return <div className="text-white/40 text-sm py-8 text-center">Loading IBO dashboard…</div>;
  if (err)     return <div className="text-red-400 text-sm py-8 text-center">{err}</div>;
  if (!data)   return null;

  const fmtIbo = (n) => Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 2 });
  const fmtUsd = (n) => `$${Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-bold text-white/60 uppercase tracking-widest">IBO Ecosystem Overview</h2>
        <button onClick={load} className="flex items-center gap-1 text-xs text-white/40 hover:text-gold-light transition-colors">
          <RefreshCw size={12} /> Refresh
        </button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard icon={DollarSign} label="IBO Price" value={`$${data.ibo_price_usdt}`} sub="USDT equivalent" color="amber" />
        <KpiCard icon={Activity}   label="24h Volume" value={`${fmtIbo(data.volume_24h_ibo)} IBO`} sub={`${data.trades_24h} trades`} color="blue" />
        <KpiCard icon={Users}      label="IBO Holders" value={fmtIbo(data.total_user_ibo)} sub="Total user IBO" color="purple" />
        <KpiCard icon={Zap}        label="Active Pairs" value={`${data.active_pairs} / ${data.total_pairs}`} sub={data.ibo_liquidity ? 'Liquidity ON' : 'Liquidity OFF'} color="green" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="rounded-xl border border-white/8 bg-white/2 p-4">
          <h3 className="text-xs font-bold text-white/50 uppercase tracking-wider mb-3">IBO-Quoted Pairs</h3>
          {(data.pairs || []).map((p) => <PairRow key={p.symbol} pair={p} />)}
        </div>

        <div className="rounded-xl border border-white/8 bg-white/2 p-4 space-y-4">
          <h3 className="text-xs font-bold text-white/50 uppercase tracking-wider mb-3">Supply Snapshot</h3>
          <div className="space-y-3">
            {[
              { label: 'Total User IBO', value: `${fmtIbo(data.total_user_ibo)} IBO` },
              { label: 'Treasury IBO',   value: `${fmtIbo(data.treasury_ibo)} IBO` },
              { label: 'Spread BPS',     value: `${data.spread_bps} bps` },
              { label: 'Liquidity',      value: data.ibo_liquidity ? 'Enabled' : 'Disabled', green: data.ibo_liquidity },
            ].map((row) => (
              <div key={row.label} className="flex justify-between items-center text-sm border-b border-white/5 pb-2 last:border-0 last:pb-0">
                <span className="text-white/50">{row.label}</span>
                <span className={row.green !== undefined ? (row.green ? 'text-green-400 font-semibold' : 'text-red-400 font-semibold') : 'text-white font-semibold'}>{row.value}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
