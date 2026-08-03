import { useEffect, useState } from 'react';
import { Link2, Zap, Clock } from 'lucide-react';
import { exchangeApiOrigin } from '@/lib/apiBase';

const API = exchangeApiOrigin(import.meta.env.VITE_BACKEND_URL);

const CHAIN_COLORS = {
  btc: 'text-orange-300 border-orange-400/30 bg-orange-500/10',
  eth: 'text-violet-300 border-violet-400/30 bg-violet-500/10',
  bsc: 'text-[#5BB8FF] border-[rgba(91,184,255,0.3)] bg-[rgba(91,184,255,0.1)]',
  tron: 'text-red-300 border-red-400/30 bg-red-500/10',
  solana: 'text-emerald-300 border-emerald-400/30 bg-emerald-500/10',
};

export default function WalletChainsBanner() {
  const [chains, setChains] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API}/api/wallet/chains`);
        if (!res.ok) throw new Error('chains');
        const data = await res.json();
        if (!cancelled) setChains(Array.isArray(data) ? data : []);
      } catch {
        if (!cancelled) setChains([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  if (loading || chains.length === 0) return null;

  return (
    <div className="mb-6 rounded-2xl border border-[color:var(--ibo-border-solid)] bg-[color:var(--ibo-card)] p-4 sm:p-5 shadow-[var(--ibo-shadow)]">
      <div className="flex items-center gap-2 mb-3">
        <Link2 size={16} className="text-[#5BB8FF] shrink-0" />
        <p className="text-xs font-bold uppercase tracking-[0.14em] text-[color:var(--ibo-muted)]">
          Blockchain infrastructure
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        {chains.map((c) => {
          const id = (c.chain_id || '').toLowerCase();
          const cls = CHAIN_COLORS[id] || 'text-[color:var(--ibo-ink-secondary)] border-[color:var(--ibo-border-solid)] bg-[color:var(--ibo-elevated)]';
          const live = c.deposit_scan_enabled;
          return (
            <span
              key={id}
              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[11px] font-semibold ${cls}`}
            >
              {live ? <Zap size={11} /> : <Clock size={11} />}
              {c.label || id}
              <span className="opacity-70 font-normal">
                {live ? '· deposits live' : '· coming soon'}
              </span>
            </span>
          );
        })}
      </div>
      {/* <p className="text-[11px] text-zinc-500 mt-3 leading-relaxed">
        Networks shown in Deposit / Withdraw follow your QuickNode RPC configuration. Each chain uses a
        dedicated endpoint with isolated rate limits.
      </p> */}
    </div>
  );
}
