import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Trash2 } from 'lucide-react';

function legLabel(c, underlying) {
  if (!c) return '—';
  const ot = String(c.option_type || 'C').charAt(0).toUpperCase();
  const base = String(c.underlying_symbol || underlying || '').replace(/USDT$/i, '').toUpperCase() || 'BTC';
  const k = Math.round(Number(c.strike) || 0);
  const ex = String(c.expiry || '').slice(2, 10).replace(/-/g, '');
  return `${ot}-${base}-${k}-${ex}`;
}

/**
 * Strategy Builder — compose multi-leg options strategies (UI parity with Delta).
 */
export default function OptionsStrategyBuilder({
  selected = null,
  underlying = 'BTCUSDT',
  referenceIndex = null,
  onPickLeg,
}) {
  const [legs, setLegs] = useState([]);
  const [side, setSide] = useState('buy');

  const addSelected = () => {
    if (!selected?.id) return;
    setLegs((prev) => {
      if (prev.some((l) => l.id === selected.id && l.side === side)) return prev;
      return [
        ...prev,
        {
          id: selected.id,
          side,
          qty: 1,
          contract: selected,
          premium: selected.market?.mid ?? selected.market?.mark_price ?? null,
        },
      ];
    });
  };

  const removeLeg = (id, s) => setLegs((prev) => prev.filter((l) => !(l.id === id && l.side === s)));

  const summary = useMemo(() => {
    let debit = 0;
    let netDelta = 0;
    for (const l of legs) {
      const px = Number(l.premium) || 0;
      const q = Number(l.qty) || 0;
      const mul = l.side === 'buy' ? 1 : -1;
      debit += px * q * mul;
      const d = Number(l.contract?.market?.delta);
      if (Number.isFinite(d)) netDelta += d * q * mul;
    }
    return { debit, netDelta };
  }, [legs]);

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="shrink-0 px-4 py-3 border-b border-[color:var(--ibo-border)]">
        <div className="text-[15px] font-bold" style={{ color: 'var(--ibo-ink)' }}>Strategy Builder</div>
        <p className="mt-1 text-[12px]" style={{ color: 'var(--ibo-muted)' }}>
          Add legs from the chain, then review net premium and delta. Index{' '}
          <b style={{ color: 'var(--ibo-ink)' }}>
            {referenceIndex != null ? Number(referenceIndex).toLocaleString(undefined, { maximumFractionDigits: 1 }) : '—'}
          </b>
        </p>
      </div>

      <div className="shrink-0 flex flex-wrap items-center gap-2 px-4 py-3 border-b border-[color:var(--ibo-border)]">
        <div className="inline-flex rounded-md border border-[color:var(--ibo-border-solid)] p-0.5">
          {['buy', 'sell'].map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setSide(s)}
              className={`px-3 py-1.5 rounded text-[12px] font-bold capitalize ${
                side === s ? (s === 'buy' ? 'bg-[#26a69a] text-white' : 'bg-[#d14b4b] text-white') : ''
              }`}
              style={side === s ? undefined : { color: 'var(--ibo-muted)' }}
            >
              {s}
            </button>
          ))}
        </div>
        <button
          type="button"
          disabled={!selected}
          onClick={addSelected}
          className="inline-flex items-center gap-1.5 rounded-md bg-[#fe6c02] px-3 py-1.5 text-[12px] font-bold text-white disabled:opacity-40"
        >
          <Plus size={14} /> Add selected leg
        </button>
        {selected ? (
          <span className="text-[11px] font-mono" style={{ color: 'var(--ibo-muted)' }}>
            {legLabel(selected, underlying)}
          </span>
        ) : (
          <span className="text-[11px]" style={{ color: 'var(--ibo-muted)' }}>Select a Call/Put on the chain first</span>
        )}
        <button
          type="button"
          onClick={() => setLegs([])}
          disabled={!legs.length}
          className="ml-auto text-[11px] font-semibold disabled:opacity-40"
          style={{ color: 'var(--ibo-muted)' }}
        >
          Clear
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-auto">
        {!legs.length ? (
          <div className="flex h-full items-center justify-center px-6 text-center text-[13px]" style={{ color: 'var(--ibo-muted)' }}>
            No legs yet. Pick a contract and click Add selected leg.
          </div>
        ) : (
          <table className="w-full text-left text-[12px]">
            <thead className="sticky top-0 text-[10px] uppercase tracking-wider font-extrabold border-b border-[color:var(--ibo-border)]" style={{ color: 'var(--ibo-muted)', background: 'var(--ibo-bg)' }}>
              <tr>
                <th className="px-4 py-2">Contract</th>
                <th className="px-2 py-2">Side</th>
                <th className="px-2 py-2">Qty</th>
                <th className="px-2 py-2">Premium</th>
                <th className="px-2 py-2">Delta</th>
                <th className="px-4 py-2 text-right" />
              </tr>
            </thead>
            <tbody>
              {legs.map((l) => (
                <tr key={`${l.id}-${l.side}`} className="border-b border-[color:var(--ibo-border)]">
                  <td className="px-4 py-2.5 font-mono font-semibold" style={{ color: 'var(--ibo-ink)' }}>
                    <button type="button" className="hover:text-[#fe6c02]" onClick={() => onPickLeg?.(l.id)}>
                      {legLabel(l.contract, underlying)}
                    </button>
                  </td>
                  <td className={`px-2 py-2.5 font-bold uppercase ${l.side === 'buy' ? 'text-[#26a69a]' : 'text-[#d14b4b]'}`}>
                    {l.side}
                  </td>
                  <td className="px-2 py-2.5">
                    <input
                      type="number"
                      min={1}
                      value={l.qty}
                      onChange={(e) => {
                        const q = Math.max(1, Number(e.target.value) || 1);
                        setLegs((prev) => prev.map((x) => (x.id === l.id && x.side === l.side ? { ...x, qty: q } : x)));
                      }}
                      className="w-16 rounded border border-[color:var(--ibo-border-solid)] bg-transparent px-2 py-1 font-mono"
                    />
                  </td>
                  <td className="px-2 py-2.5 font-mono">{l.premium != null ? Number(l.premium).toFixed(2) : '—'}</td>
                  <td className="px-2 py-2.5 font-mono">
                    {l.contract?.market?.delta != null ? Number(l.contract.market.delta).toFixed(3) : '—'}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <button type="button" onClick={() => removeLeg(l.id, l.side)} className="p-1.5 rounded hover:bg-[color:var(--ibo-hover)]" style={{ color: 'var(--ibo-muted)' }}>
                      <Trash2 size={14} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="shrink-0 flex items-center justify-between gap-3 border-t border-[color:var(--ibo-border)] px-4 py-3">
        <div className="text-[12px]" style={{ color: 'var(--ibo-muted)' }}>
          Net premium{' '}
          <b className={summary.debit >= 0 ? 'text-[#d14b4b]' : 'text-[#26a69a]'} style={{ color: undefined }}>
            <span className={summary.debit >= 0 ? 'text-[#d14b4b]' : 'text-[#26a69a]'}>
              {summary.debit >= 0 ? '+' : ''}{summary.debit.toFixed(2)} USD
            </span>
          </b>
          <span className="mx-2 opacity-40">·</span>
          Net Δ <b style={{ color: 'var(--ibo-ink)' }}>{summary.netDelta.toFixed(3)}</b>
        </div>
        <div className="flex items-center gap-2">
          <Link
            to={`/move/${String(underlying || 'BTC').replace(/USDT$/i, '')}`}
            className="rounded-md border border-[#fe6c02]/40 px-3 py-2 text-[12px] font-bold text-[#fe6c02] hover:bg-[rgba(254,108,2,0.08)]"
          >
            MOVE straddle
          </Link>
          <Link
            to={`/options/strategy/${String(underlying || 'BTC').replace(/USDT$/i, '')}`}
            className="rounded-md bg-[#fe6c02] px-4 py-2 text-[12px] font-bold text-white"
          >
            Open Strategy Builder
          </Link>
        </div>
      </div>
    </div>
  );
}
