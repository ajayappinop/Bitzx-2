import { networkChainDetailRows } from '@/lib/walletNetworks';

/**
 * Network picker with per-option chain details (replaces plain &lt;select&gt;).
 */
export default function NetworkSelectList({
  networks = [],
  plannedNetworks = [],
  value,
  onChange,
  disabled = false,
  mode = 'deposit',
}) {
  const renderOption = (n, { isPlanned = false } = {}) => {
    const selected = value === n.network;
    const rows = networkChainDetailRows(n, { mode }).slice(0, 4);
    const canSelect = !isPlanned && !disabled;

    return (
      <button
        key={`${n.asset}-${n.network}-${n.chain_id || ''}-${isPlanned ? 'plan' : 'act'}`}
        type="button"
        disabled={!canSelect}
        onClick={() => canSelect && onChange(n.network)}
        className={`w-full text-left rounded-xl border px-4 py-3 transition-colors ${
          selected
            ? 'border-[rgba(254, 157, 85,0.5)] bg-[rgba(254, 157, 85,0.1)]'
            : isPlanned
              ? 'border-white/8 bg-white/[0.02] opacity-60 cursor-not-allowed'
              : 'border-surface-border bg-surface-card/40 hover:border-[rgba(254, 157, 85,0.3)] hover:bg-surface-card/70'
        }`}
      >
        <div className="flex items-start gap-3">
          <span
            className={`mt-1 w-4 h-4 rounded-full border-2 shrink-0 flex items-center justify-center ${
              selected ? 'border-[#FE9D55]' : 'border-zinc-500'
            }`}
          >
            {selected ? <span className="w-2 h-2 rounded-full bg-[#FE9D55]" /> : null}
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-white">
              {n.label || n.network}
              {n.testnet ? (
                <span className="ml-2 text-[10px] font-bold uppercase text-[#FE9D55]/90">
                  testnet
                </span>
              ) : null}
            </p>
            <p className="text-[11px] text-zinc-400 mt-0.5">
              {[
                n.endpoint_label,
                n.chain_display || n.chain_id,
                isPlanned ? 'Coming soon' : null,
              ]
                .filter(Boolean)
                .join(' · ')}
            </p>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
              {rows.map((row) => (
                <span key={row.label} className="text-[10px] text-zinc-500">
                  <span className="uppercase font-bold tracking-wide">{row.label}: </span>
                  <span className="text-zinc-300">{row.value}</span>
                </span>
              ))}
            </div>
          </div>
        </div>
      </button>
    );
  };

  return (
    <div className="space-y-2">
      {networks.map((n) => renderOption(n))}
      {plannedNetworks.map((n) => renderOption(n, { isPlanned: true }))}
    </div>
  );
}
