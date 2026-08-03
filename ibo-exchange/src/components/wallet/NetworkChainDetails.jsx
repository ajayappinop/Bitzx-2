import { Link2, Zap, Clock, AlertCircle } from 'lucide-react';
import { networkChainDetailRows } from '@/lib/walletNetworks';

const CHAIN_CHIP = {
  btc: 'text-orange-300 border-orange-400/35 bg-orange-500/10',
  eth: 'text-violet-300 border-violet-400/35 bg-violet-500/10',
  bsc: 'text-[#5BB8FF] border-[rgba(91,184,255,0.35)] bg-[rgba(91,184,255,0.1)]',
  tron: 'text-red-300 border-red-400/35 bg-red-500/10',
  solana: 'text-emerald-300 border-emerald-400/35 bg-emerald-500/10',
};

/**
 * Selected network summary + chain/RPC metadata for deposit & withdraw tabs.
 */
export default function NetworkChainDetails({ network, mode = 'deposit' }) {
  if (!network) return null;

  const rows = networkChainDetailRows(network, { mode });
  const chainId = (network.chain_id || '').toLowerCase();
  const chipCls = CHAIN_CHIP[chainId] || 'text-zinc-300 border-white/15 bg-white/[0.04]';
  const isLive =
    mode === 'deposit' ? network.deposit_enabled : network.withdraw_enabled;
  const isPlanned = network.status === 'coming_soon';

  return (
    <div className="rounded-xl border border-[color:var(--ibo-border-solid)] bg-white/[0.03] overflow-hidden">
      <div className="px-4 py-3 border-b border-[color:var(--ibo-border-solid)] flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[10px] uppercase tracking-wider text-zinc-500 font-bold mb-1">
            Selected network
          </p>
          <p className="text-sm font-semibold text-white leading-snug">
            {network.label || network.network}
          </p>
          <p className="text-xs text-zinc-400 mt-0.5 font-mono">{network.asset}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {chainId ? (
            <span
              className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide ${chipCls}`}
            >
              <Link2 size={10} />
              {network.chain_display || chainId}
            </span>
          ) : null}
          {isPlanned ? (
            <span className="inline-flex items-center gap-1 rounded-full border border-[rgba(91,184,255,0.35)] bg-[rgba(91,184,255,0.1)] px-2.5 py-1 text-[10px] font-semibold text-[#5BB8FF]">
              <Clock size={10} />
              Coming soon
            </span>
          ) : isLive ? (
            <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/35 bg-emerald-500/10 px-2.5 py-1 text-[10px] font-semibold text-emerald-200">
              <Zap size={10} />
              {mode === 'deposit' ? 'Deposits live' : 'Withdrawals on'}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 rounded-full border border-zinc-500/35 bg-zinc-500/10 px-2.5 py-1 text-[10px] font-semibold text-zinc-300">
              <AlertCircle size={10} />
              Limited
            </span>
          )}
        </div>
      </div>
      <dl className="px-4 py-3 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2.5">
        {rows.map((row) => (
          <div key={`${row.label}-${row.value}`} className="min-w-0">
            <dt className="text-[10px] uppercase tracking-wider text-zinc-500 font-bold">
              {row.label}
            </dt>
            <dd
              className={`text-xs mt-0.5 break-words ${
                row.highlight === 'ok'
                  ? 'text-emerald-300/90'
                  : row.highlight === 'warn'
                    ? 'text-[#5BB8FF]'
                    : row.highlight === 'muted'
                      ? 'text-zinc-400'
                      : 'text-zinc-200'
              }`}
            >
              {row.value}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
